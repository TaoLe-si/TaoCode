// Unwrap/Remove（上游 `platform/lang-impl/src/com/intellij/codeInsight/unwrap/`：
// `UnwrapAction` 在 Code 菜单里，键位 Ctrl+Shift+Delete 见 `$default.xml:917-920`；
// 候选来自语言侧 `UnwrapDescriptor`/`Unwrapper`，在 PSI 上判定）。
//
// 本仓没有 PSI（lp/psi 族判 `[-]`），所以在**文本层**实现真子集：只处理
// 「控制流头 + 花括号块」这一种最常用的包裹，把头和括号一起去掉、正文回缩一层：
//
//   if (ready) {          →    doWork()
//       doWork()               done = true
//       done = true
//   }
//
// 支持的头部：if / else / for / while / do / switch / try / catch / finally / synchronized。
// **明确不做**（上游有、本子集没有）：
//   · `try … catch … finally` 与 `do … while` 的整链拆解 —— 去掉头会产生孤立子句，所以直接拒绝；
//   · lambda / 匿名类（`() -> { … })`：块后面还挂着 `)`，文本层去掉括号会把表达式拆坏，拒绝；
//   · `UnwrapDescriptor` 的语言专属 Unwrapper（lambda / 泛型参数 / 括号表达式这些层拆不了）；
//     PSI 合法性校验。
// 拒绝的情形返回 null，命令层据此返回 false（按键落回浏览器默认行为，不吞键）。
//
// 2026-10-06（桶 1 / A6）：多候选的 **chooser 形状与判据**落在本文件末尾一节
// （`UNWRAP_CHOOSER_TITLE` / `unwrapChooserItems()` / `unwrapChooserNeeded()` /
// `createUnwrapApplyCommand()`）。弹层本体与键位挂载在 `src/editorCommands.ts` 与
// `src/components/CodeEditor.vue`（都不在本片可改面）⇒ 交出接线请求
// `docs/wiring-requests-2026-10-06-format.md` W2。
// 两处如实差异：① 上游**只要有一条候选也弹层**（`UnwrapHandler.java:80-91` +
// `UnwrapDescriptorBase.java:67-69`），本仓现状是直接拆最内层；② 上游的行文本是
// `unwrap.if=Unwrap 'if...'` 这一族（`CodeInsightBundle.properties:53-61`，逐条由
// `JavaIfUnwrapper.java:28`、`JavaBracesUnwrapper.java:18` 等取键），本仓的
// 「拆掉 if 包裹」是上一轮定的既有口径、被 `tests/unwrap-candidates.test.mjs:22` 钉住，
// 本片不放松那条断言 ⇒ 只登记差异，不改标签。
import type { Command } from '@codemirror/view'

export interface UnwrapEdit {
  /** 替换区间（含头部与两侧花括号）。 */
  from: number
  to: number
  /** 替换文本（回缩一层的正文）。 */
  insert: string
}

/**
 * 编辑器命令：拆掉光标/选区最内层的可拆包裹。返回 false 表示这一处没有可拆的
 * （按键落回默认行为）。`indentWidth` 是回缩宽度（编辑器设置的 tabSize）。
 */
export function createUnwrapCommand(indentWidth: number): Command {
  return view => {
    const range = view.state.selection.main
    const edit = findUnwrapEdit(view.state.doc.toString(), range.from, range.to, indentWidth)
    if (!edit) return false
    view.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      selection: { anchor: edit.from + edit.insert.length },
      scrollIntoView: true,
      userEvent: 'delete.unwrap',
    })
    return true
  }
}

/** 默认宽度 4（编辑器设置未接通时的兜底；接通的路径见 CodeEditor 的 editorActions）。 */
export const unwrapCommand: Command = createUnwrapCommand(4)

const CONTROL_KEYWORD = /^(?:if|else|for|while|do|switch|try|catch|finally|synchronized)\b/

/** 从 `open`（`{` 下标）找匹配的 `}`，跳过字符串、行注释与块注释里的括号。返回闭括号下标或 -1。 */
export function matchBrace(text: string, open: number): number {
  let depth = 0
  let quote = ''
  for (let index = open; index < text.length; ++index) {
    const char = text[index]!
    if (quote) {
      if (char === '\\') ++index
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue }
    if (char === '/' && text[index + 1] === '/') { const nl = text.indexOf('\n', index); if (nl < 0) break; index = nl; continue }
    if (char === '/' && text[index + 1] === '*') { const end = text.indexOf('*/', index + 2); if (end < 0) break; index = end + 1; continue }
    if (char === '{') ++depth
    else if (char === '}' && --depth === 0) return index
  }
  return -1
}

