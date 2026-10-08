<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import { languageFor } from '../templates'
import { copyToClipboard } from '../clipboard'
import { defaultEditorSettings, isDesktop, request } from '../bridge'
import { datePatternError, formatDateTimePreview } from '../dateTimeFormat.ts'
import { isNameHit, matchesOption, optionMatches, resolveSettingsPath, settingsPath } from '../settingsSearch'
import { RIGHT_MARGIN_MAX, RIGHT_MARGIN_MIN, type CommitMessageInspectionSettings } from '../commitMessageInspection'
import { MAX_EDITOR_FONT_SIZE, MIN_EDITOR_FONT_SIZE } from '../editorFontSize.ts'
import { addHistoryEntry, formatHistory, parseHistory, popupHistory, SEARCH_HISTORY_LABEL, SETTINGS_SEARCH_HISTORY_KEY, stepHistory, type HistoryDirection } from '../searchHistory'
import { MAX_SHOWS, NEW_BADGE_TEXT, NEW_OPTION_PAGES, badgeStorageKey, markOpened, parseBadgeCount, showNewBadgeDot, showNewOptions, showNewOptionsInGroup, type BadgeCounts } from '../settingsBadge'
import { PASTE_REFORMAT_MODES, pasteReformatLabel } from '../pasteOptions'
import { ChevronDown, ChevronLeft, ChevronRight, Moon, Save, Search, Sun, X } from 'lucide-vue-next'
import TemplateSettingsPage from './TemplateSettingsPage.vue'
import ExternalToolsSettingsPage from './ExternalToolsSettingsPage.vue'
// 设置树的**表**在 src/settingsTreeMeta.ts（与 src/toolWindowMeta.ts 同一个模式）。
// `groups` / `nodes` 用别名导入，模板与脚本其余部分一个字都不用改。
import {
  EXPANDED_DEFAULT, PAGE_KEYS, PROJECT_SCOPED_PAGES,
  SETTINGS_GROUPS as groups, SETTINGS_NODES as nodes, isParentOnly,
  type PageKey,
} from '../settingsTreeMeta'
import BuildToolsSettingsPage from './BuildToolsSettingsPage.vue'
import GradleSettingsPage from './GradleSettingsPage.vue'
import ScopesSettingsPage from './ScopesSettingsPage.vue'
import WorkspaceFileSearchSettingsPage from './WorkspaceFileSearchSettingsPage.vue'
import FileColorsSettingsPage from './FileColorsSettingsPage.vue'
import GeneralRegistryToggles from './GeneralRegistryToggles.vue'
import { createSettingsSearch } from '../settingsSearchController.ts'
import { createSettingsDraftActions, createSettingsDraftPages, type SettingsDraft } from '../settingsDraft'
import TodoPatternsPage from './TodoPatternsPage.vue'
import FileTypesPage from './FileTypesPage.vue'
import CodeFoldingSettingsPage from './CodeFoldingSettingsPage.vue'
import InlayHintsSettingsPage from './InlayHintsSettingsPage.vue'
import EditorTabsSettingsPage from './EditorTabsSettingsPage.vue'
import CodeVisionSettingsPage from './CodeVisionSettingsPage.vue'; import EditorSavePassesFields from './EditorSavePassesFields.vue'; import EditorEnterKeysFields from './EditorEnterKeysFields.vue' // 宿主上限 1182 行（tests/module-size.test.mjs），三个新页面/字段组同一行导入
import ConsoleSettingsPage from './ConsoleSettingsPage.vue'; import TrustedLocationsSettingsPage from './TrustedLocationsSettingsPage.vue'; import DebuggerSettingsPage from './DebuggerSettingsPage.vue' // 宿主贴死 1356 行上限，两个页面导入同一行
import SettingsAppearanceSection from './SettingsAppearanceSection.vue' // 「外观」页里由 editor/general 草稿驱动的整节
import AudioCuesSettingsPage from './AudioCuesSettingsPage.vue'; import ColorSchemeSettingsPage from './ColorSchemeSettingsPage.vue'; import KeymapSettingsPage from './KeymapSettingsPage.vue'; import AgentSettingsPage from './AgentSettingsPage.vue'
import type { EditorSettings, GeneralSettingsState, JavaProjectSettings, NamedScopeSetting, ProjectSettings, TemplateSettings, TodoPattern } from '../bridge'
import { EDITOR_LANGUAGES, breadcrumbsShownFor, defaultGeneralSettings } from '../bridge'
// 构建工具组（`build.tools` + Gradle 页）的取值/文案/控件都在 src/gradle.ts 与两个子页组件里；
// 这里只剩两处需要类型：emit 的载荷形状与传给 Gradle 页的检测结果。
import type { BuildToolsSettings, GradleDetection } from '../gradle'
import type { Theme } from '../appearance'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  settings: EditorSettings
  projectSettings: ProjectSettings | null
  projectRoot: string | null
  activePath: string
  theme: Theme
  busy: boolean
  error: string
  initialSection?: 'preferences.lookFeel' | 'editor' | 'editor.preferences.appearance' | 'editor.preferences.tabs'
    | 'preferences.sourceCode.indents' | 'tools.actionsOnSave' | 'editing.templates' | 'commit' | 'preferences.general' | 'ide.date.format'
    | 'build.tools' | 'reference.settingsdialog.project.gradle' | 'agent' | 'agent.modelProvider' | null
  /** IDEA's commit-message inspections (Settings › Version Control › Commit). */
  commitMessageSettings: CommitMessageInspectionSettings
  /** IDEA's GeneralSettings (ide.general.xml): the System Settings page's backing state. */
  general: GeneralSettingsState
  /** 单隐式模块名（工作区目录名）：作用域模式里的 `file[模块名]:…` 用它。 */
  moduleName: string
  /** 当前项目的 Gradle 检测结果（宿主 `gradle.detect` 的产出）—— Gradle 页显示"检测到什么"。 */
  gradleDetection?: GradleDetection | null
  persistAgent?: (next: import('../agentSettings.ts').AgentSettingsState) => boolean
}>()
const templateLanguage = computed(() => languageFor(props.activePath))
const emit = defineEmits<{
  save: [settings: EditorSettings, close?: boolean]
  saveCommitMessage: [settings: CommitMessageInspectionSettings, close?: boolean]
  saveProject: [patch: { excludedDirs: string[] }]
  /** VCS 日志的 UI 开关（IDEA vcs.log）：单独一条 emit，避免与 saveProject 的重载混淆。 */
  saveVcsLog: [log: { showTagNames: boolean; showRootNames: boolean }]
  /** 命名作用域（IDEA project.scopes）：整表替换，数组顺序就是 ScopeChooserConfigurableState.myOrder。 */
  saveScopes: [scopes: NamedScopeSetting[]]
  saveDraft: [draft: SettingsDraft, close?: boolean]
  /** TODO 模式表（IDEA preferences.toDoOptions）：整表替换，随项目保存。 */
  saveTodoPatterns: [patterns: TodoPattern[]]
  /** 文件类型关联（IDEA preferences.fileTypes）：整表替换，随项目保存。 */
  saveFileAssociations: [associations: Record<string, string>]
  saveJava: [settings: JavaProjectSettings]
  /** 构建工具组的项目级状态（IDEA `build.tools`）：`{autoReloadType, previousAutoReloadType, gradle}`。 */
  saveBuildTools: [patch: Partial<BuildToolsSettings>]
  saveTemplates: [settings: TemplateSettings]
  saveGeneral: [settings: GeneralSettingsState, close?: boolean]
  /** 第二个参数是点击事件：主题切换的水纹从点击位置扩散（见 src/themeRipple.ts）。 */
  theme: [theme: Theme, event?: MouseEvent]; close: []
  pickBackground: []
  clearBackground: []
}>()
const id = useId()
const dialog = ref<HTMLDialogElement>()
// 编辑器设置被拆成多页（编辑器 › 常规 › 外观 / 编辑器标签页、代码风格 › 制表符与缩进、
// 工具 › 保存时操作），每页各自是一个 form；reportValidity 作用在第一个挂载的那个上。
const editorForm = ref<HTMLFormElement>()
function registerEditorForm(element: unknown) {
  if (element) editorForm.value = element as HTMLFormElement
}
const editor = ref<EditorSettings>({ ...props.settings })
const projectFormatOnSave = shallowRef(props.projectSettings?.formatOnSave ?? props.settings.formatOnSave)
const savedFormatOnSave = computed(() => props.projectSettings?.formatOnSave ?? props.settings.formatOnSave)
const formatOnSaveDirty = computed(() => props.projectSettings !== null && projectFormatOnSave.value !== savedFormatOnSave.value)
// IDEA's commit-message inspections are a second, independent page with its own draft
// (Settings › Version Control › Commit, CommitDialogConfigurable.kt:56-101).
const commitMessage = ref<CommitMessageInspectionSettings>({ ...props.commitMessageSettings })

// Source: GeneralSettingsConfigurable.kt:93 — `GeneralSettings.getInstance().state`
// is the model the panel binds to; TaoCode stages a draft exactly like the other pages.
const general = ref<GeneralSettingsState>({ ...defaultGeneralSettings, ...props.general })
type EmbeddedBrowserClearMode = 'cache' | 'all'
const browserDataClearing = ref<EmbeddedBrowserClearMode | null>(null)
const browserDataConfirm = ref(false)
const browserDataStatus = ref('')
const browserDataError = ref('')
const datePatternIssue = computed(() => datePatternError(general.value.dateFormatPattern))
const dateFormatPreview = computed(() => formatDateTimePreview(general.value))
// 控制台折叠规则用多行文本编辑（每行一条），写回字符串数组（对应 IDEA 的两个 AddDeleteListPanel）。
// 高级设置：内部设置键值审计视图（IDEA Registry 的只读等价物）。
// 高级设置＝内部键的可编辑视图（IDEA Registry 的等价物）：值按 JSON 文本编辑，写回**本地副本**，
// 由页面底部的「应用更改」按各自的保存链路提交（editor → save，general → save-general），非法 JSON 会标红。
const advancedErrors = ref(new Set<string>())
const internalSettingRows = computed(() => [
  ...Object.entries(editor.value ?? {}).filter(([key]) => key !== 'formatOnSave').map(([key, value]) => ({ group: 'editor' as const, key, value: JSON.stringify(value) })),
  ...Object.entries(general.value ?? {}).map(([key, value]) => ({ group: 'preferences.general' as const, key, value: JSON.stringify(value) })),
].sort((left, right) => left.group === right.group ? left.key.localeCompare(right.key) : left.group.localeCompare(right.group)))

