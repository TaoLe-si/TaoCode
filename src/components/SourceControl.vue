<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { GitBranch, RefreshCw, Plus, Minus, Check, X, CircleSlash, Download, Upload, Ban, GitPullRequestArrow, ChevronsUpDown, ChevronsDownUp, Clock, Settings, Undo2, TriangleAlert } from 'lucide-vue-next'
import DiffView from './DiffView.vue'
import ChangedHunks from './ChangedHunks.vue'
import AnchoredMenu from './AnchoredMenu.vue'
import { classifyLegend, legendGroups, legendText } from '../commitLegend'
import { AMEND_TOOLTIP, AMEND_CHECKBOX_TEXT, COMMIT_MESSAGE_PLACEHOLDER, MESSAGE_HISTORY_TEXT, MESSAGE_HISTORY_DESCRIPTION,
  EXPAND_ALL_TEXT, COLLAPSE_ALL_TEXT } from '../commitPanelStrings'
import { RERUN_CHECKS_TOOLTIP, NOT_AVAILABLE_DURING_INDEXING, failuresRowText, saveDuringCommitQuestion,
  commitRequestParams } from '../commitChecks'
import { changesMenuRows, isConflictedStatus, type ChangesMenuTarget } from '../changesMenuActions'
import { scanTodoHits } from '../todoScan'
import { copyPatchToClipboard, createPatchFile } from '../patchExport'
import { applyPatchFromClipboard, applyPatchFromFile } from '../patchApplyHost'
import { acceptConflictSide, applyNonConflictingChanges, conflictResolutionAvailability, resolveSimpleConflicts } from '../mergeResolveHost'
import { legendNeedsCompactForm, observeResize } from '../legendFit'
import { readCommitOptions, saveCommitOptions } from '../commitOptions'
import { CHANGES_GROUP_BY_LABELS, GROUP_BY_LABEL, groupChanges, type ChangesGroupBy } from '../changesGrouping'
import { changesViewSettingsKey, defaultChangesViewSettings, groupByOfKeys, keysOfGroupBy, parseChangesViewSettings, serializeChangesViewSettings } from '../changesViewSettings'
// 多变更列表（上游 `ChangeListManager`/`LocalChangeList`，用本仓架构还原：纯模型 + 面板侧状态 + localStorage）。
import { createChangeListsSection } from '../changeListSection'
import { canRemoveList } from '../changeLists'
import { createCommitChecks } from '../sourceControlCommitChecks'
// 每篇文档的修订号账本（提交检查结果指纹的"内容又变了"那一档，见 src/documentRevisions.ts）。
import { documentRevisionList } from '../documentRevisions'

