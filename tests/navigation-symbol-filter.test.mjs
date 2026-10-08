// 结构弹层的符号过滤（`Navigate → 转到当前文件符号` Ctrl+F12 与「转到符号」的文件档）。
//
// 上游：`FileStructurePopup.java:316-318` 给结构树挂 `SpeedSearchComparator(false, true, " ()")` ——
// 驼峰缩写（`GSF` 命中 `GotoSymbolFromFile`）、任意位置起、大小写不敏感。改前本仓是
// `name.toLowerCase().includes(q)`（纯子串），驼峰缩写一个都搜不到。
// 规则在 `src/symbolSearch.ts`（纯函数）；接线在 `src/lspNavigation.ts` 的 `fileSymbolEntries`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { symbolMatchesQuery } from '../src/symbolSearch.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('子串行为保留：原先能命中的查询一个都不少', () => {
  assert.equal(symbolMatchesQuery('getSymbolFromFile', 'symbol'), true)
  assert.equal(symbolMatchesQuery('getSymbolFromFile', 'SymbolFrom'), true)
  assert.equal(symbolMatchesQuery('getSymbolFromFile', 'symbolfromfile'), true, '大小写不敏感')
  assert.equal(symbolMatchesQuery('getSymbolFromFile', 'zzz'), false)
  assert.equal(symbolMatchesQuery('getSymbolFromFile', ''), true, '空查询放行全部')
  assert.equal(symbolMatchesQuery('getSymbolFromFile', '   '), true)
})

test('驼峰缩写能命中（SpeedSearchComparator 的第二参 shouldMatchCamelCase）', () => {
  assert.equal(symbolMatchesQuery('getSymbolFromFile', 'GSF'), true)
  assert.equal(symbolMatchesQuery('GotoSymbolModel', 'GSM'), true)
  assert.equal(symbolMatchesQuery('GotoSymbolModel', 'gsm'), true)
  // 跨词子序列（不要求词首）：`sf` 命中 symbol…File。
  assert.equal(symbolMatchesQuery('getSymbolFromFile', 'sFf'), true)
})

test('模式比名字长、字符对不上时判不命中（局部对齐的半分不算命中）', () => {
  assert.equal(symbolMatchesQuery('Foo', 'FooBar'), false, '模式比目标长不是命中')
  assert.equal(symbolMatchesQuery('FooBar', 'Fzz'), false, 'Fzz 只命中 F —— 半分不算命中')
  assert.equal(symbolMatchesQuery('', 'Foo'), false)
})

test('接线：fileSymbolEntries 委托 lspSymbolBridge 的 documentSymbolEntries（过滤仍用本匹配器、不重排）', () => {
  const navigation = read('src/lspNavigation.ts')
  // 2026-10-04：转换层搬进 `src/lspSymbolBridge.ts`（workspaceSymbol/documentSymbol 一族的包装层），
  // 接线断言跟着走：lspNavigation 仍必须经过这个匹配器，且不重排结构视图顺序。
  assert.match(navigation, /documentSymbolEntries\(outline\.value as NavigationDocumentSymbol\[], path, query\)/,
    'fileSymbolEntries 没有委托 documentSymbolEntries')
  const bridge = read('src/lspSymbolBridge.ts')
  assert.match(bridge, /import \{ SPEED_SEARCH_STRUCTURE_SEPARATORS, symbolMatchesQuery \} from '\.\/symbolSearch\.ts'/, '包装层没有引入匹配器')
  // 结构弹层那一站（`FileStructurePopup.java:318` 的 `new SpeedSearchComparator(false, true, " ()")`）
  // 必须把 `" ()"` 这份硬分隔符带进匹配器 —— 少带一个参数就等于把上游这一档判据丢了。
  assert.match(bridge, /symbolMatchesQuery\(symbol\.name, query, SPEED_SEARCH_STRUCTURE_SEPARATORS\)/,
    'documentSymbolEntries 还在用 toLowerCase().includes（驼峰缩写搜不到）')
  assert.doesNotMatch(bridge, /symbol\.name\.toLowerCase\(\)\.includes\(/, '旧的子串过滤还在')
  // 过滤后只 slice(0,limit) —— 没有任何 sort：上游 SpeedSearch 在树里过滤，行序不变。
  const fileSymbols = bridge.slice(bridge.indexOf('export function documentSymbolEntries'), bridge.indexOf('export function symbolNavigationTarget'))
  assert.doesNotMatch(fileSymbols, /\.sort\(/, 'documentSymbolEntries 不该重排结构视图顺序')
})
