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
import { readFileSync } from 'node:fs'
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

// ——————————————————— 2026-10-06 hlregistry：在途标记的**归属**与 pending edit 的记录条件

test('在途去重标记按值释放：迟到的旧答复被挡掉时，不许把更新那一发的标记一起抹掉', () => {
  // 上游删这一格的三处都带「这条标记是不是我这一发的」那一问：
  //   · `LspHighlightingCache.kt:122-131`（`finally` 先确认 `fileToInFlightRequest[file] === job`，
  //     注释 `:125-128` 明写「更新的那一发接管以后两个条目都属于它 ⇒ 别动」）；
  //   · `:209`（`markSnapshotFresh` 收尾）与 `:236-238`（`applyServerHighlightings`）用的都是
  //     `remove(file, docModStamp)` 双参形态 = 键与值都对上才删。
  const cache = new HighlightingSnapshotCache()
  assert.equal(cache.pullPlan('m.ts', 1), 'request')
  assert.equal(cache.pullPlan('m.ts', 2), 'request', '文档进到 R2 ⇒ 为 R2 再发一发')
  // R1 的答复迟到，而且文档已经在 R2 ⇒ 接受闸门（`:173`）挡掉，这份不落快照。
  assert.equal(cache.acceptFull('m.ts', 1, 2, [cached(0, 3, 'late')]), false, '迟到的旧响应被丢弃')
  assert.equal(cache.snapshotStamp('m.ts'), null)
  // 这一条就是本轮修的缺陷：挡掉 R1 **不许**顺手放开 R2 的标记，否则下一拍又回 `request`
  // ⇒ 同一个文档版本向服务器发第二遍（上游 `:96-102` 那段注释要拦的那一串）。
  assert.equal(cache.pullPlan('m.ts', 2), 'dedup', 'R2 那一发还在飞：同一版本不许发第二遍')
  // 属于自己那一发时才释放：R2 的答复落地即放开。
  assert.equal(cache.acceptFull('m.ts', 2, 2, [cached(0, 3, 'ok')]), true)
  assert.equal(cache.pullPlan('m.ts', 2), 'fresh')
})

test('Unchanged / Failed 同样按值释放在途标记（上游 :209 与 :129 的双参 remove）', () => {
  const cache = new HighlightingSnapshotCache()
  cache.acceptFull('u.ts', 1, 1, [cached(0, 2, 'v1')])
  assert.equal(cache.pullPlan('u.ts', 2), 'request')
  assert.equal(cache.pullPlan('u.ts', 2), 'dedup')
  // 为 R1 发的那一发回了个 unchanged，可文档已经在 R2 ⇒ 不接受（`:193-199` 同一条判据），
  // 而且**不能**把 R2 的标记带走。
  assert.equal(cache.acceptUnchanged('u.ts', 1, 2), false, '文档已变，这份 unchanged 不可信')
  assert.equal(cache.pullPlan('u.ts', 2), 'dedup', 'R2 的在途标记还在 ⇒ 不重发')
  // `acceptFailed` 带 stamp：老那一发失败不动新那一发的标记。
  cache.acceptFailed('u.ts', 1)
  assert.equal(cache.pullPlan('u.ts', 2), 'dedup')
  // 这一发自己失败 ⇒ 放开，下一次允许重试（上游 `:112` 什么都不做 + `finally` 释放）。
  cache.acceptFailed('u.ts', 2)
  assert.equal(cache.pullPlan('u.ts', 2), 'request')
  // 不带 stamp 的旧写法退化为无条件释放（本仓现存三个调用点是这种形状，接线请求 R2 让它们补上号）：
  // 行为与改前逐字一致，本轮没有悄悄改掉调用方还没准备好的那一半。
  assert.equal(cache.pullPlan('u.ts', 3), 'request')
  cache.acceptFailed('u.ts')
  assert.equal(cache.pullPlan('u.ts', 3), 'request')
})

