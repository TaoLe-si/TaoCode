// 「不允许并行的配置正在跑 ⇒ 先问一句再停」的判据（`src/runRerunConfirm.ts` + `src/runActions.ts` 的那道闸）。
//
// 每条都对着上游那一行写（2026-10-06 execui2 自己 `sed -n` 打开核过的坐标）：
//   · 闸门本体 `platform/execution-impl/src/com/intellij/execution/impl/ExecutionManagerImpl.kt:617-618`
//     （`!isAllowRunningInParallel` 才去数同名在跑的）、条件 `:627-631`、
//     答「取消」就地 `return` `:635-637`、答应了才停 `:644-646`。
//   · 「哪些算在跑」`ExecutionManagerImpl.kt:962-973`：判据是 `!isProcessTerminated`，
//     而 `!isProcessTerminating()` 那半条在 `:968` 是**注释掉的** ⇒ 正在结束途中的那格照样算 ⇒ 下面
//     「关掉的视图仍在列」那条钉的就是它（把它改成读 `runInstanceList()` 会立刻变红）。
//   · 三档钩子 `platform/execution/src/com/intellij/execution/configurations/RunConfiguration.java:194-195`
//     默认 `ASK_AND_RESTART`（本仓没有每类型配置 ⇒ 恒这一档，见 src/runRerunConfirm.ts 文件头）。
//   · 问答与开关 `ExecutionManagerImpl.kt:1097-1128`；开关默认 true 在
//     `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1477`
//     （`confirm.rerun.with.termination`），读法 `platform/execution-impl/src/com/intellij/execution/RunManagerConfig.java:51-53`。
//   · 文案 `platform/execution/resources/messages/ExecutionBundle.properties:94`（标题）、
//     `:212`（正文，带 `{1,choice,1#…|2#…}` 的单复数）、`:213`（`Stop and Rerun`）；
//     取消按钮 `platform/ide-core/src/com/intellij/CommonBundle.java:61-63` →
//     `platform/ide-core/resources/messages/CommonBundle.properties:3`。
//   · 「以后不再显示」那条勾选 `ExecutionManagerImpl.kt:1104-1118` +
//     `platform/platform-api/resources/messages/UIBundle.properties:1` ⇒ **本仓不画**（`window.confirm`
//     只有两个答案），也**不落任何存储键** ⇒ 下面「不许有死存储」那条钉住它。
//
// 反向验证（规则 §5）见 docs/batch-2026-10-06-execui2.md §4：
// 注入 ①「把 `allowRunningInParallel` 那条短路删掉」②「把闸挪到 `saveAll()` 之后」
// ③「把 closed 的实例滤掉」三种改法，下面分别有对应用例变红。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  RERUN_CONFIRMATION_DEFAULT, RERUN_CONFIRM_LABELS,
  needsRerunConfirmation, rerunConfirmationQuestion, runningSameConfigIds,
} from '../src/runRerunConfirm.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const inst = (id, label, running) => ({ id, label, running })

// ── 一、默认值 ────────────────────────────────────────────────────────────────────────────
test('上游那条开关默认是「要问」（intellij.platform.ide.impl.xml:1477 default="true"）', () => {
  assert.equal(RERUN_CONFIRMATION_DEFAULT, true,
    '默认必须是 true：默认不问就等于把上游这道闸摘了，用户按一下就杀掉自己正在跑的长任务')
})

