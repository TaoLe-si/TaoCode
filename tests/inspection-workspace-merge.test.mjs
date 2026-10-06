// 「按特性的两份诊断缓存 + 读时合并」的判据（`src/workspaceDiagnostics.ts` / `src/workspaceInspection.ts`）。
//
// 上游对照：platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCacheRegistry.kt
//   · `:26-27` 注册 push 与 pull 两份缓存（push 那份 `supportsPull = false`，见 LspPublishDiagnosticsCache.kt:31）
//   · `:64-80` 面板读的是两份的并集，push 在前
//   · `:92`    pull 里与 push 重复的那条丢掉
// 本仓的差别只在**共享槽只有一个**（`bridge.ts` 的 `lspDiagnostics` 会被 push 整体替换），
// 所以要额外记着"上一次我们往那张表里塞了哪几条"。下面每条都盯着这一点。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DiagnosticSourceCaches,
  diagnosticIdentityKey,
  mergeDiagnosticSources,
} from '../src/workspaceDiagnostics.ts'
import { clearAllLspCaches } from '../src/lspPerFileCache.ts'
import { runWorkspaceInspection } from '../src/workspaceInspection.ts'

/** 造一条诊断：只给必填字段，其余按宿主透传的形状留空。 */
const d = (line, message, extra = {}) => ({ line, character: 0, severity: 1, message, ...extra })

test('合并顺序 = push 在前、pull 追加（上游 :79 的那一句加号）', () => {
  const pushed = [d(1, 'push-1')]
  const pulled = [d(2, 'pull-1')]
  assert.deepEqual(mergeDiagnosticSources(pushed, pulled), [...pushed, ...pulled])
})

test('与 push 逐字段相同的 pull 条目不再列第二遍（上游 :92 的去重）', () => {
  const pushed = [d(3, '同一条', { source: 'jdt', code: 'unused' })]
  const pulled = [d(3, '同一条', { source: 'jdt', code: 'unused' }), d(4, '另一条')]
  const merged = mergeDiagnosticSources(pushed, pulled)
  assert.equal(merged.length, 2, '重复的那条不该出现两次')
  assert.equal(merged[0], pushed[0], '留下的那条就是 push 的那一条（不是 pull 的副本）')
  assert.equal(merged[1].message, '另一条')
})

test('pull 自己内部的重复照旧两条都列 —— 上游只与 push 比，不在 pull 内部再去重', () => {
  const pulled = [d(5, '服务端报了两遍'), d(5, '服务端报了两遍')]
  assert.equal(mergeDiagnosticSources([], pulled).length, 2)
})

test('身份键逐字段：差一个可选字段就是两条不同的诊断', () => {
  const base = diagnosticIdentityKey(d(7, 'm'))
  assert.notEqual(base, diagnosticIdentityKey(d(7, 'm', { endLine: 9 })), '少一个 endLine 不该判成同一条')
  assert.notEqual(base, diagnosticIdentityKey(d(7, 'm', { code: 'x' })), '诊断码参与身份')
  assert.notEqual(base, diagnosticIdentityKey(d(7, 'm', { severity: 2 })), '严重度参与身份')
  assert.notEqual(base, diagnosticIdentityKey(d(7, '别的消息')))
  assert.equal(base, diagnosticIdentityKey(d(7, 'm')), '同样的字段给同样的键')
})

test('共享槽里 push 的旧内容不被整工程报告吃掉', () => {
  const caches = new DiagnosticSourceCaches()
  const pushed = d(1, '编辑器里的波浪线')
  const merged = caches.applyPullReport('a.ts', [pushed], [d(2, '拉来的')])
  assert.deepEqual(merged.map(item => item.message), ['编辑器里的波浪线', '拉来的'])
})

test('连着跑两轮同样的报告不会出现重复（上一轮塞进去的先减掉）', () => {
  const caches = new DiagnosticSourceCaches()
  const slot = []
  slot.splice(0, slot.length, ...caches.applyPullReport('a.ts', slot, [d(2, '拉来的')]))
  const second = caches.applyPullReport('a.ts', slot, [d(2, '拉来的')])
  assert.equal(second.length, 1, '同一条 pull 结果不该在第二轮变成两条')
  assert.equal(second[0].message, '拉来的')
})

test('服务端 push 覆盖过之后，unchanged 的那一份能重新并回来（不重算请求）', () => {
  const caches = new DiagnosticSourceCaches()
  caches.applyPullReport('a.ts', [], [d(2, '拉来的')])
  // 中间用户在编辑器里改了文件 → 服务端推了新的、只含 push 那一份的列表（本仓的共享槽语义）。
  const afterPush = [d(9, '新推来的')]
  const merged = caches.remergePull('a.ts', afterPush)
  assert.deepEqual(merged.map(item => item.message), ['新推来的', '拉来的'])
  assert.equal(caches.remergePull('never.ts', afterPush), null, '从没拉过的文件没什么可沿用')
})

