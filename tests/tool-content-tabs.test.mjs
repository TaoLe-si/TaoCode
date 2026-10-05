// 工具窗口内容标签条的溢出/滚动（src/toolContentTabs.ts）判据。
//
// 上游 `TabContentLayout` 用"丢弃 + more popup"保证选中项可见（`:222-240` 从两端丢，
// `:284-287` 置 morePopupOffset）；本仓的产品选择是滚动（同编辑器标签条），
// 所以判据钉的是同一套几何的滚动等价物：谁会滚出可视区、选中项要滚到哪、点「…」行能切内容。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MORE_ICON_BORDER, TAB_LAYOUT_START, scrollOffsetFor, tabsOutsideView } from '../src/toolContentTabs.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('上游常量：条首留白 4、more 与最后一格的间距 6（TabContentLayout.java:58-59）', () => {
  assert.equal(TAB_LAYOUT_START, 4)
  assert.equal(MORE_ICON_BORDER, 6)
})

test('可视区外的标签：右边越界的算，左边被滚过去的也算，0 宽的也算（上游 getWidth()==0）', () => {
  const items = [
    { left: 0, width: 100, label: '输出' },
    { left: 100, width: 100, label: '运行' },
    { left: 200, width: 100, label: '问题' },
  ]
  assert.deepEqual(tabsOutsideView(items, 0, 300), [], '全放得下时一个都不该列')
  // 可视 250 宽：第三格右边缘 300 > 250 ⇒ 只在「…」里。
  assert.deepEqual(tabsOutsideView(items, 0, 250), [{ index: 2, label: '问题' }])
  // 滚到 50：第一格左边缘 0 < 50-4 ⇒ 滚出左边也算。
  assert.deepEqual(tabsOutsideView(items, 50, 250).map(tab => tab.label), ['输出'])
  const zero = [{ left: 300, width: 0, label: '被挤掉' }]
  assert.deepEqual(tabsOutsideView(zero, 0, 300), [{ index: 0, label: '被挤掉' }], '宽度归零的必须列出来')
})

test('选中项必须完整可见：左边被压住往前留 4px，右边超出就滚到它贴右边缘', () => {
  const selected = { left: 200, width: 100, label: '问题' }
  // 右边超出：250 宽可视区、滚到 0 时 right=300 ⇒ 滚到 50。
  assert.equal(scrollOffsetFor(selected, 0, 250, 500), 50)
  // 左边被压住：滚到 250 时 selected.left(200) < 250+4 ⇒ 回到 200-4。
  assert.equal(scrollOffsetFor(selected, 250, 250, 500), 196)
  // 已完整可见：不动（不要动不动就抖滚动条）。
  assert.equal(scrollOffsetFor(selected, 20, 400, 500), 20)
  // 夹取：算出来的位置不许越出 [0, maxScroll]。
  assert.equal(scrollOffsetFor(selected, 0, 250, 10), 10)
  assert.equal(scrollOffsetFor({ left: 0, width: 0, label: '' }, 30, 250, 500), 30, '0 宽（被丢弃）不滚')
})

test('App.vue 接线：条上有 ref、有「…」按钮与菜单，且不自己再写一套几何', () => {
  const app = read('src/App.vue')
  assert.ok(app.includes('ref="outputTabsRef" class="output-tabs"'), '内容条没有挂 ref')
  assert.ok(app.includes('useToolContentTabs(outputTabsRef'), '没有接 src/toolContentTabs.ts')
  assert.ok(app.includes('v-if="hiddenOutputTabs.length"'), '没有「…」按钮的显形条件')
  assert.ok(app.includes('v-for="tab in hiddenOutputTabs"'), '「…」菜单没有列出可视区外的内容')
  assert.ok(app.includes('jumpToOutputTab(tab)'), '「…」的行点了不切内容')
  assert.ok(app.includes('aria-haspopup="listbox"'), '「…」没有弹出列表的语义')
  // 语义口径：滚动而不是"丢弃 + more popup"，这一条要在模块注释里说明，别让下一轮当成漏做。
  assert.match(read('src/toolContentTabs.ts'), /本仓的产品选择/, '模块没有写清与上游的差异')
})

test('测量口径：跳过「…」容器自己，别把弹层当内容标签', () => {
  const source = read('src/toolContentTabs.ts')
  assert.ok(source.includes("classList.contains('output-tabs-more')"), '没跳过 more 容器')
  assert.ok(source.includes('offsetLeft'), '没有按 offsetLeft/offsetWidth 量真实盒子')
  assert.ok(source.includes("addEventListener('scroll'"), '滚动时不重算')
  assert.ok(source.includes('ResizeObserver'), '尺寸变化时不重算')
})
