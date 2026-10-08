// LSP 语义着色的 decoration 层（上游 daemon 着色路径见 `src/semanticTokens.ts`：
// `HighlightVisitor`/`Annotator` + `TextAttributesKey`）。
//
// 从 `CodeEditor.vue` 拆出（那个文件贴着机检上限）：这一半只做「token 列表 → 装饰」，
// 拉取/增量/delta 合并与导入期重试留在宿主（它们要和 request/warmup 的生命周期绑一起）。
//
// ## 两份「缓存」的口径（2026-10-06 补齐判词 ③，注册表在 `src/semanticHighlighting.ts`）
//   · `semanticHighlightingCache`（按**文档修订**的快照，上游 `LspSemanticTokensCache`
//     —— `LspHighlightingCacheRegistry.kt:28` 注册表里的那一条具名缓存）：
//     修订一变即作废（`invalidate`），所以旧修订的答案永远不会被当成新文档的结果用上 ——
//     上游同款闸门：`LspSemanticTokensCache.kt:40-41` 发请求前记 `modificationStamp`，
//     `:51-54` 回来时戳变了**连解码都不做**。同修订、同一份 token 再派发一次时
//     （导入期的 warmup 重试、同一个文档开第二个编辑器）直接复用已构建的 `DecorationSet`，
//     不再重建 `RangeSet` —— 上游 `LspPullResult.Unchanged` 的「保留内容不重画」。
//   · `StateField` 自己的 `layer.decorations`：CodeMirror 的高亮层，编辑时跟着走。
//     作废那一步走的是**按特性注册表**（`invalidatePulledResults()`，
//     `src/semanticHighlighting.ts:325-328`），不是直接点某一份缓存 —— 上游同一条也是从注册表扇出去的
//     （`platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCacheRegistry.kt:54-56`）。
//
// ## 编辑后**跟着走**而不是整层清空（留痕：原写「文档一变就整份作废」）
// 原来的理由是「把旧 decoration map 到新位置只会把颜色留在错误的 token 上」。上游不是这么做的：
// `LspCachedHighlighting.kt:38-80` 的 `applyPendingEdits` 在服务端新结果到达前先把缓存区间
// **平移/裁剪**着继续画（四条分支：区间在编辑之后不动 / 在编辑之前整体右移 / 编辑被区间包含则
// 区间按差值 grow-shrink / 与区间部分相交则**删掉**这一条，本仓 `src/lspHighlightingCache.ts:8-12`
// 已逐条移植过）。CodeMirror 的 `ChangeSet.mapPos` 给的是**精确**映射（比上游按差值近似更准），
// 于是这里照上游的可见行为做：区间跟着编辑走，被编辑吃掉的（映射后零宽）丢掉不画，
// 下一次权威结果整份覆盖。用户可见的差别是：打字时语义颜色不再闪断 400ms。
import { RangeSetBuilder, StateEffect, StateField, type ChangeSet, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { invalidatePulledResults, semanticHighlightClasses, semanticHighlightingCache, semanticRevisionOf } from './semanticHighlighting.ts'
import { remapHighlightRanges } from './lspHighlightingCache.ts'
import type { SemanticToken } from './semanticTokens.ts'

export const setSemanticTokens = StateEffect.define<readonly SemanticToken[]>()

/** 一条已经落到文档偏移上的语义高亮（区间 + 要挂的类名）。 */
export interface SemanticMark {
  from: number
  to: number
  /** 装饰类名；空串 = 这个 token 类型没在注册表里（**不高亮**，上游 `else -> null`）。 */
  cls: string
}

/** 高亮层的状态：这一层是为哪个文档修订建的、有哪些区间、已经建好的装饰。 */
export interface SemanticLayer {
  /** `semanticRevisionOf(doc)`：文档对象身份，-1 = 还没建过。 */
  revision: number
  marks: readonly SemanticMark[]
  decorations: DecorationSet
}

export const emptySemanticLayer: SemanticLayer = { revision: -1, marks: [], decorations: Decoration.none }

/**
 * token → 区间（宿主偏移）。**类型未注册（或索引越界解出空类型）的 token 在这里就丢掉**：
 * 上游对索引越界是 `continue` 掉整条（`LspSemanticTokensCache.kt:102-105`），对类型没有
 * `TextAttributesKey` 的是 `else -> null`（`LspSemanticTokensCustomizer.kt:121`）。
 * 越界的行列也丢掉 —— 服务端的 legend 版本与文档版本都可能与客户端不一致，
 * 一个畸形 token 不该把编辑器打挂（更不该抛进 CodeMirror 的 update 里）。
 */
export function semanticMarksOf(state: EditorState, tokens: readonly SemanticToken[]): SemanticMark[] {
  const marks: SemanticMark[] = []
  for (const token of tokens) {
    if (token.line < 0 || token.line >= state.doc.lines) continue
    const cls = semanticHighlightClasses(token)
    if (!cls) continue
    const line = state.doc.line(token.line + 1)
    const from = line.from + Math.max(0, token.startChar)
    const to = Math.min(line.to, from + Math.max(0, token.length))
    if (to <= from) continue
    marks.push({ from, to, cls })
  }
  // `RangeSetBuilder` 要求**按位置升序**添加，所以先排序（服务端的顺序不保证）。
  return marks.sort((left, right) => left.from - right.from || left.to - right.to)
}

function decorate(marks: readonly SemanticMark[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const mark of marks) builder.add(mark.from, mark.to, Decoration.mark({ class: mark.cls }))
  return builder.finish()
}

/**
 * 编辑后的区间：**两端都朝内容内侧**映射，映射后零宽（这段被编辑吃掉了）就丢掉不画。
 * 规则本体在 `src/lspHighlightingCache.ts` 的 `remapHighlightRanges()`（documentHighlight 那一族
 * 走的是同一份实现，两份装饰层不该各写一遍上游那四条分支），这里只接 `SemanticMark` ↔ `TextRange`。
 * 与上游四条分支的对应（`LspCachedHighlighting.kt:55-87`，四条分别在 `:65-68`/`:70-75`/`:77-82`/`:84-85`；
 * 本仓 `src/lspHighlightingCache.ts:8-12` 记着那四条）：
 *   · 编辑在区间之前 ⇒ 整体右移（②）；编辑在区间之后 ⇒ 不动（①）；
 *   · 编辑落在区间内部 ⇒ 区间随插入变长/随删除变短（③ 的 grown）；
 *   · 编辑把区间吃掉 ⇒ 映射后零宽，`remapHighlightRanges` 里那条 `end <= start` 把它删掉（④ 的 `iterator.remove()`）。
 * 边界上取「内侧」而不是「外侧」，是为了不把插在 token 前后的字符染进这个 token。
 */
function remapMarks(marks: readonly SemanticMark[], changes: ChangeSet): SemanticMark[] {
  return remapHighlightRanges(marks, changes,
    mark => ({ start: mark.from, end: mark.to }),
    (mark, span) => ({ from: span.start, to: span.end, cls: mark.cls }))
}

/** 两份 token 列表是否逐条相同（`Unchanged` 的判定；修饰符按名字序列比）。 */
export function sameSemanticTokens(left: readonly SemanticToken[], right: readonly SemanticToken[]): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) {
    const a = left[index]!
    const b = right[index]!
    if (a.line !== b.line || a.startChar !== b.startChar || a.length !== b.length || a.type !== b.type) return false
    if (a.modifiers.length !== b.modifiers.length) return false
    for (let bit = 0; bit < a.modifiers.length; bit++) if (a.modifiers[bit] !== b.modifiers[bit]) return false
  }
  return true
}

