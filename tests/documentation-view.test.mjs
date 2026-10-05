// 快速文档的渲染模型（`src/documentationView.ts`）：markdown/HTML 富内容 → 区块 + 链接 + 图片，
// 外部链接与 `file:` 内部链接的分类，以及「在浏览器中打开」的候选列表。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyDocLink, decodeDocEntities, docPlainText, externalDocumentationLinks, extractJavadocLinks,
  firstInternalDocLink, isExternalDocTarget, parseQuickDoc,
} from '../src/documentationView.ts'

test('实体解码：五个命名实体 + 数字实体，&amp; 最后处理', () => {
  assert.equal(decodeDocEntities('&lt;T&gt; &amp;&amp; &quot;x&quot; &#39;y&#39; &nbsp; &#65;'), '<T> && "x" \'y\'   A')
  assert.equal(decodeDocEntities('&amp;lt;'), '&lt;', '不二次解码')
})

test('链接分类：https/mailto 外部、#锚点、file: 还原成本机路径', () => {
  assert.equal(classifyDocLink('x', 'https://example.com/a').kind, 'external')
  assert.equal(classifyDocLink('x', 'mailto:a@b.c').kind, 'external')
  assert.equal(classifyDocLink('x', '#section').kind, 'anchor')
  assert.equal(classifyDocLink('x', 'file:///C:/proj/A.java').kind, 'internal')
  assert.equal(classifyDocLink('x', 'file:///C:/proj/A.java#L12').line, 12)
  assert.equal(isExternalDocTarget('HTTPS://x'), true, '大小写不敏感')
  assert.equal(isExternalDocTarget('src/A.java'), false)
})

test('javadoc 内联标签：{@link} 变链接、{@code} 只留文本', () => {
  const links = []
  const text = extractJavadocLinks('见 {@link Foo#bar(int) 说明} 与 {@code A.b}', links)
  assert.equal(text, '见 说明 与 A.b')
  assert.deepEqual(links, [{ label: '说明', target: 'Foo#bar(int)', kind: 'internal' }])
})

test('markdown：链接与图片、围栏代码块、标题', () => {
  const model = parseQuickDoc('# 标题\n\n正文 [示例](https://example.com) 结束\n\n```java\nint x = 1;\n```\n\n![图](./a.png)')
  assert.deepEqual(model.blocks[0], { kind: 'heading', text: '标题' })
  assert.equal(model.blocks.some(block => block.kind === 'code' && block.language === 'java' && block.text.includes('int x')), true)
  assert.deepEqual(model.links, [{ label: '示例', target: 'https://example.com', kind: 'external' }])
  assert.deepEqual(model.images, [{ src: './a.png', alt: '图', external: false }])
  const plain = docPlainText(model)
  assert.ok(plain.includes('正文 示例 结束'), '链接文本留在正文里')
  assert.ok(!plain.includes('https://'), 'URL 不再当正文贴出')
})

test('HTML：<a>/<img>/<pre> 与块级标签换行、实体解码', () => {
  const html = '<p>看 <a href="https://kotlinlang.org">Kotlin</a> 文档</p><pre><code>val a = 1 &amp;&amp; true</code></pre><img src="https://x/y.png" alt="图">'
  const model = parseQuickDoc(html, 'html')
  assert.deepEqual(model.links[0], { label: 'Kotlin', target: 'https://kotlinlang.org', kind: 'external' })
  assert.equal(model.images[0].external, true)
  assert.equal(model.images[0].alt, '图')
  assert.ok(model.blocks.some(block => block.kind === 'code' && block.text.includes('val a = 1 && true')))
  assert.ok(docPlainText(model).includes('看 Kotlin 文档'))
})

test('格式缺省按内容猜：有块级标签当 HTML，否则 markdown', () => {
  assert.ok(parseQuickDoc('<p>a</p>').blocks.length === 1)
  assert.ok(parseQuickDoc('纯文本 **不加粗**').blocks[0].kind === 'text')
})

test('外部文档链接：只收集 external 且去重；内部候选取第一条', () => {
  const model = parseQuickDoc('a [f](file:///C:/p/A.java#L3) {@link Foo} [x](https://a) [y](https://a) [z](https://b)')
  assert.deepEqual(externalDocumentationLinks(model).map(link => link.target), ['https://a', 'https://b'])
  const internal = firstInternalDocLink(model)
  assert.equal(internal.target, 'C:/p/A.java')
  assert.equal(internal.line, 3)
})

test('空内容不炸，图片 alt 为空也算一条', () => {
  assert.deepEqual(parseQuickDoc(''), { blocks: [], links: [], images: [] })
  assert.deepEqual(parseQuickDoc(undefined), { blocks: [], links: [], images: [] })
})
