// LSP **Snippet** 条目（`CompletionItem.insertTextFormat = 2`）在本仓的落点。
//
// 上游坐标（读源码的结论）：
//   · `platform/lsp-impl/src/impl/features/completion/LspCompletionItemInsertHandler.kt:50-60`
//     `handleSnippetFormat`：先把插入区间清空，再 `TemplateManager.runTemplate(...)` ——
//     即 **snippet 变成实时模板**（live template），不是把占位符当字面量插进去。
//   · 同文件 `:63-171` `SnippetToTemplateConverter`：用正则
//     `"\\$\\{(\\d+):?([^{^}]*)}|\\$(\\d+)"`（`:175`）解析变量，`$0` → `$END$`（`:89-92`），
//     `${n}` 带默认值是 `Variable(name, ConstantNode(default))`（`:143-150`），
//     没声明默认值就自己补一个 `$END$` 收尾（`:75-81`）。
//   · `$TM_*` 变量在插入那一刻求值（`:180-191` 的 `LSP_VARIABLE_TRANSFORMATIONS`）；
//     `$TM_CURRENT_WORD` / `$TM_SELECTED_TEXT` 上游**也做不到**（`:193-199` 的注释：运行时
//     文档里前缀已被删、选区已被清），于是它们留在模板里当普通文本 —— 这里照抄这个行为。
//
// 本仓的等价物：CodeMirror 的 snippet 引擎（`@codemirror/autocomplete` 的 `Snippet.parse`）。
// 它同样支持 `${n:默认}`、`${n}` 与 `${0}`（末位光标），按 Tab 在字段间跳 —— 与上游
// `TemplateManager.runTemplate` 的「实时模板 + Tab 切换」是同一套用户可见行为。
// **一处做不到**：上游的 `${1|a,b,c|}`（候选值）会变成一个带 `withLookupStrings` 的变量，
// 模板里按下会弹候选列表；CodeMirror 的 snippet 只有「文本默认值」，没有候选字段。
// 这里取**第一个候选**当默认值（`SnippetToTemplateConverter.kt:143-144` 同样先问默认值），
// 其余候选丢弃 —— 少给候选，不插入错代码。
import type { EditorState } from '@codemirror/state'

/** 插入那一刻可求值的上下文（对应上游 `LSP_VARIABLE_TRANSFORMATIONS` 需要的编辑器/文件信息）。 */
export interface SnippetContext {
  /** `$TM_CURRENT_LINE`：光标所在整行（`LspCompletionItemInsertHandler.kt:202-206`）。 */
  lineText: string
  /** `$TM_LINE_INDEX`：0 基行号。 */
  lineIndex: number
  /** `$TM_FILENAME`。 */
  filename: string
  /** `$TM_FILENAME_BASE`：去掉扩展名。 */
  filenameBase: string
  /** `$TM_DIRECTORY`：路径里最后一段 `/` 之前的部分。 */
  directory: string
  /** `$TM_FILEPATH`：标签页的路径（上游给的是绝对路径，本仓没有绝对路径通道）。 */
  path: string
}

export function snippetContextOf(state: EditorState, offset: number, path: string): SnippetContext {
  const line = state.doc.lineAt(offset)
  const slash = path.lastIndexOf('/')
  const name = path.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  return {
    lineText: line.text,
    lineIndex: line.number - 1,
    filename: name,
    filenameBase: dot > 0 ? name.slice(0, dot) : name,
    directory: slash < 0 ? '' : path.slice(0, slash),
    path,
  }
}

/** 上游的正则逐字照抄（`LspCompletionItemInsertHandler.kt:175`），外加一个全局 flag。 */
const VARIABLE = /\$\{(\d+):?([^{^}]*)}|\$(\d+)/g
/** `${1|a,b,c|}` 的候选体（上游 `:143-144` 认 `|…|` 首尾）。 */
const CHOICES = /^\|(.*)\|$/

/**
 * `$TM_*` 变换（上游 `LspItemInsertHandler.kt:180-191` 的同一张表）。
 * 未知变量（`$TM_CURRENT_WORD` / `$TM_SELECTED_TEXT`）**不替换** —— 与上游一致，它们留在文本里。
 */
function expandVariable(body: string, context: SnippetContext): string {
  switch (body) {
    case '$TM_CURRENT_LINE': return context.lineText
    case '$TM_LINE_INDEX': return String(context.lineIndex)
    case '$TM_LINE_NUMBER': return String(context.lineIndex + 1)
    case '$TM_FILENAME': return context.filename
    case '$TM_FILENAME_BASE': return context.filenameBase
    case '$TM_DIRECTORY': return context.directory
    case '$TM_FILEPATH': return context.path
    default: return body
  }
}

/** 字面文本里的花括号要转义：CodeMirror 的模板把 `${…}` 当字段（`Snippet.parse` 的 `[#$]\{`）。 */
function escapeLiteral(text: string): string {
  return text.replace(/[{}]/g, '\\$&')
}

/**
 * LSP snippet → CodeMirror 模板。`${0}` 是末位光标（CodeMirror 把它排在所有字段之后），
 * 其余字段按序号排 —— 与上游 `TemplateManager` 的变量顺序一致。
 */
export function lspSnippetTemplate(snippet: string, context: SnippetContext): string {
  let output = ''
  let consumed = 0
  VARIABLE.lastIndex = 0
  for (let match = VARIABLE.exec(snippet); match; match = VARIABLE.exec(snippet)) {
    output += escapeLiteral(snippet.slice(consumed, match.index))
    const index = match[1] ?? match[3] ?? ''
    const body = expandVariable(match[2] ?? '', context)
    const choices = CHOICES.exec(body)
    const value = choices ? choices[1]!.split(',')[0] ?? '' : body
    output += index === '0' ? '${0}' : '${' + index + ':' + escapeLiteral(value) + '}'
    consumed = match.index + match[0].length
  }
  return output + escapeLiteral(snippet.slice(consumed))
}

/**
 * 弹层里该显示的名字（上游 `SnippetToTemplateConverter.computeEffectiveLookup`，`:100-102`）：
 * 去掉变量，只留字面文本 —— 免得弹层上写着 `for (${1:i} = 0; ...)`。
 */
export function snippetEffectiveLabel(snippet: string): string {
  return snippet.replace(VARIABLE, '').replace(/\s+/g, ' ').trim()
}
