// esa/autoimport 缺项 ④ + es/autoimport 缺项 ⑤ 的判据：自动重载合并窗与长操作计数
// （上游 `AutoImportProjectTracker.kt:89-96,137-170,549-551` + `ExternalSystemAutoImportAwareListener`
// 的操作计数；坐标与折算在 `src/externalSystemAutoImport.ts` 尾注）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  AUTO_RELOAD_DELAY_MS, AUTO_RELOAD_MERGING_TIME_SPAN_MS, createAutoReloadWindow,
  createExternalSystemProjectTracker, effectiveReloadDelayMs, projectIdOf,
} from '../src/externalSystemAutoImport.ts'

const here = dirname(fileURLToPath(import.meta.url))
const readSource = file => readFileSync(join(here, '..', 'src', file), 'utf8')

test('常量与折算：跨度 300ms、延迟 3s、有效延迟 = max(round(delay/span)-1,1)*span = 2700ms', () => {
  assert.equal(AUTO_RELOAD_MERGING_TIME_SPAN_MS, 300)
  assert.equal(AUTO_RELOAD_DELAY_MS, 3000)
  assert.equal(effectiveReloadDelayMs(), 2700)
  assert.equal(effectiveReloadDelayMs(800, 300), 600, '800/300≈3 拍，扣掉已在等的 1 拍 → 2×300')
  assert.equal(effectiveReloadDelayMs(200, 300), 300, '不足一拍时至少一等')
})

test('合并窗：首条开窗，窗内后续并进来，一次触发带全部 key；触发后重开新窗', () => {
  const timers = []
  const fired = []
  const win = createAutoReloadWindow(keys => fired.push(keys), {
    startTimer: (ms, run) => { const entry = { ms, run, cancelled: false }; timers.push(entry); return () => { entry.cancelled = true } },
  })
  assert.equal(win.schedule('app'), true, '首条开一窗')
  assert.equal(timers[0].ms, 2700, '开窗延迟用有效延迟')
  assert.equal(win.schedule('app'), false, '同 key 重复不算开窗')
  assert.equal(win.schedule('other'), false, '窗内并入')
  assert.equal(timers.length, 1, '只排一次时钟')
  assert.deepEqual(win.pending(), ['app', 'other'])
  timers[0].run()
  assert.deepEqual(fired, [['app', 'other']], '一次触发带全部待项')
  assert.equal(win.schedule('third'), true, '触发后下一批重开窗')
})

test('显式刷新吃掉待项（PriorityEat 语义）；空了就撤时钟', () => {
  const timers = []
  const fired = []
  const win = createAutoReloadWindow(keys => fired.push(keys), {
    startTimer: (ms, run) => { const entry = { ms, run, cancelled: false }; timers.push(entry); return () => { entry.cancelled = true } },
  })
  win.schedule('app'); win.schedule('other')
  win.eatPending('app')
  assert.deepEqual(win.pending(), ['other'])
  assert.equal(timers[0].cancelled, false, '还有待项时不撤时钟')
  win.eatPending('other')
  assert.deepEqual(win.pending(), [])
  assert.equal(timers[0].cancelled, true, '待项清空即撤时钟（不会触发）')
  win.schedule('a'); win.eatPending()
  assert.deepEqual(win.pending(), [])
  assert.equal(fired.length, 0)
})

test('dispose：换工程后旧窗既不清发也发不出', () => {
  const timers = []
  const fired = []
  const win = createAutoReloadWindow(keys => fired.push(keys), {
    startTimer: (ms, run) => { const entry = { ms, run, cancelled: false }; timers.push(entry); return () => { entry.cancelled = true } },
  })
  win.schedule('app')
  win.dispose()
  assert.equal(timers[0].cancelled, true)
  assert.deepEqual(win.pending(), [])
  assert.equal(fired.length, 0)
})

test('操作计数：长操作期间的设置文件改动只攒脏，结束时按档位补齐调度', () => {
  const reloadCalls = []
  const tracker = createTrackerForTest(reloadCalls, 'ALL')
  const id = projectIdOf('GRADLE', 'D:/workspace/app')
  tracker.register({ projectId: id, settingsFiles: () => [], reloadProject: context => reloadCalls.push(context) })
  tracker.activate(id)
  tracker.operationStarted()
  assert.equal(tracker.operationInProgress(), true)
  assert.equal(tracker.settingsFileChanged(id, 'D:/workspace/app/build.gradle', 'UPDATE', 'EXTERNAL'), 'ignore',
    '操作进行中不当场决策（上游 isOperationInProgress 的门）')
  assert.deepEqual(reloadCalls, [], '但没丢：只是没排')
  tracker.operationCompleted()
  assert.equal(reloadCalls.length, 1, '结束时补齐调度')
  assert.equal(reloadCalls[0].isExplicitReload, false, '自动路径不是显式刷新')
})

function createTrackerForTest(reloadCalls, type) {
  // 用真实 tracker（不喂假实现），只是把档位固定成 ALL。
  return createExternalSystemProjectTracker({ autoReloadType: () => type })
}

test('接线：gradleHost 用合并窗 + 操作计数，自动重载不再当场 await sync', () => {
  const host = readSource('gradleHost.ts')
  assert.match(host, /const autoReloadWindow = createAutoReloadWindow/)
  assert.match(host, /if \(context\.isExplicitReload\) \{ void sync\(directory\); return \}/)
  assert.match(host, /autoReloadWindow\.schedule\(directory\)/)
  assert.match(host, /autoReloadWindow\.eatPending\(directory\)/)
  assert.match(host, /if \(longOperation\) autoImportTracker\.operationStarted\(\)/)
  assert.match(host, /if \(longOperation\) autoImportTracker\.operationCompleted\(\)/)
  assert.match(host, /autoReloadWindow\.dispose\(\)/)
  assert.doesNotMatch(host, /if \(reload\) \{\s*await sync\(\)/, '旧的「自动重载当场 await sync」已经换进合并窗')
})
