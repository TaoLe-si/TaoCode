# 批次报告 · 2026-10-06 · lane statusclose（状态栏/进度族收尾：半截收口 + 一条真判据）

派单只做一件事：收掉 `status2` 的 W1…W5（与 `status2defect` 的 W1…W3）里**不碰保留文件**的那些，
外加一条能失败的真判据。骨架先落盘，之后逐块追加。

**一句话结论**：`status2` 的 W1…W5 与 `status2defect` 的 W1…W3 共 9 条，实测 **5 条盘上早已闭合**
（W3/W4 + status2defect 的 W1/W2/W3，逐条给 grep 证据）、**3 条仍卡在保留文件**（W1/W2/W5 ⇒ 交接 §6-②）、
**1 条模块侧但需要跨批定夺**（`createStatusBarWidgetInstances`，单删会撞 orphan 门 ⇒ 交接 §6-④）。
派单点名的「`runningSuspendedText` 待收」本身就是过期账。
本轮落的：① 一条能失败的新判据（状态栏组件挂点的**反向奇偶** + 未登记 id 的五道默认拒绝，§2.1/§5 三次注入自证）；
② 名下三个文件里 **36 个上游引用点**的假坐标/假类名订正（§2.2，只改注释）；
③ 残留扫描：`|| true`/`&& false`/`if (true ||`/`if (false` 在 `src/` + `native/` **0 命中**，本 lane 前缀 `STATUSCLOSE` **0 残留**。
本域判据 **171/171/0**（同组带 `module-size` 时 176/175/1，那条红是外域在飞的 `native/workspace.cpp` 超限，§4）；
orphan 门 16:5x 那次是绿的，17:08 起报的一条新增红是外域在飞文件（红点两分钟内在同族换名字，§4）。

## 0. 开工现场（mtime 自查 + 归属）

当前时间 16:43；名下文件的磁盘 mtime（`ls --time-style=full-iso` 实测）：

| 文件 | mtime | git | 判定 |
|---|---|---|---|
| `src/backgroundTasks.ts` | 14:39 | ` M`（`git diff --numstat` 实测 **95/58**；看板 §十二 那句「+153」是 `--stat` 的图形计数，不是净增行） | **progflow 的落地**（看板 §十二 记的 `+153`），已死 lane、报告在盘（`docs/batch-2026-10-06-progflow.md`）⇒ 我只在其上加判据，不重写 |
| `src/progressSuspender.ts` | 13:39 | ` M`（**67/66**） | progflow 同批（收了 `text()`/`suspendedText`/tracker 三条 ⇒ status2defect 的 W2/W3 就是在这里闭的） |
| `src/progressNotices.ts` | 13:45 | ` M`（5 行：`displayId: message.displayId \|\| …`） | **主代理自己落的 lspmsg R1a**（看板 §一 第 1 条）⇒ **本轮不碰**，冲突已登记 §6-① |
| `src/notificationGroups.ts` | 13:45 | 干净（已提交） | 主代理 R1b 那一批 ⇒ 不碰 |
| `src/lspServerMessages.ts` | 16:23 | 干净 | **开工 20 分钟前刚被写** ⇒ 本轮不碰（派单点名的热文件） |
| `src/statusBarWidgets.ts` / `statusBarText.ts` / `statusWidgets.ts` / `statusBarNav.ts` / `statusBarLifecycle.ts` | 09:2x / 09:2x / 09:2x / 09-26 | 干净 | 我名下的稳定面 ⇒ 本轮的判据落在这里 |
| `tests/statusbar-popup-motion-parity.test.mjs` 等 3 份 status 测试 | 09:08 | 干净 | 无并发 ⇒ 判据加在既有门禁文件里 |

保留文件余量（按看板 §二十五 的门控数法口径，本轮未动它们）：`src/App.vue` 30 / `src/bridge.ts` **0** / `CodeEditor.vue` 2 ⇒ 本轮**一个字节都没写**进这三个。

## 1. 逐条分类（W1…W5 + status2defect W1…W3 + 「顺带」）

先按派单要求逐条 `grep -n` 目标文件核实出口名**真的存在**，再分类。三份账（`docs/wiring-requests-2026-10-06-status2.md`、
`docs/wiring-requests-2026-10-06-status2defect.md`、以及被派单点名的「`src/backgroundTasks.ts` 的 `runningSuspendedText` 已登记待收」）
合计 9 条，实测：**5 条盘上早已闭合（给证据；其中 status2defect W1 是本 lane 收工前 17:06 由另一条路落的）
· 3 条卡在保留文件（只能交接：status2 的 W1/W2/W5）· 1 条模块侧可做但本轮判定不动（连锁证据在下）**。
另：派单点名的「`runningSuspendedText` 已登记待收」经核是**过期账**（见本节末段）。

