// 层级树的**行模型 + 范围适用面**（W-2 模块侧契约那一半，判据前缀 HIERLEVEL）。
//
// 上游依据（逐条在本批自己 find + 打开过，参考树 =
// `D:/Backup/Downloads/intellij-community-master/intellij-community-master`）：
//   · 范围的档：`platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyBrowserScopes.java:8-12`
//     （五档常量）与 `HierarchyBrowserBaseEx.java:770-776`（`getValidScopes()` 的先后）、
//     `:811-812`（按那一份序 `group.add(new MenuAction(namedScope))`）；
//   · 每档两处判定：`HierarchyTreeStructure.java:132-158`（查询侧 `getSearchScope`）与
//     `:161-199`（逐节点 `isInScope`）—— 「生产代码」那一档有两个条件（`:175` 工程内 + `:177` 非测试源）；
//   · 范围动作**按视图注册**：`CallHierarchyBrowserBase.java:61`、`MethodHierarchyBrowserBase.java:85`、
//     `TypeHierarchyBrowserBase.java:89-94`（**不加**）；Java 的类型层次自己加但把「父类型」那一向禁用
//     （`java/java-impl/src/com/intellij/ide/hierarchy/type/TypeHierarchyBrowser.java:47-54` 的
//     `isEnabled()`），Kotlin 同写法（`KotlinTypeHierarchyBrowser.kt:34-40`）；
//     判定源也对得上：`SubtypesHierarchyTreeStructure.java:47` 用 `getSearchScope(myCurrentScopeType,…)`，
//     `SupertypesHierarchyTreeStructure.java` 全文零 scope 引用；
//   · 每 sheet 一档：`HierarchyBrowserBaseEx.java:820-826` 的 `selectScope`
//     （`myType2Sheet.get(getCurrentViewType()).myScope = scopeType` + 写应用级 `SCOPE` + `doRefresh(true)`）；
//   · 展开态跨重建：`:596-605` `saveCurrentTreeState` + `:607-615` `restoreTreeState`
//     + `:616-647` `doRefresh` 把这一对夹在重建两侧。
//   · 库文件的 `path` 形态：`native/lsp_host_bootstrap.cpp:18-31` 的 `uri_to_relative` ——
//     只有落在工作区根**内**才剥成相对路径，根外原样返回绝对路径（`src/filenameWidget.ts:145` 那份判定）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHierarchyView } from '../src/hierarchyView.ts'
import {
  DEFAULT_HIERARCHY_SCOPE, HIERARCHY_SCOPES, hierarchyScopeSupport, isHierarchyScopeSelectable, nodeInScope,
} from '../src/hierarchyScopes.ts'
import {
  captureHierarchyExpansion, hierarchyItemKey, hierarchyNodePath, hierarchyRowIds, hierarchyVisibleNodeCount, planHierarchyExpansion,
} from '../src/hierarchyRows.ts'
import { hierarchyRowModel } from '../src/hierarchyRenderer.ts'
import { usageTreeToggleLabel } from '../src/usageViewTreeModel.ts'

const deps = { notify: () => {}, bottom: () => true, setBottom: () => {}, showOutput: () => {}, loading: () => true }

// ---------------------------------------------------------------- 范围的适用面（假控件那一档）

test('HIERLEVEL 范围适用面：调用层次两向、类型层次·子类型有档；类型层次·父类型**空表**', () => {
  const callIncoming = hierarchyScopeSupport('call', 'incoming')
  assert.equal(callIncoming.supported, true)
  assert.equal(callIncoming.tiers, HIERARCHY_SCOPES, '支持的向必须还是那一份表（引用相等，不是复制）')
  assert.equal(hierarchyScopeSupport('call', 'outgoing').supported, true)
  assert.equal(hierarchyScopeSupport('type', 'subtypes').supported, true)
  const supertypes = hierarchyScopeSupport('type', 'supertypes')
  // 上游这一向把动作 isEnabled()=false，结构类零判定源 ⇒ 空表，不是"退回全部五档"。
  assert.equal(supertypes.supported, false)
  assert.deepEqual(supertypes.tiers, [], '不支持的向必须空表（给了就是假控件）')
  assert.ok(supertypes.reason.includes('TypeHierarchyBrowser.java'), '理由里必须给得出上游坐标')
})

