// 模块 / 内容根 / 库 / SDK 作用域模型的判据（`src/moduleScopes.ts`）。
//
// 上游依据：
//   · `RootContainer.kt:74-97`（ClassicRootContainer.merge：后一个容器的优先级叠在前一个 max 之上，
//     先出现的根保留原优先级）；
//   · `ModuleContentScopes.kt`（ModuleContentScope.contains = 文件在模块内容内）；
//   · `ModuleWithDependenciesScope.kt`（LIBRARIES 位同时管库与 SDK，无该位时都不参与）；
//   · `ModuleScopeProviderImpl`（运行时类路径 = MODULES | LIBRARIES | TESTS?）；
//   · `PatternBasedPackageSet.matchesLibrary`（content 外文件的模块模式匹配库名/SDK 名）；
//   · `FilePatternPackageSet`（ext: 要求不在 content 内，模式匹配相对库根路径）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calcModules, dependentModuleClosure, jdkScope, libraryRuntimeClasspathScope, libraryScope, mergeRootContainers,
  moduleScopeModel, moduleWithDependenciesScope, moduleWithDependentsScope, moduleWithDependentsTestScope,
  modulesScope, scopeFileSystem, scopeOptions, SCOPE_OPTION,
} from '../src/moduleScopes.ts'
import { compileScope, scopeMatches } from '../src/scopes.ts'

const library = { name: 'lib/**/*.jar', files: ['lib/a.jar', 'vendor/b.jar'] }

const model = () => moduleScopeModel({
  moduleName: 'TaoCode',
  contentRoots: [''],
  sourcePaths: ['src/main/java', 'src/test/java'],
  libraries: [library],
  jdk: { name: '17', home: 'C:/Java/jdk-17' },
})

test('根优先级合并：后一个容器整体垫在前一个 max 之上，先出现者保位', () => {
  const first = [{ root: 'src', rootType: 'content', orderEntryName: 'm', priority: 1 }]
  const second = [
    { root: 'lib/a.jar', rootType: 'library', orderEntryName: 'lib', priority: 1 },
    { root: 'src', rootType: 'content', orderEntryName: 'm', priority: 2 },
  ]
  const merged = mergeRootContainers([first, second])
  assert.deepEqual(merged.map(entry => entry.root), ['src', 'lib/a.jar'])
  assert.equal(merged[0].priority, 1, '先出现的根保留原优先级（putIfAbsent）')
  assert.equal(merged[1].priority, 2)
})

test('内容作用域：内容根内/外，相对路径取最长根', () => {
  const scoped = moduleScopeModel({ moduleName: 'm', contentRoots: ['', 'src/main/java'] })
  assert.equal(scoped.isInContent('src/main/java/A.java'), true)
  assert.equal(scoped.isInContent('lib/a.jar'), true, '工作区根是内容根，项目文件都在 content 内')
  assert.equal(scoped.contentRelativePath('src/main/java/A.java'), 'A.java', '最长根优先')
  assert.equal(scoped.contentRelativePath('README.md'), 'README.md')
  const outside = moduleScopeModel({ moduleName: 'm', contentRoots: ['src'] })
  assert.equal(outside.isInContent('lib/a.jar'), false)
  assert.equal(outside.contentRelativePath('lib/a.jar'), null)
})

test('库作用域：库名与相对库根路径按 glob 声明的库归属', () => {
  const scoped = model()
  assert.equal(scoped.libraryNameOf('lib/a.jar'), 'lib/**/*.jar')
  assert.equal(scoped.libraryNameOf('vendor/b.jar'), 'lib/**/*.jar')
  assert.equal(scoped.libraryNameOf('src/main/java/A.java'), null)
  assert.equal(scoped.libraryRelativePath('lib/a.jar'), 'a.jar')
  assert.equal(scoped.libraryRelativePath('vendor/deep/c.jar'), null)
})

