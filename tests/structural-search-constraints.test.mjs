// 结构化模板的**变量约束**（`src/structuralSearchConstraints.ts`）——判词 `ss/matcher` 的
// 「变量约束（`MatchVariableConstraint` 的 regExp/…/min/maxCount）」那条待办在文本层的落点。
//
// 上游依据（逐条见断言里的注释）：
//   · `MatchVariableConstraint.java:29-36` 的 regExp/invertRegExp/wholeWordsOnly/minCount/maxCount/greedy；
//   · `StringToConstraintsTransformer.java:94-158` 读量词（`+`/`?`/`*`/`{n,m}`）、`:160-166` 读非贪婪；
//   · `StringToConstraintsTransformer.java:243-300` 读条件块、`:331-410` 的 `parseCondition` 语法；
//   · `RegExpPredicate.java:101-120` 用 `matches()`（整段匹配）、`:54-56` 的 `\b(?:…)\b`；
//   · `SubstitutionHandler.java:264-269` 的 min/max 校验、`:318` 的分隔符过滤（逗号）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compileStructuralPattern } from '../src/structuralSearch.ts'
import { UNLIMITED } from '../src/structuralSearchConstraints.ts'
// 列表变量的「同一个列表」复核（宿主那侧的 std::regex 编不出后顾断言，只能在这一层判）：
// 判据在 src/structuralCodeBlock.ts，接线在 src/structuralSearchModifiers.ts 的 verdictForHit。
import { execWithSpans, listRunVerdict } from '../src/structuralSearchModifiers.ts'

const ok = template => {
  const compiled = compileStructuralPattern(template)
  assert.ok(!('error' in compiled), `${template} 不该编译失败：${(compiled).error ?? ''}`)
  return compiled
}
const bad = template => {
  const compiled = compileStructuralPattern(template)
  assert.ok('error' in compiled, `${template} 该编译失败却编出来了：${(compiled).regex}`)
  return compiled.error
}
/**
 * 「这个模板在这一行上成不成立」= 两道，与面板走的完全是同一条链：
 *   ① 编译产物那条正则（发给宿主的 `query`）能配上；
 *   ② 贪婪列表变量过一遍「整段」复核（`verdictForHit` 里的 `listRunVerdict`）。
 * 第二道从前写在正则里（`(?<!…)` 后顾断言），宿主编不动 ⇒ 带列表变量的模板整体报废，
 * 现在搬到复核层，所以"成不成立"这个问题要两道都问一遍才等价于面板的行为。
 */
const listed = (template, text, flags = '') => {
  const pattern = ok(template)
  const found = new RegExp(pattern.regex, flags).exec(text)
  if (!found) return null
  const spans = execWithSpans(pattern.regex, pattern.variables, text, flags)
  if (!spans) return null
  return listRunVerdict(pattern, text, spans).ok ? found : null
}
const run = (template, flags = '') => ({
  source: new RegExp(ok(template).regex, flags).source,
  test: text => listed(template, text, flags) !== null,
  exec: text => listed(template, text, flags),
})

test('没写约束时正则与旧实现逐字一致（不因为接了约束就改动既有行为）', () => {
  // 这三条是 `tests/structural-search.test.mjs` 里已有的锚点，逐字重复一遍当回归护栏。
  // 期望值随「模板空白不参与比对」（`MatchOptions.java:60` 的 looseMatching）一起更新，
  // 守的仍是同一条意图：**没写约束时编译结果与不带约束的旧实现完全相同**。
  assert.equal(ok('$x$ + 1').regex, '([A-Za-z_$][\\w$]*)\\s*\\+\\s*1')
  assert.equal(ok('$x$ == $x$').regex, '([A-Za-z_$][\\w$]*)\\s*==\\s*\\1')
  assert.equal(ok('$x$').regex, '([A-Za-z_$][\\w$]*)')
})

