// 调试器的「数据视图」选项 + 变量树展开（IDEA `XDebuggerDataViewSettings` 的等价物）。
//
// 上游：`XDebuggerDataViewSettings`（`platform/xdebugger-impl/.../settings/`）是应用级
// PersistentStateComponent，Variables 视图按它的开关渲染 —— 本仓落两格有真实消费点的：
//   · 隐藏 null：值为 null 的元素/字段不显示（`isHideNullElements` 一族）；
//   · 排序：变量按名字排列（`isSortValues`；数组元素保持索引序，索引本身就是它的名字）。
// 开关从「设置 › 构建、执行、部署 › 调试器」来（`src/components/DebuggerSettingsPage.vue`），
// 经 general settings 落盘（与 ConsoleConfigurable 的折叠规则同一存储策略，见 native/settings_schema.cpp）。
//
// 变量树的展开逻辑也在这里：`DebugPanel.vue` 贴着机检上限，把它挪出来既让「每层孩子怎么过滤/
// 排序」可单测，也让面板只剩模板与 DAP 调用。`tests/debug-frame-context.test.mjs` 会用真实模块
// 驱动面板的 `varRows`。
import type { DapScope, DapVariable } from './bridge'

export interface DebugDataViewOptions {
  hideNullValues: boolean
  sortByName: boolean
  /**
   * 按类型分组（本轮补，上游 `XValueGroup`/`XValueGroupNodeImpl`：值容器可以把自己的孩子
   * 组织成组节点）。本仓没有每值容器自定义分组的能力 —— DAP 只有扁平 `variables` ——
   * 所以这里落的是**用户开关**：把同一层里 `type` 非空的兄弟变量聚成「类型名（n 项）」组，
   * 没报类型的变量留在组外。组的展开状态与普通行同一份 `open`。
   */
  groupByType?: boolean
  /**
   * 「按数组显示」的容器 reference 集合（本轮补）。DAP 的变量有 `named` 标志区分数组元素，
   * 但有些适配器只报数字名字（"0"/"1"…）而不打 `named:false`；把这个开关作用在容器上，
   * 它的孩子一律按 `[i]` 呈现（`canViewAsArray` 先判定孩子确实是索引形态）。
   */
  arrayViews?: readonly number[]
  /** 调用堆栈里是否显示 `presentationHint: 'subtle'` 的库帧（上游 `isShowLibraryStackFrames`）。 */
  showLibraryFrames?: boolean
  /** 在编辑器执行行行尾渲染变量值（上游 `XDebuggerDataViewSettings.showValuesInline`）。 */
  showValuesInline?: boolean
  /** 移除断点前确认（上游 `XDebuggerGeneralSettings.isConfirmBreakpointRemoval`）。 */
  confirmBreakpointRemoval?: boolean
  /** 停在断点时自动取消断点静音（上游 `isUnmuteOnStop`）。 */
  unmuteOnStop?: boolean
  /** 求值对话框形态（上游 `XDebuggerGeneralSettings.getEvaluationDialogMode`）。 */
  evaluationMode?: 'expression' | 'codeFragment'
}

export const DEFAULT_DEBUG_DATA_VIEW: DebugDataViewOptions = { hideNullValues: false, sortByName: false }

/** 值文本看起来是不是 null（DAP 适配器们各写各的：cppvsdbg `nullptr`、Python `None`…）。 */
const NULL_WORDS = new Set(['null', 'nullptr', 'nil', 'none', 'undefined'])
export function isNullValueText(value: string): boolean {
  return NULL_WORDS.has(value.trim().toLowerCase())
}