// ── 二、三句文案的形状（能失败：文案缺一个 / 单复数不分档都会红） ──────────────────────────
test('文案三句各就各位，且正文的单复数真的分档', () => {
  // 标题 ≠ 正文：上游 title 是 `Process ''{0}'' Is Running`，body 是 `''{0}'' is not allowed to run in parallel…`
  assert.equal(RERUN_CONFIRM_LABELS.title('构建'), '进程『构建』正在运行')
  assert.match(RERUN_CONFIRM_LABELS.message('构建', 1), /不允许并行/)
  // `{1, choice, 1#the running one|2#{1, number} running instances}`：1 个时**不带数字**，>1 才数得出来
  assert.match(RERUN_CONFIRM_LABELS.message('构建', 1), /那一个/)
  assert.doesNotMatch(RERUN_CONFIRM_LABELS.message('构建', 1), /1 个/, '单数那一档不能出现「1 个」')
  assert.match(RERUN_CONFIRM_LABELS.message('构建', 3), /这 3 个正在运行的实例/, '复数那一档要把条数报出来')
  assert.notEqual(RERUN_CONFIRM_LABELS.message('构建', 1), RERUN_CONFIRM_LABELS.message('构建', 2),
    '两档写成同一句就是没实现 choice 分支')
  // 两颗按钮的文案（上游 OK = Stop and Rerun、Cancel = CommonBundle 的 Cancel）
  assert.equal(RERUN_CONFIRM_LABELS.stopAndRerun, '停止并重新运行')
  assert.equal(RERUN_CONFIRM_LABELS.cancel, '取消')
})

test('给 window.confirm 的那一句带标题、正文与两颗按钮的对应关系', () => {
  const question = rerunConfirmationQuestion('长任务', 1)
  // `commitChecks.ts:275` 同一条做法：浏览器确认框没有标题栏 ⇒ 标题在第一行。
  assert.ok(question.startsWith(RERUN_CONFIRM_LABELS.title('长任务')), '标题必须排在第一行')
  assert.ok(question.includes(RERUN_CONFIRM_LABELS.message('长任务', 1)), '正文要原样在句子里')
  // 「确定/取消」两个字必须解释清楚，否则用户不知道确定 = 停掉正在跑的那条（这是本仓少掉的那一半，
  // 上游那里是三颗按钮 + 一个勾选；只补语义，不假造控件）。
  assert.match(question, /确定 = 停止并重新运行/)
  assert.match(question, /取消 = 什么都不动/)
  assert.equal(rerunConfirmationQuestion('长任务', 2).includes('这 2 个正在运行的实例'), true)
})

// ── 三、哪些算「同一条配置还在跑」（上游 :962-973） ────────────────────────────────────────
test('已退出的不进、正在结束途中的仍进、别的配置不进、按起跑顺序', () => {
  const rows = [
    inst(7, '构建', true),      // 在跑
    inst(3, '构建', false),     // 已经退出 ⇒ 上游 `!isProcessTerminated` 把它挡在外面
    inst(9, '构建', true),      // 第二条在跑的（并行起跑过 or 前一条结束后又起）
    inst(5, '测试', true),      // 别的配置 ⇒ 不该被停
    inst(11, '', true),         // 无 label 的临时命令 ⇒ 不属于这条配置
  ]
  assert.deepEqual(runningSameConfigIds(rows, '构建'), [7, 9],
    '只报这条配置在跑的那几格，且按 id 升序（起跑顺序，上游 runningOfTheSameType.first() 取的就是这个序）')
  assert.deepEqual(runningSameConfigIds(rows, '测试'), [5])
  assert.deepEqual(runningSameConfigIds([], '构建'), [])
})

test('「视图已关但进程还在结束途中」的那格仍然在列（上游 :968 把 !isProcessTerminating 注释掉了）', () => {
  // RunConsole 标签上的 × 走 closeRunView：记录留着、`running` 到 run.exit 才落下（src/runInstances.ts 的 closed 字段）。
  // 这一格此刻仍然占着这条配置 ⇒ 按上游必须仍然问一句，不能因为标签不在了就当它不存在。
  const closing = { id: 4, label: '构建', running: true, closed: true }
  assert.deepEqual(runningSameConfigIds([closing], '构建'), [4],
    '正在结束途中的那格要进清单（读 runInstanceList() 会把它滤掉 ⇒ 这条会红）')
})

