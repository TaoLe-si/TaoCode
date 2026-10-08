// 带格式复制（IDEA Rich-Text Copy）的规则单测。
//
// 被测实现逐句对照源码（路径与行号见 src/richCopy.ts 头部）。最有分量的一条断言是
// **复现上游自带的期望产物** `NormalSelection.html`
// （`platform/platform-tests/testData/editor/richcopy/NormalSelection.html`，由
//  `platform/platform-tests/testSrc/com/intellij/openapi/editor/richcopy/RichCopyTest.java:42-45`
//  与选区文本 `NormalSelection.java` 逐字节比对）。该产物里字号是占位符
// （`___PLATFORM_SPECIFIC___pt`），所以本测试把字号与字体族当变量，其余**逐字节**比对。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { copyFlavors } from '../src/editorClipboard.ts'
import {
  DEFAULT_RICH_COPY_SETTINGS,
  RICH_COPY_ACTIVE_SCHEME_MARKER,
  RICH_COPY_KEYMAP_ENTRIES,
  RICH_COPY_LABELS,
  RICH_COPY_MAX_SIZE_MB,
  RICH_COPY_MENU_ANCHORS,
  RICH_COPY_REGISTRATION,
  RICH_COPY_STATE_NAME,
  RICH_COPY_STORAGE,
  RICH_COPY_STRIP_INDENTS_DEFAULT,
  RICH_COPY_TRUNCATED_MARKER,
  buildRichCopyPayload,
  commonIndentWidth,
  cssColorToHex,
  formatFontSizePt,
  richCopyActionVisible,
  richCopyEnabled,
  richCopyFlavors,
  richCopyFontSizePt,
  richCopyFromEditor,
  richCopyHtmlFragment,
  richCopyUsesActiveScheme,
  selectRenderedLines,
  stripIndent,
  styledRunToRichCopyRun,
  withRichCopyEnabled,
} from '../src/richCopy.ts'

// ---------------------------------------------------------------------------
// 复现上游期望产物：NormalSelection
// ---------------------------------------------------------------------------

// 选区文本（`NormalSelection.java` 去掉 <selection> 标记后的内容，含末尾换行）。
const NORMAL_SELECTION_TEXT = 'public class Basic {\n  int field;\n\n  public static void main(String[] args) {\n    System.out.println("Hello\\tworld!");\n  }\n}\n'

// Java 高亮分段（键色取自 `NormalSelection.html`：关键字 #000080 粗体、字符串 #008000 粗体）。
const KEYWORD = { color: '#000080', bold: true }
const STRING = { color: '#008000', bold: true }
const PLAIN = {}

// 每行 = 若干段；段边界照抄 `NormalSelection.html` 里 span 的位置。
// 末尾的空行对应选区末尾那个 `\n`（`HtmlSyntaxInfoReader.java:195-198` 每个换行出 `<br>`）。
const NORMAL_SELECTION_LINES = [
  [{ text: 'public class ', ...KEYWORD }, { text: 'Basic {', ...PLAIN }],
  [{ text: '  ', ...PLAIN }, { text: 'int ', ...KEYWORD }, { text: 'field;', ...PLAIN }],
  [],
  [{ text: '  ', ...PLAIN }, { text: 'public static void ', ...KEYWORD }, { text: 'main(String[] args) {', ...PLAIN }],
  [{ text: '    ', ...PLAIN }, { text: 'System.out.println(', ...PLAIN }, { text: '"Hello', ...STRING },
   { text: '\\t', ...KEYWORD }, { text: 'world!"', ...STRING }, { text: ');', ...PLAIN }],
  [{ text: '  ', ...PLAIN }, { text: '}', ...PLAIN }],
  [{ text: '}', ...PLAIN }],
  [],
]

const NORMAL_SELECTION_OPTIONS = {
  defaultForeground: '#000000',
  defaultBackground: '#ffffff',
  fontFamily: 'PLATFORM_SPECIFIC',
  fontSizePt: 14,
  tabSize: 4,
  fontMonospace: true,
}

