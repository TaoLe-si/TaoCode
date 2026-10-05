// 面包屑的**符号层级**（上游 `platform/lang-impl` 的 `BreadcrumbsProvider`/`BreadcrumbsUtil`：
// 面包屑 = 文件路径段 + **光标所在符号链**（类 → 方法 → 字段），点某一层弹出**同层兄弟**列表，
// 键盘左右键在段间走。本仓现状（`src/App.vue` 的 `.breadcrumbs`）：只有**目录段 + 文件名**，
// 没有符号层、没有兄弟下拉 —— 而渲染在贴着行数上限的 App.vue（本批冻结）。
//
// 这里把「符号层级 + 兄弟候选」落成纯规则：输入 = 路径 + documentSymbol + 光标行 + 语言，
// 输出 = 面包屑段（跳转目标齐全）。接线时 App.vue 只把 `symbolBreadcrumbs` 的结果并到
// 现有路径段后面、点击时用 `siblingCandidates` 填下拉即可。
//
// 符号层的取法复用粘性行那一套（`stickyLineProviders` 的按语言 kind 表 + 包含光标的区间），
// 保证「粘性行显示什么，面包屑就显示什么」两处不会各说各话。

import type { LspDocumentSymbol } from './bridge'
import { CLASS_LIKE_SYMBOL_KINDS } from './lspSymbolBridge.ts'
import { filterStickySymbols } from './stickyLineProviders.ts'
import { stickyScopes } from './stickyLines.ts'

/** 面包屑的一段。 */
export interface BreadcrumbSegment {
  kind: 'path' | 'file' | 'symbol'
  /** 显示文本。 */
  name: string
  /** 路径段的完整路径（目录段用；符号段为空）。 */
  path?: string
  /** 符号段的区间（0 基；用于跳转与高亮当前段）。 */
  startLine?: number
  endLine?: number
}

/** 文件路径拆成面包屑段：目录逐级 + 文件名（`.`/`..` 段丢掉，Windows 分隔符归一）。 */
export function pathBreadcrumbSegments(path: string): BreadcrumbSegment[] {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '')
  const segments = normalized.split('/').filter(segment => segment && segment !== '.')
  const out: BreadcrumbSegment[] = []
  let current = ''
  segments.forEach((segment, index) => {
    current = current ? `${current}/${segment}` : segment
    const last = index === segments.length - 1
    out.push({ kind: last ? 'file' : 'path', name: segment, path: current })
  })
  return out
}

/**
 * 「只显示到类型层」的裁剪（上游 `UISettings.getShowMembersInNavigationBar()` 关掉时的那一档）：
 *   · `java/java-impl/src/com/intellij/ide/navigationToolbar/JavaNavBarExtension.java:103` ——
 *     成员（方法/字段）不进导航条，返回的是它**所在的 `PsiClass`**；
 *   · 同文件 `:107` —— 连类也不要时退回 `containingFile`；
 *   · `java/java-impl/src/com/intellij/lang/java/JavaBreadcrumbsInfoProvider.java:125` ——
 *     `isShownByDefault() = !getShowMembersInNavigationBar()`：面包屑的符号层默认**不显示成员**。
 * 本仓的等价做法：符号链里只保留「类型」那一层（LSP `SymbolKind` 的 Class/Enum/Interface/Struct
 * = 5/10/11/23，与「转到类」同一份常量 `src/lspSymbolBridge.ts:58`）。
 * 可见结果与上游一致：面包屑停在类名上，兄弟下拉列的是**同层的类**而不是方法。
 * `showMembers` 为 true 时原样返回（默认档，上游该设置项出厂就是 true：
 * `platform/editor-ui-api/src/com/intellij/ide/ui/UISettingsState.kt:121`
 * `var showMembersInNavigationBar: Boolean by property(true)`，
 * 由 `src/settingsModel.ts` 的默认值承接）。
 */
export function typeLevelSymbolsOnly<T extends { kind: number }>(symbols: readonly T[], showMembers: boolean): T[] {
  return showMembers ? [...symbols] : symbols.filter(symbol => CLASS_LIKE_SYMBOL_KINDS.has(symbol.kind))
}

/**
 * 完整面包屑：路径段 + 光标处的符号链（根在前，最内层在后 —— 与 IDEA 的排布一致）。
 * 符号过滤按语言走（Java 不显示字段等），与粘性行同一张表；语言未知时用通用表。
 * `showMembers` = `UISettings.showMembersInNavigationBar`（关掉时只到类型层，见上面那条）。
 */
