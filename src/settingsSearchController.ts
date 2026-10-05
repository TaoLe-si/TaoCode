// 设置树搜索的**控制器** —— 抽成工厂（2026-10-05 模块化体检）。
//
// 为什么搬出来：SettingsDialog.vue 贴着机检上限（1356 行，只剩 6 行余量），而 185-378 那一段是
// 一个**与「设置树的表」无关的职责**：一个查询词怎么把树过滤成命中集合、当前页的哪些选项要
// spotlight、方向键按什么顺序走、历史弹层怎么开合。表在 src/settingsTreeMeta.ts，纯匹配规则在
// src/settingsSearch.ts，历史规则在 src/searchHistory.ts —— 这里只剩把它们接起来的那层编排。
//
// 搬动时**实现一个字没改**：下面 188 行与 SettingsDialog.vue 里原来的逐字相同，只是把
// `dialog` / `section` / `expanded` 三个宿主状态改成了 ctx 里的入参。
//
// 宿主那边的三处对接（都不改行为）：
//   · onMounted / watch 调 `scanOptions()` —— DOM 长出来才扫得到选项行（SearchUtil.kt:63-79 走组件树）；
//   · onBeforeUnmount 调 `dispose()` —— 原先是"清 spotlight 定时器 + 摘掉 spotlight 类"，现在这两行
//     收在模块里（spotlight 的定时器归它自己管，就该由它自己收）；
//   · ESC 顺序（先关历史弹层，再清查询）仍在宿主，因为那是**对话框**的策略，不是搜索的。
import { computed, nextTick, ref, watch, type Ref } from 'vue'
import { isNameHit, matchesOption, optionMatches, resolveSettingsPath } from './settingsSearch.ts'
import { addHistoryEntry, formatHistory, parseHistory, popupHistory, SETTINGS_SEARCH_HISTORY_KEY, stepHistory, type HistoryDirection } from './searchHistory.ts'
import { isParentOnly, type PageKey, SETTINGS_GROUPS as groups, SETTINGS_NODES as nodes } from './settingsTreeMeta.ts'

/** 宿主只需要给三样：对话框元素（扫选项行用）、当前页、展开的分组。 */
export function createSettingsSearch(ctx: {
  dialog: Ref<HTMLDialogElement | undefined>
  section: Ref<PageKey>
  expanded: Ref<Set<string>>
}) {
  const { dialog, section, expanded } = ctx
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
  // 一个匹配到的节点可能挂在另一个节点下（三层树），所以要把祖先一路走到分组。
  function ancestorGroupOf(key: string): string | null {
    let current = nodes.find(node => node.key === key)
    while (current && current.parent) {
      const parent = nodes.find(node => node.key === current!.parent)
      if (!parent) return current.parent          // parent 是分组
      current = parent
    }
    return null
  }
  const visibleGroups = computed(() => {
    const needed = new Set(visibleNodes.value.map(node => ancestorGroupOf(node.key)).filter((key): key is string => Boolean(key)))
    return groups.filter(group => needed.has(group.key))
  })
  // Order of the tree as the arrow keys walk it: groups collapsed to their selected
  // child, expanded groups list every child, search mode lists matches directly.
  const flatKeys = computed<PageKey[]>(() => {
    if (searching.value) return visibleNodes.value.map(node => node.key)
    const keys: PageKey[] = []
    for (const group of groups) {
      if (!expanded.value.has(group.key)) continue
      for (const node of nodes.filter(item => item.parent === group.key)) {
        if (!isParentOnly(node.key)) keys.push(node.key)
        for (const grand of nodes.filter(item => item.parent === node.key)) if (!isParentOnly(grand.key)) keys.push(grand.key)
      }
    }
    for (const node of nodes.filter(item => !item.parent)) {
      if (!isParentOnly(node.key)) keys.push(node.key)
      for (const child of nodes.filter(item => item.parent === node.key)) {
        if (!isParentOnly(child.key)) keys.push(child.key)
        for (const grand of nodes.filter(item => item.parent === child.key)) if (!isParentOnly(grand.key)) keys.push(grand.key)
      }
    }
    return keys
  })

  /** onBeforeUnmount 用：spotlight 的定时器归本模块管，收摊也归本模块收。 */
  function dispose() {
    if (spotlightTimer !== undefined) clearTimeout(spotlightTimer)
    for (const row of optionRows.value) row.el.classList.remove('settings-spotlight')
  }

  return {
    query, searchInput, searching,
    searchBox, historyPopup, searchHistory, historyOpen, historyCursor, historyBox, historyItems,
    recordSearchHistory, openHistory, closeHistory, pickHistory, stepSearchHistory, onSearchIconClick,
    optionRows, scanOptions, visibleNodes, noMatch, spotlightActive,
    clearSearch, onSearchPointerDown, visibleGroups, flatKeys,
    dispose,
  }
}
