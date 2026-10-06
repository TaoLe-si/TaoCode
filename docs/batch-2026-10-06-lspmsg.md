# 批次报告 · 2026-10-06 · `lspmsg`（语言服务「服务器主动消息/请求」响应面）— 收尾 + 补它没做完的那半

> 域：`src/lspServerMessages.ts`、`src/lspProgress.ts`、`src/lspServerLog.ts` 与 `tests/lsp-*`。
> 上一批（同一域，撞到 150 次调用上限）的最后一句是「现在给日志类别加 dropped 档，并让前端消息通道接上新模块」：
> 前半截落了地（`LspLogKind` 里有 `'dropped'`，`src/lspServerLog.ts:24`），后半截**没落**，而且它留了一段变异注入
> （`if (message.severity <= 4)`），主代理已改回 `<= 2`（现状实测在 `src/lspServerMessages.ts:333`，与上游 `:399` 的
> `MessageType.Error || MessageType.Warning` 一致），见 `docs/batch-2026-10-06-main.md` §10.3。
>
> **本轮实跑的结论**：「接上新模块」缺的不是那几个新字段，而是**通道本身是死的**。
> `lspServerMessages` 原来是普通数组（`export const lspServerMessages: LspServerMessage[] = []`），
> 而唯一消费方 `src/progressNotices.ts:110` 挂的是 `watch(() => lspServerMessages.length, …)`。
> Vue 的 `watch` 只跟踪**响应式**依赖，普通数组的 `push` 不登记任何依赖 ⇒ 那个 watcher 一次也没醒过。
> 后果（不是推的，§4 注入 A 实测）：服务器消息照旧进队列，但通知面一行都不显示，
> watcher 循环体里那句 `logLspServerMessage(message)`（`src/progressNotices.ts:112`）也不执行
> ⇒ Error/Warning 级的 `showMessage` 与 `logMessage` **既没气球也没日志行**；
> 而这一类丢弃发生在队列那一头，`lspServerMessageDrops` 抓不到（那条只抓「方法没人接」）。
> 这就是「声明了 capability 却没处理器」的第二种形状：处理器在、通道是死的。
> 本轮改成 `reactive`（`src/lspServerMessages.ts:250`），补三条判据（含端到端真跑 watcher），
> 并顺手订正了两处**数错的上游行号**（§4b）。
>
> 上游坐标全部本机逐条 `grep -n` 定行（`D:\Backup\Downloads\intellij-community-master\intellij-community-master`），未上网。

## 1. 判词表