export function symbolBreadcrumbs(
  path: string, outline: readonly LspDocumentSymbol[], line: number, language?: string, showMembers = true,
): BreadcrumbSegment[] {
  const segments = pathBreadcrumbSegments(path)
  const scopes = stickyScopes(typeLevelSymbolsOnly(filterStickySymbols(outline, language), showMembers), line)
  for (const scope of scopes) segments.push({ kind: 'symbol', name: scope.name, startLine: scope.startLine, endLine: scope.endLine })
  return segments
}

/** 段的可点击性：路径/文件段永远可点；符号段要有区间。 */
export function segmentTarget(segment: BreadcrumbSegment): { path?: string; line?: number } | null {
  if (segment.kind === 'symbol') return Number.isInteger(segment.startLine) ? { line: segment.startLine } : null
  return segment.path ? { path: segment.path } : null
}

/**
 * 兄弟下拉（IDEA 点面包屑段的弹出内容）：列出**同一层**的其它符号。
 * 判定：区间完全落在 `parent`（上一层面包屑段）里、又不与当前符号同起点的那些；`parent` 缺省 = 顶层。
 * 返回按行号排序；`includeSelf` 为 true 时当前符号也留在列表里（打勾标记用）。
 */
export function siblingCandidates(
  outline: readonly LspDocumentSymbol[], current: BreadcrumbSegment, parent: BreadcrumbSegment | null, language?: string,
  includeSelf = false, showMembers = true,
): LspDocumentSymbol[] {
  const pool = typeLevelSymbolsOnly(filterStickySymbols(outline, language), showMembers)
  const isParent = (symbol: LspDocumentSymbol): boolean =>
    Boolean(parent && parent.kind === 'symbol' && symbol.name === parent.name && symbol.startLine === parent.startLine)
  const within = (symbol: LspDocumentSymbol): boolean => {
    if (isParent(symbol)) return false
    if (!parent || parent.kind !== 'symbol' || parent.startLine === undefined || parent.endLine === undefined) return true
    return symbol.startLine >= parent.startLine && symbol.endLine <= parent.endLine
  }
  const isSelf = (symbol: LspDocumentSymbol): boolean =>
    symbol.name === current.name && symbol.startLine === current.startLine
  // 最内层：只取没有中间父符号的项 —— 否则子方法的同级会混进方法列表。
  const candidates = pool.filter(symbol => within(symbol))
  const nested = new Set<LspDocumentSymbol>()
  for (const symbol of candidates)
    for (const inner of candidates)
      if (inner !== symbol && inner.startLine >= symbol.startLine && inner.endLine <= symbol.endLine) nested.add(inner)
  return candidates
    .filter(symbol => !nested.has(symbol) && (includeSelf || !isSelf(symbol)))
    .sort((left, right) => left.startLine - right.startLine)
}

/** 键盘左右移动的目标下标（不环绕：到头上就停，IDEA 的导航栏也是这个手感）。 */
export function moveSegment(index: number, delta: number, count: number): number {
  if (count <= 0) return -1
  const next = Math.max(0, Math.min(count - 1, index + delta))
  return next
}

/** 当前活动段（最内层的符号段；没有符号段时是文件段）。 */
export function activeSegmentIndex(segments: readonly BreadcrumbSegment[]): number {
  for (let index = segments.length - 1; index >= 0; --index) if (segments[index].kind === 'symbol') return index
  return Math.max(0, segments.length - 1)
}

/**
 * 点段之后做什么 —— 上游 `platform/navbar/frontend/src/ui/NavBarItemComponent.kt:127-144`
 * 的 `ItemMouseListener.click(e)`：
 *   · `clickCount == 1` ⇒ `focusItem()` + `vm.select()` + `vm.showPopup()`（`:134-139`）
 *     —— **单击是弹下拉，不是跳转**；
 *   · `clickCount == 2` 且左键 ⇒ `vm.activate()`（`:140-143`）—— 双击才是跳转。
 * 右键弹触发（`:131-133`）本仓交给浏览器的 contextmenu，不走这条。
 */
export function crumbClickAction(clickCount: number): 'popup' | 'navigate' {
  return clickCount >= 2 ? 'navigate' : 'popup'
}

/**
 * 下拉里选中一项之后做什么 —— `platform/navbar/shared/src/NavBarItemExpandResult.kt:12-15`：
 *   · `navigateOnClick` 为 true ⇒ 导航到该项；
 *   · 否则 ⇒ 用该项的 children 开**下一个**下拉；
 *   · **但没有 children 时一律导航**，不看 `navigateOnClick`（`:15`）。
 * `hasChildren` 传「这一项有没有子项」；本仓的符号层用 `siblingCandidates` 的长度判。
 */
export function popupSelectionAction(navigates: boolean, hasChildren: boolean): 'navigate' | 'nextPopup' {
  return navigates || !hasChildren ? 'navigate' : 'nextPopup'
}
