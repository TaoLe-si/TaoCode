# 桶 13c · 提交（commit）与书签（bookmarks）收尾报告 · 2026-10-06

范围：**只做 `verdict-vcs-commit.md` 与 `verdict-bookmarks.md` 两族**（13b 的 vcsLog/changes/analysis/scope 与 9c 的 diff 一律未碰）。
接手时先跑了域内测试：**156 条全绿**（`node --test tests/commit*.test.mjs tests/bookmark*.test.mjs tests/git-*.test.mjs tests/source-control*.test.mjs`），
没有红要分诊 —— 前任代理留下的树是完好的，缺的是判词里那几条「还差」。

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下列行号都在这棵树上亲自打开核过）。
中文文案取自 `D:\IntelliJ IDEA 2026.2\plugins\localization-zh\lib\localization-zh.jar` 的
`messages/VcsBundle.properties` 与 `messages/DvcsBundle.properties`（只读字符串，逐条对 key）。

---

## 判词

| 族 | 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |
|---|----|------|--------------------------|----------------------|------|
| `vcs/commit` | `NonModalCommitWorkflowHandler` 的 `RecentCommitChecks` 那几档（MODIFICATIONS/POST_FAILED…） | **已落** | `platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt:667`（枚举七档）、`:229-243`（四个 `willSkip*`）、`:246-249`（`resetCommitChecksResult`）、`:337-342`（会话开头 reset + skip 参数）、`:533-557`（`handleCommitProblem` 落档） | `src/commitChecksResult.ts:43/58/111`（谓词与落档）、`src/sourceControlCommitChecks.ts:86`（`checksSkipped` 改读状态）、`:200`（结果落档）、`:258`（提交后那一轮的跳过）、`:299`（抛错 ⇒ FAILED） | 判词 §C 那条「缺 `RecentCommitChecks` 那几档」补完。七档里 `LATE` 与 `SMART_MODE_REQUIRED` **没有生产者**（见「做不到」一节），其余五档全接通。 |
| `vcs/commit` | reset 的触发条件（什么才算"这次结果作废"） | **已落（含一个真缺陷的修正）** | 同上 `:191-199`（`areFilesAffectsCommitChecksResult`：在 VCS 下 + 在内容里 + 状态不是 IGNORED）、`:202`/`:218`（已 UNKNOWN 就早退）、`:216-225`（文档变化那一半） | `src/commitChecksResult.ts:93`（`commitChecksFingerprint`）、`src/sourceControlCommitChecks.ts:107`（watch 指纹 + 早退） | 旧写法 `watch(() => staged.value.length, …)` **只数条数**：同样两个文件、工作区状态从 `M` 变成 `D`（或内容改了但状态字没变）就不 reset ⇒ 改完文件点提交仍然跳过检查、按钮还写着「仍然提交」。现在按 `暂存侧+路径+索引状态+工作区状态+未跟踪` 排序后拼指纹，被忽略的行不参与。 |
| `vcs/commit` | `CommitProgressPanel.clearError` 的边界（失败行什么时候清） | **已落** | `platform/vcs-impl/src/com/intellij/vcs/commit/CommitProgressPanel.kt:145-156`（消息 document / inclusion 监听只调 `clearError()`）、`:316-319`（`clearError` 只清错误行）、`:221-227`（`progressStarted` 才 `clearFailures()`）、`:402-414`（`addFailure`/`clearFailures` 的可见性） | `src/sourceControlCommitChecks.ts:100`（消息只清错误行）、`:147`（`beginChecksRound` 里清失败行 + reset 状态） | 旧写法把失败行跟着消息编辑一起抹掉 ⇒ 「仍然提交」的名字和那把「重新运行提交检查」的刷新按钮会凭空消失。现在失败行活到下一轮检查开始，与上游同形。 |
| `vcs/commit` | `AbstractCommitWorkflowHandler` 提交按钮四档（amend 两支） | **已落** | `platform/vcs-impl/src/com/intellij/vcs/commit/AbstractCommitWorkflowHandler.kt:226-237`（`isAmend × isSkipCommitChecks` 四支 → `action.amend.commit.anyway.text` / `amend.action.name` / `action.commit.anyway.text` / `commitText`） | `src/commitChecks.ts:110`（`commitActionText`）、`src/commitChecks.ts:96`（`AMEND_ANYWAY_TEXT`）、`src/sourceControlCommitChecks.ts:88` | 中文包原文：仍然修正 / 修正提交 / 仍然提交 / 提交。旧版只有后两支 ⇒ 勾上「修正(M)」之后按钮仍写「提交」。 |
| `vcs/commit` | 第二把按钮「提交并推送」四档 | **已落** | `platform/dvcs-impl/src/com/intellij/dvcs/commit/CommitAndPushExecutor.kt:9-19`（同一对 state 的四支）；key 原文 `platform/dvcs-impl/shared/resources/messages/DvcsBundle.properties:126-129` | `src/commitChecks.ts:145`（`commitAndPushText`）、`src/sourceControlCommitChecks.ts:93`、`src/components/SourceControl.vue:711` | 旧版是写死的一条「提交并推送(P)」；现在四档 + 包里的尾部 `…`。语义符按本仓惯例写 `(P)`（同 `checkbox.amend` → 「修正(M)」）。 |
| `vcs/commit` | `CommitChecksProgressIndicator` 的「当前进行到哪一步」上下文 + 两档正文 | **已落** | `platform/vcs-impl/src/com/intellij/vcs/commit/CommitChecksProgressIndicator.kt:122-134`（`setText` 按 `isOnlyRunCommitChecks` 折四条文案）、`platform/vcs-api/vcs-api-core/resources/messages/VcsBundle.properties:21-24`（`commit.checks.on.commit.progress.text[.with.context]` / `…only…[.with.context]`） | `src/commitChecks.ts:125`（步名）、`src/sourceControlCommitChecks.ts:229`（正文跟着这一轮）、`:176`（TODO 预检那一段把步名写进行里）、`:166`（`collectCommitChecks` 的 skip 参数） | 判词 §C4 那条「`step` 恒传 null」补完：TODO 预检在跑时行上写「正在运行提交检查: TODO 检查」，提交路径写「正在提交…」。**步名本身是本仓选择**（上游那一档填的是各条检查自己报的进度文字，本仓两条检查没有各自标题），已用面板里已有的说法「提交信息检查 / TODO 检查」，注释里写明不是 bundle 文案。 |
| `vcs/commit` | 提交后那一轮的正文（`post.commit.checks.progress.text`）+ 副文本 | **已落** | `VcsBundle.properties:28`（`post.commit.checks.progress.text=Checking files in commit`，中文包 = 正在检查提交中的文件）、`CommitChecksProgressIndicator.kt:39`（`text2` 置灰那一行）、`:71-86`（`fixDoubleEllipsis`） | `src/commitChecks.ts:126`（常量）、`src/sourceControlCommitChecks.ts:229-233`、`src/commitChecks.ts:265`（`checksProgress` 里真的走 `fixDoubleEllipsis`） | `fixDoubleEllipsis` 原先是"有判据、没有消费方"，现在接在正文/副文本相撞那一条上（判据覆盖两种省略号写法）。 |
| `vcs/commit` | `CommitProgressPanel` 缺的「还没开始」态 = 进度行**延迟可见** | **已落** | `CommitProgressPanel.kt:163-175`（`progressFlow.debounce(ProgressUIUtil.DEFAULT_PROGRESS_DELAY_MILLIS)` + `failuresPanel.isEmpty()` 才 `isVisible = true`）、`:257-260`（报出 failure 时把指示器收掉）、`platform/util/ui/src/com/intellij/ui/progress/ProgressUIUtil.kt:8`（`= 300L`） | `src/commitChecks.ts:156`（常量 300，不写死数字的地方）、`:168`（`checksProgressShown` 三条判据）、`src/sourceControlCommitChecks.ts:120-136`（定时器 + `onScopeDispose` 收掉） | 判词 §G `CommitProgressPanel` 行写的「缺：检查那一刻的'还没开始'态」，按上游源码就是这条 debounce：亚秒级跑完的检查不再让面板闪一行又收掉。 |
| `vcs/commit` | `CommitCheckFailure` 的相位归属 | **已落** | `NonModalCommitWorkflowHandler.kt:372-375`（按 `CommitCheck.getExecutionOrder()` 分 EARLY / MODIFICATION / LATE / POST_COMMIT）、`:445-480`（EARLY 与 MODIFICATION 分开跑）、接口 `platform/vcs-api/src/com/intellij/openapi/vcs/checkin/CommitCheck.kt:36` | `src/commitChecks.ts:218`（`phase` 字段）、`:245`/`:252`（TODO=modifications、提交信息=early） | 状态机要分档就必须知道每条失败出自哪一相；映射写在注释里（信息检查只看文本 ⇒ EARLY；TODO 预检读变更内容 ⇒ MODIFICATION）。 |
| `vcs/commit` | 「只跑检查」那条刷新按钮不跳相位 | **已落** | `NonModalCommitWorkflowHandler.kt:337-340`（`skip* = !isOnlyRunCommitChecks && willSkip*()`） | `src/sourceControlCommitChecks.ts:291`（`collectCommitChecks(true, { early: false, modifications: false })`） | 上一轮失败过，点「重新运行提交检查」必须真的重跑，否则按钮等于摆设。 |
| `vcs/commit` | 空判在「仍然提交 / 慢检查推后」时也要跑 | **已落** | `NonModalCommitWorkflowHandler.kt:177-184`（`checkCommit()` 是前置闸，不是检查） | `src/sourceControlCommitChecks.ts:305-312`（`runCommitChecksRound` 两条分支都带空判）、`src/components/SourceControl.vue:310` | 旧写法 `(checksSkipped \|\| 推后) ? null : …` 把整轮连空判一起跳过 ⇒ 没有暂存文件时点「仍然提交」听不见那句「选择要提交的文件」。 |
| `vcs/commit` | 「改某一次具体提交」那条下拉 | **不做**（按指示，有上游依据） | `platform/vcs-impl/src/com/intellij/vcs/commit/AmendCommitModeDropDownLink.kt:22-121` + `GitAmendSpecificCommitSquasher.kt:36-76`（内存内 autosquash rebase） | — | 只做下拉而 `--amend` 仍打 HEAD 就是假控件；不翻案。 |
| `vcs/commit` | `CommonCheckinFilesAction` / `AbstractCommitChangesAction` 的「提交文件…」那一支 | **做不到（本轮）** | `platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/CommonCheckinFilesAction.kt:26-78`（按选中路径提交、动作名 = `action.name.checkin.file` / `…directory`）、`CheckinActionUtil.kt:100-160`（`pathsToCommit` → `setCommitState` 只纳入这些变更） | 见接线请求 R1 | 具体卡点：本仓提交走 git index，`native/git.cpp:438 commit()` 没有路径参数，`git.commit` 的入参解析在 `native/main.cpp:1169`（不在我名下）。没有"只提交这几个路径"的通道 ⇒ 上了入口也是假控件。要落就得先给 `commit()` 加 `paths` → `git commit --only -m … -- <paths>`（+ ctest）。 |
| `vcs/commit` | `LATE` 相位 / `SMART_MODE_REQUIRED` 两档 | **没有生产者，不造空壳** | `NonModalCommitWorkflowHandler.kt:483-499`（LATE 走 `problem.showModalSolution` 弹窗征求同意）、`:468-482`（dumb 模式挡智能检查） | `src/commitChecksResult.ts`（注释里点名这两档为何不接） | 本仓两条检查都不依赖索引（TODO 预检走 `search.run` 正则、信息检查是纯文本），也没有需要弹窗征求同意的检查；类型里留着，状态机走不到，界面上也就不渲染。 |
| `vcs/commit` | 提交流程三层（workflow / handler / ui）、`CommitExecutor` 插槽 | **维持 `[-]`/`[~]`** | 判词 §C1、§C4 第④条（价值最低且要有真消费者） | — | 本轮没有新增空接口对象。 |
| `ide/bookmarks` | `BookmarkBundle.messagePointer`（惰性 Supplier） | **维持 `[~]`，不做** | `platform/bookmarks/src/com/intellij/ide/bookmarks/BookmarkBundle.java:21-28` | — | 本仓没有"先拿指针、稍后再取"的消费者；造一个没人持有的包装是空壳。 |
| `ide/bookmarks` | `BookmarksListener`（事件面） | **维持 `[~]`，不做** | `platform/bookmarks/src/com/intellij/ide/bookmarks/BookmarksListener.java:10-16` | — | Vue 响应式已经承接了"表一变四处跟着重算"；本仓没有第二个订阅者（无插件运行时）。 |
| `ide/bookmarks` | 本轮复核：`Bookmark` / `BookmarkItem` / `BookmarkManager` / 列表代数 / 助记键 / 文件书签 / 速度搜索 / 粗体 / 排序 | **已在树上，未见新增可做项** | 判词 §C①②③ 与 §G 各行引的坐标（`BookmarksManagerImpl.kt:129-136`、`LineNode.kt:20-31`、`ToggleBookmarkAction.kt:88-93`、`UISettingsState.kt:249` …） | `src/bookmarks.ts`（306 行）、`src/bookmarkLists.ts`、`src/bookmarkListActions.ts`、`src/bookmarkSettings.ts`、`src/bookmarksView.ts`、`src/components/BookmarksPanel.vue` | 本轮把书签侧 26 条判据全部跑绿（`tests/bookmark*.test.mjs`）。剩余未接的是**编辑器标签右键**那一半（`actions/extensions.kt:58-72` 的 `EDITOR_TAB_POPUP`），落点在别人的组件里 ⇒ 本轮未动，记在下面「做不到」。 |

