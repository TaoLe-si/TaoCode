// Code Vision 的**按 provider 开关与右键隐藏** ——
// 上游 `platform/lang-api/src/com/intellij/codeInsight/codeVision/settings/CodeVisionSettings.kt`
// ＋ `platform/lang-impl/src/com/intellij/codeInsight/codeVision/ui/model/ProjectCodeVisionModelImpl.kt`
// ＋ `.../ui/popup/CodeVisionContextPopup.kt` 这三处在本仓的等价物。
//
// 判决 `docs/inventory/verdict-platform_rest.md` 的 `lp/code-vision`：
// 「缺：按 provider 的开关与右键隐藏（`CodeVisionSettings`/`CodeVisionGroupSettingProvider`/
// `HIDE_PROVIDER_ID`/`HIDE_ALL` —— LSP 条目不带 provider id，无法定位到某个 provider）」；
// `ls/code-lens`：「缺……分组设置（`LspCodeVisionGroupSettingProvider` 的每组开关与顺序）」。
//
// 上游那句"LSP 条目不带 provider id"其实**不成立**，本模块就是把它推翻的取证：
//   · `platform/lsp-impl/src/impl/features/codeLens/LspCodeVisionProvider.kt:20`
//     `internal const val LSP_CODE_VISION_PROVIDER_ID: String = "LspCodeVisionProvider"`，
//     同文件 `:65` `override val id: String = LSP_CODE_VISION_PROVIDER_ID` —— 服务端 lens 全都挂
//     在**这一个** group id 上；
//   · `LspCodeVisionGroupSettingProvider.kt:7-9` 的 `groupId` 就是它，`:11` 的 `groupName` 取
//     `LspBundle` 的 `codeLens.LspCodeVisionProvider.name`（中文包：`LSP CodeLens`，
//     `localization-zh.jar messages/LspBundle.properties:6`）；
//   · 右键那两条动作的 id 是常量：`ProjectCodeVisionModelImpl.kt:26-27` 的 `"!Hide"` / `"!HideAll"`，
//     文案在 `CodeVisionContextPopup.kt:22-23`；
//   · 落地动作在 `ProjectCodeVisionModelImpl.kt:50-57`：**隐藏的是 groupId**（`:51` 先
//     `getProviderById(entry.providerId)?.groupId`，拿不到才退回 providerId），然后
//     `setProviderEnabled(id, false)`（`:52`，`CodeVisionSettings.kt:106`）并广播失效；
//   · 「全部隐藏」是把总闸 `codeVisionEnabled` 关掉（`:59`，`CodeVisionSettings.kt:55-60`）；
//   · 每行可见条数出厂 5（`CodeVisionSettings.kt:38-39`
//     `visibleMetricsAboveDeclarationCount / visibleMetricsNextToDeclarationCount = 5`）——
//     与 `src/codeLens.ts` 的 `CODE_LENS_VISIBLE_MAX` 同一个数，本模块只转出去供设置页用。
//
// 与上游的差异（如实，两条）：
//   1. **持久化没有落点**：上游这份是 `PersistentStateComponent`（应用级）。本仓的设置持久化要经过
//      `src/settingsModel.ts`（保留文件）与 `native/settings_schema.cpp`（桶 7 名下），
//      所以这里的真值是**会话内**的一份 reactive 表，并留出 `restoreCodeVisionSettings()` 这个入口，
//      接线请求落地时把磁盘那一份灌进来就行（见 `docs/wiring-requests-2026-10-06-bucket3.md` 的 S1）。
//      这不是假控件：勾了立刻生效、生效的是**渲染通道本身**（`codeLensExtension.ts` 过滤条目）。
//      订正留痕（2026-10-06 K-4，`docs/wiring-requests-2026-10-06-setkeys.md:73-105`）：**盘上那一侧已经就位** ——
//      四把键在 `src/settingsModel.ts:445-451`、出厂值与界在 `native/settings_schema.cpp:414-417` 与
//      `native/settings_editor_keys.hpp:56-62`（1..10 = 上游 `CodeVisionGlobalSettingsProvider.kt:43` 的
//      `spinner(1..10, 1)`）；渲染侧的四把键也都在读了（总闸/组闸 `codeLensExtension.ts` 的 `visible`，
//      每锚点条数 `codeVisionVisibleEntryLimit()`）。**只剩两个调用方**：启动读回
//      （`src/workspaceLifecycle.ts:147` 之后）与设置页 `syncRuntime()`
//      （`src/components/CodeVisionSettingsPage.vue:61-64`），都在别人名下 ⇒ 见
//      `docs/wiring-requests-2026-10-06-lensgate.md` 的 L-1/L-2/L-3。
//   2. 上游还有第三项「Lens Settings…」跳到设置页（`CodeVisionContextPopup.kt:24` 的
//      `CodeVisionHost.settingsLensProviderId`）。本仓没有 Code Vision 设置页（要新建页面 ＋
//      `src/settingsTreeMeta.ts` 的树节点，都是保留文件）⇒ **这一项不渲染**，
//      而不是放一个点了没反应的条目。
import { reactive } from 'vue'
import { CODE_LENS_VISIBLE_MAX } from './codeLens.ts'

