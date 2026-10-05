// 「完成当前语句」（IDEA `EditorCompleteStatement` / `SmartEnterAction`）的文本子集判据。
//
// 上游：`platform/lang-impl/.../smartEnter/SmartEnterAction.java:87-96`（逐个 processor，
// 都处理不了退回普通回车）、键位 Ctrl+Shift+Enter（`$default.xml:87-89`）。
// 这里锁的是 `src/smartEnter.ts` 的词法规则（本仓没有 PSI，只补括号/注释）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { completeStatement } from '../src/smartEnter.ts'

test('补未闭合的圆括号（光标在行尾）', () => {
  assert.deepEqual(completeStatement('foo(', 4), { from: 4, insert: ')' })
  assert.deepEqual(completeStatement('if (x > 1 && y', 14), { from: 14, insert: ')' })
})

test('嵌套括号按栈逆序补齐', () => {
  assert.deepEqual(completeStatement('foo(bar[1', 9), { from: 9, insert: '])' })
  assert.deepEqual(completeStatement('call({ key: [1, 2', 17), { from: 17, insert: ']})' })
})

test('补在行尾空白之前，不把空白留在括号外', () => {
  assert.deepEqual(completeStatement('foo(   ', 7), { from: 4, insert: ')' })
})

test('行尾有行注释时补在注释之前（补在注释后面等于死文本）', () => {
  assert.deepEqual(completeStatement('foo( // 先写一半', 15), { from: 4, insert: ')' })
  assert.deepEqual(completeStatement('foo(  // x', 9), { from: 4, insert: ')' })
})

test('已经平衡 / 有多余右括号时不猜', () => {
  assert.equal(completeStatement('foo()', 5), null)
  assert.equal(completeStatement('const x = 1;', 12), null)
  assert.equal(completeStatement('foo)', 4), null, '多余的右括号会破坏语法，不替用户猜')
  assert.equal(completeStatement(']', 1), null)
})

test('字符串与字符字面量里的括号不算', () => {
  assert.equal(completeStatement('const s = "a("', 14), null)
  assert.equal(completeStatement("const c = '['", 14), null)
  assert.equal(completeStatement('const t = `{`', 14), null)
  assert.equal(completeStatement('const s = "unterminated(', 26), null, '未闭合字符串吃掉整行，不补括号')
})

test('落单的块注释补 */（只在光标位于未闭合注释里时）', () => {
  assert.deepEqual(completeStatement('/* 说明', 5), { from: 5, insert: '*/' })
  assert.deepEqual(completeStatement('/* 说明 */', 9), null, '已经闭合就不补')
  assert.deepEqual(completeStatement('foo( /* 半句', 10), { from: 10, insert: '*/)' }, '注释先闭合，括号补在 */ 之后')
  assert.deepEqual(completeStatement('/* 说明 */ foo(', 13), { from: 13, insert: ')' }, '注释在括号前，互不影响')
})

test('光标后面还有代码且缺括号时不插到另一条语句后面', () => {
  assert.equal(completeStatement('if (x) { foo();', 7), null)
  assert.equal(completeStatement('foo( bar()', 4), null, '同一行里的多语句交给用户')
})

test('光标在注释里：注释与括号一起补，且注释先闭合', () => {
  // `foo( /* note` 里光标在 `note` 后（行尾），补完是 `foo( /* note*/)`
  assert.deepEqual(completeStatement('foo( /* note', 12), { from: 12, insert: '*/)' })
})