test('根描述件：内容内给模块名，库根给库名，SDK 根给 JDK 名', () => {
  const scoped = model()
  assert.deepEqual(scoped.rootDescriptorOf('src/main/java/A.java'),
    { root: '', rootType: 'content', orderEntryName: 'TaoCode', priority: 1 })
  assert.equal(scoped.rootDescriptorOf('lib/a.jar').rootType, 'content',
    '工作区根是内容根：内容内的 jar 仍归属内容（上游 getModuleSourceOrLibraryClassesRoot 同）')
  // 内容根收窄后 jar 才落到库根（描述件带库名）。
  const narrow = moduleScopeModel({ moduleName: 'TaoCode', contentRoots: ['src'], libraries: [library] })
  assert.equal(narrow.rootDescriptorOf('lib/a.jar').rootType, 'library')
  assert.equal(narrow.rootDescriptorOf('lib/a.jar').orderEntryName, 'lib/**/*.jar')
  assert.equal(narrow.rootDescriptorOf('lib/a.jar').root, 'lib/a.jar')
  assert.equal(scoped.rootDescriptorOf('C:/Java/jdk-17/lib/modules').rootType, 'jdk')
})

test('SDK 根是绝对路径：工作区相对路径不被 JdkScope 命中（与上游一致）', () => {
  const scoped = model()
  assert.equal(scoped.isInJdk('lib/a.jar'), false)
  assert.equal(scoped.isInJdk('C:/Java/jdk-17/lib/modules'), true)
  assert.deepEqual(jdkScope({ name: '17', home: 'C:/Java/jdk-17' }), { name: '17', roots: ['C:/Java/jdk-17'] })
  assert.equal(jdkScope(null), null)
})

test('选项语义：LIBRARIES 位同时管库与 SDK（ModuleScopeUtil.kt:30）', () => {
  assert.deepEqual(scopeOptions(SCOPE_OPTION.LIBRARIES), { compileOnly: false, libraries: true, modules: false, tests: false })
  const withLibraries = moduleWithDependenciesScope(model(), SCOPE_OPTION.MODULES | SCOPE_OPTION.LIBRARIES)
  const without = moduleWithDependenciesScope(model(), SCOPE_OPTION.MODULES)
  assert.equal(withLibraries.libraryNameOf('lib/a.jar'), 'lib/**/*.jar')
  assert.equal(without.libraryNameOf('lib/a.jar'), null, '无 LIBRARIES 位时 withoutLibraries().withoutSdk()')
  assert.ok(without.roots.every(root => root.rootType !== 'library' && root.rootType !== 'jdk'))
  // contentRoots 收窄到 src 时，库文件不在内容内：去掉 LIBRARIES 位后连描述件都没有。
  const narrow = moduleScopeModel({ moduleName: 'm', contentRoots: ['src'], libraries: [library] })
  const stripped = moduleWithDependenciesScope(narrow, SCOPE_OPTION.MODULES)
  assert.equal(narrow.rootDescriptorOf('lib/a.jar').rootType, 'library')
  assert.equal(stripped.rootDescriptorOf('lib/a.jar'), null)
})

test('运行时类路径 = 内容 + 库 + SDK（getModuleRuntimeScope）', () => {
  const runtime = libraryRuntimeClasspathScope(model(), true)
  const names = runtime.roots.map(root => root.rootType)
  assert.deepEqual(names, ['content', 'source', 'source', 'library', 'library', 'jdk'])
  assert.ok(runtime.roots.some(root => root.rootType === 'jdk'))
  assert.equal(libraryScope([library, { name: 'empty', files: [] }]).length, 1)
})

test('单模块退化：依赖闭包 = 自身，模块组只认自己的名字', () => {
  const scoped = moduleWithDependentsScope(model())
  assert.equal(scoped.moduleName, 'TaoCode')
  assert.equal(moduleWithDependentsTestScope(model()).moduleName, 'TaoCode')
  assert.ok(modulesScope(model(), ['TaoCode']))
  assert.equal(modulesScope(model(), ['Other']), null)
  assert.deepEqual(calcModules(model(), SCOPE_OPTION.MODULES), ['TaoCode'])
  assert.deepEqual(dependentModuleClosure(model()), ['TaoCode'], '没有 ModuleOrderEntry ⇒ 闭包只有自己')
})

// ---------------------------------------------------------------- 反向依赖闭包（ModuleWithDependentsScope）

