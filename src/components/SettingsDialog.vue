<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { languageFor } from '../templates'
import { defaultEditorSettings } from '../bridge'
import { isNameHit, matchesOption, optionMatches, resolveSettingsPath, settingsPath } from '../settingsSearch'
import { RIGHT_MARGIN_MAX, RIGHT_MARGIN_MIN, type CommitMessageInspectionSettings } from '../commitMessageInspection'
import { addHistoryEntry, formatHistory, parseHistory, popupHistory, SEARCH_HISTORY_LABEL, SETTINGS_SEARCH_HISTORY_KEY, stepHistory, type HistoryDirection } from '../searchHistory'
import { MAX_SHOWS, NEW_BADGE_TEXT, NEW_OPTION_PAGES, badgeStorageKey, markOpened, parseBadgeCount, showNewBadgeDot, showNewOptions, showNewOptionsInGroup, type BadgeCounts } from '../settingsBadge'
import { Braces, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, FolderTree, GitCommitIcon, Moon, Palette, Search, SlidersHorizontal, Sun, X } from 'lucide-vue-next'
import TemplateSettingsPage from './TemplateSettingsPage.vue'
import ProjectStructurePane from './ProjectStructurePane.vue'
import type { EditorSettings, JavaProjectSettings, ProjectSettings, TemplateSettings, TodoPattern } from '../bridge'
import type { Theme } from '../appearance'

const props = defineProps<{
  settings: EditorSettings
  projectSettings: ProjectSettings | null
  projectRoot: string | null
  activePath: string
  theme: Theme
  busy: boolean
  error: string
  initialSection?: 'editor' | 'appearance' | null
  /** IDEA's commit-message inspections (Settings › Version Control › Commit). */
  commitMessageSettings: CommitMessageInspectionSettings
}>()
const templateLanguage = computed(() => languageFor(props.activePath))
const emit = defineEmits<{
  save: [settings: EditorSettings, close?: boolean]
  saveCommitMessage: [settings: CommitMessageInspectionSettings, close?: boolean]
  saveProject: [patch: { excludedDirs: string[]; todoPatterns: TodoPattern[] }]
  saveJava: [settings: JavaProjectSettings]
  saveTemplates: [settings: TemplateSettings]
  browseDirectory: [field: 'jdkHome' | 'outputPath']
  theme: [theme: Theme]
  close: []
  pickBackground: []
  clearBackground: []
}>()
const id = useId()
const dialog = ref<HTMLDialogElement>()
const editorForm = ref<HTMLFormElement>()
const editor = ref<EditorSettings>({ ...props.settings })
// IDEA's commit-message inspections are a second, independent page with its own draft
// (Settings › Version Control › Commit, CommitDialogConfigurable.kt:56-101).
const commitMessage = ref<CommitMessageInspectionSettings>({ ...props.commitMessageSettings })

// IDEA's ConfigurablesListPanel: a tree of configurables. Only pages with a real
// backend exist here — a category without one is not rendered as an empty shell.
// 外观与行为 → 外观；编辑器；项目 → 项目结构 / 实时模板；版本控制 → 提交.
interface SettingsNode { key: PageKey; label: string; icon: typeof Palette; parent: string | null; keywords: string }
type PageKey = 'appearance' | 'editor' | 'structure' | 'templates' | 'commit'
const groups = [
  { key: 'group:appearance', label: '外观与行为' },
  { key: 'group:project', label: '项目' },
  { key: 'group:vcs', label: '版本控制' },
]
const nodes: SettingsNode[] = [
  { key: 'appearance', label: '外观', icon: Palette, parent: 'group:appearance', keywords: '主题 亮色 暗色 外观 theme' },
  { key: 'editor', label: '编辑器', icon: SlidersHorizontal, parent: null, keywords: '字体 大小 缩进 空格 制表符 行号 换行 空白 括号 标签 保存 自动 editor' },
  { key: 'structure', label: '项目结构', icon: FolderTree, parent: 'group:project', keywords: 'JDK 输出目录 排除目录 源代码根 测试根 项目 structure' },
  { key: 'templates', label: '实时模板', icon: Braces, parent: 'group:project', keywords: '模板 缩写 实时 展开 template' },
  { key: 'commit', label: '提交', icon: GitCommitIcon, parent: 'group:vcs', keywords: '提交 信息 主题 正文 右边距 空行 换行 commit message margin' },
]
const expanded = ref(new Set<string>(groups.map(group => group.key)))
const section = ref<PageKey>(props.initialSection === 'editor' ? 'editor' : props.initialSection === 'appearance' ? 'appearance' : 'appearance')

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

