// `agent/session` 判据：对话状态机 + 审批门 + 计划 + transcript。
//
// 起因：Agent 面板要能重绘任意时刻的对话，而"现在该显示什么"是一条状态机。
// 这里钉住：审批门走的是 `src/agent.ts` 的单一真源、批准前工具调用不会被放行、
// 拒绝要留痕、计划随新一轮替换。
//
// 驱动口径：会话只有一条真轮次管线 —— `sendWithModel`（面板经 `agentHost.send` 走的就是它，
// 见 `src/agentHost.ts:399`）。这里把确定性本地假模型（`src/agent.ts` 的 `fakeModelReply`，
// 第一轮只读、后面才写）编成 provider 工具调用形状喂进去，与 `tests/agent-host.test.mjs`
// 的假模型桥同一口径 —— 判据观察的是真管线，不是另开一条本地假 `send`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgentSession, sessionStatusLine } from '../src/agentSession.ts'
import { defaultAgentPermissions, fakeModelReply } from '../src/agent.ts'

const fixedClock = () => {
  let tick = 0
  return () => new Date(Date.UTC(2026, 9, 7, 0, 0, tick++))
}

/** 会话的模型出口：假模型的轮次按请求里的用户消息数算（`src/agent.ts:148` 的 `call`）。 */
const fakeGenerate = (workspaceFiles = ['src/App.vue']) => async messages => {
  const prompts = messages.filter(message => message.role === 'user')
  const prompt = prompts.length ? String(prompts[prompts.length - 1].content) : ''
  const reply = fakeModelReply(prompt, workspaceFiles, prompts.length - 1)
  return {
    text: reply.text,
    toolCalls: reply.toolCalls.map(call => ({
      providerCallId: `fake-${call.id}`,
      name: call.tool,
      input: { ...call.params },
      tool: call.tool,
      params: { ...call.params },
    })),
  }
}

test('默认权限与本仓单一真源同档（读放行、写与命令要问、网络关闭）', () => {
  const session = createAgentSession()
  assert.deepEqual(session.permissions(), defaultAgentPermissions)
  assert.deepEqual(session.permissions(), { read: 'allow', write: 'ask', run: 'ask', network: 'never' })
})

test('发一条：产出用户消息 + 助手消息，助手带计划与工具调用', async () => {
  const session = createAgentSession({ now: fixedClock() })
  const reply = await session.sendWithModel('读一下 `src/App.vue`', fakeGenerate())
  assert.equal(session.messages().length, 2)
  assert.equal(session.messages()[0].role, 'user')
  assert.equal(reply.role, 'assistant')
  assert.ok(reply.plan.length >= 3, '假模型的回复里有编号计划')
  assert.ok(reply.toolCalls.length >= 1)
  assert.equal(session.turns(), 1)
})

test('读放行：第一轮的 read_file 直接进已批准，不进审批门', async () => {
  const session = createAgentSession({ now: fixedClock() })
  await session.sendWithModel('读 `src/App.vue`', fakeGenerate())
  assert.equal(session.approvals().length, 0, 'read 默认 allow，不该卡在门上')
  const drained = session.drainApproved()
  assert.equal(drained.length, 1)
  assert.equal(drained[0].tool, 'read_file')
})

test('写要问：第二轮带 write_file，它必须卡在审批门，批准前绝不进已批准', async () => {
  const session = createAgentSession({ now: fixedClock() })
  await session.sendWithModel('第一轮', fakeGenerate())
  session.drainApproved()
  const second = await session.sendWithModel('第二轮', fakeGenerate())
  const writeCall = second.toolCalls.find(call => call.tool === 'write_file')
  assert.ok(writeCall, '第二轮假模型提出写文件')
  assert.equal(session.approvals().length, 1, 'write 默认 ask ⇒ 卡在门上')
  // 这一轮里被放行的只有 read_file；write 必须还没进已批准队列。
  assert.deepEqual(session.drainApproved().map(call => call.tool), ['read_file'], '没批准之前写不许放行')

  assert.equal(session.approve(second.id, writeCall.id), true)
  assert.equal(session.approvals().length, 0)
  assert.deepEqual(session.drainApproved().map(call => call.tool), ['write_file'])
})

test('拒绝要留痕，且不混进已批准', async () => {
  const session = createAgentSession({ now: fixedClock() })
  await session.sendWithModel('第一轮', fakeGenerate())
  session.drainApproved()
  const second = await session.sendWithModel('第二轮', fakeGenerate())
  const writeCall = second.toolCalls.find(call => call.tool === 'write_file')
  session.drainApproved()   // 取走这一轮里被放行的 read
  assert.equal(session.reject(second.id, writeCall.id), true)
  assert.deepEqual(session.drainApproved(), [], '拒绝的不能被执行')
  assert.equal(session.rejections().length, 1)
  assert.equal(session.approvals().length, 0)
})

