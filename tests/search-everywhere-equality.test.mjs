// 判据 · SE 结果去重扩展点（`src/searchEverywhereEquality.ts` + `src/searchEverywhere.ts` 的接线）——
// 上游 `com.intellij.searchEverywhereResultsEqualityProvider` 的同名方法面。
//
// 钉五件事：
//   ① EP id 逐字等于上游 qualifiedName（`intellij.platform.lang.impl.xml:237`），且已声明；
//   ② 三档动作 `DoNothing`/`Skip`/`Replace` 与 `combine` 的合成语义逐条对上游；
//   ③ 聚合问法取**第一个不等于 DoNothing** 的答案（上游 `composite` 的 `firstOrNull`）；
//   ④ **真实消费侧**：`searchEverywhereResults` 真的会因一条贡献少一行 / 换一行；
//      没有 provider 时行为与从前一字不差（既有的 id 去重仍在）。
//   ⑤ 上游内置的四条 `*EqualityProvider` 的名字/形状在本仓的落点说明。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  SE_DO_NOTHING, SE_RESULTS_EQUALITY_PROVIDER_EP, SE_SKIP, combineSEActions,
  compareSearchEverywhereItems, declareSearchEverywhereEqualityExtensionPoint, dedupeSearchEverywhereItems,
  registerSearchEverywhereEqualityProvider, searchEverywhereEqualityProviders, seReplace,
  unregisterSearchEverywhereEqualityProvider,
} from '../src/searchEverywhereEquality.ts'
import { EXTENSIONS } from '../src/extensionPoints.ts'
import { searchEverywhereResults } from '../src/searchEverywhere.ts'

const root = new URL('../', import.meta.url)
const read = rel => readFileSync(new URL(rel, root), 'utf8')

const fileItem = (id, title, path) => ({ id, title, path, source: 'project' })
const symbolItem = (id, title) => ({ id, title, source: 'symbols' })

test('EP id 逐字取自上游 qualifiedName，且已声明', () => {
  assert.equal(SE_RESULTS_EQUALITY_PROVIDER_EP, 'com.intellij.searchEverywhereResultsEqualityProvider')
  assert.ok(EXTENSIONS.hasExtensionPoint(SE_RESULTS_EQUALITY_PROVIDER_EP), 'EP 应已声明')
  declareSearchEverywhereEqualityExtensionPoint()
  declareSearchEverywhereEqualityExtensionPoint()
  assert.deepEqual(searchEverywhereEqualityProviders(), [], '没有贡献时 EP 上应是空的')
})

test('三档动作与 combine 的合成语义逐条对上游 SEEqualElementsActionType', () => {
  assert.deepEqual(SE_DO_NOTHING, { kind: 'doNothing' })
  assert.deepEqual(SE_SKIP, { kind: 'skip' })
  const a = symbolItem('a', 'A')
  const b = symbolItem('b', 'B')
  // DoNothing.combine(another) = another
  assert.deepEqual(combineSEActions(SE_DO_NOTHING, SE_SKIP), SE_SKIP)
  // Skip.combine(another) = if (another is Replace) another else this
  assert.deepEqual(combineSEActions(SE_SKIP, SE_SKIP), SE_SKIP)
  assert.deepEqual(combineSEActions(SE_SKIP, seReplace(a)), seReplace(a))
  // Replace.combine(another) = if (another is Replace) Replace(listOf + other) else this
  assert.deepEqual(combineSEActions(seReplace(a), seReplace(b)), seReplace([a, b]))
  assert.deepEqual(combineSEActions(seReplace(a), SE_SKIP), seReplace(a))
})

test('聚合问法取第一个不等于 DoNothing 的答案（上游 composite 的 firstOrNull）', () => {
  const first = registerSearchEverywhereEqualityProvider({ id: 'test.nothing', compareItems: () => SE_DO_NOTHING })
  const second = registerSearchEverywhereEqualityProvider({
    id: 'test.skip',
    compareItems: (item, found) => (found.some(entry => entry.title === item.title) ? SE_SKIP : SE_DO_NOTHING),
  })
  const item = fileItem('f1', 'same.ts', 'src/same.ts')
  assert.deepEqual(compareSearchEverywhereItems(item, []), SE_DO_NOTHING)
  assert.deepEqual(compareSearchEverywhereItems(item, [fileItem('f2', 'same.ts', 'lib/same.ts')]), SE_SKIP)
  unregisterSearchEverywhereEqualityProvider('test.nothing')
  unregisterSearchEverywhereEqualityProvider('test.skip')
  assert.deepEqual(searchEverywhereEqualityProviders(), [])
  void first
  void second
})

