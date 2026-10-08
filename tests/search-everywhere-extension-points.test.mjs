// 判据 · **Search Everywhere 的扩展点**（`src/searchEverywhereExtensionPoints.ts`，上游
// `SeItemsProviderFactory` / `SeLegacyItemPresentationProvider` / `SeTargetPresentationProvider` /
// `SeTargetItemSelectionProcessor` 一族）。
//
// 钉四件事：
//   ① 四条 EP 的 id 与上游 xml（`intellij.platform.searchEverywhere.xml:37-53` 的前缀 + 相对名）
//      逐字一致，且已在宿主里声明；
//   ② 贡献者按 id 注册/注销生效；`seItemsProviders` 去重、跳过返回 null 的；
//   ③ 消费面真的读 EP：`contributingSources` 从 EP 收来源档（不再是硬编联合）、`seItemsFor`
//      合并条目、`seSubtitleOf`/`seTargetPresentation`/`processSeTargetSelection`；
//   ④ 本仓五个内建来源挂成五条 bundled 贡献，`all` tab 收全、专用 tab 只收自己那一档。
import test from 'node:test'
import assert from 'node:assert/strict'

import { EXTENSIONS } from '../src/extensionPoints.ts'
import {
  SE_ITEMS_PROVIDER_FACTORY_EP,
  SE_LEGACY_ITEM_PRESENTATION_PROVIDER_EP,
  SE_SOURCE_PROVIDER_IDS,
  SE_TARGET_ITEM_SELECTION_PROCESSOR_EP,
  SE_TARGET_PRESENTATION_PROVIDER_EP,
  contributingSources,
  processSeTargetSelection,
  registerBundledSeItemsProviders,
  registerSeItemsProviderFactory,
  registerSeLegacyItemPresentationProvider,
  registerSeTargetItemSelectionProcessor,
  registerSeTargetPresentationProvider,
  seItemsFor,
  seItemsProviderFactories,
  seItemsProviders,
  seSubtitleOf,
  seTargetPresentation,
} from '../src/searchEverywhereExtensionPoints.ts'

const ctx = (over = {}) => ({ root: '/ws', query: 'foo', tab: 'all', ...over })
const item = (over = {}) => ({ id: 'i1', title: 'Foo', source: 'project', path: 'src/Foo.ts', open: () => {}, ...over })

test('四条 EP 已声明，id 与上游 xml 逐字一致', () => {
  assert.equal(SE_ITEMS_PROVIDER_FACTORY_EP, 'com.intellij.searchEverywhere.itemsProviderFactory')
  assert.equal(SE_LEGACY_ITEM_PRESENTATION_PROVIDER_EP, 'com.intellij.searchEverywhere.legacyItemPresentationProvider')
  assert.equal(SE_TARGET_PRESENTATION_PROVIDER_EP, 'com.intellij.searchEverywhere.targetPresentationProvider')
  assert.equal(SE_TARGET_ITEM_SELECTION_PROCESSOR_EP, 'com.intellij.searchEverywhere.targetItemSelectionProcessor')
  for (const id of [SE_ITEMS_PROVIDER_FACTORY_EP, SE_LEGACY_ITEM_PRESENTATION_PROVIDER_EP, SE_TARGET_PRESENTATION_PROVIDER_EP, SE_TARGET_ITEM_SELECTION_PROCESSOR_EP]) {
    assert.equal(EXTENSIONS.hasExtensionPoint(id), true, `${id} 未声明`)
  }
})

