// 代码折叠的命令与纯逻辑 —— 上游 `platform/foldings/src/com/intellij/codeInsight/folding/**`
// 那一族（判决：`docs/inventory/verdict-folding.md`，B4 域）在本仓的等价物。
//
// 本仓的折叠区间来自 **LSP** `textDocument/foldingRange`（`src/bridge.ts` 的 `LspFoldingRange`：
// 0 基行号 + 可选列号 + `kind`），所以上游那套"按 PSI 元素算区间"的部分在这里换成了"按服务端给的区间算"：
//   · `FoldRegion` ↔ 这里的一条 `LspFold`（行区间）；
//   · `FoldingUtil.getFoldRegionsAtOffset` ↔ `innermostAt`（光标所在的最内层区间）；
//   · `FoldingUtil.createFoldTreeIterator` 的层级 ↔ `depthOf`（祖先条数）；
//   · `BaseExpandToLevelAction` 的"展开到第 N 层" ↔ `levelPlan`；
//   · 文档注释那一组（`Collapse/ExpandDocCommentsAction`）↔ `docCommentRanges`（`kind === 'comment'` 且起始行是 doc 记号）。
//
// 区间**按行**来（服务端只给行；IDEA 的 `FoldRegion` 是偏移），所以行模型统一用行号算层级、
// 到用时才换算成偏移；下面「区域层」那一节是偏移模型，给逐个动作挑目标用（上游挑目标靠的是
// `FoldingUtil.findFoldRegionStartingAtLine` / `getFoldRegionsAtOffset`，都是偏移比较）。
import { ensureSyntaxTree, foldable, foldedRanges, foldEffect, foldNodeProp, foldService, syntaxTree, unfoldEffect } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import type { EditorState } from '@codemirror/state'
import { EditorSelection, StateEffect, StateField } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'
import { caretInsideRange, signatureAt as signatureOf } from './editorFoldingState.ts'
import { collapsedByDefaultMarker, commentMarkerBody, markerKindOf } from './customFoldingProviders.ts'
// 另起一条 import（不并进上面那条）：`tests/folding-custom-region-providers.test.mjs` 的锚点
// 钉的是那一条的原样文本。这里要的是**配对时比 provider** 的那两个符号（见 `localRegionFolds`）。
import { matchingStartIndex, type RegionMarker } from './customFoldingProviders.ts'
// 第三条（同样不并进上面两条：那两条的原样文本是 `tests/folding-custom-region-providers.test.mjs:113`
// 的锚点）。这里要的是「折起来以后显示什么文字」那一份规则，见文件末尾的 `foldPlaceholderFor`。
import { placeholderOf } from './customFoldingProviders.ts'

/**
 * LSP `textDocument/foldingRange` 的一条（0 基行号，`kind` 见 LSP 规范：comment / imports / region）。
 * `collapseByDefault` 只有本地 region 标记会带：开始标记写着 `defaultstate="collapsed"`
 * （`NetBeansCustomFoldingProvider.java:46-48`），全局开关关着也要默认折起。
 * `collapsedText` 是服务端给的「折起来以后显示什么」（LSP 3.17 的 `FoldingRange.collapsedText`），
 * 上游把它原样带到 descriptor 上（`LspFoldingBuilder.kt:51` 的 `info.highlightingInfo.collapsedText`），
 * 没有这条时才用默认的三点占位（`UpdateFoldRegionsOperation.java:162` 的 `placeholder == null ? "..." : placeholder`）。
 */
export interface LspFold { startLine: number; endLine: number; kind?: string; collapseByDefault?: boolean; collapsedText?: string }

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

// ── 本地自定义折叠区域（region 标记） ────────────────────────────────────────────────
//
// 上游的自定义折叠不依赖语言服务：`CustomFoldingBuilder.java:33-50` 遍历 PSI 树，只问**注释节点**
// （`:211-213` 的 `isCustomFoldingCandidate`），按 provider 的 `isCustomRegionStart/End`
// （`:164-187`）配对成区间（`:82-91`：区间 = 开始标记起点 → 结束标记末尾）。
// 本仓的折叠区间全部来自 LSP，服务端不发 `region` kind 时（或没接语言服务时）标记就没有折叠 ——
// 这里补上本地解析：标记形态、占位文字与默认折叠规则全在 `src/customFoldingProviders.ts` 那张表里
// （社区树注册的两条 provider 见 `intellij.platform.lang.impl.xml:1466-1467`，
// 加上判决写作「默认标记」的 `//<region>` / `//</region>` 一族）。
// 解析出的区间 `kind: 'region'`，与设置项 `collapseCustomRegions`（`src/editorFoldingSettings.ts`
// 的 `autoCollapseKinds`）走同一条路 —— 开关打开时随开文件默认折起；
// 开始标记自己带 `defaultstate="collapsed"` 的那一条另记 `collapseByDefault`
// （`NetBeansCustomFoldingProvider.java:46-48`，全局开关关着也折）。

