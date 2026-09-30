// 代码折叠的命令与纯逻辑 —— 上游 `platform/foldings/src/com/intellij/codeInsight/folding/**`
// 那一族（判决：`docs/inventory/verdict-folding.md`，B4 域）在本仓的等价物。
//
// 本仓的折叠区间来自 **LSP** `textDocument/foldingRange`（`src/bridge.ts` 的 `LspFoldingRange`：
// 0 基行号 + 可选列号 + `kind`），所以上游那套"按 PSI 元素算区间"的部分在这里换成了"按服务端给的区间算"：
//   · `FoldRegion` ↔ 这里的一条 `LspFold`（行区间）；
//   · `FoldingUtil.getFoldRegionsAtOffset` ↔ `innermostAt`（光标所在的最内层区间）；
//   · `FoldingUtil.createFoldTreeIterator` 的层级 ↔ `depthOf`（祖先条数）；
//   · `BaseExpandToLevelAction` 的"展开到第 N 层" ↔ `levelPlan`；
//   · 文档注释那一组（`Collapse/ExpandDocCommentsAction`）↔ `commentRanges`（`kind === 'comment'`）。
//
// 区间**按行**来（服务端只给行；IDEA 的 `FoldRegion` 是偏移），所以行模型统一用行号算层级、
// 到用时才换算成偏移；下面「区域层」那一节是偏移模型，给逐个动作挑目标用（上游挑目标靠的是
// `FoldingUtil.findFoldRegionStartingAtLine` / `getFoldRegionsAtOffset`，都是偏移比较）。
import { foldable, foldedRanges, foldEffect, foldNodeProp, foldService, syntaxTree, unfoldEffect } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import type { EditorState } from '@codemirror/state'
import { StateEffect, StateField } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'
import { signatureAt as signatureOf } from './editorFoldingState.ts'

/** LSP `textDocument/foldingRange` 的一条（0 基行号，`kind` 见 LSP 规范：comment / imports / region）。 */
export interface LspFold { startLine: number; endLine: number; kind?: string }

/** 服务端给的折叠区间（`CodeEditor.vue` 请求回来后就装进这个 field）。 */
export const setFoldingRanges = StateEffect.define<readonly LspFold[]>()
export const foldingRanges = StateField.define<readonly LspFold[]>({
  create: () => [],
  update: (value, tr) => {
    for (const effect of tr.effects) if (effect.is(setFoldingRanges)) return effect.value
    return tr.docChanged ? [] : value
  },
})

/** 供给 CodeMirror 的同步 `foldService`：文档变了就先把旧区间清掉（行号对不上了），等下一次请求回来再装上。 */
export const lspFoldService = foldService.of((state, lineStart) => {
  const ranges = state.field(foldingRanges, false)
  if (!ranges || !ranges.length) return null
  const line = state.doc.lineAt(lineStart)
  const range = ranges.find(entry => entry.startLine === line.number - 1)
  if (!range) return null
  if (range.endLine + 1 > state.doc.lines) return null
  const from = state.doc.line(range.startLine + 1).from
  const to = state.doc.line(range.endLine + 1).to
  return to > from ? { from, to } : null
})

// ── 行模型（LSP 区间那棵树） ──────────────────────────────────────────────────────────

/** 一条区间在区间集合里的层级（1 基：最外层 = 1）。 */
export function depthOf(ranges: readonly LspFold[], range: LspFold): number {
  let depth = 1
  for (const other of ranges) {
    if (other === range) continue
    if (other.startLine < range.startLine && other.endLine >= range.endLine) depth++
  }
  return depth
}

/** 光标所在行的**最内层**区间（`FoldingUtil.getFoldRegionsAtOffset` 取第一个的那一层意思）。 */
export function innermostAt(ranges: readonly LspFold[], line: number): LspFold | null {
  let best: LspFold | null = null
  for (const range of ranges) {
    if (range.startLine > line || range.endLine < line) continue
    if (!best || range.startLine >= best.startLine) best = range
  }
  return best
}

