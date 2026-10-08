// 「图选项」—— 日志工具条过滤栏的**第五个**部件，紧跟在「路径」后面。
//
// 上游是 `VcsLogClassicFilterUi.createActionGroup()`（`VcsLogClassicFilterUi.kt:149-150`）
// 返回的最后一档 `createGraphComponent()` = `VcsLogGraphOptionsChooserGroup`
// （`ui/filter/VcsLogGraphOptionsChooserGroup.java:37`），标题 `group.Vcs.Log.GraphOptionsGroup.text`
// = 图选项，描述 = VCS 日志图选项和操作。菜单结构照 `getChildren`（`:60-73`）逐行：
//
//   排序        `action.vcs.log.sort.type.separator`
//     · 按提交日期   `graph.sort.off`          = `PermanentGraph.Options.Base(SortType.Normal)` —— **缺省**
//     · 以拓扑方式   `graph.sort.standard`     = `Base(SortType.Bek)`
//   ─
//   选项        `action.vcs.log.graph.options.separator`
//     · 第一个父项   `graph.options.first.parent` = `PermanentGraph.Options.FirstParent`
//     · 无合并       `vcs.log.filter.no.merges`    = `VcsLogFilterObject.noMerges()`（父提交过滤器）
//   （上游在这个位置还有两条，本仓不渲染，判据见文件尾的 LOG_GRAPH_OPTION_GAPS）
//
// 缺省档是抄来的：`PermanentGraph.Options.Default = Base(SortType.Normal)`
// （`graph-api/.../PermanentGraph.kt:77`）⇒ 不加 `--topo-order`；`GraphOptionsUtil.kt:30`
// 把 `Base` 的名字映射到 `sortType.localizedName`，Normal 那档就是「按提交日期」。
// 「无合并」的缺省是关的（`NoMergesFilterAction.isSelected` 判 `parentFilterModel.getFilter() != null`，
// 没有过滤器就是没开）。三个开关在 `GitLogQuery` 上都是**只有 true 才带**，
// 所以 `VcsLog.vue` 那边只要把 true 写进 query 就行。

import type { GitLogQuery, GitLogSort } from './bridge'

/** `group.Vcs.Log.GraphOptionsGroup.text` = 图选项。 */
export const LOG_GRAPH_OPTIONS_TITLE = '图选项'
/** `group.Vcs.Log.GraphOptionsGroup.description` = VCS 日志图选项和操作。 */
export const LOG_GRAPH_OPTIONS_DESCRIPTION = 'VCS 日志图选项和操作'
/** `action.vcs.log.sort.type.separator` = 排序。 */
export const LOG_SORT_SEPARATOR = '排序'
/** `action.vcs.log.graph.options.separator` = 选项。 */
export const LOG_OPTIONS_SEPARATOR = '选项'
/** `graph.sort.off` = 按提交日期（= `PermanentGraph.SortType.Normal`，上游缺省档）。 */
export const LOG_SORT_DATE = '按提交日期'
/** `graph.sort.off.description`。 */
export const LOG_SORT_DATE_DESCRIPTION = '按提交日期以拓扑方式对提交进行排序'
/** `graph.sort.standard` = 以拓扑方式（= `PermanentGraph.SortType.Bek`）。 */
export const LOG_SORT_TOPOLOGICAL = '以拓扑方式'
/** `graph.sort.standard.description`。 */
export const LOG_SORT_TOPOLOGICAL_DESCRIPTION = '合并时，首先在合并提交正下方显示传入提交'
/** `graph.options.first.parent` = 第一个父项。 */
export const FIRST_PARENT_TITLE = '第一个父项'
/** `graph.options.first.parent.description`。 */
export const FIRST_PARENT_DESCRIPTION = '看到合并提交后，仅跟随第一个父提交'
/** `vcs.log.filter.no.merges` = 无合并。 */
export const NO_MERGES_TITLE = '无合并'
/** `action.vcs.log.branches.separator` = Branch Actions（`VcsLogBundle.properties:36`；本树只有英文包，中文措辞**无法核实**，此处沿用本仓界面口径）。 */
export const LOG_BRANCH_ACTIONS_SEPARATOR = '分支操作'
/** `action.title.collapse.linear.branches` = 收起线性分支（`VcsLogBundle.properties:44`）。 */
export const LOG_COLLAPSE_TITLE = '收起线性分支'
/** `action.description.collapse.linear.branches` = 收起线性分支（`:43`）。 */
export const LOG_COLLAPSE_DESCRIPTION = '收起线性分支'
/** `action.title.expand.linear.branches` = 展开线性分支（`:38`）。 */
export const LOG_EXPAND_TITLE = '展开线性分支'
/** `action.description.expand.linear.branches` = 展开线性分支（`:37`）。 */
export const LOG_EXPAND_DESCRIPTION = '展开线性分支'

