// DAP 会话的**运行时状态**与「适配器推来的事件怎么落地」的规则。
//
// 从 src/bridge.ts 拆出（2026-10-08：bridge.ts 顶到机检上限 ⇒ 按职责拆一次，与 gradleEvents /
// terminalEvents / searchStream 同一拆法）。为什么这算一个职责域：下面这些 reactive 表**全部**由
// 适配器推来的 `dap.event` 喂起来（唯一例外是能力位，由 initialize 的响应喂），
// "送到之后落到哪一格"是一条独立的规则 —— 判词见 `applyDapBreakpoint`：`verified` 报的是适配器
// 实际绑定的行，用户从没设过的行不落地。
//
// 留在 src/bridge.ts 的：请求侧封装（dap.start / dap.stackTrace / …，只描述"方法名 + 参数形状"）
// 与线上形状 `DapEvent` / `DapBreakpoint`（原生分派与面板都要引用，且是机检锚点）。
// 本模块的公开符号都经 src/bridge.ts **原样转出**，既有 `import … from './bridge'` 一行都不用改。
import { reactive } from 'vue'
import type { DapBreakpoint, DapEvent } from './bridge.ts'

export const dapState = reactive<{ running: boolean; paused: boolean; threadId: number; reason: string | null; program: string | null; currentLocation: { path: string; line: number } | null; exitCode: number | null }>(
  { running: false, paused: false, threadId: 1, reason: null, program: null, currentLocation: null, exitCode: null })
export const dapConsole = reactive<Array<{ category: string; text: string }>>([])
export const dapBreakpoints = reactive(new Map<string, DapBreakpoint[]>())  // rel path -> breakpoints
// The three lists below are what the adapter's `progress` / `module` / `loadedSource`
// events build up. They are separate from `dapState` because they are collections
// the panel renders as rows, not fields of the session.
export interface DapProgress { id: string; requestId: string | null; title: string; message: string; percentage: number | null }
export interface DapModule { id: string; name: string; type?: string; sourceReference?: number; path?: string; version?: string; symbolStatus?: string; addressRange?: string; isOptimized?: boolean; isUserCode?: boolean; symbolFilePath?: string; dateTimeStamp?: string }
export interface DapLoadedSource { key: string; name: string; sourceReference?: number; path?: string }
export const dapProgress = reactive<DapProgress[]>([])
export const dapModules = reactive<DapModule[]>([])
export const dapLoadedSources = reactive<DapLoadedSource[]>([])
// The adapter's thread list can change between two stops. The bridge cannot push
// into a component's own ref, so it bumps this and the panel refetches — the same
// `version` signal the file watcher uses.
export const dapThreadSignal = reactive<{ version: number; reason: string | null; threadId: number | null }>(
  { version: 0, reason: null, threadId: null })
let dapThreadId = 1
export const dapCurrentThread = () => dapThreadId
export function dapSetCurrentLocation(location: { path: string; line: number } | null) { dapState.currentLocation = location }
export function dapSelectThread(threadId: number) { if (Number.isInteger(threadId) && threadId > 0) { dapThreadId = threadId; dapState.threadId = threadId } }

// 适配器在 initialize 响应里声明的能力（原样转发）。新增入口全部由能力位门控 ——
// 规范里 supportsStepBack / supportsReadMemoryRequest / supportsDisassembleRequest /
// supportsLoadedSourcesRequest / supportsModulesRequest 都**默认 false**，面板据此不渲染入口。
export const dapCapabilities = reactive<Record<string, unknown>>({})
export const dapCapability = (name: string) => dapCapabilities[name] === true
export function dapRememberCapabilities(capabilities: Record<string, unknown> | undefined) {
  for (const key of Object.keys(dapCapabilities)) delete dapCapabilities[key]
  Object.assign(dapCapabilities, capabilities ?? {})
}

