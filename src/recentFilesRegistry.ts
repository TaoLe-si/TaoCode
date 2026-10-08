// 全局最近文件的**上限设置 + 来源提供者注册表 + 列表边界**（上游 `platform/recentFiles/` 一族）。
//
// 与 `src/recentFilesModel.ts` 的分工：那边是**表本身的增删改与持久化**（`RecentFilesMutableState.kt`
// 的四个事件、`SWITCHER_ELEMENTS_LIMIT` 的行数截断、`RecentFilesExcluder` 谓词、localStorage 落盘）；
// 这边补的是它没有的那三件 —— 可配置的**最大数设置**、**提供者/扩展点一族**、以及
// 「存储容量 vs 弹层行数」两个上限的区别。表操作一律复用那边，不重写。
//
// 纯数据层：不 import vue/DOM/bridge，便于单测（与 `src/codeVisionProviders.ts` 同一纪律）。
//
// ⚠️ 上游没有 `RecentFilesManager` / `RecentFilesProvider` / `RecentFilesList` 这三个类名
//（按文件名、按包路径、按 EP qualifiedName 三条路各搜一遍，全树零命中）。
// 实际存在的是下面这几条：`RecentFilesModel`（PROJECT 级服务）、`RecentFileEventsController`（事件入口）、
// 以及四个 EP 与 `EditorHistoryManager` / `IdeDocumentHistory` 两个数据源。

import {
  SWITCHER_ELEMENTS_LIMIT,
  addEvent,
  isAllowedInRecentFiles,
  stateKeyForKind,
  updateEvent,
  type RecentFileExcluder,
  type RecentFileKind,
  type RecentFilesState,
} from './recentFilesModel.ts'
import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionPointHost } from './extensionPoints.ts'

export { SWITCHER_ELEMENTS_LIMIT }

// ── 最大数设置 ────────────────────────────────────────────────────────────────────────
//
// 三个「最大数」都是 **advancedSetting**（`AdvancedSettingBean`，`AdvancedSettingsImpl.kt` 那套），
// 不是注册表键：注册在 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1470-1474`。
// 最近文件那一条带 `service`/`property`，值其实存在 `UISettings` 上（`AdvancedSettingsImpl.getSetting`
// 读到 service 实例就走 accessor，见 `AdvancedSettingsImpl.kt` 的 `getSetting`/`setSetting`）。

/** `ide.max.recent.files`（`intellij.platform.ide.impl.xml:1471`）。 */
export const RECENT_FILES_LIMIT_SETTING_ID = 'ide.max.recent.files'

/** 值的真身：`UISettingsState.recentFilesLimit` 的 `@get:OptionTag`（`UISettingsState.kt:52`）。 */
export const RECENT_FILES_LIMIT_OPTION_TAG = 'RECENT_FILES_LIMIT'

/** 默认 50（`UISettingsState.kt:53` 的 `property(50)`，与 xml:1471 的 `default="50"` 一致）。 */
export const DEFAULT_RECENT_FILES_LIMIT = 50

/** `ide.max.recent.locations`（`intellij.platform.ide.impl.xml:1473`）。 */
export const RECENT_LOCATIONS_LIMIT_SETTING_ID = 'ide.max.recent.locations'

/** 默认 25（`UISettingsState.kt:57` 的 `property(25)`）。 */
export const DEFAULT_RECENT_LOCATIONS_LIMIT = 25

/** `ide.max.recent.projects`（`intellij.platform.ide.impl.xml:1470`，无 service，值在 advancedSettings 里）。 */
export const RECENT_PROJECTS_LIMIT_SETTING_ID = 'ide.max.recent.projects'

/** 默认 50（`intellij.platform.ide.impl.xml:1470` 的 `default="50"`）。 */
export const DEFAULT_RECENT_PROJECTS_LIMIT = 50

/** 三条设置所在的分组：`group.advanced.settings.ide`（xml:1470-1474；文案 `ApplicationBundle.properties:951` = IDE）。 */
export const ADVANCED_SETTINGS_IDE_GROUP_KEY = 'group.advanced.settings.ide'

/** 最近文件那一条的标题键（`ApplicationBundle.properties:904` = Maximum number of recent files）。 */
export const RECENT_FILES_LIMIT_TITLE_KEY = 'advanced.setting.ide.max.recent.files'

/** 最近位置那一条的标题键（`ApplicationBundle.properties:905`）。 */
export const RECENT_LOCATIONS_LIMIT_TITLE_KEY = 'advanced.setting.ide.max.recent.locations'

/**
 * 历史表容量比设置值多留一条：`EditorHistoryManager.trimToSize` 读的是
 * `UISettings.getInstance().recentFilesLimit + 1`（`platform/platform-impl/src/com/intellij/openapi/
 * fileEditor/impl/EditorHistoryManager.kt:327`，while 循环在 `:328-330` 从**最旧**（index 0）开始删）。
 * 同一口径也在 `IdeDocumentHistoryImpl.kt:326-336`（changedPaths 表）。
 */
export const HISTORY_CAPACITY_HEADROOM = 1

/** 主菜单里最多列几个最近工程：`RecentProjectsManagerBase.MAX_PROJECTS_IN_MAIN_MENU`（`:112`）。 */
export const MAX_PROJECTS_IN_MAIN_MENU = 6

