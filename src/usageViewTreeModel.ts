// 用法树的**行模型**（纯函数层：一条用法 → 分组节点行 / 文件节点行 / 成员节点行 / 用法节点行）。
//
// 这一层只管四件事，而且只管**一次**：
//   ① 分组顺序与同级排序（`usageTreeKindRank` / `compareUsageTreeSiblings` / `compareUsageTreePaths`
//      / `compareUsageLocations` / `sortUsageTreeSiblings`）；
//   ② 行 id 稳定（`usageTreeRowIds`：内容派生，到达顺序变了、整批重排了、搜索报错重跑都一样）；
//   ③ 展开态沿用的纯函数形状（`carryUsageTreeExpansion`：上一屏的行 → 这一屏的行，按 id 沿用）；
//   ④ 每层计数（`usageTreeLevelCounts`：四个层各自的行数与该层的用法合计）。
// 入口 `usageTreeRows(rows, options)` 把 ②③④ 装配成面板真正渲染的那一列行
// （生产消费方：`src/referenceContents.ts` 的 `referenceRows`）。
//
// 与 `src/usageViewGrouping.ts` 的分工（**没有第二份实现**）：
//   · 建树（哪些用法落进哪个组）与每行的**呈现文本**留在那儿，本模块不重算；
//   · 键的**比较**（①）由本模块一份说了算，那边四处排序（`buildUsageTree` 的 `total()`、
//     `usageFileNodes`、`groupUsagesByFile` 的两处）都改调这里 —— 原来那四处各写各的
//     （名字 `localeCompare` 一份、小写路径一份、路径 `localeCompare` 又一份），口径一定会漂；
//   · **按内容档位沿用折叠集**（`carryUsageExpansion` + `UsageExpansionMode`）也在那儿
//     （`docs/batch-2026-10-06-refview2.md` §4 那一批），本模块的 ③ 是**渲染时按行 id 的对账**：
//     上一屏那一列行 vs 这一屏那一列行，谁还是谁、谁消失了、新出现的组按哪一档展开。
//
// 上游出处（2026-10-06 逐条自己 find + 打开过；参考树 =
// `D:/Backup/Downloads/intellij-community-master/intellij-community-master`）：
//   · 那棵树的四个节点类：`platform/usageView-impl/src/com/intellij/usages/impl/Node.java:19`
//     （`abstract class Node extends DefaultMutableTreeNode`）、同目录 `GroupNode.java:42`、
//     `UsageNode.java:11`、`UsageTargetNode.java:9`；模型壳子是 `UsageViewTreeModelBuilder.java:19`
//     （`extends DefaultTreeModel`，根 = `GroupNode.createRoot()`，见同文件 `:26-28`）。
//     订正留痕：仓里原先写的 `UsageViewTreeStructure` / `UsageViewTreeStructureProvider` 这两个类名
//     在参考树里**不存在**（本轮按名字找 usageView 两支，零命中）。
//   · ① 档与档的先后：装档的是 `platform/usageView-impl/src/com/intellij/usages/impl/rules/ActiveRules.java:31-68`
//     （非代码 → 范围 → 用法类型 → 模块 → 包/目录 → 目录结构 → 文件结构，每档一条 `if (usageViewSettings.isGroupByXxx())`），
//     ranks 见同目录 `UsageGroupingRulesDefaultRanks.java:26-32`（DIRECTORY_STRUCTURE=400 在 FILE_STRUCTURE=500 之前）；
//     树里比的是**档号**：`impl/GroupNode.java:350-357`（先 `myRuleIndex`，再 `UsageGroup.compareTo`），
//     档号由 `impl/UsageNodeTreeBuilder.java:67-75` 传下去（`for (int i = 0; i < myGroupingRules.length; i++)`
//     → `groupNode.addOrGetGroup(group, i, …)`）。
//   · ① 同一父节点下的先后：`impl/GroupNode.java:317-348` 的 `NodeComparator` —— 先按**节点种类**
//     （`:318` 那个 `enum ClassIndex {UNKNOWN, USAGE_TARGET, GROUP, USAGE}`，`:331` 比 ordinal），
//     种类相同再比组（`:332-335`）或比用法（`:336-339`），最后才是 `userObject` 相等 / `identityHashCode`
//     （`:343-346`）。组的比较 = `impl/rules/UsageGroupBase.java:15-24`：先 `myOrder`，再
//     `getPresentableGroupText().compareToIgnoreCase(…)`（`:23`）⇒ 本模块的 `compareUsageTreeTextIgnoreCase`。
//     用法的比较 = `impl/UsageNode.java:27-30` → `impl/UsageViewImpl.java:207-223`
//     （先 `getUsagePriority`，再 `compareByFileAndOffset`，再 `toString`），
//     而 `impl/UsageViewImpl.java:225-234` 里同文件比 `getNavigationOffset()`、不同文件比
//     `platform/core-api/src/com/intellij/openapi/vfs/VfsUtilCore.java:818` 的 `compareByPath`。
//   · ① 排序怎么落到行上：**插入时就排好**，不是画的时候才排 —— `impl/GroupNode.java:99-114`
//     （`insertGroupNode` 走 `getNodeIndex` = `Collections.binarySearch`，见 `:118-120`；命中已有节点就**复用**）、
//     `impl/GroupNode.java:264-288`（`addOrGetUsage` 同一套）、`impl/UsageViewImpl.java:767-769`
//     （新节点插进去之后 `swingChildren.sort(NODE_COMPARATOR)`，再取 `indexOf` 当插入位置发事件）。
//     ⇒ 本仓对应形状：`sortUsageTreeSiblings` 排在建树那一趟里，本模块拿到行序列之后**不再排第二次**。
//   · ② 节点身份：**上游没有字符串 id** —— 身份就是那个 `DefaultMutableTreeNode` 对象
//     （`impl/Node.java:19`）+ `userObject`；去重靠比较结果（`impl/GroupNode.java:105-107`、
//     `:276-280`「同一条 Usage 再进来就复用已有节点」），平铺路径靠 `TreePath`
//     （`impl/UsageViewImpl.java:1271-1288`）。档的 id 倒是有：
//     `platform/usageView/src/com/intellij/usages/rules/UsageGroupingRuleEx.java:16` 的 `getId()`
//     默认取实现类类名（`impl/rules/ActiveRules.java:124-142` 的包装器同一条）。
//     ⇒ 本仓的 `usageTreeRowIds` 是**架构不等价**下自造的那一份，规则见函数头注。
//   · ③ 展开态：`impl/UsageViewImpl.java:1221-1262` 的 `rulesChangedImpl()` 就是「重建 → 沿用」那一对 ——
//     `:1231` 先 `captureUsagesExpandState(new TreePath(root), states)`、`:1234` 把用法按
//     `USAGE_COMPARATOR_BY_FILE_AND_OFFSET` 排好、`:1235` `reset()`、`:1258` `expandTreeAfterReset()`、
//     `:1261` `restoreUsageExpandState(states)`。抓的是**当前展开的路径**（`:1271-1275` 第一句
//     `if (!myTree.isExpanded(pathFrom)) return;` ⇒ 收起的组底下那些用法根本进不了账），
//     存的是**用法本尊 + 是否选中**（`:1280-1283` 的 `new UsageState(usage, isSelected)`）；
//     贴回去时先看新树：根下那一层的每个 `GroupNode` **一律展开**（`:1291-1302`，
//     注释 `//always expand the last level group`），再把每条抓到的用法用 `myUsageNodes.get(usage)`
//     在新树里查到、把**它自己的父组**放进展开集（`:2427-2441` 的 `UsageState.restore`），
//     整批一次 `treeState.applyTo(myTree)`（`:1306`）。默认展开深度 = `:1313-1319`
//     （`expandTreeAfterReset() = expandTree(2)`）与 `:1345-1347`（`expandRoot() = expandTree(1)`）。
//     ⇒ 本模块 ③ 的形状：按**行 id**（= 本仓的「还是同一条 / 同一个组」）沿用，抓不到的按层深给默认档，
//       只在这一屏的行序列上做，不碰持久化。
//   · ④ 每层计数：`impl/GroupNode.java:45` 的 `myRecursiveUsageCount` + `:290-299` 的
//     `incrementUsageCount(int i)` —— `while (true) { 自己 += i; parent instanceof GroupNode || return; }`
//     从叶子所在的组**一路往上加到根**，所以**每一层**都拿着自己那棵子树的合计；
//     加/扣的两处调用 = `impl/UsageViewImpl.java:742`（移除 -1）与 `:772`（插入 +1），
//     批量移除那一支在 `impl/GroupNode.java:226-228`（扣完非零才 `nodeChanged`）。
//     读的一处 = `impl/GroupNode.java:363-366`；屏上 = `impl/UsageViewTreeCellRenderer.java:95-98`
//     （组行后缀 `usage.view.counter`），速度搜索文本里也带着它（同文件 `:188-197`），
//     导出同一格（`impl/ExporterToTextFile.java:57-63`）。
//     「直接挂在本节点的那一份」另有账：`impl/GroupNode.java:409-417` 的 `getUsageNodes()` 与
//     `:399-407` 的 `getSubGroups()` ⇒ 递归合计 = 直接 + 各子组，同级互不重叠。
//
// 架构不等价处（如实登记，不假装有）：
//   · ① 的「用法优先级」（`impl/UsageViewImpl.java:214` 的 `getUsagePriority`，取
//     `UsageInfo2UsageAdapter` 里那条 `UsageInfo.getPriority()`）本仓**没有**：结果来自 LSP
//     `textDocument/references`，没有 read/write/unknown 那一档，所以 `compareUsageLocations`
//     只有 行 → 列 两条，等价于上游 `:225-234` 那一段。
//   · ① 的「节点种类」：上游 `ClassIndex` 是 `USAGE_TARGET < GROUP < USAGE`（目标行在组行之前，
//     `impl/GroupNode.java:318`）。本仓没有 target 层（`UsageTargetNode` 挂在
//     `UsageViewTreeModelBuilder.java:40-69` 的 `TargetsRootNode` 下，宿主没接），
//     所以种类表只有 目录 < 文件 < 类 < 方法 < 用法 五档；前四档在上游同属 `GROUP` 那一档，
//     内部先后由 `myRuleIndex` 决定（`impl/GroupNode.java:350-357`），本仓的层序 = 装档序。
//   · ② 的 id：上游靠对象身份，本仓必须自己拼字符串（上面那条架构不等价）。
//   · ③ 的「选中态」（`UsageState.isSelected` + `addSelectedPath`）本仓**没有**：
//     引用面板这张列表没有选择态（同一件事登记在 `src/usageViewGear.ts:15-17` 的「一键导航」缺口），
//     所以沿用里只有展开/折叠。

