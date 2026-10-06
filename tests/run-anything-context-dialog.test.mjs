// Run Anything 弹层里的「执行上下文」那一格（工作目录）—— 验 `src/components/RunAnythingDialog.vue`
// 真的把 `src/runAnythingContext.ts` 的三个出口消费掉了。
//
// 上游依据（坐标都带文件，逐条开过）：
//   · 那一格在弹层**头部输入框右侧**：`platform/lang-impl/src/com/intellij/ide/actions/runAnything/RunAnythingPopupUI.java:796-847`
//     （`createHeader()` 把 `myChooseContextAction` 装进 `RowBuilder`）；
//   · 候选装配 / 「模块只有一个就不列」：同目录 `RunAnythingChooseContextAction.kt:235-249`；
//   · 「表空就隐藏、没选就取第一个、按钮文字 = 选中项 label」：`RunAnythingChooseContextAction.kt:62-78`；
//   · 默认档 = 表里第一档（项目根）：`activity/RunAnythingProvider.java:154-163`（注释第 160 行）
//     + `RunAnythingContextUtils.kt:14-21`（`getPath()`）+ 插件侧回落 `plugins/gradle/src/org/jetbrains/plugins/gradle/execution/GradleRunAnythingProvider.kt:60`
//     （`?: ProjectContext(project)`）⇒ **本仓的「不选」必须落在工作区根**，等价于不传 cwd；
//   · 选运行配置时上下文表是空的：`RunAnythingRunConfigurationProvider.java:56-58` ⇒ 配置行不吃 cwd；
//   · 文案：`platform/platform-api/resources/messages/IdeBundle.properties:1183-1189`（`run.anything.context.*`）。
//
// 跑法：`<script setup>` 里的 `pick()` 在 SSR 下点不出来（没有 DOM 就没有事件），所以行为判据走
// `loadSetup`（夹具里那份：不内联模板编译后**真调** setup，拿真源码 + 假 emit），
// 「这一格到底渲不渲染」的判据走 `loadSfc` + `renderToString`（真渲染 HTML）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { loadSetup, loadSfc } from './vue-sfc-loader.mjs'

const DIALOG = 'src/components/RunAnythingDialog.vue'
const source = readFileSync(new URL(`../src/components/RunAnythingDialog.vue`, import.meta.url), 'utf8')
const runActionsSource = readFileSync(new URL('../src/runActions.ts', import.meta.url), 'utf8')
const { CONTEXT_POPUP_TITLE, CONTEXT_TOOLTIP, allRunAnythingContexts, contextPath } =
  await import('../src/runAnythingContext.ts')

/** `loadSetup` 里 `onMounted` 没有组件实例，Vue 会打一条 dev 警告 —— 与本判据无关，消音。 */
function quiet(fn) {
  const error = console.error
  console.error = () => {}
  try { return fn() } finally { console.error = error }
}

const TWO_ROOTS = { app: 'app', lib: 'lib/src' }
const commandRow = () => ({ kind: 'command', name: 'npm test', detail: '在项目根目录运行命令', group: 'command', score: 0, indices: [] })
const configRow = () => ({ kind: 'history', sourceKind: 'config', name: 'App', detail: '运行配置', group: 'recent', score: 0, indices: [] })

/** 拿一份新的 setup 绑定（每次调用都是新实例，测试之间不共享状态）。 */
const DEFAULT_PROPS = { configs: [], moduleRoots: TWO_ROOTS }
function dialog(props) {
  return quiet(() => loadSetup(DIALOG, props))
}

// ── 判据 1：不选 ⇒ payload 里**没有** cwd 这个键 ────────────────────────────────
test('不选执行上下文时，runCommand 的 payload 里没有 cwd 键（:62-78 的「没选」不折算成任何目录）', () => {
  const { bindings, emitted } = dialog(DEFAULT_PROPS)
  assert.equal(bindings.context.value, null, '初始状态是没选过，而不是偷偷选了一个')
  bindings.pick(commandRow())
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].event, 'runCommand')
  assert.deepEqual(emitted[0].payload, { command: 'npm test' })
  assert.equal('cwd' in emitted[0].payload, false, '不许发一个 cwd: undefined/"" 过去 —— 收端按「没给」才回落工作区根')
})

