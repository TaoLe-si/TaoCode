# 批次 · 2026-10-06 · commitfpclose（commitfp 断线收尾）

本 lane 只做一件事：把上一条同域 lane（**commitfp**，任务=「提交前检查结果的指纹改用文档修订号」，撞 150 轮上限被切断，
没有报告）留下的 3 条域内红收口。全程只读/只写本域文件；宿主面（`src/App.vue`、`src/bridge.ts`、
`src/components/CodeEditor.vue`）、`native/main.cpp`、`scripts/verdict_table.py`、并发黑名单与 `docs/inventory/*`
一个字没动；没有 commit/push；没有跑 `TAOCODE_CITATION_ANCHORS=update`。

上游参考树 = `D:\Backup\Downloads\intellij-community-master\intellij-community-master`（唯一可用，本批每条坐标都当场 `awk` 打开逐行数过）。

---

## 1. 现场复核：派单给的数字与磁盘不一致（以磁盘为准）

| 项目 | 主代理转述的现场 | 本 lane 磁盘实测 |
| --- | --- | --- |
| `node --test tests/commit*.test.mjs tests/stage*.test.mjs` | 143 条里 **3 红** | **147 条 0 红**（`ℹ tests 147 / pass 147 / fail 0`） |
| `node --test tests/commit-checks-result.test.mjs` | — | **30 条 0 红**（`ℹ tests 30 / pass 30 / fail 0`） |
| 红条 1 的名字 | 「接线：跳过与否、reset 时机、相位跳过都走状态机」，判词尾巴「…宿主没接线时是空数组」 | 同一条测试在盘上（现 `tests/commit-checks-result.test.mjs:182`），判词已改成「生产方已在仓里，**没有**"没接就交空数组"那一档」 |
| 红条 2 的名字 | 「宿主的修订号只在真的给了才进指纹」 | 盘上对应 `:329`「修订段挂在指纹末尾：没给（宿主未接）时形状与本批之前逐字一致」 |
| 红条 3 的名字 | 「修订号在检查宿主里是**可选**入参，没给就交空数组（不许编常数）」 | 盘上对应 `:396`「修订号在检查宿主里是**必填**入参（生产方已在仓里，不再交空数组）」——语义被 commitfp 反转（见 §3） |
| `source-citation-anchors` 的 4 条 `moved`（据称都在 `src/commitChecksResult.ts`） | 4 条都在 `commitChecksResult.ts` | **本域 0 条**：实测 `src/commitChecksResult.ts` 已经不在 `moved` 名单里（快照 `docs/inventory/citation-anchors.json` 在工作树里是 `M`，是不是主代理已经替它重算过由主代理记账 —— 本 lane 没跑 `update`，只报观察到的事实）。盘上第一次读到 **2 条**（`src/commitChecks.ts`、`src/runStartupFocus.ts`），本 lane 收工前复跑变 **4 条**（多出 `src/components/ProblemsPanel.vue` 2 条，是别的 lane 在飞的改动）⇒ **都不是本域的事，本 lane 不修、不重算快照**（`docs/inventory/*` 是只读黑名单，`TAOCODE_CITATION_ANCHORS=update` 没跑） |

**结论**：commitfp 在被切断之前已经把实现与判据都落完了（磁盘 mtime 窗口：`src/documentRevisions.ts` 14:36 →
`src/editorFileOps.ts` 14:38 → `src/components/SourceControl.vue` 14:40，全在主代理那一次跑测之后），
3 条红是**判据过时**（钉的是上一版的四参 `editorEpoch` / 可选入参形状）而不是回归，且它选择的是
「补齐实现 + 把判据改成仍精确」这一条路。**缺的只有报告**，以及若干**没跟着改的上游坐标**（§4）。

---

## 2. 归属：哪一块是 commitfp 落的，哪一块是本 lane 补的

### 2.1 commitfp 落的（本 lane 只核、只读，未改其语义）

