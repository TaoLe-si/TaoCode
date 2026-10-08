// 代码块导航的「结构支持」那一半 + 结构化搜索的「列表变量整段」判据
// （判词点名的 `CodeBlockUtil.java:110`/`:178` 与 `ss/matcher` 的「列表变量」那一条）。
//
// 上游依据（行号按参考树逐行数过，与 src/structuralCodeBlock.ts 的头注释同一套）：
//   · `platform/lang-impl/src/com/intellij/codeInsight/editorActions/CodeBlockUtil.java:108-120`（块尾 min）、
//     `:176-188`（块首 max）
//   · `platform/lang-impl/src/com/intellij/codeInsight/highlighting/CodeBlockSupportHandler.java:57-66`
//   · `platform/analysis-impl/src/com/intellij/codeInsight/TargetElementUtilBase.java:56-74`
//     （`adjustOffset`：`:60-62` 文件尾 clamp 到 len-1、`:63-65` 不是标识符字符先退一格、`:66-73` 那两个字符才认）
//   · `python/python-parser/src/com/jetbrains/python/lexer/Python.flex:73-75`（串内 `\\` + 换行仍算同一条）与
//     `:175`（单个反斜杠是 BACKSLASH token）—— 物理续行属于同一条逻辑行的词法凭证
//   · `python/python-psi-impl/src/com/jetbrains/python/codeInsight/highlighting/PyControlFlowKeywordMatcher.kt`
//     `:48-59`（关键字表）、`:88-90`（offset 或 offset-1）、`:119-128`（标记区间与语句区间）、
//     `:130-137`（部件归属）、`:139-151`（同一条语句的部件收集）
//   · 列表变量：`platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/
//     compiler/StringToConstraintsTransformer.java:101,110`（`+`/`*` → maxOccurs = MAX_VALUE）与
//     `impl/matcher/handlers/SubstitutionHandler.java:318` + `:45-56`（一个变量吃的是**同一个父节点下
//     的连续兄弟节点**，逗号只是被滤掉的分隔符）⇒ 文本层的等价判据 = 括号深度同层。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  depthProfile, findCodeBlockRange, listRunEndsHere, listRunHolds, listRunStartsHere,
  mergeBlockEnd, mergeBlockStart, pythonCompoundKeywordRanges, pythonCompoundStatement,
} from '../src/structuralCodeBlock.ts'
import { compileStructuralPattern } from '../src/structuralSearch.ts'
import { execWithSpans, hasListVariable, listRunVerdict, needsSpanCheck } from '../src/structuralSearchModifiers.ts'

const caretOn = (text, word, nth = 0) => {
  let at = -1
  for (let i = 0; i <= nth; ++i) at = text.indexOf(word, at + 1)
  assert.ok(at >= 0, `找不到 ${word}`)
  return at
}

// ── A. 结构化搜索用的那半（生产消费方：src/structuralSearchModifiers.ts 的复核）──

test('括号深度剖面：字符串/注释里的括号不算数，数组长度对齐文本', () => {
  const text = 'f(a, ")(") // g(x'
  const scan = depthProfile(text)
  assert.equal(scan.depth.length, text.length + 1, 'depth 要能问到段尾那一格')
  assert.equal(scan.trivia.length, text.length)
  assert.equal(scan.depth[0], 0)
  assert.equal(scan.depth[text.indexOf('g')], 0, '注释从 // 起就不改深度；f( 的右括号在它前面已经收回来了')
  assert.equal(scan.depth[text.length], 0, '字符串与注释里那一对括号都没把深度带跑')
  assert.equal(scan.trivia[text.indexOf('a')], false, '代码里的字符算代码')
  assert.equal(scan.trivia[text.indexOf(')(', 4)], true, '字符串里面的字符不算代码结构')
})

