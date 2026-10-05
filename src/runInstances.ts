// 运行/构建的**多实例**状态（IDEA 的 Run 工具窗口按"正在运行的实例"开标签）。
//
// 从 src/bridge.ts 拆出并扩容（2026-09-27）：原先只有一组 `runOutput` / `runState`（单实例），
// 现在已经支持多个并发实例（宿主侧 native/run_host.cpp 的 `isAllowRunningInParallel` 语义），
// 所以「事件 → 哪个实例」这件事需要独立的归属地；桥接那一层只留转发。
//
// 与 IDEA 的对应（`platform/execution-impl/src/com/intellij/execution/impl/`）：
//   · `RunContentDescriptor`（一个正在运行的实例）= 这里的 `RunInstanceRecord`；
//   · `RunContentManagerImpl` 的"每个实例一个 Content" = 这里的 `runInstances`（按 id 有序）；
//   · 新起一个实例会**切到它的标签**（`RunContentManagerImpl` 打开新 Content 即选中）= `focusRunInstance`。
//
// 两条兼容约束（既有代码大量使用它们，不能改形状）：
//   `runOutput` —— **当前选中实例**的输出行（控制台显示的就是它）；
//   `runState`  —— 聚合状态：`running` = 还有实例在跑，`exit` = 当前实例的退出码。
// 实例自己的缓冲是唯一事实来源，`runOutput` 是它的镜像（切换实例时整体换掉）。
import { reactive, ref } from 'vue'
import { fromBase64 } from './base64.ts'
import { runExitAnnouncement } from './processTerminated.ts'
import { parseProcessTree, type RunProcessEntry } from './processTree.ts'
import { createConsoleDecoder, readConsoleEncoding, writeConsoleEncoding } from './consoleEncoding.ts'
import type { CoverageSummary } from './coverageReport.ts'

/** 输出保留的行数上限（与单实例时代一致，防止刷屏吃内存）。 */
export const RUN_OUTPUT_LIMIT = 4000

export interface RunInstanceRecord {
  id: number
  /** 运行配置名（宿主回传；空表示未命名的临时命令）。 */
  label: string
  running: boolean
  /** 结束后的退出码；`null` = 还在跑或还没结束。 */
  exit: number | null
  /** 起跑时间（毫秒时间戳），标签上显示"跑了多久"。 */
  startedAt: number
  /** 该实例的输出行（切换标签时整体镜像到 `runOutput`）。 */
  output: string[]
  /**
   * 该实例当前子进程的 OS pid（宿主 `run.instances` 快照回填；0 = 没在跑或还没问到）。
   * 与 `exit` 一样是**补充面**：运行态与输出仍以事件流为准。
   */
  pid: number
  /** 进程树里活着的后代 pid（宿主按 Toolhelp 快照算，见 native/run_host.cpp）。 */
  children: number[]
  /** 后代的父子结构 + 进程名（同一份快照；控制台的「进程」区画层级）。 */
  tree: RunProcessEntry[]
  /**
   * 该实例进程树里正在**监听**的 TCP 端口（宿主 `run.instances` 的 `ports`；IPv4+IPv6）。
   * 上游 `execution/portsWatcher` 的可见等价物：调试/服务进程开了哪个端口一眼能看到。
   */
  ports: number[]
  /** 解析出的覆盖率报告（JaCoCo/Kover XML；见 src/coverageReport.ts）。没有就是 null。 */
  coverage: CoverageSummary | null
  /**
   * 视图已被「关闭视图」动作摘掉（上游 `CloseViewAction.perform` → `removeContent(content, true)`）。
   * 标签立刻消失，但记录**留到 `run.exit` 到达再删** —— 宿主 `Manager::stop` 一定会补一条
   * `run.exit{aborted:true}`（native/run_host.cpp:306-310），晚到的输出/退出因此不会把
   * `record()` 叫醒成一个"复活"的标签。已结束才关的（`running === false`）当场就删。
   */
  closed: boolean
}

