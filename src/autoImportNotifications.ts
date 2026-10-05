// 外部系统的「项目已更改，是否同步」通知 —— 上游 `AutoImportProjectTracker` 的通知分支
// 加 `AutoImportProjectNotificationAware`、`HideProjectRefreshAction`、`ProjectRefreshAction`。
//
// 上游行为（`AutoImportProjectTracker.kt`）：
//   · `processChanges` 对每个项目判三件事：已是最新 → `notificationExpire`（:214）；
//     重载被禁用（未激活/全局关）→ 也 `notificationExpire`（:216-219）；
//     **自动重载被禁用但项目不是最新** → `notificationNotify`（:220-223）——
//     这不是静默跳过，而是挂一条通知，让用户显式点「Sync Changes」；
//     真要重载 → `notificationExpire` 再排重载（:224-228）。
//   · `isDisabledAutoReload`（:285-317）就是 `AutoReloadType` 三档 × 修改类型
//     （EXTERNAL/INTERNAL/HIDDEN/UNKNOWN）的矩阵：ALL 对 EXTERNAL/INTERNAL 都自动，
//     SELECTIVE 只对 EXTERNAL 自动，NONE 全不自动；本仓同一判据在 `src/gradle.ts` 的
//     `shouldAutoReload`（`changedOutsideIde` 即 EXTERNAL 与 INTERNAL 的分界）。
//   · `AutoImportProjectNotificationAware`（AutoImportProjectNotificationAware.kt:15-45）按
//     `ExternalSystemProjectId` 记一个集合，`isNotificationVisible()` ⇔ 集合非空；
//     `notificationExpire()` 无参 = 清空（`HideProjectRefreshAction.actionPerformed` :12-16）。
//   · `ProjectRefreshAction`（ProjectRefreshAction.kt:24-27, :93-100）的文字来自
//     `ExternalSystemBundle.properties`：`Sync {0} Changes` / `Hide This Notification`；
//     点 Sync 走 `Manager.refreshProject` 的 `scheduleProjectRefresh()`（:76-84）。
//
// 本模块只做「状态 + 通知构造」，宿主通过注入的 `notify` 拿到一条带按钮的通知；
// 纯函数部分可以在 node 下直接测（不需要 Vue/DOM）。

import type { NoticeAction } from './notices'

/** 上游 `ExternalSystemBundle.properties` 的动作文字。 */
export const AUTO_IMPORT_SYNC_LABEL = '同步更改'
export const AUTO_IMPORT_HIDE_LABEL = '隐藏此通知'

/** 一条通知的稳定 displayId：同一个系统反复登记是**刷新**同一条，而不是堆历史。 */
export function autoImportDisplayId(systemId: string): string {
  return `external-system:reload:${systemId}`
}

/**
 * 通知可见性状态（`AutoImportProjectNotificationAware` 的集合投影）。
 * `systems` 为空 ⇔ 没有通知可显示。
 */
export interface AutoImportNotificationState {
  systems: string[]
}

export function emptyAutoImportState(): AutoImportNotificationState {
  return { systems: [] }
}

/** `notificationNotify(projectAware)`：登记一个待同步的系统（去重，顺序稳定）。 */
export function notifyAutoImport(state: AutoImportNotificationState, systemId: string): AutoImportNotificationState {
  if (!systemId || state.systems.includes(systemId)) return state
  return { systems: [...state.systems, systemId] }
}

/** `notificationExpire(projectId)`：该系统已经同步/已是最新，撤下它。 */
export function expireAutoImport(state: AutoImportNotificationState, systemId: string): AutoImportNotificationState {
  return state.systems.includes(systemId) ? { systems: state.systems.filter(id => id !== systemId) } : state
}

/** `notificationExpire()`（无参）：`HideProjectRefreshAction` 的动作 —— 整条通知收掉。 */
export function expireAllAutoImport(): AutoImportNotificationState {
  return emptyAutoImportState()
}

