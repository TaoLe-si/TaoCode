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
/** `commit.checks.only.progress.text.with.context` = `正在运行提交检查: {0}`（{0} = 当前那一步）。 */
export const RUNNING_CHECKS_WITH_CONTEXT = '正在运行提交检查'
/** `progress.title.commit.checks`（中文包 = 提交检查）—— 面板内指示器那一行的标题。 */
export const CHECKS_PROGRESS_TITLE = '提交检查'
/** `CommonBundle` 的取消按钮文案（面板内指示器上那个取消）。 */
export const CHECKS_CANCEL_TEXT = '取消'
/**
 * `label.commit.checks.not.available.during.indexing`（中文包 = 项目分析期间某些提交检查不可用）。
 *
 * 上游 `CommitProgressPanel.kt:310` 在 **dumb 模式**（索引/项目分析中）时把这条警告挂在检查那一行上。
 * 本仓没有 PSI 索引，但有等价状态：语言服务正在**初始化/导入**（JDT LS 首次同步那几分钟）。
 * 所以本仓的"分析中"= `lspRunning`（不是"服务器没起"——那只是没配语言服务，检查照样能跑）。
 */
export const NOT_AVAILABLE_DURING_INDEXING = '项目分析期间某些提交检查不可用'
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


/**
 * 面板内那条检查进度（上游 `CommitChecksProgressIndicator` + `InlineCommitChecksProgressIndicator`，
 * `CommitChecksProgressIndicator.kt:25-139`）。
 *
 * 上游的形状逐条：
 *   · 它是一个 `InlineProgressIndicator`（不是对话框），标题 `progress.title.commit.checks`
 *     （`:20` 的 `CommitChecksTaskInfo.getTitle`）、**可取消**（`:21`）、取消文案来自
 *     `CommonBundle.getCancelButtonText()`；
 *   · 正文（`text`）由 `StatusBarProgressIndicator.setText`（`:105-125`）按"只跑检查 / 提交中"
 *     两档折算成 `commit.checks.only.progress.text[.with.context]` 或
 *     `commit.checks.on.commit.progress.text[.with.context]`（`:108-115`）；
 *   · 副文本（`text2`）置灰（`:39` 的 `setText2Enabled(false)`）；
 *   · **双省略号**会被修掉（`:71-86`）：正文以省略号结尾、副文本又以省略号开头时，把正文那个去掉。
 *
 * 本仓原先只有一行状态栏文字（`setStatusText(RUNNING_CHECKS_TEXT)`），没有面板内指示器、
 * 也没有"当前在进行哪一步"的上下文文案。这一层把上面四条折成一个**可渲染的状态对象**。
 */
export interface ChecksProgress {
  /** 标题（上游 `getTitle()`）。空串 = 不显示这一行。 */
  title: string
  /** 正文（上游 `text`）。 */
  text: string
  /** 副文本（上游 `text2`，置灰显示）。 */
  detail: string | null
  /** 能不能取消（上游 `isCancellable() = true`）。 */
  cancellable: boolean
  /** 取消按钮的文案。 */
  cancelText: string
  /** 这一行要不要显示。 */
  visible: boolean
}

/**
 * 上游那两档标志：`isOnlyRunCommitChecks`（只跑检查）与 `isCommitting`。
 *
 * `running` 是**这一行此刻该不该在界面上**（上游那个 `InlineProgressIndicator` 只在任务活着时
 * 挂在面板上；任务一结束 `stop()` 就把组件收掉）。写成参数而不是让调用方自己套 `v-if`，
 * 是为了让"什么时候该显示"与文案一起可测 —— 第一版把 `visible` 写成了恒 true，真机上那一行
 * 就一直挂着（真机取证当场发现的）。
 */
export function checksProgress(onlyRunChecks: boolean, step: string | null, running = true, cancellable = true): ChecksProgress {
  const base = onlyRunChecks ? RUNNING_CHECKS_TEXT : '正在提交…'
  const withContext = `${onlyRunChecks ? RUNNING_CHECKS_WITH_CONTEXT : '正在提交'}: ${step}`
  return {
    title: CHECKS_PROGRESS_TITLE,
    text: step ? withContext : base,
    detail: null,
    cancellable,
    cancelText: CHECKS_CANCEL_TEXT,
    visible: running,
  }
}

/**
 * 上游 `fixDoubleEllipsis`（`:71-86`）：正文以省略号结尾、副文本又以省略号开头时，
 * 把正文那个去掉 —— 否则界面上会出现 "正在运行… …正在导入" 这种两个省略号挨着的样子。
 * `…`（U+2026）与 `...` 两种写法都要认（上游 `endsWithEllipsis` 就是这么判的）。
 */
export function fixDoubleEllipsis(text: string, detail: string | null): string {
  if (!detail) return text
  const endsEllipsis = text.endsWith('…') || text.endsWith('...')
  const startsEllipsis = detail.startsWith('…') || detail.startsWith('...')
  if (!endsEllipsis || !startsEllipsis) return text
  return (text.endsWith('…') ? text.slice(0, -1) : text.slice(0, -3)).trimEnd()
}

/** 检查那一行该不该挂"分析中不可用"的警告（上游 dumb 模式的等价物，见常量注释）。 */
export function indexingWarningVisible(analyzing: boolean, checksBusy: boolean): boolean {
  return analyzing && !checksBusy
}