/** 上游进度标题（`action.process.collapsing.linear.branches` = Collapsing linear branches… 即 `VcsLogBundle.properties:39`；
 *  `action.process.expanding.linear.branches` = Expanding linear branches… 即 `:32`。
 *  长动作跑在进度条上：`CollapseOrExpandGraphAction.java:78-90` 把标题交给 `runProcessWithProgressSynchronously`）。 */
export const LOG_COLLAPSE_PROCESS = '正在收起线性分支…'
export const LOG_EXPAND_PROCESS = '正在展开线性分支…'

/**
 * 「折叠已合并分支」一族 —— 上游 `VcsLogBundle.properties` 的 merges 那四条：
 * `action.title.collapse.merges` = Collapse Merges（`:42`）/ `action.description.collapse.merges` = Collapse merges（`:41`）/
 * `action.title.expand.merges` = Expand Merges（`:35`）/ `action.description.expand.merges` = Expand merges（`:34`），
 * 进度标题 `action.process.collapsing.merges` = Collapsing merges…（`:40`）/
 * `action.process.expanding.merges` = Expanding merges…（`:33`）。
 * 本地化包不在参考树里 ⇒ 中文按英文原文直译（与 `LOG_ALIGN_LABELS_TITLE` 同一口径）。
 * 这一族什么时候出现：`CollapseOrExpandGraphAction.update` 只有在 `GRAPH_OPTIONS == LinearBek` 时才把
 * 动作文字换成 merges 那一族（`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/CollapseOrExpandGraphAction.java:58-67`，
 * 进度标题同一判据在 `CollapseGraphAction.java:28-30`），而 LinearBek 门在 Registry `vcs.log.linear.bek.sort`
 * 后面且默认关（`platform/vcs-log/impl/src/com/intellij/vcs/log/util/BekUtil.java:13-15`）⇒ 出厂弹层里走的是线性分支那一族。
 */
export const LOG_COLLAPSE_MERGES_TITLE = '折叠已合并分支'
export const LOG_COLLAPSE_MERGES_DESCRIPTION = '折叠已合并分支'
export const LOG_COLLAPSE_MERGES_PROCESS = '正在折叠已合并分支…'
export const LOG_EXPAND_MERGES_TITLE = '展开已合并分支'
export const LOG_EXPAND_MERGES_DESCRIPTION = '展开已合并分支'
export const LOG_EXPAND_MERGES_PROCESS = '正在展开已合并分支…'

/**
 * `MainVcsLogUiProperties.GRAPH_OPTIONS`（`platform/vcs-log/impl/src/com/intellij/vcs/log/impl/MainVcsLogUiProperties.java:17`）
 * 是**一个单值**属性，不是三个独立开关：`PermanentGraph.Options` 是 sealed class，
 * `Base(sortType)` / `LinearBek` / `FirstParent` 三者互斥（`platform/vcs-log/graph-api/src/com/intellij/vcs/log/graph/PermanentGraph.kt:59-79`），
 * 缺省 `Default = Base(SortType.Normal)`（同一文件 `platform/vcs-log/graph-api/src/com/intellij/vcs/log/graph/PermanentGraph.kt:75-78`）。
 * 选中态与写入也按单值走：`SelectOptionsAction.isSelected` 比的是整个属性值
 * （`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/filter/VcsLogGraphOptionsChooserGroup.java:139-142`），
 * 非 Base 那两档关掉时写回 `Default`（同一文件 `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/filter/VcsLogGraphOptionsChooserGroup.java:168-171`）。
 *
 * 本仓的 `LogGraphOptionState` 存的是 `sort` + `firstParent`（历史形状），这里按上游的**排他顺序**归一成一条：
 * LinearBek → FirstParent → Base(sort)。弹层里那三条的添加顺序就是这一优先级
 * （`VcsLogGraphOptionsChooserGroup.java:62-69`：先排序两档，再 LinearBek（门着），再 FirstParent）。
 */
