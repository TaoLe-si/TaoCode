<script setup lang="ts">
// 终端面板：ConPTY 窗格 + 标签 + 工具条 + 窗格右键菜单。
//
// 2026-10-06（桶 10b）把原先零消费方的四个纯模块接成真实链路，用户可见的那一面是：
//   · `src/terminalTitle.ts` —— 标签文字 = `buildSettingsAwareTitle`（重命名 > shell 标题 > 「本地」> Unnamed），
//     tooltip = `buildSettingsAwareFullTitle`（不截断、不拼 tag）；采纳哪条由上游那两格设置决定
//     （`TerminalTitleUtils.kt:37-59`）；shell 的 OSC 0/2 由 xterm 的 `onTitleChange` 上报，就是上游的
//     `TerminalApplicationTitleListener`（`platform/execution-impl/src/com/intellij/terminal/TerminalTitle.kt:125-137`）；
//     新建会话的默认名走 `nextTerminalTabName` 那条去重的行模型（`TerminalTitleUtils.kt:61-88`）。
//   · `src/terminalClipboard.ts` —— 窗格右键菜单 `Terminal.OutputContextMenu`
//     （`plugins/terminal/frontend/resources/intellij.terminal.frontend.xml:225-230`）的复制/粘贴/从历史粘贴，
//     以及 `attachCustomKeyEventHandler` 上那四组键（Ctrl+C/Ctrl+Insert 复制、Ctrl+V/Shift+Insert 粘贴）；
//     没有选区时 Ctrl+C 交回 PTY（`TerminalCtrlCActionsPromoter.kt:8-18`）。
//   · `src/terminalFontSize.ts` —— Ctrl+滚轮缩放（`JBTerminalPanel.java:381-390`：越界这次滚动什么都不做，
//     且不再滚缓冲区）与工具条的放大/缩小/复位；缩放是会话内临时的，不写设置。
//   · `src/terminalSplits.ts` —— 右侧/下侧分屏、取消分屏、窗格间跳转，窗格数不再有本仓自己加的上限
//     （`TerminalToolWindowManager.java:431-434` 的 `canSplit` 只问动作可用性）。
// 2026-10-06 第二轮（同一桶，接 `ex/terminal` 剩下的可见项）：
//   · `src/terminalHyperlinks.ts` —— 行内 URL 与 OSC 8 超链接（上游 `JBTerminalWidget.java:87-90` 装的
//     `JediTermHyperlinkFilterAdapter` + `Osc8UrlHyperlinkFilter`，判定规则在 `UrlFilter.java:44-150`
//     与 `URLUtil.java:50-62`）。Ctrl/⌘+单击交给宿主的 `shell.openUrl`；只有面板真能做事的命中才画成链接。
//   · `src/terminalClipboard.ts` 的两条鼠标行为 —— 中键粘贴（`JBTerminalSystemSettingsProviderBase.java:302-304`）
//     与「Linux 上选中即复制」（同文件 `:297-299`，上游就只给 Linux）。
// 布局：窗格按 `terminalGridSize()` 排成 CSS 网格（上游是 splitter 树，架构不等价 ⇒ 取同一件可见的事）。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Columns2, Pencil, Plus, RotateCcw, RotateCw, Rows2, Search, Shrink, SquareTerminal, X, ZoomIn, ZoomOut } from 'lucide-vue-next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { BridgeError, isDesktop, request, subscribeTerm, subscribeTermExit, term } from '../bridge'
import { iconSize } from '../uiIcons'
import { copyToClipboard, readClipboardHistory, readClipboardText } from '../clipboard'
import { resolveTerminalThemeName, terminalPalette, terminalXtermTheme } from '../terminalColors'
import { createTerminalActions, terminalAction, terminalActionKeyFor, terminalActionTitle, type TerminalActionContext, type TerminalActionId } from '../terminalActions'
import { canTerminalSplit, nextTerminalPaneCell, paneIndexAfterSplit, terminalGridSize, type TerminalPaneCell, type TerminalSplitOrientation } from '../terminalSplits'
import { changeTerminalFontSize, FONT_SIZE_STEP_DOWN, FONT_SIZE_STEP_UP, resetTerminalFontSize, TERMINAL_BASE_FONT_SIZE, terminalFontSizeForWheel, terminalFontSizeTitle, terminalWheelZoomApplies } from '../terminalFontSize'
import { terminalClipboardActions, terminalClipboardKeyFor, terminalCopyOnCtrlC, terminalCopyOnSelect, terminalHistoryEntries, terminalIsMiddleButton, terminalPasteOnMiddleClick, type TerminalClipboardContext, type TerminalHistoryEntry } from '../terminalClipboard'
import { terminalHyperlinkRanges, terminalLinkActivatable, terminalLinkTarget, terminalLinkTooltip, terminalOsc8Target } from '../terminalHyperlinks'
import { buildSettingsAwareFullTitle, buildSettingsAwareTitle, nextTerminalTabName, renameTerminal, setApplicationTitle, TERMINAL_SHOW_APP_TITLE_DEFAULT, TERMINAL_TAB_BASE_NAME, terminalRenameInitialValue, titleChanged, type TerminalTitleSettings, type TerminalTitleState } from '../terminalTitle'
import AnchoredMenu from './AnchoredMenu.vue'

const props = defineProps<{ active: boolean; cwd?: string; confirmClose?: (label: string) => Promise<boolean> }>()
const emit = defineEmits<{ focusTerminal: [] }>()

interface Pane {
  id: number
  /** 标签标题的四份数据（上游 `TerminalTitle.State`）；可见文字由 `buildTerminalTitle` 算。 */
  title: TerminalTitleState
  view: HTMLDivElement
  instance: Terminal
  fit: FitAddon
  search: SearchAddon
  off: () => void
  offExit: () => void
  group: number
  exited: boolean
  exitCode: number | null
  /** 会话内临时字号（上游 `TerminalFontSizeProvider` 的 temporary zoom，不写设置）。 */
  fontSize: number
}

