// 差异视图内部查找（上游 `SearchInDiffChangesProvider` / `ToggleSearchInChangesAction` /
// `combined/search/*`）的纯逻辑判据：单元格摊平、改动侧判定、命中收集（四档选项）、
// 回绕导航、片段合成、折叠展开。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_DIFF_SEARCH_OPTIONS, DIFF_SEARCH_MATCHES_LIMIT, changedSide, collectDiffMatches,
  diffSearchCells, foldToExpand, highlightPieces, nextDiffMatchIndex,
} from '../src/diffSearch.ts'

const row = (kind, left, right, leftMarks, rightMarks) => ({
  kind,
  left: left === null ? undefined : { no: 1, text: left },
  right: right === null ? undefined : { no: 1, text: right },
  leftMarks, rightMarks,
})

// 一份小差异：equal / change / insert / delete 四种行都有。
const ROWS = [
  row('equal', 'alpha beta', 'alpha beta'),
  row('change', 'const foo = 1', 'const foo = 2'),
  row('insert', null, 'let baz = 3'),
  row('delete', 'removed line', null),
]

test('四档选项默认全关，命中上限照 LivePreviewController.MATCHES_LIMIT', () => {
  assert.deepEqual(DEFAULT_DIFF_SEARCH_OPTIONS, { caseSensitive: false, wholeWords: false, regex: false, inChanges: false })
  assert.equal(DIFF_SEARCH_MATCHES_LIMIT, 10000, 'LivePreviewController.java:42')
})

test('改动侧判定与行号/高亮同源', () => {
  assert.equal(changedSide('change', 'left'), true)
  assert.equal(changedSide('change', 'right'), true)
  assert.equal(changedSide('insert', 'right'), true)
  assert.equal(changedSide('insert', 'left'), false)
  assert.equal(changedSide('delete', 'left'), true)
  assert.equal(changedSide('delete', 'right'), false)
  assert.equal(changedSide('equal', 'left'), false)
})

test('单元格摊平：有文本的侧才进，左先右后', () => {
  const cells = diffSearchCells(ROWS)
  assert.deepEqual(cells.map(c => [c.row, c.side, c.changed]), [
    [0, 'left', false], [0, 'right', false],
    [1, 'left', true], [1, 'right', true],
    [2, 'right', true],
    [3, 'left', true],
  ])
})

test('收集命中：默认全表，含两侧', () => {
  const matches = collectDiffMatches(ROWS, 'foo', DEFAULT_DIFF_SEARCH_OPTIONS)
  assert.deepEqual(matches.map(m => [m.row, m.side]), [[1, 'left'], [1, 'right']])
  assert.deepEqual(matches.map(m => m.from), [6, 6], '两处都在同一列偏移（同前缀）')
})

test('收集命中：inChanges 只收改动的那一侧', () => {
  // `alpha` 只出现在 equal 行 —— 开「仅在改动中」应当一个都不剩。
  assert.equal(collectDiffMatches(ROWS, 'alpha', DEFAULT_DIFF_SEARCH_OPTIONS).length, 2)
  assert.equal(collectDiffMatches(ROWS, 'alpha', { ...DEFAULT_DIFF_SEARCH_OPTIONS, inChanges: true }).length, 0)
  // `baz` 只在 insert 的右侧（改动侧）——两种档位都收得到。
  assert.deepEqual(
    collectDiffMatches(ROWS, 'baz', { ...DEFAULT_DIFF_SEARCH_OPTIONS, inChanges: true }).map(m => [m.row, m.side]),
    [[2, 'right']],
  )
})

test('收集命中：大小写 / 全词 / 正则三档走编辑器查找的同一套语义', () => {
  assert.equal(collectDiffMatches(ROWS, 'alpha', DEFAULT_DIFF_SEARCH_OPTIONS).length, 2)
  assert.equal(collectDiffMatches(ROWS, 'ALPHA', DEFAULT_DIFF_SEARCH_OPTIONS).length, 2, '默认不区分大小写')
  assert.equal(collectDiffMatches(ROWS, 'ALPHA', { ...DEFAULT_DIFF_SEARCH_OPTIONS, caseSensitive: true }).length, 0)
  // 全词：`alph` 不是词 —— 全词档下 0 条。
  assert.equal(collectDiffMatches(ROWS, 'alph', DEFAULT_DIFF_SEARCH_OPTIONS).length, 2)
  assert.equal(collectDiffMatches(ROWS, 'alph', { ...DEFAULT_DIFF_SEARCH_OPTIONS, wholeWords: true }).length, 0)
  // 正则：`const|let` 命中 change 的两侧 + insert 的右侧。
  assert.deepEqual(
    collectDiffMatches(ROWS, 'const|let', { ...DEFAULT_DIFF_SEARCH_OPTIONS, regex: true }).map(m => [m.row, m.side]),
    [[1, 'left'], [1, 'right'], [2, 'right']],
  )
})

