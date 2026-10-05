// 问题视图「按诊断码分组」这条链的端到端判据（桶 2 · 四环）。
//
// 上游依据（全部按本地解压的上游树核过行号；本仓没有 tool id，用诊断码承接，
// 等价关系的论证见 src/problemsView.ts 的头注与 docs/batch-2026-10-06-bucket2b2.md）：
//   ① 分组维度：`ProblemsViewState.kt:28` `var groupByToolId: Boolean by property(false)`
//      —— 开关落在 `ProblemsViewToggleAction.kt:12`，建树在
//      `ProblemsViewHighlightingChildrenBuilder.kt:53-62`（`groupBy { it.group }`；
//      **`group == null` 的问题不挂组节点**，直接挂在父节点下），
//      组名 = 检查项显示名（`HighlightingProblem.kt:85-89`），组节点画的就是这个串
//      （`ProblemsViewGroupNode.kt:11-19`）；同层排序 = 问题节点在组节点之前
//      （`ProblemsViewNodeComparator.kt:19-20`）+ 组之间按名自然序（`:25`）。
//   ② 面板项与文案：`intellij.platform.problemView.ui.xml:82`（Options 弹层的图标
//      `AllIcons.Actions.GroupBy`）与 `:96-98`（`ProblemsView.GroupByToolId`，
//      图标 `AllIcons.ObjectBrowser.SortByType`）；文案原文
//      `platform/platform-resources-en/src/messages/ActionsBundle.properties:2659`
//      （`action.ProblemsView.GroupByToolId.text=Group by Inspection`）与 `:2656`
//      （`group.ProblemsView.Show.text=Show`，即「选项…」弹层里的那一段）。
//   ③ 可见性：上游的过滤器是**逐条问题**的谓词（`ProblemFilter.kt:17-22`），
//      "整族显隐"给在「Show Other Problems」那一档（`ProblemFilter.kt:62-75`，
//      文案 `ProblemsViewBundle.properties` 的 `problems.view.highlighting.other.problems.show`）
//      与 profile 的按检查项停用（`InspectionProfileImpl.java:804`）；
//      选中态本身不落存档 —— `ProblemsViewState.kt:20-33` 的字段清单里没有"选中的组"。
//   ④ 抑制入口：上游问题视图只有一个弹层
//      （`ShowProblemsViewQuickFixesAction.kt:78-92` 的 `IntentionListStep(…, IntentionSource.PROBLEMS_VIEW)`，
//      来源枚举的注释就写着「Quick fixes button in the Problems tool window」：
//      `platform/lang-impl/src/com/intellij/codeInsight/intention/IntentionSource.java:37-40`），
//      而抑制条目本身就是一个意图（`SuppressIntentionAction.java:19`
//      `implements Iconable, IntentionAction`）⇒ **抑制与快速修复同源同弹层**，
//      没有单独的「抑制」菜单；弹层在没有意图时整项置灰（`ShowProblemsViewQuickFixesAction.kt:36-44`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { loadSfc } from './vue-sfc-loader.mjs'

const {
  codeOf, focusRows, groupKeyOf, groupMuteKeys, groupProblems, MUTABLE_GROUPINGS, sourceOf,
} = await import('../src/problemsView.ts')
const {
  applyInspectionProfile, resetInspectionProfile, setInspectionToolEnabled, toolSettingFor,
} = await import('../src/inspectionProfile.ts')

