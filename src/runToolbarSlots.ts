// 运行工具栏的**槽位布局** —— 上游 `execution/runToolbar` 的 `RunToolbarSlotManager` /
// `RunToolbarEditConfigurationAction`（含那三条同文件动作）/ `RunWidgetResizeController` /
// `RunWidgetWidthHelper` 的可移植子集。
//
// 上游一条槽 = 一个被固定的运行配置：`RunToolbarSettings.kt:96-100` 存 `slotOrder`（有序的
// 槽位 id 列表）+ `slots`（槽位 id → 配置 unique id），`:104` 还存 `runConfigWidth`；
// widget 把每条槽渲染成一格（`RunToolbarExtraSlotPane.kt:220-228`：一格 = 固定宽工具条 +
// 一个 `AllIcons.Toolbar.RemoveSlot` 按钮），并给每格挂一个槽位右键菜单
// `RunToolbarSlotContextMenuGroup`（`intellij.platform.execution.impl.actions.xml:103-108`）：
// 移到顶部 / 编辑配置 / 移除槽位 / 显示工具窗口标签。
//
// 本仓的运行 widget 是**一行固定控件**（选择器、构建、运行、调试、停止、更多、仪表盘），
// 没有"一槽一配置"的模型（一个 widget 只有一个配置选择器）。按 playbook §2，
// 上游这四个动作的用户可见面 = "右键运行 widget 的一格能改它的位置/去留"，于是等价物是：
// **一个槽 = widget 里的一个控件**，布局（顺序 + 隐藏 + 选择器宽度）持久化在 localStorage。
// 判定与坐标都在这里，`MainToolbar.vue` 只渲染与派发；判据 tests/run-toolbar-slots.test.mjs。
//
// 上游槽位的另外两个设置项在本仓**没有对应物**（如实登记，不造控件）：
//   · `moveNewOnTop`（`RunToolbarSettings.kt:102`，默认 true）—— "新增配置时把新槽置顶"，
//     前提是"一槽一配置"；本仓控件槽是固定的七个，没有"新增槽"这件事。
//   · `updateMainBySelected`（`:103`，默认 true）—— "在选择器里选中某个配置就更新主槽"，
//     前提是主槽绑定配置；本仓选择器槽与配置名直接绑定（`runConfigName`），没有主/次槽之分。

/** 槽位 id = 运行 widget 里的一个控件。 */
export type RunToolbarSlotId =
  | 'selector'
  | 'build'
  | 'run'
  | 'debug'
  | 'stop'
  | 'more'
  | 'dashboard'

/**
 * 主槽（上游 `RunToolbarSlotManager.mainSlotData`，`RunToolbarSlotManager.kt:60` 起）：
 * 固定选中/显示的那一格。本仓 = 配置选择器（上游主槽就是显示当前运行配置的那格）。
 */
export const RUN_TOOLBAR_MAIN_SLOT: RunToolbarSlotId = 'selector'

/** 默认顺序 = 今天的固定排布（`MainToolbar.vue` 模板里那一行的先后）。 */
export const RUN_TOOLBAR_SLOT_ORDER: readonly RunToolbarSlotId[] = [
  'selector', 'build', 'run', 'debug', 'stop', 'more', 'dashboard',
]

/** 菜单/提示里的槽位名（对应 widget 上那一格的中文名）。 */
export const RUN_TOOLBAR_SLOT_LABELS: Record<RunToolbarSlotId, string> = {
  selector: '配置选择器',
  build: '构建',
  run: '运行',
  debug: '调试',
  stop: '停止',
  more: '更多运行动作',
  dashboard: '运行仪表盘',
}

/**
 * 选择器宽度上下限：逐字取 `RunWidgetWidthHelper.kt:15-16`
 * （`RUN_CONFIG_WIDTH_UNSCALED_MIN = 200` / `RUN_CONFIG_WIDTH_UNSCALED_MAX = 1200`）。
 * 上游的 setter 会把越界值夹回区间再通知监听者（`:32-45`），`clampRunConfigWidth` 就是它。
 */
export const RUN_CONFIG_WIDTH_MIN = 200
export const RUN_CONFIG_WIDTH_MAX = 1200

/** 越界/坏值一律夹回区间（坏值取下限，对应上游 setter 的 `value < min → min`）。 */
export function clampRunConfigWidth(value: unknown): number {
  const width = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : RUN_CONFIG_WIDTH_MIN
  if (width < RUN_CONFIG_WIDTH_MIN) return RUN_CONFIG_WIDTH_MIN
  if (width > RUN_CONFIG_WIDTH_MAX) return RUN_CONFIG_WIDTH_MAX
  return width
}

