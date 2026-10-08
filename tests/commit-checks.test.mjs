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
  TODO_ITEMS_FOUND, REVIEW_TODO_ACTION, MAX_COMMIT_PATHS, MAX_COMMIT_PATH_LENGTH, commitRequestParams,
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

// ── R1「提交文件…」：请求形状 + native 落点（桶 13 遗留的那一半）──────────────────
// 上游 `CommonCheckinFilesAction.kt:26-78` → `CheckinActionUtil.kt:100-160` 的 `pathsToCommit`：
// 只有被选中的那些变更进这次提交。本仓的落点是 `git commit --only -- <paths>`。
// 三条口径都有人踩过坑，所以逐条钉住：空 = 不发这个键、去重保序、上限与 native 同数。

const commitBase = { message: '做点事', amend: false, signoff: false, author: '', authorEmail: '' }

test('「提交文件…」为空时请求体逐字不变（宿主通道没接之前不多发一个键）', () => {
  assert.deepEqual(commitRequestParams(commitBase), commitBase)
  assert.deepEqual(commitRequestParams({ ...commitBase, paths: [] }), commitBase, 'paths: [] 与不给完全一样')
  assert.deepEqual(commitRequestParams({ ...commitBase, paths: [' ', ''] }), commitBase, '空白项不算一次选择')
  assert.equal('paths' in commitRequestParams({ ...commitBase, paths: [] }), false,
    '空集合时连这个键都不出现（带上也只会被旧宿主忽略 ⇒ 宁可不发）')
})

test('被选路径：去空白、并重复、保顺序（pathsToCommit 的集合语义）', () => {
  assert.deepEqual(commitRequestParams({ ...commitBase, paths: ['b.ts', 'a.ts', 'b.ts'] }).paths, ['b.ts', 'a.ts'],
    '重复项并掉，但**不重排** —— 上游按选中顺序交给 workflowHandler')
  assert.deepEqual(commitRequestParams({ ...commitBase, paths: [' a.ts ', 'a.ts'] }).paths, ['a.ts'],
    '去空白后相同的并成一条')
})

test('所选文件的上限与 native 那一半是同一个数（两边都得拒，且口径一致）', () => {
  assert.equal(MAX_COMMIT_PATHS, 500)
  const many = Array.from({ length: MAX_COMMIT_PATHS + 1 }, (_unused, index) => `f${index}.ts`)
  assert.throws(() => commitRequestParams({ ...commitBase, paths: many }), /500/, '超上限在这里就拒掉')
  const exact = Array.from({ length: MAX_COMMIT_PATHS }, (_unused, index) => `f${index}.ts`)
  assert.equal(commitRequestParams({ ...commitBase, paths: exact }).paths.length, MAX_COMMIT_PATHS,
    '正好到上限的要发出去（上限是"一次最多"，不是"少于"）')
  // native 侧同一档：`paths.size() > 500` ⇒ INVALID_REQUEST，不是让 git 撞死。
  const native = read('native/git.cpp')
  assert.match(native, /if \(paths\.size\(\) > 500\) throw WorkspaceError\("INVALID_REQUEST", "一次最多提交 500 个所选文件。"\);/)
  assert.equal(MAX_COMMIT_PATHS, 500, '前端常量与 native 的字面量必须同一个数')
})

