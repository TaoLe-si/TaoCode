// 提交面板的「分组依据」（上游 `ChangesView.GroupBy` → `SelectChangesGroupingActionGroup`）。
//
// 上游形状（逐条核过）：
//   · 组名 `group.ChangesView.GroupBy.text` = 「分组依据」（`ActionsBundle.properties:2547`）；
//   · 组里那一条 `<separator key="...">` 就是这行标题，策略项由 `SelectChangesGroupingActionGroup`
//     动态填（`platform/vcs-impl/shared/resources/intellij.platform.vcs.impl.shared.xml:104-109`）；
//   · 三项与键位：`ChangesView.GroupBy.Directory` = 目录（`:134`，Ctrl+Alt+P，`$default.xml:1116-1117`）、
//     `ChangesView.GroupBy.Module` = 模块（`:135`，Ctrl+Alt+M，`:1119-1120`）、
//     `ChangesView.GroupBy.Repository` = 仓库（`:136`，dvcs-impl 注册）。
//
// **本仓只做「目录」这一档，理由逐条写清**（不做发明）：
//   · 「模块」要**模块模型**（`ModuleGroupingPolicy` 按 `ProjectFileIndex.getModuleForFile` 分组）——
//     本仓的文件与语言的关系由 LSP 管，工程里没有"模块"这一层（与 §B 里"来自源根的路径"同一条理由）；
//   · 「仓库」要**多仓库视图**（`RepositoryGroupingPolicy` 按 VCS root 分组，一个 root 一组）——
//     本仓的变更面板是"一个工作区 = 一个仓库"（`git.status` 以工作区根为仓库），
//     分出来永远只有一组，没有意义。
// 所以下拉里只有「不分组」与「目录」两项 —— **不列点了没反应的档**（全仓同一条纪律）。
//
// 目录分组的口径：按文件所在目录分组（`dir` 为工作区相对路径，顶层文件归 `''`），
// 组内按路径排序，组间按目录字典序 —— 与 IDEA `DirectoryGroupingPolicy` 的"按目录归堆"同义
// （它那边还要按包名层级建树，本仓两级就够：目录头 + 文件行）。

import type { GitChange } from './bridge'

/** 组名（`group.ChangesView.GroupBy.text`）。 */
export const GROUP_BY_LABEL = '分组依据'
/** `ChangesView.GroupBy.Directory.text`。 */
export const GROUP_BY_DIRECTORY = '目录'
/** 不分组那一档 —— 上游是"三条 toggle 全不选"，本仓把它显式写成一项，免得出现"空选择"。 */
export const GROUP_BY_NONE = '不分组'

export type ChangesGroupBy = 'none' | 'directory'

export const CHANGES_GROUP_BY_LABELS: Record<ChangesGroupBy, string> = {
  none: GROUP_BY_NONE,
  directory: GROUP_BY_DIRECTORY,
}

/** 一组变更（`dir` = 工作区相对目录；顶层文件是空串）。 */
export interface ChangeGroup {
  dir: string
  changes: GitChange[]
}

/** 一个文件所在目录（工作区相对路径，'/' 分隔；顶层文件返回空串）。 */
export function directoryOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

/**
 * 按目录归堆：组间按目录字典序（顶层 `''` 排最前），组内按路径排序。
 * `none` 档原样返回（一组，`dir` 为空）。
 */
export function groupChanges(changes: readonly GitChange[], by: ChangesGroupBy): ChangeGroup[] {
  if (by === 'none') return changes.length ? [{ dir: '', changes: [...changes] }] : []
  const groups = new Map<string, GitChange[]>()
  for (const change of changes) {
    const dir = directoryOf(change.path)
    const bucket = groups.get(dir)
    if (bucket) bucket.push(change)
    else groups.set(dir, [change])
  }
  return [...groups.entries()]
    .sort(([left], [right]) => (left === right ? 0 : left === '' ? -1 : right === '' ? 1 : left.localeCompare(right)))
    .map(([dir, list]) => ({ dir, changes: [...list].sort((a, b) => a.path.localeCompare(b.path)) }))
}
