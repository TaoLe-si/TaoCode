// `QuoteHandler` 的**逐语言开关**与两条「不补配对」门槛（`lp/editor-actions` 重点②）。
//
// 上游依据（2026-10-06 逐行打开核对）：
//   · 三级取 handler：`platform/lang-impl/src/com/intellij/codeInsight/editorActions/TypedQuoteImpl.java:31-44`。
//   · 触发字符写死三个：同文件 `:52`。
//   · 开关：同文件 `:66-68`（`AUTOINSERT_PAIR_QUOTE`，默认值
//     `platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java:140`）。
//   · 「跳过收尾引号」在前：同文件 `:80-85`。
//   · javaLike 的 token 门槛：同文件 `:89-97` +
//     `java/java-frontback-impl/src/com/intellij/codeInsight/editorActions/JavaQuoteHandler.java:33-36`。
//   · 「光标后面是标识符字符就不补」：同文件 `:104-105`（多字符支）与 `:117-118`（普通支）。
//   · `isClosingQuote`/`isOpeningQuote`/`hasNonClosedLiteral`/`isInsideLiteral` 四个问法：
//     `platform/lang-impl/src/com/intellij/codeInsight/editorActions/QuoteHandler.java:40/49/64/66`。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  QUOTE_HANDLER_REGISTRATIONS, QUOTE_TRIGGER_CHARS, appropriateElementForLiteral,
  isJavaLikeQuoteLanguage, nextCharBlocksPair, pairInsertionSuppressed, quoteRegistrationForLanguage,
} from '../src/quoteHandlerRegistry.ts'
import { LANGUAGE_QUOTES, quoteAction, quotesFor } from '../src/editorTyping.ts'

test('触发字符是写死的三个，不按语言变（TypedQuoteImpl.java:52）', () => {
  assert.deepEqual([...QUOTE_TRIGGER_CHARS], ['"', "'", '`'])
})

test('逐语言注册表：只有 Java 是 javaLike，且它是本仓唯一能对上语言档的 javaLike 语言', () => {
  assert.deepEqual(QUOTE_HANDLER_REGISTRATIONS.filter(item => item.javaLike).map(item => item.key), ['JAVA'])
  // 全树实现 `MultiCharQuoteHandler` 的只有 Java / JSON / Groovy 三类
  // （`java/java-frontback-impl/src/com/intellij/codeInsight/editorActions/JavaQuoteHandler.java:31`、
  //  `json/src/com/intellij/json/JsonQuoteHandler.java:20`、
  //  `plugins/groovy/src/org/jetbrains/plugins/groovy/editor/GroovyQuoteHandler.java:15`）
  // ⇒ 表里 multiChar 为真的那几条必须正好是这三个类的注册。
  assert.deepEqual(QUOTE_HANDLER_REGISTRATIONS.filter(item => item.multiChar).map(item => item.className).sort(), [
    'com.intellij.codeInsight.editorActions.JavaQuoteHandler',
    'com.intellij.json.JsonQuoteHandler',
    'com.intellij.json.JsonQuoteHandler',
    'com.intellij.json.JsonQuoteHandler',
    'org.jetbrains.plugins.groovy.editor.GroovyQuoteHandler',
  ].sort())
  assert.equal(isJavaLikeQuoteLanguage('java'), true)
  assert.equal(isJavaLikeQuoteLanguage('cpp'), false, 'C++ 在这棵树里没有引号 handler ⇒ 不是 javaLike')
  assert.equal(isJavaLikeQuoteLanguage(undefined), false, '宿主没给语言档 ⇒ 按最保守的一档走（只有通用门槛）')
  // 表里的注册行号必须指得到真文件（这条同时是「别编注册表」的防线）。
  for (const item of QUOTE_HANDLER_REGISTRATIONS) {
    assert.match(item.registration, /\.xml:\d+$/, `${item.key} 的注册行要写成 文件:行号`)
    assert.match(item.className, /QuoteHandler$/, `${item.key} 的实现类名要以 QuoteHandler 结尾`)
    assert.ok(item.via === 'fileType' || item.via === 'language', `${item.key} 挂在两条 EP 之一上`)
  }
  assert.equal(QUOTE_HANDLER_REGISTRATIONS.length, 20, '全树搜 quoteHandler 得到 20 条注册（EP 声明与 :458 那条不算）')
  // 按 fileType 与按 language 两条 EP 各有注册；纯文本那条走的是 language 那一支。
  assert.equal(quoteRegistrationForLanguage('other')?.key, 'TEXT')
  assert.equal(quoteRegistrationForLanguage('other')?.javaLike, false,
    '纯文本里回车不切字符串（enter/EnterInStringLiteralHandler.java:39-42 的 instanceof 门槛）')
  assert.equal(quoteRegistrationForLanguage('typescript'), null,
    'TS/JS 的引号 handler 在商业插件里，这棵树核不到 ⇒ 不编')
})

test('门槛 (a)：敲完之后那个字符是标识符字符 ⇒ 不补配对（:104-105 / :117-118）', () => {
  assert.equal(nextCharBlocksPair('abc', 3), false, '文档末尾 ⇒ 不挡')
  assert.equal(nextCharBlocksPair('abcdef', 3), true, '后面紧跟字母 ⇒ 挡')
  assert.equal(nextCharBlocksPair('a1', 1), true, '数字也是 isUnicodeIdentifierPart')
  assert.equal(nextCharBlocksPair('a_ ', 1), true, '下划线是 Pc，也算标识符字符')
  assert.equal(nextCharBlocksPair('a b', 1), false, '空格不算')
  assert.equal(nextCharBlocksPair('a+b', 1), false, '运算符不是 identifier part（挡它的是门槛 (b)）')
})

