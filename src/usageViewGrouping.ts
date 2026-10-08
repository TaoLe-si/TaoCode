// 用法/引用视图的**分组与导出**（上游 `platform/usageView-impl/src/com/intellij/usages/impl/`：
// `Node` / `GroupNode` / `UsageNode` / `UsageTargetNode` 那四个树节点（`Node.java:19`、`GroupNode.java:42`、
// `UsageNode.java:11`、`UsageTargetNode.java:9`）+ `UsageViewTreeModelBuilder.java:19`（`DefaultTreeModel` 的子类，
// 根是 `GroupNode.Root`）；导出走同目录 `ExporterToTextFile.java`。`FindUsagesScope` 提供范围收窄）。
// 订正留痕：本行原来写「上游 `platform/lang-impl/src/com/intellij/usageView/` 的 `UsageViewImpl`，
// 分组树来自 `UsageViewTreeStructureProvider` 一族」—— 2026-10-06 逐条 `find` 过：参考树里**没有**
// `UsageViewTreeStructure` / `UsageViewTreeStructureProvider` 这两个类名（零命中），`UsageViewImpl` 也不在
// `platform/lang-impl` 那一支（那一支只有 `UsageViewContentManagerImpl.java` 等三条）。真身坐标见
// `docs/batch-2026-10-06-refview2.md` §1。
//
// 本仓引用面板（`src/referenceContents.ts` + App.vue 的 `bottomTab === 'references'`）此前是
// 一张按路径排序的**平表**。本模块给这一棵树需要的全部纯规则：
//   · 分组树（目录 → 文件 → 位置）：`buildUsageTree`；
//   · **面板行**（深度优先摊平 + 折叠态）：`flattenUsageTree`（宿主只做一次 `v-for`）；
//   · 组行的计数文本：`usageCounterText`；
//   · 文本导出：`exportUsageTreeText`（缩进树，上游 `ExporterToTextFile` 的形状）
//     与 `exportUsagesText`（`path:line` 平表，本仓既有形状）。
//
// 输入形状与 `src/bridge.ts` 的 `LspLocation` 结构一致（path/line/character），不 import 桥接层。
//
// —— 本批（W-3）补的两件事 ——
//   1) **成员层**：文件之下再分「类 → 方法 → 行」。上游这一档不是「另一个目录层」，而是
//      `FileStructureGroupRuleProvider` 那一族（`platform/usageView-impl/src/com/intellij/usages/impl/
//      FileStructureGroupRuleProvider.java:14-22`），Java 侧按
//      `java/java-backend/resources/META-INF/JavaPlugin.xml:566-567` 的注册序 = **类在前、方法在后**
//      （`ClassGroupingRule` / `MethodGroupingRule`），并由
//      `platform/usageView-impl/src/com/intellij/usages/impl/rules/ActiveRules.java:59-62`
//      在 `isGroupByFileStructure()` 为真时才装进那棵树；这一档的**默认值是 true**
//      （`platform/usageView/src/com/intellij/usages/UsageViewSettings.kt:21`）。
//      符号从哪儿来：上游用 PSI（`ClassGroupingRule.java:44-62` 往祖先里找 `PsiClass`、
//      `MethodGroupingRule.java:63-73` 往祖先里找 `PsiMethod`）；本仓没有 PSI，
//      等价物是宿主手里的 LSP `documentSymbol`（`src/bridge.ts:143` 的 `LspDocumentSymbol`），
//      所以本模块只接一份**注入的符号表**（`UsageTreeBuildOptions.symbolProvider`）：
//      拿不到符号 = 不建成员层（树退回「文件 → 行」），**不画空的一层**。
//   2) **速度搜索的过滤**：`filterUsageTree`（见下面那一节的注释，含与上游的语义差异）。
//
// 上游依据（本批逐行开参考树自数核对）：
//   · 分组层级与次序：`platform/usageView-impl/src/com/intellij/usages/impl/rules/UsageGroupingRulesDefaultRanks.java:26-32`
//     —— DIRECTORY_STRUCTURE=400 在 FILE_STRUCTURE=500 之前；
//   · 目录行的呈现文本：`.../rules/DirectoryGroupingRule.java:50-52`（默认 `flattenDirs=true`）
//     与 `:150-153` —— 呈现的是**相对工程根的路径**（不是最后一级目录名），
//     `:189` 的比较是 `compareToIgnoreCase`；
//   · 文件行的呈现文本：`.../rules/FileGroupingRule.java:93-95` —— 要么文件名，要么
//     `UniqueVFilePathBuilder.getUniqueVirtualFilePath`；开不开由
//     `platform/usageView/src/com/intellij/usages/UsageViewSettings.kt:115`/`:118` 决定
//     （`showShortFilePath && !isGroupByDirectoryStructure && !isGroupByPackage`）：
//     目录行**在上面**时文件行只显示名字，**没有**目录行时显示到能认出位置的那条路径；
//   · 两档默认值：`UsageViewSettings.kt:21-26` —— `GROUP_BY_FILE_STRUCTURE=true`、
//     `GROUP_BY_DIRECTORY_STRUCTURE=false`（所以面板默认**不**分目录层，本仓同档）；
//   · 组行的计数：`platform/usageView-impl/src/com/intellij/usages/impl/UsageViewTreeCellRenderer.java:95-98`
//     + `platform/usageView/resources/messages/UsageViewBundle.properties:131`（`usage.view.counter={0} result(s)`）；
//   · 根节点不可见：`UsageViewTreeCellRenderer.java:88-89`（画的是 `<root>`，树本身不显示根）；
//   · 展开状态：`UsageViewImpl.java:1317-1319`（模型重建后 `expandTree(2)`）与
//     `:1293-1302`（恢复状态时根下那一层的组**一律展开**）—— 本仓据此用"默认全展开 + 折叠集"；
//   · 文本导出：`platform/usageView-impl/src/com/intellij/usages/impl/ExporterToTextFile.java:31-71`
//     —— 每层缩进 4 空格（`:35`）、根不写（`:34-40`）、组行 = 呈现文本 + ` (N usages found)`
//     （`:57-63`，`UsageViewBundle.properties:8`）；这个槽位由
//     `UsageViewImpl.java:2260` 的 `PlatformDataKeys.EXPORTER_TO_TEXT_FILE` 提供给
//     `ExportToTextFileAction`，所以「导出到文本文件」在 Find 窗口里是真动作。
//
// 架构不等价处（如实登记）：
//   · 上游的叶子文本是**那一行代码 + 灰色的位置串**（`UsageViewTreeCellRenderer.java:80-83`），
//     要拿到代码文本得逐引用读文件；本仓的面板只有 `Location`，所以叶子行的主文本就是
//     `行:列`（1 基，与本仓层级面板/平表同一口径），不假装有代码片段；
//   · 没有 Module/Package 两档分组（`UsageGroupingRulesDefaultRanks.java:14-24` 的 MODULE=300 /
//     包结构），本仓的工作区是单根、没有模块表（同 `src/hierarchyScopes.ts` 的口径）。

