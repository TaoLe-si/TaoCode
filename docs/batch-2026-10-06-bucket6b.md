# 批次报告 · 2026-10-06 · 桶 6b（状态栏 / 进度 / 通知 / 诊断转储）

接手现场：桶 6a 的代理撞到调用上限被切断。主代理实测 `tests/status-widgets-registry.test.mjs` 与
`tests/about.test.mjs` 那两条基线红**已经绿**（本轮开工前跑 `node --test tests/ui-motion.test.mjs`
之外，第一轮域测试 195/195 全绿）⇒ 本轮没有红要修，做的是**任务 1 的动效违规**与**任务 2 的族缺口**。

---

## 0. 任务 1 · `tests/ui-motion.test.mjs` 的 hover 违规（before / after）

判据：`interactive 的 :hover 改了背景/颜色/透明度就必须有 transition`（`tests/ui-motion.test.mjs:224`）。

**before（本轮开工第一步实测，4 条 offenders）**

```
src/components/DebugInspectWindow.vue:172  .debug-inspect-row:hover（底规则 .debug-inspect-row）
src/components/EventLogPanel.vue:231       .eventlog-row:hover（底规则 .eventlog-row）
src/components/EventLogPanel.vue:250       .eventlog-suppressed-row:hover（底规则 .eventlog-suppressed-row）
src/components/RefactorPreviewDialog.vue:156 .refactor-preview-row:hover（底规则 .refactor-preview-row）
```

**改动**（只动底规则、只走 `src/tokens.css` 的 `--dur-1` / `--ease`，照 `src/style.css:254` `.icon-button`
与 `:320` `.activity-button` 的既有写法；**没有**新增按压/淡入，负责人反对自加动效）：

- `src/components/EventLogPanel.vue:231` `.eventlog-row { … transition: background-color var(--dur-1) var(--ease); }`
- `src/components/EventLogPanel.vue:250` `.eventlog-suppressed-row { … transition: background-color var(--dur-1) var(--ease); }`

（任务书只点名 `:179` 的 `.eventlog-row:hover`，实测门禁把同文件那条
`.eventlog-suppressed-row:hover` 也一起报了 —— 两条都在我名下的组件里，一起清掉。
`:179` 是模板里的行号，样式块在 231/250。）

**after（2 条 offenders，都不是我名下，未动）**

```
src/components/DebugInspectWindow.vue:172  .debug-inspect-row:hover（底规则 .debug-inspect-row）      ⇒ 桶 12
src/components/RefactorPreviewDialog.vue:156 .refactor-preview-row:hover（底规则 .refactor-preview-row） ⇒ 桶 1
```

`tests/ui-motion.test.mjs` 结果：11 条用例 **10 通过 / 1 失败**，失败的就是这条 offenders 断言
（期望 `[]`、实际是那 2 条）。**没有为了让门禁变绿而改门控本体**（`tests/ui-motion.test.mjs` 一个字没动）。

---

## 1. 判词表（族 / 项 / 判定 / 上游依据 / 本仓落点 / 说明）

判定档位：**补齐**＝本轮做完并有判据；**既有**＝上一轮已在磁盘上、本轮逐条复核；**接线**＝代码在
生产模块里、只差保留文件那一行（写进 `docs/wiring-requests-2026-10-06-bucket6b.md`）；**做不到**＝给具体卡点。

