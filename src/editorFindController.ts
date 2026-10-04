// 编辑器内查找栏的**宿主侧状态域**（Vue 反应式）—— 把栏的 UI 与 CodeMirror 的查找状态绑在一起。
//
// 分工（三层，各自只做一件事）：
//   · `src/editorSearch.ts`          纯匹配语义（正则构造、命中收集、回绕），零依赖、可单测；
//   · `src/editorSearchExtension.ts` CodeMirror 侧（状态字段、命中高亮、F3/Shift+F3 跳转）；
//   · 本模块                          宿主侧：把上面两层接成一个 Vue 能渲染的 `state` + 一组动作。
//
// **查找选项的持久化**：上游 `FindSettingsBase` 会把「区分大小写 / 单词 / 正则」记进
// 本地设置（`ToggleMatchCase.java:27` 的 `FindSettings.setLocalCaseSensitive`），下次打开沿用。
// 本仓把这一份放进 `localStorage`（与 `taocode.stripeWidths` 同一族），键 `taocode.findOptions`。

import { reactive } from 'vue'
import type { Command, EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { DEFAULT_SEARCH_OPTIONS, buildSearchRegex, matchStatus, type SearchOptions } from './editorSearch.ts'
import { goToMatch, matchesIn, searchStateOf, setSearchState } from './editorSearchExtension.ts'

const OPTIONS_KEY = 'taocode.findOptions'
const HISTORY_KEY = 'taocode.findHistory'
/** 历史条数上限：上游 `FindInProjectSettings` 也是一张有界表。 */
const HISTORY_LIMIT = 20

function readStoredOptions(): SearchOptions {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY)
    if (!raw) return { ...DEFAULT_SEARCH_OPTIONS }
    const parsed = JSON.parse(raw) as Partial<SearchOptions>
    return {
      caseSensitive: Boolean(parsed.caseSensitive),
      wholeWords: Boolean(parsed.wholeWords),
      regex: Boolean(parsed.regex),
      // 「在所选内容中搜索」是**每次会话**的事（上游 `isGlobal` 由选区决定），不持久化。
      inSelection: false,
    }
  } catch {
    return { ...DEFAULT_SEARCH_OPTIONS }
  }
}

function readStoredHistory(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, HISTORY_LIMIT) : []
  } catch {
    return []
  }
}

export interface FindBarState {
  open: boolean
  /** 替换模式（上游 `SwitchToReplace`）。 */
  replaceMode: boolean
  query: string
  replace: string
  options: SearchOptions
  /** 「第 n / 共 m 条」。 */
  status: string
  /** 查询词是坏正则。 */
  invalid: boolean
  history: string[]
}

export interface FindController {
  state: FindBarState
  open: (replaceMode: boolean) => void
  close: () => void
  setQuery: (value: string) => void
  setReplace: (value: string) => void
  setOptions: (patch: Partial<SearchOptions>) => void
  toggleReplace: () => void
  next: () => void
  previous: () => void
  replaceOne: () => void
  replaceAll: () => void
  /** 文档变了之后重算计数（CodeEditor 的 updateListener 调）。 */
  refresh: () => void
  /** 关栏时把查询词记进历史（上游在提交查询时记）。 */
  remember: () => void
  /**
   * `FindWordAtCaret`（Ctrl+F3）/ `FindPrevWordAtCaret`（Ctrl+Shift+F3）：
   * 把光标处的单词取成查询词再找下一个/上一个（上游 `FindWordAtCaretAction`）。
   * 取词用 CodeMirror 的 `wordAt`；光标不在词上时**不动查询词**、返回 false。
   */
  findWordAtCaret: (backwards: boolean) => boolean
  /** `ToggleFindInSelection`（Ctrl+Alt+E）：切「仅在选区内搜索」并保证栏是开的。 */
  toggleInSelection: () => void
}

/**
 * `getView` 是个取值函数而不是 view 本身：CodeEditor 的 `view` 变量在 `onMounted` 才赋值，
 * 而控制器要在 setup 期就建好（模板里要渲染它）。传 view 会在挂载前永远拿到 undefined。
 */
