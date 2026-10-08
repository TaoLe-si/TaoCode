// dm/highlight 的 `HighlightInfo` 展示/描述两函数单元测试。
//
// 上游 `platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/HighlightingProblem.kt`
// 的 `text`（:77-83）与 `description`（:96-103）各对应本文件的一个函数。
// 判词里「富信息的多行展示」这一条就是靠它钉住。
import test from 'node:test'
import assert from 'node:assert/strict'
import { highlightInfoDescription, highlightInfoNodeText } from '../src/highlightInfoText.ts'

test('单行：node text 原样 / description null（上游没换行就原样、tooltip 为 null）', () => {
  assert.equal(highlightInfoNodeText('useless symbol'), 'useless symbol')
  assert.equal(highlightInfoDescription('useless symbol'), null)
})

test('带换行：node text 取第一行 + `…` / description 保留全文（上游 :80 / :103）', () => {
  const multi = 'line one\nline two\rline three'
  assert.equal(highlightInfoNodeText(multi), 'line one\u2026')
  assert.equal(highlightInfoDescription(multi), multi)
})

test('富文本 `<html>` 头：node text 原样 / description null（上游 :79/:101）', () => {
  const rich = '<html><body>Hello</body></html>\nsecond line'
  assert.equal(highlightInfoNodeText(rich), rich)
  assert.equal(highlightInfoDescription(rich), null)
})

test('空：没有展示文也没有描述（调用方数据字段允许空消息）', () => {
  assert.equal(highlightInfoNodeText(''), '')
  assert.equal(highlightInfoDescription(''), null)
})

test('只 `\r` 换行：text 同样截 + `…`（上游 `isLineBreak` 认 `\r` 与 `\n`）', () => {
  const cr = 'only cr\rreturn'
  assert.equal(highlightInfoNodeText(cr), 'only cr\u2026')
  assert.equal(highlightInfoDescription(cr), cr)
})

