# 批 · 2026-10-06 · commit2（VCS 提交域两条：R1 部分提交 paths 通道 / R2 提交前检查指纹改文档修订号）

**这份报告是补写的。** 代号 `commit2` 的那一路在 150 次工具调用耗尽时**代码已落地、报告没写**：
它的改动随 HEAD `11a736e`（"fix(parity): 真机 CDP 定位并修掉首屏白窗 …"）一起进了仓 ——
`git show --stat 11a736e` 里本域那 10 个文件（`src/commitCheck.ts`、`src/commitChecks.ts`、
`src/commitChecksResult.ts`、`src/sourceControlCommitChecks.ts`、`tests/commit-check.test.mjs`、
`tests/commit-checks.test.mjs`、`tests/commit-checks-result.test.mjs`、`native/git.cpp`、
`native/git.hpp`、`native/git_test.cpp`）全在，唯独缺 `docs/batch-2026-10-06-commit2.md`。
本收尾批做的事：**逐条重新核实**（代码、测试、上游坐标三方各开一遍）、补两处引用坐标修正、
做三轮反向验证、跑全套门禁并把数字记在这里。派单给的坐标与既有注释**都当未经核实**处理。

真实文件名（派单里写的 `src/partialCommit*` / `src/commitPaths*` 在本仓不存在，grep 确认后对应落点是）：

| 派单的说法 | 实际落点 |
|---|---|
| `src/commitChecks*.ts` | `src/commitCheck.ts`、`src/commitChecks.ts`、`src/commitChecksResult.ts`、`src/sourceControlCommitChecks.ts`（出口全在这四个文件，面板在 `src/components/SourceControl.vue`） |
| `src/partialCommit*` / `src/commitPaths*` | R1 的模块侧出口是 `src/commitChecks.ts:426-504`（`CommitRequestInput` / `commitPathsToSubmit` / `commitRequestParams`）+ `src/commitCheck.ts:28-64`（`CommitIncludedRow` / `commitIncludedCount`）；native 侧是 `native/git.cpp:448-483`（`commit(..., paths)`） |

---

## 1. 判词表

