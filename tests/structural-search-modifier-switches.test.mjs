// 结构化搜索的**面板级修饰符开关**（`src/structuralSearchModifiers.ts` 的 `MATCHER_SWITCHES` 一节）
// 与「全词」在编译期的生效点（`src/structuralSearch.ts` 的 `compileStructuralPattern(template, options)`）。
//
// 判词 `ss/matcher` 里「开关档」那条待办的落点。上游依据（基准树
// `D:/Backup/Downloads/intellij-community-master/intellij-community-master`，逐条可点）：
//   · `caseSensitive` 档：字段 `platform/structuralsearch/source/com/intellij/structuralsearch/MatchOptions.java:30`、
//     读写 `:121-127`、**默认 false**（构造器 `:58-63` 只给 `looseMatching`/`searchInjectedCode`/`pattern` 赋过值）、
//     持久化属性名 `:45-46` 与写出点 `:193`、生效点
//     `platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/predicates/RegExpPredicate.java:58`
//     （`caseSensitive ? 0 : Pattern.CASE_INSENSITIVE`）。
//   · `wholeWords` 档：字段 `platform/structuralsearch/source/com/intellij/structuralsearch/MatchVariableConstraint.java:33`、
//     读写 `:312-318`、持久化 `:80`（`wholeWordsOnly`）与读回 `:480`、写入点
//     `platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:427-429`
//     （只有 `regexw` 会置它，`plugin/ui/filters/TextFilter.java:150` 反而**每次都把它清掉**）、
//     生效形状 `…/impl/matcher/predicates/RegExpPredicate.java:54-56`（两端 `\b`）与索引侧的读取点
//     `…/impl/matcher/compiler/GlobalCompilingVisitor.java:174`。
//     「整模板那一行」的作用方式：`platform/structuralsearch/source/com/intellij/structuralsearch/plugin/ui/filters/FilterPanel.java:291,339`
//     （`no.filters.whole.template.label` / `filters.for.whole.template.title`，文案在
//     `platform/structuralsearch/resources/messages/SSRBundle.properties:87,90`）
//     + `…/plugin/ui/filters/FilterTable.java:22-25` 的 `getMatchVariable()`。
//   · `invertCondition` 档：`!` 前缀的读写在 `…/plugin/ui/filters/TextFilter.java:134,142-148`，
//     条件文本的解析在 `…/impl/matcher/compiler/StringToConstraintsTransformer.java:426`（`setInvertRegExp(invert)`），
//     文案 `invert.filter=Invert modifier` 在 `platform/structuralsearch/resources/messages/SSRBundle.properties:102`。
//   · `regex`/`looseMatching`/`recursiveSearch`/`searchInjectedCode`/`withinHierarchy` 与
//     「注释内替换」的登记见被测文件里的注释；其中 `substitueInComments` 这个名字**无法核实**
//     （基准树里 `find -iname '*modifier*'` 在 `platform/structuralsearch/` 下零命中、
//     `grep -rn "substitue"` 全树零命中、`plugins/ssad/` 目录不存在），
//     最接近的真实代码是 `…/impl/matcher/compiler/OptimizingSearchHelper.java:20,22` 与
//     `…/impl/matcher/compiler/GlobalCompilingVisitor.java:234,237`（倒排索引的单词表，不是用户开关）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import { compileStructuralPattern } from '../src/structuralSearch.ts'
import {
  MATCHER_SWITCHES, compileSwitches, defaultMatcherSwitches, matcherFlags, unavailableSwitches,
} from '../src/structuralSearchModifiers.ts'
import { createStructuralSearchModel } from '../src/structuralSearchPanelModel.ts'

/** 表里按 id 取一档（不给导出查表函数：那会变成一个没有消费者的出口）。 */
const switchOf = id => MATCHER_SWITCHES.find(item => item.id === id)

test('开关档把上游 MatchOptions 的真实枚举一个不漏地登记，并逐条给了上游坐标', () => {
  assert.deepEqual(MATCHER_SWITCHES.map(item => item.id), [
    'caseSensitive', 'wholeWords', 'regex', 'looseMatching', 'invertCondition',
    'recursiveSearch', 'searchInjectedCode', 'withinHierarchy', 'substituteInComments',
  ])
  for (const item of MATCHER_SWITCHES) {
    assert.match(item.upstream, /^platform\/structuralsearch\/source\/.*\.java:\d/, `${item.id} 的上游坐标要指得到行`)
    assert.ok(item.label.length > 0, item.id)
    if (item.support === 'none') assert.ok((item.reason ?? '').length > 20, `${item.id} 要写清缺哪一层`)
    else assert.ok((item.landing ?? '').length > 8, `${item.id} 要写清本仓的生效点，否则就是假控件`)
  }
})

