// 项目视图齿轮「外观」那一组的三条用户可见行为：**可编辑的文件嵌套规则**（上游
// `ProjectView.FileNesting` = `ConfigureFilesNestingAction`）、**压缩目录**
// （上游 `ProjectView.CompactDirectories`）与**显示临时文件和控制台**
// （上游 `ProjectView.ShowScratchesAndConsoles`，`intellij.platform.projectView.xml:81-84`）。
// 判据 = 上游坐标 + 本仓的真实渲染结果。
//
// 上游坐标（细节推导都写在 `src/projectTreeCompactDirs.ts` / `src/projectTreeState.ts` /
// `src/projectViewBehavior.ts` 的模块头）：
//   · `platform/projectView/shared/resources/intellij.platform.projectView.xml:56-105`（Appearance 组）
//     与 `:106-130`（Sort 组）—— Appearance 组在 Sort 组之前；
//   · `:81-84` `ProjectView.ShowScratchesAndConsoles`（默认开：`ViewSettings.java:54-56`）、
//     `:98-99` `ProjectView.CompactDirectories`、`:101-102` `ProjectView.FileNesting`；
//   · 压缩规则 `platform/lang-impl/src/com/intellij/ide/scopeView/ScopeViewTreeModel.java:595-608`
//     （只有一个子目录就往下并）+ `:657-661`（`getSingleDirectory`）+ `:789-792`（名字用 `/` 连）；
//   · 默认档 `platform/editor-ui-api/src/com/intellij/ide/util/treeView/NodeOptions.java:41-43`（false）；
//   · 嵌套开关 `platform/lang-impl/src/com/intellij/ide/projectView/ProjectViewSettings.java:29-31`（true），
//     设置改了整树重建 `platform/projectView/shared/src/actions/ConfigureFilesNestingAction.kt:55-58`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MAX_COMPACT_CHAIN, compactChainOf, compactListing, compactName, singleDirectoryChild } from '../src/projectTreeCompactDirs.ts'
import { createProjectTreeModel } from '../src/projectTreeModel.ts'
import { DEFAULT_NESTING_RULES } from '../src/projectTreeNesting.ts'

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8')
const directory = (path, name = path.split('/').at(-1)) => ({ path, name, kind: 'directory' })
const file = path => ({ path, name: path.split('/').at(-1), kind: 'file' })

test('getSingleDirectory：恰好一个子项且它是目录才并（ScopeViewTreeModel:657-661）', () => {
  assert.deepEqual(singleDirectoryChild([directory('a/b')]), { path: 'a/b', name: 'b', kind: 'directory' })
  assert.equal(singleDirectoryChild([file('a/x.ts')]), null, '唯一子项是文件 ⇒ 不并')
  assert.equal(singleDirectoryChild([directory('a/b'), directory('a/c')]), null, '两个子项 ⇒ 不并')
  assert.equal(singleDirectoryChild([directory('a/b'), file('a/x.ts')]), null)
  assert.equal(singleDirectoryChild([]), null)
  assert.equal(singleDirectoryChild(undefined), null, '子列表没取到 ⇒ 宁可不并')
})

test('显示名按 / 连接整条链（ScopeViewTreeModel:789-792，非包目录用 VFS_SEPARATOR_CHAR）', () => {
  assert.equal(compactName(['src', 'components', 'ui']), 'src/components/ui')
  assert.equal(compactName(['src']), 'src')
})

test('链走到底：src/components/ui 并成一行，行代表最深那一格', () => {
  const listings = new Map([
    ['src', [directory('src/components')]],
    ['src/components', [directory('src/components/ui')]],
    ['src/components/ui', [file('src/components/ui/a.ts'), file('src/components/ui/b.ts')]],
  ])
  const chain = compactChainOf(directory('src'), path => listings.get(path))
  assert.equal(chain.depth, 3)
  assert.equal(chain.entry.path, 'src/components/ui')
  assert.equal(compactName(chain.names), 'src/components/ui')
})

