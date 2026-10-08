// 提交检查结果的「上一次是什么」状态机 —— 上游 `RecentCommitChecks` 那一族。
//
// 上游出处（`platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt`，逐行核过）：
//   · `:667` `private enum class RecentCommitChecks { UNKNOWN, PASSED, EARLY_FAILED, MODIFICATIONS_FAILED,
//     POST_FAILED, FAILED, SMART_MODE_REQUIRED }`
//   · `:229-232` `willSkipCommitChecks()` = EARLY_FAILED || MODIFICATIONS_FAILED || POST_FAILED || smartChecksWereBlocked
//   · `:234-236` `willSkipEarlyCommitChecks()` = EARLY_FAILED || MODIFICATIONS_FAILED || POST_FAILED
//   · `:238-239` `willSkipModificationCommitChecks()` = MODIFICATIONS_FAILED || POST_FAILED
//   · `:241` `willSkipLateCommitChecks()` = POST_FAILED ／ `:243` `willSkipPostCommitChecks()` = POST_FAILED
//   · `:247-250` `resetCommitChecksResult()` = 状态回 UNKNOWN ＋ 藏起失败通知
//     （留痕：原写 `:246-249`／`:229-233` —— 2026-10-06（commitfp）重开该文件逐行数过：`:246` 是空行、
//     函数头在 `:247`、闭括号在 `:250`；`willSkipCommitChecks()` 的第四个条件 `smartChecksWereBlocked` 在 `:232`，`:233` 是空行）
//   · `:202-225` 两个监听（VFS 变化 `:203-213` / 文档变化 `:216-225`）都先判 `isCommitChecksResultUpToDate == UNKNOWN` 早退
//     （早退那两行是 `:205` 与 `:218`。留痕：这里原写 `:202`，2026-10-06（commit2）重开该文件逐行核实：
//     `:202` 是「reset commit checks on VFS updates」那条注释本身，不是早退行；原写的区间上界 `:200-226`
//     也重数过 —— `:200`/`:201` 是那道筛的收尾与大空行）；
//     再只认"影响检查结果的文件"（`:191-199` `areFilesAffectsCommitChecksResult`：在 VCS 下、在内容里、状态不是 IGNORED）。
//     **提交信息框里的键入不在这一条上**（那不是内容文件）⇒ 本仓也不能拿它当 reset。
//   · `:336-341` 每次会话开头：`skip* = !isOnlyRunCommitChecks && willSkip*()`（`:336-339`），然后
//     `resetCommitChecksResult()`（`:341`；留痕：原写 `:337-342` —— 少看了第一个 skip、多算了 `:342` 那个空行）
//     ⇒「运行提交检查」（失败行上那把刷新按钮）**不跳过任何相位**，它是强制重跑。
//   · `:530-563` `handleCommitProblem`：没有失败 ⇒ `isOnlyRunCommitChecks ? PASSED : UNKNOWN`
//     （"We are going to commit, remembering the result is not needed"在 `:543`）；EARLY/MODIFICATIONS/POST 各归各档；
//     ABORTED 与 ERROR ⇒ FAILED（`:558-562`；留痕：原写 `:533-557`／`:558-560` —— `:530` 才是函数头，
//     而那个赋值在 `:561`，落在旧区间外面）。
//
// 本仓的相位映射（上游按 `CommitCheck.getExecutionOrder()` 分组：EARLY / MODIFICATION / LATE / POST_COMMIT，
// 见 `:372-375`；接口本身在 `platform/vcs-api/src/com/intellij/openapi/vcs/checkin/CommitCheck.kt:36`）：
//   · `early`          = 提交信息检查（`src/commitMessageInspection.ts`）—— 只看信息文本，与变更内容无关。
//   · `modifications`  = 提交前 TODO 预检 —— 它要读被改动文件的内容，落在 MODIFICATION 那一档。
//     **已核实的偏差（登记，不在本批改）**：上游那一条 `TodoCheckinHandler` 的 `getExecutionOrder()` 答的是
//     `POST_COMMIT`（`platform/vcs-impl/lang/todo/src/com/intellij/openapi/vcs/checkin/TodoCheckinHandler.kt:70`），
//     本仓把它跑在**提交前**（面板上那个「提交前检查 TODO」开关）⇒ 相位归 `modifications` 是跟着本仓的运行时机写的。
//   · LATE 本仓没有生产者（上游那一档是"弹窗征求同意"的检查，`runLateCommitChecks` `:486-501`；
//     留痕：原写 `:483-499`，那三段是上一函数的闭括号与空行），
//     不造空相位；`willSkipLateCommitChecks` 因此不搬。
//   · SMART_MODE_REQUIRED 留着但不产生：上游那一档来自 dumb 模式下不可用的智能检查
//     （`handleDumbModeCompatibility` `:430-445`；留痕：原写 `:468-482` —— 那是 `runModificationCommitChecks`
//     的收尾，函数本体在 `:430`），本仓两条检查都不依赖索引（TODO 预检走 `search.run`
//     的正则扫描、信息检查是纯文本），没有"因为没索引而被挡住的检查"，面板上也就不会出现这一档。

