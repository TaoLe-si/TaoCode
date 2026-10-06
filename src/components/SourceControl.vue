<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { GitBranch, RefreshCw, Plus, Minus, Check, X, CircleSlash, Download, Upload, Ban, GitPullRequestArrow, ChevronsUpDown, ChevronsDownUp, Clock, Settings, Undo2, TriangleAlert } from 'lucide-vue-next'
import DiffView from './DiffView.vue'
import ChangedHunks from './ChangedHunks.vue'
import AnchoredMenu from './AnchoredMenu.vue'
import { classifyLegend, legendGroups, legendText } from '../commitLegend'
import { AMEND_TOOLTIP, AMEND_CHECKBOX_TEXT, COMMIT_MESSAGE_PLACEHOLDER, MESSAGE_HISTORY_TEXT, MESSAGE_HISTORY_DESCRIPTION,
  EXPAND_ALL_TEXT, COLLAPSE_ALL_TEXT } from '../commitPanelStrings'
import { amendMessagePlan, restoreBeforeAmendMessage } from '../amendMessage'
import { RERUN_CHECKS_TOOLTIP, NOT_AVAILABLE_DURING_INDEXING, failuresRowText, saveDuringCommitQuestion,
  commitRequestParams } from '../commitChecks'
import { changesMenuRows, isConflictedStatus, type ChangesMenuTarget } from '../changesMenuActions'
import { scanTodoHits } from '../todoScan'
import { copyPatchToClipboard, createPatchFile } from '../patchExport'
import { applyPatchFromClipboard, applyPatchFromFile } from '../patchApplyHost'
import { acceptConflictSide, applyNonConflictingChanges, resolveSimpleConflicts } from '../mergeResolveHost'
import { legendNeedsCompactForm, observeResize } from '../legendFit'
import { readCommitOptions, saveCommitOptions } from '../commitOptions'
import { CHANGES_GROUP_BY_LABELS, GROUP_BY_LABEL, groupChanges, type ChangesGroupBy } from '../changesGrouping'
import { changesViewSettingsKey, defaultChangesViewSettings, groupByOfKeys, keysOfGroupBy, parseChangesViewSettings, serializeChangesViewSettings } from '../changesViewSettings'
import { createCommitChecks } from '../sourceControlCommitChecks'

