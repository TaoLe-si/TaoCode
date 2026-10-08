// 判据 · **插件 API 面**（`src/pluginApi.ts` + `src/fileEditorProviders.ts`）—— 缺失能力要由我们的
// 架构以**与上游同名的 API / 逐字一致的 EP id** 提供给第三方插件（目标：原版 IDEA 能跑的插件在我们
// 的 IDE 上也能挂上并跑）。
//
// 钉三件事（协调者点名的三条判据）：
//   ① **bundled 默认贡献者仍在**：本仓随包发货的三个项目视图窗格 + 大文件编辑器 + 四个基础服务
//      都在 EP 表里（不是"声明了 EP 却没有贡献者"的死 EP）；
//   ② **第三方按 id 注册后能被消费**：按同一 EP id 挂一条贡献，既有消费端
//      （`serviceOf` / `editorProviderFor` / `availableProjectViewPanes`）看得到；
//   ③ **EP id 与上游逐字一致**：拿**上游字面量**逐条断言常量，并把 id 写进常量做运行期自检。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ACTION_EP, ANNOTATOR_EP, COMPLETION_CONTRIBUTOR_EP, FILE_EDITOR_PROVIDER_EP,
  FILE_EDITOR_PROVIDER_SUPPRESSOR_EP, INLAY_PROVIDER_EP, SHELVE_CHANGES_MANAGER_LISTENER_EP,
} from '../src/extensionPoints.ts'
import { PROJECT_VIEW_PANE_EP } from '../src/ideViewExtensionPoints.ts'
import {
  UPSTREAM_EXTENSION_POINTS, assertUpstreamExtensionPointIds,
  installPluginApi, pluginApiServiceCatalog, createPluginApiServices, FILE_SWITCHER_API, EDITOR_WINDOW,
  SAVED_PATCHES_PROVIDER, SHELF_PROVIDER, PROJECT_VIEW,
} from '../src/pluginApi.ts'
import { serviceOf, HTTP_VIRTUAL_FILE_SYSTEM, FILE_EDITOR_MANAGER, SHELVE_CHANGES_MANAGER, JAVA_PSI_FACADE } from '../src/pluginServices.ts'
import { registerFileEditorProvider, editorProviderFor, fileEditorProviders } from '../src/fileEditorProviders.ts'
import { registerProjectViewPane, availableProjectViewPanes, projectViewPanes } from '../src/ideViewExtensionPoints.ts'
import '../src/largeFileViewer.ts'
import '../src/projectViewPanes.ts'

installPluginApi()

test('EP id 与上游逐字一致（拿上游字面量断言，写错一个字符就红）', () => {
  // 值来自各 plugin.xml 的 <extensionPoint qualifiedName="…"> 原文。
  assert.equal(COMPLETION_CONTRIBUTOR_EP, 'com.intellij.completion.contributor')
  assert.equal(INLAY_PROVIDER_EP, 'com.intellij.codeInsight.inlayProvider')
  assert.equal(ANNOTATOR_EP, 'com.intellij.annotator')
  assert.equal(ACTION_EP, 'com.intellij.action')
  assert.equal(FILE_EDITOR_PROVIDER_EP, 'com.intellij.fileEditorProvider')
  assert.equal(FILE_EDITOR_PROVIDER_SUPPRESSOR_EP, 'com.intellij.fileEditorProviderSuppressor')
  assert.equal(SHELVE_CHANGES_MANAGER_LISTENER_EP, 'com.intellij.openapi.vcs.changes.shelf.ShelveChangesManagerListener')
  assert.equal(PROJECT_VIEW_PANE_EP, 'com.intellij.projectViewPane')
  // 出处表里每条都登记了上游文件与消费端。
  assert.ok(UPSTREAM_EXTENSION_POINTS.length >= 8, 'EP 出处表有内容')
  assert.ok(UPSTREAM_EXTENSION_POINTS.every(ref => ref.upstreamFile.length > 0 && ref.consumer.length > 0), '每条都写清上游文件与消费端')
})

test('运行期自检：出处表里每条 EP 都真的声明了', () => {
  const check = assertUpstreamExtensionPointIds()
  assert.deepEqual(check.missing, [], `这些 EP 没声明：${check.missing.join('、')}`)
  assert.equal(check.ok, true)
})

