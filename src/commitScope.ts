/**
 * 部分提交（「提交文件…」）的**范围层**：这一次到底把哪些路径交给 git，以及提交完该报几个变更。
 *
 * 上游那条链（逐行开过，全部来自本机参考树）：
 *  · 入口 `CheckinFiles` —— `platform/vcs-impl/resources/META-INF/VcsActions.xml:18` 声明、
 *    `:187` 把它挂在 `ChangesViewPopupMenu` 的**第一行**（本仓的右键菜单在
 *    `src/changesMenuActions.ts` 的 `commitFile` 那一行，同位）；
 *  · 动作 `platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/CommonCheckinFilesAction.kt`
 *    `:37-53`（`actionPerformed`：`pathsToCommit = VcsContextUtil.selectedFilePaths(...)` →
 *    `performCommonCommitAction(...)`）、`:57-61`（标题「提交 N 个文件…」，
 *    `VcsBundle.properties:109-110` + `:5` 的 `Comm_it`）、`:75-78`（`isActionEnabled`：
 *    `NOT_CHANGED` 与 `IGNORED` 都不给点）；
 *  · 范围 `platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/CheckinActionUtil.kt`
 *    `:104-106`（被选的 changes 与未版本管理文件各取一份，再过 `DescindingFilesFilter`）、
 *    `:121-147`（`performCheckInAfterUpdate` → `workflowHandler.setCommitState(initialChangeList, included, …)`）、
 *    `:153-167`（`getIncludedChanges`：选中项为空时才按 `pathsToCommit` 去 `allChanges` 里筛，
 *    并且**总是**把 `resolvedConflictPaths` 并进去）；
 *  · 落到 git `plugins/git4idea/backend/src/checkin/GitCheckinEnvironment.kt`
 *    `:329-366`（`commitRepository`，函数体到 `:366` 的 `}`）与 `:393-434`（`stageAndCommit`）：
 *    `toCommitAdded = rootChanges.mapNotNull { afterPath }` / `toCommitRemoved = ... beforePath`
 *    （`:403-404`）—— **一个重命名是一条 `ChangedPath`，两朵路径由同一条变更一起带过去**；
 *    然后 `GitStagingAreaStateManager.prepareStagingArea(...)`（`:407-408`）把**不属于这次**的暂存项
 *    临时退回（`GitResetAddStagingAreaStateManager.kt:30-60`，`:35` 先 `validateNoUnmerged()`），
 *    `GitFileUtils.stageForCommit(...)`（`GitFileUtils.kt:156-179`：删除侧 `git rm --cached -r
 *    --ignore-unmatch`、新增侧 `addPathsForce`）把被选项刷进 index，
 *    再跑**不带 pathspec** 的 `git commit -F <消息文件>`（`GitRepositoryCommitter.kt:77-108`），
 *    退出 `stagingAreaManager.use { ... }` 时把那批退回的暂存项恢复回去
 *    （`GitStagingAreaStateManager.kt:24-28` `restore()` ← `close()`）。
 *
 * 本仓选的那条更短的路径与差异（实测见 `docs/batch-2026-10-06-partialcommit.md`，全部用唯一临时仓跑过）：
 *  · `git commit --only -- <paths>` 让 git 用**工作区内容**构造这一次提交，被选项的暂存/未暂存两半
 *    一起进去（实测 `MM` 的文件提交完工作区干净），**其余暂存项原地不动**（实测 `M ` 的另一篇提交后
 *    仍是 `M `）⇒ 上游"退回—提交—恢复"那三步 observable 结果一样，本仓不需要恢复失败的回滚面；
 *  · 未跟踪的被选项 git 不认 pathspec（实测 `error: pathspec 'c.txt' did not match any file(s)
 *    known to git`）⇒ 由 native 只对**未跟踪的那几条**先 `git add`（`native/git.cpp` 的 `commit(..., paths)`）；
 *  · **上游那三步里 `git add` 只吃 `afterPath` 那一侧**，所以重命名的旧路径走 `git rm --cached
 *    --ignore-unmatch`（`GitFileUtils.kt:163-170`）。本仓不能照抄"把两朵路径都丢给 `git add`"：
 *    实测 `git add -- <旧路径>` 对已 `git mv` 的那一半直接 `fatal: pathspec ... did not match any
 *    files`（退出码 128，`--ignore-errors` 也压不住）⇒ native 改成只 add 未跟踪项，旧路径原样进
 *    pathspec 就能提交成 `R100`（实测）。
 *
 * 三条口径的出处：
 *  · **重命名成对**＝上游一条 `ChangedPath` 两朵路径（`GitCheckinEnvironment.kt:403-404`）。单边提交
 *    实测会写出坏历史：只给新路径 ⇒ 提交是 `A e.txt`（"create mode"），HEAD 里的旧路径**还在**，
 *    检出来等于复制一份；只给旧路径 ⇒ 提交是 `D d.txt`，新内容留在 index 里没提交。两朵都给 ⇒
 *    `R100 d.txt e.txt`，工作区干净；
 *  · **空选择不静默降级成全量**：上游那句「选择要提交的文件」= `VcsBundle.properties:17`
 *    （`error.no.changes.to.commit`，中文包同键 `localization-zh.jar!messages/VcsBundle.properties:519`），
 *    本仓它的**唯一**生产落点是 `src/commitCheck.ts:106`（`commitBlockMessage('no-changes')`），
 *    判据链是 `commitIncludedCount`（同文件 `:75-84`，与这里共用 `commitScopeCovers`）⇒
 *    提交按钮被禁 + 错误行说这一句。本模块**不再另立一份常量与判断**（2026-10-06 partialcommit 收尾订正：
 *    原来这里还有个 `commitScopeProblem`/`COMMIT_SCOPE_EMPTY`，仓里没有生产消费方，是第二把"同一句话"，
 *    已删；空范围那一档的判据改钉在真正跑的那条链上，见 `tests/commit-scope.test.mjs` 边界三）；
 *  · **未跟踪的被选项照原样纳入**＝`CheckinActionUtil.kt:104-105` 把 `UNVERSIONED_FILE_PATHS_DATA_KEY`
 *    与被选 changes 各取一份，`:164-166` 的 `getIncludedChanges` 把它们 concat 在一起。
 *
 * 目录与其子项同时选中**不并掉**：`DescindingFilesFilter.java:27-69` 在 `:36-39` 先问
 * `AbstractVcs#allowsNestedRoots`，而 git 那一支答 true（`plugins/git4idea/backend/src/GitVcs.java:260-263`）
 * ⇒ 上游对 git 仓库一个路径都不并，本仓也不做祖先折叠（`src/commitChecks.ts` 里那条留痕同一口径）。
 *
 * 2026-10-06 partialcommit 收尾补的一条实测：pathspec 里的 `*` / `?` / `[` 是 git 的**通配**，
 * 不是字面量 ⇒ 一条"看起来只选了一篇"的 pathspec 能把别的也提交走（实测临时仓里
 * `git commit --only -- 'foo[1].ts'` 一次提交走 `foo[1].ts` **和** `foo1.ts` 两篇）。
 * 上游没有这个问题（它不用 pathspec，改的是 index，见文件头）；本仓这道闸在
 * `src/commitChecks.ts` 的 `commitPathProblem` 里先拒掉这种形状，native 那一头要补同一道
 * （请求见 `docs/wiring-requests-2026-10-06-partialcommit.md` W3）。
 */

