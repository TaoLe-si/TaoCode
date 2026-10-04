// 多行标签条「固定标签单独成排」的判据（IDEA `WrapMultiRowLayout` + `MultiRowLayout.splitToPinnedUnpinned`）。
//
// 上游：`MultiRowLayout.kt:105-120` `splitToPinnedUnpinned`（找**最后一个**固定标签，它含之前算固定排；
// 其后那一项若是拖放占位则一并划过去）、`WrapMultiRowLayout.kt:24-45`（固定排先加进 rows，
// 未固定的从新一排排起）、`TabLayout.java:75-78` `showPinnedTabsSeparately()`
// = `UISettingsState.showPinnedTabsInASeparateRow`（`UISettingsState.kt:127` 默认 false）
// **且** 高级设置 `editor.keep.pinned.tabs.on.left`（`intellij.platform.ide.impl.xml:1514` 默认 true）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_PINNED_TAB_WIDTH, layoutMultiRow, preferredTabWidth, showsPinnedTabsSeparately, splitPinnedRow } from '../src/tabStripLayout.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const strip = (over = {}) => ({
  preferredWidths: [100, 100, 100, 100], stripWidth: 250, moreButtonWidth: 0,
  sideToolbarMinWidth: 0, insetLeft: 0, insetRight: 0, editorTabs: true, gap: 0, rowHeight: 30, ...over,
})

test('固定排的分界是**最后一个**固定标签（上游 indexOfLast 而不是第一个）', () => {
  assert.deepEqual(splitPinnedRow([true, true, false, false]), { pinnedCount: 2, hasPinned: true })
  // 固定标签在中间也要按"最后一个"划：前两个（含中间那个固定的）都算固定排。
  assert.deepEqual(splitPinnedRow([true, false, true, false]), { pinnedCount: 3, hasPinned: true })
  assert.deepEqual(splitPinnedRow([false, false]), { pinnedCount: 0, hasPinned: false })
  assert.deepEqual(splitPinnedRow([]), { pinnedCount: 0, hasPinned: false })
})

test('两个开关都开才分行（TabLayout.showPinnedTabsSeparately）', () => {
  assert.equal(showsPinnedTabsSeparately(true, true), true)
  assert.equal(showsPinnedTabsSeparately(false, true), false, '设置页那条默认 false')
  assert.equal(showsPinnedTabsSeparately(true, false), false, '高级设置那条关掉就不分')
  assert.equal(showsPinnedTabsSeparately(false, false), false)
})

test('开启后：固定标签在同一条 0 排，未固定项另起一排', () => {
  const layout = layoutMultiRow(strip({
    preferredWidths: [100, 100, 100], stripWidth: 500,
    pinned: [true, true, false], separatePinnedRow: true,
  }))
  assert.deepEqual(layout.placed.map(tab => tab.row), [0, 0, 1], '固定两个在第 0 排，未固定的那个到第 1 排')
  assert.equal(layout.rowCount, 2)
})

test('关闭时保持连续排布（本仓原来的行为，不能静默改变）', () => {
  const layout = layoutMultiRow(strip({
    preferredWidths: [100, 100, 100], stripWidth: 500,
    pinned: [true, true, false], separatePinnedRow: false,
  }))
  assert.deepEqual(layout.placed.map(tab => tab.row), [0, 0, 0], '不开启就被宽度自然决定，不因 pin 而分段')
})

test('宽度仍然决定换行：固定排自己放不下时也换行', () => {
  // 条宽 250、每个 200 ⇒ 一行只放得下一个：两个固定的各占一排，未固定的再起一排。
  const layout = layoutMultiRow(strip({
    preferredWidths: [200, 200, 100], stripWidth: 250,
    pinned: [true, true, false], separatePinnedRow: true,
  }))
  assert.deepEqual(layout.placed.map(tab => tab.row), [0, 1, 2], '放不下就换行，固定排也不例外')
})

test('没有固定标签时与关闭该开关等价（不凭空多出一排）', () => {
  const withFlag = layoutMultiRow(strip({ preferredWidths: [100, 100], stripWidth: 500, pinned: [false, false], separatePinnedRow: true }))
  const without = layoutMultiRow(strip({ preferredWidths: [100, 100], stripWidth: 500, pinned: [false, false], separatePinnedRow: false }))
  assert.deepEqual(withFlag.placed.map(tab => tab.row), without.placed.map(tab => tab.row))
  assert.deepEqual(withFlag.placed.map(tab => tab.row), [0, 0])
})

test('接线：设置键三处登记 + 设置页复选框 + 视图把 pinned 传给布局', () => {
  assert.match(read('src/settingsModel.ts'), /pinnedTabsInSeparateRow: false,/, '默认值必须是 false（UISettingsState.kt:127）')
  assert.match(read('src/settingsModel.ts'), /pinnedTabsInSeparateRow: boolean;/, '缺类型声明')
  assert.match(read('src/previewSettings.ts'), /key === 'pinnedTabsInSeparateRow'/, '预览态白名单没放行')
  assert.match(read('native/settings_schema.cpp'), /\{"pinnedTabsInSeparateRow", false\}/, '原生默认值没登记')
  assert.match(read('native/settings_schema.hpp'), /"pinnedTabsInSeparateRow",/, '原生布尔键表没登记')
  // 编辑器标签页那一页已拆成独立组件（`SettingsDialog.vue` 贴着机检上限）。
  const settings = read('src/components/EditorTabsSettingsPage.vue')
  assert.match(settings, /v-model="settings\.pinnedTabsInSeparateRow"/, '设置页没有这一条')
  assert.match(settings, /在单独一行中显示固定标签/, '文案缺失（ApplicationBundle.properties:324）')
  assert.match(read('src/components/SettingsDialog.vue'), /<EditorTabsSettingsPage/, '宿主没挂上那一页')
  const view = read('src/tabStripView.ts')
  assert.match(view, /pinned: tabs\.map\(\(tab: Tab\) => Boolean\(tab\.pinned\)\)/, '视图没把 pinned 传给布局')
  assert.match(view, /separatePinnedRow: separatePinnedRow\(\)/, '视图没把开关传下去')
  assert.match(read('src/App.vue'), /separatePinnedRow: \(\) => editorSettings\.value\.pinnedTabsInSeparateRow/, '宿主没读设置')
})

test('固定标签有宽度上限（TabLabel.getPreferredSize 的 isPinned 分支）', () => {
  assert.equal(preferredTabWidth(3000, true, true), MAX_PINNED_TAB_WIDTH, '超过 2000 就夹到 2000')
  assert.equal(preferredTabWidth(3000, true, false), 3000, '没固定就不夹')
  assert.equal(preferredTabWidth(120, true, true), 120, '没到上限就照原样')
  // 下限与上限同时在场时都要生效（固定标签也守 50px 那条地板）。
  assert.equal(preferredTabWidth(30, true, true), 50)
  assert.equal(MAX_PINNED_TAB_WIDTH, 2000, 'registry.properties:169 = 2000')
})

test('接线：视图按 pinned 传进宽度计算', () => {
  assert.match(read('src/tabStripView.ts'), /preferredTabWidth\(natural, true, Boolean\(tab\.pinned\)\)/,
    '视图没把 pinned 传给宽度计算')
})