| 条 | 请求原文要什么 | 本轮实测（命令 + 命中） | 分类 |
|---|---|---|---|
| status2 **W1** | `Messages`/`messageDialog` 的宿主挂进 `src/App.vue` | `grep -c "messageDialog\|showMessage\|MessageHost" src/App.vue` = **0**；`ls src/components \| grep -i messagedialog` = **0**（组件文件不存在） | **需要保留文件** ⇒ 交接 §6-② |
| status2 **W2** | 通知设置页（`settingsTreeMeta.ts` + `SettingsDialog.vue`） | `ls src/components \| grep -i notificationssettings` = **0**；两个宿主文件都在禁写名单 | **需要保留文件** ⇒ 交接 §6-② |
| status2 **W3** | `gradleHost.ts` 的任务体补挂起检查点 | `src/gradleHost.ts:211` 的注释**逐字指名** `docs/wiring-requests-2026-10-06-status2.md` 的 W3；`:216-220` 就是请求里那段可照抄代码（`run: async indicator => { await indicator.awaitResumed(); indicator.checkCanceled(); await sync(undefined, indicator) }`） | **已过期**（盘上早已闭合，progflow 批次落的） |
| status2 **W4** | `ProblemsPanel.vue` 的「详情」勾选 | `:524 const exportDetails = ref(true)`、`:552 errorTreeText(rows.value, { details: exportDetails.value, groups: groups.value })`、`:609` 模板那颗复选框（`aria-label="导出时包含每条消息"`） | **已过期**（status3 落的，看板 §十四 我已复验） |
| status2 **W5** | 内部错误芯片进状态栏勾选清单 | `src/App.vue:2329` 仍是裸 `<InternalErrorsChip :active=… :is-desktop=… :show-log=… />`，没有 `showWidget('fatalError')`；`tests/statusbar-popup-motion-parity.test.mjs:40` 的 `KNOWN_GAPS` 现在是 `new Map()`（空）⇒ 只补注册表条目必红 | **需要保留文件** ⇒ 交接 §6-② |
| status2defect **W1** | 改 `scripts/verdict_table.py` 的 `pf/progress` 判词并重生成 | 开工时（16:4x）实测 `grep -c "本仓任务不能暂停"` 在 `scripts/verdict_table.py` 与 `docs/inventory/verdict-platform_rest.md` **各 1**，那句过期判词仍在；**17:06 另一条路把它改了**（`scripts/verdict_table.py:367` 现在的原文是"原写「本仓任务不能暂停」为假"，并同步写进了我要交接的两件新事实：`src/gradleHost.ts:222-226` 已收 `indicator` 先 `awaitResumed()`、`text()`/兜底文案是"因全仓零读者删掉"），`python scripts/verdict_table.py --check platform_rest` = **一致 3/3** ⇒ 看板 §十六 那条"仍红 exit 1"同时消解 | **收工前已被闭合**（不是本 lane 做的，禁写文件我一个字节没动）⇒ 本 lane 只复核，见 §6-③ |
| status2defect **W2** | 挂起原因的显示源只能有一份：接 `suspender.text()` 优先，**或**按方案 2 删掉 `text()`/`suspendedText` | `src/progressSuspender.ts` 现在**没有** `text()` 也没有 `suspendedText`（`grep -rn "suspender\.text\|suspendedText" src/` 只剩注释与上游引用文字）；文件头 `:9-18` 写明「本仓不接那个兜底文案」并给出上游三个读者；`src/backgroundTasks.ts:250` 同批改注释「这里原样传过一句『等待前台操作』，已删」；`grep -rn "等待前台操作" src/` = 只命中那两句留痕注释 | **已过期**（progflow 走的是请求给的**方案 2**），并已被 `tests/progress-queue-suspend.test.mjs:57-76` 的 `deepEqual` 钉住 ⇒ 不是口头闭合 |
| status2defect **W3** | tracker 的 `suspended()`/`suspendAll()`/`resumeAll()` 三条零消费 ⇒ 删或写理由 | `grep -rn "suspendAll\|resumeAll\|\.suspended()" src/` 只命中 `src/progressSuspender.ts:51` 那句「在上游不存在、在本仓零调用方 ⇒ 同批删除」的留痕；`ProgressSuspenderTracker.prototype` 的实测清单 = `['constructor','getSuspender','track','untrack']`（判据 `:74-75`） | **已过期**（同批删除 + 清单门禁） |
| status2defect「顺带」 | `src/statusBarWidgets.ts:142 createStatusBarWidgetInstances` 零生产消费方 ⇒ 给宿主或按死码删 | 本轮实测：`grep -rl "createStatusBarWidgetInstances" src/` 只有声明那一份文件，`tests/` 只有 `tests/status-bar-widget-instances.test.mjs` ⇒ **确实还挂着**；但 `grep -rln "statusBarLifecycle" src/` 只有 `src/statusBarWidgets.ts` 一个消费者，而它用的 `installWidget`/`disposeWidget` 又只被这一个函数调（`src/statusBarWidgets.ts:27` 的 import + `:166`/`:169`）⇒ **单删入口会把 `src/statusBarLifecycle.ts`（门控数法 105 行，除自己那份生命周期判据外还被 `tests/status-bar-widget-instances.test.mjs`/`tests/status-widgets-registry.test.mjs` 引用）当场变成 orphan 门新增红** | **模块侧可做但本轮不单方执行** ⇒ 交接 §6-④（给了可一次做完的整批方案与门禁连锁数字） |

