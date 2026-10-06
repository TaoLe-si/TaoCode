# 批次报告 · 2026-10-06 · 桶 status2（状态栏 / 进度 / 通知 / 消息窗口 / 错误树 / 音频提示）

派单三件事：① 收掉上一批（`docs/batch-2026-10-06-statusbar.md`）留在报告里的两条待办；
② `docs/wiring-requests-2026-10-06-statusbar.md` 里属我面的做完、宿主行交请求；
③ 消息窗口 / 错误树族判词先核后做。交付 = 这份 + `docs/wiring-requests-2026-10-06-status2.md`。

**开工基线**（本轮第一跑，只跑自己域）：
`node --test tests/status-* progress-* notification-* notice-* error-tree* about*` = **152 条 / 152 通过 / 0 失败**；
`tests/statusbar-popup-motion-parity.test.mjs` + `tests/background-tasks.test.mjs` = **14 条 / 14 通过**；
`npx vue-tsc -b --force` = **退出码 0、0 错**。收工数字见 §3。

三条派单给的"待办"逐条落盘，其中两条**不只是删出口**：按判据跑出了两个真缺陷（§1 表格 ①-5/①-6），
都修了并配了用例 —— 这也是本轮唯一"新增行为"的部分，其余都是删死面、订正措辞与核实判词。

---

## 1. 判词表（族 / 项 / 判定 / 上游相对路径:行号 / 本仓落点 / 一句话）

判定档位：**已做**＝本轮做完并有判据；**订正**＝本轮把钉错/写错的东西改对（留痕）；**核实**＝本轮亲自打开上游文件把
上一轮的"无法核实"变成有行号的结论；**做不到 / 不适用**＝给具体卡点。

