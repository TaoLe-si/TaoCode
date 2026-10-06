// `lp/hierarchy` 的范围收窄判据：五档范围、`isInScope` 谓词、过滤与计数提示
// （`HierarchyBrowserScopes` / `HierarchyTreeStructure.isInScope` 的本仓等价物）。
//
// 上游依据（逐条，与 `src/hierarchyScopes.ts` 文件头同源）：
//   · `platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyBrowserScopes.java:8-12`
//     —— 五个 scope 常量：Production / All / This Class / This Module / Test。
//   · `platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyTreeStructure.java:159-199`
//     —— `isInScope` 谓词：All 恒真、Production 非测试源、Test 测试源、This Class 同文件、This Module 同模块。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_HIERARCHY_SCOPE,
  HIERARCHY_SCOPES,
  filterNodesByScope,
  isKnownHierarchyScope,
  moduleDirectoryOf,
  nodeInScope,
  resolveHierarchyScope,
  scopeFilterFor,
  scopeNotice,
} from '../src/hierarchyScopes.ts'

const PROD = { path: 'src/main/java/App.java' }
const TEST = { path: 'src/test/java/AppTest.java' }
const OTHER_MODULE = { path: 'docs/notes.md' }

test('五档范围的键就是上游常量原值（不翻成中文键），默认档 = All', () => {
  const ids = HIERARCHY_SCOPES.map(entry => entry.id).sort()
  assert.deepEqual(ids, ['All', 'Production', 'Test', 'This Class', 'This Module'].sort(),
    '档位集合必须与 HierarchyBrowserScopes 的五个常量一一对应')
  assert.equal(DEFAULT_HIERARCHY_SCOPE, 'All')
  // 每档都得有非空呈现名，且互不重复。
  const labels = HIERARCHY_SCOPES.map(entry => entry.label)
  for (const label of labels) assert.ok(label && label.trim(), '呈现名不能为空')
  assert.equal(new Set(labels).size, labels.length)
})

test('nodeInScope：All 放行、Production 排测试源、Test 只留测试源、空路径一律不进', () => {
  assert.equal(nodeInScope(PROD, 'All', PROD), true)
  assert.equal(nodeInScope(TEST, 'All', PROD), true)
  assert.equal(nodeInScope(PROD, 'Production', null), true, '生产路径在生产档')
  assert.equal(nodeInScope(TEST, 'Production', null), false, '测试路径不在生产档（TestSourcesFilter）')
  assert.equal(nodeInScope(TEST, 'Test', null), true)
  assert.equal(nodeInScope(PROD, 'Test', null), false)
  assert.equal(nodeInScope({ path: '' }, 'All', null), false, '空路径 = 解析不出文件，任何档都不画')
})

test('This Class = 与根同文件；This Module = 与根同一级目录；根为 null 的兜底各按上游', () => {
  const base = PROD
  assert.equal(nodeInScope({ path: 'src/main/java/App.java' }, 'This Class', base), true, '同文件')
  assert.equal(nodeInScope({ path: 'src/main/java/Other.java' }, 'This Class', base), false, '同目录不同文件也不算本类')
  assert.equal(nodeInScope(base, 'This Class', null), false, '没有根 ⇒ This Class 无从谈起（上游 thisClass==null 不收）')

  assert.equal(nodeInScope({ path: 'src/other/File.java' }, 'This Module', base), true, '同为 src 一级目录')
  assert.equal(nodeInScope(OTHER_MODULE, 'This Module', base), false, 'docs 与 src 不同模块')
  assert.equal(nodeInScope(OTHER_MODULE, 'This Module', null), true, '没有根 ⇒ 不收窄（与上游兜底一致）')
})

test('未知档位当作命名作用域：没有宿主就返回 false（不收，也不误伤全部）', () => {
  assert.equal(nodeInScope(PROD, 'Project and Libraries', PROD), false)
})

test('filterNodesByScope：保序过滤、非法档位退回默认而不是清成空表', () => {
  const all = [PROD, TEST, OTHER_MODULE, { path: '' }]
  assert.deepEqual(filterNodesByScope(all, 'All', null), [PROD, TEST, OTHER_MODULE], 'All 只滤掉空路径，其余保序')
  assert.deepEqual(filterNodesByScope(all, 'Production', null), [PROD, OTHER_MODULE])
  assert.deepEqual(filterNodesByScope(all, 'Test', null), [TEST])
  // 未知档 ⇒ 退回默认 All ⇒ 结果与 All 相同，绝不为空。
  assert.deepEqual(filterNodesByScope(all, '不存在的档', null), [PROD, TEST, OTHER_MODULE])
})