| 族 | 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话说明 |
|---|---|---|---|---|---|
| 服务器主动消息 | `window/showMessage` 有处置**且真送得到界面** | `[x]` | `platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt:385-390`（logInfo + `doNotify(..., SHOW_MESSAGE_NOTIFICATION_GROUP)`）、`:454`（doNotify 末尾 `.notify(project)` = 真的显示出来） | `src/lspServerMessages.ts:314`（`handleShowMessage`）→ 队列 `:250` → `src/progressNotices.ts:110-118` | 本轮修的就是「送得到」那一半：队列改 reactive 之后 `watch` 才醒；端到端判据量的是 `notifyProgress` 被叫了几次 |
| 服务器主动消息 | `window/logMessage` 分级（Error/Warning 可见、Info/Log 静默） | `[~]` | 同文件 `:393-404`（Error/Warning → `LOG_ERRORS_WARNINGS_NOTIFICATION_GROUP`；else → `LOG_INFO_TRACE_NOTIFICATION_GROUP`，注释原文 `Do not spam user with all the logs from the server`）、`:467`/`:473`（两组各自的「no balloon, only write to the Notifications tool window」/「no notification」） | `src/lspServerMessages.ts:332`（`handleLogMessage`，`:333` 的 `severity <= 2` 才入队）+ 日志 `src/lspServerLog.ts:118` | 本仓已有：分档（谁进日志、谁进队列）齐了，判据也钉着；还差：入队那一条的**归组**没兑现 —— 消费方把 displayId 写死成 `lsp:message:<语言>`（`src/progressNotices.ts:117`），于是 Error/Warning 级 logMessage 现在多弹一个气球（上游那一组 displayType=NONE）。请求 R1a，那行不在我名下 |
| 服务器主动消息 | `window/showMessageRequest` 的答复语义 | `[~]` | `platform/lsp/src/api/Lsp4jClient.kt:62-63`（`CompletableFuture<MessageActionItem>`）、`LspServerNotificationsHandlerImpl.kt:377-382`（disposed ⇒ `completedFuture(null)`；否则把 `actions` 标题一起 `logInfo`）、`:443-451`（只有按钮被点才 `notification.expire(); result.complete(actionItem)`） | `src/lspServerMessages.ts:346`（`handleShowMessageRequest`）+ 回选那组出口 `:159-205` | 语义齐（点不到 ⇒ 当场按 null 收掉、不留一条永远没人答的请求，日志如实写「通知面上点不到动作」）；UI 那一排按钮与回程要动 native ⇒ R2/R3，所以停在 `[~]` |
| 服务器主动消息 | 五条 refresh 的处置（答 null + 缓存作废重取） | `[x]` | `Lsp4jClient.kt:86-99`（五条 `CompletableFuture<Void>`：`:86`/`:89`/`:92`/`:95`/`:98`）、`LspServerNotificationsHandlerImpl.kt:341-368`（`completedFuture(null)` + 让对应缓存重取；**原写 `:341-371` 是数错的，见 §4b**） | `src/lspServerMessages.ts:371`（`handleRefresh` → `clearAllLspCaches()` + 一行 `kind:'refresh'` 日志）、方法表 `:54-60` | 宿主这头也真转得出：`native/lsp.cpp:583-590` 把 `showMessageRequest` 与 `is_refresh_request(method)` 一起走 `server_message_` 出口，`native/lsp.cpp:177-181` 补 `method` |
| 服务器主动消息 | 第六条 refresh（`refreshTextDocumentContent`） | `[-]` | `Lsp4jClient.kt:101-102`、`LspServerNotificationsHandlerImpl.kt:369-374`（`:371` 转给 `lspClient.dynamicFiles.refreshContent(params.uri)`） | 本仓无落点 | 不适用（具体理由）：那是 IntelliJ 扩展方法，服务于 dynamic files 内容提供器；本仓没有「服务器代管虚拟文件」这条链（`native/lsp.cpp:162` 早就判成 MethodNotFound），接上就是假控件。声明侧也没声明（`grep -rn "textDocumentContent\|dynamicFiles" native/ src/` 只命中那一行注释） |
| 服务器主动消息 | `$/logTrace` | `[ ]` | `Lsp4jClient.kt:83-84`、`LspServerNotificationsHandlerImpl.kt:407-414`（写 Services 控制台 + `LOG_INFO_TRACE` 组） | 未注册处置 | 宿主的通知分支（`native/lsp.cpp:501-535`，`if (!handler) return;` 在 `:529`）没有这一支 ⇒ 转不出来；注册一条只过自己测试的死出口，违 `.tools/agent-rules.md` §5。等 R6 落地一行接上 |
| 服务器主动消息 | `telemetry/event` | `[-]` | `LspServerNotificationsHandlerImpl.kt:184`（`override fun telemetryEvent(`object`: Any) {}`） | 未做 | 不适用（具体理由）：上游本体就是空实现，本仓做出来就是比上游更多 |
| dropped 档 | 「没人接」的计数可观察 | `[x]` | 上游没有这一层（它靠 `Lsp4jClient.kt:42-43` 的 `@ApiStatus.OverrideOnly open class Lsp4jClient` —— 未文档化方法**必须**插件自己子类化才接得住，认不得的就没有处置口）；本仓要的是「这件事看得见」 | `src/lspServerMessages.ts:276`（`reactive { total, byMethod }`）、读口 `:279`（`droppedLspServerMessages(method?)`）、复位 `:283` | 实测（本轮 Node 直调）：发一条 `$/logTrace` ⇒ 总数 1、按方法 1、队列 0 条（没有被冒充 showMessage 弹出去） |
| dropped 档 | 一行「语言服务」日志 | `[x]` | 同上 | `src/lspServerMessages.ts:292`（`noteDroppedServerMessage`，同一个方法**只写第一次**）、类别 `src/lspServerLog.ts:24`（`'dropped'`）、表 `src/lspServerLog.ts:106` | 实测落进表的那一行：`[..] [java] dropped: $/logTrace：前端没有登记这一条的处理器，已丢弃（本条方法累计 1 次）`，level=3（不谎报成错误） |
| dropped 档 | 界面上有人说得出这份计数 | `[ ]` | 上游没有对应界面（本仓的对应物是状态栏 LS 面板那句「这条消息有没有人接」，语义依据 `LanguageServiceWidgetItem.kt:53-80`：客户端有问题 ⇒ 界面叠错误标记） | 无生产读者 | `droppedLspServerMessages`/`lspServerMessageHandlerMethods`/`resetLspServerMessageDrops` 三个出口只被判据读 ⇒ 本轮不自己造读者（不放假控件），写成请求 **R8** |
| 注册表 | 八条内置处置都注册、且模块加载即装好 | `[x]` | `Lsp4jClient.kt:59`/`:62`/`:68` + `:86-99`（3 条消息 + 5 条 refresh，与八个方法一一对应） | `src/lspServerMessages.ts:380`（`registerDefaultLspServerMessageHandlers`，幂等）、`:388`（加载即注册）、消费点 `:395`（`handleLspServerMessageEvent` 查表） | 实测 `lspServerMessageHandlerMethods().length === 8`；生产链在：`src/bridge.ts:393` → `src/lspProgress.ts:146` → `:395` |
| 注册表 | 返回值有没有真实调用方 | `[~]` | — | `src/lspServerMessages.ts:380` 的 `: number`；读者只有 `tests/lsp-server-messages.test.mjs:62` | 如实：**通道不是假的**（八条处置被 `:395` 真实消费），只有「返回值」没人读 ⇒ 判据给了两个终局（面板拿它自检 / 降成 `void` 并把 `:62` 那条断言改成读 `lspServerMessageHandlerMethods().length`，强度不变），见请求 **R8**。本轮不删：删要动上一轮刚立的幂等断言（§3 不许放松） |
| 前端通道 | 消息队列只有一份（没有旧通道在读） | `[x]` | — | `src/lspServerMessages.ts:250`（全仓唯一声明处）、`src/lspProgress.ts:27-30`（只转出、不产出）、消费方 `src/progressNotices.ts:21`+`:110` | 实测两条 import 路径（`./lspServerMessages.ts` 与 `./lspProgress.ts`）拿到的是**同一个对象** ⇒ 没有第二份数据要收敛；要收敛的只是 import 别名（请求 R9） |
| 前端通道 | watcher 真的醒（本轮的主修） | `[x]` | `LspServerNotificationsHandlerImpl.kt:454`（`.notify(project)` —— 上游的判据也是「界面收得到」，不是「代码走到过」） | `src/lspServerMessages.ts:250`（`reactive<LspServerMessage[]>([])`）+ 判据 `tests/lsp-server-messages.test.mjs:284`、`:302` | 注入 A 实测：改回普通数组 ⇒ 通知行数量恒 0（2 条判据红）；改回 reactive ⇒ 两条消息变两个通知行 + 两行日志 + 队列被读空 |
| 前端通道 | 队列条目自带的 `group`/`displayId`/`requestKey` 被界面读走 | `[ ]` | `:461-476`（三个组各自的默认行为由**组**决定弹不弹）、`:443-451`（按钮那一排） | `src/lspServerMessages.ts:221-241`（字段已随条目带出） | 消费方那几行不在我名下 ⇒ R1a（displayId 一行）与 R2（按钮一排）。本轮如实：带着字段，没人读 |
| 能力声明 | `window` 侧能力与本响应面一致 | `[x]` | `platform/lsp/src/api/LspClientCapabilities.kt:246-249`（`showMessage = WindowShowMessageRequestCapabilities(); showDocument; workDoneProgress = true`） | `src/lspServerMessages.ts:54-60`、`:107-122`（分派与归组） | 本仓声明面（`native/lsp_host_bootstrap.cpp:271`）只给 workDoneProgress ⇒ 声明与实发一致；`window/showDocument` 判 `[-]`（理由见请求文档末尾第 2 条） |