| 族 | 项（判词里的「缺」） | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |
|---|---|---|---|---|---|
| pf/progress | 挂起-恢复（`ProgressSuspender`/`ProgressSuspenderTracker`/`TaskToProgressSuspenderSynchronizer`）的**生产触发** | **补齐 + 接线** | `platform/lang-impl/src/com/intellij/ide/actions/TogglePowerSaveAction.java:20-25`；`…/PowerSaveModeNotifier.kt:17-22,29-57`；`platform/progress/shared/src/suspender/TaskSuspension.kt:24-28` | `src/notifications.ts:228-246`（挂载）、`src/notifications.ts:46`（新依赖 `powerSave`）、`src/notificationPowerSave.ts:102-133`、`src/backgroundTasks.ts:225-241`（既有 `setSuspended`） | 上一轮写完的 `progressSuspender.ts`/`notificationPowerSave.ts` 是全仓零消费者的死模块；本轮把挂载做进 `src/notifications.ts`（我名下），并补上游缺的**第二个动作「不再显示」**与**模式再变就 expire** 那两条。输入源 `editorSettings.powerSaveMode` 在 App.vue ⇒ 请求 1 |
| pf/progress | `BackgroundableProcessIndicator` 那种「每条后台任务一条独立可取消进度行」 | 既有（复核） | `platform/platform-impl/src/com/intellij/openapi/progress/impl/BackgroundableProcessIndicator.java:31`（`extends ProgressWindow`，一条任务一个窗口） | `src/progressPanel.ts:52-104`（逐行 `cancellable`）、`src/progressPanel.ts:22`（`{ task }` / `{ lsp }` 跟着那一行自己的回调）、`src/backgroundTasks.ts:305` | DOM 等价物 = 状态栏「后台任务」那一列的每一行带自己的取消回调，已成立 |
| pf/progress | `CancellationCheck` | **做不到** | `platform/platform-impl/src/com/intellij/openapi/progress/impl/CancellationCheck.kt:11-19`（要 registry 键 `ide.cancellation.check.enabled` / `.threshold`(500ms) / `.trace.all` 才开）、`:31-45`（唯一的产出是 `LOG.error("… last checkCanceled was N ms ago")`） | —— | 两个具体卡点：① 本仓没有 registry / internal mode 通道；② 它唯一的可见面是**写一条宿主 ERROR**，而前端→宿主的日志路由不存在（`native/main.cpp:1452-1472` 只有 `app.logPaths`/`app.internalErrors` 这些**读**向路由，没有 `app.log`/`app.error`；`src/bridge.ts:109` 的 `Method` 联合类型也没有）。补它要动 `native/main.cpp` + `src/bridge.ts`（两个保留文件） |
| pf/progress | `BridgeTaskSupport`/`BridgeTaskSuspender`/`PlatformTaskSupport` 跨端任务桥 | 做不到（复核） | 本仓 `native/` 是单进程宿主（`native/main.cpp` 一个窗口一个消息循环）；上游那三个类是给 Swing 侧与协程侧接线的 | —— | 架构不成立：本仓任务体就是 JS Promise，没有"跨端"这一层 |
| ici/progress | `ProgressIndicatorUtils` 的**等待/超时** + 「取消只有两条路」 | **补齐** | `platform/ide-core-impl/src/com/intellij/openapi/progress/util/ProgressIndicatorUtils.java:310-341`（`withTimeout`：到点只 cancel 指示器、由计算自己停在 PCE；超时返回 null）、`:357-395`（`awaitWithCheckCanceled`：等待期间仍然听取消） | `src/backgroundTasks.ts:145`（`CANCEL_WAIT_TIMEOUT_MS = 5000`）、`:305-318`（`cancelCurrentAndAwait`）、`:160-162`（`cancellingEntry`/`cancellingTitle`）、`:320-330`（面板那一行「正在取消：…」）、`src/progressPanel.ts:148-154`（等不到收尾就 `ctx.notify('后台任务没有响应取消，仍在运行。', true)`） | 用户可见面：点「取消」→ 那一行变成「正在取消：X（等任务体走到下一个取消检查点）」；任务真的收尾后行自动消失；超过 5s 没收尾 → 一句真话通知。顺手修掉一个真 bug：挂起期间 `clear()` 后 `pump()` 会拿着 `queue.shift()` 的 `undefined` 往下走（`src/backgroundTasks.ts:201` 的 `if (!queue.length) break`） |
| ici/progress | `runInReadActionWithWriteActionPriority` / `ReadTask` | 做不到（复核） | `ProgressIndicatorUtils.java:62,79-141`（`forceWriteActionPriority`、`scheduleWithWriteActionPriority(ReadTask)`、读写锁抢占） | —— | JS 单线程没有读写锁模型；本仓唯一对应"让路"的真实信号是省电模式，已按上一条做成队列挂起（`src/progressSuspender.ts` 头注 `:28-38` 同一结论） |
| ici/progress | `ProgressIndicatorUtilService` 的服务面 | 做不到 | `ProgressIndicatorUtils.java:162-165`（`ProgressIndicatorUtilService.getInstance(application).runActionAndCancelBeforeWrite(…)`） | —— | 那是 DI 容器 + `ApplicationEx` 的服务注册面；本仓没有容器（§2 明确不照抄 DI） |
| pf/error-tree | ① 可编辑消息元素（`EditableMessageElement`/`NewErrorTreeEditor`） | 做不到（复核） | 无法核实（本轮未重开该类；上一轮已按只读诊断判过） | —— | 本仓诊断来自 LSP/编译器输出，只读；就地改消息文本没有场景 |
| pf/error-tree | ② 修复组（`HotfixGroupElement`/`FixedHotfixGroupElement`） | 做不到（复核） | 无法核实（本轮未重开） | —— | 上游的 hotfix 组是"随插件更新下发的修复"，本仓没有 hotfix 分发通道；修复走 codeAction |
| pf/error-tree | ③ 跨任务持久化与多视图 | 做不到（复核） | 无法核实 | `src/errorTree.ts`（既有：`ourMessagesOrder` 分桶、`getPresentableText`、`ErrorViewTextExporter` 文本导出） | 本仓问题表是会话内派生数据，语言服务重推即整体替换 |
| pf/error-tree | ④ Swing 渲染本体 | 既有降级 | —— | `src/components/ProblemsPanel.vue`（行渲染 + 「导出文本…」消费 `src/errorTree.ts`） | DOM 版本承担 |
| pf/diagnostics | 错误对话框与聚类（`IdeErrorsDialog`/`ErrorMessageClustering`/`ReportMessages`） | 既有（复核） | `platform/platform-impl/src/com/intellij/diagnostic/ErrorMessageClustering.kt:29`（`clusterMessages()`）、`:34`（`groupBy { if (deduplicateReports) hashMessage(it) else it }`）、`:60`（`DEDUPLICATE_REPORTS = "ide.errors.deduplicate"`）、`:69`（`isDeduplicationEnabled`） | `src/errorReport.ts:52`（`clusterInternalErrors`）、`:27`（同一个键名）、`src/components/InternalErrorsDialog.vue:56-70`（簇列表 + `clusterIndexLabel`/`clusterInfoLabel`）、`:36-40`（复制全部簇） | 判词说"芯片只列时间+消息"已过时：对话框与聚类在上一轮落地，有判据（`tests/error-tree.test.mjs` 引 `errorReport`）。**上报渠道仍然没有**（本仓不收集不外传） |
| pf/diagnostics | 冻结/性能监视（`FreezeProfiler`/`EventWatcherService`/`GcPauseWatcher` 等） | 做不到 | `platform/platform-impl/src/com/intellij/diagnostic/`（本轮未逐类重开）；结论沿用判词并补一条具体理由 | —— | 具体卡点：上游那套的产物是 **EDT 停顿的栈转储 + FUS 事件上报**（`PerformanceWatcherImpl`/`IdeaFreezeReporter`）。本仓 UI 线程可以用 `PerformanceObserver('longtask')` 探到停顿，但**没有栈回溯通道**（见下一条）、**没有上报通道**，探到之后只能显示一句"卡了" —— 那是自加装饰而不是还原功能，按 §3 不放假控件处理 |
| pf/diagnostics | 线程转储（`ThreadDumpService`/`PreciseEventWatcher`） | 做不到 + **订正判词** | —— | `native/crash_log.cpp:77`（`MiniDumpWriteDump(process, GetProcessId(process), handle, MiniDumpWithThreadInfo, …)`）、`:129`（`CaptureStackBackTrace(0, frames, stack, nullptr)`）、`:66`（注释：abort 路径上进程内取栈实测拿到 0 帧） | 判词那句「`StackWalk64`/`MiniDumpWriteDump` **未做**」不准确：`MiniDumpWriteDump(MiniDumpWithThreadInfo)` 已在致命崩溃路径上用起来了。仍然缺的是**对活着的进程按需做逐线程栈回溯**（要 `EnumProcessModules`+`SuspendThread`+`StackWalk64` 那一套），本轮没做：它不是用户可见功能缺失，而是缺一个 native 能力，且要做就得新增 native 文件 + 动 `CMakeLists.txt`（保留文件） |
| pf/diagnostics | 日志级别配置（`LogLevelConfigurationManager`/`LogCategory`/`JsonLogHandler`） | 做不到 | 本轮未重开该类（无法核实其入口） | `native/diagnostics.cpp:95`（`void event(profile, level, message, …)` —— 级别是**调用点写死的**，没有可写的阈值） | 具体卡点三条：① 需要一条 `app.logLevel` 读写路由（在 `native/main.cpp`，保留文件）；② `src/bridge.ts:109` 的 `Method` 联合要加名字（保留文件）；③ 界面挂点要么在 `SettingsDialog.vue`（不是我名下）要么在 `EventLogPanel.vue` —— 但上游的日志级别配置**不在通知面板里**，挂那儿是我在编位置，按 §3 不放假控件 |
| pf/diagnostics | 低内存/堆分析、Windows Defender 集成、隐私/自动上报 | 做不到 / 有意不做（复核） | —— | —— | 宿主是 C++ 进程没有可调堆上限；Defender 排除项提示是 JetBrains 专有；本仓不收集遥测 ⇒ 三条都不动 |
| pf/troubleshooting | `ProjectTroubleInfoCollector` 的受信任状态段（"收集器没有项目上下文注入"） | **接线**（代码已在生产模块，缺 App.vue 一行） | `platform/platform-impl/src/com/intellij/ide/troubleshooting/ProjectTroubleInfoCollector.java:11-13`（`getTitle()="Project"`）、`:16-18`（`"Project trusted: " + TrustedProjects.isProjectTrusted(project)`） | `src/troubleshootingCollectors.ts:41-45`（`ProjectTroubleContext`）、`:130-137`（第五条收集器 `Project trusted:`）、`src/trustedProjects.ts:73`（`isProjectTrusted`）；断点在 `src/App.vue:1467`（没传 `projectContext`，`src/helpActions.ts:38` 已有那一项依赖） | 判词说"本仓是内置四条"已过时：磁盘上是**五条**。请求 2 给的就是这一行 |
| pf/troubleshooting | `GCTroubleInfoCollector` / `DimensionServiceTroubleInfoCollector` / `TroubleInfoCollector` EP | 做不到（复核） | —— | `native/diagnostics.cpp:202-235`（宿主排障文本：版本/时间/平台/进程内存/日志文件/配置目录/程序目录/JDK/特殊目录） | JS 没有 GC MXBean；对话框尺寸持久化服务（`src/dialogGeometry.ts`，桶 7）没有消费方；EP 是插件贡献点，本仓没有插件注册表 |
| pv/notification | `NotificationGroup` 注册体系（`NotificationGroupManager`/`NotificationGroupEP` 按组决定显示方式） | 既有 + **本轮补一条** | `platform/ide-core/src/com/intellij/notification/NotificationGroup.kt:18-23`（沿用上一轮登记）；本轮实核：`platform/platform-impl/resources/intellij.platform.ide.impl.xml:1802`（`<notificationGroup id="Power Save Mode" displayType="BALLOON" bundle="messages.IdeBundle" key="notification.group.power.save.mode"/>`） | `src/notificationGroups.ts:119-131`（新增 "Power Save Mode" 组，BALLOON）、`:169`（`power.save.mode` → 该组）、`:142`（`showsBalloon`）、`src/notifications.ts:56-58`（组决定要不要占用气球） | 判词那句"本仓没有组概念"已过时（上一轮已落地）；本轮补的是**漏登记的那一组**，并把 displayId 认进组里 |
| pv/notification | `NotificationRouter` 与 `DoNotAskManager`（按项目路由 + 不再询问） | 既有 + **接线** | `platform/ide-core/src/com/intellij/notification/DoNotAskManager.kt:10-18,29-34`（沿用上一轮登记） | `src/notificationDoNotAsk.ts`（应用级/项目级两张表）、`src/notifications.ts:33-35`（`projectRoot` 依赖）；断点在 `src/App.vue:841`（没传 `projectRoot`） | 「不再为此项目显示」的菜单条目在 `src/notificationEventLog.ts:28`；但 App.vue 不传根 ⇒ 项目级那张表永远查不到。请求 1 一并解决 |
| pv/notification | 气球的存在时长（`balloonFadeoutMs` 只有测试在读、生产链上是空的） | **补齐** | `platform/platform-impl/src/com/intellij/notification/impl/NotificationsManagerImpl.java:446-449`（`int delay = displayType == STICKY_BALLOON ? 300000 : 10000;` → `startSmartFadeoutTimer(delay)`）、`:445-450` + `:461-463`（`frameActivateBalloonListener`：`if (ApplicationManager...isActive()) callback.run()` ⇒ 窗口不在前台不起表）；`platform/ide-core/src/com/intellij/notification/NotificationDisplayType.java`（枚举本体，本轮按文件名+包路径两条路都找到了） | `src/notifications.ts:86`（`if (balloon) armBalloonFadeout(entry.id, group?.displayType ?? 'BALLOON')`）、`:120-172`（`armBalloonFadeout` / `clearBalloonFadeout` / `:hover` 复查 / `visibilitychange` 起表）、`:52-54`（`balloonDelayMs` 依赖，默认退回 `balloonFadeoutMs`）、档位表 `src/notificationGroups.ts:148` | 用户可见：普通气球 10 秒后自己收、Gradle 那类 STICKY_BALLOON 300 秒、指针停在气球上时不收（上游 `startSmartFadeoutTimer` 的 "smart"），界面在后台时不倒计时；**气球 fade 掉不等于通知被收掉** —— `noticeLog` 那条留在通知中心（与上游"气球消失、通知进 Event Log"同一形状）。没有加任何淡入淡出动画，只收状态（负责人反对自加动效） |
| pv/notification | Event Log 工具窗口的历史列表 | 既有（复核） | `NotificationsPanel.kt:581,595-599,1106-1143,1115`（本轮未重开，沿用上轮登记，行号在我读过的组件注释里） | `src/components/EventLogPanel.vue`（段标题/时间线/建议/⋮ 菜单/「不再询问通知」小节）+ `src/notificationEventLog.ts` | 本轮只动了它的两条 transition（任务 1） |
| pv/notification | `NotificationsBeeper` 声音提示 | 既有（复核） | `NotificationsBeeper.kt:12-16` | `src/notificationBeeper.ts:83-133` + `src/notifications.ts:66`（进通知中心时按组响一声） | 按组、默认关 |
| pv/notification | `RemindLaterManager`「稍后提醒」 | 既有（复核） | `platform/platform-impl/src/com/intellij/notification/impl/RemindLaterManager.kt:35-41,66,115-117,119-171,177-212` | `src/notificationDoNotAsk.ts:166-215` + `src/notifications.ts:194-204`（启动支 + 运行中支都接上） | 判词那句"只有启动那一支"已过时 |
| pf/audio-cues | 设置页只有 off/on、逐 cue 复选框未接界面、`audioCuesDisabled` 未登记进设置模型 | **既有（判词过时，订正）** | `IdeAudioCues.kt` 一族（沿用上一轮）；本轮逐条核磁盘出口 | `src/settingsModel.ts:141`（字段）与 `:201`（默认 `[]`）、`native/settings_schema.cpp:167`（默认档）与 `:217`（校验）、`src/bridgePreview.ts:270,301-306`、`src/components/AudioCuesSettingsPage.vue:44,54`、`src/audioCueHost.ts:90`、挂载点 `src/components/SettingsDialog.vue:36,1015` | 三档 mode + 逐 cue 复选框 + 设置登记**都已经在**（见请求文档最后一节的逐条出口）。剩下的只有"用 WebAudio 合成音替代上游 `sounds/*.wav`"这一条既有替代，本轮没动 |

