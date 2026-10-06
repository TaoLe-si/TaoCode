// 运行实例列表的**行模型**与**多实例停止/命名/归属**判定（exec/run-instances 家族）。
//
// 上游依据（每条判据都对着本机那份树里亲自打开过的行号）：
//   · `platform/execution/src/com/intellij/execution/ui/RunContentDescriptor.java:116-123`、`:218-220`
//     —— 标题 = `profile.getName()`（`descriptor.getDisplayName()`），**同名不消歧**；
//   · `platform/execution-impl/src/com/intellij/execution/ui/RunContentManagerImpl.kt:312`、`:361-366`、
//     `:369-376`、`:389-405`、`:432-435` —— content 标题、live 角标、pid 描述、结束时置灰并清描述、
//     新起一条切选中；
//   · `platform/execution/resources/messages/ExecutionBundle.properties:204`（`process.id.tooltip`）、
//     `:208`（`stop.configuration.action.name`）、`:209`（`stop.all`）、`:491-492`（两个弹层标题）、
//     `:203`+`:529`（Kill process）；
//     `platform/platform-resources-en/src/messages/ActionsBundle.properties:941-942`（`action.Stop`）；
//   · `platform/execution-impl/src/com/intellij/execution/actions/StopAction.java:73-128`、`:141-179`、
//     `:199`、`:213-215`、`:279-290`、`:293-315`；
//     `platform/execution-impl/src/com/intellij/execution/ui/RunToolbarPopup.kt:752-758`；
//     `platform/execution-impl/src/com/intellij/execution/StoppableRunDescriptors.kt:17-63`；
//   · `platform/execution-impl/src/com/intellij/execution/impl/ConsoleBuffer.java:8-22` +
//     `platform/lang-impl/src/com/intellij/execution/impl/ConsoleViewImpl.kt:186-187` —— 控制台缓冲按**字符**有界；
//   · 一条 descriptor 一个 ConsoleView（`RunContentManagerImpl.kt:308-312`）⇒ 输出的分块残段只属于自己那个实例。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  activeRunInstance,
  chooseReuseInstance,
  closeRunView,
  consoleBufferChars,
  decodeRunChunk,
  flushRunDecoder,
  HOST_CAN_KILL_PROCESS,
  handleRunExit,
  handleRunOutput,
  handleRunStarted,
  instanceStoppable,
  markRunInstanceStopping,
  resolveStopActionTargets,
  RUN_CONSOLE_BUFFER_LIMIT_CHARS,
  RUN_OUTPUT_LIMIT,
  runConsoleEncoding,
  runInstanceExitText,
  runInstanceRows,
  runInstanceStatusText,
  runInstanceState,
  runInstanceTabDescription,
  runInstances,
  runInstanceList,
  runOutput,
  runningListRows,
  setRunConsoleEncoding,
  stopActionState,
  stopChooserItems,
  stopCounterText,
  stoppableCandidates,
  STOP_LABELS,
} from '../src/runInstances.ts'
import { runDashboardRows } from '../src/runDashboard.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

/** 字节 → 宿主回传的形状（base64 字符串）。 */
const b64 = bytes => Buffer.from(bytes).toString('base64')
/** UTF-8 下「中」= E4 B8 AD（三个字节：从中间劈开才能测分块残段的归属）。 */
const UTF8_ZHONG = new Uint8Array(Buffer.from('中', 'utf-8'))
/** GBK 下「中」= D6 D0、「文」= CE C4（Node 的 Buffer 编不了 GBK，这里用字面字节，并有 round-trip 断言核住）。 */
const GBK_ZHONG = new Uint8Array([0xd6, 0xd0])
const GBK_WEN = new Uint8Array([0xce, 0xc4])

function reset() {
  runInstances.clear()
  activeRunInstance.value = 0
  runOutput.splice(0, runOutput.length)
  if (runConsoleEncoding.value !== 'utf-8') setRunConsoleEncoding('utf-8')
}

// ── 行模型：谁在跑、谁被选中、退出码、描述 ──────────────────────────────────────────────────