test('dedupe：Skip 丢掉、Replace 摘掉被替换的那些；顺序保持', () => {
  const handle = registerSearchEverywhereEqualityProvider({
    id: 'test.merge-by-title',
    compareItems: (item, found) => {
      const clash = found.filter(entry => entry.title === item.title)
      return clash.length ? seReplace(clash) : SE_DO_NOTHING
    },
  })
  const out = dedupeSearchEverywhereItems([
    fileItem('a', 'X', 'p/X'),
    fileItem('b', 'Y', 'p/Y'),
    fileItem('c', 'X', 'q/X'),
  ])
  assert.deepEqual(out.map(item => item.id), ['b', 'c'], '同名的后一条替换前一条（保持到达顺序）')

  const skipHandle = registerSearchEverywhereEqualityProvider({
    id: 'test.skip-second',
    compareItems: (item, found) => (found.some(entry => entry.id === item.id) ? SE_SKIP : SE_DO_NOTHING),
  })
  const deduped = dedupeSearchEverywhereItems([fileItem('d', 'Z', 'p/Z'), fileItem('d', 'Z', 'p/Z')])
  assert.deepEqual(deduped.map(item => item.id), ['d'])
  unregisterSearchEverywhereEqualityProvider('test.merge-by-title')
  unregisterSearchEverywhereEqualityProvider('test.skip-second')
  void handle
  void skipHandle
})

test('真实消费侧：searchEverywhereResults 因一条贡献少一行；无 provider 时一字不差', () => {
  const items = [fileItem('f1', 'same.ts', 'src/same.ts'), fileItem('f2', 'same.ts', 'lib/same.ts')]
  const before = searchEverywhereResults(items, '', 'all', 50).map(item => item.id)
  assert.deepEqual(before, ['f1', 'f2'], '没有 provider 时两条都在（既有行为）')

  const handle = registerSearchEverywhereEqualityProvider({
    id: 'test.drop-lib-duplicate',
    compareItems: (item, found) => (found.some(entry => entry.title === item.title) ? SE_SKIP : SE_DO_NOTHING),
  })
  const after = searchEverywhereResults(items, '', 'all', 50).map(item => item.id)
  assert.deepEqual(after, ['f1'], '重复的第二条被 provider 挡掉')
  // 带查询词那一支同样过 provider（`searchEverywhereResults` 的两条返回路径都接了）。
  const queried = searchEverywhereResults(items, 'same', 'all', 50).map(item => item.id)
  assert.deepEqual(queried, ['f1'], '带查询词的路径也过 provider')
  unregisterSearchEverywhereEqualityProvider('test.drop-lib-duplicate')
  assert.deepEqual(searchEverywhereResults(items, '', 'all', 50).map(item => item.id), ['f1', 'f2'])
})

test('模块被真实消费（不是只被自己调）', () => {
  const se = read('src/searchEverywhere.ts')
  assert.match(se, /from '\.\/searchEverywhereEquality\.ts'/, 'searchEverywhere.ts 要 import 去重模块')
  assert.match(se, /dedupeSearchEverywhereItems\(/, 'searchEverywhereResults 要调它')
  const mod = read('src/searchEverywhereEquality.ts')
  // 上游内置的四条 provider 与 EP 声明坐标都写在模块头（本仓没有 PSI/Java 插件，
  // 只落 EP 宿主面；四条内置的语义见模块头注释）。
  for (const name of ['TrivialElementsEqualityProvider', 'PsiElementsEqualityProvider',
    'ActionsEqualityProvider', 'OptionEqualityProvider', 'JavaClassAndFileEqualityProvider']) {
    assert.ok(mod.includes(name), `模块头应记下上游 ${name} 的出处`)
  }
  assert.match(mod, /intellij\.platform\.lang\.impl\.xml:237/, 'EP 声明坐标要写进模块头')
})
