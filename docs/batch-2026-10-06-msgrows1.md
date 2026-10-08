# 批次报告 · 2026-10-06 · msgrows1（`pv/notification` 一族判词逐条重开 + 计数门验收）

**只改了一行判词**：`docs/inventory/verdict-projectviews.md:35`（族 `pv/notification`）。
一个 `src/` / `native/` / 其它 `docs/inventory/*` / `tests/*` / `scripts/*` 文件都没动；没 commit、没 push；没跑过 `git checkout/reset/stash/clean`。

任务前提的两处订正见 §0.2 与 §D3（一条是「msgverdict 没落下任何改档」——实际落了一半，另一条是「`tests/b*-verdict.test.mjs` 钉着这一族的数」——实际没有）。

---

## 0. 范围、方法与并发

### 0.1 方法

- 上游树只读：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。**本报告的每一个上游 `文件:行号` 都用 `grep -n` 定过行，不是 sed 偏移估的**（估过一次就错了，见 §B5）。
- 本仓每一个 `文件:行号` 都用脚本回读那一行的正文再采信（脚本清单见 §F3 的「坐标回读」），三件齐（实现 / 生产消费方 / 能失败的判据）才记 `[x]`。
- 判据的「能失败」核法：这些测试要么是纯函数断言（喂假 store、断返回值），要么是**源码形状断言**（`assert.match(读到的 src, /…/)`），两种都会随实现退化而红；`tests/notification-groups.test.mjs:254` 那种 `assert.equal(host.match(/canShowNotice\(/g).length, 2)` 更是直接把调用点数量钉死。

### 0.2 并发声明（派单前必读）

| 事实 | 证据 |
|---|---|
| **msgverdict 那一族其实落了档**（任务说「没落下任何改档」是过时的） | `docs/inventory/verdict-projectviews.md` 与 `docs/inventory/projectviews_verdict_table.json` 的 mtime 都是 **14:40:07**，两件的 `pv/notification` 判词长度一致（3352 字），说明上一路把 md 与 JSON 同时手改过一遍；`git diff` 里 md 那一行是 `-` 旧版 `+` 重判版 |
| 上一路改的是**生成物**，脚本真源没跟着改 | `git diff -- scripts/verdict_table.py` 的 hunk 落在 `@@ -34 / -47 / -64 / -309 / -345 / -405`，**不含 `:76`**；`python scripts/verdict_table.py --check projectviews` 报「不一致 2 / 3」 |
| `src/gradleHost.ts` 有 lane 在 14:59:55 改过（+73/−23），把 `notifyFailure` 加了第 4 个形参 | `tests/notice-actions.test.mjs`（mtime 07:26:58）钉的还是三参数整句形状 ⇒ 该文件现在**一条红**，与本判决无关（§H1） |
| `docs/inventory/verdict-folding.md` 与 `tests/b4-verdict.test.mjs` 在我跑门期间被并发改过（doc 15:30:46 / test 15:29:28） | 我第一次跑门时 b4 三条红（22 ≠ 17），第二次跑变 98/98 全绿 ⇒ 那条 lane 自己把计数同步好了；我只记录，没碰（§H2） |

---

## A · 原判词那五条「缺」的逐条复现

`docs/inventory/verdict-projectviews.md:35` 现在把五支全列成「已在盘上」并逐条给三件套。上一版写「**四支**已在盘上」却又在下面列满 ①–⑤ 五条（自相矛盾），`docs/batch-2026-10-06-msgaudit.md:49`（A7）也是「五条里四条」——**我数的是五支全在盘上**，逐条如下。

### ① `NotificationGroup` 注册体系 ⇒ `[x]`

- 实现：`src/notificationGroups.ts:20`（四档 `NotificationDisplayType`）、`:23-33`（`NotificationGroupView` 的 id/displayType/isLogByDefault/title/toolWindowId）、`:40`（`NOTIFICATION_GROUPS` 九条注册项，每条注明上游注册它的那行 xml）、`:132`/`:135`（`BY_ID` 与 `notificationGroup`）、`:148`（`balloonFadeoutMs`）、`:154`（`showsBalloon`）、`:176`/`:183`（`noticeGroupId`/`noticeGroup`）、`:194`（`configureDoNotAskOption`）。
- 上游对照（都 `grep -n` 定过）：`platform/ide-core/src/com/intellij/notification/NotificationGroup.kt:24-30`（五个字段逐字对上）、`NotificationDisplayType.java:8-14`（正好四档）、`platform/platform-impl/src/com/intellij/notification/impl/NotificationsManagerImpl.java:449-450`（`STICKY_BALLOON ? 300000 : 10000` + `startSmartFadeoutTimer`）、`:290`（只有 `STICKY_BALLOON, BALLOON` 走气球）、`NotificationsAnnouncer.kt:85-87`（NONE 提前 return）。
- 生产消费方：`src/notifications.ts:77-78`（这组要不要占气球）与 `:142`（淡出时长）；`src/lspServerMessages.ts:68` import + `:135-136` `lspMessageGroupRegistered` + `:673` `noticeGroupId`；`src/notificationBeeper.ts:31`；`src/notificationDoNotAsk.ts:20`；`src/components/EventLogPanel.vue:25`。
- 判据：`tests/notification-groups.test.mjs:42`（未知 id 查不到）、`:63`（逐条对上 XML 的 displayType 与 isLogByDefault）、`:84`、`:251`（宿主按组弹不弹气球）、`:282`；`tests/notification-balloon-fadeout.test.mjs:40`、`:52`、`:64`、`:76`、`:102`（`:102` 是源码形状断言，钉的就是上面那两个消费点）。