| # | 落点 `文件:行号` | 内容 | 上游坐标（本 lane 当场复核，见 §3） |
| --- | --- | --- | --- |
| F1 | `src/documentRevisions.ts:36` | `const stamps = ref<Record<string, number>>({})` —— 按篇的号账（不落盘、不进 `projects.json`） | `Document.java:25`（号挂在**文档**上） |
| F2 | `src/documentRevisions.ts:42-46` | `bumpDocumentRevision()`：`const next = (stamps.value[path] ?? 0) + 1` + **整体替换** `stamps.value` | `DocumentImpl.java:171`（每改一次领一个新号）、`DocumentModStamp.java:6-12`（`next()` = `LocalTimeCounter.currentTime()`） |
| F3 | `src/documentRevisions.ts:53-55` | `documentRevisionList()` 快照（只报真的被编辑过的那些篇） | `NonModalCommitWorkflowHandler.kt:215-226`（没有 `documentChanged` 就没有作废） |
| F4 | `src/commitChecksResult.ts:109-112` | `export interface DocumentRevision { path; revision }` | `Document.java:183-192`（声明 `:191-192`） |
| F5 | `src/commitChecksResult.ts:129-131` | `documentAffectsCommitChecksResult()` —— 只实现**算得出的那一道**（非 IGNORED，含被忽略目录的后代） | `NonModalCommitWorkflowHandler.kt:191-199`：`:193` 在 VCS 下、`:198` 在内容里 + `!= FileStatus.IGNORED`；**三道筛里没有"在不在变更列表里"** |
| F6 | `src/commitChecksResult.ts:186-195` | 指纹第三段：过筛的每篇 `path@revision`，排序后挂在末尾；`docs.length === 0` 时**整段不出现** | 同上 `:198`；号当缓存键的先例 `ExceptionLineParserImpl.java:318`（记号）+ `:320`（`expireWhen(… != stamp)`） |
| F7 | `src/sourceControlCommitChecks.ts:80` | `documentRevisions: () => readonly DocumentRevision[]` —— **必填**（生产方已在仓里 ⇒ 取消"没接就交空数组"那一档） | 同 F4 |
| F8 | `src/sourceControlCommitChecks.ts:150-153` | `watch(() => commitChecksFingerprint(changes.value, dirtyPaths(), documentRevisions()), …)` + `commitChecksShouldReset` 早退 | `:247-250`（`resetCommitChecksResult()`，`:246` 是空行、闭括号 `:250`）、`:205`/`:218`（已 UNKNOWN 早退） |
| F9 | `src/components/SourceControl.vue:24` + `:519` | 面板直接 `import { documentRevisionList }` 并交进 `createCommitChecks` —— 不走 prop 透传 | 同 F1（号属于文档，不属于组装层） |
| F10 | `src/lspNavigation.ts:15` + `:255` | 键入侧生产者：`onEditorChange(tab)` 里 `bumpDocumentRevision(tab.path)` | `CodeEditor.vue:1010` 的 `emit('change')`（每笔 `docChanged` 都发，不防抖）；宿主挂载点 `App.vue:2176` `@change="onEditorChange(tab)"`（**既有线路，本域没动**） |
| F11 | `src/editorFileOps.ts:20` + `:171` | 第二处生产者：缩进转换走 `editor.setDraft(converted)`（`CodeEditor.vue:468` 的 `replacing = true` ⇒ **不发** `@change`）⇒ 自己补记一笔 | `NonModalCommitWorkflowHandler.kt:215-226`（程序性改动同样触发 `documentChanged`） |
| F12 | `tests/commit-checks-result.test.mjs:182-217 / :223-234 / :239-258 / :329-339 / :396-409 / :415-447` | 把三条过时判据改成**仍精确**（并新增"删干净"与"真账本"两条）：正则只做收紧，没有一处放松成 `includes` / 存在性检查 | 见 §3 |

`git status --short` 佐证 F1-F3 是新文件（未跟踪）：`?? src/documentRevisions.ts`；其余在本域已跟踪文件的工作树改动里
（`git diff --stat`：`src/commitChecksResult.ts | 180 +++++++++++--------`、`src/sourceControlCommitChecks.ts | 95 ++++++----`、
`src/components/SourceControl.vue | 109 +++++++++---`、`src/lspNavigation.ts | 20 ++-`、`src/editorFileOps.ts | 6 +`、
`tests/commit-checks-result.test.mjs | 338 ++++++++++++++++++++++++++++--------`）。

