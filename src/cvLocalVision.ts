// Code Vision **本地提供者**的抓取与缓存层：把 `src/codeVisionProviders.ts` 那三个 provider 需要的
// 外部事实（文档符号表、每个符号的用法数、每个类/接口的继承者数）从语言服务问出来。
//
// 上游对应的是什么（这一族不是"渲染"问题，是"数据从哪来"问题）：
//   · 内置 provider 的计数走 **daemon  pass**：`JavaReferencesCodeVisionProvider.kt:23-30` 调
//     `JavaTelescope.usagesHint` → `UsagesCountManager.countMemberUsages`（同目录 `JavaTelescope.java:45-51`），
//     继承者数走 `JavaTelescope.collectInheritingClasses`（`JavaTelescope.java:115-131`，
//     里面是 `ClassInheritorsSearch`）；文案 = `JavaBundle` 的 `usages.telescope` /
//     `code.vision.inheritors.hint` / `code.vision.implementations.hint`
//     （`java/openapi/resources/messages/JavaBundle.properties:1767-1768,1805`）。
//   · 那一层的结果**按文件缓存**并在文档变化时重算（`CodeVisionCacheService` /
//     `DaemonBoundCodeVisionProvider`），并且只在后台算，算完再刷一次行上方。
//
// 本仓的通道差异（如实，两条都不是省事）：
//   1. 宿主没有 daemon，也没有批量计数请求：**一个符号 = 一次 JSON-RPC 往返**。
//      用法数走 `textDocument/references`（`native/lsp_session_kinds.cpp:108-118`），
//      继承者数走 `textDocument/prepareTypeHierarchy` + `typeHierarchy/subtypes` 两跳
//      （同文件 `:196-231`）。所以这里给两档都设了**上限**（见 `VISION_COUNT_MAX_SYMBOLS` /
//      `VISION_INHERITOR_MAX_SYMBOLS`），并且**串行**问，不并发。
//   2. 上游由 daemon 推结果；本仓没有推送，所以这一层是**旧值先用 + 后台补**（stale-while-revalidate）：
//      `entries()` 立刻回上一拍的条目，同时按"这一拍还没问过"起一轮抓取，落地后叫宿主补刷一次。
//
// 每一跳之前都先查**按文件 × 按特性的表**（`src/lspPerFileCapabilities.ts`）：上游每条特性都有
// 一个 `isSupportedForFile(file)` 闸（`platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt:58`，
// 在 `:62-63` 于发请求之前问；references 那一族是
// `platform/lsp-impl/src/impl/LspClientImpl.kt:471-473` 的 `supportsFindReferences(file)`，
// 层次那一族是同文件 `:494-496` 的 `supportsTypeHierarchy(file)`）。本仓的宿主只在服务器
// **显式声明** false/null 时才本地拒发（`native/lsp_capability_queries.cpp:95-106`），
// 每问一次都要一次 JSON-RPC 往返 ⇒ 这张表把"已经问过并被拒"的那几族记住，
// 一轮 Code Vision 不再按符号数量成倍地撞同一扇关着的门。
//
// 与 provider 那一层的分工：本文件只管**问与存**，一行文案都不拼（拼文案在
// `codeVisionProviders.ts`，那里有每条文案的上游键名）。问不到的符号一律**不进计数表**，
// provider 那侧就跳过这一档 —— 不是填 0（填 0 就是假数字）。
import {
  createCodeVisionRegistry,
  isInheritorAnchorKind,
  isUsageAnchorKind,
  type CodeVisionContext,
  type CodeVisionEntry,
  type CodeVisionRegistry,
  type VisionProblem,
  type VisionSymbol,
  type VisionSymbolCount,
} from './codeVisionProviders.ts'
import { lspFileFeatures } from './lspPerFileCapabilities.ts'

/** 一条 `lsp.request`（宿主方法名固定，参数按 kind 变；见 `src/bridge.ts` 的 `Method` 与 `LspRequestKind`）。 */
export type VisionRequest = <T>(method: 'lsp.request', params: Record<string, unknown>) => Promise<T>

/** `documentSymbol` 回包里的一个符号（`native/lsp_support.cpp:155-189` 的 `collect_symbols` 形状）。 */
interface RawSymbol {
  name?: unknown
  kind?: unknown
  startLine?: unknown
  startChar?: unknown
  endLine?: unknown
  endChar?: unknown
}
interface OutlineReply { available?: boolean; symbols?: RawSymbol[] }
interface LocationReply { available?: boolean; refs?: Array<{ path?: unknown; line?: unknown; character?: unknown }> }
interface HierarchyReply { available?: boolean; items?: unknown[] }

