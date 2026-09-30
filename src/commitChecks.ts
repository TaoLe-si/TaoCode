// 提交检查的**一处来源** —— 上游 `Vcs.RunCommitChecks`（`vcs/commit/RunCommitChecksExecutor.kt`）
// 那一支在本仓的等价物。
//
// 上游形状（逐条核过）：
//   · `RunCommitChecksExecutor`：一个 `CommitExecutor`（`ID = "Vcs.RunCommitChecks.Executor"`），
//     `getActionText()` = `ActionsBundle` 的 `action.Vcs.RunCommitChecks.text`（中文包 = **运行提交检查**），
//     `useDefaultAction() = false`、`createCommitSession` 只把 `isOnlyRunCommitChecks = true` 记进
//     `CommitContext`；于是同一条 **checkCommit() → beforeCommitChecks → （只在通过时）performCommit**
//     链路跑下来，区别只有"跑完不提交"。
//   · 它**没有**常显按钮：`CommitActionsPanel.setCustomCommitActions(...)` 只是把它挂到提交按钮的
//     下拉（`JBOptionButton.setOptions`，`CommitActionsPanel.kt:110`），而平台里
//     `Vcs.CommitExecutor.Actions` 这个组是空的（`VcsActions.xml:403`，没有任何 `<add-to-group>`），
//     所以非模态提交面板的下拉里也没有它。用户真正能看到的那一处是 **失败行上的刷新按钮**
//     （`CommitProgressPanel.kt:394` 的 `FailuresPanel` 里那把 `RerunCommitChecksAction`，
//     `:492-521`：图标 `AllIcons.General.InlineRefresh`、`setText(NULL_STRING)`、工具提示
//     `tooltip.rerun.commit.checks`），行本身只在检查报出 failure 之后才可见。
//   · 检查失败之后提交按钮**改名叫"仍然{0}"**（`AbstractCommitWorkflowHandler.kt:226-237`：
//     `isSkipCommitChecks` 来自 `NonModalCommitWorkflowHandler.willSkipCommitChecks()`，`:229-233`），
//     按下去就跳过检查直接提交。
//
// 文案一律取随 IDE 发货的中文包（`plugins/localization-zh`），逐条给 key：
//   commit.checks.only.progress.text          正在运行提交检查…
//   tooltip.rerun.commit.checks               重新运行提交检查
//   commit.checks.failed.notification.title   {0} 检查失败
//   label.commit.checks.failed.unknown.reason 检查失败
//   action.commit.anyway.text                 仍然{0}
//   GitBundle commit.action.name              提交 (&I)
import { commitBlockMessage, type CommitBlockReason } from './commitCheck.ts'
import type { CommitMessageProblem } from './commitMessageInspection.ts'

/** `commit.checks.only.progress.text`（中文包 = 正在运行提交检查…）。 */
export const RUNNING_CHECKS_TEXT = '正在运行提交检查…'
/** `tooltip.rerun.commit.checks`（中文包 = 重新运行提交检查）—— 失败行上那个刷新按钮的提示。 */
export const RERUN_CHECKS_TOOLTIP = '重新运行提交检查'
/** `commit.checks.failed.notification.show.details.action`（中文包 = 显示详细信息）—— 失败通知上那个按钮。 */
export const SHOW_DETAILS_TEXT = '显示详细信息'
/** `label.commit.checks.failed.unknown.reason`（中文包 = 检查失败）—— 说不出具体是哪条时的兜底。 */
export const CHECKS_FAILED_UNKNOWN = '检查失败'
/**
 * 提交动作自己的名字：Git 的 `checkinOperationName` = `GitBundle` 的 `commit.action.name`
 * （中文包 = 提交 (&I)，`:481`；菜单语义符在下拉里才显示，按钮上就是"提交"）。
 */
export const COMMIT_ACTION_TEXT = '提交'

/** `commit.checks.failed.notification.title` = `{0} 检查失败`（{0} = 提交动作名）。 */
export function checksFailedTitle(commitText: string = COMMIT_ACTION_TEXT): string {
  return `${commitText} 检查失败`
}

