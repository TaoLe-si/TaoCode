// 桶 12c：断点写路径的**唯一下发口**判据（`src/dbgBreakpointUpdate.ts`）。
// 上游依据（逐行读过参考树）：
//   · `java/debugger/impl/src/com/intellij/debugger/engine/JavaBreakpointHandler.java:31-44` 装入引擎
//   · 同文件 `:46-54` 摘掉
//   · `platform/xdebugger-impl/frontend/src/com/intellij/platform/debugger/impl/frontend/FrontendXLineBreakpointVisualizationManager.kt:291-315`
//     队列合并（`queueBreakpointUpdate`）/ 立刻冲（`updateBreakpointNow`）/ 全量重发（`queueAllBreakpointsUpdate`）
//   · `platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/actions/handlers/XDebuggerMuteBreakpointsHandler.java:27-37` 静音
//   · `platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/breakpoints/XBreakpointUIUtil.kt:590-599` 条件标记
//   · `platform/xdebugger-impl/src/com/intellij/xdebugger/impl/breakpoints/XBreakpointBase.java:515-547` tooltip 逐条列属性
//   · `platform/ide-core/src/com/intellij/util/ui/update/MergingUpdateQueue.kt:529-530`（只在队列为空时起表 ⇒ 窗不续期）、
//     `:549-567` + `:574-582`（同目标只留最新那份，旧的那条**保证被结算**、不补跑）
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  breakpointFileSend, breakpointRefSendable, breakpointSendPlan, createBreakpointUpdater, provideBreakpointSendRules, resendAllFromRoot,
  BREAKPOINT_MERGE_MS,
} from '../src/dbgBreakpointUpdate.ts'
import { setBreakpointsEnabled } from '../src/breakpointGroups.ts'
import { breakpointMarkersOf, breakpointRef } from '../src/debugBreakpointExtras.ts'
import { breakpointEditPatch } from '../src/debugBreakpointEditor.ts'

const ok = (path, lines) => ({ ok: true, path, verifiedLines: lines })

/** 卡住时给一条**会失败**的用例，而不是把整个测试文件挂死：回归「泵再也不起」这类问题的形状就是挂死。 */
function within(ms, what, promise) {
  let timer
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => { reject(new Error(`${what}：${ms}ms 内没落地 ⇒ 这一文件的泵再也没起来`)) }, ms)
    }),
  ]).finally(() => { clearTimeout(timer) })
}


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

test('合并窗的**长度**钉上游：`MergingUpdateQueue.mergingUpdateQueue(mergingTimeSpan = 300)`（同文件 :79-83）', () => {
  assert.equal(BREAKPOINT_MERGE_MS, 300)
})

test('窗内的连续改动只发**一次**（:79-83 + :296-304）：三次改动 ⇒ 一条 setBreakpoints，最新载荷胜出', async () => {
  const seen = []
  const updater = createBreakpointUpdater(async item => {
    seen.push(item.send.map(point => point.line))
    return ok(item.path, item.send.map(point => point.line))
  }, { mergeMs: 20 })
  const first = updater.queue(breakpointFileSend('src/a.cpp', [{ line: 1 }], {}))
  const second = updater.queue(breakpointFileSend('src/a.cpp', [{ line: 1 }, { line: 2 }], {}))
  const third = updater.queue(breakpointFileSend('src/a.cpp', [{ line: 1 }, { line: 2 }, { line: 3 }], {}))
  assert.deepEqual(seen, [], '窗没到期前一条都不发（这就是「并合抖动」那半边）')
  assert.deepEqual(updater.waitingPaths(), ['src/a.cpp'], '窗里的文件要能问出来')
  assert.deepEqual(updater.queuedPaths(), ['src/a.cpp'])
  const rounds = await Promise.all([first, second, third])
  assert.deepEqual(seen, [[1, 2, 3]], '三次改动合成一轮，发的是最新那份清单')
  assert.deepEqual(rounds.map(round => round.error), [null, null, null])
  assert.deepEqual(rounds.map(round => round.applied), [false, false, true],
    '被合并掉的那两份不许声称「这就是我的结果」（面板据此跳过 verifiedLines 判定）')
  assert.deepEqual(updater.queuedPaths(), [])
  assert.deepEqual(updater.waitingPaths(), [])
})

