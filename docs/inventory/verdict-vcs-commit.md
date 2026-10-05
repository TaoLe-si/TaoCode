# B3 判决：`vcs/commit` = 78 类（含 `message/` 与三个 commit 动作包）

判定依据：机械信号（`docs/inventory/vcs_scan.md` 里路径含 `/vcs/commit/`、`/openapi/vcs/actions/commit/`、
`/openapi/vcs/ex/commit/` 的行 —— 清单落在 `docs/inventory/vcs-commit.txt`，78 行）+ 逐类读上游源码
（`platform/vcs-api/src/com/intellij/vcs/commit/`、`platform/vcs-impl/src/com/intellij/vcs/commit/`…）
+ 本仓提交功能的真实落点核对（`src/components/SourceControl.vue`、`src/commitAuthor.ts`、
`src/commitCheck.ts`、`src/commitLegend.ts`、`src/commitMessageInspection.ts`、`src/commitNotification.ts`、
`native/git.cpp` 的 `git.commit*`）。

> 计划里写的"vcs/commit（67）"是**重枚举之前**的数（见 `docs/class-parity-todo.md` §0'）；
> 现在按扫描件重算 = **78**（其中 `message/` 9、`openapi/vcs/actions/commit` 3、`openapi/vcs/ex/commit` 2）。
> `vcs-log/.../details/commit/` 的两条不属于本域（日志窗口的详情面板）。
> §G 是逐条总表（78 行，机检对齐），四档计数写在表尾。

## A. 本地提交功能的地基（读判决前先看这一节）

本仓的"提交"不是按上游的类一个个搬的，而是**一条真实链路**：

| 本地落点 | 干什么 | 上游对应 |
|---|---|---|
| `src/components/SourceControl.vue`（749 行） | 提交面板本体：信息框（含历史/回滚/重新格式化）、变更列表（staged/unstaged + 逐块）、提交/提交并推送、图例、检查、amend、作者、推送/拉取/储藏/分支/标签/比较 | `NonModalCommitPanel` / `ChangesViewCommitPanel` / `CommitActionsPanel` / `CommitStatusPanel` 那一族 |
| `src/commitMessageInspection.ts`（330 行） | 提交信息检查：主题/正文右边距、主题与正文之间空行、输入时折行、重新格式化、设置与持久化 | `message/*` 那 9 类 |
| `src/commitCheck.ts` | 提交前的闸（改写上次提交时的空信息、TODO 预检的拒绝理由） | `CommitChecks` / `CommitWorkflowHandler.CommitChecksResult` |
| `src/commitLegend.ts` | 图例的分组与紧凑化（`ChangeInfoCalculator` + `CommitLegendPanel`） | `CommitStatusPanel` |
| `src/commitAuthor.ts` | 提交作者覆盖（`--author`）与作者日期 | `CommitAuthorComponent` / `CommitAuthorTracker` |
| `src/commitNotification.ts` | 提交结果通知（标题带最差结果、正文带信息与失败项、上一次自动过期） | `ShowNotificationCommitResultHandler` / `CommitNotification` |
| `native/git.cpp` 的 `git.commit` / `git.commitAndPush` / `git.amendMessage` … | 真正跑 git | `Committer` / `VcsCommitter` / `LocalChangesCommitter` 的执行体 |

**因此本域的判决口径**：用户能看见的行为多数已落（`[x]`/`[~]`），缺的是**上游那套面向插件与多 VCS 的
抽象层**（workflow/handler/ui 三层接口、EP、统计上报、Swing 面板适配）—— 那些在本仓没有宿主，
逐条判 `[-]` 并写理由，不留空壳。

## B. 已落地的（`[x]`，18 类）

| 上游类 | 本仓 |
|---|---|
| `CommitAuthorComponent` / `CommitAuthorTracker` | `src/commitAuthor.ts` + SourceControl.vue 的作者行（覆盖作者 + 作者日期；判据 `tests/commit-author.test.mjs`） |
| `CommitNotification` / `ShowNotificationCommitResultHandler` | `src/commitNotification.ts`（`expirePreviousAndNotify` = 上一次结果自动过期；判据 `tests/commit-notification.test.mjs`） |
| `BaseCommitMessageInspection` / `SubjectLimitInspection` / `BodyLimitInspection` / `SubjectBodySeparationInspection` / `BodyLimitSettings` | `src/commitMessageInspection.ts`（三条检查 + 右边距设置 + 输入时折行；判据 `tests/commit-message-inspection.test.mjs`） |
| `ReformatCommitMessageAction` | SourceControl.vue 的「重新格式化提交信息」（同一模块的 `reformatCommitMessage`） |
| `ToggleAmendCommitOption` | SourceControl.vue 的 amend 勾选框（tooltip 与 VK_M 助记符已引 `ToggleAmendCommitOption.kt:19/23`） |
| `CommitOptions` / `CommitOptionsPanel`（本轮） | `src/commitOptions.ts`（按工作区根存档 + 检查时机决策）+ SourceControl.vue 的提交选项弹层（署名 / 提交前 TODO 预检 / 慢检查推后）；判据 `tests/commit-options.test.mjs` |
| `CommitChecks` / `PostCommitChecksHandler`（本轮） | 同一模块的 `postponeSlowChecks`（`NON_MODAL_COMMIT_POSTPONE_SLOW_CHECKS` 默认 true）+ SourceControl.vue 的 `runPostCommitChecks()`（提交后再跑、失败不撤销提交）；判据同上 |