## 2. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 这次改了什么 |
|---|---|---|---|
| `src/lspServerMessages.ts` | 399 | 425 | ①`lspServerMessages` 由普通数组改成 `reactive<LspServerMessage[]>`（`:250`）+ 声明处与文件头写清「为什么必须是响应式的」；②`handleLogMessage` 的注释（`:324-331`）补上「归组还没兑现、现在多弹一个气球」的如实留痕；③文件头的 refresh 坐标 `:341-371` → `:341-368` 并注明第六条在 `:369-374`（§4b） |
| `src/lspProgress.ts` | 194 | 194 | 只改一处注释行号：`cancelAllProgress` 的坐标 `:331-339` → `:335-339`（`:164`）。代码零改动（注入 B 已撤回，`git diff -- src/lspProgress.ts` **为空**） |
| `src/lspServerLog.ts` | 137 | 137 | 零改动（`'dropped'` 档上一批已落，本轮只是核实计数与日志都在；顺手确认它引的 `:341-368` 本来就是对的） |
| `tests/lsp-server-messages.test.mjs` | 259 | 324 | 新增三条判据（`:265` 队列只有一份 / `:284` 队列必须 reactive / `:302` 端到端真跑 watcher）+ 头注行号订正；既有 12 条的**断言体一字未动**、未删断言、未放松 |
| `docs/batch-2026-10-06-lspmsg.md` | — | 162（本文件） | 新建：上一批被切断时一个字报告都没留 |
| `docs/wiring-requests-2026-10-06-lspmsg.md` | 207 | 305 | 复核并**订正三处数错的坐标**（R3 的 payload、R4 的 folders、R7 的 main.cpp 触发点，留痕写法在文档开头）、R1a/R1b 的状态变化、新增 **R8**（真实读者/删返回值）与 **R9**（旧 import 路径 + 五处过时注释）、末尾补第 6 条「第六条 refresh 不做」 |

