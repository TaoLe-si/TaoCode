// 提交选项的**存档**与「慢检查推后到提交后」的决策（上游 `CommitOptions` 的
// save/restore 统一层、`CommitChecks.kt` 的 `setRunSlowCommitChecksAfterCommit`、
// `CommitOptionsPanel.kt:116` 的那个勾选框、`NonModalCommitWorkflowHandler.kt:402`）。
//
// 上游把提交选项存在 `VcsConfiguration`（项目级 PropertiesComponent）里：
//   · `NON_MODAL_COMMIT_POSTPONE_SLOW_CHECKS`（`VcsConfiguration.java:151`，**默认 true**）——
//     开着时慢检查（post-commit checks）不挡提交，提交结束后再跑
//     （`NonModalCommitWorkflowHandler.kt:398-407` 的 `pendingPostCommitChecks`）；
//   · 提交作者/是否 reload 等各自也是配置项（`CommitOptions` 的 saveState/restoreState）。
//
// 本仓对应的选项现在只有三档（补齐这一层之前它们是纯会话态，关掉面板就没了）：
//   署名（`--signoff`）、提交前 TODO 预检、以及「慢检查推后到提交后」。
// 本模块只做**纯存取与决策**：storage 可注入（node --test 里不用 DOM），默认 localStorage、
// 按工作区根分键（上游是项目级配置）。**如实记的映射**：本仓唯一的"检查"是 TODO 预检
// （上游把它归在 before-commit checks），这个开关在本仓的用户可见效果就是
// 「提交前跑」↔「提交后跑」——与上游那条开关的可见语义一致。

export interface CommitOptionsState {
  /** 提交署名（`--signoff`；上游 `CommitOptions.COMMIT_OPTIONS` 的 sign-off 档）。 */
  signoff: boolean
  /** 提交前 TODO 预检（上游 `CHECK_TODO_BEFORE_PROJECT_COMMIT` 项目级开关）。 */
  checkTodoBeforeCommit: boolean
  /** 慢检查推后到提交后（上游 `NON_MODAL_COMMIT_POSTPONE_SLOW_CHECKS`，默认 true）。 */
  postponeSlowChecks: boolean
}

/** 上游默认：署名与 TODO 预检默认关，慢检查推后默认**开**（`VcsConfiguration.java:151`）。 */
export const DEFAULT_COMMIT_OPTIONS: CommitOptionsState = Object.freeze({
  signoff: false, checkTodoBeforeCommit: false, postponeSlowChecks: true,
})

/** 存取用的最小存储接口（`localStorage` 的子集；测试里给内存实现）。 */
export interface CommitOptionsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 按工作区根分键（上游是项目级 `VcsConfiguration`）。 */
export function commitOptionsKey(root: string): string {
  return `taocode.commitOptions:${root ?? ''}`
}

function defaultStorage(): CommitOptionsStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch { return null }
}

/** 读回选项：读不到/读坏/键类型不对的一律落回默认（不许拿坏存档挡住提交）。 */
export function readCommitOptions(root: string, storage: CommitOptionsStorage | null = defaultStorage()): CommitOptionsState {
  try {
    const raw = storage?.getItem(commitOptionsKey(root))
    if (!raw) return { ...DEFAULT_COMMIT_OPTIONS }
    const parsed = JSON.parse(raw) as Partial<CommitOptionsState>
    return {
      signoff: parsed.signoff === true,
      checkTodoBeforeCommit: parsed.checkTodoBeforeCommit === true,
      postponeSlowChecks: parsed.postponeSlowChecks !== false,
    }
  } catch { return { ...DEFAULT_COMMIT_OPTIONS } }
}

/** 写回选项（存不下不影响本次会话 —— 与 `taocode.diffOptions` 同一条规矩）。 */
export function saveCommitOptions(root: string, state: CommitOptionsState, storage: CommitOptionsStorage | null = defaultStorage()): void {
  try { storage?.setItem(commitOptionsKey(root), JSON.stringify(state)) } catch { /* session-only */ }
}

/** 检查在提交**前**跑（挡提交）：只有关掉「慢检查推后」才是这条。 */
export function runsChecksBeforeCommit(state: CommitOptionsState): boolean {
  return !state.postponeSlowChecks
}

/** 检查在提交**后**跑（`pendingPostCommitChecks`，`NonModalCommitWorkflowHandler.kt:402`）。 */
export function runsChecksAfterCommit(state: CommitOptionsState): boolean {
  return state.postponeSlowChecks
}

/**
 * 提交后那一轮检查的失败文本（上游 `PostCommitChecksHandler` 的通知：
 * 提交本身已成功，检查失败**不撤销提交**，只报 failures）。
 */
export function postCommitCheckFailures(failures: readonly string[]): string {
  if (!failures.length) return ''
  return `提交已完成，但提交后检查发现 ${failures.length} 个问题：${failures.join('；')}`
}