## C. 已落地但缺一块的（`[~]`，43 类）

按缺什么分组（§G 里每条都指到具体文件）：

1. **提交流程三层（workflow / handler / ui）**：本仓把这三层压成了"Vue 组件 + `src/commit*.ts` + 宿主"，
   行为在（提交、检查、通知、图例、作者、选项），但**没有那三个接口对象**；缺的是"换一套 UI 实现"
   或"换一个 VCS 实现"的插槽。→ `AbstractCommitWorkflow` / `AbstractCommitWorkflowHandler` /
   `NonModalCommitWorkflow` / `NonModalCommitWorkflowHandler` / `NonModalCommitWorkflowUi` /
   `CommitWorkflowHandler` / `CommitWorkflowUi` / `ChangesViewCommitWorkflow` / `…Handler` / `…Ui` /
   `SingleChangeListCommitWorkflow(Ui|Handler)` / `CommitMode` / `CommitModeManager`。
2. **amend 的一次性提交**：`getLastCommitMessage` 与"改写上次提交"都有（`src/commitCheck.ts` 引用
   `commitToAmend`/`amendRoot`），缺**"改某一次具体提交"**（`CommitToAmend.Resolved` +
   `getAmendSpecificCommitTargets` + `AmendCommitModeDropDownLink` 那个下拉）。→ `AmendCommitHandler` /
   `AmendCommitHandlerImpl` / `NonModalAmendCommitHandler` / `AmendCommitAware` / `ToggleAmendCommitModeAction`。
3. **提交信息的策略层**：本仓只有"一条信息 + 历史 + 回滚"，没有"每个变更列表各自的信息"
   （`ChangeListCommitMessagePolicy` 一族）与"延迟提供的信息"（issue tracker 那类 provider）。
   → `AbstractCommitMessagePolicy` / `DefaultCommitMessagePolicy` / `DelayedCommitMessageProvider`。
4. **检查的进度与"只跑检查"**：检查进度已落（`CommitChecksProgressIndicator` 的面板内那一条 + 状态栏任务行；见 §G 两行），
   缺的是点击进度行后那个带进度条的浮层（`CommitChecksProgressIndicatorTooltip`，§G 末行判 `[~]`）、
   `RunCommitChecksExecutor`（"不提交、只跑检查"的入口 —— 第五十/五十一批已落），
   （`CommitChecks` / `PostCommitChecksHandler` 的「慢检查推后到提交后」**本轮已落**，见 §B 与 §G 两行；这一条只剩进度行的分步上下文）。
5. **执行体与结果处理**：`Committer` / `VcsCommitter` / `LocalChangesCommitter` / `CustomCommitter` /
   `SingleChangeListCommitter` / `ChangeListCommitState` / `CommitExceptionWithActions` /
   `CheckinHandlersNotifier` —— 本仓这一层在 `native/git.cpp` + `src/commitNotification.ts`，
   缺的是"提交流程可被第三方执行器接管"（`CommitExecutor`）与 checkin handler 的提交前后钩子。
6. **面板零件**：`CommitActionsPanel`（提交按钮 + 选项按钮）/ `CommitOptions(Panel)` /
   `PartialCommitInclusionModel`（部分提交的包含模型）/ `CommitProgressPanel` / `CommitChunkComponent`
   （按块提交）/ `ChangesViewCommitPanel` / `NonModalCommitPanel` / `SaveCommittingDocumentsVetoer`
   （提交前保存文档的否决）/ 三个 commit 动作（`AbstractCommitChangesAction` / `CheckinActionUtil` /
   `CommonCheckinFilesAction` / `CommonCheckinProjectAction`：本仓只有「提交项目…」一条行）。

## D. 不适用（`[-]`，17 类）—— 附理由

| 类别 | 类数 | 理由 |
|---|---|---|
| 变更列表（changelist）专属 | 4 | `ChangeListClassifierProvider`（EP：哪个变更列表的信息由描述提供）、`ChangesViewCommitMessagePolicy`、`ChangesViewCommitTabTitleUpdater`（按变更列表改标签标题）、`SingleChangeListCommitMessagePolicy`：本仓的暂存模型是 **git index**（staged/unstaged 两份），没有 IDEA 的 `LocalChangeList` 概念，做出来只是名字对不上 |
| 只存在于"提交对话框"形态的那一族 | 4 | `SingleChangeListCommitWorkflow` / `…Handler` / `…Ui` / `SingleChangeListCommitter`：上游这四个是 `CommitChangeListDialog`（模态对话框）的流程；本仓的提交是**常驻面板**，没有对话框宿主 |
| 插件扩展点 / 遥测上报 | 5 | `CommitMessageInspectionEP`、`CommitSuccessNotificationActionProvider`、`VcsPathsToRefreshProvider`（三个 EP）、`CommitChunkCollector` / `CommitSessionCollector`（两个上报）：本仓没有插件运行时、也没有上报通道（硬规则 2 的例子） |
| Swing 自绘构件与接口桥 | 3 | `CommitInputBorder`（自绘错误边框 ⇒ CSS）、`FixedSizeScrollPanel`（固定尺寸滚动面板 ⇒ CSS）、`CommitProjectPanelAdapter`（把 workflow handler 适配成 `CheckinProjectPanel`：本仓没有这个契约） |
| 空对象 | 1 | `NullCommitWorkflowHandler`（"这个产品没有提交功能"用的空实现）：本仓没有对应形态 |

