// csi/formatter 的判据：`FormatterTagHandler`（@formatter:off / @formatter:on）的移植口径
// 与 `src/semanticActions.ts` 的接线。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  enabledFormatRanges, enabledRanges, extractFormatterTag, filterFormatEdits, formatterTagOfLine, hasFormatterTags,
  lineColumnAt, mergeFormatParts, offsetAt,
} from '../src/formatterTags.ts'

const here = dirname(fileURLToPath(import.meta.url))

const line = (text, from) => ({ start: text.indexOf(text.slice(0, 1), from), text })

test('extractFormatterTag：大小写不敏感、ON 优先于 OFF（FormatterTagHandler.java:32-58）', () => {
  assert.equal(extractFormatterTag('// @formatter:on', 0, 18), 'on')
  assert.equal(extractFormatterTag('// @FORMATTER:OFF', 0, 18), 'off')
  // 同一位置 ON 优先；先扫到的标记先返回（这里是 off，因为 on 串在它前面不匹配）。
  assert.equal(extractFormatterTag('// @formatter:on @formatter:off', 0, 31), 'on')
  assert.equal(extractFormatterTag('// @formatter:off @formatter:on', 0, 31), 'off')
  assert.equal(extractFormatterTag('// nothing', 0, 10), 'none')
  // 区间是半开的：end 之后的内容不算。
  assert.equal(extractFormatterTag('// @formatter:on', 0, 3), 'none')
  assert.equal(formatterTagOfLine('x = "@formatter:off"'), 'off')  // 上游在整行匹配，字符串里也算
})

test('enabledRanges：off 从行首禁用、on 从行首恢复（:70-106）', () => {
  const text = ['const a = 1', '// @formatter:off', 'const b   =   2', '// @formatter:on', 'const c = 3', ''].join('\n')
  const offAt = text.indexOf('// @formatter:off')
  const onAt = text.indexOf('// @formatter:on')
  const ranges = enabledRanges(text, { start: 0, end: text.length })
  assert.deepEqual(ranges, [{ start: 0, end: offAt }, { start: onAt, end: text.length }])
})

test('enabledRanges：未闭合的 off 一直禁到末尾；没有标记时整段可用', () => {
  const text = ['a', '// @formatter:off', 'b', ''].join('\n')
  const offAt = text.indexOf('// @formatter:off')
  assert.deepEqual(enabledRanges(text, { start: 0, end: text.length }), [{ start: 0, end: offAt }])
  const plain = 'a\nb\n'
  assert.deepEqual(enabledRanges(plain, { start: 0, end: plain.length }), [{ start: 0, end: plain.length }])
  assert.equal(hasFormatterTags(plain), false)
  assert.equal(hasFormatterTags(text), true)
})

test('processText 只认以换行结尾的行（上游 if (c === \n) 的原样口径）', () => {
  const withNewline = 'a\n// @formatter:off\n'
  const withoutNewline = 'a\n// @formatter:off'
  const tail = (text) => text.lastIndexOf('// @formatter:off')
  assert.deepEqual(enabledRanges(withNewline, { start: 0, end: withNewline.length }), [{ start: 0, end: tail(withNewline) }])
  // 末行无换行：上游看不见这个标记，整段仍可用 —— 照抄，不顺带修正。
  assert.deepEqual(enabledRanges(withoutNewline, { start: 0, end: withoutNewline.length }), [{ start: 0, end: withoutNewline.length }])
})

test('自定义标记名（FORMATTER_ON_TAG / FORMATTER_OFF_TAG 可被设置改名）', () => {
  const text = 'a\n// fmt off\nb\n// fmt on\nc\n'
  assert.deepEqual(enabledRanges(text, { start: 0, end: text.length }, { onTag: 'fmt on', offTag: 'fmt off' }),
    [{ start: 0, end: text.indexOf('// fmt off') }, { start: text.indexOf('// fmt on'), end: text.length }])
  // 默认标记名对这段文本不起作用。
  assert.deepEqual(enabledRanges(text, { start: 0, end: text.length }).length, 1)
})

test('offsetAt 把 LSP 的（行, 字符）换算成文本偏移；越界钳到两端', () => {
  const text = 'ab\ncde\nf'
  assert.equal(offsetAt(text, 0, 0), 0)
  assert.equal(offsetAt(text, 1, 2), 5)
  assert.equal(offsetAt(text, 2, 1), 8)
  assert.equal(offsetAt(text, 99, 0), text.length)
})

