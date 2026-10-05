// 断点的三类「额外属性」与两个批量动作的纯规则（本轮补齐 dbg/breakpoints 的缺口）：
//
//   · 依赖断点 —— 上游 `XDependentBreakpointManager`（`platform/xdebugger-impl/src/com/intellij/xdebugger/impl/breakpoints/XDependentBreakpointManager.java:112`
//     `setMasterBreakpoint(slave, master, leaveEnabled)` / `:141` `clearMasterBreakpoint` / `:169` `isLeaveEnabled`；
//     存盘在同文件 `:61` `loadState` / `:90` `saveState`）：
//     一个断点可以「在另一个断点命中之前保持禁用」。本仓的 DAP `setBreakpoints` 每次重发整份文件断点，
//     启用/禁用就是「发它 / 不发它」；这里的 `dependentsToEnable` 决定某处命中后要重新发出哪些文件。
//   · 临时断点 —— 上游 `BreakpointState.myTemporary`（`platform/xdebugger-impl/src/com/intellij/xdebugger/impl/breakpoints/BreakpointState.java:20`，
//     随断点存盘）：命中一次就删。DAP 没有临时标志，所以由前端在命中位置删掉再重发（`temporaryHit`）。
//   · 断点静音 —— 上游 `XDebuggerMuteBreakpointsHandler`（`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/actions/handlers/XDebuggerMuteBreakpointsHandler.java:27-37`
//     `setSelected` → `session.muteBreakpoints(state)`，读的是 `:20-25` 的 `areBreakpointsMuted()`）：不删断点、
//     只让调试器暂时忽略它。DAP 里「静音」= 给各文件发空数组；取消静音 = 把存下的断点重发。
//     「静音/取消静音各要发什么」的计划已经并入唯一的下发口 `src/dbgBreakpointUpdate.ts`
//     （`breakpointSendPlan` + `breakpointFileSend`），本文件只留规则本身 —— 12c 之前这里另有一个
//     `mutePlan`，与那条链重复、且只有测试在消费，已删（判据随之改指 `breakpointSendPlan`，形状不变）。
//
// 全部做成纯函数：DebugPanel 只按计划发 DAP 请求，规则可单测。

import type { DapBreakpoint } from './bridge'

/** 断点的稳定身份：`path:line`（本仓断点是行断点，加上路径就唯一）。 */
export function breakpointRef(path: string, line: number): string {
  return `${path}:${line}`
}

/** `path:line` 反向解析；路径本身可能含冒号（Windows 盘符），所以按**最后一个**冒号切。 */
export function parseBreakpointRef(ref: string): { path: string; line: number } | null {
  const at = ref.lastIndexOf(':')
  if (at <= 0) return null
  const line = Number(ref.slice(at + 1))
  if (!Number.isInteger(line) || line < 1) return null
  return { path: ref.slice(0, at), line }
}

/**
 * 临时断点命中判定：当前停在 `location` 且那里有临时断点 → 返回它的 ref（调用方负责删除重发）。
 * 不命中返回 null。`temporary` 是 ref 的无序集合（数组形态便于存 localStorage）。
 */
export function temporaryHit(temporary: readonly string[], location: { path: string; line: number } | null | undefined): string | null {
  if (!location) return null
  const ref = breakpointRef(location.path, location.line)
  return temporary.includes(ref) ? ref : null
}

/** 依赖关系表：`dependentRef -> triggerRef`（依赖者在触发者命中前一直禁用）。 */
export type BreakpointDependencies = Record<string, string>

/** 命中 `hitRef` 后需要启用的依赖断点（触发者正好是它）。返回的 ref 按表序稳定。 */
export function dependentsToEnable(dependencies: BreakpointDependencies, hitRef: string): string[] {
  return Object.keys(dependencies).filter(dependent => dependencies[dependent] === hitRef)
}

/** 依赖断点在启用的那一批里的成员判定（调用方据此过滤「这次要发给适配器的断点」）。 */
export function isEnabledByDependency(dependencies: BreakpointDependencies, enabled: readonly string[], ref: string): boolean {
  return !(ref in dependencies) || enabled.includes(ref)
}

/**
 * 停在断点时是否自动取消静音（上游 `XDebuggerGeneralSettings.isUnmuteOnStop` 的唯一消费点
 * `XDebugSessionBreakpointManager.unmuteOnStop`：会话暂停时调用）。
 */
export function shouldAutoUnmute(muted: boolean, paused: boolean, setting: boolean): boolean {
  return Boolean(setting) && muted && paused
}