export type LogGraphDisplayOption =
  | 'PermanentGraph.Options.Base(Normal)'
  | 'PermanentGraph.Options.Base(Bek)'
  | 'PermanentGraph.Options.FirstParent'
  | 'PermanentGraph.Options.LinearBek'

/** 上游缺省那一档（`PermanentGraph.Options.Default`）。 */
export const DEFAULT_LOG_GRAPH_DISPLAY: LogGraphDisplayOption = 'PermanentGraph.Options.Base(Normal)'

/** 归一：当前状态对应上游 `GRAPH_OPTIONS` 的哪一个取值。 */
export function graphDisplayOptions(state: LogGraphOptionState): LogGraphDisplayOption {
  if (state.linearBek === true) return 'PermanentGraph.Options.LinearBek'
  if (state.firstParent) return 'PermanentGraph.Options.FirstParent'
  return state.sort === 'topological' ? 'PermanentGraph.Options.Base(Bek)' : DEFAULT_LOG_GRAPH_DISPLAY
}

export interface LogActionTitles { title: string; description: string; process: string }
export interface LogCollapseTitlePair { collapse: LogActionTitles; expand: LogActionTitles }

/**
 * 收起/展开那两条的文案，按 `GRAPH_OPTIONS` 是否为 LinearBek 二选一
 * （判据 `CollapseOrExpandGraphAction.java:58-67`，进度标题 `CollapseGraphAction.java:28-30`）。
 */
export function collapseActionTitles(state: LogGraphOptionState): LogCollapseTitlePair {
  const merges = state.linearBek === true
  return {
    collapse: merges
      ? { title: LOG_COLLAPSE_MERGES_TITLE, description: LOG_COLLAPSE_MERGES_DESCRIPTION, process: LOG_COLLAPSE_MERGES_PROCESS }
      : { title: LOG_COLLAPSE_TITLE, description: LOG_COLLAPSE_DESCRIPTION, process: LOG_COLLAPSE_PROCESS },
    expand: merges
      ? { title: LOG_EXPAND_MERGES_TITLE, description: LOG_EXPAND_MERGES_DESCRIPTION, process: LOG_EXPAND_MERGES_PROCESS }
      : { title: LOG_EXPAND_TITLE, description: LOG_EXPAND_DESCRIPTION, process: LOG_EXPAND_PROCESS },
  }
}

/** 缺省排序档（`PermanentGraph.Options.Default` 的那一档）。 */
export const DEFAULT_LOG_SORT: GitLogSort = 'date'

export interface LogGraphOptionRow {
  id: string
  /** 上游动作/模型 id，写在这儿免得以后有人凭手感改。 */
  action: string
  title: string
  description?: string
  /** 分组小标题（上游的 `Separator.create(...)`）。 */
  separator?: boolean
  /** `radio` = 互斥的一档（`SelectOptionsAction`），`checkbox` = 独立勾选（`NoMergesFilterAction`）。 */
  kind?: 'radio' | 'checkbox'
  /** 当前选中/开启态。 */
  on?: boolean
  /** 命令档（`CollapseGraphAction` 那种一次性动作，不是勾选）：`on` 对它没有意义。 */
  command?: boolean
  /** 上游 `action.process.*` 的长动作标题（`performLongAction` 进度条上那一行；随显示档换字）。 */
  process?: string
  /** 上游 `update()` 里 `setEnabled` 的那一半：没有可折叠的线性段时「收起」不可点。 */
  disabled?: boolean
  run?: () => void
}

