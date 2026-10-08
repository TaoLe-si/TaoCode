// 判据 · **项目视图窗格注册表 + 窗格切换语义 + VFS 协议注册面**
// （`src/projectViewPaneRegistry.ts`；上游 `AbstractProjectViewPane` / `ProjectViewImpl.changeView` /
// `com.intellij.virtualFileSystem`）。纯 JS，无类型标注（`.mjs` 不带 --experimental-strip-types）。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BUILTIN_FILE_SYSTEMS, BUILTIN_PROJECT_VIEW_PANES, DEFAULT_PROJECT_VIEW_PANE_ID, FILE_PROTOCOL,
  JAR_PROTOCOL, JAR_SEPARATOR, PACKAGES_PANE_ID, PROJECT_PANE_ID, PROJECT_VIEW_PANE_EP,
  PROJECT_VIEW_STATE_KEYS, SCOPE_PANE_ID, URL_SCHEME_SEPARATOR, VIRTUAL_FILE_SYSTEM_EP, WELCOME_PANE_ID,
  changeView, classifyPath, composePaneId, constructUrl, decodeSelectedPane, defaultProjectViewPaneId,
  encodeSelectedPane, extractPath, extractProtocol, fileSystemCatalog, fileSystemForProtocol,
  indexPanesById, initiallyVisiblePanes, isPhysicalProtocol, resolveFileByUrl, resolvePaneSubId,
  sortPanesByOrder,
} from '../src/projectViewPaneRegistry.ts'

test('EP id 与协议 EP id 逐字对上游 qualifiedName', () => {
  // AbstractProjectViewPane.java:151-152 / intellij.platform.lang.impl.xml:314
  assert.equal(PROJECT_VIEW_PANE_EP, 'com.intellij.projectViewPane')
  // VirtualFileSystem.java:28 / CoreImpl.analyzer.xml:14
  assert.equal(VIRTUAL_FILE_SYSTEM_EP, 'com.intellij.virtualFileSystem')
})

test('内置四支窗格：id / order / 标题 / 图标 / 树形状 逐条对上游', () => {
  const byId = new Map(BUILTIN_PROJECT_VIEW_PANES.map(pane => [pane.id, pane]))
  assert.deepEqual([...byId.keys()], [PROJECT_PANE_ID, PACKAGES_PANE_ID, SCOPE_PANE_ID, WELCOME_PANE_ID], '注册序 = 各 plugin.xml 出现序')

  const project = byId.get(PROJECT_PANE_ID)
  assert.equal(project.order, 0, 'ProjectViewPane.java:123（should be first）')
  assert.equal(project.title, 'Project', 'IdeBundle.properties:497 title.project')
  assert.equal(project.icon, 'AllIcons.General.ProjectTab', 'ProjectViewPane.java:64')
  assert.equal(project.tree, 'directory', 'ProjectViewProjectNode（ProjectViewPane.java:134）')
  assert.equal(project.supportsFileNesting, true, 'ProjectViewPane.java:117')

  const packages = byId.get(PACKAGES_PANE_ID)
  assert.equal(packages.order, 1, 'PackageViewPane.java:188')
  assert.equal(packages.title, 'Packages', 'JavaBundle.properties:1337 title.packages')
  assert.equal(packages.tree, 'package', 'PackageViewProjectNode（PackageViewPane.java:163）')
  assert.equal(packages.supportsFileNesting, false, 'PackageViewPane 未覆写 ⇒ 默认 false（AbstractProjectViewPane.java:427-428）')

  const scope = byId.get(SCOPE_PANE_ID)
  assert.equal(scope.order, 4, 'ScopeViewPane.java:162')
  assert.equal(scope.title, 'Scopes', 'IdeBundle.properties:909 scope.view.title')
  assert.equal(scope.tree, 'scope')
  assert.equal(scope.hasSubIds, true, 'ScopeViewPane.java:397')
  assert.equal(scope.supportsFileNesting, true, 'ScopeViewPane.java:176')

  const welcome = byId.get(WELCOME_PANE_ID)
  assert.equal(welcome.order, -10, 'WelcomeScreenLeftPanel.kt:58')
  assert.equal(welcome.title, 'Projects and Files', 'NonModalWelcomeScreenBundle.properties:6')
  assert.equal(welcome.tree, 'directory-with-search', 'WelcomeScreenLeftPanel.kt:43-44')
})