test('HIERLEVEL 父类型那一向任何档都不可选；其余向五档都可选', () => {
  for (const entry of HIERARCHY_SCOPES) {
    assert.equal(isHierarchyScopeSelectable(entry.id, 'type', 'supertypes'), false, `${entry.id} 在父类型向不该可选`)
    assert.equal(isHierarchyScopeSelectable(entry.id, 'call', 'incoming'), true)
  }
  assert.equal(isHierarchyScopeSelectable('Nope', 'call', 'incoming'), false, '未知档（命名作用域）本仓没有宿主')
})

test('HIERLEVEL「生产代码」两个条件都齐：库/绝对路径不进，测试源不进，工程内非测试源才进', () => {
  const base = { path: 'src/main/java/App.java' }
  assert.equal(nodeInScope({ path: 'C:/Users/dev/.m2/java/lang/String.java' }, 'Production', base), false,
    '上游 :175 那一半：编译元素不在工程里就不留（本仓 = 绝对路径）')
  assert.equal(nodeInScope({ path: '/usr/lib/jvm/java/lang/Object.java' }, 'Production', base), false)
  assert.equal(nodeInScope({ path: 'src/test/java/AppTest.java' }, 'Production', base), false,
    '上游 :177 那一半：测试源不留')
  assert.equal(nodeInScope(base, 'Production', base), true)
  // 其余四档不许被这一改动带偏：All 仍放行、Test 仍只留测试源、本类/本模块仍按路径。
  assert.equal(nodeInScope({ path: 'C:/x/Y.java' }, 'All', base), true)
  assert.equal(nodeInScope({ path: 'C:/x/test/YTest.java' }, 'Test', base), true, '测试档不额外要求工程内（上游 :178-181 也没有）')
  assert.equal(nodeInScope({ path: 'C:/x/Y.java' }, 'This Class', base), false)
})

// ---------------------------------------------------------------- 行的身份 / 计数

test('HIERLEVEL 内容键 = path+name+kind+line+character 五元组，一个字段变了就是另一行', () => {
  const item = { path: 'src/a.ts', name: 'go', kind: 6, line: 3, character: 8 }
  assert.equal(hierarchyItemKey(item), JSON.stringify(['src/a.ts', 'go', 6, 3, 8]))
  assert.notEqual(hierarchyItemKey({ ...item, line: 4 }), hierarchyItemKey(item))
})

test('HIERLEVEL 行 id：内容派生（重排不变）+ 同一份内容的第二遍出现追加 NUL#次', () => {
  const keys = ['K1', 'K2', 'K1']
  assert.deepEqual(hierarchyRowIds(keys), ['K1', 'K2', `K1${String.fromCharCode(0)}#1`])
  // 重排（刷新后同级先后变了）⇒ 每个键还是它自己，不带下标。
  assert.deepEqual(hierarchyRowIds(['K2', 'K1']), ['K2', 'K1'])
  assert.deepEqual(hierarchyRowIds(['K1', 'K1', 'K1'])[2], `K1${String.fromCharCode(0)}#2`)
})

test('HIERLEVEL 可见节点计数只数展开着的那一支（未加载的不算进分母）', () => {
  const leaf = name => ({ item: { path: 'src/a.ts', name, kind: 6 }, ancestors: ['root'], children: null, expanded: false })
  const mid = { ...leaf('Mid'), expanded: true, children: [leaf('X'), leaf('Y')] }
  assert.equal(hierarchyVisibleNodeCount([mid]), 3, '根一层 + 展开后那两个')
  assert.equal(hierarchyVisibleNodeCount([{ ...mid, expanded: false }]), 1, '收起时子树不进账')
  assert.equal(hierarchyVisibleNodeCount([]), 0)
})

// ---------------------------------------------------------------- 展开态跨重建沿用

function node(path, name, extra = {}) {
  return {
    item: { path, name, kind: 5, line: 0, character: 0 },
    parentPath: '', ancestors: extra.ancestors ?? ['root'], children: extra.children ?? null,
    expanded: extra.expanded ?? false, loading: false, recursive: false, error: '',
  }
}