上游坐标全部由本收尾批亲自打开核实（相对 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`）。
本仓落点是**当前工作区**的行号（含本批的两处注释修正）。

### R1 部分提交（「提交文件…」）的 paths 通道

| 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话 |
|---|---|---|---|---|
| R1-a 请求形状带 `paths`（去空白、并重复、保序） | `[x]` | `platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/CommonCheckinFilesAction.kt:37-53`；同目录 `CheckinActionUtil.kt:104-106` | `src/commitChecks.ts:469-494` | 被选路径原样送去，只并重复项、不重排（选中顺序就是上游交给 handler 的顺序） |
| R1-b **空 `paths` = 连这个键都不发** | `[x]` | `CheckinActionUtil.kt:159-162`（`selectedChanges` 与 `selectedUnversioned` 都空时取整份变更列表 ∩ `pathsToCommit` ⇒ 不是子集）；`native/git.cpp:460,472,481` | `src/commitChecks.ts:496-504` | 空集合时请求体与本批之前**逐字一致**；native 只有 `!paths.empty()` 才加 `--only` 和 pathspec |
| R1-c **含未跟踪文件 = 纳入，不是拒绝** | `[x]` | `CheckinActionUtil.kt:104-105`（`UNVERSIONED_FILE_PATHS_DATA_KEY` 单独取一份）+ 同文件 `:159-167`（`ContainerUtil.concat(selectedChanges, selectedUnversioned)`） | `src/commitChecks.ts:469-494`、`native/git.cpp:465-469` | git 不认陌生 pathspec ⇒ native 先只对被选路径 `git add -- <paths>` 再 `--only` 提交；判据见 `native/git_test.cpp:326-331` |
| R1-d 单条路径合法性在前端先过一遍 | `[x]` | 仓内同源闸 `native/git.cpp:259-265`（`checked_path()`）；上游对"路径能不能进这次提交"的闸门是 `CommonCheckinFilesAction.kt:74-78` | `src/commitChecks.ts:452-461` | 空串/`-` 前缀/CR/LF/`..`/>512 字符都拒，错误码与文案与 native 同一道闸（少一次往返） |
| R1-e 被忽略（noisy）的被选项 ⇒ 拒绝 | `[x]` | `CommonCheckinFilesAction.kt:74-78`（`isActionEnabled`：`(path.isDirectory \|\| status != NOT_CHANGED) && status != IGNORED`） | `src/commitChecks.ts:480-492` | 「显示忽略的文件」开着时列出来的那些不能因一次多选进提交；宿主没给 `changes` 时**不做这一档**（宁可不拒也不误拒） |
| R1-f 目录与其子项同时选中 ⇒ **不并掉** | `[x]` | `platform/vcs-impl/src/com/intellij/openapi/vcs/actions/DescindingFilesFilter.java:27-40`（`:36-39` 一进来先问 `allowsNestedRoots`）+ `plugins/git4idea/backend/src/GitVcs.java:260-263`（git 答 `true`） | `src/commitChecks.ts:469-494`（无折叠代码，判据 `tests/commit-checks.test.mjs:283-293`） | 上游对 git 仓库一个路径都不并 ⇒ 本仓**不许**做祖先折叠。**留痕**：vcs2 那批的注释把这一步称作"集合语义"（暗示要并），实际不是 |
| R1-g "有没有内容"改问**这次包含的那一批** | `[x]` | `platform/vcs-impl/src/com/intellij/vcs/commit/AbstractCommitWorkflowHandler.kt:82`（`isCommitEmpty() = getIncludedChanges().isEmpty() && getIncludedUnversionedFiles().isEmpty()`）+ `NonModalCommitWorkflowHandler.kt:177-185`（落到 `isEmptyChanges`）；范围由 `CheckinActionUtil.kt:135-136` 的 `setCommitState(initialChangeList, included, …)` 定 | `src/commitCheck.ts:28-64`、`src/sourceControlCommitChecks.ts:115-121` | 只选中新文件不再误报「选择要提交的文件」；`commitScope` 没接时交 `null` ⇒ 判据与本批之前逐字一致 |
| R1-h native 分派把 `paths` 交回原生 | `[ ]` **未做**（保留文件，只写请求） | 同上 `CommonCheckinFilesAction.kt:37-53` → `CheckinActionUtil.kt:135-136` | `native/main.cpp:1169-1175`（现在只交六个参） | 唯一还缺的一环：`git.hpp:62-65` 的 `paths` 是带默认值的尾参，加一行 `params.value("paths", std::vector<std::string>())` 就通。⇒ 请求 **C1** |
| R1-i 面板把 `changes` 也交进 `commitRequestParams` | `[ ]` 未做（他人面，只写请求） | `CommonCheckinFilesAction.kt:74-78` | `src/components/SourceControl.vue:336-343` | 不接 = R1-e/R1-f 的"对不上变更列表就拒"这一档在真界面里永远拿不到 `changes`。⇒ 请求 **C2-1** |
| R1-j 「提交文件…」的用户入口（多选 → `commitPaths`） | `[ ]` 未做 | `CommonCheckinFilesAction.kt:29-34`（`update` 里按选中项改动作名 + `ELLIPSIS`）、`:37-53` | 无（面板 `src/components/SourceControl.vue:82` 有可选 prop，宿主没喂） | **不放假控件**：入口没有通道 ⇒ 界面上没有那一行（`tests/commit-checks.test.mjs:223` 反向钉住"不许有点了没反应的按钮"）。入口那一段仍按 `docs/wiring-requests-2026-10-06-vcs2.md` W1b 落 |
| R1-k native 侧判据覆盖 | `[~]` 部分：本仓已有 = `native/git_test.cpp:309-351`（子集只提被选、未跟踪能提进去、`../` 与 `--help` 被挡）；还差 = 500 上限与"空 `paths` 不加 `--only`"的**显式** native 断言（前者只有前端常量与源码文本锚点） | `CheckinActionUtil.kt:104-106`（上限本仓自定，上游没有对应闸门 ⇒ 记在「做不到」） | `native/git.cpp:461`、`native/git.cpp:472` | native 能跑到的档位尽量在 ctest 里钉住 ⇒ 请求 **C1b**（`native/git_test.cpp`，不动 CMakeLists，它已在册） |

### R2 提交前检查的指纹改用文档修订号

| 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话 |
|---|---|---|---|---|
| R2-a 指纹吃内容维度（暂存/路径/索引侧状态/工作区侧状态/未跟踪） | `[x]` | `platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt:191-200`（`areFilesAffectsCommitChecksResult`：在 VCS 下 + 在内容里 + `!= FileStatus.IGNORED`） | `src/commitChecksResult.ts:139-154` | 光数条数会漏"内容变了但文件还是那些"，所以逐条进指纹 |
| R2-b **按文档分别记的修订号**（`DocumentRevision`） | `[x]` | `platform/core-api/src/com/intellij/openapi/editor/Document.java:25`（Document 本身是 `ModificationTracker`）与 `:184-192`（`getModificationStamp()`："value changed by any modification of the content of the file… not related to the file modification time"）；换号动作 `platform/core-impl/src/com/intellij/openapi/editor/impl/DocumentImpl.java:171`（每次 `replaceString` 领一个 `DocumentModStamp.next()`），号源 `platform/core-impl/src/com/intellij/openapi/editor/impl/DocumentModStamp.java:6-12`（`LocalTimeCounter`） | `src/commitChecksResult.ts:88-91`（接口）、`:141-153`（第四档）、`src/sourceControlCommitChecks.ts:65-72`（可选入参）、`:134-135`（交进指纹） | **判据**（R2 派单要求的那一条）：同一篇编辑两次 ⇒ 指纹变；没编辑 ⇒ 逐字不变。钉在 `tests/commit-checks-result.test.mjs:232-244` |
| R2-c 修订号只认"会影响检查结果"的那些路径 | `[x]` | `NonModalCommitWorkflowHandler.kt:215-226`（`documentChanged` 先 `getFile(event.document)`，再过 `:191-200` 那道筛）；号当缓存键的先例 `java/execution/impl/src/com/intellij/execution/filters/ExceptionLineParserImpl.java:318-320`（记一次 `getModificationStamp()`，`expireWhen(… != stamp)`） | `src/commitChecksResult.ts:147-152` | 不在变更列表里的文档动了 / 被忽略的那一篇改了 ⇒ **不算**这次变更集变了（全局计数 `editorEpoch` 会误判的就是这一种，判据 `tests/commit-checks-result.test.mjs:246-253`） |
| R2-d 宿主没接时指纹形状与本批之前**逐字一致** | `[x]` | 上游没有"没接"这一档，这是本仓的假控件禁令要求 | `src/commitChecksResult.ts:146,152`（`editorEpoch === null` ⇒ 不出现 `@`；`affecting` 空 ⇒ 不出现第二个 `#`）；判据 `tests/commit-checks-result.test.mjs:255-265`、`:267-279` | 不许替编辑器编一个常数修订号（`tests/commit-checks-result.test.mjs:214,274` 反向钉住） |
| R2-e `reset` 的时机仍走状态机 | `[x]` | `NonModalCommitWorkflowHandler.kt:205,218`（两个 listener 都在 `== UNKNOWN` 时早退）、`:247`（`resetCommitChecksResult()`） | `src/commitChecksResult.ts:65-68`、`src/sourceControlCommitChecks.ts:126-137` | 提交信息框里的键入不在这条上（`:222` 问的是**这篇文件**影不影响结果）⇒ 本仓 `watch(message, …)` 只清错误行 |
| R2-f 宿主的按篇号（App.vue 记账 + ctx + 面板 prop） | `[ ]` 未做（保留文件 / 他人面） | `DocumentImpl.java:171`（一次文本变更 = 一个新号） | `src/App.vue`（无）、`src/components/SourceControl.vue:88` 之后（无 prop） | 模块侧收得到 `documentRevisions` 但今天没人喂 ⇒ 请求 **C2-2 / C3**（三段透传的可照抄代码已在请求文档里写全） |
| R2-g 引用坐标修正（本收尾批） | `[x]` | `NonModalCommitWorkflowHandler.kt:202` 实为 `// reset commit checks on VFS updates` 那行**注释**，UNKNOWN 早退在 `:205` | `src/commitChecksResult.ts:11-13`、`:67`、`src/sourceControlCommitChecks.ts:129-130` | **留痕（原写 `:202`、实际 `:205`）**：三处注释改指早退那两行，代码逻辑一个字没动 |