派单点名的那条「已登记待收：`src/backgroundTasks.ts` 的 `runningSuspendedText`」：`grep -rn "runningSuspendedText" src/` 只命中
`src/backgroundTasks.ts:214` 的一句留痕注释（`docs/batch-2026-10-06-progflow.md:162` 已用 `git grep … HEAD` 复验 = 0 命中），
且门禁 `tests/progress-queue-suspend.test.mjs:44-54` 现在是 `deepEqual` 的 7 键清单 + 三条 `doesNotMatch`（钉**声明**而不是钉引用）
⇒ **已过期**，派单给的这条线索本身就是过期账。

## 2. 模块侧落地的改动

### 2.1 一条真判据：状态栏组件的**反向奇偶**（`tests/statusbar-popup-motion-parity.test.mjs` 第 2 条，7→8 条）

原来那组只钉**正向**（注册表每条都得被 `src/App.vue` 的模板消费，`KNOWN_GAPS` 空 = 不放行死控件），
反方向当时**没人管**，而这一侧失效是静默的：`src/statusWidgets.ts` 的 `showWidget(id)` 对认不出的 id
`return false`（本轮实测 `:180-184`），所以「模板里写了 `showWidget('新组件')`、注册表忘了加那一行」
既不抛错也不红编译，只让那颗组件**永远不出现**、右键勾选清单里也列不出来（`listWidgets()` 遍历的就是注册表）。
⇒ 新判据钉两件（都能失败，见 §5 的 A/B/C 三次注入）：

1. 模板里解析到的每个 id 都必须在 `STATUS_WIDGETS` 里（`assert.deepEqual(unregistered, [])`，不是 `includes`），
   并自带"判据本身不许失效"那道 `consumed.length >= 15`；
2. 未登记的 id 在五道口上都是"没有这条状态"：`findWidgetFactory` → `undefined`、`showWidget` → `false`、
   `widgetChecked` → `false`、`widgetClickable` → `false`、`toggleWidget` → **不往持久化覆盖里写任何东西**
   （最后那条防的是"给一个不存在的组件留下存档残留键"，正是本仓 `loadOverrides()` 特意丢弃未知键的那个洞）。

上游依据本轮**亲自开树核过**（不是抄 status2 的行号）：
`platform/platform-impl/resources/intellij.platform.ide.impl.xml:1618-1644` 逐条数过确是 **15** 条
`statusBarWidgetFactory`（VfsRefresh/Position/LineSeparator/Encoding/PowerSaveMode/InsertOverwrite/ReadOnlyAttribute/
Notifications/FatalError/WriteThread/Memory/EditorAnimationCacheStatistics/SmartModeIndicator/
IndexesAndVfsFlushIndicator/settingsEntryPointWidget，`FatalError` 在 `:1633`）⇒ "注册表 = 那份 EP 清单"这个类比成立；
`StatusBarWidgetsManager.kt:149` 的 `findWidgetFactory(widgetId) = widgetIdMap.get(widgetId)` 与 `:58-59` 的
`LinkedHashMap` + `widgetIdMap` 是同一个概念（**没有**"模板引用一个 EP 里没有的 id"这种状态，上游根本建不出组件）。
中文措辞：本仓这两处不新增界面文案（`ghost` 只是判据夹具），无「无法核实」项。

**没有放松任何断言**：本轮只**加**了一条 test 与 6 个 import 名（`findWidgetFactory`/`showWidget`/`widgetChecked`/`widgetClickable`/`widgetOverrides`/`toggleWidget`），原有那 7 条（正向奇偶 + 不可点/真动作 + 水纹两道闸 + CSS 伪元素 + 浮层阴影令牌 + 状态栏度量）的断言体**一字未动**。

### 2.2 名下三个文件的**假坐标 / 假类名订正**（只改注释，`git diff -U0` 实测无任何非注释行变化）

派单要求"类名与行号一律当候选，不符就换并留痕"。本轮把 `src/statusBar*.ts` + `src/statusWidgets.ts` 的
每一处上游引用都按参考树重开数过，**12 条漂移/错名订正**（合计 **36 个引用点**：
`src/statusBarWidgets.ts` 23 + `src/statusBarText.ts` 9 + `src/statusWidgets.ts` 4）、
**1 条登记为无法核实**、**2 条复核一致**：

