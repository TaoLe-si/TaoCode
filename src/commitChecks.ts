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

/**
 * 「提交文件…」的**请求形状**（R1 的前端那一半）。
 *
 * 上游（逐行开过，参考树实测）：`.../actions/commit/CommonCheckinFilesAction.kt:37-53` 的
 * `actionPerformed` 把 `VcsContextUtil.selectedFilePaths(...)` 那批路径交给
 * `CheckinActionUtil.kt:121-147` 的 `performCheckInAfterUpdate(...)`，同文件 `:153-167` 的
 * `getIncludedChanges(...)` 算出"这次包含的变更"，`:135-136` 把它设成唯一的提交范围
 * （`workflowHandler.setCommitState(initialChangeList, included, …)`）。
 *
 * 订正留痕（2026-10-06 partialcommit，三条都是上一路 lane 抄错的坐标，逐条重开上游核过）：
 *  · 原写 `CommonCheckinFilesAction.kt:26-78` ⇒ 该文件共 80 行，`update()` 在 `:23-34`、
 *    `actionPerformed` 在 `:37-53`、`isActionEnabled` 在 `:75-78`（原写 `:74-78` 的那一行是
 *    `@ApiStatus.Internal`，函数体从 `:75` 起）；
 *  · 原写 `CheckinActionUtil.kt:100-160` 的 `pathsToCommit(...)` ⇒ **上游没有叫 `pathsToCommit`
 *    的函数**，它是 `performCommonCommitAction`/`performCheckInAfterUpdate`/`getIncludedChanges`
 *    的参数名（`:77`、`:126`、`:157`）；被选 changes 与未版本管理文件各取一份在 `:104-106`，
 *    `getIncludedChanges` 整体是 `:153-167`（原写 `:159-167` 少看了函数头）；
 *  · 原写"落点 `git commit --only -- <paths>`"读起来像上游也这么发 ⇒ **上游不发 `--only`**：
 *    `GitCheckinEnvironment.kt:393-434` 是被选项刷进 index（`GitFileUtils.kt:156-179`）+
 *    不属于这次的暂存项临时退回（`GitResetAddStagingAreaStateManager.kt:30-60`）+
 *    一次**不带 pathspec** 的 `git commit -F`（`GitRepositoryCommitter.kt:77-108`）+ 退出时恢复
 *    （`GitStagingAreaStateManager.kt:24-28`）。`--only` 是本仓为同一 observable 结果选的短路，
 *    口径与实测见 `src/commitScope.ts` 的文件头。
 * 本仓的等价物就是把这批路径送给宿主的 `paths` 入参，落点 `native/git.cpp` 的
 * `commit(..., paths)` → `git commit --only -- <paths>`。
 *
 * 三条口径：
 *  · **空 = 不带这个键**：今天的 `git.commit` 请求体一个字都不变（宿主没接这条通道之前，
 *    带上 `paths` 也只会被忽略 ⇒ 宁可不发）；"我明明选了子集却一个都没选中"那一档由
 *    `src/commitCheck.ts` 那条链说「选择要提交的文件」（`:75-84` 的 `commitIncludedCount` ⇒
 *    `commitBlockReason` ⇒ `:106` 的文案 ⇒ 提交按钮禁用 + 面板错误行），不留到这里静默降级；
 *    2026-10-06 partialcommit 收尾订正：这里原来写的是 `src/commitScope.ts` 的 `commitScopeProblem`，
 *    那个符号没有任何生产消费方（同一句话的第二把尺子），已删，判据改钉真跑的那条链；
 *  · 去空白、去重、保序（`CheckinActionUtil.kt:104-106` 那两份集合都是先去重再 concat）；
 *  · 上限 500 条与 native 的 `paths.size() > 500` 一致，超了在这里就拒掉。
 *
 * 2026-10-06（commit2）把"校验非法 paths"这一半补上，四条口径都有上游出处：
 *  · **单条路径的合法性**＝把 native 那道闸在前端先跑一遍：`native/git.cpp` 的 `checked_path()`
 *    拒空串、>512 字符、以 `-` 开头、含控制字符（CR/LF 在内）、含 `..`、绝对路径与反斜杠分隔符，
 *    抛 `INVALID_REQUEST`（在前端先拒 = 少一次往返、错误也落在"提交文件…"那一步，而不是等 git 撞死）；
 *    这道闸的本体在 native，前端的 `commitPathProblem` 只是它的一份镜像，两处的数字必须一致
 *    （`MAX_COMMIT_PATH_LENGTH`，判据在 `tests/commit-scope.test.mjs`）；
 *  · **目录与其子项同时选中 ⇒ 不并掉**：`DescindingFilesFilter.java:27-69` 会把后代路径滤掉，
 *    但 `:36-39` 一上来就先问 `AbstractVcs#allowsNestedRoots`，而 git 那一支答 **true**
 *    （`plugins/git4idea/backend/src/GitVcs.java:260-263`）⇒ 上游对 git 仓库是一个路径都不并；
 *    本仓只接 git，所以这里也**不许**做祖先折叠（上一版的注释把这一步当成"集合语义"，实际不是）；
 *  · **被忽略（noisy）的被选项 ⇒ 拒绝**：`actions/commit/CommonCheckinFilesAction.kt:75-78`
 *    的 `isActionEnabled` 要求 `status != FileStatus.IGNORED` —— 面板默认连列都不列它们
 *    （`ChangesView.ShowIgnored`），多选把它们夹进来时不能真的进这次提交；
 *  · **未跟踪的被选项 ⇒ 明确纳入**（不是拒绝）：`CheckinActionUtil.kt:104-105` 把
 *    `UNVERSIONED_FILE_PATHS_DATA_KEY` 与 `CHANGES` 各取一份，同文件 `:153-167` 的
 *    `getIncludedChanges()` 把未版本管理的那些 `concat` 进"这次包含的变更"
 *    ⇒ 路径照原样发出去，由 native 只对**未跟踪的那几条**先 `git add`（`native/git.cpp` 的
 *    `commit(..., paths)`）再 `--only` 提交。为什么不是"全部先 add"：重命名被 `git mv` 过的那一半
 *    已经不在 index 也不在工作区，`git add -- <旧路径>` 会 `fatal: pathspec … did not match any files`
 *    （实测退出码 128，`--ignore-errors` 压不住），整批发出去 = 这次提交直接失败；
 *  · **重命名对 ⇒ 补齐另一头**（2026-10-06 partialcommit）：上游一条 `ChangedPath` 同时带
 *    `beforePath`/`afterPath`（`GitCheckinEnvironment.kt:403-404` 把两朵路径分别放进 toCommitRemoved /
 *    toCommitAdded），所以"选中一次重命名"交出去的就是两朵路径。单边提交实测写出坏历史（只给新路径 ⇒
 *    `A e.txt` 而 HEAD 里的旧路径还在；只给旧路径 ⇒ `D d.txt` 而新内容留在 index）。补齐这一步在
 *    `src/commitScope.ts` 的 `expandCommitSelection`，下面 `commitPathsToSubmit` 先补齐再校验，
 *    并且认得"某行的 `renameFrom`"也是一个有变更的路径（否则补出来的那一半会被当成陌生路径误拒）。
 *  后两条要吃"本仓当前的变更列表"（`changes`）：宿主没给这一份时**不做**这两档判断，
 *  请求形状与本批之前逐字一致（不放假校验，也不误拒）。
 */
