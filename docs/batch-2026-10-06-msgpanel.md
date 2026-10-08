# batch-2026-10-06 · lane `msgpanel`（消息窗口 / 控制台输出分级）

> 派单：核对 `docs/inventory/verdict-platform_rest.md` + `platform_rest_verdict_table.md` 里
> console / messages / daemon 相关条目，并收掉**一个真正可做的用户可见缺项**。
> 参考树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（唯一事实来源）。
> `third_party/intellij-community` 是坏树，未使用。本机树**没有中文语言包** ⇒ 所有中文措辞一律标「无法核实」。
> `docs/inventory/**` 与 `scripts/verdict_table.py` 一个字没动（归主代理），订正全部写在 §8 的**账本订正请求**里。

## 0. 接手实况（先核后写，逐条开文件）

- 派单点名的两个"本仓候选"文件**不存在**：`src/debugOutputSeverity.ts`、`src/components/OutputPanel.vue`。
  实际存在的是 `src/dapOutputSeverity.ts`（161 行，DAP `output` 的 category→四档）；输出面板的组件是
  `src/components/RunConsole.vue`（654 行，桶 10 名下）与 `src/components/DebugConsolePane.vue`（117 行）。
  ⇒ 按实际文件名核。
- **派单要求特别检查的那条阈值现状正确**（历史注入是 `<= 4`，磁盘上是 `<= 2`）：
  · `src/dapOutputSeverity.ts:69` `DAP_OUTPUT_ATTENTION_MAX_SEVERITY = 2`、`:137`、`:142` 三处同一常量；
  · `src/lspServerMessages.ts:150`（`lspMessageGroupIdOf`）与 `:558`（`handleLogMessage`）都是 `severity <= 2`；
  · `src/progressNotices.ts:115`、`:124` 也是 `message.severity <= 2`；
  · `src/components/DebugConsolePane.vue:44` 读 `countDapOutputAttention`，呈现类名由 `dapOutputLineClass` 给（`sev-*` 五档在 `:106-109` 有对应样式，不是"只有模型没有画"）。
  判据：`tests/dap-output-severity.test.mjs`（阈值与上游锚点都钉着）。**本轮没有改动这些数字。**
- 上游坐标复用前先重数了一遍：`src/consoleScroll.ts` 里那六条 `ConsoleViewImpl.kt` 行号
  （`:481`、`:666`、`:1360-1361`、`:1367`、`:1684`、`:1708`）逐条 `sed -n` 对上了；
  该文件 `wc -l` = **1729**（引用门按 `split('\n').length` 数，报出来的上限是 1730）⇒ 六位行号必然是假引用。

## 1. 判词核对表

判定档：`[x]` 已做 · `[~]` 部分（写「本仓已有」+「还差」）· `[ ]` 未做 · `[-]` 不适用（给具体理由）。
本仓落点给「文件:行号」（本仓行号），上游给「相对路径:行号」（全部开文件数过）。

### 1a. 派单给的「上游候选」四条