---

## 2. 改动文件

**新增**

- `tests/notification-power-save.test.mjs`（187 行，7 条用例：3 条纯规则 + 3 条**行为**用例直接驱动
  `createNotifications` + 1 条接线断言）
- `tests/progress-cancel-wait.test.mjs`（91 行，6 条用例：协作式取消的等收尾 / 超时返回 false /
  空队列空操作 / 取消回调只调一次 + 队列继续 / 面板接线）
- `tests/notification-balloon-fadeout.test.mjs`（107 行，5 条用例：BALLOON 10 秒收 + 通知留在中心 /
  STICKY_BALLOON 活得比 BALLOON 久 / 下一条顶替时旧定时器作废 / 界面在后台不起表（假 `document` 驱动
  `visibilitychange`）/ 接线断言）

**修改**

- `src/components/EventLogPanel.vue` — `:231`、`:250` 两条底规则各加
  `transition: background-color var(--dur-1) var(--ease)`（任务 1；无新动效）
- `src/notificationPowerSave.ts` — 重写头注（逐行核对上游 `PowerSaveModeNotifier.kt` 与
  `TogglePowerSaveAction.java`，订正上一轮的两处不准：① 触发点有两个不是"只在开档动作"，
  ② 它有两个动作不是"只有一个"）；新增 `POWER_SAVE_DO_NOT_SHOW_ACTION`、`IGNORE_POWER_SAVE_MODE`、
  `powerSaveNoticeSuppressed`/`suppressPowerSaveNotice`/`unsuppressPowerSaveNotice`、
  `powerSaveTransition(previous, next)`、`POWER_SAVE_SUSPEND_REASON`；`powerSaveNotice` 改为
  「先不再显示、后禁用省电模式」两个按钮且没有关闭通道时只给前者；`shouldNotifyPowerSave` 现在也看抑制开关