// ── 四、闸门本体：四档「不该问」+ 该问的形状 ───────────────────────────────────────────────
test('四档「不该问」逐条反证，第五档才真的要问（上游 :627-631）', () => {
  // ① 允许并行 ⇒ 两条并排跑是用户要的，绝不问。
  assert.equal(needsRerunConfirmation({ allowRunningInParallel: true, runningIds: [1, 2] }), false,
    '允许并行的配置每次都问一遍是骚扰')
  // ② 没有同名在跑 ⇒ 首跑/上一轮已退出 ⇒ 不问。
  assert.equal(needsRerunConfirmation({ allowRunningInParallel: false, runningIds: [] }), false)
  // ③ 用户把那条应用级开关关掉了（上游 :1099-1101 直接 return true = 放行）⇒ 不问。
  assert.equal(needsRerunConfirmation({ allowRunningInParallel: false, runningIds: [1], confirmationEnabled: false }), false)
  // ④ 只有一格、且新实例要复用的**就是它**（上游 `:630` 第三个条件）⇒ 停它不算意外，不问。
  assert.equal(needsRerunConfirmation({ allowRunningInParallel: false, runningIds: [6], contentToReuseId: 6 }), false)
  // 但「要复用的是别的那格」时仍然要问 —— 这一档把 ④ 与真值分开，否则 ④ 会退化成「有 contentToReuse 就不问」。
  assert.equal(needsRerunConfirmation({ allowRunningInParallel: false, runningIds: [6, 8], contentToReuseId: 6 }), true,
    '两格在跑时即使指定了复用哪一格，另一格仍要被停 ⇒ 照问')
  assert.equal(needsRerunConfirmation({ allowRunningInParallel: false, runningIds: [6], contentToReuseId: 8 }), true,
    '复用的那格不在这条配置的在跑清单里 ⇒ 照问')
  // 真的该问：不允许并行 + 有一格在跑 + 开关没关 + 没有复用目标（本仓生产路径的形状）。
  assert.equal(needsRerunConfirmation({ allowRunningInParallel: false, runningIds: [6] }), true)
  assert.equal(needsRerunConfirmation({ allowRunningInParallel: false, runningIds: [6], confirmationEnabled: true }), true)
})

test('问句里报的条数 = 宿主真会停的那几格（前端与宿主同一把尺子）', () => {
  // 本模块**不自己停实例**：停旧的是宿主在 `run.start` 里按 label 做的那一步
  // （native/run_host.cpp:363-365），所以这里只核「报给用户的条数」与「宿主配对到的条数」是不是同一批。
  // 少报 = 用户以为只停一条、实际停了两条；多报 = 吓得他不敢按。两种都是真的会错。
  const rows = [inst(2, '构建', true), inst(8, '构建', true), inst(5, '测试', true), inst(9, '构建', false)]
  const ids = runningSameConfigIds(rows, '构建')
  assert.deepEqual(ids, [2, 8])
  const question = rerunConfirmationQuestion('构建', ids.length)
  assert.ok(question.includes('这 2 个正在运行的实例'), `条数要真是 ${ids.length}，实际句子：${question}`)
  // 宿主配对的口径：同 label 且还在跑的那些 = [2, 8]，不含别的配置、也不含已退出的那条。
  const hostMatched = rows.filter(row => row.label === '构建' && row.running).map(row => row.id)
  assert.deepEqual(hostMatched, ids, '前端算出的那几格必须就是宿主会停的那几格')
  // 允许并行时宿主根本不停（`!allow_parallel` 那半条），前端也就一律不问 ⇒ 上面 ① 那档不是怕骚扰，是这条对齐。
  assert.equal(needsRerunConfirmation({ allowRunningInParallel: true, runningIds: ids }), false)
})

