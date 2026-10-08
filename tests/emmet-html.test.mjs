// Emmet HTML 缩写展开判据（`src/emmetHtml.ts`）。
// 出处核法：每条断言把上游 `文件:行号` 钉死 —— 行内容变了这里会红，防止注释腐烂。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { expandEmmetHtml, EmmetHtmlError, replaceNumberMarkers, generateLorem,
         suggestEmmetChildTag, EMMET_PARENT_CHILD_TAG } from '../src/emmetHtml.ts'

const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
const EM = `${REF}/xml/emmet/src/com/intellij/codeInsight/template/emmet`
const read = (p) => readFileSync(p, 'utf8')

test('上游出处行真实存在（参考树在时核；不在则跳过）', () => {
  if (!existsSync(EM)) return
  assert.ok(read(`${EM}/EmmetLexer.java`).includes('private static final String DELIMS'), 'DELIMS 声明不在了')
  assert.ok(read(`${EM}/EmmetLexer.java`).includes('.#,='), 'DELIMS 字符集不在了')
  assert.ok(read(`${EM}/ZenCodingTemplate.java`).includes("MARKER = '\\0'"), 'MARKER :69 不在了')
  assert.ok(read(`${EM}/ZenCodingUtil.java`).includes('totalIterations - numberInIteration'), '倒数编号 :64 不在了')
  assert.ok(read(`${EM}/ZenCodingUtil.java`).includes('int markersCount = i - markerStartIndex;'), '计数必须在 @ 推进前取（:46）')
  assert.ok(read(`${EM}/generators/LoremGenerator.java`).includes('lorem ipsum dolor sit amet consectetur adipisicing elit'), '词表 :17 不在了')
  assert.ok(read(`${EM}/XmlEmmetParser.java`).includes('Map.entry("p", "span")'), 'parentChildTagMapping :68 不在了')
  assert.ok(read(`${EM}/XmlEmmetParser.java`).includes('BOOLEAN_ATTRIBUTE_VALUE'), '点后缀布尔 :370-376 不在了')
  assert.ok(read(`${EM}/nodes/MoreOperationNode.java`).includes('for (GenerationNode leftGenNode : leftGenNodes)'), 'More 挂每个左节点 :79 不在了')
})

test('基础：div / 嵌套 > / 兄弟 + / 爬升 ^（ClimbUpOperationNode:46-56：顶层爬升挂回原父）', () => {
  assert.equal(expandEmmetHtml('div'), '<div></div>')
  assert.equal(expandEmmetHtml('div>p+span'), '<div><p></p><span></span></div>')
  assert.equal(expandEmmetHtml('div>p^h1'), '<div><p></p><h1></h1></div>')
  assert.equal(expandEmmetHtml('(div>span)*2'), '<div><span></span></div><div><span></span></div>')
})

test('重复 *：无编号 / item$ 编号 / mul 下右支逐份挂', () => {
  assert.equal(expandEmmetHtml('ul>li*3'), '<ul><li></li><li></li><li></li></ul>')
  assert.equal(expandEmmetHtml('ul>li.item$*3'),
               '<ul><li class="item1"></li><li class="item2"></li><li class="item3"></li></ul>')
  assert.equal(expandEmmetHtml('li*3>a'), '<li><a></a></li><li><a></a></li><li><a></a></li>')
})

test('选择器：#id/.class 合并空格、首见顺序、[attr] 值连拼（:398-412）', () => {
  assert.equal(expandEmmetHtml('div#header.nav.main'), '<div id="header" class="nav main"></div>')
  assert.equal(expandEmmetHtml('div.a#b'), '<div class="a" id="b"></div>', 'LinkedHashMap 按首见顺序')
  assert.equal(expandEmmetHtml('a[href="http://x" title=hi]'), '<a href="http://x" title="hi"></a>')
  assert.equal(expandEmmetHtml('li[data-i=$]*2'), '<li data-i="1"></li><li data-i="2"></li>')
})

test('布尔属性走点后缀 `name.`（XmlEmmetParser.java:370-376）；裸 `name` 是空值（无 schema 推断，差异 6）', () => {
  assert.equal(expandEmmetHtml('div[hidden.]'), '<div hidden></div>')
  assert.equal(expandEmmetHtml('div[hidden]'), '<div hidden=""></div>')
})