test('权限改成 never：写调用直接拒，不进审批门', async () => {
  const session = createAgentSession({ now: fixedClock() })
  session.setPermissions({ read: 'allow', write: 'never', run: 'never', network: 'never' })
  await session.sendWithModel('第一轮', fakeGenerate())
  session.drainApproved()
  await session.sendWithModel('第二轮', fakeGenerate())
  assert.equal(session.approvals().length, 0, 'never 档不经过门')
  assert.equal(session.rejections().length, 1, 'never 档直接进拒绝')
})

test('权限改成 allow：写调用不再需要批准', async () => {
  const session = createAgentSession({ now: fixedClock() })
  session.setPermissions({ read: 'allow', write: 'allow', run: 'allow', network: 'never' })
  await session.sendWithModel('第一轮', fakeGenerate())
  session.drainApproved()
  await session.sendWithModel('第二轮', fakeGenerate())
  assert.equal(session.approvals().length, 0)
  assert.deepEqual(session.drainApproved().map(call => call.tool).sort(), ['read_file', 'write_file'])
})

test('计划随新一轮替换，勾选是就地翻转', async () => {
  const session = createAgentSession({ now: fixedClock() })
  await session.sendWithModel('第一轮', fakeGenerate())
  const firstPlan = session.plan()
  assert.ok(firstPlan.length > 0)
  session.toggleStep(0)
  assert.equal(session.plan()[0].done, true)
  session.toggleStep(0)
  assert.equal(session.plan()[0].done, false)
  session.toggleStep(999)   // 越界不抛错
  await session.sendWithModel('第二轮', fakeGenerate())
  assert.equal(session.plan().every(step => !step.done), true, '新一轮的计划是全新的清单')
})

test('空消息不发送，也不推进轮次', async () => {
  const session = createAgentSession({ now: fixedClock() })
  await assert.rejects(() => session.sendWithModel('   ', fakeGenerate()), /空消息/)
  assert.equal(session.turns(), 0)
  assert.equal(session.messages().length, 0)
})

test('transcript 覆盖用户/助手/工具三类，且批准状态如实', async () => {
  const session = createAgentSession({ now: fixedClock() })
  await session.sendWithModel('第一轮', fakeGenerate())
  const second = await session.sendWithModel('第二轮', fakeGenerate())
  const writeCall = second.toolCalls.find(call => call.tool === 'write_file')
  session.approve(second.id, writeCall.id)
  session.drainApproved()   // 宿主取走已批准 —— transcript 仍要记得它批过
  const entries = session.transcript()
  assert.equal(entries.filter(entry => entry.kind === 'user').length, 2)
  assert.equal(entries.filter(entry => entry.kind === 'assistant').length, 2)
  const toolEntries = entries.filter(entry => entry.kind === 'tool')
  assert.ok(toolEntries.length >= 3)
  const writeEntry = toolEntries.find(entry => entry.tool === 'write_file')
  assert.equal(writeEntry.approved, true, 'drain 之后仍要记得批准状态')
})

test('拒绝的调用在 transcript 里是 error 条目且 approved=false', async () => {
  const session = createAgentSession({ now: fixedClock() })
  await session.sendWithModel('第一轮', fakeGenerate())
  session.drainApproved()
  const second = await session.sendWithModel('第二轮', fakeGenerate())
  const writeCall = second.toolCalls.find(call => call.tool === 'write_file')
  session.reject(second.id, writeCall.id)
  const errors = session.transcript().filter(entry => entry.kind === 'error')
  assert.equal(errors.length, 1)
  assert.equal(errors[0].approved, false)
  // 被拒的那条工具行本身也要在 transcript 里标成 false（不是 undefined=未决定）。
  const writeEntry = session.transcript().find(entry => entry.kind === 'tool' && entry.tool === 'write_file')
  assert.equal(writeEntry.approved, false)
})

test('批准/拒绝不存在的调用返回 false，不抛错', () => {
  const session = createAgentSession({ now: fixedClock() })
  assert.equal(session.approve(1, 1), false)
  assert.equal(session.reject(1, 1), false)
})

test('状态行：空闲 / 待批准 / 待决改动 三种形态', async () => {
  const session = createAgentSession({ now: fixedClock() })
  await session.sendWithModel('第一轮', fakeGenerate())
  session.drainApproved()
  assert.equal(sessionStatusLine(session, 0, '本地假模型'), '本地假模型 · 空闲')
  await session.sendWithModel('第二轮', fakeGenerate())
  assert.equal(sessionStatusLine(session, 0, '本地假模型'), '本地假模型 · 待批准 1')
  assert.equal(sessionStatusLine(session, 2, '本地假模型'), '本地假模型 · 待批准 1 · 待决改动 2')
})
// ── `/清空` 与会话库切换（`clear()` / `restore()`）────────────────────────────────────────
// 起因：面板要接会话库（`src/agentSessions.ts`）—— 斜杠命令 `/清空` 与头部那个会话下拉都落到这两个口上。
// 两条最容易出事的口径各钉一条：清空必须把**轮数**归零（假模型按轮次决定写不写），恢复**绝不能**把历史调用
// 重新变成待执行的写盘请求。

