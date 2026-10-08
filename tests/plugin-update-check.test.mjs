// 插件更新检查策略层（`src/pluginUpdateCheck.ts`）的判据 ——
// 上游 `platform/platform-impl/src/com/intellij/ide/plugins/StandalonePluginUpdateChecker.kt` 的
// 可移植一半（门控 / 缓存 / 退避 / 三态结果 / 文案）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CACHED_REQUEST_DELAY,
  INITIAL_UPDATE_DELAY,
  PLUGIN_UPDATE_INSTALL_LABEL,
  nextUpdateDelay,
  pluginUpdateMessage,
  pluginUpdateNotice,
  resetUpdateDelay,
  runPluginUpdateCheck,
  shouldCheckForUpdates,
  updateStatusFor,
  updateStatusFromError,
} from '../src/pluginUpdateCheck.ts'

const plugin = (id, version, extra = {}) => ({ id, name: id, version, description: '', path: '', enabled: true, commands: [], templates: [], ...extra })

test('常量照上游：初值 2000ms、缓存期一天（:60-61）', () => {
  assert.equal(INITIAL_UPDATE_DELAY, 2000)
  assert.equal(CACHED_REQUEST_DELAY, 24 * 60 * 60 * 1000)
})

test('门控（:69-75）：开关关着不查；没查过要查；一天内不查；超过一天要查', () => {
  const now = 10_000_000_000
  assert.equal(shouldCheckForUpdates(0, now), true, '从没查过 ⇒ 查')
  assert.equal(shouldCheckForUpdates(now - 1000, now), false, '刚查过 ⇒ 不查')
  assert.equal(shouldCheckForUpdates(now - CACHED_REQUEST_DELAY - 1, now), true, '超过一天 ⇒ 查')
  assert.equal(shouldCheckForUpdates(now - CACHED_REQUEST_DELAY, now), false, '恰好一天 ⇒ 不查（上游是 `>` 不是 `>=`）')
  assert.equal(shouldCheckForUpdates(0, now, false), false, 'checkNeeded=false ⇒ 不查')
})

test('指数退避（:84）与重置（:155）', () => {
  assert.equal(nextUpdateDelay(INITIAL_UPDATE_DELAY), 4000)
  assert.equal(nextUpdateDelay(4000), 8000)
  assert.equal(resetUpdateDelay(), INITIAL_UPDATE_DELAY)
})

test('三态（:26-40）：available 更新更高 ⇒ update，相同/更低 ⇒ latest，清单坏 ⇒ failed', () => {
  assert.deepEqual(updateStatusFor(plugin('a', '1.0'), '1.1'), {
    kind: 'update', pluginId: 'a', name: 'a', currentVersion: '1.0', newVersion: '1.1',
  })
  assert.deepEqual(updateStatusFor(plugin('a', '1.0'), '1.0'), { kind: 'latest' })
  assert.deepEqual(updateStatusFor(plugin('a', '1.0'), '0.9'), { kind: 'latest' })
  assert.deepEqual(updateStatusFor(plugin('a', '1.0'), undefined), { kind: 'latest' })
  assert.equal(updateStatusFor(plugin('a', '1.0', { error: '清单读不出来' }), '2.0').kind, 'failed')
})

test('fromException（:43-47）：异常折成 failed，detail 保留原文不吞', () => {
  const status = updateStatusFromError('「a」', new Error('boom'))
  assert.equal(status.kind, 'failed')
  assert.equal(status.message, '「a」')
  assert.match(status.detail, /boom/)
})

test('文案（:174-196 / :218-228）：有更新说清新旧版本，latest 不说话', () => {
  assert.equal(pluginUpdateMessage({ kind: 'latest' }), '')
  const update = { kind: 'update', pluginId: 'a', name: 'A', currentVersion: '1.0', newVersion: '1.1' }
  assert.match(pluginUpdateMessage(update), /「A」有可用更新：v1\.0 → v1\.1/)
  assert.match(pluginUpdateMessage({ kind: 'failed', message: '「A」' }), /更新失败/)
  assert.equal(PLUGIN_UPDATE_INSTALL_LABEL, '更新')
})

test('通知形状（:174-196）：只有 update 才发，latest/failed 返回 null', () => {
  const update = { kind: 'update', pluginId: 'a', name: 'A', currentVersion: '1.0', newVersion: '1.1' }
  assert.deepEqual(pluginUpdateNotice(update), { message: pluginUpdateMessage(update), actionLabel: '更新', pluginId: 'a' })
  assert.equal(pluginUpdateNotice({ kind: 'latest' }), null)
  assert.equal(pluginUpdateNotice({ kind: 'failed', message: 'x' }), null)
})

test('跑一轮：门控没过就什么都不查（ran=false，时间戳不变）', async () => {
  const now = 5_000_000
  const result = await runPluginUpdateCheck([plugin('a', '1.0')], {
    available: async () => '2.0', lastCheckMs: now - 1000, nowMs: now,
  })
  assert.equal(result.ran, false)
  assert.deepEqual(result.statuses, [])
  assert.equal(result.lastCheckMs, now - 1000, '没查就不该动时间戳')
})

test('跑一轮：有成功项时刷新时间戳；失败项不阻断其余（逐个 try）', async () => {
  const now = 9_000_000
  const result = await runPluginUpdateCheck([plugin('a', '1.0'), plugin('b', '1.0')], {
    available: async id => { if (id === 'a') throw new Error('读不到'); return '1.2' },
    lastCheckMs: 0, nowMs: now,
  })
  assert.equal(result.ran, true)
  assert.equal(result.statuses.length, 2)
  assert.equal(result.statuses[0].kind, 'failed')
  assert.equal(result.statuses[1].kind, 'update')
  assert.equal(result.lastCheckMs, now, '有成功项 ⇒ 刷新时间戳')
})

test('跑一轮：全失败就不刷新时间戳（下次还会再试）', async () => {
  const now = 9_000_000
  const result = await runPluginUpdateCheck([plugin('a', '1.0')], {
    available: async () => { throw new Error('断网') }, lastCheckMs: 0, nowMs: now,
  })
  assert.equal(result.ran, true)
  assert.equal(result.lastCheckMs, 0)
})