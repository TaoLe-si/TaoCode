// 编辑器内查找栏的 **CodeMirror 侧**：查找状态、命中高亮、F3/Shift+F3 的实际跳转。
//
// 与上游的对应关系写在 `src/editorSearch.ts` 的头注释里（`EditorSearchSession` +
// `SearchReplaceComponent`，不是 `FindPopupPanel`）。这一层只做两件事：
//   ① 拿纯逻辑给的命中区间画高亮（对应 `LivePreview.highlightUsages`
//      —— `LivePreview.java:337-343` 给每条命中加一个 range highlighter，
//      当前条另画一个光标框 `:286-290`；本仓用 `Decoration.mark` 的两种 class 表达）；
//   ② 把「下一个/上一个」变成真的移动光标（CodeMirror 自带的 `findNext` 只在
//      **它自己的查找面板**打开时才有事做，本仓用的是自绘栏，所以那两条命令在本仓是空操作）。
//
// 上游栏里的按键与选项顺序见 `docs/inventory/verdict-find-diff.md` 与本批的判决记录。

import { EditorSelection, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { foldedRanges, unfoldEffect } from '@codemirror/language'
import { Decoration, EditorView, keymap, type Command, type DecorationSet } from '@codemirror/view'
import { collectSearchMatches, nextMatch, type SearchMatch, type SearchOptions, DEFAULT_SEARCH_OPTIONS } from './editorSearch.ts'
import { usageHighlightExtension } from './usageHighlightExtension.ts'

/** 查找栏的状态：开没开、查询词、选项。**只放在 CodeMirror 里**（法一是权威），
 *  Vue 组件读它来画，写它来改 —— 两边不会各存一份。 */
export interface SearchState {
  open: boolean
  query: string
  options: SearchOptions
  /** 当前命中的下标（`-1` = 还没定位）。 */
  current: number
}

export const CLOSED_SEARCH: SearchState = Object.freeze({
  open: false, query: '', options: DEFAULT_SEARCH_OPTIONS, current: -1,
})

export const setSearchState = StateEffect.define<Partial<SearchState>>()

export const searchStateField = StateField.define<SearchState>({
  create: () => CLOSED_SEARCH,
  update(value, tr) {
    let next = value
    for (const e of tr.effects) if (e.is(setSearchState)) next = { ...next, ...e.value }
    // 文档一变，命中区间就作废；查询词没变时保留选项与开合状态即可。
    if (tr.docChanged && next !== value) return { ...next, current: -1 }
    return next
  },
})

/** 高亮上限：与 CodeMirror 默认的 100 同量级，避免超长文档里画几万个装饰。 */
const MAX_HIGHLIGHTS = 200

const matchMark = Decoration.mark({ class: 'cm-searchMatch' })
const currentMark = Decoration.mark({ class: 'cm-searchMatch cm-searchMatch-current' })

/** 读当前查找状态（组件与命令共用这一个入口）。 */
export function searchStateOf(state: EditorState): SearchState {
  return state.field(searchStateField, false) ?? CLOSED_SEARCH
}

/** 命中区间的**当前**一份（不进 StateField：它随文档变，按需重算最省事，且不会与文档脱节）。 */
export function matchesIn(state: EditorState): SearchMatch[] {
  const { query, options } = searchStateOf(state)
  if (!query) return []
  const scope = searchScope(state)
  return collectSearchMatches(state.sliceDoc(scope.from, scope.to), query, options)
    .map(m => ({ from: m.from + scope.from, to: m.to + scope.from }))
}

// 「在所选内容中搜索」(`FindModel.isGlobal` 取反)：只看主选区的行区间 ——
// 上游在编辑器里也是按**选区**限定，而不是按整个文档。
//
// **没有选区 ≠ 搜全文件**：上游 `EditorSelectionSearchAreaProvider`（`SearchResults.java:573-582`）
// 直接拿 `getBlockSelectionStarts()/getBlockSelectionEnds()`，空选区就是空搜索区，于是
// `EditorSearchSession.java:408-410` 报 `editorsearch.noselection`（「无选区」）。这里照做：
// 悄悄退回全文件会让用户以为自己按的开关没生效。
function searchScope(state: EditorState): { from: number; to: number } {
  const { options } = searchStateOf(state)
  const range = state.selection.main
  if (!options.inSelection) return { from: 0, to: state.doc.length }
  if (range.empty) return { from: range.from, to: range.from }
  return { from: state.doc.lineAt(range.from).from, to: state.doc.lineAt(range.to).to }
}

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_value, tr) {
    const { open, query, current } = searchStateOf(tr.state)
    if (!open || !query) return Decoration.none
    const marks = matchesIn(tr.state).slice(0, MAX_HIGHLIGHTS)
    if (!marks.length) return Decoration.none
    return Decoration.set(marks.map((m, i) => (i === current ? currentMark : matchMark).range(m.from, m.to)))
  },
  provide: field => EditorView.decorations.from(field),
})

