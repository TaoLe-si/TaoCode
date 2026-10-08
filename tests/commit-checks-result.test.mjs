// 提交检查「上次结果」状态机 + 提交按钮四档 + 进度行步名（桶 13c）。
//
// 上游（`platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt`）：
//   · `:667` `enum class RecentCommitChecks { UNKNOWN, PASSED, EARLY_FAILED, MODIFICATIONS_FAILED,
//     POST_FAILED, FAILED, SMART_MODE_REQUIRED }`
//   · `:229-243` 四个 `willSkip*` 谓词；`:247-250` `resetCommitChecksResult()`（留痕：原写 `:246-249`，
//     `:246` 是空行、闭括号在 `:250` —— 本批逐行重数过）；
//   · `:191-225` 只有"影响检查结果的文件"变了才 reset（被忽略的不算、已经是 UNKNOWN 就早退 `:205`/`:218`；
//     留痕：原写 `:202` —— 那一行是 VFS 那半的注释，不是早退行）；
//   · `:336-341` 会话开头 reset + `skip* = !isOnlyRunCommitChecks && willSkip*()`（原写 `:337-342`）；
//   · `:530-563` 结果落档（只跑检查且过了 = PASSED，提交路径且过了 = UNKNOWN，ABORTED/ERROR = FAILED 在 `:561`；
//     原写 `:533-557`／`:558-560`）。
// 按钮四档在 `AbstractCommitWorkflowHandler.kt:226-237`；进度行两档正文与带上下文那一档在
// `CommitChecksProgressIndicator.kt:122-134` + `VcsBundle.properties:21-24`（中文包取值逐条对过）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { effectScope, nextTick, ref } from 'vue'
import {
  checksResultAfter, commitChecksFingerprint, commitChecksShouldReset, documentAffectsCommitChecksResult,
  resetCommitChecks, willSkipCommitChecks, willSkipEarlyCommitChecks, willSkipModificationCommitChecks,
  willSkipPostCommitChecks,
} from '../src/commitChecksResult.ts'
import { createCommitChecks } from '../src/sourceControlCommitChecks.ts'
// 生产方本批落在仓里（`src/documentRevisions.ts`），所以下面那条行为判据吃的是**真账本**，
// 不再是测试自己造的 ref —— 造出来的那份只能证明"模块里那段逻辑对"，证明不了界面上真的有人记账。
import { bumpDocumentRevision, documentRevisionList } from '../src/documentRevisions.ts'
import {
  AMEND_ANYWAY_TEXT, CHECKS_STEP_MESSAGE, CHECKS_STEP_TODO, COMMIT_ACTION_TEXT, COMMITTING_TEXT,
  POST_CHECKS_PROGRESS_TEXT, PROGRESS_PRESENTATION_DELAY_MS, RUNNING_CHECKS_TEXT, RUNNING_CHECKS_WITH_CONTEXT,
  amendActionText, checksProgress, checksProgressShown, commitActionText, commitAnywayLabel, commitAndPushText,
  commitCheckReport,
} from '../src/commitChecks.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
// 把行注释擦掉再拿去做源码锚点：`// bumpDocumentRevision(tab.path)` 这种"注释里带着调用"
// 是最省事的绕过方式（实测：不擦注释时把记号那一行整条注掉，源码锚点类断言仍全绿 ⇒ 假绿）。
const codeOnly = list => list.map(line => line.split('//')[0]).join('\n')

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

test('reset 就是回 UNKNOWN，而且已经 UNKNOWN 时早退（:247-250 + :205/:218；留痕：原写 :246-249 + :202）', () => {
  assert.equal(resetCommitChecks(), 'unknown')
  assert.equal(commitChecksShouldReset('earlyFailed'), true)
  assert.equal(commitChecksShouldReset('unknown'), false, '已经是 UNKNOWN 就不再动状态（上游那里也就不再藏通知）')
})

// —— 结果落档（:530-563；留痕：原写 :533-557，:530 才是函数头）——

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
    'ABORTED / ERROR ⇒ FAILED（:558-562；留痕：原写 :558-560，那句赋值在 :561），抛错时不看失败列表')
})

// —— 指纹：什么才算"影响检查结果的文件变了"（那道筛 :191-199 + 两个监听 :202-225）——

const row = (path, extra = {}) => ({ path, indexStatus: 'M', workStatus: '', staged: false, untracked: false, ...extra })

