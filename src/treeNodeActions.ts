// 树节点的展开/折叠动作 —— 上游 `platform/platform-impl/src/com/intellij/ide/actions/tree/` 那一族
// （`BaseTreeNodeAction` + `ExpandTreeNodeAction` / `CollapseTreeNodeAction` / `FullyExpandTreeNodeAction`）
// 在本仓项目树上的等价物。
//
// 上游依据（逐条核过本机上游树）：
//   · 动作注册：`platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:293-295`
//     （`ExpandTreeNode`/`CollapseTreeNode`/`FullyExpandTreeNode` 三个 id）；
//     `platform/platform-impl/resources/idea/PlatformActions.xml:272-274` 是顶层引用（登记不进菜单组）。
//   · 默认键位：`platform/platform-resources/src/keymaps/$default.xml:27-35` ——
//     `FullyExpandTreeNode` = `MULTIPLY`（小键盘 `*`）、`ExpandTreeNode` = `ADD`（`+`）、
//     `CollapseTreeNode` = `SUBTRACT`（`-`）。三个都是**裸小键盘键**，不带修饰键。
//   · 行为：`BaseTreeNodeAction.actionPerformed`（取上下文组件，是 JTree 才动手）、
//     `ExpandTreeNodeAction.performOn` = `TreeExpandCollapse.expand(tree)`、
//     `CollapseTreeNodeAction.performOn` = `TreeExpandCollapse.collapse(tree)`、
//     `FullyExpandTreeNodeAction.performOn` = `TreeExpandCollapse.expandAll(tree)`。
//   · `platform/platform-impl/src/com/intellij/ui/TreeExpandCollapse.java:11-19`：
//     `collapse`/`expand` 都是**对选中的那一条路径**动手（`tree.getSelectionPath()`）；
//     `:21-30` `expandAll` 取**全部选中路径**，没有选中就取根；`:33-58` `ExpandContext` 的
//     展开上限是 `(300, 10)`（最多 300 个节点、往下 10 层）—— 本仓照抄这两个数。
//   · `BaseTreeNodeAction.update`（`:40-42`）：**只有上下文组件是树时才可用**
//     （`enabledOn` 判 JTree/TreeTable）。本仓的等价判据是「焦点在项目树上」。
//
// **本仓用什么承接了上游的什么**（架构不等价 ⇒ 用本仓架构还原用户可见功能）：
//   · 上游的 `JTree` 选中路径 → 本仓的 `selection`（`src/projectTreeModel.ts` 的选中集合）与
//     `expanded`（展开集合）。`collapse`/`expand` 作用在**当前选中行**上（多选时取第一条 ——
//     上游 `getSelectionPath` 也是取 lead path）。
//   · `expandAll` 的「无选中就取根」在本仓是「无选中就取第一行」；上限 (300, 10) 与
//     `ExpandContext` 同一份常量。
//   · 键位落点是项目树的 `onRowKeydown`（`src/components/FileTree.vue`）—— 用 `event.code`
//     认小键盘（浏览器里 `NumpadAdd`/`NumpadSubtract`/`NumpadMultiply`），因为 `event.key`
//     在小键盘上是 `+`/`-`/`*`，与主键盘区那几个键**同形**（上游 `MULTIPLY`/`ADD`/`SUBTRACT`
//     只在树获得焦点时生效，本仓同样只在树的行上处理，所以不会与编辑器抢键）。
//
// 纯逻辑（判定 + 上限 + 键位映射），不 import DOM，可单测（`tests/tree-node-actions.test.mjs`）。

/** 三个动作 id（`intellij.platform.ide.impl.actions.xml:293-295`）。 */
export const TREE_NODE_ACTION_IDS = ['ExpandTreeNode', 'CollapseTreeNode', 'FullyExpandTreeNode'] as const
export type TreeNodeAction = (typeof TREE_NODE_ACTION_IDS)[number]

/** `TreeExpandCollapse.ExpandContext(300, 10)`（`:29`）：一次全展开最多开 300 个节点、往下 10 层。 */
export const FULL_EXPAND_NODE_LIMIT = 300
export const FULL_EXPAND_LEVEL_LIMIT = 10

/** 动作 → 键面（`$default.xml:27-35` 的 `MULTIPLY`/`ADD`/`SUBTRACT` 映射到浏览器 `KeyboardEvent.code`）。 */
export const TREE_NODE_ACTION_CODES: Record<TreeNodeAction, string> = {
  FullyExpandTreeNode: 'NumpadMultiply',
  ExpandTreeNode: 'NumpadAdd',
  CollapseTreeNode: 'NumpadSubtract',
}