// DAP ids are "string | number" depending on the adapter; every list here is keyed
// by the string form so a numeric and a textual id for the same thing cannot both
// land in the list.
function idKey(raw: unknown): string | null {
  if (typeof raw === 'string') return raw || null
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  return null
}
let unnamedProgress = 0
function applyDapProgress(payload: { phase?: unknown; progressId?: unknown; requestId?: unknown; title?: unknown; message?: unknown; percentage?: unknown }) {
  const phase = payload.phase
  if (phase !== 'start' && phase !== 'update' && phase !== 'end') return
  const key = idKey(payload.progressId)
  // DAP makes progressId mandatory. An adapter that leaves it out still describes
  // one operation: a start opens its own row under a synthetic key, while an
  // update/end can only mean the newest operation still in flight.
  const id = key ?? (phase === 'start' ? `progress-${++unnamedProgress}` : dapProgress[dapProgress.length - 1]?.id)
  if (!id) return
  const existing = dapProgress.find(entry => entry.id === id)
  if (phase === 'end') {
    if (existing) dapProgress.splice(dapProgress.indexOf(existing), 1)
    return
  }
  const message = typeof payload.message === 'string' ? payload.message : ''
  const percentage = typeof payload.percentage === 'number' && Number.isFinite(payload.percentage) ? payload.percentage : null
  if (phase === 'update') {
    // A partial update keeps what it does not mention: percentage is often omitted
    // once an operation becomes indeterminate.
    if (!existing) return
    if (message) existing.message = message
    if (percentage !== null) existing.percentage = percentage
    return
  }
  const title = typeof payload.title === 'string' ? payload.title : existing?.title ?? ''
  // 'start' for something already open refreshes it; adapters replay their list
  // after a restart and a second row for one operation would be a lie.
  if (existing) { existing.title = title; existing.message = message; existing.percentage = percentage; return }
  dapProgress.push({ id, requestId: idKey(payload.requestId), title, message, percentage })
}
// The adapter reports what it actually bound, which can differ from what the user
// asked for: a breakpoint dropped on a blank line is moved to the next line the
// adapter can bind. `dapBreakpoints` is what the editor gutter draws from, so
// fixing it here moves the mark without the editor polling for it.
// Where each breakpoint id was last reported. The adapter identifies a breakpoint
// by id across events, so remembering it turns "the line moved" from a guess into
// a fact. Ids are session-scoped, so this is cleared with the session.
const dapBreakpointIds = new Map<string, { path: string; line: number }>()
function applyDapBreakpoint(payload: { verified?: unknown; line?: unknown; path?: unknown; id?: unknown }) {
  const path = typeof payload.path === 'string' ? payload.path : ''
  const line = typeof payload.line === 'number' && Number.isFinite(payload.line) ? Math.trunc(payload.line) : 0
  if (!path || line < 1) return  // nothing to attribute the report to
  const verified = payload.verified === true
  const id = idKey(payload.id)
  // A move is exact when the same id was seen before at a different line of the
  // same file: that row is the one that moved. Read the previous report before it
  // is replaced by this one, otherwise there is nothing to compare against.
  const known = id ? dapBreakpointIds.get(id) : undefined
  const from = known && known.path === path ? known.line : 0
  if (id) dapBreakpointIds.set(id, { path, line })
  const list = dapBreakpoints.get(path) ?? []
  const target = list.find(point => point.line === line)
    ?? (from && from !== line ? list.find(point => point.line === from) : undefined)
    // No id, or this is the first report for it: a verified line that is not in the
    // local list can only be matched by elimination — when exactly one breakpoint
    // of this file is still unconfirmed, that is the one the adapter moved.
    ?? (verified && list.filter(point => point.verified !== true).length === 1
      ? list.find(point => point.verified !== true) : undefined)
  if (!target) {
    // Nothing here is ours: either the adapter is reporting a breakpoint this
    // client never set (another client, a function breakpoint resolved to a line),
    // or it rejected a line nobody asked for. The latter is not worth a row.
    if (!verified) return
    dapBreakpoints.set(path, [...list, { line, verified: true }].sort((a, b) => a.line - b.line))
    return
  }
  if (target.line !== line) {
    target.line = line
    dapBreakpoints.set(path, [...list].sort((a, b) => a.line - b.line))
  }
  target.verified = verified
}
function applyDapThread(payload: { reason?: unknown; threadId?: unknown; body?: { reason?: unknown; threadId?: unknown } }) {
  const body = payload.body
  const reason = typeof payload.reason === 'string' ? payload.reason : typeof body?.reason === 'string' ? body.reason : null
  const raw = typeof payload.threadId === 'number' ? payload.threadId : typeof body?.threadId === 'number' ? body.threadId : null
  dapThreadSignal.reason = reason
  dapThreadSignal.threadId = raw
  // The panel refetches `dap.threads` on this; the bridge does not keep a thread
  // list of its own that could drift from the adapter's.
  dapThreadSignal.version++
}
function applyDapModule(payload: { reason?: unknown; module?: { id?: unknown; name?: unknown; type?: unknown; sourceReference?: unknown }; path?: unknown }) {
  const id = idKey(payload.module?.id)
  if (!id) return
  const existing = dapModules.find(entry => entry.id === id)
  if (payload.reason === 'removed') {
    if (existing) dapModules.splice(dapModules.indexOf(existing), 1)
    return
  }
  const next: DapModule = { id, name: typeof payload.module?.name === 'string' ? payload.module.name : '' }
  const type = typeof payload.module?.type === 'string' ? payload.module.type : ''
  if (type) next.type = type
  const reference = typeof payload.module?.sourceReference === 'number' ? payload.module.sourceReference : 0
  if (reference) next.sourceReference = reference
  if (typeof payload.path === 'string' && payload.path) next.path = payload.path
  // 'new' for something already known is the same as 'changed': adapters replay the
  // whole list after a restart, and a duplicate row would be a lie.
  if (existing) Object.assign(existing, next)
  else dapModules.push(next)
}
function applyDapLoadedSource(payload: { reason?: unknown; source?: { name?: unknown; sourceReference?: unknown }; path?: unknown }) {
  const name = typeof payload.source?.name === 'string' ? payload.source.name : ''
  const path = typeof payload.path === 'string' ? payload.path : ''
  const reference = typeof payload.source?.sourceReference === 'number' ? payload.source.sourceReference : 0
  // No id in the event: the source reference identifies it when the adapter has
  // one, otherwise the path, otherwise the display name.
  const key = reference ? `ref:${reference}` : path ? `path:${path}` : `name:${name}`
  const existing = dapLoadedSources.find(entry => entry.key === key)
  if (payload.reason === 'removed') {
    if (existing) dapLoadedSources.splice(dapLoadedSources.indexOf(existing), 1)
    return
  }
  const next: DapLoadedSource = { key, name }
  if (reference) next.sourceReference = reference
  if (path) next.path = path
  if (existing) Object.assign(existing, next)
  else dapLoadedSources.push(next)
}

