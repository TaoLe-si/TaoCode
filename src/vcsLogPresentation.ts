// Git 日志窗口自己的「视图选项」齿轮 —— IDEA 日志工具条右角那个齿轮
// （`Vcs.Log.PresentationSettings`，`platform/vcs-log/impl/resources/intellij.platform.vcs.log.impl.xml:311-322`，
// 组文案 `VcsLogBundle.properties` 的 `group.Vcs.Log.PresentationSettings.text` = 视图选项）。
//
// 上游那一组的成员与**本仓有没有宿主**（逐条判过，判据见 `docs/ui-placement-audit.md` §AP）：
//
// | 上游成员 | 文案（随 IDE 发货的中文包） | 本仓 |
// |---|---|---|
// | `Vcs.Log.ShowTagNames` | 标签名称（描述：在表中显示标签名称） | ✅ 接住：项目设置 `vcsLog.showTagNames`（日志行本来就按它过滤 tag 引用） |
// | `group.Vcs.Log.ToggleColumns` | 列（描述：选择要在表中查看的列） | ✅ 接住：勾掉的列不画（`src/vcsLogColumns.ts` 的 `hiddenColumns`/`toggleColumn`）；成员 = **只有可动态隐藏的三列**（作者/日期/哈希），见下面 `LOG_DYNAMIC_COLUMNS` 那一段 |
// | `Vcs.Log.ShowRootsColumnAction` | 根名称 | ❌ 判据：`ShowRootsColumnAction.update` 里 `!table.getColorManager().hasMultiplePaths()` 就 `isEnabledAndVisible = false` —— 本仓的日志是**按仓库根分别打开**的（`<VcsLog :root=…>`），恒为单根 ⇒ 上游那条行本身也不会出现 |
// | `Vcs.Log.CompactReferencesView` | 紧凑型引用视图 | ✅ 本批接住（原写 ❌，理由"本地没有第二套渲染"不成立：判据 `GraphCommitCellRenderer.kt:133-136` 把 `isCompact` 交给引用画师，本仓的 chip 列表同样能只取第一个 ⇒ 落点 `VcsLogTable.vue` 的 `visibleRefs`）。**2026-10-06 vcslogdisp 补上剩下的两半**：chip 的次序与"第一个"是谁由 `GitLabelComparator`（`logRefGroups()` / `compareLogRefs()`）定，紧凑档少画的那些引用**留在同一个组里**、悬停 chip 区域照样看全（`logRefTooltip()`）；只差"引用串可用宽度 = 列宽 1/3"那一档（本仓的列宽在 `VcsLogColumns.vue` 里，见批次报告 §7） |
// | `Vcs.Log.ShowLongEdges` | 长边 | ✅ 本批接住（原写 ❌，理由"跨行的长边没有中间表示"**与代码不符**：`vcsLogGraph.ts` 的 `pass` 行就是跨行表示。现在关档不再穿中间行，只在起点留一段竖线 ⇒ `buildLogGraph(list, { showLongEdges })`） |
// | `Vcs.Log.PreferCommitDate` | 提交时间戳 | ✅ 接住：`git.logFull` 返回 `%cI`；表格日期格、搜索、复制和行 tooltip 共用所选日期，缺省关闭，日期列隐藏时禁用。 |
// | `Vcs.Log.AlignLabels` | 左侧的引用 | ✅ 本批接住（原写 ❌。勾上 = 引用进**独立的对齐列**、消息不再被 chip 挤走，判据 `GraphCommitCellRenderer.kt:143-146` 的 `setLeftAligned` → 画师 `isLeftAligned`） |
// | `Vcs.Log.HighlightersActionGroup` | （着色器组） | △ 只接住 `MERGE_COMMITS`；当前分支、索引提交、我的提交着色器仍未接 |
//
// `列` 与 `标签名称` 都**不是**新发明的语义：前者是上游同一组的成员，后者是既有项目设置的入口 ——
// 这一批只是把入口放到 IDEA 放的那一处（日志窗口自己的齿轮里），设置页那份仍然在。
//
// 日期列的「相对日期」那一档**不属于这一组**，所以这里没有给它勾选项行：上游把它放在 IDE 外观设置
// （`date.format.pretty` = "Use pretty formatting"，`DateTimeFormatConfigurable.kt:82-84`），日志的日期格只是它的
// 消费者（`VcsLogDefaultColumn.kt:176` → `DateFormatUtil.formatPrettyDateTime`）⇒ 落点在 `src/vcsLogDisplay.ts`，
// 缺省取上游出厂值（开），闸门入参等着设置页那一颗勾选项接。
// 逐条不做项登记在 `docs/source-todo.md` §11，模型在这里成表，判据逐条盯它。
import type { LogColumn } from './vcsLogColumns.ts'

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
/** `action.Vcs.Log.PreferCommitDate.text`。 */
export const LOG_COMMIT_DATE_TITLE = '提交时间戳'
/** `group.Vcs.Log.Diff.Preview.Location` 的两档：`action.Vcs.Log.MoveDiffPreviewTo{Bottom,Right}.text`。 */
export const LOG_PREVIEW_LOCATION_TITLE = '差异预览位置'
export const LOG_PREVIEW_BOTTOM_TITLE = '底部'
export const LOG_PREVIEW_BOTTOM_DESCRIPTION = '在底部找到差异预览'
export const LOG_PREVIEW_RIGHT_TITLE = '右侧'
export const LOG_PREVIEW_RIGHT_DESCRIPTION = '在右侧找到差异预览'
/** `action.Vcs.Log.ShowChangesFromParents.text` / `.description`。 */
export const LOG_CHANGES_FROM_PARENTS_TITLE = '显示对父项的更改'
export const LOG_CHANGES_FROM_PARENTS_DESCRIPTION = '分别显示对每个合并提交所做的更改'
/** `vcs.log.action.highlight.merge.commits` = `Merge Commits` in upstream `VcsLogBundle.properties:280`. */
export const LOG_MERGE_COMMITS_TITLE = 'Merge Commits'
/** `action.vcs.log.show.separator` = 显示（这一组上面的分隔小标题）。 */
export const LOG_SHOW_SEPARATOR = '显示'
/** `group.Vcs.Log.ToggleColumns.text` = 列。 */
export const LOG_COLUMNS_TITLE = '列'
/**
 * 「列」这一组的成员 = **可以被用户勾掉的**那些列。上游给的清单不是全部列，而是 `getDynamicColumns()`
 * （`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/ToggleLogColumnsActionGroup.java:48-51`
 * → `ui/table/column/VcsLogColumnUtil.kt:121-127`），它 = `getDefaultDynamicColumns()`
 * （`ui/table/column/VcsLogDefaultColumn.kt:43` = **Author / Hash / Date** 三个）+ 插件的自定义列，
 * 再按 `VcsLogColumn.isDynamic`（`ui/table/column/VcsLogColumn.kt:35`）过一遍 ——
 * `Root`（`VcsLogDefaultColumn.kt:59`，`isDynamic = false`）与 `Commit`（同文件 `:89` 第三个实参 `false`）
 * 都不进来。而且列序存档里 Root/Commit 是**强制补回**的（`VcsLogColumnUtil.kt:18-32` 的
 * `isValidColumnOrder` / `makeValidColumnOrder`）⇒ 上游根本没有「把提交列勾掉」这一档：提交列是那一行的主体，
 * 也是余量列（本仓 `fitColumns` 同一条口径，`src/vcsLogColumns.ts:29`）。
 * 本仓四列里因此只有这三条进齿轮（次序照上游那三个的写法 Author/Hash/Date）；`commit` 不画勾选项，
 * 旧存档里残留的 `commit` 由表格按「没勾」处理
 * （判据在 `tests/vcs-log-display.test.mjs`，留痕在那条测试的注释里；那条测试还钉住
 * `LOG_COLUMNS` 与本清单的差集正好是 `commit`，加列时不会漏）。
 */