export interface LogGraphOptionState {
  sort: GitLogSort
  firstParent: boolean
  noMerges: boolean
  /**
   * 「收起线性分支」的当前态（`Vcs.Log.CollapseAll` / `Vcs.Log.ExpandAll`，见 `LOG_GRAPH_OPTION_GAPS` 的说明）。
   * 上游把折叠记在**图上**（`CollapsedActionManager` 的 `CollapsedGraph`），不是 UI 属性 ⇒ 本仓也不存档，
   * 只在日志窗口这一次会话里留着。
   */
  collapsed?: boolean
  /** 现在这一页里有没有可收起的线性段（上游 `CollapseOrExpandGraphAction.update` 的 `isActionSupported(...)`）。 */
  canCollapse?: boolean
  /**
   * `PermanentGraph.Options.LinearBek`（`platform/vcs-log/graph-api/src/com/intellij/vcs/log/graph/PermanentGraph.kt:68`）。
   * 上游把它门在 Registry `vcs.log.linear.bek.sort` 后面且**默认关**（`util/BekUtil.java:13-15`）⇒
   * 出厂状态恒为 false；本仓也没有 BEK 线性化那一遍（见文件尾 `LOG_GRAPH_OPTION_GAPS`）。
   * 这一项存在的唯一理由是把「折叠已合并分支 / 展开已合并分支」那两条文案的**判据**接出来
   * （`CollapseOrExpandGraphAction.java:58-67` 就是按它换文字的），不是给用户的新勾选。
   */
  linearBek?: boolean
}

export interface LogGraphOptionActions {
  setSort: (sort: GitLogSort) => void
  setFirstParent: (value: boolean) => void
  setNoMerges: (value: boolean) => void
  setCollapsed: (value: boolean) => void
}

/**
 * 按上游顺序给出这一档的菜单。排序两档是**单选**（上游是 `ToggleAction` 家族里比较
 * `GRAPH_OPTIONS` 属性的 `SelectOptionsAction`），「无合并」是独立勾选。
 */
export function logGraphOptionsModel(state: LogGraphOptionState, actions: LogGraphOptionActions): LogGraphOptionRow[] {
  return [
    { id: 'sort', action: 'Sort', title: LOG_SORT_SEPARATOR, separator: true },
    { id: 'sort.date', action: 'PermanentGraph.Options.Base(Normal)', title: LOG_SORT_DATE,
      description: LOG_SORT_DATE_DESCRIPTION, kind: 'radio', on: state.sort === 'date', run: () => actions.setSort('date') },
    { id: 'sort.topological', action: 'PermanentGraph.Options.Base(Bek)', title: LOG_SORT_TOPOLOGICAL,
      description: LOG_SORT_TOPOLOGICAL_DESCRIPTION, kind: 'radio', on: state.sort === 'topological', run: () => actions.setSort('topological') },
    { id: 'options', action: 'Options', title: LOG_OPTIONS_SEPARATOR, separator: true },
    { id: 'firstParent', action: 'PermanentGraph.Options.FirstParent', title: FIRST_PARENT_TITLE,
      description: FIRST_PARENT_DESCRIPTION, kind: 'radio', on: state.firstParent, run: () => actions.setFirstParent(!state.firstParent) },
    { id: 'noMerges', action: 'VcsLogFilterObject.noMerges()', title: NO_MERGES_TITLE,
      kind: 'checkbox', on: state.noMerges, run: () => actions.setNoMerges(!state.noMerges) },
    // 上游最后一档：`ActionManager.getAction(VcsLogActionIds.BRANCH_ACTIONS_GROUP)`
    // （旧坐标写作 `VcsLogGraphOptionsChooserGroup.java:71` 并被锚点快照钉住；亲测该行现在是 `:72`
    //  —— 同一文件的 `:72` 就是那句 `actions.add(ActionManager...getAction(BRANCH_ACTIONS_GROUP))`。
    //  两个坐标都留着：改锚点快照要重算 `docs/inventory/citation-anchors.json`，12 路并行时不该由我发起。
    //  组定义 `intellij.platform.vcs.log.impl.xml:247-251`）。
    { id: 'branches', action: 'Vcs.Log.BranchActionsGroup', title: LOG_BRANCH_ACTIONS_SEPARATOR, separator: true },
    // 这两条的文字随 `GRAPH_OPTIONS` 换档（`CollapseOrExpandGraphAction.java:58-67`）：
    // LinearBek 关（出厂态）= 收起/展开线性分支，开 = 折叠/展开已合并分支。
    ...(() => {
      const titles = collapseActionTitles(state)
      return [
        {
          id: 'collapse', action: 'Vcs.Log.CollapseAll', title: titles.collapse.title, description: titles.collapse.description,
          process: titles.collapse.process, command: true, disabled: state.canCollapse === false, run: () => actions.setCollapsed(true),
        },
        {
          id: 'expand', action: 'Vcs.Log.ExpandAll', title: titles.expand.title, description: titles.expand.description,
          process: titles.expand.process, command: true, disabled: !state.collapsed, run: () => actions.setCollapsed(false),
        },
      ]
    })(),
  ]
}