const stage = ref<HTMLDivElement>()
const panes = shallowRef<Pane[]>([])
const selected = shallowRef<Pane | null>(null)
const busy = ref(false)
const note = ref('')
const renaming = shallowRef<Pane | null>(null)
const renameText = ref('')
const renameInput = ref<HTMLInputElement>()
const searchOpen = ref(false)
const searchText = ref('')
const searchInput = ref<HTMLInputElement>()
const searchMiss = ref(false)
// 复制/粘贴与分屏的当下状态（右键菜单与工具条都问这里，不再各写一遍表达式）。
const hasSelection = ref(false)
const historyEntries = ref<TerminalHistoryEntry[]>([])
const menuOpen = ref(false)
const menuPoint = ref<{ x: number; y: number }>({ x: 0, y: 0 })
/** 每个标签（group）实际的两个方向的分屏次数 ⇒ 网格的列数/行数（`terminalGridSize`）。 */
const splitCounts = new Map<number, { rights: number; downs: number }>()
/**
 * 上游那台总闸是 `EditorSettingsExternalizable.isWheelFontChangeEnabled()`
 * （`platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:1043`，
 * Settings › Editor › General › 「Change font size with Ctrl+Mouse Wheel」）。
 * 本仓设置页没有这一格（`src/settingsModel.ts` 是保留文件）⇒ 先按上游的「开着」处理，
 * 设置项本身已写进接线请求（docs/wiring-requests-2026-10-06-bucket10b.md）。
 */
const WHEEL_FONT_ZOOM_ENABLED = true

/**
 * 上游 `SystemInfo.isLinux` 的本仓等价判断（`JBTerminalSystemSettingsProviderBase.java:297-299` 的
 * `copyOnSelect()` 认的就是这一个平台）。判平台沿用仓库既有写法（`src/presentationAssistant.ts:67-71`：
 * `navigator.platform` + `userAgent` 一起看，Node 下没有 navigator ⇒ 按非 Linux）。
 */
const ON_LINUX = typeof navigator !== 'undefined' && /linux/i.test(`${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`)

/**
 * 工具栏每个按钮的启用/可见都问这张表，不再各写一遍 `:disabled` 表达式
 * （上游 `TerminalBaseContextAction.update` 的 `setEnabledAndVisible(terminal != null)`，
 * `TerminalActionUtil.createTerminalAction` 的登记规则）。
 */
function actionContext(): TerminalActionContext {
  const current = selected.value
  return {
    hasTerminal: Boolean(current),
    running: Boolean(current) && !current!.exited,
    desktop: isDesktop,
    busy: busy.value,
    groupSize: current ? groupPanes(current).length : 0,
    searchOpen: searchOpen.value,
    searchHasText: searchText.value.trim().length > 0,
    paneCount: panes.value.length,
    exited: Boolean(current?.exited),
    // 标签在整排里的位置（`getIndexOfContent` / `contentCount`，MoveTerminalToolwindowTabLeftRightAction.kt:28-32）。
    tabIndex: current ? panes.value.indexOf(current) : -1,
    tabCount: panes.value.length,
    hasSelection: hasSelection.value,
    historyCount: historyEntries.value.length,
    fontSize: current?.fontSize ?? TERMINAL_BASE_FONT_SIZE,
    baseFontSize: TERMINAL_BASE_FONT_SIZE,
  }
}
const registry = computed(() => createTerminalActions(actionContext()))
const action = (id: TerminalActionId) => terminalAction(registry.value, id)
const can = (id: TerminalActionId) => Boolean(action(id)?.enabled)
const shownAs = (id: TerminalActionId) => Boolean(action(id)?.visible)
const why = (id: TerminalActionId, fallback: string) => terminalActionTitle(action(id), fallback)
let observer: ResizeObserver | undefined
let themeObserver: MutationObserver | undefined
let groups = 0
let disposed = false

// 标签可见文字/tooltip 都走 `src/terminalTitle.ts`（重命名压过 shell 标题，shell 标题压过默认标题），
// 采纳不采纳 shell 标题由 `TerminalTitleUtils.kt:54-59` 那扇门决定（下面 TITLE_SETTINGS）。
const paneLabel = (pane: Pane) => buildSettingsAwareTitle(pane.title, TITLE_SETTINGS, isCommandRunning(pane))
const paneTooltip = (pane: Pane) => buildSettingsAwareFullTitle(pane.title, TITLE_SETTINGS, isCommandRunning(pane))
/**
 * `TerminalTitle.isCommandRunning` 这一档上游来自 OSC 133（shell 集成上报「命令在跑」），
 * 本仓宿主是裸 ConPTY：`native/terminal.hpp:56-60` 只有 write/resize/kill/running/ids，
 * 没有任何命令边界的信号 ⇒ 这里如实回答「不知道」，把「进程还活着」当成信号用是编造。
 * 缺的那一路写进 docs/wiring-requests-2026-10-06-term3.md（N1）。
 */
function isCommandRunning(_pane: Pane): boolean { return false }
/**
 * 上游的两档设置在 `TerminalOptionsProvider.kt:68`（showApplicationTitle=true）与 `:71`
 * （applicationTitleShowingMode=WHEN_COMMAND_RUNNING）。默认档要看上面那个信号，而信号在本仓宿主里
 * 不存在 ⇒ 按默认档会把 shell 标题这条链路整体藏掉。这里取上游的另一档
 * `TerminalApplicationTitleShowingMode.kt:9` 的 ALWAYS，让既有链路照常可见，并把设置项写成接线请求（R1）。
 */
const TITLE_SETTINGS: TerminalTitleSettings = { showApplicationTitle: TERMINAL_SHOW_APP_TITLE_DEFAULT, applicationTitleShowingMode: 'always' }
const paneCell = (pane: Pane): TerminalPaneCell => ({ id: pane.id, origin: pane.group })
const groupPanes = (pane: Pane) => panes.value.filter(other => other.group === pane.group)
function countsOf(group: number) { return splitCounts.get(group) ?? { rights: 0, downs: 0 } }

/** 写标题状态：内容没变就不重绘（上游 `TerminalTitle.kt:26-41` 的 `change {}` 同一条）。 */
function setPaneTitle(pane: Pane, next: TerminalTitleState) {
  if (!titleChanged(pane.title, next)) return
  pane.title = next
  panes.value = [...panes.value]
}

function visible(pane: Pane) {
  const current = selected.value
  return Boolean(current) && pane.group === current!.group
}

