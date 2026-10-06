// 粘性行的**视图层判据**（`lp/sticky-lines` 判决点名的缺口：`StickyLinesPass` 那一层的
// 「按可视区取候选 / 宽度不够不算一层 / 面板放不下就不画 / 每个视图各算各的」）。
//
// 上游坐标（判定基准只有上游源码树，逐条自核过）：
//   · `platform/lang-impl/src/com/intellij/codeInsight/stickyLines/StickyLinesPass.kt:21-32`
//     —— 后台采集（`doCollectInformation`）与落地（`doApplyInformationToEditor`）分两段；
//     采集面是**整篇文档的每一行**（`StickyLinesCollector.kt:104-109` 逐行问
//     `computeStickyLineInfos(..., endOffset)`），落地时与已有层合并（`:120-127`）。
//   · `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/VisualStickyLines.kt`
//     `:66-87` `collectLogical`：候选 = **与「可视区顶行往下 panelHeight 那一段」重叠**的作用域
//     （顶行由 `visibleArea.y` 换算，`:70` 的 `maxStickyPanelHeight = lineHeight * lineLimit + 1`），
//     不是「包含光标行」；
//     `:96-110` 按**主行**去重（同一个视觉行只钉一条），`:111` `visualLines.sort()`；
//     `:102` + `:162-163` `isScopeNotNarrow`：作用域要占满 `scopeMinSize` 行才算一层
//     （默认 5 行，`:18-19` 那个次构造；`:21-23` 要求它不小于 2）；
//     `:125-127` + `:158-159` `isPanelTooBig`：面板高度加两行超过视口一半就**一条都不画**；
//     `:144-148` 排到 `lineLimit` 条就停（从最外那条开始排 ⇒ 被裁掉的是**最内**的）。
//   · `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/StickyLinesModelImpl.java`
//     `:287-296` 的 `compareTo`：起始偏移升序，**同起点时结束偏移降序**（宽的在前）；
//     `:112-117` 起止相同的作用域直接抛（零宽不算一层），`:157-160`（Collector）把
//     打字打成零长的旧层当过期项删掉。
//   · 多分栏：模型挂在**文档**的 MarkupModel 上（`StickyLinesModelImpl.java:93-100`，
//     一份文档一份模型），面板与可视区挂在**每个编辑器**上
//     （`StickyLinesManager.kt:20-34` 每个 editor 一个 manager + `:86-99` 的 `visibleAreaChanged`）
//     ⇒ 同一个文件开在两个分栏里，**层是共享的、显示哪些层各算各的**。
//     `StickyLinesCollector.kt:36-51` 的 `ModStamp.isChanged` 是这一条的另一半：
//     新开的编辑器（新分栏）**第一次必须重跑**（`:39` 注释「always run pass on editor opening IJPL-158818」），
//     之后才按修订号比（`:77-79` 的修订号 = PSI 修订号 + 文档修订号，两段合起来才挡得住
//     「PSI 没变但文档模型被回收重建」）。
//
// **无法核实**（不编）：判决原文写的是「`StickyLinesPass` 的 daemon 合帧与**按视图优先级排序**」。
// 上游 `stickyLines` 目录里搜不到任何 priority 字样的排序（对该目录 grep priority 零命中），
// 能核实的只有两条：同一文档的层按 `StickyLinesModelImpl.java:287-296` 的比较器排（起始升序、
// 同起点宽的在前），以及每个编辑器用自己的可视区独立算一份
// （`StickyLinesManager.kt:86-99` + `VisualStickyLines.kt:33-42`）。本模块按这两条实现，
// 「视图优先级」那一档留成 `stickyLinesPerView` 的入参顺序（宿主给什么顺序就按什么顺序，不替宿主编一个）。

/** 默认最小作用域行数（`VisualStickyLines.kt:18-19` 的 `scopeMinSize = 5`）。 */
export const DEFAULT_SCOPE_MIN_LINES = 5
/** 该值允许的下限（`VisualStickyLines.kt:21-23` 的 `require(scopeMinSize >= 2)`）。 */
export const MIN_SCOPE_MIN_SIZE = 2
/** 面板高度超过视口这个比例就整条不画（`VisualStickyLines.kt:158-159`：`+2*lineHeight > height/2`）。 */
export const PANEL_HEIGHT_DIVISOR = 2

/** 一个粘性行面板的身份与度量：`id` 由宿主给（哪个分栏/哪个标签），行号一律 1 基。 */
export interface StickyView {
  /** 视图身份（同一个文档开在几个分栏里就各有 id）。 */
  id: string
  /** 可视区第一行（1 基）。没有就退回「按光标行判」那条路径。 */
  firstVisibleLine?: number
  /** 一行像素高（`editor.lineHeight`）。 */
  lineHeight?: number
  /** 可视区高度（像素，`visibleArea.height`）。 */
  viewportHeight?: number
}

type Scope = { startLine: number; endLine: number }

/** 作用域占多少行（含首尾两行）—— `isScopeNotNarrow` 比的就是这个数。 */
export function stickyScopeSpan(scope: Scope): number {
  return scope.endLine - scope.startLine + 1
}

/** 这一层够宽吗（`VisualStickyLines.kt:162-163`）；`minLines` 低于 2 时按 2 算（`:22` 的 require）。 */
export function scopeNotNarrow(scope: Scope, minLines: number = DEFAULT_SCOPE_MIN_LINES): boolean {
  return stickyScopeSpan(scope) >= Math.max(MIN_SCOPE_MIN_SIZE, minLines)
}

