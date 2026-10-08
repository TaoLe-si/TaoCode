// `stickyfold` 批次的判据：**粘性行的档位**（层数上限那一格的范围 + 短面板时的跟随语义）与
// **多块面板各自的可视区**。上游坐标全部来自
// `D:\Backup\Downloads\intellij-community-master\intellij-community-master`（本 lane 自己开文件取的）：
//   · `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/configurable/StickyLinesConfigurableUI.kt:40`
//     = `intTextField(UINumericRange(5, 1, 20).asRange())` ⇒ 设置页那一格：默认 5、最小 1、**最大 20**；
//   · `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:94` = 默认 5，
//     同文件 `:549-556` 的 `setStickyLineLimit` **不做范围校验**（⇒ 20 是设置页的档、不是编辑器的档，
//     模块侧不许拿它去夹用户存下来的值）；
//   · `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/VisualStickyLines.kt:125-127`
//     + `:144-148` + `:158-160` = 「排到放不下就停」（**前缀**），不是「总高度放不下就整块不画」；
//   · `StickyLinesManager.kt:15-34`（每个编辑器一个 manager）+ `:86-99`（`activeVisualArea` 存的是
//     **本编辑器**的可视区）⇒ 一块面板的滚动量筛不出另一块面板的层。
// 自定义折叠占位文字那一族的取值链判据在 `tests/folding-placeholder.test.mjs`（同一批次里补的两条见该文件末）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import {
  STICKY_LINES_LIMIT_DEFAULT, STICKY_LINES_LIMIT_MAX, STICKY_LINES_LIMIT_MIN,
  createStickyLines, stickyViewRowBudget,
} from '../src/stickyLines.ts'

test('stickyLinesLimit 档位 = 上游设置页那一格的 UINumericRange(5, 1, 20)', () => {
  assert.equal(STICKY_LINES_LIMIT_DEFAULT, 5, '默认档（EditorSettingsExternalizable.java:94）')
  assert.equal(STICKY_LINES_LIMIT_MIN, 1, '最小档（StickyLinesConfigurableUI.kt:40 的 UINumericRange 第二参）')
  assert.equal(STICKY_LINES_LIMIT_MAX, 20, '最大档（同上第三参）；本仓三处校验停在 10 ⇒ 差 10 档，见接线请求 R-1')
})

test('模块不夹取用户存下来的 limit：stickyViewRowBudget 在没有度量时原样交回（含 25 这种超设置页档的值）', () => {
  // 上游读取侧不夹（EditorSettingsExternalizable.java:549-556 setter 无校验 →
  // EditorSettingsState.kt:227 原样读 → SettingsImpl.kt:729 原样给编辑器）；
  // 本模块只按 >0 出层，**不许** Math.min(limit, STICKY_LINES_LIMIT_MAX)。
  assert.equal(stickyViewRowBudget({ id: 'pane' }, 25), 25, '没有度量 ⇒ 25 还是 25（不夹到 20）')
  assert.equal(stickyViewRowBudget({ id: 'pane' }, 0), 0, '0 档给 0（本仓的闸门在 createStickyLines 里，见下）')
  assert.equal(stickyViewRowBudget({ id: 'pane' }, -3), 0, '负数不产生「倒着 slice」的形状')
  assert.equal(stickyViewRowBudget({ id: 'pane' }, 2.7), 2, '按整行取（半个位置排不下一条）')
})

test('短面板时按「放得下的那一前缀」出层（VisualStickyLines.kt:144-148 + :158-160）', () => {
  // 反解上游那个不等式：rows*lineHeight + 2*lineHeight <= viewportHeight/2。
  assert.equal(stickyViewRowBudget({ id: 'p', lineHeight: 20, viewportHeight: 200 }, 5), 3, '200/2=100：3 行(60+40)放得下、4 行放不下')
  assert.equal(stickyViewRowBudget({ id: 'p', lineHeight: 20, viewportHeight: 200 }, 2), 2, '上限本身更小时按上限')
  assert.equal(stickyViewRowBudget({ id: 'p', lineHeight: 20, viewportHeight: 70 }, 5), 0, '进循环前那一次 isPanelTooBig(0)：40 > 35 ⇒ 一条都不画')
  assert.equal(stickyViewRowBudget({ id: 'p', lineHeight: 20, viewportHeight: 70 }, 0), 0, '0 档仍然是 0')
  // 度量缺失（只给一项）时**不做这一档判断**，与旧行为逐字一致（宿主还没透度量时不许凭空少画）。
  assert.equal(stickyViewRowBudget({ id: 'p', lineHeight: 20 }, 5), 5, '没给 viewportHeight ⇒ 不夹')
  assert.equal(stickyViewRowBudget({ id: 'p', viewportHeight: 200 }, 5), 5, '没给 lineHeight ⇒ 不夹')
})