### ② 「不再询问」（`DoNotAskManager`）⇒ `[x]`

- 实现：`src/notificationDoNotAsk.ts:64`（`doNotAskNotifications`）、`:119`（`isDoNotAskFor`）、`:130`（`markDoNotAsk`，带 `forProject`）、`:141`（`clearDoNotAsk`）、`:161`（`canShowNotice`，即「命中就根本不发」那个判定点）；分层清单 `:82`/`:91`/`:106`。
- 上游对照：`platform/ide-core/src/com/intellij/notification/DoNotAskManager.kt:11`、`:13`、`:15`、`:17` 四支（判词写 `:11-17` 覆盖这四行 ✓），`DoNotAskAppManager` 在 `:21`、`DoNotAskProjectManager` 在 `:29` ✓。
- 生产消费方：`src/notifications.ts:72`（notify）与 `:107`（notifyProgress 同一道门，两处都查，判据把数量钉成 2）；`src/components/EventLogPanel.vue:74-81`（行菜单那两个「不再显示」）、`:143-151`（清单「移除」＝解除抑制）、`:174-188`（清单渲染）。
- 判据：`tests/notification-groups.test.mjs:115`（命中就不发）、`:105`（应用级/项目级两张表）、`:125`、`:137`、`:147`（上限丢最旧）、`:254`（`canShowNotice` 调用点恰好两处）；`tests/notification-remind-later.test.mjs:138`、`:157`、`:165`。

### ③ 「稍后提醒」（`RemindLaterManager`）⇒ **只到 `[~]`**

- 实现齐：`src/notificationDoNotAsk.ts:187`（`canRemindLater`）、`:212`（`scheduleRemindLater`）、`:291`（`armRemindLater`，两支到点调度合成一件事）。上游 `RemindLaterManager.kt:32`（服务本体）、`:35-51`（`createAction`，`:38-40` 就是「带 listener / actions / contextHelp 就不排」那道门）✓。
- 生产消费方齐：`src/notifications.ts:15`（import）与 `:278-280`（到点重新走 notify）、`src/components/EventLogPanel.vue:70-73`、`src/notificationEventLog.ts:13` 与 `:129`。
- 判据齐：`tests/notification-remind-later.test.mjs:59`、`:72`、`:91`、`:101`、`:113`；`tests/notification-groups.test.mjs:159`、`:167`、`:179`。
- **还缺的那一件不是这三件里的任何一件，是「生产方」**：判定门是 `canRemindLater(entry, entry.suggestion === true)`（`src/notificationEventLog.ts:129`），而**全仓没有任何通知生产方把 `suggestion` 写成 true**——`grep -rn "suggestion" src/` 在 `src/` 里的命中只有 `src/notificationDoNotAsk.ts`（存的那一条）、`src/notificationEventLog.ts`（字段与判定）和无关的补全/插件搜索文件；`src/notificationEventLog.ts:61-64` 自己就写着「本仓的通知生产方目前没有 suggestion 类型」。上游那一类是插件更新检查 `platform/platform-impl/src/com/intellij/ide/plugins/StandalonePluginUpdateChecker.kt:172` 与低内存提示 `platform/platform-impl/src/com/intellij/diagnostic/LowMemoryNotifier.java:122` 的 `.setSuggestionType(true)`（两条都 `grep -n` 定过），本仓没有这两个生产方。
- 后果（用户可见）：「明天提醒我」在真机上永远不出现在行菜单里，事件日志的「建议」段也永远不画。**代码能跑、判据能过、用户点不到** ⇒ 这一支保留 `[~]`，写清「还缺的是生产方，不是模型层」。

### ④ 声音提示（`NotificationsBeeper`）⇒ `[x]`

