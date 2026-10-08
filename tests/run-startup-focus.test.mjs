// 「启动运行实例时是否把焦点移到运行面板」的判据（`src/runStartupFocus.ts`）。
//
// 三档判据 + 两条会失败的边界用例，逐条对着上游写：
//   · 两个设置与默认值 —— `platform/execution-impl/src/com/intellij/execution/impl/RunnerAndConfigurationSettingsImpl.kt:108-109`
//     （activate=true、focus=false）、读档缺键的补法 `:243-244`、写档只落非默认 `:317-321`。
//   · 这两个设置**挂在每条配置上**，不是全局设置 —— 声明
//     `platform/execution/src/com/intellij/execution/RunnerAndConfigurationSettings.java:235/:242/:249/:256`，
//     两套 UI（`BeforeRunStepsPanel.java:170-171`/`:214-217`/`:238-243` 经
//     `ConfigurationSettingsEditorWrapper.java:143-144`；`BeforeRunFragment.java:28-42`）
//     写的都是同一个对象 ⇒ 本仓的存放处 = `RunConfig` 那两个字段，见「唯一存放处」那条判据。
//   · 设置 → descriptor —— `platform/execution-impl/src/com/intellij/execution/impl/ExecutionManagerImpl.kt:290-293`
//     （`activate = activate || focus`、`autoFocus = focus`）。
//   · descriptor → 面板 —— `platform/execution-impl/src/com/intellij/execution/ui/RunContentManagerImpl.kt:432-435`（选中）、
//     `:439-441`（没开 activate 就 return，谈不上夺焦）、`:450-457`（focus 值 + 「没有焦点所有者」强制补真）、
//     `:458`（`activate(callback, focus, focus)`）。
//   · 新建还是复用标签 —— 同文件 `:296` 调 `chooseReuseContentForDescriptor`，判定 `:788-826`，
//     总闸 `:814` 与 `:854-856` `canReuseContent = !pinned && terminated && 不同 executionId`
//     ⇒ **在跑的实例一定新建标签**；复用时 `:96-110` 不搬 `isAutoFocusContent`
//     ⇒ 「实例已有活动页」不改变夺焦与否（这就是判据第三档的上游答案）。
// 反向验证（规则 §5）：本文件跑法与注入见 docs/batch-2026-10-06-execui.md ——
// 把实现里的「focusOwner 强制补真」或「在跑 ⇒ 新建」删掉，下面对应两条必须变红；
// 把那两个开关再存回一份全局载体（或把面板的读写绕开那两个入口），「唯一存放处」与「四处同源」两条变红。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as runStartupFocus from '../src/runStartupFocus.ts'
import {
  ACTIVATE_TOOL_WINDOW_DEFAULT, FOCUS_TOOL_WINDOW_DEFAULT,
  decideRunStartupFocus, resolveRunStartupFocusFlags, runStartupFocusFlagsOf, withRunStartupFocusFlags,
} from '../src/runStartupFocus.ts'
import { normalizeRunConfigurations } from '../src/runConfigurationSchema.ts'
import { applyTemplate } from '../src/runConfigTemplates.ts'
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

test('记录往返：只把非默认的键落进配置，缺键读回上游默认', () => {
  // 写档规则 = `RunnerAndConfigurationSettingsImpl.kt:317-321`（只在非默认时 setAttribute）。
  assert.deepEqual(withRunStartupFocusFlags({ name: 'a', command: 'x' }, BOTH_ON),
    { name: 'a', command: 'x', focusToolWindowBeforeRun: true },
    'activate 的默认就是 true ⇒ 不落键；只有 focus 开了才落')
  assert.deepEqual(withRunStartupFocusFlags({ name: 'a', command: 'x' }, OPEN_ONLY), { name: 'a', command: 'x' },
    '两格都在默认 ⇒ 配置记录一个键都不长（旧记录不会被越写越大）')
  assert.deepEqual(withRunStartupFocusFlags({ name: 'a', command: 'x' }, OFF),
    { name: 'a', command: 'x', activateToolWindowBeforeRun: false },
    'activate 关掉了要落 false（上游 `:317-318` 正是 if (!isActivate…) setAttribute(…, "false")）')
  // 读档规则 = 同文件 `:243-244`：缺 activate ⇒ true、缺 focus ⇒ false。
  assert.deepEqual(runStartupFocusFlagsOf({ name: 'a', command: 'x', activateToolWindowBeforeRun: false }),
    { activateToolWindowBeforeRun: false, focusToolWindowBeforeRun: false })
  assert.deepEqual(runStartupFocusFlagsOf(undefined),
    { activateToolWindowBeforeRun: true, focusToolWindowBeforeRun: false },
    '还没有配置（自动发现的目标、新建草稿）⇒ 上游默认，不报错')
  // 写进去再读回来必须是同一个值（往返，不是单向清洗）。
  for (const flags of [OFF, OPEN_ONLY, FOCUS_ON, BOTH_ON]) {
    assert.deepEqual(runStartupFocusFlagsOf(withRunStartupFocusFlags({ name: 'n', command: 'c' }, flags)), flags,
      `往返必须保住 ${JSON.stringify(flags)}`)
  }
})