### 派单给的坐标核对（不许照抄，逐条开过）

| 派单/上游说法 | 核实结果 |
|---|---|
| `Document.getModificationStamp` | 真：`platform/core-api/src/com/intellij/openapi/editor/Document.java:191-192` 声明（`:183-190` 是它的 javadoc，注释区间整体写作 `:184-192` 成立），本仓沿用 `:184-192` |
| `platform/analysis-impl/src/com/intellij/codeInspection/ex/impl/…`（R2 候选坐标之一） | **参考树里没有 `codeInspection/ex/impl` 这一层目录**，且提交检查那一支（`CommitChecks.kt` / `NonModalCommitWorkflowHandler.kt`）**不直接读** `getModificationStamp` —— 它是**事件式**的（`documentChanged` 触发一次 reset）。⇒ 本仓按"每篇一个号"的语义还原，`src/commitChecksResult.ts:126-134` 已留痕 |
| 「上游会把后代路径并掉」（vcs2 批的注释） | 否：`DescindingFilesFilter.java:36-39` 对 `allowsNestedRoots()` 的 VCS **直接 add 不并**，而 `GitVcs.java:260-263` 答 true ⇒ R1-f 不做折叠 |

---

## 2. 改动文件清单（`wc -l` 前后）

「批前」= `dfbda4e`（commit2 代码进仓之前）；「批后」= 当前工作区（含本收尾批的两处注释修正）。