test('量词读成 min/maxOccurs，语义与 StringToConstraintsTransformer 的分支一致', () => {
  // `pick` 返回 min/max/**greedy** 三个字段（下面两条 `greedy` 断言要用），所以
  // 这八条的期望值必须把 `greedy: true` 一并写出来 —— 少写一个键 deepStrictEqual 也会红。
  // `:100-102` `+` → maxOccurs = MAX_VALUE（min 仍 1）
  assert.deepEqual(pick(ok('$x$+'), 'x'), { minOccurs: 1, maxOccurs: UNLIMITED, greedy: true })
  // `:105-107` `?` → minOccurs = 0（max 仍 1）
  assert.deepEqual(pick(ok('$x$?'), 'x'), { minOccurs: 0, maxOccurs: 1, greedy: true })
  // `:108-112` `*` → 两者都放开
  assert.deepEqual(pick(ok('$x$*'), 'x'), { minOccurs: 0, maxOccurs: UNLIMITED, greedy: true })
  // `:113-158` `{n}` / `{n,m}` / `{n,}` / `{,m}`：缺的那一端取 0 / MAX_VALUE（`:147-156`）
  assert.deepEqual(pick(ok('$x${2}'), 'x'), { minOccurs: 2, maxOccurs: 2, greedy: true })
  assert.deepEqual(pick(ok('$x${2,4}'), 'x'), { minOccurs: 2, maxOccurs: 4, greedy: true })
  assert.deepEqual(pick(ok('$x${2,}'), 'x'), { minOccurs: 2, maxOccurs: UNLIMITED, greedy: true })
  assert.deepEqual(pick(ok('$x${,3}'), 'x'), { minOccurs: 0, maxOccurs: 3, greedy: true })
  // `:160-166` 量词后紧跟的 `?` 是"非贪婪"，不是"可缺" —— 已被上面读走的就是次数。
  assert.equal(pick(ok('$x$+?'), 'x').greedy, false)
  assert.equal(pick(ok('$x$'), 'x').greedy, true)
})

test('次数约束真的作用在匹配结果上（文本层对 SubstitutionHandler 数同级节点的等价物）', () => {
  // `+` = 一个或多个逗号分隔的标识符：上游 `SubstitutionHandler.matchSequentially`
  // 遍历 `matchNodes` 并用 `VARS_DELIM_FILTER` 滤掉逗号（`:318`/`:45-56`），文本层就是列表。
  assert.ok(run('$x$+').test('a, b, c'), '三个参数该命中')
  assert.ok(run('$x$+').test('a'), '一个参数也该命中（min=1）')
  assert.ok(run('$x$?').test(''), 'min=0 时空列表也该命中')
  assert.ok(!run('$x${3}').test('a, b'), '只给两个不该命中 min=3')
  assert.ok(run('$x${3}').test('a, b, c'))
  assert.ok(!run('$x${2}').test('a, b, c'), '给了三个不该命中 max=2')
  assert.ok(run('$x${2,3}').test('a, b') && run('$x${2,3}').test('a, b, c'))
  // 捕获组仍要带住整段列表 —— 替换串靠它回填。
  assert.equal(run('$x${2,3}').exec('f(a, b, c)')[1], 'a, b, c')
})

test('regex 约束按整段匹配（RegExpPredicate 用的是 matches()，不是 find）', () => {
  // `:101-120` 的 `matcher.matches()` 语义：整段文本都要满足。
  const prefixed = run('log($x$[regex(get.*)])')
  assert.ok(prefixed.test('log(getUser)'), '整体匹配 get.* 该命中')
  assert.ok(!prefixed.test('log(xgetUser)'), '前缀多一个字就不该命中（find 会命中，matches 不会）')
  // `:54-56` 的全词包裹 `.*?\b(?:REAL)\b.*?`
  const whole = run('$x$[regexw(foo|bar)]')
  assert.ok(whole.test('foo') && whole.test('bar'))
  assert.ok(!whole.test('foobar'), '全词约束下 foobar 不该命中')
  assert.ok(!whole.test('xfoo'))
})