/** 面板渲染的一行（从 DebugPanel.vue 原样搬出，字段语义不变）。 */
export interface VarRow {
  key: string
  name: string
  value: string
  type: string
  depth: number
  expandable: boolean
  expanded: boolean
  reference: number
  state: 'value' | 'empty' | 'unloaded'
  /** 该变量的**容器** reference —— `setVariable` 要的是容器，不是变量自己的 reference。 */
  container: number
  /** 适配器给的变量名（数组元素是 "0"、"1"…，显示用的是 `[0]`）。 */
  apiName: string
  /** 适配器给的「能求值出这个变量」的表达式（`evaluateName`）—— 加监视/控制台求值用它。 */
  evaluateName?: string
  /** true = 「按类型分组」合成出来的组行（不是变量，不可改值/复制值）。 */
  group?: boolean
}

/** 「按数组显示」的判定：孩子全是索引名（`named === false` 或名字是十进制整数）。 */
export function parseArrayIndex(name: string): number | null {
  if (!/^\d+$/.test(name.trim())) return null
  const index = Number(name)
  return Number.isSafeInteger(index) ? index : null
}

export function canViewAsArray(children: readonly DapVariable[]): boolean {
  return children.length > 0 && children.every(child => child.named === false || parseArrayIndex(child.name) !== null)
}

export interface VisibleChild { variable: DapVariable; index: number }

/**
 * 一层孩子在视图里的顺序与可见性。`index` 是**原始下标**：数组元素可能被隐藏，
 * 显示名 `[i]` 必须还是它真实的索引（IDEA 的数组节点同样保留原索引）。
 */
export function visibleChildren(children: readonly DapVariable[], options: DebugDataViewOptions): VisibleChild[] {
  const visible: VisibleChild[] = []
  children.forEach((variable, index) => {
    if (options.hideNullValues && variable.reference <= 0 && isNullValueText(variable.value)) return
    visible.push({ variable, index })
  })
  if (!options.sortByName) return visible
  // 数组元素（named === false）按索引序保持在后面；命名变量按名字排。
  const named = visible.filter(entry => entry.variable.named !== false)
  const indexical = visible.filter(entry => entry.variable.named === false)
  named.sort((a, b) => a.variable.name.localeCompare(b.variable.name))
  return [...named, ...indexical]
}

const MAX_DEPTH = 12

function pushChildRow(
  child: DapVariable, index: number, depth: number, prefix: string, rows: VarRow[],
  container: number, open: Record<string, boolean>, forceIndex: boolean,
) {
  const expandable = child.reference > 0
  const key = `${prefix}${index}`
  const expanded = expandable && open[key] === true
  const indexical = forceIndex || child.named === false
  rows.push({
    key, name: indexical ? `[${index}]` : child.name, value: child.value, type: child.type ?? '',
    depth, expandable, expanded, reference: child.reference, state: 'value',
    container, apiName: child.name, evaluateName: child.evaluateName,
  })
  return { child, key, expanded }
}