import type { UsageLocationLike, UsageTreeNodeKind, UsageTreeRow } from './usageViewGrouping.ts'

// ---------------------------------------------------------------- ① 顺序

/** 行树的四个层：分组 / 文件 / 成员 / 用法（成员 = 类 + 方法共用的那一层）。 */
export type UsageTreeLevel = 'group' | 'file' | 'member' | 'usage'

/** 层的先后（①的第一半：档与档）= 上游装档的那条顺序，见模块头 `ActiveRules.java:31-68`。 */
export const USAGE_TREE_LEVELS: readonly UsageTreeLevel[] = ['group', 'file', 'member', 'usage']

/** kind 到层：`directory` 与第三方规则加的 `group` 都在分组层，`class`/`method` 同属成员层。 */
const LEVEL_OF_KIND: Record<UsageTreeNodeKind | 'usage', UsageTreeLevel> = {
  directory: 'group', group: 'group', file: 'file', class: 'member', method: 'member', usage: 'usage',
}

/**
 * 种类先后（①的第二半：`NodeComparator` 先比种类，`impl/GroupNode.java:328-339`）。
 * `group` 与 `directory` 同为分组容器、排在同一档：它们都只会出现在同一层的容器位，
 * 彼此的先后由 rank 之外的 `myRuleIndex`（本仓 = 建树时的插入序）决定，不会撞在一起。
 */
