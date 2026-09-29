import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEADZONE_FOR_TAB_HIDDEN, MIN_TAB_WIDTH, isTabHidden, layoutSingleRow, preferredTabWidth, scrollUnitsToShowTab, toFitLength,
} from '../src/tabStripLayout.ts'

// SingleRowLayoutStrategy.java:22 + :152-154 — the 50px floor is for *editor* tabs only.
test('the minimum tab width applies to editor tabs only', () => {
  assert.equal(MIN_TAB_WIDTH, 50)
  assert.equal(preferredTabWidth(120, true), 120)
  assert.equal(preferredTabWidth(30, true), 50, 'an editor tab is never narrower than the floor')
  assert.equal(preferredTabWidth(30, false), 30, 'a tool-window tab keeps its own size')
  assert.equal(preferredTabWidth(49.6, true), 50, 'the measurement is rounded first')
})

// getToFitLength (:132-150): with no entry-point button the left inset cancels out, so the
// usable length is the strip minus the right inset minus the tab-side toolbar.
test('the usable length is the strip minus the right inset and the side toolbar', () => {
  assert.equal(toFitLength(1000, 8, 8, 0), 992)
  assert.equal(toFitLength(1000, 8, 8, 120), 872)
})

// Nothing overflows: every tab sits where it was told, in order, and there is no more button.
test('tabs that fit are laid out left to right with the gap between them', () => {
  const layout = layoutSingleRow({
    preferredWidths: [100, 120, 80], stripWidth: 1000, moreButtonWidth: 24,
    insetLeft: 4, insetRight: 4, gap: 2,
  })
  assert.equal(layout.moreButtonVisible, false)
  assert.deepEqual(layout.placed.map(t => [t.index, t.position, t.width]), [[0, 4, 100], [1, 106, 120], [2, 228, 80]])
  assert.deepEqual(layout.dropped, [])
  assert.equal(layout.scrollOffset, 0)
  assert.equal(layout.maxScrollOffset, 0)
})

// ScrollableSingleRowLayout.java:60-63 — the button exists exactly when the row overflows.
test('the more button appears exactly when the row overflows', () => {
  const fits = layoutSingleRow({ preferredWidths: [100], stripWidth: 200, moreButtonWidth: 24 })
  assert.equal(fits.moreButtonVisible, false)
  const overflows = layoutSingleRow({ preferredWidths: [300], stripWidth: 200, moreButtonWidth: 24 })
  assert.equal(overflows.moreButtonVisible, true)
})

// applyTabLayout (:119-138): the first tab that no longer fits is clipped to the room that
// is left *after* the more button, and everything after it drops out entirely.
test('the first tab that does not fit is clipped and the rest drop out', () => {
  const layout = layoutSingleRow({
    preferredWidths: [100, 100, 100, 100], stripWidth: 250, moreButtonWidth: 30,
    insetLeft: 0, insetRight: 0, actionInsetRight: 0, gap: 0,
  })
  // fit = 250; the button takes 30, so tabs may use 220. Tab 2 starts at 200 and only 20 is
  // left, so it is clipped to 20 and tab 3 never makes it into the strip.
  assert.equal(layout.toFitLength, 250)
  assert.deepEqual(layout.placed.map(t => [t.index, t.position, t.width, t.clipped]), [
    [0, 0, 100, false], [1, 100, 100, false], [2, 200, 20, true],
  ])
  assert.deepEqual(layout.dropped, [3])
})