/**
 * 挑根区间：**起始行正好是光标行**的那条，认不出（没有 / 不止一条）才退回最内层那条。
 * 上游两处都是这个形状：`ExpandRegionAction` 的 `findFoldRegionStartingAtLine` 认不出就
 * `getFoldRegionsAtOffset(...)[0]`（`ExpandRegionAction.java:43-48`），`CollapseRegionAction.java:26-37` 同。
 */
export function rootAtLine(ranges: readonly LspFold[], line: number): LspFold | null {
  const starting = ranges.filter(range => range.startLine === line)
  return starting.length === 1 ? starting[0] : innermostAt(ranges, line)
}

/** 严格套在 `outer` 里的那些区间（递归收起/展开要用的子树）。 */
export function nestedWithin(ranges: readonly LspFold[], outer: LspFold): LspFold[] {
  return ranges.filter(range => range !== outer && range.startLine > outer.startLine && range.endLine <= outer.endLine)
}

/**
 * 「折叠代码块」用的那一条：`kind` 不是 `comment` / `imports` / `region` 的最内层区间
 * （上游 `CollapseBlockAction` 找的是 PSI 里的代码块/花括号；服务端把语言块标成不带 kind 的区间）。
 */
export function blockAt(ranges: readonly LspFold[], line: number): LspFold | null {
  const candidates = ranges.filter(range =>
    range.kind !== 'comment' && range.kind !== 'imports' && range.kind !== 'region')
  return innermostAt(candidates, line)
}

/** 文档注释那一组要动的区间（`Collapse/ExpandDocCommentsAction`）。 */
export function commentRanges(ranges: readonly LspFold[]): LspFold[] {
  return ranges.filter(range => range.kind === 'comment')
}

/**
 * 「展开到第 N 层」（`BaseExpandToLevelAction.java:43-70`）：层级**相对根算** ——
 * 比第 N 层浅的展开、正好第 N 层的折起、更深的**原样不动**。
 * `root === null` 是 `ExpandAllToLevelNAction`（`expandAll=true`）：根层按文件顶层算。
 * 注意上游对"正中第 N 层"是 `setExpanded(false)`：这两个动作不只是"展开"，第 N 层反而要折起来。
 */
export function levelPlan(ranges: readonly LspFold[], root: LspFold | null, level: number): { expand: LspFold[]; collapse: LspFold[] } {
  const rootDepth = root ? depthOf(ranges, root) : 1
  const scope = root ? [root, ...nestedWithin(ranges, root)] : ranges
  const expand: LspFold[] = []
  const collapse: LspFold[] = []
  for (const range of scope) {
    const relative = depthOf(ranges, range) - rootDepth
    if (relative < level) expand.push(range)
    else if (relative === level) collapse.push(range)
  }
  return { expand, collapse }
}

// ── 区域层（上游 `FoldRegion` 的等价物，逐个动作挑目标用） ─────────────────────────────
//
// 上游的「折叠区域」是文件里**全部**区间（含展开着的），命令都在这个集合上挑（`FoldingUtil`）。
// 本仓没有这个常驻集合，得拼出来：
//   · 已折叠的区间 = CodeMirror 的 `foldedRanges`（手工折的与自动折的都在里面，本身不带来源标记）；
//   · 已展开的区间 = 候选区间：LSP `foldingRange` ∪ 光标行的语法树候选（`foldable`）。
// 两者并起来就是上游 `getAllFoldRegions` 的等价物；`auto` 标出自动生成的（LSP / 语法树）那些 ——
// 上游靠 `EditorFoldingInfo.getPsiElement(region) == null` 认手工建的区间
// （`CollapseSelectionHandler.java:39`、`:79`）。
export interface FoldArea { from: number; to: number; auto: boolean; kind?: string }

