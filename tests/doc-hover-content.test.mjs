// 文档的**取用面**（`src/docHoverContent.ts` + `src/hoverDocumentation.ts` 的区间命中缓存）。
//
// 上游三处判据，逐条对着钉：
//   · `platform/lsp-impl/src/impl/features/documentation/HoverResultCache.kt:11-12`
//     `matches = { _, storedValue, queriedOffset -> storedValue.textRange.contains(queriedOffset) }`
//     —— 命中看**上次 hover 的区间是否包含这一次的位置**，不是看位置字符串相不相等；
//   · `platform/lsp-impl/src/impl/cache/LspPerFileCache.kt:71-73` 命中后 `s.key = key`
//     —— 槽位的键重锚到最后一次查询的位置；
//   · `platform/lsp-impl/src/impl/features/documentation/TextRangeAndMarkupContent.kt:14-24`
//     服务器没给 range ⇒ 零长区间（只剩「同位置」这一档）；内容整段空白 ⇒ 当没有文档（不缓存）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createHoverCache, docHoverRangeContains, hoverPositionKey, parseHoverPositionKey,
} from '../src/hoverDocumentation.ts'
import {
  createDocHoverContent, hoverDocStampOf, hoverRangeFromPayload, hoverTooltipText, isBlankDoc,
  presentationFromRange, registerSharedDocHover, sharedDocHover,
} from '../src/docHoverContent.ts'
import { docHoverPolicy, toggleDocHoverPolicy } from '../src/docHoverPolicy.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const RANGE = { startLine: 1, startCharacter: 4, endLine: 1, endCharacter: 9 }

test('区间命中：上游 HoverResultCache 的 contains 口径（左闭右开）', () => {
  assert.equal(docHoverRangeContains(RANGE, 1, 4), true, '起点含进来')
  assert.equal(docHoverRangeContains(RANGE, 1, 8), true, '终点前一格')
  assert.equal(docHoverRangeContains(RANGE, 1, 9), false, '终点本身不含（TextRange 是尾开区间）')
  assert.equal(docHoverRangeContains(RANGE, 1, 3), false)
  assert.equal(docHoverRangeContains(RANGE, 0, 6), false, '行不同')
  const across = { startLine: 2, startCharacter: 10, endLine: 3, endCharacter: 4 }
  assert.equal(docHoverRangeContains(across, 2, 11), true)
  assert.equal(docHoverRangeContains(across, 3, 0), true)
  assert.equal(docHoverRangeContains(across, 3, 4), false)
  assert.deepEqual(parseHoverPositionKey('7:3'), { line: 7, character: 3 })
  assert.equal(parseHoverPositionKey('p1'), null, '不是位置键就不参与区间命中')
  assert.equal(hoverPositionKey(7, 3), '7:3')
})

test('缓存：带区间的条目在同符号内移动光标命中，并把键重锚到最后一次的位置', () => {
  const cache = createHoverCache()
  cache.put('a.ts', hoverPositionKey(1, 4), 'v1:clean', { contents: 'doc', range: RANGE })
  assert.equal(cache.get('a.ts', hoverPositionKey(1, 6), 'v1:clean').contents, 'doc', '同符号内移动不再往返服务器')
  assert.equal(cache.get('a.ts', hoverPositionKey(1, 6), 'v1:clean').contents, 'doc', '重锚后按新位置也命中')
  assert.equal(cache.size(), 1, '重锚不新增条目')
  assert.equal(cache.get('a.ts', hoverPositionKey(1, 20), 'v1:clean'), undefined, '区间外不命中')
  assert.equal(cache.get('a.ts', hoverPositionKey(1, 6), 'v2:clean'), undefined, '文档版本一变整文件失效')
})

test('缓存：没有区间时退化成「同位置才命中」（上游的零长区间回退）', () => {
  const cache = createHoverCache()
  cache.put('a.ts', hoverPositionKey(3, 7), 'v1:clean', { contents: 'doc' })
  assert.equal(cache.get('a.ts', hoverPositionKey(3, 7), 'v1:clean').contents, 'doc')
  assert.equal(cache.get('a.ts', hoverPositionKey(3, 8), 'v1:clean'), undefined)
})

