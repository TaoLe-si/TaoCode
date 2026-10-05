// 层级视图的**范围收窄**（`lp/hierarchy` 判词里的 `HierarchyBrowserScopes`）。
//
// 上游依据（逐条）：
//   · 五档范围名的常量表：`platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyBrowserScopes.java:8-12`
//     —— `SCOPE_PROJECT="Production"` / `SCOPE_ALL="All"` / `SCOPE_CLASS="This Class"` /
//     `SCOPE_MODULE="This Module"` / `SCOPE_TEST="Test"`；
//     `HierarchyBrowserBaseEx.java:109-113` 原样转名，`:235-243` 给每档的**呈现名**
//     （Production/Tests/All 走 scope 对象的 `getPresentableName()`，
//     「本类」「本模块」走 `platform/lang-api/resources/messages/LangBundle.properties:348`/`:349`
//     = "This Class" / "This Module"；「全部」= `platform/analysis-api/resources/messages/AnalysisBundle.properties:206`
//     `all.scope.name=All`）。
//   · 真正生效的过滤谓词：`platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyTreeStructure.java:159-199`
//     的 `isInScope(baseClass, srcElement, scopeType)`：
//       — `This Class` → `PsiTreeUtil.isAncestor(baseClass, srcElement, true)`（`:161-164`）；
//       — `This Module` → 该元素所在文件在基类的模块作用域里（`:165-169`）；
//       — `Production` → **工程内**且**不是测试源**（`:170-177`，`!TestSourcesFilter.isTestSources`）；
//       — `Test` → 是测试源（`:178-181`）；
//       — `All` → 一律 true（`:182-184`）；
//       — 其它字符串 → 命名作用域（`NamedScopesHolder`，`:185-199`）。本仓没有命名作用域宿主
//         （那张表在桶 13 名下 `src/scopes.ts`），所以本模块**只实现上面五档**，不假装有第六档。
//   · 范围切换的入口：`HierarchyBrowserBaseEx.java:775` 把 `This Class` 作为一个本地 scope 加进下拉。
//
// 架构不等价处（本仓用本仓架构还原用户可见功能）：
//   · 上游判"在不在范围内"用的是 PSI 元素 + 模块/测试源根索引；本仓的层级节点只有
//     `{path, line, name, kind}`（LSP `HierarchyItem`，见 `src/bridge.ts` 的 `LspHierarchyItem`），
//     所以：
//       — `This Class` = **与根节点同一文件**（本仓的层级节点没有"祖先元素"概念，
//         `isAncestor` 的最粗等价就是同文件；差异如实写在这里）；
//       — `This Module` = **与根节点同一个一级目录**（本仓工作区是单根，`src/bridge.ts` 的
//         `Workspace{name, root, entries}` 没有 Module 表 ⇒ 用路径第一级近似）；
//       — `Production` / `Test` = 复用 `src/navGotoTest.ts` 的 `isTestPath`（同一份上游依据：
//         `TestSourcesFilter.isTestSources` 的路径形态），两处不会出现"一个算测试一个算生产"的分歧。
//   · 默认档：**All** —— 上游 `HierarchyBrowserManager.State` 没有默认范围字段，`HierarchyTreeStructure`
//     构造时的 scopeType 就是 `SCOPE_ALL`（`getSearchScope` 的兜底分支 `GlobalSearchScope.allScope`，
//     `HierarchyTreeStructure.java:161` 之前那两行），本仓同档。
//
// 消费链路：`src/hierarchyView.ts`（面板的状态与行过滤都调这里）；判据 `tests/hierarchy-scopes.test.mjs`。
import { isTestPath } from './navGotoTest.ts'

/** 五档范围（键 = 上游常量值，别翻成中文键：判据与请求都按上游字符串对齐）。 */
export type HierarchyScopeId = 'Production' | 'All' | 'This Class' | 'This Module' | 'Test'

/** 范围下拉的顺序与呈现名（顺序照 `HierarchyBrowserBaseEx.java:235-243` 那张表的书写序）。 */
export const HIERARCHY_SCOPES: readonly { id: HierarchyScopeId; label: string }[] = [
  { id: 'All', label: '全部' },
  { id: 'Production', label: '生产代码' },
  { id: 'Test', label: '测试' },
  { id: 'This Class', label: '本类' },
  { id: 'This Module', label: '本模块' },
]

/** 默认档（见文件头对上游初始 scope 的核对）。 */
export const DEFAULT_HIERARCHY_SCOPE: HierarchyScopeId = 'All'

/** 节点的最小形状（`src/bridge.ts` 的 `LspHierarchyItem` 子集）。 */
export interface HierarchyScopedNode { path: string }

/** 路径归一 + 取第一级目录（`This Module` 的近似依据）。 */
function topLevelDirectory(path: string): string {
  const segments = (path ?? '').replace(/\\/g, '/').replace(/^\.\//, '').split('/')
  return segments.length > 1 ? segments[0]! : ''
}

/**
 * `isInScope`（`HierarchyTreeStructure.java:159-199`）的本仓形态。
 * `base` 为 null 时（还没根节点）一律放行 —— 上游的 `thisClass == null` 那一支同样不收窄（`:161`）。
 */
export function nodeInScope(node: HierarchyScopedNode, scope: HierarchyScopeId, base: HierarchyScopedNode | null): boolean {
  if (!node || !node.path) return false
  switch (scope) {
    case 'All':
      return true
    case 'Production':
      // 上游还要求"工程内"（`:170-176`）；本仓的层级节点路径全部来自工作区或库文件，
      // 库文件（绝对路径 / jar 内）用"路径里有分隔符且不在工作区一级目录"判不出工程内外，
      // 所以这一档只实现"非测试源"那一半 —— 差异记在报告里。
      return !isTestPath(node.path)
    case 'Test':
      return isTestPath(node.path)
    case 'This Class':
      return base !== null && node.path === base.path
    case 'This Module':
      return base === null || topLevelDirectory(node.path) === topLevelDirectory(base.path)
    default:
      // 未知档位 = 命名作用域，本仓没有宿主 ⇒ 与上游 `namedScope == null` 的那一条一致：不收。
      return false
  }
}

/** 一批节点的范围过滤（保持原序；范围非法就退回默认档而不是清空列表）。 */
export function filterNodesByScope<T extends HierarchyScopedNode>(nodes: readonly T[], scope: HierarchyScopeId, base: HierarchyScopedNode | null): T[] {
  const known = HIERARCHY_SCOPES.some(entry => entry.id === scope)
  const effective: HierarchyScopeId = known ? scope : DEFAULT_HIERARCHY_SCOPE
  return nodes.filter(node => nodeInScope(node, effective, base))
}

/** 一级目录（判据与面板提示用）。 */
export function moduleDirectoryOf(path: string): string {
  return topLevelDirectory(path)
}

/** 范围切换后的计数提示（面板标题尾巴；不参与判定）。 */
export function scopeNotice(scope: HierarchyScopeId, kept: number, total: number): string {
  const label = HIERARCHY_SCOPES.find(entry => entry.id === scope)?.label ?? HIERARCHY_SCOPES[0]!.label
  return `${label}：${kept} / ${total}`
}
