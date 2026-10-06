// 粘性行的按语言提供者（`src/stickyLineProviders.ts`）：每个语言的 SymbolKind 白名单，
// 以及「字段/局部变量不进、整文件层（package/module）不进」这两条通用口径。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COMMON_SCOPE_KINDS, STICKY_LINE_PROVIDERS, filterStickySymbols, stickyLinesShownForLanguage,
  stickyProvidersFor, stickyScopeKindsFor, stickySymbolAccepted,
} from '../src/stickyLineProviders.ts'

const symbol = (kind, name, startLine, endLine) => ({ kind, name, startLine, endLine })

test('四种语言各有一份 kind 表，通用兜底不含 package/module', () => {
  const ids = STICKY_LINE_PROVIDERS.map(provider => provider.id)
  assert.ok(ids.includes('java') && ids.includes('cpp') && ids.includes('typescript') && ids.includes('common'))
  assert.ok(!COMMON_SCOPE_KINDS.includes(4), 'package 是整文件层，不做粘性行')
  assert.ok(!COMMON_SCOPE_KINDS.includes(2), 'module 同上')
  assert.ok(COMMON_SCOPE_KINDS.includes(5) && COMMON_SCOPE_KINDS.includes(6))
})

test('java：类/接口/枚举/方法/构造器算，字段与局部变量不算', () => {
  assert.ok(stickyScopeKindsFor('java').has(5))
  assert.ok(stickyScopeKindsFor('java').has(6))
  assert.ok(stickyScopeKindsFor('java').has(9))
  assert.ok(!stickyScopeKindsFor('java').has(8), '字段不是作用域')
  assert.ok(!stickyScopeKindsFor('java').has(13), '局部变量不是作用域')
  assert.ok(!stickyScopeKindsFor('java').has(23), 'java 没有 struct')
})

test('cpp：struct/union(kind 23) 与 namespace 都算一层', () => {
  assert.ok(stickyScopeKindsFor('cpp').has(23))
  assert.ok(stickyScopeKindsFor('cpp').has(3))
})

test('typescript：接口/枚举/命名空间算，package 不算', () => {
  assert.ok(stickyScopeKindsFor('typescript').has(11))
  assert.ok(stickyScopeKindsFor('typescript').has(10))
  assert.ok(stickyScopeKindsFor('typescript').has(3))
  assert.ok(!stickyScopeKindsFor('typescript').has(4))
})

test('未知语言/空语言走通用兜底，且永远不返回空集', () => {
  for (const language of [undefined, '', 'kotlin', 'python']) {
    const kinds = stickyScopeKindsFor(language)
    assert.ok(kinds.size > 0, String(language))
    assert.ok(kinds.has(5) && kinds.has(6))
  }
  assert.ok(stickyProvidersFor('python').some(provider => provider.id === 'common'))
})

test('stickySymbolAccepted：kind 在白名单里 + 行号合法 + 名字非空', () => {
  assert.ok(stickySymbolAccepted(symbol(5, 'Foo', 0, 10), 'java'))
  assert.ok(!stickySymbolAccepted(symbol(8, 'field', 1, 1), 'java'))
  assert.ok(!stickySymbolAccepted(symbol(5, '', 0, 10), 'java'), '没有名字的符号不占一行')
  assert.ok(!stickySymbolAccepted(symbol(5, 'Foo', 3, 2), 'java'), '倒序区间非法')
  assert.ok(!stickySymbolAccepted(symbol(5, 'Foo', -1, 2), 'java'))
})

test('filterStickySymbols：保留输入顺序，只按语言过滤', () => {
  const symbols = [symbol(5, 'A', 0, 40), symbol(8, 'field', 2, 2), symbol(6, 'm', 3, 9), symbol(23, 'S', 12, 20)]
  assert.deepEqual(filterStickySymbols(symbols, 'java').map(s => s.name), ['A', 'm'])
  assert.deepEqual(filterStickySymbols(symbols, 'cpp').map(s => s.name), ['A', 'm', 'S'])
})

// 按语言的开关（`lp/sticky-lines` 剩的那一档）：上游除了全局那条 `showStickyLines`，
// 每种语言还能单独关掉 —— 表是 `EditorSettingsExternalizable.java:148` 的 `mapLanguageStickyLines`，
// 读法是同文件 `:520-526` 的 `areStickyLinesShownFor(languageID)`：**没记的语言一律开**
// （源码注释原文 "enabled for all languages by default"），只有显式 false 那一项才关；
// 写进去的入口是 `actions/StickyLinesDisableForLangAction.kt:24-29` 与设置页的复选框
// （`configurable/StickyLinesConfigurableUI.kt:52-62`），两处都要一个新设置键 ⇒ 接线请求。
test('按语言的粘性行开关：只有显式关掉的那一项才关', () => {
  assert.equal(stickyLinesShownForLanguage(undefined, 'java'), true, '还没有这张表 = 全部语言都开')
  assert.equal(stickyLinesShownForLanguage({}, 'java'), true, '表里没记 java')
  assert.equal(stickyLinesShownForLanguage({ java: false }, 'java'), false, '显式关掉的才算关')
  assert.equal(stickyLinesShownForLanguage({ java: false }, 'cpp'), true, '关掉 java 不影响别家')
  assert.equal(stickyLinesShownForLanguage({ java: false, cpp: true }, 'cpp'), true, '显式开也算开')
  assert.equal(stickyLinesShownForLanguage({ java: false }, undefined), true, '语言还没定 ⇒ 走全局那一条')
  // 与全局那条是两把闸：全局关了就没有粘性行，这一条只关一门语言（宿主侧的组合在 stickyLines.ts）。
  const disabled = Object.entries({ java: false, cpp: true }).filter(([, shown]) => !shown).map(([id]) => id)
  assert.deepEqual(disabled, ['java'], '上游 `getDisabledStickyLines:530-535` 就是「值为 false 的那些键」')
})