// 「忽略的文件」那一档的文案（`VcsBundle.properties`：`:9` 是短名、`:8` 是说明）。
const SHOW_IGNORED_TEXT = '忽略的文件'
const SHOW_IGNORED_DESCRIPTION = '显示忽略的文件'
import { copyPathMenuRows, findResultClipboardText, type FindCopyActionId } from '../copyPathActions'
import { copyToClipboard } from '../clipboard.ts'
import { setStatusText } from '../statusBarText'
import type { NoticeAction } from '../notices'
// 部分提交（「提交文件…」）的范围层：谁进这次提交、提交完该报几个变更。纯规则在 `src/commitScope.ts`。
import { expandCommitSelection } from '../commitScope'
import { createCommitScope } from '../commitScopeSection'
// 提交信息 MRU（上游 `VcsConfiguration.saveCommitMessage/getRecentMessages` + `ShowMessageHistoryAction`）：
// 会话内按 25 上限去重追加，弹层里 MRU 新→旧排在最前，`git log` 主题兜底。
import { messageHistoryPreviewLine } from '../commitMessageHistory'
import { createCommitMessageSection } from '../commitMessageSection'
import { createCommitMessageHistory } from '../commitMessageHistorySection'
import { fullName, shortName, type CommitAuthor } from '../commitAuthor'
import { createCommitAuthorSection } from '../commitAuthorSection'
import {
  exceedingText,
  FIX_LABELS,
  wrapOnTyping,
  type CommitMessageFix,
  type CommitMessageInspectionSettings,
  type CommitMessageProblem,
} from '../commitMessageInspection'
import { request, type SearchResult, type GitAheadBehind, type GitChange, type GitCompare, type GitCompareFile, type GitLog, type GitStatus, type TodoPattern } from '../bridge'
import { createShelfHost } from '../shelfHost'
// 「与分支比较 / 合成差异」那两组取数与整形（`git.compare` 的入参、变更列表的入参）。
import { type CombinedDiffTarget, targetsForChanges, targetsForCompare } from '../compareDiffHost'
// 面板与 git 之间的会话层（取数 + 操作闸 + 差异取数）：整族拆在 `src/vcsPanelSession.ts`
// （本文件贴着机检上限），状态 ref 仍由面板持有，经 deps 交给它写。
import { createVcsPanelSession } from '../vcsPanelSession'
import ShelfPane from './ShelfPane.vue'
import CombinedDiffDialog from './CombinedDiffDialog.vue'
// 三方合并编辑器（上游 `MergeThreesideViewer` 的三栏，用本仓架构还原）：见 MergeEditor.vue 与 src/mergeEditor.ts。
import MergeEditor from './MergeEditor.vue'
// 变更列表那一行（选择器 + 新建/重命名/删除）：整块拆出（本文件贴着机检上限）。
import ChangeListBar from './ChangeListBar.vue'
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
   * 「提交文件…」的范围（上游 `CheckinFiles`：`VcsActions.xml:187` 那一行 →
   * `CommonCheckinFilesAction.kt:37-53` → `CheckinActionUtil.kt:104-106`、`:121-147`）：
   * 给了就只提交这些路径（`native/git.cpp` 的 `commit(..., paths)` → `git commit --only -- <paths>`）。
   * **默认不给 = 逐字沿用整份暂存区**（请求体里连 `paths` 这个键都不出现）。
   * 订正留痕（2026-10-06 partialcommit）：这条注释原来写 `CommonCheckinFilesAction.kt:26-78` →
   * `CheckinActionUtil.kt:100-160`，那两个区间是抄虚的（真实落点见上面）；它接着写"宿主那条通道
   * 还没接线之前…界面上也就不渲染「提交文件…」那一行 —— 不放假控件"也已经过期：宿主的
   * `git.commit` 已经收 `paths`（`native/main.cpp:1169-1177`），native 那一头也落好了，
   * 所以面板右键菜单里那一行（`commitFile`）+ 状态行是真有消费链路的，不是假控件。
   * 宿主那一档（从项目视图 / 变更视图的多选进来）仍待接线，请求见
   * `docs/wiring-requests-2026-10-06-partialcommit.md` W1（前一批写的
   * `docs/wiring-requests-2026-10-06-vcs2.md` W1 是同一件事，那份文档在盘上，本批把它续上）。
   */
  commitPaths?: readonly string[]
}>()
const status = ref<GitStatus>({ available: true, changes: [] })
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const message = ref('')
const amend = ref(false)
// `ToggleAmendCommitOption.kt:23` tooltip = VcsBundle.properties:1163
// `commit.tooltip.merge.this.commit.with.the.previous.one`, plus the `VK_M` mnemonic of `:19`.
// 「与分支比较」的结果（上游分支弹窗 → `props.compareWith`）：操作过就得作废（模块的 `act` 收尾会清它）。
const compareTo = ref('')
const compared = ref<GitCompareFile[]>([])
const changes = computed(() => status.value.changes ?? [])
// ── 多变更列表（上游 `ChangeListManager`/`LocalChangeList`）──────────────────────────────
// 纯模型与删除语义在 `src/changeLists.ts`，面板侧状态（选中行/计数/四个动作）在
// `src/changeListSection.ts`（本文件贴着机检上限）。这里的两个 computed 只是把既有那两行
// 「已暂存 / 更改」接到"当前列表"上 —— 没有列表概念时（缺省）行为逐字不变：只有**一个**
// 默认列表（`Changes`），它就是活动列表，所有变更都归它。
const changeLists = createChangeListsSection({
  root: () => props.root,
  changes: () => changes.value,
  notify: (message, error) => emit('notify', message, error),
  onChanged: () => void load(),
})
const { state: changeListState, selected: selectedChangeList, rows: changeListRows, visible: visibleChanges,
        listIdOf: changeListIdOf, createInteractive: newChangeList, renameInteractive: renameChangeList,
        remove: removeChangeList, moveInteractive: moveChangesToOtherList } = changeLists
