// lane pv-views（2026-10-08）：projectviews 域 9 个族的判词 ↔ 盘上事实一致性判据。
//
// 本轮对 9 条族判词逐句复核（结论写进 `scripts/verdict_table.py` 各族的
// 「2026-10-08 lane pv-views 复核」段），这里把复核结论里**可机械核实**的那几件钉住：
//   · 判词声明「已落地」的落点（继承成员、窗格贡献点消费、内容根模型渲染、通知组 EP、
//     本地历史入口、TODO 编辑器注解模块…）被摘掉 ⇒ 这里必须红；
//   · 判词声明「仍缺」里带可核实的常量/限制（会话上限 32、登记点条数）同样被钉住，
//     免得缺口被静默补上后判词继续写着「缺」。
// 判据只读源码与模块导出，不渲染、不起宿主。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('pv/structure-view：继承成员（SHOW_INHERITED）与 W-4 面板挂载点都在', async () => {
  const inherited = await import('../src/outlineInheritedMembers.ts')
  assert.equal(inherited.INHERITED_PROVIDER_ID, 'SHOW_INHERITED')
  assert.equal(typeof inherited.mergeInheritedMembers, 'function')
  assert.equal(typeof inherited.inheritedMembersDefaultOn, 'function')
  const supertypes = await import('../src/outlineSupertypes.ts')
  assert.equal(typeof supertypes.fetchSuperTypeMembers, 'function')
  const panel = source('src/components/OutlinePanel.vue')
  assert.match(panel, /from '\.\.\/outlineInheritedMembers\.ts'/)
  assert.match(panel, /from '\.\.\/outlineSupertypes\.ts'/)
  assert.match(panel, /from '\.\.\/outlineExtensions\.ts'/)
})

test('pv/structure-view：父类型成员的 own 去重真的在跑（上游 :37 removeAll(ownChildren)）', async () => {
  const { mergeInheritedMembers } = await import('../src/outlineInheritedMembers.ts')
  const member = name => ({ name, kind: 6, path: 'A.java', startLine: 1, startChar: 0, endLine: 1, endChar: 4 })
  const merged = mergeInheritedMembers({
    own: [member('run')],
    superTypes: [{ name: 'Base', members: [member('run'), member('stop')] }],
  })
  assert.deepEqual(merged.inherited.map(item => item.name), ['stop'])
  assert.equal(merged.all.length, 2)
})

test('pv/project-view：窗格贡献点被真实消费，内容是根模型（ContentEntry）有渲染挂载点', async () => {
  const eps = await import('../src/ideViewExtensionPoints.ts')
  assert.equal(eps.PROJECT_VIEW_PANE_EP, 'com.intellij.projectViewPane')
  const panes = await import('../src/projectViewPanes.ts')
  assert.ok(panes.projectViewPaneCatalog().length >= 3, '三支 bundled 窗格（Project/Packages/Scope）')
  assert.match(source('src/components/ToolWindowView.vue'), /createProjectViewPaneHost/)
  const roots = await import('../src/rootsModel.ts')
  assert.equal(typeof roots.buildRootModel, 'function')
  assert.equal(typeof roots.rootModelRows, 'function')
  assert.match(source('src/components/ProjectStructurePane.vue'), /from '\.\.\/rootsModel'/)
})

test('pv/project-view-nodes：包视图三档的真实选项表与外部库合成行', async () => {
  const view = await import('../src/packageDepsView.ts')
  assert.deepEqual(view.PACKAGE_VIEW_OPTIONS.map(option => option.id),
    ['flattenPackages', 'hideEmptyMiddlePackages', 'abbreviatePackageNames'])
  assert.deepEqual(view.DEFAULT_PACKAGE_VIEW_SETTINGS,
    { flattenPackages: false, hideEmptyMiddlePackages: false, abbreviatePackageNames: false })
  const libraries = await import('../src/externalLibraries.ts')
  assert.equal(typeof libraries.externalLibraryEntries, 'function')
  assert.equal(typeof libraries.isSyntheticLibraryRow, 'function')
  // 缺口的另一半（挂载点）按判词如实记着：组件里目前没有消费方。
  assert.match(source('src/components/ProjectViewSortSettings.vue'), /FlattenPackages/)
})

