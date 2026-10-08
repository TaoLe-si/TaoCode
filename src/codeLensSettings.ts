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
//      每锚点条数 `codeVisionVisibleEntryLimit()`）。**只接上了"读回"这一个方向**
//      （这一串注释原来写"只剩一个调用方"，被后面的批次逐条推翻并按磁盘现状重写成"两个都接上"；
//      订正留痕（2026-10-06 hlcache300）：**"两个都已经接上"这句过头**，反向那一条至今零生产调用方，
//      按磁盘现状收回）：
//      · 启动读回（L-1）：`restoreCodeVisionSettings(...)` 的生产调用点只有 `src/workspaceLifecycle.ts:227`
//        一处（原写 `:224` —— 实开那一行是"旧存档缺键由原生侧补默认"那句注释，调用在 `:227`）；
//      · 设置页 `syncRuntime()`：`src/components/CodeVisionSettingsPage.vue:69-78` 四把键全刷
//        （L-3 由 2026-10-06 codelens2 落地，同批把 `GROUPS` 从两组换成 `CODE_VISION_GROUP_IDS` 四组）——
//        注意它**不是** `restoreCodeVisionSettings` 的调用方，是直接写那张运行时表；
//      · **反向 API 零生产调用方**：存盘出口 `codeVisionSettingsPatch()`（本文件 `:286`）只有
//        `tests/code-lens-grouping.test.mjs`、`tests/code-vision-anchor-limit.test.mjs` 在用；
//        `src/components/CodeVisionSettingsPage.vue:21` 与 `src/settingsModel.ts:484` 两处注释都写成它"存盘"，
//        磁盘上并没有那根线 ⇒ 就是下面 L-4（`docs/wiring-requests-2026-10-06-lensgate.md:127-134` 登记、未接）。
//      **仍未接**的还有 L-2（保存回包后重灌，`src/settingsPersistence.ts` 在别人名下）⇒
//      见同一份 `docs/wiring-requests-2026-10-06-lensgate.md`。
//      订正留痕（2026-10-06 codelens3）：读回那一步原来是**只加不删**（往旧表里追加），切工程时
//      上一个工程关掉的组再也打不开，而设置页按盘上那份显示成"勾着" ⇒ 现在按上游
//      `CodeVisionSettings.kt:164-166`（`loadState` 换掉整个 `State`）整份替换，见
//      `restoreCodeVisionSettings` 的注释与 `tests/code-lens-grouping.test.mjs` 的「从盘上读回」两条。
//   2. 上游还有第三项「`&Configure…`」跳到设置页（`CodeVisionContextPopup.kt:24` 的
//      `CodeVisionHost.settingsLensProviderId`，那一行的文案键是
//      `LensListPopup.tooltip.settings`，原文 `CodeVisionBundle.properties:10` = `&Configure…`）。
//      **订正留痕（2026-10-06 codelens3）**：这里（以及 `src/codeLensExtension.ts` 的同一段）原来写的
//      「Lens Settings…」不是上游文案 —— 上游同一个文件另有 `LensListPopup.tooltip.settings.settings`
//      = `"&Settings`（`CodeVisionBundle.properties:11`，被 `CodeVisionListPopup.kt:23` 当 tooltip 用，
//      不是这一行菜单），照它起名等于编造文案，故按逐字读到的原文改回 `&Configure…`。
//      **订正留痕（2026-10-06 codelens2）**：原写「本仓没有
//      Code Vision 设置页」已经不成立 —— 页在 `src/components/CodeVisionSettingsPage.vue`，
//      挂在 `src/components/SettingsDialog.vue:808` 的 `code.vision` 那一节。这一项今天仍**不渲染**，
//      理由换了：渲染通道（`src/codeLensExtension.ts`）手里没有 `openSettings`（那是宿主的依赖，
//      宿主是保留文件 `src/components/CodeEditor.vue`）⇒ 放上去就是一枚点了没反应的条目。
//      接法见 `docs/wiring-requests-2026-10-06-codelens2.md` 的 C-2。
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
/**
 * 本地 `references`（用法计数）provider 的组 —— id 不是本仓起的：
 * `platform/lang-impl/src/com/intellij/codeInsight/codeVision/settings/PlatformCodeVisionIds.kt:5`
 * `USAGES("references")`，组闸读的就是这一格（`ReferencesCodeVisionProvider.kt:20-21` 的
 * `override val groupId get() = PlatformCodeVisionIds.USAGES.key`）；
 * 本仓的同名 provider 在 `src/codeVisionProviders.ts`（`usagesVisionProvider()` 的 `id: 'references'`）。
 */
export const USAGES_CODE_VISION_GROUP_ID = 'references'
/** 本地 `inheritors`（继承者计数）provider 的组：上游同文件 `:6` `INHERITORS("inheritors")`（`InheritorsCodeVisionProvider.kt:11-12` 取它当 groupId）。 */
export const INHERITORS_CODE_VISION_GROUP_ID = 'inheritors'