// IDEA's SettingsFilter + SearchableOptionsRegistrarImpl: the search box narrows the tree to the
// pages whose *name* contains the whole query or whose *options* match it (SettingsFilter.kt:206-229,
// SearchableOptionsRegistrarImpl.kt:217-260), Enter jumps to a name hit first (:222-229), the
// matching options inside the page are spotlighted (SearchUtil.kt:82-86), a query that contains the
// group separator is treated as a pasted path (SearchableOptionsRegistrarImpl.kt:457-529), and a
// query that matches nothing turns the field red (SettingsFilter.kt:212).
const query = ref('')
const searchInput = ref<HTMLInputElement>()
const searching = computed(() => query.value.trim().length > 0)

// IDEA's filter field is a `SearchTextField("SettingsSearchHistory")`
// (options/newEditor/SettingsSearch.java:25), so it owns a search history: queries are kept
// most-recent-first and capped at five (SearchTextField.java:69,356-384), recorded when the field
// loses focus (:233-235), before the history popup opens (:425-426) and when an item is chosen
// (:417-423), and listed by a popup shown underneath the field with a single selection
// (:440-461, Alt+Down :64/:487-490, Alt+Up steps to the previous item :173-195).
// The rules live in src/searchHistory.ts so they are testable without a DOM.
const searchBox = ref<HTMLElement>()
const historyPopup = ref<HTMLElement>()
const searchHistory = ref<string[]>(loadSearchHistory())
const historyIndex = ref(0)
const historyOpen = ref(false)
const historyCursor = ref(0)
const historyBox = ref<{ x: number; y: number; width: number } | null>(null)
const historyItems = computed(() => popupHistory(searchHistory.value))
function loadSearchHistory(): string[] {
  try { return parseHistory(localStorage.getItem(SETTINGS_SEARCH_HISTORY_KEY)) }
  catch { return [] }
}
function writeSearchHistory(entries: string[]) {
  try { localStorage.setItem(SETTINGS_SEARCH_HISTORY_KEY, formatHistory(entries)) }
  catch { /* storage unavailable: kept for this session */ }
}
// `addCurrentTextToHistory` (:284-288) only persists when `addElement` reported a change.
function recordSearchHistory(text = query.value) {
  const { entries, changed } = addHistoryEntry(searchHistory.value, text)
  searchHistory.value = entries
  if (changed) writeSearchHistory(entries)
}
async function openHistory() {
  recordSearchHistory()
  // A list of five is the whole point of the popup; showing an empty one would just be a stray box.
  if (historyOpen.value || !searchHistory.value.length) return
  const box = searchBox.value
  if (!box) return
  const rect = box.getBoundingClientRect()
  // `AlignedPopup.showUnderneathWithoutAlignment` (:459): below the field, left edges aligned.
  historyBox.value = { x: rect.left, y: rect.bottom + 4, width: rect.width }
  historyCursor.value = 0
  historyOpen.value = true
  await nextTick()
  historyPopup.value?.focus()
}
async function closeHistory() {
  if (!historyOpen.value) return
  historyOpen.value = false
  await nextTick()
  searchInput.value?.focus()
}
// `createItemChosenCallback` (:417-423): the chosen value becomes the text and is re-recorded.
function pickHistory(item: string | undefined) {
  if (item === undefined) return
  query.value = item
  recordSearchHistory(item)
  void closeHistory()
}
// `showPrevHistoryItem` / `showNextHistoryItem` (:173-195): the text in the field is recorded
// first, then the index steps and the text follows it. The index starts at 0 and is never reset,
// which is why the first Alt+Down lands on the second entry.
function stepSearchHistory(direction: HistoryDirection) {
  const state = stepHistory(searchHistory.value, query.value, historyIndex.value, direction)
  searchHistory.value = state.entries
  historyIndex.value = state.index
  query.value = state.text
  if (state.changed) writeSearchHistory(state.entries)
}
function onSearchIconClick() {
  // The leading area of IDEA's field opens the history on a single click (:119-124); with no
  // history there is nothing to show, so the click just puts the caret in the field.
  if (searchHistory.value.length) void openHistory()
  else searchInput.value?.focus()
}

