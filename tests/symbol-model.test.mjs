// 判据 · **轻量符号模型**（`src/symbolModel.ts`，上游 PSI 一族在本仓的可移植子集）以及它接上的
// 三个真实消费者（包视图 / 成员抽取 / 结构化搜索的语法作用域）。
//
// 钉四件事：
//   ① 符号树由**范围包含**重建（`documentSymbol` 扁平清单 → 父子），位置查询取最内层；
//   ② 声明层：包名（认不出给 null，不猜）、类体成员段的词法降级；
//   ③ 包视图三档（flatten / hideEmptyMiddle / abbreviate）逐条对齐上游 `ScopeViewTreeModel`；
//   ④ 三个消费者真的用上了它（不是死代码）：`packageDepsView` 的包视图、`refactorMemberMove`
//      的成员清单、`structuralSearchModifiers` 的语法档。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  abbreviatePackage, buildFileSymbolModel, buildSymbolTree, containmentChain, declaredPackageName,
  fileMembers, findSymbol, flattenSymbols, isTypeSymbol, lexicalMemberSpans, membersOf, packageLabel,
  packageNodeOf, packageOfFile, packageTreeOf, positionInSymbol, rangeContains, rangeWithinSymbol,
} from '../src/symbolModel.ts'
import { buildPackageView, packageViewRows } from '../src/packageDepsView.ts'
import { fileMemberNames, memberListFor } from '../src/refactorMemberMove.ts'
import { grammarScopeHolds, NO_GRAMMAR_SCOPE } from '../src/structuralSearchModifiers.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const node = (name, kind, startLine, startChar, endLine, endChar, detail = '') =>
  ({ name, kind, startLine, startChar, endLine, endChar, detail, children: [] })

test('符号树：扁平清单按范围包含重建父子，父在子前', () => {
  const symbols = [
    node('A', 5, 0, 0, 20, 1),
    node('m', 6, 2, 2, 5, 3),
    node('x', 8, 6, 2, 6, 8),
    node('B', 5, 22, 0, 30, 1),
  ]
  const tree = buildSymbolTree(symbols)
  assert.equal(tree.source, 'lsp')
  assert.deepEqual(tree.roots.map(root => root.name), ['A', 'B'], '两个顶层类型')
  assert.deepEqual(tree.roots[0].children.map(child => child.name), ['m', 'x'], 'm/x 落在 A 的范围里')
  assert.deepEqual(flattenSymbols(tree).map(item => item.name), ['A', 'm', 'x', 'B'], '深度优先、父在子前')
  assert.deepEqual(buildSymbolTree([]).source, 'lexical', '没有符号 ⇒ 词法降级标记')
  assert.deepEqual(buildSymbolTree(null).roots, [])
})

test('范围包含与位置查询：最内层的符号链，起点按行放宽', () => {
  const tree = buildSymbolTree([node('A', 5, 0, 0, 20, 1), node('m', 6, 5, 4, 10, 3)])
  assert.equal(rangeContains(tree.roots[0], tree.roots[0].children[0]), true)
  assert.equal(rangeContains(tree.roots[0].children[0], tree.roots[0]), false)
  assert.deepEqual(containmentChain(tree, { line: 6, character: 5 }).map(item => item.name), ['A', 'm'], '取最内层链')
  // 起点按行放宽：光标停在 `public` 关键字（列 0）上仍命中方法（语言服务的起点在声明名那一列）。
  assert.deepEqual(containmentChain(tree, { line: 6, character: 0 }).map(item => item.name), ['A', 'm'])
  assert.deepEqual(containmentChain(tree, { line: 21, character: 0 }), [], '范围外不编一个文件根出来')
  assert.equal(positionInSymbol(tree.roots[0], { line: 20, character: 1 }), true, '终点闭区间')
  assert.equal(isTypeSymbol(tree.roots[0]), true)
  assert.equal(isTypeSymbol(tree.roots[0].children[0]), false)
})

test('成员与按名查找：类型成员 = 直接子节点；同名取第一个', () => {
  const tree = buildSymbolTree([node('A', 5, 0, 0, 20, 1), node('m', 6, 2, 2, 5, 3), node('B', 5, 22, 0, 30, 1), node('n', 6, 24, 2, 26, 3)])
  const typeA = findSymbol(tree, 'A')
  assert.deepEqual(membersOf(tree, typeA).map(item => item.name), ['m'])
  assert.equal(findSymbol(tree, 'nope'), null)
})

