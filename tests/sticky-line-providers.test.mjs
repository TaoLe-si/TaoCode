// 粘性行的按语言提供者（`src/stickyLineProviders.ts`）：每个语言的 SymbolKind 白名单，
// 以及「字段/局部变量不进、整文件层（package/module）不进」这两条通用口径。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COMMON_SCOPE_KINDS, STICKY_BASE_LANGUAGES, STICKY_LINE_PROVIDERS, filterStickySymbols,
  resolveStickyLanguage, stickyLinesShownForLanguage, stickyProvidersFor, stickyScopeKindsFor,
  stickySupportedLanguageIds, stickySymbolAccepted,
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

// ——— 语言识别（上游 `StickyLinesLanguageSupport.kt:31-43` 的 `supportedLang`）———
//
// 上游那道不是「拿语言 id 精确比一张表」：它拿着编辑器给的语言**沿 baseLanguage 链往上走**，
// 返回第一个被某个 provider 注册过的语言（`:34-40`，`:32` 的注释原文举例
// `// example: ECMAScript6 -> JavaScript`），整条链都没注册就**原样返回那一个**（`:41`）。
// 注册面 = `:45-52` 遍历 `BreadcrumbsProvider.EP_NAME.extensionList` 取并集（EP 变了就重算，
// `:54-59`）。读「这一语言关没关」那张表时也先过同一道
// （`EditorSettingsState.kt:217-221`：`supportedLang(it)` 之后才 `areStickyLinesShownFor(lang.id)`），
// 所以「用哪份 kind 表」与「这一语言开不开」用的是**同一个**解析结果，不会出现两边各认各的。
//
// 本仓没有 Language 对象图，只有字符串 id（`src/languages.ts:8` 的规范档全小写），
// 于是 base 链在本仓的形态就是 `STICKY_BASE_LANGUAGES` 那张同族写法表：每条都对得上
// **本仓已有**的等价类（`src/appLanguageLabels.ts:25-28`：`.c|.cpp|.h|.hpp|.cc|.cxx` 都叫 C++、
// `.tsx?` 叫 TypeScript、`.[cm]?jsx?` 叫 JavaScript）。这是架构不等价下的本仓形态，
// 不是上游那张表的逐字移植（留痕）。
test('语言识别：先归一大小写与空白，再沿同族链找被注册过的语言', () => {
  assert.equal(resolveStickyLanguage('TypeScript'), 'typescript')
  assert.equal(resolveStickyLanguage('  JAVA '), 'java', '用户手输的关联值带空白也算同一门语言')
  assert.equal(resolveStickyLanguage('TSX'), 'typescript', 'tsx 属于 typescript 那一族（链上第二跳命中注册表）')
  assert.equal(resolveStickyLanguage('hpp'), 'cpp')
  assert.equal(resolveStickyLanguage('C++'), 'cpp')
})

test('语言识别：链上谁都没注册就原样返回（supportedLang:41），不硬塞成已注册的某一档', () => {
  // javascript 一族在本仓**没有** provider（表里只有 java/cpp/typescript）⇒ 走到头也命不中，
  // 上游这里返回的是原语言（`StickyLinesLanguageSupport.kt:41`），不是「挑一个相近的档」。
  assert.equal(resolveStickyLanguage('ecmascript6'), 'ecmascript6')
  assert.equal(resolveStickyLanguage('javascript'), 'javascript')
  assert.equal(resolveStickyLanguage('python'), 'python')
  assert.equal(resolveStickyLanguage(undefined), undefined, '语言还没定 ⇒ 交回 undefined，由全局那条闸管')
})

test('注册面由 provider 表推导（StickyLinesLanguageSupport.kt:45-52）：表序、去重、不含通用兜底', () => {
  assert.deepEqual(stickySupportedLanguageIds(), ['java', 'cpp', 'typescript'])
  // 兜底那一条（languages 为空 = 适用全部）**不是**一门语言，不能混进注册面。
  assert.ok(!stickySupportedLanguageIds().includes(''), '空 languages 是「全部」，不是一个语言 id')
  for (const id of stickySupportedLanguageIds()) {
    assert.ok(STICKY_BASE_LANGUAGES[id] === undefined, '注册过的语言自己不需要同族别名就能命中')
  }
})

test('kind 表按解析后的语言选：同族写法与规范 id 拿到同一张表', () => {
  assert.deepEqual([...stickyScopeKindsFor('JAVA')].sort(), [...stickyScopeKindsFor('java')].sort())
  assert.ok(!stickyScopeKindsFor('JAVA').has(23), 'Java 不认 struct：别名不许退回通用表（通用表里有 23）')
  assert.ok(stickyScopeKindsFor('TS').has(2), 'typescript 那一档认 module，写法 ts 也一样')
  assert.ok(stickyScopeKindsFor('javascript').has(23), '没注册的语言退回通用兜底（含 struct）—— 与今天一致')
  assert.deepEqual(stickyProvidersFor('TSX'), stickyProvidersFor('typescript'))
})

test('按语言的开关用同一个解析结果（EditorSettingsState.kt:217-221）', () => {
  assert.equal(stickyLinesShownForLanguage({ typescript: false }, 'TSX'), false, '关的是 typescript 档 ⇒ 同族 tsx 也算关')
  assert.equal(stickyLinesShownForLanguage({ typescript: false }, 'tsx'), false)
  assert.equal(stickyLinesShownForLanguage({ typescript: false }, 'javascript'), true, 'javascript 不在那条链上')
  assert.equal(stickyLinesShownForLanguage({ cpp: false }, 'hpp'), false, '表里的键是规范语言 id（上游写进去的就是 `language.id`），查的那一侧过同一道解析')
})