const RANK_OF_KIND: Record<UsageTreeNodeKind | 'usage', number> = {
  directory: 0, group: 0, file: 1, class: 2, method: 3, usage: 4,
}

/** 这一档在第几层（认不出来的种类一律排到最后，不抛错：树是外部数据源建出来的）。 */
export function usageTreeKindRank(kind: UsageTreeNodeKind | 'usage'): number {
  return RANK_OF_KIND[kind] ?? USAGE_TREE_LEVELS.length
}

/** 这一档属于四个层里的哪一个。 */
export function usageTreeLevelOf(kind: UsageTreeNodeKind | 'usage'): UsageTreeLevel {
  return LEVEL_OF_KIND[kind] ?? 'usage'
}

/** 一行的层（行的 `kind` 比节点多一个 `usage`）。 */
export function usageTreeLevelOfRow(row: UsageTreeRow): UsageTreeLevel {
  return usageTreeLevelOf(row.kind)
}

/**
 * 忽略大小写的文本比较（①：`UsageGroupBase.java:23` 的 `compareToIgnoreCase` 那一支的形状 ——
 * 先比小写，小写相等再比原串，让只差大小写的两个名字也有确定先后）。
 * 订正留痕：建树那一处原来写 `localeCompare`、`usageFileNodes` 写小写序、
 * `groupUsagesByFile` 又写 `localeCompare` 路径序 —— 同一条规则三份写法，这里收成一份。
 */
