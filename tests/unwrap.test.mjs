import test from 'node:test'
import assert from 'node:assert/strict'
import { dedentBlock, findUnwrapEdit, matchBrace } from '../src/unwrap.ts'

const unwrapAt = (text, marker, indentWidth = 4) => {
  const pos = text.indexOf(marker)
  assert.ok(pos >= 0, `标记 ${marker} 不在样例里`)
  return findUnwrapEdit(text, pos, pos, indentWidth)
}

test('花括号匹配跳过字符串与注释', () => {
  const text = 'if (x) { const a = "}"; // }\n /* } */ }'
  assert.equal(matchBrace(text, 7), text.length - 1)
})

test('dedentBlock 去掉每行一个缩进单位', () => {
  assert.equal(dedentBlock('\n    a\n        b\n', 4), '\na\n    b\n')
  assert.equal(dedentBlock('\n\ta\n\t\tb\n', 4), '\na\n\tb\n')
})

test('if 包裹被拆掉：头与括号消失、正文回缩', () => {
  const text = 'void f() {\n    if (ready) {\n        doWork()\n        done = true\n    }\n}\n'
  const edit = unwrapAt(text, 'doWork')
  assert.ok(edit)
  assert.equal(text.slice(edit.from, edit.to), '    if (ready) {\n        doWork()\n        done = true\n    }\n')
  assert.equal(edit.insert, '    doWork()\n    done = true\n')
})

test('for 头里的分号不会把头部截断', () => {
  const text = 'for (int i = 0; i < n; ++i) {\n    visit(i)\n}\n'
  const edit = unwrapAt(text, 'visit')
  assert.ok(edit)
  assert.equal(edit.from, 0)
  assert.equal(edit.insert, 'visit(i)\n')
})

test('最内层不可拆时向外找可拆的包裹', () => {
  const text = 'if (a) {\n    {\n        x()\n    }\n}\n'
  const edit = unwrapAt(text, 'x()')
  assert.ok(edit)
  assert.equal(text.slice(edit.from, edit.to), 'if (a) {\n    {\n        x()\n    }\n}\n')
  assert.equal(edit.insert, '{\n    x()\n}\n')
})

test('try/catch 与 do/while 拒绝拆解', () => {
  assert.equal(unwrapAt('try {\n    x()\n} catch (e) {\n    y()\n}\n', 'x()'), null)
  assert.equal(unwrapAt('do {\n    x()\n} while (ok)\n', 'x()'), null)
})

test('非控制流块（方法体/裸块）不拆', () => {
  assert.equal(unwrapAt('void f() {\n    x()\n}\n', 'x()'), null)
  assert.equal(unwrapAt('const o = {\n    x: 1\n}\n', 'x: 1'), null)
})

test('else 与 else if 也能拆', () => {
  const text = 'if (a) {\n    p()\n} else {\n    q()\n}\n'
  const edit = unwrapAt(text, 'q()')
  assert.ok(edit)
  assert.equal(text.slice(edit.from, edit.to), 'else {\n    q()\n}\n')
  assert.equal(text.slice(0, edit.from) + edit.insert + text.slice(edit.to), 'if (a) {\n    p()\n} \nq()\n')
})

test('选区跨多行时取包住选区的最内层块', () => {
  const text = 'if (a) {\n    one()\n    two()\n}\n'
  const edit = findUnwrapEdit(text, text.indexOf('one'), text.indexOf('two') + 3, 4)
  assert.ok(edit)
  assert.equal(edit.insert, 'one()\ntwo()\n')
})

test('单行块取 trim 后的正文', () => {
  const text = 'if (x) { doWork() }'
  const edit = findUnwrapEdit(text, 8, 8, 4)
  assert.ok(edit)
  assert.equal(edit.from, 0)
  assert.equal(edit.insert, 'doWork()')
})