/** 一条「最大数」设置的形状（`AdvancedSettingBean` 的可移植子集）。 */
export interface RecentFilesLimitSetting {
  /** `id` 属性（也是搜索用的 id）。 */
  id: string
  /** 类型：`AdvancedSettingBean.type()` 见 `defaultValue.toIntOrNull() != null` ⇒ Int。 */
  type: 'int'
  defaultValue: number
  /** 值存在哪个服务上（xml 的 `service` 属性；空串 = 存在 advancedSettings 自己的 state 里）。 */
  service: string
  /** 服务上的字段名（xml 的 `property` 属性）。 */
  property: string
  groupKey: string
  titleKey: string
  /** 上游注册坐标（`文件:行号`）。 */
  upstream: string
}

/** 三条已核实的「最大数」设置。 */
export const RECENT_FILES_LIMIT_SETTINGS: readonly RecentFilesLimitSetting[] = [
  {
    id: RECENT_FILES_LIMIT_SETTING_ID, type: 'int', defaultValue: DEFAULT_RECENT_FILES_LIMIT,
    service: 'com.intellij.ide.ui.UISettings', property: 'recentFilesLimit',
    groupKey: ADVANCED_SETTINGS_IDE_GROUP_KEY, titleKey: RECENT_FILES_LIMIT_TITLE_KEY,
    upstream: 'platform/platform-impl/resources/intellij.platform.ide.impl.xml:1471',
  },
  {
    id: RECENT_LOCATIONS_LIMIT_SETTING_ID, type: 'int', defaultValue: DEFAULT_RECENT_LOCATIONS_LIMIT,
    service: 'com.intellij.ide.ui.UISettings', property: 'recentLocationsLimit',
    groupKey: ADVANCED_SETTINGS_IDE_GROUP_KEY, titleKey: RECENT_LOCATIONS_LIMIT_TITLE_KEY,
    upstream: 'platform/platform-impl/resources/intellij.platform.ide.impl.xml:1473',
  },
  {
    id: RECENT_PROJECTS_LIMIT_SETTING_ID, type: 'int', defaultValue: DEFAULT_RECENT_PROJECTS_LIMIT,
    service: '', property: '',
    groupKey: ADVANCED_SETTINGS_IDE_GROUP_KEY, titleKey: 'advanced.setting.ide.max.recent.projects',
    upstream: 'platform/platform-impl/resources/intellij.platform.ide.impl.xml:1470',
  },
]

/** 按 id 取一条设置描述。 */
export function recentFilesLimitSetting(id: string): RecentFilesLimitSetting | null {
  return RECENT_FILES_LIMIT_SETTINGS.find(setting => setting.id === id) ?? null
}

/**
 * 解析用户输入的整数值。
 *
 * 上游接受的是**任意整数、没有区间**：控件是 `intTextField()`（`AdvancedSettingsConfigurable.kt:317`）
 * 且**没传 range**（`Row.intTextField(range: IntRange? = null, …)`，`platform/platform-api/src/
 * com/intellij/ui/dsl/builder/Row.kt:399`），所以只校验「是不是数字」
 *（`RowImpl.kt:385-390`：`toIntOrNull()` 为 null 或落在 range 外才报错，range 为 null 时不校验）。
 * 非整数（含空串、小数、乱码）一律回退到默认值 —— 上游 `valueFromString` 走的是
 * `valueString.toInt()`（`AdvancedSettingsImpl.kt`），本仓不抛异常，回退更稳。
 */
export function parseRecentFilesLimit(raw: unknown, fallback: number = DEFAULT_RECENT_FILES_LIMIT): number {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : fallback
  if (typeof raw !== 'string') return fallback
  const text = raw.trim()
  if (!/^[+-]?\d+$/.test(text)) return fallback
  const value = Number.parseInt(text, 10)
  return Number.isInteger(value) ? value : fallback
}

/**
 * 「这一条算不算改过」：上游 `AdvancedSettingsImpl.setSetting` 在
 * `option.defaultValueObject == value` 时把该 id 从 state 里**移除**（`internalState.remove(id)`），
 * `isNonDefault(id)` 查的就是 state 里有没有这一条。设置页的「恢复默认」按钮也按同一判据显隐
 *（`AdvancedSettingsConfigurable.kt:174` 的 `.visibleIf(advancedSetting.isDefault.not())`）。
 */
export function recentFilesLimitIsDefault(value: number, setting: RecentFilesLimitSetting = RECENT_FILES_LIMIT_SETTINGS[0]!): boolean {
  return value === setting.defaultValue
}

/**
 * 历史表的容量 = 设置值 + 1（`EditorHistoryManager.kt:327` 的 `recentFilesLimit + 1`）。
 * `Math.max(1, …)` 是**本仓的防御**：上游 `trimToSize` 对 `limit < 1` 没有守卫，
 * `while (entries.size > limit)` 在 limit 为负时会一直删到空表再死循环；设置页无区间，
 * 用户能填出负数。上游对最近**工程**有守卫（`RecentProjectsManagerBase.kt:1160` 的 `if (limit < 1 …)`），
 * 最近文件这条没有。
 */
export function historyCapacity(limit: number): number {
  return Math.max(1, limit + HISTORY_CAPACITY_HEADROOM)
}