export function compareUsageTreeTextIgnoreCase(left: string, right: string): number {
  const lowerLeft = left.toLowerCase()
  const lowerRight = right.toLowerCase()
  if (lowerLeft !== lowerRight) return lowerLeft < lowerRight ? -1 : 1
  if (left !== right) return left < right ? -1 : 1
  return 0
}

/** 组与组之间比的是路径（目录带尾斜杠、文件是整条相对路径；上游比的是呈现文本，同一份字符串）。 */
export function compareUsageTreePaths(left: string, right: string): number {
  return compareUsageTreeTextIgnoreCase(left, right)
}

/**
 * 同一父节点下两个孩子的先后（①的核心：种类先、呈现文本后 ——
 * 上游 `impl/GroupNode.java:328-339` 的 class ordinal + `compareTo`，
 * 组的 `compareTo` = `impl/rules/UsageGroupBase.java:19-23` 的 `myOrder` → 文本）。
 * 本仓的 `myOrder` 那一格就是 `RANK_OF_KIND`（装档顺序），没有第二份顺序可调。
 */
export function compareUsageTreeSiblings(
  left: { kind: UsageTreeNodeKind; name: string },
  right: { kind: UsageTreeNodeKind; name: string },
): number {
  const rankLeft = usageTreeKindRank(left.kind)
  const rankRight = usageTreeKindRank(right.kind)
  if (rankLeft !== rankRight) return rankLeft - rankRight
  return compareUsageTreeTextIgnoreCase(left.name, right.name)
}

/** 原地排好同一层的孩子（`sort` 返回的还是同一个数组，调用方不必再接收返回值）。 */
export function sortUsageTreeSiblings<T extends { kind: UsageTreeNodeKind; name: string }>(siblings: T[]): T[] {
  return siblings.sort(compareUsageTreeSiblings)
}

/**
 * 同一条目里两处用法的先后（①的叶子支：行 → 列。上游 `impl/UsageViewImpl.java:225-234`
 * 同文件比 `getNavigationOffset()`；优先级那一档本仓没有，见模块头的架构不等价）。
 */