test('! 取反：名字不满足正则时才命中（MatchVariableConstraint.setInvertRegExp）', () => {
  // `StringToConstraintsTransformer.java:247-252` 的 `!` → setInvertRegExp(true)
  const negated = run('$x$[!regex(get.*)]')
  assert.ok(negated.test('setUser'))
  assert.ok(!negated.test('getUser'), '满足正则的那个不该命中')
  // 取反 + 全词：`getFoo` 不该命中，但 `get` 单独出现时也不是一个满足 get.* 的完整标识符… 
  const both = run('$x$[!regexw(get.*)]')
  assert.ok(both.test('setUser'), '非 get 开头的标识符该命中')
  assert.ok(!both.test('getUser'), 'getUser 满足正则，取反后不该命中')
})

test('条件块可省冒号，`::` 是转义的双冒号而不是条件（StringToConstraintsTransformer:187-190）', () => {
  assert.ok(run('$x$[regex(get.*)]').test('getUser'), '冒号可省')
  assert.ok(run('$x$:[regex(get.*)]').test('getUser'), '带冒号也行')
  // `::` 落回字面 —— 上游 `:187-190` 只 `pattern.append(ch)` 追加**一个** `:`，另一个留给
  // 主循环当字面量，于是 method reference 的 `::` 原样留在 pattern 里（它的 testMethodReference
  // 断言的就是 `"$a$::$b$"`）。所以 `::` 后面那个 `[...]` 是**普通文本**，不是条件 ——
  // 也就是说这条模板**不是错误**，`::` 也没有被折成单冒号。
  assert.ok(ok('$x$::[regex(get.*)]').regex.includes('::'), '`::` 保持两个字面冒号')
  const escaped = run('a$::$x$')
  assert.equal(escaped.source.includes('::'), true, '`::` 原样落进正则（上游只追加一个到 pattern，另一个是字面量）')
  assert.equal(escaped.test('a$::user'), true, '`a$::$x$` 匹配 `a$::user`（`$` 仍是字面美元符号）')
})

test('条件认 regex/regexw/contains，其余选项明说没有落点或档位不对', () => {
  // `knownOptions`（`:30-31`）里 ref/exprtype/formal/script 在文本层都没有依据 —— 报出来，
  // 别让用户以为约束生效了；`contains` 已接（子模板跨度复核，见 src/structuralSearchModifiers.ts）；
  // `within`/`context` 在上游**不是变量档的选项**（`StringToConstraintsTransformer.java:463-474`
  // 比对 `Configuration.CONTEXT_VAR_NAME`，不等就抛 error.only.applicable.to.complete.match），
  // 所以这里的报错文案说的是"档位不对"，而不是"没落点"。
  for (const option of ['ref(x)', 'exprtype(x)', 'formal(x)', 'script(x)']) {
    assert.match(bad(`$x$[${option}]`), /文本子集没有落点/, `${option} 应当明说没有落点`)
  }
  for (const option of ['within(x)', 'context(x)']) {
    assert.match(bad(`$x$[${option}]`), /只适用于「整个模板」/, `${option} 是整模板档，写在变量上要报错`)
  }
  // `contains` 是变量档的子树修饰符：能解析，且**不进正则**（形状保持"一个标识符"那一条）。
  const held = ok('$x$[contains(get)]')
  assert.equal(held.regex, '([A-Za-z_$][\\w$]*)')
  assert.equal(held.constraints.get('x').contains, 'get')
  assert.equal(held.constraints.get('x').invertContains, false)
  assert.equal(ok('$x$[!contains(get)]').constraints.get('x').invertContains, true)
  assert.match(bad('$x$[contains()]'), /缺参数|要一个子模板参数/)
  assert.match(bad('$x$[contains]'), /要一个子模板参数/)
  assert.match(bad('$x$[nosuchoption]'), /不认识的选项/)
  // `&&` 之后必须还有下一个选项（上游 `parseCondition` 的 `optionExpected`，`:335`/`:378`/`:390`）。
  // 注意 `&&` 要写在**括号外**：括号里是 regex 的参数文本，`get.* &&` 本身就是合法正则内容。
  assert.match(bad('$x$[regex(get.*) && ]'), /`&&` 后面要有下一个选项/)
  // 一条约束里可以并两个档（`[regex(get.*) && contains(x)]`），形状仍是标识符 + 跨度复核。
  const both = ok('$x$[regex(get.*) && contains(name)]')
  assert.equal(both.constraints.get('x').regexp, 'get.*')
  assert.equal(both.constraints.get('x').contains, 'name')
})