test('现代描述子口径：Project 0 / Packages 1 / Scope 4 与 legacy weight 一致', () => {
  // ProjectPaneModel.kt:45 order()=0、PackageViewPaneModel.kt:56 order()=1、ScopePaneModel.kt:70 order()=4
  const orders = new Map(BUILTIN_PROJECT_VIEW_PANES.map(pane => [pane.id, pane.order]))
  assert.equal(orders.get(PROJECT_PANE_ID), 0)
  assert.equal(orders.get(PACKAGES_PANE_ID), 1)
  assert.equal(orders.get(SCOPE_PANE_ID), 4)
})

test('描述子上没有上游不存在的 getGroup / isAvailable / position（订正项）', () => {
  for (const pane of BUILTIN_PROJECT_VIEW_PANES) {
    assert.equal('group' in pane, false, `${pane.id} 不该有 group（AbstractProjectViewPane 无 getGroup）`)
    assert.equal('isAvailable' in pane, false, `${pane.id} 不该有 isAvailable（该 EP 无此方法）`)
    assert.equal('position' in pane, false, `${pane.id} 不该有 position（EP 属性只有 id/implementationClass/area/dynamic）`)
  }
})

test('sortPanesByOrder：升序且同 order 保持注册序（稳定）', () => {
  const sorted = sortPanesByOrder(BUILTIN_PROJECT_VIEW_PANES)
  assert.deepEqual(sorted.map(pane => pane.order), [-10, 0, 1, 4])
  const tied = sortPanesByOrder([
    { ...BUILTIN_PROJECT_VIEW_PANES[0], id: 'a', order: 1 },
    { ...BUILTIN_PROJECT_VIEW_PANES[0], id: 'b', order: 1 },
  ])
  assert.deepEqual(tied.map(pane => pane.id), ['a', 'b'], '同 order 保持原序（ProjectViewPaneService.kt:111）')
})

test('indexPanesById：重复 id 先到先得（ProjectViewImpl.java:1317-1320）', () => {
  const first = { ...BUILTIN_PROJECT_VIEW_PANES[0], title: 'first' }
  const second = { ...BUILTIN_PROJECT_VIEW_PANES[0], title: 'second' }
  const map = indexPanesById([first, second])
  assert.equal(map.size, 1)
  assert.equal(map.get(PROJECT_PANE_ID).title, 'first')
})

test('getDefaultViewId：按注册序扫 isDefaultPane，兜底 ProjectPane', () => {
  // ProjectViewImpl.java:1683-1690（按 EP 顺序，不是 weight 序）+ :1689 兜底 ProjectViewPane.ID
  assert.equal(defaultProjectViewPaneId(BUILTIN_PROJECT_VIEW_PANES, {}), DEFAULT_PROJECT_VIEW_PANE_ID)
  assert.equal(DEFAULT_PROJECT_VIEW_PANE_ID, PROJECT_PANE_ID)
  // 欢迎体验工程里欢迎页 isDefaultPane 为真（WelcomeScreenLeftPanel.kt:54-56）⇒ 它成为默认，尽管 order=-10。
  assert.equal(
    defaultProjectViewPaneId(BUILTIN_PROJECT_VIEW_PANES, { welcomeExperience: true }),
    WELCOME_PANE_ID,
    '注册序里它最后，但只有它 isDefaultPane ⇒ 命中它',
  )
})

test('isInitiallyVisible：只有欢迎页是条件真（AbstractProjectViewPane.java:249-250）', () => {
  const off = initiallyVisiblePanes(BUILTIN_PROJECT_VIEW_PANES, {})
  assert.deepEqual(off.map(pane => pane.id), [PROJECT_PANE_ID, PACKAGES_PANE_ID, SCOPE_PANE_ID])
  const on = initiallyVisiblePanes(BUILTIN_PROJECT_VIEW_PANES, { welcomeExperience: true, nonModalWelcomeScreen: true })
  assert.ok(on.some(pane => pane.id === WELCOME_PANE_ID), 'WelcomeScreenLeftPanel.kt:52 两个条件都真才可见')
  const half = initiallyVisiblePanes(BUILTIN_PROJECT_VIEW_PANES, { welcomeExperience: true })
  assert.equal(half.some(pane => pane.id === WELCOME_PANE_ID), false, '缺 nonModalWelcomeScreen 不算可见')
})

