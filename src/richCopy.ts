// 带格式复制（IDEA 的 Rich-Text Copy）—— **纯逻辑**：从「文本 + 选区 + 语法着色」生成
// 剪贴板里的 HTML 片段。零 Vue、零 DOM（DOM 取色在 src/htmlExportDom.ts，本模块只吃结构化入参）。
//
// 对照源码（`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · `platform/lang-impl/src/com/intellij/openapi/editor/richcopy/TextWithMarkupProcessor.java:137-141`
//     `createResult`：剪贴板载荷 = `HtmlTransferableData` + `RtfTransferableData` 两条**额外**数据；
//     `:53-54` 富文本复制只在 `RichCopySettings.isEnabled()` 为真时生效（默认真）。
//   · `platform/platform-impl/src/com/intellij/codeInsight/editorActions/TextBlockTransferable.java:40-47`
//     这两条额外数据挂在纯文本之后，按 priority 降序排列 ⇒ 剪贴板同时有 纯文本 + HTML + RTF。
//   · `.../richcopy/view/HtmlTransferableData.java:11-12` HTML flavor 与 priority=200；
//     `.../view/RtfTransferableData.java:19-20` RTF flavor 与 priority=100；
//     `platform/platform-api/.../TextBlockTransferableData.java:13` PLAIN_TEXT_PRIORITY=0。
//   · `.../richcopy/view/HtmlSyntaxInfoReader.java` —— HTML 片段的**逐条生成规则**（本模块的主对照）：
//     `:105` `<html><head><meta http-equiv="content-type" content="text/html; charset=UTF-8"></head><body>`；
//     `:83-87` `<div style="background-color:<默认背景>;color:<默认前景>">`；
//     `:90-100` `<pre style="<font-family 规则><font-size 规则>">`；
//     `:69-72` 收尾 `</pre></div>` + `</body></html>`；
//     `:158-185` 只有与默认不同（前景/背景/字体族/粗/斜）才包 `<span style="...">`，顺序
//       前景 → 背景 → 粗 → 斜 → 字体族；
//     `:187-207` 转义：`<`→`&lt;` `>`→`&gt;` `&`→`&amp;` **空格→`&#32;`** 换行→`<br>` 制表→补到下一个制表位；
//     `:146-156` 颜色 `#rrggbb`（`platform/util/ui/src/com/intellij/util/ui/UIUtil.java:1317-1325` 两位补零小写）；
//     `:230-237` 超过 maxLength 就截断并补 `... truncated ...`。
//   · `.../richcopy/TextWithMarkupProcessor.java:188-222` `calcIndentSymbolsToStrip`：剥掉**公共**前导缩进；
//     开关是 `editor.richcopy.strip.indents`（`platform/util/resources/misc/registry.properties:1223` 默认 true）。
//   · `.../richcopy/SyntaxInfoBuilder.java:554-557` 字号换算：非 Mac 非 headless 时 `* 0.75 / defFontScale`；
//     `HtmlSyntaxInfoReader.java:109-115` Mac 上再 `* 0.75`。
//   · `.../richcopy/view/HtmlSyntaxInfoReader.java:38` 构造函数收 `tabSize`；剪贴板路径传
//     `EditorUtil.getTabSize(editor)`（`TextWithMarkupProcessor.java:139`）。
//   · `.../richcopy/settings/RichCopySettings.java:15,18,20-21` 设置：状态名 `EditorRichCopySettings`、
//     存储 `editor.rich.copy.xml`、`enabled` 默认 true、`schemeName` 默认 `__ACTIVE_GLOBAL_SCHEME__`。
//   · `.../richcopy/CopyAsRichTextAction.java:28-31,39-49` 菜单可见性：**只在富文本复制被关掉时**才出现
//     （点它 = 临时把 enabled 打开跑一次复制再还原）；`CopyAsPlainTextAction.java:28-31` 是强制纯文本那一档。
//   · 上游**没有**给这两个动作绑键位：`platform/platform-resources/src/keymaps/` 10 个键位表里
//     `grep CopyAsRich` 命中 0 —— 默认的 Ctrl+C 本身就带富文本（enabled 默认 true）。
//
// 本模块**不**产出 RTF（上游 `RtfTransferableData.java` 是另一套 Writer，本仓没有对应实现）：
// `richCopyFlavors()` 会把 RTF 的 flavor/优先级如实登记出来，但载荷里只有 纯文本 + HTML。
//
// 与 `src/htmlExport.ts` / `src/htmlExportDom.ts` 的关系（**明确**）：
//   · **不能**复用 `htmlDocument()`：那是"整篇可独立打开的导出文档"（`<style>` 块、行号 gutter、
//     `<h1>` 标题、`@media print`、index.html 层级），与本模块的"剪贴板片段"（内联样式、
//     `<html><head>…<body><div><pre>`、空格一律 `&#32;`、换行一律 `<br>`、**无行号**）不是同一种产物。
//   · **复用** `readStyledLines()`（`src/htmlExportDom.ts:40`）：它已经把编辑器渲染出来的每行读成
//     `{text,color,fontStyle,fontWeight}` 段，正是本模块的入参形状 —— 结构类型兼容，
//     调用方直接传进来即可（本模块不 import 它，从而保持零 Vue）。

