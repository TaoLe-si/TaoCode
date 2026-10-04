// 标签条「多行（wrap）」布局 —— 纯函数 + 接线 + 设置键的机检。
//
// 上游的分支条件不是"放不下了才换行"，而是**设置**：
//   JBTabsImpl.kt:766-773  tabListOptions.singleRow ? ScrollableSingleRowLayout : WrapMultiRowLayout
//   EditorTabbedContainer.kt:582-584  singleRow = UISettings.scrollTabLayoutInEditor
//   UISettingsState.kt:123  默认 true（一行）
//   ApplicationBundle.properties:316  checkbox.editor.tabs.in.single.row=Show tabs in one row
// 换行算法本身在 multiRow/WrapMultiRowLayout.kt 的 splitToRows/doSplitToRows。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TAB_STRIP_ROW_HEIGHT, layoutMultiRow } from '../src/tabStripLayout.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const strip = (layout) => layout.placed.map(entry => [entry.index, entry.row, entry.position, entry.width])

test('装箱：第一行为工具条让位，其余行用整条宽；标签一律按自然宽度画', () => {
  // 条宽 300，工具条 100 ⇒ 第一行只能放两个 100；第二行没有工具条 ⇒ 能放三个。
  const layout = layoutMultiRow({ preferredWidths: [100, 100, 100, 100, 100], stripWidth: 300, moreButtonWidth: 28, sideToolbarMinWidth: 100, gap: 0, rowHeight: 34 })
  assert.deepEqual(strip(layout), [
    [0, 0, 0, 100], [1, 0, 100, 100],
    [2, 1, 0, 100], [3, 1, 100, 100], [4, 1, 200, 100],
  ])
  assert.equal(layout.rowCount, 2)
  assert.ok(layout.placed.every(entry => entry.width === 100), '多行不裁切：上游 SimpleTabsRow.layoutTabs 直接用自然宽')
})

test('间距与"独占一行的超宽标签"照源码形状', () => {
  // gap=10、条宽 250：100 + 10 + 100 = 210 放得下第三个（+10+100=320 > 250）⇒ 换行。
  const gapped = layoutMultiRow({ preferredWidths: [100, 100, 100], stripWidth: 250, moreButtonWidth: 28, gap: 10 })
  assert.deepEqual(strip(gapped), [[0, 0, 0, 100], [1, 0, 110, 100], [2, 1, 0, 100]])
  // 单个标签比整行还宽：它**独占一行**且照原宽画（会溢出到条外），不是被裁成条宽 ——
  // 上游的 else 分支无条件把当前标签开进新行。
  const huge = layoutMultiRow({ preferredWidths: [500, 100], stripWidth: 300, moreButtonWidth: 28 })
  assert.deepEqual(strip(huge), [[0, 0, 0, 500], [1, 1, 0, 100]])
  assert.equal(huge.rowCount, 2)
})

test('多行既没有「…」也不可滚动', () => {
  const layout = layoutMultiRow({ preferredWidths: Array.from({ length: 30 }, () => 120), stripWidth: 400, moreButtonWidth: 28 })
  assert.equal(layout.moreButtonVisible, false, '上游 MultiRowLayout.isWithScrollBar() 返回 false')
  assert.equal(layout.scrollOffset, 0, '上游 getScrollOffset() 恒为 0、scroll(units) 是空实现')
  assert.equal(layout.rowCount, 10, '每行放 3 个 120（第 4 个要 480 > 400），30 个就是 10 行')
  assert.equal(layout.rowHeight, TAB_STRIP_ROW_HEIGHT, '行高取我们自己的常量（与 CSS 的 --tab-strip-row 同值，另一条判据守着）')
})

test('条总高 = 行数 × 行高，且 CSS 与 JS 用的是同一个数', () => {
  const tokens = read('src/tokens.css')
  const token = Number(/--tab-strip-row:\s*(\d+)px/.exec(tokens)?.[1])
  assert.ok(token > 0, 'tokens.css 里没有 --tab-strip-row')
  assert.equal(token, TAB_STRIP_ROW_HEIGHT, 'CSS 与布局各写一个数，窗口一缩放就会错位')
  const view = read('src/tabStripView.ts')
  assert.match(view, /const height = `\$\{multi\.rowCount \* multi\.rowHeight\}px`/,
    '条高必须由布局给：标签是绝对定位的，撑不起容器')
  const css = read('src/style.css')
  assert.match(css, /\.editor-tabs\.tabs-wrapped \{ position: relative; \}/)
  assert.match(css, /\.editor-tabs\.tabs-wrapped \.file-tab \{ position: absolute; top: 0; \}/)
  assert.match(css, /\.editor-tabs\.tabs-wrapped \.tab-toolbar \{ position: absolute; top: 0; right: 0;[^}]*height: var\(--tab-strip-row\)/,
    '工具条只在第一行右侧（对应 withEntryPointToolbar 只在 isFirst 时保留宽度）')
})

