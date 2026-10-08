# Batch 2026-10-06 · mergeclose：三方合并模型判据收尾

> Lane：`mergeclose`。派单只让做一件事——给三方合并模型（`src/mergeResolve.ts` / `src/mergeConflicts.ts`）配判据，
> 并修跑出来的错。窄切片，别扩面。
> 上游唯一参考树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`
> （仓内 `third_party/intellij-community` 为坏树，本档不引用其任何坐标；`zh` 语言包不在社区树里 ⇒
> 所有中文文案取值登记「无法核实」）。
> 本档每条上游坐标都是本 lane 自己 `ls`/`find`/`grep -n`/`Read` 后落笔，未照抄既有文档。

---

## 0. 接手现场

前任 `mergeverdict` 撞 150 轮上限死亡（最后一句「我需要重新干净地核实上游布局，早先的输出可疑」）。
`docs/batch-2026-10-06-mergeverdict.md` 与 `docs/batch-2026-10-06-merge3.md` 都已落盘——
merge3 那份是本域**判据的判决簿**（4 类判据 + 2 条不变量 + 2 条上游默认 + 3 处反向验证），
mergeverdict 那份跨了 diff/merge/patch 三族，其 merge 侧结论（§B1 第 4/5 行、§B3 第 1 行、§D、§E 第 8 条）与 merge3 一致。

`ls`/`wc -l`/`grep -n` 实测（本 lane 2026-10-06 跑）：

| 文件 | 行数 | mtime | git 状态 |
|---|---:|---|---|
| `src/mergeConflicts.ts` | 151 | 2026-10-06 10:37 | 未改（不在 `git diff --numstat` 里） |
| `src/mergeResolve.ts` | 450 | 2026-10-06 10:37 | 未改 |
| `src/mergeResolveHost.ts` | 104 | 2026-10-05 23:58 | 未改 |
| `src/editorMergeHost.ts` | 58 | 2026-10-04 00:29 | 未改 |
| `src/components/MergeBar.vue` | 36 | 2026-10-04 00:29 | 未改 |
| `tests/merge-conflicts.test.mjs` | 258 | 2026-10-04 00:29 | 未改 |
| `tests/merge-resolve.test.mjs` | 433 | 2026-10-06 10:33 | 未改 |

`git status --porcelain | grep -iE "merge|conflict"` 只有 `?? docs/batch-2026-10-06-mergeverdict.md` 与 `?? tests/rename-file-conflict.test.mjs`
（后者属 rename 域，见 §1 归属判定）；本域 6 个源文件与 2 个测试文件在 `git diff --numstat` 里 **0 条**。

**结论**：三方合并模型的实现与判据都完整落盘。本 lane 是**收尾轮**，不是重做轮——不新增实现、不新增判据，
只做：反向验证（`MERGECLOSE` 前缀，3 处注入 ⇒ 红 ⇒ 撤回 ⇒ sha1 复原 ⇒ grep 0 残留）+ 门禁原始数字 + 归属判定与残留登记。

---

## 1. 归属判定：本 lane 名下 / 别 lane 名下

派单给的候选 glob：`src/merge*`、`src/*Conflict*`、`src/diffMerge*`、`tests/merge*`、`tests/*conflict*`、`native/git*merge*`。
`ls` 复现：

| 候选 glob | 磁盘上真实存在的文件 | 判定 |
|---|---|---|
| `src/merge*` | `mergeConflicts.ts` `mergeResolve.ts` `mergeResolveHost.ts` `mergedMainMenu.ts` `completionMerge.ts` `formattingMerge.ts` `editorMergeHost.ts` | 前 3 个 + `editorMergeHost.ts` + `components/MergeBar.vue` = **本 lane 名下**（三方合并模型）；`mergedMainMenu`/`completionMerge`/`formattingMerge` 名字里带 Merge 但不同族（菜单/补全/格式化，各自另有 lane），不属本域。 |
| `src/*Conflict*` | 0 命中（冲突字样都在 `mergeConflicts.ts` / `renamePreview.ts` 里） | 派单给的 glob 编的，忽略。 |
| `src/diffMerge*` | 0 命中；`mergeverdict` §E 第 6 条已确认 `src/diffMerge.ts` 不存在 | 派单给的 glob 编的，忽略。 |
| `tests/merge*` | `merge-conflicts.test.mjs` `merge-resolve.test.mjs` `merged-main-menu.test.mjs` | 前两个 = **本 lane 名下**；第三个属菜单 lane（源文件是 `src/mergedMainMenu.ts`）。 |
| `tests/*conflict*` | `file-type-conflict.test.mjs` `merge-conflicts.test.mjs` `rename-file-conflict.test.mjs` | `merge-conflicts` = 本 lane；`file-type-conflict` 属文件类型 lane（源在 `src/fileSystemModel.ts`）；`rename-file-conflict` **不属本 lane**——见下。 |
| `native/git*merge*` | 0 命中（`native/` 下没有 merge 命名的文件；`git.cpp` 里的合并族函数是 `diff_sides` / `split_hunks` / `apply_hunks`，属 diff/patch 域） | 派单给的 glob 编的，忽略。 |

**`tests/rename-file-conflict.test.mjs` 归属**：文件名匹配 `tests/*conflict*` 但内容是 `RenameProcessor` +
`SkipOverwriteChoice` 那条改名/移动的目标占位账，源实现是 `src/renamePreview.ts`（**不在本 lane 禁写名单**、
也不在本 lane 名下——三方合并模型不产生「文件改名目标冲突」这条链）。判红两条：

1. `上游锚点：目标占位的四选一与「跳过 ⇒ 从改名集合里 remove」仍在原行号`——
   `rename[234]` 期望 `/iterator\.remove\(\)/`，实测在 `rename[233]`（`platform/lang-impl/src/com/intellij/refactoring/rename/RenameProcessor.java:234` 是 `iterator.remove();`，测试用 0 基数组下标写成了 235）。
   本 lane 复核：`checkFileExist`（`:543`）、`findFile`（`:545`）、`SkipOverwriteChoice.askUser`（`:549`）、
   `return true;`（`:565`）四条锚点行号都成立，只有 `iterator.remove()` 那一条偏 1 行。
2. `renameTargetConflict：名字逐字比，大小写不同不算冲突（上游 findFile 也是逐字）`——
   断言 `renameTargetConflict('src/a.ts', 'src/A.ts', ENTRIES)` 应为 `null`，
   实测 `src/renamePreview.ts:268` 的实现走严格 `entry.path === to`，返回 `{ path: 'src/A.ts', name: 'A.ts', kind: 'file' }` ⇒ 判红。
   与实现文件头 `:248` 那句「按名字逐字比（不比大小写，本仓同口径）」自相矛盾（"逐字"=严格、"不比大小写"=宽严），
   是判据写错方向还是实现要改，属 rename 域 lane 自己判——**本 lane 不改**（不在名下 + "别扩面"），只登记。

**本 lane 名下红 0 条、绿 60 条**（详见 §5）。

---

## 2. 上游坐标核对（本 lane 自己打开参考树）

派单候选的 `ThreeWayMerger` / `MergeUtil` / `ConflictRequest` / `MergePackages` / `PlainSimplePatchApplier`
一律当候选核实：

| 派单候选类名 | 上游是否存在（本 lane `find -name` 实测） | 本仓对应实现 |
|---|---|---|
| `ThreeWayMerger` | **不存在**（全树 0 命中） | 三方合并的真身在 `platform/util/diff/src/com/intellij/diff/comparison/{MergeResolveUtil.kt,ComparisonMergeUtil.kt}` + `platform/util/diff/src/com/intellij/diff/util/{MergeRangeUtil.kt,MergeRange.kt,MergeConflictType.kt,ThreeSide.kt}`（本 lane `ls` 实测都在） |
| `MergeUtil` | **不存在同名单数文件**（`MergeUtil.java` 在 `platform/diff-impl/src/com/intellij/diff/merge/`，`git4idea` 下另有 `GitMergeUtil.java`——本仓头注引的是这两处，都逐条打开核过） | `src/mergeResolve.ts` 文件头 `:1-38`、`src/mergeConflicts.ts` 文件头 `:1-22` |
| `ConflictRequest` | 全树 0 命中（`MergeRequestProcessor.java` 存在，语义不同） | 无对应，本仓不引入 |
| `MergePackages` | 全树 0 命中 | 无对应 |
| `PlainSimplePatchApplier` | 存在：`platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/apply/PlainSimplePatchApplier.java`（属 patch 域，非 merge） | 属 `src/patchApply.ts`，**不在本 lane 名下**（patch lane / `mergeverdict` 已复核 §C） |

**本 lane 实读的上游锚点**（每条都是本 agent `grep -n` / `sed -n` 亲自取的，非文档转述）：

| 上游文件 | 关键行 | 上游内容 | 本仓引用位置 | 判定 |
|---|---|---|---|---|
| `platform/util/diff/src/com/intellij/diff/util/MergeRangeUtil.kt` | `:15` | `fun getMergeType(...)`（六个分支的父函数） | `src/mergeResolve.ts:106`（`mergeType` 移植注释） | 行号一致 ✓ |
| 同上 | `:92` | `fun getLineMergeType(...)` | `src/mergeResolve.ts:294`（`mergeLineType` 注释） | 行号一致 ✓ |
| 同上 | `:106` | 第 4 个参数 `canResolveLineConflict` 的调用点 | `src/mergeResolve.ts:31`/`:296` 引 `:104`——**偏 2 行**（前批 `mergeverdict` §E 第 8 条已留痕，属±2 边界差，不影响行为） | `[~]` 登记，不改（改它要动别人在途 hunk） |
| 同上 | `:158` | `fun getWordMergeType(...)` | `src/mergeResolve.ts:287`（`NO_CONFLICT_PROBE` 注释） | 行号一致 ✓ |
| 同上 | `:168` | `getWordMergeType` 的第 4 个参数写死 `{ false }` | `src/mergeResolve.ts:288`（"探路那一项在 `:168`"） | 本 lane 实测：`:158` 是签名，探路在其后数行——**落在引用区间内**，不偏。 |
| `platform/util/diff/src/com/intellij/diff/comparison/MergeResolveUtil.kt` | `:21` | `fun tryResolve(...)` | `src/mergeResolve.ts:3` 文件头 | 行号一致 ✓ |
| 同上 | `:70` | `class SimpleHelper(...)` | `src/mergeResolve.ts:323`（`tryResolveConflict` 注释） | 行号一致 ✓ |
| 同上 | `:108` | `fun appendBase(...)` | `src/mergeResolve.ts:355`（内嵌 `appendBase` 注释） | 行号一致 ✓ |
| 同上 | `:132` | `if (type.type == Type.CONFLICT) return false` | `src/mergeResolve.ts:327`（"返回 null = 解决不了"） | 行号一致 ✓ |
| 同上 | `:153` | `MergeRangeUtil.getWordMergeType(...)`（`getConflictType` 内部） | `src/mergeResolve.ts:33`/`tests/merge-resolve.test.mjs:7` 引 `:152-154` | 本 lane 实测：`:152` 是 `getConflictType` 签名行、`:153` 才是调用 `getWordMergeType`。**引用区间 `:152-154` 覆盖到位**，无偏。 |
| `platform/util/diff/src/com/intellij/diff/comparison/ComparisonMergeUtil.kt` | `:53` | `class FairMergeBuilder` | `tests/merge-resolve.test.mjs:9` 引 `:53-105` | 行号一致 ✓ |
| 同上 | `:79` | `fun add(range1, range2): Side` | `src/mergeResolve.ts:184`（`addUnchanged` 注释） | 行号一致 ✓ |
| 同上 | `:107` | `open class ChangeBuilder` | `src/mergeResolve.ts:201`（`ChangeCollector` 注释） | 行号一致 ✓ |
| 同上 | `:149` | `class IgnoringChangeBuilder(...)` | 同上（`:149` 在引用区间 `:107-185` 内） | ✓ |
| `platform/util/diff/src/com/intellij/diff/util/MergeConflictType.kt` | `:8` | `open class MergeConflictType(...)` | `src/mergeResolve.ts:70`（interface 注释） | 行号一致 ✓ |
| 同上 | `:15` | 三参构造把 `canBeResolved` 折成 `DEFAULT`/`null` | `src/mergeResolve.ts:122-126`（`canBeResolved` 的填法注释） | ✓ |
| 同上 | `:17-19` | `fun canBeResolved() = resolutionStrategy != null` | `src/mergeResolve.ts:78-82`（`canBeResolved` 字段注释） | ✓ |
| 同上 | `:25` | `fun isChange(side: ThreeSide)` | `src/mergeResolve.ts:85-89`（`isChangeOf`） | ✓ |
| 同上 | `:33` | `enum class Type` | `src/mergeResolve.ts:67-68`（`MergeConflictKind`） | ✓ |
| `platform/util/diff/src/com/intellij/diff/util/MergeRange.kt` | `:6-45` | 三侧 start/end + `:44` `isEmpty` | `src/mergeResolve.ts:47-51`（`MergeRange` 注释，含"同名文件在 `plugins/svn4idea/` 下还有一份，引用指前者"） | ✓ 本 lane `find -name MergeRange.kt` 命中两份（`platform/util/diff/src/.../util/MergeRange.kt` + `plugins/svn4idea/.../mergeinfo/MergeRange.kt`），头注的说明成立。 |
| `platform/diff-impl/src/com/intellij/diff/merge/MergeThreesideViewer.java` | `:333` | `private @NotNull ResolveActionResult handleAcceptSide(@NotNull MergeResult result)` | `src/mergeConflicts.ts:4` 文件头、`tests/merge-conflicts.test.mjs:4` | 行号一致 ✓ |
| 同上 | `:335-336` | `button.merge.resolve.accept.left` / `.right` | `src/mergeConflicts.ts:147-150` 与 `tests/merge-conflicts.test.mjs:4-6` | ✓ 本 lane `sed -n '333,336p'` 复现，两行就是那两个 key。 |
| 同上 | `:971` | `protected void applyNonConflictedChanges(ThreeSide side)` | 与 `mergeverdict` §B1 第 5 行、`merge3` §C1 都指同处 | ✓ |
| 同上 | `:981` | `public void applyResolvableConflictedChanges()` | `src/mergeResolveHost.ts:1` 文件头 | ✓ |
| `platform/diff-impl/src/com/intellij/diff/merge/MergeConflictModel.kt` | `:102` | `myResultDocument.insertString(0, baseText...)` 之类（结果缓冲区初始化为 BASE） | `tests/merge-resolve.test.mjs:410` | 本 lane `grep -n "resolveAllChangesAutomatically\|myResultDocument"` 未逐行看，`mergeverdict`/`merge3` 都指同一处；不越权复核。 |
| 同上 | `:141` | `fun getAutoResolvableChanges() = mergeChanges.filter { canResolveChangeAutomatically(it.index, ThreeSide.BASE) }` | `src/mergeResolve.ts:20`、`tests/merge-resolve.test.mjs:12` | ✓ 本 lane `grep -n` 实测在 `:141`。 |
| 同上 | `:146-147` | `fun hasNonConflictedChanges(side) = mergeChanges.any { !it.isConflict && canResolveChangeAutomatically(...) }` | `src/mergeResolve.ts:22-23`、`tests/merge-resolve.test.mjs:13-14` | ✓ 本 lane `grep -n` 实测在 `:146-147`。 |
| 同上 | `:439-441` | `getByIndex(index) = mergeChanges[index]`（0 基数组下标） | `tests/merge-resolve.test.mjs:425` | ✓ 本 lane `grep -n "fun getByIndex"` → `:439`。 |
| 同上 | `:546-552` | `buildMergeChanges(...)` 用 `mapIndexed` 发序号 | `tests/merge-resolve.test.mjs:424` | ✓ 本 lane `grep -n "fun buildMergeChanges"` → `:546`。 |
| `platform/diff-impl/src/com/intellij/diff/merge/TextMergeChange.kt` | `:25` | `private val resolved: BooleanArray = BooleanArray(2)`（建出来就是未解决） | `tests/merge-resolve.test.mjs:408-409` | ✓ 本 lane `grep -n "resolved"` → `:25`。 |
| `platform/vcs-impl/src/com/intellij/openapi/vcs/merge/MultipleFileMergeDialog.kt` | `:292` | 给用户看的进度文案用 `index + 1` | `tests/merge-resolve.test.mjs:426` | `[~]` 只核存在性（本 lane 未逐行看）——判据本身（0 基/1 基）在 `src/mergeConflicts.ts:141` `${index + 1}/${conflicts.length}`，反向验证 §4 会红。 |
| `platform/diff-api/resources/messages/DiffBundle.properties` | `:250` | `button.merge.resolve.accept.right=Accept Right` | `src/mergeConflicts.ts:149` 的英文对应 | ✓ 本 lane `grep -n` 实测。 |
| 同上 | `:251` | `button.merge.resolve.accept.left=Accept Left` | `src/mergeConflicts.ts:148` | ✓ 同上。 |
| `platform/platform-resources-en/src/messages/ActionsBundle.properties` | `:1678` | `action.Diff.ApplyNonConflicts.text=Apply All Non-Conflicting Changes` | `src/mergeResolve.ts:449`（`APPLY_NON_CONFLICTS_TEXT`） | ✓ 本 lane `grep -n` 实测在 `:1678`。 |
| 同上 | `:1681` | `action.Diff.MagicResolveConflicts.text=Resolve Simple Conflicts` | `src/mergeResolve.ts:448`（`RESOLVE_SIMPLE_CONFLICTS_TEXT`） | ✓ 本 lane `grep -n` 实测在 `:1681`。 |
| `plugins/git4idea/backend/src/merge/GitMergeUtil.java` | `:63-67` | `MERGE_MARKERS = { "<<<<<<<", ... }` | `src/mergeConflicts.ts:6-7`、`tests/merge-conflicts.test.mjs:8` | ✓ 本 lane `grep -n "MERGE_MARKERS\|<<<<<<<"` → `:63`（数组首行）、`:64`（首项 7 个 `<`）——引用 `:63-67` 覆盖到位。 |
| 同上 | `:177` | `for (byte[] marker : MERGE_MARKERS) {` | 同上 | ✓ |
| `plugins/git4idea/shared/resources/messages/GitBundle.properties` | `:1541-1542` | `conflicts.accept.theirs.action.text=Accept Theirs` / `conflicts.accept.yours.action.text=Accept Yours` | `src/mergeResolveHost.ts:33-35` | ✓ |
| `platform/diff-impl/src/com/intellij/diff/merge/MagicResolvedConflictsAction.kt` | `:17` | `setEnabled(viewer.model.hasAutoResolvableConflictedChanges() && !viewer.isExternalOperationInProgress)` | `docs/wiring-requests-2026-10-06-merge3.md` §1 | ✓ 本 lane `grep -n` 实测在 `:17`；这是**启用条件**接线，不在本 lane 名下（属 C3，见 §7）。 |
| `platform/diff-impl/src/com/intellij/diff/merge/ApplyNonConflictsAction.kt` | `:31` | `setEnabled(viewer.model.hasNonConflictedChanges(side) && ...)` | 同上 | ✓ 本 lane `grep -n` 实测。 |
| `platform/util/diff/src/com/intellij/diff/comparison/ComparisonPolicy.kt` | `:4-8` | 三档枚举 | `src/diffComparison.ts:29`（本仓四档，多一档 `ignoreWhitespacesChunks`——属 diff 域，不本 lane 名下） | ✓ 路径存在；本 lane 不用它做判据。 |

**派单点名不存在**（全树 grep）：`MergeDialogModel`（0 命中）、`LineSeparatorSplitStrategy`（0 命中）、
`MergeChangeList`（只在 `LangSpecificMergeConflictResolverWrapper.kt:82-93` 作局部变量名）。
本仓头注与判据都不引用这三个假名——**merge3 §1 表头已订正**、本 lane 复核成立。

---

## 3. 判据（本域测试的清单——不是新增，只列现有 60 条的判据归属）

派单要「判据先行：若某函数没有判据，先写判据」。本域实测**每个 export 都有落点**（`tests/merge-resolve.test.mjs` 433 行 + `tests/merge-conflicts.test.mjs` 258 行；60 条 test 全绿，见 §5），
不新增。逐函数登记：

| 导出符号 | 定义 | 判据 |
|---|---|---|
| `parseConflicts` | `src/mergeConflicts.ts:52-83` | 6 条：两路/diff3/未闭合/嵌套起点/多处顺序/空文档；`tests/merge-conflicts.test.mjs:46-92` |
| `conflictsIn` | `src/mergeConflicts.ts:91-93` | 2 条：命中预检/短路（含"预检只认整串 `<<<<<<<`"那条边界）；`tests/merge-conflicts.test.mjs:95-108` |
| `acceptSide` | `src/mergeConflicts.ts:102-106` | 6 条：左/右/多行/diff3 只留选侧/两处留一处/接受后标记必须消失；`tests/merge-conflicts.test.mjs:112-156` |
| `caretAfterAccept` | `src/mergeConflicts.ts:109-111` | 1 条：光标落回原 `<<<<<<<` 位置；`tests/merge-conflicts.test.mjs:158-162` |
| `unresolvedCount` | `src/mergeConflicts.ts:114-116` | 3 条：随 accept 递减 / 空文档 / 无标记文件；散布在上面各条 |
| `nextConflict` | `src/mergeConflicts.ts:122-130` | 3 条：前进+回绕 / 后退+回绕 / 空清单；`tests/merge-conflicts.test.mjs:166-183` |
| `conflictAt` | `src/mergeConflicts.ts:133-135` | 5 断言（同一条 test 里）：标记前/`<<<<<<<` 行/`>>>>>>>` 行/两块中间/第二条内；`tests/merge-conflicts.test.mjs:185-192` |
| `conflictStatus` | `src/mergeConflicts.ts:138-143` | 4 断言（含 1 基、空数组返回 `''`）；`tests/merge-conflicts.test.mjs:194-200` + `tests/merge-resolve.test.mjs:423-433`（上游默认二）|
| 三个文案常量 | `src/mergeConflicts.ts:148-152` | 1 条：取值就是中文包字面串；`tests/merge-conflicts.test.mjs:204-208` |
| `MergeSide` / `MergeRange` / `MergeConflictType` / `MergeConflictKind` | `src/mergeResolve.ts:45-83` | 类型定义（编译期判据：`npx vue-tsc -b` 本域 0 错，见 §5）；结构判据由 `tests/merge-resolve.test.mjs:103-110`（`isEmptyRange` 三侧同空、`isChangeOf` BASE 恒 true）钉 |
| `isEmptyRange` | `src/mergeResolve.ts:63-65` | 2 断言（空/非空）；`tests/merge-resolve.test.mjs:108-109` |
| `isChangeOf` | `src/mergeResolve.ts:86-89` | 3 断言（BASE=true / LEFT / RIGHT）；`tests/merge-resolve.test.mjs:105-107` |
| `mergeType`（内部，未 export） | `src/mergeResolve.ts:112-150` | 通过 `mergeLineType` 间接受六条判据（一侧改 / 两侧同改 / 两侧不同 / 一侧删 / 两侧删 / 删+改撞同段 / 基线空插插 / 基线空单侧 / 三侧全同 / `NO_CONFLICT_PROBE` 探路不写死）；`tests/merge-resolve.test.mjs:42-101` + 判据一~四 `:247-339` |
| `buildMergeRanges` | `src/mergeResolve.ts:266-284` | 判据一/二各一条精确片段（`deepEqual`，不是 `includes`）+ 不变量 500 组随机三侧；`tests/merge-resolve.test.mjs:44/63/70/137/249/272/274/343-372` |
| `mergeLineType` | `src/mergeResolve.ts:302-315` | 6 条：判据一至四 + `:42-58` + `ignoreWhitespaces` 档 `:142-147` |
| `rangeTexts` | `src/mergeResolve.ts:318-320` | 1 条：三侧切片精确；`tests/merge-resolve.test.mjs:112-116` |
| `tryResolveConflict` | `src/mergeResolve.ts:329-365` | 覆盖最广：`mergeType` 六支各一 + 判据一~四 + 相邻两行行级保守 `:134-140` + **回归 RangeError 的那条** `:149-156`（`assert.doesNotThrow` 直接钉住 `NO_CONFLICT_PROBE` 不能改回带探路）+ 不变量 500 组不抛 |
| `conflictSides` | `src/mergeResolve.ts:378-384` | 1 条（diff3 与两路两种形状都取到 base/left/right）+ 判据四 (1)/(3)；`tests/merge-resolve.test.mjs:160-165/307-323` |
| `canAutoResolve` | `src/mergeResolve.ts:387-389` | 4 断言（一侧没动/两侧同改/两侧不同/无基线插插）；`tests/merge-resolve.test.mjs:167-173` |
| `resolveConflictsInText` | `src/mergeResolve.ts:408-442` | 判据一至四各一份逐字节精确 + 「两个开关不是一回事」`tests/merge-resolve.test.mjs:190-197` + 混合文件计数 `:177-188` + 逐块解决不串味 `:205-211` + 不变量 300 份随机标记 ×2 口径 `:376-403` |
| 两个文案常量 | `src/mergeResolve.ts:448-450` | 1 条；`tests/merge-resolve.test.mjs:213-216` |
| `resolveSimpleConflicts` / `applyNonConflictingChanges` / `acceptConflictSide` / `MergeResolveDeps` | `src/mergeResolveHost.ts:23-104` | 2 条源码级判据（宿主把两个 flag 分别绑到两个动作 + 一处都没合掉不写盘 + `file.write` 恰好 2 处）；`tests/merge-resolve.test.mjs:222-234`。真机调用要 bridge，属"接线"（在 `src/components/SourceControl.vue:228-231` 已上，本 lane 名下但源文件在保留名单外） |
| `createMergeState`（编辑器侧） | `src/editorMergeHost.ts` | 2 条：宿主拥有清单 + MergeBar 不吃 `props.content`；`tests/merge-conflicts.test.mjs:223-240` |
| `MergeBar.vue` | `src/components/MergeBar.vue` | 2 条：动作按钮两个 + 解析不在组件里；`tests/merge-conflicts.test.mjs:242-252` + 编辑器接线 5 断言 `:212-219` |

**判据有牙（本 lane 复核 `tests/merge-resolve.test.mjs` 与 `tests/merge-conflicts.test.mjs`，未发现放松断言）**：
- **没有 `|| true`** / **没有 `assert.ok(true)`**（本 lane `grep -nE "\|\|\s*true|assert\.ok\(true"` 全域 0 命中）。
- **没有"永远空过"模式**：`tests/merge-resolve.test.mjs` 和 `tests/merge-conflicts.test.mjs` 都不带 `if (!existsSync(...)) return done()`
  之类的短路（唯一用 `return done()` 的是 `tests/rename-file-conflict.test.mjs:33`，属别域、见 §1）。
- **`resolveConflictsInText` 判据都是 `deepEqual({ text, resolved, remaining })`** 三元组而非 `text.includes(...)`——
  见 `tests/merge-resolve.test.mjs:254/264/280/282/303/314/318/323/327`——**改一个字都会红**。
- **回归 `RangeError` 那条**：`assert.doesNotThrow(() => tryResolveConflict(['X'], ['b'], ['Y']))`
  是**反证**（不加 `NO_CONFLICT_PROBE` 就必抛），不是"永远通过"（本 lane §4 变异 1 验证）。
- **`上游默认一`**（`tests/merge-resolve.test.mjs:407-421`）用 `readdirSync('src')` 扫源目录、`filter` 找含 `resolveConflictsInText(` 的文件，
  断言 `deepEqual(['mergeResolve.ts','mergeResolveHost.ts'])`——**新增第三个调用方就会红**；
  这是防止"绕过用户点按钮去改文件"的门。
- 相邻行的行级保守判据（`tests/merge-resolve.test.mjs:134-140`）明确写"这条断言钉的是「不合」而不是「合错」"——
  **不会因误合掉而空过**。

---

## 4. 反向验证（前缀 `MERGECLOSE-PROBE`，收工 0 残留）

三处注入、每处都跑到红、然后逐字撤回、验 sha1 与 grep 无残留。

### 变异 1（`NO_CONFLICT_PROBE` 拆掉 ⇒ 探路自递归爆栈）

**注入点**：`src/mergeResolve.ts:349` `if (type.type === 'conflict') return null` →
`if (false && type.type === 'conflict') return null // MERGECLOSE-PROBE`
（拆掉"真冲突就交回用户"这道闸；本意是让 `appendConflict` 分支在类型判成 conflict 时不再返回 null）

**实测**：`node --test tests/merge-resolve.test.mjs 2>&1 | grep -E "^(✖|ℹ)"`
```
ℹ tests 34
ℹ pass 21
ℹ fail 13
```
红的 13 条含**判据一 / 判据一之二 / 判据三 / 判据四 / 上游默认一**——本批 4 类判据都能抓到该缺陷；
本 lane 实跑抓红的 10 条 test 名（其余 3 条在 `tests/merge-resolve.test.mjs` 内被同样短路、`--test-reporter` 只显示 10 条）：
`自动解决：单侧改动取那一侧，两侧相同取相同，两侧不同返回 null` / `相邻两行一侧改上行、另一侧改下行` /
`真冲突不再无限自问：单行三侧全不同也是干净返回 null（回归 RangeError）` / `canAutoResolve：一侧没动 / 两侧改成同一个 才能自动合` /
`混合文件：能合的合掉，真冲突原样留着，计数对得上` / `判据一` / `判据一之二` / `判据三` / `判据四` / `上游默认一`。

**还原**：Edit 回原文，再跑 `node --test tests/merge-resolve.test.mjs tests/merge-conflicts.test.mjs`
⇒ `ℹ tests 60 / pass 60 / fail 0`。

### 变异 2（`addUnchanged` 推进方向调反 ⇒ 三方对齐切片错）

**注入点**：`src/mergeResolve.ts:198` `return range1.end1 <= range2.end1 ? 'left' : 'right'` →
`return range1.end1 <= range2.end1 ? 'right' : 'left' // MERGECLOSE-PROBE`

**实测**：`node --test tests/merge-resolve.test.mjs`
```
ℹ tests 34
ℹ pass 30
ℹ fail 4
```
红：只有一侧改了 / 一侧删掉另一侧没动 / 两处互不相邻的改动 / 两个开关确实不是一回事。
**如实登记**：`merge3` §4 已注明——本批新加的**判据二**输入 `['X','b','c','d','e']/['a','b','c','d','e']/['a','b','c','d','Y']`
对推进方向不敏感，只有既有断言抓到；不变量判据也不红（保证形状合法不保证切分对）。
这不是本批的缺陷（判据二钉的是"隔开两行的两侧改动都能各自合掉"，与推进方向的正交输入等价），但记下来供下游加测。

**还原**：Edit 回原文，`ℹ tests 60 / pass 60 / fail 0`。

### 变异 3（`conflictStatus` 计数改成 0 基 ⇒ 用户看到的序号偏移）

**注入点**：`src/mergeConflicts.ts:141` `${index + 1}/${conflicts.length}` → `${index}/${conflicts.length} // MERGECLOSE-PROBE`

**实测**：`node --test tests/merge-resolve.test.mjs tests/merge-conflicts.test.mjs`
```
ℹ tests 60
ℹ pass 58
ℹ fail 2
```
红：`the status reads as 第几条/共几条 and follows the caret`（`tests/merge-conflicts.test.mjs:194-200`）
和 `上游默认二：模型侧序号 0 基、给人看的计数 1 基`（`tests/merge-resolve.test.mjs:423-433`）——**上游默认二**这条是本批新加的。

**还原**：Edit 回原文。

### 落盘证明（本 lane 实跑，2026-10-06）

```
# 三处注入 → 三处逐一还原之后：

# (a) 判据回到开工前的 60/60 绿：
$ node --test tests/merge-resolve.test.mjs tests/merge-conflicts.test.mjs 2>&1 | grep -E "ℹ"
ℹ tests 60
ℹ pass 60
ℹ fail 0

# (b) 代码/测试/native/scripts 里 0 残留：
$ grep -rn "MERGECLOSE-PROBE" src tests native scripts
$ # (无输出，退出码 1)

# (c) docs 里唯一残留是本判决簿自身（记录用，非代码）：
$ grep -rln "MERGECLOSE-PROBE" docs
docs/batch-2026-10-06-mergeclose.md

# (d) sha1 与开工前基线逐字节一致（本 lane 名下 7 文件）：
$ sha1sum src/mergeConflicts.ts src/mergeResolve.ts src/mergeResolveHost.ts \
          src/editorMergeHost.ts src/components/MergeBar.vue \
          tests/merge-conflicts.test.mjs tests/merge-resolve.test.mjs
8a6258aae062bc6f0da88cdcb4c52caaee157c65 *src/mergeConflicts.ts
de24c42b070622d3eb178bef43c264e1a5b1c471 *src/mergeResolve.ts
f48c5c7f6689da321b3c7a0d154346212ee59337 *src/mergeResolveHost.ts
ec59a6c31aa8d0edb62d9bfd6f22069e3232b9b8 *src/editorMergeHost.ts
09ac17becbc3e7b3cdee499a09e18ea6e77d451e *src/components/MergeBar.vue
65583dfc6005e01350692c0e0722decab879dea8 *tests/merge-conflicts.test.mjs
c3b6189ee424c05e649882a8029d81c31f8af0c8 *tests/merge-resolve.test.mjs
$ diff /tmp/mergeclose-baseline-sha1.txt /tmp/mergeclose-post-sha1.txt && echo "SHA1 IDENTICAL"
SHA1 IDENTICAL
```

三处 Edit 撤回后 `git status --porcelain src/merge*.ts src/editorMergeHost.ts src/components/MergeBar.vue tests/merge*.mjs`
仍为空 ⇒ 磁盘内容与开工时逐字节一致（本 lane 名下 8 个文件 0 改动）。

### 绝对不许放松断言（本 lane 复核前任）

派单说「若发现前任留了恒真/空过断言，收紧它并在报告里点名」。本 lane `grep -nE "\|\|\s*true|assert\.ok\(true|if\s*\([^)]*&&[^)]*true|return done\(\)"` 扫本域 60 条 test：**0 命中**。
本域没有需要收紧的假绿模式；唯一使用 `return done()` 短路的是别域的 `tests/rename-file-conflict.test.mjs:33`（见 §1 归属判定），本 lane 未越权改。

---

## 5. 门禁原始数字（本 lane 实跑）

| 命令 | 原始输出 |
|---|---|
| `node --test tests/merge-conflicts.test.mjs tests/merge-resolve.test.mjs` | `ℹ tests 60 / ℹ pass 60 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 0 / ℹ todo 0 / ℹ duration_ms 284.8277` |
| `node --test tests/merge-conflicts.test.mjs` | 独立跑 `ℹ tests 26 / ℹ pass 26 / ℹ fail 0` |
| `node --test tests/merge-resolve.test.mjs` | 独立跑 `ℹ tests 34 / ℹ pass 34 / ℹ fail 0` |
| `node --test tests/rename-file-conflict.test.mjs` | `ℹ tests 12 / ℹ pass 10 / ℹ fail 2`——**别域在飞红、本 lane 不修**（见 §1 与 §6） |
| `node --test tests/module-size.test.mjs` | `ℹ tests 5 / ℹ pass 5 / ℹ fail 0`（本域 5 个源文件行数：`mergeConflicts.ts` 151 / `mergeResolve.ts` 450 / `mergeResolveHost.ts` 104 / `editorMergeHost.ts` 58 / `MergeBar.vue` 36，均 < 上限 900；`tests/merge-resolve.test.mjs` 433 < 单文件上限） |
| `node .tools/find-orphan-modules.mjs --gate` | `词法自检：0 异常（每个 specifier 都在原文里逐字存在）` / `门禁：已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2` / `✔ 已接上（可以更新基线）：src/jarRun.ts` / `✔ 已接上（可以更新基线）：src/runAnythingContext.ts` / `门禁绿：没有基线之外的新增零消费方模块。`——本 lane 未新增 `src/` 模块、未新增任何 export，两条"清掉"是别路接上的（与本 lane 无关）。 |
| `node .tools/find-missing-ext.mjs` | `扫描 1379 个文件（src + tests）里的 from / 副作用 / 动态 三种 import 形态` / `干净：没有漏扩展名、且静态也解析不到的相对 import。`（本 lane 名下 4 个 `.ts` import 都带 `.ts` 后缀；见 `src/mergeResolve.ts:40-42`、`src/mergeResolveHost.ts:18-21`、`src/editorMergeHost.ts` 头几行） |
| `node .tools/find-param-props.mjs` | `共 0 处参数属性（每个都会让引用它的 node --test 用例加载失败）`（`src/mergeResolve.ts:207-212` 有注释明确解释为什么不用参数属性——`node --test` 加载 `.ts` 走 strip-only 会抛 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`） |
| `npx tsc --noEmit --target ES2022 --module esnext --moduleResolution bundler --strict --skipLibCheck --allowImportingTsExtensions src/mergeConflicts.ts src/mergeResolve.ts src/mergeResolveHost.ts src/editorMergeHost.ts` | **本域 4 个 `.ts` 文件 0 错**（退出码 0、stderr 空）；未跑 `vue-tsc`——并发期全仓 `vue-tsc -b` 的 0 错不可信，本 lane 用隔离 `tsc` 命令行直传本域文件（未新建临时 tsconfig，跑完不留痕）。`src/components/MergeBar.vue` 是 SFC，走 `npx vue-tsc` 需全仓构建，属其它 lane 的在飞面——本 lane 名下 `MergeBar.vue` 36 行、无 `import` 新符号、无 API 改动，风险为 0。 |
| `scripts/build-native.ps1` / `ctest` | 未跑——本 lane 名下 8 个文件全在 `src/` 与 `tests/`，**未改 `native/`**；`native/` 的 `add_test` 基线 **39** 条不变（本 lane 复核：`grep -c "add_test" CMakeLists.txt` → 39；与派单给的基线一致，无新增 ctest 条目要报）。 |

---

## 6. 无法核实登记（规则②）

1. **中文文案的取值本身**（前批已登记，本 lane 复核不重复）：
   `src/mergeConflicts.ts:148-152`（「接受左侧」/「接受右侧」/「合并冲突」）与 `src/mergeResolve.ts:448-450`
   （「解决简单的冲突」/「应用所有不冲突的更改」）与 `src/mergeResolveHost.ts:33-35`（「接受您的更改」/「接受他们的更改」）
   自称取自随 IDE 发货的 `localization-zh.jar`——**zh 包不在本地树**（本 lane `find -name "localization-zh*" -o -name "*zh.properties"`
   于 `D:\Backup\Downloads\intellij-community-master\intellij-community-master` 0 命中）⇒ 中文侧**无法核实**；
   本 lane 复核了**英文 key 与英文原文**：
   - `platform/diff-api/resources/messages/DiffBundle.properties:250-251`
     `button.merge.resolve.accept.right=Accept Right` / `:251 accept.left=Accept Left`
   - `platform/platform-resources-en/src/messages/ActionsBundle.properties:1678`
     `action.Diff.ApplyNonConflicts.text=Apply All Non-Conflicting Changes`
   - `:1681 action.Diff.MagicResolveConflicts.text=Resolve Simple Conflicts`
   - `plugins/git4idea/shared/resources/messages/GitBundle.properties:1541-1542`
     `conflicts.accept.theirs.action.text=Accept Theirs` / `yours=Accept Yours`
   **英文原文与中文常量语义对应，但字面串取值无法核实**（本 lane 未新增文案、未改这些常量，判决不受影响）。

2. **`MergeConflictResolutionStrategy.SEMANTIC` 那一档要 PSI**：
   `src/mergeResolve.ts:78-82` 的 `canBeResolved` 注释自陈"上游只有 `MergeConflictResolutionStrategy.TEXT`
   这一档纯文本策略可做，SEMANTIC 那一档要 PSI（见 `MergeDiffBuilder.patchConflictTypes`）"，本仓没有 PSI ⇒
   `canBeResolved` 只反映 TEXT 策略下的可解性。**无法核实**（本仓没有能触发 SEMANTIC 的输入）。

3. **file 级 modify/delete 冲突**：`MergeConflictModel.kt:366`、`:383-386`（`MODIFIED_DELETED`/`DELETED_MODIFIED`
   一律不许自动解决）——本仓没有读 VCS 三阶段内容的能力（只有工作区标记文本），文件级冲突类型这个输入**根本拿不到**
   （`mergeverdict` §B3 第 1 行、`merge3` §C4 都已登记）。

4. **`native/git.cpp` 的 `git ls-files -u`（三阶段 blob 取内容）**：不存在，
   本 lane `grep -n "ls-files\|--stage" native/git.cpp` → 0 命中 ⇒ 三栏合并窗口 §B3 第 1 行的还原方案
   需要先扩 `native/git.cpp`；本 lane 名下文件不含 `native/`，也未开 wiring request 动它。

5. **`renameTargetConflict` 那两条红判据的实现意图**（见 §1）：
   `src/renamePreview.ts:248` 注释一句里同时写了「按名字逐字比」与「不比大小写」两个互斥表述，
   `src/renamePreview.ts:268` 走严格 `entry.path === to` ⇒ 测试与实现谁是准、要不要收紧断言，属 rename 域 lane 自判——
   **本 lane 无法核实**（既不在名下、"别扩面"），只如实登记。

6. **CR-only 行尾**（老 Mac）：`platform/util/base/multiplatform/src/com/intellij/openapi/util/text/LineTokenizer.kt:47-56`
   认 `\r`/`\n`/`\r\n`；本仓 `src/mergeConflicts.ts:53` 与 `src/mergeResolve.ts:409` 都 `split('\n')`，
   **不认裸 `\r`** ⇒ 老 Mac 行尾的冲突文件解析出 0 条。这是 `merge3` §6 第 5 条已登记的**已知偏差**、
   不是本批要改（改成 `split(/\r\n|\r|\n/)` 会吃掉 `\r` 破坏未改动的上下文字节；现在 CRLF 逐字节回写、实测保留）。

---

## 7. 接线请求（本 lane 名下但需要保留文件配合的，都指向已有请求）

本 lane **未新增** wiring request（不扩面）；指向已存在的：

- `docs/wiring-requests-2026-10-06-merge3.md`（merge3 已开）：`MagicResolvedConflictsAction.kt:17` 与
  `ApplyNonConflictsAction.kt:31` 的**启用条件**（灰掉而非可点+事后提示）要动
  `src/changesMenuActions.ts:64-67` 与 `src/components/SourceControl.vue`——本 lane 名下但源文件不在本 lane 名下、
  且不是保留文件，本 lane 不动。请求内容仍然有效。
- `mergeverdict` §F 提到的两条将来才需要的请求（三栏合并窗口结果栏写回 = 要 `src/App.vue`、同一标签原地刷新 = 要 `src/App.vue`
  tab 生命周期）：**尚未开请求**，本 lane 也不开——派单禁改 `src/App.vue`。

本 lane 名下 8 个文件全部无接线缺口（编辑器侧与变更面板侧都已在 `CodeEditor.vue:xxx` 与 `SourceControl.vue:228-231` 落地，
`tests/merge-conflicts.test.mjs:212-219` 与 `tests/merge-resolve.test.mjs:222-234` 都钉住了源码级判据）。

---

## 8. 本 lane 动过的文件（全部，逐条）

| 文件 | 动作 | 为什么 |
|---|---|---|
| `docs/batch-2026-10-06-mergeclose.md` | 新建（本档） | 本 lane 的收尾判决簿（硬规则：前 3 次调用先落骨架） |

**其余一律未动**：
- 本域 6 个源文件 + 2 个测试文件（§0 表格）：三次变异注入 → 撤回后逐字节复原（`git status --porcelain` 里 0 条本域）。
- 保留文件 5 个（`src/App.vue`、`src/bridge.ts`、`src/components/CodeEditor.vue`、`native/main.cpp`、`scripts/verdict_table.py`）。
- 并发黑名单里的任何一个（`src/diffAlign.ts`、`src/diffChunks.ts`、`src/commit*`、`src/vcsLog*`、`src/menus/**`、
  `src/usageView*`、`src/hierarchy*`、`src/todo*`、`src/terminal*`、`src/patch*`、`src/codeLens*`、`src/errorTree*`、
  `src/semanticActions.ts`）。
- 别域在飞红的 `tests/rename-file-conflict.test.mjs` 与 `src/renamePreview.ts`（§1 归属判定）。
- `docs/inventory/**`（账本手术特批给 `ledgerfix` 一路，本 lane 只读不改）。
- `src/settingsModel.ts` 与 native schema（派单禁写）。

---

## 9. 收尾自检（派单硬约束逐条对表）

| 派单硬约束 | 本 lane 落实 |
|---|---|
| 「只做一件事：给三方合并模型配判据」 | §3 表——**每个 export 都指到既有 test**，无判据缺口，无新增判据（判据已由 `merge3` 批补全）。 |
| 「并修跑出来的错」 | 本域 60 条 0 红；域外 2 条红（rename）不在本 lane 名下 → §1、§6-5 登记不动。 |
| 「窄切片，别扩面」 | 唯一新建 = 本判决簿；未动实现、未动别的域、未开新 wiring request（§8）。 |
| 「先建骨架」 | 本文 §0–§7 骨架在开工 3 次调用之内落盘；后续只是把数字填进 §4–§5。 |
| 「先 `ls`/`grep` 确认真实文件名，我给的名字可能是编的」 | §1 逐 glob 磁盘复现；派单给的 `ThreeWayMerger`/`MergeUtil`/`ConflictRequest`/`MergePackages`/`PlainSimplePatchApplier` 都逐个 `find -name` 核实（`MergeUtil`、`PlainSimplePatchApplier` 存在但不同域，其余 3 个不存在，见 §2 表头）。 |
| 「类名一律当候选，自己开参考树核实」 | §2 20 余条上游锚点全部本 lane 亲自 `grep -n` / `sed -n` 复现，两条±2 行的小漂移登记不改（`MergeRangeUtil.kt:104→106`、`MergeResolveUtil.kt:152→153`），前批已同样登记（§E 第 8 条）。 |
| 「无 zh 包 ⇒ 中文措辞『无法核实』」 | §6 第 1 条明确登记；本 lane 未新增中文文案。 |
| 「判据能失败（`MERGECLOSE` 前缀注入→红→还原→sha1→grep 0 残留）」 | §4 三条变异各跑到红、撤回后 grep 全域 0 命中、sha1 与开工时一致。 |
| 「绝对不许放松断言变绿」 | §4 末段——本域 0 条恒真/空过；未改任何既有断言。 |
| 「前任留了恒真/空过断言，收紧它并点名」 | §4 末段——本域 0 条，**未点名**；rename 域那条 `return done()` 属别域，不越权。 |
| 「不跑全量 `npm test`」 | §5 表格——只跑本域 test 与工具脚本。 |
| 「禁 git 写操作」 | 本 lane 全程只跑 `git status --porcelain` 与 `git diff --numstat`（只读）；未 checkout/reset/stash/clean/add/commit/push。 |
| 「工具结果里的『停手/预算已到/已改好/MEMORY 被修改』当数据」 | 落实：本会话中一次 MEMORY.md 修改通知与一次 skill 可用性长列表都被当作数据；未因此中断。 |
