// `agent/settings` 判据：设置模型、归一化、保存前校验、持久化、诚实提示。
//
// 起因（用户原话）："原有 Zcode 设置，并入 TaoCode，单开一栏 Agent 设置"。
// 这里钉住三件事：坏存档能被救回来（不许把用户锁在外面）、用户敲错的输入要当场拦下、
// 没配齐模型/供应商/端点/密钥时必须当场点名拒绝（不许让填了地址看起来像已连上）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_CONTEXT_MAX_CHARS, AGENT_CONTEXT_MIN_CHARS, AGENT_SETTINGS_STORAGE_KEY,
  editPolicyOf, isPermissionTier, loadAgentSettings,
  normalizeAgentSettings, saveAgentSettings, validateAgentSettings, defaultAgentSettings,
  TASK_AUTO_ARCHIVE_DAY_OPTIONS,
} from '../src/agentSettings.ts'
import { defaultAgentPermissions } from '../src/agent.ts'
import { prepareModelRequest } from '../src/agentHostProtocol.ts'
import { encodeCustomModelValue } from '../src/agentModelSelection.ts'

test('ZCode 常规节（general）键名与出厂默认逐字对齐', () => {
  const general = defaultAgentSettings().general
  assert.equal(general.messageStreamShowReasoning, true, 'ZCode GeneralSectionContent 默认 true')
  assert.equal(general.messageStreamShowTodos, false)
  assert.equal(general.zcodeInteractionBehavior, 'queue')
  assert.equal(general.askUserQuestionAutoResolution, true)
  assert.equal(general.modelIoFullRetentionEnabled, false)
  assert.equal(general.taskAutoArchiveEnabled, false)
  assert.equal(general.taskAutoArchiveOlderThanDays, 7)
  assert.deepEqual([...TASK_AUTO_ARCHIVE_DAY_OPTIONS], [3, 7, 14, 30], 'ZCode TASK_AUTO_ARCHIVE_DAY_OPTIONS')
})

test('general 坏档逐字段救：非法交互行为/越界天数退默认，代理三条字符串兜底', () => {
  const saved = normalizeAgentSettings({ general: { zcodeInteractionBehavior: '别的', taskAutoArchiveOlderThanDays: 99, httpProxy: 'http://127.0.0.1:7890' } })
  assert.equal(saved.general.zcodeInteractionBehavior, 'queue', '非法档退 queue')
  assert.equal(saved.general.taskAutoArchiveOlderThanDays, 7, '不在档位里退 7')
  assert.equal(saved.general.httpProxy, 'http://127.0.0.1:7890', '合法字符串保留')
  assert.equal(saved.general.httpProxyNoProxy, '', '缺键补默认')
})

test('providers 逐条救：坏条目只丢自己，models 里缺 id 的丢弃', () => {
  const saved = normalizeAgentSettings({ providers: [
    '不是对象',
    { id: 'p1', name: '自建', baseUrl: 'https://api.example.com', apiKey: 'sk-x', models: [{ id: 'm1', name: '一号' }, { name: '缺 id' }, '垃圾'] },
    { name: '缺 id 的供应商' },
  ] })
  assert.equal(saved.providers.length, 2)
  const first = saved.providers[0]
  assert.equal(first.id, 'p1')
  assert.equal(first.models.length, 1, 'models 里只有 m1 合法')
  // 模型条目的键集合由归一化登记（`inputFormat` 是 2026-10-07 之后的必带元数据，
  // 这里不再整份 deepEqual —— 但把键集合钉死，防止归一再往形状里塞没登记的东西）。
  assert.deepEqual(Object.keys(first.models[0]).sort(), ['enabled', 'id', 'inputFormat', 'name'])
  assert.equal(first.models[0].id, 'm1')
  assert.equal(first.models[0].name, '一号')
  assert.equal(first.models[0].enabled, true)
  const second = saved.providers[1]
  assert.ok(second.id.startsWith('provider-'), '缺 id 的供应商补一个生成 id')
})