test('链深上限：符号链接环不能把链拖到无穷（本仓比上游多的一条约束，见模块头）', () => {
  const loop = new Map([['d/1', [directory('d/2')]], ['d/2', [directory('d/1')]]])
  const chain = compactChainOf(directory('d/1'), path => loop.get(path))
  assert.equal(chain.names.length, MAX_COMPACT_CHAIN, `链长要停在 ${MAX_COMPACT_CHAIN}，实测 ${chain.names.length}`)
})

test('compactListing 只动目录：文件、合成行、根行原样留着', () => {
  const listings = new Map([['a', [directory('a/b')]], ['a/b', [file('a/b/c.ts')]]])
  const listing = [directory('a'), file('x.ts'), directory(''), file('\u0000lib/jar'), directory('solo')]
  const compacted = compactListing(listing, path => listings.get(path))
  assert.deepEqual(compacted.map(entry => entry.name), ['a/b', 'x.ts', '', 'jar', 'solo'])
  assert.equal(compacted[0].path, 'a/b', '并好的行代表最深那一格')
  assert.equal(compacted[4].path, 'solo', '取不到子列表的目录不并')
})

// 模型这一层跑的是真的 `createProjectTreeModel`：目录内容预先塞进 `children` 缓存，
// 于是 `expandAll` 全程不碰桥（链解析只读缓存）。
function mountedModel(over = {}) {
  const entries = [directory('src'), directory('docs'), file('README.md')]
  const listings = new Map([
    ['src', [directory('src/components')]],
    ['src/components', [directory('src/components/ui')]],
    ['src/components/ui', [file('src/components/ui/a.ts'), file('src/components/ui/b.ts')]],
    ['docs', [file('docs/readme.md')]],
  ])
  const errors = []
  const settings = { sortKey: 'BY_NAME', foldersAlwaysOnTop: true, autoscrollToSource: false,
    autoscrollFromSource: false, openInPreviewTab: false, compactDirectories: over.compact ?? false }
  const model = createProjectTreeModel({
    entries: () => entries,
    synthetic: () => [],
    depth: () => 0,
    projectName: () => 'demo',
    sortSettings: () => settings,
    nestingRules: () => [],
    compactDirs: () => over.compact ?? false,
    error: message => errors.push(message),
  })
  for (const [path, kids] of listings) model.children.set(path, kids)
  return { model, errors }
}

test('压缩目录开着时，行一出现就是并好的名字；关着时保持一格一行（上游默认关）', async () => {
  const off = mountedModel({ compact: false })
  await off.model.expandAll()
  assert.deepEqual(off.model.rows.value.map(row => row.entry.name),
    ['demo', 'docs', 'readme.md', 'src', 'components', 'ui', 'a.ts', 'b.ts', 'README.md'])
  assert.deepEqual(off.errors, [], '不该去桥那边取没预置的目录')

  const on = mountedModel({ compact: true })
  await on.model.expandAll()
  assert.deepEqual(on.model.rows.value.map(row => row.entry.name),
    ['demo', 'docs', 'readme.md', 'src/components/ui', 'a.ts', 'b.ts', 'README.md'])
  assert.deepEqual(on.errors, [])
  const merged = on.model.rows.value.find(row => row.entry.name === 'src/components/ui')
  assert.equal(merged.entry.path, 'src/components/ui', '这一行代表最深那一格')
  assert.equal(merged.level, 1, '并起来后不再占三层缩进')
  assert.equal(on.model.rows.value.filter(row => row.entry.name === 'components' || row.entry.name === 'ui').length, 0,
    '中间那两格不再各占一行')
  assert.equal(on.model.rows.value.find(row => row.entry.name === 'readme.md').level, 2,
    'docs 只有一个文件子项 ⇒ 不并，还是两层')
})

