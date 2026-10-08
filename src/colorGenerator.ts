// 颜色序列生成 —— 上游 `platform/analysis-impl/src/com/intellij/codeHighlighting/ColorGenerator.java`
// 的等价物（逐行照抄那个算法，去掉 Swing 的 `java.awt.Color`）。
//
// 上游是什么：给一组**锚点色**，在相邻锚点之间线性插值出 `colorsBetweenAnchors` 个中间色，
// 拼成一条完整的调色板。它被三处消费：
//   · 彩虹括号（`RainbowHighlighter.java:232-234`）：五档锚色 → 4 个中间色/段
//     （`RAINBOW_COLORS_BETWEEN = 4`，`:48`）→ 5 + 4*4 = 21 档；
//   · VCS 注解的**作者/提交序配色**（`AnnotationsSettings.getOrderedColors`，
//     `platform/vcs-impl/src/com/intellij/openapi/vcs/actions/AnnotationsSettings.java:51-61`）：
//     五个 `VCS_ANNOTATIONS_COLOR_*` 锚色 → 21 档，`getAuthorsColors` 再按 `SHUFFLE_STEP=4`
//     隔步重排（`:35-49`）；
//   · `AnnotateToggleAction.computeBgColors`（`:359-407`）：作者按排序后的名字取色、
//     提交按 `orderedColorPalette.get(size * index / revisionsCount)` 等距取色。
//
// 本仓落点（真实消费）：
//   · `src/editorBlameAnnotations.ts` 的注解装订线颜色 —— 作者名的色相由这里给；
//   · `src/editorBrackets.ts` 的彩虹五档硬编码 hex —— 换成"锚色 + 插值"这条同一算法；
//   · `src/colorScheme.ts` 的颜色方案页可把生成的序列展示出来（本仓无 var 通道的那一档）。
//
// 判据：`tests/color-generator.test.mjs`。

/** 一个颜色通道（0..255）。 */
export interface Rgb {
  r: number
  g: number
  b: number
}

/** `ColorGenerator.ratio`（`:58-61`）：`val1 + (val2 - val1) * ratio`，夹在 0..255。 */
function mixChannel(val1: number, val2: number, ratio: number): number {
  const value = Math.trunc(val1 + (val2 - val1) * ratio)
  return Math.max(0, Math.min(255, value))
}

/**
 * `ColorGenerator.generateLinearColorSequence(Color, Color, int)`（`:37-56`）：
 * 两个锚点之间插 `colorsBetweenAnchors` 个中间色，含两端共 `colorsBetweenAnchors + 2` 个。
 * 中间色的比例是 `i / (colorsBetweenAnchors + 1)`（`i` 从 1 起）—— **不是** `i / n`，
 * 所以中间色永远不会等于端点（这一点与"均匀 n 等分"不同，判据里钉住）。
 */
export function generateLinearColorSequence(color1: Rgb, color2: Rgb, colorsBetweenAnchors: number): Rgb[] {
  const between = Math.max(0, Math.trunc(colorsBetweenAnchors))
  const result: Rgb[] = [color1]
  for (let i = 1; i <= between; i += 1) {
    const ratio = i / (between + 1)
    result.push({
      r: mixChannel(color1.r, color2.r, ratio),
      g: mixChannel(color1.g, color2.g, ratio),
      b: mixChannel(color1.b, color2.b, ratio),
    })
  }
  result.push(color2)
  return result
}

/** `JBColor.GRAY`（上游 `:18` 空锚点表时返回的那一个）。 */
export const GRAY: Rgb = { r: 128, g: 128, b: 128 }

/**
 * `ColorGenerator.generateLinearColorSequence(List<Color>, int)`（`:16-35`）：
 *   · 空表 → 单元素 `[GRAY]`（`:18`）；
 *   · 单元素 → 原样（`:19`）；
 *   · 多元素 → 逐段插值，**每段丢掉第一个元素**避免相邻段在锚点处重复（`:32`）。
 */
