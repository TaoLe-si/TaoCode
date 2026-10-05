// 文件模板语法引擎（`src/fileTemplateParser.ts`）：`#if`/`#elseif`/`#else`/`#end`、`#set`、
// `#parse`、`${DS}` 转义、单遍展开与两种错误的分工。
// 上游依据逐条写在断言旁：`Class.java.ft:1-6`、`FileTemplateUtil.java:102-126`、
// `VelocityWrapper.java:82-85`、`default.html:62-67`、`FileTemplateBase.java:89-99`。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FileTemplateParseError,
  TemplateNotFoundError,
  evaluateExpression,
  parseFileTemplate,
  renderFileTemplate,
  scanTemplateAttributes,
} from '../src/fileTemplateParser.ts'

const CLASS_FT = '#if (${PACKAGE_NAME} && ${PACKAGE_NAME} != "")package ${PACKAGE_NAME};\n\n#end\n#parse("File Header.java")\npublic class ${NAME} {\n}\n'

test('上游 Class.java.ft 原样渲染：推不出包名时不留空 package 行', () => {
  const withPackage = renderFileTemplate(CLASS_FT, {
    variables: { PACKAGE_NAME: 'com.acme', NAME: 'Widget' },
    resolveInclude: () => '',
  })
  assert.equal(withPackage.text, 'package com.acme;\n\npublic class Widget {\n}\n')
  const withoutPackage = renderFileTemplate(CLASS_FT, {
    variables: { PACKAGE_NAME: '', NAME: 'Widget' },
    resolveInclude: () => '',
  })
  assert.equal(withoutPackage.text, 'public class Widget {\n}\n', '空包名时 #if 为假')
  assert.deepEqual(withoutPackage.skipped, [])
})

test('#elseif / #else：只渲染第一个命中的分支', () => {
  const template = '#if (${LANG} == "java")J\n#elseif (${LANG} == "kt")K\n#elseif (${LANG} == "ts")T\n#else\nX\n#end\n'
  assert.equal(renderFileTemplate(template, { variables: { LANG: 'kt' } }).text, 'K\n')
  assert.equal(renderFileTemplate(template, { variables: { LANG: 'ts' } }).text, 'T\n')
  assert.equal(renderFileTemplate(template, { variables: { LANG: 'go' } }).text, 'X\n')
})

test('同一行的指令与正文：#if 后的文本进 body（Class.java.ft:1 的写法）', () => {
  assert.equal(renderFileTemplate('#if (${A} != "")yes ${A}\n#end\n', { variables: { A: 'v' } }).text, 'yes v\n')
  assert.equal(renderFileTemplate('#if (${A} != "")yes ${A}\n#end\n', { variables: {} }).text, '')
})

test('${DS}：单遍转义，${DS}NAME 输出字面量 $NAME 而不是再展开一次', () => {
  const result = renderFileTemplate('cost: ${DS}${NAME}\n', { variables: { NAME: 'Widget' } })
  assert.equal(result.text, 'cost: $Widget\n', 'default.html:62-67：DS 让 $ 不再是变量前缀')
  assert.deepEqual(result.unset, [], 'DS 自己不算未赋值变量')
})

test('裸 $NAME 也认；$1 / $(x) / 行尾 $ 不算引用', () => {
  assert.equal(renderFileTemplate('class $NAME {}', { variables: { NAME: 'W' } }).text, 'class W {}')
  assert.equal(renderFileTemplate('a$1b', { variables: {} }).text, 'a$1b')
  assert.equal(renderFileTemplate('a$(b)c', { variables: {} }).text, 'a$(b)c')
  assert.equal(renderFileTemplate('a$ b', { variables: {} }).text, 'a$ b')
})

test('#set 定义变量并被后面的 ${VAR} 取用（FileTemplateUtil.java:102-108）', () => {
  const result = renderFileTemplate('#set($TITLE = "Widget")\nclass ${TITLE} {}\n', { variables: {} })
  assert.equal(result.text, 'class Widget {}\n')
  assert.deepEqual(result.unset, [], '#set 定义的变量不算未赋值')
})

test('#parse 递归展开子模板，成环的目标跳过（FileTemplateUtil.java:120 的 visitedIncludes）', () => {
  const includes = { 'File Header.java': '// header\n' }
  const result = renderFileTemplate('#parse("File Header.java")\nbody\n', {
    variables: {},
    resolveInclude: name => includes[name],
  })
  assert.equal(result.text, '// header\nbody\n')
  const looping = { 'A.ft': 'a\n#parse("B.ft")\n', 'B.ft': 'b\n#parse("A.ft")\n' }
  const cycle = renderFileTemplate('#parse("A.ft")\n', { variables: {}, resolveInclude: name => looping[name] })
  assert.equal(cycle.text, 'a\nb\n', 'B 再引 A 时 A 已在访问集里，跳过')
  assert.deepEqual(cycle.skipped, ['A.ft'])
})

