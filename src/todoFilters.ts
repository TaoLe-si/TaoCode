// TODO 的**命名过滤器**（`pv/todo` 族）—— 上游 `TodoFilter`
// （`platform/indexing-impl/src/com/intellij/ide/todo/TodoFilter.java:14`）+ 它的宿主表
// `TodoConfiguration`（`platform/editor-ui-ex/src/com/intellij/ide/todo/TodoConfiguration.java:50`
// `private TodoFilter[] myTodoFilters`、`:134` 读、`:149` 写）/ `SetTodoFilterAction` /
// `FilterDialog`（`platform/todo/src/com/intellij/ide/todo/configurable/FilterDialog.java:27`）/
// `FiltersTableModel`（同目录 `FiltersTableModel.java:13`）的等价物。
// （2026-10-06 订正：这里原先写的 `TodoFilterSettings` 在基准树里**没有这个类**——
//   过滤器表就挂在应用级的 `TodoConfiguration` 上，见下面的存储段。）
//
// 上游语义：过滤器 = 一个名字 + 一组**标记模式**（`TodoFilter.getPatterns()` 引用
// `TodoPattern` 表里的条目）；TODO 工具窗口的过滤器下拉里选中一个过滤器后，只留下
// 「本条文本命中的模式属于该过滤器的模式集」的条目（`TodoTreeBuilder` 用
// `TodoFilter.findPattern` 判定）；`<All>`（不选过滤器）不过滤。
//
// 上游还有一个「有 TODO 差异」的开关（`TodoFilter.isFilterByVCS`），那是变更列表维度，
// 本仓没有变更列表联动，登记不搬。
//
// 存储沿用应用级用户数据的口径（与 `src/analysisIgnore.ts` 同族）：`localStorage`，
// 因为上游的过滤器表就挂在**应用级**服务上 —— `TodoConfiguration.java:29` 的
// `@State(name = "TodoConfiguration")` 与 `:38` 的
// `ApplicationManager.getApplication().getService(TodoConfiguration.class)`。
import { ref } from 'vue'
import { matchingTodoPattern, type TodoPatternView } from './todoView.ts'

const FILTERS_KEY = 'taocode.todoFilters'

/** 过滤器数量上限（与 TODO 模式表的存储上限同一策略）。 */
export const MAX_TODO_FILTERS = 20
/** 过滤器名字长度上限（够用即可，不透传上游的对话框校验细节）。 */
export const TODO_FILTER_NAME_MAX = 60

export interface TodoFilterRule {
  name: string
  /** 属于这个过滤器的标记模式文本（必须都在模式表里）。 */
  patterns: string[]
}

function readStored(): TodoFilterRule[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(FILTERS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(item => item && typeof item === 'object' && typeof item.name === 'string' && Array.isArray(item.patterns))
      .map(item => ({ name: item.name, patterns: item.patterns.filter((pattern: unknown) => typeof pattern === 'string') }))
  } catch {
    return []
  }
}

function writeStored(value: TodoFilterRule[]) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(FILTERS_KEY, JSON.stringify(value))
  } catch {
    // 存储不可用时只影响持久化，当前会话内选中的过滤器照常生效。
  }
}

/** 已保存的命名过滤器（应用级）。 */
export const todoFilters = ref<TodoFilterRule[]>(readStored())

/** 第一条不合法项的中文说明；全部合法时返回 null。`patterns` 是当前模式表（交叉校验用）。 */
export function validateTodoFilters(filters: readonly TodoFilterRule[], patterns: readonly TodoPatternView[]): string | null {
  if (!Array.isArray(filters)) return 'TODO 过滤器必须是数组。'
  if (filters.length > MAX_TODO_FILTERS) return `TODO 过滤器最多 ${MAX_TODO_FILTERS} 条。`
  const known = new Set(patterns.map(pattern => pattern.pattern))
  const seen = new Set<string>()
  for (const filter of filters) {
    if (!filter || typeof filter !== 'object') return '每条过滤器要写成 {name, patterns}。'
    if (typeof filter.name !== 'string' || !filter.name.trim()) return '过滤器名字不能为空。'
    if (filter.name.length > TODO_FILTER_NAME_MAX) return `过滤器名字不能超过 ${TODO_FILTER_NAME_MAX} 个字符。`
    if (!Array.isArray(filter.patterns)) return '过滤器的模式列表必须是数组。'
    for (const pattern of filter.patterns) {
      if (typeof pattern !== 'string' || !pattern.trim()) return '过滤器里的模式文字不能为空。'
      if (!known.has(pattern)) return `过滤器 ${filter.name} 引用了不存在的标记：${pattern}`
    }
    if (seen.has(filter.name)) return `过滤器名字重复：${filter.name}`
    seen.add(filter.name)
  }
  return null
}

/** 覆盖保存；返回第一条错误（成功时 null）。 */
export function saveTodoFilters(filters: TodoFilterRule[], patterns: readonly TodoPatternView[]): string | null {
  const problem = validateTodoFilters(filters, patterns)
  if (problem) return problem
  todoFilters.value = filters.map(filter => ({ name: filter.name.trim(), patterns: [...filter.patterns] }))
  writeStored(todoFilters.value)
  return null
}

/** 清空（测试与「还原」用）。 */
export function clearTodoFilters() {
  todoFilters.value = []
  writeStored([])
}

/**
 * 按命名过滤器裁剪条目：不选（空名字）或找不到同名过滤器时不过滤；
 * 条目命中的模式属于过滤器的模式集才留下（上游 `TodoFilter.findPattern` 的首条命中语义）。
 */
export function filterTodoItems<T extends { text: string }>(
  items: readonly T[], filterName: string, filters: readonly TodoFilterRule[], patterns: readonly TodoPatternView[],
): T[] {
  if (!filterName) return [...items]
  const filter = filters.find(rule => rule.name === filterName)
  if (!filter) return [...items]
  const allowed = new Set(filter.patterns)
  return items.filter(item => {
    const matched = matchingTodoPattern(item.text, patterns)
    return matched !== undefined && allowed.has(matched.pattern)
  })
}