/** 上游产物（字号/字体族是占位符，这里替换成我们传的值以便逐字节比对）。 */
function expectedNormalSelectionHtml() {
  return '<html><head><meta http-equiv="content-type" content="text/html; charset=UTF-8"></head><body>'
    + '<div style="background-color:#ffffff;color:#000000">'
    + '<pre style="font-family:\'PLATFORM_SPECIFIC\',monospace;font-size:14.0pt;">'
    + '<span style="color:#000080;font-weight:bold;">public&#32;class&#32;</span>Basic&#32;{<br>'
    + '&#32;&#32;<span style="color:#000080;font-weight:bold;">int&#32;</span>field;<br><br>'
    + '&#32;&#32;<span style="color:#000080;font-weight:bold;">public&#32;static&#32;void&#32;</span>main(String[]&#32;args)&#32;{<br>'
    + '&#32;&#32;&#32;&#32;System.out.println(<span style="color:#008000;font-weight:bold;">"Hello</span>'
    + '<span style="color:#000080;font-weight:bold;">\\t</span>'
    + '<span style="color:#008000;font-weight:bold;">world!"</span>);<br>'
    + '&#32;&#32;}<br>}<br>'
    + '</pre></div></body></html>'
}

test('逐字节复现上游 NormalSelection.html（字号/字体族为变量）', () => {
  const actual = richCopyHtmlFragment(NORMAL_SELECTION_LINES, NORMAL_SELECTION_OPTIONS)
  assert.equal(actual, expectedNormalSelectionHtml())
})

test('载荷 = 纯文本原文 + HTML 片段（TextWithMarkupProcessor.createResult:137-141）', () => {
  const payload = buildRichCopyPayload({
    text: NORMAL_SELECTION_TEXT,
    lines: NORMAL_SELECTION_LINES,
    options: NORMAL_SELECTION_OPTIONS,
  })
  // 纯文本是选区**原文**，不剥缩进（上游 `myText` 就是选区原文）
  assert.equal(payload.plain, NORMAL_SELECTION_TEXT)
  assert.equal(payload.html, expectedNormalSelectionHtml())
})

// ---------------------------------------------------------------------------
// 产物形状 / flavor 组合
// ---------------------------------------------------------------------------

test('剪贴板 flavor 按 priority 降序：HTML(200) > RTF(100) > 纯文本(0)', () => {
  const flavors = richCopyFlavors()
  assert.deepEqual(flavors.map(f => f.priority), [200, 100, 0])
  assert.equal(flavors[0].mime, 'text/html; class=java.io.Reader; charset=UTF-8')
  assert.equal(flavors[1].mime, 'text/rtf;class=java.io.InputStream')
  // 本仓不产 RTF：如实标记 produced=false，不假装有
  assert.equal(flavors[0].produced, true)
  assert.equal(flavors[1].produced, false)
  assert.equal(flavors[2].produced, true)
})

// ---------------------------------------------------------------------------
// HTML 生成规则
// ---------------------------------------------------------------------------

test('背景色挂在 div 上、`<pre>` 承载字体族与字号（HtmlSyntaxInfoReader:83-100）', () => {
  const html = richCopyHtmlFragment([[{ text: 'x' }]], NORMAL_SELECTION_OPTIONS)
  assert.ok(html.startsWith('<html><head><meta http-equiv="content-type" content="text/html; charset=UTF-8"></head><body>'))
  assert.ok(html.includes('<div style="background-color:#ffffff;color:#000000">'))
  assert.ok(html.includes('<pre style="font-family:\'PLATFORM_SPECIFIC\',monospace;font-size:14.0pt;">'))
  assert.ok(html.endsWith('</pre></div></body></html>'))
})

test('非等宽字体不加 `,monospace`（HtmlSyntaxInfoReader:120-123）', () => {
  const html = richCopyHtmlFragment([[{ text: 'x' }]], { ...NORMAL_SELECTION_OPTIONS, fontMonospace: false })
  assert.ok(html.includes('<pre style="font-family:\'PLATFORM_SPECIFIC\';font-size:14.0pt;">'))
})

test('字体族为空时 `<pre>` 不写 font-family 规则（HtmlSyntaxInfoReader:91-98）', () => {
  const html = richCopyHtmlFragment([[{ text: 'x' }]], { ...NORMAL_SELECTION_OPTIONS, fontFamily: '' })
  assert.ok(html.includes('<pre style="font-size:14.0pt;">'))
})

