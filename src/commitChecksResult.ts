// 提交检查结果的「上一次是什么」状态机 —— 上游 `RecentCommitChecks` 那一族。
//
// 上游出处（`platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt`，逐行核过）：
//   · `:667` `private enum class RecentCommitChecks { UNKNOWN, PASSED, EARLY_FAILED, MODIFICATIONS_FAILED,
//     POST_FAILED, FAILED, SMART_MODE_REQUIRED }`
//   · `:229-233` `willSkipCommitChecks()` = EARLY_FAILED || MODIFICATIONS_FAILED || POST_FAILED || smartChecksWereBlocked
//   · `:234-236` `willSkipEarlyCommitChecks()` = EARLY_FAILED || MODIFICATIONS_FAILED || POST_FAILED
//   · `:238-239` `willSkipModificationCommitChecks()` = MODIFICATIONS_FAILED || POST_FAILED
//   · `:241` `willSkipLateCommitChecks()` = POST_FAILED ／ `:243` `willSkipPostCommitChecks()` = POST_FAILED
//   · `:246-249` `resetCommitChecksResult()` = 状态回 UNKNOWN ＋ 藏起失败通知
//   · `:200-226` 两个监听（VFS 变化 / 文档变化）都先判 `isCommitChecksResultUpToDate == UNKNOWN` 早退（`:202`、`:218`），
//     再只认"影响检查结果的文件"（`:191-199` `areFilesAffectsCommitChecksResult`：在 VCS 下、在内容里、状态不是 IGNORED）。
//     **提交信息框里的键入不在这一条上**（那不是内容文件）⇒ 本仓也不能拿它当 reset。
//   · `:337-342` 每次会话开头：`skip* = !isOnlyRunCommitChecks && willSkip*()`，然后 `resetCommitChecksResult()`
//     ⇒「运行提交检查」（失败行上那把刷新按钮）**不跳过任何相位**，它是强制重跑。
//   · `:533-557` `handleCommitProblem`：没有失败 ⇒ `isOnlyRunCommitChecks ? PASSED : UNKNOWN`
//     （"We are going to commit, remembering the result is not needed"）；EARLY/MODIFICATIONS/POST 各归各档；
//     ABORTED 与 ERROR ⇒ FAILED。
//
// 本仓的相位映射（上游按 `CommitCheck.getExecutionOrder()` 分组：EARLY / MODIFICATION / LATE / POST_COMMIT，
// 见 `:372-375`；接口本身在 `platform/vcs-api/src/com/intellij/openapi/vcs/checkin/CommitCheck.kt:36`）：
//   · `early`          = 提交信息检查（`src/commitMessageInspection.ts`）—— 只看信息文本，与变更内容无关。
//   · `modifications`  = 提交前 TODO 预检 —— 它要读被改动文件的内容，落在 MODIFICATION 那一档。
//   · LATE 本仓没有生产者（上游那一档是"弹窗征求同意"的检查，`runLateCommitChecks` `:483-499`），
//     不造空相位；`willSkipLateCommitChecks` 因此不搬。
//   · SMART_MODE_REQUIRED 留着但不产生：上游那一档来自 dumb 模式下不可用的智能检查
//     （`handleDumbModeCompatibility` `:468-482`），本仓两条检查都不依赖索引（TODO 预检走 `search.run`
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

/** `willSkipCommitChecks()`（`:229-233`）：检查已经失败过 ⇒ 提交按钮改名「仍然{0}」，按下去跳过这些相位。 */
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

/** `resetCommitChecksResult()`（`:246-249`）：一律回 UNKNOWN。 */
export const resetCommitChecks = (): RecentCommitChecks => 'unknown'

/** 这次变化值不值得 reset（`:202`/`:218` 的 `== UNKNOWN` 早退）：已经是 UNKNOWN 就不动状态。 */
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
  /** 「显示忽略的文件」开着时才列出来的那些 —— 上游 `FileStatus.IGNORED` 要排除（`:212`）。 */
  ignored?: boolean
}