// 速度搜索的匹配规则用本仓那一份现成的（MinusculeMatcher 的等价物，文件树/书签/面板都走它）；
// `.ts` 之间的**值** import 必须带扩展名，这里漏一次就整棵测试树 `ERR_MODULE_NOT_FOUND`。
import { speedSearchMatches } from './speedSearch.ts'
// 同级排序、行 id、折叠箭头文案这三条**只有一份**，住在 `src/usageViewTreeModel.ts`（行模型那一层）；
// 这里只调它们，不再各写一遍（原来四处各写各的：名字 `localeCompare`、小写路径、路径 `localeCompare`）。
// 值 import 必须带 `.ts` 扩展名，漏一次整棵测试树 `ERR_MODULE_NOT_FOUND`。
import { compareUsageLocations, compareUsageTreePaths, sortUsageTreeSiblings, usageTreeToggleLabel } from './usageViewTreeModel.ts'
// 用法分组规则的扩展点宿主（`com.intellij.usageGroupingRuleProvider`，上游
// `platform/usageView/resources/intellij.platform.usageView.xml:33`）。内建的目录(400)/文件(500) 两档
// 作为 bundled 贡献登记进来，第三方（原版 IDEA 插件）按同一 id 挂的规则与内建那两支走同一条查询路径。
import {
  activeUsageGroupingRules, registerUsageGroupingRuleProvider,
  type UsageGroupingRuleContribution, type UsageGroupingRuleProviderContribution,
} from './ideViewExtensionPoints.ts'

export interface UsageLocationLike {
  path: string
  /** 0 基行号。 */
  line: number
  character?: number
}

// ——— 成员层（类 / 方法）的输入形状 ———

/**
 * 建成员层所需的那几个字段（`src/bridge.ts:143` 的 `LspDocumentSymbol` 的子集，
 * 另外多一个可选的 `children` —— 上游给的是嵌套符号树，本仓的 native 是**摊平**回传的，
 * 所以 `symbolProvider` 既可以是嵌套的也可以是「由外层到内层排好序」的那一份，
 * 取包含关系时两种都走同一条最深包含的规则）。
 */
export interface UsageMemberSymbol {
  name: string
  /** LSP `SymbolKind` 编号（口径同 `src/lspSymbolBridge.ts:50-55`：类/枚举/接口/结构体 = 5/10/11/23）。 */
  kind: number
  startLine: number
  endLine: number
  startChar?: number
  endChar?: number
  /** 方法才有：LSP 给的是那一串参数/返回类型，服务端自定义。 */
  detail?: string
  children?: readonly UsageMemberSymbol[]
}

/** 类那一档的种类 = `CLASS_LIKE_SYMBOL_KINDS`（`src/lspSymbolBridge.ts:58`，上游 `LspGoToClassContributor.kt:7-12`）。 */
const CLASS_SYMBOL_KINDS: ReadonlySet<number> = new Set([5, 10, 11, 23])
/** 方法那一档的种类 = `src/outlineView.ts:58-60` 的第二档（方法 / 构造器 / 函数）。 */
const METHOD_SYMBOL_KINDS: ReadonlySet<number> = new Set([6, 9, 12])

export interface UsageTreeBuildOptions {
  /**
   * 某个文件的那份文档符号表（宿主从 LSP `documentSymbol` 拿）。
   * 返回空/undefined ⇒ 这个文件不建成员层（上游对应 `getParentGroupFor` 返回 null 的那一条：
   * `ClassGroupingRule.java:45-56` 不是 Java 文件就整档不收，用法直接挂在文件组下）。
   */
  symbolProvider?: (path: string) => readonly UsageMemberSymbol[] | undefined
  /** 成员层开关（上游 `GROUP_BY_FILE_STRUCTURE`，**默认 true**，`UsageViewSettings.kt:21`）。 */
  groupByFileStructure?: boolean
  /**
   * 生效的**分组规则**（`usageGroupingRulesFor(root)`，`com.intellij.usageGroupingRuleProvider`）：
   * 按 `rank` 升序、`groupKeyOf(usage)` 定组、`labelOf(key)` 定显示名。内建那两支
   * （目录 400 / 文件 500）对应本函数已有的目录层与文件层，**不再重复建组**；其余规则在
   * **目录层与文件层之间**加一层通用组节点（`kind: 'group'`，名字取 `labelOf`），
   * 于是第三方插件（例如 Kotlin 的模块/包分组）挂的规则真的会改变树的分层。
   * 不给 ⇒ 与既有行为一字不差。
   */
  rules?: readonly UsageGroupingRuleContribution[]
}

/** 包住那个位置的类/方法（类给整条嵌套链，方法给最里面那一个）。 */
export interface UsageMemberPath {
  className: string
  methodName: string
  methodDetail: string
}

const EMPTY_SYMBOLS: readonly UsageMemberSymbol[] = []

/** 符号是否包住那一行（行级包含，口径同 `src/structureFollow.ts:71-73` 的 `symbolLineContains`）。 */
function symbolCoversLine(symbol: UsageMemberSymbol, line: number): boolean {
  return symbol.startLine <= line && symbol.endLine >= line
}

/** 同一行上越过终点的兄弟符号不算包含（`structureFollow.ts:63-70` 的 `symbolContains` 那一半）。 */
function symbolEndsBefore(symbol: UsageMemberSymbol, line: number, character: number): boolean {
  return line === symbol.endLine && character > (symbol.endChar ?? Number.MAX_SAFE_INTEGER)
}

/**
 * 把一个文件的符号摊成**由外到内**的那一列：native 是深度优先摊平回传的
 * （`src/outlineView.ts:70-72` 那句注释讲的同一条事实），传嵌套进来的也先摊平。
 * 「外层先出现」= 起点更靠前，或同一起点上终点更远。
 */
export function usageSymbolsOutsideIn(symbols: readonly UsageMemberSymbol[]): UsageMemberSymbol[] {
  const flat: UsageMemberSymbol[] = []
  const walk = (list: readonly UsageMemberSymbol[]): void => {
    for (const symbol of list) {
      flat.push(symbol)
      if (symbol.children && symbol.children.length) walk(symbol.children)
    }
  }
  walk(symbols)
  return flat.sort((left, right) => left.startLine - right.startLine
    || (left.startChar ?? 0) - (right.startChar ?? 0)
    || right.endLine - left.endLine
    || (right.endChar ?? 0) - (left.endChar ?? 0))
}