test('moduleDirectoryOf：反斜杠与 ./ 前缀归一，单段路径没有模块目录', () => {
  assert.equal(moduleDirectoryOf('src/main/java/App.java'), 'src')
  assert.equal(moduleDirectoryOf('./src/a.ts'), 'src', '去掉 ./ 前缀')
  assert.equal(moduleDirectoryOf('src\\main\\App.java'), 'src', '反斜杠归一')
  assert.equal(moduleDirectoryOf('README.md'), '', '只有一段 ⇒ 无一级目录')
})

test('scopeNotice：用呈现名 + "kept / total"，未知档退回**默认档**的呈现名', () => {
  assert.equal(scopeNotice('Production', 3, 5), '生产代码：3 / 5')
  assert.equal(scopeNotice('All', 5, 5), '全部：5 / 5')
  assert.equal(scopeNotice('没有这一档', 1, 2), '全部：1 / 2', '未知档与 filterNodesByScope 同一条兜底：按默认档报')
})

// ——— W-2：范围**求值**的纯函数（宿主契约，判断一行都不许长在模板里）———

test('下拉的先后 = 上游 getValidScopes() 的那一份，不是 getPresentableNameMap() 的装入序', () => {
  // `HierarchyBrowserBaseEx.java:770-776`（建列表）与 `:811-813`（按序加进下拉）
  assert.deepEqual(HIERARCHY_SCOPES.map(entry => entry.id),
    ['Production', 'Test', 'All', 'This Class', 'This Module'])
  assert.equal(HIERARCHY_SCOPES[0].id, 'Production', '第一项是 Production（`ProjectProductionScope.INSTANCE`，`:772`）')
  assert.equal(HIERARCHY_SCOPES[2].id, 'All', 'All 在第三位（`:774`）')
  assert.equal(DEFAULT_HIERARCHY_SCOPE, 'All', '默认档仍是 All（`:165` 的 `state.SCOPE == null` 兜底）')
})

test('scopeFilterFor(scope, base) 是个纯谓词：同一档对同一节点的答案与 nodeInScope 一字不差', () => {
  const inProduction = scopeFilterFor('Production', PROD)
  assert.equal(typeof inProduction, 'function')
  for (const node of [PROD, TEST, OTHER_MODULE]) {
    assert.equal(inProduction(node), nodeInScope(node, 'Production', PROD))
  }
  assert.equal(inProduction(TEST), false, '测试源不进生产档')
  // 同一档、不同的 base ⇒ 结果跟着变（This Class 按根节点比）
  assert.equal(scopeFilterFor('This Class', PROD)(PROD), true)
  assert.equal(scopeFilterFor('This Class', TEST)(PROD), false)
  // 没有 base（还没根节点）也不炸
  assert.equal(scopeFilterFor('This Module', null)(OTHER_MODULE), true)
})

test('scopeFilterFor 认不出的档位退回默认档，绝不当成"全不收"（下拉被手改/旧存档第六档）', () => {
  for (const bad of ['', 'all', 'Named Scope', 'Project and Libraries']) {
    assert.equal(isKnownHierarchyScope(bad), false, `${bad} 不是这五档之一`)
    assert.equal(scopeFilterFor(bad, PROD)(PROD), true, `${bad} ⇒ 默认档 All ⇒ 照常画`)
    assert.equal(scopeFilterFor(bad, PROD)(TEST), true, '默认档不收测试源')
  }
  assert.equal(resolveHierarchyScope('This Class'), 'This Class')
  assert.equal(resolveHierarchyScope('Nope'), DEFAULT_HIERARCHY_SCOPE)
})

test('filterNodesByScope 走的就是 scopeFilterFor 那一份求值（一处规则两份入口）', () => {
  const all = [PROD, TEST, OTHER_MODULE]
  assert.deepEqual(filterNodesByScope(all, 'Test', null), all.filter(scopeFilterFor('Test', null)))
  assert.deepEqual(filterNodesByScope(all, 'Production', null), all.filter(scopeFilterFor('Production', null)))
})

test('接线：hierarchyView 用 nodeInScope 过滤每一行、用 scopeNotice 出计数提示、切档只走白名单', () => {
  const view = readFileSync('src/hierarchyView.ts', 'utf8')
  assert.ok(view.includes("from './hierarchyScopes.ts'"), '视图没有引入范围模块')
  assert.ok(view.includes('if (!nodeInScope(entry.node.item, hierScope.value, base)) continue'),
    'hierRows 没有按范围过滤节点')
  assert.ok(view.includes('computed(() => scopeNotice('), '计数提示没有走 scopeNotice')
  assert.ok(view.includes('if (!HIERARCHY_SCOPES.some(entry => entry.id === scope)) return'),
    '切档没有做白名单校验（切到未知档会污染状态）')
})
