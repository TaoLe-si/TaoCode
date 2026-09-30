<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { GitBranch, GitMerge, RefreshCw, Plus, Minus, Check, X, CircleSlash, Download, Upload, History, Tag, Ban, GitPullRequestArrow, Trash2, ChevronDown, Clock, Settings, Undo2, TriangleAlert } from 'lucide-vue-next'
import DiffView from './DiffView.vue'
import { classifyLegend, legendGroups, legendText } from '../commitLegend'
import { commitBlockMessage, commitBlockReason } from '../commitCheck'
import { AMEND_TOOLTIP, AMEND_CHECKBOX_TEXT, COMMIT_MESSAGE_PLACEHOLDER, MESSAGE_HISTORY_TEXT, MESSAGE_HISTORY_DESCRIPTION } from '../commitPanelStrings'
import { amendMessagePlan, restoreBeforeAmendMessage } from '../amendMessage'
import { RUNNING_CHECKS_TEXT, RERUN_CHECKS_TOOLTIP, COMMIT_ACTION_TEXT, checksFailedTitle, commitAnywayLabel,
  commitCheckReport, failuresRowText, saveDuringCommitQuestion, type CommitCheckReport } from '../commitChecks'
import { setStatusText } from '../statusBarText'
import { COMMIT_CANCELED, COMMIT_NOTIFICATION_ID, commitNotificationRows, commitNotificationTitle, countCommittedPaths } from '../commitNotification'
import { authorEmailPart, authorNamePart, extendsBeyondDefault, fullName, knownAuthors, shortName, splitAuthorInput, type CommitAuthor } from '../commitAuthor'
import {
  addBlankLineAfterSubject,
  exceedingText,
  FIX_LABELS,
  inspectCommitMessage,
  messageLines,
  reformatCommitMessage,
  wrapLine,
  wrapOnTyping,
  type CommitMessageFix,
  type CommitMessageInspectionSettings,
  type CommitMessageProblem,
} from '../commitMessageInspection'
import { request, type SearchResult, type DiffRow, type DiffSides, type GitAheadBehind, type GitChange, type GitCommitDetails, type GitCompare, type GitCompareFile, type GitHunks, type GitLog, type GitStatus, type GitTags, type TodoPattern } from '../bridge'

const props = defineProps<{
  root: string
  active: boolean
  todoPatterns: TodoPattern[]
  /** 统一 diff 的上下文行数（IDEA diff 设置 settings.context.lines；0/未传 = git 默认）。 */
  diffContextLines?: number
  /** IDEA's commit-message inspections (Settings › Version Control › Commit). */
  commitSettings: CommitMessageInspectionSettings
  /** 「与某分支比较」的目标（工具栏分支弹窗 → 比较）：设好后本面板直接跑一次比较。 */
  compareWith?: string
  /**
   * 还没保存的路径（宿主的编辑器标签）。上游 `SaveCommittingDocumentsVetoer` 在提交期间要问
   * "这些文件要不要立即保存"，本仓由宿主回答"哪些没存"。
   */
  dirtyPaths?: () => string[]
  /** 保存某个路径（宿主 `save(tab)`）：提交期间选「立即保存」时用。 */
  savePath?: (path: string) => Promise<unknown>
}>()
const status = ref<GitStatus>({ available: true, changes: [] })
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const message = ref('')
const amend = ref(false)
// `ToggleAmendCommitOption.kt:23` tooltip = VcsBundle.properties:1163
// `commit.tooltip.merge.this.commit.with.the.previous.one`, plus the `VK_M` mnemonic of `:19`.
interface DiffState { path: string; staged: boolean; base: string; text: string; rows: DiffRow[]; truncated: boolean; hunks?: GitHunks; hunkPicked?: Set<number> }
const diff = ref<DiffState | null>(null)
const hunkError = ref('')
const compareBase = ref('')
const compareTo = ref('')
const compared = ref<GitCompareFile[]>([])

const changes = computed(() => status.value.changes ?? [])
const staged = computed(() => changes.value.filter(change => change.staged))
const unstaged = computed(() => changes.value.filter(change => !change.staged))
const branches = computed(() => status.value.branches ?? [])
// --- IDEA's commit legend (vcs/commit/CommitStatusPanel.kt:19-78) ----------------
// The legend sums up the *included* (staged) changes only — not everything the tree
// displays. Grouping and formatting live in src/commitLegend.ts (ChangeInfoCalculator
// .kt:7-9,16-26 and CommitLegendPanel.kt:36-68) so they can be tested on their own.
const legendCounts = computed(() => classifyLegend(staged.value))
// Each group keeps its own colour (CommitLegendPanel.kt:48-58 appends them with the
// file-status attributes), so the rows are rendered individually rather than as one string.
const legendRows = computed(() => legendGroups(legendCounts.value))
const legendFullText = computed(() => legendText(legendRows.value, false))
// adjustLegendToFitPanel (:63-78) switches to the compact legend once the full string
// stops fitting the width the panel gives it, and re-checks after every resize
// (componentResized listener, :33-37).
const legendRef = ref<HTMLElement | null>(null)
const legendProbe = ref<HTMLElement | null>(null)
const legendCompact = ref(false)
let legendObserver: ResizeObserver | null = null
function measureLegend() {
  const wrapper = legendRef.value
  const probe = legendProbe.value
  if (!wrapper || !probe) return
  const style = getComputedStyle(wrapper)
  const available = wrapper.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  if (available <= 0) return
  legendCompact.value = probe.getBoundingClientRect().width > available
}
const ahead = ref<GitAheadBehind>({ available: false, ahead: 0, behind: 0 })
// Secondary reads (remote status, stash count, tags, hunk list) must not fail the
// whole panel, but they must not fail silently either.
const extrasError = ref('')
const tagsError = ref('')
const newBranch = ref('')
const mergeBranch = ref('')

