// 语言服务进度（`$/progress`）→ 状态栏后台任务 + 右下角消息窗口。
//
// 起因（2026-09-29 用户）：「给 LSP 和 gradle 解析都在右下角消息窗口加入进度表示，对照 IDEA 消息窗口」。
// 之前的形状：native 把除 publishDiagnostics 之外的通知**全部丢弃**（`native/lsp.cpp` 的
// `is_notification` 分支），initialize 能力里连 `window` 段都没有 —— 于是 jdt.ls 的
// "Importing projects / Building workspace index" 根本不会变成任何可见的东西。
//
// 上游依据（本机 intellij-community 树，逐条对照）：
//   · 能力：`platform/lsp/src/api/LspClientCapabilities.kt:245-249` —— `window { showMessage; showDocument; workDoneProgress = true }`。
//   · 处理：`platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt:255-339`
//     createProgress 只回 null；notifyProgress 按 begin/report/end 三分支，
//     `percentage` 是 0-100（`:263` 转 fraction 时 coerceIn），report **只覆盖发出来的字段**。
//   · 显示：这条进度进的是状态栏的后台任务弹窗（`ProcessPopup.java:331` 遍历的行里有 `JProgressBar`），
//     任务名 `LspBundle.properties:32` `progress.title.progress={0}: progress`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyLspProgressEvent, lspProgressFallbackTitle, lspProgressKey, lspProgressLabel,
  parseLspProgressEvent, runningLspTasks, takeLspProgressForLanguage,
  handleLspProgressEvent, lspServerMessages, lspMessageRouteOf, lspActionTitles, LSP_REFRESH_METHODS,
} from '../src/lspProgress.ts'
import { clearLspLog, lspLogEntries } from '../src/lspServerLog.ts'
import { LspPerFileCache, lspCacheCount } from '../src/lspPerFileCache.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const app = read('src/App.vue')

const begin = { language: 'java', token: '0', kind: 'begin', title: 'Importing projects', message: 'AE2VMAddon', percentage: 5, cancellable: false }

test('百分比按上游那样夹进 0-100，越界与缺失都算"没有百分比"', () => {
  assert.equal(parseLspProgressEvent(begin).percent, 5)
  assert.equal(parseLspProgressEvent({ ...begin, percentage: 140 }).percent, -1, '超出 100 就是不可信，等于没给')
  assert.equal(parseLspProgressEvent({ ...begin, percentage: -3 }).percent, -1)
  assert.equal(parseLspProgressEvent({ ...begin, percentage: '45' }).percent, -1, '字符串不是数字')
  // 形状不对的整条事件都不该进状态表（未知 kind、缺 token、缺语言）。
  assert.equal(parseLspProgressEvent({ ...begin, kind: 'middle' }), null)
  assert.equal(parseLspProgressEvent({ ...begin, token: '' }), null)
  assert.equal(parseLspProgressEvent({ ...begin, language: undefined }), null)
})

// 事件一律先过 `parseLspProgressEvent`：那才是 bridge 交给状态表的形状（宿主发的是
// `percentage`，表里存的是 `percent` —— 跳过解析直接塞对象会让整条判据测的是空气）。
const event = over => parseLspProgressEvent({ ...begin, ...over })

test('begin 建行、report 只覆盖发出来的字段、end 删行', () => {
  const tasks = {}
  applyLspProgressEvent(tasks, event({}), 1000)
  assert.deepEqual(Object.keys(tasks), ['java:0'])
  assert.deepEqual(
    [tasks['java:0'].title, tasks['java:0'].details, tasks['java:0'].percent, tasks['java:0'].since],
    ['Importing projects', 'AE2VMAddon', 5, 1000],
  )
  // report 没带 message ⇒ 沿用旧值（上游 :318 的 `value.message ?: currentState.details`）。
  applyLspProgressEvent(tasks, event({ kind: 'report', message: '', percentage: 42 }), 2000)
  assert.equal(tasks['java:0'].details, 'AE2VMAddon', '没发的字段不能被空值抹掉')
  assert.equal(tasks['java:0'].percent, 42)
  assert.equal(tasks['java:0'].since, 1000, '已用时间的起点是 begin，不是最近一次 report')
  applyLspProgressEvent(tasks, event({ kind: 'report', message: '', percentage: null }), 3000)
  assert.equal(tasks['java:0'].percent, 42, '没给百分比时沿用旧的，不是退回不确定式')
  applyLspProgressEvent(tasks, event({ kind: 'end' }), 4000)
  assert.deepEqual(Object.keys(tasks), [], 'end 之后这条任务必须整体消失')
})