// ---------------------------------------------------------------------------
// 设置（`RichCopySettings.java:15,18,20-21`；属性名见 `platform/platform-impl/resources/settings/ide-settings-model.json:5915-5933`）
// ---------------------------------------------------------------------------

/** `RichCopySettings.java:15` `@State(name = ...)`。 */
export const RICH_COPY_STATE_NAME = 'EditorRichCopySettings'
/** `RichCopySettings.java:15` `@Storage("editor.rich.copy.xml")`。 */
export const RICH_COPY_STORAGE = 'editor.rich.copy.xml'
/** `RichCopySettings.java:18,21` 默认 `schemeName` = "跟随当前方案"。 */
export const RICH_COPY_ACTIVE_SCHEME_MARKER = '__ACTIVE_GLOBAL_SCHEME__'

/** `RichCopySettings` 的持久化形态；字段名与 `ide-settings-model.json` 的 `properties[].name` 一致。 */
export interface RichCopySettingsState {
  /** 属性名 `enabled`（ide-settings-model.json:5920），默认 true（`RichCopySettings.java:20`）。 */
  enabled: boolean
  /** 属性名 `schemeName`（ide-settings-model.json:5926），默认 `__ACTIVE_GLOBAL_SCHEME__`。 */
  schemeName: string
}

export const DEFAULT_RICH_COPY_SETTINGS: RichCopySettingsState = {
  enabled: true,
  schemeName: RICH_COPY_ACTIVE_SCHEME_MARKER,
}

/** `RichCopySettings.getColorsScheme`（:27-33）：是标记（或空）就用编辑器当前方案，否则按名字取。 */
export function richCopyUsesActiveScheme(settings: RichCopySettingsState): boolean {
  return !settings.schemeName || settings.schemeName === RICH_COPY_ACTIVE_SCHEME_MARKER
}

/** 注册出处：`platform/lang-impl/resources/intellij.platform.lang.impl.xml:1488`（applicationService）、
 *  `:1786`（applicationSettings）。 */
export const RICH_COPY_REGISTRATION = {
  service: 'intellij.platform.lang.impl.xml:1488',
  settings: 'intellij.platform.lang.impl.xml:1786',
} as const

// ---------------------------------------------------------------------------
// Registry 键（`platform/util/resources/misc/registry.properties`）
// ---------------------------------------------------------------------------

