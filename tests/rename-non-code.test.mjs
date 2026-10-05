// 重命名预览的追加能力（`src/renamePreview.ts`）：
//   · 「在注释和字符中搜索」（上游 `RenameDialog.java:66/280-281/376/405`）—— LSP rename
//     不接这个开关，注释/字符串里的字面出现由本仓另算成同形的编辑；
//   · `mergePreviewEdits` 把追加编辑并回既有账并重跑冲突检测。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  mergePreviewEdits, nonCodeRenameEdits, nonCodeRenameSummary, renamePreviewOf,
  SEARCH_IN_COMMENTS_DEFAULT, SEARCH_IN_COMMENTS_LABEL, SEARCH_TEXT_OCCURRENCES_LABEL,
} from '../src/renamePreview.ts'

const js = { line: '//', block: ['/*', '*/'] }
const edit = (line, character, text, length = 3) =>
  ({ text, startLine: line, startChar: character, endLine: line, endChar: character + length })

test('文案与缺省档照上游：中文两档 + 「在注释和字符中搜索」默认勾上', () => {
  // RefactoringBundle.properties:36 / :38 的 zh 语言包原文（去掉助记符）
  assert.equal(SEARCH_IN_COMMENTS_LABEL, '在注释和字符中搜索')
  assert.equal(SEARCH_TEXT_OCCURRENCES_LABEL, '搜索文本匹配项')
  // RenameDialog.java:281 myCbSearchInComments.setSelected(true)
  assert.equal(SEARCH_IN_COMMENTS_DEFAULT, true)
})

test('追加编辑：注释与字符串里的出现变成同形的整词替换', () => {
  const preview = renamePreviewOf([{ path: 'a.ts', textEdits: [edit(0, 4, 'renamed')] }])
  const extra = nonCodeRenameEdits('name', 'renamed', [
    { path: 'a.ts', text: 'let name = 1; // name here\nconst s = "name";\n', style: js },
  ], preview)
  assert.equal(extra.count, 2)
  assert.equal(extra.files, 1)
  assert.equal(extra.skipped, 0)
  assert.deepEqual(extra.edits, [{ path: 'a.ts', textEdits: [edit(0, 17, 'renamed', 4), edit(1, 11, 'renamed', 4)] }])
})

test('语言服务已经改过的位置不重复追加（skipped 如实计数）', () => {
  // 注释里的出现落在 (0,3)，语言服务声称也要改 (0,3)
  const preview = renamePreviewOf([{ path: 'a.ts', textEdits: [edit(0, 3, 'x', 4)] }])
  const extra = nonCodeRenameEdits('name', 'renamed', [
    { path: 'a.ts', text: '// name\n', style: js },
  ], preview)
  assert.equal(extra.skipped, 1)   // 注释里那处语言服务也给了编辑
  assert.equal(extra.count, 0)
  assert.deepEqual(extra.edits, [])
})

test('代码里的出现不追加（LSP 那一半是语言服务的职责）', () => {
  const preview = renamePreviewOf([])
  const extra = nonCodeRenameEdits('name', 'renamed', [{ path: 'a.ts', text: 'let name = 1;\n', style: js }], preview)
  assert.equal(extra.count, 0)
  assert.equal(nonCodeRenameSummary(extra), '注释与字符串里没有匹配的出现。')
})

test('同名 / 空名 / 缺文本都不产出编辑', () => {
  const preview = renamePreviewOf([])
  const files = [{ path: 'a.ts', text: '// name', style: js }]
  assert.equal(nonCodeRenameEdits('', 'x', files, preview).count, 0)
  assert.equal(nonCodeRenameEdits('name', '', files, preview).count, 0)
  assert.equal(nonCodeRenameEdits('name', 'name', files, preview).count, 0)
  const missing = nonCodeRenameEdits('name', 'x', [{ path: 'a.ts' }], preview)
  assert.equal(missing.count, 0)
  assert.equal(missing.files, 0)
})

test('跨文件的追加与上限截断', () => {
  const preview = renamePreviewOf([])
  const extra = nonCodeRenameEdits('w', 'W', [
    { path: 'a.ts', text: '// w\n"w"\n', style: js },
    { path: 'b.ts', text: '/* w */ w\n', style: js },
  ], preview, 3)
  assert.equal(extra.count, 3)
  assert.equal(extra.files, 2)
  assert.equal(extra.truncated, true)
  assert.match(nonCodeRenameSummary(extra), /已达扫描上限/)
})

test('摘要：多文件与「语言服务已处理」都要说清', () => {
  // 语言服务声称要改 a.ts 的 0:3；把注释里的出现放在同一处 → 剔掉
  const preview = renamePreviewOf([{ path: 'a.ts', textEdits: [edit(0, 3, 'x', 4)] }])
  const summary = nonCodeRenameSummary(nonCodeRenameEdits('name', 'x', [
    { path: 'a.ts', text: '// name\n', style: js },
    { path: 'b.ts', text: '// name\n"name"\n', style: js },
  ], preview))
  assert.match(summary, /2 处匹配/)
  assert.match(summary, /1 处语言服务已处理/)
  // 文件数只在跨文件时说（a.ts 那处被剔掉了，剩下只有 b.ts）
  assert.doesNotMatch(summary, /个文件/)
})

test('摘要：跨文件与上限都要说清', () => {
  const summary = nonCodeRenameSummary(nonCodeRenameEdits('w', 'W', [
    { path: 'a.ts', text: '// w\n', style: js },
    { path: 'b.ts', text: '/* w */\n', style: js },
  ], renamePreviewOf([]), 2))
  assert.match(summary, /2 处匹配/)
  assert.match(summary, /分布在 2 个文件/)
  assert.match(summary, /已达扫描上限/)
})

test('合并：按路径归并后重新去重与排序', () => {
  const preview = renamePreviewOf([{ path: 'a.ts', textEdits: [edit(4, 0, 'x'), edit(0, 0, 'x')] }])
  const merged = mergePreviewEdits(preview, [{ path: 'a.ts', textEdits: [edit(0, 0, 'x'), edit(9, 0, 'x', 4)] }])
  assert.equal(merged.files, 1)
  assert.equal(merged.usageCount, 3)          // 0/0 的重复被去重
  assert.deepEqual(merged.usages.map(usage => usage.line), [0, 4, 9])
  assert.deepEqual(merged.conflicts, [])
})

test('合并后重叠编辑仍然整体拦下（冲突保证对新编辑同样成立）', () => {
  const preview = renamePreviewOf([{ path: 'a.ts', textEdits: [edit(0, 0, 'x', 4)] }])
  const merged = mergePreviewEdits(preview, [{ path: 'a.ts', textEdits: [edit(0, 2, 'y', 4)] }])
  assert.equal(merged.conflicts.length, 1)
  assert.equal(merged.conflicts[0].path, 'a.ts')
})

test('合并：无追加时原账原样返回（同一引用，便于调用方直接判等）', () => {
  const preview = renamePreviewOf([{ path: 'a.ts', textEdits: [edit(0, 0, 'x')] }])
  assert.equal(mergePreviewEdits(preview, []), preview)
  assert.equal(mergePreviewEdits(preview, [{ path: 'a.ts', textEdits: [] }]), preview)
})

test('合并：跨文件的新路径会新增文件条目', () => {
  const preview = renamePreviewOf([{ path: 'a.ts', textEdits: [edit(0, 0, 'x')] }])
  const merged = mergePreviewEdits(preview, [{ path: 'b.ts', textEdits: [edit(1, 2, 'x')] }])
  assert.equal(merged.files, 2)
  assert.equal(merged.usageCount, 2)
})
