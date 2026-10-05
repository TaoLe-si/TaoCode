// 项目视图齿轮「外观」那一组的两条用户可见行为：**可编辑的文件嵌套规则**（上游
// `ProjectView.FileNesting` = `ConfigureFilesNestingAction`）与**压缩目录**
// （上游 `ProjectView.CompactDirectories`）。判据 = 上游坐标 + 本仓的真实渲染结果。
//
// 上游坐标（细节推导都写在 `src/projectTreeCompactDirs.ts` / `src/projectTreeState.ts` 的模块头）：
//   · `platform/projectView/shared/resources/intellij.platform.projectView.xml:56-105`（Appearance 组）
//     与 `:106-130`（Sort 组）—— Appearance 组在 Sort 组之前；
//   · `:98-99` `ProjectView.CompactDirectories`、`:101-102` `ProjectView.FileNesting`；
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

test('齿轮里的两格：文件嵌套… 与 压缩目录，且 Appearance 组排在 Sort 组之前', () => {
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
  assert.match(model, /nestSiblings\(entries, nestingRules\(\)\)/)
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