export const runInstances = reactive(new Map<number, RunInstanceRecord>())
/** 当前选中的实例 id（0 = 还没有实例）。 */
export const activeRunInstance = ref(0)
/** 当前实例的输出（**镜像**：真身在实例记录里）。 */
export const runOutput = reactive<string[]>([])
/** 聚合状态：还有实例在跑 / 当前实例的退出码。 */
export const runState = reactive<{ running: boolean; exit: number | null }>({ running: false, exit: null })

// 输出按字节流解码：子进程用自己的代码页，分块边界可能切开一个多字节字符。
// 字符集可切换（上游 ConsoleEncodingComboBox）：选择存 localStorage，切换时先冲掉旧解码器的残留。
let currentConsoleEncoding = readConsoleEncoding()
let decoder = createConsoleDecoder(currentConsoleEncoding)
/** 当前控制台编码（RunConsole 的选择器绑定它）。 */
export const runConsoleEncoding = ref(currentConsoleEncoding)

/**
 * 切换控制台编码（上游 `ConsoleViewImpl.setEncoding`）。
 * 旧解码器的分块残留按**旧编码**冲出来写进当前实例，再换新解码器 ——
 * 否则半个字符会等下一次输出、甚至被新编码解成乱码。
 */
export function setRunConsoleEncoding(id: string): void {
  if (id === currentConsoleEncoding) return
  const tail = decoder.decode()
  if (tail) handleRunOutput(undefined, tail)
  currentConsoleEncoding = id
  runConsoleEncoding.value = id
  writeConsoleEncoding(undefined, id)
  decoder = createConsoleDecoder(id)
}

/**
 * 输出暂停（上游 `PauseOutputAction`）：暂停的是**视图**（当前实例的镜像不再前移），
 * 实例缓冲照常累积 —— 恢复时镜像重新对齐当前实例，暂停期间的内容一条不少。
 */
export const runOutputPaused = ref(false)
export function setRunOutputPaused(paused: boolean): void {
  runOutputPaused.value = paused
  if (!paused) {
    const target = activeRunInstance.value ? runInstances.get(activeRunInstance.value) : undefined
    runOutput.splice(0, runOutput.length, ...(target ? target.output : []))
  }
}

function record(id: number): RunInstanceRecord {
  const found = runInstances.get(id)
  if (found) return found
  // 事件可能比 `run.start` 的回包先到（两者是两条独立消息），所以这里要能"先建后填"。
  const created: RunInstanceRecord = { id, label: '', running: true, exit: null, startedAt: Date.now(), output: [], pid: 0, children: [], tree: [], ports: [], coverage: null, closed: false }
  runInstances.set(id, created)
  return created
}

function refreshAggregate(): void {
  runState.running = [...runInstances.values()].some(instance => instance.running)
  runState.exit = activeRunInstance.value ? runInstances.get(activeRunInstance.value)?.exit ?? null : null
}

/** 实例清单（按 id 升序 = 起跑顺序）。已被关闭的视图不进清单（`closed` 见字段注释）。 */
export function runInstanceList(): RunInstanceRecord[] {
  return [...runInstances.values()].filter(instance => !instance.closed).sort((left, right) => left.id - right.id)
}

/** 真正删掉一条记录，并把选中切到剩下的第一个（上游移除选中 Content 后会选到别的视图）。 */
function forget(id: number): void {
  runInstances.delete(id)
  if (activeRunInstance.value !== id) return
  const next = runInstanceList()[0]
  activeRunInstance.value = next?.id ?? 0
  runOutput.splice(0, runOutput.length, ...(next ? next.output : []))
  if (runOutputPaused.value) return
  refreshAggregate()
}

/**
 * 关掉一个视图（上游 `Runner.CloseView` / `CloseViewsActionBase.actionPerformed:22-31`）。
 *
 * 停进程是**宿主**那一步（调用方发 `run.stop {instance}`，语义与标签上的 × 相同）；
 * 这里只做视图侧：标签立刻摘掉（`closed = true`），记录等到 `run.exit` 再删 ——
 * 理由写在 `RunInstanceRecord.closed` 上。进程早就结束的视图当场删干净。
 */
export function closeRunView(id: number): void {
  const target = runInstances.get(id)
  if (!target || target.closed) return
  target.closed = true
  if (!target.running) { forget(id); return }
  refreshAggregate()
}