/** 一次失败出自哪个相位（`checksResultAfter` 按**最早失败的相位**落状态，上游是分相位顺序跑的）。 */
export type CommitCheckPhase = 'early' | 'modifications'

/** `RecentCommitChecks`（`:667`）的七档。 */
export type RecentCommitChecks =
  | 'unknown' | 'passed' | 'earlyFailed' | 'modificationsFailed' | 'postFailed' | 'failed' | 'smartModeRequired'

/** 一条带相位的失败（`src/commitChecks.ts` 的 `CommitCheckFailure` 结构上满足它）。 */
export interface PhaseTaggedFailure {
  phase: CommitCheckPhase
}

/** `willSkipCommitChecks()`（`:229-232`；留痕：原写 `:229-233`，`:233` 是空行）：检查已经失败过 ⇒ 提交按钮改名「仍然{0}」，按下去跳过这些相位。 */
export function willSkipCommitChecks(state: RecentCommitChecks, smartChecksWereBlocked = false): boolean {
  return state === 'earlyFailed' || state === 'modificationsFailed' || state === 'postFailed' || smartChecksWereBlocked
}

/** `willSkipEarlyCommitChecks()`（`:234-236`）：这三档之后，提交信息检查不再重跑。 */
export function willSkipEarlyCommitChecks(state: RecentCommitChecks): boolean {
  return state === 'earlyFailed' || state === 'modificationsFailed' || state === 'postFailed'
}

/** `willSkipModificationCommitChecks()`（`:238-239`）：只有这两档才跳过 TODO 预检（EARLY_FAILED 时它根本还没跑过）。 */
export function willSkipModificationCommitChecks(state: RecentCommitChecks): boolean {
  return state === 'modificationsFailed' || state === 'postFailed'
}

/** `willSkipPostCommitChecks()`（`:243`）：提交后那一轮只在**它自己**失败过时才跳过（不再重复报同一批）。 */
export function willSkipPostCommitChecks(state: RecentCommitChecks): boolean {
  return state === 'postFailed'
}

/** `resetCommitChecksResult()`（`:247-250`；留痕：原写 `:246-249` —— `:246` 是空行、闭括号在 `:250`）：一律回 UNKNOWN。 */
export const resetCommitChecks = (): RecentCommitChecks => 'unknown'

/** 这次变化值不值得 reset（`:205`/`:218` 的 `== UNKNOWN` 早退）：已经是 UNKNOWN 就不动状态。 */
export function commitChecksShouldReset(state: RecentCommitChecks): boolean {
  return state !== 'unknown'
}

