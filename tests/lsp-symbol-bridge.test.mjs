// LSP 符号导航包装层的判据（`src/lspSymbolBridge.ts`）。
//
// 上游依据：
//   · `LspGoToClassContributor.kt:7-12`（只接受 Class/Enum/Interface/Struct = 5/10/11/23）；
//   · `LspGoToSymbolContributor.kt:7-9`（不过滤 kind）；
//   · `LspWorkspaceSymbolContributor.kt:75-87`（条目要能解析出文件，否则丢弃）；
//   · `LspWorkspaceSymbolEqualityProvider.kt:15-25`（同一条符号去重）；
//   · `LspNavigatableSymbol.kt:55-68`（符号 → 文件 + 选区起点）；
//   · `documentSymbol/converters.kt`（documentSymbol → 结构元素）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CLASS_LIKE_SYMBOL_KINDS, SYMBOL_KIND_NAMES, dedupeSymbols, documentSymbolEntries, isClassLikeSymbol,
  isNavigatableSymbol, mergeWorkspaceSymbols, symbolIdentity, symbolKindName, symbolNavigationTarget,
} from '../src/lspSymbolBridge.ts'

const entry = (over = {}) => ({ name: 'Foo', kind: 5, path: 'src/Foo.java', line: 3, character: 7, ...over })

test('kind 名表与「转到类」四类（上游 LspGoToClassContributor）', () => {
  assert.equal(symbolKindName(5), 'Class')
  assert.equal(symbolKindName(10), 'Enum')
  assert.equal(symbolKindName(11), 'Interface')
  assert.equal(symbolKindName(23), 'Struct')
  assert.equal(SYMBOL_KIND_NAMES[6], 'Method')
  assert.equal(symbolKindName(99), '')
  assert.deepEqual([...CLASS_LIKE_SYMBOL_KINDS].sort((a, b) => a - b), [5, 10, 11, 23])
  assert.equal(isClassLikeSymbol(entry({ kind: 10 })), true)
  // 回归：修正前的 {5,11,13,19,23,26} 把 Variable/Object/TypeParameter 当类，还漏了 Enum。
  assert.equal(isClassLikeSymbol(entry({ kind: 13 })), false)
  assert.equal(isClassLikeSymbol(entry({ kind: 19 })), false)
  assert.equal(isClassLikeSymbol(entry({ kind: 26 })), false)
})

test('可导航判定：没有文件位置/名字的条目不算（上游 findFileByUri 失败即丢）', () => {
  assert.equal(isNavigatableSymbol(entry()), true)
  assert.equal(isNavigatableSymbol(entry({ path: '' })), false)
  assert.equal(isNavigatableSymbol(entry({ name: '' })), false)
  assert.equal(isNavigatableSymbol(entry({ line: Number.NaN })), false)
})

test('身份键与去重：同名同位置同 kind 视为同一条', () => {
  assert.equal(symbolIdentity(entry()), symbolIdentity(entry()))
  assert.notEqual(symbolIdentity(entry()), symbolIdentity(entry({ kind: 6 })))
  assert.notEqual(symbolIdentity(entry()), symbolIdentity(entry({ line: 4 })))
  const dup = dedupeSymbols([entry({ containerName: 'A' }), entry({ containerName: 'A' }), entry({ kind: 6 })])
  assert.equal(dup.length, 2)
})

