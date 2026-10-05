// `AbstractPopup` 的三条命名定位变体（src/popupPlacement.ts）与**谁在用**。
//
// 之前的缺口：夹取（placeMenu）与实测（usePopupAnchor）都落了，但三张弹层各自又写了一遍
// `Math.min(y, innerHeight - 行数 * 26)` 这种按行数猜高度的近似。上游的语义是：
//   · showUnderneathOf  = 组件 BOTTOM_LEFT + (2, 0)   （AbstractPopup.java:770-773）
//   · showInCenterOf    = 容器可见区中心减半个弹层     （:668-678 的 getCenterOf/UIUtil）
//   · showInBestPositionFor = 光标优先，否则焦点居中    （:894-897 / :900-905）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  UNDERNEATH_OFFSET_X, bestPositionFor, centerOf, placeCenteredIn, placeUnderneath, pointUnderneathOf,
} from '../src/popupPlacement.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('showUnderneathOf：组件底边左角 + 2px（不是 row 数/常量猜的）', () => {
  const component = { x: 100, y: 50, width: 80, height: 20 }
  assert.deepEqual(pointUnderneathOf(component), { x: 102, y: 70 })
  assert.equal(UNDERNEATH_OFFSET_X, 2, 'JBUIScale.scale(2) 的 DOM 等价物')
})

test('showInCenterOf：容器中心减去半个弹层（getCenterOf 的公式）', () => {
  const container = { x: 0, y: 0, width: 1000, height: 600 }
  assert.deepEqual(centerOf(container, { width: 260, height: 200 }), { x: 370, y: 200 })
  // 奇数差：先减再除，与 UIUtil.getCenterPoint 的整数语义一致（不四舍五入）。
  assert.deepEqual(centerOf(container, { width: 261, height: 201 }), { x: 369.5, y: 199.5 })
})

test('showInBestPositionFor：有光标用光标底边，没光标用容器居中', () => {
  const container = { x: 0, y: 0, width: 800, height: 600 }
  assert.deepEqual(bestPositionFor({ caret: { x: 12, y: 30, width: 2, height: 16 }, container }, { width: 100, height: 100 }), { x: 12, y: 46 })
  assert.deepEqual(bestPositionFor({ caret: null, container }, { width: 100, height: 100 }), { x: 350, y: 250 })
})

test('placeUnderneath / placeCenteredIn 都过 placeMenu 的夹取（不越出视口）', () => {
  const viewport = { x: 0, y: 0, width: 300, height: 200 }
  const bottom = placeUnderneath({ x: 280, y: 190, width: 40, height: 20 }, { width: 240, height: 100 }, viewport)
  assert.ok(bottom.x >= 4 && bottom.x + 240 <= 300, `x 越界：${bottom.x}`)
  assert.ok(bottom.y >= 4 && bottom.y + 100 <= 200, `y 越界：${bottom.y}`)
  const centered = placeCenteredIn({ x: 0, y: 0, width: 20, height: 20 }, { width: 240, height: 100 }, viewport)
  assert.ok(centered.x >= 4 && centered.x + 240 <= 300, `居中也不能越界：${centered.x}`)
  assert.ok(centered.y >= 4 && centered.y + 100 <= 200, `居中也不能越界：${centered.y}`)
})

test('三张弹层都改走 useBestPositionAnchor，不再按行数/常数猜高度', () => {
  for (const file of ['src/components/SelectInPopup.vue', 'src/components/TargetChooserPopup.vue', 'src/components/QuickDefinitionPopup.vue']) {
    const source = read(file)
    assert.ok(source.includes('useBestPositionAnchor'), `${file} 没接 src/popupPlacement.ts`)
    assert.doesNotMatch(source, /innerHeight - \d+/, `${file} 还留着按常数猜的高度`)
    assert.doesNotMatch(source, /rows\.length \* 26/, `${file} 还按行数乘 26 猜高度`)
    assert.doesNotMatch(source, /Math\.min\(props\.(x|y)/, `${file} 还在自己夹取坐标`)
  }
})

test('usePopupAnchor 的 fallback 拿得到实测尺寸（居中的前提）', () => {
  const source = read('src/popupAnchor.ts')
  assert.match(source, /fallback\?\.\(\{ width: 0, height: 0 \}\)/, '首帧没有尺寸的粗落点没了')
  assert.match(source, /const settled = direct \?\? fallback\?\.\(rect\)/, '量到盒子后没有按真实尺寸重算落点')
})