---

## 改动文件

**新增**

- `src/commitChecksResult.ts`（122 行）—— `RecentCommitChecks` 七档 + 四个 `willSkip*` + `checksResultAfter` 落档 + `commitChecksFingerprint`（含"被忽略的行不参与"与未保存清单代理）。纯逻辑，无 DOM、无 vue。
- `tests/commit-checks-result.test.mjs`（188 行，17 条判据）—— 谓词/落档/指纹/四档按钮/进度行三判据 + 接线正则 + 「旧写法不许残留」的反向门禁。
- `.tools/mutate13c.mjs` —— 本轮反向验证用的突变脚本（第三、四轮沿用；只改内存里备份过的三个文件，`finally` 无条件还原）。

**修改**

- `src/commitChecks.ts`（289 → 391 行）—— `CommitCheckFailure.phase`；`commitActionText` / `amendActionText` / `AMEND_ANYWAY_TEXT`；`commitAndPushText`；`COMMITTING_TEXT` / `COMMITTING_WITH_CONTEXT`（原来 `'正在提交…'` 是裸字面量，现在带 key 出处）；`CHECKS_STEP_MESSAGE` / `CHECKS_STEP_TODO` / `POST_CHECKS_PROGRESS_TEXT`；`PROGRESS_PRESENTATION_DELAY_MS` / `checksProgressShown`；`checksProgress(..., detail)` 里接上 `fixDoubleEllipsis`。
- `src/sourceControlCommitChecks.ts`（201 → 327 行）—— 状态机接线（`checksResult` / `checksRound` / `beginChecksRound` / `skipFromState` / `runCommitChecksRound` / `commitAndPushLabel`）、reset 判据换成指纹、失败行清空时机改回上游、进度行延迟可见（定时器 + `onScopeDispose`）、提交后那一轮加 `willSkipPostCommitChecks` 闸、抛错落 `FAILED`。
- `src/components/SourceControl.vue`（788 → 790 行）—— `createCommitChecks` 多收一个 `changes`；`runCommit` 走 `runCommitChecksRound()`；两把按钮的文案与 `commitAndPushLabel` 绑定；去掉不再需要的 `runsChecksBeforeCommit` 导入。
- `tests/commit-checks.test.mjs` —— 三条接线断言按新形状改写（`collectCommitChecks(` 计数 4→5 并写清四条调用路；`checksSkipped` 的来源；通知上的动作名走四档），断言体仍是精确匹配，没有放松成 `includes`。
- `tests/commit-checks-progress.test.mjs` —— 进度行的接线正则改成 `checksProgressShown(checksBusy, 失败行非空, 到点)`。