/**
 * 一轮最多问多少个符号的用法数。上限存在的理由只有一个：本仓每条目都是一次往返，
 * 而宿主没有上游那种 daemon 批量计数（见文件头差异 1）。超出就**少画几行**，不是少问几个数。
 */
export const VISION_COUNT_MAX_SYMBOLS = 24
/** 继承者要两跳（prepare + subtypes），所以那一档单独收紧，并且只问类/接口那一层。 */
export const VISION_INHERITOR_MAX_SYMBOLS = 8

export interface CodeVisionLocalChannelDeps {
  /** 发一条 `lsp.request`。抛错由这一层兜住：计数问不到 = 那一档没有条目。 */
  request: VisionRequest
  /** 当前文档路径（工作区相对）。 */
  path: () => string
  /** 该不该问（LSP 开着、不是大文件…）。缺省 = 一直该问。 */
  enabled?: () => boolean
  /** 当前文件的诊断（`problems` provider 的数据源，宿主已有这张表）。 */
  problems?: () => readonly VisionProblem[]
  /**
   * 这一拍的身份：变了就重问一轮。缺省只用路径 —— 那时编辑期间不会重问（符号表没变，
   * 计数也不该跟着每次按键重来）。宿主接 `CodeEditor.vue` 时把"路径 + 文档长度"这类
   * 粗粒度签名传进来即可（渲染通道自己的 400ms 编辑去抖已经挡掉了逐键触发）。
   */
  signature?: () => string
  /** 提供者表（默认三个内置：problems / references / inheritors）。 */
  registry?: CodeVisionRegistry
  maxSymbols?: number
  maxInheritorSymbols?: number
}

export interface CodeVisionLocalChannel {
  /** 渲染通道每一拍问这个：**同步**回当前条目，顺带按签名起一轮后台抓取。 */
  entries: () => CodeVisionEntry[]
  /** 显式抓一轮并回结果（测试与"文件刚打开"那条路用）。 */
  refresh: () => Promise<CodeVisionEntry[]>
  /** 挂一个"计数落地后补刷一次"的回调（宿主的 `codeLens.schedule`）。 */
  attach: (rerender: () => void) => void
  /** 换文件/关语言服务：丢掉上一拍的所有事实。 */
  reset: () => void
  /** 在飞的那一轮（没有就是 null）—— 测试与宿主判"要不要再触发"用。 */
  pending: () => Promise<CodeVisionEntry[]> | null
}