// isTabHidden (:139-147): a tab that lost more than the deadzone counts as hidden even
// though it is still drawn. The comparison is `<`, so exactly the deadzone short is not.
test('a clipped tab counts as hidden once it falls past the deadzone', () => {
  // One 100px tab on a 98px strip: it overflows by 2, so the row does show the more button.
  // With an 8px button the clipped width is 98 - 0 - 8 = 90 — exactly the deadzone short.
  const atBoundary = layoutSingleRow({ preferredWidths: [100], stripWidth: 98, moreButtonWidth: 8 })
  const past = layoutSingleRow({ preferredWidths: [100], stripWidth: 98, moreButtonWidth: 9 })
  const boundary = atBoundary.placed[0]
  const beyond = past.placed[0]
  assert.equal(atBoundary.moreButtonVisible, true, 'the row overflows either way')
  assert.equal(boundary.width, 90)
  assert.equal(boundary.hidden, false, 'exactly the deadzone short is not hidden — the source compares with <')
  assert.equal(isTabHidden(boundary, 100), false)
  assert.equal(beyond.width, 89)
  assert.equal(beyond.hidden, true)
  assert.equal(isTabHidden(beyond, 100), true)
  assert.equal(DEADZONE_FOR_TAB_HIDDEN, 10)
})

// The source adds the more button's width *and* the action insets to the reserve
// (:118-123), because there is no entry-point button to account for.
test('the reserve is the button plus the action insets', () => {
  const layout = layoutSingleRow({
    preferredWidths: [100, 100, 100], stripWidth: 250, moreButtonWidth: 30,
    actionInsetLeft: 5, actionInsetRight: 5,
  })
  // fit = 250; reserve = 30 + 5 + 5 = 40, so tabs may use 210: tab 0 at 0..100, tab 1 at
  // 100..200, tab 2 gets 10px and the rest drops.
  assert.deepEqual(layout.placed.map(t => [t.index, t.width]), [[0, 100], [1, 100], [2, 10]])
})

// clampScrollOffsetToBounds (:55-60): max = required - fit + reserve, floored at 0.
test('a fitting strip does not scroll and an overflowing one scrolls by the surplus', () => {
  const fitting = layoutSingleRow({ preferredWidths: [100, 100], stripWidth: 400, moreButtonWidth: 24, scrollOffset: 50 })
  assert.equal(fitting.maxScrollOffset, 0)
  assert.equal(fitting.scrollOffset, 0, 'a request to scroll is clamped away')

  const overflowing = layoutSingleRow({
    preferredWidths: [200, 200], stripWidth: 300, moreButtonWidth: 30, gap: 0,
  })
  // required = 400, fit = 300, reserve = 30 + 0 insets => max = 130.
  assert.equal(overflowing.requiredLength, 400)
  assert.equal(overflowing.maxScrollOffset, 130)
  const scrolled = layoutSingleRow({
    preferredWidths: [200, 200], stripWidth: 300, moreButtonWidth: 30, gap: 0, scrollOffset: 999,
  })
  assert.equal(scrolled.scrollOffset, 130, 'the offset is clamped to the maximum')
})

// SingleRowLayoutStrategy.java:232-242 — for editor tabs the button is pinned to the right
// edge: `x = layoutSize.width - actionsInsets.right - moreRectAxisSize`.
test('the more button is pinned to the right edge of the strip', () => {
  const layout = layoutSingleRow({
    preferredWidths: [400], stripWidth: 300, moreButtonWidth: 30, actionInsetRight: 6,
  })
  assert.equal(layout.moreButtonPosition, 300 - 6 - 30)
})

// SingleRowLayout.java:263 — only editor tabs pay the gap inside the required length, while
// :213 advances by the gap either way; both halves are reproduced as written.
test('the required length charges the gap to editor tabs only', () => {
  const editor = layoutSingleRow({ preferredWidths: [100, 100], stripWidth: 1000, moreButtonWidth: 24, gap: 5, editorTabs: true })
  const tool = layoutSingleRow({ preferredWidths: [100, 100], stripWidth: 1000, moreButtonWidth: 24, gap: 5, editorTabs: false })
  assert.equal(editor.requiredLength, 210)
  assert.equal(tool.requiredLength, 200)
  assert.deepEqual(tool.placed.map(t => t.position), [0, 105], 'the advance still includes the gap')
})

