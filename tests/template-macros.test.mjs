import test from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateTemplateExpression, isTemplateMacroExpression, nameToWordList, parseTemplateExpression,
  resolveTemplateSlotValues, templateMacroByName, templateMacroOfExpression, unknownMacroCall,
} from '../src/templateMacros.ts'
import { expand, render } from '../src/templates.ts'

const CTX = { path: 'src/main/App.java', now: () => new Date(2026, 9, 6, 9, 5, 0) }
const calc = (name, parameters, context = CTX) => templateMacroByName(name).calculate(parameters, context)
// 一个槽位单独求值：正文写成 `$X:表达式$`，只看它算出什么。
const slot = (expression, vars = {}, context = CTX) => render(`$X:${expression}$`, '', vars, context).text

// ---------------------------------------------------------------------------
// 解析：逐条对上 java/java-tests/testSrc/com/intellij/java/codeInsight/template/MacroParserTest.java
// ---------------------------------------------------------------------------

test('the expression parser matches the upstream MacroParser cases', () => {
  assert.deepEqual(parseTemplateExpression(''), { kind: 'constant', text: '' })
  const call = parseTemplateExpression('  capitalize(  "java.util.Collection"  )   ')
  assert.equal(call.kind, 'macro')
  assert.deepEqual(call.parameters, [{ kind: 'constant', text: 'java.util.Collection' }])
  const initial = parseTemplateExpression('capitalize(E="t")')
  assert.equal(initial.parameters[0].kind, 'variable')
  assert.equal(initial.parameters[0].name, 'E')
  assert.deepEqual(initial.parameters[0].initial, { kind: 'constant', text: 't' })
  assert.deepEqual(parseTemplateExpression('END'), { kind: 'end' })
  assert.equal(parseTemplateExpression('concat("A", "B")').parameters.length, 2)
  assert.equal(parseTemplateExpression('concat("test\\\\test\\n\\t\\f\\x")').parameters[0].text, 'test\\test\n\t\fx')
  assert.deepEqual(parseTemplateExpression('"'), { kind: 'constant', text: '' }, '未闭合的引号 → 空常量')
  assert.deepEqual(parseTemplateExpression('10'), { kind: 'constant', text: '' }, '数字开头不是标识符 → 空常量')
})

test('an unknown head identifier is a variable upstream and a literal here', () => {
  // MacroParser.java:67-70：宏表查不到就走 parseVariable。本仓那一段还兼任字面默认值（既有契约），
  // 所以查不到就**不动它**；unknownMacroCall 负责把「看着像宏调用」的那种挑出来提示用户。
  assert.equal(parseTemplateExpression('variableOfType("x")').kind, 'variable')
  assert.equal(isTemplateMacroExpression('variableOfType("x")'), false)
  assert.equal(unknownMacroCall('variableOfType("x")'), 'variableOfType')
  assert.equal(unknownMacroCall('capitalize(EXPR)'), null)
  assert.equal(unknownMacroCall('Exception'), null)
})

test('a slot default is only an expression when it starts with a registered macro', () => {
  for (const literal of ['Exception', '10', '待补充', 'item', 'var', 'vector', 'e', 'value', 'handler']) {
    assert.equal(isTemplateMacroExpression(literal), false, 'still a literal: ' + literal)
  }
  assert.equal(isTemplateMacroExpression('capitalize(EXPR)'), true)
  assert.equal(isTemplateMacroExpression('date'), true, '零参宏：标识符后面没有左括号（MacroParser.java:74-76）')
  assert.equal(isTemplateMacroExpression('concat(A, capitalize(B))'), true)
})

// ---------------------------------------------------------------------------
// 每条宏的行为；边界（arity、空串、null 实参）都写在这里
// ---------------------------------------------------------------------------

