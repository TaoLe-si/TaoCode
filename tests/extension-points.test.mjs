// 判据 · **扩展点宿主**（`src/extensionPoints.ts`，上游 `com.intellij.openapi.extensions` 一族）
// 以及它接上的三个真实消费者（补全贡献者 / 内联提示提供者 / 动作）。
//
// 钉四件事：
//   ① `LoadingOrder` 的解析与排序语义（first / last / before <id> / after <id>、组合、循环依赖报错）；
//   ② EP 声明与贡献注册/注销/覆盖、作用域过滤、动态闸；
//   ③ 三个既有注册表**真的从 EP 取初始集合**（不是各写一份私有表）；
//   ④ 第三方按 EP id 挂进来的贡献者/提供者/动作，消费者看得见（不是死代码）。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ACTION_EP, APPLICATION_SCOPE, COMPLETION_CONTRIBUTOR_EP, EXTENSIONS, ExtensionPointHost,
  ExtensionSortingError, INLAY_PROVIDER_EP, parseLoadingOrder, sortByLoadingOrder,
} from '../src/extensionPoints.ts'
import { createContributorRegistry, contributorsFromExtensions } from '../src/completionContributors.ts'
import { createInlayProviderRegistry, inlayProvidersFromExtensions } from '../src/inlayProviderRegistry.ts'
import { ActionRegistry } from '../src/actionRegistry.ts'

const entry = (id, over = {}) => ({ id, value: id, extensionPoint: 'x', scope: APPLICATION_SCOPE, order: '', priority: 0, sequence: 0, source: 'user', ...over })

test('LoadingOrder 解析：四档、组合、旧写法、坏声明抛错', () => {
  assert.deepEqual(parseLoadingOrder(null), { first: false, last: false, before: [], after: [] })
  assert.deepEqual(parseLoadingOrder(''), { first: false, last: false, before: [], after: [] })
  assert.deepEqual(parseLoadingOrder('first'), { first: true, last: false, before: [], after: [] })
  assert.deepEqual(parseLoadingOrder('last'), { first: false, last: true, before: [], after: [] })
  // 组合（上游 LoadingOrder.kt:17-18 的例子：想插在某个 first 的前面就得写 "first, before XXX"）。
  assert.deepEqual(parseLoadingOrder('first, before XXX'), { first: true, last: false, before: ['XXX'], after: [] })
  assert.deepEqual(parseLoadingOrder('after a, before b'), { first: false, last: false, before: ['b'], after: ['a'] })
  // 旧写法 before:/after:（上游 :61-76 的 *_STR_OLD）。
  assert.deepEqual(parseLoadingOrder('before:old'), { first: false, last: false, before: ['old'], after: [] })
  assert.deepEqual(parseLoadingOrder('after:old'), { first: false, last: false, before: [], after: ['old'] })
  // 认不出的段抛错（上游是 AssertionError，静默吃掉会造出"顺序写了但没生效"的假功能）。
  assert.throws(() => parseLoadingOrder('middle'), /顺序声明不合法/)
})

test('排序：before/after 是硬约束，priority/注册序只决定同层次序', () => {
  // a 声明 after c ⇒ c 必在 a 前；b 声明 before a ⇒ b 必在 a 前。
  const sorted = sortByLoadingOrder([entry('a', { order: 'after c' }), entry('b', { order: 'before a' }), entry('c')])
  const ids = sorted.map(e => e.id)
  assert.ok(ids.indexOf('c') < ids.indexOf('a'), 'after c ⇒ c 在 a 前')
  assert.ok(ids.indexOf('b') < ids.indexOf('a'), 'before a ⇒ b 在 a 前')
})

test('排序：first 在所有非 first 之前、last 在所有非 last 之后', () => {
  const sorted = sortByLoadingOrder([entry('mid1'), entry('mid2'), entry('first1', { order: 'first' }), entry('last1', { order: 'last' })])
  const ids = sorted.map(e => e.id)
  assert.equal(ids[0], 'first1', 'first 排最前')
  assert.equal(ids[ids.length - 1], 'last1', 'last 排最后')
  assert.deepEqual(ids.slice(1, 3), ['mid1', 'mid2'], '其余按注册序')
})