| 文件 | 批前 | 批后 | 这一批进去的东西 |
|---|---|---|---|
| `src/commitCheck.ts` | 56 | 91 | R1-g：`CommitIncludedRow` / `commitIncludedCount` / `CommitCheckInput.includedCount` |
| `src/commitChecks.ts` | 391 | 504 | R1-a/b/c/d/e/f：`CommitRequestInput`、`CommitScopeRow`、`MAX_COMMIT_PATHS`、`MAX_COMMIT_PATH_LENGTH`、`commitPathProblem`、`commitPathsToSubmit`、`commitRequestParams` |
| `src/commitChecksResult.ts` | 122 | 179 | R2-a/b/c/d：`DocumentRevision`、指纹第四档 + 注释（本收尾批再 +2 行：`:205` 坐标修正留痕） |
| `src/sourceControlCommitChecks.ts` | 327 | 355 | R1-g/R2-b/c/d 的宿主侧：`documentRevisions?` / `commitScope?` 两个可选入参 + 四参 watch（本收尾批 +1 行注释） |
| `tests/commit-check.test.mjs` | 37 | 87 | R1-g 判据三条 |
| `tests/commit-checks.test.mjs` | 166 | 306 | R1-a…f 判据九条（含 native 源码锚点） |
| `tests/commit-checks-result.test.mjs` | 188 | 279 | R2-a…d 判据五条（含"同一篇改两次 ⇒ 指纹变"） |
| `native/git.hpp` | 172 | 180 | `commit(..., paths = {})` 尾参 |
| `native/git.cpp` | 936 | 791 | `commit(..., paths)`：500 上限 / `checked_path` / 先 `add` 后 `--only`（同批还有别的族按行拆去 `native/git_log.cpp`，故总数下降） |
| `native/git_test.cpp` | 533 | 579 | R1-c 与非法路径的 ctest 用例 |
| `docs/wiring-requests-2026-10-06-commit2.md` | 0 | 本批重写为 205 行 | C1 / C1b / C2 / C3 四段可照抄 |
| `docs/batch-2026-10-06-commit2.md` | 0 | 本文件 | 就是这份 |

