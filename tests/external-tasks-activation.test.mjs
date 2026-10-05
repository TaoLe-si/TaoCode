// 任务激活状态（`src/externalProjectModel.ts`，上游 `TaskActivationState` +
// `ExternalSystemTaskActivator` 的 phase 语义）与对话框树模型（`src/externalTasksActivation.ts`，
// 上游 `ConfigureTasksActivationDialog`）。
// 覆盖：7 个阶段的 label/isSyncPhase、add/remove/move 的逐条语义（append 允许重复、remove 第一处、
// move 相邻交换越界原样）、getDescription 的阶段串、持久化存取与按工作区隔离、取消链接后的清理、
// 对话框树的折叠与搜索、tooltip 回退、失效条目提示。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RUN_CONFIGURATION_TASK_PREFIX, TASK_PHASES, TASK_PHASE_LABELS, addTaskActivation, emptyTaskActivationState,
  isRunConfigurationActivationTask, isSyncPhase, loadTasksActivation, moveTaskActivation, parseTaskActivationState,
  parseTasksActivationMap, removeTaskActivation, runConfigurationActivationTaskName, saveTasksActivation,
  taskActivationDescription, taskActivationEmpty, tasksActivationForLinkedBuilds, tasksActivationKey, tasksForPhase,
} from '../src/externalProjectModel.ts'
import {
  activationBuilds, activationCount, activationSummaryText, activationTaskOptions, activationTooltip,
  addActivation, missingActivationTasks, moveActivation, removeActivation,
} from '../src/externalTasksActivation.ts'

const memoryStore = () => {
  const data = new Map()
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)) },
    removeItem: key => { data.delete(key) },
    dump: () => [...data.keys()],
  }
}

test('Phase 表与上游一致：7 个阶段、两个同步阶段、运行配置前缀', () => {
  assert.deepEqual([...TASK_PHASES], ['beforeRun', 'beforeSync', 'afterSync', 'beforeCompile', 'afterCompile', 'beforeRebuild', 'afterRebuild'])
  assert.deepEqual(TASK_PHASES.map(phase => TASK_PHASE_LABELS[phase]), ['运行前', '同步前', '同步后', '编译前', '编译后', '重建前', '重建后'])
  assert.ok(isSyncPhase('beforeSync') && isSyncPhase('afterSync'))
  assert.ok(!isSyncPhase('afterCompile'))
  assert.equal(RUN_CONFIGURATION_TASK_PREFIX, 'run: ')
  assert.equal(runConfigurationActivationTaskName('测试'), 'run: 测试')
  assert.ok(isRunConfigurationActivationTask('run: 测试') && !isRunConfigurationActivationTask('build'))
})

test('add 直接 append（允许重复）、空名忽略；remove 只删第一处；move 相邻交换越界原样', () => {
  let state = emptyTaskActivationState()
  assert.ok(taskActivationEmpty(state))
  state = addTaskActivation(state, 'afterSync', 'build')
  state = addTaskActivation(state, 'afterSync', 'build')
  state = addTaskActivation(state, 'afterSync', '  ')
  state = addTaskActivation(state, 'beforeRun', 'clean')
  assert.deepEqual([...tasksForPhase(state, 'afterSync')], ['build', 'build'], '上游 List.add 允许重复条目')
  assert.ok(!taskActivationEmpty(state))
  state = removeTaskActivation(state, 'afterSync', 'build')
  assert.deepEqual([...tasksForPhase(state, 'afterSync')], ['build'])
  assert.equal(removeTaskActivation(state, 'afterSync', 'nope'), state, '没命中时原样返回')
  state = moveTaskActivation(state, 'afterSync', 'build', -1)
  assert.deepEqual([...tasksForPhase(state, 'afterSync')], ['build'], '单元素表移动越界原样')
  const list = addTaskActivation(addTaskActivation(emptyTaskActivationState(), 'afterSync', 'a'), 'afterSync', 'b')
  assert.deepEqual([...tasksForPhase(moveTaskActivation(list, 'afterSync', 'b', -1), 'afterSync')], ['b', 'a'])
  assert.equal(moveTaskActivation(list, 'afterSync', 'a', -1), list, '第一项上移越界')
})

test('getDescription：任务激活在哪些阶段（顿号连接），无激活返回 null', () => {
  let state = addTaskActivation(emptyTaskActivationState(), 'afterSync', 'build')
  state = addTaskActivation(state, 'beforeCompile', 'build')
  assert.equal(taskActivationDescription(state, 'build'), '同步后、编译前')
  assert.equal(taskActivationDescription(state, 'test'), null)
})

test('parse 容错：缺字段/坏类型按空清单，忽略空串', () => {
  const parsed = parseTaskActivationState({ afterSync: ['build', '', 42, 'test'], beforeRun: 'oops', unknown: ['x'] })
  assert.deepEqual([...tasksForPhase(parsed, 'afterSync')], ['build', 'test'])
  assert.deepEqual([...tasksForPhase(parsed, 'beforeRun')], [])
  assert.ok(taskActivationEmpty(parseTaskActivationState(null)))
  assert.ok(taskActivationEmpty(parseTaskActivationState('nope')))
})

