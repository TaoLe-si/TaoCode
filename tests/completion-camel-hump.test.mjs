// 驼峰前缀匹配器的判据 —— 每一条都对着上游源码写：
// `platform/analysis-impl/src/com/intellij/codeInsight/completion/impl/CamelHumpMatcher.java`
// 与 `platform/util/text-matching/src/com/intellij/psi/codeStyle/MinusculeMatcherImpl.kt`、
// `MinusculeMatcher.kt`。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyMiddleMatching, camelHumpMatcher, isWordStart, nextWord, prefixMatchingWeight,
} from '../src/completionCamelHump.ts'

// 「中间命中」默认开着：`registry.properties:960` = `ide.completion.middle.matching=true`，
// `CamelHumpMatcher.java:149-154` 于是把 pattern 变成 `*` + 把点换成「点+空格」。
test('middle matching turns the prefix into a wildcard pattern', () => {
  assert.equal(applyMiddleMatching('name'), '*name')
  assert.equal(applyMiddleMatching('a.b'), '*a. b')
  assert.equal(applyMiddleMatching(''), '')
  assert.equal(applyMiddleMatching('name', false), 'name')
})

test('word starts follow NameUtilCore.kt:95-117', () => {
  assert.equal(isWordStart('getName', 3), true, '大写 N 是词首')
  assert.equal(isWordStart('abc', 1), false, '小写在字母中间不是词首')
  assert.equal(isWordStart('abc', 0), true, '串首是词首')
  assert.equal(isWordStart('a.b', 2), true, '点后面：前一个不是字母也不是数字')
  assert.equal(isWordStart('ABCd', 1), false, '全大写词的中间不算词首')
  assert.equal(isWordStart('ABCd', 2), true, 'C 后面跟着小写 d ⇒ C 起一个新的词（上游就是 AB / Cd 两刀）')
  assert.equal(isWordStart('a1b', 1), true, '数字自成一个词')
})

test('nextWord splits humps the way NameUtilCore.kt:53-92 does', () => {
  assert.equal(nextWord('getName', 0), 3, 'get 是一个词')
  assert.equal(nextWord('getName', 3), 7, 'Name 到末尾')
  assert.equal(nextWord('ABc', 0), 1, '末尾那个大写退给下一个词（:77-83）⇒ A / Bc')
  assert.equal(nextWord('ABCd', 0), 2, 'ABCd 切成 AB / Cd')
  assert.equal(nextWord('a1b', 0), 1, '标点/数字分界')
  assert.equal(nextWord('12ab', 0), 2, '数字段单独成词')
})

test('camel humps: uppercase pattern chars need a hump start', () => {
  const matcher = camelHumpMatcher('gN')
  assert.equal(matcher.matches('getName'), true, 'g 在串首、N 落在驼峰上')
  assert.equal(matcher.matches('getname'), false, '全小写的名字里 N 没有驼峰可对（mixedCase 档）')
  assert.equal(camelHumpMatcher('gName').matches('xgName'), true, '中间命中：片段够长就允许')
})

test('middle matches shorter than three characters are refused (MinusculeMatcherImpl.kt:356-357)', () => {
  // 中间命中的片段必须 ≥3 个字符（原注释：避免捞出太多不相干）。`ab` 只有两个字符接得上，后面
  // 还有 pattern 没吃完 ⇒ 拒绝；`zabcx` 里三个字符连上 ⇒ 接受。
  assert.equal(camelHumpMatcher('abc').matches('zabxc'), false)
  assert.equal(camelHumpMatcher('abc').matches('zabcx'), true)
})

test('digits may not be skipped between two digits (MinusculeMatcherImpl.kt:345-347)', () => {
  assert.equal(camelHumpMatcher('foo13').matches('foo123'), false, '1 与 3 中间的 2 不许跳过')
  assert.equal(camelHumpMatcher('foo123').matches('foo123'), true)
})

test('dots in the pattern stay literal (MinusculeMatcherImpl.kt:293-297)', () => {
  // 关掉中间匹配时 pattern 就是原样：那个点是**字面点**，`abc` 里没点 ⇒ 不匹配。
  assert.equal(camelHumpMatcher('a.c', { middleMatching: false }).matches('abc'), false)
  // 默认档把 `.` 换成 `. `（`CamelHumpMatcher.java:151`）⇒ 点后面是通配符，一个 pattern 点可以吃掉名字里的一段点。
  assert.equal(camelHumpMatcher('a.c').matches('a.b.c'), true)
})

test('match ranges are the fragments the lookup bolds (MinusculeMatcher.kt:31-37)', () => {
  assert.deepEqual(camelHumpMatcher('gN').matchRanges('getName'), [0, 1, 3, 4])
  assert.deepEqual(camelHumpMatcher('nope').matchRanges('getName'), [])
})

