// 结构化搜索的**修饰符支持模型**（`src/structuralSearchModifiers.ts`）——判词 `ss/matcher` 的
// 「变量约束（regExp/script/within/contains/reference/invertible 与 min/maxCount）」与「匹配范围」
// 两条待办在文本层的落点。
//
// 上游依据（逐条写在断言的注释里，基准树 `D:/Backup/Downloads/intellij-community-master`）：
//   · 选项名表 `…/impl/matcher/compiler/StringToConstraintsTransformer.java:20-31`；
//   · 写入与取反 同文件 `handleOption` `:412-479`（不可取反的档在 `:456`/`:471`/`:478` 抛错）；
//   · 编译期把取反包成 NotPredicate `…/impl/matcher/compiler/PatternCompiler.java:488-490,507-509,537-539`；
//   · within/context 只允许写在整模板上 `StringToConstraintsTransformer.java:463-474`；
//   · within 的判定 `…/impl/matcher/predicates/WithinPredicate.java:22-35` +
//     `platform/core-api/src/com/intellij/psi/util/PsiTreeUtil.java:79-95`（strict=false ⇒ 自己也算）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compileStructuralPattern } from '../src/structuralSearch.ts'
import {
  DEFAULT_SCOPE_TYPE, MODIFIER_DESCRIPTORS, SCOPE_TYPES, cannotInvertMessage, checkTemplateModifiers,
  compileSubTemplate, containsHolds, execWithSpans, filterHitsByModifiers, modifierDescriptor,
  needsSpanCheck, scopeSummary, toggleInvert, unsupportedModifiers, variableModifiers, withinHolds,
} from '../src/structuralSearchModifiers.ts'

/** 上游九个选项，顺序照 `StringToConstraintsTransformer.java:20-28` 的常量声明。 */
const UPSTREAM_OPTIONS = ['ref', 'regex', 'regexw', 'exprtype', 'formal', 'script', 'contains', 'within', 'context']

test('支持矩阵把上游九个选项一个不漏地登记，并逐条给了上游坐标', () => {
  assert.deepEqual(MODIFIER_DESCRIPTORS.map(item => item.id), UPSTREAM_OPTIONS)
  for (const item of MODIFIER_DESCRIPTORS) {
    // 每条 `upstream` 都是「相对基准树根的完整路径:行号」，`tests/source-citations.test.mjs` 会核它。
    assert.match(item.upstream, /^platform\/structuralsearch\/source\/.*\.java:\d+(-\d+)?$/, item.id)
    assert.ok(item.label.length > 0 && item.takesArgument, `${item.id} 是有参数的选项（上游 parseCondition 的括号形式）`)
    if (item.support === 'none') assert.ok(item.reason.length > 12, `${item.id} 要写清缺哪一层，不许空着`)
  }
  assert.equal(modifierDescriptor('nosuch'), null, '查不到的档返回 null，面板据此不画控件')
})

test('能画控件的只有真的兑现了的档，其余只出说明文字（不放假控件）', () => {
  assert.deepEqual(variableModifiers().map(item => item.id), ['regex', 'regexw', 'contains'])
  assert.deepEqual(unsupportedModifiers().map(item => item.id), ['ref', 'exprtype', 'formal', 'script', 'context'])
  // `within` 是整模板档：有落点（跨度复核），但不在变量档的控件列表里。
  assert.equal(modifierDescriptor('within').level, 'template')
  assert.equal(modifierDescriptor('context').level, 'template')
  assert.equal(modifierDescriptor('within').support, 'span')
})

test('取反规则照 handleOption：script/context 不可取反，其余可（InvertModifier 那一面）', () => {
  // `StringToConstraintsTransformer.java:455-457`（script）、`:470-471`（context）直接抛 error.cannot.invert。
  assert.equal(modifierDescriptor('script').invertible, false)
  assert.equal(modifierDescriptor('context').invertible, false)
  for (const id of ['ref', 'regex', 'regexw', 'exprtype', 'formal', 'contains', 'within']) {
    assert.equal(modifierDescriptor(id).invertible, true, id)
  }
  const flipped = toggleInvert({ id: 'regex', argument: 'get.*', invert: false })
  assert.equal(flipped.modifier.invert, true)
  assert.equal(toggleInvert(flipped.modifier).modifier.invert, false, '翻两次回到原样')
  const rejected = toggleInvert({ id: 'script', argument: 'x', invert: false })
  assert.equal(rejected.error, cannotInvertMessage('script'))
  assert.match(cannotInvertMessage('context'), /语法上下文/)
  assert.match(toggleInvert({ id: 'nosuch', argument: '', invert: false }).error, /不认识的选项/)
})

