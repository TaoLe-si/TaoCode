// exec/testframework：**自动测试**（上游 `platform/testRunner` 的
// `autotest/ToggleAutoTestAction` / `AbstractAutoTestManager` / `DelayedDocumentWatcher`）。
//
// 上游依据（`platform/testRunner/src/com/intellij/execution/testframework/autotest/`）：
//   · `ToggleAutoTestAction.java:20-27` —— 一个 `ToggleAction`，文案取自
//     `platform-api/resources/messages/IdeBundle.properties:1522`
//     （`action.ToggleAction.text.toggle.auto.test=Rerun Automatically`），工具栏位置；
//     `:30-34` `isSelected` = 该运行配置开着自动测试；`:42-49` `setSelected` 交给 manager；
//   · `AbstractAutoTestManager.java:41-42` —— 延迟键 `auto.test.manager.delay`，
//     **默认 3000ms**；`:49-52` 从 `PropertiesComponent` 读回来；
//   · `:121-138` `setAutoTestEnabled` —— 开启就装 watcher，关闭且没有别的开启项就卸 watcher；
//   · `:188-218` `restartAutoTest` —— 进程还在跑就**挂一个终止监听**，进程结束后再重启
//     （`scheduleRestartOnTermination`），不会打断正在跑的那次；
//   · `:220-231` `getDelay` / `setDelay` —— 改延迟会先卸 watcher 再按需重装；
//   · `DelayedDocumentWatcher.java` —— 文档改动后延迟触发（本仓用 `fileText` 变化当改动信号）。
//
// 本仓的等价物：`AutoTestManager`（开关 + 延迟 + 落盘到 localStorage 的同名键）、
// `createAutoTestWatcher`（延迟到点后回调；进程在跑就等退出 —— 由调用方给 `isRunning`）。
// 消费点：`src/components/TestRunnerPanel.vue` 的「自动测试」开关 + 延迟输入，
// 判据 `tests/auto-test.test.mjs`。
/** 上游的存储键（`AbstractAutoTestManager.java:41`）。 */
export const AUTO_TEST_DELAY_KEY = 'auto.test.manager.delay'
/** 上游默认延迟 3000ms（`AbstractAutoTestManager.java:42`）。 */
export const AUTO_TEST_DELAY_DEFAULT = 3000
/** 上游的开关文案（IdeBundle.properties:1522）。 */
export const AUTO_TEST_TOGGLE_NAME = 'Rerun Automatically'

export interface AutoTestStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function readAutoTestDelay(storage: AutoTestStorage | null | undefined): number {
  const raw = storage?.getItem(AUTO_TEST_DELAY_KEY)
  const value = raw === null || raw === undefined || raw === '' ? Number.NaN : Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : AUTO_TEST_DELAY_DEFAULT
}

export function writeAutoTestDelay(storage: AutoTestStorage | null | undefined, delay: number): void {
  if (!storage) return
  const value = Number.isFinite(delay) && delay >= 0 ? Math.round(delay) : AUTO_TEST_DELAY_DEFAULT
  storage.setItem(AUTO_TEST_DELAY_KEY, String(value))
}

export interface AutoTestWatcher {
  /** 立刻重跑（`AbstractAutoTestManager.restart`，:68-76）。 */
  trigger(): void
  /** 收尾：清掉挂起的定时器（面板卸载 / 关闭开关时调）。 */
  cancel(): void
}

/**
 * 改动后延迟重跑。`schedule` 每次调用都**推后**计时（上游 `DelayedDocumentWatcher` 的口径：
 * 连续改动不叠加成一串重启）；到点时若 `isRunning()` 为真，就交给 `onTerminated`
 * 在进程退出后再来一次（`AbstractAutoTestManager.scheduleRestartOnTermination`，:198-218）。
 */
export function createAutoTestWatcher(options: {
  delayMs: number
  run: () => void
  isRunning: () => boolean
  onTerminated: (run: () => void) => void
  setTimer?: (handler: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}): AutoTestWatcher {
  const schedule = options.setTimer ?? ((handler: () => void, ms: number) => setTimeout(handler, ms))
  const cancelTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let handle: unknown = null
  const fire = () => {
    handle = null
    if (options.isRunning()) options.onTerminated(options.run)
    else options.run()
  }
  return {
    trigger() {
      if (handle !== null) cancelTimer(handle)
      handle = schedule(fire, Math.max(0, options.delayMs))
    },
    cancel() { if (handle !== null) { cancelTimer(handle); handle = null } },
  }
}

/** 开关状态（`ToggleAutoTestAction` 的 `isSelected`/`setSelected` 那一对）。 */
export class AutoTestManager {
  private enabled: boolean
  private delay: number
  // 注意：这里**不能**写 `constructor(private readonly storage: ...)` —— 参数属性是 TS 的
  // 类型扩展语法，Node 22 直跑 .ts 用的是 strip-only 类型擦除，遇到它整个模块加载就失败
  // （`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`），症状是「import 它的测试全红」而不是某条断言挂。
  // 显式字段即可（样板见 src/breakpointLocations.ts:60-67）。
  private readonly storage: AutoTestStorage | null | undefined

  constructor(storage: AutoTestStorage | null | undefined, enabled = false) {
    this.storage = storage
    this.enabled = enabled
    this.delay = readAutoTestDelay(storage)
  }

  isEnabled(): boolean { return this.enabled }
  getDelay(): number { return this.delay }
  setEnabled(enabled: boolean): void { this.enabled = enabled }
  /** 改延迟会先取消挂起的 watcher（上游 `setDelay` 的卸/装顺序，:224-231）。 */
  setDelay(delay: number, cancel?: () => void): number {
    cancel?.()
    this.delay = Number.isFinite(delay) && delay >= 0 ? Math.round(delay) : AUTO_TEST_DELAY_DEFAULT
    writeAutoTestDelay(this.storage, this.delay)
    return this.delay
  }
}
