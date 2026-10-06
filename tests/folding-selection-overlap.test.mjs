// 「折叠选区/移除区域」重叠那一档里，用户按**确定**之后要做的那一步
// （`docs/inventory/verdict-folding.md` §G 的 `CollapseSelectionHandler` 行：
// 「缺 `:44` 的提示与 `:49-58` 的模态确认框」—— 提示文案与默认「取消」上一批已经落，
// 本批把「确定」那一条规则落到模块侧，弹框本身要宿主 ⇒ 接线请求）。
//
// 上游坐标（逐行核过）：
//   · `platform/foldings/src/com/intellij/codeInsight/folding/impl/CollapseSelectionHandler.java:49-58`
//     —— `Messages.showDialog(..., {OK, CANCEL}, 1 /* 默认按钮是 CANCEL */, WARNING)`，
//     返回值不是 0（= 没按确定）就直接 `return`；
//   · `:59-65` 按确定后移除**跨过选区边界**的那些区间（上游两个析取式；本仓只有第一条可达，
//     理由与实测判据写在下面那条「不可达」用例和 `src/editorFolding.ts` 的代码注释里）；
//   · `:66-71` 再把选区本身折起来：`addFoldRegion(start, end, ourPlaceHolderText)`
//     + `region.setExpanded(false)` + 光标 `min(start + ourPlaceHolderText.length(), textLength)`；
//   · `:22` `ourPlaceHolderText = "..."`（与 `UpdateFoldRegionsOperation.java:162` 那个默认占位同值）。
//
// 判据为什么要看**发出去的效果**而不只看结果状态：CodeMirror 的 foldState 会把
// 「光标落在里面」的那条折叠当场解掉，而本仓这一步会把光标放到选区起点 ——
// 于是「跨过左边界」那条即使代码不拆它也会因为光标而消失。只看状态测不出这一支，
// 所以这里钉的是 `unfoldEffect` 的清单（少拆/多拆都会红）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { codeFolding, foldEffect, foldedRanges, unfoldEffect } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { FOLD_PLACEHOLDER_TEXT, collapseSelectionAfterOverlapConfirm, foldingRanges } from '../src/editorFolding.ts'

const DOC = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'].join('\n')
const bare = EditorState.create({ doc: DOC, extensions: [codeFolding(), foldingRanges] })
const start = line => bare.doc.line(line).from
const stop = line => bare.doc.line(line).to

/** 跑得动 dispatch 的假 view，顺带把每次发出去的规格记下来（EditorView 在这里只被按 {state, dispatch} 用）。 */
function fakeView(initial) {
  let current = initial
  const specs = []
  return {
    get state() { return current },
    dispatch: spec => { specs.push(spec); current = current.update(spec).state },
    specs,
  }
}

/** 先折几条，再把选区设成 from..to。 */
function prepared(folds, from, to) {
  const folded = bare.update({ effects: folds.map(([a, b]) => foldEffect.of({ from: a, to: b })) }).state
  return fakeView(folded.update({ selection: { anchor: from, head: to } }).state)
}

const spans = state => {
  const out = []
  for (const iterator = foldedRanges(state).iter(); iterator.value; iterator.next()) out.push([iterator.from, iterator.to])
  return out
}
/** 这一次 dispatch 里被拆掉的区间（= 上游 `removeFoldRegion` 那一支）。 */
const removed = view => view.specs.at(-1).effects
  .filter(effect => effect.is(unfoldEffect))
  .map(effect => [effect.value.from, effect.value.to])
/** 这一次 dispatch 里新折上的区间（= 上游 `addFoldRegion(...)` + `setExpanded(false)`）。 */
const added = view => view.specs.at(-1).effects
  .filter(effect => effect.is(foldEffect))
  .map(effect => [effect.value.from, effect.value.to])

test('占位文字与上游同值（`:22` 那一条就是三个点）', () => {
  assert.equal(FOLD_PLACEHOLDER_TEXT, '...')
})

test('左边界被跨过的那条被移除，选区本身折起来（:59-65 第一个析取式 + :66-71）', () => {
  // 折着第 2–5 行；选区第 3–7 行 ⇒ 起点在选区之前、终点落在选区之内。
  const view = prepared([[start(2), stop(5)]], start(3), stop(7))
  assert.equal(collapseSelectionAfterOverlapConfirm(view), 'collapsed')
  assert.deepEqual(removed(view), [[start(2), stop(5)]], '拆的正是跨过左边界那一条')
  assert.deepEqual(added(view), [[start(3), stop(7)]])
  assert.deepEqual(spans(view.state), [[start(3), stop(7)]], '旧的那条没了，只剩按选区新折的那条')
  assert.equal(view.state.selection.main.from, start(3), '光标停在折痕的起点')
  assert.equal(view.state.selection.main.to, start(3), '光标不带走一段选区')
})

test('跨过右边界那一支在本仓不可达：设选区时那条就已经被拆掉了（所以实现里只留第一支）', () => {
  // 上游第二个析取式 = 「起点落在选区里、终点在选区之后」⇒ 选区头必然在那条区间**里面**。
  const folded = bare.update({ effects: [foldEffect.of({ from: start(5), to: stop(9) })] }).state
  assert.deepEqual(spans(folded), [[start(5), stop(9)]], '先把这条折上')
  const selected = folded.update({ selection: { anchor: start(3), head: stop(7) } }).state
  assert.deepEqual(spans(selected), [],
    '选区头落进它里面 ⇒ CodeMirror 的 foldState 当场解掉 ⇒ 走到「按确定」这一步时已经没有这种区间')
})

