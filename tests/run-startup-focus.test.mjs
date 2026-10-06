// 「启动运行实例时是否把焦点移到运行面板」的判据（`src/runStartupFocus.ts`）。
//
// 三档判据 + 两条会失败的边界用例，逐条对着上游写：
//   · 两个设置与默认值 —— `platform/execution-impl/src/com/intellij/execution/impl/RunnerAndConfigurationSettingsImpl.kt:108-109`
//     （activate=true、focus=false）、读档缺键的补法 `:242-244`。
//   · 设置 → descriptor —— `platform/execution-impl/src/com/intellij/execution/impl/ExecutionManagerImpl.kt:290-293`
//     （`activate = activate || focus`、`autoFocus = focus`）。
//   · descriptor → 面板 —— `platform/execution-impl/src/com/intellij/execution/ui/RunContentManagerImpl.kt:432-435`（选中）、
//     `:439-441`（没开 activate 就 return，谈不上夺焦）、`:450-457`（focus 值 + 「没有焦点所有者」强制补真）、
//     `:458`（`activate(callback, focus, focus)`）。
//   · 新建还是复用标签 —— 同文件 `:296` 调 `chooseReuseContentForDescriptor`，判定 `:788-826`，
//     总闸 `:814` 与 `:854-856` `canReuseContent = !pinned && terminated && 不同 executionId`
//     ⇒ **在跑的实例一定新建标签**；复用时 `:96-110` 不搬 `isAutoFocusContent`
//     ⇒ 「实例已有活动页」不改变夺焦与否（这就是判据第三档的上游答案）。
// 反向验证（规则 §5）：本文件跑法见 docs/batch-2026-10-06-exec2.md —— 把实现里的
// 「focusOwner 强制补真」或「在跑 ⇒ 新建」删掉，下面对应两条必须变红。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ACTIVATE_TOOL_WINDOW_DEFAULT, FOCUS_TOOL_WINDOW_DEFAULT, RUN_STARTUP_FOCUS_KEY,
  decideRunStartupFocus, readRunStartupFocus, resolveRunStartupFocusFlags, writeRunStartupFocus,
} from '../src/runStartupFocus.ts'
import { RUNNER_VIEW_ACTIONS_NOT_PORTED } from '../src/runToolWindowLayout.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

// 上游默认：打开面板 = 真、夺焦 = 假（RunnerAndConfigurationSettingsImpl.kt:108-109）。
const OFF = { activateToolWindowBeforeRun: false, focusToolWindowBeforeRun: false }
const OPEN_ONLY = { activateToolWindowBeforeRun: true, focusToolWindowBeforeRun: false }
const FOCUS_ON = { activateToolWindowBeforeRun: false, focusToolWindowBeforeRun: true }
const BOTH_ON = { activateToolWindowBeforeRun: true, focusToolWindowBeforeRun: true }

// 判定入参的形状就是这条：两个设置值 + 当前有没有这个实例的活动页。
function input(flags, extra) { return { ...flags, existingView: null, ...extra } }

test('判据一：设置关 ⇒ 不夺焦（连面板都不碰）', () => {
  const d = decideRunStartupFocus(input(OFF, {}))
  assert.equal(d.takeFocus, false, '上游 autoFocusContent 默认 false，设置没开就不许夺焦')
  assert.equal(d.activateToolWindow, false, 'ExecutionManagerImpl.kt:291 —— 两个都关 ⇒ activate=false，:439-441 直接 return')
  assert.equal(d.selectView, true, 'RunContentDescriptor.java:52 的 isSelectContentWhenAdded 默认 true，选中与激活是两件事')
  assert.equal(d.createNewTab, true, '没有已有视图 ⇒ 新建')
})

test('判据二：设置开 + 实例新建 ⇒ 夺焦', () => {
  const d = decideRunStartupFocus(input(FOCUS_ON, { existingView: null }))
  assert.equal(d.takeFocus, true, 'focusToolWindowBeforeRun ⇒ isAutoFocusContent（ExecutionManagerImpl.kt:292）')
  assert.equal(d.activateToolWindow, true, 'RunContentManagerImpl.kt:439-441 —— 只勾「夺焦」也要能走到 activate(…)')
  assert.equal(d.createNewTab, true)
})

