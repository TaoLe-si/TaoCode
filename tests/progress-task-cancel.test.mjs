// 「每个后台任务一条独立可取消的进度行」—— `src/progressTasks.ts` 的取消回调
// 与 `src/progressPanel.ts` 那一档的接线。
//
// 判决表 `pf/progress` 的缺口原文是「缺：`BackgroundableProcessIndicator` 那种
// **每个后台任务一条独立可取消进度窗**（本仓只有各功能自己的行 + 队列深度行）」。
// 这一条现在补的是**通用任务表那一半**：面板模板与 `cancelProgressRow` 回调本来都是现成的
// （`App.vue` 的进度列表里 `v-if="row.cancellable"` 那个按钮），但面板给通用任务表的行
// 写死了 `cancellable: false` —— 于是 `backgroundTaskManager.begin(id, title, { onCancel })`
// 登记的任务永远取消不掉。
//
// 上游依据：`ProgressIndicatorModel.kt:25-37` 那个 `onCancel` 构造 —— 取消回调装成
// `cancel()` 的委托，**先调它**（`:33`）**再**真取消（`:34` `super.cancel()`）；
// 可取消档是 `cancellation is TaskCancellation.Cancellable`（`:92`），
// 不可取消那档是 `TaskCancellation.nonCancellable()`（`:23`）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConcurrentTasksProgressManager, backgroundTaskManager } from '../src/progressTasks.ts'
import { createProgressPanel } from '../src/progressPanel.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('给了 onCancel 就落在可取消档；没给回调的那一档仍不可取消（ProgressIndicatorModel.kt:16/:23/:92）', () => {
  const manager = new ConcurrentTasksProgressManager()
  manager.begin('with', '带取消', { onCancel: () => {} })
  assert.equal(manager.get('with').cancellable, true, '有回调 ⇒ 可取消')
  manager.begin('without', '不带取消')
  assert.equal(manager.get('without').cancellable, false, '没有回调 ⇒ 不可取消档')
  // 显式给了档就照给的来（哪怕没给回调）。
  manager.begin('forced', '强制不可取消', { cancellable: false, onCancel: () => {} })
  assert.equal(manager.get('forced').cancellable, false)
})

test('cancel：先调 onCancel 再把那一行收掉（:32-34 的顺序）', () => {
  const manager = new ConcurrentTasksProgressManager()
  const order = []
  manager.begin('t', '可取消的任务', { onCancel: () => order.push('onCancel') })
  assert.equal(manager.cancel('t'), true)
  assert.deepEqual(order, ['onCancel'], '回调真的被调了')
  assert.equal(manager.get('t'), null, '回调之后那一行收掉')
  // 再取消一次已经没有任务了。
  assert.equal(manager.cancel('t'), false)
  assert.deepEqual(order, ['onCancel'], '不会重复调回调')
})

test('cancel：回调抛错也要把那一行收掉，否则界面里永远留一条转不掉的行', () => {
  const manager = new ConcurrentTasksProgressManager()
  manager.begin('t', '回调会炸', { onCancel: () => { throw new Error('取消失败') } })
  assert.throws(() => manager.cancel('t'), /取消失败/)
  assert.equal(manager.get('t'), null, '行照样收掉')
})

test('不可取消的档点了也取消不掉（cancel 返 false，不调回调）', () => {
  const manager = new ConcurrentTasksProgressManager()
  let called = 0
  manager.begin('t', '不可取消', { onCancel: () => { called++ }, cancellable: false })
  assert.equal(manager.cancel('t'), false)
  assert.equal(called, 0)
  assert.ok(manager.get('t'), '行还在')
})

test('end/clear 之后不留回调：同 id 重新 begin 不会拿到上一条任务的取消回调', () => {
  const manager = new ConcurrentTasksProgressManager()
  const first = []
  manager.begin('t', '第一条', { onCancel: () => first.push('first') })
  manager.end('t')
  manager.begin('t', '第二条', { cancellable: true })
  assert.equal(manager.cancel('t'), true, '显式给了可取消档但没给回调 ⇒ 照样能取消（只是没有回调要跑）')
  assert.deepEqual(first, [], '第一条任务的回调没有被带过来')
  manager.begin('x', '待清', { onCancel: () => {} })
  manager.clear()
  assert.equal(manager.size, 0)
  assert.equal(manager.cancel('x'), false)
})

test('接线：面板给通用任务表的行按它自己的可取消档发取消按钮，并按 id 找回回调', async () => {
  // 造一个最小宿主上下文，面板只需要这几个惰性 getter。
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
  let cancelled = 0
  backgroundTaskManager.begin('test.panel.cancel', '可取消的后台任务', { onCancel: () => { cancelled++ } })
  backgroundTaskManager.begin('test.panel.plain', '不可取消的后台任务')
  try {
    const rows = panel.backgroundTasks.value
    const cancellable = rows.find(row => row.title === '可取消的后台任务')
    const plain = rows.find(row => row.title === '不可取消的后台任务')
    assert.deepEqual(cancellable.cancellable, { task: 'test.panel.cancel' }, '取消动作带着自己的 id')
    assert.equal(plain.cancellable, false, '不可取消的那一行不给按钮')

    panel.cancelProgressRow(cancellable)
    assert.equal(cancelled, 1, '点了取消真的调到了那条任务自己的回调')
    assert.equal(backgroundTaskManager.get('test.panel.cancel'), null, '那一行被收掉')
    assert.equal(panel.backgroundTasks.value.some(row => row.title === '可取消的后台任务'), false)
  } finally {
    backgroundTaskManager.end('test.panel.plain')
    backgroundTaskManager.end('test.panel.cancel')
    // 面板的心跳是**只在有任务时**开着的 setInterval（src/progressPanel.ts 的 createPingProgress）。
    // 任务表清空后那个 watch 要下一拍才停表 —— 不等这一拍，node --test 的事件循环永远排不空。
    await new Promise(resolve => setTimeout(resolve, 0))
  }
})

test('接线：面板那一档没有把不可取消的行也发成可取消（防回归：别写死 true 也不要写死 false）', () => {
  const src = read('src/progressPanel.ts')
  assert.ok(src.includes("cancellable: task.cancellable ? { task: task.id } : false"),
    '通用任务表那一段仍然写死了 cancellable')
  assert.ok(src.includes("if ('task' in target) { backgroundTaskManager.cancel(target.task); return }"),
    'cancelBackgroundTask 没有处理 { task } 那一档')
})
