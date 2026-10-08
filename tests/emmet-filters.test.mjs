// Emmet 六过滤器（`src/emmetFilters.ts`）判据。
// 出处核法：每条断言把上游 `文件:行号` 钉死 —— 行内容变了这里会红，防止注释腐烂。
// 上游用例（BemEmmetFilterTest / CommentZenCodingFilterTest / EscapeZenCodingFilterTest /
// SingleLineEmmetFilterTest / TrimZenCodingFilterTest / XslZenCodingFilterTest）里能纯文本化的期望值，
// 这里按同形输入重放；上游靠 PSI/展开器的那半另注。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { escapeEmmetFilterText, singleLineEmmetFilterText, commentEmmetFilterText, trimEmmetFilterText,
         trimLineMarkers, xslEmmetFilterText, bemEmmetFilterText, bemFilterClassValue,
         EMMET_BEM_SEPARATORS } from '../src/emmetFilters.ts'

const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
const EM = `${REF}/xml/emmet/src/com/intellij/codeInsight/template/emmet`
const FLT = `${EM}/filters`
const read = (p) => readFileSync(p, 'utf8')

test('上游出处行真实存在（参考树在时核；不在则跳过）', () => {
  if (!existsSync(FLT)) return
  const base = read(`${FLT}/ZenCodingFilter.java`)
  assert.ok(base.includes('public @NotNull String filterText(@NotNull String text, @NotNull TemplateToken token) {'),
            'filterText 默认原样 :17 不在了')
  assert.ok(base.includes('public @NotNull GenerationNode filterNode(@NotNull GenerationNode node) {'),
            'filterNode 默认原样 :21 不在了')
  assert.ok(base.includes('return isSystem() || EmmetOptions.getInstance().isFilterEnabledByDefault(getSuffix());'),
            'isAppliedByDefault :30 不在了')
  assert.ok(base.includes('public boolean isSystem() {'), 'isSystem :36 不在了')

  const bem = read(`${FLT}/BemEmmetFilter.java`)
  assert.ok(bem.includes('private static final Pattern BLOCK_NAME_PATTERN = Pattern.compile("^[A-z]-");'),
            'BLOCK_NAME_PATTERN :32 不在了（[A-z] 是上游原样写法）')
  assert.ok(bem.includes('while (donor.getParent() != null && depth > 0) {'), '爬祖先 :160 不在了')
  assert.ok(bem.includes('while (!separator.isEmpty() && name.startsWith(separator)) {'), 'getCleanStringAndDepth :187 不在了')
  assert.ok(bem.includes('attributes.put(classAttributeName, StringUtil.join(newClassNames, " "));'),
            'class 回写 :67 不在了')
  assert.ok(bem.includes('if (shortElementPrefix.isEmpty() || !className.startsWith(shortElementPrefix)) {'),
            '短前缀早退 :212 不在了')
  assert.ok(bem.includes('String elementSeparator = emmetOptions.getBemElementSeparator();'), '读分隔符 :56 不在了')

  const comment = read(`${FLT}/CommentZenCodingFilter.java`)
  assert.ok(comment.includes('return "%s\\n<!-- /%s -->";'), '注释格式 :41 不在了')
  assert.ok(comment.includes('if (!Strings.isEmpty(classAttr) || !Strings.isEmpty(idAttr)) {'), 'class/id 皆空短路 :32 不在了')
  assert.ok(comment.includes("builder.append('#').append(idAttr);"), '#id 在前 :18 不在了')
  assert.ok(comment.includes("builder.append('.').append(classAttr);"), '.class 在后 :21 不在了')

  const escape = read(`${FLT}/EscapeZenCodingFilter.java`)
  assert.ok(escape.includes('s = s.replace("&", "&amp;");'), '先替 & :13 不在了')
  assert.ok(escape.includes('s = s.replace("<", "&lt;");'), '再替 < :14 不在了')
  assert.ok(escape.includes('s = s.replace(">", "&gt;");'), '最后替 > :15 不在了')

  const single = read(`${FLT}/SingleLineEmmetFilter.java`)
  assert.ok(single.includes('return StringUtil.replace(text, "\\n", "");'), '删换行 :21 不在了')
  assert.ok(single.includes('template.setToReformat(false);'), 'setToReformat :28 不在了')

  const trim = read(`${FLT}/TrimZenCodingFilter.java`)
  assert.ok(trim.includes('private static final Pattern PATTERN = Pattern.compile("^(['), 'PATTERN :18 不在了')
  assert.ok(trim.includes('if (matcher.matches()) {'), '值文本整串匹配 :45 不在了')
  assert.ok(trim.includes('tagValue.setText(matcher.replaceAll(""));'), '清空值文本 :46 不在了')
  assert.ok(trim.includes('return PATTERN.matcher(token.getTemplateText()).replaceAll("");'),
            '无标签半边 :55 不在了')
  assert.ok(trim.includes('node.setSurroundedText(PATTERN.matcher(surroundedText).replaceAll(""));'),
            'surroundedText 半边 :68 不在了')

  const xsl = read(`${FLT}/XslZenCodingFilter.java`)
  assert.ok(xsl.includes('private static final @NonNls String SELECT_ATTR_NAME = "select";'), 'SELECT_ATTR_NAME :17 不在了')
  assert.ok(xsl.includes('if (token.getAttributes().containsKey(SELECT_ATTR_NAME)) {'), '自带 select 不动 :24 不在了')
  assert.ok(xsl.includes('return name.equals("with-param") || name.equals("variable");'), 'isOurTag :42 不在了')
  assert.ok(xsl.includes('attribute.delete();'), '删 select :31 不在了')

  const token = read(`${EM}/tokens/TemplateToken.java`)
  assert.ok(token.includes('public @NotNull Map<String, String> getAttributes() {'), 'getAttributes :46 不在了')
  assert.ok(token.includes('return PsiTreeUtil.findChildOfType(myFile, XmlTag.class);'), 'getXmlTag :67 不在了')
  assert.ok(read(`${EM}/nodes/GenerationNode.java`).includes('public List<GenerationNode> getChildren() {'),
            'getChildren :101 不在了')
  assert.ok(read(`${REF}/xml/xml-psi-impl/src/com/intellij/psi/impl/source/xml/XmlTagValueImpl.java`)
              .includes('consolidatedText.append(element.getText());'), '值文本拼子元素 :62 不在了')

  const html = read(`${REF}/xml/xml-parser/src/com/intellij/xml/util/BasicHtmlUtil.java`)
  assert.ok(html.includes('public static final @NlsSafe String CLASS_ATTRIBUTE_NAME = "class";'), 'class 属性名 :37 不在了')
  assert.ok(html.includes('return classAttributeValue != null ? StringUtil.tokenize(classAttributeValue, " \\t,") : Collections.emptyList();'),
            'splitClassNames :233 不在了')

  const options = read(`${REF}/xml/emmet/src/com/intellij/application/options/emmet/EmmetOptions.java`)
  assert.ok(options.includes('private @NotNull String myBemElementSeparator = "__";'), '元素分隔符默认 __ :30 不在了')
  assert.ok(options.includes('private @NotNull String myBemShortElementPrefix = "-";'), '短前缀默认 - :32 不在了')
  assert.ok(read(`${EM}/generators/XmlZenCodingGeneratorImpl.java`)
              .includes('private static String getAttributeString(String name, String value) {'),
            '属性渲染 name="value" :99 不在了')

  const registration = read(`${REF}/xml/emmet/resources/intellij.xml.emmet.xml`)
  assert.ok(registration.indexOf('XslZenCodingFilter') < registration.indexOf('CommentZenCodingFilter'), '注册顺序 :34-39 不在了')
  assert.ok(registration.indexOf('BemEmmetFilter') < registration.indexOf('TrimZenCodingFilter'), '注册顺序 :34-39 不在了')
})