test('嵌套规则由设置页喂进来：改表就改树上谁收谁（不再只能用出厂表）', () => {
  const entries = [file('main.ts'), file('main.js'), file('main.css'), directory('src')]
  const settings = { sortKey: 'BY_NAME', foldersAlwaysOnTop: true, autoscrollToSource: false,
    autoscrollFromSource: false, openInPreviewTab: false }
  const build = rules => createProjectTreeModel({
    entries: () => entries, synthetic: () => [], depth: () => 0, projectName: () => 'demo',
    sortSettings: () => settings, nestingRules: rules, error: () => {},
  })
  const editable = build(() => [{ parent: '*.ts', children: ['*.js', '*.css'] }])
  assert.deepEqual(editable.rows.value.map(row => row.entry.name), ['demo', 'src', 'main.ts'])
  editable.toggle(entries[0])
  assert.deepEqual(editable.rows.value.map(row => row.entry.name), ['demo', 'src', 'main.ts', 'main.css', 'main.js'])
  assert.equal(editable.rows.value[3].level, editable.rows.value[2].level + 1, '嵌进去的文件比父行深一级')

  // 换了规则表 ⇒ 换的是「收别人」的那一格：*.css 当父时 main.js 归它，main.ts 不再认领任何人。
  const custom = build(() => [{ parent: '*.css', children: ['*.js'] }])
  assert.deepEqual(custom.rows.value.map(row => row.entry.name), ['demo', 'src', 'main.css', 'main.ts'])
  assert.equal(custom.hasNested('main.css'), true)
  assert.equal(custom.hasNested('main.ts'), false)
  assert.equal(editable.hasNested('main.ts'), true, '上一段那张表里 main.ts 才是父')

  // 开关关掉（`ProjectViewSettings.java:29-31` 的 useFileNestingRules=false 那条路）⇒ 一张空规则表，谁也不嵌谁。
  const disabled = build(() => [])
  assert.deepEqual(disabled.rows.value.map(row => row.entry.name), ['demo', 'src', 'main.css', 'main.js', 'main.ts'])
  assert.equal(disabled.hasNested('main.ts'), false)
})

// ── 设置与接线的判据（这些正则锚点就是「模块有没有真被接上」的证据）──────────────────
test('compactDirectories 存进项目视图设置：默认关，旧存档缺这个键不判损坏', async () => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, value) },
    removeItem: key => { store.delete(key) },
  }
  const { DEFAULT_PROJECT_TREE_SETTINGS, getProjectTreeState, projectTreeHostFor } = await import('../src/projectTreeState.ts')
  assert.equal(DEFAULT_PROJECT_TREE_SETTINGS.compactDirectories, false, '上游默认档（NodeOptions.java:41-43）')
  const host = getProjectTreeState('D:/demo')
  assert.equal(host.state.compactDirectories, false)
  host.update({ compactDirectories: true })
  assert.equal(host.state.compactDirectories, true)
  assert.match(store.get('taocode.projectView.v1:' + encodeURIComponent('D:/demo')), /"compactDirectories":true/)
  // 旧存档里没这个键：读回来还是默认档，而不是被判成坏档。
  store.set('taocode.projectView.v1:' + encodeURIComponent('D:/old'), JSON.stringify({ sortKey: 'BY_TYPE' }))
  assert.equal(getProjectTreeState('D:/old').state.compactDirectories, false)
  assert.equal(getProjectTreeState('D:/old').state.sortKey, 'BY_TYPE')
  // 反查表：拿着 state 就能找回宿主（齿轮那一格靠它），拿不到就是 null（组件据此不渲染）。
  assert.equal(projectTreeHostFor(host.state), host)
  assert.equal(projectTreeHostFor({ sortKey: 'BY_NAME', foldersAlwaysOnTop: true }), null)
  assert.equal(projectTreeHostFor(undefined), null)
  // 嵌套规则的落点与回读
  host.updateNesting({ enabled: false })
  assert.equal(host.nesting.enabled, false)
  host.updateNesting({ rules: [{ parent: 'a.ts', children: ['b.ts'] }] })
  assert.deepEqual(host.nesting.rules, [{ parent: 'a.ts', children: ['b.ts'] }])
})

