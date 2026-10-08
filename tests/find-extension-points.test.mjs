// 判据 · 查找域的扩展点宿主（`src/findExtensionPoints.ts` + `src/findScopeSelection.ts` 的接线）——
// 上游 `com.intellij.findInProjectExtension` / `com.intellij.findInDirectoryScopeProvider`
// 的同名方法面。
//
// 钉五件事：
//   ① 两条 EP id 逐字等于上游 qualifiedName，且已声明；
//   ② `initModelFromContext` 的聚合问法「任一条返回 true 就认为改过」；
//   ③ `getFilteredNamedScopes` 的聚合问法与**真实消费侧**：`resolveScopeSelection` 真的会
//      因一条贡献看不见某个作用域（名字失配 ⇒ 回落「项目」，与上游 `NamedScopesHolder.getScope`
//      返回 null 同口径）；
//   ④ `alterDirectorySearchScope` 逐个改写（前一个的输出是后一个的输入）；
//   ⑤ 没有贡献时行为与从前一字不差。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  FIND_IN_DIRECTORY_SCOPE_PROVIDER_EP, FIND_IN_PROJECT_EXTENSION_EP, alterDirectorySearchScope,
  applyFindModelExtensions, declareFindExtensionPoints, filterNamedScopes, findInDirectoryScopeProviders,
  findInProjectExtensions, registerFindInDirectoryScopeProvider, registerFindInProjectExtension,
  unregisterFindInDirectoryScopeProvider, unregisterFindInProjectExtension,
} from '../src/findExtensionPoints.ts'
import { EXTENSIONS } from '../src/extensionPoints.ts'
import { resolveScopeSelection } from '../src/findScopeSelection.ts'

const root = new URL('../', import.meta.url)
const read = rel => readFileSync(new URL(rel, root), 'utf8')

const model = (over = {}) => ({
  text: '', caseSensitive: false, wholeWords: false, regex: false, scopeName: '', directory: '', ...over,
})
const context = (over = {}) => ({ root: '/w', path: '', selectedText: '', ...over })
const scopes = [
  { name: '生产代码', pattern: 'file:src//*' },
  { name: '测试', pattern: 'file:*Test*' },
]

test('两条 EP id 逐字取自上游 qualifiedName，且已声明', () => {
  assert.equal(FIND_IN_PROJECT_EXTENSION_EP, 'com.intellij.findInProjectExtension')
  assert.equal(FIND_IN_DIRECTORY_SCOPE_PROVIDER_EP, 'com.intellij.findInDirectoryScopeProvider')
  assert.ok(EXTENSIONS.hasExtensionPoint(FIND_IN_PROJECT_EXTENSION_EP), 'findInProjectExtension 应已声明')
  assert.ok(EXTENSIONS.hasExtensionPoint(FIND_IN_DIRECTORY_SCOPE_PROVIDER_EP), 'findInDirectoryScopeProvider 应已声明')
  declareFindExtensionPoints()
  declareFindExtensionPoints()
  assert.deepEqual(findInProjectExtensions(), [], '没有贡献时 EP 上应是空的')
  assert.deepEqual(findInDirectoryScopeProviders(), [])
})

test('initModelFromContext：任一条返回 true 就认为模型被改过', () => {
  const before = applyFindModelExtensions(model({ text: 'foo' }), context())
  assert.equal(before.changed, false)
  assert.equal(before.model.text, 'foo')

  const h1 = registerFindInProjectExtension({
    id: 'test.selection', initModelFromContext: (m, ctx) => (ctx.selectedText ? true : false),
  })
  const h2 = registerFindInProjectExtension({
    id: 'test.dir', initModelFromContext: m => (m.directory ? true : false),
  })
  assert.equal(applyFindModelExtensions(model(), context({ selectedText: 'bar' })).changed, true)
  assert.equal(applyFindModelExtensions(model({ directory: 'src' }), context()).changed, true)
  assert.equal(applyFindModelExtensions(model(), context()).changed, false)
  unregisterFindInProjectExtension('test.selection')
  unregisterFindInProjectExtension('test.dir')
  assert.deepEqual(findInProjectExtensions(), [])
  void h1
  void h2
})