export interface CommitRequestInput {
  message: string
  amend: boolean
  signoff: boolean
  author: string
  authorEmail: string
  /** 被选中的那些路径（仓库相对）。空/未给 = 提交整个暂存区，与历史行为逐字一致。 */
  paths?: readonly string[]
  /**
   * 本仓当前的变更列表（`git.status` 的那一份，结构上就是 `GitChange`）。
   * 给了才做「被忽略的被选项拒绝」「陌生路径拒绝」这两档；不给 = 本批之前的形状。
   */
  changes?: readonly CommitScopeRow[]
}

/** 变更列表里"提交范围校验"要用的那几件事：与 `src/commitScope.ts` 同一份类型，不另立（`GitChange` 结构相容）。 */
export type { CommitScopeRow } from './commitScope.ts'
import { type CommitScopeRow, commitScopeCovers, expandCommitSelection, normalizeCommitSelection } from './commitScope.ts'

export const MAX_COMMIT_PATHS = 500

/** native `checked_path()` 里那个长度上限（`native/git.cpp` 的 `checked_path`，同一道闸同一个数）。 */
export const MAX_COMMIT_PATH_LENGTH = 512

/**
 * 单条路径过 native 那道闸：返回不合法的原因，合法时返回 `null`。
 * 六道口径与 native 一一对应（判据在 `tests/commit-scope.test.mjs`，它把 native 源码里的字面量
 * 与这里逐条比）：空串由调用方先滤（空白项不算一次选择）、>512、以 `-` 开头（防读成选项）、
 * 含控制字符（NUL 会把 argv 那一截切断 ⇒ 请求的路径和 git 拿到的路径不是同一条）、
 * 含 `..`（防越出仓库）、绝对路径与反斜杠分隔符（pathspec 只认仓库相对的 POSIX 写法；
 * 实测 `git add -- C:/…/c.txt` 这种仓内绝对路径**能走通**，而 `git` 对 `sub\x.txt`
 * 报 `pathspec … did not match any file(s)` ⇒ 这两类都不是"仓库相对路径"，早点拒掉）。
 *
 * 两处 2026-10-06 partialcommit 收尾的订正（都是"这里说同源、其实不同"的实账）：
 *  · **长度数的是字节不是字符**：native 那一头是 `path.size() > 512`（`std::string` = UTF-8 **字节**），
 *    原来这里写 `path.length`（UTF-16 **码元**）⇒ 一篇 300 个汉字的路径（900 字节）前端放行、
 *    native 拒掉，正是这条注释承诺的"同一个数"没做到。改成按 UTF-8 字节数（`utf8ByteLength`）；
 *  · **第七条 `PATHSPEC_MAGIC_RE` 是前端先严、native 还没有的那一道**（`native/git.cpp` 不许本 lane 动，
 *    接线请求见 `docs/wiring-requests-2026-10-06-partialcommit.md` W3）。它挡的是 git 的 pathspec
 *    通配/魔术：实测临时仓里 `git commit --only -m x -- 'foo[1].ts'` 一次提交走了 `foo[1].ts`
 *    **和** `foo1.ts` 两篇，`-- '*.ts'` 更是把仓库里所有 `.ts` 都提交走 ⇒ 一条"只选了一篇"的
 *    pathspec 能提交得比用户选的更多，这是这一族最贵的错，方向上只能在前端先拒。
 *    代价如实写在这：文件名里真带 `[` 的那一篇走不了「提交文件…」（`*`、`?` 在 Windows 上本来就
 *    不能出现在文件名里），改走「暂存 + 整份提交」——那一条不发 pathspec，没有这个问题。
 */
