// 内存部件（src/memoryWidget.ts）的判据：上游 `MemoryUsagePanel` 的读数、两段条与除零守卫。
//
// 宿主没有 JVM 堆，三个量映射到 `ProcessMemory`：workingSet（used）/ private（allocated）/
// peakWorkingSet（分母）。单击强制 GC **没做**（没有等价 API，不建假按钮），
// 这一条在 docs/inventory/verdict-toolwindow-openapi.md 的 MemoryUsagePanel 行里登记。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { memoryCeiling, memoryGauge, memoryLabel } from '../src/memoryWidget.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('两段条的占比：used/max 与 allocated/max（上游的整数像素除法取百分比）', () => {
  assert.deepEqual(memoryGauge(500, 800, 1000), { usedPercent: 50, allocatedPercent: 80 })
  // allocated 小于 used（读数竞态）时取 used，别让底色露出来。
  assert.deepEqual(memoryGauge(600, 400, 1000), { usedPercent: 60, allocatedPercent: 60 })
  // 超量也不越界。
  assert.deepEqual(memoryGauge(1200, 900, 1000), { usedPercent: 100, allocatedPercent: 100 })
})

test('max 为 0（第一次异步读数没回来）⇒ 两段都是 0，不画条（上游 :174-176 的除零守卫）', () => {
  assert.deepEqual(memoryGauge(300, 500, 0), { usedPercent: 0, allocatedPercent: 0 })
  assert.deepEqual(memoryGauge(0, 0, -1), { usedPercent: 0, allocatedPercent: 0 })
})

test('文案是上游的 `{0} of {1}M`（UIBundle.properties:67）', () => {
  assert.equal(memoryLabel(512, 2048), '512 of 2048M')
  assert.equal(memoryLabel(0, 0), '0 of 0M')
  assert.equal(memoryLabel(Number.NaN, 100), '0 of 100M')
  assert.equal(memoryLabel(-5, -1), '0 of 0M')
})

test('条的分母取工作集/提交/峰值里最大的那个（峰值通常最大）', () => {
  assert.equal(memoryCeiling({ workingSetMb: 120, privateMb: 90, peakWorkingSetMb: 200 }), 200)
  assert.equal(memoryCeiling({ workingSetMb: 300, privateMb: 90, peakWorkingSetMb: 200 }), 300)
  assert.equal(memoryCeiling({ workingSetMb: 10, privateMb: 400, peakWorkingSetMb: 200 }), 400)
})

test('芯片接上了条与文案，且没有假 GC 按钮（点击仍是刷新读数）', () => {
  const app = read('src/App.vue')
  assert.match(app, /status-memory[^>]*@click="refreshMemory"/, '内存芯片的点击不再是刷新')
  assert.match(app, /memory-gauge-used/, '没有 used 段')
  assert.match(app, /memory-gauge-allocated/, '没有 allocated 段')
  assert.match(app, /\{\{ memoryText \}\}/, '芯片没有用 upstream 的 `NNN of MMMM` 文案')
  assert.doesNotMatch(app, /status-memory[^>]*SystemGC|forceGc|fullGC/i, '不存在的 GC 入口被画出来了')
})
