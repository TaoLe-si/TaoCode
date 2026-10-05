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
//   · `UnwrapDescriptor` 的多候选选择弹层与语言专属 Unwrapper；PSI 合法性校验。
// 拒绝的情形返回 null，命令层据此返回 false（按键落回浏览器默认行为，不吞键）。
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
