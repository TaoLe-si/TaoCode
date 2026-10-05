// 文档的**取用面** —— 上游 `platform/lsp-impl/src/impl/features/documentation/LspDocumentationTargetProvider.kt`
// 在本仓的等价物：把「某个位置的文档」包成一个 target，**任何**入口都从这里取，
// 于是同一个位置的 hover 只发一次请求。
//
// 上游那一层为什么存在（判决 `ls/documentation` 的「缺：`LspDocumentationTargetProvider` 的
// `DocumentationTarget` 注入面，本仓只有 Ctrl+Q 一条入口」）：
//   · `DocumentationTargetProvider.java:31` —— 接口只有一个方法
//     `documentationTargets(PsiFile, offset)`：**按位置**给一组 target，谁要文档谁调；
//   · `LspDocumentationTargetProvider.kt:20-51` —— LSP 的实现：`getHoverCaching(file, offset)`
//     拿 hover（带缓存），`:46-48` 顺手把 `textRange` 那段文本取出来当 `presentableText`，
//     `:55-70` 那个 `LspDocumentationTarget` 的 `computeDocumentation()` 就是
//     `createLspDocumentationData(markup).toQuickDocHtml(project)`；
//   · 入口确实**不止一个**：`DocumentationTargetHoverInfo.kt:35-45`（鼠标悬停）与
//     `IdeDocumentationTargetProviderImpl.kt:23/43`（lookup 条目 / 任意 offset）都调同一套
//     `documentationTargets(...)`。本仓同样是两条：Ctrl+Q（`src/quickDocHost.ts`）与
//     编辑器 hover（`src/components/CodeEditor.vue` 的 `hoverTooltip`，保留文件 ⇒ 走接线请求）。
//
// 「闸」只有 hover 那条有：`EditorMouseHoverPopupManager.java:452`
// （`isShowQuickDocOnMouseOverElement` 关掉就**整个不弹**，普通错误提示 tooltip 照旧，
// 见同文件 `:445-448` 的两个 null 分支）与 `HoverPopupContext.kt:106`。
// Ctrl+Q 是用户按键，不受这一档影响（上游 `ShowQuickDocAction` 走的是另一条链）。

import { request } from './bridge.ts'
import { shouldShowDocOnHover } from './docHoverPolicy.ts'
import {
  createHoverCache, createHoverDocumentation, formatHoverPlainText, hoverPositionKey,
  type DocHoverRange, type HoverCache, type HoverCacheEntry,
} from './hoverDocumentation.ts'

/**
 * 桥接 `lsp.request` 的 hover 回包。本仓登记的类型是 `LspHoverResult { available, contents }`
 * （`src/bridge.ts:126`，保留文件），**没有** range 那一格；这里按上游 LSP 的原始形状
 * 多读一个可选字段，服务器/native 什么时候透传过来就什么时候生效，不硬造。
 * 上游对应：`LspRequestExecutor.kt:213-221`（`it.range = hover.range?.let { … toHostRange … }`）。
 */
interface LspHoverPayload {
  available: boolean
  contents?: string
  range?: {
    start?: { line?: number; character?: number }
    end?: { line?: number; character?: number }
  }
}

/** 一个位置的文档 —— 上游 `LspDocumentationTarget` 的等价物（内容 + 它覆盖的区间 + 显示名）。 */
export interface DocHoverTarget {
  contents: string
  /** 服务器给的区间；没有就 `null`（上游那时是零长区间，只等价于「同一位置才算命中」）。 */
  range: DocHoverRange | null
  /** 区间那段源码文本，即上游的 `presentableText`（`LspDocumentationTargetProvider.kt:46-48`）。 */
  presentation: string | null
}