export function compareUsageLocations(left: UsageLocationLike, right: UsageLocationLike): number {
  if (left.line !== right.line) return left.line - right.line
  return (left.character ?? 0) - (right.character ?? 0)
}

/**
 * 折叠箭头的 `title` / `aria-label`（「展开 X」/「收起 X」）。规则从 `src/usageViewGrouping.ts`
 * 的 `emitGroup` 里收到这一份（那边现在调的就是这里）—— ③ 沿用之后折叠态会变，
 * 那一行的提示语必须跟着变；文案本身不是新的（既有判据钉着 `展开 src/x.ts` 这一串，
 * `tests/usage-view-panel-rows.test.mjs:73`）。
 */
export function usageTreeToggleLabel(collapsed: boolean, label: string): string {
  return `${collapsed ? '展开' : '收起'} ${label}`
}

// ---------------------------------------------------------------- ② 行 id

/** id 的分隔符 = NUL（路径与呈现文本里都不可能出现；`usageGroupKey` 用的也是这一颗字符）。 */
const ID_SEPARATOR = String.fromCharCode(0)

/** 面板上真正渲染的那一列行 = 既有的 `UsageTreeRow` + 稳定 id + 它属于四个层里的哪一个。 */
export type UsageTreeModelRow = UsageTreeRow & { id: string; level: UsageTreeLevel }

/**
 * 每一行的稳定 id（②）。
 *   · **内容派生**：组行 = 它的组键（`种类 + NUL + 路径`），叶子 = `usage + NUL + 路径 + NUL + 行:列`
 *     —— 两者都直接取 `row.key`，所以同一行在**重排之后还是同一个 id**（键里没有序号、没有下标）；
 *   · 唯一性：同一份内容出现第二遍起，追加 `NUL#N`  occurrence 后缀。上游对这一格用的是
 *     `System.identityHashCode`（`impl/GroupNode.java:343-346`，注释写明「只有同一条 Usage 才算相等，
 *     例如写操作打断搜索后又恢复时插进来的那一个」）—— 对象身份在本仓活不到下一轮渲染，
 *     所以这里按"同一份内容的第几遍出现"编号；出现次序由 ① 的排序决定，
 *     与到达顺序无关（两条完全相同的行本来就分不出彼此）。
 *   · 边界（如实登记）：id 的序号是**在这一列行里**数的，所以过滤筛掉一条重复行之后，
 *     剩下那条的序号会从 `#1` 变回没有后缀 —— 影响到的只有"内容完全相同的那两行"，
 *     它们画出来一字不差，换 key 不产生可见的重排。
 */
export function usageTreeRowIds(rows: readonly UsageTreeRow[]): string[] {
  const seen = new Map<string, number>()
  return rows.map(row => {
    const times = seen.get(row.key) ?? 0
    seen.set(row.key, times + 1)
    return times === 0 ? row.key : `${row.key}${ID_SEPARATOR}#${times}`
  })
}

/** 装配后有没有两行共用同一个 id（②的唯一性自证：非空 = 宿主拿它当 `:key` 会串台）。 */
export function usageTreeDuplicateModelRowIds(rows: readonly UsageTreeModelRow[]): string[] {
  const seen = new Set<string>()
  const duplicated: string[] = []
  for (const row of rows) {
    if (seen.has(row.id)) duplicated.push(row.id)
    else seen.add(row.id)
  }
  return duplicated
}

// ---------------------------------------------------------------- ③ 展开态沿用

/** 上一屏与这一屏对账的结果（四份 id 都是**这一屏的顺序**，调用方直接拿去建行）。 */
export interface UsageTreeExpansionCarry {
  /** 这一屏该收起的组 id。 */
  collapsedIds: string[]
  /** 上一屏收起、这一屏还在的（= 真正沿用上的那一部分）。 */
  carriedIds: string[]
  /** 上一屏收起、这一屏已经没有了的（= 该从存储里清掉的垃圾键）。 */
  droppedIds: string[]
  /** 这一屏该展开的组 id（= 全部组 id 减 `collapsedIds`）。 */
  expandedIds: string[]
}

