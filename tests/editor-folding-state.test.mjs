// 折叠状态存/取与重算（B4 §C③）的判据：上游 `DocumentFoldingInfo`（每个文档的折叠状态，
// 含 `loadFromEditor:91-110` 的"存什么"与 `setToEditor:198-220` 的"怎么放回去"）+
// `UpdateFoldRegionsOperation`（`removeInvalidRegions` / `caretInsideRange`）。
// 本仓没有 PSI 元素签名，用「偏移 + 右半行原文」当轻签名，这条也在测试里钉住。
import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import {
  captureFoldState, caretInsideRange, clearSavedFoldState, dedupeSnapshots, dropStaleFolds, exportFoldState,
  FOLD_STATE_LIMITS, foldedSnapshots, importFoldState, rememberCandidates, restorePlan, savedFoldState,
  setSavedFoldState, signatureAt, staleFolds, unfoldedOverrides,
} from '../src/editorFoldingState.ts'

const DOC = [
  'package demo;',          // 0
  '',                       // 1
  'import java.util.List;',  // 2
  'import java.util.Map;',   // 3
  '',                       // 4
  'public class FoldSample {', // 5
  '  //region helpers',      // 6
  '  static int one() {',    // 7
  '    return 1;',           // 8
  '  }',                     // 9
  '  //endregion',           // 10
  '}',                      // 11
].join('\n')
const doc = EditorState.create({ doc: DOC }).doc
// CM 的 `doc.line(n)` 是 1 基；测试里都写 0 基行号，用 `at()` 转。
const at = line => doc.line(line + 1)
const bounds = (fromLine, toLine) => ({ from: at(fromLine).from, to: at(toLine).to })

test('轻签名 = 起点那一行的原文（折点常在行中间，整行原文更能认出是哪一块）', () => {
  const inside = { from: at(6).from + 11, to: at(10).to }   // 第 7 行 `  //region helpers`：从 "helpers" 起
  assert.equal(signatureAt(doc, inside), '//region helpers', '整行原文，与折点在本行哪里无关')
  assert.equal(signatureAt(doc, bounds(7, 9)), 'static int one() {')
})

test('区间被编辑推走了：拿存档里的签名去候选里认回同一块（computeExpandRanges:146-164 的替身）', () => {
  const saved = [{ from: at(7).from, to: at(9).to, expanded: false, signature: 'static int one() {' }]
  // 模拟"上面多插了一行"：偏移按老样子给，文档里那一块已经在别处
  const shifted = EditorState.create({ doc: String.fromCharCode(10) + DOC }).doc
  const nowCandidate = { from: shifted.line(9).from, to: shifted.line(11).to }
  const plan = restorePlan(shifted, saved, [nowCandidate])
  assert.equal(plan.fold.length, 1, '按签名认回来了')
  assert.equal(plan.fold[0].from, nowCandidate.from)
  assert.deepEqual(restorePlan(shifted, saved, []).fold, [], '没有候选可认 ⇒ 放弃（不往错的地方塞）')
  assert.deepEqual(restorePlan(doc, [{ ...saved[0], signature: '谁也对不上' }], [{ from: at(7).from, to: at(9).to }]).fold, [])
})

