# 一次性脚本：把 App.vue 的全局快捷键分派 onKey 搬到 src/keymap.ts
# 安全规程见 skill: scripted-refactor-safety —— 锚点必须唯一，数量断言失败即中止。
import io

APP = r'D:\TaoCode\src\App.vue'
MOD = r'D:\TaoCode\src\keymap.ts'

text = io.open(APP, encoding='utf-8').read()
lines = text.split('\n')

START = 'let lastShiftAt = 0'
END = '}'          # onKey 的收尾大括号
assert text.count(START) == 1, text.count(START)

start = next(i for i, l in enumerate(lines) if l.startswith(START))
end = next(i for i in range(start + 1, len(lines)) if lines[i] == END)
assert lines[start + 1] == 'function onKey(event: KeyboardEvent) {', lines[start + 1]
block = lines[start:end + 1]
assert len(block) == 205, len(block)

body = '\n'.join(block[1:])          # 只有 onKey 本体（不含 let lastShiftAt）
assert 'lastRunParams && !runState.running' in body
body = body.replace('lastRunParams && !runState.running', 'lastRunParams.value && !runState.running')
# 其余 lastRunParams 用法只有这一处
assert body.count('lastRunParams') == 1, body.count('lastRunParams')

HEADER = '''// 全局快捷键分派 —— 从 App.vue 搬出的一域（204 行，104 个依赖）。
//
// 判据：这是**唯一**的键盘入口（窗口上的 `@keydown` 只挂它一个）。IDEA 对应 `Keymap` /
// `KeymapImpl.getActionForKeystroke` + `$default.xml` 的绑定表；TaoCode 没有可配置的键盘映射
// 文件，就把表写成 `if` 链，但判定的**顺序**就是 IDEA 的优先级语义，不能重排：
//   · 悬浮层（弹窗/面板）先吃键，它们开着的时候动作一律不放行；
//   · 调试/构建/运行的 F 键在导航键之前（F12 的裸键与 Shift 变体互相遮蔽过一次，注释里记着）；
//   · `if (!(event.ctrlKey || event.metaKey) && !event.altKey) return` 这条兜底栅栏之上只能放
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
  selectInTree: () => void
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
          movePlace, noteActivity, openActionSearch, openCodeActions, openConfigChooser, openGeneratePopup, openGoLine,
          openMnemonicPrompt, openPalette, openPlace, openProjectStructure, openRecentFiles, openRecentPlaces, openSettings,
          openSymbol, openWorkspace, pickMnemonic, rerunLast, resolveConflictKeep, restoreCurrentToolLayout,
          runContextConfiguration, runSelectedConfig, runToCursor, save, saveAll, selectInTree, selectNextTab,
          selectPreviousTab, showBlame, showOutput, showQuickDoc, showView, startBuild, stopRun, stretchToolWindow,
          toggleBookmark, toggleBreakpointAt, toggleMaximizeEditor, updateProject } = ctx
  // IDEA 的 Keymap 没有"双击 Shift"这条绑定，它是 SearchEverywhere 的默认手势；宿主原先用
  // 一个模块级 `let lastShiftAt` 记上一次 Shift 的时间戳，随函数一起搬进来。
  let lastShiftAt = 0
'''

FOOTER = '''
  return { onKey }
}
'''

io.open(MOD, 'w', encoding='utf-8', newline='\n').write(HEADER + body + FOOTER)

ASSEMBLY = '''// 全局快捷键分派是一个域（IDEA 的 Keymap/KeymapImpl + $default.xml 的绑定表）。
const { onKey } = createKeymap({
  workspace, active, activePath, lspReady, lastRunParams: { get value() { return lastRunParams } }, runConfigs,
  explorer, leftView, actionPrompt, actionSearch, changePlaces, configChooser, configIndex, conflictPrompt,
  encodingPrompt, filenamePopup, gitAvailable, goLinePrompt, help, leavePrompt, menu, mnemonicPrompt, palette, places,
  placesEditedOnly, placesFiltered, placesIndex, placesPrompt, projectMode, projectWidgetOpen, quickDoc, recentPrompt,
  renamePrompt, settingsDialogRef, settingsOpen, signaturePopup, surroundPrompt, symbolPrompt, templateChooser, zenMode,
  answerLeave, applyConfigChoice, caretPayload, closeActiveTab, closeSignaturePopup, copyActiveFile, copyReference,
  createScratch, exitHideChrome, extractConstant, extractMethod, extractVariable, gitMenuAction, goBack, goForward,
  hideActiveToolWindow, inlineVariable, jumpLastEditLocation, jumpMnemonic, jumpToLastToolWindow, maximizeActiveToolWindow,
  moveActiveFile, moveConfig, movePlace, openActionSearch, openCodeActions, openConfigChooser, openGeneratePopup,
  openGoLine, openMnemonicPrompt, openPalette, openPlace, openProjectStructure, openRecentFiles, openRecentPlaces,
  openSettings, openSymbol, openWorkspace, pickMnemonic, rerunLast, resolveConflictKeep, restoreCurrentToolLayout,
  runContextConfiguration, runSelectedConfig, runToCursor, save, saveAll, selectInTree, selectNextTab, selectPreviousTab,
  showBlame, showOutput, showQuickDoc, showView, startBuild, stopRun, stretchToolWindow, toggleBookmark,
  toggleBreakpointAt, toggleMaximizeEditor, updateProject,
  // 惰性：这三个由本块之后装配的模块提供（磁盘同步模块、外观动作模块）。
  noteActivity: () => noteActivity(),
  forceReloadFromDisk: (...a) => forceReloadFromDisk(...a),
  focusToolWindowByNumber: (...a) => focusToolWindowByNumber(...a),
})'''

new_lines = lines[:start] + ASSEMBLY.split('\n') + lines[end + 1:]
io.open(APP, 'w', encoding='utf-8', newline='\n').write('\n'.join(new_lines))
print('block:', len(block))
print('App.vue:', len(lines), '->', len(new_lines))
