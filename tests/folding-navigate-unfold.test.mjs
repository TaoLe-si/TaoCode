// 「跳转到某处时先把它所在的折痕打开」—— `docs/inventory/verdict-folding.md` §G 里
// `UpdateFoldRegionsOperation` 行点名的「缺 `ApplyDefaultStateMode` 的另外两种模式」，
// 与 §C⑤ 那句「仍缺」的另一半（导航那一段）。
//
// 上游坐标（本地参考树逐行核过）：
//   · `platform/analysis-api/src/com/intellij/openapi/fileEditor/OpenFileDescriptor.java:215-221`
//     —— `getRangeToUnfoldOnNavigation(editor)` 返回的就是**光标所在那一整行**
//     （`getLineStartOffset(line)` → `getLineEndOffset(line)`）；
//   · 同文件 `:205-212` 的展开循环：`if (!region.isExpanded() && range.intersects(region)) region.setExpanded(true)`
//     ⇒ 判据是 `TextRange.intersects`，它**含端点**：`TextRange.java:237-238`
//     `Math.max(myStartOffset, startOffset) <= Math.min(myEndOffset, endOffset)`；
//     不含端点的那个是另一个方法 `intersectsStrict`（`TextRange.java:241-243`），上游这两处都没用它
//     ⇒ 只搭一个端点**算**相交，光标压在折痕边界上（含空行那种零长导航段）也要把这块打开。
//     【留痕】本文件与 `src/editorFolding.ts` 的旧注释把它写成「严格相交、只搭端点不算」，
//     2026-10-06 fold3 批按上面两行坐标订正（原写「不算」、实际「算」）。
//   · `platform/foldings/src/com/intellij/codeInsight/folding/impl/UpdateFoldRegionsOperation.java:143`
//     每一轮重算开头都问一次那一段；`shouldExpandNewRegion:243-249` 的
//     `ApplyDefaultStateMode.EXCEPT_CARET_REGION` 那一支：相交就返回「展开」，**哪怕它本该按默认折着**；
//   · 这一档是谁选的：`FoldingUpdate.java:155` —— 这次重算带导航时用 `EXCEPT_CARET_REGION`，否则 `NO`
//     （`YES` 在社区树里没有调用方）。
//
// 本仓落点：`src/editorFolding.ts` 的 `navigationRange` / `unfoldIntersecting`，
// 调度管道那一步在 `src/editorFoldingController.ts`（`navigateToRange` + 管道第 ⑦ 步）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codeFolding, foldEffect, foldedRanges } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { foldingRanges, navigationRange, setFoldingRanges, unfoldIntersecting } from '../src/editorFolding.ts'
import { createFoldingController } from '../src/editorFoldingController.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

// 管道里的 capture 会顺带安排一次落盘（`editorFoldingState.ts` 的 `flushFoldState` 用 window.setTimeout），
// Node 里没有 window；排下去的那一步与本次判据无关 ⇒ 桩成「不真的排」。
globalThis.window = { setTimeout: () => 0, clearTimeout: () => {} }

const DOC = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'].join('\n')
const RANGES = [
  { startLine: 0, endLine: 2 },   // 第 1–3 行
  { startLine: 4, endLine: 6 },   // 第 5–7 行
  { startLine: 8, endLine: 10 },  // 第 9–11 行
]
const base = EditorState.create({ doc: DOC, extensions: [codeFolding(), foldingRanges] })
  .update({ effects: setFoldingRanges.of(RANGES) }).state

const lineStart = number => base.doc.line(number).from
const lineEnd = number => base.doc.line(number).to
const SPAN_1 = [lineStart(1), lineEnd(3)]
const SPAN_2 = [lineStart(5), lineEnd(7)]
const SPAN_3 = [lineStart(9), lineEnd(11)]

/** 一个跑得动折叠命令的假 view（EditorView 在这里只被按 {state, dispatch} 用）。 */
function fakeView(initial) {
  let current = initial
  return { get state() { return current }, dispatch: spec => { current = current.update(spec).state } }
}

const spans = state => {
  const out = []
  for (const iterator = foldedRanges(state).iter(); iterator.value; iterator.next()) out.push([iterator.from, iterator.to])
  return out
}

/** 三条区间全折上的那份状态（模拟「默认折叠 + 用户又折了几块」）。 */
const foldedAll = () => base.update({
  effects: [SPAN_1, SPAN_2, SPAN_3].map(([from, to]) => foldEffect.of({ from, to })),
}).state

