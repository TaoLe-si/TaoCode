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
// | `Vcs.Log.CompactReferencesView` | 紧凑型引用视图 | ✅ 本批接住（原写 ❌，理由"本地没有第二套渲染"不成立：判据 `GraphCommitCellRenderer.kt:133-136` 把 `isCompact` 交给引用画师，本仓的 chip 列表同样能只取第一个 ⇒ 落点 `VcsLogTable.vue` 的 `visibleRefs`） |
// | `Vcs.Log.ShowLongEdges` | 长边 | ✅ 本批接住（原写 ❌，理由"跨行的长边没有中间表示"**与代码不符**：`vcsLogGraph.ts` 的 `pass` 行就是跨行表示。现在关档不再穿中间行，只在起点留一段竖线 ⇒ `buildLogGraph(list, { showLongEdges })`） |
// | `Vcs.Log.PreferCommitDate` | 提交时间戳 | ❌ 判据：日志行只有作者日期（`GitFullCommit.date`），提交日期只有"提交详情"里才有（`GitCommitDetails.committerDate`）—— 要做先让 native 的 `git.log` 一起回提交日期 |
// | `Vcs.Log.AlignLabels` | 左侧的引用 | ✅ 本批接住（原写 ❌。勾上 = 引用进**独立的对齐列**、消息不再被 chip 挤走，判据 `GraphCommitCellRenderer.kt:143-146` 的 `setLeftAligned` → 画师 `isLeftAligned`） |
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
/** `action.Vcs.Log.CompactReferencesView.text` / `.description`（中文包逐条对 key）。 */
export const LOG_COMPACT_REFERENCES_TITLE = '紧凑型引用视图'
export const LOG_COMPACT_REFERENCES_DESCRIPTION = '仅在表中显示提交的第一个引用'
/** `action.Vcs.Log.ShowLongEdges.text` / `.description`。 */
export const LOG_LONG_EDGES_TITLE = '长边'
export const LOG_LONG_EDGES_DESCRIPTION = '即使提交在当前视图中不可见，也显示长分支边。'
/** `action.Vcs.Log.AlignLabels.text` / `.description`（英文原文 References on the Left）。 */
export const LOG_ALIGN_LABELS_TITLE = '左侧的引用'
export const LOG_ALIGN_LABELS_DESCRIPTION = '在提交消息左侧显示引用'
/** `group.Vcs.Log.Diff.Preview.Location` 的两档：`action.Vcs.Log.MoveDiffPreviewTo{Bottom,Right}.text`。 */
export const LOG_PREVIEW_LOCATION_TITLE = '差异预览位置'
export const LOG_PREVIEW_BOTTOM_TITLE = '底部'
export const LOG_PREVIEW_BOTTOM_DESCRIPTION = '在底部找到差异预览'
export const LOG_PREVIEW_RIGHT_TITLE = '右侧'
export const LOG_PREVIEW_RIGHT_DESCRIPTION = '在右侧找到差异预览'
/** `action.Vcs.Log.ShowChangesFromParents.text` / `.description`。 */
export const LOG_CHANGES_FROM_PARENTS_TITLE = '显示对父项的更改'
export const LOG_CHANGES_FROM_PARENTS_DESCRIPTION = '分别显示对每个合并提交所做的更改'
/** `action.vcs.log.show.separator` = 显示（这一组上面的分隔小标题）。 */
export const LOG_SHOW_SEPARATOR = '显示'
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
  /**
   * `Table.CompactReferencesView`（`CommonUiProperties.java:14`）。上游缺省**开**
   * （`VcsLogApplicationSettings.kt:106-107` `isCompactReferenceView = true`）⇒ 表格里一个提交只画第一个引用。
   */
  compactReferences: boolean
  /** `Graph.ShowLongEdges`（`MainVcsLogUiProperties.java:16`，经 `VcsLogUiPropertiesImpl.kt:33` 读）：缺省开。 */
  showLongEdges: boolean
  /** `Table.LabelsLeftAligned`（`VcsLogApplicationSettings.kt:113-114` `isLabelsLeftAligned = false`）：缺省关。 */
  alignLabels: boolean
  /**
   * `Layout.DiffPreviewVerticalSplit`（缺省值在 `VcsLogApplicationSettings.kt:122`
   * `isDiffPreviewVerticalSplit = true`）：true = 预览在**下方**，false = 在**右侧**
   * （两档的文案就是 `action.Vcs.Log.MoveDiffPreviewToBottom.text` = 底部 / `…ToRight.text` = 右侧）。
   */
  diffPreviewAtBottom: boolean
  /** `Changes.ShowChangesFromParents`（`MainVcsLogUiProperties.java:20`，缺省关 `:116-117`）。 */
  showChangesFromParents: boolean
}