test('服务器 range 的读法：残缺/零长/反向都不认（上游 length > 0 才算有区间）', () => {
  const ok = hoverRangeFromPayload({ available: true, range: { start: { line: 2, character: 3 }, end: { line: 2, character: 8 } } })
  assert.deepEqual(ok, { startLine: 2, startCharacter: 3, endLine: 2, endCharacter: 8 })
  assert.equal(hoverRangeFromPayload({ available: true }), null, '没有 range')
  assert.equal(hoverRangeFromPayload({ available: true, range: { start: { line: 2, character: 3 } } }), null, '只有起点')
  assert.equal(hoverRangeFromPayload({ available: true, range: { start: { line: 2, character: 5 }, end: { line: 2, character: 5 } } }), null, '零长')
  assert.equal(hoverRangeFromPayload({ available: true, range: { start: { line: 4, character: 0 }, end: { line: 2, character: 0 } } }), null, '反向')
})

test('presentableText：区间那段源码，跨行/越界就当取不到', () => {
  const line = 'int computeSum(int a)'
  assert.equal(presentationFromRange(line, { startLine: 0, startCharacter: 4, endLine: 0, endCharacter: 14 }), 'computeSum')
  assert.equal(presentationFromRange(line, { startLine: 0, startCharacter: 20, endLine: 0, endCharacter: 30 }), null, '终点越过文本末尾')
  assert.equal(presentationFromRange(line, { startLine: 0, startCharacter: 4, endLine: 1, endCharacter: 2 }), null, '跨行时调用方只给了一行文本')
  assert.equal(presentationFromRange(undefined, RANGE), null)
  assert.equal(presentationFromRange(line, null), null)
})

test('空白内容算「没有文档」，并且不缓存（上游 isNullOrBlank / isBlank 两条分支）', () => {
  assert.equal(isBlankDoc(''), true)
  assert.equal(isBlankDoc('   \n '), true, '整段是空白')
  assert.equal(isBlankDoc('有内容'), false)
  assert.equal(isBlankDoc(null), true)
})

test('取用面：同位置与区间内都只发一次请求，文档版本一变就重发', async () => {
  const cache = createHoverCache()
  let calls = 0
  const content = createDocHoverContent({
    cache,
    request: async () => {
      calls += 1
      return { available: true, contents: '```java\nclass A {}\n```\n类 A。', range: { start: { line: 1, character: 4 }, end: { line: 1, character: 11 } } }
    },
  })
  const first = await content.targetAt({ path: 'a.ts', line: 1, character: 4, stamp: 'v1:clean' })
  assert.equal(first.contents, '```java\nclass A {}\n```\n类 A。')
  assert.equal(first.presentation, null, '没给 lineText 时不猜显示名')
  assert.equal(calls, 1)
  await content.targetAt({ path: 'a.ts', line: 1, character: 4, stamp: 'v1:clean', lineText: 'int compute(int a)' })
  assert.equal(calls, 1, '同位置命中缓存')
  const moved = await content.targetAt({ path: 'a.ts', line: 1, character: 6, stamp: 'v1:clean', lineText: 'int compute(int a)' })
  assert.equal(calls, 1, '同符号内移动光标命中缓存（上游的 contains 匹配）')
  assert.equal(moved.presentation, 'compute', '命中后仍然按本次的行文本给 presentableText')
  await content.targetAt({ path: 'a.ts', line: 1, character: 30, stamp: 'v1:clean' })
  assert.equal(calls, 2, '区间外才重发')
  await content.targetAt({ path: 'a.ts', line: 1, character: 30, stamp: 'v2:clean' })
  assert.equal(calls, 3, '文档版本变化整文件失效')
})

test('取用面：不可用/空内容都不算文档，也不进缓存', async () => {
  const cache = createHoverCache()
  let calls = 0
  const content = createDocHoverContent({ cache, request: async () => { calls += 1; return calls === 1 ? { available: false } : { available: true, contents: '   ' } } })
  assert.equal(await content.targetAt({ path: 'a.ts', line: 0, character: 0, stamp: 'v' }), null)
  assert.equal(await content.targetAt({ path: 'a.ts', line: 0, character: 0, stamp: 'v' }), null)
  assert.equal(calls, 2, '两次都真的重发：空结果没有被缓存成「有文档」')
  assert.equal(cache.size(), 0)
})