test('存什么：折着的都存；展开着的只有"本该默认折着"的才存（用户展开过的覆盖）', () => {
  clearSavedFoldState()
  // 上一次重算时记下的候选（签名按当时的文档算）——"哪些块本该默认折着"要靠它，因为文档一变
  // `foldingRanges` 就被清空了。
  rememberCandidates('x.java', [
    { from: at(2).from, to: at(3).to, kind: 'imports', signature: signatureAt(doc, bounds(2, 3)) },
    { from: at(6).from, to: at(10).to, kind: 'region', signature: signatureAt(doc, bounds(6, 10)) },
  ])
  const folded = [{ from: at(6).from, to: at(10).to }]   // region 折着、imports 展开着
  captureFoldState('x.java', doc, folded, ['imports'])
  const snapshots = savedFoldState('x.java')
  assert.deepEqual(snapshots.map(s => [doc.lineAt(s.from).number, s.expanded]), [[7, false], [3, true]])
  assert.deepEqual(unfoldedOverrides('x.java', [signatureAt(doc, bounds(6, 10))], ['imports']).map(s => s.expanded), [true])
  assert.deepEqual(unfoldedOverrides('x.java', [signatureAt(doc, bounds(2, 3)), signatureAt(doc, bounds(6, 10))], ['imports']), [],
    'imports 折着呢 ⇒ 不算"用户展开过"')
  clearSavedFoldState()
})

test('失效的旧折叠：先存后删（dropStaleFolds 把状态留在存档里）', () => {
  clearSavedFoldState()
  const candidates = [{ from: at(6).from, to: at(10).to }]
  const folded = [{ from: at(6).from, to: at(10).to }, { from: at(2).from, to: at(3).to }]
  const stale = dropStaleFolds('y.java', doc, candidates, folded)
  assert.deepEqual(stale.map(s => doc.lineAt(s.from).number), [3], 'imports 那条没有候选了 ⇒ 失效')
  assert.deepEqual(savedFoldState('y.java').map(s => [doc.lineAt(s.from).number, s.expanded]), [[3, false]], '状态留在存档里')
  assert.deepEqual(dropStaleFolds('y.java', doc, folded, folded), [], '都有候选 ⇒ 没有失效项')
  clearSavedFoldState()
})

test('恢复：偏移与签名都对得上才动手；对不上的跳过（文件在磁盘上变过的替身判据）', () => {
  const snapshots = [
    { from: at(6).from, to: at(10).to, expanded: false, signature: signatureAt(doc, bounds(6, 10)) },
    { from: at(2).from, to: at(3).to, expanded: true, signature: signatureAt(doc, bounds(2, 3)) },
    { from: at(7).from, to: at(9).to, expanded: false, signature: '这段原文已经不在那一行了' },
  ]
  const plan = restorePlan(doc, snapshots)
  assert.deepEqual(plan.fold.map(s => doc.lineAt(s.from).number), [7], '折起来的按存档放回（CM 行号，doc 索引 6）')
  assert.deepEqual(plan.unfold.map(s => doc.lineAt(s.from).number), [3], '用户展开过的要顶掉自动折叠（doc 索引 2）')
  // 越界/空区间直接丢
  assert.deepEqual(restorePlan(doc, [{ from: 5, to: 5, expanded: false, signature: '' }]).fold, [])
  assert.deepEqual(restorePlan(doc, [{ from: doc.length + 5, to: doc.length + 9, expanded: false, signature: '' }]).fold, [])
})

test('重算：新候选里没有的旧折叠算失效（removeInvalidRegions 的等价物）', () => {
  const candidates = [{ from: at(6).from, to: at(10).to }, { from: at(5).from, to: at(11).to }]
  const folded = [{ from: at(6).from, to: at(10).to }, { from: at(2).from, to: at(3).to }]
  const stale = staleFolds(candidates, folded)
  assert.deepEqual(stale.map(s => doc.lineAt(s.from).number), [3], 'imports 那条（doc 索引 2）不再有候选 ⇒ 失效')
})

test('光标在区间里就不折（UpdateFoldRegionsOperation.caretInsideRange:236-238）', () => {
  const range = bounds(5, 11)
  assert.equal(caretInsideRange(at(7).from, range), true)
  assert.equal(caretInsideRange(range.from, range), false, '撞起点不算（`range.getStartOffset() != caretOffset`）')
  assert.equal(caretInsideRange(range.to, range), false)
})