test('filterFormatEdits：禁用区间内的编辑整条丢掉，启用区间的保留', () => {
  const text = ['a', '// @formatter:off', '  b   = 1', '// @formatter:on', 'c', ''].join('\n')
  const edits = [
    { text: 'a', startLine: 0, startChar: 0, endLine: 0, endChar: 1 },       // 启用
    { text: 'b = 1', startLine: 2, startChar: 0, endLine: 2, endChar: 9 },   // 禁用
    { text: 'c', startLine: 4, startChar: 0, endLine: 4, endChar: 1 },       // 启用
  ]
  assert.deepEqual(filterFormatEdits(text, edits).map(edit => edit.text), ['a', 'c'])
  // 没有标记时原样返回（内容相等、不是同一数组）。
  const plain = 'a\nb\n'
  const plainEdits = [{ text: 'x', startLine: 0, startChar: 0, endLine: 0, endChar: 1 }]
  const out = filterFormatEdits(plain, plainEdits)
  assert.deepEqual(out, plainEdits)
  assert.notEqual(out, plainEdits)
})

test('semanticActions 的 runFormatting 真的走了这条过滤（不是只加了个模块）', () => {
  const source = readFileSync(join(here, '..', 'src', 'semanticActions.ts'), 'utf8')
  // 相对 import 必须带 `.ts`（本仓三条系统性禁令之一，node 的 strip-only 加载器不认无扩展名的**值** import），
  // 所以这里的判据从 `'./formatterTags'` 改成 `'./formatterTags.ts'` —— 断言体不变，只把形态钉准。
  assert.match(source, /import \{ filterFormatEdits \} from '\.\/formatterTags\.ts'/)
  assert.match(source, /const edits = filterFormatEdits\(base, file\.textEdits\)/)
  assert.match(source, /applyTextEdits\(base, edits\)/)
  assert.match(source, /@formatter:off/)
  // 请求侧的切分同样得真的在生产链路上（只加模块不接线 = 死代码）。
  assert.match(source, /import \{ enabledFormatRanges, mergeFormatParts \} from '\.\/formatterTags\.ts'/)
  assert.match(source, /const subRanges: LspRange\[\] = range && before !== undefined \? enabledFormatRanges\(before, range\) : \[\]/,
    '选区格式化要先把区间按禁用段切开来')
  assert.match(source, /const result = await requestFormatting\(path, range, subRanges, indent\)/)
  assert.match(source, /if \(range && before !== undefined && !subRanges\.length\)/, '整段禁用时一条请求都不发')
  assert.match(source, /await send\(subRanges\[0\]!\)/, '只切出一段时也只请求那一段（不是整个原区间）')
  assert.match(source, /return mergeFormatParts\(parts\)/)
})

// ------------------------------------------------------------------ 请求侧的区间切分
// 上游依据：`CodeFormatterFacade.setDisabledRanges`（`CodeFormatterFacade.java:232-235`，
// `:109`/`:197` 调用）把「整文件减去启用段」记成禁用区间，`InitialInfoBuilder.java:334` 对禁用区间
// 内的空白跳过处理 ⇒ 跨 `@formatter:off` 的选区**能排的那半照样排**。本仓没有本地格式化模型，
// 同一件事落在请求侧：区间切段、每段各发一次 `rangeFormatting`。

const tags = ['a = 1', '// @formatter:off', 'b   =   2', '// @formatter:on', 'c = 3', ''].join('\n')

test('lineColumnAt 是 offsetAt 的反向换算（含越界钳制与 CRLF）', () => {
  const text = 'ab\ncde\nf'
  for (const offset of [0, 1, 2, 3, 5, 6, 8, text.length]) {
    const point = lineColumnAt(text, offset)
    assert.equal(offsetAt(text, point.line, point.character), offset, `偏移 ${offset} 要能原样回来`)
  }
  assert.deepEqual(lineColumnAt(text, -7), { line: 0, character: 0 })
  assert.deepEqual(lineColumnAt(text, 99), { line: 2, character: 1 })
  // CRLF：`\r` 归前一行的内容，所以第二行的行首偏移是 4（`a b \r \n`），不是 3。
  const crlf = 'ab\r\ncd\r\n'
  assert.deepEqual(lineColumnAt(crlf, 4), { line: 1, character: 0 })
  assert.deepEqual(lineColumnAt(crlf, 5), { line: 1, character: 1 })
})

test('enabledFormatRanges：文件里没有标记 ⇒ 原样返回那一个区间（调用方走单次请求的旧路径）', () => {
  const plain = 'a = 1\nb = 2\n'
  const range = { start: { line: 0, character: 0 }, end: { line: 1, character: 6 } }
  assert.deepEqual(enabledFormatRanges(plain, range), [range])
  const custom = { start: { line: 0, character: 2 }, end: { line: 3, character: 1 } }
  assert.deepEqual(enabledFormatRanges(plain, custom, { onTag: 'fmt on', offTag: 'fmt off' }), [custom])
})

