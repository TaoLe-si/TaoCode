// `agent/host` 判据：装配层 —— 审批→暂存→台账→差异→Do/Undo/DoAll 的端到端行为。
//
// 起因（用户原话）："agent 对话内修改文件，改为既能在对话窗口内观察到，也能在左侧写代码的
// 窗口观察到红绿 diff 对比，并且增添一个按钮 do undo，do 是保留，undo 是撤回 agent 的修改，
// 增添 do all，是保留全部修改"。
//
// 这里钉住：批准之前零写盘、Do 才落盘、Undo 撤回（且不覆盖用户自己改过的内容）、
// Do All 批量保留、越出工作区的路径一律拒绝（"自动读取当前项目"≠"可以碰项目外的文件"），
// 以及**冻结的会话选择 → 请求体**这一条：有推理档位时请求体带映射写出的字段，
// 没有档位时请求体与接通前逐字段一致（零行为变化）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyWriteParams, assertInsideWorkspace, createAgentHost, describeEditFailure } from '../src/agentHost.ts'
import { defaultAgentSettings } from '../src/agentSettings.ts'
import { fakeModelReply } from '../src/agent.ts'
import { encodeCustomModelValue } from '../src/agentModelSelection.ts'

const AGENT_LINE = '\n// taocode-agent\n'
const MODEL_VALUE = encodeCustomModelValue('p1', 'm1')

/** 一份"有可跑模型"的设置：装配层的请求要走真 JSON 请求路径，就必须有供应商 + 启用的模型。 */
function modelSettings(extra = {}) {
  return {
    ...defaultAgentSettings(),
    model: MODEL_VALUE,
    providers: [{
      id: 'p1', name: 'P1', baseUrl: 'https://example.test/v1', apiKey: 'k',
      apiFormat: 'anthropic-messages',
      models: [{ id: 'm1', name: 'M1', enabled: true }],
    }],
    ...extra,
  }
}

/**
 * 假模型桥：把确定性本地假模型（`src/agent.ts` 的 `fakeModelReply`，第一轮只读、后面才写）
 * 编成 Anthropic SSE 喂回装配层，并把每次请求原样记进 `requests` 供断言请求体。
 * 最近一条是真实用户提示才提工具；收到工具结果后只回文本 —— 和真模型一样，续发不会无限提工具。
 */
function fakeModelRequest(requests, table) {
  const encoder = new TextEncoder()
  let served = 0
  const send = (onChunk, payload) => onChunk(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
  return async (request, onChunk) => {
    requests.push(request)
    const body = JSON.parse(request.body)
    const messages = Array.isArray(body.messages) ? body.messages : []
    const last = messages[messages.length - 1]
    const prompts = messages.filter(message => message.role === 'user' && typeof message.content === 'string')
    const turn = prompts.length - 1
    const prompt = prompts.length ? String(prompts[prompts.length - 1].content) : ''
    // 假模型的文本（含编号计划）每轮都回；只在"最近一条是真实用户提示"时才提工具 ——
    // 收到工具结果后的续发不许再提，否则一整轮会无限循环下去。
    const reply = fakeModelReply(prompt, [...table.keys()], turn)
    const calls = last && last.role === 'user' && typeof last.content === 'string' ? reply.toolCalls : []
    served += 1
    send(onChunk, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply.text } })
    let index = 1
    for (const call of calls) {
      const name = call.tool === 'read_file' ? 'Read' : 'Write'
      const input = call.tool === 'read_file'
        ? { file_path: call.params.path }
        // 假模型的 write_file 是"追加"，provider 工具是整份 content：按盘上现状拼出来，落点与原行为一致。
        : { file_path: call.params.path, content: (table.get(call.params.path) ?? '') + call.params.append }
      send(onChunk, { type: 'content_block_start', index, content_block: { type: 'tool_use', id: `toolu_${served}_${index}`, name, input } })
      index += 1
    }
    return { available: true, status: 200 }
  }
}

