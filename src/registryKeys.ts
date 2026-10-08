// 注册表键模型 —— 上游 `platform/ide-core/src/com/intellij/openapi/util/registry/`
// （`RegistryKeyBean` 定义键、`ManagedRegistry` 是团队托管覆盖、`RegistryUi` 是可编辑表、
// `ShowRegistryAction` 打开它、`ExperimentalFeatureRegistryValueWrapper` 把实验项包成 RegistryValue）。
//
// IDEA 的键住在 `registry.properties`，TaoCode 没有 JVM 侧 Registry 服务：凡上游只用注册表键、
// 而本仓有真实消费者的开关，早先各自散在消费点当常量（`clipboardHistory.ts` 的 100、
// `diskSync.ts` 的 15s、`tabDragSplit.ts` 的 0.2…），两个升格成设置页开关的（进度弹窗、模糊文件搜索）
// 又只写在组件里。这里把它们收成**一张表**：类型、默认值、说明、是否要重启、消费者文件，
// 以及「是否提升为设置项」的绑定（`ExperimentalFeatureRegistryValueWrapper` 那一条）。
//
// 本模块提供：
//   · `REGISTRY_KEYS` —— 已登记的键（值取自上游 registry.properties 与本仓消费点注释）；
//   · 覆盖值的类型化校验与生效值计算（默认 / 用户覆盖 / 设置项，来源可解释）；
//   · `RegistryUi` 的只读表行 + 编辑/恢复默认（纯数据）；
//   · `ShowRegistryAction` 的过滤（复用 `symbolSearch` 的驼峰子序列）；
//   · 需要重启才生效的改动子集。
//
// 明确不做（上游有、本仓没有）：跨机器的托管覆盖（`ManagedRegistry` 的 EP + 云同步）、
// 插件贡献键（没有 EP 宿主）。
// 2026-10-06 补：`RegistryUi` 的**表**落了地 —— `visibleRegistryRows`（Key/Value/Source 三列 +
// 过滤档速度搜索 + 列头排序），消费点 `src/components/GeneralRegistryToggles.vue` 的「注册表键」块；
// 「恢复默认」按上游的启用门控只给**真有回退通道**的行（`registryRowRevertible`）。
// 仍未做：其余键的**就地编辑**（`applyRegistryEdit`/`restoreRegistryDefaults` 只有数据模型与判据，
// 没有覆盖值存储位，也没有运行时读取方 —— 这 9 个键的读取点分散在别的桶名下，见接线请求）。

import { symbolMatchesQuery } from './symbolSearch.ts'
import type { GeneralSettingsState } from './settingsModel.ts'

export type RegistryKeyType = 'boolean' | 'integer' | 'number' | 'string'

/** 可以升格成设置页布尔开关的键（`ExperimentalFeatureRegistryValueWrapper` 的等价绑定）。 */
export type RegistrySettingsField =
  | 'autoShowProcessPopup'
  | 'fuzzyFileSearch'

export interface RegistryKeySpec {
  key: string
  type: RegistryKeyType
  /** 上游 registry.properties 的默认值（字符串形态，与上游一致）。 */
  defaultValue: string
  description: string
  /** `RegistryKeyBean.restartRequired`：改了要重启才全部生效。 */
  restartRequired: boolean
  /** 本仓真实消费这个值的文件（工作区相对路径）。 */
  consumer: string
  /**
   * 绑定到设置页布尔开关的实验项（`ExperimentalFeatureRegistryValueWrapper`），
   * 生效值来自 `GeneralSettingsState` 而不是覆盖表；缺省 = 普通键。
   */
  field?: RegistrySettingsField
  /** 实验特性的稳定 id（只在 `field` 存在时有意义），对应上游 `ExperimentalFeature.id`。 */
  experimentalId?: string
}

/**
 * 已登记的注册表键。值都与上游 `platform/util/resources/misc/registry.properties` 的条目对照过，
 * `consumer` 指向本仓真正读这个值的模块（不是注释里提一嘴的地方）。
 */
