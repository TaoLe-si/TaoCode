// Composer **正文**草稿持久化判据（2026-10-08 ui-agent）。
//
// 判据对象是 `src/agentComposerDrafts.ts`（上游 `v4/composer/composerDraftStore.ts` 的 scope 存储）
// 与它在 `AgentPanel.vue` 里的接线。三条产品承诺：
//   1. 切会话恢复对应正文 —— 每场会话各存各的正文，切回去要装回输入框；
//   2. 发送后只清已发送那一个 scope —— 中途换过会话时不许清当前输入框（上游 `updateComposerDraft` 的 scope 守卫）；
//   3. 换工作区不串草稿 —— 草稿与会话库同一套工作区键口径（`storageKeyForProject`），换根就是另一份。
//
// 没有 DOM，所以模块行为用内存存储真跑；面板接线用源码锚点钉（哪个出口被谁调）。
// 每条「不许 X」都配一条阳性对照 —— 本仓吃过空判据的亏。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  AGENT_COMPOSER_DRAFTS_STORAGE_KEY,
  AGENT_DRAFT_SCOPE_ROOT,
  createAgentComposerDraftStore,
} from '../src/agentComposerDrafts.ts'
import { AGENT_SESSIONS_STORAGE_KEY, storageKeyForProject } from '../src/agentSessions.ts'

const panel = readFileSync(new URL('../src/components/AgentPanel.vue', import.meta.url), 'utf8')

/** 内存存储（照 tests/agent-sessions.test.mjs 的形状；removeItem 可选，这里给全）。 */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, value) },
    removeItem: key => { map.delete(key) },
  }
}

/** 取某个工作区那份存档的原始文本（判"整库被清"要看盘上那一格）。 */
function rawFile(storage, projectRoot) {
  return storage.getItem(storageKeyForProject(AGENT_COMPOSER_DRAFTS_STORAGE_KEY, projectRoot))
}

test('scope 口径：绑了会话用会话 id，未绑定用 `__draft__`（上游 V4_DRAFT_SCOPE_ROOT）', () => {
  assert.equal(AGENT_DRAFT_SCOPE_ROOT, '__draft__')
  // 与模型选择那一格（会话库）是两份键：草稿有自己的键空间（上游 composerDraftStore 的独立前缀）。
  assert.notEqual(AGENT_COMPOSER_DRAFTS_STORAGE_KEY, AGENT_SESSIONS_STORAGE_KEY)
  const storage = memoryStorage()
  const drafts = createAgentComposerDraftStore(storage, 'D:/proj')
  drafts.write(AGENT_DRAFT_SCOPE_ROOT, '还没建会话时写的')
  drafts.write('session-1', '第一场的正文')
  assert.equal(drafts.read(AGENT_DRAFT_SCOPE_ROOT), '还没建会话时写的')
  assert.equal(drafts.read('session-1'), '第一场的正文')
  assert.ok(rawFile(storage, 'D:/proj'), '草稿必须落在自己的工作区键上')
  // 反向：这一格没有就返回空串（不抛、不编）。
  assert.equal(drafts.read('没有这一场'), '')
})