/** `LspBundle.properties:33` 的 `codeLens.LspCodeVisionProvider.name`（中文包同键：`LSP CodeLens`）。 */
export const LSP_CODE_VISION_GROUP_NAME = 'LSP CodeLens'
/** 本地 problems provider 的组名（本仓文案；上游这一族的内置 provider 名字来自各自的 EP `name`，本仓只有这一个内置）。 */
export const PROBLEMS_CODE_VISION_GROUP_NAME = '问题计数'
/** 用法计数那一组的组名（本仓文案；上游原文 `CodeVisionBundle.properties` 的 `codeLens.references.name=Usages`，本地化包不在本地树 ⇒ 不抄一份没核实过的中文）。 */
export const USAGES_CODE_VISION_GROUP_NAME = '用法计数'
/** 继承者计数那一组的组名（本仓文案；上游原文同文件 `codeLens.inheritors.name=Inheritors`）。 */
export const INHERITORS_CODE_VISION_GROUP_NAME = '继承者计数'

/**
 * 本仓**会真的渲染出条目**的全部组 = 设置页能勾掉的组 = 盘上那两个集合允许出现的组 id。
 * 一处列，三处用（`src/previewSettings.ts` 的校验、`src/components/CodeVisionSettingsPage.vue` 的
 * GROUPS、`native/settings_editor_keys.hpp` 的白名单逐条对齐）。
 * 为什么必须是同一份：渲染侧按 `codeVisionGroupId()` 收口，**任何**没列进来的组 id 都能由
 * 右键「隐藏这一组」写进运行时表（`handleCodeVisionExtraAction` 不查白名单），但写不进盘
 * （校验拒 `Unknown Code Vision group`）⇒ 上一次 L-4（`codeVisionSettingsPatch()` → 存盘）一接，
 * 右键一条用法计数就会让**之后每一次**设置保存返回 INVALID_SETTINGS。少一个组 = 埋一颗雷。
 */
export const CODE_VISION_GROUP_IDS: readonly string[] = [
  LSP_CODE_VISION_GROUP_ID, PROBLEMS_CODE_VISION_GROUP_ID, USAGES_CODE_VISION_GROUP_ID, INHERITORS_CODE_VISION_GROUP_ID,
]

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
  if (groupId === USAGES_CODE_VISION_GROUP_ID) return USAGES_CODE_VISION_GROUP_NAME
  if (groupId === INHERITORS_CODE_VISION_GROUP_ID) return INHERITORS_CODE_VISION_GROUP_NAME
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

/** 盘上那一份集合灌进运行时表的那一步：**整份替换这一格**（见 `restoreCodeVisionSettings` 的注释）。 */
function replaceGroupSet(target: Record<string, boolean>, ids: readonly string[]): void {
  for (const id of Object.keys(target)) delete target[id]
  // 非字符串/空串不进表：原生侧的校验（`native/settings_editor_keys.hpp:89-97`）本来就挡掉了，
  // 这一句只是保证「表里出现的 id 一定是个能查的键」，不让 `disabledGroups['']` 这种东西进去。
  for (const id of ids) if (typeof id === 'string' && id !== '') target[id] = true
}

/** 把一份磁盘上的设置灌回运行时真值（接线请求 S1 / `docs/…-lensgate.md` 的 L-1 落地，
 *  调用点 `src/workspaceLifecycle.ts:227`；2026-10-06 hlcache300 订正留痕：原写 `:224`，那一行是注释）。
 *  `codeVisionVisibleEntries`（每锚点条数上限）走的是同一条入口：坏值（非整数、0、负数）一律不写，
 *  表里留出厂 5 —— 与 `codeVisionVisibleEntryLimit()` 的兜底同一口径，旧存档缺这一键时也走这里。
 *
 *  两个组集合是**整份替换**（键缺了才保持现值），不是往旧表里追加。上游就是替换：
 *  `CodeVisionSettings.kt:164-166` 的 `override fun loadState(state: State) = … this.state = state`
 *  把整个 `State` 换掉，而那两个集合是 `State` 上的 `var`（`:45` 的 `disabledCodeVisionProviderIds`、
 *  `:50` 的 `enabledCodeVisionProviderIds`）⇒ **盘上没有的那一条 = 回到出厂（开）**。
 *  本仓这张表是跨项目存活的模块级 reactive（切工程不会新建一份），旧实现只加不删的后果是：
 *  工程 A 里关掉 `references`，打开盘上写着空数组的工程 B 时那一组仍然一条都不画，
 *  而设置页按盘上那一份把它显示成"勾着" —— 界面与画出来的东西相反。
 *  判据：`tests/code-lens-grouping.test.mjs` 的「从盘上读回」那两条（关掉 ⇒ 那一组装饰 0 条、
 *  换回空数组 ⇒ 立刻回来，且一次都不重问服务器）。 */
export function restoreCodeVisionSettings(patch: {
  codeVisionEnabled?: boolean; disabledGroups?: readonly string[]; enabledGroups?: readonly string[]; codeVisionVisibleEntries?: number
} | null | undefined): void {
  if (!patch) return
  if (typeof patch.codeVisionEnabled === 'boolean') codeVisionSettings.enabled = patch.codeVisionEnabled
  if (patch.disabledGroups !== undefined) replaceGroupSet(codeVisionSettings.disabledGroups, patch.disabledGroups)
  if (patch.enabledGroups !== undefined) replaceGroupSet(codeVisionSettings.enabledGroups, patch.enabledGroups)
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