test('行模型给得上游那几格：选中/存活/退出码/状态（RunContentManagerImpl.kt:361-366、:389-405）', () => {
  reset()
  handleRunStarted({ instance: 3, label: '服务端' })
  handleRunOutput(3, 'hello')
  handleRunStarted({ instance: 5, label: '' })
  handleRunExit({ instance: 5, code: 0 })
  const rows = runInstanceRows(activeRunInstance.value)
  assert.deepEqual(rows.map(row => row.id), [3, 5], '按起跑顺序（id 升序），与标签条同一口径')
  assert.deepEqual(rows.map(row => row.title), ['服务端', '运行 2'], '有名用名、无名按起跑序号')
  assert.deepEqual(rows.map(row => row.active), [false, true], '起跑的那条把选中切了过去（:432-435）')
  assert.deepEqual(rows.map(row => row.running), [true, false])
  assert.deepEqual(rows.map(row => row.live), [true, false], 'live = 上游那个 live 角标')
  assert.deepEqual(rows.map(row => row.dimmed), [false, true], '结束那一档置灰（:401）')
  assert.deepEqual(rows.map(row => row.state), ['running', 'ok'])
  assert.deepEqual(rows.map(row => row.statusText), ['正在运行', '已完成'])
  assert.deepEqual(rows.map(row => row.exit), [null, 0])
  assert.deepEqual(rows.map(row => row.exitText), ['', 'exit 0'], '在跑的那格没有退出码徽标（RunConsole.vue:119-121 今天的形状）')
  assert.equal(runOutput.length, 1, '选中的是 5 ⇒ 镜像换成它的：只有那条结束提示')
  assert.match(runOutput[0], /进程已结束/)
  assert.equal(runOutput.includes('hello'), false, '3 的缓冲留在自己那一格，不进当前镜像')
  assert.deepEqual([...runInstances.get(3).output], ['hello'])
})

test('标签描述是 pid 那一句，只有活着的时候才有（ExecutionBundle.properties:204 + :369-376 + :402）', () => {
  reset()
  handleRunStarted({ instance: 11, label: 'app' })
  assert.equal(runInstanceTabDescription({ running: true, pid: 0 }), '', '还没问到 pid ⇒ 空串，宿主那一行不渲染')
  assert.equal(runInstanceRows(0).find(row => row.id === 11).tabDescription, '')
  runInstances.get(11).pid = 4321
  assert.equal(runInstanceTabDescription({ running: true, pid: 4321 }), '进程 ID：4321')
  assert.equal(runInstanceRows(0).find(row => row.id === 11).tabDescription, '进程 ID：4321')
  assert.equal(runInstanceTabDescription({ running: false, pid: 4321 }), '', '进程结束时上游把描述清掉（:402）')
  assert.equal(runInstanceRows(0).find(row => row.id === 11).tabDescription, '进程 ID：4321', '记录还在跑 ⇒ 描述还在')
})

test('同名实例标题不消歧，只标 duplicateTitle（上游没有 #2 那种后缀）', () => {
  reset()
  handleRunStarted({ instance: 21, label: '同一个配置' })
  handleRunStarted({ instance: 22, label: '同一个配置' })
  const rows = runInstanceRows(0)
  assert.deepEqual(rows.map(row => row.title), ['同一个配置', '同一个配置'], '两条同名 ⇒ 都写配置名')
  assert.deepEqual(rows.map(row => row.duplicateTitle), [true, true])
  rows.forEach(row => { assert.equal(row.tabDescription, '', '没有 pid 时不编造区分信息') })
  handleRunExit({ instance: 21, code: 0 })
  assert.deepEqual(runInstanceRows(0).map(row => row.duplicateTitle), [true, true], '已结束的那格标签还在（上游也是两条同名 content 并存）')
  closeRunView(21)
  assert.deepEqual(runInstanceRows(0).map(row => row.duplicateTitle), [false], '摘掉一格 ⇒ 剩下的那条不再同名')
})