test('Escape（EscapeZenCodingFilterTest 同形；替换顺序 = 上游 :13-15）', () => {
  const text = '<div id="&idName"></div>'
  assert.equal(escapeEmmetFilterText(text), '&lt;div id="&amp;idName"&gt;&lt;/div&gt;')
  assert.equal(escapeEmmetFilterText(escapeEmmetFilterText(text)),
               '&amp;lt;div id="&amp;amp;idName"&amp;gt;&amp;lt;/div&amp;gt;', '二次转义：& 先替才不重复')
  assert.equal(escapeEmmetFilterText(''), '', '空输入')
  assert.equal(escapeEmmetFilterText('plain text'), 'plain text', '无 & < > 原样')
})

test('SingleLine（上游 :21 只删 \\n，缩进不动）', () => {
  assert.equal(singleLineEmmetFilterText('<div>\n\t<p></p>\n</div>'), '<div>\t<p></p></div>')
  assert.equal(singleLineEmmetFilterText('<div><p></p></div>'), '<div><p></p></div>', '无换行原样')
  assert.equal(singleLineEmmetFilterText('\n'), '', '只有换行')
  assert.equal(singleLineEmmetFilterText(''), '', '空输入')
})

test('Comment（上游 :27-38 + 格式 :40-42；#id 在 .class 前）', () => {
  const tag = { hasXmlTag: true }
  assert.equal(commentEmmetFilterText('<div id="idName"></div>', { ...tag, attributes: { id: 'idName' } }),
               '<div id="idName"></div>\n<!-- /#idName -->')
  assert.equal(commentEmmetFilterText('<div class="clName"></div>', { ...tag, attributes: { class: 'clName' } }),
               '<div class="clName"></div>\n<!-- /.clName -->')
  assert.equal(commentEmmetFilterText('<div id="idName" class="clName"></div>',
                                      { ...tag, attributes: { class: 'clName', id: 'idName' } }),
               '<div id="idName" class="clName"></div>\n<!-- /#idName.clName -->')
  const plain = '<div></div>'
  assert.equal(commentEmmetFilterText(plain, { ...tag, attributes: {} }), plain, '无 class/id 不加注释（:32）')
  assert.equal(commentEmmetFilterText(plain, { ...tag, attributes: { class: '' } }), plain, '空串 class 同样是空')
  assert.equal(commentEmmetFilterText('<div class="a"></div>', { hasXmlTag: false, attributes: { class: 'a' } }),
               '<div class="a"></div>', 'tag == null（:29-30）原样')
})

