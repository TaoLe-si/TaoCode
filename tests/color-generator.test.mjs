// 颜色序列生成（上游 `ColorGenerator.java`）的判据 + 两处真实消费的口径
// （彩虹括号锚色、VCS 注解作者/提交序配色）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  GRAY,
  RAINBOW_ANCHORS,
  RAINBOW_COLORS_BETWEEN,
  VCS_ANNOTATION_ANCHORS_DARK,
  VCS_ANNOTATION_ANCHORS_LIGHT,
  VCS_ANNOTATION_COLORS_BETWEEN,
  VCS_ANNOTATION_SHUFFLE_STEP,
  authorColorMap,
  generateLinearColorSequence,
  generatePalette,
  rainbowColorAt,
  rainbowPalette,
  revisionOrderColors,
  rgbFromHex,
  rgbToHex,
  vcsAnnotationOrderedColors,
  vcsAuthorColors,
} from '../src/colorGenerator.ts'

test('两点插值：中间色的比例是 i/(n+1)，端点不重复', () => {
  const black = { r: 0, g: 0, b: 0 }
  const white = { r: 255, g: 255, b: 255 }
  assert.deepEqual(generateLinearColorSequence(black, white, 0), [black, white])
  // n=1 → 比例 1/2 ⇒ 127（Java `(int)127.5` 也是 127，向零截断）。
  assert.deepEqual(generateLinearColorSequence(black, white, 1), [black, { r: 127, g: 127, b: 127 }, white])
  // n=2 → 1/3、2/3。
  assert.deepEqual(generateLinearColorSequence(black, white, 2).map(c => c.r), [0, 85, 170, 255])
})

test('比例公式不是 i/n：n 个中间色里没有端点值', () => {
  const a = { r: 0, g: 0, b: 0 }
  const b = { r: 100, g: 0, b: 0 }
  const seq = generateLinearColorSequence(a, b, 4)
  assert.equal(seq.length, 6)
  assert.equal(seq[0].r, 0)
  assert.equal(seq[5].r, 100)
  // 中间四档是 20/40/60/80，不是 25/50/75/100。
  assert.deepEqual(seq.slice(1, 5).map(c => c.r), [20, 40, 60, 80])
})

test('空表给灰、单元素原样、多段丢掉重复端点', () => {
  assert.deepEqual(generatePalette([], 4), [GRAY])
  const one = { r: 1, g: 2, b: 3 }
  assert.deepEqual(generatePalette([one], 4), [one])
  const a = { r: 0, g: 0, b: 0 }
  const b = { r: 10, g: 0, b: 0 }
  const c = { r: 20, g: 0, b: 0 }
  const palette = generatePalette([a, b, c], 2)
  // 长度 = 锚点数 + 段数*between = 3 + 2*2 = 7（每段丢一个重复端点）。
  assert.equal(palette.length, 7)
  assert.deepEqual(palette.map(color => color.r), [0, 3, 6, 10, 13, 16, 20])
  // 相邻段在锚点处不重复（b 只出现一次）。
  assert.equal(palette.filter(color => color.r === 10).length, 1)
})

test('hex 往返：坏值不抛、通道夹在 0..255', () => {
  assert.deepEqual(rgbFromHex('#DB3D3C'), { r: 0xdb, g: 0x3d, b: 0x3c })
  assert.deepEqual(rgbFromHex('db3d3c'), { r: 0xdb, g: 0x3d, b: 0x3c })
  assert.equal(rgbFromHex('#12345'), null)
  assert.equal(rgbFromHex(''), null)
  assert.equal(rgbToHex({ r: 0xdb, g: 0x3d, b: 0x3c }), '#db3d3c')
  assert.equal(rgbToHex({ r: 300, g: -5, b: 16 }), '#ff0010')
})

