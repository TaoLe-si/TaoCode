// 会话库判据：列表顺序、上限淘汰、缺省名、切换、改名、删除回退、转写拷贝、导出、坏存档、
// 模型选择最小对象（旧存档字符串兼容 / 换模型清掉旧档位 / 往返序列化）。
//
// 每条只钉一件事。存储用内存 Map，不碰真 localStorage —— 这条库在 Node 里也要能跑。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_SESSION_LIMIT,
  AGENT_SESSIONS_STORAGE_KEY,
  createAgentSessionStore,
  sessionModelSelection,
  setSessionModelSelection,
} from '../src/agentSessions.ts'

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, value) },
  }
}

/** 可控时钟：每次调用往前走 1 秒，updatedAt 的先后不会撞在同一毫秒上。 */
function clock(start = '2026-10-07T00:00:00.000Z') {
  let tick = Date.parse(start)
  return () => new Date(tick += 1000)
}

function entry(at, text, kind = 'user') {
  return { at, kind, text }
}

test('新建：缺省名从「会话 1」起，并成为当前', () => {
  const store = createAgentSessionStore(memoryStorage(), clock())
  const first = store.create()
  const second = store.create()
  assert.equal(first.name, '会话 1')
  assert.equal(second.name, '会话 2')
  assert.equal(store.activeId(), second.id)
  assert.deepEqual(store.list().map(item => item.name), ['会话 2', '会话 1'])
})

test('显式名字优先；空白显式名仍退回缺省名', () => {
  const store = createAgentSessionStore(memoryStorage(), clock())
  assert.equal(store.create('  草稿  ').name, '草稿')
  assert.equal(store.create('   ').name, '会话 1')
  assert.equal(store.create().name, '会话 2')
})

test('缺省名只看还在用的「会话 N」，改名腾出的号可以复用', () => {
  const store = createAgentSessionStore(memoryStorage(), clock())
  const first = store.create()
  assert.equal(store.rename(first.id, '草稿'), true)
  // 「会话 1」这个名字已经空出来了，下一场缺省名重新从 1 起，不留一个永远占着的空洞。
  assert.equal(store.create().name, '会话 1')
  assert.equal(store.create().name, '会话 2')
})

test('list 按 updatedAt 倒序，不按创建顺序', () => {
  const store = createAgentSessionStore(memoryStorage(), clock())
  const a = store.create('甲')
  const b = store.create('乙')
  assert.equal(store.saveTranscript(a.id, [entry('2026-10-07T00:00:03.000Z', '后写的')]), true)
  assert.deepEqual(store.list().map(item => item.id), [a.id, b.id])
})

test('get 是副本：改返回值不动库', () => {
  const store = createAgentSessionStore(memoryStorage(), clock())
  const created = store.create('甲')
  created.name = '被改过'
  created.entries.push(entry('2026-10-07T00:00:09.000Z', '不该进去'))
  assert.equal(store.get(created.id).name, '甲')
  assert.deepEqual(store.get(created.id).entries, [])
  assert.equal(store.get('没有'), undefined)
})

test('open 不存在返回 false 且当前不变', () => {
  const store = createAgentSessionStore(memoryStorage(), clock())
  const created = store.create()
  assert.equal(store.open('没有这场'), false)
  assert.equal(store.activeId(), created.id)
  const other = store.create('另一场')
  assert.equal(store.open(created.id), true)
  assert.equal(store.activeId(), created.id)
  assert.notEqual(store.activeId(), other.id)
})

test('rename：空白名失败且原名保留；超长截到 60 个码点', () => {
  const store = createAgentSessionStore(memoryStorage(), clock())
  const created = store.create('原名')
  assert.equal(store.rename(created.id, '   '), false)
  assert.equal(store.rename('没有', '新名'), false)
  assert.equal(store.get(created.id).name, '原名')
  const long = '字'.repeat(80)
  assert.equal(store.rename(created.id, long), true)
  assert.equal(store.get(created.id).name, '字'.repeat(60))
  assert.equal([...store.get(created.id).name].length, 60)
})

