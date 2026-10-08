// dm/highlight 的「展示文」这条缺（`HighlightInfo` 的富信息里点名了 description/tooltip）：
// 把上游 `HighlightingProblem` 的两个展示档拆成纯函数。
//
// 上游（`platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/HighlightingProblem.kt`）：
//   · `text`（:77-83）—— 树节点上那一行：取 `HighlightInfo.description` 的**第一行** + `…`
//     （`StringUtil.ELLIPSIS` = `\u2026`，`platform/util/src/com/intellij/openapi/util/text/StringUtil.java:61`）；
//     没有换行、或文本以 `<html>` 开头时**原样返回**（`:79` 那两个条件是或的关系）。
//     `StringUtil.isLineBreak` 认 `\n` 与 `\r`（`StringUtil.java:306-307`）。
//   · `description`（:96-103）—— 同一个 `description` 的**全文**档：空串 / 没有换行 / `<html>` 开头
//     一律 null（= 没有 tooltip），否则把每一行拼成可显示的多行文本。
//   消费面：`ProblemNode.update`（`ProblemNode.kt:61-72`）—— `presentation.addText(problem.text)` +
//   `presentation.tooltip = problem.description`，即「标签只给第一行，全文在 tooltip 里」。
//
// 本仓落点：`src/components/ProblemsPanel.vue` 的问题行（`:title` = 全文档、标签 = 单行档）。
// 之前那一行直接把 `p.message` 塞进 `.problem-msg`（`src/style.css:1197` 的 ellipsis 会把它按
// **浏览器宽度**切掉）——多行消息看到的是"前若干字符被裁"，不是上游的"第一行 + `…`"，
// 而全文在面板上没有任何出口（复制描述那一项才有）。
//
// **与上游的一处有意差异（记在这，不假装一致）**：上游的 `description` 返回 `<html>…<br/>…`
// —— 那是给 Swing tooltip 的 HTML 形态；本仓的 tooltip 是 DOM 的 `title`（纯文本、换行本身
// 就能折行，写 `&lt;` 反而会被逐字显示）。所以这里返回**纯文本多行**，不拼 `<html>`、不做转义；
// 需要 HTML 的消费方（如 HTML 报告）在那一层自己走 `src/inspectionReport.ts` 的 `escapeHtml`。
//
// 两条规则都是纯计算、零依赖、无 Vue —— 单测 `tests/highlight-info-text.test.mjs` 直接喂字符串。

/** 第一个换行的下标（`StringUtil.isLineBreak` 认 `\r` 与 `\n`）；没有换行时是 -1。 */
function firstLineBreak(text: string): number {
  return text.search(/[\r\n]/u)
}

/** 上游 `text.startsWith("<html>", ignoreCase = true)`（`:79`/`:101`）；这里认 `<html` 开头即可。 */
function isHtmlText(text: string): boolean {
  return /^<html\b/i.test(text)
}

/**
 * 节点标签档（上游 `HighlightingProblem.text`，`:77-83`）。
 * 没有换行、或整段是 `<html>` 富文本时原样返回 —— 后者不截断，因为那一档的排版由 HTML 自己管。
 */
export function highlightInfoNodeText(description: string): string {
  if (!description) return description
  const index = firstLineBreak(description)
  if (index < 0 || isHtmlText(description)) return description
  return description.slice(0, index) + '\u2026'
}

/**
 * tooltip 档（上游 `HighlightingProblem.description`，`:96-103`）：只有真的有多行可看时才给，
 * 否则 null（= 不给 tooltip，与上游同一判据）。返回纯文本多行（差异见文件头）。
 */
export function highlightInfoDescription(description: string): string | null {
  if (!description || firstLineBreak(description) < 0 || isHtmlText(description)) return null
  return description
}
