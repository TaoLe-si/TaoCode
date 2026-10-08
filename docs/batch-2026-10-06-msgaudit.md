# 批次报告 · 2026-10-06 · msgaudit（消息窗口 / 错误树 / 后台任务：判决簿 × 磁盘 逐条对跑）

**只核对、不写实现。一个 `src/` / `tests/` / `native/` 文件都没改。**

## 0. 范围、方法与并发声明

核对的判决行（`docs/inventory/` 下与 `MessagesView`/`ErrorTreeView`/`daemon`/`pf/progress` 相关的全部行）：

| 判决行 | 出处 |
|---|---|
| `pf/error-tree`（错误树/消息视图） | `docs/inventory/verdict-platform_rest.md:221` ← 源在 `scripts/verdict_table.py` |
| `pf/progress`（进度与后台任务） | `docs/inventory/verdict-platform_rest.md:171` |
| `ici/progress`（进度实现） | `docs/inventory/verdict-platform_rest.md:283` |
| `module/progress`（默认桶） | `docs/inventory/verdict-platform_rest.md:206` + 逐类行 `platform_rest_verdict_table.md:14918-14939` |
| `dm/problems-view` / `dm/highlight` / `dm/misc` | `docs/inventory/verdict-daemon.md:30` / `:31` / `:28`（源 `scripts/verdict_table.py:82`） |
| `pv/notification`（消息窗口/通知） | `docs/inventory/verdict-projectviews.md:35` |
| `MessageView` / `MessageViewImpl` | `docs/inventory/ui_scan.md:814` / `:822`（**只有机检行，没有任何族判词**） |
| 逐类行 `pf/error-tree` / `pf/progress` | `docs/inventory/platform_rest_verdict_table.md:12764,12767,12769` / `:13620-13652` |

方法：每条判词里引用的**本仓** `文件:行号` 与**上游** `相对路径:行号` 全部自己开文件复现。上游树 `D:\Backup\Downloads\intellij-community-master\intellij-community-master` 只读。

并发声明（重要，派单前必读）：

- `scripts/verdict_table.py` 在我核对期间 mtime 从 13:42 走到 **13:45**，`src/notificationGroups.ts` 13:45、`src/progressSuspender.ts` 13:39、`src/backgroundTasks.ts` 13:36 —— **有 lane 正在改判决簿和后台任务族**。本报告是 13:45 的快照，A 段的「升档请求」可能已被并发改掉；派单前重跑 `python scripts/verdict_table.py daemon platform_rest projectviews` 再比。
- 本会话期间收到两条「`MEMORY.md` was modified」的注入式提示（伪装成用户消息）。**未当作指令执行、未据此改任何东西**，在此留痕。
- `docs/inventory/*.md` 的判决簿自身也自相矛盾：`platform_rest_verdict_table.md` 的「TaoCode」列写「从未出现」，而同一个类名在 `src/` 里出现（见 §5 X5）。机械列不作证据。

宿主余量（实测，`tests/module-size.test.mjs` 登记的上限 vs 当前行数）：

| 文件 | 当前 | 上限 | 余量 |
|---|---:|---:|---:|
| `src/App.vue` | 2706 | 2737（`:108`） | **31 行** |
| `src/bridge.ts` | 904 | 905（`:127`） | **1 行** |
| `src/components/CodeEditor.vue` | 1144 | 1147（`:136`） | 3 行 |
| `native/main.cpp` | 1845 | 2000（`:37`） | **155 行**（这三族都不需要它） |

---

## 1. A · 判词过时（磁盘上已经做了）⇒ 升档请求