test('转义：< > & 空格，换行→<br>（HtmlSyntaxInfoReader:187-198）', () => {
  const html = richCopyHtmlFragment([[{ text: 'a<b>&c d' }]], NORMAL_SELECTION_OPTIONS)
  assert.ok(html.includes('a&lt;b&gt;&amp;c&#32;d'))
})

test('制表按制表位补到下一个 stop（HtmlSyntaxInfoReader:199-202）', () => {
  // 列号 0 起，tabSize=4 ⇒ 补 4 个 &#32;（上游 tab 分支补完后又自增一次，这里照抄不"修正"）。
  // 关掉剥缩进，否则这一行的前导 tab 会被当成公共缩进剥掉。
  const html = richCopyHtmlFragment([[{ text: '\tx' }]], { ...NORMAL_SELECTION_OPTIONS, tabSize: 4, stripIndents: false })
  assert.ok(html.includes('>&#32;&#32;&#32;&#32;x'))
})

test('默认色/空色不写 span（HtmlSyntaxInfoReader:158-185）', () => {
  const html = richCopyHtmlFragment([[{ text: 'plain' }]], NORMAL_SELECTION_OPTIONS)
  assert.ok(html.includes('>plain</pre>'))
  assert.ok(!html.includes('<span'))
})

test('纯空白段不写前景/粗体，只写背景（SyntaxInfoBuilder:580-587）', () => {
  const html = richCopyHtmlFragment([[{ text: '  ', color: '#ff0000', bold: true }, { text: 'x', color: '#ff0000', bold: true }]],
    { ...NORMAL_SELECTION_OPTIONS, stripIndents: false })
  // 前导空白裸露、无 span；只有 "x" 带 span
  assert.ok(html.includes('>&#32;&#32;<span style="color:#ff0000;font-weight:bold;">x</span>'))
})

test('span 属性顺序固定：前景 → 背景 → 粗 → 斜 → 字体族（HtmlSyntaxInfoReader:166-182）', () => {
  const html = richCopyHtmlFragment([[{
    text: 'x', color: '#112233', background: '#445566', bold: true, italic: true, fontFamily: 'Fira Code',
  }]], NORMAL_SELECTION_OPTIONS)
  assert.ok(html.includes('<span style="color:#112233;background-color:#445566;font-weight:bold;font-style:italic;font-family:\'Fira Code\',monospace;">'))
})

test('超过 maxLength 追加 ... truncated ...（HtmlSyntaxInfoReader:230-237）', () => {
  const lines = [[{ text: 'aaaaaaaaaa' }], [{ text: 'bbbbbbbbbb' }], [{ text: 'cccccccccc' }]]
  const html = richCopyHtmlFragment(lines, { ...NORMAL_SELECTION_OPTIONS, maxLength: 20 })
  assert.ok(html.includes(RICH_COPY_TRUNCATED_MARKER))
  // 截断后仍正常收尾
  assert.ok(html.endsWith('</pre></div></body></html>'))
})

test('未超限不追加截断标记', () => {
  const html = richCopyHtmlFragment([[{ text: 'short' }]], { ...NORMAL_SELECTION_OPTIONS, maxLength: 10000 })
  assert.ok(!html.includes(RICH_COPY_TRUNCATED_MARKER))
})

// ---------------------------------------------------------------------------
// 缩进剥离
// ---------------------------------------------------------------------------

test('公共缩进 = 各行前导空白的最小值，纯空白行跳过（TextWithMarkupProcessor:188-222）', () => {
  assert.equal(commonIndentWidth(['    a', '  b', '      c']), 2)
  // 纯空白行不影响（:211-213 continue）
  assert.equal(commonIndentWidth(['    a', '', '   ', '    b']), 4)
  // 某行顶格 ⇒ 0（:216-218 break）
  assert.equal(commonIndentWidth(['    a', 'b']), 0)
  assert.equal(commonIndentWidth([]), 0)
})

