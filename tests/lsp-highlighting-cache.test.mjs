// LSP 高亮区间缓存的判据（`src/lspHighlightingCache.ts`）。
//
// 上游依据：
//   · `LspCachedHighlighting.kt:38-80`（applyPendingEdits 四条分支：之后不动 / 之前右移 /
//     被包含 grown / 部分相交删除）；
//   · `LspHighlightingCache.kt`（按文件快照 + docModStamp 接受闸门 + 在途去重 + Unchanged 只刷 stamp +
//     Failed 保旧值 + invalidate 的 STALE_DOC_MOD_STAMP=−1 + 首拉不走静默窗口）；
//   · `LspPullResult.kt` + `aggregateToPullResult`；
//   · `LspPublishDiagnosticsCache.kt:78-95`（版本闸门与按 documentUri 合并）；
//   · `LspDiagnosticAndLazyQuickFixes.kt:37-54`（惰性记忆化）；
//   · `LspDocumentHighlightCache.kt`（同偏移或落在已存区间内算命中）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DIAGNOSTICS_QUIESCENCE_MS, HighlightingSnapshotCache, LOW_PRIORITY_QUIESCENCE_MS, STALE_DOC_STAMP,
  acceptsPublishedVersion, aggregatePullResults, applyPendingEdits, contentStamp, createLazyQuickFixes,
  documentHighlightHit, lineStartsOf, mergePublishedDiagnostics, offsetOfPosition, positionOfOffset,
  textEditBetween, textRangeAndHighlightKind,
} from '../src/lspHighlightingCache.ts'

const cached = (start, end, info = 'x') => ({ textRange: { start, end }, highlightingInfo: info })

test('applyPendingEdits：编辑在区间之后不动、之前右移、被包含 grown、部分相交删除', () => {
  // ① 编辑完全在区间之后（insert at 20, 区间 0-5）→ 不动。
  assert.deepEqual(applyPendingEdits([cached(0, 5)], [{ offset: 20, oldLength: 0, newLength: 3 }]), [cached(0, 5)])
  // ② 编辑完全在区间之前 → 整体右移 delta。
  assert.deepEqual(applyPendingEdits([cached(10, 15)], [{ offset: 0, oldLength: 2, newLength: 5 }]), [cached(13, 18)])
  assert.deepEqual(applyPendingEdits([cached(10, 15)], [{ offset: 2, oldLength: 3, newLength: 1 }]), [cached(8, 13)])
  // ③ 编辑被区间包含 → 区间按差值 grown（变长与变短）。
  assert.deepEqual(applyPendingEdits([cached(0, 10)], [{ offset: 3, oldLength: 1, newLength: 4 }]), [cached(0, 13)])
  assert.deepEqual(applyPendingEdits([cached(0, 10)], [{ offset: 3, oldLength: 4, newLength: 1 }]), [cached(0, 7)])
  // ④ 与区间端点部分相交 → 删除，不画错行。
  assert.deepEqual(applyPendingEdits([cached(0, 10)], [{ offset: 8, oldLength: 5, newLength: 1 }]), [])
  assert.deepEqual(applyPendingEdits([cached(5, 10)], [{ offset: 0, oldLength: 6, newLength: 2 }]), [])
  // 多条编辑依次应用（上游 MultiMap 的顺序语义）。
  const shifted = applyPendingEdits([cached(0, 4), cached(10, 14)], [
    { offset: 20, oldLength: 0, newLength: 5 },
    { offset: 0, oldLength: 0, newLength: 2 },
  ])
  assert.deepEqual(shifted, [cached(2, 6), cached(12, 16)])
})

test('位置换算：lineStarts/offsetOfPosition/positionOfOffset 互逆且夹边界', () => {
  const text = 'ab\ncdef\ng'
  assert.deepEqual(lineStartsOf(text), [0, 3, 8])
  assert.equal(offsetOfPosition(text, 0, 1), 1)
  assert.equal(offsetOfPosition(text, 1, 3), 6)
  assert.equal(offsetOfPosition(text, 99, 0), 8, '越界行夹到最后一行')
  assert.equal(offsetOfPosition(text, 1, 99), 7, '越界列夹到行尾')
  assert.deepEqual(positionOfOffset(text, 6), { line: 1, character: 3 })
  assert.deepEqual(positionOfOffset(text, 999), { line: 2, character: 1 })
  for (let offset = 0; offset <= text.length; ++offset) {
    const position = positionOfOffset(text, offset)
    assert.equal(offsetOfPosition(text, position.line, position.character), offset, `roundtrip@${offset}`)
  }
})