/** 范围层要看的变更行（结构上就是 `GitChange`，`src/vcsLogTypes.ts:3`）。 */
export interface CommitScopeRow {
  path: string
  untracked: boolean
  /** 已在暂存区（porcelain 的 X 不是空格）—— "留在暂存区没进这次提交"那一档要看它。 */
  staged?: boolean
  /** 「显示忽略的文件」开着时才列出来的那些 —— 上游 `FileStatus.IGNORED`。 */
  ignored?: boolean
  /** 重命名/复制的另一头（porcelain 里 `R  <新> -> <旧>` 的旧路径）。 */
  renameFrom?: string
}

/** 标题里那个数量（`CommonCheckinFilesAction.kt:57-61` 的 `action.name.checkin.file`）。 */
export const COMMIT_SCOPE_LABEL = '提交文件…'

/** 去空白、并重复、保顺序（与 `src/commitChecks.ts` 的 `commitPathsToSubmit` 同一口径）。 */
export function normalizeCommitSelection(paths: readonly string[] | undefined): string[] {
  return [...new Set((paths ?? []).map(path => path.trim()).filter(Boolean))]
}

/**
 * 选中项 → 交给 git 的 pathspec，**把重命名对补齐**。
 *
 * 两个方向都补（面板的行以新路径为键，宿主直接给的 `commitPaths` 却可能是旧路径）：
 *  · 选中的是某行的 `path` 且该行带 `renameFrom` ⇒ 追加那个旧路径；
 *  · 选中的是某行的 `renameFrom` ⇒ 追加该行的 `path`（新路径）。
 * 补完仍去重保序：原顺序里在前的路径在前，补出来的伙伴紧跟在它后面（git 的 pathspec 无序，
 * 但"紧跟"让请求体里的一对一眼能对上，日志与判据都好读）。
 */
