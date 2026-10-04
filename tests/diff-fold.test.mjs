// diff 查看器的**未更改片段折叠**（上游 `FoldingModelSupport` + `collapse.unchanged.fragments` 开关）。
//
// 上游要点（逐条核过）：
//   · 五档上下文范围 `CONTEXT_RANGE_MODES = intArrayOf(1, 2, 4, 8, -1)`（`TextDiffSettingsHolder.kt:30`），
//     默认 **4**（`:59`），-1 = 禁用（中文包 `DiffBundle.properties:75` = 禁用）；
//   · 每一段未更改的行按 shift = range / 2×range / 4×range 生成三层候选（`FoldingModelSupport.java:1234-1241`），
//     **藏起来不足 2 行就不生成折叠区**（`:310` 的 `ends - starts < 2`）；
//   · 默认展开（`TextDiffSettingsHolder.kt:64` 的 `EXPAND_BY_DEFAULT = true`）；
//   · 开关 `collapse.unchanged.fragments`（中文包 `:63` = 收起未更改的片段）在上下文范围 = 禁用时
//     **整个不可见**（`TextDiffViewerUtil.java:455`）。
//
// 本仓只做"展开 / 折叠"两态，所以只保留上游三层里折叠时实际可见的那一层（最外层，见 `foldForRun`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  COLLAPSE_UNCHANGED_TEXT, CONTEXT_RANGE_DISABLED, CONTEXT_RANGE_LABELS, CONTEXT_RANGE_MODES, DEFAULT_CONTEXT_RANGE,
  allFoldKeys, diffFolds, foldForRun, foldKey, foldLabel, foldRows, unchangedRuns,
} from '../src/diffFold.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

/** 一行：`kind` + 两侧行号，够折叠逻辑用。 */
const row = (kind, no) => ({ kind, left: { no, text: `L${no}` }, right: { no, text: `L${no}` } })
/** 一串同类型的行。 */
const rows = (...kinds) => kinds.map((kind, i) => row(kind, i + 1))

// —— 常量（逐条对上游）——

test('the five context-range modes and the default are upstream values', () => {
  assert.deepEqual([...CONTEXT_RANGE_MODES], [1, 2, 4, 8, -1])
  assert.equal(DEFAULT_CONTEXT_RANGE, 4)
  assert.equal(CONTEXT_RANGE_LABELS[1], '1')
  assert.equal(CONTEXT_RANGE_LABELS[8], '8')
  assert.equal(CONTEXT_RANGE_LABELS[-1], CONTEXT_RANGE_DISABLED)
  assert.equal(CONTEXT_RANGE_DISABLED, '禁用')
})

test('the toggle label is the shipped Chinese one', () => {
  assert.equal(COLLAPSE_UNCHANGED_TEXT, '收起未更改的片段')
})

// —— unchangedRuns ——

test('consecutive equal rows form one run', () => {
  assert.deepEqual(unchangedRuns(rows('equal', 'equal', 'change', 'equal')), [
    { start: 0, end: 2 },
    { start: 3, end: 4 },
  ])
})

test('a document with no unchanged rows has no runs', () => {
  assert.deepEqual(unchangedRuns(rows('insert', 'delete')), [])
  assert.deepEqual(unchangedRuns([]), [])
})

test('a run touching either end of the file is still found', () => {
  assert.deepEqual(unchangedRuns(rows('equal', 'equal', 'delete')), [{ start: 0, end: 2 }])
  assert.deepEqual(unchangedRuns(rows('insert', 'equal', 'equal')), [{ start: 1, end: 3 }])
})

// —— foldForRun ——

test('a run shorter than 2×context+2 has nothing to hide', () => {
  // 上下文 4：藏起来的区间 = [start+4, end-4)，两侧都留 4 行 ⇒ 至少要 10 行才藏得下 2 行。
  assert.equal(foldForRun({ start: 0, end: 9 }, 4), null)
  assert.deepEqual(foldForRun({ start: 0, end: 10 }, 4), { runStart: 0, runEnd: 10, hiddenFrom: 4, hiddenTo: 6 })
})