/** 一段偏移区间（`foldedRanges` 里那条折叠区间的边界）。 */
interface Bounds { from: number; to: number }

const covers = (outer: Bounds, inner: Bounds) => inner.from >= outer.from && inner.to <= outer.to
const containsStrict = (area: Bounds, offset: number) => area.from < offset && offset < area.to
const boundsEqual = (one: Bounds, other: Bounds) => one.from === other.from && one.to === other.to

/**
 * 这条区域自己折着没有 —— 边界**一模一样**才算（同一块只会记一种边界，见 `autoAreas` 的去重）。
 * 不能拿"里面有东西折着"代替：CodeMirror 的折叠可以嵌套，而 `unfoldEffect` 只认精确边界
 * （`foldState` 的过滤比的是 from/to 相等），把外层当成"折着"就会顺手把里层的也展开
 * （真机上踩过：嵌套两条折着时按 Ctrl+= 一下展开两条）。
 */
export function isCollapsedIn(folded: readonly Bounds[], area: Bounds): boolean {
  return folded.some(bounds => boundsEqual(bounds, area))
}

/**
 * 起始行落在光标行的区域；不止一条就认不出来（上游 `FoldingUtil.findFoldRegionStartingAtLine`
 * 的"多于一條就返回 null"，`FoldingUtil.java:33-45`）。
 * 认不出不吃亏：调用方接着会退到"光标处套着的那几条"（`areasContaining`），
 * 而同一行起头的那几条里最内层那条照样落在光标身上。
 */
export function areaStartingAtLine(areas: readonly FoldArea[], lineFrom: number, lineTo: number): FoldArea | null {
  const starting = areas.filter(area => area.from >= lineFrom && area.from <= lineTo)
  return starting.length === 1 ? starting[0] : null
}

/** 光标所在处套着的区域，**最内层在前**（上游 `getFoldRegionsAtOffset` 按起点降序，`FoldingUtil.java:54`）。 */
export function areasContaining(areas: readonly FoldArea[], pos: number): FoldArea[] {
  return areas
    .filter(area => area.from <= pos && pos <= area.to)
    .sort((a, b) => (b.from - a.from) || (b.to - a.to))
}

/** 收起（`CollapseRegionAction.java:26-38`）：起始行认得出就用它（还展开着的话），否则光标处最内层**未折叠**的那条。 */
export function collapseTarget(areas: readonly FoldArea[], folded: readonly Bounds[], pos: number, lineFrom: number, lineTo: number): FoldArea | null {
  const starting = areaStartingAtLine(areas, lineFrom, lineTo)
  if (starting && !isCollapsedIn(folded, starting)) return starting
  return areasContaining(areas, pos).find(area => !isCollapsedIn(folded, area)) ?? null
}

/** 展开（`ExpandRegionAction.java:43-55`）：起始行认得出就用它（折着的话），否则光标处**最外层**折着的那条。 */
export function expandTarget(areas: readonly FoldArea[], folded: readonly Bounds[], pos: number, lineFrom: number, lineTo: number): FoldArea | null {
  const starting = areaStartingAtLine(areas, lineFrom, lineTo)
  if (starting && isCollapsedIn(folded, starting)) return starting
  const containing = areasContaining(areas, pos)
  for (let index = containing.length - 1; index >= 0; index--) {
    if (isCollapsedIn(folded, containing[index])) return containing[index]
  }
  return null
}

/** 切换折叠（`ExpandCollapseToggleAction.kt:17-25`）：起始行认得出就用它，否则光标处最内层那条。 */
export function toggleTarget(areas: readonly FoldArea[], _folded: readonly Bounds[], pos: number, lineFrom: number, lineTo: number): FoldArea | null {
  return areaStartingAtLine(areas, lineFrom, lineTo) ?? areasContaining(areas, pos)[0] ?? null
}