export function applyDapEvent(event: DapEvent) {
  // One switch on the event name: the shapes are a closed set, and a switch makes
  // an unhandled event obvious (it lands in the default instead of silently
  // falling off the end of an if/else chain).
  switch (event.event) {
    case 'stopped': {
      dapState.paused = true
      const thread = (event as { threadId?: number }).threadId
      if (thread) { dapState.threadId = thread; dapThreadId = thread }
      const reason = (event as { reason?: string }).reason ?? 'stopped'
      const text = (event as { text?: string }).text
      dapState.reason = text ? `${reason}: ${text}` : reason
      return
    }
    case 'continued':
      dapState.paused = false; dapState.reason = null; dapState.currentLocation = null
      return
    case 'output': {
      const output = event as { category?: string; text?: string }
      dapConsole.push({ category: output.category ?? 'console', text: output.text ?? '' })
      if (dapConsole.length > 4000) dapConsole.splice(0, dapConsole.length - 2000)
      return
    }
    case 'terminated': {
      dapState.running = false; dapState.paused = false; dapState.reason = null; dapState.currentLocation = null
      // 会话结束，能力位跟着作废：新入口的门控不能停留在上一个适配器的声明上。
      dapRememberCapabilities(undefined)
      const closed = (event as { connectionClosed?: boolean }).connectionClosed
      if (!closed) { dapConsole.push({ category: 'console', text: '调试会话已结束。' }); }
      return
    }
    case 'exited': {
      // The program ended on its own. This deliberately does not touch `running`:
      // adapters send `terminated` next, and that is the event that ends the
      // session. What is recorded here is the code the UI has to show.
      const raw = (event as { exitCode?: unknown }).exitCode
      dapState.exitCode = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 0
      dapConsole.push({
        category: dapState.exitCode === 0 ? 'telemetry' : 'stderr',
        text: dapState.exitCode === 0 ? '程序已退出，退出码 0。' : `程序已退出，退出码 ${dapState.exitCode}。`,
      })
      return
    }
    case 'progress':
      applyDapProgress(event as { phase?: unknown; progressId?: unknown; requestId?: unknown; title?: unknown; message?: unknown; percentage?: unknown })
      return
    case 'module':
      applyDapModule(event as { reason?: unknown; module?: { id?: unknown; name?: unknown; type?: unknown; sourceReference?: unknown }; path?: unknown })
      return
    case 'loadedSource':
      applyDapLoadedSource(event as { reason?: unknown; source?: { name?: unknown; sourceReference?: unknown }; path?: unknown })
      return
    case 'breakpoint':
      applyDapBreakpoint(event as { verified?: unknown; line?: unknown; path?: unknown; id?: unknown })
      return
    case 'thread':
      applyDapThread(event as { reason?: unknown; threadId?: unknown; body?: { reason?: unknown; threadId?: unknown } })
      return
    default:
      // Everything else (capability, invalidated, memory, ...) falls through
      // untouched rather than being pushed into state.
      return
  }
}

/** 会话收摊：进度行与断点 id 册子都只在一个会话之内有意义（dapStart / dapTerminate 共用）。 */
export function resetDapSessionTracking() {
  dapProgress.splice(0)
  dapBreakpointIds.clear()
}
