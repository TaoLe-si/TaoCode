// 层级树行的**身份 / 展开态 / 计数**（W-2「行模型」那一半）—— 一趟算清，不在面板里数第二遍。
//
// 与用法树行模型（`src/usageViewTreeModel.ts`、`src/usageViewGrouping.ts`）的**分工与不复用理由**
// （同一形状不重写第二遍：能共用的规则先共用，共用车不上的才在本模块落地并写明为什么）：
//   · 可直接共用的那一条已经共用了 —— 折叠按钮的 `title`/`aria-label` 走
//     `usageViewTreeModel.ts:185-187` 的 `usageTreeToggleLabel`（`src/hierarchyRenderer.ts` 现在就是调它，
//     原来那里自己拼了一遍「展开/收起 + 名字」，两份写法一定会漂）；
//   · `usageViewGrouping.ts:573-582` 的 `UsageLevelCount`（own/child/total 三格账）**不搬**：
//     上游的层次行**根本没有计数格** —— `platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyNodeRenderer.java:32-43`
//     只画「复合文本 + 图标」两件事，`HierarchyNodeDescriptor.java:97-99` 那个
//     `getUsageCountPrefixAttributes()` 只是**样式档**（`:101-103` 把它给了包名段），
//     用法树那三格账对的是 `GroupNode.getUsageNodes()/getSubGroups()/getRecursiveUsageCount()`
//     （`platform/usageView-impl/src/com/intellij/usages/impl/GroupNode.java:399-407`、`:409-417`、`:363-366`），
//     层次侧没有对应物 ⇒ 搬过来就是给屏上不存在的格子编数；
//   · `usageViewGrouping.ts:655-666` 的 `carryUsageExpansion(root, options, previous)` **签名吃
//     `UsageTreeNode`**（`children/locations/count`），层次树不是那棵树，而且该文件在并发黑名单里（只读）；
//   · `usageViewTreeModel.ts:210-217` 的 `usageTreeRowIds` / `:275-315` 的 `carryUsageTreeExpansion`
//     入参是 `UsageTreeRow`（`kind` 只允许 `directory|file|class|method|usage`，还要
//     `path/line/character/count/collapsible`），层次节点给不出 `kind` 与 `count`
//     （层次节点是 LSP `HierarchyItem`，不是"用法"也不是"分组"）⇒ **按同一规则各写一份**，
//     规则本身逐条对齐：内容派生键、`NUL#出现次` 后缀、只沿用"还存在的键"、认不到的键清掉。
//
// 上游出处（本批逐条 find + 打开过；参考树 =
// `D:/Backup/Downloads/intellij-community-master/intellij-community-master`）：
//   · 行的身份：上游**没有字符串 id**。层次树的节点身份就是 `HierarchyNodeDescriptor` 对象
//     （`platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyTreeStructure.java:60-68` 建 descriptor、
//     `platform/lsp-impl/src/impl/features/hierarchy/LspAbstractHierarchyTreeStructure.kt:47-54、:56-64`
//     的 `createNodeDescriptorForItem`/`createDescriptor`），去重与定位靠 `TreePath`
//     （`HierarchyBrowserBaseEx.java:603` 的 `TreeBuilderUtil.storePaths(sheet.myTree, root, pathsToExpand, selectionPaths, true, false)`）。
//     ⇒ 本仓的 `hierarchyItemKey` 是**架构不等价**下自造的那一份：`path + name + kind + line + character`
//     五元组（就是原来 `src/hierarchyView.ts` 里那个闭包 `hierarchyKey`，本批搬到模块里，
//     让「children 缓存键 / 递归标记 / 行 id」三处共用同一份配方，不再各写各的）。
//   · 展开态的"跨重建沿用"：`platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyBrowserBaseEx.java`
//     `:596-605` `saveCurrentTreeState`（抓当前展开的若干条路径）+ `:607-615` `restoreTreeState`
//     （逐条 `expandLater`，`:456-457` 那一句是 `TreeUtil.promiseExpand` —— 也就是说上游**为了复原
//     深层展开会沿途把下级取回来**）+ `:616-647` `doRefresh` 把这一对夹在"丢 sheet → 重建"两侧。
//     ⇒ 本仓对应物 = `captureHierarchyExpansion`（重建前抓展开过的节点路径）+
//     `planHierarchyExpansion`（重建后按路径认回来，认不回来的不贴）。
//     差异如实登记：本仓只把"这一轮已经拿过下级的节点"直接展开，没拿过下级的交给调用方按
//     `load` 那一批去补查（`src/hierarchyView.ts` 里带 generation 守卫，切方向/换根会作废这批补查）。
//   · 自动展开的深度：`platform/lsp-impl/src/impl/features/hierarchy/call/LspCallHierarchyBrowser.kt:59-71`
//     给树装了 `DefaultTreeUI.AUTO_EXPAND_FILTER`，`skipAutoExpand(node) = node.parent.parent != null`
//     ⇒ LSP 调用层次只对**根的直接孩子那一层**自动展开，更深的只靠上面那批 `pathsToExpand`。
//     本批**没有**实现这一档（照做等于每次刷新把第一层全部再发一遍请求），登记在报告 §6。
//   · 双击不展开：`platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyNodeDescriptor.java:130`
//     的 `expandOnDoubleClick() == false` —— 本仓层级行只有单击一条路，无需落（原判据已在
//     `src/hierarchyRenderer.ts:19-20` 登记，未改动）。
//
// 消费链路：`src/hierarchyView.ts`（行 id、范围提示的 total、重建后的展开态复原都在这里用它）；
// 判据 `tests/hierarchy-rows.test.mjs`。

