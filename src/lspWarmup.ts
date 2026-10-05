// 语言服务**导入期**的重试（真机取证发现的缺陷：JDT 在一个大工程上要 9.5 分钟才给出符号，
// 这期间发过去的 `documentSymbol`/`semanticTokens` 一律 60 秒超时 —— 而调用方只发一次、
// 失败被 catch 吞掉，于是「导入期间打开的文件在导入完成后一直没颜色、结构面板一直空」）。
//
// 上游没有这条：IDEA 的 daemon 是**跟着索引状态**自己重启一轮高亮（`DaemonCodeAnalyzerImpl`
// 在 `DumbService` 退出后重新跑 pass），本仓的语言服务是外部的，只能靠"失败了隔一会儿再试"
// 把同一件事做出来。规则：
//   · 只在**失败**时重试（成功一次就停）；
//   · 退避：10s、20s、40s、80s、160s（上限 5 次，总窗口约 5 分钟，够覆盖本机实测的导入时长）；
//   · 任何一次成功后连**在途的重试计划一起取消**（否则后续会有无谓的重复请求）；
//   · 调用方换文件/关标签时显式 `cancel()`。
//
// 定时器与时钟都注入（`now`/`setTimeout`/`clearTimeout`），所以判据里能拿假时钟跑完整个退避序列。
export interface WarmupAttempt {
  /** 第几次尝试（从 1 开始）。 */
  attempt: number
  /** 上一次为什么失败（第一次为空）。 */
  lastError: string
}

export interface WarmupDeps {
  /** 真正做一次请求；成功返回 true（内部失败要 catch 成 false，或抛出 —— 两者都当"没成功"）。 */
  run: (attempt: WarmupAttempt) => Promise<boolean> | boolean
  /** 全部失败后（或成功前被取消）调用一次；`reason` 说明为什么停。 */
  onGiveUp?: (reason: 'exhausted' | 'cancelled', lastError: string) => void
  /** 成功时（含第一次就成功）调用；参数是第几次尝试成功的。 */
  onSuccess?: (attempt: number) => void
  setTimeout?: (handler: () => void, ms: number) => number
  clearTimeout?: (handle: number) => void
}

/** 退避档（毫秒）：10s → 20s → 40s → 80s → 160s。 */
export const WARMUP_DELAYS_MS = [10_000, 20_000, 40_000, 80_000, 160_000] as const

export class LspWarmup {
  private readonly deps: Required<Pick<WarmupDeps, 'setTimeout' | 'clearTimeout'>> & WarmupDeps
  private timer: number | undefined
  private attempt = 0
  private lastError = ''
  private running = false
  private cancelled = false

  constructor(deps: WarmupDeps) {
    this.deps = {
      ...deps,
      setTimeout: deps.setTimeout ?? ((handler, ms) => window.setTimeout(handler, ms)),
      clearTimeout: deps.clearTimeout ?? (handle => window.clearTimeout(handle)),
    }
  }

  /** 第一次尝试立即跑；失败才排重试。重复 `start()` 会先取消上一次计划（同一文件刷新时用）。 */
  start(): void {
    this.cancel()
    this.cancelled = false
    void this.attemptOnce()
  }

  /** 换文件/关标签/语言服务关掉时调用：撤掉在途的重试，不再回调。 */
  cancel(): void {
    this.cancelled = true
    this.attempt = 0
    this.lastError = ''
    if (this.timer !== undefined) {
      this.deps.clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  /** 成功过一次之后还有没有计划在跑（判据与调试用）。 */
  get pending(): boolean {
    return this.timer !== undefined
  }

  get tries(): number {
    return this.attempt
  }

  private async attemptOnce(): Promise<void> {
    if (this.cancelled || this.running) return
    this.running = true
    this.attempt += 1
    const attempt = this.attempt
    let ok = false
    try {
      ok = await this.deps.run({ attempt, lastError: this.lastError })
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      ok = false
    } finally {
      this.running = false
    }
    if (this.cancelled) return
    if (ok) {
      this.attempt = 0
      this.deps.onSuccess?.(attempt)
      return
    }
    const delay = WARMUP_DELAYS_MS[attempt - 1]
    if (delay === undefined) {
      this.deps.onGiveUp?.('exhausted', this.lastError)
      this.attempt = 0
      return
    }
    this.timer = this.deps.setTimeout(() => {
      this.timer = undefined
      void this.attemptOnce()
    }, delay)
  }
}