test('门槛 (b)：javaLike 才问，光标**那一格**不是那张表里的 token 就不接管（:89-97 + JavaQuoteHandler.java:33-36）', () => {
  assert.equal(appropriateElementForLiteral('foo', 0, false), true, '非 javaLike 的语言不问这一条')
  assert.equal(appropriateElementForLiteral('', 0, true), true, '行尾')
  assert.equal(appropriateElementForLiteral('   ', 0, true), true, '压在空白上 = 空白 token')
  assert.equal(appropriateElementForLiteral(' + c', 1, true), false, '运算符不在那张表里（空白放过、加号不放过）')
  for (const char of [';', ',', ')', ']', '}']) {
    assert.equal(appropriateElementForLiteral(`${char} rest`, 0, true), true, `${char} 在那张表里`)
  }
  assert.equal(appropriateElementForLiteral('"x"', 0, true), true, '后面就是字面量')
  assert.equal(appropriateElementForLiteral('// note', 0, true), true, '后面是行注释')
  assert.equal(appropriateElementForLiteral('/* note', 0, true), true, '后面是块注释开头')
  assert.equal(appropriateElementForLiteral('foo', 0, true), false, '标识符不在那张表里')
  assert.equal(appropriateElementForLiteral('(x)', 0, true), false, '左括号也不在（那张表只收右括号）')
  assert.equal(appropriateElementForLiteral('x = 1', 4, true), false, '数字也不算 identifier 之外的那几档')
})

test('两条门槛合起来：pairInsertionSuppressed（坐标口径 = 敲之前的行内光标）', () => {
  // 在 `abc|def` 中间敲引号：敲完之后光标后面是 `d` ⇒ (a) 挡。
  assert.equal(pairInsertionSuppressed('abcdef', 3, false), true)
  // 行尾敲引号：两条都不挡 ⇒ 补。
  assert.equal(pairInsertionSuppressed('String s = ', 11, true), false)
  // ` + c` 里在加号前面敲引号：(a) 不挡（加号不是标识符字符），(b) 挡（加号不在那张表里）。
  assert.equal(pairInsertionSuppressed(' + c', 1, false), false, '非 javaLike 的语言不问 (b)')
  assert.equal(pairInsertionSuppressed(' + c', 1, true), true, 'javaLike 才问 (b)')
  // 光标压在 `(` 上、后面紧跟标识符：(b) 先挡。
  assert.equal(pairInsertionSuppressed('foo(x', 3, true), true)
  // 光标压在空白上、后面才是标识符：(b) 放过（空白 token），(a) 也放过（那一格是空格）⇒ 补。
  assert.equal(pairInsertionSuppressed('foo) x', 4, true), false)
})

test('接进了引号链路：quoteAction 的 pair 那一档现在会被供应商（java 的 abc|def）', () => {
  const java = LANGUAGE_QUOTES.java
  // 既有三条不变（行尾补一对、正对收尾只挪光标、文本块边界 plain）。
  assert.equal(quoteAction('String s = ', 11, '"', java, false, 'java'), 'pair')
  assert.equal(quoteAction('String s = "abc"', 15, '"', java, false, 'java'), 'skip')
  assert.equal(quoteAction('String s = """', 13, '"', java, false, 'java'), 'plain')
  // 新增：把光标放在一个标识符中间 ⇒ 上游不补，本仓以前补。
  assert.equal(quoteAction('abcd', 2, '"', java, false, 'java'), 'plain',
    'TypedQuoteImpl.java:117-118：敲完之后光标后面是标识符字符 ⇒ 不补配对')
  // 正对着收尾引号那一档在两条门槛**之前**问（`:80-85`），所以门槛挡不住「跳过收尾引号」。
  assert.equal(quoteAction('"abc"', 4, '"', java, false, 'java'), 'skip')
  // 不传语言档 ⇒ (b) 不问，只剩通用门槛 (a)。
  assert.equal(quoteAction(' + c', 1, '"', java, false), 'pair', '没有语言档 ⇒ (b) 那一条不问（`:89` 的 instanceof）')
  assert.equal(quoteAction(' + c', 1, '"', java, false, 'java'), 'plain', 'java ⇒ (b) 问，`+` 不在那张表里')
})

test('表里给了语言档的注册，本仓的引号规则表才允许有这门语言（防「表外语言自己编规则」）', () => {
  for (const language of Object.keys(LANGUAGE_QUOTES)) {
    const item = quoteRegistrationForLanguage(language)
    assert.ok(item, `LANGUAGE_QUOTES 里有 ${language}，但逐语言注册表里没有它的档案 ⇒ 要么补档案要么删规则`)
    assert.equal(quotesFor(language) !== null, true)
    // 规则里给的 concat 只能出现在 javaLike 的那门语言上（EnterInStringLiteralHandler.java:39-42 同源）。
    if (LANGUAGE_QUOTES[language].concat !== undefined) {
      assert.equal(item.javaLike, true, `${language} 不是 JavaLike ⇒ 不该有连接符`)
    }
  }
})