test('remove：删掉当前切到 updatedAt 最新；删光则为 null；删别的不动当前', () => {
  const store = createAgentSessionStore(memoryStorage(), clock())
  const a = store.create('甲')
  const b = store.create('乙')
  const c = store.create('丙')
  assert.equal(store.saveTranscript(a.id, [entry('2026-10-07T00:00:04.000Z', '甲更新')]), true)
  assert.equal(store.remove(c.id), true)
  assert.equal(store.activeId(), a.id, '丙是当前且甲比乙新，删丙应回到甲')
  assert.equal(store.remove(a.id), true)
  assert.equal(store.activeId(), b.id)
  assert.equal(store.remove(b.id), true)
  assert.equal(store.activeId(), null)
  assert.equal(store.remove('没有'), false)
})

test('saveTranscript 拷贝语义：之后改入参，库里那份不动，updatedAt 被推进', () => {
  const store = createAgentSessionStore(memoryStorage(), clock())
  const created = store.create('甲')
  const rows = [entry('2026-10-07T00:00:02.000Z', '你好')]
  assert.equal(store.saveTranscript(created.id, rows), true)
  rows[0].text = '被改了'
  rows.push(entry('2026-10-07T00:00:09.000Z', '多出来的'))
  const saved = store.get(created.id)
  assert.deepEqual(saved.entries, [entry('2026-10-07T00:00:02.000Z', '你好')])
  assert.notEqual(saved.updatedAt, created.updatedAt)
  assert.equal(store.saveTranscript('没有', rows), false)
})

test('params 也是拷贝：改入参里的对象不动库', () => {
  const store = createAgentSessionStore(memoryStorage(), clock())
  const created = store.create()
  const params = { path: 'a.ts' }
  const rows = [{ at: '2026-10-07T00:00:02.000Z', kind: 'tool', text: '读', tool: 'read_file', params }]
  assert.equal(store.saveTranscript(created.id, rows), true)
  params.path = 'b.ts'
  assert.equal(store.get(created.id).entries[0].params.path, 'a.ts')
})

test('activeEntries 是当前这场的副本；没有当前给空数组', () => {
  const store = createAgentSessionStore(memoryStorage(), clock())
  assert.deepEqual(store.activeEntries(), [])
  const created = store.create()
  store.saveTranscript(created.id, [entry('2026-10-07T00:00:02.000Z', '一条')])
  const live = store.activeEntries()
  live.pop()
  assert.equal(store.activeEntries().length, 1)
})

test('exportActive 走 taocode-agent-transcript/1；没有当前为 null', () => {
  const store = createAgentSessionStore(memoryStorage(), clock())
  assert.equal(store.exportActive(), null)
  const created = store.create('导出名')
  store.saveTranscript(created.id, [entry('2026-10-07T00:00:03.000Z', '正文', 'assistant')])
  const parsed = JSON.parse(store.exportActive())
  assert.equal(parsed.format, 'taocode-agent-transcript/1')
  assert.equal(parsed.model, '导出名')
  assert.equal(parsed.started, created.createdAt)
  assert.equal(parsed.entries.length, 1)
  assert.equal(parsed.entries[0].text, '正文')
})

test('summaries 不含 entries 键，entries 是条数，顺序与 list 一致', () => {
  const store = createAgentSessionStore(memoryStorage(), clock())
  const a = store.create('甲')
  store.create('乙')
  store.saveTranscript(a.id, [
    entry('2026-10-07T00:00:04.000Z', '一'),
    entry('2026-10-07T00:00:04.000Z', '二', 'note'),
  ])
  const rows = store.summaries()
  assert.deepEqual(rows.map(item => item.name), ['甲', '乙'])
  assert.equal(rows[0].entries, 2)
  assert.equal(Array.isArray(rows[0].entries), false, 'entries 在摘要里是条数，不是转写数组')
  assert.deepEqual(Object.keys(rows[0]).sort(), ['createdAt', 'entries', 'id', 'name', 'updatedAt'])
})

