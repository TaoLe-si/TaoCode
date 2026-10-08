// 编辑器查找栏的**选项组合**判据（上游 `FindModel` + `FindManagerBase` + `RegExReplacementBuilder`）。
//
// 这一批补的是四件事的**组合**：
//   ① 全词在正则档也要过滤（上游 `FindManagerBase.findStringLoop:110-112` 对两条路径统一过滤）；
//   ② 全词判词用的是 Java 标识符字符（`:247-276`），不是 JS `\b`（`\b` 只认 ASCII `\w`）；
//   ③ 替换串的正则展开 `$1`/`${name}`/`\n`/`\xNNNN`/`\L…\E`（`RegExReplacementBuilder`）；
//   ④ 保留大小写套在**展开后**的替换文本上（`FindManagerBase:288-299` 的顺序）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collectSearchMatches, isWholeWordMatch, regexMatchAt, DEFAULT_SEARCH_OPTIONS } from '../src/editorSearch.ts'
import { createReplacement, replacementFromMatch } from '../src/regexReplacement.ts'

const opts = patch => ({ ...DEFAULT_SEARCH_OPTIONS, ...patch })
const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

// —— ① 全词：两条路径统一过滤 ——

test('whole words filters the regex path too', () => {
  const text = 'cat category'
  // 字面量档（既有的那条路）。
  assert.equal(collectSearchMatches(text, 'cat', opts({ wholeWords: true })).length, 1)
  // 正则档：上游 `FindManagerBase` 一样过滤（本仓此前只在字面量档加 \b）。
  assert.equal(collectSearchMatches(text, 'c.t', opts({ regex: true, wholeWords: true })).length, 1)
  assert.equal(collectSearchMatches(text, 'c.t', opts({ regex: true })).length, 2)
})

test('a rejected whole-word match does not consume the highlight limit', () => {
  // 前两处坏命中被全词拒掉后，额度要留给真正合格的这一处。
  const found = collectSearchMatches('scat cat', 'cat', opts({ wholeWords: true }), 1)
  assert.deepEqual(found, [{ from: 5, to: 8 }])
})

// —— ② 标识符字符：Unicode 与 `$` 都是词字符（Java `isJavaIdentifierPart`）——

test('whole words understands non-ASCII identifiers', () => {
  assert.equal(isWholeWordMatch('中文', 0, 2), true, '整段就是这个词时是全词')
  assert.equal(isWholeWordMatch('中文词', 0, 2), false, '「中文」在标识符里不是全词')
  assert.equal(isWholeWordMatch('一个中文', 2, 4), false, '前面紧跟标识符字符（个）也不是')
  assert.equal(collectSearchMatches('中文 中文词', '中文', opts({ wholeWords: true })).length, 1)
})

test('whole words treats $ and _ as identifier parts', () => {
  assert.equal(isWholeWordMatch('$foo', 1, 4), false, '$foo 里的 foo 不是全词')
  assert.equal(isWholeWordMatch('a foo', 2, 5), true)
  assert.equal(isWholeWordMatch('foo_bar', 0, 3), false, '_ 是词字符（Java Pc）')
})

test('whole words follows the escaped-prefix rule', () => {
  // `FindManagerBase.java:251-252`：前一个词字符前面紧跟 `\\` 时，它不算词字符。
  assert.equal(isWholeWordMatch('a\\cat', 2, 5), true, '\\c 的前缀让它成为词首')
  assert.equal(isWholeWordMatch('ab cat', 3, 6), true)
})

test('a non-identifier match anchors on character difference', () => {
  // `(` 不是标识符字符：要求前一个字符与它**不同**（`:256` 的 else 分支）。
  assert.equal(isWholeWordMatch('a(b', 1, 2), true)
  assert.equal(isWholeWordMatch('((b', 1, 2), false, '前一个字符相同 ⇒ 拒绝')
})

test('whole-word rejection is applied before the n/m count', () => {
  const matches = collectSearchMatches('cat category cat', 'cat', opts({ wholeWords: true }))
  assert.deepEqual(matches.map(m => m.from), [0, 13])
})

// —— ③ 替换模板展开 ——