test('the case-transforming macros behave like their upstream classes', () => {
  assert.equal(calc('capitalize', ['value']), 'Value')
  assert.equal(calc('capitalize', ['']), '', 'CapitalizeMacro.java:27-30：空串仍出 TextResult')
  assert.equal(calc('decapitalize', ['Value']), 'value')
  assert.equal(calc('decapitalize', ['']), null, 'DecapitalizeMacro.java:26：空串出 null，不是空 TextResult')
  assert.equal(calc('firstWord', ['foo bar baz']), 'foo')
  assert.equal(calc('firstWord', ['foo']), 'foo')
  assert.equal(calc('spacesToUnderscores', ['a b']), 'a_b')
  assert.equal(calc('underscoresToSpaces', ['a_b']), 'a b')
  assert.equal(calc('escapeString', ['a"b\tc']), 'a\\"b\\tc', 'StringUtil.java:556-598：引号与制表都转义')
  assert.equal(calc('escapeString', ['a\nb']), 'a\\nb')
  assert.equal(calc('escapeString', [String.fromCharCode(1)]), '\\u0001', '不可打印字符补零成 4 位十六进制（StringUtil.java:586-593）')
  assert.equal(calc('capitalize', ['a', 'b']), null, 'arity：MacroBase.java:56 只认恰好一个实参')
  assert.equal(calc('camelCase', ['my-value_2']), 'myValue2')
  assert.equal(calc('underscoresToCamelCase', ['my_old_value']), 'myOldValue')
  assert.equal(calc('underscoresToCamelCase', ['a__b']), 'aB', '空段跳过（上游在这里会抛，见报告）')
  assert.equal(calc('capitalizeAndUnderscore', ['myValue']), 'MY_VALUE')
  assert.equal(calc('snakeCase', ['myValue']), 'my_value')
  assert.equal(calc('lowercaseAndDash', ['MyValue']), 'my-value')
  assert.equal(calc('spaceSeparated', ['myValue']), 'my Value')
  assert.equal(calc('capitalizeAndUnderscore', ['']), '', '空串出空 TextResult，不是 null（CapitalizeAndUnderscoreMacro.java:24）')
  assert.deepEqual(nameToWordList('my-value_2'), ['my', '-', 'value', '_', '2'], 'NameUtilCore.kt:143-183')
})
test('the text-mixing and file macros behave like their upstream classes', () => {
  assert.equal(calc('concat', ['a', null, 'b']), 'ab', 'ConcatMacro.java:24-26：null 的实参当空串跳过')
  assert.equal(calc('concat', []), null, '结果为空 → null（ConcatMacro.java:28）')
  assert.equal(calc('substringBefore', ['App.java', '.']), 'App')
  assert.equal(calc('substringBefore', ['.java', '.']), '', 'indexOf > 0 的原样口径：分隔符在 0 位 → 空串')
  assert.equal(calc('substringBefore', ['App.java']), null, 'arity：恰好两个实参（SubstringBeforeMacro.java:20）')
  assert.equal(calc('regularExpression', ['App123.java', '[0-9]+', 'X']), 'AppX.java')
  assert.equal(calc('regularExpression', ['abc', '(', 'x']), null, '坏正则 → null（RegExMacro.java:46-47）')
  assert.equal(calc('regularExpression', ['abc', 'a(b)c', '$2']), null, '组引用越界 → null（RegExMacro.java:44-45）')
  assert.equal(calc('regularExpression', ['abc']), null, 'arity：三个实参')
  assert.equal(calc('enum', ['one', 'two']), 'one', 'EnumMacro.java:42-45：取第一个实参的结果')
  assert.equal(calc('enum', []), null, '没有实参 → null（EnumMacro.java:43）')
  assert.equal(calc('fileName', []), 'App.java')
  assert.equal(calc('fileNameWithoutExtension', []), 'App')
  assert.equal(calc('filePath', []), 'src/main/App.java')
  assert.equal(calc('fileName', [], { path: 'src\\App.java' }), 'App.java', '反斜杠路径同样认')
})

test('regularExpression counts the capture groups it actually built', () => {
  // 命名捕获组占一个编号（`java.util.regex.Pattern` 与 ECMA-262 同判据：`(?<n>a)` 就是第 1 组），
  // 所以 `$1` 合法。原来那个数括号的 `/\((?!\?)/g` 把 `(?<` 一并排除在外，于是 `$1` 被判成越界 ⇒
  // 整条宏走 `RegExMacro.java:44-45` 的 null 档 ⇒ 用户在模板里看到的是回落 marker `"a"`，不是替换结果。
  assert.equal(calc('regularExpression', ['2026-10-06', '(?<y>[0-9]{4})-([0-9]{2})', '$1/$2']), '2026/10-06')
  assert.equal(calc('regularExpression', ['ab', '(?<n>a)(?<m>b)', '$2$1']), 'ba')
  // 阳性对照：钉住「没有为了这条而顺手放宽越界判据」—— 一个组时 `$2` 仍然 null。
  assert.equal(calc('regularExpression', ['ab', '(?<n>a)', '$1']), 'ab')
  assert.equal(calc('regularExpression', ['ab', '(?<n>a)', '$2']), null, '命名组只有一个时 $2 仍越界')
  // 反方向：字符类里的括号**不是**组。`[(]` 的组数是 0，所以 `$1` 该越界 → null，
  // 而不是像判据原样那样数出 1 个组、放过去后由引擎吐出一个字面 `$1`。
  assert.equal(calc('regularExpression', ['a(b', '[(]', '$1']), null, '[(] 没有捕获组')
  assert.equal(calc('regularExpression', ['a(b', '[(]', 'X']), 'aXb', '字符类本身照旧正常匹配')
  assert.equal(calc('regularExpression', ['abc', 'a(b)c', '$2']), null, '既有的越界那条不回归')
})

