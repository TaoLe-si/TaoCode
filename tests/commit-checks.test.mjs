// 提交检查的判据（第四十四批 + 第四十五批修正）—— 上游三条：
//   · `Vcs.RunCommitChecks`（`vcs/commit/RunCommitChecksExecutor.kt`）：跑同一条检查链、**不提交**；
//     它**没有**常显按钮 —— 用户能看到的是失败行上那把刷新按钮（`RerunCommitChecksAction`，
//     `CommitProgressPanel.kt:492-521`，工具提示 `tooltip.rerun.commit.checks` = 重新运行提交检查）；
//   · `FailuresPanel`（`CommitProgressPanel.kt:394-471`）：失败行只在检查报出 failure 之后才可见；
//   · `SaveCommittingDocumentsVetoer.confirmSave`：提交期间"要不要立即保存这些文件"
//     （标题「在提交期间保存文件」、按钮「立即保存」/「延迟保存」；延迟 = 按磁盘上的版本提交）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RUNNING_CHECKS_TEXT, RERUN_CHECKS_TOOLTIP, CHECKS_FAILED_UNKNOWN, COMMIT_ACTION_TEXT,
  checksFailedTitle, commitAnywayLabel, commitCheckReport, failuresRowText, saveDuringCommitQuestion } from '../src/commitChecks.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const base = { blockReason: null, todoHits: 0, messageProblems: [], unsaved: [] }

test('全部通过：ok、没有失败明细、错误行是空的', () => {
  const report = commitCheckReport(base)
  assert.equal(report.ok, true)
  assert.equal(report.blockMessage, '')
  assert.deepEqual(report.failures, [])
})

test('空判没过 ⇒ 进"错误行"而不是"失败行"，文案取 VcsBundle 原文（不是自己编一句话）', () => {
  const noChanges = commitCheckReport({ ...base, blockReason: 'no-changes' })
  assert.equal(noChanges.ok, false)
  assert.equal(noChanges.blockMessage, '选择要提交的文件')
  assert.deepEqual(noChanges.failures, [], '空判不是"检查失败"——上游它是 buildErrorText 那条错误行')
  const noMessage = commitCheckReport({ ...base, blockReason: 'no-message' })
  assert.equal(noMessage.blockMessage, '指定提交消息', 'VcsBundle error.no.commit.message（中文包原文，不是"填写提交信息"）')
  const both = commitCheckReport({ ...base, blockReason: 'no-changes-no-message' })
  assert.equal(both.blockMessage, '选择要提交的文件并指定提交消息')
})

test('TODO 与提交信息的问题进"失败行"逐条列出来', () => {
  const report = commitCheckReport({
    ...base, todoHits: 3,
    messageProblems: [
      { kind: 'subject', line: 0, start: 9, end: 12, message: '主题行不能超过 72 个字符', fixes: ['reformat'] },
      { kind: 'separation', line: 1, start: 0, end: 0, message: '主题与正文之间缺少空行', fixes: ['blankLine'] },
    ],
    unsaved: ['src/a.ts'],
  })
  assert.equal(report.ok, false)
  assert.equal(report.blockMessage, '', '信息/暂存都在 ⇒ 错误行不该有内容')
  assert.equal(report.failures.length, 3, 'TODO 一条 + 信息两条')
  assert.match(report.failures[0], /3 处 TODO/)
  assert.match(report.failures[1], /^提交信息：主题行/)
  assert.deepEqual(report.unsaved, ['src/a.ts'], '未保存单独一档')
  assert.match(failuresRowText(report.failures), /3 处 TODO.*主题行.*缺少空行/)
})

test('未保存文件**不拦**提交，但一定要说出来', () => {
  const report = commitCheckReport({ ...base, unsaved: ['a.ts'] })
  assert.equal(report.ok, true, '上游是"问要不要保存"，不是拒绝')
  assert.deepEqual(report.failures, [], '未保存不是检查失败 —— 失败行上不该出现')
  assert.deepEqual(report.unsaved, ['a.ts'])
})

test('失败行说不出具体哪条时用 label.commit.checks.failed.unknown.reason', () => {
  assert.equal(CHECKS_FAILED_UNKNOWN, '检查失败')
  assert.equal(failuresRowText([]), '检查失败')
})

test('检查失败后提交按钮改名：action.commit.anyway.text = 仍然{0}（{0} = Git 的提交动作名）', () => {
  assert.equal(COMMIT_ACTION_TEXT, '提交', 'GitBundle commit.action.name')
  assert.equal(commitAnywayLabel(), '仍然提交')
  assert.equal(checksFailedTitle(), '提交 检查失败', 'commit.checks.failed.notification.title = {0} 检查失败')
})