/** `registry.properties:1221`：富文本复制内容上限（MB）。 */
export const RICH_COPY_MAX_SIZE_MB = 10
/** `registry.properties:1223`：剥掉公共前导缩进，默认 true。 */
export const RICH_COPY_STRIP_INDENTS_DEFAULT = true
/** `HtmlSyntaxInfoReader.java:234` 超限后补的串。 */
export const RICH_COPY_TRUNCATED_MARKER = '... truncated ...'

// ---------------------------------------------------------------------------
// 剪贴板 flavor 与优先级
// ---------------------------------------------------------------------------

export interface RichCopyFlavor {
  /** 上游 MIME（Java `DataFlavor` 的字符串形态）。 */
  mime: string
  /** 降序排序用的优先级。 */
  priority: number
  /** 本模块是否真的产出这一路。 */
  produced: boolean
  source: string
}

/** 按 priority 降序（`TextBlockTransferable.java:47` 的排序规则）。 */
export function richCopyFlavors(): RichCopyFlavor[] {
  return [
    { mime: 'text/html; class=java.io.Reader; charset=UTF-8', priority: 200, produced: true,
      source: 'HtmlTransferableData.java:11-12' },
    { mime: 'text/rtf;class=java.io.InputStream', priority: 100, produced: false,
      source: 'RtfTransferableData.java:19-20' },
    { mime: 'text/plain; charset=utf-8 (DataFlavor.stringFlavor / plainTextFlavor)', priority: 0, produced: true,
      source: 'TextBlockTransferable.java:40-42 + TextBlockTransferableData.java:13' },
  ].sort((a, b) => b.priority - a.priority)
}

// ---------------------------------------------------------------------------
// 缩进剥离（`TextWithMarkupProcessor.java:188-222` + `SyntaxInfoBuilder.java:641-687`）
// ---------------------------------------------------------------------------

/**
 * `calcIndentSymbolsToStrip`（:188-222）的核心：选区各行的**公共**前导空白宽度（按字符数，制表算 1）。
 * 纯空白行跳过（`:211-213`）；一旦算到 0 立即停（`:216-218`）。
 */
export function commonIndentWidth(lineTexts: readonly string[]): number {
  let maximum = Number.POSITIVE_INFINITY
  for (const text of lineTexts) {
    const match = /^[ \t]*/.exec(text)
    const width = match ? match[0]!.length : 0
    if (width >= text.length) continue // 空行 / 纯空白行
    maximum = Math.min(maximum, width)
    if (maximum === 0) break
  }
  return Number.isFinite(maximum) ? maximum : 0
}

/** `SyntaxInfoBuilder.java:663-670`：行首最多剥 `indent` 个空格/制表。 */
export function stripIndent(text: string, indent: number): string {
  let index = 0
  while (index < text.length && index < indent && (text[index] === ' ' || text[index] === '\t')) index++
  return text.slice(index)
}

// ---------------------------------------------------------------------------
// 入参形状（与 `src/htmlExportDom.ts` 的 `StyledRun` 结构兼容，故调用方无需转换类型）
// ---------------------------------------------------------------------------

export interface RichCopyRun {
  text: string
  /** 解析后的前景色 `#rrggbb`；空串 = 默认前景（不生成 color 规则）。 */
  color?: string
  /** 解析后的背景色 `#rrggbb`；空串/缺省 = 默认背景。 */
  background?: string
  bold?: boolean
  italic?: boolean
  /** 字体族；空串 = 默认字体族（不生成 font-family 规则）。 */
  fontFamily?: string
}

export type RichCopyLine = readonly RichCopyRun[]