/** 语言按扩展名取（宿主那条链就是按扩展名选服务器：`native/lsp_config.cpp` 的合成表）。 */
export function languageOfPath(path: string): string {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * `documentSymbol` 回包 → provider 用的符号表。
 * 只收**四项都在**的条目：名字、kind、名字所在行、声明区间末尾。
 * 缺任何一项就丢掉（丢掉 = 这一行不画；补 0 = 假数字），所以这里没有默认值。
 */
export function toVisionSymbols(symbols: readonly RawSymbol[] | undefined): VisionSymbol[] {
  const out: VisionSymbol[] = []
  for (const raw of symbols ?? []) {
    if (!raw || typeof raw.name !== 'string' || !raw.name) continue
    if (typeof raw.kind !== 'number' || !Number.isInteger(raw.kind)) continue
    if (!Number.isInteger(raw.startLine) || !Number.isInteger(raw.endLine)) continue
    const startLine = raw.startLine as number
    const endLine = raw.endLine as number
    if (startLine < 0 || endLine < startLine) continue
    const symbol: VisionSymbol = { name: raw.name, kind: raw.kind, startLine, endLine }
    if (Number.isInteger(raw.startChar) && (raw.startChar as number) >= 0) symbol.startChar = raw.startChar as number
    out.push(symbol)
  }
  return out
}

/**
 * 一个符号的用法数 = `references` 回包里的条数**扣掉声明点自己**。
 *
 * 扣声明不是本仓的发明：宿主那条请求发的是 `includeDeclaration: true`
 * （`native/lsp_session_kinds.cpp:109-111`），而上游那条条目对"没人引用"的成员写的是
 * 「0 个用法」（`usages.telescope` 的 `0#` 支，`java/openapi/resources/messages/JavaBundle.properties:1805`）
 * —— 也就是声明点不计数。所以这里按**名字位置**（`startLine`/`startChar`）把那一条摘掉。
 * `available: false`（服务端一条都没回，含"只有声明自己"）就是 0。
 */
export function usageCountOf(reply: LocationReply | null | undefined, path: string, symbol: VisionSymbol): number | null {
  if (!reply || typeof reply !== 'object') return null
  if (reply.available !== true || !Array.isArray(reply.refs)) return 0
  if (symbol.startChar === undefined) return null   // 没有名字位置就摘不掉声明点，宁可不画
  let count = 0
  for (const ref of reply.refs) {
    if (!ref || typeof ref.line !== 'number' || typeof ref.character !== 'number') continue
    const isOwnDeclaration = ref.path === path && ref.line === symbol.startLine && ref.character === symbol.startChar
    if (!isOwnDeclaration) ++count
  }
  return count
}

/** 继承者数 = `typeHierarchy/subtypes` 回包里的条数（`available: false` 就是 0 个）。 */
export function inheritorCountOf(reply: HierarchyReply | null | undefined): number | null {
  if (!reply || typeof reply !== 'object') return null
  if (reply.available !== true || !Array.isArray(reply.items)) return 0
  return reply.items.length
}

/** 要去问用法的符号（provider 那侧的锚点判据决定，不在这层重写一遍）。 */
export function usageAnchorSymbols(outline: readonly VisionSymbol[], limit: number): VisionSymbol[] {
  const out: VisionSymbol[] = []
  for (const symbol of outline) {
    // `main` 与 provider 那侧同一个条件（`codeVisionProviders.ts` 里入口点那条），
    // 否则会出现"问了但那条条目被丢掉"的白跑一趟。
    if (!isUsageAnchorKind(symbol.kind) || symbol.startChar === undefined) continue
    if (symbol.kind === 6 && symbol.name === 'main') continue
    out.push(symbol)
  }
  return out.slice(0, Math.max(0, limit))
}

/** 要去问继承者的符号：类/接口那一层，两跳所以更窄。 */
export function inheritorAnchorSymbols(outline: readonly VisionSymbol[], limit: number): VisionSymbol[] {
  const out: VisionSymbol[] = []
  for (const symbol of outline)
    if (isInheritorAnchorKind(symbol.kind) && (symbol.kind === 5 || symbol.kind === 11) && symbol.startChar !== undefined) out.push(symbol)
  return out.slice(0, Math.max(0, limit))
}

/**
 * 建本地通道：一次 `documentSymbol` + 按符号问计数，结果留在**会话内**，
 * `entries()` 每次用最新诊断与上一拍的计数现拼条目。
 */
export function createCodeVisionLocalChannel(deps: CodeVisionLocalChannelDeps): CodeVisionLocalChannel {
  const registry = deps.registry ?? createCodeVisionRegistry()
  const maxSymbols = deps.maxSymbols ?? VISION_COUNT_MAX_SYMBOLS
  const maxInheritorSymbols = deps.maxInheritorSymbols ?? VISION_INHERITOR_MAX_SYMBOLS
  const enabled = deps.enabled ?? (() => true)
  const signature = (): string => deps.signature?.() ?? deps.path()

  let outline: VisionSymbol[] = []
  let usages: readonly VisionSymbolCount[] = []
  let inheritors: readonly VisionSymbolCount[] = []
  let attempted = ''            // 已经起过抓取的那一拍签名
  let generation = 0            // reset/换文件抬高它：在飞的那一轮回来也不再落盘
  let inFlight: Promise<CodeVisionEntry[]> | null = null
  let rerender: () => void = () => {}

  function context(path: string): CodeVisionContext {
    return {
      path,
      language: languageOfPath(path),
      outline,
      problems: deps.problems?.() ?? [],
      usages,
      inheritors,
    }
  }

  /** 上一拍的事实 + 当前诊断，现拼条目（纯同步，渲染通道每一拍都调这个）。 */
  function build(): CodeVisionEntry[] {
    const path = deps.path()
    if (!path) return []
    try { return registry.compute(context(path)) } catch { return [] }
  }

  /** 逐符号问用法数（串行：见文件头差异 1）。中途换文件/换拍就停。 */
  async function fetchUsages(path: string, symbols: readonly VisionSymbol[], mine: number): Promise<VisionSymbolCount[]> {
    const table: VisionSymbolCount[] = []
    // 整族先问一次表（上游 `platform/lsp-impl/src/impl/LspClientImpl.kt:471-473` 的
    // `supportsFindReferences(file)` 就是这个位置）：这一条被记成不支持就一个符号都不问，
    // 而不是每个符号撞一次注定失败的往返。
    if (!lspFileFeatures.plan('references', path).ask) return table
    for (const symbol of symbols) {
      if (mine !== generation) return table
      const attempt = await lspFileFeatures.ask<LocationReply>('references', path,
        () => deps.request<LocationReply>('lsp.request', {
          kind: 'references', path, line: symbol.startLine, character: symbol.startChar ?? 0,
        }))
      if (!attempt.asked || !attempt.ok) continue      // 被拦下或问不到都跳过，别把整轮带崩
      const count = usageCountOf(attempt.value, path, symbol)
      if (count === null) continue
      table.push({ line: symbol.startLine, character: symbol.startChar ?? 0, count })
    }
    return table
  }

  /** 逐类问继承者数（两跳，同一份在飞/换拍守卫）。 */
  async function fetchInheritors(path: string, symbols: readonly VisionSymbol[], mine: number): Promise<VisionSymbolCount[]> {
    const table: VisionSymbolCount[] = []
    // 两跳的第一跳被表拦下 ⇒ 整族不问（第二跳只有第一跳拿到 item 才有意义）。
    if (!lspFileFeatures.plan('prepareTypeHierarchy', path).ask) return table
    for (const symbol of symbols) {
      if (mine !== generation) return table
      const line = symbol.startLine
      const character = symbol.startChar ?? 0
      const preparedAttempt = await lspFileFeatures.ask<HierarchyReply>('prepareTypeHierarchy', path,
        () => deps.request<HierarchyReply>('lsp.request', { kind: 'prepareTypeHierarchy', path, line, character }))
      if (!preparedAttempt.asked || !preparedAttempt.ok) continue
      const item = preparedAttempt.value?.available === true && Array.isArray(preparedAttempt.value.items)
        ? preparedAttempt.value.items[0]
        : undefined
      if (!item) continue                             // 服务端不认这个点：没有条目，不是 0 个
      if (mine !== generation) return table
      if (!lspFileFeatures.plan('typeHierarchySubtypes', path).ask) return table
      const repliedAttempt = await lspFileFeatures.ask<HierarchyReply>('typeHierarchySubtypes', path,
        () => deps.request<HierarchyReply>('lsp.request', { kind: 'typeHierarchySubtypes', path, line, character, item }))
      if (!repliedAttempt.asked || !repliedAttempt.ok) continue
      const count = inheritorCountOf(repliedAttempt.value)
      if (count === null || count === 0) continue     // 0 个继承者上游本来就不画（`JavaInheritorsCodeVisionProvider.kt:37`）
      table.push({ line, character, count })
    }
    return table
  }

  async function run(): Promise<CodeVisionEntry[]> {
    const mine = generation
    const mineSignature = signature()
    const path = deps.path()
    attempted = mineSignature
    // 第一跳之前先查表：被记成不支持的那一族，一次刷新都不该再撞（上游是
    // `LspHighlightingCache.kt:62-63` 在 `getHighlightings` 第一行问 `isSupportedForFile`）。
    const outlineAttempt = await lspFileFeatures.ask<OutlineReply>('documentSymbol', path,
      () => deps.request<OutlineReply>('lsp.request', { kind: 'documentSymbol', path, line: 0, character: 0 }))
    if (!outlineAttempt.asked) return build()
    if (mine !== generation) return build()
    if (outlineAttempt.ok) {
      outline = outlineAttempt.value?.available === true ? toVisionSymbols(outlineAttempt.value.symbols) : []
      if (signature() === mineSignature) {
        usages = await fetchUsages(path, usageAnchorSymbols(outline, maxSymbols), mine)
        inheritors = mine === generation
          ? await fetchInheritors(path, inheritorAnchorSymbols(outline, maxInheritorSymbols), mine)
          : []
      }
    }
    // 问失败那一支（`ok:false`）保留上一拍的事实（上游 daemon 也是"旧的先用"），
    // 但这一拍算已经问过了 —— 而**确定的拒绝**已经进了表，下一次刷新连撞都不撞。
    if (mine !== generation || signature() !== mineSignature) return []
    const entries = build()
    rerender()
    return entries
  }

  function refresh(): Promise<CodeVisionEntry[]> {
    if (inFlight) return inFlight
    if (!enabled() || !deps.path()) return Promise.resolve(build())
    inFlight = run().finally(() => { inFlight = null })
    return inFlight
  }

  return {
    entries: () => {
      if (enabled()) {
        const mine = signature()
        if (mine !== attempted && !inFlight) void refresh()
      }
      return build()
    },
    refresh,
    attach: notify => { rerender = notify },
    reset: () => {
      ++generation
      outline = []
      usages = []
      inheritors = []
      attempted = ''
    },
    pending: () => inFlight,
  }
}
