// 「正在检查代码」这一行**能取消**（2026-10-06 progflow，任务书里的第 3 条）。
//
// 磁盘上重验过的缺陷形状：`src/workspaceInspection.ts` 调
// `backgroundTaskManager.begin(id, '正在检查代码', { detail })` 时**没给 `onCancel`**，
// 而 `src/progressTasks.ts:87` 的推导是 `cancellable: options.cancellable ?? options.onCancel !== undefined`
// ⇒ 那一行落在不可取消档 ⇒ 面板（`src/progressPanel.ts:99`）与状态栏模板（`row.cancellable` 那颗按钮）
// 都不给它发取消按钮。审计写的坐标是「`:79` 少给 onCancel」，本轮实测该行确实是 begin 那一句。
//
// 上游依据（本轮逐条开文件数过行号）：
//   · 整工程检查那条任务是 `Task.Backgroundable`，两参构造器的 `canBeCancelled` **默认 true**：
//     `platform/core-api/src/com/intellij/openapi/progress/Task.java:202-204`（三参那一档在 `:206-208`）；
//     `GlobalInspectionContextImpl.java:685` 起的「Scanning files to inspect」用的正是两参那一档。
//   · 取消回调装成 `cancel()` 的委托：`ProgressIndicatorModel.kt:32-34`（`:33` 先 `onCancel.invoke()`、
//     `:34` 才 `super.cancel()`）—— 本仓同一对在 `src/progressTasks.ts:120-130`。
//   · 取消之后**什么都不写**：`GlobalInspectionContextImpl.java:466`、`:488`（处理每个文件的第一句）、
//     `:694`/`:722`（遍历范围时两句）都是 `ProgressManager.checkCanceled()`；
//     `:726-727` 把 `ProcessCanceledException` 吞掉、`:729-733` 的 finally 照走 ⇒ 收尾那一拍仍然收行。
//   · 行的按钮按 `isCancellable()` 画：`InfoAndProgressPanel.kt:753`/`:876`。
//
// 中文文案：参考树里没有整工程检查"被取消"的通知串（`InspectionsBundle.properties` grep `cancel` 零命中，
// 上游取消就是进度行消失、不弹通知），本仓的 `'整工程检查已取消。'` 是**沿用本仓既有说法**
// （`src/gradleHost.ts:485` 的 `'已取消。'`、`src/backgroundTasks.ts:37` 的 `'后台任务已取消。'`），
// 不是从上游本地化包核出来的 —— 上游 zh 包不在参考树里，无法核实。
import test from 'node:test'
import assert from 'node:assert/strict'
import { nextTick } from 'vue'

import { runWorkspaceInspection, WORKSPACE_INSPECTION_TASK_ID } from '../src/workspaceInspection.ts'
import { backgroundTaskManager } from '../src/progressTasks.ts'
import { DiagnosticSourceCaches } from '../src/workspaceDiagnostics.ts'
import { createProgressPanel } from '../src/progressPanel.ts'

const settle = async () => { for (let i = 0; i < 12; i += 1) await nextTick() }
const d = (line, message, extra = {}) => ({ line, character: 0, severity: 1, message, ...extra })

/** 一条会在 `query` 上停住、等外部放行的检查；返回它的 promise 与放行函数。 */
function pendingInspection(items, diagnostics, resultIds) {
  let release
  const query = () => new Promise(resolve => {
    release = () => resolve({ available: true, items })
  })
  const running = runWorkspaceInspection({
    query, diagnostics, resultIds, sources: new DiagnosticSourceCaches(),
  })
  return { running: async () => await running, release: () => release() }
}

const REPORT = [{ path: 'a.ts', kind: 'full', diagnostics: [d(2, '拉来的')], resultId: 'r1' }]

test('检查在途时取消：诊断表一个字都不写、resultId 表整体不动、行照样收掉', async () => {
  const diagnostics = new Map([['a.ts', [d(1, '编辑器里 push 来的')]]])
  const resultIds = new Map([['old.ts', 'old-id']])
  const before = structuredClone([...diagnostics.get('a.ts')])
  try {
    const run = pendingInspection(REPORT, diagnostics, resultIds)
    await settle()
    const task = backgroundTaskManager.get(WORKSPACE_INSPECTION_TASK_ID)
    assert.ok(task, '检查期间任务表里要有那一行')
    assert.equal(task.cancellable, true, 'begin 给了 onCancel ⇒ 可取消档（progressTasks.ts:87 的那条推导）')

    assert.equal(backgroundTaskManager.cancel(WORKSPACE_INSPECTION_TASK_ID), true)
    run.release()
    const outcome = await run.running()

    assert.equal(outcome.ok, false, '取消不算成功')
    assert.deepEqual(diagnostics.get('a.ts'), before, '报告到手也不写进诊断表')
    assert.deepEqual([...resultIds], [['old.ts', 'old-id']], 'resultId 表保持上一轮的那份')
    assert.equal(backgroundTaskManager.get(WORKSPACE_INSPECTION_TASK_ID), null,
      'finally 仍然把那一行收掉（上游 :729-733 的 finally 照走）')
  } finally {
    backgroundTaskManager.end(WORKSPACE_INSPECTION_TASK_ID)
  }
})

test('对照（这条不是恒真）：不取消就照常写入诊断表并换掉 resultId', async () => {
  const diagnostics = new Map([['a.ts', [d(1, '编辑器里 push 来的')]]])
  const resultIds = new Map([['old.ts', 'old-id']])
  try {
    const run = pendingInspection(REPORT, diagnostics, resultIds)
    await settle()
    run.release()
    const outcome = await run.running()
    assert.equal(outcome.ok, true)
    assert.deepEqual(diagnostics.get('a.ts').map(item => item.message), ['编辑器里 push 来的', '拉来的'])
    assert.deepEqual([...resultIds], [['a.ts', 'r1']], '上一轮的 id 被这一轮整体替换')
  } finally {
    backgroundTaskManager.end(WORKSPACE_INSPECTION_TASK_ID)
  }
})

test('面板那一行真的有取消按钮，点它就是把这次检查停下来的那个回调', async () => {
  const panel = createProgressPanel({
    gitProgress: () => ({ running: false, queued: 0 }),
    cloneProgress: () => [],
    cancelling: () => false,
    runState: () => ({ running: false }),
    gradleSync: () => ({ running: false, command: '', startedAt: 0, output: '' }),
    lspProgress: () => [],
    autoShowPopup: () => false,
    notify: () => {},
  })
  const diagnostics = new Map()
  const resultIds = new Map()
  try {
    const run = pendingInspection(REPORT, diagnostics, resultIds)
    await settle()
    const row = panel.backgroundTasks.value.find(item => item.title === '正在检查代码')
    assert.ok(row, '检查期间面板里要有那一行')
    assert.deepEqual(row.cancellable, { task: WORKSPACE_INSPECTION_TASK_ID },
      '取消动作带着这一行自己的 id（ProgressIndicatorModel.kt:25-37 的那个委托）')
    panel.cancelProgressRow(row)
    assert.equal(panel.backgroundTasks.value.some(item => item.title === '正在检查代码'), false,
      '点完那一行就收掉（先调回调再收行，progressTasks.ts:120-130 的顺序）')
    run.release()
    const outcome = await run.running()
    assert.equal(outcome.ok, false, '用户在检查期间点取消 ⇒ 这次检查没有结果写入')
    assert.equal(diagnostics.size, 0, '诊断表没被碰过')
  } finally {
    backgroundTaskManager.end(WORKSPACE_INSPECTION_TASK_ID)
    await new Promise(resolve => { setTimeout(resolve, 0) })
  }
})
