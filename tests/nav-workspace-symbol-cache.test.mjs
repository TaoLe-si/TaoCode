// workspaceSymbol 的**单槽客户端缓存**（`src/navWorkspaceSymbolCache.ts`）。
//
// 上游依据（逐条，全部已在本地树里按行核过）：
//   · `platform/lsp-impl/src/impl/LspRequestExecutor.kt:51` ——
//     `private val workspaceSymbolCache = register(LspSingleSlotCache<String, List<WorkspaceSymbol>>(…))`
//     （**单槽**、键 = 查询串）；
//   · 同文件 `:156-163` —— `getWorkspaceSymbolsCaching(query)` 走 `workspaceSymbolCache.getOrCompute(query) { … }`，
//     请求失败时 `return@getOrCompute null`；
//   · `platform/lsp-impl/src/impl/cache/LspSingleSlotCache.kt:30-46` —— 命中要
//     `lastPsiModificationCount == psiModCount`（**:36**）且 `matches(...)`（默认档 = 键相等，**:21**）；
//     `val newResult = compute() ?: return null`（**:42**）→ **null 不入槽**；
//   · 同文件 `:38` —— 命中时 `lastKey = key`（键换成查询键、值不动）；
//   · 同文件 `:50-53` —— `clearCache()` 三格全清。
//   · 调用侧顺序：`platform/lsp-impl/src/impl/features/workspaceSymbol/LspWorkspaceSymbolContributor.kt:73`
//     先取缓存、`:86` 才逐条 `shouldAcceptSymbolKind`（`:69` 声明）—— 缓存只管原始应答。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { NavWorkspaceSymbolCache } from '../src/navWorkspaceSymbolCache.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('同查询且修改计数没变：只算一次，第二次直接复用槽', () => {
  let revision = 7
  let computes = 0
  const cache = new NavWorkspaceSymbolCache(() => revision)
  const first = cache.getOrCompute('Foo', () => { computes += 1; return [{ name: 'Foo' }] })
  const second = cache.getOrCompute('Foo', () => { computes += 1; return [{ name: 'Other' }] })
  assert.equal(computes, 1, '第二次不该再算（上游 :36 的命中条件）')
  assert.deepEqual(first, [{ name: 'Foo' }])
  assert.equal(second, first, '返回的是槽里那一份')
  assert.equal(cache.cachedQuery(), 'Foo')
})

test('修改计数一变（编辑器改了 / 文件关了 / 磁盘被替换改写）：缓存必然不命中', () => {
  let revision = 1
  let computes = 0
  const cache = new NavWorkspaceSymbolCache(() => revision)
  cache.getOrCompute('Foo', () => { computes += 1; return [1] })
  revision += 1                       // 本仓 `symbolRevision` 在 onEditorChange / stopLspFile / onSearchReplaced 递增
  cache.getOrCompute('Foo', () => { computes += 1; return [2] })
  assert.equal(computes, 2, '计数变了就要重算（上游 psiModCount）')
})

test('单槽：换查询顶掉旧的，再问第一个会重算', () => {
  let revision = 0
  let computes = 0
  const cache = new NavWorkspaceSymbolCache(() => revision)
  cache.getOrCompute('a', () => { computes += 1; return ['a'] })
  cache.getOrCompute('ab', () => { computes += 1; return ['ab'] })
  cache.getOrCompute('a', () => { computes += 1; return ['a again'] })
  assert.equal(computes, 3, '上游就是一格，不做 LRU')
  assert.equal(cache.cachedQuery(), 'a')
})

test('compute 返回 null（服务器没答上来）：不入槽，下次仍然重算', () => {
  let computes = 0
  const cache = new NavWorkspaceSymbolCache(() => 0)
  assert.equal(cache.getOrCompute('Foo', () => { computes += 1; return null }), null)
  assert.equal(cache.cachedQuery(), null, '槽还是空的（上游 :42）')
  assert.equal(cache.getOrCompute('Foo', () => { computes += 1; return null }), null)
  assert.equal(computes, 2, '"没答上来"不能被缓存成"没有结果"')
})

test('答了空表：入槽并复用 —— 与上一条的区分就是上游 :42 的那条语义', () => {
  let computes = 0
  const cache = new NavWorkspaceSymbolCache(() => 0)
  assert.deepEqual(cache.getOrCompute('zzz', () => { computes += 1; return [] }), [])
  assert.deepEqual(cache.getOrCompute('zzz', () => { computes += 1; return ['不该走到'] }), [])
  assert.equal(computes, 1)
  assert.equal(cache.cachedQuery(), 'zzz', '空表也是有效答案，槽里记着这个查询')
})

test('clearCache（语言服务重启 / 换工程）：三格全清', () => {
  let computes = 0
  const cache = new NavWorkspaceSymbolCache(() => 0)
  cache.getOrCompute('Foo', () => { computes += 1; return ['x'] })
  cache.clearCache()
  assert.equal(cache.cachedQuery(), null)
  cache.getOrCompute('Foo', () => { computes += 1; return ['y'] })
  assert.equal(computes, 2)
})

test('命中时键换成查询键（上游 :38）：自定义 matches 放开后值不动、键跟着走', () => {
  // `matches` 默认是键相等；上游那一条 `lastKey = key` 只有在自定义匹配下才看得见效果，
  // 这里用一个「前缀相同就算同一档」的子类把它测出来（本仓生产用的是默认档）。
  class PrefixCache extends NavWorkspaceSymbolCache {
    matches(storedQuery, _storedValue, queriedQuery) { return queriedQuery.startsWith(storedQuery) }
  }
  const cache = new PrefixCache(() => 0)
  const stored = cache.getOrCompute('Fo', () => ['symbol'])
  const again = cache.getOrCompute('Foo', () => ['recomputed'])
  assert.equal(again, stored, '命中：复用槽里的值')
  assert.equal(cache.cachedQuery(), 'Foo', '键换成了查询键')
})

test('接线：宿主真的在用它（不是只过自己测试的死模块）', () => {
  const source = read('src/lspNavigation.ts')
  assert.match(source, /from '\.\/navWorkspaceSymbolCache\.ts'/, '值 import 必须带扩展名')
  assert.match(source, /new NavWorkspaceSymbolCache<SymbolEntry\[\]>\(\(\) => symbolRevision\)/, '计数源 = 本模块的 symbolRevision')
  assert.match(source, /const cached = workspaceSymbolsCache\.getOrCompute\(q, \(\) => null\)/, '探测用的是「null 不入槽」那条语义')
  assert.match(source, /workspaceSymbolsCache\.clearCache\(\)/, '语言服务重启 / 换工程都清槽')
  // 计数递增的三个真实触发点：编辑器内容变化、文件关闭、批量替换写盘。
  const bumps = source.split('\n').filter(line => line.trim() === 'symbolRevision += 1')
  assert.ok(bumps.length >= 3, `symbolRevision 至少要在三处递增，实际 ${bumps.length} 处`)
  assert.match(source, /watch\(\(\) => deps\.workspaceEpoch\(\)/, '换工程也接上了')
})