/** 一个内存工作区：文件表 + 动作日志（写盘、跳转、模型请求都记下来供断言）。 */
function fakeWorkspace(files = {}) {
  const table = new Map(Object.entries(files))
  const writes = []
  const opened = []
  const diffs = []
  const requests = []
  return {
    table, writes, opened, diffs, requests,
    bridge: {
      workspaceRoot: () => 'D:/proj',
      listFiles: () => [...table.keys()],
      readFile: path => (table.has(path) ? table.get(path) : null),
      writeFile: (path, content) => { table.set(path, content); writes.push({ path, content }); return true },
      openFile: (path, line) => { opened.push({ path, line }) },
      showDiff: (path, editId) => { diffs.push({ path, editId }) },
      modelRequest: fakeModelRequest(requests, table),
    },
  }
}

const settings = modelSettings()

/** 走到"agent 提出了一条写改动并已获准（=已暂存）"这一步，返回相关句柄。 */
async function stageWrite(host, ws) {
  await await host.send('第一轮')
  const { message } = await host.send('第二轮')
  const writeCall = message.toolCalls.find(call => call.tool === 'write_file')
  const result = await host.approve(writeCall.id)
  return { writeCall, result }
}

test('工作区守卫：相对路径放行，绝对路径与上跳拒绝', async () => {
  assert.equal(assertInsideWorkspace('src/App.vue'), null)
  assert.equal(assertInsideWorkspace('native/main.cpp'), null)
  assert.match(assertInsideWorkspace('/etc/passwd'), /绝对路径/)
  assert.match(assertInsideWorkspace('C:\\Windows\\system.ini'), /绝对路径/)
  assert.match(assertInsideWorkspace('../../外面.txt'), /跳出工作区/)
  assert.match(assertInsideWorkspace('src/../../x.txt'), /跳出工作区/)
  assert.match(assertInsideWorkspace(''), /空路径/)
})

test('写参数解析：append 追加、content 覆盖、都没有则拒绝', async () => {
  assert.equal(applyWriteParams('a\n', { append: '\nb\n' }), 'a\n\nb\n')
  assert.equal(applyWriteParams('old\n', { content: 'new\n' }), 'new\n')
  assert.equal(applyWriteParams('x', {}), null)
})

test('读放行且读得到：第一轮只读，零写盘', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const host = createAgentHost({ bridge: ws.bridge, settings })
  const { results } = await host.send('读一下 `src/App.vue`')
  assert.equal(ws.writes.length, 0, '只读的一轮不许写盘')
  assert.equal(results.length, 1)
  assert.equal(results[0].ok, true)
  assert.match(results[0].detail, /已读 src\/App\.vue/)
})

test('写要批：批准前零写盘；批准只是"获准执行"，改动暂存为待决', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const host = createAgentHost({ bridge: ws.bridge, settings })
  await await host.send('第一轮')
  const { message } = await host.send('第二轮')
  const writeCall = message.toolCalls.find(call => call.tool === 'write_file')
  assert.ok(writeCall)
  assert.equal(ws.writes.length, 0, '没批准之前一个字节都不许落盘')

  const result = await host.approve(writeCall.id)
  assert.ok(result, '批准要给出执行结果')
  assert.equal(result.ok, true)
  assert.equal(ws.writes.length, 0, '批准 ≠ 落盘：要等用户按 Do')
  assert.match(result.detail, /待决/)
  assert.equal(host.pendingEdits().length, 1)
  assert.equal(ws.table.get('src/App.vue'), 'hello\n', '盘上仍是原件')
})

test('Do：保留这一条 —— 此刻才把 after 写盘', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const host = createAgentHost({ bridge: ws.bridge, settings })
  const { result } = await stageWrite(host, ws)
  ws.writes.length = 0

  assert.deepEqual(await host.doEdit(result.editId), { ok: true })
  assert.deepEqual(ws.writes.map(entry => entry.content), ['hello\n' + AGENT_LINE])
  assert.equal(host.pendingEdits().length, 0)
  assert.equal(host.allEdits()[0].state, 'applied')
})

