// 搜索结果面板的键盘选择（上游 `FindPopupPanel.java:830` 的 ScrollingUtil + `:842-856` 的 F3 两条）。
//
// 上游两套语义都要钉住：
//   · JTable（cycleScrolling=false，`ScrollingUtil.java:461-566`）：Home/End 首末行；PageUp/PageDown
//     步长 `visible - 1` 且两端夹住；Up/Down 到端**不动**；
//   · FindNext/FindPrevious（`:842-856`）：`< rowCount-1` 才 +1、`> 0` 才 -1，不回绕。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { navTarget, pageStep, RESULT_ROW_HEIGHT, resultsNavKeyOf } from '../src/findResultsNav.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('Home and End jump to the first and last row', () => {
  assert.equal(navTarget('Home', -1, 10, 5), 0)
  assert.equal(navTarget('Home', 7, 10, 5), 0)
  assert.equal(navTarget('End', -1, 10, 5), 9)
  assert.equal(navTarget('End', 0, 10, 5), 9)
  assert.equal(navTarget('Home', 0, 0, 5), null, '空表不动')
})

test('PageUp/PageDown use visible - 1 and clamp at both ends', () => {
  assert.equal(pageStep(6), 5, 'ScrollingUtil.movePageDown 的 step = visible - 1')
  assert.equal(navTarget('PageDown', 0, 100, 6), 5)
  assert.equal(navTarget('PageDown', 95, 100, 6), 99, '尾端夹住')
  assert.equal(navTarget('PageUp', 5, 100, 6), 0, '首端夹住')
  // 还没选过：getMinSelectionIndex() 是 -1 ⇒ PageDown 落在 -1 + step，PageUp 夹到 0。
  assert.equal(navTarget('PageDown', -1, 100, 6), 4)
  assert.equal(navTarget('PageUp', -1, 100, 6), 0)
  assert.equal(navTarget('PageUp', -1, 100, 1), 0, 'step 为 0 时也不越界')
})

test('ArrowDown/ArrowUp move one row and stop at the ends (cycleScrolling=false)', () => {
  assert.equal(navTarget('ArrowDown', -1, 3, 5), 0, '无选择时向下选第一条')
  assert.equal(navTarget('ArrowDown', 0, 3, 5), 1)
  assert.equal(navTarget('ArrowDown', 2, 3, 5), null, '到端不动（不循环）')
  assert.equal(navTarget('ArrowUp', 0, 3, 5), null)
  assert.equal(navTarget('ArrowUp', 2, 3, 5), 1)
  assert.equal(navTarget('ArrowUp', -1, 3, 5), null)
})

test('FindNext/FindPrevious never wrap', () => {
  assert.equal(navTarget('FindNext', -1, 3, 5), 0)
  assert.equal(navTarget('FindNext', 1, 3, 5), 2)
  assert.equal(navTarget('FindNext', 2, 3, 5), null, 'FindPopupPanel.java:843 的 selectedRow < rowCount - 1')
  assert.equal(navTarget('FindPrevious', 0, 3, 5), null, ':849 的 selectedRow > 0')
  assert.equal(navTarget('FindPrevious', 2, 3, 5), 1)
})

test('the keyboard event map covers exactly the upstream keys', () => {
  assert.equal(resultsNavKeyOf({ key: 'Home', shiftKey: false }), 'Home')
  assert.equal(resultsNavKeyOf({ key: 'End', shiftKey: true }), 'End')
  assert.equal(resultsNavKeyOf({ key: 'PageUp', shiftKey: false }), 'PageUp')
  assert.equal(resultsNavKeyOf({ key: 'PageDown', shiftKey: false }), 'PageDown')
  assert.equal(resultsNavKeyOf({ key: 'ArrowUp', shiftKey: false }), 'ArrowUp')
  assert.equal(resultsNavKeyOf({ key: 'ArrowDown', shiftKey: false }), 'ArrowDown')
  assert.equal(resultsNavKeyOf({ key: 'F3', shiftKey: false }), 'FindNext')
  assert.equal(resultsNavKeyOf({ key: 'F3', shiftKey: true }), 'FindPrevious')
  assert.equal(resultsNavKeyOf({ key: 'a', shiftKey: false }), null)
  assert.ok(RESULT_ROW_HEIGHT > 0)
})

test('SearchPanel wires the keys on the list and both fields', () => {
  const panel = read('src/components/SearchPanel.vue')
  assert.match(panel, /import \{[^}]*navTarget[^}]*\} from '\.\.\/findResultsNav'/)
  assert.match(panel, /resultsNavKeyOf\(event\)/, '列表上要认这些键')
  assert.match(panel, /@keydown="onFieldKeydown\(\$event, 'find'\)"/, '搜索框上的 F3 也要管（FindPopupPanel.java:842-856）')
  assert.match(panel, /@keydown="onFieldKeydown\(\$event, 'replace'\)"/, '替换框同上')
  assert.match(panel, /scrollIntoView\(\{ block: 'nearest' \}\)/, '跳转要滚动到可见')
})
