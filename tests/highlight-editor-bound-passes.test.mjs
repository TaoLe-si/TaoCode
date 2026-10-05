// `EditorBoundHighlightingPass` 的调度判据 —— `src/highlightPasses.ts`。
//
// 上游依据：`platform/analysis-impl/src/com/intellij/codeHighlighting/EditorBoundHighlightingPass.java:8-15`
//   「The pass which should be applied to every editor, even if there are many for this document.」
//   「Ordinary TextEditorHighlightingPass is document-bound … for example, there is no point to
//    recalculate syntax errors for each splitted editor of the same document. This pass however is
//    for editor-specific markup, e.g. code folding.」
//   —— 也就是：它**不**吃 MainHighlightingPassFactory 的「内容没变就跳过」，同一个文档开几个编辑器
//   就要跑几遍。
// 失效判据那一侧参照 `TextEditorHighlightingPass.java:104-122` 的 `isValid()`
// （document 的 modification stamp 没变），所以编辑器绑定 pass 的上下文里没有行范围。
import test from 'node:test'
import assert from 'node:assert/strict'

const { HighlightPassRegistrar, DirtyScopeTracker, runMainHighlightPasses, runEditorBoundHighlightPasses } =
  await import('../src/highlightPasses.ts')

test('注册表按 kind 分流：main 与 editorBound 各自成列', () => {
  const registrar = new HighlightPassRegistrar()
  const mainId = registrar.registerPass(() => {}, { kind: 'main' })
  const boundId = registrar.registerPass(() => {}, { kind: 'editorBound' })
  assert.deepEqual(registrar.findByKind('main').map(pass => pass.id), [mainId])
  assert.deepEqual(registrar.findByKind('editorBound').map(pass => pass.id), [boundId])
  registrar.clear()
})

test('editorBound 每次都跑：文本没变也不短路（折叠标记这类编辑器专属 markup 要重画）', () => {
  const registrar = new HighlightPassRegistrar()
  const seen = []
  registrar.registerPass(context => seen.push({ editor: context.editorId, dirty: context.dirtyRanges, previous: context.previousText }),
    { kind: 'editorBound' })
  // 同一段文本连跑两次：主 pass 第二次会短路，editorBound 两次都跑。
  assert.deepEqual(runEditorBoundHighlightPasses(registrar, 'a.java', 'one\ntwo', 'editor-1'), [1])
  assert.deepEqual(runEditorBoundHighlightPasses(registrar, 'a.java', 'one\ntwo', 'editor-1'), [1])
  assert.equal(seen.length, 2)
  assert.deepEqual(seen[0], { editor: 'editor-1', dirty: [], previous: null })
  assert.equal(new DirtyScopeTracker().hasDirtyScope('a.java'), false, '不经过脏范围记账')
})

test('同一文档两个编辑器各跑一遍（"even if there are many for this document"）', () => {
  const registrar = new HighlightPassRegistrar()
  const seen = []
  registrar.registerPass(context => seen.push(context.editorId), { kind: 'editorBound' })
  registrar.registerPass(context => seen.push(context.editorId), { kind: 'editorBound', afterPassId: 1 })
  assert.deepEqual(runEditorBoundHighlightPasses(registrar, 'a.java', 'x', 'left'), [1, 2])
  assert.deepEqual(runEditorBoundHighlightPasses(registrar, 'a.java', 'x', 'right'), [1, 2])
  assert.deepEqual(seen, ['left', 'left', 'right', 'right'])
})

test('主 pass 与编辑器绑定 pass 互不串场', () => {
  const registrar = new HighlightPassRegistrar()
  const tracker = new DirtyScopeTracker()
  const ran = []
  registrar.registerPass(context => ran.push(`main:${context.editorId ?? '-'}`), { kind: 'main' })
  registrar.registerPass(() => ran.push('bound'), { kind: 'editorBound' })
  runMainHighlightPasses(registrar, tracker, 'a.java', 'one')
  runEditorBoundHighlightPasses(registrar, 'a.java', 'one', 'editor-1')
  runMainHighlightPasses(registrar, tracker, 'a.java', 'one')       // 主 pass 短路
  runEditorBoundHighlightPasses(registrar, 'a.java', 'one', 'editor-1')
  assert.deepEqual(ran, ['main:-', 'bound', 'bound'])
})
