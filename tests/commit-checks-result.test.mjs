// 提交检查「上次结果」状态机 + 提交按钮四档 + 进度行步名（桶 13c）。
//
// 上游（`platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt`）：
//   · `:667` `enum class RecentCommitChecks { UNKNOWN, PASSED, EARLY_FAILED, MODIFICATIONS_FAILED,
//     POST_FAILED, FAILED, SMART_MODE_REQUIRED }`
//   · `:229-243` 四个 `willSkip*` 谓词；`:246-249` `resetCommitChecksResult()`；
//   · `:191-226` 只有"影响检查结果的文件"变了才 reset（被忽略的不算、已经是 UNKNOWN 就早退）；
//   · `:337-342` 会话开头 reset + `skip* = !isOnlyRunCommitChecks && willSkip*()`；
//   · `:533-557` 结果落档（只跑检查且过了 = PASSED，提交路径且过了 = UNKNOWN，ABORTED/ERROR = FAILED）。
// 按钮四档在 `AbstractCommitWorkflowHandler.kt:226-237`；进度行两档正文与带上下文那一档在
// `CommitChecksProgressIndicator.kt:122-134` + `VcsBundle.properties:21-24`（中文包取值逐条对过）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  checksResultAfter, commitChecksFingerprint, commitChecksShouldReset, resetCommitChecks,
  willSkipCommitChecks, willSkipEarlyCommitChecks, willSkipModificationCommitChecks, willSkipPostCommitChecks,
} from '../src/commitChecksResult.ts'
import {
  AMEND_ANYWAY_TEXT, CHECKS_STEP_MESSAGE, CHECKS_STEP_TODO, COMMIT_ACTION_TEXT, COMMITTING_TEXT,
  POST_CHECKS_PROGRESS_TEXT, PROGRESS_PRESENTATION_DELAY_MS, RUNNING_CHECKS_TEXT, RUNNING_CHECKS_WITH_CONTEXT,
  amendActionText, checksProgress, checksProgressShown, commitActionText, commitAnywayLabel, commitAndPushText,
} from '../src/commitChecks.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

// —— 四个跳过谓词（:229-243）——

test('willSkipCommitChecks：三档失败才跳，PASSED / FAILED / UNKNOWN 都不跳', () => {
  assert.equal(willSkipCommitChecks('earlyFailed'), true)
  assert.equal(willSkipCommitChecks('modificationsFailed'), true)
  assert.equal(willSkipCommitChecks('postFailed'), true)
  assert.equal(willSkipCommitChecks('passed'), false, '检查过了不代表可以不跑 —— 上游只把三档 FAILED 列进去')
  assert.equal(willSkipCommitChecks('failed'), false, '出错不等于失败：下一次提交要重新跑')
  assert.equal(willSkipCommitChecks('unknown'), false)
  assert.equal(willSkipCommitChecks('unknown', true), true, 'smartChecksWereBlocked 是这一档的第四个条件（:233）')
})

test('早相位失败 ⇒ 连提交信息检查都不重跑，但 TODO 那条还没跑过（:234-239）', () => {
  assert.equal(willSkipEarlyCommitChecks('earlyFailed'), true)
  assert.equal(willSkipEarlyCommitChecks('modificationsFailed'), true)
  assert.equal(willSkipEarlyCommitChecks('postFailed'), true)
  assert.equal(willSkipEarlyCommitChecks('passed'), false)
  // 这一条是关键：EARLY_FAILED 时 MODIFICATION 档还没轮到跑 ⇒ 不能跳。
  assert.equal(willSkipModificationCommitChecks('earlyFailed'), false, '上游的 willSkipModificationCommitChecks 里没有 EARLY_FAILED')
  assert.equal(willSkipModificationCommitChecks('modificationsFailed'), true)
  assert.equal(willSkipModificationCommitChecks('postFailed'), true)
  assert.equal(willSkipModificationCommitChecks('unknown'), false)
})