| 项 | 判定 | 核实结果（原写 X、实际 Y） |
| --- | --- | --- |
| `ConsoleViewImpl.kt` | `[~]` | **存在**：`platform/lang-impl/src/com/intellij/execution/impl/ConsoleViewImpl.kt`，1729 行。账本里 `execution_verdict_table.md` 那行写 `[-] … 从未出现` 只对**类名**成立；它的**用户可见行为**早被拆到别处（见 §1c）。 |
| `MessageViewImpl` | `[-]` | **存在**：`platform/platform-impl/src/com/intellij/ui/content/impl/MessageViewImpl.kt`（109 行）。它本体**不是消息窗口界面**，而是「项目打开后才注册 `Messages` 工具窗口 + 把早到的 runnable 攒起来重放」这段生命周期：`:97` `TW_ID = ToolWindowId.MESSAGES_WINDOW`、`:98-99` 图标与 stripeTitle、`:101-107` `registerToolWindow`、`:42-70` `runAfterOpened` + `postponedRunnables`、`:73-79` 未初始化时读 `contentManager` 直接抛 `IllegalStateException`、`:81-90` `runWhenInitialized`。**本仓不适用**的理由：本仓没有"项目打开前没有工具窗口"这条时序（通知中心是应用级、欢迎页就在读它，见 `src/notices.ts:2-14` 记的 `NotificationEventAction` 那条链），也没有 `ToolWindowManager.registerToolWindow` 的运行期注册面 ⇒ 移植它等于造一个没有触发时机的队列。 |
| `DaemonMessageImpl` | **参考树里没有这个类** | `find -name "*DaemonMessage*"` 零命中 ⇒ 派单这条候选给的是**不存在的名字**（`daemon` 那一族在账本里是编辑器高亮管线：`DaemonCodeAnalyzer*`/`DaemonTooltip*`，与消息窗口无关）。不据它下任何判词。 |
| `ConsoleHyperlinkFilter` | **参考树里没有这个类** | `find -name "*HyperlinkFilter*"` 只有 `platform/execution-impl/src/com/intellij/execution/filters/AbstractFileHyperlinkFilter.java`、同目录 `PatternBasedFileHyperlinkFilter.java`、`platform/execution-impl/src/com/intellij/terminal/JediTermHyperlinkFilterAdapter.kt`、`Osc8UrlHyperlinkFilter.kt`、`platform/lang-api/src/com/intellij/execution/filters/InvisibleHyperlinkFilterProvider.kt` 与 terminal 插件那几族 ⇒ 控制台超链接的上游本体是 `HyperlinkFilterSupport` 一族，本仓对应物是 `src/consoleHyperlinks.ts` / `src/runHyperlinks.ts`（不在这轮的改动面里，只登记坐标）。 |

### 1b. 消息窗口 / 通知分级族（上游 `MessageCategory` + `Notification*` + `Lsp*`）