/**
 * 往祖先里找类与方法（上游 `ClassGroupingRule.java:59-62` 的 `PsiTreeUtil.getParentOfType` 循环
 * 与本仓「按行包含」的等价交换：没有 PSI 就按符号区间一层层往里下）。
 * 沿路的**类**串成 `Outer.Inner`（上游 `ClassGroupingRule.java:114-122` 的 `createText`
 * 就是把外层类名一级级点在前面），**方法**只留最里面那个（`MethodGroupingRule.java:63-73` 同样只取一个）。
 */
export function usageMemberPathFor(ordered: readonly UsageMemberSymbol[], line: number, character: number): UsageMemberPath {
  const classes: string[] = []
  let method = ''
  let methodDetail = ''
  for (const symbol of ordered) {
    // 由外到内：起点已经越过这一行 ⇒ 它后面的都更靠里，不用再往下看
    if (symbol.startLine > line) break
    if (!symbolCoversLine(symbol, line) || symbolEndsBefore(symbol, line, character)) continue
    if (CLASS_SYMBOL_KINDS.has(symbol.kind)) classes.push(symbol.name)
    if (METHOD_SYMBOL_KINDS.has(symbol.kind)) {
      method = symbol.name
      // 方法的呈现文本 = 名字 + 参数表（上游 `MethodGroupingRule.java:87-91` 的
      // `PsiFormatUtil.formatMethod(SHOW_NAME | SHOW_PARAMETERS, SHOW_TYPE)`，形如 `run(String[] args)`）；
      // LSP 的 `detail` 是服务端自定义的，只有「以 `(` 开头」那一串才是参数表，其余（`: void` 之类）
      // 不是上游那一档的文本，宁可不写也不拼上去。
      methodDetail = symbol.detail && symbol.detail.startsWith('(') ? symbol.detail : ''
    }
  }
  return { className: classes.join('.'), methodName: method, methodDetail }
}

/**
 * 分组树里可能出现的组（`class`/`method` 两档只在给得出符号时才有，见 `UsageTreeBuildOptions`）。
 * `group` 是**第三方分组规则**加出来的通用组层（`com.intellij.usageGroupingRuleProvider`，
 * 见 `buildUsageTree` 的 `rules` 选项）：它没有本仓专属的呈现分支，直接用规则 `labelOf()` 给的名字。
 */
export type UsageTreeNodeKind = 'directory' | 'file' | 'class' | 'method' | 'group'

/**
 * 分组树节点：目录、文件，或文件之下那一层的类/方法。
 * 类型参数是"这棵树里**允许**有哪几档"：老消费方（`src/refactorPreview.ts:155` 那张预览树只吃
 * 目录/文件两档）拿 `UsageTreeNode<'directory' | 'file'>`，引用面板拿默认的宽类型。
 */
