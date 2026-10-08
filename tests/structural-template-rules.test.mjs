// `src/structuralTemplateRules.ts` 的判据 —— 判词 `ss/matcher` 的
// 「模板的 PSI 合法性」与「`$Args$` 一族」两条待办。
//
// 上游依据（基准树 `D:/Backup/Downloads/intellij-community-master`，每条都亲自打开确认过那一行）：
//   · 变量词法 `platform/analysis-impl/src/com/intellij/codeInsight/template/impl/TemplateTextLexer.flex:21-29`
//     （`ALPHA`/`DIGIT`/`VARIABLE`/`$$` 转义/`TEXT`）；
//   · 取名与判名 `platform/lang-impl/src/com/intellij/codeInsight/template/impl/TemplateImplUtil.java:18-35,45-52`；
//   · 保留变量 `platform/structuralsearch/source/com/intellij/structuralsearch/plugin/ui/Configuration.java:29`（`__context__`）、
//     `…/impl/matcher/predicates/ScriptLog.java:18`（`__log__`）、
//     `…/plugin/replace/ui/ReplaceConfiguration.java:18`（`$replacement` 后缀）；
//   · 量词与条件块 `…/impl/matcher/compiler/StringToConstraintsTransformer.java:94-167,215-241,265-295,331-410,412-484,486-493`；
//   · 前缀泄漏 `…/impl/matcher/compiler/PatternCompiler.java:177-199`；
//   · 递归引用 `…/Matcher.java:95-105`；
//   · 替换侧 `…/plugin/replace/impl/Replacer.java:310-321`；
//   · 表达式错配 `java/structuralsearch-java/src/com/intellij/structuralsearch/JavaStructuralSearchProfile.java:644`、
//     `plugins/kotlin/code-insight/structural-search-k2/src/…/KotlinStructuralSearchProfile.kt:255`；
//   · 修饰符 `JavaStructuralSearchProfile.java:671-681`；
//   · 文案两份包 `platform/structuralsearch/resources/messages/SSRBundle.properties`
//     与 `localization-zh.jar` 的 `messages/SSRBundle.properties`。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ARGS_FAMILY_PROBE, COMPLETE_MATCH_VARIABLE, KNOWN_OPTIONS, MAX_OCCURS, MODIFIER_NAMES,
  REPLACEMENT_VARIABLE_SUFFIX, RESERVED_VARIABLES, SCRIPT_LOG_VARIABLE, TEMPLATE_MESSAGES,
  TYPED_VAR_PREFIX, checkRecursiveReference, dollarVariableNames, firstIssue, isReplacementVariableName,
  isReservedVariableName, isValidVariableToken, isVariableName, replacementVariableName, reservedVariable,
  scanDollarTokens, scanTypedVariables, targetOfRawName, templateMessage, templateMessageEn,
  validateDollarTemplate, validateModifier, validateUpstreamTemplate, willNotFindAnything,
} from '../src/structuralTemplateRules.ts'

test('变量词法照 TemplateTextLexer.flex:21-23 的 `({ALPHA}|{DIGIT})+`', () => {
  assert.ok(isVariableName('x'))
  assert.ok(isVariableName('_'))
  assert.ok(isVariableName('Args'))
  assert.ok(isVariableName('123'))
  assert.ok(!isVariableName('a b'))
  assert.ok(!isVariableName('a-b'))
  assert.ok(!isVariableName(''))
})

test('isValidVariableToken 照 TemplateImplUtil.java:49-52（长度 > 2、两端 $、名字合法）', () => {
  assert.ok(isValidVariableToken('$x$'))
  assert.ok(isValidVariableToken('$Args$'))
  // 长度 <= 2 不是变量（`:50` 的 `var.length() > 2`）：`$$` 是转义美元。
  assert.ok(!isValidVariableToken('$$'))
  assert.ok(!isValidVariableToken('$a'))
  assert.ok(!isValidVariableToken('x$'))
})

