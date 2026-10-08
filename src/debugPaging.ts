// DAP 的**分页**规则（`stackTrace` 的 `startFrame`/`levels`、`variables` 的 `start`/`count`）。
//
// 为什么单独成模块：分页是"取数怎么切"这一件事，而 `native/dap_values.cpp` 已经把协议面
// 补齐（`Client::stack_trace(thread, start_frame, levels, cb)` 与
// `Client::variables(reference, start, count, cb)`，<=0 的字段**不发**——省略 = 不指定，
// 与"第 0 帧/要 0 条"是两回事）。前端这一半只剩纯规则：一页参数怎么成形、适配器报的
// `namedVariables`/`indexedVariables` 怎么变成"还有多少没取"、下一页从哪开始。
//
// 本模块**不 import bridge 的值**（只用 type-only），所以 DebugPanel.vue 贴着上限时
// 从 `src/debugDataView.ts` 引它不会把整条桥接链拉进树摊平那条热路径；真正发请求的
// 封装在 `src/dapRequests.ts`（那一份才 import bridge 的 `request`）。
//
// 判据 tests/debug-paging.test.mjs。

/** 一页变量默认取多少项（大数组/集合一次一页；适配器没报总数时按它切）。 */
export const DEFAULT_VARIABLE_PAGE = 100

/** 调用栈一页默认取多少帧（栈通常不深，但递归爆栈时上百帧会拖慢每次停机）。 */
export const DEFAULT_STACK_PAGE = 20

/** 调用栈的一页（`startFrame` 0 基、`levels` 条数）。 */
export interface StackPage {
  startFrame: number
  levels: number
}

/** 变量的一页（`start` 0 基、`count` 条数）。 */
export interface VariablePage {
  start: number
  count: number
}

/** 一页调用栈 → 桥上参数。**<=0 或非有限数的字段不发**（与 native 同一条口径：省略 = 不指定）。 */
export function stackTracePageParams(page?: Partial<StackPage>): { startFrame?: number; levels?: number } {
  const params: { startFrame?: number; levels?: number } = {}
  if (page && Number.isFinite(page.startFrame) && (page.startFrame as number) > 0) params.startFrame = Math.trunc(page.startFrame as number)
  if (page && Number.isFinite(page.levels) && (page.levels as number) > 0) params.levels = Math.trunc(page.levels as number)
  return params
}

/** 一页变量 → 桥上参数（同上：`start`/`count` <= 0 或非有限数不发）。 */
export function variablePageParams(page?: Partial<VariablePage>): { start?: number; count?: number } {
  const params: { start?: number; count?: number } = {}
  if (page && Number.isFinite(page.start) && (page.start as number) > 0) params.start = Math.trunc(page.start as number)
  if (page && Number.isFinite(page.count) && (page.count as number) > 0) params.count = Math.trunc(page.count as number)
  return params
}

/**
 * 适配器在一个容器上声明的子项规模。DAP 里这两个字段都是**可选**：适配器不报时
 * 无法知道总量，只能按"取回来多少"处理 —— 所以 `paged` 是"有总数可依"而不是"支持分页"。
 */
export interface VariablePageInfo {
  /** 具名子项数（`namedVariables`；没报是 0）。 */
  named: number
  /** 下标子项数（`indexedVariables`；没报是 0）。 */
  indexed: number
  /** 两个字段的合计（适配器没报任何一个是 0）。 */
  total: number
  /** 有总数可依（`total > 0`）⇒ 调用方可以据此决定要不要取下一页。 */
  paged: boolean
}

/** 从一个容器（变量/求值结果）读出分页规模。非整数/负数一律当没报（不编造总量）。 */
export function variablePageInfo(
  container: { namedVariables?: number; indexedVariables?: number } | undefined,
): VariablePageInfo {
  const count = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
  const named = count(container?.namedVariables)
  const indexed = count(container?.indexedVariables)
  const total = named + indexed
  return { named, indexed, total, paged: total > 0 }
}