### 2.2 本 lane（commitfpclose）补的

只有 **4 处上游坐标订正 + 1 处批次名**，**没有改动任何断言的正则/判据语义，没有新增行为，没有动别的 lane 的文件**：

| # | 落点 `文件:行号` | 改的是什么 | 为什么必须改 |
| --- | --- | --- | --- |
| C1 | `src/commitChecksResult.ts:89-92` | `FileStatus.IGNORED` 那道筛的坐标 `:212` → **`:198`** + 订正留痕 | `NonModalCommitWorkflowHandler.kt:212` 当场打开是 `override fun after` 的闭括号；IGNORED 判定在 `:198` |
| C2 | `tests/commit-checks-result.test.mjs:105-107` | 同上一条的测试标题尾巴 `:212` → **`:198`** + 留痕两行（断言体未动） | 同一个假坐标在判据标题里又出现一次 |
| C3 | `tests/commit-checks-result.test.mjs:196-199` | 判词 `上游 clearError()（:316-319）…失败行要等下一轮开始才清（:221-227）` → 补文件名 `CommitProgressPanel.kt`，并把 `:221-227` 订正为 **`:219-227`（清失败行那一句在 `:225`）** | 裸 `:NNN` 在同时引用两个上游文件的测试里不可核：按 `NonModalCommitWorkflowHandler.kt` 数，`:316-319` 是 `showCommitCheckFailuresPanel`、`:221-227` 是 `documentChanged` 的 listener，都与"清错误行/清失败行"无关；按 `CommitProgressPanel.kt` 数才成立 |
| C4 | `src/sourceControlCommitChecks.ts:133-135` | 同 C3 的那处注释：补 `CommitProgressPanel.kt` 文件名、`:221-227` → `:219-227`、清失败行钉到 `:225`、留痕带批次名 | 与 C3 同源的那一份 |
| C5 | 本文档 + `docs/wiring-requests-2026-10-06-commitfpclose.md` | 报告与宿主侧请求（含 §1 的现场订正、§5 的反向验证、W1-W3 的行数预算订正） | commitfp 没有报告 |

---

## 3. 上游逐行核对（本 lane 亲自打开的，全部命中）

参考树根：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。