test('齿轮里的三格：显示临时文件和控制台 / 压缩目录 / 文件嵌套…，且按 XML 的成员次序', () => {
  const settings = read('../src/components/ProjectViewSortSettings.vue')
  const appearance = settings.indexOf('aria-label="外观"')
  const sort = settings.indexOf('aria-label="排序"')
  assert.ok(appearance >= 0 && sort >= 0, '两组都得真渲染出来')
  assert.ok(appearance < sort, '上游 Appearance 组（xml:56）在 Sort 组（xml:106）之前')
  assert.match(settings, /文件嵌套…/)
  assert.match(settings, /压缩目录/)
  assert.match(settings, /role="menuitemcheckbox"[^>]*compactDirectories/)
  assert.match(settings, /import FileNestingSettings from '.\/FileNestingSettings.vue'/)
  assert.match(settings, /projectTreeHostFor\(props\.settings\)/, '取不到宿主就不给这一格')
  assert.match(settings, /v-if="host && nestingOpen"/)
  assert.match(settings, /host\?\.updateNesting\(patch\)/, '对话框的 apply 直接落到宿主那份设置')
  // 组内成员次序照 `intellij.platform.projectView.xml`：ShowScratchesAndConsoles（:81-84）
  // → CompactDirectories（:98-99）→ FileNesting（:101-102），两处 <separator/>（:100、:103）。
  // 三个标签的**渲染顺序**才是判据（注释里也出现这些字），所以只在模板那一段里比。
  const template = settings.slice(settings.indexOf('<template>'))
  const scratches = template.indexOf('显示临时文件和控制台')
  const compact = template.indexOf('压缩目录')
  const nesting = template.indexOf('文件嵌套…')
  assert.ok(scratches >= 0 && compact >= 0 && nesting >= 0, '三格都真在模板里渲染')
  assert.ok(scratches < compact && compact < nesting, '组内次序 = 上游 XML 的行序')
  assert.match(settings, /:aria-checked="showScratches"[^>]*showScratchesAndConsoles: !showScratches/,
    '点它是翻这一格，不是翻别的设置')
  const appearanceBlock = settings.slice(appearance, sort)
  assert.equal(appearanceBlock.split('role="separator"').length - 1, 2, '上游在 dirs 块与 nesting 块之间各有一道分隔线')
})

test('显示临时文件和控制台：默认开、存进项目视图设置、旧存档缺键不判损坏', async () => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, value) },
    removeItem: key => { store.delete(key) },
  }
  const { DEFAULT_PROJECT_TREE_SETTINGS, getProjectTreeState } = await import('../src/projectTreeState.ts')
  // 上游默认档：`ViewSettings.java:54-56` / `ProjectViewSharedSettings.kt:28` 都是 true。
  assert.equal(DEFAULT_PROJECT_TREE_SETTINGS.showScratchesAndConsoles, true)
  const host = getProjectTreeState('D:/scratches')
  assert.equal(host.state.showScratchesAndConsoles, true)
  host.update({ showScratchesAndConsoles: false })
  assert.equal(host.state.showScratchesAndConsoles, false)
  assert.match(store.get('taocode.projectView.v1:' + encodeURIComponent('D:/scratches')),
    /"showScratchesAndConsoles":false/)
  host.update({ showScratchesAndConsoles: true })
  assert.match(store.get('taocode.projectView.v1:' + encodeURIComponent('D:/scratches')),
    /"showScratchesAndConsoles":true/)
  // 旧存档（这一键从没写过）⇒ 读回来是默认的「显示」，不是坏档。
  store.set('taocode.projectView.v1:' + encodeURIComponent('D:/old-scratches'),
    JSON.stringify({ sortKey: 'BY_TYPE', compactDirectories: true }))
  const old = getProjectTreeState('D:/old-scratches')
  assert.equal(old.state.showScratchesAndConsoles, true, '缺键补默认')
  assert.equal(old.state.sortKey, 'BY_TYPE', '同存档里已有的键照旧生效')
  assert.equal(old.state.compactDirectories, true)
  // 坏值（不是布尔）当没写，仍旧是默认档。
  store.set('taocode.projectView.v1:' + encodeURIComponent('D:/bad-scratches'),
    JSON.stringify({ showScratchesAndConsoles: 'yes' }))
  assert.equal(getProjectTreeState('D:/bad-scratches').state.showScratchesAndConsoles, true)
})

