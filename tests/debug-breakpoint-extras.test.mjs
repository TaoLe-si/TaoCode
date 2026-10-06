// 断点三类额外属性与批量动作的判据（本轮补 dbg/breakpoints 的缺口）：
// 临时断点（命中自删）、依赖断点（触发者命中后启用）、静音计划、全清与三个编辑入口。
// 纯规则在 `src/debugBreakpointExtras.ts`；接线在 `src/components/DebugBreakpointsPane.vue`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  allBreakpointFiles, breakpointRef, dependentsToEnable, isEnabledByDependency,
  parseBreakpointRef, shouldAutoUnmute, temporaryHit,
} from '../src/debugBreakpointExtras.ts'
// 静音/取消静音「发什么」的计划已从本文件迁到唯一下发口（见 debugBreakpointExtras.ts 文件头那条订正）。
import { breakpointSendPlan } from '../src/dbgBreakpointUpdate.ts'

test('断点身份：path:line 往返；Windows 盘符的冒号按最后一个切', () => {
  assert.equal(breakpointRef('src/a.cpp', 12), 'src/a.cpp:12')
  assert.deepEqual(parseBreakpointRef('src/a.cpp:12'), { path: 'src/a.cpp', line: 12 })
  assert.deepEqual(parseBreakpointRef('D:/proj/src/a.cpp:7'), { path: 'D:/proj/src/a.cpp', line: 7 })
  assert.equal(parseBreakpointRef('src/a.cpp'), null)
  assert.equal(parseBreakpointRef('src/a.cpp:0'), null)
})

test('临时断点：只有停在它那一行才命中', () => {
  const temporary = ['src/a.cpp:4', 'src/b.cpp:9']
  assert.equal(temporaryHit(temporary, { path: 'src/a.cpp', line: 4 }), 'src/a.cpp:4')
  assert.equal(temporaryHit(temporary, { path: 'src/a.cpp', line: 5 }), null)
  assert.equal(temporaryHit(temporary, null), null)
})

test('依赖断点：触发者命中后启用依赖它的那些；已在启用表里的不算重复', () => {
  const dependencies = { 'src/a.cpp:10': 'src/b.cpp:3', 'src/c.cpp:1': 'src/b.cpp:3', 'src/d.cpp:2': 'src/z.cpp:8' }
  assert.deepEqual(dependentsToEnable(dependencies, 'src/b.cpp:3'), ['src/a.cpp:10', 'src/c.cpp:1'])
  assert.deepEqual(dependentsToEnable(dependencies, 'src/z.cpp:8'), ['src/d.cpp:2'])
  assert.deepEqual(dependentsToEnable(dependencies, 'nope:1'), [])
  assert.equal(isEnabledByDependency(dependencies, [], 'src/a.cpp:10'), false, '依赖未启用前不发')
  assert.equal(isEnabledByDependency(dependencies, ['src/a.cpp:10'], 'src/a.cpp:10'), true)
  assert.equal(isEnabledByDependency(dependencies, [], 'src/x.cpp:1'), true, '无依赖的断点不受影响')
})

test('静音计划（`breakpointSendPlan`，唯一下发口）：有断点的文件才发请求；静音发空数组且不碰册子、取消静音发存下的', () => {
  const files = new Map([
    ['src/a.cpp', [{ line: 1 }, { line: 4, condition: 'x > 1' }]],
    ['src/empty.cpp', []],
  ])
  const muting = breakpointSendPlan(files, { muted: true })
  assert.deepEqual(muting.map(item => item.path), ['src/a.cpp'], '空文件不产生请求')
  assert.deepEqual(muting[0].send, [])
  assert.equal(muting[0].record, undefined, '静音这一轮不碰本仓册子（断点仍是用户的那些）')
  const unmuting = breakpointSendPlan(files, {})
  assert.equal(unmuting[0].send.length, 2)
  assert.equal(unmuting[0].send[1].condition, 'x > 1', '取消静音发的是存下来的那份（含条件）')
  assert.equal(unmuting[0].record, unmuting[0].send, '一条都没被挡 ⇒ 发出去的就是要记的（同一个引用）')
  assert.deepEqual(allBreakpointFiles(files), ['src/a.cpp', 'src/empty.cpp'])
})

