// 弹层布局模型（`src/quickDocLayout.ts`）+ 内联链接的分段（`src/documentationView.ts` 的 `parts`）。
//
// 上游坐标：
//   · `platform/analysis-api/src/com/intellij/lang/documentation/DocumentationMarkup.java:13-31`
//     —— 四块 class 名 definition / content / sections(+section) / bottom；
//   · `platform/lang-impl/src/com/intellij/codeInsight/documentation/DocumentationHtmlUtil.kt:44-77`
//     —— 弹层几何（preferred 300/500、min 300、max 900×500、补全那条 450×300）、同一文件 `:135`
//     的 `.section { padding-right: 4px }`、`:143-149` 的 `removeEmptySections`、
//     `:152-159` 的 `addExternalLinkIcons`（`http` 链接末尾追加外链箭头）；
//   · `platform/code-style-impl/src/com/intellij/formatting/comments/DocCommentLineDataBuilder.java:67-107`
//     —— javadoc 行拆成「标签 / 主题词 / 描述」：`@` 开头才算（:75）、`@param` 跳一个词（:81-89，
//     `$T` 这种类型参数引用不跳）、`@throws` 跳一个词（:91-93）；
//   · `platform/lsp-impl/src/impl/features/documentation/LspDocumentationData.kt:91-103`
//     —— 描述的 markdown 进 `CONTENT_START`：**链接就长在句子里**（转成 HTML 后是正文中的 `<a href>`），
//     上游没有第二块「链接清单」。所以本仓把 `{@link …}` / `[x](…)` 折成分段（`parts`）贴回原句，
//     进不了正文的那些（`@param` 被重排掉的行）才留在 `layout.links` 一行里。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { docBlock, docPartsFromMarks, docPlainText, docTextFromMarks, parseQuickDoc } from '../src/documentationView.ts'
import { DOC_MARKUP_CLASS, DOC_POPUP_METRICS, buildQuickDocLayout, currentExternalUrl, parseDocCommentLine, parseDocCommentLineParts } from '../src/quickDocLayout.ts'
import { createHoverDocumentation } from '../src/hoverDocumentation.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = path => readFileSync(join(root, path), 'utf8')
const NL = String.fromCharCode(10)

/** 把 `parts` 折成人话（断言写得动，也比逐字段 deepEqual 少钉死形状）。 */
function renderParts(parts) {
  return parts.map(part => ('link' in part ? '[[' + part.link.label + '|' + part.link.kind + ']]' : part.text)).join('')
}

/** 布局里所有能点的东西：正文/分节的内联分段 + 进不了正文的链接行。 */
function clickable(layout) {
  const inline = []
  for (const block of layout.content) for (const part of block.parts ?? []) if ('link' in part) inline.push(part.link)
  for (const section of layout.sections) for (const part of section.parts ?? []) if ('link' in part) inline.push(part.link)
  return { inline, row: layout.links }
}

test('javadoc 行拆标签/主题词/描述，逐条照 DocCommentLineDataBuilder', () => {
  assert.deepEqual(parseDocCommentLine('@param name 用户的名字'), { tag: '@param', subject: 'name', text: '用户的名字' })
  assert.deepEqual(parseDocCommentLine('@param $T 类型参数'), { tag: '@param', subject: '$T', text: '类型参数' }, '$T 是类型参数引用，不跳（:84）')
  assert.deepEqual(parseDocCommentLine('@throws IOException 读失败'), { tag: '@throws', subject: 'IOException', text: '读失败' })
  assert.deepEqual(parseDocCommentLine('@return 结果'), { tag: '@return', subject: '', text: '结果' }, '@return 后面那个词就是描述本身')
  assert.deepEqual(parseDocCommentLine('普通一行'), { tag: '', subject: '', text: '普通一行' })
  assert.deepEqual(parseDocCommentLine(' * @param a 说明'), { tag: '@param', subject: 'a', text: '说明' }, '注释的星号前缀先剥（:69-71）')
  assert.deepEqual(parseDocCommentLine('@see'), { tag: '@see', subject: '', text: '' })
})