test('只有真的有生效点的档能画控件（implicit 与 none 一律不画）', () => {
  assert.deepEqual(MATCHER_SWITCHES.filter(item => item.support === 'effective').map(item => item.id),
    ['caseSensitive', 'wholeWords', 'invertCondition'])
  // `regex` 与 `looseMatching` 有生效点但**没有用户开关**：上游 MatchOptions 里就没有 `regex` 这一位
  // （`MatchOptions.java:28-40` 的全部字段），模板本来就是编译成 matcher 的。
  assert.equal(switchOf('regex').support, 'implicit')
  assert.equal(switchOf('looseMatching').support, 'implicit')
  assert.equal(switchOf('substituteInComments').support, 'none')
})

test('默认档抄上游：caseSensitive=false、looseMatching=true、searchInjectedCode=true', () => {
  const defaults = defaultMatcherSwitches()
  // `MatchOptions.java:58-63` 的构造器只赋了 `looseMatching=true`/`searchInjectedCode=true`/`pattern=""`，
  // 其余 boolean 保持 Java 默认的 false —— 所以「区分大小写」在上游默认是**关**的。
  assert.equal(defaults.caseSensitive, false)
  assert.equal(defaults.wholeWords, false)
  assert.equal(defaults.looseMatching, true)
  assert.equal(defaults.searchInjectedCode, true)
  assert.equal(defaults.recursiveSearch, false)
})

test('matcherFlags 与上游同方向：不区分大小写时加 i，区分时不加', () => {
  assert.equal(matcherFlags({ caseSensitive: false, wholeWords: false }), 'i')
  assert.equal(matcherFlags({ caseSensitive: true, wholeWords: true }), '')
  // 复核这一侧必须跟着同一套标志（`RegExpPredicate.java:58` 的 CASE_INSENSITIVE 那一支）。
  const logged = compileStructuralPattern('log($x$)')
  assert.equal(new RegExp(logged.regex, matcherFlags({ caseSensitive: true, wholeWords: false })).test('LOG(a)'), false)
  assert.equal(new RegExp(logged.regex, matcherFlags({ caseSensitive: false, wholeWords: false })).test('LOG(a)'), true)
})

test('全词档不碰没开它的编译产物（既有正则一字不变）', () => {
  const bare = compileStructuralPattern('$x$::y')
  assert.equal(bare.regex, '([A-Za-z_$][\\w$]*)::y')
  assert.equal(compileStructuralPattern('$x$::y', {}).regex, bare.regex, '传空对象也不该改形状')
  assert.equal(compileStructuralPattern('$x$::y', { wholeWords: false }).regex, bare.regex)
})