test('服务器可以跳过 create 直接 report —— 那一拍按 begin 处理', () => {
  const tasks = {}
  // LSP 规范里 token 可以由 `window/workDoneProgress/create` 申请，也可以由服务器自己造一个
  // 直接发进度；只认 begin 的实现会把这种报告整条丢掉，进度就永远看不见。
  applyLspProgressEvent(tasks, event({ kind: 'report', title: 'Building index', percentage: 60 }), 10)
  assert.equal(tasks['java:0'].title, 'Building index')
  assert.equal(tasks['java:0'].percent, 60)
})

test('title 缺失时用上游那条 "{0}: progress" 兜底，百分比文字与顺序各自有规则', () => {
  assert.equal(lspProgressFallbackTitle('java'), 'java：进度')
  const tasks = {}
  applyLspProgressEvent(tasks, event({ title: '' }), 10)
  assert.equal(tasks['java:0'].title, 'java：进度')
  applyLspProgressEvent(tasks, event({ token: '1', title: 'X' }), 5)  // 更早的一条
  const order = runningLspTasks(tasks).map(task => task.key)
  assert.deepEqual(order, ['java:1', 'java:0'], '行按 begin 先后排，不能每次刷新都换序')
  assert.equal(lspProgressLabel(tasks['java:0']), '5%')
  assert.equal(lspProgressLabel({ ...tasks['java:0'], percent: -1 }), '', '没有百分比就没有文字（那一行是不确定式）')
  assert.equal(lspProgressKey('java', '0'), 'java:0')
})

// ---------------------------------------------------------------------------
// 接线（算法在、没人消费就等于没有 —— 这是本项目反复踩过的那类断链）
// ---------------------------------------------------------------------------