test('分节两种来源都认：@tag 与 粗体标题加横线', () => {
  const text = ['```java', 'void a()', '```', '', '说明。', '', '@param x 参数', '', '@param y 参数二', '', '**返回**', '', '---', '', '值'].join(NL)
  const layout = buildQuickDocLayout(createHoverDocumentation(text), parseQuickDoc(text))
  assert.deepEqual(layout.definition, { code: 'void a()', language: 'java' })
  assert.equal(layout.content.length, 2, '正文只剩围栏与说明：当表头用的那块粗体已经被分节吃掉，不留副本')
  assert.equal(layout.content.some(block => block.text.includes('返回')), false, '表头文本不该在正文里再出现一次')
  assert.match(layout.content[1].text, /说明。/)
  assert.deepEqual(layout.sections.map(section => section.header), ['x', 'y', '返回'])
  assert.equal(layout.sections[0].content, '参数')
  assert.equal(layout.sections[1].content, '参数二')
  assert.equal(layout.sections[2].content, '值')
})

test('removeEmptySections：只剩空白的节整节删掉（DocumentationHtmlUtil.kt:143-149）', () => {
  const text = ['说明', '', '@param a 有内容', '', '**返回**', '', '---', '', '   '].join(NL)
  const layout = buildQuickDocLayout(createHoverDocumentation('说明'), parseQuickDoc(text))
  assert.deepEqual(layout.sections.map(section => section.header), ['a'])
})

test('外部文档链接：只有 http(s) 才算，「在浏览器中打开」的可点性由它决定', () => {
  const layout = buildQuickDocLayout(createHoverDocumentation('x'), parseQuickDoc('看 [A](https://example.org/a) 与 [B](ftp://x/y) 与 {@link Foo}'))
  assert.equal(currentExternalUrl(layout), 'https://example.org/a')
  const none = buildQuickDocLayout(createHoverDocumentation('x'), parseQuickDoc('只有 {@link Foo}'))
  assert.equal(none.external, null)
  assert.equal(currentExternalUrl(none), null, '没有外部 URL 时这个动作整个不可见（DocumentationViewExternalAction.kt:15）')
})

test('弹层几何与 class 名逐个钉住上游数值（跨架构可照抄的那部分）', () => {
  assert.equal(DOC_POPUP_METRICS.preferredMinWidth, 300)
  assert.equal(DOC_POPUP_METRICS.preferredMaxWidth, 500)
  assert.equal(DOC_POPUP_METRICS.minWidth, 300)
  assert.equal(DOC_POPUP_METRICS.maxWidth, 900)
  assert.equal(DOC_POPUP_METRICS.maxHeight, 500)
  assert.equal(DOC_POPUP_METRICS.lookupDocPopupWidth, 450)
  assert.equal(DOC_POPUP_METRICS.lookupDocPopupMinHeight, 300)
  assert.equal(DOC_POPUP_METRICS.contentOuterPadding, 14)
  assert.equal(DOC_POPUP_METRICS.contentInnerPadding, 2)
  assert.equal(DOC_POPUP_METRICS.sectionPaddingRight, 4)
  assert.deepEqual(DOC_MARKUP_CLASS, {
    definition: 'definition', content: 'content', sections: 'sections',
    section: 'section', bottom: 'bottom', grayed: 'grayed',
  })
  assert.match(source('src/quickDocLayout.ts'), /DocumentationHtmlUtil\.kt:44-77/, '几何的上游出处没有登记')
})

test('内联链接：占位符让 {@link Bar} 贴在该在的位置，普通词 Bar 不被认错', () => {
  const model = parseQuickDoc('先说 Bar 再说 {@link Bar} 结束')
  assert.equal(model.links.length, 1)
  assert.equal(model.blocks[0].text, '先说 Bar 再说 Bar 结束', '纯文本形态与改动前逐字一致')
  assert.equal(renderParts(model.blocks[0].parts), '先说 Bar 再说 [[Bar|internal]] 结束')
  assert.equal(docPlainText(model), '先说 Bar 再说 Bar 结束')
})