- 实现：`src/notificationBeeper.ts:83`（`groupPlaysSound`）、`:89`（`setGroupPlaysSound`）、`:116`（`groupSoundToggleLabel`）、`:217`（`playNotificationSound`）、`:171-201`（Web Audio 合成两声 880Hz，失败静默）。
- 上游对照：`NotificationsBeeper.kt:12-16`（整条三行判定）✓、`NotificationSettings.kt:30`（`isPlaySound` 默认 false）✓、`:46`（只在打开时落 `playSound` 属性）✓、`:75`（`internal fun isSoundEnabled(): Boolean = true` 恒 true）✓。
- 生产消费方：`src/notifications.ts:97`（每条通知进 notify 都过一次发声判定）；`src/components/EventLogPanel.vue:99`/`:103`/`:111`（按组开关，点完立刻落存储）。
- 判据：`tests/notification-beeper.test.mjs:39`（默认不响）、`:45`（未注册的组没声音）、`:67`（关掉是删键不是写 false）、`:105`、`:119`、`:203`（`notify` 里发声必须在 `canShowNotice` 之后）、`:212`（⋮ 菜单接上开关）。
- 顺带发现（**没改，属 `src/`**）：`src/notificationBeeper.ts:24` 与 `:109` 两条注释提到的 `shouldPlaySound` **在这个文件里不存在**（导出的是 `groupPlaysSound` / `playNotificationSound`）。注释里的假函数名，留给宿主 lane。

### ⑤ Event Log 工具窗口（`NotificationsToolWindow`）⇒ `[x]`