test('Trim（上游 PATTERN :18 + 无标签半边 :55；PSI 半边未移植见文件头差异 2）', () => {
  assert.equal(trimEmmetFilterText('1. test', { hasXmlTag: false }), 'test')
  assert.equal(trimEmmetFilterText(' 1 test', { hasXmlTag: false }), 'test', '编组项：一个空白 + 数字 + 空格')
  assert.equal(trimEmmetFilterText(' * test', { hasXmlTag: false }), 'test', '星号是字面标记')
  assert.equal(trimEmmetFilterText('2. list item two', { hasXmlTag: false }), 'list item two', '围选文本逐行同算子（:68）')
  assert.equal(trimLineMarkers('- item'), 'item', '连字符是标记')
  assert.equal(trimLineMarkers('\u2022item'), 'item', '圆点是标记（\\u2022）')
  assert.equal(trimEmmetFilterText('\u00a01. x', { hasXmlTag: false }), 'x', 'nbsp 是标记（\\u00a0）')
  assert.equal(trimEmmetFilterText('|1. x', { hasXmlTag: false }), 'x', '竖线算那个「可选首字符」')
  assert.equal(trimEmmetFilterText('1.', { hasXmlTag: false }), '', '整串都是标记')
  assert.equal(trimEmmetFilterText('  1. x', { hasXmlTag: false }), '  1. x', '开头最多吃一个字符（上游 ([\\s|\\u00a0])? 只一个）')
  assert.equal(trimEmmetFilterText('title', { hasXmlTag: false }), 'title', '无标记原样')
  assert.equal(trimEmmetFilterText('', { hasXmlTag: false }), '', '空输入')
  assert.equal(trimEmmetFilterText('<div>1. </div>', { hasXmlTag: true }), '<div>1. </div>',
               '登记缺口：上游 :37-53 会清掉值文本 → <div></div>，本仓无 PSI 不伪造')
})