test('stripIndent 只剥行首的空白字符（SyntaxInfoBuilder:663-670）', () => {
  assert.equal(stripIndent('    x', 2), '  x')
  assert.equal(stripIndent('\tx', 1), 'x')
  assert.equal(stripIndent('  x', 5), 'x')
  // 行首非空白就不动
  assert.equal(stripIndent('x  ', 3), 'x  ')
})

test('默认剥缩进（registry editor.richcopy.strip.indents=true，registry.properties:1223）', () => {
  assert.equal(RICH_COPY_STRIP_INDENTS_DEFAULT, true)
  const lines = [[{ text: '    a' }], [{ text: '    b' }]]
  const stripped = richCopyHtmlFragment(lines, NORMAL_SELECTION_OPTIONS)
  assert.ok(stripped.includes('>a<br>b</pre>'))
  const kept = richCopyHtmlFragment(lines, { ...NORMAL_SELECTION_OPTIONS, stripIndents: false })
  assert.ok(kept.includes('>&#32;&#32;&#32;&#32;a'))
})

test('剥缩进时保留每段的颜色（跨段剪掉前导空白）', () => {
  const lines = [[{ text: '  ', color: '#ff0000' }, { text: '  x', color: '#00ff00' }]]
  const html = richCopyHtmlFragment(lines, NORMAL_SELECTION_OPTIONS)
  assert.ok(html.includes('<span style="color:#00ff00;">x</span>'))
})

// ---------------------------------------------------------------------------
// 颜色 / 字号
// ---------------------------------------------------------------------------

test('CSS 颜色 → #rrggbb（UIUtil.appendColor:1317-1325 两位补零小写）', () => {
  assert.equal(cssColorToHex('rgb(0, 0, 128)'), '#000080')
  assert.equal(cssColorToHex('rgba(255, 255, 255, 0.5)'), '#ffffff')
  assert.equal(cssColorToHex('#ABC'), '#aabbcc')
  assert.equal(cssColorToHex('#008000'), '#008000')
  assert.equal(cssColorToHex(''), '')
  assert.equal(cssColorToHex('not-a-color'), '')
})

test('字号换算：非 Mac 非 headless 乘 0.75 / defFontScale（SyntaxInfoBuilder:554-557）', () => {
  assert.equal(richCopyFontSizePt(14, { isMac: false, isHeadless: false, defFontScale: 1 }), 10.5)
  assert.equal(richCopyFontSizePt(14, { isMac: false, isHeadless: false, defFontScale: 2 }), 5.25)
  // Mac 再乘 0.75（HtmlSyntaxInfoReader:109-115）
  assert.equal(richCopyFontSizePt(16, { isMac: true }), 12)
  // headless 不乘
  assert.equal(richCopyFontSizePt(14, { isHeadless: true }), 14)
})

test('字号格式化一位小数（HtmlSyntaxInfoReader:114）', () => {
  assert.equal(formatFontSizePt(10.5), '10.5pt')
  assert.equal(formatFontSizePt(14), '14.0pt')
})

// ---------------------------------------------------------------------------
// 设置 / 注册 / registry
// ---------------------------------------------------------------------------

test('设置键名与默认值（RichCopySettings.java:15,18,20-21）', () => {
  assert.equal(RICH_COPY_STATE_NAME, 'EditorRichCopySettings')
  assert.equal(RICH_COPY_STORAGE, 'editor.rich.copy.xml')
  assert.equal(RICH_COPY_ACTIVE_SCHEME_MARKER, '__ACTIVE_GLOBAL_SCHEME__')
  assert.deepEqual(DEFAULT_RICH_COPY_SETTINGS, { enabled: true, schemeName: '__ACTIVE_GLOBAL_SCHEME__' })
})

test('颜色方案：标记/空 ⇒ 用当前方案（RichCopySettings:27-33）', () => {
  assert.equal(richCopyUsesActiveScheme({ enabled: true, schemeName: '__ACTIVE_GLOBAL_SCHEME__' }), true)
  assert.equal(richCopyUsesActiveScheme({ enabled: true, schemeName: '' }), true)
  assert.equal(richCopyUsesActiveScheme({ enabled: true, schemeName: 'Darcula' }), false)
})

