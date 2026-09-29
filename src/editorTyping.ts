// 从 CodeMirror 的一次更新里取出"用户敲进去的文本"。
//
// 用途：宏录制（IDEA 的 `ActionMacroManager.KeyPostProcessor` → `ActionMacro.appendKeyPressed`）
// 要把输入的文字录进宏。CodeMirror 的 `update.changes` 里既可能是插入也可能是删除，
// 这里只取**插入**的部分并拼成一串（连续输入在 src/macros.ts 的 `appendTyping` 里合并成一条）。
//
// 本模块只依赖 npm 包，且不被测试直接 import（纯函数在 src/macros.ts 里测）。
import type { ViewUpdate } from '@codemirror/view'

export function insertedText(update: ViewUpdate): string {
  if (!update.docChanged) return ''
  let text = ''
  update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => { text += inserted.toString() })
  return text
}
