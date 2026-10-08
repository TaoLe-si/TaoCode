// 「父类型 → 其成员」三跳取数的判据（`src/outlineSupertypes.ts`）。
// 上游依据都写在模块头；这里只钉行为：请求序列、逐跳失败语义、成员映射。
import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchSuperTypeMembers, toInheritedMembers } from '../src/outlineSupertypes.ts'

/** 记录每次请求的 mock；`routes` 是 `kind → 回包` 的表（缺 = 抛错，模拟这一跳失败）。
 *  回包也可以是一个函数 `(params, calls) => reply`，按调用次数给不同答案。 */
function mockRequest(routes) {
  const calls = []
  const request = async (method, params) => {
    calls.push({ method, kind: params.kind, params })
    const route = routes[params.kind ?? method]  // lsp.request 按 kind 路由；file.read / lsp.open 按方法名
    if (route === undefined) throw new Error('no route: ' + (params.kind ?? method))
    return typeof route === 'function' ? route(params, calls) : route
  }
  return { request, calls }
}

const cls = (name, kind, startLine, startChar, endLine, endChar) =>
  ({ name, kind, startLine, startChar, endLine, endChar, detail: '' })
const sym = (name, kind, startLine, startChar, endLine, endChar, detail = '') => ({ name, kind, detail, startLine, startChar, endLine, endChar })

const TARGET = sym('Child', 5, 0, 0, 20, 1)  // 要问父类型的那一类
const ROOT_ITEM = { name: 'Child', kind: 5, path: 'src/Child.java', line: 0, character: 6, raw: { server: true } }

test('happy path：三跳序列 + 父类型成员映射（path 取父类型文件）', async () => {
  const parentFile = [cls('Base', 5, 0, 0, 10, 1), sym('m1', 6, 2, 2, 4, 3, 'void m1()'), sym('f1', 8, 5, 2, 6, 3, 'int f1')]
  const { request, calls } = mockRequest({
    prepareTypeHierarchy: { available: true, items: [ROOT_ITEM] },
    typeHierarchySupertypes: { available: true, items: [{ name: 'Base', kind: 5, path: 'src/Base.java', detail: 'public class Base' }] },
    documentSymbol: { available: true, symbols: parentFile },
  })
  const out = await fetchSuperTypeMembers(request, 'src/Child.java', TARGET)
  assert.deepEqual(calls.map(c => c.kind), ['prepareTypeHierarchy', 'typeHierarchySupertypes', 'documentSymbol'],
    '三跳顺序照 runGotoSuper（navGotoSuper.ts:208-237）')
  assert.equal(calls[0].params.line, 0, 'prepare 用类符号的 startLine')
  assert.equal(calls[0].params.character, 0, 'prepare 用类符号的 startChar')
  assert.deepEqual(calls[1].params.item, ROOT_ITEM, 'supertypes 要回传 prepare 给的条目（含 raw）')
  assert.equal(calls[2].params.path, 'src/Base.java', 'documentSymbol 打在**父类型所在文件**上')
  assert.equal(out.length, 1)
  assert.equal(out[0].name, 'Base')
  assert.equal(out[0].detail, 'public class Base', '父类型自己的 detail 进 SuperTypeMembers（SuperTypeGroup.getAccessLevel 用）')
  assert.deepEqual(out[0].members.map(m => m.name), ['m1', 'f1'], '成员 = 父类型节点的**直接子节点**')
  assert.equal(out[0].members[0].path, 'src/Base.java', '成员 path 是父类型文件')
  assert.equal(out[0].members[0].detail, 'void m1()')
})

test('顺序照抄：父类在前接口在后，不重排（superTypes 约定「由近到远」）', async () => {
  const { request } = mockRequest({
    prepareTypeHierarchy: { available: true, items: [ROOT_ITEM] },
    typeHierarchySupertypes: { available: true, items: [
      { name: 'Base', kind: 5, path: 'src/Base.java' },
      { name: 'Api', kind: 11, path: 'src/Api.java' },
    ] },
    documentSymbol: { available: true, symbols: [cls('Base', 5, 0, 0, 3, 1), cls('Api', 11, 0, 0, 3, 1)] },
  })
  const out = await fetchSuperTypeMembers(request, 'src/Child.java', TARGET)
  assert.deepEqual(out.map(entry => entry.name), ['Base', 'Api'])
})

test('逐跳失败语义：任一跳空/败就停（或只跳过该父类型），不编数据', async () => {
  const prepareFail = mockRequest({})
  assert.deepEqual(await fetchSuperTypeMembers(prepareFail.request, 'a.java', TARGET), [], 'prepare 失败 → []')

  const noRoot = mockRequest({ prepareTypeHierarchy: { available: false } })
  assert.deepEqual(await fetchSuperTypeMembers(noRoot.request, 'a.java', TARGET), [], 'prepare 无条目 → []')

  const superEmpty = mockRequest({
    prepareTypeHierarchy: { available: true, items: [ROOT_ITEM] },
    typeHierarchySupertypes: { available: false, items: [] },
  })
  assert.deepEqual(await fetchSuperTypeMembers(superEmpty.request, 'a.java', TARGET), [], '无父类型 → []')

  const noPath = mockRequest({
    prepareTypeHierarchy: { available: true, items: [ROOT_ITEM] },
    typeHierarchySupertypes: { available: true, items: [
      { name: 'Lib', kind: 5 },                          // 库里类型：没有 path
      { name: 'Base', kind: 5, path: 'src/Base.java' },  // 有 path
    ] },
    documentSymbol: { available: true, symbols: [cls('Base', 5, 0, 0, 3, 1), sym('m', 6, 1, 2, 2, 2)] },
  })
  const kept = await fetchSuperTypeMembers(noPath.request, 'src/Child.java', TARGET)
  assert.deepEqual(kept.map(entry => entry.name), ['Base'], '无 path 的父类型跳过，其余照收')
})

