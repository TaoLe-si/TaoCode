// 「最近位置」的两条纯规则：写入侧 `putPlaceOnTop` 与读出侧 `recentPlacesList`（`src/appPlacesRing.ts`）。
//
// 上游依据（2026-10-06 nav3 逐条打开参考树自数核对，全部是相对参考树根的完整路径）：
//   · 写入 = `putLastOrMerge`：`platform/platform-impl/src/com/intellij/openapi/fileEditor/impl/IdeDocumentHistoryImpl.kt:655-674`
//     —— 只与 `list.getLast()` 比（`:660-665`），命中就 `removeLast()` 再 `add(next)`（`:668`，
//     换的是**整条新的 PlaceInfo**，标签不合并），超过上限 `removeFirst()`（`:670-673`）。
//   · 同一位置的判据 = `isSame`：同文件 + 同一导航态（`:738-745`）⇒ 本仓用「文件 + 行」。
//   · 两档的上限 = `BACK_QUEUE_LIMIT` / `CHANGE_QUEUE_LIMIT`（`:76-77`）
//     = 注册表 `editor.navigation.history.stack.size` 的默认值 150
//     （`platform/util/resources/misc/registry.properties:494`）。
//   · 读出 = `createPlaceLinePairs`：`platform/platform-impl/src/com/intellij/ide/actions/RecentLocationsDataModel.kt:83-104`
//     —— 上限 `UISettings.getInstance().recentLocationsLimit`（`:91`）= `UISettingsState.kt:57` 的默认值 25；
//     队列先 `ContainerUtil.reverse`（`:92`）再走一遍，`result.none { isSame(...) }` 才收（`:95`），
//     攒够上限就 `break`（`:98-100`）。
//   · 弹层上的查询词作用在**已经建好的模型之外**（`ListWithFilter.wrap`，
//     `platform/platform-impl/src/com/intellij/ide/actions/RecentLocationsAction.java:146`）
//     ⇒ 25 条的上限在过滤之前就已经生效。
//
// 顺序口径：上游的环是「最旧在前」，读出时 reverse；本仓的环一直是「最新在前」
// ⇒ 这里写入侧并表头、截断摘表尾，与上游镜像，用户可见顺序一致。
// 本文件一律纯 JavaScript（规约 §4.2），值 import 一律带全扩展名（规约 §4.1）。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PLACES_RING_LIMIT, RECENT_PLACES_LIMIT, isSamePlace, putPlaceOnTop, recentPlacesList,
} from '../src/appPlacesRing.ts'

const at = (path, line, label = `${path}:${line}`) => ({ kind: '文件', path, line, label })

test('上限两档各取上游默认值：环 150、弹层 25', () => {
  assert.equal(PLACES_RING_LIMIT, 150, 'editor.navigation.history.stack.size 的默认值')
  assert.equal(RECENT_PLACES_LIMIT, 25, 'UISettings.recentLocationsLimit 的默认值')
})

test('isSame 只看文件 + 行，标签（书签名/符号名）不参与判定', () => {
  assert.equal(isSamePlace(at('a/x.ts', 10, '方法 foo'), at('a/x.ts', 10, 'a/x.ts:10')), true, '同文件同行 = 同一位置')
  assert.equal(isSamePlace(at('a/x.ts', 10), at('a/x.ts', 11)), false, '差一行就是另一个位置')
  assert.equal(isSamePlace(at('a/x.ts', 10), at('a/y.ts', 10)), false, '同编号不同文件不是同一位置')
})

test('写入侧只并表头那一条：命中就整条替换，不合并标签', () => {
  const ring = [at('a/x.ts', 30, '旧表头'), at('a/x.ts', 10, '更旧')]
  const merged = putPlaceOnTop(ring, at('a/x.ts', 30, '新表头'))
  assert.deepEqual(merged.map(item => [item.line, item.label]), [[30, '新表头'], [10, '更旧']],
    '表头那条被整条换成新的（上游 add(next) 换的就是新的 PlaceInfo）')
  const deep = putPlaceOnTop(ring, at('a/x.ts', 10, '又是它'))
  assert.deepEqual(deep.map(item => item.line), [10, 30, 10], '非表头的同位置不摘：环里留两条，读出去重')
})

test('写入侧超上限从表尾摘，最新在前', () => {
  let ring = []
  for (let line = 1; line <= PLACES_RING_LIMIT + 5; line++) ring = putPlaceOnTop(ring, at('b/y.ts', line))
  assert.equal(ring.length, PLACES_RING_LIMIT, '截到 150')
  assert.equal(ring[0].line, PLACES_RING_LIMIT + 5, '最新在前')
  assert.equal(ring[ring.length - 1].line, 6, '155 次写入截到 150 ⇒ 最旧的 5 条（第 1…5 次）被摘掉，表尾是第 6 次')
})

test('读出侧：全局去重 + 攒够 25 条就停（createPlaceLinePairs 的两步）', () => {
  const ring = []
  for (let line = 1; line <= RECENT_PLACES_LIMIT + 10; line++) ring.unshift(at('c/z.ts', line))
  const listed = recentPlacesList(ring)
  assert.equal(listed.length, RECENT_PLACES_LIMIT, '够 25 条就 break（:98-100）')
  assert.deepEqual(listed.map(item => item.line).slice(0, 3), [35, 34, 33], '最新在前连续三条')
  const dupes = [at('d/a.ts', 5), at('d/b.ts', 7), at('d/a.ts', 5), at('d/c.ts', 9), at('d/b.ts', 7)]
  assert.deepEqual(recentPlacesList(dupes).map(item => item.path), ['d/a.ts', 'd/b.ts', 'd/c.ts'],
    '与已列出的任一条同位置就跳过（:95 的 result.none）')
  assert.deepEqual(recentPlacesList(dupes, 2).map(item => item.path), ['d/a.ts', 'd/b.ts'],
    '上限可以传入（查询词之外不再有第二层截断，25 条就是屏上全部）')
  assert.deepEqual(recentPlacesList([]), [], '空环给空表，不猜位置')
})