test('列表变量的「整段」判据按括号同层算：外层逗号才算半截', () => {
  // `a, b, c` 里切出 `b, c` = 同一个列表的后半截（上游那个父节点只有一个逗号链）。
  assert.equal(listRunStartsHere('a, b, c', 3), false)
  assert.equal(listRunStartsHere('a, b, c', 0), true)
  // `f(a, g(b, c))` 里 `b, c` 是**内层**那个调用的列表：外层那个逗号与它不同层 ⇒ 起点成立。
  const nested = 'f(a, g(b, c))'
  assert.equal(listRunStartsHere(nested, nested.indexOf('b')), true, '不同层上的逗号不算"这段的开头在别处"')
  assert.equal(listRunStartsHere(nested, nested.indexOf('c')), false, '内层列表自己的后半截才该否')
  // 标识符中间不许切一刀（`\b` 那一档的加强版：`$` 不是 \w，只有这一条看得见）。
  assert.equal(listRunStartsHere('a$b, c$d', 2), false)
  // 字符串里的逗号不是分隔符，但字符串外面那一个真的逗号照样算。
  const quoted = 'f(", ", x)'
  assert.equal(listRunStartsHere(quoted, quoted.indexOf('x')), false, '引号里那一个不算，但它外面那一个真的逗号照样否')
  // 行注释里的逗号也不是分隔符（写在正则里的那条 `(?<!,\s*)` 看不见词法，这一档会把这条误否）。
  const commented = 'f(x) // a, y'
  assert.equal(listRunStartsHere(commented, commented.indexOf('y')), true, '逗号在行注释里 ⇒ 这一段不是半截')
})

test('捕获段的括号必须配平：半个调用不算收全', () => {
  assert.equal(listRunEndsHere('g(b, c', 0, 6), false, '停在半个调用里（左括号没关）')
  assert.equal(listRunEndsHere('g(b, c)', 2, 6), true, '内层那一段自己同层闭合')
  assert.equal(listRunEndsHere('a, b', 0, 4), true)
  assert.equal(listRunHolds('a, b, c', 0, 7), true)
  assert.equal(listRunHolds('a, b, c', 3, 7), false, '两条判据的合成结果：后半截还是不放过')
})