test('坏正则不抛异常，返回空集（由调用方显示「错误模式」）', () => {
  assert.deepEqual(collectDiffMatches(ROWS, '([', { ...DEFAULT_DIFF_SEARCH_OPTIONS, regex: true }), [])
  assert.deepEqual(collectDiffMatches(ROWS, '', DEFAULT_DIFF_SEARCH_OPTIONS), [])
})

test('命中上限按参数截断，不越界', () => {
  const many = [row('change', 'aaaa', 'aaaa')]
  assert.equal(collectDiffMatches(many, 'a', DEFAULT_DIFF_SEARCH_OPTIONS, 3).length, 3)
  assert.equal(collectDiffMatches(many, 'a', DEFAULT_DIFF_SEARCH_OPTIONS, 0).length, 0)
})

test('导航回绕：还没定位时向前取第一、向后取最后；两端回绕', () => {
  assert.equal(nextDiffMatchIndex(3, -1, true), 0)
  assert.equal(nextDiffMatchIndex(3, -1, false), 2)
  assert.equal(nextDiffMatchIndex(3, 0, true), 1)
  assert.equal(nextDiffMatchIndex(3, 2, true), 0, '最后一条再向前回绕到第一条')
  assert.equal(nextDiffMatchIndex(3, 0, false), 2)
  assert.equal(nextDiffMatchIndex(0, -1, true), -1, '没有命中时不动')
})

test('片段合成：词级高亮 + 查找命中不重叠，当前命中可区分', () => {
  const pieces = highlightPieces('const foo = 1', [[6, 3]], [{ from: 0, to: 5 }, { from: 6, to: 9, current: true }])
  assert.deepEqual(pieces, [
    { text: 'const', word: false, search: true, current: false },
    { text: ' ', word: false, search: false, current: false },
    { text: 'foo', word: true, search: true, current: true },
    { text: ' = 1', word: false, search: false, current: false },
  ])
  // 拼回去必须逐字等于原文（渲染层最要紧的性质）。
  assert.equal(pieces.map(p => p.text).join(''), 'const foo = 1')
})

test('片段合成沿用词级标记的容错：越界/零长/重叠标记丢掉，文本仍完整', () => {
  const text = 'abcdef'
  const pieces = highlightPieces(text, [[5, 9], [6, 1], [0, 0], [7, 2]], [])
  assert.equal(pieces.map(p => p.text).join(''), text)
  assert.deepEqual(pieces, [{ text: 'abcdef', word: false, search: false, current: false }], '越界与零长标记全丢')
  const overlapping = highlightPieces(text, [[3, 2], [2, 2], [0, 1]], [])
  assert.equal(overlapping.map(p => p.text).join(''), text)
  assert.deepEqual(overlapping.map(p => [p.text, p.word]), [['abc', false], ['de', true], ['f', false]],
    '先到的标记生效，落在它前面/与之重叠的后到者丢掉（与渲染层原实现一致）')
  const ok = highlightPieces(text, [[0, 3]], [])
  assert.equal(ok.map(p => p.text).join(''), text)
  assert.deepEqual(ok.map(p => p.word), [true, false])
})

test('跳进被折叠的命中：返回要展开的折叠键', () => {
  const folds = [{ runStart: 10, hiddenFrom: 14, hiddenTo: 30 }, { runStart: 40, hiddenFrom: 44, hiddenTo: 50 }]
  assert.equal(foldToExpand(folds, 13), null, '折叠区外不动')
  assert.equal(foldToExpand(folds, 14), 10)
  assert.equal(foldToExpand(folds, 29), 10)
  assert.equal(foldToExpand(folds, 30), null, '半开区间，末端不算')
  assert.equal(foldToExpand(folds, 45), 40)
})
