// 桶 12c：断点写路径的**唯一下发口**判据（`src/dbgBreakpointUpdate.ts`）。
// 上游依据（逐行读过参考树）：
//   · `java/debugger/impl/src/com/intellij/debugger/engine/JavaBreakpointHandler.java:31-44` 装入引擎
//   · 同文件 `:46-54` 摘掉
//   · `platform/xdebugger-impl/frontend/src/com/intellij/platform/debugger/impl/frontend/FrontendXLineBreakpointVisualizationManager.kt:291-315`
//     队列合并（`queueBreakpointUpdate`）/ 立刻冲（`updateBreakpointNow`）/ 全量重发（`queueAllBreakpointsUpdate`）
//   · `platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/actions/handlers/XDebuggerMuteBreakpointsHandler.java:27-37` 静音
//   · `platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/breakpoints/XBreakpointUIUtil.kt:590-599` 条件标记
//   · `platform/xdebugger-impl/src/com/intellij/xdebugger/impl/breakpoints/XBreakpointBase.java:515-547` tooltip 逐条列属性
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  breakpointFileSend, breakpointRefSendable, breakpointSendPlan, createBreakpointUpdater, resendAllFromRoot,
} from '../src/dbgBreakpointUpdate.ts'
import { setBreakpointsEnabled } from '../src/breakpointGroups.ts'
import { breakpointMarkersOf, breakpointRef } from '../src/debugBreakpointExtras.ts'
import { breakpointEditPatch } from '../src/debugBreakpointEditor.ts'

const ok = (path, lines) => ({ ok: true, path, verifiedLines: lines })

test('属性并入 + 排序：册子里只有行号时，随项目存的条件/命中/日志要并回去（native 只存行号）', () => {
  const item = breakpointFileSend('src/a.cpp', [{ line: 9 }, { line: 3 }], {
    properties: { 'src/a.cpp:9': { condition: 'i > 2', hitCondition: '3' } },
  })
  assert.deepEqual(item.send.map(point => point.line), [3, 9], '按行号升序（DAP 清单要稳定）')
  assert.equal(item.send[1].condition, 'i > 2')
  assert.equal(item.send[1].hitCondition, '3')
})

test('条件启用位关掉：这一轮**不发**条件；册子记的就是发出去的那份，原文只在属性表里', () => {
  const table = { 'src/a.cpp:4': { condition: 'x > 1', conditionEnabled: false } }
  const item = breakpointFileSend('src/a.cpp', [{ line: 4, condition: 'x > 1' }], { properties: table })
  assert.equal(item.send[0].condition, undefined, '`sendableBreakpoints`：关掉启用位 ⇒ 条件不再作用于会话')
  assert.equal(item.record, item.send, '条目没少（只是字段被扣）⇒ 发出去的就是要记的那份')
  // 原文不丢：面板那一侧以属性表为回填来源（`fieldOf`），所以下面这条是真判据 —— 表才是原文。
  assert.equal(table['src/a.cpp:4'].condition, 'x > 1')
  assert.equal(breakpointMarkersOf({ line: 4 }, table, 'src/a.cpp:4').condition, false, '关掉时不打问号')
})

test('依赖断点：触发者没命中就不发这条；册子仍记全量，否则解除依赖后找不回来', () => {
  const rules = { dependencies: { 'src/a.cpp:5': 'src/b.cpp:2' }, enabledDependents: [] }
  const blocked = breakpointFileSend('src/a.cpp', [{ line: 5 }], rules)
  assert.deepEqual(blocked.send, [])
  assert.equal(blocked.record.length, 1)
  const released = breakpointFileSend('src/a.cpp', [{ line: 5 }], { ...rules, enabledDependents: ['src/a.cpp:5'] })
  assert.equal(released.send.length, 1)
  assert.equal(breakpointRefSendable('src/a.cpp', { line: 5 }, rules), false)
})

test('取消勾选（`setEnabled(false)`）的断点不发；与依赖位是两道独立的门', () => {
  const ref = breakpointRef('src/c.cpp', 7)
  setBreakpointsEnabled([ref], false)
  try {
    const item = breakpointFileSend('src/c.cpp', [{ line: 7 }], {})
    assert.deepEqual(item.send, [], 'XBreakpoint.java:23-25 isEnabled 的等价物')
    assert.equal(item.record.length, 1)
  } finally {
    setBreakpointsEnabled([ref], true)
  }
  assert.equal(breakpointFileSend('src/c.cpp', [{ line: 7 }], {}).send.length, 1, '勾回来就重新发')
})

