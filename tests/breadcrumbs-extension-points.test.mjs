// 判据 · **面包屑/导航栏的扩展点**（`src/breadcrumbsExtensionPoints.ts`，上游
// `com.intellij.ui.breadcrumbs.BreadcrumbsProvider` 一族）。
//
// 钉四件事：
//   ① EP id 与上游 `BreadcrumbsProvider.java:24` 的 `EP_NAME` 逐字一致，且已在宿主里声明；
//   ② 贡献者按 id 注册/注销生效；
//   ③ **生产消费者**真的读 EP：`adoptBreadcrumbsProviders` 折成
//      `src/navToolbarCrumbs.ts` 的 `BreadcrumbsProvider` 形状，`providersForLanguage`/
//      `showByDefaultOf` 于是从 EP 收上来的贡献取数；`shownLanguages` 汇总语言建表；
//   ④ bundled 按语言挂上后 `providersForLanguage` 真能选中对应语言的 provider。
import test from 'node:test'
import assert from 'node:assert/strict'

import { EXTENSIONS } from '../src/extensionPoints.ts'
import { providersForLanguage, showByDefaultOf } from '../src/navToolbarCrumbs.ts'
import {
  BREADCRUMBS_INFO_PROVIDER_EP,
  adoptBreadcrumbsProviders,
  breadcrumbsInfoProviders,
  registerBreadcrumbsInfoProvider,
  registerBundledBreadcrumbsProviders,
  shownLanguages,
} from '../src/breadcrumbsExtensionPoints.ts'

const crumb = (over = {}) => ({ text: 'Foo', key: 'k:Foo', ...over })

test('EP 已声明，id 与上游 qualifiedName 逐字一致', () => {
  assert.equal(BREADCRUMBS_INFO_PROVIDER_EP, 'com.intellij.breadcrumbsInfoProvider')
  assert.equal(EXTENSIONS.hasExtensionPoint(BREADCRUMBS_INFO_PROVIDER_EP), true)
})

test('贡献者按 id 注册/注销生效', () => {
  const handle = registerBreadcrumbsInfoProvider({
    id: 'demo.crumbs', languages: ['demo'],
    acceptElement: () => true, getElementInfo: c => c.text,
  })
  try {
    assert.ok(breadcrumbsInfoProviders().some(p => p.id === 'demo.crumbs'))
    assert.deepEqual(shownLanguages(), ['demo'])
  } finally { handle.dispose() }
  assert.equal(breadcrumbsInfoProviders().some(p => p.id === 'demo.crumbs'), false)
})

test('生产消费者：adopt 折成 navToolbarCrumbs 形状，providersForLanguage 真取到', () => {
  const handle = registerBreadcrumbsInfoProvider({
    id: 'demo.java', languages: ['java'],
    acceptElement: c => c.key.startsWith('k:'),
    getElementInfo: c => c.text.toUpperCase(),
    getElementIcon: () => 'crumb-icon',
    getElementTooltip: () => '提示',
    isShownByDefault: () => false,
  })
  try {
    const adopted = adoptBreadcrumbsProviders()
    const java = providersForLanguage(adopted, 'java')
    assert.equal(java.length, 1)
    assert.equal(java[0].info(crumb()), 'FOO')
    assert.equal(java[0].icon(crumb()), 'crumb-icon')
    assert.equal(java[0].tooltip(crumb()), '提示')
    assert.equal(java[0].shownByDefault, false, 'isShownByDefault 缺省 false 被带上')
    // showByDefaultOf 对显式 false 的语言返回 false（全票口径）
    assert.equal(showByDefaultOf(adopted, 'java'), false)
  } finally { handle.dispose() }
  assert.equal(providersForLanguage(adoptBreadcrumbsProviders(), 'java').length, 0)
})

test('bundled 按语言挂上后 providersForLanguage 选中对应语言', () => {
  const dispose = registerBundledBreadcrumbsProviders([
    { language: 'typescript', info: c => `ts:${c.text}` },
    { language: 'python', shownByDefault: false },
  ])
  try {
    const adopted = adoptBreadcrumbsProviders()
    const ts = providersForLanguage(adopted, 'typescript')
    assert.equal(ts.length, 1)
    assert.equal(ts[0].info(crumb({ text: 'X' })), 'ts:X')
    assert.equal(providersForLanguage(adopted, 'python')[0].shownByDefault, false)
    assert.deepEqual(shownLanguages().sort(), ['python', 'typescript'])
    // 未声明的语言没有面包屑
    assert.equal(showByDefaultOf(adopted, 'ruby'), false)
  } finally { dispose() }
  assert.deepEqual(shownLanguages(), [])
})
