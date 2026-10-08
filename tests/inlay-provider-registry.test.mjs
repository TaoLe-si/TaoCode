// 判据 · lp/inlay-hints 的**本地提供者注册表**（`InlayHintsProvider` EP 的等价物）。
//
// 钉四件事：
//   ① 三个内置提供者（urlPath / parameterName / lineAuthor）各自的行为口径（不产假条目）；
//   ② 注册表按语言过滤 + 同位置同文本去重；
//   ③ 与服务端条目的合流（本地优先、同键去重）；
//   ④ 本地条目与 `layoutInlayHints` 的归位链兼容（形状一致、能进同一条链）。
import test from 'node:test'
import assert from 'node:assert/strict'

import { layoutInlayHints } from '../src/inlayHintLayout.ts'
import {
  createInlayProviderRegistry,
  lineAuthorInlayProvider,
  mergeInlayHints,
  parameterNameInlayProvider,
  urlPathInlayProvider,
  urlPathOf,
} from '../src/inlayProviderRegistry.ts'

const ctx = (over = {}) => ({ path: 'a.ts', language: 'typescript', text: '', ...over })

test('urlPath：剥掉协议与主机名，只留路径；没有路径就不产条目', () => {
  assert.equal(urlPathOf('https://example.com/api/users'), '/api/users')
  assert.equal(urlPathOf('/local/path'), '/local/path')
  assert.equal(urlPathOf('https://example.com'), '', '没有路径 ⇒ 空串')
  assert.equal(urlPathOf('https://example.com/'), '', '裸根路径也是空')
  const provider = urlPathInlayProvider()
  const hints = provider.collect(ctx({ text: `fetch('https://api.example.com/v1/items')\nconst x = '/a/b'\n` }))
  assert.deepEqual(hints.map(hint => hint.label), ['/v1/items', '/a/b'])
  // 锚点在结束引号之后（`fetch('...')` 那一行）。
  assert.equal(hints[0].line, 0)
  assert.equal(hints[0].character, `fetch('https://api.example.com/v1/items'`.length)
})

test('urlPath：注释起始、除法、正则字面量不算 URL', () => {
  const provider = urlPathInlayProvider()
  const hints = provider.collect(ctx({ text: `const a = 4 / 2\n// /not/a/path\nconst re = /^\\d+/\n` }))
  assert.deepEqual(hints, [], '这三种都不是 URL 字面量')
})

test('parameterName：同文件声明的调用点按形参名补实参', () => {
  const provider = parameterNameInlayProvider()
  const text = [
    'function move(x, y) { return x + y }',
    'const draw = (w, h) => w * h',
    'move(3, 4)',
    'draw(10, 20)',
  ].join('\n')
  const hints = provider.collect(ctx({ text }))
  // 声明行不产条目；两个调用点各补两条（3→x, 4→y, 10→w, 20→h）。
  assert.deepEqual(hints.map(hint => `${hint.line}:${hint.label}`), ['2:x', '2:y', '3:w', '3:h'])
  assert.ok(hints.every(hint => hint.kind === 2), '参数名提示的 kind = 2')
})

test('parameterName：实参数量与形参不等就整条不产（不挪错位）', () => {
  const provider = parameterNameInlayProvider()
  const hints = provider.collect(ctx({ text: 'function f(a, b) {}\nf(1)\nf(1, 2, 3)\n' }))
  assert.deepEqual(hints, [], '参数个数不匹配 ⇒ 一条都不出')
})

test('parameterName：解构/剩余形参取不出名字 ⇒ 那一条不出', () => {
  const provider = parameterNameInlayProvider()
  const hints = provider.collect(ctx({ text: 'function f({a}, ...rest) {}\nf(1, 2)\n' }))
  assert.deepEqual(hints, [], '形参名取不全 ⇒ 整条不出')
})