test('group references use the whole match and numbered groups', () => {
  assert.equal(createReplacement('$1-$2', ['ab', 'a', 'b']), 'a-b')
  assert.equal(createReplacement('[$0]', ['ab']), '[ab]', '$0 是整段命中（Java Matcher 的编号）')
  assert.throws(() => createReplacement('[$&]', ['ab']), /Illegal group reference/,
    '上游只认 $n/${name} 与反斜杠转义，$& 不是合法引用')
  // 最长合法组号：`$12` 在只有 2 个组时退成 `$1` + 字面 `2`（Matcher 的规则）；
  // 组数够时 `$12` 就是第 12 组。
  assert.equal(createReplacement('$12', ['x', 'A']), 'A2')
  const twelve = ['m', ...Array.from({ length: 12 }, (_, i) => String(i + 1))]
  assert.equal(createReplacement('$12', twelve), '12')
  assert.equal(createReplacement('$2', ['m', 'A', 'B']), 'B')
})

test('named groups expand and malformed templates throw', () => {
  assert.equal(createReplacement('${word}!', ['ab'], { word: 'ab' }), 'ab!')
  assert.throws(() => createReplacement('${}', ['ab'], {}))
  assert.throws(() => createReplacement('${1x}', ['ab'], {}), /starts with digit/)
  assert.throws(() => createReplacement('$', ['ab']), /group index is missing/)
  assert.throws(() => createReplacement('\\', ['ab']), /escaped is missing/)
})

test('escape sequences become real characters', () => {
  assert.equal(createReplacement('a\\nb', ['']), 'a\nb')
  assert.equal(createReplacement('a\\tb', ['']), 'a\tb')
  assert.equal(createReplacement('\\x0041\\x0042', ['']), 'AB')
  assert.equal(createReplacement('a\\qb', ['']), 'aqb', '不认识的转义去掉反斜杠')
  // 解析失败时不追加任何东西，那 4 位按普通字符走（上游 catch 不前进 cursor）。
  assert.equal(createReplacement('\\xZZ00', ['']), 'ZZ00')
})

test('case conversion regions follow the upstream state machine', () => {
  assert.equal(createReplacement('\\lABC', ['']), 'aBC', '\\l 只转下一个字符')
  assert.equal(createReplacement('\\uabc', ['']), 'Abc')
  assert.equal(createReplacement('\\LABC\\Edef', ['']), 'abcdef')
  assert.equal(createReplacement('\\Uabc\\Edef', ['']), 'ABCdef')
  // 区域未闭合 ⇒ 一直管到模板末尾（`generateResult` 的夹取）。
  assert.equal(createReplacement('x\\Uabc', ['']), 'xABC')
  // 后出现的区域覆盖前一个的开口（`startConversionForRegion` 的 lastRegion.start == currentOffset 分支）。
  assert.equal(createReplacement('\\Uab\\Lcd', ['']), 'ABcd')
})

test('replacementFromMatch wraps a real exec array', () => {
  const match = /(?<word>\w+)!/.exec('hey!')
  assert.ok(match)
  assert.equal(replacementFromMatch('[$1]', match, match.groups), '[hey]')
  assert.equal(replacementFromMatch('${word}?', match, match.groups), 'hey?')
  assert.equal(replacementFromMatch('$9', match, match.groups), '', '不存在的组展开为空')
})

test('regexMatchAt finds the occurrence that starts exactly at the offset', () => {
  const text = 'cat category'
  assert.equal(regexMatchAt(text, 'cat', opts({ regex: true }), 4)?.index, 4)
  assert.equal(regexMatchAt(text, 'cat', opts({ regex: true }), 3), null, '只认正好从 from 开始的匹配')
  assert.equal(regexMatchAt(text, 'cat', opts({ regex: true, wholeWords: true }), 4), null, '全词过滤同样生效')
  const groups = regexMatchAt('a1b2', '(\\d)(\\w)', opts({ regex: true }), 1)
  assert.deepEqual(groups && [groups[0], groups[1], groups[2]], ['1b', '1', 'b'])
})

// —— ④ 接线：控制器把展开与保留大小写按上游顺序接起来 ——

test('the controller expands the template before applying preserve case', () => {
  const controller = read('src/editorFindController.ts')
  assert.match(controller, /replacementFromMatch\(text, match, match\.groups\)/)
  assert.match(controller, /state\.preserveCase \? preserveCaseReplacement\(found, text\) : text/,
    '顺序：先展开 $1，再按上游默认档（逐词 applyCase）套命中文本的形态')
  assert.match(controller, /annotations: isolateHistory\.of\('before'\)/, '替换要切成独立的撤销步')
  assert.equal((controller.match(/annotations: isolateHistory\.of\('before'\)/g) ?? []).length, 2, '替换一处与全部替换各一处')
})

test('the bar still renders one toggle per option', () => {
  const bar = read('src/components/EditorFindBar.vue')
  for (const label of ['区分大小写', '单词', '正则表达式', '保留大小写']) assert.ok(bar.includes(label))
})
