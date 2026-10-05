<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { languageFor } from '../templates'
import { copyToClipboard } from '../clipboard'
import { defaultEditorSettings } from '../bridge'
import { isNameHit, matchesOption, optionMatches, resolveSettingsPath, settingsPath } from '../settingsSearch'
import { RIGHT_MARGIN_MAX, RIGHT_MARGIN_MIN, type CommitMessageInspectionSettings } from '../commitMessageInspection'
import { MAX_EDITOR_FONT_SIZE, MIN_EDITOR_FONT_SIZE } from '../editorFontSize.ts'
import { addHistoryEntry, formatHistory, parseHistory, popupHistory, SEARCH_HISTORY_LABEL, SETTINGS_SEARCH_HISTORY_KEY, stepHistory, type HistoryDirection } from '../searchHistory'
import { MAX_SHOWS, NEW_BADGE_TEXT, NEW_OPTION_PAGES, badgeStorageKey, markOpened, parseBadgeCount, showNewBadgeDot, showNewOptions, showNewOptionsInGroup, type BadgeCounts } from '../settingsBadge'
import { PASTE_REFORMAT_MODES, pasteReformatLabel } from '../pasteOptions'
import { ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Moon, Save, Search, Sun, X } from 'lucide-vue-next'
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
import FileColorsSettingsPage from './FileColorsSettingsPage.vue'
import GeneralRegistryToggles from './GeneralRegistryToggles.vue'
import { createSettingsSearch } from '../settingsSearchController.ts'
import { createSettingsDraftActions, createSettingsDraftPages, type SettingsDraft } from '../settingsDraft'
import TodoPatternsPage from './TodoPatternsPage.vue'
import FileTypesPage from './FileTypesPage.vue'
import CodeFoldingSettingsPage from './CodeFoldingSettingsPage.vue'
import InlayHintsSettingsPage from './InlayHintsSettingsPage.vue'
import EditorTabsSettingsPage from './EditorTabsSettingsPage.vue'
import ConsoleSettingsPage from './ConsoleSettingsPage.vue'; import TrustedLocationsSettingsPage from './TrustedLocationsSettingsPage.vue' // 宿主贴死 1356 行上限，两个页面导入同一行
import DebuggerSettingsPage from './DebuggerSettingsPage.vue'
import AudioCuesSettingsPage from './AudioCuesSettingsPage.vue'
import KeymapSettingsPage from './KeymapSettingsPage.vue'
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
    | 'preferences.sourceCode.indents' | 'tools.actionsOnSave' | 'editing.templates' | 'commit' | 'preferences.general'
    | 'build.tools' | 'reference.settingsdialog.project.gradle' | null
  /** IDEA's commit-message inspections (Settings › Version Control › Commit). */
  commitMessageSettings: CommitMessageInspectionSettings
  /** IDEA's GeneralSettings (ide.general.xml): the System Settings page's backing state. */
  general: GeneralSettingsState
  /** 单隐式模块名（工作区目录名）：作用域模式里的 `file[模块名]:…` 用它。 */
  moduleName: string
  /** 当前项目的 Gradle 检测结果（宿主 `gradle.detect` 的产出）—— Gradle 页显示"检测到什么"。 */
  gradleDetection?: GradleDetection | null
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
// IDEA's commit-message inspections are a second, independent page with its own draft
// (Settings › Version Control › Commit, CommitDialogConfigurable.kt:56-101).
const commitMessage = ref<CommitMessageInspectionSettings>({ ...props.commitMessageSettings })

