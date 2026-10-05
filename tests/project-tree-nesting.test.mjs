// 项目视图的文件嵌套（`pv/project-view-nodes` 族的 File Nesting）：纯规则 + 模型/组件接线。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_NESTING_RULES, matchNamePattern, nestSiblings, nestingParentOf, nestedChildrenOf } from '../src/projectTreeNesting.ts'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const file = name => ({ name, path: name, kind: 'file' })
const directory = name => ({ name, path: name, kind: 'directory' })

test('段内 glob：* 捕获一段且必须整名命中', () => {
  assert.deepEqual(matchNamePattern('*.ts', 'a.ts'), ['a'])
  assert.equal(matchNamePattern('*.ts', 'a.tsx'), null)
  assert.equal(matchNamePattern('*.ts', 'a.js'), null)
  assert.deepEqual(matchNamePattern('tsconfig.*.json', 'tsconfig.build.json'), ['build'])
  assert.equal(matchNamePattern('tsconfig.*.json', 'tsconfig.json'), null)
  assert.equal(matchNamePattern('*.ts', '.ts'), null, '空捕获不算命中')
  assert.deepEqual(matchNamePattern('package.json', 'package.json'), [])
  assert.equal(matchNamePattern('package.json', 'package-lock.json'), null)
})

test('帮助页的那个例子：file.ts 下面收 file.js 与 file.js.map', () => {
  const entries = [file('file.ts'), file('file.js'), file('file.js.map'), file('other.ts'), directory('dir')]
  const { visible, nested } = nestSiblings(entries)
  assert.deepEqual(visible.map(entry => entry.name), ['file.ts', 'other.ts', 'dir'])
  assert.deepEqual((nested.get('file.ts') ?? []).map(entry => entry.name), ['file.js', 'file.js.map'])
})

test('同名约束：不同基名的编译产物不认领', () => {
  const entries = [file('a.ts'), file('b.js')]
  assert.deepEqual(nestSiblings(entries).visible.map(entry => entry.name), ['a.ts', 'b.js'])
  assert.equal(nestingParentOf(file('b.js'), entries, DEFAULT_NESTING_RULES), null)
})

test('只嵌一层：已经嵌走的文件不再当父', () => {
  const rules = [
    { parent: '*.ts', children: ['*.js'] },
    { parent: '*.js', children: ['*.d.ts'] },
  ]
  const entries = [file('a.ts'), file('a.js'), file('a.d.ts')]
  const { visible, nested } = nestSiblings(entries, rules)
  assert.deepEqual(visible.map(entry => entry.name), ['a.ts', 'a.d.ts'])
  assert.deepEqual((nested.get('a.ts') ?? []).map(entry => entry.name), ['a.js'])
})

test('锁文件与 tsconfig 这类整名规则', () => {
  const entries = [file('package.json'), file('package-lock.json'), file('tsconfig.json'), file('tsconfig.build.json'), file('yarn.lock')]
  const { visible, nested } = nestSiblings(entries)
  assert.deepEqual(visible.map(entry => entry.name), ['package.json', 'tsconfig.json'])
  assert.deepEqual((nested.get('package.json') ?? []).map(entry => entry.name), ['package-lock.json', 'yarn.lock'])
  assert.deepEqual((nested.get('tsconfig.json') ?? []).map(entry => entry.name), ['tsconfig.build.json'])
})

test('nestedChildrenOf：模型判断一行有没有展开箭头', () => {
  const entries = [file('a.ts'), file('a.js'), file('b.ts')]
  assert.deepEqual(nestedChildrenOf('a.ts', entries).map(entry => entry.name), ['a.js'])
  assert.deepEqual(nestedChildrenOf('b.ts', entries), [])
})

test('模型与组件接上嵌套：父行可展开、子行缩进一级', () => {
  const model = read('../src/projectTreeModel.ts')
  assert.match(model, /nestSiblings\(entries, nestingRules\(\)\)/)
  assert.match(model, /const hasNested = /)
  assert.match(model, /children !== undefined/)
  assert.match(model, /nestingParentPath\(path, entries\)/)
  const tree = read('../src/components/FileTree.vue')
  assert.match(tree, /hasNested\(row\.entry\.path\)/)
})