function refit() {
  for (const pane of panes.value) {
    if (!visible(pane) || !pane.view.offsetParent) continue
    pane.fit.fit()
    void term.resize(pane.id, pane.instance.cols, pane.instance.rows).catch(() => undefined)
  }
}

/**
 * 布局 = `terminalGridSize(rights, downs)` 的网格：右侧分屏加一列、下侧分屏加一行。
 * 上游那棵 splitter 树会把新格子嵌在被分的那一格位置上（`InternalDecoratorImpl.kt:376-410`）；
 * 本仓压成网格后，最后一行的空格由最末那个窗格横跨补上（不留空洞）。
 */
function layout() {
  const shown = panes.value.filter(visible)
  const counts = selected.value ? countsOf(selected.value.group) : { rights: 0, downs: 0 }
  const grid = terminalGridSize(counts.rights, counts.downs)
  if (stage.value) {
    stage.value.style.gridTemplateColumns = `repeat(${grid.columns}, 1fr)`
    stage.value.style.gridTemplateRows = `repeat(${grid.rows}, 1fr)`
  }
  for (const pane of panes.value) {
    const slot = shown.indexOf(pane)
    pane.view.hidden = slot < 0
    if (slot < 0) continue
    const column = slot % grid.columns
    const row = Math.floor(slot / grid.columns)
    const isLast = slot === shown.length - 1
    pane.view.style.gridColumn = `${column + 1} / span ${isLast ? grid.columns - column : 1}`
    pane.view.style.gridRow = `${row + 1}`
    pane.view.classList.toggle('terminal-split', shown.length > 1)
    pane.view.classList.toggle('terminal-edge-right', shown.length > 1 && column < grid.columns - 1 && !isLast)
    pane.view.classList.toggle('terminal-edge-bottom', shown.length > 1 && row < grid.rows - 1)
  }
  refit()
}

async function spawn(group?: number, cwdOverride?: string): Promise<Pane | null> {
  if (!isDesktop) { note.value = '浏览器预览不能开本地终端，请运行桌面端。'; return null }
  if (busy.value) return null
  busy.value = true
  note.value = ''
  // IDE-03's "Open Terminal Here": cwd falls back to the prop, then the bridge
  // default (workspace root). Pass nothing when neither applies so the native
  // session spawns at its own default.
  const requested = cwdOverride ?? props.cwd
  let id = 0
  let pane: Pane | undefined
  try {
    id = (await term.create(80, 24, requested)).id
    if (disposed) { await term.kill(id); return null }
    // 新建会话的标签名 = 上游那条去重的行模型（TerminalTitleUtils.kt:61-88 + UniqueNameGenerator.java:102-124）：
    // 基础名取设置里的 tabName（上游默认 `Local`，TerminalBundle.properties:96 ⇒ 直译「本地」），
    // 已被占用就从 2 起拼「本地 (2)」。原先这里写的是自造的「终端 N」流水号。
    pane = attachPane(id, nextTerminalTabName(TERMINAL_TAB_BASE_NAME, panes.value.map(paneLabel)), group)
    return pane
  } catch (error) {
    if (pane) { pane.off(); pane.offExit(); pane.view.remove(); pane.instance.dispose(); panes.value = panes.value.filter(other => other !== pane) }
    if (selected.value === pane) selected.value = panes.value[0] ?? null
    if (id) void term.kill(id).catch(() => undefined)
    note.value = error instanceof BridgeError ? `${error.code}: ${error.message}` : '终端启动失败。'
    return null
  } finally {
    busy.value = false
  }
}

/**
 * 分屏：新格子排在被分窗格的右侧（同列序）或下侧（下一行首列）。
 * 上游 `TerminalSplitAction.kt:12-35` 一个类管两个方向，`canSplit` 只问动作可用性
 * （`TerminalToolWindowManager.java:431-434`）⇒ 本仓也没有窗格数上限，只有宿主前提。
 */
async function split(orientation: TerminalSplitOrientation) {
  const current = selected.value
  if (!current) { await spawn(); return }
  const group = groupPanes(current)
  const verdict = canTerminalSplit(orientation, { desktop: isDesktop, busy: busy.value, count: group.length })
  if (!verdict.enabled) { note.value = verdict.reason; return }
  const counts = countsOf(current.group)
  const after = orientation === 'right'
    ? { rights: counts.rights + 1, downs: counts.downs }
    : { rights: counts.rights, downs: counts.downs + 1 }
  const grid = terminalGridSize(after.rights, after.downs)
  const target = paneIndexAfterSplit(group.map(paneCell), group.indexOf(current), orientation, grid.columns)
  const created = await spawn(current.group)
  if (!created) return
  splitCounts.set(current.group, after)
  movePaneInGroup(created, target)
  layout()
}

/** 把新建的窗格挪到组内该占的槽位（上游 `splitWithContent` 的落点：被分格子的右侧/下侧）。 */
function movePaneInGroup(pane: Pane, target: number) {
  const rest = panes.value.filter(other => other !== pane)
  const slots: number[] = []
  rest.forEach((other, index) => { if (other.group === pane.group) slots.push(index) })
  const at = Math.max(0, Math.min(slots.length, target))
  const insertAt = at < slots.length ? slots[at] : (slots.length ? slots[slots.length - 1] + 1 : rest.length)
  rest.splice(insertAt, 0, pane)
  panes.value = rest
}

function select(pane: Pane) {
  selected.value = pane
  hasSelection.value = pane.instance.hasSelection()
  layout()
  pane.instance.focus()
}