/** `ProjectCodeVisionModelImpl.kt:26` —— 右键菜单里"隐藏这一个 provider"的动作 id。 */
export const CODE_VISION_HIDE_PROVIDER_ID = '!Hide'
/** `ProjectCodeVisionModelImpl.kt:27` —— "全部隐藏"。 */
export const CODE_VISION_HIDE_ALL_ID = '!HideAll'

/** 服务端 lens 那一个组（`LspCodeVisionProvider.kt:20`）。本仓所有 LSP 下发的条目都挂它。 */
export const LSP_CODE_VISION_GROUP_ID = 'LspCodeVisionProvider'
/** 本地 `problems` provider 的组（`src/codeVisionProviders.ts` 的那个 id）。 */
export const PROBLEMS_CODE_VISION_GROUP_ID = 'problems'

/** `LspBundle.properties:33` 的 `codeLens.LspCodeVisionProvider.name`（中文包同键：`LSP CodeLens`）。 */
export const LSP_CODE_VISION_GROUP_NAME = 'LSP CodeLens'
/** 本地 problems provider 的组名（本仓文案；上游这一族的内置 provider 名字来自各自的 EP `name`，本仓只有这一个内置）。 */
export const PROBLEMS_CODE_VISION_GROUP_NAME = '问题计数'

/** `CodeVisionContextPopup.kt:42` 的 `setMaxRowCount(15)`。 */
export const CODE_VISION_POPUP_MAX_ROWS = 15

/** 出厂可见条数（`CodeVisionSettings.kt:38-39` 的两个 5）。 */
export const CODE_VISION_VISIBLE_COUNT = CODE_LENS_VISIBLE_MAX

// 上游那份 `State`（`CodeVisionSettings.kt:35-53`）在本仓要的四项。
// 第四项 `visibleEntries` 对应 `:38-39` 的那两个 5（本仓的条目一律画在**上方**，
// 上游那两档 `visibleMetricsAboveDeclarationCount` / `visibleMetricsNextToDeclarationCount`
// 在本仓只剩一档，与设置页 `spinner(1..10, 1)`（`CodeVisionGlobalSettingsProvider.kt:43`）同一格）。
export interface CodeVisionSettingsState {
  /** `codeVisionEnabled`（`CodeVisionSettings.kt:55-60`）：总闸。 */
  enabled: boolean
  /** `disabledCodeVisionProviderIds`（`:45`）：出厂"没被默认关掉的那一组"才会出现在这里。 */
  disabledGroups: Record<string, boolean>
  /** `enabledCodeVisionProviderIds`（`:50`）：出厂关着、被用户单独打开的。 */
  enabledGroups: Record<string, boolean>
  /** 同一个锚点最多画几条（`:38-39` 出厂 5）；读法见 `codeVisionVisibleEntryLimit()`。 */
  visibleEntries: number
}

export const codeVisionSettings = reactive<CodeVisionSettingsState>({
  enabled: true,
  disabledGroups: {},
  enabledGroups: {},
  visibleEntries: CODE_VISION_VISIBLE_COUNT,
})

/**
 * `CodeVisionSettings.isProviderEnabled(id)`（`:96-101`）：先看禁用表、再看启用表，
 * 两边都没有就是"跟着出厂默认走"（本仓的出厂默认是开——上游那两个内置 provider 的
 * `defaultEnabled` 也都是开）。
 * **注意上游这条忽略总闸**（`:95` 的注释 `Ignores [State.isEnabled]`），所以这里也只看两组；
 * 总闸由 `isCodeVisionGloballyEnabled()` 单独判（渲染通道那一步两个都要过）。
 */
export function isCodeVisionGroupEnabled(groupId: string, settings: CodeVisionSettingsState = codeVisionSettings): boolean {
  if (settings.disabledGroups[groupId]) return false
  if (settings.enabledGroups[groupId]) return true
  return true
}

