<script setup lang="ts">
// 问题面板 —— IDEA `ProblemsView` 的用户可见面（从 App.vue 的底部面板内联块搬出成为组件）。
//
// 上游行为：工具栏动作组在 `platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml:81-107`
// ——「Options」弹层（严重度多选过滤 `SeverityFiltersActionGroup` + 三个排序开关 + 按检查器分组）、
// QuickFixes、ShowPreview、ExpandAll、CollapseAll；树按所选取向折叠，点一行跳源位置。
// 本仓数据源是 LSP 诊断（`src/problems.ts` 的 `allProblems`），过滤/排序/分组规则在
// `src/problemsView.ts`（可单测），视图状态在 `src/problemsPanelState.ts`（可持久化）。
import { computed, ref, watch } from 'vue'
import { ChevronDown, ChevronRight, Copy, Group, ListFilter, Search, X } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'; import { IdeaCheckedIcon } from './icons/toolWindowIcons.ts'  // 勾选记号 = AllIcons.Actions.Checked
import type { ProblemRow } from '../problems'
import { severityClass, severityLabel } from '../problems'
import {
  filterProblems, focusRows, groupKeyOf, groupMuteKeys, groupProblems, groupTailOf, sortProblems,
  MUTABLE_GROUPINGS, PROBLEM_SEVERITIES, problemCounts, type ProblemGrouping,
} from '../problemsView'
// 检查结果导出（IDEA `codeInspection/export` 的 `ExportToHTMLAction`）：报告的纯生成在
// src/inspectionReport.ts，这里只负责选目录 + 落盘（走 app.writeExportFiles 的 .html 通道）。
import { request } from '../bridge'
import { inspectionReportFileName, inspectionReportHtml } from '../inspectionReport.ts'
// 错误树文本导出（IDEA 消息窗口的 Export to text file，`ErrorViewTextExporter`）：分桶 / 逐级缩进 /
// 「Show details」规则与「复制的那一串」（`performCopy` + `calcPrefix`）都在 src/errorTree.ts，
// 这里只负责选路径 + 落盘（.txt）与把当前分组递进去。
import { errorReportFileName, errorTreeCopyText, errorTreeText } from '../errorTree.ts'
// 新到的错误自动展开它所在的组（上游 `NewErrorTreeViewPanel.kt:357-360`），规则见 src/errorTree.ts。
import { trackErrorTreeExpansion } from '../errorTreeExpansion.ts'
// 面板工具栏上那几份「编辑器弹层」的编辑态与提交（忽略规则 / 纯文本覆盖清单 / 分析范围）住在
// src/problemsPanelEditors.ts：三者同一副形状（打开 → 改本地副本 → 提交回模块设置状态），
// 只碰设置状态、不碰问题表，面板因此只装配一次。
import { createProblemsPanelEditors } from '../problemsPanelEditors.ts'
// 逐文件高亮级别（上游 `HighlightingSettingsPerFile` 的 None/Syntax/Inspections，见
// src/highlightSettingsPerFile.ts）：菜单里按行设级别，聚合门控在 src/problems.ts。
import {
  clearHighlightLevels, highlightLevelEntries, highlightLevelForPath, HIGHLIGHTING_LEVELS,
  setHighlightLevelForPath, type HighlightingLevel,
} from '../highlightSettingsPerFile'
// 本地检查配置文件（上游 `InspectionProfile` 的启用/严重度覆盖，见 src/inspectionProfile.ts）：
// 逐检查项开关与严重度在下面的「检查配置…」弹层里编辑，聚合门控在 src/problems.ts。
import {
  currentProfileName, inspectionItems, profileNames, resetInspectionProfile, resetInspectionTool,
  setInspectionToolEnabled, setInspectionToolSeverity,
} from '../inspectionProfile'
// 检查项身份（(source, code, tags) → IDEA 的那个检查项）：行上的「未使用 / 已废弃」芯片、
// 组头的停用键都从这里取，见 src/inspectionIdentity.ts。
import { identityOfRow } from '../inspectionIdentity'
// 检查器的**描述富文档**（上游 `InspectionDescriptionDocumentationProvider` 一族）：
// 本地内置检查器（`src/junitInspections.ts` 那批）有说明，语言服务的规则名没有 ⇒ 那一节不渲染。
// 见 src/inspectionDescription.ts 与 tests/inspection-description.test.mjs。
import { inspectionDescriptionFor } from '../inspectionDescription.ts'
// 一条问题的「相关位置」（LSP `Diagnostic.relatedInformation`）：折叠规则在 src/problemRelatedInformation.ts，
// 宿主透传那一环已写进 docs/wiring-requests-2026-10-06-problems.md R1 —— 没数据时这一节不渲染。
import { relatedLocationText, relatedLocationsOf, type RelatedLocation } from '../problemRelatedInformation.ts'
// 配置档的工程级导入/导出（上游 `InspectionProjectProfileManager` 读 `.idea/inspectionProfiles/`，
// 见 src/inspectionProfileIo.ts；桥那一层在 src/inspectionProfileHost.ts）。这一段补的是
// `dm/inspections` 判词里「profile 的导入/导出（.xml）」那条缺：档不再只活在 localStorage 里。
import { PROFILE_DIR, loadProjectProfiles, saveCurrentProfileToProject, selectProfileOnDisk } from '../inspectionProfileIo.ts'
import { bridgeProfileDiskDeps } from '../inspectionProfileHost.ts'
// 本地抑制（上游 `SuppressIntentionAction` 在 ProblemsView 的行菜单里的形态，见
// src/localIntentions.ts + src/suppressIntention.ts）：逐行「抑制此检查」把注释写进文件，
// 写入后由 src/localSuppressions.ts 在 LSP 重发布之前先隐去该行。
import { alreadySuppressed, suppressOptionsFor } from '../suppressIntention.ts'
import { ruleIdFromMessage, suppressionEditFor, suppressionLanguageFor } from '../localIntentions.ts'
import { isLocallySuppressed, noteLocalSuppression, reconcileLocalSuppressions } from '../localSuppressions.ts'
// 意图预览（上游 intention/preview 一族，见 src/intentionPreview.ts）：快速修复与抑制条目
// 在菜单里先显示将改哪几行；LSP 条目只有编辑载荷，按编辑算对照。
import { previewOfEdits } from '../intentionPreview.ts'
// 行菜单那份意图列表（上游同一个 `IntentionListStep`）：两种对象怎么喂进规则、段标题与
// 「插入点算不出来」那一串都在 `src/intentionMenuModel.ts`，规则本体在 `src/intentionList.ts`。
import { UNSUPPRESSIBLE_PREVIEW, type MenuIntentionFix, type MenuIntentionOption } from '../intentionMenuModel.ts'
// 本地意图开关（上游 `IntentionManager` 的启用/停用面，见 src/intentionSettings.ts）。
import { intentionEntries, intentionSettings, resetIntentionSettings, setAllIntentionsEnabled, setIntentionEnabled } from '../intentionSettings'
// 面板视图状态持久化（分组/严重度/文本过滤，见 src/problemsPanelState.ts）。
import { loadProblemsPanelState, saveProblemsPanelState } from '../problemsPanelState'
import { copyToClipboard } from '../clipboard'
import { applyTextEdits } from '../editorText.ts'
import type { DocumentData, LspCodeActionResults, LspFormatResult, SaveResult } from '../bridge'
// 行菜单的锚定外壳（按实测尺寸夹到视口里，口径见 src/popupAnchor.ts）。
import AnchoredMenu from './AnchoredMenu.vue'
// 行菜单里那一份意图列表（修复 + 抑制两种行，档位顺序/分隔线/不可选三档都画在它里面）。
import IntentionListMenu from './IntentionListMenu.vue'

const props = defineProps<{ problems: ProblemRow[]; fixing: boolean; fixDisabled: boolean }>()
/**
 * `focusChange`：「只看某一组」的焦点态抛给宿主（状态栏）。
 * 上游把工具窗口的标题态画在别处（`ProblemsViewIconUpdater.java`，注册于
 * `platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml:62`），
 * 本仓的状态栏要显示「只看：〈组名〉」就得由面板把它抛出去 —— 焦点本身仍只活在会话内、不落存档
 * （理由见下面 `focus` 的注释）。事件形状是 `{ grouping, key, label }`（`null` = 没有焦点）；
 * 带 `grouping` 是因为同一个组键在不同分组档下含义不同（`src/problemsView.ts` 的 `groupKeyOf` 按档取键）。
 */