// Exposed so the menu's "Open Terminal Here" can spawn a panel in a chosen
// directory. The caller (App.vue) handles switching to the terminal tab first;
// the function spawns the panel and the panel stays subscribed to its output.
async function openIn(dir: string) {
  emit('focusTerminal')
  await spawn(undefined, dir)
}
// A terminal created by someone else (the debug adapter's runInTerminal) must become
// visible in this panel: adopt() attaches a pane to an id that already exists, so the
// session the debugger opened is the same one the user sees.
// 终端配色（上游 `JBTerminalSchemeColorPalette`）：默认前景/背景与 ANSI 16 色都从当前配色方案取。
// 本仓的「配色方案」是 tokens.css 的月相变量（`--text`/`--editor`）+ `src/terminalColors.ts` 的两套 ANSI 表；
// `data-theme` 一切换终端跟着换面 —— 对应上游 palette 随 `EditorColorsScheme` 取值的链路。
function currentPalette() {
  if (typeof document === 'undefined') return terminalPalette('light')
  const root = getComputedStyle(document.documentElement)
  const theme = resolveTerminalThemeName(document.documentElement.dataset.theme)
  return terminalPalette(theme, root.getPropertyValue('--text').trim(), root.getPropertyValue('--editor').trim())
}
function applyPalette() {
  const theme = terminalXtermTheme(currentPalette())
  for (const pane of panes.value) pane.instance.options.theme = theme
}
function setFontSize(pane: Pane, size: number) {
  if (size === pane.fontSize) return
  pane.fontSize = size
  pane.instance.options.fontSize = size
  panes.value = [...panes.value]
  refit()
}
/** 工具条上那格字号读数（临时缩放时 title 会说「临时缩放」，上游 `TerminalFontSizeProvider` 的语义）。 */
const fontSizeShown = computed(() => selected.value?.fontSize ?? TERMINAL_BASE_FONT_SIZE)
function stepFontSize(id: TerminalActionId) {
  const pane = selected.value
  if (!pane) return
  const step = id === 'terminal.font.increase' ? FONT_SIZE_STEP_UP : FONT_SIZE_STEP_DOWN
  setFontSize(pane, changeTerminalFontSize(pane.fontSize, step))
}
function resetFontSize() {
  const pane = selected.value
  if (!pane) return
  setFontSize(pane, resetTerminalFontSize(TERMINAL_BASE_FONT_SIZE))
}

/**
 * Ctrl+滚轮 = 缩放，且这次滚动**不再滚缓冲区**（`JBTerminalPanel.java:381-390` 那条分支直接 return）；
 * 新字号越界就保持原值（`:384-386`）。总闸关着时什么都不拦，照常滚缓冲区。
 */
function onWheel(pane: Pane, event: WheelEvent) {
  if (!terminalWheelZoomApplies(event, WHEEL_FONT_ZOOM_ENABLED)) return
  event.preventDefault()
  const next = terminalFontSizeForWheel(pane.fontSize, event.deltaY)
  if (next === pane.fontSize) return
  setFontSize(pane, next)
}

// 复制/粘贴：右键菜单与那四组键共用这套实现。
async function copySelection() {
  const pane = selected.value
  if (!pane || !pane.instance.hasSelection()) return
  await copyToClipboard(pane.instance.getSelection())
  hasSelection.value = pane.instance.hasSelection()
}
async function pasteFromClipboard() {
  const pane = selected.value
  if (!pane || pane.exited) return
  const text = await readClipboardText()
  if (text) pane.instance.paste(text)
}
async function pasteHistoryEntry(entry: TerminalHistoryEntry) {
  const pane = selected.value
  if (!pane || pane.exited) return
  pane.instance.paste(entry.text)
  closeMenu()
}
/**
 * 中键粘贴（`JBTerminalSystemSettingsProviderBase.java:302-304`：上游这条**无条件** return true）。
 * 在捕获阶段把事件吃掉 —— 否则 xterm 自己那条中键粘贴会再补一次，用户看到的是双份内容。
 */
function onMiddleClick(pane: Pane, event: MouseEvent) {
  if (!terminalIsMiddleButton(event) || !terminalPasteOnMiddleClick()) return
  if (pane.exited) return
  event.preventDefault()
  event.stopPropagation()
  void pasteFromClipboard()
}
/**
 * 终端链接的落点动作：交给宿主的系统默认处理器（上游 `OpenUrlHyperlinkInfo.java:69-72` 的
 * `navigate` = `BrowserLauncher.browse(url, ...)`；本仓那一端是 `shell.openUrl`）。
 * 「逐个浏览器打开」与「复制链接」那两条右键菜单项**没搬**，理由写在 `src/terminalHyperlinks.ts` 文件头第 2 条。
 */
async function openTerminalUrl(url: string) {
  if (!isDesktop) { note.value = '浏览器预览不能调用系统默认程序打开链接。'; return }
  try { await request('shell.openUrl', { url }) }
  catch (error) { note.value = error instanceof BridgeError ? `${error.code}: ${error.message}` : `打不开 ${url}。` }
}
/**
 * 一行里的 URL 命中 → xterm 的 link provider（上游 `JBTerminalWidget.java:87-90` 装 hyperlink 过滤器那一对）。
 * 只有面板真能做事的那些命中才画成链接（`terminalLinkActivatable`），点不动的链接不如不画。
 */
function attachLinkProvider(instance: Terminal) {
  instance.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const row = instance.buffer.active.getLine(bufferLineNumber - 1)
      if (!row) { callback(undefined); return }
      const text = row.translateToString(true)
      const links = terminalHyperlinkRanges(text).flatMap(range => {
        const target = terminalLinkTarget(range.text)
        const verdict = terminalLinkActivatable(target, isDesktop)
        if (!verdict.ok || target.kind !== 'browser') return []
        return [{
          range: { start: { x: range.start + 1, y: bufferLineNumber }, end: { x: range.end, y: bufferLineNumber } },
          text: range.text,
          decorations: { pointerCursor: true, underline: true },
          activate: () => { void openTerminalUrl(target.url) },
          hover: () => { if (instance.element) instance.element.title = terminalLinkTooltip(target, true) },
          leave: () => { if (instance.element) instance.element.title = '' },
        }]
      })
      callback(links.length ? links : undefined)
    },
  })
}
/**
 * OSC 8（终端程序自己写的 `\x1b]8;;URI` 链接）：上游也要再过一遍 `UrlFilter`
 * （`Osc8UrlHyperlinkFilter.kt:10-17`），本仓同样只放行它算出来的 `browser` 目标。
 * xterm 没装 handler 时会用浏览器的 `confirm` + `window.open`（typings 的 `linkHandler` 注释自己写了这条默认），
 * 桌面宿主里那是错的路，所以这里**总是**装自己的。
 */
