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
  run?: () => void
}

export interface LogGraphOptionState {
  sort: GitLogSort
  firstParent: boolean
  noMerges: boolean
}

export interface LogGraphOptionActions {
  setSort: (sort: GitLogSort) => void
  setFirstParent: (value: boolean) => void
  setNoMerges: (value: boolean) => void
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

/** 有没有偏离缺省档（`hasNonDefaultOptions` 的一半：`VcsLogGraphOptionsChooserGroup.java:101-106`）。 */
export function hasNonDefaultGraphOptions(state: LogGraphOptionState): boolean {
  return state.sort !== DEFAULT_LOG_SORT || state.firstParent || state.noMerges
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
 *  · `Vcs.Log.BranchActionsGroup`（分支操作：折叠/展开线性分支与合并，
 *    `action.process.collapsing.linear.branches` / `action.process.expanding.linear.branches`）——
 *    折叠要在**图**上记住哪些行被藏起来，展开还要能按需再取一段历史。本仓的图是
 *    `buildLogGraph` 对已加载那一页的一次性绘制，没有"隐藏行"这一层中间表示。
 */
export const LOG_GRAPH_OPTION_GAPS: ReadonlyArray<{ id: string; title: string; why: string }> = [
  { id: 'PermanentGraph.Options.LinearBek', title: '线性化合并', why: '上游门在 Registry vcs.log.linear.bek.sort（默认关）后面，出厂弹层里没有这一行；且它是纯显示层重排，没有 git 旗标，本仓分页记账也接不住' },
  { id: 'Vcs.Log.CollapseAll / ExpandAll', title: '分支操作', why: '折叠/展开要在图上有"隐藏行"中间表示并按需再取历史；本仓的图是对已加载一页的一次性绘制' },
]