/**
 * 递归收起/展开要动的集合（`BaseFoldingHandler.getFoldRegionsForCaret` :61-86）：
 * 根先按"起始行在当前行"挑，挑不到（或收起时它已经折着）就换光标处**展开态与目标一致**的最内层那条；
 * 结果 = 根 + 严格套在根里的全部区域。
 */
export function recursiveScope(areas: readonly FoldArea[], folded: readonly Bounds[], pos: number, lineFrom: number, lineTo: number, collapse: boolean): FoldArea[] {
  let root = areaStartingAtLine(areas, lineFrom, lineTo)
  if (!root || (collapse && isCollapsedIn(folded, root))) {
    root = areasContaining(areas, pos).find(area => isCollapsedIn(folded, area) !== collapse) ?? null
  }
  return root ? areas.filter(area => covers(root!, area)) : []
}

// ── 命令（都返回 boolean：false = 这一下没做事） ─────────────────────────────────────

function offsetsOf(state: EditorState, range: LspFold): Bounds | null {
  const start = state.doc.line(Math.min(range.startLine + 1, state.doc.lines))
  const end = state.doc.line(Math.min(range.endLine + 1, state.doc.lines))
  return end.to > start.from ? { from: start.from, to: end.to } : null
}

function rangesOf(state: EditorState): readonly LspFold[] {
  return state.field(foldingRanges, false) ?? []
}

function foldedBounds(state: EditorState): Bounds[] {
  const out: Bounds[] = []
  for (const iterator = foldedRanges(state).iter(); iterator.value; iterator.next()) out.push({ from: iterator.from, to: iterator.to })
  return out
}

/** 服务端给的区间（自动生成）。 */
function lspAreas(state: EditorState): FoldArea[] {
  const out: FoldArea[] = []
  for (const range of rangesOf(state)) {
    const offsets = offsetsOf(state, range)
    if (offsets) out.push({ ...offsets, auto: true, kind: range.kind })
  }
  return out
}

/**
 * 光标行的语法树候选（上游永远有 `FoldingBuilder`，本仓没接语言服务的文件只能靠 CodeMirror 自己的判定）。
 * `foldable` 先问 `foldService`（也就是上面那条 LSP 服务），问不到才看语法树；它只看**光标这一行**，
 * 所以"从这一行起头的那一块"靠它，光标在块中间的情况由 `enclosingAreas` 补。
 */
function syntaxArea(state: EditorState, pos: number): FoldArea | null {
  const line = state.doc.lineAt(pos)
  const candidate = foldable(state, line.from, line.to)
  return candidate && candidate.to > candidate.from ? { from: candidate.from, to: candidate.to, auto: true } : null
}

/**
 * 光标**套在里面**的语法块，从最内层往外（祖先链上带 `foldNodeProp` 的那些）。
 * 上游 `getFoldRegionsAtOffset` 拿的是"文件里全部区间里含住光标的那些"；服务端不给区间时
 * （未跟踪文件 / 没接语言服务）只有这条路能摸到外层块 —— 光标在块中间时 `foldable` 返回空
 * （真机上验过：光标在 `return a` 上按 Ctrl+- 什么也没发生）。
 */
export function enclosingAreas(state: EditorState, pos: number): FoldArea[] {
  const tree = syntaxTree(state)
  if (!tree.length) return []
  const out: FoldArea[] = []
  for (let node: SyntaxNode | null = tree.resolveInner(pos, -1); node; node = node.parent) {
    const range = node.type.prop(foldNodeProp)?.(node, state) ?? null
    if (range && range.from <= pos && pos <= range.to && range.to > range.from) out.push({ ...range, auto: true })
  }
  return out
}

/**
 * 一台块只会进一条：**服务端给的行优先**。同一块会有两种边界（LSP 给整块、CodeMirror 的
 * `foldInside` 给花括号内部），两条都留着的话"这块折着没有"就说不清了 —— 折的时候记的是哪一种，
 * 展开（`unfoldEffect`）就得按哪一种。按起始行去重，LSP 那条排在最前面。
 */