test('三种链接来源都落在句子里：javadoc、markdown、HTML 的 a 标签', () => {
  assert.equal(renderParts(parseQuickDoc('见 {@link Foo#bar(int) 说明}').blocks[0].parts), '见 [[说明|internal]]')
  assert.equal(renderParts(parseQuickDoc('见 [文档](https://example.org/x)。').blocks[0].parts), '见 [[文档|external]]。')
  const html = parseQuickDoc('<p>见 <a href="file:///C:/ws/A.java#L3">A</a>。</p>', 'html')
  assert.equal(renderParts(html.blocks[0].parts), '见 [[A|internal]]。')
  assert.equal(html.links[0].target.includes('A.java'), true)
  assert.equal(html.links[0].line, 3)
})

test('没有链接的块不给 parts（形状与改动前一致），代码块永不内联', () => {
  assert.equal(parseQuickDoc('就是正文').blocks[0].parts, undefined)
  const fenced = parseQuickDoc(['```java', 'int x = 1;', '```'].join(NL))
  assert.equal(fenced.blocks.find(block => block.kind === 'code').parts, undefined, '代码块是原样等宽显示的')
  const mixed = parseQuickDoc(['```java', 'int x;', '```', '', '看 {@link Foo}'].join(NL))
  assert.ok(mixed.blocks.some(block => block.parts && renderParts(block.parts).includes('[[Foo|internal]]')))
})

test('docBlock 与两个占位符工具函数成对：text 折回显示名、parts 留住位置', () => {
  const links = [{ label: 'L', target: 'L', kind: 'internal' }]
  const raw = '前 ' + String.fromCharCode(2) + '0' + String.fromCharCode(3) + ' 后'
  assert.deepEqual(docPartsFromMarks(raw, links), [
    { text: '前 ' }, { link: links[0] }, { text: ' 后' },
  ])
  assert.equal(docTextFromMarks(raw, links), '前 L 后')
  assert.equal(docTextFromMarks('没有占位符', links), '没有占位符')
  assert.deepEqual(docPartsFromMarks('没有占位符', links), [{ text: '没有占位符' }])
  const block = docBlock('text', raw, links)
  assert.equal(block.text, '前 L 后')
  assert.equal(block.parts.length, 3)
  assert.equal(docBlock('code', raw, links).parts, undefined, '代码块不做内联链接')
})

test('已经长在句子里的链接不再重复列一行：@param 的说明也在句子里（DocumentationMarkup.java:29）', () => {
  const inlineOnly = buildQuickDocLayout(createHoverDocumentation('x'), parseQuickDoc('见 {@link Foo}'))
  assert.equal(clickable(inlineOnly).inline.length, 1)
  assert.equal(clickable(inlineOnly).row.length, 0, '内联过的不该又在链接行出现一次')
  // 标签行拆过偏移也照样把链接留在右格里：起点是「占位符原文」，不是折回显示名的纯文本。
  const inSection = buildQuickDocLayout(createHoverDocumentation('x'), parseQuickDoc(['@param a 先说 Bar 见 {@link Foo} 结束'].join(NL)))
  assert.equal(clickable(inSection).inline.length, 1, '@param 的说明里的引用要落在分节右格里')
  assert.equal(clickable(inSection).row.length, 0, '进了右格就不再在链接行重复一次')
  assert.equal(inSection.sections[0].header, 'a')
  assert.equal(inSection.sections[0].content, '先说 Bar 见 Foo 结束', '纯文本形态与拆之前逐字一致')
  assert.equal(renderParts(inSection.sections[0].parts), '先说 Bar 见 [[Foo|internal]] 结束')
  // 真的进不了正文的那一类：当表头用的那块粗体（左格按 `SECTION_HEADER_START` 只有参数名）
  // 与表格续行都放不下它 —— 仍然留在链接行，照样可点。
  const dropped = buildQuickDocLayout(createHoverDocumentation('x'), parseQuickDoc(['**返回 [文档](https://example.org/r)**', '---', '值'].join(NL + NL)))
  assert.equal(clickable(dropped).inline.length, 0)
  assert.equal(clickable(dropped).row.length, 1, '被表头吃掉的那块的链接留在链接行里，照样可点')
  assert.equal(dropped.links[0].kind, 'external')
})

