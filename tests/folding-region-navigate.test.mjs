// 「转到自定义折叠」列表里点一条以后，编辑器落在哪儿 —— `lp/custom-folding` 那族里
// `GotoCustomRegionAction` / `CustomFoldingRegionsPopup` 两行的**导航**那一半。
//
// 上游坐标（本地参考树逐行核过）：
//   · `platform/lang-impl/src/com/intellij/lang/customFolding/CustomFoldingRegionsPopup.java:80-88`
//     `navigateTo(editor, element)`：
//       `:82` 界闸 —— `offset >= 0 && offset < document.getTextLength()` 才动，越界什么都不做；
//       `:83` `getCaretModel().removeSecondaryCarets()`；
//       `:84` `moveToOffset(offset)`（offset 是**元素**的起始 = 开始标记那一行）；
//       `:85` `scrollingModel().scrollToCaret(ScrollType.CENTER)` —— **居中**；
//       `:86` `getSelectionModel().removeSelection()`。
//   · 同一份 `:32-38` 的 `setItemChosenCallback` 只在元素有效时才导航（界闸的另一半）。
//
// 本仓改之前给的是 `scrollIntoView: true`（CodeMirror 的 **nearest**：目标本来就看得见就一动不动），
// 与上游的 CENTER 不同 —— 从列表里挑屏幕最底下那条时，IDEA 把它带到中间，本仓只挪一行。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EditorState } from '@codemirror/state'
import { regionNavigateSpec } from '../src/customFoldingPopup.ts'
import { regionEntries } from '../src/customFoldingRegions.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const TEXT = '//region 构造\nlet a = 1\n//endregion\n//region 析构\nlet b = 2\n//endregion\n'
const regions = regionEntries(TEXT)
const state = EditorState.create({ doc: TEXT })

test('列表里那两条都是能核实的具体值（先把前提钉住）', () => {
  assert.equal(regions.length, 2)
  assert.deepEqual(regions.map(region => region.label), ['构造', '析构'])
  assert.equal(regions[0].from, 0, '第一条的开始标记就在文档开头')
  assert.equal(regions[1].from, TEXT.indexOf('//region 析构'))
})

test('导航 = 单光标落在开始标记 + **居中**滚动（:82-86 的四步）', () => {
  const multi = state.update({ selection: [{ anchor: 3, head: 8 }, { anchor: 20, head: 20 }] }).state
  const spec = regionNavigateSpec(regions[1], multi.doc.length)
  assert.ok(spec, '落点在文档内 ⇒ 该动')
  const transaction = multi.update(spec)
  assert.equal(transaction.selection.ranges.length, 1, 'removeSecondaryCarets：次要光标被清掉')
  assert.equal(transaction.selection.main.from, regions[1].from, 'moveToOffset(元素起始)')
  assert.equal(transaction.selection.main.to, regions[1].from, 'removeSelection：不留选区')
  // `EditorView.scrollIntoView` 是「造效果」的静态方法，那个 StateEffectType 本身没导出
  // ⇒ 按效果的取值形状认（`{range, y, x, yMargin, xMargin, isSnapshot}`），并要求只有这一条滚动效果。
  const scrollers = transaction.effects.filter(effect => effect.value && typeof effect.value === 'object'
    && 'range' in effect.value && 'y' in effect.value)
  assert.equal(scrollers.length, 1, '必须带一条、且只一条滚动效果')
  assert.equal(scrollers[0].value.y, 'center', 'ScrollType.CENTER（不是 nearest）')
  assert.equal(scrollers[0].value.range.anchor, regions[1].from, '滚的是同一个落点')
})

test('越界的落点什么都不做（:82 的那道界闸）', () => {
  const length = state.doc.length
  assert.equal(regionNavigateSpec({ ...regions[0], from: length }, length), null, 'offset === textLength 不算在里面')
  assert.equal(regionNavigateSpec({ ...regions[0], from: length + 4 }, length), null)
  assert.equal(regionNavigateSpec({ ...regions[0], from: -1 }, length), null)
  assert.ok(regionNavigateSpec({ ...regions[0], from: length - 1 }, length), '最后一个字符还在文档内')
})

test('弹层用的是这一份，没有第二条滚动路径', () => {
  const popup = read('src/customFoldingPopup.ts')
  assert.match(popup, /const spec = regionNavigateSpec\(region, view\.state\.doc\.length\)/)
  assert.match(popup, /if \(!spec\) return\n {4}view\.dispatch\(spec\)/, '越界时不 dispatch')
  assert.ok(!/scrollIntoView: true/.test(popup), 'nearest 那一档已经换掉了')
})