## E. 未移植（`[ ]`，0 类）—— 没有留白

2026-10-04 处置：最后一条 `CommitChecksProgressIndicatorTooltip` 从 `[ ]` 改判 `[~]` —— 本仓已有它的对应物（面板内进度行 + 状态栏任务行两处，`src/commitChecks.ts` / `src/components/SourceControl.vue` / `src/progressPanel.ts`），缺的只是「点击后把同一进度放大成带进度条的浮层」（`CommitChecksProgressIndicatorTooltip.kt:23-58`）。本域 `[ ]` 归零。

下一批真正要做的不是"补类"，而是 §C 里那几条**用户能看见的缺口**（按价值）：
① ~~「只运行检查」入口~~（`RunCommitChecksExecutor`）**已落**（第五十/五十一批）：入口照上游放在失败行上那把刷新按钮里，
   并补上配套的「仍然提交」（`action.commit.anyway.text`）——**没有**常显按钮（上游没有）；
   `CommitChecksProgressIndicator` 仍是 `[~]`（第九十六批已补面板内那一条；分步上下文仍缺），
   点击浮层已随 `CommitChecksProgressIndicatorTooltip` 改判 `[x]`（本轮）；
② 「改某一次具体提交」（`CommitToAmend.Resolved` 那条下拉，即 `CommitToAmend.Specific` 那一档）——**仍是缺口，且刻意不做**：
   上游那条下拉（`AmendCommitModeDropDownLink.kt:22-121`，注册键 `git.amend.specific.commit` 默认 **true**，
   `intellij.vcs.git.backend.xml:786`）背后是 `GitAmendSpecificCommitSquasher.squashAmendCommitIntoTarget`
   （`GitAmendSpecificCommitSquasher.kt:36-76`）—— 一次**内存内 autosquash rebase**
   （`InMemoryRebaseOperations.squash` + `GitInteractiveRebaseEntriesProvider`，冲突还要 undo + 通知）。
   只做下拉而 `git commit --amend` 仍旧打 HEAD ⇒ 硬规则 2 的**假控件**，所以不落。
   同一条的**清单部分**（`GitRecentCommitsProvider` + `GitAmendCommitService.getAmendSpecificCommitTargets`）
   是纯读取，但没有下游的 squash 就没有消费者，同样不单独建。
③ ~~提交前保存文档的否决~~（`SaveCommittingDocumentsVetoer`）**已落**（第五十批）：`saveDuringCommitQuestion` + `confirmSaveDuringCommit`；
④ 三层的插槽（`CommitExecutor`：让"提交"能被别的执行器接管）——这条价值最低，且要有真消费者才建。

## F. 判据（本判决文件自身的门控）

`tests/b3-verdict.test.mjs`：

1. **覆盖 78 类，不多不少**：从 `docs/inventory/vcs_scan.md` 里按本文件头的路径过滤重新推导，
   与 `docs/inventory/vcs-commit.txt`（78 行）逐条对齐，且每个类名在 §G 表里恰有一行。
2. **`[x]`/`[~]` 行的依据必须指到真实文件**：§G 里所有 `[x]`/`[~]` 行反引号里的每个 `src/…`/`native/…`
   路径都必须在磁盘上存在（防"注释里提过就算移植"）。
3. **§D 的四条理由必须真的在文件里**（变更列表 / 插件扩展点与上报 / Swing 专属构件 / 空实现与桥接）。
4. **四档计数自洽**：§G 里 `[x]`+`[~]`+`[ ]`+`[-]` 的行数等于 78，且与表尾写的一致。

## G. 逐条总表（78 类，与 `docs/inventory/vcs-commit.txt` 一一对齐）