## 2b. 工作区备注（主代理需要知道的两件事）

- **本批全程没有 `commit`/`push`，也没有跑任何丢弃类 git 命令**（§6 纪律）。但共享工作区在本轮中途被别的路提交过两次
  （`7220a76`、`1e2f7f7`），**把我这一片的在途改动一起带进了 HEAD**：现在 `git show HEAD:src/lspServerMessages.ts` 里已经是
  `reactive<LspServerMessage[]>`，`git show HEAD:tests/lsp-server-messages.test.mjs` 已经是 15 条判据。
  ⇒ 本报告的行号一律按**当前工作区**给（`src/lspServerMessages.ts` 425 行、队列在 `:250`；HEAD 那份里同一条在 `:246`，
  差的就是我随后加的 4 行头注）。`git diff` 现在只剩这三处未提交：`src/lspProgress.ts` 的注释行号、
  `src/lspServerMessages.ts` 的注释块、`tests/lsp-server-messages.test.mjs` 的头注行号 —— hunk 全是我这次的，没顺手重排别人的码。
- 顺带发现（不是我的文件、没动）：`src/progressPanel.ts.bak` 还在工作区里（拆文件的备份残留），提请主代理清理。

## 3. §5 自查命令的原始数字（前 = 本轮开工实测，后 = 收工实测）

