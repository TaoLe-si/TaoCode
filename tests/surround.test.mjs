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
