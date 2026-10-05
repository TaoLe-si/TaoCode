// 重构预览（`src/refactorPreview.ts`）：WorkspaceEdit → 预览模型（旧文本、重叠冲突），
// 重命名名字校验（标识符 + 关键字表）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RENAME_KEYWORDS, buildRefactorPreview, editsOverlap, previewLine, previewRequired, validateRenameName,
} from '../src/refactorPreview.ts'

const edit = (startLine, startChar, endLine, endChar, text) => ({ startLine, startChar, endLine, endChar, text })

test('预览：按文件分组、旧文本来自当前内容、摘要计数', () => {
  const contents = { 'src/A.java': 'class A {\n    int foo = 1;\n}\n' }
  const preview = buildRefactorPreview([
    { path: 'src/A.java', textEdits: [edit(1, 8, 1, 11, 'bar')] },
    { path: 'src/B.java', textEdits: [edit(0, 6, 0, 9, 'B2'), edit(2, 4, 2, 7, 'baz')] },
  ], contents)
  assert.equal(preview.files.length, 2)
  assert.equal(preview.editCount, 3)
  assert.equal(preview.conflictCount, 0)
  assert.equal(preview.summary, '2 个文件 · 3 处修改')
  const first = preview.files[0].hunks[0]
  assert.equal(first.oldText, 'foo', '有内容时算得出被替换的原文')
  assert.equal(first.newText, 'bar')
  assert.equal(preview.files[1].hunks[0].oldText, '', '没给内容的文件只显示位置')
})

test('冲突：同一文件里重叠的两条编辑被标出（有内容时按偏移、没有时按行列）', () => {
  const contents = { 'a.ts': 'let alpha = alpha + 1\n' }
  const overlapping = buildRefactorPreview([{ path: 'a.ts', textEdits: [edit(0, 4, 0, 9, 'beta'), edit(0, 7, 0, 12, 'gamma')] }], contents)
  assert.equal(overlapping.conflictCount, 1)
  assert.ok(overlapping.files[0].conflict)
  const touching = buildRefactorPreview([{ path: 'a.ts', textEdits: [edit(0, 4, 0, 9, 'beta'), edit(0, 9, 0, 12, 'x')] }], contents)
  assert.equal(touching.conflictCount, 0, '首尾相接不算重叠')
  const noContent = buildRefactorPreview([{ path: 'a.ts', textEdits: [edit(0, 4, 0, 9, 'beta'), edit(0, 7, 0, 12, 'gamma')] }])
  assert.equal(noContent.conflictCount, 1, '没有内容也能按行列判重叠')
})

test('editsOverlap：跨行区间与退化区间', () => {
  assert.ok(editsOverlap(edit(1, 0, 3, 0, ''), edit(2, 0, 4, 0, '')))
  assert.ok(!editsOverlap(edit(1, 0, 2, 0, ''), edit(2, 0, 3, 0, '')))
  assert.ok(!editsOverlap(edit(1, 5, 1, 5, ''), edit(1, 5, 1, 5, '')), '零宽区间互不重叠')
  assert.ok(editsOverlap(edit(1, 5, 1, 7, ''), edit(1, 6, 1, 8, '')))
})

test('previewLine：多行只留首行 + 省略号', () => {
  assert.equal(previewLine('one'), 'one')
  assert.equal(previewLine('one\ntwo'), 'one …')
})

test('validateRenameName：空/空白/非标识符/关键字都拦，合法名放行', () => {
  assert.equal(validateRenameName('Widget', 'java'), '')
  assert.equal(validateRenameName('中文名', 'java'), '', 'Unicode 字母是合法标识符')
  assert.ok(validateRenameName('', 'java'))
  assert.ok(validateRenameName('two words', 'java'))
  assert.ok(validateRenameName('2foo', 'java'))
  assert.ok(validateRenameName('class', 'java'))
  assert.ok(validateRenameName('function', 'typescript'))
  assert.ok(validateRenameName('None', 'python'))
  assert.equal(validateRenameName('table', 'python'), '', '不是关键字的普通词放行')
  assert.ok(RENAME_KEYWORDS.cpp.includes('namespace'))
})

test('previewRequired：单文件单处不弹预览，冲突/多文件/多处才弹', () => {
  assert.equal(previewRequired({ files: [{ path: 'a', editCount: 1, hunks: [], conflict: false }], editCount: 1, conflictCount: 0, summary: '' }), false)
  assert.equal(previewRequired({ files: [{ path: 'a', editCount: 2, hunks: [], conflict: false }], editCount: 2, conflictCount: 0, summary: '' }), true)
  assert.equal(previewRequired({ files: [{ path: 'a', editCount: 1, hunks: [], conflict: true }], editCount: 1, conflictCount: 1, summary: '' }), true)
})