// A strip with no room at all must not produce negative widths.
test('a zero-width strip hides every tab instead of producing negative sizes', () => {
  const layout = layoutSingleRow({ preferredWidths: [100, 100], stripWidth: 0, moreButtonWidth: 24 })
  assert.equal(layout.moreButtonVisible, true)
  assert.deepEqual(layout.placed, [])
  assert.deepEqual(layout.dropped, [0, 1])
})

// 滚到尽头（scrollOffset = maxScrollOffset）时**尾巴必须完整可见**：这是"溢出靠滚动取回"的全部
// 意义所在。上游同款：clampScrollOffsetToBounds 的 max 就是 required - fit + moreRectSize（:55-60）。
test('scrolling to the end brings every tab back into the strip', () => {
  const input = { preferredWidths: [100, 100, 100, 100], stripWidth: 250, moreButtonWidth: 0, gap: 0 }
  const atStart = layoutSingleRow(input)
  assert.deepEqual(atStart.dropped, [3], '不滚就得有标签在窗口外，否则这条测不出什么')
  assert.equal(atStart.maxScrollOffset, 150)
  const atEnd = layoutSingleRow({ ...input, scrollOffset: atStart.maxScrollOffset })
  assert.deepEqual(atEnd.dropped, [], '滚到尽头后一条都不该留在外面')
  // 位置是 `getStartPosition - getScrollOffset`（SingleRowLayout.java:112）：前两条被推到左边缘外。
  assert.deepEqual(atEnd.placed.map(t => [t.position, t.width]), [[-150, 100], [-50, 100], [50, 100], [150, 100]])
  assert.equal(atEnd.placed[3].hidden, false, '最后一条完整可见')
  assert.equal(atEnd.placed[0].hidden, true, '第一条已经滚出左边缘')
})

// doScrollToSelectedTab（ScrollableSingleRowLayout.java:68-103）：返回值就是该交给 scroll() 的 units。
test('the selected tab is scrolled in from either edge, and not at all when it is already visible', () => {
  const widths = [100, 100, 100, 100]
  // 已经落在窗口里：不动。
  assert.equal(scrollUnitsToShowTab({ requiredLengths: widths, index: 1, scrollOffset: 50, toFitLength: 250 }), 0)
  // 滚过头了，选中项的左沿在窗口左边之外 → 把它的左沿贴回左边缘（offset < 0 的那一支）。
  assert.equal(scrollUnitsToShowTab({ requiredLengths: widths, index: 0, scrollOffset: 150, toFitLength: 250 }), -150)
  assert.equal(scrollUnitsToShowTab({ requiredLengths: widths, index: 1, scrollOffset: 150, toFitLength: 250 }), -50)
  // 在右边之外 → 刚好把它右沿贴到窗口右沿（offset + length - maxLength）。
  assert.equal(scrollUnitsToShowTab({ requiredLengths: widths, index: 3, scrollOffset: 0, toFitLength: 250 }), 150)
  // 选中项自己比窗口还宽：不右对齐（那样会把左沿推出去），而是把左沿贴到左边缘（:91-96 的 else）。
  assert.equal(scrollUnitsToShowTab({ requiredLengths: [100, 400], index: 1, scrollOffset: 0, toFitLength: 150 }), 100)
  // 右侧界要减掉「…」那一类的预留（:80-81），预留非 0 时更早就要滚。
  assert.equal(scrollUnitsToShowTab({ requiredLengths: widths, index: 2, scrollOffset: 0, toFitLength: 250, moreReserve: 30 }), 80)
})

// 累加用 getRequiredLength（SingleRowLayout.java:260-264：编辑器标签 = 宽度 + 间距），不是纯宽度。
test('the gap is charged to the tabs before the selected one', () => {
  // 每条 100 + 间距 10：第 3 条从 3*(100+10)=330 起算（源码就是按 requiredLength 累加）。
  const units = scrollUnitsToShowTab({ requiredLengths: [110, 110, 110, 110], index: 3, scrollOffset: 0, toFitLength: 250 })
  assert.equal(units, 330 + 110 - 250)
  // 反证：把间距漏掉的话这里会少滚 30。
  assert.notEqual(units, 300 + 100 - 250)
})
