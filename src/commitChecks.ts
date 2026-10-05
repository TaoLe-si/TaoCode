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
import type { CommitCheckPhase } from './commitChecksResult.ts'
import type { CommitMessageProblem } from './commitMessageInspection.ts'

/** `commit.checks.only.progress.text`（中文包 = 正在运行提交检查…）。 */
export const RUNNING_CHECKS_TEXT = '正在运行提交检查…'
/** `commit.checks.only.progress.text.with.context` = `正在运行提交检查: {0}`（{0} = 当前那一步）。 */
export const RUNNING_CHECKS_WITH_CONTEXT = '正在运行提交检查'
/** `commit.checks.on.commit.progress.text`（中文包 VcsBundle.properties:21 = 正在提交…）。 */
export const COMMITTING_TEXT = '正在提交…'
/** `commit.checks.on.commit.progress.text.with.context`（:22 = 正在提交: {0}）。 */
export const COMMITTING_WITH_CONTEXT = '正在提交'
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
/**
 * `label.commit.checks.failed.unknown.reason`（中文包 = 检查失败）—— 说不出具体是哪条时的兜底。
 */
export const CHECKS_FAILED_UNKNOWN = '检查失败'
/**
 * `label.todo.items.found`（中文包 = 「{0} 个 TODO」；`TodoCommitProblem.text` 取的就是它，
 * `TodoCheckinHandler.kt:52`）。本仓的 TODO 预检命中处数填进 `{0}`。
 */
export const TODO_ITEMS_FOUND = (count: number) => `${count} 个 TODO`
/**
 * `todo.in.new.review.button`（中文包 = 「审查 TODO(_R)」）= `TodoCommitProblem.showDetailsAction`
 * （`TodoCheckinHandler.kt:62-63`）。它是那条**详情动作**的名字，不是失败行的文案。
 */
export const REVIEW_TODO_ACTION = '审查 TODO(R)'
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

/**
 * `amend.action.name` = `修正{0}`（{0} = 提交动作名）⇒「修正提交」。
 * 上游出处：`AbstractCommitWorkflowHandler.getDefaultCommitActionName(vcses, isAmend, isSkipCommitChecks)`
 * （`platform/vcs-impl/src/com/intellij/vcs/commit/AbstractCommitWorkflowHandler.kt:226-237`）。
 */
export function amendActionText(commitText: string = COMMIT_ACTION_TEXT): string {
  return `修正${commitText}`
}

/** `action.amend.commit.anyway.text` = 仍然修正 —— 这一条上游**不带** `{0}`，就是常量。 */
export const AMEND_ANYWAY_TEXT = '仍然修正'

/**
 * 提交按钮那四档名字（`:226-237` 的 when 分支，逐条对上）：
 *
 * | amend | 检查已失败（`isSkipCommitChecks`） | 上游 key | 中文包 |
 * |---|---|---|---|
 * | × | × | `GitBundle` `commit.action.name` | 提交 |
 * | × | ✔ | `action.commit.anyway.text` | 仍然{0} |
 * | ✔ | × | `amend.action.name` | 修正{0} |
 * | ✔ | ✔ | `action.amend.commit.anyway.text` | 仍然修正 |
 *
 * 上一版只有前两档：勾上「修正」之后按钮还写着「提交」，与上游不符。
 */
export function commitActionText(input: { amend: boolean; skipChecks: boolean }, commitText: string = COMMIT_ACTION_TEXT): string {
  if (input.amend) return input.skipChecks ? AMEND_ANYWAY_TEXT : amendActionText(commitText)
  return input.skipChecks ? commitAnywayLabel(commitText) : commitText
}