本收尾批自己动过的只有三个文件，且全是注释：`src/commitChecksResult.ts`（6 行改动）、
`src/sourceControlCommitChecks.ts`（3 行）、这两处都是"引用坐标 + 留痕"，`git diff` 里没有任何语义改动。
反向验证的三处临时注入已全部撤回（见 §4 的 grep 结果）。

---

## 3. §5 门禁：每条命令的前后数字

「前」= 本收尾批动手之前（= HEAD `11a736e` 的工作区），「后」= 撤回注入、补完注释、写完这两份文档之后。

| 命令 | 前 | 后 |
|---|---|---|
| `node --test tests/commit-checks.test.mjs tests/commit-checks-result.test.mjs` | 22 + 23 = **45 tests / 45 pass / 0 fail** | 45 / 45 / 0 |
| `node --test tests/commit-checks.test.mjs tests/commit-checks-result.test.mjs tests/commit-check.test.mjs`（提交检查三件） | 54 / 54 / 0 | **54 / 54 / 0**（注入撤回后复跑，同一数字） |
| 提交域其余测试全跑（`commit-author` `commit-check` `commit-checks-progress` `commit-checks-result` `commit-checks-tooltip` `commit-checks` `commit-legend` `commit-message-history` `commit-message-inspection` `commit-notification` `commit-options`，11 个文件） | **131 tests / 131 pass / 0 fail**（324ms） | 131 / 131 / 0 |
| `npx vue-tsc -b --force` | **0 错**（无输出，exit 0） | **0 错**（无输出，exit 0） |
| `node --test tests/module-size.test.mjs` | 5 / 5 / 0 | 5 / 5 / 0（本域四个模块 91/504/179/355 行，全在 ts 900 之下） |
| `node .tools/find-param-props.mjs` | 共 0 处参数属性 | 0 |
| `node .tools/find-ts-in-mjs.mjs` | 干净：`tests/*.mjs` 全部纯 JS | 干净 |
| `node .tools/find-missing-ext.mjs` | 扫描 1303 个文件（src + tests），干净 | 干净 |
| `node .tools/find-orphan-modules.mjs --gate` | 零生产消费方 9（含合法例外 `src/main.ts`）· 已登记孤儿 8 / 基线 8 · **新增 0** · 清掉 0 ⇒ 绿 | 同一数字 ⇒ 绿（清单里**没有**本域任何一个文件） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 tests / **10 pass / 1 fail**（红的是 `moved :: src/components/DebugConsolePane.vue \| platform/execution-impl/src/com/intellij/execution/actions/PauseOutputAction.java \| 19-19` —— 快照里有这条引用而那片面板里已指不到它，属 run/debug 面，与本域无关） | 11 tests / **11 pass / 0 fail**。**这条转绿不是本批做的**：并行 lane 在 11:47 改回 `src/components/DebugConsolePane.vue`、11:53 重算了 `docs/inventory/citation-anchors.json`（保留文件，本批一个字节没动）。本批的影响只是新增两份文档里的引用，实跑确认仍然全绿 |
| native ctest | 未跑（本批没动 `native/` 一个字节；`native/git.cpp`/`git_test.cpp` 的东西是 HEAD 里既有的 ⇒ 既有 ctest 37/37 的口径不变） | 同左。⇒ 接线请求 C1/C1b 落地后**必须**由主代理重跑 `npm run test:native` 并看日志里的 `tests passed` 那行 |

---

## 4. 反向验证（注入 → 变红 → 撤掉 → 复绿）

注入都写在本域模块里、带 `REVFIX-*` 标记，验完逐条撤回。每轮只跑本域测试。

