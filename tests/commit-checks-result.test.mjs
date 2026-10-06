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

// R2：documentChanged 每敲一次都触发（`NonModalCommitWorkflowHandler.kt:216-225` 那个 listener），
// 而本仓的 `dirtyPaths` 只是一份"哪些标签是脏的"快照 ⇒ 第二次键入清单不变、指纹不变、
// 上一次的 PASSED 就永远不作废。第三个入参是宿主的**文档修订计数**，把"内容又变了"这件事带进来。
test('文档修订号进指纹：第二次键入也要让上一次结果作废（R2）', () => {
  assert.notEqual(commitChecksFingerprint([row('a.ts')], ['a.ts'], 1), commitChecksFingerprint([row('a.ts')], ['a.ts'], 2),
    '未保存清单一个字没变、但内容又改了一次 ⇒ 指纹必须变')
  assert.equal(commitChecksFingerprint([row('a.ts')], ['a.ts'], 7), commitChecksFingerprint([row('a.ts')], ['a.ts'], 7),
    '没再编辑 ⇒ 修订号不变 ⇒ 指纹不变（不许每拍都作废）')
  // 宿主还没接这一档时（W2）传 null ⇒ 形状与两参时代**逐字相同**，行为不许先变。
  assert.equal(commitChecksFingerprint([row('a.ts')], ['a.ts'], null), commitChecksFingerprint([row('a.ts')], ['a.ts']))
  assert.ok(!commitChecksFingerprint([row('a.ts')], [], null).includes('@'), 'null ⇒ 尾部不出现修订段')
  // 修订段只加在最末尾 ⇒ 前面"变更集#未保存清单"那两半的形状不受影响（顺序钉死）。
  assert.equal(commitChecksFingerprint([row('a.ts')], ['b.ts'], 3), `${commitChecksFingerprint([row('a.ts')], ['b.ts'])}@3`)
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
  // 留痕（R2 / commit2）：这一条原本钉的是**三参**调用形状（`… : null)`）。第四档"按篇的文档修订号"
  // 是 R2 派单要求补的入参，所以入参个数必然变；断言语义（reset 由变更集指纹驱动、宿主没接时给 null）
  // 一个字没减，反而多钉了"没接时第四档必须是空数组而不是编一个号" ⇒ 只会更严，不算放松。
  assert.match(panel, /watch\(\(\) => commitChecksFingerprint\(changes\.value, dirtyPaths\(\), editorEpoch \? editorEpoch\(\) : null,\n {38}documentRevisions \? documentRevisions\(\) : \[\]\)/,
    'reset 的触发条件 = 变更集指纹（第三个参数是宿主的文档修订计数，没接线时为 null；第四个是按篇的修订号，没接线时是空数组）')
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

// R2 的接线形状：这一档**必须**是可选的 —— 宿主（App.vue）还没把编辑器计数传进来之前，
// 面板里不能有人替它编一个常数（那会让指纹每拍都变、检查被反复作废）。
test('接线：宿主的修订号只在真的给了才进 deps（没给 = 逐字旧形状）', () => {
  const panel = read('src/components/SourceControl.vue')
  assert.match(panel, /editorEpoch\?: number/, '面板声明的是可选 prop：宿主没接之前恒为 undefined')
  assert.match(panel, /\.\.\.\(props\.editorEpoch === undefined \? \{\} : \{ editorEpoch: \(\) => props\.editorEpoch \?\? 0 \}\)/,
    '没给就整个键都不进 deps，而不是塞一个 0')
  const host = read('src/sourceControlCommitChecks.ts')
  assert.match(host, /editorEpoch\?: \(\) => number/, '检查宿主的入参同样是可选的')
  assert.match(host, /dirtyPaths\(\), editorEpoch \? editorEpoch\(\) : null/, 'deps 没给 ⇒ 交给指纹的是 null')
  assert.doesNotMatch(host, /editorEpoch: \(\) => 0/, '不许在检查宿主里替编辑器编一个常数修订号')
})

test('宿主把整份变更列表交给检查那一族（指纹要看未暂存的那一半）', () => {
  const panel = read('src/components/SourceControl.vue')
  assert.match(panel, /props, emit, act, commit, staged, changes, message, amend/, 'createCommitChecks 要拿到 changes')
})

// ── R2（commit2）：指纹改用**每篇文档的修订号** ──────────────────────────────────
// 上游真身是 `Document.getModificationStamp()`（Document.java:184-192；每次文本变更换个新号，
// DocumentImpl.java:171 + DocumentModStamp.java:6-12），提交检查那一支由 documentChanged 作废
// （NonModalCommitWorkflowHandler.kt:215-226），并且先问"这篇文件影不影响检查结果"（:191-200）。
// 本仓的两个既有代理各有漏判：`dirtyPaths` 是快照（同一篇第二次编辑清单不变），
// `editorEpoch` 是全局计数（别的文档动一下也算）。第四个入参按篇给号，两条都补上。

const rev = (path, revision) => ({ path, revision })
const fp2 = (rows, unsaved = [], epoch = null, revisions = []) => commitChecksFingerprint(rows, unsaved, epoch, revisions)

test('每篇文档的修订号：同一篇改两次 ⇒ 指纹不同，没改 ⇒ 逐字相同（R2 判据）', () => {
  const rows = [row('a.ts'), row('b.ts')]
  assert.equal(fp2(rows, [], null, [rev('a.ts', 5)]), fp2(rows, [], null, [rev('a.ts', 5)]),
    '没再编辑 ⇒ 号不动 ⇒ 指纹不动（不许每拍都作废）')
  assert.notEqual(fp2(rows, [], null, [rev('a.ts', 5)]), fp2(rows, [], null, [rev('a.ts', 6)]),
    '同一篇的第二次编辑：未保存清单一个字没变，指纹也必须变（上一版的 dirtyPaths 漏的就是这一口）')
  assert.notEqual(fp2(rows, [], null, [rev('a.ts', 100)]), fp2(rows, [], null, [rev('a.ts', 9_999)]),
    '号不必"递增 1"，换了就算（上游 next() 给的是 LocalTimeCounter）')
  assert.equal(fp2(rows, [], null, [rev('a.ts', 5), rev('b.ts', 8)]), fp2(rows, [], null, [rev('b.ts', 8), rev('a.ts', 5)]),
    '两篇的先后顺序不算变化')
  assert.notEqual(fp2(rows, [], null, [rev('a.ts', 5), rev('b.ts', 8)]), fp2(rows, [], null, [rev('a.ts', 5), rev('b.ts', 9)]),
    '另一篇也各算各的号')
})

test('修订号只认"会影响检查结果"的那些文件（:191-200 那道筛）', () => {
  const rows = [row('a.ts'), row('b.ts')]
  assert.equal(fp2(rows, [], null, [rev('ghost.ts', 42)]), fp2(rows, [], null, []),
    '不在变更列表里的文档动了 ⇒ 不算这次变更集变了（全局计数 editorEpoch 会误判的就是这一种）')
  assert.equal(fp2([row('a.ts'), row('build/x.js', { ignored: true })], [], null, [rev('build/x.js', 3)]),
    fp2([row('a.ts'), row('build/x.js', { ignored: true })], [], null, []),
    '被忽略的（noisy）那一篇改了也不算 —— 上游把 FileStatus.IGNORED 排除在"影响检查结果"之外')
})

test('修订段挂在指纹末尾：没给（宿主未接）时形状与本批之前逐字一致', () => {
  const rows = [row('a.ts')]
  assert.equal(fp2(rows, ['a.ts'], null, []), commitChecksFingerprint(rows, ['a.ts'], null),
    '空数组 = 第四档根本不出现')
  assert.equal(fp2(rows, ['a.ts'], null, undefined), commitChecksFingerprint(rows, ['a.ts']),
    '连这个入参都不给 = 三参时代的形状')
  assert.equal(fp2(rows, ['a.ts'], null, [rev('a.ts', 7)]), `${commitChecksFingerprint(rows, ['a.ts'], null)}#a.ts@7`)
  assert.equal(fp2(rows, ['a.ts'], 3, [rev('a.ts', 7)]), `${commitChecksFingerprint(rows, ['a.ts'], 3)}#a.ts@7`,
    '全局计数那一档在前、按篇号那一档在后：两档共存、互不遮挡')
  assert.ok(!fp2(rows, [], null).includes('#a.ts@'), '没给号时不出现修订段')
})

test('接线：修订号在检查宿主里同样是可选入参，没给就交空数组（不许编常数）', () => {
  const host = read('src/sourceControlCommitChecks.ts')
  assert.match(host, /documentRevisions\?: \(\) => readonly DocumentRevision\[\]/, '可选：宿主没接之前恒为 undefined')
  assert.match(host, /import \{[\s\S]*type CommitChecksFileRow, type DocumentRevision, type RecentCommitChecks,[\s\S]*\} from '\.\/commitChecksResult\.ts'/,
    '类型从 commitChecksResult.ts 拿，不在别处再定义一遍')
  assert.match(host, /editorEpoch \? editorEpoch\(\) : null,\n {38}documentRevisions \? documentRevisions\(\) : \[\]/,
    '没给 ⇒ 交给指纹的是空数组（与 null 那一档同一条规矩）')
  assert.doesNotMatch(host, /documentRevisions: \(\) => \[\{ path: '', revision: 0 \}\]/,
    '不许在检查宿主里替编辑器编一篇文档的修订号')
  const module = read('src/commitChecksResult.ts')
  assert.match(module, /export interface DocumentRevision \{\n  path: string\n  revision: number\n\}/,
    '每篇一个号的最小形状')
})