export interface RichCopyHtmlOptions {
  /** 默认前景色 `#rrggbb`（上游 `SyntaxInfo.getDefaultForeground`）。 */
  defaultForeground: string
  /** 默认背景色 `#rrggbb`。 */
  defaultBackground: string
  /** 编辑器字体族；空串则 `<pre>` 不写 font-family 规则（`HtmlSyntaxInfoReader.java:91-98`）。 */
  fontFamily: string
  /** 已换算好的字号（pt），见 `richCopyFontSizePt`。 */
  fontSizePt: number
  /** 制表宽度（`TextWithMarkupProcessor.java:139` 传 `EditorUtil.getTabSize(editor)`）。 */
  tabSize: number
  /** 字体是否等宽 ⇒ `<pre>` 与 span 的 font-family 后补 `,monospace`（`HtmlSyntaxInfoReader.java:120-123`）。 */
  fontMonospace?: boolean
  /** 是否剥公共缩进（registry `editor.richcopy.strip.indents`，默认 true）。 */
  stripIndents?: boolean
  /** 输出缓冲上限；超了补 `... truncated ...`（`HtmlSyntaxInfoReader.java:230-237`）。 */
  maxLength?: number
}

// ---------------------------------------------------------------------------
// 字号换算
// ---------------------------------------------------------------------------

/**
 * `SyntaxInfoBuilder.java:554-557` + `HtmlSyntaxInfoReader.java:109-115`：
 * Mac 上 `* 0.75`；非 Mac 非 headless 再 `* 0.75 / defFontScale`。
 */
export function richCopyFontSizePt(
  editorFontSize: number,
  options: { isMac?: boolean; isHeadless?: boolean; defFontScale?: number } = {},
): number {
  const isMac = options.isMac ?? false
  const isHeadless = options.isHeadless ?? false
  const defFontScale = options.defFontScale ?? 1
  let size = editorFontSize
  if (!isMac && !isHeadless) size = (size * 0.75) / defFontScale
  if (isMac) size *= 0.75
  return size
}

/** `HtmlSyntaxInfoReader.java:114` `String.format("font-size:%.1fpt;", ...)` —— 一位小数。 */
export function formatFontSizePt(fontSizePt: number): string {
  return `${fontSizePt.toFixed(1)}pt`
}

// ---------------------------------------------------------------------------
// 转义与着色（`HtmlSyntaxInfoReader.java:187-207` / `:158-185`）
// ---------------------------------------------------------------------------

/** CSS 颜色（`rgb(r, g, b)` 或 `#rgb`/`#rrggbb`）→ `#rrggbb`；解析不了返回空串。 */
export function cssColorToHex(color: string): string {
  const text = (color ?? '').trim().toLowerCase()
  if (!text) return ''
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(text)
  if (rgb) return `#${hex2(Number(rgb[1]))}${hex2(Number(rgb[2]))}${hex2(Number(rgb[3]))}`
  const short = /^#([0-9a-f]{3})$/.exec(text)
  if (short) {
    const [r, g, b] = short[1]!.split('')
    return `#${r}${r}${g}${g}${b}${b}`
  }
  if (/^#[0-9a-f]{6}$/.test(text)) return text
  return ''
}

function hex2(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)))
  return clamped.toString(16).padStart(2, '0')
}

function sameColor(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '').toLowerCase() === (b ?? '').toLowerCase()
}

/**
 * `HtmlSyntaxInfoReader.escapeAndAdd`（:187-207）的逐字符规则。
 * 列号 `column` 由调用方维护并在返回时交回 —— 上游 `myCurrentColumn` 跨整段缓冲连续（只有换行重置）。
 * 注意上游 tab 分支的真实行为：补到下一个制表位后**又自增一次**（switch 末尾的 `myCurrentColumn++`
 * 对 tab 分支同样生效），这里照抄不"修正"。
 */
function escapeAndAdd(out: string[], text: string, tabSize: number, column: number): number {
  const width = tabSize > 0 ? tabSize : 1
  for (const char of text) {
    switch (char) {
      case '<': out.push('&lt;'); break
      case '>': out.push('&gt;'); break
      case '&': out.push('&amp;'); break
      case ' ': out.push('&#32;'); break
      case '\n': out.push('<br>'); column = -1; break
      case '\t': {
        const next = (Math.floor(column / width) + 1) * width
        for (; column < next; column++) out.push('&#32;')
        break
      }
      default: out.push(char)
    }
    column++
  }
  return column
}