function osc8LinkHandler() {
  return {
    allowNonHttpProtocols: true,
    activate: (_event: MouseEvent, uri: string) => {
      const target = terminalOsc8Target(uri)
      if (!terminalLinkActivatable(target, isDesktop).ok || target.kind !== 'browser') return
      void openTerminalUrl(target.url)
    },
  }
}
async function refreshHistory() {
  try { historyEntries.value = terminalHistoryEntries(await readClipboardHistory()) }
  catch { historyEntries.value = [] }
}
function clipboardContext(): TerminalClipboardContext {
  const current = selected.value
  return {
    hasTerminal: Boolean(current),
    hasSelection: hasSelection.value,
    running: Boolean(current) && !current!.exited,
    historyCount: historyEntries.value.length,
  }
}
const clipboardActions = computed(() => terminalClipboardActions(clipboardContext()))
function runClipboard(id: string) {
  if (id === 'terminal.copy') void copySelection()
  else if (id === 'terminal.paste') void pasteFromClipboard()
  void closeMenu()
}
function gotoPane(forward: boolean) {
  const current = selected.value
  if (!current) return
  const next = nextTerminalPaneCell(groupPanes(current), current, forward)
  if (next) select(next)
  void closeMenu()
}
/**
 * 标签左右移动（`Terminal.MoveToolWindowTabLeft`/`Right`，plugin.xml:125-126）。
 * 上游那一步 `MoveTerminalToolwindowTabLeftRightAction.kt:34-46` 是把**邻位**那条 content 摘下来
 * 再插到本条的位置（`removeContent(other, false, false, false)` + `addContent(other, ind)`），
 * 净效果就是本条与邻位互换 ⇒ 本仓同样只在数组里交换这两个窗格，其它窗格的相对次序不动。
 */
function moveTab(pane: Pane, forward: boolean) {
  const index = panes.value.indexOf(pane)
  const other = forward ? index + 1 : index - 1
  if (index < 0 || other < 0 || other >= panes.value.length) return
  const next = [...panes.value]
  next[index] = next[other]
  next[other] = pane
  panes.value = next
  layout()
}
/** Terminal.SelectAll（`plugin.xml:137-141` 的 `setSelection(0, textLength)` 等价物）。 */
function selectAll() {
  const pane = selected.value
  closeMenu()
  if (pane) pane.instance.selectAll()
}
/**
 * Terminal.ClearBuffer（`intellij.terminal.frontend.xml:132-135`）：清掉这个窗格的视口与回滚缓冲。
 * 上游那条「命令在跑就不给清」的判定依赖 OSC 133，本仓裸 ConPTY 没有这个信号（见 terminalActions 的 hint）。
 */
function clearBuffer() {
  const pane = selected.value
  closeMenu()
  if (!pane) return
  pane.instance.clear()
  note.value = `已清空「${paneLabel(pane)}」的终端缓冲区。`
}
/** 取消分屏（`TW.Unsplit`）：关掉当前这格，回到同组剩下的那一格。 */
function unsplit() {
  const current = selected.value
  void closeMenu()
  if (current) void close(current)
}
function openMenu(pane: Pane, event: MouseEvent) {
  // 右键哪一格就作用到哪一格（上游的 OutputContextMenu 也总是当前那个终端编辑器）。
  if (selected.value !== pane) select(pane)
  event.preventDefault()
  menuPoint.value = { x: event.clientX, y: event.clientY }
  menuOpen.value = true
  void refreshHistory()
}
function closeMenu() { menuOpen.value = false }

/** attachPane 里挂 xterm 的四个回调：选区、shell 标题（OSC 0/2）、按键、滚轮。 */
function attachHandlers(pane: Pane, instance: Terminal) {
  instance.onSelectionChange(() => {
    if (selected.value === pane) hasSelection.value = instance.hasSelection()
    // 选中即复制（`JBTerminalSystemSettingsProviderBase.java:297-299` 的 `copyOnSelect()` = `SystemInfo.isLinux`）：
    // 上游只在 Linux 做，Windows/macOS 不做 —— 这里照同一个门，不把「选中就进剪贴板」当成通用行为。
    if (ON_LINUX && terminalCopyOnSelect(true) && instance.hasSelection()) void copyToClipboard(instance.getSelection())
  })
  instance.onTitleChange(raw => setPaneTitle(pane, setApplicationTitle(pane.title, raw)))
  instance.attachCustomKeyEventHandler(event => {
    // 终端自己的两条快捷键：Ctrl+F 开查找（Terminal.Find ← Find = control F，$default.xml:565-566）、
    // Ctrl+Shift+T 新建标签（Terminal.NewTab，intellij.terminal.frontend.xml:242-243）。
    // 这里只吃掉面板真能做的这两条，其它键照常交给 shell（包括无选区的 Ctrl+C，见 terminalClipboard.ts）。
    const actionKey = terminalActionKeyFor(event)
    if (actionKey === 'search') {
      if (event.type === 'keydown') toggleSearch()
      return false
    }
    if (actionKey === 'newTab') {
      if (event.type === 'keydown') void spawn()
      return false
    }
    const intent = terminalClipboardKeyFor(event)
    if (intent === null) return true
    if (intent === 'copy') {
      // 没选区的 Ctrl+C 交回 PTY，让 shell 收到 ^C 自己中断（TerminalCtrlCActionsPromoter.kt:8-18）。
      if (!terminalCopyOnCtrlC(instance.hasSelection())) return true
      if (event.type === 'keydown') void copySelection()
      return false
    }
    if (pane.exited) return true
    if (event.type === 'keydown') void pasteFromClipboard()
    return false
  })
  pane.view.addEventListener('wheel', (event) => onWheel(pane, event as WheelEvent), { passive: false })
  // 中键粘贴要抢在 xterm 自己之前（第三个参数 true = 捕获阶段），否则一次点击会粘两遍。
  pane.view.addEventListener('mousedown', (event) => onMiddleClick(pane, event as MouseEvent), true)
}