const root = new URL('..', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
const row = (over = {}) => ({
  path: 'src/a/One.ts', line: 0, character: 0, severity: 2, message: 'm', source: '', ...over,
})
const NO_SOURCE = sourceOf(row({ source: '' }))
const coded = [
  row({ source: 'tsserver', code: '6133', message: 'unused import', path: 'src/b/Two.ts' }),
  row({ source: 'tsserver', code: '2304', message: 'Cannot find name x' }),
  row({ source: 'eslint', code: '6133', message: 'unused var', path: 'src/c/Three.ts' }),
  row({ message: '没有码的一条' }),
]

// —— ① 分组维度：键、未分组、组序 ——

test('groupKeyOf 就是分组用的那一把键（面板的过滤与组头必须读同一份）', () => {
  assert.deepEqual(coded.map(r => groupKeyOf(r, 'code')), ['6133', '2304', '6133', ''],
    '没有码 ⇒ 键为空串 = 不进组（上游 group == null 那一支）')
  assert.deepEqual(coded.map(r => groupKeyOf(r, 'inspection')),
    ['tsserver::6133', 'tsserver::2304', 'eslint::6133', ''])
  assert.equal(groupKeyOf(coded[0], 'file'), 'src/b/Two.ts')
  assert.equal(groupKeyOf(coded[3], 'directory'), 'src/a')
  assert.equal(groupKeyOf(coded[3], 'source'), NO_SOURCE, '「按来源」仍走占位档（本仓自己的档）')
  assert.equal(groupKeyOf(coded[0], 'none'), '', '不分组时没有键可言')
})

test('按诊断码分组的组顺序：未分组的那批在最前，其余按组名自然序', () => {
  const groups = groupProblems(coded, 'code')
  assert.deepEqual(groups.map(g => g.key), ['', '2304', '6133'],
    '问题节点先于组节点（ProblemsViewNodeComparator.kt:19-20）+ 组间自然序（:25）')
  assert.equal(groups[0].label, '', '未分组的那批不编组名')
  assert.deepEqual(groups[0].rows.map(r => r.message), ['没有码的一条'])
  assert.equal(groups[2].rows.length, 2, '同一码跨两个检查器仍然并成一档（这是"按码"与"按项"的差别）')
})

test('全表都没有码时，按诊断码分组不会变成空面板', () => {
  const groups = groupProblems([row({ message: 'a' }), row({ message: 'b', path: 'src/z.ts' })], 'code')
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].rows.map(r => r.message), ['a', 'b'], '与上游同形状：一条组节点都没造')
})

// —— ③ 可见性：只看某一组 ——

test('focusRows：焦点键命中的行留下，null = 全显示，不分组时不做空动作', () => {
  assert.deepEqual(focusRows(coded, 'code', '6133').map(r => r.source), ['tsserver', 'eslint'])
  assert.deepEqual(focusRows(coded, 'code', '').map(r => r.message), ['没有码的一条'],
    '未分组的那批也能单独聚焦（键就是空串，与 groupProblems 的第一格同一把）')
  assert.equal(focusRows(coded, 'code', null).length, 4, 'null = 没有焦点')
  assert.equal(focusRows(coded, 'none', '随便什么').length, 4, '不分组时没有组可焦')
  assert.equal(focusRows(coded, 'file', '不存在的路径').length, 0)
  // 谓词逐条、且与分组读同一把键（面板上的组头按钮点谁就只剩谁）。
  for (const group of groupProblems(coded, 'inspection')) {
    assert.deepEqual(focusRows(coded, 'inspection', group.key).map(r => groupKeyOf(r, 'inspection')),
      group.rows.map(() => group.key))
  }
})

// —— ④ 抑制入口：组级停用的键集合 + 真的把这一族请出问题表 ——

test('code 档的组级停用覆盖组内每一个检查项身份（跨检查器的同一个码不能只停一半）', () => {
  const group = groupProblems(coded, 'code').find(g => g.key === '6133')
  assert.deepEqual(groupMuteKeys(group, 'code'), ['tsserver::6133', 'eslint::6133'])
  assert.deepEqual(groupMuteKeys({ key: '', rows: [coded[3]] }, 'code'), [], '未分组的那批没有组头按钮')
  assert.deepEqual(groupMuteKeys(group, 'file'), [], '按文件分组时不给停用键（不是检查项）')
  assert.deepEqual(MUTABLE_GROUPINGS, ['inspection', 'source', 'code'])
})

test('停用整组 ⇒ 这一族问题根本不再进表（profile 门控与面板同一把键）', () => {
  resetInspectionProfile()
  const group = groupProblems(coded, 'code').find(g => g.key === '6133')
  for (const key of groupMuteKeys(group, 'code')) setInspectionToolEnabled(key, false)
  assert.equal(applyInspectionProfile('tsserver', 2, '6133'), null)
  assert.equal(applyInspectionProfile('eslint', 2, '6133'), null)
  assert.equal(applyInspectionProfile('tsserver', 1, '2304'), 1, '别的码不受牵连')
  assert.equal(toolSettingFor('eslint::6133').enabled, false)
  resetInspectionProfile()
})

test('source 档的「（无来源）」占位组不给停用键（不往 profile 写没人读的键）', () => {
  assert.deepEqual(groupMuteKeys({ key: NO_SOURCE, rows: [coded[3]] }, 'source'), [])
  assert.deepEqual(groupMuteKeys({ key: 'tsserver', rows: [coded[0], coded[1]] }, 'source'), ['tsserver'])
})

// —— ②③④ 面板接线（组件不可在 node 里渲染，钉住源码锚点） ——

