// 高亮级别与问题呈现 —— 上游 `HighlightDisplayLevel` 一族（`platform/analysis-impl` 与
// `platform/lang-api` 的 `codeHighlighting/HighlightDisplayLevel`、`HighlightSeverity`、
// `ProblemDescriptor` 的严重度面）在 DOM/问题面板侧的等价物。
//
// 逐条对照（本行以下三条坐标本轮**重新开过**，行号按现树订正）：
//   · `platform/analysis-api/src/com/intellij/lang/annotation/HighlightSeverity.java`：
//     严重度**不是枚举顺序**，比的是那条 `myVal`（`:33` 声明、`:192-195` 的 `compareTo`
//     = `Integer.compare(myVal, …)`）：INFORMATION 10（`:43-49`）、TEXT ATTRIBUTES 11（`:52-58`）、
//     SERVER PROBLEM 100（`:64-71`）、INFO 200（`:76-83`，**@Deprecated**，`:73-74` 就是
//     「用 WEAK_WARNING」）、WEAK WARNING 200（`:86-93`）、WARNING 300（`:99-106`）、
//     ERROR 400（`:112-119`）⇒ 注册出来的标准档是 **7 档**（`DEFAULT_SEVERITIES` `:124-125`），
//     而且 **INFO 与 WEAK_WARNING 的 myVal 相等**（都是 200）—— 上游没有「INFO 一定比
//     WEAK_WARNING 弱」这一档，二者谁前谁后由注册表的次序决定
//     （`SeverityRegistrar.java:80-89` 的 `CORE_STANDARD_SEVERITIES` 把 INFO 写在 WEAK_WARNING
//     之前，`:587` 的 `defaultOrder.sort(null)` 是**稳定**排序 ⇒ 同值时保持声明序；
//     `TrafficLightRenderer.kt:374` 再 `indices.reversed()` 倒过来出，于是状态栏的先后是
//     ERROR、WARNING、WEAK WARNING、INFO —— 与本仓的 rank 次序一致，但**依据是这两条**，
//     不是"枚举顺序"）。
//   · `getCountMessage(int)` 在 `HighlightSeverity.java:176-179`（`:180` 是空行）—— 它只出
//     「N errors」这类**计数文案**，不管图标也不管排序；状态栏那一格用它的位置是
//     `TrafficLightRenderer.kt:383`（`SeverityStatusItem(severity, icon, count, severity.getCountMessage(count))`，
//     `icon` 来自 `:381-382` 的 `getRendererIconBySeverity`，实现在
//     `SeverityRegistrar.java:325-332` = `HighlightDisplayLevel.find(severity)` 的
//     `defaultIcon ? level.getIcon() : level.getOutlineIcon()`）。
//     派单里点名的第三个坐标 `PrintElementGeneratorImpl.kt:277-278` **与本域无关**：那个文件在
//     `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/`，`:277-278` 是
//     `VERY_LONG_EDGE_PART_SIZE = 250` / `LONG_EDGE_PART_SIZE = 1` 两枚**图线边长常量**，
//     全树 `find` 也只命中 vcs-log 那一份 ⇒ 本仓不拿它当严重度依据（订正留痕）。
//   · 图标/颜色的真源是 `platform/analysis-api/src/com/intellij/codeHighlighting/HighlightDisplayLevel.kt`：
//     ERROR = `AllIcons.General.InspectionsError` + `ERRORS_ATTRIBUTES`（`:135-140`），
//     WARNING / WEAK_WARNING / INFO **同一枚** `AllIcons.General.InspectionsWarning`
//     （`:143-148`、`:169-174`、`:164-166`），描边档是 `…InspectionsWarningEmpty`；
//     `DO_NOT_SHOW`（severity=INFORMATION）与 `CONSIDERATION_ATTRIBUTES`（TEXT ATTRIBUTES）
//     是 `EmptyIcon.ICON_0`（`:152-158`）⇒ 「弱警告与警告长一个样、只有错误换图标」是上游事实，
//     本仓把 WEAK_WARNING 与 INFO 都挂到 `.sev-info` 是**同方向的折法**。
//   · LSP 那四档怎么落到这些级别上：`platform/lsp/src/api/customization/LspDiagnosticsCustomizer.kt:80-85`
//     = Error→ERROR、Warning→WARNING、**其余（含 Information 与 Hint）一律 WEAK_WARNING**；
//     个别语言服务再自己特化（`python/python-lsp-core/src/com/intellij/python/lsp/core/PyLspToolIntegrationProvider.kt:789-793`
//     把 Hint 特化成 INFORMATION）。
//
// 本仓的映射：语言服务给的是 LSP 的四档 severity（1 Error / 2 Warning / 3 Information / 4 Hint），
// 本仓按 rank 拆成四级（比上游的"3、4 全折进 WEAK_WARNING"多分一档，面板与状态栏都吃这一档）。
// **名字的中文措辞不在本文件裁决**：`weak.warning.severity` / `info.severity` 的中文译名
// 在这份社区基准树里找不到出处（只有 `InspectionsBundle.properties:33,37` 的英文
// `info` / `weak warning`）⇒ 下面那四个 `label` 沿用面板既有文案，登记为「无法核实」。
// 级别对象（排序权重、样式类、CodeMirror severity、是否进状态栏两格）现在是同一份，
// `src/problems.ts`、`src/problemsView.ts`、`src/editorDiagnosticMarkers.ts` 都从这里取，
// 不再各写三元表达式。