export interface UsageTreeNode<L extends UsageTreeNodeKind = UsageTreeNodeKind> {
  kind: L
  /** 展示名（目录/文件名/类名/方法名；根节点为工作区名）。 */
  name: string
  /** 该节点下的完整路径（目录用 `/` 结尾；成员节点是 `文件路径#类名[#方法名]` 那个合成键）。 */
  path: string
  /** 成员节点才填：它真正属于的那个文件（导航与导出都按这个走）。 */
  filePath?: string
  /** 子树里的引用总数。 */
  count: number
  children: UsageTreeNode<L>[]
  /** 直接挂在本节点上的位置（文件/成员节点用；目录为空数组）。 */
  locations: UsageLocationLike[]
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

/** 树去重后的插入：目录存在就复用（保持首次出现顺序）。 */
function ensureDirectory(root: UsageTreeNode, segments: readonly string[]): UsageTreeNode {
  let node = root
  let path = ''
  for (const segment of segments) {
    path = path ? `${path}/${segment}` : segment
    let child = node.children.find(entry => entry.kind === 'directory' && entry.name === segment)
    if (!child) {
      child = { kind: 'directory', name: segment, path: `${path}/`, count: 0, children: [], locations: [] }
      node.children.push(child)
    }
    node = child
  }
  return node
}

// 子节点在同一层里的先后（目录 < 文件 < 类 < 方法，同级按呈现文本）—— 那份种类表与比较器
// 收进 `src/usageViewTreeModel.ts` 的 `sortUsageTreeSiblings`（①），这里不留第二份。
// 上游那条比较是 `impl/GroupNode.java:328-339`（先节点种类再 `compareTo`）+
// `impl/rules/UsageGroupBase.java:19-23`（先 `myOrder` 再 `compareToIgnoreCase`）。

/**
 * 按目录 / 文件 / 类 / 方法分组建树。
 *   · **同一个文件的多处引用只生成一个文件节点**（`ensureDirectory` 与这里找 file 的那一句都是
 *     「有就复用」，绝不再开一个）；
 *   · 成员层（类 → 方法）只在 `options.symbolProvider` 给得出符号时才建（上游那一档由
 *     `ActiveRules.java:59-62` 装在 `isGroupByFileStructure()` 为真的时候，默认真
 *     `UsageViewSettings.kt:21`）；给不出符号的文件里位置**直接挂文件组**，
 *     与上游 `getParentGroupFor` 返回 null 那一条一致；
 *   · 每个节点的 count 是**整棵子树**的合计（组行渲染的上游就是
 *     `getRecursiveUsageCount()`，`UsageViewTreeCellRenderer.java:95`）；
 *   · 同一位置列表内按行号升序（同行的按列号）。
 */
export function buildUsageTree(
  locations: readonly UsageLocationLike[],
  rootName: string,
  options: UsageTreeBuildOptions,
): UsageTreeNode
/** 没传 `options` 的那一档：树里只有目录与文件两档（旧消费方的类型就是这个，别去动它们）。 */
export function buildUsageTree(
  locations: readonly UsageLocationLike[],
  rootName?: string,
): UsageTreeNode<'directory' | 'file'>
export function buildUsageTree(
  locations: readonly UsageLocationLike[],
  rootName = '工作区',
  options: UsageTreeBuildOptions = {},
): UsageTreeNode {
  const root: UsageTreeNode = { kind: 'directory', name: rootName, path: '', count: 0, children: [], locations: [] }
  const byFileStructure = options.groupByFileStructure !== false
  const provider = byFileStructure ? options.symbolProvider : undefined
  const symbolCache = new Map<string, readonly UsageMemberSymbol[]>()
  const symbolsFor = (path: string): readonly UsageMemberSymbol[] => {
    if (!provider) return EMPTY_SYMBOLS
    const cached = symbolCache.get(path)
    if (cached !== undefined) return cached
    const given = provider(path) ?? []
    const ordered = usageSymbolsOutsideIn(given)
    symbolCache.set(path, ordered)
    return ordered
  }
  /** 同一个父节点下的成员组去重复用（类按整条嵌套名、方法按名字+参数表）。 */
  const ensureMember = (parent: UsageTreeNode, kind: 'class' | 'method', name: string, filePath: string): UsageTreeNode => {
    const path = `${parent.path}#${name}`
    let node = parent.children.find(entry => entry.kind === kind && entry.path === path)
    if (!node) {
      node = { kind, name, path, filePath, count: 0, children: [], locations: [] }
      parent.children.push(node)
    }
    return node
  }
  // 第三方分组规则（`com.intellij.usageGroupingRuleProvider`）：内建目录(400)/文件(500) 两支
  // 已经由本函数的目录层与文件层承担，这里只收**其余**规则，按 rank 升序在两层之间插通用组。
  const extraRules = (options.rules ?? [])
    .filter(rule => rule.rank !== USAGE_DIRECTORY_RANK && rule.rank !== USAGE_FILE_RANK)
    .slice()
    .sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id))
  /** 一条规则的组名：`labelOf` 抛错就退回组键（不让一个坏规则吃掉整层）。 */
  const ruleLabel = (rule: UsageGroupingRuleContribution, key: string): string => {
    try { return rule.labelOf(key) } catch { return key }
  }
  for (const location of locations) {
    if (!location || typeof location.path !== 'string' || !location.path) continue
    const normalized = normalize(location.path)
    const segments = normalized.split('/')
    const fileName = segments.pop() ?? normalized
    const directory = ensureDirectory(root, segments)
    // 目录层之下、文件层之上：逐条规则挂一层通用组（每层一个节点，键含规则 id 与组键，
    // 所以同一条规则在不同父节点下、或不同规则之间都不会撞键）。
    let parent = directory
    for (const rule of extraRules) {
      let key: string | null = null
      try { key = rule.groupKeyOf({ path: normalized, line: location.line, symbol: null }) } catch { key = null }
      if (!key) continue
      const groupPath = `\u0000rule:${rule.id}:${key}`
      let node = parent.children.find(entry => entry.kind === 'group' && entry.path === groupPath)
      if (!node) {
        node = { kind: 'group', name: ruleLabel(rule, key), path: groupPath, filePath: normalized, count: 0, children: [], locations: [] }
        parent.children.push(node)
      }
      parent = node
    }
    let file = parent.children.find(entry => entry.kind === 'file' && entry.name === fileName)
    if (!file) {
      file = { kind: 'file', name: fileName, path: normalized, count: 0, children: [], locations: [] }
      parent.children.push(file)
    }
    const position = { path: normalized, line: location.line, character: location.character }
    const symbols = symbolsFor(normalized)
    const member = symbols.length
      ? usageMemberPathFor(symbols, location.line, location.character ?? 0)
      : { className: '', methodName: '', methodDetail: '' }
    let target = file
    if (member.className) {
      const group = ensureMember(file, 'class', member.className, normalized)
      target = member.methodName ? ensureMember(group, 'method', `${member.methodName}${member.methodDetail}`, normalized) : group
    } else if (member.methodName) {
      // 顶层函数/方法（本仓的 TS/JS 文件里很常见）：上游 Java 那棵树里不存在这一形态
      // （`MethodGroupingRule.java:65-67` 要求方法有含限定名的宿主类），所以这里按
      // 「文件 → 方法 → 行」两层收，不假造一个空的类层。
      target = ensureMember(file, 'method', `${member.methodName}${member.methodDetail}`, normalized)
    }
    target.locations.push(position)
    target.count += 1
  }
  const total = (node: UsageTreeNode): number => {
    // ① 同级先后与叶子顺序都取自 `src/usageViewTreeModel.ts` 那一份比较器（上游
    // `impl/GroupNode.java:328-339` + `impl/rules/UsageGroupBase.java:19-23` + `impl/UsageViewImpl.java:225-234`）。
    sortUsageTreeSiblings(node.children)
    node.locations.sort(compareUsageLocations)
    let sum = node.locations.length
    for (const child of node.children) sum += total(child)
    node.count = sum
    return node.count
  }
  total(root)
  return root
}

/** 文件的平表分组（引用面板打印 `path (N)` 那一步）。 */
export interface UsageFileGroup {
  path: string
  count: number
  locations: UsageLocationLike[]
}

export function groupUsagesByFile(locations: readonly UsageLocationLike[]): UsageFileGroup[] {
  const groups = new Map<string, UsageFileGroup>()
  for (const location of locations) {
    if (!location || !location.path) continue
    const path = normalize(location.path)
    const group = groups.get(path) ?? { path, count: 0, locations: [] }
    group.locations.push({ ...location, path })
    group.count += 1
    groups.set(path, group)
  }
  return [...groups.values()]
    .map(group => ({ ...group, locations: group.locations.slice().sort(compareUsageLocations) }))
    .sort((left, right) => compareUsageTreePaths(left.path, right.path))
}

/** 摘要：`N 处引用 / M 个文件`。 */
export function usageSummary(locations: readonly UsageLocationLike[]): string {
  const files = new Set(locations.map(location => normalize(location.path)))
  return `${locations.length} 处引用 / ${files.size} 个文件`
}

/**
 * 平表导出（`path:line` 每行一条、按文件分组）。
 * 留痕：这里原写「IDEA 的 exportToText 格式 = 标题 + path:line 每行一条」—— 实际上游
 * `ExporterToTextFile.java:31-71` 导的是**缩进树**（目录/文件行带 ` (N usages found)`），
 * 本仓那条树形导出在下面的 `exportUsageTreeText`。这个平表形状留着给
 * `usagesClipboardText` 与既有判据用（改它等于放松既有断言）。
 * `header` 为空时不加标题行。
 */
export function exportUsagesText(locations: readonly UsageLocationLike[], header = ''): string {
  const lines: string[] = []
  if (header) lines.push(header, '')
  for (const group of groupUsagesByFile(locations)) {
    for (const location of group.locations) lines.push(`${group.path}:${location.line + 1}`)
  }
  return lines.join('\n')
}

/** 剪贴板用的紧凑形式（同文件合并成一行路径 + 行号列表）。 */
export function usagesClipboardText(locations: readonly UsageLocationLike[]): string {
  return groupUsagesByFile(locations)
    .map(group => `${group.path}: ${group.locations.map(location => location.line + 1).join(', ')}`)
    .join('\n')
}

// ---------------------------------------------------------------- 面板行（树的摊平）

/**
 * 一行的四种形态：`directory`/`file`/`class`/`method` 是组行（可折叠、带计数），`usage` 是叶子
 * （可点，走与平表完全相同的单击导航）。
 */
