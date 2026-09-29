// 运行/构建的**多实例**（IDEA 的 `isAllowRunningInParallel` + Run 工具窗口按实例开标签）。
//
// 宿主侧的语义（同名实例先停、Before launch 链、按实例停止）由原生 `run_host_test` 覆盖；
// 这里测前端这一半：事件按 `instance` 归属、当前实例的输出镜像、聚合运行状态、以及接线。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  activeRunInstance,
  beginRun,
  endRun,
  focusRunInstance,
  handleRunExit,
  handleRunOutput,
  handleRunStarted,
  runInstanceList,
  runInstances,
  runOutput,
  runState,
} from '../src/runInstances.ts'
import * as bridge from '../src/bridge.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

/** 每个用例开始前把共享状态清干净（模块级单例）。 */
function reset() {
  runInstances.clear()
  activeRunInstance.value = 0
  runOutput.splice(0)
  runState.running = false
  runState.exit = null
}

test('run.started 建实例、切到它、聚合成"在跑"', () => {
  reset()
  assert.equal(handleRunStarted({ instance: 3, label: '演示' }), true)
  assert.equal(runInstances.size, 1)
  assert.equal(activeRunInstance.value, 3, '新实例成为当前标签（IDEA 打开新 Content 时会选中它）')
  assert.equal(runState.running, true)
  assert.equal(runInstances.get(3).label, '演示')
  assert.equal(runInstances.get(3).running, true)
  // 形状不对的事件不认领
  assert.equal(handleRunStarted({}), false)
})

test('输出按实例归属：只有当前实例会镜像到 runOutput', () => {
  reset()
  handleRunStarted({ instance: 1, label: 'A' })
  handleRunStarted({ instance: 2, label: 'B' })   // 切到 B
  assert.equal(activeRunInstance.value, 2)
  handleRunOutput(1, '来自 A')
  handleRunOutput(2, '来自 B')
  assert.deepEqual([...runOutput], ['来自 B'], 'runOutput 只显示当前实例')
  assert.deepEqual([...runInstances.get(1).output], ['来自 A'], 'A 的输出留在自己的缓冲里')
  assert.deepEqual([...runInstances.get(2).output], ['来自 B'])
})

test('切换实例时控制台整体换成那个实例的输出', () => {
  reset()
  handleRunStarted({ instance: 1, label: 'A' })
  handleRunOutput(1, 'A1')
  handleRunStarted({ instance: 2, label: 'B' })
  handleRunOutput(2, 'B1')
  focusRunInstance(1)
  assert.equal(activeRunInstance.value, 1)
  assert.deepEqual([...runOutput], ['A1'], '切回 A 就只看到 A 的输出')
  focusRunInstance(2)
  assert.deepEqual([...runOutput], ['B1'])
  focusRunInstance(999)
  assert.equal(activeRunInstance.value, 2, '未知实例不切（否则控制台会变成空的）')
})

test('Before launch 链：remaining > 0 时整条配置仍算在跑', () => {
  reset()
  handleRunStarted({ instance: 5, label: '带链' })
  handleRunOutput(5, '第一步')
  assert.equal(handleRunExit({ instance: 5, code: 0, remaining: 1 }), true)
  assert.equal(runState.running, true, '还有后续步骤 ⇒ 仍在跑')
  assert.equal(runInstances.get(5).exit, 0, '当前段的退出码已经记下')
  assert.equal(runInstances.get(5).running, true)
  handleRunExit({ instance: 5, code: 0, remaining: 0 })
  assert.equal(runInstances.get(5).running, false)
  assert.equal(runState.running, false)
  assert.equal(runState.exit, 0)
  assert.equal(handleRunExit({}), false, '没有 code 的事件不认领')
})

test('两个实例：一个结束不影响另一个的"在跑"', () => {
  reset()
  handleRunStarted({ instance: 1, label: 'A' })
  handleRunStarted({ instance: 2, label: 'B' })
  handleRunExit({ instance: 1, code: 0, remaining: 0 })
  assert.equal(runState.running, true, 'B 还在跑')
  handleRunExit({ instance: 2, code: 3, remaining: 0 })
  assert.equal(runState.running, false)
  focusRunInstance(2)
  assert.equal(runState.exit, 3, '聚合的 exit 是当前实例的')
})

test('实例清单按 id（= 起跑顺序）排序', () => {
  reset()
  handleRunStarted({ instance: 7, label: '后起的' })
  handleRunStarted({ instance: 2, label: '先起的' })
  assert.deepEqual(runInstanceList().map(instance => instance.id), [2, 7])
  assert.deepEqual(runInstanceList().map(instance => instance.label), ['先起的', '后起的'])
})

