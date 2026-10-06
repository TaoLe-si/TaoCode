// 模块依赖闭包与「带依赖的作用域」（roots3 模块侧第 1 条）。
//
// 上游依据（本轮亲手打开）：
//   · `platform/analysis-impl/src/com/intellij/openapi/module/impl/scopes/ModuleScopeUtil.kt:27-35`
//     （`getOrderEnumeratorForOptions`：`:29` 无条件 `recursively()`、`:30` COMPILE_ONLY ⇒
//      `exportedOnly().compileOnly()`、`:31` 无 LIBRARIES ⇒ `withoutLibraries().withoutSdk()`、
//      `:32` 无 MODULES ⇒ `withoutDepModules()`、`:33` 无 TESTS ⇒ `productionOnly()`）；
//   · 同文件 `:41-54`（`calcModules` 从枚举器收 `ModuleOrderEntry.getModule()` 与
//     `ModuleSourceOrderEntry.getOwnerModule()`）；`:99-102`（四个选项位的值）；
//   · `ModuleWithDependenciesScope.kt:131-134`（`ModuleOrderEntry`/`ModuleSourceOrderEntry` 的根按
//     **SOURCES** 收，其余按 CLASSES）、`:138-142`（`putIfAbsent(root, i++)` = 首次出现为准 + 顺序即优先级）、
//     `:155-160`（`lazyModules` = 按 (module, options) 调 `calcModules`）。
//
// 改前的形状（留痕）：`calcModules` 两个分支都返回 `[model.moduleName]` ⇒ 传进来的模块边永远不会被走；
// `moduleWithDependenciesScope` 在 LIBRARIES 位开着时直接 `return model` ⇒ 依赖模块的根一条都不进。
// 下面「正向闭包」与「依赖模块的根进表」两组判据在改前都是红的（反向验证记录见
// docs/batch-2026-10-06-roots3.md §4）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calcModules, dependencyModuleClosure, moduleScopeModel, moduleWithDependenciesScope, SCOPE_OPTION,
} from '../src/moduleScopes.ts'

const LIB = { name: 'lib/**/*.jar', files: ['lib/a.jar'] }
const JDK = { name: '21', home: '/jdk21' }

/** app → core（exported）→ util（core 的这条边没 exported）。 */
const edges = [
  { from: 'app', to: 'core', exported: true },
  { from: 'core', to: 'util', exported: false },
]
const rootsOfModules = { core: ['libs/core'], util: ['libs/util'] }

const model = () => moduleScopeModel({
  moduleName: 'app', contentRoots: ['app'], sourcePaths: ['app/src'], libraries: [LIB], jdk: JDK,
  moduleOrderEntries: edges, moduleContentRoots: { app: ['app'], core: ['libs/core'], util: ['libs/util'] },
})

test('正向闭包：recursively 是无条件的，MODULES 位只决定 withoutDepModules（ModuleScopeUtil.kt:29/:32）', () => {
  const all = dependencyModuleClosure(model(), SCOPE_OPTION.MODULES)
  assert.deepEqual(all, ['app', 'core', 'util'], '沿全部边走（没开 COMPILE_ONLY ⇒ 不过滤 exported）')
  assert.deepEqual(dependencyModuleClosure(model(), SCOPE_OPTION.LIBRARIES), ['app'],
    'MODULES 没开 ⇒ withoutDepModules() ⇒ 只剩根模块')
  assert.equal(all[0], 'app', '根模块自己排第一（`ModuleSourceOrderEntry.getOwnerModule()`，:48-50）')
})

test('COMPILE_ONLY ⇒ exportedOnly：非 exported 的边整条不看，既不入选也不下探（ModuleScopeUtil.kt:30）', () => {
  const compiled = dependencyModuleClosure(model(), SCOPE_OPTION.MODULES | SCOPE_OPTION.COMPILE_ONLY)
  assert.deepEqual(compiled, ['app', 'core'], 'core 是 exported 边带来的 ⇒ 入选；util 挂在非 exported 边上 ⇒ 整条不算')
})

