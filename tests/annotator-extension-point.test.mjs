// 判据 · 注解器的**插件贡献面**（`com.intellij.annotator` EP）。
//
// 上游 `Annotator` 是 plugin.xml 里的 `<annotator implementation="…"/>`，由 `LanguageAnnotators`
// 收编（`platform/lang-api/resources/intellij.platform.lang.xml` 的 `AnnotatorEP`）。
// 本仓没有插件 XML 解析器，但有扩展点宿主（`src/extensionPoints.ts`）；这个判据钉三件事：
//   ① 注解器 EP 已声明；
//   ② 第三方按同一个 EP id 挂进来的注解器，会被注册表 `adoptFromExtensions()` 收编并真的被 `run()` 分派
//      （不是"登记了没人消费"的死 EP）；
//   ③ `register()` 会把注解器同时登记进 EP（宿主问得到），`unregister()` 会摘掉。
import test from 'node:test'
import assert from 'node:assert/strict'

import { ANNOTATOR_EP, EXTENSIONS } from '../src/extensionPoints.ts'
import { AnnotatorRegistry } from '../src/annotatorRegistry.ts'

test('注解器 EP 已声明（第三方有可挂的 id）', () => {
  assert.equal(EXTENSIONS.hasExtensionPoint(ANNOTATOR_EP), true)
  assert.equal(ANNOTATOR_EP, 'com.intellij.annotator')
})

test('第三方按 EP 挂进来的注解器会被收编并分派（不是死 EP）', () => {
  const registry = new AnnotatorRegistry()
  const handle = EXTENSIONS.registerExtension(ANNOTATOR_EP, 'third.party.marker', {
    id: 'third.party.marker',
    languages: ['*'],
    dumbAware: true,
    annotate: () => [{ from: 0, to: 1, severity: 'information', kind: 'information', description: '来自第三方' }],
  })
  try {
    assert.equal(registry.adoptFromExtensions(), 1)
    const run = registry.run('java', { path: 'a.java', text: 'a', batchMode: false })
    assert.deepEqual(run.ran, ['third.party.marker'])
    assert.equal(run.annotations.length, 1)
    assert.equal(run.annotations[0].annotator, 'third.party.marker')
    assert.equal(run.annotations[0].batchMode, false)
  } finally {
    handle.dispose()
  }
  // dispose 之后 EP 里不再有它（下一次收编为 0）。
  assert.equal(registry.adoptFromExtensions(), 0)
})

test('register() 同时登记进 EP，unregister() 会摘掉', () => {
  const registry = new AnnotatorRegistry()
  const annotator = { id: 'mirror.test', languages: ['java'], annotate: () => [] }
  registry.register(annotator)
  try {
    assert.ok(EXTENSIONS.entriesFor(ANNOTATOR_EP).some(candidate => candidate.id === 'mirror.test'),
      'register() 没把注解器同步进 EP = 第三方/宿主看不到它')
  } finally {
    registry.unregister('mirror.test')
  }
  assert.equal(EXTENSIONS.entriesFor(ANNOTATOR_EP).some(candidate => candidate.id === 'mirror.test'), false,
    'unregister() 没摘掉 EP 里的那条')
})
