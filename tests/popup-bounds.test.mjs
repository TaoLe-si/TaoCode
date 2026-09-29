// 浮层尺寸/位置记忆的判据（IDEA `AbstractPopup.setDimensionServiceKey` 那一半，不是 `PopupState`）。
//
// 上游：`AbstractPopup.java:3145-3148` `getStoredSize()`、`:2314-2318` `storeDimensionSize()`、
// `:3140-3143`/`:2320-2324` location 两件、`:594-596` 的 `setDimensionServiceKey`；
// 「连位置一起记」是 builder 的 `setUseDimensionServiceForXYLocation`
// （`PopupChooserBuilder.java:284-287`、`:444`），Search Everywhere 传的就是 true
// （`SearchEverywhereManagerImpl.java:147`，key `"search.everywhere.popup"`，:69）。
//
// 判决表原把这条记在 `PopupState.java` 名下 —— 那是误读：`PopupState` 只有 `isRecentlyHidden()`
// （registry `ide.popup.hide.show.threshold` 默认 200ms），一个 size 字段都没有。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clampPopupLocation, parsePopupBounds, serializePopupBounds } from '../src/popupBounds.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const viewport = { width: 1280, height: 800 }

test('没有存档时返回 null（上游 getStoredSize 为 null 就用首选尺寸）', () => {
  assert.equal(parsePopupBounds(null, viewport), null)
})

test('坏存档一律当"没有存档"，不把浮层摆到看不见的地方', () => {
  for (const raw of ['', '{', 'null', '[]', '"x"', '{"width":"a","height":1}', '{"width":0,"height":100}',
    '{"width":-5,"height":100}', '{}']) {
    assert.equal(parsePopupBounds(raw, viewport), null, `${raw} 应当作没有存档`)
  }
})

test('正常存档：尺寸读回来，位置有就带上', () => {
  const bounds = parsePopupBounds('{"width":720,"height":480,"x":100,"y":60}', viewport)
  assert.deepEqual(bounds, { width: 720, height: 480, x: 100, y: 60 })
  const noPosition = parsePopupBounds('{"width":720,"height":480}', viewport)
  assert.deepEqual(noPosition, { width: 720, height: 480 })
})

test('尺寸不许比视口还大（否则会拖出一个看不到内容的浮层）', () => {
  const bounds = parsePopupBounds('{"width":5000,"height":4000}', viewport)
  assert.equal(bounds.width, viewport.width)
  assert.equal(bounds.height, viewport.height)
})

test('位置夹回视口内（屏幕变小后旧坐标必须夹回来）', () => {
  assert.deepEqual(clampPopupLocation({ width: 720, height: 480, x: 100, y: 60 }, viewport), { x: 100, y: 60 })
  assert.deepEqual(clampPopupLocation({ width: 720, height: 480, x: 5000, y: 5000 }, viewport), { x: 560, y: 320 })
  assert.deepEqual(clampPopupLocation({ width: 720, height: 480, x: -300, y: -40 }, viewport), { x: 0, y: 0 })
  // 没记位置就是 null —— 调用方继续用居中的默认布局。
  assert.equal(clampPopupLocation({ width: 720, height: 480 }, viewport), null)
})

test('序列化与解析互逆（写进去的能读回来）', () => {
  const bounds = { width: 720.4, height: 480.6, x: 100.2, y: 60.9 }
  assert.deepEqual(parsePopupBounds(serializePopupBounds(bounds), viewport), { width: 720, height: 481, x: 100, y: 61 })
  // 没有位置时不写这两个字段（读回来也就没有）。
  assert.deepEqual(parsePopupBounds(serializePopupBounds({ width: 600, height: 400 }), viewport), { width: 600, height: 400 })
})

test('接线：SE 弹窗记尺寸与位置，拖动标题行移动，且读不到存档就退回默认', () => {
  const vue = read('src/components/SearchEverywhereDialog.vue')
  assert.match(vue, /const BOUNDS_KEY = 'taocode\.searchEverywhere\.bounds'/, '没有尺寸/位置的存档键')
  assert.match(vue, /parsePopupBounds\(localStorage\.getItem\(BOUNDS_KEY\)/, '启动时没读存档')
  assert.match(vue, /function storeBounds\(\)[\s\S]{0,240}?serializePopupBounds\(/, '尺寸/位置变了没写回（上游 storeDimensionSize）')
  assert.match(vue, /@pointerdown="startMove"/, '标题行没有拖动入口（上游 setMovable(true)）')
  assert.match(vue, /clampPopupLocation\(/, '贴位置前没夹回视口')
  assert.match(vue, /<section ref="popupEl"/, '没有拿到浮层 DOM，量不到尺寸')
})

test('判决表：把"尺寸记忆"从 PopupState 名下纠正到 AbstractPopup（保留原文对照）', () => {
  const verdict = read('docs/inventory/verdict-ui-tabs-popup.md')
  assert.match(verdict, /PopupState\.java/, '原判据文字还在（要给对照）')
  assert.match(verdict, /AbstractPopup/, '要写明真出处在 AbstractPopup')
  // PopupState 真正管的那件事仍然在，且没有被误删。
  assert.match(read('src/popupState.ts'), /isRecentlyHidden/, '本仓的"刚关又开"抑制不能丢')
})
