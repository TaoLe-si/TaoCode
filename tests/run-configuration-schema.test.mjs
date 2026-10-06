import test from 'node:test'
import assert from 'node:assert/strict'
import { reactive } from 'vue'
import { normalizeRunConfigurations } from '../src/runConfigurationSchema.ts'
import { request } from '../src/bridge.ts'
import { previewSettingsError } from '../src/previewSettings.ts'

const configs = () => [
  { name: 'api', type: 'application', command: '', program: 'api.exe', args: ['hello world', ''], env: ['PORT=8080'], beforeLaunch: [{ name: 'build', command: 'build-api' }] },
  { name: 'client', type: 'shell', command: 'run-client' },
  { name: 'all', type: 'compound', command: '', configurations: ['api', 'client'] },
]

test('compound and program-only configurations preserve all launch data, including Vue proxies', () => {
  const input = reactive(configs())
  const result = normalizeRunConfigurations(input)
  assert.deepEqual(result, configs())
  input[0].args[0] = 'changed'
  input[2].configurations.reverse()
  assert.deepEqual(result, configs())
})

test('unknown, duplicate, self, empty and cyclic compound members fail before persistence', () => {
  for (const members of [[], ['missing'], ['all'], ['api', 'api'], [5]]) {
    const input = configs()
    input[2].configurations = members
    assert.throws(() => normalizeRunConfigurations(input))
  }
  const cyclic = configs()
  cyclic.push({ name: 'nested', type: 'compound', command: '', configurations: ['all'] })
  cyclic[2].configurations = ['nested']
  assert.throws(() => normalizeRunConfigurations(cyclic), /循环/)
  assert.throws(() => normalizeRunConfigurations([{ name: 'empty', command: '' }]))
  assert.throws(() => normalizeRunConfigurations([{ name: 'plain', command: 'run', configurations: ['plain'] }]))
})

test('preview settings persist compound shapes and leave state unchanged after rejection', async () => {
  const input = configs()
  const stored = await request('project.settings.update', { runConfigs: input })
  assert.deepEqual(stored.settings.runConfigs, input)
  await assert.rejects(request('project.settings.update', { runConfigs: [{ name: 'bad', type: 'compound', command: '', configurations: ['missing'] }] }), error => error.code === 'INVALID_SETTINGS')
  const unchanged = await request('project.settings.update', {})
  assert.deepEqual(unchanged.settings.runConfigs, input)
})

test('preview limits use UTF-8 bytes and reject unrecognized fields', () => {
  assert.throws(() => normalizeRunConfigurations([{ name: '中'.repeat(27), command: 'run' }]))
  assert.throws(() => normalizeRunConfigurations([{ name: 'x', command: 'run', temporary: true }]))
})

test('preview accepts real editor enum values and the same font-size bounds as native', () => {
  for (const size of [4, 9, 14, 33, 40]) assert.equal(previewSettingsError('fontSize', size, []), null)
  for (const size of [3, 41, '14']) assert.notEqual(previewSettingsError('fontSize', size, []), null)
  for (const direction of ['contentBased', 'ltr', 'rtl']) assert.equal(previewSettingsError('bidiTextDirection', direction, []), null)
  for (const mode of ['none', 'indentBlock', 'indentEachLine', 'reformatBlock']) assert.equal(previewSettingsError('reformatOnPaste', mode, []), null)
  for (const placement of ['top', 'bottom']) assert.equal(previewSettingsError('breadcrumbsPlacement', placement, []), null)
})

// ── 2026-10-06 第三批（runcfg3）：JAR 那一族的**落盘**判据 ────────────────────────────────
// 「建得出、存不下去」这个形状出过两次（schema 硬编码第二份清单 / 宿主白名单少改一处），
// 所以 jar 的记录在**前端这一层**就必须给出人看得懂的结论：缺入口 ⇒ 报入口；形状齐 ⇒ 报宿主没接。
// 五处一致的整体判据在 tests/run-config-types.test.mjs，这里只核 normalize 这一道门。
const jarRecord = (over = {}) => ({
  name: '跑 app.jar', type: 'jar', command: '', program: 'C:/jdk/bin/java.exe', args: ['-jar', 'build/app.jar'], ...over,
})

test('JAR 记录在宿主接上之前存不下去，而且报的是「宿主没接」而不是「字段无效」', () => {
  assert.throws(() => normalizeRunConfigurations([jarRecord()]), /宿主还没接/)
  // 复合配置把 jar 当成员也一样拦下（成员走同一道门，不是只在顶层查）。
  const compound = { name: '全家桶', type: 'compound', command: '', configurations: ['跑 app.jar'] }
  assert.throws(() => normalizeRunConfigurations([jarRecord(), compound]), /宿主还没接/)
})

test('JAR 缺入口时报的是入口那句，排在类型白名单之前（不静默、也不把人绕晕）', () => {
  assert.throws(() => normalizeRunConfigurations([jarRecord({ args: [] , command: 'java' })]), /没有 JAR 路径/)
  assert.throws(() => normalizeRunConfigurations([jarRecord({ args: ['-jar', ''] })]), /没有 JAR 路径/)
  // 未知字段照样拒（jar 不豁免任何一条既有校验）。
  assert.throws(() => normalizeRunConfigurations([jarRecord({ jarPath: 'build/app.jar' })]), /运行配置字段无效/,
    '本仓不新增 jarPath 那类键：JAR 折算进现成的 program/args，known_keys 不扩')
  assert.throws(() => normalizeRunConfigurations([jarRecord({ name: '' })]), /没有 JAR 路径|字段无效/)
})