test('提交后那一轮只在它自己失败过时才跳（:243）', () => {
  assert.equal(willSkipPostCommitChecks('postFailed'), true)
  for (const state of ['earlyFailed', 'modificationsFailed', 'passed', 'failed', 'unknown']) {
    assert.equal(willSkipPostCommitChecks(state), false, `${state} 不构成"提交后检查已经报过"`)
  }
})

test('reset 就是回 UNKNOWN，而且已经 UNKNOWN 时早退（:246-249 + :202/:218）', () => {
  assert.equal(resetCommitChecks(), 'unknown')
  assert.equal(commitChecksShouldReset('earlyFailed'), true)
  assert.equal(commitChecksShouldReset('unknown'), false, '已经是 UNKNOWN 就不再动状态（上游那里也就不再藏通知）')
})

// —— 结果落档（:533-557）——

test('落档：只跑检查且过了 = PASSED，提交路径且过了 = UNKNOWN', () => {
  assert.equal(checksResultAfter({ failures: [], onlyRunChecks: true }), 'passed')
  assert.equal(checksResultAfter({ failures: [], onlyRunChecks: false }), 'unknown',
    '上游 :543 的注释：We are going to commit, remembering the result is not needed.')
})

test('落档：按最早失败的相位，提交后那一轮归 POST_FAILED', () => {
  assert.equal(checksResultAfter({ failures: [{ phase: 'early' }], onlyRunChecks: false }), 'earlyFailed')
  assert.equal(checksResultAfter({ failures: [{ phase: 'modifications' }], onlyRunChecks: false }), 'modificationsFailed')
  assert.equal(checksResultAfter({ failures: [{ phase: 'modifications' }, { phase: 'early' }], onlyRunChecks: false }), 'earlyFailed',
    '两档都报 ⇒ 上游是分相位顺序跑的，先撞的是 EARLY')
  assert.equal(checksResultAfter({ failures: [{ phase: 'modifications' }], onlyRunChecks: false, postRound: true }), 'postFailed')
  assert.equal(checksResultAfter({ failures: [{ phase: 'early' }], onlyRunChecks: true, error: true }), 'failed',
    'ABORTED / ERROR ⇒ FAILED（:558-560），抛错时不看失败列表')
})

// —— 指纹：什么才算"影响检查结果的文件变了"（:191-226）——

const row = (path, extra = {}) => ({ path, indexStatus: 'M', workStatus: '', staged: false, untracked: false, ...extra })

test('指纹数的是"哪些文件、什么状态"，不是条数', () => {
  const before = commitChecksFingerprint([row('a.ts'), row('b.ts')])
  assert.notEqual(before, commitChecksFingerprint([row('a.ts')]), '少了一个文件 ⇒ 变')
  assert.notEqual(before, commitChecksFingerprint([row('a.ts'), row('c.ts')]), '换了个文件 ⇒ 变')
  assert.notEqual(before, commitChecksFingerprint([row('a.ts', { workStatus: 'D' }), row('b.ts')]),
    '同样两个文件、但工作区状态从空变成 D ⇒ 也要算变（上一版只数条数，这一种漏了）')
  assert.equal(before, commitChecksFingerprint([row('b.ts'), row('a.ts')]), '顺序不算变化')
})

test('暂存与未暂存分开算，被忽略的行不参与（:212 排除 FileStatus.IGNORED）', () => {
  assert.notEqual(commitChecksFingerprint([row('a.ts')]), commitChecksFingerprint([row('a.ts', { staged: true })]))
  assert.equal(commitChecksFingerprint([row('a.ts'), row('build/x.js', { ignored: true })]),
    commitChecksFingerprint([row('a.ts')]), '被忽略的文件不算"影响检查结果"')
})

test('未保存清单进指纹：上游的第二个 listener 是 documentChanged（:216-225）', () => {
  assert.notEqual(commitChecksFingerprint([row('a.ts')], []), commitChecksFingerprint([row('a.ts')], ['a.ts']),
    '编辑器里出现未保存的改动 ⇒ 状态要作废')
  assert.equal(commitChecksFingerprint([row('a.ts')], ['a.ts', 'b.ts']), commitChecksFingerprint([row('a.ts')], ['b.ts', 'a.ts']))
})

