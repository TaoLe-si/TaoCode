// LSP 生命周期 + 文件内导航 + 符号搜索 —— 从 App.vue 搬出的一域（236 行，36 个依赖）。
//
// **范围说明（如实）**：这块比"LSP 生命周期"要宽 —— 因为启动/停止语言服务之后紧接着就是
// 「怎么跳到符号/位置」，两者共享同一批状态（`outline` / `symbolResults` / 位置环 `places` /
// 语言服务是否在跑）。它们是一个交互闭环，所以放在同一个模块里；`onSemantic`（语义动作）
// 另行处理，因为它依赖编辑器与重构链路。
import { computed, nextTick, ref, watch, type Ref } from 'vue'
import { notifyEditorContentChanged } from './bookmarkActions'
import { clearLspDiagnostics, lspDiagnostics, request, setLspDiagnostics, type DocumentData, type EditorSettings, type LspDocumentSymbol,
         type LspSymbolsResult, type Workspace } from './bridge'
import type { Tab } from './editorTab'
import { BreakpointLocationCache } from './breakpointLocations'
import { errorMessage } from './errors'
import { describeNavigationBoundary, navigateFrom, navigationPoints } from './navigateInFile'
import { locationSnippet } from './recentLocations'
import { startCompletionSession } from './lspCompletionStartup'

/** 工作区符号索引里的一条（LSP `workspace/symbol` 的扁平化结果）。 */
export interface SymbolEntry { name: string; kind: number; path: string; line: number; character: number; endLine?: number; endCharacter?: number }
/** Native preserves selectionRange.end separately from the enclosing outline range. */
type NavigationDocumentSymbol = LspDocumentSymbol & { selectionEndLine?: number; selectionEndCharacter?: number }

// IDEA's "Go to Class" (Ctrl+N) and "Go to Symbol" (Ctrl+Shift+Alt+N) are different
// filters over the same workspace-symbol index; the class filter is the LSP kinds that
// denote a type.
export const CLASS_KINDS = new Set([5, 11, 13, 19, 23, 26])

export interface Place { kind: '文件' | '符号' | '书签'; path: string; line: number; label: string; edited?: boolean }

export interface LspNavigationDeps {
  notify: (message: string, error?: boolean) => void
  /** 桌面端才有原生文件对话框（符号搜索要用）。 */
  isDesktop: boolean
  /** 会话快照的延迟保存（打开/切换文件后要记一笔）。 */
  scheduleSessionSave: () => void
  /** 语言服务是否开着——这一个开关决定本模块所有动作能不能跑。 */
  editorSettings: Ref<EditorSettings>
  generalSettings: Ref<any>
  workspace: Ref<Workspace | null>
  /** 工作区代次（宿主是 `let` 计数器）。 */
  workspaceEpoch: () => number
  active: { readonly value: any }
  activePath: Ref<any>
  groups: any
  findTab: (path: string) => any
  hasTabPath: (path: string) => boolean
  editorFor: (path: string) => any
  refreshTree: () => unknown
  refreshMarkdownSoon: () => void
  /** Markdown 预览开关（宿主更早的阶段就要读它，所以留在宿主）。 */
  markdownPreviewOn: Ref<boolean>
  menu: Ref<any>
  palette: Ref<any>
  outline: Ref<any>
  dirty: Ref<boolean>
  /** 最近位置环（宿主是 `Place[]` 的 ref）。 */
  places: Ref<Place[]>
  /** 「转到行」与「最近文件」两个对话框的状态（由 explorerActions 模块提供，宿主解构后传进来）。 */
  goLinePrompt: Ref<any>
  goLineValue: Ref<any>
  goLineInput: Ref<any>
  recentPrompt: Ref<any>
  recentQuery: Ref<any>
  recentInput: Ref<any>
  /** 最近更改的位置（宿主是 `Place[]` 的 ref）。 */
  changePlaces: Ref<Place[]>
  rememberPlace: (entry: any) => void
  navBack: Ref<any>
  navForward: Ref<any>
  openFile: (...args: any[]) => any
  save: (...args: any[]) => any
  saveAll: () => any
  reveal: Ref<any>
  splitModel: any
  symbolPrompt: Ref<any>
  symbolQuery: Ref<string>
  symbolInput: any
  symbolResults: Ref<any>
  symbolIndex: Ref<number>
  /** 符号搜索的防抖计时器由本模块自持（`let`，值语义不能靠外部传参）。 */
  breakpointLocationCache: BreakpointLocationCache
}

