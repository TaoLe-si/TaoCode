// 多行的另外两种排法（B1 §C：`CompressibleMultiRowLayout` / `ScrollableMultiRowLayout`）。
//
// 上游 `EditorTabbedContainer.kt:657-672` 的 `createRowLayout` 是唯一的分派处：
//   !isSingleRow                -> WrapMultiRowLayout        （换行，已有的 layoutMultiRow）
//   UISettings.hideTabsIfNeeded -> ScrollableMultiRowLayout  （滚动排，右边留「…」）
//   else                        -> CompressibleMultiRowLayout（挤压排，只压不换行）
// 默认 `hideTabsIfNeeded = true`（`UISettingsState.kt:125`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MIN_COMPRESSED_TAB_WIDTH, compressRowWidths, decreaseMaxLengths, layoutCompressibleMultiRow, layoutScrollableMultiRow, layoutMultiRow } from '../src/tabStripLayout.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const base = { stripWidth: 300, moreButtonWidth: 0, insetLeft: 0, insetRight: 0, editorTabs: true, gap: 0 }

// —— 挤压排 ——

// `decreaseMaxLengths`（`CompressibleTabsRow.kt:127-166`）：从**最长**的开始降，短的后来才动。
test('compression takes from the longest tabs first', () => {
  const out = decreaseMaxLengths([200, 100, 60], 240)
  assert.ok(out.every(width => width >= MIN_COMPRESSED_TAB_WIDTH), '不许压到下限以下')
  // 短的（60）不该被压，长的（200）必须让出最多。
  assert.equal(out[2], 60, '最短的保持原样')
  assert.ok(out[0] < 200, '最长的被压')
  assert.ok(out[0] >= out[1], '压完之后长的仍不短于短的')
})

test('compression honours the floor', () => {
  const out = decreaseMaxLengths([500, 500, 500], 90)
  assert.deepEqual(out, [MIN_COMPRESSED_TAB_WIDTH, MIN_COMPRESSED_TAB_WIDTH, MIN_COMPRESSED_TAB_WIDTH])
  // 下限**不会把本来就更窄的标签抬高**（抬高会让总长超过预算）：
  // 上游的下限是 `minTabInsets`，恒 ≤ 当前长度；这一条钉住"窄的照旧"。
  const mixed = decreaseMaxLengths([300, 300, 5], 200)
  assert.equal(mixed[2], 5, '比下限还窄的保持原样')
  assert.ok(mixed.reduce((a, b) => a + b, 0) <= 200, '总长不许超过预算')
})

// 预算够宽时不压（上游不会走到，但不能靠调用点活着）。
test('a budget wider than the row is a no-op', () => {
  assert.deepEqual(decreaseMaxLengths([10, 20], 999), [10, 20])
})

// 放得下时**一个像素都不压**（`CompressibleTabsRow.layoutTabs` 的 if 分支）。
test('a row that fits keeps every natural width', () => {
  assert.deepEqual(compressRowWidths([80, 90, 100], 400), [80, 90, 100])
})

// 挤压排是**一行**，不换行 —— 这是它与 WrapMultiRowLayout 的本质差别。
test('the compressible layout never wraps', () => {
  const layout = layoutCompressibleMultiRow({ ...base, preferredWidths: [200, 200, 200, 200, 200] })
  assert.equal(layout.rowCount, 1, '只压不换行')
  assert.equal(layout.placed.length, 5, '每个标签都还在条内')
  assert.equal(layout.placed[0].row, 0)
})

// 溢出与不溢出的差别只在宽度上。
test('a compressible row narrows on overflow but keeps the order', () => {
  // 放得下：一个像素都不压。放不下：等长的三条平摊（`decreaseMaxLengths` 的 avg 分支）。
  const fits = layoutCompressibleMultiRow({ ...base, preferredWidths: [80, 80, 80] })
  const tight = layoutCompressibleMultiRow({ ...base, preferredWidths: [150, 150, 150] })
  assert.deepEqual(fits.placed.map(p => p.width), [80, 80, 80])
  assert.deepEqual(tight.placed.map(p => p.width), [100, 100, 100])
  assert.deepEqual(tight.placed.map(p => p.index), [0, 1, 2], '顺序不变')
  // 位置连续、不重叠。
  for (let i = 1; i < tight.placed.length; i++)
    assert.ok(tight.placed[i].position >= tight.placed[i - 1].position + tight.placed[i - 1].width, '不许重叠')
})

// 固定标签单独成排时是两条挤压排（`CompressibleMultiRowLayout.splitToRows:26-31`）。
test('separate pinned tabs get their own compressible row', () => {
  const layout = layoutCompressibleMultiRow({
    ...base, preferredWidths: [100, 100, 100], pinned: [true, false, false], separatePinnedRow: true,
  })
  assert.equal(layout.rowCount, 2)
  assert.equal(layout.placed[0].row, 0, '固定那条在第一排')
  assert.deepEqual(layout.placed.slice(1).map(p => p.row), [1, 1])
})