| # | 判决行原文（过时的那半句） | 磁盘实况（我打开过的 `文件:行号`） | 覆盖它的判据 | 升档请求 |
|---|---|---|---|---|
| A1 | `dm/highlight`：「LSP 诊断在 `native/lsp_support.cpp:127-145` 就被裁成 `{line,character,message,severity,end*,source}`，**`code`/`tags` 不透传**，而 `LspDiagnostic` 类型在禁改文件 `src/bridge.ts:109`」 | `native/lsp_support.cpp:148` `if (item.contains("code")) entry["code"] = …`、`:149` 同形带 `tags`（`:143-147` 是「不能裁掉 tags」的理由注释）；`src/bridge.ts:118` `LspDiagnostic{… code?: string\|number; tags?: number[]}`。真实消费：`src/problems.ts:99`（按 tags 过检查配置档）、`:107`（行保留 tags）、`src/annotatorHighlights.ts:65` `problemKindOf(diagnostic.tags)`、`src/inspectionIdentity.ts:124`、`src/inspectionProfile.ts:378` | `tests/problem-identity.test.mjs`（头注 `:6-8` 直接钉 tags→`LIKE_UNUSED_SYMBOL`/`LIKE_DEPRECATED`）、`tests/annotator-highlight-layer.test.mjs`、`tests/inspection-profile.test.mjs` | dm/highlight 的「缺」缩到**只剩 `relatedInformation`**（见 C1）+ `HighlightInfo` 的叠加富信息；`code`/`tags` 两格从判词里删掉。`src/bridge.ts:109` 同时改成 `:118` |
| A2 | `dm/problems-view`：「面板视图状态**跨任务持久化（分组方式/严重度/文本过滤三格）**」＋「缺：问题树的**展开态没有可持久化对象（本仓是扁平列表）**」 | `src/problemsPanelState.ts:27-38` 是 **7 格**：`hiddenSeverities/sortFoldersFirst/sortBySeverity/sortByName/grouping/query/`**`collapsedGroups: string[]`**（`:17-19` 头注明写展开态「要能跨会话记住谁折着，就得给它一个可序列化的家」）。面板：`src/components/ProblemsPanel.vue:103` 读、`:104-109` 变更即存、`:144-152` `isCollapsed`/逐组折叠/`collapseAll`/`expandAll`、`:592-594` 工具栏「展开全部/折叠全部」、`:212-215` 折叠后不渲染那些行 ⇒ **是分组可折叠树，不是扁平列表** | `tests/problems-panel-state.test.mjs:71`（`assert.match(panel, /collapsedGroups: collapsedGroups\.value/, '展开态没有跟着存')`）、`:19-22`/`:43-49`（7 格默认与旧存档补默认）、`tests/problems-view.test.mjs`（三个排序旗标） | 「三格」改「七格」；「展开态没有可持久化对象」整条删掉，改判 `[x]` 或写明残余只有「跨任务/每树一份状态」（→ 见 A2b、B5） |
| A3 | `dm/problems-view`：「缺：Project Problems 的**成员级关联问题（`BrokenUsage`/`RelatedProblem`）**」 | 可移植的那一半已经落盘：`src/problemRelatedInformation.ts`（115 行，`:1-2` 头注自称是这条缺口的可移植子集）、`src/problems.ts:40-42` `relatedFrom`（`relatedInformation ?? related` 两形都认）、`:81` `related?: RelatedLocationInput[]`、`:107` 带进表；面板行菜单那一节 `src/components/ProblemsPanel.vue:50`、`:266-268`、`:770` | `tests/problem-related.test.mjs`（147 行） | 从「缺」改写为「**前端全落、只差宿主两行透传**」，并把这条挂到 C1 的宿主请求上（别让人以为要从零做一个模块） |
| A4 | `pf/progress`：「缺：`BackgroundableProcessIndicator` 那种『**每个后台任务一条独立可取消进度窗**』（本仓只有各功能自己的行 + 队列深度行）」 | `src/progressPanel.ts:94-102` 逐条遍历 `backgroundTaskManager.tasks()` 各发一行，`:99` `cancellable: task.cancellable ? { task: task.id } : false`；`:138` 按 id 找回它自己的 `onCancel`；`:85` LSP `$/progress` 每行带自己的 `{lsp:{language,token}}`；`:22` 类型注释指回 `ProgressIndicatorModel.kt:25-37`。`src/progressTasks.ts:87` `cancellable = options.cancellable ?? options.onCancel !== undefined`、`:122-125` 先调回调再收行 | `tests/progress-task-cancel.test.mjs`（`:5-8` 头注**逐字引用这条缺口原文**并声明通用任务表那一半已补；`:26-56` 档位与顺序；`:79`/`:114` 两条接线断言） | 判词改「已补（通用任务表那一半）」，残余的两条写进 B1/B2/B3，别整条挂着当「缺」 |
| A5 | `ici/progress`：「缺：`ProgressIndicatorUtils` 的**等待/超时**」 | `src/backgroundTasks.ts:162` `export const CANCEL_WAIT_TIMEOUT_MS = 5000`；`:337-354` `cancelCurrentAndAwait()`：置 `cancellingEntry` → `entry.indicator.cancel()` → `:348-351` `Promise.race([entry.done, setTimeout])` → `:352` 清 timer → `:353` 返回是否真收尾；`:342-343` 超时那一路也收行；`:356-367` `queueRow` 把「正在取消：X（等任务体走到下一个取消检查点）」画出来；面板 `src/progressPanel.ts:150-152` 等不到就明说「没有响应取消，仍在运行」 | `tests/progress-cancel-wait.test.mjs`（`:2-6` 头注对上 `ProgressIndicatorUtils.java:310-341` / `:357-395`）、`tests/background-tasks.test.mjs` | 「缺等待/超时」删掉；`ici/progress` 的残余只留 `runInReadActionWithWriteActionPriority`/`ReadTask`/`ProgressIndicatorUtilService`（→ D5） |
| A6 | `module/progress` 整族 `[-]`：「B 堆（未单独点名的平台模块）：**没有 JVM 对象模型可移植**；用到的行为在各域就地实现」（逐类行 22 条全 `[-]`，`platform_rest_verdict_table.md:14918-14939`） | 与同簿 `pf/progress` 自相矛盾——`pf/progress` 判词自己拿这一族的类当口径出处。磁盘上做了：`TaskCancellation.nonCancellable()` → `src/backgroundTasks.ts:117-119`（`if (!this.cancellable \|\| this.cancelled) return`）；`TaskSuspender`/`TaskSuspension`/`TaskSuspenderState` → `src/progressSuspender.ts:72-98` 接口、`:101` `createProgressSuspender`、`:152` `ProgressSuspenderTracker`；`TaskManager.pauseTask/resumeTask` 的文案口径 → `src/backgroundTasks.ts:371-375` | `tests/background-tasks.test.mjs:59-64`（不可取消档）、`tests/progress-task-cancel.test.mjs:26-56`（`ProgressIndicatorModel.kt:16/:23/:92` 三档）、`tests/progress-queue-suspend.test.mjs`（挂起/恢复/文案） | `TaskCancellation`/`NonCancellableTaskCancellation`/`CancellableTaskCancellation`/`TaskSuspender`/`TaskSuspenderState`/`TaskSuspension` 六条从 `[-]` 升 `[~]`。**这条正是「默认桶把接口契约机械判成不适用」的复发**，`module/progress` 的头注要加一句「本族被 pf/progress 逐字引用，不适用默认档」 |
| A7 | `pv/notification`（消息窗口）：「缺：`NotificationGroup` 注册体系、`NotificationRouter` 与 `DoNotAskManager`、**Event Log 工具窗口（`NotificationsToolWindow` 的历史列表视图）**、`NotificationsBeeper` 声音提示与 `RemindLaterManager`『稍后提醒』」 | 五条里**四条已在盘上且有真实消费者**：<br>① 组体系 `src/notificationGroups.ts:20` 四档 `displayType`、`:40` `NOTIFICATION_GROUPS` 清单（`:43/:74/:83/:93` 各条带上游 xml 坐标）、`:148` `balloonFadeoutMs`、`:154` `showsBalloon`、`:176/:183` 按 `displayId` 认组<br>② DoNotAsk `src/notificationDoNotAsk.ts`（316 行）`canShowNotice`/`armRemindLater`/`canRemindLater` + `src/notificationGroups.ts:194 configureDoNotAskOption`<br>③ 稍后提醒 同 ②（`src/notificationEventLog.ts:13` 引 `canRemindLater`）<br>④ 声音 `src/notificationBeeper.ts`（224 行）`playNotificationSound`/`groupPlaysSound`/`setGroupPlaysSound`<br>⑤ Event Log 工具窗口 `src/notificationEventLog.ts`（139）+ `src/components/EventLogPanel.vue`（277），**已挂进工具窗口**：`src/components/ToolWindowView.vue:15` import、`:217` `v-else-if="view === 'notifications'"` 渲染并接 `@clear/@expire/@run`<br>链路：`src/notifications.ts:14-16`/`:22`/`:298`、`src/App.vue:97` `createNotifications`、`src/lspServerMessages.ts:64` | `tests/notification-groups.test.mjs`、`tests/notification-remind-later.test.mjs`、`tests/notification-beeper.test.mjs`、`tests/notification-event-log-search.test.mjs`、`tests/notification-power-save.test.mjs`、`tests/notification-balloon-fadeout.test.mjs`、`tests/notice-actions.test.mjs`、`tests/notices.test.mjs` | `pv/notification` 的「缺」缩到**只剩 `NotificationRouter` 这个扩展点本身**（→ D9）。`verdict-projectviews.md` 快照 10-05 22:27，而 `src/notificationBeeper.ts` mtime 10-05 20:05 ⇒ 判决簿当时就没看见已存在的文件，这条判词整体按「不可信」重跑 |

