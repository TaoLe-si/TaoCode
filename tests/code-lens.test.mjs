// `src/codeLens.ts`：Code Vision 的纯规则（挂哪一行、点击发什么）。
// 关键取舍：**没有 `range` 的条目必须丢掉** —— IDEA 靠 `CodeVisionProvider.defaultAnchor`
// （platform/lang-impl/src/com/intellij/codeInsight/codeVision/CodeVisionProvider.kt:107）决定挂行首还是行尾，
// LSP 用 `range` 表达同一件事；没有它就只能编造一个位置。

import test from 'node:test'
import assert from 'node:assert/strict'

const { anchoredLenses, codeLensCommand, codeLensTooltip } = await import('../src/codeLens.ts')

const lens = (line, title = 'x', command = 'cmd') => ({
  title, command, range: { startLine: line, startChar: 0, endLine: line, endChar: 1 },
})

test('按行排序，并保持同一行内的原始顺序', () => {
  const items = [lens(5, 'b'), lens(1, 'a'), lens(5, 'c'), lens(3, 'd')]
  assert.deepEqual(anchoredLenses(items).map(entry => [entry.line, entry.item.title]),
    [[1, 'a'], [3, 'd'], [5, 'b'], [5, 'c']])
})

test('没有 range 的条目丢掉（不能编造一个位置）', () => {
  const items = [lens(0), { title: 'no range', command: 'cmd' }]
  assert.equal(anchoredLenses(items).length, 1)
  assert.deepEqual(anchoredLenses(undefined), [])
  assert.deepEqual(anchoredLenses([]), [])
})

test('空 title / 空 command / 坏行号都丢掉', () => {
  const items = [
    lens(0, '', 'cmd'),                       // 没有可显示的文字
    lens(0, 'x', ''),                         // 没有可执行的命令
    { title: 'x', command: 'cmd', range: { startLine: -1, startChar: 0, endLine: 0, endChar: 1 } },
    { title: 'x', command: 'cmd', range: { startLine: 1.5, startChar: 0, endLine: 1, endChar: 1 } },
    lens(2),                                  // 唯一合法的
  ]
  assert.deepEqual(anchoredLenses(items).map(entry => entry.line), [2])
})

test('点击参数：有 arguments 带上，没有就不带这个键', () => {
  assert.deepEqual(codeLensCommand(lens(0)), { command: 'cmd' })
  assert.deepEqual(codeLensCommand({ title: 'x', command: 'show', arguments: ['a', 1] }),
    { command: 'show', arguments: ['a', 1] })
  // 空数组是"显式传了零个参数"，与"没传"不同 —— 但要如实反映服务器给的东西。
  assert.deepEqual(codeLensCommand({ title: 'x', command: 'show', arguments: [] }),
    { command: 'show', arguments: [] })
  assert.equal(codeLensCommand(undefined), null)
  assert.equal(codeLensCommand({ title: 'x', command: '' }), null)
})

test('悬停提示说清点一下会执行什么', () => {
  assert.match(codeLensTooltip(lens(0, 'x', 'showUsages')), /showUsages/)
  assert.match(codeLensTooltip({ title: 'x', command: 'show', arguments: [1, 2] }), /2 个参数/)
  assert.equal(codeLensTooltip(undefined), '')
})