test('自动取消静音：只有「设置开 + 已静音 + 停在断点」三条同时成立', () => {
  assert.equal(shouldAutoUnmute(true, true, true), true)
  assert.equal(shouldAutoUnmute(true, true, false), false)
  assert.equal(shouldAutoUnmute(false, true, true), false)
  assert.equal(shouldAutoUnmute(true, false, true), false)
})

test('面板接线：三类编辑入口 + 全清 + 静音 + 三条停机规则都在真实链路上', () => {
  const pane = readFileSync('src/components/DebugBreakpointsPane.vue', 'utf8')
  assert.match(pane, /placeholder="命中次数"/)
  assert.match(pane, /placeholder="日志消息"/)
  assert.match(pane, /placeholder="依赖（文件:行）"/)
  // 12c：芯片行改由 `breakChips` 逐项给出（字段以属性表为原文），入口函数没换 ⇒ 钉新形状，行为要求一字未减。
  assert.match(pane, /setBreakpointFields\(chip\.point\.line, \{ condition:/, '条件仍可编辑（与命中次数/日志同一入口）')
  assert.match(pane, /async function removeAllBreakpoints\(\)/)
  assert.match(pane, /async function toggleMute\(\)/)
  assert.match(pane, /defineExpose\(\{ applyStopRules, resendRemembered \}\)/)
  // 12c：**过期断言**（不是回归）—— 原来钉的是面板里的 `catch (caught) { error.value = … }`；
  // 断点下发收进唯一出口后，异常在 `dbgBreakpointUpdate.ts` 的队列里兜住，面板仍必须把它写进同一行错误位。
  assert.match(pane, /if \(round\.error\) \{ error\.value = round\.error; return \}/, '下发失败照样上屏（只是换了兜住的地方）')
  // 12c 之后本桶（dap）又给队列入口加了第二参数（`{ now: true }` = 上游 `updateBreakpointNow` 那一档「不等 300ms」，
  // `FrontendXLineBreakpointVisualizationManager.kt:290-294`）⇒ 这条锚点重指新形状，**判据一字未减**：
  // 面板的下发仍然只走 `src/dbgBreakpointUpdate.ts` 这一个口（精确匹配，没有降级成 includes）。
  assert.match(pane, /await breakpointUpdater\.queue\(item, options\)/, '面板的下发只走 `src/dbgBreakpointUpdate.ts` 这一个口')
  assert.match(pane, /void syncBreak\(\[\.\.\.activeBreaks\.value, \{ line \}\], \{ now: true \}\)/,
    '新建断点没走「不等窗」那一档（上游 :290 的注释点名 create new breakpoint 不能等）')
  assert.match(pane, /void syncBreak\(activeBreaks\.value\.filter\(point => point\.line !== line\), \{ now: true \}\)/,
    '移除断点同样不等窗')
  assert.match(pane, /if \(!round\.applied\) return/,
    '载荷被后来的改动合并掉时不许拿别人的 verifiedLines 判自己那份（否则误报「部分未验证」）')
  assert.match(pane, /void syncBreak\(activeBreaks\.value\.map\(point =>/,
    '改条件/命中次数/日志走合并窗（逐字符进来的抖动 ⇒ 连续改动只发一次）')
  assert.match(pane, /breakpointSendPlan\(dapBreakpoints, \{ \.\.\.sendRules\(\), muted: next \}\)/, '静音/取消静音 = 全量重发那份计划')
  assert.match(pane, /allBreakpointFiles\(dapBreakpoints\)/, '全清列的是规则层给的那份文件清单')
  const panel = readFileSync('src/components/DebugPanel.vue', 'utf8')
  assert.match(panel, /await breakpointsPane\.value\?\.applyStopRules\(\)/, '每次 refreshStack 后应用停机规则')
  assert.match(panel, /<DebugBreakpointsPane[^>]*:confirm-removal="dataView\.confirmBreakpointRemoval === true"/)
  assert.match(panel, /<DebugBreakpointsPane[^>]*:unmute-on-stop="dataView\.unmuteOnStop === true"/)
})
