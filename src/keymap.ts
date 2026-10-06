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
import { dapState, dapStep, isDesktop, runState, type RunConfig, type RunStartParams, type Workspace } from './bridge.ts'
import { MAXIMIZE_SHORTCUT_CODE } from './toolWindowHeader.ts'
import { EDITOR_ACTIONS, findKeyBinding } from './keymapBindings.ts'
import { effectiveKeyBindings } from './keymapEditor.ts'
import { ACTIONS, registerEditorActions, registerKeymapActions } from './actionRegistry.ts'
import { recordKeyEvent } from './macroHost.ts'
import { presentShortcut } from './presentationAssistant.ts'
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
  allRunConfigNames?: { readonly value: string[] }
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
  applyConfigChoice: (config: RunConfig | string) => void
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
  /** 更改签名（Ctrl+F6，`$default.xml:469-471`）—— 宿主装配在 src/refactorHostAssembly.ts。 */
  openChangeSignature: () => void
  /** 安全删除（Alt+Delete，`$default.xml:999-1001`）—— 三选一对话框在 src/safeDelete.ts + 宿主装配。 */
  openSafeDelete: () => void
  focusToolWindowByNumber: (event: KeyboardEvent) => void
  forceReloadFromDisk: () => unknown
  gitMenuAction: (method: 'git.push' | 'git.pull' | 'git.fetch' | 'git.rebase' | 'git.stash.save' | 'git.stash.pop') => unknown
  goBack: () => unknown
  goForward: () => unknown
  hideActiveToolWindow: () => void
  inlineVariable: () => void
  jumpLastEditLocation: () => void
  jumpMnemonic: (mnemonic: string) => void
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
  /**
   * 编辑器命令的执行入口 = 宿主 `src/App.vue:1405` 的 `runEditor(name)`（把命令名交给当前
   * CodeEditor 实例）。**可选**：宿主没给时 `EDITOR_ACTIONS` 那六条一条都不注册 ——
   * 注册一个跑不动的动作就是「假控件」，宁可不注册。接线请求见
   * `docs/wiring-requests-2026-10-06-keymap.md` R1。
   */
  runEditor?: (name: string) => unknown
  /**
   * 转到父方法 / 转到测试 / 相关符号（`navigate.super|test|related`，`$default.xml:251-259`）。
   * 宿主 `src/App.vue:1219` 已经从 `createLspNavigation` 拿到这三个函数（`:1499` 也喂给了导航菜单），
   * 只差没塞进 `createKeymap` —— 接线请求见 `docs/wiring-requests-2026-10-06-keymap.md` R2。
   * **可选**：没给的时候这三条不注册（见下面 `unwired`），按键原样放行，不留假动作。
   */
  gotoSuper?: () => unknown
  gotoTest?: () => unknown
  gotoRelated?: () => unknown
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
  /** 双击 Ctrl 的默认手势（Run Anything，`$default.xml:7-9` 的 `keyboard-gesture-shortcut`）。 */
  openRunAnything: () => unknown
  openSettings: (id?: any) => unknown
  openSymbol: (mode: 'file' | 'global' | 'class') => void
  openWorkspace: (path?: string) => unknown
  pickMnemonic: (mnemonic: string, description?: string) => void
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
  toggleBookmark: (mnemonic?: string) => void
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
          openMnemonicPrompt, openChangeSignature, openSafeDelete, openPalette, openPlace, openProjectStructure, openRecentFiles, openRecentPlaces, openSearchEverywhere, openSettings,
          openSymbol, openWorkspace, pickMnemonic, rerunLast, resolveConflictKeep, restoreCurrentToolLayout,
          runContextConfiguration, runSelectedConfig, runToCursor, save, saveAll, openSelectIn, showNavBar, selectNextTab,
          selectPreviousTab, showBlame, showOutput, showQuickDoc, showView, startBuild, stopRun, stretchToolWindow,
          toggleBookmark, toggleBreakpointAt, toggleMaximizeEditor, updateProject, openRunAnything, runEditor,
          gotoSuper, gotoTest, gotoRelated } = ctx
  // IDEA 的 Keymap 没有"双击 Shift"这条绑定，它是 SearchEverywhere 的默认手势；宿主原先用
  // 一个模块级 `let lastShiftAt` 记上一次 Shift 的时间戳，随函数一起搬进来。
  // RunAnything 的双击 Ctrl 走同一机制（`$default.xml:7-9` 的 gesture shortcut）。
  let lastShiftAt = 0
  let lastCtrlAt = 0
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
  // 选择器开着时**直接敲键**就贴上去（上游 `mnemonic.chooser.comment`：快速设置 —— 输入或双击助记键）：
  // 数字与字母都认，字母没有全局键（`$default.xml` 只给了 Ctrl+0..9），只在这个弹层里有意义。
  if (mnemonicPrompt.value) {
    const typed = /^[0-9A-Za-z]$/.test(event.key) ? event.key : undefined
    if (typed !== undefined) { event.preventDefault(); pickMnemonic(typed); return }
  }
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
    if (event.key === 'Enter') { event.preventDefault(); const name = (ctx.allRunConfigNames?.value ?? runConfigs.value.map(config => config.name))[configIndex.value]; if (name) applyConfigChoice(name); return }
    return
  }
  if (projectMode.value || settingsOpen.value || leavePrompt.value || renamePrompt.value || symbolPrompt.value || actionPrompt.value || actionSearch.value || surroundPrompt.value || mnemonicPrompt.value || goLinePrompt.value || encodingPrompt.value || conflictPrompt.value || quickDoc.value || recentPrompt.value || templateChooser.value) return
  // 宏录制：把这次按键按上游分类落成一步（`ActionMacroManager.kt:515-531`）。
  // 位置就是上游 `ready = IdeEventQueue.getInstance().keyEventDispatcher.isReady`（`:515`）的落点 ——
  // 上面那行就是「有弹层拦键」的判据，弹层开着时事件被弹层吃掉，不该进宏。
  // 纯字符不在这里记（编辑器的 `recordTypingStep` 拿得到真实插入文本），这里只管组合键/功能键/Enter。
  recordKeyEvent(event)
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
    if (event.shiftKey) toggleBookmark(digit); else jumpMnemonic(digit)
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
  // --- Files / actions / search / refactor：表驱动（键位与顺序在 src/keymapBindings.ts）---
  // 这一段原先是一条条 if；现在键位事实与分派优先级都在 KEY_BINDINGS 里（数组顺序 = 原 if 链顺序
  // = 上游 $default.xml 的条目顺序），这里只留「动作 id → 本仓动作」的映射与三个可用性标志。
  // 菜单/测试按 action id 查同一张表（`keymapKeys()`），不再各写一份键位文案。
  const tailActions: Record<string, () => void> = {
    'tab.close': () => closeActiveTab(),
    'edit.pastePlain': () => { void pasteAsPlainText() },
    'edit.pasteHistory': () => { openPasteHistory() },
    'actions.search': () => openActionSearch(),
    'settings.open': () => { void openSettings() },
    'file.saveAll': () => { void (workspace.value ? saveAll() : save()) },
    'symbol.global': () => openSymbol('global'),
    'file.open': () => openPalette(),
    'file.openPath': () => { void openWorkspace() },
    'vcs.blame': () => { void showBlame() },
    'symbol.class': () => openSymbol('class'),
    'window.maximizeEditor': () => toggleMaximizeEditor(),
    'symbol.file': () => openSymbol('file'),
    'search.findInPath': () => showView('search'),
    'navigate.recentLocations': () => openRecentPlaces(),
    'navigate.recentFiles': () => openRecentFiles(),
    'navigate.gotoLine': () => openGoLine(),
    // 这三把键的处理器由宿主的 `createLspNavigation` 给（`src/App.vue:1219` 已解构，见 `KeymapContext` 那三条
    // 可选字段）。没给的时候 `unwired` 会让这一格在**注册**那一步被跳过 ⇒ `ACTIONS.has` 为假 ⇒ 按键原样放行。
    'navigate.super': () => void (gotoSuper?.()),
    'navigate.test': () => void (gotoTest?.()),
    'navigate.related': () => void (gotoRelated?.()),
    'refactor.changeSignature': () => openChangeSignature(),
    'refactor.safeDelete': () => void openSafeDelete(),
    'refactor.extractVariable': () => extractVariable(),
    'refactor.extractConstant': () => extractConstant(),
    'refactor.extractMethod': () => extractMethod(),
    'refactor.inline': () => inlineVariable(),
    'inspection.runByName': () => { void openCodeActions(caretPayload(), true) },
    'docs.quickDoc': () => { void showQuickDoc() },
    'edit.copyReference': () => { void copyReference() },
    'edit.copyPath': () => copyPaths(),
  }
  // `KEY_BINDINGS` 的每一个 id 同时注册进**动作注册表**（`src/actionRegistry.ts`）：
  // id → 标题/可用性谓词/处理器（条数由 `tests/keymap-bindings.test.mjs` 的 1:1 门核，注释里不写数字）。
  // 可用性谓词读的是与 `findKeyBinding` 同一组实时状态；`ACTIONS.run` 在执行前再复核一次
  // （上游 keymap 同样不会触发 `update()` 关掉的动作）。菜单/插件入口按 id 查得到这些动作。
  //
  // `effectiveKeyBindings()` = 出厂表 + 用户自定义覆盖（上游 `KeymapManagerEx.getActiveKeymap()`：
  // 用户方案叠在出厂 `BundledKeymapBean` 之上）。分派与「演示助手」显示的快捷键都读同一份，
  // 所以改键**立刻**改变实际行为，不是只改菜单文案。
  const bindings = effectiveKeyBindings()
  // 宿主没把 `gotoSuper`/`gotoTest`/`gotoRelated` 塞进 ctx 时，这三条**不参与注册**：
  // `registerKeymapActions` 见 `handlerOf` 返回 undefined 就跳过 ⇒ `ACTIONS.has` 为假 ⇒ 命中键位也原样放行。
  // 少了这一层就会出现「键位表写着 Ctrl+Shift+T、按下去只吞键不干活」的假动作（本仓铁律）。
  const unwired = new Set([gotoSuper ? '' : 'navigate.super', gotoTest ? '' : 'navigate.test',
    gotoRelated ? '' : 'navigate.related'])
  registerKeymapActions(bindings, binding => (unwired.has(binding.id) ? undefined : tailActions[binding.id]), () => ({
    workspace: !!workspace.value, editor: !!active.value, lsp: lspReady.value,
  }))
  // 编辑器一族（排序行 / 反串行 / 删除重复行 / 克隆光标上·下 / 配对括号）：这六条的上游动作
  // `EditorSortLines`/`EditorReverseLines`/`EditorUniqueLines`/`EditorCloneCaretAbove|Below`/`EditorMatchBrace`
  // 要么在 `$default.xml` 里**没有默认键位**（前三与克隆那对），要么那把键是在编辑器的 CodeMirror keymap
  // 里按到的（`EditorMatchBrace` = Ctrl+Shift+M，`$default.xml:1146-1148`）⇒ 都不进 `KEY_BINDINGS`
  // （进了就是一条永远按不到的绑定 + 一个空转处理器），只进注册表，id 与菜单行、`editingCommands` 同名。
  // 宿主没传 `runEditor` 时整条注册都跳过：拿不到执行入口就不注册，而不是注册一个点了没反应的假动作。
  if (runEditor) registerEditorActions(EDITOR_ACTIONS, name => runEditor(name), () => !!active.value)
  const binding = findKeyBinding(event, { workspace: !!workspace.value, editor: !!active.value, lsp: lspReady.value }, bindings)
  if (binding && ACTIONS.has(binding.id)) {
    event.preventDefault()
    // 演示助手（上游 `ShortcutPresenter.showActionInfo`）：开关关闭时 presentShortcut 直接返回。
    presentShortcut(binding)
    ACTIONS.run(binding.id)
    return
  }
  // 双击 Shift = SearchEverywhere、双击 Ctrl = RunAnything（`$default.xml:7-11` 的
  // keyboard-gesture-shortcut；手势不是键位对，所以不进键位表）。
  if (event.key === 'Shift' && !event.repeat) {
    const now = event.timeStamp
    if (now - lastShiftAt < 400) { lastShiftAt = 0; event.preventDefault(); openSearchEverywhere(); return }
    lastShiftAt = now
  }
  if (event.key === 'Control' && !event.repeat) {
    const now = event.timeStamp
    if (now - lastCtrlAt < 400) { lastCtrlAt = 0; event.preventDefault(); openRunAnything(); return }
    lastCtrlAt = now
  }
}
  return { onKey }
}