| 盘上原引（在我名下文件） | 本轮实测（同一参考树） | 处置 |
|---|---|---|
| `StatusBarWidgetsManager.kt:139` = `findWidgetFactory` | `:139` 实为 `wasWidgetCreated(factoryId)`；`findWidgetFactory` 在 **`:149`**（`= widgetIdMap.get(widgetId)`） | 已改 `:149`，并把 `:139` 那条真名留在括号里防再漂 |
| `StatusBarWidgetsManager.kt:161-167` = `canBeEnabledOnStatusBar` | 实为 **`:176-181`**（四个条件在 `:177-180`） | 已改 |
| `StatusBarWidgetsManager.kt:243-245` = `isAllowedByInternalMode` | 那是 `extensionAdded(...)` 里的 LightEdit 判断；扩展函数真身在 **`:275-277`** | 已改 |
| `updateWidget:98-100` 的三道闸（出现 2 处） | 函数在 **`:96`**，三道闸在 **`:97-99`**，装配体到 `:131` | 已改（两处） |
| `StatusBarWidgetSettings.kt:20-41` / `:32-40` / `:26-28` / `:24` | 类体 `:16-40`；`setEnabled` **`:28-39`**；`isEnabled` **`:24-26`**；`isExplicitlyDisabled` **`:22`**（status2 已在 `:77` 改成 `:22`，但表头 `:7` 仍写 `:24` ⇒ 同批统一） | 已改（四处） |
| `StatusBarActionsManager.getActionsFor`（**类名**） | 参考树里**没有这个类**（`find platform -name "StatusBarActionsManager*"` = 0）；真身 = `StatusBarActionManager`（`StatusBarWidgetsActionGroup.kt:164`，`getInstance :166`，`getActionsFor :208-211`，过滤那一句 `:210`，调用处 `:63`） | 已改（订正类名 + 行号） |
| `StatusBarWidgetsActionGroup.kt:104-110`（`ToggleWidgetAction.update` 用四合一判据，出现 2 处） | 那段 `:104-110` 是 LightEdit / internal-mode 两道提前 return；`canBeEnabledOnStatusBar` 的调用在 **`:116-117`** | 已改（两处，并同时给判据本体的 `:176-181`） |
| `StatusBarEditorBasedWidgetFactory.kt:14-16` = `canBeEnabledOn` | `canBeEnabledOn` 在 **`:12`**，`:16` 才是 `getTextEditor` | 已改 |
| `StatusBarWidgetFactory.java` 的 `:31-34`/`:37-41`/`:112-114`/`:122-124`/`:128-130`/`:68-70` | 实测 `getId :29`、`getDisplayName :37`、`isEnabledByDefault :106`、`isConfigurable :116`、`isInternal :123`、`isAvailable :55`（各带 javadoc 写成区间 `:24-29`/`:31-37`/`:102-108`/`:110-118`/`:120-125`/`:39-57`） | 已改（六处） |
| `ide-core/.../StatusBar.kt:34-49` | 全路径 `platform/ide-core/src/com/intellij/openapi/wm/StatusBar.kt`，`fun set` 在 `:34`、体到 **`:45`**，`TOPIC :30` | 已改（补全路径 + 尾行号） |
| `StatusPanel.java:168-213` / `:190` / `:201` / `:186-201` / `:203-209` | **仓里有四个同名 `StatusPanel.java`**（`wm/impl/status`、`ui`、`diff-impl`、`jcef`），真身 `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/StatusPanel.java`：`updateText :175-220`、60 秒判据 **`:200`**、`alarm.addRequest(this, 30000)` **`:208`**、那段 `Runnable :195-210`、else 支 `:212-217` | 已改（五处 + 补全路径以消歧） |
| `ApplicationNotificationsModel.EVENT_REQUESTOR :60` | 实为 `platform/platform-impl/src/com/intellij/notification/impl/ApplicationNotificationsModel.kt:20` | 已改 |
| `EditorBasedWidget.kt:96-109`（"dispose 之后所有更新一律返回"的保护） | 该文件在 `…/wm/impl/status/EditorBasedWidget.kt`，`:97` 是 `isOurEditor` 委派、`:99-104` 是 `getSelectedFile`、`:105-110` 是 `install` + 那条 project assert ⇒ **这段里没有那条保护**，本轮**没能核实**它的上游真身（`myDisposed` 一类判据没在这条链上找到） | **不动、登记**（见 §7-①） |
| `InfoAndProgressPanel.kt:439-451`（`setText` 两条过滤 + `:448` 的 `currentRequestor`） | 实测 `fun setText` `:439`、空文字过滤 `:444`、`currentRequestor = …` `:448` ⇒ **逐条一致** | 复核通过，未改 |
| `intellij.platform.ide.impl.xml:1618-1644`（十五条工厂） | 本轮重数 = 15 条，`FatalError` 在 `:1633` ⇒ **一致** | 复核通过，未改 |

