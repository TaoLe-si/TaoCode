// 高亮级别与问题呈现 —— 上游 `HighlightDisplayLevel` 一族（`platform/analysis-impl` 与
// `platform/lang-api` 的 `codeHighlighting/HighlightDisplayLevel`、`HighlightSeverity`、
// `ProblemDescriptor` 的严重度面）在 DOM/问题面板侧的等价物。
//
// 逐条对照：
//   · `HighlightSeverity` 的五级：ERROR > WARNING > WEAK_WARNING > INFO > INFORMATION；
//   · `HighlightDisplayLevel` 每级带一套呈现属性（图标/波浪线/前景色与"是否在状态栏计数"）；
//   · `ProblemDescriptor.getHighlightType()` 决定问题面板里的那一行用哪一级。
//
// 本仓的映射：语言服务给的是 LSP 的四档 severity（1 错误 / 2 警告 / 3 信息 / 4 提示），
// 对应 ERROR / WARNING / WEAK_WARNING / INFO —— 与面板既有文案逐字一致（1 错误 / 2 警告 /
// 3 提示 / 4 信息），但级别对象（排序权重、CodeMirror severity、样式类）现在是同一份，
// `src/problems.ts`、`src/editorDiagnosticMarkers.ts` 都从这里取，不再各写三元表达式。

export type HighlightLevelId = 'ERROR' | 'WARNING' | 'WEAK_WARNING' | 'INFO'

export interface HighlightDisplayLevel {
  id: HighlightLevelId
  /** 排序权重（越小越严重；与 `HighlightSeverity` 的枚举顺序一致）。 */
  rank: number
  /** 面板/状态栏的中文名（本仓界面文案）。 */
  label: string
  /** 样式类（`src/style.css` 的 `.sev-*`）。 */
  className: string
  /** CodeMirror `@codemirror/lint` 的 severity 文案。 */
  cmSeverity: 'error' | 'warning' | 'info'
  /** 上游级别属性里的"是否折行下波浪线"/"是否进状态栏计数"两个开关（DOM 侧的呈现依据）。 */
  underlined: boolean
  counted: boolean
}

export const HIGHLIGHT_LEVELS: readonly HighlightDisplayLevel[] = [
  { id: 'ERROR', rank: 0, label: '错误', className: 'sev-error', cmSeverity: 'error', underlined: true, counted: true },
  { id: 'WARNING', rank: 1, label: '警告', className: 'sev-warning', cmSeverity: 'warning', underlined: true, counted: true },
  { id: 'WEAK_WARNING', rank: 2, label: '提示', className: 'sev-info', cmSeverity: 'info', underlined: false, counted: false },
  { id: 'INFO', rank: 3, label: '信息', className: 'sev-info', cmSeverity: 'info', underlined: false, counted: false },
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