| 命令 | 前 | 后 | 备注 |
|---|---|---|---|
| `node --test tests/lsp-server-messages.test.mjs` | 12 项 **12 绿 / 0 红** | 15 项 **15 绿 / 0 红** | 新增三条都在「后」里 |
| `node --test tests/lsp-server-messages.test.mjs tests/lsp-progress.test.mjs tests/lsp-server-log.test.mjs` | 31 项 **31 绿** | 34 项 **34 绿 / 0 红** | 本域三份合跑 |
| 语言服务其余域文件合跑（`lsp-feature-matrix` `lsp-feature-widget` `lsp-per-file-cache` `lsp-highlighting-cache` `lsp-symbol-bridge` `lsp-thread` `lsp-warmup` `lsp-completion` `lsp-completion-startup` `editor-lsp-warmup-wiring` `progress-notices` `notification-groups`） | 102 项 **102 绿** | 102 项 **102 绿 / 0 红** | 队列改 reactive 之后复跑；消费侧最近的 `progress-notices`、`notification-groups` 都没红 |
| `npx vue-tsc -b --force` | 未记基线（12 路并行，别域在途） | 收工复跑：**全仓 0 错**（输出为空、退出码 0）。中途那次是 **3 条**，全在 `src/components/RunConsole.vue`（`(278,27) (285,23) (347,26) error TS2304: Cannot find name 'request'`），两次运行之间被那一路自己收掉了 | 本域四个文件在两次运行里都是 0 条；并行工作区里这个数是动的，本批不据别人的在途数下结论 |
| `node --test tests/module-size.test.mjs` | 5 项 **5 绿** | 5 项 **4 绿 / 1 红** —— 红的不是本域：`src/components/CodeEditor.vue 现在 1153 行 > 上限 1147`（该文件 `git status` 为 ` M`，正被别的路改着；本轮两次运行之间它从 1152 长到 1153）。「没有未登记的巨型源文件」那条**绿** ⇒ 本域文件都在限内：`src/lspServerMessages.ts` 425 < 900、`src/lspProgress.ts` 194、`src/lspServerLog.ts` 137；未登记、未豁免、未拆文件（所以没有「被搬走的符号要改锚点」那一步） |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记孤儿 8 / 基线 8 · 新增 0 | 已登记孤儿 **7 / 基线 8 · 新增 0 · 本轮清掉 1**（`src/jarRun.ts` 被别的路接上，提示可更新基线）⇒ **门禁绿** | 本轮零新增模块；符号级零读者见 §5 |
| `node .tools/find-param-props.mjs` | — | **共 0 处**参数属性 | |
| `node .tools/find-ts-in-mjs.mjs` | — | **干净**（新增三条判据里没有类型语法） | §4.2 那个会打断整棵树的坑 |
| `node .tools/find-missing-ext.mjs` | — | **干净**：扫描 1304 个文件（src + tests） | 新加的 `from '../src/progressNotices.ts'` 带了扩展名 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 项 **11 绿** | 11 项 **11 绿 / 0 红**（两份文档写完并复跑） | 上游行数实测：`LspServerNotificationsHandlerImpl.kt` 478、`Lsp4jClient.kt` 134、`LspClientCapabilities.kt` 258 —— 本轮所有引用都在范围内 |
| ctest（`npm run test:native`） | — | **本轮不适用**：`native/` 零改动（只读 `native/lsp.cpp`、`lsp_host_bootstrap.cpp`、`main.cpp` 取证） | §5 那条只在改了 native 时才要跑 |

## 4. 反向验证记录（新门禁三步：注入 → 确认红 → 撤回 → 复绿）

**注入 A —— 打的是「队列必须是响应式的」这条新门**
1. 注入：`src/lspServerMessages.ts:250` 改回改动之前的真实形状 `export const lspServerMessages: LspServerMessage[] = []`。
2. 红：`node --test tests/lsp-server-messages.test.mjs` ⇒ 15 项 **13 绿 / 2 红**，红的正是
   「队列声明成 reactive 数组」与「端到端：服务器消息真的走通到通知面」——
   端到端那条红在**通知行数量**：假端口一条都没收到（`written.length` 为 0）。
   ⇒ 这条同时证明：修之前那个真实缺陷存在（不是我推的），且新判据不是摆设。
3. 撤回：改回 `reactive<LspServerMessage[]>([])` ⇒ **15/15 绿**；三文件合跑 **34/34 绿**。

**注入 B —— 打的是「消息队列只有一份」这条新门**
1. 注入：`src/lspProgress.ts:146` 的 `lsp.message` 分支之后再 `lspServerMessages.push({ … })` 一条（造出「两个主人」）。
2. 红：**14 绿 / 1 红**，红的是「消息队列只有一份…」那条（`!/lspServerMessages\.push/` 的 grep 断言）。
3. 撤回：`git diff --stat -- src/lspProgress.ts` ⇒ **空**；`grep -n "language: 'x'" src/*.ts` ⇒ **0 命中**；三文件 **34/34 绿**。

**注入标记复扫（收工前，按要求）**
- `grep -rn "REVFIX" src/ tests/` ⇒ **0 命中**（本轮从始至终没用标记；`grep -rn "REVFIX" docs/` 只命中 `docs/batch-2026-10-06-main.md` §10.3 那段历史记录本身）。
- `grep -rn "TEMP" src/` ⇒ 本域四个文件 **0 命中**；全仓的 20 处命中都是 `FILE_TEMPLATE*` / `LIVE_TEMPLATE_MACROS` / `TEMPORARY_CONFIGURATION` 这类**合法标识符里的子串**（别人的文件），不是注入标记。
- 上一批那段没撤回的注入现状：`src/lspServerMessages.ts:333` 是 `if (message.severity <= 2)`，判据「Error/Warning 才弹」绿。

## 4b. 本轮顺手订正的两处数错的上游行号（留痕：原写 X、实际 Y）

规约 §1 说「判词、别人的报告、主代理给的坐标都可能是编的」，所以本轮把本域每个上游坐标重新 `grep -n` 定行：