test('documentSymbol 失败/不可用 = 只跳过这一个父类型', async () => {
  const routes = {
    prepareTypeHierarchy: { available: true, items: [ROOT_ITEM] },
    typeHierarchySupertypes: { available: true, items: [{ name: 'Base', kind: 5, path: 'src/Base.java' }] },
  }
  const { request } = mockRequest(routes)  // documentSymbol 无路由 = 抛错
  assert.deepEqual(await fetchSuperTypeMembers(request, 'src/Child.java', TARGET), [])
  const { request: request2 } = mockRequest({ ...routes, documentSymbol: { available: false } })
  assert.deepEqual(await fetchSuperTypeMembers(request2, 'src/Child.java', TARGET), [])
})

test('未打开的文件：documentSymbol 回 available:false ⇒ 按需 file.read + lsp.open 补一次再问（真机 root cause 的回归）', async () => {
  const parentFile = [cls('Base', 5, 0, 0, 9, 1), sym('m1', 6, 2, 2, 4, 3, 'void m1()')]
  const { request, calls } = mockRequest({
    prepareTypeHierarchy: { available: true, items: [ROOT_ITEM] },
    typeHierarchySupertypes: { available: true, items: [{ name: 'Base', kind: 5, path: 'src/Base.java' }] },
    'file.read': { path: 'src/Base.java', content: 'package p;\nclass Base { void m1() {} }\n', version: 'v1', encoding: 'utf8', bom: false },
    'lsp.open': { ok: true },
    // 打开过之前回 available:false，`lsp.open` 之后才给符号表。
    documentSymbol: (params, seen) => seen.some(call => call.method === 'lsp.open')
      ? { available: true, symbols: parentFile }
      : { available: false },
  })
  const out = await fetchSuperTypeMembers(request, 'src/Child.java', TARGET)
  assert.deepEqual(calls.map(c => c.method),
    ['lsp.request', 'lsp.request', 'lsp.request', 'file.read', 'lsp.open', 'lsp.request'],
    '顺序：两跳层级 → documentSymbol 未命中 → file.read → lsp.open → 重问')
  assert.equal(calls[4].params.path, 'src/Base.java')
  assert.equal(calls[4].params.text, 'package p;\nclass Base { void m1() {} }\n', 'lsp.open 吃的文本来自 file.read')
  assert.deepEqual(out.map(entry => entry.name), ['Base'], '补开后成员到位')
  assert.deepEqual(out[0].members.map(m => m.name), ['m1'])
})

test('补开也失败（file.read 取不到）⇒ 仍然只跳过，不编成员', async () => {
  const { request } = mockRequest({
    prepareTypeHierarchy: { available: true, items: [ROOT_ITEM] },
    typeHierarchySupertypes: { available: true, items: [{ name: 'Base', kind: 5, path: 'src/Base.java' }] },
    documentSymbol: { available: false },
    // file 无路由 = 抛错
  })
  assert.deepEqual(await fetchSuperTypeMembers(request, 'src/Child.java', TARGET), [])
})

test('父类型定位：名字对不上时退回「区间包含 selectionRange 起点」', async () => {
  const file = [cls('AbstractBase', 5, 0, 0, 9, 1), sym('x', 8, 3, 2, 4, 3)]
  const { request } = mockRequest({
    prepareTypeHierarchy: { available: true, items: [ROOT_ITEM] },
    typeHierarchySupertypes: { available: true, items: [{ name: 'Base', kind: 5, path: 'src/Base.java', line: 1, character: 4 }] },
    documentSymbol: { available: true, symbols: file },
  })
  const out = await fetchSuperTypeMembers(request, 'src/Child.java', TARGET)
  assert.deepEqual(out.map(entry => entry.name), ['Base'], '名字不一致仍可用区间定位')
  assert.deepEqual(out[0].members.map(m => m.name), ['x'])
})

test('toInheritedMembers：缺区间的符号不映射（不编 0,0）', () => {
  const out = toInheritedMembers([
    { name: 'a', kind: 6 },                                             // 只有名字与 kind（LspSymbolsResult Partial）
    sym('b', 8, 1, 2, 3, 4, 'int b'),
  ], 'src/X.java')
  assert.deepEqual(out.map(m => m.name), ['b'])
  assert.equal(out[0].path, 'src/X.java')
  assert.equal('detail' in sym('c', 8, 0, 0, 1, 1), true)
  assert.equal(toInheritedMembers([sym('c', 8, 0, 0, 1, 1, '')], 'p')[0].detail, undefined, '空 detail 不给字段')
})