export interface RunToolbarLayout {
  /** 可见槽位的顺序（`RunToolbarSettings.slotOrder` 的位置语义）。 */
  order: RunToolbarSlotId[]
  /** 被"移除槽位"摘掉的槽位（留在记录里，才能再显示回来）。 */
  hidden: RunToolbarSlotId[]
  /** 配置选择器那一格的宽度（`RunToolbarSettings.runConfigWidth`，`RunToolbarSettings.kt:104`）。 */
  runConfigWidth: number
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const RUN_TOOLBAR_LAYOUT_KEY = 'taocode.runToolbarLayout'

/** 默认宽度就是上游的默认值：`runConfigWidth` 初值 = `RUN_CONFIG_WIDTH_UNSCALED_MIN`（`RunToolbarSettings.kt:104`）。 */
export function defaultRunToolbarLayout(): RunToolbarLayout {
  return { order: [...RUN_TOOLBAR_SLOT_ORDER], hidden: [], runConfigWidth: RUN_CONFIG_WIDTH_MIN }
}

function slotIdOf(value: unknown): RunToolbarSlotId | null {
  return typeof value === 'string' && (RUN_TOOLBAR_SLOT_ORDER as readonly string[]).includes(value)
    ? value as RunToolbarSlotId
    : null
}

/**
 * 把读回来的记录整成合法布局：丢掉不认识的槽位 id、去重、把**新版本新增**的槽位补到末尾
 * （这样加一个控件时老用户不用清存储就能看到它），宽度按 clamp 夹回区间。
 */
export function normalizeRunToolbarLayout(raw: unknown): RunToolbarLayout {
  const fallback = defaultRunToolbarLayout()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback
  const value = raw as { order?: unknown; hidden?: unknown; runConfigWidth?: unknown }
  const order: RunToolbarSlotId[] = []
  const seen = new Set<RunToolbarSlotId>()
  for (const candidate of Array.isArray(value.order) ? value.order : []) {
    const id = slotIdOf(candidate)
    if (id && !seen.has(id)) { seen.add(id); order.push(id) }
  }
  const hidden: RunToolbarSlotId[] = []
  for (const candidate of Array.isArray(value.hidden) ? value.hidden : []) {
    const id = slotIdOf(candidate)
    if (id && !hidden.includes(id) && !seen.has(id)) hidden.push(id)
  }
  for (const id of RUN_TOOLBAR_SLOT_ORDER) if (!seen.has(id) && !hidden.includes(id)) order.push(id)
  return { order, hidden, runConfigWidth: clampRunConfigWidth(value.runConfigWidth) }
}

/** 读布局（没有记录或记录坏了 = 默认布局，与 `RunnerLayout` 读不到记录时新建一个的语义一致）。 */
export function readRunToolbarLayout(store: StorageLike | undefined): RunToolbarLayout {
  try {
    const raw = store?.getItem(RUN_TOOLBAR_LAYOUT_KEY)
    if (!raw) return defaultRunToolbarLayout()
    return normalizeRunToolbarLayout(JSON.parse(raw))
  } catch {
    return defaultRunToolbarLayout()
  }
}

export function writeRunToolbarLayout(store: StorageLike | undefined, layout: RunToolbarLayout): void {
  try { store?.setItem(RUN_TOOLBAR_LAYOUT_KEY, JSON.stringify(normalizeRunToolbarLayout(layout))) } catch { /* 存储不可用只影响持久化 */ }
}

/** 按布局渲染的槽位（`visibleRunToolbarSlots` 的顺序就是模板里的顺序）。 */
export function visibleRunToolbarSlots(layout: RunToolbarLayout): RunToolbarSlotId[] {
  return normalizeRunToolbarLayout(layout).order
}

/** 被摘掉、可以在「更多」弹层里显示回来的槽位。 */
export function hiddenRunToolbarSlots(layout: RunToolbarLayout): RunToolbarSlotId[] {
  const normalized = normalizeRunToolbarLayout(layout)
  return RUN_TOOLBAR_SLOT_ORDER.filter(id => normalized.hidden.includes(id))
}

/**
 * 能不能移除这一槽：`RunToolbarRemoveSlotAction.update`（`RunToolbarEditConfigurationAction.kt:66-71`）
 * 的判据是「不是主槽，或者还有别的槽且主槽不处于空态」。本仓 widget 里最接近的硬底线是
 * **不能把 widget 搬空**（留一个槽位就没法再点回来），所以按"可见槽位 ≥ 2"判。
 */
export function canRemoveRunToolbarSlot(layout: RunToolbarLayout, id: RunToolbarSlotId): boolean {
  return visibleRunToolbarSlots(layout).length > 1
}

/** 移到顶部（`RunToolbarSlotManager.moveToTop:437-449`：把 id 挪到 `dataIds` 首位）。 */
export function moveSlotToTop(layout: RunToolbarLayout, id: RunToolbarSlotId): RunToolbarLayout {
  const normalized = normalizeRunToolbarLayout(layout)
  if (normalized.hidden.includes(id)) return normalized
  return { ...normalized, order: [id, ...normalized.order.filter(entry => entry !== id)] }
}

/** 移除槽位（`RunToolbarSlotManager.removeSlot:451-459`：从 `dataIds` 里摘掉；本仓改成 hidden，恢复路径在「更多」弹层）。 */
export function removeSlot(layout: RunToolbarLayout, id: RunToolbarSlotId): RunToolbarLayout {
  const normalized = normalizeRunToolbarLayout(layout)
  if (!canRemoveRunToolbarSlot(normalized, id)) return normalized
  return {
    ...normalized,
    order: normalized.order.filter(entry => entry !== id),
    hidden: [...normalized.hidden, id],
  }
}

/** 把隐藏的槽位放回默认位置（"显示槽位"）。 */
export function restoreSlot(layout: RunToolbarLayout, id: RunToolbarSlotId): RunToolbarLayout {
  const normalized = normalizeRunToolbarLayout(layout)
  if (!normalized.hidden.includes(id)) return normalized
  return { ...normalized, hidden: normalized.hidden.filter(entry => entry !== id), order: [...normalized.order, id] }
}

/** 拖拽后的新宽度（`RunWidgetResizeController.dragged:23-27` 是 `start - offset.width`，方向照抄）。 */
export function runConfigWidthAfterDrag(startWidth: number, deltaX: number): number {
  return clampRunConfigWidth(clampRunConfigWidth(startWidth) - deltaX)
}

// —— 槽位右键菜单（`RunToolbarSlotContextMenuGroup`，actions.xml:103-108） ——

export type RunToolbarSlotActionId =
  | 'RunToolbarMoveToTopAction'
  | 'RunToolbarEditConfigurationAction'
  | 'RunToolbarRemoveSlotAction'
  | 'RunToolbarShowToolWindowTab'

export interface RunToolbarSlotActionRow {
  id: RunToolbarSlotActionId
  label: string
  enabled: boolean
  /** `enabled === false` 时给 UI 的一句话原因（照上游习惯：可用才显示，这里留可见禁用行 + 原因）。 */
  reason?: string
}

/**
 * 每一格的菜单行。判定逐条对上游那条 `update`：
 *   · 移到顶部 —— `RunToolbarMoveToTopAction.update:96-101`（不是主槽、或单槽态）。本仓等价：
 *     「已经在最前面」就没得挪。
 *   · 编辑配置 —— `RunToolbarEditConfigurationAction:9-21` 没有 `update`，恒可用。
 *   · 移除槽位 —— `RunToolbarRemoveSlotAction.update:66-71`。
 *   · 显示工具窗口标签 —— `RunToolbarShowToolWindowTab.update:30-48`：只有当那次执行**已经**
 *     在工具窗口里有 content 时才可用（这里 = 有正在运行的实例）。
 */
export function runToolbarSlotActionRows(
  layout: RunToolbarLayout, id: RunToolbarSlotId, runningInstances: number,
): RunToolbarSlotActionRow[] {
  const normalized = normalizeRunToolbarLayout(layout)
  const atTop = normalized.order[0] === id
  return [
    {
      id: 'RunToolbarMoveToTopAction',
      label: '移到顶部',
      enabled: !atTop,
      ...(atTop ? { reason: '已经在最前面' } : {}),
    },
    { id: 'RunToolbarEditConfigurationAction', label: '编辑配置…', enabled: true },
    {
      id: 'RunToolbarRemoveSlotAction',
      label: '从工具栏移除',
      enabled: canRemoveRunToolbarSlot(normalized, id),
      ...(canRemoveRunToolbarSlot(normalized, id) ? {} : { reason: '只剩一个槽位：移除后运行工具栏就空了' }),
    },
    {
      id: 'RunToolbarShowToolWindowTab',
      label: '显示运行工具窗口标签',
      enabled: runningInstances > 0,
      ...(runningInstances > 0 ? {} : { reason: '没有正在运行的实例' }),
    },
  ]
}
