import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { locationWindow, locationSnippet, previousChangePlace } from '../src/recentLocations.ts'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

// The window is 2*radius+1 lines wide whenever the document allows it.
test('middle lines get the full five-line window', () => {
  assert.deepEqual(locationWindow(5, 20), { start: 3, end: 7 })
})

// RecentLocationsDataModel shifts the window so the caret keeps its context even at a
// document edge: line 0 of 20 shows 0..4, not -2..2 clamped to 0..2.
test('first line slides the window down instead of shrinking it', () => {
  assert.deepEqual(locationWindow(0, 20), { start: 0, end: 4 })
})

test('last line slides the window up', () => {
  // getLinesRange computes `after` with document.lineCount (1-based) while endLine
  // clamps at lineCount - 1, so the bottom edge keeps a full before-context.
  assert.deepEqual(locationWindow(19, 20), { start: 16, end: 19 })
})

test('short documents clamp without inverting', () => {
  assert.deepEqual(locationWindow(1, 2), { start: 0, end: 1 })
  assert.equal(locationWindow(0, 0), null)
})

test('snippet joins the window and reports the first rendered line', () => {
  const lines = ['a', 'b', 'c', 'd', 'e', 'f']
  const result = locationSnippet(lines, 2)
  assert.equal(result.text, 'a\nb\nc\nd\ne')
  assert.equal(result.firstLine, 0)
})

// StringUtil.trimLeading/trimTrailing count newlines around the trimmed text; blank
// edges must disappear while the caret line stays visible.
test('snippet trims leading and trailing blank lines', () => {
  const lines = ['', '', 'code', '', '']
  const result = locationSnippet(lines, 2)
  assert.equal(result.text, 'code')
  assert.equal(result.firstLine, 2)
})

test('blank lines between content survive; only the edges trim', () => {
  assert.equal(locationSnippet(['x', '  ', '\t', '  ', 'y'], 2).text, 'x\n  \n\t\n  \ny')
})

test('lineShift moves reported numbering without changing the window', () => {
  const lines = ['a', 'b', 'c']
  const result = locationSnippet(lines, 1, 3)
  assert.equal(result.text, 'a\nb\nc')
  assert.equal(result.firstLine, 3)
})

test('long lines are capped at 1000 characters', () => {
  const result = locationSnippet(['x'.repeat(1500)], 0)
  assert.equal(result.text.length, 1000)
})

// —— 「回到上次编辑位置」的游标（previousChangePlace）——
// 上游：`platform/platform-impl/src/com/intellij/openapi/fileEditor/impl/IdeDocumentHistoryImpl.kt:481-497`
// 从 `currentIndex - 1 downTo 0` 往更旧走、`:491` 跳过与当前位置同一个位置的格、`:493` 把游标挪过去、
// `:483-485` 游标已在最旧就什么都不做；记一笔改动把游标推回队列尾（`:340`）。
// 本仓更改档「最新在前」⇒ 游标 -1 = 还没按过，候选是游标之后的那一段（见 src/recentLocations.ts 头注释）。
const changeRing = [
  { path: 'a/x.ts', line: 40 },   // 最新
  { path: 'a/x.ts', line: 30 },
  { path: 'b/y.ts', line: 12 },
  { path: 'a/x.ts', line: 40 },   // 与最新那一条同位置的历史重复（写入侧只并表头 ⇒ 环里会有）
]

test('游标每按一次往更旧挪一格：连续按不是在同两格之间弹', () => {
  const first = previousChangePlace(changeRing, -1, { path: 'a/x.ts', line: 40 })
  assert.deepEqual([first.index, first.place.line], [1, 30], '最新那条与当前位置同位置 ⇒ 跳过（:491）')
  const second = previousChangePlace(changeRing, first.index, { path: 'a/x.ts', line: 30 })
  assert.deepEqual([second.index, second.place.path], [2, 'b/y.ts'], '第二次按落在更旧的一格')
  const third = previousChangePlace(changeRing, second.index, { path: 'b/y.ts', line: 12 })
  assert.deepEqual([third.index, third.place.line], [3, 40], '重复出现在更旧一侧照样会被列出')
  assert.equal(previousChangePlace(changeRing, third.index, { path: 'a/x.ts', line: 40 }), null,
    '游标已在最旧那一格 ⇒ 什么都不做（:483-485）')
})

test('游标 -1 之外还有一件事：新记的改动把游标推回最新之后（:340），下一次按又从最新往旧走', () => {
  const jumped = previousChangePlace(changeRing, 2, { path: 'a/x.ts', line: 30 })
  assert.deepEqual([jumped.index, jumped.place.line], [3, 40], '游标在 2 时只剩更旧的候选')
  const afterEdit = previousChangePlace(changeRing, -1, { path: 'a/x.ts', line: 99 })
  assert.deepEqual([afterEdit.index, afterEdit.place.line], [0, 40], '游标重置后候选又是整条环，第一条不同的就是答案')
})

test('空环与单格环：都拿不到目标，不猜位置', () => {
  assert.equal(previousChangePlace([], -1, null), null, '空环（游标 -1 == ring.length-1）')
  assert.equal(previousChangePlace([{ path: 'a/x.ts', line: 5 }], -1, { path: 'a/x.ts', line: 5 }), null,
    '唯一那一格就是当前位置 ⇒ 没有别的落点')
})

test('接线：游标住在 lspNavigation，记改动时重置、跳转后挪过去', () => {
  const nav = read('src/lspNavigation.ts')
  assert.match(nav, /import \{ locationSnippet, previousChangePlace \} from '\.\/recentLocations\.ts'/, '值 import 必须带扩展名')
  assert.match(nav, /let changeCursor = -1/, '游标是本模块自持的 let（值语义传出去就写不回来）')
  assert.match(nav, /previousChangePlace\(changePlaces\.value/, 'Ctrl+Shift+Backspace 真的走规则层')
  assert.match(nav, /changeCursor = target\.index/, '按一次挪一格（上游 :493）')
  assert.match(nav, /changeCursor = -1\n\s*if \(markdownPreviewOn/, '记一笔改动就重置（上游 :340）')
})