test('Undo：撤回 agent 的修改 —— 待决的直接丢弃，盘上文件不动', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const host = createAgentHost({ bridge: ws.bridge, settings })
  const { result } = await stageWrite(host, ws)
  assert.deepEqual(await host.undoEdit(result.editId), { ok: true })
  assert.equal(ws.writes.length, 0, '从没落盘过就不该动磁盘')
  assert.equal(ws.table.get('src/App.vue'), 'hello\n')
  assert.equal(host.pendingEdits().length, 0)
  assert.equal(host.allEdits()[0].state, 'reverted')
})

test('Do 之后仍能 Undo：写回原件', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const host = createAgentHost({ bridge: ws.bridge, settings })
  const { result } = await stageWrite(host, ws)
  await host.doEdit(result.editId)
  ws.writes.length = 0
  assert.deepEqual(await host.undoEdit(result.editId), { ok: true })
  assert.deepEqual(ws.writes.map(entry => entry.content), ['hello\n'])
  assert.equal(ws.table.get('src/App.vue'), 'hello\n')
})

test('撤回不覆盖用户独立修改：Do 之后用户自己改了文件，Undo 必须被拒绝', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const host = createAgentHost({ bridge: ws.bridge, settings })
  const { result } = await stageWrite(host, ws)
  await host.doEdit(result.editId)
  ws.table.set('src/App.vue', '用户自己写的\n')
  ws.writes.length = 0
  const outcome = await host.undoEdit(result.editId)
  assert.deepEqual(outcome, { ok: false, reason: 'conflict' })
  assert.equal(ws.writes.length, 0, '拒绝时不许写盘')
  assert.equal(ws.table.get('src/App.vue'), '用户自己写的\n')
  assert.match(describeEditFailure(outcome), /已被你或其他程序改过/)
})

test('Do All：保留全部待决修改', async () => {
  const ws = fakeWorkspace({ 'src/a.ts': 'a\n', 'src/b.ts': 'b\n' })
  const host = createAgentHost({ bridge: ws.bridge, settings })
  await await host.send('第一轮')
  const second = await host.send('第二轮')
  const firstWrite = second.message.toolCalls.find(call => call.tool === 'write_file')
  await host.approve(firstWrite.id)
  ws.writes.length = 0
  assert.equal(host.pendingEdits().length, 1)

  assert.deepEqual(await host.doAllEdits(), { applied: 1, failed: [] })
  assert.equal(host.pendingEdits().length, 0)
  assert.equal(host.allEdits().filter(entry => entry.state === 'applied').length, 1)
  assert.equal(ws.writes.length, 1)
})

test('autoOpenDiff 打开时，写改动会送到编辑器显示红绿', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const host = createAgentHost({ bridge: ws.bridge, settings })
  const { result } = await stageWrite(host, ws)
  assert.equal(ws.diffs.length, 1, '左侧编辑器要拿到这条差异')
  assert.deepEqual(ws.diffs[0], { path: 'src/App.vue', editId: result.editId })
})

test('autoOpenDiff 关掉时不动编辑器，但台账里照旧有这条改动', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const host = createAgentHost({ bridge: ws.bridge, settings: { ...settings, autoOpenDiff: false } })
  const { result } = await stageWrite(host, ws)
  assert.equal(ws.diffs.length, 0)
  assert.equal(host.allEdits().length, 1, '不自动显示差异不等于不记改动')
  assert.ok(result.editId !== undefined)
})

test('requireApprovalForWrites 关掉：批准即落盘，但仍在列表里可 Undo', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const host = createAgentHost({ bridge: ws.bridge, settings: { ...settings, requireApprovalForWrites: false } })
  const { result } = await stageWrite(host, ws)
  assert.equal(ws.table.get('src/App.vue'), 'hello\n' + AGENT_LINE, '直接落盘')
  assert.equal(host.pendingEdits().length, 0)
  assert.equal(host.allEdits()[0].state, 'applied')
  assert.match(result.detail, /已保留/)
  // 落盘之后仍要能撤回：台账留着 before，这就是"回滚"的可用面。
  assert.deepEqual(await host.undoEdit(result.editId), { ok: true })
  assert.equal(ws.table.get('src/App.vue'), 'hello\n')
})

