import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPackageGraph, collectImports, extractImportSpecifiers, findDependencyCycles, packageOf, resolveImport,
} from '../src/packageDeps.ts'

const spec = line => extractImportSpecifiers(line)[0] ?? null

test('抽取导入说明符：各语言语法', () => {
  assert.equal(spec("import { a } from './util'"), './util')
  assert.equal(spec("import type { T } from '../types'"), '../types')
  assert.equal(spec("import './side-effect'"), './side-effect')
  assert.equal(spec("const x = require('lodash')"), 'lodash')
  assert.equal(spec('import java.util.List;'), 'java.util.List')
  assert.equal(spec('import kotlin.collections.List as L'), 'kotlin.collections.List')
  assert.equal(spec('from os import path'), 'os')
  assert.equal(spec('import os'), 'os')
  assert.equal(spec('#include "a/b.h"'), 'a/b.h')
  assert.equal(spec('#include <vector>'), 'vector')
  assert.equal(spec('using System.Text;'), 'System.Text')
  assert.equal(spec('import "github.com/x/y"'), 'github.com/x/y')
  assert.equal(spec('const n = 3'), null)
})

test('packageOf 取目录，根目录是空串', () => {
  assert.equal(packageOf('src/a/b.ts'), 'src/a')
  assert.equal(packageOf('main.ts'), '')
  assert.equal(packageOf('src\\a\\b.ts'), 'src/a')
})

test('相对路径解析：扩展名与 index 兜底、.. 归一', () => {
  const universe = ['src/a/main.ts', 'src/b/util.ts', 'src/b/index.ts', 'src/b/sub/deep.js']
  assert.equal(resolveImport('src/a/main.ts', '../b/util', universe), 'src/b/util.ts')
  assert.equal(resolveImport('src/a/main.ts', '../b', universe), 'src/b/index.ts')
  assert.equal(resolveImport('src/b/sub/deep.js', '../../a/main', universe), 'src/a/main.ts')
  assert.equal(resolveImport('src/a/main.ts', './missing', universe), null)
})

test('点分路径按后缀匹配，解析不到算外部', () => {
  const universe = ['src/com/example/App.java', 'src/com/example/Util.kt']
  assert.equal(resolveImport('src/com/example/Other.java', 'com.example.App', universe), 'src/com/example/App.java')
  assert.equal(resolveImport('src/com/example/Other.java', 'java.util.List', universe), null)
})

test('collectImports 只留有说明符的行', () => {
  const matches = [
    { path: 'src/a.ts', line: 0, column: 1, preview: "import { x } from './b'", length: 0 },
    { path: 'src/a.ts', line: 2, column: 1, preview: 'const y = 1', length: 0 },
  ]
  assert.deepEqual(collectImports(matches), [{ path: 'src/a.ts', line: 0, specifier: './b' }])
})

test('目录级图：同目录不算边，外部导入计数', () => {
  const universe = ['src/a/x.ts', 'src/b/y.ts', 'src/a/z.ts']
  const graph = buildPackageGraph([
    { path: 'src/a/x.ts', line: 1, specifier: '../b/y' },
    { path: 'src/a/x.ts', line: 2, specifier: './z' },     // 同目录：不进图
    { path: 'src/a/x.ts', line: 3, specifier: 'react' },   // 外部：计数
  ], universe)
  assert.deepEqual(graph.edges, [{ from: 'src/a', to: 'src/b', path: 'src/a/x.ts', line: 1, specifier: '../b/y' }])
  assert.equal(graph.external, 1)
  assert.deepEqual(graph.packages, ['src/a', 'src/b'])
})

test('循环检测：两包互相依赖、自环、无环', () => {
  const universe = ['src/a/x.ts', 'src/b/y.ts', 'src/c/z.ts', 'src/d/w.ts']
  const cycle = buildPackageGraph([
    { path: 'src/a/x.ts', line: 1, specifier: '../b/y' },
    { path: 'src/b/y.ts', line: 1, specifier: '../c/z' },
    { path: 'src/c/z.ts', line: 1, specifier: '../a/x' },
    { path: 'src/d/w.ts', line: 1, specifier: '../a/x' },
  ], universe)
  assert.deepEqual(findDependencyCycles(cycle), [['src/a', 'src/b', 'src/c']])

  const acyclic = buildPackageGraph([
    { path: 'src/a/x.ts', line: 1, specifier: '../b/y' },
    { path: 'src/b/y.ts', line: 1, specifier: '../c/z' },
  ], universe)
  assert.deepEqual(findDependencyCycles(acyclic), [])
})

test('自环被报告为循环', () => {
  const universe = ['src/a/x.ts', 'src/a/y.ts']
  const graph = buildPackageGraph([{ path: 'src/a/x.ts', line: 4, specifier: './y' }], universe)
  // 同目录边不进图，但显式构造自环（跨包同目录名无法出现）用合成图验证：
  const synthetic = { packages: ['p'], edges: [{ from: 'p', to: 'p', path: 'p/f.ts', line: 0, specifier: './g' }], external: 0 }
  assert.deepEqual(findDependencyCycles(synthetic), [['p']])
  assert.deepEqual(findDependencyCycles(graph), [])
})