export const LOG_DYNAMIC_COLUMNS: readonly LogColumn[] = ['author', 'hash', 'date']
/** 列名（本仓四个列的表头文案，与 `VcsLogColumns.vue` 的 `labels` 同源）。 */
export const LOG_COLUMN_TITLES: Record<LogColumn, string> = { commit: '提交', author: '作者', date: '日期', hash: '哈希' }

export interface LogPresentationRow {
  id: string
  title: string
  /** 勾选项才有（`BooleanPropertyToggleAction` 的选中态）。 */
  checked?: boolean
  disabled?: boolean
  run?: () => void
  /** 分组标题（`列` 那种 popup 组）。 */
  group?: boolean
  children?: LogPresentationRow[]
}

export interface LogPresentationState {
  /** 项目设置 `vcsLog.showTagNames`（缺省 true，与上游 `SHOW_TAG_NAMES` 的默认一致）。 */
  showTagNames: boolean
  /** `CommonUiProperties.PREFER_COMMIT_DATE`（应用级；`VcsLogApplicationSettings.kt:124-125`），缺省 false。 */
  preferCommitDate: boolean
  /** 勾掉（不画）的列。 */
  hidden: readonly LogColumn[]
  /**
   * `Table.CompactReferencesView`（`CommonUiProperties.java:14`）。上游缺省**开**
   * （`VcsLogApplicationSettings.kt:106-107` `isCompactReferenceView = true`）⇒ 表格里一个提交只画第一个引用。
   */
  compactReferences: boolean
  /**
   * `Graph.ShowLongEdges`（`MainVcsLogUiProperties.java:16`，经 `VcsLogUiPropertiesImpl.kt:33` 读）：**缺省关**。
   * 原写"缺省开"没有读过那份 State：`platform/vcs-log/impl/src/com/intellij/vcs/log/impl/VcsLogUiPropertiesImpl.kt:121-122`
   * 是 `@get:OptionTag("LONG_EDGES_VISIBLE") var isShowLongEdges = false`，图侧同名字段
   * `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/facade/VisibleGraphImpl.kt:35` 也是 false。
   */
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
  /** `MERGE_COMMITS`（`VcsLogUiPropertiesImpl.kt` 对缺失高亮状态默认 true）。 */
  highlightMergeCommits: boolean
}