/**
 * 按容量淘汰：从**最旧**那端丢（`EditorHistoryManager.trimToSize` 的 `entries.removeAt(0)`，`:329`）。
 * 本仓三张表是「最新在前」（`src/recentFilesModel.ts:29`），最旧在表尾 ⇒ 从头保留 capacity 条。
 */
export function trimToHistoryCapacity(entries: readonly string[], limit: number): string[] {
  return entries.slice(0, historyCapacity(limit))
}

/** 弹层一次最多列几条：`SWITCHER_ELEMENTS_LIMIT`（`FileSwitcherApi.kt:101`）。与存储容量无关。 */
export function trimToSwitcherLimit(entries: readonly string[], limit: number = SWITCHER_ELEMENTS_LIMIT): string[] {
  return entries.slice(0, Math.max(0, limit))
}

// ── 来源提供者一族 ────────────────────────────────────────────────────────────────────
//
// 上游 recent files 模块的扩展点共**四个**（声明处逐条可查），加上模块外按同一批数据源做的
// 消费者（Search Everywhere / Run Anything / 文件预测 / 最近测试 / 最近工程）。这里把两批都登记成
// **提供者描述**，family 用 EP 的语义名。

/** 四个 EP 的 qualifiedName（逐字取自各自的声明行）。 */
export const RECENT_FILES_EXTENSION_POINT_IDS = {
  excluder: 'com.intellij.recentFiles.excluder',
  presentationContributor: 'com.intellij.recentFiles.presentationContributor',
  navigator: 'com.intellij.recentFiles.navigator',
  advertisementProvider: 'com.intellij.recentFiles.advertisementProvider',
} as const

export type RecentFilesExtensionPointId = typeof RECENT_FILES_EXTENSION_POINT_IDS[keyof typeof RECENT_FILES_EXTENSION_POINT_IDS]

/** 提供者族：四个 EP 各一档，其余是模块外的消费者族。 */
export type RecentFilesProviderFamily =
  | 'excluder' | 'presentationContributor' | 'navigator' | 'advertisementProvider'
  | 'searchEverywhere' | 'runAnything' | 'filePrediction' | 'tests' | 'projects'

/** 一条提供者描述。`builtin` = 本仓/上游树里真有实现（不是只有接口）。 */
export interface RecentFilesProviderSpec {
  id: string
  family: RecentFilesProviderFamily
  /** 挂在哪条 EP 下；模块外的消费者为 null（它们挂在各自的 EP 上）。 */
  extensionPoint: string | null
  builtin: boolean
  /** 上游实现/注册坐标（`文件:行号`）。 */
  upstream: string
}

/**
 * 已核实的内置提供者。每条的 `upstream` 都能打开确认那一行存在。
 *
 * 四个 EP 的声明位置：`platform/recentFiles/shared/resources/intellij.platform.recentFiles.xml:29-36`
 * 与 `platform/recentFiles/frontend/resources/intellij.platform.recentFiles.frontend.xml:33-39`。
 */
