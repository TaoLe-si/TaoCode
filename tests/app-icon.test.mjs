// 应用图标的判据。
//
// 图标源是**用户提供的刷笔花体 T 位图**（`src/assets/app-icon.png`，1024×1024）：
// 黑圆角方底 + 反转成白色的花体字标，四边留白相等。`native/app-icon.ico` 由
// `scripts/gen-app-icon.mjs` 从这张图每档独立重采样生成 —— 两者必须一致（手改任一边都会红）。
//
// 改图标只改 `src/assets/app-icon.png`，然后跑 `node scripts/gen-app-icon.mjs` 再跑本文件。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { decodePng, resample, buildIco } from '../scripts/gen-app-icon.mjs'

const root = new URL('..', import.meta.url)
const read = name => readFileSync(new URL(name, root), 'utf8')
const ICON = new URL('src/assets/app-icon.png', root)
const ico = readFileSync(new URL('native/app-icon.ico', root))
const source = decodePng(readFileSync(ICON))
const at = (img, x, y) => {
  const i = (y * img.width + x) * 4
  return [img.px[i], img.px[i + 1], img.px[i + 2], img.px[i + 3]]
}

test('应用图标：黑色圆角方底 + 反转成白色的花体字标', () => {
  assert.equal(source.width, 1024, '源图 1024 宽')
  assert.equal(source.height, 1024, '源图 1024 高')

  // 四角是透明（圆角把角切掉了），正中是方底的黑（#1A1A1A 附近）。
  for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023]]) {
    assert.equal(at(source, x, y)[3], 0, `角 (${x},${y}) 应透明（圆角）`)
  }
  // 取底上远离字标的一点（右下角内侧）验底色。
  const [r, g, b, a] = at(source, 950, 950)
  assert.equal(a, 255, '方底不透明')
  assert.ok(r < 60 && g < 60 && b < 60, `底色应是深黑（#1A1A1A 一带），实际 rgb(${r},${g},${b})`)

  // 字标是白色：整图里必须有足够多的近白不透明像素（反转后的笔画）。
  let white = 0
  let opaque = 0
  for (let i = 0; i < source.px.length; i += 4) {
    if (source.px[i + 3] > 0) {
      opaque++
      if (source.px[i] > 200 && source.px[i + 1] > 200 && source.px[i + 2] > 200) white++
    }
  }
  assert.ok(opaque > 0, '方底是实的')
  assert.ok(white > 5000, `应有足够的白色笔画像素（反转后的字标），实际 ${white}`)
})

test('应用图标：字标四边留白相等', () => {
  // 不透明且**非纯底**（即笔画）的像素外接框 —— 底色是 #1A1A1A，笔画接近白。
  let x0 = source.width, y0 = source.height, x1 = -1, y1 = -1
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const [r, g, b, a] = at(source, x, y)
      if (a === 0) continue
      if (r < 120 && g < 120 && b < 120) continue   // 底色，不算笔画
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  assert.ok(x1 > 0 && y1 > 0, '找得到笔画外接框')
  const margins = [x0, y0, source.width - 1 - x1, source.height - 1 - y1]
  const spread = Math.max(...margins) - Math.min(...margins)
  // 字标是异形（右侧有出锋、左侧有回环），外接框四边不可能像素级相等；
  // 这里卡的是「左右对称、上下均衡」的量级（≤ 8% 画布），不是卡死小数。
  assert.ok(spread <= source.width * 0.08, `四边留白差 ${spread}px 过大，实际 ${margins.join('/')}`)
})

test('应用图标：favicon 与可执行文件图标都指向这份图的产物', () => {
  assert.match(read('index.html'), /<link rel="icon"[^>]*app-icon\.(svg|png)/, 'index.html 挂 favicon')
  assert.match(read('CMakeLists.txt'), /native\/app-icon\.rc/, 'CMake 把图标资源编进 TaoCode 目标')
  assert.match(read('native/app-icon.rc'), /ICON\s+"app-icon\.ico"/, '.rc 指向同目录的 ico')
  assert.ok(existsSync(new URL('native/app-icon.ico', root)), 'ico 产物存在')
})