/**
 * 进度行的**步名**（`commit.checks.*.progress.text.with.context` 里那个 `{0}`）。
 *
 * 上游那一档填的是"正在跑的那条检查自己报的进度文字"：`CommitChecksProgressIndicator.kt:122-134`
 * 的 `setText` 把 `ProgressIndicator.setText` 收到的文字折进文案，而文字由 `reportSequentialProgress`
 * / `itemStep` 的子步骤提供（`NonModalCommitWorkflowHandler.kt:445-480`）。本仓的两条检查没有各自的
 * 进度标题，于是步名用**本仓面板里已经在用的说法**（不是上游文案）：
 * 「提交信息检查」= 信息问题那一行的 `aria-label`，「TODO 检查」= 提交选项里「提交前检查 TODO」那个开关的简称。
 */
export const CHECKS_STEP_MESSAGE = '提交信息检查'
export const CHECKS_STEP_TODO = 'TODO 检查'
/** `post.commit.checks.progress.text`（中文包 = 正在检查提交中的文件）—— 提交后那一轮的进度文字。 */
export const POST_CHECKS_PROGRESS_TEXT = '正在检查提交中的文件'

/**
 * 第二把按钮（提交并推送）的四档 —— 上游
 * `platform/dvcs-impl/src/com/intellij/dvcs/commit/CommitAndPushExecutor.kt:9-19` 的
 * `getCommitAndPushActionName(state)`（state 就是 `isAmend` + `isSkipCommitChecks` 两位，
 * 与 `AbstractCommitWorkflowHandler.kt:226-237` 同一对）。文案取中文包 `DvcsBundle`
 * （英文原文在 `platform/dvcs-impl/shared/resources/messages/DvcsBundle.properties:126-129`）：
 *
 * | amend | 跳过检查 | key | 中文包 |
 * |---|---|---|---|
 * | × | × | `action.commit.and.push.text` | 提交并推送(&P)… |
 * | × | ✔ | `action.commit.anyway.and.push.text` | 仍然提交并推送(&P)… |
 * | ✔ | × | `action.amend.commit.and.push.text` | 修正提交并推送(&P)… |
 * | ✔ | ✔ | `action.amend.commit.anyway.and.push.text` | 仍然修正并推送(&P)… |
 *
 * 语义符按本仓惯例写成 `(P)`（同 `checkbox.amend` → 「修正(M)」），尾部的 `…` 是包里的原文。
 */
export function commitAndPushText(state: { amend: boolean; skipChecks: boolean }): string {
  if (state.amend) return state.skipChecks ? '仍然修正并推送(P)…' : '修正提交并推送(P)…'
  return state.skipChecks ? '仍然提交并推送(P)…' : '提交并推送(P)…'
}

/**
 * `ProgressUIUtil.DEFAULT_PROGRESS_DELAY_MILLIS`
 * （`platform/util/ui/src/com/intellij/ui/progress/ProgressUIUtil.kt:8` = `300L`）：
 * 进度指示器**延迟**出现的时长 —— 一闪而过的任务不该让界面抖一下。
 * 上游用在 `CommitProgressPanel.kt:163-175` 的 `progressFlow.debounce(300.milliseconds)`。
 */
export const PROGRESS_PRESENTATION_DELAY_MS = 300

/**
 * 面板内那一条进度行此刻该不该挂着（上游 `CommitProgressPanel.kt:163-175` 的三条判据）：
 *
 *   · 任务还在跑（`indicator?.isRunning == true`）；
 *   · **失败行是空的**（`failuresPanel.isEmpty()`）—— 报出 failure 时指示器整条收掉
 *     （`:257-260` 的 `progress?.component?.isVisible = false`），界面上只留失败行；
 *   · 延迟已过（`:165` 的 `debounce(300.milliseconds)`）。
 *
 * 少了第三条，亚秒级的检查也会让面板闪一行出来又收掉。
 */
export function checksProgressShown(running: boolean, hasFailures: boolean, delayElapsed: boolean): boolean {
  return running && !hasFailures && delayElapsed
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
  failures: CommitCheckFailure[]
  /** 要提交但还没保存的文件（`.ts` 那份说明见上）。 */
  unsaved: string[]
}

