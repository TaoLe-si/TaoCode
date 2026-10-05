// 设置形状校验与检查器数据 —— 上游 `platform/ide-core/src/com/intellij/ide/`
// 的 `GeneralSettings`/`GeneralLocalSettings`（PersistentStateComponent 的键集）
// 与 `platform/platform-impl/src/com/intellij/ide/settings/json/` 的
// `JsonSettingsModel`/`SettingsInspector`（按模型键集读写、未知键与类型不符可被检查出来）。
//
// 本仓现状：`WorkspaceLifecycle` 读 `app.state` 时直接 `{ ...defaultGeneralSettings, ...state.general }` ——
// 旧版本留下来的键、被手改坏的类型都会原样进内存，再被设置页当布尔/数字用。
// 这里把「按默认值形状收口」落成纯规则，读盘这一处消费：
//   · 未知键（默认对象里没有的）丢掉并记一条 issue（相当于 IDEA 反序列化时忽略未知键）；
//   · 类型不符（默认是布尔却拿字符串等）回落到默认值并记 issue；
//   · 缺失键保持默认；数组按数组校验（元素结构由各消费点自己管）。
//
// 明确不做（上游有、本仓没有）：`GeneralLocalSettings` 的**本机级**存储拆分（哪些键随机器走、
// 哪些随设置同步，本仓一份 JSON 落盘，宿主侧 native/settings_schema.cpp 管白名单）；
// `PropertiesComponentEx` 的
// 应用级键值通道（本仓散在 localStorage，未收口）；`GeneralSettingsConfigurableEP` 的
// 扩展点注册（设置页是手写组件，没有 EP 宿主）。
// 2026-10-06 补：`SettingsInspector` 的**浏览/重置面板**落了地 —— `inspectableSettings` +
// `restoreSettingToDefault`/`restoreSettingsToDefault`，消费点是设置页「系统设置」的
// 「已改动的通用设置」块（`src/components/GeneralRegistryToggles.vue`）。

export type SettingsIssueKind = 'not-an-object' | 'unknown-key' | 'type-mismatch'

export interface SettingsIssue {
  /** 顶层键名（本仓的 GeneralSettingsState 是平铺对象；嵌套结构按叶子类型整体校验）。 */
  path: string
  kind: SettingsIssueKind
  detail: string
}