const emit = defineEmits<{
  reveal: [target: { path: string; line: number }]
  fixAll: []
  focusChange: [focus: { grouping: ProblemGrouping; key: string; label: string } | null]
}>()

// 视图状态初值来自上次会话（上游 `ProblemsViewState` 的工作区文件持久化，见 src/problemsPanelState.ts）。
const persisted = loadProblemsPanelState()
const hiddenSeverities = ref<number[]>(persisted.hiddenSeverities)
// 第三个排序开关（上游 `ProblemsViewState.kt:29` 默认 true，`ProblemsViewPanel.java:523-529` 与
// 另两个一起递进比较器）：本仓用它排「按目录」分组的组序，规则在 `src/problemsView.ts` 的
// `orderDirectoryGroups`（同层先子目录、后本层文件组）。
const sortFoldersFirst = ref(persisted.sortFoldersFirst)
const sortBySeverity = ref(persisted.sortBySeverity)
const sortByName = ref(persisted.sortByName)
const query = ref(persisted.query)
const grouping = ref<ProblemGrouping>(persisted.grouping)
const collapsedGroups = ref<string[]>(persisted.collapsedGroups)
watch([hiddenSeverities, sortFoldersFirst, sortBySeverity, sortByName, query, grouping, collapsedGroups], () =>
  saveProblemsPanelState({
    hiddenSeverities: hiddenSeverities.value, sortFoldersFirst: sortFoldersFirst.value,
    sortBySeverity: sortBySeverity.value,
    sortByName: sortByName.value, query: query.value, grouping: grouping.value,
    collapsedGroups: collapsedGroups.value,
  }))

// 「选项」弹层（上游 `ProblemsView.Options`：Show 段 = 严重度过滤，Sort by 段 = 排序开关）。
const optionsOpen = ref(false)
/**
 * 「只看某一组」的焦点（上游 `ProblemsView.Options` 里没有这一格，
 * `intellij.platform.problemView.ui.xml:82-99` 的 Options 只有严重度 + 三个排序开关 +
 * `ProblemsView.GroupByToolId`；本仓把上游"整族显隐"的两个形状
 * （`ProblemFilter.kt:62-75` 的「Show Other Problems」按一批严重度显隐、
 * `InspectionProfileImpl.java:804` 的按检查项停用）推广到分组维度的某一组，谓词本身仍是逐条问题的
 * （`ProblemFilter.kt:17-22` `(Problem) -> Boolean`）。
 * 上游的树选中态也不在 `ProblemsViewState` 里（`ProblemsViewState.kt:20-33` 是全字段清单，没有选中的组），
 * 所以这里同样只活在会话内、不落存档；换分组档就清掉，避免旧键把整张表过滤空。
 */
const focus = ref<{ key: string; label: string } | null>(null)
watch(grouping, () => { focus.value = null })
// 焦点态抛给宿主：状态栏那条「只看：〈组名〉」的提示需要它（面板里本来就在场，
// 但用户把面板滚到底/折起来时会误以为"问题变少了"）。上游把工具窗口的状态播报画在窗口外
// （`ProblemsViewIconUpdater.java`，注册于 `platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml:62`），
// 本仓对应的地方是状态栏；挂载点在 `src/App.vue`（保留文件）⇒ 接线请求 R2。
watch(focus, value => {
  emit('focusChange', value ? { grouping: grouping.value, key: value.key, label: value.label } : null)
}, { immediate: true })
const severityEntries = computed(() => PROBLEM_SEVERITIES.map(severity => ({
  severity, label: severityLabel(severity), shown: !hiddenSeverities.value.includes(severity),
})))
function toggleSeverity(severity: number) {
  const next = hiddenSeverities.value.includes(severity)
    ? hiddenSeverities.value.filter(value => value !== severity)
    : PROBLEM_SEVERITIES.filter(value => value === severity || hiddenSeverities.value.includes(value))
  hiddenSeverities.value = next
}
function showAllSeverities() { hiddenSeverities.value = [] }

// 组的展开态（上游树的展开/折叠；本仓把它落在可持久化的组键集合上，见 src/problemsPanelState.ts）。
function isCollapsed(key: string) { return collapsedGroups.value.includes(key) }
function toggleGroup(key: string) {
  collapsedGroups.value = isCollapsed(key)
    ? collapsedGroups.value.filter(value => value !== key)
    : [...collapsedGroups.value, key]
}
function collapseAll(groups: readonly { key: string }[]) { collapsedGroups.value = groups.map(group => group.key).filter(Boolean) }
function expandAll() { collapsedGroups.value = [] }
// 三类编辑器（忽略规则 / 纯文本覆盖 / 分析范围）的编辑态与提交都从工厂取，取出来即绑定：
// 模板里的 v-model 与按钮直接读写这些 ref，行为与它们原来长在面板里时逐字一致。
const {
  rulesOpen, rulesText, ignoredCount, saveRules, restoreAll, ignoreFile,
  overrideOpen, overriddenFiles, markPlainText, revertOverride, clearOverrides,
  scopeOpen, scopeIncludeText, scopeExcludeText, scopeLabel, saveScope, clearScope,
} = createProblemsPanelEditors()

// 本地抑制的即时隐藏（只在这里过滤，聚合表不动）：理由与对账口径见 src/localSuppressions.ts。
// 对账用**未过滤**的 props.problems：语言服务重算后真的不报了，记录就丢掉。
const visibleProblems = computed(() => props.problems.filter(row => !isLocallySuppressed(row)))
watch(() => props.problems, rows => reconcileLocalSuppressions(rows))

// 先按严重度/文本过滤 → 再按排序开关排 → 最后套用「只看某一组」的焦点（三段的顺序与
// 上游一致：过滤在建表时套（`ProblemsTreeModel` 用 `ProblemFilter` 谓词），排序在比较器里，
// 分组只是把已经排好的问题挂到组节点下）。
const sort = computed(() => ({
  sortFoldersFirst: sortFoldersFirst.value,
  sortBySeverity: sortBySeverity.value,
  sortByName: sortByName.value,
}))
const rows = computed(() => focusRows(sortProblems(
  filterProblems(visibleProblems.value, { hidden: hiddenSeverities.value, query: query.value }),
  sort.value), grouping.value, focus.value?.key ?? null))
const groups = computed(() => groupProblems(rows.value, grouping.value, sort.value))
/** 有可折叠的组吗（不分组时组键为空串，展开/折叠是空操作 —— 按钮置灰而不是做假动作）。 */
const hasGroups = computed(() => groups.value.some(group => group.key !== ''))
// 新到的错误把它所在的组自动展开（上游 `NewErrorTreeViewPanel.kt:357-360` "expand automatically
// only errors"；警告/提示/信息新到不展开）。规则与基线口径见 `src/errorTreeExpansion.ts`。
trackErrorTreeExpansion(() => rows.value, collapsedGroups, row => groupKeyOf(row, grouping.value))
/**
 * 整张可见表的三格计数（`problemCounts` 的生产消费点之一）：面板标题行的提示气泡。
 * 状态栏那一格读的是同一份（`src/App.vue` 的 `statusProblemCounts`，2026-10-06 落地
 * `docs/wiring-requests-2026-10-06-prob3.md` R1；就地 `filter(p => p.severity === 1)` 已由
 * `tests/problem-count-single-source.test.mjs` 钉死一处都不许留）。
 */
const tableCounts = computed(() => problemCounts(rows.value))
const tableCountsHint = computed(() =>
  `错误 ${tableCounts.value.errors} · 警告 ${tableCounts.value.warnings} · 信息 ${tableCounts.value.infos}`)