test('`$$` 是转义美元、落单 `$` 是文本（TemplateTextLexer.flex:27,29）', () => {
  const tokens = scanDollarTokens('a$$b$')
  assert.deepEqual(tokens.map(t => t.kind), ['text', 'escape', 'text', 'text'])
  assert.deepEqual(tokens.map(t => t.start), [0, 1, 3, 4])
  assert.deepEqual(dollarVariableNames('$x$ $$ $y$'), ['x', 'y'])
})

test('保留变量只有上游真正特判过的那两个（Configuration.java:29 / ScriptLog.java:18）', () => {
  assert.deepEqual(RESERVED_VARIABLES.map(v => v.name), [COMPLETE_MATCH_VARIABLE, SCRIPT_LOG_VARIABLE])
  assert.equal(COMPLETE_MATCH_VARIABLE, '__context__')
  assert.equal(SCRIPT_LOG_VARIABLE, '__log__')
  assert.ok(isReservedVariableName('__context__'))
  assert.ok(!isReservedVariableName('Args'))
  assert.equal(reservedVariable('__log__')?.label, '脚本日志')
  assert.equal(reservedVariable('__context__')?.label, '完全匹配')
  assert.equal(reservedVariable('Args'), null)
})

test('替换侧变量后缀照 ReplaceConfiguration.java:18', () => {
  assert.equal(REPLACEMENT_VARIABLE_SUFFIX, '$replacement')
  assert.equal(replacementVariableName('x'), 'x$replacement')
  assert.ok(isReplacementVariableName('x$replacement'))
  assert.ok(!isReplacementVariableName('x'))
  // 纯后缀本身不算（长度必须大于后缀）。
  assert.ok(!isReplacementVariableName(REPLACEMENT_VARIABLE_SUFFIX))
})

test('目标变量：`_` 前缀 = 不进用法树（StringToConstraintsTransformer.java:65-83）', () => {
  assert.deepEqual(targetOfRawName('x'), { name: 'x', target: true })
  assert.deepEqual(targetOfRawName('_x'), { name: 'x', target: false })
  assert.deepEqual(targetOfRawName('_'), { name: '', target: false })
})

test('`$Args$` 就是普通变量，列表语义靠量词（:100-112）', () => {
  const scan = scanTypedVariables("'_Args*")
  assert.equal(scan.issues.length, 0)
  assert.equal(scan.variables.length, 1)
  assert.equal(scan.variables[0].name, 'Args')
  assert.equal(scan.variables[0].minOccurs, 0)
  assert.equal(scan.variables[0].maxOccurs, MAX_OCCURS)
  assert.equal(scan.variables[0].target, false)
  // 匿名变量编号照 `:70-77`：`'_` → `_1`、`_2`…
  const anon = scanTypedVariables("'_ '_")
  assert.deepEqual(anon.variables.map(v => v.name), ['_1', '_2'])
})

test('预定义模板里那个真实的列表变量（JavaPredefinedConfigurations.java:387）', () => {
  const scan = scanTypedVariables("throw new 'ExceptionType('_ExceptionConstructorArgs*)")
  assert.equal(scan.issues.length, 0)
  const args = scan.variables.find(v => v.name === 'ExceptionConstructorArgs')
  assert.ok(args)
  assert.equal(args.maxOccurs, MAX_OCCURS)
  assert.equal(args.target, false)
})

test('量词 `+`/`?`/`{n}`/`{n,}`/`{,m}` 照 :100-158', () => {
  assert.equal(scanTypedVariables("'a+").variables[0].maxOccurs, MAX_OCCURS)
  assert.equal(scanTypedVariables("'a?").variables[0].minOccurs, 0)
  assert.deepEqual(
    [scanTypedVariables("'a{2}").variables[0].minOccurs, scanTypedVariables("'a{2}").variables[0].maxOccurs],
    [2, 2],
  )
  assert.equal(scanTypedVariables("'a{2,}").variables[0].maxOccurs, MAX_OCCURS)
  assert.equal(scanTypedVariables("'a{,3}").variables[0].minOccurs, 0)
  assert.equal(scanTypedVariables("'a{2,3}").variables[0].maxOccurs, 3)
  // 量词后的 `?` 是非贪婪（:160-166）。
  assert.equal(scanTypedVariables("'a{2,3}?").variables[0].greedy, false)
})