| 项 | 判定 | 上游坐标 | 本仓落点 | 一句话 |
| --- | --- | --- | --- | --- |
| 消息类别常量表（6 档） | `[~]` | `platform/platform-api/src/com/intellij/util/ui/MessageCategory.java:19-24`（SIMPLE=1…NOTE=6，是个 **int 常量接口**） | `src/dapOutputSeverity.ts:58`（四档）、`src/lspServerLog.ts` 的 `LspLogLevel`（1-4） | 本仓没有那张 6 档 int 表，而是**两条各自的上游映射**：LSP `MessageType` 1-5 与 DAP `category` ⇒ 分档按 `MessageEvent.Kind`（`platform/lang-api/src/com/intellij/build/events/MessageEvent.java:20-22`）落 4 档；`[-]` 的部分是 `NOTE`/`STATISTICS` 这两档本仓没有独立呈现（并入最低档），理由见 §6-C1。 |
| `MessageCategory`→错误树档别 | `[-]`（本 lane 不做，归属错误树） | `platform/platform-api/src/com/intellij/ide/errorTreeView/ErrorTreeElementKind.java:49-53`（ERROR→ERROR、WARNING→WARNING、INFORMATION/STATISTICS→INFO、SIMPLE→GENERIC、NOTE→NOTE）；同文件 `:18-20` 三档的 `IdeBundle.message("errortree.*")` 与图标 | `src/errorTree.ts`（**并发黑名单**，本轮只读不改） | 这条映射归错误树 lane；本轮实测它在账本里的行是 `pf/error-tree` 的 `NavigatableMessageElement` / `SimpleMessageElement`，两行"从未出现"列写歪（见 §8-L3）。中文措辞**无法核实**（无 zh 包）。 |
| 进程输出进消息窗口的分档 | `[ ]`（本仓等价：控制台分色） | `platform/execution-impl/src/com/intellij/execution/ExecutionHelper.java:124-125`（编译错误/警告按 `MessageCategory.ERROR`/`WARNING` 上报）、`:182-206`（stdout/stderr 以 `MessageCategory.SIMPLE` 逐段 `addMessage`） | 运行侧：`src/runInstances.ts` + `src/components/RunConsole.vue`（桶 10）；调试侧：`src/dapOutputSeverity.ts` | 上游把进程输出**同时**塞进 Messages 窗口的 errorTreeView（SIMPLE 档）；本仓走控制台一条链，不再抄第二份 ⇒ 判 `[ ]` 但**不补**（补了就是同一份文本两个 UI，属放假控件）。 |
| LSP 三个通知组的注册 | `[x]` | `platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt:464`、`:470`、`:476`（三条组 id 字面值；`:461-463`/`:467-469`/`:473-475` 三句"Default behavior"注释） | `src/notificationGroups.ts:41-71`（三条逐字对上）、`:164-173`（displayId 前缀表） | 组 id 与本仓 displayId 前缀一一对得上；`lspMessageGroupRegistered`（`src/lspServerMessages.ts:136-138`）拿注册表当闸，防"报一个上游没有的组"。 |
| 组的 `displayType` 兑现（弹不弹气球） | `[x]` | 同上一条注释 `:461`/`:467`/`:473`（BALLOON / NONE / NONE）+ `platform/ide-core/src/com/intellij/notification/NotificationGroup.kt:26` | `src/notificationGroups.ts:147-156`（`balloonFadeoutMs`/`showsBalloon`）→ 消费在 `src/notifications.ts:74-79`、`:87` | **本轮订正**：`src/lspServerMessages.ts` 里"本仓的通知面没有「静默组」这一档"与"progressNotices 把 displayId 写死 ⇒ 会多弹一个气球"两句已过期（R1a 早落地），已按实状改写并留痕（`src/lspServerMessages.ts:535-556`）。 |
| 组的 `isLogByDefault` 兑现 | `[ ]` | `platform/ide-core/src/com/intellij/notification/NotificationGroup.kt:26`（默认 true）、`platform/platform-impl/src/com/intellij/notification/impl/NotificationsConfigurationImpl.java:109`、`:125-147`（按组 register/changeSettings 带 `shouldLog`） | 注册表有值（`src/notificationGroups.ts:27-28`、`:65`）但**零消费者**（`grep -rln isLogByDefault src native` 只有 `notificationGroups.ts` 与 `lspServerMessages.ts` 的注释） | 真缺项，但落点在 `src/notifications.ts`（通知链核心，桶 6/status lane 名下）⇒ 不动别人的文件，写成接线请求 R2。 |
| 通知的 ERROR/WARNING 分档 | `[ ]` | `platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt:418-422`（`getNotificationType`：Error→ERROR、Warning→WARNING、Info/Log/Debug→INFORMATION） | `src/notices.ts:21-24`（`NoticeEntry` 只有 `error: boolean`）、`src/notifications.ts:78-94` | 本仓把"警告"和"错误"塌成同一个红点 ⇒ 上游是三档。落点在 `src/notices.ts` + `src/components/NoticeList.vue`（都不在本 lane 名下）⇒ 写成接线请求 R1（带可照抄代码）。 |
| `showMessageRequest` 的那一排按钮 | `[ ]`（**做不了，非偷懒**） | `:377-383`（问题转出）、`:424`+`:443-449`（每个 `MessageActionItem` 变一个 `AnAction`：`:446` `notification.addAction(...)`、`:448` `notification.expire()`、`:449` `result.complete(actionItem)` ⇒ **点了才**有值；`:454` `.notify(project)`） | `src/lspServerMessages.ts:197`（`messageActionsClickable = false`）、`:219-250`（choose/expire 已备） | 卡点不在界面而在宿主：`native/lsp.cpp:755-757` 对 `window/showMessageRequest` **先把回包答成 null 再转出** ⇒ 前端后点的那一下没法再答服务器。要做真按钮必须先改 native 的挂起-补答 + 一条前端→宿主回包通道；`src/bridge.ts` 贴顶（0 行余量）⇒ 请求 R3（含方案与代价），本轮**不放假按钮**。 |
| `$/logTrace` 的转出 | `[ ]` | `:407-414`（logTrace：`verbose` 拼进正文、printTrace、落 `:476` 那个组） | 无（`grep -rn logTrace native` 零命中；前端注册表也没这条方法） | 宿主那一头没有这一支转发 ⇒ 前端接了就是一条"没人喂的处置"（死出口）。lspmsg lane 的 R6 已提，本轮复核仍成立，登记在请求 R4。 |