/**
 * 失败行上的**一条** failure —— 上游 `CommitCheckFailure`（`CommitProgressPanel.kt:370-381`）那三档
 * 在本仓的对应：
 *
 *   · `text` 无论哪一档都有（`WithDescription.text` = `CommitProblem.text`）。
 *   · `details` = `CommitProblemWithDetails.showDetailsAction`（`CommitCheck.kt:168`）——
 *     **有值就意味着这一条带一个详情动作**，`null` 就是纯 `WithDescription`/纯文本那一档。
 *
 * 上游还有一个 `showDetailsLink`（`CommitCheck.kt:166`，默认 null）：为 null 时
 * **整条 text 自己就是那个链接**（`CommitProgressPanel.kt:456-458`），为非 null 时 text 后面另接
 * 一段链接文字（`:452-455`）。本仓只落了"text 自己就是链接"那一档 —— `TodoCommitProblem`
 * 正是这一类（`TodoCheckinHandler.kt:50-51` 没有覆盖 `showDetailsLink`，用的是默认 null），
 * 所以本仓不引入第二个字段：需要区分时把 `details` 置空即可。
 */
export interface CommitCheckFailure {
  text: string
  /** 详情动作的名字（`CommitProblemWithDetails.showDetailsAction`）；null = 这一条没有详情动作。 */
  details: string | null
  /**
   * 出自哪个相位（`CommitCheck.ExecutionOrder` 的分组，`NonModalCommitWorkflowHandler.kt:372-375`）：
   * 提交信息检查 = `early`，提交前 TODO 预检 = `modifications`。
   * 状态机（`src/commitChecksResult.ts`）按它落 EARLY_FAILED / MODIFICATIONS_FAILED 两档，
   * 跳过规则才分得开（`:234-239`）。
   */
  phase: CommitCheckPhase
}

/**
 * 把各项检查的结果收成一份报告。**顺序照上游**：先 `checkCommit()` 的空判（不过是硬闸，且它跟
 * "检查失败"不是同一处 UI —— 前者是面板错误行，后者是失败行），再提交前的检查（TODO / 提交信息），
 * 最后是"未保存文件"那条提示（它不拦提交，只是要被说出来）。
 */
export function commitCheckReport(input: CommitCheckInput): CommitCheckReport {
  const blockMessage = commitBlockMessage(input.blockReason)
  const failures: CommitCheckFailure[] = []
  // TODO 预检在上游是 `TodoCommitProblem`（`TodoCheckinHandler.kt:50-63`）：它实现了
  // `CommitProblemWithDetails`，所以失败行上这一条的**文字本身就是链接**（`showDetailsLink` 为默认的
  // null ⇒ `CommitProgressPanel.kt:456-458`），点它打开 TODO 工具窗口看这些条目
  // （`TodoCheckinHandler.showTodoItems`，`:144-168`）。本仓有同一份 TODO 模式扫描，所以这条有宿主。
  if (input.todoHits > 0) failures.push({ text: TODO_ITEMS_FOUND(input.todoHits), details: REVIEW_TODO_ACTION, phase: 'modifications' })
  // 提交信息检查在上游是**消息编辑器里的 inspection**（`BaseCommitMessageInspection.kt:46,97` 按
  // `CommitMessage.isCommitMessage(element)` 挂 PSI 上），不是 `CommitCheck` ⇒ 上游它不进 `FailuresPanel`。
  // 本仓把它列在失败行上，所以每一条都按纯文本那一档处理（`details: null` = `WithDescription`）。
  for (const problem of input.messageProblems) failures.push({ text: `提交信息：${problem.message}`, details: null, phase: 'early' })
  return {
    ok: blockMessage === '' && failures.length === 0,
    blockMessage,
    failures,
    unsaved: [...input.unsaved],
  }
}

/** 失败列表里的纯文本（通知正文那一条通道用；面板那一行按条渲染，见 `SourceControl.vue`）。 */
export function failureTexts(failures: readonly CommitCheckFailure[]): string[] {
  return failures.map(failure => failure.text)
}

