// 「更新方式」的**工程级设置存储** —— 上游 `GitVcsSettings`（State = `GitVcsOptions`）。
// 纯逻辑，零 Vue、零 DOM。
//
// ── 作用域：**workspace 级（工程级），不是应用级** ───────────────────────────────────
// `GitVcsSettings.java:40` 的 `@State(name = GitVcsSettings.SETTINGS_KEY,
// storages = @Storage(StoragePathMacros.WORKSPACE_FILE))`，`SETTINGS_KEY = "Git.Settings"`
// （`:43`）。`WORKSPACE_FILE` = 工程的 `workspace.xml`，所以**每个工程各存一份**。
// 本仓的等价物是 `localStorage` 按工作区根分键（与 `src/vcsLogFilterStore.ts` 的
// `taocode.vcs.log.<root>.*`、`src/changesViewSettings.ts` 的 `taocode.vcs.changesView.<root>`
// 同一口径）—— 它们承接的都是上游那个 `WORKSPACE_FILE`。
//
// ── 本文件管哪几项 ────────────────────────────────────────────────────────────
// 「更新方式」这件事上游其实摊在**两个** State 里，本文件两个都收（同一份工程级存档）：
//
//  1) `GitVcsSettings` / `GitVcsOptions`（`GitVcsOptions.kt`）：
//     · `updateMethod`（`:28-30`，`@OptionTag("UPDATE_TYPE")`，缺省 `UpdateMethod.MERGE`）
//     · `saveChangesPolicy`（`:24-26`，`@OptionTag("SAVE_CHANGES_POLICY")`，
//       缺省 `GitSaveChangesPolicy.SHELVE`）—— 它**不在**更新选项对话框里，
//       在设置页「更新」组（`GitVcsPanel.kt:293-299`）。
//  2) `ProjectLevelVcsManager` / `OptionsAndConfirmations`（`OptionsAndConfirmationsHolder.java:16`，
//     同样 `WORKSPACE_FILE`）：选项对话框上那个「不再显示」= `StandardOption.UPDATE`
//     （`UpdateOptionsDialog.kt:31-37` 读/写它；id 是 `"Update"`，`VcsConfiguration.java:89`），
//     缺省**真**（`OptionsAndConfirmations.java:77-81` 没存过值时 `return true`），
//     且**只在为假时才落盘**（`ProjectLevelVcsManagerSerialization.java:41` 的 `if (!value)`）。
//
// ── 存档口径 ────────────────────────────────────────────────────────────────
// 照上游「**只写非缺省值**」：`BaseState` 的存储属性跳过等于缺省的值
// （`BaseState.kt:159-166` 的 `isEqualToDefault`），上面那个 `if (!value)` 同理。
// 所以缺省的三项都不进存档，读回缺省即上游缺省；坏存档一律退回缺省，**永不抛**
// （与 `vcsLogFilterStore.parseLogQuery` / `changesViewSettings.parseChangesViewSettings` 同一纪律）。
//
// 选项页/对话框的**控件与文案**由模型层 `src/vcsUpdateOptions.ts` 持有（档位、单选顺序、
// 对话框形状、动作名）。本文件只补它没有的：设置页「更新」组那一行的**控件形状**
// （两个 `buttonsGroup` + 单选）与**行标签**，以及这份存档本身。

import type { SaveChangesPolicyId, UpdateMethodId } from './vcsUpdateOptions.ts'
import {
  DEFAULT_SAVE_CHANGES_POLICY, DEFAULT_UPDATE_METHOD, SAVE_CHANGES_POLICIES,
  UPDATE_METHOD_TIERS, updateOptionsDialogShown, updateMethodTier,
} from './vcsUpdateOptions.ts'

/** 上游 `GitVcsSettings.SETTINGS_KEY`（`GitVcsSettings.java:43`）= "Git.Settings"。 */
export const GIT_SETTINGS_STATE_NAME = 'Git.Settings'

/** `GitVcsOptions.kt:28` 的 `@OptionTag("UPDATE_TYPE")` —— 更新方式在存档里的键名。 */
export const UPDATE_METHOD_OPTION_TAG = 'UPDATE_TYPE'

/** `GitVcsOptions.kt:25` 的 `@OptionTag("SAVE_CHANGES_POLICY")`。 */
export const SAVE_CHANGES_POLICY_OPTION_TAG = 'SAVE_CHANGES_POLICY'

