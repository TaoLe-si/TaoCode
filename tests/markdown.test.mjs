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

test('relative links resolve against the file directory into workspace paths', () => {
  // The preview cannot address files by URL (the UI is served from a virtual host),
  // so every relative target becomes the workspace path the editor can open.
  assert.equal(renderMarkdown('[指南](guide.md)', { basePath: 'docs' }), '<p><a href="#docs/guide.md" data-md-open="docs/guide.md">指南</a></p>')
  assert.equal(renderMarkdown('[指南](./guide.md)', { basePath: 'docs' }), '<p><a href="#docs/guide.md" data-md-open="docs/guide.md">指南</a></p>')
  assert.equal(renderMarkdown('[返回](../README.md)', { basePath: 'docs/api' }), '<p><a href="#docs/README.md" data-md-open="docs/README.md">返回</a></p>')
  assert.equal(renderMarkdown('[根](/README.md)', { basePath: 'docs/api' }), '<p><a href="#README.md" data-md-open="README.md">根</a></p>')
  assert.equal(renderMarkdown('[同级](guide.md)'), '<p><a href="#guide.md" data-md-open="guide.md">同级</a></p>')
  // Escaping the root is impossible, so there is nothing to open.
  assert.equal(renderMarkdown('[越界](../../secret.md)', { basePath: 'docs' }), '<p>越界</p>')
})

test('unsafe link targets are never written into an href', () => {
  const script = renderMarkdown('[点我](javascript:alert(1))')
  assert.ok(!script.includes('href'), script)
  assert.equal(script, '<p>点我</p>')
  assert.equal(renderMarkdown('[数据](data:text/html;base64,PHNjcmlwdD4=)'), '<p>数据</p>')
  assert.equal(renderMarkdown('[脚本](vbScript:msgbox)'), '<p>脚本</p>')
  // A URL with parentheses is one link, not a link plus stray text.
  assert.equal(renderMarkdown('[维基](https://example.com/a_(b))'), '<p><a href="https://example.com/a_(b)">维基</a></p>')
})

test('images carry a workspace path to load from and reject unsafe sources', () => {
  assert.equal(renderMarkdown('![图](img/a.png)', { basePath: 'docs' }),
    '<p><span class="md-image md-image-pending" role="img" data-md-src="docs/img/a.png" data-md-alt="图">图片加载中…</span></p>')
  const inline = renderMarkdown('![图](data:image/png;base64,AAA)', { basePath: 'docs' })
  assert.equal(inline, '<p><img src="data:image/png;base64,AAA" alt="图" /></p>')
  const html = renderMarkdown('![图](javascript:alert(1))', { basePath: 'docs' })
  assert.ok(!html.includes('src='), html)
})

test('basePath reaches blockquotes and table cells', () => {
  assert.equal(renderMarkdown('> [指南](guide.md)', { basePath: 'docs' }),
    '<blockquote><p><a href="#docs/guide.md" data-md-open="docs/guide.md">指南</a></p></blockquote>')
  assert.equal(renderMarkdown('| 名 | 链 |\n| --- | --- |\n| 甲 | [指南](guide.md) |', { basePath: 'docs' }),
    '<table><thead><tr><th>名</th><th>链</th></tr></thead><tbody><tr><td>甲</td><td><a href="#docs/guide.md" data-md-open="docs/guide.md">指南</a></td></tr></tbody></table>')
})

test('CRLF input normalizes like any other buffer', () => {
  assert.equal(renderMarkdown('# 头\r\n\r\n正文\r\n'), '<h1>头</h1>\n<p>正文</p>')
})