test('静音：发空数组且**不碰册子**（`record` 缺省），取消静音按全量重发', () => {
  const files = new Map([['src/a.cpp', [{ line: 1, condition: 'x' }]]])
  const muting = breakpointSendPlan(files, { muted: true })
  assert.deepEqual(muting[0].send, [])
  assert.equal(muting[0].record, undefined)
  assert.deepEqual(breakpointSendPlan(files, {})[0].send, [{ line: 1, condition: 'x' }])
})

test('一条都没被挡时 `record` 就是 `send`（同一个引用 ⇒ 走桥接封装，不重复维护册子）', () => {
  const item = breakpointFileSend('src/a.cpp', [{ line: 2 }], {})
  assert.equal(item.record, item.send)
})

test('下发计划只列有断点的文件（空文件不产生请求）', () => {
  const files = new Map([['src/a.cpp', [{ line: 1 }]], ['src/empty.cpp', []]])
  assert.deepEqual(breakpointSendPlan(files, {}).map(item => item.path), ['src/a.cpp'])
})

test('队列合并：同一文件在途期间的多次改动**只补一轮**（三次改动 ⇒ 两次请求，:296-304）', async () => {
  const seen = []
  let release
  const gate = new Promise(resolve => { release = resolve })
  const updater = createBreakpointUpdater(async item => {
    seen.push(item.send.map(point => point.line))
    if (seen.length === 1) await gate
    return ok(item.path, [])
  })
  const first = updater.queue(breakpointFileSend('src/a.cpp', [{ line: 1 }], {}))
  const second = updater.queue(breakpointFileSend('src/a.cpp', [{ line: 1 }, { line: 2 }], {}))
  const third = updater.queue(breakpointFileSend('src/a.cpp', [{ line: 1 }, { line: 2 }, { line: 3 }], {}))
  release()
  const rounds = await Promise.all([first, second, third])
  assert.deepEqual(seen, [[1], [1, 2, 3]], '过期载荷不会被发出去，第二、三次合并成一轮')
  assert.deepEqual(rounds.map(round => round.error), [null, null, null])
  assert.deepEqual(updater.queuedPaths(), [])
})

test('不同文件互不阻塞：一个文件在途不影响另一个发出（DAP 的清单就是按文件的）', async () => {
  const seen = []
  let release
  const gate = new Promise(resolve => { release = resolve })
  const updater = createBreakpointUpdater(async item => {
    seen.push(item.path)
    if (item.path === 'src/a.cpp') await gate
    return ok(item.path, [])
  })
  const a = updater.queue(breakpointFileSend('src/a.cpp', [{ line: 1 }], {}))
  const b = updater.queue(breakpointFileSend('src/b.cpp', [{ line: 2 }], {}))
  assert.deepEqual(seen, ['src/a.cpp', 'src/b.cpp'], 'b 没等 a')
  release()
  await Promise.all([a, b])
  assert.deepEqual(updater.busyPaths(), [])
})

test('下发失败：错误回送给这一轮的等待者，不吞异常、也不留半个状态', async () => {
  const updater = createBreakpointUpdater(async item => {
    if (item.path === 'src/a.cpp') throw new Error('适配器掉了')
    return ok(item.path, [])
  })
  const round = await updater.queue(breakpointFileSend('src/a.cpp', [{ line: 1 }], {}))
  assert.equal(round.error, '适配器掉了')
  assert.equal(round.result, null, '没发成功就不能谎报结果')
})

test('全量重发（:306-315）：每个有断点的文件各一轮，失败的文件逐个报出来', async () => {
  const seen = []
  const updater = createBreakpointUpdater(async item => {
    seen.push([item.path, item.send.map(point => point.line)])
    if (item.path === 'src/bad.cpp') throw new Error('拒绝')
    return ok(item.path, [])
  })
  const files = new Map([['src/a.cpp', [{ line: 1 }]], ['src/empty.cpp', []], ['src/bad.cpp', [{ line: 3, condition: 'c' }]]])
  const errors = await resendAllFromRoot(files, {}, updater)
  assert.deepEqual(errors, ['拒绝'])
  assert.equal(seen.length, 2, '空文件不重发')
  assert.deepEqual(seen[1][1], [3])
  assert.equal(seen[1][0], 'src/bad.cpp')
})