test('resolvePaneSubId：有子视图未给 subId ⇒ 沿用当前（ProjectViewImpl.java:1590-1600）', () => {
  const scope = BUILTIN_PROJECT_VIEW_PANES.find(pane => pane.id === SCOPE_PANE_ID)
  const project = BUILTIN_PROJECT_VIEW_PANES.find(pane => pane.id === PROJECT_PANE_ID)
  assert.deepEqual(resolvePaneSubId(scope, { viewId: SCOPE_PANE_ID }, 'All Changed Files'), { subId: 'All Changed Files', invalid: false })
  assert.deepEqual(resolvePaneSubId(scope, { viewId: SCOPE_PANE_ID, subId: 'Project Files' }, 'All Changed Files'), { subId: 'Project Files', invalid: false })
  // 无子视图却给 subId ⇒ 上游 LOG.error（:1598-1600）
  assert.deepEqual(resolvePaneSubId(project, { viewId: PROJECT_PANE_ID, subId: 'x' }, null), { subId: null, invalid: true })
  assert.deepEqual(resolvePaneSubId(project, { viewId: PROJECT_PANE_ID }, 'stale'), { subId: null, invalid: false }, '无子视图时 subId 恒 null')
})

test('changeView：四档结果（changed / rejected / unknown-pane / unknown-subview）', () => {
  const start = { viewId: PROJECT_PANE_ID, subId: null }
  // 与当前相同 ⇒ REJECTED（ProjectViewImpl.java:1602-1604）
  assert.deepEqual(changeView(start, { viewId: PROJECT_PANE_ID }), { outcome: 'rejected', state: start })
  // 未知 pane ⇒ 不动（:1587-1588）
  assert.deepEqual(changeView(start, { viewId: 'nope' }), { outcome: 'unknown-pane', state: start })
  // 无子视图给 subId ⇒ 不动（:1598-1600）
  assert.deepEqual(changeView(start, { viewId: PACKAGES_PANE_ID, subId: 'x' }), { outcome: 'unknown-subview', state: start })
  // 正常切到 Packages
  assert.deepEqual(changeView(start, { viewId: PACKAGES_PANE_ID }), { outcome: 'changed', state: { viewId: PACKAGES_PANE_ID, subId: null } })
  // 切到 Scope 并带 subId
  assert.deepEqual(
    changeView(start, { viewId: SCOPE_PANE_ID, subId: 'Project Files' }),
    { outcome: 'changed', state: { viewId: SCOPE_PANE_ID, subId: 'Project Files' } },
  )
  // 已在 Scope:Project Files，再请求 Scope 不给 subId ⇒ 沿用 ⇒ rejected
  const inScope = { viewId: SCOPE_PANE_ID, subId: 'Project Files' }
  assert.deepEqual(changeView(inScope, { viewId: SCOPE_PANE_ID }), { outcome: 'rejected', state: inScope })
})

test('composePaneId：有 subId 才拼 <id>:<subId>（LegacyBackendProjectViewPaneModel.kt:170）', () => {
  assert.equal(composePaneId(PROJECT_PANE_ID), PROJECT_PANE_ID)
  assert.equal(composePaneId(SCOPE_PANE_ID, 'Project Files'), 'Scope:Project Files')
  assert.equal(composePaneId(SCOPE_PANE_ID, null), SCOPE_PANE_ID)
})

test('选中窗格的持久化编解码（ProjectViewImpl.java:1721-1732 / :1656-1666）', () => {
  assert.equal(PROJECT_VIEW_STATE_KEYS.currentView, 'currentView')
  assert.equal(PROJECT_VIEW_STATE_KEYS.currentSubView, 'currentSubView')
  assert.equal(PROJECT_VIEW_STATE_KEYS.selectedPaneId, 'selectedPaneId')
  assert.equal(PROJECT_VIEW_STATE_KEYS.stateName, 'ProjectView')

  assert.equal(encodeSelectedPane({ viewId: null, subId: null }), null, '没有当前窗格就不写 navigator（:1726）')
  assert.deepEqual(encodeSelectedPane({ viewId: PROJECT_PANE_ID, subId: null }), { currentView: PROJECT_PANE_ID })
  assert.deepEqual(
    encodeSelectedPane({ viewId: SCOPE_PANE_ID, subId: 'Project Files' }),
    { currentView: SCOPE_PANE_ID, currentSubView: 'Project Files' },
  )
  assert.deepEqual(decodeSelectedPane({ currentView: SCOPE_PANE_ID, currentSubView: 'Project Files' }), { viewId: SCOPE_PANE_ID, subId: 'Project Files' })
  assert.deepEqual(decodeSelectedPane({ currentSubView: 'orphan' }), { viewId: null, subId: null }, '无 currentView ⇒ 两个都 null（:1660-1663）')
  // 往返
  const round = decodeSelectedPane(encodeSelectedPane({ viewId: PACKAGES_PANE_ID, subId: null }) ?? {})
  assert.deepEqual(round, { viewId: PACKAGES_PANE_ID, subId: null })
})

