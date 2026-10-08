# 接线请求 · 2026-10-06 · `lspmsg` 域（语言服务「服务器主动消息」响应面）

> 我是 `lspmsg` 域：只动了 `src/lsp*.ts`（新增 `src/lspServerMessages.ts`、改 `src/lspProgress.ts`/`src/lspServerLog.ts`）
> 与 `tests/lsp-*`。下面每一条的**目标文件都不在我名下**（`src/bridge.ts`/`src/App.vue`/`src/notificationGroups.ts`/
> `src/progressNotices.ts`/`src/settingsPersistence.ts`/`native/*`），我一行都没动。
> 本域唯一真源是本地参考树，行号全部我亲自打开数过：
> `platform/lsp/src/api/Lsp4jClient.kt`、`platform/lsp/src/api/LspClient.kt`、`platform/lsp/src/api/LspClientCapabilities.kt`、
> `platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt`、`platform/lsp-impl/src/impl/LspDynamicCapabilities.kt`。
> lsp4j 的 `LanguageClient` 接口本体**不在本机树里**（`libraries/lsp4j/` 只有 jar 声明），所以坐标取上游唯一实现它的类。
> 行号按 2026-10-06 10:40 复读；`src/App.vue`/`src/progressNotices.ts` 正被别的域并行改着，落地前请再数一次行号（我只对**内容**负责）。

## 收尾那一轮（同日）复读与状态变化 —— 落地前请先看这一段

1. **行号复读**：本轮（`lspmsg` 收尾）把上面每一条的目标行重新打开数过。仍然成立的：
   `src/progressNotices.ts:113-118`（R1a 的那段 `notifyProgress({…})`，逐字未变）、
   `src/progressNotices.ts:111-122`（R2 的插入点）、`src/notificationGroups.ts:164-170`（R1b 那张表，`lsp:log:` 在 :166）、
   `native/lsp.cpp:177-181`（`tag_server_message`）、`:501-535`（通知分支）与 `:529`（`if (!handler) return;`）、
   `:541-543`（register/unregisterCapability 收下不记账）、`:583-590`（showMessageRequest + refresh 那两支）、
   `:592-593`（-32601 兜底）、`native/lsp_host_bootstrap.cpp:89`（`set_server_message` 的 lambda 起）、`:271`（window 段只有 workDoneProgress）、
   `:280`（`workspaceFolders` 的声明）、`:255/:262/:265/:279`（四处 `dynamicRegistration: true`）。
   **数错的三处（原写 X、实际 Y，已按实际改掉）**：
   R3 第 3 条的 payload 从「:89-105」改成「:89-104，其中 `Json payload{…}` 字面量在 :96-99」；
   R4 的 folders 真值从「:126-135」改成「:118-135（`Json folders = Json::array();` 在 :118，写进 initialize 的那一行在 :135）」；
   R7 的触发点从「native/main.cpp:945-957」改成「:943-957（`case "project.settings.update"_h` 在 :927，`params.contains("java") || params.contains("buildTools")` 在 :943，`lsp->set_configuration` 在 :956）」
   —— 都在本仓文件里，打开就能核。
2. **R1a 的优先级变了（重要）**：本域收尾时实测 `src/lspServerMessages.ts` 的队列 `lspServerMessages` 是**普通数组**，
   而唯一消费方挂的是 `watch(() => lspServerMessages.length, …)`（`src/progressNotices.ts:110`）—— 普通数组的 `push` 不登记响应式依赖
   ⇒ 那个 watcher 一次也没醒过，所有服务器消息堆在队列里静默消失（通知面一行不显示、`:112` 那句 `logLspServerMessage` 也不执行）。
   本轮已把它改成 `reactive`（在我名下那个文件里，`src/lspServerMessages.ts:250`；判据：`tests/lsp-server-messages.test.mjs:284`、`:302`）。
   ⇒ **R1a 之前是「补齐分级」，现在是「收住多弹的气球」**：消息真的会弹了，而 logMessage 的 Error/Warning 落进的是
   `lsp:message:`（BALLOON），上游那一组是「no balloon, only write to the Notifications tool window」
   （`LspServerNotificationsHandlerImpl.kt:467`）⇒ 每来一条服务器错误日志就多一个气球。请与 R1a 一起排，别只落队列那一半。
