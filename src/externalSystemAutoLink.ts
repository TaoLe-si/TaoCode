// 「自动链接未链接的构建工程」这个**项目级开关**的存储（上游
// `platform/external-system-api/src/com/intellij/openapi/externalSystem/autolink/
// ExternalSystemUnlinkedProjectSettings.kt:6-14` 的 `isEnabledAutoLink`；实现是
// `platform/external-system-impl/src/com/intellij/openapi/externalSystem/autolink/
// UnlinkedProjectSettings.kt:9-23`：`@State(name="UnlinkedProjectSettings")` + `State { isEnabledAutoLink
// by property(true) }`，即**默认 true、项目级持久**；唯一消费者是
// `UnlinkedProjectStartupActivity.kt:51-54` 的 `isEnabledAutoLink(project)`，
// 它门控 `loadProjectIfSingleUnlinkedProjectFound` 的自动链接（`:79-84`）。
//
// 上游**没有**设置页（该 EP 只被启动活动读，没有 Configurable 注册它），所以本模块也**不画控件** ——
// 只把状态面补上，让 `src/gradleHost.ts` 的自动链接门控从常量 `AUTO_LINK_DEFAULT` 换成持久值。
// 存储沿用本仓外部系统域的既有口径：`localStorage`（与任务激活表、视图开关同族），键按工作区根分。
import { AUTO_LINK_DEFAULT } from './externalSystemAutoImport.ts'
import type { ExternalProjectStore } from './externalProjectModel.ts'

const normalize = (path: string) => (path ?? '').replace(/\\/g, '/')

export function autoLinkSettingsKey(workspaceRoot: string): string {
  return `taocode.externalSystem.autoLink.${normalize(workspaceRoot)}`
}

/** 读这个项目的自动链接开关；没存过 = 上游默认值（true）。脏值按默认值处理，永不抛。 */
export function isAutoLinkEnabled(store: ExternalProjectStore | null, workspaceRoot: string): boolean {
  if (!store || !workspaceRoot) return AUTO_LINK_DEFAULT
  try {
    const raw = store.getItem(autoLinkSettingsKey(workspaceRoot))
    if (raw === null) return AUTO_LINK_DEFAULT
    const parsed = JSON.parse(raw) as { enabledAutoLink?: unknown }
    return typeof parsed?.enabledAutoLink === 'boolean' ? parsed.enabledAutoLink : AUTO_LINK_DEFAULT
  } catch {
    return AUTO_LINK_DEFAULT
  }
}

/** 写回；空表不落盘（顺手清旧键），存储不可用返回 false。 */
export function setAutoLinkEnabled(store: ExternalProjectStore | null, workspaceRoot: string, enabled: boolean): boolean {
  if (!store || !workspaceRoot) return false
  try {
    if (enabled === AUTO_LINK_DEFAULT && store.removeItem) { store.removeItem(autoLinkSettingsKey(workspaceRoot)); return true }
    store.setItem(autoLinkSettingsKey(workspaceRoot), JSON.stringify({ enabledAutoLink: enabled }))
    return true
  } catch {
    return false
  }
}

// ── 「跳过」这张未链接工程通知的记账 ────────────────────────────────────────────────
// 上游本体：`platform/external-system-impl/src/com/intellij/openapi/externalSystem/autolink/
// UnlinkedProjectNotificationAware.kt:33-38`（`@State(name = "UnlinkedProjectNotification",
// storages = [Storage(StoragePathMacros.PRODUCT_WORKSPACE_FILE)])` = **项目级**持久 +
// `disabledNotifications` 那个并发集合）、`:42-50`（集合里有这个系统 id 就**不再弹**）、
// `:65`（「Skip」那个动作 = `createSimpleExpiring(textProvider.getUPNSkipActionText()) { disableNotification(projectId) }`）。
// 本仓的等价物按工作区根存 localStorage（与 `autoLinkSettingsKey` 同一条先例：宿主 `file.write` 只写工作区内路径）。
// **缺键 = 没跳过过**（默认值 false，不按字段数判损坏）。

export function unlinkedNoticeSkipKey(workspaceRoot: string): string {
  return `taocode.externalSystem.unlinkedNoticeSkipped.${normalize(workspaceRoot)}`
}

/** 用户在这个项目里点过「跳过」吗？没存过 = 没跳过过。脏值按「没跳过」处理，永不抛。 */
export function isUnlinkedNoticeSkipped(store: ExternalProjectStore | null, workspaceRoot: string): boolean {
  if (!store || !workspaceRoot) return false
  try {
    const raw = store.getItem(unlinkedNoticeSkipKey(workspaceRoot))
    if (raw === null) return false
    const parsed = JSON.parse(raw) as { skipped?: unknown }
    return parsed?.skipped === true
  } catch {
    return false
  }
}

/** 记下「跳过」；存储不可用返回 false（通知这次点不动，下次打开还会再弹 —— 不假装记住）。 */
export function skipUnlinkedNotice(store: ExternalProjectStore | null, workspaceRoot: string): boolean {
  if (!store || !workspaceRoot) return false
  try {
    store.setItem(unlinkedNoticeSkipKey(workspaceRoot), JSON.stringify({ skipped: true }))
    return true
  } catch {
    return false
  }
}