/** 切到某个实例（新实例起跑时自动调；控制台整体换成它的输出）。暂停时只切选中，不动视图。 */
export function focusRunInstance(id: number): void {
  if (!runInstances.has(id)) return
  activeRunInstance.value = id
  if (runOutputPaused.value) { refreshAggregate(); return }
  // 整体替换而不是 push：`runOutput` 是镜像，长度与内容都要与实例一致。
  runOutput.splice(0, runOutput.length, ...runInstances.get(id)!.output)
  refreshAggregate()
}

/**
 * 清空**当前实例**的控制台（IDEA 控制台的 Clear All / `ClearConsoleAction`）。
 *
 * 只清当前实例：实例缓冲与镜像一起清，保证切换走后回来看到的仍是空的；
 * 其它实例（各自的标签）不受影响。在跑的进程继续输出会接着写在新内容后面。
 */
export function clearRunOutput(): void {
  const target = activeRunInstance.value ? runInstances.get(activeRunInstance.value) : undefined
  if (target) target.output.splice(0, target.output.length)
  runOutput.splice(0, runOutput.length)
}

/** 宿主报告新实例（`run.started`）。 */
export function handleRunStarted(data: { instance?: number; label?: string }): boolean {  if (typeof data.instance !== 'number') return false
  const created = record(data.instance)
  if (typeof data.label === 'string') created.label = data.label
  // 宿主事件与 run.start 回包可能先后到达；相同 id 只确认，不重置已收到的输出/退出。
  focusRunInstance(data.instance)   // IDEA 打开新 Content 时会选中它
  refreshAggregate()
  return true
}

/**
 * 输出事件。`text` 已解码（桥接那一层负责解 base64）。
 * 当前实例的输出**同时**写进 `runOutput`，其它实例只进自己的缓冲。
 */
export function handleRunOutput(instance: number | undefined, text: string): void {
  const id = typeof instance === 'number' ? instance : activeRunInstance.value
  if (!id) return
  const target = record(id)
  target.output.push(text)
  if (target.output.length > RUN_OUTPUT_LIMIT) target.output.splice(0, target.output.length - RUN_OUTPUT_LIMIT)
  // 暂停只冻结视图（runOutput 镜像）：实例缓冲继续累积，恢复后一条不少。
  if (runOutputPaused.value) return
  if (id === activeRunInstance.value) {
    runOutput.push(text)
    if (runOutput.length > RUN_OUTPUT_LIMIT) runOutput.splice(0, runOutput.length - RUN_OUTPUT_LIMIT)
  }
}

/** 结束事件。`remaining > 0` 表示这条链还有后续步骤，整条配置仍算"在跑"。 */
export function handleRunExit(data: { instance?: number; code?: number; remaining?: number; aborted?: boolean }): boolean {
  if (typeof data.code !== 'number') return false
  const id = typeof data.instance === 'number' ? data.instance : activeRunInstance.value
  const remaining = typeof data.remaining === 'number' ? data.remaining : 0
  const tail = decoder.decode()
  // IDEA `ProcessTerminatedListener.processTerminated`（:59-66）：进程结束时**同一句话写两处** ——
  // 控制台一行（`notifyTextAvailable(..., SYSTEM)`）+ 状态栏一条（`StatusBar.Info.set`）。规则
  // （只在整条链结束时报、用户主动停止不报）在 src/processTerminated.ts。放在这里而不是桥接层：
  // 它是本函数收尾语义的一部分。与上游一致，这是**独立的一条**控制台文字（不并进解码残留里）。
  const finished = runExitAnnouncement({ code: data.code, remaining, aborted: data.aborted })
  const push = (text: string) => {
    if (id) {
      const target = record(id)
      target.output.push(text)
      if (target.output.length > RUN_OUTPUT_LIMIT) target.output.splice(0, target.output.length - RUN_OUTPUT_LIMIT)
      if (id === activeRunInstance.value && !runOutputPaused.value) {
        runOutput.push(text)
        if (runOutput.length > RUN_OUTPUT_LIMIT) runOutput.splice(0, runOutput.length - RUN_OUTPUT_LIMIT)
      }
    } else if (!runOutputPaused.value) {
      runOutput.push(text)
    }
  }
  if (tail) push(tail)
  if (finished !== null) push(finished)
  if (id) {
    const target = record(id)
    target.exit = data.code
    if (remaining === 0) target.running = false
    // 关闭的视图：这条退出是宿主对 `run.stop` 的收尾（native/run_host.cpp:306-310），整条链走完
    // 才真正把记录删掉 —— 中间还有 before-launch 后续步骤时继续收（`remaining > 0`）。
    if (remaining === 0 && target.closed) { forget(id); return true }
  }
  refreshAggregate()
  return true
}