export interface LogPresentationActions {
  setShowTagNames: (value: boolean) => void
  toggleColumn: (column: LogColumn) => void
  setCompactReferences: (value: boolean) => void
  setShowLongEdges: (value: boolean) => void
  setAlignLabels: (value: boolean) => void
  setDiffPreviewAtBottom: (value: boolean) => void
  setShowChangesFromParents: (value: boolean) => void
}

/** 齿轮各项的上游缺省（`VcsLogApplicationSettings.kt:106-122` + `VcsLogUiPropertiesImpl.kt:33`）。 */
export const LOG_PRESENTATION_DEFAULTS = {
  compactReferences: true, showLongEdges: true, alignLabels: false, diffPreviewAtBottom: true,
  showChangesFromParents: false,
} as const

/**
 * 齿轮的菜单模型。`列` 与 `差异预览位置` 是**子组**（上游 `popup=true` 的组 / `DiffPreviewLocationActionGroup`），
 * 渲染器照本仓菜单的规矩把成员摊平/缩进。
 * 只给真能接住的行 —— 表里那几条不做的**不在**这里，避免出现点了没反应的勾选项。
 *
 * 顺序照上游 `group.Vcs.Log.PresentationSettings`（`intellij.platform.vcs.log.impl.xml:253-266`）：
 * 根名称 → 紧凑型引用视图 → 标签名称 → 长边 → 提交时间戳 → 左侧的引用 → 列 → 着色器；
 * `显示对父项的更改` 与 `差异预览位置` 在上游是同一支齿轮弹层里的邻居
 * （`intellij.platform.vcs.log.impl.xml:386-392`：ShowDetailsAction → ShowChangesFromParents →
 * ShowOnlyAffectedChanges → ShowDiffPreview → Diff.Preview.Location），本仓把它们排在同一弹层尾部。
 */