test('VFS 协议常量与 URL 互转逐条对上游', () => {
  assert.equal(URL_SCHEME_SEPARATOR, '://', 'URLUtil.java:33')
  assert.equal(JAR_SEPARATOR, '!/', 'URLUtil.java:39')
  assert.equal(FILE_PROTOCOL, 'file', 'URLUtil.java:34')
  assert.equal(JAR_PROTOCOL, 'jar', 'URLUtil.java:37')
  // VirtualFileManager.java:227-229 / :238-242 / :247-249
  assert.equal(constructUrl('file', '/a/b.txt'), 'file:///a/b.txt')
  assert.equal(extractProtocol('jar:///x.jar!/a'), 'jar')
  assert.equal(extractProtocol('/a/b.txt'), null, '没有 :// ⇒ null')
  assert.equal(extractPath('jar:///x.jar!/a'), '/x.jar!/a')
  assert.equal(extractPath('/a/b.txt'), '/a/b.txt', '没有 :// 原样返回（URLUtil.java:340-342）')
})

test('协议注册表：file/jar/temp/http/https 在内，physical 标注正确', () => {
  const protocols = BUILTIN_FILE_SYSTEMS.map(entry => entry.protocol)
  for (const wanted of ['file', 'jar', 'temp', 'http', 'https']) assert.ok(protocols.includes(wanted), `${wanted} 已注册`)
  // platform-impl/resources/intellij.platform.ide.impl.xml:685-687
  assert.equal(isPhysicalProtocol('file'), true)
  assert.equal(isPhysicalProtocol('jar'), true)
  assert.equal(isPhysicalProtocol('temp'), true)
  assert.equal(isPhysicalProtocol('http'), false, 'intellij.platform.ide.impl.xml:1208 无 physical ⇒ false')
  assert.equal(isPhysicalProtocol('https'), false)
  assert.equal(fileSystemForProtocol('jar').implementationClass, 'com.intellij.openapi.vfs.impl.jar.JarFileSystemImpl')
  assert.equal(fileSystemForProtocol('nope'), null)
  assert.equal(fileSystemCatalog().length, BUILTIN_FILE_SYSTEMS.length)
})

test('resolveFileByUrl：裸路径给 null（VirtualFileManagerImpl.java:408-410）', () => {
  const hit = resolveFileByUrl('jar:///x/y.jar!/a/B.class')
  assert.equal(hit.protocol, 'jar')
  assert.equal(hit.path, '/x/y.jar!/a/B.class')
  assert.equal(hit.fileSystem.physical, true)
  assert.equal(resolveFileByUrl('/plain/path.txt'), null, '无 :// ⇒ 上游直接 null')
  assert.equal(resolveFileByUrl('unknown://x'), null, '协议未注册 ⇒ null')
})

test('classifyPath：显式协议 / 归档 / 裸路径=file / 合成=null', () => {
  const explicit = classifyPath('jar:///x/y.jar!/a/B.class')
  assert.equal(explicit.protocol, 'jar')
  assert.equal(explicit.inArchive, true)
  assert.equal(explicit.archive, '/x/y.jar')
  assert.equal(explicit.entry, 'a/B.class')

  const bareJar = classifyPath('lib/x.jar!/a/B.class')
  assert.equal(bareJar.protocol, 'jar', '含 !/ ⇒ 归档（ArchiveFileSystem.java:39）')
  assert.equal(bareJar.archive, 'lib/x.jar')
  assert.equal(bareJar.entry, 'a/B.class')

  const plain = classifyPath('src/main.ts')
  assert.equal(plain.protocol, 'file', '裸路径推断为本地（LocalFileSystem.java:29）')
  assert.equal(plain.physical, true)
  assert.equal(plain.inArchive, false)

  assert.equal(classifyPath('').protocol, null, '空串判不出')
  assert.equal(classifyPath('\u0000libraries').protocol, null, '合成根（projectTreeModel.ts:217）判不出')
})