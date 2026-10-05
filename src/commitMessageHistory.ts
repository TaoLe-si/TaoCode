// 提交信息 MRU —— 上游 `VcsConfiguration`（`vcs-api/shared/src/com/intellij/openapi/vcs/VcsConfiguration.java`）
// 的 `saveCommitMessage` / `getRecentMessages` / `replaceMessage` 三条，与消费它的
// `ShowMessageHistoryAction`（`vcs-impl/src/com/intellij/openapi/vcs/actions/ShowMessageHistoryAction.kt`）。
//
// 上游逐条（行号都已核过）：
//   · `MAX_STORED_MESSAGES = 25`（`:153`）；满了先 `remove(0)` 再 `add`（`:187-193`）—— 丢的是**最旧的**；
//   · `saveCommitMessage(comment)`（`:169-177`）：**空白串直接返回**（不进 MRU）；先在 MRU 里删掉同一条，
//     再追加到队尾（去重 + 最新在尾）；
//   · `getRecentMessages()`（`:199-201`）返回的是**旧 → 新**的副本；
//   · `replaceMessage(old, new)`（`:217-229`）：在 MRU 里找到就**原位替换**，找不到才按追加规则补一条；
//   · `getLastNonEmptyCommitMessage()`（`:195-197`）= 队尾（最近一条）；
//   · 消费端 `ShowMessageHistoryAction`：弹层列的是 `recentMessages.reversed()`（**新 → 旧**）、
//     `setVisibleRowCount(7)`、单选、带速度搜索；上下移动时**预览**（把信息临时填进编辑框），
//     没选中就撤销预览；行渲染把多行压成一行并按右边距截断（`:85-88`）。
//
// 本仓落点是这一份纯逻辑 + 面板接线（`src/components/SourceControl.vue`）：会话内 MRU 参与历史弹层，
// 持久化那一段要过原生设置 schema（跨语言边界需两侧登记），按第 97 批登记在 `docs/source-todo.md`。

/** MRU 里的信息就是字符串；单独起名便于在函数签名里一眼看出参数含义。 */
export type CommitMessageComment = string
/** MRU 列表（旧 → 新，与 `getRecentMessages()` 同序）。 */
export type CommitMessageList = readonly CommitMessageComment[]

/** `MAX_STORED_MESSAGES`（`VcsConfiguration.java:153`）。 */
export const MAX_RECENT_COMMIT_MESSAGES = 25
/** `ShowMessageHistoryAction.kt:79` 的 `setVisibleRowCount(7)`。 */
export const MESSAGE_HISTORY_VISIBLE_ROWS = 7

/** 追加一条：满了先丢最旧的（`addCommitMessage:187-193`）。 */
function appendRecent(list: CommitMessageList, comment: CommitMessageComment): CommitMessageComment[] {
  const next = [...list]
  if (next.length >= MAX_RECENT_COMMIT_MESSAGES) next.shift()
  next.push(comment)
  return next
}

/**
 * 一次成功提交之后对 MRU 做的事（`saveCommitMessage:169-177`）：
 * 空白信息不进 MRU；同一条先删掉再追加（于是它挪到"最近"）。
 */
export function saveRecentMessage(list: CommitMessageList, comment: string | null | undefined): CommitMessageComment[] {
  if (typeof comment !== 'string' || comment.trim() === '') return [...list]
  const without = list.filter(entry => entry !== comment)
  return appendRecent(without, comment)
}

/**
 * 原位改一条（`replaceMessage:217-229`）：找到就替换、找不到按追加规则补。
 * 空白的新内容不写进历史（与 `saveCommitMessage` 同一条"空白不存"的规矩）。
 */
export function replaceRecentMessage(list: CommitMessageList, oldMessage: CommitMessageComment, newMessage: string | null | undefined): CommitMessageComment[] {
  if (typeof newMessage !== 'string' || newMessage.trim() === '') return [...list]
  const index = list.indexOf(oldMessage)
  if (index < 0) return appendRecent(list, newMessage)
  const next = [...list]
  next[index] = newMessage
  return next
}

/** `getLastNonEmptyCommitMessage:195-197`：队尾 = 最近用过的那条。 */
export function lastRecentMessage(list: CommitMessageList): CommitMessageComment | undefined {
  return list.length ? list[list.length - 1] : undefined
}

/**
 * 弹层里那一列（`ShowMessageHistoryAction.kt:66` 的 `recentMessages.reversed()`）：**新 → 旧**。
 * 本仓的面板在 MRU 之外还留着"从 `git log` 读历史提交信息"这条既有出路（MRU 为空时由它兜底），
 * 所以这里把两个来源合并：MRU 在前（新→旧）、git log 的主题跟在后，去重后按上限截断。
 */
export function messageHistoryRows(recent: CommitMessageList, subjects: readonly string[] | null | undefined, limit = 12): CommitMessageComment[] {
  const out: CommitMessageComment[] = []
  const seen = new Set<CommitMessageComment>()
  for (const entry of [...recent].reverse()) {
    if (!entry || seen.has(entry)) continue
    seen.add(entry)
    out.push(entry)
  }
  for (const subject of subjects ?? []) {
    if (!subject || seen.has(subject)) continue
    seen.add(subject)
    out.push(subject)
  }
  return out.slice(0, limit)
}

/**
 * 打开历史弹层时取那一列：先要一遍 `git log` 的主题（既有出路），再与 MRU 合并
 * （`ShowMessageHistoryAction.kt:66` 的 `recentMessages.reversed()` 在前）。
 */
export async function loadMessageHistory(
  fetchSubjects: () => Promise<readonly string[] | null | undefined>,
  recent: CommitMessageList,
): Promise<CommitMessageComment[]> {
  let subjects: readonly string[] = []
  try {
    subjects = (await fetchSubjects()) ?? []
  } catch {
    // 读不到 git log（新仓库/非 git 目录）不该把 MRU 也丢掉 —— 上游弹层只依赖内存里的 MRU。
    subjects = []
  }
  return messageHistoryRows(recent, subjects)
}

/**
 * 预览时填进编辑框的单行形态（`ShowMessageHistoryAction.kt:85-88`）：
 * 多行压成一行（换行 → 空格），再按右边距截断（`:86` 的 `StringUtil.first(..., rightMargin, false)`；
 * 本仓没有省略号参数，按"截到右边距为止"处理，末尾补 … 以便和真信息区分）。
 */
export function messageHistoryPreviewLine(message: string, rightMargin: number): string {
  const flat = String(message).replace(/\s*\r?\n\s*/g, ' ')
  if (!Number.isFinite(rightMargin) || rightMargin <= 0 || flat.length <= rightMargin) return flat
  return flat.slice(0, Math.max(1, rightMargin - 1)) + '…'
}