- `src/notifications.ts` — `+46`（新依赖 `powerSave`）、`:228-246`（挂载：发通知 / expire / 队列挂起与恢复）、
  `+24-26`（import）、`+52-54`（新依赖 `balloonDelayMs`）、`:86`（`notify()` 给气球起表）、
  `:120-172`（`armBalloonFadeout` / `clearBalloonFadeout` / `visibilitychange` / `:hover` 复查）、
  `+16`（import `balloonFadeoutMs` 与 `NotificationDisplayType`）
- `src/notificationGroups.ts` — `+119-131`（"Power Save Mode" 组，BALLOON）、`+169`（displayId → 组）
- `src/backgroundTasks.ts` — `+145`、`:78`（`QueueEntry.done`）、`:160-162`、`:201`（bug 修复）、
  `:265-271`（`run()` 把入队 Promise 同时做成"真的收尾"信号）、`:305-318`（`cancelCurrentAndAwait`）、
  `:320-330`（`queueRow` 的「正在取消」分支）
- `src/progressPanel.ts` — `:148-154`（取消改走等收尾那条路 + 超时通知）
- `tests/background-tasks.test.mjs` — `:143` 一条**形状断言**过时（写死 `backgroundTaskQueue.cancelCurrent()`），
  按 §7 改成仍精确的 `backgroundTaskQueue.cancelCurrentAndAwait()`，**意图不变**（取消接到队列、不发宿主请求）

