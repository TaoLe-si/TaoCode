// 附加目标的「最近使用」记录（上游 `AttachToProcessDialog` 的最近进程栏）
// 与进程列表缺口的如实边界：列表要宿主枚举通道，本仓没有（判词里写清）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ATTACH_HISTORY_KEY, ATTACH_HISTORY_LIMIT, loadAttachHistory, parseAttachHistory, pushAttachTarget, saveAttachHistory,
} from '../src/debugAttach.ts'

const store = (initial = null) => {
  let value = initial
  return { getItem: () => value, setItem: (_key, next) => { value = next }, read: () => value }
}

test('最近目标：置顶/去重/trim/上限，不改原数组', () => {
  const original = ['1234', 'pipe\\name']
  const next = pushAttachTarget(original, ' 1234 ')
  assert.deepEqual(next, ['1234', 'pipe\\name'])
  assert.deepEqual(original, ['1234', 'pipe\\name'], '不改原数组')
  assert.deepEqual(pushAttachTarget(['a'], '  '), ['a'], '空串不记')
  const many = Array.from({ length: ATTACH_HISTORY_LIMIT + 3 }, (_, index) => `p${index}`)
  assert.equal(pushAttachTarget(many, 'new').length, ATTACH_HISTORY_LIMIT)
})

test('解析：坏 JSON/非数组/非字符串条目都退化成干净列表', () => {
  assert.deepEqual(parseAttachHistory(null), [])
  assert.deepEqual(parseAttachHistory('{'), [])
  assert.deepEqual(parseAttachHistory('"x"'), [])
  assert.deepEqual(parseAttachHistory(JSON.stringify(['4242', 7, '', ' pipe '])), ['4242', 'pipe'])
})

test('读写走 localStorage 键，存储不可用不抛', () => {
  const box = store()
  saveAttachHistory(box, ['4242'])
  assert.deepEqual(loadAttachHistory({ getItem: () => box.read(), setItem: () => {} }), ['4242'])
  assert.deepEqual(loadAttachHistory(null), [])
  assert.doesNotThrow(() => saveAttachHistory({ getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }, ['4242']))
  assert.equal(ATTACH_HISTORY_KEY, 'taocode.debugAttachTargets')
})

test('面板接线：附加输入有历史候选，成功附加才记录；进程列表没有宿主通道（判词要点）', () => {
  const panel = readFileSync('src/components/DebugPanel.vue', 'utf8')
  assert.match(panel, /list="debug-attach-history"/)
  assert.match(panel, /<datalist id="debug-attach-history">/)
  assert.match(panel, /attachHistory\.value = pushAttachTarget\(attachHistory\.value, selector\)/)
  assert.match(panel, /saveAttachHistory\(storage, attachHistory\.value\)/)
  assert.match(panel, /const attachHistory = ref<string\[\]>\(loadAttachHistory\(storage\)\)/)
  // 进程枚举通道：native 里只有 run 实例的进程树（run_host 的 descendant_processes），
  // 没有系统进程列表方法 —— 这条判据防止将来有人"以为有"。
  const method = readFileSync('src/bridge.ts', 'utf8').match(/export type Method = '([\s\S]*?)'$/m)
  assert.ok(method)
  assert.ok(!method[1].includes('process.list') && !method[1].includes('processes'), 'Method union 里没有进程枚举方法')
})