### 1c. 控制台输出分级族（`ConsoleView*` / `ConsoleViewContentType`）

| 项 | 判定 | 上游坐标 | 本仓落点 | 一句话 |
| --- | --- | --- | --- | --- |
| 内容类型表（4 + 5 档） | `[~]` | `platform/ide-core/src/com/intellij/execution/ui/ConsoleViewContentType.java:37-40`（NORMAL/ERROR/USER_INPUT/SYSTEM 四个 TextAttributesKey）、`:31-35`（五个 `LOG_*_OUTPUT_KEY`）、`:42-50`（九个实例）、`:52`（`OUTPUT_TYPES` 只有四个）、`:54-58`（`ProcessOutputTypes.SYSTEM→SYSTEM_OUTPUT`、`STDOUT→NORMAL`、`STDERR→ERROR`） | 调试侧五档呈现：`src/dapOutputSeverity.ts:61`（`error/warning/system/normal/muted`）+ `src/components/DebugConsolePane.vue:106-109` 的 `.sev-*` 样式 | **USER_INPUT 那一档本仓没有**（运行控制台不 echoed 用户输入），`[~]` 的"还差"写这里；不新造一个没人喂的输入回显行。 |
| 贴底跟随 / 滚到末尾 | `[x]` | `ConsoleViewImpl.kt:666-668`（`shouldStickToEnd`）、`:1684-1686`（`isStickingToEnd`）、`:1708-1711`（`isVScrollAtTheBottom`）、`:481-487`（`updateStickToEndState`）、`:1360-1361`+`:1367`（`ScrollToTheEndToolbarAction` 建法与入表） | `src/consoleScroll.ts:41-53` + 消费方 | 六条行号本轮全部重数对上（见 §0）。 |
| 暂停输出（冻结跟随不冻数据） | `[x]` | `platform/execution-impl/src/com/intellij/execution/actions/PauseOutputAction.java`（ ToggleAction / `setEnabledAndVisible` 那条链） | `src/debugConsoleFreeze.ts` + `src/components/DebugConsolePane.vue:40-42`、`src/runOutputPause`（`tests/run-output-pause.test.mjs`） | 判词里 `LogConsole*`/`ClearConsoleAction` 那几行写"从未出现"，本仓早做了清空与暂停：`tests/run-console-clear.test.mjs`、`tests/run-output-pause.test.mjs` 两条判据都在跑（本轮实测绿）。 |
| ANSI 解码（彩色输出） | `[x]` | `platform/platform-util-io/src/com/intellij/execution/process/AnsiStreamingLexer.java:15`（`ESCAPE = '\u001b'`）、`:17`/`:132`（`SGR_SUFFIX='m'`、只有 `m` 终结才当 SGR）、`AnsiEscapeDecoder.java`（135 行，CONTROL 忽略 / system 流不解 ANSI） | `src/consoleAnsi.ts`（380 行）+ `src/runIssues.ts` | 本轮**复用**它做消息正文清洗（见 §2），没有重写词法器。 |
| DAP `output` category→档 | `[~]` | 参考树里**没有**这张映射（`grep -rn "OutputEvent" platform/xdebugger-impl` 零命中，DAP 协议本体是闭源 `intellij.cidr.debugger.dap`）⇒ 按公开协议语义落档，`src/dapOutputSeverity.ts:11-46` 已逐条写清哪条照谁 | `src/dapOutputSeverity.ts:89-143` | 判词口径沿用 dap 族：**category→severity 无法核实**（本机树里没有上游实现），照抄的只有 `MessageEvent.Kind` 的名字与顺序。 |

### 1d. 本轮改动直接覆盖的那族：LSP 服务器消息正文

