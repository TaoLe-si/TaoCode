// 工程内查找的最近搜索（上游 `FindInProjectSettingsBase`，`FindInProjectSettingsBase.java:26-93`）。
//
// 判据逐条对上游：上限 300、`addRecentStringToList` 的先删后追（最新在末尾）、
// `getMostRecentFindString` 取末尾、加载时用 LinkedHashSet 去重；再加一条接线检查
// （SearchPanel 要在执行查找/替换时记录、打开时预填）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  addRecent, EMPTY_RECENTS, formatRecents, MAX_RECENT_SIZE, mostRecent, parseRecents, RECENTS_STORAGE_KEY,
} from '../src/findInProjectRecents.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('the recent list constants match the upstream ones', () => {
  // FindInProjectSettingsBase.java:27 MAX_RECENT_SIZE = 300.
  assert.equal(MAX_RECENT_SIZE, 300)
  assert.equal(RECENTS_STORAGE_KEY, 'taocode.findInProjectRecents')
  assert.deepEqual(EMPTY_RECENTS, { finds: [], replaces: [] })
})

test('addRecentStringToList removes the duplicate and appends at the end', () => {
  // :85-93 — remove(str) then add(str); most recent is the last element (:77-79).
  assert.deepEqual(addRecent([], 'alpha'), ['alpha'])
  assert.deepEqual(addRecent(['a', 'b'], 'c'), ['a', 'b', 'c'])
  // 精确匹配、只删第一条（`List.remove(Object)` 的语义；重复项在加载时已被去重）。
  assert.deepEqual(addRecent(['a', 'b', 'a'], 'a'), ['b', 'a', 'a'])
  assert.deepEqual(addRecent(['a', 'b'], 'a'), ['b', 'a'])
  assert.equal(mostRecent(['b', 'a']), 'a')
  assert.equal(mostRecent([]), '')
})

test('an empty string adds nothing', () => {
  assert.deepEqual(addRecent(['a'], ''), ['a'])
})

test('the 300-entry ceiling drops the oldest, not the newest', () => {
  let list = []
  for (let i = 0; i < 302; i++) list = addRecent(list, `q${i}`)
  assert.equal(list.length, MAX_RECENT_SIZE)
  assert.equal(list[0], 'q2', '最旧的两条被丢掉')
  assert.equal(mostRecent(list), 'q301', '最新一条还在末尾')
})

test('parseRecents dedupes like initializeComponent and caps the list', () => {
  assert.deepEqual(parseRecents(null), { finds: [], replaces: [] })
  assert.deepEqual(parseRecents('not json'), { finds: [], replaces: [] })
  assert.deepEqual(parseRecents('{"finds":["a","b","a"],"replaces":["x"]}'), { finds: ['a', 'b'], replaces: ['x'] })
  assert.deepEqual(parseRecents('{"finds":["a",1,null,"b"],"replaces":"x"}'), { finds: ['a', 'b'], replaces: [] })
  const many = JSON.stringify({ finds: Array.from({ length: 305 }, (_, i) => `q${i}`), replaces: [] })
  const parsed = parseRecents(many)
  assert.equal(parsed.finds.length, MAX_RECENT_SIZE)
  assert.equal(mostRecent(parsed.finds), 'q304')
  assert.deepEqual(parseRecents(formatRecents({ finds: ['缩进', '主题'], replaces: ['X'] })), { finds: ['缩进', '主题'], replaces: ['X'] })
})

test('SearchPanel records and prefills through the shared table', () => {
  const panel = read('src/components/SearchPanel.vue')
  assert.match(panel, /parseRecents\(localStorage\.getItem\(RECENTS_STORAGE_KEY\)\)/, '打开时读回同一份')
  assert.match(panel, /rememberRecent\('find', query\.value\)/, '执行查找要记 find 表')
  assert.match(panel, /rememberRecent\('replace', replacement\.value\)/, '执行替换要记 replace 表')
  assert.match(panel, /mostRecent\(recents\.finds\)/, 'FindPopupPanel.java:1237：没有查询词时预填最近一条')
  assert.match(panel, /Alt\+Down|event\.altKey/, 'Alt+Down 打开历史（SearchTextArea 的历史动作）')
  assert.match(panel, /addRecent\(recents\[key\], text\)/, '追加要走上游那套先删后追')
})