export const REGISTRY_KEYS: readonly RegistryKeySpec[] = [
  {
    key: 'ide.windowSystem.autoShowProcessPopup',
    type: 'boolean',
    defaultValue: 'false',
    description: '有进程开始时自动弹出进度面板（Git、克隆或构建/运行开始时自动打开后台任务列表）。',
    restartRequired: false,
    consumer: 'src/progressPanel.ts',
    field: 'autoShowProcessPopup',
    experimentalId: 'taocode.process.popup',
  },
  {
    key: 'search.everywhere.fuzzy.files.enabled',
    type: 'boolean',
    defaultValue: 'false',
    description: '随处搜索用模糊匹配排序文件（Smith-Waterman 本地对齐打分：连续、驼峰、分隔符加分）。',
    restartRequired: false,
    consumer: 'src/searchEverywhere.ts',
    field: 'fuzzyFileSearch',
    experimentalId: 'taocode.search.everywhere.fuzzy',
  },
  {
    key: 'clipboard.history.max.items',
    type: 'integer',
    defaultValue: '100',
    description: '剪贴板历史的条数上限（超出从尾部替换）。',
    restartRequired: false,
    consumer: 'src/clipboardHistory.ts',
  },
  {
    key: 'clipboard.history.max.memory',
    type: 'integer',
    defaultValue: '10000000',
    description: '剪贴板历史的字符总量上限（超过先从尾部替换）。',
    restartRequired: false,
    consumer: 'src/clipboardHistory.ts',
  },
  {
    key: 'vfs.background.refresh.interval',
    type: 'integer',
    defaultValue: '15000',
    description: '后台磁盘同步的空闲间隔（毫秒）；窗口从最后一次操作起计时。',
    restartRequired: false,
    consumer: 'src/diskSync.ts',
  },
  {
    key: 'ide.windowSystem.hScrollChars',
    type: 'integer',
    defaultValue: '5',
    description: '横向工具窗口按箭头滚动的步长（字符宽度倍数）。',
    restartRequired: false,
    consumer: 'src/panelResize.ts',
  },
  {
    key: 'ide.windowSystem.vScrollChars',
    type: 'integer',
    defaultValue: '5',
    description: '纵向工具窗口按箭头滚动的步长（字符高度倍数）。',
    restartRequired: false,
    consumer: 'src/toolWindowResize.ts',
  },
  {
    key: 'ide.editor.max.pinned.tab.width',
    type: 'integer',
    defaultValue: '2000',
    description: '固定标签的宽度上限，避免长路径独占整条标签栏。',
    restartRequired: false,
    consumer: 'src/tabStripLayout.ts',
  },
  {
    key: 'ide.tabbedPane.dragToSplitRatio',
    type: 'number',
    defaultValue: '0.2',
    description: '把标签拖出分屏时，边缘热区的宽度占标签宽度的比例（夹在 0.05..0.45）。',
    restartRequired: false,
    consumer: 'src/tabDragSplit.ts',
  },
  {
    key: 'ide.max.tool.window.layout.name.length',
    type: 'integer',
    defaultValue: '50',
    description: '工具窗口布局名允许的最大长度。',
    restartRequired: false,
    consumer: 'src/toolLayout.ts',
  },
  {
    key: 'editor.codeVision.more.inlay',
    type: 'boolean',
    defaultValue: 'false',
    description: '行上方提示被截断时是否给「更多…」入口（本仓与上游同样默认不给）。',
    restartRequired: false,
    consumer: 'src/codeLens.ts',
  },
]

const BY_KEY = new Map(REGISTRY_KEYS.map(spec => [spec.key, spec]))

// ── `com.intellij.registryKey` 扩展点宿主（插件贡献的注册表键） ──────────────────────
//
// 上游 `platform/ide-core/resources/intellij.platform.ide.core.xml:38` 声明
// `<extensionPoint qualifiedName="com.intellij.registryKey" beanClass="RegistryKeyBean" dynamic="true"/>`：
// 插件按它贡献自己的注册表键。本仓把 bundled 的 `REGISTRY_KEYS` 登记进 EP，第三方按同一 EP id
// 挂的键由 `allRegistryKeySpecs()` 收编，`registryKeySpec`/`registryRows`/`visibleRegistryRows`
// 这些**真实消费点**都从它取表。
import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/** EP id（逐字取自上游 `intellij.platform.ide.core.xml:38` 的 `qualifiedName`）。 */
export const REGISTRY_KEY_EP = 'com.intellij.registryKey'

/** 声明 EP（幂等）。 */
export function declareRegistryKeyExtensionPoint(): void {
  EXTENSIONS.declareExtensionPoint({ id: REGISTRY_KEY_EP, name: '注册表键', scope: APPLICATION_SCOPE, dynamic: true })
}

/** 插件贡献一个注册表键（等价于上游 plugin.xml 的一条 `com.intellij.registryKey`）。 */
export function registerRegistryKey(spec: RegistryKeySpec, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return EXTENSIONS.registerExtension(REGISTRY_KEY_EP, spec.key, spec, options)
}