test('fileNameWithoutExtension follows FileUtilRt: a dotfile has an empty stem', () => {
  // 这条链是 `FilePathMacroBase.java:46-47` → `VirtualFile.java:196-198` → `FileUtilRt.java:439-441`：
  // `lastIndexOf('.')`，**只有找不到点（i<0）才留原名**，i=0 也照砍 ⇒ dotfile 的词干是空串。
  // 空结果再落这条宏自己的 `getDefaultValue()` = `Macro.java:30-32` 的 `""`（`FilePathMacroBase` 没覆写），
  // 所以 `.gitignore` 在模板里就是留空，不是 `.gitignore`。`src/fileTemplateVars.ts:49` 的 `fileNameStem`
  // 是 `dot > 0` 那一档（文件模板 `${NAME}` 的口径、另有消费方），本宏不借它。
  assert.equal(calc('fileNameWithoutExtension', [], { path: 'repo/.gitignore' }), '')
  assert.equal(calc('fileNameWithoutExtension', [], { path: 'repo/.hidden' }), '')
  assert.equal(calc('fileNameWithoutExtension', [], { path: 'repo/Makefile' }), 'Makefile', '没有点 → 原名')
  assert.equal(calc('fileNameWithoutExtension', [], { path: CTX.path }), 'App', '既有的那条不回归')
  assert.equal(calc('fileNameWithoutExtension', [], { path: 'repo/archive.tar.gz' }), 'archive.tar', '砍最后一个点')
  assert.equal(calc('fileNameWithoutExtension', [], { path: 'repo/.a.b' }), '.a')
})

test('the comment macros read the file extension, not PSI (CommentMacro.java:31-64)', () => {
  // java：行 + 块都有。CTX = src/main/App.java。
  assert.equal(calc('lineCommentStart', []), '//', '行注释前缀（CommentMacro.java:38-41 + :34-35）')
  assert.equal(calc('blockCommentStart', []), '/*')
  assert.equal(calc('blockCommentEnd', []), '*/')
  assert.equal(calc('commentStart', []), '//', 'AnyCommentStart 优先行注释（CommentMacro.java:58-62）')
  // css：只有块注释 —— 行注释宏一律 null（等同上游没有 lineCommentPrefix），commentStart 退到块开标记。
  const css = { path: 'theme/style.css' }
  assert.equal(calc('lineCommentStart', [], css), null, 'css 没有行注释前缀 → null（CommentMacro.java:34-35）')
  assert.equal(calc('blockCommentStart', [], css), '/*')
  assert.equal(calc('commentStart', [], css), '/*', '没有行注释就用块开标记')
  // py：只有行注释 —— 块宏 null。
  const py = { path: 'tools/run.py' }
  assert.equal(calc('lineCommentStart', [], py), '#')
  assert.equal(calc('blockCommentStart', [], py), null)
  assert.equal(calc('blockCommentEnd', [], py), null)
  // html：块注释 <!-- -->。
  assert.equal(calc('blockCommentStart', [], { path: 'web/index.html' }), '<!--')
  assert.equal(calc('blockCommentEnd', [], { path: 'web/index.html' }), '-->')
  // 未知扩展名 = 上游「没有 Commenter」：全部 null。
  const unknown = { path: 'notes.weirdext' }
  for (const name of ['lineCommentStart', 'blockCommentStart', 'blockCommentEnd', 'commentStart']) {
    assert.equal(calc(name, [], unknown), null, `${name} 认不出扩展名 → null`)
  }
  // 空结果回落成 marker "a"（MacroBase.java:47-49 的 getDefaultValue，TemplateState:1137-1141 的收尾）。
  assert.equal(slot('commentStart', {}, unknown), 'a', '未知语言的 commentStart 走 render 得到回退标记 "a"')
  // commentEnd 仍不实现（合法空串 vs 单格默认值两列差），宏表里查不到这个名字。
  assert.equal(templateMacroByName('commentEnd'), undefined, 'commentEnd 留在 DEFERRED，不进宏表')
})