test('彩虹锚色：亮/暗各五档，逐字对上 RAINBOW_JB_COLORS_DEFAULT', () => {
  assert.equal(RAINBOW_COLORS_BETWEEN, 4)
  assert.deepEqual(RAINBOW_ANCHORS.light.map(rgbToHex), ['#9b3b6a', '#114d77', '#bc8650', '#005910', '#bc5150'])
  assert.deepEqual(RAINBOW_ANCHORS.dark.map(rgbToHex), ['#529d52', '#be7070', '#3d7676', '#be9970', '#9d527c'])
  // 5 锚 + 4 中间/段 = 21 档。
  assert.equal(rainbowPalette('light').length, 5 + 4 * 4)
  assert.equal(rainbowColorAt(21, 'light').r, rainbowPalette('light')[0].r, '按 21 档取模')
  assert.equal(rainbowColorAt(-1, 'dark').r, rainbowPalette('dark')[20].r, '负档也取模')
})

test('彩虹括号模块的锚色来自 colorGenerator（不再是裸 hex 字面量）', () => {
  const module = readFileSync(new URL('../src/editorBrackets.ts', import.meta.url), 'utf8')
  assert.match(module, /import \{ rainbowPalette, rgbToHex \} from '\.\/colorGenerator\.ts'/)
  assert.match(module, /export const RAINBOW_LIGHT_COLORS/)
  assert.match(module, /rainbowPalette\('light'\)\[slot \* 5\]/)
  // 五档语义不变（既有判据钉住的 RAINBOW_COLORS = 5）。
  assert.match(module, /export const RAINBOW_COLORS = 5/)
})

test('VCS 注解锚色：XML 里的亮/暗五值，序列 21 档', () => {
  assert.equal(VCS_ANNOTATION_COLORS_BETWEEN, 4)
  assert.equal(VCS_ANNOTATION_SHUFFLE_STEP, 4)
  assert.deepEqual(VCS_ANNOTATION_ANCHORS_LIGHT.map(rgbToHex), ['#eaffe2', '#d1d1d1', '#d9e4f9', '#fffbcf', '#ffbfc3'])
  assert.deepEqual(VCS_ANNOTATION_ANCHORS_DARK.map(rgbToHex), ['#464c43', '#444342', '#41444a', '#484248', '#4c393a'])
  assert.equal(vcsAnnotationOrderedColors('light').length, 21)
  assert.equal(vcsAnnotationOrderedColors('dark').length, 21)
})

test('作者色按 SHUFFLE_STEP 隔步重排，相邻作者颜色离得远', () => {
  const ordered = vcsAnnotationOrderedColors('light')
  const authors = vcsAuthorColors('light')
  assert.equal(authors.length, 21)
  // 第一轮（i=0）：k*4 → 0,4,8,12,16,20（21/4=5 ⇒ k 到 5，index 20 仍在界内）。
  assert.deepEqual(authors.slice(0, 6).map(c => c.r), [0, 4, 8, 12, 16, 20].map(i => ordered[i].r))
  // 第二轮（i=1）：1,5,9,13,17（index 21 越界，丢掉）。
  assert.deepEqual(authors.slice(6, 11).map(c => c.r), [1, 5, 9, 13, 17].map(i => ordered[i].r))
  // 每轮相邻取色相隔 SHUFFLE_STEP 档 —— 色相上离得远，不会两个人都分到相近的蓝。
  assert.equal(authors[0].r, ordered[0].r)
  assert.notEqual(authors[0].r, ordered[1].r)
})

test('作者取色：按名字排序后逐个领色，重复名字只占一档', () => {
  const map = authorColorMap(['李四', '张三', '李四', '王五'], 'light')
  assert.deepEqual([...map.keys()], ['张三', '李四', '王五'].sort((a, b) => a.localeCompare(b)))
  assert.equal(map.size, 3)
  const authors = vcsAuthorColors('light')
  // 排序后的第 0/1/2 位分别拿 0/1/2 档。
  assert.equal(map.get([...map.keys()][0]).r, authors[0].r)
  assert.equal(map.get([...map.keys()][2]).r, authors[2].r)
})

test('提交序取色：等距抽样 palette[size*index/count]', () => {
  const palette = vcsAnnotationOrderedColors('light')
  const colors = revisionOrderColors(5, 'light')
  assert.equal(colors.length, 5)
  assert.deepEqual(colors.map(c => c.r), [0, 1, 2, 3, 4].map(i => palette[Math.floor((palette.length * i) / 5)].r))
  assert.deepEqual(revisionOrderColors(0, 'light'), [])
  assert.deepEqual(revisionOrderColors(-3, 'light'), [])
})