/**
 * F3 / Shift+F3 的真实跳转。与上游 `NextOccurrenceAction` / `PrevOccurrenceAction`
 * （键位源自 `FindNext` = F3 / `FindPrevious` = Shift+F3，`$default.xml:707-708` / `:507-508`）
 * 同一语义：光标停在命中区间的**起点**，并把当前条记进状态（供计数文案与"当前命中"高亮用）。
 */
export function goToMatch(view: EditorView, backwards: boolean): boolean {
  const state = searchStateOf(view.state)
  if (!state.open || !state.query) return false
  const marks = matchesIn(view.state)
  if (!marks.length) return false
  // 从主选区起点找下一个；`nextMatch` 自带回绕。
  const anchor = backwards ? view.state.selection.main.from : view.state.selection.main.to
  const hit = nextMatch(marks, anchor, backwards)
  if (!hit) return false
  const index = marks.indexOf(hit)
  // 上游 `SelectionManager.updateSelection`（`SelectionManager.java:33-70`）那三件事：
  //   ① **选中整个命中**（`setSelection(start, end)`）而不是只放一个光标 —— 于是接着打字
  //      就是替换那一处，这正是"实时预览"最有用的性质；
  //   ② 光标落在**命中末尾**（`moveToOffset(cursor.getEndOffset())`）—— 选中区间的 caret 端
  //      本来就在末尾，所以 `EditorSelection.range(from, to)` 直接对上；
  //   ③ 命中若落在**折叠区**里，先把那块折起来的地方展开（`:52-67` 的 runBatchFoldingOperation
  //      用 `cursor.intersects(region)` 挑），否则"跳到一个看不见的地方"。
  view.dispatch({
    selection: EditorSelection.range(hit.from, hit.to),
    scrollIntoView: true,
    effects: [setSearchState.of({ current: index }), ...unfoldFor(view.state, hit)],
  })
  return true
}

/** 命中落在哪个折叠区里就把那个区展开（上游那一批折叠操作的等价物）。 */
function unfoldFor(state: EditorState, hit: SearchMatch): StateEffect<unknown>[] {
  const effects: StateEffect<unknown>[] = []
  foldedRanges(state).between(hit.from, hit.to, (from, to) => {
    if (from <= hit.to && to >= hit.from) effects.push(unfoldEffect.of({ from, to }))
  })
  return effects
}

const findNextCommand: Command = view => goToMatch(view, false)
const findPrevCommand: Command = view => goToMatch(view, true)

/**
 * 编辑器里的那一层扩展：状态 + 高亮 + 两条导航键。
 * **替换** CodeMirror 自带的 `Mod-f` / `F3` 绑定（那些都指它自己的面板）：本仓的
 * keymap 里这几条要排在 `basicSetup` **之前**（CodeMirror 的 keymap 是谁在前谁赢）。
 *
 * 末尾一并返回「高亮用法」的扩展（`src/usageHighlightExtension.ts`，上游 `HighlightUsagesAction`）：
 * 它同属**光标驱动的高亮层**，而 CodeEditor.vue 已冻结（1147 行机检上限），本函数是它已经调用的
 * 注册入口 —— 单独开一个模块不会被谁 import。
 */
export function editorSearchExtension(): Extension {
  return [
    searchStateField,
    highlightField,
    keymap.of([
      { key: 'F3', preventDefault: true, run: findNextCommand },
      { key: 'Shift-F3', preventDefault: true, run: findPrevCommand },
    ]),
    usageHighlightExtension(),
  ]
}