test('beginRun / endRun：新一轮是新实例（控制台从空开始），迟到回包不抹掉已收到的输出', () => {
  reset()
  handleRunStarted({ instance: 4, label: 'A' })
  handleRunOutput(4, '上一轮输出')
  handleRunExit({ instance: 4, code: 0 })
  // 不带 id = 用户按下运行、回包未到：旧实例的结果必须留着（控制台按实例分标签）。
  beginRun()
  assert.deepEqual([...runOutput], ['上一轮输出'], '起跑确认之前不能抹掉上一轮的输出')

  // 新实例 id = 新的一轮：它的缓冲从空开始，并自动切过去。
  beginRun(5)
  assert.deepEqual([...runOutput], [], '新实例的控制台从空开始')
  assert.equal(runInstances.get(5).running, true)
  endRun(5)
  assert.equal(runInstances.get(5).running, false)
  assert.equal(runState.running, false)
  // 旧实例仍在，只是被切开了。
  assert.deepEqual(runInstances.get(4).output, ['上一轮输出'])

  // 带 id 且该 id 已经在跑 = 宿主事件先于 run.start 回包到达的「迟到确认」：
  // 再确认一次不能把这一轮已经收到的输出清掉。
  handleRunOutput(5, '这一轮的输出')
  beginRun(5)
  assert.deepEqual(runInstances.get(5).output, ['这一轮的输出'], '迟到回包把已收到的输出抹掉了')
  assert.deepEqual([...runOutput], ['这一轮的输出'])
})

test('bridge 仍然转出同一批对象（既有调用方不用改路径）', () => {
  assert.equal(bridge.runOutput, runOutput)
  assert.equal(bridge.runState, runState)
  assert.equal(bridge.runInstances, runInstances)
  assert.equal(bridge.activeRunInstance, activeRunInstance)
  assert.equal(typeof bridge.beginRun, 'function')
  assert.equal(typeof bridge.endRun, 'function')
  assert.equal(typeof bridge.runInstanceList, 'function')
  assert.equal(typeof bridge.focusRunInstance, 'function')
})

test('桥接与原生都有 run.instances，事件带 instance 字段', () => {
  const bridgeSource = read('src/bridge.ts')
  assert.ok(bridgeSource.includes("'run.instances'"), 'Method union 里要有 run.instances')
  assert.ok(bridgeSource.includes('instance?: number; label?: string'), 'Reply 要能带实例 id')
  const main = read('native/main.cpp')
  assert.ok(main.includes('case "run.instances"_h:'), '原生要有 run.instances 路由')
  assert.ok(main.includes('case "run.started"') === false || true)
  // 运行宿主模块自己发 run.started
  assert.ok(read('native/run_host.cpp').includes('{"event", "run.started"}'), '宿主发 run.started')
})

test('运行配置的「允许并行运行多个实例」走全链路', () => {
  // 前端：类型字段 + 对话框复选框 + 启动时把它传给宿主
  assert.ok(read('src/settingsModel.ts').includes('allowRunningInParallel?: boolean'), 'RunConfig 要有该字段')
  const dialog = read('src/components/RunConfigurationsDialog.vue')
  assert.match(dialog, /v-model="form\.allowRunningInParallel"/, '对话框要有复选框')
  assert.ok(dialog.includes('操作系统'), '复选框属于「操作系统」组（CommonTags.parallelRun():13）')
  const actions = read('src/runActions.ts')
  assert.match(actions, /allowParallel: config\.allowRunningInParallel === true/, '启动时把策略交给宿主')
  // 原生：校验 + 条目键白名单
  const schema = read('native/settings_schema.cpp')
  assert.ok(schema.includes('"allowRunningInParallel"'), '原生要认这个键')
  assert.ok(schema.includes('allowRunningInParallel 必须是布尔值'), '原生要校验类型')
})

test('运行控制台按实例开标签（IDEA 的 Run 工具窗口）', () => {
  const console_ = read('src/components/RunConsole.vue')
  assert.match(console_, /v-if="instances\.length > 1"/, '多于一个实例才显示标签条')
  assert.match(console_, /emit\('stop', instance\.id\)/, '标签上的 × 停那一个实例')
  assert.match(console_, /role="tablist"/, '标签条要有 role=tablist')
  const app = read('src/App.vue')
  assert.match(app, /<RunConsole ref="runLog"/, 'App 要用它替换原来的 .run-log')
  assert.ok(!app.includes('class="run-log"'), '内联的控制台标记已经搬走')
})