| 族 | 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 一句话说明 |
|---|---|---|---|---|---|
| pf/statusbar | 待办①：`src/statusWidgets.ts:108` 的 `bridge` 假控件 | **已做**（两处同批） | `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1618-1644`（十五条 `statusBarWidgetFactory` 的 id：VfsRefresh/Position/LineSeparator/Encoding/PowerSaveMode/InsertOverwrite/ReadOnlyAttribute/Notifications/FatalError/WriteThread/Memory/EditorAnimationCacheStatistics/SmartModeIndicator/IndexesAndVfsFlushIndicator/settingsEntryPointWidget）；全仓 `--include=*.xml` 搜 `statusBarWidgetFactory` ∩ `bridge` = **0 命中** | 删条目：`src/statusWidgets.ts`（现在 `:116-118` 只剩 `file`/`progress`/`problems`）+ 表头留痕 `:21-37`；同批清门禁：`tests/statusbar-popup-motion-parity.test.mjs:30-40`（`KNOWN_GAPS = new Map()`）；新判据 `tests/status-widgets-registry.test.mjs:103-118` | 先证明它是假控件（`src/App.vue` 实测只消费 16 个 id、里面没有 `bridge`；上游没有这个组件）再删；**没有放松任何断言**：那条门禁的断言体一字未动，只是"已知缺口"现在为空 |
| pf/statusbar | 删 `bridge` 后我名下两处清单（上一批说"会随条目一起改"） | **已做** | 同上 | `tests/status-bar-widgets.test.mjs:94-99`（清单 `file`/`progress`/`problems` 三条 + 用例标题「那三条不是工厂」）、`tests/status-widgets-registry.test.mjs:82-88` | 清单从四条改三条是**条目不存在**的结果，不是放松：仍是逐条 `assert.match(registry, …factory: false })` 与逐条"不该有搜索命中" |
| pf/statusbar | `StatusBarWidgetFactory` 侧的 `explicitlyDisabled()` 零消费者 | **已做（删除 + 归位）** | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/widget/StatusBarWidgetSettings.kt:22`（`isExplicitlyDisabled`）、消费处 `…/status/widget/StatusBarWidgetsManager.kt:197`（装配可用工厂列表时先过滤） | `src/statusBarWidgets.ts:69-76`（`shouldCreateWidget` 的注释现在写着这条闸由 `widgetEnabled` 承担） | 本仓同一判据只有一份（存过的值优先，没存过按 `isEnabledByDefault`），不再另开一个"只认 false"的函数；原写的行号 `:24` 订正为实测的 `:22` |
| pf/statusbar | `statusTextManaged()` / `statusTextTimeSuffix()` 零消费者（注释自称"判据用"，实测没有任何判据用它） | **已做（删除）** | 上游 `…/status/StatusText.java` 的 `myTimeText` 只有一个读者（那一行文字本身）；本仓的时间后缀已在 `statusBarDisplay` 里拼进 `display.text`（`src/statusBarText.ts:89-94`） | `src/statusBarText.ts:97-100`（留痕注释）+ 模块状态不再存 `timeText`（`:106` 与 `render` 里删掉赋值） | 删掉的是"没人读的第二个真相"，行为不变：`tests/status-bar-text.test.mjs` 仍绿（`statusBarDisplay` 的返回形状一字未动） |
| pf/progress | 待办①：`src/backgroundTasks.ts:154` 的 `runningSuspendedText` 零消费方 | **已做**（删除） | `platform/progress/shared/src/suspender/TaskSuspension.kt:24-28`（`Suspendable(suspendText)` 的注释明写那句是"displayed in the progress bar"）、`platform/platform-impl/src/com/intellij/openapi/progress/impl/TaskInfoEntityCollector.kt:174`（`TaskManager.pauseTask(task, suspender.suspendedText, Source.USER)`）、`:177`（`resumeTask` 对称面） | `src/backgroundTasks.ts:196-201`（留痕：为什么不在这里另开出口）+ 出口表 `:265`（清单里已无它）；判据 `tests/progress-queue-suspend.test.mjs:25-36` | 挂起状态在本仓只有一条可见通道 = `queueRow`（`:344-356`），面板读它（`src/progressPanel.ts:75`）；上一批"要么删要么让面板改读它"两问，选了删（让面板改读就是同一状态画两遍） |
| pf/progress | 同一族的另一条零消费出口 `currentSuspender()` | **已做（删除）** | 上游 `…/ProgressSuspenderTracker.kt:12-55` 的 `getSuspender` 是给**第二个状态源**用的（`TaskToProgressSuspenderSynchronizer.kt:14-48`）；本仓唯一触发者是省电模式、单向驱动 | `src/backgroundTasks.ts:265-268`（留痕注释）、队列内部仍用 `suspenders.getSuspender` + `Indicator.suspender` 两条私有通道 | 实测全仓（含测试）零引用；对外留着就是一个"没人读的窗口" |
| pf/progress | **跑出来的真缺陷 1**：`queueRow` 是 computed，而挂起原因是普通 `let` ⇒ 只切换挂起状态时那一行**不会出现在面板里** | **已做（修复 + 判据）** | 上游的状态变化会主动推给 UI：`ProgressSuspender.java:192-204` 的 `SuspenderListener.suspendedStatusChanged`（本仓 `src/progressSuspender.ts:122-125` 的 `onStateChanged` 是它的等价物） | `src/backgroundTasks.ts:184`（`const queueSuspendReason = ref<string \| null>(null)`）+ 五个读写点 `:200,271,280,355-358` | 判据 `tests/progress-queue-suspend.test.mjs:38-73` 在修复前实测红（`row` 为 `null`），修复后绿 ⇒ 省电模式开/关时那一行真的会亮起/灭掉，不再"等下一个别的变化才闪出来" |
| pf/progress | **跑出来的真缺陷 2**：`Indicator.awaitResumed()` 只把 resolve 登记进 `waiters`、不接 `suspender.waitWhileSuspended()` ⇒ **恢复后任务体永远不放行** | **已做（修复 + 判据）** | `ProgressSuspender.java:154`（`freezeIfNeeded`）+ `:139`（`resumeProcess` 叫醒等待）、`:58`（取消时先 `resumeProcess()`） | `src/backgroundTasks.ts:126-136`（两条放行路径都写进注释并实现：`pending.then(() => this.resumeWaiters())` + `cancel()` 那条） | 修复前用例实测红（`beats` 缺 `'第二段'`）；这条比上一条更硬 —— 卡住的是任务本身，不是显示 |
| pf/progress | 队列对外状态没有"防死出口"的门禁 | **已做（新门禁）** | 铁律 §5「不许留只过自己测试的死模块」的符号级延伸 | `tests/progress-queue-suspend.test.mjs:25-36`：`Object.keys(createBackgroundTaskQueue()).sort()` 与 14 个键名 **deepEqual** | 精确清单而不是 `includes`：新增一条没人登记的键必红；反向验证见 §4 |
| pf/progress | 队列挂起那句措辞把"没做的事"说成做了（唯一消费者 `gradleHost.ts:203` 的任务体没有检查点） | **订正 + 交请求** | 协作式让路：上游 `ProgressSuspender.java:154` 只在任务走到 `checkCanceled()` 时才冻结 | `src/backgroundTasks.ts:358`（「正在跑的那条**会在下一个检查点让路**」，原写「停在检查点上」）+ 模块头 `:24-29` 写清现状 | 措辞按实际能力改；真正补齐检查点是别人名下的 `src/gradleHost.ts` ⇒ 请求 W3（含可照抄替换） |
| pv/notification | 消息窗口（Event Log）**空态那两句**：本仓写的是「没有通知。」/「没有匹配的通知。」 | **订正（自造中文 → 上游原文）+ 已做** | `platform/platform-impl/src/com/intellij/notification/impl/ui/NotificationsPanel.kt:264-268`（`setEmptyState()` 两个 `appendLine`）、`:145`（建面板就装上）、`:437`（`startSearch()` 里 `clearEmptyState()`）、`:472`（`cancelSearch()` 里 `setEmptyState()`）；文案键 `platform/platform-api/resources/messages/IdeBundle.properties:3109`="Suggestions, events,"、`:3110`="and errors will appear here"；中文包取值 `localization-zh.jar!messages/IdeBundle.properties:1725`=「建议、事件，」、`:1726`=「以及错误将出现在这里」 | 模型 `src/notificationEventLog.ts:30-56`（`EVENT_LOG_EMPTY_LINES` + `showsNoticeEmptyText`）；渲染 `src/components/EventLogPanel.vue:228-233` + 样式 `:267`；判据 `tests/notification-event-log-search.test.mjs:56-77`（4 条新用例中的 2 条） | 上游没有"没有通知/没有匹配的通知"这两句中文（违 §3 文案条）；且"搜索进行中"本来就不给占位（那件事由搜索框变红说，`:461`，上一批已接）⇒ 一并把"什么时候给占位"做成可测函数 |
| pv/notification | 上一批请求 1（`Messages`/`messageDialog` 宿主） | **核实：仍然缺宿主** → 交请求 | `platform/platform-api/src/com/intellij/openapi/ui/Messages.java`（`showYesNoDialog` 一族返回选中按钮）、`platform/platform-impl/src/com/intellij/ui/messages/MessagesServiceImpl.java`、`platform/ide-core/src/com/intellij/openapi/ui/MessageDialogBuilder.kt:19` + `MessageType.java`（同目录；**citefix 订正**：原写 `platform/platform-api/src/com/intellij/openapi/ui/MessageDialogBuilder.kt` 参考树里没有该路径，224 行的真身在 `platform/ide-core/src/com/intellij/openapi/ui/`，第 19 行逐字 `sealed class MessageDialogBuilder<T : MessageDialogBuilder<T>>(protected val title: @NlsContexts.DialogTitle String,`） | 实测 `grep -n "messageDialog\|showMessage\|MessageHost" src/App.vue` = **0 命中**；`src/components/MessageDialog.vue` 不存在；`src/messageDialog.ts` 唯一消费者 = `src/components/TrustedProjectDialog.vue:19` | `src/App.vue` 是保留文件（属主 `appvue`）⇒ 请求 W1，并补了挂载锚点 `src/App.vue:41 / :2622` |
| pv/notification | 上一批请求 2（通知设置页） | **核实：仍然缺宿主** → 交请求 | `platform/platform-impl/resources/intellij.platform.ide.impl.xml:966`（`NotificationsConfigurableProvider`）；⋮ 第一项的条件 `NotificationsPanel.kt:1109`（本轮重开该文件数过：`isRegistered(notification.groupId)`） | 实测 `src/components/NotificationsSettingsPage.vue` 不存在；数据侧 `src/notificationGroups.ts` / `notificationBeeper.ts` / `notificationDoNotAsk.ts` 齐 ⇒ 请求 W2 | 页面不存在时给 ⋮ 加「设置…」就是点不动的假控件（`src/notificationEventLog.ts:104-116` 维持不渲染） |
| pv/notification | 上一批请求 3（`bridge` 两处同批） | **已闭环** | 见本表第 1 行 | 本轮两处一起改完，门禁 60/60 绿 | 可从 `docs/wiring-requests-2026-10-06-statusbar.md` 关闭这一条 |
| pf/error-tree | 判词四条"缺"（①可编辑消息 ②修复组 ③跨任务持久化/多视图 ④Swing 渲染）—— 上一批写的是"无法核实（未重开该类）" | **核实（本轮亲自打开上游目录）+ 判定：① 做不到 · ② 做不到 · ③ 不适用 · ④ 不适用** | 目录 `platform/platform-impl/src/com/intellij/ide/errorTreeView/`（本轮 `ls` 16 个文件 + `impl/`）：`ErrorViewStructure.java:44-50`（`ourMessagesOrder` = INFO,ERROR,WARNING,NOTE,GENERIC）、`:109/:114`（`getChildElements`：先按这个顺序放 simple messages，再放具名分组）、`EditableMessageElement.java:29`（接口本体，就地改消息文本）、`HotfixGroupElement.java:18`（`extends GroupingElement`，插件 hotfix 组）、`impl/ErrorTreeViewConfiguration.java:15`（`PersistentStateComponent`＝每视图状态与过滤）、`platform/platform-api/src/com/intellij/ide/errorTreeView/ErrorTreeElementKind.java:18-22,47-56` | `src/errorTree.ts`（`:23` 顺序、`:26-28` kind 文案、`:31-39` 严重度→kind、`:80-88` 导出两档）——本轮**没有新增任何错误树结构** | ① 本仓诊断只读（LSP/编译器输出），没有"改消息文本"的场景；② 没有 hotfix 分发通道（修复走 codeAction）；③ 问题表是会话内派生数据，语言服务重推即整体替换，没有每视图持久状态；④ DOM 版由 `ProblemsPanel.vue` 的行渲染承担。⇒ 上一批这四条的"无法核实"现在都有行号了 |
| pf/error-tree | 本仓 `errorTreeKind` 的严重度映射对不对 | **核实：对，不改** | `ErrorTreeElementKind.java:47-56`（`convertMessageFromCompilerErrorType`：ERROR/WARNING/INFORMATION+STATISTICS→INFO/SIMPLE→GENERIC/NOTE→NOTE）；`platform/platform-api/resources/messages/IdeBundle.properties:130-134`（`errortree.*` 值带冒号） | `src/errorTree.ts:31-39` + 上游同族判据 `src/highlightLevels.ts:11-13,44-49`（本仓 LSP 四档：1 错误 / 2 警告 / 3 提示 / 4 信息） | 逐条对得上：**显示文案**一致（3→「提示」、4→「信息」），导出的桶顺序也与 `ourMessagesOrder` 同向；上游那句 presentable text 带冒号是**行内前缀**形状（`ErrorViewTextExporter.java:91` + `NavigatableMessageElement.java:52-54`），本仓把它用在**组头**，照抄冒号只会变「错误： (3)」⇒ 登记差异、不照抄 |
| pf/error-tree | 导出文本的「Details」档（`details=false` 只留组头） | **核实：模块侧已做完，缺宿主** → 交请求 | `impl/ErrorViewTextExporter.java:21,27-28`（`JCheckBox myCbShowDetails`，默认 `setSelected(true)`）、`:38-40`（它是导出对话框的设置项）、`:77-79`（`withUsages=false` ⇒ 跳过 `NavigatableMessageElement`）、`:85`（子层缩进 `+4`）；文案键 `IdeBundle.properties:143` = "Details" | 本仓 `src/errorTree.ts:80-88`（两档都实现、判据在 `tests/error-tree.test.mjs`）；调用点 `src/components/ProblemsPanel.vue:521` 只传了 `errorTreeText(props.problems)` | 上游默认勾上 = 本仓现状，缺的只是那个复选框 ⇒ 请求 W4（`ProblemsPanel.vue` 是桶 2 名下） |
| pf/error-tree | 空表时给不给"No messages"那句 | **不适用（有具体理由）** | `IdeBundle.properties:130` `errortree.noMessages=No messages`（树的空态） | `src/errorTree.ts:87`（`lines.length ? … : ''`）；宿主 `src/components/ProblemsPanel.vue:576` 的「导出文本…」按钮 `:disabled="… \|\| !problems.length"` | 空表**根本点不动导出**，加了就是永远走不到的分支（写出来即死码）；上游那句是树视图的空态占位，不是导出文件的抬头 |
| pf/diagnostics / pf/troubleshooting / pf/audio-cues | 上一批已判定并落盘的族（错误对话框族、五条收集器、六个 cue 与三档设置页） | **未重复动**（本轮实测无新缺口） | 沿用上一批行号（本轮未重开这些上游类 ⇒ 不复述行号，避免抄错） | `src/components/InternalErrorsChip.vue`、`src/troubleshootingCollectors.ts`、`src/components/AudioCuesSettingsPage.vue`、`src/audioCues.ts` | 本轮在这三处只做了零消费方扫描（结论见 §5），没有新增行为；`FatalError` 进注册表仍卡在宿主（`src/App.vue` + 门禁），登记为请求 W5 |

---

## 2. 改动文件清单（`wc -l` 前 → 后）

| 文件 | 前 | 后 | 改了什麼 |
|---|---|---|---|
| `src/statusWidgets.ts` | 248 | 257 | 删 `bridge` 条目；表头「四条不是工厂」→「三条」并写完整判定留痕（本仓 16 个被消费 id + 上游十五条工厂 id 清单）；`widgetToggleRows` 注释里的四条→三条 |
| `src/statusBarWidgets.ts` | 183 | 185 | 删 `explicitlyDisabled()`；`shouldCreateWidget` 的注释接住上游那条闸（并订正行号 `:22`） |
| `src/statusBarText.ts` | 182 | 177 | 删 `statusTextManaged()` / `statusTextTimeSuffix()` 与模块状态 `timeText`（留痕说明它只服务过没读者的出口） |
| `src/backgroundTasks.ts` | 361 | 382 | 删 `runningSuspendedText`（声明/写入/出口）与 `currentSuspender`；`queueSuspendReason` 改 ref（缺陷 1）；`awaitResumed()` 补恢复路径（缺陷 2）；挂起那句措辞订正；模块头写协作式让路的实际现状 |
| `src/notificationEventLog.ts` | 116 | 139 | 新增 `EVENT_LOG_EMPTY_LINES`（上游两句 + 四处出处）与 `showsNoticeEmptyText()`（搜索中不给占位的那道闸） |
| `src/components/EventLogPanel.vue` | 270 | 277 | 空态改为渲染那两句（`v-for` + 各占一行）、`v-if` 走 `showsNoticeEmptyText(entries, query)`；删掉自造的两句中文；新增 `.eventlog-empty-line { display: block; }`（无裸 hex、无新动效、无全局选择器） |
| `tests/statusbar-popup-motion-parity.test.mjs` | 167 | 169 | `KNOWN_GAPS` 清空 + 表头第 1 条改为"现为空"；**两条断言体一字未动** |
| `tests/status-bar-widgets.test.mjs` | 120 | 122 | 清单四条→三条（含用例标题），留痕指向判定过程；`assert.equal(lines.length, 13)` 那条精确计数**未动**（本轮没增删工厂） |
| `tests/status-widgets-registry.test.mjs` | 101 | 118 | 清单四条→三条；新增「`bridge` 已删且不复活」一条（6 处精确断言：反查 undefined / 注册表无此行 / 勾选清单无 / `showWidget` false / 无搜索命中 / 存档残留键被丢） |
| `tests/notification-event-log-search.test.mjs` | 54 | 77 | 新增 2 条用例（模型两句整句相等 + 四档判据表；接线渲染与"自造文案已清"grep 级） |
| `tests/progress-queue-suspend.test.mjs` | **新建** | 81 | 3 条：对外状态精确清单（deepEqual 14 键）／挂起→恢复的行为端到端／那句文案只有一个拼装点 |

保留文件与别人名下文件：`src/App.vue`、`src/style.css`、`src/tokens.css`、`src/settingsTreeMeta.ts`、`src/bridge*.ts`、
`src/settingsModel.ts`、`src/keymap*.ts`、`CMakeLists.txt`、`package.json`、`native/main.cpp`、`src/problems*`、`src/search*`、
`src/gradleHost.ts`、`src/components/ProblemsPanel.vue` —— **本轮一个字没动**（只读过）。
`native/` 没改 ⇒ **不需要 ctest**。

`git diff --stat` 本轮这些文件合计 `+219 / -67`（注意：工作区是共享的，`src/components/EventLogPanel.vue` 与
`src/statusWidgets.ts` 的未提交 hunk 里还包含上一批 statusbar 的改动，所以我用 `wc -l` 前后对比来记本批净增行）。
逐文件 `git diff` 复核过：hunk 全是本轮的（`src/statusBarWidgets.ts` / `src/statusBarText.ts` / `src/backgroundTasks.ts` 的 diff 已目视核对）。

---

## 3. §5 每条自查命令的前后数字

| 跑什么 | 前（开工） | 后（收工） |
|---|---|---|
| `node --test tests/status-* progress-* notification-* notice-* error-tree* about*` | **152 / 152 / 0 失败** | **163 / 163 / 0 失败**（本批净增 6 条用例：registry 1 + event-log 2 + progress-queue-suspend 3；余 5 条是并行代理同期落在同前缀里的用例，实测也全绿 —— `git status tests/` 里 `notices / notice-actions / progress-notices / status-bar-lifecycle / lsp-progress` 都是别人的 hunk） |
| 派单整组再加 `statusbar-* audio* background-tasks memory-*`（本轮为验证队列改动必须跑到的） | `statusbar-popup-motion-parity` + `background-tasks` = **14 / 14** | 整组 **218 条 / 218 通过 / 0 失败**（`tests/status-* statusbar-* progress-* notification-* notice-* error-tree* about* audio* background-tasks memory-*`） |
| `node --test tests/module-size.test.mjs` | 5 条 **5 通过** | 5 条 **5 通过**（上限未动；我最大的是 `src/backgroundTasks.ts` 382 / `src/statusWidgets.ts` 257，都在 900 以内） |
| `npx vue-tsc -b --force` | **退出码 0、0 错** | **退出码 0、`error TS` 计数 0**（收工实测）。过程中两次采到**别人名下在途文件**的红，收工时都已被各自属主清掉：一次 `src/enterHandlers.ts(96) TS2305 'stringConcatFor'` + `src/workspaceInspection.ts(55) TS2339 'clear'`，一次 `src/pvFileUndoProvider.ts(208) TS2304 'UndoResult'` + `src/referenceContents.ts(13) TS2724 'visibleUsageGroupKeys'` ⇒ 留痕：**没有一条指向我名下的文件**（本轮每次收工前都单独 grep 过自己那批文件名，结果为空） |
| `node .tools/find-param-props.mjs` | —— | 共 **0** 处参数属性 |
| `node .tools/find-ts-in-mjs.mjs` | —— | 干净：`tests/*.mjs` 全部纯 JavaScript |
| `node .tools/find-missing-ext.mjs` | —— | 扫描 **1279** 个文件，**0** 处缺扩展名 |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记孤儿 9 / 基线 9 | 已登记孤儿 9 / 基线 9 · **新增 0** · 本轮清掉 0 ⇒ 绿（唯一新文件是 `tests/` 下的判据，不是模块） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | **11 / 11 通过** | **9 / 11**：2 条红指向我**没写过**的文档 —— 当时报的是 `docs/batch-2026-10-06-problems2.md` 里的 `platform/analysis-api/src/com/intellij/codeInsight/SuppressIntentionAction.java :19` 与 `platform/structure-view-impl/src/com/intellij/ide/structureView/StructureViewFactoryImpl.java :49-50`（两条假路径**故意在 `.java` 与冒号之间留一个空格**：规约 §5 写明引用门会把文档里**转述**的「路径:行号」当成一条真引用收集，加了行号的转述等于自己再制造一条红；去掉空格才是原样。参考树里没有这两个文件；开工时这条门是 11/11，红是并行 lane 之后落文档带进来的，同一对假路径先后被记到 `completion2`/`welcome2`/`problems2` 三份文档上）。**2026-10-06 citefix 复核并订正（见 `docs/batch-2026-10-06-citefix.md`）**：真路径分别是 `platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java:19`（该文件 98 行，第 19 行逐字为 `public abstract class SuppressIntentionAction implements Iconable, IntentionAction {`）与 `platform/structure-view-impl/src/com/intellij/ide/structureView/impl/StructureViewFactoryImpl.java:49-50`（该文件 186 行，49 = `public static final class State` 内的 `AUTOSCROLL_MODE = true`、50 = `AUTOSCROLL_FROM_SOURCE = false`）⇒ 只是包名各少一层，行号与内容都对。本轮我新增的每一条「路径:行号」都在门里过（门收的是整仓，属主不在我 ⇒ 交主代理分派，我不动别人的文档） |

---

## 4. 反向验证（注入违规 → 变红 → 撤掉 → 复绿）

1. **`bridge` 假控件的门禁**：往 `src/statusWidgets.ts` 的注册表注回
   `{ id: 'bridge', displayName: '桥接状态', factory: false }`（`KNOWN_GAPS` 保持为空）。
   → `node --test tests/statusbar-popup-motion-parity.test.mjs`：**7 条 / 6 通过 / 1 失败**，
   红的那条正是「注册表里没有新的死条目」，报错文案 = *bridge 在勾选清单里但状态栏模板不消费它 ——
   那是点了没反应的假控件*；再跑 `tests/status-bar-widgets.test.mjs` + `tests/status-widgets-registry.test.mjs`
   合跑：**15 条 / 14 通过 / 1 失败**（红的就是我新增的那条「`bridge` 已删」用例）。
   → 撤掉注入（Edit 删回那一行）：`tests/status-*` + `statusbar-*` **60 / 60 绿**。
2. **队列死出口的门禁**：往 `createBackgroundTaskQueue()` 的返回对象注回
   `runningSuspendedText: ref('')`。→ `node --test tests/progress-queue-suspend.test.mjs`：
   **3 条 / 2 通过 / 1 失败**（红在「对外状态是一份精确清单」，deepEqual 直接报出多出来的那个键名）。
   → 撤掉：同文件 **3 / 3 绿**。
3. **消息窗口空态的接线**：把 `src/components/EventLogPanel.vue` 的空态改回原样
   （`v-if="!sections.length"` + `{{ query.trim() ? '没有匹配的通知。' : '没有通知。' }}`）。
   → `node --test tests/notification-event-log-search.test.mjs`：**6 条 / 5 通过 / 1 失败**
   （红在「占位渲染的就是那两句，自造文案已清掉」，一条里三处断言都不放过）。→ 撤回：**6 / 6 绿**。
4. **两个真缺陷的"天然反向"**（不是我注入的，是先跑出来再修的，按 §5 记数字）：
   · 缺陷 1 修复前：`tests/progress-queue-suspend.test.mjs` 第二条红在
   `assert.ok(row, '挂起时队列必须补一行…')`（`actual: null`）；改成 `ref` 后 41/41 绿（与
   `tests/progress-*` + `background-tasks` + `notification-power-save` 合跑）。
   · 缺陷 2 修复前：同一用例红在 `恢复后任务走到下一个耗时点`（`beats` 实际 `['第一段']`，缺 `'第二段'`）；
   接上 `pending.then(() => this.resumeWaiters())` 后复绿。
   · 文案订正那两条的反向天然成立：旧值（自造两句）在新断言下必红，新值在旧断言下也红 —— 两边都是整句 / `deepEqual`。

---

## 5. 零消费方自查结论

- `node .tools/find-orphan-modules.mjs --gate`：**新增 0**（本轮没建新的 `src/*.ts` 模块）。
- 符号级（这才是派单 ① 的真问题）：对我整片可改面逐个扫了一遍
  （`src/status*.ts progress*.ts notice*.ts notification*.ts errorTree.ts errors.ts troubleshootingCollectors.ts
  audioCue*.ts memoryWidget.ts aboutInfo.ts backgroundTasks.ts` + 四个组件），
  把"导出但全仓（含测试）零引用"的**值**出口清了 4 条：
  `runningSuspendedText`、`currentSuspender`（`src/backgroundTasks.ts`）、
  `explicitlyDisabled`（`src/statusBarWidgets.ts`）、`statusTextManaged` + `statusTextTimeSuffix`（`src/statusBarText.ts`）。
- 复核后**判定保留**的两条（写在这里防止下一轮当死码清）：
  · `cancelCurrent`：被 `tests/background-tasks.test.mjs:52,69,134` 逐条使用，且
  `tests/progress-cancel-wait.test.mjs:90` 明确钉着「面板不该留两条取消路径」⇒ 它是**故意只给判据用**的那一档，不是死面；
  · `lspLogNoticeOf`（`src/progressNotices.ts:66`）：文件内两处真消费（`:121`、`:136`），只是没被外部引用，
  不是零消费方（本轮没动它，也没顺手 un-export —— 那是别人的用例锚点风险）。
- 本轮新增符号逐个都有消费者：`EVENT_LOG_EMPTY_LINES` / `showsNoticeEmptyText`
  ← `src/components/EventLogPanel.vue:16-17,231-232` 渲染 + `tests/notification-event-log-search.test.mjs` 判据；
  `queueSuspendReason` 由 `queueRow` / `setSuspended` / `isSuspended` / `pump` 四处消费。
- 队列对外状态现在有一份**清单门禁**（§1 表格里那条 deepEqual），死出口再回来必须先过它。

---

## 6. 做不到 / 无法核实（逐条具体卡点）

1. **`FatalError` 进状态栏勾选清单** —— 卡的仍是宿主：上游 `isConfigurable() = false`
   （`platform/platform-impl/src/com/intellij/openapi/wm/impl/status/FatalErrorWidgetFactory.java:33`）
   ⇒ 上游本来也不列；本仓芯片不走 `showWidget`（`src/App.vue:14` import、状态栏里直接渲染）
   ⇒ 补条目必红（`KNOWN_GAPS` 本轮已清空，不再给死条目放行）。要做得动 `src/App.vue`（保留）⇒ 请求 W5。
2. **`Messages` 弹窗宿主 / 通知设置页** —— 分别卡在 `src/App.vue`（保留）与
   `src/settingsTreeMeta.ts`（保留）+ `src/components/SettingsDialog.vue`（桶 7/8 名下）；
   新组件文件（`MessageDialog.vue` / `NotificationsSettingsPage.vue`）都不在我的可改前缀里 ⇒ 请求 W1 / W2。
3. **队列挂起的"正在跑的那条真的让路"** —— 卡在任务体：唯一入队消费者 `src/gradleHost.ts:203`
   的 `run` 没有 `indicator` 形参，`awaitResumed()` 打不进去（`src/gradleHost.ts` 不在我名下）⇒ 请求 W3；
   本轮只做两件事：把措辞改成不谎报、把检查点本身修到真能放行（缺陷 2）。
4. **导出文本的「Details」复选框** —— 卡在宿主 `src/components/ProblemsPanel.vue:521`（桶 2 名下）⇒ 请求 W4。
5. **`EditableMessageElement` / `HotfixGroupElement` / `ErrorTreeViewConfiguration` 的持久化与多视图**
   —— 上游侧本轮**已核实存在并给出行号**（`EditableMessageElement.java:29`、`HotfixGroupElement.java:18`、
   `impl/ErrorTreeViewConfiguration.java:15`），本仓侧做不到/不适用的理由见 §1 表格；
   硬做的结果就是无消费方的死模型（上一批同判，本轮换了"有行号"的依据）。
6. **`errortree.noMessages` 那句空态** —— 宿主把导出按钮在 `!problems.length` 时禁用了
   （`src/components/ProblemsPanel.vue:576`），所以那句中文在本仓**永远走不到** ⇒ 判 `不适用`，不做（§1 表格已记）。
7. **中文包不在参考树里的部分** —— 本轮界面文案取自
   `D:\IntelliJ IDEA 2026.2\plugins\localization-zh\lib\localization-zh.jar`（实测存在，
   `unzip -p … messages/IdeBundle.properties` 解出 `:1725/:1726` 两句）；
   该 jar **不是**派单 §1 的基准树，属"本机安装的本地化包"，所以两句都在注释里同时给了
   英文原值 + 中文包取值 + 键名，便于下一轮在别的机器上复核。
8. **上游 `NotificationsPanel.kt` 的逐行区间** —— 本轮只重开了 `:264-272`（空态两句）、`:425-445`
   （`startSearch`/`clearEmptyState`）、`:465-480`（`cancelSearch`/`setEmptyState`）、`:1105-1115`（⋮ 第一项的条件）；
   其余段落沿用上一批登记的行号，未逐行数过 ⇒ 本批没有引用它们。
9. **`AudioCuesSettingsPage.vue` / `NoticeList.vue` / `InternalErrorsChip.vue`** —— 本轮**没有改动**：
   零消费方扫描干净、上一批的判定（六个 cue、三档 select、芯片那句「内部错误」）本轮未重开上游类，
   故不复述其行号（避免把没核过的东西写成交付）。
10. **精确计数断言** —— 本轮没有放松任何一条：
    `tests/status-bar-widgets.test.mjs:104` 的 `assert.equal(lines.length, 13)`（真工厂 13 条）
    与 `tests/statusbar-popup-motion-parity.test.mjs:43` 的 `consumed.size >= 15` 都**原样保留**并通过；
    改动的两条清单（四条→三条）是"条目已不存在"的必然结果，断言形状（逐条 `match` / 逐条 `equal`）没变。
