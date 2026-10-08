// 多步向导框架（`src/wizard.ts`，新建项目对话框的「模板 → 名称与位置 → 审阅」即用它）：
// 共享上下文、可见步骤链、每步校验门禁、导航与提交时机、StepListener 式变更通知。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSubSteps, createWizard, createWizardContext, resolveSubStepSelection } from '../src/wizard.ts'
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

// ── 提交拒绝与子步骤表（上游 `CommitStepException` / `AbstractNewProjectWizardMultiStepBase`）──

test('提交被拒：导航不动、next/back/finish 返回 false，原因带出来', () => {
  const commits = []
  const steps = [
    { id: 'a', title: 'A', commit: (_c, type) => { commits.push(`a:${type}`); return { message: '路径被占用。' } } },
    { id: 'b', title: 'B' },
  ]
  const wizard = createWizard(steps)
  assert.equal(wizard.next(), false, '提交被拒 ⇒ 不前进')
  assert.equal(wizard.current, 0)
  assert.deepEqual(commits, ['a:next'], '提交回调跑过一次')
  const advance = wizard.advance('next')
  assert.equal(advance.moved, false)
  assert.equal(advance.error, '路径被占用。', '上游 Messages.showErrorDialog 那一句')
  assert.equal(wizard.lastRejection()?.message, '路径被占用。')
})

test('静默取消：不报错、只是不前进（CommitStepCancelledException）', () => {
  const steps = [
    { id: 'a', title: 'A', commit: () => ({ silent: true }) },
    { id: 'b', title: 'B' },
  ]
  const wizard = createWizard(steps)
  const advance = wizard.advance('next')
  assert.equal(advance.moved, false)
  assert.equal(advance.error, null, '静默取消不弹错误框')
  assert.equal(wizard.current, 0)
})

test('提交不返回拒绝对象 = 放行（返回别的值不当拒绝）', () => {
  const steps = [
    { id: 'a', title: 'A', commit: () => [1, 2].length },   // 回调里顺手返回个长度
    { id: 'b', title: 'B' },
  ]
  const wizard = createWizard(steps)
  assert.equal(wizard.next(), true, '非拒绝对象一律放行')
  assert.equal(wizard.lastRejection(), null)
})

test('子步骤表：新增档优先、当前档还在就保持、没了退第一档', () => {
  assert.equal(resolveSubStepSelection([], ['x', 'y'], ''), 'x', '首次给第一档')
  assert.equal(resolveSubStepSelection(['x', 'y'], ['x', 'y', 'z'], 'y'), 'z', '新增的 z 优先（上游 addedSteps.first()）')
  assert.equal(resolveSubStepSelection(['x', 'y'], ['x', 'y'], 'y'), 'y', '没有新增就保持当前')
  assert.equal(resolveSubStepSelection(['x', 'y'], ['y'], 'x'), 'y', '当前档被移除 ⇒ 退第一档')
  assert.equal(resolveSubStepSelection(['x'], [], 'x'), '', '空表给空串（不抛）')
  assert.equal(resolveSubStepSelection(['x'], ['x'], ''), 'x', '当前为空 ⇒ 第一档')
})

test('子步骤选择：不在表里的标签被拒', () => {
  const sub = createSubSteps(['java', 'kotlin'])
  assert.equal(sub.selected, 'java')
  assert.equal(sub.select('kotlin'), true)
  assert.equal(sub.selected, 'kotlin')
  assert.equal(sub.select('python'), false, '表里没有的不许选')
  assert.equal(sub.selected, 'kotlin')
})