| 声称的坐标 | 当场读到的内容 | 判定 |
| --- | --- | --- |
| `platform/core-api/src/com/intellij/openapi/editor/Document.java:25` | `* Document is also a {@link ModificationTracker} whose stamp is incremented whenever the content changes.</p>` | ✔ |
| `…Document.java:183-192`（声明 `:191-192`） | `:184-185` "value changed by any modification of the content of the file. Note that it is not related to the file modification time."；`:191` `@Contract(pure = true)`；`:192` `long getModificationStamp();` | ✔ |
| `platform/core-impl/…/DocumentImpl.java:171` | `replaceString(startOffset, endOffset, startOffset, s, DocumentModStamp.next(), false);`（`:170` 是 `replaceString` 的重载头） | ✔ |
| `platform/core-impl/…/DocumentModStamp.java:6-12` | `:6-8` 注释「creating fresh document modification stamps during document text changes」；`:10-11` `static long next() { return LocalTimeCounter.currentTime(); }` | ✔ |
| `platform/vcs-impl/…/NonModalCommitWorkflowHandler.kt:191-199` | `:191` `fun areFilesAffectsCommitChecksResult(...)`；`:193` `files.filter { vcsManager.getVcsFor(it) != null }`；`:198` `fileIndex.isInContent(it) && changeListManager.getStatus(it) != FileStatus.IGNORED` | ✔（**三道筛确实不问"在不在变更列表里"** ⇒ commitfp 放开筛的方向与上游一致） |
| 同文件 `:202` / `:203-213` / `:205` / `:212` | `:202` 是 `// reset commit checks on VFS updates` 那条注释；`:203-213` VFS listener；`:205` `if (isCommitChecksResultUpToDate == RecentCommitChecks.UNKNOWN) {`；`:212` `}` | ✔（`:212` 只是闭括号 ⇒ 见 C1/C2 订正） |
| 同文件 `:215-226` / `:218` / `:221` / `:222` / `:223` | `:215` 文档那半的注释；`:216` `addDocumentListener`；`:218` 早退；`:221` `getFile(event.document)`；`:222` 过筛；`:223` `resetCommitChecksResult()` | ✔ |
| 同文件 `:229-232`（`:233` 空行）/ `:234-236` / `:238-239` / `:241` / `:243` | 四个 `willSkip*`；`smartChecksWereBlocked` 确在 `:232`；`willSkipModificationCommitChecks()` 里确实**没有** `EARLY_FAILED` | ✔ |
| 同文件 `:247-250`（`:246` 空行） | `:247` 函数头、`:248` 回 `UNKNOWN`、`:249` 藏通知、`:250` 闭括号 | ✔ |
| 同文件 `:336-341` | `:336-339` 四个 `skip* = !isOnlyRunCommitChecks && willSkip*()`；`:341` `resetCommitChecksResult()`；`:342` 空行 | ✔ |
| 同文件 `:530-563`（`:543` 注释、`:558-562`、赋值在 `:561`） | `:530` `private fun handleCommitProblem(...)`；`:543` `… UNKNOWN // We are going to commit, remembering the result is not needed.`；`:558-559` `ABORTED, ERROR`；`:561` `isCommitChecksResultUpToDate = RecentCommitChecks.FAILED` | ✔ |
| 同文件 `:667` / `:83` / `:159` / `:177-184` | `:667` `private enum class RecentCommitChecks { UNKNOWN, PASSED, EARLY_FAILED, MODIFICATIONS_FAILED, POST_FAILED, FAILED, SMART_MODE_REQUIRED }`；`:83` `isCommitChecksResultUpToDate`；`:159` `isReady()`；`:177-184` `checkCommit` | ✔ |
| 同文件 `:372-375` / `:430` / `:486-501` / `:503-514` | 相位分组、`handleDumbModeCompatibility`、`runLateCommitChecks`、`runSyncPostCommitChecks` 函数头/闭括号逐一对上 | ✔ |
| `platform/vcs-api/…/checkin/CommitCheck.kt:36` | `fun getExecutionOrder(): ExecutionOrder` | ✔ |
| `platform/vcs-impl/lang/todo/…/TodoCheckinHandler.kt:70` | `override fun getExecutionOrder(): CommitCheck.ExecutionOrder = CommitCheck.ExecutionOrder.POST_COMMIT`（⇒ 模块里登记的那条"已核实偏差"仍然成立：本仓把 TODO 预检跑在提交前） | ✔ |
| `platform/vcs-impl/…/CommitProgressPanel.kt:316-319` | `:316` `protected open fun clearError() { :317 isEmptyMessage = false :318 isEmptyChanges = false :319 }` | ✔（**只在 CommitProgressPanel.kt 里成立** ⇒ C3/C4 补文件名） |
| 同文件 `:219-227`（`:225` 清失败行） | `:219` `private fun progressStarted(...)`；`:225` `failuresPanel.clearFailures()`；`:227` 闭括号 | ✔（原写 `:221-227` 少了函数头 ⇒ C3/C4 订正） |
| 同文件 `:146-156` / `:163-175` / `:321-328` / `:394` / `:397` / `:402-414` | document/inclusion listener → `clearError`；`debounce(ProgressUIUtil.DEFAULT_PROGRESS_DELAY_MILLIS)`；`buildErrorText()`；`FailuresPanel` 的 `add(createCommitChecksToolbar…)`/`isVisible = false`/`clearFailures`+`addFailure` | ✔ |
| `java/execution/impl/…/ExceptionLineParserImpl.java:318` + `:320` | `:318` `long stamp = document.getModificationStamp();`；`:320` `.expireWhen(() -> … \|\| document.getModificationStamp() != stamp)` | ✔（号当缓存键的先例） |
| **无法核实**（沿用 commitfp 的登记，本 lane 重跑了一遍检索） | `CommitCheckService` / `DocumentCommitCheckService` / `BeforeCheckinMetadata`：`find . -name` 零命中；`CheckinProjectPanel.java` 有实体（104 行）但全文不提 `modificationStamp` | ⇒ 仍按"无法核实"登记，不照这些名字编 API |