/** 层级节点内容键的入参形状（`src/bridge.ts:168` 的 `LspHierarchyItem` 子集）。 */
export interface HierarchyKeyItem { path: string; name: string; kind?: number; line?: number; character?: number }

/**
 * 一个层级节点的**内容键**（行 id、children 缓存键、递归标记三处共用这一份配方）。
 * 从 `src/hierarchyView.ts` 的那个闭包 `hierarchyKey` 原样搬来（五个字段、顺序、`JSON.stringify`
 * 一字未改），搬的理由就三条写在文件头「行的身份」那一段：三处各写一遍迟早分叉。
 */
export function hierarchyItemKey(item: HierarchyKeyItem): string {
  return JSON.stringify([item.path, item.name, item.kind, item.line, item.character])
}

/** 一个层级节点在本模块里需要的最小形状（`src/hierarchyView.ts` 的 `HierarchyNode` 子集）。 */
export interface HierarchyRowNode {
  item: { path: string; name: string; kind?: number; line?: number; character?: number }
  /** 祖先（含根）的 `hierarchyItemKey` 序列 —— 上游的 `TreePath` 在本仓的形状。 */
  ancestors: readonly string[]
  /** 还没取过下级时为 null（懒加载）。 */
  children: readonly HierarchyRowNode[] | null
  expanded: boolean
}

/** id 的分隔符 = NUL（路径与名字里都进不来；用法侧用的也是这一颗字符：`usageViewTreeModel.ts:192`）。 */
const ID_SEPARATOR = String.fromCharCode(0)

/**
 * 一列行的稳定 id（与 `usageTreeRowIds` 同一条规则，理由见文件头）。
 * 入参是各行的 `hierarchyItemKey`，返回同一顺序的 id：
 *   · 第一遍出现 = 内容键本身（**不含下标**，所以重排/刷新之后还是同一个 id）；
 *   · 同一份内容第二次出现起追加 `NUL#出现次`（菱形继承里同一个接口会在两个父节点下各出现一次，
 *     上游靠对象身份分得开，本仓必须自己编号；出现次序由父节点顺序决定，与到达顺序无关）。
 */
export function hierarchyRowIds(keys: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return keys.map(key => {
    const times = seen.get(key) ?? 0
    seen.set(key, times + 1)
    return times === 0 ? key : `${key}${ID_SEPARATOR}#${times}`
  })
}

