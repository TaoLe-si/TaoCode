// csi/formatter 的判据：`FormatterTagHandler`（@formatter:off / @formatter:on）的移植口径
// 与 `src/semanticActions.ts` 的接线。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  enabledRanges, extractFormatterTag, filterFormatEdits, formatterTagOfLine, hasFormatterTags, offsetAt,
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
})
