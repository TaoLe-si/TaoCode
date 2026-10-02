// 弹层位置夹取（src/menuPlacement.ts）的判决测试。
//
// 这条规则是照上游 `AbstractPopup` 定位链的顺序写的：原位 → 放不下翻到锚点另一侧 →
// 两侧都放不下才夹进视口。测的不只是函数返回值，还要把"为什么是这个顺序"钉住 ——
// 简单 `min(y, maxY)` 在下方放得下时结果一样，只有**下方放不下**那一种输入才区分得开，
// 而那恰好就是状态栏组件菜单的常态（菜单锚在窗口底边）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placeMenu } from '../src/menuPlacement.ts'

const VIEWPORT = { width: 1280, height: 900 }
// 状态栏组件菜单的真机实测高度（16 行 × 28px + 标题 + 分隔 + padding，量出来 484）。
const MENU = { width: 190, height: 484 }

test('下方放得下就照锚点原位，不翻', () => {
  const out = placeMenu({ x: 200, y: 100, ...MENU, viewportWidth: VIEWPORT.width, viewportHeight: VIEWPORT.height })
  assert.deepEqual(out, { x: 200, y: 100 })
})

test('下方放不下就翻到锚点上方（状态栏在窗口底边时的常态）', () => {
  // 右键点在状态栏上：clientY ≈ 视口高 - 13。
  const y = VIEWPORT.height - 13
  const out = placeMenu({ x: 200, y, ...MENU, viewportWidth: VIEWPORT.width, viewportHeight: VIEWPORT.height })
  assert.equal(out.y, y - MENU.height - 4, '翻到上方后，菜单底边要离锚点 4px')
  assert.ok(out.y >= 0, '菜单上沿必须在视口内')
  assert.ok(out.y + MENU.height <= VIEWPORT.height, '菜单下沿必须在视口内')
})

test('翻上去仍然放不下（菜单比视口还高）就贴着视口顶', () => {
  const out = placeMenu({ x: 10, y: 900, width: 190, height: 1200, viewportWidth: VIEWPORT.width, viewportHeight: VIEWPORT.height })
  assert.equal(out.y, 4, '夹到 margin，而不是负数')
})

test('水平方向只夹不翻：贴着右边缘右键时菜单左移，不越出右沿', () => {
  const out = placeMenu({ x: 1275, y: 100, ...MENU, viewportWidth: VIEWPORT.width, viewportHeight: VIEWPORT.height })
  assert.equal(out.x, VIEWPORT.width - MENU.width - 4)
  assert.ok(out.x + MENU.width <= VIEWPORT.width)
})

test('贴着左边缘时不会被夹成负数', () => {
  const out = placeMenu({ x: 1, y: 100, ...MENU, viewportWidth: VIEWPORT.width, viewportHeight: VIEWPORT.height })
  assert.equal(out.x, 4)
})

test('视口比菜单还小的时候，坐标仍留在视口内（至少不为负）', () => {
  const out = placeMenu({ x: 0, y: 0, width: 300, height: 400, viewportWidth: 120, viewportHeight: 100 })
  assert.deepEqual(out, { x: 4, y: 4 })
})

test('margin 可以改（默认 4）', () => {
  const y = VIEWPORT.height - 13
  const out = placeMenu({ x: 0, y, ...MENU, viewportWidth: VIEWPORT.width, viewportHeight: VIEWPORT.height, margin: 12 })
  assert.equal(out.y, y - MENU.height - 12)
})

test('不传 margin 时就是 4', () => {
  const y = VIEWPORT.height - 13
  const a = placeMenu({ x: 0, y, ...MENU, viewportWidth: VIEWPORT.width, viewportHeight: VIEWPORT.height })
  const b = placeMenu({ x: 0, y, ...MENU, viewportWidth: VIEWPORT.width, viewportHeight: VIEWPORT.height, margin: 4 })
  assert.deepEqual(a, b)
})