// Run 工具窗口的**视图动作族**（上游 `RunnerLayoutActions`）。
//
// 覆盖两件事：
//   1. 判定语义（`src/runToolWindowLayout.ts` 的纯函数）—— 逐条对齐上游的 `update`/`isEnabled`
//      与 `isAccepted`：`CloseViewsActionBase.java:17-20/23-31/32-38`、`CloseViewAction.java:58-60`、
//      `CloseOtherViewsAction.java:27-29`、`CloseAllViewsAction.java:27-33`、
//      `CloseAllUnpinnedViewsAction.java:27-32`、`ToggleShowTabLabelsAction.java:22-44`。
//   2. 关闭语义（`src/runInstances.ts` 的 `closeRunView`）—— 标签立刻摘掉，记录等 `run.exit` 才删，
//      晚到的事件不会把视图"复活"；已结束的视图当场删。
// 外加「标签页标题默认隐藏」这条上游默认值（`RunnerLayout.java:295`）与接线核对。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  RUNNER_VIEW_ACTION_ORDER, RUNNER_VIEW_ACTIONS_NOT_PORTED, TAB_LABELS_HIDDEN_DEFAULT,
  readRunTabLabelsHidden, runnerViewActionRows, viewsToClose, writeRunTabLabelsHidden,
} from '../src/runToolWindowLayout.ts'
import {
  activeRunInstance, closeRunView, focusRunInstance, handleRunExit, handleRunOutput,
  handleRunStarted, runInstances, runInstanceList, runOutput,
} from '../src/runInstances.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

// 上游一个 `Content` = 本仓一个运行实例；`extra` 用来造 pinned / 不可关那两种 Content 状态。
const view = (id, extra = {}) => ({ id, closeable: true, ...extra })
const enabled = rows => Object.fromEntries(rows.map(row => [row.id, row.enabled]))
// `runInstances` 是模块级单例（同进程内几个用例共用），每个用例先清空再断言。
const own = () => runInstanceList().map(instance => instance.id)
function resetInstances() {
  for (const instance of [...runInstances.values()]) {
    instance.running = false
    closeRunView(instance.id)
  }
}

test('判定：单个视图时只有 ToggleTabLabels 与 CloseView 可用', () => {
  const rows = runnerViewActionRows([view(1)], 1)
  assert.deepEqual(enabled(rows), {
    'Runner.ToggleTabLabels': true,
    'Runner.CloseView': true,
    'Runner.CloseOtherViews': false,   // CloseOtherViewsAction: 除了选中的就没有别的可关
    'Runner.CloseAllViews': false,     // CloseAllViewsAction.java:27-33 要「多于一个」
    'Runner.CloseAllUnpinnedViews': false,
  })
})

test('判定：CloseView 只在「恰好选中一个可关视图」时可用', () => {
  // CloseViewAction.java:58-60 —— content.length == 1 && content[0].isCloseable()
  assert.equal(enabled(runnerViewActionRows([view(1)], null))['Runner.CloseView'], false, '没有选中就没有可关的那个')
  assert.equal(enabled(runnerViewActionRows([view(1, { closeable: false })], 1))['Runner.CloseView'], false,
    '选中的那个不可关时不可用')
  assert.equal(enabled(runnerViewActionRows([view(1, { closeable: false }), view(2)], 1))['Runner.CloseView'], false)
  // 不可关的那一个不算「其他视图」（CloseViewsActionBase.java:26 的 closeable 条件）。
  assert.equal(enabled(runnerViewActionRows([view(1), view(2, { closeable: false })], 1))['Runner.CloseOtherViews'], false)
  assert.equal(enabled(runnerViewActionRows([view(1), view(2, { closeable: false })], 1))['Runner.CloseAllViews'], false,
    'CloseAllViewsAction 只数可关的，一个不可关的不算第二个')
  assert.equal(enabled(runnerViewActionRows([view(1), view(2, { closeable: false }), view(3)], 1))['Runner.CloseAllViews'], true,
    '两个可关的就够（1 与 3）')
})

test('判定：两个视图时 CloseOtherViews / CloseAllViews 都可用', () => {
  const rows = runnerViewActionRows([view(1), view(2)], 2)
  assert.equal(enabled(rows)['Runner.CloseOtherViews'], true)
  assert.equal(enabled(rows)['Runner.CloseAllViews'], true)
})