test('pv/todo：编辑器内 TODO 高亮的注解模块（待接线的落盘件）行为正确', async () => {
  const annotator = await import('../src/todoAnnotator.ts')
  assert.equal(annotator.TODO_ANNOTATOR_ID, 'todoHighlightVisitor')
  assert.equal(annotator.TODO_ANNOTATOR_SEVERITY, 'information')
  const regions = annotator.todoHighlightRegions({ text: 'let x = 1\n// TODO: 接线\n' })
  assert.equal(regions.length, 1)
  assert.equal(regions[0].text, 'TODO')
  const annotations = annotator.todoAnnotator.annotate({ path: 'a.ts', text: '// TODO: 接线', dirtyLines: null, batchMode: false })
  assert.equal(annotations.length, 1)
  assert.equal(annotations[0].kind, 'todo')
  assert.equal(annotations[0].severity, 'information')
  // `kind: 'todo'` 这一档在注册表的严重度/外观表里已存在（接线只差 register 一行）。
  assert.match(source('src/annotatorRegistry.ts'), /\| 'todo'/)
})

test('pv/history：三条仍缺在盘上可复现（32 段上限 / 标签不随历史清空 / 重命名回滚限制）', async () => {
  const sessions = await import('../src/historySessions.ts')
  assert.equal(sessions.HISTORY_SESSION_PATH_LIMIT, 32)
  assert.match(source('src/historyLabels.ts'), /清空本地历史不会清标签/)
  assert.match(source('src/historyFollow.ts'), /回滚禁用/)
  assert.match(source('src/menus/localHistory.ts'), /vcs\.localHistory\.show/)
})

test('pv/command：UndoProvider EP 的方法面订正为 commandStarted/commandFinished，登记点仍只有两条', async () => {
  const eps = await import('../src/ideViewExtensionPoints.ts')
  assert.equal(eps.UNDO_PROVIDER_EP, 'com.intellij.undoProvider')
  const registry = source('src/ideViewExtensionPoints.ts')
  assert.match(registry, /commandStarted\?: \(root: string\) => void/)
  assert.match(registry, /commandFinished\?: \(root: string\) => void/)
  // 旧的六个 undo/redo/… 名字只作为「非上游口径的兼容面」保留，判词的订正就写在这条上。
  assert.match(registry, /非上游口径的兼容面/)
  const explorer = source('src/explorerActions.ts')
  assert.equal((explorer.match(/recordFileCommand\(/g) ?? []).length, 2, '全仓登记点 = 粘贴副本 + 移动')
})

test('pv/notification：通知组 EP 与内建组表在盘上（逐组设置页仍缺）', async () => {
  const eps = await import('../src/ideViewExtensionPoints.ts')
  assert.equal(eps.NOTIFICATION_GROUP_EP, 'com.intellij.notificationGroup')
  const groups = await import('../src/notificationGroups.ts')
  assert.ok(groups.NOTIFICATION_GROUPS.length >= 5)
  for (const type of ['BALLOON', 'STICKY_BALLOON', 'TOOL_WINDOW', 'NONE'])
    assert.ok(groups.NOTIFICATION_GROUPS.some(group => group.displayType === type), `内建组表应有 ${type} 档`)
})

test('pv/welcome：欢迎页两个真实落点模块仍在，且导航里没有 Learn/远程那些要 Gateway 的页签', async () => {
  const color = await import('../src/welcomeProjectColor.ts')
  assert.equal(color.PROJECT_COLOR_CHOICES.length, 9)
  const page = source('src/components/WelcomePage.vue')
  assert.match(page, /from '\.\.\/welcomeProjects'/)
  assert.match(page, /from '\.\.\/welcomeProjectColor'/)
})

test('pv/bookmarks-alias：B5 的落点文件与判决书仍在', () => {
  for (const path of ['src/bookmarks.ts', 'src/bookmarkActions.ts', 'src/bookmarkLists.ts',
                      'src/components/BookmarksPanel.vue', 'docs/inventory/verdict-bookmarks.md'])
    assert.ok(source(path).length > 500, `${path} 应有内容`)
})