export interface UsageTreeRow {
  /** 稳定键（组行 = `种类\0路径`，成员组的路径是 `文件#类[#方法]` 那个合成键；叶子 = 位置三元组）—— 折叠集存的就是它。 */
  key: string
  kind: 'directory' | 'file' | 'class' | 'method' | 'group' | 'usage'
  /** 缩进层（根节点不占一层：上游的树根不可见，`UsageViewTreeCellRenderer.java:88-89`）。 */
  depth: number
  /** 主文本：目录 = 相对根的路径、文件 = 文件名或整条路径、类 = `Outer.Inner`、方法 = `名字(参数表)`、用法 = `行:列`。 */
  label: string
  /** 次要文本：组行 = 计数（`usage.view.counter`），叶子 = 空。 */
  detail: string
  /** 导航用的路径（组行 = 目录/文件/成员所在文件；叶子 = 该引用所在文件）。 */
  path: string
  /** 组行的子树合计；叶子为 0。 */
  count: number
  /** 叶子的 0 基位置；组行为 -1。 */
  line: number
  character: number
  /** 组行才有折叠按钮；叶子 false（模板 `v-if` 掉，不画点不动的假按钮）。 */
  collapsible: boolean
  collapsed: boolean
  /** 折叠按钮的 `title` + `aria-label`（纯图标按钮那条规矩）。 */
  toggleLabel: string
}

/** 组键（各档组行共用一套命名空间；目录路径自带尾斜杠、成员键带 `#`，都不会与文件键撞）。 */
export function usageGroupKey(kind: 'directory' | 'file' | 'class' | 'method' | 'group', path: string): string {
  return `${kind}\u0000${path}`
}

/** 组行的各档形态（叶子不是组行）——折叠、过滤、导出都按这一份判断。 */
export type UsageGroupKind = 'directory' | 'file' | 'class' | 'method' | 'group'

/** 是不是组行（叶子之外的四种）。 */
export function isUsageGroupRow(row: UsageTreeRow): boolean {
  return row.kind !== 'usage'
}

/** 叶子的位置文本（1 基 `行:列`，与 `src/hierarchyRenderer.ts:90-95` 同一口径）。 */
export function usagePositionText(location: UsageLocationLike): string {
  return `${location.line + 1}:${(location.character ?? 0) + 1}`
}

/** 组行的计数文本（`usage.view.counter` = `{0} result`/`{0} results`，中文没有单复数变形）。 */
export function usageCounterText(count: number): string {
  return `${count} 条结果`
}

/**
 * 文件行的主文本：
 *   · 上面**有**目录行 → 只给文件名（上游 `FileGroupingRule.java:93-95` 的 `myFile.getName()` 那一支，
 *     由 `UsageViewSettings.kt:118` 的 `isShortFilePathEnabled()` 关掉短路径）；
 *   · 上面**没有**目录行 → 给整条相对路径（对应 `getUniqueVirtualFilePath` 那一支；本仓工作区单根，
 *     相对路径本身就是唯一的那条），这也是面板此前的平表一直在显示的内容。
 */
function usageFileLabel(node: UsageTreeNode, showDirectories: boolean): string {
  return showDirectories ? node.name : node.path
}

export interface UsageTreeFlattenOptions {
  /** 折叠集中的组键。 */
  collapsed?: ReadonlySet<string>
  /** 目录层级（上游 `GROUP_BY_DIRECTORY_STRUCTURE`，默认 false，`UsageViewSettings.kt:26`）。 */
  showDirectories?: boolean
}

/**
 * 把树里的文件组全捞出来、按路径排（忽略大小写）。
 * 目录那一档**关着**时用这一份：上游那棵树里根本没有目录节点，文件组之间就是路径序
 * （比较口径同 `DirectoryGroupingRule.java:189` 的 `compareToIgnoreCase`
 * 与本仓 `src/referenceContents.ts` 的 `sortUsages`）。
 */
export function usageFileNodes(root: UsageTreeNode): UsageTreeNode[] {
  const files: UsageTreeNode[] = []
  const collect = (node: UsageTreeNode): void => {
    for (const child of node.children) {
      if (child.kind === 'file') files.push(child)
      else collect(child)
    }
  }
  collect(root)
  return files.sort((left, right) => compareUsageTreePaths(left.path, right.path))
}

/**
 * 深度优先摊平。层的先后 = 上游那棵树的层序：目录(400) → 文件(500)（
 * `UsageGroupingRulesDefaultRanks.java:26-32`）→ 类 → 方法（`JavaPlugin.xml:566-567` 的注册序，
 * 经 `ActiveRules.java:59-62` 装进树）。折叠掉的组**自己出现**、子树不出现；
 * `showDirectories` 为 false 时目录行整个不出现、也不占一层（文件行的 `depth` 因此仍是 0）。
 */
