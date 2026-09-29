// 全局快捷键分派 —— 从 App.vue 搬出的一域（204 行，104 个依赖）。
//
// 判据：这是**唯一**的键盘入口（窗口上的 `@keydown` 只挂它一个）。IDEA 对应 `Keymap` /
// `KeymapImpl.getActionForKeystroke` + `$default.xml` 的绑定表；TaoCode 没有可配置的键盘映射
// 文件，就把表写成 `if` 链，但判定的**顺序**就是 IDEA 的优先级语义，不能重排：
//   · 悬浮层（弹窗/面板）先吃键，它们开着的时候动作一律不放行；
//   · 调试/构建/运行的 F 键在导航键之前（F12 的裸键与 Shift 变体互相遮蔽过一次，注释里记着）；
//   · 「既没按 Ctrl/Meta 也没按 Alt 就 return」这条兜底栅栏之上只能放
//     没有修饰键的绑定（裸 F12 / Esc），之下才是有修饰键的绑定 —— 栅栏的位置本身是语义。
//
// 依赖之所以有 104 个，是因为它是"按键 → 动作"的总线，动作本身都在各自的域里；这里只做判定。
import { dapState, dapStep, isDesktop, runState, type RunConfig, type RunStartParams, type Workspace } from './bridge'
import { MAXIMIZE_SHORTCUT_CODE } from './toolWindowHeader'
import type { Tab } from './editorTab'

export interface KeymapContext {
  // ---- 共享状态（宿主更早的阶段就要读写，所以留在宿主） ----
  workspace: { readonly value: Workspace | null }
  active: { readonly value: Tab | undefined }
  activePath: { readonly value: string }
  lspReady: { readonly value: boolean }
  /** 上次运行的参数（宿主是 `let`，运行菜单与外观动作也要读）。 */
  lastRunParams: { readonly value: RunStartParams | null }
  runConfigs: { readonly value: RunConfig[] }
  // ---- 左栏与面板 ----
  explorer: any
  leftView: any
  // ---- 弹窗/面板的开关（本模块只读写它们的 value） ----
  actionPrompt: any
  actionSearch: any
  changePlaces: any
  configChooser: any
  configIndex: any
  conflictPrompt: any
  encodingPrompt: any
  filenamePopup: any
  gitAvailable: any
  goLinePrompt: any
  help: any
  leavePrompt: any
  menu: any
  mnemonicPrompt: any
  palette: any
  places: any
  placesEditedOnly: any
  placesFiltered: any
  placesIndex: any
  placesPrompt: any
  projectMode: any
  projectWidgetOpen: any
  quickDoc: any
  recentPrompt: any
  renamePrompt: any
  settingsDialogRef: any
  settingsOpen: any
  signaturePopup: any
  surroundPrompt: any
  symbolPrompt: any
  templateChooser: any
  zenMode: any
  // ---- 动作（各自的域提供） ----
  answerLeave: (choice: any) => void
  applyConfigChoice: (config: RunConfig) => void
  caretPayload: () => any
  closeActiveTab: () => void
  closeSignaturePopup: () => void
  copyActiveFile: () => unknown
  copyReference: () => unknown
  createScratch: () => unknown
  exitHideChrome: () => void
  extractConstant: () => void
  extractMethod: () => void
  extractVariable: () => void
  focusToolWindowByNumber: (event: KeyboardEvent) => void
  forceReloadFromDisk: () => unknown
  gitMenuAction: (method: 'git.push' | 'git.pull' | 'git.fetch' | 'git.rebase' | 'git.stash.save' | 'git.stash.pop') => unknown
  goBack: () => unknown
  goForward: () => unknown
  hideActiveToolWindow: () => void
  inlineVariable: () => void
  jumpLastEditLocation: () => void
  jumpMnemonic: (digit: number) => void
  jumpToLastToolWindow: () => void
  maximizeActiveToolWindow: () => void
  moveActiveFile: () => unknown
  moveConfig: (step: number) => void
  movePlace: (step: number) => void
  noteActivity: () => void
  openActionSearch: () => void
  /** PasteMultiple（Ctrl+Shift+V）与 EditorPasteSimple（Ctrl+Alt+Shift+V）。 */
  openPasteHistory: () => void
  pasteAsPlainText: () => void
  /** `CopyPaths`（Ctrl+Shift+C）：把当前文件的绝对路径复制到剪贴板。 */
  copyPaths: () => void
  openCodeActions: (payload: any, onlyFixes?: boolean) => unknown
  openConfigChooser: () => void
  openGeneratePopup: () => unknown
  openGoLine: () => void
  openMnemonicPrompt: () => void
  openPalette: () => void
  openPlace: (place: any) => void
  openProjectStructure: () => void
  openRecentFiles: () => void
  openRecentPlaces: () => void
  // 双击 Shift 的默认手势（Search Everywhere），与 Ctrl+Shift+A 的「查找操作」不是一回事。
  openSearchEverywhere: () => unknown
  openSettings: (id?: any) => unknown
  openSymbol: (mode: 'file' | 'global' | 'class') => void
  openWorkspace: (path?: string) => unknown
  pickMnemonic: (digit: number) => void
  rerunLast: () => unknown
  resolveConflictKeep: () => void
  restoreCurrentToolLayout: () => void
  runContextConfiguration: (debug: boolean) => unknown
  runSelectedConfig: (debug: boolean) => unknown
  runToCursor: () => unknown
  save: (tab?: Tab) => Promise<boolean>
  saveAll: () => unknown
  /** IDEA 的 `SelectIn`：Alt+F1 打开目标列表（SelectInAction.java:44-48 → :62-72）。 */
  openSelectIn: () => void
  /** IDEA 的 `ShowNavBar`：Alt+HOME 把焦点交给当前编辑器的导航条（`keymaps/$default.xml:14-15`）。 */
  showNavBar: () => void
  selectNextTab: () => void
  selectPreviousTab: () => void
  showBlame: () => unknown
  showOutput: (id: any) => void
  showQuickDoc: () => unknown
  showView: (id: any) => void
  startBuild: (rebuild: boolean) => unknown
  stopRun: () => unknown
  stretchToolWindow: (direction: any) => void
  toggleBookmark: (digit?: number) => void
  toggleBreakpointAt: (path: string, line: number) => unknown
  toggleMaximizeEditor: () => void
  updateProject: () => unknown
}