3. **上游坐标本轮复核**（本机树逐条打开，`grep -n` 定行，不按 sed 区间估）：`LspServerNotificationsHandlerImpl.kt` 共 478 行，
   `:341-368` 是**五条**标准 refresh（`:341` semanticTokens、`:348` codeLenses、`:353` inlayHints、`:360` inlineValues、`:362` diagnostics）；
   同文件 `:369-374` 还有**第六条** `refreshTextDocumentContent`（IntelliJ 扩展，本仓不做，理由见下面「我做不了/不做」第 6 条）
   —— **本域上一轮写的 `:341-371` 是数错的（`:371` 落在第六条体内），本轮已在 `src/lspServerMessages.ts` 的头注与
   `tests/lsp-server-messages.test.mjs` 的头注里改成 `:341-368` 并留了痕**。
   其余：`:255` createProgress、`:257-328` notifyProgress（`Begin` 在 :266、`Report` 的 `?:` 两支在 :315-322、`End` 在 :323-326、
   `toFraction` 的 `coerceIn` 在 :263 —— 这几条本轮重数，原引正确，未改）、`:330-334` 是 `cancelAllProgress` 的注释、函数本体 `:335-339`
   （`src/lspProgress.ts:164` 原写 `:331-339`，本轮改成 `:335-339`）、`:377-382` showMessageRequest、`:385-390` showMessage、
   `:393-404` logMessage、`:407-414` logTrace、`:418` `getNotificationType`、`:424-456` doNotify（`:448-449` `notification.expire();
   result.complete(actionItem)`、**`:454` `.notify(project)`**）、`:461/:467/:473` 三个组各自的「Default behavior」注释、
   `:464/:470/:476` 三个组 id、`:184` `telemetryEvent(...) {}`；
   `Lsp4jClient.kt` 共 134 行（`:47/:50` register/unregister、`:59` showMessage、`:62` showMessageRequest、`:68` logMessage、
   `:83` logTrace、`:86-99` 五条 refresh、`:101-102` 第六条、`:42-43` `@ApiStatus.OverrideOnly open class Lsp4jClient`）；
   `LspClientCapabilities.kt:246-249` window 段。**本报告与本轮改动涉及的引用行号全部落在这些范围内**；
   `progressNotices.ts:10`/`:54` 里那两条 `:257-328`/`:331-339` 不在我名下，`[331-339]` 那条请按上面改成 `:335-339`（见 R9）。

---

## R1a · 消息窗口按队列条目自带的 `displayId` 归组（一条改动，把分级兑现到界面上）

- **目标文件**：`src/progressNotices.ts`（桶 6 名下）
- **目标行号**：第 **113-118** 行那个 `notifyProgress({ … })`（`wireLspProgressNotices` 里 `lspServerMessages` 的 watcher 循环体）
- **这段现在长什么样**（:113-118，逐字）：

```ts
      notifyProgress({
        message: message.message,
        error: message.severity <= 2,
        detail: [`来自 ${message.language || '语言服务'}`],
        displayId: `lsp:message:${message.language}`,
      })
```

- **整段替换为**（只改 `displayId` 那一行，其余一字不动）：

```ts
      notifyProgress({
        message: message.message,
        error: message.severity <= 2,
        detail: [`来自 ${message.language || '语言服务'}`],
        // 分级映射（这条消息该进上游哪个通知组）已由 `src/lspServerMessages.ts` 算好并随条目带出来：
        //   · `window/showMessage` / `showMessageRequest` ⇒ `lsp:message:<语言>` = 组「LSP window/showMessage」（BALLOON，弹）
        //   · `window/logMessage` 的 Error/Warning        ⇒ `lsp:log:message:<语言>` = 组「LSP window/logMessage: errors, warnings」
        //     （上游 :399 用的就是这个组，displayType=NONE ⇒ 不弹气球、只进通知中心）
        // 条目没带 displayId 的（旧形状）保持改动之前的行为。
        displayId: message.displayId || `lsp:message:${message.language}`,
      })
```

- **上游依据**：`platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt:385-390`（showMessage → SHOW_MESSAGE 组）、
  `:393-404`（logMessage 按 type 分两组）、`:464`/`:470`（两个组 id 的字面值）。
- **为什么需要**：现状是**所有**服务器消息（含 logMessage 的 Error/Warning）都进 `lsp:message:<语言>` 这一个 displayId ⇒
  全部归到「LSP window/showMessage」那一组，于是 `src/notificationGroups.ts:53-61` 登记的
  `LSP window/logMessage: errors, warnings`（displayType=NONE）**永远不会有成员** ——
  本仓的 displayType 语义就是「要不要占用那个一闪而过的气球」（`notificationGroups.ts:12-16`），
  归错组 = 该静默的在弹、该弹的分不出来。