export interface UsageTreeExpansionCarryOptions {
  /**
   * 重建后**默认展开到第几层**（`row.depth` 小于它的行才算默认展开）。
   * 上游那两个数：`impl/UsageViewImpl.java:1317-1319` 的 `expandTreeAfterReset() = expandTree(2)`
   * 与 `:1291-1302` 的「根下那一层一律展开」⇒ 传 2 就是上游重建后那一档；
   * 默认 `Infinity` = 本仓既有档「重建后全展开」（既有判据钉着，见 `tests/usage-view-panel-rows.test.mjs:51`），
   * 两者都测得到，判据才分得出谁被改坏了。
   */
  expandLevels?: number
}

/** 组行（可折叠的那些行）才算数：叶子的展开态没有意义（上游 `impl/GroupNode.java:318` 的 `USAGE` 是末档）。 */
function groupRowIds(rows: readonly UsageTreeRow[], ids: readonly string[]): Map<string, UsageTreeRow> {
  const map = new Map<string, UsageTreeRow>()
  rows.forEach((row, index) => {
    if (row.kind !== 'usage') map.set(ids[index]!, row)
  })
  return map
}

/**
 * 上一屏的行 → 这一屏的行，展开态怎么沿用（③，纯函数：入参两份行序列，出参一份对账结果）。
 *   · 同一 id 在上一屏就是收起的、这一屏还在 ⇒ **沿用收起**（上游 `impl/UsageViewImpl.java:1280-1283`
 *     抓的是"还看得见的用法本尊"，`:2427-2441` 拿它在新树里查到父组再贴回去 —— 认的是内容不是位置）；
 *   · 上一屏收起、这一屏没有这个 id 了 ⇒ 进 `droppedIds`（上游 `:1271-1275` 那句
 *     `if (!myTree.isExpanded(pathFrom)) return;` 就是"消失的不再进账"）；
 *   · 这一屏**新出现**的组（上一屏没有这个 id）⇒ 按 `expandLevels` 给默认档
 *     （上游 `:1317-1319` 的 `expandTree(2)` + `:1291-1302` 的根下一层一律展开）；
 *   · 收不住东西的行（`collapsible` 为 false：过滤后空壳那一类）不许留在折叠集里 ——
 *     它没有那个箭头按钮，留在账上就是一行"说已收起、点了没反应"的假状态。
 */
export function carryUsageTreeExpansion(
  previous: readonly UsageTreeRow[],
  next: readonly UsageTreeRow[],
  options: UsageTreeExpansionCarryOptions = {},
): UsageTreeExpansionCarry {
  const expandLevels = options.expandLevels ?? Number.POSITIVE_INFINITY
  const previousIds = usageTreeRowIds(previous)
  const nextIds = usageTreeRowIds(next)
  const previousGroups = groupRowIds(previous, previousIds)
  const nextGroups = groupRowIds(next, nextIds)
  const collapsedPreviously = new Set<string>()
  previousGroups.forEach((row, id) => {
    if (row.collapsed) collapsedPreviously.add(id)
  })
  const carried: string[] = []
  const dropped: string[] = []
  collapsedPreviously.forEach(id => {
    if (nextGroups.has(id)) carried.push(id)
    else dropped.push(id)
  })
  const collapsedSet = new Set(carried.filter(id => nextGroups.get(id)!.collapsible))
  const expanded: string[] = []
  nextGroups.forEach((row, id) => {
    // 新出现的组（上一屏没有这个 id）按 `expandLevels` 给档；老组沿用上面算出来的那一份。
    if (!previousGroups.has(id)) {
      if (row.depth < expandLevels && row.collapsible) return
      if (row.collapsible) collapsedSet.add(id)
      return
    }
    if (!collapsedSet.has(id)) expanded.push(id)
  })
  const collapsedIds: string[] = []
  const expandedIds: string[] = []
  next.forEach((row, index) => {
    if (row.kind === 'usage') return
    const id = nextIds[index]!
    if (collapsedSet.has(id)) collapsedIds.push(id)
    else expandedIds.push(id)
  })
  return { collapsedIds, carriedIds: carried.sort(), droppedIds: dropped.sort(), expandedIds }
}

