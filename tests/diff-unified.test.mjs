// 差异查看器的**统一（unified）行表**与它的块级折叠/展开（`src/diffUnified.ts`）。
//
// 上游要点（逐条开参考树核过，行号是本机树里的实际行号）：
//   · `platform/diff-impl/src/com/intellij/diff/tools/fragmented/UnifiedFragmentBuilder.kt:67-100`
//     一个改动块在统一文档里 = **先出删除行、再出新增行**（`:80-84` 左侧段、`:88-92` 右侧段）；
//     块之间的未更改区间走 `processEquals`（`:57-65`），由 `masterSide` 取一侧入文（`:109-121`）；
//   · `platform/diff-impl/src/com/intellij/diff/tools/fragmented/UnifiedDiffChange.java:28-39`
//     一个改动 = `LineRange(blockStart, insertedStart)` 删段 + `LineRange(insertedStart, blockEnd)` 增段
//     ⇒「块」的身份是删 + 增合起来那一段，本仓的 `block` 序号就是它；
//   · `platform/diff-impl/src/com/intellij/diff/tools/fragmented/LineNumberConvertor.java:113-124` 建行号映射、
//     `:245` 与 `:290` 换算不到返回 -1 ⇒ 本仓把「换算不到」落成 null（新增行没有原文件行号、删除行没有新文件行号）；
//   · `platform/diff-impl/src/com/intellij/diff/tools/fragmented/UnifiedFoldingModel.java:25-41`
//     折叠吃的是**改动行区间**，`settings.range == -1`（`:36`）时整份不建折叠 —— 上下文范围「禁用」
//     那一档在统一视图同样生效，与并排视图共用同一张 `Settings`（`FoldingModelSupport.java:1264-1272`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildUnifiedRows, foldUnifiedRows, unifiedBlockStart, unifiedFoldCanStepDeep, unifiedFoldCandidates, unifiedFolds, unifiedSign, unchangedUnifiedRuns } from '../src/diffUnified.ts'
import { buildDiffRows, generateUnifiedDiff } from '../src/diffText.ts'
import { changeBlocks } from '../src/diffNavigation.ts'
import { CONTEXT_RANGE_MODES, DEFAULT_CONTEXT_RANGE, foldKey, foldLabel } from '../src/diffFold.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

/** 并排行表的构造糖：`kind` + 可选两侧行号。 */
function row(kind, left, right) {
  const out = { kind }
  if (left !== null && left !== undefined) out.left = { no: left, text: `L${left}` }
  if (right !== null && right !== undefined) out.right = { no: right, text: `R${right}` }
  return out
}
/** 一串未更改行（行号从 1 递增，两侧同号）。 */
const equalRows = count => Array.from({ length: count }, (_, i) => row('equal', i + 1, i + 1))

// —— 行表本身 ——

test('a change block emits its deleted lines first and its inserted lines after', () => {
  // 上游 processChanged 的 :80-92：先 appendText(Side.LEFT …) 再 appendText(Side.RIGHT …)。
  const sides = [row('equal', 1, 1), row('delete', 2, null), row('insert', null, 2), row('change', 3, 3), row('equal', 4, 4)]
  const unified = buildUnifiedRows(sides)
  assert.deepEqual(unified.map(r => r.kind), ['context', 'delete', 'delete', 'insert', 'insert', 'context'],
    '整个块的删除行都在整个块的新增行之前，不是逐行交替')
  assert.deepEqual(unified.map(r => r.text), ['L1', 'L2', 'L3', 'R2', 'R3', 'L4'])
  assert.deepEqual(unified.map(r => unifiedSign(r.kind)), [' ', '-', '-', '+', '+', ' '])
})

test('line numbers: both sides for context rows, one side only for changed rows', () => {
  const unified = buildUnifiedRows([row('equal', 7, 9), row('delete', 8, null), row('insert', null, 10)])
  assert.deepEqual(unified.map(r => [r.leftNo, r.rightNo]), [[7, 9], [8, null], [null, 10]],
    '换算不到那一侧就是 null（上游 LineNumberConvertor.convert 返回 -1，这里留空号）')
})

