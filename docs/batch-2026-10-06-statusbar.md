# 批次报告 · 2026-10-06 · 桶 statusbar（状态栏 / 进度 / 通知 / 诊断转储 / 音频提示）

接手现场：本轮派单是桶 6b 的续批（`docs/batch-2026-10-06-bucket6b.md` 已把状态栏一族接完）。
**开工第一跑**（`tests/status-* progress-* notification-* about* error-tree*`）= **146 条用例 / 145 通过 / 1 失败**，
红的是 `tests/progress-notices.test.mjs:74` 那条接线断言（锚点过时，见 §1 表格最后一行与 §3）。

两条**上游目录坐标订正**（派单给的路径在本地树里不存在，按 §1「按文件名搜不到 ≠ 不存在」各搜了三条路）：

- 派单写 `platform/ide-impl/src/com/intellij/openapi/progress/impl/` ⇒ 实际是
  **`platform/platform-impl/src/com/intellij/openapi/progress/impl/`**（实测该目录 14 个文件）。
- 派单写 `platform/ide-core/src/com/intellij/openapi/progress/` ⇒ 本地树里 `ide-core` 下**没有**这个目录；
  `ProgressIndicatorUtils` 一族实际在 **`platform/ide-core-impl/src/com/intellij/openapi/progress/util/`**
  （`BackgroundTaskUtil.java`/`PingProgress.java`/`ProgressIndicatorUtilService.java`/
  `ProgressIndicatorUtils.java`/`ReadTask.java`/`util.kt`），指示器基类在 `platform/core-api/src/com/intellij/openapi/progress/`。
- `pv/notification` 那一行**不在** `docs/inventory/verdict-platform_rest.md`，在
  **`docs/inventory/verdict-projectviews.md:35`**（本轮按那一条核）。

---

## 1. 判词表（族 / 项 / 判定 / 上游相对路径:行号 / 本仓落点 / 说明）

判定档位：**补齐**＝本轮做完并有判据；**订正**＝本轮把钉错/写错的文案或断言改对（都留了上游出处）；
**既有**＝上一轮已在磁盘、本轮逐条复核；**已闭环**＝上一轮的"接线"断点本轮实测已被属主接上；
**做不到**＝给具体卡点；**不适用**＝给具体理由。

