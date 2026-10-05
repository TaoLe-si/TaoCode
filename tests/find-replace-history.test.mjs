// 编辑器查找栏的替换历史（上游 `SearchTextArea.ShowHistoryAction`，
// `platform/lang-impl/src/com/intellij/find/SearchTextArea.java:396-421`）。
//
// 判据逐条对上游：
//   · 标题按输入框模式取 `find.replace.history`（中文包 =「替换历史记录」，FindBundle.properties:77）；
//   · 读的是 `getRecentReplaceStrings()`（`:412-413`）—— 与查找历史各管一张表；
//   · 表语义是 `FindInProjectSettingsBase.addRecentStringToList`（`:95-105`）：先删后追、上限丢最旧；
//   · 本仓的本地形态（`taocode.findReplaceHistory`、上限 20）与编辑器查找历史同规格。
// 最后两条查接线：替换/全部替换要记、替换框的 Alt+Down 与 Esc 要认这张表。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parseReplaceHistory, pushReplaceHistory, readReplaceHistory, REPLACE_HISTORY_KEY, REPLACE_HISTORY_LIMIT, writeReplaceHistory,
} from '../src/findReplaceHistory.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('the storage key and the ceiling follow the bar history', () => {
  assert.equal(REPLACE_HISTORY_KEY, 'taocode.findReplaceHistory')
  // 编辑器栏的查找历史是 HISTORY_LIMIT = 20（src/editorFindController.ts），替换历史同规格。
  assert.equal(REPLACE_HISTORY_LIMIT, 20)
})

test('a replacement is remembered newest-first, duplicates move up', () => {
  assert.deepEqual(pushReplaceHistory([], 'foo'), ['foo'])
  // `addRecentStringToList`：先 remove 再 add —— 重复值只留一条，且跑到最新那一头。
  assert.deepEqual(pushReplaceHistory(['a', 'b'], 'a'), ['a', 'b'])
  assert.deepEqual(pushReplaceHistory(['b', 'a'], 'a'), ['a', 'b'])
  assert.deepEqual(pushReplaceHistory(['a', 'b'], 'c'), ['c', 'a', 'b'])
})

test('an empty replacement is not recorded', () => {
  // 空串不入表（替换成"删除"是合法操作，但历史里不塞空行）。
  assert.deepEqual(pushReplaceHistory(['a'], ''), ['a'])
})

test('the ceiling drops the oldest entry, not the newest', () => {
  let list = []
  for (let i = 0; i < REPLACE_HISTORY_LIMIT + 3; i++) list = pushReplaceHistory(list, `r${i}`)
  assert.equal(list.length, REPLACE_HISTORY_LIMIT)
  assert.equal(list[0], `r${REPLACE_HISTORY_LIMIT + 2}`, '最新在第一位')
  assert.equal(list.includes('r0'), false, '最旧的被丢掉')
})

test('a corrupt or hostile archive reads back as a clean list', () => {
  assert.deepEqual(parseReplaceHistory(null), [])
  assert.deepEqual(parseReplaceHistory('not json'), [])
  assert.deepEqual(parseReplaceHistory('{"finds":[]}'), [], '不是数组就不猜')
  assert.deepEqual(parseReplaceHistory('["a",1,"",null,"a","b"]'), ['a', 'b'], '非串/空串/重复都丢掉')
  const long = JSON.stringify(Array.from({ length: 40 }, (_, i) => `x${i}`))
  assert.equal(parseReplaceHistory(long).length, REPLACE_HISTORY_LIMIT, '读回时也截到上限')
})

test('read and write round-trip through localStorage', () => {
  const store = new Map()
  const original = globalThis.localStorage
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  }
  try {
    assert.deepEqual(readReplaceHistory(), [])
    writeReplaceHistory(pushReplaceHistory([], 'beta'))
    assert.deepEqual(readReplaceHistory(), ['beta'])
    assert.equal(store.get(REPLACE_HISTORY_KEY), '["beta"]')
    // 坏存档不抛，按空表。
    store.set(REPLACE_HISTORY_KEY, '{{{')
    assert.deepEqual(readReplaceHistory(), [])
  } finally {
    if (original === undefined) delete globalThis.localStorage
    else globalThis.localStorage = original
  }
})

test('without a window the history is session-only, not a crash', () => {
  const original = globalThis.localStorage
  delete globalThis.localStorage
  try {
    assert.deepEqual(readReplaceHistory(), [])
    writeReplaceHistory(['anything']) // 不抛
  } finally {
    if (original !== undefined) globalThis.localStorage = original
  }
})

// —— 接线 ——

test('the replace row owns a history dropdown labelled like the upstream bundle', () => {
  const bar = read('src/components/EditorFindBar.vue')
  assert.match(bar, /import \{ pushReplaceHistory, readReplaceHistory, writeReplaceHistory \} from '\.\.\/findReplaceHistory'/)
  assert.match(bar, /title="替换历史记录"[\s\S]{0,200}aria-label="替换历史记录"/, '按钮提示 = FindBundle.properties:77')
  assert.match(bar, /role="listbox" aria-label="替换历史记录"/, '下拉本身的标签也要有')
  assert.match(bar, /v-for="row in replaceHistory"/)
})

test('replacing records the replacement (Enter and both buttons)', () => {
  const bar = read('src/components/EditorFindBar.vue')
  assert.match(bar, /if \(event\.key === 'Enter'\) \{ event\.preventDefault\(\); recordReplace\(\); emit\('replaceOne'\); return \}/)
  assert.match(bar, /@click="recordReplace\(\); emit\('replaceOne'\)"/)
  assert.match(bar, /@click="recordReplace\(\); emit\('replaceAll'\)"/)
  assert.match(bar, /const next = pushReplaceHistory\(replaceHistory\.value, props\.replaceText\)/, '记的是当前替换框里的词')
  assert.match(bar, /writeReplaceHistory\(next\)/, '记完要落盘')
})

test('Alt+Down in the replace field opens the replace table, not the find one', () => {
  const bar = read('src/components/EditorFindBar.vue')
  assert.match(bar, /if \(event\.key === 'ArrowDown' && event\.altKey\) \{ event\.preventDefault\(\); openReplaceHistory\(\); return \}/)
  // 开下拉前重读存档：同一次会话里另一条查找栏（分栏编辑）记的词也要看得见。
  assert.match(bar, /function openReplaceHistory\(\) \{\n  replaceHistory\.value = readReplaceHistory\(\)\n  historyOpen\.value = false\n  replaceHistoryOpen\.value = true\n\}/)
  assert.match(bar, /@click="toggleReplaceHistory\(\)"/)
  // Esc 先收替换历史，再收查找历史，最后才关栏（上游 EscapeHandler 的两段式在这里多一层）。
  assert.match(bar, /if \(replaceHistoryOpen\.value\) replaceHistoryOpen\.value = false\n    else if \(historyOpen\.value\) historyOpen\.value = false\n    else emit\('close'\)/)
})