/** 折起来的组把 rows 清空（顺序稳定，折着就不渲染那些行）；count 始终是折叠前的条数。 */
const visibleGroups = computed(() => groups.value.map(group => ({
  key: group.key, label: group.label, count: group.rows.length,
  // 停用键用**折叠前**的整组算（折起来的组没有 rows，但仍然要能停用这一项）。
  muteKeys: groupMute.value ? muteKeysFor(group) : [],
  // 组头尾巴上的逐级计数（上游树节点尾巴那一串；规则、单级不补画的那条有意差异与判据
  // 都在 `src/problemsView.ts` 的 `groupTailOf`）。
  tail: groupTailOf(group.rows, grouping.value === 'severity'),
  rows: group.key && isCollapsed(group.key) ? [] : group.rows,
})))
function setFocus(group: { key: string; label: string }) {
  focus.value = focus.value?.key === group.key ? null : { key: group.key, label: group.label }
}

/**
 * 行上的「未使用 / 已废弃」芯片：LSP `Diagnostic.tags` 折出来的伪检查项
 * （上游 `LspDiagnosticsCustomizer.kt:93-96` → `HighlightInfoType.java:49-55` 注册的两档）。
 * 其余诊断没有这一格，返回 null 就不画（不做空芯片）。
 */
function kindChip(row: ProblemRow): string | null {
  return identityOfRow(row).kindLabel
}

// 一条问题的可读描述 = 错误树元素的复制文案（模型在 `src/errorTree.ts` 的 `errorTreeCopyText`，
// 上游 `NewErrorTreeViewPanel.kt:251-259` performCopy + `NewErrorTreeRenderer.java:227-239` calcPrefix）。
async function copyDescription(row: ProblemRow) {
  try {
    await copyToClipboard(errorTreeCopyText(row))
    actionNote.value = `已复制问题描述：${row.path}:${row.line + 1}`
  } catch (error) {
    actionNote.value = `复制失败：${error instanceof Error ? error.message : String(error)}`
  }
}

// 逐行菜单（上游 ProblemsView 右键菜单的可见面）：意图列表那一段（快速修复在前、抑制条目在后，
// 不可选的置灰）交给 `IntentionListMenu.vue`，另有高亮级别、忽略文件、纯文本覆盖。
// 位置按视口坐标由 AnchoredMenu 夹取。
const rowMenu = ref<{ row: ProblemRow; x: number; y: number } | null>(null)
const menuNote = ref('')
const menuLoading = ref(false)
const menuDoc = ref<DocumentData | null>(null)
const menuOptions = ref<MenuIntentionOption[]>([])
const menuFixes = ref<MenuIntentionFix[]>([])
/**
 * 行菜单里的「相关位置」= LSP `Diagnostic.relatedInformation`（一条问题的其它相关位置）。
 * 上游在 LSP 宿主侧**原样保留**这个字段（`platform/lsp-impl/src/impl/features/highlighting/LspDiagnosticAndLazyQuickFixes.kt:35-43`，
 * 其中 `:42` 就是 `this.relatedInformation = diagnostic.relatedInformation`），面板因此列得出它们。
 * 本仓的折叠规则（越界丢弃 / 去重 / 同文件与跨文件的排序）在 `src/problemRelatedInformation.ts`。
 *
 * 宿主那一环还没透传（`native/lsp_support.cpp` 的 `shape_diagnostics`、`src/bridge.ts` 的 `LspDiagnostic`），
 * 所以现在是空数组 ⇒ 这一节一行都不渲染。**不是假控件**：有数据才出现，
 * 接线请求（含可照抄实现）在 `docs/wiring-requests-2026-10-06-problems.md` R1。
 */
const menuRelated = computed<RelatedLocation[]>(() => {
  const row = rowMenu.value?.row
  return row ? relatedLocationsOf(row, row.related) : []
})
/** 点一条相关位置 = 跳到那个位置（与问题行本身的跳源同一条 `reveal` 通道，不另开一条）。 */
function revealRelated(loc: RelatedLocation) {
  emit('reveal', { path: loc.path, line: loc.line })
}
const menuLevel = computed<HighlightingLevel>(() => rowMenu.value ? highlightLevelForPath(rowMenu.value.row.path) : 'inspections')
/**
 * 这一行对应的检查器说明（上游 `InspectionDescriptionDocumentationProvider.generateDoc`
 * 在快速文档里给的那一段）。只有**本地内置**检查器有说明；语言服务的规则名返回 null
 * ⇒ 下面那一节整段不渲染（不编通用文案）。
 */
const menuInspectionDescription = computed(() => {
  const row = rowMenu.value?.row
  return row ? inspectionDescriptionFor(row.source, row.code) : null
})
const actionNote = ref('')

function closeRowMenu() { rowMenu.value = null }

/**
 * 面板里**当前聚焦的那一行** = 键盘用户的「选中」（行本身 `tabindex="0"`，Tab/方向键走位后聚焦即选中）。
 * 上游的对应物是树的选中节点：`ProblemsViewPanel.java:381` `protected TreePath getSelectedPath() { return myTree.getSelectionModel().getSelectionPath(); }`，
 * 动作从它取节点（`ProblemsViewPanel.java:393-399` `createActions(...)` 的 `getTreePathProblemNodes(path)`；
 * `ShowProblemsViewQuickFixesAction.kt:34` `event.getData(SELECTED_ITEM) as? ProblemNode`）。
 * 本仓没有树控件，聚焦就是选中的等价物；`openMenuForSelected()` 是给动作层的出口
 * （键位/动作注册在保留文件里 ⇒ `docs/wiring-requests-2026-10-06-problems.md` R1-panel）。
 */
const selectedRow = ref<ProblemRow | null>(null)
const selectedRowEl = ref<HTMLElement | null>(null)
function rememberSelectedRow(row: ProblemRow, event: FocusEvent) {
  selectedRow.value = row
  const target = event.currentTarget
  selectedRowEl.value = target instanceof HTMLElement ? target : null
}
function openMenuForSelected() {
  const row = selectedRow.value
  if (!row) return
  // 菜单锚在选中行的左下角（鼠标打开时锚在点击点，同一外壳 AnchoredMenu 负责夹进视口）。
  const rect = selectedRowEl.value?.getBoundingClientRect()
  void openRowMenu(row, { clientX: rect ? Math.round(rect.left + 24) : 0,
                          clientY: rect ? Math.round(rect.bottom) : 0 })
}
defineExpose({ openMenuForSelected })

async function openRowMenu(row: ProblemRow, event: MouseEvent | { clientX: number; clientY: number }) {
  // 鼠标打开菜单也算「选中这一行」（键盘路径走 `rememberSelectedRow`，两条路都更新同一个状态）。
  selectedRow.value = row
  rowMenu.value = { row, x: event.clientX, y: event.clientY }
  menuNote.value = ''
  menuDoc.value = null
  menuOptions.value = []
  menuFixes.value = []
  menuLoading.value = true
  try {
    const doc = await request<DocumentData>('file.read', { path: row.path })
    menuDoc.value = doc
    const lines = doc.content.split('\n')
    // 诊断码优先：语言服务给的 `code` 就是规则短名（eslint 的 ruleId、tsc 的错误号），
    // 正是 `// eslint-disable-line <rule>` / `//noinspection <id>` 要插的那一串；
    // 从消息里抠出来的规则号只做回退（本地检查那一路没有独立的 code，见 src/problems.ts）。
    const rule = row.code?.trim() || ruleIdFromMessage(row.message)
    const problem = { line: row.line, source: row.source ?? '', ...(rule ? { code: rule } : {}) }
    menuOptions.value = suppressOptionsFor(problem, suppressionLanguageFor(row.path))
      .filter(option => !alreadySuppressed(doc.content, row.line, option))
      .map(option => {
        const edit = suppressionEditFor(lines, row.line, option)
        // `unavailable` 非空 = 插入点算不出来 ⇒ 规则把这一行判成「列出来但不能选中」（见 src/intentionList.ts）。
        return { option, preview: edit ? edit.text.replace(/\n$/, '') : UNSUPPRESSIBLE_PREVIEW, unavailable: edit ? '' : UNSUPPRESSIBLE_PREVIEW }
      })
  } catch (error) {
    menuNote.value = error instanceof Error ? error.message : String(error)
  }
  try {
    const diagnostics = [{
      range: { start: { line: row.line, character: row.character }, end: { line: row.line, character: row.character } },
      severity: row.severity, message: row.message, ...(row.source ? { source: row.source } : {}),
    }]
    const result = await request<LspCodeActionResults>('lsp.request', {
      kind: 'codeAction', path: row.path, line: row.line, character: row.character, diagnostics,
    })
    const actions = result.actions ?? []
    // 预览要文件内容：本文件用刚读到的那份，其余被编辑的文件各读一次（读不到就落 unavailable）。
    const texts = new Map<string, string>()
    if (menuDoc.value) texts.set(row.path, menuDoc.value.content)
    for (const action of actions) for (const file of action.edits ?? []) {
      if (texts.has(file.path)) continue
      try { texts.set(file.path, (await request<DocumentData>('file.read', { path: file.path })).content) } catch { /* 预览标不可用 */ }
    }
    menuFixes.value = actions.map(action => ({
      action,
      preview: action.edits?.length ? previewOfEdits(action.edits, path => texts.get(path)) : null,
    }))
  } catch (error) {
    if (!menuNote.value) menuNote.value = error instanceof Error ? error.message : String(error)
  } finally {
    menuLoading.value = false
  }
}