test('exactly two hidden rows is the smallest fold, as upstream', () => {
  // 上游 `createBlock` 的判据是 `ends - starts < 2` ⇒ 恰好藏 2 行**要**生成折叠区。
  assert.deepEqual(foldForRun({ start: 100, end: 106 }, 2), { runStart: 100, runEnd: 106, hiddenFrom: 102, hiddenTo: 104 })
})

test('the context lines stay visible on both sides', () => {
  const fold = foldForRun({ start: 0, end: 20 }, 4)
  assert.equal(fold.hiddenFrom, 4)
  assert.equal(fold.hiddenTo, 16)
  assert.equal(fold.hiddenFrom - fold.runStart, 4, '上面留 4 行')
  assert.equal(fold.runEnd - fold.hiddenTo, 4, '下面留 4 行')
})

test('a disabled context range never folds', () => {
  assert.equal(foldForRun({ start: 0, end: 1000 }, -1), null)
  assert.deepEqual(diffFolds(rows(...Array(50).fill('equal')), -1), [], '禁用 = 整份没有折叠区')
})

test('larger context ranges hide less', () => {
  const run = { start: 0, end: 40 }
  assert.equal(foldForRun(run, 1).hiddenFrom, 1)
  assert.equal(foldForRun(run, 8).hiddenFrom, 8)
  // 8 档下 [8, 32) 藏 24 行；换 4 档藏得更多。
  assert.ok(foldForRun(run, 8).hiddenTo - foldForRun(run, 8).hiddenFrom < foldForRun(run, 4).hiddenTo - foldForRun(run, 4).hiddenFrom)
})

// —— diffFolds / 折叠状态 ——

test('every foldable run gets one fold, in order', () => {
  const rows20 = [...rows('change'), ...rows(...Array(20).fill('equal')), ...rows('change'), ...rows(...Array(12).fill('equal'))]
  const folds = diffFolds(rows20, 4)
  assert.equal(folds.length, 2)
  assert.deepEqual(folds.map(foldKey), [1, 22])
})

test('collapse-all keys match exactly the folds that can be collapsed', () => {
  const rows20 = [...rows('change'), ...rows(...Array(20).fill('equal'))]
  assert.deepEqual(allFoldKeys(rows20, 4), diffFolds(rows20, 4).map(f => f.runStart))
  assert.deepEqual(allFoldKeys(rows20, -1), [])
})

// —— foldRows ——

test('nothing is hidden while every fold is expanded', () => {
  const rows10 = rows(...Array(10).fill('equal'))
  const items = foldRows(rows10, 4, new Set())
  assert.equal(items.length, 10)
  assert.ok(items.every(item => item.kind === 'row'))
})

test('a collapsed fold becomes a single marker row', () => {
  const rows10 = rows(...Array(10).fill('equal'))
  const items = foldRows(rows10, 4, new Set([0]))
  assert.deepEqual(items.map(item => item.kind), ['row', 'row', 'row', 'row', 'fold', 'row', 'row', 'row', 'row'])
  const marker = items.find(item => item.kind === 'fold')
  assert.equal(marker.hidden, 2, '藏起来 2 行')
  assert.equal(marker.fold.hiddenFrom, 4)
})

test('an expanded fold keeps every row, neighbours untouched', () => {
  const mixed = [...rows('change'), ...rows(...Array(12).fill('equal')), ...rows('insert')]
  const expanded = foldRows(mixed, 4, new Set())
  assert.equal(expanded.length, mixed.length)
  const collapsed = foldRows(mixed, 4, new Set([1]))
  assert.equal(collapsed.filter(i => i.kind === 'fold').length, 1)
  // 第一行与最后一行不受影响（索引与内容都对得上）。
  assert.equal(collapsed[0].row.kind, 'change')
  assert.equal(collapsed[collapsed.length - 1].row.kind, 'insert')
})