test('排序：无约束时按 priority 降序、注册序升序；循环依赖抛 ExtensionSortingError', () => {
  const ranked = sortByLoadingOrder([
    entry('low', { priority: 0, sequence: 1 }),
    entry('high', { priority: 5, sequence: 2 }),
    entry('same', { priority: 5, sequence: 3 }),
  ])
  assert.deepEqual(ranked.map(e => e.id), ['high', 'same', 'low'], 'priority 降序、同档注册早者先')
  assert.throws(
    () => sortByLoadingOrder([entry('x', { order: 'after y' }), entry('y', { order: 'after x' })]),
    error => error instanceof ExtensionSortingError && error.entries.length === 2,
  )
})

test('EP 声明/注册/注销/覆盖：未声明拒注册、非动态拒注册、同 id 覆盖', () => {
  const host = new ExtensionPointHost()
  assert.throws(() => host.registerExtension('nope', 'a', 1), /未声明/)
  host.declareExtensionPoint({ id: 'ep.a', name: '测试 EP' })
  assert.equal(host.hasExtensionPoint('ep.a'), true)
  assert.deepEqual(host.extensionsOf('ep.a'), [])
  const handle = host.registerExtension('ep.a', 'one', { v: 1 })
  assert.deepEqual(host.extensionsOf('ep.a'), [{ v: 1 }])
  // 同 id 覆盖不新增。
  host.registerExtension('ep.a', 'one', { v: 2 })
  assert.deepEqual(host.extensionsOf('ep.a'), [{ v: 2 }])
  assert.equal(handle.dispose(), true)
  assert.deepEqual(host.extensionsOf('ep.a'), [])
  assert.equal(handle.dispose(), false, '再注销一次返回 false')
  // 非动态 EP 拒绝运行期注册（上游 dynamic="false"）。
  host.declareExtensionPoint({ id: 'ep.static', dynamic: false })
  assert.throws(() => host.registerExtension('ep.static', 'x', 1), /不是动态的/)
})

test('作用域过滤：application 贡献对任何 scope 可见，project 贡献只对该 scope 可见', () => {
  const host = new ExtensionPointHost()
  host.declareExtensionPoint({ id: 'ep.scoped' })
  host.registerExtension('ep.scoped', 'app', 'A')
  host.registerExtension('ep.scoped', 'p1', 'P1', { scope: 'project:/x' })
  host.registerExtension('ep.scoped', 'p2', 'P2', { scope: 'project:/y' })
  assert.deepEqual(host.extensionsOf('ep.scoped', 'project:/x'), ['A', 'P1'])
  assert.deepEqual(host.extensionsOf('ep.scoped', 'project:/y'), ['A', 'P2'])
  assert.deepEqual(host.extensionsOf('ep.scoped'), ['A'], '缺省 scope 只看应用级')
  assert.equal(host.allEntries('ep.scoped').length, 3, 'allEntries 不看作用域')
})

test('EP 内容变化通知监听者（ExtensionPointListener 的等价物）', () => {
  const host = new ExtensionPointHost()
  host.declareExtensionPoint({ id: 'ep.notify' })
  const seen = []
  const stop = host.addListener(id => seen.push(id))
  host.registerExtension('ep.notify', 'a', 1)
  host.unregisterExtension('ep.notify', 'a')
  assert.deepEqual(seen, ['ep.notify', 'ep.notify'])
  stop()
  host.registerExtension('ep.notify', 'b', 2)
  assert.deepEqual(seen, ['ep.notify', 'ep.notify'], '取消订阅后不再通知')
})

test('已声明的 EP id 与上游 qualifiedName 逐字一致', () => {
  // 上游 XML 里写的是相对名 `completion.contributor`，但 `ExtensionPointName` 的**限定名**带
  // `com.intellij.` 前缀（`CompletionContributor.java:143`）—— 插件按限定名挂，写相对名挂不上。
  assert.equal(COMPLETION_CONTRIBUTOR_EP, 'com.intellij.completion.contributor')
  assert.equal(INLAY_PROVIDER_EP, 'com.intellij.codeInsight.inlayProvider')
  // 动作面：上游没有同名的 EP（动作走 plugin.xml 的 `<actions>` 块 + ActionManagerImpl），
  // 这个 id 是本仓给「动作贡献面」起的名字，第三方按它挂即被 `ActionRegistry.adoptFromExtensions` 收编。
  assert.equal(ACTION_EP, 'com.intellij.action')
  for (const id of [COMPLETION_CONTRIBUTOR_EP, INLAY_PROVIDER_EP, ACTION_EP]) assert.equal(EXTENSIONS.hasExtensionPoint(id), true)
})