| 轮 | 注入了什么 | 红的测试 | 数字 |
|---|---|---|---|
| A | `src/commitChecksResult.ts`：把按篇修订段常量 `docs` 硬写成 `''`（= R2 第四档整体失效） | `每篇文档的修订号：同一篇改两次 ⇒ 指纹不同，没改 ⇒ 逐字相同（R2 判据）`、`修订段挂在指纹末尾：没给（宿主未接）时形状与本批之前逐字一致` | `commit-checks-result.test.mjs`：23 tests / **21 pass / 2 fail** |
| B | `src/commitChecks.ts`：`commitPathProblem()` 开头 `return null`（= 前端那道路径合法性闸恒过） | `非法的被选项在交给宿主之前就拒掉：- 前缀 / .. / 换行 / 超长（与 native 同一道闸）` | `commit-checks.test.mjs`：22 tests / **21 pass / 1 fail** |
| C | `src/commitChecks.ts`：把 `if (rejected.length) throw …` 换成 `void rejected`（= 「被忽略 / 对不上变更列表」两档范围校验整体失效） | `被忽略（noisy）的被选项：明确拒绝；宿主没给变更列表时不误拒（形状与本批之前逐字一致）`、`选中目录与它的子项一起给 ⇒ 两条都留（git 允许嵌套根，上游不折叠后代）` | `commit-checks.test.mjs`：22 tests / **20 pass / 2 fail** |

撤掉三轮注入后复绿：`node --test tests/commit-checks.test.mjs tests/commit-checks-result.test.mjs tests/commit-check.test.mjs` ⇒ **54 / 54 / 0**。

**残留标记复扫**（上一轮有 lane 把 `// REVFIX-5` 和改坏的常量留在生产码里，这一条按派单要求实跑）：

- `grep -rn "REVFIX" src/ tests/ native/` ⇒ **0 命中**。
- `grep -rn "REVFIX\|注入用" src/ tests/ native/` ⇒ **0 命中**。
- `grep -rn "REVFIX" docs/` ⇒ 2 命中，都在 `docs/batch-2026-10-06-main.md:370-371`，那是主代理**记载上一轮事故**的文字，不是代码。
- `git diff --stat -- src/ tests/`（本收尾批）⇒ 只剩 `src/commitChecksResult.ts`、`src/sourceControlCommitChecks.ts` 两个注释 hunk（`tests/b7-verdict.test.mjs`、`tests/lsp-server-messages.test.mjs` 是别的 lane 的在途改动，本批没碰）。

---

## 5. 零消费方自查

- `node .tools/find-orphan-modules.mjs --gate`：孤儿清单是 `src/agent.ts`、`src/components/ColorSchemeSettingsPage.vue`、`src/dragAndDropTargets.ts`、`src/generalSettingsLocal.ts`、`src/ideShellCreateTarget.ts`、`src/jarRun.ts`、`src/runAnythingContext.ts`、`src/scratchHistory.ts`（+ 合法例外 `src/main.ts`）—— **本域四个文件一个都不在其中**。
- 逐条确认生产消费链路：`src/commitChecks.ts` ← `src/sourceControlCommitChecks.ts:13-16` 与 `src/components/SourceControl.vue`（`commitRequestParams` 是面板唯一发提交的那一处，`tests/commit-checks.test.mjs:219-220` 钉住"只有一个 `request('git.commit'` 调用点"）；`src/commitChecksResult.ts` ← `src/sourceControlCommitChecks.ts:17-21`；`src/commitCheck.ts` ← 同上 `:12`；`src/sourceControlCommitChecks.ts` ← `src/components/SourceControl.vue:462` 的 `createCommitChecks({...})`。
- **要说清的半接线状态**（不是死模块，但生产侧暂时没人喂）：`CommitChecksDeps.documentRevisions`（`src/sourceControlCommitChecks.ts:72`）与 `commitScope`（`:79`）这两个**可选**入参，面板今天还没传（`src/components/SourceControl.vue` 是他人面，改动写在请求里）。
  它们不构成假控件：界面上**没有**任何一行依赖它们才出现（`tests/commit-checks.test.mjs:223` 反向钉住"不许有点了没反应的『提交文件…』按钮"），不传时指纹与空判的形状与本批之前**逐字一致**（`tests/commit-checks-result.test.mjs:255-265`、`tests/commit-check.test.mjs:64-78`）。文件头与字段注释都写明了为什么接不上、以及对应的请求编号。

---

## 6. 做不到 / 无法核实

