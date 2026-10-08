// Code Vision 的**刷新时机**（`src/codeLens.ts` 的延迟策略 + `src/codeLensExtension.ts` 的控制器）：
//   · 打开 / 编辑 / 重新获得焦点三档延迟；
//   · 请求在飞时的重复触发**排队补跑一次**（原来会被吞掉，编辑后条目一直不刷新）；
//   · `reset()`（切文件 / 关 LSP）之后，在飞的那次答案不再落盘；
//   · **陈旧判据是文档修订号**（上游 `LspHighlightingCache.kt:68-71`/`:92`/`:173` 读的是
//     `Document.modificationStamp`，`Document.java:25` 「正文变了才换号」）：正文没变 ⇒ 不重问第二次，
//     正文在飞期间变了 ⇒ 那份按旧行号算的答案**不收**，立刻按新号再问一次。
//
// 假 view 是**真的 `EditorState`**（`@codemirror/state`）：修订号读的是 `view.state.doc` 那个不可变 `Text`
// 对象的身份（`src/semanticHighlighting.ts:339-354`），所以判据必须让"改正文""改选区""派发装饰"三种事务
// 各自真的落到状态上，否则这一档就成了空对空。只把 `window` 借给控制器（Node 里没有 DOM）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { EditorState } from '@codemirror/state'

import { CODE_LENS_REFRESH, codeLensRefreshDelay } from '../src/codeLens.ts'
import { LOW_PRIORITY_QUIESCENCE_MS } from '../src/lspHighlightingCache.ts'
import { createCodeLens } from '../src/codeLensExtension.ts'

globalThis.window = { setTimeout, clearTimeout }

const FAST = { openMs: 1, changeMs: 1, focusMs: 1 }
const DOC = 'class Demo {\n  void run() {}\n}\n'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const deferred = () => {
  let settle
  const promise = new Promise(resolve => { settle = resolve })
  return { promise, resolve: settle }
}

/**
 * 真形状的一次编辑器 + 一个控制器。`dispatch` 把事务**真的作用到 state 上**（这样修订号才跟着动），
 * 同时记进 `dispatched`（判据数的是"控制器往编辑器派了几次结果"）。
 * `editDoc` / `moveCaret` 走的是编辑器内部那一类事务（打字、点选），不记进 `dispatched` ——
 * 那两个动作在真编辑器里由 `EditorView` 自己派发，与"结果落盘"不是同一件事。
 */
function harness(options = {}) {
  const view = { dispatched: [], state: EditorState.create({ doc: DOC }) }
  view.dispatch = spec => { view.state = view.state.update(spec).state; view.dispatched.push(spec) }
  const controller = createCodeLens({
    query: options.query ?? (async () => ({ available: true, items: [] })),
    enabled: options.enabled ?? (() => true),
    view: () => view,
    onCommand: () => {},
    policy: options.policy ?? FAST,
    ...(options.local ? { local: options.local } : {}),
    ...(options.localChannel ? { localChannel: options.localChannel } : {}),
  })
  // 控制器的扩展要进状态（`setCodeLens` 那条 effect 落在它的那个 StateField 上）。
  view.state = EditorState.create({ doc: DOC, extensions: [controller.extension] })
  return { view, controller }
}

/** 一次真的正文变更（打字一格）：换一个新的 `Text` 对象 ⇒ 修订号必须变。 */
function editDoc(view) {
  view.state = view.state.update({ changes: { from: 0, insert: 'x' } }).state
}

/** 只把光标挪一下：正文没动 ⇒ 修订号不许变（这正是"每事务计数"那一类假号源会误判的地方）。 */
function moveCaret(view) {
  view.state = view.state.update({ selection: { anchor: 5 } }).state
}

test('刷新延迟按触发点分档：打开 0 / 编辑 300（上游低优先级那一族）/ 焦点 700', () => {
  assert.deepEqual(CODE_LENS_REFRESH, { openMs: 0, changeMs: LOW_PRIORITY_QUIESCENCE_MS, focusMs: 700 })
  assert.equal(codeLensRefreshDelay('open'), 0)
  assert.equal(codeLensRefreshDelay('change'), 300)
  assert.equal(codeLensRefreshDelay('focus'), 700)
  assert.equal(codeLensRefreshDelay('focus', { openMs: 1, changeMs: 2, focusMs: 3 }), 3, '策略可覆盖')
})

// 「这个数字与上游那一条同源」的取证 —— 三条各挡一种漂法：
//   ① 数值自己漂（历史上这里是 400，注释却自称"与其它 LSP 能力同档"）；
//   ② 把数字复制过来而不是复用同一份常量（两份"300"日后各改各的，同源成空话）；
//   ③ 注释里删掉上游坐标 ⇒ "同源"这句话没有可核对的出处。
// 上游那一条：platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt:328
// `val LOW_PRIORITY_QUIESCENCE_DELAY: Duration = 300.milliseconds`（缺省由同文件 :52 的
// `quiescenceDelay` 取用；`:324-327` 原文把 code lens 点名在这一族里）。
test('编辑档与上游同源：同一个常量、同一个数值、注释钉着上游坐标', () => {
  assert.equal(CODE_LENS_REFRESH.changeMs, LOW_PRIORITY_QUIESCENCE_MS, '编辑档不再是上游低优先级那一档')
  assert.equal(LOW_PRIORITY_QUIESCENCE_MS, 300, '本仓那一档自己漂了（上游 = 300.milliseconds）')
  const lens = readFileSync('src/codeLens.ts', 'utf8')
  assert.match(lens, /changeMs: LOW_PRIORITY_QUIESCENCE_MS/, '又变回自己另写的一个毫秒数（数字复制体）')
  assert.match(lens, /highlightingCommon\/LspHighlightingCache\.kt:328/, '编辑档没钉上游坐标 ⇒ "同源"无取证')
})