test('判据三：设置开但实例已有活动页 ⇒ 夺焦照旧，标签看不在跑才复用', () => {
  // 在跑的那一格绝不会被复用（canReuseContent 要 isTerminated）⇒ 新建标签，但夺焦不受影响。
  const running = decideRunStartupFocus(input(BOTH_ON, { existingView: { running: true } }))
  assert.equal(running.takeFocus, true, '复用时 copyContentAndBehavior(:96-110) 不搬 isAutoFocusContent ⇒ 设置说了算')
  assert.equal(running.createNewTab, true, 'RunContentManagerImpl.kt:854-856 —— 还在跑 ⇒ 另开一个标签')

  // 已结束、未固定 ⇒ 复用那一格（:814 之后走 oldDescriptor 分支），夺焦仍然照设置。
  const dead = decideRunStartupFocus(input(BOTH_ON, { existingView: { running: false } }))
  assert.equal(dead.createNewTab, false, '已结束才可复用')
  assert.equal(dead.takeFocus, true, '复用与否不参与夺焦判定')

  // 固定过的视图（pinned）不复用；本仓运行标签恒 false，这条是为了让判定可测。
  const pinned = decideRunStartupFocus(input(BOTH_ON, { existingView: { running: false, pinned: true } }))
  assert.equal(pinned.createNewTab, true, 'canReuseContent 第一条就是 !isPinned')

  // 同一次执行自己的标签不复用（executionId 相同那一条）。
  const same = decideRunStartupFocus(input(BOTH_ON, { existingView: { running: false, sameExecution: true } }))
  assert.equal(same.createNewTab, true, 'executionId 相同 ⇒ 不复用（:854-856）')
})

test('边界一（会失败的用例）：设置关，但此刻应用没有焦点所有者 ⇒ 强制夺焦', () => {
  // RunContentManagerImpl.kt:450-457 —— `focus = isAutoFocusContent`，但 focusOwner == null 时
  // 无条件补成 true（焦点原本在被换掉的那块视图里）。只写 `takeFocus = focus` 的实现这条必红。
  const d = decideRunStartupFocus(input(OPEN_ONLY, { existingView: null, focusOwnerMissing: true }))
  assert.equal(d.takeFocus, true, '没有焦点所有者时把焦点还给面板（上游注释：having no focused component is never useful）')
  assert.equal(d.activateToolWindow, true)
  // 反证：同一档设置，焦点有主 ⇒ 不夺焦。
  assert.equal(decideRunStartupFocus(input(OPEN_ONLY, { existingView: null })).takeFocus, false)
  assert.equal(decideRunStartupFocus(input(OFF, { existingView: null, focusOwnerMissing: true })).takeFocus, false,
    '反证：连 activate 都没过（:439-441 的 return），焦点缺失也不许夺焦')
})

test('边界二（会失败的用例）：选中与激活是两件事', () => {
  // RunContentManagerImpl.kt:432-435 —— isSelectContentWhenAdded 为假时，
  // 「复用来的那一格本来就选中」仍然要再 setSelectedContent 一次。
  const d = decideRunStartupFocus(input(BOTH_ON, {
    existingView: { running: false, selected: true }, selectContentWhenAdded: false,
  }))
  assert.equal(d.selectView, true, '本来就选中的复用格要重选（:432-433 的后半个条件）')
  assert.equal(d.createNewTab, false)
  assert.equal(decideRunStartupFocus(input(BOTH_ON, {
    existingView: { running: true, selected: false }, selectContentWhenAdded: false,
  })).selectView, false, '反证：flag 关了、也不是复用来的选中格 ⇒ 不重复选')
})