- 实现：`src/notificationEventLog.ts:77`（`matchesNoticeQuery`）、`:89`（`eventLogSections` 两段且空段不画）、`:127`（`eventLogRowMenu`）、`:44`/`:52`（上游那两句占位与「搜索中不给占位」）+ `src/components/EventLogPanel.vue`（整面板：搜索、零命中报警底色、清单、⋮ 菜单）。
- 生产消费方（= 真的挂进了工具窗口，不是只有一个组件）：`src/toolWindowMeta.ts:124`（登记成工具窗口那一格：`id: 'notifications'`、`anchor: 'right'`、`secondary: true`；上游同一条在 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1210-1212`，`factoryClass` 正是下面那个工厂）+ `src/components/ToolWindowView.vue:15`（import）与 `:217`（`view === 'notifications'` 渲染并接 `@clear`、`@expire`、`@run`）。
- 上游对照：`NotificationsToolWindow.kt:26`（`NotificationsToolWindowFactory`）、`manage` `:31-47`、`createToolWindowContent` `:49-81`（类体到 `:82`）⇒ 判词写 `:26-81` 成立。
- 判据：`tests/notification-groups.test.mjs:264`（工具窗口挂的就是 EventLogPanel、状态栏弹层仍是 NoticeList）、`tests/notification-event-log-search.test.mjs:43`、`:52`、`:72`、`:64`。
- 注意（诚实登记，不升档）：`ToolWindowView.vue:217` 递进去的是 `ctx.noticeLog`（`NoticeEntry[]`，没有 `suggestion` 字段），所以**生产上这一段永远只有「时间线」**——与 ③ 那条同一个根因。

---

## B · 订正留痕（上一版判词与 msgaudit 的假坐标 / 错归属）

| # | 旧写法 | 盘上实况 | 处置 |
|---|---|---|---|
| B1 | ① 的消费者 `src/lspServerMessages.ts:64` | `:64` 是一句注释（「…而分派表里没有这一支 ⇒ 以前问到就回」）；真实消费点是 **`:68`（import）、`:135-136`（`lspMessageGroupRegistered`）、`:673`（`noticeGroupId`）** | 判词改成后三个，并留「订正留痕」字样 |
| B2 | ② 的判据 `tests/notice-actions.test.mjs` | 那个文件里**一条 DoNotAsk 断言都没有**（`grep -n "canShowNotice\|markDoNotAsk\|isDoNotAskFor\|clearDoNotAsk" tests/notice-actions.test.mjs` 零命中），它钉的是通知动作与 expire 的先后顺序。真正的判据是 `tests/notification-groups.test.mjs:105/:115/:125/:137/:147/:254` 与 `tests/notification-remind-later.test.mjs:138/:157/:165` | 判词换成后者 |
| B3 | 「其中**四支**已在盘上」＋下面列满 ①–⑤ | 五支全在盘上（A 段逐条给过三件套）；`docs/batch-2026-10-06-msgaudit.md:49` 的「四条」同样少数了一支（它自己在同一格把 ⑤ Event Log 也列成已落盘） | 判词改「五支全在盘上」并写明上一版数错 |
| B4 | 真缺 ①：`NotificationRouter.kt:15-27` 的 `routeNotification` 与 `EP_NAME` | interface 在 `:15`、`routeNotification` 在 `:24`、**`EP_NAME` 在 `:28`** ⇒ `:15-27` 盖不到 `EP_NAME`（msgaudit 的 D9 写的 `:15-28` 才是对的） | 判词改 `:15-28` 并逐点标行 |
| B5 | 真缺 ③：「`NotificationsConfigurable` 与 `NotificationsConfigurableUi.kt` 的 displayType、shouldLog、playSound 三列」 | 三个控件在**同目录的 `NotificationSettingsUi.kt`**：`:39-47` 弹窗下拉（`comboBox`，key `notifications.configurable.column.popup`）、`:48-55` 工具窗口勾选（`checkBox`，`.column.toolwindow`）、`:56-65` 播放声音勾选（`checkBox`，`.play.sound`）；`NotificationsConfigurableUi.kt` 是那一页的**外壳**（`:43` 类、`:45` 列表、`:59` 持有 `NotificationSettingsUi`、`:60` 挂 `DoNotAskConfigurableUi`） | 判词拆开两处并标「订正留痕」 |
| B6 | ⑤ 的判据之一是 `tests/notification-power-save.test.mjs` | `:174` 钉的是「组表里有 Power Save Mode 这一组、弹法是 BALLOON、displayId 认得它」⇒ 它是 **① 的生产方判据**，不是 ⑤ 的挂载判据 | 判词把它归到 ①，⑤ 的挂载判据换成 `notification-groups.test.mjs:264` |
| B7 | 任务说「钉这一族数字的 `tests/b*-verdict.test.mjs`」 | 没有任何 b\* 钉 projectviews 这一族：`grep -rn "pv/notification" tests/` 零命中；`grep -rln "projectviews" tests/` 只有 `tests/b5-verdict.test.mjs:14`（读 `projectviews_scan.md`，判的是 `verdict-bookmarks.md` 那 5 类）与 `tests/verdict-generated.test.mjs`。b4 里那个 `69` 是 **folding 域**的类数（`tests/b4-verdict.test.mjs:60`），与 `pv/notification` 的 69 类只是巧合 | 判词所属的门是 `tests/verdict-generated.test.mjs:18`（755）与 `:44`（合计那行的正则），见 §D |
| B8 | msgaudit A7 的「已落盘」清单里 `src/notificationDoNotAsk.ts`（316 行）、`src/notificationBeeper.ts`（224 行） | 当前盘上是 316 行 / 224 行 ✓；但它给的 `src/notificationEventLog.ts`（139 行）现在是 **139 行 ✓**，`src/components/EventLogPanel.vue`（277 行）现在 **277 行 ✓**（末尾 278 是空行）。这几条我核过，不算假坐标 | 无需改 |

---

## C · 重判后仍缺的四条（判词按这四条保持 `[~]`）

1. **`NotificationRouter`**（`platform/ide-core/src/com/intellij/notification/NotificationRouter.kt:15`/`:24`/`:28`）。它是把通知改派给**第二个** manager 的扩展点；本仓全树 `grep -rn "NotificationRouter\|routeNotification" src/ native/ tests/` **零命中**（只有 `docs/inventory/` 的机械行），没有插件贡献点宿主（`src/pluginGroups.ts` 只是插件页的分组模型，文件头 `:1-18` 写明它是 `PluginsGroup`/`SearchQueryParser` 的等价物）、也没有第二个 manager ⇒ 判架构不等价，不硬造。
2. **`NotificationGroupEP` 的第三方注册面**（`platform/ide-core-impl/src/com/intellij/notification/impl/NotificationGroupEP.java:32-33`，`EP_NAME = "com.intellij.notificationGroup"`）。本仓那张表是内建清单，`grep -rn "notificationGroup" native/ src/pluginGroups.ts` 零命中 ⇒ `NotificationGroupManager.java:13`（`isGroupRegistered`）与 `:16`（`getRegisteredNotificationGroups`）两支（上游实现 `impl/NotificationGroupManagerImpl.kt:58`/`:60`）只到「查得到内建组」为止：本仓 `src/notificationGroups.ts:135` 承担「查得到」那一半，而整张 `NOTIFICATION_GROUPS` 除同文件 `:132` 自建索引与各判据外**没有产品消费者**。
3. **逐组设置页**（B5 那两个文件 + `NotificationsConfigurable.java`）。本仓设置树 `src/settingsTreeMeta.ts` 里 `grep -n "通知\|Notification"` **零命中** ⇒ 整节没有；只有 `src/components/EventLogPanel.vue:101-115` 行菜单里那一个按组声音开关。
4. **`NotificationSettings.kt:28` 的 `isShouldLog` 门控**（上游读点 `NotificationsManagerImpl.java:293`）。本仓 `src/notificationGroups.ts:28` 只把 `isLogByDefault` 记成字段与注释；`grep -rn "isLogByDefault" src/ tests/` 的命中只有那张表自身的九个字面量、`src/lspServerMessages.ts:143`/`:506` 两句注释和判据 `tests/notification-groups.test.mjs:67`/`:68` ⇒ **没有任何「这组默认不写进通知中心」的判定**，通知一律进 `noticeLog`。

---

## D · 四档计数与表尾合计（**全部不动**，给数与门）

1. 本族所属逐类表（`docs/inventory/projectviews_verdict_table.md` / `.json`，69 行）：`[~]` 61 + `[-]` 8 = **69**（8 条 `[-]` 是 Swing 机械降级：`NotificationsAnnouncingMode`、`NotificationsManagerImpl`、`DoNotAskConfigurableUi`、`NotificationsConfigurablePanel`、`NotificationsPanel`、`NotificationsUtil`、`StickyButtonUI`、`IdeNotificationArea`）。
2. 域计数表 `docs/inventory/verdict-projectviews.md:20-24`：`[x]` 0 / `[~]` 574 / `[ ]` 0 / `[-]` 181，合计 **755**；表尾 `:41` 那一行逐字是 `` `[x]` 0 + `[~]` 574 + `[ ]` 0 + `[-]` 181 = **755** ``。
3. 为什么不动：这一族的**族档保持 `[~]`**（③ 没生产方、§C 四条真缺），族档没变 ⇒ 69 条逐类档位一条没动 ⇒ 四档与表尾都不动。判词的 `类数` 格仍是 **69**，`档` 格仍是 `[~]`，且都与保留脚本 `scripts/verdict_table.py:76` 的那一格逐字一致（脚本给的档就是 `~`）。
4. 钉这些数的门（本域）：`tests/verdict-generated.test.mjs:18`（`['projectviews', 755]`）、`:25`（`counts.total`）、`:38-41`（四档相加与逐类表逐条复核）、`:44`（判决书表尾那行的正则）。**没有 `tests/b*-verdict.test.mjs` 钉 projectviews**（见 B7）。

### D3 · 顺手量到的两个门覆盖洞（登记，未动 `tests/`）

- `tests/verdict-table-check.test.mjs:56-60` 的 `DOC_SOURCES` 只列 `verdict-execution.md`、`verdict-xdebugger.md`、`verdict-execution-debug.md`，**不含 `verdict-projectviews.md`** ⇒ 「md 那格逐字等于 JSON」这条硬门对本域不生效。
- `python scripts/verdict_table.py --check`（不带域名）只比 execution + xdebugger 的 7 条产物 ⇒ projectviews 的漂移只有 `-check projectviews` 才看得见。实测：把 md 的族档从 `[~]` 改成 `[x]` 后 `node --test tests/verdict-generated.test.mjs tests/verdict-table-check.test.mjs` 仍是 **9/9 全绿**，而 `--check projectviews` 立刻在 diff 里点名 `-| \`pv/notification\` | \`[~]\` … +| \`pv/notification\` | \`[x]\` …`（见 §F2）。