test('注册出处（intellij.platform.lang.impl.xml:1488 / :1786）', () => {
  assert.equal(RICH_COPY_REGISTRATION.service, 'intellij.platform.lang.impl.xml:1488')
  assert.equal(RICH_COPY_REGISTRATION.settings, 'intellij.platform.lang.impl.xml:1786')
})

test('registry 上限 10MB（registry.properties:1221）', () => {
  assert.equal(RICH_COPY_MAX_SIZE_MB, 10)
})

// ---------------------------------------------------------------------------
// 动作可见性 / 触发
// ---------------------------------------------------------------------------

test('CopyAsRichText 只在富文本复制被关掉时可见（CopyAsRichTextAction:28-31）', () => {
  assert.equal(richCopyActionVisible({ settingsEnabled: true, hasSelection: true, fromActionToolbar: false, hasBackingFile: true }), false)
  assert.equal(richCopyActionVisible({ settingsEnabled: false, hasSelection: true, fromActionToolbar: false, hasBackingFile: true }), true)
  // 工具栏可无选区（:29 的 `fromActionToolbar ||`）
  assert.equal(richCopyActionVisible({ settingsEnabled: false, hasSelection: false, fromActionToolbar: true, hasBackingFile: true }), true)
  assert.equal(richCopyActionVisible({ settingsEnabled: false, hasSelection: false, fromActionToolbar: false, hasBackingFile: true }), false)
})

test('withRichCopyEnabled 临时打开再还原（CopyAsRichTextAction:39-49）', () => {
  const settings = { enabled: false, schemeName: '__ACTIVE_GLOBAL_SCHEME__' }
  let seen = null
  const result = withRichCopyEnabled(settings, () => { seen = settings.enabled; return 'copied' })
  assert.equal(seen, true)
  assert.equal(result, 'copied')
  assert.equal(settings.enabled, false)
})

test('上游未给这两个动作绑键位（10 个键位表 grep CopyAsRich 命中 0）', () => {
  assert.deepEqual(RICH_COPY_KEYMAP_ENTRIES, [])
})

// ---------------------------------------------------------------------------
// 文案 / 菜单挂载
// ---------------------------------------------------------------------------

test('动作文案逐字来自 ActionsBundle.properties:448-451', () => {
  assert.equal(RICH_COPY_LABELS.actionText, 'Copy as Rich Text')
  assert.equal(RICH_COPY_LABELS.actionDescription, 'Copy selection to clipboard as rich text (in RTF and HTML formats)')
  assert.equal(RICH_COPY_LABELS.plainActionText, 'Copy as Plain Text')
  assert.equal(RICH_COPY_LABELS.plainActionDescription, 'Copy selection to the clipboard as plain text')
})

test('设置文案逐字来自 ApplicationBundle.properties:624-628', () => {
  assert.equal(RICH_COPY_LABELS.settingsGroup, 'Rich-Text Copy')
  assert.equal(RICH_COPY_LABELS.settingsEnableLabel, 'Copy{0} as rich text')
  assert.equal(RICH_COPY_LABELS.settingsSchemeLabel, 'Color scheme for copied fragment:')
  assert.equal(RICH_COPY_LABELS.settingsSchemeActive, 'Active scheme')
})

test('菜单挂载点（LangActions.xml:100-108）', () => {
  assert.equal(RICH_COPY_MENU_ANCHORS.rich.after, '$Copy')
  assert.equal(RICH_COPY_MENU_ANCHORS.plain.after, 'CopyReference')
  assert.ok(RICH_COPY_MENU_ANCHORS.rich.groups.includes('EditorPopupMenu'))
})

// ---------------------------------------------------------------------------
// 接线适配层
// ---------------------------------------------------------------------------

test('StyledRun → RichCopyRun：rgb→#rrggbb、fontWeight>=600 算粗、italic（getComputedStyle 口径）', () => {
  assert.deepEqual(
    styledRunToRichCopyRun({ text: 'x', color: 'rgb(0, 0, 128)', fontStyle: 'normal', fontWeight: '700' }),
    { text: 'x', color: '#000080', bold: true, italic: false })
  assert.deepEqual(
    styledRunToRichCopyRun({ text: 'y', color: 'rgb(255, 0, 0)', fontStyle: 'italic', fontWeight: '400' }),
    { text: 'y', color: '#ff0000', bold: false, italic: true })
  // 默认色（等于背景/前景）不产生 color 字段
  assert.deepEqual(styledRunToRichCopyRun({ text: 'z', color: '', fontStyle: '', fontWeight: '' }),
    { text: 'z', bold: false, italic: false })
})