export interface DocHoverContent {
  /** 缓存实例（上游是 `LspRequestExecutor.kt:50` 注册的那一张，全工程共用）。 */
  cache: HoverCache
  /** 按位置取文档：先查缓存（含区间命中），未命中才发 `textDocument/hover`。 */
  targetAt(position: { path: string; line: number; character: number; stamp: string; lineText?: string }): Promise<DocHoverTarget | null>
  /**
   * hover tooltip 该显示的那段文本（闸 + 整形都在这里）：
   * 「在鼠标移动时显示」关掉时返回 `null` —— 上游那时返回 null，整个文档部分不出现
   * （`EditorMouseHoverPopupManager.java:452`、`HoverPopupContext.kt:106`）。
   */
  tooltipText(position: { path: string; line: number; character: number; stamp: string; lineText?: string }): Promise<string | null>
}

/** `native` 的 hover 回包里的 range → 本仓的 `DocHoverRange`；残缺/反向区间都不认。 */
export function hoverRangeFromPayload(payload: LspHoverPayload): DocHoverRange | null {
  const start = payload.range?.start
  const end = payload.range?.end
  if (!start || !end) return null
  const range: DocHoverRange = {
    startLine: Number(start.line), startCharacter: Number(start.character),
    endLine: Number(end.line), endCharacter: Number(end.character),
  }
  if ([range.startLine, range.startCharacter, range.endLine, range.endCharacter].some(value => !Number.isFinite(value))) return null
  // 零长/反向区间在上游等价于「没给 range」（`TextRangeAndMarkupContent.kt:47` 的 `length > 0` 判据）。
  if (range.endLine < range.startLine) return null
  if (range.endLine === range.startLine && range.endCharacter <= range.startCharacter) return null
  return range
}

/**
 * 区间那段文本 = 上游的 `presentableText`。逐条照 `LspDocumentationTargetProvider.kt:47`：
 * 区间长度要 > 0 且**终点不越过文档末尾**，否则没有可显示名（本仓按行取，跨行就当取不到 ——
 * 行文本由调用方给，宿主拿得到 `EditorHandle.text()`）。
 */
export function presentationFromRange(lineText: string | undefined, range: DocHoverRange | null): string | null {
  if (!lineText || !range) return null
  if (range.startLine !== range.endLine) return null
  // 上游 `LspDocumentationTargetProvider.kt:47`：`it.endOffset <= hostPsiFile.textLength` ——
  // 区间越过文档末尾就当没有可显示名，不夹取（夹出来的那段是拼的，不是服务器指的）。
  if (range.endCharacter > lineText.length) return null
  if (range.endCharacter <= range.startCharacter) return null
  return lineText.slice(Math.max(0, range.startCharacter), range.endCharacter)
}

/**
 * 上游 `LspDocumentationData.toQuickDocHtml` 之前那一层对「空内容」的处理
 * （`TextRangeAndMarkupContent.kt:22-24` 的 `isNullOrBlank()` 与 `:35-36` 的 `isBlank()`）：
 * 整段是空白就当**没有文档**，而不是弹一个空框。
 */
export function hoverTooltipText(contents: string): string {
  return formatHoverPlainText(createHoverDocumentation(contents))
}

export function isBlankDoc(contents: string | null | undefined): boolean {
  return !contents || contents.trim() === ''
}

/**
 * 编辑器 hover 那条入口用的**缓存标记**（上游是 `LspPerFileCache.kt:63/68` 的文档修改戳）。
 *
 * CodeMirror 的 `Text` 是**不可变**的：只有真改了文本才换一个新对象，改选区不换。
 * 于是「文档对象 → 单调整号」这张表就是本仓拿得到的最贴近上游的戳：文档变了才失效
 * （按 `length` 会漏掉等长编辑，按 `state.epoch` 会把改选区也算成变更，两者都不是上游那档）。
 * 快速文档那条入口仍然用标签页的 `版本:脏`（`src/quickDocHost.ts` 的 `fetchHover`）——
 * 那边有真的存盘版本戳，比这里的近似更准。
 */
