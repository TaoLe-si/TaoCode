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
  TODO_ITEMS_FOUND, REVIEW_TODO_ACTION,
  checksFailedTitle, commitAnywayLabel, commitCheckReport, failuresRowText, failureTexts, saveDuringCommitQuestion } from '../src/commitChecks.ts'

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
      { kind: 'subject', line: 0, start: 9, end: 12, message: '主题不能超过 72 个字符', fixes: ['reformat'] },
      { kind: 'separation', line: 1, start: 0, end: 0, message: '主题与正文之间缺少空行', fixes: ['blankLine'] },
    ],
    unsaved: ['src/a.ts'],
  })
  assert.equal(report.ok, false)
  assert.equal(report.blockMessage, '', '信息/暂存都在 ⇒ 错误行不该有内容')
  assert.equal(report.failures.length, 3, 'TODO 一条 + 信息两条')
  assert.match(failureTexts(report.failures)[0], /^3 个 TODO$/, 'label.todo.items.found = {0} 个 TODO（不是自造的"处 TODO/FIXME（全工作区扫描）"）')
  assert.match(failureTexts(report.failures)[1], /^提交信息：主题不能超过/)
  assert.deepEqual(report.unsaved, ['src/a.ts'], '未保存单独一档')
  assert.match(failuresRowText(report.failures), /3 个 TODO.*主题不能超过.*缺少空行/)
})