// ---------------------------------------------------------------- ④ 每层计数

/** 一个层在这一屏上的账：行数 + 两格用法数（各对上上游的一格，见 `usageTreeLevelCounts` 的头注）。 */
export interface UsageTreeLevelCount {
  level: UsageTreeLevel
  /** 这一层有几行（`usage` 层的行数 = 用法条数）。 */
  rows: number
  /** **直接挂在这一层节点上**的用法条数（上游 `impl/GroupNode.java:409-417` 的 `getUsageNodes()` 那一格；
   * `usage` 层算它自己 = 行数）。非叶子层的这一格合起来 = 全部用法，一条不重不漏（每条用法只有一个父行）。 */
  usages: number
  /** 这一层各节点的**递归合计**相加（上游 `impl/GroupNode.java:363-366` 的 `getRecursiveUsageCount()`，
   * 屏上组行那个 `N 条结果` 与导出、速度搜索文本读的都是它：`UsageViewTreeCellRenderer.java:95-98`、
   * `:188-197`、`ExporterToTextFile.java:57-63`）。
   * ⚠ 这一格**不是**划分：父层与子层各算各的子树（类套着方法时同一条用法在成员层算两遍），
   *   要互不重叠的那一份看 `usages`。 */
  subtreeUsages: number
}

/**
 * 每层计数（④）：按四个层各给 `{rows, usages, subtreeUsages}`，顺序 = `USAGE_TREE_LEVELS`，只留有行的层。
 * 上游那一格的形状：`impl/GroupNode.java:45` 的 `myRecursiveUsageCount` 由 `:290-299` 的
 * `incrementUsageCount(int)` **从叶子所在的组一路往上加到根**（`while (true) { 自己 += i; 父不是 GroupNode 就 return; }`，
 * 加/扣的两处调用 = `impl/UsageViewImpl.java:742` 与 `:772`）⇒ **每一层都拿着自己那棵子树的合计**；
 * 「直接挂本节点的那一份」另有账（`:409-417` `getUsageNodes()` 与 `:399-407` `getSubGroups()`，
 * 递归合计 = 直接 + 各子组，同级互不重叠）。
 * 行序列是深度优先的，所以一个「祖先栈」就能把每条用法归给它的父行，不需要再走一遍树。
 * 与 `src/usageViewGrouping.ts` 的 `usageLevelCounts`（按**组键**逐组给 own/child/total 那份对账表）不重叠：
 * 这里数的是**屏上这一列行按四个层汇总**的账，输入是行、输出是四档。
 */
export function usageTreeLevelCounts(rows: readonly UsageTreeRow[]): UsageTreeLevelCount[] {
  const totals = new Map<UsageTreeLevel, UsageTreeLevelCount>()
  for (const level of USAGE_TREE_LEVELS) totals.set(level, { level, rows: 0, usages: 0, subtreeUsages: 0 })
  /** 每条用法归给它的父行（行下标 → 直接挂着的用法条数）。 */
  const direct = new Map<number, number>()
  /** 祖先栈：只留 `depth` 严格小于当前行的那些行，栈顶就是当前行的父行。 */
  const stack: { depth: number; index: number }[] = []
  rows.forEach((row, index) => {
    while (stack.length && stack[stack.length - 1]!.depth >= row.depth) stack.pop()
    if (row.kind === 'usage' && stack.length) {
      const parent = stack[stack.length - 1]!.index
      direct.set(parent, (direct.get(parent) ?? 0) + 1)
    }
    stack.push({ depth: row.depth, index })
  })
  rows.forEach((row, index) => {
    const entry = totals.get(usageTreeLevelOfRow(row))!
    entry.rows += 1
    if (row.kind === 'usage') {
      entry.usages += 1
      entry.subtreeUsages += 1
    } else {
      entry.usages += direct.get(index) ?? 0
      // `row.count` 就是既有的子树合计那一格（建树时按 `impl/GroupNode.java:290-299` 同一份账算出来的）。
      entry.subtreeUsages += row.count
    }
  })
  return USAGE_TREE_LEVELS.map(level => totals.get(level)!).filter(entry => entry.rows > 0)
}