async function applySuppression(entry: MenuIntentionOption) {
  const menu = rowMenu.value
  const doc = menuDoc.value
  if (!menu || !doc) return
  const edit = suppressionEditFor(doc.content.split('\n'), menu.row.line, entry.option)
  if (!edit) { menuNote.value = '行号越界，未写入。'; return }
  try {
    const next = applyTextEdits(doc.content, [edit])
    await request<SaveResult>('file.write', {
      path: menu.row.path, content: next, expectedVersion: doc.version, encoding: doc.encoding, bom: doc.bom, safeWrite: true,
    })
    // 写入后先本地隐去（LSP 重发布之前），把新内容告诉语言服务触发重算。
    noteLocalSuppression(menu.row)
    void request('lsp.change', { path: menu.row.path, text: next }).catch(() => undefined)
    actionNote.value = `已写入抑制：${entry.option.insertText}（第 ${menu.row.line + 1} 行）`
    rowMenu.value = null
  } catch (error) {
    menuNote.value = error instanceof Error ? error.message : String(error)
  }
}

async function applyMenuFix(fix: MenuIntentionFix) {
  const menu = rowMenu.value
  if (!menu) return
  const action = fix.action
  try {
    let edits = action.edits ?? []
    let executable = action.command === true
    if (!edits.length && action.resolvable) {
      const resolved = await request<LspFormatResult>('lsp.request', {
        kind: 'codeActionResolve', path: menu.row.path, line: 0, character: 0, index: action.index,
      })
      edits = resolved.edits ?? []
      executable = resolved.command === true
    }
    for (const file of edits) {
      const doc = file.path === menu.row.path && menuDoc.value
        ? menuDoc.value
        : await request<DocumentData>('file.read', { path: file.path })
      const next = applyTextEdits(doc.content, file.textEdits)
      if (next === doc.content) continue
      await request<SaveResult>('file.write', {
        path: file.path, content: next, expectedVersion: doc.version, encoding: doc.encoding, bom: doc.bom, safeWrite: true,
      })
      void request('lsp.change', { path: file.path, text: next }).catch(() => undefined)
    }
    if (executable) await request('lsp.request', {
      kind: 'executeCommand', path: menu.row.path, line: 0, character: 0, index: action.index,
    })
    actionNote.value = `已应用：${action.title}`
    rowMenu.value = null
  } catch (error) {
    menuNote.value = error instanceof Error ? error.message : String(error)
  }
}

// 三个工具栏弹层：高亮级别清单 / 检查配置（profile）/ 本地意图开关。
// 三个清单都读各自模块的 ref，改设置即重算（不需要额外的版本号）。
const levelOpen = ref(false)
const profileOpen = ref(false)
const intentOpen = ref(false)
const levelEntries = computed(() => highlightLevelEntries())
function setLevel(path: string, level: string) { setHighlightLevelForPath(path, level as HighlightingLevel) }
function resetLevels() { clearHighlightLevels() }
const profileItems = computed(() => inspectionItems(props.problems))
function toggleProfileItem(key: string, enabled: boolean) { setInspectionToolEnabled(key, enabled) }
function setProfileSeverity(key: string, value: string) {
  setInspectionToolSeverity(key, value === '' ? null : Number(value))
}
function resetProfile() { resetInspectionProfile() }
function resetProfileTool(key: string) { resetInspectionTool(key) }
// 组头的「停用此检查项」：只有能折出身份键的三档分组才给这个动作（file/directory/none 没有检查项可言，
// 不做点不动的假控件）。停用的落点就是「检查配置…」的那把键 —— 上游 profile 也按同一个
// `HighlightDisplayKey` 判启用（`InspectionProfileImpl.java:804`）。
// 键集合的算法在 src/problemsView.ts 的 `groupMuteKeys`（纯函数，可单测；为什么 `code` 档可能有多把键见那里）。
const groupMute = computed(() => MUTABLE_GROUPINGS.includes(grouping.value))
function muteKeysFor(group: { key: string; rows: readonly ProblemRow[] }): string[] {
  return groupMuteKeys(group, grouping.value)
}
function muteGroup(group: { key: string; label: string; rows: readonly ProblemRow[] }) {
  const keys = muteKeysFor(group)
  if (!keys.length) { actionNote.value = '这一组既无来源也无诊断码，没有可停用的检查项。'; return }
  for (const key of keys) setInspectionToolEnabled(key, false)
  actionNote.value = keys.length > 1
    ? `已停用这一组的 ${keys.length} 个检查项（${keys.join('、')}），在「检查配置…」里可恢复`
    : `已停用检查项：${group.label}（在「检查配置…」里可恢复）`
}

