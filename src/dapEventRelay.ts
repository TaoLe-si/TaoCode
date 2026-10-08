// DAP **事件原文的二次监听**：`src/bridge.ts` 的 `applyDapEvent` 只把每个事件里"状态机要用的
// 那几格"收进 `dapState`/`dapConsole`，剩下的字段（`output` 的 `path`/`line`/`column`、
// `stopped` 的 `hitBreakpointIds`/`allThreadsStopped`/`preserveFocusHint`、`breakpoint` 的 id）
// 就地丢掉了。桥接层已冻结，所以这里用**同一事件的第二个监听者**把原文读一遍，只做纯解读
// （规则在 `src/dapEventFields.ts`），不碰状态机：
//
//   · `output.path/line/column` → 控制台那一行**可跳到源位置**（`outputJumpTarget`）；
//   · `stopped.hitBreakpointIds` → 命中的断点 id；`breakpoint` 事件累积 id → 文件:行，
//     于是"哪些断点这一停命中了"变成可查的 `hitLocations`（断点芯片据此高亮）；
//   · `stopped.preserveFocusHint` / `allThreadsStopped` 也一并留在这里（多线程视图与
//     窗口策略的判据来源，见 src/debugWindowPolicy.ts）。
//
// 监听顺序：本模块 import 了 `dapConsole`，所以 bridge 的模块体（注册它那个 listener）先执行，
// 本模块的 listener 后注册 —— 事件按注册顺序派发，于是 `output` 事件到达这里时
// `dapConsole` 已经多了一行，`dapConsole.length - 1` 就是这一行。
//
// 纯逻辑（`relayDapEvent`）不依赖宿主，判据 tests/dap-event-relay.test.mjs。
import { reactive } from 'vue'
import { dapConsole } from './bridge'
import { outputJumpable, outputJumpTarget, stoppedFlags, type DapJumpTarget } from './dapEventFields.ts'

/** 一条输出行对应的工作区位置（`dapConsole` 的下标 + 已换算成 0 基的跳转目标）。 */
export interface RelayOutput {
  /** `dapConsole` 里的行下标（bridge 先 push、本模块后看，所以取 length-1）。 */
  index: number
  location: DapJumpTarget
}

export const dapEventRelay = reactive<{
  version: number
  /**
   * 带可跳位置的输出行：`dapConsole` 下标 → 跳转目标（0 基行）。**只留有位置的**，
   * 没有位置的行不记（不画假链接）。下标会随 `dapConsole` 的截断（4000 行）漂移，
   * 但那是极长构建输出才发生，且只影响已滚出视野的旧行。
   */
  outputs: Record<number, DapJumpTarget>
  /** 最后一条带位置的 output 的行下标（`-1` = 还没有）；面板用它定位。 */
  lastOutputIndex: number
  /** 这次停命中的断点 id（已归一）。 */
  hits: string[]
  /** 命中的断点 id 映射到的「文件:行」（断点 id 是会话内句柄，靠 breakpoint 事件累积）。 */
  hitLocations: Array<{ path: string; line: number }>
  /** 规范：所有线程都停了吗（没报 = null，不知道就不猜）。 */
  allThreadsStopped: boolean | null
  /** 适配器请求别抢焦点。 */
  preserveFocusHint: boolean
}>({ version: 0, outputs: {}, lastOutputIndex: -1, hits: [], hitLocations: [], allThreadsStopped: null, preserveFocusHint: false })

/** 输出位置表最多记多少条（长构建里每条错误都有位置，别无限涨）。 */
const OUTPUT_RELAY_LIMIT = 500

/** 会话内 断点 id → 最后一次报告它的 文件:行（与 bridge 内部那份同源，只是本模块自己攒）。 */
const breakpointPlaces = new Map<string, { path: string; line: number }>()