**A2b（半过时，别误升）**：`pf/error-tree` 缺③「跨任务的错误树持久化与多视图」——持久化那一半＝A2（已做）；**多视图（每棵树一份状态与标签）确实没有**，`ToolWindowView.vue:217` 的 `view` 联合与 `ctx.noticeLog`（`:44`）都只有一份，第二实例要把 ctx 字段接进 `src/App.vue` ⇒ 归 C，不算 A。

---

## 2. B · 真缺且可做（不落在保留文件里）⇒ 可派单小任务

| # | 一句话任务 | 目标文件（可改） | 上游坐标（我核过） | 用户可见效果 | 建议判据 |
|---|---|---|---|---|---|
| B1 | 给后台任务队列「**正在跑的那条**」发一条独立进度行 | `src/progressPanel.ts`（`:73-76` 附近加一行；四个 ref 现成）+ `src/backgroundTasks.ts` 不动 | `platform/platform-impl/src/com/intellij/openapi/progress/BackgroundTaskQueue.java:61-70`（`run(Task.Backgroundable)`）、`ProgressIndicatorModel.kt:39-49` `setFraction/setText`、`:25-37` onCancel 委托 | 现在点「同步更改」后，进度弹窗只有「后台任务队列」那一行**排队深度**，看不到正在跑那条的标题/百分比（`src/backgroundTasks.ts:275` 导出的 `runningTitle/runningDetail/runningFraction/runningCancellable` **全仓零消费者**，只有测试读它们），也**永远点不到取消**——`src/progressPanel.ts:149-153` 的 `'background'` 分支没有任何发出点（`:76` 写死 `cancellable: false`） | 新 `tests/progress-queue-running-row.test.mjs`：面板读 `running*` 并按 `runningCancellable` 发 `cancellable:'background'`；再加一条反证——`queueRow` 不许再把 `cancellable` 写死成 `false`（钉意图，不钉字面量） |
| B2 | 唯一的入队消费者**接上协作检查点** | `src/gradleHost.ts:204-208`（`run({ title, onCancel, run: async () => { await sync() } })` 忽略形参）；`src/backgroundTasks.ts:71` 的签名与 `:249` 的传参都已经备好 | `BackgroundTaskQueue.java:61-70`、`ProgressSuspender.java:154-181`（`freezeIfNeeded`）、`platform/progress/shared/src/suspender/TaskSuspension.kt:24-25`（`suspendText`「displayed in the progress bar」） | 省电模式挂起后 Gradle 同步**照样跑完**（`src/progressSuspender.ts:20-24` 头注自己承认「挂起对它的实际效果只有不再开新任务」）；按取消会**等满 5 秒**再弹「后台任务没有响应取消，仍在运行。」（`src/progressPanel.ts:150-152`） | 在 `tests/gradle-host.test.mjs` 加：`run` 的 `indicator` 被用（进入前 `await indicator.awaitResumed()`、`sync()` 返回后 `indicator.checkCanceled()`）；挂起时不进下一阶段；取消后 `sync()` 的结果**不写模型**，并让 `tests/background-tasks.test.mjs` 的「取消算结束」继续成立 |
| B3 | 让「正在检查代码」那一行**能取消** | `src/workspaceInspection.ts:79`（`begin(id, title, { detail })` 少给 `onCancel` ⇒ `src/progressTasks.ts:87` 推成 `cancellable:false`） | `ProgressIndicatorModel.kt:25-37`（onCancel 委托）、`:92`（`cancellation is TaskCancellation.Cancellable`）、`:23`（`nonCancellable()`） | Analyze → Inspect Code 期间，进度弹窗与状态栏那一行（`src/App.vue` 状态栏 `v-if="row.cancellable"`）**没有取消按钮**——B1/A4 修好后这一条仍然是零，因为唯一的登记点没给回调 | 新 `tests/inspection-cancel.test.mjs`：`begin` 带 `onCancel`；取消置旗后 `src/workspaceInspection.ts:95-112` 的合并循环**不再写 `deps.diagnostics`**、`:115-116` 不再改 `resultIds`，`finally` 仍 `end`。（在途 `workspace/diagnostic` 请求本身要中止才算 C，别把它算进这条） |
| B4 | **逐任务**挂起/恢复（现在是整队列一起让路） | `src/backgroundTasks.ts`（`:285-296` 只有队列级 `setSuspended`/`isSuspended`；`:232` 每条任务已 track 了自己的 suspender）+ `src/progressSuspender.ts:72-98`（`:45-51` 头注写明监听分发被删了） | `platform/platform-impl/src/com/intellij/openapi/progress/impl/TaskInfoEntityCollector.kt:171-180`（`suspenderStateChange.collectLatest` → `:174` `TaskManager.pauseTask(task, suspender.suspendedText, Source.USER)` / `:177` `resumeTask`）、`TaskToProgressSuspenderSynchronizer.kt:22-40`/`:51-60`（双向，带 `isStateChangeInProgress` 防回环） | 能单挂某一条后台任务（例如只让 Gradle 那条停住、检查那条继续），面板那一行显示「已挂起：<原因>」；今天只能全队列一起挂 | 新 `tests/progress-task-suspend.test.mjs`：`suspendTask(id, reason)`/`resumeTask(id)`；重复 suspend 幂等（照 `ProgressSuspender.java:125`）、已 close 空操作、恢复对称（`:139-152`）；双向同步不出现回环（照 `TaskToProgressSuspenderSynchronizer.kt:54` 那句「state change was initiated by taskSuspender itself」） |
| B5 | 错误树/问题面板补 `ErrorTreeViewConfiguration` 的 **`autoscrollToSource`** | `src/problemsPanelState.ts`（`:27-38` 加一格 + `:65-81` 逐字段补默认）、`src/components/ProblemsPanel.vue`（键盘选中处） | `platform/platform-impl/src/com/intellij/ide/errorTreeView/impl/ErrorTreeViewConfiguration.java:16`（`IS_AUTOSCROLL_TO_SOURCE = false`）、`:24` `isAutoscrollToSource()`、`:28` `setAutoscrollToSource()`、`:15` `PersistentStateComponent` | 在问题面板里用 ↑/↓ 移动选中时编辑器跟着跳源（默认关，和上游同默认）。同族那两个 `HIDE_WARNINGS`/`HIDE_INFO_MESSAGES`（`:17-18`）已由 `hiddenSeverities` 兑现，只差这一格 | 复用书签面板已经跑通的同名形态（`src/bookmarksView.ts:25`、`src/components/BookmarksPanel.vue:149`/`:184`/`:209-210`），**别另造一套旗标**；判据：`tests/problems-panel-state.test.mjs` 默认值补一格 + 旧存档缺键回 `false`（这条踩过：见该文件 `:43-49` 的事故留痕），加一条接线断言「键盘移动读这个旗标」 |
| B6 | 文本导出补**多级缩进**（现在只有一层） | `src/errorTree.ts:80-88`（`errorTreeText` 只有「组头 + 每条 4 空格」） | `platform/platform-impl/src/com/intellij/ide/errorTreeView/impl/ErrorViewTextExporter.java:70-87`（`getReportText` 递归、`:85` `indent + 4`）、`:77-79`（`!withUsages` 跳 `NavigatableMessageElement`）、`:89-104`（`exportElement` 里 kind 前缀 + `getExportTextPrefix`）；分桶顺序 `ErrorViewStructure.java:44` `ourMessagesOrder`、`:114` 遍历 | 按「文件→行」或「来源→文件」多层分组导出时，上游是逐层加深 4 空格；本仓导出的 .txt 所有消息同一缩进，长报告读不出层级 | 扩 `tests/error-tree.test.mjs`：给一棵两层桶树，断言第二层缩进 8 空格、组头不缩进、`details:false` 时**只留最外层组头**（对齐 `:77-79` 的跳过语义）。判据必须自带一条「该失败」案例：把 `indent+4` 写成 `indent` 要红 |

