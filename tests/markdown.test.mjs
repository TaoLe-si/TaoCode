import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown } from '../src/markdown.ts'

test('headings map to h1..h6', () => {
  assert.equal(renderMarkdown('# 标题一'), '<h1>标题一</h1>')
  assert.equal(renderMarkdown('### 三级 ###'.replace(' ###', '')), '<h3>三级</h3>')
  assert.equal(renderMarkdown('###### 六级'), '<h6>六级</h6>')
})

test('paragraphs join lines and separate on blanks', () => {
  const html = renderMarkdown('第一行\n第二行\n\n第二段')
  assert.equal(html, '<p>第一行\n第二行</p>\n<p>第二段</p>')
})

test('inline emphasis, links, code and deletion render', () => {
  assert.equal(renderMarkdown('**加粗** 与 *斜体*'), '<p><strong>加粗</strong> 与 <em>斜体</em></p>')
  assert.equal(renderMarkdown('[文本](https://example.com)'), '<p><a href="https://example.com">文本</a></p>')
  assert.equal(renderMarkdown('`code` 与正文'), '<p><code>code</code> 与正文</p>')
  assert.equal(renderMarkdown('~~删除~~'), '<p><del>删除</del></p>')
})

test('code blocks keep content verbatim and escaped', () => {
  const html = renderMarkdown('```java\nif (a < b) {\n  x = "值";\n}\n```')
  assert.equal(html, '<pre data-lang="java"><code>if (a &lt; b) {\n  x = &quot;值&quot;;\n}</code></pre>')
})

test('bullet and ordered lists render with continuation lines', () => {
  assert.equal(renderMarkdown('- 甲\n- 乙'), '<ul><li>甲</li><li>乙</li></ul>')
  assert.equal(renderMarkdown('1. 一\n2. 二'), '<ol><li>一</li><li>二</li></ol>')
  assert.equal(renderMarkdown('- 甲\n  甲的续行\n- 乙'), '<ul><li>甲 甲的续行</li><li>乙</li></ul>')
})

test('blockquotes wrap nested markdown', () => {
  assert.equal(renderMarkdown('> 引用文本'), '<blockquote><p>引用文本</p></blockquote>')
})

test('tables render header and body cells', () => {
  const html = renderMarkdown('| 列A | 列B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |')
  assert.equal(html, '<table><thead><tr><th>列A</th><th>列B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>')
})

test('horizontal rules and raw HTML escaping', () => {
  assert.equal(renderMarkdown('---'), '<hr />')
  assert.equal(renderMarkdown('文本 <script>alert(1)</script>'), '<p>文本 &lt;script&gt;alert(1)&lt;/script&gt;</p>')
})

test('CRLF input normalizes like any other buffer', () => {
  assert.equal(renderMarkdown('# 头\r\n\r\n正文\r\n'), '<h1>头</h1>\n<p>正文</p>')
})