test('满 50 再创建：淘汰 updatedAt 最旧的那一场', () => {
  const store = createAgentSessionStore(memoryStorage(), clock())
  const ids = []
  for (let i = 0; i < AGENT_SESSION_LIMIT; i++) ids.push(store.create().id)
  // 把最早那一场的转写再写一次，让它变成最新，于是被淘汰的应是第二早的。
  store.saveTranscript(ids[0], [entry('2026-10-07T00:01:00.000Z', '续上')])
  const created = store.create('新的一场')
  assert.equal(store.list().length, AGENT_SESSION_LIMIT)
  assert.notEqual(store.get(ids[0]), undefined, '刚被续写过的最早一场不该被淘汰')
  assert.equal(store.get(ids[1]), undefined, 'updatedAt 最旧的是第二场')
  assert.equal(store.get(created.id).name, '新的一场')
  assert.equal(store.activeId(), created.id)
})

test('淘汰的若是当前，新建的接上当前，不会留一个悬空 id', () => {
  const store = createAgentSessionStore(memoryStorage(), clock())
  const first = store.create()
  for (let i = 1; i < AGENT_SESSION_LIMIT; i++) store.create()
  store.open(first.id)
  const created = store.create()
  assert.equal(store.get(first.id), undefined)
  assert.equal(store.activeId(), created.id)
})

test('往返：写进 storage 再打开是同一批，键是 taocode.agent.sessions', () => {
  const storage = memoryStorage()
  const now = clock()
  const store = createAgentSessionStore(storage, now)
  const created = store.create('往返')
  store.saveTranscript(created.id, [entry('2026-10-07T00:00:03.000Z', '留下')])
  store.rename(created.id, '改过')
  assert.equal(storage.map.has(AGENT_SESSIONS_STORAGE_KEY), true)
  const again = createAgentSessionStore(storage, now)
  assert.equal(again.activeId(), created.id)
  assert.equal(again.get(created.id).name, '改过')
  assert.deepEqual(again.activeEntries(), [entry('2026-10-07T00:00:03.000Z', '留下')])
})

test('坏存档永不抛：非 JSON、非对象、sessions 不是数组，整库当空', () => {
  for (const raw of ['{不是', 'null', '[]', '42', '"一串"', JSON.stringify({ activeId: 'x' })]) {
    const storage = memoryStorage({ [AGENT_SESSIONS_STORAGE_KEY]: raw })
    const store = createAgentSessionStore(storage, clock())
    assert.deepEqual(store.list(), [])
    assert.equal(store.activeId(), null)
  }
})

test('坏存档：单条缺字段或 entries 不是数组，丢掉这一条，其余留下', () => {
  const good = {
    id: 'keep',
    name: '留下',
    createdAt: '2026-10-07T00:00:01.000Z',
    updatedAt: '2026-10-07T00:00:02.000Z',
    entries: [entry('2026-10-07T00:00:02.000Z', '好的')],
  }
  const raw = JSON.stringify({
    activeId: 'keep',
    sessions: [
      { id: 'bad-entries', name: '坏', createdAt: good.createdAt, updatedAt: good.updatedAt, entries: '不是数组' },
      { id: 'no-name', createdAt: good.createdAt, updatedAt: good.updatedAt, entries: [] },
      { name: '没 id', createdAt: good.createdAt, updatedAt: good.updatedAt, entries: [] },
      null,
      good,
    ],
  })
  const store = createAgentSessionStore(memoryStorage({ [AGENT_SESSIONS_STORAGE_KEY]: raw }), clock())
  assert.deepEqual(store.list().map(item => item.id), ['keep'])
  assert.equal(store.activeId(), 'keep')
  assert.equal(store.get('keep').entries[0].text, '好的')
})

test('坏存档：entries 里坏的单条丢掉，好的留下；activeId 指向不存在则清空', () => {
  const raw = JSON.stringify({
    activeId: 'missing',
    sessions: [{
      id: 's',
      name: '  有空格  ',
      createdAt: '2026-10-07T00:00:01.000Z',
      updatedAt: '2026-10-07T00:00:02.000Z',
      entries: [
        { at: '不是时间', kind: 'user', text: '丢' },
        { at: '2026-10-07T00:00:02.000Z', kind: 'nope', text: '丢' },
        { at: '2026-10-07T00:00:02.000Z', kind: 'user' },
        entry('2026-10-07T00:00:02.000Z', '留'),
      ],
    }],
  })
  const store = createAgentSessionStore(memoryStorage({ [AGENT_SESSIONS_STORAGE_KEY]: raw }), clock())
  assert.equal(store.activeId(), null, 'activeId 指向不存在的会话要清空，不能留悬空')
  assert.equal(store.get('s').name, '有空格')
  assert.deepEqual(store.get('s').entries, [entry('2026-10-07T00:00:02.000Z', '留')])
})