| 出处 | 原写 | 实际（本机树 `grep -n` 定行） | 处理 |
|---|---|---|---|
| `src/lspServerMessages.ts` 文件头、`tests/lsp-server-messages.test.mjs` 文件头 | `LspServerNotificationsHandlerImpl.kt:341-371` 是「五条 refresh」 | 五条在 `:341-368`（`:341`/`:348`/`:353`/`:360`/`:362`）；`:369-374` 是**第六条** `refreshTextDocumentContent`（`:371` 才是 `dynamicFiles.refreshContent`）⇒ 原写范围把第六条的头半截圈进来了 | 本域两个文件已改，并在注释里写明「原写 X、实际 Y」；`docs/wiring-requests-2026-10-06-lspmsg.md` 同步 |
| `src/lspProgress.ts:164` | `cancelAllProgress()` 在 `:331-339` | 函数本体 `:335-339`，`:330-334` 是它上方的注释 ⇒ `:331` 指到了注释体内 | 本域已改 |
| `src/lspServerLog.ts:21` | `:341-368` | 一致，本来就对 | 不动 |
| `src/progressNotices.ts:10`/`:54` | `:257-328`（对）与 `:331-339`（**应为 `:335-339`**） | 同上 | 不在我名下 ⇒ 写进请求 R9 |
| `native/lsp.cpp:162` | 第六条 refresh 的坐标 `:369-375` | 函数体到 `:374`（`:375` 是空行） | 不在我名下 ⇒ 写进请求 R9 |
| 请求文档旧版 | R3 `native/lsp_host_bootstrap.cpp:89-105`、R4 `:126-135`、R7 `native/main.cpp:945-957` | 实测：payload 字面量在 `:96-99`（lambda 到 `:104`）；folders 构造在 `:118-135`（写进 initialize 那行是 `:135`）；设置触发段在 `:943-957`（`case` 在 `:927`、`set_configuration` 在 `:956`） | 请求文档已按实际改掉并留痕 |

## 5. 零消费方自查结论

- 模块级：`node .tools/find-orphan-modules.mjs --gate` ⇒ 已登记孤儿 8 / 基线 8 · **新增 0** · 清掉 0 ⇒ 绿。本轮没建新模块；
  `src/lspServerMessages.ts` 的消费方是 `src/lspProgress.ts`（import 两个函数 + 转出）与 `src/progressNotices.ts`（队列），都在 production 路径上。
- 符号级（如实，不能只报门禁绿）：
  - `droppedLspServerMessages`（`:279`）、`lspServerMessageHandlerMethods`（`:271`）、`resetLspServerMessageDrops`（`:283`）—— **生产侧零读者**，只被 `tests/lsp-server-messages.test.mjs` 读；
    `resetLspServerMessageDrops` 的第二个读者是判据自己的复位步骤。⇒ 已在 `src/lspServerMessages.ts:270` 的注释写明它该给谁用，并把落地要求写成请求 **R8**（两个终局都可照抄）；本轮不自己造读者（不放假控件）。
  - `registerDefaultLspServerMessageHandlers()` 的返回值：读者只有判据 ⇒ 同 R8。
  - `expireLspMessageRequestsOnStop`（`:418`）有真实读者（`src/lspProgress.ts:152` 的 `lsp.progressReset` 分支）✓。
  - `messageActionsClickable` 的开关（`setLspMessageActionsClickable`，`src/lspServerMessages.ts:150`）生产侧不翻 true —— **这是有意的**（点不到就不能留一条永远没人答的请求），判据 `tests/lsp-server-messages.test.mjs:142` 与 `:170` 两支都钉住了；翻 true 的前置条件写在 R2。
  - 本轮**没有**新增只过自己测试的模块或出口；三条新判据测的是既有出口 + 一处真修。

## 6. 做不到 / 无法核实

1. **做不到：把分级兑现到界面上**。差的是 `src/progressNotices.ts:117` 那一行（displayId 写死），该文件不在本域名下（桶 6）。
   后果如实：Error/Warning 级 `logMessage` 现在**多弹一个气球**（上游那一组 `LspServerNotificationsHandlerImpl.kt:467` 写的是
   「no balloon, only write to the Notifications tool window」）。但这比修之前**好**：修之前它一条都没出现过。
   已在 `src/lspServerMessages.ts:324-331` 留痕，并把 R1a 排在请求文档第一条。
