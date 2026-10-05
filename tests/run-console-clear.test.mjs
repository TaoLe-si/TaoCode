// 控制台的「清空」动作（上游 IDEA 控制台的 Clear All / `ClearConsoleAction`）。
//
// 语义只在 src/runInstances.ts 的 `clearRunOutput` 一处：清**当前实例**的缓冲与它的镜像；
// 其它实例不变；清空后新到的输出接着写。这里测状态语义与组件接线。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { activeRunInstance, clearRunOutput, focusRunInstance, handleRunOutput, handleRunStarted, runInstances, runOutput } from '../src/runInstances.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('clearRunOutput：清当前实例的缓冲与镜像，另一个实例不动', () => {
  handleRunStarted({ instance: 11, label: 'A' })
  handleRunOutput(11, 'A 第一行\n')
  handleRunStarted({ instance: 12, label: 'B' })
  handleRunOutput(12, 'B 第一行\n')
  handleRunOutput(11, 'A 第二行\n')   // B 当前选中时，A 只进自己的缓冲
  assert.deepEqual([...runOutput], ['B 第一行\n'])

  // 切到 A，清空：A 的缓冲与镜像都空，B 的缓冲保留。
  focusRunInstance(11)
  assert.deepEqual([...runOutput], ['A 第一行\n', 'A 第二行\n'])
  clearRunOutput()
  assert.deepEqual([...runOutput], [])
  assert.deepEqual(runInstances.get(11).output, [])
  assert.deepEqual(runInstances.get(12).output, ['B 第一行\n'])
  assert.equal(activeRunInstance.value, 11, '清空不改选中实例')

  // 清空后新输出继续进来（在跑的进程不会被清空影响）。
  handleRunOutput(11, 'A 第三行\n')
  assert.deepEqual([...runOutput], ['A 第三行\n'])
  focusRunInstance(12)
  assert.deepEqual([...runOutput], ['B 第一行\n'], '切到 B 还是它自己的内容')
  focusRunInstance(11)
  assert.deepEqual([...runOutput], ['A 第三行\n'], '回到 A 看不到已清掉的行')
})

test('接线：RunConsole 有清空按钮并调用 clearRunOutput', () => {
  const console = read('src/components/RunConsole.vue')
  assert.ok(console.includes('clearRunOutput'), '组件要导入并调用 clearRunOutput')
  assert.ok(console.includes('aria-label="清空控制台输出"'), '按钮要可访问（aria-label）')
})