// —— 配置档的工程级落盘（`.taocode/inspectionProfiles/`，上游是 `.idea/inspectionProfiles/`）——
// 导入：把工程目录里的每份档读进来并按 profiles_settings.xml 切根档（坏档只记一条错，不整批丢）。
// 导出：把当前档写回工程目录（profile 本体 + 根选择两份）。
const profileDiskBusy = ref(false)
const profileDiskNote = ref('')
// 真桥由这里注入（src/inspectionProfileHost.ts 刻意不引桥，好让 node --test 能直接测它）。
const profileDiskDeps = bridgeProfileDiskDeps(request)
async function importProfileFromProject() {
  if (profileDiskBusy.value) return
  profileDiskBusy.value = true
  profileDiskNote.value = ''
  try {
    const outcome = await loadProjectProfiles(profileDiskDeps)
    const head = outcome.loaded.length
      ? `已导入 ${outcome.loaded.join('、')}`
      : `${PROFILE_DIR} 下没有可导入的配置档`
    const tail = outcome.errors.length
      ? `；${outcome.errors.length} 份没读进来（${outcome.errors[0]}）`
      : `，当前档 ${outcome.root}`
    profileDiskNote.value = head + tail
  } catch (error) {
    profileDiskNote.value = `导入失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    profileDiskBusy.value = false
  }
}
async function exportProfileToProject() {
  if (profileDiskBusy.value) return
  profileDiskBusy.value = true
  profileDiskNote.value = ''
  try {
    const written = await saveCurrentProfileToProject(profileDiskDeps)
    profileDiskNote.value = `已导出到 ${written.path}（${written.bytes} 字节）`
  } catch (error) {
    profileDiskNote.value = `导出失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    profileDiskBusy.value = false
  }
}
async function selectProfileOnProject(name: string) {
  if (profileDiskBusy.value) return
  profileDiskBusy.value = true
  profileDiskNote.value = ''
  try {
    const ok = await selectProfileOnDisk(profileDiskDeps, name)
    profileDiskNote.value = ok ? `当前档已切到 ${name}，并写进 profiles_settings.xml` : `切换失败：没有名为 ${name} 的配置档`
  } catch (error) {
    profileDiskNote.value = `切换失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    profileDiskBusy.value = false
  }
}
const profileNamesOnDisk = computed(() => profileNames())
const intentRows = computed(() => intentionEntries())
function toggleIntention(id: string, enabled: boolean) { setIntentionEnabled(id, enabled) }
function toggleAllIntentions(enabled: boolean) { setAllIntentionsEnabled(enabled) }
function resetIntentions() { resetIntentionSettings() }

// 导出报告（HTML）：IDEA 的 ExportToHTMLAction 作用在**全部检查结果**上，不是当前过滤视图 ——
// 这里保持同一口径（导 props.problems），避免"导出少了东西"这种不可见的偏差。
// 下面那个**文本**导出不是同一口径：上游的 `ErrorViewTextExporter` 拿的就是面板在显示的那份
// `ErrorViewStructure`（`NewErrorTreeViewPanel.kt:174`），跟着树走，见 `exportText`。
const exporting = ref(false)
const exportNote = ref('')
// 导出文本的「详情」开关 = 上游 `ErrorViewTextExporter.java:21/:27-28` 的那颗 `myCbShowDetails`
// （键 `checkbox.errortree.export.details` = "Details"，`IdeBundle.properties:143`；`:28` 缺省勾上，
// 不勾时 `:77-78` 跳过每条消息 —— 规则本体在 src/errorTree.ts，这里只是宿主）。
const exportDetails = ref(true)
async function exportReport() {
  if (!props.problems.length || exporting.value) return
  exporting.value = true
  exportNote.value = ''
  try {
    const directory = await request<string | null>('dialog.pickDirectory', { title: '选择检查报告输出目录', initial: '' })
    if (!directory) return
    const path = `${directory.replace(/[\\/]+$/, '')}/${inspectionReportFileName(new Date())}`
    const content = inspectionReportHtml(props.problems, { generatedAt: new Date() })
    await request('app.writeExportFiles', { files: [{ path, content }] })
    exportNote.value = `已导出 ${props.problems.length} 条问题：${path}`
  } catch (error) {
    exportNote.value = error instanceof Error ? error.message : String(error)
  } finally { exporting.value = false }
}
// 文本导出（上游 `ErrorViewTextExporter` + 消息窗口的 Export to text file）：导出的是**屏幕上那棵树** ——
// 上游那个 exporter 的构造参数就是面板在显示的 `ErrorViewStructure`（`NewErrorTreeViewPanel.kt:174`），
// 分组/缩进/「Show details」规则在 src/errorTree.ts。文件走保存对话框 + .txt 导出通道。
async function exportText() {
  if (!rows.value.length || exporting.value) return
  exporting.value = true
  exportNote.value = ''
  try {
    const target = await request<string | null>('dialog.saveFile', {
      title: '导出问题为文本', filters: [{ name: '文本文件', pattern: '*.txt' }], name: errorReportFileName(new Date()),
    })
    if (!target) return
    await request('app.writeExportFiles', { files: [{ path: target, content: errorTreeText(rows.value, { details: exportDetails.value, groups: groups.value }) }] })
    exportNote.value = `已导出 ${rows.value.length} 条问题为文本：${target}`
  } catch (error) {
    exportNote.value = error instanceof Error ? error.message : String(error)
  } finally { exporting.value = false }
}
</script>

<template>
  <div class="problems-panel">
    <div class="problems-toolbar">
      <!-- 「选项」弹层 = 上游 `ProblemsView.Options`（ui.xml:82-99）：Show 段 + Sort by 段。 -->
      <button class="subtle-button problems-options-toggle" aria-label="显示与排序选项" :aria-expanded="optionsOpen" @click="optionsOpen = !optionsOpen">
        <ListFilter :size="iconSize.inline" aria-hidden="true" />选项…
      </button>
      <!-- 分组下拉：上游是一个开关（`ProblemsViewState.kt:28` `groupByToolId`，默认关），
           动作项 `ProblemsView.GroupByToolId` 在「View Options」弹层最后一格
           （`intellij.platform.problemView.ui.xml:96-98`，图标 `AllIcons.ObjectBrowser.SortByType`），
           文案原文 `ActionsBundle.properties:2659` `action.ProblemsView.GroupByToolId.text=Group by Inspection`。
           本仓把开关与另几档合成一个下拉，图标取同一语义的 `Group`（上游弹层本身是
           `AllIcons.Actions.GroupBy`，ui.xml:82）。
           「按检查项」= 那个开关的等价物；「按诊断码」= 本仓用诊断码承接 tool id 的那一档
           （等价关系的论证见 src/problemsView.ts 与 docs/batch-2026-10-06-bucket2b2.md）。 -->
      <label class="problems-field">
        <Group :size="iconSize.inline" aria-hidden="true" />
        <select v-model="grouping" aria-label="分组方式">
          <option value="none">不分组</option>
          <option value="file">按文件</option>
          <option value="directory">按目录</option>
          <option value="source">按来源（检查器）</option>
          <option value="code">按诊断码</option>
          <option value="inspection">按检查项</option>
          <option value="severity">按严重级</option>
        </select>
      </label>
      <!-- 「只看某一组」的在场标记（点组头上的按钮进入，这里退出）。 -->
      <button v-if="focus" class="subtle-button problems-focus-chip"
              aria-label="取消只看这一组" @click="focus = null">
        <X :size="iconSize.chip" aria-hidden="true" />只看：{{ focus.label }}
      </button>
      <label class="problems-field problems-search">
        <Search :size="iconSize.inline" aria-hidden="true" />
        <input v-model="query" placeholder="过滤问题…" aria-label="过滤问题" spellcheck="false" />
      </label>
      <span class="problems-count" aria-live="polite">{{ rows.length }} / {{ problems.length }}{{ ignoredCount ? `（已忽略 ${ignoredCount} 个文件）` : '' }}</span>
      <!-- 展开/折叠（上游工具栏的 `ExpandAll`/`CollapseAll`，ui.xml:105-106）。没有分组时两个都是空操作。 -->
      <button class="subtle-button" :disabled="!hasGroups" @click="expandAll">展开全部</button>
      <button class="subtle-button" :disabled="!hasGroups" @click="collapseAll(groups)">折叠全部</button>
      <button class="subtle-button" :aria-expanded="rulesOpen" @click="rulesOpen = !rulesOpen">忽略规则…</button>
      <button class="subtle-button" :aria-expanded="overrideOpen" @click="overrideOpen = !overrideOpen">纯文本覆盖…{{ overriddenFiles.length ? `（${overriddenFiles.length}）` : '' }}</button>
      <button class="subtle-button" :aria-expanded="scopeOpen" @click="scopeOpen = !scopeOpen">分析范围…</button>
      <button class="subtle-button" :aria-expanded="levelOpen" @click="levelOpen = !levelOpen">高亮级别…{{ levelEntries.length ? `（${levelEntries.length}）` : '' }}</button>
      <button class="subtle-button" :aria-expanded="profileOpen" @click="profileOpen = !profileOpen">检查配置…{{ profileItems.length ? `（${profileItems.length}）` : '' }}</button>
      <button class="subtle-button" :aria-expanded="intentOpen" @click="intentOpen = !intentOpen">意图…</button>
      <button class="subtle-button" :disabled="fixing || fixDisabled || !problems.length" @click="emit('fixAll')">{{ fixing ? '修复中…' : '批量修复当前文件' }}</button>
      <button class="subtle-button" :disabled="exporting || !problems.length" @click="exportReport">{{ exporting ? '导出中…' : '导出报告…' }}</button>
      <button class="subtle-button" :disabled="exporting || !problems.length" @click="exportText">导出文本…</button>
      <label class="problems-profile-toggle"><input aria-label="导出时包含每条消息" type="checkbox" :checked="exportDetails" @change="exportDetails = ($event.target as HTMLInputElement).checked" /><span>详情</span></label>
    </div>
    <!-- 「选项」弹层内容（上游 `ProblemsView.Options`：Show 段 = 严重度复选，Sort by 段 = 排序开关）。 -->
    <div v-if="optionsOpen" class="problems-ignore-editor">
      <p class="problems-menu-title">显示</p>
      <div class="problems-profile-list">
        <label v-for="entry in severityEntries" :key="entry.severity" class="problems-profile-toggle">
          <input type="checkbox" :checked="entry.shown" @change="toggleSeverity(entry.severity)" />
          <span>{{ entry.label }}</span>
        </label>
      </div>
      <div class="problems-ignore-actions">
        <button class="subtle-button" :disabled="!hiddenSeverities.length" @click="showAllSeverities">全部显示</button>
        <button class="subtle-button" @click="optionsOpen = false">关闭</button>
      </div>
      <p class="problems-menu-title">排序</p>
      <label class="problems-profile-toggle">
        <input type="checkbox" :checked="sortFoldersFirst" @change="sortFoldersFirst = ($event.target as HTMLInputElement).checked" />
        <span>目录在前</span>
      </label>
      <label class="problems-profile-toggle">
        <input type="checkbox" :checked="sortBySeverity" @change="sortBySeverity = ($event.target as HTMLInputElement).checked" />
        <span>按严重度</span>
      </label>
      <label class="problems-profile-toggle">
        <input type="checkbox" :checked="sortByName" @change="sortByName = ($event.target as HTMLInputElement).checked" />
        <span>按名称</span>
      </label>
    </div>
    <p v-if="exportNote" class="problems-export-note" role="status">{{ exportNote }}</p>
    <p v-if="actionNote" class="problems-export-note" role="status">{{ actionNote }}</p>
    <!-- 忽略规则编辑（上游 `AnalysisIgnoreFileWriter` 的写入面）：保存后问题表即时重算。 -->
    <div v-if="rulesOpen" class="problems-ignore-editor">
      <textarea v-model="rulesText" rows="3" spellcheck="false" aria-label="分析忽略规则" placeholder="例如：**/generated/**&#10;*.min.js&#10;# 注释行会被忽略" />
      <div class="problems-ignore-actions">
        <button class="subtle-button" @click="saveRules">保存规则并重算</button>
        <button class="subtle-button" @click="restoreAll">恢复全部（清空文件与规则）</button>
        <button class="subtle-button" @click="rulesOpen = false">取消</button>
      </div>
    </div>
    <!-- 分析范围（上游 `BaseAnalysisActionDialog` 的范围选择；`AnalysisScope.PROJECT` = 两行都空）。 -->
    <div v-if="scopeOpen" class="problems-ignore-editor">
      <label class="problems-scope-field"><span>包含（每行一条 glob，空 = 全部）</span>
        <textarea v-model="scopeIncludeText" rows="2" spellcheck="false" aria-label="分析范围包含模式" placeholder="例如：src/**&#10;*.ts" /></label>
      <label class="problems-scope-field"><span>排除（exclude 优先）</span>
        <textarea v-model="scopeExcludeText" rows="2" spellcheck="false" aria-label="分析范围排除模式" placeholder="例如：**/generated/**&#10;build/**" /></label>
      <div class="problems-ignore-actions">
        <span class="problems-count">当前：{{ scopeLabel }}</span>
        <button class="subtle-button" @click="saveScope">保存范围</button>
        <button class="subtle-button" @click="clearScope">重置为全部项目</button>
        <button class="subtle-button" @click="scopeOpen = false">取消</button>
      </div>
    </div>
    <!-- 纯文本覆盖清单（上游 `PersistentFileSetManager` 的可见面 + `ReverteOverrideFileTypeAction`）。 -->
    <div v-if="overrideOpen" class="problems-ignore-editor">
      <p v-if="!overriddenFiles.length" class="field-hint">还没有覆盖的文件。</p>
      <div v-else class="problems-override-list">
        <span v-for="path in overriddenFiles" :key="path" class="problems-override-row"><span class="ref-path" :title="path">{{ path }}</span><button class="subtle-button" :title="`恢复 ${path} 的文件类型`" @click="revertOverride(path)">恢复</button></span>
      </div>
      <div class="problems-ignore-actions">
        <button class="subtle-button" :disabled="!overriddenFiles.length" @click="clearOverrides">恢复全部</button>
        <button class="subtle-button" @click="overrideOpen = false">关闭</button>
      </div>
    </div>
    <!-- 逐文件高亮级别清单（上游 `HighlightingSettingsPerFile` 的覆盖表 + Revert）。 -->
    <div v-if="levelOpen" class="problems-ignore-editor">
      <p v-if="!levelEntries.length" class="field-hint">还没有逐文件覆盖。</p>
      <div v-else class="problems-profile-list">
        <span v-for="entry in levelEntries" :key="entry.path" class="problems-override-row">
          <span class="ref-path" :title="entry.path">{{ entry.path }}</span>
          <select :value="entry.level" aria-label="高亮级别" @change="setLevel(entry.path, ($event.target as HTMLSelectElement).value)">
            <option v-for="option in HIGHLIGHTING_LEVELS" :key="option.id" :value="option.id">{{ option.label }}</option>
          </select>
        </span>
      </div>
      <div class="problems-ignore-actions">
        <button class="subtle-button" :disabled="!levelEntries.length" @click="resetLevels">全部恢复默认</button>
        <button class="subtle-button" @click="levelOpen = false">关闭</button>
      </div>
    </div>
    <!-- 本地检查配置（上游 `InspectionProfile` 的逐检查项启用/严重度覆盖；停用的检查项不落表）。
         粒度 = 检查项身份（`检查器::诊断码`，tags 那两档单列），与问题视图的分组键同一把。 -->
    <div v-if="profileOpen" class="problems-ignore-editor">
      <p v-if="!profileItems.length" class="field-hint">当前没有问题。</p>
      <div v-else class="problems-profile-list">
        <span v-for="entry in profileItems" :key="entry.key || '(none)'" class="problems-override-row">
          <label class="problems-profile-toggle" :title="entry.source ? `检查器 ${entry.source}${entry.code ? ` · 诊断码 ${entry.code}` : ''}` : entry.label">
            <input type="checkbox" :checked="entry.setting.enabled && !entry.disabledBy" @change="toggleProfileItem(entry.key, ($event.target as HTMLInputElement).checked)" />
            <span class="ref-path">{{ entry.label }}</span>
          </label>
          <span class="problems-count" :title="entry.disabledBy ? `随 ${entry.disabledBy} 一起停用` : ''">{{ entry.count }}</span>
          <select :value="entry.setting.severity ?? ''" aria-label="严重度覆盖" @change="setProfileSeverity(entry.key, ($event.target as HTMLSelectElement).value)">
            <option value="">按服务端</option><option :value="1">错误</option><option :value="2">警告</option><option :value="3">提示</option><option :value="4">信息</option>
          </select>
          <button class="subtle-button" :disabled="entry.setting.enabled && entry.setting.severity === null" :title="`${entry.label} 恢复默认`" @click="resetProfileTool(entry.key)">恢复</button>
        </span>
      </div>
      <div class="problems-ignore-actions">
        <button class="subtle-button" :disabled="!profileItems.length" @click="resetProfile">全部恢复默认</button>
        <button class="subtle-button" @click="profileOpen = false">关闭</button>
      </div>
      <!-- 配置档的工程级落盘：上游 InspectionProfileManager 的工程目录（.idea/inspectionProfiles/），
           本仓用 .taocode/inspectionProfiles/。导入读回并按 profiles_settings.xml 切根档。 -->
      <div class="problems-ignore-actions">
        <select :value="currentProfileName()" aria-label="配置档" @change="selectProfileOnProject(($event.target as HTMLSelectElement).value)">
          <option v-for="name in profileNamesOnDisk" :key="name" :value="name">{{ name }}</option>
        </select>
        <button class="subtle-button" :disabled="profileDiskBusy" @click="importProfileFromProject">从工程目录导入…</button>
        <button class="subtle-button" :disabled="profileDiskBusy" @click="exportProfileToProject">导出到工程目录…</button>
      </div>
      <p v-if="profileDiskNote" class="field-hint">{{ profileDiskNote }}</p>
    </div>
    <!-- 本地意图开关（上游 `IntentionManager` 的启用/停用清单的可见面）。 -->
    <div v-if="intentOpen" class="problems-ignore-editor">
      <label class="problems-profile-toggle">
        <input type="checkbox" :checked="intentionSettings.enabled" @change="toggleAllIntentions(($event.target as HTMLInputElement).checked)" />
        <span>显示本地抑制条目</span>
      </label>
      <div class="problems-profile-list">
        <label v-for="entry in intentRows" :key="entry.id" class="problems-profile-toggle" :title="`${entry.group}：${entry.title}`">
          <input type="checkbox" :checked="entry.enabled" @change="toggleIntention(entry.id, ($event.target as HTMLInputElement).checked)" />
          <span>{{ entry.group }} · {{ entry.title }}</span>
        </label>
      </div>
      <div class="problems-ignore-actions">
        <button class="subtle-button" @click="resetIntentions">恢复默认</button>
        <button class="subtle-button" @click="intentOpen = false">关闭</button>
      </div>
    </div>
    <div class="problems-list" role="list" aria-label="问题">
      <p v-if="!problems.length" class="ref-empty">没有问题。</p>
      <p v-else-if="!rows.length" class="ref-empty">没有匹配过滤条件的问题。</p>
      <template v-for="group in visibleGroups" :key="group.key || '(all)'">
        <!-- 组头 = 上游的 GroupNode：可折叠（`ProblemsViewGroupNode` + `DefaultTreeExpander`），
             折起时仍显示条数（上游的展开箭头就是这一行的 affordance）。
             「停用此检查项」只在按检查项/来源/诊断码分组时出现，落点是 profile 的同一把键
             （上游 profile 的启停粒度：`InspectionProfileImpl.java:804`）。
             「只看这一组」= 本仓把上游的逐条可见性谓词（`ProblemFilter.kt:17-22`）套到某一组上；
             未分组的那批（诊断码档里没码的行，上游同样不给组节点，
             `ProblemsViewHighlightingChildrenBuilder.kt:56-61`）没有组头，也就不给这两个按钮。 -->
        <div v-if="group.label" class="problems-group-row">
          <button class="problems-group" :class="{ collapsed: !group.rows.length }" :aria-expanded="Boolean(group.rows.length)" @click="toggleGroup(group.key)">
            <span class="problems-group-caret"><ChevronDown v-if="group.rows.length" :size="iconSize.chip" aria-hidden="true" /><ChevronRight v-else :size="iconSize.chip" aria-hidden="true" /></span>
            <span class="problems-group-label">{{ group.label }}</span>
            <span class="problems-group-count">{{ group.count }}</span>
            <!-- 组内混了多级别时的逐级计数（形状 = 上游树节点尾巴那一串，规则见
                 src/problemsView.ts 的 problemTailCounts；ERROR 那格用已有的 `.sev-error`
                 令牌上色，对应上游 `InspectionTreeTailRenderer.java:63-65` 的 TREE_RED/TREE_GRAY 两档）。 -->
            <span v-for="entry in group.tail" :key="entry.id" class="problems-group-count" :class="entry.error ? 'sev-error' : undefined">{{ entry.text }}</span>
          </button>
          <button class="subtle-button problems-group-focus" :aria-pressed="focus?.key === group.key" @click="setFocus(group)">
            <ListFilter :size="iconSize.chip" aria-hidden="true" />只看这一组
          </button>
          <button v-if="group.muteKeys.length" class="subtle-button problems-group-mute" @click="muteGroup(group)">停用此检查项</button>
        </div>
        <div v-for="(p, index) in group.rows" :key="`${p.path}:${p.line}:${p.character}:${index}`" class="ref-item problem-row" role="button" tabindex="0" @focusin="rememberSelectedRow(p, $event)" @click="emit('reveal', { path: p.path, line: p.line })" @keydown.enter.prevent="emit('reveal', { path: p.path, line: p.line })"><span class="problem-sev" :class="severityClass(p.severity)">{{ severityLabel(p.severity) }}</span><span class="ref-path" :title="p.path">{{ p.path }}</span><span class="ref-pos">{{ p.line + 1 }}:{{ p.character + 1 }}</span><span class="problem-msg">{{ p.message }}</span><span v-if="p.source" class="problem-src" :title="p.code ? `检查项 ${identityOfRow(p).displayName}` : `检查器 ${p.source}`">{{ p.source }}</span><span v-if="kindChip(p)" class="problem-kind">{{ kindChip(p) }}</span><span class="problem-actions"><button class="problem-ignore" @click.stop="openRowMenu(p, $event)">操作<ChevronDown :size="iconSize.chip" aria-hidden="true" /></button></span></div>
      </template>
    </div>
    <!-- 行菜单（上游 ProblemsView 右键菜单的行动作）：背景层只负责点外面/Esc 关闭。 -->
    <div v-if="rowMenu" class="tree-menu-backdrop" @click.self="closeRowMenu" @keydown.esc="closeRowMenu">
      <AnchoredMenu :x="rowMenu.x" :y="rowMenu.y">
        <p class="problems-menu-scope">{{ rowMenu.row.path }}:{{ rowMenu.row.line + 1 }} · {{ severityLabel(rowMenu.row.severity) }}</p>
        <p v-if="menuLoading" class="problems-menu-note">正在取快速修复…</p>
        <p v-if="menuNote" class="problems-menu-note">{{ menuNote }}</p>
        <!-- 相关位置（LSP `Diagnostic.relatedInformation`）：一条问题带的其它位置，点一条跳过去
             （走面板已有的 `reveal` 通道，与问题行本身的跳源同一条）。
             这一节**只在有条目时出现**（宿主还没透传这个字段 ⇒ 现在恒空 ⇒ 一行都不渲染，
             不是假控件；上游在 LSP 宿主侧是原样保留的，`LspDiagnosticAndLazyQuickFixes.kt:42`）。 -->
        <template v-if="menuRelated.length">
          <p class="problems-menu-title">相关位置（{{ menuRelated.length }}）</p>
          <button v-for="(loc, li) in menuRelated" :key="`${loc.path}:${loc.line}:${loc.character}:${li}`"
                  class="problems-menu-item" :title="`跳到第 ${loc.line + 1} 行（${loc.path}）`"
                  @click="revealRelated(loc); closeRowMenu()">
            <span>{{ relatedLocationText(loc) }}</span>
          </button>
        </template>
        <!-- 意图列表：修复与抑制两种行在**同一个弹层**里（上游问题视图的 QuickFixes 那颗按钮 ——
             `intellij.platform.problemView.ui.xml:100-103` 的动作项走
             `ShowProblemsViewQuickFixesAction.kt:78-92` 的 `IntentionListStep(…, IntentionSource.PROBLEMS_VIEW)`，
             而抑制本身也是一个意图，`SuppressIntentionAction.java:19` `implements IntentionAction`）。
             档位顺序（先修复后意图）、组变了那条分隔线、"列出来但不能选中"那三档规则住在
             `src/intentionList.ts`（上游坐标逐条开在那份文件的头上），本仓两种对象怎么喂进去住在
             `src/intentionMenuModel.ts`，画在 `IntentionListMenu.vue`。
             两半都为空时那个组件一根行都不画，对应上游 `ShowProblemsViewQuickFixesAction.kt:36-44`
             的「没有意图就置灰」；动作来源与落点（写文件 + 重报）没动，还是这两个处理函数。 -->
        <IntentionListMenu :fixes="menuFixes" :options="menuOptions"
                           @apply-fix="applyMenuFix" @apply-suppression="applySuppression" />
        <!-- 检查器说明（上游 `InspectionDescriptionDocumentationProvider.generateDoc`）：本地内置检查器
             （`src/junitInspections.ts` 那批）有说明；语言服务的规则名返回 null ⇒ 这一节整段不渲染
             （不是假控件）。显示名 + 正文两段，正文与上游 `loadDescription()` 的用途相同。 -->
        <template v-if="menuInspectionDescription">
          <p class="problems-menu-title">检查器：{{ menuInspectionDescription.displayName }}</p>
          <p class="problems-menu-note">{{ menuInspectionDescription.content }}</p>
        </template>
        <p class="problems-menu-title">高亮级别</p>
        <button v-for="option in HIGHLIGHTING_LEVELS" :key="option.id" class="problems-menu-item" @click="setLevel(rowMenu.row.path, option.id); closeRowMenu()">
          <span class="problems-menu-check"><span>{{ option.label }}</span><IdeaCheckedIcon v-if="menuLevel === option.id" :size="iconSize.chip" aria-hidden="true" /></span><span class="small-muted">{{ option.description }}</span>
        </button>
        <p class="problems-menu-title">文件</p>
        <button class="problems-menu-item" @click="ignoreFile(rowMenu.row.path); closeRowMenu()"><span>忽略此文件的分析结果</span></button>
        <button class="problems-menu-item" @click="markPlainText(rowMenu.row.path); closeRowMenu()"><span>覆盖为纯文本（退出语言分析）</span></button>
        <!-- 「复制描述」（上游树右键菜单的 `ProblemsView.CopyProblemDescription`，ui.xml:111-114）：
             复制的是这一条的可读描述，不是整张表。 -->
        <p class="problems-menu-title">复制</p>
        <button class="problems-menu-item" @click="copyDescription(rowMenu.row); closeRowMenu()">
          <span class="problems-menu-check"><Copy :size="iconSize.chip" aria-hidden="true" /><span>复制问题描述</span></span>
          <span class="small-muted">{{ errorTreeCopyText(rowMenu.row) }}</span>
        </button>
      </AnchoredMenu>
    </div>
  </div>
</template>

<style scoped>
.problems-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.problems-toolbar { flex-wrap: wrap; justify-content: flex-start; align-items: center; gap: var(--space-1); background: var(--panel); }
.problems-toolbar > .subtle-button { min-height: var(--ctrl-height-sm); padding: 0 var(--space-2); border-radius: var(--radius-xs); font-size: 11px; white-space: nowrap; }
.problems-toolbar .problems-profile-toggle { flex-shrink: 0; }
.problems-field { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--muted); }
/* 分组下拉的前缀图标（上游 `ProblemsView.GroupByToolId` 那一枚，ui.xml:96-98）不参与收缩。 */
.problems-field > svg { flex-shrink: 0; }
.problems-field select, .problems-field input { height: var(--ctrl-height-sm); padding: 0 var(--space-2); background: var(--editor); color: var(--text); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font-size: 11px; }
.problems-search { flex: 1 1 180px; min-width: 0; }
.problems-search input { flex: 1; min-width: 0; }
.problems-count { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.problems-toolbar > .problems-count { flex-shrink: 0; white-space: nowrap; }
/* 导出结果的一行回执（成功给路径、失败给原因；不弹窗，面板内可见即可）。 */
.problems-export-note { margin: 0; padding: var(--space-1) var(--space-3); color: var(--muted); font-size: 11px; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
/* 忽略规则编辑（上游 `AnalysisIgnoreFileWriter`）：与工具栏同一套紧凑控件。 */
.problems-ignore-editor { display: flex; flex-direction: column; gap: var(--space-1); flex-shrink: 0; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line); }
.problems-ignore-editor textarea { width: 100%; box-sizing: border-box; resize: vertical; padding: 3px var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 11px/1.6 var(--font-mono); }
.problems-ignore-actions { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.problem-ignore { display: inline-flex; align-items: center; gap: var(--space-1); min-height: var(--ctrl-height-sm); flex-shrink: 0; margin-left: auto; padding: 0 var(--space-1); color: var(--secondary); background: transparent; border: 1px solid transparent; border-radius: var(--radius-xs); font-size: 10px; }
.problem-ignore > svg { flex-shrink: 0; }
.problem-ignore:hover { color: var(--bright); background: var(--elevated); border-color: var(--line-strong); }
.problem-actions { display: inline-flex; gap: var(--space-1); margin-left: auto; flex-shrink: 0; }
.problem-actions .problem-ignore { margin-left: 0; }
/* 纯文本覆盖清单：一行一个文件 + 恢复按钮。 */
.problems-override-list { display: flex; flex-direction: column; gap: 2px; max-height: 120px; overflow: auto; }
.problems-override-row { display: flex; align-items: center; gap: var(--space-2); }
.problems-override-row .ref-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 分析范围的两个模式框（与忽略规则编辑同一套紧凑控件）。 */
.problems-scope-field { display: flex; flex-direction: column; gap: 2px; color: var(--muted); font-size: 11px; }
.problems-scope-field textarea { width: 100%; box-sizing: border-box; resize: vertical; padding: 3px var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 11px/1.6 var(--font-mono); }
/* 检查配置/高亮级别/意图三个弹层的清单（一行 = 名字 + 控件）。 */
.problems-profile-list { display: flex; flex-direction: column; gap: 2px; max-height: 160px; overflow: auto; }
.problems-profile-toggle { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--text); font-size: 11px; cursor: pointer; }
.problems-override-row select { height: var(--ctrl-height-sm); background: var(--editor); color: var(--text); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font-size: 11px; }
/* 行菜单（装进 AnchoredMenu 的 `.tree-menu`）：标题、单行说明与预览的紧凑排布。 */
.problems-menu-scope { margin: 0; padding: var(--space-1) var(--space-3) var(--space-2); color: var(--muted); font-size: 11px; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
.problems-menu-title { margin: var(--space-2) 0 0; padding: 0 var(--space-3) 2px; color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }
.problems-menu-note { margin: 0; padding: var(--space-1) var(--space-3); color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
.problems-menu-item { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; }
.problems-menu-check { display: inline-flex; align-items: center; gap: var(--space-1); }
.problems-menu-check > svg { flex-shrink: 0; }
/* ProblemsView 的问题与分组节点按树行密度呈现；组头负责层级，详情行保留树的平直列表感。 */
.problems-list { background: var(--editor); }
.problems-group-row { display: flex; align-items: center; gap: var(--space-1); min-height: var(--tree-row-h); padding: 0 var(--space-2); border-bottom: 1px solid var(--line); background: var(--panel); }
.problems-group { display: flex; align-items: center; gap: var(--space-1); flex: 1; min-width: 0; min-height: var(--tree-row-h); margin: 0; padding: 0 var(--space-1); background: transparent; color: var(--text); font: inherit; font-size: 12px; text-align: left; border: 0; }
.problems-group:hover { background: var(--hover); color: var(--bright); }
.problems-group:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.problem-row { min-height: var(--tree-row-h); align-items: center; gap: var(--space-1) var(--space-2); padding: var(--space-1) var(--space-3); }
.problem-row:focus-visible { background: var(--selected); }
.problem-row .ref-pos { margin-left: 0; }
.problem-sev { line-height: 1.4; }
.problems-group-count { flex-shrink: 0; color: var(--muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.problems-group-count.sev-error { color: var(--error); background: transparent; padding: 0; }
.problems-list > .ref-empty { padding: var(--space-5) var(--space-3); line-height: 1.5; }
/* 「未使用 / 已废弃」芯片（tags 折出来的伪检查项；上游是UNUSED_SYMBOL/DEPRECATED 两档注册键）。 */
.problem-kind { flex-shrink: 0; padding: 0 var(--space-1); color: var(--secondary); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font-size: 10px; }
.problems-group-mute { flex-shrink: 0; }
/* 「只看这一组」的两个入口：组头上的按钮（进入/退出）与工具栏上的在场标记（退出）。
   图标只是装饰，文案自己说明状态，所以两个按钮都不是纯图标按钮。 */
.problems-group-focus { display: inline-flex; align-items: center; gap: var(--space-1); flex-shrink: 0; }
.problems-group-focus > svg { flex-shrink: 0; }
.problems-group-focus[aria-pressed="true"] { color: var(--bright); background: var(--elevated); border-color: var(--line-strong); }
.problems-focus-chip { display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0; color: var(--secondary); }
.problems-focus-chip > svg { flex-shrink: 0; }
.problems-group-caret { display: inline-flex; flex-shrink: 0; }
.problems-group-caret > svg { flex-shrink: 0; }
.problems-group-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.problems-group.collapsed .problems-group-label { opacity: .75; }
/* 「选项…」按钮带一枚图标，按钮内图标不参与收缩。 */
.problems-options-toggle { display: inline-flex; align-items: center; gap: var(--space-1); }
.problems-options-toggle > svg { flex-shrink: 0; }
</style>
