// 「刚关掉又立刻弹开」的抑制（IDEA `PopupState`）—— 纯函数 + 接线。
//
// 现场：浮层的"点外面关闭"挂在 pointerdown 捕获阶段，而打开挂在同一个元素的 click 上。
// 一次点击的顺序是 pointerdown → click，所以"关着的时候再点那个按钮"会先关后开，
// 看起来就像按钮没反应。上游为此专门有 PopupState（PopupState.java:23-26 的类注释）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { POPUP_HIDE_SHOW_THRESHOLD_MS, createPopupGate } from '../src/popupState.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('阈值 200ms，而且每道闸门只吞一次', () => {
  // Registry `ide.popup.hide.show.threshold` 的代码默认值（PopupState.java:59 的 intValue(...,200)）。
  assert.equal(POPUP_HIDE_SHOW_THRESHOLD_MS, 200)
  let clock = 1000
  const gate = createPopupGate(undefined, () => clock)
  assert.equal(gate.recentlyHidden, false, '没关过就不该挡')
  gate.hidden()
  clock = 1100
  assert.equal(gate.recentlyHidden, true, '关了一次，200ms 内再点要吞掉')
  // 关键：读一次就复位（上游 hiddenLongEnough = true 就在 getter 里）。第二次必须放行，
  // 否则"关掉→隔 10ms 再点→没反应→再点→还是没反应"会一路吞下去。
  assert.equal(gate.recentlyHidden, false, '判据只能吞一次')
  clock = 1201
  gate.hidden(1000)
  assert.equal(gate.recentlyHidden, false, '过了阈值就不再算"刚刚"（关闭时刻 1000，现在 1201）')
})

test('可注入的时间与阈值让这条能测，不用等真时钟', () => {
  const gate = createPopupGate(50, () => 0)
  gate.hidden(0)
  assert.equal(gate.recentlyHidden, true)
  const other = createPopupGate(50, () => 0)
  other.hidden(-51)
  assert.equal(other.recentlyHidden, false)
})

test('接线：「点外面关」的浮层要过这道闸，没浮层的模块不该有闸门', () => {
  for (const [file, open, close] of [['src/menuUi.ts', 'openEditorPopup', 'closeEditorPopup']]) {
    const source = read(file)
    const body = snippet(source, open)
    const closing = snippet(source, close)
    assert.match(body, /Gate\.recentlyHidden\) return/, `${file} 的 ${open} 没查闸门：同一次点击会先关后开`)
    assert.match(closing, /Gate\.hidden\(\)/, `${file} 的 ${close} 没记录关闭时刻，闸门等于没有`)
    // 只在"真的开着"的时候记，否则 Esc / 切标签关掉一个本来就空的浮层也会把下一次点击吞掉。
    assert.match(closing, /if \(!\w+\.value\) return/, `${file} 的 ${close} 应该只在开着时记一笔`)
  }
  // 标签条不再有「…」浮层（溢出改成滚动），所以它也不该再留一道闸门。
  const strip = read('src/tabStripView.ts')
  assert.doesNotMatch(strip, /createPopupGate|tabMore/i, '标签条没有浮层了，闸门与 tabMore 状态都要跟着删')
})

function snippet(source, name) {
  const start = source.indexOf(`function ${name}`)
  assert.ok(start >= 0, `找不到 ${name}`)
  return source.slice(start, source.indexOf('\n}\n', start) + 2)
}