export function flattenUsageTree(root: UsageTreeNode, options: UsageTreeFlattenOptions = {}): UsageTreeRow[] {
  const collapsed = options.collapsed ?? new Set<string>()
  const showDirectories = options.showDirectories === true
  const rows: UsageTreeRow[] = []
  const emitLeaf = (location: UsageLocationLike, depth: number): void => {
    const position = usagePositionText(location)
    rows.push({
      key: `usage\u0000${location.path}\u0000${position}`, kind: 'usage', depth,
      label: position, detail: '', path: location.path, count: 0,
      line: location.line, character: location.character ?? 0,
      collapsible: false, collapsed: false, toggleLabel: '',
    })
  }
  /** 一个组行的主文本（四种组各按上游那一档的呈现文本）。 */
  const groupLabel = (node: UsageTreeNode): string => {
    if (node.kind === 'directory') return node.path.replace(/\/+$/, '')
    if (node.kind === 'file') return usageFileLabel(node, showDirectories)
    return node.name
  }
  /** 画一个组行；返回它是不是被折叠掉了。 */
  const emitGroup = (node: UsageTreeNode, depth: number): boolean => {
    const key = usageGroupKey(node.kind, node.path)
    const isCollapsed = collapsed.has(key)
    const label = groupLabel(node)
    rows.push({
      key, kind: node.kind, depth, label, detail: usageCounterText(node.count),
      // 成员组的导航路径是它所在的那个文件（合成键只用来当折叠键）
      path: node.filePath ?? node.path, count: node.count, line: -1, character: -1,
      // 收得动才算可折叠：既没有子组又没有直接位置的组（过滤后可能出现空壳）不该有那个假箭头
      collapsible: node.children.length > 0 || node.locations.length > 0, collapsed: isCollapsed,
      toggleLabel: usageTreeToggleLabel(isCollapsed, label),
    })
    return isCollapsed
  }
  const emitOwnLeaves = (node: UsageTreeNode, depth: number): void => {
    for (const location of node.locations) emitLeaf(location, depth)
  }
  /** 类 / 方法两层（成员层只在符号给得出来时存在）。 */
  const emitMember = (node: UsageTreeNode, depth: number): void => {
    if (emitGroup(node, depth)) return
    emitOwnLeaves(node, depth + 1)
    for (const child of node.children) emitMember(child, depth + 1)
  }
  const emitFile = (file: UsageTreeNode, depth: number): void => {
    if (emitGroup(file, depth)) return
    emitOwnLeaves(file, depth + 1)
    for (const child of file.children) emitMember(child, depth + 1)
  }
  /**
   * 第三方分组规则加出来的通用组层（`kind: 'group'`，名字来自规则的 `labelOf`）。
   * 它和目录层一样是个容器：子节点可能是另一个通用组、也可能是文件节点。
   */
  const emitGroupLayer = (node: UsageTreeNode, depth: number): void => {
    if (emitGroup(node, depth)) return
    for (const child of node.children) {
      if (child.kind === 'file') emitFile(child, depth + 1)
      else if (child.kind === 'directory') emitDirectory(child, depth + 1)
      else if (child.kind === 'group') emitGroupLayer(child, depth + 1)
      else emitMember(child, depth + 1)
    }
  }
  const emitDirectory = (node: UsageTreeNode, depth: number): void => {
    if (emitGroup(node, depth)) return
    for (const child of node.children) {
      if (child.kind === 'file') emitFile(child, depth + 1)
      else if (child.kind === 'directory') emitDirectory(child, depth + 1)
      else if (child.kind === 'group') emitGroupLayer(child, depth + 1)
      else emitMember(child, depth + 1)
    }
  }
  if (showDirectories) {
    for (const child of root.children) {
      if (child.kind === 'file') emitFile(child, 0)
      else if (child.kind === 'directory') emitDirectory(child, 0)
      else if (child.kind === 'group') emitGroupLayer(child, 0)
      else emitMember(child, 0)
    }
    return rows
  }
  // 目录那一档关着（默认档）：树里根本没有目录节点（`ActiveRules.java:55-57` 那一句是
  // `if (isGroupByDirectoryStructure)` 才加 `DirectoryStructureGroupingRule`），文件组的先后
  // 就是整条路径的序（`DirectoryGroupingRule.java:189` 的 `compareToIgnoreCase` 同一口径，
  // 也是 `src/referenceContents.ts:67-75` 的 `sortUsages`）。
  for (const file of usageFileNodes(root)) emitFile(file, 0)
  return rows
}

/**
 * 树里**所有**组行的键（「全部折叠」要收的就是这一批 —— 上游 `TreeUtil.collapseAll(tree, 3)`
 * 收的是整棵树，只留"选中路径到第 3 层"那一段不许收与唯一那个顶层节点
 * （`platform/platform-api/src/com/intellij/util/ui/tree/TreeUtil.java:883-892` 的 `keepSelectionLevel`
 * 与 `:892-907` 的 `strict`/`prohibited`；调用点 `UsageViewImpl.java:356` + `:1338-1343`）。
 * 本仓的面板**没有选择态**（登记在 `src/usageViewGear.ts:15-17`），那一段留不出来的部分做不成，
 * 所以这里收的是全部组键、收完屏上仍是那一列组行自己（根不可见，`UsageViewTreeCellRenderer.java:88-89`）。
 * `showDirectories` 决定树里有哪几层，所以目录那一档关着时这里只有文件键。
 * 键的**来源**改成 `usageLevelCounts` 那一张表（同一份遍历、同一份顺序，两处不再各数一遍账）。
 */
export function allUsageGroupKeys(root: UsageTreeNode, options: { showDirectories?: boolean } = {}): string[] {
  return usageLevelCounts(root, options).map(entry => entry.key)
}

// ---------------------------------------------------------------- 同级计数（行模型的那三格账）

/**
 * 一个组行在账上的三个数（**同级互不重叠**是这张表存在的理由）：
 *   · `ownCount` = 直接挂在本节点上的用法条数 —— 上游那一格是 `GroupNode.getUsageNodes()`
 *     （`platform/usageView-impl/src/com/intellij/usages/impl/GroupNode.java:409-417`）；
 *   · `childCount` = 各**直接子组**的递归合计之和 —— 上游那一格是 `getSubGroups()`（同文件 `:399-407`）；
 *   · `count` = 子树合计（屏上 `N 条结果` 用的就是它）—— 上游 `getRecursiveUsageCount()`
 *     （`GroupNode.java:363-366`），它是 `:290-299` `incrementUsageCount` 从叶子一路往上加维护的，
 *     所以恒等于 `ownCount + childCount`；导出走同一格（`ExporterToTextFile.java:57-63`）。
 * `parentKey` 是父组的键（根下那一层的父 = 空串，因为上游的根在树里不可见，
 * `UsageViewTreeCellRenderer.java:88-89`）。
 */
export interface UsageLevelCount {
  key: string
  kind: UsageGroupKind
  /** 可见层，与 `UsageTreeRow.depth` 同一口径（目录那一档关着时目录行不占层）。 */
  depth: number
  parentKey: string
  ownCount: number
  childCount: number
  count: number
}

/** 数的是**树里有什么**，与屏上收没收起无关（上游对账对的是 model，`ExporterToTextFile.java:24-29` 导的也是 model）。 */
const NO_COLLAPSED_KEYS: ReadonlySet<string> = new Set<string>()

/** 把树里所有组节点按 `usageGroupKey` 建索引（与 `showDirectories` 无关：那一档只决定屏上画不画目录行）。 */
function indexUsageGroupNodes(root: UsageTreeNode): Map<string, UsageTreeNode> {
  const index = new Map<string, UsageTreeNode>()
  const walk = (node: UsageTreeNode): void => {
    for (const child of node.children) {
      index.set(usageGroupKey(child.kind, child.path), child)
      walk(child)
    }
  }
  walk(root)
  return index
}

/**
 * 按屏上那一列行的**顺序**给出每个组行的三格账（`flattenUsageTree` 是唯一那份行序，这里只补账不重排，
 * 所以 `allUsageGroupKeys` 与「全部折叠」收的那批键天然与面板上看到的同一份）。
 */