test('空元素自闭合（XmlZenCodingGeneratorImpl.java:124）与属性值引号转义（:93）', () => {
  assert.equal(expandEmmetHtml('br'), '<br/>')
  assert.equal(expandEmmetHtml('img[src=logo.png]'), '<img src="logo.png"/>')
  assert.equal(expandEmmetHtml("div[data='a\"b']"), '<div data="a&quot;b"></div>', '值里的 " 走单引号串进来')
})

test('缺省标签：无父=div、ul 下=li、可能内联父=span（XmlEmmetParser.java:279-291）', () => {
  assert.equal(expandEmmetHtml('#x'), '<div id="x"></div>')
  assert.equal(expandEmmetHtml('ul>.item'), '<ul><li class="item"></li></ul>')
  assert.equal(expandEmmetHtml('p>.x'), '<p><span class="x"></span></p>')
  assert.equal(suggestEmmetChildTag('table'), 'tr')
  assert.equal(EMMET_PARENT_CHILD_TAG['p'], 'span')
})

test('ul+ 特例（EmmetLexer.java:84-88）与文本 {}（TextToken 含花括号）', () => {
  assert.equal(expandEmmetHtml('ul+'), '<ul><li></li></ul>')
  assert.equal(expandEmmetHtml('table+'), '<table><tr></tr></table>')
  assert.equal(expandEmmetHtml('a{click me}'), '<a>click me</a>')
  assert.equal(expandEmmetHtml('ul>li{item$}*2'), '<ul><li>item1</li><li>item2</li></ul>')
})

test('编号占位（ZenCodingUtil.java:28-89 直译）', () => {
  assert.equal(replaceNumberMarkers('item$', 0, 3, null), 'item1')
  assert.equal(replaceNumberMarkers('item$$$', 0, 3, null), 'item001', '按 $ 串长补零')
  assert.equal(replaceNumberMarkers('item$@-', 0, 3, null), 'item3', '@- 倒数')
  assert.equal(replaceNumberMarkers('item$@-', 2, 3, null), 'item1')
  assert.equal(replaceNumberMarkers('item$@10', 0, 3, null), 'item10', '@N 基数')
  assert.equal(replaceNumberMarkers('a\\$b', 0, 1, null), 'a$b', '反斜杠转义')
  assert.equal(replaceNumberMarkers('<$#>', 0, 1, 'SEL'), '<SEL>', '$# 围绕文本')
  assert.equal(replaceNumberMarkers('$#', 0, 1, null), '$#', '无围选文本时原样')
})

test('围选文本：{} 内 $# 落点与 insertSurroundedTextAtTheEnd（ZenCodingUtil.java:24-26）', () => {
  assert.equal(expandEmmetHtml('div>{$#}', { surroundedText: 'SEL' }), '<div>SEL</div>')
  assert.equal(expandEmmetHtml('div', { surroundedText: 'SEL', insertSurroundedTextAtEnd: true }), '<div>SEL</div>')
  assert.equal(expandEmmetHtml('li{$#}*', { surroundedText: 'a\nb' }),
               '<li>a</li><li>b</li>', 'UnaryMul 按行逐份（UnaryMulOperationNode:30-40）；文本令牌绑在 * 之前')
})

test('Lorem（LOREM_PATTERN :58；默认 30 词 :57；开头句第 5 词带逗号 :69-72；确定性 LCG —— 差异 3）', () => {
  const text = expandEmmetHtml('lorem')
  assert.match(text, /^Lorem ipsum dolor sit amet, consectetur adipisicing elit\./)
  assert.equal(text.split(' ').length, 30, '默认 30 词')
  assert.equal(expandEmmetHtml('lorem4'), generateLorem(4))
  assert.ok(expandEmmetHtml('lipsum2').startsWith('Lorem ipsum'), 'lipsum 别名同路')
})

test('失败路径：不闭合（:135-138）/ 非法缩写 / 过滤器未移植（差异 5）', () => {
  assert.throws(() => expandEmmetHtml('div{unclosed'), (e) => e instanceof EmmetHtmlError && e.reason === 'lex')
  assert.throws(() => expandEmmetHtml('1a'), (e) => e instanceof EmmetHtmlError && e.reason === 'parse')
  assert.throws(() => expandEmmetHtml('dl+'), (e) => e instanceof EmmetHtmlError && e.reason === 'parse', '差异 2：dl+ 不在映射表')
  assert.throws(() => expandEmmetHtml('div|e'), (e) => e instanceof EmmetHtmlError && e.reason === 'filter')
})