function editInternalSetting(group: 'editor' | 'preferences.general', key: string, text: string) {
  const id = `${group}:${key}`
  try {
    const parsed = JSON.parse(text)
    if (group === 'editor') editor.value = { ...editor.value, [key]: parsed } as EditorSettings
    else general.value = { ...general.value, [key]: parsed } as GeneralSettingsState
    advancedErrors.value.delete(id)
  } catch { advancedErrors.value.add(id) }
}

function applyAdvanced() {
  if (advancedErrors.value.size) return
  applyAll()
}

const copyHint = ref('')
function copyInternalSettings() {
  const editorSettingsCopy = Object.fromEntries(Object.entries(editor.value ?? {}).filter(([key]) => key !== 'formatOnSave'))
  const payload = JSON.stringify({ editor: editorSettingsCopy, general: general.value ?? {} }, null, 2)
  void copyToClipboard(payload)
  copyHint.value = '已复制到剪贴板'
  window.setTimeout(() => { copyHint.value = '' }, 2000)
}

// IDEA's ConfigurableListPanel reads the groups from intellij.platform.ide.impl.xml
// groupConfigurable entries (lines 575-608); weight descends, so order is
// appearance 70 > editor 60 > project 40 > build 30 > language 20 > tools 10 >
// other -10; proofread is a child of editor, profiler of build. Display names come
// from OptionsBundle.properties `configurable.group.<id>.settings.display.name`
// (Appearance & Behavior / Editor / Default Project / Build, Execution,
// Deployment / Languages & Frameworks / Tools / Other Settings / Natural
// Languages). Only pages whose configurables are wired up render content;
// others do not show as empty shells.
// `expandOnly` 对应 IDEA 树里“只有子项、自己不是设置页”的父节点（点它只展开，不打开空页面）。
// Only pages whose real configurables exist in the source are listed. IDE's
// full tree (Appearance/Editor/Plugins/...) appears once TaoCode port those
// Java classes; until then the tree shows only what the project has today.
// 页面键尽量直接沿用 IDEA 的 configurable id（editor.breadcrumbs / Console / Errors /
// preferences.toDoOptions / diff.base / build.tools / vcs.log …），这样"这一页对应源码哪一条注册"
// 在代码里就是答案；早期批次用过的键（appearance / editor.general / structure / commit …）保持不变，
// 以免打断跳转目标与测试。
// 设置树的**表**（页面键 / 分组 / 节点 / 随项目保存的页）在 src/settingsTreeMeta.ts ——
// 与 src/toolWindowMeta.ts 同一个模式：树是数据，组件只管渲染。
const expanded = ref(new Set<string>(EXPANDED_DEFAULT))
const section = ref<PageKey>(props.initialSection === 'agent.modelProvider' ? 'agent' : props.initialSection && PAGE_KEYS.includes(props.initialSection as PageKey) ? props.initialSection as PageKey : 'preferences.lookFeel')
const agentInitialSection = computed(() => props.initialSection === 'agent.modelProvider' ? 'modelProvider' : undefined)

// IDEA's "new options" dot (SettingsNewBadgeState.kt:19-56 + SettingsTreeView.java:791): a page
// that carries newly added options shows a dot in the tree until it has been shown once, and the
// counter is persisted per page (SettingsNewBadgeRecorder.kt:10-19). IDEA records the page when the
// tree selects it — including the selection made while the dialog opens
// (SettingsEditor.java:410 `treeView.select` -> SettingsTreeView.java:254-257 `fireSelected`
// -> :536 `markOpened`), so a watcher on the shown page covers every path into it.
const badgeCounts = ref<BadgeCounts>(loadBadgeCounts())
function loadBadgeCounts(): BadgeCounts {
  const counts: Record<string, number> = {}
  try {
    for (const page of NEW_OPTION_PAGES) counts[page] = parseBadgeCount(localStorage.getItem(badgeStorageKey(page)))
  } catch { /* storage unavailable: every page counts as never shown */ }
  return counts
}
watch(section, key => {
  const { counts, changed } = markOpened(key, badgeCounts.value)
  if (!changed) return
  badgeCounts.value = counts
  try { localStorage.setItem(badgeStorageKey(key), String(MAX_SHOWS)) } catch { /* kept for this session */ }
}, { immediate: true })
/** A leaf page keeps the dot while it has never been shown (:47-51, seen on a leaf at :791). */
function pageHasNewBadge(key: PageKey) { return showNewOptions(key, badgeCounts.value) }
/** A group only announces it while it is collapsed (:791 `leaf || !expanded`, :32-36 propagation). */
function groupHasNewBadge(key: string) {
  const children = nodes.filter(node => node.parent === key).map(node => node.key)
  return showNewBadgeDot(showNewOptionsInGroup(children, badgeCounts.value), false, expanded.value.has(key))
}

// 设置树的搜索（IDEA 的 SettingsFilter + SearchableOptionsRegistrarImpl + 搜索历史 + spotlight）
// 整块搬到了 src/settingsSearchController.ts：本文件贴着机检上限，而这一族只认「一个查询把树过滤成
// 什么样」一件事。上游出处都在那边（SettingsFilter.kt:206-229 / SearchableOptionsRegistrarImpl.kt:
// 217-260,457-529 / SearchUtil.kt:63-86,131-171 / SettingsSearch.java:25,119-124,173-195,284-288,
// 417-461）。宿主只留这一行工厂调用，返回的每一项模板与脚本其余部分照旧按原名用。
const {
  query, searchInput, searching, searchBox, historyPopup, searchHistory, historyOpen, historyCursor,
  historyBox, historyItems, recordSearchHistory, openHistory, closeHistory, pickHistory,
  stepSearchHistory, onSearchIconClick, optionRows, scanOptions, visibleNodes, noMatch, spotlightActive,
  clearSearch, onSearchPointerDown, visibleGroups, flatKeys, dispose: disposeSearch,
} = createSettingsSearch({ dialog, section, expanded })

// 模板不内联过滤（vue-best-practices：派生进 script）——搜索态的两组行各算一份：组直属按 parent 过滤；孤儿页单独一份。
const directSettingNodes = (key: string) => visibleNodes.value.filter(item => item.parent === key); const orphanSettingNodes = computed(() => visibleNodes.value.filter(item => !isParentOnly(item.key) && !groups.some(group => group.key === item.parent)))

// IDEA's breadcrumb (外观与行为 › 外观) plus the back/forward arrows that walk the
// configurables navigation history.
const history = ref<PageKey[]>([]); const future = ref<PageKey[]>([])
const groupLabel = computed(() => nodes.find(node => node.key === section.value)?.parent
  ?? null)
const currentLabel = computed(() => nodes.find(node => node.key === section.value)?.label ?? '')
function select(key: PageKey) {
  if (key === section.value) return
  history.value = [...history.value, section.value]
  future.value = []
  section.value = key
}
function goBack() {
  const previous = history.value.pop()
  if (!previous) return
  future.value = [...future.value, section.value]
  section.value = previous
}
function goForward() {
  const next = future.value.pop()
  if (!next) return
  history.value = [...history.value, section.value]
  section.value = next
}
function onSearchEnter() {
  // SettingsFilter.kt:222-229 — a name hit wins over a content hit, so Enter lands on the page
  // that is actually named like the query instead of the first page that merely contains it.
  const named = visibleNodes.value.find(node => isNameHit(`${node.label}\n${node.keywords}`, query.value))
  const first = named ?? visibleNodes.value[0]
  if (first) select(first.key)
}

// CopySettingsPathAction: every breadcrumb crumb carries the "copy this option's path" action
// (SettingsEditor.java:793-806), its text is `action.CopySettingsPath.text.template` with the
// settings title (ActionsBundle.properties:446) and the copied string is the settings path prefix
// plus each path name (CopySettingsPathAction.kt:55-65, separator SearchableOptionsRegistrar.java:21).
const crumbMenu = ref<{ x: number; y: number } | null>(null)
const crumbNames = computed(() => {
  const group = groups.find(item => item.key === groupLabel.value)?.label
  return group ? [group, currentLabel.value] : [currentLabel.value]
})
const crumbText = computed(() => settingsPath(crumbNames.value))
const copyNote = ref('')
let copyTimer: number | undefined
function openCrumbMenu(event: MouseEvent | KeyboardEvent) {
  event.preventDefault()
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  crumbMenu.value = { x: box.left, y: box.bottom + 4 }
}
function copyCrumbPath() {
  crumbMenu.value = null
  const path = crumbText.value
  if (!path) return
  void copyToClipboard(path)
  copyNote.value = `已复制：${path}`
  if (copyTimer !== undefined) clearTimeout(copyTimer)
  copyTimer = window.setTimeout(() => { copyNote.value = '' }, 4000)
}

const validEditor = computed(() => Number.isInteger(editor.value.fontSize)
  && editor.value.fontSize >= MIN_EDITOR_FONT_SIZE && editor.value.fontSize <= MAX_EDITOR_FONT_SIZE && [2, 4, 8].includes(editor.value.tabSize)
  && Number.isInteger(editor.value.tabLimit) && editor.value.tabLimit >= 1 && editor.value.tabLimit <= 100)
// The select doubles as the indentation size for spaces and the display width of a
// tab character, so its labels follow whichever mode is turned on.
const sizeLabel = (size: number) => editor.value.useTabCharacter ? `${size} 列宽` : `${size} 个空格`
// IDEA's OK/Cancel/Apply triple: 应用 commits without closing and is only enabled
// while the form actually differs from the saved settings.
const editorDirty = computed(() => JSON.stringify(editor.value) !== JSON.stringify(props.settings))
// The commit-message inspections are a second page with its own draft; the spinner range is
// IDEA's `spinner(0..10000)` (SubjectLimitInspection.kt:27, BodyLimitInspection.kt:36).
const commitMessageDirty = computed(() => JSON.stringify(commitMessage.value) !== JSON.stringify(props.commitMessageSettings))
const validCommitMessage = computed(() => [commitMessage.value.subjectRightMargin, commitMessage.value.bodyRightMargin]
  .every(value => Number.isInteger(value) && value >= RIGHT_MARGIN_MIN && value <= RIGHT_MARGIN_MAX))
const generalDirty = computed(() => JSON.stringify(general.value) !== JSON.stringify(props.general))
const { scopesPage, fileColorsPage, dirty } = createSettingsDraftPages(editorDirty, commitMessageDirty, generalDirty, formatOnSaveDirty)
let previousFocus: HTMLElement | null = null

