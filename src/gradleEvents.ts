// Gradle 同步的宿主事件（`gradle.started` / `gradle.output` / `gradle.exit`）与它在前端的状态。
//
// 从 src/bridge.ts 拆出（2026-09-27：接 Gradle 通道时 bridge.ts 顶到机检上限，而这三个事件
// 本来就是一条独立的通道）。为什么单独一条通道：IDEA 的 Gradle 同步**不占运行控制台**
// （它有自己的 ExternalSystem 进度），所以在 TaoCode 里也不能复用 `run.*` —— 否则"同步一下"
// 会把用户正在跑的程序的输出冲掉。
//
// 判定与解析不在这里：本模块只把字节流接进一个 reactive 状态；项目/任务解析在 src/gradleHost.ts。
import { reactive } from 'vue'
import { fromBase64 } from './base64.ts'

export interface GradleEventData { command?: string; dataB64?: string; code?: number; cancelled?: boolean }

/** 同步输出保留的字符数（超出丢最旧的一半）—— 一个 Gradle 同步的日志可以是几十 MB。 */
export const GRADLE_OUTPUT_LIMIT = 200_000

export const gradleSync = reactive<{
  running: boolean
  /** 正在跑的完整命令行（给用户看得见"到底跑了什么"）。 */
  command: string
  output: string
  /** 已结束时的退出码；`null` = 还没结束过。 */
  exit: number | null
  /** 结束时的取消标记。 */
  cancelled: boolean
  /** 毫秒时间戳；0 = 本次会话还没同步过。结束时也会被刷新（"上一次结束于"）。 */
  at: number
  /**
   * 本次同步**开始**的毫秒时间戳。`at` 在开始时会被打点、结束时又被重打一次，
   * 所以"已经跑了多久 / 一共跑了多久"只能记在另一个字段里 —— 上游 Tooling API 的
   * `ExternalSystemTaskNotificationListener.onStart/onFinish` 也是两个时刻各自成事。
   */
  startedAt: number
}>({ running: false, command: '', output: '', exit: null, cancelled: false, at: 0, startedAt: 0 })

// 和 run.output 一样按字节流解码：同步输出里可能出现被分块切断的多字节字符。
const decoder = new TextDecoder('utf-8')

/**
 * 处理一个 `gradle.*` 事件；`false` 表示这条消息不属于本通道（调用方继续往下的分支）。
 */
export function handleGradleEvent(event: string | undefined, data: GradleEventData): boolean {
  switch (event) {
    case 'gradle.started':
      if (typeof data.command !== 'string') return false
      decoder.decode()  // 丢掉上一轮残留的分块状态
      gradleSync.running = true
      gradleSync.command = data.command
      gradleSync.output = ''
      gradleSync.exit = null
      gradleSync.cancelled = false
      gradleSync.at = gradleSync.startedAt = Date.now()
      return true
    case 'gradle.output': {
      if (typeof data.dataB64 !== 'string') return false
      const text = decoder.decode(fromBase64(data.dataB64), { stream: true })
      if (!text) return true
      gradleSync.output += text
      if (gradleSync.output.length > GRADLE_OUTPUT_LIMIT)
        gradleSync.output = gradleSync.output.slice(gradleSync.output.length - GRADLE_OUTPUT_LIMIT / 2)
      return true
    }
    case 'gradle.exit': {
      if (typeof data.code !== 'number') return false
      const tail = decoder.decode()
      if (tail) gradleSync.output += tail
      gradleSync.running = false
      gradleSync.exit = data.code
      gradleSync.cancelled = data.cancelled === true
      gradleSync.at = Date.now()
      return true
    }
    default:
      return false
  }
}
