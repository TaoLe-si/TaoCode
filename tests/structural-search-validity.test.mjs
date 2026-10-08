// 结构化模板**合法性（词法级）**的判据（`src/structuralSearchValidity.ts`，2026-10-08 lane pf-actions）。
//
// 上游那一半是 `PatternCompiler` 把模板当代码解析（`PatternCompiler.java:75-81` 声明
// `throws MalformedPatternException`；`:555-564` 解析不出东西就抛）；本仓没有 PSI，
// 所以只还原**词法**那一半 —— 上游同样报错的那些形状（`StringToConstraintsTransformer.java:290-292`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ref } from 'vue'

import { checkTemplateValidity } from '../src/structuralSearchValidity.ts'
import { BUILTIN_STRUCTURAL_TEMPLATES } from '../src/structuralSearchConfigs.ts'
import { createStructuralSearchModel } from '../src/structuralSearchPanelModel.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'

const why = (template, part) => {
  const verdict = checkTemplateValidity(template)
  assert.equal(verdict.ok, false, `\`${template}\` 应当判不合法`)
  assert.ok(verdict.error.includes(part), `错误文案里要有「${part}」，实际是「${verdict.error}」`)
  return verdict
}

test('合法模板放行：内建模板全集 + 常见形状', () => {
  for (const builtin of BUILTIN_STRUCTURAL_TEMPLATES) {
    assert.equal(checkTemplateValidity(builtin.query).ok, true, `内建模板 \`${builtin.query}\` 不该被误判`)
  }
  for (const template of ['if ($x$) { $y$; }', 'a[0] = { b: 1 }', 'foo("(")', "'(' + $x$", '// )', '/* ( */ $x$']) {
    assert.equal(checkTemplateValidity(template).ok, true, `\`${template}\` 应当合法（括号在字符串/注释里不算结构）`)
  }
})

test('括号：漏闭合、多闭合、交叉嵌套三种都报，且带定位', () => {
  assert.equal(why('foo(', '没有闭合').offset, 3, '定位到那个没闭合的 `(`')
  assert.equal(why('foo)', '没有配对').offset, 3, '定位到多出来的 `)`')
  assert.equal(why('if (a]', '不配对').offset, 5, '定位到串味的那一个')
  assert.equal(why('[1, 2', '没有闭合').offset, 0)
})

test('字符串与块注释必须闭合（上游 error.expected.value 那一档）', () => {
  assert.equal(why('log("abc)', '字符串').offset, 4, '定位到那个没闭合的引号')
  assert.equal(why("log('abc)", '字符串').offset, 4)
  assert.equal(why('/* foo', '块注释').offset, 0)
  // 行注释到行尾就结束，不是"没闭合"。
  assert.equal(checkTemplateValidity('// foo\nbar()').ok, true)
})

test('变量本体与约束后缀不算模板代码：`$x$[regex(…)]` 里的括号不参与配对', () => {
  for (const template of ['$x$[regex(\\d+)]', '$x${2,3}', '$x$[contains($y$)]', '$x$+', '$x$[regex(])]']) {
    assert.equal(checkTemplateValidity(template).ok, true, `\`${template}\` 的括号是约束自己的语法，不该被判成模板括号`)
  }
  // 但 `$…$` 之外的字面括号照判。
  assert.equal(checkTemplateValidity('$x$[regex(\\d+)](').ok, false)
})

test('接线：面板模型的 error 第一道就是它，不合法模板拿不到编译产物', () => {
  const model = template => createStructuralSearchModel({
    enabled: ref(true), template: ref(template), replacement: ref(''),
    caseSensitive: ref(true), wholeWord: ref(false), definitions: ref([]), regexMode: ref(false),
  })
  const broken = model('foo(')
  assert.match(broken.error.value, /没有闭合/, '面板要把词法不合法报出来')
  assert.equal(broken.compiled.value, null, '不合法时不许给出编译产物（两边同一口径）')
  assert.equal(model('foo($x$)').error.value, '', '合法模板不受影响')
  assert.match(read('src/structuralSearchPanelModel.ts'), /checkTemplateValidity\(input\.template\.value\)/,
    'compileTemplate 的第一道要真的是合法性检查')
})

test('上游出处行真实存在（参考树在时核；不在则跳过）', () => {
  const compiler = `${REF}/platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/PatternCompiler.java`
  const lexer = `${REF}/platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java`
  if (!existsSync(compiler) || !existsSync(lexer)) return
  const compilerText = readFileSync(compiler, 'utf8')
  assert.ok(compilerText.includes('throws MalformedPatternException'), '编译器不再抛这个异常了')
  assert.ok(/patternElements\.length == 0 && checkForErrors\) throw new MalformedPatternException/.test(compilerText),
    '空解析结果的抛出点（:561）不在了')
  const lexerText = readFileSync(lexer, 'utf8')
  assert.ok(lexerText.includes('error.expected.value'), '条件值未闭合那两条错误（:290-291）不在了')
  assert.ok(lexerText.includes('error.expected.character'), '`:63` 的"缺名字"错误不在了')
})