顺带核到一条**别人文档里的错**（不在我名下 ⇒ 只登记不动）：
`docs/batch-2026-10-06-status2.md:27` 写"上游 `…/status/StatusText.java` 的 `myTimeText`"——
`StatusText.java` 的真路径是 `platform/platform-api/src/com/intellij/util/ui/StatusText.java`（**不在** `wm/impl/status/`），
而 `myTimeText` 那个字段属于 `…/wm/impl/status/StatusPanel.java:49`（读取处 `:67-70`、写 `:201`/`:205`/`:213`）
⇒ 路径与归属两处都不对。已登进 §6 交接。

### 2.3 本轮**没动**的东西（逐条给理由）

- `src/progressNotices.ts` / `src/notificationGroups.ts` / `src/lspServerMessages.ts`：mtime 13:45 / 13:45 / **16:23**，
  前两份的未提交 hunk 就是主代理自己落的 lspmsg R1a/R1b（`displayId: message.displayId || …`），
  第三份距我开工 20 分钟 ⇒ 按派单的"冲突就跳过并登记"处理，见 §6-①。
- `src/backgroundTasks.ts` / `src/progressSuspender.ts`：都带 progflow 的未提交落地（`git diff --numstat` 实测 **95/58** 与 **67/66**；看板 §十二 那句「+153」是 `--stat` 的图形计数），
  且它们要收的那两条（status2defect W2/W3）**已经在这些改动里闭完**（§1 有 grep 证据）⇒ 不重写，只复验。
- `src/App.vue` / `src/bridge.ts` / `CodeEditor.vue` / `scripts/verdict_table.py` / `docs/inventory/**` / `native/main.cpp`：
  禁写名单，本轮 `git diff` 里一条都没有。**特别说明 `bridge.ts`**：status2 那条"删 bridge 假控件"删的是
  `STATUS_WIDGETS` 注册表里那个 id 叫 `bridge` 的**状态栏条目**，不是 `src/bridge.ts` 里的字段；
  本轮实测 `src/bridge.ts` 里没有"状态栏/进度族有字段没人读"的新增项（`git diff -- src/bridge.ts` 空），
  所以**不需要**为它写腾位请求 —— 派单给的这条前提在盘上已经闭合。

## 3. 残留扫描

| 命令 | 结果 |
|---|---|
| `grep -rn "\|\| true\|&& false\|if (true \|\|\|if (false" src/ native/` | **0 命中**（派单点名的三个历史实例 `lspServerMessages.ts` 的 `severity <= 4`、`editorInlayHints.ts` 的 `if (true \|\|`、`browsers.ts` 的 `&& false` 本轮都已在盘上被各自属主还原；`src/lspServerMessages.ts:558` 实测 `if (message.severity <= 2) {`、`src/editorInlayHints.ts:259` 实测 `if (!inlayHintCache.acceptFull(…)) return`、`src/browsers.ts:594` 实测 `if (colon === 1 && (url[2] === '/' || url[2] === '\\')) return false`） |
| `grep -rn "REVFIX\|PROBE\|TEMP 反向验证\|INJECT\|MUTATION" src/ tests/ native/` | 命中 **49** 行，逐条开文件判过：全部正当 —— `ANALYZE_INJECTED_CODE`/`ANALYZE_TEST_SOURCES` 是上游 option 真名（`src/analysisScope.ts:32/:119`、`ScopesSettingsPage.vue:360`）、`NO_CONFLICT_PROBE`（`src/mergeResolve.ts:291`）是 merge 域自用的内部探针常量、`IDLE_PROBE_MS`（`src/quickEvaluateHint.ts:459`）是 hoverTime 常量、`native/jdtls_probe.cpp` + `native/runner_test.cpp` 的 `TAOCODE_PROBE_*` 是探针工具的环境变量名、`tests/menukeys-probe.test.mjs` 是 lane `menukeys` 自己的判据前缀、`SCANNER_PROBE_*` 是 `tests/format-post-ranges.test.mjs` 的用例夹具。**没有一条是本域（状态栏/进度）的残留** |
| 派单点名的两个具体形状 | ① 短路注入：本轮 `src/` + `native/` 实测 **0 命中**（三处历史实例都已被各自属主还原，见上一行）；② 函数级死出口：名下 14 个模块逐个 `grep -rl "<出口名>" src/ tests/` 扫过，唯一仍挂着的是 §6-④ 那条 |

## 4. 门禁原始数字

