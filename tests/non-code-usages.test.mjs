// 注释与字符串里的用法（`src/nonCodeUsages.ts`）—— 上游 `TextOccurrencesUtil` /
// `UsageSearchContext`（`platform/indexing-api/.../UsageSearchContext.java:22-38`）那一层。
// 消费方：安全删除的非代码引用提示（`src/safeDelete.ts`）、重命名的「在注释和字符中搜索」、
// 查找用法的代码/注释/字符串分档。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  codeUsages, groupNonCodeUsages, nonCodeRanges, nonCodeReport, nonCodeUsageNotice, nonCodeUsages,
  occurrenceKind, occurrencesOf, NON_CODE_KIND_LABELS,
} from '../src/nonCodeUsages.ts'

const js = { line: '//', block: ['/*', '*/'] }
const py = { line: '#', block: null }
const cpp = { line: '//', block: ['/*', '*/'] }

const offsets = (list) => list.map(occurrence => occurrence.from)

test('单趟扫描：字符串里的 // 不开注释，注释里的 " 不开串', () => {
  const text = 'const a = "http://x" // 真的注释\n'
  const ranges = nonCodeRanges(text, js)
  assert.deepEqual(ranges.map(range => [range.from, range.to, range.kind]), [
    [10, 20, 'string'],
    [21, 28, 'comment'],
  ])
})

test('块注释到闭合为止；未闭合的一路算到文末', () => {
  const closed = nonCodeRanges('/* a */ x /* b', js)
  assert.deepEqual(closed.map(range => [range.from, range.to]), [[0, 7], [10, 14]])
})

test('反斜杠转义与模板串跨行', () => {
  const ranges = nonCodeRanges('a = "x\\" y" + `t\nt`', js)
  assert.deepEqual(ranges.map(range => [range.from, range.to, range.kind]), [[4, 11, 'string'], [14, 19, 'string']])
})

test('普通单双引号串不跨行，未闭合就停在行尾（不算成代码）', () => {
  const ranges = nonCodeRanges('a = "oops\nb = 1', js)
  assert.equal(ranges.length, 1)
  assert.equal(ranges[0].kind, 'string')
  assert.equal(ranges[0].to, 9)
})

test('三引号只在词边界上成立', () => {
  const text = 'x = """a"""\ny = """b'
  const ranges = nonCodeRanges(text, py)
  assert.equal(ranges.length, 2)
  assert.deepEqual(ranges.map(range => [range.from, range.to]), [[4, 11], [16, 20]])
  // 标识符后面跟的引号不是三引号：是空串 + 拼接
  assert.equal(nonCodeRanges('f"""a"""', py).length, 3)
})

test('occurrenceKind：同一份文本里三个位置的分类', () => {
  const text = 'let name = 1; // name here\nlet s = "name";\n'
  assert.equal(occurrenceKind(text, 4, js), 'code')
  assert.equal(occurrenceKind(text, text.indexOf('// name'), js), 'comment')
  assert.equal(occurrenceKind(text, text.indexOf('"name"'), js), 'string')
})

test('整词出现：foo 不匹配 foobar，注释与字符串里的都算', () => {
  const text = 'foo foobar "foo" // foo\n'
  const all = occurrencesOf(text, 'foo', js)
  assert.equal(all.length, 3)
  assert.deepEqual(all.map(occurrence => occurrence.kind), ['code', 'string', 'comment'])
  assert.deepEqual(all.map(occurrence => [occurrence.line, occurrence.character]), [[0, 0], [0, 12], [0, 20]])
})

test('档位过滤：只要注释 / 只要字符串 / 只要代码', () => {
  const text = 'foo; "foo"; // foo\n'
  assert.equal(nonCodeUsages(text, 'foo', js).length, 2)
  assert.equal(occurrencesOf(text, 'foo', js, { kind: 'comment' }).length, 1)
  assert.equal(occurrencesOf(text, 'foo', js, { kind: 'string' }).length, 1)
  assert.equal(codeUsages(text, 'foo', js).length, 1)
  assert.equal(codeUsages(text, 'foo', js)[0].character, 0)
})