// Not deep, and skipped while the form is dirty: the parent refreshes `settings` when
// another panel or a project load re-reads them, and a deep watch used to replace the
// half-typed form underneath the user. After a successful save the prop changes while
// the form is clean, which is exactly when this sync runs.
watch(() => props.settings, value => {
  if (editorDirty.value) return
  editor.value = { ...value }
})
watch(() => props.projectRoot, () => { projectFormatOnSave.value = savedFormatOnSave.value })
watch(() => [props.projectSettings?.formatOnSave, props.settings.formatOnSave], () => {
  if (!formatOnSaveDirty.value) projectFormatOnSave.value = savedFormatOnSave.value
})
watch(() => props.commitMessageSettings, value => {
  if (commitMessageDirty.value) return
  commitMessage.value = { ...value }
})
watch(() => props.general, value => {
  if (generalDirty.value) return
  general.value = { ...defaultGeneralSettings, ...value }
})
// `apply` (the Apply button / Alt+A) commits without closing; `ok` saves and, when the parent
// reports success, closes — the dialog stays open with the error if the save rejects.
function applyEditor(close = false) {
  if (!props.busy && validEditor.value && editorForm.value?.reportValidity()) emit('save', { ...editor.value }, close)
}
// IDEA's per-page reset: every option on the editor page returns to the shipped
// default. Nothing is persisted until the user saves, matching the dialog's
// staged-edit model.
function resetEditorPage() {
  editor.value = { ...defaultEditorSettings, formatOnSave: props.settings.formatOnSave }
}
function applyFormatOnSave() {
  if (!props.busy && props.projectSettings && formatOnSaveDirty.value) emit('saveDraft', { formatOnSave: projectFormatOnSave.value })
}
function resetFormatOnSave() {
  projectFormatOnSave.value = false
}
function applyCommitMessage(close = false) {
  if (!props.busy && validCommitMessage.value) emit('saveCommitMessage', { ...commitMessage.value }, close)
}
// GeneralSettings.inactiveTimeout clamps through SAVE_FILES_AFTER_IDLE_SEC.fit
// (GeneralSettings.kt:193-202, UINumericRange.java:21-23): the stored value always
// lands inside [1, 300].
const validInactiveTimeout = computed(() => Number.isInteger(general.value.inactiveTimeout) && general.value.inactiveTimeout >= 1 && general.value.inactiveTimeout <= 300)
const validGeneral = computed(() => validInactiveTimeout.value && (!general.value.overrideSystemDateFormat || !datePatternIssue.value))
function applyGeneral(close = false) {
  if (!props.busy && validGeneral.value) emit('saveGeneral', { ...general.value }, close)
}
async function clearEmbeddedBrowserData(mode: EmbeddedBrowserClearMode) {
  if (!isDesktop || props.busy || browserDataClearing.value) return
  browserDataClearing.value = mode
  browserDataStatus.value = ''
  browserDataError.value = ''
  try {
    const result = await request<{ success: boolean }>('browser.data.clear', { mode })
    if (result.success) browserDataStatus.value = mode === 'cache' ? '内置浏览器缓存已清除' : '内置浏览器数据已全部清除'
    else browserDataError.value = '内置浏览器数据清理失败。'
  } catch (cause) {
    browserDataError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    browserDataClearing.value = null
  }
}
function confirmClearEmbeddedBrowserData() {
  browserDataConfirm.value = false
  void clearEmbeddedBrowserData('all')
}
function resetGeneralPage() {
  general.value = { ...defaultGeneralSettings }
}
const { applyAll, ok } = createSettingsDraftActions({
  editor, general, commitMessage, formatOnSave: projectFormatOnSave, formatOnSaveDirty, editorDirty, generalDirty, commitMessageDirty,
  dirty, scopesPage, fileColorsPage,
  busy: () => props.busy,
  valid: () => validEditor.value && validCommitMessage.value && validGeneral.value,
  reportEditorValidity: () => editorForm.value?.reportValidity(),
  showScopes: () => { section.value = 'project.scopes' },
  save: (draft, closeAfterSave) => emit('saveDraft', draft, closeAfterSave),
  close,
})
function close() {
  if (!props.busy) emit('close')
}
async function navigateTabs(event: KeyboardEvent) {
  const keys = flatKeys.value
  const current = keys.indexOf(section.value)
  let index = current
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') index = (current + 1) % keys.length
  else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') index = (current + keys.length - 1) % keys.length
  else if (event.key === 'Home') index = 0
  else if (event.key === 'End') index = keys.length - 1
  else return
  event.preventDefault()
  section.value = keys[index]!
  await nextTick()
  document.getElementById(`${id}-tab-${section.value}`)?.focus()
}
function toggleGroup(key: string) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}
function onKeydown(event: KeyboardEvent) {
  if (event.altKey && (event.key === 'a' || event.key === 'A')) {
    event.preventDefault()
    applyAll()
    return
  }
  // SettingsDialog.java:129-132 registers the platform Find shortcut on the dialog root pane, and
  // SettingsSearch.java:96-100 shows that shortcut as the field's tooltip.
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    searchInput.value?.focus()
    searchInput.value?.select()
    return
  }
  if (event.key === 'Escape') {
    // SettingsSearch.java:50-52 — ESC resets the filter first; the root pane handles ESC before the
    // dialog's own cancel (SettingsDialog.java:255-261), which App.vue mirrors by asking
    // handleEscape() first. Closing the dialog is App.vue's call, never this handler's.
    event.preventDefault()
    crumbMenu.value = null
    if (searching.value) clearSearch()
    return
  }
  if (event.key !== 'Tab') return
  const controls = [...(dialog.value?.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]') ?? [])]
    .filter(element => !element.matches(':disabled') && element.tabIndex >= 0 && element.getClientRects().length > 0)
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (!first) { event.preventDefault(); dialog.value?.focus(); return }
  if (!controls.includes(document.activeElement as HTMLElement)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first)?.focus()
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault(); last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus()
  }
}
watch(() => props.busy, async value => {
  if (!value) return
  await nextTick()
  if (!dialog.value?.contains(document.activeElement) || document.activeElement?.matches(':disabled')) dialog.value?.focus()
})
onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.value?.showModal()
  document.getElementById(`${id}-tab-${section.value}`)?.focus()
  scanOptions()
})
watch(() => props.projectSettings, scanOptions)
onBeforeUnmount(() => {
  // spotlight 的定时器与它打在 DOM 上的类都归搜索模块管，收摊也由它自己做
  // （搬出前就是这两行，见 src/settingsSearchController.ts 的 dispose）。
  disposeSearch()
  if (copyTimer !== undefined) clearTimeout(copyTimer)
  dialog.value?.close()
  if (previousFocus?.isConnected) previousFocus.focus()
})
// IDEA's dialog hands ESC to the editor first (`editor.cancel(source)` — SettingsDialog.java:255-261):
// a non-empty filter is consumed here, and only an empty one lets the caller close the window.
function handleEscape(): boolean {
  // IDEA's history popup owns the focus while it is open (setRequestFocus, :448), so ESC closes it
  // before the filter and the dialog are reached (SettingsSearch.java:50-52, SettingsDialog.java:255-261).
  if (historyOpen.value) { void closeHistory(); return true }
  if (searching.value) { clearSearch(); searchInput.value?.focus(); return true }
  if (crumbMenu.value) { crumbMenu.value = null; return true }
  return false
}
defineExpose({ handleEscape })
</script>