test('去抖窗口里的重复触发只问一次，答案落进编辑器', async () => {
  let calls = 0
  const { view, controller } = harness({ query: async () => { calls++; return { available: true, items: [] } } })
  controller.schedule('change')
  controller.schedule('change')
  controller.schedule('change')
  await sleep(30)
  assert.equal(calls, 1)
  assert.equal(view.dispatched.length, 1, '结果要 dispatch 进编辑器（假 view 只记录）')
})

test('正文没变的重复触发不再问第二次；正文真的变了才再问（上游 :68-71 + :92 那一档）', async () => {
  let calls = 0
  const { view, controller } = harness({ query: async () => { calls++; return { available: true, items: [] } } })
  controller.schedule('change')
  await sleep(30)
  assert.equal(calls, 1, '第一问该发出去')
  assert.equal(view.dispatched.length, 1, '答案落盘一次')

  // ① 宿主在 `update.docChanged` 之外也可能补一拍（补跑、重复的 watch）：正文没变 ⇒ 这些都不该再问服务器。
  controller.schedule('change')
  controller.schedule('change')
  await sleep(30)
  assert.equal(calls, 1, '正文没变还去重问一次整文档的 codeLens（上游 :69 的判据是快照的号 != 当前号）')

  // ② 只改选区：`Text` 对象没换 ⇒ 号没变 ⇒ 仍然不重问。
  moveCaret(view)
  controller.schedule('change')
  await sleep(30)
  assert.equal(calls, 1, '把"改选区"当成了"改正文"（号源必须是文档修订，不是每事务计数）')

  // ③ 真改一格正文：号换了 ⇒ 必须再问一次（否则屏幕上的条目是对旧文档算的）。
  editDoc(view)
  controller.schedule('change')
  await sleep(30)
  assert.equal(calls, 2, '正文变了却没有重问')
  assert.equal(view.dispatched.length, 2)
})

test('焦点回来 / 本地通道抓完一轮不是"正文变了"，仍然要重问', async () => {
  let calls = 0
  const { controller } = harness({ query: async () => { calls++; return { available: true, items: [] } } })
  controller.schedule('change')
  await sleep(30)
  assert.equal(calls, 1, '第一问该发出去')
  // 这两档**不受**"正文没变 ⇒ 不重问"那一档压：去别的视图改了引用、或本地计数刚抓完，
  // 本篇正文一个字都没动，条目却是旧的（见 `src/codeLensExtension.ts` 的 `schedule` 注释）。
  controller.schedule('focus')
  await sleep(30)
  assert.equal(calls, 2, '重新拿到焦点后没有补刷')
  controller.schedule('open')
  await sleep(30)
  assert.equal(calls, 3, '本地通道抓完一轮后没有补刷')
})

test('请求在飞时的编辑触发排队补跑一次，不再丢刷新', async () => {
  const first = deferred()
  let calls = 0
  const { view, controller } = harness({
    query: () => { calls++; return calls === 1 ? first.promise : Promise.resolve({ available: true, items: [] }) },
  })
  controller.schedule('open')
  await sleep(15)
  assert.equal(calls, 1, '第一次请求已经发出、还在飞')
  editDoc(view)                  // 在飞期间真的改了正文（`CodeEditor.vue:1010` 那一句就是这个时机）
  controller.schedule('change')  // ⇒ 攒一次补跑，而不是把它吞掉
  first.resolve({ available: true, items: [] })
  await sleep(40)
  assert.equal(calls, 2, '补跑了一次，而不是把这次编辑吞掉')
  assert.equal(view.dispatched.length, 1, '在飞期间正文变了 ⇒ 那份答案的行列是对旧文档算的，整份不收（上游 :173-176），只有补跑那一次落盘')
})

test('disable 状态下不请求；dispose 后到点的定时器不再请求', async () => {
  let calls = 0
  const query = async () => { calls++; return { available: false, items: [] } }
  const off = harness({ query, enabled: () => false })
  off.controller.schedule('change')
  await sleep(20)
  assert.equal(calls, 0)

  const { controller } = harness({ query })
  controller.schedule('change')
  controller.dispose()
  await sleep(20)
  assert.equal(calls, 0, 'dispose 清掉了未到点的定时器')
})

test('reset 之后，在飞的那次答案不再落盘', async () => {
  const first = deferred()
  let calls = 0
  const { view, controller } = harness({ query: () => { calls++; return first.promise } })
  controller.schedule('open')
  await sleep(15)
  assert.equal(calls, 1)
  controller.reset()
  const afterReset = view.dispatched.length
  first.resolve({ available: true, items: [] })
  await sleep(20)
  assert.ok(afterReset >= 1, 'reset 自己要把屏幕上的条目清掉（`setCodeLens.of([])`）')
  assert.equal(view.dispatched.length, afterReset, '过期的答案不许再 dispatch')
  assert.equal(calls, 1)
})