export function createKeymap(ctx: KeymapContext) {
  const { workspace, active, activePath, lspReady, lastRunParams, runConfigs, explorer, leftView, actionPrompt,
          actionSearch, changePlaces, configChooser, configIndex, conflictPrompt, encodingPrompt, filenamePopup,
          gitAvailable, goLinePrompt, help, leavePrompt, menu, mnemonicPrompt, palette, places, placesEditedOnly,
          placesFiltered, placesIndex, placesPrompt, projectMode, projectWidgetOpen, quickDoc, recentPrompt, renamePrompt,
          settingsDialogRef, settingsOpen, signaturePopup, surroundPrompt, symbolPrompt, templateChooser, zenMode,
          answerLeave, applyConfigChoice, caretPayload, closeActiveTab, closeSignaturePopup, copyActiveFile, copyReference,
          createScratch, exitHideChrome, extractConstant, extractMethod, extractVariable, focusToolWindowByNumber,
          forceReloadFromDisk, gitMenuAction, goBack, goForward, hideActiveToolWindow, inlineVariable,
          jumpLastEditLocation, jumpMnemonic, jumpToLastToolWindow, maximizeActiveToolWindow, moveActiveFile, moveConfig,
          movePlace, noteActivity, openActionSearch, openPasteHistory, pasteAsPlainText, copyPaths, openCodeActions, openConfigChooser, openGeneratePopup, openGoLine,
          openMnemonicPrompt, openPalette, openPlace, openProjectStructure, openRecentFiles, openRecentPlaces, openSearchEverywhere, openSettings,
          openSymbol, openWorkspace, pickMnemonic, rerunLast, resolveConflictKeep, restoreCurrentToolLayout,
          runContextConfiguration, runSelectedConfig, runToCursor, save, saveAll, openSelectIn, showNavBar, selectNextTab,
          selectPreviousTab, showBlame, showOutput, showQuickDoc, showView, startBuild, stopRun, stretchToolWindow,
          toggleBookmark, toggleBreakpointAt, toggleMaximizeEditor, updateProject } = ctx
  // IDEA 的 Keymap 没有"双击 Shift"这条绑定，它是 SearchEverywhere 的默认手势；宿主原先用
  // 一个模块级 `let lastShiftAt` 记上一次 Shift 的时间戳，随函数一起搬进来。
  let lastShiftAt = 0
function onKey(event: KeyboardEvent) {
  // Every keystroke counts as activity for the idle-driven background refresh.
  noteActivity()
  // Alt+1..9 focus the tool windows (IDEA ActivateToolWindowAction is unconditional);
  // modals and the palette keep the keyboard first.
  if (event.altKey && workspace.value
      && !palette.value && !settingsOpen.value && !help.value && !leavePrompt.value) {
    focusToolWindowByNumber(event)
    if (event.defaultPrevented) return
  }
  // $default.xml:867-869 — Shift+Esc is HideActiveWindow (`HideToolWindowAction.kt:21-29`).
  // Overlays keep the keyboard first, the way the rest of this handler treats them.
  if (event.key === 'Escape' && event.shiftKey && !event.ctrlKey && !event.altKey && workspace.value
      && !palette.value && !settingsOpen.value && !help.value && !leavePrompt.value) { event.preventDefault(); hideActiveToolWindow(); return }
  if (event.key === 'Escape') {
    if (settingsOpen.value) {
      // First ESC clears the settings search filter, the second one closes the dialog.
      event.preventDefault()
      if (settingsDialogRef.value?.handleEscape()) return
      settingsOpen.value = false
      return
    }
    palette.value = false; help.value = false; menu.value = null; settingsOpen.value = false; projectWidgetOpen.value = false; filenamePopup.value = false
    if (leavePrompt.value) answerLeave('cancel')
    else if (renamePrompt.value) renamePrompt.value = null
    else if (symbolPrompt.value) symbolPrompt.value = null
    else if (actionPrompt.value) actionPrompt.value = null
    else if (surroundPrompt.value) surroundPrompt.value = false
    else if (mnemonicPrompt.value) mnemonicPrompt.value = null
    else if (actionSearch.value) actionSearch.value = false
    else if (goLinePrompt.value) goLinePrompt.value = false
    else if (conflictPrompt.value) resolveConflictKeep()
    else if (encodingPrompt.value) encodingPrompt.value = null
    else if (quickDoc.value) quickDoc.value = null
    else if (recentPrompt.value) recentPrompt.value = false
    else if (placesPrompt.value) placesPrompt.value = false
    else if (configChooser.value) configChooser.value = null
    else if (signaturePopup.value) closeSignaturePopup()
    else if (templateChooser.value) templateChooser.value = false
    return
  }
  const digit = /^Digit([0-9])$/.exec(event.code)?.[1]
  if (digit !== undefined && mnemonicPrompt.value) { event.preventDefault(); pickMnemonic(Number(digit)); return }
  // RecentLocations popup owns the keyboard while open (IDEA's popup list: Up/Down
  // move, Enter jumps, Delete drops the place, Ctrl+E toggles the edited filter).
  if (placesPrompt.value) {
    if (event.key === 'ArrowDown') { event.preventDefault(); movePlace(1); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); movePlace(-1); return }
    if (event.key === 'Enter') { event.preventDefault(); const place = placesFiltered.value[placesIndex.value]; if (place) openPlace(place); return }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      const place = placesFiltered.value[placesIndex.value]
      if (place) { places.value = places.value.filter((item: any) => item !== place); changePlaces.value = changePlaces.value.filter((item: any) => item !== place) }
      return
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'e') { event.preventDefault(); placesEditedOnly.value = !placesEditedOnly.value; return }
    return
  }
  // Choose Run/Debug Configuration popup (Alt+Shift+F10 / Alt+Shift+F9).
  if (configChooser.value) {
    if (event.key === 'ArrowDown') { event.preventDefault(); moveConfig(1); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); moveConfig(-1); return }
    if (event.key === 'Enter') { event.preventDefault(); const config = runConfigs.value[configIndex.value]; if (config) applyConfigChoice(config); return }
    return
  }
  if (projectMode.value || settingsOpen.value || leavePrompt.value || renamePrompt.value || symbolPrompt.value || actionPrompt.value || actionSearch.value || surroundPrompt.value || mnemonicPrompt.value || goLinePrompt.value || encodingPrompt.value || conflictPrompt.value || quickDoc.value || recentPrompt.value || templateChooser.value) return
  // --- Debugger/build transport, from $default.xml ---
  // F9 Resume, F8 Step Over, F7 Step Into, Shift+F8 Step Out, Ctrl+F8 Toggle Line
  // Breakpoint, Shift+F9 Debug, Ctrl+F9 Build, Ctrl+Shift+F9 Rebuild.
  if (event.key === 'F9' && event.ctrlKey && !event.shiftKey) { event.preventDefault(); void startBuild(false); return }
  if (event.key === 'F9' && event.ctrlKey && event.shiftKey && workspace.value) { event.preventDefault(); void startBuild(true); return }
  if (event.key === 'F8' && event.ctrlKey && !event.altKey && !event.shiftKey && active.value && isDesktop) { event.preventDefault(); void toggleBreakpointAt(activePath.value, active.value.line); return }
  if (event.key === 'F9' && !event.shiftKey && !event.ctrlKey && !event.altKey && dapState.paused) { event.preventDefault(); void dapStep('continue'); return }
  // RunToCursor Alt+F9 / ForceRunToCursor Ctrl+Alt+F9（`$default.xml:990-995`）。DAP 没有"强制"
  // 语义（忽略断点直达），所以两条都走同一条 gotoTargets+goto，行为一致。
  if (event.key === 'F9' && event.altKey && workspace.value) { event.preventDefault(); void runToCursor(); return }
  if (event.key === 'F9' && event.shiftKey && isDesktop && workspace.value && !dapState.running) { event.preventDefault(); void runSelectedConfig(true); return }
  if (dapState.paused && !event.ctrlKey && !event.altKey) {
    if (event.key === 'F8' && !event.shiftKey) { event.preventDefault(); void dapStep('next'); return }
    if (event.key === 'F7' && !event.shiftKey) { event.preventDefault(); void dapStep('stepIn'); return }
    if (event.key === 'F8' && event.shiftKey) { event.preventDefault(); void dapStep('stepOut'); return }
  }
  if (event.key === 'F2' && event.ctrlKey && runState.running) { event.preventDefault(); void stopRun(); return }
  if (event.key === 'F5' && event.ctrlKey && !event.shiftKey && !event.altKey && lastRunParams.value && !runState.running) { event.preventDefault(); void rerunLast(); return }
  // IDEA Run menu: 附加到进程 Ctrl+Alt+F5, 查看断点 Ctrl+Shift+F8 (real 2026.2 UI).
  if (event.key === 'F5' && event.ctrlKey && event.altKey && !event.shiftKey && workspace.value) { event.preventDefault(); explorer.value = true; leftView.value = 'debug'; return }
  if (event.key === 'F8' && event.ctrlKey && event.shiftKey && workspace.value) { event.preventDefault(); explorer.value = true; leftView.value = 'debug'; return }
  // IDEA Git menu: 更新项目 = Ctrl+T (Vcs.UpdateProject).
  if (event.key.toLowerCase() === 't' && event.ctrlKey && !event.shiftKey && !event.altKey && workspace.value && gitAvailable.value) { event.preventDefault(); void updateProject(); return }
  // IDEA File menu: 项目结构 Ctrl+Alt+Shift+S, 从磁盘全部重新加载 Ctrl+Alt+Y.
  if (event.key.toLowerCase() === 's' && event.ctrlKey && event.altKey && event.shiftKey && workspace.value) { event.preventDefault(); openProjectStructure(); return }
  if (event.key.toLowerCase() === 'y' && event.ctrlKey && event.altKey && !event.shiftKey && workspace.value) { event.preventDefault(); void forceReloadFromDisk(); return }
  // IDEA Refactor menu: 重构… Ctrl+Alt+Shift+T, 移动文件 F6, 复制文件 F5.
  if (event.key.toLowerCase() === 't' && event.ctrlKey && event.altKey && event.shiftKey && active.value && lspReady.value) { event.preventDefault(); void openCodeActions(caretPayload()); return }
  if (event.key === 'F6' && !event.ctrlKey && !event.altKey && !event.shiftKey && active.value && isDesktop) { event.preventDefault(); void moveActiveFile(); return }
  if (event.key === 'F5' && !event.ctrlKey && !event.altKey && !event.shiftKey && active.value && isDesktop) { event.preventDefault(); void copyActiveFile(); return }
  // Shift+F10 Run, Alt+Shift+F10 Choose Run Configuration, Alt+Shift+F9 Choose Debug
  // Configuration, Ctrl+Shift+F10 Run Context Configuration.
  if (event.key === 'F10' && event.shiftKey && event.altKey && workspace.value) { event.preventDefault(); openConfigChooser(); return }
  if (event.key === 'F9' && event.shiftKey && event.altKey && isDesktop && workspace.value) { event.preventDefault(); openConfigChooser(); return }
  if (event.key === 'F10' && event.shiftKey && !event.altKey && isDesktop && workspace.value && !runState.running) { event.preventDefault(); void runSelectedConfig(false); return }
  if (event.key === 'F10' && event.ctrlKey && event.shiftKey && workspace.value) { event.preventDefault(); void runContextConfiguration(false); return }
  // --- Navigation, from $default.xml ---
  // ResizeToolWindowLeft/Right/Up/Down = Ctrl+Alt+Shift+arrows (`$default.xml:873-884`). They act
  // on the active tool window and are therefore checked *before* Back/Forward below, which use the
  // same chord without Shift — and those two now exclude Shift so the resize chords stay reachable
  // (the same shadowing the F12 fix had to undo).
  if (event.ctrlKey && event.altKey && event.shiftKey) {
    if (event.key === 'ArrowLeft') { event.preventDefault(); stretchToolWindow('left'); return }
    if (event.key === 'ArrowRight') { event.preventDefault(); stretchToolWindow('right'); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); stretchToolWindow('up'); return }
    if (event.key === 'ArrowDown') { event.preventDefault(); stretchToolWindow('down'); return }
  }
  // Back/Forward = Ctrl+Alt+Left/Right.
  if (event.ctrlKey && event.altKey && !event.shiftKey && event.key === 'ArrowLeft') { event.preventDefault(); void goBack(); return }
  if (event.ctrlKey && event.altKey && !event.shiftKey && event.key === 'ArrowRight') { event.preventDefault(); void goForward(); return }
  if (event.key === 'F11') {
    event.preventDefault()
    if (event.ctrlKey) openMnemonicPrompt()
    else if (event.shiftKey) showView('bookmarks')
    else toggleBookmark()
    return
  }
  if (digit !== undefined && event.ctrlKey && !event.altKey) {
    event.preventDefault()
    if (event.shiftKey) toggleBookmark(Number(digit)); else jumpMnemonic(Number(digit))
    return
  }
  // Ctrl+Shift+Backspace = Jump to Last Change (project-wide).
  if (event.key === 'Backspace' && event.ctrlKey && event.shiftKey && active.value) { event.preventDefault(); jumpLastEditLocation(); return }
  // Alt+Insert Generate, Ctrl+Alt+Shift+Insert New Scratch File.
  if (event.key === 'Insert' && event.altKey && !event.ctrlKey && !event.shiftKey && workspace.value) { event.preventDefault(); void openGeneratePopup(); return }
  if (event.key === 'Insert' && event.altKey && event.ctrlKey && event.shiftKey && workspace.value) { event.preventDefault(); void createScratch(); return }
  // Alt+F1 = `SelectIn`（`keymaps/$default.xml:968-969`），Alt+F12 = Terminal。
  // 上游这一步是**开目标列表**（SelectInAction.java:62-72 `popup.showInBestPositionFor`），
  // 再由用户按编号/方向键选一个落点 —— 本仓现在照做，不再是直达第一项。 Alt+<digit> is handled
  // up front by focusToolWindowByNumber (IDEA ActivateToolWindowAction), never here.
  if (event.key === 'F1' && event.altKey && !event.ctrlKey && !event.shiftKey && active.value) { event.preventDefault(); openSelectIn(); return }
  // Alt+HOME = `ShowNavBar`：把焦点交给当前编辑器导航条的最内层目录段。
  if (event.key === 'Home' && event.altKey && !event.ctrlKey && !event.shiftKey && active.value) { event.preventDefault(); showNavBar(); return }
  if (event.key === 'F12' && event.altKey && !event.ctrlKey && workspace.value) { event.preventDefault(); showOutput('terminal'); return }
  // $default.xml:309-311 and :717-719 — Alt+Left/Right is PreviousTab/NextTab. They are tab
  // navigation, not caret motion: `TabNavigationActionBase.java:71-78` hands them to the editor's
  // tabs or to the active tool window's tabs, and `CodeEditor.vue` shadows CodeMirror's
  // syntax-wise cursor motion on the same chord.
  if (event.altKey && !event.ctrlKey && !event.metaKey && workspace.value) {
    if (event.key === 'ArrowLeft') { event.preventDefault(); selectPreviousTab(); return }
    if (event.key === 'ArrowRight') { event.preventDefault(); selectNextTab(); return }
  }
  // $default.xml:864-866 — Shift+F12 is RestoreDefaultLayout ("Restore Current Layout",
  // `RestoreDefaultLayoutAction.java:41-47`), a different action from bare F12 below.
  if (event.key === 'F12' && event.shiftKey && !event.ctrlKey && !event.altKey && workspace.value) { event.preventDefault(); restoreCurrentToolLayout(); return }
  // $default.xml:846-848 — bare F12 is JumpToLastWindow ("Activate the last focused tool
  // window"), *not* FileStructure: that one is Ctrl+F12 (:279-281 FileStructurePopup). This
  // check has to sit above the "needs Ctrl or Alt" bail-out below, because F12 has neither.
  // Zen 模式下 Esc 退出（IDEA 的免打扰/演示模式同样以 Esc 为退出键）。
  if (event.key === 'Escape' && zenMode.value) { event.preventDefault(); exitHideChrome(); return }
  if (event.key === 'F12' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && workspace.value) { event.preventDefault(); jumpToLastToolWindow(); return }
  if (event.key === 'Backquote' && event.ctrlKey && event.shiftKey && workspace.value) { event.preventDefault(); showView('git'); return }
  if (event.key === 'Backquote' && event.altKey && workspace.value) { event.preventDefault(); showView('git'); return }
  // Ctrl+Shift+' — MaximizeToolWindow ($default.xml:885-887 `control shift QUOTE`, macOS keymap
  // :394-396 `ctrl shift QUOTE`). The physical key is what the keymap stores, so the check uses
  // `code` (Shift turns the produced character into `"` on most layouts).
  if (event.code === MAXIMIZE_SHORTCUT_CODE && event.ctrlKey && event.shiftKey && !event.altKey) { event.preventDefault(); maximizeActiveToolWindow(); return }
  // --- VCS, from VcsActions.xml (Ctrl+K Commit) and dvcs-impl (Ctrl+Shift+K Push) ---
  if (event.key.toLowerCase() === 'k' && event.ctrlKey && event.shiftKey && workspace.value && gitAvailable.value) { event.preventDefault(); void gitMenuAction('git.push'); return }
  if (event.key.toLowerCase() === 'k' && event.ctrlKey && workspace.value && gitAvailable.value) { event.preventDefault(); showView('git'); return }
  if (!(event.ctrlKey || event.metaKey) && !event.altKey) return
  // --- Files / actions / search / refactor, from $default.xml ---
  // $default.xml:260-262 — Ctrl+Shift+F4 is CloseActiveTab (`CloseActiveTabAction.java:39-58`).
  if (event.key === 'F4' && event.ctrlKey && event.shiftKey && workspace.value) { event.preventDefault(); closeActiveTab(); return }
  // $default.xml:288-290 / :637-638 —— PasteMultiple = Ctrl+Shift+V、EditorPasteSimple = Ctrl+Alt+Shift+V。
  // 浏览器把 Ctrl+Shift+V 当成「粘贴为纯文本」，不拦下来就永远开不了历史选择器。
  if (event.key.toLowerCase() === 'v' && event.ctrlKey && event.shiftKey && event.altKey) { event.preventDefault(); void pasteAsPlainText(); return }
  if (event.key.toLowerCase() === 'v' && event.ctrlKey && event.shiftKey && !event.altKey) { event.preventDefault(); openPasteHistory(); return }
  if (event.key.toLowerCase() === 'a' && event.shiftKey) { event.preventDefault(); openActionSearch(); return }
  if (event.key.toLowerCase() === 's' && event.altKey) { event.preventDefault(); void openSettings(); return }
  if (event.key.toLowerCase() === 's') { event.preventDefault(); void (workspace.value ? saveAll() : save()) }
  // Ctrl+Shift+N file, Ctrl+N class, Ctrl+Shift+Alt+N symbol.
  if (event.key.toLowerCase() === 'n' && event.shiftKey && event.altKey && workspace.value && lspReady.value) { event.preventDefault(); openSymbol('global'); return }
  if (event.key.toLowerCase() === 'n' && event.shiftKey && workspace.value) { event.preventDefault(); openPalette(); return }
  if (event.key.toLowerCase() === 'o' && event.shiftKey && !event.altKey) { event.preventDefault(); void openWorkspace(); return }
  if (event.key.toLowerCase() === 'g' && event.shiftKey && !event.altKey && active.value) { event.preventDefault(); void showBlame(); return }
  if (event.key.toLowerCase() === 'n' && workspace.value && lspReady.value) { event.preventDefault(); openSymbol('class'); return }
  // Ctrl+Shift+F12 is HideAllWindows ($default.xml:870-872) and must be tested before the
  // Ctrl+F12 branch, which used to swallow it because it did not look at Shift.
  if (event.key === 'F12' && event.ctrlKey && event.shiftKey && workspace.value) { event.preventDefault(); toggleMaximizeEditor(); return }
  // Ctrl+F12 = FileStructurePopup ($default.xml:279-281). Shift is excluded explicitly, so the
  // two branches cannot both match even if their order is ever changed.
  if (event.key === 'F12' && event.ctrlKey && !event.shiftKey && workspace.value && lspReady.value) { event.preventDefault(); openSymbol('file'); return }
  if (event.key === 'Shift' && !event.repeat) {
    const now = event.timeStamp
    if (now - lastShiftAt < 400) { lastShiftAt = 0; event.preventDefault(); openSearchEverywhere(); return }
    lastShiftAt = now
  }
  // Ctrl+Shift+F Find in Path, Ctrl+E recent files / Ctrl+Shift+E recent locations,
  // Ctrl+G Goto Line.
  if (event.key.toLowerCase() === 'f' && event.shiftKey && workspace.value) { event.preventDefault(); showView('search'); return }
  if (event.key.toLowerCase() === 'e' && workspace.value) { event.preventDefault(); if (event.shiftKey) openRecentPlaces(); else openRecentFiles(); return }
  if (event.key.toLowerCase() === 'g' && !event.shiftKey && active.value) { event.preventDefault(); openGoLine(); return }
  // Introduce/Extract/Inline, from $default.xml (Ctrl+Alt+V/C/M/N).
  if (event.altKey && event.ctrlKey && !event.shiftKey) {
    if (event.key.toLowerCase() === 'v') { event.preventDefault(); extractVariable(); return }
    if (event.key.toLowerCase() === 'c') { event.preventDefault(); extractConstant(); return }
    if (event.key.toLowerCase() === 'm') { event.preventDefault(); extractMethod(); return }
    if (event.key.toLowerCase() === 'n') { event.preventDefault(); inlineVariable(); return }
  }
  // Run Inspection (Ctrl+Shift+Alt+I), Quick Documentation (Ctrl+Q), Copy Reference.
  if (event.key.toLowerCase() === 'i' && event.ctrlKey && event.shiftKey && event.altKey && lspReady.value && active.value) { event.preventDefault(); void openCodeActions(caretPayload(), true); return }
  if (event.key.toLowerCase() === 'q' && !event.shiftKey && active.value && lspReady.value) { event.preventDefault(); void showQuickDoc(); return }
  if (event.key.toLowerCase() === 'c' && event.altKey && event.shiftKey && active.value) { event.preventDefault(); void copyReference(); return }
  // $default.xml:454-456 —— CopyPaths = Ctrl+Shift+C。它在 IDEA 的菜单里**不可见**
  // （`CopyPathsAction.java:44-48` 只在键盘 place 下 setVisible(true)），所以只有这一条键位。
  if (event.key.toLowerCase() === 'c' && event.ctrlKey && event.shiftKey && !event.altKey && active.value) { event.preventDefault(); copyPaths(); return }
}
  return { onKey }
}