// One row per labelled option in a page. Read from the DOM rather than duplicated as data, so a
// label can never drift from the template — IDEA indexes the components themselves
// (SearchUtil.kt:63-79 walks the component tree).
interface OptionRow { page: PageKey; el: HTMLElement; text: string }
const optionRows = ref<OptionRow[]>([])
function scanOptions() {
  const rows: OptionRow[] = []
  for (const node of nodes) {
    const panel = dialog.value?.querySelector<HTMLElement>(`[data-page="${node.key}"]`)
    if (!panel) continue
    for (const el of panel.querySelectorAll<HTMLElement>('.checkbox-row, .input-row, .theme-option')) {
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (text) rows.push({ page: node.key, el, text })
    }
  }
  optionRows.value = rows
}
const optionTexts = (key: PageKey): string[] => [
  nodes.find(node => node.key === key)?.keywords ?? '',
  ...optionRows.value.filter(row => row.page === key).map(row => row.text),
]

// A pasted "文件 | 设置 | 编辑器 | 缩进宽度" path jumps straight to the page it names and keeps the
// leftover segments as the spotlight text (SearchableOptionsRegistrarImpl.kt:495-500).
const pathHit = computed(() => resolveSettingsPath(query.value, groups, nodes))
const pathTargets = computed<PageKey[]>(() => {
  const hit = pathHit.value
  if (!hit) return []
  // The path may stop at a group, which has no page of its own — then every page of that group shows.
  if (groups.some(group => group.key === hit.key)) return nodes.filter(node => node.parent === hit.key).map(node => node.key)
  return [hit.key as PageKey]
})
const visibleNodes = computed(() => {
  if (!searching.value) return nodes
  const targets = pathTargets.value
  if (targets.length) return nodes.filter(node => targets.includes(node.key))
  const named = nodes.filter(node => isNameHit(`${node.label}\n${node.keywords}`, query.value))
  const content = nodes.filter(node => optionMatches(optionTexts(node.key), query.value))
  return [...new Set([...named, ...content])]
})
// SettingsFilter.kt:212 — IDEA turns the search field red when the filter came back empty.
const noMatch = computed(() => searching.value && visibleNodes.value.length === 0)
// SearchUtil.lightOptions (:82-86): the strict "every word" pass over the current page first, and
// only when it finds nothing the loose "any word or substring" pass.
const spotlightText = computed(() => pathHit.value?.spotlight || query.value)
const spotlightRows = computed<OptionRow[]>(() => {
  const text = spotlightText.value
  if (!text.trim()) return []
  const rows = optionRows.value.filter(row => row.page === section.value)
  const strict = rows.filter(row => matchesOption(row.text, text, true))
  return strict.length ? strict : rows.filter(row => matchesOption(row.text, text, false))
})
const spotlightActive = ref(false)
let spotlightTimer: number | undefined
function applySpotlight() {
  for (const row of optionRows.value) row.el.classList.remove('settings-spotlight')
  const rows = spotlightRows.value
  spotlightActive.value = rows.length > 0
  if (!rows.length) return
  for (const row of rows) row.el.classList.add('settings-spotlight')
  // SpotlightPainter.center() (:131-171): centre the first matched component and leave the scroll
  // position alone afterwards — DO_NOT_SCROLL (:57-59) keeps the later matches from re-scrolling.
  rows[0]!.el.scrollIntoView({ block: 'center', inline: 'nearest' })
}
// SpotlightPainter debounces its recompute by 200 ms (:64-67).
watch([spotlightText, section, optionRows], () => {
  if (spotlightTimer !== undefined) clearTimeout(spotlightTimer)
  spotlightTimer = window.setTimeout(applySpotlight, 200)
})
function clearSearch() {
  query.value = ''
}
function onSearchPointerDown() {
  // SettingsFilter.kt:93-105 — pressing into a non-empty field selects the query so it is easy to replace.
  if (searching.value && document.activeElement !== searchInput.value) searchInput.value?.select()
}
const visibleGroups = computed(() => {
  const needed = new Set(visibleNodes.value.map(node => node.parent).filter((parent): parent is string => Boolean(parent)))
  return groups.filter(group => needed.has(group.key))
})
// Order of the tree as the arrow keys walk it: groups collapsed to their selected
// child, expanded groups list every child, search mode lists matches directly.
const flatKeys = computed<PageKey[]>(() => {
  if (searching.value) return visibleNodes.value.map(node => node.key)
  const keys: PageKey[] = []
  for (const group of groups) {
    if (!expanded.value.has(group.key)) continue
    for (const node of nodes) if (node.parent === group.key) keys.push(node.key)
  }
  for (const node of nodes) if (!node.parent) keys.push(node.key)
  return keys
})
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
  try { void navigator.clipboard?.writeText(path) } catch { /* clipboard may be unavailable in WebView2 */ }
  copyNote.value = `已复制：${path}`
  if (copyTimer !== undefined) clearTimeout(copyTimer)
  copyTimer = window.setTimeout(() => { copyNote.value = '' }, 4000)
}

