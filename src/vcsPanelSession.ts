// 变更面板与 git 之间的会话层：仓库状态的取数（`git.status` / `git.aheadBehind`）、单文件差异的取数
// （`git.diff` / `git.diffSides` / `git.diffHunks`），以及文件级操作的执行闸（`act`：暂存 / 回滚 /
// 取消暂存 / 检出 / 推送 / 获取 / 忽略）。提交结果的通知（`reportCommitResult` 一族）也在这里
// —— 它读的是同一份变更列表。
//
// 从 `SourceControl.vue` 按行号切片搬出来（模块化拆分，行为逐字未改）：那个组件贴着 900 行机检
// 上限，而这一族只与 `request('git.*')` 的通道、`act()` 那个操作闸打交道。**不**在这一块里的：
// 提交那条链（`runCommit` + `git.commit`，它就是面板的提交按钮）、提交检查
// （`src/sourceControlCommitChecks.ts`）、变更列表（`src/changeListSection.ts`）、搁架
// （`src/shelfHost.ts`）、右键菜单的行表（`src/changesMenuActions.ts`），以及「与分支比较 /
// 合成差异」那两组**对话框**状态（面板拥有那两张窗口，`compared` / `compareTo` /
// `combinedTargets` / `combinedTitle` 留在面板，本模块只把 `act` 里"操作过就作废比较"那一句
// 写回面板交进来的 `compared`）。
//
// 三处边界与面板里的同名调用保持一致：
//   · `props` / `emit` 原样交进来（与 `createCommitChecks` 同一个口径）；
//   · 状态 ref（status / loading / busy / error / changes / compared / ahead / extrasError）由
//     **面板**持有 —— 模板、变更列表一节、与分支比较那条 watch 与提交检查都在读它们 ——
//     所以走 deps 交进来，本模块只写它们的值；
//   · 刷新入口 `reload` 是面板那个 `load()`（`git.status` + 搁架列表那一份）：操作与逐块暂存
//     之后要刷的仍是它，`act` 与 `refreshAfterHunkApply` 走 dep 调它，不各自拼一遍；
//   · `showDiff` 读改动块失败时要写面板那条错误行，而那个 ref（`commitCheckError`）由提交检查
//     那一节持有、晚于本模块创建 ⇒ 这一句走 `onHunksError` 回调，其余搬动的行一个字都没改。
//
// `fetch` 与「提交已取消」那条通知（`reportCommitCanceled`）今天面板里没有调用点（上游
// `Vcs.Fetch` 在 Git 菜单里，取消那一条 UI 未接线），随这一族一起搬过来，行为未改。
import { ref, type Ref } from 'vue'
import {
  request, type DiffRow, type DiffSides, type GitAheadBehind, type GitChange, type GitCompareFile,
  type GitHunks, type GitStatus,
} from './bridge.ts'
import { COMMIT_CANCELED, COMMIT_NOTIFICATION_ID, commitNotificationRows, commitNotificationTitle } from './commitNotification.ts'
import { committedChangeCount } from './commitScope.ts'
import type { NoticeAction } from './notices.ts'

/** 单文件差异视图的当前状态（IDEA 的提交查看器那一档：可逐块暂存的工作区/索引差异）。 */
export interface DiffState { path: string; staged: boolean; base: string; text: string; rows: DiffRow[]; truncated: boolean; hunks?: GitHunks }

