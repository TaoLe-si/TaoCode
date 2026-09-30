// 「编辑器 › 代码折叠」设置（B4 §C②）的判据：默认值/映射照上游 `CodeFoldingSettings.java:7-11` +
// `LspFoldingBuilder.kt:41-46`，文案照本机 IDEA 2026.2 中文包（见 src/editorFoldingSettings.ts 的模块注释），
// 页面落点照 `CodeFoldingConfigurable.kt:26-27`。
// 另一件同样重要的事：**上游五个开关里只渲染本仓有消费者的两条**（不渲染空壳），这条也钉住。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  autoCollapseKinds, CODE_FOLDING_PAGE_KEY, CODE_FOLDING_PAGE_TITLE, defaultCodeFoldingSettings,
  FOLD_BY_DEFAULT_GROUP, FOLDING_SETTING_ROWS, kindOfSetting,
} from '../src/editorFoldingSettings.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('默认值照上游：Import 默认折、自定义折叠区域默认不折', () => {
  // COLLAPSE_IMPORTS = true / COLLAPSE_CUSTOM_FOLDING_REGIONS = false（CodeFoldingSettings.java:7-11）
  assert.deepEqual(defaultCodeFoldingSettings, { collapseImports: true, collapseCustomRegions: false })
})

test('LSP 路径只把 imports / region 两个 kind 映射到设置（LspFoldingBuilder.kt:41-46）', () => {
  const off = { collapseImports: false, collapseCustomRegions: false }
  assert.deepEqual(autoCollapseKinds(off), [], '两个开关都关 ⇒ 打开时没有预折叠的 kind')
  assert.deepEqual(autoCollapseKinds(defaultCodeFoldingSettings), ['imports'], '默认只预折叠 imports')
  assert.deepEqual(autoCollapseKinds({ collapseImports: true, collapseCustomRegions: true }), ['imports', 'region'])
  // comment 那一条上游显式给 null（LSP 与 IDEA 语义对不上）⇒ 本仓也不映射。
  assert.ok(!autoCollapseKinds({ collapseImports: true, collapseCustomRegions: true }).includes('comment'))
  assert.equal(kindOfSetting('collapseImports'), 'imports')
  assert.equal(kindOfSetting('collapseCustomRegions'), 'region')
})

test('页面文案逐字取本机 IDEA 2026.2 中文包', () => {
  // plugins/localization-zh/lib/localization-zh.jar → messages/ApplicationBundle.properties:
  // group.code.folding=代码折叠 / label.fold.by.default=默认折叠: / checkbox.collapse.title.imports=Import /
  // checkbox.collapse.custom.folding.regions=自定义折叠区域
  assert.equal(CODE_FOLDING_PAGE_TITLE, '代码折叠')
  assert.equal(FOLD_BY_DEFAULT_GROUP, '默认折叠:')
  assert.deepEqual(FOLDING_SETTING_ROWS.map(row => row.label), ['Import', '自定义折叠区域'])
  assert.equal(CODE_FOLDING_PAGE_KEY, 'editor.preferences.folding', '注册 id 照 CodeFoldingConfigurable.kt:31')
})

test('只渲染有消费者的两行（文件头/方法体/文档注释不渲染空壳）', () => {
  const page = read('src/components/CodeFoldingSettingsPage.vue')
  // 复选框只有一处，且是 v-for 渲染 FOLDING_SETTING_ROWS（没有任何硬写的第三个开关）。
  const rows = page.match(/class="checkbox-row"/g) ?? []
  assert.equal(rows.length, 1, `页面里只该有 v-for 那一处复选框，实际 ${rows.length} 处`)
  assert.match(page, /v-for="row in FOLDING_SETTING_ROWS"/)
  assert.equal(FOLDING_SETTING_ROWS.length, 2)
  // 那三条文字只允许出现在说明里（讲清楚为什么不渲染），不许出现在任何控件标签里。
  for (const label of ['文件头', '方法体', '文档注释']) {
    assert.ok(!new RegExp(`<span>\\s*${label}`).test(page), `${label} 不该被渲染成控件`)
  }
  // 设置树里也只有一个页面节点，挂在「编辑器」下面。
  const tree = read('src/settingsTreeMeta.ts')
  assert.match(tree, /\{ key: 'editor\.preferences\.folding', label: '代码折叠'[^}]*parent: 'editor'/)
})