test('无名实例在标签条与「正在运行」清单里是同一个名字（上游读的是同一个 getDisplayName()）', () => {
  reset()
  handleRunStarted({ instance: 31, label: '甲' })
  handleRunStarted({ instance: 32, label: '' })
  handleRunStarted({ instance: 33, label: '' })
  handleRunExit({ instance: 32, code: 0 })
  const listNames = new Map(runInstanceRows(0).map(row => [row.id, row.title]))
  for (const row of runningListRows(0)) {
    assert.equal(row.name, listNames.get(row.id), `实例 ${row.id} 在清单里的名字必须等于标签上的名字`)
  }
  assert.deepEqual(runInstanceRows(0).map(row => row.title), ['甲', '运行 2', '运行 3'])
  assert.deepEqual(runningListRows(0).map(row => row.id), [31, 33], '清单只列在跑的')
})

// ── 停止这一格可不可点（StopAction.java:310-315） ─────────────────────────────────────────

test('stoppable：在跑可停；正在结束途中仍可停并换成 Kill process（:106-110）', () => {
  reset()
  handleRunStarted({ instance: 41, label: '长驻' })
  let row = runInstanceRows(0).find(item => item.id === 41)
  assert.equal(row.stoppable, true)
  assert.equal(row.kill, false)
  markRunInstanceStopping(41)
  row = runInstanceRows(0).find(item => item.id === 41)
  assert.equal(row.stoppable, HOST_CAN_KILL_PROCESS, '宿主 run.stop 走 TerminateJobObject ⇒ 一定杀得掉，仍可点')
  assert.equal(row.kill, true, '这一档上游把图标换成 KillProcess，文案 Kill process')
  handleRunExit({ instance: 41, code: -1, aborted: true })
  row = runInstanceRows(0).find(item => item.id === 41)
  assert.equal(row.stoppable, false, '已结束的那条不可停（:312 的 isProcessTerminated）')
  assert.equal(row.state, 'stopped')
  assert.equal(instanceStoppable({ running: false, stopping: false }, true), false)
  assert.equal(instanceStoppable({ running: true, stopping: true }, false), false, '杀不掉时正在结束的那条不可点（:313-314 的右半边不成立）')
})

test('可停清单：只收在跑的、新起的排最前（StoppableRunDescriptors.kt:19、:24-26）', () => {
  reset()
  handleRunStarted({ instance: 51, label: '先起的' })
  handleRunStarted({ instance: 52, label: '后起的' })
  handleRunStarted({ instance: 53, label: '已经跑完' })
  handleRunExit({ instance: 53, code: 1 })
  assert.deepEqual(stoppableCandidates(runInstanceRows(0)).map(row => row.id), [52, 51])
  assert.deepEqual(stoppableCandidates(runInstanceRows(0)).map(row => row.title), ['后起的', '先起的'])
})

// ── 多实例并存时「停止」的装配（StopAction.update / actionPerformed） ─────────────────────────

test('一条都没有：不可点；新 UI 运行工具条那一格整格不见（:79-86）', () => {
  reset()
  const empty = stopActionState(runInstanceRows(0), 'global')
  assert.equal(empty.enabled, false)
  assert.equal(empty.visible, true, '主菜单/主工具栏那两处仍然显示，只是点不动（:125）')
  const newUi = stopActionState(runInstanceRows(0), 'newUiRunToolbar')
  assert.equal(newUi.enabled, false)
  assert.equal(newUi.visible, false, '`presentation.setEnabledAndVisible(false)`（:83-86）')
  assert.equal(newUi.badge, '')
  assert.deepEqual(resolveStopActionTargets(runInstanceRows(0), false), { popup: false, ids: [] })
})

test('恰好一条：文案是「停止『名字』」，不弹层（:93-97、:141-143）', () => {
  reset()
  handleRunStarted({ instance: 61, label: '服务端' })
  const state = stopActionState(runInstanceRows(0), 'global')
  assert.equal(state.enabled, true)
  assert.equal(state.text, '停止『服务端』')
  assert.equal(state.text, STOP_LABELS.one('服务端'))
  assert.equal(state.popup, false)
  assert.equal(state.badge, '')
  assert.deepEqual(state.stoppableIds, [61])
  assert.deepEqual(resolveStopActionTargets(runInstanceRows(0), false), { popup: false, ids: [61] })
})

