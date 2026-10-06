// 层级面板**范围下拉**的宿主契约（原请求 W-2 的模块侧那一半）。
//
// 判词 `lp/hierarchy` 的「范围收窄」在 `src/hierarchyScopes.ts` 早做完了（五档 id + `isInScope` 谓词
// + 计数提示，判据 `tests/hierarchy-scopes.test.mjs`），缺的是**面板上没有一个能切档的控件**。
// 控件本体在 `src/App.vue`（冻结，归 `appvue`）—— 本批把宿主模板需要的东西补齐，让那一条
// `<select>` 不用在事件表达式上写 `as`：
//   · `hierScopeOptions`：下拉的选项（顺序 = `HierarchyBrowserBaseEx.java:770-776` 的
//     `getValidScopes()`、`:811-813` 一条一条加进下拉；呈现名 = 各 scope 的
//     `getPresentableName()` 与 `LangBundle.properties:348`/`:349`，五档 id =
//     `HierarchyBrowserScopes.java:8-12`，都收在 `src/hierarchyScopes.ts`）；
//   · `setHierarchyScope(value: string)`：`<select>` 的 `@change` 直接给字符串，白名单校验在模块里
//     （与 `pickHierarchyScope`、`hierarchyScopes.ts:91-94` 的 `filterNodesByScope` 同一条口径 ——
//     非法档位整档不动，不是退回默认、更不是清空列表）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHierarchyView } from '../src/hierarchyView.ts'
import { DEFAULT_HIERARCHY_SCOPE, HIERARCHY_SCOPES } from '../src/hierarchyScopes.ts'

const deps = { notify: () => {}, bottom: () => true, setBottom: () => {}, showOutput: () => {}, loading: () => true }

test('hierScopeOptions 就是上游那五档，顺序与呈现名同源', () => {
  const view = createHierarchyView(deps)
  // 顺序 = 上游下拉的那一份：`HierarchyBrowserBaseEx.java:770-776` 的 `getValidScopes()`
  // （Production → Tests → All → This Class → This Module，`:811-813` 按这个序一条一条加进弹出组）。
  // 原先钉的是 `:235-243` 那个 `getPresentableNameMap()` 的装入序 —— 那是 HashMap，不是下拉。
  assert.deepEqual(view.hierScopeOptions.value.map(entry => entry.id),
    ['Production', 'Test', 'All', 'This Class', 'This Module'])
  assert.deepEqual(view.hierScopeOptions.value.map(entry => entry.label),
    ['生产代码', '测试', '全部', '本类', '本模块'])
  assert.deepEqual(view.hierScopeOptions.value, HIERARCHY_SCOPES, '选项表只有一份（面板不许自己再列一遍）')
  assert.equal(view.hierScope.value, DEFAULT_HIERARCHY_SCOPE, '默认档 = All（上游 HierarchyTreeStructure 的初始 scopeType）')
})

test('setHierarchyScope 吃字符串：白名单内就切档，白名单外整档不动', () => {
  const view = createHierarchyView(deps)
  view.setHierarchyScope('Production')
  assert.equal(view.hierScope.value, 'Production')
  view.setHierarchyScope('This Class')
  assert.equal(view.hierScope.value, 'This Class')
  // 非法值（手改 DOM、旧存档里的第六档、空串）一律不收 —— 收窄失败不该把列表清成空的。
  for (const bad of ['Nope', '', 'all', 'named scope']) {
    view.setHierarchyScope(bad)
    assert.equal(view.hierScope.value, 'This Class', `${bad} 不该动档位`)
  }
  view.setHierarchyScope('All')
  assert.equal(view.hierScope.value, 'All')
})

test('计数提示跟着档位走（面板标题尾巴就是它）', () => {
  const view = createHierarchyView(deps)
  view.setHierarchyScope('Test')
  assert.equal(view.hierScopeNotice.value, '测试：0 / 0', '空树也给得出提示，宿主不必自己拼数字')
})

test('接线：两个新出口都在 createHierarchyView 的返回值里，类型化的 pickHierarchyScope 仍留着', () => {
  const view = createHierarchyView(deps)
  assert.equal(typeof view.setHierarchyScope, 'function')
  assert.equal(typeof view.pickHierarchyScope, 'function', '菜单/命令那一路仍按类型化入口调用')
  assert.ok('hierScopeOptions' in view && 'hierScopeNotice' in view && 'hierScope' in view)
  const source = readFileSync('src/hierarchyView.ts', 'utf8')
  assert.ok(source.includes('const hierScopeOptions = computed(() => HIERARCHY_SCOPES)'),
    '选项表必须是同一份 HIERARCHY_SCOPES，不是在视图里再写一遍')
})
