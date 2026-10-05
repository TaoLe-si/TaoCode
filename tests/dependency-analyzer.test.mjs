// 依赖分析器模型的判据（`src/dependencyAnalyzer.ts`）。
//
// 上游依据：
//   · `DependencyAnalyzerDependency.kt`（Data/Scope/Status/parent）；
//   · `DependencyUiUtil.kt:47-53 getDisplayText`、`:204-220 DependencyGroup`；
//   · `GradleDependencyAnalyzerContributor.kt:140-160 getStatus`（UNRESOLVED 与 between-versions 两种告警）；
//   · `DependencyAnalyzerViewImpl.kt:186-198 filterDependencies`（文本 → 配置 → 只看告警）、
//     `:244-251`（过滤后重新成组）、`:350-365 getTreePath`。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANALYZER_DEFAULT_SCOPE_NAME, analyzerDataOf, analyzerDisplayText, analyzerScope, analyzerScopeItems,
  analyzerStatusOf, analyzerSummary, analyzerTreePath, analyzerUsagesTree, buildAnalyzerDependencies,
  createDependencyGroups, filterAnalyzerDependencies, filterAnalyzerGroups, STANDARD_DEPENDENCY_SCOPES,
} from '../src/dependencyAnalyzer.ts'
import { parseGradleDependencies } from '../src/gradle.ts'

/** 真实 `gradle dependencies --console=plain` 的节选（含冲突箭头、重复、约束、无法解析）。 */
const OUTPUT = `
------------------------------------------------------------
Root project 'demo'
------------------------------------------------------------

annotationProcessor - Annotation processors and their dependencies for source set 'main'.
No dependencies

compileClasspath - Compile classpath for source set 'main'.
+--- org.jetbrains.kotlin:kotlin-stdlib:1.9.0
|    \\--- org.jetbrains:annotations:13.0
+--- org.example:lib:1.0 -> 1.2
|    \\--- org.example:core:0.5 (c)
\\--- org.broken:missing:2.0 (n)

runtimeClasspath - Runtime classpath of source set 'main'.
+--- project :app
|    \\--- org.example:lib:1.2
\\--- org.example:core:0.5 (*)
`

const scopes = () => parseGradleDependencies(OUTPUT)

test('坐标解析：group:artifact:version / group:artifact / project 依赖 / 认不出', () => {
  assert.deepEqual(analyzerDataOf('org.example:lib:1.0'), { kind: 'artifact', groupId: 'org.example', artifactId: 'lib', version: '1.0' })
  assert.deepEqual(analyzerDataOf('org.example:lib'), { kind: 'artifact', groupId: 'org.example', artifactId: 'lib', version: '' })
  assert.deepEqual(analyzerDataOf('project :app'), { kind: 'module', name: ':app' })
  assert.equal(analyzerDataOf('No dependencies'), null)
  assert.equal(analyzerDataOf(''), null)
})

test('显示文本：artifactId:version 与完整坐标（getDisplayText）', () => {
  const data = analyzerDataOf('org.example:lib:1.0')
  assert.equal(analyzerDisplayText(data), 'lib:1.0')
  assert.equal(analyzerDisplayText(data, true), 'org.example:lib:1.0')
})

test('状态：CLI 的 (n) 与 -> X 还原上游两种告警，(c) 记约束', () => {
  const parsed = scopes()
  const compile = parsed.find(scope => scope.configuration === 'compileClasspath')
  const broken = compile.dependencies.find(entry => entry.unresolved)
  assert.deepEqual(analyzerStatusOf(broken).map(entry => entry.kind), ['unresolved'])
  const conflict = compile.dependencies.find(entry => entry.resolved)
  const status = analyzerStatusOf(conflict)
  assert.equal(status[0].kind, 'versionConflict')
  assert.equal(status[0].resolved, '1.2')
  const constraint = compile.dependencies.find(entry => entry.constraint)
  assert.equal(analyzerStatusOf(constraint)[0].kind, 'constraint')
  assert.deepEqual(analyzerStatusOf({ name: 'a:b:1', depth: 0, duplicate: false, constraint: false, unresolved: false, resolved: '' }), [])
})

test('依赖树：根模块在首、depth 决定父子链、坐标认不出的行跳过', () => {
  const dependencies = buildAnalyzerDependencies(scopes(), 'demo')
  assert.equal(dependencies[0].data.kind, 'module')
  assert.equal(dependencies[0].scope.name, ANALYZER_DEFAULT_SCOPE_NAME)
  const stdlib = dependencies.find(entry => analyzerDisplayText(entry.data) === 'kotlin-stdlib:1.9.0')
  assert.equal(stdlib.parent, dependencies[0], 'depth 0 挂在根上')
  const annotations = dependencies.find(entry => analyzerDisplayText(entry.data) === 'annotations:13.0')
  assert.equal(annotations.parent, stdlib, 'depth 1 挂在上一层')
  const app = dependencies.find(entry => entry.data.kind === 'module' && entry.data.name === ':app')
  assert.equal(app.parent, dependencies[0])
  const nested = dependencies.find(entry => analyzerDisplayText(entry.data) === 'lib:1.2' && entry.scope.name === 'runtimeClasspath')
  assert.equal(nested.parent, app, '工程依赖下的传递依赖挂在工程节点上')
})