/** `HtmlSyntaxInfoReader.java:117-124`：`font-family:'X'[,monospace];`。 */
function fontFamilyRule(fontFamily: string, monospace: boolean): string {
  return `font-family:'${fontFamily}'${monospace ? ',monospace' : ''};`
}

/**
 * `HtmlSyntaxInfoReader.handleText`（:158-185）：只有与默认不同的属性才写进 span，
 * 且顺序固定 前景 → 背景 → 粗 → 斜 → 字体族。
 *
 * 纯空白段**不写**前景/粗/斜/字体族，只写背景 —— 对应 `SyntaxInfoBuilder.Context.iterate`（:580-587）
 * 的 `whiteSpacesOnly` 分支：只 `processBackground`，跳过 `processForeground`/`FontFamilyName`/`FontStyle`。
 * 这条在 `NormalSelection.html` 里看得见：行首 `&#32;&#32;` 没有被包进 span，而 `int&#32;` 被包了。
 */
function runSpan(run: RichCopyRun, options: RichCopyHtmlOptions, monospace: boolean): string | null {
  const style: string[] = []
  const whitespaceOnly = run.text.length > 0 && !/\S/.test(run.text)
  const color = cssColorToHex(run.color ?? '')
  if (!whitespaceOnly && color && !sameColor(color, options.defaultForeground)) style.push(`color:${color};`)
  const background = cssColorToHex(run.background ?? '')
  if (background && !sameColor(background, options.defaultBackground)) style.push(`background-color:${background};`)
  if (!whitespaceOnly) {
    if (run.bold) style.push('font-weight:bold;')
    if (run.italic) style.push('font-style:italic;')
    const family = run.fontFamily ?? ''
    if (family && !sameColor(family, options.fontFamily)) style.push(fontFamilyRule(family, monospace))
  }
  return style.length ? `<span style="${style.join('')}">` : null
}

// ---------------------------------------------------------------------------
// HTML 片段
// ---------------------------------------------------------------------------

/** `HtmlSyntaxInfoReader.java:105`。 */
export const RICH_COPY_HTML_OPEN_BODY =
  '<html><head><meta http-equiv="content-type" content="text/html; charset=UTF-8"></head><body>'

/** 把某行开头的 `indent` 个空白字符从 runs 里剪掉（保持每段的颜色对齐）。 */
function stripLineRuns(line: RichCopyLine, indent: number): RichCopyRun[] {
  let left = indent
  const out: RichCopyRun[] = []
  for (const run of line) {
    if (left <= 0) { out.push(run); continue }
    let cut = 0
    while (cut < run.text.length && left > 0 && (run.text[cut] === ' ' || run.text[cut] === '\t')) { cut++; left-- }
    if (cut < run.text.length) out.push({ ...run, text: run.text.slice(cut) })
  }
  return out
}

/**
 * 生成剪贴板里的 HTML **片段**（`HtmlSyntaxInfoReader.build` :44-67 的产物形状）。
 * `lines` 的每段文本按 `\n` 连接后转义 —— 所以「选区末尾带换行」应当由调用方多传一个空行
 * （与 `NormalSelection.html` 末尾那个 `<br>` 一致）。
 */