// 带参数那一条是 `new SimpleDateFormat(pattern).format(new Date(time))`（`CurrentDateMacro.java:33-34`）：
// 认得出的字母出真实字段；认不出的字母上游**抛** `IllegalArgumentException`，被 `:36-38` 接住变成那句
// `Problem when formatting date/time for pattern "…"`，不是把字母原样打印出来。
test('the date pattern covers every letter it knows and rejects the rest', () => {
  const millis = { path: '', now: () => new Date(2026, 9, 6, 9, 5, 0, 7) }
  assert.equal(calc('date', ['HH:mm:ss.SSS'], millis), '09:05:00.007', 'S = 毫秒')
  assert.equal(calc('date', ['D'], millis), '279', 'D = 一年中的第几天（10 月 6 日 = 279）')
  assert.equal(calc('date', ['yyyyMMdd'], millis), '20261006', '字母段的宽度就是补零的宽度')
  const midnight = { path: '', now: () => new Date(2026, 0, 1, 0, 0, 0) }
  assert.equal(calc('time', ['k K a'], midnight), '24 0 AM', 'k = 1-24 时、K = 0-11 时：零点分别是 24 和 0')
  assert.equal(calc('date', ["'Z' yyyy"], millis), 'Z 2026', '引号档整体是原文，不参与字母表判定')
  assert.equal(calc('date', ['pp'], millis),
    'Problem when formatting date/time for pattern "pp": Unsupported pattern letter',
    '认不出的字母不能原样打印：用户要的是那句报错，不是半截日期')
})

// `StringUtil.java:605-611` 的 `isPrintableUnicode` 除了 UNASSIGNED/CONTROL/FORMAT/PRIVATE_USE/SURROGATE
// 与 LINE/PARAGRAPH_SEPARATOR，还把**两个变体选择符块**算作不可打印。
test('escapeString treats variation selectors as non-printable', () => {
  assert.equal(calc('escapeString', ['a\uFE0Fb']), 'a\\uFE0Fb', 'VS16 属于 U+FE00-FE0F 那块')
  assert.equal(calc('escapeString', ['\uFE0E']), '\\uFE0E')
  assert.equal(calc('escapeString', ['\uDB80\uDC00']), '\\uDB80\\uDC00',
    'VS 补充块（U+E0100-E01EF）本来就是代理对的两半，各自成一个 \\uDxxx')
  assert.equal(calc('escapeString', ['\u2764\uFE0F']), '\u2764\\uFE0F',
    '表情本体是可打印的 So，只有紧跟的选择符被转义')
  assert.equal(calc('escapeString', ['a\u00A0b']), 'a\u00A0b', 'Zs 不在上游那份排除表里 ⇒ 原样留着')
})

test('date and time read the injected clock and honour an explicit pattern', () => {
  assert.equal(calc('date', []), '2026/10/6')
  assert.equal(calc('time', []), '9:05')
  assert.equal(calc('date', ['yyyy-MM-dd HH:mm']), '2026-10-06 09:05')
  assert.equal(calc('date', ['d.M.yy']), '6.10.26')
  assert.equal(calc('date', ['MMM E']), 'Oct Tue', '月份名与星期名（SimpleDateFormat 的文本档）')
  assert.equal(calc('date', ['yyyy', 'x']), '2026/10/6', '实参不是**恰好一个**时走默认档（CurrentDateMacro.java:29）')
  assert.equal(calc('date', ["'y='yyyy"]), 'y=2026', '引号包起来的是原文')
  assert.equal(calc('date', ['ZZ']), 'Problem when formatting date/time for pattern "ZZ": Unsupported pattern letter',
    '认不出的样式走上游那条异常文案（CurrentDateMacro.java:36-38）')
  assert.equal(calc('date', [null]), '2026/10/6', '实参算不出来就退回默认档（CurrentDateMacro.java:30-41）')
})
test('predefined values are read, not recomputed; END and unknown names follow upstream', () => {
  const environment = { variables: { ITEM: 'item' }, predefined: { EXPR: 'list.size()' } }
  const evaluate = source => evaluateTemplateExpression(parseTemplateExpression(source), environment, CTX)
  assert.equal(evaluate('EXPR'), 'list.size()', 'TemplateStateBase.java:79-84：预定义表先命中')
  assert.equal(evaluate('ITEM'), 'item', '段落当前文本（TemplateStateBase.java:85-96）')
  assert.equal(evaluate('NO_SUCH'), null, '没有这个变量 → null')
  assert.equal(evaluate('END'), null, '独立成串的 END 是 EmptyNode（MacroParser.java:133-138，EmptyNode.java:15-17）')
  assert.equal(evaluate('capitalize(END)'), '', 'END 在实参位仍是变量，读到空串（TemplateStateBase.java:76-78）')
  assert.equal(evaluate('capitalize(EXPR)'), 'List.size()')
  assert.equal(evaluate('capitalize(camelCase(EXPR))'), 'ListSize', '嵌套宏：内层先算完再进外层')
  assert.equal(evaluate('unknownMacro(EXPR)'), null, '宏表查不到 → 不产出（MacroFactory.java:13-15）')
})

