// 滚动排（`ScrollableMultiRowLayout` + `ScrollableTabsRow`）与**固定排**一起用时，本轮修掉的两个真缺陷。
//
// 上游形状（`MultiRowLayout.kt:105-120` 的 `splitToPinnedUnpinned` +
// `ScrollableMultiRowLayout.kt:22-29`）：
//   · 固定标签归第一排，未固定标签进第二排；
//   · 第一排是**挤压排**（`CompressibleTabsRow`），第二排才是可滚动的（`ScrollableTabsRow`）；
//   · 第二排的 `dropped` / `placed` 记的都是**条内下标**（渲染层拿它跟标签的真实下标比）。
//
// 本仓在 `src/tabStripLayout.ts` 的 `scrollableRow` 里按 `base + index` 记 `placed`，
// 却把 `dropped` 记成了**排内局部下标** —— 两个下标轴不一致：
//   · 固定排开着时，第二排的第一条被挤出可视区记成局部 0，渲染层会把**第 0 条（固定标签）**
//     当成掉出条外写成 0 宽，而真正该藏的标签还占着位置；
//   · 全部都是固定标签时，`layoutScrollableMultiRow` 仍无条件拼一条恒空的滚动行，
//     条高凭空多出一整行。
// 这两条只有"固定标签 + 挤压/滚动排"同时出现时才显形，所以单独钉一份判据。
import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutScrollableMultiRow, layoutCompressibleMultiRow, splitPinnedRow } from '../src/tabStripLayout.ts'

test('dropped 记的是条内下标，不会把固定排的标签误藏', () => {
  // 固定两条 200；未固定 500 + 300，条宽 500、给「…」留 40。
  // 未固定排：放不下（800 > 500）⇒ tabsLength = 460；第一条裁到 460，第二条整条挤出可视区。
  const layout = layoutScrollableMultiRow({
    preferredWidths: [200, 200, 500, 300],
    pinned: [true, true, false, false],
    separatePinnedRow: true,
    stripWidth: 500,
    moreButtonWidth: 40,
  })
  assert.deepEqual(layout.dropped, [3], '被挤出的是未固定排的第二条（条内下标 3）')
  assert.deepEqual(layout.placed.map(entry => entry.index), [0, 1, 2], '固定两条 + 未固定第一条在条内')
  assert.equal(layout.placed.find(entry => entry.index === 0)?.width, 200, '固定标签保持自己的宽度')
  assert.equal(layout.placed.find(entry => entry.index === 1)?.width, 200, '固定标签保持自己的宽度')
  assert.equal(layout.placed.find(entry => entry.index === 2)?.width, 460, '第一条未固定标签裁到可视宽')
  assert.equal(layout.rowCount, 2, '固定一排 + 可滚动一排')
})

test('没有固定标签时 dropped 仍是全局下标（base = 0）', () => {
  const layout = layoutScrollableMultiRow({
    preferredWidths: [500, 300],
    stripWidth: 500,
    moreButtonWidth: 40,
  })
  assert.deepEqual(layout.dropped, [1], '第一条裁 460、第二条挤出')
  assert.deepEqual(layout.placed.map(entry => entry.index), [0])
})

test('全是固定标签时不再拼一条恒空的第二排', () => {
  const layout = layoutScrollableMultiRow({
    preferredWidths: [100, 100],
    pinned: [true, true],
    separatePinnedRow: true,
    stripWidth: 400,
    moreButtonWidth: 40,
  })
  assert.equal(layout.rowCount, 1, '只有固定那一排（上游 splitToRows 不会产出空 row）')
  assert.deepEqual(layout.dropped, [])
  assert.equal(layout.maxScrollOffset, 0, '没有可滚动的行')
  assert.deepEqual(layout.placed.map(entry => entry.index), [0, 1])
  assert.equal(layout.rowHeight > 0, true)
})

test('全固定 + 挤压排同样只有一排（两条路的口径一致）', () => {
  const layout = layoutCompressibleMultiRow({
    preferredWidths: [100, 100],
    pinned: [true, true],
    separatePinnedRow: true,
    stripWidth: 400,
  })
  assert.equal(layout.rowCount, 1)
  assert.deepEqual(layout.placed.map(entry => entry.index), [0, 1])
})

test('固定排在滚动排里照样是挤压的（上游第一排用 CompressibleTabsRow）', () => {
  const layout = layoutScrollableMultiRow({
    preferredWidths: [400, 400, 300],
    pinned: [true, true, false],
    separatePinnedRow: true,
    stripWidth: 500,
    moreButtonWidth: 40,
  })
  // 固定排 800 > 500 ⇒ 两条各压到 250（从最长开始降，这里等长）。
  assert.deepEqual(layout.placed.filter(entry => entry.row === 0).map(entry => entry.width), [250, 250])
  assert.equal(layout.rowCount, 2)
})

test('splitPinnedRow 只管最后一个固定项的位置（未固定的从它之后起）', () => {
  assert.deepEqual(splitPinnedRow([true, false, true, false]), { pinnedCount: 3, hasPinned: true })
  assert.deepEqual(splitPinnedRow([false, false]), { pinnedCount: 0, hasPinned: false })
})
