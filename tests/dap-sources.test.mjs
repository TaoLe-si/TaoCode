// `src/debugSources.ts`：loadedSources / modules 的**按需重取**合并规则。
// 重点：身份规则与事件同一条（reference → path → name）、缺字段不造键、规范必填缺一个的条目丢弃、
// 快照只做 upsert（删除只由 removed 事件表达，一次重取不能把事件刚推来的行抹掉）。

import test from 'node:test'
import assert from 'node:assert/strict'

const {
  loadedSourceKey, loadedSourceRows, mergeLoadedSourceSnapshot, applyLoadedSourceSnapshot,
  moduleRows, mergeModuleSnapshot, applyModuleSnapshot, capabilityReason,
} = await import('../src/debugSources.ts')

test('loadedSources：身份规则与事件一致，三者都没有的条目丢弃', () => {
  assert.equal(loadedSourceKey('main.cpp', '', 0), 'name:main.cpp')
  assert.equal(loadedSourceKey('main.cpp', 'dap/main.cpp', 0), 'path:dap/main.cpp', 'path 优先于 name')
  assert.equal(loadedSourceKey('main.cpp', 'dap/main.cpp', 7), 'ref:7', 'sourceReference 优先于 path')
  assert.equal(loadedSourceKey('', '', 0), null)

  const rows = loadedSourceRows([
    { name: 'main.cpp', path: 'dap/main.cpp' },
    { name: '<memory>', sourceReference: 7 },
    { name: 'lib.cpp', path: 'C:/Windows/lib.cpp', origin: 'lib', presentationHint: 'deemphasize' },
    {},
    null,
  ])
  assert.deepEqual(rows.map(row => row.key), ['path:dap/main.cpp', 'ref:7', 'path:C:/Windows/lib.cpp'])
  assert.equal(rows[0].path, 'dap/main.cpp')
  assert.equal(rows[1].sourceReference, 7)
  assert.ok(!('path' in rows[1]), '缺 path 不许造空值')
  assert.equal(rows[2].name, 'lib.cpp', 'origin / presentationHint 不是列表行的一部分，但 name 要留下')
})

test('loadedSources 重取：同名同路径的覆盖，新条目追加，不在快照里的旧行保留', () => {
  const existing = [
    { key: 'path:dap/main.cpp', name: 'main.cpp', path: 'dap/main.cpp' },
    { key: 'name:event-only.cpp', name: 'event-only.cpp' },
  ]
  const merged = mergeLoadedSourceSnapshot(existing, [
    { name: 'main.cpp', path: 'dap/main.cpp', sourceReference: 3 },
    { name: 'new.cpp', path: 'dap/new.cpp' },
  ])
  assert.equal(merged.length, 3, '快照没有的旧行不能因为一次重取就消失')
  assert.equal(merged[0].key, 'ref:3', '同一行换了身份键就是新行（旧的行按 key 找不到匹配）')
  assert.equal(merged[1].key, 'name:event-only.cpp')
  assert.equal(merged[2].key, 'path:dap/new.cpp')
  assert.equal(existing.length, 2, '纯函数不改原数组')
})

test('applyLoadedSourceSnapshot 原地替换（reactive 数组不换引用）', () => {
  const list = [{ key: 'name:old.cpp', name: 'old.cpp' }]
  applyLoadedSourceSnapshot(list, [{ name: 'new.cpp' }])
  assert.equal(list.length, 2)
  assert.equal(list[1].key, 'name:new.cpp')
})

test('modules：id/name 缺一个就丢弃，可选字段照规范拍平', () => {
  const rows = moduleRows([
    { id: 7, name: 'fake.dll', path: 'fake.dll', type: 'shared library', version: '1.0.0', symbolStatus: 'Symbols loaded', addressRange: '0x1000-0x2000', isUserCode: true },
    { id: 'plugin-a', name: 'plugin-a' },
    { id: 9, name: '' },
    { name: 'no-id' },
    { id: 10 },
    null,
  ])
  assert.deepEqual(rows.map(row => row.id), ['7', 'plugin-a'])
  assert.equal(rows[0].symbolStatus, 'Symbols loaded')
  assert.equal(rows[0].isUserCode, true)
  assert.equal(rows[1].id, 'plugin-a', '字符串 id 原样保留')
  assert.ok(!('path' in rows[1]), '缺字段不造键')
  assert.ok(!('isOptimized' in rows[1]))
})

test('modules 重取：按 id upsert，快照外的行保留', () => {
  const existing = [{ id: '7', name: 'fake.dll' }, { id: 'event-only', name: 'event-only' }]
  const merged = mergeModuleSnapshot(existing, [{ id: 7, name: 'fake.dll', version: '2.0' }, { id: 8, name: 'new.dll' }])
  assert.equal(merged.length, 3)
  assert.equal(merged[0].version, '2.0', '同一 id 的字段被快照更新')
  assert.equal(merged[1].id, 'event-only')
  applyModuleSnapshot(existing, [{ id: 7, name: 'fake.dll', version: '3.0' }])
  assert.equal(existing[0].version, '3.0')
})

test('能力位说明文案点出能力名与用途，不认识的能力位也不吞掉', () => {
  assert.match(capabilityReason('supportsStepBack'), /supportsStepBack/)
  assert.match(capabilityReason('supportsStepBack'), /反向调试/)
  assert.match(capabilityReason('supportsReadMemoryRequest'), /内存查看/)
  assert.match(capabilityReason('supportsCustomThing'), /supportsCustomThing/)
})