test('判定：Runner.CloseAllUnpinnedViews 按上游恒不可用，并给出原因', () => {
  // CloseAllUnpinnedViewsAction.java:27-32：一个 pinned 都没有就直接 false。
  const withoutPinned = runnerViewActionRows([view(1), view(2)], 1)
    .find(row => row.id === 'Runner.CloseAllUnpinnedViews')
  assert.equal(withoutPinned?.enabled, false)
  assert.match(withoutPinned?.reason ?? '', /pinned=false/, '禁用必须写明为什么不能点')

  // 有 pinned 时才按「有可关且未固定的」判（isAccepted = !c.isPinned()）。
  const withPinned = runnerViewActionRows([view(1, { pinned: true }), view(2)], 1)
  assert.equal(enabled(withPinned)['Runner.CloseAllUnpinnedViews'], true)
  assert.equal(enabled(runnerViewActionRows([view(1, { pinned: true })], 1))['Runner.CloseAllUnpinnedViews'], false,
    '只有 pinned 的那一个，没有可关的未固定视图')
})

test('关闭集合：三条 close 动作各自关掉哪些视图', () => {
  const contents = [view(1, { pinned: true }), view(2), view(3)]
  assert.deepEqual(viewsToClose('Runner.CloseView', contents, 2), [2])
  assert.deepEqual(viewsToClose('Runner.CloseView', contents, null), [])
  assert.deepEqual(viewsToClose('Runner.CloseOtherViews', contents, 2), [1, 3])
  assert.deepEqual(viewsToClose('Runner.CloseAllViews', contents, 2), [1, 2, 3])
  assert.deepEqual(viewsToClose('Runner.CloseAllUnpinnedViews', contents, 2), [2, 3])
  assert.deepEqual(viewsToClose('Runner.ToggleTabLabels', contents, 2), [], '显示标题不关任何视图')
  // 不可关的视图不进去（CloseViewsActionBase.java:26）。
  assert.deepEqual(viewsToClose('Runner.CloseAllViews', [view(1), view(2, { closeable: false })], 1), [1])
})

test('渲染顺序与不渲染的那几条都登记在册', () => {
  assert.deepEqual([...RUNNER_VIEW_ACTION_ORDER], [
    'Runner.ToggleTabLabels', 'Runner.CloseView', 'Runner.CloseOtherViews',
    'Runner.CloseAllViews', 'Runner.CloseAllUnpinnedViews',
  ])
  // RestoreLayout / MinimizeView / FocusOnStartup 都作用在「多视图布局」那份状态上，
  // 本仓运行标签是扁平的一条 ⇒ 不给按钮，但理由导出成常量可被核对。
  assert.deepEqual(RUNNER_VIEW_ACTIONS_NOT_PORTED.map(entry => entry.id),
    ['Runner.RestoreLayout', 'MinimizeView', 'Runner.FocusOnStartup'])
  for (const entry of RUNNER_VIEW_ACTIONS_NOT_PORTED) {
    assert.match(entry.reason, /RunnerContentUi|MinimizeViewAction|AbstractFocusOnAction/, `${entry.id} 的理由要带上游坐标`)
  }
  const focus = RUNNER_VIEW_ACTIONS_NOT_PORTED.find(entry => entry.id === 'Runner.FocusOnStartup')
  assert.match(focus.reason, /intellij\.platform\.lang\.actions\.xml:3/, '登记 id 要引得到')
  assert.match(focus.reason, /LayoutViewOptions\.STARTUP/)
  assert.match(focus.reason, /content\.length == 1/, '上游单视图时整条不显示这件事也要写明')
})

test('「隐藏标签页标题」默认隐藏（RunnerLayout.java:295），可存可读', () => {
  assert.equal(TAB_LABELS_HIDDEN_DEFAULT, true)
  const store = new Map()
  const fake = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value) },
  }
  assert.equal(readRunTabLabelsHidden(fake), true, '没有记录时用上游默认')
  assert.equal(readRunTabLabelsHidden(undefined), true, '存储不可用时也用上游默认')
  writeRunTabLabelsHidden(fake, false)
  assert.equal(readRunTabLabelsHidden(fake), false)
  store.set('taocode.runnerLayout', 'not json')
  assert.equal(readRunTabLabelsHidden(fake), true, '记录坏了退回默认，不抛')
  store.set('taocode.runnerLayout', JSON.stringify({ tabLabelsHidden: 'yes' }))
  assert.equal(readRunTabLabelsHidden(fake), true, '非布尔值退回默认')
})