/**
 * 一篇文档的**修订号**（上游 `Document.getModificationStamp()`，
 * `platform/core-api/src/com/intellij/openapi/editor/Document.java:184-192`）：
 * 内容每变一次就换一个号（`DocumentImpl.java:171` + `DocumentModStamp.java:6-12`），
 * 与文件时间无关、也不要求是"递增 1"。宿主（CodeMirror / 标签页）给的号只用满足
 * "同一篇改一次就换一个、没改就不动"这一条。
 */
export interface DocumentRevision {
  path: string
  revision: number
}

/**
 * 变更集的指纹：`areFilesAffectsCommitChecksResult`（`:191-199`）在本仓的等价物。
 *
 * 上游看的是"这个文件在 VCS 下、在内容里、状态不是 IGNORED"；本仓拿到的就是 git 的变更列表
 * —— 列表里每一项天然在 VCS 下、在内容里，被忽略的那些带 `ignored` 标记 ⇒ 只把它们滤掉。
 * 指纹把 **是否暂存 + 路径 + 索引侧状态 + 工作区侧状态 + 是否未跟踪** 都算进去：光数条数会漏掉
 * "内容变了但文件还是那些"这一常见情形（上一版就是那样：改完文件再点提交仍然跳过检查、按钮还写着「仍然提交」）。
 *
 * `unsaved` = 编辑器里还没保存的路径（宿主的 `dirtyPaths`）：上游的第二个 listener 是
 * `DocumentListener.documentChanged`（`:216-225`），本仓的面板收不到逐次键入，只能拿"未保存清单"当代理
 * —— 第一次编辑会进清单（⇒ reset），同一文件之后继续编辑清单不再变（⇒ 这一条只覆盖一半，报告里已登记）。
 *
 * `editorEpoch` = 那条通道补齐后的**文档修订计数**（上游 `documentChanged` 的直接等价物：内容每变一次就
 * 进一个新值）。给了就把每一次键入都算进指纹；不给（`null`）时指纹的形状与本批之前**逐字一致**，
 * 免得宿主还没接线时行为先变了。
 * 接线请求：`docs/wiring-requests-2026-10-06-vcs2.md` W2（原写 `docs/wiring-requests-2026-10-06-vcs.md`——
 * 上一路 vcs 代理被切断时那份请求文档没落盘，本批改指 vcs2 并在里面补齐了宿主四段的可照抄代码）。
 *
 * `revisions` = **按文档分别记的修订号**（R2 这一批补的那一档，上游的真身）：
 *   · 上游 `Document` 自己就是一个 `ModificationTracker`，"内容每变一次戳就换一次"
 *     （`platform/core-api/src/com/intellij/openapi/editor/Document.java:25`、取值口 `:184-192`
 *     `getModificationStamp()` —— 注释写明"value changed by any modification of the content of the
 *     file… not related to the file modification time"）；每次文本变更都领一个新号
 *     （`platform/core-impl/src/com/intellij/openapi/editor/impl/DocumentImpl.java:171` 传
 *     `DocumentModStamp.next()`，该类注释 `platform/core-impl/src/com/intellij/openapi/editor/impl/DocumentModStamp.java:6-12`：
 *     "creating fresh document modification stamps during document text changes"）；
 *   · 提交检查那两侧的作废就是由这个"内容又变了"驱动的
 *     （`platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt:215-226`
 *     的 `addDocumentListener` / `documentChanged`，先过 `areFilesAffectsCommitChecksResult`
 *     `:191-200` 那道筛：在 VCS 下、在内容里、状态不是 IGNORED）；
 *   · 缓存键用这个号的写法在上游也有现成先例：拿一次 `document.getModificationStamp()`，
 *     号一变就让那份结果过期（`java/execution/impl/src/com/intellij/execution/filters/ExceptionLineParserImpl.java:318-320`）。
 *
 * **留痕（原写 X、实际 Y）**：派单给的候选坐标 `platform/analysis-impl/src/com/intellij/codeInspection/ex/impl/…`
 * 在参考树里**没有这一层目录**（真目录是 `platform/analysis-impl/src/com/intellij/codeInspection/ex/`，
 * 里面 `grep modificationStamp` 零命中）；提交检查那一支（`CommitChecks.kt` /
 * `NonModalCommitWorkflowHandler.kt`）也**不直接读** `getModificationStamp` —— 它是事件式的
 * （每次 `documentChanged` 触发一次 reset）。本仓收不到逐次键入事件，只拿得到"每篇文档现在第几号"，
 * 所以按上游那个号的语义做：**每篇文档一个修订号**，号变 ⇒ 指纹变（号不变 = 没编辑 ⇒ 指纹不变）。
 * 上一版只有一个全局计数（`editorEpoch`）：它既会把"别的文档动了一下"也算成这次变更集变了
 * （上游不会：`:222` 先问的是**这篇文件**影不影响检查结果），也在宿主没接时整档缺席 ⇒ 同一篇文档
 * 第二次编辑清单不变、指纹不变、上一次的 PASSED 永远不作废。`revisions` 就是补这一口。
 *
 * 只认"会影响检查结果"的那些路径（`:191-200` 的等价筛 = 非 ignored 的变更行，选中目录算它下面的行）；
 * 对不上号的路径**不进**指纹。空数组（宿主没接）时指纹与本批之前逐字一致。
 */