// ── 五、生产消费方：这道闸真的在 startRun 里、且位置对 ──────────────────────────────────────
test('startRun 真的问在发出 run.start 之前，而且排在 saveAll() 之前', () => {
  const actions = read('src/runActions.ts')
  // 只看 startRun 这一段的正文：`run.start` 这个词在同文件的 `runToExit`（before-launch 用的那条通道）里
  // 也出现，用全文件的 indexOf 会先撞上它，那条顺序判据就成了假的。
  const body = actions.slice(actions.indexOf('async function startRun('), actions.indexOf('async function runSelectedConfig('))
  assert.ok(body.length > 200 && body.includes('startRun'), 'startRun 的正文要取得到')
  assert.match(body, /needsRerunConfirmation\(/, 'startRun 要调这道闸，不然是死模块')
  assert.match(body, /runningSameConfigIds\(/, '在跑的清单要从实例表算，不能在组件里各数一遍')
  // 取的是**原始表**而不是 `runInstanceList()`：那份清单会把 `closed`（标签已摘、进程还在结束途中）的滤掉，
  // 于是「× 掉一个正在收尾的实例后再按运行」会不问一句直接杀掉另一格 —— 上游 `:968` 恰恰把这半条注释掉了。
  assert.match(body, /runningSameConfigIds\(\[\.\.\.runInstances\.values\(\)\], config\.name\)/,
    '这道闸要读 runInstances 原始表；换成 runInstanceList() 就把「还在收尾的那格」漏掉了')
  const gateCall = body.slice(body.indexOf('runningSameConfigIds('), body.indexOf('\n', body.indexOf('runningSameConfigIds(')))
  assert.doesNotMatch(gateCall, /runInstanceList\(\)/, '这道闸不许用 runInstanceList()（它滤 closed）')
  assert.match(body, /window\.confirm\(rerunConfirmationQuestion\(/, '问要用本仓既有的确认通道')
  const gate = body.indexOf('needsRerunConfirmation({')
  const save = body.indexOf('await saveAll()')
  const start = body.indexOf("'run.start'")
  assert.ok(gate > 0 && save > 0 && start > 0, `三处都要在（gate=${gate}, save=${save}, start=${start}）`)
  // 闸必须在 saveAll 之前：答「取消」时不该已经把用户的东西写到盘上。
  assert.ok(gate < save, '这道闸必须排在 saveAll() 之前（取消时不留副作用）')
  assert.ok(gate < start, '这道闸必须排在发出 run.start 之前（停旧实例就是宿主在 run.start 里做的）')
  // 取消时返回 null —— 与同函数里其它「没起来」的出口同一形状（runCompound 的 start 认 `?? null`）。
  assert.match(body, /window\.confirm\(rerunConfirmationQuestion\(config\.name, runningSame\.length\)\)\) return null/,
    '答「取消」要当场 return null')
})

test('读的是这条配置的 allowRunningInParallel，缺省按上游 false（RunConfigurationOptions.kt:56）', () => {
  const actions = read('src/runActions.ts')
  assert.match(actions, /allowRunningInParallel: config\.allowRunningInParallel === true/,
    '「=== true」才为真：老配置没这个键 ⇒ 不允许并行 ⇒ 要问（与 runStartParams 的 `params.allowParallel` 同一把尺子）')
  // 前端判定与宿主停机必须同一把尺子：宿主按 label 配对停机。
  const host = read('native/run_host.cpp')
  assert.match(host, /if \(!allow_parallel && !label\.empty\(\)\)/,
    '宿主确实是「不允许并行才停同名」⇒ 前端只在同一条件下问')
  assert.match(host, /existing->label == label/, '宿主停的是 label 相同的实例 ⇒ runningSameConfigIds 也按 label 配对')
})

test('不许给这条闸配一份没有写入方的存储（execui 那条「两个真源」判决的同一把尺子）', () => {
  const source = read('src/runRerunConfirm.ts')
  // 「以后不再显示」那个勾选要的是应用级开关，本仓现在没有能改它的面 ⇒ 只做成入参。
  // 存了却没人写 = 死存储，正是要避免的那个形状（见 src/runStartupFocus.ts 头部的判决段）。
  for (const retired of ['localStorage', 'setItem', 'getItem', 'sessionStorage']) {
    assert.ok(!source.includes(retired), `src/runRerunConfirm.ts 现在不该碰存储（出现「${retired}」= 造了没人写的键）`)
  }
  assert.match(source, /RERUN_CONFIRMATION_DEFAULT = true/, '默认值要写成常数并由入参承接，而不是落一份存储')
})