<template>
  <dialog
    ref="dialog" class="help-dialog settings-dialog" role="dialog" aria-modal="true" tabindex="-1"
    :aria-labelledby="`${id}-title`" @cancel.prevent="close" @keydown.stop="onKeydown"
  >
    <header class="dialog-header">
      <h2 :id="`${id}-title`" class="dialog-title">设置</h2>
      <button type="button" class="icon-button" :disabled="busy" aria-label="关闭设置" @click="close"><X :size="iconSize.action" aria-hidden="true" /></button>
    </header>
    <div class="settings-layout">
      <nav class="settings-navigation" role="tablist" aria-label="设置分类" aria-orientation="vertical" @keydown="navigateTabs">
        <label ref="searchBox" class="settings-filter" :class="{ 'settings-filter-error': noMatch }" aria-label="搜索设置">
          <!-- SearchTextField.java:119-124 — the leading area of the field opens the history list
               on a single click (IDEA draws the arrow there); with no history it just focuses. -->
          <button
            type="button" class="settings-search-icon" :class="{ 'has-history': searchHistory.length > 0 }"
            :aria-label="searchHistory.length ? SEARCH_HISTORY_LABEL : '搜索'"
            aria-haspopup="listbox" :aria-expanded="historyOpen" @click.prevent="onSearchIconClick"
          ><Search :size="iconSize.control" aria-hidden="true" /></button>
          <input
            ref="searchInput" v-model="query" type="search" placeholder="搜索设置" autocomplete="off" spellcheck="false"
            @mousedown="onSearchPointerDown" @keydown.enter.prevent="onSearchEnter"
            @blur="recordSearchHistory()" @keydown.alt.down.prevent="openHistory()" @keydown.alt.up.prevent="stepSearchHistory('prev')"
          />
          <button v-if="query" type="button" class="icon-button" aria-label="清空搜索" @click="clearSearch"><X :size="iconSize.dense" aria-hidden="true" /></button>
        </label>
        <div v-if="historyOpen" class="settings-crumb-backdrop" @click="closeHistory()" @contextmenu.prevent="closeHistory()" />
        <div
          v-if="historyOpen" ref="historyPopup" class="settings-history-popup" role="listbox" :aria-label="SEARCH_HISTORY_LABEL" tabindex="-1"
          :style="{ left: `${historyBox?.x ?? 0}px`, top: `${historyBox?.y ?? 0}px`, minWidth: `${historyBox?.width ?? 160}px` }"
          @keydown.esc.stop.prevent="closeHistory()" @keydown.enter.prevent="pickHistory(historyItems[historyCursor])" @keydown.tab.prevent="closeHistory()"
          @keydown.arrow-down.prevent="historyCursor = (historyCursor + 1) % historyItems.length"
          @keydown.arrow-up.prevent="historyCursor = (historyCursor + historyItems.length - 1) % historyItems.length"
        >
          <button
            v-for="(item, index) in historyItems" :key="item" type="button" class="menu-button settings-history-item" role="option"
            :title="item" :aria-selected="index === historyCursor" :class="{ active: index === historyCursor }"
            @mousemove="historyCursor = index" @click="pickHistory(item)"
          >{{ item }}</button>
        </div>
        <template v-if="searching">
          <template v-for="group in visibleGroups" :key="group.key">
            <span class="settings-group-label">{{ group.label }}</span>
            <button
              v-for="node in directSettingNodes(group.key)" :id="`${id}-tab-${node.key}`" :key="node.key"
              type="button" class="menu-button settings-tab" role="tab" :aria-selected="section === node.key"
              :aria-controls="`${id}-panel-${node.key}`" :tabindex="section === node.key ? 0 : -1"
              @click="select(node.key)"
            ><component :is="node.icon" :size="iconSize.action" aria-hidden="true" /><span>{{ node.label }}</span><span v-if="pageHasNewBadge(node.key)" class="settings-new-dot" role="img" :aria-label="NEW_BADGE_TEXT" /></button>
          </template>
          <!-- 搜索结果：父节点本身不是页面，所以只列匹配到的叶子，按层级缩进 -->
          <button
            v-for="node in orphanSettingNodes" :id="`${id}-tab-${node.key}`" :key="node.key"
            type="button" class="menu-button settings-tab" :class="node.parent ? 'settings-child' : ''"
            role="tab" :aria-selected="section === node.key"
            :aria-controls="`${id}-panel-${node.key}`" :tabindex="section === node.key ? 0 : -1"
            @click="select(node.key)"
          ><component :is="node.icon" :size="iconSize.action" aria-hidden="true" /><span>{{ node.label }}</span><span v-if="pageHasNewBadge(node.key)" class="settings-new-dot" role="img" :aria-label="NEW_BADGE_TEXT" /></button>
          <p v-if="!visibleNodes.length" class="settings-empty">没有匹配的设置项。</p>
        </template>
        <template v-else>
          <template v-for="group in groups" :key="group.key">
            <button
              type="button" class="menu-button settings-tab settings-group" role="tab"
              :aria-expanded="expanded.has(group.key)" :tabindex="-1"
              @click="toggleGroup(group.key)"
            >
              <ChevronDown :size="iconSize.menu" class="settings-caret" :class="{ 'settings-caret-closed': !expanded.has(group.key) }" aria-hidden="true" />
              <span>{{ group.label }}</span>
              <span v-if="groupHasNewBadge(group.key)" class="settings-new-dot" role="img" :aria-label="NEW_BADGE_TEXT" />
            </button>
            <template v-if="expanded.has(group.key)">
              <!-- 分组下还没有移植任何页面时明说，而不是显示一个点开什么都没有的节点。 -->
              <button
                v-for="node in nodes.filter(item => item.parent === group.key)" :id="`${id}-tab-${node.key}`" :key="node.key"
                type="button" class="menu-button settings-tab settings-child" role="tab" :aria-selected="section === node.key"
                :aria-controls="`${id}-panel-${node.key}`" :tabindex="section === node.key ? 0 : -1"
                @click="select(node.key)"
              ><component :is="node.icon" :size="iconSize.action" aria-hidden="true" /><span>{{ node.label }}</span><span v-if="pageHasNewBadge(node.key)" class="settings-new-dot" role="img" :aria-label="NEW_BADGE_TEXT" /></button>
            </template>
          </template>
          <template v-for="node in nodes.filter(item => !item.parent)" :key="node.key">
            <!-- IDEA 的树里父节点只负责展开（点它不打开空页面） -->
            <button
              v-if="node.expandOnly" type="button" class="menu-button settings-tab settings-group"
              :aria-expanded="expanded.has(node.key)" :tabindex="-1" @click="toggleGroup(node.key)"
            >
              <ChevronDown :size="iconSize.menu" class="settings-caret" :class="{ 'settings-caret-closed': !expanded.has(node.key) }" aria-hidden="true" />
              <span>{{ node.label }}</span>
            </button>
            <button
              v-else :id="`${id}-tab-${node.key}`" type="button" class="menu-button settings-tab" role="tab" :aria-selected="section === node.key"
              :aria-controls="`${id}-panel-${node.key}`" :tabindex="section === node.key ? 0 : -1"
              @click="select(node.key)"
            ><component :is="node.icon" :size="iconSize.action" aria-hidden="true" /><span>{{ node.label }}</span><span v-if="pageHasNewBadge(node.key)" class="settings-new-dot" role="img" :aria-label="NEW_BADGE_TEXT" /></button>
            <template v-if="!node.expandOnly || expanded.has(node.key)">
              <template v-for="child in nodes.filter(item => item.parent === node.key)" :key="child.key">
                <button
                  v-if="child.expandOnly" type="button" class="menu-button settings-tab settings-group settings-child"
                  :aria-expanded="expanded.has(child.key)" :tabindex="-1" @click="toggleGroup(child.key)"
                >
                  <ChevronDown :size="iconSize.menu" class="settings-caret" :class="{ 'settings-caret-closed': !expanded.has(child.key) }" aria-hidden="true" />
                  <span>{{ child.label }}</span>
                </button>
                <template v-else>
                  <button
                    :id="`${id}-tab-${child.key}`" type="button" class="menu-button settings-tab settings-child" role="tab" :aria-selected="section === child.key"
                    :aria-controls="`${id}-panel-${child.key}`" :tabindex="section === child.key ? 0 : -1"
                    @click="select(child.key)"
                  ><component :is="child.icon" :size="iconSize.action" aria-hidden="true" /><span>{{ child.label }}</span><span v-if="pageHasNewBadge(child.key)" class="settings-new-dot" role="img" :aria-label="NEW_BADGE_TEXT" /></button>
                  <button
                    v-for="grand in nodes.filter(item => item.parent === child.key)" :id="`${id}-tab-${grand.key}`" :key="grand.key"
                    type="button" class="menu-button settings-tab settings-grandchild" role="tab" :aria-selected="section === grand.key"
                    :aria-controls="`${id}-panel-${grand.key}`" :tabindex="section === grand.key ? 0 : -1"
                    @click="select(grand.key)"
                  ><component :is="grand.icon" :size="iconSize.action" aria-hidden="true" /><span>{{ grand.label }}</span><span v-if="pageHasNewBadge(grand.key)" class="settings-new-dot" role="img" :aria-label="NEW_BADGE_TEXT" /></button>
                </template>
              </template>
            </template>
          </template>
        </template>
      </nav>
      <div class="settings-content" :class="{ 'settings-spotlight-on': spotlightActive }">
        <div class="settings-breadcrumb">
          <button type="button" class="icon-button" :disabled="!history.length" aria-label="后退" @click="goBack"><ChevronLeft :size="iconSize.action" aria-hidden="true" /></button>
          <button type="button" class="icon-button" :disabled="!future.length" aria-label="前进" @click="goForward"><ChevronRight :size="iconSize.action" aria-hidden="true" /></button>
          <span
            class="settings-crumbs" role="button" tabindex="0"
            @contextmenu.prevent="openCrumbMenu" @keydown.shift.f10.prevent="openCrumbMenu" @keydown.contextmenu.prevent="openCrumbMenu"
          >
            <template v-if="groupLabel"><span class="crumb-group">{{ groups.find(group => group.key === groupLabel)?.label }}</span><ChevronRight :size="iconSize.inline" class="crumb-sep" aria-hidden="true" /></template>
            <span class="crumb-current">{{ currentLabel }}</span>
          </span>
          <button
            v-if="crumbMenu" type="button" class="menu-button settings-crumb-menu" role="menuitem"
            :style="{ left: `${crumbMenu.x}px`, top: `${crumbMenu.y}px` }"
            @click="copyCrumbPath"
          >复制设置路径</button>
        </div>
        <div v-if="crumbMenu" class="settings-crumb-backdrop" @click="crumbMenu = null" @contextmenu.prevent="crumbMenu = null" />
        <div v-if="error" class="notice error settings-error" role="alert"><span>{{ error }}</span></div>
        <section v-show="section === 'preferences.lookFeel'" :id="`${id}-panel-appearance`" class="settings-panel" data-page="appearance" role="tabpanel" :aria-labelledby="`${id}-tab-appearance`">
          <h3>外观</h3>
          <div class="theme-options" role="group" aria-label="主题">
            <button type="button" class="subtle-button theme-option" :aria-pressed="theme === 'light'" @click="emit('theme', 'light', $event)"><Sun :size="iconSize.action" aria-hidden="true" /><span>浅色</span></button>
            <button type="button" class="subtle-button theme-option" :aria-pressed="theme === 'dark'" @click="emit('theme', 'dark', $event)"><Moon :size="iconSize.action" aria-hidden="true" /><span>深色</span></button>
          </div>
          <!-- 外观页里由 editor/general 草稿驱动的那些控件在 SettingsAppearanceSection.vue（拆出去的整节）；
               `<h3>` 与主题选择器留在宿主：主题切换是对话框级 emit（水纹要拿到点击位置）。 -->
          <SettingsAppearanceSection
            :editor="editor" :general="general" :busy="busy" :id-prefix="id"
            @pick-background="emit('pickBackground')" @clear-background="emit('clearBackground')"
          />
        </section>

        <form
          v-show="section === 'editor'" :id="`${id}-panel-editor`" :ref="registerEditorForm" class="settings-panel" data-page="editor"
          role="tabpanel" :aria-labelledby="`${id}-tab-editor.general`" :aria-busy="busy" @submit.prevent="applyEditor()"
        >
          <h3>编辑器 › 常规</h3>
          <div class="editor-page-head">
            <button type="button" class="subtle-button" @click="resetEditorPage()">恢复默认</button>
          </div>
          <fieldset class="settings-fields" :disabled="busy">
            <div class="input-row">
              <label :for="`${id}-font`">字体大小 <span class="field-hint">（像素）</span></label>
              <input :id="`${id}-font`" v-model.number="editor.fontSize" type="number" :min="MIN_EDITOR_FONT_SIZE" :max="MAX_EDITOR_FONT_SIZE" step="1" required />
            </div>
            <label class="checkbox-row"><input v-model="editor.wordWrap" type="checkbox" /><span>自动换行（软换行）</span></label>
            <EditorSavePassesFields :settings="editor" :busy="busy" /><!-- 终端字号两把（键：src/settingsModel.ts 的 EditorSettings.wheelFontChangeEnabled / terminalBaseFontSize）。上游这一格在「编辑器 › 常规」的 Mouse control 组：控件 platform/lang-impl/src/com/intellij/application/options/editor/EditorOptionsPanel.kt:91-94（enableWheelFontChange）、挂点同文件 :216（chkEnableWheelFontSizeChange = checkBox(enableWheelFontChange)），组名同文件 :214 用 group.advanced.mouse.usages（platform/ide-core/resources/messages/ApplicationBundle.properties:395 = Mouse Control），文案 ApplicationBundle.properties:396 = "Change font size with Ctrl+Mouse Wheel in:"（macOS 变体 :397 是 Command）；中文包不在本地树 ⇒ 下面是英文原文直译。上游默认值 EditorSettingsExternalizable.java:124 = IS_WHEEL_FONTCHANGE_ENABLED false（门 JBTerminalPanel.java:382），本仓缺省同为 false。基准字号那格上游没有原样（那档住在配色方案的 consoleFontSize 里，platform/execution-impl/src/com/intellij/terminal/TerminalUiSettingsManager.kt:123-132 的 detectFontSize() 现算），是本仓架构映射 ⇒ 界 4..40 = EditorFontsConstants.java:11-13 / :15-17，与 previewSettings.ts、settings_editor_keys.hpp 同一对数。消费方 src/components/TerminalPanel.vue:115 / :121。 -->
            <label class="checkbox-row"><input v-model="editor.wheelFontChangeEnabled" type="checkbox" /><span>按 Ctrl+鼠标滚轮改变字号（终端）</span></label>
            <label class="field-row"><span>终端基准字号</span><input v-model.number="editor.terminalBaseFontSize" type="number" min="4" max="40" step="1" /></label>
          </fieldset>
        </form>

        <form
          v-show="section === 'editor.preferences.appearance'" :id="`${id}-panel-editor.preferences.appearance`" :ref="registerEditorForm" class="settings-panel" data-page="editor.preferences.appearance"
          role="tabpanel" :aria-labelledby="`${id}-tab-editor.preferences.appearance`" :aria-busy="busy" @submit.prevent="applyEditor()"
        >
          <h3>编辑器 › 常规 › 外观</h3>
          <div class="editor-page-head">
            <button type="button" class="subtle-button" @click="resetEditorPage()">恢复默认</button>
          </div>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="editor.lineNumbers" type="checkbox" /><span>显示行号</span></label>
            <label class="checkbox-row"><input v-model="editor.showWhitespaces" type="checkbox" /><span>显示空白符号</span></label>
            <label class="checkbox-row"><input v-model="editor.showIndentGuides" type="checkbox" /><span>显示缩进参考线</span></label>
            <label class="checkbox-row"><input v-model="editor.bracketMatching" type="checkbox" /><span>括号匹配高亮</span></label>
            <div class="input-row"><label :for="`${id}-line-numeration`">行号排法</label><select :id="`${id}-line-numeration`" v-model="editor.lineNumeration"><option value="absolute">绝对</option><option value="relative">相对</option><option value="hybrid">混合</option></select></div>
          </fieldset>
        </form>

        <section v-show="section === 'editor.preferences.tabs'" :id="`${id}-panel-editor.preferences.tabs`" class="settings-panel" data-page="editor.preferences.tabs" role="tabpanel" :aria-labelledby="`${id}-tab-editor.preferences.tabs`" :aria-busy="busy"><EditorTabsSettingsPage :settings="editor" :busy="busy" :invalid-tab-limit="!validEditor" :id-prefix="id" @reset="resetEditorPage()" /></section>

        <form
          v-show="section === 'editor.preferences.smartKeys'" :id="`${id}-panel-editor.preferences.smartKeys`" :ref="registerEditorForm" class="settings-panel" data-page="editor.preferences.smartKeys"
          role="tabpanel" :aria-labelledby="`${id}-tab-editor.preferences.smartKeys`" :aria-busy="busy" @submit.prevent="applyEditor()"
        >
          <h3>编辑器 › 常规 › 智能键</h3>
          <div class="editor-page-head">
            <button type="button" class="subtle-button" @click="resetEditorPage()">恢复默认</button>
          </div>
          <fieldset class="settings-fields" :disabled="busy">
            <div class="input-row">
              <label :for="`${id}-reformat-on-paste`">粘贴时</label>
              <select :id="`${id}-reformat-on-paste`" v-model="editor.reformatOnPaste">
                <option v-for="mode in PASTE_REFORMAT_MODES" :key="mode" :value="mode">{{ pasteReformatLabel(mode) }}</option>
              </select>
            </div>
            <EditorEnterKeysFields :settings="editor" :busy="busy" />
          </fieldset>
        </form>

        <form
          v-show="section === 'editor.preferences.gutterIcons'" :id="`${id}-panel-editor.preferences.gutterIcons`" :ref="registerEditorForm" class="settings-panel" data-page="editor.preferences.gutterIcons"
          role="tabpanel" :aria-labelledby="`${id}-tab-editor.preferences.gutterIcons`" :aria-busy="busy" @submit.prevent="applyEditor()"
        >
          <h3>编辑器 › 常规 › 装订线图标</h3>
          <div class="editor-page-head">
            <button type="button" class="subtle-button" @click="resetEditorPage()">恢复默认</button>
          </div>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="editor.showGutterIcons" type="checkbox" /><span>显示装订线图标</span></label>
          </fieldset>
        </form>

        <section v-show="section === 'editor.preferences.folding'" :id="`${id}-panel-editor.preferences.folding`" class="settings-panel" data-page="editor.preferences.folding" role="tabpanel" :aria-labelledby="`${id}-tab-editor.preferences.folding`" :aria-busy="busy">
          <CodeFoldingSettingsPage :settings="editor" :busy="busy" @reset="resetEditorPage()" />
        </section>

        <section v-show="section === 'inlay.hints'" :id="`${id}-panel-inlay.hints`" class="settings-panel" data-page="inlay.hints" role="tabpanel" :aria-labelledby="`${id}-tab-inlay.hints`" :aria-busy="busy">
          <InlayHintsSettingsPage :settings="editor" :busy="busy" />
        </section>

        <section v-show="section === 'code.vision'" :id="`${id}-panel-code.vision`" class="settings-panel" data-page="code.vision" role="tabpanel" :aria-labelledby="`${id}-tab-code.vision`" :aria-busy="busy"><CodeVisionSettingsPage :settings="editor" :busy="busy" /></section>

        <form
          v-show="section === 'preferences.sourceCode.indents'" :id="`${id}-panel-editor.codeStyle.indents`" :ref="registerEditorForm" class="settings-panel" data-page="preferences.sourceCode.indents"
          role="tabpanel" :aria-labelledby="`${id}-tab-editor.codeStyle.indents`" :aria-busy="busy" @submit.prevent="applyEditor()"
        >
          <h3>编辑器 › 代码风格 › 制表符与缩进</h3>
          <div class="editor-page-head">
            <button type="button" class="subtle-button" @click="resetEditorPage()">恢复默认</button>
          </div>
          <fieldset class="settings-fields" :disabled="busy">
            <div class="input-row">
              <label :for="`${id}-tab-size`">缩进宽度</label>
              <select :id="`${id}-tab-size`" v-model.number="editor.tabSize">
                <option v-for="size in [2, 4, 8]" :key="size" :value="size">{{ sizeLabel(size) }}</option>
              </select>
            </div>
            <label class="checkbox-row"><input v-model="editor.useTabCharacter" type="checkbox" /><span>使用制表符（Tab 字符）缩进</span></label>
          </fieldset>
        </form>

        <form
          v-show="section === 'tools.actionsOnSave'" :id="`${id}-panel-tools.actionsOnSave`" :ref="registerEditorForm" class="settings-panel" data-page="tools.actionsOnSave"
          role="tabpanel" :aria-labelledby="`${id}-tab-tools.actionsOnSave`" :aria-busy="busy" @submit.prevent="applyFormatOnSave()"
        >
          <h3>工具 › 保存时操作</h3>
          <div class="editor-page-head">
            <button v-if="projectSettings" type="button" class="subtle-button" @click="resetFormatOnSave()">恢复默认</button>
          </div>
          <fieldset class="settings-fields" :disabled="busy">
            <label v-if="projectSettings" class="checkbox-row"><input v-model="projectFormatOnSave" type="checkbox" /><span>保存时格式化代码</span></label>
          </fieldset>
        </form>

        <section
          v-show="section === 'advanced'"
          :id="`${id}-panel-advanced`"
          class="settings-panel"
          data-page="advanced"
          role="tabpanel"
          :aria-labelledby="`${id}-tab-advanced`"
        >
          <h3>高级设置</h3>
          <div class="advanced-toolbar">
            <button type="button" class="primary-button" :disabled="busy || advancedErrors.size > 0" @click="applyAdvanced">应用更改</button>
            <button type="button" class="subtle-button" @click="copyInternalSettings">复制为 JSON</button>
            <span class="field-hint">共 {{ internalSettingRows.length }} 项<template v-if="copyHint"> · {{ copyHint }}</template></span>
          </div>
          <div class="advanced-table" role="table" aria-label="内部设置">
            <div v-for="row in internalSettingRows" :key="row.group + row.key" class="advanced-row" role="row">
              <span class="advanced-group" role="cell">{{ row.group }}</span>
              <code class="advanced-key" role="cell">{{ row.key }}</code>
              <input
                class="advanced-value" role="cell" :value="row.value"
                :class="{ invalid: advancedErrors.has(`${row.group}:${row.key}`) }"
                :aria-label="`${row.group} 的 ${row.key}`"
                @change="editInternalSetting(row.group, row.key, ($event.target as HTMLInputElement).value)"
              />
            </div>
          </div>
        </section>

        <section v-show="section === 'editor.breadcrumbs'" :id="`${id}-panel-editor.breadcrumbs`" class="settings-panel" data-page="editor.breadcrumbs" role="tabpanel" :aria-labelledby="`${id}-tab-editor.breadcrumbs`" :aria-busy="busy">
          <h3>编辑器 › 面包屑</h3>
            <!-- IDEA BreadcrumbsConfigurableUI.kt:44-70 三段：显示开关 → 位置单选（上/下，随总开关禁用）
                 → 按语言的开关（mapLanguageBreadcrumbs，只存显式配置过的语言）。
                 最后那个「配置面包屑颜色」链接指向颜色方案页（ColorAndFontOptions），本仓没有色板页，
                 登记在 class-parity-todo.md 里，不渲染假链接。 -->
            <label class="checkbox-row"><input v-model="settings.showBreadcrumbs" type="checkbox" /><span>显示面包屑</span></label>
            <div class="checkbox-row" role="radiogroup" aria-label="面包屑位置" :aria-disabled="!settings.showBreadcrumbs">
              <span>位置</span>
              <label><input v-model="settings.breadcrumbsPlacement" type="radio" value="top" :disabled="!settings.showBreadcrumbs" /><span>编辑器上方</span></label>
              <label><input v-model="settings.breadcrumbsPlacement" type="radio" value="bottom" :disabled="!settings.showBreadcrumbs" /><span>编辑器下方</span></label>
            </div>
            <div class="checkbox-row">
              <span>语言</span>
              <label v-for="language in EDITOR_LANGUAGES" :key="language">
                <input
                  type="checkbox"
                  :checked="breadcrumbsShownFor(settings, language)"
                  :disabled="!settings.showBreadcrumbs"
                  @change="settings.breadcrumbsLanguages = { ...settings.breadcrumbsLanguages, [language]: !breadcrumbsShownFor(settings, language) }"
                />
                <span>{{ language }}</span>
              </label>
            </div>
        </section>

        <section v-show="section === 'editor.stickyLines'" :id="`${id}-panel-editor.stickyLines`" class="settings-panel" data-page="editor.stickyLines" role="tabpanel" :aria-labelledby="`${id}-tab-editor.stickyLines`" :aria-busy="busy">
          <h3>编辑器 › 粘性行</h3>
            <!-- IDEA StickyLinesConfigurable（`editor.stickyLines`）。 -->
            <label class="checkbox-row"><input v-model="settings.showStickyLines" type="checkbox" /><span>在编辑器顶边固定显示当前作用域</span></label>
            <label class="field-row"><span>层数上限</span><input v-model.number="settings.stickyLinesLimit" type="number" min="0" max="10" step="1" :disabled="!settings.showStickyLines" /></label>
        </section>
        <!-- 配色方案（ColorAndFontOptions，intellij.platform.ide.impl.xml:1749-1752，groupWeight=180；引文与常量在 colorSchemeSettingsRegistration.ts）。 --><section v-show="section === 'reference.settingsdialog.IDE.editor.colors'" :id="`${id}-panel-reference.settingsdialog.IDE.editor.colors`" class="settings-panel" data-page="reference.settingsdialog.IDE.editor.colors" role="tabpanel" :aria-labelledby="`${id}-tab-reference.settingsdialog.IDE.editor.colors`" :aria-busy="busy"><ColorSchemeSettingsPage :busy="busy" /></section>
        <section v-show="section === 'Errors'" :id="`${id}-panel-Errors`" class="settings-panel" data-page="Errors" role="tabpanel" :aria-labelledby="`${id}-tab-Errors`" :aria-busy="busy">
          <h3>编辑器 › 检查</h3>
            <!-- IDEA Error highlighting（`Errors` + ErrorOptionsProvider）：TaoCode 用 LSP 诊断，等价开关是显示诊断与 stripe 标记。 -->
            <label class="checkbox-row"><input v-model="settings.showDiagnostics" type="checkbox" /><span>在编辑器里显示错误与警告</span></label>
            <label class="checkbox-row"><input v-model="settings.showErrorStripe" type="checkbox" :disabled="!settings.showDiagnostics" /><span>在滚动条旁显示错误标记</span></label>
        </section>

        <section v-show="section === 'Console'" :id="`${id}-panel-Console`" class="settings-panel" data-page="Console" role="tabpanel" :aria-labelledby="`${id}-tab-Console`" :aria-busy="busy"><ConsoleSettingsPage :settings="general" :busy="busy" /></section>
        <section v-show="section === 'preferences.keymap'" :id="`${id}-panel-preferences.keymap`" class="settings-panel" data-page="preferences.keymap" role="tabpanel" :aria-labelledby="`${id}-tab-preferences.keymap`"><KeymapSettingsPage /></section><section v-show="section === 'agent'" :id="`${id}-panel-agent`" class="settings-panel" data-page="agent" role="tabpanel" :aria-labelledby="`${id}-tab-agent`"><AgentSettingsPage :persist="persistAgent" :workspace-path="projectRoot" :initial-section="agentInitialSection" @navigate="page => { if (PAGE_KEYS.includes(page)) section = page }" /></section>

        <section v-show="section === 'debugger'" :id="`${id}-panel-debugger`" class="settings-panel" data-page="debugger" role="tabpanel" :aria-labelledby="`${id}-tab-debugger`" :aria-busy="busy"><DebuggerSettingsPage :settings="general" :busy="busy" /></section>

        <section v-show="section === 'preferences.externalTools'" :id="`${id}-panel-preferences.externalTools`" class="settings-panel" data-page="preferences.externalTools" role="tabpanel" :aria-labelledby="`${id}-tab-preferences.externalTools`" :aria-busy="busy"><ExternalToolsSettingsPage :settings="general" :busy="busy" @change="Object.assign(general, $event)" /></section>

        <section v-show="section === 'diff.base'" :id="`${id}-panel-diff.base`" class="settings-panel" data-page="diff.base" role="tabpanel" :aria-labelledby="`${id}-tab-diff.base`" :aria-busy="busy">
          <h3>工具 › 差异与合并</h3>
            <!-- IDEA DiffSettingsConfigurable（`diff.base`）：settings.context.lines。 -->
            <label class="field-row"><span>上下文行数</span><input v-model.number="settings.diffContextLines" type="number" min="1" max="100" step="1" /></label>
        </section>

        <section v-show="section === 'build.tools'" :id="`${id}-panel-build.tools`" class="settings-panel" data-page="build.tools" role="tabpanel" :aria-labelledby="`${id}-tab-build.tools`" :aria-busy="busy">
          <h3>构建、执行、部署 › 构建工具</h3>
                      <BuildToolsSettingsPage :build-tools="projectSettings?.buildTools ?? null" :busy="busy" @save="emit('saveBuildTools', $event)" />
        </section>

        <section v-show="section === 'reference.settingsdialog.project.gradle'" :id="`${id}-panel-reference.settingsdialog.project.gradle`" class="settings-panel" data-page="reference.settingsdialog.project.gradle" role="tabpanel" :aria-labelledby="`${id}-tab-reference.settingsdialog.project.gradle`" :aria-busy="busy">
          <h3>构建、执行、部署 › 构建工具 › Gradle</h3>
          <GradleSettingsPage :gradle="projectSettings?.buildTools?.gradle ?? null" :detection="gradleDetection ?? null" :busy="busy" @save="emit('saveBuildTools', { gradle: $event })" />
        </section>

        <section v-show="section === 'vcs.log'" :id="`${id}-panel-vcs.log`" class="settings-panel" data-page="vcs.log" role="tabpanel" :aria-labelledby="`${id}-tab-vcs.log`" :aria-busy="busy">
          <h3>版本控制 › VCS 日志</h3>
          <!-- IDEA VcsLogApplicationSettings（vcs.log）：日志图的 UI 开关。 -->
          <label class="checkbox-row"><input type="checkbox" :checked="projectSettings?.vcsLog?.showTagNames ?? true" :disabled="!projectSettings || busy" @change="emit('saveVcsLog', { showTagNames: !(projectSettings?.vcsLog?.showTagNames ?? true), showRootNames: projectSettings?.vcsLog?.showRootNames ?? true })" /><span>在日志行上显示标签名</span></label>
          <label class="checkbox-row"><input type="checkbox" :checked="projectSettings?.vcsLog?.showRootNames ?? true" :disabled="!projectSettings || busy" @change="emit('saveVcsLog', { showTagNames: projectSettings?.vcsLog?.showTagNames ?? true, showRootNames: !(projectSettings?.vcsLog?.showRootNames ?? true) })" /><span>显示仓库根名</span></label>
        </section>

        <section v-show="section === 'preferences.toDoOptions'" :id="`${id}-panel-preferences.toDoOptions`" class="settings-panel" data-page="preferences.toDoOptions" role="tabpanel" :aria-labelledby="`${id}-tab-preferences.toDoOptions`" :aria-busy="busy">
          <!-- 注册证据：platform/todo/resources/intellij.platform.todo.xml:49 `groupId="editor" id="preferences.toDoOptions"`。 -->
          <h3>编辑器 › TODO</h3>
          <TodoPatternsPage :patterns="projectSettings?.todoPatterns ?? null" :busy="busy" @save="emit('saveTodoPatterns', $event)" />
        </section>

        <section v-show="section === 'preferences.fileTypes'" :id="`${id}-panel-preferences.fileTypes`" class="settings-panel" data-page="preferences.fileTypes" role="tabpanel" :aria-labelledby="`${id}-tab-preferences.fileTypes`" :aria-busy="busy">
          <!-- 注册证据：intellij.platform.lang.impl.xml:992-994 `groupId="editor" groupWeight="120" id="preferences.fileTypes"`。 -->
          <h3>编辑器 › 文件类型</h3>
          <FileTypesPage :associations="projectSettings?.fileAssociations ?? null" :busy="busy" @save="emit('saveFileAssociations', $event)" />
        </section>

        <section v-show="section === 'editing.templates'" :id="`${id}-panel-templates`" class="settings-panel" data-page="editing.templates" role="tabpanel" :aria-labelledby="`${id}-tab-templates`">
          <h3>实时模板</h3>
          <p v-if="!projectSettings" class="section-description">尚未打开项目。</p>
          <TemplateSettingsPage v-else :settings="projectSettings.templates" :language="templateLanguage" :busy="busy" :project-root="projectRoot" :project-name="moduleName" @change="emit('saveTemplates', $event)" />
        </section>

        <!-- Settings › Version Control › Commit (CommitDialogConfigurable.kt:60-77): the
             Commit Message Inspections group plus the wrap-on-typing checkbox of
             BodyLimitInspection.createOptions (:32-48). -->
        <section v-show="section === 'commit'" :id="`${id}-panel-commit`" class="settings-panel" data-page="commit" role="tabpanel" :aria-labelledby="`${id}-tab-commit`" :aria-busy="busy">
          <h3>提交</h3>
          <h4 class="settings-group-title">提交信息检查</h4>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="commitMessage.subjectLimit" type="checkbox" /><span>限制主题行长度</span></label>
            <div class="input-row">
              <label :for="`${id}-subject-margin`">主题行右边距 <span class="field-hint">（字符）</span></label>
              <input :id="`${id}-subject-margin`" v-model.number="commitMessage.subjectRightMargin" type="number" min="0" max="10000" step="1" :aria-describedby="`${id}-subject-margin-hint`" />
            </div>
            <p v-if="!validCommitMessage" :id="`${id}-subject-margin-hint`" class="field-hint validation-error">提交信息第一行超过右边距即报告「主题不能超过 N 个字符」。默认 72，允许 0–10000。</p>
            <label class="checkbox-row"><input v-model="commitMessage.bodyLimit" type="checkbox" /><span>限制正文行长度</span></label>
            <div class="input-row">
              <label :for="`${id}-body-margin`">正文行右边距 <span class="field-hint">（字符）</span></label>
              <input :id="`${id}-body-margin`" v-model.number="commitMessage.bodyRightMargin" type="number" min="0" max="10000" step="1" :aria-describedby="`${id}-body-margin-hint`" />
            </div>
            <p v-if="!validCommitMessage" :id="`${id}-body-margin-hint`" class="field-hint validation-error">第二行起的每一行超过右边距即报告「正文行不能超过 N 个字符」；「重新格式化提交信息」与「换行」都按这个宽度折行。默认 72，允许 0–10000。</p>
            <label class="checkbox-row"><input v-model="commitMessage.subjectBodySeparation" type="checkbox" /><span>主题与正文之间需要空行</span></label>
          </fieldset>
          <h4 class="settings-group-title">提交信息</h4>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="commitMessage.wrapOnTyping" type="checkbox" /><span>输入达到右边距时自动换行</span></label>
          </fieldset>
        </section>

        <section v-show="section === 'project.scopes'" :id="`${id}-panel-scopes`" class="settings-panel" data-page="scopes" role="tabpanel" :aria-labelledby="`${id}-tab-scopes`" :aria-busy="busy">
          <h3>作用域</h3>
          <ScopesSettingsPage ref="scopesPage" :scopes="projectSettings?.scopes ?? []" :root="projectRoot" :module-name="moduleName" :busy="busy" @save="emit('saveScopes', $event)" />
        </section>
        <section v-show="section === 'project.workspaceFileSearch'" :id="`${id}-panel-project.workspaceFileSearch`" class="settings-panel" data-page="project.workspaceFileSearch" role="tabpanel" :aria-labelledby="`${id}-tab-project.workspaceFileSearch`">
          <WorkspaceFileSearchSettingsPage :root="projectRoot" />
        </section>

        <section v-show="section === 'reference.settings.ide.settings.file-colors'" :id="`${id}-panel-reference.settings.ide.settings.file-colors`" class="settings-panel" data-page="reference.settings.ide.settings.file-colors" role="tabpanel" :aria-labelledby="`${id}-tab-reference.settings.ide.settings.file-colors`" :aria-busy="busy">
          <h3>文件颜色</h3>
          <FileColorsSettingsPage ref="fileColorsPage" v-model:enabled="editor.fileColorsEnabled" v-model:for-tabs="editor.fileColorsForTabs" v-model:for-project-view="editor.fileColorsForProjectView" :local-colors="projectSettings?.localFileColors ?? []" :file-colors="projectSettings?.fileColors ?? []" :scopes="projectSettings?.scopes ?? []" :root="projectRoot" :busy="busy" @manage-scopes="section = 'project.scopes'" />
        </section>

        <section v-show="section === 'trusted.hosts'" :id="`${id}-panel-trusted.hosts`" class="settings-panel" data-page="trusted.hosts" role="tabpanel" :aria-labelledby="`${id}-tab-trusted.hosts`" :aria-busy="busy"><TrustedLocationsSettingsPage :general="general" :busy="busy" /></section>
        <section v-show="section === 'ide.audiocues'" :id="`${id}-panel-ide.audiocues`" class="settings-panel" data-page="ide.audiocues" role="tabpanel" :aria-labelledby="`${id}-tab-ide.audiocues`" :aria-busy="busy"><AudioCuesSettingsPage :settings="general" :busy="busy" /></section>
        <section v-show="section === 'preferences.general'" :id="`${id}-panel-general`" class="settings-panel" data-page="general" role="tabpanel" :aria-labelledby="`${id}-tab-general`" :aria-busy="busy">
          <!-- Source: GeneralSettingsConfigurable.kt:95-185 (createPanel). Row order, groups
               and every option mirror the Kotlin DSL panel; labels follow IdeBundle /
               ProjectConceptBundle strings. -->
          <h3>系统设置</h3>
          <h4 class="settings-group-title">退出确认</h4>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="general.confirmExit" type="checkbox" /><span>退出 IDE 前确认</span></label>
          </fieldset>
          <h4 class="settings-group-title">当关闭带有运行进程的工具窗口时：</h4>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="general.processCloseConfirmation" type="radio" value="TERMINATE" name="process-close" /><span>终止进程</span></label>
            <label class="checkbox-row"><input v-model="general.processCloseConfirmation" type="radio" value="DISCONNECT" name="process-close" /><span>断开连接</span></label>
            <label class="checkbox-row"><input v-model="general.processCloseConfirmation" type="radio" value="ASK" name="process-close" /><span>询问</span></label>
          </fieldset>
          <h4 class="settings-group-title">项目</h4>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="general.reopenLastProject" type="checkbox" /><span>启动时重新打开项目</span></label>
            <!-- IDEA's 打开项目于 (GeneralSettings.confirmOpenNewProject, :120-135 +
                 :157-168 for the constants) is not rendered: NEW_WINDOW goes through
                 ProjectManagerImpl.kt:1249-1257 -> processPerProjectSupport().openInChildProcess(),
                 i.e. a separate OS window/process, and ASK (-1, IDEA's default) exists to offer
                 exactly that choice. TaoCode is single-window and single-process, so two of the
                 three options could never take effect — the state field is still carried and
                 validated like IDEA's, it just has no control here. -->
            <div class="input-row">
              <label :for="`${id}-default-dir`">默认项目目录：</label>
              <input :id="`${id}-default-dir`" v-model="general.defaultProjectDirectory" type="text" spellcheck="false" />
            </div>
          </fieldset>
          <h4 class="settings-group-title">文件</h4>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="general.deleteToBin" type="checkbox" /><span>将文件移入回收站而不是永久删除</span></label>
            <div class="input-row">
              <label class="checkbox-row" :for="`${id}-idle-timeout`"><input v-model="general.autoSaveIfInactive" type="checkbox" /><span>IDE 空闲</span></label>
              <input :id="`${id}-idle-timeout`" v-model.number="general.inactiveTimeout" type="number" min="1" max="300" step="1" :disabled="!general.autoSaveIfInactive" aria-describedby="idle-timeout-hint" />
              <span class="field-hint">秒后自动保存文件</span>
            </div>
            <p v-if="!validInactiveTimeout" id="idle-timeout-hint" class="field-hint validation-error">空闲自动保存的超时范围是 1–300 秒（GeneralSettings.SAVE_FILES_AFTER_IDLE_SEC，默认 15）。</p>
            <label class="checkbox-row"><input v-model="general.autoSaveFiles" type="checkbox" /><span>切换到其他应用或内置终端时保存文件</span></label>
            <label class="checkbox-row"><input v-model="general.isUseSafeWrite" type="checkbox" /><span>保存前备份文件</span></label>
            <!-- 上游只用注册表键、没有设置页入口的那两项（见该组件头）。 -->
            <GeneralRegistryToggles :general="general" />
          </fieldset>
          <template v-if="isDesktop">
            <h4 class="settings-group-title">浏览器</h4>
            <fieldset class="settings-fields" :disabled="busy">
              <label class="checkbox-row"><input v-model="general.embeddedBrowserAllowInsecureCertificates" type="checkbox" /><span>忽略证书校验</span></label>
              <div class="browser-data-actions">
                <button class="subtle-button" type="button" :disabled="browserDataClearing !== null" @click="clearEmbeddedBrowserData('cache')">清除缓存</button>
                <button class="subtle-button menu-danger-solid" type="button" :disabled="browserDataClearing !== null" @click="browserDataConfirm = true">清除全部</button>
              </div>
              <p v-if="browserDataStatus" class="browser-data-status" role="status">{{ browserDataStatus }}</p>
              <p v-if="browserDataError" class="browser-data-error" role="alert">{{ browserDataError }}</p>
            </fieldset>
            <div v-if="browserDataConfirm" class="modal-backdrop" @click.self="browserDataConfirm = false">
              <section class="help-dialog browser-data-confirm" role="alertdialog" aria-modal="true" aria-labelledby="browser-clear-title">
                <h2 id="browser-clear-title">清除全部内置浏览器数据？</h2>
                <div class="browser-data-actions">
                  <button class="subtle-button" type="button" autofocus @click="browserDataConfirm = false">取消</button>
                  <button class="subtle-button menu-danger-solid" type="button" @click="confirmClearEmbeddedBrowserData">确认清除</button>
                </div>
              </section>
            </div>
          </template>
          <h4 class="settings-group-title">同步外部更改：</h4>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="general.autoSyncFiles" type="checkbox" /><span>切换到 IDE 窗口或打开编辑器标签页时</span></label>
            <label class="checkbox-row"><input v-model="general.backgroundSyncFiles" type="checkbox" /><span>IDE 空闲时周期性同步（实验性）</span></label>
          </fieldset>
          <div class="input-row"><button type="button" class="subtle-button" :disabled="busy" @click="resetGeneralPage">重置本页</button></div>
        </section>

        <section v-show="section === 'ide.date.format'" :id="`${id}-panel-ide.date.format`" class="settings-panel" data-page="ide.date.format" role="tabpanel" :aria-labelledby="`${id}-tab-ide.date.format`" :aria-busy="busy">
          <h3>日期格式</h3>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="general.overrideSystemDateFormat" type="checkbox" /><span>覆盖系统日期和时间格式</span></label>
            <div class="input-row">
              <label :for="`${id}-date-format-pattern`">日期格式：</label>
              <input :id="`${id}-date-format-pattern`" v-model="general.dateFormatPattern" class="date-format-pattern" type="text" spellcheck="false" :disabled="!general.overrideSystemDateFormat" :aria-invalid="Boolean(datePatternIssue)" />
            </div>
            <output v-if="dateFormatPreview" class="field-hint date-format-preview">{{ dateFormatPreview }}</output>
            <p v-if="general.overrideSystemDateFormat && datePatternIssue" class="field-hint validation-error">{{ datePatternIssue.includes('time patterns') ? '日期格式不能包含时间字段（小时、分钟、秒）' : '无效的日期格式' }}</p>
            <label class="checkbox-row"><input v-model="general.use24HourTime" type="checkbox" :disabled="!general.overrideSystemDateFormat" /><span>使用 24 小时制</span></label>
          </fieldset>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="general.prettyFormattingAllowed" type="checkbox" /><span>使用美化格式</span></label>
          </fieldset>
        </section>
      </div>
    </div>
    <footer class="dialog-footer">
      <span class="save-status" role="status">{{ copyNote || (busy ? '正在保存，请稍候…' : section === 'preferences.lookFeel' ? '主题即时生效' : section === 'editing.templates' ? '模板改动即时保存到本项目' : PROJECT_SCOPED_PAGES.has(section) ? '本页改动需保存后才写入项目' : dirty ? '有未应用的修改' : '已应用') }}</span>
      <div class="footer-actions"><!-- 顺序照 `SettingsDialog.createActions()`（`:203-218`）：OK/Cancel 先入数组、Apply 追加 ⇒ 确定 / 取消 / 应用(A)。 -->
        <button type="button" class="primary-button" :disabled="busy" @click="ok">确定</button>
        <button type="button" class="subtle-button" :disabled="busy" @click="close">取消</button>
        <button type="button" class="subtle-button" :disabled="busy || !dirty" @click="applyAll()">应用(A)</button>
      </div>
    </footer>
  </dialog>
</template>

<style scoped>
.settings-dialog { position: fixed; inset: 0; width: min(1120px, 96vw); height: min(700px, 90dvh); max-width: calc(100vw - 32px); max-height: calc(100dvh - 32px); margin: auto; padding: 0; overflow: hidden; color: var(--text); border: 1px solid var(--line-strong); border-top: 3px solid var(--accent); border-radius: var(--radius-xs); background: var(--editor); box-shadow: var(--shadow-3); }
.settings-dialog[open] { display: flex; flex-direction: column; }
.settings-dialog::backdrop { background: var(--backdrop); }
.settings-dialog:focus { outline: none; }
.dialog-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-shrink: 0; padding: var(--space-3) var(--space-5); border-bottom: 1px solid var(--line-strong); background: var(--rail); }
.settings-dialog .dialog-title { margin: 0; padding: 0; font: 650 19px/1.3 var(--font-ui); letter-spacing: -.025em; color: var(--bright); }
.settings-layout { display: grid; grid-template-columns: 218px minmax(0, 1fr); flex: 1; min-width: 0; min-height: 0; }
.settings-navigation { display: flex; flex-direction: column; gap: 2px; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-color: var(--scrollbar) var(--rail); scrollbar-width: thin; padding: var(--space-3) var(--space-2); border-right: 1px solid var(--line-strong); background: var(--rail); }
.settings-filter { position: sticky; top: var(--space-3); z-index: 2; display: flex; align-items: center; gap: var(--space-1); flex-shrink: 0; margin: 0 0 var(--space-2); padding: var(--space-1) var(--space-2); min-height: 30px; background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); color: var(--muted); }
.settings-filter:focus-within { border-color: var(--accent); }
.settings-filter input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--text); font: inherit; }
.settings-filter input::placeholder { color: var(--muted); }
/* SearchTextField's leading history affordance (:119-124): the field's leading area is clickable
   when there is history, and the popup is aligned underneath the field (:459). */
