// 追溯注解的**作者配色**判据（上游 `AnnotationsSettings.getAuthorsColors` +
// `AnnotateToggleAction.computeBgColors`），以及装订线侧的真实接线。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { blameAuthorColors, blameColorFor, blameThemeFromDocument } from '../src/blameAuthorColors.ts'
import { vcsAuthorColors, rgbToHex } from '../src/colorGenerator.ts'

test('作者色：去重、排序、从隔步重排的调色板逐个领色', () => {
  const rows = blameAuthorColors(['王五', '张三', '王五', '李四'], 'light')
  const palette = vcsAuthorColors('light').map(rgbToHex)
  assert.deepEqual(rows.map(row => row.author), ['张三', '李四', '王五'].sort((a, b) => a.localeCompare(b)))
  assert.equal(rows.length, 3)
  assert.equal(rows[0].color, palette[0])
  assert.equal(rows[1].color, palette[1])
  assert.equal(rows[2].color, palette[2])
})

test('空作者不占档，也不给色', () => {
  const rows = blameAuthorColors(['', '  ', 'Ada'], 'light')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].author, 'Ada')
  assert.equal(blameColorFor(undefined, rows), undefined)
  assert.equal(blameColorFor('', rows), undefined)
  assert.equal(blameColorFor('nobody', rows), undefined)
  assert.equal(blameColorFor('Ada', rows), rows[0].color)
})

test('亮/暗两套锚色给出不同的作者色（配色方案分档）', () => {
  const light = blameAuthorColors(['Ada', 'Bob'], 'light')
  const dark = blameAuthorColors(['Ada', 'Bob'], 'dark')
  assert.notDeepEqual(light.map(row => row.color), dark.map(row => row.color))
  // 暗色的锚色来自 XML 的暗档（464c43…），明显比亮档暗。
  const luma = hex => Number.parseInt(hex.slice(1, 3), 16)
  assert.ok(luma(dark[0].color) < luma(light[0].color))
})

test('主题读不到时退亮色（node --test / 隐私模式）', () => {
  assert.equal(blameThemeFromDocument(), 'light')
})

test('接线：装订线作者列消费 blameAuthorColors（不再是纯文本）', () => {
  const module = readFileSync(new URL('../src/editorBlameAnnotations.ts', import.meta.url), 'utf8')
  assert.match(module, /import \{ blameAuthorColors, blameColorFor, blameThemeFromDocument/)
  assert.match(module, /blameAuthorColors\(annotations\.map\(annotation => annotation\.author \?\? ''\), blameThemeFromDocument\(\)\)/)
  assert.match(module, /node\.style\.color = this\.color/)
  // 作者列才上色，日期列不上。
  assert.match(module, /aspect === 'author' \? blameColorFor\(annotation\.author, colors\) : undefined/)
})