> B 段的排序理由：B1 与 B3 是**现成能力没有出口**（写好的取消分支没人能点），B2 是**已宣示的语义没兑现**（判词与代码注释都承认挂起对它无效），三条都不碰保留文件、都不需要新模块。

---

## 3. C · 缺的那一半在宿主（App.vue / bridge.ts / CodeEditor.vue / native/main.cpp）

| # | 缺什么 | 前端已落的一半（证据） | 挡住的宿主半边 + **宿主余量** | 备注 |
|---|---|---|---|---|
| C1 | LSP `Diagnostic.relatedInformation` 透传 | `src/problems.ts:40-42` `relatedFrom`（两形都认）、`:81` 字段、`:107` 进表；`src/problemRelatedInformation.ts`（115 行折叠规则）；`src/components/ProblemsPanel.vue:50`/`:266-268`/`:770` 行菜单「相关位置」一节。宿主没给数据 ⇒ 该节一行都不渲染（不是假控件） | `native/lsp_support.cpp:127-153` 的 `shape_diagnostics` 不带 `relatedInformation`（`:148-149` 只带 code/tags）；`src/bridge.ts:118` 的 `LspDiagnostic` 无该字段。**bridge.ts 余量 1 行** ⇒ 只能原地改 `:118` 那一行、不增行；`native/lsp_support.cpp` 不在保留名单（376 行 / 默认上限 1100）；**`native/main.cpp` 用不上**（余 155 行，本条不需要它） | **已有开着的请求，别再报一遍**：`docs/wiring-requests-2026-10-06-problems.md:7` 的 **R1**（10-06 12:23）给了可照抄 cpp 与整行替换，且 `:189` 的复核行明确写「`src/bridge.ts:118` 逐字仍是 `… code?…; tags?… }`，插入锚 `:149`→`:150` 复核一致」⇒ 本条**仍然有效、仍未接** |
| C2 | Alt+Enter 弹层里的**编辑器内嵌预览层**（`dm/quickfix` 的缺） | `src/intentionPreview.ts`（118 行）已算出 before/after 与「±N 行」摘要，消费在问题面板行菜单 | 弹层渲染在 `src/App.vue`——判词写的坐标 `:2704-2705` **是错的**（那里是「关于」对话框与收尾 `</div>`），实际弹层在 **`src/App.vue:2674-2675`**。App.vue 余量 **31 行** | 判词里「行里只有标题与 kind 两列」的实质成立（`:2675` 只有 `action.title`/`action.kind` 两个 `<span>` 加两个状态注），只是坐标漂了 30 行。**先改判词坐标再派单**，否则 lane 会去改「关于」框 |
| C3 | 错误树的**多视图**（每棵树一份状态与标签，`pf/error-tree` 缺③ 的后一半） | `src/problemsPanelState.ts` 一份状态、`src/components/ProblemsPanel.vue` 一个面板实例 | `src/components/ToolWindowView.vue:217` 的 `view` 联合 + `:44` `ctx.noticeLog` 都是单份；第二实例的 ctx 字段要从 `src/App.vue` 传（`:847`/`:885`/`:1644` 是现有 noticeLog 的三处装配点）。App.vue 余量 **31 行** | ToolWindowView.vue 本身可改（不在保留名单）；**纯规则一半（每份状态按 key 存）不需要宿主**，可先落 `src/problemsPanelState.ts` 再等接线 |
| C4 | 取消**在途**的 `workspace/diagnostic` 请求（B3 之外的那半） | `src/workspaceInspection.ts:81` `deps.query(...)` 是唯一 await 点 | `src/bridge.ts:109` 的 `Method` union 只有 `lsp.request`/`lsp.cancelProgress`/`lsp.stop`，**没有按请求 id 取消**；`lsp.cancelProgress` 只能取消服务器主动 begin 的 `$/progress`。bridge.ts 余量 **1 行** ⇒ 加一个方法名要先把别处挤出一行 | 这条与 `pf/browsers` 判词里「新增方法要动 `src/bridge.ts` 的 `Method` union 与 `native/main.cpp` 的分派表」同形。**建议不做**：B3 已经能给用户「不再写入结果」的可观察停止，代价小得多 |