// Source: GeneralSettingsConfigurable.kt:93 — `GeneralSettings.getInstance().state`
// is the model the panel binds to; TaoCode stages a draft exactly like the other pages.
const general = ref<GeneralSettingsState>({ ...defaultGeneralSettings, ...props.general })
// 控制台折叠规则用多行文本编辑（每行一条），写回字符串数组（对应 IDEA 的两个 AddDeleteListPanel）。
// 高级设置：内部设置键值审计视图（IDEA Registry 的只读等价物）。
// 高级设置＝内部键的可编辑视图（IDEA Registry 的等价物）：值按 JSON 文本编辑，写回**本地副本**，
// 由页面底部的「应用更改」按各自的保存链路提交（editor → save，general → save-general），非法 JSON 会标红。
const advancedErrors = ref(new Set<string>())
const internalSettingRows = computed(() => [
  ...Object.entries(editor.value ?? {}).map(([key, value]) => ({ group: 'editor' as const, key, value: JSON.stringify(value) })),
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
  const payload = JSON.stringify({ editor: editor.value ?? {}, general: general.value ?? {} }, null, 2)
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
const section = ref<PageKey>(props.initialSection && PAGE_KEYS.includes(props.initialSection) ? props.initialSection : 'preferences.lookFeel')

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

// IDEA's breadcrumb (外观与行为 › 外观) plus the back/forward arrows that walk the
// configurables navigation history.
const history = ref<PageKey[]>([])
const future = ref<PageKey[]>([])
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
const tabCharacterHint = computed(() => editor.value.useTabCharacter
  ? '当前插入 Tab 字符，此宽度决定它在编辑器里占多少列。'
  : '当前插入空格；一次缩进等于这里选择的宽度。')
// IDEA's OK/Cancel/Apply triple: 应用 commits without closing and is only enabled
// while the form actually differs from the saved settings.
const editorDirty = computed(() => JSON.stringify(editor.value) !== JSON.stringify(props.settings))
// The commit-message inspections are a second page with its own draft; the spinner range is
// IDEA's `spinner(0..10000)` (SubjectLimitInspection.kt:27, BodyLimitInspection.kt:36).
const commitMessageDirty = computed(() => JSON.stringify(commitMessage.value) !== JSON.stringify(props.commitMessageSettings))
const validCommitMessage = computed(() => [commitMessage.value.subjectRightMargin, commitMessage.value.bodyRightMargin]
  .every(value => Number.isInteger(value) && value >= RIGHT_MARGIN_MIN && value <= RIGHT_MARGIN_MAX))
const generalDirty = computed(() => JSON.stringify(general.value) !== JSON.stringify(props.general))
const { scopesPage, fileColorsPage, dirty } = createSettingsDraftPages(editorDirty, commitMessageDirty, generalDirty)
let previousFocus: HTMLElement | null = null

// Not deep, and skipped while the form is dirty: the parent refreshes `settings` when
// another panel or a project load re-reads them, and a deep watch used to replace the
// half-typed form underneath the user. After a successful save the prop changes while
// the form is clean, which is exactly when this sync runs.
watch(() => props.settings, value => {
  if (editorDirty.value) return
  editor.value = { ...value }
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
  editor.value = { ...defaultEditorSettings }
}
function applyCommitMessage(close = false) {
  if (!props.busy && validCommitMessage.value) emit('saveCommitMessage', { ...commitMessage.value }, close)
}
// GeneralSettings.inactiveTimeout clamps through SAVE_FILES_AFTER_IDLE_SEC.fit
// (GeneralSettings.kt:193-202, UINumericRange.java:21-23): the stored value always
// lands inside [1, 300].
const validGeneral = computed(() => Number.isInteger(general.value.inactiveTimeout) && general.value.inactiveTimeout >= 1 && general.value.inactiveTimeout <= 300)
function applyGeneral(close = false) {
  if (!props.busy && validGeneral.value) emit('saveGeneral', { ...general.value }, close)
}
function resetGeneralPage() {
  general.value = { ...defaultGeneralSettings }
}
const { applyAll, ok } = createSettingsDraftActions({
  editor, general, commitMessage, editorDirty, generalDirty, commitMessageDirty,
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
      <button type="button" class="icon-button" :disabled="busy" :title="busy ? '正在保存，请稍候' : '关闭（Esc）'" aria-label="关闭设置" @click="close"><X :size="iconSize.action" aria-hidden="true" /></button>
    </header>
    <div class="settings-layout">
      <nav class="settings-navigation" role="tablist" aria-label="设置分类" aria-orientation="vertical" @keydown="navigateTabs">
        <label ref="searchBox" class="settings-filter" :class="{ 'settings-filter-error': noMatch }" aria-label="搜索设置">
          <!-- SearchTextField.java:119-124 — the leading area of the field opens the history list
               on a single click (IDEA draws the arrow there); with no history it just focuses. -->
          <button
            type="button" class="settings-search-icon" :class="{ 'has-history': searchHistory.length > 0 }"
            :title="searchHistory.length ? `${SEARCH_HISTORY_LABEL}（Alt+↓）` : '搜索设置'" :aria-label="searchHistory.length ? SEARCH_HISTORY_LABEL : '搜索'"
            aria-haspopup="listbox" :aria-expanded="historyOpen" @click.prevent="onSearchIconClick"
          ><Search :size="iconSize.control" aria-hidden="true" /></button>
          <input
            ref="searchInput" v-model="query" type="search" placeholder="搜索设置" autocomplete="off" spellcheck="false"
            title="查找 (Ctrl+F)" aria-describedby="settings-search-hint" @mousedown="onSearchPointerDown" @keydown.enter.prevent="onSearchEnter"
            @blur="recordSearchHistory()" @keydown.alt.down.prevent="openHistory()" @keydown.alt.up.prevent="stepSearchHistory('prev')"
          />
          <button v-if="query" type="button" class="icon-button" title="清空搜索（Esc）" aria-label="清空搜索" @click="clearSearch"><X :size="iconSize.dense" aria-hidden="true" /></button>
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
        <p id="settings-search-hint" class="settings-search-hint">输入设置页名或选项名过滤；粘贴“文件 | 设置 | …”路径可直接跳转。Esc 清空，Ctrl+F 定位到本框。</p>
        <template v-if="searching">
          <template v-for="group in visibleGroups" :key="group.key">
            <span class="settings-group-label">{{ group.label }}</span>
            <button
              v-for="node in visibleNodes.filter(item => item.parent === group.key)" :id="`${id}-tab-${node.key}`" :key="node.key"
              type="button" class="menu-button settings-tab" role="tab" :aria-selected="section === node.key"
              :aria-controls="`${id}-panel-${node.key}`" :tabindex="section === node.key ? 0 : -1"
              @click="select(node.key)"
            ><component :is="node.icon" :size="iconSize.action" aria-hidden="true" /><span>{{ node.label }}</span><span v-if="pageHasNewBadge(node.key)" class="settings-new-dot" role="img" :aria-label="NEW_BADGE_TEXT" :title="NEW_BADGE_TEXT" /></button>
          </template>
          <!-- 搜索结果：父节点本身不是页面，所以只列匹配到的叶子，按层级缩进 -->
          <button
            v-for="node in visibleNodes.filter(item => !isParentOnly(item.key) && !groups.some(group => group.key === item.parent))" :id="`${id}-tab-${node.key}`" :key="node.key"
            type="button" class="menu-button settings-tab" :class="node.parent ? 'settings-child' : ''"
            role="tab" :aria-selected="section === node.key"
            :aria-controls="`${id}-panel-${node.key}`" :tabindex="section === node.key ? 0 : -1"
            @click="select(node.key)"
          ><component :is="node.icon" :size="iconSize.action" aria-hidden="true" /><span>{{ node.label }}</span><span v-if="pageHasNewBadge(node.key)" class="settings-new-dot" role="img" :aria-label="NEW_BADGE_TEXT" :title="NEW_BADGE_TEXT" /></button>
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
              <span v-if="groupHasNewBadge(group.key)" class="settings-new-dot" role="img" :aria-label="NEW_BADGE_TEXT" :title="NEW_BADGE_TEXT" />
            </button>
            <template v-if="expanded.has(group.key)">
              <!-- 分组下还没有移植任何页面时明说，而不是显示一个点开什么都没有的节点。 -->
              <p v-if="!nodes.some(item => item.parent === group.key)" class="settings-empty">本分组下的设置页尚未移植。</p>
              <button
                v-for="node in nodes.filter(item => item.parent === group.key)" :id="`${id}-tab-${node.key}`" :key="node.key"
                type="button" class="menu-button settings-tab settings-child" role="tab" :aria-selected="section === node.key"
                :aria-controls="`${id}-panel-${node.key}`" :tabindex="section === node.key ? 0 : -1"
                @click="select(node.key)"
              ><component :is="node.icon" :size="iconSize.action" aria-hidden="true" /><span>{{ node.label }}</span><span v-if="pageHasNewBadge(node.key)" class="settings-new-dot" role="img" :aria-label="NEW_BADGE_TEXT" :title="NEW_BADGE_TEXT" /></button>
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
            ><component :is="node.icon" :size="iconSize.action" aria-hidden="true" /><span>{{ node.label }}</span><span v-if="pageHasNewBadge(node.key)" class="settings-new-dot" role="img" :aria-label="NEW_BADGE_TEXT" :title="NEW_BADGE_TEXT" /></button>
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
                  ><component :is="child.icon" :size="iconSize.action" aria-hidden="true" /><span>{{ child.label }}</span><span v-if="pageHasNewBadge(child.key)" class="settings-new-dot" role="img" :aria-label="NEW_BADGE_TEXT" :title="NEW_BADGE_TEXT" /></button>
                  <button
                    v-for="grand in nodes.filter(item => item.parent === child.key)" :id="`${id}-tab-${grand.key}`" :key="grand.key"
                    type="button" class="menu-button settings-tab settings-grandchild" role="tab" :aria-selected="section === grand.key"
                    :aria-controls="`${id}-panel-${grand.key}`" :tabindex="section === grand.key ? 0 : -1"
                    @click="select(grand.key)"
                  ><component :is="grand.icon" :size="iconSize.action" aria-hidden="true" /><span>{{ grand.label }}</span><span v-if="pageHasNewBadge(grand.key)" class="settings-new-dot" role="img" :aria-label="NEW_BADGE_TEXT" :title="NEW_BADGE_TEXT" /></button>
                </template>
              </template>
            </template>
          </template>
        </template>
      </nav>
      <div class="settings-content" :class="{ 'settings-spotlight-on': spotlightActive }">
        <div class="settings-breadcrumb">
          <button type="button" class="icon-button" :disabled="!history.length" title="后退" aria-label="后退" @click="goBack"><ChevronLeft :size="iconSize.action" aria-hidden="true" /></button>
          <button type="button" class="icon-button" :disabled="!future.length" title="前进" aria-label="前进" @click="goForward"><ChevronRight :size="iconSize.action" aria-hidden="true" /></button>
          <span
            class="settings-crumbs" role="button" tabindex="0" title="右键或 Shift+F10 复制设置路径"
            @contextmenu.prevent="openCrumbMenu" @keydown.shift.f10.prevent="openCrumbMenu" @keydown.contextmenu.prevent="openCrumbMenu"
          >
            <template v-if="groupLabel"><span class="crumb-group">{{ groups.find(group => group.key === groupLabel)?.label }}</span><ChevronRight :size="iconSize.inline" class="crumb-sep" aria-hidden="true" /></template>
            <span class="crumb-current">{{ currentLabel }}</span>
          </span>
          <button
            v-if="crumbMenu" type="button" class="menu-button settings-crumb-menu" role="menuitem"
            :style="{ left: `${crumbMenu.x}px`, top: `${crumbMenu.y}px` }"
            title="复制所选设置项的相对路径" @click="copyCrumbPath"
          >复制设置路径</button>
        </div>
        <div v-if="crumbMenu" class="settings-crumb-backdrop" @click="crumbMenu = null" @contextmenu.prevent="crumbMenu = null" />
        <div v-if="error" class="notice error settings-error" role="alert"><span>{{ error }}</span></div>
        <section v-show="section === 'preferences.lookFeel'" :id="`${id}-panel-appearance`" class="settings-panel" data-page="appearance" role="tabpanel" :aria-labelledby="`${id}-tab-appearance`">
          <h3>外观</h3>
          <p class="section-description">主题立即生效；缩放与紧凑模式随“应用”保存并立即作用于整个界面。</p>
          <div class="theme-options" role="group" aria-label="主题">
            <button type="button" class="subtle-button theme-option" :aria-pressed="theme === 'light'" @click="emit('theme', 'light', $event)"><Sun :size="iconSize.action" aria-hidden="true" /><span>月之亮面</span><span class="theme-state">{{ theme === 'light' ? '当前主题' : '切换到月之亮面' }}</span></button>
            <button type="button" class="subtle-button theme-option" :aria-pressed="theme === 'dark'" @click="emit('theme', 'dark', $event)"><Moon :size="iconSize.action" aria-hidden="true" /><span>月之暗面</span><span class="theme-state">{{ theme === 'dark' ? '当前主题' : '切换到月之暗面' }}</span></button>
          </div>
          <fieldset class="settings-fields" :disabled="busy" aria-label="缩放与界面密度">
            <div class="input-row">
              <label :for="`${id}-zoom`">缩放</label>
              <div class="zoom-row">
                <select :id="`${id}-zoom`" v-model.number="editor.uiZoomPercent" :aria-describedby="`${id}-zoom-hint`">
                  <option v-for="percent in [50, 70, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 350, 400]" :key="percent" :value="percent">{{ percent }}%</option>
                </select>
                <button type="button" class="subtle-button" :disabled="editor.uiZoomPercent === 100" title="重置为默认缩放" @click="editor.uiZoomPercent = 100">重置</button>
              </div>
            </div>
            <p :id="`${id}-zoom-hint`" class="field-hint restore-hint">整个界面的缩放百分比（50–400）。与其他外观项一样，点“应用”或“确定”后生效并保存。</p>
            <label class="checkbox-row"><input v-model="editor.compactMode" type="checkbox" :aria-describedby="`${id}-compact-hint`" /><span>紧凑模式</span></label>
            <p :id="`${id}-compact-hint`" class="field-hint restore-hint">界面元素占用更少的屏幕空间（控件高度、标签条与标题栏更矮）。</p>
            <label class="checkbox-row"><input v-model="editor.fullPathsInWindowHeader" type="checkbox" :aria-describedby="`${id}-fullpath-hint`" /><span>在窗口标题中始终显示完整路径</span></label>
            <p :id="`${id}-fullpath-hint`" class="field-hint restore-hint">窗口标题显示项目根目录而不是仅文件夹名，便于区分同名的两个项目。</p>
            <!-- 「状态栏」这一行以前不存在：`showStatusBar` 又被 native 的键白名单漏掉
                 （native/settings_schema.hpp 的 EDITOR_SETTING_KEYS 注释有前后），于是两头都没出口。
                 上游出处：AppearanceOptionsTopHitProvider.kt:33 `cdShowStatusBar`，groupName = viewOptionGroupName。 -->
            <label class="checkbox-row"><input v-model="editor.showStatusBar" type="checkbox" :aria-describedby="`${id}-statusbar-hint`" /><span>状态栏</span></label>
            <p :id="`${id}-statusbar-hint`" class="field-hint restore-hint">在窗口底部显示状态栏（分支、位置、缩进、编码等，右键可逐项增删组件）。</p>
          </fieldset>
          <h4 class="settings-group-title">辅助功能与字体</h4>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="general.supportScreenReaders" type="checkbox" :aria-describedby="`${id}-sr-hint`" /><span>支持屏幕阅读器</span></label>
            <p :id="`${id}-sr-hint`" class="field-hint restore-hint">通知会通过无障碍实时区域朗读；同时关闭鼠标悬停的工具提示（提示文字转为无障碍名称保留）。</p>
          </fieldset>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="editor.useContrastScrollbars" type="checkbox" :aria-describedby="`${id}-contrast-hint`" /><span>使用对比度滚动条</span></label>
            <p :id="`${id}-contrast-hint`" class="field-hint restore-hint">滚动条加粗并使用高对比配色，便于在低对比屏幕上找到。</p>
            <div class="input-row">
              <label :for="`${id}-colorblind`">针对色觉缺陷调整颜色</label>
              <select :id="`${id}-colorblind`" v-model="editor.colorBlindness">
                <option value="none">不调整</option>
                <option value="deuteranopia">绿色盲（deuteranopia）</option>
                <option value="protanopia">红色盲（protanopia）</option>
                <option value="tritanopia">蓝黄色盲（tritanopia）</option>
              </select>
            </div>
            <p class="field-hint restore-hint">通过颜色矩阵滤镜调整整个界面的配色（IDEA 的 “Adjust colors for colour vision deficiency”）。</p>
            <div class="input-row">
              <label :for="`${id}-font-family`">界面字体</label>
              <input :id="`${id}-font-family`" v-model.trim="editor.uiFontFamily" type="text" placeholder="留空使用系统字体" :maxlength="120" />
            </div>
            <div class="input-row">
              <label :for="`${id}-font-size`">界面字号 <span class="field-hint">（像素）</span></label>
              <input :id="`${id}-font-size`" v-model.number="editor.uiFontSize" type="number" min="9" max="24" step="1" />
            </div>
            <p class="field-hint restore-hint">界面字体与字号（编辑器字体在“编辑器”页单独设置）；字号 9–24，与上面的缩放叠加生效。</p>
          </fieldset>
          <div class="input-row">
            <label>背景图像</label>
            <div class="zoom-row">
              <button type="button" class="subtle-button" :disabled="busy" @click="emit('pickBackground')">{{ editor.backgroundImagePath ? '更换图像…' : '背景图像…' }}</button>
              <button v-if="editor.backgroundImagePath" type="button" class="subtle-button" :disabled="busy" @click="emit('clearBackground')">移除</button>
            </div>
          </div>
          <p class="field-hint restore-hint">{{ editor.backgroundImagePath ? `当前：${editor.backgroundImagePath}` : '未设置背景图像。选择后立即应用（PNG / JPEG / GIF / WebP / BMP / SVG，最大 16 MiB）。' }}</p>
          <div v-if="editor.backgroundImagePath" class="settings-fields">
            <div class="input-row">
              <label :for="`${id}-bg-fill`">显示方式</label>
              <select :id="`${id}-bg-fill`" v-model="editor.backgroundImageFill">
                <option value="scale">缩放填充</option>
                <option value="tile">平铺</option>
                <option value="center">居中原始大小</option>
              </select>
            </div>
            <label class="checkbox-row"><input v-model="editor.backgroundImageKeepRatio" type="checkbox" :disabled="editor.backgroundImageFill !== 'scale'" /><span>保持宽高比（缩放模式下）</span></label>
            <div class="input-row">
              <label :for="`${id}-bg-opacity`">不透明度 <span class="field-hint">（%）</span></label>
              <input :id="`${id}-bg-opacity`" v-model.number="editor.backgroundImageOpacity" type="number" min="0" max="100" step="5" />
            </div>
          </div>
          <h4 class="settings-group-title">演示模式</h4>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="editor.presentationMode" type="checkbox" :aria-describedby="`${id}-pres-hint`" /><span>演示模式</span></label>
            <p :id="`${id}-pres-hint`" class="field-hint restore-hint">隐藏工具栏与状态栏等界面装饰，用于投屏讲解（等同进入专注模式）。</p>
            <div class="input-row">
              <label :for="`${id}-pres-size`">演示字号 <span class="field-hint">（像素）</span></label>
              <input :id="`${id}-pres-size`" v-model.number="editor.presentationModeFontSize" type="number" min="12" max="72" step="2" />
            </div>
          </fieldset>
          <h4 class="settings-group-title">主菜单</h4>
          <fieldset class="settings-fields" :disabled="busy">
            <div class="input-row">
              <!-- 条目顺序 = `MainMenuDisplayMode` 的**声明顺序**（AppearanceConfigurable.kt:509
                   `CollectionComboBoxModel(MainMenuDisplayMode.entries)`），显示文本 = 各档的
                   `description`（MainMenuDisplayMode.kt:14-16 → CoreBundle.properties:157-159）。
                   标签文本 = IdeBundle.properties:3282 `main.menu.combobox.label=Main menu:`。 -->
              <label :for="`${id}-main-menu`">主菜单</label>
              <select :id="`${id}-main-menu`" v-model="editor.mainMenuDisplayMode">
                <option value="hamburger">隐藏在汉堡按钮下方</option>
                <option value="merged">与主工具栏合并</option>
                <option value="separate">显示在主工具栏上方</option>
              </select>
            </div>
            <p class="field-hint restore-hint">对应 IDEA 的 MainMenuDisplayMode：默认是「隐藏在汉堡按钮下方」（UISettingsState.kt:207），菜单收进一个按钮、与主工具栏同一行；「显示在主工具栏上方」才是菜单与工具栏各一行。</p>
          </fieldset>
          <h4 class="settings-group-title">树视图</h4>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="editor.showTreeIndentGuides" type="checkbox" :aria-describedby="`${id}-tree-guides-hint`" /><span>显示缩进参考线</span></label>
            <p :id="`${id}-tree-guides-hint`" class="field-hint restore-hint">在项目树的每个层级边界画一条垂直参考线，随“应用”立即生效。</p>
            <label class="checkbox-row"><input v-model="editor.compactTreeIndents" type="checkbox" :aria-describedby="`${id}-tree-indent-hint`" /><span>使用更小的缩进</span></label>
            <p :id="`${id}-tree-indent-hint`" class="field-hint restore-hint">项目树每层缩进从 15 像素缩小到 11 像素，深层目录少占横向空间。</p>
            <!-- cdExpandNodesWithSingleClick (UISettingsState.kt:141, default false);
                 bundle: checkbox.expand.node.with.single.click + ".comment". -->
            <label class="checkbox-row"><input v-model="editor.expandNodesWithSingleClick" type="checkbox" :aria-describedby="`${id}-expand-single-hint`" /><span>单击展开节点</span></label>
            <p :id="`${id}-expand-single-hint`" class="field-hint restore-hint">开启后单击目录立即展开；关闭时（IDEA 默认）单击只选中，双击展开。部分树可能忽略此设置。</p>
          </fieldset>
          <h4 class="settings-group-title">UI 选项</h4>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="editor.smoothScrolling" type="checkbox" :aria-describedby="`${id}-smooth-hint`" /><span>平滑滚动</span></label>
            <p :id="`${id}-smooth-hint`" class="field-hint restore-hint">使用鼠标滚轮/触摸板时整个界面平滑滚动，而不是逐行跳。</p>
            <label class="checkbox-row"><input v-model="editor.keepPopupsForToggles" type="checkbox" :aria-describedby="`${id}-keep-hint`" /><span>切换条目时保持弹出窗口打开</span></label>
            <p :id="`${id}-keep-hint`" class="field-hint restore-hint">点击带勾选的菜单项后菜单不关闭，可以连续切换多个选项。</p>
            <label class="checkbox-row"><input v-model="editor.dndWithPressedAltOnly" type="checkbox" :aria-describedby="`${id}-dnd-hint`" /><span>仅按下 Alt 时拖放</span></label>
            <p :id="`${id}-dnd-hint`" class="field-hint restore-hint">未按住 Alt 时拖动标签页不会开始拖放，避免误操作重排标签。</p>
            <label class="checkbox-row"><input v-model="editor.showIconsInMenus" type="checkbox" :aria-describedby="`${id}-menuicons-hint`" /><span>在菜单项中显示图标</span></label>
            <p :id="`${id}-menuicons-hint`" class="field-hint restore-hint">关闭后菜单项左侧的图标列隐藏，标题左移。</p>
            <!-- cdDifferentiateProjects; bundle: checkbox.use.solution.colors.in.main.toolbar
                 + text.use.solution.colors.in.main.toolbar. -->
            <label class="checkbox-row"><input v-model="editor.differentiateProjects" type="checkbox" :aria-describedby="`${id}-diff-projects-hint`" /><span>在主工具栏中使用项目颜色</span></label>
            <p :id="`${id}-diff-projects-hint`" class="field-hint restore-hint">用不同的工具栏颜色一眼区分不同项目（每个项目按路径哈希取 RecentProjectIconHelper 的 9 色渐变之一）。</p>
          </fieldset>
          <h4 class="settings-group-title">工具窗口</h4>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="editor.showToolWindowBars" type="checkbox" :aria-describedby="`${id}-twbars-hint`" /><span>显示工具窗口条</span></label>
            <p :id="`${id}-twbars-hint`" class="field-hint restore-hint">关闭后隐藏左右两侧的竖排图标条，已停靠的面板保留。</p>
            <label class="checkbox-row"><input v-model="editor.showToolWindowNames" type="checkbox" :aria-describedby="`${id}-twnames-hint`" /><span>显示工具窗口名称</span></label>
            <p :id="`${id}-twnames-hint`" class="field-hint restore-hint">在竖排图标条上，图标下方显示每个工具窗口的名称（图标条随之加宽）。</p>
            <label class="checkbox-row"><input v-model="editor.showToolWindowNumbers" type="checkbox" :aria-describedby="`${id}-twnums-hint`" /><span>显示工具窗口编号</span></label>
            <p :id="`${id}-twnums-hint`" class="field-hint restore-hint">在竖排图标条上显示 Alt+1…Alt+9 编号，并启用这些快捷键直接聚焦对应工具窗口。</p>
            <label class="checkbox-row"><input v-model="editor.rememberSizeForEachToolWindow" type="checkbox" :aria-describedby="`${id}-twsize-hint`" /><span>记住每个工具窗口的大小</span></label>
            <p :id="`${id}-twsize-hint`" class="field-hint restore-hint">开启后拖动停靠边缘只改变当前工具窗口的宽度/高度，并逐个记住；关闭时所有工具窗口共用同一尺寸。</p>
            <label class="checkbox-row"><input v-model="editor.leftSideBySide" type="checkbox" :aria-describedby="`${id}-sbs-hint`" /><span>左侧并列布局</span></label>
            <p :id="`${id}-sbs-hint`" class="field-hint restore-hint">左侧工具窗口下方保留项目视图，两者上下并列显示，而不是互相替换。</p>
            <label class="checkbox-row"><input v-model="editor.rightSideBySide" type="checkbox" :aria-describedby="`${id}-sbsr-hint`" /><span>右侧并列布局</span></label>
            <p :id="`${id}-sbsr-hint`" class="field-hint restore-hint">右侧工具窗口下方保留项目视图，两者上下并列显示。</p>
            <label class="checkbox-row"><input v-model="editor.wideScreenSupport" type="checkbox" :aria-describedby="`${id}-ws-hint`" /><span>宽屏工具窗口布局</span></label>
            <p :id="`${id}-ws-hint`" class="field-hint restore-hint">限制底部工具窗口的最大高度（窗口高度的 40%），把纵向空间让给左右两侧的垂直工具窗口。</p>
          </fieldset>
        </section>

        <form
          v-show="section === 'editor'" :id="`${id}-panel-editor`" :ref="registerEditorForm" class="settings-panel" data-page="editor"
          role="tabpanel" :aria-labelledby="`${id}-tab-editor.general`" :aria-busy="busy" @submit.prevent="applyEditor()"
        >
          <h3>编辑器 › 常规</h3>
          <div class="editor-page-head">
            <button type="button" class="subtle-button" title="把本页全部选项恢复为出厂默认值（需再点“应用”生效）" @click="resetEditorPage()">恢复默认</button>
          </div>
          <p class="section-description">对应 IDEA 的 Editor › General（面板是 platform/lang-impl/.../options/editor/EditorOptionsPanel.kt）。</p>
          <fieldset class="settings-fields" :disabled="busy">
            <div class="input-row">
              <label :for="`${id}-font`">字体大小 <span class="field-hint">（像素）</span></label>
              <input :id="`${id}-font`" v-model.number="editor.fontSize" type="number" :min="MIN_EDITOR_FONT_SIZE" :max="MAX_EDITOR_FONT_SIZE" step="1" required aria-describedby="editor-font-hint" />
            </div>
            <p id="editor-font-hint" class="field-hint" :class="{ 'validation-error': !validEditor }">字体大小需为 {{ MIN_EDITOR_FONT_SIZE }}–{{ MAX_EDITOR_FONT_SIZE }} 之间的整数（IDEA `EditorFontsConstants`：下限 4，上限 registry `ide.editor.max.font.size` 默认 40）。</p>
            <label class="checkbox-row"><input v-model="editor.wordWrap" type="checkbox" aria-describedby="editor-wrap-hint" /><span>自动换行（软换行）</span></label>
            <p id="editor-wrap-hint" class="field-hint restore-hint">对应 IDEA 的 “Soft-wrap these files”，在 Editor › General —— EditorOptionsPanel.kt 引用 ApplicationBundle.properties:341 的 checkbox.use.soft.wraps.at.editor。</p>
          </fieldset>
        </form>

        <form
          v-show="section === 'editor.preferences.appearance'" :id="`${id}-panel-editor.preferences.appearance`" :ref="registerEditorForm" class="settings-panel" data-page="editor.preferences.appearance"
          role="tabpanel" :aria-labelledby="`${id}-tab-editor.preferences.appearance`" :aria-busy="busy" @submit.prevent="applyEditor()"
        >
          <h3>编辑器 › 常规 › 外观</h3>
          <div class="editor-page-head">
            <button type="button" class="subtle-button" title="把本页全部选项恢复为出厂默认值（需再点“应用”生效）" @click="resetEditorPage()">恢复默认</button>
          </div>
          <p class="section-description">对应 IDEA 的 Editor › General › Appearance（EditorAppearanceConfigurable.kt:49-56 的 model::isLineNumbersShown / isWhitespacesShown / isIndentGuidesShown）。</p>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="editor.lineNumbers" type="checkbox" /><span>显示行号</span></label>
            <label class="checkbox-row"><input v-model="editor.showWhitespaces" type="checkbox" aria-describedby="editor-ws-hint" /><span>显示空白符号</span></label>
            <p id="editor-ws-hint" class="field-hint restore-hint">空格渲染为“·”，制表符渲染为“→”，行尾多余空格会一并显示。</p>
            <label class="checkbox-row"><input v-model="editor.showIndentGuides" type="checkbox" aria-describedby="editor-guides-hint" /><span>显示缩进参考线</span></label>
            <p id="editor-guides-hint" class="field-hint restore-hint">IDEA 风格的垂直引导线，帮助识别代码块层级。</p>
            <label class="checkbox-row"><input v-model="editor.bracketMatching" type="checkbox" aria-describedby="editor-bracket-hint" /><span>括号匹配高亮</span></label>
            <p id="editor-bracket-hint" class="field-hint restore-hint">光标靠近括号时高亮对应的另一侧括号。注意：IDEA 没有任何“高亮匹配括号”的开关（EditorSettingsExternalizable 里没有 bracket 字段，平台里唯一的括号复选框是 Smart Keys 的 checkbox.insert.pair.bracket =「自动插入配对括号」），IDEA 的匹配括号高亮由 Editor › Color Scheme › General › Matched brace 的配色决定 —— 本项是 TaoCode 自己的开关，位置按编辑器外观类选项放置。</p>
            <div class="input-row"><label :for="`${id}-line-numeration`">行号排法</label><select :id="`${id}-line-numeration`" v-model="editor.lineNumeration" :aria-describedby="`${id}-line-numeration-hint`"><option value="absolute">绝对</option><option value="relative">相对</option><option value="hybrid">混合</option></select></div>
            <p :id="`${id}-line-numeration-hint`" class="field-hint restore-hint">对应 IDEA Editor › General › Appearance 的「行号」下拉（EditorAppearanceConfigurable.kt:118-124 的 LINE_NUMERATION，默认「绝对」）：相对 = 显示与光标行的距离（折叠藏起来的行不计）；混合 = 光标行显示绝对行号、其余相对。</p>
          </fieldset>
        </form>

        <section v-show="section === 'editor.preferences.tabs'" :id="`${id}-panel-editor.preferences.tabs`" class="settings-panel" data-page="editor.preferences.tabs" role="tabpanel" :aria-labelledby="`${id}-tab-editor.preferences.tabs`" :aria-busy="busy"><EditorTabsSettingsPage :settings="editor" :busy="busy" :invalid-tab-limit="!validEditor" :id-prefix="id" @reset="resetEditorPage()" /></section>

        <form
          v-show="section === 'editor.preferences.smartKeys'" :id="`${id}-panel-editor.preferences.smartKeys`" :ref="registerEditorForm" class="settings-panel" data-page="editor.preferences.smartKeys"
          role="tabpanel" :aria-labelledby="`${id}-tab-editor.preferences.smartKeys`" :aria-busy="busy" @submit.prevent="applyEditor()"
        >
          <h3>编辑器 › 常规 › 智能键</h3>
          <div class="editor-page-head">
            <button type="button" class="subtle-button" title="把本页全部选项恢复为出厂默认值（需再点“应用”生效）" @click="resetEditorPage()">恢复默认</button>
          </div>
          <p class="section-description">对应 IDEA 的 Editor › General › Smart Keys（EditorSmartKeysConfigurable.kt:185-197，注册 id="editor.preferences.smartKeys"）。</p>
          <fieldset class="settings-fields" :disabled="busy">
            <div class="input-row">
              <label :for="`${id}-reformat-on-paste`">粘贴时</label>
              <select :id="`${id}-reformat-on-paste`" v-model="editor.reformatOnPaste" aria-describedby="editor-reformat-on-paste-hint">
                <option v-for="mode in PASTE_REFORMAT_MODES" :key="mode" :value="mode">{{ pasteReformatLabel(mode) }}</option>
              </select>
            </div>
            <p id="editor-reformat-on-paste-hint" class="field-hint">CodeInsightSettings.REFORMAT_ON_PASTE，默认「粘贴时逐行缩进」。有语言服务时把刚粘贴的那一段交给它重新缩进/格式化；没有语言服务时只按光标所在列给后续行补缩进（源码 PasteHandler.java:255-257 会把档位强制为整块缩进）。</p>
          </fieldset>
        </form>

        <form
          v-show="section === 'editor.preferences.gutterIcons'" :id="`${id}-panel-editor.preferences.gutterIcons`" :ref="registerEditorForm" class="settings-panel" data-page="editor.preferences.gutterIcons"
          role="tabpanel" :aria-labelledby="`${id}-tab-editor.preferences.gutterIcons`" :aria-busy="busy" @submit.prevent="applyEditor()"
        >
          <h3>编辑器 › 常规 › 装订线图标</h3>
          <div class="editor-page-head">
            <button type="button" class="subtle-button" title="把本页全部选项恢复为出厂默认值（需再点“应用”生效）" @click="resetEditorPage()">恢复默认</button>
          </div>
          <p class="section-description">对应 IDEA 的 Editor › General › Gutter Icons（GutterIconsConfigurable，注册 id="editor.preferences.gutterIcons"）。</p>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="editor.showGutterIcons" type="checkbox" aria-describedby="editor-gutter-icons-hint" /><span>显示装订线图标</span></label>
            <p id="editor-gutter-icons-hint" class="field-hint">EditorSettingsExternalizable.ARE_GUTTER_ICONS_SHOWN（默认开）。图标来自语言服务诊断、断点与书签；关掉后不再绘制，但标记本身保留（视图 › 编辑器开关 里也有同一个开关）。IDEA 页里还有一张「按插件分组的行标记列表」，那依赖 LineMarkerProvider 体系，本仓暂无，已登记待办。</p>
          </fieldset>
        </form>

        <section v-show="section === 'editor.preferences.folding'" :id="`${id}-panel-editor.preferences.folding`" class="settings-panel" data-page="editor.preferences.folding" role="tabpanel" :aria-labelledby="`${id}-tab-editor.preferences.folding`" :aria-busy="busy">
          <CodeFoldingSettingsPage :settings="editor" :busy="busy" @reset="resetEditorPage()" />
        </section>

        <section v-show="section === 'inlay.hints'" :id="`${id}-panel-inlay.hints`" class="settings-panel" data-page="inlay.hints" role="tabpanel" :aria-labelledby="`${id}-tab-inlay.hints`" :aria-busy="busy">
          <InlayHintsSettingsPage :settings="editor" :busy="busy" />
        </section>

        <form
          v-show="section === 'preferences.sourceCode.indents'" :id="`${id}-panel-editor.codeStyle.indents`" :ref="registerEditorForm" class="settings-panel" data-page="preferences.sourceCode.indents"
          role="tabpanel" :aria-labelledby="`${id}-tab-editor.codeStyle.indents`" :aria-busy="busy" @submit.prevent="applyEditor()"
        >
          <h3>编辑器 › 代码风格 › 制表符与缩进</h3>
          <div class="editor-page-head">
            <button type="button" class="subtle-button" title="把本页全部选项恢复为出厂默认值（需再点“应用”生效）" @click="resetEditorPage()">恢复默认</button>
          </div>
          <p class="section-description">对应 IDEA 的 Editor › Code Style › Tabs and Indents —— platform/lang-api/.../application/options/IndentOptionsEditor.java 引用 use.tab.character 与制表符宽度，不是 Editor › General。</p>
          <fieldset class="settings-fields" :disabled="busy">
            <div class="input-row">
              <label :for="`${id}-tab-size`">缩进宽度</label>
              <select :id="`${id}-tab-size`" v-model.number="editor.tabSize" aria-describedby="editor-tabs-hint">
                <option v-for="size in [2, 4, 8]" :key="size" :value="size">{{ sizeLabel(size) }}</option>
              </select>
            </div>
            <p id="editor-tabs-hint" class="field-hint restore-hint">{{ tabCharacterHint }}</p>
            <label class="checkbox-row"><input v-model="editor.useTabCharacter" type="checkbox" aria-describedby="editor-tabchar-hint" /><span>使用制表符（Tab 字符）缩进</span></label>
            <p id="editor-tabchar-hint" class="field-hint restore-hint">开启后 Tab 与自动缩进写入一个 Tab 字符；关闭时按上面的宽度写入空格。</p>
          </fieldset>
        </form>

        <form
          v-show="section === 'tools.actionsOnSave'" :id="`${id}-panel-tools.actionsOnSave`" :ref="registerEditorForm" class="settings-panel" data-page="tools.actionsOnSave"
          role="tabpanel" :aria-labelledby="`${id}-tab-tools.actionsOnSave`" :aria-busy="busy" @submit.prevent="applyEditor()"
        >
          <h3>工具 › 保存时操作</h3>
          <div class="editor-page-head">
            <button type="button" class="subtle-button" title="把本页全部选项恢复为出厂默认值（需再点“应用”生效）" @click="resetEditorPage()">恢复默认</button>
          </div>
          <p class="section-description">对应 IDEA 的 Tools › Actions on Save —— intellij.platform.ide.impl.xml:1313-1317 把它注册为 projectConfigurable groupId="tools" id="actions.on.save"，文案见 CodeInsightBundle.properties:484（Reformat code）。</p>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="editor.formatOnSave" type="checkbox" aria-describedby="editor-format-hint" /><span>保存时格式化代码</span></label>
            <p id="editor-format-hint" class="field-hint restore-hint">先调用语言服务的格式化能力再写盘；该文件没有可用语言服务时按原样保存。</p>
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
          <p class="field-hint"><strong>仅供内部使用</strong>：这里列出 TaoCode 的内部设置键与当前值（对应 IDEA 的 Registry）。
            这些键由设置页正常维护，直接改动的持久化文件会在下次启动时按同一套校验读取。</p>
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
          <p class="section-description">对应 IDEA Settings › Editor › Breadcrumbs（platform-impl/.../xml/breadcrumbs/BreadcrumbsConfigurable.java:24；UI 在 BreadcrumbsConfigurableUI.kt:44-70）。注册证据：intellij.platform.ide.impl.xml:1231 `&lt;applicationConfigurable parentId="preferences.editor" id="editor.breadcrumbs"&gt;` —— 它是**编辑器的直接子页**，不是「常规 › 外观」里的行。</p>
            <!-- IDEA BreadcrumbsConfigurableUI.kt:44-70 三段：显示开关 → 位置单选（上/下，随总开关禁用）
                 → 按语言的开关（mapLanguageBreadcrumbs，只存显式配置过的语言）。
                 最后那个「配置面包屑颜色」链接指向颜色方案页（ColorAndFontOptions），本仓没有色板页，
                 登记在 class-parity-todo.md 里，不渲染假链接。 -->
            <label class="checkbox-row"><input v-model="settings.showBreadcrumbs" type="checkbox" aria-describedby="editor-breadcrumbs-hint" /><span>显示面包屑</span></label>
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
            <p id="editor-breadcrumbs-hint" class="field-hint">对应 IDEA 的 <code>editor.breadcrumbs</code>：总开关、位置（编辑器上方/下方，默认下方），以及每种语言是否显示；没被单独勾选过的语言按「显示」处理。</p>
        </section>

        <section v-show="section === 'editor.stickyLines'" :id="`${id}-panel-editor.stickyLines`" class="settings-panel" data-page="editor.stickyLines" role="tabpanel" :aria-labelledby="`${id}-tab-editor.stickyLines`" :aria-busy="busy">
          <h3>编辑器 › 粘性行</h3>
          <p class="section-description">对应 IDEA Settings › Editor › Sticky Lines（StickyLinesConfigurable.kt:7-20）。注册证据：intellij.platform.ide.impl.xml:1236 `&lt;applicationConfigurable parentId="preferences.editor" id="editor.stickyLines"&gt;` —— 同样是编辑器的直接子页。</p>
            <!-- IDEA StickyLinesConfigurable（`editor.stickyLines`）。 -->
            <label class="checkbox-row"><input v-model="settings.showStickyLines" type="checkbox" aria-describedby="editor-sticky-hint" /><span>在编辑器顶边固定显示当前作用域</span></label>
            <label class="field-row"><span>层数上限</span><input v-model.number="settings.stickyLinesLimit" type="number" min="0" max="10" step="1" :disabled="!settings.showStickyLines" aria-describedby="editor-sticky-hint" /></label>
            <p id="editor-sticky-hint" class="field-hint">对应 IDEA 的 `editor.stickyLines`：把当前光标所在的类/方法等作用域首行固定在编辑区顶部，最多显示 N 层（0 = 关闭）。</p>
        </section>

        <section v-show="section === 'Errors'" :id="`${id}-panel-Errors`" class="settings-panel" data-page="Errors" role="tabpanel" :aria-labelledby="`${id}-tab-Errors`" :aria-busy="busy">
          <h3>编辑器 › 检查</h3>
          <p class="section-description">对应 IDEA Settings › Editor › Inspections（`Errors`，注册证据 intellij.platform.lang.impl.xml:1823 `groupId="editor" groupWeight="160" key="configurable.InspectionToolsConfigurable.display.name"`=Inspections）。TaoCode 用 LSP 诊断，等价开关是显示诊断与滚动条标记。</p>
            <!-- IDEA Error highlighting（`Errors` + ErrorOptionsProvider）：TaoCode 用 LSP 诊断，等价开关是显示诊断与 stripe 标记。 -->
            <label class="checkbox-row"><input v-model="settings.showDiagnostics" type="checkbox" aria-describedby="editor-diagnostics-hint" /><span>在编辑器里显示错误与警告</span></label>
            <label class="checkbox-row"><input v-model="settings.showErrorStripe" type="checkbox" :disabled="!settings.showDiagnostics" aria-describedby="editor-diagnostics-hint" /><span>在滚动条旁显示错误标记</span></label>
            <p id="editor-diagnostics-hint" class="field-hint">对应 IDEA 的 Editor | Error highlighting：关闭后语言服务仍然运行，只是不再绘制波浪线与标记。</p>
        </section>

        <section v-show="section === 'Console'" :id="`${id}-panel-Console`" class="settings-panel" data-page="Console" role="tabpanel" :aria-labelledby="`${id}-tab-Console`" :aria-busy="busy"><ConsoleSettingsPage :settings="general" :busy="busy" /></section>
        <section v-show="section === 'preferences.keymap'" :id="`${id}-panel-preferences.keymap`" class="settings-panel" data-page="preferences.keymap" role="tabpanel" :aria-labelledby="`${id}-tab-preferences.keymap`"><KeymapSettingsPage /></section>

        <section v-show="section === 'debugger'" :id="`${id}-panel-debugger`" class="settings-panel" data-page="debugger" role="tabpanel" :aria-labelledby="`${id}-tab-debugger`" :aria-busy="busy"><DebuggerSettingsPage :settings="general" :busy="busy" /></section>

        <section v-show="section === 'preferences.externalTools'" :id="`${id}-panel-preferences.externalTools`" class="settings-panel" data-page="preferences.externalTools" role="tabpanel" :aria-labelledby="`${id}-tab-preferences.externalTools`" :aria-busy="busy"><ExternalToolsSettingsPage :settings="general" :busy="busy" @change="Object.assign(general, $event)" /></section>

        <section v-show="section === 'diff.base'" :id="`${id}-panel-diff.base`" class="settings-panel" data-page="diff.base" role="tabpanel" :aria-labelledby="`${id}-tab-diff.base`" :aria-busy="busy">
          <h3>工具 › 差异与合并</h3>
          <p class="section-description">对应 IDEA Settings › Tools › Diff &amp; Merge（注册证据 platform/diff-impl/resources/intellij.platform.diff.impl.xml:78 `groupId="tools" id="diff.base"`）。</p>
            <!-- IDEA DiffSettingsConfigurable（`diff.base`）：settings.context.lines。 -->
            <label class="field-row"><span>上下文行数</span><input v-model.number="settings.diffContextLines" type="number" min="1" max="100" step="1" aria-describedby="general-diff-hint" /></label>
            <p id="general-diff-hint" class="field-hint">对应 IDEA 的 `diff.base` › settings.context.lines：统一差异（`git diff`）保留的上下文行数，TaoCode 会把它作为 <code>-U&lt;n&gt;</code> 传给 git（默认 3，与 git 一致）。</p>
        </section>

        <section v-show="section === 'build.tools'" :id="`${id}-panel-build.tools`" class="settings-panel" data-page="build.tools" role="tabpanel" :aria-labelledby="`${id}-tab-build.tools`" :aria-busy="busy">
          <h3>构建、执行、部署 › 构建工具</h3>
          <p class="section-description">对应 IDEA Settings › Build, Execution, Deployment › Build Tools（注册证据 platform/external-system-impl/resources/META-INF/ExternalSystemExtensions.xml:24 `groupId="build" id="build.tools"`）。这一页是 <code>ExternalSystemGroupConfigurable</code>（:22-26，projectConfigurable、BackedByPersistentState）。</p>
                      <BuildToolsSettingsPage :build-tools="projectSettings?.buildTools ?? null" :busy="busy" @save="emit('saveBuildTools', $event)" />
        </section>

        <section v-show="section === 'reference.settingsdialog.project.gradle'" :id="`${id}-panel-reference.settingsdialog.project.gradle`" class="settings-panel" data-page="reference.settingsdialog.project.gradle" role="tabpanel" :aria-labelledby="`${id}-tab-reference.settingsdialog.project.gradle`" :aria-busy="busy">
          <h3>构建、执行、部署 › 构建工具 › Gradle</h3>
          <p class="section-description">对应 IDEA Settings › Build, Execution, Deployment › Build Tools › Gradle（注册证据 plugins/gradle/plugin-resources/intellij.gradle.xml:177-179 `groupId="build.tools" groupWeight="110" id="reference.settingsdialog.project.gradle"`）。三项都存**项目级**：用哪个 Gradle 在 <code>GradleProjectSettings.distributionType</code>、Gradle 用户主目录在 <code>GradleLocalSettings.getGradleUserHome()</code>、离线模式在 <code>GradleSettings.MyState.isOfflineMode</code>（<code>.idea/gradle.xml</code>）。</p>
          <GradleSettingsPage :gradle="projectSettings?.buildTools?.gradle ?? null" :detection="gradleDetection ?? null" :busy="busy" @save="emit('saveBuildTools', { gradle: $event })" />
        </section>

        <section v-show="section === 'vcs.log'" :id="`${id}-panel-vcs.log`" class="settings-panel" data-page="vcs.log" role="tabpanel" :aria-labelledby="`${id}-tab-vcs.log`" :aria-busy="busy">
          <h3>版本控制 › VCS 日志</h3>
          <p class="section-description">对应 IDEA Settings › Version Control › VCS Log（注册证据 platform/vcs-log/impl/resources/intellij.platform.vcs.log.impl.xml:86 `id="vcs.log" parentId="project.propVCSSupport.Mappings"`）。</p>
          <!-- IDEA VcsLogApplicationSettings（vcs.log）：日志图的 UI 开关。 -->
          <label class="checkbox-row"><input type="checkbox" :checked="projectSettings?.vcsLog?.showTagNames ?? true" :disabled="!projectSettings || busy" @change="emit('saveVcsLog', { showTagNames: !(projectSettings?.vcsLog?.showTagNames ?? true), showRootNames: projectSettings?.vcsLog?.showRootNames ?? true })" /><span>在日志行上显示标签名</span></label>
          <label class="checkbox-row"><input type="checkbox" :checked="projectSettings?.vcsLog?.showRootNames ?? true" :disabled="!projectSettings || busy" @change="emit('saveVcsLog', { showTagNames: projectSettings?.vcsLog?.showTagNames ?? true, showRootNames: !(projectSettings?.vcsLog?.showRootNames ?? true) })" /><span>显示仓库根名</span></label>
          <p class="field-hint">对应 IDEA 的 <code>vcs.log</code> 设置：只影响日志图的显示，历史数据不变。</p>
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
          <p v-if="!projectSettings" class="section-description">尚未打开项目。模板开关与自定义模板随项目保存，请先打开一个项目。</p>
          <TemplateSettingsPage v-else :settings="projectSettings.templates" :language="templateLanguage" :busy="busy" :project-root="projectRoot" :project-name="moduleName" @change="emit('saveTemplates', $event)" />
        </section>

        <!-- Settings › Version Control › Commit (CommitDialogConfigurable.kt:60-77): the
             Commit Message Inspections group plus the wrap-on-typing checkbox of
             BodyLimitInspection.createOptions (:32-48). -->
        <section v-show="section === 'commit'" :id="`${id}-panel-commit`" class="settings-panel" data-page="commit" role="tabpanel" :aria-labelledby="`${id}-tab-commit`" :aria-busy="busy">
          <h3>提交</h3>
          <p class="section-description">提交信息检查在提交框里报告超长的主题/正文行与缺失的空行，并给出与 IDEA 相同的快捷修复。修改后点“应用”或“确定”。</p>
          <h4 class="settings-group-title">提交信息检查</h4>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="commitMessage.subjectLimit" type="checkbox" :aria-describedby="`${id}-subject-margin-hint`" /><span>限制主题行长度</span></label>
            <div class="input-row">
              <label :for="`${id}-subject-margin`">主题行右边距 <span class="field-hint">（字符）</span></label>
              <input :id="`${id}-subject-margin`" v-model.number="commitMessage.subjectRightMargin" type="number" min="0" max="10000" step="1" :aria-describedby="`${id}-subject-margin-hint`" />
            </div>
            <p :id="`${id}-subject-margin-hint`" class="field-hint" :class="{ 'validation-error': !validCommitMessage }">提交信息第一行超过右边距即报告「主题不能超过 N 个字符」。默认 72，允许 0–10000。</p>
            <label class="checkbox-row"><input v-model="commitMessage.bodyLimit" type="checkbox" :aria-describedby="`${id}-body-margin-hint`" /><span>限制正文行长度</span></label>
            <div class="input-row">
              <label :for="`${id}-body-margin`">正文行右边距 <span class="field-hint">（字符）</span></label>
              <input :id="`${id}-body-margin`" v-model.number="commitMessage.bodyRightMargin" type="number" min="0" max="10000" step="1" :aria-describedby="`${id}-body-margin-hint`" />
            </div>
            <p :id="`${id}-body-margin-hint`" class="field-hint" :class="{ 'validation-error': !validCommitMessage }">第二行起的每一行超过右边距即报告「正文行不能超过 N 个字符」；「重新格式化提交信息」与「换行」都按这个宽度折行。默认 72，允许 0–10000。</p>
            <label class="checkbox-row"><input v-model="commitMessage.subjectBodySeparation" type="checkbox" :aria-describedby="`${id}-separation-hint`" /><span>主题与正文之间需要空行</span></label>
            <p :id="`${id}-separation-hint`" class="field-hint restore-hint">第二行不为空时报「主题与正文之间缺少空行」，「插入空行」会在主题后补一行。单行提交信息不受影响。</p>
          </fieldset>
          <h4 class="settings-group-title">提交信息</h4>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="commitMessage.wrapOnTyping" type="checkbox" :aria-describedby="`${id}-wrapmargin-hint`" /><span>输入达到右边距时自动换行</span></label>
            <p :id="`${id}-wrapmargin-hint`" class="field-hint restore-hint">输入时当前行一到正文行右边距就自动折行（按最后一个空格断开）。IDEA 默认关闭。</p>
          </fieldset>
          <p class="field-hint restore-hint">IDEA 的「显示右边距」（在提交框里画一条列宽参考线）未实现：它要求提交框使用等宽字体，而参考线在比例字体下没有确定的列位置；超出部分仍会逐条列出。详见 src/commitMessageInspection.ts 顶部说明。</p>
        </section>

        <section v-show="section === 'project.scopes'" :id="`${id}-panel-scopes`" class="settings-panel" data-page="scopes" role="tabpanel" :aria-labelledby="`${id}-tab-scopes`" :aria-busy="busy">
          <h3>作用域</h3>
          <p class="section-description">作用域是一段文件模式，供「在文件中查找」等对话框限定范围。文件颜色在独立设置页配置。</p>
          <ScopesSettingsPage ref="scopesPage" :scopes="projectSettings?.scopes ?? []" :root="projectRoot" :module-name="moduleName" :busy="busy" @save="emit('saveScopes', $event)" />
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
          <p class="section-description">对应 IDEA Settings › Appearance &amp; Behavior › System Settings（GeneralSettingsConfigurable.kt，ide.general.xml）。</p>
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
            <p class="field-hint">此目录将作为“打开…”和“新建 | 项目…”对话框的预选目录。</p>
          </fieldset>
          <h4 class="settings-group-title">文件</h4>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="general.deleteToBin" type="checkbox" /><span>将文件移入回收站而不是永久删除</span></label>
            <div class="input-row">
              <label class="checkbox-row" :for="`${id}-idle-timeout`"><input v-model="general.autoSaveIfInactive" type="checkbox" /><span>IDE 空闲</span></label>
              <input :id="`${id}-idle-timeout`" v-model.number="general.inactiveTimeout" type="number" min="1" max="300" step="1" :disabled="!general.autoSaveIfInactive" />
              <span class="field-hint">秒后自动保存文件</span>
            </div>
            <p :id="`${id}-idle-timeout-hint`" class="field-hint" :class="{ 'validation-error': !validGeneral }">空闲自动保存的超时范围是 1–300 秒（GeneralSettings.SAVE_FILES_AFTER_IDLE_SEC，默认 15）。</p>
            <label class="checkbox-row"><input v-model="general.autoSaveFiles" type="checkbox" /><span>切换到其他应用或内置终端时保存文件</span></label>
            <label class="checkbox-row"><input v-model="general.isUseSafeWrite" type="checkbox" /><span>保存前备份文件</span></label>
            <!-- 上游只用注册表键、没有设置页入口的那两项（见该组件头）。 -->
            <GeneralRegistryToggles :general="general" />
          </fieldset>
          <h4 class="settings-group-title">同步外部更改：</h4>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="general.autoSyncFiles" type="checkbox" /><span>切换到 IDE 窗口或打开编辑器标签页时</span></label>
            <label class="checkbox-row"><input v-model="general.backgroundSyncFiles" type="checkbox" /><span>IDE 空闲时周期性同步（实验性）</span></label>
          </fieldset>
          <p class="field-hint restore-hint">自动保存无法被完全禁用。</p>
          <div class="input-row"><button type="button" class="subtle-button" :disabled="busy" title="将本页所有选项恢复为出厂默认值" @click="resetGeneralPage">重置本页</button></div>
        </section>
      </div>
    </div>
    <footer class="dialog-footer">
      <span class="settings-hint"><CircleHelp :size="iconSize.control" aria-hidden="true" /><span>项目级设置（实时模板、TODO、文件类型、作用域、VCS 日志）只应用于当前项目，随项目保存；项目结构改在「文件 › 项目结构…」对话框里（IDEA 同样如此）。</span></span>
      <span class="save-status" role="status">{{ copyNote || (busy ? '正在保存，请稍候…' : section === 'preferences.lookFeel' ? '主题即时生效' : section === 'editing.templates' ? '模板改动即时保存到本项目' : PROJECT_SCOPED_PAGES.has(section) ? '本页改动需保存后才写入项目' : dirty ? '有未应用的修改' : '已应用') }}</span>
      <div class="footer-actions">
        <button type="button" class="subtle-button" :disabled="busy || !dirty" title="应用 (Alt+A)" @click="applyAll()">应用(A)</button>
        <button type="button" class="subtle-button" :disabled="busy" @click="close">取消</button>
        <button type="button" class="primary-button" :disabled="busy" title="应用并关闭" @click="ok">确定</button>
      </div>
    </footer>
  </dialog>
</template>

<style scoped>
.settings-dialog { position: fixed; inset: 0; width: 900px; height: 620px; max-width: calc(100vw - 32px); max-height: calc(100dvh - 32px); margin: auto; padding: 0; color: var(--text); }
.settings-dialog[open] { display: flex; flex-direction: column; }
.settings-dialog::backdrop { background: var(--backdrop); }
.settings-dialog:focus { outline: none; }
.dialog-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-shrink: 0; padding: var(--space-3) var(--space-5); border-bottom: 1px solid var(--line); }
.settings-dialog .dialog-title { margin: 0; padding: 0; font: 600 17px/1.5 var(--font-ui); color: var(--bright); }
.settings-layout { display: grid; grid-template-columns: 190px minmax(0, 1fr); flex: 1; min-width: 0; min-height: 0; }
.settings-navigation { display: flex; flex-direction: column; gap: 2px; min-height: 0; overflow: auto; padding: var(--space-2) var(--space-2); border-right: 1px solid var(--line); background: var(--panel); }
.settings-filter { display: flex; align-items: center; gap: var(--space-1); margin: 0 0 var(--space-2); padding: var(--space-1) var(--space-2); min-height: 30px; background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); color: var(--muted); }
.settings-filter:focus-within { border-color: var(--accent); }
.settings-filter input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--text); font: inherit; }
.settings-filter input::placeholder { color: var(--muted); }
/* SearchTextField's leading history affordance (:119-124): the field's leading area is clickable
   when there is history, and the popup is aligned underneath the field (:459). */
.settings-search-icon { display: inline-flex; align-items: center; padding: 0; border: 0; background: none; color: inherit; }
.settings-search-icon.has-history { cursor: pointer; transition: color var(--dur-1) var(--ease); }
.settings-search-icon.has-history:hover, .settings-search-icon.has-history:focus-visible { color: var(--text); }
.settings-history-popup { position: fixed; z-index: 30; display: flex; flex-direction: column; max-width: 320px; padding: 2px; background: var(--elevated); border: var(--popup-border); border-radius: var(--popup-radius); box-shadow: var(--popup-shadow); }
.settings-history-item { text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.settings-history-item.active { background: var(--selected); color: var(--bright); }
.settings-group-label { padding: var(--space-1) var(--space-2); color: var(--muted); font-size: 11px; }
.settings-tab { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; min-height: var(--ctrl-height-lg); padding: var(--space-1) var(--space-2); border: 0; background: transparent; color: var(--secondary); border-radius: var(--radius-sm); text-align: left; }
.settings-tab:hover { background: var(--hover); }
.settings-tab > svg { flex-shrink: 0; }
.settings-tab[aria-selected='true'] { color: var(--bright); background: var(--selected); font-weight: 600; }
.settings-group { color: var(--text); font-weight: 600; }
.settings-child { margin-left: var(--space-5); }
.settings-grandchild { margin-left: calc(var(--space-5) * 2); }
.settings-caret { transition: transform var(--dur-1) var(--ease); }
.settings-caret-closed { transform: rotate(-90deg); }
.settings-empty { margin: var(--space-2); color: var(--muted); font-size: 11px; }
/* IDEA's right-aligned new-options marker (SettingsTreeView.java:791 `setRightIcon(NEW_BADGE_DOT)`,
   a `LargeBlueDotIcon`; the accessible text is IdeBundle `badge.text.new`). */
.settings-new-dot { width: 6px; height: 6px; flex-shrink: 0; margin-left: auto; border-radius: var(--radius-pill); background: var(--accent); }
.settings-content { min-width: 0; min-height: 0; overflow: auto; padding: var(--space-4) var(--space-5); }
.settings-breadcrumb { display: flex; align-items: center; gap: 2px; margin-bottom: var(--space-4); }
.settings-crumbs { display: inline-flex; align-items: center; gap: 4px; margin-left: var(--space-2); color: var(--secondary); font-size: 13px; }
.crumb-group { color: var(--secondary); }
.crumb-current { color: var(--bright); font-weight: 600; }
.crumb-sep { color: var(--muted); }
.settings-error { border: 1px solid var(--error); border-radius: var(--radius-xs); margin-bottom: var(--space-4); }
.settings-panel { min-width: 0; }
.settings-panel h3 { margin: 0 0 var(--space-2); font-size: 15px; color: var(--bright); font-weight: 600; }
.section-description { margin: 0 0 var(--space-5); color: var(--secondary); line-height: 1.8; overflow-wrap: anywhere; }
.theme-options { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.theme-option { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: var(--space-2); row-gap: 2px; flex: 1 1 135px; min-width: 0; align-items: center; padding: var(--space-4); border: 1px solid var(--line-strong); border-radius: var(--radius-md); background: var(--editor); color: var(--secondary); }
.theme-option[aria-pressed='true'] { border-color: var(--accent); background: var(--selected); color: var(--bright); }
.theme-option > span:not(.theme-state) { text-align: left; line-height: 18px; }
.theme-state { grid-column: 2; font-size: 11px; line-height: 16px; color: var(--muted); text-align: left; }
.settings-group-title { margin: var(--space-5) 0 var(--space-2); padding-bottom: var(--space-1); border-bottom: 1px solid var(--line); color: var(--secondary); font-size: 12px; font-weight: 600; }
.zoom-row { display: flex; align-items: center; gap: var(--space-2); }
.zoom-row select { width: 90px; min-height: 33px; padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: inherit; }
.zoom-row .subtle-button { min-height: 33px; font-size: 11px; }
.settings-fields { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; border: 0; padding: 0; margin: 0; }
.input-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2) var(--space-4); }
.input-row label, .field-label { color: var(--text); font-weight: 500; }
.input-row input, .input-row select { width: 118px; max-width: 100%; min-width: 0; min-height: 33px; padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: inherit; }
.field-hint { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; font-weight: 400; }
/* A field followed by its hint sits tight against it; the group stays apart from the next row. */
.field-label + .field-hint, .settings-fields :is(input, select, textarea) + .field-hint { margin-top: calc(var(--space-3) * -1 + 2px); }
.checkbox-row { display: flex; align-items: flex-start; gap: var(--space-2); cursor: pointer; }
.checkbox-row input { flex-shrink: 0; width: 15px; height: 15px; margin: 2px 0 0; accent-color: var(--accent); }
.checkbox-row span { min-width: 0; overflow-wrap: anywhere; }
.restore-hint { padding-left: var(--space-5); }
.validation-error { margin: 0; color: var(--error); font-size: 11px; }
.dialog-footer { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); flex-shrink: 0; padding: var(--space-3) var(--space-5); border-top: 1px solid var(--line); }
.settings-hint { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--muted); font-size: 11px; margin-right: auto; }
.save-status { color: var(--muted); font-size: 11px; }
.footer-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); }
.footer-actions .primary-button { margin-top: 0; }
@media (max-width: 560px) {
  .settings-dialog { max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); }
  .settings-layout { grid-template-columns: 120px minmax(0, 1fr); }
  .settings-navigation { padding: var(--space-3) var(--space-1); }
  .settings-tab { padding: var(--space-2) var(--space-2); gap: var(--space-1); }
  .settings-tab > svg { display: none; }
  .settings-content { padding: var(--space-4) var(--space-3); }
  .dialog-header, .dialog-footer { padding: var(--space-3) var(--space-3); }
  .theme-option { padding: var(--space-3); }
  .restore-hint { padding-left: 0; }
}
.advanced-toolbar { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-2) 0; }
.advanced-table { display: flex; flex-direction: column; max-height: 52vh; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.advanced-row { display: grid; grid-template-columns: 60px minmax(200px, 32%) minmax(0, 1fr); gap: var(--space-2); padding: 3px var(--space-2); border-bottom: 1px solid var(--line); font-size: 11px; }
.advanced-row:last-child { border-bottom: 0; }
.advanced-group { color: var(--muted); }
.advanced-key { color: var(--bright); overflow-wrap: anywhere; }
.advanced-value { width: 100%; min-width: 0; padding: 1px 4px; border: 1px solid transparent; border-radius: var(--radius-xs); background: transparent; color: var(--secondary); font: inherit; transition: border-color var(--dur-1) var(--ease); }
.advanced-value:hover { border-color: var(--line); }
.advanced-value:focus { border-color: var(--accent); background: var(--editor); outline: none; }
.advanced-value.invalid { border-color: var(--warning); color: var(--warning); }
</style>