export function usageLevelCounts(root: UsageTreeNode, options: UsageTreeFlattenOptions = {}): UsageLevelCount[] {
  const nodes = indexUsageGroupNodes(root)
  const table: UsageLevelCount[] = []
  const stack: { depth: number; key: string }[] = []
  for (const row of flattenUsageTree(root, { ...options, collapsed: NO_COLLAPSED_KEYS })) {
    if (!isUsageGroupRow(row)) continue
    while (stack.length && stack[stack.length - 1]!.depth >= row.depth) stack.pop()
    const node = nodes.get(row.key)
    const ownCount = node ? node.locations.length : 0
    table.push({
      key: row.key, kind: row.kind as UsageGroupKind, depth: row.depth,
      parentKey: stack.length ? stack[stack.length - 1]!.key : '',
      ownCount, childCount: row.count - ownCount, count: row.count,
    })
    stack.push({ depth: row.depth, key: row.key })
  }
  return table
}

// ---------------------------------------------------------------- 展开态沿用（重建之后那份折叠集）

/**
 * 一份内容的展开态落在哪一档。上游对应的是**两处**分开存的东西：
 *   · `mixed`（默认）= 逐节点的展开态，只在运行时，重建时按 `UsageViewImpl.java:1270-1288` 的
 *     `captureUsagesExpandState` 抓"当前展开到看得见用法叶子"的那批路径，再由 `:1291-1307` 的
 *     `restoreUsageExpandState` 贴回去（贴的时候根下那一层一律展开，`:1293` 那句 `//always expand the last level group`）；
 *   · `expanded` / `collapsed` = 应用级那一格布尔 `UsageViewSettings.kt:63-64` 的 `IS_EXPANDED`
 *     （`usageView.xml`，默认 false），只有工具条那两个动作会写它
 *     （`UsageViewImpl.java:344-347` 展开时置 true、`:353-358` 折叠时置 false），
 *     结果回来时读它（`:1875-1877`：true 且少于一万条就 `expandAll()`）。
 */
export type UsageExpansionMode = 'expanded' | 'collapsed' | 'mixed'

export interface UsageExpansionCarryOptions {
  /** 目录那一档（决定树里有哪几层的键，切了档旧键就不该往新档上贴）。 */
  showDirectories?: boolean
  /** 默认 `mixed`（= 只沿用还存在的键）。 */
  mode?: UsageExpansionMode
}

/**
 * 树重建之后（换档 / 增量结果 / 符号迟到）该用哪一份折叠集 —— 本仓的"沿用"。
 *   · `expanded` ⇒ 空集：全展开，**新出现的组也展开**（上游 `IS_EXPANDED=true` 时结果回来 `expandAll()`，
 *     `UsageViewImpl.java:1875-1877`）；
 *   · `collapsed` ⇒ 整棵树的组键：全折叠，**新出现的组也收起**（上游按了折叠之后新节点不会自己展开）；
 *   · `mixed` ⇒ **交集**：只保留这一棵树里还存在的键，按树里的顺序、去重
 *     （上游 `captureUsagesExpandState` 只抓"还看得见"的那批，`:1272` 一句 `if (!myTree.isExpanded(pathFrom)) return;`
 *     就是这条"消失的组不再沿用"）。
 * 交集那一支同时把垃圾键清掉：本仓的折叠集是按内容 id 存的一串键，结果换一批、成员层出现/消失都会让
 * 旧键永不命中（`tests/usage-view-panel-rows.test.mjs:89` 那条断言写的就是这个隐患）。
 */
export function carryUsageExpansion(
  root: UsageTreeNode,
  options: UsageExpansionCarryOptions = {},
  previous: Iterable<string> = [],
): string[] {
  const present = usageLevelCounts(root, { showDirectories: options.showDirectories }).map(entry => entry.key)
  const mode = options.mode ?? 'mixed'
  if (mode === 'expanded') return []
  if (mode === 'collapsed') return present
  const keep = new Set(previous)
  return present.filter(key => keep.has(key))
}


/**
 * 树形导出（上游 `ExporterToTextFile.java:31-71`）：每层缩进 4 空格（`:35`）、根不写（`:34-40`）、
 * 组行 = 呈现文本 + ` (N usages found)`（`:57-63`）、叶子 = 位置文本。
 * 树里有**哪几层**完全交给 `flattenUsageTree`（面板画几层，导出的就是那几层：目录 / 文件 /
 * 类 / 方法 / 行，一处规则两份呈现），折叠状态不影响导出（上游导的是 model，不是 expand state）。
 */
export function exportUsageTreeText(root: UsageTreeNode, options: UsageTreeFlattenOptions & { header?: string } = {}): string {
  const lines: string[] = []
  if (options.header) lines.push(options.header, '')
  for (const row of flattenUsageTree(root, { showDirectories: options.showDirectories })) {
    const indent = '    '.repeat(row.depth)
    lines.push(row.kind === 'usage'
      ? `${indent}${row.label}`
      : `${indent}${row.label} (${usagesFoundText(row.count)})`)
  }
  return lines.join('\n')
}

/** 导出文本里组行的计数（`usages.n`，`UsageViewBundle.properties:8`：`no usages`/`1 usage`/`N usages` + ` found`）。 */
export function usagesFoundText(count: number): string {
  return count <= 0 ? '没有找到用法' : `找到 ${count} 条用法`
}

// ---------------------------------------------------------------- 速度搜索（过滤后的行归属）

/**
 * 一行的速度搜索文本 —— 上游那份 `getPlainTextForNode`（`UsageViewTreeCellRenderer.java:159-213`，
 * 由 `UsageViewImpl.java:978-983` 的 `installTreeSpeedSearch` 取用）的形状：
 *   · 组行 = 呈现文本 + ` (子树合计)`（`:188-197`：`getPresentableGroupText()` 后面跟着
 *     `" (" + getRecursiveUsageCount() + ")"`）；
 *   · 叶子 = 呈现文本（上游是那一行的代码，本仓只有位置串，见文件头的架构不等价登记）。
 * 计数**参与**搜索文本（照 `:197` 那一句），不是本仓自己加的。
 */
export function usageRowSearchText(row: UsageTreeRow): string {
  return row.kind === 'usage' ? row.label : `${row.label} (${row.count})`
}

/** 一个节点自己的搜索文本（与 `flattenUsageTree` 画出来的那一行的 label/count 同一份算法）。 */
function usageNodeSearchText(node: UsageTreeNode, showDirectories: boolean): string {
  const label = node.kind === 'directory'
    ? node.path.replace(/\/+$/, '')
    : node.kind === 'file'
      ? usageFileLabel(node, showDirectories)
      : node.name
  return `${label} (${node.count})`
}

export interface UsageTreeFilterOptions {
  /** 目录那一档（影响文件行的呈现文本，也就影响匹配的文本）。 */
  showDirectories?: boolean
  /**
   * 匹配规则：默认复用本仓那一处 MinusculeMatcher 等价物 `src/speedSearch.ts:38`
   * （面板/文件树/书签都走它，不再造第二套「像不像」的判断）。
   */
  match?: (query: string, text: string) => boolean
}