test('消费链：面板与「查看断点…」都只走这一个口，域内不再有裸的 dap.setBreakpoints', () => {
  const pane = readFileSync('src/components/DebugBreakpointsPane.vue', 'utf8')
  const dialog = readFileSync('src/components/BreakpointsDialog.vue', 'utf8')
  assert.match(pane, /from '\.\.\/dbgBreakpointUpdate'/, '面板没 import 下发口')
  assert.match(dialog, /from '\.\.\/dbgBreakpointUpdate'/, '对话框没 import 下发口')
  assert.doesNotMatch(pane, /request\('dap\.setBreakpoints'/, '面板仍在裸发 DAP')
  assert.doesNotMatch(dialog, /request\('dap\.setBreakpoints'/, '对话框仍在裸发 DAP')
  assert.match(pane, /resendRemembered/, '全量重发的入口在面板上')
  assert.match(pane, /defineExpose\(\{ applyStopRules, resendRemembered \}\)/)
})

test('会话起来后真的会全量重发（否则界面上的静音/勾选位在适配器里不存在）', () => {
  const panel = readFileSync('src/components/DebugPanel.vue', 'utf8')
  assert.match(panel, /\.then\(\(\) => breakpointsPane\.value\?\.resendRemembered\(\)\)/, 'running 后没接全量重发')
})

test('芯片标记与输入框以属性表为原文：关掉条件启用位后 `?` 消失但文本还在', () => {
  // 规则本体在 `src/debugBreakpointExtras.ts:223`，这里直接调它（不在测试里另抄一份判据）。
  assert.deepEqual(breakpointMarkersOf({ line: 4 }, { 'src/a.cpp:4': { condition: 'x > 1', conditionEnabled: false } }, 'src/a.cpp:4'),
    { condition: false, hit: false, log: false }, '启用位关掉 ⇒ 不打问号角标，但表里的原文不能被当成「没有条件」')
  assert.equal(breakpointMarkersOf({ line: 4 }, { 'src/a.cpp:4': { condition: 'x > 1' } }, 'src/a.cpp:4').condition, true,
    'XBreakpointUIUtil.kt:590-599：条件表达式非空才打问号')
  assert.equal(breakpointMarkersOf({ line: 4, condition: 'a' }, undefined, undefined).condition, true, '没有属性表时以册子那份为准')
  assert.equal(breakpointMarkersOf({ line: 4 }, { 'src/a.cpp:4': { hitCondition: '3', logMessage: 'hi' } }, 'src/a.cpp:4').hit, true)
  assert.equal(breakpointMarkersOf({ line: 4 }, { 'src/a.cpp:4': { logMessage: 'hi' } }, 'src/a.cpp:4').log, true)
  const pane = readFileSync('src/components/DebugBreakpointsPane.vue', 'utf8')
  assert.match(pane, /markers: breakpointMarkersOf\(point, properties\.value, ref\)/, '标记没走规则层')
  assert.match(pane, /propertiesForRef\(properties\.value, ref\)\?\.\[key\] \?\? point\[key\]/, '输入框没以属性表为原文')
  assert.match(pane, /v-if="chip\.markers\.condition"/, '问号角标没渲染')
  assert.match(pane, /v-if="chip\.markers\.hit"/, '命中次数标记没渲染')
  assert.match(pane, /v-if="chip\.markers\.log"/, '日志标记没渲染')
})

test('对话框提交走规则层 `breakpointEditPatch`：清空的与关掉启用位的都从断点对象上消失', () => {
  const off = { condition: 'x > 1', hitCondition: '', logMessage: '', conditionEnabled: false }
  assert.deepEqual(breakpointEditPatch(off), {}, '启用位关掉 ⇒ 这一轮没有条件可发（原文留在属性表）')
  assert.deepEqual(breakpointEditPatch({ ...off, conditionEnabled: true, hitCondition: ' 3 ' }),
    { condition: 'x > 1', hitCondition: '3' }, 'trim 后为空的不算值')
  const pane = readFileSync('src/components/DebugBreakpointsPane.vue', 'utf8')
  assert.match(pane, /condition: undefined, hitCondition: undefined, logMessage: undefined, \.\.\.patch/,
    '提交时先清空三个字段，否则被删掉的条件会留在断点对象上')
})