- **判据**：`tests/lsp-server-messages.test.mjs` 已有「分级映射到的是本仓**已有**的通知组注册表」+
  「displayId 与前缀表闭环」两条；接完之后请把「有 displayId 的条目必须用它」补进 `tests/notification-groups.test.mjs` 那边。

## R1b · 前缀表补一行 `lsp:log:info:`（不动就归错组）

- **目标文件**：`src/notificationGroups.ts`（桶 6 名下）
- **目标行号**：第 **164-170** 行那张 `GROUP_BY_DISPLAY_PREFIX`
- **改法**：在 `['lsp:log:', 'LSP window/logMessage: errors, warnings'],` 这一行**之前**插一行（表是 `find` 首个命中，顺序就是优先级）：

```ts
  ['lsp:log:info:', 'LSP window/logMessage: info, log; $/logTrace'],
```

- **上游依据**：`LspServerNotificationsHandlerImpl.kt:402-403`（Info/Log 级落 `LOG_INFO_TRACE` 组）与 `:476`（组 id 字面值）。
- **说明**：`lsp:log:message:<语言>` 已被现有的 `lsp:log:` 那行按前缀命中，不需要新行；
  只有 info/trace 那一档必须排在 `lsp:log:` 前面，否则会被抢去 errors/warnings 组。
- **为什么现在只需要这一行**：`src/lspServerMessages.ts` 已经会把 Info/Log 级消息映到 `lsp:log:info:<语言>`，
  但**那一条不进通知队列**（只写「语言服务」日志，见 R6 才谈得上弹不弹）。这行是把组表先补齐，
  等 R6 落地就有生效点；现在补上不会凭空多出一条用户看得见的通知（`notificationGroups.ts:63-71` 那条登记本来就在）。

## R2 · 通知面上那一排按钮（showMessageRequest 的用户可见一半）

- **目标文件**：`src/progressNotices.ts`（桶 6 名下）
- **目标行号**：同一个 watcher 循环体内（第 **111-122** 行），在 `notifyProgress({ … })` 之前插
- **要接什么**（可直接照抄的形状；`NoticeEntry.actions` 已存在，`lspLogNoticeOf` 的「复制日志」就是同一族）：

```ts
      // 服务器在问一句话（`window/showMessageRequest`）：把它给的那一排选项做成能点的按钮。
      // 待决表在 `src/lspServerMessages.ts`：**只有选项真在这里画出来了**，才把可点标志翻成 true
      // （翻早了 = 消息会留在待决表里等一个不存在的点击，协议那条请求就永远没有答复）。
      const pending = message.requestKey ? lspPendingMessageRequests[message.requestKey] : undefined
      if (pending) {
        notifyProgress({
          message: message.message,
          error: message.severity <= 2,
          detail: [`来自 ${message.language || '语言服务'}`],
          displayId: message.displayId || `lsp:message:${message.language}`,
          actions: pending.actions.map(action => ({
            label: action.title,
            run: () => { void answerLspMessageRequest(message.requestKey, action.title) },
          })),
        })
        continue
      }
```

并在 `src/lspServerMessages.ts` 的接线处（同一次改动里）：`setLspMessageActionsClickable(true)`。
- **卡在哪一环**：`answerLspMessageRequest(key, title)` 要把用户点的那一项**发回服务器**，
  而宿主现在拿不到那条请求的 id、也没有回程通道 ⇒ 见 R3。R3 没落地之前，本模块**照上游的语义**答 null
  （`LspServerNotificationsHandlerImpl.kt:378`：客户端给不出答案就是这个值），协议合法、界面看得见问题，
  但按钮点不动 ⇒ 这一族判据只能是 `[~]`。
- **上游依据**：`:377-382`（showMessageRequest 先 logInfo 再 `doNotify(..., params.actions)`）、
  `:424-456`（每个 `MessageActionItem` 变成一个 `AnAction`，`:449` 只有被点才 `result.complete(actionItem)`）。
- **判据**：`tests/lsp-server-messages.test.mjs` 的「接上按钮之后：只认服务器给过的那些标题」
  「关掉气球（expire）与服务器停机都把在途的问句按 null 收掉」两条已经把回选语义钉住；
  按钮那半请桶 6 配一条「有 pending 条目的通知必须有可点的动作」（与「不放假控件」同纪律）。

