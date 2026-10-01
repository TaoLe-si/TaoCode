// 粘性作用域行（IDEA `editor.stickyLines`）：从 documentSymbol（扁平列表）里找出**包含当前光标行**的
// 符号，按 `startLine` 升序取最内层 N 条 —— 外层作用域在上，最内层贴近编辑区顶边。
//
// 从 `App.vue` 抽出来（那一层贴着行数硬上限）：这里只有一条纯规则 + 三个只读依赖，
// 与"设置/结构视图/当前行"三处状态的关系一眼能看完，也便于单测。
import { computed, type Ref } from 'vue'
import type { EditorSettings, LspDocumentSymbol } from './bridge'

/** 一条粘性行就是"挂在编辑器顶边的作用域名 + 它自己的行号"（行号用于 key 与点击跳转）。 */
export interface StickyLine { name: string; startLine: number; endLine: number }

export interface StickyLinesDeps {
  editorSettings: Ref<EditorSettings>
  outline: Ref<LspDocumentSymbol[]>
  /** 当前光标行（1 基）；没打开文件时返回 undefined。 */
  currentLine: () => number | undefined
}

export function createStickyLines(deps: StickyLinesDeps): { stickyLines: Ref<StickyLine[]> } {
  const stickyLines = computed<StickyLine[]>(() => {
    const limit = deps.editorSettings.value.stickyLinesLimit
    const line = deps.currentLine()
    if (line === undefined || !deps.editorSettings.value.showStickyLines || limit <= 0) return []
    return deps.outline.value
      .filter(symbol => symbol.startLine < line && line <= symbol.endLine)
      .sort((left, right) => left.startLine - right.startLine)
      .slice(-limit)
      .map(symbol => ({ name: symbol.name, startLine: symbol.startLine, endLine: symbol.endLine }))
  })
  return { stickyLines }
}
