// 随处搜索的**会话级搜索历史**判据（上游 `SearchHistoryList` + `HistoryIterator`）。
//
// 本仓落点：`src/searchEverywhereHistory.ts`（纯规则 + 持久化），消费点
// `src/searchEverywhereHost.ts`（`rememberSearchText` 在关弹层时记一笔、`searchHistoryStep`
// 给 Alt+Up/Down、`openSearchHistoryText` 打开时预填）。
//
// 上游坐标（本机参考树，逐行核过）：
//   · `SearchHistoryList.kt:8` HISTORY_LIMIT = 50；`:9-33` 表结构 / saveText 的去重+追加+按 tab 截；
//   · `:35-53` getHistoryForContributor / filteredHistory（All 档拿全部、最后 distinct）；
//   · `HistoryIterator.kt:10-42` index 从 -1、prev 先减再取（回绕尾）、next 先加再取（回绕头）；
//   · `SearchEverywhereManagerImpl.java:128` 打开时 prev()；`:423-427` 两个快捷键；`:439-448` saveSearchText。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  ALL_CONTRIBUTORS_TAB,
  SEARCH_HISTORY_LIMIT,
  SEARCH_EVERYWHERE_HISTORY_KEY,
  historyNext,
  historyOpenText,
  historyPrev,
  parseSearchHistory,
  saveSearchHistory,
  searchHistoryFor,
  serializeSearchHistory,
} from '../src/searchEverywhereHistory.ts'

const read = path => readFileSync(path, 'utf8')
const item = (text, tab = 'all') => ({ text, tab })

test('HISTORY_LIMIT 与持久化键（SearchHistoryList.kt:8 / 本仓 localStorage 键）', () => {
  assert.equal(SEARCH_HISTORY_LIMIT, 50)
  assert.equal(SEARCH_EVERYWHERE_HISTORY_KEY, 'taocode.searchEverywhereHistory')
})

test('saveText：空串不入表、同 (词, tab) 去重、最新在尾（:21-33 / :446）', () => {
  let h = []
  h = saveSearchHistory(h, '', 'all')
  assert.deepEqual(h, [], '空串不记')
  h = saveSearchHistory(h, '  ', 'all')
  assert.deepEqual(h, [], '纯空白也不记')
  h = saveSearchHistory(h, 'foo', 'all')
  h = saveSearchHistory(h, 'bar', 'all')
  assert.deepEqual(h.map(e => e.text), ['foo', 'bar'], '最新在尾')
  h = saveSearchHistory(h, 'foo', 'all')
  assert.deepEqual(h.map(e => e.text), ['bar', 'foo'], '同词去重后移到尾（不是留两条）')
  // 同一个词在不同 tab 各记一笔（:11 的 HistoryItem 带 contributorID）
  h = saveSearchHistory(h, 'foo', 'files')
  assert.deepEqual(h.map(e => [e.text, e.tab]), [['bar', 'all'], ['foo', 'all'], ['foo', 'files']])
})

test('saveText：按 tab 截到 50，丢最旧的（:29-32）', () => {
  let h = []
  for (let i = 0; i < SEARCH_HISTORY_LIMIT + 5; i++) h = saveSearchHistory(h, `q${i}`, 'all')
  const own = h.filter(e => e.tab === 'all')
  assert.equal(own.length, SEARCH_HISTORY_LIMIT, '本档截到 50')
  assert.equal(own[0].text, 'q5', '丢掉的是最旧的 5 条')
  assert.equal(own[own.length - 1].text, `q${SEARCH_HISTORY_LIMIT + 4}`, '最新的还在尾')
})

test('getHistoryForContributor：本档只看自己，All 档看全部最后 50 条（:35-53）', () => {
  const h = [item('a', 'files'), item('b', 'symbols'), item('c', 'files')]
  assert.deepEqual(searchHistoryFor(h, 'files'), ['a', 'c'], '本档只有自己那些')
  assert.deepEqual(searchHistoryFor(h, 'symbols'), ['b'])
  assert.deepEqual(searchHistoryFor(h, ALL_CONTRIBUTORS_TAB), ['a', 'b', 'c'], 'All 档跨 tab 全收')
  // distinct（:50）：All 档同一个词来自多个 tab 只留一条
  const dup = [item('x', 'files'), item('x', 'symbols'), item('y', 'all')]
  assert.deepEqual(searchHistoryFor(dup, ALL_CONTRIBUTORS_TAB), ['x', 'y'])
})

