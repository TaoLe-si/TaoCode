// IDEA 的**专注模式**（ToggleDistractionFreeMode）—— `ToggleDistractionFreeModeAction` 的行为。
//
// 依据（已核实，逐条对得上）：
//   · 动作 `platform/platform-impl/src/com/intellij/ide/actions/ToggleDistractionFreeModeAction.java:32`
//     —— `:54-88` `actionPerformed`：翻转注册表键 → `applyAndSave` → 进入时 `storeToolWindows`、退出时 `restoreToolWindows`
//   · `:93-124` `applyAndSave`：**15 个设置项**，每项做「`BEFORE.<键>` ← 当前值」+「设置 ← 从 `AFTER.<键>` 读，缺省用专注值」
//   · `DistractionFreeModeController.java:11-15`：键名前缀 `BEFORE.DISTRACTION.MODE.` / `AFTER.DISTRACTION.MODE.`
//     + `LAST_ENTER_VALUE`（记住上次状态，下次启动恢复）
//
// **双向语义是这个功能的精髓，不能简化成"记住一份、恢复一份"**：
//   · 进入：用户当前值 → `BEFORE`；设置 ← 专注值（`AFTER` 里没有时用默认值，也就是"隐藏"）
//   · 退出：**专注模式下的值** → `AFTER`（用户可能在专注模式里又调了什么，那是他的选择，要记住）；
//           设置 ← 从 `BEFORE` 恢复用户进之前的值
//   也就是 `applyAndSave` 的 before/after 两个前缀参数在进入和退出时是**交换**的（`:71` 的
//   `enter ? BEFORE : AFTER, enter ? AFTER : BEFORE`）。
//
// **TaoCode 只映射它真正有的 UI 元素**：`applyAndSave` 的 15 项里，有 8 项在这里有对应设置
// （行号、空白、缩进参考线、面包屑、状态栏、右边距、装订线图标、工具窗口条），其余 7 项 TaoCode
// **根本没有那个 UI 元素**（主工具栏、新主工具栏、折叠大纲×2、方法分隔线、标签位置×2）。
// 那些不写进设置表 —— 项目规则明令「没有真实消费链路的设置项不渲染」，造一个假字段才是错的。
//
// 订正（2026-10-06 · edinput3，动手前逐条 reopen 过）：本文件头原先写「gutter 图标、工具条边纹
// 这两项 TaoCode 没有对应设置」，**实际早已两样都有**（键在 `src/settingsModel.ts:223`，
// 界面在 `src/components/SettingsDialog.vue:795` 与 `:702`，视图菜单在 `src/menus/viewMenu.ts:165`
// 与 `:141`，消费方见下面 `DISTRACTION_FREE_KEYS` 那条注释）⇒ 那两项按上游 `:111`/`:118` 补进映射表。
import type { EditorSettings } from './bridge'

/**
 * TaoCode 侧专注模式要动的设置键（都必须在 `EditorSettings` 里真实存在，且**都有消费方**：
 * `showStatusBar`/`lineNumbers`/`showWhitespaces`/`showIndentGuides`/`showBreadcrumbs`/`rightMargin`
 * 之外这两条 —— `showGutterIcons` 读在 `src/gutterIconHost.ts:46`（对应上游 `areGutterIconsShown()`），
 * `showToolWindowBars` 读在 `src/appearanceActions.ts:235`（写 `data-tool-stripes`，条纹本体
 * `src/toolWindowStripes.ts`）。没有消费方的键一律不进来。）
 */
export const DISTRACTION_FREE_KEYS = ['showStatusBar', 'lineNumbers', 'showWhitespaces', 'showIndentGuides',
  'showBreadcrumbs', 'rightMargin', 'showGutterIcons', 'showToolWindowBars'] as const
export type DistractionFreeKey = typeof DISTRACTION_FREE_KEYS[number]

/**
 * 进入专注模式时这些键的值（对应 `applyAndSave` 里 `value = !enter = false` 时读到的默认值）。
 * 只有 `HIDE_TOOL_STRIPES` 在 IDEA 里是反的（`ToggleDistractionFreeModeAction.java:118` 传的是 `!value`），
 * 而本仓那个键本身就叫 `showToolWindowBars`（`UISettings.hideToolStripes` 的反向命名）⇒ 落到本表
 * 仍然是 `false` = 隐藏，语义与上游一致，**不需要在本表里再造一次取反**。
 */
