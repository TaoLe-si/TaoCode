// 判据 · **大文件查看器**（`src/largeFileViewer.ts`，上游
// `com.intellij.largeFilesEditor.editor.LargeFileEditorProvider` + EP `com.intellij.fileEditorProvider`）——
// 大文件按**字节**判定，换成只读降级查看器（关高亮/语言服务/自动换行）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { LARGE_FILE_LIMIT } from '../src/largeFileMode.ts'
import { formatFileSize, utf8ByteLength } from '../src/fileSizeFormat.ts'
import { editorProviderFor, fileEditorProviders } from '../src/fileEditorProviders.ts'
import {
  LARGE_FILE_EDITOR_PROVIDER, LARGE_FILE_EDITOR_PROVIDER_ID, LARGE_FILE_EDITOR_TYPE_ID,
  acceptsLargeFile, createLargeFileEditorView, largeFileBytesOf, largeFileEditorViewFor,
} from '../src/largeFileViewer.ts'

test('id 与上游逐字一致（EP 条目 id 与 getEditorTypeId 是两个不同的名字）', () => {
  assert.equal(LARGE_FILE_EDITOR_PROVIDER_ID, 'LargeFileEditor')          // intellij.platform.ide.impl.xml:1243 的 id
  assert.equal(LARGE_FILE_EDITOR_TYPE_ID, 'LargeFileEditorProvider')      // LargeFileEditorProvider.java:26 的 PROVIDER_ID
  assert.equal(LARGE_FILE_EDITOR_PROVIDER.getEditorTypeId(), 'LargeFileEditorProvider')
  assert.equal(LARGE_FILE_EDITOR_PROVIDER.getPolicy(), 'NONE', '上游 getPolicy() = FileEditorPolicy.NONE')
})

test('bundled provider 注册进 `com.intellij.fileEditorProvider`', () => {
  assert.ok(fileEditorProviders().some(provider => provider.id === LARGE_FILE_EDITOR_PROVIDER_ID))
  assert.equal(editorProviderFor({ path: 'big.txt', root: '/r', bytes: LARGE_FILE_LIMIT }).id, LARGE_FILE_EDITOR_PROVIDER_ID)
})

test('按字节判定：超限才认领（文本/字节两种输入都走同一条）', () => {
  assert.equal(acceptsLargeFile({ path: 'a', root: '/r', bytes: LARGE_FILE_LIMIT }), true)
  assert.equal(acceptsLargeFile({ path: 'a', root: '/r', bytes: LARGE_FILE_LIMIT - 1 }), false)
  assert.equal(largeFileBytesOf({ path: 'a', root: '/r', text: 'abc' }), 3, '没有 bytes 时按 UTF-8 文本算')
  assert.equal(largeFileBytesOf({ path: 'a', root: '/r' }), 0, '两者都没有 ⇒ 0，不当大文件')
  // 2M 个汉字 ≈ 6 MiB > 5 MiB：按字符数判会漏（这正是按字节判的用处）。
  const cjk = '汉'.repeat(LARGE_FILE_LIMIT / 3 + 1)
  assert.equal(acceptsLargeFile({ path: 'a', root: '/r', text: cjk }), true, 'CJK 按字节判超限')
})

test('视图描述：只读 + 降级 features + 大小文案', () => {
  const view = createLargeFileEditorView({ path: 'big.txt', root: '/r', bytes: LARGE_FILE_LIMIT })
  assert.equal(view.editorTypeId, LARGE_FILE_EDITOR_TYPE_ID)
  assert.equal(view.path, 'big.txt')
  assert.equal(view.readOnly, true)
  assert.equal(view.policy, 'NONE')
  assert.equal(view.sizeText, '5.0 MiB')
  assert.deepEqual(view.features, { lsp: false, syntaxHighlighting: false, wordWrap: false }, '降级档全关')
  assert.ok(view.notice.length > 0, '给出提示')
})

test('largeFileEditorViewFor：超限给视图，不超限/被第三方抢先给 null', () => {
  const big = largeFileEditorViewFor({ path: 'big.txt', root: '/r', bytes: LARGE_FILE_LIMIT })
  assert.ok(big && big.readOnly === true)
  assert.equal(largeFileEditorViewFor({ path: 'small.txt', root: '/r', bytes: 10 }), null)
})

test('大小/字节两个件从 fileSizeFormat 来（打断 largeFileBytes ↔ largeFileViewer 的循环）', () => {
  const viewer = readFileSync(new URL('../src/largeFileViewer.ts', import.meta.url), 'utf8')
  assert.match(viewer, /import \{ formatFileSize, utf8ByteLength \} from '\.\/fileSizeFormat\.ts'/)
  assert.doesNotMatch(viewer, /from '\.\/largeFileBytes\.ts'/, 'viewer 不许再回头 import largeFileBytes')
  // 同一份实现：视图里算出来的字节与大小文案，与那两个导出逐字一致。
  assert.equal(largeFileBytesOf({ path: 'a', root: '/r', text: '中文' }), utf8ByteLength('中文'))
  assert.equal(createLargeFileEditorView({ path: 'a', root: '/r', bytes: 2048 }).sizeText, formatFileSize(2048))
})