export function expandCommitSelection(paths: readonly string[] | undefined,
                                      rows: readonly CommitScopeRow[]): string[] {
  const selected = normalizeCommitSelection(paths)
  if (!selected.length) return []
  const byOldPath = new Map<string, string>()
  for (const row of rows) if (row.renameFrom) byOldPath.set(row.renameFrom, row.path)
  const out: string[] = []
  const seen = new Set<string>()
  const push = (path: string) => { if (!seen.has(path)) { seen.add(path); out.push(path) } }
  for (const path of selected) {
    push(path)
    const row = rows.find(candidate => candidate.path === path)
    if (row?.renameFrom) push(row.renameFrom)
    else {
      const partner = byOldPath.get(path)
      if (partner) push(partner)
    }
  }
  return out
}

/**
 * 单条 pathspec 覆不覆得到这一行 —— 全仓唯一的一份判定。
 * 三个调用方共用它（各写一份就会漂）：`src/commitChecks.ts` 的"这条路径有没有可提交的变更"、
 * `src/commitCheck.ts` 的 `commitIncludedCount`（提交按钮那把"有没有内容"）、本模块下面那三个计数。
 * 目录 pathspec 算它下面的每一行（git 的 pathspec 就是这个语义，且**不做祖先折叠**，见文件头）；
 * 重命名的另一头（`renameFrom`）也算覆盖到 —— 上游把两朵路径算作同一条变更
 * （`GitCheckinEnvironment.kt:403-404`），只给旧路径那一半同样是一次真提交
 * （native 那四条 case 里实测：两朵一起给才是 `R100`）。
 */
export function commitScopeCovers(pathspec: string, row: CommitScopeRow): boolean {
  return row.path === pathspec || row.renameFrom === pathspec || row.path.startsWith(`${pathspec}/`)
}

/** 这一行是否被这批 pathspec 覆盖到。 */
function rowCoveredBy(pathspec: readonly string[], row: CommitScopeRow): boolean {
  return pathspec.some(path => commitScopeCovers(path, row))
}

/**
 * 提交完该报的数：`vcs.commit.files.committed` 的那个 `changesCommitted`
 * （`ShowNotificationCommitResultHandler.kt:42-43`，`changes` 是**这次包含的那些变更**，
 * 计数走 `:128` 的 `HashSet(changes).size`）。
 * 关键差异：一个重命名是**一条变更、两朵 pathspec** ⇒ 数变更而不是数路径，
 * 否则「提交文件…」选中一次重命名会报成"2 个文件已提交"。
 * 两档都不数**被忽略**的行：上游 `isActionEnabled`（`CommonCheckinFilesAction.kt:75-78`）对
 * `FileStatus.IGNORED` 直接不启用，那些行进不了这次提交 ⇒ 数它们就是把没提交的算成功
 * （2026-10-06 partialcommit 收尾订正：原来只有"没范围"那一档滤了 `ignored`，
 * 有范围那一档没滤，两档口径不一致）。
 */
export function committedChangeCount(paths: readonly string[], rows: readonly CommitScopeRow[]): number {
  const committable = rows.filter(row => !row.ignored)
  if (!paths.length) return new Set(committable.filter(row => row.staged && !row.untracked).map(row => row.path)).size
  return new Set(committable.filter(row => rowCoveredBy(paths, row)).map(row => row.path)).size
}

/** 有多少条 pathspec 是被选项自己的重命名对补出来的（界面那一行要说"含 1 对重命名"）。 */
export function renamePartnerCount(paths: readonly string[], rows: readonly CommitScopeRow[]): number {
  const given = new Set(normalizeCommitSelection(paths))
  let pairs = 0
  for (const row of rows) {
    if (!row.renameFrom) continue
    if (given.has(row.path) && given.has(row.renameFrom)) pairs++
  }
  return pairs
}

/** 被这次范围**排除在外**的已暂存变更数（实测它们提交后仍留在 index 里，一条不丢）。 */
export function leftBehindStagedCount(paths: readonly string[], rows: readonly CommitScopeRow[]): number {
  return rows.filter(row => row.staged && !row.untracked && !row.ignored && !rowCoveredBy(paths, row)).length
}