未动 `src/vcsLog*` / `src/changes*` / `src/analysis*` / `src/scopes.ts` / `src/diff*` / 任何保留文件。

---

## 验证

| 项 | 命令 | 结果 |
|---|---|---|
| 接手实况 | `node --test tests/commit*.test.mjs tests/bookmark*.test.mjs tests/git-*.test.mjs tests/source-control*.test.mjs` | **156 / 156 绿**（无红可分诊） |
| 本轮域内（改完后） | `node --test tests/commit*.test.mjs` | **112 / 112 绿** |
| 本轮域内 + 邻居 + 两条全仓门禁 | `node --test tests/commit*.test.mjs tests/bookmark*.test.mjs tests/git-*.test.mjs tests/source-control*.test.mjs tests/scm*.test.mjs tests/amend*.test.mjs tests/merge*.test.mjs tests/changes*.test.mjs tests/module-size.test.mjs tests/b3-verdict.test.mjs` | **264 / 264 绿**（含 `module-size` 与 `b3-verdict` 两条判决/上限门禁） |
| 类型检查（本轮改动范围） | `npx vue-tsc --noEmit -p <临时项目，含 SourceControl.vue + 三个 ts>` | **0 错误**（临时 tsconfig 已删） |
| 全仓类型检查 | `npx vue-tsc -b --force` | **不是我引入的 4 条**：`src/components/StructuralSearchFilters.vue:238`（3 条 TS1005/TS1136）、`src/customFoldingProviders.ts:48`（TS1002 未闭合字符串）。这两处在别人名下（桶 2 / 编辑器族），语法错误会让整棵树的语义检查提前中断 ⇒ 全量基线由主代理复跑时先修它们。 |
| 三条系统性禁令 | `node .tools/find-param-props.mjs` / `find-ts-in-mjs.mjs` / `find-missing-ext.mjs` | 0 参数属性 · `.mjs` 全纯 JS · 1162 文件无漏扩展名 |
| 孤儿门禁 | `node .tools/find-orphan-modules.mjs --gate` | `src/commitChecksResult.ts` **不在新增孤儿名单**（被 `commitChecks.ts` + `sourceControlCommitChecks.ts` + 新测试消费）。门禁仍红，4 条全在别人名下：`src/historySessions.ts`、`src/historyTimeline.ts`、`src/rootsAttachScan.ts`、`src/rootsModel.ts`（桶 14/15）。 |
| native | 无改动 ⇒ 无 ctest（`native/*.cpp` 一行未动） |