export interface LogPresentationActions {
  setShowTagNames: (value: boolean) => void
  setPreferCommitDate: (value: boolean) => void
  toggleColumn: (column: LogColumn) => void
  setCompactReferences: (value: boolean) => void
  setShowLongEdges: (value: boolean) => void
  setAlignLabels: (value: boolean) => void
  setDiffPreviewAtBottom: (value: boolean) => void
  setShowChangesFromParents: (value: boolean) => void
  setHighlightMergeCommits: (value: boolean) => void
}

/**
 * 齿轮各项的上游缺省。应用级来自 `VcsLogApplicationSettings.kt:106-125`（紧凑引用 = 开、提交时间戳 = 关、
 * 左侧引用 = 关、差异预览在下方 = 开、对父项的更改 = 关），长边那一条来自
 * `platform/vcs-log/impl/src/com/intellij/vcs/log/impl/VcsLogUiPropertiesImpl.kt:121-122`（**关**：
 * `LONG_EDGES_VISIBLE` 不在 `VcsLogApplicationSettings` 的 `exists()` 名单里（同文件 `:78-90`），
 * 所以走每份日志自己的 State，那份出厂是 false）；高亮器缺失状态默认 true（`VcsLogUiPropertiesImpl.kt:30`）。
 * `showTagNames` 不在这里：它是**项目设置** `vcsLog.showTagNames`，出厂值在 native 的默认里
 * （上游 `VcsLogApplicationSettings.kt:109-110` 的 `isShowTagNames = false` 与本仓不一致，已另开接线请求）。
 */
