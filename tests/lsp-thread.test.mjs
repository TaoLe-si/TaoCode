// 语言服务必须跑在自己的线程上 —— 机检。
//
// 起因（2026-09-28 实测）：`lsp.*` 原先在 UI 线程上直接调 `Session`，而 `Session`/`Host`
// 的调用会阻塞（起子进程、写 stdin 管道、等 initialize）。读线程上的 initialize-ready 回调
// 抱着 `Session::mutex_` 去写服务器，与"在 `io_mutex_` 里做阻塞 WriteFile"的调用方锁序相反 →
// 死锁，整个窗口"未响应"、CPU 归零（在 AE2 这种大项目上必现）。
// 修法是结构性的：`lsp` 只在 `taocode::lsp::Worker` 那条线程上被创建/使用/销毁。
// 下面每条断言都在守这个形状 —— 谁把一次同步调用漏回 UI 线程，这里就该响。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// 源文件是 CRLF：先归一化。判据要按行/片段切片，换行符不一致会让它静默失效（曾经就静默在
// "切片为空 → 断言全部落空"上）。所以每条切片还都断言了长度，不给空转留机会。
const read = relative => readFileSync(join(root, relative), 'utf8').replace(/\r\n/g, '\n')
const main = read('native/main.cpp')
const bootstrap = read('native/lsp_host_bootstrap.cpp')

const LSP_METHODS = ['lsp.open', 'lsp.change', 'lsp.close', 'lsp.stop', 'lsp.request']

/** 取 `case "NAME"_h: {` 到它自己的 `return;`（或下一个 case）为止的那段。 */
function handler(source, name) {
  const start = source.indexOf(`case "${name}"_h: {`)
  assert.ok(start >= 0, `找不到 ${name} 的处理分支`)
  const bounds = [source.indexOf('case "', start + 10), source.indexOf('\n                return;', start)]
    .filter(index => index >= 0)
  return source.slice(start, bounds.length ? Math.min(...bounds) : source.length)
}

