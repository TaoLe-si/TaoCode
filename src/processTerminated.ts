// 进程结束时的"完成 + 退出码"一条（IDEA `ProcessTerminatedListener`）。
//
// 上游 `platform/ide-core/src/com/intellij/execution/process/ProcessTerminatedListener.java`：
//   · 文案模板：IdeCoreBundle.properties:131 `finished.with.exit.code.text.message=
//     Process finished with exit code {0}`；`attach(handler, project)`（`:45-49`）给的是
//     `"\n" + message + "\n"` —— 前后各一个换行，最后落在控制台里。
//   · `:59-66` `processTerminated`：把模板里的 `$EXIT_CODE$` 换成 `stringifyExitCode(exitCode)`，
//     以 **SYSTEM** 类型写进控制台（`notifyTextAvailable(message, ProcessOutputTypes.SYSTEM)`），
//     并 `invokeLater { StatusBar.Info.set(message, project) }` —— **同一句话两处显示**。
//   · `:75-93` `stringifyExitCode`：Windows 上 `0xC0000000..0xD0000000` 视为失败码，
//     追加 `(0x…大写十六进制)`；`0xC000013A` 再补 `: interrupted by Ctrl+C`。
//     Unix 上按信号表反查，追加 `(interrupted by signal N:SIGNAME)`。
//
// 本仓的分工：控制台那半边已经存在（`bridge.ts` 把 `run.exit` 写成 telemetry/stderr 行），
// 本模块负责**状态栏那半边** —— 也就是此前根本没有的实现（状态栏文字是硬编码的）。
//
// 信号表抄上游 `platform/eel/src/com/intellij/platform/eel/UnixSignal.kt:18-45`，
// 含 `EXIT_CODE_OFFSET = 128`（`:55`）：shell 用 `128 + 信号号` 作为进程退出码。
// Windows 与 Unix 的**两套号**分开存（`SIGBUS` BSD 10 / Linux 7 等，见 `:22-44`）。

import { setStatusText } from './statusBarText.ts'

/** `IdeCoreBundle.properties:131`。 */
export const PROCESS_FINISHED_TEMPLATE = '进程已结束，退出码 {0}'

/** 上游 `stringifyExitCode` 写进控制台时前后各一个换行（`:45-49`）。 */
export function processFinishedConsoleText(exitCode: number, os: 'windows' | 'unix' = currentOs()): string {
  return `\n${processFinishedText(exitCode, os)}\n`
}

/** 状态栏那一句（不带前后换行）。 */
export function processFinishedText(exitCode: number, os: 'windows' | 'unix' = currentOs()): string {
  return PROCESS_FINISHED_TEMPLATE.replace('{0}', stringifyExitCode(exitCode, os))
}

export type HostOs = 'windows' | 'unix'

/** 本仓是 WebView2 宿主，运行时按平台判断；非 Windows 一律按 Unix 信号表处理。 */
export function currentOs(): HostOs {
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform ?? ''
  return /win/i.test(platform) ? 'windows' : 'unix'
}

/** 一个 Unix 信号：BSD 与 Linux 两套号（上游 `UnixSignal` 的 `bsdCode`/`linuxCode`）。 */
interface Signal { name: string; bsd: number; linux: number }

/** 抄自 `UnixSignal.kt:18-45`（单值构造的取同一个号）。 */
const SIGNALS: readonly Signal[] = [
  { name: 'SIGHUP', bsd: 1, linux: 1 },
  { name: 'SIGINT', bsd: 2, linux: 2 },
  { name: 'SIGQUIT', bsd: 3, linux: 3 },
  { name: 'SIGILL', bsd: 4, linux: 4 },
  { name: 'SIGTRAP', bsd: 5, linux: 5 },
  { name: 'SIGABRT', bsd: 6, linux: 6 },
  { name: 'SIGBUS', bsd: 10, linux: 7 },
  { name: 'SIGFPE', bsd: 8, linux: 8 },
  { name: 'SIGKILL', bsd: 9, linux: 9 },
  { name: 'SIGUSR1', bsd: 30, linux: 10 },
  { name: 'SIGSEGV', bsd: 11, linux: 11 },
  { name: 'SIGUSR2', bsd: 31, linux: 12 },
  { name: 'SIGPIPE', bsd: 13, linux: 13 },
  { name: 'SIGALRM', bsd: 14, linux: 14 },
  { name: 'SIGTERM', bsd: 15, linux: 15 },
  { name: 'SIGCHLD', bsd: 20, linux: 17 },
  { name: 'SIGCONT', bsd: 19, linux: 18 },
  { name: 'SIGSTOP', bsd: 17, linux: 19 },
  { name: 'SIGTSTP', bsd: 18, linux: 20 },
  { name: 'SIGTTIN', bsd: 21, linux: 21 },
  { name: 'SIGTTOU', bsd: 22, linux: 22 },
  { name: 'SIGURG', bsd: 16, linux: 23 },
  { name: 'SIGXCPU', bsd: 24, linux: 24 },
  { name: 'SIGXFSZ', bsd: 25, linux: 25 },
  { name: 'SIGVTALRM', bsd: 26, linux: 26 },
  { name: 'SIGPROF', bsd: 27, linux: 27 },
  { name: 'SIGWINCH', bsd: 28, linux: 28 },
  { name: 'SIGIO', bsd: 23, linux: 29 },
  { name: 'SIGSYS', bsd: 12, linux: 31 },
]

