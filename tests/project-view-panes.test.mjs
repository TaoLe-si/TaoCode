// 判据 · **项目视图多窗格**（`src/projectViewPanes.ts`，上游
// `com.intellij.ide.projectView.impl.AbstractProjectViewPane` + EP `com.intellij.projectViewPane`）——
// 桌面上项目工具窗口能切成"项目 / 包 / 范围"几档，切到哪一档有状态。
import test from 'node:test'
import assert from 'node:assert/strict'

import { PROJECT_VIEW_PANE_EP, availableProjectViewPanes, projectViewPanes } from '../src/ideViewExtensionPoints.ts'
import {
  BUNDLED_PROJECT_VIEW_PANES, PACKAGES_PANE_ID, PROJECT_PANE_ID, SCOPE_PANE_ID,
  createProjectViewPaneHost, initialProjectViewPaneId, paneChoiceOf, projectViewPaneCatalog,
  projectViewPaneChoices,
} from '../src/projectViewPanes.ts'

test('EP id 与上游逐字一致（`com.intellij.projectViewPane`）', () => {
  assert.equal(PROJECT_VIEW_PANE_EP, 'com.intellij.projectViewPane')
})

test('bundled 三支：id / weight 逐条对上游，注册进 EP 表', () => {
  const byId = new Map(BUNDLED_PROJECT_VIEW_PANES.map(pane => [pane.id, pane]))
  assert.deepEqual([...byId.keys()].sort(), ['PackagesPane', 'ProjectPane', 'Scope'])
  assert.equal(byId.get(PROJECT_PANE_ID).getWeight(), 0, '项目窗格权重 0（should be first）')
  assert.equal(byId.get(PACKAGES_PANE_ID).getWeight(), 1, '包窗格权重 1')
  assert.equal(byId.get(SCOPE_PANE_ID).getWeight(), 4, '范围窗格权重 4')
  assert.equal(byId.get(PROJECT_PANE_ID).isInitiallyVisible(), true, '项目窗格默认可见')
  assert.equal(byId.get(PACKAGES_PANE_ID).isInitiallyVisible(), false)

  const registered = projectViewPanes().map(pane => pane.id)
  for (const id of ['ProjectPane', 'PackagesPane', 'Scope']) assert.ok(registered.includes(id), `${id} 已注册`)
})

test('选择器行表按 weight 从大到小；空工作区没有可用窗格', () => {
  const choices = projectViewPaneChoices('/ws')
  assert.deepEqual(choices.map(choice => choice.id), ['Scope', 'PackagesPane', 'ProjectPane'], 'weight 降序')
  assert.deepEqual(projectViewPaneChoices(''), [], '没有工作区 ⇒ 没有可用窗格')
  assert.equal(paneChoiceOf(BUNDLED_PROJECT_VIEW_PANES[0]).title, '项目')
})

test('初始窗格 = isInitiallyVisible 那一支（项目）', () => {
  assert.equal(initialProjectViewPaneId('/ws'), PROJECT_PANE_ID)
  assert.equal(initialProjectViewPaneId(''), null)
})

test('宿主：初始选择、切换、环绕、持久化、恢复', () => {
  let persisted = null
  const host = createProjectViewPaneHost({
    root: () => '/ws',
    persist: id => { persisted = id },
  })
  assert.equal(host.activeId.value, PROJECT_PANE_ID, '初始选项目窗格')
  assert.equal(host.current.value.id, PROJECT_PANE_ID)

  host.select(PACKAGES_PANE_ID)
  assert.equal(host.activeId.value, PACKAGES_PANE_ID)
  assert.equal(persisted, PACKAGES_PANE_ID, '切换写进持久化')

  // 可用窗格顺序是 [Scope, PackagesPane, ProjectPane]（weight 降序）；从 Packages 正向一步到 ProjectPane。
  host.cycle(true)
  assert.equal(host.activeId.value, PROJECT_PANE_ID)
  host.cycle(false)
  assert.equal(host.activeId.value, PACKAGES_PANE_ID, '反向回到 Packages')

  // 非法 id 忽略。
  host.select('nope')
  assert.equal(host.activeId.value, PACKAGES_PANE_ID)

  // 恢复：load 给出上回的 Scope。
  const restored = createProjectViewPaneHost({ root: () => '/ws', load: () => SCOPE_PANE_ID })
  assert.equal(restored.activeId.value, SCOPE_PANE_ID, '跨会话恢复上次窗格')
  // load 给出不可用的 id ⇒ 回落到默认。
  const fallback = createProjectViewPaneHost({ root: () => '/ws', load: () => 'nope' })
  assert.equal(fallback.activeId.value, PROJECT_PANE_ID)
})

test('可用窗格随工作区变化（第三方按 id 挂的也会进消费端）', () => {
  assert.ok(availableProjectViewPanes('/ws').length >= 3)
  const catalog = projectViewPaneCatalog()
  assert.ok(catalog.every(choice => choice.id && choice.title && Number.isFinite(choice.weight)))
})