test('enabledFormatRanges：跨 off/on 的选区切成两段，端点落在标记行的行首', () => {
  const range = { start: { line: 0, character: 0 }, end: { line: 4, character: 5 } }
  assert.deepEqual(enabledFormatRanges(tags, range), [
    { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },   // 到 `// @formatter:off` 那行的行首为止
    { start: { line: 3, character: 0 }, end: { line: 4, character: 5 } },   // 从 `// @formatter:on` 那行起恢复
  ])
})

test('enabledFormatRanges：整段都在禁用区里 ⇒ 空数组（一条请求都不发）', () => {
  assert.deepEqual(enabledFormatRanges(tags, { start: { line: 1, character: 0 }, end: { line: 3, character: 0 } }), [])
  assert.deepEqual(enabledFormatRanges(tags, { start: { line: 2, character: 1 }, end: { line: 2, character: 6 } }), [])
})

test('enabledFormatRanges：起点落在禁用区里 ⇒ 只给恢复之后那一段', () => {
  assert.deepEqual(enabledFormatRanges(tags, { start: { line: 2, character: 2 }, end: { line: 4, character: 5 } }),
    [{ start: { line: 3, character: 0 }, end: { line: 4, character: 5 } }])
  // 未闭合的 off：禁到**请求区间的末尾**为止，所以只给出标记行之前的那一段。
  const unclosed = ['a', '// @formatter:off', 'b', ''].join('\n')
  assert.deepEqual(enabledFormatRanges(unclosed, { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } }),
    [{ start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }])
  // 请求区间本身就短（末尾在 off 之前）⇒ 端点按区间夹住，不会被推到下一行去。
  assert.deepEqual(enabledFormatRanges(unclosed, { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }),
    [{ start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }])
})

test('mergeFormatParts：按文件归并、相同编辑只留一条、重叠的后到条目丢掉并计数', () => {
  const head = { available: true, edits: [{ path: 'a.ts', textEdits: [{ text: 'X', startLine: 0, startChar: 0, endLine: 0, endChar: 1 }] }] }
  const same = { available: true, edits: [{ path: 'a.ts', textEdits: [{ text: 'X', startLine: 0, startChar: 0, endLine: 0, endChar: 1 }] }] }
  const tail = { available: true, edits: [
    { path: 'a.ts', textEdits: [{ text: 'Y', startLine: 4, startChar: 0, endLine: 4, endChar: 1 }] },
    { path: 'b.ts', textEdits: [{ text: 'Z', startLine: 1, startChar: 2, endLine: 1, endChar: 3 }] },
  ] }
  const merged = mergeFormatParts([head, same, tail])
  assert.equal(merged.available, true)
  assert.equal(merged.dropped, 1, '完全相同的那条被去掉')
  assert.deepEqual(merged.edits, [
    { path: 'a.ts', textEdits: [
      { text: 'X', startLine: 0, startChar: 0, endLine: 0, endChar: 1 },
      { text: 'Y', startLine: 4, startChar: 0, endLine: 4, endChar: 1 },
    ] },
    { path: 'b.ts', textEdits: [{ text: 'Z', startLine: 1, startChar: 2, endLine: 1, endChar: 3 }] },
  ])
  // 端部相接（[0,1) 与 [1,2)）不是重叠，两条都留。
  const adjacent = mergeFormatParts([head, { available: true, edits: [{ path: 'a.ts', textEdits: [
    { text: 'W', startLine: 0, startChar: 1, endLine: 0, endChar: 2 }] }] }])
  assert.equal(adjacent.edits[0].textEdits.length, 2)
  assert.equal(adjacent.dropped, 0)
  // 真重叠：后到的那条丢掉（服务器越界给出交叠编辑时，倒序套用会写坏文本）。
  const overlap = mergeFormatParts([head, { available: true, edits: [{ path: 'a.ts', textEdits: [
    { text: 'V', startLine: 0, startChar: 0, endLine: 0, endChar: 3 }] }] }])
  assert.deepEqual(overlap.edits[0].textEdits, [{ text: 'X', startLine: 0, startChar: 0, endLine: 0, endChar: 1 }])
  assert.equal(overlap.dropped, 1)
})

test('mergeFormatParts：全都不可用 ⇒ available 假、编辑空（调用方按「无需格式化」处理）', () => {
  const merged = mergeFormatParts([{ available: false }, { available: false, edits: [{ path: 'a.ts', textEdits: [] }] }])
  assert.deepEqual(merged, { available: false, edits: [], dropped: 0 })
  assert.deepEqual(mergeFormatParts([]), { available: false, edits: [], dropped: 0 })
})

