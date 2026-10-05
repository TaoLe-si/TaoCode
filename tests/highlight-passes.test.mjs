// 高亮级别与 pass 调度的判据 —— `src/highlightLevels.ts` + `src/highlightPasses.ts`。
//
// 上游依据：`HighlightDisplayLevel`/`HighlightSeverity` 的五级与计数面、
// `TextEditorHighlightingPassRegistrar.registerTextEditorHighlightingPass` 的顺序规则、
// `MainHighlightingPassFactory` 的"内容没变不跑"、`DirtyScopeTrackingHighlightingPassFactory`
// 的脏范围记录与消费。落点是本地检查通道（`src/junitInspections.ts` 的 refreshLocalInspections）。
import test from 'node:test'
import assert from 'node:assert/strict'

const {
  HIGHLIGHT_LEVELS, levelById, levelForSeverity, severityLabel, severityClass, severityForMarker,
} = await import('../src/highlightLevels.ts')
const {
  dirtyLineRanges, dirtyLineCount, rangesOverlap, HighlightPassRegistrar, DirtyScopeTracker, runMainHighlightPasses,
} = await import('../src/highlightPasses.ts')
const { refreshLocalInspections, localDiagnostics, localInspectionDirtyRanges, clearLocalInspections } =
  await import('../src/junitInspections.ts')

test('级别表：五级排序、中文名与面板文案逐字一致', () => {
  assert.deepEqual(HIGHLIGHT_LEVELS.map(level => level.id), ['ERROR', 'WARNING', 'WEAK_WARNING', 'INFO'])
  assert.deepEqual(HIGHLIGHT_LEVELS.map(level => level.rank), [0, 1, 2, 3])
  assert.equal(levelById('ERROR').label, '错误')
  assert.equal(levelById('WEAK_WARNING').label, '提示')
  // 计数面：只有 ERROR/WARNING 进状态栏两格（`counted`）。
  assert.deepEqual(HIGHLIGHT_LEVELS.filter(level => level.counted).map(level => level.id), ['ERROR', 'WARNING'])
  // 现有面板文案与样式类逐字不变（App.vue/ProblemsPanel.vue 都读这两个函数）。
  assert.deepEqual([1, 2, 3, 4, 99].map(severityLabel), ['错误', '警告', '提示', '信息', '信息'])
  assert.deepEqual([1, 2, 3, 4].map(severityClass), ['sev-error', 'sev-warning', 'sev-info', 'sev-info'])
  assert.deepEqual([1, 2, 3, 4].map(severityForMarker), ['error', 'warning', 'info', 'info'])
  assert.equal(levelForSeverity(0).id, 'ERROR', '越界的小值按最严重处理')
})

test('脏行范围：改一行只脏一行；插入/删除按变更点算', () => {
  const base = ['a', 'b', 'c', 'd', 'e'].join('\n')
  assert.deepEqual(dirtyLineRanges(base, base), [])
  assert.deepEqual(dirtyLineRanges(base, ['a', 'B', 'c', 'd', 'e'].join('\n')), [{ start: 1, end: 1 }])
  assert.deepEqual(dirtyLineRanges(base, ['a', 'c', 'd', 'e'].join('\n')), [{ start: 1, end: 1 }])
  assert.deepEqual(dirtyLineRanges(base, ['a', 'b', 'x', 'c', 'd', 'e'].join('\n')), [{ start: 2, end: 2 }])
  assert.deepEqual(dirtyLineRanges(base, ['a', 'b', 'c', 'd', 'e', 'f'].join('\n')), [{ start: 5, end: 5 }])
  assert.equal(dirtyLineCount([{ start: 1, end: 3 }, { start: 9, end: 9 }]), 4)
  assert.equal(rangesOverlap({ start: 1, end: 3 }, { start: 3, end: 5 }), true)
  assert.equal(rangesOverlap({ start: 1, end: 3 }, { start: 4, end: 5 }), false)
})

