// 符号型文档 target（`src/docSymbolTarget.ts`）—— 上游
// `platform/lang-impl/src/com/intellij/lang/documentation/symbol/impl/DefaultTargetSymbolDocumentationTargetProvider.kt:18-20`
// 在本仓的等价物：文档里的一个**引用名**落成「一个能取文档的位置」。
//
// 上游那条链（判决 `lp/documentation` 的「缺：符号型 target」点名的那一条）：
//   · `documentationTargets(file, offset)` → `targetSymbols(file, offset)`（PSI 把引用解析成 `Symbol`）
//     → `symbolDocumentationTargets(project, symbols)`（`:27-41`）；
//   · 本仓没有 PSI，但有同一链的两半，都是服务器给的真数据：
//     ①「符号名 → 声明位置」= LSP `workspace/symbol` + `documentSymbol`；
//     ②「位置 → 文档」= LSP `textDocument/hover`（`src/docHoverContent.ts` 那一条，带缓存）。
// ⇒ 拆不出名字或名字对不上就返回 `null`，由调用方给那句实话；**不猜位置**。

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isSymbolDocReference, parseDocReference, resolveDocSymbolTarget,
} from '../src/docSymbolTarget.ts'

/** 「Foo 在 b.java，成员 helper 查不到」这一份假服务器。 */
function queries(options = {}) {
  const inFile = new Map(Object.entries(options.inFile ?? {}))
  const global = new Map(Object.entries(options.global ?? {}))
  const asked = { file: [], workspace: [] }
  return {
    asked,
    api: {
      symbolsInFile: async path => {
        asked.file.push(path)
        return inFile.get(path) ?? []
      },
      workspaceSymbols: async query => {
        asked.workspace.push(query)
        return global.get(query) ?? []
      },
    },
  }
}

const fact = (name, path, line, character, kind = 5) => ({ name, kind, path, line, character })

test('引用语法的四种形态都吃得下，参数表只用于显示不参与匹配', () => {
  assert.deepEqual(parseDocReference('Foo#bar(int)'), { container: 'Foo', member: 'bar', parameters: '(int)' })
  assert.deepEqual(parseDocReference('Foo.bar'), { container: 'Foo', member: 'bar', parameters: '' })
  assert.deepEqual(parseDocReference('#bar'), { container: '', member: 'bar', parameters: '' })
  assert.deepEqual(parseDocReference('pkg.sub.Foo'), { container: 'pkg.sub', member: 'Foo', parameters: '' })
  assert.deepEqual(parseDocReference('Foo'), { container: 'Foo', member: '', parameters: '' })
  assert.deepEqual(parseDocReference('Foo#new'), { container: 'Foo', member: '', parameters: '' }, '构造器引用查的是容器')
  assert.equal(parseDocReference(''), null, '空串没有名字可查')
  assert.equal(parseDocReference('()'), null, '纯参数表也没有')
})

test('两步解析，顺序与上游一致：先定位容器，再在那个文件里找成员', async () => {
  const q = queries({
    global: { Foo: [fact('Foo', 'src/b.java', 9, 2)] },
    inFile: { 'src/b.java': [fact('Foo', 'src/b.java', 9, 2), fact('helper', 'src/b.java', 14, 6, 6)] },
  })
  const target = await resolveDocSymbolTarget('Foo#helper(int)', 'src/a.java', q.api)
  assert.deepEqual(target, { path: 'src/b.java', line: 14, character: 6, symbol: 'helper', origin: 'Foo#helper' })
  assert.deepEqual(q.asked.workspace, ['Foo'], '第一步查的是容器')
  assert.deepEqual(q.asked.file, ['src/b.java'], '第二步才在那个文件里找成员')
})

test('容器找到了但成员不在那个文件里：落回容器的文档，origin 也照实写容器名', async () => {
  const q = queries({
    global: { Foo: [fact('Foo', 'src/b.java', 9, 2)] },
    inFile: { 'src/b.java': [fact('Foo', 'src/b.java', 9, 2)] },
  })
  const target = await resolveDocSymbolTarget('Foo#helper', 'src/a.java', q.api)
  assert.equal(target.path, 'src/b.java')
  assert.equal(target.symbol, 'Foo')
  assert.equal(target.origin, 'Foo', '显示的是 Foo 的文档就标 Foo，不假装是 Foo#helper（上游这时沿继承图找，本仓没有那张图）')
})