test('量词语法错的文案照 :139-148', () => {
  assert.equal(firstIssue(scanTypedVariables("'a{"))?.code, 'digitExpected')
  // Java 的 `ch` 跨循环存活（`:43`/`:117`/`:127`），所以 `{2`、`{2,` 都停在数字上 ⇒ brace1（`:141`）；
  // `{,2` 是下界缺、上界给了 ⇒ 合法（`:150-151` 的 `minOccurs == -1 → 0`）。
  assert.equal(firstIssue(scanTypedVariables("'a{2"))?.code, 'brace1Expected')
  assert.equal(firstIssue(scanTypedVariables("'a{2,"))?.code, 'brace1Expected')
  assert.equal(scanTypedVariables("'a{,2}").issues.length, 0)
  assert.equal(scanTypedVariables("'a{,2}").variables[0].minOccurs, 0)
  assert.equal(scanTypedVariables("'a{,2}").variables[0].maxOccurs, 2)
  assert.equal(firstIssue(scanTypedVariables("'a{}"))?.code, 'emptyQuantifier')
})

test('条件块的选项名照 :20-31、未知项报 option.is.not.recognized（:347）', () => {
  assert.deepEqual([...KNOWN_OPTIONS], [
    'ref', 'regex', 'regexw', 'exprtype', 'formal', 'script', 'contains', 'within', 'context',
  ])
  assert.equal(firstIssue(scanTypedVariables("'a:[nosuch]"))?.code, 'unrecognizedOption')
  assert.equal(scanTypedVariables("'a:[regex(ab)]").issues.length, 0)
})

test('`within`/`context` 只允许写在完全匹配上（:463-474）', () => {
  const bad = firstIssue(scanTypedVariables("'a:[within(statement in if)]"))
  assert.equal(bad?.code, 'onlyApplicableToCompleteMatch')
  assert.equal(templateMessage('onlyApplicableToCompleteMatch', 'within'), "约束 'within' 仅适用于完全匹配")
  // 写在**模板开头**的 `[cond]` 上合法 —— 那一支作用在「整个模板」（`:45-49`）。
  assert.equal(scanTypedVariables("[within(statement in if)]'a").issues.length, 0)
  assert.equal(scanTypedVariables("[context(x)]'a").issues.length, 0)
  // 写在变量名 `__context__` 上不合法（`'` 分支不剥下划线，名字对不上）。
  assert.equal(firstIssue(scanTypedVariables("'__context__:[within(x)]"))?.code, 'onlyApplicableToCompleteMatch')
})

test('`script`/`context` 不能取反、用户选项不能取反（:456,471,478）', () => {
  assert.equal(firstIssue(scanTypedVariables("'a:[!script(x)]"))?.code, 'cannotInvert')
  assert.equal(firstIssue(scanTypedVariables("[!context(x)]'a"))?.code, 'cannotInvert')
  assert.equal(firstIssue(scanTypedVariables("'a:[!_custom(x)]"))?.code, 'cannotInvert')
})

test('两个不同正则 = error.two.different.type.constraints（:320）', () => {
  const bad = firstIssue(scanTypedVariables("'a:[regex(a)&&regex(b)]"))
  assert.equal(bad?.code, 'twoDifferentTypeConstraints')
  assert.equal(scanTypedVariables("'a:[regex(a)&&regex(a)]").issues.length, 0)
})

test('坏正则报 invalid.regular.expression（:491）', () => {
  const bad = firstIssue(scanTypedVariables("'a:[regex([)]"))
  assert.equal(bad?.code, 'invalidRegex')
})

test('目标变量唯一（:174-177）、约束只能写在首次引用（:179-181）', () => {
  assert.equal(firstIssue(scanTypedVariables("'a 'b")).code, 'onlyOneTarget')
  assert.equal(scanTypedVariables("'a 'a").issues.length, 0)
  // `'_x` 不是目标（`:65-83`），所以一个目标 + 任意个 `'_x` 是合法的。
  assert.equal(scanTypedVariables("'a '_b '_c").issues.length, 0)
  // 量词写在第二次引用上 → 报错。
  assert.equal(firstIssue(scanTypedVariables("'a 'a+")).code, 'constraintOnlyOnFirstReference')
  assert.equal(firstIssue(scanTypedVariables("'a 'a:[regex(x)]")).code, 'constraintOnlyOnFirstReference')
})

