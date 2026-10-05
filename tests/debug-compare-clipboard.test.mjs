// 「与剪贴板比较」（`src/debugCompareClipboard.ts`）—— 上游 `XCompareWithClipboardAction`
// （`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/ui/tree/actions/XCompareWithClipboardAction.java:31-36`）：
// 值文本丢给 `DiffRequestFactory.createClipboardVsValue(value)`，再 `DiffManager.showDiff`。
// 本仓复用 `src/diffText.ts` 的行级 diff 引擎（与保存冲突预览、对比视图同一份）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { clipboardCompare, clipboardCompareChanges, clipboardCompareTitle } from '../src/debugCompareClipboard.ts'

test('完全相同 ⇒ 没有改动行，identical 为真', () => {
  const result = clipboardCompare({ clipboard: 'alpha\nbeta', value: 'alpha\nbeta', name: 'msg' })
  assert.equal(result.identical, true)
  assert.equal(clipboardCompareChanges(result.rows), 0)
  assert.equal(result.empty, false)
})

test('逐行差异：不一致的行分别报出来，左右文本是各自那一侧', () => {
  const result = clipboardCompare({ clipboard: 'alpha\nbeta', value: 'alpha\ngamma', name: 'msg' })
  assert.equal(result.identical, false)
  assert.deepEqual(result.rows.map(row => row.kind), ['equal', 'delete', 'insert'])
  assert.equal(result.rows[0].left.text, 'alpha')
  assert.equal(result.rows[1].left.text, 'beta')
  assert.equal(result.rows[2].right.text, 'gamma')
  assert.equal(clipboardCompareChanges(result.rows), 2)
})

test('多出来/少掉的那几行分别算 insert / delete', () => {
  const longer = clipboardCompare({ clipboard: 'a', value: 'a\nb\nc', name: 'v' })
  assert.equal(longer.rows.filter(row => row.kind === 'insert').length, 2)
  const shorter = clipboardCompare({ clipboard: 'a\nb\nc', value: 'a', name: 'v' })
  assert.equal(shorter.rows.filter(row => row.kind === 'delete').length, 2)
})

test('两边都空 ⇒ empty（不给一个空 diff 窗口）', () => {
  const result = clipboardCompare({ clipboard: '', value: '', name: 'x' })
  assert.equal(result.empty, true)
  assert.equal(result.rows.length, 0)
  // 有一边有内容就不是 empty（哪怕另一边是空串）。
  assert.equal(clipboardCompare({ clipboard: '', value: 'only', name: 'x' }).empty, false)
})

test('`fullValue` 覆盖行上的摘要值（容器节点的 `{…}` 摘要不参与比对）', () => {
  const summary = clipboardCompare({ clipboard: 'John', value: '{name=John}', name: 'u', fullValue: 'John' })
  assert.equal(summary.identical, true)
  const withoutFull = clipboardCompare({ clipboard: 'John', value: '{name=John}', name: 'u' })
  assert.equal(withoutFull.identical, false)
})

test('值文本里的换行参与比对，不先压成一行', () => {
  // "line1\nline2" 与 "line1 line2" 是两行 vs 一行 ⇒ 有增有删，不是「相同」。
  const result = clipboardCompare({ clipboard: 'line1\nline2', value: 'line1 line2', name: 'v' })
  assert.equal(result.identical, false)
  assert.equal(result.rows.filter(row => row.kind === 'insert').length, 1)
  assert.equal(result.rows.filter(row => row.kind === 'delete').length, 2)
})

test('标题带上节点名', () => {
  assert.equal(clipboardCompareTitle('order.total'), '剪贴板 ↔ order.total')
  assert.equal(clipboardCompare({ clipboard: '', value: '', name: 'order.total' }).title, '剪贴板 ↔ order.total')
})
