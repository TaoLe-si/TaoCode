# wiring requests · 2026-10-06 · lane `msgpanel`

> 全部指向**本 lane 无权改**的文件（保留文件 / 别人的在途面）。每条给：目标文件 → 目标行 → 改动 → 可照抄代码 → 上游依据（参考树里逐行数过）。
> 上游根：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。
> 配套判词见 `docs/batch-2026-10-06-msgpanel.md`。

---

## R1 · 通知的 ERROR / WARNING / INFORMATION 三档（现在塌成两档）

**现状**：`src/notices.ts:21-43` 的 `NoticeEntry` 只有 `error: boolean`；
`src/notifications.ts:66`（`notify(message, error = false, …)`）与 `:106`（`notifyProgress`）都按这一个布尔走；
`src/components/NoticeList.vue:30` 是 `:class="{ error: entry.error }"` ⇒ **警告与错误同色**。
而 LSP 侧本来分得清：`src/progressNotices.ts:115` 写的是 `error: message.severity <= 2`（1=错误、2=警告都被塞进同一个布尔）。

**上游依据**：`platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt:418-422`
（`getNotificationType`：`MessageType.Error -> NotificationType.ERROR`、`Warning -> WARNING`、`Info/Log/Debug -> INFORMATION`）；
调用点 `:382`（showMessageRequest）、`:390`（showMessage）、`:399`（logMessage 的 Error/Warning）。

**要接什么**（三步，都不在本 lane 名下）：

1. `src/notices.ts`（在第 24 行 `error: boolean` 之后插入一个可选档；**旧存档/旧调用点不必改**，缺省即沿用 `error` 的旧语义）：
```ts
export type NoticeTone = 'error' | 'warning' | 'info'
/**
 * 三档上色（上游 `getNotificationType`，`LspServerNotificationsHandlerImpl.kt:418-422`）。
 * 缺省 undefined = 调用点还没给档 ⇒ 按 `error` 布尔走（与 `progressNotices.ts:115` 的现形状一致）。
 */
tone?: NoticeTone
```
（即：在 `NoticeEntry` 里 `error: boolean` 下面加 `tone?: NoticeTone`，并在文件里加那个 type 别名。）

2. `src/notifications.ts:66` 与 `:102`/`:106`：把 `error` 参数换成"或再带一个 tone"。最小改法是在
   `:74` 造 entry 那一行补 `tone`（`notifyProgress` 那条已经是整条目透传，只需要同步 `progressNotices` 给值）：
```ts
const entry: NoticeEntry = { id: ++noticeSeq, message, error, at: …, detail, displayId, actions }
// 改成（只多一个字段，其余一字不动）：
const entry: NoticeEntry = { id: ++noticeSeq, message, error, tone, at: …, detail, displayId, actions }
```

3. `src/components/NoticeList.vue:30` 那一行：
```vue
<div class="status-notice-row" :class="{ error: entry.error }">
<!-- 改成：tone 有值就按 tone，没有就退回旧的 error 布尔 -->
<div class="status-notice-row" :class="entry.tone ? `tone-${entry.tone}` : { error: entry.error }">
```
样式请走既有令牌（`--error` / `--warning`，见 `src/tokens.css`，本 lane 不指定新色）。
`src/debugOutputSeverity`→`src/dapOutputSeverity.ts` 那侧的 `.sev-*` 已是同一思路（错误/警告分两色）。

4. 生产方给值：`src/progressNotices.ts:113-121` 那一条（本 lane 名下，**R1 落地后我这边一行就能配合**）：
```ts
notifyProgress({ message: message.message, error: message.severity <= 2, … })
// 加一档： tone: message.severity === 1 ? 'error' : message.severity === 2 ? 'warning' : 'info',
```

**判据**：`tests/notification-tone.test.mjs` 建议钉三条：severity=1→`tone-error`、severity=2→`tone-warning`、
severity≥3→不弹气球那一档不变（`showsBalloon` 仍是 false）。**不许**把现有 `error` 布尔断言放松。

---

## R2 · 通知组的 `isLogByDefault` 现在零消费者

**现状**：`src/notificationGroups.ts:27-28` 定义了 `isLogByDefault`、`:65` 给
「LSP window/logMessage: info, log; $/logTrace」写了 `isLogByDefault: false`，但
`grep -rln isLogByDefault src native` 只有 `notificationGroups.ts` 自己与 `lspServerMessages.ts` 的注释 ⇒
**没有任何一处按它决定"这条进不进通知中心"**。`src/notifications.ts:93` 是无条件 `noticeLog.value = pushNotice(...)`。

