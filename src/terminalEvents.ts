// 终端的宿主事件通道（`term.output` / `term.exit` / `term.bell`）与它的订阅表。
//
// 从 src/bridge.ts 拆出（2026-09-27：接 Gradle 通道时 bridge.ts 顶到机检上限）。
// 为什么单独一个模块：终端的订阅是**按 id 的多个订阅者**（面板 + 调试适配器开的终端各订各的），
// 这与"一个全局 reactive 状态"的其它通道形状不同，混在 bridge.ts 里读起来像特例。
//
// 有一条真实的对冲逻辑在这里：terminal 还没被订阅时到达的输出要**先缓冲**（否则面板挂载前
// 那几毫秒的输出会永久丢失），缓冲有上限（256 块），订阅时一次性冲给订阅者。
//
// 响铃（`term.bell`）走的是**相反**的口径，两件事都写在下面 `deliverTermBell` 上：
// 迟到的输出仍有意义，迟到的响铃只会为"已经过去了的事"响一下 ⇒ 它不进缓冲，也没订阅者就丢。
import { beep } from './notificationBeeper.ts'
import { fromBase64 } from './base64.ts'

export interface TermCreateResult { id: number }

const termListeners = new Map<number, Set<(bytes: Uint8Array) => void>>()
const termPending = new Map<number, Uint8Array[]>()
// A shell that exits on its own used to keep its slot forever, so after 64 dead
// sessions the terminal could not be created at all. `term.exit` releases the slot.
const termExitListeners = new Map<number, Set<(code: number) => void>>()

export function subscribeTermExit(id: number, onExit: (code: number) => void): () => void {
  const listeners = termExitListeners.get(id) ?? new Set()
  termExitListeners.set(id, listeners)
  listeners.add(onExit)
  return () => {
    listeners.delete(onExit)
    if (!listeners.size) termExitListeners.delete(id)
  }
}

export function emitTermExit(id: number, code: number): void {
  const listeners = termExitListeners.get(id)
  if (!listeners?.size) return
  for (const listener of listeners) listener(code)
}

// Subscribe to a terminal's raw output; anything buffered before subscribing flushes.
export function subscribeTerm(id: number, onBytes: (bytes: Uint8Array) => void): () => void {
  const listeners = termListeners.get(id) ?? new Set()
  termListeners.set(id, listeners)
  listeners.add(onBytes)
  for (const chunk of termPending.get(id) ?? []) onBytes(chunk)
  termPending.delete(id)
  return () => {
    listeners.delete(onBytes)
    if (!listeners.size) termListeners.delete(id)
  }
}

/**
 * 一个 `term.output` 事件：有订阅者就直接发，没有就先缓冲（上限 256 块，丢最旧的）。
 * 返回 `false` 表示这条消息的形状不对（不是终端输出）。
 */
export function deliverTermOutput(id: unknown, dataB64: unknown): boolean {
  if (typeof id !== 'number' || typeof dataB64 !== 'string') return false
  const bytes = fromBase64(dataB64)
  const listeners = termListeners.get(id)
  if (listeners?.size) for (const notify of listeners) notify(bytes)
  else {
    const queue = termPending.get(id) ?? []
    queue.push(bytes)
    if (queue.length > 256) queue.shift()
    termPending.set(id, queue)
  }
  return true
}

// --- 响铃（audible bell）------------------------------------------------------------------
//
// 宿主侧通道的两头：源头是 native 读线程在输出流里认出的**真** BEL（`native/terminal_bell.cpp`
// —— OSC 标题那个收尾的 BEL 不算，否则带标题的 shell 每个提示符都响一次），事件名 `term.bell`；
// 出口是这里。上游的门只有一档，抄那一档：
//
//   · `TerminalSessionController.kt:111-113`：`is TerminalBeepEvent -> if (settings.audibleBell()) Toolkit.beep()`
//   · 那一档的缺省值：`TerminalOptionsProvider.kt:76` 的 `var mySoundBell: Boolean = true`
//     （`JBTerminalSystemSettingsProvider.java:64-66` 把它转成 `audibleBell()`）
//
// 块视图那条多一档门（`TerminalAlarmManager.kt:12-14` 的 `commandIsRunning && audibleBell()`），
// 那个 `commandIsRunning` 来自 shell 集成（OSC 133 的命令起止）。本仓的宿主是裸 ConPTY、
// 面板也没有 OSC 133 的解析，所以那一档**没有输入可问** ⇒ 不复制（不是"选择忽略"，是"核实过拿不到"，
// 详见 docs/batch-2026-10-06-termbell.md §5）。
//
// 发声本身复用既有通知出口 `notificationBeeper.beep()`（Web Audio 合成两声短音，
// 拿不到 AudioContext 就安静跳过 —— 那条降级已经在那个模块里实现了，这里不再写一遍）。

