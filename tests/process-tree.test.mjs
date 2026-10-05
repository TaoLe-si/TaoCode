// 实例的**进程树**：宿主 `run.instances` 的 `tree`（pid/parent/name）→ 控制台的行。
//
// 上层判据是“停止会结束整棵树，这棵树用户看得到”：
//   · 纯逻辑（解析校验 / 前序拍平 / 兄弟顺序 / 断开行丢弃）在 src/processTree.ts；
//   · 原生侧回传由 run_host_test 覆盖；
//   · 这里再核一遍接线（快照真的填进实例记录、RunConsole 真的渲染层级）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { flattenProcessTree, parseProcessTree } from '../src/processTree.ts'
import { applyRunInstanceSnapshot, handleRunStarted, runInstances } from '../src/runInstances.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('parseProcessTree：只收合法树项，坏行丢掉', () => {
  assert.deepEqual(parseProcessTree(null), [])
  assert.deepEqual(parseProcessTree({ pid: 1 }), [])
  const parsed = parseProcessTree([
    { pid: 200, parent: 100, name: 'cmd.exe' },
    { pid: 200, parent: 999, name: '重复 pid' },
    { pid: -1, parent: 100, name: '非法 pid' },
    { pid: 201.5, parent: 100, name: '非整数' },
    { pid: 202, parent: 'x', name: 7 },
    'not-an-object',
  ])
  assert.deepEqual(parsed, [
    { pid: 200, parent: 100, name: 'cmd.exe' },
    { pid: 202, parent: 0, name: '' },
  ])
})

test('flattenProcessTree：前序、缩进层级、兄弟按 pid 升序', () => {
  const rows = flattenProcessTree(100, [
    { pid: 204, parent: 201, name: 'gcc.exe' },
    { pid: 202, parent: 100, name: 'cmd.exe' },
    { pid: 201, parent: 100, name: 'ninja.exe' },
    { pid: 203, parent: 201, name: 'cc1.exe' },
  ])
  assert.deepEqual(rows.map(row => [row.pid, row.depth]), [
    [201, 1], [203, 2], [204, 2], [202, 1],
  ])
  // 每一项都带父 pid 与名字（tooltip 用）。
  assert.equal(rows[0].parent, 100)
  assert.equal(rows[1].parent, 201)
})

test('flattenProcessTree：与根断开/成环的行不渲染，空名字退化成 PID', () => {
  const rows = flattenProcessTree(100, [
    { pid: 500, parent: 499, name: '别的内核进程' },
    { pid: 501, parent: 502, name: '环 A' },
    { pid: 502, parent: 501, name: '环 B' },
    { pid: 200, parent: 100, name: '' },
    { pid: 100, parent: 200, name: '自环' },
  ])
  assert.deepEqual(rows.map(row => [row.pid, row.depth, row.name]), [[200, 1, 'PID 200']])
  assert.deepEqual(flattenProcessTree(0, [{ pid: 1, parent: 0, name: 'x' }]), [])
})

test('applyRunInstanceSnapshot：tree 填进实例记录，children 兼容保留', () => {
  handleRunStarted({ instance: 77, label: '演示' })
  const claimed = applyRunInstanceSnapshot([
    { id: 77, pid: 4242, children: [4243], tree: [{ pid: 4243, parent: 4242, name: 'ping.exe' }] },
    { id: 9999, pid: 1, children: [], tree: [] },
  ])
  assert.equal(claimed, 1, '认领不了的 id 跳过')
  const record = runInstances.get(77)
  assert.equal(record.pid, 4242)
  assert.deepEqual(record.children, [4243])
  assert.deepEqual(record.tree, [{ pid: 4243, parent: 4242, name: 'ping.exe' }])
  assert.deepEqual(flattenProcessTree(record.pid, record.tree).map(row => row.name), ['ping.exe'])
  // 老宿主的快照没有 tree：保留上一次的树，而不是清空。
  applyRunInstanceSnapshot([{ id: 77, pid: 4242, children: [4243] }])
  assert.deepEqual(record.tree, [{ pid: 4243, parent: 4242, name: 'ping.exe' }])
})

test('接线：原生回传 tree，RunConsole 按层级渲染', () => {
  const host = read('native/run_host.cpp')
  assert.ok(host.includes('descendant_processes'), '宿主侧要有后代枚举（带 parent/name）')
  assert.ok(host.includes('{"tree", std::move(tree)}'), 'run.instances 要回传 tree')
  const hostHeader = read('native/run_host.hpp')
  assert.ok(hostHeader.includes('tree'), 'run_host.hpp 的 instances 契约要写清 tree')
  const console = read('src/components/RunConsole.vue')
  assert.ok(console.includes('flattenProcessTree'), 'RunConsole 用纯函数拍平进程树')
  assert.ok(console.includes('run-process-tree'), 'RunConsole 要渲染树容器')
  assert.ok(console.includes(':style="{ paddingLeft:'), '缩进体现层级')
  const bridge = read('src/bridge.ts')
  assert.ok(bridge.includes("'run.instances'"), '桥接 Method 里要有 run.instances')
})