test('补全注册表：内置贡献者登记进 EP，第三方按 EP id 挂进来的消费者看得见', () => {
  const registry = createContributorRegistry()
  // 内置的进了 EP（不是只进私有表）。
  const fromEp = contributorsFromExtensions().map(contributor => contributor.id)
  assert.ok(fromEp.includes('word-completion'), '内置词补全登记进 EP')
  // 第三方按 EP id 直接注册（不经注册表工厂）—— 再建一个注册表时它被收编。
  const external = { id: 'ext-demo', mode: 'always', contribute: () => [{ label: 'EXT', insertText: 'EXT', sortText: '~', detail: '', kind: 'word' }] }
  EXTENSIONS.registerExtension(COMPLETION_CONTRIBUTOR_EP, 'ext-demo', external)
  const second = createContributorRegistry([])
  assert.ok(second.contributors().map(contributor => contributor.id).includes('ext-demo'), 'EP 里的外部贡献者被收编')
  assert.equal(second.contributeAll({ text: 'abc', offset: 3, language: 'java' }).filter(item => item.label === 'EXT').length, 1, '外部贡献者真的产条目')
  // 注销经注册表时 EP 侧同步清掉。
  assert.equal(second.unregister('ext-demo'), true)
  assert.ok(!contributorsFromExtensions().map(contributor => contributor.id).includes('ext-demo'))
  assert.equal(registry.unregister('nope'), false)
})

test('内联提示注册表：三个内置提供者进 EP，第三方按 EP id 挂进来能产条目', () => {
  createInlayProviderRegistry()
  const ids = inlayProvidersFromExtensions().map(provider => provider.id)
  for (const id of ['urlPath', 'parameterName', 'lineAuthor']) assert.ok(ids.includes(id), `${id} 登记进 EP`)
  EXTENSIONS.registerExtension(INLAY_PROVIDER_EP, 'ext-hint', {
    id: 'ext-hint', isAvailableFor: () => true, collect: () => [{ line: 0, character: 0, label: 'X' }],
  })
  const registry = createInlayProviderRegistry([])
  const hints = registry.collectAll({ path: 'a.ts', language: 'typescript', text: 'x' })
  assert.ok(hints.some(hint => hint.label === 'X'), 'EP 里的外部提供者产条目')
  assert.equal(registry.unregister('ext-hint'), true)
  assert.ok(!inlayProvidersFromExtensions().map(provider => provider.id).includes('ext-hint'))
})

test('动作注册表：注册即进 EP，adoptFromExtensions 收编外部动作，注销同步清 EP', () => {
  const registry = new ActionRegistry()
  registry.register({ id: 'demo.one', title: '一', run: () => {} })
  assert.ok(EXTENSIONS.extensionsOf(ACTION_EP).some(descriptor => descriptor.id === 'demo.one'), '注册的动作进了 EP')
  // 外部按 EP id 挂一个动作 —— adoptFromExtensions 收编（上游 ActionManagerImpl 启动时读 plugin.xml）。
  EXTENSIONS.registerExtension(ACTION_EP, 'ext.act', { id: 'ext.act', title: '外部动作', run: () => {} })
  const adopted = registry.adoptFromExtensions()
  assert.ok(adopted >= 1)
  assert.equal(registry.has('ext.act'), true)
  assert.equal(registry.titleOf('ext.act'), '外部动作')
  assert.equal(registry.get('ext.act').source, 'plugin', '收编来的来源标 plugin')
  // 注销时 EP 侧同步清掉。
  assert.equal(registry.unregister('demo.one'), true)
  assert.ok(!EXTENSIONS.extensionsOf(ACTION_EP).some(descriptor => descriptor.id === 'demo.one'))
})

test('接线：三个消费者文件真的 import 扩展点宿主，不是各写一份私有表', async () => {
  const { readFileSync } = await import('node:fs')
  const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
  for (const file of ['src/completionContributors.ts', 'src/inlayProviderRegistry.ts', 'src/actionRegistry.ts']) {
    assert.match(read(file), /from '\.\/extensionPoints\.ts'/, `${file} 没接扩展点宿主`)
  }
  assert.match(read('src/completionContributors.ts'), /contributorsFromExtensions/)
  assert.match(read('src/inlayProviderRegistry.ts'), /inlayProvidersFromExtensions/)
  assert.match(read('src/actionRegistry.ts'), /adoptFromExtensions/)
})