| 项 | 判定 | 上游坐标 | 本仓落点 | 一句话 |
| --- | --- | --- | --- | --- |
| 通知正文剥 ANSI | `[x]`（本轮补） | `LspServerNotificationsHandlerImpl.kt:75`、`:424`、`:432-436`、`:438`、`:441`；`platform/lsp-impl/src/impl/serviceView/LspClientConsole.kt:40`、`:82-97`（`:85` 同一台解码器、`:96` 剥完才 `console.print`） | `src/lspServerMessages.ts` 的 `lspMessageVisibleText` + 入口那一行；判据 `tests/lsp-message-ansi.test.mjs`（7 条） | 见 §2。 |
| `LspClientConsole` 本体（独立输出窗口） | `[~]` | 同文件 `:60-79`（流量行 + `printTraffic`）、`:106-113`（工具条）、`:133-142`（payload 预览截断）、`:144-157`（`ERROR/WARN/INFO/LOG/DEBUG` 五档标签 → `LOG_*_OUTPUT` 五档颜色） | `src/lspServerLog.ts`（环形日志、级别/类别过滤、导出）+ `src/progressNotices.ts:66-75`（呈现面） | 账本 `ls/platform` 那条"缺：独立输出窗口"仍成立（要改 `App.vue` 的工具窗口装配）；**级别标签那一档本仓有**（`LspLogLevel`），流量级记录没有 ⇒ 见 §6-C3。 |

## 2. 本轮实现的用户可见缺项：LSP 消息正文的 ANSI 清洗

**缺项**：语言服务（jdt.ls / clangd / rust-analyzer 这类）在 `window/showMessage`、`window/logMessage`、
`window/showMessageRequest` 的正文里带 ANSI 颜色码时，本仓的消息面**原样显示转义垃圾**。
链路实测：`native/lsp.cpp:697` 用 `tag_server_message(...)` 原样带正文（不剥），
`src/lspServerMessages.ts` 的入口把 `data.message` 直接塞进队列，
`src/progressNotices.ts:113-121` 把它当通知正文、`:124` 再配一行日志，
日志尾部同时是 `lspLogNoticeOf` 的 detail 与「复制日志」的导出内容 ⇒ **三处用户可见出口共用同一段文本**。

**上游怎么做**：`LspServerNotificationsHandlerImpl.kt:432-436` 在 `doNotify` 里先用
`ansiDecoder.escapeText(message, ProcessOutputTypes.STDOUT)` 把正文换成 `cleanedMessage`，
`:438` 才拼通知文案、`:441` 交 `createNotification`；语言服务输出那一半同规矩
（`LspClientConsole.kt:82-97`，`decodeAnsi` 默认 true）。

**本仓怎么做**（`src/lspServerMessages.ts`）：
1. 新增 `lspMessageVisibleText(raw)`：复用 `src/consoleAnsi.ts` 的 `createConsoleAnsiDecoder()`（不写第二台词法器），
   按行喂、跨行保留状态；**只剥上游剥的那些**——SGR 改状态、其余 CONTROL 忽略、
   **OSC 上游不当它是转义序列 ⇒ 原样留着**（这条边界有判据钉着，见 §4 注入 2）。
2. 在唯一入口 `handleLspServerMessageEvent` 里取正文时过一遍
   （`const text = typeof data.message === 'string' ? lspMessageVisibleText(data.message) : ''`）
   ⇒ 通知行、日志行、日志尾部/导出三处同时干净，等价于上游"两处各解一遍"的净效果。
3. 没有新增 UI 控件、没有新增设置键、没有改 native。消费链本来就在跑
   （`bridge.ts:393` → `src/lspProgress.ts:146` → 本模块入口 → `progressNotices` 的 watcher），
   判据里有一条专门钉这条链（§5）。

**为什么这是"真能做"而不是替上游补设计**：上游那两处 `escapeText` 是本族唯一的分级/清洗决定，
本仓只是把它漏在了通道入口。