test('hover 那一档闸：「在鼠标移动时显示」关掉就整个不弹，也不发请求', async () => {
  const cache = createHoverCache()
  let calls = 0
  const content = createDocHoverContent({
    cache,
    request: async () => { calls += 1; return { available: true, contents: '```java\nclass A {}\n```\n类 A。' } },
  })
  const position = { path: 'a.ts', line: 2, character: 0, stamp: 'v' }
  assert.equal(await content.tooltipText(position), 'class A {}\n\n类 A。', '默认开，围栏不显示')
  assert.equal(calls, 1)
  toggleDocHoverPolicy('showOnMouseMove')
  assert.equal(docHoverPolicy.showOnMouseMove, false)
  assert.equal(await content.tooltipText(position), null, '关掉后 hover 不给文档（EditorMouseHoverPopupManager.java:452）')
  assert.equal(calls, 1, '关掉后连请求都不发')
  assert.ok(await content.targetAt({ ...position, stamp: 'v9' }), 'Ctrl+Q 那条入口不受这一档影响')
  assert.equal(calls, 2, '受影响的只是 hover：文档照取')
  toggleDocHoverPolicy('showOnMouseMove')
  assert.equal(docHoverPolicy.showOnMouseMove, true, '恢复默认档')
})

test('tooltip 文本走的是签名/描述整形（与弹层同一份口径）', () => {
  assert.equal(hoverTooltipText('```ts\nconst a = 1\n```\n\n说明'), 'const a = 1\n\n说明')
  assert.equal(hoverTooltipText('就是文档'), '就是文档')
})

test('全仓只有一张 hover 缓存：宿主登记的那张就是 hover 用的那张', () => {
  const registered = createDocHoverContent({ cache: createHoverCache(), request: async () => ({ available: false }) })
  registerSharedDocHover(registered)
  assert.equal(sharedDocHover(), registered, '编辑器那条入口拿到的必须是同一个实例（两份缓存各记各的 = 漂移点）')
  assert.equal(sharedDocHover().cache, registered.cache)
})

test('hover 那条入口的缓存标记：同一份文本稳定、换了文本才变', () => {
  const firstDoc = { toString: () => 'doc-a' }
  const same = { toString: () => 'doc-a' }
  assert.equal(hoverDocStampOf(firstDoc), hoverDocStampOf(firstDoc), '同一个对象重复问不给新戳（否则每次 hover 都失效）')
  assert.notEqual(hoverDocStampOf(firstDoc), hoverDocStampOf(same), '对象换了就是换了文档')
  assert.notEqual(hoverDocStampOf(firstDoc), hoverDocStampOf({}), '与别的文档不撞戳')
  assert.equal(hoverDocStampOf(undefined), 'no-document', '拿不到文档时给一个不会与任何真文档相撞的戳')
})

test('接线：两个入口共用这一层，Ctrl+Q 不再自己发 hover', () => {
  const host = readFileSync(join(root, 'src/quickDocHost.ts'), 'utf8')
  const content = readFileSync(join(root, 'src/docHoverContent.ts'), 'utf8')
  assert.match(host, /hoverContent\.targetAt\(/, '快速文档宿主没有走共享的取用面')
  assert.match(host, /registerSharedDocHover\(/, '宿主没有把这张缓存登记成共享的')
  assert.doesNotMatch(host, /kind: 'hover'/, '宿主不该自己再发一次 hover（那样缓存就是两套）')
  assert.match(content, /shouldShowDocOnHover\(\)/, 'hover 那档闸没有被消费')
  // 上游出处必须写在文件里，判词才可复核（playbook §1：每条结论给相对路径 + 行号）。
  assert.match(content, /HoverResultCache\.kt:11-12/, '区间命中的上游出处没有登记')
  assert.match(content, /EditorMouseHoverPopupManager\.java:452/, 'hover 闸的上游出处没有登记')
})