test('② 面板下拉：诊断码那档有图标、有上游文案坐标的 title', () => {
  const panel = read('src/components/ProblemsPanel.vue')
  assert.match(panel, /<option value="code">/)
  assert.match(panel, /Group :size="iconSize\.inline"/, '分组下拉缺前缀图标（上游 ui.xml:96-98）')
  assert.match(panel, /ProblemsView\.GroupByToolId/, 'title 要写上游动作名，文案才有出处')
  assert.match(panel, /按诊断码（承接上游的 tool id）/)
})

test('③ 面板真的把「只看这一组」接进了可见性链路（不是只写了纯函数）', () => {
  const panel = read('src/components/ProblemsPanel.vue')
  assert.match(panel, /focusRows\(sortProblems\(\s*filterProblems\(visibleProblems\.value/)
  assert.match(panel, /grouping\.value, focus\.value\?\.key \?\? null/, '焦点键没传给过滤')
  assert.match(panel, /@click="setFocus\(group\)"/, '组头上没有进入焦点的按钮')
  assert.match(panel, /@click="focus = null"/, '没有退出焦点的入口')
  assert.match(panel, /watch\(grouping, \(\) => \{ focus\.value = null \}\)/, '换分组档没清焦点，旧键会把表滤空')
})

test('④ 面板的抑制入口仍按诊断码取规则，并与快速修复同处一个菜单（上游同一个弹层）', () => {
  const panel = read('src/components/ProblemsPanel.vue')
  assert.match(panel, /row\.code\?\.trim\(\) \|\| ruleIdFromMessage\(row\.message\)/,
    '抑制插的是诊断码，不是从消息里抠出来的')
  assert.match(panel, /suppressOptionsFor\(problem, suppressionLanguageFor\(row\.path\)\)/)
  assert.match(panel, /noteLocalSuppression\(menu\.row\)/)
  assert.match(panel, /IntentionListStep/, '注释里没有上游"同一个弹层"的出处')
})

test('④ 组头按钮按停用键集合的有无渲染（折不出身份就不渲染，不放假控件）', () => {
  const panel = read('src/components/ProblemsPanel.vue')
  assert.match(panel, /v-if="group\.muteKeys\.length"/)
  assert.match(panel, /muteKeys: groupMute\.value \? muteKeysFor\(group\) : \[\]/)
  assert.match(panel, /return groupMuteKeys\(group, grouping\.value\)/, '面板没有改用纯函数那一把')
  assert.match(panel, /for \(const key of keys\) setInspectionToolEnabled\(key, false\)/, '只停了第一把键')
})

// —— 真实渲染（夹具见 tests/vue-sfc-loader.mjs）：分组档与组头按钮不是只写在源码里，而是真的画出来 ——

/** 用 localStorage 桩把面板的初值设成「按诊断码分组」，然后 SSR 渲染整个组件。 */
async function renderWithGrouping(state, rows) {
  const store = new Map([[`taocode.problemsPanel`, JSON.stringify(state)]])
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: key => store.delete(key),
  }
  const { component } = loadSfc('src/components/ProblemsPanel.vue')
  const app = createSSRApp({ render: () => h(component, { problems: rows, fixing: false, fixDisabled: false }) })
  app.config.warnHandler = message => { if (!message.startsWith('Failed to resolve component:')) throw new Error(message) }
  return renderToString(app)
}

test('渲染：按诊断码分组时组头按码出现、没码的那条不带组头', async () => {
  const html = await renderWithGrouping({ grouping: 'code' }, coded)
  assert.match(html, /tsserver \(6133\)/, '组头标题没走检查项显示名')
  assert.match(html, /tsserver \(2304\)/)
  assert.ok(html.indexOf('没有码的一条') < html.indexOf('tsserver (2304)'),
    '未分组的问题排在组节点之前（ProblemsViewNodeComparator.kt:19-20）')
  assert.doesNotMatch(html, /（无诊断码）/, '不渲染编造出来的占位组名')
  assert.match(html, /problems-group-focus/, '组头上没有进入「只看这一组」的按钮')
  assert.match(html, /problems-group-mute/, 'code 档的组头上没有停用入口')
})

test('渲染：不分组时既没有组头也没有焦点标记（不放假控件）', async () => {
  const html = await renderWithGrouping({ grouping: 'none' }, coded)
  assert.doesNotMatch(html, /problems-group-focus/, '不分组时不该画「只看这一组」')
  assert.doesNotMatch(html, /problems-group-mute/, '不分组时不该画「停用此检查项」')
  assert.doesNotMatch(html, /problems-group-row/, '不分组时不该有组头行')
  assert.match(html, /没有码的一条/, '不分组时问题照常列出')
})