**上游依据**：`platform/ide-core/src/com/intellij/notification/NotificationGroup.kt:26`
（`val isLogByDefault: Boolean = true`）；`platform/platform-impl/src/com/intellij/notification/impl/NotificationsConfigurationImpl.java:109`
（`new NotificationSettings(groupId, group.getDisplayType(), group.isLogByDefault(), false)`）、
`:125-147`（按组 `register(..., shouldLog)` / `changeSettings(..., shouldLog, ...)`）。

**建议改法**（在 `src/notifications.ts` 的 `:93` 那一行之前加一道闸，与既有 `showsBalloon` 同一形状）：
```ts
// 上游：组的 isLogByDefault=false ⇒ 默认不写通知中心，只有用户在设置里打开该组才写
// （`NotificationGroup.kt:26`、`NotificationsConfigurationImpl.java:109`）。
const shouldLog = group ? group.isLogByDefault : true
if (shouldLog) noticeLog.value = pushNotice(noticeLog.value, entry)
```
注意两点（否则会把既有判据跑红）：
· 「不再显示」的抑制表（`:72` 的 `canShowNotice`）与声音（`:97` `playNotificationSound`）**位置不动**；
· 未分组的条目（`group === undefined`）必须照旧进中心 —— 上面那句 `? : true` 就是为这条写的，
  `tests/notification-groups.test.mjs` 里"未分组保持旧行为"那句断言才不会被反向踩到。
若要做成"用户可开"，就得配一份 per-group 的开关存储（新设置键 ⇒ 旧档缺键要补默认，按 §3 的规约走）。

**判据建议**：`$/logTrace`/info 级那条组（`isLogByDefault:false`）的消息不进 `noticeLog`，
而 Error/Warning 那条组（`true`）的照进；未分组消息照进。三条都要能失败。

---

## R3 · `window/showMessageRequest` 的那一排按钮（要 native 挂起回包才不属假控件）

**现状**：
· `native/lsp.cpp:755-757`：`else if (method == "window/showMessageRequest" || is_refresh_request(method)) { respond(id, Json(nullptr), Json(nullptr)); forward_server_request(...); }`
  —— **回包先答 null**，转出的只有 params。
· `src/lspServerMessages.ts:197` `let messageActionsClickable = false`；`:219` `resolveLspMessageRequestAnswer` 在该开关为 false 时恒答 null；
  `:558` 之后那条 `handleLogMessage`/`queueServerMessage` 链只把选项写进日志（`选项：a / b —— 本端答复：null`）。
⇒ 前端此刻**没有**可点的选项按钮，这是正确的（画出来就是假控件）。

**上游依据**：`LspServerNotificationsHandlerImpl.kt:377-383`（`showMessageRequest` → `doNotify(..., params.actions)`）、
`:443-449`（`actionItems?.forEach { … notification.addAction(AnAction(title) { notification.expire(); result.complete(actionItem) }) }`）、
`:454`（`.notify(project)`）⇒ **future 只在被点时才 complete**，没点就没有值（协议允许 `MessageActionItem | null`）。

**要接什么**（三处，两处是保留/贴顶文件，必须主代理动手）：
1. `native/lsp.cpp`：把 `window/showMessageRequest` 从"立即 `respond`"改成**登记 pending**：
   存 `{id, language}` 进一张 `pending_server_requests_`，**不回包**；其余 refresh 一族保持现状（它们返回 void，答 null 是对的）。
   并新增一条前端→宿主的补答入口（与 `cancelAllProgress` 同一条 `lsp.notify` 命令通道即可，不用新事件名）：
   `lsp.answer {id, title?}` → `respond(id, title 那一项或 null)`；服务器停了就把该语言的 pending 全部按 null 答掉（与
   `expireLspMessageRequestsOnStop` 同一时机，别把请求吊死）。
2. `src/bridge.ts`：**0 行余量** ⇒ 请主代理决定放哪（`lsp.answer` 的调用可以并进既有 `lsp.notify` 的 params，
   不加新事件类型就不必动事件登记表）。