test('`flush()` = 上游 `sendFlush()`（`MergingUpdateQueue.kt:618-620` 的 `restart(0)`）：不排队等满，但等得到发完', async () => {
  const seen = []
  const updater = createBreakpointUpdater(async item => { seen.push([item.path, item.send.map(point => point.line)]); return ok(item.path, []) }, { mergeMs: 5000 })
  const round = updater.queue(breakpointFileSend('src/a.cpp', [{ line: 4 }], {}))
  assert.deepEqual(seen, [], '本来要等 5000ms')
  await updater.flush()
  assert.deepEqual(seen, [['src/a.cpp', [4]]], 'flush 让它立刻进流水线')
  assert.deepEqual(updater.waitingPaths(), [], '窗已撤掉')
  assert.equal((await round).applied, true)
})

test('`queueFile` 用**登记给下发口**的那份前端状态（别的写点不必自己再拿一套口径）', async () => {
  const seen = []
  const updater = createBreakpointUpdater(async item => { seen.push(item.send.map(point => point.line)); return ok(item.path, []) })
  const blocked = { dependencies: { 'src/a.cpp:5': 'src/b.cpp:1' }, enabledDependents: [] }
  provideBreakpointSendRules(() => blocked)
  try {
    await updater.queueFile('src/a.cpp', [{ line: 5 }], { now: true })
    assert.deepEqual(seen[0], [], '被依赖挡住的那条不发 —— 与面板 `sendRules()` 那一份同一个判据')
    provideBreakpointSendRules(() => ({ ...blocked, enabledDependents: ['src/a.cpp:5'] }))
    await updater.queueFile('src/a.cpp', [{ line: 5 }], { now: true })
    assert.deepEqual(seen[1], [5], '触发者命中之后同一条就发得出去')
  } finally {
    provideBreakpointSendRules(null)
  }
  await updater.queueFile('src/a.cpp', [{ line: 5 }], { now: true })
  assert.deepEqual(seen[2], [5], '没登记时退回 `{}`（只看断点对象与勾选位），不许当成「全部挡住」')
})

test('`{ now: true }` = `updateBreakpointNow`（:291-294，queue + sendFlush）：窗再长也不等', async () => {
  const seen = []
  const updater = createBreakpointUpdater(async item => { seen.push(item.send.map(point => point.line)); return ok(item.path, []) }, { mergeMs: 5000 })
  const round = await updater.queue(breakpointFileSend('src/a.cpp', [{ line: 1 }], {}), { now: true })
  assert.deepEqual(seen, [[1]], '用户就在那一下点的动作当场就发')
  assert.deepEqual(updater.waitingPaths(), [], '没起窗')
  assert.equal(round.applied, true)
})

test('`settled()` 连窗一起等（不空转）：等完之后再问队列与窗都是空的', async () => {
  const seen = []
  const updater = createBreakpointUpdater(async item => { seen.push(item.path); return ok(item.path, []) }, { mergeMs: 10 })
  updater.queue(breakpointFileSend('src/a.cpp', [{ line: 1 }], {}))
  updater.queue(breakpointFileSend('src/b.cpp', [{ line: 2 }], {}))
  await updater.settled()
  assert.deepEqual(seen.sort(), ['src/a.cpp', 'src/b.cpp'])
  assert.deepEqual(updater.queuedPaths(), [])
  assert.deepEqual(updater.waitingPaths(), [])
})