/** 去掉注释前缀后的 region 标记正文；不是注释行时返回 null（表在 `src/customFoldingProviders.ts`）。 */
export function regionMarkerBody(line: string): string | null {
  return commentMarkerBody(line)
}

/** 一行的标记类型：`start` / `end` / `null`（不是标记行）。 */
export function regionMarker(line: string): 'start' | 'end' | null {
  return markerKindOf(regionMarkerBody(line))?.kind ?? null
}

/**
 * 扫全文的 region 标记，配对成折叠区间（0 基行号，`kind: 'region'`，`endLine` 是**结束标记那一行**，
 * 折起来只看得见开始标记 —— 与 IDEA 的自定义折叠区域同形）。
 * 支持嵌套（配对按栈）；**未闭合的开始标记不产生区域** —— 一个手误不该让整个文件从那一行折到底。
 * 配对还要**同族**（开始与结束标记得是同一个 provider 的一对，见 `src/customFoldingProviders.ts`
 * 的 `markersPair`）：`//<region>` 不会被 `//endregion` 关掉，`#region` 也不会被 `//</region>` 关掉。
 */
export function localRegionFolds(text: string): LspFold[] {
  // 栈里存「行号 + 认下这行的 provider」；异族的结束标记不算收尾（上游那一份 provider 也认不出它）。
  const stack: { line: number; marker: RegionMarker }[] = []
  const out: LspFold[] = []
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const body = regionMarkerBody(lines[index])
    const marker = markerKindOf(body)
    if (!marker) continue
    if (marker.kind === 'start') stack.push({ line: index, marker })
    else {
      const at = matchingStartIndex(stack.map(entry => entry.marker), marker)
      if (at < 0) continue
      // 压在它上面的异族开始标记没配到收尾 ⇒ 不产生区域（`CustomFoldingBuilder.java:82-91` 同果）。
      const start = stack.splice(at)[0]!.line
      if (index > start) {
        // 只在真带 `defaultstate="collapsed"` 时才加这个字段：区间表处处与别的来源比形状。
        out.push(collapsedByDefaultMarker(regionMarkerBody(lines[start]))
          ? { startLine: start, endLine: index, kind: 'region', collapseByDefault: true }
          : { startLine: start, endLine: index, kind: 'region' })
      }
    }
  }
  return out
}

/**
 * 把本地标记区间并进服务端给的区间：**同样起止的以服务端为准**（它可能带更准的 kind），
 * 本地独有的补在后面。服务端已经给了同一块时不去重就成两条区间，折/展的边界会打架。
 */
