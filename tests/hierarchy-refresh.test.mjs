// `ls/hierarchy` 的刷新语义与节点过滤判据（`src/hierarchyView.ts` + `src/hierarchyCache.ts`）。
//
// 上游依据：
//   · `HierarchyBrowserBaseEx.doRefresh`（platform/lang-impl/.../HierarchyBrowserBaseEx.java:615）：
//     刷新 = 丢掉 sheet（缓存）后重建 —— `RefreshAction.actionPerformed` 走 `doRefresh(false)`
//     （全部视图类型都丢），`changeView` 走 `doRefresh(true)`（只丢当前视图类型的 sheet）；
//   · `LspAbstractHierarchyTreeStructure.createNodeDescriptorForItem` 的 `mapNotNull`：
//     uri 解析不出文件（`getVirtualFileForItem` 回 null）的项不建节点，不画点不动的假行。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHierarchyCache, hierarchyCacheKey, hierarchyShape } from '../src/hierarchyCache.ts'

const view = () => readFileSync('src/hierarchyView.ts', 'utf8')

test('刷新按钮真的重查：刷新入口先作废缓存再重建（上游 doRefresh 的丢 sheet）', () => {
  const source = view()
  assert.ok(source.includes("async function loadHierarchy()"), 'loadHierarchy 入口不在了')
  assert.ok(source.includes("return reloadHierarchy('all')"), '刷新入口没有走整表作废（刷新按钮会命中旧结果）')
  assert.ok(source.includes("async function reloadHierarchy(scope: 'all' | 'shape')"), 'loadHierarchy 没有刷新范围参数')
  assert.ok(source.includes("if (scope === 'all') childrenCache.clear()"), '整表刷新没有清缓存（刷新按钮会命中旧结果）')
  assert.ok(source.includes("childrenCache.invalidate(hierarchyShape(hierKind.value, hierDirection.value) + '\\u0000')"),
    '换方向只该作废当前形状的条目（上游 doRefresh(true) 只丢当前视图类型）')
  assert.ok(source.includes("void reloadHierarchy('shape')"), 'pickHierarchyDirection 没有按形状作废')
  // App 的刷新按钮与「换方向」都走这里。
  const app = readFileSync('src/App.vue', 'utf8')
  assert.ok(app.includes('@click="loadHierarchy"'), '刷新按钮没有接到 loadHierarchy')
})

test('按形状作废：同形状条目清掉、另一方向保留（与上游 per-view-type sheet 同口径）', () => {
  const cache = createHierarchyCache()
  const incoming = hierarchyShape('call', 'incoming')
  const outgoing = hierarchyShape('call', 'outgoing')
  cache.set(hierarchyCacheKey(incoming, 'node'), ['a'])
  cache.set(hierarchyCacheKey(outgoing, 'node'), ['b'])
  cache.invalidate(`${incoming}\u0000`)
  assert.equal(cache.get(hierarchyCacheKey(incoming, 'node')), undefined)
  assert.deepEqual(cache.get(hierarchyCacheKey(outgoing, 'node')), ['b'], '换方向不该把另一方向的结果也丢掉')
})

test('节点过滤：解析不出文件的项不建节点（上游 mapNotNull）', () => {
  const source = view()
  assert.ok(source.includes('items.filter(item => !!item.path)'), '没有过滤空 path 的层级项')
  assert.ok(source.includes("recursive: ancestors.includes(hierarchyKey(item))"), '递归关系标记被过滤逻辑带掉了')
})

test('调用点跳转仍按 selectionRange 起点（LspHierarchyNodeDescriptor.navigate 口径）', () => {
  const source = view()
  assert.ok(source.includes("const path = hierDirection.value === 'outgoing' ? node.parentPath : node.item.path"), '调用点目标改了')
  assert.ok(source.includes('line: node.item.callLine ?? node.item.line ?? 0'), '调用点坐标口径改了')
})