const validEditor = computed(() => Number.isInteger(editor.value.fontSize)
  && editor.value.fontSize >= 10 && editor.value.fontSize <= 32 && [2, 4, 8].includes(editor.value.tabSize)
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
const dirty = computed(() => editorDirty.value || commitMessageDirty.value)
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
function applyAll() {
  if (editorDirty.value) applyEditor()
  if (commitMessageDirty.value) applyCommitMessage()
}
function ok() {
  // IDEA's OK: apply, then close only when the save went through.
  if (!dirty.value) { close(); return }
  if (props.busy || !validEditor.value || !validCommitMessage.value) return
  if (editorDirty.value && !editorForm.value?.reportValidity()) return
  applyEditor(true)
  applyCommitMessage(true)
}
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
  if (spotlightTimer !== undefined) clearTimeout(spotlightTimer)
  if (copyTimer !== undefined) clearTimeout(copyTimer)
  for (const row of optionRows.value) row.el.classList.remove('settings-spotlight')
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
      <button type="button" class="icon-button" :disabled="busy" :title="busy ? '正在保存，请稍候' : '关闭（Esc）'" aria-label="关闭设置" @click="close"><X :size="18" aria-hidden="true" /></button>
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
          ><Search :size="14" aria-hidden="true" /></button>
          <input
            ref="searchInput" v-model="query" type="search" placeholder="搜索设置" autocomplete="off" spellcheck="false"
            title="查找 (Ctrl+F)" aria-describedby="settings-search-hint" @mousedown="onSearchPointerDown" @keydown.enter.prevent="onSearchEnter"
            @blur="recordSearchHistory()" @keydown.alt.down.prevent="openHistory()" @keydown.alt.up.prevent="stepSearchHistory('prev')"
          />
          <button v-if="query" type="button" class="icon-button" title="清空搜索（Esc）" aria-label="清空搜索" @click="clearSearch"><X :size="12" aria-hidden="true" /></button>
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
            ><component :is="node.icon" :size="16" aria-hidden="true" /><span>{{ node.label }}</span><span v-if="pageHasNewBadge(node.key)" class="settings-new-dot" role="img" :aria-label="NEW_BADGE_TEXT" :title="NEW_BADGE_TEXT" /></button>
          </template>
          <button
            v-for="node in visibleNodes.filter(item => !item.parent)" :id="`${id}-tab-${node.key}`" :key="node.key"
            type="button" class="menu-button settings-tab" role="tab" :aria-selected="section === node.key"
            :aria-controls="`${id}-panel-${node.key}`" :tabindex="section === node.key ? 0 : -1"
            @click="select(node.key)"
          ><component :is="node.icon" :size="16" aria-hidden="true" /><span>{{ node.label }}</span><span v-if="pageHasNewBadge(node.key)" class="settings-new-dot" role="img" :aria-label="NEW_BADGE_TEXT" :title="NEW_BADGE_TEXT" /></button>
          <p v-if="!visibleNodes.length" class="settings-empty">没有匹配的设置项。</p>
        </template>
        <template v-else>
          <template v-for="group in groups" :key="group.key">
            <button
              type="button" class="menu-button settings-tab settings-group" role="tab"
              :aria-expanded="expanded.has(group.key)" :tabindex="-1"
              @click="toggleGroup(group.key)"
            >
              <ChevronDown :size="13" class="settings-caret" :class="{ 'settings-caret-closed': !expanded.has(group.key) }" aria-hidden="true" />
              <span>{{ group.label }}</span>
              <span v-if="groupHasNewBadge(group.key)" class="settings-new-dot" role="img" :aria-label="NEW_BADGE_TEXT" :title="NEW_BADGE_TEXT" />
            </button>
            <template v-if="expanded.has(group.key)">
              <button
                v-for="node in nodes.filter(item => item.parent === group.key)" :id="`${id}-tab-${node.key}`" :key="node.key"
                type="button" class="menu-button settings-tab settings-child" role="tab" :aria-selected="section === node.key"
                :aria-controls="`${id}-panel-${node.key}`" :tabindex="section === node.key ? 0 : -1"
                @click="select(node.key)"
              ><component :is="node.icon" :size="16" aria-hidden="true" /><span>{{ node.label }}</span><span v-if="pageHasNewBadge(node.key)" class="settings-new-dot" role="img" :aria-label="NEW_BADGE_TEXT" :title="NEW_BADGE_TEXT" /></button>
            </template>
          </template>
          <button
            v-for="node in nodes.filter(item => !item.parent)" :id="`${id}-tab-${node.key}`" :key="node.key"
            type="button" class="menu-button settings-tab" role="tab" :aria-selected="section === node.key"
            :aria-controls="`${id}-panel-${node.key}`" :tabindex="section === node.key ? 0 : -1"
            @click="select(node.key)"
          ><component :is="node.icon" :size="16" aria-hidden="true" /><span>{{ node.label }}</span><span v-if="pageHasNewBadge(node.key)" class="settings-new-dot" role="img" :aria-label="NEW_BADGE_TEXT" :title="NEW_BADGE_TEXT" /></button>
        </template>
      </nav>
      <div class="settings-content" :class="{ 'settings-spotlight-on': spotlightActive }">
        <div class="settings-breadcrumb">
          <button type="button" class="icon-button" :disabled="!history.length" title="后退" aria-label="后退" @click="goBack"><ChevronLeft :size="16" aria-hidden="true" /></button>
          <button type="button" class="icon-button" :disabled="!future.length" title="前进" aria-label="前进" @click="goForward"><ChevronRight :size="16" aria-hidden="true" /></button>
          <span
            class="settings-crumbs" role="button" tabindex="0" title="右键或 Shift+F10 复制设置路径"
            @contextmenu.prevent="openCrumbMenu" @keydown.shift.f10.prevent="openCrumbMenu" @keydown.contextmenu.prevent="openCrumbMenu"
          >
            <template v-if="groupLabel"><span class="crumb-group">{{ groups.find(group => group.key === groupLabel)?.label }}</span><ChevronRight :size="11" class="crumb-sep" aria-hidden="true" /></template>
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
        <section
          v-show="section === 'appearance'" :id="`${id}-panel-appearance`" class="settings-panel" data-page="appearance"
          role="tabpanel" :aria-labelledby="`${id}-tab-appearance`"
        >
          <h3>外观</h3>
          <p class="section-description">主题立即生效；缩放与紧凑模式随“应用”保存并立即作用于整个界面。</p>
          <div class="theme-options" role="group" aria-label="主题">
            <button type="button" class="subtle-button theme-option" :aria-pressed="theme === 'light'" @click="emit('theme', 'light')"><Sun :size="19" aria-hidden="true" /><span>亮色</span><span class="theme-state">{{ theme === 'light' ? '当前主题' : '切换到亮色' }}</span></button>
            <button type="button" class="subtle-button theme-option" :aria-pressed="theme === 'dark'" @click="emit('theme', 'dark')"><Moon :size="19" aria-hidden="true" /><span>暗色</span><span class="theme-state">{{ theme === 'dark' ? '当前主题' : '切换到暗色' }}</span></button>
          </div>
          <fieldset class="settings-fields" :disabled="busy" aria-label="缩放与界面密度">
            <div class="input-row">
              <label :for="`${id}-zoom`">缩放</label>
              <div class="zoom-row">
                <select :id="`${id}-zoom`" v-model.number="editor.uiZoomPercent" :aria-describedby="`${id}-zoom-hint`">
                  <option v-for="percent in [50, 70, 80, 90, 100, 110, 125, 150, 175, 200]" :key="percent" :value="percent">{{ percent }}%</option>
                </select>
                <button type="button" class="subtle-button" :disabled="editor.uiZoomPercent === 100" title="重置为默认缩放" @click="editor.uiZoomPercent = 100">重置</button>
              </div>
            </div>
            <p :id="`${id}-zoom-hint`" class="field-hint restore-hint">整个界面的缩放百分比（50–400）。与其他外观项一样，点“应用”或“确定”后生效并保存。</p>
            <label class="checkbox-row"><input v-model="editor.compactMode" type="checkbox" :aria-describedby="`${id}-compact-hint`" /><span>紧凑模式</span></label>
            <p :id="`${id}-compact-hint`" class="field-hint restore-hint">界面元素占用更少的屏幕空间（控件高度、标签条与标题栏更矮）。</p>
            <label class="checkbox-row"><input v-model="editor.fullPathsInWindowHeader" type="checkbox" :aria-describedby="`${id}-fullpath-hint`" /><span>在窗口标题中始终显示完整路径</span></label>
            <p :id="`${id}-fullpath-hint`" class="field-hint restore-hint">窗口标题显示项目根目录而不是仅文件夹名，便于区分同名的两个项目。</p>
          </fieldset>
          <h4 class="settings-group-title">辅助功能与字体</h4>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="editor.supportScreenReaders" type="checkbox" :aria-describedby="`${id}-sr-hint`" /><span>支持屏幕阅读器</span></label>
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
              <label :for="`${id}-main-menu`">主菜单位置</label>
              <select :id="`${id}-main-menu`" v-model="editor.mainMenuDisplayMode">
                <option value="merged">合并到主工具栏</option>
                <option value="separate">独立工具栏</option>
                <option value="hamburger">隐藏在汉堡按钮下方</option>
              </select>
            </div>
            <p class="field-hint restore-hint">对应 IDEA 的 MainMenuDisplayMode：合并（默认）、独立一行、或收纳进一个汉堡按钮。</p>
          </fieldset>
          <h4 class="settings-group-title">树视图</h4>
          <fieldset class="settings-fields" :disabled="busy">
            <label class="checkbox-row"><input v-model="editor.showTreeIndentGuides" type="checkbox" :aria-describedby="`${id}-tree-guides-hint`" /><span>显示缩进参考线</span></label>
            <p :id="`${id}-tree-guides-hint`" class="field-hint restore-hint">在项目树的每个层级边界画一条垂直参考线，随“应用”立即生效。</p>
            <label class="checkbox-row"><input v-model="editor.compactTreeIndents" type="checkbox" :aria-describedby="`${id}-tree-indent-hint`" /><span>使用更小的缩进</span></label>
            <p :id="`${id}-tree-indent-hint`" class="field-hint restore-hint">项目树每层缩进从 15 像素缩小到 11 像素，深层目录少占横向空间。</p>
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
          v-show="section === 'editor'" :id="`${id}-panel-editor`" ref="editorForm" class="settings-panel" data-page="editor"
          role="tabpanel" :aria-labelledby="`${id}-tab-editor`" :aria-busy="busy" @submit.prevent="applyEditor()"
        >
          <h3>编辑器</h3>
          <div class="editor-page-head">
            <button type="button" class="subtle-button" title="把本页全部选项恢复为出厂默认值（需再点“保存编辑器设置”生效）" @click="resetEditorPage()">恢复默认</button>
          </div>
          <p class="section-description">这些设置应用于编辑器。修改后点击“应用”或“确定”。</p>
          <fieldset class="settings-fields" :disabled="busy">
            <div class="input-row">
              <label :for="`${id}-font`">字体大小 <span class="field-hint">（像素）</span></label>
              <input :id="`${id}-font`" v-model.number="editor.fontSize" type="number" min="10" max="32" step="1" required :aria-describedby="`${id}-font-hint`" />
            </div>
            <p :id="`${id}-font-hint`" class="field-hint" :class="{ 'validation-error': !validEditor }">字体大小需为 10–32 之间的整数。</p>
            <div class="input-row">
              <label :for="`${id}-tab-size`">缩进宽度</label>
              <select :id="`${id}-tab-size`" v-model.number="editor.tabSize" :aria-describedby="`${id}-tabs-hint`">
                <option v-for="size in [2, 4, 8]" :key="size" :value="size">{{ sizeLabel(size) }}</option>
              </select>
            </div>
            <p :id="`${id}-tabs-hint`" class="field-hint restore-hint">{{ tabCharacterHint }}</p>
            <label class="checkbox-row"><input v-model="editor.useTabCharacter" type="checkbox" :aria-describedby="`${id}-tabchar-hint`" /><span>使用制表符（Tab 字符）缩进</span></label>
            <p :id="`${id}-tabchar-hint`" class="field-hint restore-hint">开启后 Tab 与自动缩进写入一个 Tab 字符；关闭时按上面的宽度写入空格。</p>
            <label class="checkbox-row"><input v-model="editor.showWhitespaces" type="checkbox" :aria-describedby="`${id}-ws-hint`" /><span>显示空白符号</span></label>
            <p :id="`${id}-ws-hint`" class="field-hint restore-hint">空格渲染为“·”，制表符渲染为“→”，行尾多余空格会一并显示。</p>
            <label class="checkbox-row"><input v-model="editor.formatOnSave" type="checkbox" :aria-describedby="`${id}-format-hint`" /><span>保存时格式化代码</span></label>
            <p :id="`${id}-format-hint`" class="field-hint restore-hint">先调用语言服务的格式化能力再写盘；该文件没有可用语言服务时按原样保存。</p>
            <label class="checkbox-row"><input v-model="editor.wordWrap" type="checkbox" /><span>自动换行</span></label>
            <label class="checkbox-row"><input v-model="editor.lineNumbers" type="checkbox" /><span>显示行号</span></label>
            <label class="checkbox-row"><input v-model="editor.showIndentGuides" type="checkbox" /><span>显示缩进参考线</span></label>
            <p class="field-hint restore-hint">IDEA 风格的垂直引导线，帮助识别代码块层级。</p>
            <label class="checkbox-row"><input v-model="editor.bracketMatching" type="checkbox" /><span>括号匹配高亮</span></label>
            <p class="field-hint restore-hint">光标靠近括号时高亮对应的另一侧括号。</p>
            <div class="input-row">
              <label :for="`${id}-tab-limit`">每个编辑器组的标签页上限</label>
              <input :id="`${id}-tab-limit`" v-model.number="editor.tabLimit" type="number" min="1" max="100" step="1" required :aria-describedby="`${id}-tab-limit-hint`" />
            </div>
            <p :id="`${id}-tab-limit-hint`" class="field-hint" :class="{ 'validation-error': !validEditor }">超过上限时，IDEA 会先关闭未修改且最久未选中的标签页（默认 30，范围 1–100）。</p>
            <label class="checkbox-row"><input v-model="editor.restoreLastProject" type="checkbox" :aria-describedby="`${id}-restore-hint`" /><span>重启时恢复上次项目</span></label>
            <label class="checkbox-row"><input v-model="editor.autoSave" type="checkbox" :aria-describedby="`${id}-autosave-hint`" /><span>停止输入 5 秒后自动保存</span></label>
            <p :id="`${id}-autosave-hint`" class="field-hint restore-hint">只保存已经改动过的文件；切换项目或关闭窗口前仍会提示未保存内容。</p>
            <label class="checkbox-row"><input v-model="editor.syncOnFocus" type="checkbox" :aria-describedby="`${id}-sync-hint`" /><span>窗口获得焦点时同步磁盘文件</span></label>
            <p :id="`${id}-sync-hint`" class="field-hint restore-hint">刷新项目树并重载没有改动的编辑器缓冲；有未保存修改的文件不会被覆盖，保存时仍会提示冲突。超过 4 MiB 的文件跳过自动同步。</p>
            <p :id="`${id}-restore-hint`" class="field-hint restore-hint">仅恢复上次打开的项目；未保存的文本不会自动保存，也不会随项目恢复。退出前请手动保存文件。</p>
          </fieldset>
        </form>

        <section v-show="section === 'structure'" :id="`${id}-panel-structure`" class="settings-panel" data-page="structure" role="tabpanel" :aria-labelledby="`${id}-tab-structure`" :aria-busy="busy">
          <ProjectStructurePane :settings="projectSettings" :root="projectRoot" :busy="busy" @save-java="emit('saveJava', $event)" @save-project="emit('saveProject', $event)" @browse="emit('browseDirectory', $event)" />
        </section>

        <section v-show="section === 'templates'" :id="`${id}-panel-templates`" class="settings-panel" data-page="templates" role="tabpanel" :aria-labelledby="`${id}-tab-templates`">
          <h3>实时模板</h3>
          <p v-if="!projectSettings" class="section-description">尚未打开项目。模板开关与自定义模板随项目保存，请先打开一个项目。</p>
          <TemplateSettingsPage v-else :settings="projectSettings.templates" :language="templateLanguage" :busy="busy" @change="emit('saveTemplates', $event)" />
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
            <p :id="`${id}-subject-margin-hint`" class="field-hint" :class="{ 'validation-error': !validCommitMessage }">提交信息第一行超过右边距即报告「主题行不能超过 N 个字符」。默认 72，允许 0–10000。</p>
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
      </div>
    </div>
    <footer class="dialog-footer">
      <span class="settings-hint"><CircleHelp :size="14" aria-hidden="true" /><span>项目级设置（项目结构、实时模板）仅应用于当前项目，随项目保存。</span></span>
      <span class="save-status" role="status">{{ copyNote || (busy ? '正在保存，请稍候…' : section === 'appearance' ? '主题即时生效' : section === 'templates' ? '模板改动即时保存到本项目' : section === 'structure' ? '项目结构改动需保存' : dirty ? '有未应用的修改' : '已应用') }}</span>
      <div class="footer-actions">
        <button type="button" class="subtle-button" :disabled="busy || !dirty" title="应用 (Alt+A)" @click="applyAll">应用(A)</button>
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
.settings-search-icon.has-history { cursor: pointer; }
.settings-search-icon.has-history:hover, .settings-search-icon.has-history:focus-visible { color: var(--text); }
.settings-history-popup { position: fixed; z-index: 30; display: flex; flex-direction: column; max-width: 320px; padding: 2px; background: var(--elevated); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); box-shadow: var(--menu-shadow); }
.settings-history-item { text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.settings-history-item.active { background: var(--selected); color: var(--bright); }
.settings-group-label { padding: var(--space-1) var(--space-2); color: var(--muted); font-size: 11px; }
.settings-tab { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; min-height: var(--ctrl-height-lg); padding: var(--space-1) var(--space-2); border: 0; background: transparent; color: var(--secondary); border-radius: var(--radius-sm); text-align: left; }
.settings-tab:hover { background: var(--hover); }
.settings-tab > svg { flex-shrink: 0; }
.settings-tab[aria-selected='true'] { color: var(--bright); background: var(--selected); font-weight: 600; }
.settings-group { color: var(--text); font-weight: 600; }
.settings-child { margin-left: var(--space-5); }
.settings-caret { transition: transform .12s ease; }
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
.theme-option { display: flex; flex: 1 1 135px; min-width: 0; align-items: center; flex-wrap: wrap; gap: var(--space-2); padding: var(--space-4); border: 1px solid var(--line-strong); border-radius: var(--radius-md); background: var(--editor); color: var(--secondary); }
.theme-option[aria-pressed='true'] { border-color: var(--accent); background: var(--selected); color: var(--bright); }
.theme-state { flex-basis: 100%; font-size: 11px; color: var(--muted); text-align: left; }
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
</style>