/** `UnixSignal.EXIT_CODE_OFFSET`（`UnixSignal.kt:55`）。 */
export const EXIT_CODE_OFFSET = 128

/** Windows 失败码区间 `[0xC0000000, 0xD0000000)`（`ProcessTerminatedListener.java:76`）。 */
export const WINDOWS_ERROR_CODE_MIN = 0xC0000000
export const WINDOWS_ERROR_CODE_MAX = 0xD0000000
/** `STATUS_CONTROL_C_EXIT`（`:78-80` 的 `0xC000013A`）。 */
export const STATUS_CONTROL_C_EXIT = 0xC000013A

/**
 * `ProcessTerminatedListener.stringifyExitCode`（`:75-93`）。
 * `bsd` 决定用信号表的哪一套号（macOS/BSD 与 Linux 不同）。
 */
export function stringifyExitCode(exitCode: number, os: HostOs = currentOs(), bsd = false): string {
  if (os === 'windows') {
    // 上游只在这个区间里解释失败码；负数（本仓 aborted 时写 -1）按原样给。
    if (exitCode >= WINDOWS_ERROR_CODE_MIN && exitCode < WINDOWS_ERROR_CODE_MAX) {
      let text = `${exitCode} (0x${toUpperHex(exitCode)})`
      if (exitCode === STATUS_CONTROL_C_EXIT) text += ': interrupted by Ctrl+C'
      return text
    }
    return String(exitCode)
  }
  const signal = SIGNALS.find(entry => (bsd ? entry.bsd : entry.linux) + EXIT_CODE_OFFSET === exitCode)
  if (signal === null || signal === undefined) return String(exitCode)
  return `${exitCode} (interrupted by signal ${bsd ? signal.bsd : signal.linux}:${signal.name})`
}

/** Java `Integer.toHexString` 的大写形式（`StringUtil.toUpperCase`，`:77`）。 */
function toUpperHex(value: number): string {
  return (value >>> 0).toString(16).toUpperCase()
}

/**
 * `ProcessTerminatedListener.processTerminated`（`:59-66`）的两处输出：控制台那一行（带前后换行）
 * 与状态栏那一条。返回控制台行；`null` = 这次不播报。
 *
 * `aborted` 时**不播报**：本仓 `native/run_host.cpp` 的用户主动停止用 `code = -1` 作哨兵
 * （`stop_instance`），那不是进程真实退出码 —— 报「退出码 -1」是编造数字。中止那一路
 * 宿主自己已经往控制台写了「链已中止…」一行（`advance`），这里不重复。
 */
export function announceProcessTerminated(exitCode: number, aborted = false, os: HostOs = currentOs()): string | null {
  if (aborted) return null
  const text = processFinishedText(exitCode, os)
  setStatusText(text)
  return processFinishedConsoleText(exitCode, os)
}

/**
 * `run.exit` 事件的整段处理：只在**整条链结束**时播报（`remaining === 0`）——
 * 上游 `attach` 是挂在**一个** ProcessHandler 上的，而本仓一条配置会以 `remaining > 0`
 * 连发每步的退出（`native/run_host.cpp` 的链式步骤），每步都报就会刷屏。
 * 返回控制台那一行（`null` = 不写），调用方负责把它交给 `handleRunOutput`。
 */
export function runExitAnnouncement(data: { code: number; remaining?: number; aborted?: boolean }): string | null {
  const remaining = typeof data.remaining === 'number' ? data.remaining : 0
  if (remaining !== 0) return null
  return announceProcessTerminated(data.code, data.aborted === true)
}