.settings-search-icon { display: inline-flex; align-items: center; padding: 0; border: 0; background: none; color: inherit; }
.settings-search-icon.has-history { cursor: pointer; transition: color var(--dur-1) var(--ease); }
.settings-search-icon.has-history:hover, .settings-search-icon.has-history:focus-visible { color: var(--text); }
.settings-history-popup { position: fixed; z-index: 30; display: flex; flex-direction: column; max-width: 320px; padding: 2px; background: var(--elevated); color: var(--popup-foreground); border: var(--popup-border); border-radius: var(--popup-radius); box-shadow: var(--popup-shadow); }
.settings-history-item { text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.settings-history-item.active { background: var(--selected); color: var(--bright); }
.settings-group-label { padding: var(--space-2) var(--space-2) var(--space-1); color: var(--muted); font-size: 10px; font-weight: 650; letter-spacing: .045em; }
.settings-tab { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; min-height: var(--ctrl-height-lg); padding: var(--space-1) var(--space-2); border: 0; background: transparent; color: var(--secondary); border-radius: 0; text-align: left; }
.settings-tab:hover { background: var(--hover); }
.settings-tab > svg { flex-shrink: 0; }
.settings-tab[aria-selected='true'] { color: var(--bright); background: var(--selected); box-shadow: inset 3px 0 0 var(--accent); font-weight: 650; }
.settings-group { color: var(--text); font-weight: 600; }
.settings-child { margin-left: var(--space-5); }
.settings-grandchild { margin-left: calc(var(--space-5) * 2); }
.settings-caret { transition: transform var(--dur-1) var(--ease); }
.settings-caret-closed { transform: rotate(-90deg); }
.settings-empty { margin: var(--space-2); color: var(--muted); font-size: 11px; }
/* IDEA's right-aligned new-options marker (SettingsTreeView.java:791 `setRightIcon(NEW_BADGE_DOT)`,
   a `LargeBlueDotIcon`; the accessible text is IdeBundle `badge.text.new`). */
.settings-new-dot { width: 6px; height: 6px; flex-shrink: 0; margin-left: auto; border-radius: var(--radius-pill); background: var(--accent); }
.settings-content { min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-color: var(--scrollbar) var(--editor); scrollbar-width: thin; scroll-padding-block: var(--space-5); padding: var(--space-5) clamp(var(--space-4), 3vw, var(--space-6)); }
.settings-breadcrumb { display: flex; align-items: center; gap: 2px; margin-bottom: var(--space-5); padding-bottom: var(--space-3); border-bottom: 1px solid var(--line); }
.settings-crumbs { display: inline-flex; align-items: center; gap: var(--space-1); margin-left: var(--space-2); color: var(--secondary); font-size: 13px; }
.crumb-group { color: var(--secondary); }
.crumb-current { color: var(--bright); font-weight: 600; }
.crumb-sep { color: var(--muted); }
.settings-error { border: 1px solid var(--error); border-radius: var(--radius-xs); margin-bottom: var(--space-4); }
.settings-panel { min-width: 0; }
.settings-panel h3 { display: flex; align-items: center; gap: var(--space-3); margin: 0 0 var(--space-4); font-size: 21px; line-height: 1.25; letter-spacing: -.025em; color: var(--bright); font-weight: 700; }
.settings-panel h3::before { content: ''; width: 3px; height: 1.15em; flex: 0 0 3px; border-radius: 0; background: var(--accent); }
.section-description { margin: 0 0 var(--space-5); color: var(--secondary); line-height: 1.8; overflow-wrap: anywhere; }
.theme-options { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.theme-option { display: inline-flex; align-items: center; gap: var(--space-2); flex: 0 1 170px; min-width: 130px; min-height: var(--ctrl-height-lg); padding: var(--space-2) var(--space-3); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--panel); color: var(--text); line-height: 18px; transition: background-color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.theme-option:nth-child(2) { background: var(--editor); }
.theme-option:hover:not(:disabled) { border-color: var(--accent); background: var(--hover); }
.theme-option[aria-pressed='true'] { border-color: var(--accent); background: var(--selected); color: var(--bright); box-shadow: inset var(--space-1) 0 0 0 var(--accent); }
.theme-option:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.theme-option > svg { flex-shrink: 0; }
.theme-option > span { text-align: left; line-height: 18px; }
.settings-group-title { margin: var(--space-6) 0 var(--space-3); padding-bottom: var(--space-2); border-bottom: 1px solid var(--line-strong); color: var(--bright); font-size: 13px; font-weight: 650; }
.zoom-row { display: flex; align-items: center; gap: var(--space-2); }
.zoom-row select { width: 90px; min-height: var(--ctrl-height); padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: inherit; }
.zoom-row .subtle-button { min-height: var(--ctrl-height); font-size: 11px; }
.settings-fields { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; border: 0; padding: 0; margin: 0; }
.browser-data-actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.browser-data-status, .browser-data-error { margin: 0; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.browser-data-status { color: var(--success); }
.browser-data-error { color: var(--error); }
.browser-data-confirm { width: 400px; }
.browser-data-confirm h2 { margin: 0 0 var(--space-4); }
.input-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2) var(--space-4); }
.input-row label, .field-label { color: var(--text); font-weight: 500; }
.input-row input, .input-row select { width: 118px; max-width: 100%; min-width: 0; min-height: var(--ctrl-height); padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: inherit; }
.input-row .date-format-pattern { width: min(260px, 100%); }
.field-hint { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; font-weight: 400; }
/* A field followed by its hint sits tight against it; the group stays apart from the next row. */
.field-label + .field-hint, .settings-fields :is(input, select, textarea) + .field-hint { margin-top: calc(var(--space-3) * -1 + 2px); }
.checkbox-row { display: flex; align-items: flex-start; gap: var(--space-2); cursor: pointer; }
.checkbox-row input { flex-shrink: 0; width: var(--icon-size-checkbox); height: var(--icon-size-checkbox); margin: 2px 0 0; accent-color: var(--accent); }
.checkbox-row span { min-width: 0; overflow-wrap: anywhere; }
.restore-hint { padding-left: var(--space-5); }
.validation-error { margin: 0; color: var(--error); font-size: 11px; }
.dialog-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); flex-shrink: 0; min-height: var(--tool-window-header-h); padding: var(--space-2) var(--space-5); border-top: 1px solid var(--line-strong); background: var(--panel); }
.settings-hint { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--muted); font-size: 11px; margin-right: auto; }
.save-status { flex: 1 1 240px; color: var(--secondary); font-size: 11px; }
.footer-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); }
.footer-actions .primary-button { margin-top: 0; }
@media (max-width: 720px) {
  .settings-layout { grid-template-columns: 170px minmax(0, 1fr); }
  .settings-content { padding: var(--space-4) var(--space-3); }
}
@media (max-width: 560px) {
  .settings-dialog { max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); }
  .settings-layout { grid-template-columns: 120px minmax(0, 1fr); }
  .settings-navigation { padding: var(--space-3) var(--space-1); }
  .settings-tab { padding: var(--space-2) var(--space-2); gap: var(--space-1); }
  .settings-tab > svg { display: none; }
  .settings-content { padding: var(--space-4) var(--space-3); }
  .dialog-header, .dialog-footer { padding: var(--space-3) var(--space-3); }
  .theme-option { padding: var(--space-2) var(--space-3); }
  .restore-hint { padding-left: 0; }
}
.advanced-toolbar { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-2) 0; }
.advanced-table { display: flex; flex-direction: column; max-height: 52vh; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.advanced-row { display: grid; grid-template-columns: 60px minmax(200px, 32%) minmax(0, 1fr); gap: var(--space-2); padding: 3px var(--space-2); border-bottom: 1px solid var(--line); font-size: 11px; }
.advanced-row:last-child { border-bottom: 0; }
.advanced-group { color: var(--muted); }
.advanced-key { color: var(--bright); overflow-wrap: anywhere; }
.advanced-value { width: 100%; min-width: 0; padding: 1px var(--space-1); border: 1px solid transparent; border-radius: var(--radius-xs); background: transparent; color: var(--secondary); font: inherit; transition: border-color var(--dur-1) var(--ease); }
.advanced-value:hover { border-color: var(--line); }
.advanced-value:focus { border-color: var(--accent); background: var(--editor); outline: none; }
.advanced-value.invalid { border-color: var(--warning); color: var(--warning); }
</style>