3. `src/progressNotices.ts`（本 lane 名下，宿主一到位我就补这一行）：
```ts
notifyProgress({
  message: message.message, error: message.severity <= 2,
  detail: [`来自 ${message.language || '语言服务'}`],
  displayId: message.displayId || `lsp:message:${message.language}`,
  // 服务器给的选项 ⇒ 通知上的按钮（上游 :443-449）。点击回选并收掉这条通知。
  actions: actionsOfLspRequest(message),
})
```
   `actionsOfLspRequest` 内部走 `src/lspServerMessages.ts` 已备好的
   `chooseLspMessageAction(key, title)` / `expireLspMessageRequest(key)`（`:219-250`），
   并把 `setLspMessageActionsClickable(true)` 与真实回包通道同批落地（**不许**只翻开关）。

**判据**：端到端两条 ——「点了某一项 ⇒ 宿主收到那一项的 title」与「关掉通知 ⇒ 收到 null」；
再加一条反证：开关没翻 true 时按钮**不出现**（现在就是这个形状，`tests/lsp-server-messages.test.mjs` 已钉住 null 那一支）。

---

## R4 · `$/logTrace` 没有转出（lspmsg lane 的 R6，本轮复核仍成立）

**现状**：`native/lsp*.cpp` 里 `grep -rn logTrace` **零命中**；`native/lsp.cpp:697` 只 tag 了
`window/showMessage` 与 `window/logMessage` ⇒ 服务器发 `$/logTrace` 时前端一条都收不到，
`src/lspServerMessages.ts` 的注册表也没有这一条（多登记就是死出口）。

**上游依据**：`Lsp4jClient.kt:83-84`（`logTrace` 声明）+
`LspServerNotificationsHandlerImpl.kt:407-414`：`verbose` 非空时正文是 `"${params.message}\n${params.verbose}"`、
`serviceViewConsole()?.printTrace(message)`（对应 `LspClientConsole.kt:53-54`：tag `TRACE`、`LOG_VERBOSE_OUTPUT`）、
`doNotify(message, NotificationType.INFORMATION, LOG_INFO_TRACE_NOTIFICATION_GROUP)`（组 id 在同文件 `:476`）。

**要接什么**：与 `window/logMessage` 同一条出口 ——`tag_server_message(params, "$/logTrace")`（把 `verbose` 一起带上）；
前端我这边随后补 `registerLspServerMessageHandler('$/logTrace', …)`，落 `LSP_LOG_INFO_TRACE_GROUP`
（`src/notificationGroups.ts:62-71` 已登记该组，`isLogByDefault:false` ⇒ 只有 R2 落地后它才谈得上"看得见"）。

**判据**：宿主侧 `native/lsp_test.cpp` 加一条「`$/logTrace` 带 verbose 要转出来且 verbose 拼在正文里」；
前端侧断言它**不弹气球**（组是 NONE）且写进「语言服务」日志一行。

---

## R5 · 中文措辞（全部标「无法核实」，不要按"IDEA 一般是这样"填）

本机树没有 zh 语言包 ⇒ 这些 key 的中文值一律**无法核实**，需要中文文案时请从中文包里取后再落：
`UIBundle tool.window.name.messages`（`MessageViewImpl.kt:99` 用它当 stripeTitle）、
`IdeBundle errortree.error/warning/information`（`ErrorTreeElementKind.java:18-20`）、
`LspBundle notification.group.lsp.*`（三组的标题）。
本轮改动**一个字文案都没加**（只清洗既有正文），故不需要新词条。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R1（通知三档 tone）** —— 目标 `src/notices.ts` / `src/notifications.ts` / `src/components/NoticeList.vue`（**均本 lane 可改面**）+ `src/progressNotices.ts`。复核现状：`grep tone src/notices.ts src/notifications.ts src/components/NoticeList.vue` **0 命中** ⇒ 未接。登记为待办（三步同批 + 生产方给值 + 新判据 `tests/notification-tone.test.mjs`）。
- **R2（`isLogByDefault` 零消费者）** —— 目标 `src/components/NoticeList.vue` / `notificationGroups.ts`（本 lane），登记。

结论：零接线（R1/R2 登记为待办 —— 三步跨 4 个文件且要新判据，本 lane 未落以避免只改一半）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（R1/R2 登记为待办 —— 三步跨 4 个文件且要新判据，本 lane 未落以避免只改一半）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
