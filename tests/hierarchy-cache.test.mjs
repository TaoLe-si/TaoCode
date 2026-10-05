// `ls/hierarchy` 的补齐判据：层级 children 缓存（`src/hierarchyCache.ts` + `src/hierarchyView.ts` 的接线）。
//
// 上游依据：`HierarchyBrowser`/`HierarchyTreeStructure` 把展开过的 children 留在模型里，
// 折叠再展开不重问；本仓之前每次展开都重发一次 LSP 请求（同一节点来回折两次 = 两次往返）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { HIERARCHY_CACHE_LIMIT, createHierarchyCache, hierarchyCacheKey, hierarchyShape } from '../src/hierarchyCache.ts'

test('键按「形状 + 节点」隔离：同一节点的 incoming/outgoing 不串数据', () => {
  const item = '["a/A.java","m",6,1,2]'
  const incoming = hierarchyCacheKey(hierarchyShape('call', 'incoming'), item)
  const outgoing = hierarchyCacheKey(hierarchyShape('call', 'outgoing'), item)
  const supertypes = hierarchyCacheKey(hierarchyShape('type', 'supertypes'), item)
  assert.notEqual(incoming, outgoing)
  assert.notEqual(outgoing, supertypes)
  assert.notEqual(incoming, hierarchyCacheKey(hierarchyShape('call', 'incoming'), '另一个节点'))
  assert.equal(incoming, hierarchyCacheKey(hierarchyShape('call', 'incoming'), item), '同一形状同一节点必须同键')
})

test('读写与按前缀作废：换方向时另一边不误伤', () => {
  const cache = createHierarchyCache()
  const incoming = hierarchyShape('call', 'incoming')
  const outgoing = hierarchyShape('call', 'outgoing')
  cache.set(hierarchyCacheKey(incoming, 'x'), ['a'])
  cache.set(hierarchyCacheKey(incoming, 'y'), ['b'])
  cache.set(hierarchyCacheKey(outgoing, 'x'), ['c'])
  assert.deepEqual(cache.get(hierarchyCacheKey(incoming, 'x')), ['a'])
  cache.invalidate(incoming + '\u0000')
  assert.equal(cache.get(hierarchyCacheKey(incoming, 'x')), undefined)
  assert.equal(cache.get(hierarchyCacheKey(incoming, 'y')), undefined)
  assert.deepEqual(cache.get(hierarchyCacheKey(outgoing, 'x')), ['c'], '另一个方向保留')
  assert.equal(cache.size(), 1)
})

test('有上限：超出后丢最早写入的，重写同一个键会把它挪到队尾', () => {
  const cache = createHierarchyCache(2)
  cache.set('a', 1)
  cache.set('b', 2)
  cache.set('a', 3)   // 重写：a 变成最近写入
  cache.set('c', 4)   // 淘汰 b
  assert.equal(cache.size(), 2)
  assert.equal(cache.get('b'), undefined)
  assert.equal(cache.get('a'), 3)
  assert.equal(cache.get('c'), 4)
  assert.equal(HIERARCHY_CACHE_LIMIT, 256)
})

test('接线：视图走缓存、reset 清缓存、折叠展开不再必发请求', () => {
  const view = readFileSync('src/hierarchyView.ts', 'utf8')
  assert.ok(view.includes('const childrenCache = createHierarchyCache<LspHierarchyItem[]>(HIERARCHY_CACHE_LIMIT)'), '视图没有建缓存')
  assert.ok(view.includes('const cached = childrenCache.get(cacheKey(item))'), 'hierarchyChildren 没有先查缓存')
  assert.ok(view.includes('if (cached) return cached'), '命中缓存没有直接返回')
  assert.ok(view.includes('childrenCache.set(cacheKey(item), items)'), '取回后没有写入缓存')
  assert.ok(view.includes('childrenCache.clear()'), 'resetHierarchy 没有清缓存（换根/换方向会读到旧数据）')
})