export function richCopyHtmlFragment(lines: readonly RichCopyLine[], options: RichCopyHtmlOptions): string {
  const monospace = options.fontMonospace ?? true
  const strip = options.stripIndents ?? RICH_COPY_STRIP_INDENTS_DEFAULT
  const indent = strip ? commonIndentWidth(lines.map(line => line.map(run => run.text).join(''))) : 0
  const prepared = indent > 0 ? lines.map(line => stripLineRuns(line, indent)) : lines

  const out: string[] = []
  out.push(RICH_COPY_HTML_OPEN_BODY)
  // :83-87 背景色挂在 div 上（IDEA-295350，为了 Google Docs 里正确显示）
  out.push(`<div style="background-color:${options.defaultBackground};color:${options.defaultForeground}">`)
  // :90-100 `<pre>` 替代 `white-space:pre`（IDEA-316921）
  const preStyle = `${options.fontFamily ? fontFamilyRule(options.fontFamily, monospace) : ''}font-size:${formatFontSizePt(options.fontSizePt)};`
  out.push(`<pre style="${preStyle}">`)

  const maxLength = options.maxLength ?? Number.POSITIVE_INFINITY
  let column = 0
  let truncated = false
  let emitted = 0
  for (let index = 0; index < prepared.length; index++) {
    if (index > 0) {
      column = escapeAndAdd(out, '\n', options.tabSize, column)
      emitted += 4 // '<br>'
    }
    for (const run of prepared[index]!) {
      if (!run.text) continue
      // :230-237 超限即停并补截断标记（上游按"每条 output info 之前"检查缓冲长度）
      if (emitted > maxLength) { out.push(RICH_COPY_TRUNCATED_MARKER); truncated = true; break }
      const open = runSpan(run, options, monospace)
      if (open) {
        out.push(open)
        emitted += open.length
        column = escapeAndAdd(out, run.text, options.tabSize, column)
        out.push('</span>')
        emitted += 7
      } else {
        const before = out.length
        column = escapeAndAdd(out, run.text, options.tabSize, column)
        for (let i = before; i < out.length; i++) emitted += out[i]!.length
      }
    }
    if (truncated) break
  }

  // :69-72 收尾
  out.push('</pre></div>')
  // :75-77
  out.push('</body></html>')
  return out.join('')
}

// ---------------------------------------------------------------------------
// 剪贴板载荷
// ---------------------------------------------------------------------------

export interface RichCopyPayload {
  /** `DataFlavor.stringFlavor`：**原样**选区文本（不剥缩进 —— 上游 `myText` 就是选区原文）。 */
  plain: string
  /** HTML 片段。 */
  html: string
}

/**
 * `TextWithMarkupProcessor.collectTransferableData`（:53-134）+ `createResult`（:137-141）：
 * 纯文本是选区原文，HTML 是"剥了公共缩进 + 着色"的片段。
 */
export function buildRichCopyPayload(input: {
  text: string
  lines: readonly RichCopyLine[]
  options: RichCopyHtmlOptions
}): RichCopyPayload {
  return { plain: input.text, html: richCopyHtmlFragment(input.lines, input.options) }
}

// ---------------------------------------------------------------------------
// 动作可见性 / 键位（`CopyAsRichTextAction.java` / `CopyAsPlainTextAction.java`）
// ---------------------------------------------------------------------------

/** `CopyAsRichTextAction.isRichCopyPossible`（:51-54）：文档背后有真实文件才可能富文本复制。 */
export function isRichCopyPossible(hasBackingFile: boolean): boolean {
  return hasBackingFile
}

/**
 * `CopyAsRichTextAction.update`（:28-31）：菜单项**只在富文本复制被关掉时**才可见 ——
 * 它是"临时来一次"的入口，不是常驻项。
 */
export function richCopyActionVisible(input: {
  settingsEnabled: boolean
  hasSelection: boolean
  fromActionToolbar: boolean
  hasBackingFile: boolean
}): boolean {
  return !input.settingsEnabled
    && (input.fromActionToolbar || input.hasSelection)
    && (!input.hasBackingFile ? true : isRichCopyPossible(input.hasBackingFile))
}

/**
 * `CopyAsRichTextAction.actionPerformed`（:39-49）：临时把 enabled 打开，跑一次普通复制，再还原。
 * `run` 就是"普通复制"这一下（本仓 = `src/editorClipboard.ts` 的复制通道）。
 */