// 变更树按当前列表过滤（上游 `getChangesIn`）；未暂存/已暂存两半仍按 git index 分（本仓既有口径）。
const listChanges = computed(() => visibleChanges.value)
const staged = computed(() => listChanges.value.filter(change => change.staged))
const unstaged = computed(() => listChanges.value.filter(change => !change.staged))
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
// ── 搁架（储藏栈）─────────────────────────────────────────────────────────────────────
// 上游「搁架」工具窗口的等价物：取数与三条动作拆在 `src/shelfHost.ts`，视图在 `ShelfPane.vue`
// （本文件贴着机检上限）。行表由纯模块 `src/shelfTree.ts` 算。
const shelfHost = createShelfHost({
  root: () => props.root,
  onChanged: () => load(),
  onError: message => emit('notify', message, true),
})
const { rows: shelfRowsView, busy: shelfBusy, load: loadShelf, save: saveShelf, pop: popShelf } = shelfHost
// 「查看全部差异…」（上游 `CombinedDiffViewer`）：把这批文件交给合成档查看器，见 CombinedDiffDialog.vue。
// 两处"从哪个列表来"的整形在 `src/compareDiffHost.ts`（与取数同一个模块）。
const combinedTargets = ref<CombinedDiffTarget[]>([])
const combinedTitle = ref('')
// 三方合并编辑器当前打开的文件（上游 `GitConflictsUtil.showMergeWindow` 那条链在本仓的落点：
// 变更行的右键菜单「合并…」）。null = 没开。
const mergeTarget = ref<string | null>(null)
function openCombinedForCompare() {
  if (!compared.value.length) return
  combinedTargets.value = targetsForCompare(compared.value, compareTo.value)
  combinedTitle.value = `与 ${compareTo.value} 的比较`
}
function openCombinedForChanges() {
  const all = targetsForChanges(changes.value)
  if (!all.length) return
  combinedTargets.value = all
  combinedTitle.value = '本地更改'
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
/** 冲突内容判据的过期回答挡板（见 `openRowMenu`）。 */
let rowMenuToken = 0
const rowMenuRows = computed(() => (rowMenu.value ? changesMenuRows(rowMenu.value.change) : []))
const rowCopyRows = computed(() => copyPathMenuRows({
  target: () => (rowMenu.value ? { path: rowMenu.value.change.path, line: 1 } : null),
  root: () => props.root,
  copy: (text: string) => void copyToClipboard(text),
}))
function openRowMenu(event: MouseEvent, change: ChangesMenuTarget & { path: string; staged: boolean; indexStatus?: string; workStatus?: string }) {
  copyOpen.value = false
  // 「未合并」（UU/AU/…）要在菜单里多出冲突那一档：判定表在 `src/changesMenuActions.ts`（照 git4idea）。
  const conflicted = isConflictedStatus(change.indexStatus ?? '', change.workStatus ?? '')
  rowMenu.value = { x: event.clientX, y: event.clientY, change: { ...change, conflicted } }
  // 上游那两条自动合并动作先看**内容**（`MagicResolvedConflictsAction.kt:17` /
  // `ApplyNonConflictsAction.kt:31` 的 `setEnabled`）：内容读回来之前这两条保持可点（不误灰），
  // 读回来后按 `hasAutoResolvableBlock` / `hasNonConflictingBlock` 把灰掉的那条补上。
  // 菜单可能已经关了或换了目标 ⇒ 用一个序号挡住过期回答（同一个 `openRowMenu` 每次都 ++）。
  if (!conflicted) return
  const token = ++rowMenuToken
  void conflictResolutionAvailability(change.path).then(availability => {
    if (token === rowMenuToken && rowMenu.value) Object.assign(rowMenu.value.change, availability)
  })
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
    // 「合并…」：开三方合并编辑器（上游 `GitConflictsUtil.showMergeWindow`）。
    case 'mergeWindow': return void (mergeTarget.value = path)
    case 'resolveConflicts': return void resolveSimpleConflicts(path, mergeDeps())
    case 'applyNonConflicts': return void applyNonConflictingChanges(path, mergeDeps())
    case 'diff': return showDiff({ path, staged: menu.change.staged })
    // 「提交文件…」（上游 `CheckinFiles`，`VcsActions.xml:187` 那一组的第一行）：只把这一次的范围
    // 收到这一条变更上，**不立刻提交** —— 上游也是只 `setCommitState(...)`（`CheckinActionUtil.kt:135-136`），
    // 提交那一下仍归提交按钮。重命名的另一头由 `expandCommitSelection` 补齐。
    case 'commitFile': return setCommitScope(path)
    // 「移到其他变更列表…」（上游 `ChangesView.Move`）：具名列表之间搬变更。
    case 'moveToChangeList': return moveChangesToOtherList([path])
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
// ── 部分提交（「提交文件…」，上游 `CheckinFiles` = `VcsActions.xml:187` 挂在
//    `ChangesViewPopupMenu` 第一行）的面板侧状态 ────────────────────────────────────
// `null` = 没有范围 ⇒ `commitRequestParams` 连 `paths` 这个键都不发，请求体与历史逐字一致。
// 宿主那一档（`props.commitPaths`）与面板自己点的那一批走**同一条**归一化：都过
// `expandCommitSelection` 补齐重命名对（选择与文案那两半拆在 `src/commitScopeSection.ts`，
// 本文件贴着机检上限）。
const { selection: commitSelection, notice: commitScopeNotice, setScope: setCommitScope, clear: clearCommitScope } = createCommitScope({
  changes: () => changes.value,
  externalPaths: () => props.commitPaths,
  // 闭包：`commitPathsToCommit` 在下一行才声明，但这一句只在 `notice` 被读时才求值（那时已就位）。
  pathspec: () => commitPathsToCommit.value,
})
/** 交给 git 的 pathspec：重命名的另一头已补齐（`GitCheckinEnvironment.kt:403-404` 一条变更两朵路径）。 */
const commitPathsToCommit = computed<string[]>(
  () => (commitSelection.value ? expandCommitSelection(commitSelection.value, changes.value) : []))
// ── 面板与 git 之间的会话层（整族拆在 `src/vcsPanelSession.ts`）────────────────────────────
// 仓库状态/差异的取数、文件级操作的执行闸（act）、提交结果的通知都搬进了那个模块（本文件贴着
// 机检上限）：搬走的行一个字没改，只是状态 ref 仍由面板持有（模板与别的模块都在读），
// 经 deps 交给它写。`commitCheckError` 由提交检查那一节在下面才创建 ⇒ 读改动块失败那一句走
// `onHunksError` 回调；操作后的刷新走面板下面那个 `load()`（状态 + 搁架列表）。
const {
  diff, invalidateStatus, errorText, loadStatus, refreshAfterHunkApply, act, stage, rollbackConfirm,
  unstage, checkout, push, fetch, ignore, showDiff, reportCommitResult,
} = createVcsPanelSession({
  props, emit, status, loading, busy, error, changes, compared, ahead, extrasError, showIgnored,
  reload: () => load(),
  onHunksError: text => { commitCheckError.value = text },
})
/** 面板的取数入口：读一次 `git.status`（模块）并顺带刷新搁架列表（`git stash list`）。 */
async function load() {
  await loadStatus()
  void loadShelf()
}
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
  // 「提交文件…」时"这次包含的那些变更" = 补齐重命名对之后的那批 pathspec
  // （`CheckinActionUtil.kt:153-167` 的 `getIncludedChanges()` 算的就是这个集合），
  // 没有范围时才是暂存区那一份。订正留痕：原注释写 `:100-160`，上游那个区间里没有
  // `getIncludedChanges`（函数体在 `:153-167`，被选 changes/unversioned 的取法在 `:104-106`）。
  const stagedPaths = commitPathsToCommit.value.length
    ? commitPathsToCommit.value
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
      // 「提交文件…」的范围：空 = 不带这个键，请求体与历史逐字一致。
      // 带上变更列表才做得动两档判断（重命名对补齐、被忽略/陌生路径拒绝），见 `src/commitChecks.ts`。
      paths: commitPathsToCommit.value, changes: changes.value,
    }))
    committed = true
    // 范围是一次性的：提交完就收回。上游那一头是提交结果处理器 `CommitStateCleaner.resetState()`
    // （`vcs/commit/NonModalCommitWorkflowHandler.kt:636-644`：`disposeCommitOptions()` +
    // `clearCommitContext()`（`AbstractCommitWorkflow.kt:197-199` 换一个全新的 CommitContext）+
    // `initCommitHandlers()` —— 被选范围挂在重建出来的那些 handler 上（`AbstractCommitWorkflowHandler.kt:132`
    // 的 `inclusionChanged()` → `includedChangesChanged()`），重建即回默认）。
    // 本仓的范围是面板自己的一个 ref ⇒ 显式清掉，不留"下一次静默沿用上一轮子集"的口子。
    clearCommitScope()
    // 提交成功 ⇒ 上游 `CheckinProjectPanel` 的收尾会把信息存进 MRU（VcsConfiguration:169-177）。
    messageHistory.remember(text)
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
const checksProgressEl = ref<HTMLElement | null>(null)
// `isExpandAllVisible()`：分组不是 NONE 或模型不是平铺 —— 本仓的分组就是已暂存/更改这两组 ⇒ 有改动就成立。
const hasGroups = computed(() => listChanges.value.length > 0)
// IDEA's commit-message inspections (vcs/commit/message/): the subject line and every body line
// are checked against their right margins, and line 1 has to be empty before the body starts.
// 规则在 src/commitMessageInspection.ts；检查/定位/快捷修复/amend 改写四件事拆在
// src/commitMessageSection.ts（本文件贴着机检上限）。
const messageBox = ref<HTMLTextAreaElement | null>(null)
const { problems: messageProblems, focusProblem, applyFix, reformat: reformatMessage } = createCommitMessageSection({
  message, amend, settings: () => props.commitSettings, box: () => messageBox.value,
  onError: text => { error.value = text },
})
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
  // 「提交文件…」的范围（`CommitChecksDeps.commitScope`，:88 那一档）：上游那条 `isCommitEmpty()`
  // 问的是**这次包含的变更**（`AbstractCommitWorkflowHandler.kt:82` + `CheckinActionUtil.kt:135-136`），
  // 不是整份暂存区。没范围时这里给空数组 ⇒ `commitIncludedCount` 返回 `null` ⇒ 判据退回整份暂存区，
  // 与本批之前逐字一致（`tests/commit-checks.test.mjs` 钉着那一条）。
  commitScope: () => commitPathsToCommit.value,
  // 每篇文档的**修订号**（上游 `Document.getModificationStamp()`，`DocumentImpl.java:171`：每改一次换一个号）
  // —— "内容又变了 ⇒ 上一轮结果作废"这一维的唯一驱动。`dirtyPaths` 只是"哪些标签是脏的"的快照，
  // 同一篇改第二次它一个字都不变，所以它担不了这一档。账本在 src/documentRevisions.ts：
  // 每次键入由 `src/lspNavigation.ts` 的 `onEditorChange` 记一笔，程序性改写（缩进转换）另记一笔
  // （`setDraft` 不发 `@change`，见 CodeEditor.vue 的 `replacing` 那道闸）。
  documentRevisions: documentRevisionList,
})