test('消费链：恢复执行（继续/单步/反向/重新运行）前先把窗里的断点冲干净', () => {
  const panel = readFileSync('src/components/DebugPanel.vue', 'utf8')
  assert.match(panel, /import \{ breakpointUpdater \} from '\.\.\/dbgBreakpointUpdate'/, '面板没引下发口')
  assert.match(panel, /await breakpointUpdater\.flush\(\); await dapStep\(action\)/, 'F9/单步前没冲窗 ⇒ 刚改的断点会排在恢复之后到适配器')
  assert.match(panel, /await breakpointUpdater\.flush\(\); await \(kind === 'back' \? dapStepBack\(\) : dapReverseContinue\(\)\)/, '反向执行前没冲窗')
  assert.match(panel, /await breakpointUpdater\.flush\(\); await dapRestart\(\{ noDebug: false \}\)/, '重新运行前没冲窗')
  // 「运行到光标处」也是一次**恢复执行**（DAP 的 `goto`），同一道判据：窗里那份断点不许排在这次 goto 之后。
  const gutter = readFileSync('src/dbgRunToCursorGutter.ts', 'utf8')
  assert.match(gutter, /await breakpointUpdater\.flush\(\)\n\s*await dapGoto\(/, '「运行到光标处」前没冲窗')
  assert.match(gutter, /import \{ breakpointUpdater \} from '\.\/dbgBreakpointUpdate\.ts'/, '装订线那个宿主没引下发口')
})

test('消费链：勾选/取消勾选与静音走「不等窗」那一档，条件与依赖的逐字符改动走窗', () => {
  const dialog = readFileSync('src/components/BreakpointsDialog.vue', 'utf8')
  assert.match(dialog, /breakpointUpdater\.queueFile\(path, points, \{ now: true \}\)/,
    ':290 的注释点名 enable/disable 不能等')
  const pane = readFileSync('src/components/DebugBreakpointsPane.vue', 'utf8')
  assert.match(pane, /breakpointUpdater\.queue\(item, options\)/, '面板的下发只有这一个口，且窗/直发由调用方定')
  assert.match(pane, /void syncBreak\(activeBreaks\.value\.map\(point => \{/, '改条件/命中次数/日志没走窗（那是抖动源头）')
  assert.match(pane, /provideBreakpointSendRules\(\(\) => sendRules\(\)\)/, '面板没把前端状态登记给下发口 ⇒ 别的写点只能传 {}')
})

test('连着两轮**同一个文件**：上一轮的等待者醒来后必须还能排下一轮（本桶实测到的真卡死）', async () => {
  // 把 `running` 的摘除挂在 pump 的 `.finally()` 上（微任务）时，这条会永远卡在第 2 轮：
  // 等待者的 `await` 续体先跑 ⇒ `running.has(path)` 仍为真 ⇒ 再也不起泵。
  // 面板上「改一次条件按回车、再改一次」走的就是这条序列。
  const seen = []
  const updater = createBreakpointUpdater(async item => { seen.push(item.send.map(point => point.line)); return ok(item.path, []) })
  for (const line of [1, 2, 3]) await updater.queue(breakpointFileSend('src/a.cpp', [{ line }], {}), { now: true })
  assert.deepEqual(seen, [[1], [2], [3]], '三轮都真的发出去了（不是合并成一轮：三次都是 `now`，载荷也各不相同）')
  assert.deepEqual(updater.busyPaths(), [], '流水线空转')
  assert.deepEqual(updater.queuedPaths(), [])
})

test('摘除时机的微任务判据：now 与窗**交错**连排四轮，每轮都在上一轮等待者醒来之后才排（卡住要红、不许挂死）', async () => {
  // 上面那条只走 `now` 一档。把两档交错起来才咬得住「什么时候允许起泵」这件事实：
  // 第 3 轮排第 2 轮（窗）的等待者醒来之后 —— 若「在跑」的摘除挂在微任务上（`pump(path).then(() => 摘)`），
  // 等待者的续体会**先**跑，于是这一刻看到的还是「这个文件还在跑」，而 `now` 那一档不起窗、只起泵 ⇒
  // 载荷留在 `pending` 里再也没有人发（`now` 这条路上没有定时器会来救）。
  // 判据取「等待者醒来时问得到的那一眼」，不靠墙钟：`busyPaths()` 当场必须是空的。
  const seen = []
  const updater = createBreakpointUpdater(async item => { seen.push(item.send.map(point => point.line)); return ok(item.path, []) }, { mergeMs: 5 })
  const steps = [
    [[{ line: 1 }], { now: true }],
    [[{ line: 1 }, { line: 2 }], {}],
    [[{ line: 2 }], { now: true }],
    [[{ line: 2 }, { line: 3 }], {}],
  ]
  for (const [points, options] of steps) {
    const round = await updater.queue(breakpointFileSend('src/a.cpp', points, {}), options)
    assert.deepEqual(updater.busyPaths(), [],
      `第 ${seen.length} 轮回来后「在跑」表没清空 ⇒ 同文件的下一轮排不上（本桶那个卡死的形状）`)
    assert.equal(round.applied, true, '一轮一份载荷 ⇒ 落地的那份就是我这一份（没被合并掉时不许说不是）')
    assert.equal(round.error, null)
  }
  assert.deepEqual(seen, [[1], [1, 2], [2], [2, 3]], '四轮四份，顺序与载荷都对（既不重复发、也不吞发）')
  assert.deepEqual(updater.queuedPaths(), [], '没有留在 pending 里没人发的载荷')
  assert.deepEqual(updater.waitingPaths(), [], '没有还挂在窗里的文件')
})

test('`{ now: true }` 冲的是**整条队列**（上游 `updateBreakpointNow` = queue + `sendFlush()`，`MergingUpdateQueue.kt:618-620` 的 `restart(0)`）', async () => {
  // 上游的表是整条队列共用的那一面 ⇒ 一次「用户就在那一下点的」动作会把**别的**断点正在合并的那份一起带出去。
  // 本仓原来只起自己那个文件的泵，等于把注释里的 `sendFlush()` 写成了假的。
  const seen = []
  const updater = createBreakpointUpdater(async item => { seen.push(item.path); return ok(item.path, []) }, { mergeMs: 5000 })
  updater.queue(breakpointFileSend('src/b.cpp', [{ line: 7 }], {}))
  assert.deepEqual(seen, [], 'b 在 5000ms 的窗里，本来不会发')
  assert.deepEqual(updater.waitingPaths(), ['src/b.cpp'])
  await updater.queue(breakpointFileSend('src/a.cpp', [{ line: 1 }], {}), { now: true })
  assert.deepEqual(seen, ['src/a.cpp', 'src/b.cpp'], '按 a 的那一下把 b 窗里的那份也冲了出去（自己先走，别人的窗同时到期）')
  assert.deepEqual(updater.waitingPaths(), [], '不留还在等的窗')
})

test('全量重发不等窗：`queueAllBreakpointsUpdate` 的末行就是 `sendFlush()`（同文件 :315，注释「skip waiting」）', async () => {
  const seen = []
  const updater = createBreakpointUpdater(async item => { seen.push([item.path, item.send.map(point => point.line)]); return ok(item.path, []) }, { mergeMs: 5000 })
  const files = new Map([['src/a.cpp', [{ line: 1 }]], ['src/b.cpp', [{ line: 2, condition: 'c' }]]])
  const errors = resendAllFromRoot(files, {}, updater)
  assert.deepEqual(seen, [['src/a.cpp', [1]], ['src/b.cpp', [2]]],
    '会话起来之后一条都不许等：等的这 300ms 里程序会在**旧**断点上停住')
  assert.deepEqual(await errors, [])
  assert.deepEqual(updater.waitingPaths(), [])
})

test('窗**不续期**（`MergingUpdateQueue.kt:529-530` 只在队列为空时起表；`restartOnAdd` 默认 false `:123`）⇒ 一直改也饿不死', async () => {
  // 这一条钉的是「公平性」那一半：若把窗做成「每次入队重计时」（debounce），
  // 用户一直敲条件字符就**永远发不出去**，直到他停手 300ms —— 上游不是这个行为（旧载荷在 `:529-530`
  // 之后不再动表 ⇒ 固定窗，300ms 到点必落地一次）。
  const seen = []
  const landedDuringTyping = []
  const updater = createBreakpointUpdater(async item => { seen.push(item.send.map(point => point.line)); return ok(item.path, []) }, { mergeMs: 30 })
  updater.queue(breakpointFileSend('src/a.cpp', [{ line: 1 }], {}))
  for (let line = 2; line <= 17; line += 1) {
    await new Promise(resolve => { setTimeout(resolve, 8) })
    updater.queue(breakpointFileSend('src/a.cpp', [{ line: 1 }, { line }], {}))
    landedDuringTyping.push(seen.length)
  }
  await within(2000, '收尾轮', updater.settled())
  assert.ok(Math.max(...landedDuringTyping) >= 2,
    `持续改动 128ms 期间只落地过 ${Math.max(...landedDuringTyping)} 轮 ⇒ 窗被入队续期了（改成不停手就永远发不出去）`)
  assert.ok(seen.length >= 2, `总共只发了 ${seen.length} 轮：固定窗下每 30ms 该落一次`)
  assert.deepEqual(updater.queuedPaths(), [])
  assert.deepEqual(updater.waitingPaths(), [])
  assert.deepEqual(updater.busyPaths(), [])
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
  // 装订线那一下（`toggleBreakpointAt`）必须走同一个口：裸发会绕过「被依赖挡住的」「树上刚取消勾选的」
  // 那两类扣减，于是点一下别处的断点就把刚被挡掉的那条重新发给适配器（请求 D1 的实况）。
  const app = readFileSync('src/App.vue', 'utf8')
  assert.match(app, /from '\.\/dbgBreakpointUpdate'/, 'App 没 import 下发口')
  assert.doesNotMatch(app, /dapSetBreakpoints\(/, '装订线仍在裸发 dap.setBreakpoints')
  assert.match(app, /breakpointUpdater\.queueFile\(path, next, \{ now: true \}\)/, '装订线没走「不等合并窗、并冲掉别处正在合并的那份」那一档')
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