// 五层嵌套：每层跨度都够 5 行（`scopeMinSize`，`VisualStickyLines.kt:18-19`），起始行都已在顶行 40 之前滚出。
const NESTED = ref([
  { name: 'A', kind: 5, startLine: 0, endLine: 60, startChar: 0, endChar: 0 },
  { name: 'B', kind: 6, startLine: 5, endLine: 58, startChar: 0, endChar: 0 },
  { name: 'C', kind: 6, startLine: 10, endLine: 56, startChar: 0, endChar: 0 },
  { name: 'D', kind: 6, startLine: 15, endLine: 54, startChar: 0, endChar: 0 },
  { name: 'E', kind: 6, startLine: 20, endLine: 52, startChar: 0, endChar: 0 },
])

test('createStickyLines：面板只放得下 3 行时出**最外三条**，不是整块清空', () => {
  const settings = ref({ showStickyLines: true, stickyLinesLimit: 5 })
  const lines = createStickyLines({
    editorSettings: settings, outline: NESTED, currentLine: () => 45,
    view: () => ({ id: 'pane', firstVisibleLine: 40, lineHeight: 20, viewportHeight: 200 }),
  }).stickyLines
  assert.deepEqual(lines.value.map(line => line.name), ['A', 'B', 'C'], '前缀从最外层起排（:144 的 break 之前收的都是外层）')
  // 面板再矮一档：一条都不画（上游进循环前那一次判断，`:125-127`）。
  const tiny = createStickyLines({
    editorSettings: settings, outline: NESTED, currentLine: () => 45,
    view: () => ({ id: 'pane', firstVisibleLine: 40, lineHeight: 20, viewportHeight: 70 }),
  }).stickyLines
  assert.deepEqual(tiny.value, [], '放不下一条时一条都不出')
})

test('退化路径的顶行只属于本面板：两块面板时共享的 firstVisibleLine 不参与筛选', () => {
  // 宿主只给了「一份滚动量」却声明了两块面板 —— 那份共享值描述不了两块（StickyLinesManager.kt:88
  // 的 activeVisualArea 是一块面板一份），必须谁也不许拿来筛另一栏的层。
  const outline = ref([
    { name: 'Class', kind: 5, startLine: 0, endLine: 40, startChar: 0, endChar: 0 },
    { name: 'outer()', kind: 6, startLine: 10, endLine: 30, startChar: 0, endChar: 0 },
    { name: 'inner()', kind: 6, startLine: 20, endLine: 25, startChar: 0, endChar: 0 },
  ])
  const settings = ref({ showStickyLines: true, stickyLinesLimit: 3 })
  const many = createStickyLines({
    editorSettings: settings, outline, currentLine: () => 99,
    firstVisibleLine: () => 5,
    views: () => [{ id: 'left' }, { id: 'right' }],
    currentLineOf: id => (id === 'left' ? 22 : 21),
  }).stickyLinesByView
  assert.deepEqual(many.value.get('left')?.map(line => line.name), ['Class', 'outer()', 'inner()'],
    '左栏按自己的光标行出三层：共享的顶行 5 不许把 outer/inner 筛掉')
  assert.deepEqual(many.value.get('right')?.map(line => line.name), ['Class', 'outer()', 'inner()'], '右栏同理')
  // 另一侧也要钉住：宿主**只**声明一块面板时，那份共享顶行仍然是它的滚动量（W-5 的过渡接线形状，
  // 行为逐字不变），否则这条判据就成了「随便删掉 deps.firstVisibleLine」。
  const one = createStickyLines({
    editorSettings: settings, outline, currentLine: () => 22,
    firstVisibleLine: () => 5,
    view: () => ({ id: 'only' }),
  }).stickyLines
  assert.deepEqual(one.value.map(line => line.name), ['Class'], '单块面板：共享顶行照旧生效')
  const none = createStickyLines({
    editorSettings: settings, outline, currentLine: () => 22, firstVisibleLine: () => 5,
  }).stickyLines
  assert.deepEqual(none.value.map(line => line.name), ['Class'], '没声明面板时（现状 App.vue 的形状）一字不改')
})