test('index is the position in the unified document and stays contiguous', () => {
  const unified = buildUnifiedRows([row('change', 1, 1), row('change', 2, 2), ...equalRows(3)])
  assert.deepEqual(unified.map(r => r.index), unified.map((_, i) => i))
  assert.equal(unified.length, 7, '两行改动 = 删 2 + 增 2，加 3 行上下文')
})

test('source points back at the sides row, block numbers the change block', () => {
  const sides = [...equalRows(2), row('delete', 3, null), row('insert', null, 3), row('change', 4, 4), ...equalRows(2), row('insert', null, 5)]
  const unified = buildUnifiedRows(sides)
  assert.deepEqual(unified.map(r => r.block), [-1, -1, 0, 0, 0, 0, -1, -1, 1], '未更改行不属于任何块')
  // 一个并排改动行可拆成删/增两行，两行都指回它那一条；块内先删后增 ⇒ source 序列不是升序。
  assert.deepEqual(unified.map(r => r.source), [0, 1, 2, 4, 3, 4, 5, 6, 7])
  // 与并排视图的差异导航同一套块序号（`changeBlocks` 也是「相邻非 equal 合成一块」）。
  const blocks = changeBlocks(sides)
  assert.equal(blocks.length, 2)
  assert.deepEqual(blocks.map((_, i) => unifiedBlockStart(unified, i)), [2, 8], '每块的第一条统一行')
  assert.equal(unifiedBlockStart(unified, 9), -1, '没有这一条块')
})

test('word marks ride along on the side they belong to', () => {
  const changed = { kind: 'change', left: { no: 1, text: 'a b c' }, right: { no: 1, text: 'a x c' }, leftMarks: [[0, 1]], rightMarks: [[2, 1]] }
  const unified = buildUnifiedRows([changed])
  assert.deepEqual(unified.map(r => r.marks), [[[0, 1]], [[2, 1]]], '删行吃 leftMarks、增行吃 rightMarks')
})

test('a row without marks gets no marks property instead of an empty array', () => {
  const unified = buildUnifiedRows([{ kind: 'change', left: { no: 1, text: 'a' }, right: { no: 1, text: 'b' }, leftMarks: [], rightMarks: undefined }])
  assert.equal('marks' in unified[0], false, '空标记不写进对象（与并排行表的既有形状一致）')
  assert.equal('marks' in unified[1], false)
})

test('the unified list keeps every line of both sides exactly once', () => {
  const before = ['keep', 'old one', 'old two', 'tail', 'tail2']
  const after = ['keep', 'new one', 'tail', 'tail2', 'added']
  const sides = buildDiffRows(before, after)
  const unified = buildUnifiedRows(sides)
  const leftOut = unified.filter(r => r.kind !== 'insert').map(r => r.text).sort()
  const rightOut = unified.filter(r => r.kind !== 'delete').map(r => r.text).sort()
  assert.deepEqual(leftOut, sides.filter(r => r.left).map(r => r.left.text).sort(), '删/上下文行的正文 = 并排视图左侧的正文')
  assert.deepEqual(rightOut, sides.filter(r => r.right).map(r => r.right.text).sort(), '增/上下文行的正文 = 并排视图右侧的正文')
  assert.equal(leftOut.filter(t => t.startsWith('old')).length, 2, '两行旧内容都还在（折叠只是显示层）')
  const patch = generateUnifiedDiff(before, after).split('\n').slice(3)
  assert.equal(unified.length, patch.length, '统一视图的行数 = 补丁正文的行数（同一份差异的两种排法）')
})

test('context rows take the left text (the master side of an aligned run)', () => {
  const unified = buildUnifiedRows([{ kind: 'equal', left: { no: 1, text: 'from left' }, right: { no: 1, text: 'from right' } }])
  assert.equal(unified[0].text, 'from left')
})

test('an empty sides list yields an empty unified list', () => {
  assert.deepEqual(buildUnifiedRows([]), [])
})

// —— 块级折叠/展开 ——

test('unchanged runs are found on the unified list too', () => {
  // 一个并排 change 行在统一文档里是删 + 增两行，所以第二段未更改从下标 14 起。
  const unified = buildUnifiedRows([...equalRows(12), row('change', 13, 13), ...equalRows(3)])
  assert.deepEqual(unchangedUnifiedRuns(unified), [{ start: 0, end: 12 }, { start: 14, end: 17 }])
})