test('贪婪列表的编译产物不许带后顾断言（宿主的 std::regex 编不出，会让整条查询报 INVALID_QUERY）', () => {
  // 这一条是本次的**门禁**：实测 MSVC 的 std::regex( ECMAScript ) 认 `(?=`/`(?!`，
  // 但 `(?<=`/`(?<!` 抛 regex_error ⇒ 模板里只要写着 `$x$+`，query 发到宿主就整条报废。
  const templates = [
    '$x$+', '$x$*', '$x${2}', '$x${2,3}', '$x${0,}', 'log($Args{0,}$)',
    '$x${2} == $x$', '$x$+.$y$', '$x$+[regex(get.*) && contains(name)]',
  ]
  for (const template of templates) {
    const compiled = compileStructuralPattern(template)
    assert.ok(!('error' in compiled), `${template} 该编得动：${compiled.error ?? ''}`)
    assert.equal(/\(\?<[=!]/.test(compiled.regex), false, `${template} 的编译产物里不许有后顾断言`)
  }
  // 前顾是宿主认得的那一半，必须还在（列表"到此为止"那条断言）。
  assert.ok(/\(\?!/.test(compileStructuralPattern('$x$+').regex ?? ''), '终点那一条仍走前顾')
})

test('带一层括号的调用现在是一个列表项（上游一项就是一个表达式节点）', () => {
  const compiled = compileStructuralPattern('log($Args$+)')
  assert.ok(!('error' in compiled))
  const found = execWithSpans(compiled.regex, compiled.variables, 'log(a, g(b, c))', '')
  assert.ok(found, '宿主那条正则要在这一行配得上')
  assert.equal(found.variables.Args.text, 'a, g(b, c)')
  assert.equal(listRunVerdict(compiled, 'log(a, g(b, c))', found).ok, true, '复核也要放过这一条')
})

test('半截的列表在复核这一层被否决，并说清是哪一条', () => {
  const compiled = compileStructuralPattern('$x${2}')
  assert.ok(!('error' in compiled))
  assert.equal(needsSpanCheck(compiled, null), true, '有列表变量就得复核（不写进 needsSpanCheck 会被整层跳过）')
  assert.equal(hasListVariable(compiled), true)
  assert.equal(hasListVariable(compileStructuralPattern('$x$')), false, '普通变量不该触发复核')
  const found = execWithSpans(compiled.regex, compiled.variables, 'a, b, c', '')
  assert.ok(found, '宿主的正则确实会把 b, c 当成两项交回来')
  assert.equal(found.variables.x.text, 'b, c')
  const verdict = listRunVerdict(compiled, 'a, b, c', found)
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /后半截/)
})

test('非贪婪列表不参与「整段」复核（上游允许停在 minOccurs 再让后面的节点接走）', () => {
  const lazy = compileStructuralPattern('$x${2,3}?')
  assert.ok(!('error' in lazy))
  assert.equal(hasListVariable(lazy), false, 'greedy=false ⇒ 不复核')
  const eager = compileStructuralPattern('$x${2,3}')
  assert.equal(hasListVariable(eager), true)
})

// ── B. 代码块导航那半（等 src/editorCodeBlock.ts 那一侧接，见接线请求 W-1'）──

test('if/elif/else：光标压在 elif 上时，整条复合语句的区间从头部关键字起、到最后一个部件的块尾止', () => {
  const text = ['if a:', '    x = 1', 'elif b:', '    y = 2', 'else:', '    z = 3', 'w = 4'].join('\n')
  const statement = pythonCompoundStatement(text, caretOn(text, 'elif') + 1)
  assert.ok(statement)
  assert.equal(statement.range.from, 0, 'PSI 的 statement textRange 不含前导缩进（这里本来也没有）')
  assert.equal(statement.range.to, text.indexOf('w = 4') - 1, '块尾在 else 的块之后、下一条语句之前，不含换行')
  assert.deepEqual(pythonCompoundKeywordRanges(text, caretOn(text, 'elif') + 1).map(r => text.slice(r.from, r.to)),
    ['if', 'elif', 'else'], 'compoundStatementKeywordRanges:119-122 按文档顺序给出部件关键字')
})

test('try/except/else/finally 收进同一条链（PyControlFlowKeywordMatcher.kt:34-35 那一族）', () => {
  const text = ['try:', '    a = 1', 'except ValueError:', '    a = 2', 'else:', '    a = 3', 'finally:', '    a = 4', 'b = 5'].join('\n')
  const ranges = pythonCompoundKeywordRanges(text, caretOn(text, 'finally') + 2)
  assert.deepEqual(ranges.map(r => text.slice(r.from, r.to)), ['try', 'except', 'else', 'finally'])
  assert.equal(ranges[0].from, 0)
  const statement = pythonCompoundStatement(text, caretOn(text, 'except') + 1)
  assert.ok(statement)
  assert.equal(statement.range.to, text.indexOf('b = 5') - 1, '最后一个部件的块级也算进来')
})

test('for/while 的 else 属于循环本身，接不上的关键字另起一条语句', () => {
  const loop = ['for i in xs:', '    use(i)', 'else:', '    spare()', 'if c:', '    d()'].join('\n')
  assert.deepEqual(pythonCompoundKeywordRanges(loop, caretOn(loop, 'else') + 1).map(r => loop.slice(r.from, r.to)),
    ['for', 'else'], 'for/else（同文件 :34 的那一档）')
  const second = ['if a:', '    x = 1', 'if b:', '    y = 2'].join('\n')
  const statement = pythonCompoundStatement(second, caretOn(second, 'if', 1) + 1)
  assert.ok(statement)
  assert.equal(statement.range.from, caretOn(second, 'if', 1), '同列的第二个 if 不是第一个 if 的部件：另起一条')
  assert.deepEqual(pythonCompoundKeywordRanges(second, caretOn(second, 'if', 1) + 1).map(r => second.slice(r.from, r.to)), ['if'])
})

test('match/case：case_block 比 match 深一级，两边都能收进同一条语句', () => {
  const text = ['match point:', '    case (1, 2):', '        pass', '    case _:', '        other()', 'x = 1'].join('\n')
  assert.deepEqual(pythonCompoundKeywordRanges(text, caretOn(text, 'case', 1) + 2).map(r => text.slice(r.from, r.to)),
    ['match', 'case', 'case'], '光标在 case 上 ⇒ 往上并上 match（enclosingCompoundStatement:130-137 的那条父子边）')
  assert.deepEqual(pythonCompoundKeywordRanges(text, caretOn(text, 'match') + 3).map(r => text.slice(r.from, r.to)),
    ['match', 'case', 'case'], '光标在 match 上 ⇒ 往下收 case_block')
  const statement = pythonCompoundStatement(text, caretOn(text, 'match') + 3)
  assert.ok(statement)
  assert.equal(statement.range.to, text.indexOf('x = 1') - 1)
})

test('不是语句位置的关键字一律不算（上游 doc 注释里那句「三元 if/else、推导式 for 忽略」）', () => {
  const ternary = 'value = 1 if flag else 2'
  assert.equal(pythonCompoundStatement(ternary, caretOn(ternary, 'else') + 1), null)
  const comprehension = 'total = [n for n in ns]'
  assert.equal(pythonCompoundStatement(comprehension, caretOn(comprehension, 'for') + 1), null)
  const wrapped = ['values = (', '    1', '    for n in ns', ')'].join('\n')
  assert.equal(pythonCompoundStatement(wrapped, caretOn(wrapped, 'for') + 1), null, '未闭合括号里的续行不是逻辑行的开头')
  const body = ['if a:', '    x = 1'].join('\n')
  assert.equal(pythonCompoundStatement(body, caretOn(body, 'x') + 1), null, '光标不在关键字上 ⇒ EMPTY_RANGE 那一档')
  assert.equal(pythonCompoundStatement('else:\n    x = 1', 1), null, '没有头部的 else 不是复合语句')
})

test('光标压在词尾之后那一个字符上仍算这个词（TargetElementUtilBase.java:56-74 + findKeywordContext:88-90）', () => {
  const text = ['if a:', '    x = 1', 'else:', '    y = 2'].join('\n')
  const after = caretOn(text, 'else') + 'else'.length
  assert.equal(after, text.indexOf('else') + 4, '光标紧贴关键字之后')
  assert.ok(pythonCompoundStatement(text, after))
  assert.equal(pythonCompoundStatement(text, after + 1), null, '再往右一格就离开关键字了')
})

test('只有 Python 注册了这个 EP：其余语言返回 null（= 上游的 EMPTY_RANGE）', () => {
  const text = ['if a:', '    x = 1', 'else:', '    y = 2'].join('\n')
  const caret = caretOn(text, 'else') + 1
  assert.ok(findCodeBlockRange(text, caret, 'python'))
  assert.equal(findCodeBlockRange(text, caret, 'py')?.from, 0)
  assert.equal(findCodeBlockRange(text, caret, 'java'), null)
  assert.equal(findCodeBlockRange(text, caret, 'typescript'), null)
  assert.equal(findCodeBlockRange(text, caret, 'cpp'), null)
})

test('块尾取 min、块首取 max；某一半没有时不合并（CodeBlockUtil.java:108-120、:176-188）', () => {
  const block = { from: 10, to: 40 }
  assert.equal(mergeBlockEnd(30, block), 30, ':118 min(结构 40, 括号 30)')
  assert.equal(mergeBlockEnd(50, block), 40, ':118 min(结构 40, 括号 50)')
  assert.equal(mergeBlockEnd(null, block), 40, ':114-116 括号那半是 -1 ⇒ 用结构那半')
  assert.equal(mergeBlockEnd(30, null), 30, ':111-113 结构那半为空 ⇒ 用括号那半')
  assert.equal(mergeBlockStart(20, block), 20, ':186 max(结构 10, 括号 20)')
  assert.equal(mergeBlockStart(5, block), 10, ':186 max(结构 10, 括号 5)')
  assert.equal(mergeBlockStart(null, block), 10, ':182-184')
  assert.equal(mergeBlockStart(20, null), 20, ':179-181')
  assert.equal(mergeBlockEnd(null, null), null, '两边都没有 ⇒ 本仓的「不吞键」那一档（上游 -1）')
})

// ── C. 块边界的缺项（ss4）：物理续行 / CRLF / 文件首尾 / 空文本 / 只有注释 / 单行块 ──
// 上游的区间是 PSI 节点的 textRange（`AbstractCodeBlockSupportHandler.java:79-83` → `:81`），
// 一条语句占几条**物理**行与它无关：括号没关上、行尾反斜杠、三引号串跨行都属于同一条逻辑行
// （词法层凭证：`python/python-parser/src/com/jetbrains/python/lexer/Python.flex:73-75`
// 的 `QUOTED_LITERAL` 允许 `\\` + 换行、`:175` 把单个反斜杠切成 BACKSLASH token）。
// 所以「把物理续行另起一行」会把 if/elif/else 的部件链从中间截断 —— 下面四条钉住这一档。

test('顶格的括号续行不截断部件链：闭合括号回到第 0 列时 else 仍属于同一条 if', () => {
  const text = ['if a:', '    x = foo(', 'bar,', ')', 'else:', '    y = 2'].join('\n')
  const onElse = text.indexOf('else') + 1
  assert.deepEqual(pythonCompoundKeywordRanges(text, onElse).map(r => text.slice(r.from, r.to)), ['if', 'else'],
    '续行不许被当成「第 0 列的一条非关键字语句」把链切断')
  assert.deepEqual(findCodeBlockRange(text, onElse, 'python'), { from: 0, to: text.length })
  assert.deepEqual(findCodeBlockRange(text, 1, 'python'), { from: 0, to: text.length }, '光标压头部关键字 ⇒ 拿到的是同一条语句')
})

test('行尾反斜杠的显式续行也并进上一条逻辑行（奇数个才算；偶数那一档是本仓文本层约定）', () => {
  const joined = ['if a:', '    x = 1 \\', '+ 2', 'else:', '    y = 2'].join('\n')
  assert.deepEqual(pythonCompoundKeywordRanges(joined, 1).map(r => joined.slice(r.from, r.to)), ['if', 'else'])
  assert.deepEqual(findCodeBlockRange(joined, 1, 'python'), { from: 0, to: joined.length }, '块尾不许停在被反斜杠接走的那一行之前')
  assert.deepEqual(findCodeBlockRange(joined, joined.indexOf('else') + 1, 'python'), { from: 0, to: joined.length })
  // 偶数个反斜杠 = 转义出来的反斜杠本身，不续行：后面那条顶格的行按「上一条语句之外」处理。
  const escaped = ['if a:', '    x = 1 \\\\', '+ 2'].join('\n')
  const tail = escaped.indexOf('x = 1') + 'x = 1 \\\\'.length
  assert.equal(escaped[tail], '\n', '前提：tail 就是这一行末尾那个换行的下标')
  assert.deepEqual(findCodeBlockRange(escaped, 1, 'python'), { from: 0, to: tail },
    '无法核实：JetBrains 的解析器怎么接「两条反斜杠结尾」的物理行不在这棵社区树里（`Python.flex:175` 只给 BACKSLASH token），这里钉的是本仓奇/偶约定')
})

test('跨行三引号串：部件链完整、块尾算到闭合那一行；串里的 if 依旧不是关键字', () => {
  const text = ['if a:', '    x = """', '  text', '"""', 'else:', '    y = 1'].join('\n')
  assert.deepEqual(pythonCompoundKeywordRanges(text, text.indexOf('else') + 1).map(r => text.slice(r.from, r.to)), ['if', 'else'])
  assert.deepEqual(findCodeBlockRange(text, 1, 'python'), { from: 0, to: text.length }, '块尾要含到串闭合的那一行')
  const docstring = ['"""', 'if a:', '"""', 'x = 1'].join('\n')
  assert.equal(findCodeBlockRange(docstring, docstring.indexOf('if a:') + 1, 'python'), null,
    '整段是文档字符串的正文 ⇒ 上游取到的叶子不是关键字 token ⇒ EMPTY_RANGE')
})

test('CRLF：行尾的 \\r 不算正文，空行照样不打断链，块尾不含 \\r\\n', () => {
  const text = ['if a:', '', '    x = 1', 'else:', '    y = 2'].join('\r\n')
  assert.deepEqual(pythonCompoundKeywordRanges(text, text.indexOf('else') + 1).map(r => text.slice(r.from, r.to)),
    ['if', 'else'], '只剩 \\r 的那一行是空行，不是「第 0 列的一条语句」')
  assert.deepEqual(findCodeBlockRange(text, 1, 'python'), { from: 0, to: text.length })
  const trailing = ['if a:', '    x = 1'].join('\r\n') + '\r\n'
  assert.deepEqual(findCodeBlockRange(trailing, 1, 'python'), { from: 0, to: trailing.length - 2 },
    '上游的 textRange 到语句最后一个 token 为止：行尾换行（\\r\\n 那两个字符）都不许带进块尾')
})

test('空文本 / 光标越界 / 只有注释的文件 ⇒ null，不抛', () => {
  assert.equal(findCodeBlockRange('', 0, 'python'), null)
  assert.equal(findCodeBlockRange('', 7, 'python'), null, '空文本上光标写在长度之外（选中整个空文档再按 Ctrl+] 那种形状）')
  const text = ['if a:', '    x = 1'].join('\n')
  assert.equal(findCodeBlockRange(text, -3, 'python'), null, '负偏移不是任何一个字符')
  assert.equal(findCodeBlockRange(text, text.length + 50, 'python'), null, '超出文件尾同理')
  assert.equal(findCodeBlockRange(['# if a:', '#     x = 1'].join('\n'), 2, 'python'), null, '只有注释的文件里没有语句')
})

test('单行块与「光标正好压在块首行/块尾行的行尾」：区间只到关键字那一段算', () => {
  assert.deepEqual(findCodeBlockRange('if a: x = 1', 1, 'python'), { from: 0, to: 11 }, '一条物理行的复合语句 = 整行')
  assert.equal(findCodeBlockRange('if a: x = 1', 11, 'python'), null, '光标已经离开关键字 ⇒ EMPTY_RANGE')
  const text = ['if a:', '    x = 1'].join('\n')
  assert.equal(findCodeBlockRange(text, text.indexOf('\n'), 'python'), null, '块首行的行尾（那个换行）不是关键字叶子')
  assert.equal(findCodeBlockRange(text, text.length, 'python'), null, '块尾行的行尾同理')
  assert.deepEqual(findCodeBlockRange(text, 0, 'python'), { from: 0, to: text.length }, '文件首第 0 个字符就压在头部关键字上')
})

test('文件尾：TargetElementUtilBase.java:56-74 的 clamp 决定命中与否', () => {
  const text = ['if a:', '    x = 1', 'else'].join('\n')
  // `:60-62` offset >= 文本长度 ⇒ 先退到 len-1，`:66-71` 那一个字符是标识符字符 ⇒ 就用它 ⇒ 叶子是 `else`
  assert.deepEqual(findCodeBlockRange(text, text.length, 'python'), { from: 0, to: text.length })
  // 文件尾是换行 ⇒ clamp 到 len-1 落在换行符上，`:68-69` 不认 ⇒ 回原 offset ⇒ findElementAt(len) = null ⇒ EMPTY_RANGE
  assert.equal(findCodeBlockRange(text + '\n', text.length + 1, 'python'), null)
  assert.deepEqual(findCodeBlockRange(text + '\n', text.length, 'python'), { from: 0, to: text.length },
    '光标压在紧邻关键字的那个换行上：`:63-65` 先减一，`:67-70` 见前一个字符是标识符字符 ⇒ 取到的叶子还是 `else`')
})

test('语言档那一条只认本仓的小写 id（Python 未进 EDITOR_LANGUAGES ⇒ 落差已登记）', () => {
  const text = ['if a:', '    x = 1', 'else:', '    y = 2'].join('\n')
  assert.equal(findCodeBlockRange(text, text.indexOf('else') + 1, 'py')?.from, 0)
  for (const language of ['java', 'cpp', 'typescript', 'other', '', 'Python', 'python3']) {
    assert.equal(findCodeBlockRange(text, text.indexOf('else') + 1, language), null, `${language} ⇒ 上游没有注册 handler / 本仓 id 不认`)
  }
})

