// DAP 请求的**前端调用封装**：分页取数（`stackTrace` 的 `startFrame`/`levels`、
// `variables` 的 `start`/`count`）与第二批请求族（`dataBreakpoints` / `setDataBreakpoints` /
// `setFunctionBreakpoints` / `source`），外加**能力位门控 + 优雅降级**。
//
// 为什么单独成模块：`src/bridge.ts` 只保留"方法名 + 参数形状"（Method union 是机检锚点），
// 而这四个新族的**回参整形、能力位判定、不支持时怎么退化**是一整套口径，属于调试域
// （`src/dap*.ts`）。放进 bridge 会让桥接层继续膨胀，放进 `DebugPanel.vue` 又没法单测。
//
// 三条口径（与 `native/dap_values.cpp` 的能力门控逐条对应）：
//   1. 能力位（`supportsDataBreakpoints` / `supportsFunctionBreakpoints` / `supportsSourceRequest`）
//      规范里**默认 false**：没声明就**不发请求**，直接回一个"不支持"的降级结果 ——
//      省一次必然失败的往返，也不让界面弹错（`DapUnsupported` 里带原因）。
//   2. 适配器**嘴上说支持、实际回 DAP_UNSUPPORTED**（或会话已经没了回 DAP_NOT_RUNNING）时，
//      同样降级成结果而不是抛给调用方 —— 调试面板在停机瞬间发请求是常态，
//      这不是 bug，不该在界面上显示成错误。
//   3. 其余错误（参数非法、适配器崩了）**照抛** —— 那些是真的要看一眼的问题，不吞。
//
// 判据 tests/dap-protocol-requests.test.mjs。

import { BridgeError } from './bridgeError.ts'
import { dapCapability, dapVariables, dapStackTrace, dapState, request } from './bridge.ts'
import type { DapFrame, DapVariable } from './bridge.ts'
import {
  variablePageParams, stackTracePageParams, type VariablePage, type StackPage,
} from './debugPaging.ts'
// 调试进程监听（上游 `DebugProcessListener`）挂到 DAP 会话状态上 —— 本模块是 DebugPanel 消费的活链路，
// 在这里安装，插件就能通过 EP 收到 attached/paused/resumed/detached（见 src/debugProcessListeners.ts）。
import { installDebugProcessDispatch } from './debugProcessListeners.ts'

installDebugProcessDispatch(dapState)

// ── 能力位 ────────────────────────────────────────────────────────────────────

/** DAP `supportsDataBreakpoints`（规范默认 false）。 */
export const DATA_BREAKPOINTS_CAPABILITY = 'supportsDataBreakpoints'
/** DAP `supportsFunctionBreakpoints`（规范默认 false）。 */
export const FUNCTION_BREAKPOINTS_CAPABILITY = 'supportsFunctionBreakpoints'
/** DAP `supportsSourceRequest`（规范默认 false）。 */
export const SOURCE_REQUEST_CAPABILITY = 'supportsSourceRequest'

export const dapDataBreakpointsSupported = (): boolean => transport.capability(DATA_BREAKPOINTS_CAPABILITY)
export const dapFunctionBreakpointsSupported = (): boolean => transport.capability(FUNCTION_BREAKPOINTS_CAPABILITY)
export const dapSourceRequestSupported = (): boolean => transport.capability(SOURCE_REQUEST_CAPABILITY)

// ── 取数通道（可注入，判据用）────────────────────────────────────────────────
//
// 默认就是桥接层那四个函数；判据把通道换成桩，就能在 Node 里真的走一遍
// 「能力位 → 发请求 → 整形/降级」的完整调用链（与 `setQuickEvaluateSessionProbe` 同一个做法）。
// 生产代码不调 `setDapTransport`，`resetDapTransport` 供用例之间还原。

interface DapTransport {
  capability(name: string): boolean
  request<T>(method: string, params?: Record<string, unknown>): Promise<T>
  stackTrace(threadId: number, page?: { startFrame?: number; levels?: number }): Promise<{ frames: DapFrame[]; totalFrames: number }>
  variables(reference: number, page?: { start?: number; count?: number }): Promise<{ variables: DapVariable[] }>
}

const defaultTransport: DapTransport = {
  capability: dapCapability,
  request: (method, params) => request(method as never, params),
  stackTrace: dapStackTrace,
  variables: dapVariables,
}

let transport: DapTransport = defaultTransport

/** 判据专用：换掉取数通道（不传参 = 还原成真实桥接）。 */
export function setDapTransport(next?: Partial<DapTransport>): void {
  transport = next ? { ...defaultTransport, ...next } : defaultTransport
}