test('native 真的把 $/progress 转出来，并且声明了让服务器有资格发它的能力', () => {
  const client = read('native/lsp.cpp')
  assert.match(client, /name == "\$\/progress"/, 'lsp.cpp 的通知分支要认得 `$/progress`')
  assert.match(client, /handler = progress_/, '认得之后要交给 progress_ 回调，不是继续丢弃')
  assert.match(read('native/lsp.hpp'), /void on_progress\(Notify handler\)/, 'Client 要有 on_progress 这个口')
  assert.match(read('native/lsp_host.cpp'), /client_\.on_progress\(/, 'Host 要把它接出去')
  const bootstrap = read('native/lsp_host_bootstrap.cpp')
  assert.match(bootstrap, /host->set_progress\(/, 'Session 起服务器时要装这个回调')
  assert.match(bootstrap, /"event", "lsp\.progress"/, '转出去的事件名要与前端 switch 一致')
  assert.match(bootstrap, /\{"window", \{\{"workDoneProgress", true\}\}\}/,
    'initialize 里必须声明 window.workDoneProgress —— 不声明服务器就有权不发进度')
  assert.match(read('native/main.cpp'), /set_progress_sink\(/, '宿主要把这条事件接到 lsp 事件通道上')
})

test('前端每一环都消费它：bridge → 面板 → 消息窗口 → 模板', () => {
  const bridge = read('src/bridge.ts')
  assert.match(bridge, /case 'lsp\.progress':/, 'bridge 没有这一支，native 转出来也没人收')
  assert.match(bridge, /return handleLspProgressEvent\(data\.event, data\)/,
    '桥接层只留一行转发：三支语义与停机清理都在 src/lspProgress.ts（与 gradleEvents 同一个约定）')
  assert.match(read('src/lspProgress.ts'), /applyLspProgressEvent\(lspProgressTasks, parsed\)/)
  const panel = read('src/progressPanel.ts')
  assert.match(panel, /for \(const task of ctx\.lspProgress\(\)\)/, '后台任务面板要列出语言服务的进度行')
  assert.match(panel, /percent: task\.percent >= 0 \? task\.percent : null/)
  // 取消按钮只在服务器于 begin 里说了 `cancellable: true` 时才给（上游同一个判据：
  // LspServerNotificationsHandlerImpl.kt:283），点了要真把那条通知发回服务器。
  assert.match(panel, /cancellable: task\.cancellable \? \{ lsp: \{ language: task\.language, token: task\.token \} \} : false/,
    '取消能力跟着服务器说的话走，不常开也不常关')
  assert.match(panel, /request\('lsp\.cancelProgress', target\.lsp\)/, '那一行的取消要发 lsp.cancelProgress')
  assert.match(app, /lspProgress: \(\) => runningLspTasks\(lspProgressTasks\)/, 'App 要把进度表注入面板')
  assert.match(app, /class="status-progress-track"/, '弹窗里的行要有进度条')
  assert.match(read('src/notifications.ts'), /wireLspProgressNotices\(notifyProgress\)/,
    '右下角的消息窗口也要有这一行（用户原话"在右下角消息窗口加入进度表示"）')
})

test('取消回程与停机清理都接上了（class-parity-todo §15 的两条）', () => {
  // 这两条回程住在 native/lsp_session_progress.cpp（lsp_session.cpp 贴着机检上限）。
  const progress = read('native/lsp_session_progress.cpp')
  assert.match(progress, /host->notify\("window\/workDoneProgress\/cancel", \{\{"token", token\}\}\)/,
    '发的必须是 LSP 那条通知本体，方法名与 token 都不能错')
  assert.match(progress, /void Session::cancel_progress/, 'Session 要有这条窄口（不给界面任意发通知的能力）')
  assert.match(progress, /on_progress_\(\{\{"event", "lsp\.progressReset"\}, \{"language", language\}\}\)/,
    'reset 要按语言各报一条（只收这一种语言的行，别的服务器可能还在跑）')
  assert.match(progress, /void Session::announce_progress_reset\(\)[\s\S]{0,260}for \(const auto& language : languages\) announce_progress_reset\(language\)/,
    '停机那条要逐台转发到单语言那条，两处共用一份措辞与形状')
  const session = read('native/lsp_session.cpp')
  assert.match(session, /shutdown_all\(\) noexcept[\s\S]*?announce_progress_reset\(\);[\s\S]*?host->stop\(\)/,
    '停机链里必须在 stop 之前收掉在跑的进度（否则永远等不到 end）')
  // 只换一台服务器（initialize 失败后重试）也要收：那条路径不经过 shutdown_all。
  assert.match(session, /if \(doomed\) \{ doomed->stop\(\); announce_progress_reset\(language\); \}/,
    '换掉某一台服务器时要按那一台收行，别的语言还在跑不能一起清')
  assert.match(read('native/main.cpp'), /case "lsp\.cancelProgress"_h/, '宿主分派表里有这一支')
  assert.match(read('src/bridge.ts'), /'lsp\.cancelProgress'/, 'Method union 要与 native 分派表一一对应（routing-parity）')
  // 服务器停了 = 不会再有 `end`：行要收掉，且**不能谎报已完成**。

  assert.match(read('src/bridge.ts'), /case 'lsp\.progressReset'/, 'bridge 要接住 reset')
  assert.match(read('src/lspProgress.ts'), /takeLspProgressForLanguage\(lspProgressTasks,/)
  assert.match(read('src/progressNotices.ts'), /lspInterruptedNoticeOf/, '消息窗口那边给"已停止"的措辞，不是"已完成"')
})

test('takeLspProgressForLanguage 只收这一种语言的行，别的留着', () => {
  const tasks = {
    'java:1': { key: 'java:1', language: 'java', token: '1', title: 'a', details: '', percent: 1, cancellable: false, since: 1 },
    'kotlin:2': { key: 'kotlin:2', language: 'kotlin', token: '2', title: 'b', details: '', percent: 2, cancellable: false, since: 2 },
  }
  const taken = takeLspProgressForLanguage(tasks, 'java')
  assert.deepEqual(taken.map(task => task.key), ['java:1'])
  assert.deepEqual(Object.keys(tasks), ['kotlin:2'], '另一种语言还在跑，不能被一起收掉')
  assert.deepEqual(takeLspProgressForLanguage({}, 'java'), [], '没有行就是空手，不该报错')
})

// ---------------------------------------------------------------------------
// 服务器**主动**发来的另外三条：`window/logMessage`、`window/showMessageRequest`、
// `workspace/…refresh` 那一族。上游逐条：
//   · `platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt:341-368` ——
//     五条 refresh 全部 `completedFuture(null)`（协议的返回类型是 void），并让对应缓存作废重取
//     （`LspClientImpl.kt:223-265`：semanticTokens 是 clearCache、diagnostics 是 forceFullRepull、
//     inlayHints 是 invalidate）；`refreshInlineValues`（`:368`）上游什么都不做只答 null。
//   · `:377-383` `showMessageRequest` —— logInfo 把消息与 `actions` 的标题一起写（`msg: a, b`），
//     通知带按钮，返回用户点的那一项（关掉就是 null）。
//   · `:385-390` `showMessage` —— 日志 + 通知，都只带消息本身。
//   · `:396-404` `logMessage` —— 只写日志，只有 Error/Warning 才另外弹通知。
// 本仓的落点：客户端在 native/lsp.cpp 分派这四条并把 `method` 随参数带出来，宿主经
// `lsp.message` 事件原样转发（桥不改），处置就在 `src/lspProgress.ts`。
// ---------------------------------------------------------------------------

/** 单例状态（通知队列 + 日志表）在每条用例前后都倒空，免得用例互相看见对方的行。 */
function resetServerMessages() {
  lspServerMessages.splice(0, lspServerMessages.length)
  clearLspLog()
}

test('分派认得这四条：旧宿主不带 method 时保持改动之前的行为', () => {
  assert.equal(lspMessageRouteOf(undefined), 'notify')
  assert.equal(lspMessageRouteOf(''), 'notify', '空串等于没带')
  assert.equal(lspMessageRouteOf('window/showMessage'), 'notify')
  assert.equal(lspMessageRouteOf('window/logMessage'), 'log')
  assert.equal(lspMessageRouteOf('window/showMessageRequest'), 'ask')
  for (const method of LSP_REFRESH_METHODS) assert.equal(lspMessageRouteOf(method), 'refresh', method)
  // 本仓没有动态文档内容那一层 ⇒ 宿主对这条照旧回 MethodNotFound（判据在 native/lsp_test.cpp），
  // 前端也就不能把它当 refresh 清缓存。
  assert.equal(lspMessageRouteOf('workspace/documentContent/refresh'), 'notify')
})

test('选项标题只认服务器给的那些：形状不对、缺字段一律当没有', () => {
  assert.deepEqual(lspActionTitles([{ title: '是' }, { title: '否' }]), ['是', '否'])
  assert.deepEqual(lspActionTitles([{ title: 1 }, null, {}, { title: 'ok' }]), ['ok'], '不凭空造标题')
  assert.deepEqual(lspActionTitles(undefined), [])
  assert.deepEqual(lspActionTitles('no'), [])
})

test('window/logMessage：日志级的只进语言服务日志，Error/Warning 才进通知队列', () => {
  resetServerMessages()
  assert.equal(handleLspProgressEvent('lsp.message', {
    language: 'java', severity: 4, message: 'indexing 12 of 30', method: 'window/logMessage',
  }), true)
  assert.deepEqual(lspServerMessages, [], '日志级/信息级的服务器话不该弹通知（上游同一分档）')
  assert.deepEqual(lspLogEntries.value.map(entry => [entry.kind, entry.level, entry.text]),
    [['message', 4, 'indexing 12 of 30']], '但必须留在「语言服务」日志里，不然 jdt.ls 的自述整条看不见')

  assert.equal(handleLspProgressEvent('lsp.message', {
    language: 'java', severity: 2, message: 'classpath broken', method: 'window/logMessage',
  }), true)
  assert.deepEqual(lspServerMessages.map(item => [item.severity, item.message]), [[2, 'classpath broken']],
    'Warning 级的那一条要弹（弹出去之后由消息窗口那边记日志，这里不重复记）')
  assert.equal(lspLogEntries.value.filter(entry => entry.text === 'classpath broken').length, 0)
  resetServerMessages()
})

test('workspace/…refresh：整批作废前端那一族 LSP 缓存，并留一行日志', () => {
  resetServerMessages()
  const stamp = { value: 1 }
  const cache = new LspPerFileCache(() => stamp.value)
  assert.ok(lspCacheCount() >= 1, '缓存构造时自登记（注册表在 src/lspPerFileCache.ts）')
  cache.set('src/Sample.java', 'documentSymbol', '旧结果')
  assert.equal(cache.get('src/Sample.java', 'documentSymbol'), '旧结果', '先确认槽里真有东西')

  assert.equal(handleLspProgressEvent('lsp.message', {
    language: 'java', method: 'workspace/semanticTokens/refresh', severity: 3, message: '',
  }), true, 'refresh 没有正文也必须算已消费')
  assert.equal(cache.get('src/Sample.java', 'documentSymbol'), null, 'refresh 之后要重新请求，不能吃旧结果')
  assert.deepEqual(lspServerMessages, [], 'refresh 不是给用户看的气球')
  const lines = lspLogEntries.value.filter(entry => entry.kind === 'refresh')
  assert.equal(lines.length, 1, '但要在日志里留痕：服务器确实要求过重取')
  assert.match(lines[0].text, /workspace\/semanticTokens\/refresh/)
  resetServerMessages()
})

test('window/showMessageRequest：消息本身照 showMessage 显示，选项标题另记一行日志', () => {
  resetServerMessages()
  assert.equal(handleLspProgressEvent('lsp.message', {
    language: 'java', severity: 2, message: '要把这个文件夹当成工程导入吗', method: 'window/showMessageRequest',
    actions: [{ title: '导入' }, { title: '不导入' }],
  }), true)
  assert.deepEqual(lspServerMessages.map(item => [item.severity, item.message]), [[2, '要把这个文件夹当成工程导入吗']],
    '队列里只有服务器那句话，不掺我们的字（按钮那半要接通知面，见请求文档）')
  const lines = lspLogEntries.value.filter(entry => entry.kind === 'message')
  assert.equal(lines.length, 1)
  assert.match(lines[0].text, /导入 \/ 不导入/, '上游把选项标题一起写进日志（LspServerNotificationsHandlerImpl.kt:380）')
  resetServerMessages()
})

test('接线：客户端认得、宿主带得出、前端分派得到、缓存注册表有人清', () => {
  const client = read('native/lsp.cpp')
  assert.match(client, /name == "window\/logMessage"/, '通知分支要认得 window/logMessage')
  assert.match(client, /is_refresh_request\(method\)/, 'refresh 一族要真的答回包，不能再回 MethodNotFound')
  assert.match(client, /window\/showMessageRequest/, 'showMessageRequest 也要有条分支（回 MessageActionItem 或 null）')
  const bootstrap = read('native/lsp_host_bootstrap.cpp')
  assert.match(bootstrap, /\{"method", method\}/, '宿主转发时把是哪一条放进事件里')
  assert.match(bootstrap, /payload\["actions"\]/, 'showMessageRequest 的选项原样上来')
  assert.match(read('src/bridge.ts'), /case 'lsp\.progress': case 'lsp\.progressReset': case 'lsp\.message':/,
    '这三条仍走同一行转发（桥不改，字段袋原样交给本模块）')
  assert.match(read('src/lspServerMessages.ts'), /clearAllLspCaches\(\)/, 'refresh 那一支真去清缓存')
  assert.match(read('src/lsSessionHost.ts'), /clearAllLspCaches\(\)/, '换一代服务器也整批作废')
  assert.match(read('src/lspPerFileCache.ts'), /registerLspCache\(this\)/, '两个按文件缓存自登记')
  assert.match(read('src/lspHighlightingCache.ts'), /registerLspCache\(this\)/, '快照缓存也参加批量作废')
})
