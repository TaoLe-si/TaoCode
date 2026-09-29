// 终端的宿主事件通道（`term.output` / `term.exit`）与它的订阅表。
//
// 从 src/bridge.ts 拆出（2026-09-27：接 Gradle 通道时 bridge.ts 顶到机检上限）。
// 为什么单独一个模块：终端的订阅是**按 id 的多个订阅者**（面板 + 调试适配器开的终端各订各的），
// 这与"一个全局 reactive 状态"的其它通道形状不同，混在 bridge.ts 里读起来像特例。
//
// 有一条真实的对冲逻辑在这里：terminal 还没被订阅时到达的输出要**先缓冲**（否则面板挂载前
// 那几毫秒的输出会永久丢失），缓冲有上限（256 块），订阅时一次性冲给订阅者。
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