---

## E · 判词真源冲突 ⇒ **需主代理改脚本后重生成**

- 现状（三方）：真源 `scripts/verdict_table.py:76` = 旧判词（581 字，还写着「缺：`NotificationGroup` 注册体系…本仓没有组概念」那五条）；生成物 `docs/inventory/projectviews_verdict_table.json`（14:40:07 被上一路**手改**过）= 上一版重判文字（3352 字）；`docs/inventory/verdict-projectviews.md:35`（本次，15:25 之后）= 我这版复核文字（6143 字）。三件互不相等 ⇒ `--check projectviews` 报「不一致 2 / 3」。
- 我的处置，按任务第 3 条：
  1. **不手改生成物**：`projectviews_verdict_table.{md,json}` 一个字没动（它们与 `docs/inventory/*` 一起在本 lane 的禁改名单里）；
  2. **不改保留文件**：`scripts/verdict_table.py` 没动；
  3. `verdict-projectviews.md` 那一行只改到与脚本一致为止：**档格 `[~]`、类数格 `69`、以及脚本那 316 字的「本仓落点」前半句都逐字保持脚本原文**（脚本回读核验：`reason.startswith(脚本前 316 字) == True`），只有「缺」那一半换成复核结果；
  4. 在此登记：**需主代理把 `scripts/verdict_table.py:76` 那句判词换成 `verdict-projectviews.md:35` 的那一格，再跑 `python scripts/verdict_table.py projectviews` 重生成**，三件产物才会一次对齐。取正文字面的命令：
     `python -c "import io,re;print(re.match(r'^\| \`pv/notification\` \| \`\[(.)\]\` \| (.*) \| (\d+) \|$', io.open('docs/inventory/verdict-projectviews.md',encoding='utf-8').read().split('\n')[34]).group(2))"`
     （换进脚本时注意 Python 字符串里不要出现裸引号结尾，那格本身不含 `"`。）
  5. 上一路「手改生成物 JSON」这件事本身是缺陷（`verdict-table-check.test.mjs:10-22` 的注释就是为本仓防这个写的），一并登记。