/**
 * 取这一层的装饰：同修订 + 同一份 token ⇒ 复用已建好的 `DecorationSet`（不重建 RangeSet）。
 * 返回 `null` = 缓存没命中，调用方要重建（并 `store` 回去）。
 */
export function semanticLayerFor(layer: SemanticLayer, state: EditorState, tokens: readonly SemanticToken[]): SemanticLayer | null {
  const revision = semanticRevisionOf(state.doc)
  if (layer.revision !== revision) return null
  const cached = semanticHighlightingCache.tokensFor(state.doc, revision)
  if (!cached || !sameSemanticTokens(cached, tokens)) return null
  return layer
}

/**
 * 兼容旧形状：token 列表 → 装饰集（判据直接调它，不必开编辑器）。
 * 行内越界的区间被夹到行尾；类型未注册的整条不出现。
 */
export function buildSemanticDecorations(state: EditorState, tokens: readonly SemanticToken[]): DecorationSet {
  return decorate(semanticMarksOf(state, tokens))
}

export const semanticTokensState = StateField.define<SemanticLayer>({
  create: () => emptySemanticLayer,
  update: (layer, transaction) => {
    if (transaction.docChanged) {
      // 修订变了：旧文档的快照作废（下一次读必然 miss ⇒ 重新取），区间跟着编辑平移后继续画。
      // 作废走 `invalidatePulledResults()` 而不是直接点这一份缓存 —— 上游那份"一个文件的陈旧"
      // 就是从注册表扇给每条按特性缓存的（`LspHighlightingCacheRegistry.kt:54-56`
      // `allCaches.forEach { if (it.supportsPull) it.forceFullRepull(file) }`，
      // 调用点是 `LspClientImpl.kt:223-233` 的 `invalidateServerResults`）。
      // 今天注册表里只有 semanticTokens 一条，所以两种写法等价；等第二条按特性缓存登记进来时，
      // 这一行不用再改。
      invalidatePulledResults(transaction.startState.doc)
      const marks = remapMarks(layer.marks, transaction.changes)
      return { revision: semanticRevisionOf(transaction.state.doc), marks, decorations: decorate(marks) }
    }
    for (const effect of transaction.effects) {
      if (!effect.is(setSemanticTokens)) continue
      const doc = transaction.state.doc
      const revision = semanticRevisionOf(doc)
      // 同一份文档、同一份结果再派发一次（warmup 重试 / 第二个编辑器）：不重建。
      const reused = semanticLayerFor(layer, transaction.state, effect.value)
      if (reused) return reused
      const marks = semanticMarksOf(transaction.state, effect.value)
      semanticHighlightingCache.store(doc, revision, effect.value)
      return { revision, marks, decorations: decorate(marks) }
    }
    return layer
  },
  // 层里存的是「修订 + 区间 + 已建好的装饰」，所以装饰用 compute 取出来（`decorations.from`
  // 只认值本身就是 DecorationSet 的字段）。
  provide: field => EditorView.decorations.compute([field], state => state.field(field).decorations),
})

export const semanticTokensField: Extension = semanticTokensState