/**
 * 「不再显示」那一项在存档里的键名。上游 `VcsConfiguration.StandardOption.UPDATE` 的 id 是
 * `"Update"`（`VcsConfiguration.java:89`），由 `ProjectLevelVcsManagerSerialization.java:42-46`
 * 写成 `<OptionsSetting id="Update" value="false"/>`，挂在 `OptionsAndConfirmationsHolder`
 * （`OptionsAndConfirmationsHolder.java:16`，`WORKSPACE_FILE`）。
 */
export const SHOW_UPDATE_OPTIONS_OPTION_TAG = 'Update'

/** 设置页「更新」组标题 `settings.update.group.title`（en GitBundle.properties:802 / zh :1503）= 更新。 */
export const UPDATE_SETTINGS_GROUP_TITLE = '更新'

/** 设置页「更新方式」行标签 `settings.update.method`（en :809 / zh :1504）= 更新方法:。 */
export const UPDATE_METHOD_ROW_LABEL = '更新方法:'

/** 设置页「清理工作树」行标签 `settings.clean.working.tree`（en :819 / zh :1448）= 使用以下方法清理工作树:。 */
export const CLEAN_WORKING_TREE_ROW_LABEL = '使用以下方法清理工作树:'

/**
 * 「更新方式」这份工程级设置的三项。
 * 前两项照 `GitVcsOptions.kt`，第三项照 `OptionsAndConfirmations` 的 `StandardOption.UPDATE`。
 */
export interface GitUpdateSettings {
  /** 更新方式；缺省 `MERGE`（`GitVcsOptions.kt:30`）。`BRANCH_DEFAULT` 也是合法存档值。 */
  updateMethod: UpdateMethodId
  /** 清理工作树的策略；缺省 `SHELVE`（`GitVcsOptions.kt:26`）。 */
  saveChangesPolicy: SaveChangesPolicyId
  /** 「更新项目」是否还弹选项对话框；缺省 **true**（`OptionsAndConfirmations.java:80`）。 */
  showUpdateOptions: boolean
}

/** 缺省设置，逐条指到上游（见各字段注释）。 */
export function defaultGitUpdateSettings(): GitUpdateSettings {
  return {
    updateMethod: DEFAULT_UPDATE_METHOD,
    saveChangesPolicy: DEFAULT_SAVE_CHANGES_POLICY,
    showUpdateOptions: true,
  }
}

/**
 * 存档键：按工作区根分（对应上游 `WORKSPACE_FILE`，都是「跟着工程走」，不是应用级）。
 * 命名与 `vcsLogFilterStore.logFilterStorageKey` 同一套 `taocode.vcs.*.<root>` 口径。
 */
export function gitUpdateSettingsKey(workspaceRoot: string): string {
  return `taocode.vcs.gitUpdate.${encodeURIComponent(workspaceRoot)}`
}

/** 合法更新方式集合 = `UpdateMethod.java:12-30` 那四档（含 `BRANCH_DEFAULT`）。 */
function isUpdateMethodId(value: unknown): value is UpdateMethodId {
  return typeof value === 'string' && UPDATE_METHOD_TIERS.some(tier => tier.id === value)
}

/** 合法清理策略集合 = `GitSaveChangesPolicy.java:9-21` 那两档。 */
function isSaveChangesPolicyId(value: unknown): value is SaveChangesPolicyId {
  return typeof value === 'string' && SAVE_CHANGES_POLICIES.some(tier => tier.id === value)
}

/**
 * 两档更新方式**短名**在 zh 包里的行号（`localization-zh.jar:messages/GitBundle.properties`）：
 * 合并 :1478、变基 :1480。模型层 `UpdateMethodTier.zhLine` 记的是**说明句**那一行
 * （1479/1481 的 `*.description`），设置页单选要的是短名，所以单列一张小表。
 */
const SHORT_NAME_ZH_LINES: Readonly<Partial<Record<UpdateMethodId, number>>> = {
  MERGE: 1478,
  REBASE: 1480,
}

/**
 * 把一个裸字符串归一成更新方式；认不出（含 `null`）回缺省 `MERGE`。
 * 上游反序列化用的是枚举名（`GitVcsOptions.kt:30` 的 `by enum(...)`），
 * 认不出的名字在 `BaseState` 里退化成缺省，所以这里也**不抛**。
 */
export function normalizeUpdateMethod(value: unknown): UpdateMethodId {
  return isUpdateMethodId(value) ? value : DEFAULT_UPDATE_METHOD
}