function attachPane(id: number, defaultTitle: string, group?: number): Pane {
  const view = document.createElement('div')
  view.className = 'terminal-view'
  view.hidden = true
  stage.value!.appendChild(view)
  const instance = new Terminal({ cursorBlink: true, fontFamily: "'Cascadia Code', Consolas, monospace", fontSize: TERMINAL_BASE_FONT_SIZE, scrollback: 5000, theme: terminalXtermTheme(currentPalette()), linkHandler: osc8LinkHandler() })
  const fit = new FitAddon()
  const search = new SearchAddon()
  instance.loadAddon(fit)
  instance.loadAddon(search)
  instance.open(view)
  // 行内 URL 的链接判定（上游 `JBTerminalWidget.java:87-90` 装的两层 hyperlink 过滤器里的普通链接那层）。
  attachLinkProvider(instance)
  const created: Pane = {
    id, title: { defaultTitle }, view, instance, fit, search,
    off: () => undefined, offExit: () => undefined, group: group ?? ++groups, exited: false, exitCode: null,
    fontSize: TERMINAL_BASE_FONT_SIZE,
  }
  view.addEventListener('focusin', () => { selected.value = created; hasSelection.value = created.instance.hasSelection() })
  view.addEventListener('contextmenu', event => openMenu(created, event as MouseEvent))
  instance.onData(data => { if (!created.exited) term.write(id, data) })
  instance.onResize(({ cols, rows }) => void term.resize(id, cols, rows).catch(() => undefined))
  created.off = subscribeTerm(id, bytes => created.instance.write(bytes))
  // A shell that exits on its own used to hold its slot forever; the panel now marks
  // the pane, keeps it for restart, and says why it stopped.
  created.offExit = subscribeTermExit(id, code => {
    created.exited = true
    created.exitCode = code
    panes.value = [...panes.value]
    created.instance.writeln(`\r\n[进程已退出，代码 ${code}。按 ↻ 重启该终端。]`)
  })
  attachHandlers(created, instance)
  panes.value = [...panes.value, created]
  select(created)
  layout()
  return created
}
// `term.opened` carries the id the host already spawned.
function adopt(id: number, label?: string) {
  if (!isDesktop || !stage.value) return
  if (panes.value.some(pane => pane.id === id)) { select(panes.value.find(pane => pane.id === id)!); return }
  // 宿主已经起好的会话（调试器的 runInTerminal）没有标题时，同样走上游那条去重的默认名。
  attachPane(id, label?.trim() || nextTerminalTabName(TERMINAL_TAB_BASE_NAME, panes.value.map(paneLabel)))
  emit('focusTerminal')
}
defineExpose({ openIn, adopt })

async function close(pane: Pane) {
  // IDEA asks before a terminal whose process is still running is closed: a terminal marks its
  // process with ALWAYS_USE_DEFAULT_STOPPING_BEHAVIOUR_KEY (TerminalTabCloseListener.kt:87 ->
  // TerminalCloseConfirmation.kt:19), which is what makes canDisconnect false and leaves the
  // dialog with Terminate/Cancel. An already-exited terminal closes without a word.
  if (!pane.exited && props.confirmClose && !(await props.confirmClose(paneLabel(pane)))) return
  await disposePane(pane)
}

async function disposePane(pane: Pane) {
  const rest = panes.value.filter(other => other !== pane)
  panes.value = rest
  const group = pane.group
  if (!rest.some(other => other.group === group)) splitCounts.delete(group)
  pane.off()
  pane.offExit()
  pane.instance.dispose()
  pane.view.remove()
  if (renaming.value === pane) renaming.value = null
  if (menuOpen.value && selected.value === pane) menuOpen.value = false
  if (selected.value === pane) selected.value = rest.find(other => other.group === group) ?? rest[0] ?? null
  if (selected.value) select(selected.value); else layout()
  await term.kill(pane.id).catch(() => undefined)
}

// Restart keeps the label, group and scroll position in place; only the shell is new.
async function restart(pane: Pane) {
  if (busy.value || !isDesktop) return
  const { group, title } = pane
  const wasSelected = selected.value === pane
  // Only an exited terminal shows the restart button, so there is nothing running to confirm.
  await disposePane(pane)
  const created = await spawn(group)
  if (created) {
    created.title = { ...title }
    panes.value = [...panes.value]
    if (wasSelected) select(created)
  }
}

// Reap: drop the local panes whose native session is gone. `term.list` is the
// host's own truth, so this also clears panes that died while the panel was hidden.
async function reapExited() {
  if (!isDesktop) return
  try {
    const { terminals } = await term.list()
    const running = new Set(terminals.filter(item => item.running).map(item => item.id))
    const dead = panes.value.filter(pane => !running.has(pane.id))
    for (const pane of dead) await close(pane)
    note.value = dead.length ? `已回收 ${dead.length} 个已退出的终端。` : '没有需要回收的终端。'
  } catch (error) { note.value = error instanceof BridgeError ? `${error.code}: ${error.message}` : '无法读取终端列表。' }
}

function beginRename(pane: Pane) {
  renaming.value = pane
  // 输入框预填的是**设置感知的全标题**（`RenameTerminalSessionAction.kt:20-23` 的
  // `getContentDisplayNameToEdit` = `buildSettingsAwareFullTitle()`），不是标签上那条截断过的文字；
  // 提交写回的仍是 `userDefinedTitle`（同文件 `:25-29`）。
  renameText.value = terminalRenameInitialValue(pane.title, TITLE_SETTINGS, isCommandRunning(pane))
  void nextTick(() => { renameInput.value?.focus(); renameInput.value?.select() })
}
function commitRename() {
  const pane = renaming.value
  // 重命名写的是 `userDefinedTitle`（`renameTerminal`），空标题 = 取消重命名回到 shell 标题/默认标题。
  if (pane) setPaneTitle(pane, renameTerminal(pane.title, renameText.value))
  renaming.value = null
}

function toggleSearch() {
  searchOpen.value = !searchOpen.value
  if (!searchOpen.value) { searchMiss.value = false; selected.value?.instance.focus(); return }
  void nextTick(() => searchInput.value?.focus())
}
function runSearch(forward: boolean) {
  const pane = selected.value
  const query = searchText.value
  if (!pane || !query) return
  const found = forward ? pane.search.findNext(query) : pane.search.findPrevious(query)
  searchMiss.value = !found
}
function clearSearch() {
  searchText.value = ''
  searchMiss.value = false
  selected.value?.instance.clearSelection()
  selected.value?.instance.focus()
}

const isSplit = (pane: Pane) => groupPanes(pane).length > 1