test('Xsl（上游 :20-37；只处理片段根起始标签，见文件头差异 3）', () => {
  const noSelectInAbbrev = { attributes: {} }
  assert.equal(xslEmmetFilterText('<xsl:variable name="" select=""/>',
                                  { hasChildren: false, ...noSelectInAbbrev }),
               '<xsl:variable name="" select=""/>', '无子节点不删（isOurTag :39-45 要求 hasChildren）')
  assert.equal(xslEmmetFilterText('<xsl:variable name="" select="">\n    <p></p>\n</xsl:variable>',
                                  { hasChildren: true, ...noSelectInAbbrev }),
               '<xsl:variable name="">\n    <p></p>\n</xsl:variable>', '有子节点 → 删 select（上游用例 2）')
  assert.equal(xslEmmetFilterText('<xsl:with-param name="p" select="$v"><b></b></xsl:with-param>',
                                  { hasChildren: true, ...noSelectInAbbrev }),
               '<xsl:with-param name="p"><b></b></xsl:with-param>', 'local name 命中第二种')
  assert.equal(xslEmmetFilterText('<variable select="a">x</variable>', { hasChildren: true, ...noSelectInAbbrev }),
               '<variable>x</variable>', 'getLocalName 不看命名空间前缀')
  const withSelect = '<xsl:variable name="" select="">\n    <p></p>\n</xsl:variable>'
  assert.equal(xslEmmetFilterText(withSelect, { hasChildren: true, attributes: { select: '' } }), withSelect,
               '缩写自带 select → 一律不动（:24-26）')
  const noAttr = '<xsl:variable name="">\n    <p></p>\n</xsl:variable>'
  assert.equal(xslEmmetFilterText(noAttr, { hasChildren: true, ...noSelectInAbbrev }), noAttr, '没有 select 属性可删（:29-30）')
  const div = '<div class="x" select="y"></div>'
  assert.equal(xslEmmetFilterText(div, { hasChildren: true, ...noSelectInAbbrev }), div, '不是 with-param/variable')
  assert.equal(xslEmmetFilterText('plain text', { hasChildren: true, ...noSelectInAbbrev }), 'plain text',
               '片段无标签（token.getXmlTag() == null，:22-23/:35）')
  assert.equal(xslEmmetFilterText('', { hasChildren: true, ...noSelectInAbbrev }), '', '空输入')
})

