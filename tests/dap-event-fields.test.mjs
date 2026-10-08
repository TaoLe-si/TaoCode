// DAP 事件字段的解读规则（`src/dapEventFields.ts`）判据。
//
// 三件事，各有明确的上游语义（原生 `native/dap_shaping.cpp:48-105` 的 `shape_event` 把
// `stopped` 的三个可选字段、`continued.threadId`、`output.line/column/path/group` 原样透传）：
//   · `output` 的位置字段 → 「跳到输出位置」（DAP 的 line/column 是 **1 基**，编辑器是 0 基）；
//   · `stopped.hitBreakpointIds` → 断点命中高亮（id 是会话内句柄，数字/字符串都合法）；
//   · `continued.threadId` → 线程状态（缺省或 allThreadsContinued 表示不止一个线程）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  breakpointIdKey, continuedThreadState, hitBreakpointIds, outputJumpTarget, outputJumpable,
  stoppedFlags, stoppedOnBreakpointIds,
} from '../src/dapEventFields.ts'

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

test('output 位置 → 跳转目标：line 换算成 0 基、column 原样（1 基）', () => {
  assert.deepEqual(outputJumpTarget({ path: 'src/a.cpp', line: 12, column: 3 }), { path: 'src/a.cpp', line: 11, column: 3 })
  assert.deepEqual(outputJumpTarget({ path: 'src/a.cpp', line: 1 }), { path: 'src/a.cpp', line: 0, column: 0 }, '第 1 行 → 0 基 0')
  // 没有 path 就没有目标：line 单独存在时不知道是哪个文件，猜当前文件是编造。
  assert.equal(outputJumpTarget({ line: 12 }), null)
  assert.equal(outputJumpTarget({ path: '', line: 12 }), null)
  assert.equal(outputJumpTarget(undefined), null)
  // line 必须 ≥ 1（规范 1 基）：0/负数/非整数一律当没给。
  assert.equal(outputJumpTarget({ path: 'a.cpp', line: 0 }), null)
  assert.equal(outputJumpTarget({ path: 'a.cpp', line: -5 }), null)
  assert.equal(outputJumpTarget({ path: 'a.cpp', line: Number.NaN }), null)
  assert.equal(outputJumpTarget({ path: 'a.cpp', line: '12' }), null, '字符串不是数字')
  // 列号非法/缺失时是 0（= 不指定），不影响行跳转。
  assert.deepEqual(outputJumpTarget({ path: 'a.cpp', line: 4, column: 0 }), { path: 'a.cpp', line: 3, column: 0 })
  assert.deepEqual(outputJumpTarget({ path: 'a.cpp', line: 4, column: Number.NaN }), { path: 'a.cpp', line: 3, column: 0 })
  assert.equal(outputJumpable({ path: 'a.cpp', line: 2 }), true)
  assert.equal(outputJumpable({ path: 'a.cpp' }), false)
})

test('断点 id 归一：数字与字符串都认，认不出的丢弃（不误高亮）', () => {
  assert.equal(breakpointIdKey(7), '7')
  assert.equal(breakpointIdKey(7.9), '7', '取整')
  assert.equal(breakpointIdKey('bp-a'), 'bp-a')
  assert.equal(breakpointIdKey(''), null, '空串不是身份')
  assert.equal(breakpointIdKey(Number.NaN), null)
  assert.equal(breakpointIdKey(null), null)
  assert.equal(breakpointIdKey(undefined), null)
  assert.equal(breakpointIdKey({}), null)
  assert.deepEqual(hitBreakpointIds([1, 'bp-a', 1, '', null, Number.NaN, 'bp-b']), ['1', 'bp-a', 'bp-b'], '去重 + 丢弃认不出的')
  assert.deepEqual(hitBreakpointIds(undefined), [])
  assert.deepEqual(hitBreakpointIds('bp-a'), [], '不是数组就不是 id 列表')
  assert.equal(stoppedOnBreakpointIds([3]), true)
  assert.equal(stoppedOnBreakpointIds([]), false)
  assert.equal(stoppedOnBreakpointIds(undefined), false, '适配器没给 id ⇒ 不猜')
})

test('stopped 三个可选字段：命中 id / 全线程停 / 别抢焦点', () => {
  const full = stoppedFlags({ hitBreakpointIds: [5, 'x'], allThreadsStopped: true, preserveFocusHint: true })
  assert.deepEqual(full, { hits: ['5', 'x'], allThreadsStopped: true, preserveFocusHint: true })
  // 没报 allThreadsStopped ⇒ null（不知道，不猜成 false）
  const bare = stoppedFlags({ hitBreakpointIds: [1] })
  assert.equal(bare.allThreadsStopped, null)
  assert.equal(bare.preserveFocusHint, false)
  const empty = stoppedFlags(undefined)
  assert.deepEqual(empty, { hits: [], allThreadsStopped: null, preserveFocusHint: false })
  // 非布尔不当成 true（能力位/事件字段都只认严格布尔）。
  assert.equal(stoppedFlags({ allThreadsStopped: 'yes' }).allThreadsStopped, null)
  assert.equal(stoppedFlags({ preserveFocusHint: 1 }).preserveFocusHint, false)
})

test('continued.threadId → 线程状态：没给 / allThreadsContinued 表示不止一个线程', () => {
  assert.deepEqual(continuedThreadState({ threadId: 3 }), { threadId: 3, allThreads: false })
  assert.deepEqual(continuedThreadState({ threadId: 3, allThreadsContinued: true }), { threadId: 3, allThreads: true }, '显式 allThreadsContinued 优先')
  assert.deepEqual(continuedThreadState({}), { threadId: null, allThreads: true }, '没给 threadId ⇒ 全部线程')
  assert.deepEqual(continuedThreadState(undefined), { threadId: null, allThreads: true })
  assert.deepEqual(continuedThreadState({ threadId: 0 }), { threadId: null, allThreads: true }, '0/负数不是有效线程 id')
  assert.deepEqual(continuedThreadState({ threadId: -1 }), { threadId: null, allThreads: true })
  assert.deepEqual(continuedThreadState({ threadId: '3' }), { threadId: null, allThreads: true }, '字符串不是线程 id')
})

test('接线：bridge 的 DapEvent 登记了这些字段，原生 shape_event 透传它们', () => {
  const bridge = read('src/bridge.ts')
  // DapEvent 的两个成员必须带上本轮补的可选键（`output` 的位置与 `stopped`/`continued` 的旗标）。
  assert.match(bridge, /event: 'stopped'; reason: string; threadId: number; text\?: string; allThreadsStopped\?: boolean; preserveFocusHint\?: boolean; hitBreakpointIds\?: Array<number \| string>/)
  assert.match(bridge, /event: 'output'; category: string; text: string; line\?: number; column\?: number; path\?: string; group\?: string/)
  assert.match(bridge, /event: 'continued'; threadId\?: number; allThreadsContinued\?: boolean; preserveFocusHint\?: boolean/)
  // 原生整形确实把这些字段搬进事件（不是只在前端"登记"）。
  const shaping = read('native/dap_shaping.cpp')
  assert.match(shaping, /event\["allThreadsStopped"\]/)
  assert.match(shaping, /event\["preserveFocusHint"\]/)
  assert.match(shaping, /event\["hitBreakpointIds"\]/)
  assert.match(shaping, /for \(const char\* key : \{"line", "column"\}\)/)
  assert.match(shaping, /const auto group = text_of\(source, "group"\)/)
})