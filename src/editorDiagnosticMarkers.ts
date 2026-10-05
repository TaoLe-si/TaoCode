// 把 LSP 诊断折成 CodeMirror 的 `Diagnostic`（上游 `AnnotationHolder` → 编辑器标记的等价物）。
//
// 从 `CodeEditor.vue` 拆出来（那个文件贴着机检上限）：这里只吃"诊断数组 + 文档 + 一个坐标换算"，
// 与组件状态无关。
import type { Diagnostic } from '@codemirror/lint'
import type { Text } from '@codemirror/state'
import type { LspDiagnostic } from './bridge'
// 高亮级别模型（上游 `HighlightDisplayLevel`）：LSP 严重度 → 编辑器标记的 severity 与问题面板
// 同一份判定，见 src/highlightLevels.ts。
import { severityForMarker } from './highlightLevels.ts'

/** LSP 的 0 基 (line, character) → 文档偏移。行与列都夹到合法范围（`lspPosition` 的老实现）。 */
export function lspPosition(doc: Text, line: number, character: number): number {
  const info = doc.line(Math.min(Math.max(1, Math.trunc(line) + 1), doc.lines))
  return Math.min(Math.max(info.from, info.from + Math.max(0, Math.trunc(character))), info.to)
}

/**
 * 一条诊断的区间：起点是 (line, character)，终点在服务端给了 endLine/endCharacter 时用它，
 * 否则退化成"起点 + 消息长度"（至少让波浪线看得见）。终点夹在起点与文末之间。
 */
export function diagnosticMarkers(items: readonly LspDiagnostic[], doc: Text): Diagnostic[] {
  const markers: Diagnostic[] = []
  for (const item of items) {
    try {
      const from = lspPosition(doc, item.line, item.character)
      const to = Math.min(Math.max(from, item.endLine === undefined ? from + item.message.length : lspPosition(doc, item.endLine, item.endCharacter ?? 0)), doc.length)
      markers.push({ from, to, severity: severityForMarker(item.severity), message: item.message, source: item.source })
    } catch { /* 过期或越界的诊断不影响编辑 */ }
  }
  return markers
}