## R3 · showMessageRequest 的回程（要动 `native/lsp.hpp` + `native/lsp.cpp` + `native/lsp_host_bootstrap.cpp` + `native/main.cpp` + `src/bridge.ts`）

1. `native/lsp.cpp`：`tag_server_message(Json params, std::string_view method)`（现 :177-181）再加一个 id 形参，
   把 `params["id"] = id;` 带出去；`window/showMessageRequest` 那一支（:583-590）**不再就地 `respond`**，
   而是把 `{id, params}` 记进「待决服务器请求」表，等界面答复（表与 `Client::respond` 都是私有的 ⇒ 必须动 `native/lsp.hpp`，见下）。
2. `native/lsp.hpp`：`Client` 加 `void answer_server_request(Json id, Json result)`（内部走现成的私有 `respond`）
   与一张 `pending_messages_` 表；超时/停机时按 `null` 答复（**不能永远不回包**，服务器会卡在那条请求上）。
3. `native/lsp_host_bootstrap.cpp`：`set_server_message` 那段（现 :89-105）的 payload 补 `{"id", params.value("id", Json())}`。
4. `native/main.cpp`：加 `case "lsp.answerMessageRequest"_h`，把 `{ id, chosen }` 交给 Session → Client。
5. `src/bridge.ts`（保留文件）：`Method` union 第 **109** 行补 `'lsp.answerMessageRequest'`；
   事件侧**不用加新名字**（`lsp.message` 那条字段袋已经带得出 `method`/`actions`，只差 `id`）。
6. 前端这边我已经备好：`src/lspServerMessages.ts` 的 `lspMessageRequestKey` / `chooseLspMessageAction` /
   `expireLspMessageRequest` / `resolveLspMessageRequestAnswer`，以及队列条目上的 `requestKey`。
- **上游依据**：`platform/lsp/src/api/Lsp4jClient.kt:62-63`（`showMessageRequest(...): CompletableFuture<MessageActionItem>`）、
  `LspServerNotificationsHandlerImpl.kt:443-450`（点按钮才 complete）。
- **不做的后果（如实）**：jdt.ls 问「要不要把这个文件夹当成工程导入」，用户看得见问题、看不见按钮，
  客户端一律答 null ⇒ 服务器按「用户拒绝」继续。**比改动前好**（改动前整条被丢、还回一个 -32601），但它是 `[~]`。

## R4 · `workspace/workspaceFolders`：声明了能力却没有处理器（真缺陷，要动 native）

- **现状**：initialize 里声明 `{"workspaceFolders", true}`（`native/lsp_host_bootstrap.cpp:280`），
  但服务器请求的分派（`native/lsp.cpp:541-593`）**没有这一支** ⇒ 走到 :592-593 的兜底，
  回 `{"code": -32601, "message": "Method not found"}`。这就是「声明了不处理」的字面形状：
  服务器照声明来问，客户端答「不认得」。
- **上游依据**：`platform/lsp/src/api/Lsp4jClient.kt:71-72`（`workspaceFolders()` 转给处置器）、
  `platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt:241-247`（实现：项目没了回 emptyList，
  否则把 `descriptor.roots` 逐个映射成 `WorkspaceFolder(uri, name)`）。
- **要接什么**：`native/lsp.cpp` 的分派里补一支
  `else if (method == "workspace/workspaceFolders") respond(id, <initialize 时那份 folders>, Json(nullptr));`
  —— folders 的真值已经在 `native/lsp_host_bootstrap.cpp:126-135` 算好（`workspaceFolders` 初始化参数），
  复用同一份即可；**或者**如实删掉 :280 那行声明（二选一，别两不沾）。
- **判据**：`native/lsp_test.cpp` 里给一条「收到 `workspace/workspaceFolders` 请求 ⇒ 回的是文件夹表、不是 -32601」；
  删声明那条则由 `native/lsp_host_test.cpp` 钉 initialize 的参数形状。

## R5 · `client/registerCapability` 收下不记账（四处 `dynamicRegistration: true` 成了空头支票）

