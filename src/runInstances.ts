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
}

export const runInstances = reactive(new Map<number, RunInstanceRecord>())
/** 当前选中的实例 id（0 = 还没有实例）。 */
export const activeRunInstance = ref(0)
/** 当前实例的输出（**镜像**：真身在实例记录里）。 */
export const runOutput = reactive<string[]>([])
/** 聚合状态：还有实例在跑 / 当前实例的退出码。 */
export const runState = reactive<{ running: boolean; exit: number | null }>({ running: false, exit: null })

// 输出按字节流解码：子进程用自己的代码页，分块边界可能切开一个多字节字符。
const decoder = new TextDecoder('utf-8')

function record(id: number): RunInstanceRecord {
  const found = runInstances.get(id)
  if (found) return found
  // 事件可能比 `run.start` 的回包先到（两者是两条独立消息），所以这里要能"先建后填"。
  const created: RunInstanceRecord = { id, label: '', running: true, exit: null, startedAt: Date.now(), output: [] }
  runInstances.set(id, created)
  return created
}

function refreshAggregate(): void {
  runState.running = [...runInstances.values()].some(instance => instance.running)
  runState.exit = activeRunInstance.value ? runInstances.get(activeRunInstance.value)?.exit ?? null : null
}

/** 实例清单（按 id 升序 = 起跑顺序）。 */
export function runInstanceList(): RunInstanceRecord[] {
  return [...runInstances.values()].sort((left, right) => left.id - right.id)
}

/** 切到某个实例（新实例起跑时自动调；控制台整体换成它的输出）。 */
export function focusRunInstance(id: number): void {
  if (!runInstances.has(id)) return
  activeRunInstance.value = id
  // 整体替换而不是 push：`runOutput` 是镜像，长度与内容都要与实例一致。
  runOutput.splice(0, runOutput.length, ...runInstances.get(id)!.output)
  refreshAggregate()
}

/** 宿主报告新实例（`run.started`）。 */
export function handleRunStarted(data: { instance?: number; label?: string }): boolean {
  if (typeof data.instance !== 'number') return false
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
  if (id) {
    const target = record(id)
    if (tail) target.output.push(tail)
    if (id === activeRunInstance.value && tail) runOutput.push(tail)
    target.exit = data.code
    if (remaining === 0) target.running = false
  } else if (tail) {
    runOutput.push(tail)
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

/** 冲掉解码器的分块残留（一次运行结束时要调，否则最后半个字符会等下一次）。 */
export function flushRunDecoder(): string {
  return decoder.decode()
}