## 3. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 动作 |
| --- | ---: | ---: | --- |
| `src/lspServerMessages.ts` | 674 | 716 | 加 `createConsoleAnsiDecoder` import、`ANSI_ESCAPE` 常量、`lspMessageVisibleText`、入口那一行；两处过期注释按实状改写并留痕。上限 900 ⇒ 716 仍有余量（`tests/module-size.test.mjs` 实测绿）。 |
| `tests/lsp-message-ansi.test.mjs` | — | 140 | 新增判据（7 条，含"上游锚点逐行核内容"一条自证参考树）。 |
| `docs/batch-2026-10-06-msgpanel.md` | — | 本文件 | 交付报告。 |
| `docs/wiring-requests-2026-10-06-msgpanel.md` | — | 新 | 接线请求 R1-R4。 |
| 未改动 | — | — | `src/progressNotices.ts`、`src/notificationGroups.ts`、`src/consoleScroll.ts`、`src/dapOutputSeverity.ts` 只核没改（核对结论见 §1）；`src/debugOutputSeverity.ts`、`src/components/OutputPanel.vue` 不存在（§0）。 |

## 4. §5 门禁自查的前后数字

| 命令 | 前（基线） | 后（收工） |
| --- | --- | --- |
| `node --test tests/<域 19 份>`（`console-*`、`dap-output-severity`、`debug-console-freeze`、`lsp-progress`、`lsp-server-log`、`lsp-server-messages`、`message-dialog`、`notification-*`(6)、`progress-notices`、`run-console-clear`、`run-output-pause`） | 183 tests / 183 pass / **0 fail** | 190 tests / 190 pass / **0 fail**（+7 = 本 lane 新增判据） |
| `node --test tests/lsp-message-ansi.test.mjs` | —（新文件） | 7 / 7 / 0 fail |
| `node --test tests/module-size.test.mjs` | 5 / 5 / 0 fail | 5 / 5 / 0 fail |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2 ⇒ 绿 | 同一串数字，**新增 0** ⇒ 绿（没有新模块，只在一个既有模块里加函数） |
| `.tools/find-missing-ext.mjs` | 扫描 1375 文件，干净 | 扫描 1378 文件，干净（+3 是并发 lane 与本文件的 .mjs） |
| `node .tools/find-param-props.mjs` | 0 处 | 0 处 |
| `.tools/find-ts-in-mjs.mjs` | 干净 | 干净 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 tests / 8 pass / **3 fail** | 11 / 8 / **3 fail**（**同 3 条**，全是别人的在途红，见 §6-D 与 §8-L1/L2；本轮没有新增一条） |
| 隔离 tsconfig `npx tsc -p build/tsconfig.msgpanel.json --noEmit`（files 只含本 lane 五个文件） | — | **0 错，EXIT=0**（临时 tsconfig 收工已删） |
| `npx vue-tsc --noEmit -p tsconfig.json`（全树，不用 `-b`，避开抢 `.tsbuildinfo`） | 中途一次读到 2 条（并发 lane 在途），复跑 | **0 错，EXIT=0** |
| `npm test` 全量 | **按要求没跑**（12 路并行，会把他人在途红算到本 lane） | 同左 |

## 5. 反向验证记录（前缀 `MSGPANEL`）

| # | 注入了什么 | 结果 |
| --- | --- | --- |
| 1 | `src/lspServerMessages.ts` 入口退回 `const text = ... data.message ...`（不剥 ANSI） | `tests/lsp-message-ansi.test.mjs` **4 条红**：三条端到端 + 「用户可见链」那条源码锚点（7 tests / 3 pass / 4 fail） |
| 2 | `lspMessageVisibleText` 末尾多删一层 OSC（越过上游词法边界） | **1 条红**：「词法边界照上游：CONTROL 忽略、OSC 不当转义、状态跨行延续」（7 / 6 / 1）⇒ 判据不是只测"有没有清洗"，也钉住"不许多清" |
| 3 | 在 `src/lspServerMessages.ts` 注释里写一条假上游引用（`msgpanel-inject-probe/FakeClass.kt:999999`） | 引用门**没收集**它：`citationsOf` 只收首段属于 `platform/plugins/java/kotlin/python/wire/tools` 的完整路径 ⇒ 记进 §8 的取证口径 |
| 4 | 在**本报告**里写一条真路径 + 六位行号（照 `findrep2` 那次的形状） | `tests/source-citations.test.mjs` 的红从 1 条变 2 条（数组里多出 `docs\batch-2026-10-06-msgpanel.md :: ConsoleViewImpl.kt:<越界>-<越界> —— 行号超出文件长度`）⇒ **报告里的引用形状也进闸门**，删掉该行后复回 1 条 |
| 还原 | 撤掉注入 1、2、3、4 | `node --test tests/lsp-message-ansi.test.mjs` 7/7 绿；引用门回到基线那 3 条；`sha1sum -c` 两份文件 **OK**（`src/lspServerMessages.ts` = `8de83efcf930dda5acd922f0f3756ef575db20a3`、`tests/lsp-message-ansi.test.mjs` = `386a0f387d4c230081ff3febbbab47998011ddd2`，还原前后同一份）；`grep -rn "MSGPANEL-INJECT\|msgpanel-inject" src tests native docs` ⇒ **0 命中**；`grep -rn MSGPANEL src tests native` ⇒ **0 命中** |
| 另：假控件自查 | 本轮没有新增任何 UI 元素/按钮/设置项 | 不需要"不放假控件"的例外申报；§1b 里那条 `showMessageRequest` 按钮正因为兑现不了才**不做**（请求 R3） |