保留文件（`App.vue`/`style.css`/`tokens.css`/`settingsModel.ts`/`bridge.ts`/`CMakeLists.txt`/门禁本体）**一个字没动**。
native 没改 ⇒ 不需要 ctest。

---

## 3. 验证

| 跑什么 | 结果 |
|---|---|
| `node --test tests/status*.test.mjs tests/progress*.test.mjs tests/notification*.test.mjs tests/audio*.test.mjs tests/background-tasks.test.mjs tests/error-tree.test.mjs tests/troubleshooting-collectors.test.mjs tests/internal-errors.test.mjs tests/notices.test.mjs tests/notice-actions.test.mjs tests/about*.test.mjs` | **223 / 223 通过，0 失败**（开工时同一组是 195 条；本轮净增 28 条用例 = 7 省电 + 6 取消等收尾 + 5 气球时长 + 其余为并行代理落地的同族用例） |
| 消费方全扫（`grep -rl "notifications.ts\|backgroundTasks.ts\|notificationGroups.ts\|progressPanel\|statusBarText" tests/*.mjs` 命中的 17 个测试文件） | **197 / 197 通过，0 失败** |
| `node --test tests/ui-motion.test.mjs` | 11 条用例 **10 通过 / 1 失败**；offenders 从 4 条降到 2 条，**EventLogPanel 那 2 条已消失**（剩下两条属桶 12 / 桶 1，未动） |
| `node --test tests/module-size.test.mjs` | 5 条 **4 通过 / 1 失败**，失败原因是 `src/components/SearchPanel.vue(903 行)` ⇒ **桶 9，不在我名下**。我的新/改文件都在 900 以下（`notificationPowerSave.ts` 135、`notifications.ts` 251、`backgroundTasks.ts` 359） |
| `npx vue-tsc -b --force` | 全仓 **1 条错误**：`src/customFoldingProviders.ts(48,103): error TS1002: Unterminated string literal.`（不是我名下，我没碰）。**但这条错误把 build 模式的语义检查整片挡掉了**：我往里注入了一条真类型错误（`const __probe: number = 1 as unknown as string`）做反向验证，vue-tsc **照旧只报那一条 TS1002** ⇒ 现在这条命令**不能**用来证明任何文件零类型错误（已撤掉注入）。改用不带项目构建的单文件检查取证：`npx tsc --noEmit --target es2022 --module esnext --moduleResolution bundler --strict --skipLibCheck --allowImportingTsExtensions src/notifications.ts src/notificationPowerSave.ts src/backgroundTasks.ts src/notificationGroups.ts src/progressPanel.ts src/errorTree.ts` ⇒ **我名下 0 条错误**（这一轮它先抓出我写死 `let timer = 0` 的 `TS2322: 'Timeout' is not assignable to 'number'`，已改成 `ReturnType<typeof setTimeout> \| null`，同 `src/statusBarText.ts:105` 的写法） |
| `node .tools/find-param-props.mjs` | 共 **0** 处参数属性 |
| `node .tools/find-ts-in-mjs.mjs` | 干净：`tests/*.mjs` 全部是纯 JavaScript |
| `node .tools/find-orphan-modules.mjs --gate` | **红**：3 个新增零消费方模块 `src/editorCodeBlock.ts`、`src/editorJoinComments.ts`、`src/externalSystemDataStorage.ts` —— **都不是我名下**。我这侧的变化：`src/notificationPowerSave.ts` 从"零消费者"变成有生产消费者（`src/notifications.ts`），`src/aboutInfo.ts`、`src/statusBarLifecycle.ts` 被工具列为「已接上（可以更新基线）」⇒ 基线更新留给主代理（`.tools` 不是我的文件） |
| `git diff` 自查 | `notifications.ts`(+97) / `progressPanel.ts`(+57) 是我的 hunk；其余新/改文件是未跟踪状态（`git diff` 不显示），逐条按行号自核 |