function errorText(caught: unknown) { return caught instanceof Error ? caught.message : String(caught) }
// Every status read carries a token: another project taking over mid-request makes
// the answer stale, and applying it would show a foreign repository's changes here.
let statusToken = 0
async function load() {
  const token = ++statusToken
  loading.value = true
  error.value = ''
  try {
    const result = await request<GitStatus>('git.status')
    if (token !== statusToken) return
    status.value = result
    void refreshExtras()
  }
  catch (caught) { if (token === statusToken) error.value = errorText(caught) }
  finally { if (token === statusToken) loading.value = false }
  void loadTags()
}
async function refreshExtras() {
  const token = statusToken
  const problems: string[] = []
  try { ahead.value = await request<GitAheadBehind>('git.aheadBehind') }
  catch (caught) { ahead.value = { available: false, ahead: 0, behind: 0 }; problems.push(`读取远程领先/落后失败：${errorText(caught)}`) }
  if (token === statusToken) extrasError.value = problems.join('；')
}
// ShowNotificationCommitResultHandler.kt:24-98 — the outcome of a commit is reported through a
// notification whose title carries the worst result and whose body carries the commit message plus
// the failures (`getCommitSummary`, :100-116); `onCancel` (:29-31) is a content-free
// 「提交已取消」 warning. `expirePreviousAndNotify` (:97) is implemented by App.vue keying the
// notification with `COMMIT_NOTIFICATION_ID`, so the previous commit result is replaced.
// Not ported: the extension-point actions (`CommitSuccessNotificationActionProvider`, :76-78) and
// the exception actions (`CommitExceptionWithActions`, :63-74) — TaoCode has no plugin EPs, and its
// notification rows carry no action buttons.
const emit = defineEmits<{ notify: [message: string, error?: boolean, displayId?: string, detail?: string[]] }>()
// 提交检查与"提交期间保存文件"要问宿主两件事：哪些要提交的文件还没保存、以及怎么保存它们
// （上游 `SaveCommittingDocumentsVetoer` + `FileDocumentManager.saveDocument`）。
function dirtyPaths(): string[] { return props.dirtyPaths?.() ?? [] }
function savePath(path: string): Promise<unknown> { return props.savePath ? props.savePath(path) : Promise.resolve() }
function reportCommitResult(text: string, stagedPaths: readonly string[], failures: readonly string[]) {
  const committed = countCommittedPaths(stagedPaths)
  emit(
    'notify',
    commitNotificationTitle({ committed, exceptions: failures.length, errors: failures.length }),
    failures.length > 0,
    COMMIT_NOTIFICATION_ID,
    commitNotificationRows(text, [], failures),
  )
}
function reportCommitCanceled() {
  emit('notify', COMMIT_CANCELED, false, COMMIT_NOTIFICATION_ID, [])
}
async function act(operation: () => Promise<unknown>, onFailure?: (message: string) => void) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { await operation(); await load() }
  catch (caught) { error.value = errorText(caught); onFailure?.(error.value) }
  finally {
    busy.value = false
    // Any git operation can change the branch comparison: invalidate it so the next
    // render reflects the new repo state.
    compared.value = []
    void loadTags()
  }
}
const stage = (path: string) => act(() => request('git.stage', { path }))
// IDEA's Rollback (ChangesView.Rollback): discard the working-tree changes of one
// path. Rollback is destructive, so it carries IDEA's confirm dialog
// (VcsBundle rollback.confirm.text) before touching anything.
const rollback = (path: string) => act(() => request('git.revert', { path }))
function rollbackConfirm(path: string) {
  if (window.confirm(`回滚 ${path} 的工作区改动？
未暂存的修改将丢失，无法撤销。`)) rollback(path)
}
const unstage = (path: string) => act(() => request('git.unstage', { path }))
// IDEA's commit check (NonModalCommitWorkflowHandler.checkCommit, :177-184) records which
// precondition is missing and CommitProgressPanel.buildErrorText() (:321-328) prints that
// reason right above the commit actions. The Commit button itself only needs a VCS and no
// running commit (isReady(), :156-159), so it stays clickable and the reason appears on the
// click — see src/commitCheck.ts for the grouping rules.
const commitCheckError = ref('')
// 提交前检查报出来的问题（上游 `FailuresPanel`，`CommitProgressPanel.kt:394`）：**它跟上面那条错误行
// 不是同一处 UI** —— 错误行说的是"为什么这次不能提交"（空判），这一行说的是"检查发现了什么"。
// 行只在有 failure 时可见（`isVisible = false` 起步，`:430`；`addFailure` 才显示，`:441`），
// 行上是：警告图标 + 各条 failure 的文本 + 跑「重新运行提交检查」的刷新按钮（`:492-521`）。
const checksFailures = ref<string[]>([])
const checksBusy = ref(false)
/** `willSkipCommitChecks()`（`NonModalCommitWorkflowHandler.kt:229-233`）：上一轮检查已经失败 ⇒ 提交时跳过检查、按钮改叫「仍然提交」。 */
const checksSkipped = computed(() => checksFailures.value.length > 0)
const commitButtonLabel = computed(() => `${checksSkipped.value ? commitAnywayLabel() : COMMIT_ACTION_TEXT}(${staged.value.length})`)
const commitBlockReasonNow = computed(() => commitBlockReason({
  hasStagedChanges: staged.value.length > 0,
  hasMessage: message.value.trim().length > 0,
  amend: amend.value,
}))
// CommitProgressPanel.clearError() (:316-319) drops the label as soon as the message or the
// inclusion change (:146-156 installs the document and inclusion listeners that call it).
// `resetCommitChecksResult()` (:240-243) does the same for the *check results* on a document
// change (the listener at :216-226) — so the failures row and the "Commit Anyway" button name
// go back to normal as soon as the user edits the message or changes what is included.
watch(message, () => { commitCheckError.value = ''; checksFailures.value = [] })
watch(() => staged.value.length, () => { commitCheckError.value = ''; checksFailures.value = [] })
function passedCommitCheck(): boolean {
  const reason = commitBlockReasonNow.value
  commitCheckError.value = reason ? commitBlockMessage(reason) : ''
  return reason === null
}
// IDEA's CommitAuthorComponent (vcs/commit/CommitAuthorComponent.kt:38-121) sits between the
// commit checks panel and the action buttons (NonModalCommitPanel.kt:76-79) and shows
// "By <author>" — but only while an author is actually set (:73-77 `userViewer.isVisible =
// userViewer.user != null`; the value starts as the change list's author, i.e. usually null).
// The *input* belongs to the commit options popup instead: GitCommitOptionsUi.kt:136-153 puts
// `row(commit.author)` first, above the amend / sign-off / renames rows.
const repositoryAuthor = ref<CommitAuthor>({ name: '', email: '' })
const authorOverride = ref<CommitAuthor | null>(null)
const authorDraft = reactive<CommitAuthor>({ name: '', email: '' })
const effectiveAuthor = computed(() => authorOverride.value ?? repositoryAuthor.value)
// GitCommitOptionsUi.kt:259 — the field completes over `getAllUsers(project) + settings.commitAuthors`,
// i.e. the authors the log has seen plus the ones saved from earlier commits.
const knownAuthorEntries = ref<string[]>([])
function authorStorageKey() { return `taocode.commitAuthors:${props.root}` }
function readSavedAuthors(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(authorStorageKey()) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch { return [] }
}
function saveUsedAuthor(entry: string) {
  const saved = knownAuthors(readSavedAuthors(), [entry])
  try { localStorage.setItem(authorStorageKey(), JSON.stringify(saved)) } catch { /* storage unavailable: session-only */ }
  knownAuthorEntries.value = knownAuthors(knownAuthorEntries.value, [entry])
}
// The two fields replace IDEA's single "Name <email>" text field, so the log's exact strings
// are split back into the halves the inputs edit (VcsUserUtil.getString :24-28).
const knownNames = computed(() => [...new Set(knownAuthorEntries.value.map(authorNamePart).filter(Boolean))])
const knownEmails = computed(() => [...new Set(knownAuthorEntries.value.map(authorEmailPart).filter(Boolean))])
async function loadAuthor() {
  try {
    const user = await request<CommitAuthor>('git.user')
    repositoryAuthor.value = { name: user.name ?? '', email: user.email ?? '' }
  } catch { repositoryAuthor.value = { name: '', email: '' } }
  knownAuthorEntries.value = knownAuthors([], readSavedAuthors())
  try {
    const listed = await request<{ authors?: string[] }>('git.authors')
    knownAuthorEntries.value = knownAuthors(listed.authors ?? [], readSavedAuthors())
  } catch { /* completion is a convenience: a repo without a log just has none */ }
}
// The options popup owns the input, so opening it seeds the draft the way setAuthor (:205-213)
// does: from the current author, empty when there is none (it is deliberately not pre-filled
// with the repository default — IDEA leaves the field blank until you type something).
function openOptions() {
  optionsOpen.value = true
  authorDraft.name = authorOverride.value?.name ?? ''
  authorDraft.email = authorOverride.value?.email ?? ''
}
// Enter applies, exactly like the popup's VcsUserEditor keyboard action (:111-113).
function applyAuthorEditor() {
  const draft = splitAuthorInput(authorDraft.name, authorDraft.email)
  // GitCommitOptionsUi.kt:205-213 — a null or default author leaves the field empty, so
  // re-entering the repository's own person (in any casing) is not an override.
  authorOverride.value = extendsBeyondDefault(draft, repositoryAuthor.value) ? draft : null
  if (authorOverride.value) saveUsedAuthor(fullName(authorOverride.value))
}
// GitCommitOptionsUi.kt:238-251 raises a warning when the author is set and differs from the
// default (GitBundle.properties:50 "Author differs from default").
const authorWarning = computed(() => extendsBeyondDefault(authorOverride.value, repositoryAuthor.value))
// VcsDateViewer's close button removes the author and the date again (:117-120).
function clearAuthorOverride() {
  authorOverride.value = null
  authorDraft.name = ''
  authorDraft.email = ''
}
/**
 * 提交前的检查 —— **一处来源**：`commit` / `commitAndPush` / 「运行提交检查」三条路都走它
 * （上游 `checkCommit() → beforeCommitChecks → （只在通过时）performCommit`，见 `src/commitChecks.ts`）。
 * 原先 TODO 预检在 `commit` 与 `commitAndPush` 里各写了一遍。
 */