// 「忽略的文件」那一档的文案（`VcsBundle.properties`：`:9` 是短名、`:8` 是说明）。
const SHOW_IGNORED_TEXT = '忽略的文件'
const SHOW_IGNORED_DESCRIPTION = '显示忽略的文件'
import { copyPathMenuRows, findResultClipboardText, type FindCopyActionId } from '../copyPathActions'
import { copyToClipboard } from '../clipboard.ts'
import { setStatusText } from '../statusBarText'
import type { NoticeAction } from '../notices'
import { COMMIT_CANCELED, COMMIT_NOTIFICATION_ID, commitNotificationRows, commitNotificationTitle, countCommittedPaths } from '../commitNotification'
// 提交信息 MRU（上游 `VcsConfiguration.saveCommitMessage/getRecentMessages` + `ShowMessageHistoryAction`）：
// 会话内按 25 上限去重追加，弹层里 MRU 新→旧排在最前，`git log` 主题兜底。
import { loadMessageHistory, messageHistoryPreviewLine, saveRecentMessage } from '../commitMessageHistory'
import { fullName, shortName, type CommitAuthor } from '../commitAuthor'
import { createCommitAuthorSection } from '../commitAuthorSection'
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
import { request, type SearchResult, type DiffRow, type DiffSides, type GitAheadBehind, type GitChange, type GitCommitDetails, type GitCompare, type GitCompareFile, type GitHunks, type GitLog, type GitStatus, type TodoPattern } from '../bridge'
import { iconSize } from '../uiIcons'
const props = defineProps<{
  root: string
  active: boolean
  todoPatterns: TodoPattern[]
  /** 统一 diff 的上下文行数（IDEA diff 设置 settings.context.lines；0/未传 = git 默认）。 */
  diffContextLines?: number
  /** 「项目分析中」：有活动文件 + 配了语言服务 + 还没跑起来（与状态栏 `smartModeLabel` 同源，见 ToolWindowView 的传参）。 */
  analyzing?: boolean
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
  /** 激活某个工具窗口（宿主的 `showView`）：失败通知里「显示详细信息」那条动作用。 */
  showToolWindow?: (id: string) => void
  /**
   * 「提交文件…」的范围（`CommonCheckinFilesAction.kt:26-78` → `CheckinActionUtil.kt:100-160`）：
   * 给了就只提交这些路径（`git commit --only -- <paths>`）。**默认不给 = 逐字沿用整份暂存区**。
   * 宿主那条通道还没接线之前它恒为空（请求体里连 `paths` 这个键都不出现），界面上也就不渲染
   * 「提交文件…」那一行 —— 不放假控件。
   * 接线请求：`docs/wiring-requests-2026-10-06-vcs2.md` W1（原写 `wiring-requests-2026-10-06-vcs.md`——
   * 上一路 vcs 代理被切断时那份文档没落盘，本批补上并把宿主四段（main.cpp / App.vue / ToolWindowView.vue /
   * toolViewContext.ts）的可照抄替换写全）。
   */
  commitPaths?: readonly string[]
  /**
   * 编辑器内容的**修订计数**（上游 `DocumentListener.documentChanged`，
   * `NonModalCommitWorkflowHandler.kt:216-225`）：每次键入/保存都要变，上一次检查结果随之作废。
   * 本仓现在只有 `dirtyPaths`（非响应式的"未保存清单"快照）⇒ 只覆盖第一次编辑。见 W2。
   */
  editorEpoch?: number
}>()
const status = ref<GitStatus>({ available: true, changes: [] })
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const message = ref('')
const amend = ref(false)
// `ToggleAmendCommitOption.kt:23` tooltip = VcsBundle.properties:1163
// `commit.tooltip.merge.this.commit.with.the.previous.one`, plus the `VK_M` mnemonic of `:19`.
interface DiffState { path: string; staged: boolean; base: string; text: string; rows: DiffRow[]; truncated: boolean; hunks?: GitHunks }
const diff = ref<DiffState | null>(null)
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
// (componentResized listener, :33-37). 测量本身拆在 src/legendFit.ts。
const legendRef = ref<HTMLElement | null>(null)
const legendProbe = ref<HTMLElement | null>(null)
const legendCompact = ref(false)
let stopLegendFit: (() => void) | null = null
function measureLegend() {
  const compact = legendNeedsCompactForm(legendRef.value, legendProbe.value)
  if (compact !== null) legendCompact.value = compact
}
const ahead = ref<GitAheadBehind>({ available: false, ahead: 0, behind: 0 })
// Secondary reads (remote status, hunk list) must not fail the
// whole panel, but they must not fail silently either.
const extrasError = ref('')
function errorText(caught: unknown) { return caught instanceof Error ? caught.message : String(caught) }
// Every status read carries a token: another project taking over mid-request makes
// the answer stale, and applying it would show a foreign repository's changes here.
let statusToken = 0
async function load() {
  const token = ++statusToken
  loading.value = true
  error.value = ''
  try {
    const result = await request<GitStatus>('git.status', { ignored: showIgnored.value })
    if (token !== statusToken) return
    status.value = result
    void refreshExtras()
  }
  catch (caught) { if (token === statusToken) error.value = errorText(caught) }
  finally { if (token === statusToken) loading.value = false }
}
/** 逐块暂存/退回之后：刷新变更列表与差异（原先是 applyHunks 里那两行，现在由子组件发事件触发）。 */
async function refreshAfterHunkApply() {
  await load()
  const current = diff.value
  if (current) await showDiff({ path: current.path, staged: current.staged, base: current.base })
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
const emit = defineEmits<{ notify: [message: string, error?: boolean, displayId?: string, detail?: string[], actions?: NoticeAction[]] }>()
// 变更行的右键菜单（上游 `ChangesViewPopupMenu`，行表在 src/changesMenuActions.ts）。
// 位置用视口坐标 —— 浮层是 `position: fixed`（`src/popupAnchor.ts`），放在滚动容器里也不会被裁。
// 「忽略的文件」（上游 `ChangesView.ShowIgnored`，文案取 `VcsBundle.properties:9`）：默认**关**，
// 开着时 `git status --ignored=matching` 会把被 .gitignore 忽略的文件也列出来。
// 这两项跟着**工程**走（上游 `ChangesViewSettings`，`:27` 的
// `@State(name = "ChangesViewManager", storages = [Storage(StoragePathMacros.WORKSPACE_FILE)])`）：
// 关掉再打开同一个工程，分组方式与「显示忽略的文件」还在。换工作区要读回那一档的存档。
const showIgnored = ref(false)
const groupBy = ref<ChangesGroupBy>('none')
const viewSettingsKey = computed(() => changesViewSettingsKey(props.root))
watch(viewSettingsKey, key => {
  let stored = defaultChangesViewSettings()
  try { stored = parseChangesViewSettings(localStorage.getItem(key)) } catch { /* Session-only. */ }
  groupBy.value = groupByOfKeys(stored.groupingKeys)
  showIgnored.value = stored.showIgnored
}, { immediate: true })
function persistViewSettings() {
  const raw = serializeChangesViewSettings({ groupingKeys: keysOfGroupBy(groupBy.value), showIgnored: showIgnored.value })
  try { localStorage.setItem(viewSettingsKey.value, raw) } catch { /* Session-only preferences. */ }
}
watch(showIgnored, () => { persistViewSettings(); void load() })
watch(groupBy, persistViewSettings)
const stagedGroups = computed(() => groupChanges(staged.value, groupBy.value))
const unstagedGroups = computed(() => groupChanges(unstaged.value, groupBy.value))
const rowMenu = ref<{ x: number; y: number; change: ChangesMenuTarget & { path: string; staged: boolean } } | null>(null)
const copyOpen = ref(false)
const rowMenuRows = computed(() => (rowMenu.value ? changesMenuRows(rowMenu.value.change) : []))
const rowCopyRows = computed(() => copyPathMenuRows({
  target: () => (rowMenu.value ? { path: rowMenu.value.change.path, line: 1 } : null),
  root: () => props.root,
  copy: (text: string) => void copyToClipboard(text),
}))
function openRowMenu(event: MouseEvent, change: ChangesMenuTarget & { path: string; staged: boolean; indexStatus?: string; workStatus?: string }) {
  copyOpen.value = false
  // 「未合并」（UU/AU/…）要在菜单里多出冲突那一档：判定表在 `src/changesMenuActions.ts`（照 git4idea）。
  rowMenu.value = { x: event.clientX, y: event.clientY, change: { ...change, conflicted: isConflictedStatus(change.indexStatus ?? '', change.workStatus ?? '') } }
}
/** 合并那几条动作的依赖（通知 + 写完刷新变更列表）。 */
const mergeDeps = () => ({ notify: (message: string, error?: boolean) => emit('notify', message, error), onApplied: () => void load() })
/** 菜单里选了一条：`copyPath.*` 归复制那一组，其余按 id 分派到面板已有的处理函数。 */
function pickRowMenu(row: { id: string }) {
  const menu = rowMenu.value
  rowMenu.value = null
  if (!menu) return
  const path = menu.change.path
  if (row.id.startsWith('copyPath.')) {
    // 用**存下来的** `menu`，别再用 `rowCopyRows` 那个 computed —— 它的输入就是 `rowMenu`，
    // 上面刚把它清空，读它只会拿到"没有目标 ⇒ 禁用"（真机抓到的：点了复制却什么都没进剪贴板）。
    const action = row.id.slice('copyPath.'.length) as FindCopyActionId
    void copyToClipboard(findResultClipboardText(action, { path, line: 1 }, props.root))
    return
  }
  switch (row.id) {
    // 冲突那一档（上游 git4idea 的 `Git.ChangesView.Conflicts`，只有未合并的变更才有）：
    // 整文件接受一侧 + 合并窗口工具栏那两个「自动合」。落盘链在 `src/mergeResolveHost.ts`。
    case 'acceptTheirs': return void acceptConflictSide(path, 'right', mergeDeps())
    case 'acceptYours': return void acceptConflictSide(path, 'left', mergeDeps())
    case 'resolveConflicts': return void resolveSimpleConflicts(path, mergeDeps())
    case 'applyNonConflicts': return void applyNonConflictingChanges(path, mergeDeps())
    case 'diff': return showDiff({ path, staged: menu.change.staged })
    case 'revert': return rollbackConfirm(path)
    case 'stage': return void stage(path)
    case 'unstage': return void unstage(path)
    case 'addToVcs': return void stage(path)
    case 'ignore': return void ignore(path)
    case 'patch': return void createPatchFile({ notify: (message, error) => emit('notify', message, error), copy: copyToClipboard })
    case 'patchClipboard': return void copyPatchToClipboard({ notify: (message, error) => emit('notify', message, error), copy: copyToClipboard })
    // 「应用补丁…」/「从剪贴板应用补丁」（上游 `ChangesView.ApplyPatch` / `ApplyPatchFromClipboard`）：
    // 解析 → 逐文件核对（纯规则在 src/patchApply.ts）→ 落盘（宿主链在 src/patchApplyHost.ts），
    // 进度走状态栏文字、结果走通知；成功后刷新变更列表。
    case 'applyPatch': return void applyPatchFromFile({ root: props.root, notify: (message, error) => emit('notify', message, error), setStatus: (text) => setStatusText(text, null), onApplied: () => void load() })
    case 'applyPatchClipboard': return void applyPatchFromClipboard({ root: props.root, notify: (message, error) => emit('notify', message, error), setStatus: (text) => setStatusText(text, null), onApplied: () => void load() })
    case 'refresh': return void load()
  }
}
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
// IDEA's CommitAuthorComponent (vcs/commit/CommitAuthorComponent.kt:38-121) sits between the
// commit checks panel and the action buttons (NonModalCommitPanel.kt:76-79) and shows
// "By <author>" — but only while an author is actually set (:73-77 `userViewer.isVisible =
// userViewer.user != null`; the value starts as the change list's author, i.e. usually null).
// The *input* belongs to the commit options popup instead: GitCommitOptionsUi.kt:136-153 puts
// `row(commit.author)` first, above the amend / sign-off / renames rows.
// 作者一节的状态（仓库作者/覆盖/草稿/候选）拆在 src/commitAuthorSection.ts。
const authorSection = createCommitAuthorSection({ root: () => props.root, onOpenOptions: () => { optionsOpen.value = true } })
const { authorOverride, authorDraft, effectiveAuthor, knownNames, knownEmails, knownAuthorEntries,
        saveUsedAuthor, loadAuthor, openOptions, applyAuthorEditor, authorWarning, clearAuthorOverride } = authorSection
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
// The two actions in `ChangesViewCommitPanel`: commit the included changes, and — as the second —
// commit and then push the branch in the same gesture. Everything up to the push is one body, so
// it lives here once instead of being copied per action.
/**
 * @param push 提交之后再推一次（第二个动作；`ChangesViewCommitPanel` 的那一条）。
 *   推失败仍然走 act()，但**不能**当成"提交失败"报出去 —— 那是另一个操作
 *   （上游推送走 git 插件自己的动作），它保留通用的错误通知，所以用 `committed` 区分。
 */
const runCommit = (push: boolean) => {
  // Ctrl+Enter reaches here even while the button is disabled, so say why nothing
  // happened instead of silently doing nothing.
  if (!passedCommitCheck()) return
  const text = message.value.trim()
  // `changesCommitted = changes - failedToCommitChanges` (ShowNotificationCommitResultHandler.kt:42-43):
  // the count is taken from what was included in this commit, before the tree reloads.
  // 「提交文件…」时"这次包含的那些变更" = 被选中的路径（`CheckinActionUtil.kt:100-160` 的
  // `getIncludedChanges()`），没有范围时才是暂存区那一份。
  const stagedPaths = props.commitPaths?.length
    ? [...props.commitPaths]
    : staged.value.map(change => change.path)
  let committed = false
  void act(async () => {
    // 这一轮检查（上游 `doExecuteSession` 把它包在 `runWithProgress(isOnlyRunCommitChecks = false)` 里）：
    // 会话开头先 `resetCommitChecksResult()` + 清失败行，然后按状态跳过**已经失败过的相位**
    // （`willSkipEarlyCommitChecks` / `willSkipModificationCommitChecks`，`:337-340`），
    // 空判照旧要跑 —— 「仍然提交」时没有暂存文件也得听见那句「选择要提交的文件」。
    const report = await runCommitChecksRound()
    // 上游 `CommitProgressPanel.buildErrorText`：理由写在面板那条错误行上，提交不跑。
    if (!report.ok) { applyChecksReport(report, true); return }
    commitCheckError.value = ''
    await confirmSaveDuringCommit(stagedPaths)
    await request('git.commit', commitRequestParams({
      message: text, amend: amend.value, signoff: signoff.value,
      // An override only rides this commit; native refuses it without an e-mail
      // (git commit --author needs "Name <email>").
      author: authorOverride.value?.name ?? '', authorEmail: authorOverride.value?.email ?? '',
      // 「提交文件…」的范围（宿主没给 = 不带这个键，请求体与历史逐字一致）。
      paths: props.commitPaths,
    }))
    committed = true
    // 提交成功 ⇒ 上游 `CheckinProjectPanel` 的收尾会把信息存进 MRU（VcsConfiguration:169-177）。
    recentMessages.value = saveRecentMessage(recentMessages.value, text)
    reportCommitResult(text, stagedPaths, [])
    message.value = ''
    amend.value = false
    // 提交会话结束 ⇒ `CommitStateCleaner.resetState()`（:634-641）里的 `resetCommitChecksResult()`。
    checksFailures.value = []
    runPostCommitChecks()
    if (push) await request('git.push')
  }, failure => { if (!committed) reportCommitResult(text, stagedPaths, [failure]) })
}
const commit = () => runCommit(false)
const commitAndPush = () => runCommit(true)
// The changes list collapses like IDEA's commit tab: the tree header carries 展开 on the right.
// 折叠的是分组里的行（组节点「已暂存 N / 更改 N」留着），对应上游把树的子节点收起来。
const changesCollapsed = ref(false)
// `isExpandAllVisible()`：分组不是 NONE 或模型不是平铺 —— 本仓的分组就是已暂存/更改这两组 ⇒ 有改动就成立。
const hasGroups = computed(() => changes.value.length > 0)
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
// IDEA's "commit checks": the TODO scan reuses the project's own TODO patterns (Find in Files).
const todoHits = (): Promise<number> => scanTodoHits(
  pattern => request<SearchResult>('search.run', { query: pattern, regex: true, caseSensitive: false, wholeWord: false, include: '', exclude: '' }), props.todoPatterns, caught => { error.value = errorText(caught) })
const signoff = ref(false)
const checkTodoBeforeCommit = ref(false)
// 选项的存档（上游 `VcsConfiguration` 的项目级配置 + `CommitOptions.saveState/restoreState`）。
// 存档层在 src/commitOptions.ts，按工作区根分键；改动即存，切换项目时重读。
const storedCommitOptions = readCommitOptions(props.root)
signoff.value = storedCommitOptions.signoff
checkTodoBeforeCommit.value = storedCommitOptions.checkTodoBeforeCommit
/** 「提交完成后再运行高级检查」（上游 `settings.commit.postpone.slow.checks`，默认开）。 */
const postponeSlowChecks = ref(storedCommitOptions.postponeSlowChecks)
watch([signoff, checkTodoBeforeCommit, postponeSlowChecks], () => {
  saveCommitOptions(props.root, { signoff: signoff.value, checkTodoBeforeCommit: checkTodoBeforeCommit.value, postponeSlowChecks: postponeSlowChecks.value })
})
// 提交检查这一族（空判 / 失败行 / 进度行 / 取消 / 提交后那一轮 / 跑一次检查）拆在
// src/sourceControlCommitChecks.ts —— 工厂放在提交选项之后：检查链要读那三个选项 ref。
const {
  commitCheckError, checksFailures, checksBusy, commitButtonLabel, commitAndPushLabel, passedCommitCheck,
  applyChecksReport, showFailureDetails, checksProgress, checksPopupOpen, checksPopup, runCommitChecksRound,
  indexingWarning, cancelCommitChecks, commitOptionsNow, runPostCommitChecks, runCommitChecks,
} = createCommitChecks({
  props, emit, act, commit, staged, changes, message, amend, checkTodoBeforeCommit, todoCheckBusy, todoHits,
  messageProblems, signoff, postponeSlowChecks, dirtyPaths,
  // 宿主的修订计数（W2 接线请求）：宿主没传这个 prop 时**不填** ⇒ 指纹维持本批之前的形状，
  // 传了以后每一次键入都会把上一轮检查结果作废（上游 documentChanged，:216-225）。
  ...(props.editorEpoch === undefined ? {} : { editorEpoch: () => props.editorEpoch ?? 0 }),
})

// IDEA's commit message history: session MRU first (newest first), git log subjects as fallback;
// hovering a row previews it in the box, leaving restores the draft, clicking keeps it.
const messageHistoryOpen = ref(false)
const messageHistory = ref<string[]>([])
const messageHistoryLoading = ref(false)
const recentMessages = ref<string[]>([])
let historyPreviewDraft: string | null = null
const toggleMessageHistory = () => {
  messageHistoryOpen.value = !messageHistoryOpen.value
  if (!messageHistoryOpen.value) return
  messageHistoryLoading.value = true
  void loadMessageHistory(async () => (await request<GitLog>('git.log')).commits.map(entry => entry.subject), recentMessages.value)
    .then(rows => { messageHistory.value = rows })
    .catch(caught => { error.value = errorText(caught) })
    .finally(() => { messageHistoryLoading.value = false })
}
const previewHistory = (subject: string) => {
  if (historyPreviewDraft === null) historyPreviewDraft = message.value
  message.value = subject
}
function endHistoryPreview() {
  if (historyPreviewDraft !== null && messageHistoryOpen.value) message.value = historyPreviewDraft
  historyPreviewDraft = null
}
const pickHistory = (subject: string) => { historyPreviewDraft = null; message.value = subject; messageHistoryOpen.value = false }
const checkout = (branch: string) => act(() => request('git.checkout', { branch }))
// `Vcs.UpdateProject`（与 `Vcs.Push` 同在 `VcsToolbarActions`，VcsActions.xml:416-425）：
// 先刷新远端（fetch）再做整合（pull）—— 与 Git 菜单那条宿主实现（`src/vcsActions.ts`）同义。
const updateProject = () => act(async () => { await request('git.fetch'); await request('git.pull') })
const push = () => act(() => request('git.push'))
// IDEA Git menu rows: Fetch (refresh remotes), Rebase onto upstream, branch delete,
// "Add to .gitignore" for untracked rows.
const fetch = () => act(() => request('git.fetch'))
const ignore = (path: string) => act(() => request('git.ignore', { path }))
async function showDiff(target: { path: string; staged: boolean; base?: string }) {
  const base = target.base ?? ''
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
      catch (caught) { hunks = undefined; commitCheckError.value = `读取改动块失败，只能整体暂存：${errorText(caught)}` }
    }
    diff.value = {
      path: target.path, staged: target.staged, base,
      text: unified.diff || '（无差异；可能是未跟踪文件）',
      rows: sides.rows ?? [], truncated: sides.truncated === true,
      hunks,
    }
  } catch (caught) { error.value = errorText(caught) }
}
// 「与分支比较」的**触发点**在上游是分支弹窗（`Git.Ref.Compare.With`，见 `src/branchPopup.ts`
// 的 `BRANCH_ROW_ACTIONS`）：弹窗选一行 ⇒ 宿主设好 props.compareWith ⇒ 这里跑一次，
// 结果就出现在本面板已有的比较列表里（不另造一套展示，也不在面板里再放一个下拉）。
watch(() => props.compareWith, base => {
  if (!base) return
  void act(async () => {
    const result = await request<GitCompare>('git.compare', { base })
    compared.value = result.files
    compareTo.value = base
  })
})
function clearCompare() {
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
  stopLegendFit = observeResize(legendRef.value, () => measureLegend())
})
onBeforeUnmount(() => {
  stopLegendFit?.()
  stopLegendFit = null
  window.removeEventListener('keydown', onAmendMnemonic)
})
watch(legendFullText, () => void nextTick(measureLegend))
watch(() => [props.root, props.active] as const, () => {
  if (!props.active) return
  // Switching projects invalidates the per-project comparison and history panel,
  // plus any status request still running for the previous root.
  statusToken++
  extrasError.value = ''
  compareTo.value = ''
  compared.value = []
  // The author comes from the repository configuration, so a new project needs a re-read
  // and any override made for the previous repository must not leak into it.
  authorOverride.value = null
  authorDraft.name = ''
  authorDraft.email = ''
  optionsOpen.value = false
  // 提交选项按工作区根分开存：换项目重新读回（上游 `VcsConfiguration` 是项目级配置）。
  const reloaded = readCommitOptions(props.root)
  signoff.value = reloaded.signoff
  checkTodoBeforeCommit.value = reloaded.checkTodoBeforeCommit
  postponeSlowChecks.value = reloaded.postponeSlowChecks
  void loadAuthor()
  void load()
})
</script>
<template>
  <div class="sc-panel">
    <div class="sc-header">
      <GitBranch :size="iconSize.control" />
      <select class="sc-branch" :value="status.head" :disabled="busy || !branches.length" aria-label="当前分支" @change="checkout(($event.target as HTMLSelectElement).value)">
        <option v-if="status.head" :value="status.head">{{ status.head }}</option>
        <option v-for="branch in branches.filter(name => name !== status.head)" :key="branch" :value="branch">{{ branch }}</option>
      </select>
      <button class="icon-button" title="刷新" aria-label="刷新 Git 状态" :disabled="loading || busy" @click="load"><RefreshCw :size="iconSize.control" /></button>
    </div>
    <div v-if="!status.available" class="sc-empty"><CircleSlash :size="iconSize.artwork" /><p>未找到 Git</p><span>安装 Git 并加入 PATH 后可使用版本控制。</span></div>
    <template v-else>
      <div class="sc-commit">
        <textarea ref="messageBox" v-model="message" rows="3" :placeholder="COMMIT_MESSAGE_PLACEHOLDER" aria-label="提交消息" :disabled="busy" @keydown.ctrl.enter.prevent="commit" @keydown.ctrl.shift.enter.prevent="commitAndPush" @keydown.alt.l.prevent="reformatMessage" />
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
            <button v-for="subject in messageHistory" :key="subject" class="sc-msg-row"
                    :title="`使用这条提交信息：${subject}`"
                    @mouseenter="previewHistory(subject)" @mouseleave="endHistoryPreview" @click="pickHistory(subject)">{{ messageHistoryPreviewLine(subject, props.commitSettings.subjectRightMargin) }}</button>
          </template>
        </div>
      </div>
      <div class="sc-changes-head">
        <!-- 变更树的**头部**动作（上游 `ChangesTree.createExpandAllAction(true)` /
             `createCollapseAllAction(true)`，ChangesTree.java:725-744；头部工具栏 = TreeActionsToolbarPanel:53-54）。
             可见性 = `MyTreeExpander.isExpandAllVisible()`（:752-762）：分组不是 NONE、或模型不是平铺时才有这一对。
             文案取 `ActionsBundle`：`action.ExpandAll.text` = 全部展开、`action.CollapseAll.text` = **全部收起**。 -->
        <button class="sc-tool" :disabled="busy || !hasGroups" :title="EXPAND_ALL_TEXT" aria-label="全部展开" @click="changesCollapsed = false"><ChevronsUpDown :size="iconSize.menu" />{{ EXPAND_ALL_TEXT }}</button>
        <button class="sc-tool" :disabled="busy || !hasGroups" :title="COLLAPSE_ALL_TEXT" aria-label="全部收起" @click="changesCollapsed = true"><ChevronsDownUp :size="iconSize.menu" />{{ COLLAPSE_ALL_TEXT }}</button>
      </div>
      <div class="sc-toolbar">
        <!-- `ChangesView.CommitToolbar`（VcsActions.xml:405-408）= `Vcs.ToggleAmendCommitMode` + `Vcs.MessageActionGroup`，
             挂在 `CommitStatusPanel` 的左侧 ⇒ 与提交图例**同一行**（NonModalCommitPanel.kt:104-107）。
             非模态面板的消息区自己不带工具条（CommitMessage.kt 的 showToolbar=false）。 -->
        <label class="sc-amend" :title="AMEND_TOOLTIP"><input v-model="amend" type="checkbox" :disabled="busy" /><span>{{ AMEND_CHECKBOX_TEXT }}</span></label>
        <button class="icon-button" :class="{ on: messageHistoryOpen }" :title="MESSAGE_HISTORY_DESCRIPTION" :aria-expanded="messageHistoryOpen" :aria-label="MESSAGE_HISTORY_TEXT" :disabled="busy || loading" @click="toggleMessageHistory"><Clock :size="iconSize.menu" /></button>
        <!-- 上游本地变更工具窗口那一行是 `VcsToolbarActions`（VcsActions.xml:416-425 + dvcs-impl 的
             `Vcs.Push` :80-85）：更新项目 / 提交 / 切换提交界面 / 推送 / 比较同版本 / 文件历史 / 回滚。
             本仓这一行只放我们真有的那两个（更新项目、推送）；获取/变基/储藏/取出储藏在上游都不在这一行
             （它们在 Git 菜单与日志窗口那一族），所以留在 Git 菜单里、不在这里重复一份。 -->
        <label class="sc-ignored" :title="SHOW_IGNORED_DESCRIPTION"><input type="checkbox" v-model="showIgnored" />{{ SHOW_IGNORED_TEXT }}</label>
        <label class="sc-groupby" :title="GROUP_BY_LABEL"><span>{{ GROUP_BY_LABEL }}</span>
          <select v-model="groupBy" :aria-label="GROUP_BY_LABEL">
            <option v-for="(label, value) in CHANGES_GROUP_BY_LABELS" :key="value" :value="value">{{ label }}</option>
          </select>
        </label>
        <button class="sc-tool" :disabled="busy" title="更新项目（Ctrl+T）" @click="updateProject"><Download :size="iconSize.menu" />更新项目<span v-if="ahead.available && ahead.behind" class="sc-badge">{{ ahead.behind }}</span></button>
        <button class="sc-tool" :disabled="busy" title="推送（Ctrl+Shift+K）" @click="push"><Upload :size="iconSize.menu" />推送<span v-if="ahead.available && ahead.ahead" class="sc-badge">{{ ahead.ahead }}</span></button><!-- IDEA's commit legend: right-aligned in the row that hosts the commit toolbar (NonModalCommitPanel.kt:104-107 -> statusComponent.addToLeft(toolbar.component)). --><div v-if="legendFullText" ref="legendRef" class="sc-legend" role="status" aria-label="提交图例"><span v-for="group in legendRows" :key="group.kind" class="sc-legend-item" :class="`legend-${group.kind}`">{{ legendCompact ? `${group.compact}${group.count}` : `${group.count} 个${group.full}` }}</span><span ref="legendProbe" class="sc-legend-probe" aria-hidden="true">{{ legendFullText }}</span></div>
      </div>
      <p v-if="error" class="sc-error" role="alert">{{ error }}</p>
      <p v-else-if="extrasError" class="sc-warning" role="status">{{ extrasError }}</p>
      <div class="sc-scroll">
        <section v-if="staged.length" class="sc-section">
          <h3>已暂存 <span class="sc-count">{{ staged.length }}</span></h3>
          <template v-for="group in stagedGroups" :key="'sg' + group.dir">
          <p v-if="groupBy === 'directory'" class="sc-group-head" :title="group.dir || '.'">{{ group.dir || '.' }}</p>
          <div v-for="change in group.changes" v-show="!changesCollapsed" :key="'s' + change.path" class="sc-row" @contextmenu.prevent="openRowMenu($event, change)">
            <button class="sc-file" :title="change.path" @click="showDiff(change)"><span class="sc-status">{{ change.indexStatus }}</span><span class="sc-path">{{ change.path }}</span></button>
            <button class="icon-button" title="取消暂存" aria-label="取消暂存" :disabled="busy" @click="unstage(change.path)"><Minus :size="iconSize.control" /></button>
          </div>
          </template>
        </section>
        <section v-if="unstaged.length" class="sc-section">
          <h3>更改 <span class="sc-count">{{ unstaged.length }}</span></h3>
          <template v-for="group in unstagedGroups" :key="'ug' + group.dir">
          <p v-if="groupBy === 'directory'" class="sc-group-head" :title="group.dir || '.'">{{ group.dir || '.' }}</p>
          <div v-for="change in group.changes" v-show="!changesCollapsed" :key="'u' + change.path" class="sc-row" @contextmenu.prevent="openRowMenu($event, change)">
            <button class="sc-file" :title="change.path" @click="showDiff(change)"><span class="sc-status">{{ change.ignored ? '!' : change.untracked ? '?' : change.workStatus }}</span><span class="sc-path">{{ change.path }}</span></button>
            <button v-if="!change.untracked && !change.ignored" class="icon-button" title="回滚工作区改动（IDEA Rollback，丢弃未暂存修改）" aria-label="回滚改动" :disabled="busy" @click="rollbackConfirm(change.path)"><Undo2 :size="iconSize.control" /></button>
            <button v-if="change.untracked" class="icon-button" title="加入 .gitignore" aria-label="加入 .gitignore" :disabled="busy" @click="ignore(change.path)"><Ban :size="iconSize.menu" /></button>
            <button v-if="!change.ignored" class="icon-button" title="暂存" aria-label="暂存" :disabled="busy" @click="stage(change.path)"><Plus :size="iconSize.control" /></button>
          </div>
          </template>
        </section>
        <div v-if="!changes.length" class="sc-empty"><Check :size="iconSize.artwork" /><p>工作区干净</p><span>没有需要提交的更改。</span></div>
        <section v-if="compareTo" class="sc-section">
          <h3>与 {{ compareTo }} 的比较 <span class="sc-count">{{ compared.length }}</span></h3>
          <div v-for="file in compared" :key="'c' + file.path" class="sc-row">
            <button class="sc-file" :title="`${file.status} · ${file.path}`" @click="showDiff({ path: file.path, staged: false, base: compareTo })"><span class="sc-status">{{ file.status }}</span><span class="sc-path">{{ file.path }}</span></button>
          </div>
          <p v-if="!compared.length" class="sc-empty-line">该分支相对此处没有多出的文件。</p>
        </section>
      </div>
      <!-- IDEA 的 `CommitChecksProgressIndicator`（`CommitProgressPanel.kt:108-130`）：跑检查时那一行
           （标题 + 两档正文 + 取消），任务结束整行收掉（可见性由 `checksProgress(..., running)` 给）。 -->
      <div v-if="checksProgress.visible" class="sc-checks-progress" role="status" @click="checksPopupOpen = !checksPopupOpen">
        <span class="sc-checks-progress-text"><strong>{{ checksProgress.title }}</strong>{{ checksProgress.text }}</span>
        <span v-if="checksProgress.detail" class="sc-checks-progress-detail">{{ checksProgress.detail }}</span>
        <button v-if="checksProgress.cancellable" class="sc-tool" :disabled="!checksBusy" @click.stop="cancelCommitChecks">{{ checksProgress.cancelText }}</button><div v-if="checksPopup.visible" class="sc-checks-popup" role="dialog" aria-label="提交检查进度"><span>{{ checksPopup.title }}：{{ checksPopup.text }}</span><span class="sc-checks-bar" role="progressbar" aria-label="提交检查进行中" /></div>
      </div>
      <!-- 项目分析期间那条警告（`:310`）：不在分析中、或者正在跑检查时都不出现。 -->
      <p v-if="indexingWarning" class="sc-checks-indexing" role="status">{{ NOT_AVAILABLE_DURING_INDEXING }}</p>
      <p v-if="commitCheckError" class="sc-commit-check" role="alert">{{ commitCheckError }}</p>
      <!-- IDEA's FailuresPanel (CommitProgressPanel.kt:394-471): the commit-check failures live on
           their own row — warning icon + the failure texts + the "Rerun commit checks" toolbar
           button (:492-521, `AllIcons.General.InlineRefresh`, tooltip.rerun.commit.checks). The row
           is hidden until a check actually reports a failure (:430 `isVisible = false`).
           各条 failure 之间是 `<br/><br/>`（`:465` 的 `appendWithSeparators(HtmlChunk.raw("<br/><br/>"), …)`）
           ⇒ 一条一行。带详情动作的那一条（`CommitProblemWithDetails`，`CommitCheck.kt:162-176`）
           **整条文字就是那个链接** —— `showDetailsLink` 为默认的 null 时上游就是这么渲染的
           （`:456-458`）；点它 = `problem.showDetails(project)`（`NonModalCommitWorkflowHandler.kt:523`），
           TODO 预检那一条打开的是 TODO 工具窗口（`TodoCheckinHandler.showTodoItems`，`:144-168`）。 -->
      <div v-if="checksFailures.length" class="sc-check-failures" role="status" :aria-label="failuresRowText(checksFailures)">
        <TriangleAlert :size="iconSize.menu" class="sc-check-failures-icon" />
        <span class="sc-check-failures-text">
          <template v-for="(failure, index) in checksFailures" :key="`${failure.text}:${index}`">
            <br v-if="index" />
            <button v-if="failure.details" type="button" class="sc-check-failure-link" :title="failure.details"
                    @click="showFailureDetails(failure)">{{ failure.text }}</button>
            <template v-else>{{ failure.text }}</template>
          </template>
        </span>
        <button class="icon-button sc-rerun-checks" :disabled="busy || checksBusy" :title="RERUN_CHECKS_TOOLTIP"
                :aria-label="RERUN_CHECKS_TOOLTIP" @click="runCommitChecks">
          <RefreshCw :size="iconSize.dense" :class="{ 'status-spin': checksBusy }" />
        </button>
      </div>
      <!-- IDEA's CommitAuthorComponent: "By <author>" above the commit actions, shown only
           while an author is set (:73-77). The ✕ removes the author and the date again (:117-120). -->
      <div v-if="authorOverride" class="sc-author">
        <span class="sc-author-label">By</span>
        <span class="sc-author-link" :title="fullName(effectiveAuthor)">{{ shortName(effectiveAuthor) }}</span>
        <button class="icon-button sc-author-x" title="移除作者覆盖（Remove）" aria-label="移除作者覆盖" @click="clearAuthorOverride"><X :size="iconSize.dense" /></button>
      </div>
      <div class="sc-actions">
        <button class="primary-button sc-commit-button" :disabled="busy" :title="`${commitButtonLabel}（Ctrl+Enter）`" @click="commit">{{ commitButtonLabel }}</button>
        <button class="sc-tool sc-options-button" :class="{ on: optionsOpen }" :aria-expanded="optionsOpen" title="提交选项" aria-label="提交选项" @click.stop="openOptions"><Settings :size="iconSize.menu" /></button>
        <button class="sc-tool sc-push-button" :disabled="busy" :title="`${commitAndPushLabel}（Ctrl+Shift+Enter）`" @click="commitAndPush">{{ commitAndPushLabel }}<span v-if="ahead.available && ahead.ahead" class="sc-badge">{{ ahead.ahead }}</span></button>
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
        <!-- 上游 `CommitOptionsPanel.kt:110-118` 的 `settings.commit.postpone.slow.checks`
             「Run advanced checks after a commit is done」（说明句「检查失败不会阻止提交」）。 -->
        <label class="sc-amend" title="检查失败不会阻止提交"><input v-model="postponeSlowChecks" type="checkbox" /><span>提交完成后再运行检查</span></label>
        <p class="sc-empty-line">{{ todoPatterns.length ? `使用本项目的 ${todoPatterns.length} 条 TODO 模式扫描整个工作区（不是仅本次变更）。` : '当前项目没有配置 TODO 模式，无法执行提交前检查。' }}</p>
      </div>
    </template>
    <div v-if="diff" class="modal-backdrop" @click.self="diff = null">
      <section class="diff-dialog" role="dialog" aria-modal="true" :aria-label="`差异 ${diff.path}`">
        <!-- IDEA's commit viewer: each hunk of the diff is selectable and the
             toolbar stages/unstages exactly the picked hunks. -->
        <!-- 逐块暂存在 src/components/ChangedHunks.vue（这一段与变更列表无关：吃一份 hunks、自己选择与请求）。 -->
        <ChangedHunks :path="diff.path" :staged="diff.staged" :hunks="diff.hunks" @changed="refreshAfterHunkApply" />
        <DiffView closable :path="diff.path" :subtitle="diff.base ? `（与 ${diff.base} 的比较）` : diff.staged ? '（已暂存）' : '（工作区）'" :rows="diff.rows" :unified="diff.text" :truncated="diff.truncated" @close="diff = null" />
      </section>
    </div>
  </div>

  <!-- 变更行的右键菜单（上游 `ChangesViewPopupMenu`）：行表在 src/changesMenuActions.ts，
       复制那一组复用 src/copyPathActions.ts 的四项。外套 `.tree-menu-backdrop` 与全仓其它菜单一致
       （没有它会 `z-index: auto` 被别的浮层背景盖住 —— 批 106 真机踩过）。 -->
  <div v-if="rowMenu" class="tree-menu-backdrop" @pointerdown="rowMenu = null" @contextmenu.prevent="rowMenu = null">
    <AnchoredMenu :x="rowMenu.x" :y="rowMenu.y" @pointerdown.stop>
      <template v-for="row in rowMenuRows" :key="row.id">
        <template v-if="row.id === 'copyPath'">
          <button class="has-sub" role="menuitem" :aria-expanded="copyOpen" @click="copyOpen = !copyOpen">复制路径/引用…</button>
          <template v-if="copyOpen">
            <button v-for="entry in rowCopyRows" :key="entry.id" class="sub-item" role="menuitem" @click="pickRowMenu(entry)">{{ entry.title }}</button>
          </template>
        </template>
        <button v-else role="menuitem" @click="pickRowMenu(row)">{{ row.label }}</button>
      </template>
    </AnchoredMenu>
  </div>
