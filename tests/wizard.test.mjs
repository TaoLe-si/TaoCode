// 向导框架的判据（实现：src/wizard.ts，上游 Wizard/AbstractWizardStepEx/WizardContext 子集）。
import test from 'node:test'
import assert from 'node:assert/strict'

import { createWizard, createWizardContext } from '../src/wizard.ts'
import { validationError, validationWarning } from '../src/dialogValidation.ts'

function makeSteps() {
  return [
    { id: 'one', title: '第一步' },
    {
      id: 'two', title: '第二步',
      validate: context => (context.get('name') ? null : validationError('请填名称')),
    },
    { id: 'three', title: '第三步' },
  ]
}

test('导航：下一步受当前步校验门禁，上一步不受', () => {
  const wizard = createWizard(makeSteps(), createWizardContext())
  assert.equal(wizard.current, 0)
  assert.equal(wizard.isFirst(), true)
  assert.equal(wizard.canGoBack(), false)
  assert.equal(wizard.next(), true, '第一步无校验，可前进')
  assert.equal(wizard.current, 1)
  assert.equal(wizard.canGoNext(), false, '第二步缺名称')
  assert.equal(wizard.next(), false, '校验没过不许前进')
  assert.equal(wizard.current, 1)
  wizard.context.put('name', 'demo')
  assert.equal(wizard.canGoNext(), true)
  assert.equal(wizard.next(), true)
  assert.equal(wizard.current, 2)
  assert.equal(wizard.isLast(), true)
  assert.equal(wizard.finish(), true)
  assert.equal(wizard.back(), true)
  assert.equal(wizard.current, 1, '上一步不受第二步校验阻挡')
})

test('上下文是共享属性袋：提交回调能读写，put 会广播', () => {
  const context = createWizardContext()
  let changes = 0
  const unsubscribe = context.subscribe(() => { ++changes })
  const step = {
    id: 'commit', title: '提交步',
    commit: (ctx, type) => { ctx.put('committed', type) },
  }
  const wizard = createWizard([step], context)
  wizard.finish()
  assert.equal(context.get('committed'), 'finish')
  assert.equal(changes, 1, 'put 触发一次订阅通知')
  unsubscribe()
  context.put('x', 1)
  assert.equal(changes, 1, '退订后不再通知')
})

test('警告不拦下一步，错误才拦（ValidationInfo.okEnabled 语义）', () => {
  const wizard = createWizard([
    { id: 'warn', title: '警告步', validate: () => validationWarning('只是提醒') },
    { id: 'done', title: '完' },
  ])
  assert.equal(wizard.canGoNext(), true)
  assert.equal(wizard.validation()?.level, 'WARNING')
})

test('isVisible 参与可见步序列与下标；goTo 越界返回 false', () => {
  const wizard = createWizard([
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B', isVisible: ctx => ctx.get('showB') === true },
    { id: 'c', title: 'C' },
  ])
  assert.deepEqual(wizard.visibleSteps().map(step => step.id), ['a', 'c'])
  assert.equal(wizard.goTo(1), true)
  assert.equal(wizard.currentStep().id, 'c')
  assert.equal(wizard.goTo(5), false)
  assert.equal(wizard.current, 1, '越界不改当前位置')
})
