// 对话框校验 DSL 的判据（实现：src/dialogValidation.ts，上游 ValidationInfo + validations.kt 子集）。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  and,
  asWarning,
  validateAll,
  validationError,
  validationErrorFor,
  validationErrorIf,
  validationMessages,
  validationWarning,
  withOKEnabled,
} from '../src/dialogValidation.ts'

test('validationErrorFor：取消息函数返回 null 即通过', () => {
  const check = validationErrorFor(value => (value ? null : '不能为空'))
  assert.equal(check('')?.message, '不能为空')
  assert.equal(check('x'), null)
})

test('validationErrorIf：谓词为真即失败，消息原样进 ValidationInfo', () => {
  const noSpace = validationErrorIf('不许有空格', value => String(value).includes(' '))
  assert.deepEqual(noSpace('a b'), { message: '不许有空格', level: 'ERROR', okEnabled: false })
  assert.equal(noSpace('ab'), null)
})

test('and：短路，只报第一条失败（上游 validate() ?: next.validate()）', () => {
  const combined = and(validationErrorIf('第一条', () => true), validationErrorIf('第二条', () => true))
  assert.equal(combined('x')?.message, '第一条')
  const second = and(validationErrorIf('第一条', () => false), validationErrorIf('第二条', () => true))
  assert.equal(second('x')?.message, '第二条')
})

test('asWarning 放行 OK；withOKEnabled 让错误也放行 OK', () => {
  const warning = asWarning(validationError('提醒'))
  assert.equal(warning.level, 'WARNING')
  assert.equal(warning.okEnabled, true)
  const forced = withOKEnabled(validationError('不拦'))
  assert.equal(validateAll([forced]).okEnabled, true)
})

test('validateAll：汇成错误列表 + OK 门禁；空消息不显示但仍然是问题', () => {
  const report = validateAll([
    validationError('名字有问题'),
    null,
    validationWarning('路径是只读的'),
    { message: '', level: 'ERROR', okEnabled: false },
  ])
  assert.equal(report.infos.length, 3, 'null 不计入')
  assert.equal(report.okEnabled, false, '有一条错误（空消息）就不许 OK')
  assert.equal(report.blocking?.message, '名字有问题')
  assert.deepEqual(validationMessages(report), ['名字有问题', '路径是只读的'], '空消息不显示')
  assert.equal(validateAll([validationWarning('w')]).okEnabled, true)
  assert.equal(validateAll([]).blocking, null)
})