test('指纹数的是"哪些文件、什么状态"，不是条数', () => {
  const before = commitChecksFingerprint([row('a.ts'), row('b.ts')])
  assert.notEqual(before, commitChecksFingerprint([row('a.ts')]), '少了一个文件 ⇒ 变')
  assert.notEqual(before, commitChecksFingerprint([row('a.ts'), row('c.ts')]), '换了个文件 ⇒ 变')
  assert.notEqual(before, commitChecksFingerprint([row('a.ts', { workStatus: 'D' }), row('b.ts')]),
    '同样两个文件、但工作区状态从空变成 D ⇒ 也要算变（上一版只数条数，这一种漏了）')
  assert.equal(before, commitChecksFingerprint([row('b.ts'), row('a.ts')]), '顺序不算变化')
})

// 留痕（commitfpclose）：标题原写 `:212`，重开 NonModalCommitWorkflowHandler.kt 逐行数过 ——
// `:212` 是 VFS listener 里 `override fun after` 的闭括号，IGNORED 那一道筛在 `:198`。断言一个字没动。
test('暂存与未暂存分开算，被忽略的行不参与（:198 排除 FileStatus.IGNORED）', () => {
  assert.notEqual(commitChecksFingerprint([row('a.ts')]), commitChecksFingerprint([row('a.ts', { staged: true })]))
  assert.equal(commitChecksFingerprint([row('a.ts'), row('build/x.js', { ignored: true })]),
    commitChecksFingerprint([row('a.ts')]), '被忽略的文件不算"影响检查结果"')
})

test('未保存清单进指纹：上游的第二个 listener 是 documentChanged（:216-225）', () => {
  assert.notEqual(commitChecksFingerprint([row('a.ts')], []), commitChecksFingerprint([row('a.ts')], ['a.ts']),
    '编辑器里出现未保存的改动 ⇒ 状态要作废')
  assert.equal(commitChecksFingerprint([row('a.ts')], ['a.ts', 'b.ts']), commitChecksFingerprint([row('a.ts')], ['b.ts', 'a.ts']))
})