// ── 回参形状（与 native/dap_values.cpp 的整形逐字段一致）────────────────────────

/** `dataBreakpoints` 的一个候选（适配器说这个位置可以被观察）。 */
export interface DapDataBreakpointCandidate {
  /** 规范必填：装断点时用的句柄（缺它的条目被原生丢掉，不会到这里）。 */
  dataId: string
  /** 显示名（规范必填，原生同样丢掉缺它的条目）。 */
  label: string
  /** 规范枚举 `read` / `write` / `readWrite`（没报就不写这个键）。 */
  accessType?: string
  description?: string
  id?: number | string
}

/** 装一个数据断点要给的字段（`dataId` 必填，其余可选）。 */
export interface DapDataBreakpointRequest {
  dataId: string
  accessType?: 'read' | 'write' | 'readWrite'
  condition?: string
  hitCondition?: string
}

/** 装一个函数（方法）断点要给的字段（`name` 必填）。 */
export interface DapFunctionBreakpointRequest {
  name: string
  condition?: string
  hitCondition?: string
}

/** `setDataBreakpoints` / `setFunctionBreakpoints` 的一条回执（规范里 `verified` 必填）。 */
export interface DapInstalledBreakpoint {
  verified: boolean
  id?: number | string
  line?: number
  column?: number
  message?: string
  name?: string
  dataId?: string
}

/** `source` 的回答：`available:false` = 适配器没给内容（不是"空文件"，见 native 的整形注释）。 */
export interface DapSourceResult {
  available: boolean
  content?: string
  mimeType?: string
}

/**
 * 能力位门控后的降级结果：`supported:false` + 一句**给用户看的原因**。
 * `available:false` 与它同义但更贴近 UI 那侧既有的读法（`source`/`loadedSources` 都用它）。
 */
export interface DapUnsupported {
  supported: false
  available: false
  reason: string
}

/** `dataBreakpoints` 的结果：要么是候选清单，要么是"这个适配器不支持"。 */
export type DapDataBreakpointsResult = { supported: true; available: true; breakpoints: DapDataBreakpointCandidate[] } | DapUnsupported
/** 两个 set* 的结果。 */
export type DapSetBreakpointsResult = { supported: true; breakpoints: DapInstalledBreakpoint[] } | DapUnsupported
/** `source` 的结果。 */
export type DapSourceOutcome = (DapSourceResult & { supported: true }) | DapUnsupported

/** 降级原因（能力位没声明）。 */
export function capabilityUnsupportedReason(capability: string): string {
  return `适配器未声明 ${capability}，此功能不可用。`
}

/** 会话不在/适配器临时答不上来时的降级原因（不是能力位问题）。 */
export const DAP_UNAVAILABLE_REASON = '调试会话当前不可用，稍后再试。'

/**
 * 这个错误是不是"该降级"的（能力位没声明 / 会话没了），而不是"该报出来的"。
 * 原生侧两种码：`DAP_UNSUPPORTED`（`native/dap_values.cpp` 的能力门控）与
 * `DAP_NOT_RUNNING`（`native/dap_routes.cpp` 的会话检查）。
 */
export function isDegradableDapError(error: unknown): boolean {
  const code = error instanceof BridgeError ? error.code : (error as { code?: unknown } | null)?.code
  return code === 'DAP_UNSUPPORTED' || code === 'DAP_NOT_RUNNING'
}

/** 把该降级的错误折成一个结果；不该降级的原样抛出（返回 `null` 表示"调用方接着 throw"）。 */
function degradeOrRethrow(error: unknown): DapUnsupported | null {
  if (!isDegradableDapError(error)) return null
  const code = error instanceof BridgeError ? error.code : (error as { code?: string }).code
  return {
    supported: false,
    available: false,
    reason: code === 'DAP_UNSUPPORTED' ? capabilityUnsupportedReason('所需能力位') : DAP_UNAVAILABLE_REASON,
  }
}

// ── 第二批请求族 ──────────────────────────────────────────────────────────────

/**
 * 列出可观察的数据位置（IDEA 的字段观察点候选）。
 * 没声明 `supportsDataBreakpoints` ⇒ 不发请求，直接回降级结果。
 * **空数组是有意义的答案**（这个会话没有可观察的位置），与"不支持"是两回事。
 */