test('多条：文案加省略号 + 计数角标，点击是弹选择器（:88-92、:152-181）', () => {
  reset()
  handleRunStarted({ instance: 71, label: '甲' })
  handleRunStarted({ instance: 72, label: '乙' })
  handleRunStarted({ instance: 73, label: '丙' })
  const state = stopActionState(runInstanceRows(0), 'global')
  assert.equal(state.text, '停止…')
  assert.equal(state.badge, '3')
  assert.equal(state.popup, true)
  assert.deepEqual(state.stoppableIds, [73, 72, 71], '新起在前（asReversed）')
  const chooser = stopChooserItems(stoppableCandidates(runInstanceRows(0)), 72, 'Ctrl+F2')
  assert.deepEqual(chooser.items.map(item => item.text), ['停止『丙』', '停止『乙』', '停止『甲』', '停止全部（Ctrl+F2）'])
  assert.deepEqual(chooser.items.map(item => item.kind), ['instance', 'instance', 'instance', 'stopAll'])
  assert.deepEqual(chooser.items.map(item => item.selected), [false, true, false, false], '预选中当前视图那一条（:213-215 + :279-290）')
  assert.equal(chooser.title, '停止进程', '`stop.process`（ExecutionBundle.properties:491）')
})

test('弹层标题的两档 + 「再点一次 = 停全部」（:199、:169-174）', () => {
  reset()
  handleRunStarted({ instance: 81, label: '甲' })
  const single = stopChooserItems(stoppableCandidates(runInstanceRows(0)), 81)
  assert.equal(single.items.length, 1, '一条时上游根本不追加 stopAll 那一条（:177-179）')
  assert.equal(single.title, '确认停止进程', '`confirm.process.stop`（:492）')
  assert.equal(single.items[0].text, '停止『甲』')
  handleRunStarted({ instance: 82, label: '乙' })
  assert.deepEqual(resolveStopActionTargets(runInstanceRows(0), true), { popup: false, ids: [82, 81] }, '弹层开着再点 ⇒ 停全部并收起')
  assert.deepEqual(resolveStopActionTargets(runInstanceRows(0), false), { popup: true, ids: [] })
  const two = stopChooserItems(stoppableCandidates(runInstanceRows(0)), 0)
  assert.equal(two.items[two.items.length - 1].text, '停止全部', '宿主没给键位文本时不编括号（Stop All ({0}) 的 {0} 来自键表）')
  assert.equal(two.items[0].text, '停止『乙』', '新起的那一条排最前')
  assert.equal(two.title, '停止进程')
})

test('计数角标在新 UI 工具条超过 9 条收成 9+（RunToolbarPopup.kt:752-758）', () => {
  assert.equal(stopCounterText(0, 'global'), '')
  assert.equal(stopCounterText(9, 'newUiRunToolbar'), '9')
  assert.equal(stopCounterText(10, 'newUiRunToolbar'), '9+')
  assert.equal(stopCounterText(10, 'global'), '10', '主工具栏那一处不收成 9+')
})

test('本地位置（工具窗口里那一格）读选中的那条，正在结束时刻出现 Kill process（:99-111）', () => {
  reset()
  handleRunStarted({ instance: 91, label: '甲' })
  handleRunStarted({ instance: 92, label: '乙' })
  markRunInstanceStopping(92)
  const state = stopActionState(runInstanceRows(0), 'local', 92)
  assert.equal(state.enabled, true)
  assert.equal(state.kill, true)
  assert.equal(state.description, STOP_LABELS.kill, '`action.terminating.process.progress.kill.description`（:529）')
  assert.equal(state.text, '停止『乙』')
  assert.equal(state.popup, false, '工具窗口那一格只停当前视图，不弹层（:222-228）')
  const other = stopActionState(runInstanceRows(0), 'local', 91)
  assert.equal(other.kill, false)
  assert.equal(other.description, STOP_LABELS.description, '`action.Stop.description=Stop the process`（ActionsBundle.properties:942）')
})