test('这一格真的落到树里：FileTree 用它过滤合成根，改设置整树重建', () => {
  const tree = read('../src/components/FileTree.vue')
  assert.match(tree, /import \{ treeClickOpensFile, treeOpenUsesPreviewTab, visibleSyntheticNodes, type ProjectViewBehavior \} from '\.\.\/projectViewBehavior'/)
  assert.match(tree, /const syntheticRows = \(\) => visibleSyntheticNodes\(props\.synthetic \?\? \[\], sharedSortSettings\.value\.showScratchesAndConsoles\)/)
  assert.match(tree, /synthetic: syntheticRows,/, '模型拿到的必须是过滤后的那一份')
  assert.match(tree, /sharedSortSettings\.value\.showScratchesAndConsoles \?\? true,\n\s*treeHost\.value\.nesting\.enabled/,
    '这一格翻动要进那条「设置变更 ⇒ 整树重建」的 watch（上游 ProjectViewImpl.java:392-400 的 updatePanes(true)）')
})

test('编辑嵌套规则真的落回模型：设置页 → 宿主 → FileTree → 模型', () => {
  const state = read('../src/projectTreeState.ts')
  assert.match(state, /export function projectTreeHostFor/)
  assert.match(state, /bySettings\.set\(settingsView, host\)/)
  assert.match(state, /function updateNesting\(patch: \{ enabled\?: boolean; rules\?: readonly NestingRule\[\] \}\)/)
  const tree = read('../src/components/FileTree.vue')
  assert.match(tree, /nestingRules: \(\) => treeHost\.value\.nesting\.enabled \? treeHost\.value\.nesting\.rules : \[\]/)
  assert.match(tree, /compactDirs: \(\) => sharedSortSettings\.value\.compactDirectories \?\? false/)
  assert.match(tree, /treeHost\.value\.nesting\.rules\],\s*\n?\s*\(\) => \{ void model\.refresh\(\) \}/, '改设置要整树重建（ConfigureFilesNestingAction.kt:58）')
  const model = read('../src/projectTreeModel.ts')
  // 2026-10-07 epclose2：折叠前先过 `com.intellij.treeStructureProvider` EP（无 provider 时恒等），
  // 内建 `nestSiblings` 仍是那一步折叠本体。
  assert.match(model, /const providers = modifyProjectTreeChildren\(null, entries\.map\(toProviderNode\), \{/)
  assert.match(model, /return nestSiblings\(providers\.map\(fromProviderNode\), nestingRules\(\)\)/)
  assert.match(model, /const compactOf = \(entry: Entry\): Entry =>/)
})

test('嵌套对话框只在「确定」时落盘：勾选框不直接写设置（ConfigureFilesNestingAction.kt:54-57）', () => {
  const dialog = read('../src/components/FileNestingSettings.vue')
  assert.match(dialog, /const enabledNow = ref\(props\.enabled\)/)
  assert.match(dialog, /@change="enabledNow = !enabledNow"/)
  assert.doesNotMatch(dialog, /@change="emit\('apply'/, '上游是 reset 进对话框、apply 只在 showAndGet 为真时写回')
  assert.match(dialog, /validateNestingRows\(rows\.value, enabledNow\.value\)/)
  assert.match(dialog, /emit\('apply', enabledNow\.value \? \{ enabled: true, rules: nestingRulesOf\(rows\.value\) \} : \{ enabled: false \}\)/,
    '开关开着才 setRules（FileNestingInProjectViewDialog.java:235-245）')
  assert.match(dialog, /:disabled="!enabledNow"/, '规则面板的禁用态跟着本地开关（:76 的 UIUtil.setEnabled）')
  assert.match(dialog, /nestingRowsOf\(DEFAULT_NESTING_RULES\)/, '「重置为默认」铺的是出厂规则表（:174）')
})

test('压缩目录的链在取那一层列表时就算好，行不会先显示旧名再跳（本仓与上游不同的一处）', () => {
  const model = read('../src/projectTreeModel.ts')
  assert.match(model, /async function load\(entry: Entry, token: number\)[\s\S]*?const listing = await fetch\(entry, token\)[\s\S]*?await resolveChainsFor\(listing, token\)/)
  assert.match(model, /const listing = await fetch\(current, token\)/, '链自己只用 fetch，不用 load ⇒ 不会把整棵树预取')
  assert.match(model, /seen\.add\(raw\.path\)\s*\n\s*seen\.add\(entry\.path\)/, '刷新后合并行的展开态不能被 revalidate 误删')
  assert.match(model, /compacted\.clear\(\)/)
})

// 「递归展开 / 全部展开」开的是**任何有子行的行**，不是只开目录：
//   · 上游动作只经 `TreeExpander`：`ExpandRecursivelyAction.kt:29-31`（`expander.expandSelected()`）
//     与 `ProjectViewExpandAllAction.kt:17-22`（`expander.expandAll()`）；
//   · 实现里没有任何「是目录」的条件：`DefaultTreeExpander.kt:21-36` → `TreeUtil.java:1084`
//     （`promiseExpand(tree, depth, path -> depth < MAX || isIncludedInExpandAll(path))`）；
//   · 豁免由节点自己说：`AbstractTreeNode.java:138-140` 默认 `true`，
//     项目视图里唯一让开的是外部库那一条（`ExternalLibrariesNode.java:61-64`）；
//   · 带嵌套子文件的**文件行**就是一个有孩子的节点：`NestingTreeNode.java:43-51`
//     （`getChildrenImpl()` = 嵌套子文件 + 自己的），`isAlwaysShowPlus()` 恒 true（`:21-24`）。
// 「递归展开」这个按钮在本仓是活的（`src/components/ToolWindowView.vue:208`）。
test('规则表落盘形态照上游：一个父一条、(父,子) 去重、父升序（ProjectViewFileNestingService.java:102-103,149-158）', async () => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, value) },
    removeItem: key => { store.delete(key) },
  }
  const { getProjectTreeState } = await import('../src/projectTreeState.ts')
  const host = getProjectTreeState('D:/nest')
  // 设置页交来的是一张「一父一条」也可能被拆平成多条同父规则的表（`nestingRulesOf` 就是一条一对），
  // 上游存的那份是 `SortedList(comparing(parentFileSuffix))` + 按 (父,子) 去重（`NestingRule.equals`）。
  host.updateNesting({ rules: [
    { parent: '*.ts', children: ['*.js'] },
    { parent: '*.ts', children: ['*.css', '*.js', ''] },
    { parent: 'package.json', children: ['package.json', 'yarn.lock'] },
  ] })
  assert.deepEqual(host.nesting.rules, [
    { parent: '*.ts', children: ['*.css', '*.js'] },
    { parent: 'package.json', children: ['yarn.lock'] },
  ], '同父合并成一条、子按 `父 空格 子` 的次序、空后缀与父子相等的丢掉')
  const saved = JSON.parse(store.get('taocode.projectView.v1:' + encodeURIComponent('D:/nest')))
  assert.deepEqual(saved.nestingRules, host.nesting.rules, '存档里的那份就是这个形状')
  // 回读同样规范化：手改过的 ui.lnf.xml 式坏行（重复、同父拆平）不该把默认表挤掉。
  store.set('taocode.projectView.v1:' + encodeURIComponent('D:/back'), JSON.stringify({
    useFileNestingRules: true,
    nestingRules: [{ parent: 'a.ts', children: ['b.js'] }, { parent: 'a.ts', children: ['b.js', 'c.css'] }],
  }))
  assert.deepEqual(getProjectTreeState('D:/back').nesting.rules, [{ parent: 'a.ts', children: ['b.js', 'c.css'] }])
  // 坏行按没写处理（回落到默认表），不许按字段数量判整档损坏。
  store.set('taocode.projectView.v1:' + encodeURIComponent('D:/bad'), JSON.stringify({ nestingRules: [{ parent: 'a.ts', children: 'b.js' }] }))
  assert.deepEqual(getProjectTreeState('D:/bad').nesting.rules, DEFAULT_NESTING_RULES)
})