1. **R1 的用户可见入口没落**（「提交文件…」那一行/多选弹层）。卡在 `src/App.vue`（保留文件，`appvue` 那片）+ `src/components/SourceControl.vue`（他人面）：宿主给不出 `commitPaths`，native 分派也没透传 ⇒ 按假控件禁令**宁可那一行不出现**。⇒ 请求 C1 + C2-1 + vcs2 W1b。
2. **R2 的按篇修订号只有模块侧**。上游每改一次文本就换一个号（`DocumentImpl.java:171`）；本仓这个号必须由宿主的编辑器事件给（`src/App.vue` 的 `@change`），本域拿不到 ⇒ 只能把记账代码写成可照抄的整段（请求 C3）。今天真界面上指纹仍是"变更列表 + 未保存清单"两档，**同一篇文档第二次编辑不会作废上一轮 PASSED** —— 这一条**已在判据里钉住**（宿主一接就生效），但现状要如实登记。
3. **中文文案无法逐字核实**。`plugins/localization-zh` 不在本地参考树里（`plugins/` 下只有 `ml-local-models`），而 `src/commitCheck.ts:79-83` 写着"中文包逐字对照"。本批改为按**英文原文直译**并核实英文出处：`platform/vcs-api/vcs-api-core/resources/messages/VcsBundle.properties:17-19`（`Select files to commit` / `Specify commit message` / `Select files to commit and specify commit message`）—— 与仓内三条中文一一对得上；同文件 `:22-23` 也对上了「正在提交…」两档。commitChecks.ts 里其余标注"中文包"的 key（`commit.checks.*`、`tooltip.rerun.commit.checks`、`label.todo.items.found`…）同样只核到**英文原文**，中文值属直译，不假装逐字。
4. **500 条 pathspec 上限没有上游依据**，是本仓自定的（`native/git.cpp:461` 与前端 `MAX_COMMIT_PATHS` 同一个数）。上游那一支不做长度上限，它的筛是 `FileStatus` 那一档（`CommonCheckinFilesAction.kt:74-78`）。这条保留的理由是命令行长度与往返成本，**不写成"照上游"**。
5. **native 的"被忽略文件不参与提交"那一档没做**。`native/git.cpp:298-301` 的 `status()` 只有 `include_ignored` 打开时才带 `--ignored=matching`，`commit()` 拿不到"这个路径是不是 ignored"，而 git 本身对 ignored 路径的 `git add` 会直接失败（`GIT_FAILED`，`native/git.cpp:215-218`）。⇒ 判据落在前端（R1-e），native 侧不做重复实现。
6. **引用门那条基线红不由本批修**：动手前 `source-citation-anchors` 报 `src/components/DebugConsolePane.vue → PauseOutputAction.java` 锚点 moved。它需要重算 `docs/inventory/citation-anchors.json`（保留文件）或改回那片面板，本批两者都不许动 ⇒ 只登记。**实际结果**：并行 lane 在写这份报告期间已经把它修绿（11:47 面板、11:53 快照），收工实跑 11/11 全绿。
7. **native 用例未跑**。本批零 native 改动（见 §3 末行），`npm run test:native` 的数字沿用 HEAD 的 37/37 口径，不重复声称"本批复跑过"。

---

## 7. 需要主代理接的线

全部在 `docs/wiring-requests-2026-10-06-commit2.md`：**C1**（`native/main.cpp:1169-1175` 透传 `paths`，R1 唯一缺的一环）、
**C1b**（`native/git_test.cpp` 补 500 上限与"空 `paths` 不加 `--only`"两条 ctest）、
**C2**（`src/components/SourceControl.vue`：`changes` 交进请求 + `commitScope` / `documentRevisions` 两个可选 prop）、
**C3**（`src/App.vue` + `src/toolViewContext.ts` + `src/components/ToolWindowView.vue`：按篇文档修订号的三段透传）。
每段都是"目标文件 + 目标行号 + 可照抄 old/new + 上游依据"，并附 R1 两档（空 `paths` / 含未跟踪）的期望行为取证表。