**新门禁的反向验证**（§6.4，两条都做了）

1. 注入违规：`src/notifications.ts` 的 `if (powerSave) {` → `if (false && powerSave) {`（挂载不生效）；
   `src/backgroundTasks.ts` 的 `cancelCurrentAndAwait` 末尾 `return finished` → `return true`（谎称取消成功）。
   → `node --test` 两条新文件：**4 条用例变红**
   （「开省电：发那条通知 + 队列挂起」「关省电：收掉并恢复；不再显示后不再发」「『禁用省电模式』接的是关闭通道」
   「任务不理取消：等到超时返回 false…」），确认门禁不是空转。
2. 注入违规（第三轮，气球时长那条）：`src/notifications.ts` 的 `if (balloon) armBalloonFadeout(entry.id, …)`
   → `if (false && balloon) …` ⇒ `tests/notification-balloon-fadeout.test.mjs` **3 条用例变红**
   （BALLOON 按时收 / STICKY 活得久 / 后台不起表）。第一版的接线断言只钉 `armBalloonFadeout\(entry\.id`，
   被这个 `if (false && …)` 骗过没红 ⇒ 当场把它收紧成 `if \(balloon\) armBalloonFadeout\(entry\.id`（钉意图不是钉形状），
   再注入一次确认那条也跟着红，然后撤销。
