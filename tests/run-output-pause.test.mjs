// exec/actions 本轮补齐的「暂停输出」（上游 PauseOutputAction）判据：
// 暂停冻结的是当前实例的**视图镜像**，实例缓冲继续累积；继续时补齐。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  activeRunInstance, focusRunInstance, handleRunOutput, handleRunStarted, runInstances, runOutput,
  runOutputPaused, setRunOutputPaused,
} from '../src/runInstances.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

function reset() {
  runInstances.clear()
  activeRunInstance.value = 0
  runOutput.splice(0)
  setRunOutputPaused(false)
}

test('暂停：镜像停住、缓冲继续；继续时补齐暂停期间的内容', () => {
  reset()
  handleRunStarted({ instance: 1, label: 'A' })
  handleRunOutput(1, '第一行\n')
  assert.deepEqual([...runOutput], ['第一行\n'])

  setRunOutputPaused(true)
  assert.equal(runOutputPaused.value, true)
  handleRunOutput(1, '暂停期间 1\n')
  handleRunOutput(1, '暂停期间 2\n')
  assert.deepEqual([...runOutput], ['第一行\n'], '视图冻结')
  assert.deepEqual(runInstances.get(1).output, ['第一行\n', '暂停期间 1\n', '暂停期间 2\n'], '缓冲照常累积')

  setRunOutputPaused(false)
  assert.deepEqual([...runOutput], ['第一行\n', '暂停期间 1\n', '暂停期间 2\n'], '继续后一条不少')
})

test('暂停时切换实例不改视图；恢复后对齐当前实例', () => {
  reset()
  handleRunStarted({ instance: 1, label: 'A' })
  handleRunOutput(1, 'A1')
  handleRunStarted({ instance: 2, label: 'B' })
  handleRunOutput(2, 'B1')
  setRunOutputPaused(true)
  focusRunInstance(1)
  assert.equal(activeRunInstance.value, 1, '选中实例照常切换')
  assert.deepEqual([...runOutput], ['B1'], '视图停在暂停时看到的内容')
  setRunOutputPaused(false)
  assert.deepEqual([...runOutput], ['A1'], '恢复后对齐当前实例')
})

test('接线：RunConsole 的暂停/继续按钮走 runInstances 的同一状态', () => {
  const console = read('src/components/RunConsole.vue')
  assert.match(console, /setRunOutputPaused\(!runOutputPaused\)/)
  // 按钮的按下态/文案走 `runOutputPausedState()` —— EP `com.intellij.execution.consolePauseStateProvider`
  // 的 bundled 贡献就是 `runOutputPaused`（见 tests/execution-run-extension-points.test.mjs）：
  // 无插件时该表达式恒等于 `runOutputPaused`，行为与接线前一致。
  assert.match(console, /const consolePaused = computed\(\(\) => runOutputPausedState\(\)\)/)
  assert.match(console, /consolePaused \? '继续输出' : '暂停输出'/)
  // 暂停提示只留一句状态：上游只有动作名（`ExecutionBundle` 的
  // `run.configuration.pause.output.action.name`，`PauseOutputAction.java:21`），**没有**这句提示的原文；
  // 2026-10-08 交接件明确要求「未经上游确认的文案不许保留」，所以括号里的实现解释已删。
  assert.match(console, /输出已暂停。/)
  const instances = read('src/runInstances.ts')
  assert.match(instances, /export const runOutputPaused = ref\(false\)/)
  assert.match(instances, /if \(runOutputPaused\.value\) return/)
  assert.match(instances, /export function runOutputPausedState\(\)/)
})