test('HistoryIterator：index 从 -1 起，prev 先减再取（回绕尾）、next 先加再取（回绕头）（HistoryIterator.kt:10-42）', () => {
  const list = ['old', 'mid', 'new']
  // 打开时 prev() 给最近一条（SearchEverywhereManagerImpl.java:128）
  const p1 = historyPrev(list, -1)
  assert.deepEqual(p1, { index: 2, text: 'new' }, 'prev 从 -1 回绕到尾部 = 最近一条')
  const p2 = historyPrev(list, 2)
  assert.deepEqual(p2, { index: 1, text: 'mid' }, '再 prev 往前')
  const p0 = historyPrev(list, 0)
  assert.deepEqual(p0, { index: 2, text: 'new' }, 'prev 越过头部回绕到尾部')
  // next() 先加再取
  assert.deepEqual(historyNext(list, -1), { index: 0, text: 'old' }, 'next 从 -1 走到 0')
  assert.deepEqual(historyNext(list, 2), { index: 0, text: 'old' }, 'next 越过尾部回绕到头部')
  // 空表给空串（:23-25 / :33-35），游标不动
  assert.deepEqual(historyPrev([], 5), { index: 5, text: '' })
  assert.deepEqual(historyNext([], 5), { index: 5, text: '' })
})

test('historyOpenText：打开时预填最近一条（:128）', () => {
  assert.equal(historyOpenText([], 'all'), '')
  assert.equal(historyOpenText([item('a', 'all'), item('b', 'all')], 'all'), 'b')
  assert.equal(historyOpenText([item('a', 'files'), item('b', 'symbols')], 'files'), 'a', '按 tab 分家')
})

test('parseSearchHistory：坏 JSON / 非数组 / 坏条目一律丢弃（本仓防御口径）', () => {
  assert.deepEqual(parseSearchHistory(null), [])
  assert.deepEqual(parseSearchHistory('not json'), [])
  assert.deepEqual(parseSearchHistory('{"a":1}'), [])
  assert.deepEqual(parseSearchHistory('[{"text":"ok","tab":"all"}]'), [{ text: 'ok', tab: 'all' }])
  // 缺字段 / 类型不对 / 空白词都丢
  assert.deepEqual(parseSearchHistory('[{"text":"a"},{"tab":"all"},{"text":"  ","tab":"all"},{"text":"b","tab":"all"}]'),
    [{ text: 'b', tab: 'all' }])
})

test('序列化往返，且截到 50（存档自洽）', () => {
  const h = [item('a', 'all'), item('b', 'files')]
  assert.deepEqual(parseSearchHistory(serializeSearchHistory(h)), h)
  const big = Array.from({ length: 60 }, (_, i) => item(`q${i}`, 'all'))
  const back = parseSearchHistory(serializeSearchHistory(big))
  assert.equal(back.length, SEARCH_HISTORY_LIMIT, '读回来截到 50')
  assert.equal(back[back.length - 1].text, 'q59', '留的是最后 50 条')
})

// ── 接线（宿主那一侧）────────────────────────────────────────────────────────────────
// 这一组钉的是"记录时机"与"两个入口都接上了"：UI 键盘分支归 UI 审查 lane（组件独占），
// 所以这里只断宿主模块自己的调用点存在且语义正确。
test('宿主在关弹层时记一笔，且暴露 Alt+Up/Down 两个入口（接线）', () => {
  const host = read('src/searchEverywhereHost.ts')
  assert.match(host, /rememberSearchText\(lastNonEmptyQuery\)/, '关弹层时记一笔')
  assert.match(host, /function searchHistoryStep\(next: boolean\)/, 'Alt+Up/Down 的取词入口')
  assert.match(host, /function openSearchHistoryText\(\)/, '打开时预填最近一条')
  assert.match(host, /searchHistoryStep,\n\s+openSearchHistoryText,/, '两个入口从宿主导出')
  assert.match(host, /saveSearchHistory\(searchHistory\.value, text, activeTab\.value \|\| ALL_CONTRIBUTORS_TAB\)/,
    '记的是当前 tab')
})

test('判据引用的上游文件行号没有漂（本仓可复核）', () => {
  const mod = read('src/searchEverywhereHistory.ts')
  for (const cited of ['SearchHistoryList.kt:8', '`:21-33`', '`:35-44`',
    '`:46-53`', 'HistoryIterator.kt:10-42', 'SearchEverywhereManagerImpl.java:128', '`:138-141`', '`:439-448`', '`:465-472`',
    'SearchTextField.java:64-67']) {
    assert.ok(mod.includes(cited), `上游引用在注释里找不到了：${cited}`)
  }
})