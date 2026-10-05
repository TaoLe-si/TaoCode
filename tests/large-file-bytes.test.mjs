// 大文件按字节判定（`src/largeFileBytes.ts`）：UTF-8 长度、阈值策略、大小文案。
import test from 'node:test'
import assert from 'node:assert/strict'
import { LARGE_FILE_LIMIT } from '../src/largeFileMode.ts'
import { formatFileSize, isLargeFileText, largeFilePolicyForText, utf8ByteLength } from '../src/largeFileBytes.ts'

test('UTF-8 字节：ASCII 1、拉丁扩展 2、CJK 3、emoji 4', () => {
  assert.equal(utf8ByteLength('abc'), 3)
  assert.equal(utf8ByteLength('é'), 2)
  assert.equal(utf8ByteLength('中文'), 6, '两个汉字 6 字节')
  assert.equal(utf8ByteLength('😀'), 4, '代理对按一个码点 4 字节')
  assert.equal(utf8ByteLength('a中😀'), 1 + 3 + 4)
  assert.equal(utf8ByteLength(''), 0)
})

test('阈值：2M 个汉字就已超过 5MiB（按字符判会晚 3 倍）', () => {
  const cjk = '中'.repeat(2 * 1024 * 1024)
  assert.equal(utf8ByteLength(cjk), 6 * 1024 * 1024)
  assert.ok(isLargeFileText(cjk))
  assert.ok(largeFilePolicyForText(cjk).large)
  assert.ok(!largeFilePolicyForText('a'.repeat(LARGE_FILE_LIMIT - 1)).large)
  assert.ok(largeFilePolicyForText('a'.repeat(LARGE_FILE_LIMIT)).large)
  assert.equal(largeFilePolicyForText('x'.repeat(LARGE_FILE_LIMIT)).notice, largeFilePolicyForText('中'.repeat(LARGE_FILE_LIMIT)).notice)
})

test('降级清单与字符版一致（同一策略，只是口径换成字节）', () => {
  const policy = largeFilePolicyForText('a'.repeat(LARGE_FILE_LIMIT + 1))
  assert.deepEqual(policy.features, { lsp: false, syntaxHighlighting: false, wordWrap: false })
  assert.ok(policy.notice.includes('大文件模式'))
})

test('大小文案：B / KiB / MiB 各一档', () => {
  assert.equal(formatFileSize(512), '512 B')
  assert.equal(formatFileSize(2048), '2.0 KiB')
  assert.equal(formatFileSize(5 * 1024 * 1024), '5.0 MiB')
  assert.equal(formatFileSize(-1), '0 B')
  assert.equal(formatFileSize(Number.NaN), '0 B')
})
