// dm/quickfix 的判据（二）：意图预览（上游 `intention/preview` 一族的
// `IntentionPreviewInfoDiff`：应用前把编辑算成 before/after）。
// 落点：`src/intentionPreview.ts` 的纯规则 + 问题面板行菜单的预览消费。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PREVIEW_MAX_CHANGES, previewOfEdits } from '../src/intentionPreview.ts'

const root = new URL('..', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
const text = 'a\nb\nc\n'
const edit = (over = {}) => ({ text: 'B\n', startLine: 1, startChar: 0, endLine: 1, endChar: 1, ...over })

test('替换：给出原行与替换文本，行号是原文件的 1 基', () => {
  const preview = previewOfEdits([{ path: '/x.ts', textEdits: [edit()] }], () => text)
  assert.equal(preview.summary, '将修改 1 个文件：1 行新增 / 1 行删除')
  assert.deepEqual(preview.files[0].changes, [{ line: 2, before: ['b'], after: ['B'] }])
  assert.deepEqual([preview.added, preview.removed, preview.changedLines], [1, 1, 1])
  assert.equal(preview.truncated, false)
})

test('插入与删除：before/after 有一侧为空数组，计数只算实际行数', () => {
  const insertion = previewOfEdits([{ path: '/x.ts', textEdits: [edit({ text: '// noqa\n', startChar: 0, endChar: 0 })] }], () => text)
  assert.deepEqual(insertion.files[0].changes[0], { line: 2, before: [], after: ['// noqa'] })
  assert.deepEqual([insertion.added, insertion.removed], [1, 0])
  const deletion = previewOfEdits([{ path: '/x.ts', textEdits: [edit({ text: '', startLine: 0, startChar: 0, endLine: 1, endChar: 1 })] }], () => text)
  assert.deepEqual(deletion.files[0].changes[0], { line: 1, before: ['a', 'b'], after: [] })
  assert.deepEqual([deletion.added, deletion.removed], [0, 2])
})

test('拿不到文件内容：落 unavailable 并仍计数（不假装能预览）', () => {
  const preview = previewOfEdits([{ path: '/gone.ts', textEdits: [edit()] }], () => undefined)
  assert.equal(preview.files[0].unavailable, true)
  assert.deepEqual(preview.files[0].changes, [])
  assert.equal(preview.changedLines, 1)
})

test('多文件汇总；没有编辑载荷时返回 null', () => {
  const preview = previewOfEdits([
    { path: '/a.ts', textEdits: [edit()] },
    { path: '/b.ts', textEdits: [edit({ text: '', startLine: 2, startChar: 0, endLine: 2, endChar: 1 })] },
  ], path => (path === '/a.ts' ? text : 'x\ny\nz\n'))
  assert.equal(preview.changedFiles, 2)
  assert.deepEqual([preview.added, preview.removed], [1, 2])
  assert.match(preview.summary, /将修改 2 个文件：1 行新增 \/ 2 行删除/)
  assert.equal(previewOfEdits([{ path: '/a.ts', textEdits: [] }], () => text), null)
  assert.equal(previewOfEdits([], () => text), null)
})

test('预览有上限：超过上限只计数并标 truncated', () => {
  const edits = Array.from({ length: PREVIEW_MAX_CHANGES + 5 }, (_, index) => edit({ startLine: index, endLine: index, text: `L${index}\n` }))
  const preview = previewOfEdits([{ path: '/x.ts', textEdits: edits }], () => edits.map(() => 'z').join('\n'))
  assert.equal(preview.files[0].changes.length, PREVIEW_MAX_CHANGES)
  assert.equal(preview.changedLines, PREVIEW_MAX_CHANGES + 5)
  assert.equal(preview.truncated, true)
})

test('消费链：问题面板行菜单用预览（服务端条目与抑制条目都带）', () => {
  const panel = read('src/components/ProblemsPanel.vue')
  assert.match(panel, /previewOfEdits/)
  assert.match(panel, /problems-menu-change/)
  assert.match(panel, /entry\.preview/)
})
