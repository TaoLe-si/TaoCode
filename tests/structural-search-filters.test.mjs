import test from 'node:test'
import assert from 'node:assert/strict'
import {
  UNAVAILABLE_FILTERS, applyToWholeTemplate, containsSummary, countSummary, modifierRows, modifierSuffix,
  noModifiersLabel, templateVariables, textSummary, writeAllModifiers, writeVariableModifiers,
} from '../src/structuralSearchFilters.ts'
import { compileStructuralPattern } from '../src/structuralSearch.ts'
import { UNLIMITED } from '../src/structuralSearchConstraints.ts'

const constraint = over => ({
  name: 'x', minOccurs: 1, maxOccurs: 1, greedy: true, regexp: null, invertRegExp: false, wholeWordsOnly: false,
  ...over,
})

test('变量表把已写的修饰符后缀读回来，并给出后缀的边界', () => {
  const rows = templateVariables('log($x$+)($y$:[regex(get.*)])')
  assert.deepEqual(rows.map(row => row.name), ['x', 'y'])
  assert.equal(rows[0].constraint.maxOccurs, UNLIMITED)
  assert.equal(rows[0].constraint.regexp, null)
  assert.equal(rows[1].constraint.regexp, 'get.*')
  // 后缀边界：读回来的 suffixEnd 必须正好落在下一个字符之前，写回时才不会吃掉模板。
  assert.equal('log($x$+)($y$:[regex(get.*)])'.slice(rows[0].end, rows[0].suffixEnd), '+')
  assert.equal('log($x$+)($y$:[regex(get.*)])'.slice(rows[1].end, rows[1].suffixEnd), ':[regex(get.*)]')
})

test('后缀读写互逆：量词的每一种形状都能原样写回去', () => {
  for (const suffix of ['', '+', '?', '*', '{2}', '{2,}', '{,3}', '{2,3}', '??', '*?', '+?[regex(a)]']) {
    const template = `$x$${suffix}`
    const [row] = templateVariables(template)
    assert.ok(!row.broken, `${suffix} 该读得动`)
    assert.equal(modifierSuffix(row.constraint), suffix || '', suffix)
    assert.equal(writeVariableModifiers(template, 'x', row.constraint), template, suffix)
  }
})

test('约束只能写在首次引用上：后续出现的同名变量不带后缀', () => {
  const rows = templateVariables('$x$ == $x$')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].occurrences, 2)
})

test('计数摘要照 CountFilter 的形状，默认值那一档单独标出来', () => {
  // `CountFilter.java:42,92` 的 `[min,max]` + `count.label`，无界写作 `∞`；
  // `:94` 在等于默认（1..1）时追加 `default.label`。
  assert.equal(countSummary(constraint({})), '计数=[1,1]')
  assert.equal(countSummary(constraint({ maxOccurs: UNLIMITED })), '计数=[1,∞]')
  assert.equal(countSummary(constraint({ minOccurs: 0, maxOccurs: UNLIMITED })), '计数=[0,∞]')
  assert.equal(modifierRows(constraint({}))[0].isDefault, true)
  assert.equal(modifierRows(constraint({ minOccurs: 2, maxOccurs: 3 }))[0].isDefault, false)
})

test('文本摘要照 TextFilter 的形状：取反前缀 ! 与「全字」后缀', () => {
  // `TextFilter.java:82-85`：`text.0.label` + 取反时前缀 `!`；`whole.words.label` 追加在后面。
  assert.equal(textSummary(constraint({ regexp: 'get.*' })), 'Text=get.*')
  assert.equal(textSummary(constraint({ regexp: 'get.*', invertRegExp: true })), 'Text=!get.*')
  assert.equal(textSummary(constraint({ regexp: 'get.*', wholeWordsOnly: true })), 'Text=get.*，全字')
  assert.equal(textSummary(constraint({})), '', '没写正则就没有这一档')
  const rows = modifierRows(constraint({ regexp: 'a', wholeWordsOnly: true }))
  assert.deepEqual(rows.map(row => row.filter), ['计数', '文本'])
})

test('写修饰符只动首次引用那一段后缀，别处一字不改', () => {
  const next = constraint({ name: 'x', minOccurs: 0, maxOccurs: UNLIMITED })
  assert.equal(writeVariableModifiers('$x$ + $x$ + 1', 'x', next), '$x$* + $x$ + 1')
  assert.equal(writeVariableModifiers('a($x$)', 'x', constraint({ regexp: 'get.*' })), 'a($x$[regex(get.*)])')
  // 换一个变量名不影响前一个。
  assert.equal(writeVariableModifiers('$x$($y$)', 'y', next), '$x$($y$*)')
})

