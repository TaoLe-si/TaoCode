// 包依赖分析的视图层（src/packageDepsView.ts）：范围分类、视图设置、依赖闭包。
// 上游对应 DefaultScopesProvider/TestScopeProvider/GeneratedFilesScopeProvider、
// DependencyUISettings 与 FindDependencyUtil。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyPackageDepsSettings, classifyFile, cyclePackages, dependencyClosure, directDependencies,
  fileInScope, groupEdgesByScope, isGeneratedPath, isTestPath, loadPackageDepsSettings,
  DEFAULT_PACKAGE_DEPS_SETTINGS, PACKAGE_SCOPES, packageDisplay, savePackageDepsSettings,
  scopeUniverse, SCOPE_KIND_TITLES,
} from '../src/packageDepsView.ts'
import { buildPackageGraph } from '../src/packageDeps.ts'

test('测试/生成文件的路径分类（上游 TestsScope / GeneratedFilesScope 的文本等价物）', () => {
  assert.ok(isTestPath('src/test/java/A.java'))
  assert.ok(isTestPath('app/__tests__/x.ts'))
  assert.ok(isTestPath('pkg/handler_test.go'))
  assert.ok(isTestPath('src/main/A.test.ts'), '*.test.ts 也算测试')
  assert.ok(!isTestPath('src/main/Attest.ts'))
  assert.ok(isGeneratedPath('node_modules/pkg/index.js'))
  assert.ok(isGeneratedPath('dist/app.min.js'))
  assert.ok(isGeneratedPath('build/CMakeFiles/x.cpp'))
  assert.ok(isGeneratedPath('lib/model.g.dart'))
  assert.ok(!isGeneratedPath('src/build/Builder.java'))
  assert.equal(classifyFile('spec/user.spec.ts'), 'test', '测试优先于生成物')
  assert.equal(classifyFile('src/main/App.java'), 'source')
})

test('scopeUniverse：项目范围排除测试与生成物，测试/生成范围各取所需', () => {
  const files = ['src/a.ts', 'src/a.test.ts', 'dist/bundle.js', 'go/x_test.go', 'README.md']
  assert.deepEqual(scopeUniverse(files, 'project'), ['src/a.ts', 'README.md'])
  assert.deepEqual(scopeUniverse(files, 'tests'), ['src/a.test.ts', 'go/x_test.go'])
  assert.deepEqual(scopeUniverse(files, 'generated'), ['dist/bundle.js'])
  assert.deepEqual(scopeUniverse(files, 'all'), files)
  assert.ok(fileInScope('anything', 'all'))
  assert.deepEqual(PACKAGE_SCOPES.map(option => option.id), ['project', 'tests', 'generated', 'all'])
})

test('视图设置：只看循环时图缩到循环成员之间', () => {
  const graph = {
    packages: ['a', 'b', 'c', 'd'],
    edges: [
      { from: 'a', to: 'b', path: 'a/x.ts', line: 0, specifier: './b' },
      { from: 'b', to: 'a', path: 'b/y.ts', line: 1, specifier: './a' },
      { from: 'a', to: 'c', path: 'a/x.ts', line: 2, specifier: './c' },
      { from: 'c', to: 'd', path: 'c/z.ts', line: 3, specifier: './d' },
    ],
    external: 2,
  }
  const cycles = [['a', 'b']]
  const filtered = applyPackageDepsSettings(graph, cycles, { ...DEFAULT_PACKAGE_DEPS_SETTINGS, filterOutOfCyclePackages: true })
  assert.deepEqual(filtered.packages, ['a', 'b'])
  assert.equal(filtered.edges.length, 2)
  assert.equal(filtered.external, 2, '外部导入计数保留')
  assert.deepEqual(cyclePackages(cycles), new Set(['a', 'b']))
  const untouched = applyPackageDepsSettings(graph, cycles, DEFAULT_PACKAGE_DEPS_SETTINGS)
  assert.equal(untouched.edges.length, 4)
})

test('按来源文件的范围分组（上游 UI_GROUP_BY_SCOPE_TYPE）', () => {
  const edges = [
    { from: 'a', to: 'b', path: 'src/x.ts', line: 0, specifier: './b' },
    { from: 'b', to: 'c', path: 'src/x.test.ts', line: 1, specifier: './c' },
    { from: 'c', to: 'a', path: 'dist/gen.js', line: 2, specifier: './a' },
  ]
  const buckets = groupEdgesByScope(edges)
  assert.deepEqual(buckets.map(bucket => bucket.scope), ['source', 'test', 'generated'])
  assert.equal(buckets[0].edges.length, 1)
  assert.equal(buckets[1].edges[0].path, 'src/x.test.ts')
  assert.equal(SCOPE_KIND_TITLES.generated, '生成文件')
  assert.deepEqual(groupEdgesByScope([edges[0]]).map(bucket => bucket.scope), ['source'])
})

test('依赖闭包：正向与反向各走到可达集，结果不含起点', () => {
  const graph = {
    packages: ['a', 'b', 'c', 'd'],
    edges: [
      { from: 'a', to: 'b', path: 'a.ts', line: 0, specifier: './b' },
      { from: 'b', to: 'c', path: 'b.ts', line: 1, specifier: './c' },
      { from: 'd', to: 'a', path: 'd.ts', line: 2, specifier: './a' },
    ],
    external: 0,
  }
  assert.deepEqual(dependencyClosure(graph, 'a', 'forward').packages, ['b', 'c'])
  assert.deepEqual(dependencyClosure(graph, 'a', 'backward').packages, ['d'])
  assert.deepEqual(dependencyClosure(graph, 'c', 'forward').packages, [])
  const direct = directDependencies(graph, 'a')
  assert.equal(direct.outgoing.length, 1)
  assert.equal(direct.incoming.length, 1)
  assert.equal(packageDisplay(''), '(根目录)')
  assert.equal(packageDisplay('src/api'), 'src/api')
})

test('设置读写：localStorage 不可用时退回默认，坏数据不炸', () => {
  assert.deepEqual(loadPackageDepsSettings(), DEFAULT_PACKAGE_DEPS_SETTINGS)
  savePackageDepsSettings({ filterOutOfCyclePackages: true, showFiles: false, groupByScopeType: true })
  assert.deepEqual(loadPackageDepsSettings(), DEFAULT_PACKAGE_DEPS_SETTINGS, '没有 localStorage 时读回默认')
})

test('scope 与图串联：项目范围构建时把测试文件排除在外', () => {
  const files = ['src/a/main.ts', 'src/b/index.ts', 'src/b/index.test.ts']
  const imports = [
    { path: 'src/a/main.ts', line: 0, specifier: '../b' },
    { path: 'src/b/index.test.ts', line: 0, specifier: '../a' },
  ]
  const graph = buildPackageGraph(imports, scopeUniverse(files, 'project'))
  assert.deepEqual(graph.packages, ['src/a', 'src/b'])
  assert.equal(graph.edges.length, 1, '测试文件不在项目范围，它的导入不进图')
  assert.equal(graph.edges[0].path, 'src/a/main.ts')
  const withTests = buildPackageGraph(imports, scopeUniverse(files, 'tests'))
  assert.equal(withTests.edges.length, 0, '测试范围里没有可解析的目标，导入记外部')
  assert.equal(withTests.external, 2)
})