| 类 | 源码 | 判决 | 依据（有实现点的指到真实 `src/` 文件） |
|---|---|---|---|
| `AmendCommitHandler` | `platform/vcs-api/src/com/intellij/vcs/commit/AmendCommitHandler.kt` | `[~]` | `src/commitCheck.ts`（`commitToAmend`/`amendRoot` 的闸）+ 面板的 amend 勾选框 + **`src/amendMessage.ts`**（进 amend 模式预填上次提交的信息、退出还原草稿 = `setAmendMessage`/`restoreBeforeAmendMessage`，判据 `tests/amend-message.test.mjs`）；**缺** `CommitToAmend.Resolved`（改某一次具体提交 —— `git.amend.specific.commit` 默认 true，上游真会列出最近提交）与 `getAmendSpecificCommitTargets` |
| `CommitAuthorTracker` | `platform/vcs-api/src/com/intellij/vcs/commit/CommitAuthorTracker.kt` | `[x]` | `src/commitAuthor.ts`（作者与作者日期、`--author` 覆盖、清除；判据 `tests/commit-author.test.mjs`） |
| `CommitMode` | `platform/vcs-api/src/com/intellij/vcs/commit/CommitMode.kt` | `[~]` | `src/components/SourceControl.vue`：本仓只有**非模态**一档（常驻面板）；`PendingCommitMode`/`ModalCommitMode` 没有宿主 ⇒ §D |
| `CommitWorkflowHandler` | `platform/vcs-api/src/com/intellij/vcs/commit/CommitWorkflowHandler.kt` | `[~]` | 流程行为在 `src/commitCheck.ts` + `src/components/SourceControl.vue`（`CommitChecksResult` 那几档对应"拒绝原因"）；没有这个接口对象 |
| `CommitWorkflowUi` | `platform/vcs-api/src/com/intellij/vcs/commit/CommitWorkflowUi.kt` | `[~]` | 面板在 `src/components/SourceControl.vue`、信息框在 `src/commitMessageInspection.ts`；没有接口层 |
| `AbstractCommitChangesAction` | `platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/AbstractCommitChangesAction.kt` | `[~]` | `src/menus/gitMenu.ts` 的「提交项目…」一条行；缺"提交文件"那一支（`CommonCheckinFilesAction`） |
| `CheckinActionUtil` | `platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/CheckinActionUtil.kt` | `[~]` | `src/components/SourceControl.vue` 的提交流程就是入口（没有从 data context 取 handler 的一层） |
| `CommonCheckinFilesAction` | `platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/CommonCheckinFilesAction.kt` | `[~]` | 缺按文件提交的入口：本仓只能从 `src/components/SourceControl.vue` 的变更列表提交整份变更 |
| `CommonCheckinProjectAction` | `platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/CommonCheckinProjectAction.kt` | `[~]` | `src/menus/gitMenu.ts:34` 的「提交项目…」（Ctrl K）落到 `ctx.showView('git')`；缺 `ToggleChangesViewCommitUiAction`（形态切换） |
| `CommitChunkCollector` | `platform/vcs-impl/src/com/intellij/openapi/vcs/ex/commit/CommitChunkCollector.kt` | `[-]` | 遥测上报（`CounterUsagesCollector`），本仓没有上报通道 |
| `CommitChunkComponent` | `platform/vcs-impl/src/com/intellij/openapi/vcs/ex/commit/CommitChunkComponent.kt` | `[~]` | 按块提交在 `src/components/SourceControl.vue` 的 `applyHunks`（`git.applyHunks`）+ DiffView 的勾选；**缺**上游那个把"块"画成独立组件的形态（本仓在 diff 里勾选） |
| `AbstractCommitMessagePolicy` | `platform/vcs-impl/src/com/intellij/vcs/commit/AbstractCommitMessagePolicy.kt` | `[~]` | 信息策略：`src/commitMessageInspection.ts` 管检查、SourceControl.vue 管历史/回滚；缺"若干来源各自给一条信息"的模型 |
| `AbstractCommitWorkflow` | `platform/vcs-impl/src/com/intellij/vcs/commit/AbstractCommitWorkflow.kt` | `[~]` | 流程状态在 `src/components/SourceControl.vue` + 宿主；缺选项保存/恢复的统一层（本仓的选项直接进设置） |
| `AbstractCommitWorkflowHandler` | `platform/vcs-impl/src/com/intellij/vcs/commit/AbstractCommitWorkflowHandler.kt` | `[~]` | 同上：handler 的职责分散在 `src/components/SourceControl.vue` 与宿主 |
| `AbstractCommitter` | `platform/vcs-impl/src/com/intellij/vcs/commit/AbstractCommitter.kt` | `[~]` | 提交执行在 `native/git.cpp`（`git.commit`）+ `src/components/SourceControl.vue`；缺"执行器"抽象 |
| `AmendCommitAware` | `platform/vcs-impl/src/com/intellij/vcs/commit/AmendCommitAware.kt` | `[~]` | `getLastCommitMessage` 走原生 `git.commitDetails`（`%B`）+ `src/amendMessage.ts` 的 `amendMessagePlan`；缺 `getAmendCommitDetails` 的其余分支（作者/日期也跟着改写那个提交） |
| `AmendCommitHandlerImpl` | `platform/vcs-impl/src/com/intellij/vcs/commit/AmendCommitHandlerImpl.kt` | `[~]` | 同上（本仓没有那个对象，行为在面板与 `src/commitCheck.ts`） |
| `AmendCommitModeDropDownLink` | `platform/vcs-impl/src/com/intellij/vcs/commit/AmendCommitModeDropDownLink.kt` | `[~]` | 本仓的 amend 是勾选框（`src/components/SourceControl.vue` 的 `.sc-amend`）；**缺**上游那个「改哪一次提交」的下拉链接 |
| `ChangeListClassifierProvider` | `platform/vcs-impl/src/com/intellij/vcs/commit/ChangeListClassifierProvider.kt` | `[-]` | 变更列表扩展点（哪个列表的信息由描述提供）：本仓是 git index 模型（见 `src/components/SourceControl.vue` 的 staged/unstaged 两份），没有 `LocalChangeList` |
| `ChangesViewCommitMessagePolicy` | `platform/vcs-impl/src/com/intellij/vcs/commit/ChangesViewCommitMessagePolicy.kt` | `[-]` | 按变更列表存提交信息：同上，没有变更列表 |
| `ChangesViewCommitPanel` | `platform/vcs-impl/src/com/intellij/vcs/commit/ChangesViewCommitPanel.kt` | `[~]` | `src/components/SourceControl.vue`（面板本体：信息框 + 变更 + 动作 + 图例；第五十三批把那一行按 `VcsToolbarActions` 裁成「更新项目 + 推送 + 图例」）；**缺** `ChangesView.ToggleCommitUi`（本仓只有一个提交界面） |
| `ChangesViewCommitTabTitleUpdater` | `platform/vcs-impl/src/com/intellij/vcs/commit/ChangesViewCommitTabTitleUpdater.kt` | `[-]` | 按变更列表名改工具窗口标签标题：没有变更列表 |
| `ChangesViewCommitWorkflow` | `platform/vcs-impl/src/com/intellij/vcs/commit/ChangesViewCommitWorkflow.kt` | `[~]` | 流程在面板 + 宿主（`src/components/SourceControl.vue` 的 `runCommit`/`commitAndPush`） |
| `ChangesViewCommitWorkflowHandler` | `platform/vcs-impl/src/com/intellij/vcs/commit/ChangesViewCommitWorkflowHandler.kt` | `[~]` | 同上：流程与面板同住 `src/components/SourceControl.vue` |
| `ChangesViewCommitWorkflowUi` | `platform/vcs-impl/src/com/intellij/vcs/commit/ChangesViewCommitWorkflowUi.kt` | `[~]` | 同上（`src/components/SourceControl.vue`） |
| `CheckinHandlersNotifier` | `platform/vcs-impl/src/com/intellij/vcs/commit/CheckinHandlersNotifier.kt` | `[~]` | `src/commitCheck.ts` 的闸 + `src/commitNotification.ts` 的结果通知；缺 checkin handler 的提交前后回调（没有插件） |
| `CommitActionsPanel` | `platform/vcs-impl/src/com/intellij/vcs/commit/CommitActionsPanel.kt` | `[~]` | `src/components/SourceControl.vue` 的提交/提交并推送按钮与选项按钮（含 Ctrl+K / Ctrl+Shift+Enter 的文案） |
| `CommitAuthorComponent` | `platform/vcs-impl/src/com/intellij/vcs/commit/CommitAuthorComponent.kt` | `[x]` | `src/commitAuthor.ts` + 面板的作者行（判据 `tests/commit-author.test.mjs`） |
| `CommitChecks` | `platform/vcs-impl/src/com/intellij/vcs/commit/CommitChecks.kt` | `[x]` | **2026-10-04 本轮已落**：`NON_MODAL_COMMIT_POSTPONE_SLOW_CHECKS` 的开关与语义（上游 `VcsConfiguration.java:151`，默认 true）在 `src/commitOptions.ts` 的 `postponeSlowChecks` + `runsChecksBeforeCommit`/`runsChecksAfterCommit`，勾选框在 `src/components/SourceControl.vue` 的提交选项弹层（文案照 `CommitOptionsPanel.kt:110-118` 的 `settings.commit.postpone.slow.checks`）；开着时提交前不跑检查，判据 `tests/commit-options.test.mjs` |
| `CommitChecksProgressIndicator` | `platform/vcs-impl/src/com/intellij/vcs/commit/CommitChecksProgressIndicator.kt` | `[~]` | **第九十六批已落面板内那一条**：`src/commitChecks.ts` 的 `checksProgress`（标题 `progress.title.commit.checks`、两档正文 `commit.checks.only…` / `commit.checks.on.commit…`、可取消 + 取消文案，照 `CommitChecksTaskInfo:18-23` 与 `StatusBarProgressIndicator.setText:105-125`）+ `fixDoubleEllipsis`（`:71-86`），渲染在 `src/components/SourceControl.vue` 的 `.sc-checks-progress`。状态栏后台任务行仍在（`src/progressPanel.ts`）—— 两处本来就是同一个进度的两个投影。**缺**：悬停浮层、以及"当前进行到哪一步"那条上下文（本仓没有分步通道，`step` 恒传 null） |
| `CommitChecksProgressIndicatorTooltip` | `platform/vcs-impl/src/com/intellij/vcs/commit/CommitChecksProgressIndicatorTooltip.kt` | `[x]` | **2026-10-04 本轮已落**：点击面板内那条进度行弹出的浮层。纯规则在 `src/commitChecks.ts` 的 `checksProgressPopup`（`open && 指示器还在跑` 才可见 —— 对应上游 `stop()` → `closePopup()`；沿用行的标题/正文；`bar: true` = 上游 `PopupCommitChecksProgressIndicator` 比行多一条进度条；`placement: 'above'` + `CHECKS_POPUP_GAP = 8` = `Point(0, -height - scale(8))`），接线在 `src/components/SourceControl.vue`（进度行整行可点、浮层挂在行内 `bottom: calc(100% + 8px)`、取消按钮 `@click.stop` 不触发切换），进度条动画走令牌 `var(--dur-spin)/var(--ease-linear)`。判据 `tests/commit-checks-tooltip.test.mjs`（5 条：开合两态、停止即收、标题正文与进度条、摆位与 8px、接线）。 |
| `CommitExceptionWithActions` | `platform/vcs-impl/src/com/intellij/vcs/commit/CommitExceptionWithActions.kt` | `[~]` | `src/commitNotification.ts` 的通知（含动作）；缺"异常自带动作列表"的类型面 |
| `CommitInputBorder` | `platform/vcs-impl/src/com/intellij/vcs/commit/CommitInputBorder.kt` | `[-]` | Swing 自绘错误边框：等价物是 CSS（`.sc-msg-inspections` 那条 alert） |
| `CommitModeManager` | `platform/vcs-impl/src/com/intellij/vcs/commit/CommitModeManager.kt` | `[~]` | 本仓只有非模态一档（`src/components/SourceControl.vue` 常驻面板）；`vcs.non.modal.commit.toggle.ui` 那套开关没有对应形态 |
| `CommitNotification` | `platform/vcs-impl/src/com/intellij/vcs/commit/CommitNotification.kt` | `[x]` | `src/commitNotification.ts`（`expirePreviousAndNotify` 已落） |
| `CommitOptions` | `platform/vcs-impl/src/com/intellij/vcs/commit/CommitOptions.kt` | `[x]` | **2026-10-04 本轮已落 save/restore 统一层**：`src/commitOptions.ts` 按工作区根存 `taocode.commitOptions:<root>`（坏存档落回默认、不挡提交），`src/components/SourceControl.vue` 的三个选项（署名 / 提交前 TODO 预检 / 慢检查推后）改动即存、换项目重读；判据 `tests/commit-options.test.mjs` |
| `CommitOptionsPanel` | `platform/vcs-impl/src/com/intellij/vcs/commit/CommitOptionsPanel.kt` | `[x]` | **本轮补齐**：选项组的呈现是 DOM（`src/components/SourceControl.vue` 的提交选项弹层：作者行 / Git 组 / 提交检查组），三个选项都接上存档层 —— 其中「提交完成后再运行检查」就是 `CommitOptionsPanel.kt:110-118` 那一行；见 `CommitOptions` 行 |
| `CommitProgressPanel` | `platform/vcs-impl/src/com/intellij/vcs/commit/CommitProgressPanel.kt` | `[~]` | 错误行（`buildErrorText`，`:321-328` ⇒ `src/commitChecks.ts` 的 `commitBlockMessage` + 面板 `.sc-commit-check`）与失败行（`FailuresPanel`，`:394-471` ⇒ 面板 `.sc-check-failures` + `failuresRowText`）都在。**第九十六批补上那条警告**：`NOT_AVAILABLE_DURING_INDEXING`（`label.commit.checks.not.available.during.indexing`，`:310` 那一支）渲染在面板上，判据 `indexingWarningVisible(analyzing, checksBusy)` —— 本仓的"分析中"= **配了语言服务但还没跑起来**（与状态栏 `smartModeLabel` 同一条判据；没配服务是正常状态，不算分析中）。**缺**：检查那一刻的"还没开始"态 |
| `CommitProjectPanelAdapter` | `platform/vcs-impl/src/com/intellij/vcs/commit/CommitProjectPanelAdapter.kt` | `[-]` | 把 workflow handler 适配成 `CheckinProjectPanel` 的桥：本仓没有 `CheckinProjectPanel` 这个契约 |
| `CommitSessionCollector` | `platform/vcs-impl/src/com/intellij/vcs/commit/CommitSessionCollector.kt` | `[-]` | 提交会话的统计上报：没有上报通道 |
| `CommitStatusPanel` | `platform/vcs-impl/src/com/intellij/vcs/commit/CommitStatusPanel.kt` | `[~]` | 图例在 `src/commitLegend.ts` + 面板的 `.sc-legend`（判据 `tests/commit-legend.test.mjs`）；面板容器由 Vue 承担 |
| `CommitSuccessNotificationActionProvider` | `platform/vcs-impl/src/com/intellij/vcs/commit/CommitSuccessNotificationActionProvider.kt` | `[-]` | EP：提交成功后由插件补通知动作；本仓没有插件运行时 |
| `Committer` | `platform/vcs-impl/src/com/intellij/vcs/commit/Committer.kt` | `[~]` | 提交执行在 `native/git.cpp`（`git.commit`）；缺执行器抽象 |
| `CustomCommitter` | `platform/vcs-impl/src/com/intellij/vcs/commit/CustomCommitter.kt` | `[~]` | 同 `native/git.cpp` 的提交路径（本仓没有第三条执行路径） |
| `DefaultCommitMessagePolicy` | `platform/vcs-impl/src/com/intellij/vcs/commit/DefaultCommitMessagePolicy.kt` | `[~]` | 默认信息策略：本仓是「空信息 + 历史」（`src/components/SourceControl.vue` 的信息框与历史行），没有策略接口 |
| `DelayedCommitMessageProvider` | `platform/vcs-impl/src/com/intellij/vcs/commit/DelayedCommitMessageProvider.kt` | `[~]` | 延迟提供信息（issue tracker 那类）：本仓没有 provider 机制（信息框在 `src/components/SourceControl.vue`） |
| `FixedSizeScrollPanel` | `platform/vcs-impl/src/com/intellij/vcs/commit/FixedSizeScrollPanel.kt` | `[-]` | Swing 固定尺寸滚动面板：DOM 里由 CSS 承担 |
| `LocalChangesCommitter` | `platform/vcs-impl/src/com/intellij/vcs/commit/LocalChangesCommitter.kt` | `[~]` | 本地提交在 `native/git.cpp`（`git.commit` 的路径）+ 面板；缺"按本地变更列表提交"的那层 |
| `NonModalAmendCommitHandler` | `platform/vcs-impl/src/com/intellij/vcs/commit/NonModalAmendCommitHandler.kt` | `[~]` | amend 行为在 `src/components/SourceControl.vue` + `src/commitCheck.ts`；没有 handler 对象 |
| `NonModalCommitPanel` | `platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitPanel.kt` | `[~]` | `src/components/SourceControl.vue`（面板本体） |
| `NonModalCommitWorkflow` | `platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflow.kt` | `[~]` | 流程在 `src/components/SourceControl.vue` + 宿主（`runCommit`/`commitAndPush`） |
| `NonModalCommitWorkflowHandler` | `platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt` | `[~]` | 同上：`src/components/SourceControl.vue`；`checkCommit()` 的空判（`:177-184`）与 `willSkipCommitChecks()` 改名「仍然提交」（`:229-233`）已落；**缺** `RecentCommitChecks` 那几档（MODIFICATIONS/POST_FAILED）与 dumb-mode 那条路 |
| `NonModalCommitWorkflowUi` | `platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowUi.kt` | `[~]` | 同上：`src/components/SourceControl.vue` |
| `NullCommitWorkflowHandler` | `platform/vcs-impl/src/com/intellij/vcs/commit/NullCommitWorkflowHandler.kt` | `[-]` | 空对象（"没有提交功能"的产品用）：本仓没有对应形态 |
| `PartialCommitInclusionModel` | `platform/vcs-impl/src/com/intellij/vcs/commit/PartialCommitInclusionModel.kt` | `[~]` | 部分提交的包含模型：`src/components/SourceControl.vue` 的 staged 勾选 + `applyHunks`（按块） |
| `PostCommitChecksHandler` | `platform/vcs-impl/src/com/intellij/vcs/commit/PostCommitChecksHandler.kt` | `[x]` | **2026-10-04 本轮已落**：`src/components/SourceControl.vue` 的 `runPostCommitChecks()` —— 提交成功后跑同一份检查（`collectCommitChecks(false)`，不带空判），失败只落到失败行与通知（正文 `postCommitCheckFailures` 说明「提交已完成、检查失败不撤销提交」），对应上游 `pendingPostCommitChecks`（`NonModalCommitWorkflowHandler.kt:398-407`）；判据 `tests/commit-options.test.mjs` |
| `RunCommitChecksExecutor` | `platform/vcs-impl/src/com/intellij/vcs/commit/RunCommitChecksExecutor.kt` | `[x]` | `src/commitChecks.ts`（`RUNNING_CHECKS_TEXT` = `commit.checks.only.progress.text`）+ `src/components/SourceControl.vue` 失败行上那把刷新按钮（上游这条入口就是 `RerunCommitChecksAction`，`CommitProgressPanel.kt:492-521`）+ 「仍然提交」跳过检查（`commitAnywayLabel`）；真机取证见审计 §AW |
| `SaveCommittingDocumentsVetoer` | `platform/vcs-impl/src/com/intellij/vcs/commit/SaveCommittingDocumentsVetoer.kt` | `[x]` | `src/commitChecks.ts` 的 `saveDuringCommitQuestion`（`VcsBundle` `save.committing.files.confirmation.*` 原文）+ `src/components/SourceControl.vue` 的 `confirmSaveDuringCommit`（文件清单来自宿主通道 `dirtyPaths`/`savePath`） |
| `ShowNotificationCommitResultHandler` | `platform/vcs-impl/src/com/intellij/vcs/commit/ShowNotificationCommitResultHandler.kt` | `[x]` | `src/commitNotification.ts`（标题取最差结果、正文带信息与失败项） |
| `SingleChangeListCommitMessagePolicy` | `platform/vcs-impl/src/com/intellij/vcs/commit/SingleChangeListCommitMessagePolicy.kt` | `[-]` | 按变更列表的信息策略：没有变更列表 |
| `SingleChangeListCommitWorkflow` | `platform/vcs-impl/src/com/intellij/vcs/commit/SingleChangeListCommitWorkflow.kt` | `[-]` | 单变更列表的**对话框**流程（`CommitChangeListDialog`）：本仓是常驻面板，没有对话框宿主 |
| `SingleChangeListCommitWorkflowHandler` | `platform/vcs-impl/src/com/intellij/vcs/commit/SingleChangeListCommitWorkflowHandler.kt` | `[-]` | 同上 |
| `SingleChangeListCommitWorkflowUi` | `platform/vcs-impl/src/com/intellij/vcs/commit/SingleChangeListCommitWorkflowUi.kt` | `[-]` | 同上 |
| `SingleChangeListCommitter` | `platform/vcs-impl/src/com/intellij/vcs/commit/SingleChangeListCommitter.kt` | `[-]` | 同上（单变更列表的执行体） |
| `ToggleAmendCommitModeAction` | `platform/vcs-impl/src/com/intellij/vcs/commit/ToggleAmendCommitModeAction.kt` | `[~]` | 第五十二批按它核过：文案与浮层在 `src/commitPanelStrings.ts`（`checkbox.amend` = 修正(M)、标题+Alt+M、**无描述**）、控件在 `src/components/SourceControl.vue` 且位置 = `ChangesView.CommitToolbar` 那一行（与图例同行）；**缺** `isAmendSpecificCommitSupported` 为真时的 `ToggleAmendPanel`（勾选框 + 「上次提交」下拉），见 `AmendCommitHandler` 行。判据 `tests/scm-panel-strings.test.mjs` |
| `ToggleAmendCommitOption` | `platform/vcs-impl/src/com/intellij/vcs/commit/ToggleAmendCommitOption.kt` | `[x]` | `src/components/SourceControl.vue` 的 amend 勾选框（tooltip 与 VK_M 助记符引 `ToggleAmendCommitOption.kt:19/23`） |
| `VcsCommitter` | `platform/vcs-impl/src/com/intellij/vcs/commit/VcsCommitter.kt` | `[~]` | 提交执行在 `native/git.cpp` + `src/commitNotification.ts` 的结果处理；缺 VCS 无关的执行体 |
| `VcsPathsToRefreshProvider` | `platform/vcs-impl/src/com/intellij/vcs/commit/VcsPathsToRefreshProvider.kt` | `[-]` | EP：插件声明"提交后要刷新哪些路径"；本仓没有插件运行时 |
| `BaseCommitMessageInspection` | `platform/vcs-impl/src/com/intellij/vcs/commit/message/BaseCommitMessageInspection.kt` | `[x]` | `src/commitMessageInspection.ts`（三条检查共用的形状与运行入口） |
| `BodyLimitInspection` | `platform/vcs-impl/src/com/intellij/vcs/commit/message/BodyLimitInspection.kt` | `[x]` | `src/commitMessageInspection.ts` 的正文行检查（`BODY_LIMIT_MESSAGE`） |
| `BodyLimitSettings` | `platform/vcs-impl/src/com/intellij/vcs/commit/message/BodyLimitSettings.kt` | `[x]` | `src/commitMessageInspection.ts` 的 `DEFAULT_RIGHT_MARGIN`/`RIGHT_MARGIN_MIN/MAX` + 设置持久化 |
| `CommitMessageInspectionDetails` | `platform/vcs-impl/src/com/intellij/vcs/commit/message/CommitMessageInspectionDetails.kt` | `[~]` | 检查的**设置页**：本仓有右边距等设置（`src/settingsPersistence.ts` 的 `commitMessageSettings`），缺"每条检查各自一页 + 严重度"的明细面板 |
| `CommitMessageInspectionEP` | `platform/vcs-impl/src/com/intellij/vcs/commit/message/CommitMessageInspectionEP.kt` | `[-]` | EP：插件贡献提交信息检查；本仓没有插件运行时 |
| `CommitMessageInspectionProfile` | `platform/vcs-impl/src/com/intellij/vcs/commit/message/CommitMessageInspectionProfile.java` | `[~]` | 本仓是一套设置（`src/commitMessageInspection.ts` 的 `CommitMessageInspectionSettings`）；没有 `InspectionProfileImpl` 那套检查配置档 |
| `CommitMessageInspectionsPanel` | `platform/vcs-impl/src/com/intellij/vcs/commit/message/CommitMessageInspectionsPanel.kt` | `[~]` | 同上：设置面在 `src/commitMessageInspection.ts` 与 `src/settingsPersistence.ts` |
| `ReformatCommitMessageAction` | `platform/vcs-impl/src/com/intellij/vcs/commit/message/ReformatCommitMessageAction.java` | `[x]` | `src/components/SourceControl.vue` 的 `reformatCommitMessage`，入口 = 每条检查问题的快捷修复（上游也是这条；第五十二批撤掉消息区那个上游没有的常显按钮；键位 `Alt+L`（`use-shortcut-of=ReformatCode`）登记在 `docs/source-todo.md` §16）。判据 `tests/commit-message-inspection.test.mjs` |
| `SubjectBodySeparationInspection` | `platform/vcs-impl/src/com/intellij/vcs/commit/message/SubjectBodySeparationInspection.java` | `[x]` | `src/commitMessageInspection.ts` 的 `MISSING_BLANK_LINE_MESSAGE` + `addBlankLineAfterSubject` |
| `SubjectLimitInspection` | `platform/vcs-impl/src/com/intellij/vcs/commit/message/SubjectLimitInspection.kt` | `[x]` | `src/commitMessageInspection.ts` 的主题行检查（`SUBJECT_LIMIT_MESSAGE`） |

