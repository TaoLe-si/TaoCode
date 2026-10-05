// 外部系统节点动作矩阵（`src/externalSystemActions.ts`）与视图开关（`src/externalSystemViewOptions.ts`）：
// 触发/勾选态/禁用原因逐行核对，视图开关的过滤与折平语义。
import test from 'node:test'
import assert from 'node:assert/strict'
import { externalSystemNodeActions, externalSystemViewGearRows } from '../src/externalSystemActions.ts'
import { emptyTaskActivationState, addTaskActivation } from '../src/externalProjectModel.ts'
import { gradleSyncTasks, tasksForGrouping, visibleExternalProjects } from '../src/externalSystemViewOptions.ts'

const base = { directory: 'app', ready: true, busy: false, activationMap: {} }

test('任务节点：运行/创建配置总在，激活 7 行带勾选态', () => {
  const activationMap = { app: addTaskActivation(emptyTaskActivationState(), 'afterSync', ':app:build') }
  const rows = externalSystemNodeActions({ ...base, kind: 'task', taskName: ':app:build', activationMap })
  const ids = rows.map(row => row.id)
  assert.deepEqual(ids.slice(0, 2), ['RunExternalSystemTaskAction', 'AssignRunConfigurationShortcutAction'])
  const toggles = rows.filter(row => row.id.startsWith('ToggleTaskActivationAction.'))
  assert.equal(toggles.length, 7)
  assert.equal(toggles.find(row => row.id.endsWith('afterSync')).checked, true)
  assert.equal(toggles.find(row => row.id.endsWith('beforeSync')).checked, false)
  assert.ok(rows.some(row => row.id === 'TaskActivationDescription' && row.title.includes('同步后')))
})

test('任务节点：忙时运行禁用并给出原因；未就绪时全部给桌面端原因', () => {
  const busy = externalSystemNodeActions({ ...base, kind: 'task', taskName: 'build', busy: true })
  assert.equal(busy[0].enabled, false)
  assert.match(busy[0].disabledReason, /同步或依赖任务/)
  const offline = externalSystemNodeActions({ ...base, kind: 'task', taskName: 'build', ready: false })
  assert.equal(offline[0].enabled, false)
  assert.match(offline.every(row => !row.enabled) ? offline[0].disabledReason : '', /桌面端/)
})

test('工程节点：同步/刷新/打开脚本/忽略/设置/激活管理器/取消链接', () => {
  const rows = externalSystemNodeActions({ ...base, kind: 'project', linked: true })
  const ids = rows.map(row => row.id)
  assert.deepEqual(ids, [
    'RefreshExternalProjectAction', 'RefreshAllExternalProjectsAction', 'OpenExternalConfigAction',
    'IgnoreExternalProjectAction', 'ShowExternalSystemSettingsAction', 'OpenTasksActivationManagerAction',
    'DetachExternalProjectAction',
  ])
  assert.equal(rows.find(row => row.id === 'DetachExternalProjectAction').enabled, true)
  const busy = externalSystemNodeActions({ ...base, kind: 'project', busy: true })
  assert.equal(busy.find(row => row.id === 'RefreshExternalProjectAction').enabled, false)
  assert.equal(busy.find(row => row.id === 'DetachExternalProjectAction').enabled, false)
})

test('运行配置节点：编辑被冻结挡住要有原因；激活项用 run: 前缀', () => {
  const activationMap = { app: addTaskActivation(emptyTaskActivationState(), 'beforeRun', 'run: 我的构建') }
  const rows = externalSystemNodeActions({ ...base, kind: 'runConfiguration', configurationName: '我的构建', activationMap })
  const edit = rows.find(row => row.id === 'EditExternalSystemRunConfigurationAction')
  assert.equal(edit.enabled, false)
  assert.match(edit.disabledReason, /App\.vue/)
  assert.equal(rows.find(row => row.id.endsWith('beforeRun')).checked, true)
})

test('齿轮开关：三条视图选项，勾选态缺省为分组开/继承开/忽略关', () => {
  const rows = externalSystemViewGearRows(false)
  assert.deepEqual(rows.map(row => row.id), ['GroupTasksAction', 'ShowInheritedTasksAction', 'ShowIgnoredAction'])
  assert.equal(rows[0].checked, true)
  assert.equal(rows[1].checked, false)
  assert.equal(rows[2].checked, false)
})

test('同步任务串按「显示继承任务」取（--all 开/关）', () => {
  assert.equal(gradleSyncTasks(true), 'projects tasks --all')
  assert.equal(gradleSyncTasks(false), 'projects tasks')
})

test('已忽略工程默认收起，显示开关打开时全部保留', () => {
  const projects = [{ directory: '' }, { directory: 'app' }]
  assert.deepEqual(visibleExternalProjects(projects, false, ['app']).map(project => project.directory), [''])
  assert.deepEqual(visibleExternalProjects(projects, true, ['app']).map(project => project.directory), ['', 'app'])
  assert.deepEqual(visibleExternalProjects(projects, false, []).map(project => project.directory), ['', 'app'])
})

test('任务分组折平：关掉分组时合成一张平表且顺序不变', () => {
  const groups = [{ group: 'build', tasks: ['a', 'b'] }, { group: 'other', tasks: ['c'] }]
  assert.deepEqual(tasksForGrouping(groups, true), groups)
  assert.deepEqual(tasksForGrouping(groups, false), [{ group: '', tasks: ['a', 'b', 'c'] }])
})
