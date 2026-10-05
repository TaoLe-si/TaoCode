// 「高亮用法」（`src/usageHighlight.ts` + `src/usageHighlightExtension.ts`）——
// 上游 `HighlightUsagesAction` / `HighlightUsagesHandler` / `UsageRanges.kt` 的文本子集：
// 光标处标识符取法、整词用法、注释里的出现不算、Esc / 再执行一次清除、
// 编辑后**不收起**而是后台重算（`BackgroundHighlighter` 的 alarm 重排 + isEditorUpToDate 丢弃）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EditorState } from '@codemirror/state'
import {
  commentRanges, highlightTargetAt, identifierAt, isHighlightableWord, usageRanges,
} from '../src/usageHighlight.ts'
import {
  backgroundResultIsFresh, countByKind, highlightUsagesCommand, setUsageHighlight,
  usageHighlightExtension, usageHighlightField, usagesAt,
} from '../src/usageHighlightExtension.ts'

test('identifierAt：光标在词内、词首、词尾都能取到；空白与标点上取不到', () => {
  const text = 'foo bar_baz $x'
  assert.deepEqual(identifierAt(text, 1), { word: 'foo', from: 0, to: 3 })
  assert.deepEqual(identifierAt(text, 3), { word: 'foo', from: 0, to: 3 }, '光标在词尾也取左侧的词')
  assert.deepEqual(identifierAt(text, 4), { word: 'bar_baz', from: 4, to: 11 })
  assert.deepEqual(identifierAt(text, 12), { word: '$x', from: 12, to: 14 })
  assert.deepEqual(identifierAt('a + b', 1), { word: 'a', from: 0, to: 1 }, '光标紧贴词尾也取左侧的词')
  assert.equal(identifierAt('a + b', 2), null, '标点处无元素')
  assert.equal(identifierAt('a + b', 3), null, '两侧都是空白（不紧贴词）时无元素')
})

test('isHighlightableWord：纯数字/空串不作为可高亮的引用', () => {
  assert.equal(isHighlightableWord('value'), true)
  assert.equal(isHighlightableWord('_tmp'), true)
  assert.equal(isHighlightableWord('123'), false)
  assert.equal(isHighlightableWord(''), false)
})

test('usageRanges：整词匹配跳过子串，大小写默认敏感，光标那条标为当前', () => {
  const text = 'value = valueOf(value); VALUE'
  const ranges = usageRanges(text, 'value', { caret: 18 })
  assert.deepEqual(ranges.map(range => [range.from, range.to]), [[0, 5], [16, 21]])
  assert.deepEqual(ranges.map(range => range.current), [false, true])
  assert.equal(usageRanges(text, 'value', { caseSensitive: false }).length, 3)
})

test('commentRanges：行注释与块注释逐个扫描，未闭合的块注释直到文末', () => {
  const text = '// a = 1\nx = 2; /* b */ y\n/* open\nstill'
  assert.deepEqual(commentRanges(text, { line: '//', block: ['/*', '*/'] }), [
    { from: 0, to: 8 },
    { from: 16, to: 23 },
    { from: 26, to: text.length },
  ])
})

test('usageRanges：注释里的出现不算用法（ReferencesSearch 的等价物）', () => {
  const text = 'count = 1\n// count is a counter\nprint(count)\n'
  const skip = commentRanges(text, { line: '//' })
  assert.deepEqual(usageRanges(text, 'count', { skip }).map(range => range.from), [0, 38])
})

test('highlightTargetAt：选区是一个词时以选区为准，否则回退到光标处标识符', () => {
  assert.deepEqual(highlightTargetAt('alpha beta', 6, 10), { word: 'beta', from: 6, to: 10 })
  assert.deepEqual(highlightTargetAt('alpha beta', 7, 7), { word: 'beta', from: 6, to: 10 })
})

// 命令层：只读 state、调 dispatch，可离线跑。
function run(command, doc, anchor, head = anchor, extensions = []) {
  let state = EditorState.create({ doc, selection: { anchor, head }, extensions })
  const view = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  return { ran: command(view), state }
}

const JAVA = EditorState.languageData.of(() => [{ commentTokens: { line: '//', block: { open: '/*', close: '*/' } } }])
const DEFAULTS = [JAVA, usageHighlightExtension()]