test('getItem 抛、setItem 抛都不把库打崩', () => {
  const throwingRead = {
    getItem: () => { throw new Error('配额') },
    setItem: () => {},
  }
  const store = createAgentSessionStore(throwingRead, clock())
  assert.equal(store.create().name, '会话 1')
  const throwingWrite = memoryStorage()
  throwingWrite.setItem = () => { throw new Error('配额') }
  const other = createAgentSessionStore(throwingWrite, clock())
  assert.equal(other.create('还能建').name, '还能建')
  assert.equal(other.list().length, 1)
})

test('不给 storage：Node 里没有 localStorage，退回内存模式且不抛', () => {
  const store = createAgentSessionStore(undefined, clock())
  assert.equal(store.create().name, '会话 1')
  assert.equal(store.list().length, 1)
})

test('时钟停住时新建 id 不和库存里已有的撞车', () => {
  const frozen = () => new Date('2026-10-07T00:00:00.000Z')
  const taken = 's2026-10-07T00:00:00.000Z-0'
  const raw = JSON.stringify({
    activeId: taken,
    sessions: [{
      id: taken,
      name: '已有',
      createdAt: '2026-10-07T00:00:00.000Z',
      updatedAt: '2026-10-07T00:00:00.000Z',
      entries: [],
    }],
  })
  const store = createAgentSessionStore(memoryStorage({ [AGENT_SESSIONS_STORAGE_KEY]: raw }), frozen)
  const created = store.create('新的')
  assert.notEqual(created.id, taken)
  assert.equal(store.get(taken).name, '已有')
  assert.equal(store.list().length, 2)
})

test('传 null 明确走内存模式', () => {
  const store = createAgentSessionStore(null, clock())
  const created = store.create('内存')
  assert.equal(store.get(created.id).name, '内存')
})

// ── 模型选择：最小对象 `{ model, options.reasoningLevel }` ─────────────────────────

test('sessionModelSelection 只认形状：字符串读成 { model }，读不出给 null', () => {
  assert.deepEqual(sessionModelSelection('m1'), { model: 'm1' })
  assert.deepEqual(sessionModelSelection('  m1  '), { model: 'm1' })
  assert.deepEqual(sessionModelSelection({ model: 'm2', options: { reasoningLevel: ' high ' } }), { model: 'm2', options: { reasoningLevel: 'high' } })
  // 档位坏掉只丢档位，模型保住；options 不是对象等于没有档位。
  assert.deepEqual(sessionModelSelection({ model: 'm2', options: { reasoningLevel: 42 } }), { model: 'm2' })
  assert.deepEqual(sessionModelSelection({ model: 'm2', options: 'high' }), { model: 'm2' })
  assert.deepEqual(sessionModelSelection({ model: 'm2', extra: 1 }), { model: 'm2' })
  for (const bad of ['', '   ', null, undefined, 7, [], {}, { model: '' }, { model: '  ' }, { model: 42 }, { options: { reasoningLevel: 'high' } }]) {
    assert.equal(sessionModelSelection(bad), null)
  }
})

test('setSessionModelSelection 纯函数：换模型丢档位、没提档位则沿用、空模型给 null', () => {
  const withLevel = { model: 'm1', options: { reasoningLevel: 'high' } }
  // 同一个模型、没提档位：沿用旧档位（既有选择，不是隐式默认）。
  assert.deepEqual(setSessionModelSelection(withLevel, { model: 'm1' }), { model: 'm1', options: { reasoningLevel: 'high' } })
  // 换模型：档位属于选它的那个模型，不能跟过去；库里没写档位时也不带 options。
  assert.deepEqual(setSessionModelSelection(withLevel, { model: 'm2' }), { model: 'm2' })
  assert.deepEqual(Object.keys(setSessionModelSelection(withLevel, { model: 'm2' })), ['model'])
  // 明确给档位 / 明确清档位。
  assert.deepEqual(setSessionModelSelection(withLevel, { model: 'm1', reasoningLevel: 'low' }), { model: 'm1', options: { reasoningLevel: 'low' } })
  assert.deepEqual(setSessionModelSelection(withLevel, { model: 'm1', reasoningLevel: null }), { model: 'm1' })
  assert.deepEqual(setSessionModelSelection(withLevel, { model: 'm1', reasoningLevel: '   ' }), { model: 'm1' })
  // 没有模型就没有选择（回落全局模型），而不是造一个空壳。
  assert.equal(setSessionModelSelection(withLevel, { model: '   ' }), null)
  assert.equal(setSessionModelSelection(withLevel, null), null)
  assert.deepEqual(setSessionModelSelection(null, { model: '  m9  ' }), { model: 'm9' })
})

