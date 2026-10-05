// 差异导航（上游 `PrevNextDifferenceIterableBase` 的 canGoNext/goNext/canGoPrev/goPrev）—— 算法 + 查看器接线。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canGoNext, canGoPrev, changeBlocks, goNext, goPrev } from '../src/diffNavigation.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

/** 一行：`kind` 决定它是不是差异。 */
const row = kind => ({ kind, left: { no: 1, text: 'x' }, right: { no: 1, text: 'x' } })
/** `e` = equal，其余（`c`/`i`/`d`）= 差异。 */
const rows = spec => [...spec].map(ch => row(ch === 'e' ? 'equal' : ch === 'i' ? 'insert' : ch === 'd' ? 'delete' : 'change'))

test('相邻的非 equal 行合成一块差异', () => {
  // e=equal / c=change / i=insert / d=delete
  assert.deepEqual(changeBlocks(rows('eccedec')), [{ start: 1, end: 2 }, { start: 4, end: 4 }, { start: 6, end: 6 }])
  assert.deepEqual(changeBlocks(rows('eee')), [])
  assert.deepEqual(changeBlocks([]), [])
})

test('下一个差异与上游边界一致：没在最后一块之前就没有下一个', () => {
  const spec = rows('ecceecce')
  const blocks = changeBlocks(spec)
  assert.deepEqual(blocks, [{ start: 1, end: 2 }, { start: 5, end: 6 }])
  assert.equal(canGoNext(spec, blocks, -1), true, '还没起步时能走到第一块')
  assert.deepEqual(goNext(blocks, -1), { start: 1, end: 2 })
  assert.deepEqual(goNext(blocks, 1), { start: 5, end: 6 })
  assert.equal(canGoNext(spec, blocks, 1), true)
  assert.equal(goNext(blocks, 5), null)
  assert.equal(canGoNext(spec, blocks, 5), false, '已在最后一块起点：没有下一个')
  assert.equal(canGoNext(spec, blocks, 7), false, '在最后一行：没有下一个')
  assert.equal(canGoNext(rows('eee'), changeBlocks(rows('eee')), 0), false, '没有差异就没有下一个')
})

test('上一个差异与上游边界一致', () => {
  const spec = rows('ecceecce')
  const blocks = changeBlocks(spec)
  assert.equal(canGoPrev(spec, blocks, -1), false, '还没起步时没有上一个')
  assert.equal(canGoPrev(spec, blocks, 0), false, '在第一块之前')
  assert.deepEqual(goPrev(blocks, 6), { start: 1, end: 2 }, '在第二块里往回退到第一块')
  assert.deepEqual(goPrev(blocks, 5), { start: 1, end: 2 }, '在第二块起点也回到第一块（上游同款）')
  assert.deepEqual(goPrev(blocks, 7), { start: 5, end: 6 }, '结尾时回到最后一块')
  assert.equal(goPrev([], 3), null)
})

test('查看器接线：按钮走模块，禁用态与高亮都在', () => {
  const view = read('src/components/DiffView.vue')
  assert.match(view, /import \{[^}]*changeBlocks[^}]*\} from '\.\.\/diffNavigation'/, '差异导航要走模块')
  assert.match(view, /canGoNext\(blocks|canGoNext\(blocks\.value|const canNext/)
  assert.match(view, /上一个差异/)
  assert.match(view, /下一个差异/)
  assert.match(view, /scrollIntoView/)
})