// —— 提交按钮四档（AbstractCommitWorkflowHandler.kt:226-237）——

test('按钮名四档取中文包原文：提交 / 仍然提交 / 修正提交 / 仍然修正', () => {
  assert.equal(commitActionText({ amend: false, skipChecks: false }), COMMIT_ACTION_TEXT)
  assert.equal(commitActionText({ amend: false, skipChecks: true }), commitAnywayLabel())
  assert.equal(commitActionText({ amend: false, skipChecks: true }), '仍然提交')
  assert.equal(commitActionText({ amend: true, skipChecks: false }), amendActionText())
  assert.equal(commitActionText({ amend: true, skipChecks: false }), '修正提交', 'amend.action.name = 修正{0}')
  assert.equal(commitActionText({ amend: true, skipChecks: true }), AMEND_ANYWAY_TEXT)
  assert.equal(AMEND_ANYWAY_TEXT, '仍然修正', 'action.amend.commit.anyway.text —— 上游这条不带 {0}')
})

test('第二把按钮（提交并推送）同样四档，DvcsBundle 原文（CommitAndPushExecutor.kt:9-19）', () => {
  assert.equal(commitAndPushText({ amend: false, skipChecks: false }), '提交并推送(P)…', 'action.commit.and.push.text')
  assert.equal(commitAndPushText({ amend: false, skipChecks: true }), '仍然提交并推送(P)…', 'action.commit.anyway.and.push.text')
  assert.equal(commitAndPushText({ amend: true, skipChecks: false }), '修正提交并推送(P)…', 'action.amend.commit.and.push.text')
  assert.equal(commitAndPushText({ amend: true, skipChecks: true }), '仍然修正并推送(P)…', 'action.amend.commit.anyway.and.push.text')
})

test('进度行的可见性三条判据，缺一条都不挂（CommitProgressPanel.kt:163-175）', () => {
  assert.equal(checksProgressShown(true, false, true), true, '在跑 + 失败行为空 + 延迟已过')
  assert.equal(checksProgressShown(false, false, true), false, '任务停了就不该留行')
  assert.equal(checksProgressShown(true, true, true), false, '失败行有内容时上游把指示器收掉（:257-260）')
  assert.equal(checksProgressShown(true, false, false), false, '300ms 还没到 ⇒ 一闪而过的任务不显示')
  assert.equal(PROGRESS_PRESENTATION_DELAY_MS, 300, 'ProgressUIUtil.kt:8 的 DEFAULT_PROGRESS_DELAY_MILLIS = 300L')
})

// —— 进度行的两档正文 + 步名（CommitChecksProgressIndicator.kt:122-134）——
test('提交路径那一轮用自己的正文，只跑检查那一轮用另一条', () => {
  assert.equal(checksProgress(false, null).text, COMMITTING_TEXT, 'commit.checks.on.commit.progress.text')
  assert.equal(checksProgress(true, null).text, RUNNING_CHECKS_TEXT, 'commit.checks.only.progress.text')
  assert.equal(checksProgress(true, CHECKS_STEP_TODO).text, `${RUNNING_CHECKS_WITH_CONTEXT}: TODO 检查`,
    'commit.checks.only.progress.text.with.context = 正在运行提交检查: {0}')
  assert.equal(checksProgress(false, CHECKS_STEP_TODO).text, '正在提交: TODO 检查')
})

test('步名是面板里已有的说法，不是又编一套（本仓选择，见 commitChecks.ts 注释）', () => {
  assert.equal(CHECKS_STEP_MESSAGE, '提交信息检查')
  assert.equal(CHECKS_STEP_TODO, 'TODO 检查')
  assert.equal(POST_CHECKS_PROGRESS_TEXT, '正在检查提交中的文件', 'post.commit.checks.progress.text（中文包）')
})

