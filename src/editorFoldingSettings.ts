// 「代码折叠」设置 —— 上游 `platform/core-api/src/com/intellij/codeInsight/folding/CodeFoldingSettings.java`
// 那五个开关在本仓的落点（判决 `docs/inventory/verdict-folding.md` 的 `CodeFoldingSettings` 行）。
//
// 上游那五个：
//   COLLAPSE_FILE_HEADER=true / COLLAPSE_IMPORTS=true / COLLAPSE_DOC_COMMENTS=false /
//   COLLAPSE_METHODS=false / COLLAPSE_CUSTOM_FOLDING_REGIONS=false（`:7-11`），
// 落在设置页「编辑器 › 代码折叠」（`CodeFoldingConfigurable.kt:26-27`，id `editor.preferences.folding`），
// 五条复选框由 `BaseCodeFoldingOptionsProvider.kt:17-21` 挂在分组「常规」下（`title.general`）。
//
// **本仓只接 LSP 路径真会读的那两个**：`platform/lsp-impl/src/impl/features/folding/LspFoldingBuilder.kt:41-46`
// 把折叠区间的 `kind` 映射到设置 —— `Imports → COLLAPSE_IMPORTS`、`Region → COLLAPSE_CUSTOM_FOLDING_REGIONS`，
// 而 `Comment` 那一条**上游自己写了 null**（注释：LSP 与 IDEA 的语义对不上），其余 kind 也是 null。
// 另外三个（文件头 / 方法体 / 文档注释）只有**语言侧 builder** 读（`JavaCodeFoldingSettingsBase.java:67/106/116`、
// `KotlinFoldingBuilder.kt:220`、`PythonFoldingBuilder.kt:67`）—— 本仓的折叠区间全部来自 LSP，没有语言侧
// builder，所以那三行**不渲染**（不留假控件），登记在判决表里。
//
// 文案取本机 IDEA 2026.2 的中文包（`plugins/localization-zh/lib/localization-zh.jar` →
// `messages/ApplicationBundle.properties`）：`group.code.folding=代码折叠`、`label.fold.by.default=默认折叠:`、
// `title.general=常规`、`checkbox.collapse.title.imports=Import`、
// `checkbox.collapse.custom.folding.regions=自定义折叠区域`。

/** `CodeFoldingSettings` 里本仓有消费者的两格（默认值照上游 `CodeFoldingSettings.java:7-11`）。 */
export interface CodeFoldingSettingsState {
  collapseImports: boolean
  collapseCustomRegions: boolean
}

export const defaultCodeFoldingSettings: CodeFoldingSettingsState = {
  collapseImports: true,        // COLLAPSE_IMPORTS = true
  collapseCustomRegions: false, // COLLAPSE_CUSTOM_FOLDING_REGIONS = false
}

/** 设置页那一页的标题与分组（中文包原字，见文件头）。 */
export const CODE_FOLDING_PAGE_TITLE = '代码折叠'
export const CODE_FOLDING_PAGE_KEY = 'editor.preferences.folding'
export const FOLD_BY_DEFAULT_GROUP = '默认折叠:'

/** 两行复选框：键 ↔ 文案（`BaseCodeFoldingOptionsProvider.kt:17-21` 的顺序里只留这两条）。 */
export interface FoldingSettingRow { key: keyof CodeFoldingSettingsState; label: string }
export const FOLDING_SETTING_ROWS: readonly FoldingSettingRow[] = [
  { key: 'collapseImports', label: 'Import' },
  { key: 'collapseCustomRegions', label: '自定义折叠区域' },
]

/**
 * 打开文件时要**预折叠**的 LSP `kind`（`LspFoldingBuilder.kt:41-46` 的 `collapsedByDefault`）。
 * 这里是 LSP 路径的全部映射：`comment` 上游给 null（语义对不上），其余 kind 不动。
 */
export function autoCollapseKinds(settings: CodeFoldingSettingsState): readonly string[] {
  const kinds: string[] = []
  if (settings.collapseImports) kinds.push('imports')
  if (settings.collapseCustomRegions) kinds.push('region')
  return kinds
}

/** 单个开关对应哪个 `kind`（设置改了以后要知道去折/展开哪一族）。 */
export function kindOfSetting(key: keyof CodeFoldingSettingsState): string {
  return key === 'collapseImports' ? 'imports' : 'region'
}
