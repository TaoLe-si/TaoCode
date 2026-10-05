// `pf/startup` 的环境键/服务/存根判据（`src/environmentKeys.ts`）。
//
// 上游依据（platform/platform-impl/src/com/intellij/ide/environment/impl 与 platform-api）：
//   · `DefaultEnvironmentService`：有界面时键值交给用户，服务回 null（:23-40）；
//   · `HeadlessEnvironmentService`：系统属性 → JSON 配置文件 → 缺键抛 `MissingEnvironmentKeyException`
//     （:30-92），空值不覆盖别的来源；
//   · `EnvironmentKeyStubGenerator`：已注册键按 id 排序写 `description`/`key`/`value`，未注册的附末尾；
//   · `BaseEnvironmentService.checkKeyRegistered`：没登记的键要告警。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EnvironmentConfiguration, EnvironmentKeyRegistry, createDefaultEnvironmentService, createHeadlessEnvironmentService,
  environmentKey, generateEnvironmentKeyStub, missingEnvironmentKeyMessage, parseEnvironmentKeyConfiguration,
} from '../src/environmentKeys.ts'

const KEY = environmentKey('taocode.profile', 'Profile used by headless runs.\nSecond line.')

test('键注册表：按 id 排序、必需键汇总、未登记判定', () => {
  const registry = new EnvironmentKeyRegistry()
  registry.register({ knownKeys: [environmentKey('b.key', 'B')] })
  registry.register({ knownKeys: [environmentKey('a.key', 'A')], requiredKeys: () => [environmentKey('a.key', 'A')] })
  assert.deepEqual(registry.knownKeys().map(key => key.id), ['a.key', 'b.key'])
  assert.deepEqual(registry.requiredKeys().map(key => key.id), ['a.key'])
  assert.equal(registry.isRegistered(KEY), false)
  assert.equal(registry.isRegistered(environmentKey('a.key', 'A')), true, '按 id 判登记（描述不同不影响）')
})

test('EnvironmentConfiguration：重复赋值报错（上游 builder 的 check）', () => {
  const configuration = new EnvironmentConfiguration()
  configuration.assign(KEY, 'dev')
  assert.equal(configuration.get(KEY), 'dev')
  assert.throws(() => configuration.assign(KEY, 'prod'), /重复/)
  assert.equal(EnvironmentConfiguration.EMPTY.get(KEY), null)
})

test('headless 服务：系统属性优先、其次配置、缺键抛带说明的错', () => {
  const service = createHeadlessEnvironmentService({
    systemProperties: { 'taocode.profile': 'from-property' },
    values: { 'taocode.profile': 'from-config', 'other.key': 'x' },
  })
  assert.equal(service.getEnvironmentValue(KEY), 'from-property')
  assert.equal(service.getEnvironmentValue(environmentKey('other.key', 'Other')), 'x')
  assert.equal(service.getEnvironmentValueOrDefault(environmentKey('missing', 'Missing'), 'fallback'), 'fallback')
  assert.throws(() => service.getEnvironmentValue(environmentKey('missing', 'Missing')), /Missing value for the environment key 'missing'/)
  const message = missingEnvironmentKeyMessage(KEY)
  assert.ok(message.includes('Description of taocode.profile'), '缺键文案要带说明')
  assert.ok(message.includes('generateEnvironmentKeysFile'), '缺键文案要点出存根生成器')
})

test('配置文件解析：坏 JSON/坏条目告警跳过，空值不覆盖', () => {
  const warnings = []
  assert.deepEqual(parseEnvironmentKeyConfiguration('{ not json', message => warnings.push(message)), {})
  assert.equal(warnings.length, 1, '坏 JSON 要告警')
  assert.deepEqual(parseEnvironmentKeyConfiguration('{"key": "x"}', message => warnings.push(message)), {})
  assert.equal(warnings.length, 2, '不是数组要告警')
  const values = parseEnvironmentKeyConfiguration(JSON.stringify([
    { key: 'a', value: '1' },
    { key: 'b', value: '' },
    { key: 3, value: 'x' },
    { key: 'c' },
  ]), message => warnings.push(message))
  assert.deepEqual(values, { a: '1' }, '空值/坏条目跳过')
  assert.equal(warnings.length, 4)
})

test('默认（有界面）服务：回 null 并告警未登记键', () => {
  const registry = new EnvironmentKeyRegistry()
  const warnings = []
  const service = createDefaultEnvironmentService(registry, message => warnings.push(message))
  assert.equal(service.getEnvironmentValue(KEY), null)
  assert.equal(service.getEnvironmentValueOrDefault(KEY, 'fallback'), 'fallback')
  assert.equal(warnings.length, 2)
  assert.ok(warnings[0].includes('not registered'), '未登记的键要告警')
})

test('存根生成：按 id 排序、键序 description/key/value、未注册键附末尾、--no-descriptions', () => {
  const configuration = new EnvironmentConfiguration()
  configuration.assign(KEY, 'dev')
  configuration.assign(environmentKey('zzz.last', 'Z'), '9')
  const text = generateEnvironmentKeyStub([KEY, environmentKey('aaa.first', 'First')], configuration)
  const parsed = JSON.parse(text)
  assert.deepEqual(parsed.map(entry => entry.key), ['aaa.first', 'taocode.profile', 'zzz.last'], '按 id 排序，未注册的附末尾')
  assert.deepEqual(parsed[1].description, ['Profile used by headless runs.', 'Second line.'], '描述按行拆')
  assert.equal(parsed[1].value, 'dev')
  assert.equal(parsed[0].value, '', '没赋值的已注册键写空串')
  assert.deepEqual(Object.keys(parsed[1]), ['description', 'key', 'value'], '字段顺序照上游')
  const withoutDescriptions = JSON.parse(generateEnvironmentKeyStub([KEY], configuration, false))
  assert.deepEqual(Object.keys(withoutDescriptions[0]), ['key', 'value'])
})
