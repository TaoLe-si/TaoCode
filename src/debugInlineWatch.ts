// 行内监视（`dbg/inline`）—— 上游 `InlineWatch`
// （`platform/xdebugger-impl/shared/src/com/intellij/xdebugger/impl/inline/InlineWatch.kt`）
// 的纯规则。
//
// 上游那句话就是全部语义（`InlineWatch.kt:13-16`）：
//   "A watch that is shown in editor at the specified [position]
//    and evaluated only when the debugger is suspended in the same file."
// 于是三条规则（逐条对上行号）：
//   ① 监视绑一个 `XSourcePosition`（文件 + 1 基行号），`line` 就是 `position.line`（`:23-27`）；
//   ② 只在**同一个文件**里暂停时才求值/显示（`:13-16`）；
//   ③ 锚点是**行尾** —— `document.getLineEndOffset(line)`（`:70-72`）。
//      本仓两个行内渲染器本来就锚在行尾（`src/editorInlineValues.ts:42` 与
//      `src/editorDebugLine.ts:78` 都是 `doc.line(line).to`），与上游同一位置，不用改。
//   ④ 文档改动后重锚：marker 失效（文件被删）就**移除这条监视**，行号变了就换位置
//      （`updatePosition`，`:35-44`；判定在 `:79-81`）。
//
// 与上游的如实差异（写死，不冒充）：上游的 `position` 是 `XSourcePosition`，重锚靠
// `RangeMarker` 跟着文档偏移走（`:70-72` 的 `createRangeMarker`）；本仓没有 RangeMarker，
// 行号由调用方在文档变更后重新喂进来 —— 所以本模块提供 `reanchorInlineWatch`，
// 让调用方用「同一份文本、新的行号」调用它，而不是自己算 diff。

/** 行内监视的最多条数（上游 `InlineWatchesRootNode` 挂在根节点上，没有逐条上限；
 *  这里取一个上限是**本仓自己**的取舍：行内渲染挤满编辑区就没法看了，与
 *  `src/debugInlineValues.ts` 的 `INLINE_VALUE_LIMIT` 同一理由。 */
export const INLINE_WATCH_LIMIT = 8

/** 一条行内监视：表达式 + 锚点（路径 + 1 基行号）。 */
export interface InlineWatchSpec {
  expression: string
  path: string
  line: number
}

/** 会话状态：有哪些行内监视 + 当前停在哪。 */
export interface InlineWatchState {
  watches: InlineWatchSpec[]
  /** 暂停所在文件；没停住就是 null。 */
  pausedPath: string | null
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** 归一一条监视：表达式非空、行号 ≥ 1（上游 `DocumentUtil.isValidLine`，`InlineWatch.kt:70`）、路径非空。 */
export function normalizeInlineWatch(watch: InlineWatchSpec): InlineWatchSpec | null {
  const expression = watch.expression.trim()
  const path = normalizePath(watch.path.trim())
  const line = Math.floor(watch.line)
  if (!expression || !path || !Number.isFinite(line) || line < 1) return null
  return { expression, path, line }
}

/**
 * 这条监视现在该不该画（上游「只在同一个文件里暂停时求值」）。
 * 没停住、或者停的是别的文件 ⇒ false。
 */
export function isInlineWatchVisible(state: InlineWatchState, watch: InlineWatchSpec): boolean {
  if (!state.pausedPath) return false
  return normalizePath(state.pausedPath) === watch.path
}

/** 当前该画的那几条（按行号排序 —— 同一行多条时上游是同位置叠着，本仓按表达式排稳一点）。 */
export function visibleInlineWatches(state: InlineWatchState): InlineWatchSpec[] {
  return state.watches
    .filter(watch => isInlineWatchVisible(state, watch))
    .sort((a, b) => a.line - b.line || a.expression.localeCompare(b.expression))
}

/** 渲染文本：与 `src/debugInlineValues.ts` 的行内值同一形态 `表达式 = 值`。 */
export function inlineWatchText(watch: InlineWatchSpec, value: string | undefined): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  return `${watch.expression} = ${text || '（空）'}`
}

/** 加一条（去重：同表达式 + 同位置已经在就不重复加）。 */
export function addInlineWatch(
  watches: readonly InlineWatchSpec[], watch: InlineWatchSpec, limit = INLINE_WATCH_LIMIT,
): InlineWatchSpec[] {
  const normalized = normalizeInlineWatch(watch)
  if (!normalized) return [...watches]
  const key = inlineWatchKey(normalized)
  if (watches.some(entry => inlineWatchKey(entry) === key)) return [...watches]
  return [...watches, normalized].slice(-limit)
}

export function removeInlineWatch(
  watches: readonly InlineWatchSpec[], watch: InlineWatchSpec,
): InlineWatchSpec[] {
  const key = inlineWatchKey(watch)
  return watches.filter(entry => inlineWatchKey(entry) !== key)
}

function inlineWatchKey(watch: InlineWatchSpec): string {
  return `${watch.path}:${watch.line}:${watch.expression}`
}

/**
 * 文档改动后重锚（上游 `updatePosition`，`InlineWatch.kt:35-44`）。
 * `line === 0` 表示锚点已经失效（文件被删/行没了）⇒ 移除这条。
 * 否则返回搬到了新行号的那一条。
 */
export function reanchorInlineWatch(watch: InlineWatchSpec, line: number): InlineWatchSpec | null {
  const next = Math.floor(line)
  if (!Number.isFinite(next) || next < 1) return null
  return next === watch.line ? watch : { ...watch, line: next }
}

/** 批量重锚，返回仍然有效的那些（失效的被移除 —— 与上游 `false` ⇒ 移除一致）。 */
export function reanchorInlineWatches(
  watches: readonly InlineWatchSpec[], lines: ReadonlyMap<string, number>,
): InlineWatchSpec[] {
  const alive: InlineWatchSpec[] = []
  for (const watch of watches) {
    // key 用路径+表达式：文件级失效由调用方直接把整份清空（没有文件就不该有监视）。
    const next = lines.get(`${watch.path}:${watch.expression}`)
    const moved = next === undefined ? watch : reanchorInlineWatch(watch, next)
    if (moved) alive.push(moved)
  }
  return alive
}