/** 同上，清理策略；认不出回缺省 `SHELVE`（`GitVcsOptions.kt:26`）。 */
export function normalizeSaveChangesPolicy(value: unknown): SaveChangesPolicyId {
  return isSaveChangesPolicyId(value) ? value : DEFAULT_SAVE_CHANGES_POLICY
}

/**
 * 稳定序列化：**只写非缺省值**（上游 `BaseState.kt:159-166` 跳过缺省 + 
 * `ProjectLevelVcsManagerSerialization.java:41` 的 `if (!value)`）。全是缺省时写空串，
 * 不在存档里留空壳（与 `changesViewSettings.serializeChangesViewSettings` 一致）。
 * 键名用上游 `@OptionTag` 的名字（`UPDATE_TYPE` / `SAVE_CHANGES_POLICY`），
 * 第三项用 `StandardOption.UPDATE` 的 id `Update`。
 */
export function serializeGitUpdateSettings(settings: GitUpdateSettings): string {
  const stored: Record<string, unknown> = {}
  if (settings.updateMethod !== DEFAULT_UPDATE_METHOD) stored[UPDATE_METHOD_OPTION_TAG] = settings.updateMethod
  if (settings.saveChangesPolicy !== DEFAULT_SAVE_CHANGES_POLICY) stored[SAVE_CHANGES_POLICY_OPTION_TAG] = settings.saveChangesPolicy
  // 「不再显示」只在为假时才写（上游那行 `if (!value)`），缺省真不进存档。
  if (settings.showUpdateOptions !== true) stored[SHOW_UPDATE_OPTIONS_OPTION_TAG] = false
  return Object.keys(stored).length ? JSON.stringify(stored) : ''
}

/**
 * 从存档读回；坏存档（非 JSON / 非对象 / 字段认不出）**逐字段**退回缺省，永不抛。
 * 三个键都按上游 `@OptionTag` 名收；同时兼容驼峰拼写（本仓既有存档习惯）。
 */
export function parseGitUpdateSettings(raw: string | null | undefined): GitUpdateSettings {
  const defaults = defaultGitUpdateSettings()
  if (!raw) return defaults
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return defaults }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults
  const source = parsed as Record<string, unknown>
  const method = source[UPDATE_METHOD_OPTION_TAG] ?? source.updateMethod
  const policy = source[SAVE_CHANGES_POLICY_OPTION_TAG] ?? source.saveChangesPolicy
  const show = source[SHOW_UPDATE_OPTIONS_OPTION_TAG] ?? source.showUpdateOptions
  return {
    updateMethod: normalizeUpdateMethod(method),
    saveChangesPolicy: normalizeSaveChangesPolicy(policy),
    // 只有显式假才算关（上游缺省真，且只写假值）。
    showUpdateOptions: show === false ? false : true,
  }
}

/** localStorage 的最小面（单测传内存实现，不依赖 window）。 */
export interface GitUpdateSettingsStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 读某个工作区的设置。存储缺失 / `getItem` 抛 / 坏存档 ⇒ 缺省，永不抛。 */
export function readGitUpdateSettings(
  store: GitUpdateSettingsStore | null | undefined,
  workspaceRoot: string,
): GitUpdateSettings {
  let raw: string | null = null
  try { raw = store?.getItem(gitUpdateSettingsKey(workspaceRoot)) ?? null } catch { raw = null }
  return parseGitUpdateSettings(raw)
}

/** 落盘；返回有没有真的写进去（配额满 / 隐私模式静默降级成会话内状态）。 */
export function writeGitUpdateSettings(
  store: GitUpdateSettingsStore | null | undefined,
  workspaceRoot: string,
  settings: GitUpdateSettings,
): boolean {
  if (!store) return false
  try {
    store.setItem(gitUpdateSettingsKey(workspaceRoot), serializeGitUpdateSettings(settings))
    return true
  } catch {
    return false
  }
}

/**
 * 这次「更新项目」要不要先弹选项对话框 —— 把存档里的 `showUpdateOptions` 喂给模型层的
 * `updateOptionsDialogShown`（`VcsUpdateProcess.kt:42` + `AbstractCommonUpdateAction.kt:37`：
 * 开关为真，**或按住 Shift**）。上游读的正是同一份 `StandardOption.UPDATE` 存档。
 */
export function shouldShowUpdateOptions(settings: GitUpdateSettings, shiftPressed = false): boolean {
  return updateOptionsDialogShown(settings.showUpdateOptions, shiftPressed)
}

