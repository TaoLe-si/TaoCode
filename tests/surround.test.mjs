import test from 'node:test'
import assert from 'node:assert/strict'

import { surroundTemplates, wrapSelection } from '../src/surround.ts'

const titled = title => surroundTemplates.find(template => template.title === title)
const caretAt = (wrapped) => wrapped.text.slice(0, wrapped.caret) + '|' + wrapped.text.slice(wrapped.caret)

test('a block surround indents the code one level and closes at the base indent', () => {
  const wrapped = wrapSelection(titled('代码块 { }'), 'doWork()\nagain()', '', '  ')
  assert.equal(wrapped.text, '{\n  doWork()\n  again()\n}')
  assert.equal(caretAt(wrapped), '{\n  doWork()\n  again()|\n}')
})

test('a condition template parks the caret inside the empty parentheses', () => {
  const wrapped = wrapSelection(titled('if 条件'), 'doWork()', '  ', '    ')
  assert.equal(wrapped.text, '  if () {\n      doWork()\n  }')
  assert.equal(caretAt(wrapped), '  if (|) {\n      doWork()\n  }')
})

test('the wrapped code keeps its own relative indentation', () => {
  const wrapped = wrapSelection(titled('try / catch'), 'a()\n    b()\n\n  c()', '', '  ')
  assert.equal(wrapped.text, 'try {\n  a()\n      b()\n\n    c()\n} catch (error) {\n\n}')
})

test('inline surrounds keep everything on one line', () => {
  const parens = wrapSelection(titled('括号 ( )'), 'a + b', '', '  ')
  assert.equal(parens.text, '(a + b)')
  assert.equal(caretAt(parens), '(a + b|)')
  const comment = wrapSelection(titled('行注释 //'), 'x = 1', '  ', '  ')
  assert.equal(comment.text, '// x = 1')
})

test('every template can be applied twice without losing the code', () => {
  for (const template of surroundTemplates) {
    const once = wrapSelection(template, 'value', '', '  ')
    assert.ok(once.caret >= 0 && once.caret <= once.text.length, `${template.title} caret is inside the text`)
    const body = template.block ? '  value' : 'value'
    const twice = wrapSelection(template, body, '', '  ')
    assert.ok(twice.text.includes('value'), `${template.title} must keep the wrapped code`)
    assert.ok(template.title && template.keywords && (template.block || template.prefix || template.suffix))
  }
  assert.equal(new Set(surroundTemplates.map(template => template.title)).size, surroundTemplates.length)
})

// 上游 `Surround With` 的条目表：`java/java-impl/src/com/intellij/codeInsight/generation/surroundWith/
// JavaStatementsSurroundDescriptor.java:26-40`（if → if-else → while → do-while → for →
// try-catch → try-finally → try-catch-finally → synchronized → Runnable → block）。
// `synchronized`(:36) 与 `Runnable`(:37) 是 Java 专有构造，本仓的编辑器档没有对应写法 ⇒ 不列。
test('包裹表含上游那张表里语言中立的每一项（do-while 与 try-catch-finally 不再缺）', () => {
  for (const title of ['if 条件', 'if / else', 'while 循环', 'do / while 循环', 'for 索引循环',
    'try / catch', 'try / finally', 'try / catch / finally', '代码块 { }'])
    assert.ok(surroundTemplates.some(template => template.title === title), `缺 ${title}`)
  for (const javaOnly of ['synchronized', 'Runnable'])
    assert.ok(!surroundTemplates.some(template => template.title.includes(javaOnly)), `${javaOnly} 是 Java 专有构造，不该出现`)
})

test('do / while：正文缩进一层，光标停在 while 的条件里（不是刚包住的代码后面）', () => {
  const wrapped = wrapSelection(titled('do / while 循环'), 'doWork()', '  ', '    ')
  assert.equal(wrapped.text, '  do {\n      doWork()\n  } while ()')
  assert.equal(caretAt(wrapped), '  do {\n      doWork()\n  } while (|)')
})

test('try / catch / finally：三段都在，正文只保留自己那份', () => {
  const wrapped = wrapSelection(titled('try / catch / finally'), 'doWork()', '', '  ')
  assert.equal(wrapped.text, 'try {\n  doWork()\n} catch (error) {\n\n} finally {\n\n}')
  // catch (error) 里带的是参数名不是空括号 ⇒ 光标仍落在正文之后（与 try / catch 同一口径）。
  assert.equal(caretAt(wrapped), 'try {\n  doWork()|\n} catch (error) {\n\n} finally {\n\n}')
})

