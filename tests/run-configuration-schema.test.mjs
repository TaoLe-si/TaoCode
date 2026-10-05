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