test('the same five context modes fold the same way as the sides view', () => {
  assert.deepEqual([...CONTEXT_RANGE_MODES], [1, 2, 4, 8, -1])
  const unified = buildUnifiedRows(equalRows(30))
  assert.deepEqual(unifiedFoldCandidates(unified, DEFAULT_CONTEXT_RANGE).map(f => [f.hiddenFrom, f.hiddenTo]), [[4, 26], [8, 22]])
  assert.deepEqual(unifiedFoldCandidates(unified, -1), [], '禁用档没有候选层（UnifiedFoldingModel.java:36）')
  assert.deepEqual(unifiedFolds(unified, -1), [], '禁用档整份没有折叠区')
})

test('one fold per unchanged run, keyed by the run start', () => {
  const unified = buildUnifiedRows([...equalRows(12), row('delete', 13, null), ...equalRows(20)])
  const folds = unifiedFolds(unified, 4)
  assert.deepEqual(folds.map(foldKey), [0, 13])
  assert.deepEqual(folds.map(f => f.hiddenTo - f.hiddenFrom), [4, 12], '第一段藏 [4,8)，第二段藏 [17,29)')
})

test('collapsing turns one block into a single marker row', () => {
  const unified = buildUnifiedRows([...equalRows(12), row('change', 13, 13), ...equalRows(20)])
  const items = foldUnifiedRows(unified, 4, new Set([0]))
  assert.equal(items.filter(i => i.kind === 'fold').length, 1)
  const marker = items.find(i => i.kind === 'fold')
  assert.equal(marker.hidden, 4)
  assert.equal(marker.depth, 0)
  assert.equal(marker.layers, 1, 'range=4 下这 12 行只有一层藏得住 ≥2 行：第二层要留 8+8 行，只剩 [8,4)')
  assert.equal(foldLabel(marker.hidden), '⋯ 4 行未更改 ⋯')
  assert.deepEqual(items.slice(0, 4).map(i => i.kind), ['row', 'row', 'row', 'row'], '折叠前的上下文行原样可见')
})

test('nothing collapses while everything is expanded', () => {
  const unified = buildUnifiedRows(equalRows(30))
  assert.equal(foldUnifiedRows(unified, 4, new Set()).length, 30)
  assert.ok(foldUnifiedRows(unified, 4, new Set()).every(i => i.kind === 'row'))
})

test('one click expands exactly one candidate layer', () => {
  const unified = buildUnifiedRows(equalRows(30))
  const once = foldUnifiedRows(unified, 4, new Set([0]), new Map([[0, 1]]))
  const marker = once.find(i => i.kind === 'fold')
  assert.equal(marker.depth, 1)
  assert.equal(marker.hidden, 14)
  assert.equal(once.filter(i => i.kind === 'row').length, 30 - 14)
  assert.equal(unifiedFoldCanStepDeep(0, 4, unified, 0), true)
  assert.equal(unifiedFoldCanStepDeep(0, 4, unified, 1), false, '最后一层再点就整段展开')
  assert.equal(unifiedFoldCanStepDeep(5, 4, unified, 0), false, '不是折叠起点的键不算一处折叠')
})

test('the run that neighbours a change block is not folded away with it', () => {
  const unified = buildUnifiedRows([...equalRows(20), row('insert', null, 21), ...equalRows(20)])
  const items = foldUnifiedRows(unified, 4, new Set([0, 21]))
  const rows = items.filter(i => i.kind === 'row')
  assert.ok(rows.some(i => i.row.kind === 'insert'), '改动行永远不会被折叠藏掉')
  assert.equal(items.filter(i => i.kind === 'fold').length, 2)
})

test('a run too short to hide two rows never offers a fold', () => {
  const unified = buildUnifiedRows([...equalRows(9), row('change', 10, 10)])
  assert.deepEqual(unifiedFolds(unified, 4), [])
  assert.equal(foldUnifiedRows(unified, 4, new Set([0])).filter(i => i.kind === 'fold').length, 0)
})

// —— 接线（渲染与状态）——