/** `action.commit.anyway.text` = `仍然{0}`（{0} = 提交动作名）—— 检查已失败时提交按钮的名字。 */
export function commitAnywayLabel(commitText: string = COMMIT_ACTION_TEXT): string {
  return `仍然${commitText}`
}

export interface CommitCheckInput {
  /** `checkCommit()` 的空判（`src/commitCheck.ts` 的 `commitBlockReason`）。 */
  blockReason: CommitBlockReason | null
  /** TODO 预检命中的处数（本仓的"提交前检查 TODO"，全工作区扫描）。 */
  todoHits: number
  /** 提交信息检查命中的问题（`src/commitMessageInspection.ts`）。 */
  messageProblems: readonly CommitMessageProblem[]
  /** 这次要提交、但在编辑器里还有未保存改动的文件（上游 `SaveCommittingDocumentsVetoer` 那一档）。 */
  unsaved: readonly string[]
}

export interface CommitCheckReport {
  /** 空判与提交前检查都过了（未保存文件不参与 —— 上游是"问要不要保存"，不是拒绝）。 */
  ok: boolean
  /** 空判那三条之一（上游 `CommitProgressPanel.buildErrorText()`，`:321-328`）—— 面板上那条错误行；没有就是空串。 */
  blockMessage: string
  /** 提交前检查报出来的问题（上游 `FailuresPanel` 里的 failure 列表）。 */
  failures: string[]
  /** 要提交但还没保存的文件（`.ts` 那份说明见上）。 */
  unsaved: string[]
}

/**
 * 把各项检查的结果收成一份报告。**顺序照上游**：先 `checkCommit()` 的空判（不过是硬闸，且它跟
 * "检查失败"不是同一处 UI —— 前者是面板错误行，后者是失败行），再提交前的检查（TODO / 提交信息），
 * 最后是"未保存文件"那条提示（它不拦提交，只是要被说出来）。
 */
export function commitCheckReport(input: CommitCheckInput): CommitCheckReport {
  const blockMessage = commitBlockMessage(input.blockReason)
  const failures: string[] = []
  if (input.todoHits > 0) failures.push(`工作区中仍有 ${input.todoHits} 处 TODO/FIXME（全工作区扫描）`)
  for (const problem of input.messageProblems) failures.push(`提交信息：${problem.message}`)
  return {
    ok: blockMessage === '' && failures.length === 0,
    blockMessage,
    failures,
    unsaved: [...input.unsaved],
  }
}

/**
 * 失败行上那句话（上游 `getCommitCheckFailureDescription`，`NonModalCommitWorkflowHandler.kt:297-300`：
 * 把各条 failure 的文本拼起来）。一条都说不出时用 `label.commit.checks.failed.unknown.reason`。
 */
export function failuresRowText(failures: readonly string[]): string {
  return failures.length > 0 ? failures.join('；') : CHECKS_FAILED_UNKNOWN
}

/**
 * 提交期间保存文件的确认（上游 `SaveCommittingDocumentsVetoer.confirmSave`，
 * `VcsBundle` 的 `save.committing.files.confirmation.*`：标题「在提交期间保存文件」
 * （`:964`）、正文 `:963`、按钮「立即保存」/「延迟保存」（`:961-962`））。
 * 返回 true = 立即保存；false = 延迟保存（照常提交磁盘上的版本）。
 */
export function saveDuringCommitQuestion(unsaved: readonly string[]): string {
  // `{0,choice,1#文件|2#文件}`：一个文件时不给数字，两个以上给数字（中文包的写法就是这样）。
  const noun = unsaved.length === 1 ? '文件' : `${unsaved.length}文件`
  // 上游标题是对话框标题（`…confirmation.title`）；`window.confirm` 没有标题栏，所以把它放第一行。
  return `在提交期间保存文件\n\n当前正在将以下${noun}提交到 VCS。立即保存可能会导致提交的数据不一致。\n`
    + `${unsaved.join('\n')}\n立即保存${noun}?`
    + `\n\n（浏览器确认框只有"确定/取消"两个按钮：确定 = 立即保存，取消 = 延迟保存，按磁盘上的版本提交。）`
}