test('写失败时不谎报成功：详情说"写盘失败，仍待决"', async () => {
  const table = new Map([['src/App.vue', 'hello\n']])
  const bridge = {
    workspaceRoot: () => 'D:/proj',
    listFiles: () => [...table.keys()],
    readFile: path => (table.has(path) ? table.get(path) : null),
    writeFile: () => false,
    openFile: () => {},
    showDiff: () => {},
    modelRequest: fakeModelRequest([], table),
  }
  const host = createAgentHost({ bridge, settings: { ...settings, requireApprovalForWrites: false } })
  const { result } = await stageWrite(host, null)
  assert.equal(result.ok, false)
  assert.match(result.detail, /写盘失败，仍待决/)
  assert.equal(host.pendingEdits().length, 1, '写失败要保持待决')
})

test('拒绝工具调用：不执行、零写盘，批准/拒绝不存在的调用有明确返回', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const host = createAgentHost({ bridge: ws.bridge, settings })
  await await host.send('第一轮')
  const { message } = await host.send('第二轮')
  const writeCall = message.toolCalls.find(call => call.tool === 'write_file')
  assert.equal(await host.reject(writeCall.id), true)
  assert.equal(ws.writes.length, 0, '拒绝必须零写入')
  assert.equal(host.pendingEdits().length, 0)
  assert.equal(await host.reject(99999), false)
  assert.equal(await host.approve(99999), null)
})

test('revealFile：跳左侧编辑器，越界路径不跳', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const host = createAgentHost({ bridge: ws.bridge, settings })
  host.revealFile('src/App.vue', 120)
  assert.deepEqual(ws.opened, [{ path: 'src/App.vue', line: 120 }])
  host.revealFile('/etc/passwd', null)
  assert.equal(ws.opened.length, 1, '越界路径不许跳')
  host.revealFile('src/App.vue', null)
  assert.equal(ws.opened.length, 2)
})

test('revealEdit：打开改动对应文件并送差异', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const host = createAgentHost({ bridge: ws.bridge, settings })
  const { result } = await stageWrite(host, ws)
  ws.opened.length = 0
  ws.diffs.length = 0
  assert.equal(host.revealEdit(result.editId), true)
  assert.deepEqual(ws.opened, [{ path: 'src/App.vue', line: null }])
  assert.equal(ws.diffs.length, 1)
  assert.equal(host.revealEdit(99999), false)
})

test('设置更新后立刻生效：权限档改 allow，写调用不再需要批准', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const host = createAgentHost({ bridge: ws.bridge, settings })
  await await host.send('第一轮')
  host.updateSettings({ ...settings, permissions: { read: 'allow', write: 'allow', run: 'allow', network: 'never' } })
  await host.send('第二轮')
  // 写调用照提，只是 allow 档直接放行、不进审批门。装配层 `send` 返回的是**本轮最后一条**助手消息
  // （工具续发之后那条），所以提写调用的那条要对着会话历史找。
  assert.ok(
    host.session().messages().some(message => (message.toolCalls ?? []).some(call => call.tool === 'write_file')),
    '写调用要照提',
  )
  assert.equal(host.session().approvals().length, 0, 'allow 档不再进审批门')
})

test('关闭写盘等待 + allow 档：改动直接落盘', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const host = createAgentHost({
    bridge: ws.bridge,
    settings: { ...settings, requireApprovalForWrites: false, permissions: { read: 'allow', write: 'allow', run: 'allow', network: 'never' } },
  })
  await await host.send('第一轮')
  await host.send('第二轮')
  assert.equal(ws.table.get('src/App.vue'), 'hello\n' + AGENT_LINE)
})

test('上下文用量：按对话里引用过的文件算，预算来自设置', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'x'.repeat(100) })
  const host = createAgentHost({ bridge: ws.bridge, settings: { ...settings, contextBudgetChars: 2000 } })
  await host.send('读 `src/App.vue`')
  const usage = await host.contextUsage()
  assert.equal(usage.files.length, 1)
  assert.equal(usage.files[0].path, 'src/App.vue')
  assert.equal(usage.files[0].chars, 100)
  assert.equal(usage.budgetChars, 2000)
  assert.equal(usage.overBudget, false)
})