| 跑什么 | 数字 |
|---|---|
| `node --test tests/background-task*.test.mjs tests/progress*.test.mjs tests/status*.test.mjs tests/notification*.test.mjs tests/module-size.test.mjs`（glob 实测 **21** 个文件，跑前先 `ls` 点过名） | **176 条 / 175 通过 / 1 失败**。本轮新增 1 条 ⇒ 开工同组是 175；同组**去掉 `module-size`**（= 本域全部判据，20 个文件）实测 **171 / 171 / 0**。唯一那条红**不是本域、也不是我造成的**：`tests/module-size.test.mjs:204`「已登记的 native 大文件不许继续变大」报 `native/workspace.cpp 现在 1482 行 > 上限 1385` —— 该文件 `git status` = ` M`、mtime **17:02:47**，我采到这条红是 17:03:0x（晚它 17 秒），本 lane 全程没碰 `native/` 一个字节 ⇒ 按看板纪律记为**在飞中间态、不修**。（本轮早一次全组复跑还是 **176/176/0**，那时 `workspace.cpp` 仍在上限内 —— 两次数字都留在这里便于对账。） |
| `node .tools/find-orphan-modules.mjs --gate` | **两次**：16:5x 已登记孤儿 6 / 基线 8 · **新增 0** · 清掉 2（`src/jarRun.ts`、`src/runAnythingContext.ts`，与看板 §二十八 一致）⇒ **门禁绿**；17:08 复跑 = **新增 1：`src/codeActionPopupModel.ts`**（mtime 17:08:00，全仓零消费者），而收工前最后几次复跑命中的是**同族另一个文件** `src/components/CodeActionPopup.vue`（`src/intentionMenuModel.ts` 那批此刻是 `??`）⇒ 红点在两分钟内**在这条链里换名字**，这是「有人正在往里接」的特征、不是回归：属外域在飞（意图/动作弹层族，看板 §十四/§二十五 的 `intentw` 那条链），**不是本域、不是本 lane 建的**，按「在飞红只记录不修」处理，交主代理收口时按当时磁盘定归属；两次词法自检都 **0 异常** |
| 隔离 `tsc --noEmit`（`--strict --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM,DOM.Iterable --allowImportingTsExtensions --skipLibCheck --verbatimModuleSyntax`，8 个名下模块：`statusWidgets`/`statusBarWidgets`/`statusBarText`/`statusBarNav`/`statusBarLifecycle`/`backgroundTasks`/`progressSuspender`/`progressNotices`） | **0 错、EXIT=0** |
| 名下模块逐个 `node -e import()` 自证可加载（14 个：上述 8 + `notificationEventLog`/`notificationGroups`/`notificationBeeper`/`notificationDoNotAsk`/`notificationPowerSave`/`notifications`） | **14/14 ok，0 加载期断链** |
| `node --test tests/module-size.test.mjs` 单列 | 5 条 / 4 通过 / 1 失败（失败的就是上面那条外域在飞红）；我三个改动文件的门控行数（`split('\n').length`）：`src/statusBarWidgets.ts` **187**、`src/statusWidgets.ts` **258**、`src/statusBarText.ts` **181**，上限 900 远未触到 |
| 全量 `npm test` / `vue-tsc -b` | **按派单没跑**（全仓 `vue-tsc` 此刻还挂着别的 lane 的在飞错，看板 §二十一/§二十二 已按归属拆给对应 lane，收口由主代理归零） |

`git diff --numstat` 本轮我的全部改动：`src/statusBarWidgets.ts` 25/24、`src/statusWidgets.ts` 4/4、
`src/statusBarText.ts` 12/9、`tests/statusbar-popup-motion-parity.test.mjs` 43/1（那 1 行删除是 import 那一行的替换）、本报告。
**本 lane 的写入面 = 上面那四个文件 + 本报告**（`git status --porcelain` 逐字核过）。
禁写名单此刻在盘上确实是 ` M`，但**都不是我改的**（本轮我只读过它们）：
`src/App.vue` 16:58、`src/bridge.ts` 14:52、`src/components/CodeEditor.vue` 17:03、`src/settingsModel.ts` 13:15、
`scripts/verdict_table.py` **17:06**（见 §6-③）、`native/main.cpp` 12:02；
同批 ` M` 的 `src/backgroundTasks.ts`/`src/progressSuspender.ts`/`src/progressNotices.ts`/`src/progressPanel.ts`
都是 progflow / 主代理的既有 hunk（见 §0 与 §2.3）。

## 5. 反向验证（前缀 `STATUSCLOSE` 注入 → 红 → 还原 → sha1 → grep 0 残留）

基线 sha1（注入前，也是还原那一刻必须复现的值）：
`src/statusWidgets.ts` = `f40b68da5a44b04397fbfdd1931c29254d5681b4`、
`tests/statusbar-popup-motion-parity.test.mjs` = `1f218afdb43eaa830573dcefb2ad58593b800c01`。
（顺序要说清：注入↔还原发生在 §2.2 的注释订正**之前**，还原当时 `git diff -- src/statusWidgets.ts` 是空的；
这份文件现在的 sha1 是 `fe10ff98f0597dfc15f6b095f06d314f67f6c4ae`，差的正是 §2.2 那 4 行注释替换，
**不是**注入残留 —— 注入残留由下面那条 `grep STATUSCLOSE = 0` 独立证明。）