const docStamps = new WeakMap<object, string>()
let docStampSequence = 0
export function hoverDocStampOf(document: object | null | undefined): string {
  if (!document) return 'no-document'
  let stamp = docStamps.get(document)
  if (!stamp) {
    stamp = String(++docStampSequence)
    docStamps.set(document, stamp)
  }
  return stamp
}

/**
 * 建一条取用面。`request` 与 `cache` 都由调用方给：
 *   · `cache` —— 本仓只应该有**一张** hover 缓存（`src/editorFileOps.ts:96` 建、注入 `quickDocHost`），
 *     再建一张就成了各记各的（上游也是注册一次：`LspRequestExecutor.kt:50`）；
 *   · `request` —— 单测里换假的，生产用 `src/bridge.ts` 那一个。
 */
export function createDocHoverContent(deps: {
  cache: HoverCache
  request?: <T>(method: string, params: Record<string, unknown>) => Promise<T>
}): DocHoverContent {
  const { cache } = deps
  const send = deps.request ?? (request as <T>(method: string, params: Record<string, unknown>) => Promise<T>)

  async function targetAt(position: { path: string; line: number; character: number; stamp: string; lineText?: string }): Promise<DocHoverTarget | null> {
    const key = hoverPositionKey(position.line, position.character)
    // 命中两条：位置相同，或**某条目的区间包含这个位置**（`HoverResultCache.kt:11-12`）。
    const cached = cache.get(position.path, key, position.stamp)
    if (cached) return targetOf(cached, position.lineText)
    const payload = await send<LspHoverPayload>('lsp.request', {
      kind: 'hover', path: position.path, line: position.line, character: position.character,
    })
    if (!payload?.available || isBlankDoc(payload.contents)) return null
    const range = hoverRangeFromPayload(payload)
    const entry: HoverCacheEntry = { contents: payload.contents as string, range: range ?? undefined }
    cache.put(position.path, key, position.stamp, entry)
    return targetOf(entry, position.lineText)
  }

  async function tooltipText(position: { path: string; line: number; character: number; stamp: string; lineText?: string }): Promise<string | null> {
    // 闸：只有 hover 这一条入口受「在鼠标移动时显示」管（Ctrl+Q 不受）。
    if (!shouldShowDocOnHover()) return null
    const target = await targetAt(position)
    if (!target) return null
    const text = hoverTooltipText(target.contents)
    return text.trim() === '' ? null : text
  }

  return { cache, targetAt, tooltipText }
}

function targetOf(entry: HoverCacheEntry, lineText: string | undefined): DocHoverTarget {
  return {
    contents: entry.contents,
    range: entry.range ?? null,
    presentation: presentationFromRange(lineText, entry.range ?? null),
  }
}

/**
 * 全仓共享的那一张（上游 `LspClient.requestExecutor` 的 `hoverResultCache`）。
 * 生产装配顺序：`src/editorFileOps.ts` 建缓存 → `src/quickDocHost.ts` 构造时把它登记进来 →
 * 编辑器 hover（`CodeEditor.vue` 的 `hoverTooltip`，保留文件 ⇒ 接线请求）取到的就是**同一张**。
 * 没人登记过时（纯单测、或编辑器先于宿主挂载）懒建一张，不至于取不到文档。
 */
let shared: DocHoverContent | null = null

export function registerSharedDocHover(content: DocHoverContent): DocHoverContent {
  shared = content
  return content
}

export function sharedDocHover(cache?: HoverCache): DocHoverContent {
  if (!shared) shared = createDocHoverContent({ cache: cache ?? createFallbackCache() })
  return shared
}

/** 懒建的兜底缓存只在宿主没登记时用；登记走的是宿主那张（见上面的装配顺序）。 */
let fallback: HoverCache | null = null
function createFallbackCache(): HoverCache {
  if (!fallback) fallback = createHoverCache()
  return fallback
}