test('statusLine 反映待批准与待决改动', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const host = createAgentHost({ bridge: ws.bridge, settings })
  await await host.send('第一轮')
  // 装配层的状态行只报"待批准 / 待决改动"两条，干净时是空串（带「空闲」的是 `agentSession.ts` 的 sessionStatusLine）。
  assert.equal(host.statusLine(), '')
  await host.send('第二轮')
  assert.match(host.statusLine(), /待批准 1/)
  await host.approve(host.session().approvals()[0].call.id)
  assert.match(host.statusLine(), /待决改动 1/)
})

test('segments 把回复切成渲染单元（面板直接用）', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const host = createAgentHost({ bridge: ws.bridge, settings })
  const { message } = await host.send('读一下 `src/App.vue`')
  const segments = host.segments(message)
  assert.ok(segments.length > 0)
  assert.ok(segments.some(segment => segment.kind === 'plan'), '假模型回复里有计划')
})

// ── 冻结的会话选择 → 请求体（推理档位映射）─────────────────────────────────────────────
// 字段落点由模型自己声明的映射决定：ZCode 的 `optionSpecs.reasoningLevel.map` 是一段受限 CEL，
// 求值结果作为 JSON 补丁并进请求体（`.tools/ZCode/packages/model-option-map/src/option-maps.ts:20-33`）。
// 这里用 `{"thinking": {...}}` 当落点，验的是"映射值真的进了请求"，不是某个固定协议字段。

/** 带推理配置的设置：档位表 + 映射（`reasoningLevel` 是 CEL 里的变量名）。 */
function reasoningSettings(map, levels = ['low', 'high']) {
  return modelSettings({
    providers: [{
      id: 'p1', name: 'P1', baseUrl: 'https://example.test/v1', apiKey: 'k',
      apiFormat: 'anthropic-messages',
      models: [{ id: 'm1', name: 'M1', enabled: true, reasoningLevels: levels, reasoningLevelMap: map }],
    }],
  })
}

const REASONING_MAP = '{"thinking": {"type": "enabled", "budget_tokens": reasoningLevel == "high" ? 8192 : 1024}}'

test('无推理档位：请求体与接通前逐字段一致（零行为变化）', async () => {
  const plain = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const plainHost = createAgentHost({ bridge: plain.bridge, settings })
  await plainHost.send('读一下 `src/App.vue`')

  const body = JSON.parse(plain.requests[0].body)
  // 接通前的请求体就是这几个键；多一个键、少一个键都算回归。
  assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model', 'stream', 'system', 'tool_choice', 'tools'])
  assert.equal(body.model, 'm1')
  assert.equal(body.max_tokens, 32000)
  assert.equal(body.stream, true)
  assert.deepEqual(body.tool_choice, { type: 'auto' })
  assert.match(body.system, /Workspace root: D:\/proj/)
  assert.equal(body.thinking, undefined, '没有档位就不该出现映射写出的字段')

  // 旧口径（第三个参数传字符串）与"对象选择但没有档位"必须逐字节一致：
  // 变的只是选择形状，请求一个字都不该差。
  const viaObject = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const objectHost = createAgentHost({ bridge: viaObject.bridge, settings })
  await objectHost.send('读一下 `src/App.vue`', undefined, { model: MODEL_VALUE })
  assert.equal(viaObject.requests.length, plain.requests.length)
  for (let index = 0; index < plain.requests.length; index += 1) {
    assert.equal(viaObject.requests[index].body, plain.requests[index].body, `第 ${index + 1} 个请求逐字节一致`)
  }
})