/** 总闸（`CodeVisionSettings.kt:55-56`）。 */
export function isCodeVisionGloballyEnabled(settings: CodeVisionSettingsState = codeVisionSettings): boolean {
  return settings.enabled
}

/**
 * `setProviderEnabled(id, false)`（`CodeVisionSettings.kt:106`）的等价物：
 * 上游那两个 TreeSet 只装"与出厂相反"的那一半（`:41-50` 的注释），所以这里同形态：
 * 出厂为开 ⇒ 关掉时进 `disabledGroups` 并把 `enabledGroups` 里那条删掉；打开时反过来。
 */
export function setCodeVisionGroupEnabled(groupId: string, enabled: boolean, settings: CodeVisionSettingsState = codeVisionSettings): void {
  if (enabled) { delete settings.disabledGroups[groupId]; settings.enabledGroups[groupId] = true }
  else { delete settings.enabledGroups[groupId]; settings.disabledGroups[groupId] = true }
}

/** 这一条该按哪个组收口：服务端 lens 全归 `LspCodeVisionProvider`，本地条目用自己的 id。 */
export function codeVisionGroupId(entry: { providerId?: string; command?: string } | undefined): string {
  if (!entry) return LSP_CODE_VISION_GROUP_ID
  if (entry.providerId) return entry.providerId
  // 渲染通道里没有 provider id 的条目就是服务端下发的那一批（`src/codeLens.ts` 的 `CodeLensItem`）。
  return LSP_CODE_VISION_GROUP_ID
}

/**
 * 一条 lens 现在该不该显示 —— 总闸 + 组闸（上游 `CodeVisionSettings` 的两层：
 * `codeVisionEnabled` 关掉时整族不画，`isProviderEnabled(groupId)` 关掉时只少那一组）。
 */
export function shouldShowCodeVisionEntry(
  groupId: string,
  settings: CodeVisionSettingsState = codeVisionSettings,
): boolean {
  return isCodeVisionGloballyEnabled(settings) && isCodeVisionGroupEnabled(groupId, settings)
}

// 第二层：同一个锚点最多画几条 —— 上游这一档不是常量，是**读设置的**。链路三步，逐条可查：
//   ① 出厂值 `CodeVisionSettings.kt:38` `var visibleMetricsAboveDeclarationCount: Int = 5`；
//   ② 取用 `CodeVisionSettings.kt:140-147` 的 `getAnchorLimit(position)`（Top 档读上面那个字段），
//      经 `CodeVisionHost.kt:287-288` 的
//      `viewService.setPerAnchorLimits(... associateWith { (lifeSettingModel.getAnchorLimit(it) ?: defaultVisibleLenses) })`
//      灌进 `ProjectCodeVisionModelImpl.kt:30` 的 `maxVisibleLensCount`；
//   ③ 生效 `CodeVisionListData.kt:45-57` 的 `updateVisible()`：`val count = projectModel.maxVisibleLensCount[anchor]`
//      → `val visibleCount = minOf(count, anchoredLens.size)` → `anchoredLens.subList(0, visibleCount)`。
//      ⇒ 截断规则 = **保留前缀、不改顺序**，超出的既不画也没有「更多…」（`editor.codeVision.more.inlay`
//      缺省 false，`CodeVisionListData.kt:60`；registry 缺省值见 `src/codeLens.ts:124-125` 的注）。
// 本仓的截断动作在 `src/codeLens.ts:165` 的 `items.slice(0, cap)`（同一形状：前缀、不改序），
// 这里只负责把设置表里那一个数**解析**出来，所以是个不碰 DOM、不碰 CodeMirror 的纯判定。
// 兜底口径（本仓的守卫，上游没有这一层：State 是直读的）：非正整数 ⇒ 回出厂 5。
// 取 5 的理由与 `src/codeLens.ts:150`（`groupAnchoredLenses` 的既有守卫，
// `tests/code-lens-grouping.test.mjs:52-59` 钉着）逐字相同，形状也与 ② 那句 `?: defaultVisibleLenses`
// （`CodeVisionHost.kt:85` 的 `const val defaultVisibleLenses: Int = 5`）一致。
// 界面上那一格的 1..10 是**输入约束**（`CodeVisionGlobalSettingsProvider.kt:43` 的 `spinner(1..10, 1)`），
// 不在读侧再夹一次：上游读侧（`getAnchorLimit`）也没夹，本仓也不发明这条。
export function codeVisionVisibleEntryLimit(settings: CodeVisionSettingsState = codeVisionSettings): number {
  return Number.isInteger(settings.visibleEntries) && settings.visibleEntries > 0
    ? settings.visibleEntries : CODE_VISION_VISIBLE_COUNT
}