test('提交后那一轮的副文本走 detail，并且双省略号规则真的接上了（:71-86）', () => {
  const post = checksProgress(false, null, true, true, POST_CHECKS_PROGRESS_TEXT)
  assert.equal(post.detail, POST_CHECKS_PROGRESS_TEXT)
  assert.equal(post.text, COMMITTING_TEXT, '副文本不以省略号开头 ⇒ 正文不动')
  const doubled = checksProgress(true, null, true, true, '…正在导入')
  assert.equal(doubled.text, '正在运行提交检查', '正文尾省略号 + 副文本头省略号 ⇒ 去掉正文那个')
})

// —— 接线 ——

test('接线：跳过与否、reset 时机、相位跳过都走状态机', () => {
  const panel = read('src/components/SourceControl.vue') + read('src/sourceControlCommitChecks.ts')
  assert.match(panel, /const checksSkipped = computed\(\(\) => willSkipCommitChecks\(checksResult\.value\)\)/)
  assert.match(panel, /watch\(\(\) => commitChecksFingerprint\(changes\.value, dirtyPaths\(\)\)/, 'reset 的触发条件 = 变更集指纹')
  assert.match(panel, /if \(commitChecksShouldReset\(checksResult\.value\)\) checksResult\.value = resetCommitChecks\(\)/)
  assert.match(panel, /watch\(message, \(\) => \{ commitCheckError\.value = '' \}\)/,
    '上游 clearError()（:316-319）只清错误行；失败行要等下一轮开始才清（:221-227）')
  assert.match(panel, /if \(checkTodoBeforeCommit\.value && !skip\.modifications\)/, 'TODO 预检归 MODIFICATION 档')
  assert.match(panel, /const problems = skip\.early \? \[\] : messageProblems\.value/, '提交信息检查归 EARLY 档')
  assert.match(panel, /collectCommitChecks\(true, \{ early: false, modifications: false \}\)/,
    '「运行提交检查」那条路一条相位都不跳（:337-340 的 !isOnlyRunCommitChecks 前缀）')
  assert.match(panel, /if \(willSkipPostCommitChecks\(checksResult\.value\)\) return/, '提交后那一轮的跳过条件')
  assert.match(panel, /checksResult\.value = checksResultAfter\(\{/, '结果落地就落档（:533-557）')
  // 状态机是唯一的跳过来源：面板里不该再有人拿"失败行有没有内容"当**跳过**的判据
  // （`checksProgressShown` 那一处是"行该不该挂"，跟跳过无关，所以只禁这一种写法）。
  assert.doesNotMatch(panel, /computed\(\(\) => checksFailures\.value\.length > 0\)/, '旧写法（跳过与否看失败行）必须没有残留')
  assert.match(panel, /startChecksDelay\(\)/, '延迟到点的定时器由会话开头起（:165 的 debounce）')
  assert.match(panel, /setTimeout\(\(\) => \{ checksRowShown\.value = true \}, PROGRESS_PRESENTATION_DELAY_MS\)/,
    '延迟时长走常量，不写死数字')
  assert.match(panel, /onScopeDispose\(stopChecksDelay\)/, '组件卸载要收掉那个定时器')
  assert.match(panel, /commitAndPushLabel = computed\(\(\) => commitAndPushText\(\{ amend: amend\.value, skipChecks: checksSkipped\.value \}\)\)/,
    '第二把按钮同样四档（CommitAndPushExecutor.kt:9-19）')
  assert.match(read('src/components/SourceControl.vue'), /:title="`\$\{commitAndPushLabel\}（Ctrl\+Shift\+Enter）`" @click="commitAndPush">\{\{ commitAndPushLabel \}\}/,
    '按钮上显示的就是那一档文案，不再写死「提交并推送(P)」')
})

test('宿主把整份变更列表交给检查那一族（指纹要看未暂存的那一半）', () => {
  const panel = read('src/components/SourceControl.vue')
  assert.match(panel, /props, emit, act, commit, staged, changes, message, amend/, 'createCommitChecks 要拿到 changes')
})