/**
 * 按速度搜索的那串文本过滤整棵树：**留下的组行里的 count 是可见行的合计**（判据要求的这一条），
 * 一行都不剩的组整个消失。
 *
 * 与上游的差异（如实登记，别写成上游也是这么干的）：
 *   上游的 speed search **不过滤**这棵树 —— `UsageViewImpl.java:978-983` 装的是
 *   `installTreeSpeedSearch`，它按 `getPlainTextForNode` 匹配到**下一个那一行**并选中，
 *   屏上的行一条不少（组行的计数也就一直是 `getRecursiveUsageCount()`，
 *   `UsageViewTreeCellRenderer.java:95`）。本仓的引用面板是 Vue 的一张列表、没有 JTree 的
 *   选中跳转形态，宿主给的是 `src/components/SpeedSearchBar.vue` 那一条**输入框**，
 *   所以这里的语义是「过滤 + 重算计数」；匹配用的文本仍取上游那一份（`usageRowSearchText`），
 *   规则复用本仓既有的 `speedSearchMatches`。
 *
 * 行的归属：叶子按它自己的文本比；组行自己命中时**整棵子树都算可见**
 * （屏上那条组行就是它，收着的那一层不该因为父行没命中而被摘掉）；
 * 目录那一档关着时目录行不出现，所以它的文本**不参与**命中判断。
 */
export function filterUsageTree(root: UsageTreeNode, query: string, options: UsageTreeFilterOptions = {}): UsageTreeNode {
  const showDirectories = options.showDirectories === true
  const trimmed = (query ?? '').trim()
  if (!trimmed) return root
  const match = options.match ?? speedSearchMatches
  /** 这一层在屏上到底出不出现（关着目录那一档时目录行不出现 ⇒ 它的文本也不算命中）。 */
  const nodeRendered = (node: UsageTreeNode): boolean => showDirectories || node.kind !== 'directory'
  const filterNode = (node: UsageTreeNode): UsageTreeNode | null => {
    const selfHit = nodeRendered(node) && match(trimmed, usageNodeSearchText(node, showDirectories))
    // 组行自己命中 ⇒ 它那一整棵都算可见（屏上就是这一条组行，收着的那一层不该因为
    // "叶子没匹配上"被摘掉；计数也就还是它原本的子树合计）
    if (selfHit) return node
    const locations = node.locations.filter(location => match(trimmed, usagePositionText(location)))
    const children: UsageTreeNode[] = []
    for (const child of node.children) {
      const kept = filterNode(child)
      if (kept) children.push(kept)
    }
    if (!locations.length && !children.length) return null
    const count = locations.length + children.reduce((sum, child) => sum + child.count, 0)
    return { ...node, locations, children, count }
  }
  const children: UsageTreeNode[] = []
  for (const child of root.children) {
    const kept = filterNode(child)
    if (kept) children.push(kept)
  }
  const count = children.reduce((sum, child) => sum + child.count, 0)
  return { ...root, locations: [], children, count }
}

/** 过滤 + 摊平的那一步（面板只用这一个入口就够了，免得宿主自己串错顺序）。 */
export function usageRowsForQuery(
  root: UsageTreeNode,
  query: string,
  options: UsageTreeFlattenOptions & UsageTreeFilterOptions = {},
): UsageTreeRow[] {
  return flattenUsageTree(filterUsageTree(root, query, options), options)
}

// ── `com.intellij.usageGroupingRuleProvider` 的 bundled 两支与消费面（2026-10-07 epclose2） ──────
//
// 上游把「引用/用法树怎么分层」做成一组可插的 `UsageGroupingRule`，按档号（`UsageGroupingRulesDefaultRanks`：
// 目录结构 400、文件结构 500）装进那棵树；贡献面是 `com.intellij.usageGroupingRuleProvider`
// （`platform/usageView/resources/intellij.platform.usageView.xml:33`、接口
// `platform/usageView/src/com/intellij/usages/rules/UsageGroupingRuleProvider.java:18` 的 `EP_NAME`）。
// 本仓 `buildUsageTree` 内建的「目录 → 文件」两层就是这两条规则；这里把它们作为 bundled 贡献登记进同名
// EP，第三方（原版 IDEA 插件，如 Kotlin 的模块/包分组）按同一 id 挂的规则会出现在 `usageGroupingRulesFor`
// 里。**如实差异**：协调单里写的 `com.intellij.moduleGroupingRuleProvider` 上游不存在，`ModuleGroupingRule`
// 是使用 usageView-impl 的一条**内建规则**而不是 EP（`.../rules/ModuleGroupingRule.java:32`），故落到真 EP 上。

/** 目录分组规则 id（上游 `DirectoryGroupingRule`，档号 400）。 */
export const DIRECTORY_GROUPING_RULE_ID = 'DirectoryGroupingRule'
/** 文件分组规则 id（上游 `FileGroupingRule`，档号 500）。 */
export const FILE_GROUPING_RULE_ID = 'FileGroupingRule'
/** 目录结构那一档的档号（`UsageGroupingRulesDefaultRanks.DIRECTORY_STRUCTURE = 400`）。 */
export const USAGE_DIRECTORY_RANK = 400
/** 文件结构那一档的档号（`UsageGroupingRulesDefaultRanks.FILE_STRUCTURE = 500`）。 */
export const USAGE_FILE_RANK = 500

/** 路径所在目录（0 基到最后一个 `/`；顶层文件空串），与 `buildUsageTree` 的目录层同一口径。 */
function directoryKeyOf(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index < 0 ? '' : normalized.slice(0, index)
}

/** 内建的两条分组规则（目录 → 文件），作为一条 bundled provider。 */
export function bundledUsageGroupingRuleProvider(): UsageGroupingRuleProviderContribution {
  return {
    id: 'TaoCode.bundledUsageGroupingRules',
    getActiveRules: () => [
      {
        id: DIRECTORY_GROUPING_RULE_ID,
        rank: USAGE_DIRECTORY_RANK,
        groupKeyOf: usage => usageGroupKey('directory', directoryKeyOf(usage.path)),
        labelOf: groupKey => groupKey,
      },
      {
        id: FILE_GROUPING_RULE_ID,
        rank: USAGE_FILE_RANK,
        groupKeyOf: usage => usageGroupKey('file', usage.path),
        labelOf: groupKey => groupKey,
      },
    ],
  }
}

// 模块加载即登记（bundled 贡献必须真的在表里）。
registerUsageGroupingRuleProvider(bundledUsageGroupingRuleProvider())

/** 当前工作区生效的全部用法分组规则（内建两支 + 第三方挂的），按档号升序。 */
export function usageGroupingRulesFor(root = ''): UsageGroupingRuleContribution[] {
  return activeUsageGroupingRules(root)
}