test('约束只能写在首次引用上（StringToConstraintsTransformer:179-181 的同一条规则）', () => {
  assert.match(bad('$x$ == $x$+'), /只能写在第一次出现/)
  // 首次带约束、后续纯反向引用：合法。
  //
  // 模板写法照上游的 **pattern** 形态：`$x$` 后面直接跟量词，**没有**第二个 `$`
  // （`StringToConstraintsTransformer:83` 把 criteria 里的 `'x'` 改写成 `$x$`，随后
  // `:98-158` 才把量词读走，所以 pattern 里就是 `$x${2}` 这种形状）。
  // 后续的裸引用是反向引用 `\1`，而上游要求**两次的项数相等**
  // （`checkSameOccurrencesConstraint`，`SubstitutionHandler.java:457-466`），
  // 所以样例右边也得是两项 —— `a, b == a` 那是 1 项，不该命中。
  assert.equal(ok('$x${2} == $x$').variables.length, 1)
  assert.ok(run('$x${2} == $x$').test('a, b == a, b'))
  assert.ok(!run('$x${2} == $x$').test('a, b == a'), '项数不同不该命中（上游比的是项数相等）')
})

test('坏模板要报错，且错误信息说的是哪一条不对', () => {
  assert.match(bad('$x${3,1}'), /大于上界/)
  assert.match(bad('$x${a}'), /不是数字/)
  assert.match(bad('$x${2'), /缺 `}`/)
  assert.match(bad('$x$[regex([)]'), /正则.*编译失败|条件块缺/)
  assert.match(bad('$x$[]'), /空的/)
  assert.match(bad('$x$['), /条件块缺 `\]`/)
  assert.ok(ok('$x$:[regex(get.*)]').regex, 'sanity: 不是错误')
})

test('正则编出来之后还要过一遍引擎（上游 checkRegex，StringToConstraintsTransformer:486-493）', () => {
  // 约束本身合法但拼出来的正则不合法时要报错，不能把坏正则发给宿主。
  assert.match(bad('$x$[regex((unclosed)]'), /正则.*编译失败/)
})

test('变量表带上每个变量的约束，供替换/预览侧读', () => {
  const pattern = ok('$x${2,3}$, $y$[regex(get.*)]')
  assert.deepEqual([...pattern.constraints.keys()], ['x', 'y'])
  assert.equal(pattern.constraints.get('y')?.regexp, 'get.*')
  assert.equal(pattern.constraints.get('y')?.wholeWordsOnly, false)
  // 没写约束的变量拿到的是默认那条（一个裸标识符）。
  const plain = ok('$a$ + $b$[regex(get.*)]')
  assert.equal(plain.constraints.get('a')?.minOccurs, 1)
  assert.equal(plain.constraints.get('a')?.regexp, null)
})

test('替换串里的 $N 仍按变量首次出现的顺序编号（组数没被约束改变）', () => {
  // 约束只改组**内部**的形状，不新增捕获组 —— 组号因此稳定，`$1`/`$2` 的语义不变。
  // 模板形态同上一条：`$x$` + 量词，后面没有第二个 `$`（上游 pattern 形态，见 `:83`/`:98-158`）。
  const pattern = ok('$x${2,3}.$y$[regex(get.*)]')
  assert.deepEqual(pattern.variables, ['x', 'y'])
  const re = new RegExp(pattern.regex)
  const hit = re.exec('a, b.getUser')
  assert.deepEqual([hit[1], hit[2]], ['a, b', 'getUser'])
})

function pick(pattern, name) {
  const entry = pattern.constraints.get(name)
  assert.ok(entry, `${name} 不在变量表里`)
  return { minOccurs: entry.minOccurs, maxOccurs: entry.maxOccurs, greedy: entry.greedy }
}