- **现状**：`native/lsp.cpp:541-543` 把 `client/registerCapability` / `client/unregisterCapability`
  一律 `respond(id, null)` —— 回「成功」，但 `params.registrations` 整包丢掉，之后既不按注册的方法发通知、
  也不因注销而停。声明侧有四处在依赖它：`native/lsp_host_bootstrap.cpp:255`（diagnostic）、
  `:262`（foldingRange）、`:265`（synchronization）、`:279`（**didChangeConfiguration**）。
- **上游依据**：`platform/lsp/src/api/Lsp4jClient.kt:47-51`（两条都转给处置器）、
  `platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt:118-128`
  （register 逐条 `lspClient.dynamicCapabilities.registerCapability(it)` + `restartHighlightingIfNeeded(...)`；
  unregister 也记账）、`platform/lsp-impl/src/impl/LspDynamicCapabilities.kt:117`（真存进 `capabilityToInfo`）。
- **要接什么（最小兑现）**：native 先**别丢** registrations 的 method 名单 —— 走同一条 `server_message_` 出口，
  参数里带 `{"registrations":[{"method":…,"id":…}]}`；前端这边**已经接得住**：
  `src/lspServerMessages.ts` 的注册表 + 丢弃计数（没有处置器时它会进 `lspServerMessageDrops`，
  于是这类缺陷第一次有了可观察的痕迹，而不是无声丢掉）。
  前端登记之后 `clearAllLspCaches()` 那条重取链已有（`handleRefresh`）。
- **判据**：`native/lsp_test.cpp` 加一条「registerCapability 之后 registrations 还在」；
  模块侧 `tests/lsp-server-messages.test.mjs` 的丢弃计数那条已经能钉住「转发出来但没人接」那种形状。

## R6 · `$/logTrace` 被静默丢弃（native 通知分支没有这一支）

- **现状**：`native/lsp.cpp:501-535` 的通知分支只认 `textDocument/publishDiagnostics`、`$/progress`、
  `window/showMessage`、`window/logMessage`；`$/logTrace` 走到 :529 的 `if (!handler) return;` —— **无计数、无日志**。
- **上游依据**：`platform/lsp/src/api/Lsp4jClient.kt:83-84`（`logTrace` 转给处置器）、
  `LspServerNotificationsHandlerImpl.kt:407-414`（写进 Services 控制台 + `LOG_INFO_TRACE` 组，
  注释原文 `no need to LOG.info() it additionally`）。
- **要接什么**：与 `window/logMessage` 同一条出口（`tag_server_message(params, "$/logTrace")`，
  把 `verbose` 一起带上），前端我再补一条 `registerLspServerMessageHandler('$/logTrace', …)`
  （组 id `LSP_LOG_INFO_TRACE_GROUP` 与 displayId `lsp:log:info:<语言>` 都已备好，见 R1b）。
- **对照的 `[-]`**：`telemetry/event` 本仓不做是**对的** —— 上游本身是空实现
  （`LspServerNotificationsHandlerImpl.kt:184` `override fun telemetryEvent(object: Any) {}`）。

## R7 · 推了 `workspace/didChangeConfiguration` 之后，前端这一族缓存要跟着作废

- **现状**：客户端→服务器那一条**已经通了**（不必再接）：`native/lsp.cpp:433`（握手后首发）+ `:479-482`
  （`set_configuration` 即时发），触发点在 `native/main.cpp:945-957`
  （`project.settings.update` 里改了 `java`/`buildTools` 就 `lsp->set_configuration("java", …)`）。
  **缺的是后一半**：配置一变，服务器的答案就变了，而前端那一族按文件的 LSP 缓存（`src/lspPerFileCache.ts` /
  `src/lspHighlightingCache.ts`）还留着旧结果 —— 下一次读会照旧吃缓存，直到服务器自己发 `workspace/…/refresh`。
- **上游依据**：`platform/lsp/src/api/LspClient.kt:48`（`sendNotification`，:40 的注释例子正是
  `didChangeConfiguration`）与 `:54`/`:64`（`invalidateServerResults()`：
  `Call it after changing what the server bases its answers on, a settings push for example`）。
- **要接什么（两处任选其一，都不在我名下）**：
  1. `native/main.cpp:957` 之后（同一条 worker 任务里）转一条前端事件 `lsp.message`，
     `method` 用现成的 `workspace/semanticTokens/refresh` 一族语义 —— 不改协议形状、不改桥；
  2. 或 `src/settingsPersistence.ts` 在 `project.settings.update` 成功后（且改了 java/buildTools 那两栏时）调
     `clearAllLspCaches()`（出口在 `src/lspPerFileCache.ts:52`，注册表 + 整批作废都已就位）。