3. 撤掉全部违规（`cp` 回备份）后重跑：`return finished` / `if (powerSave)` / `if (balloon) armBalloonFadeout`
   各 1 处，223/223 与 197/197 全绿。

**过程中的两条现场记录（不是我改坏的，如实报）**

- `src/backgroundTasks.ts` 与 `src/notifications.ts` 在本轮中途都出现过"工具返回的文件内容与磁盘不一致"的
  过期视图（一次显示 `Indicator` 没有 suspender、一次显示 `createNotifications` 没有 powerSave 依赖，
  还有多次把 `src/progressPanel.ts` 回退成改前版本）。
  两次都用 `grep` 直接核磁盘确认我的 hunk 还在，之后每次编辑前重读、编辑后 `git diff`/`grep` 自查。
  **没有**执行这些视图里附带的任何说明性内容。
- 顺手修掉一个真 bug：队列被挂起期间调用 `clear()`，`pump()` 醒来会拿 `queue.shift()` 的 `undefined` 往下走
  （`TypeError: Cannot read properties of null (reading 'cancelledBeforeStart')`，由我的新用例抓到）
  ⇒ `src/backgroundTasks.ts:201` 的 `if (!queue.length) break`。

---

## 4. 做不到 / 无法核实（逐条给具体卡点，不写"太复杂"）

