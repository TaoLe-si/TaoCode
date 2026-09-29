// `src/debugCompletions.ts`：DAP `completions` 的落项规则。
// 重点在「`start`/`length` 只有同时给且合法时才做局部替换」—— 按一个误导性的区间去切字符串
// 会把用户已经输入的内容切坏，比不替换糟得多。IDEA 侧没有平台级对应类的说明见模块注释。

import test from 'node:test'
import assert from 'node:assert/strict'

const { applyCompletionItem, completionSuggestions, completionTypeLabel } =
  await import('../src/debugCompletions.ts')

test('没有 label 的项被丢掉，同名的只留一条', () => {
  const items = [
    { label: 'counter', type: 'variable' },
    { label: 'counter', type: 'field' },          // 重名
    { label: '', type: 'orphan' },                // 没有显示名
    { type: 'orphan' },                           // 连 label 键都没有
    { label: 'countLocal' },
  ]
  const kept = completionSuggestions(items)
  assert.deepEqual(kept.map(item => item.label), ['counter', 'countLocal'])
  assert.equal(kept[0].type, 'variable', '去重时保留先出现的那条（适配器给的顺序通常带语义）')
  // 坏输入不抛异常。
  assert.deepEqual(completionSuggestions(undefined), [])
  assert.deepEqual(completionSuggestions([null, undefined]), [])
})

test('有合法的 start/length 时替换那一段', () => {
  // 文本 `counter + 1`，前 7 个字符被替换成 `countLocal`。
  assert.equal(applyCompletionItem('counter + 1', { label: 'countLocal', start: 0, length: 7 }), 'countLocal + 1')
  // 中间的片段也能替换。
  assert.equal(applyCompletionItem('a.b.c', { label: 'bcd', start: 2, length: 1 }), 'a.bcd.c')
})

test('text 优先于 label 作为插入内容', () => {
  assert.equal(applyCompletionItem('c', { label: 'counter（int）', text: 'counter' }), 'counter')
  assert.equal(applyCompletionItem('c', { label: 'counter' }), 'counter', '没有 text 就用 label')
  assert.equal(applyCompletionItem('c', undefined), 'c', '没有项就原样返回')
})

test('start/length 只给一个、或给出越界区间时降级为整段替换', () => {
  // 只给一个 = 畸形。按它去切字符串会把用户输入切坏，所以宁可整段替换。
  assert.equal(applyCompletionItem('counter + 1', { label: 'countLocal', start: 0 }), 'countLocal')
  assert.equal(applyCompletionItem('counter + 1', { label: 'countLocal', length: 7 }), 'countLocal')
  // 越界（start + length 超过文本长度）同样降级。
  assert.equal(applyCompletionItem('abc', { label: 'x', start: 1, length: 99 }), 'x')
  assert.equal(applyCompletionItem('abc', { label: 'x', start: 9, length: 1 }), 'x')
  // length 为 0 或负数不是合法区间（规范里长度必须是正数）。
  assert.equal(applyCompletionItem('abc', { label: 'x', start: 0, length: 0 }), 'x')
  assert.equal(applyCompletionItem('abc', { label: 'x', start: -1, length: 2 }), 'x')
  // 非整数（适配器给了小数）也不接受。
  assert.equal(applyCompletionItem('abc', { label: 'x', start: 0.5, length: 1 }), 'x')
})

test('刚好覆盖整段文本的区间也是合法的', () => {
  assert.equal(applyCompletionItem('counter', { label: 'countLocal', start: 0, length: 7 }), 'countLocal')
})

test('类型标签把规范里的常见取值翻成中文，表外的原样显示', () => {
  assert.equal(completionTypeLabel('variable'), '变量')
  assert.equal(completionTypeLabel('field'), '字段')
  assert.equal(completionTypeLabel('customtype'), 'customtype', '不认识就说原文，不要静默吞掉')
  assert.equal(completionTypeLabel(undefined), '')
})