test('旧存档缺键补上游默认，脏值退回默认而不是判整份坏掉', () => {
  assert.equal(ACTIVATE_TOOL_WINDOW_DEFAULT, true)
  assert.equal(FOCUS_TOOL_WINDOW_DEFAULT, false)
  // 上游读档（RunnerAndConfigurationSettingsImpl.kt:242-244）：缺 activate ⇒ true，缺 focus ⇒ false。
  assert.deepEqual(resolveRunStartupFocusFlags({}), {
    activateToolWindowBeforeRun: true, focusToolWindowBeforeRun: false,
  })
  assert.deepEqual(resolveRunStartupFocusFlags({ focusToolWindowBeforeRun: true }), {
    activateToolWindowBeforeRun: true, focusToolWindowBeforeRun: true,
  }, '只写了一个键的旧存档：另一个补默认，绝不按字段数量判损坏')
  assert.deepEqual(resolveRunStartupFocusFlags(undefined), {
    activateToolWindowBeforeRun: true, focusToolWindowBeforeRun: false,
  })
  assert.deepEqual(resolveRunStartupFocusFlags('nope'), {
    activateToolWindowBeforeRun: true, focusToolWindowBeforeRun: false,
  })
  assert.deepEqual(resolveRunStartupFocusFlags([{ activateToolWindowBeforeRun: false }]), {
    activateToolWindowBeforeRun: true, focusToolWindowBeforeRun: false,
  }, '数组不是设置对象 ⇒ 用上游默认')
  assert.deepEqual(resolveRunStartupFocusFlags({ activateToolWindowBeforeRun: 'yes', focusToolWindowBeforeRun: 0 }), {
    activateToolWindowBeforeRun: true, focusToolWindowBeforeRun: false,
  }, '非布尔脏值退回默认，不抛')
})

test('存储往返：只落非默认的键，记录坏了退回上游默认', () => {
  const store = new Map()
  const fake = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value) },
  }
  assert.deepEqual(readRunStartupFocus(fake), {
    activateToolWindowBeforeRun: true, focusToolWindowBeforeRun: false,
  }, '没有记录时用上游默认')
  assert.deepEqual(readRunStartupFocus(undefined), {
    activateToolWindowBeforeRun: true, focusToolWindowBeforeRun: false,
  }, '存储不可用时也是上游默认')

  writeRunStartupFocus(fake, { activateToolWindowBeforeRun: true, focusToolWindowBeforeRun: true })
  assert.deepEqual(JSON.parse(store.get(RUN_STARTUP_FOCUS_KEY)), { focusToolWindowBeforeRun: true },
    '与默认相同的键不落盘（RunnerAndConfigurationSettingsImpl.kt:317-321 的写法）')
  assert.deepEqual(readRunStartupFocus(fake), {
    activateToolWindowBeforeRun: true, focusToolWindowBeforeRun: true,
  })

  store.set(RUN_STARTUP_FOCUS_KEY, 'not json')
  assert.deepEqual(readRunStartupFocus(fake), {
    activateToolWindowBeforeRun: true, focusToolWindowBeforeRun: false,
  }, '记录坏了退回默认，不抛')
  store.set(RUN_STARTUP_FOCUS_KEY, JSON.stringify({ activateToolWindowBeforeRun: false }))
  assert.deepEqual(readRunStartupFocus(fake), {
    activateToolWindowBeforeRun: false, focusToolWindowBeforeRun: false,
  })
})

test('判词订正：Runner.FocusOnStartup 的理由写的是「只有一个视图时才显示」，并指向本模块', () => {
  const focus = RUNNER_VIEW_ACTIONS_NOT_PORTED.find(entry => entry.id === 'Runner.FocusOnStartup')
  assert.ok(focus, 'Runner.FocusOnStartup 仍在不渲染清单里（本仓没有 RunnerLayoutUi 的 Content 格可标）')
  // 原写「content.length == 1 时整条不显示」，实际 AbstractFocusOnAction.java:21 是 visible = content.length == 1。
  assert.match(focus.reason, /content\.length == 1` 才显示/, '订正后的方向：恰好一个选中视图时才显示')
  assert.doesNotMatch(focus.reason, /整条不显示/, '订正前那句写反了，不许回潮')
  // 用户可见的那条「启动时聚焦运行面板」不再被说成整件做不了。
  assert.match(focus.reason, /runStartupFocus\.ts/, '理由里要点明用户可见那半由本模块承接')
})

test('生产消费方在位：startRun 的打开面板由 decideRunStartupFocus 决定', () => {
  const actions = read('src/runActions.ts')
  assert.match(actions, /from '\.\/runStartupFocus\.ts'/, '纯函数没有生产消费方就是死模块')
  assert.match(actions, /decideRunStartupFocus\(/, 'startRun 要按判定决定要不要打开运行面板')
  const startup = actions.slice(actions.indexOf('async function startRun'), actions.indexOf('async function startRun') + 2200)
  assert.match(startup, /if \(startup\.activateToolWindow\) showOutput\('run'\)/,
    'startRun 的 showOutput 必须挂在判定上（默认 true ⇒ 行为与接线前一致）')
})