test('无注释标记的语言（style=null）仍能分出字符串', () => {
  const text = 'a = "name" # name\n'
  assert.equal(occurrenceKind(text, text.indexOf('"name"'), null), 'string')
  assert.equal(occurrenceKind(text, text.indexOf('# name'), null), 'code')
  assert.equal(nonCodeUsages(text, 'name', null).length, 1)
})

test('大小写不敏感与词边界可以单独关掉', () => {
  assert.equal(occurrencesOf('Foo foo', 'foo', null, { caseSensitive: false }).length, 2)
  assert.equal(occurrencesOf('foobar', 'foo', null, { wholeWord: false }).length, 1)
  assert.equal(occurrencesOf('', 'foo', null).length, 0)
  assert.equal(occurrencesOf('foo', '', null).length, 0)
})

test('上限：达到即停（truncated 由聚合层如实上报）', () => {
  assert.equal(occurrencesOf('foo '.repeat(50), 'foo', null, { limit: 7 }).length, 7)
})

test('跨文件聚合：注释/字符串分档计数、文件数、逐条带路径', () => {
  const report = nonCodeReport([
    { path: 'a.ts', text: 'let a = 1; // target\nconst s = "target";', style: js },
    { path: 'b.ts', text: 'const t = 2; // target target\n', style: js },
  ], 'target')
  assert.equal(report.comments, 3)
  assert.equal(report.strings, 1)
  assert.equal(report.usages, 4)
  assert.equal(report.files, 2)
  assert.equal(report.truncated, false)
  assert.deepEqual(report.occurrences.map(occurrence => occurrence.path), ['a.ts', 'a.ts', 'b.ts', 'b.ts'])
})

test('聚合上限是全局的，截断如实报 true（不冒充全量）', () => {
  const files = [
    { path: 'a.ts', text: '// x x x x x', style: js },
    { path: 'b.ts', text: '// x x x x x', style: js },
  ]
  const report = nonCodeReport(files, 'x', 6)
  assert.equal(report.usages, 6)
  assert.equal(report.truncated, true)
})

test('按分类分组：先注释后字符串，同组按文件→位置', () => {
  const report = nonCodeReport([
    { path: 'z.ts', text: '"w" // w', style: js },
    { path: 'a.ts', text: '// w', style: js },
  ], 'w')
  const groups = groupNonCodeUsages(report)
  assert.deepEqual(groups.map(group => [group.kind, group.occurrences.length]), [['comment', 2], ['string', 1]])
  assert.deepEqual(groups.map(group => group.label), [NON_CODE_KIND_LABELS.comment, NON_CODE_KIND_LABELS.string])
  assert.deepEqual(groups[0].occurrences.map(occurrence => occurrence.path), ['a.ts', 'z.ts'])
  assert.deepEqual(groupNonCodeUsages({ ...report, occurrences: [] }), [])
})

test('提示语：没有非代码用法时安静，有则点出分档与后果', () => {
  const empty = nonCodeReport([{ path: 'a.ts', text: 'let a = 1;', style: js }], 'a')
  assert.equal(nonCodeUsageNotice('a.ts', empty), '')
  const report = nonCodeReport([{ path: 'a.ts', text: '// a\n"a"\n', style: js }], 'a')
  const notice = nonCodeUsageNotice('a.ts', report)
  assert.match(notice, /「a\.ts」/)
  assert.match(notice, /注释 1 处/)
  assert.match(notice, /字符串 1 处/)
  assert.match(notice, /不会编译报错/)
  const cut = nonCodeUsageNotice('a.ts', { ...report, truncated: true })
  assert.match(cut, /已达上限/)
})

test('C/C++ 的风格与 JavaScript 相同；Python 用 # 行注释', () => {
  assert.deepEqual(nonCodeRanges('int a; // a', cpp).map(range => range.kind), ['comment'])
  assert.deepEqual(nonCodeRanges('a = 1 # a\n', py).map(range => range.kind), ['comment'])
})
