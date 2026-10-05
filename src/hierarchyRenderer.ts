// 层级节点的**分段呈现**与按 kind 的图标（`lp/hierarchy` 判词里的 `HierarchyNodeRenderer`、
// `ls/hierarchy` 判词里的 `LspHierarchyNodeDescriptor.getIcon`）。
//
// 上游依据（逐条）：
//   · `platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyNodeRenderer.java:32-43` ——
//     一行 = `descriptor.getHighlightedText().customize(this)`（**复合文本，分段带样式**）
//     `+ setIcon(...)`；`:45-50` 再给"文件有本地改动"的那一档角标。
//   · 那三段文本的拼法在 LSP 那一族：
//     `platform/lsp-impl/src/impl/features/hierarchy/LspHierarchyNodeDescriptor.kt:25-31` ——
//     `ending.addText(item.name)`，随后**仅当 `detail` 非空白**才追加 `" : $detail"`，
//     并且第二段用 `getPackageNameAttributes()` 的样式；而
//     `platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyNodeDescriptor.java:100-101`
//     写明 `getPackageNameAttributes() == getUsageCountPrefixAttributes()` —— 也就是**次要色**那一档。
//   · 失效节点的前缀：`HierarchyNodeDescriptor.java:131-138` ——
//     `node.hierarchy.invalid`（`platform/platform-api/resources/messages/IdeBundle.properties:217`
//     = `[Invalid]`）加在 `getBeginning()`，且**已经以该前缀开头就不再重复加**（`:136`）。
//   · 图标按 kind：`LspHierarchyNodeDescriptor.kt:45-48` —— `symbolKindCustomizer.getIcon(item.kind)`；
//     kind 编号即 LSP `SymbolKind`（本仓的名字表在 `src/lspSymbolBridge.ts:50-55`）。
//   · `HierarchyNodeDescriptor.java:126-129` 的 `expandOnDoubleClick() == false`：
//     双击层级行**不**展开/导航 —— 本仓的层级行本来就只有单击一条路，此处无需接线。
//
// 架构不等价处（本仓用本仓架构还原用户可见功能）：
//   · Swing 的 `CompositeAppearance`/`TextAttributes` → 本仓的**段数组**（`{text, tone}`），
//     tone 只有 `base` / `muted` 两档（对应上游"主文本"与 `getUsageCountPrefixAttributes()` 的次要色），
//     渲染端给 `.call-name` / `.call-detail` 两个既有的类名 —— **不新增样式**，也不改色值。
//   · `AllIcons` 的类/方法图标 → 本仓 `lucide-vue-next` 组件表（形状照 `src/menuRowIcons.ts:29-31`
//     那张 `Record<string, Component>` + 解析器）；**具体挑了哪个 lucide 图形是本仓自定**（上游图形资源
//     不在本 checkout 的文本可比范围内，按取证口径不猜像素），未识别的 kind 一律返回 `null` ⇒
//     模板 `v-if` 掉，不占图标位（与 `menuRowIcons` 的 `iconOf` 同一条口径）。
//   · `HierarchyNodeRenderer.java:45-50` 的"本地改动角标"没有接：它要求每个节点的文件路径都能查到
//     VCS 状态（本仓的 `git.status` 是**整仓一次**的接口，层级节点可能指向库文件），
//     这一条登记在报告的"做不到"里，不放假角标。
//
// 消费链路：`src/hierarchyView.ts` 的 `hierRows` 每一行都带本模块算出的 `row`；
// 判据 `tests/hierarchy-renderer.test.mjs`。
import type { Component } from 'vue'
import { Box, Boxes, FunctionSquare, Hash, Square, SquareDashed, Type, Variable } from 'lucide-vue-next'

/** 层级行的一个文本段。`tone` 两档：主文本 / 次要色（上游 `getUsageCountPrefixAttributes()`）。 */
export interface HierarchyTextSegment { text: string; tone: 'base' | 'muted' }

/** `HierarchyNodeDescriptor.java:131-138` 的 `[Invalid]` 前缀（中文界面里写成方括号形式，保持同一形状）。 */
export const HIERARCHY_INVALID_PREFIX = '[失效]'

