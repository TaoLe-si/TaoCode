// 调试器设置的**本仓存储**——上游 `XDebuggerSettingsManager` 的两张子表里，本仓此前没有落点的那几格。
//
// 上游坐标（逐格照抄默认值）：
//   · `platform/xdebugger-impl/src/com/intellij/xdebugger/impl/settings/XDebuggerSettingManagerImpl.java:28`
//     —— `@State(name="XDebuggerSettings", storages=@Storage("debugger.xml"))`：**应用级**存储，
//     不是项目级（本仓因此用单个 localStorage 键，不按项目根分桶；与 `src/debugWatches.ts`
//     /`src/breakpointGroups.ts` 那种「按项目根」的键刻意不同）。
//   · `.../settings/XDebuggerGeneralSettings.java:14` `hideDebuggerOnProcessTermination` → 默认 **false**；
//     `:15` `myShowDebuggerOnBreakpoint = true`；`:16` `myScrollToCenter = false`；
//     `:17` `myConfirmBreakpointRemoval = false`（本仓已在 general settings 里，见下）；
//     `:18` `myRunToCursorGesture = true`。
//   · `.../settings/XDebuggerDataViewSettings.java:25` `autoExpressions = true`；`:26`
//     `valueLookupDelay = DEFAULT_VALUE_TOOLTIP_DELAY`；`:31` `showValuesInline = true`。
//   · `platform/xdebugger-api/src/com/intellij/xdebugger/settings/XDebuggerSettingsManager.java:21`
//     —— `DEFAULT_VALUE_TOOLTIP_DELAY = 700`。
//   · `platform/util/resources/misc/registry.properties:609` `debugger.valueTooltipAutoShow=true`
//     （`:610` 的说明 =「Auto show tooltip on mouse over」）⇒「悬停显示值提示」默认**开**。
//
// 为什么走 localStorage 而不是 `settings.general`：新键必须先进 native 的
// `GENERAL_SETTING_KEYS` 白名单，漏一个键 `validate_general_patch` 会把**整次**
// `settings.general.update` 拒掉（见 `native/settings_schema.cpp:201` 的 `known_keys` 与
// `tests/debug-settings-keys.test.mjs` 文件头记的先例）。白名单在 `native/settings_schema.hpp`
// （保留文件），所以这几格先由本模块自己存、自己读 —— 消费点全部在本仓真实代码里
// （`src/quickEvaluateHint.ts` / `src/dbgRunToCursorGutter.ts` / `src/editorDebugLine.ts` /
// `src/debugWindowPolicy.ts` / `src/components/DebuggerSettingsPage.vue`），不是死开关。
// 已经在 general settings 里的五格（隐藏 null / 按名排序 / 行内值 / 库帧 / 移断点确认 /
// 自动取消静音 / 求值形态）继续走那条路，这里不重复登记。
import { reactive, watch } from 'vue'

/** 本仓新登记的调试器设置格（上游类名写在字段注释里）。 */
export interface DebuggerExtraSettings {
  /** `XDebuggerGeneralSettings.hideDebuggerOnProcessTermination`（`:14`，默认 false）。 */
  hideDebuggerOnProcessTermination: boolean
  /** `XDebuggerGeneralSettings.myShowDebuggerOnBreakpoint`（`:15`，默认 true）。 */
  showDebuggerOnBreakpoint: boolean
  /** `XDebuggerGeneralSettings.myScrollToCenter`（`:16`，默认 false）。 */
  scrollToCenter: boolean
  /** `XDebuggerGeneralSettings.myRunToCursorGesture`（`:18`，默认 true）。 */
  runToCursorGestureEnabled: boolean
  /** Registry `debugger.valueTooltipAutoShow`（`registry.properties:609`，默认 true）。 */
  valueTooltipAutoShow: boolean
  /** `XDebuggerDataViewSettings.valueLookupDelay`（`:26` = 上游默认 700ms）。 */
  valueLookupDelay: number
  /** `XDebuggerDataViewSettings.autoExpressions`（`:25`，默认 true）。 */
  autoExpressions: boolean
}

/** 上游默认档：只有 700 是常量（`XDebuggerSettingsManager.java:21`），其余照抄字段初值。 */
export const DEFAULT_DEBUGGER_EXTRA_SETTINGS: DebuggerExtraSettings = {
  hideDebuggerOnProcessTermination: false,
  showDebuggerOnBreakpoint: true,
  scrollToCenter: false,
  runToCursorGestureEnabled: true,
  valueTooltipAutoShow: true,
  valueLookupDelay: 700,
  autoExpressions: true,
}

/** 应用级单键（上游 debugger.xml 是应用级存储，见文件头）。 */
export const DEBUGGER_EXTRA_SETTINGS_KEY = 'taocode.debuggerExtras'

/** localStorage 的最小面：单测传假对象，不依赖 window（与 `src/breakpointGroups.ts` 同一口径）。 */
export interface DebuggerExtraStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * 解析持久化数据：坏数据/缺键一律退回上游默认（不做「键数不对就算损坏」那一套 ——
 * 老版本存盘里本来就没有新键，逐个键补默认是唯一正确的读法）。
 * 延迟只接受 0..上限 的整数（`Number.isFinite` + 非负），其余丢弃该键。
 */