test('导航段就是光标那一整行（OpenFileDescriptor.java:215-221）', () => {
  assert.deepEqual(navigationRange(base, lineStart(5) + 1), { from: lineStart(5), to: lineEnd(5) }, '行中间的一个偏移 ⇒ 取整行')
  assert.deepEqual(navigationRange(base, lineStart(5)), { from: lineStart(5), to: lineEnd(5) }, '行首也是整行')
  assert.deepEqual(navigationRange(base, lineEnd(11)), { from: lineStart(11), to: lineEnd(11) }, '文档末尾不越界')
  assert.deepEqual(navigationRange(base, DOC.length + 50), { from: lineStart(11), to: lineEnd(11) }, '越界的偏移夹到最后一行')
  // 调用方给了一段（用法列表里那种）时按那一段算，不再退化成整行。
  assert.deepEqual(navigationRange(base, lineStart(5), lineStart(5) + 1), { from: lineStart(5), to: lineStart(5) + 1 })
  assert.deepEqual(navigationRange(base, lineStart(5), lineStart(4)), { from: lineStart(5), to: lineEnd(5) }, '反向的段不当段用')
  assert.deepEqual(navigationRange(base, lineStart(5), lineStart(5)), { from: lineStart(5), to: lineEnd(5) }, '空段也不当段用')
})

test('展开与导航段**相交**的折痕：含端点（TextRange.java:237-238 的 intersects，不是 intersectsStrict）', () => {
  // 第 4 行（`d`）不在任何区间里 ⇒ 一个都不动。
  const nowhere = fakeView(foldedAll())
  assert.equal(unfoldIntersecting(nowhere, lineStart(4), lineEnd(4)), false, '落点在空处')
  assert.deepEqual(spans(nowhere.state), [SPAN_1, SPAN_2, SPAN_3])
  // 搭在第 5–7 行那条的起点上（上一行的行尾 → 这一行的行首）：`max(lineStart5, lineEnd4) <= min(lineEnd7, lineStart5)`
  // ⇒ 含端点的 intersects 成立 ⇒ 上游把这条打开（本批订正的那一档）。
  const touching = fakeView(foldedAll())
  assert.equal(unfoldIntersecting(touching, lineEnd(4), lineStart(5)), true, '只搭一个端点也算相交')
  assert.deepEqual(spans(touching.state), [SPAN_1, SPAN_3], '只动搭上的那一条')
  // 落在第 7 行（那区间的末行）⇒ 只打开那一条。
  const view = fakeView(foldedAll())
  const range = navigationRange(view.state, lineStart(7))
  assert.equal(unfoldIntersecting(view, range.from, range.to), true)
  assert.deepEqual(spans(view.state), [SPAN_1, SPAN_3], '另外两条保持折着')
  // 空行那种零长导航段（`from === to`）上游照样算：`getLineEndOffset` 对空行就等于 `getLineStartOffset`
  // （`OpenFileDescriptor.java:218-220`），而 intersects 含端点 ⇒ 压在块起点上的那一行要把这块打开。
  const zeroLength = fakeView(foldedAll())
  assert.equal(unfoldIntersecting(zeroLength, lineStart(5), lineStart(5)), true, '零长段落在折痕起点上算相交')
  assert.deepEqual(spans(zeroLength.state), [SPAN_1, SPAN_3])
  // 反向的段（`to < from`）不是导航段。
  assert.equal(unfoldIntersecting(fakeView(foldedAll()), lineStart(5), lineStart(5) - 1), false)
})

test('跨多条折痕的导航段把它们一起打开', () => {
  const view = fakeView(foldedAll())
  assert.equal(unfoldIntersecting(view, lineStart(2), lineEnd(10)), true)
  assert.deepEqual(spans(view.state), [], '与三条都相交 ⇒ 全开')
})