test('fileEdited 只为「真的画着东西」的快照记 pending edit（上游 :249-253）', () => {
  // 上游那一条判据是 `if (!fileToCachedHighlightingsSnapshot[file]?.cachedHighlightings.isNullOrEmpty())`：
  // 问的是**有没有区间在显示**，不是「有没有快照」。空快照（服务端权威回答「这个文件这一族没有结果」）
  // 记下来的 pending edit 永远不会被应用（没有区间可平移），长会话里就按编辑次数无界增长。
  const cache = new HighlightingSnapshotCache()
  cache.acceptFull('e.ts', 1, 1, [])
  for (let index = 0; index < 5; index++) cache.fileEdited('e.ts', { offset: 0, oldLength: 0, newLength: 1 })
  assert.equal(cache.pendingEditCount('e.ts'), 0, '空快照不记')
  // 换到真有一条结果的快照 ⇒ 必须记（这是既有行为，不许因为上面那条收紧而被一起挡掉）。
  cache.acceptFull('e.ts', 2, 2, [cached(1, 3, 'hint')])
  cache.fileEdited('e.ts', { offset: 0, oldLength: 0, newLength: 5 })
  assert.equal(cache.pendingEditCount('e.ts'), 1)
  assert.deepEqual(cache.highlightingsFor('e.ts'), [cached(6, 8, 'hint')])
  assert.equal(cache.pendingEditCount('e.ts'), 0, '取用一次即清空（既有口径不变）')
  // 完全没有快照的文件照旧不记（上游同一条：`snapshot?.cachedHighlightings` 取不到就是 null）。
  cache.fileEdited('none.ts', { offset: 0, oldLength: 1, newLength: 2 })
  assert.equal(cache.pendingEditCount('none.ts'), 0)
})

test('supportsPull：默认 true（上游 :55），推的那一族显式声明 false（LspPublishDiagnosticsCache.kt:31）', () => {
  assert.equal(new HighlightingSnapshotCache().supportsPull, true, '缺省与上游的 `get() = true` 同')
  assert.equal(new HighlightingSnapshotCache({ supportsPull: false }).supportsPull, false)
  // 强制刷新（服务端 `workspace/…/refresh`）与「整族作废」这两条对**两种**族都要生效，
  // 只有「作废拉取族」那一条扇出要跳过推的族 —— 所以这里核的是：声明 false 不改变缓存自身的行为。
  const pushed = new HighlightingSnapshotCache({ supportsPull: false })
  pushed.acceptFull('p.ts', 1, 1, [cached(0, 2, 'd')])
  pushed.invalidate('p.ts')
  assert.equal(pushed.snapshotStamp('p.ts'), STALE_DOC_STAMP)
  assert.deepEqual(pushed.highlightingsFor('p.ts'), [cached(0, 2, 'd')], '刷新期间不闪断（上游 :284-291）')
})

// 宿主那两个计时器（语义高亮预热 / 诊断 pull）与折叠控制器**必须读这一份常量**，
// 不许在 `CodeEditor.vue` / `editorFoldingController.ts` 里各写一个毫秒数 ——
// 上游 `LspHighlightingCache.kt:328` 的 `LOW_PRIORITY_QUIESCENCE_DELAY` 是一个被引用的缺省值
// （`:52` 引用它），`:321` 诊断那一档另是一个数；`foldingRange` 与 semantic tokens /
// document links / inlay hints / code lens 同族（`:324-327` 逐条点名）。
// 钉形状而不是钉数值：数值漂了上面两条会红，这里红说明有人又抄了一份字面量。
test('宿主与折叠控制器读的是同一份 quiescence 常量，没有再写第二份毫秒字面量', () => {
  const host = readFileSync('src/components/CodeEditor.vue', 'utf8')
  const folding = readFileSync('src/editorFoldingController.ts', 'utf8')
  assert.match(host, /semanticTimer = window\.setTimeout\([\s\S]{0,160}, LOW_PRIORITY_QUIESCENCE_MS\)/,
    '语义高亮预热要走低优先级那一档')
  assert.match(host, /pullTimer = window\.setTimeout\([\s\S]{0,160}, DIAGNOSTICS_QUIESCENCE_MS\)/,
    '诊断 pull 要走诊断那一档（上游不是同一个数）')
  assert.match(folding, /deps\.debounceMs \?\? LOW_PRIORITY_QUIESCENCE_MS/, '折叠缺省要走低优先级那一档')
  // 只扫这三个计时器自己那一段：`scheduleLspChange` 那一格（把正文推给服务器）是**另一种**机制，
  // 上游没有对应的静默窗口档位，它的毫秒数不归这条门管 —— 别把它一起拦掉，那会是假红。
  // 正则写成字面量而不是 new RegExp(字符串)：嵌套转义会把它变成永不匹配的空判据（本条第一版就这么错过）。
  assert.doesNotMatch(host, /semanticTimer = window\.setTimeout\([\s\S]{0,160}, [34]\d\d\)/,
    '宿主 semanticTimer 那一段又写了裸的三百/四百毫秒字面量 —— 同一档位有两份数字就会各漂各的')
  assert.doesNotMatch(host, /pullTimer = window\.setTimeout\([\s\S]{0,160}, [34]\d\d\)/,
    '宿主 pullTimer 那一段同上，诊断那一档要走 DIAGNOSTICS_QUIESCENCE_MS')
  assert.doesNotMatch(folding, /debounceMs \?\? [34]\d\d\b/, '折叠控制器的缺省值不许再退回字面量')
})