/** 动作的显示名（`ActionsBundle.properties` 的 zh 值；`*` 展开全部 / `+` 展开 / `-` 折叠）。 */
export const TREE_NODE_ACTION_LABELS: Record<TreeNodeAction, string> = {
  FullyExpandTreeNode: '全部展开',
  ExpandTreeNode: '展开',
  CollapseTreeNode: '折叠',
}

/** 键面 → 动作（裸小键盘键，无修饰键 —— 上游这三个绑定没有 modifier）。 */
export function treeNodeActionFor(code: string, modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}): TreeNodeAction | null {
  // 上游是裸键：带了任何修饰键就不认（否则 Ctrl+* 之类会被误吞）。
  if (modifiers.ctrl || modifiers.alt || modifiers.shift || modifiers.meta) return null
  for (const action of TREE_NODE_ACTION_IDS)
    if (TREE_NODE_ACTION_CODES[action] === code) return action
  return null
}

/**
 * 一行的可展开性（本仓树模型的口径：目录与「有嵌套子文件的文件行」可展开，
 * 见 `src/projectTreeModel.ts` 的 `toggle`）。合成行（`\0` 前缀）不是文件系统实体，也不可展开。
 */
export interface TreeNodeLike {
  path: string
  kind: string
  /** 这一行下面还有子行（展开后能露出东西）。 */
  hasChildren?: boolean
}

export function isTreeExpandable(node: TreeNodeLike): boolean {
  if (node.path.startsWith('\u0000')) return false
  return node.kind === 'directory' || Boolean(node.hasChildren)
}

/**
 * `FullyExpandTreeNode` 的目标集合：`expandAll` 取**全部选中路径**，没有选中就取根
 * （`TreeExpandCollapse.java:22-28`）。本仓的「根」是清单第一行；空树返回空数组。
 */
export function fullExpandTargets(selected: readonly string[], rows: readonly TreeNodeLike[]): string[] {
  if (!rows.length) return []
  const chosen = selected.filter(path => rows.some(row => row.path === path))
  return chosen.length ? chosen : [rows[0]!.path]
}

/**
 * `expand`/`collapse` 的目标：选中的那一条（`getSelectionPath` 取 lead path）。
 * 多选时按**树的行序**取第一条（`selection` 是 `Set`，插入序与行序不同 ⇒ 这里按行序挑，
 * 保证「当前行」是用户看得到的那一行）。没有选中返回 null。
 */
export function treeNodeActionTarget(selected: readonly string[], rows: readonly TreeNodeLike[]): string | null {
  if (!rows.length || !selected.length) return null
  for (const row of rows) if (selected.includes(row.path)) return row.path
  return null
}

/**
 * 一次全展开要开哪些行（`ExpandContext.expand` 的 BFS 截断，`:44-57`）：
 * 从目标行往下逐层开，最多 `nodeLimit` 个节点、最深 `levelLimit` 层。
 * `childrenOf` 给一行的直接子行（本仓树模型按 `parent` 关系算）；返回要加进展开集合的路径。
 * 上游 `myExpansionLimit` 是**跨所有选中路径共享**的（`expandAll` 那个 for 循环复用一个计数器），
 * 所以这里也按调用顺序共享（多个目标时后面的会被前面耗掉预算）。
 */
export function fullyExpandPaths(
  targets: readonly string[],
  rows: readonly { path: string; parent?: string | null; kind?: string }[],
  nodeLimit = FULL_EXPAND_NODE_LIMIT,
  levelLimit = FULL_EXPAND_LEVEL_LIMIT,
): string[] {
  const opened: string[] = []
  let budget = nodeLimit
  const childrenOf = (path: string) => rows.filter(row => (row.parent ?? '') === path)
  const walk = (path: string, levelsLeft: number): void => {
    if (levelsLeft <= 0 || budget <= 0) return
    const node = rows.find(row => row.path === path)
    if (!node) return
    if (node.kind !== 'directory' && !childrenOf(path).length) return
    if (!opened.includes(path)) { opened.push(path); budget -= 1 }
    for (const child of childrenOf(path)) walk(child.path, levelsLeft - 1)
    if (budget <= 0) return
  }
  for (const target of targets) walk(target, levelLimit)
  return opened
}