test('`/清空`：消息/计划/审批/处置记录全清，轮数也归零（否则清空后第一条就进写模式）', async () => {
  const session = createAgentSession({ now: fixedClock() })
  await session.sendWithModel('第一轮', fakeGenerate())
  await session.sendWithModel('第二轮', fakeGenerate())
  session.drainApproved()
  assert.equal(session.turns(), 2)
  assert.ok(session.approvals().length > 0, '第二轮会有一条待批准的写')
  session.clear()
  assert.deepEqual(session.messages(), [])
  assert.deepEqual(session.plan(), [])
  assert.deepEqual(session.approvals(), [])
  assert.deepEqual(session.drainApproved(), [], '清空后不该还留着等着被执行的写调用')
  assert.equal(session.turns(), 0, '轮数归零才是「刚开始」')
  // 归零的真效果：第一条消息仍然只读（假模型 `call > 0` 才发 write_file）。
  await session.sendWithModel('清空后的第一轮', fakeGenerate())
  const calls = session.messages().at(-1).toolCalls.map(call => call.tool)
  assert.deepEqual(calls, ['read_file'], '轮数归零 ⇒ 第一轮只读，不带写')
})

test('restore：把转写装回来（消息、计划、轮数），历史调用不重新执行', async () => {
  const original = createAgentSession({ now: fixedClock() })
  await original.sendWithModel('第一轮', fakeGenerate())
  await original.sendWithModel('第二轮', fakeGenerate())
  const entries = original.transcript()
  const approvedCount = original.drainApproved().length
  assert.ok(approvedCount > 0, '前面对话确实批准过东西')

  const restored = createAgentSession({ now: fixedClock() })
  restored.restore(entries)
  assert.equal(restored.messages().length, original.transcript().filter(e => e.kind === 'user' || e.kind === 'assistant').length)
  assert.equal(restored.turns(), 2, '轮数跟着助手消息数回来 ⇒ 下一轮仍在写模式（与存档前一致）')
  assert.ok(restored.plan().length >= 3, '面板那条待办清单来自最新一轮的计划')
  assert.deepEqual(restored.drainApproved(), [],
    '切回旧对话绝不能把当初批准过的写调用再执行一遍（那等于把旧改动又写一次盘）')
  assert.deepEqual(restored.approvals(), [], '存档里的调用当时就有处置，不该再挂一次审批')
})

test('restore：历史调用的 id 与将来的轮次 id 不相撞（撞上会把新调用误报成已批准）', async () => {
  const original = createAgentSession({ now: fixedClock() })
  await original.sendWithModel('第一轮', fakeGenerate())
  const second = await original.sendWithModel('第二轮', fakeGenerate())
  // 存档离开前每条调用都有处置（两条读放行、一条写批准）—— 新旧「待批」行混在一起这一位就数不清了。
  const writeCall = second.toolCalls.find(call => call.tool === 'write_file')
  assert.equal(original.approve(second.id, writeCall.id), true)
  const entries = original.transcript()
  const restored = createAgentSession({ now: fixedClock() })
  restored.restore(entries)
  // 再发一轮：调用 id 由会话自己发（`nextToolCallId`），恢复时按存档里的 `agentCallId` 续号；
  // 续号若丢了，新调用会拿回历史 id（历史 id 都在 `decidedApproved` 里）而被动成「已批准」。
  await restored.sendWithModel('第三轮', fakeGenerate())
  const fresh = restored.messages().at(-1).toolCalls
  assert.ok(fresh.length > 0)
  for (const call of fresh) assert.ok(call.id > 0, `新调用应拿正数 id，实际 ${call.id}`)
  // 从「还挂着审批」这一位来观察：新一轮里的写调用此时应该**没有** approved（它卡在审批门上）。
  // 历史 id 若与它撞上，`decidedApproved` 会把它误判成早就批准过 → approved 变成 true → 这一行数就少掉。
  const pendingRows = restored.transcript().filter(entry => entry.kind === 'tool' && entry.approved === undefined)
  assert.equal(pendingRows.length, 1,
    `新一轮的写调用应仍挂着审批（没有 approved 那一位），实际有 ${pendingRows.length} 行`)
})

test('restore：空转写 = 清空；只有工具行没有助手消息时不凭空造消息', () => {
  const session = createAgentSession({ now: fixedClock() })
  session.restore([])
  assert.deepEqual(session.messages(), [])
  assert.equal(session.turns(), 0)
  session.restore([
    { at: '2026-10-07T00:00:00.000Z', kind: 'tool', text: 'read_file({})', tool: 'read_file', params: {}, approved: true },
    { at: '2026-10-07T00:00:01.000Z', kind: 'note', text: '旁证' },
  ])
  assert.deepEqual(session.messages(), [], '工具行没有宿主消息可挂 ⇒ 不造一条出来')
  assert.equal(session.turns(), 0)
})