/** 设置页「更新方式」一行里的一格单选。 */
export interface UpdateSettingsRadioRow {
  id: UpdateMethodId
  /** 单选标签 = `methodName`（`GitVcsPanel.kt:289`），即**短名**（`settings.git.update.method.merge`）。 */
  title: string
  /** 短名的 zh 行号（`localization-zh.jar:messages/GitBundle.properties`）。 */
  zhLine: number | null
  checked: boolean
}

/**
 * 设置页「更新方式」那一行的控件 = `GitVcsPanel.kt:286-292`：一个 `buttonsGroup` 里
 * 逐个 `radioButton(saveSetting.methodName, saveSetting)`（`:288-289`），
 * 成员与顺序 = `getUpdateMethods()`（`GitUpdateOptionsPanel.kt:45`）= MERGE、REBASE。
 * ⚠️ 标签用的是**短名**（`getMethodName()`），**不是**选项对话框那句 `presentation` 说明句
 * —— 对话框在 `GitUpdateOptionsPanel.kt:32` 用 `presentation`，两处不是同一份文案。
 */
export function updateSettingsRadioRows(current: UpdateMethodId): UpdateSettingsRadioRow[] {
  // 设置页单选只有 MERGE/REBASE（`inSettingsRadio` 为真者），顺序同 `getUpdateMethods()`。
  return UPDATE_METHOD_TIERS.filter(tier => tier.inSettingsRadio).map(tier => ({
    id: tier.id,
    title: tier.name,
    // 短名的 zh 行号：合并 :1478、变基 :1480。模型层 `zhLine` 指的是**说明句**那一行
    // （1479/1481，`*.description`），设置页用的是短名，所以这里给短名自己的行号。
    zhLine: SHORT_NAME_ZH_LINES[tier.id] ?? null,
    checked: current === tier.id,
  }))
}

/** 设置页「清理工作树」一行里的一格单选。 */
export interface SaveChangesPolicyRadioRow {
  id: SaveChangesPolicyId
  /** 标签 = `saveSetting.text`（`GitVcsPanel.kt:296`）= `GitSaveChangesPolicy.getText()`。 */
  title: string
  zhLine: number
  checked: boolean
}

/**
 * 设置页「清理工作树」那一行 = `GitVcsPanel.kt:293-299`：另一个 `buttonsGroup` 里
 * `GitSaveChangesPolicy.entries.forEach { radioButton(saveSetting.text, saveSetting) }`
 * （`:295-296`）。枚举声明顺序是 STASH 在前、SHELVE 在后（`GitSaveChangesPolicy.java:10,16`），
 * `entries` 就是声明序。
 */
export function saveChangesPolicyRadioRows(current: SaveChangesPolicyId): SaveChangesPolicyRadioRow[] {
  return SAVE_CHANGES_POLICIES.map(tier => ({
    id: tier.id,
    title: tier.text,
    zhLine: tier.zhLine,
    checked: current === tier.id,
  }))
}

/** 设置页「更新」组的两行模型（行标签 + 该行的单选）。 */
export interface UpdateSettingsGroupModel {
  title: string
  methodRow: { label: string; rows: UpdateSettingsRadioRow[] }
  cleanWorkingTreeRow: { label: string; rows: SaveChangesPolicyRadioRow[] }
}

/**
 * 设置页「更新」组的完整形状（`GitVcsPanel.kt:285-299`）：
 * `group(message("settings.update.group.title"))`（`:285`）下先一行
 * `row(message("settings.update.method"))` 的 buttonsGroup（`:287-292`），
 * 再一行 `row(message("settings.clean.working.tree"))` 的 buttonsGroup（`:294-299`）。
 * 两组都 `.layout(RowLayout.INDEPENDENT)`（`:291`、`:298`）。
 */
export function updateSettingsGroupModel(settings: GitUpdateSettings): UpdateSettingsGroupModel {
  return {
    title: UPDATE_SETTINGS_GROUP_TITLE,
    methodRow: { label: UPDATE_METHOD_ROW_LABEL, rows: updateSettingsRadioRows(settings.updateMethod) },
    cleanWorkingTreeRow: {
      label: CLEAN_WORKING_TREE_ROW_LABEL,
      rows: saveChangesPolicyRadioRows(settings.saveChangesPolicy),
    },
  }
}

/**
 * 更新方式档位的语义名（供设置页/对话框的 `aria-label` 兜底用）——
 * 直接取模型层那一档的 `name`，不另抄一份表。
 */
export function updateMethodTitle(id: UpdateMethodId): string {
  return updateMethodTier(id).name
}