// ── 内存那一格：控制台缓冲（ConsoleBuffer.java:8-22 + ConsoleViewImpl.kt:186-187） ────────────

test('缓冲按字符计、上限是上游那个 1024 KB，行数上限命中算截断', () => {
  assert.equal(RUN_CONSOLE_BUFFER_LIMIT_CHARS, 1024 * 1024, '`idea.cycle.buffer.size` 默认 1024(KB) × 1024')
  assert.equal(consoleBufferChars([]), 0)
  assert.equal(consoleBufferChars(['abc', 'de']), 7, '每行再加一个换行')
  reset()
  handleRunStarted({ instance: 101, label: '刷屏' })
  const record = runInstances.get(101)
  for (let index = 0; index < 10; index++) handleRunOutput(101, 'x'.repeat(20))
  let row = runInstanceRows(0).find(item => item.id === 101)
  assert.equal(row.bufferChars, 10 * 21, '缓冲占用 = 内容字符数 + 换行')
  assert.equal(row.bufferLimitChars, RUN_CONSOLE_BUFFER_LIMIT_CHARS)
  assert.equal(row.truncated, false)
  record.output.splice(0, record.output.length, ...Array.from({ length: RUN_OUTPUT_LIMIT }, () => 'y'))
  row = runInstanceRows(0).find(item => item.id === 101)
  assert.equal(row.truncated, true, '撞到行数上限就是「已经截过头」')
})

// ── 同名结束格的复用判定（RunContentManagerImpl.kt:788-826 + canReuseContent:854-856） ──────────

test('复用的条件：已结束 + 未钉住 + 不是同一次执行；同名优先、选中那格先查', () => {
  const rows = [
    { id: 1, title: '甲', running: false },
    { id: 2, title: '乙', running: true },
    { id: 3, title: '乙', running: false },
    { id: 4, title: '丙', running: false, pinned: true },
  ]
  assert.equal(chooseReuseInstance(rows, '乙', 9), 3, '名字匹配优先（:810-813 + :839-846）')
  assert.equal(chooseReuseInstance(rows, '没有这个名字', 9), 1, '否则取第一个「好」的（:848-851）')
  assert.equal(chooseReuseInstance(rows, '乙', 3), 1, '同一次执行的那格不复用（:855）')
  assert.equal(chooseReuseInstance(rows, '丙', 9), 1, '钉住的格不参与（:855 的 !isPinned）')
  const selectedFirst = [
    { id: 5, title: '甲', running: false },
    { id: 6, title: '甲', running: false },
  ]
  assert.equal(chooseReuseInstance(selectedFirst, '甲', 9, 6), 6, '选中的那格先查（:834-838）')
  assert.equal(chooseReuseInstance([{ id: 7, title: '甲', running: true }], '甲', 9), null, '全都在跑 ⇒ 新建一格')
})

// ── 控制台内容按实例归属：解码残段不串台 ─────────────────────────────────────────────────────

test('两个实例的分块交错时，半个字符只等它自己那个实例（上游：一条 descriptor 一个控制台）', () => {
  reset()
  handleRunStarted({ instance: 201, label: '甲' })
  handleRunStarted({ instance: 202, label: '乙' })
  assert.deepEqual([...UTF8_ZHONG], [0xe4, 0xb8, 0xad], '「中」是三个字节，第一块只给第一个')
  assert.equal(decodeRunChunk(b64(UTF8_ZHONG.subarray(0, 1)), 201), '', '甲的第一块不完整 ⇒ 不吐出任何文本')
  assert.equal(decodeRunChunk(b64(Buffer.from('OK', 'utf-8')), 202), 'OK', '乙的完整分块不受甲的残段影响')
  handleRunOutput(202, 'OK')
  assert.equal(decodeRunChunk(b64(UTF8_ZHONG.subarray(1)), 201), '中', '甲的下一块把残段补齐')
  handleRunOutput(201, '中')
  assert.deepEqual([...runInstances.get(201).output], ['中'])
  assert.deepEqual([...runInstances.get(202).output], ['OK'], '两格内容各自归属，没有串台')
  assert.deepEqual([...runOutput], ['OK'], '当前实例是 202 ⇒ 镜像只有它的行')
})