## 6. 零消费方自查 / 做不到与无法核实

### 零消费方
- 没有新建 `.ts` 模块 ⇒ `find-orphan-modules.mjs --gate` 的"新增 0"直接成立。
- 新增的唯一导出 `lspMessageVisibleText` 有**生产读者**：同文件入口 `handleLspServerMessageEvent`（`:682` 起那一条），
  其调用链是 `src/bridge.ts:393` → `src/lspProgress.ts:146`；它不是"只过自己测试"的死出口，
  §5-1 的注入正是把入口改回原样才让端到端那 3 条红的。
- `docs` 里新增两份文档，无代码消费问题。

### 做不到（具体卡在哪一环）
- **C-4 `showMessageRequest` 的真按钮**：卡在宿主回包时机 —— `native/lsp.cpp:755-757` 先 `respond(id, null)` 再
  `forward_server_request(...)`，前端拿不到 JSON-RPC 的 id 也无法补答；要改就是
  ①宿主挂起该 id 不答、②新开一条前端→宿主"补答服务器请求"的通道、③`bridge.ts` 事件登记（该文件 0 行余量）。
  ①②是 native + bridge 两处保留/贴顶面，③不在本 lane 授权面 ⇒ 按规约只写请求（R3），不写假按钮。
- **C-5 `$/logTrace`**：宿主没转发这条（`native/lsp*.cpp` 里 `logTrace` 零命中）⇒ 前端注册处置器就是死出口（请求 R4）。
- **C-6 `isLogByDefault` / 通知 ERROR-WARNING 分档**：落点分别在 `src/notifications.ts`、`src/notices.ts` +
  `src/components/NoticeList.vue`，都不在本 lane 名下（桶 6 的在途面）⇒ 请求 R1、R2。
- **C-7 Messages 工具窗口本体**：`MessageViewImpl` 的运行期 `registerToolWindow` + 早到消息重放没有触发时机
  （本仓通知中心是应用级、欢迎页就在读），要画独立「消息」窗口得改 `App.vue` 的工具窗口装配 ⇒ 判 `[-]` 并留 §1b 的理由，不新造窗口。

### 无法核实（不编）
- **中文措辞**：本机树没有 zh 语言包 ⇒ 「消息」「通知」窗口/组/错误树各档的中文名一律**无法核实**；
  本轮没有新增任何中文文案（改动只清洗既有文本，一个字都没加）。
- **DAP `output` 的 category→severity 映射**：参考树里没有上游实现（`platform/xdebugger-impl` 全树 `grep OutputEvent` 零命中，
  协议本体是闭源 `intellij.cidr.debugger.dap`）⇒ 只能按公开协议语义，`src/dapOutputSeverity.ts:11-46` 已写明。