export function generatePalette(anchorColors: readonly Rgb[], colorsBetweenAnchors: number): Rgb[] {
  if (anchorColors.length === 0) return [GRAY]
  if (anchorColors.length === 1) return [anchorColors[0]!]
  const between = Math.max(0, Math.trunc(colorsBetweenAnchors))
  const result: Rgb[] = [anchorColors[0]!]
  for (let i = 0; i < anchorColors.length - 1; i += 1) {
    const segment = generateLinearColorSequence(anchorColors[i]!, anchorColors[i + 1]!, between)
    // skip first element from sequence to avoid duplication from connected segments
    result.push(...segment.slice(1))
  }
  return result
}

/** `#rrggbb` → `Rgb`；坏值返回 null（本仓不抛，颜色表来自用户可编辑的方案）。 */
export function rgbFromHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec((hex ?? '').trim())
  if (!match) return null
  const value = Number.parseInt(match[1]!, 16)
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff }
}

/** `Rgb` → `#rrggbb`（小写，与 `src/colorSchemeStore.ts` 的取色器口径一致）。 */
export function rgbToHex(color: Rgb): string {
  const channel = (value: number) => Math.max(0, Math.min(255, Math.trunc(value))).toString(16).padStart(2, '0')
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`
}

// ---------------------------------------------------------------- 两处真实消费的口径

/** `RainbowHighlighter.java:48` 的 `RAINBOW_COLORS_BETWEEN = 4`。 */
export const RAINBOW_COLORS_BETWEEN = 4

/**
 * `RainbowHighlighter.java:47-53` 的 `RAINBOW_JB_COLORS_DEFAULT`（亮/暗两套，各 5 档锚色）。
 * 下标与 `src/editorBrackets.ts` 的 `cm-rainbow-0..4` 对应。
 */
export const RAINBOW_ANCHORS: Readonly<{ light: readonly Rgb[]; dark: readonly Rgb[] }> = {
  light: [
    { r: 0x9b, g: 0x3b, b: 0x6a },
    { r: 0x11, g: 0x4d, b: 0x77 },
    { r: 0xbc, g: 0x86, b: 0x50 },
    { r: 0x00, g: 0x59, b: 0x10 },
    { r: 0xbc, g: 0x51, b: 0x50 },
  ],
  dark: [
    { r: 0x52, g: 0x9d, b: 0x52 },
    { r: 0xbe, g: 0x70, b: 0x70 },
    { r: 0x3d, g: 0x76, b: 0x76 },
    { r: 0xbe, g: 0x99, b: 0x70 },
    { r: 0x9d, g: 0x52, b: 0x7c },
  ],
}

/**
 * 彩虹括号的**完整档位表**（上游 `RainbowHighlighter.generateColors` 里
 * `generateLinearColorSequence(stopRainbowColors, RAINBOW_COLORS_BETWEEN)` 那一句，
 * `:232-234`）：5 锚 + 4 中间/段 = 21 档。
 * `src/editorBrackets.ts` 的 `rainbowSlot(depth)` 用它取代硬编码的五档 hex。
 */
export function rainbowPalette(theme: 'light' | 'dark'): Rgb[] {
  return generatePalette(RAINBOW_ANCHORS[theme], RAINBOW_COLORS_BETWEEN)
}

/** 彩虹第 `slot` 档的颜色（按 21 档取模，与上游 `getRainbowAttrWithLazyCreation` 同口径）。 */
export function rainbowColorAt(slot: number, theme: 'light' | 'dark'): Rgb {
  const palette = rainbowPalette(theme)
  const index = ((Math.trunc(slot) % palette.length) + palette.length) % palette.length
  return palette[index]!
}

/** `AnnotationsSettings.java:20` 的 `ANCHORS_COUNT = 5`、`:21` 的 `COLORS_BETWEEN_ANCHORS = 4`、`:22` 的 `SHUFFLE_STEP = 4`。 */
export const VCS_ANNOTATION_ANCHORS_COUNT = 5
export const VCS_ANNOTATION_COLORS_BETWEEN = 4
export const VCS_ANNOTATION_SHUFFLE_STEP = 4

/**
 * `platform/platform-resources/src/DefaultColorSchemesManager.xml` 里
 * `VCS_ANNOTATIONS_COLOR_1..5` 的**亮色**锚值（`:75-79`：eaffe2 / d1d1d1 / d9e4f9 / fffbcf / ffbfc3）。
 */
export const VCS_ANNOTATION_ANCHORS_LIGHT: readonly Rgb[] = [
  { r: 0xea, g: 0xff, b: 0xe2 },
  { r: 0xd1, g: 0xd1, b: 0xd1 },
  { r: 0xd9, g: 0xe4, b: 0xf9 },
  { r: 0xff, g: 0xfb, b: 0xcf },
  { r: 0xff, g: 0xbf, b: 0xc3 },
]

/** 同一份 XML 的**暗色**锚值（`:1629-1633`：464c43 / 444342 / 41444a / 484248 / 4c393a）。 */
export const VCS_ANNOTATION_ANCHORS_DARK: readonly Rgb[] = [
  { r: 0x46, g: 0x4c, b: 0x43 },
  { r: 0x44, g: 0x43, b: 0x42 },
  { r: 0x41, g: 0x44, b: 0x4a },
  { r: 0x48, g: 0x42, b: 0x48 },
  { r: 0x4c, g: 0x39, b: 0x3a },
]

/**
 * `AnnotationsSettings.getOrderedColors`（`:51-61`）：五锚色 → 线性序列。
 * 上游的锚色来自配色方案（用户可改），本仓用那份 XML 的默认值（没有方案色通道）。
 */
export function vcsAnnotationOrderedColors(theme: 'light' | 'dark'): Rgb[] {
  return generatePalette(theme === 'dark' ? VCS_ANNOTATION_ANCHORS_DARK : VCS_ANNOTATION_ANCHORS_LIGHT, VCS_ANNOTATION_COLORS_BETWEEN)
}

/**
 * `AnnotationsSettings.getAuthorsColors`（`:35-49`）：把有序序列按 `SHUFFLE_STEP=4` **隔步重排**
 * —— 先取 0,4,8,12,16，再取 1,5,9,13,17，依此类推。这样相邻作者（按名字排序）拿到的颜色
 * 在色相上离得远，不会两个人都分到相近的蓝。
 */
export function vcsAuthorColors(theme: 'light' | 'dark'): Rgb[] {
  const colors = vcsAnnotationOrderedColors(theme)
  const authorColors: Rgb[] = []
  for (let i = 0; i < VCS_ANNOTATION_SHUFFLE_STEP; i += 1) {
    for (let k = 0; k <= Math.floor(colors.length / VCS_ANNOTATION_SHUFFLE_STEP); k += 1) {
      const index = k * VCS_ANNOTATION_SHUFFLE_STEP + i
      if (index < colors.length) authorColors.push(colors[index]!)
    }
  }
  return authorColors
}

/**
 * `AnnotateToggleAction.computeBgColors`（`:370-381`）的作者取色那一半：
 * 作者按**名字排序**后逐个领色（`index % palette.length` 取模），返回 名字 → 颜色。
 * 本仓的 `src/blameAnnotations.ts` 按作者名给装订线上色，就是这个映射。
 */
export function authorColorMap(authors: readonly string[], theme: 'light' | 'dark'): Map<string, Rgb> {
  const palette = vcsAuthorColors(theme)
  const sorted = [...new Set(authors)].sort((left, right) => left.localeCompare(right))
  const map = new Map<string, Rgb>()
  for (const author of sorted) map.set(author, palette[map.size % palette.length]!)
  return map
}

/**
 * `AnnotateToggleAction.computeBgColors`（`:386-397`）的提交序取色那一半：
 * 第 `index` 段（共 `revisionsCount` 段）取 `palette[floor(size * index / revisionsCount)]`
 * —— 等距抽样，不按段长加权。
 */
export function revisionOrderColors(revisionsCount: number, theme: 'light' | 'dark'): Rgb[] {
  const palette = vcsAnnotationOrderedColors(theme)
  if (revisionsCount <= 0) return []
  const out: Rgb[] = []
  for (let index = 0; index < revisionsCount; index += 1) {
    out.push(palette[Math.floor((palette.length * index) / revisionsCount)]!)
  }
  return out
}