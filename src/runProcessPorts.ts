// run-instances 那一档的**可移植规则**：端口监视器（`execution/portsWatcher`）与提权
// （`execution/process/elevation`）。从 `src/consoleFilterRegistry.ts` 按职责拆出（本文件是
// 「进程树/端口/提权」那半，注册表与过滤语义留在原文件），名字在这里原样再导出，
// 调用方（判据）一行没改 —— 与 `src/runInstances.ts` → `src/runStopAction.ts` 同一拆法。
//
// 为什么这两块同处一个文件：它们都是「运行实例的进程面」——
// 端口监视器的输入是**实例进程树**（`run.instances` 的 tree），提权是起进程那条路的资格位，
// 两者都只碰 pid/端口/授权，不碰控制台文本。逐条上游坐标见下面各节。
//
// 判据 `tests/console-filter-registry.test.mjs`（与原文件的判据同一个）。

import type { RunProcessEntry } from './processTree.ts'

// ── run-instances 那一档：端口监视器的**纯逻辑面**（`execution/portsWatcher`） ───────────────────
// 上游 `ProcessPortsWatcher`（`platform/execution-impl/src/com/intellij/execution/portsWatcher/`）：
//   · 三档 `PortListeningOptions`（`PortListeningOptions.kt:7-10`，`includesSelf/Children` `:12-13`），
//     默认 `INCLUDE_SELF_AND_CHILDREN`（`ProcessPortsWatcher.kt:49`）。
//   · 扫一棵树：`getPidsTreeForPpid` 取 ppid→pid 后递归收全部后代
//     （`ProcessPortsWatcherImpl.kt:174-200`，`:180-184` 按 options 决定根算不算）；本地走
//     `ProcessHandle.allProcesses()`（`:213-221`），非本地 POSIX 走 `ps -eo pid,ppid` 丢表头
//     （`:227-264`）。状态是**差集**：`stopped = old - new`、`new = new - old`（`:157-172`，
//     两条在 `:158`/`:163`），先报 started（`:170`）再报 ended（`:171`）。
//   · 平台门：**非本机 Windows 目标不支持**（`ProcessPortsWatcher.kt:51-54` 返回 no-op），
//     本机 Windows 走 `GetExtendedTcpTable`（`impl/WindowsPortsScanning.kt:19-54`）。
// 本仓现状：宿主 `native/run_host.cpp` 已做「IP Helper 快照 + 按实例树过滤」
// （`listening_tcp_ports()` `:135`、`ports_of` `:187`、每实例取树 `:476-487`），前端合入在
// `src/runInstances.ts:556`。**缺的是差集这一层**（快照是整表覆盖）—— 下面这半就是它。

/** 上游 `PortListeningOptions` 三档（`PortListeningOptions.kt:7-10`）。 */
export type PortListeningOptions = 'INCLUDE_SELF' | 'INCLUDE_CHILDREN' | 'INCLUDE_SELF_AND_CHILDREN'

/** `ProcessPortsWatcher.kt:49` 的默认档。 */
export const DEFAULT_PORT_LISTENING_OPTIONS: PortListeningOptions = 'INCLUDE_SELF_AND_CHILDREN'

/** `PortListeningOptions.kt:12`。 */
export function portOptionsIncludeSelf(options: PortListeningOptions): boolean {
  return options === 'INCLUDE_SELF' || options === 'INCLUDE_SELF_AND_CHILDREN'
}

/** `PortListeningOptions.kt:13`。 */
export function portOptionsIncludeChildren(options: PortListeningOptions): boolean {
  return options === 'INCLUDE_CHILDREN' || options === 'INCLUDE_SELF_AND_CHILDREN'
}

/**
 * 非本机 Windows 目标上端口探测被禁用（`ProcessPortsWatcher.kt:51-54`）。
 * `localWindows` 由调用方给（宿主只能报「本机」；远程目标本仓没有，见 exec/target 判词）。
 */
export function portWatchSupported(osFamily: 'windows' | 'linux' | 'mac' | 'other', localWindows: boolean): boolean {
  if (osFamily !== 'windows') return true
  return localWindows
}

/**
 * `getPidsTreeForPpid`（`ProcessPortsWatcherImpl.kt:174-186`）的等价物：从根 pid 出发收全部后代，
 * 按 options 决定根自己算不算。输入是宿主 `run.instances` 的 `tree`（`{pid,parent,name}`，
 * 与 `src/processTree.ts` 同一形状）。树里有环（宿主快照不可能，但输入不可信）时靠 visited 兜住。
 */