async function collectCommitChecks(): Promise<CommitCheckReport> {
  const reason = commitBlockReason({
    hasStagedChanges: staged.value.length > 0, hasMessage: message.value.trim().length > 0, amend: amend.value,
  })
  let hits = 0
  if (checkTodoBeforeCommit.value) {
    todoCheckBusy.value = true
    try { hits = await todoHits() } finally { todoCheckBusy.value = false }
  }
  const stagedPaths = new Set(staged.value.map(change => change.path))
  return commitCheckReport({
    blockReason: reason, todoHits: hits, messageProblems: messageProblems.value,
    unsaved: dirtyPaths().filter(path => stagedPaths.has(path)),
  })
}
/**
 * 「运行提交检查」（`Vcs.RunCommitChecks`，`RunCommitChecksExecutor.kt`）：跑**同一条**检查链但不提交。
 * 上游**没有**常显按钮：用户能看到的那一处是失败行上的刷新按钮（`RerunCommitChecksAction`，
 * `CommitProgressPanel.kt:492-521`，工具提示 `tooltip.rerun.commit.checks` = 重新运行提交检查），
 * 而失败行本身只在检查报出 failure 之后才出现 —— 所以这里也只在 `checksFailures` 非空时才有这个按钮。
 * 进度那句话用状态栏文字通道（`commit.checks.only.progress.text` = 正在运行提交检查…）。
 *
 * 结果怎么落地也照上游：空判没过 ⇒ 只有面板错误行（上游这次会话是 `Cancelled`，不发通知，`:562-564`）；
 * 检查报出 failure ⇒ 失败行 + 一条标题为 `{0} 检查失败` 的通知（`:284-291`）；全过了 ⇒ 什么都不发、失败行消失。
 */
function applyChecksReport(report: CommitCheckReport) {
  commitCheckError.value = report.blockMessage
  checksFailures.value = report.failures
  if (report.failures.length > 0) emit('notify', checksFailedTitle(), true, undefined, report.failures)
}
function runCommitChecks() {
  if (checksBusy.value) return
  checksBusy.value = true
  setStatusText(RUNNING_CHECKS_TEXT, null)
  void act(async () => {
    try {
      applyChecksReport(await collectCommitChecks())
    } finally {
      checksBusy.value = false
      setStatusText(null, null)
    }
  }, failure => {
    checksBusy.value = false
    setStatusText(null, null)
    throw failure
  })
}
/**
 * 提交期间保存文件（上游 `SaveCommittingDocumentsVetoer.confirmSave`：标题「在提交期间保存文件」、
 * 按钮「立即保存」/「延迟保存」）。选"延迟保存"就照常提交磁盘上的版本 —— 上游也是这个意思。
 */
async function confirmSaveDuringCommit(stagedPaths: readonly string[]) {
  if (!props.savePath) return
  const unsaved = dirtyPaths().filter(path => stagedPaths.includes(path))
  if (!unsaved.length) return
  if (!window.confirm(saveDuringCommitQuestion(unsaved))) return
  for (const path of unsaved) await savePath(path)
}

