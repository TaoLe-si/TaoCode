// `pv/history` 的**标签位**判据（`PutLabelAction` / `putUserLabel` / `PutLabelChange` / `Label`）。
// 上游坐标写在 src/historyLabels.ts 的模块头；本文件只核行为形状与真实消费链路。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  HISTORY_LABEL_MAX, HISTORY_LABELS_STORAGE_KEY, labelEntry, labelRowText, loadLabels,
  normalizeLabelName, putLabel, removeLabel,
} from '../src/historyLabels.ts'

/** 一个最小的 Storage 替身（本模块只用到 getItem/setItem）。 */
function fakeStorage() {
  const map = new Map()
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    raw: map,
  }
}

const entry = (id, millis) => ({ id, reason: 'save', bytes: 1, timeMillis: millis, time: id })

test('空名/全空白按上游 NonEmptyInputValidator 拒绝，名字 trim 并截到上限', () => {
  assert.equal(normalizeLabelName(''), null)
  assert.equal(normalizeLabelName('   '), null)
  assert.equal(normalizeLabelName('  发布前  '), '发布前')
  const long = 'x'.repeat(HISTORY_LABEL_MAX + 40)
  assert.equal(normalizeLabelName(long).length, HISTORY_LABEL_MAX)
  // 消费链路：putLabel 自己再挡一次，坏名不落盘。
  const store = fakeStorage()
  assert.equal(putLabel('C:/p', '   ', 100, 'a.ts', store), null)
  assert.equal(store.raw.size, 0, '坏名不该写盘')
})

test('标签按项目根分桶（Label.affectsProject），不同项目互不可见', () => {
  const store = fakeStorage()
  putLabel('C:/one', '里程碑', 1000, 'a.ts', store)
  putLabel('C:/two', '另一个', 2000, 'b.ts', store)
  assert.deepEqual(loadLabels('C:/one', store).map(label => label.name), ['里程碑'])
  assert.deepEqual(loadLabels('C:/two', store).map(label => label.name), ['另一个'])
  assert.deepEqual(loadLabels('C:/missing', store), [], '没打过标签的项目给空表，不抛错')
})

test('同名标签顶替旧的（本仓口径：同名 = 更新到此刻），清单新→旧', () => {
  const store = fakeStorage()
  putLabel('C:/p', 'v1', 100, 'a.ts', store)
  putLabel('C:/p', 'v2', 300, 'a.ts', store)
  const after = putLabel('C:/p', 'v1', 500, 'a.ts', store)
  assert.equal(after.length, 2, '同名顶替，不是各记一条')
  assert.deepEqual(after.map(label => label.name), ['v1', 'v2'], '按时间新→旧')
  assert.equal(after.find(label => label.name === 'v1').timeMillis, 500, '同名那条的时间被更新')
})

test('删除标签只动指定项目；空名清单返回空', () => {
  const store = fakeStorage()
  putLabel('C:/p', 'keep', 1, 'a.ts', store)
  putLabel('C:/p', 'drop', 2, 'a.ts', store)
  putLabel('C:/q', 'drop', 3, 'b.ts', store)
  const left = removeLabel('C:/p', 'drop', store)
  assert.deepEqual(left.map(label => label.name), ['keep'])
  assert.deepEqual(loadLabels('C:/q', store).map(label => label.name), ['drop'], '别的项目的同名标签不受影响')
})

test('损坏/异形存储被读成空表，不抛错', () => {
  const store = fakeStorage()
  store.setItem(HISTORY_LABELS_STORAGE_KEY, '{ not json')
  assert.deepEqual(loadLabels('C:/p', store), [])
  store.setItem(HISTORY_LABELS_STORAGE_KEY, JSON.stringify({ 'C:/p': [null, 3, { name: 'ok', timeMillis: 5, path: 'x' }, { name: 'bad' }] }))
  assert.deepEqual(loadLabels('C:/p', store).map(label => label.name), ['ok'], '只留字段齐全的条目')
})

test('标签落到时间线：该时刻（含）之前最后一条快照，比最早的还早则 null', () => {
  const entries = [entry('c', 3000), entry('b', 2000), entry('a', 1000)]  // 新→旧
  assert.equal(labelEntry(entries, { name: 't', timeMillis: 2500, path: '' }).id, 'b')
  assert.equal(labelEntry(entries, { name: 't', timeMillis: 1000, path: '' }).id, 'a', '边界含等号')
  assert.equal(labelEntry(entries, { name: 't', timeMillis: 999, path: '' }), null, '比最早的快照还早')
})

test('行文本带上时刻（同名顶替后能分辨）', () => {
  const text = labelRowText({ name: '发布前', timeMillis: new Date(2026, 9, 6, 8, 5, 3).getTime(), path: 'a.ts' })
  assert.match(text, /^发布前  ·  2026-10-06 08:05:03$/)
})

test('接线门禁：HistoryPanel 真的用了标签模块，且不自己拼存储键', () => {
  const panel = readFileSync('src/components/HistoryPanel.vue', 'utf8')
  assert.match(panel, /from '\.\.\/historyLabels'/, '面板 import 标签模块')
  assert.match(panel, /putLabel\(projectRoot\.value/, '放置走 putLabel')
  assert.match(panel, /removeLabel\(projectRoot\.value/, '删除走 removeLabel')
  assert.match(panel, /loadLabels\(projectRoot\.value\)/, '读取走 loadLabels')
  assert.match(panel, /restoreToLabel/, '有「恢复到此标签」的入口')
  assert.match(panel, /request<AppState>\('app\.state'\)/, '项目根来自 app.state 的 lastProject')
  assert.ok(!/taocode\.localHistoryLabels/.test(panel), '存储键只在 src/historyLabels.ts 里，组件不硬编码')
})