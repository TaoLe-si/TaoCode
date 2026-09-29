// 编辑器复制/剪切（IDEA `EditorCopy` / `EditorCut` / `CopyPaths`）的规则单测。
//
// 被测实现逐句对照源码（路径与行号见 src/editorClipboard.ts 头部）：
//   · `CopyAction.prepareSelectionToCopy:107-118`：有选区复制选区；无选区先 `selectEntireLines`
//   · `EditorActionUtil.selectEntireLines:135-140`：整行选区**含行尾换行**
//   · `CopyAction` 默认 `preserveOriginalCaretState = !isCopyFromEmptySelectionToSelectLine()` = false
//     ⇒ 复制整行后整行保持选中（`restoreCaretStateIfNeeded` 不执行）
//   · `CutAction.Handler:22-33`：同一套选区准备 + `deleteSelectedTextForAllCarets`
//   · `CopyPathsAction.java:44-48`：只在键盘 place 下可见（菜单里看不到那一行）
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { entireLineRange, planCopy, planCut } from '../src/editorClipboard.ts'

/** 最小文档桩：只实现 `lineAt` / `sliceString` / `lines` / `length`（对齐 CodeMirror `Text` 的语义）。 */
function doc(text) {
  const rows = text.split('\n')
  const starts = []
  let offset = 0
  for (const row of rows) { starts.push(offset); offset += row.length + 1 }
  return {
    lines: rows.length,
    length: text.length,
    lineAt(pos) {
      const clamped = Math.max(0, Math.min(pos, text.length))
      let index = 0
      while (index + 1 < rows.length && starts[index + 1] <= clamped) index++
      return { from: starts[index], to: starts[index] + rows[index].length, number: index + 1 }
    },
    sliceString(from, to) { return text.slice(from, to) },
  }
}

const caret = from => ({ from, to: from, empty: true })
const selection = (from, to) => ({ from, to, empty: false })
const SAMPLE = 'first\nsecond\nthird'

test('整行范围包含行尾换行，最后一行没有换行就到行尾', () => {
  const d = doc(SAMPLE)
  // 第 1 行 'first' 在 0..5，换行在 5；整行 = 0..6
  assert.deepEqual(entireLineRange(d, 3), { from: 0, to: 6 })
  // 第 2 行 'second' 在 6..12，整行 = 6..13
  assert.deepEqual(entireLineRange(d, 8), { from: 6, to: 13 })
  // 最后一行 'third' 在 13..18，无换行 ⇒ 到行尾
  assert.deepEqual(entireLineRange(d, 15), { from: 13, to: 18 })
  // 光标正好落在换行符上也归属前一行
  assert.deepEqual(entireLineRange(d, 5), { from: 0, to: 6 })
})

test('有选区时复制选区本身，并保持选区', () => {
  const d = doc(SAMPLE)
  const plan = planCopy(d, selection(6, 12))
  assert.equal(plan.text, 'second')
  assert.deepEqual([plan.from, plan.to], [6, 12])
  assert.deepEqual(plan.selection, { anchor: 6, head: 12 })
  assert.equal(plan.fromEmptySelection, false)
})

test('无选区时先选中整行再复制，且整行保持选中（CopyAction 的默认行为）', () => {
  const d = doc(SAMPLE)
  const plan = planCopy(d, caret(8))
  assert.equal(plan.text, 'second\n')
  assert.deepEqual([plan.from, plan.to], [6, 13])
  // preserveOriginalCaretState 默认 false ⇒ 不恢复光标，整行留在选中状态
  assert.deepEqual(plan.selection, { anchor: 6, head: 13 })
  assert.equal(plan.fromEmptySelection, true)
  // 最后一行复制的文本不带换行（`entireLineRange` 的边界）
  assert.equal(planCopy(d, caret(15)).text, 'third')
})

test('空选区复制可用 AdvancedSettings 关掉（editor.skip.copy.and.cut.for.empty.selection）', () => {
  const d = doc(SAMPLE)
  assert.equal(planCopy(d, caret(8), true), null)
  assert.equal(planCut(d, caret(8), true), null)
  // 有关选区时与这个开关无关（源码只在无选区分支读它）
  assert.equal(planCopy(d, selection(6, 12), true).text, 'second')
})

test('空文档 / 空行不会复制空串出来', () => {
  assert.equal(planCopy(doc(''), caret(0)), null)
  // 光标在末尾空行上：范围为 0..0 ⇒ 没有可复制的内容
  assert.equal(planCopy(doc('a\n'), caret(2)), null)
})

test('剪切与复制的范围一致，但选区落在被删除处（CutAction 传 preserve=false）', () => {
  const d = doc(SAMPLE)
  const plan = planCut(d, caret(8))
  assert.equal(plan.text, 'second\n')
  assert.deepEqual([plan.from, plan.to], [6, 13])
  assert.deepEqual(plan.selection, { anchor: 6, head: 13 })
  // 有选区时剪切同样取选区
  const ranged = planCut(d, selection(0, 5))
  assert.equal(ranged.text, 'first')
  assert.deepEqual(ranged.selection, { anchor: 0, head: 5 })
})