/** 注销一条注册表键贡献。 */
export function unregisterRegistryKey(key: string): boolean {
  return EXTENSIONS.unregisterExtension(REGISTRY_KEY_EP, key)
}

/** 当前 EP 上的全部注册表键（bundled + 第三方）。 */
export function registryKeysFromExtensions(scope: string = APPLICATION_SCOPE): RegistryKeySpec[] {
  return EXTENSIONS.extensionsOf<RegistryKeySpec>(REGISTRY_KEY_EP, scope)
}

/** 全部登记键：bundled 表在前，EP 上的第三方贡献按 key 去重补在后面。 */
export function allRegistryKeySpecs(scope: string = APPLICATION_SCOPE): RegistryKeySpec[] {
  const merged = new Map<string, RegistryKeySpec>(BY_KEY)
  for (const spec of registryKeysFromExtensions(scope)) if (!merged.has(spec.key)) merged.set(spec.key, spec)
  return [...merged.values()]
}

// bundled：内置键表按上游 plugin.xml 的 `<com.intellij.registryKey/>` 形态登记在 EP 上。
declareRegistryKeyExtensionPoint()
for (const spec of REGISTRY_KEYS)
  EXTENSIONS.registerExtension(REGISTRY_KEY_EP, spec.key, spec, { source: 'bundled' })

/** 按 key 取登记项（未登记返回 undefined；调用方据此拒绝编辑未知键）。含 EP 上的第三方贡献。 */
export function registryKeySpec(key: string): RegistryKeySpec | undefined {
  return BY_KEY.get(key) ?? registryKeysFromExtensions().find(spec => spec.key === key)
}

/** 类型化解析：返回规范化的字符串形态；类型不合法时返回 null（调用方给错误提示，不静默吞掉）。 */
export function coerceRegistryValue(spec: RegistryKeySpec, raw: string): string | null {
  const value = raw.trim()
  if (spec.type === 'boolean') {
    if (value === 'true' || value === 'false') return value
    return null
  }
  if (spec.type === 'integer') {
    if (!/^-?\d+$/.test(value)) return null
    return String(Number.parseInt(value, 10))
  }
  if (spec.type === 'number') {
    if (!/^-?\d+(\.\d+)?$/.test(value)) return null
    return String(Number(value))
  }
  return value
}

/** 一个键的生效值：设置项绑定优先，其次用户覆盖，最后默认值。 */
export function registryValue(spec: RegistryKeySpec, overrides: ReadonlyMap<string, string>, general?: GeneralSettingsState): string {
  if (spec.field && general) return general[spec.field] ? 'true' : 'false'
  const override = overrides.get(spec.key)
  return override === undefined ? spec.defaultValue : override
}

/** 是否偏离默认值（`RegistryValue.isChangedFromDefault`）。 */
export function registryValueChanged(spec: RegistryKeySpec, overrides: ReadonlyMap<string, string>, general?: GeneralSettingsState): boolean {
  return registryValue(spec, overrides, general) !== spec.defaultValue
}

export interface RegistryRow {
  key: string
  value: string
  description: string
  /** `RegistryUi` 的 Source 列：设置项 / 用户覆盖 / 默认。 */
  source: '设置页' | '用户覆盖' | '默认'
  restartRequired: boolean
  changed: boolean
}

/** `RegistryUi` 的表行（只读形态；本仓不提供就地编辑，编辑走设置页或不再提供）。 */
export function registryRows(overrides: ReadonlyMap<string, string> = new Map(), general?: GeneralSettingsState): RegistryRow[] {
  return allRegistryKeySpecs().map(spec => {
    const overridden = overrides.has(spec.key)
    const value = registryValue(spec, overrides, general)
    return {
      key: spec.key,
      value,
      description: spec.description,
      source: spec.field && general ? '设置页' : overridden ? '用户覆盖' : '默认',
      restartRequired: spec.restartRequired,
      changed: value !== spec.defaultValue,
    }
  })
}

export interface RegistryEdit {
  /** 新的覆盖表（不修改入参）。 */
  overrides: Map<string, string>
}