test('textEditBetween：一段替换、纯插入、纯删除、无变化', () => {
  assert.deepEqual(textEditBetween('abcd', 'abXYcd'), { offset: 2, oldLength: 0, newLength: 2 })
  assert.deepEqual(textEditBetween('abcd', 'ad'), { offset: 1, oldLength: 2, newLength: 0 })
  assert.deepEqual(textEditBetween('abcd', 'aZcd'), { offset: 1, oldLength: 1, newLength: 1 })
  assert.deepEqual(textEditBetween('same', 'same'), { offset: 4, oldLength: 0, newLength: 0 })
})

test('contentStamp：同内容同签名，改一个字符就变', () => {
  assert.equal(contentStamp('hello'), contentStamp('hello'))
  assert.notEqual(contentStamp('hello'), contentStamp('hellp'))
  assert.notEqual(contentStamp('ab'), contentStamp('ba'))
})

test('快照缓存：首拉不算静默、去重、接受闸门、Unchanged、Failed、invalidate、强制重取', () => {
  const cache = new HighlightingSnapshotCache({ quiescenceDelayMs: DIAGNOSTICS_QUIESCENCE_MS })
  assert.equal(cache.quiescenceDelayFor('a.ts'), 0, '首次拉取跳过静默窗口')
  assert.equal(cache.pullPlan('a.ts', 1), 'request')
  assert.equal(cache.pullPlan('a.ts', 1), 'dedup', '同一 stamp 只发一次')
  assert.equal(cache.pullPlan('a.ts', 2), 'request', 'stamp 变了要重发')
  assert.equal(cache.acceptFull('a.ts', 1, 2, [cached(0, 3, 'old')]), false, '迟到的旧响应被丢弃')
  assert.equal(cache.snapshotStamp('a.ts'), null)
  assert.equal(cache.acceptFull('a.ts', 2, 2, [cached(0, 3, 'new')]), true)
  assert.equal(cache.quiescenceDelayFor('a.ts'), DIAGNOSTICS_QUIESCENCE_MS)
  assert.equal(cache.pullPlan('a.ts', 2), 'fresh')
  assert.deepEqual(cache.highlightingsFor('a.ts'), [cached(0, 3, 'new')])
  assert.equal(cache.acceptUnchanged('missing.ts', 5, 5), false, '没有快照的 unchanged 不可信')
  assert.equal(cache.acceptUnchanged('a.ts', 3, 3), true)
  assert.equal(cache.snapshotStamp('a.ts'), 3)
  assert.deepEqual(cache.highlightingsFor('a.ts'), [cached(0, 3, 'new')], 'unchanged 保留内容')
  cache.acceptFailed('a.ts')
  assert.equal(cache.pullPlan('a.ts', 9), 'request', '失败后允许重试（stamp 不同才要重发）')
  cache.invalidate('a.ts')
  assert.equal(cache.snapshotStamp('a.ts'), STALE_DOC_STAMP)
  assert.equal(cache.pullPlan('a.ts', 3), 'request', '强制刷新后同一 stamp 也要重发')
  assert.deepEqual(cache.highlightingsFor('a.ts'), [cached(0, 3, 'new')], '刷新期间旧内容不闪断')
  cache.clearCache()
  assert.equal(cache.snapshotStamp('a.ts'), null)
})

test('fileEdited：pending edit 累积到取用时应用一次，之后就清空', () => {
  const cache = new HighlightingSnapshotCache()
  cache.acceptFull('f', 1, 1, [cached(10, 12, 'tok')])
  cache.fileEdited('f', { offset: 0, oldLength: 0, newLength: 5 })
  cache.fileEdited('f', { offset: 0, oldLength: 0, newLength: 2 })
  assert.deepEqual(cache.highlightingsFor('f'), [cached(17, 19, 'tok')])
  assert.deepEqual(cache.highlightingsFor('f'), [cached(17, 19, 'tok')], '清空后不再重复平移')
  cache.fileEdited('unknown', { offset: 0, oldLength: 1, newLength: 0 })
  assert.deepEqual(cache.highlightingsFor('unknown'), [])
})

