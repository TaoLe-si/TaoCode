// 项目视图的文件嵌套（`pv/project-view-nodes` 族的 File Nesting）：纯规则 + 模型/组件接线。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_NESTING_RULES, matchNamePattern, nestSiblings, nestingParentOf, nestingRoleOf, nestingRulePairs, nestedChildrenOf } from '../src/projectTreeNesting.ts'

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

// 原写「a.d.ts 留在顶层」，实际上游不是这个形状：`FileNestingBuilder.getNestingRules()`
// 对 A←B、B←C 这对基础规则**再补一条 A←C**（`FileNestingBuilder.java:65-76`，注释原话
// "for all cases like A -> B -> C we also add a rule A -> C"），所以 a.d.ts 挂到祖先行 a.ts 下 ——
// 「只嵌一层」是靠传递闭包实现的，不是靠把孙那一格丢回顶层。断言仍是 deepEqual（没有放松）。
test('只嵌一层：已经嵌走的文件不再当父，孙靠传递规则挂到祖先行下', () => {
  const rules = [
    { parent: '*.ts', children: ['*.js'] },
    { parent: '*.js', children: ['*.d.ts'] },
  ]
  const entries = [file('a.ts'), file('a.js'), file('a.d.ts')]
  const { visible, nested } = nestSiblings(entries, rules)
  assert.deepEqual(visible.map(entry => entry.name), ['a.ts'])
  assert.deepEqual((nested.get('a.ts') ?? []).map(entry => entry.name), ['a.js', 'a.d.ts'])
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
  // 2026-10-07 epclose2：折叠前先过 `com.intellij.treeStructureProvider` EP（无 provider 时恒等），
  // 内建嵌套仍是 `nestSiblings` 那一步。
  assert.match(model, /const providers = modifyProjectTreeChildren\(null, entries\.map\(toProviderNode\), \{/)
  assert.match(model, /return nestSiblings\(providers\.map\(fromProviderNode\), nestingRules\(\)\)/)
  assert.match(model, /const hasNested = /)
  assert.match(model, /children !== undefined/)
  assert.match(model, /nestingParentPath\(path, entries\)/)
  const tree = read('../src/components/FileTree.vue')
  assert.match(tree, /hasNested\(row\.entry\.path\)/)
})

// ── 上游 `FileNestingBuilder` 的两条本仓此前没有的形状（2026-10-06 ptree3 核）──────────────
// ① 传递规则（`platform/lang-impl/src/com/intellij/ide/projectView/impl/FileNestingBuilder.java:43-81`，
//    补规则那两条 for 在 `:65-76`）；
// ② 后缀匹配不分大小写（同一个文件 `:91` 与 `:163-164` 用的是 `StringUtil.endsWithIgnoreCase`），
//    基名仍按原样比（`:92` 拼出父文件名后 `parentDir.findChild()` 是精确名查找；
//    `:144-147` 的边表按 `baseName` 做键，也是精确串）。
test('传递规则：A←B 与 B←C 之间补一条 A←C（FileNestingBuilder.java:65-76）', () => {
  const rules = [
    { parent: '*.ts', children: ['*.js'] },
    { parent: '*.js', children: ['*.css'] },
  ]
  assert.deepEqual(nestingRulePairs(rules), [
    { parent: '*.ts', child: '*.js' },
    { parent: '*.js', child: '*.css' },
    { parent: '*.ts', child: '*.css' },
  ], '补出来的那条排在后面：上游也是边走边补（:55-77 的一趟循环）')
  // 本仓出厂表里就有这一对：`*.ts ← *.js`（`src/projectTreeNesting.ts:44`）与 `*.js ← *.d.ts`（`:46`）
  // ⇒ 还该有 `*.ts ← *.d.ts`，于是没有 `a.js` 时 `a.d.ts` 仍然收进 `a.ts`。
  const entries = [file('a.ts'), file('a.d.ts')]
  assert.deepEqual((nestSiblings(entries, DEFAULT_NESTING_RULES).nested.get('a.ts') ?? []).map(e => e.name), ['a.d.ts'])
})

test('空后缀与父子相等的规则不参与（FileNestingBuilder.java:58-59）', () => {
  const rules = [
    { parent: '', children: ['*.js'] },
    { parent: '*.ts', children: ['', '*.ts', '*.js'] },
  ]
  assert.deepEqual(nestingRulePairs(rules), [{ parent: '*.ts', child: '*.js' }])
})

test('后缀不分大小写、基名分（endsWithIgnoreCase :91/:163-164 与精确 findChild :92-93）', () => {
  assert.deepEqual(matchNamePattern('*.ts', 'A.TS'), ['A'])
  assert.deepEqual(matchNamePattern('package.json', 'PACKAGE.JSON'), [])
  const entries = [file('a.ts'), file('a.JS')]
  assert.deepEqual((nestSiblings(entries).nested.get('a.ts') ?? []).map(entry => entry.name), ['a.JS'])
  // 基名不同（大小写也算不同）⇒ 不认领，与上游拼出的 `app.ts` 精确查找同一口径。
  const miss = [file('App.ts'), file('app.js')]
  assert.deepEqual(nestSiblings(miss).visible.map(entry => entry.name), ['App.ts', 'app.js'])
})

test('父子同现时长的那一侧赢（FileNestingBuilder.java:166-173）', () => {
  // `a.d.ts` 同时以 `*.ts`（父）和 `*.d.ts`（子）命中同一条规则：子侧更长 ⇒ 父角色被关掉。
  assert.deepEqual(nestingRoleOf('a.d.ts', '*.ts', '*.d.ts'), { parent: false, child: true })
  // 父侧更长时反过来。
  assert.deepEqual(nestingRoleOf('a.d.ts', '*.d.ts', '*.ts'), { parent: true, child: false })
  // 只命中一侧时另一侧本来就是 false。
  assert.deepEqual(nestingRoleOf('a.ts', '*.ts', '*.d.ts'), { parent: true, child: false })
  assert.deepEqual(nestingRoleOf('a.d.ts.map', '*.ts', '*.d.ts'), { parent: false, child: false })
})