test('递归展开与全部展开也开「文件嵌套」的父行（不是只开目录）', async () => {
  const entries = [directory('src'), file('main.ts'), file('main.js'), file('main.css')]
  const settings = { sortKey: 'BY_NAME', foldersAlwaysOnTop: true, autoscrollToSource: false,
    autoscrollFromSource: false, openInPreviewTab: false }
  const model = createProjectTreeModel({
    entries: () => entries, synthetic: () => [], depth: () => 0, projectName: () => 'demo',
    sortSettings: () => settings, nestingRules: () => [{ parent: '*.ts', children: ['*.js', '*.css'] }],
    error: message => { throw new Error(message) },
  })
  model.children.set('src', [file('src/app.ts')])
  // 没有选中 ⇒ 递归展开什么都不开（上游 `canExpandSelected` 也要有选中，`DefaultTreeExpander.kt:42`）。
  await model.expandRecursively()
  assert.deepEqual(model.rows.value.map(row => row.entry.name), ['demo', 'src', 'main.ts'])
  model.select('main.ts')
  assert.equal(model.canExpandRecursively(), true, '选中的是「有嵌套子行的文件行」⇒ 这一格该可用')
  await model.expandRecursively()
  assert.deepEqual(model.rows.value.map(row => row.entry.name),
    ['demo', 'src', 'main.ts', 'main.css', 'main.js'], '父行是文件时也把它名下的嵌套子行开出来')
  // 全部展开同理：嵌套父行不是目录，但一样要被开（另起一个模型，不依赖上面那一次展开）。
  const bulk = createProjectTreeModel({
    entries: () => entries, synthetic: () => [], depth: () => 0, projectName: () => 'demo',
    sortSettings: () => settings, nestingRules: () => [{ parent: '*.ts', children: ['*.js', '*.css'] }],
    error: message => { throw new Error(message) },
  })
  bulk.children.set('src', [file('src/app.ts')])
  await bulk.expandAll()
  assert.deepEqual(bulk.rows.value.map(row => row.entry.name),
    ['demo', 'src', 'app.ts', 'main.ts', 'main.css', 'main.js'])
  const source = read('../src/projectTreeModel.ts')
  assert.match(source, /if \(entry\.kind !== 'directory'\) \{[\s\S]*?hasNested\(entry\.path\)/,
    '批量展开的目录判据必须在文件行这一支也让位给「有嵌套子行」')
})

// 「全部折叠」的保留层（`ptree3` 桶 §8.4 登记过这条缺陷、没跑改动）：上游那一格留开不是
// `DefaultTreeExpander` 定的，而是项目视图自己覆写的 —— pvtree5 复开过的坐标：
// `platform/lang-impl/src/com/intellij/ide/projectView/impl/AbstractProjectViewPane.java:803-806`
// （`super.collapseAll(tree, false, keepSelectionLevel)`，泛用那份 `DefaultTreeExpander.kt:53-55` 给的是
// strict=**true**）→ `platform/platform-api/src/com/intellij/util/ui/tree/TreeUtil.java:892-925`
// 的 `:911` `if (!strict && row == 0) break` ⇒ 只有**第 0 行**豁免折叠。
// 生产里第 0 行就是项目根（`src/App.vue:2101` 与 `src/components/ToolWindowView.vue:260` 都传
// `:project-name` ⇒ 恒有那一个合成根），所以「留住项目根那一格」= 留住第 0 行。
test('全部折叠留住顶层那一排，不是把项目根也一起收掉', async () => {
  const { model, errors } = mountedModel()
  await model.expandAll()
  assert.deepEqual(model.rows.value.map(row => row.entry.name),
    ['demo', 'docs', 'readme.md', 'src', 'components', 'ui', 'a.ts', 'b.ts', 'README.md'])
  model.select('src/components/ui/a.ts')
  model.collapseAll()
  assert.deepEqual(model.rows.value.map(row => row.entry.name), ['demo', 'docs', 'src', 'README.md'],
    '项目根这一格保持展开（它是 prohibited），底下的顶层行各占一行、都是收着的')
  assert.equal(model.selected.value, '', '选中退回那一格（上游 collapseAll 之后 internalSelect）')
  assert.deepEqual(errors, [], '全程不该去桥那边取新的目录')
  // 收起的那些深行里不能再有 a.ts 的祖先被留着
  assert.equal(model.rows.value.some(row => row.entry.name === 'components'), false)
})

// 没有项目根行的那一支（嵌入树）：`TreeUtil.java:899-900` 的 `if (!tree.isRootVisible()) minCount++`
// 只把「允许折叠的最小路径长度」往下挪一格，**留开的那一行仍然是第 0 行**（`:911` 的 break 按行号算）
// ⇒ 本仓这一支留住的是选中行所属的第一行（这里就是 `src`）。
// 已知分歧（登记在 `docs/wiring-requests-2026-10-06-pvtree5.md` R-3，本批不擅自改行为）：上游
// `:916` 的 `if (pathCount == minCount && row > 0) strict = true` 在**有多个顶层行**时（这里 `main.ts`
// 也是顶层行）会把 strict 翻成 true ⇒ 第 0 行也一起折掉；本仓 `collapseAll()` 留的是「选中行的
// 顶层祖先」。两者只在单项目根（= 生产形状）下等价。
test('嵌入树（没有项目根行）折叠时留住选中行所属的那一格', async () => {
  const entries = [directory('src'), file('main.ts')]
  const settings = { sortKey: 'BY_NAME', foldersAlwaysOnTop: true, autoscrollToSource: false,
    autoscrollFromSource: false, openInPreviewTab: false }
  const model = createProjectTreeModel({
    entries: () => entries, synthetic: () => [], depth: () => 0, projectName: () => undefined,
    sortSettings: () => settings, nestingRules: () => [], error: message => { throw new Error(message) },
  })
  model.children.set('src', [file('src/app.ts'), file('src/index.ts')])
  await model.expandAll()
  assert.deepEqual(model.rows.value.map(row => row.entry.name), ['src', 'app.ts', 'index.ts', 'main.ts'])
  model.select('src/app.ts')
  model.collapseAll()
  assert.deepEqual(model.rows.value.map(row => row.entry.name), ['src', 'app.ts', 'index.ts', 'main.ts'],
    'src 是第 0 行（上游 `TreeUtil.java:911` 那一支豁免）⇒ 它不进折叠表，名下那两行叶子照常看得见；main.ts 收成关')
  assert.equal(model.expanded.has('src'), true)
  assert.equal(model.expanded.has('main.ts'), false, '没被留住的那一格才是真的收起了')
})
