// 监视表达式跨会话持久化（`src/debugWatches.ts`）与面板接线。
//
// 上游：`XWatchesView` 由 `WatchesManager` 随项目状态保存（重启后表达式还在，值按当前帧重算）。
// 本仓落 localStorage，按**项目根**分键（与 src/externalProjectModel.ts 的任务激活表同族策略）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEBUG_WATCHES_LIMIT, loadWatches, parseWatches, saveWatches, serializeWatches, watchesStorageKey,
} from '../src/debugWatches.ts'

function fakeStore(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, value) },
    raw: map,
  }
}

test('存储键按项目根归一：反斜杠/尾斜杠统一，空根退回应用级', () => {
  assert.equal(watchesStorageKey('D:\\proj\\demo\\'), 'taocode.debugWatches:D:/proj/demo')
  assert.equal(watchesStorageKey('D:/proj/demo'), 'taocode.debugWatches:D:/proj/demo')
  assert.equal(watchesStorageKey('  '), 'taocode.debugWatches')
})

test('解析：坏数据退回空表，非字符串/空串/重复条目被丢掉，保序截断', () => {
  assert.deepEqual(parseWatches('not json'), [])
  assert.deepEqual(parseWatches('{"a":1}'), [])
  assert.deepEqual(parseWatches(JSON.stringify(['a', 1, '', ' b ', 'a', null, 'c'])), ['a', 'b', 'c'])
  const many = Array.from({ length: DEBUG_WATCHES_LIMIT + 10 }, (_, index) => `w${index}`)
  assert.equal(parseWatches(JSON.stringify(many)).length, DEBUG_WATCHES_LIMIT)
})

test('序列化先按同一套规则归一（写回的东西就是下次读到的）', () => {
  assert.deepEqual(parseWatches(serializeWatches([' a ', 'a', ''])), ['a'])
})

test('按项目根读写：两个项目各自一份；存储不可用不抛（只影响持久化）', () => {
  const store = fakeStore()
  saveWatches(store, 'D:/one', ['x', 'y'])
  saveWatches(store, 'D:/two', ['z'])
  assert.deepEqual(loadWatches(store, 'D:/one'), ['x', 'y'])
  assert.deepEqual(loadWatches(store, 'D:/two'), ['z'])
  assert.deepEqual(loadWatches(store, 'D:/three'), [])
  assert.deepEqual(loadWatches(null, 'D:/one'), [])
  assert.doesNotThrow(() => saveWatches({ getItem: () => { throw new Error('nope') }, setItem: () => { throw new Error('nope') } }, 'D:/one', ['x']))
})

test('面板接线：启动时载入、变化时写回，项目根从 ToolWindowView 传进来', () => {
  // 载入/写回在 2026-10-06 从 DebugPanel.vue 抽进 `src/debugWatchesStore.ts`
  // （面板贴着 900 行上限，本批补四个监视动作时必须拆出去），规则不变。
  const store = readFileSync('src/debugWatchesStore.ts', 'utf8')
  assert.match(store, /loadWatches\(deps\.storage, deps\.root\(\)\)/)
  assert.match(store, /saveWatches\(deps\.storage, deps\.root\(\)/)
  assert.match(store, /watch\(watches, list => saveWatches/, '变化时写回')
  const panel = readFileSync('src/components/DebugPanel.vue', 'utf8')
  assert.match(panel, /root\?: string/)
  assert.match(panel, /root: \(\) => props\.root \?\? ''/, '面板把项目根喂给 store')
  assert.match(panel, /跨会话保存/, '界面写明这是跨会话行为')
  const view = readFileSync('src/components/ToolWindowView.vue', 'utf8')
  assert.match(view, /<DebugPanel[^>]*:root="ctx\.root"/)
})