test('成组：同坐标合并，scopes/parents 去重，告警并集（DependencyGroup）', () => {
  const groups = createDependencyGroups(buildAnalyzerDependencies(scopes(), 'demo'))
  assert.equal(groups.length, 8, '7 个 artifact（lib 两个版本各一组）+ 1 个 module')
  const lib = groups.find(group => analyzerDisplayText(group.data, true) === 'org.example:lib:1.0')
  assert.ok(lib.variances.length >= 1)
  assert.deepEqual(lib.scopes.map(scope => scope.name), ['compileClasspath'])
  assert.equal(lib.hasWarnings, true, '-> 1.2 是版本冲突告警')
  const core = groups.find(group => analyzerDisplayText(group.data, true) === 'org.example:core:0.5')
  assert.deepEqual([...new Set(core.scopes.map(scope => scope.name))].sort(), ['compileClasspath', 'runtimeClasspath'],
    '同一坐标出现在两个配置里')
  assert.equal(core.isOmitted, false, 'CLI 没有 omitted 数据源，不谎报')
  for (const group of groups) assert.equal(group.hasWarnings, group.warnings.length > 0)
})

test('过滤：文本 → 配置 → 只看告警，过滤后重新成组（filterDependencies）', () => {
  const groups = createDependencyGroups(buildAnalyzerDependencies(scopes(), 'demo'))
  const byText = filterAnalyzerGroups(groups, { dataFilter: 'core' })
  assert.deepEqual(byText.map(group => analyzerDisplayText(group.data)), ['core:0.5'])
  assert.deepEqual(filterAnalyzerGroups(groups, { dataFilter: 'core', showGroupId: true }), byText,
    '显示 groupId 不改变匹配（org.example 含 core? 不 —— 只有 core:0.5 命中）')
  const onlyCompile = filterAnalyzerGroups(groups, { scopes: ['compileClasspath'] })
  assert.ok(onlyCompile.length > 0)
  assert.ok(onlyCompile.every(group => group.scopes.every(scope => scope.name === 'compileClasspath')))
  const warnings = filterAnalyzerGroups(groups, { showWarningsOnly: true })
  assert.deepEqual(warnings.map(group => analyzerDisplayText(group.data)).sort(), ['lib:1.0', 'missing:2.0'])
  assert.deepEqual(filterAnalyzerGroups(groups, { scopes: [] }), [], '没勾任何配置 = 没有依赖（上游勾选模型）')
  const single = filterAnalyzerDependencies(groups[0].variances, { dataFilter: 'zzz' })
  assert.deepEqual(single, [])
})

test('usages 树：根到叶的 parent 链（getTreePath）', () => {
  const dependencies = buildAnalyzerDependencies(scopes(), 'demo')
  const annotations = dependencies.find(entry => analyzerDisplayText(entry.data) === 'annotations:13.0')
  assert.deepEqual(analyzerTreePath(annotations).map(entry => analyzerDisplayText(entry.data)),
    ['demo', 'kotlin-stdlib:1.9.0', 'annotations:13.0'])
  const group = createDependencyGroups(dependencies).find(entry => analyzerDisplayText(entry.data) === 'annotations:13.0')
  const tree = analyzerUsagesTree(group)
  assert.equal(tree.length, 1)
  assert.deepEqual(tree[0].map(entry => entry.scope.name), [ANALYZER_DEFAULT_SCOPE_NAME, 'compileClasspath', 'compileClasspath'])
})

test('汇总计数与配置过滤器排序（标准配置在前，默认全选）', () => {
  const groups = createDependencyGroups(buildAnalyzerDependencies(scopes(), 'demo'))
  const summary = analyzerSummary(groups)
  assert.equal(summary.groups, 8)
  assert.equal(summary.conflicts, 1)
  assert.equal(summary.unresolved, 1)
  assert.equal(summary.multiScope, 1, 'core 出现在两个配置')
  const items = analyzerScopeItems(scopes())
  assert.deepEqual(items.filter(item => item.type === 'STANDARD').map(item => item.name),
    [...STANDARD_DEPENDENCY_SCOPES].filter(name => scopes().some(scope => scope.configuration === name)))
  assert.ok(items.every(item => item.selected))
  assert.equal(analyzerScope('weirdScope').type, 'CUSTOM')
})