### 反向验证记录（每条突变都确认"真的会红"，随后自动还原）

第一轮（纯规则，`node .tools/mutate13c.mjs`，`exit=1`，5 处突变 → 5 条判据红）：

1. `checksResultAfter`：无失败时提交路径也返回 `passed` ⇒ ✖「落档：只跑检查且过了 = PASSED，提交路径且过了 = UNKNOWN」
2. `commitChecksFingerprint`：去掉 `workStatus` ⇒ ✖「指纹数的是"哪些文件、什么状态"，不是条数」
3. `willSkipModificationCommitChecks`：把 `earlyFailed` 也加进跳过 ⇒ ✖「早相位失败 ⇒ 连提交信息检查都不重跑，但 TODO 那条还没跑过」
4. `checksProgress`：不走 `fixDoubleEllipsis` ⇒ ✖「提交后那一轮的副文本走 detail，并且双省略号规则真的接上了」
5. `commitActionText`：去掉 amend 两支 ⇒ ✖「按钮名四档取中文包原文」

第二轮（接线，5 处突变 → 3 条判据红）：`checksSkipped` 退回看失败行长度 / 消息 watch 顺带清失败行 / 去掉提交后那一轮的跳过闸 / 「只跑检查」改回按状态跳相位 / 面板不再传 `changes`。