export function createFindController(getView: () => EditorView | undefined, notify?: (message: string) => void): FindController {
  const state = reactive<FindBarState>({
    open: false, replaceMode: false, query: '', replace: '',
    options: readStoredOptions(), status: '', invalid: false, history: readStoredHistory(),
  })

  // 每次把 state 写进 CodeMirror 的查找状态字段（高亮与 F3 都读它）。
  function push() {
    getView()?.dispatch({ effects: setSearchState.of({ open: state.open, query: state.query, options: { ...state.options } }) })
  }

  function refresh() {
    const view = getView()
    if (!view || !state.open || !state.query) { state.status = ''; state.invalid = false; return }
    state.invalid = buildSearchRegex(state.query, state.options) === null
    if (state.invalid) { state.status = ''; return }
    const marks = matchesIn(view.state)
    const current = searchStateOf(view.state).current
    state.status = matchStatus(current >= 0 && current < marks.length ? current : 0, marks.length)
  }

  function saveOptions() {
    try {
      const { caseSensitive, wholeWords, regex } = state.options
      localStorage.setItem(OPTIONS_KEY, JSON.stringify({ caseSensitive, wholeWords, regex }))
    } catch { /* 存不下就算了，不影响本次会话 */ }
  }

  function remember() {
    const query = state.query.trim()
    if (!query) return
    const next = [query, ...state.history.filter(x => x !== query)].slice(0, HISTORY_LIMIT)
    state.history = next
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { /* 同上 */ }
  }

  function open(replaceMode: boolean) {
    state.open = true
    state.replaceMode = replaceMode
    push()
    refresh()
  }

  function close() {
    remember()
    state.open = false
    state.replaceMode = false
    state.status = ''
    push()
    getView()?.focus()
  }

  function setQuery(value: string) {
    state.query = value
    const view = getView()
    // 打字即定位到第一处（上游 LivePreview 边输边预览）：把光标放到首个命中。
    // 一次 dispatch 同时带上新查询与 current，避免分两步时中间态被高亮字段看到。
    if (view && value) {
      view.dispatch({ effects: setSearchState.of({ open: true, query: value, options: { ...state.options }, current: 0 }) })
      const marks = matchesIn(view.state)
      // **选中**首条命中（不是只放光标）—— 与 F3 走的是同一条语义（上游
      // `SelectionManager.updateSelection`：选中整个命中、光标落在末尾）。
      // 真机上抓到的：这一处原来写的是 `EditorSelection.cursor(...)`，于是"边打字边预览"时
      // 那一处根本没有被选中（选中层是空的），只有按过 F3 才有。
      if (marks.length) view.dispatch({ selection: EditorSelection.range(marks[0].from, marks[0].to), effects: setSearchState.of({ current: 0 }) })
    } else {
      push()
    }
    refresh()
  }

  function setReplace(value: string) { state.replace = value }
  function setOptions(patch: Partial<SearchOptions>) {
    Object.assign(state.options, patch)
    saveOptions()
    push()
    refresh()
  }
  function toggleReplace() { state.replaceMode = !state.replaceMode }

  function move(backwards: boolean) {
    const view = getView()
    if (!view) return
    if (!state.open) { open(false); return }
    // 没开栏时 F3 是"重复上一次查找"（上游 `FindNext` 的描述就是这个）；开了栏才跳。
    if (!goToMatch(view, backwards) && state.query) notify?.('没有匹配项')
    refresh()
  }

  function replaceOne() {
    const view = getView()
    if (!view || !state.query || state.invalid) return
    const marks = matchesIn(view.state)
    const range = view.state.selection.main
    const hit = marks.find(m => m.from === range.from && m.to === range.to) ?? marks[0]
    if (!hit) { notify?.('没有匹配项'); return }
    // 替换走**字面量**插入（上游 `preserveCase` 只改大小写形态，本仓替换文本原样落盘）。
    view.dispatch({ changes: { from: hit.from, to: hit.to, insert: state.replace }, selection: EditorSelection.cursor(hit.from + state.replace.length) })
    refresh()
  }

  function replaceAll() {
    const view = getView()
    if (!view || !state.query || state.invalid) return
    const marks = matchesIn(view.state)
    if (!marks.length) { notify?.('没有匹配项'); return }
    // 从后往前改，避免前面的替换移动后面命中的偏移。
    view.dispatch({ changes: marks.slice().reverse().map(m => ({ from: m.from, to: m.to, insert: state.replace })) })
    refresh()
  }

  function findWordAtCaret(backwards: boolean): boolean {
    const view = getView()
    if (!view) return false
    const range = view.state.selection.main
    // 有选区时用选区文本（上游 `FindWordAtCaretAction` 也先看选区），否则取光标处的词。
    const word = range.empty ? (view.state.wordAt(range.head) ? view.state.sliceDoc(view.state.wordAt(range.head)!.from, view.state.wordAt(range.head)!.to) : '') : view.state.sliceDoc(range.from, range.to)
    if (!word) return false
    open(false)
    setQuery(word)
    move(backwards)
    return true
  }

  function toggleInSelection() {
    if (!state.open) open(false)
    setOptions({ inSelection: !state.options.inSelection })
  }

  return { state, open, close, setQuery, setReplace, setOptions, toggleReplace, next: () => move(false), previous: () => move(true), replaceOne, replaceAll, refresh, remember, findWordAtCaret, toggleInSelection }
}

/** CodeEditor 里 F3 / Shift+F3 的 `Command` 包装（键位表要一个 `Command`，不是一个动作对象）。 */
export function findCommand(controller: FindController, backwards: boolean): Command {
  return () => { if (backwards) controller.previous(); else controller.next(); return true }
}