/** 符号 kind → lucide 组件（未列出的 kind 不画图标）。 */
export const HIERARCHY_KIND_ICONS: Readonly<Record<number, Component>> = {
  5: Square,            // Class
  10: Boxes,            // Enum
  11: SquareDashed,     // Interface
  23: Box,              // Struct
  6: FunctionSquare,    // Method
  9: FunctionSquare,    // Constructor
  12: FunctionSquare,   // Function
  7: Variable,          // Property
  8: Variable,          // Field
  13: Variable,         // Variable
  14: Hash,             // Constant
  26: Type,             // TypeParameter
}

/** `LspHierarchyNodeDescriptor.kt:45-48` 的等价解析器。 */
export function hierarchyKindIcon(kind: number | undefined): Component | null {
  if (typeof kind !== 'number') return null
  return HIERARCHY_KIND_ICONS[kind] ?? null
}

/**
 * 一行的文本段（`LspHierarchyNodeDescriptor.kt:25-31`）：
 *   · 名字永远在；
 *   · `detail` 只有**去掉空白后非空**才追加，且带 `" : "` 前缀与次要色；
 *   · 失效节点在**最前面**加前缀，已经有了就不重复（`:136`）。
 */
export function hierarchyTextSegments(
  item: { name?: string; detail?: string | null }, invalid = false,
): HierarchyTextSegment[] {
  const segments: HierarchyTextSegment[] = []
  if (invalid && !(item.name ?? '').startsWith(HIERARCHY_INVALID_PREFIX))
    segments.push({ text: `${HIERARCHY_INVALID_PREFIX} `, tone: 'muted' })
  segments.push({ text: item.name ?? '', tone: 'base' })
  const detail = (item.detail ?? '').trim()
  if (detail) segments.push({ text: ` : ${detail}`, tone: 'muted' })
  return segments
}

/**
 * 右列位置文本：`行:列`，**1 基**（与 `src/chooseTarget.ts:48` 的 `position`、
 * 以及本仓层级面板现有 `(line ?? 0) + 1` 的写法同一口径）。
 * 没有行号（库类型没解析出位置）就返回空串，模板 `v-if` 掉。
 */
export function hierarchyPositionText(item: { line?: number; character?: number }): string {
  const line = item.line
  if (typeof line !== 'number' || !Number.isFinite(line)) return ''
  const character = typeof item.character === 'number' && Number.isFinite(item.character) ? item.character : 0
  return `${line + 1}:${character + 1}`
}

/**
 * 行尾的状态文案（把 `src/App.vue` 层级行里那一串三元表达式收成一个真源）：
 * 查询中 → 正在查询…；递归 → 递归关系（上游 `HierarchyTreeStructure` 的循环检测同效，
 * 本仓的 `recursive` 标记在 `src/hierarchyView.ts:72-73`）；错误 → 错误文本；
 * 展开过但确实没下级 → 没有下级。顺序**照抄现有模板**，不改文案。
 */
export function hierarchyTrailingText(state: { loading?: boolean; recursive?: boolean; error?: string; expanded?: boolean; childCount?: number }): string {
  if (state.loading) return '查询中…'
  if (state.recursive) return '递归关系'
  if (state.error) return state.error
  if (state.expanded && (state.childCount ?? 0) === 0) return '没有下级'
  return ''
}

/** 一行的完整呈现模型。 */
export interface HierarchyRowModel {
  segments: HierarchyTextSegment[]
  icon: Component | null
  position: string
  trailing: string
  /** 展开按钮的 `aria-label`/`title`（纯图标按钮那一条规矩：`title` 与 `aria-label` 都要有）。 */
  toggleLabel: string
}

/**
 * 组装一行（渲染端只做 `{{ segment.text }}` + 类名，判定全在这里）。
 * `invalid` = 该节点解析不出文件/元素失效；本仓目前的失效形态是"库里拿不到符号表"，
 * 由调用方决定，模块不自己猜。
 */
export function hierarchyRowModel(
  node: { item: { name?: string; detail?: string | null; kind?: number; line?: number; character?: number }; loading?: boolean; recursive?: boolean; error?: string; expanded?: boolean; children?: readonly unknown[] | null },
  invalid = false,
): HierarchyRowModel {
  const label = `${node.item.name ?? ''}`
  return {
    segments: hierarchyTextSegments(node.item, invalid),
    icon: hierarchyKindIcon(node.item.kind),
    position: hierarchyPositionText(node.item),
    trailing: hierarchyTrailingText({ loading: node.loading, recursive: node.recursive, error: node.error, expanded: node.expanded, childCount: node.children?.length }),
    toggleLabel: `${node.expanded ? '收起' : '展开'} ${label}`.trim(),
  }
}