const commit = () => {
  // Ctrl+Enter reaches here even while the button is disabled, so say why nothing
  // happened instead of silently doing nothing.
  if (!passedCommitCheck()) return
  const text = message.value.trim()
  // `changesCommitted = changes - failedToCommitChanges` (ShowNotificationCommitResultHandler.kt:42-43):
  // the count is taken from what was included in this commit, before the tree reloads.
  const stagedPaths = staged.value.map(change => change.path)
  void act(async () => {
    // 上一轮检查已经失败 ⇒ 这次不再跑检查，直接提交（`willSkipCommitChecks()` 那条路：
    // 按钮此时写的是「仍然提交」）。
    const report = checksSkipped.value ? null : await collectCommitChecks()
    if (report && !report.ok) {
      // 上游 `CommitProgressPanel.buildErrorText`：理由写在面板那条错误行上，提交不跑。
      applyChecksReport(report)
      return
    }
    commitCheckError.value = ''
    await confirmSaveDuringCommit(stagedPaths)
    await request('git.commit', {
      message: text, amend: amend.value, signoff: signoff.value,
      // An override only rides this commit; native refuses it without an e-mail
      // (git commit --author needs "Name <email>").
      author: authorOverride.value?.name ?? '', authorEmail: authorOverride.value?.email ?? '',
    })
    reportCommitResult(text, stagedPaths, [])
    message.value = ''
    amend.value = false
    // 提交会话结束 ⇒ `CommitStateCleaner.resetState()`（:634-641）里的 `resetCommitChecksResult()`。
    checksFailures.value = []
  }, failure => reportCommitResult(text, stagedPaths, [failure]))
}
// IDEA's second action in ChangesViewCommitPanel: commit the included changes, then
// push the branch in the same gesture. A push failure still surfaces through act().
const commitAndPush = () => {
  if (!passedCommitCheck()) return
  const text = message.value.trim()
  const stagedPaths = staged.value.map(change => change.path)
  // The commit result notification belongs to the *commit* half; a later push failure is a separate
  // operation (IDEA pushes through the git plugin's own action), so it must not be reported as a
  // failed commit — it keeps the generic error notification instead.
  let committed = false
  void act(async () => {
    const report = checksSkipped.value ? null : await collectCommitChecks()
    if (report && !report.ok) { applyChecksReport(report); return }
    commitCheckError.value = ''
    await confirmSaveDuringCommit(stagedPaths)
    await request('git.commit', {
      message: text, amend: amend.value, signoff: signoff.value,
      // An override only rides this commit; native refuses it without an e-mail
      // (git commit --author needs "Name <email>").
      author: authorOverride.value?.name ?? '', authorEmail: authorOverride.value?.email ?? '',
    })
    committed = true
    checksFailures.value = []
    reportCommitResult(text, stagedPaths, [])
    message.value = ''
    amend.value = false
    await request('git.push')
  }, failure => { if (!committed) reportCommitResult(text, stagedPaths, [failure]) })
}
// The changes list collapses like IDEA's commit tab: the tree header carries 展开 on the right.
const changesCollapsed = ref(false)
// IDEA's commit-message inspections (vcs/commit/message/): the subject line and every body line
// are checked against their right margins, and line 1 has to be empty before the body starts.
// The rules live in src/commitMessageInspection.ts so they can be tested without a DOM.
const messageBox = ref<HTMLTextAreaElement | null>(null)
const messageProblems = computed(() => inspectCommitMessage(message.value, props.commitSettings))
// IDEA reports the problem on the offending range and offers the fixes that range can take
// (BaseCommitMessageInspection.checkRightMargin takes `vararg fixes`, :146).
function focusProblem(problem: CommitMessageProblem) {
  const box = messageBox.value
  if (!box) return
  // Document offset of the problem's range start: every earlier line plus its separator.
  const offset = messageLines(message.value)
    .slice(0, problem.line)
    .reduce((total, line) => total + line.length + 1, 0)
  box.focus()
  box.setSelectionRange(offset + problem.start, offset + problem.end)
}
function applyFix(problem: CommitMessageProblem, fix: CommitMessageFix) {
  if (fix === 'blankLine') { message.value = addBlankLineAfterSubject(message.value); return }
  if (fix === 'reformat') { message.value = reformatCommitMessage(message.value, props.commitSettings); return }
  // WrapLineQuickFix (:75-81) wraps the range of the reported line only.
  const lines = messageLines(message.value)
  lines.splice(problem.line, 1, ...wrapLine(lines[problem.line] ?? '', props.commitSettings.bodyRightMargin))
  message.value = lines.join('\n')
}
// IDEA's ReformatCommitMessageAction (ReformatCommitMessageAction.java:54-59) runs the reformat of
// every enabled inspection: the separation check inserts the missing blank line, the body limit
// wraps the body lines to its margin. It does not touch the subject (SubjectLimitInspection has no
// reformat) and it does not tidy whitespace — `CommitMessage.getComment()` only trims the trailing
// whitespace of the whole message (:300-302), which the commit itself already does.
// 进 amend 模式就把「上次提交的信息」填进输入框、退出时还原草稿（上游 `AmendCommitHandlerImpl`
// 的 `setAmendMessage` / `restoreBeforeAmendMessage`，判据 `tests/amend-message.test.mjs`）。
let amendDraft: string | null = null
let beforeAmendMessage: string | null = null
watch(amend, value => {
  if (!value) {
    const restored = restoreBeforeAmendMessage(message.value, amendDraft, beforeAmendMessage)
    amendDraft = null
    beforeAmendMessage = null
    if (restored !== null) message.value = restored
    return
  }
  void (async () => {
    try {
      const details = await request<GitCommitDetails>('git.commitDetails', { revision: 'HEAD' })
      const plan = amendMessagePlan(message.value, details.message)
      if (plan.fill === null) return
      amendDraft = plan.fill
      beforeAmendMessage = plan.before
      message.value = plan.fill
      void nextTick(() => messageBox.value?.focus())
    } catch (caught) {
      // 还没有 HEAD（新仓库）就没有可改写的提交信息 —— 上游那边也是空手回来。
      error.value = errorText(caught)
    }
  })()
})
function reformatMessage() {
  message.value = reformatCommitMessage(message.value, props.commitSettings)
}
// WRAP_WHEN_TYPING_REACHES_RIGHT_MARGIN (VcsConfiguration.java:74 → CommitMessage.java:340): the
// line being typed hard-wraps once it reaches the right margin. A change that came from the model
// (history pick, rollback, a quick fix above) must not be rewritten behind the user's back, so the
// hook only fires while the textarea already holds the new text — which is only true for typing.
watch(message, value => {
  const box = messageBox.value
  if (!box || !props.commitSettings.wrapOnTyping || box.value !== value) return
  const wrapped = wrapOnTyping(value, box.selectionStart ?? value.length, props.commitSettings.bodyRightMargin)
  if (wrapped.text === value) return
  message.value = wrapped.text
  void nextTick(() => { box.selectionStart = box.selectionEnd = wrapped.caret })
})
// IDEA's commit options popup (ChangesView.ShowCommitOptions). Only options with a
// real backend are offered: Git's Signed-off-by trailer (GitCommitOptions.kt:92) and
// a pre-commit TODO scan that reuses the project's own TODO patterns.
const optionsOpen = ref(false)
const todoCheckBusy = ref(false)
// IDEA's "commit checks" run before the commit is created; this one reuses the
// project's own TODO patterns through the real Find in Files engine.
async function todoHits(): Promise<number> {
  let total = 0
  for (const entry of props.todoPatterns) {
    try {
      const result = await request<SearchResult>('search.run', {
        query: entry.pattern, regex: true, caseSensitive: false, wholeWord: false, include: '', exclude: '',
      })
      total += result.matches?.length ?? 0
    } catch (caught) { error.value = errorText(caught) }
  }
  return total
}
const signoff = ref(false)
const checkTodoBeforeCommit = ref(false)
// IDEA's commit message history: previous subjects, click to reuse one.
const messageHistoryOpen = ref(false)
const messageHistory = ref<string[]>([])
const messageHistoryLoading = ref(false)
const toggleMessageHistory = () => {
  messageHistoryOpen.value = !messageHistoryOpen.value
  if (!messageHistoryOpen.value) return
  messageHistoryLoading.value = true
  void (async () => {
    try {
      const log = await request<GitLog>('git.log')
      // Keep it a message history: subjects only, newest first, duplicates dropped.
      const seen = new Set<string>()
      messageHistory.value = log.commits.map(entry => entry.subject).filter(subject => {
        if (!subject || seen.has(subject)) return false
        seen.add(subject)
        return true
      }).slice(0, 12)
    } catch (caught) { error.value = errorText(caught) }
    finally { messageHistoryLoading.value = false }
  })()
}
const checkout = (branch: string) => act(() => request('git.checkout', { branch }))
// `Vcs.UpdateProject`（与 `Vcs.Push` 同在 `VcsToolbarActions`，VcsActions.xml:416-425）：
// 先刷新远端（fetch）再做整合（pull）—— 与 Git 菜单那条宿主实现（`src/vcsActions.ts`）同义。
const updateProject = () => act(async () => { await request('git.fetch'); await request('git.pull') })
const push = () => act(() => request('git.push'))
// IDEA Git menu rows: Fetch (refresh remotes), Rebase onto upstream, branch delete,
// the Tag dialog, "Add to .gitignore" for untracked rows.
const fetch = () => act(() => request('git.fetch'))
const deleteBranch = () => { const name = mergeBranch.value.trim(); if (!name || name === status.value.head) return; void act(() => request('git.branch.delete', { name })) }
const ignore = (path: string) => act(() => request('git.ignore', { path }))
const tagName = ref('')
const createTag = () => { const name = tagName.value.trim(); if (!name) return; void act(async () => { await request('git.tag.create', { name }); tagName.value = '' }) }
async function deleteTag(name: string) { await act(() => request('git.tag.delete', { name })) }
const tags = ref<string[]>([])
async function loadTags() {
  const token = statusToken
  try { tags.value = (await request<GitTags>('git.tags')).tags; if (token === statusToken) tagsError.value = '' }
  catch (caught) { tags.value = []; if (token === statusToken) tagsError.value = `读取标签失败：${errorText(caught)}` }
}
async function applyHunks(reverse: boolean) {
  if (!diff.value || !diff.value.hunks) return
  const selectedIndexes = diff.value.hunks.hunks.filter(hunk => diff.value?.hunkPicked?.has(hunk.index)).map(hunk => hunk.index)
  if (!selectedIndexes.length) return
  const target = { path: diff.value.path, staged: diff.value.staged }
  await act(async () => {
    await request('git.applyHunks', { ...target, hunks: selectedIndexes, reverse })
    await showDiff(target)
  })
}
function toggleHunk(index: number) {
  if (!diff.value) return
  diff.value.hunkPicked ??= new Set()
  if (diff.value.hunkPicked.has(index)) diff.value.hunkPicked.delete(index)
  else diff.value.hunkPicked.add(index)
  // Set mutation needs a fresh Set to stay reactive for the checkbox binding.
  diff.value.hunkPicked = new Set(diff.value.hunkPicked)
}
const createBranch = () => { const name = newBranch.value.trim(); if (!name) return; void act(async () => { await request('git.branch.create', { name, checkout: true }); newBranch.value = '' }) }
const mergeBranchInto = () => { const name = mergeBranch.value.trim(); if (!name) return; void act(() => request('git.merge', { branch: name })) }
async function showDiff(target: { path: string; staged: boolean; base?: string }) {
  const base = target.base ?? ''
  hunkError.value = ''
  // context：把设置里的 diff 上下文行数透给 native（拼成 git 的 -U<n>）。
  const params = base
    ? { path: target.path, staged: target.staged, base, context: props.diffContextLines ?? 0 }
    : { path: target.path, staged: target.staged, context: props.diffContextLines ?? 0 }
  try {
    // Both views come from the same `git diff`; the aligned rows are parsed natively
    // from that text, so the two modes can never disagree.
    const [unified, sides] = await Promise.all([
      request<{ diff: string }>('git.diff', params),
      request<DiffSides>('git.diffSides', params),
    ])
    // Compare views have no side to stage into; only the working/index diff carries
    // selectable hunks (IDEA's commit viewer).
    let hunks: GitHunks | undefined
    if (!base) {
      try { hunks = await request<GitHunks>('git.diffHunks', { path: target.path, staged: target.staged }) }
      catch (caught) { hunks = undefined; hunkError.value = `读取改动块失败，只能整体暂存：${errorText(caught)}` }
    }
    diff.value = {
      path: target.path, staged: target.staged, base,
      text: unified.diff || '（无差异；可能是未跟踪文件）',
      rows: sides.rows ?? [], truncated: sides.truncated === true,
      hunks, hunkPicked: new Set(),
    }
  } catch (caught) { error.value = errorText(caught) }
}
// 外部请求的「与某分支比较」（分支弹窗 → 比较）：设好 base 后直接跑一次，
// 结果就出现在本面板已有的比较列表里（不另造一套展示）。
watch(() => props.compareWith, base => {
  if (!base) return
  compareBase.value = base
  runCompare()
})
function runCompare() {
  const base = compareBase.value
  if (!base) { compared.value = []; compareTo.value = ''; return }
  void act(async () => {
    const result = await request<GitCompare>('git.compare', { base })
    compared.value = result.files
    compareTo.value = base
  })
}
function clearCompare() {
  compareBase.value = ''
  compared.value = []
  compareTo.value = ''
}

