// 两个补全 contributor 的**合流**规则（纯函数，零运行时 import ⇒ `node --test` 可直接驱动）。
//
// 上游是合流的：IDEA 的补全结果集 `CompletionResultSet` 一路收提案，后置模板只是其中一个普通
// 提案（`platform/lang-api/src/com/intellij/codeInsight/completion/PostfixTemplateProposal.java`
// 与语义提案同列表，靠排序区分），不存在"谁先给出结果谁独占"。
// CodeMirror 的 `autocompletion({ override })` 语义却是"**第一个非空即止**"（
// @codemirror/autocomplete 的 `completionSources` 逐个调用，拿到非空就停），所以合流必须由
// 调用方自己做 —— 否则打完点 `text.` 只剩模板候选，成员补全永远轮不到
// （2026-09-29 用户实测"没有代码补全提示"就是这条断的：宿主日志里一条 `lsp.request:completion` 都没有）。
import type { CompletionResult } from '@codemirror/autocomplete'

/**
 * 语义项在前（IDEA 把 postfix 排在常规提案之后），模板项补在后面。
 * 同名只留语义那一条：两行一样的 label、两种不同的 apply，看起来像渲染坏了。
 * 两边都空（null）才返回 null —— 那才是"这个点位没有候选"。
 */
export function mergeCompletionResults(semantic: CompletionResult | null, templates: CompletionResult | null): CompletionResult | null {
  if (!semantic) return templates
  if (!templates) return semantic
  const labels = new Set(semantic.options.map(option => option.label))
  return {
    from: Math.min(semantic.from, templates.from),
    options: [...semantic.options, ...templates.options.filter(option => !labels.has(option.label))],
  }
}