function walk(
  reference: number, depth: number, prefix: string, rows: VarRow[], seen: number[],
  values: Record<number, DapVariable[]>, open: Record<string, boolean>, options: DebugDataViewOptions,
) {
  const children = values[reference]
  if (!children) {
    rows.push({ key: `${prefix}?`, name: '读取中…', value: '', type: '', depth, expandable: false, expanded: false, reference, state: 'unloaded', container: reference, apiName: '' })
    return
  }
  if (!children.length) {
    rows.push({ key: `${prefix}-`, name: '空', value: '', type: '', depth, expandable: false, expanded: false, reference, state: 'empty', container: reference, apiName: '' })
    return
  }
  // A self-referential object would otherwise recurse forever on expansion.
  if (seen.includes(reference) || depth > MAX_DEPTH) {
    rows.push({ key: `${prefix}=`, name: depth > MAX_DEPTH ? '层级过深，已停止展开' : '（循环引用）', value: '', type: '', depth, expandable: false, expanded: false, reference, state: 'empty', container: reference, apiName: '' })
    return
  }
  const arrayMode = options.arrayViews?.includes(reference) === true
  const visible = visibleChildren(children, options)
  if (options.groupByType && !arrayMode) {
    // 同一层里 type 非空的兄弟聚成组（组内保持原顺序）；没报类型的留在组外。
    const groups: Array<{ type: string; entries: VisibleChild[] }> = []
    const indexOf = new Map<string, number>()
    const ungrouped: VisibleChild[] = []
    for (const entry of visible) {
      const type = (entry.variable.type ?? '').trim()
      if (!type) { ungrouped.push(entry); continue }
      let at = indexOf.get(type)
      if (at === undefined) { at = groups.length; indexOf.set(type, at); groups.push({ type, entries: [] }) }
      groups[at]!.entries.push(entry)
    }
    for (const group of groups) {
      const key = `${prefix}g|${group.type}`
      const expanded = open[key] === true
      rows.push({
        key, name: group.type, value: `${group.entries.length} 项`, type: '', depth, expandable: true,
        expanded, reference: 0, state: 'value', container: reference, apiName: '', group: true,
      })
      if (!expanded) continue
      for (const entry of group.entries) {
        const row = pushChildRow(entry.variable, entry.index, depth + 1, `${key}-`, rows, reference, open, false)
        if (row.expanded) walk(row.child.reference, depth + 2, `${row.key}-`, rows, [...seen, reference], values, open, options)
      }
    }
    for (const entry of ungrouped) {
      const row = pushChildRow(entry.variable, entry.index, depth, prefix, rows, reference, open, false)
      if (row.expanded) walk(row.child.reference, depth + 1, `${row.key}-`, rows, [...seen, reference], values, open, options)
    }
    return
  }
  for (const { variable: child, index } of visible) {
    const row = pushChildRow(child, index, depth, prefix, rows, reference, open, arrayMode)
    if (row.expanded) walk(child.reference, depth + 1, `${row.key}-`, rows, [...seen, reference], values, open, options)
  }
}

/** 把作用域树摊平成面板要渲染的行（每层按数据视图选项过滤/排序）。 */
export function collectVarRows(
  scopes: readonly DapScope[],
  values: Record<number, DapVariable[]>,
  open: Record<string, boolean>,
  options: DebugDataViewOptions = DEFAULT_DEBUG_DATA_VIEW,
): VarRow[] {
  const rows: VarRow[] = []
  scopes.forEach((scope, index) => {
    const key = `s${index}`
    const expanded = open[key] === true
    rows.push({ key, name: scope.name, value: '', type: scope.expensive ? '按需' : '', depth: 0, expandable: true, expanded, reference: scope.reference, state: 'value', container: scope.reference, apiName: scope.name })
    if (expanded) walk(scope.reference, 1, `${key}-`, rows, [], values, open, options)
  })
  return rows
}

/** 单个 reference 的子树（求值结果浏览器用；与作用域共用同一套展开/选项规则）。 */
export function collectReferenceRows(
  reference: number,
  values: Record<number, DapVariable[]>,
  open: Record<string, boolean>,
  options: DebugDataViewOptions = DEFAULT_DEBUG_DATA_VIEW,
): VarRow[] {
  const rows: VarRow[] = []
  walk(reference, 1, 'eval-', rows, [], values, open, options)
  return rows
}

/**
 * 调用堆栈的可见帧（上游 `XDebuggerDataViewSettings.isShowLibraryStackFrames`）。
 * 「库帧」用适配器自己的信号判定：DAP `StackFrame.presentationHint === 'subtle'`
 * （规范里就是「比普通帧更弱、通常是运行时/库代码」），不按路径猜。
 * 当前选中的那一帧永远保留 —— 否则用户看不到自己正在看的作用域属于谁。
 */
export function visibleFrames<T extends { presentationHint?: string }>(
  frames: readonly T[], showLibraryFrames: boolean, selectedIndex = 0,
): T[] {
  if (showLibraryFrames) return [...frames]
  return frames.filter((frame, index) => index === selectedIndex || frame.presentationHint !== 'subtle')
}
