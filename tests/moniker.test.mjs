// `src/moniker.ts`：符号标识（IDEA Copy Reference 的落点）。
// 关键取舍：**`unique` 必须当真** —— `unique:false` 表示同名符号可能有多个，可以复制，
// 但要在提示里说清它不唯一，不能假装是精确引用。

import test from 'node:test'
import assert from 'node:assert/strict'

const { describeCopiedReference, primaryMoniker, referenceText } = await import('../src/moniker.ts')

test('优先取 unique:true 的那条（那才是精确引用）', () => {
  const monikers = [
    { identifier: 'counter', scheme: 'taocode', unique: false },
    { identifier: 'Sample.counter', scheme: 'taocode', unique: true },
  ]
  assert.equal(primaryMoniker(monikers)?.identifier, 'Sample.counter')
})

test('没有 unique 的标识时退回第一条（不能因此不给用）', () => {
  assert.equal(primaryMoniker([{ identifier: 'a' }, { identifier: 'b' }])?.identifier, 'a')
  // `unique` 缺失算"未知"，不算 true。
  assert.equal(primaryMoniker([{ identifier: 'a', unique: undefined }])?.identifier, 'a')
})

test('没有 identifier 的条目不算可用', () => {
  const monikers = [{ scheme: 'x', unique: true }, { identifier: 'real', unique: false }]
  assert.equal(primaryMoniker(monikers)?.identifier, 'real')
  assert.equal(primaryMoniker([{ scheme: 'x' }]), undefined)
  assert.equal(primaryMoniker([]), undefined)
  assert.equal(primaryMoniker(undefined), undefined)
})

test('复制的是 identifier 本身', () => {
  assert.equal(referenceText({ identifier: 'Sample.counter' }), 'Sample.counter')
  assert.equal(referenceText(undefined), '')
})

test('提示在标识不唯一时明确说出来', () => {
  assert.equal(describeCopiedReference({ identifier: 'x', unique: true }), '已复制引用 x')
  const loose = describeCopiedReference({ identifier: 'x', unique: false })
  assert.match(loose, /已复制引用 x/)
  assert.match(loose, /不唯一/, '不能假装它是精确引用')
  assert.equal(describeCopiedReference(undefined), '')
})