2. **做不到：`showMessageRequest` 的回程**（按钮 + 把用户选的项发回服务器）。卡在哪：`native/lsp.cpp:583-590` 现在就地把那条请求
   `respond(id, null)`，前端拿不到 JSON-RPC id、也没有回程通道 ⇒ 要同时动 `native/lsp.hpp`/`lsp.cpp`/`lsp_host_bootstrap.cpp`/`main.cpp` 与
   保留文件 `src/bridge.ts`。⇒ 请求 R2 + R3。本轮按上游 disposed 那一支（`:374`）同值答 `null`，协议合法。
3. **做不到：真机取证**。规约 §6 禁起图形界面；本轮的「端到端」是在 Node 里跑真 `watch` + 真 `nextTick`
   （`tests/lsp-server-messages.test.mjs:302`），量的是 `wireLspProgressNotices` 收到的通知行，不是 WebView2 里的气球像素。
   真机复验要主代理跑 `.tools/webview-console.mjs --port 9333 --expect-mount`（`docs/batch-2026-10-06-main.md` §10.2）。
4. **做不到：`lsp:log:info:<语言>` 的归组闭环**。实测 `lspMessageGroupForDisplayId('lsp:log:info:java')` 返回
   「LSP window/logMessage: errors, warnings」——被 `src/notificationGroups.ts:166` 的 `lsp:log:` 前缀先命中（那张表 `find` 首个命中，顺序即优先级）。
   该文件不在我名下 ⇒ 请求 R1b（一行，且必须插在 `lsp:log:` **之前**；实测 `tests/notification-groups.test.mjs` 里没有 `lsp:log:info:` 的锚点，
   所以加那一行不会打断既有判据）。本轮它没有用户可见影响：Info/Log 级根本不进入队列（`:333`）。
5. **做不到（也不必做）：替别人收 `tests/module-size.test.mjs` 那一条红**。收工实测 4 绿 / 1 红：
   `src/components/CodeEditor.vue 现在 1153 行 > 上限 1147` —— 该文件是别的路的在途现场（`git status` 为 ` M`），
   而那张上限表 `tests/module-size.test.mjs` 是保留文件（§2 主代理独占），「上限只许降不许升、不许登记豁免」⇒ 本域既不该碰也碰不了。
   本域三个源文件都在限内（那条「没有未登记的巨型源文件」判据是绿的）。
   `npx vue-tsc -b --force` 收工是 **0 错**（中途那 3 条在 `src/components/RunConsole.vue`，已被那一路自己收掉）。
6. **无法核实**：lsp4j 的 `LanguageClient` 接口本体**不在本机树**（`libraries/lsp4j/` 只有 jar 声明
   `libraries/lsp4j/resources/intellij.libraries.eclipse.lsp4j.xml`）⇒ 「哪八条、返回什么类型」以本机唯一实现它的
   `platform/lsp/src/api/Lsp4jClient.kt`（`:59`/`:62`/`:68`/`:83`/`:86-99`/`:101`）为准，本轮逐条打开数过。
7. **无法核实**：`$/logTrace` 与 `telemetry/event` 之外还有多少 jdt.ls 私有方法会被宿主转出来 ——
   `native/lsp.cpp:592-593` 对认不得的方法统一答 -32601，前端只在其**转发出来**时才计丢弃；
   宿主不转的那些（`native/lsp.cpp:529` 的 `if (!handler) return;`）在这一层是不可见的 ⇒ 请求 R5/R6 补的就是这一口。

## 7. 需要主代理接的线

全部在 `docs/wiring-requests-2026-10-06-lspmsg.md`：
**R1a**（`src/progressNotices.ts:117` 的 `displayId` 一行 —— 本轮之后它从「补齐」变成「必须尽快落」，因为消息现在真的会弹了）、
**R1b**（`src/notificationGroups.ts:164-170` 前缀表补 `lsp:log:info:`，插在 `:166` 之前）、
**R2/R3**（showMessageRequest 的按钮与回程，含 native 五处）、
**R4-R7**（上一批的 native 侧缺陷清单；本轮复读并订正了三处坐标）、
**R8**（丢弃计数与注册表返回值的真实读者，或把返回值降成 `void`）、
**R9**（旧 import 路径收敛 + 五处过时注释指针 + 两条行号小订正）。