| 注入 | 内容（都打在 `src/statusWidgets.ts`，我名下） | `node --test tests/statusbar-popup-motion-parity.test.mjs` |
|---|---|---|
| **A 反向奇偶** | 注册表里 `id: 'column'` → `id: 'columnStatuscloseProbe'`（等价于"模板有挂点、注册表没登记"），带 `// STATUSCLOSE-PROBE-A` | **8 条 / 6 通过 / 2 失败**；红在「反向奇偶…」，报错文案 = *状态栏模板里有 1 个挂点没在 STATUS_WIDGETS 登记：column —— showWidget 对认不出的 id 返回 false，用户看不见也关不掉*（同时正向那条也红 ⇒ 两侧是两道独立的闸，不是同一条判据的重复） |
| **B 默认拒绝** | `showWidget` 的 `if (!widget) return false` → `return true`，带 `// STATUSCLOSE-PROBE-B` | **8 / 7 / 1**；红在「未登记的 id 不得画（默认拒绝）」 |
| **C 存档残留** | `toggleWidget` 的 `if (!widget) return` → 给未登记 id 也写一条覆盖键，带 `// STATUSCLOSE-PROBE-C` | **8 / 7 / 1**；红在「未登记的 id 不该往持久化覆盖里写任何东西」 |

还原后实测：`sha1sum src/statusWidgets.ts` = `f40b68da…`（与基线**逐字相同**）、`git diff -- src/statusWidgets.ts` **空**、
`grep -rn "STATUSCLOSE" src/ native/ tests/` = **0 命中**（这个词只出现在本报告里）。
复跑本域 20 个文件：**171 / 171 / 0**。
**没有放松任何一条既有断言**：新判据是"加一条 test"，正向那条的断言体、`KNOWN_GAPS` 机制与其余 6 条**一字未动**；
新断言的形状是 `deepEqual(未登记清单, [])` + 逐道口 `assert.equal(...)`，不是 `includes`。

## 6. 交接给主代理（保留文件 / 别人名下 / 需要跨批的）

① **热文件冲突（按派单跳过）**：`src/progressNotices.ts` 与 `src/notificationGroups.ts` 的未提交 hunk 是你自己落的
lspmsg R1a/R1b（`displayId: message.displayId || …`），`src/lspServerMessages.ts` 开工时 mtime **16:23**
⇒ 本轮一个字节没写这三份。这三份域内我只复验出一条值得看的：`src/progressNotices.ts` 的
`lspNoticeOf` / `lspNoticeId` / `lspFinishedNoticeOf` / `lspInterruptedNoticeOf` 四条出口在 `src/`（含 `.vue`）**零外部消费者**
（只在模块内自用 + 各自测试）⇒ 不是死码，但"导出面比需要的宽"，等这三份落稳后由 owner 决定 un-export。

② **status2 W1 / W2 / W5**：仍然只能你接，卡点与可照抄段没变，且本轮实测**三条一条都没落地**——
`grep -c "messageDialog\|showMessage\|MessageHost" src/App.vue` = **0**、`src/components/MessageDialog.vue` 与
`src/components/NotificationsSettingsPage.vue` 都**不存在**、`src/App.vue:2329` 仍是裸
`<InternalErrorsChip :active=… :is-desktop=… :show-log=… />`（没有 `showWidget('fatalError')`）。
W5 补一句：上游 `FatalErrorWidgetFactory.java:33` 的 `isConfigurable() = false` 本轮复核仍在 ⇒ **维持现状也讲得通**；
真要做得"条目 + 模板 `showWidget`"同批，否则 `KNOWN_GAPS` 为空的那道门必红。

③ **status2defect W1（判词过期）—— 本轮收工前已由另一条路闭合，不需要再做了**：
`scripts/verdict_table.py` mtime **17:06**，`pf/progress` 那条 reason（`:367`）已重写成
"原写「本仓任务不能暂停」为假"并逐支对上 `progressSuspender.ts` 的现形接口，同时把我本来要交接的两件新事实
（(a) 任务体已收 `indicator` 并先 `awaitResumed()` —— 脚本里写的是 `src/gradleHost.ts:222-226`，**本轮实测是 `:216-220`**
（该文件 17:02 又被写过，检查点仍在，行号漂 6 行）；(b) `text()`/兜底文案是"因全仓零读者删掉"、
`suspend()` 因此不带 reason）**已经写在里面**；`python scripts/verdict_table.py --check platform_rest` = **一致 3/3**，
⇒ 看板 §十六 那句"`--check platform_rest` 现在仍红 exit 1、差 11 行"随之消解（收口时把那条待办撤掉）。
`grep -c "本仓任务不能暂停"` 现在仍是 1，但命中的是否定句（"…为假"），不是原判词。