export function withRichCopyEnabled<T>(settings: RichCopySettingsState, run: () => T): T {
  const saved = settings.enabled
  try {
    settings.enabled = true
    return run()
  } finally {
    settings.enabled = saved
  }
}

/** 上游**没有**键位：10 个键位表里 `CopyAsRich` / `CopyAsPlain` 命中 0。普通 Ctrl+C 自带富文本。 */
export const RICH_COPY_KEYMAP_ENTRIES: readonly string[] = []

// ---------------------------------------------------------------------------
// 文案（`ActionsBundle.properties:448-451` / `ApplicationBundle.properties:624-628`）
// ---------------------------------------------------------------------------

export const RICH_COPY_LABELS = {
  /** ActionsBundle.properties:448。 */
  actionText: 'Copy as Rich Text',
  /** ActionsBundle.properties:449。 */
  actionDescription: 'Copy selection to clipboard as rich text (in RTF and HTML formats)',
  /** ActionsBundle.properties:450。 */
  plainActionText: 'Copy as Plain Text',
  /** ActionsBundle.properties:451。 */
  plainActionDescription: 'Copy selection to the clipboard as plain text',
  /** ApplicationBundle.properties:624。 */
  settingsGroup: 'Rich-Text Copy',
  /** ApplicationBundle.properties:625。 */
  settingsEnableLabel: 'Copy{0} as rich text',
  /** ApplicationBundle.properties:626。 */
  settingsEnableComment: 'All formatting will be copied, including font, colors and so on',
  /** ApplicationBundle.properties:627。 */
  settingsSchemeLabel: 'Color scheme for copied fragment:',
  /** ApplicationBundle.properties:628。 */
  settingsSchemeActive: 'Active scheme',
} as const

/** 菜单挂载点：`platform/platform-impl/resources/idea/LangActions.xml:100-107`。 */
export const RICH_COPY_MENU_ANCHORS = {
  rich: { groups: ['CutCopyPasteGroup', 'EditorPopupMenu'], after: '$Copy', source: 'LangActions.xml:100-103' },
  plain: { groups: ['CutCopyPasteGroup', 'Copy.Paste.Special'], after: 'CopyReference', source: 'LangActions.xml:105-108' },
} as const

// ---------------------------------------------------------------------------
// 接线适配层（纯函数，把宿主给的现成形状折成 `buildRichCopyPayload` 的入参）
// ---------------------------------------------------------------------------

/** `src/htmlExportDom.ts` 的 `StyledRun` 的**结构**形状（本模块不 import 它，保持零 Vue/DOM）。 */
export interface StyledRunLike {
  text: string
  color?: string
  fontStyle?: string
  fontWeight?: string
}

/** `src/appExportTheme.ts` 的 `ExportThemeTokens` 的结构形状。 */
export interface ExportThemeLike {
  background: string
  foreground: string
  fontFamily: string
  fontSize: number
}

/**
 * `StyledRun`（`color` 是 `getComputedStyle` 的 `rgb(...)`，`fontWeight` 是数字串）
 * → `RichCopyRun`（`#rrggbb` + 布尔）。字号/字体族的换算与取值见各自出处。
 *
 * `fontWeight` 的判定用「>= 600 算粗」（CSS 的 `bold` = 700；上游 `Font.BOLD` 是二值的，
 * 这里取浏览器会把 `bold` 报成 `"700"` 这一点）。
 */
export function styledRunToRichCopyRun(run: StyledRunLike): RichCopyRun {
  const color = cssColorToHex(run.color ?? '')
  const weight = Number.parseInt(run.fontWeight ?? '', 10)
  return {
    text: run.text,
    ...(color ? { color } : {}),
    bold: Number.isFinite(weight) ? weight >= 600 : (run.fontWeight ?? '') === 'bold',
    italic: (run.fontStyle ?? '') === 'italic',
  }
}