test('closeRunView：标签立刻消失，记录等 run.exit 才删', () => {
  resetInstances()
  handleRunStarted({ instance: 21, label: 'A' })
  handleRunOutput(21, 'A 一行\n')
  handleRunStarted({ instance: 22, label: 'B' })
  handleRunOutput(22, 'B 一行\n')
  assert.deepEqual(own(), [21, 22])

  closeRunView(22)
  assert.deepEqual(own(), [21], '关闭的视图立刻不进清单')
  assert.equal(runInstances.has(22), true, '记录还在 —— 宿主对 run.stop 的收尾还没到')

  // 晚到的输出不会把视图叫回来（否则标签会"复活"）。
  handleRunOutput(22, 'B 收尾\n')
  assert.deepEqual(own(), [21])

  // 宿主一定会补的那条 run.exit（native/run_host.cpp:306-310）到达后才真正删。
  handleRunExit({ instance: 22, code: -1, remaining: 0, aborted: true })
  assert.equal(runInstances.has(22), false)
  assert.deepEqual(own(), [21])
})

test('closeRunView：关掉的正是选中视图时，选中落到剩下的第一个', () => {
  resetInstances()
  handleRunStarted({ instance: 31, label: 'A' })
  handleRunOutput(31, 'A 一行\n')
  handleRunStarted({ instance: 32, label: 'B' })
  handleRunOutput(32, 'B 一行\n')
  assert.equal(activeRunInstance.value, 32)

  closeRunView(32)
  handleRunExit({ instance: 32, code: -1, remaining: 0, aborted: true })
  assert.equal(activeRunInstance.value, 31, '选中切到剩下的那个')
  assert.deepEqual([...runOutput], ['A 一行\n'], '输出镜像跟着换')
})

test('closeRunView：进程已结束的视图当场删干净（不用等事件）', () => {
  resetInstances()
  handleRunStarted({ instance: 41, label: 'A' })
  handleRunExit({ instance: 41, code: 0, remaining: 0 })
  closeRunView(41)
  assert.equal(runInstances.has(41), false)
  assert.deepEqual(own(), [])
  // 关一个已经关过的视图是安全的空操作。
  const selected = activeRunInstance.value
  closeRunView(41)
  assert.equal(activeRunInstance.value, selected, '空操作不改选中')
})

test('closeRunView：before-launch 链还有后续步骤时先不删（remaining > 0）', () => {
  resetInstances()
  handleRunStarted({ instance: 51, label: '链' })
  closeRunView(51)
  handleRunExit({ instance: 51, code: 0, remaining: 1 })
  assert.equal(runInstances.has(51), true, '整条链没走完，记录留着')
  assert.deepEqual(own(), [], '但视图已经摘掉了')
  handleRunExit({ instance: 51, code: 0, remaining: 0 })
  assert.equal(runInstances.has(51), false)
})

test('接线：RunConsole 渲染视图动作弹层并按 tabLabelsHidden 画标题', () => {
  const console_ = read('src/components/RunConsole.vue')
  assert.ok(console_.includes('runnerViewActionRows'), '组件要用判定函数算那几行')
  assert.ok(console_.includes('viewsToClose'), '组件要按动作算出要关哪些视图')
  assert.ok(console_.includes('closeRunView'), '组件要调 closeRunView 摘掉标签')
  assert.ok(console_.includes('readRunTabLabelsHidden') && console_.includes('writeRunTabLabelsHidden'),
    '标题可见性要存/读（上游 RunnerLayout.General.isTabLabelsHidden）')
  assert.match(console_, /v-if="!tabLabelsHidden" class="run-tab-title"/, '隐藏时不画标签标题')
  // 标签上的 × 就是「关闭视图」（上游 RunnerContentUi.java:396-406 的关闭键 → CloseViewAction.perform）。
  assert.match(console_, /class="run-tab-close"[^>]*@click="closeView\(instance\.id\)"/s)
})