/** `RegistryUi` 的编辑：未知键或类型不合法返回错误字符串（就地校验，不落盘半成品）。 */
export function applyRegistryEdit(
  overrides: ReadonlyMap<string, string>, key: string, raw: string,
): RegistryEdit | { error: string } {
  const spec = registryKeySpec(key)
  if (!spec) return { error: `未知的注册表键：${key}` }
  if (spec.field) return { error: `${key} 已升格为设置页开关，请在设置里改。` }
  const coerced = coerceRegistryValue(spec, raw)
  if (coerced === null) return { error: `${key} 需要 ${spec.type} 值，收到「${raw}」。` }
  const next = new Map(overrides)
  if (coerced === spec.defaultValue) next.delete(key)
  else next.set(key, coerced)
  return { overrides: next }
}

/** 「恢复默认」：清掉全部覆盖（或只清给定键）。 */
export function restoreRegistryDefaults(overrides: ReadonlyMap<string, string>, keys?: readonly string[]): Map<string, string> {
  if (!keys) return new Map()
  const next = new Map(overrides)
  for (const key of keys) next.delete(key)
  return next
}

/** `ShowRegistryAction` 的速度搜索：空查询放行全部，否则按驼峰/子序列过滤（不重排）。 */
export function filterRegistryKeys(specs: readonly RegistryKeySpec[], query: string): RegistryKeySpec[] {
  const needle = query.trim()
  if (!needle) return [...specs]
  return specs.filter(spec => symbolMatchesQuery(spec.key, needle))
}

/** 需要重启才生效的改动子集（`ManagedRegistry`/`RegistryKeyBean.restartRequired` 的提示口径）。 */
export function restartRequiredChanges(
  before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>, general?: GeneralSettingsState,
): RegistryKeySpec[] {
  return allRegistryKeySpecs().filter(spec => spec.restartRequired
    && registryValue(spec, before, general) !== registryValue(spec, after, general))
}

/** 升格为设置页开关的键（消费点 `GeneralRegistryToggles.vue`：渲染说明与改动标注）。 */
export function registryToggleKeys(): RegistryKeySpec[] {
  return allRegistryKeySpecs().filter(spec => spec.field !== undefined)
}

/**
 * 这一行的值**改得回去吗**：只有升格成设置页开关的键有真通道（改 `GeneralSettingsState` 字段 →
 * 落盘 → 消费点读它）。其余键本仓没有覆盖值存储位，也没有运行时读取方（消费点按常量处理），
 * 所以按「没有后端就不渲染控件」的规矩**不给编辑/恢复入口**。
 */
export function registryRowRevertible(spec: RegistryKeySpec): boolean {
  return spec.field !== undefined
}

/**
 * 「恢复默认」逐键版（上游 `RegistryUi.RestoreDefaultsAction` 的等价物，
 * `RegistryUi.java:666-673` + `:474-485`）：能改回去的只有设置页绑定的键，
 * 改回该键在上游 `registry.properties` 里的默认值。返回是否真的改了
 * （本来就是默认值 ⇒ false，与上游 `setEnabled(!isInDefaultState())` 同一门控）。
 */
export function restoreRegistryDefault(spec: RegistryKeySpec, general: GeneralSettingsState): boolean {
  if (!registryRowRevertible(spec) || !spec.field) return false
  const wanted = spec.defaultValue === 'true'
  if (general[spec.field] === wanted) return false
  general[spec.field] = wanted
  return true
}

/** `registry.key.requires.ide.restart.note`（IdeBundle.properties:2605）的中文形态。 */
export const REGISTRY_RESTART_NOTE = '需要重启 IDE 才生效。'

/**
 * `RegistryUi` 的表行 + `ShowRegistryAction` 的速度搜索（过滤档：`TableSpeedSearch.setFilteringMode(true)`，
 * `RegistryUi.java:188-189` —— 不匹配的行走掉，不是只高亮）+ 排序档。
 * 上游表格三列 Key/Value/Source（`RegistryUi.java:125-138`），列头点击排序（`:193` 的 TableRowSorter）。
 */
export function visibleRegistryRows(general: GeneralSettingsState, query = '',
                                    sort?: 'key' | 'value' | 'source'): RegistryRow[] {
  const matched = new Set(filterRegistryKeys(allRegistryKeySpecs(), query).map(spec => spec.key))
  const rows = registryRows(new Map(), general).filter(row => matched.has(row.key))
  if (!sort) return rows
  const by = (row: RegistryRow): string => sort === 'key' ? row.key : sort === 'value' ? row.value : row.source
  return [...rows].sort((a, b) => by(a).localeCompare(by(b)))
}


/** 设置项绑定的生效值（实验项包装：asBoolean）。 */
export function experimentalRegistryEnabled(spec: RegistryKeySpec, general: GeneralSettingsState): boolean {
  return spec.field !== undefined && general[spec.field]
}