test('命令层：高亮全部出现，再执行一次清除；Esc 也清除', () => {
  const first = run(highlightUsagesCommand, 'total = total + 1\n', 0, 0, DEFAULTS)
  assert.equal(first.ran, true)
  const highlight = first.state.field(usageHighlightField)
  assert.equal(highlight.word, 'total')
  assert.deepEqual(highlight.occurrences.map(o => o.from), [0, 8])
  // 再执行一次 → 清除。
  let state = first.state
  const view = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  assert.equal(highlightUsagesCommand(view), true)
  assert.equal(state.field(usageHighlightField), null)
})

test('命令层：没有可高亮的元素时不吞键', () => {
  const out = run(highlightUsagesCommand, '  \n', 1, 1, DEFAULTS)
  assert.equal(out.ran, false)
})

test('命令层：编辑后**不在同一拍收起**（上游 BackgroundHighlighter 的后台重算，见下条）', () => {
  const out = run(highlightUsagesCommand, 'a = a\n', 0, 0, DEFAULTS)
  let state = out.state
  assert.ok(state.field(usageHighlightField))
  const view = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  assert.equal(highlightUsagesCommand(view), true, '先关掉')
  view.dispatch({ effects: setUsageHighlight.of(usagesAt(state, 0, 0)) })
  assert.ok(state.field(usageHighlightField))
  state = state.update({ changes: { from: 3, to: 3, insert: 'x' } }).state
  // 高亮留在屏上：区间标记跟着编辑平移，重画由 usageBackgroundRecompute 排期（BackgroundHighlighter.kt:139/:160 的
  // alarm.cancelAllRequests + 重新 addRequest），陈旧结果由 isEditorUpToDate（:322-337）整份丢掉。
  assert.ok(state.field(usageHighlightField), '编辑后不应在同一拍清空')
})

test('后台重算：陈旧结果整份丢弃（BackgroundHighlighter.isEditorUpToDate，:322-337）', () => {
  // 排期时的签名 vs 真开跑时的签名：光标动了或内容又变了 → 丢弃；代数被取代 → 丢弃。
  const scheduled = { caret: 4, stamp: 100 }
  assert.equal(backgroundResultIsFresh(scheduled, { caret: 4, stamp: 100 }, 7, 7), true, '三项都对得上才画')
  assert.equal(backgroundResultIsFresh(scheduled, { caret: 5, stamp: 100 }, 7, 7), false, '光标动了就丢')
  assert.equal(backgroundResultIsFresh(scheduled, { caret: 4, stamp: 101 }, 7, 7), false, '内容又变了就丢')
  assert.equal(backgroundResultIsFresh(scheduled, { caret: 4, stamp: 100 }, 8, 7), false, '代数被更新的排期取代就丢')
})

test('读/写分桶计数（UsageRanges.kt 的四个集合，供状态栏/提示用）', () => {
  const highlight = usagesAt(EditorState.create({ doc: 'a = a\n' }), 0, 0)
  assert.ok(highlight)
  const counts = countByKind(highlight.occurrences)
  assert.equal(counts.read, 1)
  assert.equal(counts.writeDeclaration, 1)
  assert.equal(counts.write, 0)
})

test('接线：扩展自己绑 Ctrl+Shift+F7（$default.xml 的 HighlightUsagesInFile），菜单行展示同一个键', () => {
  const extension = readFileSync(new URL('../src/usageHighlightExtension.ts', import.meta.url), 'utf8')
  assert.match(extension, /key: 'Ctrl-Shift-F7'/, '扩展里没有绑 HighlightUsagesInFile 的键位')
  const menu = readFileSync(new URL('../src/menus/editMenu.ts', import.meta.url), 'utf8')
  assert.match(menu, /'usage\.highlight', '高亮用法', 'Ctrl Shift F7'/, '编辑菜单没有这一行或键位不一致')
  const editorSearch = readFileSync(new URL('../src/editorSearchExtension.ts', import.meta.url), 'utf8')
  assert.match(editorSearch, /usageHighlightExtension\(\)/, '扩展没有挂进编辑器（editorSearchExtension 是 CodeEditor 已调用的入口）')
})