---

## 4. D · 架构不等价（上游形态本仓做不出，不硬造）

| # | 上游形态 | 我打开的坐标 | 为什么做不出（不许硬造等价物） |
|---|---|---|---|
| D1 | `EditableMessageElement` / `NewErrorTreeEditor`（`pf/error-tree` 缺①） | `platform/platform-impl/src/com/intellij/ide/errorTreeView/EditableMessageElement.java:29-36`（返回 `TreeCellEditor` 与 `CustomizeColoredTreeCellRenderer`）、`NewErrorTreeEditor.java:32`（`extends AbstractCellEditor implements TreeCellEditor, MouseMotionListener`）、`:35-37`（`tree.setCellEditor(...)` + `addMouseMotionListener`） | 这是 **JTree 的 cell-editor 挂点**：把消息文本当字段就地编辑，靠 Swing 的 editor/mouse-motion 生命周期。DOM 侧要做就得给面板行挂 contenteditable，而本仓消息全是 LSP/编译器**只读**产物（判词这一句成立），编辑了下次重推即被覆盖 ⇒ 既无上游语义也无下游语义。判 `[-]`，不补 DOM 假编辑 |
| D2 | `HotfixGroupElement` / `FixedHotfixGroupElement`（缺②） | `HotfixGroupElement.java:18-51`（组元素带 `Consumer<? super HotfixGate> myHotfix` + 两个 `CustomizeColoredTreeCellRenderer`）、`ErrorViewStructure.java:273 addHotfixGroup`、`NewErrorTreeViewPanel.kt:698-699`；真实生产者只有 VCS：`platform/vcs-impl/src/com/intellij/openapi/vcs/impl/AbstractVcsHelperImpl.java:317` ← `update/VcsUpdateTask.kt:357-365`（`val fixer = vcs.vcsExceptionsHotFixer`；`:360` **fixer == null 就直接 `mapOf(null to exceptionList)`**）。全树 `grep "implements VcsExceptionsHotFixer"` **零实现**，无 EP 注册 | 上游 community 构建里这条 hotfix 组**从来不会出现**（fixer 恒为 null）。本仓要实现必须先造一个上游没有的 `VcsExceptionsHotFixer`，再把它挂进错误树 = 拿自造功能冒充移植。判 D；`pf/error-tree` 判词那句「本仓修复走 codeAction 菜单与批量修复，没有 hotfix 组模型」改成「上游该支无生产者，不追」 |
| D3 | `CallingBackColoredTreeCellRenderer` / `NewErrorTreeRenderer`（缺④） | `platform/platform-impl/src/com/intellij/ide/errorTreeView/CallingBackColoredTreeCellRenderer.java`、`NewErrorTreeRenderer.java` 存在（同目录 `find` 实测） | Swing 渲染器本体；DOM 行渲染由 `ProblemsPanel.vue` 承担。机械降级判 `[-]` **正确**，不用动 |
| D4 | `DaemonProgressIndicator`（`dm/misc`，`daemon_verdict_table.md:370`，192 行） | `platform/analysis-impl/src/com/intellij/codeInsight/daemon/impl/DaemonProgressIndicator.java:29-33`（`AtomicInteger debug` 驱动的 `TraceableDisposable`、`volatile Span mySpan`、`IJTracer` = `TelemetryManager.getTracer(Scope("daemon"))`）、`:31` `volatile Throwable myCancellationCause`、`:119-132` 的 `checkCanceled` 要**重放保存的取消原因** | 三层都不在 DOM：JVM 侧 OpenTelemetry span 作用域、`TraceableDisposable` 的对象树泄漏追踪、绑到文档/PSI 的按文件取消（daemon 用它中断某个文档的检查）。本仓检查由语言服务自己调度、取消走 `lsp.cancelProgress`，没有可取消的「本仓 daemon」。判 D 成立；`dm/misc` 那句「没有 PSI/索引模型可移植」补一句「遥测/tracer 与 TraceableDisposable 也不在」 |
| D5 | `ProgressIndicatorUtils.runInReadActionWithWriteActionPriority` / `ReadTask` / `ProgressIndicatorUtilService`（`ici/progress` 残余） | `platform/platform-impl/src/com/intellij/openapi/progress/util/ProgressIndicatorUtils.java`（判词与 `tests/progress-cancel-wait.test.mjs:2-6` 都指向 `:310-341`/`:357-395`，等待/超时两支我已确认落盘＝A5；剩下的是读写动作那一族） | 读写锁优先级抢占（`Application.runReadAction` 下让写、`NonBlockingReadAction`）绑 JVM 线程模型；DOM 单线程 + 宿主分进程执行，没有可让位的读锁。判 D，**别造一个假的「让写」标志位** |
| D6 | `BridgeTaskSupport` / `BridgeTaskSuspender` / `PlatformTaskSupport`（`pf/progress`） | 逐类行 `platform_rest_verdict_table.md:13624`/`:13625`/`:13629`（三条都 `[~]`＋「从未出现」） | 跨端（前端/后端两个执行体）任务桥；本仓是单进程宿主 + 原生分派，没有第二个执行体。判 D 成立 |
| D7 | `CancellationCheck.kt`（`pf/progress`） | `platform/platform-impl/src/com/intellij/openapi/progress/impl/CancellationCheck.kt` 存在（`find` 实测） | 上游它是「`checkCanceled` 被调用得太少」的**调试期检查**（判词这一句写得对），不是取消广播；本仓没有全仓扫描式的调用频率探针需求。判 D |
| D8 | Swing 进度对话框一族：`ProgressDialog`/`ProgressDialogUI`/`ProgressWindow`/`PotemkinProgress`/`SuvorovProgress`/`ColorProgressBar`/`StatusBarProgress`/`EventStealer`/`DispatchThreadProgressWindow`/`SmoothProgressAdapter` | 逐类行 `platform_rest_verdict_table.md:13639-13651`（全 `[~]`＋「从未出现」） | 模态 Swing 对话框 + 事件窃取（`EventStealer` 抢 AWT 事件队列）+ 自绘平滑进度条。本仓进度面是状态栏 + 弹窗列表（`src/progressPanel.ts`、`src/App.vue` 状态栏 `progressOpen` 那一块），没有模态进度窗这条产品形态。机械降级判 `[-]` 成立 |
| D9 | `NotificationRouter`（`pv/notification` 唯一真剩的缺） | `platform/ide-core/src/com/intellij/notification/NotificationRouter.kt:15-28`（`interface … { fun routeNotification(...) }`、`:27` `EP_NAME = "com.intellij.notificationRouter"`） | 它是**扩展点**：给第三方把通知改派到别的 manager。本仓没有插件贡献点宿主（`src/pluginGroups.ts` 那套只是清单），没有可注册的第二个 manager。判 D。**注意别把行为面一起判 D**——按 `displayType` 决定弹不弹气球/落哪个工具窗这一半已经落盘（A7 ①） |