</template>

<style scoped>
.sc-warning { margin: 0 12px; color: var(--warning); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.sc-hunk-error { margin: 8px 12px 0; padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--radius-xs); background: var(--warning-bg); }
/* 面板内的检查进度行（上游 `CommitProgressPanel.kt:108-130`）：一行文字 + 可选的取消；整行可点，点上方的放大浮层。 */
.sc-checks-progress { position: relative; cursor: pointer; display: flex; align-items: center; gap: var(--space-2); margin: 4px 12px 0; padding: 4px 8px; border: 1px solid var(--line); border-radius: var(--radius-xs); background: var(--panel); color: var(--text); font-size: 11px; }
.sc-checks-progress-text { flex: 1 1 auto; min-width: 0; display: inline-flex; gap: var(--space-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-checks-progress-detail { color: var(--muted); }
/* 浮层（`PopupCommitChecksProgressIndicator`）：贴在指示器上方 `scale(8)`；进度条无档位（本仓检查不确定进度）。 */
.sc-checks-popup { position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 30; display: flex; flex-direction: column; gap: 4px; min-width: 200px; padding: 6px 8px; border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); box-shadow: var(--popup-shadow); cursor: default; }
.sc-checks-bar { height: 3px; border-radius: 2px; background: linear-gradient(90deg, transparent, var(--accent), transparent); background-size: 40% 100%; background-repeat: no-repeat; animation: sc-checks-slide var(--dur-spin) var(--ease-linear) infinite; }
@keyframes sc-checks-slide { from { background-position: -60% 0; } to { background-position: 160% 0; } }
.sc-checks-indexing { margin: 4px 12px 0; color: var(--muted); font-size: 11px; }
/* 「分组依据」下拉（上游 `ChangesView.GroupBy`）与目录组头。 */
.sc-groupby { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--muted); font-size: 11px; }
.sc-ignored { display: inline-flex; align-items: center; gap: 2px; color: var(--muted); font-size: 11px; white-space: nowrap; }
.sc-groupby select { height: var(--ctrl-height-sm); padding: 0 var(--space-1); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 11px var(--font-ui); }
.sc-group-head { margin: 4px 12px 0; color: var(--muted); font: 11px var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