/** 一条会影响检查结果的"文件行"（最小口径，结构上与宿主返回的 `GitChange` 一致）。 */
export interface CommitChecksFileRow {
  path: string
  indexStatus: string
  workStatus: string
  staged: boolean
  untracked: boolean
  /** 「显示忽略的文件」开着时才列出来的那些 —— 上游 `FileStatus.IGNORED` 要排除（`:198`
   *  `changeListManager.getStatus(it) != FileStatus.IGNORED`；留痕：原写 `:212`，2026-10-06（commitfpclose）
   *  重开 `NonModalCommitWorkflowHandler.kt` 逐行核过 —— `:212` 是 VFS 那个 listener 里
   *  `override fun after` 的闭括号，与 IGNORED 无关）。 */
  ignored?: boolean
}

/**
 * 一篇文档的**修订号**（上游 `Document.getModificationStamp()`，
 * `platform/core-api/src/com/intellij/openapi/editor/Document.java:184-192`，声明在 `:191-192`；
 * 类注释 `platform/core-api/src/com/intellij/openapi/editor/Document.java:25`「Document is also a
 * ModificationTracker whose stamp is incremented whenever the content changes」）：
 * 内容每变一次就换一个号（`platform/core-impl/src/com/intellij/openapi/editor/impl/DocumentImpl.java:171`
 * 每次 `replaceString` 传 `DocumentModStamp.next()`，该类
 * `platform/core-impl/src/com/intellij/openapi/editor/impl/DocumentModStamp.java:6-12`：注释 `:6-8`
 * 「creating fresh document modification stamps during document text changes」，`next()` `:10-11` 取
 * `LocalTimeCounter.currentTime()`），
 * 与文件时间无关、也不要求是"递增 1"。本仓的号由 `src/documentRevisions.ts` 记（每次键入一笔、
 * 每次程序性改写一笔），提供方只需保证"同一篇改一次就换一个、没改就不动"这一条。
 */
export interface DocumentRevision {
  path: string
  revision: number
}

/**
 * 这篇文档算不算"会影响检查结果"（上游 `areFilesAffectsCommitChecksResult` `:191-199` 的本仓口径）。
 *
 * 上游那三道筛（逐行开过）：
 *   · `:193` `files.filter { vcsManager.getVcsFor(it) != null }` —— 在 VCS 下；
 *   · `:198` `fileIndex.isInContent(it) && changeListManager.getStatus(it) != FileStatus.IGNORED`
 *     —— 在内容里、且 changelist 状态**不是 IGNORED**。
 * **这三道里没有任何一条问"它在不在变更列表里"** —— 一篇 git 眼下干净（没 diff）的文件被编辑，
 * 上游照样 reset。所以本仓不许拿"这篇在不在 `changes` 里"当筛（那是上一版的筛，见下面的留痕）。
 *
 * 本仓的 `CommitChecksFileRow` 只有变更列表那一份数据：`getVcsFor != null` 与 `isInContent` 是**编辑器侧**
 * 才知道的事实（⇒ 由 `documentRevisions` 的生产方 `src/documentRevisions.ts` 负责：它只在工作区里打开的那份
 * 文档真的被改过时才记一笔 —— 本仓的标签页全是工作区文件，所以这两道筛的等价物就是"有没有这个号"）。
 * 这里只实现**能算得出的那一道** = 非 IGNORED：路径命中一条 ignored 行（本身或被忽略的目录的后代）就不算。
 */
export function documentAffectsCommitChecksResult(item: DocumentRevision, rows: readonly CommitChecksFileRow[]): boolean {
  return !rows.some(row => row.ignored === true && (row.path === item.path || item.path.startsWith(`${row.path}/`)))
}