// —— 滚动排 ——

// `ScrollableTabsRow.kt:31-36`：放不下才给「…」留位置。
test('the scrollable row only reserves the more button when it overflows', () => {
  const fits = layoutScrollableMultiRow({ ...base, moreButtonWidth: 24, preferredWidths: [80, 80] })
  const over = layoutScrollableMultiRow({ ...base, moreButtonWidth: 24, preferredWidths: [200, 200, 200] })
  assert.equal(fits.maxScrollOffset, 0, '放得下就没有可滚的量')
  assert.ok(over.maxScrollOffset > 0, '放不下才可滚')
})

// 滚动排**没有「…」按钮**：上游 `moreButtonVisible` 只在单行布局里用，这里只是把宽度让出来
// （`data.moreRect` 给了位置，但 New UI 的编辑器标签不画它，见判决与文件头）。
test('the scrollable row reports no more button of its own', () => {
  const layout = layoutScrollableMultiRow({ ...base, moreButtonWidth: 24, preferredWidths: [200, 200, 200] })
  assert.equal(layout.moreButtonVisible, false)
  assert.ok(layout.moreButtonPosition > 0, '但位置要算出来（贴右边缘）')
})

// 滚动排的取回方式：条尾的标签在起点就被右边缘裁掉（`dropped`），滚一点就回来。
// 这正是它与单行裁切排的区别 —— 单行排的尾巴要靠滚轮，滚动排同样能滚，且**没有**「…」按钮。
test('scrolling brings the clipped tail back', () => {
  const widths = [150, 150, 150]
  const start = layoutScrollableMultiRow({ ...base, preferredWidths: widths })
  assert.deepEqual(start.placed.map(p => p.width), [150, 150], '起点只放得下两条')
  assert.deepEqual(start.dropped, [2], '第三条被右边缘裁掉')
  const scrolled = layoutScrollableMultiRow({ ...base, preferredWidths: widths, scrollOffset: 150 })
  assert.deepEqual(scrolled.dropped, [], '滚到上限后三条都在')
  assert.deepEqual(scrolled.placed.map(p => p.width), widths)
  assert.ok(scrolled.scrollOffset <= scrolled.maxScrollOffset, '偏移被夹在上限内')
})

// 偏移越界要被夹回来（`clampScrollOffsetToBounds`）。
test('the scroll offset is clamped to the bounds', () => {
  const far = layoutScrollableMultiRow({ ...base, preferredWidths: [150, 150, 150], scrollOffset: 99999 })
  assert.equal(far.scrollOffset, far.maxScrollOffset)
  const negative = layoutScrollableMultiRow({ ...base, preferredWidths: [150, 150, 150], scrollOffset: -99999 })
  assert.equal(negative.scrollOffset, 0)
})

// 固定标签那一排是**挤压**的（`ScrollableMultiRowLayout.splitToRows:22-29` 用 CompressibleTabsRow）。
test('the pinned row in a scrollable layout is compressed, not scrolled', () => {
  const layout = layoutScrollableMultiRow({
    ...base, preferredWidths: [150, 150, 150], pinned: [true, false, false], separatePinnedRow: true,
  })
  assert.equal(layout.rowCount, 2)
  assert.equal(layout.placed.find(p => p.index === 0)?.row, 0)
  assert.ok(!layout.dropped.includes(0), '固定那条不参与滚动')
})

// 与换行排的区别：换行排不滚动、也没有 dropped。
test('the wrapping layout still has neither scroll nor dropped', () => {
  const wrap = layoutMultiRow({ ...base, preferredWidths: [200, 200, 200] })
  assert.equal(wrap.scrollOffset, 0)
  assert.equal(wrap.placed.length, 3)
})

// —— 接线 ——

test('the view picks the row kind from the two settings', () => {
  const view = read('src/tabStripView.ts')
  assert.match(view, /layoutScrollableMultiRow/, '滚动排要接上')
  assert.match(view, /layoutCompressibleMultiRow/, '挤压排要接上')
  assert.match(view, /hideTabsIfNeeded: \(\) => boolean/, 'deps 里要有这个设置')
})

test('the setting is registered on all four sides', () => {
  assert.match(read('src/settingsModel.ts'), /hideTabsIfNeeded: boolean/)
  assert.match(read('src/settingsModel.ts'), /hideTabsIfNeeded: true/)
  assert.match(read('src/previewSettings.ts'), /hideTabsIfNeeded/)
  assert.match(read('native/settings_schema.hpp'), /hideTabsIfNeeded/)
  assert.match(read('native/settings_schema.cpp'), /\{"hideTabsIfNeeded", true\}/)
})