test('有推理档位：初次请求与工具续发的请求体都带映射写出的字段', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const host = createAgentHost({ bridge: ws.bridge, settings: reasoningSettings(REASONING_MAP) })
  await host.send('读一下 `src/App.vue`', undefined, { model: MODEL_VALUE, options: { reasoningLevel: 'high' } })

  assert.equal(ws.requests.length, 2, '一轮读 = 初次请求 + 工具续发')
  for (const request of ws.requests) {
    assert.deepEqual(JSON.parse(request.body).thinking, { type: 'enabled', budget_tokens: 8192 }, '档位值要进请求体')
  }

  // 换一档：同一个映射按档位给出不同的值（证明写进去的是档位，不是写死的常量）。
  const low = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const lowHost = createAgentHost({ bridge: low.bridge, settings: reasoningSettings(REASONING_MAP) })
  await lowHost.send('读一下 `src/App.vue`', undefined, { model: MODEL_VALUE, options: { reasoningLevel: 'low' } })
  assert.deepEqual(JSON.parse(low.requests[0].body).thinking, { type: 'enabled', budget_tokens: 1024 })
})

test('冻结：批准后的续发仍用发送那一刻的档位（半路改设置不影响本轮）', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const host = createAgentHost({ bridge: ws.bridge, settings: reasoningSettings(REASONING_MAP) })
  await host.send('第一轮')
  const second = await host.send('第二轮', undefined, { model: MODEL_VALUE, options: { reasoningLevel: 'high' } })
  const writeCall = second.message.toolCalls.find(call => call.tool === 'write_file')
  assert.ok(writeCall)

  // 这一轮还卡在审批门上时把推理配置关掉：冻结的那份快照不许被新设置改写。
  host.updateSettings(modelSettings())
  const before = ws.requests.length
  await host.approve(writeCall.id)
  const resumed = ws.requests.slice(before)
  assert.equal(resumed.length, 1, '批准后要续发一轮')
  assert.deepEqual(JSON.parse(resumed[0].body).thinking, { type: 'enabled', budget_tokens: 8192 })
})

test('档位表里没有的档位：按"没有档位"处理，请求体不变', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const host = createAgentHost({ bridge: ws.bridge, settings: reasoningSettings(REASONING_MAP) })
  await host.send('读一下 `src/App.vue`', undefined, { model: MODEL_VALUE, options: { reasoningLevel: 'ultra' } })
  const body = JSON.parse(ws.requests[0].body)
  assert.equal(body.thinking, undefined)
  assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model', 'stream', 'system', 'tool_choice', 'tools'])
})

test('映射编译不过：如实报错，不静默把档位丢掉', async () => {
  const ws = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const host = createAgentHost({ bridge: ws.bridge, settings: reasoningSettings('{"thinking":') })
  await assert.rejects(
    () => host.send('读一下 `src/App.vue`', undefined, { model: MODEL_VALUE, options: { reasoningLevel: 'high' } }),
    /推理映射无效/,
  )
  assert.equal(ws.requests.length, 0, '映射没编译出来就不许发请求')
})

test('工具能力位：显式 false 才拒绝带工具；缺省（老存档）按上游默认放行', async () => {
  // 正向对照：模型记录**没有**这一格（老存档的形状）⇒ 工具表照发。
  const legacy = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const legacyHost = createAgentHost({ bridge: legacy.bridge, settings })
  await legacyHost.send('读一下 `src/App.vue`')
  assert.ok(legacy.requests.length >= 1, '缺省的工具能力位必须放行，否则老存档里的模型全哑')
  assert.ok(JSON.parse(legacy.requests[0].body).tools.length > 0, '缺省时请求体要带工具表')

  // 负向对照：显式 `supportsToolCall: false` ⇒ 组请求阶段就拒绝，且**一个请求都不发**。
  const unsupported = fakeWorkspace({ 'src/App.vue': 'hello\n' })
  const unsupportedHost = createAgentHost({
    bridge: unsupported.bridge,
    settings: modelSettings({
      providers: [{
        id: 'p1', name: 'P1', baseUrl: 'https://example.test/v1', apiKey: 'k', apiFormat: 'anthropic-messages',
        models: [{ id: 'm1', name: 'M1', enabled: true, supportsToolCall: false }],
      }],
    }),
  })
  await assert.rejects(() => unsupportedHost.send('读一下 `src/App.vue`'), /does not support tool calls/)
  assert.equal(unsupported.requests.length, 0, '明确不支持工具的模型不该收到请求')
})