- **判据**：模块侧「refresh 整批作废」那条已钉住作废动作本身；接线那条请落在改的那一侧（1 或 2）配一条
  「设置推完 ⇒ 缓存计数归零」，别让这条只活在注释里。

## R8 · 「有没有人接」这件事在界面上说不出：丢弃计数与注册表返回值目前没有生产读者

- **现状（本轮实测，不是推测）**：`src/lspServerMessages.ts` 的 `droppedLspServerMessages`（`:279`）、
  `lspServerMessageHandlerMethods`（`:271`）、`resetLspServerMessageDrops`（`:283`）三个出口**只被
  `tests/lsp-server-messages.test.mjs` 读**；`registerDefaultLspServerMessageHandlers()`（`:380`）在 `:388` 被自己调用、
  **返回值就地丢弃**，读它的也只有判据（`tests/lsp-server-messages.test.mjs:62`）。
- **判定（如实，别当成"假通道"）**：消息通道本身**不是假的** —— 链条是
  `native/lsp.cpp:533`/`:583-590` → `src/bridge.ts:393` → `src/lspProgress.ts:146` → `src/lspServerMessages.ts:395`
  →（八条处置之一）→ 队列 `:250` → `src/progressNotices.ts:110` → `notifyProgress`，八条处置都被 `handleLspServerMessageEvent` 真实消费；
  本轮修的正是最后一环（队列不是 reactive ⇒ watcher 从不醒）。**缺的只是把「N 条服务器消息没人接」说出来那张嘴。**
- **两条终局，任选一条（本域名下没有能承载它的那个界面，所以不动手）**：
  1. **给一个真读者（推荐）**：状态栏「语言服务」面板的条目模型 `src/lsFeaturesWidget.ts:98-118`（`LspWidgetItem`，
     它已经有 `isError` 与 `showErrorOutput` 两档）。上游的做法就是「这台客户端有问题 ⇒ 界面说出来」：
     `platform/lang-api/src/com/intellij/platform/lang/lsWidget/LanguageServiceWidgetItem.kt:53-80`
     （`isError` 叠成错误标记、`runningState` 叠成存活徽章）。最小可照抄的形状（接口加一个字段，条目标签加一句）：
     ```ts
     /** `lspServerMessageDrops`（`src/lspServerMessages.ts:276`）里这台服务器被丢了几条。 */
     droppedMessages: number
     ```
     渲染那侧（`src/components/`，不在我名下）**只在建条目时 `droppedMessages > 0` 才出这一行**（= 「不放假控件」：0 就不出现）。
  2. **或按死代码删**：把 `registerDefaultLspServerMessageHandlers` 的返回类型降成 `void`，同时把
     `tests/lsp-server-messages.test.mjs:62` 改成先调用、再断言条数：
     ```js
     registerDefaultLspServerMessageHandlers()
     assert.equal(lspServerMessageHandlerMethods().length, 8)
     ```
     —— 幂等那条断言强度**不变**（§3 不许放松，这条只是不再留一个没人读的返回值）。
- **判据**：走 1 的那半请配一条「有被丢弃的服务器消息 ⇒ 面板条目里有这一句；没有 ⇒ 不出现」；
  走 2 的那半由 `tests/lsp-server-messages.test.mjs` 现有的 15 条覆盖即可（本轮已实测全绿）。

## R9 · 拆分留下的两处痕迹：旧 import 路径 + 五处过时注释指针

- **旧 import 路径（功能没问题，但它是"转出表"存在的唯一理由）**：`src/progressNotices.ts:21` 仍从 `./lspProgress.ts` 取
  `lspServerMessages`。实测两条路径拿到的是**同一个对象**（判据 `tests/lsp-server-messages.test.mjs:265`），
  所以**没有第二份队列要收敛**；要收敛的只是别名。可照抄（与 R1a 同一次改动最省）：
  ```ts
  // old（src/progressNotices.ts:21，逐字）
  import { lspProgressInterrupted, lspProgressTasks, lspServerMessages, runningLspTasks } from './lspProgress.ts'
  // new
  import { lspProgressInterrupted, lspProgressTasks, runningLspTasks } from './lspProgress.ts'
  import { lspServerMessages } from './lspServerMessages.ts'
  ```
  落完之后 `src/lspProgress.ts:27-30` 那块转出里，除了 `lspServerMessages` 本来就没有别的 `src/` 读者
  （`LSP_REFRESH_METHODS`/`lspActionTitles`/`lspMessageRouteOf`/`type LspMessageRoute`/`type LspServerMessage`
  只被 `tests/lsp-progress.test.mjs:23-25` 读）⇒ 把那两个读者的 import 一起改到新模块后，**那块转出可以整段删**（我名下，随时可做，
  前提就是这条：断言体一字不动，只改锚点）。本轮没删是因为删了会断 `progressNotices.ts:21` 那一条编译。
