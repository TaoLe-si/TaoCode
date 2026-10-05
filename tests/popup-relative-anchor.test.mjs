// 「贴着**另一个浮层**摆位」的接线 —— `src/popupAnchor.ts` 新增的那一支
// （`resolveRelativeAnchor` / `useRelativePopupAnchor`）。
//
// 这一支是把上游 `PopupPositionManager.positionPopupInBestPosition`（`:44-86`）的两档分派
// 接到 DOM 侧：`src/popupPosition.ts` 给几何，`src/popupSteps.ts` 的 `PopupShowOptions`
// 给显示选项，落位按**实测尺寸**算（`:56/70` 的 `PopupImplUtil.getPopupSize`）。
//
// 钉的是两档分派的差别：给了显示选项走「请求点」那一档（`WizardPopup.java:237-250` 那一支），
// 不给就走 `PositionAdjuster.adjustBounds` 的四点遍历（`:220-271`）。两档的落点不一样，
// 混起来就会在「弹层压在父浮层上」时表现不一致。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRelativeAnchor } from '../src/popupAnchor.ts'
import { aboveComponent, belowComponent } from '../src/popupSteps.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const PARENT = { x: 100, y: 100, width: 200, height: 300 }
const VIEWPORT = { x: 0, y: 0, width: 1000, height: 800 }
const SIZE = { width: 100, height: 50 }

test('不给显示选项 ⇒ 走 adjustBounds 的四点遍历：右边放得下就贴右边', () => {
  const point = resolveRelativeAnchor({ relative: PARENT, size: SIZE, viewport: VIEWPORT })
  assert.deepEqual(point, { x: 305, y: 100 }, '100 + 200 + 缝 5')
})

test('不给显示选项 ⇒ 右边放不下时翻到左边（遍历顺序 右/左/上/下）', () => {
  const point = resolveRelativeAnchor({
    relative: { x: 900, y: 400, width: 50, height: 20 },
    size: SIZE,
    viewport: VIEWPORT,
  })
  assert.deepEqual(point, { x: 795, y: 400 }, '900 − 缝 5 − 100')
})

test('给了显示选项 ⇒ 走「请求点」那一档，缝按 PopupShowOptions 的那一档（下面 0 / 上面 4）', () => {
  // belowComponent（PopupShowOptions.kt:84-91）没设缝 ⇒ 0；弹层顶边就贴在父浮层下缘。
  assert.deepEqual(
    resolveRelativeAnchor({ relative: PARENT, size: SIZE, viewport: VIEWPORT, showOptions: belowComponent() }),
    { x: 100, y: 400 },
    '父浮层高 300，bottom-left 角在 y=400，缝 0 ⇒ 落点就是 (100, 400)')
  // aboveComponent（:56-64）缝 4 ⇒ 弹层底边离父浮层上缘 4。
  assert.deepEqual(
    resolveRelativeAnchor({ relative: PARENT, size: SIZE, viewport: VIEWPORT, showOptions: aboveComponent() }),
    { x: 100, y: 46 },
    'top-left 角 y=100，缝 4，弹层高 50 ⇒ 100 − 4 − 50 = 46')
})

test('给了显示选项且请求点压在父浮层上 ⇒ 改摆到父浮层左边，并夹回屏幕左缘', () => {
  // WizardPopup.java:277-278 相交那一支；:282-284 夹左缘。
  const onTop = resolveRelativeAnchor({
    relative: { x: 100, y: 100, width: 600, height: 300 },
    size: SIZE,
    viewport: VIEWPORT,
    showOptions: { ...belowComponent(), screenX: 150, screenY: 150 },
  })
  assert.deepEqual(onTop, { x: 0, y: 150 }, '100 − 100 − STEP_X_PADDING 2 = −2 ⇒ 夹到 0')

  const fits = resolveRelativeAnchor({
    relative: { x: 200, y: 100, width: 600, height: 300 },
    size: SIZE,
    viewport: VIEWPORT,
    showOptions: { ...belowComponent(), screenX: 250, screenY: 150 },
  })
  assert.deepEqual(fits, { x: 98, y: 150 })
})

test('两档可以显式选：order 只影响「不给显示选项」那一档', () => {
  // 「上」这一位量的基线可以给（PositionAdjuster2，:130-133）。
  assert.deepEqual(resolveRelativeAnchor({
    relative: PARENT, size: SIZE, viewport: VIEWPORT, order: ['top'],
  }), { x: 100, y: 45 }, '100 − 缝 5 − 高 50')
  assert.deepEqual(resolveRelativeAnchor({
    relative: PARENT, size: SIZE, viewport: VIEWPORT, order: ['top'], topBaselineY: 90,
  }), { x: 100, y: 35 }, '基线换成栈顶那个弹层的 y：90 − 5 − 50')
  // 显式给了 order 时，belowComponent 的请求点仍由显示选项决定（请求点优先）。
  assert.deepEqual(resolveRelativeAnchor({
    relative: PARENT, size: SIZE, viewport: VIEWPORT, order: ['top'], showOptions: belowComponent(),
  }), { x: 100, y: 400 })
})

test('四个位都放不下 ⇒ 裁小到最大那块空地里（不越出视口）', () => {
  const point = resolveRelativeAnchor({
    relative: { x: 40, y: 40, width: 20, height: 20 },
    size: { width: 80, height: 80 },
    viewport: { x: 0, y: 0, width: 100, height: 100 },
  })
  assert.deepEqual(point, { x: 40, y: 65 }, '裁到 60×35 塞进「下」那块空地')
})

test('没有锚点矩形 ⇒ 不定位（返回 null，不给一个假坐标）', () => {
  assert.equal(resolveRelativeAnchor({ relative: null, size: SIZE, viewport: VIEWPORT }), null)
  assert.equal(resolveRelativeAnchor({ relative: undefined, size: SIZE, viewport: VIEWPORT }), null)
})

test('接线：popupAnchor 真的引到了那两个模块，且落位按实测尺寸重算', () => {
  const src = read('src/popupAnchor.ts')
  assert.ok(src.includes("from './popupPosition.ts'"), 'popupAnchor 没引 popupPosition 的几何')
  assert.ok(src.includes("from './popupSteps.ts'"), 'popupAnchor 没引 popupSteps 的显示选项')
  assert.ok(src.includes('getBoundingClientRect()'), '必须量真实盒子，不能按行数估算')
  assert.ok(src.includes('nextTick'), '渲染完才量得到真实高度')
  // 四点遍历只管相对父浮层的四个位，窗口边界仍要过 placeMenu 那一关。
  assert.ok(src.includes('placeMenu('), '四个候选位之外还要保证整块留在视口里')
  // 既有那一份点锚点 API 不能被这一支改掉（五张弹层在用）。
  assert.ok(src.includes('export function usePopupAnchor('), 'usePopupAnchor 必须在（AnchoredMenu 等五处还在用）')
})