test('slot values converge; a never-settling ring is cut by the attempt cap', () => {
  const settled = resolveTemplateSlotValues(
    [{ name: 'A', rawDefault: 'decapitalize(B)' }, { name: 'B', rawDefault: 'capitalize(EXPR)' }],
    { EXPR: 'Value' }, CTX)
  assert.deepEqual(settled, { A: 'value', B: 'Value' }, 'TemplateState.java:662-680 的定形迭代：第一轮时 B 还是空串')
  const self = resolveTemplateSlotValues([{ name: 'A', rawDefault: 'capitalize(A)' }], {}, CTX)
  assert.equal(self.A, 'A', '自引用不挂死：稳定后就没有再变')
  const growing = resolveTemplateSlotValues(
    [{ name: 'A', rawDefault: 'concat(B, "x")' }, { name: 'B', rawDefault: 'concat(A, "y")' }], {}, CTX)
  assert.equal(growing.B.length, 18, '互相加长的环被 (变量数+1)*3 = 9 轮截断，每轮各加一个字符')
  assert.equal(growing.A.length, 17)
})

test('an empty macro result falls back to that macro getDefaultValue, the upstream marker', () => {
  assert.equal(slot('decapitalize(NO_SUCH)'), 'a', 'MacroBase.java:47-49 + TemplateState.java:1137-1141')
  assert.equal(slot('fileName', {}, { path: '' }), '', 'FilePathMacroBase 的 getDefaultValue 是空串（Macro.java:30-32）')
  assert.equal(slot('date'), '2026/10/6', '零参宏也算宏（MacroParser.java:74-76）')
  assert.equal(slot('capitalize('), 'a', '参数解析失败：右括号缺失只是日志（MacroParser.java:84-86），零参进宏')
  assert.equal(slot('nosuchmacro(EXPR)'), 'nosuchmacro(EXPR)', '未注册名 → 整段照旧是字面默认值')
})
test('render keeps the existing literal-default contract untouched', () => {
  assert.equal(render('a$END$b$X:y$', '', {}).text, 'aby')
  assert.equal(render('for ($TYPE$ $ITEM:item$ : $COLLECTION$)', '', {}).text, 'for ( item : )')
  assert.equal(render('$LIMIT:10$', '', {}).text, '10', '数字默认值**不**被当表达式（上游把它解析成空串）')
  assert.equal(render('$TYPE:Exception$', '', {}).text, 'Exception')
  assert.equal(render('$TEXT:待补充$', '', {}).text, '待补充')
  assert.deepEqual(render('$A:capitalize(EXPR)$', '', { EXPR: 'v' }, CTX).stops, [{ start: 0, end: 1 }],
    '预定义变量命中的槽位不产出可编辑区，与不写宏时同一形状')
})

test('macros reach the user through render and through a real expansion', () => {
  assert.equal(render('$NAME:decapitalize(EXPR)$', '', { EXPR: 'List' }, CTX).text, 'list')
  assert.equal(render('log("$ITEM:snakeCase(EXPR)$");$END$', '', { EXPR: 'Order State' }, CTX).text,
    'log("order_state");')
  assert.equal(render('final $TYPE:decapitalize(EXPR)$ $VALUE:capitalize(EXPR)$ = $EXPR$;', '',
    { EXPR: 'orderState' }, CTX).text, 'final orderState OrderState = orderState;')
  const settings = { overrides: [], customs: [
    { key: 'hdr', body: '/* $NAME:capitalize(fileNameWithoutExtension)$ */$END$', description: '文件头', languages: ['java'] },
  ] }
  const expanded = expand('  hdr', 5, 'src/main/App.java', settings)
  assert.equal(expanded.text, '/* App */', '展开时宏真的算了')
  assert.deepEqual(expanded.stops, [{ start: 3, end: 6 }], '算出来的值仍是可用 Tab 跳转的槽位')
})

test('the settings page reads the same table the engine evaluates', () => {
  assert.equal(templateMacroOfExpression('capitalize(EXPR)').name, 'capitalize')
  assert.equal(templateMacroOfExpression('Exception'), undefined)
  assert.equal(templateMacroOfExpression('date').presentableName, 'date()')
})