export function createLspNavigation(deps: LspNavigationDeps) {
  const { isDesktop, editorSettings, generalSettings, workspace, active, activePath, groups, findTab, hasTabPath,
          editorFor, refreshTree, refreshMarkdownSoon, markdownPreviewOn, menu, palette, outline, dirty, places, changePlaces,
          rememberPlace, navBack, navForward, openFile, save, saveAll, reveal, splitModel, symbolPrompt, symbolQuery,
          symbolInput, symbolResults, symbolIndex, breakpointLocationCache, scheduleSessionSave,
          goLineValue, goLinePrompt, goLineInput, recentPrompt, recentQuery, recentInput } = deps
  // 符号搜索输入防抖：`let` 是本模块的私有状态，不进 ctx（值语义传出去就写不回来）。
  let symbolTimer: number | undefined
  const starts = new Map<string, symbol>()
  async function startLsp(tab: Tab) {
    const epoch = deps.workspaceEpoch()
    const token = Symbol(tab.path)
    starts.set(tab.path, token)
    setLspDiagnostics(tab.path, [])
    const current = () => deps.workspaceEpoch() === epoch && starts.get(tab.path) === token && hasTabPath(tab.path)
    // Not awaited: a Java file must open (and be editable) while JDT LS is still
    // importing the project. The tab flips `lspRunning` once initialization lands,
    // which re-enables code insight through the editor's own `lsp-enabled` prop.
    void startCompletionSession(tab, { request, notify: deps.notify, current })
      .then(() => { if (current() && tab.path === activePath.value) void refreshOutline(tab.path) })
  }
  function lspOn(tab: Tab) {
    // IDEA PowerSaveMode: code insight is switched off entirely while it is on.
    if (editorSettings.value.powerSaveMode) return false
    return isDesktop && tab.lspRunning === true && tab.content.length <= 5 * 1024 * 1024
  }
  // IDEA's "save files if the application is idle": GeneralSettings.isAutoSaveIfInactive
  // (GeneralSettings.kt:81-91 -> state.autoSaveIfInactive), with the delay from
  // SAVE_FILES_AFTER_IDLE_SEC (:163 = 15, range 1..300, read as `inactiveTimeout.seconds` at
  // :193-202). SaveAndSyncHandlerImpl.kt:332-350 pushes idle events through
  // `debounce(inactiveTimeout.seconds)` and then saves every document; the timer below is
  // restarted by every edit (onEditorChange), which is the same "idle" signal.
  // Only buffers that actually changed are written, and a failed save still surfaces through
  // save()'s own error.
  //
  // The editor page used to carry its own `autoSave` switch with a hard-coded 5s: a second name
  // for this one option, so it is gone and this key now has its consumer.
  const autoSaveDelay = computed(() => Math.min(300, Math.max(1, generalSettings.value.inactiveTimeout)) * 1000)
  let autoSaveTimer: number | undefined
  function clearAutoSave() { if (autoSaveTimer) { window.clearTimeout(autoSaveTimer); autoSaveTimer = undefined } }
  function scheduleAutoSave() {
    clearAutoSave()
    if (!generalSettings.value.autoSaveIfInactive || !isDesktop || !dirty.value) return
    autoSaveTimer = window.setTimeout(() => {
      autoSaveTimer = undefined
      if (generalSettings.value.autoSaveIfInactive && dirty.value) void saveAll()
    }, autoSaveDelay.value)
  }
  // SaveAndSyncHandlerImpl.kt:300-319 — on frame deactivation IDEA saves every document when
  // GeneralSettings.isSaveOnFrameDeactivation (:73-78 -> state.autoSaveFiles) is on. The
  // window's `blur` is the same signal as ApplicationActivationListener.applicationDeactivated.
  function onWindowBlur() {
    if (!isDesktop || !generalSettings.value.autoSaveFiles || !dirty.value) return
    void saveAll()
  }
  function onEditorChange(tab: Tab) {
    tab.dirty = true
    tab.preview = false
    // 书签按"同一行号 + 同一行原文"对账（上游 BookmarkManager.documentChanged；丢/放回都在那一步）。
    notifyEditorContentChanged(tab.path, editorFor(tab.path)?.text() ?? tab.content)
    // 行号 → 可放置位置的映射依赖代码内容：改过就整体作废（见 breakpointLocations.ts 的类注释）。
    breakpointLocationCache.clear()
    // IdeDocumentHistory.placeChanged(EditorEvent.DocumentChange): every user edit
    // pushes the caret line onto the "changed places" ring.
    rememberPlace({ kind: '文件', path: tab.path, line: Math.max(0, (editorFor(tab.path)?.getCursor().line ?? tab.line - 1)), label: tab.path, edited: true })
    if (markdownPreviewOn.value && tab.path === activePath.value) refreshMarkdownSoon()
    scheduleAutoSave()
    scheduleSessionSave()  // drafts change on every keystroke, not just on dirty-flip
  }
  // IDEA's "Last Edit Location" is project-wide (JumpToLastChangeAction reads
  // IdeDocumentHistory.changePlaces), so Ctrl+Shift+Backspace follows edits across
  // files; the per-editor handler only covers jumps inside one buffer.
  function jumpLastEditLocation() {
    const current = active.value
    const here = current ? `${current.path}:${Math.max(0, (editorFor(current.path)?.getCursor().line ?? current.line - 1))}` : ''
    const place = changePlaces.value.find((item: any) => `${item.path}:${item.line}` !== here)
    if (!place) { deps.notify('没有上次编辑位置。', true); return }
    void revealLocation(place)
  }
  function stopLspFile(path: string) {
    starts.delete(path)
    clearLspDiagnostics(path)
    if (isDesktop) void request('lsp.close', { path }).catch(() => undefined)
  }
  // UI-side reset only. The host already rebuilds the language session inside
  // workspace.open (open_project → reset_lsp) and stops it inside workspace.close;
  // sending lsp.stop here ran *after* workspace.open and destroyed the session the
  // host had just created, so every Java file reported "no language server".
  function resetLsp(stopHost = false) {
    starts.clear()
    for (const path of [...lspDiagnostics.keys()]) clearLspDiagnostics(path)
    if (stopHost && isDesktop) void request('lsp.stop').catch(() => undefined)
  }
  async function revealLocation(target: { path: string; line: number; column?: number; kind?: Place['kind']; label?: string }, record = true) {
    const epoch = deps.workspaceEpoch()
    if (record && activePath.value && (activePath.value !== target.path || (active.value?.line ?? 1) - 1 !== target.line)) {
      navBack.value.push({ path: activePath.value, line: Math.max(0, (active.value?.line ?? 1) - 1) })
      if (navBack.value.length > 100) navBack.value.shift()
      navForward.value = []
    }
    if (!hasTabPath(target.path)) {
      await openFile(target.path)
      if (epoch !== deps.workspaceEpoch()) return
      if (!hasTabPath(target.path)) { deps.notify(`无法打开定义位置 ${target.path}`, true); return }
      // openFile records the fresh file at line 0; a jump owns the real destination.
      places.value = places.value.filter((item: any) => item.path !== target.path)
    }
    // IDEA jumps in whichever pane already shows the file; otherwise the focused pane.
    const pane = groups[0].tabs.some((tab: any) => tab.path === target.path) ? 0 as const : groups[1].tabs.some((tab: any) => tab.path === target.path) ? 1 as const : splitModel.focused
    splitModel.focused = pane
    groups[pane].activePath = target.path
    await nextTick()
    if (epoch !== deps.workspaceEpoch()) return
    reveal.value = { path: target.path, line: target.line, ...(target.column ? { column: target.column } : {}) }
    rememberPlace({ kind: target.kind ?? '文件', path: target.path, line: target.line, label: target.label ?? target.path })
  }
  async function goBack() {
    const from = navBack.value.pop()
    if (!from) return
    navForward.value.push({ path: activePath.value, line: Math.max(0, (active.value?.line ?? 1) - 1) })
    await revealLocation(from, false)
  }
  async function goForward() {
    const to = navForward.value.pop()
    if (!to) return
    navBack.value.push({ path: activePath.value, line: Math.max(0, (active.value?.line ?? 1) - 1) })
    await revealLocation(to, false)
  }
  // Menu and keyboard reach the two prompts through the same opener, which owns the
  // focus/selection step the prompt needs.
  function openGoLine() { goLineValue.value = ''; goLinePrompt.value = true; void nextTick(() => goLineInput.value?.select()) }
  function openRecentFiles() { recentQuery.value = ''; recentPrompt.value = true; void nextTick(() => recentInput.value?.focus()) }
  const placesPrompt = ref(false)
  const placesQuery = ref('')
  const placesInput = ref<HTMLInputElement>()
  // RecentLocationsAction: the checkbox toggles navigation places vs change places, and
  // the popup title follows it ("Recent Locations" / "Recently Edited Locations").
  const placesEditedOnly = ref(false)
  const placesList = computed(() => placesEditedOnly.value ? changePlaces.value : places.value)
  // RecentLocationsRenderer shows the caret line's snippet; buffers are live in memory.
  function placeSnippet(place: Place): { text: string; firstLine: number } {
    const tab = findTab(place.path)
    if (!tab) return { text: '', firstLine: 0 }
    return locationSnippet(tab.content.split(/\r?\n/), Math.min(place.line, Math.max(0, tab.content.split(/\r?\n/).length - 1)))
  }
  const placesFiltered = computed(() => {
    const query = placesQuery.value.trim().toLowerCase()
    return query ? placesList.value.filter(place => place.label.toLowerCase().includes(query) || place.path.toLowerCase().includes(query)) : placesList.value
  })
  // ScrollingUtil.installActions + ENTER: the list keeps a highlighted row, Enter jumps.
  const placesIndex = ref(0)
  function movePlace(step: number) {
    const size = Math.max(1, placesFiltered.value.length)
    placesIndex.value = (placesIndex.value + step + size) % size
  }
  watch(placesQuery, () => { placesIndex.value = 0 })
  watch(placesEditedOnly, () => { placesIndex.value = 0 })
  function openRecentPlaces() {
    placesQuery.value = ''
    menu.value = null
    palette.value = false; symbolPrompt.value = null; recentPrompt.value = false
    placesPrompt.value = true
    void nextTick(() => placesInput.value?.focus())
  }
  function openPlace(place: Place) { placesPrompt.value = false; void revealLocation(place) }
  function fileSymbolEntries(query: string): SymbolEntry[] {
    const path = activePath.value
    if (!path) return []
    const q = query.trim().toLowerCase()
    return (outline.value as LspDocumentSymbol[])
      .filter((symbol: LspDocumentSymbol) => !q || symbol.name.toLowerCase().includes(q))
      .slice(0, 200)
      .map((symbol: NavigationDocumentSymbol) => ({ name: symbol.name, kind: symbol.kind, path, line: symbol.startLine, character: symbol.startChar,
        endLine: symbol.selectionEndLine, endCharacter: symbol.selectionEndCharacter }))
  }
  async function globalSymbolEntries(query: string) {
    const q = query.trim()
    if (!isDesktop || !workspace.value || q.length < 2) { symbolResults.value = []; return }
    try {
      const result = await request<{ available: boolean; symbols?: SymbolEntry[] }>('lsp.request', { kind: 'workspaceSymbol', path: activePath.value ?? '', query: q })
      const all = result.symbols ?? []
      symbolResults.value = (symbolPrompt.value?.mode === 'class' ? all.filter(entry => CLASS_KINDS.has(entry.kind)) : all).slice(0, 200)
    } catch { symbolResults.value = [] }
  }
  function openSymbol(mode: 'file' | 'global' | 'class') {
    menu.value = null
    if (!active.value) return
    symbolPrompt.value = { mode }
    symbolQuery.value = ''
    symbolResults.value = mode === 'file' ? fileSymbolEntries('') : []
    // 'class' needs two characters typed (the same threshold as the LSP query), so the
    // list starts empty and fills as the user types.
    symbolIndex.value = 0
    void nextTick(() => symbolInput.value?.focus())
  }
  function onSymbolQuery() {
    symbolIndex.value = 0
    if (symbolPrompt.value?.mode === 'file') { symbolResults.value = fileSymbolEntries(symbolQuery.value); return }
    if (symbolTimer !== undefined) clearTimeout(symbolTimer)
    symbolTimer = window.setTimeout(() => void globalSymbolEntries(symbolQuery.value), 250)
  }
  function moveSymbol(delta: number) {
    const count = symbolResults.value.length
    if (!count) return
    symbolIndex.value = (symbolIndex.value + delta + count) % count
  }
  async function jumpSymbol(entry: SymbolEntry) {
    symbolPrompt.value = null
    await revealLocation({ path: entry.path, line: entry.line, kind: '符号', label: entry.name })
  }
  async function onSearchOpen(payload: { path: string; line: number }) {
    await revealLocation({ path: payload.path, line: Math.max(0, payload.line - 1) })
  }
  // A replace rewrites files behind the editors' backs: reload every open buffer whose
  // path was touched, then refresh the tree so the UI never shows stale content.
  async function onSearchReplaced(payload: { paths: string[] }) {
    for (const path of payload.paths) {
      const tab = findTab(path)
      if (!tab || tab.dirty) continue   // never clobber unsaved edits
      try {
        const doc = await request<DocumentData>('file.read', { path })
        tab.content = doc.content
        tab.version = doc.version
        tab.readOnly = doc.readOnly
        // The editor holds its own buffer, so the new text has to be pushed into it.
        editorFor(path)?.setDraft(doc.content)
      } catch { /* the file may have been moved mid-replace */ }
    }
    await refreshTree()
  }
  // GoToMenu › NavigateInFileGroup 的 MethodDown / MethodUp（`PlatformActions.xml:621-623`）。
  // 不需要新的语言服务能力：已实现的 `textDocument/documentSymbol` 就够 —— LSP SymbolKind
  // 6 = Method、12 = Function，只认这两类，避免把字段/变量也当方法。键位与 IDEA 一致（Alt+Down / Alt+Up）。
  async function jumpMethod(direction: 1 | -1) {
    const tab = active.value
    if (!tab || !lspOn(tab)) { deps.notify('该文件未启用语言服务。', true); return }
    await refreshOutline(tab.path)
    // **不按 kind 过滤**：IDEA 的 `MethodUpDownUtil.addStructureViewElements`（:61-73）递归收集结构视图的
    // 全部元素（类、字段、嵌套结构都算），名字叫 Method 是历史叫法。规则见 src/navigateInFile.ts。
    const points = navigationPoints(outline.value)
    if (!points.length) { deps.notify('该文件没有可跳转的结构元素。'); return }
    const current = Math.max(0, editorFor(tab.path)?.getCursor().line ?? 0)
    // 与 IDEA 一致：跳到光标**之后/之前**的最近一个导航点，已经到头就提示而不是绕回
    // （IDEA 的 handler 直接 return null）。
    const target = navigateFrom(points, current, direction)
    if (!target) { deps.notify(describeNavigationBoundary(direction)); return }
    void revealLocation({ path: tab.path, line: target.line, column: 1 })
  }
  async function refreshOutline(path: string) {
    const tab = findTab(path)
    if (!tab || !lspOn(tab)) { outline.value = []; return }
    try {
      const result = await request<{ available: boolean; symbols?: LspDocumentSymbol[] }>('lsp.request', { kind: 'documentSymbol', path })
      outline.value = result.available ? result.symbols ?? [] : []
    } catch { outline.value = [] }
  }
  // 换文件只刷新结构视图。**不**清引用结果：IDEA 的 Find 窗口里那些内容是 `ContentManager`
  // 持有的条目，只有"再搜一次把它顶替掉"或"关掉那条"才会消失
  // （`platform/lang-impl/src/com/intellij/usageView/impl/UsageViewContentManagerImpl.java:149-192`），
  // 换编辑器标签页与它无关。
  watch(activePath, path => { void refreshOutline(path) })
  return {
    startLsp, lspOn, autoSaveDelay, clearAutoSave, scheduleAutoSave, onWindowBlur, onEditorChange,
    jumpLastEditLocation, stopLspFile, resetLsp, revealLocation, goBack, goForward, openGoLine,
    openRecentFiles, placesPrompt, placesQuery, placesInput, placesEditedOnly, placesList, placeSnippet,
    placesFiltered, placesIndex, movePlace, openRecentPlaces, openPlace,
    fileSymbolEntries, globalSymbolEntries, openSymbol, onSymbolQuery, moveSymbol, jumpSymbol,
    onSearchOpen, onSearchReplaced, jumpMethod, refreshOutline,
  }
}