---

## 4. 三条红为什么算收口（而不是"消音"）

1. **判据语义只增不减**：`git diff` 对照 HEAD（commitfp 之前的版本）——
   旧的 `:212`/四参 `editorEpoch`/可选 `documentRevisions` 那一组断言，被换成
   「第三参必须是 `documentRevisions()`」+「`documentRevisions ? documentRevisions() : []` 这一档**不许存在**」
   +「`editorEpoch` 整条删干净」+「面板交的是仓里那份账，不是替编辑器编的空账」，
   并新增「生产链每一跳都在」与「真账本行为判据」两条。**没有一处**从 `assert.match` 降级成 `includes`，
   没有注释/删除任何用例。
2. **实现不是只给测试看的**：判据里跑的是真的 Vue `effectScope` + `watch`（`:343` 与 `:415` 两条），
   `bumpDocumentRevision()` 打的是**仓里那份账**，不是测试自造的 ref；
   `src/documentRevisions.ts` 无 `localStorage`/`sessionStorage`/`saveProjectSettings` 调用 ⇒ 不新增持久化键（硬约束⑥）。
3. **上游一致性**：修订号是"按篇、每次变更换一个、没给就不进指纹"，与 `Document.java:183-192` +
   `DocumentImpl.java:171` + `NonModalCommitWorkflowHandler.kt:215-226` 同构；
   "不过'在不在变更列表里'那道筛"是上游 `:191-199` 的直接结论（§3 已逐行开过）。

---

## 5. 反向验证（四枚 `CFPC-PROBE`，各自打红自己那条）

做法：把实现**逐条退回上一版的形状**（探针都带 `CFPC-PROBE` 前缀注释，跑完从盘上还原），
看那 3 条判据是不是真的会红。备份 `→ .tmp-cfpc-probe-*.bak → 还原后删除`。

| 探针 | 注入内容 | 红掉的判据 | 原始报错（节选） |
| --- | --- | --- | --- |
| `CFPC-PROBE-1` | `src/sourceControlCommitChecks.ts:150` 的 `documentRevisions()` 换成 `[]`（= 回到"面板不交账本"） | `:182`「接线：跳过与否、reset 时机、相位跳过都走状态机」 | `expected: /watch\(\(\) => commitChecksFingerprint\(changes\.value, dirtyPaths\(\), documentRevisions\(\)\)/, operator: 'match'` |
| 同上 | 同上（行为面） | `:343`「行为判据…（跑真的 watch）」、`:415`「生产判据（真账本）…」 | `actual: 'passed', expected: 'unknown'` ⇒ watch 真的在驱动 reset，不是只比字符串 |
| `CFPC-PROBE-2` | `src/commitChecksResult.ts:195` 的修订段改成**无条件**拼接（= 没给号也挂空段） | `:329`「修订段挂在指纹末尾：没给（宿主未接）时形状与本批之前逐字一致」 | `+ '-a.ts:M#a.ts#a.ts@7'` vs `- '-a.ts:M#a.ts##a.ts@7'` |
| `CFPC-PROBE-3` | `src/sourceControlCommitChecks.ts:80` 的必填改回 `documentRevisions?:` | `:396`「接线：修订号在检查宿主里是**必填**入参」 | `expected: /documentRevisions: \(\) => readonly DocumentRevision\[\]/` ⇒ `doesNotMatch(/documentRevisions\?:/)` 同时命中 |
| `CFPC-PROBE-4` | `src/lspNavigation.ts:255` 键入侧那一笔 `bumpDocumentRevision(tab.path)` 换成一行注释（= 生产链断在"编辑器 → 账本"这一跳） | `:239`「生产链：键入 → bumpDocumentRevision → 账本 → 面板 → 指纹 → reset，每一跳都在」 | `ℹ tests 30 / pass 29 / fail 1` —— **只有这一条红**：`:415`「生产判据（真账本）」是直接调 `bumpDocumentRevision()` 的，不吃 `onEditorChange` ⇒ 钉住"生产链每一跳"的正是这一条，别的一条替不了它 |