test('the viewer renders the unified list instead of raw patch text', () => {
  const view = read('src/components/DiffView.vue')
  assert.match(view, /import \{[^}]*buildUnifiedRows[^}]*\} from '\.\.\/diffUnified'/, '统一行表要走模块，不在组件里现算')
  assert.match(view, /const unifiedRows = computed\(\(\) => buildUnifiedRows\(effectiveRows\.value\)\)/)
  assert.match(view, /const unifiedItems = computed\(\(\) => foldUnifiedRows\(unifiedRows\.value, contextRange\.value, collapsedUnified\.value, foldLevelsUnified\.value\)\)/)
  assert.match(view, /<div v-else-if="effectiveRows\.length" class="diff-unified">/, '有行表就渲染行，不再吐 pre')
  assert.match(view, /class="diff-unified-line"/)
  assert.match(view, /unifiedSign\(item\.row\.kind\)/, '行首的 + / - 符号')
  assert.match(view, /\{\{ item\.row\.leftNo \?\? '' \}\}/, '换算不到的那一侧留空')
  assert.match(view, /@click="toggleFoldUnified\(foldKey\(item\.fold\)\)"/, '统一档的折叠块点它展开')
  assert.match(view, /<pre v-else class="diff-body">/, 'pre 只剩 rows 为空时的兜底')
})

test('the two modes keep separate fold state, and the toolbar toggle follows the visible one', () => {
  const view = read('src/components/DiffView.vue')
  assert.match(view, /const collapsedUnified = ref<Set<number>>\(new Set\(\)\)/)
  assert.match(view, /const foldLevelsUnified = ref<Map<number, number>>\(new Map\(\)\)/)
  assert.match(view, /watch\(unifiedRows, \(\) => \{ foldLevelsUnified\.value = new Map\(\); collapsedUnified\.value = new Set\(\) \}\)/, '换了差异就把统一档的折叠作废')
  assert.match(view, /const allCollapsedNow = computed\(\(\) => mode\.value === 'unified' \? allCollapsedUnified\.value : allCollapsed\.value\)/)
  assert.match(view, /function toggleAll\(\) \{\n\s*if \(mode\.value === 'unified'\) toggleAllUnified\(\); else toggleAllSides\(\)/)
  assert.match(view, /@click="toggleAll"/, '工具带那个开关仍叫"折叠/展开全部"，只是按当前档位分派')
})

test('the unified fold row shares the four-column grid of its rows', () => {
  const view = read('src/components/DiffView.vue')
  assert.match(view, /\.diff-unified-line \{ display: grid; grid-template-columns: 46px 46px 16px minmax\(0, 1fr\)/)
  assert.match(view, /\.diff-unified-fold \{ grid-template-columns: 46px 46px 16px minmax\(0, 1fr\); \}/, '折叠行与正文行同一套栅格')
  assert.match(view, /\.diff-unified-line\.unified-delete > \.diff-cell \{ background: var\(--error-bg\); \}/, '配色走令牌，不写裸色值')
  assert.match(view, /\.diff-unified-line\.unified-insert > \.diff-cell \{ background: var\(--success-bg\); \}/)
})

test('navigation jumps in both modes', () => {
  const view = read('src/components/DiffView.vue')
  assert.match(view, /if \(mode\.value === 'unified'\) \{/, 'F7 在统一档也要落到那一块')
  assert.match(view, /const at = unifiedBlockStart\(unifiedRows\.value, activeBlock\.value\)/)
  assert.match(view, /unifiedEls\.get\(row\)\?\.scrollIntoView\(\{ block: 'center' \}\)/)
  assert.match(view, /function unifiedActive\(row: UnifiedRow\): boolean \{\n\s*return row\.block !== -1 && row\.block === activeBlock\.value/)
})

test('the word-level highlight is reused on the unified column', () => {
  const view = read('src/components/DiffView.vue')
  assert.match(view, /function unifiedPieces\(row: UnifiedRow\) \{/)
  assert.match(view, /return highlightPieces\(row\.text, row\.marks, hits\)/)
  assert.match(view, /const side = row\.kind === 'insert' \? 'right' : row\.kind === 'delete' \? 'left' : null/)
})