const PATHSPEC_MAGIC_RE = /[*?[]|:\(|^:/
function utf8ByteLength(path: string): number {
  return new TextEncoder().encode(path).length
}

function commitPathProblem(path: string): string | null {
  if (utf8ByteLength(path) > MAX_COMMIT_PATH_LENGTH) return '路径过长'
  if (path.startsWith('-')) return '路径不能以 - 开头'
  if (/[\u0000-\u001f]/.test(path)) return '路径不能含控制字符'
  if (path.includes('..')) return '路径不能含 ..'
  if (path.startsWith('/') || path.startsWith('\\')) return '路径必须是仓库相对的'
  if (/^[A-Za-z]:/.test(path)) return '路径必须是仓库相对的（不能带盘符）'
  if (path.includes('\\')) return '路径分隔符必须是 /'
  if (PATHSPEC_MAGIC_RE.test(path)) return '路径含 git 的 pathspec 通配/魔术，按字面提交会带上别的文件'
  return null
}

/**
 * 被选路径 → 这次提交的 pathspec（`commitRequestParams` 的那一步，不单独导出：
 * 请求体只有一条生成路径，别让"校验过的"和"没校验的"两种形状在界面上并存）。
 * 四条口径（详见 `commitRequestParams` 的注释）：先把重命名对补齐（`src/commitScope.ts` 的
 * `expandCommitSelection`）、非法的单条路径就地拒、被忽略的被选项拒、未跟踪的被选项**留**。
 * 选中目录（`src`）算得中它下面的那些变更（`src/a.ts`）。
 */
function commitPathsToSubmit(paths: readonly string[] | undefined,
                             changes?: readonly CommitScopeRow[]): string[] {
  // 有了变更列表才补得动重命名的另一头；没有列表时保持本批之前的形状（不猜伙伴）。
  const selected = changes ? expandCommitSelection(paths, changes) : normalizeCommitSelection(paths)
  if (selected.length > MAX_COMMIT_PATHS) {
    throw new Error(`一次最多提交 ${MAX_COMMIT_PATHS} 个所选文件。`)
  }
  const illegal = selected.filter(path => commitPathProblem(path) !== null)
  if (illegal.length) {
    const reasons = illegal.map(path => `${path}（${commitPathProblem(path)}）`).join('、')
    throw new Error(`提交路径不合法：${reasons}`)
  }
  if (!changes) return selected
  const rejected: string[] = []
  for (const path of selected) {
    const exact = changes.find(row => row.path === path)
    // 补出来的那一半（重命名旧路径）不是独立的一行：它就在某行的 `renameFrom` 上，
    // 上游把这两朵路径算作同一条变更（`GitCheckinEnvironment.kt:403-404`）⇒ 这里认它。
    if (exact?.ignored) { rejected.push(`${path}（被忽略的文件不参与提交）`); continue }
    // 选中目录：它下面的变更行才算"被这次提交包含"；一行都对不上 = 上游那条 `status == NOT_CHANGED`，
    // 那个动作对这种路径直接不启用（`CommonCheckinFilesAction.kt:75-78`）。
    // 覆盖判定用 `src/commitScope.ts` 的 `commitScopeCovers`（目录 + 重命名另一头），
    // 与提交按钮那把空判（`src/commitCheck.ts` 的 `commitIncludedCount`）、结果计数
    // （`committedChangeCount`）同一条规则 —— 三份各写一遍就会漂，2026-10-06 partialcommit 收尾并成一份。
    if (!changes.some(row => commitScopeCovers(path, row))) {
      rejected.push(`${path}（没有可提交的变更）`)
    }
  }
  if (rejected.length) throw new Error(`这次提交不包含：${rejected.join('、')}`)
  return selected
}

export function commitRequestParams(input: CommitRequestInput): Record<string, unknown> {
  const params: Record<string, unknown> = {
    message: input.message, amend: input.amend, signoff: input.signoff,
    author: input.author, authorEmail: input.authorEmail,
  }
  const paths = commitPathsToSubmit(input.paths, input.changes)
  if (paths.length) params.paths = paths
  return params
}