export const RECENT_FILES_PROVIDERS: readonly RecentFilesProviderSpec[] = [
  // ① 排除器：`RecentFilesExcluder.kt:11`，EP_NAME `:18`，判定 `isAllowedInRecentFilesModel` `:23-32`。
  {
    id: 'DiffRecentFilesExcluder', family: 'excluder',
    extensionPoint: RECENT_FILES_EXTENSION_POINT_IDS.excluder, builtin: true,
    upstream: 'platform/vcs-impl/frontend/src/com/intellij/platform/vcs/impl/frontend/diff/DiffRecentFilesExcluder.kt:10'
      + '（注册 platform/vcs-impl/frontend/resources/intellij.platform.vcs.impl.frontend.xml:43）',
  },
  // ② 呈现贡献者：只补「同名文件才需要的路径文案」那一格（`RecentFilePresentationContributor.kt:18`，EP_NAME `:27-28`）。
  {
    id: 'BackendRecentFilePathContributor', family: 'presentationContributor',
    extensionPoint: RECENT_FILES_EXTENSION_POINT_IDS.presentationContributor, builtin: true,
    upstream: 'platform/recentFiles/backend/src/com/intellij/platform/recentFiles/backend/BackendRecentFilePathContributor.kt:28'
      + '（注册 platform/recentFiles/backend/resources/intellij.platform.recentFiles.backend.xml:16）',
  },
  // ③ 导航器：决定这一条用哪种打开方式（`RecentFilesNavigator.kt:11`，EP_NAME `:16-17`，消费 `switcherNavigation.kt:52`）。
  {
    id: 'DiffRecentFilesNavigator', family: 'navigator',
    extensionPoint: RECENT_FILES_EXTENSION_POINT_IDS.navigator, builtin: true,
    upstream: 'platform/vcs-impl/frontend/src/com/intellij/platform/vcs/impl/frontend/diff/DiffRecentFilesNavigator.kt:8'
      + '（注册 platform/vcs-impl/frontend/resources/intellij.platform.vcs.impl.frontend.xml:42）',
  },
  // ④ 广告位：接口与 EP 都在（`RecentFilesAdvertisementProvider.kt:10`，EP_NAME `:14-15`，消费 `Switcher.kt:187`），
  //    但全树**没有**任何一条注册（`grep 'recentFiles.advertisementProvider'` 只命中声明行）。
  {
    id: 'RecentFilesAdvertisementProvider', family: 'advertisementProvider',
    extensionPoint: RECENT_FILES_EXTENSION_POINT_IDS.advertisementProvider, builtin: false,
    upstream: 'platform/recentFiles/frontend/src/com/intellij/platform/recentFiles/frontend/RecentFilesAdvertisementProvider.kt:10（无内置实现）',
  },
  // Search Everywhere：新分屏那条链的工厂/提供者 + 旧贡献者。
  {
    id: 'SeRecentFilesProviderFactory', family: 'searchEverywhere', extensionPoint: null, builtin: true,
    upstream: 'platform/searchEverywhere/backend/src/providers/recentFiles/SeRecentFilesProviderFactory.kt:17'
      + '（注册 platform/searchEverywhere/backend/resources/intellij.platform.searchEverywhere.backend.xml:42）',
  },
  {
    id: 'SeRecentFilesProvider', family: 'searchEverywhere', extensionPoint: null, builtin: true,
    upstream: 'platform/searchEverywhere/backend/src/providers/recentFiles/SeRecentFilesProvider.kt:26',
  },
  {
    id: 'SeRecentFilesLegacyBasedProvider', family: 'searchEverywhere', extensionPoint: null, builtin: true,
    upstream: 'platform/searchEverywhere/backend/src/providers/recentFiles/SeRecentFilesLegacyBasedProvider.kt:22',
  },
  {
    id: 'RecentFilesSEContributor', family: 'searchEverywhere', extensionPoint: null, builtin: true,
    upstream: 'platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/RecentFilesSEContributor.java:34'
      + '（provider id 见 platform/searchEverywhere/shared/src/SeProviderIdUtils.kt:18）',
  },
  // Run Anything：最近工程 / 最近命令。
  {
    id: 'RunAnythingRecentProjectProvider', family: 'runAnything', extensionPoint: null, builtin: true,
    upstream: 'platform/lang-impl/src/com/intellij/ide/actions/runAnything/activity/RunAnythingRecentProjectProvider.java:24'
      + '（注册 platform/lang-impl/resources/intellij.platform.lang.impl.xml:1572）',
  },
  {
    id: 'RunAnythingRecentCommandProvider', family: 'runAnything', extensionPoint: null, builtin: true,
    upstream: 'platform/lang-impl/src/com/intellij/ide/actions/runAnything/activity/RunAnythingRecentCommandProvider.java:15'
      + '（注册 platform/lang-impl/resources/intellij.platform.lang.impl.xml:1573-1574）',
  },
  // 文件预测：最近文件档（自带 30 上限）/ 最近会话档。
  {
    id: 'FilePredictionRecentFilesProvider', family: 'filePrediction', extensionPoint: null, builtin: true,
    upstream: 'plugins/filePrediction/src/com/intellij/filePrediction/candidates/FilePredictionRecentFilesProvider.kt:11'
      + '（注册 plugins/filePrediction/resources/META-INF/plugin.xml:51）',
  },
  {
    id: 'FilePredictionRecentSessionsProvider', family: 'filePrediction', extensionPoint: null, builtin: true,
    upstream: 'plugins/filePrediction/resources/META-INF/plugin.xml:52',
  },
  // 最近测试：数据来自 TestStateStorage，不是 recent files 模型。
  {
    id: 'RecentTestsListProvider', family: 'tests', extensionPoint: null, builtin: true,
    upstream: 'java/execution/impl/src/com/intellij/testIntegration/RecentTestsListProvider.java:40'
      + '（消费 java/execution/impl/src/com/intellij/testIntegration/ShowRecentTests.java:61）',
  },
  // 最近工程：接口 + EP 在 platform-impl，内置实现来自插件（Git 分支那一档）。
  {
    id: 'RecentProjectProvider', family: 'projects', extensionPoint: 'com.intellij.recentProjectsProvider', builtin: false,
    upstream: 'platform/platform-impl/recentProjects/src/ide/RecentProjectProvider.kt:16'
      + '（EP 声明 platform/platform-impl/resources/intellij.platform.ide.impl.xml:382-384）',
  },
  {
    id: 'GitRecentProjectsBranchesProvider', family: 'projects', extensionPoint: 'com.intellij.recentProjectsBranchesProvider', builtin: true,
    upstream: 'plugins/git4idea/backend/src/repo/GitRecentProjectsBranchesProvider.kt:43'
      + '（EP 声明 platform/platform-impl/resources/intellij.platform.ide.impl.xml:380-381）',
  },
]

/** 按族取内置提供者。 */
export function recentFilesProvidersByFamily(family: RecentFilesProviderFamily): RecentFilesProviderSpec[] {
  return RECENT_FILES_PROVIDERS.filter(provider => provider.family === family)
}

/** 注册表（上游 `ExtensionPointName` 的取用面 + 本仓可挂第三方的登记面）。 */
export class RecentFilesProviderRegistry {
  private entries = new Map<string, RecentFilesProviderSpec>()

  constructor(initial: readonly RecentFilesProviderSpec[] = []) {
    for (const provider of initial) this.register(provider)
  }

  /** 同 id 覆盖（与 `ExtensionPointHost.registerExtension` 同口径）。 */
  register(provider: RecentFilesProviderSpec): void {
    if (!provider.id) throw new Error('提供者必须有 id。')
    this.entries.set(provider.id, provider)
  }