/**
 * 已加载且**当前可见**（按展开态，不做范围过滤）的节点数 —— 面板那句 `kept / total` 的分母。
 * 原来这是 `src/hierarchyView.ts` 里第二个深度优先（`hierItemsFlat`）建了一整条数组只为取个长度；
 * 收成本函数后不再复制整棵树，也只有一份"什么算可见"的口径。
 */
export function hierarchyVisibleNodeCount(nodes: readonly HierarchyRowNode[]): number {
  let total = 0
  const stack = [...nodes].reverse()
  while (stack.length) {
    const node = stack.pop()!
    total += 1
    if (node.expanded && node.children) {
      for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]!)
    }
  }
  return total
}

/** 一个节点的路径 = 祖先键 + 它自己的键（上游 `TreePath` 的本仓等价物）。 */
export function hierarchyNodePath(node: HierarchyRowNode): string[] {
  return [...node.ancestors, hierarchyItemKey(node.item)]
}

/**
 * 重建**前**抓展开态（上游 `HierarchyBrowserBaseEx.java:596-605` 的 `saveCurrentTreeState`）：
 * 只抓"当前真的展开着"的那些节点的路径，收起的底下不再进账
 * （用法侧同一条规则：`usageViewImpl` 的 `captureUsagesExpandState` 第一句就是
 * `if (!myTree.isExpanded(pathFrom)) return;`，见 `src/usageViewTreeModel.ts:59-60` 的转述）。
 * 返回按屏上先后（浅到深）排好的路径表，调用方直接存起来。
 */
export function captureHierarchyExpansion(nodes: readonly HierarchyRowNode[]): string[][] {
  const paths: string[][] = []
  const walk = (list: readonly HierarchyRowNode[]): void => {
    for (const node of list) {
      if (!node.expanded || !node.children) continue
      paths.push(hierarchyNodePath(node))
      walk(node.children)
    }
  }
  walk(nodes)
  return paths
}

/** 重建**后**的复原计划（上游 `:607-615` 的 `restoreTreeState` 的纯函数那一半）。 */
export interface HierarchyExpansionPlan<T extends HierarchyRowNode> {
  /** 认回来的那些节点：调用方把 `expanded` 置 true（顺序 = 浅到深，逐层展开不会踩到还没出现的父节点）。 */
  readonly expand: T[]
  /** 其中**还没取过下级**的节点：调用方按这份去补查（上游是 `TreeUtil.promiseExpand` 沿途取，`:456-457`）。 */
  readonly load: T[]
  /** 旧账里已经认不回来的路径条数（换根/结果变少时的那部分，不该继续占着存储）。 */
  readonly dropped: number
}

/**
 * 按路径把上一屏的展开态认回这一屏（只认"还在的"，认不到就丢掉 —— 与上游一致：
 * 复原是在**新树**里查旧用法/旧节点，查不到就不贴，见 `impl/UsageViewImpl.java:1291-1307` 那一段的同一形状）。
 * 同一条路径只贴一次；父节点没被贴回来的（父已经不在了）整条子路径也不再往下认，
 * 免得画出"悬在没展开的父节点下面的深缩进"（与 `hierRows` 的按范围剪枝同一条口径）。
 */
export function planHierarchyExpansion<T extends HierarchyRowNode>(
  roots: readonly T[], saved: readonly (readonly string[])[],
): HierarchyExpansionPlan<T> {
  const expand: T[] = []
  const load: T[] = []
  const picked = new Set<T>()
  let dropped = 0
  for (const path of saved) {
    // 第一段是根（base）自己的键：它不在行里（上游的根不可见），从第二段起往下认。
    const segments = path.slice(1)
    let level: readonly T[] = roots
    let matched = false
    for (const segment of segments) {
      const found = level.find(node => hierarchyItemKey(node.item) === segment) as T | undefined
      if (!found) { matched = false; break }
      matched = true
      if (!picked.has(found)) {
        picked.add(found)
        expand.push(found)
        if (!found.children) load.push(found)
      }
      // 没取过下级就到此为止（补查由调用方发，返回的行还没进树）；取过就继续往下认。
      if (!found.children) break
      level = found.children as readonly T[]
    }
    if (!matched) dropped += 1
  }
  return { expand, load, dropped }
}