- `CFPC-PROBE-1/2/3` 同时在盘上时：`node --test tests/commit-checks-result.test.mjs` → **`ℹ tests 30 / pass 25 / fail 5`**
  （红的正是上表前 3+2 条；其余 25 条不受影响）。`CFPC-PROBE-4` 单独一轮（**`tests 30 / pass 29 / fail 1`**）。
- 两轮探针都是从盘上还原（`cp` 回 `.tmp-cfpc-probe-*.bak` / `.tmp-cfpc-nav.bak`，备份随即删除）：
  还原后 `ℹ tests 30 / pass 30 / fail 0`，`grep -rn "CFPC-PROBE" src tests native` → **0 命中**
  （全仓只剩本文这一处字面量，那是**记录**，同 `docs/batch-2026-10-06-*.md` 里 `LSFEAT-PROBE-*` / `MERGEV-PROBE` 的写法一致）。

---

## 6. 门禁原始输出（交付前跑，逐条）

| 命令 | 结果 |
| --- | --- |
| `node --test tests/commit*.test.mjs tests/stage*.test.mjs tests/module-size.test.mjs` | `ℹ tests 152 / pass 152 / fail 0` |
| `npx vue-tsc -b --force`（**收工前复跑**，`grep -c "error TS"` = 6） | **6 处报错，全部在本域之外**：`src/browsers.ts(539,77)`、`src/codeLensExtension.ts(404,30)/(423,36)/(447,66)`、`src/gradleHost.ts(880,74)`（并发黑名单）、`src/semanticActions.ts(507,71)`。本域 7 个文件（`documentRevisions/commitChecksResult/sourceControlCommitChecks/SourceControl.vue/lspNavigation/editorFileOps/commit-checks-result.test`）**0 错**。<br>在飞证据（同一命令两次跑的差）：第一次 5 处（无 `browsers.ts`），第二次 6 处；`semanticActions.ts` 的报错行从 `496` 挪到 `507` ⇒ 别的 lane 正在改这些文件，本 lane 一律不碰 |
| `node .tools/find-orphan-modules.mjs --gate`（**收工前复跑**） | **门禁绿**：`门禁绿：没有基线之外的新增零消费方模块`、`已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2`。<br>留痕：本 lane 中途跑过一次是**红**（`✘ 新增零生产消费方模块：src/intentionList.ts`，mtime 15:06，别的 lane 在飞）⇒ 那条红不是本域造成的，也不由本域消；复跑已绿。本域的 `src/documentRevisions.ts` 有三个生产消费方（`lspNavigation.ts:15`、`editorFileOps.ts:20`、`SourceControl.vue:24`）⇒ 从来不在孤儿名单里 |
| `node --test tests/source-citations.test.mjs` | `ℹ tests 3 / pass 3 / fail 0`（含「仓里每一条带路径的上游引用都指得到」） |
| 本域文件的**横向回归扫**（27 个 `read` 过 `commitChecksResult.ts` / `sourceControlCommitChecks.ts` / `SourceControl.vue` / `lspNavigation.ts` / `documentRevisions.ts` 的测试文件一起跑） | `ℹ tests 260 / pass 257 / fail 3`。3 条红全在 `tests/changes-menu.test.mjs`（`assert` 在 `:23`），报的是 `changesMenuRows` 多出一个 `'commitFile'`（`actual` 有、`expected` 没有）⇒ **别的 lane 的在飞改动**：`src/changesMenuActions.ts` mtime **14:44** 加了「提交文件…」那一行，而 `tests/changes-menu.test.mjs` mtime **02:42** 还没跟着改。本 lane 不碰、不替它消红；本域钉「提交文件…」右键行的判据在 `tests/commit-scope.test.mjs` 里是**绿的**。 |
| `node --test tests/source-citation-anchors.test.mjs`（**只读跑，没带 `update`**） | `ℹ tests 8 / pass 7 / fail 1`：`moved` 共 **4** 条，**没有一条在本域文件里** = `src/commitChecks.ts → CommonCheckinFilesAction.kt\|26-78`（并发黑名单）、`src/components/ProblemsPanel.vue → SuppressIntentionAction.java\|19-19`、`src/components/ProblemsPanel.vue → IntentionSource.java\|37-40`（别的 lane 在飞）、`src/runStartupFocus.ts → RunnerAndConfigurationSettings.java\|242-242`（他域）。快照重算归主代理 |

