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
