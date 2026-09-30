// 「修改(M)」模式与提交信息的关系 —— 上游 `AmendCommitHandlerImpl`（`vcs/commit/AmendCommitHandlerImpl.kt`）
// 的那一段行为，本仓的等价物（纯函数部分）。
//
// 上游逐条：
//   · 进 amend 模式：`setAmendMessage()`（`:76-89`）先把当前草稿记成 `beforeAmendMessage`，
//     然后加载"上次提交的信息"（`LoadCommitMessagesTask`）：`messages.distinct().joinToString("\n")`，
//     **空串就不填**（`:86-87` 的 `takeIf { it.isNotBlank() }`）；
//   · 填之前还要过一道 `equalsIgnoreWhitespaces(before, amend)`：草稿和要填的那份只差空白就不动
//     （`:99`，免得把 `--amend --no-edit` 那条路变成显式 `-m`）；
//   · 真填了才把 `(beforeAmendMessage, amendMessage)` 记成 `AmendData`（`:103`）；
//   · 退出 amend 模式：`restoreBeforeAmendMessage()`（`:52` 的反向分支）—— 把草稿放回来。
//
// 本仓没有"多根仓库拼信息"（每侧一个仓库），也没有 VcsConfiguration 的 `saveCommitMessage`
// （那是 IDEA 把草稿存进设置），所以只保留"记草稿 / 填上次信息 / 还原草稿"这三步。

/** 上游 `equalsIgnoreWhitespaces`：把空白都压掉再比。 */
export function equalsIgnoreWhitespaces(left: string, right: string): boolean {
  const squash = (value: string) => value.replace(/\s+/g, ' ')
  return squash(left).trim() === squash(right).trim()
}

export interface AmendMessagePlan {
  /** 要填进输入框的那份（null = 不填）。 */
  fill: string | null
  /** 填了才要记下来的"进 amend 模式前的草稿"。 */
  before: string | null
}

/**
 * 进 amend 模式时该做什么：`before` = 当前草稿，`headMessage` = 上次提交的信息（`git log -1 --pretty=%B`）。
 */
export function amendMessagePlan(before: string, headMessage: string): AmendMessagePlan {
  const amend = headMessage.replace(/\s+$/, '')
  if (amend.trim() === '') return { fill: null, before: null }
  if (equalsIgnoreWhitespaces(before, amend)) return { fill: null, before: null }
  return { fill: amend, before }
}

/**
 * 退出 amend 模式时该做什么：**只有输入框里还是那份填进去的**（`draft`）才还原草稿 ——
 * 用户自己改过就不动（上游 `restoreBeforeAmendMessage` 走的是 `AmendData`，同一层意思）。
 * 返回 null = 不改。
 */
export function restoreBeforeAmendMessage(current: string, draft: string | null, before: string | null): string | null {
  if (draft === null || before === null) return null
  if (current !== draft) return null
  return before
}