test('应用图标：ICO 与源图出自同一份数据，且每档都真重采样了', () => {
  assert.deepEqual(buildIco(source), ico, 'ICO 必须等于从当前源图重新生成的结果（跑 node scripts/gen-app-icon.mjs）')

  const count = ico.readUInt16LE(4)
  assert.equal(count, 7, '七档：16/24/32/48/64/128/256')
  const sizes = []
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16
    sizes.push(ico[entry] === 0 ? 256 : ico[entry])
    const length = ico.readUInt32LE(entry + 8)
    const offset = ico.readUInt32LE(entry + 12)
    const data = ico.subarray(offset, offset + length)
    if (sizes[i] === 256) {
      assert.deepEqual([...data.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], '256 那一档是 PNG')
      assert.equal(data.readUInt32BE(16), sizes[i], '256 档 PNG 宽 = 目录项')
      assert.equal(data.readUInt32BE(20), sizes[i], '256 档 PNG 高 = 目录项')
    } else {
      // **256 以下必须是 DIB，不是 PNG** —— 见下面那条判据的来由。
      assert.equal(data.readUInt32LE(0), 40, `第 ${i} 档（${sizes[i]}px）应以 BITMAPINFOHEADER 开头`)
      assert.equal(data.readInt32LE(4), sizes[i], `第 ${i} 档 biWidth = 目录项`)
      assert.equal(data.readInt32LE(8), sizes[i] * 2, `第 ${i} 档 biHeight = 两倍（XOR + AND 掩码）`)
      assert.equal(data.readUInt16LE(12), 1, `第 ${i} 档 biPlanes = 1`)
      assert.equal(data.readUInt16LE(14), 32, `第 ${i} 档 biBitCount = 32`)
      const andStride = ((sizes[i] + 31) >> 5) << 2
      assert.equal(data.length, 40 + sizes[i] * sizes[i] * 4 + andStride * sizes[i],
        `第 ${i} 档长度 = 头 + XOR + AND 掩码`)
    }
  }
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256])
})

test('256 以下用 PNG 会让 Windows 只认出一枚图标（2026-10-07 桃报「某一档图标不对」的根因）', () => {
  // Windows **只允许 256×256 那一档用 PNG 压缩**，其余尺寸的 RT_ICON 必须是未压缩 DIB。
  // 全用 PNG 的后果不是"某档显示怪"，而是 GDI 整个解不出这张图标组 ——
  // 实测 `Icon(path, 32, 32)` 读出来的是噪声，`read-ico-by-size.ps1` 逐档对不上。
  // 所以这条不是风格偏好，是 Windows 的硬要求：对着头 8 字节逐档核对。
  const count = ico.readUInt16LE(4)
  const small = []
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16
    const size = ico[entry] === 0 ? 256 : ico[entry]
    if (size === 256) continue
    const length = ico.readUInt32LE(entry + 8)
    const offset = ico.readUInt32LE(entry + 12)
    const head = ico.subarray(offset, offset + 4)
    small.push({ size, isPng: head[0] === 0x89 && head[1] === 0x50, isDib: ico.readUInt32LE(offset) === 40 })
  }
  assert.equal(small.length, 6, '256 以下有六档')
  for (const entry of small) {
    assert.ok(entry.isDib, `${entry.size}px 这一档不是 DIB（PNG 只在 256 合法）`)
    assert.ok(!entry.isPng, `${entry.size}px 这一档不该是 PNG`)
  }
  // 阳性对照：256 那一档确实仍是 PNG（否则这条就成了"一律不许 PNG"的空判据）。
  const last = 6 + (count - 1) * 16
  const lastOffset = ico.readUInt32LE(last + 12)
  assert.equal(ico[lastOffset], 0x89, '256 那一档仍是 PNG —— 只有它可以用')
})

test('应用图标：小档上笔画仍然可辨（不是一团糊）', () => {
  for (const size of [16, 32]) {
    const px = resample(source, size)
    let brightest = 0
    let darkest = 255
    let opaque = 0
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue
      opaque++
      const value = (px[i] + px[i + 1] + px[i + 2]) / 3
      if (value > brightest) brightest = value
      if (value < darkest) darkest = value
    }
    assert.ok(opaque > 0, `${size}px 档的底是实的`)
    // 小档上细笔画被面积平均，达不到纯白 —— 判据看的是**对比度**：
    // 最亮像素必须明显亮过最暗（底色 #1A1A1A ≈ 26）。差值 < 60 就是糊没了。
    assert.ok(brightest - darkest > 60, `${size}px 档对比度只有 ${(brightest - darkest).toFixed(0)}，笔画糊了`)
    assert.ok(brightest > 120, `${size}px 档最亮像素才 ${brightest.toFixed(0)}，笔画被重采样吃掉了`)
  }
})