// `ToggleAmendCommitOption.kt:19` gives the amend checkbox the mnemonic `KeyEvent.VK_M`, and
// `:23` its tooltip (`VcsBundle.properties:1163
// commit.tooltip.merge.this.commit.with.the.previous.one`). A Swing mnemonic fires while the
// component's window is active, which here is this panel being the shown tool window (`props.active`);
// the checkbox is disabled while a commit runs, so the key must be ignored then as well.
function onAmendMnemonic(event: KeyboardEvent) {
  if (!amendTooltipEnabled()) return
  if (!event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) return
  if (event.key.toLowerCase() !== 'm') return
  event.preventDefault()
  amend.value = !amend.value
}
function amendTooltipEnabled() { return props.active && !busy.value }
onMounted(() => {
  void load()
  void loadAuthor()
  window.addEventListener('keydown', onAmendMnemonic)
  // Re-measure the legend once it is in the DOM, then on every size change and every
  // time the counts change (the inclusion listener of the source fires updateLegend).
  measureLegend()
  if (typeof ResizeObserver !== 'undefined' && legendRef.value) {
    legendObserver = new ResizeObserver(() => measureLegend())
    legendObserver.observe(legendRef.value)
  }
})
onBeforeUnmount(() => {
  legendObserver?.disconnect()
  legendObserver = null
  window.removeEventListener('keydown', onAmendMnemonic)
})
watch(legendFullText, () => void nextTick(measureLegend))
watch(() => [props.root, props.active] as const, () => {
  if (!props.active) return
  // Switching projects invalidates the per-project comparison and history panel,
  // plus any status request still running for the previous root.
  statusToken++
  extrasError.value = ''
  tagsError.value = ''
  compareBase.value = ''
  compareTo.value = ''
  compared.value = []
  // The author comes from the repository configuration, so a new project needs a re-read
  // and any override made for the previous repository must not leak into it.
  authorOverride.value = null
  authorDraft.name = ''
  authorDraft.email = ''
  optionsOpen.value = false
  void loadAuthor()
  void load()
})
</script>