  unregister(id: string): boolean { return this.entries.delete(id) }

  has(id: string): boolean { return this.entries.has(id) }

  byId(id: string): RecentFilesProviderSpec | null { return this.entries.get(id) ?? null }

  /** 全部（登记顺序）。 */
  all(): RecentFilesProviderSpec[] { return [...this.entries.values()] }

  /** 按族取，且只取 `builtin` 的那些（对应上游「平台自带的贡献」）。 */
  builtinOf(family: RecentFilesProviderFamily): RecentFilesProviderSpec[] {
    return this.all().filter(provider => provider.family === family && provider.builtin)
  }
}

/** 缺省注册表：装的是上面那张已核实的内置表。 */
export function createRecentFilesProviderRegistry(initial?: readonly RecentFilesProviderSpec[]): RecentFilesProviderRegistry {
  return new RecentFilesProviderRegistry(initial ?? RECENT_FILES_PROVIDERS)
}

/**
 * 把四个 EP 声明进本仓的 EP 宿主，并把内置的那几条作为 bundled 贡献登记
 *（`src/extensionPoints.ts` 的 `declareExtensionPoint`/`registerExtension`，与
 * `src/codeVisionProviders.ts:36-38` 同一做法）。幂等：模块加载时跑一次。
 *
 * `advertisementProvider` 只声明、不登记贡献 —— 上游树里就没有实现（见上面那条 `builtin: false`）。
 */