export async function dapDataBreakpoints(): Promise<DapDataBreakpointsResult> {
  if (!transport.capability(DATA_BREAKPOINTS_CAPABILITY)) {
    return { supported: false, available: false, reason: capabilityUnsupportedReason(DATA_BREAKPOINTS_CAPABILITY) }
  }
  try {
    const result = await transport.request<{ available: boolean; breakpoints: DapDataBreakpointCandidate[] }>('dap.dataBreakpoints')
    return { supported: true, available: true, breakpoints: result?.breakpoints ?? [] }
  } catch (error) {
    const degraded = degradeOrRethrow(error)
    if (degraded) return degraded
    throw error
  }
}

/** 装/清数据断点（IDEA 的字段观察点）。空清单 = 清掉全部。 */
export async function dapSetDataBreakpoints(
  breakpoints: readonly DapDataBreakpointRequest[],
): Promise<DapSetBreakpointsResult> {
  if (!transport.capability(DATA_BREAKPOINTS_CAPABILITY)) {
    return { supported: false, available: false, reason: capabilityUnsupportedReason(DATA_BREAKPOINTS_CAPABILITY) }
  }
  try {
    const result = await transport.request<{ breakpoints: DapInstalledBreakpoint[] }>('dap.setDataBreakpoints', {
      breakpoints: [...breakpoints],
    })
    return { supported: true, breakpoints: result?.breakpoints ?? [] }
  } catch (error) {
    const degraded = degradeOrRethrow(error)
    if (degraded) return degraded
    throw error
  }
}

/** 装/清函数（方法）断点（IDEA 的 `JavaMethodBreakpointType`）。空清单 = 清掉全部。 */
export async function dapSetFunctionBreakpoints(
  breakpoints: readonly DapFunctionBreakpointRequest[],
): Promise<DapSetBreakpointsResult> {
  if (!transport.capability(FUNCTION_BREAKPOINTS_CAPABILITY)) {
    return { supported: false, available: false, reason: capabilityUnsupportedReason(FUNCTION_BREAKPOINTS_CAPABILITY) }
  }
  try {
    const result = await transport.request<{ breakpoints: DapInstalledBreakpoint[] }>('dap.setFunctionBreakpoints', {
      breakpoints: [...breakpoints],
    })
    return { supported: true, breakpoints: result?.breakpoints ?? [] }
  } catch (error) {
    const degraded = degradeOrRethrow(error)
    if (degraded) return degraded
    throw error
  }
}

/**
 * 按 `sourceReference`（或路径）取源内容 —— 适配器动态生成的源只能这样取，
 * 是 `file.read` 在调试侧的等价物。规范里两个入参**至少给一个**。
 */
export async function dapSource(
  options: { sourceReference?: number; path?: string },
): Promise<DapSourceOutcome> {
  const reference = typeof options.sourceReference === 'number' && options.sourceReference > 0
    ? Math.trunc(options.sourceReference) : 0
  const path = typeof options.path === 'string' ? options.path : ''
  if (reference <= 0 && !path) throw new BridgeError('INVALID_REQUEST', '取源内容需要 sourceReference 或 path 之一。')
  if (!transport.capability(SOURCE_REQUEST_CAPABILITY)) {
    return { supported: false, available: false, reason: capabilityUnsupportedReason(SOURCE_REQUEST_CAPABILITY) }
  }
  const params: Record<string, unknown> = {}
  if (reference > 0) params.sourceReference = reference
  if (path) params.path = path
  try {
    const result = await transport.request<DapSourceResult>('dap.source', params)
    return { supported: true, available: result?.available === true, ...(result?.content ? { content: result.content } : {}), ...(result?.mimeType ? { mimeType: result.mimeType } : {}) }
  } catch (error) {
    const degraded = degradeOrRethrow(error)
    if (degraded) return degraded
    throw error
  }
}

// ── 分页取数（item 1）─────────────────────────────────────────────────────────

/**
 * 取一页调用栈。`page` 缺省 = 适配器默认（返回全部）。
 * `totalFrames` 仍是适配器报的**总数**，不是本页条数（原生整形如此），所以调用方
 * 可以用 `frames.length < totalFrames` 判"还有没取的"。
 */
export async function dapStackTracePage(
  threadId: number, page?: Partial<StackPage>,
): Promise<{ frames: DapFrame[]; totalFrames: number }> {
  return transport.stackTrace(threadId, stackTracePageParams(page))
}

/** 取一页变量。`page` 缺省 = 适配器默认（返回全部）。 */
export async function dapVariablesPage(
  reference: number, page?: Partial<VariablePage>,
): Promise<{ variables: DapVariable[] }> {
  return transport.variables(reference, variablePageParams(page))
}