test('`::` 是转义的双冒号，不消费字符（:187-190）', () => {
  // 两个都是目标 ⇒ 同时命中「仅允许一个目标」；`::` 本身不消费字符。
  const scan = scanTypedVariables("'a::'b")
  assert.deepEqual(scan.issues.map(i => i.code), ['onlyOneTarget'])
  assert.deepEqual(scan.variables.map(v => v.name), ['a', 'b'])
  const single = scanTypedVariables("'a::'_b")
  assert.equal(single.issues.length, 0)
})

test('空条件块与缺条件报 error.expected.condition（:292,409）', () => {
  assert.equal(firstIssue(scanTypedVariables("'a:[]"))?.code, 'conditionExpected')
  assert.equal(firstIssue(scanTypedVariables("'a:"))?.code, 'conditionExpected')
})

test('条件块里缺实参/缺右括号（:372,374）', () => {
  assert.equal(firstIssue(scanTypedVariables("'a:[regex()]"))?.code, 'argumentExpected')
  assert.equal(firstIssue(scanTypedVariables("'a:[regex(ab]"))?.code, 'valueExpected')
})

test('`&&` 前后必须都有选项（:385-393,409）', () => {
  assert.equal(firstIssue(scanTypedVariables("'a:[regex(a)&&]"))?.code, 'conditionExpected')
  assert.equal(firstIssue(scanTypedVariables("'a:[&&regex(a)]"))?.code, 'unexpectedValue')
})

test('`$` 模板里 `__$_` 前缀泄漏照 PatternCompiler.java:177-199', () => {
  const bad = validateDollarTemplate(`$x$ ${TYPED_VAR_PREFIX}1`)
  assert.equal(bad.ok, false)
  assert.equal(firstIssue(bad)?.code, 'malformed')
})

test('`$` 模板允许多个变量（没有「目标唯一」那条，那是上游单引号语法专属）', () => {
  const multi = validateDollarTemplate('$a$ $b$')
  assert.equal(multi.ok, true)
  assert.deepEqual(multi.variables, ['a', 'b'])
  const good = validateDollarTemplate('$_a$ $b$')
  assert.equal(good.ok, true)
  assert.deepEqual(good.variables, ['_a', 'b'])
  const withContext = validateDollarTemplate('$__context__$')
  assert.deepEqual(withContext.reserved, [COMPLETE_MATCH_VARIABLE])
})

test('`$` 模板的替换侧变量未定义照 Replacer.java:313', () => {
  const bad = validateDollarTemplate('$a$', { replacement: '$b$' })
  assert.equal(firstIssue(bad)?.code, 'replacementVariableNotDefined')
  assert.equal(templateMessage('replacementVariableNotDefined', 'b'), "未知搜索变量 'b' 或替换变量 'b' 没有脚本")
  // 有定义表时放行。
  assert.equal(validateDollarTemplate('$a$', { replacement: '$b$', definedVariables: ['b'] }).ok, true)
})

test('表达式错配的两条文案（JavaStructuralSearchProfile.java:644 / Kotlin…Profile.kt:255）', () => {
  const a = validateDollarTemplate('$a$', { searchIsExpression: true, replaceIsExpression: false })
  assert.equal(firstIssue(a)?.code, 'replacementNotExpression')
  assert.equal(templateMessage('replacementNotExpression'), '表达式无法替换为非表达式')
  const b = validateDollarTemplate('$a$', { searchIsExpression: false, replaceIsExpression: true })
  assert.equal(firstIssue(b)?.code, 'searchNotExpression')
  assert.equal(templateMessage('searchNotExpression'), '非表达式无法替换为表达式')
})

test('不支持替换的文件类型（StructuralSearchProfile.java:241）', () => {
  const bad = validateDollarTemplate('$a$', { fileType: 'XML', replacementSupported: false })
  assert.equal(firstIssue(bad)?.code, 'replacementNotSupported')
  assert.equal(templateMessage('replacementNotSupported', 'XML'), 'XML 文件类型不支持替换')
})