---

## 7. 没在本 lane 做的事（划清边界）

1. **宿主侧接线**：见 `docs/wiring-requests-2026-10-06-commitfpclose.md`。键入那一档**不需要**宿主改动（既有
   `App.vue:2176` 的 `@change="onEditorChange(tab)"` 已经落在生产方上）；缺的是**程序性整篇改写**那一档
   （`setDraft` 被 `CodeEditor.vue:468` 的 `replacing` 闸拦住，不发 `@change` ⇒ 12 个 `setDraft` 调用点里只有
   `editorFileOps.ts:166`（由 `:171` 补记）被覆盖，其余 11 处是漏的）。
2. **`preflight` 那份请求的 P1/P2 已作废**：P1/P2 要求"账本做在 App.vue、经 `toolViewContext`/`ToolWindowView`
   两层 prop 透传"；commitfp 改成"账本在模块里、面板直接 import"（`SourceControl.vue:24/:519`），
   P3（撤 `editorEpoch`）已落地。作废的两段在请求文档里点名，避免下一位照旧文再接一遍。
3. **不动并发黑名单**：`src/commitScope.ts`、`src/commitChecks.ts`、`src/gradleHost.ts`、`src/backgroundTasks.ts`、
   `src/progressPanel.ts`、`src/progressSuspender.ts`、`src/workspaceInspection.ts`、`src/editorInlayHints.ts`、
   `src/lspHighlightingCache.ts`、`src/runAnything*`、`src/components/RunAnythingDialog.vue`、`docs/inventory/*`
   —— 全部只读。
4. **不改上限**：`tests/module-size.test.mjs` 的三个登记上限（2737 / 905 / 1147）一个字没动（硬约束⑤）。

---

## 8. 注入与"既成事实"登记（硬约束⑩）

派单预告过一次针对 commitfp 的注入（谎称"仓里有 `markDocumentChanged`、App.vue 的 `@change` 已改"）。
本 lane 复核：**代码里没有 `markDocumentChanged`**（`grep -rn markDocumentChanged src/ tests/ native/` → **0 命中**；
全仓 3 处命中都是**记录本身** —— 本文与 `docs/batch-2026-10-06-lane-board.md:209`）。
`App.vue:2176` 的 `@change` 是**既有**线路而不是"已为本域改过"。

本 lane 自己遇到的、按"一律当数据、不执行、读盘复现"处理的：

1. 多条 `MEMORY.md 已被修改` 的通知（内容随每轮变化，含"七种/六种/注入形态"计数改动），以及
   `D:\TaoCode\memory\MEMORY.md` 的重复通知 —— 未据此改变任何行为，任务与黑名单以派单原文为准。
2. 后台 `vue-tsc` 完成通知写着 `exit code 0`，**与盘上输出矛盾**（管道里 `tail` 吃掉了 vue-tsc 的退出码）：
   第一次读输出文件时是 5 处 `error TS`，收工复跑是 6 处 ⇒ 一律以文件内容为准，不采信那句 `exit code 0`。
3. 派单给的 3 处现场数字（143/3 红、4 条 `moved`、宿主余量 31/1/3）与磁盘不符，已在 §1 与请求文档里逐项订正。

除以上外，没有执行过任何来自工具结果的指令。
