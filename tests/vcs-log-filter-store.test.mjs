// vc/log-ui 的判据：日志过滤的持久化（上游 `VcsLogUiPropertiesImpl` 的过滤值按 log UI 存档）。
// 纯整形在 `src/vcsLogFilterStore.ts`；写侧只由 VcsLog.vue 的「应用」触发（导航不写）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MAX_STORED_REFS, isEmptyLogQuery, logFilterStorageKey, parseLogQuery, serializeLogQuery } from '../src/vcsLogFilterStore.ts'

test('往返：非空字段原样回来，空字段不进存档', () => {
  const query = { text: 'fix bug', author: 'alice', since: '2026-01-01', until: '2026-02-01', path: 'src/a', refs: ['main', 'v1.0'] }
  const round = parseLogQuery(serializeLogQuery(query))
  assert.deepEqual(round, query)
  assert.deepEqual(parseLogQuery(serializeLogQuery({ text: '', refs: [], path: '' })), {})
})

test('空过滤的判定：全空/空白串/空 refs 都算空', () => {
  assert.equal(isEmptyLogQuery({}), true)
  assert.equal(isEmptyLogQuery({ text: '   ', refs: ['', '  '] }), true)
  assert.equal(isEmptyLogQuery({ author: 'bob' }), false)
  assert.equal(isEmptyLogQuery({ refs: ['main'] }), false)
})

test('坏存档退化成没有过滤，而不是把垃圾喂给宿主', () => {
  assert.deepEqual(parseLogQuery(null), {})
  assert.deepEqual(parseLogQuery(''), {})
  assert.deepEqual(parseLogQuery('not json'), {})
  assert.deepEqual(parseLogQuery('[1,2,3]'), {})
  assert.deepEqual(parseLogQuery('{"text":42,"refs":"main","author":null}'), {})
})

test('refs 逐项校验并夹到 100 条（与原生 git.logFull 的上限一致）', () => {
  const many = Array.from({ length: 150 }, (_, index) => `ref-${index}`)
  const query = parseLogQuery(JSON.stringify({ refs: [...many, 7, '', '  ', null] }))
  assert.equal(query.refs.length, MAX_STORED_REFS)
  assert.equal(query.refs[0], 'ref-0')
  assert.equal(query.refs[MAX_STORED_REFS - 1], `ref-${MAX_STORED_REFS - 1}`)
  assert.deepEqual(parseLogQuery(JSON.stringify({ refs: 'main' })).refs, undefined)
})

test('超长过滤词判坏字段（防止把整段文本塞进存档）', () => {
  const long = 'x'.repeat(501)
  assert.deepEqual(parseLogQuery(JSON.stringify({ text: long })), {})
  assert.equal(serializeLogQuery({ text: long }), '{}')
})

test('存档键按仓库根区分（与列/分栏键同前缀）', () => {
  assert.equal(logFilterStorageKey('C:/work/demo'), `taocode.vcs.log.${encodeURIComponent('C:/work/demo')}.filters`)
  assert.notEqual(logFilterStorageKey('C:/a'), logFilterStorageKey('C:/b'))
})

test('接线：VcsLog.vue 读/写存档，useVcsLogData 用存档做初始查询', () => {
  const view = readFileSync(new URL('../src/components/VcsLog.vue', import.meta.url), 'utf8')
  const hook = readFileSync(new URL('../src/vcsLogData.ts', import.meta.url), 'utf8')
  assert.match(view, /parseLogQuery\(localStorage\.getItem\(logFilterStorageKey/)
  assert.match(view, /localStorage\.setItem\(logFilterStorageKey/)
  assert.match(view, /@apply="applyLogFilter"/)
  assert.match(hook, /restore\?: \(\) => GitLogQuery/)
  assert.match(hook, /query\.value = restoredQuery\(\)/)
})