test('三种排法由设置决定，且分支只有一处', () => {
  // 上游 `EditorTabbedContainer.kt:657-672` 的 createRowLayout：
  //   一行 + hideTabsIfNeeded  -> ScrollableSingleRowLayout / ScrollableMultiRowLayout
  //   一行 + 挤压标签页         -> CompressibleMultiRowLayout
  //   多行                      -> WrapMultiRowLayout
  const view = read('src/tabStripView.ts')
  // 上游两个分支（`EditorTabbedContainer.kt:657-672`）：挤压/滚动两排都在**一行**这一侧，
  // `!singleRow` 永远是换行排。这里逐条钉住这三支各自的入口条件。
  assert.match(view, /if \(singleRow\(\) && \(separatePinnedRow\(\) \|\| !hideTabsIfNeeded\(\)\)\) \{/,
    '一行 + （固定标签另起一排 或 挤压标签页）才进挤压/滚动那两族')
  assert.match(view, /hideTabsIfNeeded\(\)[^?]*\? layoutScrollableMultiRow/, '这一支里按 hideTabsIfNeeded 选滚动排')
  assert.match(view, /: layoutCompressibleMultiRow\(layoutInput\)/, '另一支是挤压排')
  assert.match(view, /tabMultiLayouts\.value\[pane\] = layoutMultiRow\(layoutInput\)/, '多行那一支仍是换行排（WrapMultiRowLayout）')
  // 两边互斥：一个算出来，另一个要清成 null，否则模板会同时读到两份旧布局。
  assert.match(view, /tabMultiLayouts\.value\[pane\] = null/)
  assert.match(view, /tabStripLayouts\.value\[pane\] = null/)
  // 换档要重算：两个设置键都进了重算的依赖里。
  assert.match(view, /singleRow\(\), hideTabsIfNeeded\(\), separatePinnedRow\(\)\]\.join\('~'\)/)

  const app = read('src/App.vue')
  assert.match(app, /singleRow: \(\) => editorSettings\.value\.tabsInOneRow/)
  assert.match(app, /hideTabsIfNeeded: \(\) => editorSettings\.value\.hideTabsIfNeeded/)
  assert.match(app, /:class="\{ 'tabs-wrapped': tabStripWraps\(pane\) \}" :style="tabStripStyle\(pane\)"/)

  const dialog = read('src/components/EditorTabsSettingsPage.vue')
  // 上游 New UI 是**两组**单选（`EditorTabsConfigurable.kt:59-71`）：外组「一行…/多行」绑
  // scrollTabLayoutInEditor，内组（缩进）「滚动/挤压」绑 hideTabsIfNeeded。两组的 name 必须不同。
  assert.match(dialog, /v-model="oneRow" type="radio" name="tab-one-row"/, '外组'
  )
  assert.match(dialog, /v-model="squeeze" type="radio" name="tab-squeeze"/, '内组')
  assert.match(dialog, /滚动标签页面板/)
  assert.match(dialog, /挤压标签页/)
  assert.match(dialog, /多行/)
  assert.match(dialog, /滚动标签页面板/, '文案取随 IDE 发货的中文包（ApplicationBundle.properties:682）')
  assert.match(dialog, /挤压标签页/, 'ApplicationBundle.properties:685')
  assert.match(dialog, /多行/, 'ApplicationBundle.properties:680')
})

test('设置键在四个口径里都登记了（少一处就会掉键或被判损坏）', () => {
  // 1) 默认值与类型；2) 桥接白名单；3) 原生默认；4) 原生已知键表（不在表里会被 prune 掉）。
  assert.match(read('src/settingsModel.ts'), /defaultEditorSettings: EditorSettings = \{[^}]*tabLimit: 30, tabsInOneRow: true/)
  assert.match(read('src/settingsModel.ts'), /tabLimit: number;[^\n]*tabsInOneRow: boolean/)
  assert.match(read('src/previewSettings.ts'), /key === 'tabLimit' \|\| key === 'tabsInOneRow' \|\| key === 'hideTabsIfNeeded'/)
  // 原生默认值两条都在（中间隔着注释，所以只断言"两条都有"，不断言相邻）。
  assert.match(read('native/settings_schema.cpp'), /\{"tabLimit", 30\},/)
  assert.match(read('native/settings_schema.cpp'), /\{"tabsInOneRow", true\},/)
  assert.match(read('native/settings_schema.hpp'), /"tabLimit", "tabsInOneRow", "hideTabsIfNeeded"/)
  // hideTabsIfNeeded（`UISettingsState.kt:125` 默认 true）也走同一套四口径。
  assert.match(read('src/settingsModel.ts'), /tabsInOneRow: true, hideTabsIfNeeded: true/)
  assert.match(read('native/settings_schema.cpp'), /\{"hideTabsIfNeeded", true\},/)
  // 反例（判据自证）：老项目文件里没有这一键 ⇒ 必须补默认，不能判损坏。
  assert.match(read('native/projects.cpp'), /fill_defaults\(result, \*found\)/,
    '缺键补默认的机制不在了 —— 新键会让旧设置文件读不出来')
})