const autoAreas = (state: EditorState, pos: number): FoldArea[] => {
  const lsp = lspAreas(state)
  const out = [...lsp]
  const taken = new Set(lsp.map(area => state.doc.lineAt(area.from).number))
  for (const candidate of [syntaxArea(state, pos), ...enclosingAreas(state, pos)]) {
    if (!candidate) continue
    const line = state.doc.lineAt(candidate.from).number
    if (taken.has(line)) continue
    taken.add(line)
    out.push(candidate)
  }
  return out
}

/** 上游那套区域集合的等价物：自动生成的候选 + 手工折的那些（`foldedRanges` 里没被候选覆盖到的）。 */
function areasOf(state: EditorState, pos: number): FoldArea[] {
  const auto = autoAreas(state, pos)
  const out = [...auto]
  for (const bounds of foldedBounds(state)) {
    if (!auto.some(area => area.from === bounds.from && area.to === bounds.to)) out.push({ ...bounds, auto: false })
  }
  return out
}

/** 把一批区域折起/展开（`editor.getFoldingModel().runBatchFoldingOperation` 的对应物）。 */
function applyAreas(view: EditorView, areas: readonly FoldArea[], collapse: boolean): boolean {
  const folded = foldedBounds(view.state)
  const effects = []
  for (const area of areas) {
    if (collapse) {
      if (area.to <= area.from || isCollapsedIn(folded, area)) continue
      effects.push(foldEffect.of({ from: area.from, to: area.to }))
    } else {
      for (const bounds of folded) if (boundsEqual(bounds, area)) effects.push(unfoldEffect.of(bounds))
    }
  }
  if (!effects.length) return false
  view.dispatch({ effects })
  return true
}

/** 行模型那一批（文档注释 / 到级别）按区间集合折起或展开。 */
function applyRanges(view: EditorView, ranges: readonly LspFold[], collapse: boolean): boolean {
  const folded = foldedBounds(view.state)
  const effects = []
  for (const range of ranges) {
    const offsets = offsetsOf(view.state, range)
    if (!offsets) continue
    if (collapse) {
      if (isCollapsedIn(folded, offsets)) continue
      effects.push(foldEffect.of(offsets))
    } else {
      for (const bounds of folded) if (boundsEqual(bounds, offsets)) effects.push(unfoldEffect.of(bounds))
    }
  }
  if (!effects.length) return false
  view.dispatch({ effects })
  return true
}

/** 当前折着的区间（偏移）—— 存档与"重算时清失效项"都要读它。 */
export function foldedAreasOf(state: EditorState): Bounds[] {
  return foldedBounds(state)
}

/** 当前候选区间（服务端 + 语法树 + 手工），带 `kind` —— 存档判断"本该默认折着"用。 */
export function candidatesOf(state: EditorState): { from: number; to: number; kind?: string }[] {
  return areasOf(state, state.selection.main.head).map(area => ({ from: area.from, to: area.to, kind: area.kind }))
}

const caretLine = (state: EditorState) => state.doc.lineAt(state.selection.main.head).number - 1

/** 一个光标所在的行（挑区域时要比"起始行是不是光标行"）。 */
interface Line { from: number; to: number }

/**
 * 每个光标各挑一条目标（上游这几个动作都在 `getAllCarets()` 上循环，`CollapseRegionAction.java:19-25`）。
 * 多光标落在同一块里时目标会重复，`applyAreas` 自己幂等（已折的不再折），不用去重。
 */
function perCaret<T>(state: EditorState, pick: (areas: FoldArea[], folded: Bounds[], pos: number, line: Line) => T[]): T[] {
  const folded = foldedBounds(state)
  const out: T[] = []
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.head)
    out.push(...pick(areasOf(state, range.head), folded, range.head, line))
  }
  return out
}