export function portWatchPids(
  rootPid: number, tree: readonly RunProcessEntry[], options: PortListeningOptions = DEFAULT_PORT_LISTENING_OPTIONS,
): number[] {
  const pids = new Set<number>()
  if (!rootPid) return []
  if (portOptionsIncludeChildren(options)) {
    const children = new Map<number, number[]>()
    for (const entry of tree) {
      if (!entry || !Number.isInteger(entry.pid) || entry.pid <= 0) continue
      const list = children.get(entry.parent)
      if (list) list.push(entry.pid)
      else children.set(entry.parent, [entry.pid])
    }
    const visited = new Set<number>([rootPid])
    const walk = (parent: number) => {
      for (const child of children.get(parent) ?? []) {
        if (visited.has(child)) continue
        visited.add(child)
        pids.add(child)
        walk(child)
      }
    }
    walk(rootPid)
  }
  if (portOptionsIncludeSelf(options)) pids.add(rootPid)
  return [...pids].sort((left, right) => left - right)
}

/** 一条监听记录（上游 `ListeningPort`，`ListeningPort.kt:7-14`：port + pid，pid 可能拿不到）。 */
export interface ListeningPortRecord {
  port: number
  pid: number | null
}

/** 端口差集事件（上游 `ListeningPortHandler` 的两个回调，`ListeningPortHandler.kt:11-13`）。 */
export interface PortWatchDelta {
  started: ListeningPortRecord[]
  ended: ListeningPortRecord[]
}

function portKey(row: ListeningPortRecord): string {
  return `${row.pid ?? '-'}:${row.port}`
}

/**
 * `updateState`（`ProcessPortsWatcherImpl.kt:157-172`）：新旧状态做**双向差集**。
 * 相等集合（同 pid 同端口）不产生事件；`pid` 为 null 时按「只有端口」比（上游 stdout 监听那条
 * 拿不到 pid，见 `ListeningPort.kt:11-12`）。返回的两表按端口升序，便于断言与渲染。
 */
export function portWatchDelta(previous: readonly ListeningPortRecord[], current: readonly ListeningPortRecord[]): PortWatchDelta {
  const before = new Map<string, ListeningPortRecord>()
  for (const row of previous) before.set(portKey(row), row)
  const after = new Map<string, ListeningPortRecord>()
  for (const row of current) after.set(portKey(row), row)
  const started: ListeningPortRecord[] = []
  const ended: ListeningPortRecord[] = []
  for (const [key, row] of after) if (!before.has(key)) started.push(row)
  for (const [key, row] of before) if (!after.has(key)) ended.push(row)
  const byPort = (left: ListeningPortRecord, right: ListeningPortRecord) => left.port - right.port || (left.pid ?? 0) - (right.pid ?? 0)
  return { started: started.sort(byPort), ended: ended.sort(byPort) }
}

/**
 * 从宿主快照的端口表 + 该实例根 pid 算出**这一刻的**监听记录表（`scanPortsOnce` 的收尾，
 * `ProcessPortsWatcherImpl.kt:122-139`：先定 pid 集合、再问这些 pid 的端口）。
 *
 * 如实差异：上游按平台分别扫（Linux `/proc/net/tcp` 见 `impl/LinuxPortsScanning.kt:33-58`），
 * 本仓宿主只有本机 Windows 的 `GetExtendedTcpTable` 那一条（`native/run_host.cpp:135`），
 * 且 `ports_of` 只回端口号、不带 pid ⇒ 这里把 pid 记成**根进程 pid**
 * （上游的 pid 精确到真正监听的那个后代进程，`ListeningPort.kt:10-13`）。
 */
export function listeningPortsOf(rootPid: number, ports: readonly number[]): ListeningPortRecord[] {
  const rows: ListeningPortRecord[] = []
  const seen = new Set<number>()
  for (const port of ports) {
    if (!Number.isInteger(port) || port <= 0 || port > 65535 || seen.has(port)) continue
    seen.add(port)
    rows.push({ port, pid: rootPid > 0 ? rootPid : null })
  }
  return rows.sort((left, right) => left.port - right.port)
}

/** 把一次快照接到上一次上，返回差集（宿主快照 → 前端事件那一跳的规则）。 */
export function portWatchStep(
  previous: readonly ListeningPortRecord[], rootPid: number, ports: readonly number[],
): { current: ListeningPortRecord[]; delta: PortWatchDelta } {
  const current = listeningPortsOf(rootPid, ports)
  return { current, delta: portWatchDelta(previous, current) }
}