/**
 * 变更集的指纹：`areFilesAffectsCommitChecksResult`（`:191-199`）在本仓的等价物 —— 三段，各管一件事：
 *
 *   1. **变更列表**（`:191-199` 的"受影响的文件"，本仓拿到的就是 git 的变更列表：列表里每一项天然在 VCS 下、
 *      在内容里，被忽略的那些带 `ignored` 标记 ⇒ 只把它们滤掉）。把 **是否暂存 + 路径 + 索引侧状态 +
 *      工作区侧状态 + 是否未跟踪** 都算进去：光数条数会漏掉"内容变了但文件还是那些"这一常见情形。
 *   2. **未保存清单**（`unsaved` = 宿主的 `dirtyPaths`）：上游第二个 listener 是
 *      `DocumentListener.documentChanged`（`:216-225`）；这一档只回答"哪几篇是脏的"，
 *      同一篇再改它一个字都不变 ⇒ 逐次键入那一半由第 3 段承担。
 *   3. **每篇文档的修订号**（`revisions`，上游 `Document.getModificationStamp()` 的直接等价物）：
 *      这一档才是"同一篇改两次也要作废"的那一口 —— 号变 ⇒ 指纹变 ⇒ 上一轮结果作废；
 *      号不变（= 没编辑）⇒ 逐字不变 ⇒ 结果仍复用。只认 `documentAffectsCommitChecksResult` 过筛的那些篇，
 *      按路径排序（先后顺序不算变化）。
 *
 * **留痕（原写 X、实际 Y）—— 修订号档的确立与全局计数的退场**：
 *   · 上一版第 3 段是 `editorEpoch`（**一个全局计数**，`docs/wiring-requests-2026-10-06-vcs2.md` W2 的形状）。
 *     它不是"修订号"：它一篇文档都不认，别的文件（含不在 VCS 下 / 不在内容里的那些）动一下也算这次变更集变了
 *     —— 上游 `:222` 问的始终是**这篇文件**过不过那三道筛。
 *   · 后一版（commit2 R2）给它补的"按篇号"这一档方向是对的，却又被 `kept.some(row => …)` 那道
 *     "必须在变更列表里"的筛限死了。**那不是上游的筛**（见 `documentAffectsCommitChecksResult` 上面的逐行核对）。
 *     后果正是本派单要修的：一篇 git 侧干净的文件在编辑器里改第二次 —— 不在 `changes` 里 ⇒ 号被筛掉、
 *     `dirtyPaths` 又不因第二次键入而变 ⇒ 指纹一个字没变 ⇒ 上一次的 PASSED 永远不作废。
 *   · 再一版（preflight）把筛放开了，但**生产侧还是空的**：`documentRevisions` 是个可选入参，
 *     面板不交、宿主也没有那份账 ⇒ 界面上指纹永远只有前两段，上面那个假复用用例照旧成立。
 *   · 本批（commitfp）把**生产者**补上并让整条链真的通：账本 `src/documentRevisions.ts`（每篇一个号，
 *     改一次换一个），由 `src/lspNavigation.ts` 的 `onEditorChange`（编辑器每次变更都走它，
 *     `CodeEditor.vue:1010` 的 `emit('change')`）与 `src/editorFileOps.ts` 的缩进转换（`setDraft` 不发 `@change`）
 *     记一笔，`SourceControl.vue` 交进 `createCommitChecks`。于是
 *     · 第 2 段保留（它仍管"哪几篇没保存"，与上游 `SaveCommittingDocumentsVetoer` 那一档同源）；
 *     · 第 3 段成为"内容又变了"那一维的唯一驱动，且**不再是可选入参**（生产方已在仓里 ⇒ 没有"没接"这一档）；
 *     · `editorEpoch` 整个删掉：面板的 prop、deps 里的字段、指纹的入参都清了（撤线请求
 *       `docs/wiring-requests-2026-10-06-preflight.md` P1/P2/P3 由本批落地，宿主一行都没动 ——
 *       号本来就属于文档，不属于组装层，见 `Document.java:25` 那条类注释）。
 *
 * **上游坐标核对（不许照抄，逐条开过；相对 `D:\Backup\Downloads\intellij-community-master`）**：
 *   · 派单让搜的 `CommitCheckService` / `DocumentCommitCheckService`：`platform/vcs-impl`、`platform/dvcs-impl`
 *     与 `platform/vcs-api` 下**按文件名 find 与全文 grep 都零命中**，连 `api-dump.txt` 里也没有
 *     ⇒ 这两个名字在本参考树版本里**无法核实**（更不敢照着它们编 API）。作废机制按**当场打开核实过**的
 *     `platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt:190-200`（那道筛）与
 *     `platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt:215-226`（文档变化那一半）落。
 *   · 派单还说"上游是 `CheckinProjectPanel` / `BeforeCheckinMetadata` 一族配合 `Document.getModificationStamp()`"
 *     —— 两句都不成立，**订正留痕**：`BeforeCheckinMetadata` 在 `platform` 与 `plugins` 下**零命中**（文件名与
 *     全文都搜过）⇒ 无法核实；`CheckinProjectPanel` 有实体
 *     （`platform/vcs-api/src/com/intellij/openapi/vcs/CheckinProjectPanel.java`，104 行，旧式检入对话框的接口），
 *     但它**一个 `modificationStamp` 都不提**（全文 grep 零命中）⇒ 上游的作废机制不是"面板记号"，是
 *     `documentChanged` 事件 + `resetCommitChecksResult()`；本仓没有事件总线，就把"这篇文档改过几次"折成号，
 *     这与上游同构（号变 = 事件发生），且号当缓存键有先例（下一条）。
 *   · 号当缓存键的先例仍成立：`java/execution/impl/src/com/intellij/execution/filters/ExceptionLineParserImpl.java:318-320`
 *     （`:318` 记一次 `document.getModificationStamp()`，`:320` `expireWhen(… != stamp)` 号一变就让那份结果过期）。
 *
 * 提交信息框里的键入不在这一条上（上游 `:221` `getFile(event.document)` 对编辑器外的组件返回 null）⇒
 * 本仓 `watch(message, …)` 只清错误行，不 reset 结果。
 */