test('HIERLEVEL capture 只抓展开着的那些节点，路径 = 祖先键 + 自己的键', () => {
  const key = item => hierarchyItemKey(item)
  const mid = node('src/a.ts', 'Mid', { expanded: true, ancestors: ['base'] })
  // 展开着的：mid（它的下级 leaf 已经挂上）；leaf 自己没收 ⇒ 只有一条账，但路径要能定位到 leaf。
  const leaf = node('src/a.ts', 'Leaf', { ancestors: ['base', key(mid.item)] })
  mid.children = [leaf]
  const collapsed = node('src/b.ts', 'Other', { expanded: false })
  const captured = captureHierarchyExpansion([mid, collapsed])
  assert.equal(captured.length, 1, '收起着的那一支不进账')
  assert.deepEqual(captured[0], hierarchyNodePath(mid), '抓下来的就是那一条路径（配方只有一份）')
  assert.deepEqual(captured[0].slice(1), [key(mid.item)], 'mid 的路径 = 祖先键(base) + 自己的键')
  // 深层：leaf 也展开时两条账，第二条要带上父键（复原时按这一串一层层认）。
  leaf.expanded = true
  leaf.children = []
  const deep = captureHierarchyExpansion([mid])
  assert.equal(deep.length, 2)
  assert.deepEqual(deep[1], ['base', key(mid.item), key(leaf.item)])
})

test('HIERLEVEL plan：认回来的展开、没取过下级的进 load、认不到的整条丢掉', () => {
  const root = node('src/a.ts', 'Root')
  const key = item => hierarchyItemKey(item)
  const savedPath = ['base', key(root.item)]
  const first = planHierarchyExpansion([root], [savedPath])
  assert.deepEqual(first.expand, [root], '根下那一层认得回来')
  assert.deepEqual(first.load, [root], 'children 还没取过 ⇒ 要补一次查询（上游 promiseExpand 沿途取）')
  assert.equal(first.dropped, 0)
  // 已经取过下级的：直接往下认，不再进 load。
  const child = node('src/a.ts', 'Child')
  root.children = [child]
  const second = planHierarchyExpansion([root], [['base', key(root.item), key(child.item)]])
  assert.equal(second.expand.length, 2, '父与子都认回来了（一路往下）')
  assert.deepEqual(second.expand, [root, child])
  assert.deepEqual(second.load, [child],
    'root 的下级已经在树上不再补查；child 自己没取过下级 ⇒ 要补一次（上游 promiseExpand 就是沿途取）')
  // 认不到的路径不贴（换根/结果变少那一类），也不留垃圾。
  const third = planHierarchyExpansion([root], [['base', 'no-such-key']])
  assert.deepEqual(third.expand, [])
  assert.equal(third.dropped, 1)
})

// ---------------------------------------------------------------- 视图装配（宿主读到的那一面）