// ── 提权（`execution/process/elevation`）的**可移植规则** ────────────────────────────────────────
// 上游：`ElevationService`（`platform/platform-api/src/com/intellij/execution/process/ElevationService.java:12`）
// 五格 —— `authorizeService()`（`:30`）、`createProcessHandler`（`:32`）、`createProcess` 两重载
// （`:34`/`:38`）、`isAvailable()`（`:40-42` 委派给 `SudoCommandProvider.isAvailable()`）；
// `SudoCommandProvider`（`platform/platform-util-io/src/com/intellij/execution/sudo/SudoCommandProvider.kt:10-21`）
// 两格：`isAvailable()` 与 `sudoCommand(wrapped, prompt): GeneralCommandLine?`。
// 设置面：`ElevationSettings` 的 `isKeepAuth`/`isRefreshable`/`gracePeriodMs`
// （`settings/ElevationSettings.kt:47`/`:55`/`:61`），默认宽限期 **15 分钟**（`:31`），
// `askEnableKeepAuthIfNeeded()`（`:86-87`）；`ElevationServiceImpl.createProcess` 先问它、答否抛取消
// （`ElevationServiceImpl.kt:52-54`）；守护进程最多重试 **3** 次（`:85`）。文案
// （`resources/messages/ElevationBundle.properties`）：`:8` 设置页名、`:21`/`:22` 两条复选、
// `:32` `authorize.every.time`、`:33` `keep.authorized.for.0=Keep authorized for {0}`。
// **本仓没有提权通道**：宿主只有本机 CreateProcess（无 UAC 提升、无 sudo 包装），
// `RunStartParams` 里也没有提权位（`src/bridge.ts` 本批冻结）⇒ 只落三条**纯规则**，不画提权控件。

/** 上游 `ElevationBundle.properties:8` 的设置页名。 */
export const ELEVATION_SETTINGS_TITLE = 'Process Elevation'
/** `ElevationBundle.properties:21` / `:22` 两条复选（Windows 用 UAC，POSIX 用 sudo）。 */
export const ELEVATION_KEEP_AUTH_LABEL = { windows: 'Keep UAC authorization for', posix: "Keep 'sudo' authorization for" } as const
/** `ElevationBundle.properties:32` 的「每次都授权」档。 */
export const ELEVATION_AUTHORIZE_EVERY_TIME = 'Authorize every time'
/** `ElevationSettings.kt:31` 的默认宽限期（毫秒）。 */
export const ELEVATION_DEFAULT_GRACE_PERIOD_MS = 15 * 60 * 1000
/** `ElevationServiceImpl.kt:85`。 */
export const ELEVATION_MAX_DAEMON_ATTEMPTS = 3

export interface ElevationSettingsState {
  /** 上游 `ElevationSettings.isKeepAuth`（`:47`）。 */
  keepAuth: boolean
  /** 上游 `ElevationSettings.isRefreshable`（`:55`）。 */
  refreshable: boolean
  /** 上游 `ElevationSettings.quotaTimeLimitMs`（`:61`，取自 `options.gracePeriodMs`）。 */
  gracePeriodMs: number
}

/** 默认设置（`ElevationSettings` 的字段缺省：不保持授权、宽限期是那 15 分钟）。 */
export const ELEVATION_DEFAULT_SETTINGS: ElevationSettingsState = Object.freeze({
  keepAuth: false, refreshable: false, gracePeriodMs: ELEVATION_DEFAULT_GRACE_PERIOD_MS,
})

/**
 * `ElevationSettings.quotaOptions`（`:36-45`）的等价物：不保持授权时限额是 0
 * （= 每次都要授权），保持授权时才带宽限期；`refreshable` 只有保持授权时才有效（`:38`）。
 */
export function elevationQuota(state: ElevationSettingsState): { timeLimitMs: number; isRefreshable: boolean } {
  if (!state.keepAuth) return { timeLimitMs: 0, isRefreshable: false }
  return { timeLimitMs: state.gracePeriodMs, isRefreshable: state.refreshable }
}

/** 授权有效期那一行的文案（`ElevationBundle.properties:32-33`；宽限期取整到分钟）。 */
export function elevationAuthLabel(state: ElevationSettingsState): string {
  if (!state.keepAuth || state.gracePeriodMs <= 0) return ELEVATION_AUTHORIZE_EVERY_TIME
  return `Keep authorized for ${Math.round(state.gracePeriodMs / 60000)} min`
}

/**
 * 提权可不可用（`ElevationService.java:40-42` → `SudoCommandProvider.isAvailable()`，`:11`）。
 * 本仓宿主没有 UAC/sudo 通道 ⇒ 调用方传 false 时恒 false（宿主真接了就把这一格换成宿主的能力位）。
 */
export function elevationAvailable(hostSupportsElevation: boolean): boolean {
  return hostSupportsElevation === true
}

/**
 * 上游 `SudoCommandProvider.sudoCommand(wrapped, prompt)`（`:21`）的等价物：
 * 返回包装后的命令行，或 null（= 没有可用的提权工具，上游注释就是这么写的）。
 * 本仓没有 sudo 通道 ⇒ 宿主能力位为 false 时恒 null，不编一条永远跑不通的命令。
 */
export function elevationWrappedCommand(program: string, args: readonly string[], hostSupportsElevation: boolean): string | null {
  if (!elevationAvailable(hostSupportsElevation)) return null
  const trimmed = program.trim()
  if (!trimmed) return null
  return [trimmed, ...args].join(' ')
}