export const LOG_PRESENTATION_DEFAULTS = {
  compactReferences: true, showLongEdges: false, preferCommitDate: false, alignLabels: false, diffPreviewAtBottom: true,
  showChangesFromParents: false, highlightMergeCommits: true,
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
      id: 'vcs.log.preferCommitDate',
      title: LOG_COMMIT_DATE_TITLE,
      checked: state.preferCommitDate,
      disabled: state.hidden.includes('date'),
      run: () => actions.setPreferCommitDate(!state.preferCommitDate),
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
      children: LOG_DYNAMIC_COLUMNS.map(column => ({
        id: `vcs.log.column.${column}`,
        title: LOG_COLUMN_TITLES[column],
        checked: !state.hidden.includes(column),
        run: () => actions.toggleColumn(column),
      })),
    },
    {
      id: 'vcs.log.highlighter.MERGE_COMMITS',
      title: LOG_MERGE_COMMITS_TITLE,
      checked: state.highlightMergeCommits,
      run: () => actions.setHighlightMergeCommits(!state.highlightMergeCommits),
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
  { id: 'Vcs.Log.HighlightersActionGroup', title: '着色器', why: '只接入 MERGE_COMMITS；CURRENT_BRANCH、INDEXED_COMMITS、MY_COMMITS 仍未接' },
]

/**
 * 一行的引用怎么排 —— `GitLabelComparator`（`plugins/git4idea/backend/src/log/GitRefManager.kt:190-216`）
 * 的档位表 `orderedTypes:191-200` = HEAD → CURRENT_BRANCH → MASTER → ORIGIN_MASTER → LOCAL_BRANCH →
 * REMOTE_BRANCH → TAG → OTHER（私有枚举 `RefType:172-180` 的**声明序**不是这个序，别照它排）。
 * 消费点 = `groupForTable:93-132` 的 `:96`（**先按它排序、再 `groupBy { it.type }`** ⇒ 表格里 chip 的次序、
 * 以及紧凑档"第一个"到底是谁，都是这一条定的）。
 */
export const LOG_REF_TIERS = ['head', 'currentBranch', 'master', 'originMaster', 'local', 'remote', 'tag', 'other'] as const
export type LogRefTier = typeof LOG_REF_TIERS[number]
/** 一行的引用（本仓 = `GitRef`，`src/vcsLogTypes.ts:9`）。 */
export interface LogRefLike { name: string; type: string }
/** `master`/`main` 与 `origin/master`/`origin/main` 是上游写死的四个名字（`GitRefManager.kt:279-282`）。 */
const MASTER_NAMES: readonly string[] = ['master', 'main']
const ORIGIN_MASTER_NAMES: readonly string[] = ['origin/master', 'origin/main']

/** `VcsRefType.isBranch` 的逐类型真值（`GitRefManager.kt:272/275/278` = true、`:281/284` = false）。 */
export function logRefIsBranch(ref: LogRefLike): boolean {
  return ref.type === 'head' || ref.type === 'local' || ref.type === 'remote'
}

/**
 * 归档（`GitRefComparator.getType:248-258` + `GitLabelComparator.getType:202-210`）。
 * `currentBranch` 那一档要**仓库的当前分支**（`:212-216` 读 `repository.currentBranch`）：
 * 本仓的真源是 `native/git.cpp:438-447`（`rev-parse --abbrev-ref HEAD`）经 `GitStatus.head` 出的那一份；
 * `useVcsLogData` 在日志首屏/刷新时读取它，由 `VcsLog.vue` 传给表格。本函数仍把它做成**入参闸门**：
 * 不给值 = 这一档不参与，其余七档照上游排。
 */
export function logRefTier(ref: LogRefLike, currentBranch?: string): LogRefTier {
  switch (ref.type) {
    case 'head': return 'head'
    case 'tag': return 'tag'
    case 'local':
      // 上游先按名字归 MASTER，再把「当前分支那一条」从 LOCAL/MASTER 升成 CURRENT_BRANCH（`:204-208`）。
      if (currentBranch && ref.name === currentBranch) return 'currentBranch'
      return MASTER_NAMES.includes(ref.name) ? 'master' : 'local'
    case 'remote':
      return ORIGIN_MASTER_NAMES.includes(ref.name) ? 'originMaster' : 'remote'
    default: return 'other'
  }
}

