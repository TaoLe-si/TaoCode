// 从 `src/assets/app-icon.png` 生成 `native/app-icon.ico`（可执行文件嵌进 PE 的那份）。
//
// 图标源是**位图**（用户提供并反转过的刷笔花体 T），不再是从 SVG 矢量字形栅格化 ——
// 所以这个脚本只做一件事：把那张 1024×1024 的图**每档独立降采样**成 ICO 的七档。
// 每档单独重采样（不是缩放同一张位图）是为了让小尺寸的细笔画不糊。
//
// 用法：`node scripts/gen-app-icon.mjs`
//   · 只依赖 Node 内置能力（手写 PNG 编码），不需要任何图形库或浏览器；
//   · 产物与源图必须一致 —— `tests/app-icon.test.mjs` 会回读两者逐像素核对，跑完记得跑它。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(root, 'src/assets/app-icon.png')
const OUT = join(root, 'native/app-icon.ico')
const SIZES = [16, 24, 32, 48, 64, 128, 256]

let crcTable = null
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let c = -1
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return c ^ -1
}

/** 读 RGBA PNG（8 位、非隔行）。手写解码器：省一个依赖，且只认自己生成的那种图。 */
export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG')
  let offset = 8
  let width = 0
  let height = 0
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[9] !== 6) throw new Error(`只支持 8 位 RGBA，实际 depth=${data[8]} color=${data[9]}`)
      if (data[12] !== 0) throw new Error('不支持隔行 PNG')
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const px = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = px.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[x - 4] : 0
      const b = y > 0 ? px[(y - 1) * stride + x] : 0
      const c = x >= 4 && y > 0 ? px[(y - 1) * stride + x - 4] : 0
      let value = line[x]
      if (filter === 1) value += a
      else if (filter === 2) value += b
      else if (filter === 3) value += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (filter !== 0) throw new Error(`未知 PNG filter ${filter}`)
      out[x] = value & 0xff
    }
  }
  return { width, height, px }
}

/** 一张 RGBA 位图 → PNG（filter 0 + 单一 IDAT）。 */
export function encodePng(px, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 盒式重采样到目标边长。小档用「按面积平均」而不是抽点，细笔画才不会断。 */
export function resample(src, size) {
  const { width, height, px } = src
  const out = Buffer.alloc(size * size * 4)
  const ratioX = width / size
  const ratioY = height / size
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * ratioY)
    const y1 = Math.min(height, Math.max(y0 + 1, Math.ceil((y + 1) * ratioY)))
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * ratioX)
      const x1 = Math.min(width, Math.max(x0 + 1, Math.ceil((x + 1) * ratioX)))
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * width + sx) * 4
          const alpha = px[i + 3] / 255
          r += px[i] * alpha; g += px[i + 1] * alpha; b += px[i + 2] * alpha; a += px[i + 3]
          n++
        }
      }
      const i = (y * size + x) * 4
      // 预乘后平均再还原，避免透明边渗进黑色方块
      const alphaSum = a / 255
      out[i] = alphaSum > 0 ? Math.round(r / alphaSum) : 0
      out[i + 1] = alphaSum > 0 ? Math.round(g / alphaSum) : 0
      out[i + 2] = alphaSum > 0 ? Math.round(b / alphaSum) : 0
      out[i + 3] = Math.round(a / n)
    }
  }
  return out
}

/**
 * 一张 RGBA 位图 → **DIB**（ICO 里 256 以下的档必须用它，不能用 PNG）。
 *
 * 为什么不能整份都用 PNG（2026-10-07 桃报「exe 图标只有一档/某一档显示不对」的根因）：
 * Windows **只允许 256×256 那一档用 PNG 压缩**，其余尺寸的 `RT_ICON` 必须是未压缩的 DIB
 * （BITMAPINFOHEADER + 底向上的 XOR 位图 + AND 掩码）。GDI 的图标装载器解不了小尺寸的 PNG，
 * 于是整个 `RT_GROUP_ICON` 被判成不可用 —— 实测表现是 `ExtractIconEx` 对着产物只报
 * 「1 枚图标、32×32」，而 PE 里明明登记了七档且逐档字节数都对。
 *
 * 尺寸写在 `biHeight` 时是**两倍**（XOR 在上、AND 在下），这是 ICO 的 DIB 约定，
 * 不是笔误；少了 AND 掩码那一段，部分装载路径会直接丢掉这张图。
 */
export function encodeDib(px, size) {
  const andStride = ((size + 31) >> 5) << 2       // 每行按 4 字节对齐
  const andSize = andStride * size
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)                    // biSize
  header.writeInt32LE(size, 4)                    // biWidth
  header.writeInt32LE(size * 2, 8)                // biHeight = XOR + AND
  header.writeUInt16LE(1, 12)                     // biPlanes
  header.writeUInt16LE(32, 14)                    // biBitCount
  header.writeUInt32LE(0, 16)                     // biCompression = BI_RGB
  header.writeUInt32LE(size * size * 4 + andSize, 20) // biSizeImage
  const xor = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4        // DIB 自下而上
    for (let x = 0; x < size; x++) {
      const from = src + x * 4
      const to = (y * size + x) * 4
      xor[to] = px[from + 2]                     // B
      xor[to + 1] = px[from + 1]                 // G
      xor[to + 2] = px[from]                     // R
      xor[to + 3] = px[from + 3]                 // A
    }
  }
  return Buffer.concat([header, xor, Buffer.alloc(andSize)])
}

/**
 * 多档位图 → ICO（每档独立重采样）。
 *
 * **256 用 PNG、其余用 DIB** —— 见 {@link encodeDib} 的注释（这是 Windows 的硬要求，
 * 不是风格选择）。判据 `tests/app-icon.test.mjs` 逐档核对编码方式。
 */
export function buildIco(source, sizes = SIZES) {
  const images = sizes.map(size => ({
    size,
    // 256 那一档在 ICO 目录里宽度写 0（表示 256），PNG 也只有这一档被 Windows 接受。
    data: size >= 256 ? encodePng(resample(source, size), size) : encodeDib(resample(source, size), size),
  }))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)          // 1 = ICO
  header.writeUInt16LE(images.length, 4)
  const dir = Buffer.alloc(16 * images.length)
  let offset = 6 + dir.length
  images.forEach(({ size, data }, index) => {
    const at = index * 16
    dir[at] = size >= 256 ? 0 : size   // 256 在目录里写 0
    dir[at + 1] = size >= 256 ? 0 : size
    dir[at + 2] = 0
    dir[at + 3] = 0
    dir.writeUInt16LE(1, at + 4)
    dir.writeUInt16LE(32, at + 6)
    dir.writeUInt32LE(data.length, at + 8)
    dir.writeUInt32LE(offset, at + 12)
    offset += data.length
  })
  return Buffer.concat([header, dir, ...images.map(i => i.data)])
}

function main() {
  if (!existsSync(SRC)) {
    console.error('缺少 src/assets/app-icon.png')
    process.exit(2)
  }
  const source = decodePng(readFileSync(SRC))
  const ico = buildIco(source)
  writeFileSync(OUT, ico)
  console.log(`app-icon.ico 已写入（${ico.length} 字节，${SIZES.length} 档：${SIZES.join('/')}）`)
  console.log(`源图 ${source.width}×${source.height}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