test('落点：--only 只提交被选的那些路径，index 里其它暂存项不动', () => {
  const native = read('native/git.cpp')
  assert.match(native, /const bool scoped = !paths\.empty\(\);/, '非空才是"子集提交"')
  assert.match(native, /if \(scoped\) arguments\.push_back\(L"--only"\);/, '--only 只在有子集时加（整份暂存区那一档逐字沿用旧命令行）')
  assert.match(native, /if \(scoped\) \{ arguments\.push_back\(L"--"\); arguments\.insert\(arguments\.end\(\), specs\.begin\(\), specs\.end\(\)\); \}/,
    'pathspec 放在 `--` 之后：用户给的路径永远不会被 git 当选项读')
  // 只对**未跟踪**的被选项先 add（带 `--`）：实测 `git add -- <已被 git mv 走的旧路径>` 直接
  // `fatal: pathspec … did not match any files`（128，`--ignore-errors` 压不住），整批 add 会把
  // 一次带重命名的子集提交一枪打死；而 `M `/`MM`/`A `/`D ` 四档不 add 也照样提交得动（`--only` 取工作区）。
  assert.match(native, /if \(!to_add\.empty\(\)\) \{\s*std::vector<std::wstring> add\{L"add", L"--"\};/,
    '先 add 的只有未跟踪那几条，且 add 也带 `--`')
  assert.match(native, /if \(untracked\) to_add\.push_back\(utf8_to_wide\(path\)\);/,
    '未跟踪才进 to_add')
  assert.match(native, /if \(!matched\) throw WorkspaceError\("INVALID_REQUEST", "这个路径没有可提交的变更："/,
    '陌生 pathspec 在调 git 之前拒（上游对 `NOT_CHANGED` 那条动作压根不启用）')
  assert.match(native, /"重命名要成对提交："/, '单边重命名被拒（上游一条 ChangedPath 两朵路径）')
  // 每个路径过提交面那道更严的闸（`checked_pathspec`，2026-10-06 partialcommit 起它比
  // `file_history` 用的 `checked_path` 多三条：控制字符 / 绝对路径 / 反斜杠），
  // 非法路径在交给 git 之前就被挡下。
  assert.match(native, /for \(const auto& path : paths\) specs\.push_back\(checked_pathspec\(path\)\);/)
  assert.match(read('native/git.hpp'), /const std::vector<std::string>& paths = std::vector<std::string>\(\)\);/,
    '头里的 paths 是**带默认值**的尾参：既有六参调用点一个字都不用改')
})

test('面板只用一条通道发提交：整份暂存区与被选子集都走 commitRequestParams', () => {
  const panel = read('src/components/SourceControl.vue')
  assert.equal((panel.match(/request\('git\.commit'/g) ?? []).length, 1, 'git.commit 在面板里只有一个调用点')
  assert.match(panel, /await request\('git\.commit', commitRequestParams\(\{/, '请求体由 commitRequestParams 一处生成')
  // 子集不再是"只有宿主能给"的那一条：面板自己的右键菜单（`commitFile`）就是选择来源，
  // 宿主的可选 prop 与它汇在同一个 `commitPathsToCommit` 上，再一起交给请求体。
  assert.match(panel, /paths: commitPathsToCommit\.value, changes: changes\.value,/,
    '被选子集与变更列表一起交给 commitRequestParams（重命名对补齐 + 非法/被忽略判断都要吃列表）')
  assert.match(panel, /const commitPathsToCommit = computed<string\[\]>\(\n\s*\(\) => \(commitSelection\.value \? expandCommitSelection\(commitSelection\.value, changes\.value\) : \[\]\)\)/,
    '子集的唯一来源：选择过 expandCommitSelection（面板自己点的与宿主 prop 都走这一条）')
  assert.match(panel, /commitPaths\?: readonly string\[\]/, '宿主的可选 prop 仍然保留（项目视图多选那一档待接）')
  assert.match(panel, /case 'commitFile': return setCommitScope\(path\)/,
    '右键菜单那一行接的是真动作：设范围，不立刻提交（上游 CheckinFiles 也只是 setCommitState）')
  // 2026-10-06：范围层（选择态 + 一次性收回）整段搬进了 `src/commitScopeSection.ts`，
  // 面板那一头只剩 `clearCommitScope()`（提交成功后调用）。两处都要钉：面板真的调了它，
  // section 里真的把 `scoped.value` 收回 null —— 少任何一半都会「下一次静默沿用上轮的子集」。
  assert.match(panel, /clearCommitScope\(\)/, '范围是一次性的：提交完收回（面板调 clearCommitScope）')
  assert.match(read('src/commitScopeSection.ts'), /clear: \(\) => \{ scoped\.value = null \}/,
    '收回动作的实现在 commitScopeSection：把 scoped 置 null，下一次不静默沿用上轮的子集')
  assert.doesNotMatch(panel, /<button[^>]*>\s*[^<]*提交文件/, '没有把「提交文件…」做成点了没反应的按钮')
})

// ── R1 补完（commit2）：非法 / 被忽略 / 未跟踪的被选项，与 amend、noisy 档共处 ──────
// 四条口径的上游出处写在 src/commitChecks.ts 的注释里（本文件只写落点）：
// 坐标 2026-10-06 partialcommit 逐条重开上游核过（原写 `native/git.cpp:259-265`、
// `CommonCheckinFilesAction.kt:74-78`、`CheckinActionUtil.kt:159-167` 三处是抄虚的，见下面的订正）：
//   · 单条路径的合法性 = native 那道闸先在前端跑一遍（提交面用更严的 `checked_pathspec`，
//     它 = `checked_path` 那五道 + "仓库相对的 POSIX 写法"，三条新增各有实测）；
//   · 目录与其子项同时选中**不并掉**：`DescindingFilesFilter.java:27-69` 在 `:36-39` 先问
//     `allowsNestedRoots`，而 `GitVcs.java:260-263` 对 git 答 true；
//   · 被忽略（noisy）的被选项 ⇒ 拒绝：`CommonCheckinFilesAction.kt:75-78`（`isActionEnabled` 的
//     函数头在 `:75`，`:74` 是 `@ApiStatus.Internal`）要 `status != FileStatus.IGNORED`；
//   · 未跟踪的被选项 ⇒ 明确纳入：`CheckinActionUtil.kt:104-105` + 同文件 `getIncludedChanges`
//     整体 `:153-167`（原写 `:159-167` 少看了函数头）把 `selectedUnversioned` 并进"这次包含的变更"；
//   · 重命名对 ⇒ 两朵路径一起给：`GitCheckinEnvironment.kt:403-404` 一条 `ChangedPath` 同时产出
//     toCommitAdded（afterPath）与 toCommitRemoved（beforePath）。

const rowOf = (path, extra = {}) => ({ path, untracked: false, ...extra })

test('非法的被选项在交给宿主之前就拒掉：- 前缀 / .. / 换行 / 超长（与 native 同一道闸）', () => {
  assert.equal(MAX_COMMIT_PATH_LENGTH, 512, '长度上限与 native 的字面量必须同一个数')
  assert.throws(() => commitRequestParams({ ...commitBase, paths: ['-rf.txt'] }), /不合法/,
    '以 - 开头的路径会被 git 当选项读 ⇒ 前端先挡')
  assert.throws(() => commitRequestParams({ ...commitBase, paths: ['../outside.txt'] }), /不合法/,
    '含 .. 的路径出了仓库根')
  assert.throws(() => commitRequestParams({ ...commitBase, paths: ['a.ts\nb.ts'] }), /不合法/, '含换行的不是一个路径')
  assert.throws(() => commitRequestParams({ ...commitBase, paths: ['x'.repeat(513) + '.ts'] }), /过长/,
    '超长的单独一种原因')
  // 哪一条坏的要写在消息里（拒绝要说清楚拒了谁）。
  assert.throws(() => commitRequestParams({ ...commitBase, paths: ['ok.ts', '../bad.ts'] }), /\.\.\/bad\.ts/,
    '消息里点出那条非法的')
  assert.deepEqual(commitRequestParams({ ...commitBase, paths: ['src/a.ts', 'README.md'] }).paths, ['src/a.ts', 'README.md'],
    '合法的一条都不掉')
  // native 那一半同一道闸（逐条对照的锚点，别改这道闸的条件而不动前端）。
  const gate = read('native/git.cpp')
  assert.match(gate, /if \(path\.empty\(\) \|\| path\.size\(\) > 512 \|\| path\.front\(\) == '-' \|\|\n/)
  assert.match(gate, /path\.find\("\.\."\)/, '含 .. 的那一条（native 写成字面量 ".."）')
  assert.match(gate, /throw WorkspaceError\("INVALID_REQUEST", "文件路径不合法。"\);/, '同一道闸、同一个错误码')
  // 提交面用的是**更严的那一道**（`checked_pathspec` = `checked_path` 之上再加"仓库相对的 POSIX 写法"）：
  // 三条新增各自对应一条实测（仓内绝对路径能被 git 接受、`sub\x.txt` 只会报"没有这个文件"、
  // NUL 到 git 那一头把 argv 截断）。`file_history` 那一条仍走宽的 `checked_path`。
  assert.match(gate, /for \(const auto& path : paths\) specs\.push_back\(checked_pathspec\(path\)\);/,
    '被选的每一条路径都过这道闸')
  assert.match(gate, /static_cast<unsigned char>\(character\) < 0x20 \|\| character == '\\\\'\)/,
    '控制字符与反斜杠在这一道被拒')
  assert.match(gate, /if \(path\.front\(\) == '\/'\) throw WorkspaceError\("INVALID_REQUEST", "提交路径不能是绝对路径。"\);/,
    '绝对路径在这一道被拒')
  assert.match(gate, /path\[1\] == ':'/, '带盘符的路径在这一道被拒')
})

test('被忽略（noisy）的被选项：明确拒绝；宿主没给变更列表时不误拒（形状与本批之前逐字一致）', () => {
  const rows = [rowOf('a.ts'), rowOf('build/x.js', { ignored: true })]
  assert.throws(() => commitRequestParams({ ...commitBase, paths: ['build/x.js'], changes: rows }), /被忽略/,
    '「显示忽略的文件」开着时列出来的那些不能因为一次多选就进提交')
  assert.deepEqual(commitRequestParams({ ...commitBase, paths: ['a.ts'], changes: rows }).paths, ['a.ts'],
    '正常变更照发')
  assert.deepEqual(commitRequestParams({ ...commitBase, paths: ['build/x.js'] }).paths, ['build/x.js'],
    '没给 changes（宿主通道未接）⇒ 不做这一档判断，宁可不拒也不误拒')
  assert.deepEqual(commitRequestParams({ ...commitBase, paths: [], changes: rows }), commitBase,
    '给了变更列表也不改变「空 = 全量」这一条：连 paths 键都不出现')
})

test('未跟踪的被选项：明确纳入而不是拒绝（上游 selectedUnversioned 进 included）', () => {
  const rows = [rowOf('new.ts', { untracked: true }), rowOf('m.ts')]
  assert.deepEqual(commitRequestParams({ ...commitBase, paths: ['new.ts'], changes: rows }).paths, ['new.ts'],
    '未跟踪 = 新文件，是这次提交的一部分')
  assert.deepEqual(commitRequestParams({ ...commitBase, paths: ['m.ts', 'new.ts'], changes: rows }).paths, ['m.ts', 'new.ts'],
    '混着选也按选中顺序原样发（native 先对这批 add，再 --only 提交）')
  // native 那一半：先只对被选路径 add（带 --），未跟踪的才进得了 pathspec。
  assert.match(read('native/git.cpp'), /const bool scoped = !paths\.empty\(\);/)
})

test('选中目录与它的子项一起给 ⇒ 两条都留（git 允许嵌套根，上游不折叠后代）', () => {
  const rows = [rowOf('src/a.ts'), rowOf('src/deep/b.ts')]
  assert.deepEqual(commitRequestParams({ ...commitBase, paths: ['src', 'src/a.ts'], changes: rows }).paths,
    ['src', 'src/a.ts'], '不把 src/a.ts 并进 src —— 上游对 git 一个都不并（allowsNestedRoots = true）')
  assert.deepEqual(commitRequestParams({ ...commitBase, paths: ['src'], changes: rows }).paths, ['src'],
    '目录本身对得上它下面的变更行，不算"没有可提交的变更"')
  assert.throws(() => commitRequestParams({ ...commitBase, paths: ['ghost.ts'], changes: rows }), /没有可提交的变更/,
    '对不上任何变更 = 上游那条 status == NOT_CHANGED，这个动作压根不启用')
  assert.equal('paths' in commitRequestParams({ ...commitBase, paths: ['src'] }), true,
    '没给 changes 时目录也照样发（git 的 pathspec 认目录）')
})

test('paths 与既有字段共处：amend / signoff / author 那五个老键一个字没变', () => {
  const full = { message: '做点事', amend: true, signoff: true, author: 'Tao', authorEmail: 't@example.com' }
  assert.deepEqual(commitRequestParams({ ...full, paths: ['a.ts', 'b.ts'] }),
    { ...full, paths: ['a.ts', 'b.ts'] }, '多出来的只有 paths 这一个键')
  assert.deepEqual(commitRequestParams({ ...full, paths: [] }), full,
    '空选择 + amend ⇒ 逐字沿用旧请求体（修正提交走整份暂存区）')
  assert.deepEqual(commitRequestParams({ ...full }), full, '连这个键都不给时形状不变')
  // native 那一半：--amend 与 --only 是两条独立开关，同时给就同时进命令行。
  assert.match(read('native/git.cpp'),
    /if \(amend\) arguments\.push_back\(L"--amend"\);\n    if \(scoped\) arguments\.push_back\(L"--only"\);/,
    'amend 与子集提交互不遮挡')
})