- **五处注释还在说「消息/refresh 的分派在 `src/lspProgress.ts`」**（拆分后实际在 `src/lspServerMessages.ts`）：
  `src/lspPerFileCache.ts:36`、`src/lspHighlightingCache.ts:173`、`src/workspaceInspection.ts:51`、
  `src/semanticHighlighting.ts:215`、`native/lsp.cpp:578`（那句「前端的处置见 `src/lspProgress.ts`」）。
  都在别人名下，一行字的事；不改的代价是下一个人按注释去进度模块找分派表，找不到。
- **顺带两条同族的小订正（本轮重数得到的，都不在我名下，列出来就行）**：
  `src/progressNotices.ts:54` 引的 `:331-339` 应为 `:335-339`（`:330-334` 是函数上方的注释，函数体在 `:335-339`）；
  `native/lsp.cpp:162` 引的 `:369-375` 中 `:375` 是空行（函数体到 `:374`）。

---

## 我做不了 / 不做的（写清楚，别当成漏项）

1. **本轮一行 native 都没动**（派单：`native/lsp_*.cpp` 属原生侧、本轮不改）。R3/R4/R5/R6/R7 的 native 那半全部走请求。
2. **`window/showDocument`**：本仓既没声明（`native/lsp_host_bootstrap.cpp:271` 的 window 段只有 workDoneProgress）
   也没有处理器 ⇒ 声明与实发一致，**不算缺陷**，也就不补（上游有：`LspClientCapabilities.kt:246-249` 声明了
   `showDocument = ShowDocumentCapabilities(true)`、`LspServerNotificationsHandlerImpl.kt:190-239` 是真打开文件；
   本仓没有「让服务器把编辑器焦点搬到某个文件某个区间」这条链，做了就是假控件）。
3. **动态注册的真值表**（上游 `LspDynamicCapabilities`）：本仓前端没有「按注册决定发不发通知」那一层，
   R5 只做「别再把它丢掉」，记账语义留给主代理排期。
4. **`$/logTrace` 的前端处置器我没注册**：宿主现在转不出这条（native 分支里没有），
   注册一条 = 只过我自己测试的死出口（`.tools/agent-rules.md` §5 零消费方那条）。等 R6 落地，一行就能接上。
5. **`window/progress`（jdt.ls 私有、非标准）**：LSP 没定义、上游 `Lsp4jClient` 里也没有这一支 ⇒
   无法核实上游怎么做，本仓不做；但它现在**会被丢弃计数抓到**（宿主若转发出来而没人接，
   `lspServerMessageDrops` 会记一条并写一行日志）—— 这就是这轮要的可观察性。
6. **第六条 refresh（`refreshTextDocumentContent`）不接**（收尾这轮新登记）：上游
   `platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt:369-374` 把它转给
   `lspClient.dynamicFiles.refreshContent(params.uri)`（`:371`），本仓没有「服务器代管虚拟文件」那一层
   （`native/lsp.cpp:162` 的注释就是同一判定：照旧答 `MethodNotFound`），声明侧也没有对应能力
   （`grep -rn "textDocumentContent\|dynamicFiles" native/ src/` 只命中 `native/lsp.cpp:162` 那一行注释）
   ⇒ 声明与实发一致，**不算缺陷**，接上就是假控件。上一轮文件头写的「五条 refresh」因此**没有少做**，
   只是当时没把第六条显式判成 `[-]`（本轮在报告里补了那一行）。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R1a（`src/progressNotices.ts` 按 displayId 归组）** —— 本 lane 可改面，登记为待办。
- **R1b（`src/notificationGroups.ts` 补前缀行）** —— 本 lane 可改面，登记为待办（与 gradlehostfix R1 同族）。
- 其余目标 `src/bridge.ts` / `App.vue` / 别人面 —— 分别转 owner / 本 lane。

结论：零接线（R1a/R1b 登记）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（R1a/R1b 登记）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
