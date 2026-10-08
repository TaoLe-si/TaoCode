// 判据 · 项目部件动作过滤扩展点（`src/projectWidgetActionsFilter.ts` + `src/projectWidget.ts` 的接线）——
// 上游 `com.intellij.projectWidgetActionsFilter` 的同名方法面。
//
// 钉四件事：
//   ① EP id 逐字等于上游 qualifiedName（`ProjectWidgetActionsFilter.kt` 的 `EP_NAME`），且已声明；
//   ② 贡献能按 id 注册 / 注销，查询函数看得见（第三方挂的不是死代码）；
//   ③ `shouldHideProjectSwitchingActions` 的「任一条答 true 就藏」语义；
//   ④ **真实消费侧**：`filterProjects`（项目部件那份最近项目行的唯一过滤点，`src/menuUi.ts` 调它）
//      真的会因一条贡献少一行；没有 provider 时行为与从前一字不差。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  PROJECT_WIDGET_ACTIONS_FILTER_EP, declareProjectWidgetActionsFilterExtensionPoint,
  projectWidgetActionsFilters, registerProjectWidgetActionsFilterExtension,
  shouldHideProjectSwitchingActions, unregisterProjectWidgetActionsFilterExtension,
} from '../src/projectWidgetActionsFilter.ts'
import { EXTENSIONS } from '../src/extensionPoints.ts'
import { filterProjects } from '../src/projectWidget.ts'

const root = new URL('../', import.meta.url)
const read = rel => readFileSync(new URL(rel, root), 'utf8')

const project = (name, path) => ({ name, path, available: true })

test('EP id 逐字取自上游 qualifiedName，且已声明', () => {
  assert.equal(PROJECT_WIDGET_ACTIONS_FILTER_EP, 'com.intellij.projectWidgetActionsFilter')
  assert.ok(EXTENSIONS.hasExtensionPoint(PROJECT_WIDGET_ACTIONS_FILTER_EP), 'EP 应已声明')
  // 声明幂等。
  declareProjectWidgetActionsFilterExtensionPoint()
  declareProjectWidgetActionsFilterExtensionPoint()
  assert.deepEqual(projectWidgetActionsFilters(), [], '没有贡献时 EP 上应是空的')
})

test('贡献可注册 / 注销，查询看得见；任一条答 true 就藏', () => {
  const handle = registerProjectWidgetActionsFilterExtension({
    id: 'test.hide-secret',
    shouldHideProjectSwitchingActions: event => event.projectName === 'Secret',
  })
  assert.equal(projectWidgetActionsFilters().length, 1)
  const secret = { projectPath: '/x/secret', projectName: 'Secret', currentRoot: '' }
  const open = { projectPath: '/x/open', projectName: 'Open', currentRoot: '' }
  assert.equal(shouldHideProjectSwitchingActions(secret), true)
  assert.equal(shouldHideProjectSwitchingActions(open), false)

  // 再来一条只对另一个项目答 true：两条都在时各自生效（任一条 true ⇒ true）。
  const second = registerProjectWidgetActionsFilterExtension({
    id: 'test.hide-archived',
    shouldHideProjectSwitchingActions: event => event.projectPath.includes('/archived/'),
  })
  const archived = { projectPath: '/x/archived/foo', projectName: 'Foo', currentRoot: '' }
  assert.equal(shouldHideProjectSwitchingActions(archived), true)
  assert.equal(shouldHideProjectSwitchingActions(secret), true)
  assert.equal(shouldHideProjectSwitchingActions(open), false)

  // 清掉第一条后，只有第二条的口径还在：Secret 不再被藏。
  assert.equal(handle.dispose !== undefined, true)
  assert.equal(unregisterProjectWidgetActionsFilterExtension('test.hide-secret'), true)
  assert.equal(shouldHideProjectSwitchingActions(secret), false)
  assert.equal(shouldHideProjectSwitchingActions(archived), true)

  assert.equal(unregisterProjectWidgetActionsFilterExtension('test.hide-archived'), true)
  assert.equal(second.dispose !== undefined, true)
  assert.deepEqual(projectWidgetActionsFilters(), [])
  assert.equal(shouldHideProjectSwitchingActions(secret), false, '全清掉后回到恒 false')
})

test('真实消费侧：一条贡献真的会让项目部件少一行（也没有 provider 时行为不变）', () => {
  const projects = [project('Alpha', '/w/alpha'), project('Beta', '/w/beta')]
  // 没有 provider：与速度搜索过滤以前的结果一字不差。
  assert.deepEqual(filterProjects(projects, '').map(item => item.name), ['Alpha', 'Beta'])
  assert.deepEqual(filterProjects(projects, 'alp').map(item => item.name), ['Alpha'])

  const handle = registerProjectWidgetActionsFilterExtension({
    id: 'test.hide-beta',
    shouldHideProjectSwitchingActions: event => event.projectName === 'Beta' && event.currentRoot === '/w/current',
  })
  // currentRoot 没传（缺省空串）时不命中 ⇒ 不藏。
  assert.deepEqual(filterProjects(projects, '').map(item => item.name), ['Alpha', 'Beta'])
  assert.deepEqual(filterProjects(projects, '', '/w/current').map(item => item.name), ['Alpha'])
  // 速度搜索与动作过滤是两道独立的闸：先按串搜、再按过滤器摘。
  assert.deepEqual(filterProjects(projects, 'bet', '/w/current').map(item => item.name), [])
  handle.dispose()
  assert.deepEqual(filterProjects(projects, '', '/w/current').map(item => item.name), ['Alpha', 'Beta'])
})

test('项目部件那条消费链真的把它接上了（menuUi 传当前项目根）', () => {
  const menu = read('src/menuUi.ts')
  assert.match(menu, /filterProjects\(recentProjects\.value, projectWidgetQuery\.value, workspace\.value\?\.root/,
    'menuUi 的项目部件分组应把当前项目根交给 filterProjects（否则过滤器拿不到 currentRoot）')
  const widget = read('src/projectWidget.ts')
  assert.match(widget, /shouldHideProjectSwitchingActions/, 'filterProjects 应真的问过滤器')
  assert.match(widget, /from '\.\/projectWidgetActionsFilter\.ts'/,
    '接线走模块 import（不许把 EP 查询抄进 projectWidget.ts）')
})