test('calcModules 与正向闭包同一实现（ModuleScopeUtil.kt:41-54）', () => {
  assert.deepEqual(calcModules(model(), SCOPE_OPTION.MODULES | SCOPE_OPTION.COMPILE_ONLY),
    dependencyModuleClosure(model(), SCOPE_OPTION.MODULES | SCOPE_OPTION.COMPILE_ONLY))
  assert.deepEqual(calcModules(model(), SCOPE_OPTION.MODULES | SCOPE_OPTION.LIBRARIES), ['app', 'core', 'util'])
})

test('带依赖的作用域：依赖模块的内容根按 SOURCES 进表，库/SDK 位仍生效', () => {
  const scope = moduleWithDependenciesScope(model(), SCOPE_OPTION.MODULES | SCOPE_OPTION.LIBRARIES)
  assert.deepEqual(scope.contentRoots, ['app', 'libs/core', 'libs/util'], '自己的根在前，依赖模块的根接在后面')
  assert.equal(scope.isInContent('libs/core/src/C.kt'), true)
  assert.equal(scope.isInContent('libs/util/U.kt'), true)
  assert.equal(scope.isInContent('vendor/outside.kt'), false, '既不在自己也不在依赖模块内容根下的仍不算内容')
  assert.equal(scope.roots.some(root => root.root === 'libs/core'), true)
  assert.deepEqual(scope.libraries, [LIB], 'LIBRARIES 位开着 ⇒ 库根留着')
  assert.equal(scope.roots.find(root => root.root === 'libs/core')?.rootType, 'content',
    '依赖模块的根是内容/源码根（ModuleWithDependenciesScope.kt:131-134 取 SOURCES，不是 CLASSES）')
})

test('MODULES 位没开 ⇒ 依赖模块的根一条都不进（:32 withoutDepModules）', () => {
  const scope = moduleWithDependenciesScope(model(), SCOPE_OPTION.LIBRARIES)
  assert.deepEqual(scope.contentRoots, ['app'])
  assert.equal(scope.isInContent('libs/core/src/C.kt'), false)
})

test('无 LIBRARIES ⇒ withoutLibraries().withoutSdk()：库与 SDK 都剥掉，依赖模块的根仍进（:31）', () => {
  const scope = moduleWithDependenciesScope(model(), SCOPE_OPTION.MODULES)
  assert.deepEqual(scope.libraries, [])
  assert.equal(scope.jdk, null)
  assert.equal(scope.isInJdk('/jdk21/jmods/java.base.jmod'), false, 'SDK 剥掉后 isInJdk 也得跟着假（改前漏了这一条）')
  assert.equal(scope.isInContent('libs/core/src/C.kt'), true)
  assert.equal(scope.roots.some(root => root.rootType === 'library'), false)
  assert.equal(scope.roots.some(root => root.rootType === 'jdk'), false)
})

test('回归：没有模块边时与改前逐字一致（单隐式模块不因为这次改动多出行）', () => {
  const edgeless = moduleScopeModel({ moduleName: 'app', contentRoots: [''], sourcePaths: ['src'], libraries: [LIB], jdk: JDK })
  assert.deepEqual(dependencyModuleClosure(edgeless, SCOPE_OPTION.MODULES), ['app'])
  const kept = moduleWithDependenciesScope(edgeless, SCOPE_OPTION.MODULES | SCOPE_OPTION.LIBRARIES)
  assert.deepEqual(kept.roots, edgeless.roots, '带库位且没有依赖 ⇒ 根表原样')
  assert.deepEqual(kept.contentRoots, edgeless.contentRoots)
  const stripped = moduleWithDependenciesScope(edgeless, SCOPE_OPTION.MODULES)
  assert.deepEqual(stripped.roots.map(root => root.root), edgeless.roots
    .filter(root => root.rootType !== 'library' && root.rootType !== 'jdk').map(root => root.root),
  '无库位 ⇒ 只剥库/SDK，顺序与优先级不变')
})
