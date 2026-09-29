// DAP `breakpointLocations` —— IDEA 的 `XLineBreakpointType.canPutAt(file, line, project)`
// （`platform/xdebugger-api/src/com/intellij/xdebugger/breakpoints/XLineBreakpointType.java:50-52`，
// 默认实现返回 false）。
//
// IDEA 那边有两条用户可见规则，都搬到这里：
//   1. `XDebuggerUtilImpl.java:111-121` 的 `getBreakpointTypeByPosition`：遍历所有行断点类型，
//      `canPutAt` 为真且 **priority 最高**者胜出；**一个都没有就拒绝放断点**并报
//      "Cannot find appropriate breakpoint type"（`toggleAndReturnLineBreakpoint` 返回 rejected）。
//   2. `XDebuggerUtilImpl.java:134-136` 的 `canPutBreakpointAt`：任一类型说能放就是能放 ——
//      DAP 的对应物就是"适配器回了至少一个位置"。
//
// 与 IDEA 的关键差别：`canPutAt` 在 IDEA 里是**同步**的本地判定（语言插件知道哪行有代码），
// DAP 的 `breakpointLocations` 是**异步往返**，而且只有适配器活着、且声明了
// `supportsBreakpointLocationsRequest` 才问得到答案。所以这里把"问不到"和"这行不能放"
// 严格分开：前者跳过校验（不因为服务器不支持就把功能禁掉），后者按 IDEA 的做法拒绝。

/** DAP `BreakpointLocation`。 */
export interface DapBreakpointLocation {
  line: number
  column?: number
  endLine?: number
  endColumn?: number
}

/** 原生层整形后的响应（`native/dap.cpp` 的 `shape_breakpoint_locations`）。 */
export interface DapBreakpointLocations {
  available: boolean
  /** **空数组是有意义的答案**（= 这一行没有可放置位置），不是错误。 */
  locations?: DapBreakpointLocation[]
}

/**
 * IDEA `canPutBreakpointAt`（`XDebuggerUtilImpl.java:134-136`）的 DAP 版：
 * 适配器回了至少一个位置才算"这一行能放断点"。
 */
export function canPlaceBreakpoint(locations: DapBreakpointLocation[] | undefined): boolean {
  return (locations?.length ?? 0) > 0
}

/** gutter 上的文案。IDEA 的 tooltip 语义：能放就说能放，不能放就说为什么。 */
export function describeBreakpointPlacement(locations: DapBreakpointLocation[] | undefined, line: number): string {
  const count = locations?.length ?? 0
  if (count === 0) return `第 ${line} 行没有可放置断点的位置`
  if (count === 1) return `第 ${line} 行可以放置断点`
  return `第 ${line} 行有 ${count} 个可放置断点的位置`
}

/**
 * 「这一行能不能放断点」的答案缓存。
 *
 * 为什么必须有：gutter 点击与悬停都会问同一行，而 DAP 是异步往返 —— 没有缓存会打出一串
 * 一模一样的请求；而且**空结果也必须缓存**，否则在一行上没有可放置位置时会反复往返。
 *
 * 失效策略：**编辑过就整体清空**（调用方在文档变更时 `clear()`）。行号到位置的映射依赖
 * 代码内容，一旦改过行号就可能错位，逐条淘汰没有意义（`setVersion` 那类按版本号失效
 * 需要一个真的随每次编辑递增的版本，比直接清空更容易出错）。
 */
export class BreakpointLocationCache {
  private readonly entries = new Map<string, DapBreakpointLocation[]>()
  // 注意：这里**不能**写 `constructor(private readonly limit = 256)` —— 参数属性是 TS 的
  // 类型扩展语法，Node 22 直跑 .ts 时用的是 strip-only 模式，遇到它会直接
  // `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`（测试就是被这一行挡住的）。显式字段即可。
  private readonly limit: number

  constructor(limit = 256) {
    this.limit = limit
  }

  get(path: string, line: number): DapBreakpointLocation[] | undefined {
    return this.entries.get(`${path}:${line}`)
  }

  put(path: string, line: number, locations: DapBreakpointLocation[]) {
    // 简单上限：不追 LRU（命中率本来就不高），满了整体清空更省事也更好推理。
    if (this.entries.size >= this.limit) this.entries.clear()
    this.entries.set(`${path}:${line}`, locations)
  }

  clear() { this.entries.clear() }
  get size() { return this.entries.size }
}

/**
 * 一次查询的答案。
 * `checked:false` 表示**没问到**（没有会话 / 适配器没声明这个能力 / 请求失败）——
 * 调用方必须跳过校验，而不是当成"不能放"。
 */
export interface PlacementAnswer {
  checked: boolean
  canPlace: boolean
  locations: DapBreakpointLocation[]
  message: string
}

/** 返回 `null` 表示"问不到"（与"这一行不能放"是两件事）。 */
export type PlacementQuery = (path: string, line: number) => Promise<DapBreakpointLocation[] | null>

const NOT_CHECKED: PlacementAnswer = { checked: false, canPlace: false, locations: [], message: '' }

/**
 * 记忆化的一次判定：命中缓存直接用，否则发一次请求并把结果（**含空结果**）缓存。
 * 缓存命中与未命中返回同一个形状，调用方不需要区分。
 */
export async function breakpointPlacement(
  path: string,
  line: number,
  cache: BreakpointLocationCache,
  query: PlacementQuery,
): Promise<PlacementAnswer> {
  if (!path || line <= 0) return NOT_CHECKED
  let locations = cache.get(path, line)
  if (locations === undefined) {
    const answer = await query(path, line)
    // `null` 不进缓存：那是一次失败（没会话/没声明），下次会话起来了应该重新问。
    if (answer === null) return NOT_CHECKED
    cache.put(path, line, answer)
    locations = answer
  }
  return { checked: true, canPlace: canPlaceBreakpoint(locations), locations, message: describeBreakpointPlacement(locations, line) }
}
