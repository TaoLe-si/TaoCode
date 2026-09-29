// 粘贴时的缩进 / 重新格式化 —— IDEA `CodeInsightSettings.REFORMAT_ON_PASTE` 的对应物。
//
// 逐条对照的源码（`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · 设置本身 `platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java`
//       - `:143-148`：`REFORMAT_ON_PASTE` 取值 `NO_REFORMAT=1 / INDENT_BLOCK=2 / INDENT_EACH_LINE=3 /
//         REFORMAT_BLOCK=4`，**默认 `INDENT_EACH_LINE`**（`:144`）
//       - `:36`：持久化在 `editor.xml` —— 所以 TaoCode 把它放进 `editorSettings`（对应 `ide.editor.xml`）
//   · 设置行 `platform/lang-impl/src/com/intellij/application/options/editor/EditorSmartKeysConfigurable.kt:185-197`
//       （四个选项一行 combo，位于 编辑器 › 常规 › 智能键）
//   · 消费点 `platform/lang-impl/src/com/intellij/codeInsight/editorActions/PasteHandler.java`
//       - `:205-219`：`blockIndentAnchorColumn` = 光标的**逻辑列**；有选区且光标在选区内时取选区起点列
//       - `:247`：粘贴前的预处理器改了文本 ⇒ 升级成 `REFORMAT_BLOCK`
//       - `:255-257`：**语言没有格式化器时强制 `INDENT_BLOCK`**（不是"什么都不做"）
//       - `:288-302`：插入后按 `howtoReformat` 调 `typingActionsExtension.format(...)`
//   · 实际动作 `platform/lang-impl/src/com/intellij/codeInsight/editorActions/DefaultTypingActionsExtension.java`
//       - `:118-124` 分派：INDENT_BLOCK→`indentBlock`、INDENT_EACH_LINE→`indentEachLine`、
//         REFORMAT_BLOCK→（先 `indentEachLine` 再）`reformatRange`
//       - `:197-213` `indentEachLine` → `adjustLineIndent`（走 CodeStyle，逐行调缩进）
//       - `:215-236` `indentPlainTextBlock`（**纯文本**路径：没有格式化器时走这支）
//       - `:412-421` `indentLines`：在指定行的行首插入缩进串
//
// TaoCode 的对接方式（如实）：
//   · `INDENT_EACH_LINE` / `REFORMAT_BLOCK` 在 IDEA 里都落到 CodeStyle 格式化器 → 对应 LSP 的
//     `textDocument/rangeFormatting`（只格式化刚粘贴的那一段），能力已在本仓实现（`lsp.request` 的
//     `rangeFormatting`）。**没有近似**：IDEA 这两档同样是把范围交给语言格式化器。
//   · `INDENT_BLOCK` 在**有**格式化器时走 `indentBlockWithFormatter`（:237-350 的"先调首行、再把
//     首行缩进差量套到后续行"算法，约 110 行，依赖 PSI 的行内块结构）；TaoCode 用 `rangeFormatting`
//     覆盖**同一档**（两者都要求"让语言决定这一段的缩进"），差异是 IDEA 会保留粘贴块内部的相对缩进 ——
//     这一条登记在 `docs/class-parity-todo.md` §9 #5 的待办里，不在此处假装复刻。
//   · 没有格式化器（无语言服务）时走 `indentPlainTextBlock` —— 这支是**纯文本**运算，逐句复刻在下面。

/** `CodeInsightSettings.NO_REFORMAT = 1`（`:145`）。 */
export const PASTE_REFORMAT_NONE = 'none'
/** `CodeInsightSettings.INDENT_BLOCK = 2`（`:146`）。 */
export const PASTE_INDENT_BLOCK = 'indentBlock'
/** `CodeInsightSettings.INDENT_EACH_LINE = 3`（`:147`）。 */
export const PASTE_INDENT_EACH_LINE = 'indentEachLine'
/** `CodeInsightSettings.REFORMAT_BLOCK = 4`（`:148`）。 */
export const PASTE_REFORMAT_BLOCK = 'reformatBlock'

export type PasteReformatMode = 'none' | 'indentBlock' | 'indentEachLine' | 'reformatBlock'

