// 提交检查这一族的宿主状态（上游 `NonModalCommitWorkflowHandler` + `CommitProgressPanel`）。
//
// 面板上「为什么这次不能提交」那条错误行、提交前检查报出来的失败行、检查进度行与它的浮层、
// 取消、提交后那一轮，以及「运行提交检查」那条链，全在这一块 —— 模板只渲染它返回的那些 ref。
// 从 `SourceControl.vue` 按行号切片搬出来（模块化拆分，行为逐字未改）：`props` / `emit` /
// `act` / `commit` 四个依赖刻意与面板里的同名调用保持一致，搬动的那些行一个字都没改。
//
// 2026-10-06（桶 13c）接上「上次检查结果」那条状态线：跳过与否不再看"失败行有没有内容"，而是走
// `src/commitChecksResult.ts` 的状态机（上游 `RecentCommitChecks`，`NonModalCommitWorkflowHandler.kt:229-249、
// 337-342、533-557`），并把 reset 的判据换成上游那一条（变更集/文档真的变了，不是只数条数）。
import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { commitBlockMessage, commitBlockReason } from './commitCheck.ts'
import { COMMIT_ACTION_TEXT, CHECKS_STEP_TODO, PROGRESS_PRESENTATION_DELAY_MS, RUNNING_CHECKS_TEXT, SHOW_DETAILS_TEXT,
  REVIEW_TODO_ACTION, CHECKS_CANCEL_TEXT, checksFailedTitle, checksProgressShown, commitActionText, commitAndPushText,
  checksProgress as checksProgressOf, checksProgressPopup, indexingWarningVisible, commitCheckReport, failureTexts,
  POST_CHECKS_PROGRESS_TEXT, type CommitCheckFailure, type CommitCheckReport } from './commitChecks.ts'
import {
  checksResultAfter, resetCommitChecks, willSkipCommitChecks, willSkipEarlyCommitChecks,
  willSkipModificationCommitChecks, willSkipPostCommitChecks, commitChecksFingerprint, commitChecksShouldReset,
  type CommitChecksFileRow, type RecentCommitChecks,
} from './commitChecksResult.ts'
import { postCommitCheckFailures, runsChecksAfterCommit, runsChecksBeforeCommit } from './commitOptions.ts'
import { setStatusText } from './statusBarText.ts'
import type { NoticeAction } from './notices.ts'
import type { GitChange } from './bridge.ts'
import type { CommitMessageProblem } from './commitMessageInspection.ts'

/** 这一轮跳过哪些相位（上游 `doExecuteSession:337-340` 的四个 skip 参数里本仓有的那两个）。 */
export interface CommitChecksSkip {
  early: boolean
  modifications: boolean
}

export interface CommitChecksDeps {
  /** 面板的 props（`analyzing`、`showToolWindow`、`dirtyPaths` 三项在这一块里有用）。 */
  props: { analyzing?: boolean; showToolWindow?: (id: string) => void }
  /** 面板的 `emit`（这一块的通知全走它）。 */
  emit: (event: 'notify', message: string, error?: boolean, displayId?: string, detail?: string[],
         actions?: NoticeAction[]) => void
  /** 面板那一个 `act()`：跑操作 → 刷新 → 清掉分支比较。 */
  act: (operation: () => Promise<unknown>, onFailure?: (message: string) => void) => Promise<void>
  /** 「提交」那一个动作（失败通知上的「仍然提交」要点它）。 */
  commit: () => void
  staged: Ref<GitChange[]>
  /** 整份变更列表（指纹要看未暂存的那一半，`:191-199` 判的是"受影响的文件"，不限暂存）。 */
  changes: Ref<CommitChecksFileRow[]>
  message: Ref<string>
  amend: Ref<boolean>
  /** 提交选项里的「提交前检查 TODO」开关与它的忙碌态。 */
  checkTodoBeforeCommit: Ref<boolean>
  todoCheckBusy: Ref<boolean>
  /** TODO 预检本体（吃项目的 TODO 模式，定义在面板里）。 */
  todoHits: () => Promise<number>
  /** 提交信息检查的结果（规则在 src/commitMessageInspection.ts）。 */
  messageProblems: Ref<CommitMessageProblem[]>
  signoff: Ref<boolean>
  postponeSlowChecks: Ref<boolean>
  /** 宿主答"哪些还没保存"的那条通道（上游 `SaveCommittingDocumentsVetoer`）。 */
  dirtyPaths: () => string[]
}

