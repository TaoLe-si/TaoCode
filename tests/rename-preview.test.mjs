// 重命名的预览账与冲突检测（上游 `RenameUsage` / `RenameConflict` / 重构预览那一层）。
// 规则在 `src/renamePreview.ts`，接线在 `src/semanticActions.ts` 的 `applyRename`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renameConflictMessage, renamePreviewOf, renameUsageSummary } from '../src/renamePreview.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const edit = (startLine, startChar, endLine, endChar, text) => ({ startLine, startChar, endLine, endChar, text })

test('空输入：没有编辑、没有文件、没有冲突', () => {
  const preview = renamePreviewOf([])
  assert.equal(preview.usageCount, 0)
  assert.equal(preview.files, 0)
  assert.deepEqual(preview.conflicts, [])
  assert.equal(renameUsageSummary(preview), '共 0 处')
})

test('完全相同的编辑只算一次（服务器重复报同一条）', () => {
  const preview = renamePreviewOf([
    { path: 'a.java', textEdits: [edit(1, 4, 1, 8, 'b'), edit(1, 4, 1, 8, 'b')] },
  ])
  assert.equal(preview.usageCount, 1, '重复编辑要折成一条')
  assert.equal(preview.edits[0].textEdits.length, 1, '应用的是去重后的那一份')
  assert.deepEqual(preview.conflicts, [])
})

test('同区间的不同文本、区间重叠、插入落在区间内部 → 冲突', () => {
  const sameRange = renamePreviewOf([{ path: 'a.java', textEdits: [edit(1, 0, 1, 4, 'x'), edit(1, 0, 1, 4, 'y')] }])
  assert.equal(sameRange.conflicts.length, 1)
  const overlap = renamePreviewOf([{ path: 'a.java', textEdits: [edit(1, 0, 1, 8, 'x'), edit(1, 4, 1, 12, 'y')] }])
  assert.equal(overlap.conflicts.length, 1)
  const inside = renamePreviewOf([{ path: 'a.java', textEdits: [edit(1, 0, 1, 8, 'x'), edit(1, 4, 1, 4, 'y')] }])
  assert.equal(inside.conflicts.length, 1, '插入点落在替换区间内部也要算冲突')
})

test('端部相接不是冲突（LSP 允许相邻编辑）', () => {
  const preview = renamePreviewOf([{ path: 'a.java', textEdits: [edit(1, 0, 1, 4, 'x'), edit(1, 4, 1, 8, 'y')] }])
  assert.deepEqual(preview.conflicts, [])
  assert.equal(preview.usageCount, 2)
})

test('同一位置的两次相同插入被去重；不同文本才算冲突', () => {
  const same = renamePreviewOf([{ path: 'a.java', textEdits: [edit(2, 3, 2, 3, 'x'), edit(2, 3, 2, 3, 'x')] }])
  assert.deepEqual(same.conflicts, [])
  assert.equal(same.usageCount, 1)
  const different = renamePreviewOf([{ path: 'a.java', textEdits: [edit(2, 3, 2, 3, 'x'), edit(2, 3, 2, 3, 'y')] }])
  assert.equal(different.conflicts.length, 1)
})

test('跨文件各自独立：一个文件冲突不影响另一个文件的账', () => {
  const preview = renamePreviewOf([
    { path: 'a.java', textEdits: [edit(1, 0, 1, 4, 'x'), edit(1, 2, 1, 6, 'y')] },
    { path: 'b.java', textEdits: [edit(0, 0, 0, 4, 'z')] },
  ])
  assert.equal(preview.conflicts.length, 1)
  assert.equal(preview.conflicts[0].path, 'a.java')
  assert.equal(preview.files, 2)
  assert.equal(preview.usageCount, 3)
  assert.equal(preview.edits[1].path, 'b.java')
})

test('位置账按文件内位置排序（预览要按顺序读）', () => {
  const preview = renamePreviewOf([
    { path: 'a.java', textEdits: [edit(9, 0, 9, 1, 'c'), edit(1, 2, 1, 3, 'a'), edit(1, 0, 1, 1, 'b')] },
  ])
  assert.deepEqual(preview.usages.map(usage => [usage.line, usage.character]), [[1, 0], [1, 2], [9, 0]])
})

test('文案：冲突点出文件与 1 基行号；账目给出总处数', () => {
  const preview = renamePreviewOf([{ path: 'src/A.java', textEdits: [edit(3, 0, 3, 4, 'x'), edit(3, 2, 3, 6, 'y')] }])
  const message = renameConflictMessage(preview)
  assert.match(message, /src\/A\.java 第 4 行/)
  assert.match(message, /1 处/)
  assert.equal(renameUsageSummary(renamePreviewOf([{ path: 'a', textEdits: [edit(0, 0, 0, 1, 'x')] }])), '共 1 处')
})

test('接线：applyRename 先算预览、冲突即拒绝、用去重后的编辑', () => {
  const source = read('src/semanticActions.ts')
  assert.match(source, /renamePreviewOf\(result\.edits\)/, 'applyRename 要算预览账')
  assert.match(source, /preview\.conflicts\.length[\s\S]{0,120}renameConflictMessage/, '有冲突要先拒绝')
  assert.match(source, /applyEditsToFiles\(preview\.edits/, '应用的是去重后的编辑')
})