**四档合计**：`[x]` 18 + `[~]` 43 + `[ ]` 0 + `[-]` 17 = 78。

> **2026-10-04 本轮改判**：`CommitChecksProgressIndicatorTooltip` `[~]` → `[x]` —— 点击进度行弹出的
> 放大浮层已落地（`src/commitChecks.ts` 的 `checksProgressPopup` + `src/components/SourceControl.vue` 的接线，
> 判据 `tests/commit-checks-tooltip.test.mjs`），该行的"缺"归零。四档因此从 13/48/0/17 变成 14/47/0/17。
>
> **2026-10-04 处置**：`CommitChecksProgressIndicatorTooltip` 从 `[ ]` 改判 `[~]`（第九十六批把它从 `[~]` 改成 `[ ]` 的理由是"没有那个悬停浮层"；本轮按四档口径重新核对：本仓已有进度行两处本体，缺的是浮层这一形态，属 `[~]` 不属 `[ ]`）。本域 `[ ]` 归零。
>
> **第九十六批的变化**：`CommitChecksProgressIndicator` / `CommitProgressPanel` 两条 `[~]` 的理由被重写（补上面板内进度行与「项目分析期间某些提交检查不可用」那条警告）。
>
> **2026-10-04 本轮改判（VCS lane）**：`CommitOptions` / `CommitOptionsPanel` / `CommitChecks` /
> `PostCommitChecksHandler` 四条 `[~]` → `[x]` —— 提交选项的存档层（`src/commitOptions.ts`）、
> 「慢检查推后到提交后」的开关（`NON_MODAL_COMMIT_POSTPONE_SLOW_CHECKS`，默认 true）与提交后
> 那一轮检查（`runPostCommitChecks()`）都落地了，`src/components/SourceControl.vue` 是消费点，
> 判据 `tests/commit-options.test.mjs`。四档因此从 14/47/0/17 变成 **18/43/0/17**。
> 同批还把 §C 的其它条目按"缺什么"重写（每条点名上游类/文件行）。
