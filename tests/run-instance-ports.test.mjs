// exec/run-instances 本轮补齐的端口监视（上游 execution/portsWatcher 的可见等价物）判据：
// 宿主 run.instances 的 ports 字段（native/run_host.cpp 的 ports_of + IpHelper 枚举）、
// 前端合入与 Run 控制台的展示。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyRunInstanceSnapshot, handleRunStarted, runInstances } from '../src/runInstances.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('快照合入：ports 去重、过滤非法值，老宿主没有该字段时保留上一次', () => {
  runInstances.clear()
  handleRunStarted({ instance: 7, label: 'A' })
  const claimed = applyRunInstanceSnapshot([{ id: 7, pid: 100, children: [], tree: [], ports: [8080, 8080, 9229, 0, 70000, 'x'] }])
  assert.equal(claimed, 1)
  assert.deepEqual(runInstances.get(7).ports, [8080, 9229])
  // 老宿主（没有 ports 字段）不清空已有结果。
  applyRunInstanceSnapshot([{ id: 7, pid: 100 }])
  assert.deepEqual(runInstances.get(7).ports, [8080, 9229])
  applyRunInstanceSnapshot([{ id: 7, ports: [3000] }])
  assert.deepEqual(runInstances.get(7).ports, [3000])
})

test('新实例默认 ports 为空数组（形状稳定，模板不用判 undefined）', () => {
  runInstances.clear()
  handleRunStarted({ instance: 1 })
  assert.deepEqual(runInstances.get(1).ports, [])
})

test('接线：native 枚举 + 纯过滤函数 + 自测 + 控制台展示', () => {
  const host = read('native/run_host.cpp')
  assert.match(host, /GetExtendedTcpTable/)
  assert.match(host, /TCP_TABLE_OWNER_PID_LISTENER/)
  assert.match(host, /std::vector<std::int64_t> ports_of\(/)
  assert.match(host, /\{"ports", std::move\(ports\)\}/)
  const header = read('native/run_host.hpp')
  assert.match(header, /std::vector<std::int64_t> ports_of\(/)
  const nativeTest = read('native/run_host_test.cpp')
  assert.match(nativeTest, /端口过滤：只保留实例进程树里的 LISTEN 端口/)
  const console = read('src/components/RunConsole.vue')
  assert.match(console, /instance\.ports\.length/)
  assert.match(console, /监听端口/)
})