export function createCommitChecks(deps: CommitChecksDeps) {
  const { props, emit, act, commit, staged, changes, message, amend, checkTodoBeforeCommit, todoCheckBusy, todoHits,
          messageProblems, signoff, postponeSlowChecks, dirtyPaths } = deps
  // IDEA's commit check (NonModalCommitWorkflowHandler.checkCommit, :177-184) records which
  // precondition is missing and CommitProgressPanel.buildErrorText() (:321-328) prints that
  // reason right above the commit actions. The Commit button itself only needs a VCS and no
  // running commit (isReady(), :156-159), so it stays clickable and the reason appears on the
  // click — see src/commitCheck.ts for the grouping rules.
  const commitCheckError = ref('')
  // 提交前检查报出来的问题（上游 `FailuresPanel`，`CommitProgressPanel.kt:394`）：**它跟上面那条错误行
  // 不是同一处 UI** —— 错误行说的是"为什么这次不能提交"（空判），这一行说的是"检查发现了什么"。
  // 行只在有 failure 时可见（`isVisible = false` 起步，`:430`；`addFailure` 才显示，`:410`）。
  const checksFailures = ref<CommitCheckFailure[]>([])
  const checksBusy = ref(false)
  /**
   * `isCommitChecksResultUpToDate`（`NonModalCommitWorkflowHandler.kt:83`）—— 上一轮检查的结果。
   * 「仍然提交」那档按钮名与"这次跳过哪些相位"都由它决定，**不是**由失败行有没有内容决定
   * （失败行在下一次跑检查之前一直挂着，`CommitProgressPanel.kt:402-414`）。
   */
  const checksResult = ref<RecentCommitChecks>('unknown')
  /** 这一轮检查的上下文：正文两档（`isOnlyRunCommitChecks`）+ 当前步名 + 是不是提交后那一轮。 */
  const checksRound = ref<{ onlyRunChecks: boolean; step: string | null; postRound: boolean }>(
    { onlyRunChecks: true, step: null, postRound: false })
  /** `willSkipCommitChecks()`（`:229-233`）：上一轮检查已经失败 ⇒ 提交时跳过这些相位、按钮改名叫「仍然{0}」。 */
  const checksSkipped = computed(() => willSkipCommitChecks(checksResult.value))
  // 按钮名的四档（`AbstractCommitWorkflowHandler.kt:226-237`）：提交 / 仍然提交 / 修正提交 / 仍然修正。
  const commitButtonLabel = computed(() => `${commitActionText({
    amend: amend.value, skipChecks: checksSkipped.value,
  })}(${staged.value.length})`)
  // 第二把按钮同样四档（`CommitAndPushExecutor.kt:9-19`）：修正模式下要写「修正提交并推送(P)…」，
  // 检查已失败时要写「仍然…并推送」—— 上一版它是写死的一条「提交并推送(P)」。
  const commitAndPushLabel = computed(() => commitAndPushText({ amend: amend.value, skipChecks: checksSkipped.value }))
  const commitBlockReasonNow = computed(() => commitBlockReason({
    hasStagedChanges: staged.value.length > 0,
    hasMessage: message.value.trim().length > 0,
    amend: amend.value,
  }))
  // CommitProgressPanel.clearError() (:316-319) drops the label as soon as the message or the
  // inclusion change (:146-156 installs the document and inclusion listeners that call it).
  // 注意上游**只**在这里清错误行：失败行要等下一轮检查开始才清（`progressStarted`，`:221-227`），
  // 上一版把失败行也跟着消息一起清掉，于是「仍然提交」的名字和那条刷新按钮会凭空消失。
  watch(message, () => { commitCheckError.value = '' })
  // `resetCommitChecksResult()`（`:246-249`）的触发条件在 `:200-226`：VFS 或文档变了、而且变的文件
  // 是"会影响检查结果"的那些（`:191-199`：在 VCS 下、在内容里、状态不是 IGNORED）。本仓的等价信号 =
  // 变更集指纹（`commitChecksFingerprint`）—— 已经 UNKNOWN 就早退（`:202`/`:218`）。
  watch(() => commitChecksFingerprint(changes.value, dirtyPaths()), () => {
    commitCheckError.value = ''
    if (commitChecksShouldReset(checksResult.value)) checksResult.value = resetCommitChecks()
  })
  function passedCommitCheck(): boolean {
    const reason = commitBlockReasonNow.value
    commitCheckError.value = reason ? commitBlockMessage(reason) : ''
    return reason === null
  }

  /** `skipEarlyCommitChecks` / `skipModificationCommitChecks`（`:337-338`）从状态折算出来。 */
  function skipFromState(): CommitChecksSkip {
    return {
      early: willSkipEarlyCommitChecks(checksResult.value),
      modifications: willSkipModificationCommitChecks(checksResult.value),
    }
  }

  // 进度行的**延迟可见**（上游 `CommitProgressPanel.kt:163-175` 的 `progressFlow.debounce(300.milliseconds)`）：
  // 任务起来 300ms 之后才把那一行挂上去，亚秒级就跑完的检查不该让面板闪一下。
  // 定时器只负责"到点"这一件事，判据本身在 `checksProgressShown`（可测、不依赖墙钟）。
  const checksRowShown = ref(false)
  let checksDelayTimer: ReturnType<typeof setTimeout> | null = null
  function stopChecksDelay() {
    if (checksDelayTimer !== null) clearTimeout(checksDelayTimer)
    checksDelayTimer = null
    checksRowShown.value = false
  }
  function startChecksDelay() {
    stopChecksDelay()
    checksDelayTimer = setTimeout(() => { checksRowShown.value = true }, PROGRESS_PRESENTATION_DELAY_MS)
  }
  // 面板卸载时不能让那个定时器留下（组件销毁后它还会写 ref）。
  onScopeDispose(stopChecksDelay)

  /**
   * 一轮检查的**开头**要做的事（上游 `runWithProgress` + `progressStarted`，`CommitProgressPanel.kt:181-227`）：
   * 挂上指示器、清掉失败行（`:225`），外加会话开头的 `resetCommitChecksResult()`
   * （`NonModalCommitWorkflowHandler.kt:342`）—— 顺序很重要：先清状态，这一轮的结果才是新账。
   */
  function beginChecksRound(onlyRunChecks: boolean, postRound = false) {
    checksRound.value = { onlyRunChecks, step: null, postRound }
    checksFailures.value = []
    checksResult.value = resetCommitChecks()
    startChecksDelay()
  }
  function endChecksRound() {
    checksRound.value = { ...checksRound.value, step: null }
    stopChecksDelay()
  }

  /**
   * 提交前的检查 —— **一处来源**：`commit` / `commitAndPush` / 「运行提交检查」三条路都走它
   * （上游 `checkCommit() → beforeCommitChecks → （只在通过时）performCommit`，见 `src/commitChecks.ts`）。
   *
   * @param skip 跳过哪些相位（`willSkipEarlyCommitChecks` / `willSkipModificationCommitChecks`）。
   *   「运行提交检查」那一把刷新按钮传 `{ early: false, modifications: false }`：
   *   上游的 skip 参数带 `!isOnlyRunCommitChecks` 前缀（`:337-340`），所以只跑检查时**一条都不跳**。
   */
  async function collectCommitChecks(withBlockReason = true, skip: CommitChecksSkip = skipFromState()): Promise<CommitCheckReport> {
    const reason = withBlockReason ? commitBlockReasonNow.value : null
    let hits = 0
    if (checkTodoBeforeCommit.value && !skip.modifications) {
      todoCheckBusy.value = true
      // 步名写进进度行（`commit.checks.only.progress.text.with.context` = 正在运行提交检查: {0}）。
      checksRound.value = { ...checksRound.value, step: CHECKS_STEP_TODO }
      try { hits = await todoHits() } finally { todoCheckBusy.value = false }
    }
    // 提交信息检查是同步的（纯函数 + 现成的 computed），没有"正在进行"的那一瞬间可显示，所以不占步名；
    // 跳过早相位时这一条根本不进失败行（上游 EARLY_FAILED 之后 `runEarlyCommitChecks` 不再跑，`:445-453`）。
    const problems = skip.early ? [] : messageProblems.value
    const stagedPaths = new Set(staged.value.map(change => change.path))
    return commitCheckReport({
      blockReason: reason, todoHits: hits, messageProblems: problems,
      unsaved: dirtyPaths().filter(path => stagedPaths.has(path)),
    })
  }
  /**
   * 「运行提交检查」（`Vcs.RunCommitChecks`，`RunCommitChecksExecutor.kt`）：跑**同一条**检查链但不提交。
   * 上游**没有**常显按钮：用户能看到的那一处是失败行上那把刷新按钮（`RerunCommitChecksAction`，
   * `CommitProgressPanel.kt:492-521`）+ 「仍然提交」跳过检查（`commitAnywayLabel`）；真机取证见审计 §AW。
   * 进度那句话用状态栏文字通道（`commit.checks.only.progress.text` = 正在运行提交检查…）。
   */
  /**
   * 把一轮检查的结果落地（上游 `reportCommitCheckFailure` + `handleCommitProblem`）。
   *
   * @param commitActions 提交路径那条通知才带「仍然提交」这个动作
   *   （`commit.checks.failed.notification.commit.anyway.action`）。
   */
  function applyChecksReport(report: CommitCheckReport, commitActions = false, summary?: string[]) {
    commitCheckError.value = report.blockMessage
    checksFailures.value = report.failures
    // 状态按 `:533-557` 落档（只跑检查且过了 = PASSED；提交路径且过了 = UNKNOWN；失败按相位）。
    checksResult.value = checksResultAfter({
      failures: report.failures,
      onlyRunChecks: checksRound.value.onlyRunChecks,
      postRound: checksRound.value.postRound,
    })
    if (report.failures.length === 0) return
    // 动作照上游 `appendShowDetailsNotificationActions`（NonModalCommitWorkflowHandler.kt:302-316）：
    // 「显示详细信息」= 激活提交工具窗口（`showCommitCheckFailuresPanel`，:317-321）；
    // 「仍然{0}」只在提交路径那条通知上（`commit.checks.failed.notification.commit.anyway.action`）。
    const actions: NoticeAction[] = [{ label: SHOW_DETAILS_TEXT, run: () => props.showToolWindow?.('git') }]
    if (commitActions) actions.push({ label: commitActionText({ amend: amend.value, skipChecks: true }), run: () => commit() })
    emit('notify', checksFailedTitle(COMMIT_ACTION_TEXT), true, undefined, summary ?? failureTexts(report.failures), actions)
  }
  /**
   * 点失败行上那条带详情动作的文字（上游 `FailuresPanel.showDetails` → `failure.viewDetails(...)`，
   * `CommitProgressPanel.kt:468-473`，落点 = `problem.showDetails(project)`，
   * `NonModalCommitWorkflowHandler.kt:523`）。本仓只有 TODO 预检这一条带详情动作，它的上游落点是
   * **TODO 工具窗口**（`TodoCheckinHandler.showTodoItems` 先建一个新内容页再 `toolWindow.show`，
   * `:144-168`）⇒ 这里就是打开那个工具窗口。别的 failure 走不到这里（`details` 为 null ⇒ 不渲染成按钮），
   * 不给它们编一个落点。
   */
  function showFailureDetails(failure: CommitCheckFailure) {
    if (failure.details !== REVIEW_TODO_ACTION) return
    props.showToolWindow?.('todo')
  }
  // IDEA 的 `CommitChecksProgressIndicator`（`CommitProgressPanel.kt:108-130`）在面板里挂的那一行：
  // 标题 + 两档正文（`isOnlyRunCommitChecks` 决定用哪一条）+ 当前步名 + 副文本 + 取消。
  // 最后那个 `running` 参数是**这一行在不在界面上**，由 `checksProgressShown` 折三条判据
  // （在跑 / 失败行为空 / 300ms 延迟已过）—— 直接传 checksBusy 会让亚秒级的检查闪一行。
  const checksProgress = computed(() => checksProgressOf(
    checksRound.value.onlyRunChecks, checksRound.value.step,
    checksProgressShown(checksBusy.value, checksFailures.value.length > 0, checksRowShown.value), true,
    checksRound.value.postRound ? POST_CHECKS_PROGRESS_TEXT : null))
  // 「点进度行弹浮层」（上游 `CommitChecksProgressIndicatorTooltip.kt:23-58`）：任务一停就收掉，下一次从关闭态开始。
  const checksPopupOpen = ref(false); const checksPopup = computed(() => checksProgressPopup(checksProgress.value, checksPopupOpen.value))
  watch(checksBusy, busy => { if (!busy) checksPopupOpen.value = false })
  /** 「项目分析期间某些提交检查不可用」（`CommitProgressPanel.kt:310`）；跑检查时让位给进度行。 */
  const indexingWarning = computed(() => indexingWarningVisible(Boolean(props.analyzing), checksBusy.value))
  /** 取消那一轮检查（上游 `ProgressIndicator.cancel()`）：这一轮的结果回来时不再落地。 */
  function cancelCommitChecks() {
    if (!checksBusy.value) return
    ++checksToken
    checksBusy.value = false
    endChecksRound()
    setStatusText(null, null)
    emit('notify', CHECKS_CANCEL_TEXT)
  }
  let checksToken = 0
  /**
   * 提交后那一轮检查（上游 `NonModalCommitWorkflowHandler` 的 `pendingPostCommitChecks`，
   * `:398-407`：`NON_MODAL_COMMIT_POSTPONE_SLOW_CHECKS` 开着时慢检查不挡提交、提交结束再跑）。
   * 提交已经成功 ⇒ 结果只落到失败行与通知上（正文由 `postCommitCheckFailures` 说明"提交已完成"）。
   *
   * 跳过条件用 `willSkipPostCommitChecks()`（`:243`）：只有**提交后那一轮自己**失败过才不再跑，
   * 免得同一批问题被"仍然提交"之后又数一遍。
   */
  function runPostCommitChecks() {
    if (!runsChecksAfterCommit(commitOptionsNow())) return
    if (willSkipPostCommitChecks(checksResult.value)) return
    const token = ++checksToken
    checksBusy.value = true
    beginChecksRound(false, true)
    void (async () => {
      try {
        const report = await collectCommitChecks(false, { early: false, modifications: false })
        if (token !== checksToken) return
        applyChecksReport(report, false, report.failures.length ? [postCommitCheckFailures(failureTexts(report.failures))] : undefined)
      } finally {
        if (token === checksToken) { checksBusy.value = false; endChecksRound() }
      }
    })()
  }
  function commitOptionsNow() {
    return { signoff: signoff.value, checkTodoBeforeCommit: checkTodoBeforeCommit.value, postponeSlowChecks: postponeSlowChecks.value }
  }
  function runCommitChecks() {
    if (checksBusy.value) return
    const token = ++checksToken
    checksBusy.value = true
    beginChecksRound(true)
    setStatusText(RUNNING_CHECKS_TEXT, null)
    void act(async () => {
      try {
        // 只跑检查 ⇒ 一条相位都不跳（`:337-340` 的 `!isOnlyRunCommitChecks` 前缀）。
        const report = await collectCommitChecks(true, { early: false, modifications: false })
        // 用户按了取消（`cancelCommitChecks` 会 ++checksToken）：这一轮的结果不落地 ——
        // 上游 `ProgressIndicator.cancel()` 之后那个任务的结果同样不会被采纳。
        if (token === checksToken) applyChecksReport(report)
      } finally {
        checksBusy.value = false
        endChecksRound()
        setStatusText(null, null)
      }
    }, failure => {
      checksBusy.value = false
      endChecksRound()
      setStatusText(null, null)
      // 抛错 = 上游 `NonModalCommitChecksFailure.ERROR` 那一档 ⇒ FAILED（`:558-560`）；
      // FAILED 不在四个 willSkip 里 ⇒ 下一次提交照常跑检查（出错不代表"检查过了"）。
      checksResult.value = checksResultAfter({ failures: [], onlyRunChecks: true, error: true })
      throw failure
    })
  }
  /**
   * 提交路径那一轮（上游 `doExecuteSession` 把它包在 `runWithProgress(isOnlyRunCommitChecks = false)` 里，
   * 正文用 `commit.checks.on.commit.progress.text` = 正在提交…）。
   * 「慢检查推后」开着时提交前一条检查都不跑，但**空判照旧**（`checkCommit()` 不是检查，是前置闸，
   * `NonModalCommitWorkflowHandler.kt:177-184`）—— 上一版把整轮连空判一起跳过，所以「仍然提交」
   * 且没有暂存文件时那句「选择要提交的文件」不会出现。
   */
  async function runCommitChecksRound(): Promise<CommitCheckReport> {
    beginChecksRound(false)
    checksBusy.value = true
    try {
      return runsChecksBeforeCommit(commitOptionsNow())
        ? await collectCommitChecks(true, skipFromState())
        : await collectCommitChecks(true, { early: true, modifications: true })
    }
    finally { checksBusy.value = false; endChecksRound() }
  }

  return {
    commitCheckError, checksFailures, checksBusy, checksSkipped, checksResult, commitButtonLabel, commitAndPushLabel,
    passedCommitCheck, collectCommitChecks, skipFromState, runCommitChecksRound, applyChecksReport, showFailureDetails,
    checksProgress, checksPopupOpen, checksPopup,
    indexingWarning, cancelCommitChecks, commitOptionsNow, runPostCommitChecks, runCommitChecks,
  }
}