/** 去掉正文每行最多一个缩进单位（行首是 `\t` 就去一个制表符，否则最多 `indentWidth` 个空格）。 */
export function dedentBlock(body: string, indentWidth: number): string {
  return body.split('\n').map(line => {
    const match = /^[ \t]*/.exec(line)![0]
    if (match.startsWith('\t')) return line.slice(1)
    let remove = 0
    while (remove < match.length && remove < indentWidth && match[remove] === ' ') ++remove
    return line.slice(remove)
  }).join('\n')
}

/** 控制流头的起点：从 `{` 所在行的行首起向上吸收换行续写的行（上一行以 `(`/`,`/`&&`/`||` 收尾）。 */
function headerWindowStart(text: string, open: number): number {
  const lineStart = text.lastIndexOf('\n', Math.max(0, open - 1)) + 1
  let start = lineStart
  for (let guard = 0; guard < 40; ++guard) {
    if (start === 0) break
    const previousEnd = start - 1
    const previousStart = text.lastIndexOf('\n', Math.max(0, previousEnd - 1)) + 1
    const previous = text.slice(previousStart, previousEnd).trimEnd()
    if (!previous || !/(?:[(,]|&&|\|\||[+?:])$/.test(previous)) break
    start = previousStart
  }
  return start
}

/** 从窗口起点正向扫到 `{`，返回最后一个语句边界（深度 0 的 `;`/`{`/`}`）之后的位置。 */
function headerStart(text: string, windowStart: number, open: number): number {
  let depth = 0
  let quote = ''
  let boundary = windowStart
  for (let index = windowStart; index < open; ++index) {
    const char = text[index]!
    if (quote) {
      if (char === '\\') ++index
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue }
    if (char === '/' && text[index + 1] === '/') { const nl = text.indexOf('\n', index); if (nl < 0 || nl > open) break; index = nl; continue }
    if (char === '/' && text[index + 1] === '*') { const end = text.indexOf('*/', index + 2); if (end < 0 || end > open) break; index = end + 1; continue }
    if (char === '(') ++depth
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && (char === ';' || char === '{' || char === '}')) boundary = index + 1
  }
  // 边界后的空格不属于头部（否则 `} else {` 会留下一个前导空格），制表符/空格跳过即可。
  while (boundary < open && (text[boundary] === ' ' || text[boundary] === '\t')) ++boundary
  return boundary
}

function build(text: string, open: number, close: number, indentWidth: number): UnwrapEdit | null {
  let from = headerStart(text, headerWindowStart(text, open), open)
  // 头是行首第一个 token 时把行首缩进也换掉，避免留下「只有空格的一行」；
  // 头跟在 `}` 之后（`} else {`）时保留前面的内容，只从关键字起换。
  const lineStart = text.lastIndexOf('\n', Math.max(0, from - 1)) + 1
  if (/^[ \t]*$/.test(text.slice(lineStart, from))) from = lineStart
  const header = text.slice(from, open).trim()
  if (!CONTROL_KEYWORD.test(header)) return null
  // do { … } while：去掉 do 头后 while 变成孤立语句；try { … } catch：同理，直接拒绝。
  const tail = text.slice(close + 1, close + 40)
  if (/^\s*(?:catch|finally)\b/.test(tail) || /^(?:do)\b/.test(header) && /^\s*while\b/.test(tail)) return null
  const body = text.slice(open + 1, close)
  // 单行块（`if (x) { doWork() }`）直接取 trim 后的正文，多行块才逐行回缩。
  if (!body.includes('\n')) return { from, to: close + 1, insert: body.trim() }
  let insert = dedentBlock(body, indentWidth).replace(/[ \t]+$/, '')
  // 拆完整条独占行的语句时把行首换行也去掉（头所在的那行已经被替换），并吃掉闭括号后的
  // 换行 —— 否则拆完会在正文前或闭括号前多出一个空行。
  if (from === lineStart) insert = insert.replace(/^\n/, '')
  return { from, to: text[close + 1] === '\n' ? close + 2 : close + 1, insert }
}

/**
 * 找出 [from,to] **所有**可拆解的包裹块（最内层在前）—— 上游 `UnwrapDescriptor.collectUnwrappers`
 * 会给出多个候选、由用户选一层；本仓没有 PSI 级 chooser，命令层可以用这个列表做弹层。
 * 每一层带 `keyword`（if/for/while…）与菜单标题。
 */
export interface UnwrapCandidate {
  edit: UnwrapEdit
  keyword: string
  label: string
}

function keywordOf(text: string, edit: UnwrapEdit): string {
  const header = text.slice(edit.from, edit.from + 80)
  const match = /^\s*([A-Za-z]+)/.exec(header)
  return match ? match[1] : ''
}

