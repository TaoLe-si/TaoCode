// 字面量的图片 / 颜色预览（IDEA `com.intellij.codeInsight.preview`）。
//
// 上游：`ImageOrColorPreviewService.kt:145-158` 的 `MyMouseMotionListener` 在**按住 Shift 移动鼠标**
// 时把 `(editor, offset)` 发进预览请求队列，`:176-203` 取该偏移上的 PSI 元素并交给
// `ElementPreviewProvider`（`platform/lang-api/.../preview/ElementPreviewProvider.java:28-38`）显示，
// 鼠标移开或文本变化时 `:206-232` 隐藏。真正画色块 / 贴小图的 provider 在 JetBrains 的非社区插件里，
// 但契约就这三句话：**Shift + 悬停命中 → 显示 → 移开即收**。
//
// 本仓没有 PSI，用**词法字面量**代替元素：`#RGB[A]` / `#RRGGBB[AA]` 显示色块，
// 图片扩展名的路径用宿主 `file.readBinary`（工作区内的二进制读取，MarkdownPreview.vue 先例）
// 转成 data URL 贴图。纯函数（命中、取色、按所在文件解析路径）都在这里；CodeMirror 挂接在
// src/literalPreviewExtension.ts。

import { workspacePath } from './markdown.ts'

export interface ColorLiteral {
  kind: 'color'
  /** 行内区间（半开）：弹层定位用。 */
  from: number
  to: number
  /** 可直接塞进 CSS 的规范十六进制（`#RRGGBB` / `#RRGGBBAA`）。 */
  css: string
  /** 弹层里显示给用户看的原文。 */
  label: string
}

export interface ImageLiteral {
  kind: 'image'
  from: number
  to: number
  /** 字面量里的原路径（未解析、未去引号之外的处理）。 */
  path: string
  label: string
}

export type LiteralPreview = ColorLiteral | ImageLiteral

/** 合法十六进制颜色长度：`#RGB` / `#RGBA` / `#RRGGBB` / `#RRGGBBAA`。 */
const HEX_COLOR = /#([0-9a-fA-F]{3,8})/g
/**
 * CSS `rgb()` / `rgba()`：三个通道（整数或百分比）+ 可选 alpha（`rgba` 的第四参，
 * 0-1 小数或百分比；CSS 颜色 4 也接受 `/ alpha` 写法）。
 */
/**
 * CSS `rgb()` / `rgba()`：三个通道（整数或百分比，允许 `.5` 这种写法）+ 可选 alpha
 * （`rgba` 的第四参，0-1 小数或百分比；CSS 颜色 4 也接受 `/ alpha` 与空格分隔）。
 */
const RGB_CHANNEL = String.raw`-?(?:[0-9]{1,3}(?:\.[0-9]+)?|\.[0-9]+)%?`
const RGB_COLOR = new RegExp(
  String.raw`\brgba?\(\s*(${RGB_CHANNEL})[\s,/]+(${RGB_CHANNEL})[\s,/]+(${RGB_CHANNEL})(?:[\s,/]+(${RGB_CHANNEL}))?\s*\)`, 'gi')
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|bmp|svg)$/i
/** 路径允许的字符里含字母数字与 `_ @ . / \ -`：够覆盖相对路径、`./`、盘符与 URL 里的路径段。 */
const IMAGE_TOKEN = /[A-Za-z0-9_@./\\-]+\.(?:png|jpe?g|gif|webp|bmp|svg)/gi
const HEX_LENGTHS = new Set([3, 4, 6, 8])

/** 把 `#RGB` / `#RGBA` 展开成 CSS 认的 6 / 8 位形式；长度不合法返回空串。 */
function normalizeColor(hex: string): string {
  if (!HEX_LENGTHS.has(hex.length)) return ''
  const expanded = hex.length <= 4 ? [...hex].map(character => character + character).join('') : hex
  return `#${expanded}`
}

/** 取一个通道：`50%` → 128（50 × 255 / 100），`255` → 255，越界钳到 0-255。 */
function channelValue(token: string): number {
  const percent = token.endsWith('%')
  const value = Number.parseFloat(token)
  if (!Number.isFinite(value)) return 0
  const scaled = percent ? (value * 255) / 100 : value
  return Math.max(0, Math.min(255, Math.round(scaled)))
}