test('激活状态按工作区根持久化；空表不落盘并清键', () => {
  const store = memoryStore()
  const map = addActivation({}, 'app', 'afterSync', 'build')
  assert.ok(saveTasksActivation(store, 'D:/work', map))
  assert.deepEqual(loadTasksActivation(store, 'D:/work'), { app: addTaskActivation(emptyTaskActivationState(), 'afterSync', 'build') })
  assert.deepEqual(loadTasksActivation(store, 'D:/other'), {}, '工作区之间隔离')
  assert.equal(loadTasksActivation(null, 'D:/work')['app'], undefined, '没有存储时退回空表')
  assert.ok(saveTasksActivation(store, 'D:/work', {}))
  assert.deepEqual(store.dump(), [], '空表不落盘并清掉旧键')
  assert.deepEqual(parseTasksActivationMap('{bad json'), {})
  assert.match(tasksActivationKey('D:\\work'), /tasksActivation\.D:\/work$/)
})

test('取消链接后丢掉该 build 的激活状态', () => {
  const map = addActivation(addActivation({}, 'app', 'afterSync', 'build'), 'lib', 'beforeRun', 'clean')
  const kept = tasksActivationForLinkedBuilds(map, ['app'])
  assert.deepEqual(Object.keys(kept), ['app'])
  assert.deepEqual(tasksActivationForLinkedBuilds(map, []), {})
})

test('对话框树：按阶段分组、可用任务排除已激活并排序、搜索过滤', () => {
  const builds = [
    { directory: '', label: '工作区根项目', tasks: ['build', 'test', 'clean'] },
    { directory: 'app', label: 'app', tasks: [] },
  ]
  let map = addActivation({}, '', 'afterSync', 'build')
  map = addActivation(map, '', 'beforeRun', 'clean')
  const [root, app] = activationBuilds(map, builds)
  assert.equal(root.count, 2)
  assert.deepEqual(root.phases.map(phase => phase.phase), [...TASK_PHASES])
  assert.deepEqual([...root.phases.find(phase => phase.phase === 'afterSync').tasks], ['build'])
  assert.deepEqual([...root.availableTasks], ['test'])
  assert.deepEqual(activationTaskOptions(root, 'TE'), ['test'])
  assert.deepEqual(activationTaskOptions(root, 'zzz'), [])
  assert.equal(app.count, 0)
  assert.equal(activationCount(map), 2)
  assert.deepEqual([...app.missingTasks], [], '空表没有失效条目')
  assert.match(activationSummaryText(map, builds), /2 个已链接工程 · 1 个配置了任务激活 · 共 2 个激活项/)
})

test('树模型点名失效条目：任务表里没有的激活项（运行配置除外）', () => {
  let map = addActivation({}, '', 'afterSync', 'renamed')
  map = addActivation(map, '', 'beforeRun', 'run: 单元测试')
  const [node] = activationBuilds(map, [{ directory: '', label: '根', tasks: ['build'] }])
  assert.deepEqual([...node.missingTasks], ['renamed'], '运行配置条目不算失效')
  const [fresh] = activationBuilds(map, [{ directory: '', label: '根', tasks: ['renamed'] }])
  assert.deepEqual([...fresh.missingTasks], [])
})

test('对话框命令：增删移返回新表，清空后目录键被移除', () => {
  const added = addActivation({}, 'app', 'afterSync', 'build')
  assert.deepEqual(Object.keys(added), ['app'])
  const moved = moveActivation(addActivation(added, 'app', 'afterSync', 'test'), 'app', 'afterSync', 'test', -1)
  assert.deepEqual([...moved.app.afterSync], ['test', 'build'])
  assert.equal(moveActivation(moved, 'app', 'afterSync', 'test', -1), moved, '越界不产生新表')
  const removed = removeActivation(added, 'app', 'afterSync', 'build')
  assert.deepEqual(removed, {})
})

test('tooltip 与失效条目：有激活给阶段串，同步后消失的任务被点名', () => {
  const map = addActivation({}, 'app', 'afterCompile', 'test')
  assert.equal(activationTooltip(map, 'app', 'test'), '编译后')
  assert.equal(activationTooltip(map, 'app', 'missing'), null)
  assert.equal(activationTooltip(map, 'lib', 'test'), null)
  const stale = moveActivation(addActivation(map, 'app', 'afterSync', 'renamed'), 'app', 'afterSync', 'renamed', 0)
  assert.deepEqual(missingActivationTasks(stale, 'app', ['test']), ['renamed'])
  assert.deepEqual(missingActivationTasks(stale, 'app', ['test', 'renamed']), [])
  assert.deepEqual(missingActivationTasks(stale, 'lib', []), [])
})