test('pass 注册表：id 唯一、afterPassId 决定顺序、未知 id 追加末尾', () => {
  const registrar = new HighlightPassRegistrar()
  const ran = []
  const first = registrar.registerPass(() => ran.push('first'))
  const third = registrar.registerPass(() => ran.push('third'))
  const second = registrar.registerPass(() => ran.push('second'), { afterPassId: first })
  assert.deepEqual(registrar.getPasses().map(pass => pass.id), [first, second, third])
  assert.throws(() => registrar.registerPass(() => {}, { id: first }), /id 重复/)
  const appended = registrar.registerPass(() => {}, { afterPassId: 9999 })
  assert.equal(registrar.getPasses().at(-1).id, appended, '未知 afterPassId → 末尾')
  for (const pass of registrar.getPasses()) pass.run({ path: 'a', text: '', dirtyRanges: [], previousText: null })
  assert.deepEqual(ran, ['first', 'second', 'third'])
  registrar.clear()
  assert.equal(registrar.getPasses().length, 0)
})

test('调度：内容没变整拍不跑，真变化才跑并消费脏范围', () => {
  const registrar = new HighlightPassRegistrar()
  const tracker = new DirtyScopeTracker()
  const seen = []
  registrar.registerPass(context => seen.push({ text: context.text, dirty: context.dirtyRanges, previous: context.previousText }))
  assert.deepEqual(runMainHighlightPasses(registrar, tracker, 'a.java', 'one\ntwo'), [1], '首见文件跑一次（整文件脏）')
  assert.deepEqual(seen[0].dirty, [{ start: 0, end: 1 }])
  assert.equal(seen[0].previous, null)
  assert.deepEqual(runMainHighlightPasses(registrar, tracker, 'a.java', 'one\ntwo'), [], '同一内容不再跑')
  assert.equal(seen.length, 1)
  const ran = runMainHighlightPasses(registrar, tracker, 'a.java', 'one\nTWO')
  assert.deepEqual(ran, [1])
  assert.deepEqual(seen[1].dirty, [{ start: 1, end: 1 }])
  assert.equal(seen[1].previous, 'one\ntwo')
  assert.equal(tracker.hasDirtyScope('a.java'), false, '跑完脏范围被消费')
})

test('本地检查消费：重复刷新短路，脏行留档；清文件时连脏范围一起忘掉', () => {
  const path = 'src/UsesJunit.java'
  const bad = ['import org.junit.Test;', 'class A {', '  void testX() {}', '}'].join('\n')
  refreshLocalInspections(path, bad)
  assert.ok((localDiagnostics.get(path) ?? []).length > 0, 'JUnit3 风格方法要报出来')
  assert.deepEqual(localInspectionDirtyRanges.get(path), [{ start: 0, end: 3 }])
  refreshLocalInspections(path, bad)                 // 同样的文本再来一次
  assert.deepEqual(localInspectionDirtyRanges.get(path), [{ start: 0, end: 3 }], '短路时不留档新范围')
  // 样本的"修好"版本同时要让新落地的命名规范（`src/junitRules.ts` 的 naming/ 三条）过得了，
  // 否则本地通道会因为**另一条规则**继续报，这条用例就测不到"该规则修好了就消失"。
  const fixed = ['import org.junit.Test;', 'class TestAlpha {', '  @Test', '  void checksWork() {}', '}'].join('\n')
  refreshLocalInspections(path, fixed)
  assert.deepEqual(localDiagnostics.get(path) ?? [], [], '修好了就从问题表里消失')
  assert.deepEqual(localInspectionDirtyRanges.get(path), [{ start: 1, end: 3 }])
  clearLocalInspections(path)
  assert.equal(localDiagnostics.has(path), false)
  assert.equal(localInspectionDirtyRanges.has(path), false)
  assert.equal(new DirtyScopeTracker().hasDirtyScope(path), false)
})