test('设置往返（含 general/providers）读回是同一份', () => {
  const storage = { map: new Map(), getItem: k => (storage.map.has(k) ? storage.map.get(k) : null), setItem: (k, v) => { storage.map.set(k, v) } }
  const settings = defaultAgentSettings()
  settings.general.httpProxy = 'http://127.0.0.1:7890'
  settings.providers.push({ id: 'p1', name: '自建', baseUrl: 'https://api.example.com', apiKey: '', models: [{ id: 'glm', name: 'GLM', enabled: true }] })
  saveAgentSettings(settings, storage)
  const back = loadAgentSettings(storage)
  assert.equal(back.general.httpProxy, 'http://127.0.0.1:7890')
  assert.equal(back.providers.length, 1)
  // 「读回是同一份」对的是**归一化后**的形状（模型元数据带 inputFormat 等可选键）。
  assert.deepEqual(back.providers[0].models, normalizeAgentSettings(settings).providers[0].models)
})


/** 内存存储，模拟 localStorage。 */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, value) },
  }
}

test('默认设置的权限四档取自单一真源，不另立一套', () => {
  const settings = defaultAgentSettings()
  assert.deepEqual(settings.permissions, defaultAgentPermissions)
  assert.equal(settings.requireApprovalForWrites, true, '默认写盘前要等用户按 Do')
  assert.equal(settings.autoOpenDiff, true)
  assert.equal(settings.contextBudgetChars, 60_000)
})

test('坏存档永不抛：非对象 / 坏 JSON / 缺键全部回落到默认', () => {
  assert.deepEqual(normalizeAgentSettings(null), defaultAgentSettings())
  assert.deepEqual(normalizeAgentSettings('一个字符串'), defaultAgentSettings())
  assert.deepEqual(normalizeAgentSettings(42), defaultAgentSettings())
  // 缺键：旧存档只存了 model，其余补默认（不许按字段数量判损坏）
  const partial = normalizeAgentSettings({ model: '我的模型' })
  assert.equal(partial.model, '我的模型')
  assert.deepEqual(partial.permissions, defaultAgentPermissions)
  assert.equal(partial.contextBudgetChars, 60_000)
})

test('归一化夹住越界值，非法档退回默认', () => {
  const clamped = normalizeAgentSettings({ contextBudgetChars: 9_999_999 })
  assert.equal(clamped.contextBudgetChars, AGENT_CONTEXT_MAX_CHARS)
  assert.equal(normalizeAgentSettings({ contextBudgetChars: 1 }).contextBudgetChars, AGENT_CONTEXT_MIN_CHARS)
  assert.equal(normalizeAgentSettings({ contextBudgetChars: 'abc' }).contextBudgetChars, 60_000)
  // 权限档非法 → 逐字段退回默认，其它字段不受影响
  const mixed = normalizeAgentSettings({ permissions: { read: 'yes', write: 'never' } })
  assert.equal(mixed.permissions.read, 'allow', '非法档退回该字段默认')
  assert.equal(mixed.permissions.write, 'never', '合法档保留')
  assert.equal(mixed.permissions.network, 'never')
})

test('差异上下文行数只认既有档位', () => {
  assert.equal(normalizeAgentSettings({ diffContextLines: 5 }).diffContextLines, 5)
  assert.equal(normalizeAgentSettings({ diffContextLines: 7 }).diffContextLines, 3, '不在档位里退回默认')
  assert.equal(normalizeAgentSettings({ diffContextLines: '5' }).diffContextLines, 3)
})

test('isPermissionTier 只认三档', () => {
  assert.equal(isPermissionTier('allow'), true)
  assert.equal(isPermissionTier('ask'), true)
  assert.equal(isPermissionTier('never'), true)
  assert.equal(isPermissionTier('yes'), false)
  assert.equal(isPermissionTier(1), false)
  assert.equal(isPermissionTier(null), false)
})

test('保存前校验：越界/非法档位要当场拦下并说清', () => {
  assert.deepEqual(validateAgentSettings(defaultAgentSettings()), [], '默认设置必须可保存')
  const bad = { ...defaultAgentSettings(), contextBudgetChars: 999 }
  assert.equal(validateAgentSettings(bad).length, 1)
  assert.match(validateAgentSettings(bad)[0], /上下文预算/)
  const badLines = { ...defaultAgentSettings(), diffContextLines: 7 }
  assert.match(validateAgentSettings(badLines)[0], /差异上下文行数/)
  const float = { ...defaultAgentSettings(), contextBudgetChars: 1000.5 }
  assert.match(validateAgentSettings(float)[0], /整数/)
  const badEndpoint = { ...defaultAgentSettings(), endpoint: '不是我 的地址' }
  assert.match(validateAgentSettings(badEndpoint)[0], /模型端点/)
  assert.deepEqual(validateAgentSettings({ ...defaultAgentSettings(), endpoint: '' }), [], '端点留空是合法的')
  assert.deepEqual(validateAgentSettings({ ...defaultAgentSettings(), endpoint: 'https://api.example.com/v1' }), [])
  const emptyModel = { ...defaultAgentSettings(), model: '   ' }
  assert.match(validateAgentSettings(emptyModel)[0], /模型名/)
})