1. **`CancellationCheck`**（pf/progress）—— 上游唯一产出是 `CancellationCheck.kt:41` 那条 `LOG.error`，
   而它要求 registry 键（`:14-16`）+ 一条前端→宿主的日志写路由。后者在本仓不存在
   （`native/main.cpp:1452-1472` 的 `app.*` 全是读向；`src/bridge.ts:109` 的 `Method` 没有 `app.log`），
   补它要动两个保留文件。⇒ 写在这里，不偷偷做半个。
2. **日志级别配置**（pf/diagnostics）—— 三条卡点见判词表：`native/main.cpp` 路由、`src/bridge.ts` 的
   `Method`、以及**上游配置日志级别的面板不在我名下**（`SettingsDialog.vue` 不是我名下；
   挂到 `EventLogPanel.vue` 是我在编位置，违反 §3）。`native/diagnostics.cpp:95` 的 `event(profile, level, …)`
   级别由调用点写死，没有可读写的阈值状态。
3. **线程转储 / 冻结剖析**（pf/diagnostics）—— 缺"对活进程逐线程栈回溯"的 native 能力
   （崩溃路径已有 `MiniDumpWriteDump(MiniDumpWithThreadInfo)`，见 `native/crash_log.cpp:77`，这是对判词的**订正**）；
   探测结果的上游去向是 FUS 上报，本仓无上报通道。
4. **`ProgressIndicatorUtils` 的读写动作优先级 / `ReadTask` / `ProgressIndicatorUtilService`**（ici/progress）——
   JVM 读写锁 + DI 服务面，JS 单线程不成立；本仓用「队列挂起-恢复」承接了它面向用户的那一半（见判词表第一行）。
5. **`EditableMessageElement` / `NewErrorTreeEditor` / `HotfixGroupElement`**（pf/error-tree）——
   诊断只读 + 没有 hotfix 分发通道；本轮**未重开这些类**，行号标"无法核实"，判定沿用上一轮。
6. **省电模式挂起后台任务队列 = 本仓架构的承接，不是上游逐行等价**：在本地树按
   `isPowerSaveMode()` / `PowerSaveMode.isEnabled()` 搜后台任务队列/索引的读者**一条命中都没有**
   （⇒ 上游的省电档只关代码洞察）。本仓做挂起的理由是那句正文「代码洞察和后台任务已禁用。」
   （中文包 `messages/IdeBundle.properties:2028`）必须成真；差别与理由写在
   `src/notificationPowerSave.ts:36-49` 的头注里。
7. **`action.Anonymous.text.do.not.show.again` 的中文取值**已本轮亲自解包核对
   （`localization-zh.jar` 的 `messages/IdeBundle.properties:63` =「不再显示」）；
   `:1661/:2027/:2028/:2029` 四条也一并核对，与上一轮登记一致。
8. **本轮未逐行重开的上游类**（判词表里标"沿用上一轮登记 / 无法核实"的）：
   `NotificationGroup.kt`、`DoNotAskManager.kt`、`NotificationsPanel.kt`、`RemindLaterManager.kt`、
   `NotificationsBeeper.kt`、`BackgroundableProcessIndicator.java`（只核了 `:31` 的类声明）、
   `NotificationsAnnouncer.kt`。它们的**本仓出口**我逐条查了（都在磁盘上、都有判据），
   但没重复抄它们的行号。