/** `REFORMAT_ON_PASTE = INDENT_EACH_LINE`（`CodeInsightSettings.java:144`）。 */
export const PASTE_REFORMAT_DEFAULT: PasteReformatMode = PASTE_INDENT_EACH_LINE

/** 设置行里的选项顺序 = `EditorSmartKeysConfigurable.kt:186-188`。 */
export const PASTE_REFORMAT_MODES: readonly PasteReformatMode[] =
  [PASTE_REFORMAT_NONE, PASTE_INDENT_BLOCK, PASTE_INDENT_EACH_LINE, PASTE_REFORMAT_BLOCK]

/** `ApplicationBundle` 的 `combobox.paste.reformat.*` 四条文案（中文对照，语义一致）。 */
export function pasteReformatLabel(mode: PasteReformatMode): string {
  switch (mode) {
    case PASTE_REFORMAT_NONE: return '不重新格式化'
    case PASTE_INDENT_BLOCK: return '粘贴时缩进整块'
    case PASTE_INDENT_EACH_LINE: return '粘贴时逐行缩进'
    case PASTE_REFORMAT_BLOCK: return '粘贴时重新格式化整块'
  }
}

/** 原生设置里存的是字符串，读回来先过这一关（不认识的值退回默认）。 */
export function isPasteReformatMode(value: unknown): value is PasteReformatMode {
  return typeof value === 'string' && (PASTE_REFORMAT_MODES as readonly string[]).includes(value)
}

/** 插入后要对刚粘贴的那一段做什么。`formatRange` = 交给 LSP `rangeFormatting`。 */
export type PasteReformatAction = 'none' | 'plainIndent' | 'formatRange'

/**
 * `PasteHandler.java:247-257` 的分派：先按"没有语言服务就强制 INDENT_BLOCK"改写生效档位，
 * 再决定这一段交给谁。`hasFormatter` = 该文件当前有可用的语言服务。
 */
export function pasteReformatAction(mode: PasteReformatMode, hasFormatter: boolean): PasteReformatAction {
  const effective = !hasFormatter && mode !== PASTE_REFORMAT_NONE ? PASTE_INDENT_BLOCK : mode
  if (effective === PASTE_REFORMAT_NONE) return 'none'
  // 有格式化器 → 交给 rangeFormatting；没有 → 只剩 INDENT_BLOCK 的纯文本路径可走
  //（`indentBlock` 的 `LanguageFormatting == null` 分支，:180-193）。
  return hasFormatter ? 'formatRange' : 'plainIndent'
}

/**
 * `indentPlainTextBlock`（`DefaultTypingActionsExtension.java:215-236`）+ `indentLines`（:412-421）
 * 的逐句复刻，作用在**刚插入的文本**上（宿主没有 Document，所以把"插入后的文档"折叠成三个入参）：
 *
 * @param pasted           要粘贴的文本
 * @param anchorColumn     光标逻辑列（`blockIndentAnchorColumn`，IDEA `PasteHandler.java:212-219`）
 * @param caretLineIsLast  光标所在行是不是文档最后一行（源码 `startLine >= lineCount - 1` 那一档）
 */
export function indentPlainTextBlock(pasted: string, anchorColumn: number, caretLineIsLast: boolean): string {
  // `if (spaceEnd > endOffset ...) return` —— 整段都是空白时不处理
  if (!pasted || /^[ \t]*$/.test(pasted)) return pasted
  // `indentLevel <= 0`：光标在第 0 列，缩进量是 0，什么也不做
  if (anchorColumn <= 0) return pasted
  // `startLine >= document.getLineCount() - 1`
  if (caretLineIsLast) return pasted
  const lines = pasted.split('\n')
  // `chars.charAt(spaceEnd) == '\n'` —— 粘贴块的第一行只有空白，源码此时放弃整块缩进
  if (/^[ \t]*$/.test(lines[0]!)) return pasted
  // `endLine` = 首个"行首偏移 >= endOffset"的行；粘到换行符结尾时那一行是空行，不计入
  const endLine = pasted.endsWith('\n') ? lines.length - 1 : lines.length
  const indent = ' '.repeat(anchorColumn)
  // `indentLines(document, startLine + 1, endLine - 1, indentString)` —— 首行不动
  return lines.map((line, index) => (index >= 1 && index <= endLine - 1 ? indent + line : line)).join('\n')
}