const one = <T,>(value: T | null): T[] => (value ? [value] : [])

/** 收起（`CollapseRegion`）：光标处那一条区域 —— 具体挑法见 `collapseTarget`。 */
export const foldAtCaret: Command = view => {
  const targets = perCaret(view.state, (areas, folded, pos, line) => one(collapseTarget(areas, folded, pos, line.from, line.to)))
  return targets.length ? applyAreas(view, targets, true) : false
}

/** 展开（`ExpandRegion`）。 */
export const unfoldAtCaret: Command = view => {
  const targets = perCaret(view.state, (areas, folded, pos, line) => one(expandTarget(areas, folded, pos, line.from, line.to)))
  return targets.length ? applyAreas(view, targets, false) : false
}

/** 递归收起（`CollapseRegionRecursively`）：光标处那块区域 + 套在里面的全部。 */
export const foldRecursively: Command = view => {
  const scope = perCaret(view.state, (areas, folded, pos, line) => recursiveScope(areas, folded, pos, line.from, line.to, true))
  return scope.length ? applyAreas(view, scope, true) : false
}

/** 递归展开（`ExpandRegionRecursively`）。 */
export const unfoldRecursively: Command = view => {
  const scope = perCaret(view.state, (areas, folded, pos, line) => recursiveScope(areas, folded, pos, line.from, line.to, false))
  return scope.length ? applyAreas(view, scope, false) : false
}

/** 切换折叠（`ExpandCollapseToggleAction`）：光标处折着就展开，否则收起。 */
export const toggleFoldAtCaret: Command = view => {
  const targets = perCaret(view.state, (areas, folded, pos, line) => one(toggleTarget(areas, folded, pos, line.from, line.to)))
  const folded = foldedBounds(view.state)
  return applyAreas(view, targets.filter(area => !isCollapsedIn(folded, area)), true)
    || applyAreas(view, targets.filter(area => isCollapsedIn(folded, area)), false)
}

/** 折叠代码块（`CollapseBlock`）：不带 comment/imports/region 的最内层区间。 */
export const foldBlockAtCaret: Command = view => {
  const ranges = rangesOf(view.state)
  const pos = view.state.selection.main.head
  const target = blockAt(ranges, caretLine(view.state))
  if (target) return applyRanges(view, [target], true)
  // 没接语言服务（服务端不给区间）时用语法树顶上：光标行起头的那块，或者**光标套在里面的**最内层块
  // （祖先链上带的 `foldNodeProp` 都是花括号块，注释不在链上，所以不用再挑 kind）。
  const candidate = syntaxArea(view.state, pos) ?? enclosingAreas(view.state, pos)[0] ?? null
  return candidate ? applyAreas(view, [candidate], true) : false
}

/**
 * 按存档恢复折叠状态（`DocumentFoldingInfo.setToEditor` 的等价物）：折起 `fold` 里的、展开 `unfold` 里的。
 * 只认精确边界（`unfoldEffect` 的规矩），越界或不成立的直接跳过。
 */
export function applyFoldPlan(view: EditorView, fold: readonly Bounds[], unfold: readonly Bounds[]): boolean {
  const doc = view.state.doc
  const length = doc.length
  const folded = foldedBounds(view.state)
  const effects = []
  // 匹配不只看边界相等：编辑会把旧折叠的偏移推走一点（上游是 RangeMarker，自己跟着动），
  // 所以同一块（**签名**相同）也认 —— 不然"用户展开过的块"会在重算后留在折着的状态（真机上踩过）。
  const sameBlock = (target: Bounds) => folded.filter(current => current.from === target.from && current.to === target.to
    || signatureOf(doc, current) === signatureOf(doc, target))
  for (const bounds of fold) {
    if (bounds.from < 0 || bounds.to > length || bounds.from >= bounds.to) continue
    if (sameBlock(bounds).length) continue
    effects.push(foldEffect.of(bounds))
  }
  for (const bounds of unfold) {
    for (const current of sameBlock(bounds)) effects.push(unfoldEffect.of(current))
  }
  if (!effects.length) return false
  view.dispatch({ effects })
  return true
}