/** 全部断点（用于「移除所有断点」与静音计划的输入）；空路径不产生请求。 */
export function allBreakpointFiles(files: ReadonlyMap<string, DapBreakpoint[]>): string[] {
  return [...files.keys()].filter(path => Boolean(path))
}

// ── 逐断点属性的持久化（补 dbg/breakpoints 判词「临时/依赖是会话级内存态」那条）───────
//
// 上游这两条是**逐断点存**的属性，不是会话状态：
//   · 临时：`BreakpointState.myTemporary`（`platform/xdebugger-impl/src/com/intellij/xdebugger/
//     impl/breakpoints/BreakpointState.java:20`，getter/setter :55-61）；
//   · 依赖：`myDependencyState`（同文件 :27，getter/setter :165-172）。
// 静音**不是**逐断点的：它是会话开关（`XDebuggerMuteBreakpointsHandler` → `session.muteBreakpoints`，
// `xdebugger-impl/ui/.../actions/handlers/XDebuggerMuteBreakpointsHandler.java:28-31`，
// 默认 false 在 `XDebugSessionData.java:25`），所以本仓的静音仍然只活在会话里 —— 这一条刻意不加进来。
//
// 存哪：按项目根存 localStorage（上游存项目状态文件）。本仓没有 `.idea/workspace.xml` 那条通道，
// 与监视表达式的持久化同一策略（`src/debugWatches.ts`）。

/** localStorage 的最小面（单测传假对象即可，不依赖 window）。 */
export interface BreakpointStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 逐断点属性的存储键前缀（按项目根分桶，见 `extrasKey`）。 */
export const BREAKPOINT_EXTRAS_KEY_PREFIX = 'taocode.breakpointExtras:'

/** 随项目走的逐断点属性。 */
export interface BreakpointExtrasState {
  /** 临时断点的 ref 集合（数组形态便于存）。 */
  temporary: string[]
  /** `dependentRef -> triggerRef`。 */
  dependencies: BreakpointDependencies
  /**
   * 逐断点的**属性表**（补 dbg/breakpoints 判词③「属性不随项目保存」那条）：
   * 上游把这些存进断点状态 —— 条件是 `XBreakpointProperties` 的表达式属性
   * （`XLightBreakpointPropertiesPanel.java:559-565` 的 `setConditionExpression` +
   * `setConditionEnabled`），命中次数/日志同面板的另外两格（`XBreakpointActionsPanel.java:39`/`:120`/`:234`）。
   * 本仓的 DAP 断点只在 native 里存**行号**（`native/dap.cpp` 的 `requested_lines(points)` 只取 line），
   * 所以文本与「条件启用位」由这张表随项目根存 localStorage。
   */
  properties: Record<string, BreakpointPropertiesState>
}

/** 一条断点存下来的属性。`condition` 是**文本**（哪怕启用位关着也要留着），其余同理。 */
export interface BreakpointPropertiesState {
  condition?: string
  hitCondition?: string
  logMessage?: string
  /** 上游的「Condition:」复选框（`XLightBreakpointPropertiesPanel.java:327`/`:562`）。 */
  conditionEnabled?: boolean
}

export function extrasKey(root: string): string {
  return `${BREAKPOINT_EXTRAS_KEY_PREFIX}${root.trim() || 'default'}`
}

/** 解析持久化数据：坏数据 → 空表；依赖两端都必须能解回 `path:line`，否则丢掉这一条。 */
export function parseBreakpointExtras(raw: string | null | undefined): BreakpointExtrasState {
  const empty: BreakpointExtrasState = { temporary: [], dependencies: {}, properties: {} }
  if (!raw) return empty
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return empty }
  if (!parsed || typeof parsed !== 'object') return empty
  const data = parsed as Partial<BreakpointExtrasState>
  const temporary: string[] = []
  for (const ref of Array.isArray(data.temporary) ? data.temporary : []) {
    if (typeof ref !== 'string' || !parseBreakpointRef(ref) || temporary.includes(ref)) continue
    temporary.push(ref)
  }
  const dependencies: BreakpointDependencies = {}
  for (const [dependent, trigger] of Object.entries(data.dependencies ?? {})) {
    if (typeof trigger !== 'string') continue
    if (!parseBreakpointRef(dependent) || !parseBreakpointRef(trigger)) continue
    dependencies[dependent] = trigger
  }
  // 老存盘里没有 properties 这一格 ⇒ 补空表（不是「数据损坏」）。
  const properties: Record<string, BreakpointPropertiesState> = {}
  for (const [ref, value] of Object.entries(data.properties ?? {})) {
    if (!parseBreakpointRef(ref) || !value || typeof value !== 'object') continue
    const entry = value as BreakpointPropertiesState
    const next: BreakpointPropertiesState = {}
    for (const key of ['condition', 'hitCondition', 'logMessage'] as const) {
      const text = entry[key]
      if (typeof text === 'string' && text.trim()) next[key] = text
    }
    if (entry.conditionEnabled === false) next.conditionEnabled = false
    if (Object.keys(next).length) properties[ref] = next
  }
  return { temporary, dependencies, properties }
}