test('第三方工厂按 id 注册后被 seItemsProviders 拿到；返回 null 的跳过；同 id 去重', () => {
  const real = registerSeItemsProviderFactory({
    id: 'demo.factory.a',
    getItemsProvider: () => ({ id: 'demo.prov.a', displayName: 'A', source: 'symbols', collectItems: () => [item({ id: 'a' })] }),
  })
  const dup = registerSeItemsProviderFactory({
    id: 'demo.factory.dup',
    getItemsProvider: () => ({ id: 'demo.prov.a', displayName: 'A2', source: 'symbols', collectItems: () => [item({ id: 'a2' })] }),
  })
  const skipped = registerSeItemsProviderFactory({ id: 'demo.factory.null', getItemsProvider: () => null })
  try {
    assert.ok(seItemsProviderFactories().some(f => f.id === 'demo.factory.a'))
    const providers = seItemsProviders(ctx())
    assert.equal(providers.filter(p => p.id === 'demo.prov.a').length, 1, '同 provider id 去重')
    assert.equal(seItemsProviders(ctx()).some(p => p.id === 'demo.factory.null'), false)
  } finally {
    real.dispose(); dup.dispose(); skipped.dispose()
  }
  assert.equal(seItemsProviderFactories().some(f => f.id === 'demo.factory.a'), false)
})

test('contributingSources 从 EP 收来源档；seItemsFor 合并条目', async () => {
  const project = registerSeItemsProviderFactory({
    id: 'demo.p', getItemsProvider: () => ({ id: 'demo.p', displayName: 'P', source: 'project', collectItems: () => [item({ id: 'f1' })] }),
  })
  const commands = registerSeItemsProviderFactory({
    id: 'demo.c', getItemsProvider: () => ({ id: 'demo.c', displayName: 'C', source: 'commands', collectItems: async () => [item({ id: 'c1', source: 'commands' })] }),
  })
  try {
    const sources = contributingSources(ctx())
    assert.ok(sources.includes('project'))
    assert.ok(sources.includes('commands'))
    const items = await seItemsFor(ctx())
    assert.deepEqual(items.map(i => i.id).sort(), ['c1', 'f1'])
  } finally {
    project.dispose(); commands.dispose()
  }
  assert.deepEqual(contributingSources(ctx()), [])
})

test('展示提供方与目标选择处理器按 EP 顺序消费', () => {
  const legacy = registerSeLegacyItemPresentationProvider({ id: 'demo.legacy', getPresentation: (id) => id === 'i1' ? '旧展示' : null })
  const target = registerSeTargetPresentationProvider({ id: 'demo.target', getPresentation: (t) => t === 'sym' ? '符号展示' : null })
  const first = registerSeTargetItemSelectionProcessor({ id: 'demo.sel.first', process: () => false })
  const second = registerSeTargetItemSelectionProcessor({ id: 'demo.sel.second', process: t => t === 'sym' })
  try {
    assert.equal(seSubtitleOf(item()), '旧展示')
    assert.equal(seSubtitleOf(item({ id: 'other', subtitle: '自带副文本' })), '自带副文本')
    assert.equal(seTargetPresentation('sym', 'q'), '符号展示')
    assert.equal(seTargetPresentation('other', 'q'), null)
    assert.equal(processSeTargetSelection('sym', 'q'), 'demo.sel.second', '第一条不认领、第二条认领')
    assert.equal(processSeTargetSelection('other', 'q'), null)
  } finally {
    legacy.dispose(); target.dispose(); first.dispose(); second.dispose()
  }
})

test('bundled 五个内建来源：all tab 收全、专用 tab 只收自己那一档', () => {
  const make = source => () => [item({ id: `${source}-1`, source })]
  const dispose = registerBundledSeItemsProviders({
    project: make('project'), symbols: make('symbols'), commands: make('commands'), runConfigs: make('runConfigs'), text: make('text'),
  })
  try {
    const all = contributingSources(ctx({ tab: 'all' })).sort()
    assert.deepEqual(all, ['commands', 'project', 'runConfigs', 'symbols', 'text'])
    const files = contributingSources(ctx({ tab: 'files' }))
    assert.deepEqual(files, ['project'])
    const classes = contributingSources(ctx({ tab: 'classes' }))
    assert.deepEqual(classes, ['symbols'])
    assert.deepEqual(contributingSources(ctx({ tab: 'unknown' })), [])
    assert.equal(SE_SOURCE_PROVIDER_IDS.project, 'taocode.seItemsProvider.project')
  } finally { dispose() }
  assert.deepEqual(contributingSources(ctx({ tab: 'all' })), [])
})