test('execWithSpans 给出整段与每个变量的字符区间（d 标志）', () => {
  const pattern = compileStructuralPattern('$a$ == $b$')
  const spans = execWithSpans(pattern.regex, pattern.variables, 'x == y', '')
  assert.equal(spans.whole.text, 'x == y')
  assert.deepEqual([spans.whole.start, spans.whole.end], [0, 6])
  assert.equal(spans.variables.a.text, 'x')
  assert.equal(spans.variables.b.text, 'y')
  assert.equal(spans.variables.b.start, 5)
  // 配不上就是 null（不猜区间）——与 src/structuralSearchResults.ts 的 variableValues 同一条口径。
  assert.equal(execWithSpans(pattern.regex, pattern.variables, 'nothing here', ''), null)
  assert.equal(execWithSpans('(unclosed', ['a'], '(unclosed', ''), null)
  // 大小写位要跟着传：面板上「区分大小写」关着时宿主用 `i` 扫，复核必须用同一套标志，
  // 否则会出现"宿主报了命中、本仓复核说没命中"的假剔除。
  const logged = compileStructuralPattern('log($x$)')
  assert.equal(execWithSpans(logged.regex, logged.variables, 'LOG(getUser)', ''), null)
  assert.ok(execWithSpans(logged.regex, logged.variables, 'LOG(getUser)', 'i'))
})

test('contains 判的是捕获段里含不含另一个子模板（子树修饰符的文本等价物）', () => {
  const segment = { start: 0, end: 7, text: 'getUser' }
  assert.deepEqual(containsHolds('get', segment, {}), { ok: true })
  assert.deepEqual(containsHolds('put', segment, {}), { ok: false })
  // 子模板与外层同名 ⇒ 捕获值必须一致（同上游"同名变量匹配同一段文本"那条规则）。
  assert.equal(containsHolds('$x$', segment, { x: 'getUser' }).ok, true)
  assert.equal(containsHolds('$x$', segment, { x: 'getUse' }).ok, false, '外层是 getUser，子模板就不许配成别的')
  // 子模板写坏 ⇒ 报出来，而不是静默判假（上游那一支是死代码，本仓要真用就得挡在发请求之前）。
  const broken = containsHolds('$x${2,1}', segment, {})
  assert.equal(broken.ok, false)
  assert.match(broken.error, /子模板编译失败/)
})

test('within 是整模板档的匹配范围，判定用区间闭包含（上游 strict=false ⇒ 自己也算）', () => {
  const pattern = compileStructuralPattern('$x$ == null')
  const text = 'if (ok) { a == null }'
  const spans = execWithSpans(pattern.regex, pattern.variables, text, '')
  assert.equal(withinHolds({ within: 'if ($c$) { $y$ == null }', invert: false }, text, spans.whole).ok, true)
  assert.equal(withinHolds({ within: 'if ($c$) { $y$ == null }', invert: false }, 'a == null;', spans).ok, false)
  assert.equal(withinHolds({ within: 'if ($c$) { $y$ == null }', invert: true }, 'a == null;', spans.whole).ok, true)
  // 范围命中与本次命中**恰好同一段**时也算成立：`PsiTreeUtil.java:89` 的
  // `strict ? element.getParent() : element` —— WithinPredicate 传的是 false。
  const same = execWithSpans(pattern.regex, pattern.variables, 'a == null', '')
  assert.equal(withinHolds({ within: '$x$ == null', invert: false }, 'a == null', same.whole).ok, true)
  assert.match(withinHolds({ within: '$x${2,1}', invert: false }, 'a == null', same.whole).error, /子模板编译失败/)
})