test('HIERLEVEL 视图：父类型方向没有下拉、任何档都写不进去；换回子类型时用户那档还在', () => {
  const view = createHierarchyView(deps)
  assert.equal(view.hierScopeSupported.value, true, '默认是调用层次·调用方')
  view.hierKind.value = 'type'
  view.hierDirection.value = 'supertypes'
  assert.equal(view.hierScopeSupported.value, false)
  assert.deepEqual(view.hierScopeOptions.value, [], '空表 = 界面上不该有这只下拉')
  assert.equal(view.hierScope.value, DEFAULT_HIERARCHY_SCOPE, '不支持的那一向恒等于默认档（= 不收窄）')
  view.setHierarchyScope('Test')
  assert.equal(view.hierScope.value, DEFAULT_HIERARCHY_SCOPE, '这一向根本写不进状态')
  view.hierDirection.value = 'subtypes'
  assert.equal(view.hierScopeSupported.value, true)
  assert.equal(view.hierScopeOptions.value, HIERARCHY_SCOPES, '选项表还是那一份，不是视图自己列的')
  view.pickHierarchyScope('Production')
  assert.equal(view.hierScope.value, 'Production')
  view.hierDirection.value = 'supertypes'
  assert.equal(view.hierScope.value, DEFAULT_HIERARCHY_SCOPE)
  // 上游 selectScope 的"scope is kept per type"：切回来还是用户上一回选的那档。
  view.hierDirection.value = 'subtypes'
  assert.equal(view.hierScope.value, 'Production')
  // 调用层次这一 sheet 上一回没选过 ⇒ 初始档 = "最后一次选的档"，**不是**退回默认
  // （上游 `HierarchyBrowserBaseEx.java:822` 的 selectScope 同时把当前档写进应用级 `SCOPE`，
  // `:165` 再拿它当新 sheet 的初始档）。
  view.hierKind.value = 'call'
  view.hierDirection.value = 'incoming'
  assert.equal(view.hierScope.value, 'Production', '新 sheet 从应用级那一档起（上游 settings.SCOPE）')
  view.pickHierarchyScope('This Class')
  assert.equal(view.hierScope.value, 'This Class')
  // 另一个没选过的 sheet（同类型、换方向）也从"最后一次选的档"起 ——
  // 上游 `selectScope` 就是两处一起写（sheet 一份 + 应用级一份），新 sheet 读应用级那一格。
  view.hierDirection.value = 'outgoing'
  assert.equal(view.hierScope.value, 'This Class')
  view.pickHierarchyScope('All')
  // 选过的 sheet 记自己的那份，不被别的 sheet 污染。
  view.hierDirection.value = 'incoming'
  assert.equal(view.hierScope.value, 'This Class')
})

test('HIERLEVEL 每一行都带稳定 id（宿主可以拿它当 :key）', () => {
  const view = createHierarchyView(deps)
  const root = node('src/a.ts', 'Root')
  root.children = null
  root.expanded = true
  const child = node('src/a.ts', 'Child')
  root.children = [child, { ...child }]   // 同一个符号出现两遍（菱形继承那一类）
  view.hierItems.value = [root]
  const ids = view.hierRows.value.map(row => row.id)
  assert.equal(ids.length, 3, '根 + 展开后的两个下级')
  assert.equal(ids[0], hierarchyItemKey(root.item))
  assert.equal(ids[1], hierarchyItemKey(child.item))
  assert.equal(view.hierRows.value[2].id, `${hierarchyItemKey(child.item)}${String.fromCharCode(0)}#1`,
    '同一份内容的第二遍出现要带出现次后缀')
  assert.equal(new Set(ids).size, ids.length, 'id 不许撞')
})

test('HIERLEVEL 折叠按钮文案与用法树同一份规则（不留第二遍写法）', () => {
  assert.equal(hierarchyRowModel(node('src/a.ts', 'Go', { expanded: true })).toggleLabel,
    usageTreeToggleLabel(false, 'Go'))
  assert.equal(hierarchyRowModel(node('src/a.ts', 'Go')).toggleLabel, usageTreeToggleLabel(true, 'Go'))
  const source = readFileSync('src/hierarchyRenderer.ts', 'utf8')
  assert.ok(source.includes("import { usageTreeToggleLabel } from './usageViewTreeModel.ts'"),
    '呈现模块没有引共用那份文案规则')
  assert.equal(/toggleLabel: `\$\{node\.expanded/.test(source), false, '「展开/收起」的第二份拼法又回来了')
})

test('HIERLEVEL 接线：视图真的走行模型那三样（id / 计数 / 展开态沿用）', () => {
  const view = readFileSync('src/hierarchyView.ts', 'utf8')
  assert.ok(view.includes("from './hierarchyRows.ts'"), '视图没有引入行模型')
  assert.ok(view.includes('const ids = hierarchyRowIds(rows.map(entry => entry.key))'), '行没有补稳定 id')
  assert.ok(view.includes('hierarchyVisibleNodeCount(hierItems.value)'), '范围提示的分母没有走单份计数')
  assert.ok(view.includes('const savedExpansion = captureHierarchyExpansion(hierItems.value)'),
    '重建前没有抓展开态（用户展开的整棵树会被丢掉）')
  assert.ok(view.includes('await applyHierarchyExpansion(savedExpansion, generation)'),
    '重建后没有贴回展开态')
  assert.ok(view.includes('const matched = HIERARCHY_SCOPES.find(entry => entry.id === value)'),
    '字符串档位没有白名单校验')
})
