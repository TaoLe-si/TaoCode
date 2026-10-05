// 提交检查的两件收尾（B3：`CommitChecksProgressIndicator` + 索引期警告）。
//
// 上游 `platform/vcs-impl/src/com/intellij/vcs/commit/CommitChecksProgressIndicator.kt`：
//   · `CommitChecksTaskInfo`（`:18-23`）：标题 `progress.title.commit.checks`、可取消；
//   · `StatusBarProgressIndicator.setText`（`:105-125`）：按"只跑检查 / 提交中"两档折算正文；
//   · `fixDoubleEllipsis`（`:71-86`）：正文尾部省略号与副文本头部省略号撞车时去掉正文那个；
//   · `label.commit.checks.not.available.during.indexing`（`VcsBundle.properties:20`，中文包 :648）：
//     项目分析期间那条警告（上游挂在 `CommitProgressPanel.kt:310`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CHECKS_CANCEL_TEXT, CHECKS_PROGRESS_TITLE, NOT_AVAILABLE_DURING_INDEXING, RUNNING_CHECKS_TEXT,
  checksProgress, fixDoubleEllipsis, indexingWarningVisible,
} from '../src/commitChecks.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

// —— 面板内进度 ——

test('the indicator carries the upstream title and cancel button', () => {
  const progress = checksProgress(true, null)
  assert.equal(progress.title, CHECKS_PROGRESS_TITLE, 'progress.title.commit.checks')
  assert.equal(progress.text, RUNNING_CHECKS_TEXT, '只跑检查那一档的正文')
  assert.equal(progress.cancellable, true, '上游 isCancellable() = true')
  assert.equal(progress.cancelText, CHECKS_CANCEL_TEXT)
  assert.equal(progress.visible, true)
})

// 两档正文（上游 `isOnlyRunCommitChecks` 分派）。
test('the commit path uses its own wording', () => {
  assert.equal(checksProgress(false, null).text, '正在提交…', 'commit.checks.on.commit.progress.text')
})

// 带上下文那一档（`….with.context`）。
test('a step adds the context suffix', () => {
  assert.equal(checksProgress(true, '扫描 TODO').text, '正在运行提交检查: 扫描 TODO')
  assert.equal(checksProgress(false, '写入对象').text, '正在提交: 写入对象')
})

test('the indicator can be made non-cancellable', () => {
  assert.equal(checksProgress(true, null, true, false).cancellable, false)
})

// 任务不在跑时整行**不显示**（上游那个 InlineProgressIndicator 只在任务活着时挂着）。
// 第一版把 visible 写成恒 true，真机上那一行一直挂着 —— 这一条钉住它。
test('the row is hidden when nothing is running', () => {
  assert.equal(checksProgress(true, null, true).visible, true)
  assert.equal(checksProgress(true, null, false).visible, false)
  assert.equal(checksProgress(false, null, false).visible, false, '提交路径同理')
})

// —— fixDoubleEllipsis（:71-86）——

test('a doubled ellipsis is fixed', () => {
  assert.equal(fixDoubleEllipsis('正在运行…', '…正在导入'), '正在运行')
  assert.equal(fixDoubleEllipsis('正在运行...', '...正在导入'), '正在运行')
  // 只撞一头时不动。
  assert.equal(fixDoubleEllipsis('正在运行…', '正在导入'), '正在运行…')
  assert.equal(fixDoubleEllipsis('正在运行', '…正在导入'), '正在运行')
  // 没有副文本时也不动。
  assert.equal(fixDoubleEllipsis('正在运行…', null), '正在运行…')
})

// —— 索引期警告 ——

test('the warning text is the upstream string', () => {
  assert.equal(NOT_AVAILABLE_DURING_INDEXING, '项目分析期间某些提交检查不可用', 'VcsBundle.properties:648')
})

// 上游那条警告在 dumb 模式且没在跑检查时出现；跑检查时让位给进度行。
test('the warning yields to the progress row while checks run', () => {
  assert.equal(indexingWarningVisible(true, false), true)
  assert.equal(indexingWarningVisible(true, true), false, '正在跑检查时不显示这条')
  assert.equal(indexingWarningVisible(false, false), false, '不在分析中就不显示')
})

// —— 接线 ——

test('the panel renders both rows', () => {
  // 进度行/分析中警告那一族已拆进 src/sourceControlCommitChecks.ts（模块化拆分，行为逐字未改），两处都读。
  const panel = read('src/components/SourceControl.vue') + read('src/sourceControlCommitChecks.ts')
  assert.match(panel, /class="sc-checks-progress"/, '面板内要有进度行')
  assert.match(panel, /checksProgress\.title/, '标题来自上游')
  assert.match(panel, /class="sc-checks-indexing"/, '面板内要有分析中警告')
  assert.match(panel, /NOT_AVAILABLE_DURING_INDEXING/)
})

// 「分析中」的判据必须与状态栏 `smartModeLabel` 同源：**配了服务但没跑起来**，
// 而不是"服务没就绪"（没配服务是正常状态，不能报"分析中"）。
test('the analyzing signal matches the status bar rule, not "not ready"', () => {
  // 进度行/分析中警告那一族已拆进 src/sourceControlCommitChecks.ts（模块化拆分，行为逐字未改），两处都读。
  const panel = read('src/components/SourceControl.vue') + read('src/sourceControlCommitChecks.ts')
  assert.match(panel, /analyzing\?: boolean/, 'prop 叫 analyzing')
  assert.doesNotMatch(panel, /lspRunning\?: boolean/, '不该直接把 lspRunning 当分析中')
  assert.match(panel, /indexingWarningVisible\(Boolean\(props\.analyzing\), checksBusy\.value\)/)
  assert.match(panel, /checksProgressOf\(\s*checksRound\.value\.onlyRunChecks, checksRound\.value\.step,\s*checksProgressShown\(checksBusy\.value, checksFailures\.value\.length > 0, checksRowShown\.value\), true,/,
    '可见性 = 在跑 + 失败行为空 + 延迟已过（:163-175），正文两档跟着这一轮的 onlyRunChecks，步名跟着当前步')
  const view = read('src/components/ToolWindowView.vue')
  assert.match(view, /:analyzing="Boolean\(ctx\.activeTabPath\) && Boolean\(ctx\.activeConfigured\) && !ctx\.activeLspRunning"/,
    '判据 = 有活动文件 + 配了服务 + 还没跑起来')
  assert.match(read('src/toolViewContext.ts'), /activeConfigured: active\.value\?\.lspConfigured === true/)
})