export function logPresentationModel(state: LogPresentationState, actions: LogPresentationActions): LogPresentationRow[] {
  return [
    {
      id: 'vcs.log.compactReferences',
      title: LOG_COMPACT_REFERENCES_TITLE,
      checked: state.compactReferences,
      run: () => actions.setCompactReferences(!state.compactReferences),
    },
    {
      id: 'vcs.log.showTagNames',
      title: LOG_TAG_NAMES_TITLE,
      checked: state.showTagNames,
      run: () => actions.setShowTagNames(!state.showTagNames),
    },
    {
      id: 'vcs.log.longEdges',
      title: LOG_LONG_EDGES_TITLE,
      checked: state.showLongEdges,
      run: () => actions.setShowLongEdges(!state.showLongEdges),
    },
    {
      id: 'vcs.log.alignLabels',
      title: LOG_ALIGN_LABELS_TITLE,
      checked: state.alignLabels,
      run: () => actions.setAlignLabels(!state.alignLabels),
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
    {
      id: 'vcs.log.changesFromParents',
      title: LOG_CHANGES_FROM_PARENTS_TITLE,
      checked: state.showChangesFromParents,
      run: () => actions.setShowChangesFromParents(!state.showChangesFromParents),
    },
    {
      id: 'vcs.log.diffPreviewLocation',
      title: LOG_PREVIEW_LOCATION_TITLE,
      group: true,
      children: [
        {
          id: 'vcs.log.diffPreview.bottom',
          title: LOG_PREVIEW_BOTTOM_TITLE,
          checked: state.diffPreviewAtBottom,
          run: () => actions.setDiffPreviewAtBottom(true),
        },
        {
          id: 'vcs.log.diffPreview.right',
          title: LOG_PREVIEW_RIGHT_TITLE,
          checked: !state.diffPreviewAtBottom,
          run: () => actions.setDiffPreviewAtBottom(false),
        },
      ],
    },
  ]
}

/** 上游那一组里**本仓没接**的成员（判据在文件头那张表；判据测试逐条核对这里）。 */
export const LOG_PRESENTATION_GAPS: ReadonlyArray<{ id: string; title: string; why: string }> = [
  { id: 'Vcs.Log.ShowRootsColumnAction', title: '根名称', why: '日志按仓库根分别打开 ⇒ hasMultiplePaths() 恒假，上游那条行也不会出现' },
  { id: 'Vcs.Log.PreferCommitDate', title: '提交时间戳', why: '日志行只有作者日期；提者日期要先让 native 的 git.log 一起回' },
  { id: 'Vcs.Log.HighlightersActionGroup', title: '着色器', why: '本地只按仓库根着色，没有按作者/日期的着色器族' },
]

/**
 * 一行上**要画出来的引用 chip**（`Vcs.Log.CompactReferencesView` + `Vcs.Log.ShowTagNames` 的合成判据）。
 *
 * 上游两档都落在提交列的画师上（`ui/render/GraphCommitCellRenderer.kt:133-141` → `referencePainter.isCompact` /
 * `.showTagNames`），而 `action.Vcs.Log.CompactReferencesView.description` 写死了语义 =
 * 「仅在表中显示提交的第一个引用」⇒ 紧凑档只取 `refs[0]`；非紧凑档全取。
 * 标签那一半照旧（`showTagNames === false` 时不画 tag 引用）。
 */
export function logRefsToShow<T extends { type: string }>(refs: readonly T[],
                                                          options: { showTagNames: boolean; compact: boolean }): T[] {
  const visible = options.showTagNames ? refs : refs.filter(ref => ref.type !== 'tag')
  return options.compact ? visible.slice(0, 1) : [...visible]
}

/**
 * 速度搜索要比的**列文本**（`VcsLogSpeedSearch.getColumnsForSpeedSearch()` = 可见列里的
 * `VcsLogMetadataColumn`，`log/ui/table/VcsLogSpeedSearch.java:60-66`；提交图/引用不是元数据列）。
 * 本仓的四个列里 `commit` 那列的主体是主题，另外三列 = 作者 / 日期 / 哈希。
 */
export interface LogSearchableRow { subject: string; author: string; date: string; hash: string; shortHash: string }
export function logSpeedSearchColumns(row: LogSearchableRow, hidden: readonly LogColumn[]): string[] {
  const values: Partial<Record<LogColumn, string>> = { commit: row.subject, author: row.author, date: row.date, hash: row.shortHash }
  return (['commit', 'author', 'date', 'hash'] as const)
    .filter(column => !hidden.includes(column))
    .map(column => values[column] ?? '')
}

/** 一行 tooltip 的料：`hash` = 行上显示的那条（短哈希），`fullHash` = 有详情时给完整哈希。 */
export interface LogTooltipRow { subject: string; author: string; date: string; hash: string; fullHash?: string }
/**
 * 一行的 tooltip 文本（`Vcs.Log.ShowTooltip` = `ShowCommitTooltipAction`，
 * `log/ui/actions/ShowCommitTooltipAction.java:37-45` → `table.showTooltip(row, Commit.INSTANCE)`；
 * 悬停与那一条动作走的是同一个 tooltip provider，所以这里出的就是同一份内容）。
 * 本仓没有上游那套 HTML tooltip 模板，用**纯文本三行**：主题 / 作者 + 日期 / 哈希 ——
 * 内容是"这一行本来就有的那几项"（提交列/作者列/日期列/哈希列），排法是本仓选择，已在报告里登记。
 */
export function logCommitTooltip(row: LogTooltipRow): string {
  return `${row.subject}\n${row.author}  ${row.date}\n${row.fullHash ?? row.hash}`
}