test('the marker line numbers are the run start, and the count is the hidden rows', () => {
  const mixed = [...rows('change'), ...rows(...Array(20).fill('equal'))]
  const items = foldRows(mixed, 4, new Set([1]))
  const marker = items.find(item => item.kind === 'fold')
  assert.equal(marker.fold.runStart, 1)
  assert.equal(marker.hidden, 12)
  assert.equal(foldLabel(marker.hidden), '⋯ 12 行未更改 ⋯')
})

test('folding does not touch the diff statistics', () => {
  // 折叠只是显示层：把未更改的行藏起来，增删计数仍按整份差异算（DiffView 的 stats 读 effectiveRows）。
  const mixed = [...rows('insert'), ...rows(...Array(20).fill('equal')), ...rows('delete')]
  const items = foldRows(mixed, 4, new Set([1]))
  const equalRows = items.filter(i => i.kind === 'row' && i.row.kind === 'equal').length
  assert.equal(equalRows, 8, '两侧各留 4 行上下文')
})

// 真机取证时抓到的：存盘冲突那个对话框很窄，标签被挤成竖排（"未更 改的 片段"）。
test('the fold controls never wrap their labels, the toolbar wraps instead', () => {
  const view = read('src/components/DiffView.vue')
  assert.match(view, /\.diff-view \.diff-head \{ flex-wrap: wrap; \}/)
  assert.match(view, /\.diff-folds \{[^}]*white-space: nowrap;/)
  assert.match(view, /\.diff-policy-label, \.diff-fold-toggle > span, \.diff-modes > button \{ white-space: nowrap; \}/)
})

// —— 接线 ——

test('the viewer renders folds and routes the toggle', () => {
  const view = read('src/components/DiffView.vue')
  assert.match(view, /import \{[^}]*foldRows[^}]*\} from '\.\.\/diffFold'/, '折叠逻辑要走模块')
  assert.match(view, /const items = computed\(\(\) => foldRows\(effectiveRows\.value, contextRange\.value, collapsed\.value\)\)/)
  assert.match(view, /foldLabel\(item\.hidden\)/, '标记上要写清藏了多少行')
  assert.match(view, /@click="toggleFold\(foldKey\(item\.fold\)\)"/, '点标记展开')
  assert.match(view, /@click="toggleAll"/, '开关是折叠/展开全部')
})

test('the toggle disappears when the context range is disabled, as upstream', () => {
  const view = read('src/components/DiffView.vue')
  assert.match(view, /const foldsEnabled = computed\(\(\) => contextRange\.value !== -1\)/)
  assert.match(view, /<div v-if="foldsEnabled" class="diff-folds"/, '禁用那一档下整个控件不出现')
  assert.match(view, /v-model\.number="contextRange"/, '五档选择器')
})

test('changing the range or the rows drops the fold state', () => {
  const view = read('src/components/DiffView.vue')
  assert.match(view, /watch\(contextRange, \(\) => \{ collapsed\.value = new Set\(\) \}\)/)
  assert.match(view, /watch\(effectiveRows, \(\) => \{ collapsed\.value = new Set\(\) \}\)/)
})

test('the fold row lines up with the diff rows it replaces', () => {
  const view = read('src/components/DiffView.vue')
  const foldRow = /\.diff-fold-row \{ display: grid; grid-template-columns: 46px minmax\(0, 1fr\) 46px minmax\(0, 1fr\)/
  assert.match(view, foldRow, '折叠行必须与 .diff-line 同一套栅格，否则两侧列错位')
})

// 真机上看出来的：标记行的行号原先写的是"片段起点"，而那几行**明明还显示在上面**（上下文行）——
// 行号槽应该在折叠处跳号，从第一条被藏起来的行开始。
test('the marker carries the first hidden line number, not the run start', () => {
  const view = read('src/components/DiffView.vue')
  assert.match(view, /function hiddenLine\(fold: \{ hiddenFrom: number \}\): number \| '' \{/)
  assert.match(view, /effectiveRows\.value\[fold\.hiddenFrom\]\?\.left\?\.no \?\? ''/)
  assert.match(view, /hiddenLine\(item\.fold\)/)
  assert.ok(!view.includes('item.fold.runStart + 1'), '标记行不能再用片段起点当行号')
})
