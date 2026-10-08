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
  // 留痕（原钉 X、实际 Y）：这一条原来钉的是字面量 `const hierScopeOptions = computed(() => HIERARCHY_SCOPES)`，
  // 它的**意思**是"表只有一份、视图不许自己再列一遍"（就是那条 message）。本批把选项表改成**按视图/方向给**
  // （上游的范围动作本来就是一只一只视图注册的，见 `src/hierarchyScopes.ts` 文件头那段），
  // 字面量随之变了；这里不放松，改成**更强**的两条：
  //   · 表必须仍然**是那一份数组本身**（引用相等，不是 deepEqual 的形状相等）；
  //   · 取表这一步必须走 `hierarchyScopeSupport`（= 判定在模块里，不在视图里另列）。
  assert.equal(view.hierScopeOptions.value, HIERARCHY_SCOPES, '选项表还是那份 HIERARCHY_SCOPES（引用相等）')
  assert.ok(source.includes('const hierScopeOptions = computed(() => hierScopeSupport.value.tiers)'),
    '选项表没有走 hierarchyScopeSupport（在自己列档 = 漂的第二份表）')
  assert.ok(source.includes('const hierScopeSupported = computed(() => hierScopeSupport.value.supported)'),
    '宿主读不到"这一向到底该不该有这只下拉"')
})

test('接线：宿主把那一档控件摆进层级工具条（模块侧能用不等于界面上有）', () => {
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  assert.match(app, /hierScope, hierScopeOptions, hierScopeNotice, hierScopeSupported, setHierarchyScope,/,
    '解构里必须带上那四个名字（`hierScopeSupported` 见 hierlevel H-1），否则模板拿不到')
  assert.match(app, /const pickHierScope = \(event: Event\) => setHierarchyScope\(\(event\.target as HTMLSelectElement\)\.value\)/,
    '窄化放在脚本里（模板里的 $event.target 是 EventTarget | null，vue-tsc 过不去）')
  assert.match(app, /<select :value="hierScope" @change="pickHierScope">/, '下拉绑当前档，不是写死第一档')
  assert.match(app, /<option v-for="entry in hierScopeOptions" :key="entry\.id" :value="entry\.id">\{\{ entry\.label \}\}<\/option>/,
    '选项来自 hierScopeOptions（= HIERARCHY_SCOPES 那一份），模板里没有另抄五档')
  assert.match(app, /:title="hierScopeNotice">范围/, '计数提示走模块那份 scopeNotice，不在模板里再算一遍')
  // hierlevel H-1：父类型向（上游 `isEnabled()` = false）整只下拉不渲染 —— 不放假控件。
  assert.match(app, /<label v-if="hierScopeSupported" class="call-direction" :title="hierScopeNotice">范围/,
    '不支持的档位整段不渲染（`hierarchyScopeSupport.supported` 的宿主落点）')
})