/** 有没有"在投递之前就同步调 Session"的写法 —— 投进任务里调是正确形状，不算。 */
function calls_before_post(body) {
  const posted = [body.indexOf('post_lsp('), body.indexOf('lsp_worker->post(')].filter(index => index >= 0)
  const first_post = posted.length ? Math.min(...posted) : -1
  return [...body.matchAll(/lsp->(\w+)\(/g)]
    .filter(match => first_post < 0 || match.index < first_post)
    .map(match => match[1])
}

test('五个 lsp.* 处理器只投递，不在 UI 线程上调 Session', () => {
  for (const name of LSP_METHODS) {
    const body = handler(main, name)
    assert.ok(body.length > 40, `${name} 的分支切片只有 ${body.length} 字符 —— 判据在空转`)
    assert.match(body, /post_lsp\(|lsp_worker->post\(/, `${name} 没有投递到语言服务线程`)
    assert.deepEqual(calls_before_post(body), [], `${name} 在投递之前就同步调了 Session：${calls_before_post(body).join(', ')}`)
    assert.doesNotMatch(body, /result = lsp->/, `${name} 把 Session 的返回值同步交回分派链 = 在 UI 线程上等语言服务`)
  }
  // 反例之一：整段压根没投递。
  const broken = 'case "lsp.open"_h: {\n                result = lsp->open(path, text);\n                return;'
  assert.deepEqual(calls_before_post(handler(broken, 'lsp.open')), ['open'], '同步调 Session 都没抓到 —— 这条判据是假的')
  // 反例之二：投了递，但在投递之前先同步读了一次 Session。
  const sneaky = 'case "lsp.close"_h: {\n                if (lsp) lsp->close(path);\n                post_lsp(id, [] {});\n                return;'
  assert.deepEqual(calls_before_post(handler(sneaky, 'lsp.close')), ['close'], '投递之前的同步调用没被抓到')
})

test('Session 的创建与销毁都在这条线程上，收尾时先排干再 join', () => {
  assert.match(main, /app\.lsp_worker = std::make_unique<taocode::lsp::Worker>\(\)/, '语言服务线程没在启动期建起来')
  // 线程要早于其它装配建起来（前端一连上就会 open 文档）。
  assert.ok(main.indexOf('app.lsp_worker = std::make_unique') < main.indexOf('app.runs = std::make_unique'),
    '语言服务线程建得太晚：装配链后面还有别的线程要投活儿')
  // 顺序在 close_children 的步骤表里（每步都过 run_step 计时）：先排干并 join 语言服务线程，
  // 再在 UI 线程上收 Session/子进程 —— 线程一 join，`lsp` 就只有这一个主人。
  const chain = main.slice(main.indexOf('void close_children()'))
  const stop = chain.indexOf('lsp_worker->stop()')
  assert.ok(stop > 0 && stop < chain.indexOf('stop_lsp_now()'), '线程 join 之前不能收 Session，顺序反了')
  assert.ok(main.includes('app->close_children();'), 'WM_CLOSE 不再走这条链')
  assert.match(main, /void reset_lsp\(const std::string& root\) \{[\s\S]{0,200}?lsp_worker->post\(/,
    'reset_lsp 在 UI 线程上建/拆 Session')
  assert.match(main, /void stop_lsp\(\) noexcept \{[\s\S]{0,200}?lsp_worker->post/, 'stop_lsp 在 UI 线程上收 Session')
  assert.match(main, /lsp->set_owner_post\(\[worker = lsp_worker\.get\(\)\]/, '读线程的回调没有交回语言服务线程的入口')
})

test('文件变更与 Java 配置的通知也走投递', () => {
  const began = main.indexOf('void announce_file_change')
  const announce = main.slice(began, main.indexOf('void reset_lsp', began))
  assert.ok(announce.length > 40, `announce 切片只有 ${announce.length} 字符 —— 判据在空转`)
  assert.match(announce, /lsp_worker->post\(/, 'announce_file_change 在调用方线程上直接写服务器')
  assert.deepEqual(calls_before_post(announce), [], '投递之外还有同步调用')
  assert.match(main, /lsp_worker->post\(\[this, java, build_tools\] \{/, 'project.settings.update 在 UI 线程上改语言服务配置')
})

test('ready 回调只登记状态，补发 didOpen 交回语言服务线程', () => {
  // 这段跑在 Host 的读线程上：抱着 `Session::mutex_` 去写 stdin 就是这次死锁的另一半。
  const began = bootstrap.indexOf('host->start(spec')
  assert.ok(began >= 0, '找不到 host->start 的 ready 回调')
  const ready = bootstrap.slice(began, bootstrap.indexOf('hosts_[language] = std::move(host)', began))
  assert.ok(ready.length > 40, `ready 回调切片只有 ${ready.length} 字符 —— 判据在空转`)
  assert.doesNotMatch(ready, /did_open\(/, 'ready 回调仍在读线程上直接发请求 —— 锁序死锁会回来')
  assert.match(ready, /post\(\[this, owned\] \{ flush_opens\(owned\); \}\)/)
  // flush_opens 必须"锁内只收集、锁外才发送"，否则只是把死锁挪个地方。
  const flush = bootstrap.slice(bootstrap.indexOf('void Session::flush_opens'))
  assert.ok(flush.length > 40, 'flush_opens 找不到 —— 判据在空转')
  const send = flush.indexOf('host->did_open(')
  const scope_end = flush.indexOf('// 锁已放掉')
  assert.ok(send > 0 && scope_end > 0 && scope_end < send, 'flush_opens 在持锁期间发送')
})

test('投递型处理器的 trace 也收尾，别留下「begin 无 end」的假死锁形状', () => {
  // 真死锁的形状就是"begin 了没有 end"（这次就是靠它定位的）；投递成功也必须留一行收尾，
  // 否则下一个排查的人会被引到错误的方向。
  for (const name of LSP_METHODS) {
    assert.match(handler(main, name), /trace_posted\(traced, profile, "posted"\)/, `${name} 少了 posted 收尾`)
  }
  assert.match(main, /if \(!traced\.empty\(\)\) taocode::trace::begin\(profile, "end " \+ traced \+ " \(" \+ how \+ "\)"\);/)
})

// 关闭路径也必须"有界 + 自报"。2026-09-29 实测：连着三次会话的日志都只有启动行、
// 没有"退出 TaoCode"，点关闭后窗口"未响应" —— 说明收尾链里有一步没回来，
// 而当时的日志写不出是哪一步（所有诊断都在动作**之后**，卡住的那步恰好什么都不留）。
test('收尾链每一步都有界、并且先写"开始"再写"用时"', async () => {
  const { readFileSync } = await import('node:fs')
  const worker = readFileSync(join(root, 'native/lsp_worker.cpp'), 'utf8')
  assert.match(worker, /CancelSynchronousIo/, 'stop() 必须能取消卡在同步 I/O 上的任务（否则 join 永远回不来）')
  assert.match(worker, /done_\.wait_for\(lock, std::chrono::milliseconds\(kDrainWaitMs\)/, '排干必须是**有界**等待')
  // 收尾链整体走 run_step：任何一步卡住，日志里会留下没有配对的「关闭 · X」。
  const main = readFileSync(join(root, 'native/main.cpp'), 'utf8')
  assert.match(main, /void close_children\(\)/)
  assert.match(main, /for \(const auto& step : steps\) taocode::diagnostics::run_step\(profile, step\.first, step\.second\)/)
  assert.match(main, /app->close_children\(\)/, 'WM_CLOSE 必须走这条带计时的链，而不是散着调九个 stop')
  // 九个 stop 一个都不能漏（漏一个就是"孤儿进程/线程"，下一个会话起不来）。
  // Gradle 也在里面：2026-09-29 实测那次 1m15s 的同步是**关窗之后**才写完 daemon 日志的，
  // 说明子进程树不归任何一步管（原来只在 ~App 里被 Job Object 收走，日志上看不出来）。
  for (const call of ['stop_search', 'lsp_worker->stop', 'stop_lsp_now', 'stop_run', 'stop_dap', 'stop_watcher', 'stop_git', 'terminals->kill_all', 'gradle_sync->cancel'])
    assert.ok(main.slice(main.indexOf('void close_children'), main.indexOf('void close_children') + 1200).includes(call),
      `收尾链里少了 ${call}`)

  const diagnostics = readFileSync(join(root, 'native/diagnostics.cpp'), 'utf8')
  const body = diagnostics.slice(diagnostics.indexOf('void run_step'), diagnostics.indexOf('Json paths', diagnostics.indexOf('void run_step')))
  assert.ok(body.length > 100, '切片没拿到 run_step 的函数体')
  // 顺序就是这条判据的全部意义：先 event(...) 再 body()。
  assert.ok(body.indexOf('关闭 · ') < body.indexOf('body()'), '必须先写"开始"，否则卡住的那一步什么都不留')
  assert.match(body, /ms >= 500 \? "WARN" : "INFO"/, '慢步骤要按 WARN 记，日志里一眼能看到')
  // 反例（判据自证）：把顺序倒过来，这条必须响。
  const broken = 'void run_step(...) { event(profile, "INFO", "关闭 · " + name); body(); event(profile, "INFO", "关闭 · " + name + " 用时"); }'
  assert.ok(broken.indexOf('关闭 · ') < broken.indexOf('body()'))
  const backwards = 'void run_step(...) { body(); event(profile, "INFO", "关闭 · " + name); }'
  assert.ok(!(backwards.indexOf('关闭 · ') < backwards.indexOf('body()')), '倒过来的写法必须被上面那条抓到')
})