test('声明层：包名（Java/C#/Go），认不出给 null 不猜', () => {
  assert.equal(declaredPackageName('// c\npackage com.acme.app;\nclass A {}', 'java'), 'com.acme.app')
  assert.equal(declaredPackageName('package com.acme\nclass A', 'kotlin'), 'com.acme')
  assert.equal(declaredPackageName('namespace Acme.App {', 'csharp'), 'Acme.App')
  assert.equal(declaredPackageName('namespace Acme.App;', 'cs'), 'Acme.App')
  assert.equal(declaredPackageName('package main', 'go'), 'main')
  // 没有声明 / 语言不在这批里 ⇒ null（不按目录编一个包名）。
  assert.equal(declaredPackageName('const x = 1', 'typescript'), null)
  assert.equal(declaredPackageName('class A {}', 'java'), null)
  assert.equal(packageOfFile('src/a/b.ts', null), 'src/a')
  assert.equal(packageOfFile('src/a/b.java', 'com.acme'), 'com.acme', '有声明用声明')
  assert.equal(packageOfFile('b.ts', null), '', '根目录')
})

test('词法降级：花括号类体的成员段（字符串/注释里的花括号不算）', () => {
  const text = [
    'class A {',
    '  private int count;',
    '  void run() {',
    '    String s = "}";',
    '  }',
    '}',
  ].join('\n')
  const spans = lexicalMemberSpans(text, 'java')
  assert.deepEqual(spans.map(span => span.name), ['count', 'run'], '字段与方法各一段')
  assert.equal(spans[1].startLine, 2)
  assert.equal(spans[1].endLine, 4, '方法体配对到第 4 行的 `}`（字符串里的 `}` 不参与配对）')
  // 不支持的语言与没有类的文本都返回空（不猜）。
  assert.deepEqual(lexicalMemberSpans(text, 'python'), [])
  assert.deepEqual(lexicalMemberSpans('const x = 1', 'typescript'), [])
})

test('文件符号模型：LSP 优先、词法兜底，成员清单带 source 标注', () => {
  const text = 'class A {\n  private int count;\n  void run() {}\n}'
  const lexical = buildFileSymbolModel({ path: 'A.java', language: 'java', text })
  assert.equal(lexical.tree.source, 'lexical')
  assert.deepEqual(fileMembers(lexical).map(member => member.source), ['lexical', 'lexical'])
  const lsp = buildFileSymbolModel({
    path: 'A.java', language: 'java', text,
    symbols: [node('A', 5, 0, 0, 3, 1), node('count', 8, 1, 2, 1, 20), node('run', 6, 2, 2, 2, 15)],
  })
  assert.equal(lsp.tree.source, 'lsp')
  assert.deepEqual(fileMembers(lsp).map(member => member.name), ['count', 'run'])
  assert.ok(fileMembers(lsp).every(member => member.source === 'lsp'))
})

test('包视图：目录归属建树、祖先补齐、根目录那一格留住、flatten 平铺', () => {
  const files = ['a/b/c/x.ts', 'a/b/y.ts', 'a/z.ts', 'top.ts']
  const tree = packageTreeOf(files)
  // 空包名那一格是"源码根直属文件"的归属（`top.ts`），**必须留着** —— 删掉它等于让根文件
  // 在包视图里凭空消失（第一版就是删的，被这条判据抓出来）。
  assert.deepEqual(tree.map(item => item.name), ['', 'a'], '根那一格 + 顶层包')
  assert.deepEqual(packageNodeOf(tree, '')?.files, ['top.ts'], '根目录直属文件归空包名那一格')
  assert.equal(packageNodeOf(tree, 'a/b/c')?.files.length, 1, 'a/b/c 有自己的文件')
  assert.deepEqual(packageNodeOf(tree, 'a')?.files, ['a/z.ts'])
  // flatten：不建中间层，每个包都是顶层（含空包名那一格）。
  const flat = packageTreeOf(files, new Map(), { flattenPackages: true })
  assert.ok(flat.every(item => item.children.length === 0), '平铺后没有子节点')
  assert.ok(flat.map(item => item.name).includes('a/b/c'))
  // 没有根文件时不会平白多出「(根)」那一行。
  assert.deepEqual(packageTreeOf(['a/b/x.ts']).map(item => item.name), ['a'])
})

test('包视图：hideEmptyMiddlePackages 把中间层并进父；abbreviate 只改显示名', () => {
  const files = ['a/b/c/x.ts']
  const full = packageTreeOf(files)
  const a = full[0]
  assert.equal(a.middle, true, 'a 没有自己的文件、只有子包 b ⇒ 中间包')
  // a 与 b 都是中间包 ⇒ hideEmptyMiddle 开着时并成 a/b/c 一行。
  const hidden = packageTreeOf(files, new Map(), { hideEmptyMiddlePackages: true })
  assert.deepEqual(hidden.map(item => item.name), ['a/b/c'], '中间层并进父，露出最深那一格')
  assert.deepEqual(hidden[0].files, ['a/b/c/x.ts'], '文件跟着并过来的节点')
  assert.equal(abbreviatePackage('com.acme.app'), 'c.a.a')
  assert.equal(abbreviatePackage('a/b/c'), 'a/b/c', '单段分隔符取首字母')
  assert.equal(packageLabel('com.acme.app'), 'com.acme.app')
  assert.equal(packageLabel('com.acme.app', { abbreviatePackageNames: true }), 'c.a.a')
  assert.equal(packageLabel(''), '(根)')
})