export function loadBreakpointExtras(store: BreakpointStore | null | undefined, root: string): BreakpointExtrasState {
  let raw: string | null = null
  try { raw = store?.getItem(extrasKey(root)) ?? null } catch { raw = null }
  return parseBreakpointExtras(raw)
}

export function saveBreakpointExtras(store: BreakpointStore | null | undefined, root: string, state: BreakpointExtrasState): void {
  if (!store) return
  try {
    store.setItem(extrasKey(root), JSON.stringify({
      temporary: state.temporary, dependencies: state.dependencies, properties: state.properties ?? {},
    }))
  } catch { /* session-only */ }
}

/** 取一条断点存下来的属性（没有就是 undefined ⇒ 调用方按「以断点对象中那份为准」处理）。 */
export function propertiesForRef(table: Record<string, BreakpointPropertiesState> | undefined, ref: string): BreakpointPropertiesState | undefined {
  return table?.[ref]
}

/**
 * 写一条断点的属性（不可变：返回新表）。全空的条目从表里删掉 —— 表里留空条目等于
 * 「这条断点有过属性但都是空」，读回来会误导显示。
 */
export function setBreakpointProperties(
  table: Record<string, BreakpointPropertiesState>, ref: string, props: BreakpointPropertiesState,
): Record<string, BreakpointPropertiesState> {
  const next: BreakpointPropertiesState = {}
  for (const key of ['condition', 'hitCondition', 'logMessage'] as const) {
    const text = (props[key] ?? '').trim()
    if (text) next[key] = text
  }
  if (next.condition && props.conditionEnabled === false) next.conditionEnabled = false
  const copy = { ...table }
  if (Object.keys(next).length) copy[ref] = next
  else delete copy[ref]
  return copy
}

/**
 * 这次要发给适配器的一份断点：把存下来的属性并上去，并按上游的「条件启用位」扣掉条件
 * （`XLightBreakpointPropertiesPanel.java:559-565` —— 启用位关掉时表达式不再作用于会话，
 * 但文本仍是断点的属性，本仓留着它，重新勾选就恢复）。
 */
export function sendableBreakpoints<T extends DapBreakpoint & { logMessage?: string }>(
  path: string, points: readonly T[], table: Record<string, BreakpointPropertiesState>,
): T[] {
  return points.map(point => {
    const props = table[breakpointRef(path, point.line)]
    if (!props) return point
    const next: T = { ...point }
    if (!next.condition && props.condition) next.condition = props.condition
    if (!next.hitCondition && props.hitCondition) next.hitCondition = props.hitCondition
    if (!(next as { logMessage?: string }).logMessage && props.logMessage) {
      (next as { logMessage?: string }).logMessage = props.logMessage
    }
    if (props.conditionEnabled === false) delete next.condition
    return next
  })
}

/**
 * 断点属性里「有没有东西」的判据（芯片上的 ?/#/L 标记用；条件关掉时不再标 `?`）。
 * 上游的标记读的是**断点自己**的条件表达式：`XBreakpointUIUtil.kt:590-599`
 * （`withQuestionBadgeIfNeeded`：`isEmptyExpression(getConditionExpression())` 且没有自定义条件才不打问号角标），
 * tooltip 那份同理（`XBreakpointBase.java:515-538` 逐条列条件 / 日志消息 / 日志表达式）。
 * 本仓取文本时**属性表优先**：册子里那份是「这一轮真正发出去的」（条件停用位会把它扣掉，
 * 见上面 `sendableBreakpoints`），属性表才是用户敲进去的原文 —— 否则关掉启用位以后标记会凭空消失。
 */
export function breakpointMarkersOf(point: DapBreakpoint, table?: Record<string, BreakpointPropertiesState>, ref?: string): { condition: boolean; hit: boolean; log: boolean } {
  const props = ref ? table?.[ref] : undefined
  const conditionText = props?.condition ?? point.condition
  return {
    condition: Boolean(conditionText) && props?.conditionEnabled !== false,
    hit: Boolean(props?.hitCondition ?? point.hitCondition),
    log: Boolean(props?.logMessage ?? (point as { logMessage?: string }).logMessage),
  }
}
