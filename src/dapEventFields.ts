// DAP **事件字段**的解读规则（本轮补齐的协议缺口：`native/dap_shaping.cpp` 的 `shape_event`
// 把 `stopped.hitBreakpointIds`/`allThreadsStopped`/`preserveFocusHint`、`continued.threadId`、
// `output.line`/`column`/`path`/`group` 都原样透传给前端，前端这一半负责把它们变成界面动作）。
//
// 三件事，每件都有明确的上游语义：
//
//   · **`output` 的位置字段 → 「跳到输出位置」**。规范里 `OutputEvent` 的 `line`/`column` 是
//     **1 基**，`source.path` 是那条输出来自哪个源文件（例如编译器把 `file.cpp:12:3: error: …`
//     结构化地报出来，而不是塞进 text 里）。IDEA 的构建控制台把这种行做成可点的超链接
//     （`platform/lang-impl/.../BuildTreeConsoleView` 一族解析文本里的 `path:line`），
//     DAP 给了结构化字段时就不该再去正则文本 —— 本模块只做「字段 → 跳转目标」这一层，
//     目标的 0 基换算交给调用方（编辑器是 0 基，DAP 是 1 基）。
//
//   · **`stopped.hitBreakpointIds` → 断点命中高亮**。适配器直接给出命中的断点 id，
//     不用再拿「停在哪一行」去猜是哪一条（同一行可能有多条、断点也可能被适配器移动过）。
//     id 是**会话内**的句柄，与 `breakpoint` 事件和 `setBreakpoints` 回执里的 `id` 同一套
//     （`src/bridge.ts` 的 `dapBreakpointIds` 就是按它记的）。这里把 id 列表归一成字符串集合
//     （适配器给数字或字符串都合法），调用方拿去和断点行上的 id 比对。
//
//   · **`continued.threadId` → 线程状态**。规范里 `continued` 的 `threadId` 是
//     「继续执行的那个线程」；缺省（或 `allThreadsContinued`）表示不止一个线程在跑。
//     本仓 `dapState.paused` 是全局的一格，所以这条只用于「哪个线程在跑」的显示与
//     多线程视图的按线程更新，不擅自把整场会话从暂停态里放出来（那是 `continued` 事件本身
//     的语义，已经在 `src/bridge.ts:662` 处理过）。
//
// 纯函数、零宿主依赖，判据 tests/dap-event-fields.test.mjs。

/** DAP `OutputEvent` 的位置字段（`native/dap_shaping.cpp:99-102` 原样透传）。 */
export interface DapOutputLocation {
  /** 源文件路径（工作区相对；原生整形过）。没有它就没有可跳的位置。 */
  path?: string
  /** **1 基**行号（规范）。 */
  line?: number
  /** **1 基**列号（规范）。 */
  column?: number
  /** `group`（规范里给「同一条输出被拆成多行」分组用；本仓保留给调用方）。 */
  group?: string
}

/** 一个可跳转的位置（`line` 已换算成编辑器口径的 **0 基**）。 */
export interface DapJumpTarget {
  path: string
  /** 0 基行号（调用方直接给编辑器用）。 */
  line: number
  /** 1 基列号（没有就是 0 = 不指定）。 */
  column: number
}

/**
 * 从 `output` 事件的位置字段算出跳转目标；给不出就 `null`。
 *
 * 两条口径：
 *   · 没有 `path` 就没有目标 —— `line` 单独存在时不知道是哪个文件，猜当前文件是编造；
 *   · `line` 必须 ≥ 1（规范 1 基）：0/负数/非整数一律当没给，不把一条错误输出跳到文件开头。
 */
export function outputJumpTarget(location: DapOutputLocation | undefined): DapJumpTarget | null {
  const path = typeof location?.path === 'string' ? location.path : ''
  if (!path) return null
  const raw = location?.line
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) return null
  const line = Math.trunc(raw) - 1
  const column = typeof location?.column === 'number' && Number.isFinite(location.column) && location.column > 0
    ? Math.trunc(location.column) : 0
  return { path, line, column }
}

/** 这条输出能不能点（有位置就能跳）。 */
export function outputJumpable(location: DapOutputLocation | undefined): boolean {
  return outputJumpTarget(location) !== null
}

/**
 * 断点 id 的归一：适配器可以给数字或字符串（规范 `integer | string`）。
 * 空串/非有限数/`null` 一律丢弃（认不出的 id 不能拿去比对，否则会误高亮）。
 */
export function breakpointIdKey(id: unknown): string | null {
  if (typeof id === 'number') return Number.isFinite(id) ? String(Math.trunc(id)) : null
  if (typeof id === 'string') return id ? id : null
  return null
}

/** 把 `stopped.hitBreakpointIds` 归一成一个可查的集合（顺序无关，重复只留一份）。 */
export function hitBreakpointIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const keys: string[] = []
  for (const entry of raw) {
    const key = breakpointIdKey(entry)
    if (!key || seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }
  return keys
}

/** 这次停命中过某个断点吗（适配器给了 id 才判定；没给就是 `false`，不猜）。 */
export function stoppedOnBreakpointIds(raw: unknown): boolean {
  return hitBreakpointIds(raw).length > 0
}

/**
 * `stopped` 事件里与「怎么显示这次停」有关的可选字段。
 * `preserveFocusHint` = 适配器请求**别抢焦点**（命中日志断点时不该把编辑器拽走）。
 */
export interface DapStoppedFlags {
  /** 命中的断点 id（已归一）。 */
  hits: string[]
  /** 规范：所有线程都停了吗（多线程视图据此把其余线程标灰）。没报 = `null`（不知道，不猜）。 */
  allThreadsStopped: boolean | null
  /** 适配器请求不抢焦点（没报 = `false`）。 */
  preserveFocusHint: boolean
}

/** 解读 `stopped` 的三个可选字段（`src/bridge.ts:241` 的 DapEvent 已登记它们）。 */
export function stoppedFlags(event: { hitBreakpointIds?: unknown; allThreadsStopped?: unknown; preserveFocusHint?: unknown } | undefined): DapStoppedFlags {
  return {
    hits: hitBreakpointIds(event?.hitBreakpointIds),
    allThreadsStopped: typeof event?.allThreadsStopped === 'boolean' ? event.allThreadsStopped : null,
    preserveFocusHint: event?.preserveFocusHint === true,
  }
}

/**
 * `continued` 事件 → 「哪个线程在跑」。
 *
 * 规范里 `threadId` 是继续执行的那个线程；**没给**（或 `allThreadsContinued === true`）
 * 表示不止一个线程 —— 此时 `threadId` 为 `null`、`allThreads` 为真，调用方据此
 * 不要单独更新某一个线程的状态（那会造出"只有一个线程在跑"的假象）。
 */
export interface DapContinuedState {
  threadId: number | null
  /** 全部线程都在继续（`allThreadsContinued`，或没有具体 threadId）。 */
  allThreads: boolean
}

export function continuedThreadState(event: { threadId?: unknown; allThreadsContinued?: unknown } | undefined): DapContinuedState {
  const raw = event?.threadId
  const threadId = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : null
  const all = event?.allThreadsContinued === true || threadId === null
  return { threadId, allThreads: all }
}