onMounted(async () => {
  await spawn()
  if (disposed) return
  observer = new ResizeObserver(() => refit())
  if (stage.value) observer.observe(stage.value)
  // 主题切换（`documentElement.dataset.theme`）时把新配色应用到所有窗格 —— 上游 palette 是活的。
  themeObserver = new MutationObserver(() => applyPalette())
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})
watch(() => props.active, value => { if (value) refit() })
onBeforeUnmount(() => {
  disposed = true
  observer?.disconnect()
  themeObserver?.disconnect()
  for (const pane of panes.value) { pane.off(); pane.offExit(); pane.instance.dispose(); void term.kill(pane.id).catch(() => undefined) }
  panes.value = []
  selected.value = null
})
</script>

<template>
  <div class="terminal-host">
    <div class="terminal-bar">
      <div class="terminal-tabs">
        <div v-for="pane in panes" :key="pane.id" class="terminal-tab" :class="{ selected: selected === pane, exited: pane.exited }">
          <button class="terminal-select" :title="`${paneTooltip(pane)}（双击重命名）`" @click="select(pane)" @dblclick.stop="beginRename(pane)">
            <SquareTerminal :size="iconSize.dense" /><span>{{ paneLabel(pane) }}</span><Columns2 v-if="isSplit(pane)" :size="iconSize.dense" /><span v-if="pane.exited" class="terminal-exit">exit {{ pane.exitCode }}</span>
          </button>
          <button v-if="pane.exited && shownAs('terminal.restart')" class="icon-button" :title="why('terminal.restart', '重启该终端')" :aria-label="`重启 ${paneLabel(pane)}`" @click="restart(pane)"><RotateCw :size="iconSize.dense" /></button>
          <button class="icon-button" title="关闭终端" :aria-label="`关闭 ${paneLabel(pane)}`" @click="close(pane)"><X :size="iconSize.dense" /></button>
        </div>
      </div>
      <input v-if="renaming" ref="renameInput" v-model="renameText" class="terminal-rename" aria-label="终端名称" maxlength="40" @keydown.enter.prevent="commitRename" @keydown.esc.stop.prevent="renaming = null" @blur="commitRename" />
      <button v-if="shownAs('terminal.rename')" class="icon-button" :title="why('terminal.rename', '重命名当前终端')" :aria-label="why('terminal.rename', '重命名当前终端')" :disabled="!can('terminal.rename')" @click="selected && beginRename(selected)"><Pencil :size="iconSize.menu" /></button>
      <!-- Terminal.MoveToolWindowTabLeft / Right（plugin.xml:125-126）：挪的是当前选中的那一条标签。 -->
      <button v-if="shownAs('terminal.tab.left')" class="icon-button" :title="why('terminal.tab.left', '向左移动标签')" :aria-label="why('terminal.tab.left', '向左移动标签')" :disabled="!can('terminal.tab.left')" @click="selected && moveTab(selected, false)"><ArrowLeft :size="iconSize.menu" /></button>
      <button v-if="shownAs('terminal.tab.right')" class="icon-button" :title="why('terminal.tab.right', '向右移动标签')" :aria-label="why('terminal.tab.right', '向右移动标签')" :disabled="!can('terminal.tab.right')" @click="selected && moveTab(selected, true)"><ArrowRight :size="iconSize.menu" /></button>
      <button v-if="shownAs('terminal.search')" class="icon-button" :class="{ active: searchOpen }" :title="why('terminal.search', '在终端中查找')" :aria-label="why('terminal.search', '在终端中查找')" :disabled="!can('terminal.search')" @click="toggleSearch"><Search :size="iconSize.control" /></button>
      <span v-if="shownAs('terminal.font.reset')" class="terminal-font" :title="terminalFontSizeTitle(fontSizeShown, TERMINAL_BASE_FONT_SIZE)">{{ fontSizeShown }}px</span>
      <button v-if="shownAs('terminal.font.decrease')" class="icon-button" :title="why('terminal.font.decrease', '缩小终端字号')" :aria-label="why('terminal.font.decrease', '缩小终端字号')" :disabled="!can('terminal.font.decrease')" @click="stepFontSize('terminal.font.decrease')"><ZoomOut :size="iconSize.control" /></button>
      <button v-if="shownAs('terminal.font.increase')" class="icon-button" :title="why('terminal.font.increase', '放大终端字号')" :aria-label="why('terminal.font.increase', '放大终端字号')" :disabled="!can('terminal.font.increase')" @click="stepFontSize('terminal.font.increase')"><ZoomIn :size="iconSize.control" /></button>
      <button v-if="shownAs('terminal.font.reset')" class="icon-button" :title="why('terminal.font.reset', '复位终端字号')" :aria-label="why('terminal.font.reset', '复位终端字号')" :disabled="!can('terminal.font.reset')" @click="resetFontSize"><RotateCcw :size="iconSize.control" /></button>
      <button v-if="shownAs('terminal.reap')" class="icon-button" :title="why('terminal.reap', '回收已退出的终端')" :aria-label="why('terminal.reap', '回收已退出的终端')" :disabled="!can('terminal.reap')" @click="reapExited"><RotateCw :size="iconSize.menu" /></button>
      <button v-if="shownAs('terminal.split')" class="icon-button" :title="why('terminal.split', '右侧分屏')" :aria-label="why('terminal.split', '右侧分屏')" :disabled="!can('terminal.split')" @click="split('right')"><Columns2 :size="iconSize.control" /></button>
      <button v-if="shownAs('terminal.split.down')" class="icon-button" :title="why('terminal.split.down', '下侧分屏')" :aria-label="why('terminal.split.down', '下侧分屏')" :disabled="!can('terminal.split.down')" @click="split('down')"><Rows2 :size="iconSize.control" /></button>
      <button class="icon-button" :title="why('terminal.new', '新建终端')" :aria-label="why('terminal.new', '新建终端')" :disabled="!can('terminal.new')" @click="spawn()"><Plus :size="iconSize.control" /></button>
    </div>
    <div v-if="searchOpen" class="terminal-search">
      <input ref="searchInput" v-model="searchText" class="terminal-search-input" aria-label="终端查找内容" placeholder="在终端缓冲区中查找" @keydown.enter.prevent="runSearch(true)" @keydown.esc.stop.prevent="toggleSearch" />
      <button class="subtle-button" :disabled="!can('terminal.search.previous')" :title="why('terminal.search.previous', '上一个')" @click="runSearch(false)">上一个</button>
      <button class="subtle-button" :disabled="!can('terminal.search.next')" :title="why('terminal.search.next', '下一个')" @click="runSearch(true)">下一个</button>
      <button class="subtle-button" :disabled="!can('terminal.search.clear')" :title="why('terminal.search.clear', '清除')" @click="clearSearch">清除</button>
      <span v-if="searchMiss" class="terminal-search-miss">没有更多匹配。</span>
    </div>
    <div ref="stage" class="terminal-stage" />
    <p v-if="note" class="terminal-note">{{ note }}</p>
    <!-- 窗格右键菜单：上游 `Terminal.OutputContextMenu`（复制/粘贴/从历史粘贴）+ TW.Unsplit / 窗格跳转。 -->
    <div v-if="menuOpen" class="terminal-menu-backdrop" @pointerdown="closeMenu" @contextmenu.prevent="closeMenu">
      <AnchoredMenu :x="menuPoint.x" :y="menuPoint.y">
        <button v-for="row in clipboardActions" :key="row.id" class="terminal-menu-row" :disabled="!row.enabled" :title="row.enabled ? `${row.label}（${row.keys.join('、')}）` : row.reason" @click="row.id === 'terminal.paste.fromHistory' ? closeMenu() : runClipboard(row.id)">
          {{ row.label }}<span v-if="row.keys.length" class="terminal-menu-keys">{{ row.keys.join('、') }}</span>
        </button>
        <div v-if="historyEntries.length" class="terminal-menu-group">
          <p class="terminal-menu-caption">从历史粘贴</p>
          <button v-for="(entry, index) in historyEntries" :key="index" class="terminal-menu-row" :disabled="!clipboardContext().running" :title="entry.text" @click="pasteHistoryEntry(entry)">{{ entry.text }}</button>
        </div>
        <button v-if="shownAs('terminal.select.all')" class="terminal-menu-row" :disabled="!can('terminal.select.all')" :title="why('terminal.select.all', '全选')" @click="selectAll">全选</button>
        <button v-if="shownAs('terminal.clear.buffer')" class="terminal-menu-row" :disabled="!can('terminal.clear.buffer')" :title="why('terminal.clear.buffer', '清空终端缓冲区')" @click="clearBuffer">清空终端缓冲区</button>
        <button v-if="shownAs('terminal.unsplit')" class="terminal-menu-row" :disabled="!can('terminal.unsplit')" :title="why('terminal.unsplit', '取消分屏')" @click="unsplit">取消分屏</button>
        <button v-if="shownAs('terminal.pane.previous')" class="terminal-menu-row" :disabled="!can('terminal.pane.previous')" :title="why('terminal.pane.previous', '跳到上一个窗格')" @click="gotoPane(false)"><ChevronLeft :size="iconSize.dense" />上一个窗格</button>
        <button v-if="shownAs('terminal.pane.next')" class="terminal-menu-row" :disabled="!can('terminal.pane.next')" :title="why('terminal.pane.next', '跳到下一个窗格')" @click="gotoPane(true)"><ChevronRight :size="iconSize.dense" />下一个窗格</button>
      </AnchoredMenu>
    </div>
  </div>