export function parseDebuggerExtras(raw: string | null | undefined): DebuggerExtraSettings {
  const next: DebuggerExtraSettings = { ...DEFAULT_DEBUGGER_EXTRA_SETTINGS }
  if (!raw) return next
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return next }
  if (!parsed || typeof parsed !== 'object') return next
  const data = parsed as Record<string, unknown>
  for (const key of Object.keys(next) as (keyof DebuggerExtraSettings)[]) {
    const value = data[key]
    if (key === 'valueLookupDelay') {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) next.valueLookupDelay = Math.floor(value)
      continue
    }
    if (typeof value === 'boolean') next[key] = value
  }
  return next
}

/** 序列化：只写与默认档不同的格（存盘短，且新键在旧存盘里天然缺 → 读时补默认）。 */
export function serializeDebuggerExtras(settings: DebuggerExtraSettings): string {
  const diff: Record<string, unknown> = {}
  for (const key of Object.keys(DEFAULT_DEBUGGER_EXTRA_SETTINGS) as (keyof DebuggerExtraSettings)[]) {
    if (settings[key] !== DEFAULT_DEBUGGER_EXTRA_SETTINGS[key]) diff[key] = settings[key]
  }
  return JSON.stringify(diff)
}

/** 全仓共用的一份（设置页写、编辑器/悬停/工具窗口读）；与 `src/exceptionBreakpoints.ts` 同一手法。 */
export const debuggerExtras = reactive<DebuggerExtraSettings>({ ...DEFAULT_DEBUGGER_EXTRA_SETTINGS })

/** 读盘 → 灌进单例。宿主在应用启动时调一次（`loadDebuggerExtras` 幂等，可重复调）。 */
export function loadDebuggerExtras(store: DebuggerExtraStore | null | undefined,
  key: string = DEBUGGER_EXTRA_SETTINGS_KEY): DebuggerExtraSettings {
  let raw: string | null = null
  try { raw = store?.getItem(key) ?? null } catch { raw = null }
  const settings = parseDebuggerExtras(raw)
  Object.assign(debuggerExtras, settings)
  return settings
}

/** 落盘当前单例；存储不可用时静默降级成会话内状态（与断点组那一层同写法）。 */
export function saveDebuggerExtras(store: DebuggerExtraStore | null | undefined,
  key: string = DEBUGGER_EXTRA_SETTINGS_KEY): void {
  if (!store) return
  try { store.setItem(key, serializeDebuggerExtras(debuggerExtras)) } catch { /* 只在会话内生效 */ }
}

/**
 * 改一格并落盘（设置页的输入控件走这里，或者直接 v-model 改 `debuggerExtras` 由
 * 下面的持久化监听落盘）。非法延迟按 `quickEvaluateDelay` 的口径处理，
 * 这里只做「非有限/负数 → 上游默认」这一层兜底，避免把 0 以外的小值当默认。
 */
export function patchDebuggerExtras(store: DebuggerExtraStore | null | undefined,
  patch: Partial<DebuggerExtraSettings>): DebuggerExtraSettings {
  const delay = patch.valueLookupDelay
  if (delay !== undefined && !(Number.isFinite(delay) && delay >= 0)) delete patch.valueLookupDelay
  Object.assign(debuggerExtras, patch)
  saveDebuggerExtras(store ?? browserExtrasStore())
  return { ...debuggerExtras }
}

/** 浏览器环境下的 localStorage 适配器；node（单测）/ 存储被禁用时返回 null ⇒ 只在会话内生效。 */
export function browserExtrasStore(): DebuggerExtraStore | null {
  try {
    const storage = typeof localStorage === 'undefined' ? null : localStorage
    if (!storage) return null
    return {
      getItem: key => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
    }
  }
  catch { return null }
}

/** `attachDebuggerExtrasPersistence` 只接一次（模块加载自接一次，测试可显式再注入假盘）。 */
let persistenceAttached = false

/**
 * 自我接线：读盘一次 + 「改一格即落盘」的监听。
 *
 * 为什么在这里做而不是在 `App.vue`：`src/App.vue` 是保留文件（余量 35 行），而这几格的语义就是
 * 上游 `debugger.xml` 的应用级存盘，**没有宿主配合也必须真的存下来**（否则设置页每改一格都只是
 * 会话内状态，重启即丢 —— 那是假设置）。`loadDebuggerExtras` / `saveDebuggerExtras` 全都
 * try/catch 过，存储不可用时静默降级。
 * 返回是否接上了（没接上 = 当前环境没有可用的 localStorage，测试里就是这条路径）。
 */
export function attachDebuggerExtrasPersistence(store?: DebuggerExtraStore | null): boolean {
  if (persistenceAttached) return false
  const target = store === undefined ? browserExtrasStore() : store
  if (!target) return false
  persistenceAttached = true
  loadDebuggerExtras(target)
  watch(debuggerExtras, () => saveDebuggerExtras(target), { deep: true })
  return true
}

// 模块加载即接一次（`quickEvaluateHint.ts` 在 CodeEditor 的 import 链上，所以这条链一定被走过；
// 单测里 browserExtrasStore() 返回 null ⇒ 什么都不做，不污染测试环境）。
attachDebuggerExtrasPersistence()

/** 悬停值提示的读法：开关 + 延迟一起给，装配层每次悬停现读一次（设置页改完立刻生效）。 */
export function valueTooltipOptions(): { showTooltip: boolean; valueLookupDelay: number } {
  return { showTooltip: debuggerExtras.valueTooltipAutoShow, valueLookupDelay: debuggerExtras.valueLookupDelay }
}