test('切会话恢复对应正文：每个 scope 各存一份，读回来逐字对应', () => {
  const drafts = createAgentComposerDraftStore(memoryStorage(), 'D:/proj')
  drafts.write('s1', '给第一场的话')
  drafts.write('s2', '给第二场的话')
  // 切走再切回：读到的必须是那一场自己的正文。
  assert.equal(drafts.read('s1'), '给第一场的话')
  assert.equal(drafts.read('s2'), '给第二场的话')
  assert.equal(drafts.read('s1'), '给第一场的话')
  // 后写的场次不影响先写的（不是"最后一格覆盖全部"）。
  drafts.write('s3', '第三场')
  assert.equal(drafts.read('s1'), '给第一场的话')

  // 面板接线：scope 现取（切会话是同步改 activeId 的），恢复走 restoreDraftText；
  // 三个切换出口（切场 / 新建 / 删除）都要装回输入框，换工作区那条也一样。
  assert.match(panel, /function draftScopeId\(\): string \{ return sessions\.activeId\(\) \?\? AGENT_DRAFT_SCOPE_ROOT \}/,
    'scope 必须是「当前会话 id，未绑定回落到 __draft__」')
  assert.match(panel, /function restoreDraftText\(scopeId: string\) \{ draft\.value = drafts\.read\(scopeId\)/,
    '恢复正文必须读草稿库（不许把上一次的输入留在框里）')
  for (const call of ['restoreDraftText(id)', 'restoreDraftText(created.id)', 'restoreDraftText(nextActiveId ?? AGENT_DRAFT_SCOPE_ROOT)', 'restoreDraftText(sessions.activeId() ?? AGENT_DRAFT_SCOPE_ROOT)']) {
    assert.ok(panel.includes(call), `切会话链缺一个恢复出口：${call}`)
  }
  // 每改一次正文就写当前 scope（上游 updateComposerContent 每次都 persistV4ComposerDraft）。
  assert.match(panel, /watch\(draft, async \(\) => \{[\s\S]{0,400}?drafts\.write\(draftScopeId\(\), draft\.value\)/,
    '正文必须随输入写回当前 scope')
})

test('发送后只清已发送那一个 scope：只清它，别场草稿原样留着', () => {
  const drafts = createAgentComposerDraftStore(memoryStorage(), 'D:/proj')
  drafts.write('s1', '要发给模型的话')
  drafts.write('s2', '第二场没发出去的草稿')
  // 面板发送链的等价调用序列（AgentPanel.vue 的 send → clearSentDraft）：
  // 发送前抓 sentScope，await 回来只清那一格 —— 用户中途切到 s2 也不动当前输入框。
  drafts.write('s1', '')
  assert.equal(drafts.read('s1'), '', '已发送那一场必须清掉')
  assert.equal(drafts.read('s2'), '第二场没发出去的草稿', '别的场次不许被一起清掉')

  // 面板接线：sentScope 必须在 await 之前抓下来，清的是它而不是"当前 scope"。
  assert.match(panel, /const sentScope = draftScopeId\(\)/, '发送前要抓下这一场的 scope')
  assert.match(panel, /function clearSentDraft\(scopeId: string\) \{\s*drafts\.write\(scopeId, ''\)/,
    '只许清传进来的那个 scope')
  assert.match(panel, /if \(scopeId === draftScopeId\(\)\) draft\.value = ''/,
    '只有这个 scope 还是当前场时才清输入框（换过会话不许动输入框）')
  assert.ok(!/drafts\.write\(draftScopeId\(\), ''\)/.test(panel),
    '不许拿"当前 scope"去清：await 期间用户可能已经切场，那样清的是另一场的正文')
  // 阳性对照：上面那条禁忌写法确实会被抓到（不是永不命中的空判据）。
  assert.ok(/drafts\.write\(draftScopeId\(\), ''\)/.test("drafts.write(draftScopeId(), '')"),
    '阳性对照：禁忌写法应被同一正则命中')
  // 发送成功后把当前场存回会话库，并把 `__draft__` 升格成会话（上游 promoteComposerDraft：先写目标、再清来源）。
  assert.match(panel, /persistSession\(\)/, '发送后要存档会话')
  assert.match(panel, /drafts\.write\(AGENT_DRAFT_SCOPE_ROOT, ''\)/, '升格后要清掉 `__draft__` 那格')
})

test('换工作区不串草稿：键带工作区后缀，两份库互不可见', () => {
  const storage = memoryStorage()
  const a = createAgentComposerDraftStore(storage, 'D:/proj-a')
  const b = createAgentComposerDraftStore(storage, 'D:/proj-b')
  a.write('s1', 'A 工作区的草稿')
  assert.equal(b.read('s1'), '', 'B 工作区不许读到 A 的草稿')
  b.write('s1', 'B 工作区的草稿')
  assert.equal(a.read('s1'), 'A 工作区的草稿', 'B 写自己的不许动 A')
  // 两份键必须真的不同（否则上面只是"同一个键被读了两遍"）。
  assert.notEqual(
    storageKeyForProject(AGENT_COMPOSER_DRAFTS_STORAGE_KEY, 'D:/proj-a'),
    storageKeyForProject(AGENT_COMPOSER_DRAFTS_STORAGE_KEY, 'D:/proj-b'),
  )
  // 没有工作区：无后缀（与会话库同口径）。
  assert.equal(storageKeyForProject(AGENT_COMPOSER_DRAFTS_STORAGE_KEY), AGENT_COMPOSER_DRAFTS_STORAGE_KEY)

  // 面板接线：换根那一支要连草稿库一起重建 —— 只换会话库会让新工作区的输入写进旧根的键。
  assert.match(panel, /if \(previousRoot !== projectRoot\)[\s\S]{0,300}?drafts = createAgentComposerDraftStore\(undefined, projectRoot\)/,
    '换工作区必须重建草稿库（否则新工作区的正文写进旧工作区的键）')
  assert.match(panel, /if \(previousRoot !== projectRoot\)[\s\S]{0,300}?sessions = createAgentSessionStore\(undefined, undefined, projectRoot\)/,
    '会话库那一份也要重建（阳性对照：两支一起换）')
})

test('空正文不留空壳，坏存档永不抛：单格丢掉、别格照旧', () => {
  const storage = memoryStorage()
  const drafts = createAgentComposerDraftStore(storage, 'D:/proj')
  // 清空后那格必须消失（上游 persistV4ComposerDraft 的清扫分支）：留一个空串会被读成"有草稿"。
  drafts.write('s1', '写点什么')
  drafts.write('s2', '别动我')
  drafts.write('s1', '   ')
  assert.equal(drafts.read('s1'), '')
  const file = JSON.parse(rawFile(storage, 'D:/proj'))
  assert.deepEqual(Object.keys(file.scopes), ['s2'], '空白正文只该清掉自己那一格')
  assert.equal(file.scopes.s2, '别动我')
  // 一格不剩就把键删掉（没有 removeItem 的存储退回写空文件，读回来同样是"没有草稿"）。
  drafts.write('s2', '')
  assert.equal(rawFile(storage, 'D:/proj'), null, '一格不剩时该删掉整个键')
  // 没有 removeItem 的存储：退回写空文件，读回来同样是"没有草稿"。
  const noRemove = { map: new Map(), getItem(key) { return this.map.has(key) ? this.map.get(key) : null }, setItem(key, value) { this.map.set(key, value) } }
  const fallback = createAgentComposerDraftStore(noRemove, 'D:/proj')
  fallback.write('s1', 'x')
  fallback.write('s1', '')
  assert.equal(fallback.read('s1'), '', '写空文件后读回来仍是空')
  assert.equal(JSON.parse(noRemove.map.get(storageKeyForProject(AGENT_COMPOSER_DRAFTS_STORAGE_KEY, 'D:/proj'))).scopes.s1, undefined)
  // scope 是空串：没有可写的落点，返回 false 且不落盘。
  assert.equal(drafts.write('', 'x'), false)
  assert.equal(drafts.read('  '), '')

  // 坏存档：非 JSON / 版本不对 → 当空；单格坏只丢自己。
  assert.equal(createAgentComposerDraftStore(memoryStorage({ [storageKeyForProject(AGENT_COMPOSER_DRAFTS_STORAGE_KEY, 'D:/proj')]: '不是 JSON' }), 'D:/proj').read('s1'), '')
  assert.equal(createAgentComposerDraftStore(memoryStorage({ [storageKeyForProject(AGENT_COMPOSER_DRAFTS_STORAGE_KEY, 'D:/proj')]: JSON.stringify({ version: 2, scopes: { s1: '旧版本' } }) }), 'D:/proj').read('s1'), '')
  const mixed = createAgentComposerDraftStore(memoryStorage({
    [storageKeyForProject(AGENT_COMPOSER_DRAFTS_STORAGE_KEY, 'D:/proj')]: JSON.stringify({ version: 1, scopes: { good: '留得下', bad: 42, blank: '   ' } }),
  }), 'D:/proj')
  assert.equal(mixed.read('good'), '留得下', '能救的格子要留下')
  assert.equal(mixed.read('bad'), '', '非字符串整格丢掉')
  assert.equal(mixed.read('blank'), '', '空白整格丢掉')
})
