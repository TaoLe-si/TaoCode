# 交付 · 2026-10-06 · 桶 status3（状态栏 / 通知 / 诊断域 + 问题视图域的请求收尾）

派单：逐条复核 6 份接线请求 → 组件/模块侧能闭环的闭环掉 → 特别核两件事 → 交本报告 + 更新后的请求文档。
保留文件（`src/App.vue`、`src/bridge.ts`、`src/style.css`、`src/tokens.css`、`src/settingsModel.ts`、
`CMakeLists.txt`、`scripts/verdict_table.py`、`docs/inventory/*`）**本轮一个字没动**；
不 commit、不 push、没跑任何丢弃类 git 命令。上游基准树 =
`D:\Backup\Downloads\intellij-community-master\intellij-community-master`，下文每条上游坐标都是本轮亲自打开的。

---

## 1. 判词表（6 份请求逐条）

| 族 / 项 | 判定 | 上游相对路径:行号（本轮实读） | 本仓落点文件:行号（本轮实测） | 一句话说明 |
| --- | --- | --- | --- | --- |
| statusbar 请求 1 · `Messages`/`messageDialog` 宿主 | `[ ]` 仍缺 | `platform/platform-api/src/com/intellij/openapi/ui/Messages.java`（`showYesNoDialog` 一族返回 int）、`platform/ide-core/src/com/intellij/openapi/ui/MessageDialogBuilder.kt:19` | `src/App.vue` grep `messageDialog\|showMessage\|MessageHost` ⇒ **0 命中**；`src/components/MessageDialog.vue` **不存在**；唯一消费者仍是 `src/components/TrustedProjectDialog.vue` | 模型在 `src/messageDialog.ts`，宿主还是没有 ⇒ 请求有效；**锚点已漂**：`TrustedProjectDialog` 的挂载现在是 `src/App.vue:2646`（原写 2622）、`createProgressPanel` 的 import 在 `src/App.vue:124`、调用在 `:636`（原写 623）；import 锚 `:41` 仍对 |
| statusbar 请求 2 · 通知设置页 | `[ ]` 仍缺 | `platform/platform-impl/resources/intellij.platform.ide.impl.xml:966`、`platform/platform-impl/src/com/intellij/notification/impl/NotificationsConfigurable.java` | `src/settingsTreeMeta.ts` grep `notification` ⇒ **0 命中**；`src/components/NotificationsSettingsPage.vue` 不存在；`src/notificationEventLog.ts:111-112` 仍如实不渲染「设置…」 | 数据侧齐、缺宿主 ⇒ 请求有效（连带效果仍然成立） |
| statusbar 请求 3 · `bridge` 假控件 | `[x]` **已闭环** | `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1618-1644`（工厂清单里没有"桥接状态"） | `src/statusWidgets.ts`：`bridge` 只剩 `:25-36` 的留痕注释（注册表里已无该条）；`tests/statusbar-popup-motion-parity.test.mjs:40` ⇒ `const KNOWN_GAPS = new Map()`（空） | status2 那批两处同批做完了；本轮 `tests/status-widgets-registry.test.mjs`「`bridge` 已删」那条绿 ⇒ 关闭 |
| statusbar 请求 4 · 治理 3 条 | `[-]` 不在本域 | — | `scripts/verdict_table.py` 已被跟踪（上一批实测） | 4.1 的 `.gitignore` 白名单、4.2/4.3 都归主代理/别的 lane，本轮未重复核 |
| status2 W1 · `Messages` 宿主 | `[ ]` 仍缺 | 同上 | 同上 + 新锚点 | 与 statusbar 请求 1 同一条，指向可照抄段（`docs/wiring-requests-2026-10-06-statusbar.md:29-86`） |
| status2 W2 · 通知设置页 | `[ ]` 仍缺 | 同上 | 同上 | 与请求 2 同一条 |
| status2 W3 · Gradle 同步任务体缺挂起检查点 | `[ ]` 仍缺 | `platform/platform-impl/src/com/intellij/openapi/progress/impl/ProgressSuspender.java:154`（`freezeIfNeeded`）、`platform/progress/shared/src/suspender/TaskSuspension.kt:24-28` | `src/gradleHost.ts:207` ⇒ `run: async () => { await sync() },`（逐字仍在，整块 `:204-208`） | `src/gradleHost.ts` 不在我的可改面 ⇒ 已在请求文档里给**逐字 old/new**（本轮实测的缩进也写了） |
| status2 W4 · 导出文本的「详情」勾选 | `[x]` **本批闭环** | `ErrorViewTextExporter.java:21`（`myCbShowDetails`）、`:27`（键 `checkbox.errortree.export.details`）、`:28`（`setSelected(true)` ⇒ 缺省勾上）、`:38-40`（`getSettingsEditor`）、`:56`（选中值当 `withUsages` 传下去）、`:77-78`（false 时跳过每条消息）；文案键 `platform/platform-api/resources/messages/IdeBundle.properties:143` = `Details` | `src/components/ProblemsPanel.vue:516-519`（`exportDetails`）、`:546`（`errorTreeText(props.problems, { details: exportDetails.value })`）、模板 `:603`（工具栏那颗复选框）；判据 `tests/problems-export-text-details.test.mjs`（6 条） | **组件侧 + 宿主都在我名下 ⇒ 这条不用接线了**。原请求写的行号（`:521`/`:513-524`）已漂，本轮按实测更新 |
| status2 W5 · 内部错误芯片进勾选清单 | `[ ]` 仍缺 | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/FatalErrorWidgetFactory.java:33`（`isConfigurable()=false`） | `src/App.vue:2297` 仍是直接渲染 `<InternalErrorsChip …>`，没有 `showWidget('fatalError')` | 上游本来也不列进勾选清单 ⇒ 维持"不动"也可接受；若动必须两处同批（`tests/statusbar-popup-motion-parity.test.mjs:40` 的 `KNOWN_GAPS` 现在是空的，不会再为死条目放行） |
| status2defect W1 · 判词「本仓任务不能暂停」过期 | `[ ]` 仍缺 | `platform/progress/shared/src/suspender/TaskSuspension.kt:24-25`、`ProgressSuspender.java:121`、`TaskInfoEntityCollector.kt:174` | `scripts/verdict_table.py:348`（1 处命中）、`docs/inventory/verdict-platform_rest.md:171`（1 处命中） | 两个保留文件的字符串**逐字仍在** ⇒ 请求有效，行号本轮复核为 `:348` / `:171`（与原写一致） |
| status2defect W2 · 挂起原因的显示源（`text()`/`suspendedText` 零消费） | `[ ]` 仍缺 | `ProgressSuspender.java:106-110`（`getSuspendedText()` 只服务任务那一行） | `src/progressSuspender.ts:48`（`readonly suspendedText`）、`:52`（`text: () => string`）、`:86`（实现）；`src/backgroundTasks.ts:364-367` 的 `queueRow` 只读 `queueSuspendReason.value` | 本轮全仓 `grep "suspender\.text"` ⇒ **0 命中** ⇒ 死面仍在。给了**可照抄的 new**（`src/backgroundTasks.ts:367` 那一行的逐字 old 在本报告附的块里，缩进照磁盘） |
| status2defect W3 · tracker 三条零消费 | `[ ]` 仍缺 | `ProgressSuspenderTracker.kt` 的批量接口只服务 `TaskToProgressSuspenderSynchronizer`（本仓没做那条双向同步，见 W1 的"还差"） | `src/progressSuspender.ts:150-152`（`suspended()`）、`:154-156`（`suspendAll()`）、`:158-160`（`resumeAll()`）—— 三个名字在全仓只命中定义那几行 | 结论不变：要么删要么写清理由；`src/progressSuspender.ts` 不在我的可改面 |
| problems R1 · `relatedInformation` 透传 | `[ ]` 仍缺 | `platform/lsp-impl/src/impl/features/highlighting/LspDiagnosticAndLazyQuickFixes.kt:42`（宿主原样保留这一格） | `native/lsp_support.cpp:148-149` 仍只带 `code`/`tags`，`:149` 之后无 `relatedInformation`；`src/bridge.ts:118` 的 `LspDiagnostic` 仍无 `related`/`codeDescriptionHref` | 前端消费链（`src/problems.ts`、`src/problemRelatedInformation.ts`、面板行菜单那一节）都在原地等数据 ⇒ 请求有效 |
| problems R2 · 状态栏「按检查项」芯片 | `[ ]` 仍缺 | `platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml`（Group by Inspection 那一档） | `src/App.vue:2297` 的 `status-right` 里没有 `unusedDeclarationCount`/第二枚 problems 芯片 | 数据面早就有（`src/inspectionIdentity.ts`、`problemCounts`、`inspectionItems`），只缺宿主 ⇒ 目标仍是保留文件 |
| problems R3 · 面板「操作」菜单接 Alt+Enter | `[ ]` 仍缺（组件侧已备好） | `platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml:100-103`（`use-shortcut-of="ShowIntentionActions"`） | 组件侧：`src/components/ProblemsPanel.vue:310` ⇒ `defineExpose({ openMenuForSelected })`（原写 `:274-289`，本轮实测在 `:302-310`）；宿主侧：`src/App.vue:2239` 的挂载**没有** `ref`；`src/actionRegistry.ts` / `src/keymapBindings.ts` grep `problems.view.quickFixes` ⇒ **0 命中** | 三处都还在保留文件/别人名下；请求有效，本轮把组件侧锚点订正为实测行号 |
| problems R4 · 面板焦点态抛给状态栏 | `[ ]` 仍缺（组件侧已备好） | `platform/problemsView/.../ProblemsViewState.kt:20-33`（没有这个字段 ⇒ 会话内，不落存档） | 组件侧：`src/components/ProblemsPanel.vue:89`（`focusChange` 声明）、`:131`（抛出）；宿主侧：`src/App.vue:2239` 没有 `@focus-change`，也没有 `problemsFocus` | 同上；请求里的挂载行号从 2214 漂到 **2239**，本轮订正 |
| problems R5 · `native/diagnostics.cpp` / `src/diagnosticsPanel.ts` 路径改正 | `[-]` **前提变了 ⇒ 关闭** | 表里 6 条「实测存在的位置」上一批已逐条 `test -f` 命中 | 本轮复核：`src/diagnosticsPanel.ts` **不存在**（`ls` 无命中）；`native/diagnostics.cpp` 全文是 `idea.log` 等价物，四个探针名全仓 0 命中 | 代码改动量 = 0，不是"做不到"而是"没有那个东西"；文档里 problems2 的订正块已经写清 ⇒ 不再挂待办 |
| problems2 W1 · 高亮缓存注册表 + semanticTokens 分桶 | `[ ]` 仍缺 | `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCacheRegistry.kt:26-35`、`LspPublishDiagnosticsCache.kt:31`、`LspClientImpl.kt:223/:235/:260/:398` | `src/lspHighlightingCache.ts`（无注册表）、`src/lspNavigation.ts`（唯一实例化点）、`src/components/CodeEditor.vue`（两个 `let`）—— 三个目标文件都不是我的可改面 | 整段可照抄代码仍然有效；**本轮该文件正在被 lsp lane 改**（收工时 `src/lspNavigation.ts:320-321` 有语法错 ⇒ 见 §3），更要同批落地 |
| problems2 W2 · 重启时清整工程检查缓存 | `[x]` 已闭环（上一批自证） | `LspClientImpl.kt:398`（`highlightingCacheRegistry.clearCache()`） | `src/lspPerFileCache.ts:39-55`、`src/lsSessionHost.ts:163`、`src/lspProgress.ts:181-187`、`src/workspaceDiagnostics.ts:168,172-176` | 遗留的只有 `workspaceDiagnosticIds` 那张表没人清（保留文件里的一行 watch）⇒ 仍挂在原请求末尾 |
| problems2 W3 · 提醒 R1 仍挂着 | `[ ]` 仍缺 | 同 problems R1 | 同 problems R1 | 随 R1 |
| prob3 R1 · 状态栏严重度计数改读 `problemCounts` | `[ ]` 仍缺 ⇒ **本批钉成门禁** | `platform/lang-impl/src/com/intellij/codeInsight/daemon/impl/TrafficLightRenderer.kt:383`（`severity.getCountMessage(count)`，计数取自 `status.errorCounts`，不是 UI 里再 `filter`）、`platform/analysis-api/src/com/intellij/lang/annotation/HighlightSeverity.java:176` | `src/App.vue:2297` 仍是 `{{ allProblems.filter(p => p.severity === 1).length }} 错误` + `…=== 2… 警告`；`problemCounts` 的生产消费方仍只有面板（`src/components/ProblemsPanel.vue:208`） | 请求的 import 锚 `src/App.vue:90`（`import { allProblems } from './problems'`）**逐字仍对**；新增 `tests/problem-count-single-source.test.mjs`（3 条）把"第二把尺"钉住：**再多一处就红、R1 落地后不摘登记也红** |
| prob3 R2.1 · `dm/highlight` 那条「code/tags 不透传」 | `[ ]` 仍缺（措辞要按实测改） | 见 problems R1 那条 | `docs/inventory/verdict-daemon.md:31` 仍写着「`relatedInformation` 不透传，而 `LspDiagnostic` 类型在禁改文件 `src/bridge.ts:109`」 | 两点：① `relatedInformation` 这半句**今天仍然是真的**（本轮实测 `native/lsp_support.cpp:148-149` 只到 code/tags）；② 句子里的 `src/bridge.ts:109` **行号陈旧**，本轮实测 interface 在 `:118`。原请求"已透传"那半句只针对 code/tags，措辞请照此收窄 |
| prob3 R2.2 · `dm/problems-view` 分组维度与三开关 | `[ ]` 仍缺 | `platform/lang-impl/src/com/intellij/analysis/AnalysisUIOptions.java:37,70-93`、`.../InspectionSeverityGroupNode.java:37-39` | `docs/inventory/verdict-daemon.md` 里「严重度过滤/文本过滤/按文件·目录」与「问题树的展开态没有可持久化对象」两句**各命中 1** ⇒ 还没升档 | 本仓侧证据仍然成立：六档在 `src/problemsView.ts:61`、三开关 `:194-199`、`collapsedGroups` 在 `src/problemsPanelState.ts:37` |
| prob3 R2.3 · `dm/inspections` 的 `.xml` 导入导出 | `[ ]` 仍缺 | 上一批逐条实测（`.taocode/inspectionProfiles/`） | `docs/inventory/verdict-daemon.md` 的「缺：profile 的导入/导出」仍命中 1 | 本仓已在场：`src/inspectionProfileIo.ts` + 面板检查配置弹层 + `src/App.vue:2297` 的 `<InspectionProfileSwitcher />`（本轮在该行内实测到） |

> 判词表里所有 `docs/inventory/verdict-*.md` 与 `scripts/verdict_table.py` 都是**保留文件**，本轮只实测、未改。

### 1.1 派单特别要核的两件事

**(a) `runningSuspendedText` 那类零消费出口清干净了吗？—— 一半干净，一半没干净。**
* 干净的部分：`grep -rn "runningSuspendedText\|currentSuspender" src tests docs native` 的命中**只有**注释留痕
  （`src/backgroundTasks.ts:199`、`:272`）、历史批次报告、以及门禁里那句 `doesNotMatch`
  （`tests/progress-queue-suspend.test.mjs:38`，防它回来）⇒ 真实代码消费方 **0**，声明/写入/出口三处都没了。
  `src/statusBarText.ts` 里曾有同样毛病的 `statusTextTimeSuffix()`/`statusTextManaged()` 也已删（留痕在 `:97-100`）。
* 没干净的部分（就是我名下/紧邻的三条，本轮重新数过）：
  `ProgressSuspender.text()`（`src/progressSuspender.ts:52` 声明、`:86` 实现）与它读的 `suspendedText`（`:48`）、
  `ProgressSuspenderTracker.suspended()`（`:150-152`）、`suspendAll()`（`:154-156`）、`resumeAll()`（`:158-160`）
  ⇒ `grep "suspender\.text\|suspendAll\|resumeAll\|suspenders\.suspended("` 在 `src`+`tests`+`native` **全部只命中定义那几行**。
  这就是 status2defect W2/W3 仍然成立的实测依据（两文件都不在我的可改面 ⇒ 只交请求）。
* 顺带在本轮新写进门禁的一条防回归：`tests/problem-count-single-source.test.mjs` 的第二条用例把
  `problemCounts` 的**生产消费方清单钉成 `deepEqual(['src/components/ProblemsPanel.vue'])`** —— 它退回"只有测试在读"就会红。

**(b) 状态栏那一格与 `problemCounts` 是不是同一份数？—— 不是同一份数，是两份实现。**
* 状态栏：`src/App.vue:2297` 就地 `allProblems.filter(p => p.severity === 1).length` / `=== 2`（两把 `filter`，没有「信息」格）。
* 面板：`src/components/ProblemsPanel.vue:208` `problemCounts(rows.value)` → `src/problemsView.ts:475` → `levelCountsOf` → `src/highlightLevels.ts:46` 的 `levelForSeverity`（`<= 1` 全归 ERROR）。
* 现网数据域（LSP `DiagnosticSeverity` 1..4，profile 覆盖也走同一档）**两处同数**；
  域外不同：`severity = 0 / -1 / 2.5` 这类值，级别函数把 `<=1` 并进 ERROR，就地 `=== 1` 会漏掉 ⇒
  新写的那条用例把这两档都钉住了（域内 `deepEqual` 相等、域外 `deepEqual` 不等），
  所以"今天没错"不等于"同一把尺"，R1 该接还是要接。
* 另有两处**同源不同径**的观察（都卡在保留文件，只登记不动手）：
  ① 面板那格读的是**过滤后的可见表**（`rows.value`），状态栏读的是**全表** ⇒ 用户勾掉某个严重度时两处必然不同数；
  上游状态栏那一格取自 `status.errorCounts`（`TrafficLightRenderer.kt:383`），与树的过滤态无关。
  钉这条的 `tests/problems-view.test.mjs:187`（`assert.match(panel, /problemCounts\(rows\.value\)/)`）不是我的文件 ⇒ 本轮没动。
  ② `src/inspectionReport.ts:29-30` 的 `SEVERITY_NAMES`/`SEVERITY_CLASSES` 是**第三份**严重度→名字映射
  （`{1:'错误',2:'警告',3:'提示',4:'信息'}`，缺省 `'信息'`），与 `levelForSeverity` 平行；
  该文件不在我的可改面 ⇒ 已登记（见 §7）。

---

## 2. 改动文件清单（`wc -l` 前 → 后）

| 文件 | 前 | 后 | 做了什么 |
| --- | --- | --- | --- |
| `src/components/ProblemsPanel.vue` | 887 | **892** | W4 闭环：`exportDetails` 的 state（`:516-519`，3 行注释 + 1 行 ref）、`:546` 把 `{ details: exportDetails.value }` 传进 `errorTreeText`、模板 `:603` 那颗复选框（复用既有 `.problems-profile-toggle` 类 ⇒ `src/style.css` 一字未动）。上限 900，剩 8 行 |
| `src/problemsView.ts` | 591 | 595 | `problemCounts` 的头注订正：原写「状态栏与面板标题同一套口径」**与磁盘不符**（状态栏还没接）⇒ 改成"面板已在读、状态栏仍就地 filter"并指向 R1 与新门禁。纯注释，无行为改动 |
| `tests/problems-export-text-details.test.mjs` | 新增 | 62 | W4 的接线判据（6 条） |
| `tests/problem-count-single-source.test.mjs` | 新增 | 92 | R1 的钉桩门禁（3 条：登记逐字对上 / `problemCounts` 生产消费方清单 / 域内外两把尺） |
| `docs/batch-2026-10-06-status3.md` | 新增 | 本文件 | 交付报告 |
| `docs/wiring-requests-2026-10-06-{statusbar,status2,status2defect,problems,problems2,prob3}.md` | 817（合计） | 各 +1 段 | 每份末尾追加「status3 复核」块：逐条判 已闭环/仍缺/前提变了，仍缺的带**本轮实测的逐字 old/new 与新行号** |

保留文件与别人名下文件：本轮 `git diff` 自查过 —— 上面 6 行以外没有第二个文件被我改过。

---

## 3. §5 自查命令的前后数字

| 命令 | 开局（动手前） | 收工（本轮最后一次实跑） |
| --- | --- | --- |
| `node --test tests/status-bar-*.test.mjs tests/status-widgets-registry.test.mjs tests/statusbar-popup-motion-parity.test.mjs`（状态栏域，14 文件里的那 7 个） | **50 tests / 50 pass / 0 fail** | 与问题域合跑 **142 / 142 / 0**（含我新加的 9 条与 `tests/error-tree.test.mjs`） |
| `node --test tests/problems-view.test.mjs tests/problems-panel-*.test.mjs tests/problem-*.test.mjs`（问题视图域） | **78 / 78 / 0**（与上一行合计 128） | 含在 **142 / 142 / 0** 里 |
| `node --test tests/notification-*.test.mjs tests/auto-import-notifications.test.mjs tests/bidi-notification.test.mjs tests/commit-notification.test.mjs` | **62 / 62 / 0**（9 文件里的 6 个） | **87 / 87 / 0**（9 个文件全跑） |
| `npx vue-tsc -b --force` | **红：4 条**，全在别人的在途文件（`src/components/CodeEditor.vue`、`src/components/TrustedProjectDialog.vue`、`src/workspaceLifecycle.ts`） | **红：4 条**，全在 `src/lspNavigation.ts:320/321/321/666`（TS1005/TS1136/TS1109/TS1128 = lsp lane 在途的**语法错**）⇒ 我的 5 个文件 0 命中；两次不同名说明是并发编辑、不是我引入的。**这条要主代理注意**：语法错会遮掉全树语义检查，本轮末我无法给出"全树 0 错"的证据 |
| `node --test tests/module-size.test.mjs` | **5 / 5 / 0**（中途一次红：别的 lane 把某个已登记文件顶过上限，随后自复） | **5 / 5 / 0**，`ProblemsPanel.vue` 892 ≤ 900，**没抬过任何上限、没登记豁免** |
| `node .tools/find-orphan-modules.mjs --gate` | **绿**：已登记 7 / 基线 8 · 新增 0 · 清掉 1 | **红**：新增 2 ⇒ `src/editorColumnMode.ts`、`src/editorSplitLine.ts`（编辑器 lane 本轮新建，我没有生产消费方的模块**一个都没加**）；同时 `src/jarRun.ts`、`src/runAnythingContext.ts` 被别人接上 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | **11 / 11 / 0** | **11 / 11 / 0**（本报告的每条上游坐标都在其中；批评假写法时按规约**去掉了行号**） |
| `node .tools/find-param-props.mjs` | 0 处 | 0 处 |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | 干净（我两个新测试文件是纯 JS） |
| `node .tools/find-missing-ext.mjs` | 干净：1312 文件 | 干净（本轮新增的 `.ts` import 都带扩展名；`ProblemsPanel.vue` 里新增的是**运行时调用**，没加 import） |
| ctest / `npm run test:native` | 不适用（本轮没动 `native/`；problems R1 要动的是宿主文件，我不动） | 同左 |

---

## 4. 反向验证记录（三条注入，全部撤净）

新门禁必须证明"它拦得住"，所以每条都做了 注入 → 变红 → 撤掉 → 复绿 三步：

1. **W4 的接线判据**（`tests/problems-export-text-details.test.mjs`，6 条）
   * 判据先行：先写判据、后实现 ⇒ 实现前 **6 / 2 pass / 4 fail**（红在 ①宿主 state ②调用点 ③模板复选框 ④文案，绿的是"唯一调用点"与"两档产出不同"这两条结构性用例）。
   * 注入（实现完成后）：把 `:546` 退回 `errorTreeText(props.problems)`（去掉第二个参数）⇒ **6 / 5 / 1**，红在「导出调用把开关传进 `errorTreeText`」。
   * 撤掉 ⇒ **6 / 6 / 0**。
2. **R1 钉桩的"新增就红"分支**（`tests/problem-count-single-source.test.mjs`，3 条）
   * 注入：在 `src/components/ProblemsPanel.vue` 加一行 `const injectedProbe = computed(() => props.problems.filter(p => p.severity === 3).length)`（= 又写第三把尺）⇒ **3 / 2 / 1**，红在「就地重数严重度的地方必须与登记逐字对上」，报的是 `src/components/ProblemsPanel.vue` 未登记。
   * 撤掉 ⇒ **3 / 3 / 0**。
3. **R1 钉桩的"过期也红"分支**（同一条用例的反向半）
   * 注入：把 `PINNED[0].hits` 从 `2` 改成 `0`（模拟 R1 落地了但登记没摘 / 或那格的形状变了）⇒ **3 / 2 / 1**，红在同一用例，消息里写着"R1 落地了就把这个条目从 PINNED 删掉"。
   * 撤掉 ⇒ **3 / 3 / 0**，合跑 **142 / 142 / 0**。
4. 残留标记自查：`grep -rn "反证注入\|injectedProbe\|临时第二把尺" src tests docs` ⇒ **0 命中**；
   `grep -n "errorTreeText(" src/components/ProblemsPanel.vue` ⇒ 只剩 `:546` 那一处、带 `{ details: exportDetails.value }`；
   `wc -l src/components/ProblemsPanel.vue` = 892（注入期的 893 已回落）。

---

## 5. 零消费方自查结论

* 本轮**没有新增任何 `.ts` 模块**，也没有新增导出符号：
  `exportDetails` 在 `ProblemsPanel.vue` 里被模板消费（`:546` 读值、`:603` 双向绑定），不是死面。
* `node .tools/find-orphan-modules.mjs --gate`：开局绿 → 收工红 2（`src/editorColumnMode.ts`、`src/editorSplitLine.ts`），
  两条都在编辑器 lane 名下、本轮我未创建也未引用 ⇒ **不是我引入的**，写在这里防被算进来。
* 本轮实测的**存量**死面（都不在我的可改面，逐条已进请求文档）：
  `ProgressSuspender.text()` / `suspendedText`、`ProgressSuspenderTracker.suspended()/suspendAll()/resumeAll()`（§1.1a）；
  以及一个我自己名下的**观察**：`createStatusBarWidgetInstances`（`src/statusBarWidgets.ts:142`）
  的唯一引用者仍是 `tests/status-bar-widget-instances.test.mjs` —— 本仓状态栏的组件是 App.vue 模板里直接渲染的，
  没有实例宿主 ⇒ 它现在是"只过自己测试"的那一档。**本轮没删**：那是 statusbar/status2 名下的实现 + 他们的用例锚点，
  且要它真活起来得先有 App.vue 侧的宿主 ⇒ 已登记（§7 第 5 条）。
* 本轮**清掉的**只有一处不诚实的措辞：`src/problemsView.ts:474` 的头注声称"状态栏与面板同一套口径"，
  实测状态栏并未接 ⇒ 改成如实措辞并挂上请求与新门禁（§2 第二行）。

---

## 6. 做不到 / 无法核实

| 项 | 具体卡在哪一环 |
| --- | --- |
| R1（状态栏改读 `problemCounts`） | 唯一落点是 `src/App.vue:2297`（保留文件，`appvue` 名下）。我能做的都做了：逐字 old/new 在更新后的 `docs/wiring-requests-2026-10-06-prob3.md` 末尾，并加了一条"再多一处就地重数就红、修好不摘登记也红"的门禁。**没做**的部分 = 那一格的字面替换 |
| status2 W3 / status2defect W1·W2·W3 | 分别卡在 `src/gradleHost.ts`（15 名下）、`scripts/verdict_table.py` + `docs/inventory/*`（保留）、`src/backgroundTasks.ts` 与 `src/progressSuspender.ts`（status2 名下）⇒ 只交请求。派单没把它们写进我的可改面，我没有越界去改 |
| problems R1 / problems2 W1 | `native/lsp_support.cpp` + `src/bridge.ts`（保留）与 `src/lspHighlightingCache.ts`/`src/lspNavigation.ts`/`src/components/CodeEditor.vue`（lsp 名下/禁改）；且该 lane 本轮正在改同一文件（收工时那 4 条语法错）⇒ 我若贴新代码就是踩现场 |
| 「全树 0 类型错」这条证据 | `src/lspNavigation.ts:320` 的语法错会遮掉后面的语义检查（§4 坑 3），本轮无法排除"我的改动被遮住"这种可能。已用可跑的部分（域内 142 条 + 通知 87 条 + 模块尺寸 + 引用门）交叉验证，等那条修完需要再跑一次 `npx vue-tsc -b --force` |
| 上游 `NotificationsConfigurable.java` 的逐控件表 | 上一批写了"逐行控件表本轮没数"，本轮同样没重开那个类 ⇒ 通知设置页的**结构**仍不能照抄，请求里保持"按那条类补做，我不编" |
| `checkbox.errortree.export.details` 的中文取值 | 本地树只有 `platform/platform-api/resources/messages/IdeBundle.properties:143` 的英文 `Details`（`grep` 全树仅此一处），中文语言包不在本地树 ⇒ 面板文案按规约直译成「详情」，注释里留了英文原文与键名 |

---

## 7. 需要主代理接的线（详情在 6 份请求文档末尾的「status3 复核」块）

1. `src/App.vue:2297`：状态栏那一格改读 `problemCounts`（prob3 R1）。**同批**要摘掉
   `tests/problem-count-single-source.test.mjs` 里 `PINNED` 的 `src/App.vue` 条目，并把
   同文件第二条用例的消费方清单改成 `['src/App.vue', 'src/components/ProblemsPanel.vue']` —— 那条门禁现在是空的吗？不是：**不动它它会红**，这是设计。
2. `src/gradleHost.ts:207`：任务体补 `await indicator.awaitResumed()` + `indicator.checkCanceled()`（status2 W3，逐字 old/new 已给）。
3. `src/backgroundTasks.ts:367` 与 `src/progressSuspender.ts`：挂起原因的显示源二选一（status2defect W2/W3，两条路的可照抄文本都在请求里）。
4. `scripts/verdict_table.py:348` + `docs/inventory/verdict-platform_rest.md:171`：删掉"本仓任务不能暂停"（W1）；
   `docs/inventory/verdict-daemon.md:31` 的 `src/bridge.ts:109` 订正为 `:118`（R2.1，且"不透传"这半句**今天仍然真**）。
5. `src/statusBarWidgets.ts:142` 的 `createStatusBarWidgetInstances`：要么给 App.vue 的组件实例宿主，要么按本仓"死面直接删"处理（本轮只登记）。
6. `src/inspectionReport.ts:29-30`：第三份严重度→名字/样式映射，建议改读 `src/highlightLevels.ts` 的 `levelForSeverity`
   （与 R1 同一族；`tests/problem-count-single-source.test.mjs` 的正则只钉"就地重数"那种形状，**没**钉名字映射，所以这条要人盯）。
7. `src/inspectionReport.ts:23` 的 `projectName` 选项没有生产调用方（面板只传 `generatedAt`）⇒ 报告标题恒为「工作区」。
   要接就得给 `ProblemsPanel.vue` 加一个 prop 并由 `src/App.vue` 传 `workspace?.name` —— 两处不同批就是死 prop，故本轮**没加**。
8. 编辑器 lane 的 `src/editorColumnMode.ts` / `src/editorSplitLine.ts` 让 `find-orphan-modules --gate` 变红（不是我的模块，但门禁红着）。
9. `src/lspNavigation.ts:320` 的语法错红着 ⇒ 全树 `vue-tsc` 目前无法给出 0 错证据。