| 族 | 项（判词里的「缺」） | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 一句话说明 |
|---|---|---|---|---|---|
| pf/statusbar（勾选清单与搜索命里的组件名） | 五个组件名是本仓自造说法，不是上游 `getDisplayName()` | **订正** | `platform/platform-api/resources/messages/UIBundle.properties:183/186/187/188/194`（英文原值）+ 中文包 `localization-zh.jar!messages/UIBundle.properties:267/269/268/264/263`；工厂本体 `PositionPanelWidgetFactory.kt:15`、`ColumnSelectionModeWidgetFactory.java:20`、`ReadOnlyAttributeWidgetFactory.java:21`、`NotificationWidgetFactory.java:24`、`MemoryIndicatorWidgetFactory.java:18` | `src/statusWidgets.ts:62-80`（表头逐条出处）、`:111,114,115,117,124`（五条改名） | 「光标位置→行:列号」「列选择→编辑器选择模式」「只读→只读特性」「通知中心→通知」「内存→内存指示器」；这些名字直接画在状态栏右键勾选清单与「显示 X」可搜索动作里，是用户可见文案 |
| pf/statusbar | 另外七条名字对不对？ | **既有（逐条复核，不改）** | `UIBundle.properties:184/185/201/193`（LineSeparator/Encoding/VfsRefresh/CodeStyle）、`InspectionsBundle.properties:327`（PowerSaveMode）、`plugins/git4idea/shared/resources/messages/GitBundle.properties:994`（git）、`LangBundle` 的 `language.services.widget`；中文包 `:262/258/274/255` + `InspectionsBundle:264` + `GitBundle:769` + `LangBundle:351` | `src/statusWidgets.ts:110,112,113,116,123,125,136` | 「行分隔符 / 文件编码 / 文件系统同步 / 缩进 / 省电模式 / Git 分支 / 语言服务」磁盘上就与上游一致，本轮**新增一条门禁**把它们一起钉住，防止以后被"顺手改顺"（`tests/status-widgets-registry.test.mjs:33-56`，`:28` 那条值也一起订正） |
| pf/statusbar | 上游 `NotificationWidgetFactory.isAvailable()` 那道闸（正常档不建这个组件） | **不适用（登记差异）** | `platform/platform-impl/src/com/intellij/notification/impl/widget/NotificationWidgetFactory.java:13-15,28-30,38-40`；通知区本体 `…/widget/IdeNotificationArea.java:46`（`WIDGET_ID = "Notifications"`） | `src/statusWidgets.ts:82-90`（差异登记） | 上游靠工具窗口条上的**通知区**承担日常可见性；本仓没有那条区（Event Log 是工具窗口内容 `src/components/ToolWindowView.vue:191`；本仓 `presentationMode` 直接把整条 footer 隐藏），照抄=默认配置下失去唯一收通知的入口 |
| pf/statusbar | `FatalError` 工厂要不要进注册表 | **做不到（要动保留文件 + 别人名下门禁）** | `…/status/FatalErrorWidgetFactory.java:23-24`（`status.bar.fatal.error.widget.name`）、`:33-39`（`isConfigurable()=false`）；中文包 `messages/UIBundle.properties:259`=「内部错误」 | 芯片在 `src/components/InternalErrorsChip.vue:2-3,46-53`（已按上游那句登记） | 芯片**已经**是上游那条组件的等价物且 `isConfigurable=false` ⇒ 上游也不进勾选清单；但本仓的显隐门禁 `tests/statusbar-popup-motion-parity.test.mjs:40-49` 要求注册表每个 id 都被 `App.vue` 以注册表每个 id 都被 `App.vue` 以 `showWidget('id')` 消费，而芯片不走 `showWidget` ⇒ 补它必须同时动 `App.vue`（保留）与那条门禁（不在我名下） |
| pf/statusbar | `bridge`（桥接状态）是勾选清单里的假控件 | **既有 + 登记请求** | 上游 `intellij.platform.ide.impl.xml:1618-1644` 那批工厂里没有对应物 | `src/statusWidgets.ts:108`；门禁 `tests/statusbar-popup-motion-parity.test.mjs:34-38`（`KNOWN_GAPS`） | 本轮实测 `App.vue` 消费的 16 个 id 里没有 `bridge` ⇒ 确实是假控件；删它要同步清那条 `KNOWN_GAPS`（同一批），而那个门禁文件不在我的可改面 ⇒ 写进 `docs/wiring-requests-2026-10-06-statusbar.md` 请求 3，本轮不动 |
| pv/notification | 状态栏那条 chip 的**提示文字**（tooltip） | **订正** | `…/widget/IdeNotificationArea.java:105-107`（`count > 0 ? tooltip : no.notification.tooltip`）；英文 `UIBundle.properties:189-190`；中文包 `messages/UIBundle.properties:265-266` | `src/notices.ts:66-79` | 上游只有「N 通知挂起」与「无新通知」两句；本仓原来那句「通知中心：最近 N 条，其中含错误」是自造的，且上游 tooltip 里**没有**「错误」这一档（严重度只用于图标上色，走 `noticeLevel`） |
| pv/notification | Event Log 搜索框：搜不到时的**当场报警** | **补齐** | `platform/platform-impl/src/com/intellij/notification/impl/ui/NotificationsPanel.kt:444-462`，报警那一句在 **`:461`**（`else LightColors.RED`）；空串分支 `:447-451` | `src/components/EventLogPanel.vue:48-55`（`searchHasNoMatch`）、`:159-165`（类绑定）、`:237`（`--error-bg` 那条） | 「列表变空」不等于「告诉你没搜到」：上游把报警底色画在框上；本仓走 `tokens.css:261` 的 `--error-bg`（不铺裸色，`--error` 在亮档会压掉输入文字）。裸 hex 由新增门禁反向钉住 |
| pv/notification | Event Log 搜索框：**Esc 取消过滤** | **补齐** | `NotificationsPanel.kt:197-203`（`preprocessEventForTextField`：`VK_ESCAPE` ⇒ `isVisible=false` + `cancelSearch()`）、`:471-476`（`cancelSearch`→`clearSearch`） | `src/components/EventLogPanel.vue:163-164`（`@keydown.esc.stop="query = ''"`） | 上游搜索框是 Ctrl+F 唤出、Esc 收起；本仓搜索框常驻（既有宿主差异，如实记），所以 Esc 兑现 `cancelSearch()` 那一半＝清空过滤器。**新判据**：`tests/notification-event-log-search.test.mjs`（4 条：2 条纯规则 + 2 条接线） |
| pv/notification | 「设置…」那条菜单项（上游 ⋮ 的第一条） | **做不到 → 请求** | `NotificationsPanel.kt:1109`（`isRegistered` 才给）、注册 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:966`（`NotificationsConfigurableProvider`） | `src/notificationEventLog.ts:88-91`（明确不渲染） | 本仓没有通知设置页 ⇒ 渲染就是假控件；数据侧（组表/声音开关/两张抑制表）都已在磁盘，缺的是宿主（`settingsTreeMeta.ts` 保留 + `SettingsDialog.vue` 非我名下）⇒ 请求 2 |
| pf/progress | 挂起-恢复的**生产触发**（6b 记的是"接线"） | **已闭环（本轮实测复核）** | `platform/lang-impl/src/com/intellij/ide/actions/TogglePowerSaveAction.java`、`PowerSaveModeNotifier.kt`（坐标沿用 6b，本轮未重开） | `src/App.vue:814-819`（`createNotifications({ …, projectRoot, powerSave })` 两项依赖都传了）、`:632-646`（`togglePowerSave` 里那句自制文案已删，注释指向通知链） | 6b 的两条断点都被 `appvue` 接上了 ⇒ 判词从"接线"升为已闭环，不用再派 |
| pf/progress | 「已挂起：<原因>」到底有没有画到面板 | **既有（本轮定位到真通道）** | `…/progress/impl/ProgressSuspender.java`（`getSuspendedText()`，坐标沿用 6b）、`platform/progress/shared/src/suspender/TaskSuspension.kt:15-28`（`Suspendable(suspendText)` 就是"进度条上解释为什么被暂停"的那句） | `src/backgroundTasks.ts:324-345`（`queueRow` 的挂起分支：`已挂起：…（正在跑的那条停在检查点上）`）→ `src/progressPanel.ts:71-73`（面板消费 `queueRow`） | 顺带核出一个**冗余出口**：`src/backgroundTasks.ts:154` 的 `runningSuspendedText` 只有 `:181` 写、`:246` 导出，**全仓零消费者**；那条文件本轮不在我可改面（派单没列 `backgroundTasks.ts`），如实报给主代理 |
| pf/progress | `ProgressSuspenderTracker` / `TaskToProgressSuspenderSynchronizer` | **部分（本仓只有一状态源）** | `platform/platform-impl/src/com/intellij/openapi/progress/impl/ProgressSuspenderTracker.kt:12-55`；`…/TaskToProgressSuspenderSynchronizer.kt:14-48`（`isStateChangeInProgress` 防回环的双向同步） | `src/progressSuspender.ts:134-173` | 上游那两个类解决的是"**两个状态源互相推**"（task 侧 pause ⇄ indicator 侧 suspend）；本仓唯一触发者是省电模式，由 `src/notifications.ts` 单向驱动，没有第二个源可回环 ⇒ 双向同步那半按不适用处理（不是省事：硬做就是要造一个假的第二状态源） |
| pf/progress | `InvisibleInStatusBarTask` | **不适用** | `platform/platform-impl/src/com/intellij/openapi/progress/impl/InvisibleInStatusBarTask.kt:15-17`（`@ApiStatus.Internal` **且 `@ApiStatus.Obsolete`** 的标记接口） | —— | 上游自己标了 Obsolete；本仓的"不在状态栏出现"由队列 `queueRow` 的条件决定，不需要一个标记接口 |
| pf/progress | `CheckCanceledEvent` / `ProgressTaskInfoEntityModel` / `TaskInfoEntityCollector` | **做不到** | `platform/platform-impl/src/com/intellij/openapi/progress/impl/`（本轮逐文件名点过：`CheckCanceledEvent.java`、`ProgressTaskInfoEntityModel.kt`、`TaskInfoEntityCollector.kt`） | —— | 三个都是 async profiler / 任务快照的宿主侧管道；本仓无 profiler 通道（与 6b 的 `CancellationCheck` 同一卡点：没有前端→宿主的日志写路由） |
| ici/progress | 上游 `…/progress/util/` 六个文件是否都判过 | **既有（本轮逐个点名）** | `platform/ide-core-impl/src/com/intellij/openapi/progress/util/`：`BackgroundTaskUtil.java`、`PingProgress.java`、`ProgressIndicatorUtils.java`、`ProgressIndicatorUtilService.java`、`ReadTask.java`、`util.kt` | `src/progressTasks.ts`（`BackgroundTaskUtil`/`PingProgress`/`ConcurrentTasksProgressManager`）、`src/backgroundTasks.ts:145,305-318`（`ProgressIndicatorUtils` 的等待/超时） | 前四个都有落点；`ReadTask`/`ProgressIndicatorUtilService` 沿用 6b 的做不到（JVM 读写锁 + DI 容器）；**`util.kt` 本轮未逐行读 ⇒ 无法核实**，不编结论 |
| pf/error-tree | ①可编辑消息 ②修复组 ③跨任务持久化/多视图 ④Swing 渲染 | **做不到 / 既有（沿用 6b，本轮重开本仓侧确认无新缺口）** | 6b 已标"无法核实（未重开该类）"；本轮重开的是**本仓**`src/errorTree.ts`（全文 95 行） | `src/errorTree.ts:23`（`ourMessagesOrder` 五档固定顺序）、`:64-71`（组头/行文案）、`:80-88`（`details=false` 只留组头）、`:91-95`（导出文件名） | 消费链仍是问题面板的「导出文本…」（`src/components/ProblemsPanel.vue`）；本轮**未新增**任何错误树结构（加了就是无消费方的死模型） |
| pf/diagnostics | 错误对话框/聚类；「芯片只列时间+消息」 | **既有（复核上游目录）** | `platform/platform-impl/src/com/intellij/diagnostic/`（本轮 `ls`：`ErrorMessageCluster.kt`、`ErrorMessageClustering.kt`、`IdeErrorsDialog.kt`、`IdeErrorsIcon.java`、`DialogAppender.kt`、`FreezeProfiler.java`、`GcPauseWatcher.kt`、`EventWatcherService.java`、`EditMemorySettingsDialog.kt`…） | `src/errorReport.ts`、`src/components/InternalErrorsDialog.vue`、`src/components/InternalErrorsChip.vue:2-3`（「内部错误」那句 = 中文包 `messages/UIBundle.properties:259` ✓） | 目录里除冻结/转储/上报/内存设置那几族外都已落；`EditMemorySettingsDialog`/`VMOptions` 仍不适用（宿主不是 JVM） |
| pf/troubleshooting | `ProjectTroubleInfoCollector`（6b 记的是"接线"） | **已闭环（本轮实测复核）** | `platform/platform-impl/src/com/intellij/ide/troubleshooting/ProjectTroubleInfoCollector.java:11-18`（坐标沿用 6b） | `src/App.vue:1452`（`projectContext: () => workspace.value ? { name, root, trusted: isProjectTrusted(…) } : null`） | 「复制排障信息」里的 `Project trusted:` 那一段已经有真输入了 |
| pf/troubleshooting | 收集器**全集**到底是几条、本仓缺哪几条 | **订正 + 部分做不到** | `ls platform/platform-impl/src/com/intellij/ide/troubleshooting/` = `AboutTroubleInfoCollector.java`、`CompositeGeneralTroubleInfoCollector.java`、`DisplayInfo.kt`、`DisplayTroubleInfoCollector.java`、`GCTroubleInfoCollector.kt`、`PluginTroubleInfoCollector.java`、`ProjectTroubleInfoCollector.java`、`SystemTroubleInfoCollector.java`、`DimensionServiceTroubleInfoCollector.kt` | `src/troubleshootingCollectors.ts:130-137`（第五条 Project）+ 前四条 | 判词那句「本仓是内置四条」过时（磁盘上五条）；上游全集是 **7 个真收集器**（About/System/Display/Plugin/Project/GC/DimensionService），本仓已覆盖 5 个，剩两个是数据面缺口：GC（JS 无 GC MXBean，做不到）；DimensionService 需要"列出已存对话框尺寸"的出口，而 `src/dialogGeometry.ts:29,59,70` 只有按单个键读写的三个函数、**没有枚举口**，那两个键的属主是桶 7 的 `ProjectDialog.vue`/`SpecialPathsDialog.vue` ⇒ 要做第六条得先动 `src/dialogGeometry.ts` 与 `src/helpActions.ts`（都不在我名下） |
| pf/audio-cues | 「设置页只有 off/on、逐 cue 复选框未接界面、字段未登记」 | **订正（判词过时，本轮第三次确认）** | `platform/platform-impl/src/com/intellij/ide/audioCues/IdeAudioCues.kt:12-33`（六个 cue）与 `:37-40`（`IdeAudioCueProvider` 列出的也正是这六个）；面板 `…/audioCues/AudioCuesConfigurable.kt:36-60` | `src/components/AudioCuesSettingsPage.vue:69-73`（**三档** select）、`:46`（`enabledIf(mode != OFF)`）、`:82-92`（逐 cue 复选框 + 勾选/键盘聚焦试听）、`src/audioCues.ts:44-49`（六条 id/优先级 20/30/40/50/130/140） | 上游 cue 集合**就是 6 条**，本仓不多不少逐字对齐；该族剩下的唯一差异是 WebAudio 合成音替代 `sounds/*.wav`（上游 `IdeAudioCues.kt:13` 等行的第三个参数），既有替代、本轮未动 |

**本轮没有再核的上游类**（沿用 6b 的登记，不重复抄行号）：`PowerSaveModeNotifier.kt`、`TogglePowerSaveAction.java`、
`NotificationsManagerImpl.java`、`RemindLaterManager.kt`、`NotificationsBeeper.kt`、`DoNotAskManager.kt`、
`NotificationSettingsUi.kt`、`ProgressSuspender.java` 的逐行区间。

---

## 2. 改动文件（`wc -l` 前后）

| 文件 | 前 | 后 | 改了什么的 |
|---|---|---|---|
| `src/statusWidgets.ts` | 221 | 248 | 表头补 27 行逐条 bundle 证据（含 `isAvailable()` 差异登记）；5 条 `displayName` 按上游中文取值订正（`:107-113`） |
| `src/notices.ts` | 110 | 117 | `noticeTitle()` 换成上游那两句 + 出处注释 |
| `src/components/EventLogPanel.vue` | 256 | 270 | `searchHasNoMatch` 计算属性、`:class` 绑定、输入框 `@keydown.esc.stop`、`.eventlog-search.no-match` 一条样式（`--error-bg`/`--error`，无裸 hex、无新动效） |
| `tests/notification-event-log-search.test.mjs` | **新建** | 54 | 4 条判据（2 纯规则 + 2 接线） |
| `tests/status-widgets-registry.test.mjs` | ≈75 | 101 | `position` 那条值订正；新增「勾选清单里那个名字是上游 bundle 取值」一条门禁（5 条订正 + 7 条本来就对的） |
| `tests/notices.test.mjs` | ≈93 | 102 | tooltip 用例改成上游两句的形状，并新增"含错误也不改提示文字、`noticeLevel` 仍算得出"这一条 |
| `tests/notice-actions.test.mjs` | ≈116 | 125 | 三处订正：tooltip 整句匹配、`notifyFailure` 三档标签链、进度结论三档标签链（**意图不变**，见 §3） |
| `tests/progress-notices.test.mjs` | ≈88 | 92 | 那条钉过时的两档形状改成磁盘上的三档整链（仍精确 match） |
| `tests/status-bar-lifecycle.test.mjs` | ≈144 | 146 | 「显示 <组件名>」那条用例里的期望值随注册表一起订正 |

保留文件（`src/App.vue`/`style.css`/`tokens.css`/`settingsModel.ts`/`settingsTreeMeta.ts`/`bridge*.ts`/
`CMakeLists.txt`/`tests/module-size.test.mjs` 等）**一个字没动**；`src/problemsView.ts`、`CodeEditor.vue`、
`src/terminal*`、`src/dbg*` 没碰；`native/` 没改 ⇒ **不需要 ctest**。

---

## 3. 三条断言的"钉错了形状/值"论证（§3 要求：不许放松，必须给上游理由）

1. `tests/progress-notices.test.mjs:80` 与 `tests/notice-actions.test.mjs:113-114`
   —— 钉的是 `job.kind === 'dependencies' ? '依赖加载' : undefined` 与
   `… 'Gradle 同步' : '依赖加载', error)`。磁盘上（`src/gradleHost.ts:519-521`）已是**三档**：
   桶 15 给 `kind === 'task'` 也补了「任务运行」。⇒ **形状过时、意图未变**
   （"每条命令的失败与结论都经过同一个出口、各带自己的中文标签"）。改成仍精确的整链 match，
   **没有**放松成 `includes`，**没有**删断言（反而多钉了一条标签）。
2. `tests/notice-actions.test.mjs:81` 与 `tests/notices.test.mjs:30-38` —— 钉的是本仓自造的 tooltip
   「通知中心：最近 N 条，其中含错误」。上游 `IdeNotificationArea.java:105-107` 只有两句
   （中文包 `:265-266`），且上游 tooltip 里没有「错误」这一档 ⇒ 原值是**钉错了值**，按上游订正为整句精确匹配。
3. `tests/status-widgets-registry.test.mjs:28` 与 `tests/status-bar-lifecycle.test.mjs:90` —— 钉的是
   `光标位置`。上游 `status.bar.position.widget.name` 英文 = "Line:Column Number"
   （`platform/platform-api/resources/messages/UIBundle.properties:183`）、中文包 = 「行:列号」
   （`messages/UIBundle.properties:267`）⇒ 钉错了值，订正后仍是 `assert.equal`/整句 `some(===)`，**没放松**。

---

## 4. §5 自查：每条命令的前后数字

| 跑什么 | 前（开工） | 后（收工） |
|---|---|---|
| `node --test tests/status-*.test.mjs tests/progress-*.test.mjs tests/notification-*.test.mjs tests/about*.test.mjs tests/error-tree*.test.mjs` | **146 / 145 通过 / 1 失败**（红＝`progress-notices:74` 锚点过时） | —— |
| `node --test tests/status-* progress-* notification-* notice-* about* error-tree* tests/module-size.test.mjs`（派单那一组 + `notice-*`，因为我动了 tooltip） | —— | **162 条 / 162 通过 / 0 失败** |
| 同一组拆两半复跑（CPU 被 12 路并行压满时防超时） | —— | `status-* about* error-tree* module-size` **67/67**；`notice-*`（含 actions/notices）**38/38** |
| `node --test tests/module-size.test.mjs` | 5 条 **5 通过**（6b 报的那条 `SearchPanel.vue(903)` 已由桶 9 清掉） | 5 条 **5 通过**（我的文件都在限内：`statusWidgets.ts` 248 / `notices.ts` 117 / `EventLogPanel.vue` 270 / 新测试 54） |
| `node --test tests/ui-motion.test.mjs`（= 桶 6b 请求 3 登记的那条他人域门禁红） | —— | **11 条 / 11 通过 / 0 失败** ⇒ 那两条 offenders（`DebugInspectWindow.vue:172` 桶 12、`RefactorPreviewDialog.vue:156` 桶 1）**已由属主清掉**，这条请求可以关闭 |
| `npx vue-tsc -b --force` | 6b 报的是 `customFoldingProviders.ts(48,103) TS1002` 挡掉全树 | **退出码 0、零输出 = 0 错**（基线一致）⇒ 桶 7b A5-3 关闭 |
| `node .tools/find-param-props.mjs` | —— | 共 **0** 处参数属性 |
| `node .tools/find-ts-in-mjs.mjs` | —— | 干净：`tests/*.mjs` 全部纯 JavaScript |
| `node .tools/find-missing-ext.mjs` | —— | 扫描 **1262** 个文件，**0** 处缺扩展名 |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记孤儿 9 / 基线 9 | **已登记孤儿 9 / 基线 9 · 新增 0 · 本轮清掉 0 ⇒ 绿** |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | —— | **11 / 11 通过**（本轮新增的所有「路径:行号」都在门里过；`NotificationsPanel.kt:458-459` 我最初抄错、按磁盘重数改成 `:461`，共 4 处，留痕见 §6） |
| `node --test tests/b7-verdict.test.mjs`（治理类 A5-1 的冻结核） | —— | **10 / 10 通过**（四档计数没被冲掉） |

---

## 5. 反向验证（新门禁的三步数字）

新门禁 = `tests/notification-event-log-search.test.mjs` 里那两条**接线**用例（前两条是纯规则，本来就有实现）。

1. 注入违规（两处一起）：`src/components/EventLogPanel.vue` 的 `:class="{ 'no-match': searchHasNoMatch }"`
   → `{ 'no-match': false }`（类不再跟随判据）；输入框上的 `@keydown.esc.stop="query = ''"` **整段删掉**。
   → `node --test tests/notification-event-log-search.test.mjs`：**4 条用例 / 2 通过 / 2 失败**
   （红的正是「零命中把报警底色画在搜索框上」与「Esc 清空过滤器」两条）。
2. 撤销违规（`cp` 回备份并删临时文件 `build/eventlog.bak`）：重跑 **4 / 4 通过 / 0 失败**；
   `grep -c "no-match" src/components/EventLogPanel.vue` = **2**（计算属性 + 类绑定都回来了），
   `git diff --stat` = `18 ++++++++++++++++--, 1 file changed, 16 insertions(+), 2 deletions(-)`（全是我这次的 hunk）。
3. 文案订正那两条的"反向"天然成立：旧值（`光标位置`、`通知中心：最近 N 条`）在新断言下必红，
   新值在旧断言下也红 —— 两边都是**整句/等值**比较，没有 `includes` 化的余地。

---

## 6. 零消费方自查

- `node .tools/find-orphan-modules.mjs --gate`：**新增 0**（本轮没建新的 `.ts` 模块；唯一新文件是 `tests/` 下的判据）。
- 本轮新增的**符号**逐个查了消费方：`searchHasNoMatch` 只被同文件的模板用（Vue 组件内部，正常）；
  `noticeTitle` 的消费点在 `src/App.vue` 的 `:title="noticeTitle(noticeLog)"`（既有，未改）。
- 复核出的**既有**冗余出口（不是本轮造的，也没在我可改面）：`src/backgroundTasks.ts:154` 的
  `runningSuspendedText`（`:181` 写、`:246` 导出，全仓零消费者）；挂起状态实际由 `queueRow`
  （`:324-345`）画到面板。⇒ 记在这里，交给 `backgroundTasks.ts` 的属主收口（要么删，要么让面板改读它）。
- 现场订正记录（§1 已用）：桶 6b 的两条"接线"（`App.vue` 的 `powerSave`/`projectRoot` 与 `projectContext`）
  本轮实测**已被接上**；桶 6b 请求 3 的两条 ui-motion offenders **已被各自属主清掉**；
  桶 7b A5-2 说 `scripts/verdict_table.py` 未跟踪 —— 实际**已被跟踪**（`git ls-files` 命中、状态 ` M`）；
  桶 7b A5-3 的那条 TS1002 —— 实际**已清**（vue-tsc 0 错）。

---

## 7. 做不到 / 无法核实（逐条给具体卡点）

1. **`FatalError` 工厂进注册表** —— 卡点不是"要不要"，是**门禁形状**：
   `tests/statusbar-popup-motion-parity.test.mjs:40-49` 要求注册表每个 id 都被 `App.vue` 以
   `showWidget('<id>')` 消费；本仓内部错误芯片是组件（`InternalErrorsChip.vue`，自带 `active` 条件），
   不走 `showWidget` ⇒ 补条目必红，而那个门禁文件与 `App.vue` 都不在我可改面。
2. **`bridge` 假控件的收口** —— 同上：删条目（我名下）+ 清 `KNOWN_GAPS`（不在我名下）必须同一批，
   分两处动就会留一条红 ⇒ 完整改法写在 `docs/wiring-requests-2026-10-06-statusbar.md` 请求 3。
3. **通知设置页** —— 卡在 `src/settingsTreeMeta.ts`（保留）与 `src/components/SettingsDialog.vue`（非我名下）；
   新组件文件（`src/components/NotificationsSettingsPage.vue`）也不在我的可改前缀里 ⇒ 请求 2。
4. **`DimensionServiceTroubleInfoCollector` 等价物** —— 缺的是**数据面**：`src/dialogGeometry.ts` 没有
   "列出已存尺寸"的出口（只有 `dialogGeometryKey:29` / `loadDialogSize:59` / `saveDialogSize:70`），
   键的属主在桶 7 的两个对话框里；注入点 `src/helpActions.ts` 也不在我名下。
5. **`TaskToProgressSuspenderSynchronizer` 的双向同步** —— 需要一个"第二状态源"才会生效；
   本仓唯一源是省电模式（单向）⇒ 按不适用处理，硬做=造一个假源。
6. **`CancellationCheck` / `CheckCanceledEvent` / `ProgressTaskInfoEntityModel` / `TaskInfoEntityCollector`**
   —— 沿用 6b：要 registry 键 + 前端→宿主的日志写路由（`native/main.cpp` 与 `src/bridge.ts` 都是保留文件）。
7. **上游 `util.kt`（`platform/ide-core-impl/src/com/intellij/openapi/progress/util/util.kt`）** ——
   本轮**未逐行读 ⇒ 无法核实**它有没有用户可见的那一半；不编结论。
8. **`AudioCuesConfigurable.kt` 的逐行区间** —— 本仓面板按 6b 登记的 `:27-61` 落位；本轮只重开了
   `IdeAudioCues.kt:12-40`（cue 全集=6 条这一条）与磁盘侧的页面，**没有**重数 `AudioCuesConfigurable.kt` 的行号。
9. **`NotificationsConfigurable.java` 的控件表** —— 找到了文件（`impl/NotificationsConfigurable.java`），
   但本轮**没有逐行数它的控件清单** ⇒ 请求 2 里只给了注册证据（`intellij.platform.ide.impl.xml:966`）
   与数据侧出口，页面结构留给做那一页的代理按上游类补做（避免我编一份控件表）。
10. **精确计数断言（「真工厂应有 13 条」）** —— 本轮**没有新增任何工厂**：改动全部落在已有条目的
    `displayName` 上，行的形状 `{ id: '…', … factory: true, upstreamId: '…' }` 一字未动 ⇒
    `tests/status-bar-widgets.test.mjs:104` 的 `assert.equal(lines.length, 13)` **仍是 13、仍精确**
    （收工跑过该文件：`tests/status-*` 那一组 67/67 绿），没有改成范围、没有删、也没有登记豁免。
    顺带核到 `src/statusWidgets.ts:107-113` 里 `smartMode` 与 `lspServices` 共用同一个
    `upstreamId: 'LanguageServiceStatusBarWidget'`（6b 那轮的取舍，被 `:112,117` 钉住），本轮不放松、不重复登记。