test('会话内的存档按路径存，空表即删除', () => {
  clearSavedFoldState()
  assert.deepEqual(savedFoldState('a.java'), [])
  const one = [{ from: 0, to: 3, expanded: false, signature: 'x' }]
  setSavedFoldState('a.java', one)
  assert.deepEqual(savedFoldState('a.java').map(s => s.to), [3])
  one[0].to = 99
  assert.equal(savedFoldState('a.java')[0].to, 3, '存的是副本，外面改不动')
  setSavedFoldState('a.java', [])
  assert.deepEqual(savedFoldState('a.java'), [])
  clearSavedFoldState()
})

test('合并存档按区间去重、后进的赢（失效时先存、回来了再恢复）', () => {
  const first = [{ from: 0, to: 3, expanded: false, signature: 'a' }]
  const later = [{ from: 0, to: 3, expanded: true, signature: 'b' }, { from: 5, to: 9, expanded: false, signature: 'c' }]
  const merged = dedupeSnapshots([...first, ...later])
  assert.equal(merged.length, 2)
  assert.equal(merged[0].signature, 'b', '同一区间以最后的为准')
})

test('展开计划按签名认块：边界被编辑推走的那条也认（applyFoldPlan 的匹配规则）', () => {
  // 这条规则在 src/editorFolding.ts 的 applyFoldPlan 里（纯逻辑部分在这里等价表达）：
  // 旧折叠的边界被编辑推走一点时，只要**签名**相同就算同一块 —— 上游是 RangeMarker 自己跟着动。
  const staleFold = { from: at(7).from + 1, to: at(9).to - 1 }   // 编辑把边界推了一格（还在同一块里）
  const target = bounds(7, 9)
  assert.equal(signatureAt(doc, staleFold), signatureAt(doc, target), '同一块的签名相同（整行原文）')
  const other = bounds(9, 11)
  assert.notEqual(signatureAt(doc, other), signatureAt(doc, target), '不是同一块 ⇒ 签名不同，不会被误展开')
})

test('落盘：导出按"最近动过的"裁剪到上限，导入能吃回来', () => {
  clearSavedFoldState()
  rememberCandidates('a.java', [])
  // 造 25 个文件（前端上限 20）：从末尾往前取 ⇒ 最近动过的那些留下
  for (let i = 0; i < 25; i++) setSavedFoldState(`f${i}.java`, [{ from: 0, to: 2, expanded: false, signature: `s${i}` }])
  const exported = exportFoldState()
  assert.equal(Object.keys(exported).length, FOLD_STATE_LIMITS.files, '按前端上限裁到 20 个文件')
  assert.ok(Object.keys(exported).includes('f24.java'), '最近动过的在')
  assert.ok(!Object.keys(exported).includes('f0.java'), '最久没动的被裁掉')
  // 每个文件的条数上限 + 签名截断
  setSavedFoldState('big.java', Array.from({ length: 40 }, (_, i) => ({ from: i * 2, to: i * 2 + 1, expanded: false, signature: 'x'.repeat(200) })))
  const one = exportFoldState()['big.java']
  assert.equal(one.length, FOLD_STATE_LIMITS.entries)
  assert.equal(one[0].signature.length, FOLD_STATE_LIMITS.signature, '签名超长按上限截断')
  // 导入：形状不对的条目丢掉，好的留下
  clearSavedFoldState()
  importFoldState({ 'ok.java': [{ from: 1, to: 5, expanded: true, signature: 'x' }], 'bad.java': [{ from: 5, to: 5, expanded: false, signature: 'y' }, { from: 1, to: 2, expanded: 'no', signature: 'z' }] })
  assert.deepEqual(savedFoldState('ok.java').map(s => [s.from, s.to, s.expanded]), [[1, 5, true]])
  assert.deepEqual(savedFoldState('bad.java'), [], '不合规的条目被丢掉（越界/类型错）')
  importFoldState(undefined)
  assert.deepEqual(savedFoldState('ok.java'), [], '换项目 ⇒ 清空')
})