test('只搭边界 / 整个套在选区里面的都不动（那一支的三个界）', () => {
  // 折着第 1–3 行，选区从第 3 行的行尾开始 ⇒ `to > start` 不成立 ⇒ 不算跨过。
  const touching = prepared([[start(1), stop(3)]], stop(3), stop(6))
  assert.equal(collapseSelectionAfterOverlapConfirm(touching), 'collapsed')
  assert.deepEqual(removed(touching), [], '只搭端点不动它')
  assert.deepEqual(spans(touching.state), [[start(1), stop(3)], [stop(3), stop(6)]])
  // 折着的那条整个在选区里面：两个析取式都不认它 ⇒ 保留（新折的套在它外面）。
  const inside = prepared([[start(4), stop(5)]], start(3), stop(7))
  assert.equal(collapseSelectionAfterOverlapConfirm(inside), 'collapsed')
  assert.deepEqual(removed(inside), [], '整条被选区套住的不算「跨过边界」')
  assert.deepEqual(spans(inside.state), [[start(3), stop(7)], [start(4), stop(5)]])
  // 注：`bounds.to < end` 与 `<=` 的差别只能看**发出去的效果**：这一档（尾对尾）里本仓还要把光标
  // 放到选区起点（落进旧区间里面），CodeMirror 于是把旧区间一并解掉 ⇒ 只看最终状态分不出两者。
  const sameTail = prepared([[start(2), stop(5)]], start(3), stop(5))
  assert.equal(collapseSelectionAfterOverlapConfirm(sameTail), 'collapsed')
  assert.deepEqual(removed(sameTail), [], '尾对尾不算「跨过起点」（上游 `:61` 写的是 `getEndOffset() < end`）')
  assert.deepEqual(spans(sameTail.state), [[start(3), stop(5)]],
    '旧的那条是被「光标落进里面就解掉」这一条规则拆的，不是这一步拆的')
  // 「选区头严格落在区间里面」那种情形才真的走不到比较 to 的那一步 —— 见上面那条「跨过右边界不可达」。
})

test('选区尾部的换行被剥掉（:31-33 那一刀），空选区什么都不做', () => {
  const view = prepared([], start(2), stop(4) + 1)   // 选区末尾带换行
  assert.equal(collapseSelectionAfterOverlapConfirm(view), 'collapsed')
  assert.deepEqual(added(view), [[start(2), stop(4)]], '折到第 4 行的行尾，不含换行')
  const empty = prepared([], start(3), start(3))
  assert.equal(collapseSelectionAfterOverlapConfirm(empty), 'nothing', '没有选区就不该走这一步（那是「切换光标处最内层」那一档）')
  assert.deepEqual(spans(empty.state), [])
})

test('三条里只拆中间那条（那一支不会误伤别条）', () => {
  const view = prepared([[start(1), stop(2)], [start(4), stop(8)], [start(10), stop(11)]], start(6), stop(9))
  assert.equal(collapseSelectionAfterOverlapConfirm(view), 'collapsed')
  assert.deepEqual(removed(view), [[start(4), stop(8)]], '只有第 4–8 行那条跨过选区起点')
  assert.deepEqual(spans(view.state), [[start(1), stop(2)], [start(6), stop(9)], [start(10), stop(11)]])
})

test('默认那一条仍然是「取消」：`foldSelectionOutcome` 的 overlapping 不动任何东西', async () => {
  const { foldSelectionOutcome } = await import('../src/editorFolding.ts')
  const view = prepared([[start(4), stop(9)]], start(6), stop(11))
  assert.equal(foldSelectionOutcome(view), 'overlapping', '跨过边界 ⇒ 上游在这里弹框')
  assert.deepEqual(spans(view.state), [[start(4), stop(9)]], '没按确定 ⇒ 与改动前一样，一条都不动')
  assert.equal(collapseSelectionAfterOverlapConfirm(view), 'collapsed', '按了确定才走上面那一条路')
  assert.deepEqual(spans(view.state), [[start(6), stop(11)]])
})

test('光标落在折痕里面会让那条折不上（本仓落点与上游差一个占位长度的理由）', () => {
  // 同一批 foldEffect，唯一区别是光标停哪儿：区间内 ⇒ CodeMirror 当场解掉。
  const inside = bare.update({
    effects: [foldEffect.of({ from: start(3), to: stop(7) })],
    selection: { anchor: start(3) + FOLD_PLACEHOLDER_TEXT.length },
  }).state
  assert.deepEqual(spans(inside), [], '光标在区间内 ⇒ 折不上')
  const edge = bare.update({
    effects: [foldEffect.of({ from: start(3), to: stop(7) })],
    selection: { anchor: start(3) },
  }).state
  assert.deepEqual(spans(edge), [[start(3), stop(7)]], '停在起点 ⇒ 留住 ⇒ 本仓把光标放在折痕起点')
})