export function declareRecentFilesExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({
    id: RECENT_FILES_EXTENSION_POINT_IDS.excluder, name: '最近文件排除器',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  EXTENSIONS.declareExtensionPoint({
    id: RECENT_FILES_EXTENSION_POINT_IDS.presentationContributor, name: '最近文件呈现贡献者',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  EXTENSIONS.declareExtensionPoint({
    id: RECENT_FILES_EXTENSION_POINT_IDS.navigator, name: '最近文件导航器',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  EXTENSIONS.declareExtensionPoint({
    id: RECENT_FILES_EXTENSION_POINT_IDS.advertisementProvider, name: '最近文件广告位',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
}

/** 某条 recent files EP 下的全部贡献（已按 LoadingOrder 排序）—— 与上游 `EP_NAME.extensionList` 同口径。 */
export function recentFilesProvidersFromExtensions(
  family: RecentFilesProviderFamily,
  scope: string = APPLICATION_SCOPE,
  host: ExtensionPointHost = EXTENSIONS,
): RecentFilesProviderSpec[] {
  const id = recentFilesExtensionPointFor(family)
  return id ? host.extensionsOf<RecentFilesProviderSpec>(id, scope) : []
}

/** 族 → EP id（模块外的族没有 EP）。 */
export function recentFilesExtensionPointFor(family: RecentFilesProviderFamily): string | null {
  switch (family) {
    case 'excluder': return RECENT_FILES_EXTENSION_POINT_IDS.excluder
    case 'presentationContributor': return RECENT_FILES_EXTENSION_POINT_IDS.presentationContributor
    case 'navigator': return RECENT_FILES_EXTENSION_POINT_IDS.navigator
    case 'advertisementProvider': return RECENT_FILES_EXTENSION_POINT_IDS.advertisementProvider
    default: return null
  }
}

// ── 三个内置实现的可移植规则 ──────────────────────────────────────────────────────────

/**
 * `DiffRecentFilesExcluder.isExcludedFromRecentlyOpened`（`:11-21`）：
 * 只排除 diff 虚拟文件，且取决于「diff 是否进导航历史」这一档设置
 *（`DiffSettingsHolder.IncludeInNavigationHistory`，`platform/diff-impl/src/com/intellij/diff/impl/
 * DiffSettingsHolder.kt:21-25`；默认值 `OnlyIfOpen` 在同文件 `:29`）。
 * `OnlyIfOpen` 时按「这个文件当前有没有开着」判（`:16`）。
 */
export function isIncludedInNavigationHistory(mode: string, fileIsOpen: boolean): boolean {
  switch (mode) {
    case 'Always': return true
    case 'OnlyIfOpen': return fileIsOpen
    case 'Never': return false
    default: return fileIsOpen
  }
}

/** 上一条的取反 + 「非 diff 文件从不排除」（`:12` 的 `if (!file.isDiffVirtualFile()) return false`）。 */
export function diffFileExcludedFromRecentlyOpened(mode: string, fileIsOpen: boolean, isDiffFile: boolean): boolean {
  if (!isDiffFile) return false
  return !isIncludedInNavigationHistory(mode, fileIsOpen)
}

/** 去掉尾部斜杠并把反斜杠归一成 `/`（本仓路径口径；上游用 `FileUtil` 的系统相关名）。 */
function normalizePath(path: string): string {
  const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return slashed === '' ? '/' : slashed
}

/** `ancestor` 是不是 `path` 的祖先（含自身，对应上游 `FileUtil.isAncestor(..., true)`）。 */
function isAncestorPath(ancestor: string, path: string): boolean {
  const base = normalizePath(ancestor)
  const target = normalizePath(path)
  return target === base || target.startsWith(base === '/' ? '/' : `${base}/`)
}

/** `path` 相对 `ancestor` 的那一段；不在其下返回 null（对应 `FileUtil.getRelativePath`）。 */
function relativeUnder(ancestor: string, path: string, separator: string): string | null {
  if (!isAncestorPath(ancestor, path)) return null
  const base = normalizePath(ancestor)
  const target = normalizePath(path)
  const rest = target === base ? '' : target.slice(base === '/' ? 1 : base.length + 1)
  return separator === '/' ? rest : rest.split('/').join(separator)
}

/** `BackendRecentFilePathContributor.getPathText` 的入参（上游从 VirtualFile/Project 现取）。 */
export interface RecentFilePathTextInput {
  /** 文件所在目录的绝对路径（上游 `file.parent.path`）。 */
  parentPath: string | null
  /** 工程根（上游 `project.basePath`）；没有工程传 null。 */
  projectPath: string | null
  /** 用户主目录（上游 `SystemProperties.getUserHome()`）。 */
  userHome: string | null
  /** 工程里有没有同名文件 —— 没有同名就整格不显示（`:31` 的 `areThereFilesWithSameName`）。 */
  hasSameNamedFiles: boolean
  /** 路径分隔符（上游按系统取 `File.separatorChar`；本仓默认 `/`）。 */
  separator?: string
}

/**
 * `BackendRecentFilePathContributor.getPathText`（`:29-45`）的可移植规则：
 *   · 没有父目录、或工程里没有同名文件 ⇒ **null**（这一格整块不显示，`:30-31`）；
 *   · 父目录在工程根之下 ⇒ 相对工程根的路径；相对结果为空则退回绝对路径（`:35-39`）；
 *   · 否则父目录在主目录之下 ⇒ `~/相对主目录`（上游 `getLocationRelativeToUserHome`，`:40-43`）；
 *   · 都不在 ⇒ 绝对路径（`:44`）。
 */
export function recentFilePathText(input: RecentFilePathTextInput): string | null {
  const separator = input.separator ?? '/'
  const parentPath = input.parentPath
  if (!parentPath || !input.hasSameNamedFiles) return null

  if (input.projectPath && isAncestorPath(input.projectPath, parentPath)) {
    const relative = relativeUnder(input.projectPath, parentPath, separator)
    return relative ? relative : parentPath
  }
  if (input.userHome && isAncestorPath(input.userHome, parentPath)) {
    const relative = relativeUnder(input.userHome, parentPath, separator)
    return relative ? `~${separator}${relative}` : parentPath
  }
  return parentPath
}

/**
 * `DiffRecentFilesNavigator.getEditorOpenOptions`（`:10-15`）：diff 文件 + 窗口内开 diff 时用新窗口，
 * 其余返回 null（= 交给缺省打开方式，消费点 `switcherNavigation.kt:52` 的 `?: defaultMode`）。
 */
export function diffRecentFileOpenMode(isDiffFile: boolean, diffInWindow: boolean): 'NEW_WINDOW' | null {
  return isDiffFile && diffInWindow ? 'NEW_WINDOW' : null
}

/** `RecentFilesExcluder` 的排除判定（本仓谓词形态），入参是**本仓**类别拼写。 */
export type RecentFilesExcluderPredicate = (kind: RecentFileKind, path: string) => boolean

/**
 * 一条按族登记的排除器。上游 `RecentFilesExcluder.kt:11-20` 是按**两个方法**分流的
 *（`isExcludedFromRecentlyOpened` `:12` / `isExcludedFromRecentlyEdited` `:14`，默认 false），
 * 判定在 `isAllowedInRecentFilesModel` `:23-32`。
 */
export interface RecentFilesExcluderSpec {
  id: string
  /** 从「最近打开」里排除（`isExcludedFromRecentlyOpened`）。 */
  excludesRecentlyOpened: RecentFilesExcluderPredicate
  /** 从「最近编辑」里排除；上游默认 false ⇒ 不填就是从不排除。 */
  excludesRecentlyEdited?: RecentFilesExcluderPredicate
}

/** `DiffRecentFilesExcluder` 在本仓的形状：只认 diff 文件，是否排除取决于那一档设置。 */
export interface DiffExcluderContext {
  mode: string
  fileIsOpen: boolean
}

/** 把一组 `RecentFilesExcluderSpec` 折成 `src/recentFilesModel.ts` 要的谓词数组。 */
export function excluderPredicates(
  specs: readonly RecentFilesExcluderSpec[], diffContext?: DiffExcluderContext,
): RecentFileExcluder[] {
  return specs.map(spec => (kind: RecentFileKind, path: string) => {
    const isDiff = path.endsWith('.diff')
    const context = diffContext ?? { mode: 'OnlyIfOpen', fileIsOpen: false }
    switch (kind) {
      case 'recentlyEdited':
        return (spec.excludesRecentlyEdited ?? (() => false))(kind, path)
      case 'recentlyOpened':
        return spec.excludesRecentlyOpened(kind, path) || diffFileExcludedFromRecentlyOpened(context.mode, context.fileIsOpen, isDiff)
      case 'recentlyOpenedUnpinned':
        return spec.excludesRecentlyOpened(kind, path) || diffFileExcludedFromRecentlyOpened(context.mode, context.fileIsOpen, isDiff)
    }
  })
}

// ── 列表语义：三种类别、去重、容量、跨窗口/跨项目边界 ──────────────────────────────────

/**
 * 三种类别，按**上游枚举拼写**（`FileSwitcherApi.kt:57-59` 的
 * `RECENTLY_EDITED, RECENTLY_OPENED, RECENTLY_OPENED_UNPINNED`）。
 * 本仓 `src/recentFilesModel.ts:21` 的 `RecentFileKind` 用的是小驼峰（`recentlyOpened` …），
 * 两者靠 `modelKindOf` 互转 —— 上游拼写出现在**事件与 RPC**上，本仓拼写出现在**表字段**上。
 */
export type UpstreamRecentFileKind = 'RECENTLY_EDITED' | 'RECENTLY_OPENED' | 'RECENTLY_OPENED_UNPINNED'

/** 三种类别（`RecentFileKind`，`FileSwitcherApi.kt:57-59`）。 */
export const RECENT_FILE_KINDS: readonly UpstreamRecentFileKind[] = ['RECENTLY_EDITED', 'RECENTLY_OPENED', 'RECENTLY_OPENED_UNPINNED']

/** 上游拼写 → 本仓表字段拼写。`RECENTLY_OPENED_UNPINNED` 写的是 pinned 那份表
 *（`chooseStateToWriteTo`，`RecentFilesMutableState.kt:21-27`，上游枚举名与状态名的对调是它自己的历史遗留）。 */
export function modelKindOf(kind: UpstreamRecentFileKind): RecentFileKind {
  switch (kind) {
    case 'RECENTLY_EDITED': return 'recentlyEdited'
    case 'RECENTLY_OPENED': return 'recentlyOpened'
    case 'RECENTLY_OPENED_UNPINNED': return 'recentlyOpenedUnpinned'
  }
}

/** 每种类别在**后端**取哪张表（`recentFilesCollector.kt:44-47` 的 `when`）。 */
export const RECENT_FILE_SOURCES: readonly { kind: UpstreamRecentFileKind; source: string; upstream: string }[] = [
  {
    kind: 'RECENTLY_EDITED', source: 'IdeDocumentHistory.changedFiles',
    upstream: 'platform/recentFiles/shared/src/com/intellij/platform/recentFiles/shared/recentFilesCollector.kt:45',
  },
  {
    kind: 'RECENTLY_OPENED', source: 'EditorHistoryManager.fileList（再与打开的标签互插）',
    upstream: 'platform/recentFiles/shared/src/com/intellij/platform/recentFiles/shared/recentFilesCollector.kt:46,87-104',
  },
  {
    kind: 'RECENTLY_OPENED_UNPINNED', source: '前端编辑器选中历史（FileEditorManagerImpl.getSelectionHistoryList）',
    upstream: 'platform/recentFiles/shared/src/com/intellij/platform/recentFiles/shared/recentFilesCollector.kt:25-37',
  },
]

/**
 * Switcher/最近文件面板用哪一类：`Switcher.kt:317-319`（初始化）与 `:549-551`（关文件时）。
 *   · 自动关闭的 Switcher（`pinned === false`）用 `unpinnedFilesKind`，而它的判据是
 *     「标签页上限 > 1 ⇒ `RECENTLY_OPENED_UNPINNED`，否则 `RECENTLY_OPENED`」（`:170-171`）；
 *   · 常驻弹层（`pinned`）按「只看已编辑」勾选框分 `RECENTLY_EDITED` / `RECENTLY_OPENED`
 *     （勾选框文案 `IdeBundle.recent.files.checkbox.label`，`:208`）。
 */
export function switcherFilesKind(pinned: boolean, onlyEdited: boolean, tabLimit: number): UpstreamRecentFileKind {
  if (!pinned) return tabLimit > 1 ? 'RECENTLY_OPENED_UNPINNED' : 'RECENTLY_OPENED'
  return onlyEdited ? 'RECENTLY_EDITED' : 'RECENTLY_OPENED'
}

/**
 * `FrontendRecentFilesMutableState.chooseStateToReadFrom`（`:17-31`）里 `RECENTLY_OPENED_UNPINNED` 那一档：
 *   · 只有一条、且这个文件在多个编辑器里开着 ⇒ 还是读 pinned 表（`:25`）；
 *   · 空表或只有一条 ⇒ 退回 `RECENTLY_OPENED`（用户更需要整份最近打开表，`:26`）；
 *   · 其余 ⇒ 读 pinned 表（`:27`）。
 */
export function chooseKindToReadFrom(pinnedEntriesSize: number, singleFileOpenedInMultipleEditors: boolean): UpstreamRecentFileKind {
  if (pinnedEntriesSize === 1 && singleFileOpenedInMultipleEditors) return 'RECENTLY_OPENED_UNPINNED'
  if (pinnedEntriesSize <= 1) return 'RECENTLY_OPENED'
  return 'RECENTLY_OPENED_UNPINNED'
}

/**
 * `getRecentFiles`（`recentFilesCollector.kt:87-104`）：最近文件表里**没**出现的已打开标签，
 * 插到「第一个也在打开列表里的历史条目」那个位置（`:95-99` 找 index，`:102` 的 `result.addAll(index, …)`）。
 * 一个都没命中时 index 保持 0 ⇒ 插在最前。
 */
export function openFilesInterleaved(recentFiles: readonly string[], openFiles: readonly string[]): string[] {
  const recentSet = new Set(recentFiles)
  let index = 0
  for (let i = 0; i < recentFiles.length; i++) {
    if (openFiles.includes(recentFiles[i]!)) { index = i; break }
  }
  const result = [...recentFiles]
  result.splice(index, 0, ...openFiles.filter(file => !recentSet.has(file)))
  return result
}

/** 记录一笔要用的选项。 */
export interface RecordRecentFileOptions {
  /** 三个类别里写哪张表（按上游枚举拼写）。 */
  kind?: UpstreamRecentFileKind
  /** 上限设置值（`ide.max.recent.files`）；写表后按 `historyCapacity` 截断。 */
  limit?: number
  /** 自定义排除器（`RecentFilesExcluder` 一族）。 */
  excluders?: readonly RecentFileExcluder[]
  /** 当前已判定为无效/不存在的路径（上游 `file.isValid` 的等价物）。 */
  excluded?: ReadonlySet<string>
  /** `true` = 命中旧项时按旧表顺序置顶（`FileChangeKind.UPDATED_AND_PUT_ON_TOP`）。 */
  putOnTop?: boolean
}

/**
 * 把一批路径写进某张表：先过排除器，再走 `addEvent`/`updateEvent`，最后按**容量**截断。
 * 表操作全部复用 `src/recentFilesModel.ts`，这里只补「上限从哪来」与「排除器先过」两件事。
 */
export function recordRecentFiles(
  state: RecentFilesState, paths: readonly string[], options: RecordRecentFileOptions = {},
): RecentFilesState {
  const kind = modelKindOf(options.kind ?? 'RECENTLY_OPENED')
  const limit = options.limit ?? DEFAULT_RECENT_FILES_LIMIT
  const excluders = options.excluders ?? []
  const excluded = options.excluded ?? new Set<string>()
  const admitted = paths.filter(path => isAllowedInRecentFiles(kind, path, excluders, excluded as Set<string>))
  if (!admitted.length) return state

  const key = stateKeyForKind(kind)
  const current = state[key]
  const next = options.putOnTop
    ? updateEvent(current, admitted, true)
    : addEvent(current, admitted, Number.MAX_SAFE_INTEGER)
  return { ...state, [key]: trimToHistoryCapacity(next, limit) }
}

/**
 * 跨窗口/跨项目的边界（`RecentFileEventsController.doesProcessHostRecentFilesModel`，`:72-77`）：
 *   · 用回退版 Switcher 时**不**由本进程供模型（`:73`）；
 *   · 严格 LIGHT 会话没有后端可问 ⇒ 自己供（`:75`；注意是 `LIGHT` 而不是 `isLight`，
 *     `LIGHT_WITH_RD_CONNECTION` 已经有连接，从后端取）；
 *   · 其余进程：不是前端就自己供（`:76`）。
 */
export function hostsRecentFilesModel(input: {
  fallbackSwitcher: boolean
  productMode: string
  isFrontend: boolean
}): boolean {
  if (input.fallbackSwitcher) return false
  if (input.productMode === 'LIGHT') return true
  return !input.isFrontend
}

/**
 * 模型的作用域是**工程级**，不是应用级：
 *   · `RecentFilesModel` 是 `@Service(Service.Level.PROJECT)`（`RecentFilesModel.kt:19`）；
 *   · 历史表持久化在工程工作区文件里（`EditorHistoryManager.kt:43` 的 `Storage(PRODUCT_WORKSPACE_FILE)`）；
 *   · VFS 删除/改名事件按**每个打开工程**分别过滤后再各发一次（`RecentFilesVfsListener.kt:32-33,62-64`
 *     的 `ProjectFileIndex.isInContent`）。
 * 所以「最近文件」是 per-project 的；本仓 `src/recentFilesModel.ts` 把整表放在应用级 localStorage
 *（`RECENT_FILES_STORAGE_KEY`，头注释写「与上游 RecentFilesManager 的进程级列表同义」）——
 * 那个 `RecentFilesManager` 在上游树里不存在（三条路搜空），进程级/应用级这一层是**本仓的选择**。
 */
export const RECENT_FILES_MODEL_SCOPE = 'project'

// ── 模块加载时的接线（幂等：与 `src/codeVisionProviders.ts:365-368` 同一做法） ─────────
//
// 四个 EP 声明进宿主 + 三条内置贡献作为 `bundled` 挂进去，于是
// `recentFilesProvidersFromExtensions` 与第三方按 EP id 的注册走的是同一条链
//（`src/extensionPoints.ts` 的宿主）。只登记**本模块声明的那四个** EP 下的贡献：
// `projects` 族那两条挂在 platform-impl 的 `com.intellij.recentProjects*Provider` 上，
// 不在这里声明，硬挂会抛 `UnknownExtensionPointError`。
declareRecentFilesExtensionPoints()
for (const provider of RECENT_FILES_PROVIDERS) {
  if (!provider.builtin || !provider.extensionPoint) continue
  if (provider.extensionPoint !== RECENT_FILES_EXTENSION_POINT_IDS.excluder
    && provider.extensionPoint !== RECENT_FILES_EXTENSION_POINT_IDS.presentationContributor
    && provider.extensionPoint !== RECENT_FILES_EXTENSION_POINT_IDS.navigator) continue
  EXTENSIONS.registerExtension(provider.extensionPoint, provider.id, provider, { source: 'bundled' })
}