test('getFilteredNamedScopes + 真实消费侧：贡献能把作用域从下拉里拿掉', () => {
  assert.deepEqual(resolveScopeSelection('测试', scopes).name, '测试')
  const handle = registerFindInProjectExtension({
    id: 'test.no-tests', getFilteredNamedScopes: () => [scopes[0]],
  })
  assert.deepEqual(filterNamedScopes(scopes, context()).map(entry => entry.name), ['生产代码'])
  // 名字失配 ⇒ 回落「项目」（`name: ''`、`set: null`），不是悄悄按旧模式搜。
  const dropped = resolveScopeSelection('测试', scopes)
  assert.equal(dropped.name, '')
  assert.equal(dropped.set, null)
  assert.equal(resolveScopeSelection('生产代码', scopes).name, '生产代码')
  unregisterFindInProjectExtension('test.no-tests')
  assert.equal(resolveScopeSelection('测试', scopes).name, '测试')
  void handle
})

test('层层过滤：后挂的贡献只能收窄（没有贡献时原样返回）', () => {
  assert.deepEqual(filterNamedScopes(scopes, context()), scopes)
  const h1 = registerFindInProjectExtension({ id: 'test.a', getFilteredNamedScopes: () => [scopes[0], scopes[1]] })
  const h2 = registerFindInProjectExtension({ id: 'test.b', getFilteredNamedScopes: () => [scopes[0]] })
  assert.deepEqual(filterNamedScopes(scopes, context()).map(entry => entry.name), ['生产代码'])
  unregisterFindInProjectExtension('test.a')
  unregisterFindInProjectExtension('test.b')
  assert.deepEqual(filterNamedScopes(scopes, context()).map(entry => entry.name), ['生产代码', '测试'])
  void h1
  void h2
})

test('alterDirectorySearchScope：逐个改写，前一个的输出是后一个的输入', () => {
  const initial = { directory: 'src', withSubdirectories: true, set: null }
  assert.deepEqual(alterDirectorySearchScope(initial, context()), initial)
  const h1 = registerFindInDirectoryScopeProvider({
    id: 'test.no-sub', alterDirectorySearchScope: scope => ({ ...scope, withSubdirectories: false }),
  })
  const h2 = registerFindInDirectoryScopeProvider({
    id: 'test.seen', alterDirectorySearchScope: scope => ({ ...scope, directory: scope.directory + '/x' }),
  })
  assert.deepEqual(alterDirectorySearchScope(initial, context()),
    { directory: 'src/x', withSubdirectories: false, set: null })
  unregisterFindInDirectoryScopeProvider('test.no-sub')
  unregisterFindInDirectoryScopeProvider('test.seen')
  assert.deepEqual(alterDirectorySearchScope(initial, context()), initial)
  void h1
  void h2
})

test('模块被真实消费（不是只被自己调）', () => {
  const fss = read('src/findScopeSelection.ts')
  assert.match(fss, /from '\.\/findExtensionPoints\.ts'/, 'findScopeSelection 要 import EP 模块')
  assert.match(fss, /filterNamedScopes\(/, '作用域解析要走聚合问法')
  const mod = read('src/findExtensionPoints.ts')
  for (const coord of ['intellij.platform.lang.impl.xml:261', 'intellij.platform.lang.impl.xml:208',
    'intellij.platform.lang.impl.xml:272-273']) {
    assert.ok(mod.includes(coord), `模块头应记下上游坐标 ${coord}`)
  }
  // PSI 专属的两条（FindUsagesHandlerFactory / CustomUsageSearcher）要写明为什么不落。
  assert.match(mod, /PSI 专属/, '要写明 findUsagesHandlerFactory / customUsageSearcher 为什么不落')
})