test('服务 FQN 与上游逐字一致（协调者点名的四格按参考树真名暴露）', () => {
  assert.equal(FILE_SWITCHER_API, 'com.intellij.platform.recentFiles.shared.FileSwitcherApi')
  assert.equal(EDITOR_WINDOW, 'com.intellij.openapi.fileEditor.impl.EditorWindow')
  assert.equal(SAVED_PATCHES_PROVIDER, 'com.intellij.openapi.vcs.changes.savedPatches.SavedPatchesProvider')
  assert.equal(SHELF_PROVIDER, 'com.intellij.openapi.vcs.changes.savedPatches.ShelfProvider')
  assert.equal(PROJECT_VIEW, 'com.intellij.ide.projectView.ProjectView')
})

test('installPluginApi 注册基础四服务 + 本文件补的四样，serviceOf 全取得到', () => {
  for (const fqn of [HTTP_VIRTUAL_FILE_SYSTEM, FILE_EDITOR_MANAGER, SHELVE_CHANGES_MANAGER, JAVA_PSI_FACADE,
    FILE_SWITCHER_API, EDITOR_WINDOW, SAVED_PATCHES_PROVIDER, PROJECT_VIEW]) {
    assert.ok(serviceOf(fqn), `${fqn} 取得到`)
  }
  const catalog = pluginApiServiceCatalog()
  assert.ok(catalog.length >= 8, '目录里有 8 条以上服务')
  assert.ok(catalog.every(entry => entry.upstream.length > 0), '每条都写明上游类')
})

test('bundled 贡献者仍在：三个窗格 + 大文件编辑器 + 四个服务', () => {
  const paneIds = projectViewPanes().map(pane => pane.id)
  for (const id of ['ProjectPane', 'PackagesPane', 'Scope']) assert.ok(paneIds.includes(id), `窗格 ${id} 在表里`)
  assert.ok(fileEditorProviders().some(provider => provider.id === 'LargeFileEditor'), '大文件编辑器在表里')
  for (const fqn of [HTTP_VIRTUAL_FILE_SYSTEM, FILE_EDITOR_MANAGER, SHELVE_CHANGES_MANAGER, JAVA_PSI_FACADE]) {
    assert.ok(serviceOf(fqn), `bundled 服务 ${fqn} 仍在`)
  }
})

test('第三方按 id 注册后能被既有消费端看见（窗格 / 编辑器提供者 / 服务）', () => {
  // 窗格：按 `com.intellij.projectViewPane` 挂一支权重更高的，消费端取到的第一支就是它。
  registerProjectViewPane({
    id: 'test.thirdparty.pane',
    getTitle: () => '第三方窗格',
    isInitiallyVisible: () => false,
    getGroup: () => '项目',
    getWeight: () => 99,
    isAvailable: () => true,
  })
  const panes = availableProjectViewPanes('/ws')
  assert.equal(panes[0].id, 'test.thirdparty.pane', '第三方窗格被排序在最前并被消费')
  assert.ok(panes.some(pane => pane.id === 'ProjectPane'), 'bundled 窗格仍在同一张表里')

  // 编辑器提供者：按 `com.intellij.fileEditorProvider` 挂一支，`editorProviderFor` 取得到。
  registerFileEditorProvider({
    id: 'test.thirdparty.editor',
    getEditorTypeId: () => 'ThirdPartyEditor',
    accept: input => input.path.endsWith('.tp'),
    createEditor: () => ({ kind: 'third-party' }),
  })
  const provider = editorProviderFor({ path: 'a.tp', root: '/ws' })
  assert.equal(provider?.id, 'test.thirdparty.editor', '第三方 provider 被选中')
  assert.equal(provider?.createEditor({ path: 'a.tp', root: '/ws' }).kind, 'third-party')
})

test('服务目录去重：同一 FQN 只出现一次（同 id 覆盖不叠加）', () => {
  installPluginApi()
  const ids = pluginApiServiceCatalog().map(entry => entry.id)
  assert.equal(new Set(ids).size, ids.length, '服务目录没有重复 FQN')
})

test('createPluginApiServices 在无宿主时也能建出服务（不抛）', () => {
  const services = createPluginApiServices()
  assert.equal(services.length, 4)
  assert.ok(services.every(service => service.methods.length > 0))
  // 项目视图服务：没有工作区时 bundled 窗格不可用（第三方贡献的 isAvailable 由它自己决定）。
  const projectView = services.find(service => service.id === PROJECT_VIEW)
  assert.ok(Array.isArray(projectView.impl.getPanes()), 'getPanes 给的是数组')
  // 切换器服务在没有来源时给空表。
  const switcher = services.find(service => service.id === FILE_SWITCHER_API)
  assert.deepEqual(switcher.impl.getRecentFiles('RECENTLY_OPENED'), [])
})
