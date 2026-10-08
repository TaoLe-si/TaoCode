// 判据 · **组件侧 EP 挂载接线**（2026-10-07 epmount lane；epmount2 lane 扩充）。
//
// 覆盖：把 `src/ideViewExtensionPoints.ts` 的第二批 EP 消费点接进组件后，
//   · 组件里真的出现那条消费路径（源码锚点，防止接线被下一次重构悄悄摘掉）；
//   · 新加的纯消费模块（`src/outlineExtensions.ts` / `src/todoExtraPlaces.ts` /
//     `src/todoIndexerEntries.ts` / `src/undoProviderHost.ts` / `src/fileIconNames.ts`）行为正确；
//   · `buildUsageTree` 的 `rules` 选项真的会加分组层。
//
// epmount2 增补：对 13 条 EP 逐条断言三件事 ——
//   ① bundled 贡献者仍在（`EXTENSIONS.allEntries(id)` 里有它，或如实记下"本仓没有 bundled 那支"）；
//   ② 第三方按 id 注册后被**真实消费点**拿到（不是只有判据在调）；
//   ③ EP id 与上游 `qualifiedName` 逐字一致。
//
// 每个 test 只跑本进程（`node --test` 每文件一进程），所以这里登记的 EP 贡献不会污染别的文件。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EXTENSIONS } from '../src/extensionPoints.ts'

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')


// ── 1. treeStructureProvider（`src/projectTreeModel.ts` 跑 EP，FileTree 认它产出的合成容器） ──