// ── 判据 2：选了模块根 ⇒ cwd 就是那条相对路径 ──────────────────────────────────
test('选了某个模块根时，cwd 等于那条路径（contextPath 的 module 一支，RunAnythingContextUtils.kt:18）', () => {
  const { bindings, emitted } = dialog(DEFAULT_PROPS)
  const index = bindings.availableContexts.value.findIndex(entry => entry.value === 'lib')
  assert.ok(index > 0, 'lib 这一档要在候选里')
  bindings.chooseContext(index)
  assert.equal(bindings.context.value.label, 'lib')
  bindings.pick(commandRow())
  assert.deepEqual(emitted[emitted.length - 1].payload, { command: 'npm test', cwd: 'lib/src' })
  // 另一条模块根各自算各自的目录，不是共用第一条。
  const other = bindings.availableContexts.value.findIndex(entry => entry.value === 'app')
  bindings.chooseContext(other)
  bindings.pick(commandRow())
  assert.equal(emitted[emitted.length - 1].payload.cwd, 'app')
})

// ── 判据 3：那一格的文案与 CONTEXT_POPUP_TITLE 同源，.vue 里没有第二份字面量 ────
test('那一格的标题/aria 都取 CONTEXT_POPUP_TITLE，组件里没有另抄一份字面量', async () => {
  assert.match(source, /import \{ CONTEXT_POPUP_TITLE, CONTEXT_TOOLTIP, allRunAnythingContexts, contextPath, resolveSelectedContext/,
    '没有真 import ⇒ 那一格是摆设')
  assert.match(source, /\{\{ CONTEXT_POPUP_TITLE \}\}/, '可见文案必须绑常量，不是硬写')
  assert.match(source, /:aria-label="CONTEXT_POPUP_TITLE"/, '无障碍名同源')
  assert.match(source, /:title="CONTEXT_TOOLTIP"/, 'tooltip = run.anything.context.tooltip（RunAnythingChooseContextAction.kt:58）')
  // 引号里的第二份字面量（'执行上下文'）才是「另抄一份」；注释里的「」引用不算。
  assert.equal(/['"`]执行上下文['"`]/.test(source), false, '.vue 里不许出现另一份该文案的字面量')
  assert.equal(/['"`]选择命令在哪个上下文里执行['"`]/.test(source), false, 'tooltip 同理')
  const html = await renderToString(createSSRApp(loadSfc(DIALOG).component, { configs: [], moduleRoots: TWO_ROOTS }))
  assert.ok(html.includes(`>${CONTEXT_POPUP_TITLE}<`), `渲染出的标题应当正是模块里的常量（${CONTEXT_POPUP_TITLE}）`)
  assert.ok(html.includes(`aria-label="${CONTEXT_POPUP_TITLE}"`))
  assert.ok(html.includes(`title="${CONTEXT_TOOLTIP}"`))
})

// ── 判据 4：moduleRoots 为空 ⇒ 那一格不渲染（不放假控件）────────────────────────
test('moduleRoots 为空/缺省/只有一条时那一格整个不渲染', async () => {
  const component = loadSfc(DIALOG).component
  const cases = [
    ['prop 缺省（宿主还没接线，App.vue:2635 现在就是这样）', { configs: [] }],
    ['空表', { configs: [], moduleRoots: {} }],
    ['只有一条（上游 :247「模块只有一个就整组不列」）', { configs: [], moduleRoots: { only: 'only' } }],
  ]
  for (const [name, props] of cases) {
    const html = await renderToString(createSSRApp(component, props))
    assert.equal(html.includes('run-ctx-select'), false, `${name} ⇒ 不该有选择控件`)
    assert.equal(html.includes(CONTEXT_POPUP_TITLE), false, `${name} ⇒ 不该有那一格的文案`)
    const { bindings } = dialog(props)
    assert.equal(bindings.cellVisible.value, false, `${name} ⇒ cellVisible 要是 false`)
  }
  const filled = await renderToString(createSSRApp(component, { configs: [], moduleRoots: TWO_ROOTS }))
  assert.ok(filled.includes('run-ctx-select'), '有两根模块根时这一格要出现')
})

// ── 判据 5：候选表由模块的 allRunAnythingContexts 给，组件不另装配 ──────────────
test('下拉里的候选逐条等于 allRunAnythingContexts 的输出（顺序、条数、label）', async () => {
  const expected = allRunAnythingContexts({
    project: { basePath: '' },
    modules: Object.entries(TWO_ROOTS).map(([name, root]) => ({ name, description: root })),
    recentDirectories: [],
    canBrowse: false,
  })
  const { bindings } = dialog(DEFAULT_PROPS)
  assert.deepEqual(bindings.availableContexts.value, expected, '装配规则在 runAnythingContext.ts，弹层不许重写一遍')
  const html = await renderToString(createSSRApp(loadSfc(DIALOG).component, { configs: [], moduleRoots: TWO_ROOTS }))
  const options = [...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(match => match[1])
  assert.deepEqual(options, expected.map(entry => entry.label), '渲染出来的就是那张表')
  // 「浏览目录…」与「最近目录」都没有宿主（目录选择器写不回缓存、本仓没有 recent 目录存储）⇒ 不许出现假行。
  assert.equal(options.some(label => label.includes('浏览')), false)
  assert.equal(options.length, expected.length, '不许有多出来的行（假控件）')
})

// ── 判据 6：只有命令行那一支吃上下文，配置行不吃 ───────────────────────────────
test('选运行配置那一支不带 cwd（上游 RunAnythingRunConfigurationProvider.java:56-58 给的是空上下文表）', () => {
  const { bindings, emitted } = dialog(DEFAULT_PROPS)
  bindings.chooseContext(bindings.availableContexts.value.findIndex(entry => entry.value === 'lib'))
  bindings.pick(configRow())
  assert.deepEqual(emitted[emitted.length - 1], { event: 'runConfig', payload: { name: 'App' } })
  assert.equal('cwd' in emitted[emitted.length - 1].payload, false)
  // 「更多」行只展开不派发。
  const before = emitted.length
  bindings.pick({ kind: 'more', name: '更多（还有 3 个）', detail: '', group: 'general', score: 0, indices: [] })
  assert.equal(emitted.length, before)
  assert.deepEqual(bindings.expanded.value, ['general'])
})

// ── 判据 7：默认显示第一档 = 项目（上游 :73），但显示归显示、派发仍按「没选」──────
test('没选时那一格显示表里第一档（项目），发出去的 payload 依然没有 cwd', () => {
  const { bindings, emitted } = dialog(DEFAULT_PROPS)
  assert.equal(bindings.contextIndex.value, 0, 'resolveSelectedContext 的「还没选就取第一个」（:73）')
  assert.equal(bindings.availableContexts.value[0].kind, 'project')
  assert.equal(contextPath(bindings.availableContexts.value[0], TWO_ROOTS), '', '本仓项目根 = 空串（runAnythingContext.ts:81）')
  bindings.pick(commandRow())
  assert.deepEqual(emitted[0].payload, { command: 'npm test' })
  // 显式选了「项目」那一档也和没选同结果（空串不是目录，收端回落工作区根）。
  bindings.chooseContext(0)
  bindings.pick(commandRow())
  assert.deepEqual(emitted[1].payload, { command: 'npm test' })
})

// ── 判据 8：收端语义钉住 —— 不给 cwd 就在工作区根跑 ────────────────────────────
test('收端 runActions 的回落式样钉住「不选 = 工作区根」', () => {
  assert.match(
    runActionsSource,
    /cwd: cwd\?\.trim\(\) \|\| workspace\.value\.root/,
    '弹层不发 cwd 时，runActions.ts:486 必须回落工作区根（上游 ProjectContext 的 getPath()，RunAnythingContextUtils.kt:15-17）',
  )
})

// ── 判据 9：emit 形状（宿主接线请求的前提）─────────────────────────────────────
test('runCommand 的 emit 形状是 { command: string; cwd?: string | null }', () => {
  assert.match(source, /\(event: 'runCommand', payload: \{ command: string; cwd\?: string \| null \}\): void/)
  assert.equal(source.includes("(event: 'runCommand', payload: { command: string }): void"), false, '旧的窄形状不许留下')
  assert.match(source, /emit\('runCommand', cwd \? \{ command: row\.name, cwd \} : \{ command: row\.name \}\)/,
    'pick() 命令行那一支按 contextPath(context, moduleRoots) 传目录')
  assert.match(source, /const cwd = context\.value \? contextPath\(context\.value, moduleRoots\.value\) : null/)
})
