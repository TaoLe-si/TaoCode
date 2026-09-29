// `src/semanticTokens.ts` 的两个重点是**相对 vs 绝对**的位置语义和 legend 表的顺序：
//   · 解码：`data` 每 5 个一组 [deltaLine, deltaStartChar, length, tokenType, tokenModifiers]，
//     deltaLine === 0 时 deltaStartChar 是**相对**上一个 token 的列，否则是**绝对**列；
//   · legend：tokenType/tokenModifiers 都是**索引**，客户端声明的表和服务器声明的表
//     逐项同序才有意义，错位会让"关键字"显示成"数字"。
// 最后一条测试直接读原生 initialize 的能力表核对那张表（在 native/lsp_host_bootstrap.cpp）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const {
  SEMANTIC_TOKEN_MODIFIERS, SEMANTIC_TOKEN_TYPES, applySemanticTokenEdits,
  decodeSemanticTokens, semanticTokenClass, tokenTypeKnown,
} = await import('../src/semanticTokens.ts')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('同一行内 deltaStartChar 是相对上一个 token 的列', () => {
  // 两个 token：offset 0 长度 5；然后相对 +6 → offset 6，长度 3。
  const tokens = decodeSemanticTokens([0, 0, 5, 15, 0, 0, 6, 3, 8, 0])
  assert.deepEqual(tokens.map(t => [t.line, t.startChar, t.length]), [[0, 0, 5], [0, 6, 3]])
  assert.equal(tokens[0].type, 'keyword', 'index 15 是 keyword')
  assert.equal(tokens[1].type, 'variable', 'index 8 是 variable')
})

test('换行后 deltaStartChar 是绝对列（这是最容易写反的一处）', () => {
  // 第 3 个 token：deltaLine 2 → 第 2 行；deltaStartChar 4 是**绝对**列，不是 6+4。
  const tokens = decodeSemanticTokens([0, 0, 5, 15, 0, 0, 6, 3, 8, 0, 2, 4, 7, 12, 0])
  assert.deepEqual(tokens.map(t => [t.line, t.startChar]), [[0, 0], [0, 6], [2, 4]])
  assert.equal(tokens[2].type, 'function')
})

test('tokenModifiers 是位掩码，按位映射到名字', () => {
  // 12 = 0b1100 → bit2 (readonly) + bit3 (static)；顺序按位升序，不是按服务器给的顺序。
  const [token] = decodeSemanticTokens([0, 0, 3, 8, 12])
  assert.deepEqual(token.modifiers, ['readonly', 'static'])
  assert.equal(semanticTokenClass(token), 'cm-sem-variable cm-sem-mod-readonly cm-sem-mod-static')
  // 0 就是没有任何修饰符 —— 不要凭空塞一个名字进去。
  assert.deepEqual(decodeSemanticTokens([0, 0, 3, 8, 0])[0].modifiers, [])
})

test('畸形 data 不会抛异常，也不会编造 token', () => {
  // 长度不是 5 的倍数：尾部残缺的那一组丢掉，前面的照常解出来。
  assert.equal(decodeSemanticTokens([0, 0, 5, 15, 0, 1, 2]).length, 1)
  assert.deepEqual(decodeSemanticTokens([]), [])
  assert.deepEqual(decodeSemanticTokens(undefined), [])
  assert.deepEqual(decodeSemanticTokens(null), [])
  // 表外的 tokenType 索引：类型名回空串（`semanticTokenClass` 会因此只输出修饰符），
  // 而不是编一个名字去撞上别的颜色类。
  const [odd] = decodeSemanticTokens([0, 0, 1, 999, 0])
  assert.equal(odd.type, '')
  assert.equal(semanticTokenClass(odd), '')
  assert.equal(tokenTypeKnown(999), false)
  assert.equal(tokenTypeKnown(0), true)
  // 修饰符位掩码里的高位（超出表长）被忽略，不产生 `cm-sem-mod-undefined`。
  assert.deepEqual(decodeSemanticTokens([0, 0, 1, 0, 1 << 20])[0].modifiers, [])
})

test('delta 按下标降序应用，多个 edit 不会互相错位', () => {
  const base = [0, 0, 5, 15, 0, 0, 6, 3, 8, 0, 2, 4, 7, 12, 0]
  // 从下标 10 起删 5 个、插入一条新的。
  assert.deepEqual(applySemanticTokenEdits(base, [{ start: 10, deleteCount: 5, data: [2, 4, 9, 8, 0] }]),
    [0, 0, 5, 15, 0, 0, 6, 3, 8, 0, 2, 4, 9, 8, 0])
  // 两个 edit 且**乱序给出**：降序应用的结果必须与顺序无关（`start` 是原数组下标）。
  const two = [{ start: 0, deleteCount: 5, data: [1, 1, 1, 1, 1] }, { start: 10, deleteCount: 5, data: [2, 2, 2, 2, 2] }]
  const expected = [1, 1, 1, 1, 1, 0, 6, 3, 8, 0, 2, 2, 2, 2, 2]
  assert.deepEqual(applySemanticTokenEdits(base, two), expected)
  assert.deepEqual(applySemanticTokenEdits(base, [...two].reverse()), expected, '顺序不该影响结果')
})

test('delta 的越界下标被夹住，且不改动入参', () => {
  const base = [1, 2, 3, 4, 5]
  assert.deepEqual(applySemanticTokenEdits(base, [{ start: 99, deleteCount: 5, data: [9] }]), [1, 2, 3, 4, 5, 9])
  assert.deepEqual(applySemanticTokenEdits(base, [{ start: 2, deleteCount: 99 }]), [1, 2])
  assert.deepEqual(applySemanticTokenEdits(base, [{ start: -5, deleteCount: 1, data: [0] }]), [0, 2, 3, 4, 5])
  assert.deepEqual(applySemanticTokenEdits(base, []), base)
  assert.deepEqual(applySemanticTokenEdits(base, undefined), base)
  assert.deepEqual(base, [1, 2, 3, 4, 5], '入参数组不能被就地改动（调用方还留着它做下一轮 delta）')
  // 没有 data 的 edit 就是纯删除。
  assert.deepEqual(applySemanticTokenEdits(base, [{ start: 1, deleteCount: 2 }]), [1, 4, 5])
})

test('legend 表与原生 initialize 里声明的表逐项同序', () => {
  // 索引错位不会报错，只会让颜色整体串位 —— 只能机检。
  // 能力表随 `Session::ensure()` 一起搬到了 native/lsp_host_bootstrap.cpp，两处都要看。
  const native = ['native/lsp_session.cpp', 'native/lsp_host_bootstrap.cpp']
    .map(file => readFileSync(join(root, file), 'utf8')).join(String.fromCharCode(10))
  const section = native.slice(native.indexOf('{"semanticTokens",'))
  const types = section.match(/"tokenTypes", Json::array\(\{([^}]*)\}\)/)
  const modifiers = section.match(/"tokenModifiers", Json::array\(\{([^}]*)\}\)/)
  assert.ok(types && modifiers, '在 lsp_session.cpp / lsp_host_bootstrap.cpp 里找不到 semanticTokens 的 legend 声明')
  const parse = text => [...text.matchAll(/"([A-Za-z]+)"/g)].map(match => match[1])
  assert.deepEqual(parse(types[1]), [...SEMANTIC_TOKEN_TYPES], 'tokenTypes 的顺序必须一致')
  assert.deepEqual(parse(modifiers[1]), [...SEMANTIC_TOKEN_MODIFIERS], 'tokenModifiers 的顺序必须一致')
})