- **`DaemonMessageImpl` / `ConsoleHyperlinkFilter`**：参考树里没有这两个类名 ⇒ 派单这两条候选**无法核实**，本轮不据它们下判词。
- **哪个真服务器在 `window/showMessage` 里发 ANSI**：本机树里查不到、也不许上网 ⇒ 不写"某某服务器会发色码"这种话；
  清洗的**依据**只有上游那两处 `escapeText`（`LspServerNotificationsHandlerImpl.kt:432-436`、`LspClientConsole.kt:82-97`）。

## 7. 需要主代理接的线

全部单放 `docs/wiring-requests-2026-10-06-msgpanel.md`（R1 通知三档 tone、R2 `isLogByDefault` 的写中心闸、
R3 `showMessageRequest` 的挂起回包 + 真按钮（native + `bridge.ts`）、R4 `$/logTrace` 转出、R5 中文措辞一律「无法核实」清单）。
其中 R1 的第 4 步与 R3 的第 3 步、R4 的前端处置器都在本 lane 名下文件里，**宿主/保留文件一到位我就能补**（不提前放控件）。

## 8. 账本订正请求（只提请求，没动 `docs/inventory/**`）

- **L1（红，非本 lane 造成）**：`docs/batch-2026-10-06-findrep2.md` 里给 `ConsoleViewImpl.kt` 钉了一个六位行号
  （超出该文件长度），`tests/source-citations.test.mjs` 因此**恒红一条**（本 lane 开工基线就是红的）。
  本报告按规约不转述那条完整形状（转述会被当成一条真引用）。请由主代理删掉那处的行号或改指真行号。
- **L2（红）**：`tests/source-citation-anchors.test.mjs` 的快照里有两条 `moved`：
  `src/commitChecks.ts` → `platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/CommonCheckinFilesAction.kt|26-78`，
  以及 `src/components/ProblemsPanel.vue` → `platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java|19-19`。
  本 lane 两个文件都没动 ⇒ 是别的批改了引用点后快照没重算。请重跑 `scripts/verdict_table.py` 的快照生成（`platform_verdict()` 那侧），**不要手改**。
- **L3**：`platform_rest_verdict_table.md` 的 `pf/error-tree` 两行（`NavigatableMessageElement`、`SimpleMessageElement`）
  最后一列写「从未出现」，但 `src/errorTree.ts` 的对照注释里逐字点了 `NavigatableMessageElement`（`:19`、`:22` 附近），
  且两类的上游本体在 `platform/platform-impl/src/com/intellij/ide/errorTreeView/`（本轮 `find` 实测存在）。
  机器扫描按"名字出现在代码里"判零命中没有错，但**判词列**应写「行为已移植/名字只在注释里」，
  否则下一批会把它当"没人做过"重做一遍。
- **L4**：同一张表里 `ConsoleViewImpl` 的行在 `execution_verdict_table.md:948` 写 `[-]`，
  实际其用户可见行为已被拆成 `[x]` 的三条（贴底跟随 `src/consoleScroll.ts`、暂停输出 `src/debugConsoleFreeze.ts`、
  ANSI 分色 `src/consoleAnsi.ts`）。`verdict-settings-run.md` 里那条 `ConsoleViewImpl | [ ]` 同理。
  建议：类名档保留机械判定，但 lane 文本里补一句"按功能扫已有落点"（与 `ConsoleFolding` 那两条 870/1610 行的订正同一口径）。
- **L5**：派单/账本里 `DaemonMessageImpl`、`ConsoleHyperlinkFilter` 两个类名在参考树中**不存在**（§1a）。
  若这两条来自某张候选清单，请从清单里删名并换成真名：
  控制台超链接一族 = `platform/execution-impl/src/com/intellij/execution/filters/AbstractFileHyperlinkFilter.java`；
  消息/分档一族 = `platform/platform-api/src/com/intellij/util/ui/MessageCategory.java` + `.../errorTreeView/ErrorTreeElementKind.java`。
- **L6（口径提示）**：`src/consoleScroll.ts` 与账本都按"1730 行"记 `ConsoleViewImpl.kt`，`wc -l` 是 1729
  （引用门按 `split('\n').length`=1730 判越界）。两套数法差 1，写行号请一律 ≤ 1729。