export function commitChecksFingerprint(rows: readonly CommitChecksFileRow[], unsaved: readonly string[] = [],
                                        revisions: readonly DocumentRevision[] = []): string {
  const changed = rows.filter(row => !row.ignored)
    .map(row => `${row.staged ? '+' : '-'}${row.path}:${row.indexStatus}${row.workStatus}${row.untracked ? '?' : ''}`)
    .sort()
  // 修订段（第 3 段）：过 `:191-199` 那道筛的每篇文档一个号；没给 = 整段不出现。
  const docs = revisions.filter(item => documentAffectsCommitChecksResult(item, rows))
    .map(item => `${item.path}@${item.revision}`)
    .sort()
  return `${changed.join('|')}#${[...unsaved].sort().join('|')}${docs.length ? `#${docs.join('|')}` : ''}`
}

/**
 * 一轮检查跑完之后落在哪一档（`:530-563`）。
 *
 * @param failures 这一轮报出来的失败（带相位）。
 * @param onlyRunChecks `isOnlyRunCommitChecks`：「只跑检查」那条路（失败行上的刷新按钮）。
 *   没有失败时它记 PASSED，而提交路径记 UNKNOWN —— 上游的理由写在 `:543`：
 *   "We are going to commit, remembering the result is not needed."
 * @param postRound 这一轮是**提交后**那一轮（`runSyncPostCommitChecks` `:503-514` ⇒ POST_FAILED；
 *   留痕：原写 `:505-513`，`：505` 是参数行）。
 * @param error 这一轮抛错或被中断（`NonModalCommitChecksFailure.ABORTED` / `ERROR` ⇒ FAILED，`:558-562`；
 *   留痕：原写 `:558-560` —— 那句赋值在 `:561`）。
 */
export function checksResultAfter(input: {
  failures: readonly PhaseTaggedFailure[]
  onlyRunChecks: boolean
  postRound?: boolean
  error?: boolean
}): RecentCommitChecks {
  if (input.error) return 'failed'
  if (input.failures.length === 0) return input.onlyRunChecks ? 'passed' : 'unknown'
  // 提交后那一轮报出来的失败归 POST_FAILED：它是唯一让"下一次提交连提交前检查都跳过"的档（`:229-232`）。
  if (input.postRound) return 'postFailed'
  return input.failures.some(failure => failure.phase === 'early') ? 'earlyFailed' : 'modificationsFailed'
}
