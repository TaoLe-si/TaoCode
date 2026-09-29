// 编辑器文本工具（纯函数，无状态依赖）：从 App.vue 拆出（桃 2026-09-26：模块化）。
// 这些是 LSP 文本编辑、光标词提取等共用逻辑，独立文件便于测试与复用。
import type { LspTextEdit } from './bridge'

/** 光标处的标识符（前后各取连续 [A-Za-z0-9_$] 段）。 */
export function wordAt(text: string, line0: number, char0: number) {
  const line = text.split('\n')[line0] ?? ''
  const head = /[A-Za-z0-9_$]*$/.exec(line.slice(0, char0))?.[0] ?? ''
  const tail = /^[A-Za-z0-9_$]*/.exec(line.slice(char0))?.[0] ?? ''
  return head + tail
}

/** 行列（0 基，LSP 约定）→ 字符串偏移。 */
export function offsetOf(lines: string[], line: number, character: number) {
  let offset = 0
  for (let i = 0; i < line; i++) offset += (lines[i]?.length ?? 0) + 1
  return offset + Math.min(character, lines[line]?.length ?? 0)
}

// LSP TextEdits are 0-based half-open ranges; applied last→first so earlier
// offsets stay valid. Ranges come from the language service, disjoint by design.
export function applyTextEdits(content: string, edits: LspTextEdit[]) {
  const lines = content.split('\n')
  return edits
    .map(edit => ({ text: edit.text, from: offsetOf(lines, edit.startLine, edit.startChar), to: offsetOf(lines, edit.endLine, edit.endChar) }))
    .sort((a, b) => b.from - a.from)
    .reduce((text, edit) => text.slice(0, edit.from) + edit.text + text.slice(edit.to), content)
}
