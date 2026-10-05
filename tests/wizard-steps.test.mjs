// 多步向导框架（`src/wizard.ts`，新建项目对话框的「模板 → 名称与位置 → 审阅」即用它）：
// 共享上下文、可见步骤链、每步校验门禁、导航与提交时机、StepListener 式变更通知。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWizard, createWizardContext } from '../src/wizard.ts'
import { validationError, validationWarning } from '../src/dialogValidation.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('上下文：键值袋 + 每次 put 通知订阅者 + 退订', () => {
  const context = createWizardContext({ name: 'demo' })
  assert.equal(context.get('name'), 'demo')
  assert.equal(context.has('name'), true)
  assert.deepEqual(context.keys(), ['name'])
  let calls = 0
  const off = context.subscribe(() => { ++calls })
  context.put('parent', 'D:/x')
  context.put('parent', 'D:/y')
  assert.equal(calls, 2, '每次写都通知')
  off()
  context.put('parent', 'D:/z')
  assert.equal(calls, 2)
})

test('导航：next/back 带提交时机，goTo 越界拒绝，stepTitle 跟随当前步', () => {
  const commits = []
  const context = createWizardContext()
  const steps = [
    { id: 'a', title: '模板', commit: (_c, type) => commits.push(`a:${type}`) },
    { id: 'b', title: '位置', commit: (_c, type) => commits.push(`b:${type}`) },
    { id: 'c', title: '审阅', commit: (_c, type) => commits.push(`c:${type}`) },
  ]
  const wizard = createWizard(steps, context)
  assert.equal(wizard.current, 0)
  assert.equal(wizard.isFirst(), true)
  assert.equal(wizard.stepTitle(), '模板')
  assert.equal(wizard.next(), true)
  assert.equal(wizard.currentStep().id, 'b')
  assert.equal(wizard.stepTitle(), '位置')
  assert.equal(wizard.back(), true)
  assert.equal(wizard.currentStep().id, 'a')
  assert.equal(wizard.goTo(2), true)
  assert.equal(wizard.isLast(), true)
  assert.equal(wizard.goTo(3), false, '越界')
  assert.equal(wizard.goTo(-1), false)
  assert.equal(wizard.finish(), true)
  assert.deepEqual(commits, ['a:next', 'b:prev', 'c:finish'])
})

test('校验门禁：错误档挡住 next/finish，警告档放行', () => {
  let invalid = true
  const steps = [
    { id: 'a', title: 'A', validate: () => (invalid ? validationError('名称重复。') : null) },
    { id: 'b', title: 'B' },
  ]
  const wizard = createWizard(steps)
  assert.equal(wizard.canGoNext(), false)
  assert.equal(wizard.next(), false)
  assert.equal(wizard.current, 0, '被拒后停在原步骤')
  assert.equal(wizard.validation()?.message, '名称重复。')
  invalid = false
  assert.equal(wizard.canGoNext(), true)
  assert.equal(wizard.next(), true)
  assert.equal(wizard.currentStep().id, 'b')
  // 警告档：okEnabled 为真，不拦。
  const warned = createWizard([{ id: 'w', title: 'W', validate: () => validationWarning('只是提醒') }, { id: 'z', title: 'Z' }])
  assert.equal(warned.canGoNext(), true)
  assert.equal(warned.next(), true)
})

test('可见步骤：isVisible=false 的步不参与导航，上下文变化后钳位', () => {
  const context = createWizardContext({ advanced: false })
  const steps = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B', isVisible: () => Boolean(context.get('advanced')) },
    { id: 'c', title: 'C' },
  ]
  const wizard = createWizard(steps, context)
  assert.deepEqual(wizard.visibleSteps().map(step => step.id), ['a', 'c'])
  assert.equal(wizard.next(), true)
  assert.equal(wizard.currentStep().id, 'c', '隐藏步被跳过')
  assert.equal(wizard.isLast(), true)
  context.put('advanced', true)
  assert.deepEqual(wizard.visibleSteps().map(step => step.id), ['a', 'b', 'c'])
  assert.equal(wizard.isLast(), false, '步数变化后不再认为在末步')
  wizard.goTo(2)
  context.put('advanced', false)
  assert.equal(wizard.current, 1, '可见步变少后钳到最后一个')
})

test('变更通知：导航与上下文写都通知，退订生效', () => {
  const context = createWizardContext()
  const wizard = createWizard([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], context)
  let calls = 0
  const off = wizard.onChange(() => { ++calls })
  wizard.next()
  wizard.back()
  context.put('x', 1)
  assert.equal(calls, 3)
  off()
  wizard.next()
  assert.equal(calls, 3)
})

test('接线：新建项目对话框的两步流用的是这个向导', () => {
  const dialog = readFileSync(join(root, 'src/components/ProjectDialog.vue'), 'utf8')
  assert.match(dialog, /import \{ createWizard \} from '\.\.\/wizard\.ts'/, '对话框没有接向导')
  assert.match(dialog, /wizard\.next\(\)/, '前进没有走向导的校验门禁')
  assert.match(dialog, /wizard\.back\(\)/, '后退没有走向导')
  assert.match(dialog, /projectNameError/, '既有的纯函数校验不能在重构里丢')
})