/** `isNotificationVisible()`（可按系统收窄，对应上游那个带 `systemId` 的重载 :41-44）。 */
export function autoImportVisible(state: AutoImportNotificationState, systemId?: string): boolean {
  if (!systemId) return state.systems.length > 0
  return state.systems.includes(systemId)
}

export interface AutoImportNoticePayload {
  message: string
  error: boolean
  detail: string[]
  displayId: string
  actions: NoticeAction[]
}

/**
 * 一组待同步系统 → 一条通知。`onSync`/`onHide` 的**状态副作用由调用方**负责：
 * 上游这两个动作分别走 `scheduleProjectRefresh` 与 `notificationExpire()`。
 */
export function autoImportNotice(
  systems: readonly string[],
  onSync: () => void,
  onHide: () => void,
  displayKey: string = systems[0] ?? '',
): AutoImportNoticePayload | null {
  if (!systems.length) return null
  const who = systems.join('、')
  return {
    message: `${who} 项目结构已更改`,
    error: false,
    // ExternalSystemBundle.properties: `{0} project structure has been changed.
    // Sync changes with {1} to make it work correctly.`
    detail: [`与 TaoCode 同步更改后才会生效。`],
    // displayId 按**系统 id**（不是显示名）：名字换成中文也还是同一条通知。
    displayId: autoImportDisplayId(displayKey),
    actions: [
      { label: AUTO_IMPORT_SYNC_LABEL, run: onSync },
      { label: AUTO_IMPORT_HIDE_LABEL, run: onHide },
    ],
  }
}

/** 注入的回调签名与 `NotificationsDeps.notify` 一致，宿主原样转发。 */
export type AutoImportNotify = (message: string, error?: boolean, onClick?: () => void, detail?: string[],
                                displayId?: string, actions?: NoticeAction[]) => void

export interface AutoImportNotifierDeps {
  notify: AutoImportNotify
  /** 显式重载（`ProjectRefreshAction.Manager.refreshProject` → `scheduleProjectRefresh`）。 */
  reload: () => void
}

/**
 * 通知宿主：状态自持，`invalidate` 负责「显示或刷新这一条」，`expire`/`reset` 负责撤下。
 * 与上游一样，通知的消失**只**由同步排上/项目回到最新/用户点隐藏驱动；
 * 项目一直待同步而文件不再变化时，通知就一直挂着（这正是它存在的意义）。
 */
export function createAutoImportNotifier(deps: AutoImportNotifierDeps) {
  let state = emptyAutoImportState()
  // 通知文案用 `ProjectSystemId.readableName`（上游 `naturalJoinSystemIds` 的口径），
  // 记账仍按 id —— 同一个系统的名字可能变，身份不会。
  const names = new Map<string, string>()
  const show = () => {
    const payload = autoImportNotice(state.systems.map(id => names.get(id) ?? id),
      () => { state = expireAllAutoImport(); deps.reload() },
      () => { state = expireAllAutoImport() },
      state.systems[0])
    if (payload) deps.notify(payload.message, payload.error, undefined, payload.detail, payload.displayId, payload.actions)
  }
  return {
    /** 当前可见的系统集合（测试与调试用）。 */
    systems: () => [...state.systems],
    visible: (systemId?: string) => autoImportVisible(state, systemId),
    /** `notificationNotify`：一个外部改动被记下、而自动重载没跑时调用。 */
    invalidate(systemId: string, displayName?: string) {
      if (displayName) names.set(systemId, displayName)
      const next = notifyAutoImport(state, systemId)
      const changed = next !== state
      state = next
      if (changed) show()
    },
    /** `notificationExpire(projectId)`：同步已排上或重载已完成时调用。 */
    expire(systemId: string) { state = expireAutoImport(state, systemId) },
    /** 换工作区：通知与状态一起清掉（上游随项目 dispose）。 */
    reset() { state = expireAllAutoImport() },
  }
}