export function mergeFoldRanges(remote: readonly LspFold[], local: readonly LspFold[]): LspFold[] {
  const merged = [...remote]
  const seen = new Set(remote.map(range => `${range.startLine}:${range.endLine}`))
  for (const range of local) {
    const key = `${range.startLine}:${range.endLine}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(range)
  }
  return merged
}

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
 * 「折叠代码块」看的那一族区间：`kind` 不是 `comment` / `imports` / `region`
 * （上游 `CollapseBlockAction` 找的是**语言块**，`CollapseBlockHandlerImpl.java:31-34` 沿 PSI 的块往上爬）。
 */
export function blockRanges(ranges: readonly LspFold[]): LspFold[] {
  return ranges.filter(range => range.kind !== 'comment' && range.kind !== 'imports' && range.kind !== 'region')
}

export function blockAt(ranges: readonly LspFold[], line: number): LspFold | null {
  return innermostAt(blockRanges(ranges), line)
}

/** 注释区间（`kind === 'comment'`）—— 上游整个 comment 家族的第一层过滤。 */
export function commentRanges(ranges: readonly LspFold[]): LspFold[] {
  return ranges.filter(range => range.kind === 'comment')
}

/**
 * 文档注释起始行的**词法**判定。上游 `CollapseExpandDocCommentsHandler` 区分「文档注释」与普通注释
 * 靠 `PsiDocCommentBase` 或语言的 `CodeDocumentationAwareCommenter` 的 doc 记号类型
 * （`CollapseExpandDocCommentsHandler.java:46-52` 与 `:66-79`）；本仓没有 PSI，用起始行的记号近似：
 *   · `/** …`（Java/Kotlin/JS/TS/PHP/C 系的 Javadoc/JSDoc；注释体为空的单行写法不算）；
 *   · Python 的 `"""` / `'''` 文档字符串（语言服务把它的折叠区间标成 `comment`）。
 * 认不出的语言返回 false —— 收起文档注释不会误伤普通注释。
 */
export function isDocCommentLine(lineText: string): boolean {
  const text = lineText.trimStart()
  if (text.startsWith('/**')) return !text.startsWith('/**/')
  return text.startsWith('"""') || text.startsWith("'''")
}

/** 文档注释那一组要动的区间（`Collapse/ExpandDocCommentsAction`）：`kind === 'comment'` 且起始行是文档注释记号。 */
export function docCommentRanges(lines: readonly string[], ranges: readonly LspFold[]): LspFold[] {
  return ranges.filter(range => range.kind === 'comment' && isDocCommentLine(lines[range.startLine] ?? ''))
}

/** 状态里的逐行文本（0 基下标 = 行号 - 1），给上面那条词法判定用；命令是用户触发的，整表扫一遍不敏感。 */
function lineTexts(state: EditorState): string[] {
  const lines: string[] = []
  for (let number = 1; number <= state.doc.lines; number++) lines.push(state.doc.line(number).text)
  return lines
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

/**
 * 「折叠代码块」（`CollapseBlock`）那一步的计划 —— 上游 `CollapseBlockHandlerImpl.invoke:19-76` 的等价物。
 * `areas` 是**从最内层往外**排好的块候选（本仓用 `areasContaining`，它按起点降序，
 * 与上游沿 `findParentBlock` 往外爬的顺序一致），`folded` 是当前折着的区间。
 *   · 不含光标的块跳过（`:36-39` 的 `range.containsOffset(offset)` —— 它**含端点**，
 *     `TextRange.java:121-123` 的 `myStartOffset <= offset && offset <= myEndOffset`，
 *     光标压在块的起止那一列上也算这一块）；
 *   · 这一块已经折着 ⇒ 记住它，接着往外爬（`:48-52`，上游 `previous = existing`）；
 *   · 有折着的区间**跨过**这一块的某个端点 ⇒ 停（`:54` 的 `model.intersectsRegion` + `:64` 的 `break`；
 *     它的实现是 `FoldRegionsCache.java:268-275`：某条区域严格含住两端之一、不含住另一端）；
 *   · 否则折这一块（`:44-47` 折已有的展开区域与 `:55-58` 新建一条，在本仓都是同一步 `foldEffect`），
 *     光标落到它的**末尾**（`:46` 的 `existing.getEndOffset()`；`:62` 那句
 *     `block.getTextRange().getEndOffset() < offset ? start : end` 比的是 PSI 块的整块范围与
 *     `getFoldingRange(block)` 这两个对象，本仓只有一个区间 ⇒ 那一支不可达，按规约 §3 不写）；
 *   · 爬到顶只剩一条"已经折着"的 ⇒ **不再折**，只把光标挪到它末尾（`:66-73`，
 *     `previous.setExpanded(false)` 对已折着的是空操作，可见效果就是 `:75` 的那次 `moveToOffset`）。
 *   · `remove`（本批新增）＝ 上面两件事落点那块**里面**那条**用户自建**的折痕：
 *     上游 `:49-50` 在往外爬的途中记下最后一条"已折着、且 `getPsiElement(region) == null`"的区域
 *     （`EditorFoldingInfo.java:44-51`：没有 smart-pointer 就是用户自己建的，不是语言 FoldingBuilder 给的），
 *     然后无论是 `:54-61` 新建外层那块（`myPrevious != null ⇒ removeFoldRegion(myPrevious)`），
 *     还是 `:66-71` 爬到顶只 settle 在 `previous`（同样 `removeFoldRegion(myPrevious)`），都把它撤掉 ——
 *     屏幕上因此**只留外层一条**，不是套娃两条。
 *     本仓没有 PSI 边界可指，等价物是 `foldedRanges` 里那条**不在候选里**（`FoldArea.auto === false`，
 *     `areasOf` 给手工折痕打的那一档）的区间：凡是被这次落点整条含住（`covers` 且非 `boundsEqual`）的手工折痕
 *     都进 `remove`。反向同样成立 —— 落点里那条若本身是**服务端/语法树给的候选**（`auto === true`，
 *     对应上游 `getPsiElement != null`），它不在 `swallowed` 里，也就**不撤**，IDEA 对自动区域同样留着。
 * `collapse: false` 那一档就是最上面这条：做事了（光标动了），但没有新的折痕。
 */
export interface BlockFoldPlan extends Bounds { caret: number; collapse: boolean; remove: readonly FoldArea[] }

/**
 * `swallowed` 是当前**用户自建**（`auto === false`）的折着区间集合，来自 `areasOf(view.state, pos)`。
 * 落点这块把它们整条含住的（`covers` 且非 `boundsEqual`）就是这次要一并撤掉的里层折痕。
 */
export function blockFoldPlan(areas: readonly FoldArea[], folded: readonly Bounds[], pos: number,
  swallowed: readonly FoldArea[] = []): BlockFoldPlan | null {
  const inside = (target: Bounds) => swallowed.filter(area => area.to > area.from && covers(target, area) && !boundsEqual(target, area))
  let previous: FoldArea | null = null
  for (const area of areas) {
    if (area.from > pos || pos > area.to) continue
    if (isCollapsedIn(folded, area)) { previous = area; continue }
    if (folded.some(bounds => containsStrict(bounds, area.from) !== containsStrict(bounds, area.to))) break
    return { from: area.from, to: area.to, caret: area.to, collapse: true, remove: inside(area) }
  }
  return previous ? { from: previous.from, to: previous.to, caret: previous.to, collapse: false, remove: inside(previous) } : null
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
  // 增量解析是**按时间片**做的：`syntaxTree()` 返回的树可能只解析到一半，机器忙或文件大时
  // 光标所在的位置根本没被解析到 —— `resolveInner` 只能摸到 doc 节点，祖先链是空的，
  // 表现就是"光标在块中间按 Ctrl+- 一动不动"（这条正是本函数当初要修的那个真机症状，
  // 2026-10-04 才查清它的另一半：**不止**是"没接语言服务"，树没解析到也是同一个结果）。
  // `ensureSyntaxTree` 把它推到光标处（不需要 view，与 `forceParsing` 是同一件事）；
  // 超时就退回现有的树 —— 折叠是用户按出来的动作，等 200ms 换来正确结果比"没反应"好。
  const tree = ensureSyntaxTree(state, pos, 200) ?? syntaxTree(state)
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
function applyAreas(view: EditorView, areas: readonly { from: number; to: number }[], collapse: boolean): boolean {
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

/**
 * 折叠代码块（`CollapseBlock`，`CollapseBlockAction.java:16-57` + `CollapseBlockHandlerImpl.java:19-76`）：
 * 候选 = 服务端给的"语言块"那一族区间（没有服务端区间时用语法树顶上），沿**最内层→外层**爬，
 * 目标与光标落点见 `blockFoldPlan`（本仓原来是"折一条就完事、光标不动"，那一版少了上游的
 * 光标落点 `:75` 与"这块已经折着就只挪光标"那一段 `:66-73`）。
 */
export const foldBlockAtCaret: Command = view => {
  const pos = view.state.selection.main.head
  const blocks: FoldArea[] = []
  for (const range of blockRanges(rangesOf(view.state))) {
    const offsets = offsetsOf(view.state, range)
    if (offsets) blocks.push({ ...offsets, auto: true, kind: range.kind })
  }
  if (!blocks.length) {
    // 没接语言服务（服务端不给区间）时整条候选链都来自语法树：光标行起头的那块，加上
    // **光标套在里面的**祖先链（祖先链上带的 `foldNodeProp` 都是花括号块，注释不在链上，所以不用再挑 kind）。
    const head = syntaxArea(view.state, pos) ?? enclosingAreas(view.state, pos)[0] ?? null
    if (head && !blocks.some(area => area.from === head.from && area.to === head.to)) blocks.push(head)
    for (const area of enclosingAreas(view.state, pos)) {
      if (!blocks.some(existing => existing.from === area.from && existing.to === area.to)) blocks.push(area)
    }
  }
  const folded = foldedBounds(view.state)
  // 里层"用户自建"的折痕 = `areasOf` 里那条 `auto === false` 的（不在服务端/语法树候选里）；
  // 交给 `blockFoldPlan` 算 `remove`，折外层时一起撤掉（见 `CollapseBlockHandlerImpl:50/:58-61/:66-71`）。
  const userFolds = areasOf(view.state, pos).filter(area => !area.auto)
  const plan = blockFoldPlan(areasContaining(blocks, pos), folded, pos, userFolds)
  if (!plan) return false
  if (plan.collapse && !applyAreas(view, [plan], true)) return false
  if (plan.remove.length) applyAreas(view, plan.remove, false)
  // 上游折完把光标放到这块的末尾（`:75` 的 `moveToOffset(targetCaretOffset[0])`）；
  // 落在折痕的**边界**上，CodeMirror 不会把它顺手解掉（实测见 `collapseSelectionAfterOverlapConfirm` 的注释）。
  if (plan.caret !== pos) view.dispatch({ selection: EditorSelection.cursor(plan.caret) })
  return true
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
  if (!collapse) return applyRanges(view, ranges, false)
  // 折的时候跳过"光标**严格**落在里面"的那几条：上游 `UpdateFoldRegionsOperation.shouldExpandNewRegion:236-253`
  // 在编辑器初始化时就是这么判的（`caretInsideRange`），不然新折的区间会把光标盖住。
  // 用户主动的收起/切换不走这里（`collapseTarget` 那一条路），所以"在光标处按收起"照旧有效。
  const caret = view.state.selection.main.head
  const safe = ranges.filter(range => {
    const offsets = offsetsOf(view.state, range)
    return !offsets || !caretInsideRange(caret, offsets)
  })
  return applyRanges(view, safe, true)
}

/**
 * 开始标记自带 `defaultstate="collapsed"` 的那几条区域：与 `collapseCustomRegions` 全局开关无关，
 * 关着也默认折（上游 `NetBeansCustomFoldingProvider.java:46-48` 的 `isCollapsedByDefault`，
 * 由 `CustomFoldingBuilder.java:131-142` 在每条区间落地时单独问一次）。
 * 折的时候同样跳过光标**严格**落在里面的那几条（同 `foldKinds`，`UpdateFoldRegionsOperation:236-253`）。
 */
export function foldDefaultCollapsed(view: EditorView): boolean {
  const ranges = rangesOf(view.state).filter(range => range.collapseByDefault === true)
  if (!ranges.length) return false
  const caret = view.state.selection.main.head
  return applyRanges(view, ranges.filter(range => {
    const offsets = offsetsOf(view.state, range)
    return offsets !== null && !caretInsideRange(caret, offsets)
  }), true)
}

// ── 「全部收起/全部展开」的选区作用域 ─────────────────────────────────────────────────
//
// 上游 `BaseFoldingHandler.getFoldRegionsForSelection:43-58`：有选区时取
// 「与选区搭界（`getRegionsOverlappingWith`）」**且**「整条落在选区里」的那些区间；
// 一个都没有就退回全文（`editor.getFoldingModel().getAllFoldRegions()`）。
// `CollapseAllRegionsAction:31` 与 `ExpandAllRegionsAction` 都以它为目标集合 ——
// 也就是"框住一段按 Ctrl+Shift+-，只折这一段"。本仓原来直接用 CodeMirror 的整篇 `foldAll`，
// 判词因此记「缺 `getFoldRegionsForSelection`」（`docs/inventory/verdict-folding.md` §G 的
// `BaseFoldingHandler` / `CollapseAllRegionsAction` / `ExpandAllRegionsAction` 三行）。
//
// 两段式（`twoStepFoldToggling`）在本仓仍是一段：`keepExpandedOnFirstCollapseAll` 是语言侧
// `FoldingBuilder` 的钩子（`FoldingBuilder.java:65-70` 默认 false），上游 LSP 路径没覆盖它，
// 判词 §G 的 `CollapseAllRegionsAction` 行已经算过这一条。

/** 与选区搭界且整条落在选区里的区间；没有选区（或选区里一条都没有）返回 null = 用全集。 */
export function selectionScoped(areas: readonly { from: number; to: number }[], from: number, to: number): { from: number; to: number }[] | null {
  if (from >= to) return null
  const inside = areas.filter(area => area.to > from && area.from < to && area.from >= from && area.to <= to)
  return inside.length ? inside : null
}

/**
 * 全部收起（`CollapseAllRegionsAction`）。两条分支：
 *   · 选区里有**完整落在其中**的区间 → 只作用那几条
 *     （`BaseFoldingHandler.getFoldRegionsForSelection:43-58`，本仓的 `selectionScoped`）；
 *   · 否则整篇 —— 逐行问 `foldable`、命中就跳到那条区间的尾行之后继续
 *     （CodeMirror `foldAll` 的走法，但用**文档行**而不是 `view.lineBlockAt` 的渲染行：
 *     折叠候选是语法/LSP 的概念，与软换行无关，这样在没有真实 EditorView 的场合（单测）也跑得动）。
 */
export const foldAllCommand: Command = view => {
  const selection = view.state.selection.main
  const scoped = selectionScoped(areasOf(view.state, selection.head), selection.from, selection.to)
  if (scoped) return applyAreas(view, scoped, true)
  const whole: { from: number; to: number }[] = []
  for (let number = 1; number <= view.state.doc.lines;) {
    const line = view.state.doc.line(number)
    const range = foldable(view.state, line.from, line.to)
    if (range && range.to > range.from) {
      whole.push(range)
      number = view.state.doc.lineAt(range.to).number + 1
    } else number++
  }
  return applyAreas(view, whole, true)
}

/** 全部展开（`ExpandAllRegionsAction`）：目标换成正折着的那些，选区作用域同上。 */
export const unfoldAllCommand: Command = view => {
  const selection = view.state.selection.main
  const folded = foldedBounds(view.state)
  return applyAreas(view, selectionScoped(folded, selection.from, selection.to) ?? folded, false)
}

// 上游 `CollapseSelectionHandler.java:44`：命中一条**自动生成**的折叠区域时不移除它，
// 而是弹一条轻量信息提示。文案 = `CodeInsightBundle.properties:269`
// （`collapse.selection.existing.autogenerated.region`），中文取随 IDE 发货的
// `localization-zh.jar` 的 `messages/CodeInsightBundle.properties:97`。
export const CANNOT_REMOVE_AUTOGENERATED_REGION = '无法移除自动生成的折叠区域'

/**
 * 「折叠选区/移除区域」做成了哪一步（宿主据此决定要不要弹 `CANNOT_REMOVE_AUTOGENERATED_REGION`）。
 * 规则与 `toggleFoldSelection` 同源，只是把结果说出来：
 *   · `removed`        —— 手工折的那条被移除（`:37-41`）；
 *   · `collapsed`      —— 折起选区那几行（`:63-69`）；
 *   · `toggled`        —— 没有选区，切换光标处最内层（`:75-87`）；
 *   · `autogenerated` —— 正好等于一条自动生成的区间，**不许**移除（`:42-45`）；
 *   · `overlapping`    —— 与别的区间搭界，上游弹确认框且默认「取消」，本仓按取消不动（`:49-58`）；
 *   · `nothing`        —— 什么都没做。
 */
export type FoldSelectionOutcome = 'removed' | 'collapsed' | 'toggled' | 'autogenerated' | 'overlapping' | 'nothing'

/** 上游 `CollapseSelectionHandler.isEnabled`：有选区，或光标处有一个可切换的折叠区域。 */
export function isFoldSelectionEnabled(view: EditorView): boolean {
  const { state } = view
  const selection = state.selection.main
  return selection.from < selection.to || areasContaining(areasOf(state, selection.head), selection.head).length > 0
}

export function foldSelectionOutcome(view: EditorView): FoldSelectionOutcome {
  const { state } = view
  const selection = state.selection.main
  const folded = foldedBounds(state)
  if (selection.from >= selection.to) {
    const target = areasContaining(areasOf(state, selection.head), selection.head)[0] ?? null
    if (!target) return 'nothing'
    return applyAreas(view, [target], !isCollapsedIn(folded, target)) ? 'toggled' : 'nothing'
  }
  let end = selection.to
  if (state.doc.sliceString(end - 1, end) === '\n') end--
  const exact = folded.find(bounds => bounds.from === selection.from && bounds.to === end) ?? null
  if (exact) {
    const auto = autoAreas(state, selection.head).some(area => area.from === exact.from && area.to === exact.to)
    if (auto) return 'autogenerated'
    return applyAreas(view, [exact], false) ? 'removed' : 'nothing'
  }
  if (folded.some(bounds => containsStrict(bounds, selection.from) !== containsStrict(bounds, end))) return 'overlapping'
  return applyAreas(view, [{ from: selection.from, to: end }], true) ? 'collapsed' : 'nothing'
}

/**
 * 重叠确认框按「确定」之后要做的那一步（`CollapseSelectionHandler.java:59-71`）。
 * 上游 `:49-58` 弹一个默认按钮是「取消」的确认框（本仓没有编辑器内模态宿主 ⇒ 默认路径就是取消，
 * `foldSelectionOutcome` 的 `overlapping` 那一档），用户点了「确定」才走这里：
 *   · `:59-65` 移除**跨过选区任一边界**的那些区间 —— 两个析取式：左边界被跨过（起点在选区前、
 *     终点落在选区里）与右边界被跨过（起点落在选区里、终点在选区后）；只搭边界的不动；
 *   · `:66-71` 再把选区本身折起来（占位文字 `ourPlaceHolderText = "..."`，`:22`），
 *     光标落到 `min(start + "...".length(), textLength)`（`:68-70`）。
 * 「移除」在 CodeMirror 里就是 `unfoldEffect`（本仓没有可独立删除的区域对象，展开 = 这条区间不再存在）。
 * 返回 `foldSelectionOutcome` 同一套档位，宿主据此决定要不要再提示一句。
 */
export function collapseSelectionAfterOverlapConfirm(view: EditorView): FoldSelectionOutcome {
  const { state } = view
  const selection = state.selection.main
  if (selection.from >= selection.to) return 'nothing'
  let end = selection.to
  if (state.doc.sliceString(end - 1, end) === '\n') end--
  // 上游 `:59-65` 是两个析取式（跨过左边界 / 跨过右边界）。本仓只留第一条，因为第二条在这里不可达：
  // 「跨过右边界」意味着选区头（`end`）落在那条区间**里面**，而 CodeMirror 的 foldState 在设选区
  // 那一刻就把「光标落在里面」的折叠解掉了（实测判据 = `tests/folding-selection-overlap.test.mjs`
  // 最后两条）⇒ 走到这一步时那种区间已经不存在。留着是一条永不命中的分支 ⇒ 按规约 §3 不写死代码。
  const straddling = foldedBounds(state).filter(bounds =>
    bounds.from < selection.from && bounds.to > selection.from && bounds.to < end)
  const effects = straddling.map(bounds => unfoldEffect.of(bounds))
  if (end > selection.from) effects.push(foldEffect.of({ from: selection.from, to: end }))
  if (!effects.length) return 'nothing'
  view.dispatch({
    effects,
    // 上游把光标放到「占位文字之后」（`:68-70` 的 `min(start + ourPlaceHolderText.length(), textLength)`）。
    // CodeMirror 的 foldState 在**同一笔事务**里会把「光标落在里面」的那条折叠当场解掉
    // （实测：同一条 foldEffect，光标停在区间内 ⇒ `foldedRanges` 为空；停在边界上 ⇒ 留住），
    // 所以本仓的等价落点是这条折痕的**起点**（看得见的第一行 = 那段占位文字所在的位置）。
    selection: EditorSelection.cursor(selection.from),
  })
  return 'collapsed'
}

/** 收起/展开文档注释（`Collapse/ExpandDocCommentsAction`）：只动**文档**注释，普通注释不碰（上游口径见 isDocCommentLine）。 */
export const foldDocComments: Command = view => applyRanges(view, docCommentRanges(lineTexts(view.state), rangesOf(view.state)), true)
export const unfoldDocComments: Command = view => applyRanges(view, docCommentRanges(lineTexts(view.state), rangesOf(view.state)), false)

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
 * 规则与六档结果都在 `foldSelectionOutcome`（那一份把每一步说出来，宿主据此弹提示）。
 * 命令层只回「这一下有没有做事」：`autogenerated`（不许移除自动生成的区间）与
 * `overlapping`（上游弹确认框且默认「取消」）都算没做事 —— 与改动前的行为一致。
 */
export const toggleFoldSelection: Command = view => {
  const outcome = foldSelectionOutcome(view)
  return outcome === 'removed' || outcome === 'collapsed' || outcome === 'toggled'
}

// ── 导航落点：先把它所在的那块打开 ────────────────────────────────────────────────────
//
// 上游 `UpdateFoldRegionsOperation.java:143` 每一轮重算都要问一次
// `OpenFileDescriptor.getRangeToUnfoldOnNavigation(myEditor)`，命中就展开：
// `shouldExpandNewRegion:243-249` 的 `ApplyDefaultStateMode.EXCEPT_CARET_REGION`（这一档由
// `FoldingUpdate.java:155` 在「这次重算来自一次导航」时给出）先判
// `rangeToUnfoldOnNavigation.intersects(range)` ⇒ 相交的区间一律返回「展开」，**哪怕它本该按默认折着**。
// 用户可见的那件事：转到用法 / 转到行 / 栈帧跳进一段折起来的代码时，IDEA 先把那块打开，
// 而不是把光标放进折痕里（光标落在 `...` 上、看不见自己要改的那一行）。
// `TextRange.intersects` **含端点**（`TextRange.java:237-238` 的 `Math.max(myStartOffset, startOffset)
// <= Math.min(myEndOffset, endOffset)`；不含端点的那一个叫 `intersectsStrict`，`:241-243`）⇒
// 光标正好压在折痕边界上（空行那一行的行首 = 下面那块的起点）也要把这块打开，只搭一个端点**算**相交。

/**
 * 展开与这一段相交的折痕（上游 `shouldExpandNewRegion:245-247` 与 `OpenFileDescriptor.unfoldCurrentLine:208`
 * 用的都是 `range.intersects(region)` —— 含端点，见上面那段）；没有可展开的就返回 false。
 * 只把反向的段（`to < from`）当"没有这一段"：`to === from` 是空行上的导航落点，上游照样算相交。
 */
export function unfoldIntersecting(view: EditorView, from: number, to: number): boolean {
  if (to < from) return false
  const hit = foldedBounds(view.state).filter(bounds => Math.max(bounds.from, from) <= Math.min(bounds.to, to))
  return applyAreas(view, hit, false)
}

/**
 * 「跳进来以后别再把这块折上」那一段的区间（上游 `OpenFileDescriptor.getRangeToUnfoldOnNavigation:215-221`
 * 就是**光标那一整行**：`getLineStartOffset(line)` → `getLineEndOffset(line)`；
 * `:205-212` 的展开循环用的正是它 —— 把与这一行**相交**（`TextRange.intersects`，含端点）的折着区间一律打开）。
 * 给第二个实参时按调用方的段算（`OpenFileDescriptor` 的 navigationRange 本身就是一段的场合，
 * 例如从用法列表跳到 `foo(...)` 的那几个字符）。
 */
export function navigationRange(state: EditorState, offset: number, to?: number): { from: number; to: number } {
  const clamped = Math.max(0, Math.min(offset, state.doc.length))
  if (to !== undefined && to > clamped) return { from: clamped, to: Math.min(to, state.doc.length) }
  const line = state.doc.lineAt(clamped)
  return { from: line.from, to: line.to }
}

// ── 折起来以后显示的那段文字（占位符） ────────────────────────────────────────────────
//
// 上游每条折叠区域都带一段 placeholder，折痕处显示它：
//   · 默认是**三个点**（`UpdateFoldRegionsOperation.java:162` 的 `placeholder == null ? "..." : placeholder`），
//     不是 CodeMirror 那个单字符省略号 `…`（`@codemirror/language` 的 `FoldConfig.placeholderText` 默认值）；
//   · LSP 服务端给的 `collapsedText` 优先（`LspFoldingBuilder.kt:51` 把它交给 descriptor）；
//   · 自定义折叠区域那段是 provider 的 `getPlaceholderText`（`CustomFoldingBuilder.java:102-111`），
//     正则与「取不到就回吐整段注释」的规则在 `src/customFoldingProviders.ts` 那张表里
//     —— 弹层列表（`src/customFoldingRegions.ts`）与折痕用的是同一份，不会出现两种文字。
// 渲染钩子在 `codeFolding({ placeholderDOM, preparePlaceholder })`（`@codemirror/language` 的
// `FoldConfig`，`node_modules/@codemirror/language/dist/index.d.ts:771/:776/:783`，默认档 `placeholderText: "…"`
// 在 `dist/index.js:1517`），而 `codeFolding()` 现在是 `basicSetup` 带进来的（`src/components/CodeEditor.vue:935`，
// 那里没有本仓自己的 `codeFolding(...)` 那一句 ⇒ `grep -n codeFolding src/components/CodeEditor.vue` 零命中）
// ⇒ 宿主那一句是接线请求（`docs/wiring-requests-2026-10-06-stickyfold.md` W-1；
// 留痕：这里原写「接线请求（W-7）」、并把它指向 `docs/wiring-requests-2026-10-06-folding2.md`，
// 那份文件不在盘上 ⇒ 那条请求从没落过盘。2026-10-06 `stickyfold` 复核 `basicSetup` 的行号时是 935，原文写 937）：
// 本模块先把「这一段该显示什么」算出来，`foldPlaceholderFor` 正是 `preparePlaceholder` 要的那份值。

/** 上游的默认占位文字：三个点（`UpdateFoldRegionsOperation.java:162`）。 */
export const FOLD_PLACEHOLDER_TEXT = '...'

/**
 * 这条折痕该显示的文字，三条来源按上游优先级：服务端 `collapsedText` →
 * region 开始标记的 provider 说明 → 三点。认不出区间（语法树折的那块）时也是三点
 * —— 上游对没有 descriptor 的折叠同样只有默认占位。
 */
export function foldPlaceholderFor(state: EditorState, range: { from: number; to: number }): string {
  if (!state.doc.length) return FOLD_PLACEHOLDER_TEXT
  for (const fold of rangesOf(state)) {
    const bounds = offsetsOf(state, fold)
    if (!bounds || bounds.from !== range.from) continue
    if (typeof fold.collapsedText === 'string' && fold.collapsedText !== '') return fold.collapsedText
    if (fold.kind !== 'region') return FOLD_PLACEHOLDER_TEXT
    const lineText = state.doc.lineAt(Math.min(bounds.from, state.doc.length - 1)).text
    return placeholderOf(regionMarkerBody(lineText), lineText.trim())
  }
  return FOLD_PLACEHOLDER_TEXT
}
