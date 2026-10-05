// 两个补全 contributor 的**合流**规则（纯函数，零运行时 import ⇒ `node --test` 可直接驱动）。
//
// 上游是合流的：IDEA 的补全结果集 `CompletionResultSet` 一路收提案，后置模板只是其中一个普通
// 提案（`platform/lang-api/src/com/intellij/codeInsight/completion/PostfixTemplateProposal.java`
// 与语义提案同列表，靠排序区分），不存在"谁先给出结果谁独占"。
// CodeMirror 的 `autocompletion({ override })` 语义却是"**第一个非空即止**"（
// @codemirror/autocomplete 的 `completionSources` 逐个调用，拿到非空就停），所以合流必须由
// 调用方自己做 —— 否则打完点 `text.` 只剩模板候选，成员补全永远轮不到
// （2026-09-29 用户实测"没有代码补全提示"就是这条断的：宿主日志里一条 `lsp.request:completion` 都没有）。
import type { Completion, CompletionResult } from '@codemirror/autocomplete'

/**
 * 「无建议」占位行的标记。上游那个占位行不是条目：`EmptyLookupItem.java:19-21` 的类注释写着
 * 「不是真正的补全建议：永不插进文档、从可见条目列表里被过滤掉、不参与前缀匹配」。
 * 本仓把它做成一个带 `placeholder` 的 `Completion`，于是**合流这一层必须按上游那样过滤**：
 * 只要另一边（模板候选/本地贡献者）有真条目，占位行就不该出现。
 */
export type PlaceholderCompletion = Completion & { placeholder?: boolean }

/** 把带占位行的结果拆成「真条目」与「占位行」两半（纯过滤，不改顺序）。 */
function splitPlaceholders(result: CompletionResult | null): { real: Completion[]; placeholders: Completion[] } {
  if (!result) return { real: [], placeholders: [] }
  const real: Completion[] = []
  const placeholders: Completion[] = []
  for (const option of result.options) {
    if ((option as PlaceholderCompletion).placeholder) placeholders.push(option)
    else real.push(option)
  }
  return { real, placeholders }
}

/**
 * 语义项在前（IDEA 把 postfix 排在常规提案之后），模板项补在后面。
 * 同名只留语义那一条：两行一样的 label、两种不同的 apply，看起来像渲染坏了。
 * 两边都空（null）才返回 null —— 那才是"这个点位没有候选"。
 */
export function mergeCompletionResults(semantic: CompletionResult | null, templates: CompletionResult | null): CompletionResult | null {
  const left = splitPlaceholders(semantic)
  const right = splitPlaceholders(templates)
  // 两边都只剩占位行时留一个就够（上游那个表里也只有一行"无建议"）。
  const placeholders = left.real.length || right.real.length ? [] : [...left.placeholders, ...right.placeholders].slice(0, 1)
  if (!semantic) return templates
  if (!templates) return placeholders.length === left.placeholders.length ? semantic : { ...semantic, options: [...left.real, ...placeholders] }
  const labels = new Set(left.real.map(option => option.label))
  return {
    from: Math.min(semantic.from, templates.from),
    options: [...left.real, ...right.real.filter(option => !labels.has(option.label)), ...placeholders],
    ...(semantic.filter === false || templates.filter === false ? { filter: false } : {}),
  }
}