test('parseDocCommentLineParts 与 parseDocCommentLine 同一套偏移：带不带链接拆出来一致', () => {
  const cases = ['@param name 用户的名字', '@param $T 类型参数', '@throws IOException 读失败', '@return 结果', '@see', '普通一行', ' * @param a 说明']
  for (const line of cases) {
    const plain = parseDocCommentLine(line)
    const parted = parseDocCommentLineParts({ kind: 'text', text: line }, [])
    assert.deepEqual({ tag: parted.tag, subject: parted.subject, text: parted.text }, plain, line)
    assert.equal(renderParts(parted.parts), plain.text, '分段折回来就是那一句描述')
  }
  // 描述里真有链接时：subject/text 按纯文本算，parts 把链接留在它原来那个位置。
  const linkedModel = parseQuickDoc('@param a 见 {@link Foo} 尾')
  const linked = parseDocCommentLineParts(linkedModel.blocks[0], linkedModel.links)
  assert.equal(linked.subject, 'a')
  assert.equal(linked.text, '见 Foo 尾')
  assert.equal(renderParts(linked.parts), '见 [[Foo|internal]] 尾')
})

test('链接目标：上游 XssSafeLinks.kt:8-15 判死的那三种留字断链', () => {
  const model = parseQuickDoc('[坏](javascript:alert(1)) 与 [更坏](vbscript:x) 与 [数据](data:text/html,<b>x</b>)')
  assert.deepEqual(model.links.map(link => [link.kind, link.target]), [['anchor', '#'], ['anchor', '#'], ['anchor', '#']])
  // `file:` 是这一条里本仓**故意不跟**的（见 `documentationView.ts` 的注释）：内部链接的导航链在这儿。
  const file = parseQuickDoc('[A](file:///C:/ws/A.java#L3)')
  assert.equal(file.links[0].kind, 'internal')
  assert.equal(file.links[0].line, 3)
})


test('接线：渲染层真的按 parts 贴内联链接，样式 class 名与上游一致', () => {
  const popup = source('src/components/QuickDocPopup.vue')
  const style = source('src/style.css')
  assert.match(popup, /block\.parts/, '正文没有按分段渲染（链接就还是死文本）')
  assert.match(popup, /section\.parts/, '分节右格没有按分段渲染')
  assert.match(popup, /partLink\(part\)/, '内联链接没有派发点击')
  assert.match(popup, /class="quickdoc-link/, '内联链接没有用上游那个链接的样式类')
  // 标题块也有一处死链接的坑：`docBlock('heading', …)` 给了 parts，模板只读 text 的话
  // 那条链接既点不动、又被 `buildQuickDocLayout` 从链接行里去掉了（整条链上彻底消失）。
  const heading = popup.slice(popup.indexOf('<h4'), popup.indexOf('</h4>'))
  assert.match(heading, /partLink\(part\)/, '标题块没按 parts 渲染：那句里的链接就永远点不到')
  for (const name of ['definition', 'content', 'sections', 'section', 'bottom']) {
    assert.ok(style.includes('.quickdoc-' + name) || name === 'bottom' && style.includes('.quickdoc-bottom'), 'style.css 缺 .quickdoc-' + name + '（上游 DocumentationMarkup 的 class 在 CSS 侧的翻译）')
  }
  assert.match(popup, /addExternalLinkIcons|ExternalLink/, '外部链接的外链箭头（DocumentationHtmlUtil.kt:152-159）没有落点')
})