/** `Strings.compare(c1, c2, ignoreCase)`（`platform/util/base/src/com/intellij/openapi/util/text/Strings.java:45-67`）：
 *  先直接差；忽略大小写时比大写，大写也**不等**才比小写（Java 拿 `toLowerCase(toUpperCase(c))`，这里逐步照抄）。 */
function compareChars(ch1: string, ch2: string, ignoreCase: boolean): number {
  // `NaturalComparator.java:116-121` 的 transitivity fix：空格与 `' '`~`'0'` 之间那些字符（`! " # $ % & ' ( ) * + , - . /`）
  // 相遇时**空格算大**，否则传递性会断（注释里点名的就是这一族）。
  if (ch1 === ' ' && ch2 > ' ' && ch2 < '0') return 1
  if (ch2 === ' ' && ch1 > ' ' && ch1 < '0') return -1
  let d = ch1.charCodeAt(0) - ch2.charCodeAt(0)
  if (d === 0 || !ignoreCase) return d
  const u1 = ch1.toUpperCase(), u2 = ch2.toUpperCase()
  d = u1.charCodeAt(0) - u2.charCodeAt(0)
  if (d !== 0) d = u1.toLowerCase().charCodeAt(0) - u2.toLowerCase().charCodeAt(0)
  return d
}