/**
 * 多模块图（`from` 依赖 `to`）。关键是「集合」与「下探」是两件事
 * （`ModuleWithDependentsScope.java:85-87`：`myModules.addAll(allUsages[current])` 收全部依赖方，
 *  但只有 `exportingUsages[current]` 才进 walkingQueue）：
 *   core ← app（非 exported）        ⇒ app 进集合，但**不入队**，所以 app 的依赖方 app-test 看不到
 *   app ← app-test（非 exported）     ⇒ app-test 不在闭包里
 *   core ← cli（exported）           ⇒ cli 进集合且入队
 *   core ← tool（exported）          ⇒ tool 进集合且入队 → 再收到 sandbox
 *   tool ← sandbox（exported）       ⇒ sandbox 进集合且入队 → 再收到 outside
 *   sandbox ← outside（非 exported） ⇒ outside 进集合但**不入队**，所以 grandchild 看不到
 *   outside ← grandchild（exported） ⇒ grandchild 不在闭包里
 */
const graph = () => moduleScopeModel({
  moduleName: 'core',
  contentRoots: ['core'],
  moduleOrderEntries: [
    { from: 'app', to: 'core', exported: false },
    { from: 'app-test', to: 'app', exported: false },
    { from: 'cli', to: 'core', exported: true },
    { from: 'tool', to: 'core', exported: true },
    { from: 'sandbox', to: 'tool', exported: true },
    { from: 'outside', to: 'sandbox', exported: false },
    { from: 'grandchild', to: 'outside', exported: true },
  ],
  moduleContentRoots: {
    core: ['core'], app: ['app', 'app/sub'], 'app-test': ['tests/app'], cli: ['cli'],
    tool: ['tool'], sandbox: ['sandbox'], outside: ['outside'], grandchild: ['grandchild'],
  },
  libraries: [library],
  jdk: { name: '17', home: 'C:/Java/jdk-17' },
})

test('反向闭包：非 exported 的依赖方进集合但不继续下探（ModuleWithDependentsScope.java:85-87）', () => {
  const closure = dependentModuleClosure(graph())
  assert.ok(closure.includes('app'), 'app 依赖 core（非 exported）⇒ 进集合')
  assert.equal(closure.includes('app-test'), false, 'app 没入队 ⇒ app 的依赖方不在闭包里')
  assert.ok(closure.includes('cli') && closure.includes('tool'), 'exported 边 ⇒ 进集合且入队')
  assert.ok(closure.includes('sandbox'), 'tool 入队 ⇒ 沿 exported 边收到 sandbox')
  assert.ok(closure.includes('outside'), 'sandbox 入队 ⇒ 非 exported 的 outside 也进集合')
  assert.equal(closure.includes('grandchild'), false, 'outside 没入队 ⇒ grandchild 不在闭包里')
})

test('反向依赖作用域：内容按各模块自己的内容根 union 判定，库与 SDK 不参与', () => {
  const scoped = moduleWithDependentsScope(graph())
  assert.equal(scoped.isInContent('core/A.java'), true, '本模块内容')
  assert.equal(scoped.isInContent('app/B.java'), true, '依赖方的内容')
  assert.equal(scoped.isInContent('sandbox/C.java'), true, '沿 exported 边下探到的内容')
  assert.equal(scoped.isInContent('outside/D.java'), true, '非 exported 边也是闭包成员')
  assert.equal(scoped.isInContent('tests/app/T.java'), false, 'app-test 不在闭包里')
  assert.equal(scoped.isInContent('grandchild/E.java'), false, 'grandchild 不在闭包里')
  assert.equal(scoped.libraryNameOf('lib/a.jar'), null, 'isSearchInLibraries() 恒 false（:219-222）')
  assert.equal(scoped.isInJdk('C:/Java/jdk-17/lib/modules'), false)
  assert.equal(scoped.rootDescriptorOf('app/B.java').orderEntryName, 'app', '描述件带所属模块名')
  assert.equal(scoped.rootDescriptorOf('app/B.java').rootType, 'content')
  assert.ok(scoped.roots.every(root => root.rootType === 'content'), '库/SDK 根被剔掉')
  assert.equal(moduleWithDependentsTestScope(graph()).isInContent('sandbox/C.java'), true)
})

