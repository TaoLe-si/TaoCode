// B3：`CommitChecksProgressIndicatorTooltip` 的判据 —— 点进度行弹出「放大版 + 进度条」的那个浮层。
//
// 上游 `platform/vcs-impl/src/com/intellij/vcs/commit/CommitChecksProgressIndicatorTooltip.kt:23-58`：
//   · `onClick` 时若指示器还在跑（`isRunning()`）就 `showPopup`，把 `PopupCommitChecksProgressIndicator`
//     摆到指示器**上方**：`Point(0, -content.preferredSize.height - scale(8))`；
//   · 指示器 `stop()` 时 `closePopup()`；
//   · 浮层本体比行**多一条进度条**（行只有文字 + 取消按钮）。
//
// 本仓的落点：纯规则在 `src/commitChecks.ts` 的 `checksProgressPopup`，接线在
// `src/components/SourceControl.vue`（进度行整行可点、浮层挂在行内、取消按钮不触发切换）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CHECKS_POPUP_GAP, checksProgress, checksProgressPopup,
} from '../src/commitChecks.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('浮层只在「用户点开 + 指示器还在跑」时可见', () => {
  const running = checksProgress(true, null, true)
  assert.equal(checksProgressPopup(running, false).visible, false, '没点开时不显示')
  assert.equal(checksProgressPopup(running, true).visible, true, '点开后显示')
})

test('指示器 stop() 之后浮层跟着收掉（上游 stop → closePopup）', () => {
  const stopped = checksProgress(true, null, false)
  assert.equal(stopped.visible, false, '行本身先没了')
  assert.equal(checksProgressPopup(stopped, true).visible, false, '开着标记为真也不显示')
})

test('浮层沿用行的标题与正文，并比行多一条进度条', () => {
  const progress = checksProgress(true, '扫描 TODO')
  const popup = checksProgressPopup(progress, true)
  assert.equal(popup.title, progress.title, 'progress.title.commit.checks')
  assert.equal(popup.text, progress.text, '正文与行一致（含上下文那一档）')
  assert.equal(popup.bar, true, 'PopupCommitChecksProgressIndicator 比行多一条进度条')
})

test('位置：贴在指示器上方，间距 = 上游 scale(8)', () => {
  const popup = checksProgressPopup(checksProgress(true, null), true)
  assert.equal(popup.placement, 'above', 'Point(0, -height - 8) 是"上方"')
  assert.equal(popup.gap, CHECKS_POPUP_GAP)
  assert.equal(CHECKS_POPUP_GAP, 8, 'scale(8) 的 8')
})

test('接线：进度行可点、浮层渲染、取消按钮不触发切换', () => {
  // 进度浮层那一族已拆进 src/sourceControlCommitChecks.ts（模块化拆分，行为逐字未改），两处都读。
  const source = read('src/components/SourceControl.vue') + read('src/sourceControlCommitChecks.ts')
  assert.match(source, /checksProgressPopup/, '面板要引这个纯函数')
  assert.match(source, /class="sc-checks-popup"/, '浮层本体要真的渲染出来')
  assert.match(source, /role="progressbar"/, '浮层里那条进度条')
  assert.match(source, /@click="checksPopupOpen = !checksPopupOpen"/, '点进度行切换浮层')
  assert.match(source, /@click\.stop="cancelCommitChecks"/, '取消按钮不能把浮层一起切换')
  assert.match(source, /bottom: calc\(100% \+ 8px\)/, 'CSS 把浮层摆在行的上方（间距 8px）')
})