test('包视图行表：深度优先、label 按缩写档、文件数含子树', () => {
  const rows = packageViewRows(packageTreeOf(['a/b/x.ts', 'a/y.ts']))
  assert.deepEqual(rows.map(row => row.name), ['a', 'a/b'])
  assert.deepEqual(rows.map(row => row.depth), [0, 1])
  assert.equal(rows[0].fileCount, 1)
  assert.equal(rows[0].totalFiles, 2, '子树合计')
  const rowsAbbrev = packageViewRows(packageTreeOf(['com/acme/app/x.ts']), { abbreviatePackageNames: true })
  assert.ok(rowsAbbrev.some(row => row.label === 'c/a'), '缩写档只改显示名')
  assert.deepEqual(buildPackageView(['a/b/x.ts']).map(row => row.name), ['a', 'a/b'])
})

test('消费者一（包视图）：packageDepsView 真的接了符号模型的包树', () => {
  const source = read('src/packageDepsView.ts')
  assert.match(source, /from '\.\/symbolModel\.ts'/)
  assert.match(source, /packageTreeOf/)
  assert.match(source, /PACKAGE_VIEW_OPTIONS/)
  assert.match(source, /buildPackageView/)
})

test('消费者二（成员抽取）：refactorMemberMove 的成员清单优先走符号树、没符号树退文本层', () => {
  const text = 'class A {\n  private int count;\n  void run() {}\n}'
  const lexical = memberListFor(text, 'java', 'A')
  assert.equal(lexical.source, 'lexical')
  assert.deepEqual(lexical.names, ['count', 'run'])
  const lsp = memberListFor(text, 'java', 'A', undefined, [node('A', 5, 0, 0, 3, 1), node('count', 8, 1, 2, 1, 20), node('run', 6, 2, 2, 2, 15)])
  assert.equal(lsp.source, 'lsp')
  assert.deepEqual(lsp.names, ['count', 'run'])
  // 符号树里没有那个类 ⇒ 退回文本层（不误报空）。
  assert.deepEqual(memberListFor(text, 'java', 'A', undefined, [node('Other', 5, 0, 0, 3, 1)]).names, ['count', 'run'])
  assert.deepEqual(fileMemberNames(text, 'java').names, ['count', 'run'])
  const source = read('src/refactorMemberMove.ts')
  assert.match(source, /from '\.\/symbolModel\.ts'/)
  assert.match(source, /memberListFor/)
})

test('消费者三（结构化搜索语法档）：grammarScopeHolds 按符号节点收窄/取反，没符号树放行', () => {
  const symbols = [node('A', 5, 0, 0, 20, 1), node('m', 6, 2, 2, 5, 3)]
  const inMethod = { startLine: 3, startChar: 4, endLine: 3, endChar: 6 }
  assert.equal(grammarScopeHolds({ kinds: [6], invert: false }, symbols, inMethod).ok, true, '落在方法里')
  // 命中落在**类型**节点里、只允许方法档时：范围在类型里、类型不在 allowed ⇒ 不成立。
  const inType = { startLine: 1, startChar: 0, endLine: 1, endChar: 5 }
  assert.equal(grammarScopeHolds({ kinds: [6], invert: false }, symbols, inType).ok, false, '类型里没有方法档 ⇒ 不成立')
  assert.equal(grammarScopeHolds({ kinds: [5], invert: false }, symbols, inType).ok, true, '只允许类型档时成立')
  assert.equal(grammarScopeHolds({ kinds: [5], invert: false }, symbols, inMethod).ok, true, '方法在类型范围内 ⇒ 类型档也成立')
  assert.equal(grammarScopeHolds({ kinds: [6], invert: true }, symbols, inMethod).ok, false, '取反后不成立')
  const outside = { startLine: 25, startChar: 0, endLine: 25, endChar: 1 }
  assert.equal(grammarScopeHolds({ kinds: [6], invert: false }, symbols, outside).ok, false, '范围外不成立')
  // 没有符号树 ⇒ 放行（不误杀），且 available=false 让调用方知道这一档没生效。
  const noTree = grammarScopeHolds({ kinds: [6], invert: false }, [], inMethod)
  assert.equal(noTree.ok, true)
  assert.equal(noTree.available, false)
  assert.equal(grammarScopeHolds(NO_GRAMMAR_SCOPE, symbols, inMethod).ok, true, '空档位放行')
  assert.equal(rangeWithinSymbol(buildSymbolTree(symbols), inMethod, [6])?.name, 'm', '取最内层节点')
  const source = read('src/structuralSearchModifiers.ts')
  assert.match(source, /from '\.\/symbolModel\.ts'/)
  assert.match(source, /grammarScopeHolds/)
})