/**
 * 把「已渲染的每一行 + 主题」折成 HTML 片段 —— 宿主在 `copy` 事件里调用它，
 * 再把结果 `setData('text/html', …)`。**这就是 `TextWithMarkupProcessor.collectTransferableData`
 * 的等价物**：`:59-60` 取编辑器颜色方案（本仓 = `appExportTheme` 的三令牌）、
 * `:67-71` 剥公共缩进（默认开）、`:137-141` 产出 HTML。
 *
 * 行号**不带**：上游 `HtmlSyntaxInfoReader` 整篇没有行号 gutter（那属于整篇导出，
 * 见 `src/htmlExport.ts` 的 `htmlDocument` 的 `PRINT_LINE_NUMBERS`）。
 */
export function richCopyFromEditor(input: {
  /** 选区原文（`TextBlockTransferable` 的 `myText`，纯文本 flavor 用它）。 */
  text: string
  /** `readStyledLines(view)` 的返回值（每行是带颜色的段）。 */
  lines: readonly (readonly StyledRunLike[])[]
  /** `readExportThemeTokens(...)` 的返回值。 */
  theme: ExportThemeLike
  /** `view.state.tabSize`（`EditorUtil.getTabSize(editor)` 的等价物）。 */
  tabSize: number
  /** 字体是否等宽；缺省 true（本仓编辑器默认等宽字体 `--font-mono`）。 */
  fontMonospace?: boolean
  /** 是否剥缩进；缺省 true（registry `editor.richcopy.strip.indents`）。 */
  stripIndents?: boolean
  maxLength?: number
}): RichCopyPayload {
  return buildRichCopyPayload({
    text: input.text,
    lines: input.lines.map(line => line.map(styledRunToRichCopyRun)),
    options: {
      defaultForeground: cssColorToHex(input.theme.foreground) || '#000000',
      defaultBackground: cssColorToHex(input.theme.background) || '#ffffff',
      fontFamily: input.theme.fontFamily,
      // 上游 `SyntaxInfoBuilder:554-557` 的换算在浏览器里不成立（CSS 的 px 就是最终值），
      // 所以直接用编辑器字号；`HtmlSyntaxInfoReader:114` 的一位小数格式照旧。
      fontSizePt: input.theme.fontSize,
      tabSize: input.tabSize,
      fontMonospace: input.fontMonospace ?? true,
      stripIndents: input.stripIndents ?? RICH_COPY_STRIP_INDENTS_DEFAULT,
      maxLength: input.maxLength,
    },
  })
}

/** `RichCopySettings.java:20` 的默认开关值，宿主判断「普通复制要不要带 HTML」时用。 */
export function richCopyEnabled(settings: RichCopySettingsState): boolean {
  return settings.enabled
}

/**
 * 从「已渲染的行」里切出选区覆盖的那几行。
 *
 * 为什么需要：`readStyledLines(view)`（`src/htmlExportDom.ts:40`）读的是**视口内**已渲染的
 * `.cm-line`（CodeMirror 虚拟渲染），返回的数组下标 0 不一定是文档第 1 行。而
 * `richCopyFromEditor` 的 `lines` 必须与 `text` 是同一段 —— 否则 HTML 里会混进没选中的行。
 *
 * @param lines            `readStyledLines(view)` 的返回值
 * @param firstLineNumber  第 0 个元素对应的**文档行号**（1 起）
 * @param startLine/endLine 选区覆盖的文档行号（含两端）
 */
export function selectRenderedLines<T>(
  lines: readonly (readonly T[])[],
  firstLineNumber: number,
  startLine: number,
  endLine: number,
): readonly (readonly T[])[] {
  const from = Math.max(0, startLine - firstLineNumber)
  const last = Math.max(startLine, endLine)
  const to = Math.max(from, last - firstLineNumber + 1)
  return lines.slice(from, to)
}