test('matching degree prefers hump starts and exact case (MinusculeMatcher.kt:84-191)', () => {
  const matcher = camelHumpMatcher('name')
  assert.ok(matcher.matchingDegree('nameOfThing') > 0 && matcher.matchingDegree('getname') >= 0)
  // 词首命中拿 +1000 那一档（`:155`），中间命中拿不到 ⇒ 前者的分数必然更高。
  assert.ok(matcher.matchingDegree('nameOfThing') > matcher.matchingDegree('getname'))
  // 排序键取负（`RealPrefixMatchingWeigher.java:26`），不匹配的最差。
  assert.ok(prefixMatchingWeight(matcher, 'nameOfThing') < prefixMatchingWeight(matcher, 'getname'))
  assert.equal(prefixMatchingWeight(matcher, 'zzz'), Number.MAX_SAFE_INTEGER)
  // 上游默认档 FIRST_LETTER（`CodeInsightSettings.java:75`）：小写打头的输入在**分数档**里对不上
  // PascalCase（`isFirstCharMatching`，`MinusculeMatcherImpl.kt:445-447`）。条目区分大小写时（上游默认，
  // `LookupElement.java:163-165`）连条目本身也不进表；不区分大小写时才由 `:112-116` 放行。
  assert.equal(matcher.matchingDegree('Name'), Number.MIN_SAFE_INTEGER)
  assert.equal(matcher.matches('Name'), false)
  assert.equal(camelHumpMatcher('name', { caseSensitiveItem: false }).matches('Name'), true)
})

test('case sensitivity honors CodeInsightSettings for case-sensitive items', () => {
  // `LookupElement.java:163-165` 的默认值是 isCaseSensitive() = true ⇒ 只看严格档。
  assert.equal(camelHumpMatcher('Foo', { caseSensitiveMode: 'match-case' }).matches('fooBar'), false)
  assert.equal(camelHumpMatcher('Foo', { caseSensitiveMode: 'match-case' }).matches('FooBar'), true)
  assert.equal(camelHumpMatcher('foo', { caseSensitiveMode: 'match-case' }).matches('fooBar'), true)
  // FIRST_LETTER：只有首字母的大小写必须一致（MatchingMode.kt:14-31 的例句）。
  assert.equal(camelHumpMatcher('Foo', { caseSensitiveMode: 'first-letter' }).matches('fooBar'), false)
  assert.equal(camelHumpMatcher('foo', { caseSensitiveMode: 'first-letter' }).matches('fooBar'), true)
  assert.equal(camelHumpMatcher('foo', { caseSensitiveMode: 'first-letter' }).matches('FooBar'), false)
  // IGNORE_CASE（= 把设置拨成 NONE）：全都放行。
  assert.equal(camelHumpMatcher('Foo', { caseSensitiveMode: 'ignore-case' }).matches('fooBar'), true)
})

test('case-insensitive items get the two extra pass-throughs (CamelHumpMatcher.java:107-119)', () => {
  const options = { caseSensitiveMode: 'first-letter', caseSensitiveItem: false }
  assert.equal(camelHumpMatcher('Foo', options).matches('fooBar'), true, '宽松档放行')
  assert.equal(camelHumpMatcher('foo', options).matches('FooBar'), true, '忽略大小写的前缀放行')
  // 但 FIRST_LETTER 的分数档仍把它们排到后面 —— 上游那个"首字母大小写敏感"就体现在这里。
  assert.equal(camelHumpMatcher('foo', options).matchingDegree('FooBar'), Number.MIN_SAFE_INTEGER)
})

test('empty prefix keeps everything (CommandCompletionProvider.kt:252 的 baseMatcher 语义)', () => {
  const matcher = camelHumpMatcher('')
  assert.equal(matcher.matches('anything'), true)
  assert.equal(matcher.matches(''), true)
})

test('leading underscores still match (CamelHumpMatcher.java:189-198)', () => {
  const matcher = camelHumpMatcher('name')
  assert.equal(matcher.matches('_name'), true)
  assert.ok(matcher.matchingDegree('_name') < matcher.matchingDegree('name'), '下划线那档比直白的前缀低一档')
})

test('long patterns take the coarse substring path (MinusculeMatcherImpl.kt:117-121,133-175)', () => {
  // pattern 超过 100 个字符就不做 O(n) 的驼峰跳格，改成「按有效字符顺序贴一段」：
  // 命中的片段可以比 pattern 短得多（`:156-175` 一旦撞上对不上的字符就收尾返回已贴上的长度）。
  const long = `x${'a'.repeat(120)}`
  const matcher = camelHumpMatcher(long)
  assert.equal(matcher.matches(`x${'a'.repeat(130)}`), true)
  const fragments = matcher.fragments(`x-${'a'.repeat(130)}`)
  assert.equal(fragments?.length, 1)
  assert.equal(fragments?.[0]?.end, 1, '只贴上了开头那一个字符 —— 退化路径不跳格')
})