export type HighlightLevelId = 'ERROR' | 'WARNING' | 'WEAK_WARNING' | 'INFO'

export interface HighlightDisplayLevel {
  id: HighlightLevelId
  /**
   * 排序权重（越小越严重）。依据不是"枚举顺序"而是 `HighlightSeverity.myVal` +
   * `SeverityRegistrar` 的注册序，见文件头第一条（INFO 与 WEAK_WARNING 的 myVal 同为 200，
   * 本仓把它们排出先后靠的是注册表次序，不是严重度数值）。
   */
  rank: number
  /** 面板/状态栏的中文名（本仓界面文案；上游英文名的中文译名无出处，见文件头「无法核实」）。 */
  label: string
  /** 样式类（`src/style.css` 的 `.sev-*`）。 */
  className: string
  /** CodeMirror `@codemirror/lint` 的 severity 文案。 */
  cmSeverity: 'error' | 'warning' | 'info'
  /**
   * 这一级进不进状态栏/面板标题行的**「错误 / 警告」两格**：`false` 的级别一起折进第三格
   * 「信息」。这一格现在是 `src/problemsView.ts` 的 `problemCounts` **真正读**的字段
   * （旧版 `problemCounts` 把三个 id 硬写一遍、这个布尔没人消费 ⇒ 是个装饰字段，本轮接上）。
   * 上游的对应形状是 `TrafficLightRenderer.kt:374-390`：状态栏那一串**逐级**出条目，
   * 每级的文案由级别自己给（`:383` 的 `getCountMessage`），也就是"归属由级别对象说"这一条。
   */
  counted: boolean
}

export const HIGHLIGHT_LEVELS: readonly HighlightDisplayLevel[] = [
  { id: 'ERROR', rank: 0, label: '错误', className: 'sev-error', cmSeverity: 'error', counted: true },
  { id: 'WARNING', rank: 1, label: '警告', className: 'sev-warning', cmSeverity: 'warning', counted: true },
  { id: 'WEAK_WARNING', rank: 2, label: '提示', className: 'sev-info', cmSeverity: 'info', counted: false },
  { id: 'INFO', rank: 3, label: '信息', className: 'sev-info', cmSeverity: 'info', counted: false },
]

const LEVEL_BY_ID = new Map(HIGHLIGHT_LEVELS.map(level => [level.id, level]))

export function levelById(id: HighlightLevelId): HighlightDisplayLevel {
  return LEVEL_BY_ID.get(id) ?? HIGHLIGHT_LEVELS[HIGHLIGHT_LEVELS.length - 1]
}

/** 未知严重度按最弱一级处理（不假装是错误，也不丢行）。 */
export function levelForSeverity(severity: number): HighlightDisplayLevel {
  if (severity <= 1) return levelById('ERROR')
  if (severity === 2) return levelById('WARNING')
  if (severity === 3) return levelById('WEAK_WARNING')
  return levelById('INFO')
}

/** `ProblemDescriptor` 的严重度中文名（问题面板与状态栏同一套）。 */
export const severityLabel = (severity: number): string => levelForSeverity(severity).label

/** 严重度对应的样式类（`src/style.css` 里的 `.sev-*`）。 */
export const severityClass = (severity: number): string => levelForSeverity(severity).className

/** CodeMirror 诊断的 severity 文案（`src/editorDiagnosticMarkers.ts` 消费）。 */
export const severityForMarker = (severity: number): 'error' | 'warning' | 'info' => levelForSeverity(severity).cmSeverity