test('本轮报告里完全没提到的文件：pull 那一份作废，push 的留下', () => {
  const caches = new DiagnosticSourceCaches()
  const pushed = d(1, '编辑器里的波浪线')
  caches.applyPullReport('a.ts', [pushed], [d(2, '上一轮拉来的')])
  const rest = caches.dropPull('a.ts', [pushed, d(2, '上一轮拉来的')])
  assert.deepEqual(rest, [pushed], '只少掉我们塞进去的那几条')
  assert.equal(caches.dropPull('never.ts', [pushed]), null, '不归本模块管的文件返回 null，调用方别动它')
  assert.deepEqual(caches.pulledPaths(), [])
})

/** 跑一次整工程检查：query 由调用方给，sources 每例新建，避免用例之间串状态。 */
async function inspect(items, diagnostics, extra = {}) {
  const resultIds = extra.resultIds ?? new Map()
  const outcome = await runWorkspaceInspection({
    query: async () => ({ available: true, items }),
    diagnostics,
    resultIds,
    sources: extra.sources ?? new DiagnosticSourceCaches(),
  })
  return { outcome, resultIds }
}

test('端到端：问题面板读的那张表里 push 与 pull 两份都在，且顺序是 push 在前', async () => {
  const pushed = d(1, 'push 的')
  const diagnostics = new Map([['a.ts', [pushed]]])
  const { outcome } = await inspect(
    [{ path: 'a.ts', kind: 'full', diagnostics: [pushed, d(2, 'pull 的')], resultId: 'r1' }],
    diagnostics)
  assert.equal(outcome.ok, true)
  assert.deepEqual(diagnostics.get('a.ts').map(item => item.message), ['push 的', 'pull 的'])
})

test('端到端：下一轮报告里没有的那条不会变成永久幽灵行', async () => {
  const pushed = d(1, 'push 的')
  const diagnostics = new Map([['a.ts', [pushed]]])
  const caches = new DiagnosticSourceCaches()
  const first = [{ path: 'a.ts', kind: 'full', diagnostics: [d(2, '只在这一轮有')], resultId: 'r1' }]
  await inspect(first, diagnostics, { sources: caches })
  assert.equal(diagnostics.get('a.ts').length, 2)
  // 第二轮服务端不再报这个文件：上一轮拉来的那条收掉，push 的那条本来就在表里、留着。
  await inspect([{ path: 'other.ts', kind: 'full', diagnostics: [], resultId: 'r2' }], diagnostics, { sources: caches })
  assert.deepEqual(diagnostics.get('a.ts'), [pushed])
})

test('端到端：unchanged 的文件按记着的那份重新并一次（不写空数组）', async () => {
  const caches = new DiagnosticSourceCaches()
  const diagnostics = new Map()
  await inspect([{ path: 'a.ts', kind: 'full', diagnostics: [d(2, '拉来的')], resultId: 'r1' }], diagnostics, { sources: caches })
  // 服务端推了新的（覆盖共享槽），随后一次整工程检查回 unchanged。
  diagnostics.set('a.ts', [d(9, '新推来的')])
  const { resultIds } = await inspect(
    [{ path: 'a.ts', kind: 'unchanged', resultId: 'r1' }], diagnostics, { sources: caches, resultIds: new Map([['a.ts', 'r1']]) })
  assert.deepEqual(diagnostics.get('a.ts').map(item => item.message), ['新推来的', '拉来的'])
  assert.deepEqual([...resultIds.entries()], [['a.ts', 'r1']], 'unchanged 的 resultId 照样记下')
})

// 放在最后：这一步会作废**全部**登记的 LSP 缓存（生产里就是"语言服务重启 / 服务器要求重取"那一下）。
test('构造时自登记进批量作废的注册表：refresh / 重启后 pull 那一份不再沿用', () => {
  const caches = new DiagnosticSourceCaches()
  caches.applyPullReport('a.ts', [], [d(2, '拉来的')])
  assert.deepEqual(caches.remergePull('a.ts', [d(9, '新推来的')]), [d(9, '新推来的'), d(2, '拉来的')],
    '清之前：记着的那份还在，能重新并回来')
  const cleared = clearAllLspCaches()
  assert.ok(cleared >= 1, '注册表里至少数得到这一份（同一批里的 LspPerFileCache 也在里面）')
  assert.deepEqual(caches.pulledPaths(), [], '整批作废后 pull 那一份清空')
  assert.equal(caches.remergePull('a.ts', [d(9, '新推来的')]), null, '没有可沿用的旧结果')
  // 清完之后重新拉一次：只剩新的一份，旧的不会复活。
  assert.deepEqual(caches.applyPullReport('a.ts', [d(9, '新推来的')], [d(3, '重启后拉来的')]),
    [d(9, '新推来的'), d(3, '重启后拉来的')])
})