/** 这一档在 `GitLogQuery` 上的落法：`date` 是缺省，不写；三个开关只有 true 才写。 */
export function graphOptionsQuery(state: LogGraphOptionState): Partial<GitLogQuery> {
  const patch: Partial<GitLogQuery> = {}
  if (state.sort !== DEFAULT_LOG_SORT) patch.sort = state.sort
  if (state.firstParent) patch.firstParent = true
  if (state.noMerges) patch.noMerges = true
  return patch
}

/** 从 query 反读这一档的状态（存档读回与渲染共用一份判据）。 */
export function graphOptionsState(query: GitLogQuery): LogGraphOptionState {
  return { sort: query.sort ?? DEFAULT_LOG_SORT, firstParent: query.firstParent === true, noMerges: query.noMerges === true }
}

/**
 * 有没有偏离缺省档（图标上那颗徽标的判据：`VcsLogGraphOptionsChooserGroup.hasNonDefaultOptions`
 * 的 `:101-106` —— 父项过滤器不是"匹配全部" ⇒ 算偏离，否则比 `GRAPH_OPTIONS != PermanentGraph.Options.Default`）。
 * 两条各自对：`noMerges` 对应前一半（父项过滤器），后一半走 `graphDisplayOptions()` 那条**单值**归一。
 */
export function hasNonDefaultGraphOptions(state: LogGraphOptionState): boolean {
  return state.noMerges || graphDisplayOptions(state) !== DEFAULT_LOG_GRAPH_DISPLAY
}

/**
 * 上游这一档里**本仓没接**的成员。判据逐条，不是「太复杂」：
 *
 *  · `graph.options.linear`（线性化合并）—— `VcsLogGraphOptionsChooserGroup.java:66` 的
 *    `if (BekUtil.isLinearBekEnabled())` 门着，而 `isLinearBekEnabled()` 要求 Registry
 *    `vcs.log.linear.bek.sort`（`util/BekUtil.java:13-15`）**默认关闭** ⇒ 出厂弹层里
 *    根本没有这一行。真要做的话它是 `PermanentGraph.Options.LinearBek`：纯显示层的
 *    重新排序，没有任何 git 旗标，本仓 `buildLogGraph` 没有 BEK 线性化那一遍，而且列表是
 *    `git log` 的一页、offset 记账在 `useVcsLogData`，重排会连带打乱分页与自动加载阈值。
 *
 *  · `Vcs.Log.BranchActionsGroup`（分支操作：收起/展开线性分支，
 *    `action.process.collapsing.linear.branches` / `action.process.expanding.linear.branches`）——
 *    **本批已接**（原登记为"不做"，理由写的是「折叠要有一层隐藏行的中间表示，本仓没有」。
 *    实际读上游 `CollapsedActionManager.java:214-241` 后核对：`COLLAPSE_ALL` 做的就是把
 *    上游 `LinearFragmentGenerator.getFragment`（`:126-166`，判据 = 下一排**收窄回一条道**，
 *    不是「单父 & 独子」）算出的那段**中间节点 hideNode**，`EXPAND_ALL` = `resetNodesVisibility()` ——
 *    作用域只在**已加载的那一页**上（`dataPack.getVisibleGraph()`），本仓同样只在已加载列表上做，
 *    等价物 = `src/vcsLogGraph.ts` 的 `collapseFragments()`（出口 `collapseLinearBranches()` + `collapsedLinearHashes()`。）
 */
export const LOG_GRAPH_OPTION_GAPS: ReadonlyArray<{ id: string; title: string; why: string }> = [
  { id: 'PermanentGraph.Options.LinearBek', title: '线性化合并', why: '上游门在 Registry vcs.log.linear.bek.sort（默认关）后面，出厂弹层里没有这一行；且它是纯显示层重排，没有 git 旗标，本仓分页记账也接不住' },
]
