// B6：`AnActionListener` 的 before/after 广播判据。
//
// 上游 `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/ex/AnActionListener.java`
// 有两个回调（`beforeActionPerformed` / `afterActionPerformed`），`ActionManagerImpl` 每执行一个动作
// 遍历监听者广播一遍；平台内置的消费者是宏录制（`ActionMacroManager` 在 before 里记一步）。
//
// 本仓的管道在 `src/actionEvents.ts`（纯广播，不 import 宏宿主），`src/menuUi.ts` 的三条执行链
// （菜单点击 / 查找操作 / 编辑器右键，都走 `runAction` 那条）在动作前后各广播一次，并把宏录制
// 登记成内置监听者。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { addActionListener, fireAfterActionPerformed, fireBeforeActionPerformed } from '../src/actionEvents.ts'

test('顺序：before → 动作 → after（两个回调都拿到同一个 step）', () => {
  const seen = []
  const off = addActionListener({
    beforeActionPerformed: step => seen.push(`before:${step.id}`),
    afterActionPerformed: step => seen.push(`after:${step.id}`),
  })
  const step = { id: 'file.save', title: '保存', keys: 'Ctrl S' }
  fireBeforeActionPerformed(step)
  seen.push('run')
  fireAfterActionPerformed(step)
  off()
  assert.deepEqual(seen, ['before:file.save', 'run', 'after:file.save'])
})

test('注销之后不再收事件（返回的注销函数是唯一的退出通道）', () => {
  let count = 0
  const off = addActionListener({ beforeActionPerformed: () => { count++ } })
  fireBeforeActionPerformed({ id: 'a', title: 'a' })
  off()
  fireBeforeActionPerformed({ id: 'b', title: 'b' })
  assert.equal(count, 1)
})

test('广播是同步遍历：某个监听者抛错会中断后面的（不自造容错）', () => {
  const seen = []
  const off1 = addActionListener({ beforeActionPerformed: () => { seen.push('one'); throw new Error('boom') } })
  const off2 = addActionListener({ beforeActionPerformed: step => seen.push(`two:${step.id}`) })
  assert.throws(() => fireBeforeActionPerformed({ id: 'a', title: 'a' }), /boom/)
  off1(); off2()
  assert.deepEqual(seen, ['one'], '同一个监听者抛错时后面的广播被中断（上游也是同一层调用栈）')
  // 清掉之后不影响后续用例。
  fireBeforeActionPerformed({ id: 'b', title: 'b' })
})

test('没在录制时广播照常派发，只是宏监听者什么都不记（空操作）', () => {
  let seen = 0
  const off = addActionListener({ afterActionPerformed: () => { seen++ } })
  fireAfterActionPerformed({ id: 'x', title: 'x' })
  off()
  assert.equal(seen, 1)
})

test('接线：menuUi 的三条执行链都从广播口过，宏录制是登记进来的监听者', () => {
  const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
  const menu = read('src/menuUi.ts')
  assert.match(menu, /fireBeforeActionPerformed/, '执行前广播')
  assert.match(menu, /fireAfterActionPerformed/, '执行后广播')
  assert.doesNotMatch(menu, /^  recordActionStep\(/m, '菜单分派里不该再直接调宏录制')
  assert.match(menu, /addActionListener\(\{ beforeActionPerformed: recordActionStep \}\)/, '内置宏监听者的登记点')
  const events = read('src/actionEvents.ts')
  assert.doesNotMatch(events, /macroHost/, '管道不依赖宏宿主（保持可单测）')
})
