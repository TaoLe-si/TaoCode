import test from 'node:test'
import assert from 'node:assert/strict'
import { LARGE_FILE_LIMIT, LARGE_FILE_NOTICE, largeFilePolicy } from '../src/largeFileMode.ts'

test('小文件保持全部特性', () => {
  const policy = largeFilePolicy(1024)
  assert.equal(policy.large, false)
  assert.equal(policy.notice, null)
  assert.deepEqual(policy.features, { lsp: true, syntaxHighlighting: true, wordWrap: true })
})

test('恰好到阈值即降级（判定是 >=）', () => {
  assert.equal(largeFilePolicy(LARGE_FILE_LIMIT - 1).large, false)
  assert.equal(largeFilePolicy(LARGE_FILE_LIMIT).large, true)
})

test('大文件关掉语言服务/高亮/自动换行并给出提示', () => {
  const policy = largeFilePolicy(LARGE_FILE_LIMIT + 1)
  assert.equal(policy.large, true)
  assert.equal(policy.notice, LARGE_FILE_NOTICE)
  assert.deepEqual(policy.features, { lsp: false, syntaxHighlighting: false, wordWrap: false })
})

test('坏输入（NaN/负数）按空文档处理', () => {
  assert.equal(largeFilePolicy(Number.NaN).large, false)
  assert.equal(largeFilePolicy(-1).large, false)
})