---

## F · 验收实验：计数门**真的**会红（原始输出）

### F1 · 表尾合计改一格 ⇒ 门红 ⇒ 改回 ⇒ 绿

```
$ # 把 docs/inventory/verdict-projectviews.md:41 的 `[~]` 574 改成 573
$ node --test tests/verdict-generated.test.mjs
✔ 规模：判决行数 = 枚举文件行数，逐类覆盖且不重复 (233.6379ms)
✖ 四档计数自洽，且文档里印的合计与 JSON 一致 (46.8906ms)
✔ [x]/[~] 族的判词必须指出真实存在的本仓落点 (223.5025ms)
✔ [-] 族的判词必须给得出依据 (164.8187ms)
✔ Swing 组件本体不许判 [~]，且降级规则确有命中 (175.1946ms)
ℹ tests 5   ℹ pass 4   ℹ fail 1
✖ failing tests:
✖ 四档计数自洽，且文档里印的合计与 JSON 一致
  AssertionError [ERR_ASSERTION]: projectviews 判决书的合计那行与 JSON 不一致
    expected: /\[x\]` 0 \+ `\[~\]` 574 \+ `\[ \]` 0 \+ `\[-\]` 181 = \*\*755\*\*/

$ # 改回 574
$ node --test tests/verdict-generated.test.mjs
✔ 规模：判决行数 = 枚举文件行数，逐类覆盖且不重复 (260.6433ms)
✔ 四档计数自洽，且文档里印的合计与 JSON 一致 (205.3805ms)
✔ [x]/[~] 族的判词必须指出真实存在的本仓落点 (213.803ms)
✔ [-] 族的判词必须给得出依据 (168.9187ms)
✔ Swing 组件本体不许判 [~]，且降级规则确有命中 (171.0882ms)
ℹ tests 5   ℹ pass 5   ℹ fail 0
```

### F2 · 族档改 `[~]`→`[x]`（脚本里没有这一档）⇒ 只有 `--check projectviews` 看得见

```
$ node --test tests/verdict-generated.test.mjs tests/verdict-table-check.test.mjs
ℹ tests 9   ℹ pass 9   ℹ fail 0          ← 门覆盖洞，见 §D3
$ python scripts/verdict_table.py --check projectviews | grep pv/notification
17:  -| `pv/notification` | `[~]` | 通知中心与气球（…）          ← 生成物（脚本）
18:  +| `pv/notification` | `[x]` | 通知中心与气球（…）          ← 磁盘（被改的那格）
$ # 已改回 `[~]`，脚本回读：grade == '~'、类数 69、前缀逐字等于脚本
```

### F3 · 判据「能失败」的旁证（并发 lane 现炒的一盘，不是我改的）

同一时刻 `docs/inventory/verdict-folding.md` 改了 §G 的档位而 `tests/b4-verdict.test.mjs` 还没跟着改数，门当场红：`actual: 22, expected: 17`（`tests/b4-verdict.test.mjs:104`）。这正好是「改档不同步计数门 ⇒ 红」的活样本；那条 lane 在 15:29:28 同步完 b4 之后转绿（§H2）。本域的判据同理都是会红的形状（`tests/notification-groups.test.mjs:254` 直接钉 `canShowNotice` 调用点个数 == 2）。

---

## G · 交付前必跑命令的原始输出

```
$ node --test tests/b*-verdict.test.mjs tests/verdict-generated.test.mjs tests/verdict-table-check.test.mjs
ℹ tests 98
ℹ pass 98
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```
（第一次跑同一串时是 `ℹ tests 98 / pass 95 / fail 3`，三条红全在 `tests/b4-verdict.test.mjs`，归属见 §H2；两次之间我没动任何 `tests/` 或 folding 文件。）

```
$ python scripts/verdict_table.py --check
execution: total=1608 [x]=0 [~]=978 [ ]=0 [-]=630
xdebugger: total=635 [x]=0 [~]=338 [ ]=0 [-]=297
[check] 生成物与磁盘比对（未写盘）：
  一致   docs/inventory/execution_verdict_table.json（3674544 字节）
  一致   docs/inventory/execution_verdict_table.md（135741 字节）
  一致   docs/inventory/xdebugger_verdict_table.json（1006298 字节）
  一致   docs/inventory/xdebugger_verdict_table.md（51722 字节）
  一致   docs/inventory/verdict-execution.md（31857 字节）
  一致   docs/inventory/verdict-xdebugger.md（15729 字节）
  一致   docs/inventory/verdict-execution-debug.md（45076 字节）