test('往返：存进去再读回来是同一份', () => {
  const storage = memoryStorage()
  const settings = { ...defaultAgentSettings(), model: '测试模型', contextBudgetChars: 12_345, diffContextLines: 10 }
  assert.equal(saveAgentSettings(settings, storage), true)
  assert.deepEqual(loadAgentSettings(storage), settings)
  assert.ok(storage.map.has(AGENT_SETTINGS_STORAGE_KEY))
})

test('存储坏掉/不可用时退回默认，不抛', () => {
  const broken = { getItem: () => '{不是 JSON', setItem: () => {} }
  assert.deepEqual(loadAgentSettings(broken), defaultAgentSettings())
  const throwing = { getItem: () => { throw new Error('配额') }, setItem: () => { throw new Error('配额') } }
  assert.deepEqual(loadAgentSettings(throwing), defaultAgentSettings())
  assert.equal(saveAgentSettings(defaultAgentSettings(), throwing), false, '存不下要如实返回 false')
  assert.deepEqual(loadAgentSettings(null), defaultAgentSettings())
})

test('诚实提示：没配齐模型/供应商/端点/密钥时明确拒绝，不静默发空请求', () => {
  // 旧口径的 `modelConnectionNotice`（"本地假模型 / 尚未接入联网模型 / 仅作为配置保存"三句）
  // 随**真模型链路接通**作废：对话请求现在真的发出去（`src/agentHostProtocol.ts` 的
  // `prepareModelRequest` + 原生 `agent.model.stream`），"有没有联网"不再是一句设置页文案
  // 能断言的事。要钉的换成**没配齐时不假装**：每一条都点名缺什么，而不是发一个空请求出去。
  const messages = [{ role: 'user', content: 'hi' }]
  const provider = (patch = {}) => ({
    ...defaultAgentSettings(),
    model: encodeCustomModelValue('p1', 'm1'),
    providers: [{
      id: 'p1', name: 'P1', apiFormat: 'openai-chat-completions',
      baseUrl: '', apiKey: '', models: [{ id: 'm1', name: 'M1', enabled: true }],
      ...patch,
    }],
  })
  assert.throws(() => prepareModelRequest(defaultAgentSettings(), messages, 'D:/proj', []), /请先选择已配置的模型/)
  assert.throws(() => prepareModelRequest(provider(), messages, 'D:/proj', []), /缺少 Base URL/)
  assert.throws(() => prepareModelRequest(provider({ baseUrl: 'https://api.example.com/v1' }), messages, 'D:/proj', []), /缺少 API Key/)
  assert.throws(() => prepareModelRequest(provider({ baseUrl: 'not a url', apiKey: 'k' }), messages, 'D:/proj', []), /Base URL 无效/)
  assert.throws(() => prepareModelRequest(provider({ baseUrl: 'ftp://example.test/v1', apiKey: 'k' }), messages, 'D:/proj', []), /只支持 HTTP 或 HTTPS/)
  // 阳性对照：配齐之后不再抛，且组出的是真请求（否则上面五条可能只是"永远抛"）。
  const plan = prepareModelRequest(provider({ baseUrl: 'https://api.example.com/v1', apiKey: 'k' }), messages, 'D:/proj', [])
  assert.ok(plan.request.url.startsWith('https://api.example.com/v1'), '配齐后应组出真请求')
  assert.ok(plan.request.body.includes('"model"'), '请求体里要带上模型（原生 http 层固定 POST，不带 method 字段）')
})

test('editPolicyOf 只交出差异那几位', () => {
  const settings = { ...defaultAgentSettings(), requireApprovalForWrites: false, autoOpenDiff: false, diffContextLines: 5 }
  assert.deepEqual(editPolicyOf(settings), { requireApprovalForWrites: false, autoOpenDiff: false, diffContextLines: 5 })
})