test('全词档把两端 \\b 写进每个变量的捕获组，并且只吃完整的词', () => {
  const w = compileStructuralPattern('$x$::y', compileSwitches({ caseSensitive: false, wholeWords: true }))
  // 形状按意图断言（两端边界真的在捕获组里），不锁死重复项那一段的写法：
  // 那是 `bounded()` 对 min=max=1 的既有产物，与既有已编译正则同源。
  assert.match(w.regex, /^\(\\b\[A-Za-z_\$]\[\\w\$]\*\\b/, w.regex)
  assert.ok(w.regex.endsWith(')::y'), w.regex)
  assert.equal(w.constraints.get('x').wholeWordsOnly, true, '面板要读得回这一档（摘要行与写回都靠它）')
  // 真的行为差别：变量不许是某个词的**尾巴**。
  assert.ok(new RegExp(w.regex).test('abc::y'), '整词照旧命中')
  assert.equal(new RegExp(w.regex).test('1abc::y'), false, '1abc 里的 abc 不是完整的词')
  // 没开全词时那一截尾巴是能匹配到的 —— 说明这一档确实改了判定，不是摆设。
  assert.ok(new RegExp(compileStructuralPattern('$x$::y').regex).test('1abc::y'))
})

test('全词档与已经写好的变量约束共存：regex 那一支的整段断言还在，量词列表也照样套上', () => {
  const both = compileStructuralPattern('$x$[regex(get.*)] $y${0,2}', compileSwitches({ caseSensitive: true, wholeWords: true }))
  assert.equal(both.constraints.get('x').wholeWordsOnly, true)
  assert.equal(both.constraints.get('y').wholeWordsOnly, true)
  assert.equal(both.variables.join(','), 'x,y', '组号顺序不许因为开关而移位')
  // `get.*` 那一支仍是「整段匹配 + 末尾不是标识符字符」（`RegExpPredicate.java:54-56` 的两端词边界同形）。
  assert.match(both.regex, /\(\?:get\.\*\)\(\?!\[A-Za-z0-9_\$\]\)/)
  // 裸标识符那一支（`$y$`）**因为**这一档才多出来两端 `\b` —— 没开全词时它是另一条正则。
  assert.match(both.regex, /\\b\[A-Za-z_\$]\[\\w\$]\*\\b/)
  const without = compileStructuralPattern('$x$[regex(get.*)] $y${0,2}')
  assert.ok(!without.regex.includes('\\b[A-Za-z_$][\\w$]*\\b'), without.regex)
  assert.ok(new RegExp(both.regex).test('getA getC'))
})

test('没有落点的开关档各自写了具体卡点（面板底部那行说明的直接数据源）', () => {
  const ids = unavailableSwitches().map(item => item.id)
  assert.deepEqual(ids, ['recursiveSearch', 'searchInjectedCode', 'withinHierarchy', 'substituteInComments'])
  for (const item of unavailableSwitches()) {
    assert.ok((item.reason ?? '').length > 20, `${item.id} 的卡点要写具体`)
    // 「注释内替换」那一档的名字（substitueInComments）在基准树里搜不到，说明文字里必须留住这条取证结论。
    if (item.id === 'substituteInComments') assert.match(item.reason, /无法核实/)
  }
  // 反向护栏：把某一档改成有落点，它就不能再出现在这份列表里。
  const before = unavailableSwitches().length
  MATCHER_SWITCHES.find(item => item.id === 'recursiveSearch').support = 'effective'
  assert.equal(unavailableSwitches().length, before - 1)
  MATCHER_SWITCHES.find(item => item.id === 'recursiveSearch').support = 'none'
  assert.equal(unavailableSwitches().length, before)
})

// ── 接线判据：开关必须真的走到达人的那条通道（面板的 query 与状态行），不是只过自己的单测 ──

/** 建一个只挂了必要输入的面板模型。 */
function model(template, extra) {
  const enabled = ref(true)
  const query = ref(template)
  const replacement = ref('')
  const caseSensitive = ref(false)
  const wholeWord = ref(false)
  const m = createStructuralSearchModel({ enabled, template: query, replacement, caseSensitive, wholeWord, ...extra })
  return { m, enabled, query, replacement, caseSensitive, wholeWord }
}

test('面板的「全词」改变发给宿主的 query（不是被静默丢掉的那一档）', () => {
  const { m, wholeWord } = model('$x$::y')
  assert.equal(m.activeQuery.value, '([A-Za-z_$][\\w$]*)::y')
  wholeWord.value = true
  assert.match(m.activeQuery.value, /^\(\\b\[A-Za-z_\$]\[\\w\$]\*\\b/)
  assert.notEqual(m.activeQuery.value, '([A-Za-z_$][\\w$]*)::y', '开关必须真的改变产物')
  assert.equal(m.error.value, '', '全词不是语法错，不该挡住搜索')
})

test('复核口径跟着「区分大小写」走：宿主与复核必须用同一套标志，否则真命中会被假剔除', () => {
  const { m, caseSensitive } = model('log($x$)')
  // 挂一个匹配范围才逼得出复核这一层（没有跨度档时 refine 不重跑正则，见 needsSpanCheck）。
  m.scope.value = { within: 'log($y$)', invert: false }
  const rows = [{ path: 'a.ts', line: 1, column: 0, text: 'LOG(a)' }]
  assert.deepEqual(m.refine(rows, row => ({ ...row })).map(row => row.line), [1], '不区分大小写时这一行留得下')
  caseSensitive.value = true
  assert.deepEqual(m.refine(rows, row => ({ ...row })).map(row => row.line), [], '区分大小写时这一行不属于这次搜索')
  assert.match(m.note.value, /复核不上/, '要说清是复核不上，不是修饰符否决')
})

test('状态行只说挂着的修饰符（按钮自己亮着的档不在这里重复），撤掉后回到空串', () => {
  const { m, wholeWord } = model('$x$ == null')
  assert.equal(m.note.value, '')
  wholeWord.value = true
  // 全词是按钮态（`fs-toggle` 的 `on` + aria-pressed），不是修饰符档 ⇒ 状态行不许因为它而变。
  assert.equal(m.note.value, '')
  m.scope.value = { within: 'if ($c$) { $y$ == null }', invert: true }
  assert.equal(m.note.value, 'Within=!if ($c$) { $y$ == null }')
  m.scope.value = null
  assert.equal(m.note.value, '')
})

test('替换定义表由模型持有，并且真的折进发给宿主的替换串（面板写它就有反应）', () => {
  const { m } = model('log($x$)')
  assert.ok(Array.isArray(m.definitions.value), '模型自己持有这张表（上游 ReplaceOptions.variableDefs）')
  assert.equal(m.activeReplacement.value, '', '替换框为空时产物也是空')
  m.definitions.value = [{ name: 'x', text: 'logger' }]
  const withDefinition = model('log($x$)')
  withDefinition.replacement.value = 'warn($x$)'
  withDefinition.m.definitions.value = [{ name: 'x', text: 'logger' }]
  assert.equal(withDefinition.m.activeReplacement.value, 'warn(logger)')
  withDefinition.m.definitions.value = [{ name: 'zz', text: 'v' }]
  assert.match(withDefinition.m.error.value, /在模板里不存在/, '定义指向不存在的变量必须挡在发请求之前')
})

test('「替换定义」那一节的编辑面真的接在面板上（不是只有模型侧的单测）', () => {
  const filters = readFileSync(new URL('../src/components/StructuralSearchFilters.vue', import.meta.url), 'utf8')
  assert.match(filters, /import \{[^}]*defineReplacementVariable[^}]*\} from '\.\.\/structuralSearchReplace\.ts'/)
  assert.match(filters, /function commitDefinition\(name: string, raw: string\)/)
  assert.match(filters, /v-if="replaceable"/, '替换框为空时整节不渲染（不放假控件）')
  assert.match(filters, /emit\('update:definitions'/, '改动要 emit 回宿主')
  const panel = readFileSync(new URL('../src/components/SearchPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /:definitions="structuralModel\.definitions\.value"/)
  assert.match(panel, /@update:definitions="structuralModel\.definitions\.value = \$event"/)
  assert.match(panel, /structuralModel\.definitions\.value = \[\]/, 'reset() 要连着清掉定义表')
})

test('取反那一档的三个控件都走模型同一条翻转规则（含上游 error.cannot.invert 的文案）', () => {
  const filters = readFileSync(new URL('../src/components/StructuralSearchFilters.vue', import.meta.url), 'utf8')
  assert.match(filters, /import \{[^}]*toggleInvert[^}]*\} from '\.\.\/structuralSearchModifiers\.ts'/)
  assert.match(filters, /flippedInvert\('regex'/)
  assert.match(filters, /flippedInvert\('contains'/)
  assert.match(filters, /flippedInvert\('within'/)
  // 没有落点的开关档也在那行说明里点名（面板底部，不画控件）。
  assert.match(filters, /unavailableSwitches\(\)/)
})

test('替换预览的计数走到达人的状态行（命中/文件/将替换，另加"前后一样"与"算不出"两种）', () => {
  const { m, replacement } = model('log($x$)')
  assert.equal(m.pending.value, null, '替换框为空时不出这一句')
  replacement.value = 'log($x$)'
  const kept = m.refine([
    { path: 'a.ts', line: 1, column: 0, text: 'log(a)' },
    { path: 'b.ts', line: 2, column: 0, text: 'log(b)' },
  ])
  assert.equal(kept.length, 2)
  // 替换串就是原样回填 ⇒ 两处都"前后一样"，一处都不会真改（`Replacer.insertSubstitution` 的同族判定）。
  assert.deepEqual(m.pending.value, { hits: 2, files: 2, willChange: 0, unchanged: 2, unverifiable: 0 })
  assert.match(m.note.value, /2 处命中 · 2 个文件 · 0 处将替换/)
  assert.match(m.note.value, /2 处替换前后一样/)
  replacement.value = 'warn($x$)'
  m.refine([{ path: 'a.ts', line: 1, column: 0, text: 'log(a)' }, { path: 'a.ts', line: 9, column: 0, text: '什么都没有' }])
  assert.deepEqual(m.pending.value, { hits: 2, files: 1, willChange: 1, unchanged: 0, unverifiable: 1 })
  assert.match(m.note.value, /1 处本仓算不出替换后的样子/, '算不出的那些要单独说，不许混进"将替换"')
})

test('开关档的默认值与面板初始档同口径（caseSensitive/wholeWords 上游默认都是关）', () => {
  const defaults = defaultMatcherSwitches()
  assert.equal(defaults.caseSensitive, false)
  assert.equal(defaults.wholeWords, false)
  // 面板的两个初始档就是从这张表取的（`SearchPanel.vue` 里那两行 `ref(defaultMatcherSwitches()…)`）。
  const source = readFileSync(new URL('../src/components/SearchPanel.vue', import.meta.url), 'utf8')
  assert.match(source, /const caseSensitive = ref\(defaultMatcherSwitches\(\)\.caseSensitive\)/)
  assert.match(source, /const wholeWord = ref\(defaultMatcherSwitches\(\)\.wholeWords\)/)
  assert.match(source, /createStructuralSearchModel\(\{[^)]*wholeWord/, '全词必须真的传进模型，不是被清掉的那一档')
  // 「全词」不许再被 `$` 按钮清掉（清掉就是假控件：按钮亮着而判定里没有它）。
  assert.doesNotMatch(source, /if \(structural\) \{?[^}]*wholeWord = false/, '结构化模式不许再把全词强制关掉')
})
