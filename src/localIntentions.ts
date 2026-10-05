// 本地意图条目 —— 把 `src/suppressIntention.ts` 的抑制规则做成 Alt+Enter 列表里**真正可应用**的
// 条目（上游 `SuppressIntentionAction` 一族：`ShowIntentionActionsAction` 把本地 intention 与
// 语言服务回的 quickfix 并进同一个列表，本仓的列表宿主是 `src/semanticActions.ts` 的
// `openCodeActions`）。
//
// 这一层是「纯规则 → 可应用编辑」的接线：规则说的是「插什么、插到哪」，但弹层条目必须同时带上
// **落到哪个文件、哪一行、什么编辑载荷**（`LspCodeAction.edits`），并跳过已经抑制过的行 ——
// 否则用户按一次 Alt+Enter 就会在同一行插出第二条抑制注释。
//
// 上游依据：
//   · `SuppressIntentionAction.isAvailable` 在已抑制的位置返回 false（本模块用
//     `alreadySuppressed` 判）；
//   · 抑制条目按 `IntentionAction.getText` 出标题、按 `Option`（line/statement）决定插入位置 ——
//     本仓的插入位置只有「上一行 / 行尾」两档，见 `src/suppressIntention.ts` 的 `placement`。
import type { LspCodeAction, LspDiagnostic, LspTextEdit } from './bridge'
// `.ts` 后缀：这个模块要在 `node --test` 下直接被 import（同 `src/toolWindowStripes.ts` 的先例），
// 无后缀的依赖在 Node 的类型剥离模式下解析不到。
import { alreadySuppressed, suppressOptionsFor, type SuppressibleProblem, type SuppressOption } from './suppressIntention.ts'

/** 诊断来源名的兜底映射用不到时，从消息里抠规则 id：`[no-unused-vars]` / `(no-console)`。 */
export function ruleIdFromMessage(message: string): string {
  const bracket = /\[([A-Za-z][\w./-]*)\]/.exec(message)
  if (bracket) return bracket[1]!
  const paren = /\(([A-Za-z][\w./-]*)\)\s*$/.exec(message)
  if (paren) return paren[1]!
  return ''
}

/**
 * 抑制规则里的语言档（`suppressOptionsFor` 的第二个参数）。`src/templates.ts` 的 `languageFor`
 * 只有 java/cpp/typescript/other 四档，Python/Go 会落进 other 而拿不到 `# noqa`/`//nolint`，
 * 所以这里按同一口径补全（并且不改那个模块的行为）。
 */
export function suppressionLanguageFor(path: string): string {
  if (/\.(py|pyi)$/i.test(path)) return 'python'
  if (/\.go$/i.test(path)) return 'go'
  if (/\.(java)$/i.test(path)) return 'java'
  if (/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i.test(path)) return 'typescript'
  if (/\.(c|cpp|cc|cxx|h|hpp|hh|hxx)$/i.test(path)) return 'cpp'
  return ''
}

/** 该行行首缩进（只取空白；行首没有缩进就没有缩进）。 */
function indentOf(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? ''
}

/** 该行长度（去掉 CRLF 的 `\r`；否则 line-end 的插入点会落到下一行的行首）。 */
function lineLength(line: string): number {
  return line.replace(/\r$/, '').length
}

/**
 * 把一条抑制选项变成 LSP 文本编辑：
 *   · `line-above` —— 在 `(line, 0)` 零宽插入「缩进 + 文本 + 换行」；
 *   · `line-end` —— 在 `(line, 行尾)` 零宽插入「两个空格 + 文本」。
 * 越界返回 null（与 `applySuppression` 同一口径：不把注释插到文件尾巴上）。
 */
export function suppressionEditFor(
  lines: string[], line: number, option: SuppressOption,
): LspTextEdit | null {
  if (!Number.isInteger(line) || line < 0 || line >= lines.length) return null
  const text = lines[line]!
  if (option.placement === 'line-end') {
    const character = lineLength(text)
    return { text: `  ${option.insertText}`, startLine: line, startChar: character, endLine: line, endChar: character }
  }
  return { text: `${indentOf(text)}${option.insertText}\n`, startLine: line, startChar: 0, endLine: line, endChar: 0 }
}

export interface LocalIntentionInput {
  path: string
  /** 当前缓冲区文本（不是磁盘内容：用户可能还没保存）。 */
  text: string
  /** 落在同一行上的语言服务/本地检查诊断。 */
  diagnostics: LspDiagnostic[]
  /**
   * 意图开关（`src/intentionSettings.ts` 的 `isIntentionEnabled`）：返回 false 的 id 不进列表。
   * 不传 = 全部启用（纯规则测试与老调用点保持原行为）。
   */
  enabled?: (id: string) => boolean
}

/**
 * 同一行诊断 → 可应用的抑制条目。多源（eslint + tsserver 落在同一行）时按源去重，
 * 同一份抑制文本只出一条；已经抑制过的位置不出条目；被设置停用的意图也不出条目。
 */
export function suppressionActionsFor(input: LocalIntentionInput): LspCodeAction[] {
  const lines = input.text.split('\n')
  const language = suppressionLanguageFor(input.path)
  const out: LspCodeAction[] = []
  const seen = new Set<string>()
  for (const diagnostic of input.diagnostics) {
    if (diagnostic.line < 0 || diagnostic.line >= lines.length) continue
    const messageRule = ruleIdFromMessage(diagnostic.message)
    const problem: SuppressibleProblem = {
      line: diagnostic.line,
      source: diagnostic.source ?? '',
      ...(messageRule ? { code: messageRule } : {}),
    }
    for (const option of suppressOptionsFor(problem, language)) {
      if (input.enabled && !input.enabled(option.id)) continue
      if (seen.has(option.insertText)) continue
      if (alreadySuppressed(input.text, diagnostic.line, option)) continue
      const edit = suppressionEditFor(lines, diagnostic.line, option)
      if (!edit) continue
      seen.add(option.insertText)
      out.push({
        title: option.title,
        // 本仓本地条目没有服务端的 index；-1 同时让 `applyCodeAction` 的 executeCommand
        // 分支不可能被误走到（`command` 是 undefined，edits 非空）。
        index: -1,
        kind: 'quickfix.suppress',
        // 抑制是「本条诊断的修复」，与 LSP 的 preferred 修复同一档（Run Inspection 的过滤看得见）。
        preferred: true,
        edits: [{ path: input.path, textEdits: [edit] }],
      })
    }
  }
  return out
}