export function findUnwrapCandidates(text: string, from: number, to: number, indentWidth: number): UnwrapCandidate[] {
  const start = Math.max(0, Math.min(from, to))
  const end = Math.min(text.length, Math.max(from, to))
  const out: UnwrapCandidate[] = []
  let open = text.lastIndexOf('{', start)
  while (open >= 0) {
    const close = matchBrace(text, open)
    if (close > open && close >= end) {
      const edit = build(text, open, close, indentWidth)
      if (edit) {
        const keyword = keywordOf(text, edit)
        out.push({ edit, keyword, label: keyword ? `拆掉 ${keyword} 包裹` : '拆掉这层包裹' })
      }
    }
    open = text.lastIndexOf('{', open - 1)
  }
  return out
}

/**
 * 找出 [from,to] 最内层可拆解的包裹块。`indentWidth` 用编辑器设置（回缩宽度）。
 * 找不到、或拆掉会破坏语法（try 头后面跟着 catch/finally、do 后面跟 while）时返回 null。
 */
export function findUnwrapEdit(text: string, from: number, to: number, indentWidth: number): UnwrapEdit | null {
  const candidates = findUnwrapCandidates(text, from, to, indentWidth)
  return candidates.length ? candidates[0].edit : null
}

/* ── 多候选的 chooser：候选形状与判据（桶 1 / A6 的模块侧）────────────────────── */

/**
 * 弹层标题。上游 `UnwrapHandler.java:101` 取 `CodeInsightBundle.message("unwrap.popup.title")`
 * （`platform/lang-api/resources/messages/CodeInsightBundle.properties:52`
 * = `Choose the statement to unwrap/remove`）；中文包不在本地树 ⇒ 按英文原文直译，助记符按本仓惯例去掉。
 */
export const UNWRAP_CHOOSER_TITLE = '选择要拆掉/移除的语句'

/**
 * 弹层里的一行（上游 `UnwrapHandler.showPopup` 的 `MyItem(name, index)`，`:125`）：
 * `index` 是候选在原列表里的下标（`:107` 的 `setItemChosenCallback` 就按下标找回动作本体），
 * `from`/`to` 是这一层覆盖的区间 —— 上游选中时用 `ScopeHighlighter` 高亮那一层的作用域
 * （`:108` 的 `setItemSelectedCallback`），本仓把区间交给宿主去选/画。
 */
export interface UnwrapChooserItem {
  index: number
  label: string
  keyword: string
  from: number
  to: number
}

/** 候选 → 弹层行（次序不变：最内层在前，与上游 `UnwrapDescriptorBase.collectUnwrappers` 由内向外走父链同向）。 */
export function unwrapChooserItems(candidates: readonly UnwrapCandidate[]): UnwrapChooserItem[] {
  return candidates.map((candidate, index) => ({
    index, label: candidate.label, keyword: candidate.keyword, from: candidate.edit.from, to: candidate.edit.to,
  }))
}

/**
 * 要不要弹层。上游 `UnwrapHandler.java:80-91`：列表**非空就弹**（`showOptionsDialog()` 恒真，
 * `UnwrapDescriptorBase.java:67-69`；只有单元测试模式才直接 `options.get(0).perform()`），
 * 空列表才什么都不做。
 * ⚠ 本仓现状是「只有一条时直接拆最内层」（`src/editorCommands.ts:233` 挂的 `unwrapCommand`），
 * 与上游不同 —— 改不改由宿主那条线决定，见 `docs/wiring-requests-2026-10-06-format.md` W2。
 */
export function unwrapChooserNeeded(candidates: readonly UnwrapCandidate[]): boolean {
  return candidates.length > 0
}

/**
 * 这一条编辑在当前文本上还站得住吗：区间末尾仍是那对花括号（拆完的 `insert` 不含闭括号）。
 * 上游拿的是活的 `PsiElement`（`:107` 选中后现场 `unwrap`），本仓没有 PSI，弹层期间文档
 * 若被别处改动，偏移就会指到别的地方 ⇒ 落笔前按偏移回验一次，站不住就当没这条命令。
 */
export function unwrapEditIntact(text: string, edit: UnwrapEdit): boolean {
  if (edit.from < 0 || edit.to > text.length || edit.to <= edit.from) return false
  return text.slice(Math.max(0, edit.to - 2), edit.to).includes('}')
}

/**
 * 应用**选中的那一条**候选（上游 `MyUnwrapAction.perform()`，`UnwrapHandler.java:153-171`）。
 * 位移、光标与 `userEvent` 与 `createUnwrapCommand()` 走同一条 dispatch，
 * 区别只是编辑由 chooser 决定而不是默认的最内层。
 */
export function createUnwrapApplyCommand(edit: UnwrapEdit): Command {
  return view => {
    if (!unwrapEditIntact(view.state.doc.toString(), edit)) return false
    view.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      selection: { anchor: edit.from + edit.insert.length },
      scrollIntoView: true,
      userEvent: 'delete.unwrap',
    })
    return true
  }
}