test('Bem class 值核心（上游用例逐条重放：:49-70 / :72-110 / :112-135 / :154-178 / :185-192 / :201-222）', () => {
  assert.equal(bemFilterClassValue('b_m'), 'b b_m', '.b_m|bem')
  assert.equal(bemFilterClassValue('b_m1 _m2'), 'b b_m1 b_m2', '.b_m1._m2|bem')
  assert.equal(bemFilterClassValue('b _mod'), 'b b_mod', '.b._mod|bem（无祖先时 donor 是本节点）')
  assert.equal(bemFilterClassValue('__e', ['b']), 'b__e', '.b>.__e|bem')
  assert.equal(bemFilterClassValue('-e', ['b']), 'b__e', '.b>.-e 短前缀换成元素分隔符')
  assert.equal(bemFilterClassValue('-e1', ['b']), 'b__e1', '.b>.-e1')
  assert.equal(bemFilterClassValue('__e2', ['b', '-e1']), 'b__e2', '.b>.-e1>.-e2：爬到父层 block')
  assert.equal(bemFilterClassValue('____e2', ['b']), 'b__e2', '.b>.__e1>.____e2：两个前缀仍只吃父层一层')
  assert.equal(bemFilterClassValue('--e2_m2', ['b1-div', 'b2_m1']), 'b1-div__e2 b1-div__e2_m2',
               '.b1-div>.b2_m1>.--e2_m2：前缀个数 = 爬的层数，修饰符另拆一份')
  assert.equal(bemFilterClassValue('name__name2__name3'), 'name__name2__name3',
               '回归：修饰符从最后一个元素分隔符之后找（:121），故 name3 不拆成修饰符')
  assert.equal(bemFilterClassValue('name__name2__name3__name4'), 'name__name2__name3__name4', '回归：四段同样不拆')
  assert.equal(bemFilterClassValue('title -title', ['news']), 'title news__title', '.news(.title.-title(…))：首见顺序去重（:63）')
  assert.equal(bemFilterClassValue('-text', ['news', 'title -title']), 'title__text', '同上的内层节点')
  assert.equal(bemFilterClassValue('__e', [null]), '__e', '祖先没写 class → 没有 block 可借，类名保留规范化形')
  assert.equal(bemFilterClassValue(''), '', 'class 空串：集合为空 → 空串（上游照写 class=""）')
  assert.equal(bemFilterClassValue('y9 b-x _m'), 'y9 b-x y9_m',
               'BLOCK_NAME_PATTERN :32 配 :202 matcher.matches()（整串）→ b-x 不算块名，取字母开头的 y9')
})

test('Bem 分隔符可配（上游用例 createBemTestInitializer：EmmetOptions.java:30-32 可改）', () => {
  assert.deepEqual(EMMET_BEM_SEPARATORS, { element: '__', modifier: '_', shortPrefix: '-' })
  assert.equal(bemFilterClassValue('b9m', [], { element: '__', modifier: '9', shortPrefix: '-' }), 'b b9m',
               '修饰符改成 9 的用例')
  assert.equal(bemFilterClassValue('b9m', [], { element: '', modifier: '', shortPrefix: '' }), 'b9mb9m',
               '三个分隔符都空：extract 在 0 位切出空 block，用节点块名补回')
  assert.equal(bemFilterClassValue('\u042be', ['b'], { element: '\u042b', modifier: '_', shortPrefix: '-' }), 'b\u042be',
               '元素分隔符换成西里尔字母')
})

test('Bem 文本端口（改写根起始标签的 class；无 class 属性/无标签原样）', () => {
  assert.equal(bemEmmetFilterText('<div class="b_m"></div>', { attributes: { class: 'b_m' } }),
               '<div class="b b_m"></div>')
  assert.equal(bemEmmetFilterText('<div class="__e"></div>', { attributes: { class: '__e' }, ancestorClassValues: ['b'] }),
               '<div class="b__e"></div>')
  assert.equal(bemEmmetFilterText('<div class="b"></div>', { attributes: {} }), '<div class="b"></div>',
               '缩写没写 class → 整段跳过（:55）')
  assert.equal(bemEmmetFilterText('plain text', { attributes: { class: 'b_m' } }), 'plain text', '片段无起始标签')
  assert.equal(bemEmmetFilterText("<div class='b_m'></div>", { attributes: { class: 'b_m' } }),
               '<div class="b b_m"></div>', '单引号形也认（上游生成器只出双引号，文本端口健壮分支）')
  assert.equal(bemEmmetFilterText('<span>t</span>', { attributes: { class: 'b_m' } }), '<span>t</span>',
               '根标签没写出 class 属性 → 原样')
})