test('不带实例 id 的分块走全局解码器（桥接层今天的形状，行为与拆之前一致）', () => {
  reset()
  handleRunStarted({ instance: 211, label: '甲' })
  assert.equal(decodeRunChunk(b64(Buffer.from('普通输出', 'utf-8'))), '普通输出')
  assert.equal(decodeRunChunk(b64(UTF8_ZHONG.subarray(0, 2))), '', '不带 id 的残段照样留在全局解码器里')
  assert.equal(decodeRunChunk(b64(UTF8_ZHONG.subarray(2))), '中', '下一块补齐，仍走全局那条')
})

test('带实例 id 的退出只冲它自己的残段，别人的残段不动', () => {
  reset()
  handleRunStarted({ instance: 301, label: '甲' })
  handleRunStarted({ instance: 302, label: '乙' })
  assert.equal(decodeRunChunk(b64(UTF8_ZHONG.subarray(0, 1)), 301), '', '甲留了半个字')
  assert.equal(decodeRunChunk(b64(Buffer.from('OK', 'utf-8'))), 'OK', '不带 id 的分块走全局解码器')
  handleRunExit({ instance: 302, code: 0 })
  assert.equal(runInstances.get(301).output.length, 0, '乙的退出不会把甲的残段写进任何一格')
  assert.ok(runInstances.get(302).output.length > 0, '乙那条有自己的结束提示（src/processTerminated.ts）')
  assert.equal(flushRunDecoder(302), '', '乙没有自己的残段')
  assert.equal(decodeRunChunk(b64(UTF8_ZHONG.subarray(1)), 301), '中', '甲的下一块到了才补齐')
})

test('切换控制台编码时，每个实例的残段写回它自己的控制台，不是写进当前实例', () => {
  reset()
  handleRunStarted({ instance: 401, label: '甲' })
  handleRunStarted({ instance: 402, label: '乙' })
  handleRunOutput(402, decodeRunChunk(b64(Buffer.from('OK', 'utf-8')), 402))
  assert.equal(decodeRunChunk(b64(UTF8_ZHONG.subarray(0, 1)), 401), '', '甲留了半个字')
  assert.equal(activeRunInstance.value, 402, '当前实例是乙')
  setRunConsoleEncoding('gbk')
  assert.equal(runConsoleEncoding.value, 'gbk')
  assert.deepEqual([...runInstances.get(402).output], ['OK'], '乙已有的内容一个字也不动（残留不写进当前实例）')
  assert.equal(runInstances.get(401).output.length, 1, '甲的残段按**旧编码**冲出来，写回甲这一格')
  assert.equal(runInstances.get(401).output[0], '\uFFFD', '不完整序列就是替换字符（不假装能救回来）')
  assert.equal(decodeRunChunk(b64(GBK_ZHONG), 402), '中', '换完之后按新编码解')
  assert.equal(decodeRunChunk(b64(GBK_WEN), 402), '文')
  setRunConsoleEncoding('utf-8')
})

test('GBK 字面字节的 round-trip（上一条用的字节必须真的是「中文」）', () => {
  assert.equal(new TextDecoder('gbk').decode(new Uint8Array([...GBK_ZHONG, ...GBK_WEN])), '中文')
})

test('实例记录被忘掉后它的解码器一起丢；id 被复用时不从上一轮残段接着拼', () => {
  reset()
  handleRunStarted({ instance: 601, label: '甲' })
  assert.equal(decodeRunChunk(b64(UTF8_ZHONG.subarray(0, 1)), 601), '', '留了半个字')
  handleRunExit({ instance: 601, code: 0 })
  assert.equal(flushRunDecoder(601), '', '退出时甲的残段已冲掉、解码器已丢')
  runInstances.clear()
  handleRunStarted({ instance: 601, label: '甲' })
  assert.equal(decodeRunChunk(b64(UTF8_ZHONG), 601), '中', '同一个 id 再起跑 ⇒ 状态是干净的')
})

