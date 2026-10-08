// 判据 · **大文件提示条**（`src/largeFileNotice.ts`，上游 `LargeFileNotificationProvider`）——
// 文案里的大小与**降级清单跟着编辑器提供者（EP）走**：`largeFileNoticeText(bytes, path, root)`
// 调 `largeFileEditorViewFor()`（`com.intellij.fileEditorProvider` 的 `LargeFileEditor` 支，
// bundled 贡献在 `src/largeFileViewer.ts`）。
//
// 与 `tests/ep-component-mount.test.mjs` 的 item9 是同一条链路的两个视角：那边钉「组件挂载点」，
// 这边钉「提示模块自己的三档输出」—— 视图给出 features 时逐项列，视图缺席时退回本地说法。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LARGE_FILE_LIMIT } from '../src/largeFileMode.ts'
import { largeFileNoticeText } from '../src/largeFileNotice.ts'
import { registerFileEditorProvider, registerFileEditorProviderSuppressor } from '../src/fileEditorProviders.ts'
import { LARGE_FILE_EDITOR_PROVIDER, LARGE_FILE_EDITOR_PROVIDER_ID } from '../src/largeFileViewer.ts'

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const BIG = 6 * 1024 * 1024
const restoreBundled = () => registerFileEditorProvider(LARGE_FILE_EDITOR_PROVIDER, { source: 'bundled' })

test('文案：大小/只读/三项全关的清单（bundled 一档）', () => {
  const text = largeFileNoticeText(BIG)
  assert.match(text, /6\.0 MiB/)
  assert.match(text, /只读/)
  assert.match(text, /语法高亮、语言服务与自动换行已关闭/)
  assert.match(text, /查找替换/)
})

test('文案真的走 largeFileEditorViewFor（源码锚点）', () => {
  const notice = source('src/largeFileNotice.ts')
  assert.match(notice, /const view = largeFileEditorViewFor\(\{ path, root, bytes \}\)/)
  assert.match(notice, /const sizeText = view\?\.sizeText \?\? formatFileSize\(bytes\)/)
  assert.match(notice, /const features = view\?\.features/)
})

test('第三方提供者：sizeText 与 features 逐项进文案（path/root 也透传过去）', () => {
  const seen = []
  const handle = registerFileEditorProvider({
    id: LARGE_FILE_EDITOR_PROVIDER_ID,
    getEditorTypeId: () => 'ThirdPartyLargeFile',
    accept: input => { seen.push(input); return (input.bytes ?? 0) >= LARGE_FILE_LIMIT },
    createEditor: () => ({
      editorTypeId: 'ThirdPartyLargeFile', sizeText: '巨无霸',
      features: { lsp: false, syntaxHighlighting: true, wordWrap: false }, notice: '',
    }),
  })
  try {
    const text = largeFileNoticeText(LARGE_FILE_LIMIT, 'src/big.ts', '/ws')
    assert.match(text, /巨无霸/, '大小文案来自 EP 里那支提供者')
    assert.match(text, /语言服务、自动换行已关闭/)
    assert.doesNotMatch(text, /语法高亮/, '只关了两项时不许把没关的列进去')
    assert.equal(seen[seen.length - 1].path, 'src/big.ts', 'path 透传（按路径认领的提供者要它）')
    assert.equal(seen[seen.length - 1].root, '/ws', 'root 透传')
  } finally {
    handle.dispose()
    restoreBundled()
  }
})

test('第三方全开 features ⇒ 文案如实说「未降级任何编辑器能力」', () => {
  const handle = registerFileEditorProvider({
    id: LARGE_FILE_EDITOR_PROVIDER_ID,
    getEditorTypeId: () => 'ThirdPartyLargeFile',
    accept: () => true,
    createEditor: () => ({ sizeText: '1.0 MiB', features: { lsp: true, syntaxHighlighting: true, wordWrap: true }, notice: '' }),
  })
  try {
    const text = largeFileNoticeText(LARGE_FILE_LIMIT)
    assert.match(text, /未降级任何编辑器能力/)
    assert.doesNotMatch(text, /已关闭/)
  } finally {
    handle.dispose()
    restoreBundled()
  }
})

test('被抑制 / 没有视图 ⇒ 退回本地说法（三项全关 + 本地格式化的大小）', () => {
  const suppressor = registerFileEditorProviderSuppressor({
    id: 'test.suppressBigFiles',
    suppress: input => (input.bytes ?? 0) >= LARGE_FILE_LIMIT,
  })
  try {
    const text = largeFileNoticeText(BIG)
    assert.match(text, /6\.0 MiB/)
    assert.match(text, /语法高亮、语言服务与自动换行已关闭/)
    assert.match(text, /只读/, '没有视图时仍如实写只读（与 CodeEditor 的保护层一致）')
  } finally {
    suppressor.dispose()
  }
})