④ **`createStatusBarWidgetInstances`（status2defect「顺带」，唯一还挂着的一条函数级死出口）**：
本轮实测**确实仍是**"只过自己的测试"，但它不能单删 —— 整批做法与连锁数字：
- 现状：`src/statusBarWidgets.ts:142` 的 `createStatusBarWidgetInstances` 在 `src/`（含 `.vue`）**零消费者**，
  唯一引用者是 `tests/status-bar-widget-instances.test.mjs`（124 行 / 5 条用例）；而它内部调的
  `installWidget`/`disposeWidget` 正是 `src/statusBarLifecycle.ts`（门控数法 **105 行**）在全仓 `src/` 里唯一的消费者
  （只有 `src/statusBarWidgets.ts:27` 那一份 import）⇒ **只删入口 = `statusBarLifecycle.ts` 当场变成 orphan 门新增红**
  （它不在基线里，门会直接红，等于用一个门禁红换掉另一个门禁红）。
- 两条合法做法都要**整批**做：**(甲)** 在 `src/App.vue` 给状态栏组件一个真实例宿主（保留文件，余量 30 行 ⇒ 要算腾位）；
  **(乙)** 按"死面直接删"一次删干净：`createStatusBarWidgetInstances` + `StatusBarWidgetHost` + `StatusBarWidgetInstances`
  （`src/statusBarWidgets.ts` 约 −65 行）+ `src/statusBarLifecycle.ts` 整份 +
  `tests/status-bar-widget-instances.test.mjs`（124/5）+ `tests/status-bar-lifecycle.test.mjs`（147/15），
  再复跑 `tests/status*` 与 orphan 门。
  我倾向 **(乙)**（本仓状态栏组件全部由 App.vue 模板直接渲染，上游那套"`LinkedHashMap<Factory, Widget>` + `widgetIdMap`"
  在本仓没有对应宿主），但它会删掉两条上游链的覆盖（`EditorBasedWidget.kt` 的实例语义 + `StatusBarWidgetSettings` 的卸载侧），
  **不该由一条窄 lane 单方定** ⇒ 交回你拍。

⑤ **`docs/batch-2026-10-06-status2.md:27` 的两处错引用**（不在我名下 ⇒ 没动）：
`…/status/StatusText.java` 应为 `platform/platform-api/src/com/intellij/util/ui/StatusText.java`（不在 `wm/impl/status/`），
而它说的 `myTimeText` 字段其实属于 `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/StatusPanel.java:49`
（读者 `:67-70`，写 `:201`/`:205`/`:213`）。本轮是为了核 `src/statusBarText.ts` 的引用才打开的，留给你分派给文档 owner。

## 7. 残留风险 / 无法核实

① `src/statusBarWidgets.ts:26` 那句"`dispose` 之后所有更新一律返回这条保护"引的 `EditorBasedWidget.kt:96-109` **对不上**
（实测那 14 行是 `isOurEditor` 委派 `:97`、`getSelectedFile` `:99-104`、`install` + project assert `:105-110`），
本轮**没能核实**那条保护的上游真身 ⇒ 登记为"无法核实"，注释**保持原样没动**（不改 = 不假装核过）。
② 参考树里没有 `localization-zh` 包 ⇒ 本轮**没有新增任何界面中文措辞**（新判据只读代码与模板，夹具 id 不上界面），
无"中文措辞无法核实"项。
③ 函数级死出口**仍然没有门禁**（`find-orphan-modules.mjs --gate` 只查模块级）。我没有把 §6-④ 那条死出口"登记进某个门"
来让它变绿 —— 那是把缺陷换成通行证。若要补，现成的形状是 `tests/progress-queue-suspend.test.mjs:44-54`/`:57-76`
那种 `Object.keys(...)` + `deepEqual` + `doesNotMatch(声明)` 三件套（§5 的 A/B/C 就是按这个形状自证的）。
④ `src/progressPanel.ts.bak`（看板 §十六 记的游离备份）仍在盘上，且被"谁在读队列"的 grep 命中
⇒ 它会给该问题制造第二个答案；删不删仍按看板那句"等收口问用户"。
⑤ 本轮**没有**新增设置项、控件、键位或桥接字段；`src/App.vue` 的 30 行余量、`src/bridge.ts` 的 0 行余量、
`CodeEditor.vue` 的 2 行余量都没被消耗，也没被任何新请求进一步占用（§6 四条交接里只有 ②/④(甲) 需要宿主行，
两条的现成可照抄段分别在 `docs/wiring-requests-2026-10-06-statusbar.md:29-86` 与 `…-status2.md` 的 W5）。