export const DISTRACTION_FREE_VALUES: Record<DistractionFreeKey, boolean> = {
  showStatusBar: false,
  lineNumbers: false,
  showWhitespaces: false,
  showIndentGuides: false,
  showBreadcrumbs: false,
  rightMargin: false,
  // `applyAndSave:111` ARE_GUTTER_ICONS_SHOWN（`EditorSettingsExternalizable`）→ 本仓同名键。
  showGutterIcons: false,
  // `applyAndSave:118` HIDE_TOOL_STRIPES（`UISettings.getHideToolStripes`，取反）→ 本仓的反向键。
  showToolWindowBars: false,
}

/** 进入前保存的用户值（`BEFORE.*`）。 */
export type DistractionFreeSnapshot = Partial<Record<DistractionFreeKey, boolean>>

/** 进专注模式前把用户当前值抄一份（`applyAndSave` 的 `p.setValue(before + K, 当前值)`）。 */
export function snapshotSettings(settings: Pick<EditorSettings, DistractionFreeKey>): DistractionFreeSnapshot {
  const snapshot: DistractionFreeSnapshot = {}
  for (const key of DISTRACTION_FREE_KEYS) snapshot[key] = Boolean(settings[key])
  return snapshot
}

/** 专注模式下这些键的值（`applyAndSave` 的 `设置 ← AFTER 里没有 ? 默认 : AFTER 里的用户选择`）。 */
export function distractionFreeSettings(after: DistractionFreeSnapshot = {}): Record<DistractionFreeKey, boolean> {
  const values = {} as Record<DistractionFreeKey, boolean>
  for (const key of DISTRACTION_FREE_KEYS)
    // `after` 里有值说明用户在专注模式下调过它 —— 那是他的选择，下次进专注模式要沿用。
    values[key] = typeof after[key] === 'boolean' ? (after[key] as boolean) : DISTRACTION_FREE_VALUES[key]
  return values
}

/**
 * 退出专注模式时**记住**专注模式下的值（`applyAndSave` 的 `p.setValue(before + K, …)`，
 * 而退出时 `before` 就是 `AFTER`）—— 只记那些和默认专注值不同的键，等于记下用户的调整。
 */
export function rememberAdjustments(after: DistractionFreeSnapshot = {}): DistractionFreeSnapshot {
  const remembered: DistractionFreeSnapshot = {}
  for (const key of DISTRACTION_FREE_KEYS) {
    const value = typeof after[key] === 'boolean' ? (after[key] as boolean) : DISTRACTION_FREE_VALUES[key]
    if (value !== DISTRACTION_FREE_VALUES[key]) remembered[key] = value
  }
  return remembered
}

/** 退出专注模式要恢复的设置（`设置 ← BEFORE`）。缺项以 `fallback` 补齐（用于快照丢失时不把设置留在 undefined）。 */
export function restoredSettings(
  before: DistractionFreeSnapshot | undefined,
  fallback: Pick<EditorSettings, DistractionFreeKey>,
): Record<DistractionFreeKey, boolean> {
  const restored = {} as Record<DistractionFreeKey, boolean>
  for (const key of DISTRACTION_FREE_KEYS)
    restored[key] = typeof before?.[key] === 'boolean' ? (before![key] as boolean) : Boolean(fallback[key])
  return restored
}

/**
 * 状态判定。IDEA 侧是 `DistractionFreeModeController.isDistractionFreeModeEnabled()`（读
 * `LAST_ENTER_VALUE`，`:18`）；TaoCode 直接在内存里持有一个布尔（不必持久化 —— 与 IDEA 不同，
 * IDEA 会"下次启动恢复专注模式"，那是它的 `LAST_ENTER_VALUE`；TaoCode 的项目规则是不给
 * "打开就自动进入沉浸状态"的行为，所以**有意不持久化**，这一点在测试里断言）。
 */
export function describeDistractionFree(enabled: boolean): string {
  return enabled ? '退出专注模式' : '进入专注模式'
}