test('反向依赖作用域的相对路径按最长内容根折算（与「最长根优先」口径一致）', () => {
  const scoped = moduleWithDependentsScope(graph())
  assert.equal(scoped.contentRelativePath('app/B.java'), 'B.java')
  assert.equal(scoped.contentRelativePath('app/sub/X.java'), 'X.java', 'app/sub 比 app 更长')
  assert.equal(scoped.contentRelativePath('nowhere/x'), null)
})

// ---------------------------------------------------------------- 与 scopes.ts 的接线

test('ext: 判定：工作区根即内容根 → 项目文件都在 content 内，ext: 按上游语义不命中', () => {
  // 本仓单根工作区（`contentRoots: ['']`）下，`workspace.files` 的每条路径都在内容根内，
  // 而 `FilePatternPackageSet:55-60` 要求 `isInContent != myProjectFiles` —— ext: 只对内容外
  // 文件有意义。这条断言把现实钉住：模型接线后 ext: 对项目文件**仍**不命中（不是没接）。
  const context = { moduleName: 'TaoCode', fileSystem: scopeFileSystem(model()) }
  assert.equal(scopeMatches(compileScope('ext:*.jar'), 'lib/a.jar', false, context), false)
  assert.equal(scopeMatches(compileScope('ext:*.jar'), 'src/A.java', false, context), false)
  assert.equal(scopeMatches(compileScope('ext:*.jar'), 'lib/a.jar', false, { moduleName: 'TaoCode' }), false,
    '没有 fileSystem 的调用方沿用兜底（ext: 恒假）')
})

test('ext: 判定：内容根收窄到源码目录时，库文件按库名与相对库根路径命中（上游语义的正例）', () => {
  // 内容根不是工作区根的场景（模型级能力；ScopesSettingsPage 目前传 ['']，见上一条）。
  const scoped = moduleScopeModel({
    moduleName: 'TaoCode', contentRoots: ['src'], sourcePaths: ['src'],
    libraries: [{ name: 'core-lib', files: ['lib/a.jar', 'vendor/b.jar'] }],
    jdk: { name: '17', home: 'C:/Java/jdk-17' },
  })
  const context = { moduleName: 'TaoCode', fileSystem: scopeFileSystem(scoped) }
  const ext = compileScope('ext:*.jar')
  assert.equal(scopeMatches(ext, 'lib/a.jar', false, context), true, '内容外 + 库相对路径 a.jar')
  assert.equal(scopeMatches(ext, 'vendor/b.jar', false, context), true)
  assert.equal(scopeMatches(ext, 'src/A.java', false, context), false, '内容内文件不属于 ext:')
  assert.equal(scopeMatches(compileScope('ext:lib/*'), 'vendor/b.jar', false, context), false,
    '库相对路径相对库根（jar 自己的名字），不是工作区路径')

  const byLibrary = compileScope('ext[core-lib]:*.jar')
  assert.equal(scopeMatches(byLibrary, 'lib/a.jar', false, context), true, '模块模式在 ext: 下匹配库名')
  assert.equal(scopeMatches(byLibrary, 'src/A.java', false, context), false, '内容是项目文件，不是库')
  assert.equal(scopeMatches(compileScope('ext[core*]:*.jar'), 'lib/a.jar', false, context), true,
    '模块名模式按 convertToPattern：字母/数字/_ 原样、* → .*')
  assert.equal(scopeMatches(compileScope('ext[other]:*.jar'), 'lib/a.jar', false, context), false)
})

test('内容内文件的相对路径按内容根折算', () => {
  const scoped = moduleScopeModel({ moduleName: 'm', contentRoots: ['src/main'] })
  const context = { moduleName: 'm', fileSystem: scopeFileSystem(scoped) }
  assert.equal(scopeMatches(compileScope('file:*.java'), 'src/main/A.java', false, context), true)
  assert.equal(scopeMatches(compileScope('file:src/**'), 'src/main/A.java', false, context), false,
    '路径相对内容根 src/main，不再是工作区路径')
  assert.equal(scopeMatches(compileScope('file:*.java'), 'lib/a.jar', false, context), false)
})