test('failure 带详情动作：TODO 那一条是 CommitProblemWithDetails，信息那两条不是', () => {
  // `TodoCommitProblem : CommitProblemWithDetails`（TodoCheckinHandler.kt:50-63）—— 它的
  // `showDetailsLink` 用的是默认的 null（CommitCheck.kt:166），所以上游把**整条文字**渲染成链接
  // （CommitProgressPanel.kt:456-458）。文案/动作名取中文包：
  // `label.todo.items.found` = {0} 个 TODO、`todo.in.new.review.button` = 审查 TODO(_R)。
  assert.equal(TODO_ITEMS_FOUND(3), '3 个 TODO')
  assert.equal(REVIEW_TODO_ACTION, '审查 TODO(R)')
  const report = commitCheckReport({
    ...base, todoHits: 3,
    messageProblems: [{ kind: 'subject', line: 0, start: 9, end: 12, message: '主题不能超过 72 个字符', fixes: ['reformat'] }],
  })
  assert.equal(report.failures[0].details, REVIEW_TODO_ACTION, 'TODO 那一条有详情动作 ⇒ 文字本身就是链接')
  assert.equal(report.failures[1].details, null, '提交信息检查在上游是消息编辑器里的 inspection（BaseCommitMessageInspection.kt:46,97），不是 CommitCheck ⇒ 纯文本那一档，不编详情动作')
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
  // 这一族已从面板按行号切片拆进 src/sourceControlCommitChecks.ts（模块化拆分，行为逐字未改），两处都读。
  const panel = read('src/components/SourceControl.vue') + read('src/sourceControlCommitChecks.ts')
  assert.match(panel, /async function collectCommitChecks\(withBlockReason = true, skip: CommitChecksSkip = skipFromState\(\)\)/, '检查链的单一入口（提交后那一轮不带空判，见 commitOptions）')
  // 定义一处 + 四条调用路：失败行那把刷新按钮 / 提交后那一轮（runPostCommitChecks） /
  // 提交那一轮的两条分支（「慢检查推后」开着与关着 —— 开着时**两条检查不跑但空判照跑**，
  // `NonModalCommitWorkflowHandler.kt:177-184` 的 checkCommit() 不是检查、是前置闸）。
  assert.equal((panel.match(/collectCommitChecks\(/g) ?? []).length, 5, '检查链只有这一处定义')
  assert.ok(!panel.includes('sc-checks-button'), '常显按钮是编造的（上游这条动作没有常显入口）—— 必须去掉')
  assert.match(panel, /v-if="checksFailures\.length" class="sc-check-failures"/, '失败行只在有 failure 时出现')
  assert.match(panel, /class="icon-button sc-rerun-checks"[^>]*@click="runCommitChecks"/, '失败行上那把刷新按钮')
  assert.match(panel, /:title="RERUN_CHECKS_TOOLTIP"/, '刷新按钮的提示 = tooltip.rerun.commit.checks')
  assert.match(panel, /setStatusText\(RUNNING_CHECKS_TEXT, null\)/, '跑检查时状态栏要说正在运行提交检查…')
  // `willSkipCommitChecks()`（NonModalCommitWorkflowHandler.kt:229-233）读的是**上次检查的结果**
  // （`isCommitChecksResultUpToDate`，`:83`），不是"失败行现在有没有内容"—— 后者会让改一下提交信息
  // 就把「仍然提交」的名字和那把刷新按钮一起变没（上游 :316-319 的 clearError 只清错误行）。
  assert.match(panel, /const checksSkipped = computed\(\(\) => willSkipCommitChecks\(checksResult\.value\)\)/, 'willSkipCommitChecks 的等价物 = 状态机那一档')
  assert.match(panel, /const report = await runCommitChecksRound\(\)/, '提交那一轮走会话入口（跳过哪些相位由状态折算）')
  assert.match(panel, /beginChecksRound\(false\)/, '会话开头：清失败行 + resetCommitChecksResult（:225 + :342）')
  assert.match(panel, /commitActionText\(\{[^}]*amend: amend\.value, skipChecks: checksSkipped\.value/, '按钮名走 :226-237 那四档（含 amend 两支）')
  assert.match(panel, /emit\('notify', checksFailedTitle\(COMMIT_ACTION_TEXT\), true, undefined, summary \?\? failureTexts\(report\.failures\), actions\)/, '通知标题 = {0} 检查失败（并带上动作；提交后那一轮的正文换成 postCommitCheckFailures）')
  assert.match(panel, /\{ label: SHOW_DETAILS_TEXT, run: \(\) => props\.showToolWindow\?\.\('git'\) \}/,
    '「显示详细信息」= 激活提交工具窗口（上游 showCommitCheckFailuresPanel）')
  assert.match(panel, /if \(commitActions\) actions\.push\(\{ label: commitActionText\(\{ amend: amend\.value, skipChecks: true \}\), run: \(\) => commit\(\) \}\)/,
    '提交路径那条通知再加「仍然{0}」（上游 commit.checks.failed.notification.commit.anyway.action；修正模式下是「仍然修正」）')
  assert.match(panel, /await confirmSaveDuringCommit\(stagedPaths\)/, '提交前要问"要不要立即保存"')
  assert.match(panel, /saveDuringCommitQuestion\(unsaved\)/, '问句来自纯模块')

  const context = read('src/toolViewContext.ts')
  assert.match(context, /dirtyPaths: \(\) => dirtyPaths\(\)/, '宿主把"哪些没保存"传进 ctx')
  assert.match(read('src/App.vue'), /dirtyPaths: \(\) => allTabs\.value\.filter\(tab => tab\.dirty\)/, 'App 侧的来源是编辑器标签')
  assert.match(read('src/components/ToolWindowView.vue'), /:dirty-paths="ctx\.dirtyPaths" :save-path="ctx\.savePath"/, '面板要拿到这两条通道')
})

test('失败行：一条一行，带详情动作的那条整条文字就是链接（上游 showDetailsLink 为 null 的那一档）', () => {
  // 这一族已从面板按行号切片拆进 src/sourceControlCommitChecks.ts（模块化拆分，行为逐字未改），两处都读。
  const panel = read('src/components/SourceControl.vue') + read('src/sourceControlCommitChecks.ts')
  // FailuresPanel 把各条 failure 用 `<br/><br/>` 隔开（CommitProgressPanel.kt:465）⇒ 一条一行。
  assert.match(panel, /<template v-for="\(failure, index\) in checksFailures"/, '失败行按条渲染')
  assert.match(panel, /<br v-if="index" \/>/, '条与条之间换行（上游那个 <br/><br/>）')
  // showDetailsLink == null ⇒ 整条 text 就是链接（CommitProgressPanel.kt:456-458）。
  assert.match(panel, /<button v-if="failure\.details" type="button" class="sc-check-failure-link" :title="failure\.details"/,
    '带详情动作的 failure 渲染成按钮；没有的不渲染（不许给纯文本那一档编链接）')
  assert.match(panel, /<template v-else>\{\{ failure\.text \}\}<\/template>/, '没有详情动作的那几条就是纯文本')
  // 落点：problem.showDetails(project)（NonModalCommitWorkflowHandler.kt:523）。本仓只有 TODO 预检
  // 这一条有详情动作，它的上游落点是 TODO 工具窗口（TodoCheckinHandler.showTodoItems，:144-168）。
  assert.match(panel, /function showFailureDetails\(failure: CommitCheckFailure\) \{\s*if \(failure\.details !== REVIEW_TODO_ACTION\) return\s*props\.showToolWindow\?\.\('todo'\)/,
    '只给 TODO 那一条落点（打开 TODO 工具窗口）；别的 failure 走不到这里，也不给它们编落点')
  assert.match(read('src/style.css'), /\.sc-check-failure-link \{[^}]*color: var\(--accent\)/, '链接那一条要穿链接色（面板里其它内联链接也是 --accent）')
})

test('面板的通知真的接得到宿主（此前 @notify 没绑 ⇒ 通知被静默丢掉）', () => {  const view = read('src/components/ToolWindowView.vue')
  assert.match(view, /@notify="ctx\.notifyFromPanel"/, 'SourceControl 的 notify 要绑到 ctx 上')
  assert.match(read('src/toolViewContext.ts'), /notifyFromPanel, showToolWindow,/, 'ctx 要有这两条通道')
  assert.match(read('src/App.vue'), /notify, notifyFromPanel, showToolWindow: \(id: string\) => showView/, 'App 把 showView 接成 showToolWindow')
  const notices = read('src/notifications.ts')
  assert.match(notices, /function notifyFromPanel\(message: string, error = false, displayId\?: string, detail\?: string\[\], actions\?: NoticeAction\[\]\)/,
    'notifyFromPanel 收面板那五个参数')
  assert.match(notices, /notify\(message, error, undefined, detail, displayId, actions\)/, '按 notify 的形参顺序转过去')
})