test('诊断在编辑中跟着代码走（模块级端到端：区间 → 编辑 → 平移 → 换算回行列）', () => {
  // 「ab\ncd」里第 2 行的诊断；在文档开头插入一行后，诊断应落到第 3 行原字符位置。
  const before = 'ab\ncd'
  const diagnostic = { line: 1, character: 0, endLine: 1, endCharacter: 2, severity: 1, message: 'x' }
  const range = {
    textRange: { start: offsetOfPosition(before, 1, 0), end: offsetOfPosition(before, 1, 2) },
    highlightingInfo: diagnostic,
  }
  const edit = textEditBetween(before, 'zz\n' + before)
  const [adjusted] = applyPendingEdits([range], [edit])
  const after = 'zz\n' + before
  const start = positionOfOffset(after, adjusted.textRange.start)
  const end = positionOfOffset(after, adjusted.textRange.end)
  assert.deepEqual({ line: start.line, character: start.character, endLine: end.line, endCharacter: end.character },
    { line: 2, character: 0, endLine: 2, endCharacter: 2 }, '插入一行后诊断跟着下移一行')
  // 删掉诊断所在的行：编辑**被区间包含**（上游口径 ③）→ 区间缩成零长度保留，
  // 等服务端下一次推送；部分相交（③ 不成立）才删除。
  const shrunk = applyPendingEdits([range], [textEditBetween(before, 'ab\n')])
  assert.deepEqual(shrunk, [{ textRange: { start: 3, end: 3 }, highlightingInfo: diagnostic }])
  assert.deepEqual(applyPendingEdits([range], [textEditBetween(before, 'a')]), [], '部分相交 → 删除不画错位置')
})

test('拉取聚合：任一失败整次失败，unchanged 优先，full 拼接', () => {
  assert.deepEqual(aggregatePullResults([null]), { kind: 'failed' })
  assert.deepEqual(aggregatePullResults([{ kind: 'failed' }, { kind: 'full', items: [] }]), { kind: 'failed' })
  assert.deepEqual(aggregatePullResults([{ kind: 'unchanged' }, { kind: 'full', items: [{ range: { start: 0, end: 1 }, info: 'a' }] }]), { kind: 'unchanged' })
  assert.deepEqual(aggregatePullResults([
    { kind: 'full', items: [{ range: { start: 0, end: 1 }, info: 'a' }] },
    { kind: 'full', items: [{ range: { start: 2, end: 3 }, info: 'b' }] },
  ]), { kind: 'full', items: [{ range: { start: 0, end: 1 }, info: 'a' }, { range: { start: 2, end: 3 }, info: 'b' }] })
})

test('推送诊断：按 documentUri 合并（一个文件多个 LSP 文档），版本不符则丢弃', () => {
  const byUri = new Map()
  assert.deepEqual(mergePublishedDiagnostics(byUri, 'file:///a#cell1', ['d1']), ['d1'])
  assert.deepEqual(mergePublishedDiagnostics(byUri, 'file:///a#cell2', ['d2']), ['d1', 'd2'])
  assert.deepEqual(mergePublishedDiagnostics(byUri, 'file:///a#cell1', ['d3']), ['d3', 'd2'], '同 uri 覆盖')
  assert.equal(acceptsPublishedVersion(3, 3, true), true)
  assert.equal(acceptsPublishedVersion(2, 3, true), false, '旧版本推送丢弃')
  assert.equal(acceptsPublishedVersion(2, 3, false), true, '未打开的文件不比版本')
  assert.equal(acceptsPublishedVersion(null, 3, true), true, '没带版本号就接受')
})

test('惰性 quick fix：只求值一次；文档高亮命中：同偏移或落在已存区间内', () => {
  let calls = 0
  const fixes = createLazyQuickFixes(() => { ++calls; return ['fix'] })
  assert.equal(fixes.computed, false)
  assert.deepEqual(fixes.get(), ['fix'])
  assert.deepEqual(fixes.get(), ['fix'])
  assert.equal(calls, 1)
  assert.equal(fixes.computed, true)
  assert.equal(documentHighlightHit(5, [{ start: 0, end: 4 }], 5), true, '同偏移')
  assert.equal(documentHighlightHit(5, [{ start: 4, end: 9 }], 7), true, '落在区间内')
  assert.equal(documentHighlightHit(0, [{ start: 4, end: 9 }], 12), false)
  assert.equal(documentHighlightHit(0, [{ start: 4, end: 9 }], 2), false)
  assert.deepEqual(textRangeAndHighlightKind([{ range: { start: 1, end: 2 }, kind: 3 }]), [{ textRange: { start: 1, end: 2 }, kind: 3 }])
  assert.equal(LOW_PRIORITY_QUIESCENCE_MS, 300)
})