---

## 5. 判词不可信 / 坐标漂移（每一条都自己开文件复现过）

| # | 判词写的 | 磁盘实际 | 后果 |
|---|---|---|---|
| X1 | `src/bridge.ts:109` = `LspDiagnostic`（`verdict_table.py:82` / `verdict-daemon.md:31`） | `src/bridge.ts:109` 是 `export type Method = …`（整串方法名 union）；`LspDiagnostic` 在 **`:118`** | 照判词去改 `:109` 会改到 union 那一行，而 union 是机检锚（`tests/routing-parity.test.mjs`、`tests/module-size.test.mjs:128` 的 note） |
| X2 | `src/App.vue:2704-2705` = Alt+Enter 弹层（`verdict_table.py:84` / `verdict-daemon.md:29`） | 实际弹层在 **`:2674-2675`**；`:2704` 是「关于 TaoCode」对话框、`:2705` 是 `</div>`、`:2706` 是 `</template>`（App.vue 只有 2706 行） | 30 行的漂移；按旧坐标接线会改错块 |
| X3 | `src/backgroundTasks.ts`：`setSuspended`/`isSuspended` 在 `:278-288`/`:289`，响应式挂起原因在 `:184`，`queueRow` 在 `:349`、挂起分支 `:364-370`（`verdict-platform_rest.md:171`） | `setSuspended` 在 **`:285-295`**、`isSuspended` 在 **`:296`**（`:289` 是恢复队列的循环）、`queueSuspendReason = ref(…)` 在 **`:186`**、`queueRow: computed(…)` 在 **`:356`**、挂起分支在 **`:371-375`**。`:276-280` 现在是一段「原写在这里的 `currentSuspender()` 已删」的注释——判词引用的正是这块注释附近 | 该族功能**都在**，只是每条坐标都往旧版本偏了；派单必须用我这批新坐标 |
| X4 | `native/lsp_support.cpp:127-145` 把 `code`/`tags`「裁掉」（同 A1） | 函数体是 `:127-153`；`:143-147` 是「不能裁 tags」的理由注释、`:148-149` 两行**正在透传** | 结论方向反了。判词把「已修的旧状态」当现状写，属 A1 的升档依据 |
| X5 | `platform_rest_verdict_table.md` 的「TaoCode」列：`BackgroundTaskQueue`/`ProgressIndicatorModel`/`ErrorViewStructure`/`ErrorTreeElementKind` 都写「从未出现」（`:13620`/`:13621`/`:12764-12769`） | `grep -rl` 实测：`BackgroundTaskQueue` 命中 **4 个** src 文件、`ProgressIndicatorModel` 4 个、`ProgressSuspender` 2 个、`ErrorViewStructure` 2 个、`ErrorTreeElementKind` 1 个 | 逐类表的机械列是旧快照（表 mtime 10-06 11:45，`src/backgroundTasks.ts` 13:36）。**「从未出现」不能当「没做」的证据**，A6 的误判就来自这里 |
| X6 | `verdict-projectviews.md:35`（快照 10-05 22:27）写「缺 NotificationsBeeper」 | `src/notificationBeeper.ts` 当前 mtime **10-05 20:05**，早于判决簿 | 至少可证：判决簿写下时没看见盘上已有的文件。`pv/notification` 整条判词按「重跑」处理（→ A7） |
| X7 | 消息窗口的 `MessageView`/`MessageViewImpl` | 全 `docs/inventory/` 里 **`MessagesView`/`MessageView` 只出现在 `ui_scan.md:814`/`:822` 两条机检行**（「未出现」），**没有任何族判词**；`ui` 域的判决文件 `verdict-ui-tabs-popup.md` 只覆盖 `ui/tabs`+`ui/popup`（`:1` 标题写明 124 类） | 这是**覆盖洞**，不是「判了没做」。上游 `MessageView.kt:10-33` 实际只是「拿 Messages 工具窗口的 `ContentManager` + 初始化前排队 runnable」的薄服务，其价值面（多标签消息容器、Export to text file）在本仓由 `ToolWindowView.vue`/`errorTree.ts`/`export_file.hpp` 承担 ⇒ 建议先补一条族判词（把 `ui/content/` 那一段归族），再谈档位，**不要按现在这条「未出现」派活** |

