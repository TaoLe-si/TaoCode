// 异常断点的**共享状态**（上游 `XBreakpointType` 的 EXCEPTION 一族 + `XBreakpointGroupingByTypeRule`）。
//
// 为什么要有这个模块：适配器在 initialize 里声明的 `exceptionBreakpointFilters` 同时被两处消费 ——
// Debug 面板的「异常断点」分组（`DebugPanel.vue`）与「查看断点…」对话框的异常分组
// （`BreakpointsDialog.vue`，上游的 `BreakpointsGroupNode` / `XBreakpointTypeGroup` 就是把
// 异常断点作为一个类型分组画在同一个对话框里）。两处必须是**同一份勾选状态**，否则在对话框里
// 勾了「未捕获异常」、回面板却看着没勾。所以状态自持在这里，两边都 import 同一个单例。
//
// 勾选变化要往下发给适配器（DAP `setExceptionBreakpoints`），发送失败不抛给调用方 ——
// 某个适配器没实现这个请求时，面板不该因为一条可选通知而卡住。
import { reactive } from 'vue'
import { dapSetExceptionBreakpoints, type DapExceptionFilter } from './bridge.ts'

export interface ExceptionBreakpointRow {
  filter: string
  label: string
  description: string
  checked: boolean
}

export interface ExceptionBreakpointGroup {
  /** 分组标题（上游 `XBreakpointTypeGroup` 的显示名）。 */
  label: string
  /** 已启用的过滤器数 / 总数（组头上的计数，IDEA 的分组节点同样带这个）。 */
  enabled: number
  total: number
  rows: ExceptionBreakpointRow[]
}

/** 组名：上游断点对话框里异常断点那一组的类型名（`XBreakpointType.getDisplayName()`）。 */
export const EXCEPTION_BREAKPOINT_GROUP_LABEL = '异常断点'

/** Debug 面板与断点对话框共用的单例（会话级：适配器声明是会话的属性）。 */
export const exceptionBreakpointState = reactive<{ filters: DapExceptionFilter[]; checked: string[] }>({
  filters: [],
  checked: [],
})

/**
 * 从 `initialize` 的 capabilities 里解析过滤器表。非对象、缺 `filter` 的条目丢掉；
 * 字符串 `filter` 相同的只留第一条（适配器可以重复声明，勾选语义只认 id）。
 */
export function parseExceptionFilters(capabilities: Record<string, unknown> | undefined): DapExceptionFilter[] {
  const raw = capabilities?.exceptionBreakpointFilters
  if (!Array.isArray(raw)) return []
  const parsed: DapExceptionFilter[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object' || typeof (item as DapExceptionFilter).filter !== 'string') continue
    const filter = item as DapExceptionFilter
    if (!filter.filter || seen.has(filter.filter)) continue
    seen.add(filter.filter)
    parsed.push(filter)
  }
  return parsed
}

/**
 * 会话拿到 capabilities 后整份覆盖过滤器表。勾选状态**保留**：同一个适配器重开一次会话时，
 * 用户上一轮的勾选还能用；只有第一次（当前一个都没勾）才套用适配器声明的 `default`。
 * 适配器不再声明的过滤器要从勾选里剔掉（发给 setExceptionBreakpoints 会被拒绝）。
 */
export function applyExceptionFilters(filters: readonly DapExceptionFilter[]): void {
  exceptionBreakpointState.filters = [...filters]
  const known = new Set(filters.map(filter => filter.filter))
  const kept = exceptionBreakpointState.checked.filter(filter => known.has(filter))
  if (!kept.length) for (const filter of filters) if (filter.default) kept.push(filter.filter)
  exceptionBreakpointState.checked = kept
}

export function isExceptionFilterChecked(filter: string): boolean {
  return exceptionBreakpointState.checked.includes(filter)
}

export function checkedExceptionFilters(): string[] {
  return [...exceptionBreakpointState.checked]
}

/**
 * 勾选/取消一个过滤器并下发给适配器。返回是否成功送给适配器（本地状态一定已经翻转 ——
 * 用户点了复选框，界面必须立刻反映，不能因为适配器答不上来就假装没点）。
 */
export async function toggleExceptionBreakpoint(filter: string): Promise<boolean> {
  const next = new Set(exceptionBreakpointState.checked)
  if (next.has(filter)) next.delete(filter)
  else next.add(filter)
  exceptionBreakpointState.checked = [...next]
  try {
    await dapSetExceptionBreakpoints([...next])
    return true
  } catch {
    return false
  }
}

/** 把当前勾选发给适配器（启动/附加拿到 capabilities 之后用）。 */
export async function sendExceptionBreakpoints(): Promise<void> {
  if (!exceptionBreakpointState.checked.length) return
  try { await dapSetExceptionBreakpoints(checkedExceptionFilters()) } catch { /* 适配器可能不支持 */ }
}

/**
 * 断点对话框要渲染的异常断点分组。没有声明任何过滤器时返回 null（对话框不画空组）。
 * 行的显示名优先用适配器给的 `label`，退回 `filter` id —— 与面板里的行为一致。
 */
export function exceptionBreakpointGroup(): ExceptionBreakpointGroup | null {
  const filters = exceptionBreakpointState.filters
  if (!filters.length) return null
  const rows = filters.map(filter => ({
    filter: filter.filter,
    label: filter.label ?? filter.filter,
    description: filter.description ?? '',
    checked: isExceptionFilterChecked(filter.filter),
  }))
  return {
    label: EXCEPTION_BREAKPOINT_GROUP_LABEL,
    enabled: rows.filter(row => row.checked).length,
    total: rows.length,
    rows,
  }
}