test('提交期间保存文件的问句照上游（立即保存 / 延迟保存 + {0,choice,1#文件|2#文件}）', () => {
  const one = saveDuringCommitQuestion(['a.ts'])
  assert.match(one, /在提交期间保存文件/, '标题')
  assert.match(one, /当前正在将以下文件提交到 VCS/, '一个文件时不给数字')
  assert.match(one, /立即保存文件\?/)
  assert.match(one, /立即保存/)
  assert.match(one, /延迟保存/, '取消 = 延迟保存（按磁盘版本提交）')
  const two = saveDuringCommitQuestion(['a.ts', 'b.ts'])
  assert.match(two, /当前正在将以下2文件提交到 VCS/, '两个以上给数字（中文包就是这么写的）')
  assert.ok(two.includes('a.ts') && two.includes('b.ts'), '把文件列出来')
})

test('文案常量取随 IDE 发货的中文包', () => {
  assert.equal(RUNNING_CHECKS_TEXT, '正在运行提交检查…', 'commit.checks.only.progress.text')
  assert.equal(RERUN_CHECKS_TOOLTIP, '重新运行提交检查', 'tooltip.rerun.commit.checks')
})

test('接线：检查链只有一处；面板上没有常显的「运行提交检查」按钮，只有失败行上那把', () => {
  const panel = read('src/components/SourceControl.vue')
  assert.match(panel, /async function collectCommitChecks\(\): Promise<CommitCheckReport>/, '检查链的单一入口')
  assert.equal((panel.match(/collectCommitChecks\(\)/g) ?? []).length, 4, '一处定义 + 提交 / 提交并推送 / 失败行那把刷新按钮三条调用路')
  assert.ok(!panel.includes('sc-checks-button'), '常显按钮是编造的（上游这条动作没有常显入口）—— 必须去掉')
  assert.match(panel, /v-if="checksFailures\.length" class="sc-check-failures"/, '失败行只在有 failure 时出现')
  assert.match(panel, /class="icon-button sc-rerun-checks"[^>]*@click="runCommitChecks"/, '失败行上那把刷新按钮')
  assert.match(panel, /:title="RERUN_CHECKS_TOOLTIP"/, '刷新按钮的提示 = tooltip.rerun.commit.checks')
  assert.match(panel, /setStatusText\(RUNNING_CHECKS_TEXT, null\)/, '跑检查时状态栏要说正在运行提交检查…')
  assert.match(panel, /const checksSkipped = computed\(\(\) => checksFailures\.value\.length > 0\)/, 'willSkipCommitChecks 的等价物')
  assert.match(panel, /checksSkipped\.value \? null : await collectCommitChecks\(\)/, '检查已失败 ⇒ 提交时跳过检查（仍然提交）')
  assert.match(panel, /commitAnywayLabel\(\)/, '按钮文案走 action.commit.anyway.text')
  assert.match(panel, /emit\('notify', checksFailedTitle\(\), true, undefined, report\.failures, actions\)/, '通知标题 = {0} 检查失败（并带上动作）')
  assert.match(panel, /\{ label: SHOW_DETAILS_TEXT, run: \(\) => props\.showToolWindow\?\.\('git'\) \}/,
    '「显示详细信息」= 激活提交工具窗口（上游 showCommitCheckFailuresPanel）')
  assert.match(panel, /if \(commitActions\) actions\.push\(\{ label: commitAnywayLabel\(\), run: \(\) => commit\(\) \}\)/,
    '提交路径那条通知再加「仍然提交」（上游 commit.checks.failed.notification.commit.anyway.action）')
  assert.match(panel, /await confirmSaveDuringCommit\(stagedPaths\)/, '提交前要问"要不要立即保存"')
  assert.match(panel, /saveDuringCommitQuestion\(unsaved\)/, '问句来自纯模块')

  const context = read('src/toolViewContext.ts')
  assert.match(context, /dirtyPaths: \(\) => dirtyPaths\(\)/, '宿主把"哪些没保存"传进 ctx')
  assert.match(read('src/App.vue'), /dirtyPaths: \(\) => allTabs\.value\.filter\(tab => tab\.dirty\)/, 'App 侧的来源是编辑器标签')
  assert.match(read('src/components/ToolWindowView.vue'), /:dirty-paths="ctx\.dirtyPaths" :save-path="ctx\.savePath"/, '面板要拿到这两条通道')
})

test('面板的通知真的接得到宿主（此前 @notify 没绑 ⇒ 通知被静默丢掉）', () => {
  const view = read('src/components/ToolWindowView.vue')
  assert.match(view, /@notify="ctx\.notifyFromPanel"/, 'SourceControl 的 notify 要绑到 ctx 上')
  assert.match(read('src/toolViewContext.ts'), /notifyFromPanel, showToolWindow,/, 'ctx 要有这两条通道')
  assert.match(read('src/App.vue'), /notify, notifyFromPanel, showToolWindow: \(id: string\) => showView/, 'App 把 showView 接成 showToolWindow')
  const notices = read('src/notifications.ts')
  assert.match(notices, /function notifyFromPanel\(message: string, error = false, displayId\?: string, detail\?: string\[\], actions\?: NoticeAction\[\]\)/,
    'notifyFromPanel 收面板那五个参数')
  assert.match(notices, /notify\(message, error, undefined, detail, displayId, actions\)/, '按 notify 的形参顺序转过去')
})
