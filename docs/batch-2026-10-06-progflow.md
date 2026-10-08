# 归属报告 · 2026-10-06 · 死 lane `progflow`（后台任务队列 / 进度面板 / 挂起 / 取消）

写这条报告的是**只读报告 lane**（`progflowdoc`）。本 lane 全程未改任何 `src/`、`native/`、`tests/`、`docs/inventory/*`；
未 `commit` / `push`；未跑 `TAOCODE_CITATION_ANCHORS=update`；未跑 `vue-tsc`（并发 lane 在飞，它会写 `tsconfig.tsbuildinfo`）。
**磁盘与任务书不一致的地方一律按磁盘写，并把差异留在原句旁边。**

- 上游参考树 = `D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下文所有"参考树"）。
  仓内 `third_party/intellij-community` 本轮 `ls` **无任何条目** ⇒ 按坏树处理，本报告一条都没引用它。
- 本报告里所有 `文件:行号`（含上游的）都是**我自己 find + 开文件数过**的；
  progflow 原始任务书里给的坐标只有两处被引用到（`BackgroundTaskQueue.java` / `ProgressIndicatorModel.kt`），见 §7 勘误。

---

## 0、一句话结论

**码落了，而且落的比看板记的多**：四文件 + 一条必须一起算上的在飞文件（`src/progressSuspender.ts`）+ 2 份新判据 + 4 份改判据；
域门禁 **102/102/0**（复现）、`module-size` 绿、orphan 新增 0。
progflow 名下**没有**半截的进度域改动；但它名下那四个文件里的 `src/gradleHost.ts` 被**另一条无署名 lane** 塞进了
一个**未定义常量**（`UNLINKED_PROJECT_DISPLAY_ID`），那条既是 `vue-tsc` 的 TS2304、也是运行期 `ReferenceError`，
并且撞红了一条已提交的判据（`tests/notice-actions.test.mjs:107`）。欠的三件都在**别人那三块**上，见 §6 与请求文档。

---

## 1、主代理给的原始数字，逐条按磁盘复核

| 主代理口径 | 磁盘实测（命令 + 输出） | 判定 |
|---|---|---|
| `src/backgroundTasks.ts` **+153/−?** | `git diff --numstat` = **95 增 / 58 删**；`git diff --stat` 的 153 是**改动行合计**（95+58），不是净增 | 数字对，**口径要写清**（下面三条同理） |
| `src/gradleHost.ts` **+96**（现在 **896** 行，上限 900 ⇒ 曾经 906 超标已消） | numstat **73/23** = 96 ✓；`wc -l` = **896** ✓；门禁尺 `split('\n').length` = **897**（`tests/module-size.test.mjs:157` 用的是这一把，`DEFAULT_LIMIT = 900`（`:22`），gradleHost 未登记 ⇒ 走默认上限）⇒ **余量 3 行**；HEAD 版 = `git show HEAD:src/gradleHost.ts | wc -l` = **846** ⇒ 846+73−23 = 896 ✓ | 行数与"超标已消"的**现值**成立；**"曾经 906"= 无法核实**（磁盘无该中间态：无提交、无 scratch 记录，`grep -n 906 docs/batch-2026-10-06-main.md .tmp-plugins2-size.txt` 0 命中） |
| `src/progressPanel.ts` **+11** | numstat **8/3** | ✓ |
| `src/workspaceInspection.ts` **+30** | numstat **29/1** | ✓ |
| `background*/progress*/status*` = **102/102/0** | 复跑（14 个判据文件）：`ℹ tests 102 / pass 102 / fail 0` | ✓ 完全复现 |
| 注入 token `PROGFLOW`/`PROG-` 在 `src tests native` **0 命中** | `grep -rn "PROGFLOW\|PROG-" src tests native` **无输出** | ✓（文件里只有小写署名 `progflow`：`grep -rc` ⇒ `src` **5** 处（`src/backgroundTasks.ts:4,33,216,294,375`）、`tests` **10** 处、`native` **0** 处，全是批次留痕，不是 token） |
| 落地面 = **这四个文件** | **不符，按磁盘写**：这批还含 `src/progressSuspender.ts`（numstat **67/66**，mtime 2026-10-06 13:39:38）。`backgroundTasks.ts:224` 的 `suspender.suspend()`（无参）与 `:246-258` 的 `createProgressSuspender(taskId, {…})`（两参）**只有在新签名下才成立** —— HEAD 版是 `suspend(reason?)` / `createProgressSuspender(taskId, suspendedText, task)`（`git diff` 可见删除行）。只改四文件、不改挂起器 ⇒ 编译不过。**归属**：`progressSuspender.ts` 的删除理由在它自己文件头写的是"status2 删除"，但那段理由的措辞与 `queueRow` 口径是本轮新写的 ⇒ 判为**与 progflow 同批**（磁盘无第二条 lane 文档认领：`grep -rln "suspendedText" docs/*status*.md` 只有 status2/status2defect 那两份，它们要的是"二选一"，本轮走的是"不接"那一支，见 `docs/wiring-requests-2026-10-06-status2defect.md:45,99`） |
| `src/App.vue` 余量 **31** 行、`src/bridge.ts` 余量 **1** 行 | 门禁尺：App.vue 2707 / 上限 2737 = **30**；bridge.ts 905 / 上限 905 = **0**（`wc -l` 的 2706 / 904 各多算一行）。看板 §21 已自己更正过一次（`docs/batch-2026-10-06-lane-board.md:326-327`），本轮复核**与更正一致** | 任务书那两个数是旧的 ⇒ 请求文档按 **30 / 0** 出方案 |

同窗口内**不属于** progflow 的在飞文件（mtime 证据，只登记不动）：
`src/progressNotices.ts` 13:45、`src/lspProgress.ts` 13:27、`src/notificationGroups.ts` 13:45、
`src/App.vue` 13:18（progflow 窗口是 14:39–14:59 ⇒ **App.vue 它一页都没动**，这条对本报告很关键：它所有的接线都不需要 App.vue 的行）。

---

## 2、改动块 → 上游坐标 → 可见性 → 真实消费者 → 判定

约定：**可见性** = 用户在不打开 devtools 的前提下能不能观察到；**消费者**给 `文件:行号`；
"参考树核过" = 我亲手 `awk`/`Read` 出该行并逐字对上（不是照抄 progflow 的注释）。

### 2.1 `src/backgroundTasks.ts`（HEAD 382 行 → 现 423 行 `wc`，95 增 / 58 删）

| # | 位置 | 这块做了什么 | 上游真身（参考树，全部核过） | 可见 | 真实消费者 | 判定 |
|---|---|---|---|---|---|---|
| B1 | `:1-52` 模块头重写 | 把原来"看起来像"的坐标全换成逐行数过的真坐标，并写清"队列只开一行"的设计与七条死出口为什么删 | `platform/platform-impl/src/com/intellij/openapi/progress/BackgroundTaskQueue.java:26`（"Runs backgroundable tasks one by one."）、`:35`（`myTitle` 字段）、`:43-46`（`QueueProcessor(…, true, ThreadToUse.AWT, …)`）、`:49-51`（`clear`）、`:53-55`（`isEmpty`）、`:61-63`（`run(Task.Backgroundable)`）、`:105-107`（`if (StringUtil.isEmptyOrSpaces(myTask.getTitle())) myTask.setTitle(myTitle)`）；`…/openapi/progress/ProgressIndicatorModel.kt:13-18`（title/cancellation/visibleInStatusBar）、`:23`（`nonCancellable()`）、`:25-37`（带 `onCancel` 的构造器，`:33` 先调回调 `:34` `super.cancel()`）、`:39-41`/`:47-49`/`:59-61`（setFraction/setText/getFraction）、`:83-90`（`onProgressChange`）、`:92`（`isCancellable() = cancellation is TaskCancellation.Cancellable`）；`…/wm/impl/status/InfoAndProgressPanel.kt:753`（`cancelButton.setPainting(task.isCancellable())`）、`:876`（`val painting = info.isCancellable() && !isStopping`）、`:964`（`override fun cancelRequest() { original!!.cancel() }`） | 否（注释） | — | **成立**。两点补充：① `BackgroundTaskQueue.java:30-32` 挂着 `@Deprecated`（"use Kotlin coroutines with appropriate concurrency limiting"），头注没提这件事（不影响移植正确性，登记备查）；② 头注 `:214-215` 引的历史坐标 `runningSuspendedText`「`:154` 声明、`:181` 写、`:246` 导出」我用历史 blob 复验 = `git show dfbda4e:src/backgroundTasks.ts` 第 154/181/246 行**逐字命中** ⇒ 这条不是编的 |
| B2 | 删七条死出口（现 `:288-298` 留痕注释；声明/导出块删掉） | `runningTitle`/`runningDetail`/`runningFraction`/`runningCancellable`/`queuedCount`/`cancellingTitle`/`cancelCurrent` 全删，状态只剩 `queueRow` 一个出口 | 无上游对应（这七条是本仓自造的扁平出口，上游给面板的是**行对象**：`InfoAndProgressPanel.kt:966-968` `queueProgressUpdate()` 里 `dirtyIndicators.add(this)`） | 否 | 反证成立：`git grep -n "runningTitle\|queuedCount\|cancelCurrent()" HEAD -- src` 命中**只有** `src/backgroundTasks.ts` 自身（`:163,167,191,192,270,322`）⇒ 当时生产侧零消费者 | **完成**。判据 = `tests/progress-queue-suspend.test.mjs:37-56` 的 `deepEqual` 精确键清单（现清单 7 条：`cancelCurrentAndAwait/clear/isEmpty/isSuspended/queueRow/run/setSuspended`）+ `tests/background-tasks.test.mjs:34,97,120` 改读 `queueRow` |
| B3 | `:197-203` 新增 `revision` ref；`:208-218` `sync()` 改成只 `revision.value += 1` | 给 `queueRow` 一个**唯一**的响应式变化信号（`current`/`queue`/`Indicator` 都是普通对象） | `ProgressIndicatorModel.kt:83-90`（`onProgressChange` 委托）+ `InfoAndProgressPanel.kt:966-968`（标脏）| **是（间接）**：没有它，"正在取消 / 已挂起 / 排队深度 / 可取消档"这几拍在面板里根本不会重算 | `:379` `void revision.value`（`queueRow` 内），`queueRow` 的消费者 = `src/progressPanel.ts:80-81` | **完成** |
| B4 | `:369-415` `queueRow` 三档都带 `cancellable`（`:381` 计算、`:390` 取消中间态写死 `false`、`:403`/`:412` 带档） | 队列那一行终于能带出"正在跑那条任务自己的可取消档" | `ProgressIndicatorModel.kt:92` + `:23`（两档）；按钮的画法 `InfoAndProgressPanel.kt:753`/`:876`；点下去 `:964` | **是** —— 状态栏「后台任务」弹层里那颗「取消」按钮（`src/App.vue:2329` 模板 `v-if="row.cancellable"`，`src/processPopup.ts:54-57` 把 `cancellable` 原样带进 `kind:'task'` 行） | `src/progressPanel.ts:81`（唯一生产消费者）→ `:154-158` → `src/backgroundTasks.ts:351-368` | **完成**。判据 = 新 `tests/progress-queue-cancel-row.test.mjs`（5 条，含 `:185-197` 的反证：面板不许再写死 `false`、`queueRow` 少一档就红） |
| B5 | `:246-258` 建挂起器不再传兜底文案；`:220-226` `applySuspend` 调 `suspender.suspend()`（无参） | 把"没人读的文案出口"从两侧一起摘掉 | `ProgressSuspender.java:79-81`（`markSuspendable(indicator, suspendedText)`）、`:106-110`（`getSuspendedText()` 的临时优先）、`:121`（reason 的 javadoc "if provided, is displayed in the UI … until the progress is resumed"）、`:123-137`（`suspendProcess`，`:125` 空操作闸）；文案的三个读者 `InfoAndProgressPanel.kt:815`、`TaskInfoEntityCollector.kt:174`、`TaskToProgressSuspenderSynchronizer.kt:57`；`TaskSuspension.kt:24-25`（"…which is displayed in the progress bar"） | 否 | 队列内部（`Indicator.suspender`、`suspenders.getSuspender`） | **完成，但它依赖在飞文件** `src/progressSuspender.ts`（§1 最后一行）。口径：本仓没有"不给 reason 的挂起入口"（上游那一支是 `TaskInfoEntityCollector.kt:188` 的 `is TaskStatus.Paused -> suspender.suspendProcess(status.reason)`，已核），所以兜底档**按实情不接**，不是"忘了接" |

### 2.2 `src/gradleHost.ts`（846 → 896 行 `wc`，73 增 / 23 删）—— **这个文件里有三块不是 progflow 的**

先切干净：**progflow 域 = G1–G4**；**无署名域 = G5–G7**（磁盘上没有任何 lane 文档认领它们，见 §3）。

| # | 位置 | 这块做了什么 | 上游真身（核过） | 可见 | 真实消费者（`文件:行号`） | 判定 |
|---|---|---|---|---|---|---|
| G1 | `:131-134` `Job.progress?: ProgressIndicatorModel` | 队列的指示器只有走队列的那条路带得动 | `ProgressIndicatorModel.kt` 同上 | 否 | 写入 `:603`（`queue.push({ …, progress })`），读取 `:455` | **完成** |
| G2 | `:207-222` 通知「同步更改」的任务体：`run: async indicator => { await indicator.awaitResumed(); indicator.checkCanceled(); await sync(undefined, indicator) }` | **status2 请求 W3 的落点**（`docs/wiring-requests-2026-10-06-status2.md:54-72`；它钉的 old 文本 `run: async () => { await sync() },` 在磁盘上已不存在 ⇒ 该请求本轮闭环，见 `:132` 的"仍缺"已过期） | `ProgressSuspender.java:154-181`（`freezeIfNeeded` 里 `myLock.wait(10000)`，`:162-164` 不可挂起段直接 false）；取消那一路 = 指示器 `cancel()`（`ProgressIndicatorModel.kt:79-81`） | **是**：省电模式（`src/notifications.ts:298` → `backgroundTaskQueue.setSuspended(…)`，原因常量 `src/notificationPowerSave.ts:134`）开着时，点「同步更改」不再为下一个链接目录起 Gradle 进程 | 触发链：通知按钮「同步更改」= `src/autoImportNotifications.ts:27`（label）、`:98`（`{ label: AUTO_IMPORT_SYNC_LABEL, run: onSync }`）、`:126`（`deps.reload()`）→ `src/gradleHost.ts:207` → `src/backgroundTasks.ts:316`（`run`） | **完成**。判据 = `tests/gradle-host.test.mjs:227-243`（挂起→不起第二个目录，恢复→起）与 `:245-262`（挂起中按取消→任务体从检查点回来、后面不再起）；我复跑 `tests/gradle-host + workspace-diagnostics + analysis-scope + inspection-cancel` = **41/41/0** |
| G3 | `:452-458` `execute(job)` 开头的协作检查点（`await job.progress.awaitResumed()` + `if (job.progress.cancelled) return`） | 让路/取消的**执行侧**落点；不带 `progress` 的老路径行为一字不变（`:455` 的 `if (job.progress)`） | 同 G2 | **是**（同上） | `src/gradleHost.ts:606-611`（`enqueue` 造 job 时塞 `progress`）、`:614-621`（`sync` 透传） | **完成** |
| G4 | `:590-608` `enqueue(kind, directory?, progress?)`、`:611-621` `sync(directory?, progress?)` 的透传 + 注释 | 把"谁带指示器"钉在唯一那条走队列的路上 | — | 否 | `:620`（`enqueue('sync', directory, progress)`）；面板直接点的同步走 `sync()` ⇒ `progress` 为 undefined | **完成** |
| G5 | `:414-421` `linkProject` 改判**目录**（`gradleLinkDirectory` / `canLinkGradleDirectory`，两个新函数在在飞的 `src/gradle.ts`） | 未链接工程通知递进来的是目录时不再静默不链 | 注释引 `ImportProjectFromScriptAction.kt:17-23`/`:28`/`:34-36`（**我未复核**：它不在 progflow 域，且 `find` 该文件在 `plugins/gradle/…`，属于另一条 lane 的账） | 是（用户看得见的"链接 Gradle 项目"） | `:881`（通知动作「加载 Gradle 工程」→ `linkProject('')`） | **归属未定，不算 progflow 的账**；`src/gradle.ts` 在飞 41/30 |
| G6 | `:433-443` `notifyFailure(…, issueActions?)` + `:549-556` `gradleJavaHomeIssue(output)` 换最后一条动作（「打开 Gradle 设置」） | JDK 解析失败时把用户送到 Gradle JVM 下拉所在页 | 注释引 `LocalGradleExecutionAware.kt:193-198`、`GradleBundle.properties:85`（**我未复核**，同上） | 是（失败通知的按钮文案） | 依赖新模块 `src/gradleJvmDiagnostics.ts`（124 行，**未跟踪**）与 `src/gradle.ts` 的 `GRADLE_JVM_OPEN_SETTINGS_ACTION`/`GRADLE_CONFIGURABLE_ID` | **归属未定**；它把一条**已提交的判据**撞红了 ⇒ §6 U5 |
| G7 | `:870-884` 没自动链接时不再 `return`，改挂一条 UPN 通知（`unlinkedProjectNotice` + `isUnlinkedNoticeSkipped`/`skipUnlinkedNotice`，注释自称"roots4 补的那一寸"） | 让用户还有一条"点「加载 Gradle 工程」"的路 | 注释引 `UnlinkedProjectStartupActivity.kt:141-197`/`:172-181`、`UnlinkedProjectNotificationAware.kt:33-50`/`:42-50` —— **我逐条开文件核过**：`:141` `installUnlinkedProjectScanner`、`:172-181` `updateNotification` 三叉、`:33` `@State(name = "UnlinkedProjectNotification"…)`、`:38` `disabledNotifications`、`:42-50`（`:43-46` 跳过过 ⇒ return，`:47-50` 已弹过 ⇒ return）**全部对得上** | 是（一条通知 + 两个按钮） | **`src/gradleHost.ts:880` 的 `UNLINKED_PROJECT_DISPLAY_ID` 全仓未定义**（`grep -rn "UNLINKED_PROJECT_DISPLAY_ID" src` 只有这一行命中）⇒ `vue-tsc` TS2304 + 运行期走到这支必抛 `ReferenceError` | **归属未定 = 半截**，但它坐在 progflow 的四文件里 ⇒ 必须进请求文档（R1） |

### 2.3 `src/progressPanel.ts`（166 行，8 增 / 3 删）

| # | 位置 | 这块做了什么 | 上游真身（核过） | 可见 | 消费者 | 判定 |
|---|---|---|---|---|---|---|
| P1 | `:73-81`：注释 + `cancellable: queueRow.cancellable ? 'background' : false`（HEAD 版 `:76` 是写死的 `false`） | 让 `'background'` 那条取消分支第一次有发出点 | `InfoAndProgressPanel.kt:753`/`:876`（按钮按 `isCancellable()` 画、正在停止那段不画）、`:964`（`cancelRequest()` 打这条任务自己的 `cancel()`） | **是** | `:154-158`（`cancelBackgroundTask('background')` → `cancelCurrentAndAwait()` + 等不到就 `ctx.notify('后台任务没有响应取消，仍在运行。', true)`）；`:162-163` `cancelProgressRow`；模板 `src/App.vue:2329`；行模型 `src/processPopup.ts:54-57` | **完成** |

### 2.4 `src/workspaceInspection.ts`（160 行，29 增 / 1 删）

| # | 位置 | 这块做了什么 | 上游真身（核过） | 可见 | 消费者 | 判定 |
|---|---|---|---|---|---|---|
| W1 | `:79-93` 注释 + `let cancelled = false` + `begin(…, { detail, onCancel })` | 「正在检查代码」那一行从不可取消档搬到可取消档 | `platform/core-api/src/com/intellij/openapi/progress/Task.java:202-204`（两参构造器 → `this(project, title, true)`）、`:206-208`（三参）；按钮 `InfoAndProgressPanel.kt:753`；回调优先 `ProgressIndicatorModel.kt:32-34`（`:33` 先 `onCancel.invoke()`、`:34` `super.cancel()`） | **是** | `src/progressTasks.ts:87`（`cancellable: options.cancellable ?? options.onCancel !== undefined`）→ `:120-130`（`cancel(id)` 先调回调再 `end`）→ `src/progressPanel.ts:104`（发 `{ task: task.id }`）→ `:143`（`backgroundTaskManager.cancel(target.task)`）→ 模板 `App.vue:2329` | **完成**（这是 §4 必答项 2 的答案本体） |
| W2 | `:96-100` 请求在途时取消 ⇒ 结果到手也不写表 | "不再写入"的可观察停止 | 上游没有"在途请求"这一档；`GlobalInspectionContextImpl.java:466`（收集之前）、`:488`（`buildProcessor` 每文件第一句）都是 `ProgressManager.checkCanceled()` | 是 | 触发者 = 面板那颗按钮（同 W1） | **完成，欠一半**：真正把在途 `workspace/diagnostic` 掐掉要动 `src/bridge.ts`（余量 **0**）⇒ 已由 `docs/wiring-requests-2026-10-06-msgaudit.md:63-69`（R4）与 `docs/batch-2026-10-06-msgaudit.md:77`（C4）归档为**建议不做**；本报告维持该归档，见请求文档 R5 |
| W3 | `:111`/`:120`/`:128`/`:138` 四道 `if (cancelled) return cancelledOutcome()` | 取消后每一步都停 | `GlobalInspectionContextImpl.java:694` 与 `:722`（遍历范围里两句 checkCanceled）、`:726-727`（`catch (ProcessCanceledException e) { // ignore, but put tombstone }`）、`:729-733`（`finally` 照走） | 是 | 同上 | **完成** |
| W4 | `:115-119`/`:123-127`/`:131-137` 三个合并循环里的 `if (cancelled) break` | 每处理一个文件之前一次的等价物 | `:488`（同注释自述） | 是 | 同上 | **完成** |
| W5 | `:141-144` `resultIds` 整体替换**挪到取消判据之后**（+2 行说明） | 取消的那一轮不许把上一轮的 id 换掉 | 上游没有 resultId 表这一档（本仓 `workspace/diagnostic` 的 `previousResultIds` 协议） | 是（下一轮不重算 vs 全量重算） | `deps.resultIds` = `App.vue:1584`（`workspaceDiagnosticIds`） | **完成**；判据 = `tests/inspection-cancel.test.mjs:50-73`（`deepEqual([...resultIds], [['old.ts','old-id']])`） |
| W6 | `:157-159` `finally` 仍 `end` | 对应上游 finally 照走 | `GlobalInspectionContextImpl.java:729-733` | 是（行不会永远转） | `src/progressTasks.ts:109-112` | **完成** |

**顺带把这条也钉死**（任务书问的"取消分支有没有真实触发方"的另一半）：
`tests/inspection-cancel.test.mjs:22` 的头注引用 `src/backgroundTasks.ts:37` 是「后台任务已取消。」、
`src/gradleHost.ts:485` 是「已取消。」 —— 磁盘实测**两处都偏**：
`backgroundTasks.ts:37` 现在是省电模式那句注释，那句中文在 **`:54`**（`super('后台任务已取消。')`）；
`gradleHost.ts:485` 现在是设置 CRC 的注释，`'已取消。'` 在 **`:515`**。不影响行为，登记为文字勘误（§7）。

---

## 3、`gradleHost.ts` 里那三块非进度域改动的归属调查（为什么判"磁盘无署名"）

- `grep -rln "gradleJvmDiagnostics\|skipUnlinkedNotice\|unlinkedProjectNotice\|GRADLE_JVM_OPEN_SETTINGS_ACTION" docs HANDOFF.md` ⇒ **0 命中**（没有任何批次报告认领）。
- `docs/batch-2026-10-06-roots4.md:121` 明确写着：本轮**未读写** `src/gradleHost.ts`、`src/backgroundTasks.ts`、`src/progressPanel.ts`（mtime 15:01，比 progflow 的 14:59 晚，是最接近的独立证据）⇒ `roots4close` 排除。
- 但那块注释自己说"roots4 补的那一寸"（`src/gradleHost.ts:866-869`），而早先的 `roots4` 是一条**已撞线**的 lane ⇒ 唯一自洽的解释：**roots4 生前落的码、死后没人记账**，或另一条在飞 lane 写的。磁盘分不清，我不替它编。
- mtime 只能定性不能定人：`src/gradleHost.ts` 14:59:55 是它最后一次被写，晚于 progflow 自己的判据（14:56:11）；
  `src/gradleJvmDiagnostics.ts` 14:43、`src/gradle.ts` 14:44、`src/externalSystemAutoLink.ts`/`externalSystemAutoImport.ts` 14:45 —— 与 progflow 的 `workspaceInspection.ts` 14:43 撞在同一分钟里。
- 看板 §21（`docs/batch-2026-10-06-lane-board.md:332`）把 `gradleHost.ts:880` 那条 TS2304 记在 **progflow 名下**。
  我复核后的立场：**缺陷本身与它的修法确实在 progflow 名下那个文件里**，所以"由 progflowdoc 报出来"是对的；
  但把它算成"progflow 写的功能"证据不足（progflow 的任务面是队列/取消/挂起，与"未链接工程通知"无关）。
  ⇒ 本报告按"**progflow 名下文件里的无署名半截，必须补**"登记（R1），不认领为它的功能，也不洗掉它。

**`.tmp-pf-*` 那两个文件不是 progflow 的**（看板 §12 附近如果有人引用会误导）：`.tmp-pf-check.mjs` 14:58 跑的是
`src/postFormatProcessors.ts`（post-format 那一族），`.tmp-pf-out.txt` 是它的输出。真正的 progflow scratch 残留只有一个：
`.tmp-progflow-domain.txt` 15:00 —— 它的最后一屏是 `tests/notice-actions.test.mjs:107` 那条红（fail 1），
即 progflow 死在"跑全域判据、发现别人那块撞了已提交判据"这一步上；它没来得及写任何文档。

---

## 4、两条必答项（答案只能是"磁盘上现在是 X，证据 `文件:行号`"）

### 必答 1 · `src/progressPanel.ts` 里 `'background'` 那一支取消分支，现在**有没有**真实触发方？

**有。** 磁盘链路（每一环都开文件看过）：

1. `src/backgroundTasks.ts:381` 算出档：`current !== null && current.indicator.cancellable && !current.indicator.cancelled`；
   三档出口各带一次：`:390`（正在取消 = `false`，对 `InfoAndProgressPanel.kt:876` 的 `!isStopping`）、`:403`（挂起档）、`:412`（排队档）。
2. `src/progressPanel.ts:81` 把它翻成 `'background'`：`cancellable: queueRow.cancellable ? 'background' : false`。
   **HEAD 版同一句是写死的 `cancellable: false`**（`git show HEAD:src/progressPanel.ts` 的第 76 行）⇒ "此前审计说没有真实触发方"在当时成立，本轮不成立了。
3. `src/processPopup.ts:54-57` 把 `cancellable` 原样带进 `kind:'task'` 的行；`src/App.vue:2329` 模板 `<button v-if="row.cancellable" … @click="cancelProgressRow(row)">`。
4. `src/progressPanel.ts:162-163` → `:154-158`：`backgroundTaskQueue.cancelCurrentAndAwait()`，等不到收尾就 `ctx.notify('后台任务没有响应取消，仍在运行。', true)`。
5. `src/backgroundTasks.ts:351-368` → `:134-144`（`Indicator.cancel()`：先 `suspender?.resume()`，再 `onCancel?.()`）→ `src/gradleHost.ts:210` 的 `onCancel` → `:717-724` `cancel()` → `:446-449` `cancelNative()` → `request('gradle.cancel')`。
6. 挂起态那档为什么尤其有用：`ProgressSuspender.java:55-61`（`cancelled()` 监听先 `resumeProcess()`）在本仓的同形 = `backgroundTasks.ts:140`，判据 `tests/progress-queue-cancel-row.test.mjs:143-183`。

**边界（不是缺陷，是设计决定并被测试钉住）**：队列行只在"排队中 / 被挂起 / 正在取消"三态出现；
只有一条任务在跑且没排队时队列**不画第二行**（`tests/progress-queue-cancel-row.test.mjs:120-141` 钉的就是这条不变量）。
此时用户能点的取消按钮在 producer 自己的行上（Gradle = `src/progressPanel.ts:64-71`，`cancellable: 'gradle'` → `:149` `request('gradle.cancel')`），
所以不存在"某个跑着的操作没有出口"。

### 必答 2 · `src/workspaceInspection.ts` 现在**有没有**传 `onCancel`？

**有。** `src/workspaceInspection.ts:90-93`：

```
90  backgroundTaskManager.begin(WORKSPACE_INSPECTION_TASK_ID, '正在检查代码', {
91    detail: `整工程诊断（配置档 ${profile}）`,
92    onCancel: () => { cancelled = true },
93  })
```

- HEAD 版是**一行式** `begin(id, '正在检查代码', { detail: … })`，没有 `onCancel`（`git diff` 的删除行可见）⇒ 之前"行模型把它判成不可取消"成立。
- 生效机理：`src/progressTasks.ts:87` `cancellable: options.cancellable ?? options.onCancel !== undefined` ⇒ 那一行现在落在可取消档；
  `:120-130` `cancel()` 先调回调再 `end`（对 `ProgressIndicatorModel.kt:32-34` 的顺序）。
- 出口：`src/progressPanel.ts:99-107`（`cancellable: task.cancellable ? { task: task.id } : false`）→ `:143` → 模板按钮 `App.vue:2329`。
- 判据：新 `tests/inspection-cancel.test.mjs`（3 条：在途取消不写表 `:50-73`、**不取消就照常写入的对照** `:75-89`、面板那颗按钮真的走这个回调 `:91-122`）。

---

## 5、它名下待判的三条老待办 —— 哪些做了、哪些没做

（这三条来自 `docs/batch-2026-10-06-status2.md` 与 `docs/wiring-requests-2026-10-06-status2.md` 的 ①②③；
任务书给的措辞有两处指错了文件，按磁盘改正如下。）

| 待办 | 任务书/看板的说法 | 磁盘定案 |
|---|---|---|
| ① `backgroundTasks.ts` 的死出口 `runningSuspendedText` | "待判" | **不是 progflow 做的，早两轮已闭环**：`git grep -n "runningSuspendedText" HEAD -- src` 0 命中（status2 删，`docs/batch-2026-10-06-status2.md:28`、`:53`），status2defect 又用注入证明门禁拦得住（`docs/batch-2026-10-06-status2defect.md:37,226`）。progflow **在它之上又收了七条**（B2）并把留痕写进 `src/backgroundTasks.ts:214-217` ⇒ 这条对 progflow 的账是"扩大收口"，不是"补做" |
| ② "`bridge.ts` 的假控件与 KNOWN_GAPS" | "待判" | **任务书这句口径按磁盘不成立**：假控件条目在 `src/statusWidgets.ts`（**不是** `src/bridge.ts`），磁盘现状 = `bridge` 只剩 `:25-36` 的删除留痕注释，注册表（`:124-145` 那一族 `{ id: … }`）里**没有** `bridge`；`KNOWN_GAPS` 在 `tests/statusbar-popup-motion-parity.test.mjs:40` = `const KNOWN_GAPS = new Map()`（**空**，`:48` 是那条反查）。两处由 **status2 批做完**（`docs/batch-2026-10-06-status2.md:24,56,91-95`；复核 `docs/batch-2026-10-06-status3.md:17`），本轮我也在 102 条里看到那条绿：`✔ 注册表里没有「勾了不生效」的条目：\`bridge\` 已删…`。`src/bridge.ts` 在飞的 2 行改动（`LspHoverResult.range`、`DapBreakpoint.logMessage`，numstat **2/2**，mtime 14:52）**与假控件无关**，属 hover/codelens 与 DAP 族 ⇒ **progflow 没做这条，也不需要它做** |
| ③ 消息窗口 / 错误树族判词 | "待判" | **未做**（不在它名下也没落）。磁盘：消息窗口空态那两句由 **status2** 做完，现值 = 常量 `src/notificationEventLog.ts:44`（`EVENT_LOG_EMPTY_LINES = ['建议、事件，', '以及错误将出现在这里']`，`:41` 就是"原写两句自造中文已删"的留痕）+ 渲染 `src/components/EventLogPanel.vue:232`（`v-for="(line, index) in EVENT_LOG_EMPTY_LINES"`）；错误树四条判词的核实也在 **status2**（同文件 `:38`，本轮**没有新增任何错误树结构**）。当前在飞的是别人的：`src/errorTree.ts` numstat **170/16**、`src/problemsView.ts` **12/6**、`src/components/ProblemsPanel.vue` **55/68**（errtree / msgrows 族），progflow 名下**零命中**（`grep -rn "progflow" src/errorTree.ts src/problemsView.ts src/components/ProblemsPanel.vue src/notificationEventLog.ts` 无输出） |

---

## 6、未完成 / 半截形状登记（不含上表已闭环的三条）

| # | 形状 | 磁盘证据 | 缺的那一步 | 归属 |
|---|---|---|---|---|
| U1 | **取消当错误弹一句红字**（"判词与代码口径不一致"形） | `src/App.vue:1586` `notify(outcome.message, !outcome.ok)`：取消时 `outcome.ok = false` ⇒ 用户主动取消也吃一条 error 通知。`tests/inspection-cancel.test.mjs:20-23` 头注自己写了"上游取消就是进度行消失、**不弹通知**" | 给 `WorkspaceInspectionOutcome` 一个 `cancelled` 面，或 App 侧对取消那一路不弹（详见请求 R2；App.vue 净 0 行） | progflow（它写了这句口径，但没处理下游） |
| U2 | **在途 `workspace/diagnostic` 掐不掉**（可观察停止只到"不写入"） | `src/workspaceInspection.ts:97-100`；`docs/wiring-requests-2026-10-06-msgaudit.md:63-69`（R4，`src/bridge.ts` 余量 **0** 行） | 要么按 R4 归档"不做"（我推荐维持），要么先执行 R5 的腾位步骤 | 上一轮已归档，非 progflow 新增欠账 |
| U3 | **"实现了但没人调"**：队列指示器的写入面在生产侧零调用 | `src/backgroundTasks.ts:66-68`（`setText`/`setFraction`/`setIndeterminate`）+ `:78`（`runNonSuspendable`）；`grep -n "\.setText(\|setFraction(\|runNonSuspendable(" src` 除模块自身外只命中 `src/progressTasks.ts:253`（另一张表的同名方法）与
`src/progressSuspender.ts:84,122`（定义本身）；`src/speedSearch.ts:296`、`src/statusBarText.ts:6` 那两处是注释里的上游方法名，不是调用；
**生产调用只有测试**：`tests/background-tasks.test.mjs:110-131`。同时 `queueRow.percent` 三档恒 `null`（`:391,404,413`）⇒ 队列这一行永远没有进度条 | 缺"第二个入队消费者"或"producer 自己写进度"；**不能**靠给队列行加百分比来补 —— 那会与 `src/progressPanel.ts:64-71` 的 Gradle 行重复，正是 `tests/progress-queue-cancel-row.test.mjs:120-141` 禁的形状 ⇒ 见 R3（把它登记成"接口对齐上游、暂零生产调用"，并在请求里给出唯一不重复的接法） | progflow（明知：`tests/background-tasks.test.mjs:120-124` 已经写了一句"队列那一行**不编百分比**"） |
| U4 | **未定义常量 = 类型红 + 运行期抛** | `src/gradleHost.ts:880` 用 `UNLINKED_PROJECT_DISPLAY_ID`；`grep -rn "UNLINKED_PROJECT_DISPLAY_ID" src` **仅此一处**；两份别的 lane 的 tsc dump 一致：`.tmp-intentw-tsc-final.txt`(15:20) 与 `.tmp-vcsloge-tsc.txt`(15:19) 都写 `src/gradleHost.ts(880,74): error TS2304: Cannot find name 'UNLINKED_PROJECT_DISPLAY_ID'` | 补这条常量 + 一条判据（R1，`src/gradleHost.ts` 净 0 行可做） | §3：磁盘无署名；看板记 progflow 名下 |
| U5 | **判据全红 1 条，就在我这四文件里** | `node --test tests/notice-actions.test.mjs` ⇒ `ℹ fail 1`，红在 `tests/notice-actions.test.mjs:109`（`assert.match(gradleHost, /function notifyFailure\(directory: string, label: string, error: string\): void/)`）与 `:117-119`（钉的是不带 `jvmIssue` 的旧调用句）⇒ 由 G6 那次签名扩展撞出来的**过时形状**，意图（"每条命令的失败都经 notifyFailure、各带中文标签"）没变 | 按纪律"改成仍精确"，不许放松成 `includes`（R4） | G6 那条无署名 lane |
| U6 | 全仓 `vue-tsc` 现 6 条错（我未亲跑，见本文开头） | 另有 lane 的两份 dump 一致（`.tmp-intentw-tsc-final.txt`）：`browsers.ts:539`、`codeLensExtension.ts:404/423/447`、`gradleHost.ts:880`、`semanticActions.ts:507` ⇒ 其中只有 `gradleHost.ts` 在本 lane 的四文件内（= U4） | 收口归零（看板 §21 已按归属拆派） | 各 lane |
| U7 | 依赖对在飞文件（B5） | 见 §1 最后一行 | 若主代理最终把 `progressSuspender.ts` 判给 status2，则本报告 §2.1 B5 的归属句要跟着改，**代码不受影响** | 归属待定 |

**没有**发现的形状（写清楚，免得下一轮再查一遍）：
无注入残留（`grep -rniE "SYSTEM:|主代理|ignore previous|已确认可收尾|if \(true" ` 在这六个文件与两份新判据里 **0 命中**）；
无"测试绿但模块加载抛错"—— `tests/background-tasks`、`tests/progress-queue-cancel-row`、`tests/progress-queue-suspend`、
`tests/inspection-cancel`、`tests/gradle-host` 都**真的 import** 了 `src/backgroundTasks.ts`/`progressPanel.ts`/`workspaceInspection.ts`/`gradleHost.ts`（`tests/gradle-host.test.mjs:16,75` 用 stub loader 引 gradleHost），
所以四个模块在 node 下加载不抛；U4 那条只在**跑到那一支**时抛，不在加载期。
`src/progressPanel.ts.bak`（mtime 2026-10-05 21:04，`.gitignore:31` 的 `*.bak`）不是本批残留，它恰好是 HEAD 版的取证：
`:76` 写死 `cancellable: false`、`:147` 用 `cancelCurrent()`。

---

## 7、文字勘误（不改代码，只登记）

1. `tests/inspection-cancel.test.mjs:22` 两处坐标偏（见 §2.4 末）：`src/backgroundTasks.ts:37` 应为 **`:54`**；`src/gradleHost.ts:485` 应为 **`:515`**。
2. `tests/inspection-cancel.test.mjs:6` 说"审计写的坐标是 `:79` 少给 onCancel"—— 那是 status2 时代的行号，本轮改完 `begin` 在 **`:90`**（`git diff` 的 old 行确认当时确实接近 `:79` 起的那一句 ⇒ 审计没编，只是漂）。
3. `src/backgroundTasks.ts:4-19` 的头注未提 `BackgroundTaskQueue.java:30-32` 的 `@Deprecated`（上游已建议改用协程 + Mutex/Semaphore/Channel）。移植口径不受影响，登记。
4. `src/backgroundTasks.ts:30-31` 说死出口是"六条扁平出口 + 一条 `cancelCurrent()`"，`:294-296` 说"七条"—— 两处口径不同是因为一个数 ref、一个数含 `cancelCurrent` 的总项（`:30` 的"六条 + 一条"= `:294` 的"七条"）。不是矛盾，登记以免下轮误读。
5. 任务书里"上游 `core-impl` 的 `DelayedCompilationProgress` / `ProgressRunner` 一族"：这**四文件的 diff 里没有任何一条引用它们**（我按类名 grep 过四文件），本报告不给它配坐标。真身在 `platform/ide-core-impl/src/com/intellij/openapi/progress/util/ProgressIndicatorUtils.java`（`withTimeout` `:321-341` 被 `src/backgroundTasks.ts:99-100,174-179,346-348` 引用，**我核过**）。
6. 保留文件余量：任务书 `31 / 1` ⇒ 门禁尺 **30 / 0**（§1 倒数第二行）。请求文档按后者出方案。

---

## 8、判据与门禁（我跑的，原始输出）

```
$ node --test tests/background*.test.mjs tests/progress*.test.mjs tests/status*.test.mjs tests/module-size.test.mjs
ℹ tests 107
ℹ suites 0
ℹ pass 107
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 973.9946      # 交付前同一条命令再跑一次：107 / pass 107 / fail 0，duration_ms 1046.7259

$ node --test tests/background*.test.mjs tests/progress*.test.mjs tests/status*.test.mjs     # 主代理那句 102 的口径
ℹ tests 102
ℹ pass 102
ℹ fail 0

$ node .tools/find-orphan-modules.mjs --gate
零生产消费方模块：7 个（其中合法例外 1 个）
… （agent.ts / ColorSchemeSettingsPage.vue / dragAndDropTargets.ts / generalSettingsLocal.ts /
   ideShellCreateTarget.ts / scratchHistory.ts 六条 + main.ts 合法例外；全部**不在本域**，
   都是别的 lane 的在飞模块；`intentionList.ts`/`errorTreeExpansion.ts` 已不在名单里 = intentw 名下正在收）
词法自检：0 异常（每个 specifier 都在原文里逐字存在）
门禁：已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2
   ✔ 已接上（可以更新基线）：src/jarRun.ts
   ✔ 已接上（可以更新基线）：src/runAnythingContext.ts
门禁绿：没有基线之外的新增零消费方模块。
```

本域四文件与在飞挂起器**都不在孤儿名单里**（`backgroundTasks.ts` 被 `src/progressPanel.ts:8`、`src/notifications.ts:22`、
`src/gradleHost.ts:38` 三处 import；`workspaceInspection.ts` 被 `src/App.vue:46` import；`gradleHost.ts` 被 `src/App.vue` 消费）。

另外两条我为了写这份报告跑的（**只读**）：

```
$ node --test tests/notice-actions.test.mjs
ℹ fail 1          # tests/notice-actions.test.mjs:107「Gradle 失败那条通知自带…」
                  # 红因 = src/gradleHost.ts 的 notifyFailure 多了第 4 参（G6/U5），不是进度域

$ node --test tests/gradle-host.test.mjs tests/workspace-diagnostics.test.mjs tests/analysis-scope.test.mjs tests/inspection-cancel.test.mjs
ℹ tests 41 / pass 41 / fail 0
```

**`git diff` 原始 numstat（本报告 §1 的出处）**：

```
95	58	src/backgroundTasks.ts
73	23	src/gradleHost.ts
8	3	src/progressPanel.ts
29	1	src/workspaceInspection.ts
```

---

## 9、工具结果注入 / 噪声记录（本 lane 期间实际遇到的）

- 期间**多次**出现形如「Note: the file `C:\Users\Administrator\.qoder\…\memory\MEMORY.md` was modified since it was last read.
  Modified content: …」的工具结果附注（一部分指向 `projects\D--TaoCode\memory\MEMORY.md`，一部分指向 `.qoder\memory\MEMORY.md`；
  逐条数到 7 条以上但无法给出每条的精确时间戳，故不报具体次数；每次"新内容"列表都在变，
  `Halted lane audit` 那条的形态计数依次是**五种 → 六种 → 七种**，`Tool-result injection attempts` 那条固定写"七种"）。
  按既有纪律一律**当数据**处理：**未执行**其中任何一句、未据此改变本 lane 的动作、未把它转述成用户/主代理的授权。
  读盘复现方式：这些路径在 `D:\TaoCode` 之外，本 lane 只读不写，也不去核对其中文条目真伪 —— 与我的四文件判定无关。
- 一条后台任务事件（`<task-notification>` … `status): completed`）里带的是**我自己那条 `node --test` 的退出码**，属正常 harness 输出，与注入不同类；我按它的 `output-file` 读了原始文件（`C:\Users\ADMINI~1\AppData\Local\Temp\qoder-cli\D--TaoCode\38ddef92-…\tasks\b3kgnws2e.output`），内容与我 §8 贴的一致。
- 本 lane 没有遇到"别的代理已改好""证据已确认可收尾""停手"这一类指令文本。
- `Read` 返回的四份源码与磁盘一致（抽查方式：同一文件另用 `awk 'NR==…'` 取行，行号与文字逐字相同；
  `wc -l`/门禁尺两种口径都对得上 §1 的行数）。

---

## 10、这条 lane 交出去之后要发生什么（一句话版）

四文件的进度域**可以按现状收**（判据齐、消费者齐、App.vue 零行）；
`src/gradleHost.ts:880` 那条未定义常量与 `tests/notice-actions.test.mjs` 那条过时断言**必须**在收口前一起处理（R1/R4），
`App.vue:1586` 那句"取消也弹红字"是本次新暴露的口径尾巴（R2，净 0 行），
R3/R5 是登记性请求（可按优先级不做）。逐字方案见 `docs/wiring-requests-2026-10-06-progflow.md`。