/**
 * 按 LSP `kind` 折起/展开一族区间 —— 「打开时按设置预折叠」与"设置改了重算"都用它
 * （上游 `LspFoldingBuilder.kt:41-46` 的 `collapsedByDefault` + `CodeFoldingConfigurable.Util` 的重算）。
 * 幂等：`applyRanges` 自己跳过已经折着的。
 */
export function foldKinds(view: EditorView, kinds: readonly string[], collapse: boolean): boolean {
  if (!kinds.length) return false
  const ranges = rangesOf(view.state).filter(range => range.kind !== undefined && kinds.includes(range.kind))
  return applyRanges(view, ranges, collapse)
}

/** 收起/展开文档注释（`Collapse/ExpandDocCommentsAction`）。 */
export const foldDocComments: Command = view => applyRanges(view, commentRanges(rangesOf(view.state)), true)
export const unfoldDocComments: Command = view => applyRanges(view, commentRanges(rangesOf(view.state)), false)

/** 展开到第 N 层（`ExpandToLevelNAction`）：根 = 光标行的区间（挑法见 `rootAtLine`）。 */
export function expandCaretToLevel(level: number): Command {
  return view => {
    const ranges = rangesOf(view.state)
    const root = rootAtLine(ranges, caretLine(view.state))
    if (!root) return false
    const plan = levelPlan(ranges, root, level)
    // 两半都要做（上游是在**同一次** runBatchFoldingOperation 里做的）：折第 N 层、展开更浅的。
    const collapsed = applyRanges(view, plan.collapse, true)
    return applyRanges(view, plan.expand, false) || collapsed
  }
}

/** 全部展开到第 N 层（`ExpandAllToLevelNAction`）：根按文件顶层算。 */
export function expandAllToLevel(level: number): Command {
  return view => {
    const plan = levelPlan(rangesOf(view.state), null, level)
    const collapsed = applyRanges(view, plan.collapse, true)
    return applyRanges(view, plan.expand, false) || collapsed
  }
}

/**
 * 折叠选区/移除区域（`CollapseSelection`，`CollapseSelectionHandler.java:24-90`）：
 * 有选区时 —— 正好等于某条已折区间就**移除**它（自动生成的不许移除，上游给提示；本仓没有编辑器内提示通道，
 * 按"不动"处理，判决表登记）；和别的折叠区域搭界（只含住选区一头）时上游弹「存在重叠的折叠区域」确认框、
 * 默认「取消」，本仓按取消处理；都不是就把选区那几行折起来。
 * 没选区时 —— 切换光标处最内层的那条区域（`:75-87`）。
 */
export const toggleFoldSelection: Command = view => {
  const { state } = view
  const selection = state.selection.main
  const folded = foldedBounds(state)
  if (selection.from >= selection.to) {
    const target = areasContaining(areasOf(state, selection.head), selection.head)[0] ?? null
    return target ? applyAreas(view, [target], !isCollapsedIn(folded, target)) : false
  }
  let end = selection.to
  if (state.doc.sliceString(end - 1, end) === '\n') end--
  const exact = folded.find(bounds => bounds.from === selection.from && bounds.to === end) ?? null
  if (exact) {
    const auto = autoAreas(state, selection.head).some(area => area.from === exact.from && area.to === exact.to)
    if (auto) return false
    view.dispatch({ effects: unfoldEffect.of(exact) })
    return true
  }
  if (folded.some(bounds => containsStrict(bounds, selection.from) !== containsStrict(bounds, end))) return false
  view.dispatch({ effects: foldEffect.of({ from: selection.from, to: end }) })
  return true
}