</template>

<style scoped>
.terminal-host { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--editor); }
.terminal-bar { display: flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--line); }
.terminal-tabs { flex: 1; min-width: 0; display: flex; gap: var(--space-1); overflow-x: auto; }
.terminal-tab { display: flex; align-items: center; gap: var(--space-1); flex-shrink: 0; padding: 3px var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--elevated); color: var(--secondary); font: 12px var(--font-mono); transition: background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease); }
.terminal-tab:hover { background: var(--hover); }
.terminal-tab.selected { background: var(--selected); color: var(--text); border-color: var(--line-strong); }
.terminal-tab.exited { opacity: 0.75; }
.terminal-exit { color: var(--muted); font-size: 10px; }
.terminal-select { display: flex; align-items: center; gap: var(--space-1); padding: 0; border: 0; background: transparent; color: inherit; font: inherit; }
.terminal-tab > .icon-button { width: 18px; height: 18px; }
.terminal-tab > .icon-button:hover { color: var(--error); }
.terminal-rename { width: 9em; min-height: 18px; padding: 0 var(--space-1); color: var(--text); background: var(--editor); border: 1px solid var(--accent); border-radius: var(--radius-xs); font: 12px var(--font-mono); }
.terminal-search { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--line); background: var(--rail); }
.terminal-search-input { flex: 1; min-width: 0; min-height: var(--ctrl-height-sm); padding: 2px var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 12px var(--font-mono); }
.terminal-search-input:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.terminal-search-miss { color: var(--muted); font-size: 11px; }
.terminal-bar > .icon-button.active { color: var(--accent); }
.terminal-font { min-width: 3.2em; color: var(--muted); font: 11px var(--font-mono); text-align: right; }
.terminal-stage { flex: 1; min-width: 0; min-height: 0; display: grid; }
.terminal-stage :deep(.terminal-view) { min-width: 0; min-height: 0; padding: 6px 10px; }
.terminal-stage :deep(.terminal-view.terminal-split) { overflow: hidden; }
.terminal-stage :deep(.terminal-view.terminal-edge-right) { border-right: 1px solid var(--line); }
.terminal-stage :deep(.terminal-view.terminal-edge-bottom) { border-bottom: 1px solid var(--line); }
.terminal-note { margin: 0; padding: var(--space-2) var(--space-4); color: var(--muted); font-size: 12px; }
.terminal-menu-backdrop { position: fixed; inset: 0; z-index: 30; }
.terminal-menu-row { display: flex; align-items: center; gap: var(--space-2); width: 100%; min-height: var(--ctrl-height-sm); padding: 0 var(--space-2); border: 0; background: transparent; color: var(--text); font: 12px var(--font-mono); text-align: left; white-space: nowrap; overflow: hidden; }
.terminal-menu-row:hover:not(:disabled) { background: var(--hover); }
.terminal-menu-row:disabled { color: var(--muted); }
.terminal-menu-keys { margin-left: auto; color: var(--muted); font-size: 11px; }
.terminal-menu-group { border-top: 1px solid var(--line); margin-top: var(--space-1); padding-top: var(--space-1); }
.terminal-menu-caption { margin: 0; padding: 0 var(--space-2); color: var(--muted); font-size: 11px; }
</style>