test('选择：会话与草稿按最小对象存取，读出来是副本', () => {
  const store = createAgentSessionStore(memoryStorage(), clock())
  const created = store.create('甲')
  assert.equal(store.saveModelSelection(created.id, { model: 'builtin:zai/GLM-5.3' }), true)
  assert.deepEqual(store.sessionModelSelection(created.id), { model: 'builtin:zai/GLM-5.3' })
  assert.equal(store.modelSelection(created.id), 'builtin:zai/GLM-5.3')
  assert.equal(store.saveDraftModelSelection({ model: 'draft/model' }), true)
  assert.deepEqual(store.draftSessionModelSelection(), { model: 'draft/model' })
  assert.equal(store.draftModelSelection(), 'draft/model')
  assert.equal(store.saveModelSelection('没有', { model: 'x' }), false)
  assert.equal(store.sessionModelSelection('没有'), null)
  // 副本语义：把读出来的 options 改掉，库里那份不动。
  store.saveModelSelection(created.id, { model: 'm', options: { reasoningLevel: 'high' } })
  const read = store.sessionModelSelection(created.id)
  read.options.reasoningLevel = '被改过'
  read.model = '被改过'
  assert.deepEqual(store.sessionModelSelection(created.id), { model: 'm', options: { reasoningLevel: 'high' } })
})

test('选择：坏输入不落盘，已有选择原样保留；null 是清除', () => {
  const store = createAgentSessionStore(memoryStorage(), clock())
  const created = store.create('甲')
  store.saveModelSelection(created.id, { model: 'm1' })
  for (const bad of ['', '   ', { model: '' }, { model: '   ' }, { model: 42 }, {}, 7, []]) {
    assert.equal(store.saveModelSelection(created.id, bad), false)
  }
  assert.equal(store.saveDraftModelSelection(''), false)
  assert.deepEqual(store.sessionModelSelection(created.id), { model: 'm1' })
  assert.equal(store.draftSessionModelSelection(), null)
  assert.equal(store.saveModelSelection(created.id, null), true)
  assert.equal(store.sessionModelSelection(created.id), null)
  assert.equal(store.modelSelection(created.id), null)
  assert.equal(store.saveDraftModelSelection(null), true)
  assert.equal(store.draftModelSelection(), null)
})

test('切模型清旧档位；同一个模型再存则沿用', () => {
  const store = createAgentSessionStore(memoryStorage(), clock())
  const created = store.create('甲')
  assert.equal(store.saveModelSelection(created.id, { model: 'm1', options: { reasoningLevel: 'high' } }), true)
  // 同一个模型再写一次、没提档位：沿用既有档位。
  store.saveModelSelection(created.id, { model: 'm1' })
  assert.deepEqual(store.sessionModelSelection(created.id), { model: 'm1', options: { reasoningLevel: 'high' } })
  // 换模型：旧档位必须清掉。
  store.saveModelSelection(created.id, { model: 'm2' })
  assert.deepEqual(store.sessionModelSelection(created.id), { model: 'm2' })
  // 换模型 + 明确给新档位：以明确值为准。
  store.saveModelSelection(created.id, { model: 'm3', options: { reasoningLevel: 'low' } })
  assert.deepEqual(store.sessionModelSelection(created.id), { model: 'm3', options: { reasoningLevel: 'low' } })
  // 忽略档位的壳（空串）不算档位：清掉 options，模型留着。
  store.saveModelSelection(created.id, { model: 'm3', options: { reasoningLevel: '' } })
  assert.deepEqual(store.sessionModelSelection(created.id), { model: 'm3' })
  // 草稿走同一套规则。
  store.saveDraftModelSelection({ model: 'd1', options: { reasoningLevel: 'high' } })
  store.saveDraftModelSelection({ model: 'd2' })
  assert.deepEqual(store.draftSessionModelSelection(), { model: 'd2' })
})

