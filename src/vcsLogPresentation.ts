// Git 日志窗口自己的「视图选项」齿轮 —— IDEA 日志工具条右角那个齿轮
// （`Vcs.Log.PresentationSettings`，`platform/vcs-log/impl/resources/intellij.platform.vcs.log.impl.xml:311-322`，
// 组文案 `VcsLogBundle.properties` 的 `group.Vcs.Log.PresentationSettings.text` = 视图选项）。
//
// 上游那一组的成员与**本仓有没有宿主**（逐条判过，判据见 `docs/ui-placement-audit.md` §AP）：
//
// | 上游成员 | 文案（随 IDE 发货的中文包） | 本仓 |
// |---|---|---|
// | `Vcs.Log.ShowTagNames` | 标签名称（描述：在表中显示标签名称） | ✅ 接住：项目设置 `vcsLog.showTagNames`（日志行本来就按它过滤 tag 引用） |
// | `group.Vcs.Log.ToggleColumns` | 列（描述：选择要在表中查看的列） | ✅ 接住：勾掉的列不画（`src/vcsLogColumns.ts` 的 `hiddenColumns`/`toggleColumn`） |
// | `Vcs.Log.ShowRootsColumnAction` | 根名称 | ❌ 判据：`ShowRootsColumnAction.update` 里 `!table.getColorManager().hasMultiplePaths()` 就 `isEnabledAndVisible = false` —— 本仓的日志是**按仓库根分别打开**的（`<VcsLog :root=…>`），恒为单根 ⇒ 上游那条行本身也不会出现 |
// | `Vcs.Log.CompactReferencesView` | 紧凑型引用视图 | ❌ 判据：本地日志行把引用画成一排 pill，没有"只显示第一个引用"的形态，做出来是另一套渲染 |
// | `Vcs.Log.ShowLongEdges` | 长边 | ❌ 判据：本地图只画相邻行的边（`buildLogGraph` 的 down/up/pass），跨行的长边没有中间表示 |
// | `Vcs.Log.PreferCommitDate` | 提交时间戳 | ❌ 判据：日志行只有作者日期（`GitFullCommit.date`），提交日期只有"提交详情"里才有（`GitCommitDetails.committerDate`）—— 要做先让 native 的 `git.log` 一起回提交日期 |
// | `Vcs.Log.AlignLabels` | 左侧的引用 | ❌ 判据：本地引用固定在提交消息**左侧**（`VcsLogTable` 的 `.commit-cell`），上游那个开关换的是标签排布，本地没有第二种排布 |
// | `Vcs.Log.HighlightersActionGroup` | （着色器组） | ❌ 判据：本地按仓库根着色（`rootColor`），没有"按作者/按日期"的着色器族 |
//
// `列` 与 `标签名称` 都**不是**新发明的语义：前者是上游同一组的成员，后者是既有项目设置的入口 ——
// 这一批只是把入口放到 IDEA 放的那一处（日志窗口自己的齿轮里），设置页那份仍然在。
// 逐条不做项登记在 `docs/source-todo.md` §11，模型在这里成表，判据逐条盯它。
import type { LogColumn } from './vcsLogColumns.ts'
import { LOG_COLUMNS } from './vcsLogColumns.ts'

/** `group.Vcs.Log.PresentationSettings.text` = 视图选项。 */
export const LOG_VIEW_OPTIONS_TITLE = '视图选项'
/** `action.Vcs.Log.ShowTagNames.text` = 标签名称。 */
export const LOG_TAG_NAMES_TITLE = '标签名称'
/** `group.Vcs.Log.ToggleColumns.text` = 列。 */
export const LOG_COLUMNS_TITLE = '列'
/** 列名（本仓四个列的表头文案，与 `VcsLogColumns.vue` 的 `labels` 同源）。 */
export const LOG_COLUMN_TITLES: Record<LogColumn, string> = { commit: '提交', author: '作者', date: '日期', hash: '哈希' }

export interface LogPresentationRow {
  id: string
  title: string
  /** 勾选项才有（`BooleanPropertyToggleAction` 的选中态）。 */
  checked?: boolean
  run?: () => void
  /** 分组标题（`列` 那种 popup 组）。 */
  group?: boolean
  children?: LogPresentationRow[]
}

export interface LogPresentationState {
  /** 项目设置 `vcsLog.showTagNames`（缺省 true，与上游 `SHOW_TAG_NAMES` 的默认一致）。 */
  showTagNames: boolean
  /** 勾掉（不画）的列。 */
  hidden: readonly LogColumn[]
}

export interface LogPresentationActions {
  setShowTagNames: (value: boolean) => void
  toggleColumn: (column: LogColumn) => void
}

/**
 * 齿轮的菜单模型。`列` 是**子组**（上游是 `popup=true` 的组），渲染器照本仓菜单的规矩把成员摊平/缩进。
 * 只给真能接住的行 —— 表里那四条不做的**不在**这里，避免出现点了没反应的勾选项。
 */
export function logPresentationModel(state: LogPresentationState, actions: LogPresentationActions): LogPresentationRow[] {
  return [
    {
      id: 'vcs.log.showTagNames',
      title: LOG_TAG_NAMES_TITLE,
      checked: state.showTagNames,
      run: () => actions.setShowTagNames(!state.showTagNames),
    },
    {
      id: 'vcs.log.columns',
      title: LOG_COLUMNS_TITLE,
      group: true,
      children: LOG_COLUMNS.map(column => ({
        id: `vcs.log.column.${column}`,
        title: LOG_COLUMN_TITLES[column],
        checked: !state.hidden.includes(column),
        run: () => actions.toggleColumn(column),
      })),
    },
  ]
}

/** 上游那一组里**本仓没接**的成员（判据在文件头那张表；判据测试逐条核对这里）。 */
export const LOG_PRESENTATION_GAPS: ReadonlyArray<{ id: string; title: string; why: string }> = [
  { id: 'Vcs.Log.ShowRootsColumnAction', title: '根名称', why: '日志按仓库根分别打开 ⇒ hasMultiplePaths() 恒假，上游那条行也不会出现' },
  { id: 'Vcs.Log.CompactReferencesView', title: '紧凑型引用视图', why: '本地引用是一排 pill，没有"只显示第一个引用"的第二套渲染' },
  { id: 'Vcs.Log.ShowLongEdges', title: '长边', why: '本地图只画相邻行的边，跨行长边没有中间表示' },
  { id: 'Vcs.Log.PreferCommitDate', title: '提交时间戳', why: '日志行只有作者日期；提者日期要先让 native 的 git.log 一起回' },
  { id: 'Vcs.Log.AlignLabels', title: '左侧的引用', why: '本地引用固定在提交消息左侧，没有第二种排布' },
  { id: 'Vcs.Log.HighlightersActionGroup', title: '着色器', why: '本地只按仓库根着色，没有按作者/日期的着色器族' },
]