export interface SettingsInspection<T> {
  value: T
  issues: SettingsIssue[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 单个值是否符合默认值的形状（null 默认只接受 null；数组按数组；对象按普通对象）。 */
export function settingsValueMatches(defaultValue: unknown, candidate: unknown): boolean {
  if (candidate === undefined) return true                       // 缺失 = 用默认
  if (defaultValue === null) return candidate === null
  if (Array.isArray(defaultValue)) return Array.isArray(candidate)
  if (isPlainObject(defaultValue)) return isPlainObject(candidate)
  if (typeof defaultValue === 'number') return typeof candidate === 'number' && Number.isFinite(candidate)
  return typeof candidate === typeof defaultValue
}

/**
 * 按默认值形状规范化加载进来的设置对象（`JsonSettingsModel` 的键校验 + 回落）。
 * 返回**新对象**：只含默认值里有的键，逐键取合法值，非法/未知的都记 issue。
 */
export function normalizeSettingsShape<T extends object>(defaults: T, loaded: unknown): SettingsInspection<T> {
  const issues: SettingsIssue[] = []
  if (loaded === undefined || loaded === null) return { value: { ...defaults }, issues }
  if (!isPlainObject(loaded)) {
    return { value: { ...defaults }, issues: [{ path: '', kind: 'not-an-object', detail: `设置状态应为对象，收到 ${typeof loaded}。` }] }
  }
  const known = new Set(Object.keys(defaults))
  for (const key of Object.keys(loaded)) {
    if (!known.has(key)) issues.push({ path: key, kind: 'unknown-key', detail: `未知设置键「${key}」，已忽略。` })
  }
  const value = { ...defaults }
  for (const key of Object.keys(defaults) as Array<keyof T & string>) {
    const candidate = (loaded as Record<string, unknown>)[key]
    if (candidate === undefined) continue
    const fallback = defaults[key]
    if (!settingsValueMatches(fallback, candidate)) {
      issues.push({
        path: key,
        kind: 'type-mismatch',
        detail: `「${key}」应为 ${Array.isArray(fallback) ? 'array' : fallback === null ? 'null' : typeof fallback}，收到 ${Array.isArray(candidate) ? 'array' : typeof candidate}；已恢复默认值。`,
      })
      continue
    }
    value[key] = candidate as T[keyof T & string]
  }
  return { value, issues }
}

/** 检查器的一行：路径 / 当前值 / 是否偏离默认（`SettingsInspector` 的摘要口径）。 */
export interface SettingsRow {
  path: string
  value: string
  changed: boolean
}

function renderValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.length} 项]`
  if (typeof value === 'object') return '{…}'
  return String(value)
}

/** 与默认值不同的顶层键（检查器里「已修改」那批；数组/对象只报是否变过，不做深比较）。 */
export function changedSettings<T extends object>(defaults: T, current: T): SettingsRow[] {
  const rows: SettingsRow[] = []
  for (const key of Object.keys(defaults) as Array<keyof T & string>) {
    const before = defaults[key]
    const after = current[key]
    const changed = Array.isArray(before) || isPlainObject(before)
      ? JSON.stringify(before) !== JSON.stringify(after)
      : before !== after
    if (changed) rows.push({ path: key, value: renderValue(after), changed: true })
  }
  return rows
}

/** 把 issue 列表收成一句用户可见的话（类型不符优先，其次是未知键计数）。 */
export function settingsIssuesSummary(issues: readonly SettingsIssue[]): string {
  if (!issues.length) return ''
  const mismatches = issues.filter(issue => issue.kind === 'type-mismatch' || issue.kind === 'not-an-object')
  const unknown = issues.filter(issue => issue.kind === 'unknown-key')
  const parts: string[] = []
  if (mismatches.length) parts.push(`${mismatches.length} 项设置值类型不合法已恢复默认`)
  if (unknown.length) parts.push(`${unknown.length} 个未知设置键已忽略`)
  return parts.join('，')
}

/**
 * 「把这一项恢复成出厂默认」—— 上游设置页里每个改动过的控件旁边那条 **Reset to default** 链接
 * （`Configurable` 的 reset 语义：`ComponentReplacer`/`LabeledComponent` 在 `isModified` 时给出的恢复动作）。
 * 只动被点名的那一个键，数组/对象按默认值**深拷贝**（否则页面会一直共享默认对象里那只数组）。
 * 返回是否真的改了（本来就是默认值时返回 false，调用方据此不标脏）。
 */
export function restoreSettingToDefault<T extends object>(defaults: T, target: T, key: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(defaults, key)) return false
  const fallback = defaults[key as keyof T]
  const current = target[key as keyof T]
  if (JSON.stringify(fallback) === JSON.stringify(current)) return false
  ;(target as Record<string, unknown>)[key] = structuredClone(fallback)
  return true
}

/** 整页恢复默认（`Configurable.reset` 的"这一页全部回默认"）；返回被改回的键。 */
export function restoreSettingsToDefault<T extends object>(defaults: T, target: T, keys?: readonly string[]): string[] {
  const restored: string[] = []
  for (const key of keys ?? (Object.keys(defaults) as Array<keyof T & string>)) {
    if (restoreSettingToDefault(defaults, target, key)) restored.push(key)
  }
  return restored
}

/**
 * 检查器面板的一行 = 设置键 + 当前值 + 它是不是数组/对象（面板对数组/对象只报"改过没有"，
 * 与 `changedSettings` 同一口径）。
 */
export interface SettingsInspectableRow {
  path: string
  value: string
  /** 默认值是什么（"恢复默认"按钮的提示文案要用；数组/对象给渲染后的形状）。 */
  defaultValue: string
}

/** 检查器列表：`changedSettings` 的行 + 各自的默认值（面板渲染用）。 */
export function inspectableSettings<T extends object>(defaults: T, current: T): SettingsInspectableRow[] {
  return changedSettings(defaults, current).map(row => ({
    path: row.path,
    value: row.value,
    defaultValue: renderValue(defaults[row.path as keyof T]),
  }))
}