test('#parse 目标缺失抛 ResourceNotFound 的消息（VelocityWrapper.java:84）', () => {
  assert.throws(
    () => renderFileTemplate('#parse("Missing.java")\n', { variables: {}, resolveInclude: () => undefined }),
    error => error instanceof TemplateNotFoundError && error.message === 'Template not found: Missing.java' && error.template === 'Missing.java',
  )
})

test('语法错抛 FileTemplateParseError 并带行号（FileTemplateBase.java:96-97）', () => {
  const cases = [
    ['#if (${A} != "")\nno end\n', 1, '没有配对的 #end'],
    ['ok\n#end\n', 2, '没有对应的 #if'],
    ['#if\n#endif\n', 1, '缺少括号参数'],
    ['#if (${A}\n#endif\n', 1, '括号没有闭合'],
    ['#if ()x\n#end\n', 1, '条件不能为空'],
    ['#parse(Foo.java)\n', 1, '必须是引号里的模板名'],
    ['#set($A)\n', 1, '需要写成'],
    ['#set($A = )\n', 1, '值不能为空'],
  ]
  for (const [source, line, fragment] of cases) {
    assert.throws(
      () => renderFileTemplate(source, { variables: {} }),
      error => {
        assert.ok(error instanceof FileTemplateParseError, `${source} 应抛 FileTemplateParseError，实际 ${error.name}`)
        assert.equal(error.line, line, `${source} 的行号`)
        assert.match(error.message, new RegExp(fragment))
        return true
      },
    )
  }
})

test('行首之外的 # 只是文本：#!/bin/sh、#region、C# 预处理指令都不当指令', () => {
  const shell = '#!/bin/sh\n#region not-a-directive\necho hello\n'
  assert.equal(renderFileTemplate(shell, { variables: {} }).text, shell)
  const inline = 'value = a #set(1) b\n'
  assert.equal(renderFileTemplate(inline, { variables: {} }).text, inline, '非行首的指令名不解析')
  const prefixed = 'x\n  #end\n'
  assert.throws(() => renderFileTemplate(prefixed, { variables: {} }), FileTemplateParseError, '允许前导空白时仍算行首')
})

test('#ifx 不是 #if（整行都当普通文本）', () => {
  const source = '#ifx (1 != 2)\ntext\n'
  assert.equal(renderFileTemplate(source, { variables: {} }).text, source)
})

test('未赋值变量进 unset、上游据此弹取值对话框（FileTemplateBase.java:89-99）', () => {
  // `${DS}PATH` 输出字面量 `$PATH`：DS 之后的文本本轮不再被扫成变量引用（单遍）。
  const result = renderFileTemplate('${MY_CUSTOM_FUNCTION_NAME} / ${NAME} / ${DS}PATH\n', { variables: { NAME: 'W' } })
  assert.equal(result.text, ' / W / $PATH\n', '未赋值变量展开成空串，两侧的空格是正文的一部分')
  assert.deepEqual(result.unset, ['MY_CUSTOM_FUNCTION_NAME'])
})

test('表达式求值：比较、真假、数字与括号', () => {
  assert.equal(evaluateExpression('${A} != ""', { A: 'x' }).value, true)
  assert.equal(evaluateExpression('${A} != ""', { A: '' }).value, false)
  assert.equal(evaluateExpression('${A} && ${B}', { A: '1', B: '2' }).value, true)
  assert.equal(evaluateExpression('${A} || ${B}', { A: '', B: '' }).value, false)
  assert.equal(evaluateExpression('!${A}', { A: '' }).value, true)
  assert.equal(evaluateExpression('(${A} == "x") || (${B} == "y")', { A: 'q', B: 'y' }).value, true)
  assert.equal(evaluateExpression('2 > 1', {}).value, true, '纯数字按数值比')
  assert.equal(evaluateExpression('false', {}).value, false)
})

test('属性扫描：引用/定义/子模板三张表（FileTemplateUtil.collectAttributes）', () => {
  const scan = scanTemplateAttributes(CLASS_FT, name => (name === 'File Header.java' ? '// ${HEADER}!\n' : undefined))
  assert.deepEqual(scan.includes, ['File Header.java'])
  assert.ok(scan.referenced.includes('PACKAGE_NAME'))
  assert.ok(scan.referenced.includes('NAME'))
  assert.ok(scan.referenced.includes('HEADER'), '子模板里的变量也算数（collectAttributes 会跟进 #parse）')
  const withSet = scanTemplateAttributes('#set($T = "x")\n${T}\n', undefined)
  assert.deepEqual(withSet.defined, ['T'])
  assert.deepEqual(withSet.referenced, [], '自己 #set 的变量不算待填')
})

test('节点树结构：#if 落成分支数组，#else 的 condition 为 null', () => {
  const nodes = parseFileTemplate('#if (${A} != "")one\n#else\ntwo\n#end\n')
  assert.equal(nodes[0].kind, 'if')
  const conditional = nodes[0]
  assert.equal(conditional.kind === 'if' ? conditional.branches.length : -1, 2)
  assert.equal(conditional.kind === 'if' ? conditional.branches[1].condition : 'x', null)
  assert.equal(conditional.kind === 'if' ? conditional.branches[0].body[0].text : '', 'one\n')
})