test('配置记录是唯一存放处：模块里不许再有第二份存储', () => {
  // 这条是给「两个真源」那个架构问题兜底的：那两个开关在上游挂在**每条配置**上
  // （`RunnerAndConfigurationSettings.java:235/:242/:249/:256`，存
  // `RunnerAndConfigurationSettingsImpl.kt:108-109`，两套 UI 都经
  // `ConfigurationSettingsEditorWrapper.java:143-144` 与 `BeforeRunFragment.java:28-42` 落回同一个对象）。
  // 本仓一旦再开一份全局载体，用户在两处改时行为以谁为准就说不清了 ⇒ 机检钉死只有一处。
  // 头注释里**写着**「原来的 localStorage 载体已删」这类句子（那是判决的留痕，必须有），
  // 所以这条查的是代码本体：把行首的 `//` 注释整段去掉后再看有没有存储调用。
  const body = read('src/runStartupFocus.ts').split('\n').filter(line => !line.startsWith('//')).join('\n')
  assert.doesNotMatch(body, /localStorage/, '本模块不许碰 localStorage')
  assert.doesNotMatch(body, /sessionStorage/, '也不许碰 sessionStorage')
  assert.doesNotMatch(body, /taocode\.[A-Za-z]/, '不许自带一份按键存的全局设置（那是第二个真源）')
  assert.doesNotMatch(body, /getItem\(|setItem\(|StorageLike/, '模块里没有任何存储读写点，也不认存储类型')
  // 那条 localStorage 载体已经删除（它原先也没有生产写入方：`writeRunStartupFocus` 的全部引用
  // 只出现在判据里，生产代码只调过 `readRunStartupFocus` ⇒ 删掉它不丢任何用户设置，也就不需要迁移脚本）。
  for (const retired of ['readRunStartupFocus', 'writeRunStartupFocus', 'RUN_STARTUP_FOCUS_KEY']) {
    assert.equal(runStartupFocus[retired], undefined, `${retired} 已经退役：留着就是第二个源的入口`)
  }
})

test('面板读写、宿主消费、宿主与前端清单同键：四处必须都在', () => {
  const dialog = read('src/components/RunConfigurationsDialog.vue')
  // 写点：配置那一格 + 模板那一格（上游这两套 UI 写的都是同一条记录）。
  assert.match(dialog, /v-model="form\.activateToolWindowBeforeRun"/, '配置面板要有「启动时打开运行面板」那一格')
  assert.match(dialog, /v-model="form\.focusToolWindowBeforeRun"/, '配置面板要有「启动时把焦点移到运行面板」那一格')
  assert.match(dialog, /withRunStartupFocusFlags\(/, '保存要经由那一个写入口（只落非默认）')
  assert.match(dialog, /runStartupFocusFlagsOf\(/, 'reset 要经由那一个读入口（缺键补默认）')
  const actions = read('src/runActions.ts')
  assert.match(actions, /runStartupFocusFlagsOf\(config\)/, 'startRun 读的必须是**这条配置**，不是全局副本')
  // 键名四处同源：前端类型、前端校验、宿主白名单、本模块。少一处就是「建得出、存不下去」或「存得下、读不回」。
  for (const key of ['activateToolWindowBeforeRun', 'focusToolWindowBeforeRun']) {
    assert.ok(read('src/settingsModel.ts').includes(key), `src/settingsModel.ts 的 RunConfig 要有 ${key}`)
    assert.ok(read('src/runConfigurationSchema.ts').includes(`'${key}'`), `schema 的键清单要有 ${key}`)
    assert.ok(read('native/settings_schema.cpp').includes(`"${key}"`), `宿主 known_keys 白名单要有 ${key}`)
    assert.ok(read('src/runStartupFocus.ts').includes(`'${key}'`), `本模块的读档键名要与上游属性名一致（:61-62）`)
  }
})

test('宿主与 schema 都要认这两个键：脏值报错、缺键不判坏（不许把用户锁在项目外）', () => {
  const keep = { name: 'n', command: 'c' }
  // 缺键的两个旧配置必须原样通过。
  assert.deepEqual(normalizeRunConfigurations([keep]).map(item => item.name), ['n'], '缺键不是坏记录')
  // 非默认的布尔值要留得下来。
  const stored = normalizeRunConfigurations([{ ...keep, activateToolWindowBeforeRun: false, focusToolWindowBeforeRun: true }])
  assert.deepEqual([stored[0].activateToolWindowBeforeRun, stored[0].focusToolWindowBeforeRun], [false, true])
  // 非布尔在这里就报错（与宿主那条布尔校验同一档），不许静默变成 false。
  assert.throws(() => normalizeRunConfigurations([{ ...keep, focusToolWindowBeforeRun: 'yes' }]), /字段无效/)
})

test('模板那两个开关是「新配置的初值」，不是第二处存放', () => {
  // 上游 `importRunnerAndConfigurationSettings`（`RunnerAndConfigurationSettingsImpl.kt:455-461`）把
  // 模板记录的 activate/focus 拷进新配置 ⇒ 本仓同一条链，且只在**新建**这一次起作用。
  const seeded = applyTemplate({ name: '', type: 'shell', command: '' }, {
    command: 'node app.js', activateToolWindowBeforeRun: false, focusToolWindowBeforeRun: true,
  }, 'shell')
  assert.equal(seeded.activateToolWindowBeforeRun, false, '模板关了「打开面板」⇒ 新配置继承 false')
  assert.equal(seeded.focusToolWindowBeforeRun, true, '模板开了「夺焦」⇒ 新配置继承 true')
  // 模板没记这两个键时**不落键**（读的时候由同一个入口补上游默认），免得记录里堆一份和默认重复的副本。
  const bare = applyTemplate({ name: '', type: 'shell', command: '' }, { command: 'node app.js' }, 'shell')
  assert.equal('activateToolWindowBeforeRun' in bare, false, '默认值不进新配置记录')
  assert.equal('focusToolWindowBeforeRun' in bare, false)
  assert.deepEqual(runStartupFocusFlagsOf(bare), { activateToolWindowBeforeRun: true, focusToolWindowBeforeRun: false })
})

test('默认值不写进配置记录：宿主侧只认键，补默认发生在读侧', () => {
  // `native/settings_schema.cpp` 的 known_keys 认这两个键、也校验必须是布尔，但**不补默认**：
  // 补默认在读侧（`runStartupFocusFlagsOf`，上游读档 `RunnerAndConfigurationSettingsImpl.kt:243-244`）。
  const collapsed = withRunStartupFocusFlags({ name: 'n', command: 'c' }, OPEN_ONLY)
  assert.deepEqual(Object.keys(collapsed), ['name', 'command'], '两格都在默认 ⇒ 只剩原有字段')
  assert.equal(normalizeRunConfigurations([collapsed])[0].activateToolWindowBeforeRun, undefined)
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
  // 取 `startRun` 的**整个函数体**（切到下一个顶层函数 `runSelectedConfig`），不用固定字符数窗口 ——
  // 固定窗口会在实现长大时把锚点切掉半行（2026-10-07 就是这么红的）。
  const from = actions.indexOf('async function startRun')
  const to = actions.indexOf('async function runSelectedConfig')
  assert.ok(from > 0 && to > from, 'runActions 里找不到 startRun / runSelectedConfig 的函数边界')
  const startup = actions.slice(from, to)
  // 2026-10-07 按实现的真实锚点重写：打开面板的动作从写死的 `showOutput('run')` 换成了
  // **按执行器落窗口**的 `showExecutorToolWindow(executor)`（上游 `Executor.getToolWindowId()`：
  // Run 进运行面板、Debug 进调试面板）。断言意图不变 —— 「打开面板」这一动作必须挂在
  // `decideRunStartupFocus` 的判定上，且默认档下仍落到运行面板（下面第二条钉住这条回落）。
  assert.match(startup, /if \(startup\.activateToolWindow\) showExecutorToolWindow\(executor\)/,
    'startRun 的打开面板必须挂在判定上（默认 true ⇒ 行为与接线前一致）')
  assert.match(actions, /function showExecutorToolWindow\([\s\S]*?showOutput\('run'\)/,
    '非调试执行器的落窗口要回落到运行面板（内建 Run 行为与接线前逐字一致）')
})