test('自引用 `#bar` 只在当前文件里找，找不到就是找不到', async () => {
  const q = queries({ inFile: { 'src/a.java': [fact('bar', 'src/a.java', 3, 8, 6)] } })
  assert.deepEqual(await resolveDocSymbolTarget('#bar', 'src/a.java', q.api), {
    path: 'src/a.java', line: 3, character: 8, symbol: 'bar', origin: 'bar',
  })
  const empty = queries({})
  assert.equal(await resolveDocSymbolTarget('#nope', 'src/a.java', empty.api), null)
  assert.deepEqual(empty.asked.workspace, [], '自引用不该跑去查工作区（那是另一个符号）')
})

test('单个名字：先当前文件（{@link bar} 多数指同类成员），查不着再走 workspace/symbol', async () => {
  const inFile = queries({ inFile: { 'src/a.java': [fact('bar', 'src/a.java', 7, 4, 6)] } })
  const first = await resolveDocSymbolTarget('bar', 'src/a.java', inFile.api)
  assert.equal(first.line, 7)
  assert.deepEqual(inFile.asked.workspace, [], '文件里已经有就不必问服务器')
  const global = queries({ global: { Foo: [fact('pkg.other.Foo', 'src/c.java', 1, 10)] } })
  const second = await resolveDocSymbolTarget('Foo', 'src/a.java', global.api)
  assert.equal(second.path, 'src/c.java')
  assert.equal(second.symbol, 'pkg.other.Foo', 'workspace 常回全限定名，末段对上就是同一个类型')
})

test('名字档位：精确 > 忽略大小写 > 末段 > 前缀 > 包含；全都对不上就 null', async () => {
  const q = queries({ global: { Foo: [fact('FooBar', 'src/x.java', 1, 0), fact('foo', 'src/y.java', 2, 0), fact('pkg.Foo', 'src/z.java', 3, 4)] } })
  const target = await resolveDocSymbolTarget('Foo', 'src/a.java', q.api)
  assert.equal(target.path, 'src/y.java', '忽略大小写的同名赢过末段与前缀')
  const segments = queries({ global: { Foo: [fact('FooBar', 'src/x.java', 1, 0), fact('pkg.Foo', 'src/z.java', 3, 4)] } })
  const second = await resolveDocSymbolTarget('Foo', 'src/a.java', segments.api)
  assert.equal(second.path, 'src/z.java', '末段精确（pkg.Foo）赢过前缀（FooBar）')
  assert.equal(second.character, 4)
  const none = queries({ global: { Foo: [fact('Unrelated', 'src/b.java', 1, 0)] } })
  assert.equal(await resolveDocSymbolTarget('Foo', 'src/a.java', none.api), null, '不拿不相干的名字冒充命中')
})

test('哪些链接算符号引用：带路径分隔符与 file:/外部/锚点都不算', () => {
  assert.equal(isSymbolDocReference({ kind: 'internal', target: 'Foo#bar' }), true)
  assert.equal(isSymbolDocReference({ kind: 'internal', target: 'Foo' }), true)
  assert.equal(isSymbolDocReference({ kind: 'internal', target: 'src/Foo.java' }), false, '带路径的是**导航**那条链，拿它当符号查会得出一个叫 java 的「成员」')
  assert.equal(isSymbolDocReference({ kind: 'internal', target: 'src\\Foo.java' }), false)
  assert.equal(isSymbolDocReference({ kind: 'internal', target: 'file:///C:/x/A.java' }), false)
  assert.equal(isSymbolDocReference({ kind: 'external', target: 'Foo' }), false)
  assert.equal(isSymbolDocReference({ kind: 'anchor', target: '#Foo' }), false)
  assert.equal(isSymbolDocReference(null), false)
})

test('假数据的边界：残缺条目（没名字/没路径/行号不是数）都不算命中', async () => {
  const q = queries({ global: { Foo: [{ name: '', kind: 5, path: 'src/b.java', line: 1, character: 0 }, { name: 'Foo', kind: 5, path: '', line: 1, character: 0 }, { name: 'Foo', kind: 5, path: 'src/c.java', line: Number.NaN, character: 0 }, fact('Foo', 'src/d.java', 5, 1)] } })
  const target = await resolveDocSymbolTarget('Foo', 'src/a.java', q.api)
  assert.equal(target.path, 'src/d.java', '只有字段齐全的那条能用')
})
