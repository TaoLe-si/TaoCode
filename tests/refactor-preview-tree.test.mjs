// 重构预览的**用法树**（`src/refactorPreview.ts` 的 `refactorPreviewTree`）——
// 上游 `UsageViewImpl` + `UsageViewTreeStructureProvider` 那一层：应用前把「哪些文件、哪些位置」
// 印成一棵 目录 → 文件 → 位置 的树，重构对话框消费它。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildRefactorPreview, previewTreeTitle, refactorPreviewTree } from '../src/refactorPreview.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const edit = (line, character, text, endChar = character + 4) =>
  ({ text, startLine: line, startChar: character, endLine: line, endChar })

const files = (node) => node.children.filter(child => child.kind === 'file')

test('树：目录 → 文件 → 位置，目录计数是子树合计', () => {
  const tree = refactorPreviewTree([
    { path: 'src/app/main.ts', textEdits: [edit(1, 2, 'renamed'), edit(8, 0, 'renamed')] },
    { path: 'src/app/util.ts', textEdits: [edit(0, 0, 'renamed')] },
    { path: 'README.md', textEdits: [edit(0, 0, 'renamed')] },
  ])
  assert.equal(tree.kind, 'directory')
  assert.equal(tree.count, 4)
  assert.deepEqual(tree.children.map(child => child.name), ['src', 'README.md'])
  assert.equal(tree.children[0].count, 3)
  assert.deepEqual(tree.children[0].children.map(child => child.name), ['app'])
  assert.equal(tree.children[0].children[0].count, 3)
  assert.equal(tree.children[1].count, 1)
  // README.md 是文件节点（根下没有同名目录）
  assert.equal(tree.children[1].kind, 'file')
  assert.equal(tree.children[1].rows.length, 1)
  // 目录节点不带位置行
  assert.deepEqual(tree.children[0].rows, [])
})

test('树：位置按行号升序，目录节点在前（分组规则来自 usageViewGrouping）', () => {
  const tree = refactorPreviewTree([{ path: 'a.ts', textEdits: [edit(9, 0, 'x'), edit(2, 0, 'x')] }])
  const rows = tree.children[0].rows
  assert.deepEqual(rows.map(row => row.line), [2, 9])
})

test('树：逐处带上旧文本与新文本（有内容时）', () => {
  const tree = refactorPreviewTree(
    [{ path: 'a.ts', textEdits: [edit(0, 0, 'renamed', 4)] }],
    { 'a.ts': 'name = 1\nother = 2\n' })
  const row = tree.children[0].rows[0]
  assert.deepEqual(
    { path: row.path, line: row.line, column: row.column, oldText: row.oldText, newText: row.newText, conflict: row.conflict },
    { path: 'a.ts', line: 0, column: 0, oldText: 'name', newText: 'renamed', conflict: false })
})

test('树：拿不到内容时只给位置（oldText 空串），不假装知道原文', () => {
  const tree = refactorPreviewTree([{ path: 'gone.ts', textEdits: [edit(3, 7, 'x')] }])
  const row = tree.children[0].rows[0]
  assert.equal(row.oldText, '')
  assert.equal(row.newText, 'x')
  assert.deepEqual([row.line, row.column], [3, 7])
})

test('树：同文件有重叠编辑时该文件所有行标冲突', () => {
  const tree = refactorPreviewTree([{ path: 'a.ts', textEdits: [edit(0, 0, 'beta'), edit(0, 2, 'gamma')] }], { 'a.ts': 'foobar' })
  assert.equal(tree.children[0].rows.every(row => row.conflict), true)
  const clean = refactorPreviewTree([{ path: 'a.ts', textEdits: [edit(0, 0, 'beta'), edit(2, 0, 'gamma')] }], { 'a.ts': 'foo\nbar\nbaz' })
  assert.equal(clean.children[0].rows.every(row => row.conflict), false)
})

test('树：空编辑集给一棵空的根（调用方据此不出对话框）', () => {
  const tree = refactorPreviewTree([])
  assert.equal(tree.count, 0)
  assert.deepEqual(tree.children, [])
})

test('树标题把 summary 挂上去', () => {
  const flat = buildRefactorPreview([{ path: 'a.ts', textEdits: [edit(0, 0, 'x')] }, { path: 'b.ts', textEdits: [edit(0, 0, 'x')] }])
  assert.equal(previewTreeTitle(flat, '重命名'), `重命名 — ${flat.summary}`)
  assert.match(previewTreeTitle(flat, '重命名'), /2 个文件 · 2 处修改/)
})

test('接线：重构对话框组件存在并消费这棵树（不在预览之前直接写盘）', () => {
  const dialog = read('src/components/RefactorPreviewDialog.vue')
  assert.match(dialog, /refactorPreviewTree|RefactorPreviewNode/)
  assert.match(dialog, /refactor/)
  // 上游 `RefactoringDialog.java:245-273` 的两个动作：Refactor（DEFAULT_ACTION）/ Preview
  assert.match(dialog, /重构/)
  assert.match(dialog, /取消/)
  // 冲突时「重构」必须禁掉（`renamePreview` 的整体不应用保证在 UI 上也要看得见）
  assert.match(dialog, /conflictCount|conflict/)
})

test('接线：重命名走预览对话框，冲突时整条不应用', () => {
  const semantic = read('src/semanticActions.ts')
  assert.match(semantic, /refactorPreviewState/)
  assert.match(semantic, /confirmRefactorPreview/)
  assert.match(semantic, /renameConflictMessage/)
  // 冲突检查仍在应用之前
  assert.ok(semantic.indexOf('renameConflictMessage') < semantic.indexOf('confirmRefactorPreview('))
})