第三轮（延迟可见与新按钮，5 处突变 → 3 条判据红）：`checksProgressShown` 退回 `running` / `commitAndPushText` 写死 / 去掉 `onScopeDispose` / `setTimeout` 里把常量换成字面量 `300` / 面板按钮退回写死文案。
（后三处都是"文本存在性"判据，锚点唯一，各自只会触发自己那一条断言。）

三轮跑完都做了还原核对：`diff` 备份与工作区文件一致，之后 `node --test tests/commit*.test.mjs` 重新 **112 绿**。

---

## 做不到 / 卡点（具体）

1. **「提交文件…」（`CommonCheckinFilesAction.kt:26-78`）——缺后端通道**。
   本仓提交 = git index（`native/git.cpp:438 commit()` 只吃 `message / amend / signoff / author`），
   没有"只提交这几个路径"的参数；而 `git.commit` 的入参解析在 `native/main.cpp:1169`，`main.cpp` 不在我名下。
   ⇒ 已写成接线请求 R1（含建议的 git 旗标 `git commit --only -m … -- <paths>`，需要 native + ctest）。
   没有这条通道就上入口 = 假控件，所以本轮不落。
2. **编辑器内逐次键入 ⇒ 提交检查结果作废（`NonModalCommitWorkflowHandler.kt:216-225`）**。
   面板只拿得到宿主的 `dirtyPaths: () => string[]`（非响应式）：第一次编辑会进清单（已能触发 reset，
   见 `commitChecksFingerprint` 的 `unsaved` 参数），**同一文件之后继续编辑不再变** ⇒ 只覆盖一半。
   补齐需要宿主把"文档修订号"透进来（`App.vue` / `CodeEditor.vue` / `toolViewContext.ts` 三处之一）⇒ 接线请求 R2。
3. **LATE 相位与 `SMART_MODE_REQUIRED` 档**：本仓没有对应的检查生产者（不依赖索引、不需要弹窗征求同意），
   造出来就是空相位；已在 `src/commitChecksResult.ts` 的头注释里点名上游坐标并说明不接的理由。
4. **书签「编辑器标签右键的添加/删除书签」（`platform/bookmarks/src/com/intellij/ide/bookmark/actions/extensions.kt:57-61` 的 `EDITOR_TAB_POPUP` 那一支）**：
   落点在别人的编辑器标签右键菜单（不在我名下文件列表里），项目树那一半已在第七十四批落地。本轮未动，留给主代理统一挂。
5. **`BookmarkBundle.messagePointer` / `BookmarksListener`**：维持判词的 `[~]`，理由见判词表（无消费者 ⇒ 不造空壳）。