/** 面板交进来的那一份状态与通道（ref 都是面板的，本模块只写它的值）。 */
export interface VcsPanelSessionDeps {
  /** 面板的 props（`diffContextLines` 拼成 git 的 -U<n>）。 */
  props: { diffContextLines?: number }
  emit: (event: 'notify', message: string, error?: boolean, displayId?: string, detail?: string[],
         actions?: NoticeAction[]) => void
  status: Ref<GitStatus>
  loading: Ref<boolean>
  busy: Ref<boolean>
  error: Ref<string>
  /** 整份变更列表（`git.status` 的 changes：变更列表一节、提交请求体与提交结果计数都读它）。 */
  changes: Ref<GitChange[]>
  /** 「与某分支比较」的结果（操作过就得作废：`act` 的收尾会清它）。 */
  compared: Ref<GitCompareFile[]>
  ahead: Ref<GitAheadBehind>
  /** 次读取数（远程领先/落后、改动块）失败时那一条警告（不整块失败，也不静默）。 */
  extrasError: Ref<string>
  /** 「显示忽略的文件」（开着时 `git status --ignored=matching`）。 */
  showIgnored: Ref<boolean>
  /** 面板的取数入口（`git.status` + 搁架列表）：操作与逐块暂存之后刷的是它。 */
  reload: () => Promise<void>
  /**
   * 读改动块失败时写面板那条错误行（`commitCheckError` 由提交检查那一节持有，晚于本模块创建，
   * 所以这一档走回调，不把 ref 传进来）。
   */
  onHunksError: (text: string) => void
}

export interface VcsPanelSession {
  /** 当前打开的那份差异（null = 没开）。 */
  diff: Ref<DiffState | null>
  /** 换项目时把在飞的 status 请求作废（旧答案落上来会显示别的仓库的变更）。 */
  invalidateStatus: () => void
  errorText: (caught: unknown) => string
  /** 读一次 `git.status`（顺带刷远程领先/落后）；面板的 `load()` 在它之后刷搁架列表。 */
  loadStatus: () => Promise<void>
  /** 逐块暂存/退回之后：刷新变更列表与差异（子组件发事件触发）。 */
  refreshAfterHunkApply: () => Promise<void>
  /** 一次 git 操作：忙碌位 + 错误行 + 操作完刷新（任何操作都可能改变分支比较，一并作废）。 */
  act: (operation: () => Promise<unknown>, onFailure?: (message: string) => void) => Promise<void>
  stage: (path: string) => Promise<void>
  rollbackConfirm: (path: string) => void
  unstage: (path: string) => Promise<void>
  checkout: (branch: string) => Promise<void>
  push: () => Promise<void>
  fetch: () => Promise<void>
  ignore: (path: string) => Promise<void>
  showDiff: (target: { path: string; staged: boolean; base?: string }) => Promise<void>
  reportCommitResult: (text: string, includedPaths: readonly string[], failures: readonly string[]) => void
  reportCommitCanceled: () => void
}

export function createVcsPanelSession(deps: VcsPanelSessionDeps): VcsPanelSession {
  const {
    props, emit, status, loading, busy, error, changes, compared, ahead, extrasError, showIgnored,
    reload, onHunksError,
  } = deps

  const diff = ref<DiffState | null>(null)
  // Every status read carries a token: another project taking over mid-request makes
  // the answer stale, and applying it would show a foreign repository's changes here.
  let statusToken = 0
  function errorText(caught: unknown) { return caught instanceof Error ? caught.message : String(caught) }

  async function loadStatus() {
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
    await reload()
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
  function reportCommitResult(text: string, includedPaths: readonly string[], failures: readonly string[]) {
    // 数的是**变更**不是路径：一次重命名交出去两朵 pathspec，上游那一条 `HashSet(changes).size`
    // （`ShowNotificationCommitResultHandler.kt:42-43` + `:128`）也只算一个。
    const committed = committedChangeCount(includedPaths, changes.value)
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
    try { await operation(); await reload() }
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
  const checkout = (branch: string) => act(() => request('git.checkout', { branch }))
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
        catch (caught) { hunks = undefined; onHunksError(`读取改动块失败，只能整体暂存：${errorText(caught)}`) }
      }
      diff.value = {
        path: target.path, staged: target.staged, base,
        text: unified.diff || '（无差异；可能是未跟踪文件）',
        rows: sides.rows ?? [], truncated: sides.truncated === true,
        hunks,
      }
    } catch (caught) { error.value = errorText(caught) }
  }
  /** 换项目时把在飞的 status 请求作废（原先是面板里那个 `statusToken++`）。 */
  function invalidateStatus() { statusToken++ }

  return {
    diff, invalidateStatus, errorText, loadStatus, refreshAfterHunkApply, act, stage, rollbackConfirm,
    unstage, checkout, push, fetch, ignore, showDiff, reportCommitResult, reportCommitCanceled,
  }
}
