// Code Vision 的**本地提供者通道**接进渲染通道（`src/codeLensExtension.ts` 的 `local` 依赖）。
//
// 验的是上游那两个来源的分工：内置的那一组 provider（usages / inheritors / problems / …）
// 挂在 EP 上、**不经过 LSP**，所以服务端没有 `textDocument/codeLens` 能力时那一行上方
// 仍然要有条目（`src/codeVisionProviders.ts` 的 `problems` 提供者把本仓诊断按作用域符号归并）。
// 断言都在合流后的 lens 列表上做 —— 那正是 `setCodeLens` 落进编辑器的东西。

import test from 'node:test'
import assert from 'node:assert/strict'

import { EditorState } from '@codemirror/state'

import { createCodeLens } from '../src/codeLensExtension.ts'
import { anchorCodeVisionEntries, problemsVisionProvider, createCodeVisionRegistry } from '../src/codeVisionProviders.ts'
import { groupAnchoredLenses } from '../src/codeLens.ts'

// 本文件是纯 JS（`package.json` 的 test 脚本不带 `--experimental-strip-types`），
// 类型只能用 JSDoc 标注 —— `import type { … }` 的修饰符擦不掉，会让整个文件加载失败。
/** @typedef {import('../src/codeVisionProviders.ts').CodeVisionEntry} CodeVisionEntry */

globalThis.window = { setTimeout, clearTimeout }

const FAST = { openMs: 1, changeMs: 1, focusMs: 1 }
const DOC = 'class Demo {\n  void run() {}\n}\n'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 真形状的假 view：`state` 是**真的 `EditorState`**（控制器读的那份文档修订号就是 `state.doc` 这个
 * 不可变 `Text` 对象的身份，见 `src/semanticHighlighting.ts:339-354`），`dispatch` 把事务真的作用到
 * 状态上、同时记进 `dispatched`（判据数的是"控制器往编辑器派了几次结果"）。
 */
function fakeView(doc = DOC) {
  const view = { dispatched: [], state: EditorState.create({ doc }) }
  view.dispatch = spec => { view.state = view.state.update(spec).state; view.dispatched.push(spec) }
  return view
}

/** 起一条真通道：假 view + 控制器，并把控制器的扩展装进那个 state（`setCodeLens` 的 StateField 才认这条 effect）。 */
function viewOf(deps) {
  const view = fakeView()
  const controller = createCodeLens({ enabled: () => true, view: () => view, onCommand: () => {}, policy: FAST, ...deps })
  view.state = EditorState.create({ doc: DOC, extensions: [controller.extension] })
  return { view, controller }
}

/** 起一次刷新，把落进编辑器的那份 lens 列表取出来。 */
async function renderLenses({ query, local }) {
  const { view, controller } = viewOf({ query, ...(local ? { local } : {}) })
  controller.schedule('open')
  await sleep(30)
  const last = view.dispatched[view.dispatched.length - 1]
  assert.ok(last, '结果要 dispatch 进编辑器')
  // `dispatch({ effects: setCodeLens.of(lenses) })` 里 `spec.effects` 装的是 **StateEffect**，
  // 那份 `AnchoredLens[]` 在它的 `.value` 上。两种形状（单个 effect / effect 数组）都兜住。
  const effects = Array.isArray(last.effects) ? last.effects : [last.effects]
  const effect = effects[0]
  assert.ok(effect, 'dispatch 的 spec 里要有一个 effect')
  return effect.value ?? []
}

const serverLens = (startLine, title, startChar = 0) => ({
  title, command: 'server.cmd',
  range: { startLine, startChar, endLine: startLine, endChar: startChar },
})
const localEntry = (line, title) => ({ line, title, command: 'codeVision.showProblems', arguments: [{ path: 'a.java', line }] })

test('服务端没有 codeLens 能力时，本地条目照样渲染（上游那组 provider 不经过 LSP）', async () => {
  const lenses = await renderLenses({
    query: async () => ({ available: false }),
    local: () => [localEntry(9, '2 个错误')],
  })
  assert.equal(lenses.length, 1, 'available:false 不该把本地条目一起清空')
  assert.equal(lenses[0].item.title, '2 个错误')
  assert.equal(lenses[0].line, 9)
})

test('服务端查询抛错时也只清服务端那半，本地条目留着', async () => {
  const lenses = await renderLenses({
    query: async () => { throw new Error('no codeLens capability') },
    local: () => [localEntry(3, '1 个警告')],
  })
  assert.deepEqual(lenses.map(lens => lens.item.title), ['1 个警告'])
})

test('同一行同标题去重，本地优先；两侧按行升序合流', async () => {
  const lenses = await renderLenses({
    query: async () => ({ available: true, items: [serverLens(20, '3 个引用'), serverLens(5, '1 个错误')] }),
    local: () => [localEntry(10, '2 个错误'), localEntry(5, '1 个错误')],
  })
  assert.deepEqual(lenses.map(lens => lens.line), [5, 10, 20], '按行升序')
  // 5 行那条两侧都有：保留一条，且是**本地**那条（命令名不同，可区分）。
  assert.equal(lenses.filter(lens => lens.line === 5).length, 1, '同行同标题只留一条')
  assert.equal(lenses[0].item.command, 'codeVision.showProblems', '冲突时本地优先')
  // 服务端自己的区间不能被本地那条的零宽区间顶掉（`groupAnchoredLenses` 靠它归并）。
  const serverOnly = await renderLenses({
    query: async () => ({ available: true, items: [serverLens(7, '5 个引用', 4)] }),
    local: () => [],
  })
  assert.deepEqual(serverOnly[0].item.range, { startLine: 7, startChar: 4, endLine: 7, endChar: 4 },
    '服务端条目的锚点区间一个字节都不该被改')
})