// ── 与既有模型的口径一致 + 消费链锚点 ────────────────────────────────────────────────────────

test('状态四档与运行仪表盘同一个规则（src/runDashboard.ts:69-84），两处不能各说一遍', () => {
  const inputs = [
    { id: 1, label: '甲', running: true, exit: null, startedAt: 0, pid: 0 },
    { id: 2, label: '乙', running: false, exit: 0, startedAt: 0, pid: 0 },
    { id: 3, label: '丙', running: false, exit: 1, startedAt: 0, pid: 0 },
    { id: 4, label: '丁', running: false, exit: -1, startedAt: 0, pid: 0 },
  ]
  const dash = runDashboardRows(inputs, 0)
  assert.deepEqual(dash.map(row => row.state), ['running', 'ok', 'failed', 'stopped'])
  inputs.forEach((input, index) => {
    const state = runInstanceState(input.running, input.exit)
    assert.equal(state, dash[index].state, `第 ${index + 1} 行的档位必须与仪表盘一致`)
    assert.equal(runInstanceStatusText(state, input.exit), dash[index].statusText, '文案也必须一致')
  })
})

test('行模型不是只过自己测试的死代码：清单从它投影，判定函数都在模块里被调用', () => {
  const source = read('src/runInstances.ts')
  assert.match(source, /export function runningListRows[\s\S]{0,260}runInstanceRows\(/, '「正在运行」清单是行模型的一个投影')
  assert.match(source, /stoppable: instanceStoppable\(instance\)/)
  assert.match(source, /tabDescription: runInstanceTabDescription\(instance\)/)
  assert.match(source, /exitText: runInstanceExitText\(instance\)/)
  assert.match(source, /badge: stopCounterText\(count, place\)/)
  assert.match(source, /truncated: instance\.output\.length >= RUN_OUTPUT_LIMIT/)
})

test('解码器确实按实例分（模块里那张 Map 是唯一事实来源）', () => {
  const source = read('src/runInstances.ts')
  assert.match(source, /const instanceDecoders = new Map<number, TextDecoder>\(\)/)
  assert.match(source, /function decoderFor\(instance: number\)/)
  assert.match(source, /export function decodeRunChunk\(dataB64: string, instance\?: number\)/)
  assert.match(source, /export function flushRunDecoder\(instance\?: number\)/)
  assert.match(source, /instanceDecoders\.delete\(id\)/, '记录被忘掉时解码器一起丢')
  assert.match(source, /for \(const \[instance, own\] of instanceDecoders\)/, '换编码时逐实例冲残段')
  // 桥接层已把 instance 传给两个解码入口（docs/wiring-requests-2026-10-06-runinst.md R1 已落）：
  // 不传就会让甲的残段拼到乙的下一块前面（两个实例交错 = 内容跑错标签 + 乱码）。
  const bridge = read('src/bridge.ts')
  assert.match(bridge, /decodeRunChunk\(data\.dataB64, typeof data\.instance === 'number' \? data\.instance : undefined\)/)
  assert.match(bridge, /flushRunDecoder\(typeof data\.instance === 'number' \? data\.instance : undefined\)/)
})

test('关闭视图后标签条不列它，但行模型还在（清单看的是"还在不在跑"）', () => {
  reset()
  handleRunStarted({ instance: 501, label: '窗口' })
  handleRunStarted({ instance: 502, label: '窗口' })
  closeRunView(501)
  assert.deepEqual(runInstanceList().map(row => row.id), [502], '标签条不再列它')
  const rows = runInstanceRows(0)
  assert.deepEqual(rows.map(row => row.id), [501, 502], '记录留到 run.exit ⇒ 行模型还在')
  assert.deepEqual(rows.map(row => row.title), ['窗口', '窗口'])
  assert.deepEqual(rows.map(row => row.kill), [true, false])
  assert.deepEqual(runningListRows(0).map(row => row.id), [501, 502])
  assert.deepEqual(runningListRows(0).map(row => row.icon), ['kill', 'run'])
})