---

## 6. 一句话总结

判决簿这三族**总体偏悲观**：A 段 7 条（其中 `pv/notification` 一条里 5 个「缺」有 4 个已兑现、`module/progress` 整族被默认桶误判）比 B 段 6 条多；真正还欠宿主的只有 4 条，其中 **C1 已经有开着的请求文档**（`docs/wiring-requests-2026-10-06-problems.md` R1），**C4 建议不做**。所有本仓坐标有 4 处漂移/反向（X1-X4），派单前必须用本报告的新坐标替换。

**如果只能做 3 件，做哪 3 件：**
1. **B1 + B3（同一条改动面：把已写好的取消能力接到界面上）**——`src/backgroundTasks.ts:275` 四个 ref 全仓零消费者、`src/progressPanel.ts:149-153` 的 `'background'` 分支没有发出点、`src/workspaceInspection.ts:79` 少一个 `onCancel`：这是「代码已写、判据已备、用户就是点不到」，两行接线换回 A4 判词的真兑现，回报/风险比最高。
2. **B2（Gradle 同步接协作检查点）**——判决簿与 `src/progressSuspender.ts:20-24` 自己都写了「挂起对它只有『不再开新任务』的效果」，即当前宣示的语义没兑现；不做的话 A6/B4 那些挂起工作停留在模型层，且取消必然等满 5 秒报「没有响应取消」。
3. **C1（`relatedInformation` 宿主两行）**——唯一一条「前端整条链已在盘上、有判据、只差宿主」的缺口，`docs/wiring-requests-2026-10-06-problems.md:7` R1 已给可照抄实现且 `:189` 复核仍有效；bridge.ts 只剩 1 行余量，所以它必须**由宿主 lane 独占单发**、不能和别的 bridge.ts 请求并派，否则必然撞上限。