/** `term.bell` 的按 id 订阅者（面板要用它闪自己那一格，与有没有声音是两回事）。 */
export type TermBellListener = (id: number) => void
const termBellListeners = new Map<number, Set<TermBellListener>>()

export function subscribeTermBell(id: number, onBell: TermBellListener): () => void {
  const listeners = termBellListeners.get(id) ?? new Set()
  termBellListeners.set(id, listeners)
  listeners.add(onBell)
  return () => {
    listeners.delete(onBell)
    if (!listeners.size) termBellListeners.delete(id)
  }
}

/** `TerminalOptionsProvider.kt:76` 的缺省：响铃是开的。 */
export const TERMINAL_BELL_AUDIBLE_DEFAULT = true

/**
 * 上游那一档门。两种取法都在（谁手上有设置谁用哪种）：
 *   · **按值**（上游的形状）：`terminalBellMakesSound(settings)` —— 判据与调用点直接给 `{ audibleBell }`，
 *     `settings.audibleBell ?? TERMINAL_BELL_AUDIBLE_DEFAULT`，只有**显式 false** 才关（垃圾值关不掉）。
 *   · **推进来**：事件从 `src/bridge.ts` 的事件分派表进来，而那里**读不到设置**（它手里只有事件的形状），
 *     所以持有设置的那一方（`src/App.vue`）可以 `setTerminalBellAudible(on)` 推一次，之后每条事件自动过门。
 *     没推过（`null`）就回缺省。本批**不新增持久化键**（六处成对 ⇒ §6 的请求）。
 */
let audibleBell: boolean | null = null
export function setTerminalBellAudible(on: boolean | null): void { audibleBell = on }

/** 上游那一档门的纯函数形态：给了设置就照它，没给就看推进来的值，都没就缺省 true。 */
export function terminalBellMakesSound(settings?: { audibleBell?: boolean } | null): boolean {
  const fromSettings = settings?.audibleBell
  if (fromSettings !== undefined) return fromSettings
  return audibleBell ?? TERMINAL_BELL_AUDIBLE_DEFAULT
}

/** 宿主出口（发声/闪烁都从这里走）。默认 = 既有通知提示音。 */
export type TermBellOutlet = (id: number) => void
let bellOutlet: TermBellOutlet | null = null

/**
 * 换掉出口：判据注入计数用的假出口，接线那一步换成交付给窗口的实现。
 * 传 null 回到默认（`notificationBeeper.beep()`）。出口自己响不出声不该打断事件链，
 * 所以这里照 `notificationBeeper.beep()` 的口径吞掉异常。
 */
export function setTerminalBellOutlet(outlet: TermBellOutlet | null): void { bellOutlet = outlet }

/**
 * 一个 `term.bell` 事件。返回 `false` 表示这条消息的形状不对（照 `deliverTermOutput` 的口径，
 * 终端 id 是正的且永不复用，见 `native/terminal.hpp` 的 create() 注释）。
 *
 * 两件事各自独立：
 *   · 出口（响不响）只问 `audibleBell` 那一档门；
 *   · 订阅者（面板闪不闪）**不管门**，照单全收 —— 门管的是"有没有声音"，不是"发生了没有"。
 * 没有订阅者也不缓冲：一次已经过去的响铃不值得补响。
 */
export function deliverTermBell(id: unknown, settings?: { audibleBell?: boolean } | null): boolean {
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return false
  const listeners = termBellListeners.get(id)
  if (listeners?.size) for (const notify of [...listeners]) notify(id)
  if (terminalBellMakesSound(settings)) {
    // 默认出口不认终端 id（提示音就是提示音）；接线的出口要按 id 决定闪哪一格。
    try { if (bellOutlet) bellOutlet(id); else beep() } catch { /* 响不出声不该打断终端事件链 */ }
  }
  return true
}