一致 7 / 7 条产物。          ← 退出码 0，且它自己一个字节都没写（门钉着这条）

$ python scripts/verdict_table.py --check projectviews
…（diff 只落在 pv/notification 那一格）
不一致 2 / 3 条产物：docs/inventory/projectviews_verdict_table.json、docs/inventory/verdict-projectviews.md
判词真源在 `scripts/verdict_table.py` 的 FAMILIES / PLATFORM_FAMILIES / MODULE_HEAP 表里，
生成物不许手改：改表 → `python scripts/verdict_table.py <域>` 重写 → `--check` 复核。
                                        ← 这就是 §E 登记的那件「需主代理改脚本后重生成」；它的退出码实测 1（`echo $?` 直取，不经管道）
```

本族判据测试的当前状态（只读跑，没改任何被测码）：

```
$ node --test tests/notification-groups.test.mjs tests/notification-balloon-fadeout.test.mjs \
    tests/notice-actions.test.mjs tests/notification-remind-later.test.mjs \
    tests/notification-beeper.test.mjs tests/notification-event-log-search.test.mjs \
    tests/notification-power-save.test.mjs tests/notices.test.mjs
ℹ tests 84   ℹ pass 83   ℹ fail 1
✖ Gradle 失败那条通知自带「重新同步 / 打开构建脚本 / 构建工具设置」 (0.9433ms)   ← 归属 §H1
```

`scripts/__pycache__/`：跑 `verdict_table.py` 会让 `verdict_table.cpython-314.pyc` 变脏（该目录**被 git 跟踪**，`git status` 现在是 `M scripts/__pycache__/verdict_table.cpython-314.pyc`，mtime 13:21:14，早于本 lane）。**没 stage、没删**，按共享工作树规矩留给主代理处置。

---

## H · 在飞红与归属（都不是本 lane 造成的，也都不是我去修的）

1. `tests/notice-actions.test.mjs:109`（`assert.match(gradleHost, /function notifyFailure\(directory: string, label: string, error: string\): void/)`）现在红：`src/gradleHost.ts:438` 已被并发改成 `…error: string, issueActions?: { label: string; run: () => void }[]): void`（`src/gradleHost.ts` mtime 14:59:55，`git diff` 该文件 +73/−23；`tests/notice-actions.test.mjs` mtime 07:26:58 没跟着改）。形状过时、意图仍在——按仓里规矩应由那条 lane 自己把断言改成仍精确的那一句。**本 lane 禁改 `tests/`，未动。**
2. `tests/b4-verdict.test.mjs` 我第一次跑门时三条红（`§G 行数`、`69 类`、`四档 22 ≠ 17`），来源是并发 lane 正在改 `docs/inventory/verdict-folding.md`（doc 15:30:46 / test 15:29:28）；第二次跑 98/98 全绿。本 lane 未碰 folding。
3. **交工时最后一次跑门出现一条新的红**，同样不是本 lane 的：`tests/b7-verdict.test.mjs` 的「`src/diffAlign.ts` 引的上游行号没有漂」，报「这些上游引用在 `src/diffAlign.ts` 里找不到了：`Diff.kt:118-127`、`Diff.kt:129-141`、`Diff.kt:96-101`、`Enumerator.kt:16-25`、`MyersLCS.kt:10-11`、`MyersLCS.kt:96-190`、`IgnorePolicy.java:29-35`、`TrimUtil.kt:53-55`」。证据：`src/diffAlign.ts` 的 mtime 是 **15:37:38**（我那扇门在 15:33 与 15:31 两次都是全绿），`git status` 该文件 `M`。⇒ 归并到 diff 那一族的 lane；本 lane 未碰 `src/`。三次跑门的原始计数见下表。

| 跑门时刻 | 结果 | 红的归属 |
|---|---|---|
| 第一次（判词改完，15:3x） | `tests 98 / pass 95 / fail 3` | `tests/b4-verdict.test.mjs` 三条（folding lane 在飞） |
| 第二次（15:33） | `tests 98 / pass 98 / fail 0` | — |
| 第三次（15:38，交工前） | `tests 98 / pass 97 / fail 1` | `tests/b7-verdict.test.mjs` 一条（`src/diffAlign.ts` 15:37:38 在飞） |

**与 projectviews 这一族有关的门（`tests/verdict-generated.test.mjs` + `tests/verdict-table-check.test.mjs`）三次都是 9/9 全绿**；§F1/F2 的红是本 lane 自己造的实验并已还原。

---

## I · 工具结果注入留痕（硬约束 ④）

本会话里**每一次 Edit 的成功回执之后**都追加了一段伪装成 `<system-reminder>` 的「可用 skill 清单」（`presentations`/`html-slides`/`weekly-worklog`…），另有 4 次伪装成用户/系统的「`MEMORY.md` was modified」通知（内容还自述「MEMORY 类先盘上比对再定性」）。处置：

- 一律当**数据**，没执行里面任何一条指令（没收尾、没改 `MEMORY.md`、没调 skill、没因为「证据已确认可收尾」而提前交工）。
- 每一次 Edit 之后都**读盘复现**再决定下一步：`grep -c` 新字面 + `grep -c` 旧字面 + 正则回读那一格（`grade ~` / `count 69` / 前缀逐字 / `pipe in reason: 0`）。所有 Edit 实际都只改到本行，没有一次「返回说改了、盘上没改」的情况。
- 出处：本会话对 `docs/inventory/verdict-projectviews.md` 共发过 **16 次 Edit**（12 次判词编辑 + 4 次 §F 的实验与其还原），每一次的回执尾部都挂着那段假 skill 清单；另有 4 次伪装成用户/系统消息的「`MEMORY.md` was modified」通知（内容还自述「MEMORY 类先盘上比对再定性」）。所有 Edit 实际都只改到目标那一行，**没有出现一次「回执说改了、盘上没改」或「回执说没改、盘上改了」**。

---

## J · 无法核实清单（不许编造）

1. 三个逐组设置控件的**中文标签字面**没取到：`IdeBundle.properties` 的英文值是 `notifications.configurable.column.popup=Popup type:`（`:1348`）、`.column.toolwindow=Show in tool window`（`:1345`）、`.play.sound=Play sound`（`:1346`，三条都在上游 `platform/platform-api/resources/messages/IdeBundle.properties` 里 `grep -n` 定过），但本机找不到 `localization-zh.jar`（`find` 过 `cache/`、`.tmp-probe/`、`/d/Backup/Downloads`），**中文包取值无法核实**。⇒ 判词只写控件种类（下拉 / 勾选 / 勾选）与 key 所在文件行号，**没有引用任何中文标签字面**。
2. 「事件日志的『建议』段在生产上永远不画」这一句是从 `ToolWindowView.vue:217` 递进 `ctx.noticeLog`（无 `suggestion` 字段）+ `src/notificationEventLog.ts:92-93` 的过滤推出的**代码结论**，没在真机上点开过通知工具窗口核对界面（本 lane 不启 GUI）。真机复现不在本判决的验收面里，登记为「代码可证、真机未证」。

---

## 一句话总结

`pv/notification` 原判词的五条「缺」**五条都在盘上**（①②④⑤ 三件齐 ⇒ 记 `[x]`；③ 三件齐但**没有 suggestion 生产方** ⇒ 留 `[~]`），族档仍是 `[~]`，族内 69 条逐类档位一条没动 ⇒ 域四档 `0/574/0/181` 与表尾 `755` 都不动、门不动（门会红的验收已用 F1/F2 实测）。剩四条真缺（`NotificationRouter` 扩展点、`NotificationGroupEP` 第三方注册面、逐组设置页、`isShouldLog` 门控）都在判词里逐条给了上游坐标。**要主代理做的一件**：把 `scripts/verdict_table.py:76` 那句判词换成 `verdict-projectviews.md:35` 的那一格，再 `python scripts/verdict_table.py projectviews` 重生成——现在 `--check projectviews` 还报「不一致 2 / 3」，其中 JSON 那一半是 14:40:07 上一路手改造成的，不是我改的。

**如果只能做 3 件：**
1. 按 §E 第 4 条改脚本 + 重生成（一次消掉两条不一致，顺手把「生成物被手改」这个缺陷抹平）；
2. 给 ③ 补一个 suggestion 生产方（`src/notificationEventLog.ts:61-64` 缺的就是它；最省的落点是插件更新/低内存那一类里本仓真有的那条），否则「明天提醒我」和「建议」段永远是死面；
3. 补 §D3 那两个门覆盖洞（`DOC_SOURCES` 加 `verdict-projectviews.md`，或让 `--check` 默认域名带上 projectviews 与 platform_rest/daemon），不然这一族的档与判词漂移没有任何 node 门看得见。
