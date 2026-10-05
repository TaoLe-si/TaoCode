// 「哪些应用级设置随机器走、哪些随设置同步」—— 上游 `GeneralLocalSettings` 的等价物（**规则侧**）。
//
// 上游坐标：`platform/ide-core/src/com/intellij/ide/GeneralLocalSettings.kt`
//   · 存储：`@State(name = "GeneralLocalSettings", storages = [Storage(value = "ide.general.local.xml",
//     roamingType = RoamingType.DISABLED)])`（`:17-18`）—— **DISABLED 就是「不漫游」**：
//     这份只跟着这台机器走，不进设置同步、不进导出归档。
//   · 状态只有三个键（`GeneralLocalState` `:79-83`），逐条抄：
//       `defaultProjectDirectory: String? = ""`（`:80`）
//       `useDefaultBrowser: Boolean = true`（`:81`，**默认 true**）
//       `browserPath: String? = null`（`:82`，null 时回落成按平台的默认路径，getter `:66-70`）
//   · 按平台回落 `getDefaultAlternativeBrowserPath()`（`:28-35`）：Windows
//     `C:\Program Files\Internet Explorer\IExplore.exe`、macOS `open`、Unix `/usr/bin/firefox`、其余 `""`。
//   · 老版本迁移 `migrateFromGeneralSettings()`（`:42-58`）把三个键从 `GeneralSettings` 搬过来，
//     搬完把源置空（`:55-57`），并用 `migrated.non.roamable.values.from.general.settings`
//     这个属性标记只搬一次（`:21`、`:44-48`）。
//
// **本仓现状与卡点（如实登记，不要当成已接上）**：本仓只有**一份**应用级 JSON
// （`generalSettings`，白名单在 `native/settings_schema.cpp`），没有「本机级」这一层存储。
// 真正把三个键拆出去要同时动三处，都不在本 lane 的文件所有权内：
//   1. `native/settings_schema.cpp` —— 新增一份「本机级」键表与落盘（键白名单在那里）；
//   2. `src/settingsModel.ts` —— `GeneralSettingsState` 要去掉这三个键（接线批独占）；
//   3. `src/settingsTransfer.ts` + `native/settings_transfer.cpp` —— 导出归档必须**排除**本机级键
//      （`RoamingType.DISABLED` 的语义就是「不随设置同步走」，导出同理）。
// 所以本模块只出**分类与默认值**这两件纯规则，供上面三处接线时直接用；它**没有生产消费方**。
import type { HostOs } from './browsers.ts'

/** `GeneralLocalState`（`GeneralLocalSettings.kt:79-83`）的三个键，一个不多一个不少。 */
export const GENERAL_LOCAL_SETTING_KEYS = ['defaultProjectDirectory', 'useDefaultBrowser', 'browserPath'] as const

export type GeneralLocalSettingKey = typeof GENERAL_LOCAL_SETTING_KEYS[number]

/** 这一个键是不是「本机级」（`roamingType = RoamingType.DISABLED`，`GeneralLocalSettings.kt:18`）。 */
export function isMachineLocalGeneralKey(key: string): key is GeneralLocalSettingKey {
  return (GENERAL_LOCAL_SETTING_KEYS as readonly string[]).includes(key)
}

/** `getDefaultAlternativeBrowserPath()`（`:28-35`）：`browserPath` 为 null 时的按平台回落。 */
export function defaultAlternativeBrowserPath(os: HostOs): string {
  if (os === 'windows') return 'C:\\Program Files\\Internet Explorer\\IExplore.exe'
  if (os === 'mac') return 'open'
  return '/usr/bin/firefox'
}

/** `GeneralLocalSettings.browserPath` 的 getter（`:66-70`）：`state.browserPath ?: getDefaultAlternativeBrowserPath()`。 */
export function resolveBrowserPath(stored: string | null | undefined, os: HostOs): string {
  const value = (stored ?? '').trim()
  return value ? value : defaultAlternativeBrowserPath(os)
}

export interface GeneralLocalState {
  defaultProjectDirectory: string
  useDefaultBrowser: boolean
  browserPath: string | null
}

/** `GeneralLocalState()`（`:79-83`）的默认值，逐条对齐（`useDefaultBrowser` 默认 **true**，`:81`）。 */
export function defaultGeneralLocalState(): GeneralLocalState {
  return { defaultProjectDirectory: '', useDefaultBrowser: true, browserPath: null }
}

/**
 * 把一份扁平的应用级设置按「本机级 / 可漫游」拆开 —— 导出归档与设置同步都只带走**可漫游**那一半。
 * 键名不认识就归到可漫游一侧（宁可多带走，也不要静默丢用户的设置）。
 */
export function splitGeneralSettingsByRoaming(
  general: Readonly<Record<string, unknown>>,
): { roaming: Record<string, unknown>; machineLocal: Partial<GeneralLocalState> } {
  const roaming: Record<string, unknown> = {}
  const machineLocal: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(general)) {
    if (isMachineLocalGeneralKey(key)) machineLocal[key] = value
    else roaming[key] = value
  }
  return {
    roaming,
    machineLocal: {
      defaultProjectDirectory: typeof machineLocal.defaultProjectDirectory === 'string' ? machineLocal.defaultProjectDirectory : '',
      useDefaultBrowser: machineLocal.useDefaultBrowser !== false,
      browserPath: typeof machineLocal.browserPath === 'string' ? machineLocal.browserPath : null,
    },
  }
}