/**
 * 起跑入口，两个时机，**都不清空已有实例的输出**：
 *  - **不带 id**（`runActions` 在用户按下运行时调用）：此时还没有新实例，回包未到。
 *    控制台按实例分标签（RunConsole 的每个 Content），旧实例的输出要留着 ——
 *    提前清空就是抹掉上一轮的结果（见 tests/java-launch-regression.test.mjs）。
 *  - **带 id**（`run.start` 的回包 / 宿主 `run.started` 确认同一个实例）：只确认 id。
 *    宿主事件与回包可能先后到达，同一个 id 再确认一次同样不能清空 ——
 *    那会把这一轮已经收到的输出抹掉。
 * 真正「从空开始」的是**新实例 id**：`record()` 给它建空缓冲，`focusRunInstance()` 切过去。
 */
export function beginRun(instance?: number): void {
  if (typeof instance !== 'number') return
  handleRunStarted({ instance })
}

/** 发起失败时把状态收回来（`runActions` 的 catch 用它）。 */
export function endRun(instance?: number): void {
  const id = typeof instance === 'number' ? instance : activeRunInstance.value
  if (id) {
    const target = runInstances.get(id)
    if (target) { target.running = false; if (target.exit === null) target.exit = -1 }
  }
  refreshAggregate()
}

/** 解码一段 base64 输出（桥接层用；放这里以便与 `decoder` 的**分块状态**保持一致）。 */
export function decodeRunChunk(dataB64: string): string {
  return decoder.decode(fromBase64(dataB64), { stream: true })
}

/**
 * 把宿主 `run.instances` 的快照合进记录（`RunConsole` 的「进程」区用它）。
 *
 * 只回填 pid / children 这两个**只有宿主知道**的字段；运行态与退出码仍以事件流为准 ——
 * 快照可能与事件交叠（例如快照在 run.exit 之后才回到），让快照覆盖会倒退回"运行中"。
 * 认领不了的 id（事件还没建记录，或已清理）跳过。返回认领的条数。
 */
export function applyRunInstanceSnapshot(rows: readonly unknown[]): number {
  if (!Array.isArray(rows)) return 0
  let claimed = 0
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as { id?: unknown; pid?: unknown; children?: unknown; tree?: unknown; ports?: unknown }
    if (typeof row.id !== 'number') continue
    const target = runInstances.get(row.id)
    if (!target) continue
    if (typeof row.pid === 'number' && Number.isFinite(row.pid) && row.pid >= 0) target.pid = row.pid
    if (Array.isArray(row.children)) target.children = row.children.filter((pid): pid is number => typeof pid === 'number')
    // `tree` 比 children 多出父子关系与进程名；老宿主没有这个字段时保留上一次的树。
    if (Array.isArray(row.tree)) target.tree = parseProcessTree(row.tree)
    // 监听端口（宿主 IpHelper 快照；老宿主没有这个字段时保留上一次的结果）。
    if (Array.isArray(row.ports)) target.ports = [...new Set(row.ports.filter((port): port is number => typeof port === 'number' && port > 0 && port < 65536))]
    claimed++
  }
  return claimed
}

/** 记录一个实例的覆盖率报告（RunConsole 读完报告后调用；见 src/coverageReport.ts）。 */
export function setInstanceCoverage(id: number, summary: CoverageSummary | null): void {
  const target = runInstances.get(id)
  if (target) target.coverage = summary
}

/** 冲掉解码器的分块残留（一次运行结束时要调，否则最后半个字符会等下一次）。 */
export function flushRunDecoder(): string {
  return decoder.decode()
}
