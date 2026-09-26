import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_TASKS_FINISHED,
  NO_PROCESSES_RUNNING,
  popupRows,
  showProgressWidget,
  updateFinishedLatch,
} from '../src/processPopup.ts'

const task = (title, cancellable) => ({ title, detail: `${title} 进行中`, cancellable })

// ProcessPopup.java:100-133 — running indicators are listed as-is.
test('running tasks are listed in order', () => {
  const rows = popupRows([task('克隆仓库'), task('git push')], true)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(r => r.kind), ['task', 'task'])
  assert.deepEqual(rows.map(r => r.title), ['克隆仓库', 'git push'])
})

// SeparatorDecorator.kt:31-43 — enabled only when the *previous* component is also an indicator.
test('only task rows after another task row carry a separator', () => {
  const rows = popupRows([task('a'), task('b'), task('c')], false)
  assert.deepEqual(rows.map(r => r.separator), [false, true, true])
})

// TasksFinishedDecorator.kt:31 — added at index 0, so nothing precedes it.
test('the finished label never carries a separator', () => {
  const rows = popupRows([], true)
  assert.deepEqual(rows.map(r => r.separator), [false])
})

test('an idle popup that already ran something says all tasks completed', () => {
  const rows = popupRows([], true)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kind, 'finished')
  assert.equal(rows[0].title, ALL_TASKS_FINISHED)
})

// ProcessPopup.java:80,351-352 — a panel that never saw an indicator keeps its empty text.
test('an idle popup that never ran anything keeps the empty text', () => {
  const rows = popupRows([], false)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kind, 'empty')
  assert.equal(rows[0].title, NO_PROCESSES_RUNNING)
})

test('running tasks hide both the finished label and the empty text', () => {
  assert.deepEqual(popupRows([task('x')], true).map(r => r.kind), ['task'])
  assert.deepEqual(popupRows([task('x')], false).map(r => r.kind), ['task'])
})

test('a cancellable task keeps its handle so the row can offer 取消', () => {
  const rows = popupRows([task('构建', 'build')], false)
  assert.equal(rows[0].cancellable, 'build')
})

// ShowProcessWindowAction.java:16-55 — the popup opens even with nothing running.
test('the widget exists while the popup is open even with no tasks', () => {
  assert.equal(showProgressWidget(true, false), true)
  assert.equal(showProgressWidget(false, true), true)
  assert.equal(showProgressWidget(false, false), false)
})

// TasksFinishedDecorator.kt:23-32
test('the finished latch turns on when the last task goes away and stays on', () => {
  assert.equal(updateFinishedLatch(false, false, false), false) // nothing ever ran
  assert.equal(updateFinishedLatch(false, true, false), false) // a task just started
  assert.equal(updateFinishedLatch(false, false, true), true) // the last task finished
  assert.equal(updateFinishedLatch(true, true, false), true) // still remembered while busy
  assert.equal(updateFinishedLatch(true, false, false), true) // and after it finished again
})