test('工作区符号合并：多来源、kind 模式、查询（名称或容器）、稳定性与上限', () => {
  const first = [entry({ name: 'Bar', kind: 5 }), entry({ name: 'Baz', kind: 6, path: 'src/Baz.java' })]
  const second = [entry({ name: 'Bar', kind: 5 }), entry({ name: 'Qux', kind: 11, path: 'src/Qux.java' })]
  const merged = mergeWorkspaceSymbols([first, second])
  assert.deepEqual(merged.map(item => item.name), ['Bar', 'Baz', 'Qux'], '无查询保持来源顺序，重复的 Bar 只留一条')
  const exact = mergeWorkspaceSymbols([first, second], { query: 'bar' })
  assert.deepEqual(exact.map(item => item.name), ['Bar'])
  const classes = mergeWorkspaceSymbols([first, second], { mode: 'class' })
  assert.deepEqual(classes.map(item => item.name).sort(), ['Bar', 'Qux'], 'class 模式只留 5/10/11/23')
  const byContainer = mergeWorkspaceSymbols([[entry({ name: 'Inner', containerName: 'OuterService' })]], { query: 'outer' })
  assert.equal(byContainer.length, 1, '容器名命中也能过滤')
  const dropped = mergeWorkspaceSymbols([[entry({ path: '' })]])
  assert.deepEqual(dropped, [], '不可导航的条目丢弃')
  const limited = mergeWorkspaceSymbols([Array.from({ length: 10 }, (_, index) => entry({ name: `S${index}`, line: index }))], { limit: 3 })
  assert.equal(limited.length, 3)
  // 排序档：精确 > 前缀 > 含 > 容器命中；同档按路径 + 行号稳定。
  const ranked = mergeWorkspaceSymbols([[
    entry({ name: 'fooBar', path: 'b' }), entry({ name: 'Foo', path: 'a' }), entry({ name: 'afoo', path: 'c' }),
  ]], { query: 'foo' })
  assert.deepEqual(ranked.map(item => item.name), ['Foo', 'fooBar', 'afoo'])
})

test('documentSymbol → 扁平条目：selectionRange 优先、过滤不重排、上限', () => {
  const symbols = [
    { name: 'Outer', kind: 5, startLine: 0, startChar: 0, selectionLine: 0, selectionChar: 6, selectionEndLine: 0, selectionEndCharacter: 11 },
    { name: 'inner', kind: 6, startLine: 3, startChar: 2, selectionLine: 3, selectionChar: 9 },
  ]
  const entries = documentSymbolEntries(symbols, 'src/A.java')
  assert.deepEqual(entries[0], { name: 'Outer', kind: 5, path: 'src/A.java', line: 0, character: 6, endLine: 0, endCharacter: 11 })
  assert.deepEqual(entries[1], { name: 'inner', kind: 6, path: 'src/A.java', line: 3, character: 9 })
  assert.deepEqual(documentSymbolEntries(symbols, 'src/A.java', 'inner').map(item => item.name), ['inner'])
  assert.deepEqual(documentSymbolEntries(symbols, 'src/A.java', 'out').map(item => item.name), ['Outer'], '驼峰/子序列由匹配器管')
  assert.equal(documentSymbolEntries(symbols, 'src/A.java', '', 1).length, 1)
  assert.deepEqual(documentSymbolEntries(symbols, 'src/A.java').map(item => item.name), ['Outer', 'inner'], '行序不变')
})

test('导航目标：形如 revealLocation 的目标；不可导航时 null', () => {
  assert.deepEqual(symbolNavigationTarget(entry()), { path: 'src/Foo.java', line: 3, kind: '符号', label: 'Foo' })
  assert.equal(symbolNavigationTarget(entry({ line: -2 })).line, 0, '负行号夹到 0')
  assert.equal(symbolNavigationTarget(entry({ path: '' })), null)
})

test('接线：lspNavigation 复用同一份 CLASS_KINDS 且符号搜索走包装层', async () => {
  const navigation = await import('node:fs').then(fs => fs.readFileSync(new URL('../src/lspNavigation.ts', import.meta.url), 'utf8'))
  assert.match(navigation, /export const CLASS_KINDS = CLASS_LIKE_SYMBOL_KINDS/, '转到类的过滤要复用包装层')
  // 桶 4b 把缓存接进来之后，合并层的调用挪到了 `visibleSymbols` 里（缓存的原始应答先过
  // 「按类型过滤」条、再进合并层）—— 意图没变：**工作区符号必须经过 `mergeWorkspaceSymbols`**，
  // 这里改成守新形状（不是放松成 includes）。
  // 桶 4b + gotoByNameContributors 之后：合并层的第一路仍是「缓存原始应答先过过滤条」，
  // 第二路是插件贡献（`contributed`）—— 意图不变：工作区符号必须经过 `mergeWorkspaceSymbols`，
  // 且过滤条在合并之前。守新形状，不放松成 includes。
  assert.match(navigation, /mergeWorkspaceSymbols\(\[filterSymbols\(symbols, hiddenSymbolGroups\.value\), contributed\]/,
    '工作区符号搜索要经过合并层（且过滤条在合并之前）')
  assert.match(navigation, /documentSymbolEntries\(outline\.value as NavigationDocumentSymbol\[\], path, query\)/, '文件内符号搜索要经过转换层')
})