test('needsSpanCheck 只在真的挂了跨度修饰符时才多跑一遍复核（不白付代价）', () => {
  const plain = compileStructuralPattern('$x$ == null')
  assert.equal(needsSpanCheck(plain, null), false)
  assert.equal(needsSpanCheck(compileStructuralPattern('$x$[contains(get)]'), null), true)
  assert.equal(needsSpanCheck(plain, { within: 'if ($c$) { $y$ }', invert: false }), true)
  assert.deepEqual(checkTemplateModifiers(plain, null), [])
  assert.match(checkTemplateModifiers(compileStructuralPattern('$x$[contains($y${2,1})]'), null)[0], /包含条件/)
  assert.match(checkTemplateModifiers(plain, { within: '$x${3,1}', invert: false })[0], /匹配范围/)
})

test('filterHitsByModifiers 把否决、复核不上两种分开计，并说清是哪一档否的', () => {
  const pattern = compileStructuralPattern('$x$ == null')
  const scope = { within: 'if ($c$) { $y$ == null }', invert: false }
  const rows = [
    { path: 'a.ts', line: 1, column: 0, text: 'if (ok) { a == null }' },
    { path: 'a.ts', line: 2, column: 0, text: 'b == null;' },
    { path: 'a.ts', line: 3, column: 0, text: '这一行根本没有命中' },
  ]
  const out = filterHitsByModifiers(pattern, scope, rows, '')
  assert.deepEqual(out.kept.map(row => row.line), [1])
  assert.deepEqual(out.rejected.map(item => item.hit.line), [2])
  assert.match(out.rejected[0].reason, /匹配范围/)
  assert.deepEqual(out.unverified.map(row => row.line), [3], 'JS 复核不上的不算"修饰符否决"')
  // 变量档的 contains 也走同一条通道。
  const held = compileStructuralPattern('log($x$[contains(get)])')
  const filtered = filterHitsByModifiers(held, null, [
    { path: 'a.ts', line: 1, column: 0, text: 'log(getUser)' },
    { path: 'a.ts', line: 2, column: 0, text: 'log(setUser)' },
  ], '')
  assert.deepEqual(filtered.kept.map(row => row.line), [1])
  assert.match(filtered.rejected[0].reason, /包含/)
})

test('匹配范围的上游档位与默认档（MatchOptions 的 scope 面）', () => {
  assert.deepEqual(SCOPE_TYPES.map(item => item.id), ['PROJECT', 'MODULE', 'DIRECTORY', 'NAMED'])
  assert.equal(DEFAULT_SCOPE_TYPE, 'PROJECT')
  for (const item of SCOPE_TYPES) assert.match(item.upstream, /^platform\/structuralsearch\/source\/.*Scopes\.java:\d+$/)
  assert.equal(scopeSummary(null), '')
  assert.equal(scopeSummary({ within: '  ', invert: false }), '', '空范围子模板不算挂了这一档')
  assert.equal(scopeSummary({ within: 'if ($c$) { $s$ }', invert: true }), 'Within=!if ($c$) { $s$ }')
})

test('跨度修饰符不改变编译出来的正则（组号仍然稳定）', () => {
  const held = compileStructuralPattern('log($x$[contains(get)], $y$)')
  const bare = compileStructuralPattern('log($x$), $y$'.replace('), ', ', '))
  assert.equal(held.constraints.get('x').contains, 'get')
  assert.deepEqual(held.variables, ['x', 'y'])
  assert.equal(held.variables.length, 2)
  // 关键判据：**同一段没有 contains 的模板**编出来的正则一字不差 —— 跨度档只做命中后的复核，
  // 不碰正则，所以替换串里的 `$1`/`$2` 与结果取值的组号都不会因为挂了修饰符而移位。
  const withoutContains = compileStructuralPattern('log($x$), $y$')
  const withContains = compileStructuralPattern('log($x$[contains(get)]), $y$')
  assert.equal(withContains.regex, withoutContains.regex)
  assert.ok(!bare.error && !held.error && !withoutContains.error)
  const found = new RegExp(withContains.regex).exec('log(getUser), total')
  assert.deepEqual([found[1], found[2]], ['getUser', 'total'])
})

test('compileSubTemplate 带 flags 缓存：同一份子模板 + 同一套标志只编一次', () => {
  const first = compileSubTemplate('$x$ == null', '')
  const second = compileSubTemplate('$x$ == null', '')
  assert.equal(first.sub.regex, second.sub.regex, '命中缓存时是同一个正则对象')
  assert.notEqual(compileSubTemplate('$x$ == null', ''), compileSubTemplate('$x$ == null', 'i').sub.regex,
    '大小写位不同就不能共用缓存')
})