/** 右键菜单的那几条（`CodeVisionContextPopup.kt:22-23`：先"隐藏这一组"、再"全部隐藏"）。 */
export interface CodeVisionContextAction {
  id: string
  /** 菜单文字（已把 `{0}` 换成组名）。 */
  label: string
}

/**
 * `action.hide.this.metric.text` / `action.hide.all.text` 两条（中文包逐字：
 * 「隐藏 `Code Vision: {0}` 嵌入提示」/「隐藏所有 `Code Vision` 嵌入提示」，
 * `localization-zh.jar messages/CodeVisionBundle.properties:13-14`）。
 * 顺序照上游：先这一组、再全部。
 */
export function codeVisionContextActions(groupName: string): CodeVisionContextAction[] {
  return [
    { id: CODE_VISION_HIDE_PROVIDER_ID, label: `隐藏 \`Code Vision: ${groupName}\` 嵌入提示` },
    { id: CODE_VISION_HIDE_ALL_ID, label: '隐藏所有 `Code Vision` 嵌入提示' },
  ]
}

/** 组名（`getProviderById(...)?.name`，拿不到就退回 id 本身，与上游 `:51` 的 `?: entry.providerId` 同调）。 */
export function codeVisionGroupName(groupId: string): string {
  if (groupId === LSP_CODE_VISION_GROUP_ID) return LSP_CODE_VISION_GROUP_NAME
  if (groupId === PROBLEMS_CODE_VISION_GROUP_ID) return PROBLEMS_CODE_VISION_GROUP_NAME
  return groupId
}

/**
 * `handleLensExtraAction`（`ProjectCodeVisionModelImpl.kt:49-66`）的等价物：
 * `!Hide` → 关这一**组**（注意是 groupId 而不是 providerId，`:51`）；
 * `!HideAll` → 关总闸（`:59`）。其余动作 id 本仓没有（上游那几条来自
 * `CodeVisionEntry.extraActions`，服务端 lens 不带），一律返回 false 让调用方如实处理。
 * 返回 true 表示"这条已经被这份设置表消化了"。
 */
export function handleCodeVisionExtraAction(
  actionId: string,
  groupId: string,
  settings: CodeVisionSettingsState = codeVisionSettings,
): boolean {
  if (actionId === CODE_VISION_HIDE_PROVIDER_ID) { setCodeVisionGroupEnabled(groupId, false, settings); return true }
  if (actionId === CODE_VISION_HIDE_ALL_ID) { settings.enabled = false; return true }
  return false
}

/** 把一份磁盘上的设置灌回运行时真值（接线请求 S1 落地时由宿主编排调用）。
 *  `codeVisionVisibleEntries`（每锚点条数上限）走的是同一条入口：坏值（非整数、0、负数）一律不写，
 *  表里留出厂 5 —— 与 `codeVisionVisibleEntryLimit()` 的兜底同一口径，旧存档缺这一键时也走这里。 */
export function restoreCodeVisionSettings(patch: {
  codeVisionEnabled?: boolean; disabledGroups?: readonly string[]; enabledGroups?: readonly string[]; codeVisionVisibleEntries?: number
} | null | undefined): void {
  if (!patch) return
  if (typeof patch.codeVisionEnabled === 'boolean') codeVisionSettings.enabled = patch.codeVisionEnabled
  for (const id of patch.disabledGroups ?? []) codeVisionSettings.disabledGroups[id] = true
  for (const id of patch.enabledGroups ?? []) codeVisionSettings.enabledGroups[id] = true
  const entries = patch.codeVisionVisibleEntries
  if (entries !== undefined && Number.isInteger(entries) && entries > 0) codeVisionSettings.visibleEntries = entries
}

/** 导出当前这份表（宿主持久化用；与 `restoreCodeVisionSettings` 成对）。 */
export function codeVisionSettingsPatch(): { codeVisionEnabled: boolean; disabledGroups: string[]; enabledGroups: string[]; codeVisionVisibleEntries: number } {
  return {
    codeVisionEnabled: codeVisionSettings.enabled,
    disabledGroups: Object.keys(codeVisionSettings.disabledGroups).filter(id => codeVisionSettings.disabledGroups[id]),
    enabledGroups: Object.keys(codeVisionSettings.enabledGroups).filter(id => codeVisionSettings.enabledGroups[id]),
    codeVisionVisibleEntries: codeVisionSettings.visibleEntries,
  }
}