// ---------------------------------------------------------------- 行树装配（生产入口）

export interface UsageTreeRowsOptions {
  /** 上一屏渲染的那一列行（给了才做 id 级沿用；不给 = 只按这一屏自己的折叠态对账）。 */
  previous?: readonly UsageTreeRow[]
  /** 重建后默认展开到第几层（③那一格，默认 `Infinity` = 本仓既有档；上游那一档是 2）。 */
  expandLevels?: number
}

/**
 * 装配面板真正渲染的那一列行（②+③+④ 的一次落地）：
 *   · 每行补 `id`（②）与 `level`（④），**顺序一字不动** —— 行序是 ① 在建树那一趟里定下来的，
 *     上游同样不在渲染时重排（`impl/GroupNode.java:99-114` 插入时就二分定位、
 *     `impl/UsageViewImpl.java:767-769` 插完立刻 `sort` 并把位置发成事件）；
 *   · 折叠态走 `carryUsageTreeExpansion`（③），只允许两种改变：上一屏就收起、这一屏还在的继续收起；
 *     收不住东西的行（`collapsible` 为 false）从折叠集里剔出去，`toggleLabel` 跟着清空
 *     —— 那一行没有箭头按钮，留着「已收起」的说明就是写了却按不动的假状态；
 *   · 产出的 `id` 是给宿主当 `:key` 用的（现在模板钉的是 `key:index`，`index` 一变整列重挂 DOM，
 *     接线请求见 `docs/wiring-requests-2026-10-06-refview3.md`）。
 */
export function usageTreeRows(
  rows: readonly UsageTreeRow[],
  options: UsageTreeRowsOptions = {},
): UsageTreeModelRow[] {
  const ids = usageTreeRowIds(rows)
  const model: UsageTreeModelRow[] = rows.map((row, index) => ({
    ...row, id: ids[index]!, level: usageTreeLevelOfRow(row),
  }))
  const carry = carryUsageTreeExpansion(options.previous ?? model, model, { expandLevels: options.expandLevels })
  const collapsed = new Set(carry.collapsedIds)
  return model.map(row => {
    if (row.kind === 'usage') return row
    if (!row.collapsible) {
      // 空壳组：没有箭头就没有"收起"这一态，行文本上的说明也一并撤掉。
      return row.collapsed || row.toggleLabel ? { ...row, collapsed: false, toggleLabel: '' } : row
    }
    const isCollapsed = collapsed.has(row.id)
    if (row.collapsed === isCollapsed) return row
    return { ...row, collapsed: isCollapsed, toggleLabel: usageTreeToggleLabel(isCollapsed, row.label) }
  })
}

/** 一列行的每层账（④）+ id 唯一性（②）一起要的那一份，给判据与宿主自查用。 */
export interface UsageTreeRowsReport {
  rows: UsageTreeModelRow[]
  levels: UsageTreeLevelCount[]
  /** 应该恒为空：非空 = 有两行拿到了同一个 id，`:key` 就会串台。 */
  duplicateIds: string[]
}

export function usageTreeRowsReport(
  rows: readonly UsageTreeRow[],
  options: UsageTreeRowsOptions = {},
): UsageTreeRowsReport {
  const assembled = usageTreeRows(rows, options)
  return { rows: assembled, levels: usageTreeLevelCounts(assembled), duplicateIds: usageTreeDuplicateModelRowIds(assembled) }
}