/** 会话边界（start/terminated）时把 id 表与命中态清干净 —— id 只在一次会话里有效。 */
export function resetDapEventRelay(): void {
  breakpointPlaces.clear()
  dapEventRelay.outputs = {}
  dapEventRelay.lastOutputIndex = -1
  dapEventRelay.hits = []
  dapEventRelay.hitLocations = []
  dapEventRelay.allThreadsStopped = null
  dapEventRelay.preserveFocusHint = false
  dapEventRelay.version++
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
function positive(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

/**
 * 解读一条 `dap.event` 载荷（纯函数式的状态更新）。
 * `consoleLength` = 这条事件到达时 `dapConsole` 的长度（bridge 已经 push 过 output 那一行）。
 */
export function relayDapEvent(event: unknown, consoleLength: number): void {
  if (!event || typeof event !== 'object') return
  const record = event as Record<string, unknown>
  const kind = text(record.event)
  if (kind === 'output') {
    const location = { path: text(record.path) || undefined, line: record.line as number | undefined, column: record.column as number | undefined, group: text(record.group) || undefined }
    if (outputJumpable(location)) {
      const target = outputJumpTarget(location)
      if (target) {
        const index = Math.max(0, Math.trunc(consoleLength) - 1)
        dapEventRelay.outputs[index] = target
        dapEventRelay.lastOutputIndex = index
        // 上限：删掉最早记的那些（键是数字下标，升序取最小的几个删）。
        const keys = Object.keys(dapEventRelay.outputs)
        if (keys.length > OUTPUT_RELAY_LIMIT) {
          for (const key of keys.map(Number).sort((a, b) => a - b).slice(0, keys.length - OUTPUT_RELAY_LIMIT)) delete dapEventRelay.outputs[key]
        }
        dapEventRelay.version++
      }
    }
    return
  }
  if (kind === 'breakpoint') {
    // 只记"哪条 id 落在哪一行"，命中判定时才用得上；没有 id 的报告不记（无法比对）。
    const path = text(record.path)
    const line = positive(record.line)
    const id = record.id
    const key = typeof id === 'number' && Number.isFinite(id) ? String(Math.trunc(id)) : text(id)
    if (path && line >= 1 && key) breakpointPlaces.set(key, { path, line })
    return
  }
  if (kind === 'stopped') {
    const flags = stoppedFlags(record)
    dapEventRelay.hits = flags.hits
    dapEventRelay.allThreadsStopped = flags.allThreadsStopped
    dapEventRelay.preserveFocusHint = flags.preserveFocusHint
    dapEventRelay.hitLocations = flags.hits
      .map(id => breakpointPlaces.get(id))
      .filter((place): place is { path: string; line: number } => place !== undefined)
    dapEventRelay.version++
    return
  }
  if (kind === 'continued' || kind === 'terminated') {
    // 继续/结束之后"这一停命中的断点"就不该再高亮。
    if (dapEventRelay.hits.length) { dapEventRelay.hits = []; dapEventRelay.hitLocations = []; dapEventRelay.version++ }
    if (kind === 'terminated') resetDapEventRelay()
  }
}

interface RelayTarget {
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void
  removeEventListener(type: string, listener: (event: { data?: unknown }) => void): void
}

/**
 * 挂一个 `message` 监听器读 `dap.event` 的原文。默认挂当前窗口的 WebView2 宿主；
 * 判据可以传桩（返回一个卸载函数）。宿主不存在时返回空卸载函数（浏览器预览没有事件）。
 */
export function installDapEventRelay(
  target: RelayTarget | undefined = typeof window === 'undefined' ? undefined : (window as { chrome?: { webview?: RelayTarget } }).chrome?.webview,
  consoleLength: () => number = () => dapConsole.length,
): () => void {
  if (!target || typeof target.addEventListener !== 'function') return () => undefined
  const listener = (message: { data?: unknown }) => {
    const data = message?.data as Record<string, unknown> | undefined
    if (!data || data.event !== 'dap.event') return
    relayDapEvent(data.payload, consoleLength())
  }
  target.addEventListener('message', listener)
  return () => target.removeEventListener('message', listener)
}

// 组件一 import 本模块就把监听挂上（Debug 面板/控制台只在打开时 import；不开面板就没有消费方）。
installDapEventRelay()