/** `rgb()` / `rgba()` 的规范化：alpha 缺省 = 不透明；只有带 alpha 时才给 8 位。 */
function normalizeRgb(match: RegExpExecArray): string {
  const hex = `#${[match[1] ?? '', match[2] ?? '', match[3] ?? '']
    .map(channelValue).map(value => value.toString(16).padStart(2, '0')).join('')}`
  const alphaToken = match[4]
  if (alphaToken === undefined) return hex.toUpperCase()
  const raw = Number.parseFloat(alphaToken)
  const unit = Number.isFinite(raw) ? (alphaToken.endsWith('%') ? raw / 100 : raw) : 0
  const alpha = Math.max(0, Math.min(255, Math.round(Math.max(0, Math.min(1, unit)) * 255)))
  return `${hex}${alpha.toString(16).padStart(2, '0')}`.toUpperCase()
}

/**
 * 命中偏移的颜色字面量：`#RGB[A]`/`#RRGGBB[AA]` 与 CSS `rgb()`/`rgba()`。
 * 十六进制要求两侧是词边界（`foo#abc` 与 `#abcdef0`（9 位）都不算）；`rgb()` 要求整串匹配到 `)`。
 */
export function colorLiteralAt(line: string, offset: number): ColorLiteral | undefined {
  HEX_COLOR.lastIndex = 0
  for (let match = HEX_COLOR.exec(line); match; match = HEX_COLOR.exec(line)) {
    const from = match.index
    const to = from + match[0].length
    if (offset < from || offset >= to) continue
    // 前面的字符是标识符的一部分（`a#b`）或后面还跟着十六进制字符（`#abcdef0`）都不是颜色。
    if (from > 0 && /[A-Za-z0-9_]/.test(line[from - 1] ?? '')) continue
    if (/[0-9a-fA-F]/.test(line[to] ?? '')) continue
    const css = normalizeColor(match[1] ?? '')
    if (!css) continue
    return { kind: 'color', from, to, css, label: css.toUpperCase() }
  }
  // CSS 函数式写法（上游 provider 的 `rgb()`/`rgba()` 档）：命中位置在整串里即可。
  RGB_COLOR.lastIndex = 0
  for (let match = RGB_COLOR.exec(line); match; match = RGB_COLOR.exec(line)) {
    const from = match.index
    const to = from + match[0].length
    if (offset < from || offset >= to) continue
    return { kind: 'color', from, to, css: normalizeRgb(match), label: match[0] }
  }
  return undefined
}

/** 命中偏移的图片字面量。URL（`http://…`）与含引号的写法都能命中，弹出的是引号里那段路径。 */
export function imageLiteralAt(line: string, offset: number): ImageLiteral | undefined {
  IMAGE_TOKEN.lastIndex = 0
  for (let match = IMAGE_TOKEN.exec(line); match; match = IMAGE_TOKEN.exec(line)) {
    const from = match.index
    const to = from + match[0].length
    if (offset < from || offset >= to) continue
    // `http://x/a.png` 里 `:` 断开匹配后剩下的 `//x/a.png` 前一个字符是 `:` —— URL 不预览。
    if (from > 0 && line[from - 1] === ':') continue
    const path = match[0]
    if (!IMAGE_EXTENSION.test(path)) continue
    if (path.includes('://')) continue
    return { kind: 'image', from, to, path, label: path }
  }
  return undefined
}

/** 偏移上有没有可预览的字面量；颜色优先（同一位置两者不可能同时命中，顺序只是确定性）。 */
export function literalAt(line: string, offset: number): LiteralPreview | undefined {
  return colorLiteralAt(line, offset) ?? imageLiteralAt(line, offset)
}

/**
 * 图片字面量 → 工作区路径（相对工作区根，正斜杠）。
 *
 * 与 Markdown 预览同一口径（`src/markdown.ts` 的 `workspacePath`）：相对路径按**所在文件的目录**
 * 解析，`/x` 按工作区根解析，`..` 出工作区就返回 null —— 预览不能变成越界的读文件通道。
 */
export function resolveImagePath(literal: ImageLiteral, documentPath: string): string | null {
  const normalized = literal.path.replace(/\\/g, '/')
  // 盘符 / UNC 是工作区外的绝对地址：本仓的图片读取是**工作区相对**的（`file.readBinary`），
  // 放行它们只会得到一个错误，不如当场判不可预览。
  if (/^[A-Za-z]:/.test(normalized) || normalized.startsWith('//')) return null
  const document = documentPath.replace(/\\/g, '/')
  const basePath = document.includes('/') ? document.slice(0, document.lastIndexOf('/')) : ''
  return workspacePath(basePath, normalized)
}

/** 图片扩展名 → MIME（与 native/dialogs.cpp 的 `image_mime_for` 同一张表）。 */
export function imageMimeFor(path: string): string | undefined {
  const extension = path.replace(/\\/g, '/').split('/').pop()?.split('.').pop()?.toLowerCase() ?? ''
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'bmp') return 'image/bmp'
  if (extension === 'svg') return 'image/svg+xml'
  return undefined
}
