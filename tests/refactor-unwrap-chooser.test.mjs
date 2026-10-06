// Unwrap 多候选 chooser 的**模块侧形状与判据**（桶 1 / A6，`src/unwrap.ts` 末尾那一节）。
//
// 上游权威：
//   · `platform/lang-impl/src/com/intellij/codeInsight/unwrap/UnwrapHandler.java:80-91`
//     —— `selectOption`：列表空就什么都不做；非空且 `showOptionsDialog()` 为真（默认档）就
//     **一律弹层**，只有单元测试模式才直接 `options.get(0).perform()`。
//   · `UnwrapDescriptorBase.java:67-69` —— `showOptionsDialog()` 恒真。
//   · `UnwrapHandler.java:93-121` —— `showPopup()`：`:101` 标题 `unwrap.popup.title`、
//     `:104` 单选、`:107` 选中即执行、`:108` 选中行时用 `ScopeHighlighter` 高亮那一层。
//   · `platform/lang-api/resources/messages/CodeInsightBundle.properties:52`
//     = `Choose the statement to unwrap/remove`（中文包不在本地树 ⇒ 按英文原文直译）。
//   · `UnwrapDescriptorBase.collectUnwrappers`（`:33-47`，`:45` 走 `e = e.getParent()`）由内向外 ⇒ 候选次序是**最内层在前**。
// 弹层 UI 与键位挂载在 `src/editorCommands.ts` / `src/components/CodeEditor.vue`（别桶名下），
// 所以这里只钉模块侧那一半；接线见 `docs/wiring-requests-2026-10-06-format.md` W2。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  UNWRAP_CHOOSER_TITLE, createUnwrapApplyCommand, findUnwrapCandidates,
  unwrapChooserItems, unwrapChooserNeeded, unwrapEditIntact,
} from '../src/unwrap.ts'

const nested = [
  'void run() {',
  '    for (int i = 0; i < n; ++i) {',
  '        if (ready) {',
  '            work();',
  '        }',
  '    }',
  '}',
  '',
].join('\n')

test('弹层标题取上游那一句（本仓按英文原文直译）', () => {
  assert.equal(UNWRAP_CHOOSER_TITLE, '选择要拆掉/移除的语句')
})

test('候选 → 弹层行：下标、标签、关键字与该层区间，最内层在前', () => {
  const cursor = nested.indexOf('work()') + 2
  const candidates = findUnwrapCandidates(nested, cursor, cursor, 4)
  const items = unwrapChooserItems(candidates)
  assert.deepEqual(items, candidates.map((candidate, index) => ({
    index,
    label: candidate.label,
    keyword: candidate.keyword,
    from: candidate.edit.from,
    to: candidate.edit.to,
  })))
  // 逐条钉住值：两层（if / for）、次序内→外、行下标连续。
  assert.deepEqual(items.map(item => [item.index, item.keyword, item.label]), [
    [0, 'if', '拆掉 if 包裹'],
    [1, 'for', '拆掉 for 包裹'],
  ])
  assert.ok(items[0].from < cursor && items[0].to > cursor, '这一层的区间包住光标')
  assert.ok(items[1].from < items[0].from && items[1].to > items[0].to, '外层把内层整条盖住')
})

test('要不要弹层：空列表不弹（上游 selectOption 直接 return），非空就弹（哪怕只有一条）', () => {
  assert.deepEqual(unwrapChooserItems([]), [])
  assert.equal(unwrapChooserNeeded([]), false)
  const single = findUnwrapCandidates('if (x) { doWork() }\n', 10, 10, 4)
  assert.equal(single.length, 1)
  assert.equal(unwrapChooserNeeded(single), true,
    '上游 UnwrapHandler.java:80-91：只有一条也弹层（本仓现状是直接拆，差异记在请求 W2）')
})

test('落笔前回验偏移：弹层期间文档被别处改动 ⇒ 这条编辑站不住，返回 false 且不发 dispatch', () => {
  const text = 'if (a) {\n  b();\n}\n'
  const [candidate] = findUnwrapCandidates(text, 12, 12, 4)
  assert.equal(unwrapEditIntact(text, candidate.edit), true)
  assert.equal(unwrapEditIntact('if (a) {\n  b();\nxx\n', candidate.edit), false, '闭括号那行被改掉了')
  assert.equal(unwrapEditIntact('', candidate.edit), false, '文本整体变短：to 越界')
  assert.equal(unwrapEditIntact('x'.repeat(40), { from: 5, to: 3, insert: '' }), false, 'to <= from 是坏区间')
})

test('选中的那一条真的落笔：区间、正文与 userEvent 都与最内层那条一致', () => {
  const view = fakeView(nested)
  const calls = view.calls
  const cursor = nested.indexOf('work()') + 2
  const candidates = findUnwrapCandidates(nested, cursor, cursor, 4)
  // 选**外层**（for）那一条 —— 与 createUnwrapCommand 的默认（最内层）不同，这才是 chooser 的意义。
  const chosen = candidates[1]
  assert.equal(createUnwrapApplyCommand(chosen.edit)(view), true)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].changes, { from: chosen.edit.from, to: chosen.edit.to, insert: chosen.edit.insert })
  assert.equal(calls[0].selection.anchor, chosen.edit.from + chosen.edit.insert.length)
  assert.equal(calls[0].userEvent, 'delete.unwrap')
  assert.equal(calls[0].scrollIntoView, true)
  // 拆完 for 那一层：for 头与它的括号都没了，正文回缩一层，if 还在。
  assert.ok(!calls[0].changes.insert.includes('for (int i'), '拆掉的文本里没有 for 头')
  assert.ok(calls[0].changes.insert.includes('if (ready)'), '内层 if 原样留着（本仓一次只拆一层）')
})

/** 只用到 Command 需要的两个成员：`state.doc.toString()` 与 `dispatch()`。 */
function fakeView(text) {
  const calls = []
  return {
    calls,
    state: { doc: { toString: () => text } },
    dispatch: spec => { calls.push(spec) },
  }
}

test('假象自检：坏区间的那条编辑不会 dispatch（反向验证用的那条守卫）', () => {
  const view = fakeView('if (a) {\n  b();\n}\n')
  assert.equal(createUnwrapApplyCommand({ from: 0, to: 19, insert: 'x' })(view), false)
  assert.deepEqual(view.calls, [])
})