// 上游 `documentChanged` 每敲一次都触发一次作废检查（`NonModalCommitWorkflowHandler.kt:216-225`），
// 而本仓的 `dirtyPaths` 只是一份"哪些标签是脏的"快照 ⇒ 第二次键入清单不变。把"内容又变了"这一维
// 交给**每篇文档的修订号**（`Document.java:183-192`）—— 见下面 R2 那一整段（本批：修订号是这一维的唯一输入）。
test('未保存清单是快照，不承担"第二次键入"那一口（形状仍然有效）', () => {
  assert.notEqual(commitChecksFingerprint([row('a.ts')], []), commitChecksFingerprint([row('a.ts')], ['a.ts']),
    '编辑器里出现未保存的改动 ⇒ 状态要作废')
  assert.equal(commitChecksFingerprint([row('a.ts')], ['a.ts', 'b.ts']), commitChecksFingerprint([row('a.ts')], ['b.ts', 'a.ts']))
  assert.equal(commitChecksFingerprint([row('a.ts')], ['a.ts']), commitChecksFingerprint([row('a.ts')], ['a.ts']),
    '同一篇继续编辑而清单不变 ⇒ 这一档自己不负责（下一段那口修订号负责）')
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
  // 留痕（R2 / commit2 → preflight → 本批 commitfp）：这一条原本钉的是**三参**、再后来是**四参**、
  // 再后来是"没接就交空数组"的三参形状。本批生产方落地（`src/documentRevisions.ts`），
  // `editorEpoch` 整条删掉、`documentRevisions` 从可选变必填 ⇒ 调用形状又变一次。
  // 断言语义只增不减：reset 仍由变更集指纹驱动，且现在**必须**带着按篇修订号（不再是三元兜底）。
  assert.match(panel, /watch\(\(\) => commitChecksFingerprint\(changes\.value, dirtyPaths\(\), documentRevisions\(\)\)/,
    'reset 的触发条件 = 变更集指纹，第三个参数是**按篇的文档修订号**（生产方已在仓里，没有"没接就交空数组"那一档）')
  assert.doesNotMatch(panel, /documentRevisions \? documentRevisions\(\) : \[\]/,
    '可选入参那一档已经随生产方落地一起删掉：留着它就是"没人喂号"的遮羞布')
  assert.doesNotMatch(panel, /commitChecksFingerprint\([^)]*editorEpoch/, '全局计数不再交进指纹（修订号是这一维的唯一输入）')
  assert.match(panel, /if \(commitChecksShouldReset\(checksResult\.value\)\) checksResult\.value = resetCommitChecks\(\)/)
  assert.match(panel, /watch\(message, \(\) => \{ commitCheckError\.value = '' \}\)/,
    '上游 CommitProgressPanel.clearError()（:316-319）只清错误行；失败行要等下一轮开始才清'
    + '（progressStarted 在 :219-227，清失败行那一句 `failuresPanel.clearFailures()` 在 :225。'
    + '留痕：原写 `:221-227` 且没标文件名 —— 按 NonModalCommitWorkflowHandler.kt 数过去那一段是'
    + ' documentChanged 的 listener，与失败行无关）')
  assert.match(panel, /if \(checkTodoBeforeCommit\.value && !skip\.modifications\)/, 'TODO 预检归 MODIFICATION 档')
  assert.match(panel, /const problems = skip\.early \? \[\] : messageProblems\.value/, '提交信息检查归 EARLY 档')
  assert.match(panel, /collectCommitChecks\(true, \{ early: false, modifications: false \}\)/,
    '「运行提交检查」那条路一条相位都不跳（:336-339 的 !isOnlyRunCommitChecks 前缀）')
  assert.match(panel, /if \(willSkipPostCommitChecks\(checksResult\.value\)\) return/, '提交后那一轮的跳过条件')
  assert.match(panel, /checksResult\.value = checksResultAfter\(\{/, '结果落地就落档（:530-563）')
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

// 全局计数 `editorEpoch` 是上一版为"内容又变了"准备的那条通道：一个**全局**计数，连是哪一篇都不认。
// 本批生产方（`src/documentRevisions.ts`）落地后它没有任何消费方 ⇒ 整条删掉（prop + deps 字段 + 面板的
// spread），这正是 `docs/wiring-requests-2026-10-06-preflight.md` P3 要求的那一步。
// 这里钉的是"删干净"，不是"删了就行"：面板不许再留一个恒为 undefined 的 prop，检查宿主也不许再留字段。
test('接线：editorEpoch 那条死通道整条删掉（修订号是"内容又变了"这一维的唯一输入）', () => {
  const panel = read('src/components/SourceControl.vue')
  const host = read('src/sourceControlCommitChecks.ts')
  assert.doesNotMatch(panel, /editorEpoch/, '面板不再有那个 prop，也不再有那个 spread')
  assert.doesNotMatch(host, /editorEpoch\?:/, '检查宿主的 deps 里不再有全局计数字段（留痕的散文提到这个名字不算）')
  assert.doesNotMatch(read('src/commitChecksResult.ts'), /editorEpoch: number \| null/, '指纹签名里也没有全局计数那一档')
  // 面板交的是**仓里那份账**，不是替编辑器编的一个常数。
  assert.match(panel, /documentRevisions: documentRevisionList,/, '面板把 documentRevisions.ts 的账本交给检查宿主')
  assert.match(panel, /import \{ documentRevisionList \} from \'\.\.\/documentRevisions\'/,
    '面板引的是那份账本身（不是自己造一个数组）')
  assert.doesNotMatch(panel, /documentRevisions: \(\) => \[\]/, '不许替编辑器交一份空账（那等于回到"第二次键入不作废"）')
})

// 生产链的每一跳都得在：编辑器变更 → 记号 → 面板 → 指纹 → reset。
// 这一条是"判据要能失败"的那一半：任何一 lane 把其中一跳拆掉（例如把 bump 从 onEditorChange 里删掉、
// 或面板不再交账本），这里就红 —— 上一版就是因为整条链只有模块侧，界面上永远是空账。
test('生产链：键入 → bumpDocumentRevision → 账本 → 面板 → 指纹 → reset，每一跳都在', () => {
  const navigation = read('src/lspNavigation.ts')
  assert.match(navigation, /import \{ bumpDocumentRevision \} from '\.\/documentRevisions\.ts'/,
    '编辑器变更的宿主入口引那份账')
  // onEditorChange 的函数体里必须有那一笔（钉函数体，不是钉全文 —— 全文有 import 也算命中）。
  const body = navigation.slice(navigation.indexOf('function onEditorChange'))
  assert.match(body.slice(0, 900), /bumpDocumentRevision\(tab\.path\)/,
    '每次 @change（`CodeEditor.vue:1010` 的 emit）都记一笔 —— 少了这一笔界面上就没有"第二次键入"的作废')
  const fileOps = read('src/editorFileOps.ts')
  assert.match(fileOps, /editor\.setDraft\(converted\)\n  tab\.dirty = true[\s\S]{0,300}bumpDocumentRevision\(tab\.path\)/,
    '缩进转换走 setDraft（不发 @change，CodeEditor.vue 的 `replacing` 那道闸）⇒ 它自己也得记一笔')
  const store = read('src/documentRevisions.ts')
  assert.match(store, /export function bumpDocumentRevision\(path: string\): number \{\n  const next = \(stamps\.value\[path\] \?\? 0\) \+ 1/,
    '号是"每篇各数自己的次数"：改一次换一个，没改就不动')
  assert.match(store, /stamps\.value = \{ \.\.\.stamps\.value, \[path\]: next \}/,
    '整体替换才让 Vue 看见这一次变化（面板那个 watch 靠它）')
  assert.doesNotMatch(store, /Date\.now\(\)|new Date\(/, '号不是时间戳（上游 Document.java:185 明说 not related to the file modification time）')
  assert.doesNotMatch(store, /localStorage\.|sessionStorage\.|readStored|writeStored|saveProjectSettings|JSON\.stringify\(stamps/,
    '这份账不落盘：只问持久化 API 的**调用**（注释里提到存档文件名不算）—— 跨会话没有意义，也不给 projects.json 添新键')
})

test('宿主把整份变更列表交给检查那一族（指纹要看未暂存的那一半）', () => {
  const panel = read('src/components/SourceControl.vue')
  assert.match(panel, /props, emit, act, commit, staged, changes, message, amend/, 'createCommitChecks 要拿到 changes')
})

// ── 本批（preflight）：结果指纹的"内容又变了"那一维改用**每篇文档的修订号** ──────────────
// 上游真身 `Document.getModificationStamp()`（Document.java:183-192，声明 :191-192；类注释 :25
// "stamp is incremented whenever the content changes"；每次文本变更领一个新号 DocumentImpl.java:171，
// 号源 DocumentModStamp.java:6-12 = LocalTimeCounter.currentTime()）。
// 作废那一条是事件式的：documentChanged（NonModalCommitWorkflowHandler.kt:215-226，早退 :218，
// 取文件 :221，过筛 :222，reset :223），筛 = `:191-199` 那三道（在 VCS 下 :193、在内容里 + 非 IGNORED :198）。
// 号当缓存键的先例：ExceptionLineParserImpl.java:318（记一次号）+ :320（`expireWhen(… != stamp)`）。
// 本仓的两个既有代理各有漏判：`dirtyPaths` 是快照（只覆盖第一次编辑）；`editorEpoch` 是全局计数（连哪一篇都不认）。
// 派单让搜的 `CommitCheckService` / `DocumentCommitCheckService` 在参考树里**零命中**（文件名与全文都搜过，
// 含 platform/vcs-impl、platform/dvcs-impl、platform/vcs-api 与两处 api-dump.txt）⇒ 无法核实，不照它编 API。

const rev = (path, revision) => ({ path, revision })
const fp = (rows, unsaved = [], revisions = []) => commitChecksFingerprint(rows, unsaved, revisions)

test('每篇文档的修订号：同一篇改两次 ⇒ 指纹不同，没改 ⇒ 逐字相同（判据 A：改一次就作废）', () => {
  const rows = [row('a.ts'), row('b.ts')]
  assert.equal(fp(rows, [], [rev('a.ts', 5)]), fp(rows, [], [rev('a.ts', 5)]),
    '没再编辑 ⇒ 号不动 ⇒ 指纹不动（不许每拍都作废，这是判据 B"仍复用"那一半）')
  assert.notEqual(fp(rows, [], [rev('a.ts', 5)]), fp(rows, [], [rev('a.ts', 6)]),
    '同一篇的第二次编辑：未保存清单一个字没变，指纹也必须变（dirtyPaths 那份快照漏的就是这一口）')
  assert.notEqual(fp(rows, [], [rev('a.ts', 100)]), fp(rows, [], [rev('a.ts', 9_999)]),
    '号不必"递增 1"，换了就算（上游 next() 给的是 LocalTimeCounter）')
  assert.equal(fp(rows, [], [rev('a.ts', 5), rev('b.ts', 8)]), fp(rows, [], [rev('b.ts', 8), rev('a.ts', 5)]),
    '两篇的先后顺序不算变化')
  assert.notEqual(fp(rows, [], [rev('a.ts', 5), rev('b.ts', 8)]), fp(rows, [], [rev('a.ts', 5), rev('b.ts', 9)]),
    '另一篇也各算各的号')
})

// 这一条是本批改的核心：上一版的修订段被"这篇必须在变更列表里"筛掉，而那**不是上游的筛**
// （`:191-199` 只问 在 VCS 下 / 在内容里 / 状态不是 IGNORED，从不问它在不在 changelist 里）。
// 后果：一篇 git 侧干净的文件在编辑器里改第二次 ⇒ 号被筛掉、清单又不因第二次键入而变 ⇒ 不作废。
test('修订号不过"在不在变更列表里"那道筛（上游 :191-199 的三道筛里没有这一条）', () => {
  const rows = [row('a.ts'), row('b.ts')]
  assert.notEqual(fp(rows, ['clean.ts'], [rev('clean.ts', 1)]), fp(rows, ['clean.ts'], [rev('clean.ts', 2)]),
    'git 侧干净、只在编辑器里被改的那一篇：第二次键入也必须让指纹变（上一版这里一模一样，永远不作废）')
  assert.notEqual(fp(rows, [], [rev('clean.ts', 7)]), fp(rows, [], []),
    '不在变更列表里的文档有了新号 ⇒ 进指纹（上游照样 reset）')
  assert.equal(fp(rows, [], [rev('clean.ts', 7)]), fp(rows, [], [rev('clean.ts', 7)]),
    '同一篇没再改 ⇒ 逐字不变（放开筛不等于每拍都作废）')
})

test('只有被忽略（IGNORED）的那一篇不进修订段（:198）', () => {
  const rows = [row('a.ts'), row('build/x.js', { ignored: true })]
  assert.equal(fp(rows, [], [rev('build/x.js', 3)]), fp(rows, [], []),
    '上游把 FileStatus.IGNORED 排除在"影响检查结果"之外 ⇒ 被忽略的那一篇改了也不算')
  assert.equal(fp(rows, [], [rev('build/x.js/deep.ts', 3)]), fp(rows, [], []),
    '被忽略的目录之下的那一篇同样不算（宿主按目录报 ignored 时）')
  assert.notEqual(fp(rows, [], [rev('a.ts', 3)]), fp(rows, [], [rev('a.ts', 4)]),
    '对照：没过筛的那一篇（a.ts）照样各号一算 —— ignored 那一档是"整篇不收"，不是全局开关')
  assert.notEqual(fp([row('a.ts')], [], [rev('build/x.js', 3)]), fp(rows, [], [rev('build/x.js', 3)]),
    '同一条路径在"没报 ignored"的变更列表里就要收（筛的是 ignored 标记，不是路径名）')
})

test('documentAffectsCommitChecksResult：:191-199 那道筛的单独出口', () => {
  const rows = [row('a.ts'), row('build', { ignored: true })]
  assert.equal(documentAffectsCommitChecksResult(rev('a.ts', 1), rows), true, '变更列表里的一篇当然算')
  assert.equal(documentAffectsCommitChecksResult(rev('clean.ts', 1), rows), true,
    '没在变更列表里的一篇也算 —— 上游那三道筛没这一条')
  assert.equal(documentAffectsCommitChecksResult(rev('build', 1), rows), false, 'ignored 行本身不算')
  assert.equal(documentAffectsCommitChecksResult(rev('build/x.js', 1), rows), false, 'ignored 目录之下的一篇不算')
  assert.equal(documentAffectsCommitChecksResult(rev('build', 1), [row('build/x.js', { ignored: true })]), true,
    '反向：只报了文件级 ignored 时不许把目录整体判死')
})

test('修订段挂在指纹末尾：没给（宿主未接）时形状与本批之前逐字一致', () => {
  const rows = [row('a.ts')]
  assert.equal(fp(rows, ['a.ts'], []), `${commitChecksFingerprint(rows, ['a.ts'])}`,
    '空数组 = 修订段根本不出现（本批之前 editorEpoch 恒为 null，那一段本来就是空串）')
  assert.equal(fp(rows, ['a.ts'], undefined), commitChecksFingerprint(rows, ['a.ts']),
    '连这个入参都不给 = 两参时代的形状')
  assert.equal(fp(rows, ['a.ts'], [rev('a.ts', 7)]), `${commitChecksFingerprint(rows, ['a.ts'])}#a.ts@7`)
  assert.ok(!fp(rows, []).includes('#a.ts@'), '没给号时不出现修订段')
  assert.ok(!commitChecksFingerprint(rows, ['a.ts'], [], 1).includes('@1'),
    '旧的全局计数入参已经从签名里撤走：多给一个参数也不许悄悄生效')
})

// 判据要"能失败"：这一条跑真的状态机（vue 的 effectScope + watch），不是只比字符串。
// 上游那一对：documentChanged ⇒ resetCommitChecksResult()（:222-223），已 UNKNOWN 就早退（:218）。
test('行为判据：改一次 ⇒ 上一轮结果作废；不改 ⇒ 结果仍复用（跑真的 watch）', async () => {
  const scope = effectScope()
  const checks = await scope.run(async () => {
    // `clean.ts` **不在**变更列表里：它就是"git 侧干净、只在编辑器里被改"的那一篇 —— 上一版把它筛掉了。
    const changes = ref([row('a.ts')])
    const revisions = ref([rev('clean.ts', 1)])
    const host = createCommitChecks({
      props: {}, emit: () => {}, act: async run => { await run() }, commit: () => {},
      staged: ref([]), changes, message: ref('打字'), amend: ref(false),
      checkTodoBeforeCommit: ref(false), todoCheckBusy: ref(false), todoHits: async () => 0,
      messageProblems: ref([]), signoff: ref(false), postponeSlowChecks: ref(false),
      dirtyPaths: () => [], documentRevisions: () => revisions.value,
    })
    // 一轮"只跑检查且全过"的结果落地 = PASSED（:533-543）。
    host.applyChecksReport(commitCheckReport({ blockReason: null, todoHits: 0, messageProblems: [], unsaved: [] }))
    return { host, revisions }
  })
  const { host, revisions } = checks
  assert.equal(host.checksResult.value, 'passed', '先让上一轮结果立起来')

  await nextTick()
  assert.equal(host.checksResult.value, 'passed', '什么都没变 ⇒ 结果仍复用（不许每拍作废，判据 B）')

  revisions.value = [rev('clean.ts', 1), rev('a.ts', 9)]
  await nextTick()
  assert.equal(host.checksResult.value, 'unknown',
    '另一篇过了一个**新号** ⇒ 同样作废（上游 :222 问的就是这篇文件过不过那三道筛）')

  host.applyChecksReport(commitCheckReport({ blockReason: null, todoHits: 0, messageProblems: [], unsaved: [] }))
  assert.equal(host.checksResult.value, 'passed', '重新立一轮结果')
  revisions.value = [rev('clean.ts', 1), rev('a.ts', 9)]
  await nextTick()
  assert.equal(host.checksResult.value, 'passed',
    '交同一份号向量（新建对象、值一样）不算变化：比的是号，不是对象身份')

  revisions.value = [rev('clean.ts', 2), rev('a.ts', 9)]
  await nextTick()
  assert.equal(host.checksResult.value, 'unknown',
    '同一篇（git 侧干净的那一篇）改第二次 ⇒ 号 1→2 ⇒ 上一轮的 PASSED 必须作废（本批的判据 A）')

  // 作废之后落一个"失败"档：再敲一次同一篇 ⇒ 跳过与否也必须跟着失效（上游 :229-239 是从状态折算的）。
  host.applyChecksReport(commitCheckReport({ blockReason: null, todoHits: 2, messageProblems: [], unsaved: [] }))
  assert.equal(host.checksResult.value, 'modificationsFailed')
  assert.deepEqual(host.skipFromState(), { early: true, modifications: true }, '失败档的跳过在这一拍是生效的')
  revisions.value = [rev('clean.ts', 3)]
  await nextTick()
  assert.equal(host.checksResult.value, 'unknown', '改一次 ⇒ 失败档也作废')
  assert.deepEqual(host.skipFromState(), { early: false, modifications: false }, '作废 ⇒ 下一次一条都不跳')
  await nextTick()
  assert.equal(host.checksResult.value, 'unknown', '已经 UNKNOWN 时不再动状态（:218 的早退）')
  scope.stop()
})

test('接线：修订号在检查宿主里是**必填**入参（生产方已在仓里，不再交空数组）', () => {
  const host = read('src/sourceControlCommitChecks.ts')
  assert.match(host, /documentRevisions: \(\) => readonly DocumentRevision\[\]/, '必填：仓里就有生产方，缺席就该编译不过')
  assert.doesNotMatch(host, /documentRevisions\?:/, '不再是可选入参 —— 留着"可省"这一档就是允许某条路把账本摘掉')
  assert.match(host, /import \{[\s\S]*type CommitChecksFileRow, type DocumentRevision, type RecentCommitChecks,[\s\S]*\} from '\.\/commitChecksResult\.ts'/,
    '类型从 commitChecksResult.ts 拿，不在别处再定义一遍')
  assert.doesNotMatch(host, /documentRevisions \? documentRevisions\(\) : \[\]/, '三元兜底随必填一起删掉')
  assert.doesNotMatch(host, /documentRevisions: \(\) => \[\{ path: '', revision: 0 \}\]/,
    '不许在检查宿主里替编辑器编一篇文档的修订号')
  const module = read('src/commitChecksResult.ts')
  assert.match(module, /export interface DocumentRevision \{\n  path: string\n  revision: number\n\}/,
    '每篇一个号的最小形状')
  assert.doesNotMatch(module, /editorEpoch: number \| null/, '全局计数那一档已从指纹签名里撤走')
})

// ── 本批（commitfp）：生产者落地之后的两条判据 ────────────────────────────────────────
// 上面那条"行为判据"吃的是测试自己造的 `ref` —— 它只能证明模块里那段逻辑对，证明不了界面上真的有人记账。
// 本批生产方在仓里（`src/documentRevisions.ts`），所以这两条吃**真账本**：判据这才真的能红。

test('生产判据（真账本）：同一篇再改一次 ⇒ 上一轮结果作废；什么都没改 ⇒ 结果仍复用', async () => {
  const scope = effectScope()
  const host = await scope.run(() => createCommitChecks({
    props: {}, emit: () => {}, act: async run => { await run() }, commit: () => {},
    staged: ref([]), changes: ref([row('fp-a.ts')]), message: ref('打字'), amend: ref(false),
    checkTodoBeforeCommit: ref(false), todoCheckBusy: ref(false), todoHits: async () => 0,
    messageProblems: ref([]), signoff: ref(false), postponeSlowChecks: ref(false),
    // 这一篇从一开始就是"脏"的：`dirtyPaths` 那一段自此不再因键入而变 —— 缺陷正是从这里进来的。
    dirtyPaths: () => ['fp-a.ts'],
    documentRevisions: documentRevisionList,
  }))
  const passed = commitCheckReport({ blockReason: null, todoHits: 0, messageProblems: [], unsaved: [] })
  host.applyChecksReport(passed)
  assert.equal(host.checksResult.value, 'passed', '先让上一轮结果立起来')

  await nextTick()
  assert.equal(host.checksResult.value, 'passed',
    '没编辑 ⇒ 账本没动 ⇒ 不许每发作废（判据 B：结果仍复用）')

  bumpDocumentRevision('fp-a.ts')
  await nextTick()
  assert.equal(host.checksResult.value, 'unknown',
    '同一篇改第二次 ⇒ 未保存清单一个字没变，但号换了 ⇒ 上一轮 PASSED 必须作废（判据 A）')

  host.applyChecksReport(commitCheckReport({ blockReason: null, todoHits: 3, messageProblems: [], unsaved: [] }))
  assert.equal(host.checksResult.value, 'modificationsFailed', '落一个失败档')
  assert.deepEqual(host.skipFromState(), { early: true, modifications: true }, '这一档下下一次提交两条都跳')
  bumpDocumentRevision('fp-a.ts')
  await nextTick()
  assert.equal(host.checksResult.value, 'unknown', '改一次 ⇒ 连失败档也作废（界面上"仍然提交"这个名字跟着回到「提交」）')
  assert.deepEqual(host.skipFromState(), { early: false, modifications: false }, '作废 ⇒ 下一次一条都不跳')
  scope.stop()
})

test('号是"改一次换一个"，不是内容哈希，也不是每拍都换', () => {
  const first = bumpDocumentRevision('fp-hash.ts')
  const second = bumpDocumentRevision('fp-hash.ts')
  assert.notEqual(second, first, '同一篇连着两笔必须给两个号 —— 内容哈希在"改了又改回来"时会给同一个号，'
    +'那不是上游 documentChanged 的判据（它一次事件作废一次，`NonModalCommitWorkflowHandler.kt:216-225`）')
  const before = documentRevisionList()
  assert.deepEqual(documentRevisionList(), before, '没人改 ⇒ 快照逐字不变（这一条挡住"每拍都作废"那一侧）')
  const third = bumpDocumentRevision('fp-other.ts')
  assert.notEqual(third, 0, '另一篇从头数自己的 1（号是**按篇**的，不是一个全局拍子）')
  assert.ok(documentRevisionList().some(item => item.path === 'fp-other.ts' && item.revision === third),
    '新号进得了快照（面板那个 watch 吃得到的就是这一份）')
})

test('对照：只靠"未保存清单"那一段时，第二次键入的指纹与第一次逐字相同（这就是缺陷的形状）', () => {
  const rows = [row('fp-a.ts')]
  assert.equal(commitChecksFingerprint(rows, ['fp-a.ts'], []), commitChecksFingerprint(rows, ['fp-a.ts'], []),
    '没有第 3 段 ⇒ 同一篇改多少次都看不出差别（本批之前界面上就是这个形状）')
  assert.notEqual(commitChecksFingerprint(rows, ['fp-a.ts'], [rev('fp-a.ts', 1)]),
    commitChecksFingerprint(rows, ['fp-a.ts'], [rev('fp-a.ts', 2)]),
    '补上第 3 段（真账本给的两个号）⇒ 第二次键入也算变了')
})

// ── 本批（commitpaths）：把整篇正文换掉的**程序性**入口也要换号，不只是键入 ──────────────
// 上游那两个 listener 都不问"是谁改的"：
//   · `documentChanged`（`NonModalCommitWorkflowHandler.kt:216-225`）对**任何**一次改写都作废一次，
//     号由 `platform/core-impl/src/com/intellij/openapi/editor/impl/DocumentImpl.java:171` 发
//     （每次 `replaceString` 领一个新号，不看是谁发起的）；
//   · VFS 那个 listener（`:203-213`）管的是"磁盘内容盖回编辑器"那一档。
// 本仓的键入那一半早有生产方（`onEditorChange` → `bumpDocumentRevision`，`src/lspNavigation.ts`），
// 但**把整篇正文换掉**的另一批入口原先一处都不记号：重新载入磁盘版本 / 换编码 / 语言服务改文 /
// 批量替换 / 意图与重构落地。那些情形下 `dirtyPaths` 与变更列表都可能不变（保存过、或 git 侧干净），
// 于是指纹一个字没变 ⇒ 上一轮的 PASSED 被无限复用 —— 正是派单点名的那一维。
// 这一条是**扫源码**的不变量，不靠点名：新增一个 setDraft 而忘了记号就会红。
test('不变量：src/*.ts 里每一处把正文灌回编辑器的 setDraft 都跟着一次 bumpDocumentRevision', () => {
  // 恢复会话草稿不算"正文变过一版"：上游**建文档**不发 documentChanged（新文档自带初始号），
  // 打开项目时把上次未保存的草稿灌进新建的编辑器是同一种"创建"，不是一次修改。
  const EXEMPT = new Set(['src/sessionSnapshot.ts'])
  const sites = []
  for (const name of readdirSync(new URL('../src', import.meta.url))) {
    if (!name.endsWith('.ts') || EXEMPT.has(`src/${name}`)) continue
    const lines = readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8').split('\n')
    lines.forEach((line, index) => {
      // 只数**调用点**（前面带 `.`）；接口与类型里那一行 `setDraft(text: string): void` 不算。
      if (!/\.setDraft\(/.test(line.split('//')[0])) return
      const around = codeOnly(lines.slice(index, index + 6))
      sites.push(`src/${name}:${index + 1}`)
      assert.match(around, /bumpDocumentRevision\(/,
        `src/${name}:${index + 1} 把整篇正文换掉了却没给那一篇换修订号 —— `
        + '提交检查的指纹看不见这次改写，上一轮结果会被当成还作数'
        + '（上游 documentChanged / VFS listener 都要作废一次）')
    })
  }
  // 反假绿：扫描真的找到了调用点才算数（一个都没扫到就是这条不变量在空转）。
  assert.ok(sites.length >= 8, `至少要钉住 8 处程序性改写（实际扫到 ${sites.length} 处：${sites.join(', ')}）`)
})

test('登记已接：src/App.vue 的 setDraft 也都记了修订号（接线请求 C1 已落地）', () => {
  const lines = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8').split('\n')
  const unbumped = []
  lines.forEach((line, index) => {
    if (!/\.setDraft\(/.test(line.split('//')[0])) return
    if (/bumpDocumentRevision\(/.test(codeOnly(lines.slice(index, index + 6)))) return
    unbumped.push(index + 1)
  })
  // 本地历史回滚 / 保存时动作 / 保存 pass 这三处正文改写已在 C1 里记号；
  // 这一条现在是**回归护栏**：任何新增的整篇改写没记号，这里就会列出那一行。
  assert.deepEqual(unbumped, [],
    `App.vue 里出现了把整篇正文换掉却没记修订号的 setDraft（行 ${unbumped.join(', ')}）`
    + ' —— 提交检查的指纹看不见这次改写，上一轮 PASSED 会被当成还作数')
})