/**
 * 失败行上那句话（上游 `getCommitCheckFailureDescription`，`NonModalCommitWorkflowHandler.kt:296-299`：
 * 把各条 failure 的文本按 `HtmlChunk.br()` 拼起来）。一条都说不出时用
 * `label.commit.checks.failed.unknown.reason`。
 *
 * 注意上游在那里过滤 `filterIsInstance<CommitCheckFailure.WithDescription>()`：`Unknown` 那档
 * （`CommitProgressPanel.kt:371`）不参与拼接，于是可能一条都不剩 —— 那时 `FailuresPanel` 自己退回
 * `label.commit.checks.failed.unknown.reason`（`:464`）。本仓的 failure 都带 text，所以下面这个
 * 兜底只对空列表生效，与上游"空列表"那条路一致。
 */
export function failuresRowText(failures: readonly CommitCheckFailure[]): string {
  const texts = failureTexts(failures).filter(text => text.trim() !== '')
  return texts.length > 0 ? texts.join('；') : CHECKS_FAILED_UNKNOWN
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
export function checksProgress(onlyRunChecks: boolean, step: string | null, running = true, cancellable = true,
                               detail: string | null = null): ChecksProgress {
  // 两档正文：`commit.checks.only.progress.text`（:23）与 `commit.checks.on.commit.progress.text`（:21），
  // 带步名的那两档是 `….with.context`（:24 与 :22，中文包 = 「正在运行提交检查: {0}」/「正在提交: {0}」）。
  const base = onlyRunChecks ? RUNNING_CHECKS_TEXT : COMMITTING_TEXT
  const withContext = `${onlyRunChecks ? RUNNING_CHECKS_WITH_CONTEXT : COMMITTING_WITH_CONTEXT}: ${step}`
  return {
    title: CHECKS_PROGRESS_TITLE,
    // 副文本与正文的省略号撞车时去掉正文那个（上游 `fixDoubleEllipsis`，:71-86）。
    text: fixDoubleEllipsis(step ? withContext : base, detail),
    detail,
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

/**
 * 点进度行弹出的那个浮层 —— 上游 `CommitChecksProgressIndicatorTooltip.kt:23-58`：
 *   · `onClick`：指示器**还在跑**（`isRunning()`）时 `showPopup`，把 `PopupCommitChecksProgressIndicator`
 *     摆到指示器**上方**：`Point(0, -content.preferredSize.height - scale(8))`；
 *   · 指示器 `stop()` 时 `closePopup()`（本仓的对应物 = `checksProgress.visible` 变假，行收掉）；
 *   · 浮层本体比行**多一条进度条**（行只有文字 + 取消）。
 *
 * 本仓的检查进度是**不确定**的（没有分数可报），所以那条进度条是无档位的；这里只交出
 * "该不该显示、摆在哪儿、比行多什么"这三件可测的事，DOM 与动画在 SourceControl.vue。
 */
export const CHECKS_POPUP_GAP = 8

export interface ChecksPopup {
  /** `open && 指示器还在跑` —— 停止后浮层必须一起收掉（上游 `stop()` → `closePopup()`）。 */
  visible: boolean
  title: string
  text: string
  /** 浮层比行多的那条进度条（本仓不确定进度 ⇒ 无档位）。 */
  bar: boolean
  /** 摆位：贴在指示器上方（上游 `Point(0, -height - scale(8))`）。 */
  placement: 'above'
  /** 与指示器的间距（像素），即上游 `scale(8)` 的那个 8。 */
  gap: number
}

export function checksProgressPopup(progress: ChecksProgress, open: boolean): ChecksPopup {
  return {
    visible: open && progress.visible,
    title: progress.title,
    text: progress.text,
    bar: true,
    placement: 'above',
    gap: CHECKS_POPUP_GAP,
  }
}

/** 检查那一行该不该挂"分析中不可用"的警告（上游 dumb 模式的等价物，见常量注释）。 */
export function indexingWarningVisible(analyzing: boolean, checksBusy: boolean): boolean {
  return analyzing && !checksBusy
}