test('item1 treeStructureProvider：建树前过 EP，设置如实透传，provider 的合成容器被认出来', () => {
  const model = source('src/projectTreeModel.ts')
  assert.match(model, /modifyProjectTreeChildren\(null, entries\.map\(toProviderNode\)/)
  assert.match(model, /settings\?\.flattenPackages/, 'ViewSettings 的口径要透给 provider')
  assert.match(model, /settings\?\.showMembers/)
  assert.match(model, /providerSynthetics/, 'provider 新加的合成节点要有落点')
  assert.match(model, /syntheticSourceOf/, '行与取子列表都要认这一档')
})

test('item1b treeStructureProvider：第三方按 id 注册后被 projectTreeModel 那条真实链路拿到', async () => {
  const ext = await import('../src/ideViewExtensionPoints.ts')
  const model = await import('../src/projectTreeModel.ts')
  assert.equal(ext.TREE_STRUCTURE_PROVIDER_EP, 'com.intellij.treeStructureProvider')
  // 本仓**没有** bundled 的 treeStructureProvider（上游是 `NestingTreeStructureProvider` 等；
  // 本仓的等价算法在 `src/projectTreeNesting.ts`，不作为 EP 贡献登记）—— 如实断言"没有"。
  assert.deepEqual(EXTENSIONS.allEntries(ext.TREE_STRUCTURE_PROVIDER_EP), [])

  // 真实消费点：建树的 `nest()` 里跑 `modifyProjectTreeChildren`（projectTreeModel.ts:89）。
  const host = model.createProjectTreeModel({
    entries: () => [{ path: 'a.ts', name: 'a.ts', kind: 'file' }, { path: 'b.ts', name: 'b.ts', kind: 'file' }],
    synthetic: () => [],
    depth: () => 0,
    sortSettings: () => ({}),
    error: () => {},
  })
  const handle = ext.registerTreeStructureProvider({
    id: 'test.thirdTree', modify: ({ children }) => children.filter(node => node.name !== 'b.ts'),
  })
  try {
    await host.refresh()
    assert.deepEqual(host.rows.value.map(row => row.entry.name), ['a.ts'], '第三方 provider 的过滤真的生效')
  } finally { handle.dispose() }
})

// ── 2/3. projectViewNodeDecorator + fileIconProvider（FileTree.vue 行渲染 / 图标位） ──

test('item2 projectViewNodeDecorator：FileTree 走组装点 nodeDecorationFor（不只内建那支）', () => {
  const tree = source('src/components/FileTree.vue')
  // 组装点收在 `src/projectTreeDecorations.ts`（`nodeDecorationFor` → EP），FileTree 只调它。
  assert.match(tree, /nodeDecorationFor/)
  assert.match(tree, /import \{ nodeDecorationFor, severityCounts \} from '\.\.\/projectTreeDecorations'/)
  assert.match(tree, /import \{ fileIconFor, type ProjectViewNodeDecoration \} from '\.\.\/ideViewExtensionPoints\.ts'/)
  const decorations = source('src/projectTreeDecorations.ts')
  assert.match(decorations, /return decorateProjectViewNode\(node\)/, '组装点自己走那条 EP')
  // 四格呈现都接到行上：class / title / name / icon。
  assert.match(tree, /viewOf\(row\)\?\.className/)
  assert.match(tree, /:title="viewOf\(row\)\?\.title"/)
  assert.match(tree, /viewOf\(row\)\?\.name/)
  assert.match(tree, /viewOf\(row\)\?\.icon/)
  // 逐行都过 EP（不是只过有诊断的那几个文件）。
  assert.match(tree, /function decorationOfRow\(row: ProjectTreeRow\): ProjectViewNodeDecoration/)
  assert.match(tree, /diagnosticCounts/)
})

test('item2b projectViewNodeDecorator：bundled 诊断装饰仍在，第三方按 id 注册后 FileTree 那条链拿到', async () => {
  const ext = await import('../src/ideViewExtensionPoints.ts')
  const deco = await import('../src/projectTreeDecorations.ts')
  assert.equal(ext.PROJECT_VIEW_NODE_DECORATOR_EP, 'com.intellij.projectViewNodeDecorator')
  assert.ok(EXTENSIONS.allEntries(ext.PROJECT_VIEW_NODE_DECORATOR_EP).map(entry => entry.id).includes(deco.DIAGNOSTIC_DECORATOR_ID),
    'bundled 诊断装饰器仍在表里')
  // 真实消费点：FileTree 的 `decorationOfRow` → `nodeDecorationFor`。
  const handle = ext.registerProjectViewNodeDecorator({
    id: 'test.thirdDeco', decorate: ({ data }) => { data.presentableText = '插件改过的名字' },
  })
  try {
    assert.equal(deco.nodeDecorationFor({ id: 'a.ts', name: 'a.ts', path: 'a.ts', isDirectory: false }).presentableText, '插件改过的名字')
  } finally { handle.dispose() }
  assert.equal(deco.nodeDecorationFor({ id: 'a.ts', name: 'a.ts', path: 'a.ts', isDirectory: false }).presentableText, undefined)
})

test('item3 fileIconProvider：FileTree 图标位问 fileIconFor，经 fileIconComponent 解析', () => {
  const tree = source('src/components/FileTree.vue')
  assert.match(tree, /fileIconFor\(\{/)
  assert.match(tree, /fileIconComponent\(fileIconFor/)
  assert.match(tree, /import \{ fileIconComponent \} from '\.\.\/fileIconNames.ts'/)
  assert.match(tree, /Puzzle v-else-if="row\.synthetic\?\.icon === 'plugin'"/)
})

test('item3b fileIconProvider：bundled 两支合成根图标仍在；第三方按 id 注册后 fileIconFor 先取它', async () => {
  const ext = await import('../src/ideViewExtensionPoints.ts')
  assert.equal(ext.FILE_ICON_PROVIDER_EP, 'com.intellij.fileIconProvider')
  // bundled 两支在 `src/workspaceLifecycle.ts` 的**模块加载时**登记（与 `customFoldingProviders.ts`
  // / `environmentKeyProviders.ts` 同一纪律），所以要先把那个模块真的加载进来才看得见 ——
  // 断言「登记在哪个模块」就得照那个模块的登记时机来，不能默认它已经在了。
  await import('../src/workspaceLifecycle.ts')
  const bundled = EXTENSIONS.allEntries(ext.FILE_ICON_PROVIDER_EP).map(entry => entry.id)
  assert.ok(bundled.includes('LibrariesFileIconProvider'), 'bundled 外部库图标 provider 仍在（src/workspaceLifecycle.ts 登记）')
  assert.ok(bundled.includes('ScratchFileIconProvider'), 'bundled scratch 图标 provider 仍在')
  assert.equal(ext.fileIconFor({ path: '\u0000libraries', isDirectory: true }), 'libraries')
  // 第三方按 id 挂一支（认 .foo）—— 真实消费点 `fileIconFor` 拿到它。
  const handle = ext.registerFileIconProvider({ id: 'test.fooIcon', getIcon: ({ path }) => (path.endsWith('.foo') ? 'archive' : null) })
  try {
    assert.equal(ext.fileIconFor({ path: 'a.foo', isDirectory: false }), 'archive')
  } finally { handle.dispose() }
  assert.equal(ext.fileIconFor({ path: 'a.foo', isDirectory: false }), null)
})

test('item3c fileIconNames：认得的名字给组件、内建合成名与认不出的给 null', () => {
  return import('../src/fileIconNames.ts').then(({ fileIconComponent, isKnownFileIconName, SYNTHETIC_ICON_NAMES }) => {
    assert.ok(fileIconComponent('fileCode'), 'fileCode 是一张表里的名字')
    assert.equal(fileIconComponent('libraries'), null, '内建合成名不归这张表（组件自己那几个分支画）')
    assert.equal(fileIconComponent('scratches'), null)
    assert.equal(fileIconComponent('nope-not-a-name'), null, '认不出的名字退回内建图标，不抛错也不画假图标')
    assert.equal(fileIconComponent(null), null)
    assert.deepEqual([...SYNTHETIC_ICON_NAMES], ['libraries', 'scratches'])
    assert.equal(isKnownFileIconName('terminal'), true)
    assert.equal(isKnownFileIconName('libraries'), false)
  })
})

// ── 4. structureViewExtension / psiStructureViewFactory / structureViewBuilder（OutlinePanel.vue） ──

test('item4 structureViewExtension/psiStructureViewFactory：OutlinePanel 走 outlineExtensions 那两层', () => {
  const panel = source('src/components/OutlinePanel.vue')
  assert.match(panel, /import \{ outlineRowsFromProviders, outlineRowsWithExtensions \} from '\.\.\/outlineExtensions\.ts'/)
  assert.match(panel, /outlineRowsFromProviders\(props\.path, props\.symbols, view\)/)
  assert.match(panel, /outlineRowsWithExtensions\(props\.path, base, view\)/)
})

test('item4b outlineExtensions：第三方构建器认领文件时用它的行，扩展给父符号补子行', async () => {
  const ext = await import('../src/ideViewExtensionPoints.ts')
  const mod = await import('../src/outlineExtensions.ts')
  const symbols = [{ name: 'A', kind: 5, detail: '', startLine: 0, startChar: 0, endLine: 9, endChar: 1 }]
  const view = { sort: false, flat: false, group: false, filter: '', collapsed: new Set() }

  // 三条 EP 的 id 逐字取自上游 qualifiedName。
  assert.equal(ext.STRUCTURE_VIEW_BUILDER_EP, 'com.intellij.structureViewBuilder')
  assert.equal(ext.STRUCTURE_VIEW_EXTENSION_EP, 'com.intellij.lang.structureViewExtension')
  assert.equal(ext.PSI_STRUCTURE_VIEW_FACTORY_EP, 'com.intellij.lang.psiStructureViewFactory')
  // 本仓没有 bundled 的结构视图构建器/扩展/工厂（折层在 src/outlineView.ts，不作为 EP 贡献）——如实断言。
  assert.deepEqual(EXTENSIONS.allEntries(ext.STRUCTURE_VIEW_BUILDER_EP), [])
  assert.deepEqual(EXTENSIONS.allEntries(ext.STRUCTURE_VIEW_EXTENSION_EP), [])
  assert.deepEqual(EXTENSIONS.allEntries(ext.PSI_STRUCTURE_VIEW_FACTORY_EP), [])

  // 没有贡献者 ⇒ 回落到内建折层（返回 null）。
  assert.equal(mod.outlineRowsFromProviders('a.ts', symbols, view), null)

  // 登记一个 PSI 结构视图工厂：认领 .ts，产出两行。
  const builderHandle = ext.registerPsiStructureViewFactory({
    id: 'test.tsFactory', fileType: 'ts',
    getStructureViewBuilder: () => ({
      id: 'test.builder',
      createStructureView: () => [
        { name: 'A', kind: 5, depth: 0, startLine: 0, startChar: 0, endLine: 9, endChar: 1 },
        { name: 'm', kind: 6, depth: 1, startLine: 2, startChar: 2, endLine: 4, endChar: 3 },
      ],
    }),
  })
  const rows = mod.outlineRowsFromProviders('a.ts', symbols, view)
  assert.ok(rows, '第三方构建器认领后不再回落')
  assert.deepEqual(rows.map(row => row.symbol.name), ['A', 'm'])
  assert.deepEqual(rows.map(row => row.depth), [0, 1])

  // 结构视图扩展：给类符号（kind 5）补一条子行。
  const extensionHandle = ext.registerStructureViewExtension({
    id: 'test.classExt',
    getType: () => [5],
    getChildren: parent => [{ name: `+${parent.symbol.name}`, kind: 8, depth: 1, startLine: 1, startChar: 0, endLine: 1, endChar: 1 }],
  })
  const base = mod.outlineRowsFromProviders('a.ts', symbols, view)
  const withExt = mod.outlineRowsWithExtensions('a.ts', base, view)
  assert.deepEqual(withExt.map(row => row.symbol.name).filter(name => name.startsWith('+')), ['+A'])
  const extRow = withExt.find(row => row.symbol.name === '+A')
  assert.equal(extRow.depth, 1, '扩展子行缩进一级')

  extensionHandle.dispose()
  builderHandle.dispose()
})

// ── 5. editorNotificationProvider（bidiNotification → editorBidiNotification 面板） ──

test('item5 editorNotificationProvider：内建双向文本提示**经收集路径**取文案，第三方同 id 可覆盖', async () => {
  const ext = await import('../src/ideViewExtensionPoints.ts')
  const bidi = await import('../src/bidiNotification.ts')
  assert.equal(ext.EDITOR_NOTIFICATION_PROVIDER_EP, 'com.intellij.editorNotificationProvider')
  assert.ok(EXTENSIONS.allEntries(ext.EDITOR_NOTIFICATION_PROVIDER_EP).map(entry => entry.id).includes(bidi.BIDI_NOTIFICATION_PANEL_ID),
    'bundled 双向文本 provider 仍在表里')

  // 真实消费点：`bidiPanelForText` 走 `editorNotificationsFor`（不是本地硬编码）。
  assert.match(source('src/bidiNotification.ts'), /const collected = editorNotificationsFor\(\{ path, root, text \}\)/)
  assert.match(source('src/editorBidiNotification.ts'), /bidiPanelForText\(view\.state\.doc\.toString\(\)\)\?\.text/)
  assert.equal(bidi.bidiPanelForText('hello'), null)
  assert.equal(bidi.bidiPanelForText('\u05e9\u05dc\u05d5\u05dd')?.text, bidi.BIDI_NOTIFICATION_TEXT)

  // 第三方按**同一 id** 覆盖内建那支 ⇒ 提示文案跟着换（这就是"真实消费点拿到"）。
  const handle = ext.registerEditorNotificationProvider({
    id: bidi.BIDI_NOTIFICATION_PANEL_ID,
    collectNotificationData: ({ text }) => (text.includes('\u05e9') ? { id: bidi.BIDI_NOTIFICATION_PANEL_ID, text: '插件说：有 RTL' } : null),
  })
  try {
    assert.equal(bidi.bidiPanelForText('\u05e9\u05dc\u05d5\u05dd')?.text, '插件说：有 RTL')
  } finally {
    handle.dispose()
    ext.registerEditorNotificationProvider(bidi.bidiNotificationProvider(), { source: 'bundled' })
  }
  assert.equal(bidi.bidiPanelForText('\u05e9\u05dc\u05d5\u05dd')?.text, bidi.BIDI_NOTIFICATION_TEXT, '恢复 bundled 后回到内建文案')
})

test('item5b editorNotificationProvider：第三方按别的 id 挂的面板被 editorPanelsForText 收到', async () => {
  const ext = await import('../src/ideViewExtensionPoints.ts')
  const bidi = await import('../src/bidiNotification.ts')
  const handle = ext.registerEditorNotificationProvider({
    id: 'test.genFilePanel',
    collectNotificationData: ({ path }) => (path.endsWith('.gen.ts') ? { id: 'test.genFilePanel', text: '生成文件' } : null),
  })
  try {
    const panels = bidi.editorPanelsForText({ path: 'a.gen.ts', root: 'D:/p', text: '' })
    assert.deepEqual(panels.map(panel => panel.text), ['生成文件'])
    assert.deepEqual(bidi.editorPanelsForText({ path: 'a.ts', root: 'D:/p', text: '' }), [])
  } finally { handle.dispose() }
})

// ── 6. todoExtraPlaces（TodoPanel.vue） ──

test('item6 todoExtraPlaces：TodoPanel 的扫描结果过 needsTodoIndex 这道门', () => {
  const panel = source('src/components/TodoPanel.vue')
  assert.match(panel, /import \{ needsTodoIndex \} from '\.\.\/todoExtraPlaces\.ts'/)
  assert.match(panel, /hits\.filter\(hit => needsTodoIndex\(hit\.path, props\.root\)\)/)
  assert.match(panel, /extraPlaceNote/, '挡掉多少要如实写在状态行里')
})

test('item6b todoExtraPlaces：内容根 / 额外位置 / 都被挡三档', async () => {
  const ext = await import('../src/ideViewExtensionPoints.ts')
  const { isScratchPath, isInWorkspaceContent, needsTodoIndex } = await import('../src/todoExtraPlaces.ts')
  assert.equal(ext.TODO_EXTRA_PLACES_EP, 'com.intellij.todoExtraPlaces')
  assert.ok(EXTENSIONS.allEntries(ext.TODO_EXTRA_PLACES_EP).map(entry => entry.id).includes('ScratchTodoExtraPlaces'),
    'bundled scratch 检查器仍在表里')
  // 内容根里的相对路径。
  assert.equal(isInWorkspaceContent('src/a.ts', '/root'), true)
  assert.equal(needsTodoIndex('src/a.ts', '/root'), true)
  // 跑到根外（`../x`）且没有 checker 认领 ⇒ 挡掉。
  assert.equal(isInWorkspaceContent('../x.ts', '/root'), false)
  assert.equal(needsTodoIndex('../x.ts', '/root'), false)
  // 绝对路径落在工作区根下才算内容。
  assert.equal(isInWorkspaceContent('/root/src/a.ts', '/root'), true)
  assert.equal(isInWorkspaceContent('/elsewhere/a.ts', '/root'), false)
  // scratch 是出厂的「额外位置」（ScratchTodoExtraPlaces）⇒ 即使不在内容根也认。
  assert.equal(isScratchPath('scratch/a.txt'), true)
  assert.equal(isScratchPath('deep/scratch/a.txt'), true)
  assert.equal(isScratchPath('src/a.ts'), false)
  assert.equal(needsTodoIndex('../scratch/a.txt', '/root'), true, '被 scratch checker 认领')
})

// ── 6c. usageGroupingRuleProvider（buildUsageTree 的 rules 选项 + 灌根入口） ──

test('item6c usageGroupingRuleProvider：第三方规则在目录与文件之间加一层组', async () => {
  const ext = await import('../src/ideViewExtensionPoints.ts')
  const { buildUsageTree, flattenUsageTree, usageGroupingRulesFor, USAGE_DIRECTORY_RANK, USAGE_FILE_RANK } =
    await import('../src/usageViewGrouping.ts')
  assert.equal(ext.USAGE_GROUPING_RULE_PROVIDER_EP, 'com.intellij.usageGroupingRuleProvider')
  assert.ok(EXTENSIONS.allEntries(ext.USAGE_GROUPING_RULE_PROVIDER_EP).map(entry => entry.id).includes('TaoCode.bundledUsageGroupingRules'),
    'bundled 目录/文件分组 provider 仍在表里')
  const locations = [{ path: 'src/a.ts', line: 3, character: 1 }]

  const plain = flattenUsageTree(buildUsageTree(locations, 'ws'), { showDirectories: true })
  assert.equal(plain.some(row => row.kind === 'group'), false, '不给规则 ⇒ 与既有行为一字不差')

  const withBundled = flattenUsageTree(buildUsageTree(locations, 'ws', { rules: usageGroupingRulesFor('') }), { showDirectories: true })
  assert.equal(withBundled.some(row => row.kind === 'group'), false, '内建 400/500 两支对应固有两层，不额外建组')

  const rule = { id: 'test.moduleRule', rank: 450, groupKeyOf: () => 'module:x', labelOf: () => '模块 X' }
  const custom = flattenUsageTree(buildUsageTree(locations, 'ws', { rules: [rule] }), { showDirectories: true })
  const groupRow = custom.find(row => row.kind === 'group')
  assert.ok(groupRow, '第三方规则加出了通用组层')
  assert.equal(groupRow.label, '模块 X')
  // 位置：目录（src）之下、文件（a.ts）之上。
  const dirAt = custom.findIndex(row => row.kind === 'directory')
  const fileAt = custom.findIndex(row => row.kind === 'file')
  const groupAt = custom.findIndex(row => row.kind === 'group')
  assert.ok(dirAt < groupAt && groupAt < fileAt, '组层夹在目录层与文件层之间')
  assert.ok(USAGE_DIRECTORY_RANK < rule.rank && rule.rank < USAGE_FILE_RANK)
})

test('item6d usageGroupingRuleProvider：referenceContents 的 rules 读宿主灌入的根（setUsageGroupingRoot）', async () => {
  const contents = await import('../src/referenceContents.ts')
  assert.match(source('src/referenceContents.ts'), /rules: usageGroupingRulesFor\(usageGroupingRoot\)/)
  assert.match(source('src/referenceContents.ts'), /export function setUsageGroupingRoot\(root: string\)/)
  assert.equal(contents.currentUsageGroupingRoot(), '', '默认没有根')
  contents.setUsageGroupingRoot('D:/proj')
  assert.equal(contents.currentUsageGroupingRoot(), 'D:/proj')
  contents.setUsageGroupingRoot('')
})

// ── 7. todoIndexer（TodoPanel.vue 合并第三方索引器条目） ──

test('item7 todoIndexer：TodoPanel 走 providerTodoItems / providerTodoIndexerPaths，且只在有第三方时才读盘', () => {
  const panel = source('src/components/TodoPanel.vue')
  assert.match(panel, /import \{ providerTodoIndexerPaths, providerTodoItems, mergeTodoItems, setTodoIndexerPatterns \} from '\.\.\/todoIndexerEntries\.ts'/)
  assert.match(panel, /const providerItems = await providerItemsFor\(indexed\.map\(hit => hit\.path\)\)/)
  assert.match(panel, /items\.value = mergeTodoItems\(keepPatternHits\(indexed, props\.patterns\), providerItems\)/)
  assert.match(panel, /setTodoIndexerPatterns\(props\.patterns\)/, 'bundled 索引器要拿到项目模式表')
  assert.match(panel, /const targets = providerTodoIndexerPaths\(paths\)\n  if \(!targets\.length\) return \[\]/,
    '没有第三方索引器时一次读盘都不发')
})

test('item7b todoIndexer：bundled PlainTextTodoIndexer 在表里；第三方按 id 注册后 providerTodoItems 拿到', async () => {
  const ext = await import('../src/ideViewExtensionPoints.ts')
  const entries = await import('../src/todoIndexerEntries.ts')
  assert.equal(ext.TODO_INDEXER_EP, 'com.intellij.todoIndexer')
  const bundled = EXTENSIONS.allEntries(ext.TODO_INDEXER_EP).map(entry => entry.id)
  assert.ok(bundled.includes(entries.PLAIN_TEXT_TODO_INDEXER_ID), 'bundled PlainTextTodoIndexer 在表里')

  const patterns = [{ pattern: 'TODO', description: '待办' }]
  entries.setTodoIndexerPatterns(patterns)
  // bundled 那支按模式表出条目（`map(FileContent)` 同名方法面）。
  assert.deepEqual(entries.todoEntriesFromText('x\nTODO: 修\n', patterns).map(entry => entry.line), [1])

  // bundled-only：面板**不**并它（与 search.run 重合）⇒ providerTodoIndexerPaths 恒空。
  assert.deepEqual(entries.providerTodoIndexerPaths(['a.ts']), [])
  assert.deepEqual(entries.providerTodoItems('a.ts', 'TODO: 修\n', patterns), [])

  // 第三方按 id 挂一支（认 .ts）—— 走 `registerIdeViewExtension`（`source` 默认 `user`，
  // 与 `registerTodoIndexer` 那个 bundled 助手区分开）；真实消费点两条都拿到它。
  const handle = ext.registerIdeViewExtension(ext.TODO_INDEXER_EP, 'test.tsIndexer', {
    id: 'test.tsIndexer', fileType: 'ts',
    map: ({ text }) => text.split('\n').flatMap((line, index) => (line.includes('HACK') ? [{ pattern: 'HACK', text: line.trim(), line: index }] : [])),
  })
  try {
    assert.deepEqual(entries.providerTodoIndexerPaths(['a.ts', 'a.py']), ['a.ts'], '只认第三方认领的 .ts')
    const items = entries.providerTodoItems('a.ts', 'ok\nHACK: 绕过去\n', patterns)
    assert.deepEqual(items.map(item => ({ line: item.line, kind: item.kind })), [{ line: 2, kind: 'HACK' }])
    // 合并进扫描结果：同 (path,line,text) 去重、不覆盖既有条目。
    const merged = entries.mergeTodoItems([{ path: 'a.ts', line: 1, text: 'TODO: x' }], items)
    assert.deepEqual(merged.map(item => item.line), [1, 2])
    assert.deepEqual(entries.mergeTodoItems([], []), [])
  } finally {
    handle.dispose()
    entries.setTodoIndexerPatterns([])
  }
})

// ── 7d. undoProvider（FileTree.vue 的 Ctrl+Z/Ctrl+Shift+Z 走 runFileUndoRedo） ──

test('item7d undoProvider：FileTree 走 runFileUndoRedo；bundled FileUndoProvider 收 commandStarted/Finished', async () => {
  const ext = await import('../src/ideViewExtensionPoints.ts')
  const host = await import('../src/undoProviderHost.ts')
  const tree = source('src/components/FileTree.vue')
  assert.match(tree, /import \{ runFileUndoRedo \} from '\.\.\/undoProviderHost\.ts'/)
  assert.match(tree, /void runFileUndoRedo\(processor, props\.workspaceKey \?\? '', kind, scope\)\.then/)
  assert.equal(ext.UNDO_PROVIDER_EP, 'com.intellij.undoProvider')
  const bundled = EXTENSIONS.allEntries(ext.UNDO_PROVIDER_EP).map(entry => entry.id)
  assert.ok(bundled.includes(host.FILE_UNDO_PROVIDER_ID), 'bundled FileUndoProvider 在表里')

  // 真实消费点：runFileUndoRedo 围绕一次撤销按上游 onCommandStarted/Finished 通知全部 provider。
  const calls = []
  const handle = ext.registerUndoProvider({
    id: 'test.thirdUndo',
    commandStarted: root => calls.push(`start:${root}`),
    commandFinished: root => calls.push(`finish:${root}`),
  })
  const processor = { undo: async () => ({ ok: true }), redo: async () => ({ ok: true }) }
  try {
    await host.runFileUndoRedo(processor, 'D:/p', 'undo', ['a.ts'])
    assert.deepEqual(calls, ['start:D:/p', 'finish:D:/p'], '起止都通知到了第三方')
    assert.equal(host.isInsideCommand('D:/p'), false, '跑完就不在命令里了')
    assert.ok(host.undoProviderCatalog().some(entry => entry.id === 'test.thirdUndo' && entry.hasCommandHooks))
  } finally { handle.dispose() }
  calls.length = 0
  await host.runFileUndoRedo(processor, 'D:/p', 'redo')
  assert.deepEqual(calls, [], '注销后不再收到通知')
})

// ── 8. projectViewPane（ToolWindowView.vue 齿轮下拉） ──

test('item8 项目视图窗格：ToolWindowView 齿轮下拉渲染 choices 并调 select', () => {
  const view = source('src/components/ToolWindowView.vue')
  assert.match(view, /import \{ createProjectViewPaneHost \} from '\.\.\/projectViewPanes\.ts'/)
  assert.match(view, /createProjectViewPaneHost\(\{ root: \(\) => props\.ctx\.root, load: readStoredPane, persist: storePane \}\)/)
  assert.match(view, /const paneChoices = paneHost\.choices/)
  assert.match(view, /v-for="pane in paneChoices"/)
  assert.match(view, /@click="selectPane\(pane\.id\)"/)
  assert.match(view, /项目视图窗格/)
})

test('item8b projectViewPane：bundled 三支在表里；第三方按 id 注册后 choices 拿到它', async () => {
  const ext = await import('../src/ideViewExtensionPoints.ts')
  const panes = await import('../src/projectViewPanes.ts')
  assert.equal(ext.PROJECT_VIEW_PANE_EP, 'com.intellij.projectViewPane')
  const bundled = EXTENSIONS.allEntries(ext.PROJECT_VIEW_PANE_EP).map(entry => entry.id)
  for (const id of [panes.PROJECT_PANE_ID, panes.PACKAGES_PANE_ID, panes.SCOPE_PANE_ID]) {
    assert.ok(bundled.includes(id), `bundled 窗格 ${id} 在表里`)
  }
  const handle = ext.registerProjectViewPane({
    id: 'test.thirdPane', getTitle: () => '插件窗格', isInitiallyVisible: () => false,
    getGroup: () => '插件', getWeight: () => 99, isAvailable: root => root.length > 0,
  })
  try {
    const choices = panes.projectViewPaneChoices('D:/p')
    assert.equal(choices[0].id, 'test.thirdPane', 'weight 最大者排最前（真实消费点 choices）')
    assert.ok(choices.some(choice => choice.id === panes.PROJECT_PANE_ID))
  } finally { handle.dispose() }
})

// ── 8c. notificationGroup（notificationGroups.ts 的 notificationGroup() 查询路径） ──

test('item8c notificationGroup：bundled 内建组在表里；第三方按 displayId 注册后被 notificationGroup 拿到', async () => {
  const ext = await import('../src/ideViewExtensionPoints.ts')
  const groups = await import('../src/notificationGroups.ts')
  assert.equal(ext.NOTIFICATION_GROUP_EP, 'com.intellij.notificationGroup')
  const bundled = EXTENSIONS.allEntries(ext.NOTIFICATION_GROUP_EP).map(entry => entry.id)
  assert.ok(bundled.includes('LSP window/showMessage'), 'bundled 内建通知组在表里')
  assert.equal(groups.notificationGroup('LSP window/showMessage').displayType, 'BALLOON')
  const handle = ext.registerNotificationGroup({
    id: 'ThirdPartyGroup', getDisplayId: () => 'ThirdPartyGroup', getDisplayType: () => 'STICKY_BALLOON',
    isLogByDefault: () => false, getToolWindowId: () => 'Notifications', getTitle: () => '第三方组',
  })
  try {
    const group = groups.notificationGroup('ThirdPartyGroup')
    assert.equal(group.displayType, 'STICKY_BALLOON')
    assert.equal(group.title, '第三方组')
    assert.equal(group.toolWindowId, 'Notifications')
  } finally { handle.dispose() }
  assert.equal(groups.notificationGroup('ThirdPartyGroup'), undefined)
})

// ── 9. largeFileViewer → 提示条文案（CodeEditor 渲染的那条） ──

test('item9 大文件查看器：提示条文案经 largeFileEditorViewFor 取大小与降级清单', async () => {
  const notice = source('src/largeFileNotice.ts')
  assert.match(notice, /const view = largeFileEditorViewFor\(\{ path, root, bytes \}\)/)
  assert.match(notice, /view\?\.sizeText/)
  assert.match(notice, /view\?\.features/)

  const { largeFileNoticeText } = await import('../src/largeFileNotice.ts')
  const big = 6 * 1024 * 1024
  const text = largeFileNoticeText(big)
  assert.match(text, /6\.0 MiB/)
  assert.match(text, /只读/)
  assert.match(text, /语法高亮/)
  assert.match(text, /查找替换/)
})

test('item9 EP 真的在文案路径上：第三方覆盖 LargeFileEditor 会换掉大小文案', async () => {
  const providers = await import('../src/fileEditorProviders.ts')
  const viewer = await import('../src/largeFileViewer.ts')
  const { LARGE_FILE_LIMIT } = await import('../src/largeFileMode.ts')
  const handle = providers.registerFileEditorProvider({
    id: viewer.LARGE_FILE_EDITOR_PROVIDER_ID,
    getEditorTypeId: () => 'ThirdPartyLargeFile',
    accept: input => (input.bytes ?? 0) >= LARGE_FILE_LIMIT,
    createEditor: () => ({ editorTypeId: 'ThirdPartyLargeFile', sizeText: '巨无霸', features: { lsp: false, syntaxHighlighting: false, wordWrap: true }, notice: '' }),
  })
  try {
    const { largeFileNoticeText } = await import('../src/largeFileNotice.ts')
    const text = largeFileNoticeText(LARGE_FILE_LIMIT)
    assert.match(text, /巨无霸/, '大小文案来自 EP 里那支提供者')
    assert.doesNotMatch(text, /自动换行已关闭/, '只关了两项（wordWrap 仍开）时清单跟着 features 走')
  } finally {
    handle.dispose()
    providers.registerFileEditorProvider(viewer.LARGE_FILE_EDITOR_PROVIDER, { source: 'bundled' })
  }
})

// ── 9b. 编辑器侧的降级判定也过 EP（W-EP-2 / W2-EP-2） ──

test('item9b 判定过 EP：第三方全开 features ⇒ 降级为假；bundled-only 与旧行为逐字一致', async () => {
  const bytesModule = source('src/largeFileBytes.ts')
  assert.match(bytesModule, /import \{ largeFileEditorViewFor \} from '\.\/largeFileViewer\.ts'/)
  assert.match(bytesModule, /const view = largeFileEditorViewFor\(\{ path, root, bytes \}\)/, '超限后问 EP（不是本地写死）')
  const editor = source('src/components/CodeEditor.vue')
  assert.match(editor, /const large = largeFilePolicyForText\(props\.content\)/, 'CodeEditor 的调用点不变（该文件禁改）')

  const providers = await import('../src/fileEditorProviders.ts')
  const viewer = await import('../src/largeFileViewer.ts')
  const { largeFilePolicyForText } = await import('../src/largeFileBytes.ts')
  const { LARGE_FILE_LIMIT } = await import('../src/largeFileMode.ts')
  const big = 'a'.repeat(LARGE_FILE_LIMIT)

  // bundled-only 一档：features 三项全关，与旧行为逐字一致。
  const bundled = largeFilePolicyForText(big)
  assert.equal(bundled.large, true)
  assert.deepEqual(bundled.features, { lsp: false, syntaxHighlighting: false, wordWrap: false })

  // 第三方按同一 id 覆盖：features 全开 ⇒ 这个文件不降级。
  const handle = providers.registerFileEditorProvider({
    id: viewer.LARGE_FILE_EDITOR_PROVIDER_ID,
    getEditorTypeId: () => 'ThirdPartyLargeFile',
    accept: () => true,
    createEditor: () => ({
      editorTypeId: 'ThirdPartyLargeFile', sizeText: '轻量档',
      features: { lsp: true, syntaxHighlighting: true, wordWrap: true }, notice: '',
    }),
  })
  try {
    assert.equal(largeFilePolicyForText(big).large, false, 'EP 裁决 features 全开 ⇒ 组件那条 heavy 为假')
  } finally {
    handle.dispose()
    providers.registerFileEditorProvider(viewer.LARGE_FILE_EDITOR_PROVIDER, { source: 'bundled' })
  }
  assert.equal(largeFilePolicyForText(big).large, true, '恢复 bundled 后回到降级档')
})

test('item9c editorLargeFilePlan：features 三个分量逐个透出（不再压成一个布尔），只读跟着走', async () => {
  const { editorLargeFilePlan, largeFilePolicyForText } = await import('../src/largeFileBytes.ts')
  const { largeFilePolicy, LARGE_FILE_LIMIT } = await import('../src/largeFileMode.ts')
  // 非大文件：三项全开、按磁盘只读。
  const small = editorLargeFilePlan(largeFilePolicy(0), true)
  assert.deepEqual(
    { lsp: small.lsp, syntaxHighlighting: small.syntaxHighlighting, wordWrap: small.wordWrap, readOnly: small.readOnly, degraded: small.degraded },
    { lsp: true, syntaxHighlighting: true, wordWrap: true, readOnly: true, degraded: false },
  )
  assert.equal(small.notice, null)
  // 大文件 bundled 档：三项全关、只读、有提示。
  const big = editorLargeFilePlan(largeFilePolicy(LARGE_FILE_LIMIT))
  assert.deepEqual([big.lsp, big.syntaxHighlighting, big.wordWrap], [false, false, false])
  assert.equal(big.readOnly, true)
  assert.ok(big.notice)

  // 第三方只关 wordWrap ⇒ 粒度真的分开（语言服务/高亮仍开）。
  const providers = await import('../src/fileEditorProviders.ts')
  const viewer = await import('../src/largeFileViewer.ts')
  const handle = providers.registerFileEditorProvider({
    id: viewer.LARGE_FILE_EDITOR_PROVIDER_ID,
    getEditorTypeId: () => 'ThirdPartyLargeFile',
    accept: () => true,
    createEditor: () => ({
      editorTypeId: 'ThirdPartyLargeFile', sizeText: '半档',
      features: { lsp: true, syntaxHighlighting: true, wordWrap: false }, notice: '',
    }),
  })
  try {
    const plan = editorLargeFilePlan(largeFilePolicyForText('a'.repeat(LARGE_FILE_LIMIT)))
    assert.deepEqual([plan.lsp, plan.syntaxHighlighting, plan.wordWrap], [true, true, false],
      '只关一项时另两项仍开 —— 这正是 CodeEditor 压成布尔后丢掉的信息')
  } finally {
    handle.dispose()
    providers.registerFileEditorProvider(viewer.LARGE_FILE_EDITOR_PROVIDER, { source: 'bundled' })
  }
})

// ── 9d. fileEditorProvider 的宿主决策函数（W2-EP-1 的纯逻辑侧落点） ──

test('item9d editorProviderDecision：抑制 / 第三方抢先 / 默认三档，policy 与 readOnly 如实透出', async () => {
  const providers = await import('../src/fileEditorProviders.ts')
  const viewer = await import('../src/largeFileViewer.ts')
  const { LARGE_FILE_LIMIT } = await import('../src/largeFileMode.ts')

  // 非大文件、只有 bundled 那支（不认领）⇒ 默认文本编辑器。
  const plain = providers.editorProviderDecision({ path: 'a.ts', root: 'D:/p', text: 'x' })
  assert.equal(plain.providerId, null)
  assert.equal(plain.editorTypeId, null)
  assert.equal(plain.policy, 'NONE')
  assert.equal(plain.suppressed, false)
  assert.deepEqual(plain.accepted, [])

  // 大文件 ⇒ bundled LargeFileEditor 赢，readOnly 为真。
  const big = providers.editorProviderDecision({ path: 'a.ts', root: 'D:/p', bytes: LARGE_FILE_LIMIT })
  assert.equal(big.providerId, viewer.LARGE_FILE_EDITOR_PROVIDER_ID)
  assert.equal(big.editorTypeId, viewer.LARGE_FILE_EDITOR_TYPE_ID)
  assert.equal(big.policy, 'NONE')
  assert.equal(big.readOnly, true)

  // 第三方按自己的 id 抢先（注册序在前）⇒ 决策拿到它，带上 policy。
  const handle = providers.registerFileEditorProvider({
    id: 'test.thirdEditor', getEditorTypeId: () => 'FooEditor', accept: ({ path }) => path.endsWith('.foo'),
    createEditor: () => ({ editorTypeId: 'FooEditor', readOnly: true }), getPolicy: () => 'PLACE_BEFORE_DEFAULT_EDITOR',
  }, { order: 'first' })
  try {
    const decision = providers.editorProviderDecision({ path: 'a.foo', root: 'D:/p' })
    assert.equal(decision.providerId, 'test.thirdEditor')
    assert.equal(decision.editorTypeId, 'FooEditor')
    assert.equal(decision.policy, 'PLACE_BEFORE_DEFAULT_EDITOR')
    assert.equal(decision.readOnly, true)
    assert.ok(decision.accepted.includes('test.thirdEditor'))
  } finally { handle.dispose() }

  // 抑制器挡住 ⇒ 全空（上游先问抑制器）。
  const suppressor = providers.registerFileEditorProviderSuppressor({ id: 'test.suppress', suppress: ({ path }) => path.endsWith('.foo') })
  const third = providers.registerFileEditorProvider({
    id: 'test.thirdEditor', getEditorTypeId: () => 'FooEditor', accept: ({ path }) => path.endsWith('.foo'), createEditor: () => ({}),
  })
  try {
    const blocked = providers.editorProviderDecision({ path: 'a.foo', root: 'D:/p' })
    assert.equal(blocked.suppressed, true)
    assert.equal(blocked.providerId, null)
    assert.deepEqual(blocked.accepted, [])
  } finally { suppressor.dispose(); third.dispose() }
})

// ── 10. EP id 与上游逐字一致（13 条声明 + 2 条文件编辑器 EP） ──

test('item10 十三条 EP 的 id 逐字取自上游 qualifiedName，且都已声明', async () => {
  const ext = await import('../src/ideViewExtensionPoints.ts')
  const expected = [
    [ext.TODO_INDEXER_EP, 'com.intellij.todoIndexer'],
    [ext.STRUCTURE_VIEW_BUILDER_EP, 'com.intellij.structureViewBuilder'],
    [ext.PROJECT_VIEW_PANE_EP, 'com.intellij.projectViewPane'],
    [ext.NOTIFICATION_GROUP_EP, 'com.intellij.notificationGroup'],
    [ext.UNDO_PROVIDER_EP, 'com.intellij.undoProvider'],
    [ext.TREE_STRUCTURE_PROVIDER_EP, 'com.intellij.treeStructureProvider'],
    [ext.PROJECT_VIEW_NODE_DECORATOR_EP, 'com.intellij.projectViewNodeDecorator'],
    [ext.FILE_ICON_PROVIDER_EP, 'com.intellij.fileIconProvider'],
    [ext.USAGE_GROUPING_RULE_PROVIDER_EP, 'com.intellij.usageGroupingRuleProvider'],
    [ext.STRUCTURE_VIEW_EXTENSION_EP, 'com.intellij.lang.structureViewExtension'],
    [ext.PSI_STRUCTURE_VIEW_FACTORY_EP, 'com.intellij.lang.psiStructureViewFactory'],
    [ext.EDITOR_NOTIFICATION_PROVIDER_EP, 'com.intellij.editorNotificationProvider'],
    [ext.TODO_EXTRA_PLACES_EP, 'com.intellij.todoExtraPlaces'],
  ]
  for (const [actual, upstream] of expected) {
    assert.equal(actual, upstream, `EP id 必须与上游 qualifiedName 逐字一致：${upstream}`)
    assert.ok(EXTENSIONS.hasExtensionPoint(actual), `${actual} 应已声明`)
  }
  const { FILE_EDITOR_PROVIDER_EP, FILE_EDITOR_PROVIDER_SUPPRESSOR_EP } = await import('../src/extensionPoints.ts')
  assert.equal(FILE_EDITOR_PROVIDER_EP, 'com.intellij.fileEditorProvider')
  assert.equal(FILE_EDITOR_PROVIDER_SUPPRESSOR_EP, 'com.intellij.fileEditorProviderSuppressor')
})

// ── 7/11. 禁改文件挂点：接线单里如实登记 ──

test('item11 fileEditorProvider 的 openFile 挂点写进了接线单（App.vue 禁改）', () => {
  const doc = source('docs/wiring-requests-2026-10-07-epmount.md')
  assert.match(doc, /W-EP-1 `com\.intellij\.fileEditorProvider` 接进打开文件路径/)
  assert.match(doc, /editorProviderFor/)
  assert.match(doc, /src\/App\.vue:922/)
})

test('item11b 第二批接线单：W2-EP-1..W2-EP-4 四条都在，且引用真实存在的落点', async () => {
  const doc = source('docs/wiring-requests-2026-10-07-epmount2.md')
  for (const id of ['W2-EP-1', 'W2-EP-2', 'W2-EP-3', 'W2-EP-4']) assert.match(doc, new RegExp(id))
  assert.match(doc, /editorProviderDecision/)
  assert.match(doc, /editorLargeFilePlan/)
  assert.match(doc, /setUsageGroupingRoot/)
  const { existsSync } = await import('node:fs')
  for (const path of ['src/fileEditorProviders.ts', 'src/largeFileBytes.ts', 'src/referenceContents.ts',
                      'src/todoIndexerEntries.ts', 'src/undoProviderHost.ts']) {
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `${path} 必须真实存在`)
  }
})

test('item11c 旧接线单已标注 W-EP-1..W-EP-3 由第二批接续', () => {
  const doc = source('docs/wiring-requests-2026-10-07-epmount.md')
  assert.match(doc, /状态复核（2026-10-07 epmount2 lane）/)
  assert.match(doc, /W2-EP-1/)
  assert.match(doc, /W-EP-4 \/ W-EP-5 仍未动/)
})