test('parameterName：嵌套括号/字符串里的逗号不算实参分隔符', () => {
  const provider = parameterNameInlayProvider()
  const hints = provider.collect(ctx({ text: 'function g(a, b) {}\ng(fn(1, 2), "x, y")\n' }))
  assert.deepEqual(hints.map(hint => hint.label), ['a', 'b'])
})

test('lineAuthor：只在顶层声明行出行尾作者；没有 authors 就不产', () => {
  const provider = lineAuthorInlayProvider()
  assert.deepEqual(provider.collect(ctx({ text: 'function f() {}\n' })), [], '没有 blame 数据 ⇒ 一条都不出')
  const text = ['function f() {}', 'const x = 1', 'class Foo {}'].join('\n')
  const hints = provider.collect(ctx({ text, authors: [{ line: 0, author: 'Alice' }, { line: 1, author: 'Bob' }, { line: 2, author: 'Carol' }] }))
  // `const x = 1` 不是声明行 ⇒ 不出；两条声明行出行尾作者。
  assert.deepEqual(hints.map(hint => `${hint.line}:${hint.label}`), ['0:Alice', '2:Carol'])
})

test('注册表：按语言过滤，未注册语言的提供者不跑', () => {
  const registry = createInlayProviderRegistry([
    { id: 'onlyJava', languages: ['java'], isAvailableFor: () => true, collect: () => [{ line: 0, character: 0, label: 'J' }] },
    urlPathInlayProvider(),
  ])
  const hints = registry.collectAll(ctx({ language: 'typescript', text: `'/x/y'` }))
  assert.deepEqual(hints.map(hint => hint.label), ['/x/y'], 'java 专属提供者在 ts 上不跑')
})

test('注册表：同位置同文本去重（两个提供者产同一条只留一份）', () => {
  const registry = createInlayProviderRegistry([
    { id: 'a', isAvailableFor: () => true, collect: () => [{ line: 1, character: 2, label: 'dup' }] },
    { id: 'b', isAvailableFor: () => true, collect: () => [{ line: 1, character: 2, label: 'dup' }, { line: 1, character: 2, label: 'other' }] },
  ])
  assert.deepEqual(registry.collectAll(ctx()).map(hint => hint.label), ['dup', 'other'])
})

test('合流：同位置同文本以本地为准，其余服务端条目全保留', () => {
  const local = [{ line: 0, character: 0, label: 'L', kind: 2 }]
  const server = [{ line: 0, character: 0, label: 'L', kind: 1 }, { line: 0, character: 0, label: 'S', kind: 1 }]
  const merged = mergeInlayHints(local, server)
  assert.deepEqual(merged.map(hint => hint.label), ['L', 'S'])
  assert.equal(merged[0].kind, 2, '同键的那条以本地为准')
})

test('本地条目能进 layoutInlayHints 的同一条链（形状一致、同位置参数名优先于类型）', () => {
  const local = [{ line: 0, character: 3, label: 'x', kind: 2 }]
  const server = [{ line: 0, character: 3, label: 'int', kind: 1 }]
  const merged = mergeInlayHints(local, server)
  const layout = layoutInlayHints(merged, { type: true, parameter: true, other: true })
  assert.equal(layout.hints.length, 1, '同位置只留一条')
  assert.equal(layout.hints[0].label, 'x', '参数名（kind=2）优先于类型（kind=1）')
  assert.equal(layout.hidden.conflict, 1)
})

test('注册表默认装三个内置提供者；同 id 覆盖注册', () => {
  const registry = createInlayProviderRegistry()
  assert.deepEqual(registry.providers().map(provider => provider.id), ['urlPath', 'parameterName', 'lineAuthor'])
  registry.register({ id: 'urlPath', isAvailableFor: () => true, collect: () => [] })
  assert.equal(registry.providers().length, 3, '同 id 覆盖不新增')
  assert.deepEqual(registry.providers().find(provider => provider.id === 'urlPath').collect(ctx()), [])
})