test('对话框里挂的是拆出来的页面组件（宿主不塞逻辑，且仍贴着机检上限）', () => {
  const dialog = read('src/components/SettingsDialog.vue')
  assert.match(dialog, /<CodeFoldingSettingsPage :settings="editor" :busy="busy" @reset="resetEditorPage\(\)" \/>/)
  assert.match(dialog, /data-page="editor\.preferences\.folding"/, '面板要与设置树那一页对上')
  assert.ok(!dialog.includes('collapseImports'), '具体开关的渲染在子组件里，宿主不掺和')
})

test('设置被接受并保存（前端白名单 + 编辑器设置默认值 + 原生键表）', () => {
  const bridge = read('src/bridge.ts')
  assert.match(bridge, /key === 'collapseImports' \|\| key === 'collapseCustomRegions'/, 'settings.update 要认这两个键')
  const model = read('src/settingsModel.ts')
  assert.match(model, /collapseImports: boolean; collapseCustomRegions: boolean/)
  assert.match(model, /defaultEditorSettings: EditorSettings = \{ collapseImports: true, collapseCustomRegions: false,/)
  // 原生那份「唯一键表」+ 默认值表也必须认这两个键：只在设置页上勾一下、保存却被原生拒了，
  // 真机上踩过（白名单漏登 ⇒ 报 INVALID_SETTINGS，界面看不出，折叠行为也不变）。
  const schema = read('native/settings_schema.hpp')
  assert.match(schema, /"collapseImports", "collapseCustomRegions",/, 'native 键表白名单要登记这两键')
  const defaults = read('native/settings_schema.cpp')
  assert.match(defaults, /\{"collapseImports", true\}, \{"collapseCustomRegions", false\},/, 'native 默认值要与上游一致')
})

test('编辑器把「代码折叠」设置交给折叠控制器（顺序与串行化都在那个模块里）', () => {
  const editor = read('src/components/CodeEditor.vue')
  // 宿主只注入依赖：路径 / 编辑器 / 两族的开关 / 区间怎么取。
  assert.match(editor, /const folding = createFoldingController\(\{/)
  assert.match(editor, /foldingKinds: \(\) => FOLDING_SETTING_ROWS\.map\(row => \(\{/)
  assert.match(editor, /kind: kindOfSetting\(row\.key\),/, '两族的 kind 由设置行的键推出来')
  assert.match(editor, /collapse: props\.settings\[row\.key\] \?\? defaultCodeFoldingSettings\[row\.key\]/)
  assert.match(editor, /fetchRanges: async \(\) => \{[\s\S]{0,200}kind: 'foldingRange'/, '区间仍走 lsp.request 的 foldingRange')
  // 设置一改就重算（上游 applyCodeFoldingSettingsChanges）；关标签/换文件前存档。
  assert.match(editor, /FOLDING_SETTING_ROWS\.map\(row => props\.settings\[row\.key\]\)[\s\S]{0,40}folding\.applyDefaults\(\)/, '设置一改就重算')
  assert.match(editor, /onBeforeUnmount\(\(\) => \{ folding\.capture\(\)/)
  assert.match(editor, /watch\(\(\) => props\.path, \(\) => \{ folding\.capture\(\)/)

  // 管道本体：顺序是语义（先存后折默认），并且必须串行。
  const controller = read('src/editorFoldingController.ts')
  const run = controller.slice(controller.indexOf('async function run()'))
  const order = ['capture()', 'setFoldingRanges.of(ranges)', 'rememberCandidates(', 'applyDefaults()', 'dropStale()', 'restore()']
  let last = -1
  for (const step of order) {
    const at = run.indexOf(step)
    assert.ok(at > last, `管道顺序不对：${step}`)
    last = at
  }
  assert.match(controller, /if \(busy\) \{ again = true; return \}/, '管道必须串行（两轮并存会把覆盖状态记错）')
  assert.match(controller, /flushFoldState\(\)/, '存完顺带安排落盘（上游是 dispose 时交给 saveFoldingState）')
  assert.match(controller, /for \(const entry of deps\.foldingKinds\(\)\) foldKinds\(view, \[entry\.kind\], entry\.collapse\)/,
    '按 kind 折/展开（关掉开关要展开回去）')
  const folding = read('src/editorFolding.ts')
  assert.match(folding, /export function foldKinds\(view: EditorView, kinds: readonly string\[\], collapse: boolean\)/)
  // 光标严格落在区间里就不折（上游 shouldExpandNewRegion 的 caretInsideRange 分支）
  assert.match(folding, /return !offsets \|\| !caretInsideRange\(caret, offsets\)/, '折的时候要跳过含光标的那几条')
})