test('管道第 ⑦ 步：导航后紧接着的那一轮重算不会把它折回去，之后就不管了', async () => {
  const IMPORTS = [{ startLine: 0, endLine: 2, kind: 'imports' }, { startLine: 4, endLine: 6, kind: 'imports' }]
  const view = fakeView(EditorState.create({ doc: DOC, extensions: [codeFolding(), foldingRanges] }))
  const folding = createFoldingController({
    path: () => 'navigate-unfold.java',
    view: () => view,
    foldingKinds: () => [{ kind: 'imports', collapse: true }],
    fetchRanges: async () => IMPORTS,
  })
  await folding.run()
  assert.deepEqual(spans(view.state), [[lineStart(1), lineEnd(3)], [lineStart(5), lineEnd(7)]],
    '两条 imports 都按默认折着（collapseImports 的预折叠就是这一步）')
  const jumped = folding.navigateToRange(lineStart(6))
  assert.equal(jumped, true, '跳进去的那一块当场打开')
  assert.deepEqual(spans(view.state), [[lineStart(1), lineEnd(3)]], '第 5–7 行那条没了')
  await folding.run()
  assert.deepEqual(spans(view.state), [[lineStart(1), lineEnd(3)]],
    '这一轮是重算：④ 不再按默认折（NO 那一档），⑥ 的存档也只把 [1–3] 放回折着 ⇒ 导航打开的那块保持展开')
  // 用户自己把那块折回去 ⇒ 一次导航只管一次重算，不该跟用户抢。
  view.dispatch({ effects: foldEffect.of({ from: lineStart(5), to: lineEnd(7) }) })
  await folding.run()
  assert.deepEqual(spans(view.state), [[lineStart(1), lineEnd(3)], [lineStart(5), lineEnd(7)]],
    '第二次重算不再管它（pending 已被消费）')
})

test('管道第 ④ 步只在「第一次给这份文件建区间」时按默认折（FoldingUpdate.java:83-101 + shouldExpandNewRegion:243-255）', async () => {
  const FIRST = [{ startLine: 0, endLine: 2, kind: 'imports' }]
  let give = FIRST
  const view = fakeView(EditorState.create({ doc: DOC, extensions: [codeFolding(), foldingRanges] }))
  const folding = createFoldingController({
    path: () => 'defaults-first-time.java',
    view: () => view,
    foldingKinds: () => [{ kind: 'imports', collapse: true }],
    fetchRanges: async () => give,
  })
  await folding.run()
  assert.deepEqual(spans(view.state), [[lineStart(1), lineEnd(3)]], '第一次建区间 = 上游的 firstTime ⇒ EXCEPT_CARET_REGION，按默认折')
  // 编辑之后长出的第二块 import（老那块边界不变）：上游这一轮走 ApplyDefaultStateMode.NO，
  // `shouldExpandNewRegion:253-254` 的 `oldStatus == null` 那一支 ⇒ **新块保持展开**。
  give = [...FIRST, { startLine: 6, endLine: 8, kind: 'imports' }]
  await folding.run()
  assert.deepEqual(spans(view.state), [[lineStart(1), lineEnd(3)]],
    '重算轮次不许把新出现的块按默认折上（光标在第 1 行、不在这块里，所以不是 caretInsideRange 挡的）')
  // 宿主那条「设置一改就重算」不在管道里 ⇒ 对应上游 applyCodeFoldingSettingsChanges，当场施加默认。
  folding.applyDefaults()
  assert.deepEqual(spans(view.state), [[lineStart(1), lineEnd(3)], [lineStart(7), lineEnd(9)]],
    '刚勾上开关就要把这一族折起来')
})

test('第一轮回包是空表时不算「已经建过折叠」（否则打开文件时的默认折叠会永久错过）', async () => {
  let give = []
  const view = fakeView(EditorState.create({ doc: DOC, extensions: [codeFolding(), foldingRanges] }))
  const folding = createFoldingController({
    path: () => 'defaults-empty-first.java',
    view: () => view,
    foldingKinds: () => [{ kind: 'imports', collapse: true }],
    fetchRanges: async () => give,
  })
  await folding.run()
  assert.deepEqual(spans(view.state), [], '空表这一轮什么也没折')
  give = [{ startLine: 4, endLine: 6, kind: 'imports' }]
  await folding.run()
  assert.deepEqual(spans(view.state), [[lineStart(5), lineEnd(7)]],
    '语言服务起来之后的那轮回包仍然是「第一次建区间」⇒ 按默认折')
})

test('接线：⑦ 排在 ⑥ 之后，宿主拿得到 navigateToRange', () => {
  const controller = read('src/editorFoldingController.ts')
  const run = controller.slice(controller.indexOf('async function run()'))
  const restore = run.indexOf('restore()')
  const navigation = run.indexOf('applyNavigation(target)')
  assert.ok(restore > 0, '管道第 ⑥ 步还在')
  assert.ok(navigation > restore, '⑦ 必须在 ⑥ 之后：restore 会把按签名认回的块放回来，导航那一段要顶在它后面')
  assert.match(controller, /return \{ schedule, run, capture, restore, applyDefaults, navigateToRange, dispose \}/)
  const folding = read('src/editorFolding.ts')
  assert.match(folding, /export function unfoldIntersecting\(view: EditorView, from: number, to: number\): boolean/,
    '展开那一步只有一份实现')
})