test('递归引用与模板找不到（Matcher.java:98,103）', () => {
  const self = checkRecursiveReference('a', { a: ['a'] })
  assert.equal(self?.code, 'recursiveReference')
  assert.equal(templateMessage('recursiveReference'), '模板以递归方式引用自身')
  const missing = checkRecursiveReference('a', { a: ['b'] })
  assert.equal(missing?.code, 'configurationNotFound')
  assert.equal(templateMessage('configurationNotFound', 'b'), "找不到模板 'b'")
  assert.equal(checkRecursiveReference('a', { a: ['b'], b: [] }), null)
})

test('修饰符取值照 JavaStructuralSearchProfile.java:671-681', () => {
  assert.ok(MODIFIER_NAMES.includes('public'))
  assert.ok(MODIFIER_NAMES.includes('Instance'))
  assert.ok(MODIFIER_NAMES.includes('packageLocal'))
  assert.equal(validateModifier('public'), null)
  const bad = validateModifier('nosuch')
  assert.equal(bad?.code, 'invalidModifierType')
  assert.equal(templateMessage('invalidModifierType', 'nosuch'), '无效的修饰符类型 nosuch')
})

test('「一个都没匹配到」的提示照 PatternCompiler.java:125', () => {
  const note = willNotFindAnything('Project Files')
  assert.equal(note.code, 'willNotFindAnything')
  assert.equal(templateMessage('willNotFindAnything', 'Project Files'),
    "指定模板与作用域 'Project Files' 中的任何内容都不匹配")
})

test('文案表逐条指到 EN/中文包的真实行号', () => {
  assert.equal(TEMPLATE_MESSAGES.malformed.enLine, 56)
  assert.equal(TEMPLATE_MESSAGES.malformed.zhLine, 279)
  assert.equal(TEMPLATE_MESSAGES.onlyOneTarget.enLine, 255)
  assert.equal(TEMPLATE_MESSAGES.onlyOneTarget.zhLine, 44)
  assert.equal(TEMPLATE_MESSAGES.invalidRegex.enLine, 234)
  assert.equal(TEMPLATE_MESSAGES.invalidRegex.zhLine, 75)
  assert.equal(TEMPLATE_MESSAGES.willNotFindAnything.enLine, 289)
  // `''{0}''` 的引号形状照抄（properties 里是双单引号），填参后变单引号。
  assert.equal(templateMessageEn('unrecognizedOption', 'zzz'), "Constraint 'zzz' not recognized")
  assert.equal(templateMessage('unrecognizedOption', 'zzz'), "未识别约束 'zzz'")
})

test('`validateUpstreamTemplate` 把保留变量与前缀泄漏一起报出来', () => {
  const bad = validateUpstreamTemplate(`'x ${TYPED_VAR_PREFIX}1`)
  assert.equal(bad.ok, false)
  assert.deepEqual(bad.reserved, [])
  assert.equal(firstIssue(bad)?.code, 'malformed')
  // 保留变量名出现在脚本文本里时登记出来（`__context__` 见 JavaPredefinedConfigurations.java:96）。
  const scripted = validateUpstreamTemplate("'x:[script(!__context__.interface)]")
  assert.equal(scripted.issues.length, 0)
  assert.deepEqual(scripted.reserved, [COMPLETE_MATCH_VARIABLE])
  // `'_b` 不是目标，所以一个目标 + 一个非目标是合法的（`:65-83`）。
  const good = validateUpstreamTemplate("'a '_b:[regex(x)]")
  assert.equal(good.ok, true)
  assert.deepEqual(good.reserved, [])
})

test('`$Args$` 一族在基准树里的核实结果：没有预定义表', () => {
  assert.equal(ARGS_FAMILY_PROBE.length, 5)
  for (const probe of ARGS_FAMILY_PROBE) {
    if (probe.name === "'_ExceptionConstructorArgs*") assert.equal(probe.verified, true)
    else assert.equal(probe.verified, false)
    assert.ok(probe.evidence.length > 0)
  }
})