/** 上游比较器（`StickyLinesModelImpl.java:287-296`）：起始升序，同起点时结束**降序**（宽的在前）。 */
export function compareStickyScopes(left: Scope, right: Scope): number {
  return left.startLine - right.startLine || right.endLine - left.endLine
}

/** 候选窗口（`VisualStickyLines.kt:70-74`）：从可视区顶行往下「面板能放的那几行」那一段。 */
export function stickyPanelWindow(view: StickyView, lineLimit: number): { fromLine: number; toLine: number } | null {
  if (view.firstVisibleLine === undefined) return null
  const fromLine = view.firstVisibleLine
  // 上游按像素换算：`xyToLogicalPosition(yStart + lineHeight * lineLimit + 1)`。
  // 本仓的 `lineLimit` 就是「面板最多几行」⇒ 窗口 = 顶行往下 limit 行（行高只影响像素、不影响行数）。
  const rows = Math.max(0, Math.floor(lineLimit))
  return { fromLine, toLine: fromLine + rows }
}

/** 作用域是否与那段窗口**重叠**（`VisualStickyLines.kt:83` 走的是 `processStickyLines(startOffset, endOffset)`，即相交而非包含）。 */
export function overlapsStickyWindow(scope: Scope, window: { fromLine: number; toLine: number }): boolean {
  const from = window.fromLine - 1
  const to = window.toLine - 1
  return scope.startLine <= to && scope.endLine >= from
}

/** 面板放得下吗（`VisualStickyLines.kt:158-159`）：行高或视口高没给时不做这一档判断（视为放得下）。 */
export function stickyPanelFits(rows: number, view: StickyView): boolean {
  if (!view.lineHeight || view.lineHeight <= 0 || !view.viewportHeight || view.viewportHeight <= 0) return true
  return rows * view.lineHeight + 2 * view.lineHeight <= view.viewportHeight / PANEL_HEIGHT_DIVISOR
}

/**
 * 一个视图该显示哪些层（上游 `VisualStickyLines` 的那一段纯逻辑）：
 * 窗口相交 → 宽度门槛 → 按主行去重 → 比较器排序 → 从最外那条起排、满 `lineLimit` 就停 →
 * 面板放不下就一条都不给。
 * 入参是 `stickyScopes` 那一份候选（已经过 provider 的 kind 白名单）。
 */
export function stickyVisualLines<T extends Scope>(scopes: readonly T[], view: StickyView, lineLimit: number): T[] {
  if (!(lineLimit > 0)) return []
  const window = stickyPanelWindow(view, lineLimit)
  const candidates = scopes
    .filter(scope => scope.endLine > scope.startLine)   // 零宽作用域不算一层（`StickyLinesModelImpl.java:112-117`）
    .filter(scope => scopeNotNarrow(scope))
    .filter(scope => !window || overlapsStickyWindow(scope, window))
    .sort(compareStickyScopes)
  const seen = new Set<number>()
  const picked: T[] = []
  for (const scope of candidates) {
    if (seen.has(scope.startLine)) continue             // 同一主行只钉一条（`VisualStickyLines.kt:96-100`）
    seen.add(scope.startLine)
    picked.push(scope)
    if (picked.length >= lineLimit) break               // 满了就停（`:145`）：被裁掉的是更**内**的那些
  }
  return stickyPanelFits(picked.length, view) ? picked : []
}

/**
 * 多分栏：同一个文档开在几个视图里时，每个视图按自己的可视区各算一份
 * （`StickyLinesManager.kt:20-34` 每编辑器一个 manager）。
 * `views` 的顺序由宿主给（哪个面板在上/有焦点只有 `App.vue` 知道），本模块不替它编。
 */
export function stickyLinesPerView<T extends Scope>(
  scopes: readonly T[], views: readonly StickyView[], lineLimit: number,
): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const view of views) out.set(view.id, stickyVisualLines(scopes, view, lineLimit))
  return out
}

/** 修订号（`StickyLinesCollector.kt:77-79`）：PSI/结构修订号 + 文档修订号，两段相加。 */
export function stickyRevisionStamp(structureStamp: number, documentStamp: number): number {
  return structureStamp + documentStamp
}

export interface StickyPassState {
  /** 已经跑过采集的视图 id → 当时的修订号。 */
  readonly seen: Readonly<Record<string, number>>
}

/**
 * 这个视图要不要重跑采集（`StickyLinesCollector.kt:36-51` 的 `ModStamp.isChanged`）：
 * 该视图**第一次**出现时必跑（`:39`「always run pass on editor opening」，
 * 新开一个分栏时哪怕文档一个字没改也要有粘性行），之后按修订号比（`:47-50`）。
 * 返回下一份状态，交回调用方存着（纯函数，不改入参）。
 */
export function stickyPassNeeded(
  state: StickyPassState, view: StickyView, stamp: number,
): { needed: boolean; state: StickyPassState } {
  const previous = state.seen[view.id]
  if (previous === undefined) return { needed: true, state: { seen: { ...state.seen, [view.id]: stamp } } }
  if (previous === stamp) return { needed: false, state }
  return { needed: true, state: { seen: { ...state.seen, [view.id]: stamp } } }
}

/** 空状态（`{ seen: {} }`）：所有视图都还没跑过。 */
export function emptyStickyPassState(): StickyPassState {
  return { seen: {} }
}