/**
 * 下一页的参数；已经取完（或适配器没报总数）时 `null` ——
 * 返回 `{start: loaded, count: pageSize}`，`start` 是**已加载条数**（0 基下标正好接上）。
 */
export function nextVariablePage(loaded: number, info: VariablePageInfo, pageSize = DEFAULT_VARIABLE_PAGE): VariablePage | null {
  const already = Number.isFinite(loaded) && loaded > 0 ? Math.trunc(loaded) : 0
  if (!info.paged || already >= info.total) return null
  const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.trunc(pageSize) : DEFAULT_VARIABLE_PAGE
  return { start: already, count: Math.min(size, info.total - already) }
}

/** 还有多少子项没取回（适配器没报总数时是 0 —— 不知道就不说"还有"）。 */
export function remainingVariableChildren(loaded: number, info: VariablePageInfo): number {
  if (!info.paged) return 0
  const already = Number.isFinite(loaded) && loaded > 0 ? Math.trunc(loaded) : 0
  return Math.max(0, info.total - already)
}

/** 有没有下一页可取（`remainingVariableChildren > 0`）。 */
export function hasMoreVariableChildren(loaded: number, info: VariablePageInfo): boolean {
  return remainingVariableChildren(loaded, info) > 0
}

// ── 求值结果的展开（item 2）─────────────────────────────────────────────────────
//
// `native/dap_values.cpp` 的 `shape_evaluate` 把 `evaluate` 的回参整形成
// `{result, type?, reference, variablesReference, named, namedVariables?, indexedVariables?}`
// —— `reference` 与 `variablesReference` 是同一个值（规范里 evaluate 只给后者），
// 原生两个键都发是为了让前端"用同一套渲染"。于是前端这一半只剩两条规则：
//   · 用哪个键当展开句柄（`reference` 优先，缺了退回 `variablesReference`）；
//   · 能不能展开（句柄 > 0，与 `DebugPanel` 既有的 `variablesReference > 0` 同义）。

/** 求值结果（`dap.evaluate`）里与展开/分页有关的那几个字段。 */
export interface EvaluateResultShape {
  result?: string
  type?: string
  reference?: number
  variablesReference?: number
  named?: boolean
  namedVariables?: number
  indexedVariables?: number
}

/** 展开句柄：`reference` 优先，缺了退回 `variablesReference`；两者都缺是 0（不可展开）。 */
export function evaluateResultReference(result: EvaluateResultShape | null | undefined): number {
  const pick = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
  return pick(result?.reference) || pick(result?.variablesReference)
}

/** 这个求值结果能不能展开成一棵树（IDEA 的 ShowAsObject 那一格）。 */
export function evaluateResultExpandable(result: EvaluateResultShape | null | undefined): boolean {
  return evaluateResultReference(result) > 0
}

/**
 * 求值结果的分页规模。求值结果**通常不报** `namedVariables`/`indexedVariables`
 * （适配器只在变量节点上报），此时 `paged` 为假 —— 展开后按"取回多少算多少"处理，
 * 不假装知道还有多少。展开成树之后子节点自己的 `variables` 才带这两个字段。
 */
export function evaluateResultPageInfo(result: EvaluateResultShape | undefined): VariablePageInfo {
  return variablePageInfo(result)
}

/**
 * 把新取回的一页并进已加载的孩子列表。
 *
 * `start === 0` 是**整份替换**（第一页/重取）；`start > 0` 是续页，按 0 基下标追加 ——
 * 已经加载过的区间**不覆盖**（适配器在两页之间改了容器内容时，宁可保留先到的那一份，
 * 也不让后到的一页把前面的行搬走）。
 */
export function mergeVariablePage<T>(
  existing: readonly T[] | undefined,
  page: VariablePage,
  incoming: readonly T[],
): T[] {
  const start = typeof page.start === 'number' && page.start > 0 ? Math.trunc(page.start) : 0
  const base = existing ? [...existing] : []
  if (start === 0) return [...incoming]
  for (let index = 0; index < incoming.length; index += 1) {
    const at = start + index
    if (at < base.length) continue
    base[at] = incoming[index] as T
  }
  return base
}