test('不传 local 时行为与接入前逐字相同（回归护栏：只有服务端 lens）', async () => {
  const lenses = await renderLenses({ query: async () => ({ available: true, items: [serverLens(1, '仅服务端')] }) })
  assert.deepEqual(lenses.map(lens => lens.item.title), ['仅服务端'])
})

test('本地来源抛错时退化成「没有本地通道」，不牵连服务端 lens', async () => {
  const lenses = await renderLenses({
    query: async () => ({ available: true, items: [serverLens(2, '9 个引用')] }),
    local: () => { throw new Error('本地提供者坏了') },
  })
  assert.deepEqual(lenses.map(lens => lens.item.title), ['9 个引用'])
})

test('本地条目的锚点是行首零宽区间，能被渲染侧归并成一行', async () => {
  /** @type {CodeVisionEntry[]} */
  const entries = [localEntry(4, '2 个错误'), { line: 4, title: '1 个警告', command: 'codeVision.showProblems' }]
  const anchored = anchorCodeVisionEntries(entries)
  for (const entry of anchored) assert.deepEqual(entry.item.range, { startLine: entry.line, startChar: 0, endLine: entry.line, endChar: 0 })
  // 两个条目落在同一个零宽锚点上 → 渲染侧合成**一行**里的两个条目（上游 CodeVisionListPainter 的画法）。
  const rows = groupAnchoredLenses(anchored)
  assert.equal(rows.length, 1, '同锚点的多个条目合成一行')
  assert.deepEqual(rows[0].items.map(item => item.title), ['2 个错误', '1 个警告'])
})

test('端到端：providers 注册表算出的 problems 条目经通道渲染成行上方的一行', async () => {
  const registry = createCodeVisionRegistry()
  const entries = registry.compute({
    path: 'A.java', language: 'java',
    outline: [{ name: 'doWork', kind: 6, startLine: 10, endLine: 20 }],
    problems: [{ line: 12, severity: 1 }, { line: 13, severity: 1 }, { line: 19, severity: 2 }],
  })
  assert.deepEqual(entries.map(entry => entry.title), ['2 个错误，1 个警告'], '最内层符号认领全部诊断')
  const lenses = await renderLenses({ query: async () => ({ available: false }), local: () => entries })
  const rows = groupAnchoredLenses(lenses)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].line, 10, '锚在类/方法声明那一行（行上方）')
  assert.equal(rows[0].items[0].title, '2 个错误，1 个警告')
  // 提供者可用性闸也要真的生效：没有诊断时不算条目。
  assert.equal(registry.compute({ path: 'B.java', language: 'java', outline: [], problems: [] }).length, 0)
  assert.equal(problemsVisionProvider().id, 'problems')
})

/** 从 dispatch 里取落盘的那份 lens 列表（与 `renderLenses` 同一口径）。 */
function lensesOf(view) {
  const last = view.dispatched[view.dispatched.length - 1]
  const effects = Array.isArray(last?.effects) ? last.effects : [last?.effects]
  return effects[0]?.value ?? []
}

test('宿主只交一个通道对象：渲染层自己读 entries，并把「抓完补刷」挂上', async () => {
  const notifiers = []
  const channel = {
    // 第一拍：还没抓到东西（旧值先用 = 空）；抓完那一拍由宿主侧的补刷回调驱动第二次落盘。
    entries: () => (channel.ready ? [{ line: 6, title: '3 个用法', command: 'codeVision.showUsages' }] : []),
    refresh: async () => [],
    attach: notify => { notifiers.push(notify) },
    reset: () => {},
    pending: () => null,
    ready: false,
  }
  let queries = 0
  const { view, controller } = viewOf({
    query: async () => { ++queries; return { available: false } },
    localChannel: channel,
  })
  assert.equal(notifiers.length, 1, 'createCodeLens 要把补刷回调挂到通道上')
  assert.equal(typeof notifiers[0], 'function')
  controller.schedule('open')
  await sleep(30)
  assert.deepEqual(lensesOf(view), [], '通道还没抓到东西时不画（也不放假条目）')
  channel.ready = true
  notifiers[0]()                      // 通道自己宣布"计数落地"，渲染层补一拍
  await sleep(30)
  assert.equal(queries, 2, '补刷这一拍真的重问了')
  assert.deepEqual(lensesOf(view).map(lens => [lens.line, lens.item.title]), [[6, '3 个用法']])
  controller.dispose()
})

test('通道 entries() 抛错时退化成「没有本地通道」，服务端 lens 照旧', async () => {
  const { view, controller } = viewOf({
    query: async () => ({ available: true, items: [serverLens(2, '仅服务端')] }),
    localChannel: { entries: () => { throw new Error('documentSymbol 挂了') }, attach: () => {}, refresh: async () => [], reset: () => {}, pending: () => null },
  })
  controller.schedule('open')
  await sleep(30)
  assert.deepEqual(lensesOf(view).map(lens => lens.item.title), ['仅服务端'])
  controller.dispose()
})