test('richCopyFromEditor 产出 HTML 片段 + 纯文本原文（TextWithMarkupProcessor 的等价物）', () => {
  const payload = richCopyFromEditor({
    text: '  int x\n',
    lines: [[
      { text: '  ', color: 'rgb(0,0,0)', fontStyle: '', fontWeight: '' },
      { text: 'int ', color: 'rgb(0, 0, 128)', fontStyle: '', fontWeight: '700' },
      { text: 'x', color: 'rgb(0,0,0)', fontStyle: '', fontWeight: '' },
    ], []],
    theme: { background: '#ffffff', foreground: '#000000', fontFamily: 'Cascadia Code', fontSize: 14 },
    tabSize: 4,
  })
  assert.equal(payload.plain, '  int x\n')
  assert.ok(payload.html.includes('<div style="background-color:#ffffff;color:#000000">'))
  assert.ok(payload.html.includes('<pre style="font-family:\'Cascadia Code\',monospace;font-size:14.0pt;">'))
  // 公共缩进被剥（默认开）
  assert.ok(payload.html.includes('<span style="color:#000080;font-weight:bold;">int&#32;</span>x<br>'))
  assert.ok(payload.html.endsWith('</pre></div></body></html>'))
})

test('richCopyFromEditor 不带行号（HtmlSyntaxInfoReader 无 gutter）', () => {
  const payload = richCopyFromEditor({
    text: 'a',
    lines: [[{ text: 'a', color: '', fontStyle: '', fontWeight: '' }]],
    theme: { background: '#ffffff', foreground: '#000000', fontFamily: 'mono', fontSize: 12 },
    tabSize: 4,
  })
  assert.ok(!payload.html.includes('class="ln"'))
  assert.ok(!/\b1\b/.test(payload.html.replace(/[^>]*>/g, '')))
})

test('richCopyEnabled 读 RichCopySettings.enabled（默认 true）', () => {
  assert.equal(richCopyEnabled(DEFAULT_RICH_COPY_SETTINGS), true)
  assert.equal(richCopyEnabled({ enabled: false, schemeName: '' }), false)
})

test('selectRenderedLines 把"视口渲染的行"对齐到"选区覆盖的行"', () => {
  // 视口从文档第 10 行开始渲染
  const rendered = [[{ t: '10' }], [{ t: '11' }], [{ t: '12' }], [{ t: '13' }]]
  assert.deepEqual(selectRenderedLines(rendered, 10, 11, 12), [[{ t: '11' }], [{ t: '12' }]])
  // 选区起点早于视口 ⇒ 夹到 0，不越界
  assert.deepEqual(selectRenderedLines(rendered, 10, 1, 10), [[{ t: '10' }]])
  // 越界末端被裁掉
  assert.deepEqual(selectRenderedLines(rendered, 10, 12, 99), [[{ t: '12' }], [{ t: '13' }]])
  // 起止倒置不产生负数长度
  assert.deepEqual(selectRenderedLines(rendered, 10, 12, 11), [[{ t: '12' }]])
})

// ---------------------------------------------------------------------------
// 剪贴板 flavor 组合（接线侧：src/editorClipboard.ts 的 copyFlavors）
// ---------------------------------------------------------------------------

test('copyFlavors：有 HTML 时同时给 text/plain + text/html（TextBlockTransferable:40-47）', () => {
  const plan = { text: 'x', from: 0, to: 1, selection: { anchor: 0, head: 1 }, fromEmptySelection: false }
  assert.deepEqual(copyFlavors(plan, '<html>x</html>'),
    [['text/plain', 'x'], ['text/html', '<html>x</html>']])
  // 没有 HTML（上游 RichCopySettings 关掉那一路）⇒ 退化成旧的单 flavor 行为
  assert.deepEqual(copyFlavors(plan, null), [['text/plain', 'x']])
})