// IDEA's commit message history: session MRU first (newest first), git log subjects as fallback;
// hovering a row previews it in the box, leaving restores the draft, clicking keeps it.
// 状态与三件事的次序（打开/预览/落定/记一笔）拆在 src/commitMessageHistorySection.ts
// —— 本文件贴着机检上限，这一段与变更列表无关。
const messageHistory = createCommitMessageHistory({
  fetchSubjects: async () => (await request<GitLog>('git.log')).commits.map(entry => entry.subject),
  message,
  onError: caught => { error.value = caught },
})
// 模板里那三处沿用既有写法（`:aria-expanded="messageHistoryOpen"` 一类）—— 拆模块只是把状态搬走，
// 不改工具带上那颗按钮的形状（判据 `tests/scm-panel-strings.test.mjs` 钉着它）。
const messageHistoryOpen = messageHistory.open
const toggleMessageHistory = messageHistory.toggle
// `Vcs.UpdateProject`（与 `Vcs.Push` 同在 `VcsToolbarActions`，VcsActions.xml:416-425）：
// 先刷新远端（fetch）再做整合（pull）—— 与 Git 菜单那条宿主实现（`src/vcsActions.ts`）同义。
const updateProject = () => act(async () => { await request('git.fetch'); await request('git.pull') })
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
function onChecksPopupOutsidePointer(event: PointerEvent) {
  if (!checksPopupOpen.value || checksProgressEl.value?.contains(event.target as Node)) return
  checksPopupOpen.value = false
}
function onChecksPopupEscape(event: KeyboardEvent) {
  const target = event.target
  if (event.key !== 'Escape' || !checksPopup.value.visible || !(target instanceof Node)
      || !checksProgressEl.value?.contains(target)) return
  event.preventDefault()
  event.stopPropagation()
  checksPopupOpen.value = false
}
onMounted(() => {
  void load()
  void loadAuthor()
  window.addEventListener('keydown', onAmendMnemonic)
  document.addEventListener('pointerdown', onChecksPopupOutsidePointer, true)
  window.addEventListener('keydown', onChecksPopupEscape, true)
  // Re-measure the legend once it is in the DOM, then on every size change and every
  // time the counts change (the inclusion listener of the source fires updateLegend).
  measureLegend()
  stopLegendFit = observeResize(legendRef.value, () => measureLegend())
})
onBeforeUnmount(() => {
  stopLegendFit?.()
  stopLegendFit = null
  window.removeEventListener('keydown', onAmendMnemonic)
  document.removeEventListener('pointerdown', onChecksPopupOutsidePointer, true)
  window.removeEventListener('keydown', onChecksPopupEscape, true)
})
watch(legendFullText, () => void nextTick(measureLegend))
watch(() => [props.root, props.active] as const, () => {
  if (!props.active) return
  // Switching projects invalidates the per-project comparison and history panel,
  // plus any status request still running for the previous root.
  invalidateStatus()
  extrasError.value = ''
  compareTo.value = ''
  compared.value = []
  // The author comes from the repository configuration, so a new project needs a re-read
  // and any override made for the previous repository must not leak into it.
  authorOverride.value = null
  authorDraft.name = ''
  authorDraft.email = ''
  optionsOpen.value = false
  // 历史弹层与 MRU 都是上一个仓库的事实（换项目重新读回）。
  messageHistory.reset()
  // 提交选项按工作区根分开存：换项目重新读回（上游 `VcsConfiguration` 是项目级配置）。
  const reloaded = readCommitOptions(props.root)
  signoff.value = reloaded.signoff
  checkTodoBeforeCommit.value = reloaded.checkTodoBeforeCommit
  postponeSlowChecks.value = reloaded.postponeSlowChecks
  // 变更列表也按工作区根分开存（上游 `ChangeListManager` 是工程级）：换项目重新读回。
  changeLists.reload()
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
        <div v-if="messageProblems.length" class="sc-msg-inspections" role="alert" aria-label="提交信息检查">
          <p v-for="problem in messageProblems" :key="`${problem.kind}:${problem.line}`" class="sc-inspection-row">
            <button type="button" class="sc-inspection-line" :title="`选中第 ${problem.line + 1} 行中超出边距的部分`" @click="focusProblem(problem)">第 {{ problem.line + 1 }} 行</button>
            <span class="sc-inspection-text">{{ problem.message }}</span>
            <code class="sc-inspection-excess" :title="`超出范围：[${problem.start}, ${problem.end})`">{{ exceedingText(message, problem) }}</code>
            <button v-for="fix in problem.fixes" :key="fix" type="button" class="sc-tool sc-inspection-fix" :disabled="busy" :title="FIX_LABELS[fix]" @click="applyFix(problem, fix)">{{ FIX_LABELS[fix] }}</button>
          </p>
        </div>
        <div v-if="messageHistory.open.value" class="sc-msg-history">
          <p v-if="messageHistory.loading.value" class="sc-empty-line">正在读取历史提交信息…</p>
          <p v-else-if="!messageHistory.rows.value.length" class="sc-empty-line">暂无历史提交信息。</p>
          <template v-else>
            <button v-for="subject in messageHistory.rows.value" :key="subject" class="sc-msg-row"
                    :title="`使用这条提交信息：${subject}`"
                    @mouseenter="messageHistory.preview(subject)" @mouseleave="messageHistory.endPreview" @click="messageHistory.pick(subject)">{{ messageHistoryPreviewLine(subject, props.commitSettings.subjectRightMargin) }}</button>
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
      <!-- 变更列表一节（上游 `ChangesView.Changelists` 组）：整块拆到 ChangeListBar.vue
           （本文件贴着机检上限），状态与四个动作在 src/changeListSection.ts。 -->
      <ChangeListBar
        :rows="changeListRows" :selected="selectedChangeList" :disabled="busy"
        :removable="canRemoveList(changeListState, selectedChangeList)" :multiple="changeListRows.length > 1"
        @select="changeLists.select($event)" @create="newChangeList" @rename="renameChangeList(selectedChangeList)" @remove="removeChangeList(selectedChangeList)"
      />
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
            <button v-if="!change.untracked && !change.ignored" class="icon-button" title="回滚工作区改动（丢弃未暂存修改）" aria-label="回滚改动" :disabled="busy" @click="rollbackConfirm(change.path)"><Undo2 :size="iconSize.control" /></button>
            <button v-if="change.untracked" class="icon-button" title="加入 .gitignore" aria-label="加入 .gitignore" :disabled="busy" @click="ignore(change.path)"><Ban :size="iconSize.menu" /></button>
            <button v-if="!change.ignored" class="icon-button" title="暂存" aria-label="暂存" :disabled="busy" @click="stage(change.path)"><Plus :size="iconSize.control" /></button>
          </div>
          </template>
        </section>
        <div v-if="!listChanges.length" class="sc-empty"><Check :size="iconSize.artwork" /><p>工作区干净</p><span>{{ changeListRows.length > 1 ? `「${changeLists.active.value?.name ?? ''}」这个变更列表里没有更改。` : '没有需要提交的更改。' }}</span></div>
        <section v-if="compareTo" class="sc-section">
          <h3>与 {{ compareTo }} 的比较 <span class="sc-count">{{ compared.length }}</span>
            <button v-if="compared.length" class="sc-tool sc-all-diffs" title="在合成差异里一次看完这批文件" aria-label="查看全部差异" @click="openCombinedForCompare">全部差异…</button>
          </h3>
          <div v-for="file in compared" :key="'c' + file.path" class="sc-row">
            <button class="sc-file" :title="`${file.status} · ${file.path}`" @click="showDiff({ path: file.path, staged: false, base: compareTo })"><span class="sc-status">{{ file.status }}</span><span class="sc-path">{{ file.path }}</span></button>
          </div>
          <p v-if="!compared.length" class="sc-empty-line">该分支相对此处没有多出的文件。</p>
        </section>
      </div>
      <!-- 搁架（储藏栈）一节：`git stash list` 的条目，上游「搁架」工具窗口的等价物
           （见 src/shelfTree.ts 文件头）。放在变更区之后、提交动作之前。 -->
      <ShelfPane :rows="shelfRowsView" :busy="busy || shelfBusy" :loading="loading" @save="saveShelf" @pop="popShelf" @refresh="loadShelf" />
      <!-- IDEA 的 `CommitChecksProgressIndicator`（`CommitProgressPanel.kt:108-130`）：跑检查时那一行
           （标题 + 两档正文 + 取消），任务结束整行收掉（可见性由 `checksProgress(..., running)` 给）。 -->
      <div v-if="checksProgress.visible" ref="checksProgressEl" class="sc-checks-progress" role="group">
        <button type="button" class="sc-checks-progress-trigger" aria-haspopup="dialog" :aria-expanded="checksPopup.visible" @click="checksPopupOpen = !checksPopupOpen">
          <span class="sc-checks-progress-text" role="status"><strong>{{ checksProgress.title }}</strong>{{ checksProgress.text }}</span>
          <span v-if="checksProgress.detail" class="sc-checks-progress-detail">{{ checksProgress.detail }}</span>
        </button>
        <button v-if="checksProgress.cancellable" class="sc-tool" :disabled="!checksBusy" @click.stop="cancelCommitChecks">{{ checksProgress.cancelText }}</button>
        <div v-if="checksPopup.visible" class="sc-checks-popup" role="dialog" aria-label="提交检查进度" @click.stop>
          <div class="sc-checks-popup-heading"><span>{{ checksPopup.title }}：{{ checksPopup.text }}</span>
            <button type="button" class="icon-button" :title="checksProgress.cancelText" :aria-label="checksProgress.cancelText" :disabled="!checksBusy" @click="cancelCommitChecks"><X :size="iconSize.dense" /></button>
          </div>
          <span class="sc-checks-bar" role="progressbar" aria-label="提交检查进行中" />
        </div>
      </div>
      <!-- 项目分析期间那条警告（`:310`）：不在分析中、或者正在跑检查时都不出现。 -->
      <p v-if="indexingWarning" class="sc-checks-indexing" role="status">{{ NOT_AVAILABLE_DURING_INDEXING }}</p>
      <!-- 部分提交那一行（上游没有这一条独立控件：`CheckinFiles` 把范围设进 commit state 之后，
           界面那一头是提交面板里"这次包含的变更"那一截）。本仓只留一条状态行 + 一个清除动作：
           不收掉就看不出这次只提交子集，也关不掉。文案不带颜色、不带 hex（复用 `sc-checks-indexing`
           那条状态行的类）。 -->
      <p v-if="commitScopeNotice" class="sc-checks-indexing" role="status">{{ commitScopeNotice }}
        <button class="sc-tool" :disabled="busy" @click="clearCommitScope">恢复提交全部</button></p>
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
    <!-- 合成差异（上游 `CombinedDiffViewer`）：把这批文件一次看完，块间导航在 DiffView 里。 -->
    <CombinedDiffDialog v-if="combinedTargets.length" :targets="combinedTargets" :title="combinedTitle" :context="props.diffContextLines ?? 0" @close="combinedTargets = []" />
    <!-- 三方合并编辑器（上游 `MergeThreesideViewer` 的三栏，见 MergeEditor.vue）：冲突行的「合并…」打开。 -->
    <div v-if="mergeTarget" class="modal-backdrop" @click.self="mergeTarget = null">
      <section class="diff-dialog merge-dialog" role="dialog" aria-modal="true">
        <MergeEditor :path="mergeTarget" closable @close="mergeTarget = null" @applied="load()" @notify="(message, error) => emit('notify', message, error)" />
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
        <!-- `:disabled` = 上游那两条自动合并动作的 `setEnabled`（内容里一处都合不掉时灰掉，
             见 src/changesMenuActions.ts 的行表注释）；其余行 `enabled` 恒 true。 -->
        <button v-else role="menuitem" :disabled="row.enabled === false" @click="pickRowMenu(row)">{{ row.label }}</button>
      </template>
    </AnchoredMenu>
  </div>
</template>

<style scoped>
.sc-panel { background: var(--panel); color: var(--text); }
.sc-header { box-sizing: border-box; min-height: var(--panel-heading-h); padding: 0 var(--space-3); background: var(--rail); }
.sc-header .sc-branch { min-height: var(--ctrl-height-sm); padding: 0 var(--space-2); border-radius: var(--radius-xs); background: var(--editor); font-size: 11px; }
.sc-header > .icon-button { width: var(--ctrl-height-sm); height: var(--ctrl-height-sm); }
.sc-commit { background: var(--panel); }
.sc-commit textarea { background: var(--editor); border-color: var(--line-strong); border-radius: var(--radius-xs); padding: var(--space-2); }
.sc-changes-head { min-height: var(--panel-heading-h); background: var(--rail); border-bottom: 1px solid var(--line); }
.sc-toolbar { align-items: center; background: var(--panel); }
.sc-scroll { background: var(--editor); padding-top: var(--space-1); }
.sc-section { margin: 0; padding: var(--space-1) 0; }
.sc-section + .sc-section { border-top: 1px solid var(--line); }
.sc-section h3 { color: var(--secondary); letter-spacing: 0; text-transform: none; }
.sc-row { min-height: var(--tree-row-h); }
.sc-row > .icon-button { width: var(--ctrl-height-sm); height: var(--ctrl-height-sm); border-radius: var(--radius-xs); }
.sc-file { min-height: var(--tree-row-h); padding: 0; }
.sc-actions { align-items: center; background: var(--panel); }
.sc-empty { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); padding: var(--space-6) var(--space-3); color: var(--muted); text-align: center; }
.sc-empty p { margin: 0; color: var(--text); font-size: 12px; font-weight: 500; }
.sc-empty span { color: var(--muted); font-size: 11px; }
.sc-panel > .sc-empty { flex: 1; justify-content: center; }
.sc-warning { margin: 0 var(--space-3); color: var(--warning); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.sc-hunk-error { margin: var(--space-2) var(--space-3) 0; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-xs); background: var(--warning-bg); }
/* 面板内的检查进度行（上游 `CommitProgressPanel.kt:108-130`）：一行文字 + 可选的取消；整行可点，点上方的放大浮层。 */
.sc-checks-progress { position: relative; cursor: pointer; display: flex; align-items: center; gap: var(--space-2); margin: var(--space-1) var(--space-3) 0; padding: var(--space-1) var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-xs); background: var(--panel); color: var(--text); font-size: 11px; }
.sc-checks-progress-trigger { display: flex; flex: 1 1 auto; min-width: 0; align-items: center; gap: var(--space-2); border: 0; padding: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.sc-checks-progress-trigger:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.sc-checks-progress-text { flex: 1 1 auto; min-width: 0; display: inline-flex; gap: var(--space-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-checks-progress-detail { color: var(--muted); }
/* 浮层（`PopupCommitChecksProgressIndicator`）：贴在指示器上方 `scale(8)`；进度条无档位（本仓检查不确定进度）。 */
.sc-checks-popup { box-sizing: border-box; position: absolute; bottom: calc(100% + var(--space-2)); left: 0; z-index: 30; display: flex; flex-direction: column; gap: var(--space-1); width: 100%; min-width: 0; padding: var(--space-2); border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); box-shadow: var(--popup-shadow); cursor: default; }
.sc-checks-popup-heading { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.sc-checks-popup-heading > span { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-checks-bar { height: 3px; border-radius: 2px; background: linear-gradient(90deg, transparent, var(--accent), transparent); background-size: 40% 100%; background-repeat: no-repeat; animation: sc-checks-slide var(--dur-spin) var(--ease-linear) infinite; }
@keyframes sc-checks-slide { from { background-position: -60% 0; } to { background-position: 160% 0; } }
.sc-checks-indexing { margin: var(--space-1) var(--space-3) 0; color: var(--muted); font-size: 11px; }
/* 「分组依据」下拉（上游 `ChangesView.GroupBy`）与目录组头。 */
.sc-groupby { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--muted); font-size: 11px; }
.sc-ignored { display: inline-flex; align-items: center; gap: 2px; color: var(--muted); font-size: 11px; white-space: nowrap; }
.sc-groupby select { height: var(--ctrl-height-sm); padding: 0 var(--space-1); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 11px var(--font-ui); }
.sc-group-head { margin: var(--space-1) var(--space-3) 0; color: var(--muted); font: 11px var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 变更列表那一行的样式在 ChangeListBar.vue（scoped）。三方合并那张窗口比普通差异对话框宽（三栏并排）。 */
.merge-dialog { width: min(1200px, 96vw); }
</style>