test('旧存档按模型字符串存的选择：读成 { model }，不炸不丢', () => {
  const raw = JSON.stringify({
    activeId: 'legacy',
    draftModelSelection: 'draft/old-model',
    sessions: [{
      id: 'legacy',
      name: '旧场',
      createdAt: '2026-10-07T00:00:01.000Z',
      updatedAt: '2026-10-07T00:00:02.000Z',
      entries: [entry('2026-10-07T00:00:02.000Z', '老转录')],
      modelSelection: 'builtin:zai/GLM-5.3',
    }],
  })
  const store = createAgentSessionStore(memoryStorage({ [AGENT_SESSIONS_STORAGE_KEY]: raw }), clock())
  assert.deepEqual(store.sessionModelSelection('legacy'), { model: 'builtin:zai/GLM-5.3' })
  assert.equal(store.modelSelection('legacy'), 'builtin:zai/GLM-5.3')
  assert.deepEqual(store.draftSessionModelSelection(), { model: 'draft/old-model' })
  assert.equal(store.get('legacy').entries.length, 1, '旧存档的转写和选择一起留下')
})

test('旧存档里坏的选择只丢那一格：会话与转写照常留下', () => {
  const base = { createdAt: '2026-10-07T00:00:01.000Z', updatedAt: '2026-10-07T00:00:02.000Z', entries: [] }
  const raw = JSON.stringify({
    activeId: null,
    sessions: [
      { ...base, id: 'k1', name: '空模型', modelSelection: { model: '  ' } },
      { ...base, id: 'k2', name: '数字模型', modelSelection: 42 },
      { ...base, id: 'k3', name: '坏档位', modelSelection: { model: 'm', options: { reasoningLevel: 9 } } },
    ],
  })
  const store = createAgentSessionStore(memoryStorage({ [AGENT_SESSIONS_STORAGE_KEY]: raw }), clock())
  assert.deepEqual(store.list().map(item => item.id), ['k1', 'k2', 'k3'], '三场都还在')
  assert.equal(store.sessionModelSelection('k1'), null)
  assert.equal(store.sessionModelSelection('k2'), null)
  assert.deepEqual(store.sessionModelSelection('k3'), { model: 'm' }, '坏的是档位，模型保住')
})

test('往返：选择对象原样落盘；旧字符串存档再写回迁移成对象', () => {
  const raw = JSON.stringify({
    activeId: 'legacy',
    draftModelSelection: 'old/draft',
    sessions: [{
      id: 'legacy',
      name: '旧场',
      createdAt: '2026-10-07T00:00:01.000Z',
      updatedAt: '2026-10-07T00:00:02.000Z',
      entries: [],
      modelSelection: 'old/model',
    }],
  })
  const storage = memoryStorage({ [AGENT_SESSIONS_STORAGE_KEY]: raw })
  const now = clock()
  const store = createAgentSessionStore(storage, now)
  store.saveModelSelection('legacy', { model: 'old/model', options: { reasoningLevel: 'medium' } })
  store.saveDraftModelSelection({ model: 'new/draft', options: { reasoningLevel: 'high' } })
  const persisted = JSON.parse(storage.map.get(AGENT_SESSIONS_STORAGE_KEY))
  const row = persisted.sessions.find(item => item.id === 'legacy')
  assert.deepEqual(row.modelSelection, { model: 'old/model', options: { reasoningLevel: 'medium' } }, '落盘是新对象形状，不是字符串')
  assert.deepEqual(persisted.draftModelSelection, { model: 'new/draft', options: { reasoningLevel: 'high' } })
  const again = createAgentSessionStore(storage, now)
  assert.deepEqual(again.sessionModelSelection('legacy'), { model: 'old/model', options: { reasoningLevel: 'medium' } })
  assert.deepEqual(again.draftSessionModelSelection(), { model: 'new/draft', options: { reasoningLevel: 'high' } })
  assert.equal(again.modelSelection('legacy'), 'old/model')
  assert.equal(again.draftModelSelection(), 'new/draft')
})