export function commitChecksFingerprint(rows: readonly CommitChecksFileRow[], unsaved: readonly string[] = [],
                                         editorEpoch: number | null = null,
                                         revisions: readonly DocumentRevision[] = []): string {
  const kept = rows.filter(row => !row.ignored)
  const changed = kept
    .map(row => `${row.staged ? '+' : '-'}${row.path}:${row.indexStatus}${row.workStatus}${row.untracked ? '?' : ''}`)
    .sort()
  const revision = editorEpoch === null ? '' : `@${editorEpoch}`
  // 修订段：按路径排序（顺序不算变化），只收"变更列表里有这一篇（或它属于被选目录）"的那些。
  const affecting = revisions
    .filter(item => kept.some(row => row.path === item.path || row.path.startsWith(`${item.path}/`)))
    .map(item => `${item.path}@${item.revision}`)
    .sort()
  const docs = affecting.length ? `#${affecting.join('|')}` : ''
  return `${changed.join('|')}#${[...unsaved].sort().join('|')}${revision}${docs}`
}

/**
 * 一轮检查跑完之后落在哪一档（`:533-557`）。
 *
 * @param failures 这一轮报出来的失败（带相位）。
 * @param onlyRunChecks `isOnlyRunCommitChecks`：「只跑检查」那条路（失败行上的刷新按钮）。
 *   没有失败时它记 PASSED，而提交路径记 UNKNOWN —— 上游的理由写在 `:543`：
 *   "We are going to commit, remembering the result is not needed."
 * @param postRound 这一轮是**提交后**那一轮（`runSyncPostCommitChecks` `:505-513` ⇒ POST_FAILED）。
 * @param error 这一轮抛错或被中断（`NonModalCommitChecksFailure.ABORTED` / `ERROR` ⇒ FAILED，`:558-560`）。
 */
export function checksResultAfter(input: {
  failures: readonly PhaseTaggedFailure[]
  onlyRunChecks: boolean
  postRound?: boolean
  error?: boolean
}): RecentCommitChecks {
  if (input.error) return 'failed'
  if (input.failures.length === 0) return input.onlyRunChecks ? 'passed' : 'unknown'
  // 提交后那一轮报出来的失败归 POST_FAILED：它是唯一让"下一次提交连提交前检查都跳过"的档（`:229-233`）。
  if (input.postRound) return 'postFailed'
  return input.failures.some(failure => failure.phase === 'early') ? 'earlyFailed' : 'modificationsFailed'
}