function skipChar(text: string, start: number, end: number, ch: string): number {
  let index = start
  while (index < end && text[index] === ch) index++
  return index
}
function skipDigits(text: string, start: number, end: number): number {
  let index = start
  while (index < end && text[index]! >= '0' && text[index]! <= '9') index++
  return index
}
/** `compareCharRange`（`NaturalComparator.java:108-114`）：两段等长，逐 code unit 比。 */
function compareCharRange(s1: string, s2: string, offset1: number, offset2: number, end1: number): number {
  for (let i = offset1, j = offset2; i < end1; i++, j++) {
    const diff = s1.charCodeAt(i) - s2.charCodeAt(j)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * `NaturalComparator.naturalCompare(s1, s2, len1, len2, ignoreCase, likeFileNames)`
 * （`platform/util/base/src/com/intellij/openapi/util/text/NaturalComparator.java:37-106`）的忠实移植，
 * 只取 `GitReference.REFS_NAMES_COMPARATOR`（`plugins/git4idea/shared/src/git4idea/GitReference.kt:55`）
 * 真正走的那一档 = `ignoreCase = true, likeFileNames = false`（`compare:19-27` 传的就是这两个值）
 * ⇒ 上游 `likeFileNames` 那个分支（`:78-92`，`-`/`_` 的特例）本仓到不了，不移植。
 * 数字段四步（`:52-74`）：跳空格再跳前导零 ⇒ 先比**有效位数**、再逐位、再比**含前导零/空格的总长**、最后比前导部分；
 * 收尾三步（`:100-105`）：谁没走完谁大 ⇒ 长度差 ⇒ `ignoreCase` 时**再走一遍区分大小写**。
 * 与朴素 `localeCompare`/`<` 的可见差：`v2` 排在 `v10` **前面**（git 自己的 `%D` 是按 refname 字典序，会把 `v10` 排前面）。
 * 一处**如实登记的差异**：Java 的大小写映射是 char 级一对一（`ß` 不变），JS 的 `toUpperCase()` 可能展开成两个码元，
 * 这里取 `[0]` ⇒ 非 ASCII 的罕见引用名上序可能与上游不同；BMP 常规名字（含中文）逐步等价。
 */
function naturalCompare(s1: string, s2: string, ignoreCase: boolean): number {
  if (s1 === s2) return 0
  const length1 = s1.length, length2 = s2.length
  let i = 0, j = 0
  for (; i < length1 && j < length2; i++, j++) {
    const ch1 = s1[i]!, ch2 = s2[j]!
    if ((ch1 >= '0' && ch1 <= '9' || ch1 === ' ') && (ch2 >= '0' && ch2 <= '9' || ch2 === ' ')) {
      const start1 = skipChar(s1, skipChar(s1, i, length1, ' '), length1, '0')
      const start2 = skipChar(s2, skipChar(s2, j, length2, ' '), length2, '0')
      const end1 = skipDigits(s1, start1, length1)
      const end2 = skipDigits(s2, start2, length2)
      const lengthDiff = (end1 - start1) - (end2 - start2)
      if (lengthDiff !== 0) return lengthDiff
      const numberDiff = compareCharRange(s1, s2, start1, start2, end1)
      if (numberDiff !== 0) return numberDiff
      const fullLengthDiff = (end1 - i) - (end2 - j)
      if (fullLengthDiff !== 0) return fullLengthDiff
      const leadingDiff = compareCharRange(s1, s2, i, j, start1)
      if (leadingDiff !== 0) return leadingDiff
      i = end1 - 1
      j = end2 - 1
    }
    else {
      const diff = compareChars(ch1, ch2, ignoreCase)
      if (diff !== 0) return diff
    }
  }
  if (i < length1) return 1
  if (j < length2) return -1
  if (length1 !== length2) return length1 - length2
  return ignoreCase ? naturalCompare(s1, s2, false) : 0
}

/** 上游那条名字档比较器（`GitReference.REFS_NAMES_COMPARATOR` = `NaturalComparator.INSTANCE`）。 */
export function naturalCompareRefNames(a: string, b: string): number {
  if (a === b) return 0
  return naturalCompare(a, b, true)
}

/**
 * `GitRefComparator.compare:235-246` 的三步：档位差 ⇒ 名字（natural）⇒ **根**。
 * 第三步在本仓恒等于 0：日志是按仓库根分别打开的（`<VcsLog :root=…>`，见本文件头那张表的 `ShowRootsColumnAction` 一行），
 * 同一行的引用只有一个根。
 */
export function compareLogRefs(a: LogRefLike, b: LogRefLike, currentBranch?: string): number {
  const power1 = LOG_REF_TIERS.indexOf(logRefTier(a, currentBranch))
  const power2 = LOG_REF_TIERS.indexOf(logRefTier(b, currentBranch))
  if (power1 !== power2) return power1 - power2
  return naturalCompareRefNames(a.name, b.name)
}

/**
 * 一行的引用**组**（上游 `RefGroup`，`platform/vcs-log/api/src/com/intellij/vcs/log/RefGroup.java:14-33`）。
 * 组的画法 = `SimpleRefGroup.buildGroups`（`impl/SimpleRefGroup.kt:27-49`）：
 * 紧凑档把**所有**引用并进一个组（`:33-37`，组名 = `firstRef.type.isBranch || showTagNames ? firstRef.name : ""`）、
 * 非紧凑档里 `isBranch` 的类型**每个引用自己一组**、非分支类型（tag/other）**同类型并成一组**（`:43-48`）。
 * ⇒ 紧凑档只是**少画一枚 chip**，组里其余引用并没有消失：它们在表格里靠悬停 chip 那一块区域的
 * tooltip 看全（`GraphCommitCellRenderer.kt:84-103` → `LabelPainter.createTooltip:440-451` →
 * `TooltipReferencesPanel.java:35-56`），也照样参与颜色档（多引用组 = 同色两条带，`SimpleRefGroup.getColors:18-23`）。
 * 预组顺序沿用 `GitRefManager.groupForTable:103-114`：当前分支（若没被 tracked pair 吸收）在前，
 * 再按排序后的本地分支顺序放 tracked pair；HEAD 仅在 `isOnBranch` 为 false 时独立成警示组。
 */
export interface LogBranchTrackInfo { localBranch: string; remoteName: string; remoteBranch: string }
export interface LogRefGroup<T extends LogRefLike> { name: string; refs: T[]; warning?: boolean }

export const LOG_DETACHED_HEAD_LABEL = 'Detached HEAD'
export const LOG_DETACHED_HEAD_TOOLTIP = 'New commits may be lost because the current commit is not on any branch.\nCheck out a branch to avoid that.'

/**
 * `GraphCommitCellRenderer.getAvailableWidth()` (`GraphCommitCellRenderer.kt:274-287`):
 * the reference painter's width budget comes from the actual commit column, graph gutter,
 * and preferred commit-message width. These values are CSS pixels in this renderer.
 */
export function logRefAvailableWidth(commitColumnWidth: number, graphWidth: number,
                                     preferredTextWidth: number, compact: boolean): number {
  const textAndLabelsWidth = Math.trunc(commitColumnWidth) - Math.trunc(graphWidth)
  const freeSpace = textAndLabelsWidth - Math.ceil(preferredTextWidth)
  const allowedSpace = compact
    ? Math.min(freeSpace, Math.trunc(textAndLabelsWidth / 3))
    : Math.max(freeSpace, Math.max(Math.trunc(textAndLabelsWidth / 2), textAndLabelsWidth - 80))
  return Math.max(0, Math.trunc(allowedSpace))
}

export function logRefGroups<T extends LogRefLike>(refs: readonly T[],
                                                   options: { showTagNames: boolean; compact: boolean; currentBranch?: string;
                                                     branchTrackInfos?: readonly LogBranchTrackInfo[]; isOnBranch?: boolean }): LogRefGroup<T>[] {
  // 标签名称档照旧（`showTagNames === false` 时不画 tag 名字）；上游那一半是"组名给空串"，本仓沿用既有的"摘掉"口径。
  const visible = options.showTagNames ? [...refs] : refs.filter(ref => ref.type !== 'tag')
  if (visible.length === 0) return []
  const sorted = visible.sort((a, b) => compareLogRefs(a, b, options.currentBranch))
  // 上游先摘 HEAD，再用 Git config 的 tracked pair 预组，最后构造普通 RefGroup。
  const headRefs = sorted.filter(ref => ref.type === 'head')
  const rest = sorted.filter(ref => ref.type !== 'head')
  if (rest.length === 0) {
    if (headRefs.length && options.isOnBranch === false)
      return [{ name: LOG_DETACHED_HEAD_LABEL, refs: [...headRefs], warning: true }]
    return [{ name: headRefs[0]!.name, refs: [...headRefs] }]
  }

  const pairedRefs = new Set<T>()
  const trackedGroups: LogRefGroup<T>[] = []
  for (const localRef of rest) {
    if (localRef.type !== 'local') continue
    const trackInfo = options.branchTrackInfos?.find(info => info.localBranch === localRef.name)
    if (!trackInfo) continue
    const remoteRef = rest.find(ref => ref.type === 'remote' && ref.name === trackInfo.remoteBranch)
    if (!remoteRef) continue
    pairedRefs.add(localRef)
    pairedRefs.add(remoteRef)
    trackedGroups.push({ name: `${trackInfo.remoteName} & ${localRef.name}`, refs: [localRef, remoteRef] })
  }
  let remaining = rest.filter(ref => !pairedRefs.has(ref))
  const currentRef = remaining.find(ref => ref.type === 'local' && ref.name === options.currentBranch)
  const presetGroups: LogRefGroup<T>[] = currentRef
    ? [{ name: currentRef.name, refs: [currentRef] }, ...trackedGroups]
    : trackedGroups
  if (currentRef) remaining = remaining.filter(ref => ref !== currentRef)

  let groups: LogRefGroup<T>[]
  if (options.compact) {
    if (presetGroups.length) {
      groups = [{ name: presetGroups[0]!.name, refs: [...presetGroups.flatMap(group => group.refs), ...remaining] }]
    } else {
      const first = remaining[0]!
      groups = [{ name: logRefIsBranch(first) || options.showTagNames ? first.name : '', refs: [...remaining] }]
    }
  }
  else {
    groups = [...presetGroups]
    const buckets = new Map<string, T[]>()
    for (const ref of remaining) {
      if (logRefIsBranch(ref)) { groups.push({ name: ref.name, refs: [ref] }); continue }
      let bucket = buckets.get(ref.type)
      if (!bucket) {
        bucket = []
        buckets.set(ref.type, bucket)
        groups.push({ name: options.showTagNames ? ref.name : '', refs: bucket })
      }
      bucket.push(ref)
    }
  }

  if (headRefs.length && options.isOnBranch === false)
    groups.unshift({ name: LOG_DETACHED_HEAD_LABEL, refs: [...headRefs], warning: true })
  else if (headRefs.length && groups.length)
    groups[0]!.refs.unshift(...headRefs)
  else if (headRefs.length)
    groups.push({ name: headRefs[0]!.name, refs: [...headRefs] })
  return groups
}

/**
 * 悬停引用 chip 时的 tooltip（= 上游那一枚：`TooltipReferencesPanel.java:35-56`）。
 * 条数上限 `REFS_LIMIT = 10` 在同文件 `:36`；超出的一行 `... {0} more in details pane`
 * （`VcsLogBundle.properties:131`，基类 `ui/details/commit/ReferencesPanel.java:61-118` 算余数、`:120` 出那一行）。
 * 上游一行一个引用（同行内非最后一个后面补个 `,`，`ReferencesPanel.java:88-99`）⇒ 本仓的纯文本宿主同样一行一个，
 * 那个逗号在换行的宿主里是噪声，不搬。
 * Detached HEAD 组使用 IDEA `VcsLogBundle.properties:358-359` 原文；它不与普通 HEAD 引用 tooltip 混用.
 */
export const LOG_REF_TOOLTIP_LIMIT = 10
export function logRefTooltip(refs: readonly LogRefLike[], limit: number = LOG_REF_TOOLTIP_LIMIT): string {
  if (refs.length === 0) return ''
  const shown = refs.slice(0, limit).map(ref => ref.name)
  const rest = refs.length - shown.length
  return rest > 0 ? `${shown.join('\n')}\n… 还有 ${rest} 个（详见提交详情）` : shown.join('\n')
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

/**
 * 一行**复制**（Ctrl+C）出去是什么文本 —— 上游不是"复制修订号"那条动作，而是日志表格自己实现的
 * `CopySource.performCopy`（`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/table/VcsLogGraphTable.java:690-709`）：
 * 逐个选中行，把**看得见的每一列**的值用 `" "` 连起来，行与行之间 `"\n"`，Root 那一列整列给空串
 * （同文件 `:698-700`）。列值取的是模型 `getValueAt`，逐列是：
 *   · 提交列 = 主题（`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/render/GraphCommitCell.kt:23` 的 `toString() = text`）；
 *   · 作者列 = `ui/table/column/VcsLogDefaultColumn.kt:157`；日期列 = 同文件 `:172-176`；
 *   · 哈希列 = 同文件 `:204` 的 `toShortString()` ⇒ **短哈希**，不是完整 40 位。
 * 可见列的口径与速度搜索同一份（`getColumnsForSpeedSearch` `ui/table/VcsLogSpeedSearch.java:65-67`
 * 与 `performCopy` 用的 `getVisibleColumnIndices()` 在 Java 侧是同一个表格的可见列，四列都算
 * —— `Commit` 也是 `VcsLogMetadataColumn`，见 `ui/table/column/VcsLogDefaultColumn.kt:89-90`）。
 * 上游的 `isCopyEnabled` 还要求"至少选中一行"（`:717-719`）⇒ 组件那边空选不做任何事。
 */
export function logRowCopyText(row: LogSearchableRow, hidden: readonly LogColumn[]): string {
  return logSpeedSearchColumns(row, hidden).join(' ')
}

/** 多行 = 每行一条 `logRowCopyText`，按上游用 `"\n"` 串起来（同一文件 `:705`）。 */
export function logRowsCopyText(rows: readonly LogSearchableRow[], hidden: readonly LogColumn[]): string {
  return rows.map(row => logRowCopyText(row, hidden)).join('\n')
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