<template>
  <div class="sc-panel">
    <div class="sc-header">
      <GitBranch :size="14" />
      <select class="sc-branch" :value="status.head" :disabled="busy || !branches.length" aria-label="当前分支" @change="checkout(($event.target as HTMLSelectElement).value)">
        <option v-if="status.head" :value="status.head">{{ status.head }}</option>
        <option v-for="branch in branches.filter(name => name !== status.head)" :key="branch" :value="branch">{{ branch }}</option>
      </select>
      <button class="icon-button" title="刷新" aria-label="刷新 Git 状态" :disabled="loading || busy" @click="load"><RefreshCw :size="14" /></button>
    </div>
    <div v-if="!status.available" class="sc-empty"><CircleSlash :size="22" /><p>未找到 Git</p><span>安装 Git 并加入 PATH 后可使用版本控制。</span></div>
    <template v-else>
      <div class="sc-commit">
        <textarea ref="messageBox" v-model="message" rows="3" :placeholder="COMMIT_MESSAGE_PLACEHOLDER" aria-label="提交消息" :disabled="busy" @keydown.ctrl.enter.prevent="commit" @keydown.ctrl.shift.enter.prevent="commitAndPush" />
        <!-- IDEA's commit-message inspections: the reported range is underlined in the commit
             message editor; here each problem names its line, shows the exact substring IDEA
             would highlight, and offers the same quick fixes. -->
        <div v-if="messageProblems.length" class="sc-msg-inspections" role="alert" aria-label="提交信息检查" title="IDEA 的提交信息检查；右边距与开关在「设置 › 版本控制 › 提交」里调整">
          <p v-for="problem in messageProblems" :key="`${problem.kind}:${problem.line}`" class="sc-inspection-row">
            <button type="button" class="sc-inspection-line" :title="`选中第 ${problem.line + 1} 行中超出边距的部分`" @click="focusProblem(problem)">第 {{ problem.line + 1 }} 行</button>
            <span class="sc-inspection-text">{{ problem.message }}</span>
            <code class="sc-inspection-excess" :title="`超出范围：[${problem.start}, ${problem.end})`">{{ exceedingText(message, problem) }}</code>
            <button v-for="fix in problem.fixes" :key="fix" type="button" class="sc-tool sc-inspection-fix" :disabled="busy" :title="`${FIX_LABELS[fix]}（IDEA 的快捷修复）`" @click="applyFix(problem, fix)">{{ FIX_LABELS[fix] }}</button>
          </p>
        </div>
        <div v-if="messageHistoryOpen" class="sc-msg-history">
          <p v-if="messageHistoryLoading" class="sc-empty-line">正在读取历史提交信息…</p>
          <p v-else-if="!messageHistory.length" class="sc-empty-line">暂无历史提交信息。</p>
          <template v-else>
            <button v-for="subject in messageHistory" :key="subject" class="sc-msg-row" :title="`使用这条提交信息：${subject}`" @click="message = subject; messageHistoryOpen = false">{{ subject }}</button>
          </template>
        </div>
      </div>
      <div class="sc-changes-head">
        <!-- TODO(第四十七批)：上游哪条动作管变更树的折叠还没找到（候选 ChangesViewToggleChangesTreeGroup 一类），
             先留在这里并登记在 docs/source-todo.md §17 —— 不加引文。 -->
        <button class="sc-tool" :disabled="busy || !changes.length" :title="changesCollapsed ? '展开变更列表' : '折叠变更列表'" :aria-expanded="!changesCollapsed" @click="changesCollapsed = !changesCollapsed"><ChevronDown :size="13" :class="{ 'sc-flip': !changesCollapsed }" />{{ changesCollapsed ? '展开' : '折叠' }}</button>
      </div>
      <div class="sc-toolbar">
        <!-- `ChangesView.CommitToolbar`（VcsActions.xml:405-408）= `Vcs.ToggleAmendCommitMode` + `Vcs.MessageActionGroup`，
             挂在 `CommitStatusPanel` 的左侧 ⇒ 与提交图例**同一行**（NonModalCommitPanel.kt:104-107）。
             非模态面板的消息区自己不带工具条（CommitMessage.kt 的 showToolbar=false）。 -->
        <label class="sc-amend" :title="AMEND_TOOLTIP"><input v-model="amend" type="checkbox" :disabled="busy" /><span>{{ AMEND_CHECKBOX_TEXT }}</span></label>
        <button class="icon-button" :class="{ on: messageHistoryOpen }" :title="MESSAGE_HISTORY_DESCRIPTION" :aria-expanded="messageHistoryOpen" :aria-label="MESSAGE_HISTORY_TEXT" :disabled="busy || loading" @click="toggleMessageHistory"><Clock :size="13" /></button>
        <!-- 上游本地变更工具窗口那一行是 `VcsToolbarActions`（VcsActions.xml:416-425 + dvcs-impl 的
             `Vcs.Push` :80-85）：更新项目 / 提交 / 切换提交界面 / 推送 / 比较同版本 / 文件历史 / 回滚。
             本仓这一行只放我们真有的那两个（更新项目、推送）；获取/变基/储藏/取出储藏在上游都不在这一行
             （它们在 Git 菜单与日志窗口那一族），所以留在 Git 菜单里、不在这里重复一份。 -->
        <button class="sc-tool" :disabled="busy" title="更新项目（Ctrl+T）" @click="updateProject"><Download :size="13" />更新项目<span v-if="ahead.available && ahead.behind" class="sc-badge">{{ ahead.behind }}</span></button>
        <button class="sc-tool" :disabled="busy" title="推送（Ctrl+Shift+K）" @click="push"><Upload :size="13" />推送<span v-if="ahead.available && ahead.ahead" class="sc-badge">{{ ahead.ahead }}</span></button><!-- IDEA's commit legend: right-aligned in the row that hosts the commit toolbar (NonModalCommitPanel.kt:104-107 -> statusComponent.addToLeft(toolbar.component)). --><div v-if="legendFullText" ref="legendRef" class="sc-legend" role="status" aria-label="提交图例"><span v-for="group in legendRows" :key="group.kind" class="sc-legend-item" :class="`legend-${group.kind}`">{{ legendCompact ? `${group.compact}${group.count}` : `${group.count} 个${group.full}` }}</span><span ref="legendProbe" class="sc-legend-probe" aria-hidden="true">{{ legendFullText }}</span></div>
      </div>
      <div class="sc-branch-ops">
        <input v-model="newBranch" class="sc-input" placeholder="新分支名" aria-label="新分支名" :disabled="busy" @keydown.enter.prevent="createBranch" />
        <button class="sc-tool" :disabled="busy || !newBranch.trim()" title="新建并切换到分支" aria-label="新建分支" @click="createBranch"><Plus :size="13" /></button>
        <select v-model="mergeBranch" class="sc-input sc-select" aria-label="选择要合并的分支">
          <option value="">合并…</option>
          <option v-for="branch in branches.filter(name => name !== status.head)" :key="branch" :value="branch">{{ branch }}</option>
        </select>
        <button class="sc-tool" :disabled="busy || !mergeBranch" title="合并所选分支到当前分支" aria-label="合并分支" @click="mergeBranchInto"><GitMerge :size="13" /></button>
        <button class="sc-tool" :disabled="busy || !mergeBranch || mergeBranch === status.head" title="删除所选分支（git branch -D）" aria-label="删除分支" @click="deleteBranch"><Trash2 :size="13" /></button>
      </div>
      <div class="sc-branch-ops">
        <input v-model="tagName" class="sc-input" placeholder="新标签名" aria-label="新标签名" :disabled="busy" @keydown.enter.prevent="createTag" />
        <button class="sc-tool" :disabled="busy || !tagName.trim()" title="在当前提交打标签" aria-label="新建标签" @click="createTag"><Tag :size="13" /></button>
        <div v-if="tags.length" class="sc-tags">
          <span v-for="tag in tags" :key="tag" class="sc-tag" :title="`删除标签 ${tag}`">
            {{ tag }}
            <button class="sc-tag-x" :disabled="busy" aria-label="删除标签" @click="deleteTag(tag)"><X :size="10" /></button>
          </span>
        </div>
      </div>
      <div class="sc-branch-ops">
        <select v-model="compareBase" class="sc-input sc-select" aria-label="选择要比较的分支" :disabled="busy">
          <option value="">与分支比较…</option>
          <option v-for="branch in branches.filter(name => name !== status.head)" :key="branch" :value="branch">{{ branch }}</option>
        </select>
        <button class="sc-tool" :disabled="busy || !compareBase" title="列出该分支相对此处多出的文件" aria-label="开始比较" @click="runCompare"><History :size="13" />比较</button>
        <button v-if="compareTo || compared.length" class="sc-tool" :disabled="busy" title="清除比较结果" aria-label="清除比较" @click="clearCompare"><X :size="13" />清除</button>
      </div>
      <p v-if="error" class="sc-error" role="alert">{{ error }}</p>
      <p v-else-if="extrasError || tagsError" class="sc-warning" role="status">{{ [extrasError, tagsError].filter(Boolean).join('；') }}</p>
      <div v-show="!changesCollapsed" class="sc-scroll">
        <section v-if="staged.length" class="sc-section">
          <h3>已暂存 <span class="sc-count">{{ staged.length }}</span></h3>
          <div v-for="change in staged" :key="'s' + change.path" class="sc-row">
            <button class="sc-file" :title="change.path" @click="showDiff(change)"><span class="sc-status">{{ change.indexStatus }}</span><span class="sc-path">{{ change.path }}</span></button>
            <button class="icon-button" title="取消暂存" aria-label="取消暂存" :disabled="busy" @click="unstage(change.path)"><Minus :size="14" /></button>
          </div>
        </section>
        <section v-if="unstaged.length" class="sc-section">
          <h3>更改 <span class="sc-count">{{ unstaged.length }}</span></h3>
          <div v-for="change in unstaged" :key="'u' + change.path" class="sc-row">
            <button class="sc-file" :title="change.path" @click="showDiff(change)"><span class="sc-status">{{ change.untracked ? '?' : change.workStatus }}</span><span class="sc-path">{{ change.path }}</span></button>
            <button v-if="!change.untracked" class="icon-button" title="回滚工作区改动（IDEA Rollback，丢弃未暂存修改）" aria-label="回滚改动" :disabled="busy" @click="rollbackConfirm(change.path)"><Undo2 :size="14" /></button>
            <button v-if="change.untracked" class="icon-button" title="加入 .gitignore" aria-label="加入 .gitignore" :disabled="busy" @click="ignore(change.path)"><Ban :size="13" /></button>
            <button class="icon-button" title="暂存" aria-label="暂存" :disabled="busy" @click="stage(change.path)"><Plus :size="14" /></button>
          </div>
        </section>
        <div v-if="!changes.length" class="sc-empty"><Check :size="22" /><p>工作区干净</p><span>没有需要提交的更改。</span></div>
        <section v-if="compareTo" class="sc-section">
          <h3>与 {{ compareTo }} 的比较 <span class="sc-count">{{ compared.length }}</span></h3>
          <div v-for="file in compared" :key="'c' + file.path" class="sc-row">
            <button class="sc-file" :title="`${file.status} · ${file.path}`" @click="showDiff({ path: file.path, staged: false, base: compareTo })"><span class="sc-status">{{ file.status }}</span><span class="sc-path">{{ file.path }}</span></button>
          </div>
          <p v-if="!compared.length" class="sc-empty-line">该分支相对此处没有多出的文件。</p>
        </section>
      </div>
      <p v-if="commitCheckError" class="sc-commit-check" role="alert">{{ commitCheckError }}</p>
      <!-- IDEA's FailuresPanel (CommitProgressPanel.kt:394-471): the commit-check failures live on
           their own row — warning icon + the failure texts + the "Rerun commit checks" toolbar
           button (:492-521, `AllIcons.General.InlineRefresh`, tooltip.rerun.commit.checks). The row
           is hidden until a check actually reports a failure (:430 `isVisible = false`). -->
      <div v-if="checksFailures.length" class="sc-check-failures" role="status" aria-label="提交检查失败">
        <TriangleAlert :size="13" class="sc-check-failures-icon" />
        <span class="sc-check-failures-text">{{ failuresRowText(checksFailures) }}</span>
        <button class="icon-button sc-rerun-checks" :disabled="busy || checksBusy" :title="RERUN_CHECKS_TOOLTIP"
                :aria-label="RERUN_CHECKS_TOOLTIP" @click="runCommitChecks">
          <RefreshCw :size="12" :class="{ 'status-spin': checksBusy }" />
        </button>
      </div>
      <!-- IDEA's CommitAuthorComponent: "By <author>" above the commit actions, shown only
           while an author is set (:73-77). The ✕ removes the author and the date again (:117-120). -->
      <div v-if="authorOverride" class="sc-author">
        <span class="sc-author-label">By</span>
        <span class="sc-author-link" :title="fullName(effectiveAuthor)">{{ shortName(effectiveAuthor) }}</span>
        <button class="icon-button sc-author-x" title="移除作者覆盖（Remove）" aria-label="移除作者覆盖" @click="clearAuthorOverride"><X :size="12" /></button>
      </div>
      <div class="sc-actions">
        <button class="primary-button sc-commit-button" :disabled="busy" :title="`${commitButtonLabel}（Ctrl+Enter）`" @click="commit">{{ commitButtonLabel }}</button>
        <button class="sc-tool sc-options-button" :class="{ on: optionsOpen }" :aria-expanded="optionsOpen" title="提交选项" aria-label="提交选项" @click.stop="openOptions"><Settings :size="13" /></button>
        <button class="sc-tool sc-push-button" :disabled="busy" title="提交并推送（Ctrl+Shift+Enter）" @click="commitAndPush">提交并推送(P)<span v-if="ahead.available && ahead.ahead" class="sc-badge">{{ ahead.ahead }}</span></button>
      </div>
      <!-- IDEA's CommitOptionsPanel (:62-95) stacks the options in titled groups: one per VCS
           (`group(vcs.displayName)`), one for the pre-commit checks (`commit.checks.group={0} Checks`,
           VcsBundle.properties:44) and one for the post-commit checks (`:45`). -->
      <div v-if="optionsOpen" class="sc-options" role="group" aria-label="提交选项">
        <!-- GitCommitOptionsUi.kt:136-153 builds the dialog as `row(commit.author)` first,
             then the amend row, then sign-off, then the file-movements row. The author input
             lives here and not on the panel, exactly like the source. -->
        <p class="sc-options-group">提交作者</p>
        <form class="sc-author-fields" @submit.prevent="applyAuthorEditor">
          <input v-model="authorDraft.name" class="sc-input" placeholder="作者名（留空则用仓库配置）" aria-label="提交作者名" list="sc-known-author-names" />
          <input v-model="authorDraft.email" class="sc-input" placeholder="邮箱" aria-label="提交作者邮箱" list="sc-known-author-emails" />
          <!-- The log's known authors (GitCommitOptionsUi.kt:259) feed the completion; IDEA has
               one field for "Name <email>", so each half gets its own list here. -->
          <datalist id="sc-known-author-names"><option v-for="name in knownNames" :key="name" :value="name" /></datalist>
          <datalist id="sc-known-author-emails"><option v-for="email in knownEmails" :key="email" :value="email" /></datalist>
          <button class="sc-tool" type="submit" :disabled="!authorDraft.email.trim()" title="应用（Enter）">应用</button>
          <button class="sc-tool" type="button" title="恢复仓库配置（清空覆盖）" @click="clearAuthorOverride">恢复仓库配置</button>
        </form>
        <!-- GitCommitOptionsUi.kt:238-251 — the warning ("Author differs from default",
             GitBundle.properties:50) sits under the field whenever an override is in effect. -->
        <p v-if="authorWarning" class="sc-author-warning" role="status">作者与默认值不同</p>
        <p class="sc-options-group">Git</p>
        <label class="sc-amend"><input v-model="signoff" type="checkbox" /><span>提交签名（--signoff）</span></label>
        <p class="sc-options-group">提交检查</p>
        <label class="sc-amend"><input v-model="checkTodoBeforeCommit" type="checkbox" :disabled="todoCheckBusy || !todoPatterns.length" /><span>{{ todoCheckBusy ? '正在检查 TODO…' : '提交前检查 TODO' }}</span></label>
        <p class="sc-empty-line">{{ todoPatterns.length ? `使用本项目的 ${todoPatterns.length} 条 TODO 模式扫描整个工作区（不是仅本次变更）。` : '当前项目没有配置 TODO 模式，无法执行提交前检查。' }}</p>
      </div>
    </template>
    <div v-if="diff" class="modal-backdrop" @click.self="diff = null">
      <section class="diff-dialog" role="dialog" aria-modal="true" :aria-label="`差异 ${diff.path}`">
        <!-- IDEA's commit viewer: each hunk of the diff is selectable and the
             toolbar stages/unstages exactly the picked hunks. -->
        <div v-if="diff.hunks?.hunks.length" class="sc-hunks">
          <button class="sc-tool" :disabled="busy" title="把勾选的改动块暂存（git apply --cached）" @click="applyHunks(false)"><Plus :size="12" />暂存所选块</button>
          <button class="sc-tool" :disabled="busy" title="把勾选的已暂存块退回工作区（reverse apply）" @click="applyHunks(true)"><Minus :size="12" />取消暂存所选块</button>
          <span class="sc-hunk-hint">{{ diff.staged ? '已暂存差异' : '工作区差异' }} · {{ diff.hunks.hunks.length }} 块</span>
        </div>
        <p v-if="hunkError" class="sc-warning sc-hunk-error" role="status">{{ hunkError }}</p>
        <div v-if="diff.hunks?.hunks.length" class="sc-hunk-list">
          <label v-for="hunk in diff.hunks.hunks" :key="hunk.index" class="sc-hunk">
            <input type="checkbox" :checked="diff.hunkPicked?.has(hunk.index)" @change="toggleHunk(hunk.index)" />
            <code class="sc-hunk-header">{{ hunk.header.trim() }}</code>
            <span class="sc-hunk-counts">+{{ hunk.additions }} −{{ hunk.deletions }}</span>
          </label>
        </div>
        <DiffView closable :path="diff.path" :subtitle="diff.base ? `（与 ${diff.base} 的比较）` : diff.staged ? '（已暂存）' : '（工作区）'" :rows="diff.rows" :unified="diff.text" :truncated="diff.truncated" @close="diff = null" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.sc-warning { margin: 0 12px; color: var(--warning); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.sc-hunk-error { margin: 8px 12px 0; padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--radius-xs); background: var(--warning-bg); }
</style>