test('坏后缀不许往上叠写（读不动就原样返回）', () => {
  // `[` 没闭合：模板本来就该在编译期报错，面板此时不能再往同一段后面追加东西。
  const broken = '$x$[regex(a'
  const [row] = templateVariables(broken)
  assert.equal(row.broken, true)
  assert.equal(writeVariableModifiers(broken, 'x', constraint({})), broken)
})

test('一次改多个变量从后往前替换，下标不会互相影响', () => {
  const out = writeAllModifiers('$a$ $b$ $c$', new Map([
    ['a', constraint({ name: 'a', minOccurs: 0, maxOccurs: 1 })],
    ['c', constraint({ name: 'c', maxOccurs: UNLIMITED })],
  ]))
  assert.equal(out, '$a$? $b$ $c$+')
})

test('整模板那一档把同一份修饰符套给所有变量', () => {
  const out = applyToWholeTemplate('$a$.m($b$)', { minOccurs: 1, maxOccurs: UNLIMITED, regexp: null, invertRegExp: false, wholeWordsOnly: false })
  assert.equal(out, '$a$+.m($b$+)')
  // 编译产物与手写的后缀完全一致（面板与用户手打走的同一条路）。
  assert.deepEqual(compileStructuralPattern(out).variables, ['a', 'b'])
})

test('没有落点的四档被明确列出来，而不是在面板上画成可点的控件', () => {
  // `DefaultFilterProvider.java:13` 的五个动作里本仓只做了 Count 与 Text；
  // Script 类存在但不在默认提供器里，一并列为不可用。
  assert.deepEqual(UNAVAILABLE_FILTERS.map(f => f.name), ['引用', '类型', '上下文', '脚本'])
  for (const filter of UNAVAILABLE_FILTERS) assert.ok(filter.reason.length > 10, `${filter.name} 要写清为什么没有`)
})

test('空修饰符时的提示文案取自官方中文包 no.filters.for.0.label', () => {
  assert.equal(noModifiersLabel('x'), '没有为 $x$ 添加修饰符')
})

test('面板生成的模板过得了编译期（约束与反向引用不冲突）', () => {
  const written = writeVariableModifiers('$x$.equals($y$)', 'x', constraint({ minOccurs: 0, maxOccurs: UNLIMITED }))
  const compiled = compileStructuralPattern(written)
  assert.ok(!('error' in compiled), JSON.stringify(compiled))
  assert.deepEqual(compiled.variables, ['x', 'y'])
  const re = new RegExp(compiled.regex)
  assert.ok(re.test('a.equals(b)'))
  // 列表形状的 $x$ 不会把 `a.equals` 整个吞成一个标识符：捕获到的只有 `a`。
  assert.equal(re.exec('a.equals(b)')[1], 'a')
  // **留痕（原写「零项列表在文本层允许整段缺席」是条已知落差，实际这一条现在不成立了）**：
  // 贪婪列表那一支现在带一条起点断言（`\b`，见 `src/structuralSearchConstraints.ts` 的 `counted`），
  // 空列表落在 `.equals` 前面时那个位置左边是运算符、右边是词字符，`\b` 过不去 ⇒ 不命中。
  // 方向与上游一致：receiver 是方法调用表达式的**必需子节点**，缺左操作数的那一段在语法树上
  // 根本不成一个可比的位置（`SubstitutionHandler.java:264-269` 的 `validate` 之后还要按节点类型走）。
  // 这一条从"该命中"改成"不该命中"是**收紧**，不是放松断言：原来钉住的是一处文本层的假命中。
  assert.ok(!re.test('.equals(b)'), '空列表不许整段缺席在运算符右边（原来钉的是"允许"，那是假命中）')
})

test('contains 后缀读写互逆，和 regex 并排时按 && 连接', () => {
  for (const suffix of ['[contains(get)]', '[!contains(get)]', '[regex(get.*) && contains(name)]', '+[contains(get)]']) {
    const template = `$x$${suffix}`
    const [row] = templateVariables(template)
    assert.ok(!row.broken, `${suffix} 该读得动：${template}`)
    assert.equal(modifierSuffix(row.constraint), suffix)
    assert.equal(writeVariableModifiers(template, 'x', row.constraint), template)
  }
  // 旧形状（没带 contains 字段的约束对象）不许凭空长出一个 `[contains(undefined)]` 后缀。
  assert.equal(modifierSuffix(constraint({})), '')
  assert.equal(containsSummary(constraint({ contains: 'get' })), 'Contains=get')
  assert.equal(containsSummary(constraint({ contains: 'get', invertContains: true })), 'Contains=!get')
  assert.deepEqual(modifierRows(constraint({ contains: 'get' })).map(r => r.filter), ['计数', '包含'])
})
