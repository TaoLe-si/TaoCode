# 接线请求 · 2026-10-06 · 桶 status2（状态栏 / 进度 / 通知 / 消息窗口 / 错误树 / 音频提示）

派单要求：**目标在保留文件或别人名下的**才写进这份。本轮我自己名下改完的东西在
`docs/batch-2026-10-06-status2.md`。

保留文件（`src/App.vue` / `src/style.css` / `src/tokens.css` / `src/settingsTreeMeta.ts` / `src/bridge*.ts` /
`src/settingsModel.ts` / `src/keymap*.ts` / `CMakeLists.txt` / `package.json` / `native/main.cpp`）
**本轮一个字没动**；`src/problems*`、`src/search*`（别人在途）没碰。

上一批那份 `docs/wiring-requests-2026-10-06-statusbar.md` 的四条，本轮逐条复核后的状态：
请求 3（`bridge` 假控件）**本轮已做完**（两处同批：注册表条目 + 门禁 `KNOWN_GAPS`）⇒ 可关闭；
请求 1、2 仍然成立（本轮实测复核，见下面 W1/W2）；请求 4 的三条治理项不在本域，未重复登记。

---

## W1 · `src/App.vue`（保留，属主 `appvue`）—— `Messages` / `messageDialog` 的宿主

- **本轮实测复核（仍然缺宿主）**：`grep -n "messageDialog|showMessage|MessageHost" src/App.vue` ⇒ **0 命中**；
  `src/components/MessageDialog.vue` **不存在**（`ls src/components | grep -c -i messagedialog` = 0）；
  `src/messageDialog.ts` 的消费者仍然只有一个：`src/components/TrustedProjectDialog.vue:19/:22-46/:53`。
  ⇒ 上一批请求 1 到今天仍然成立，我没有重复登记整段代码 ——
  **可照抄的宿主实现（ref + Promise + `messageDialogModel` 计算属性 + `resolveMessage`）在
  `docs/wiring-requests-2026-10-06-statusbar.md:29-86`（W1 那一条），行号与出口名本轮重新核过，仍对得上磁盘。**
- **挂载锚点（本轮实测的行号）**：对话框宿主请挂在 `src/App.vue:2622`
  （`<TrustedProjectDialog v-if="trustPrompt" …>` 那一条的邻居），脚本段的 import 与
  `createXxx` 挂载处参照 `src/App.vue:41`（`TrustedProjectDialog` 的 import）与 `:623`（`createProgressPanel`）。
- **上游依据**：`platform/platform-api/src/com/intellij/openapi/ui/Messages.java`（静态门面，
  `showYesNoDialog` 一族重载返回选中的按钮）、`platform/platform-impl/src/com/intellij/ui/messages/MessagesServiceImpl.java`、
  `platform/ide-core/src/com/intellij/openapi/ui/MessageDialogBuilder.kt:19` + `MessageType.java`（citefix 订正：原写 `platform/platform-api/...`，参考树里没有该路径）
  （本仓等价物 = `src/messageDialog.ts` 的 `MessageDialogType` / `ExitActionType` / `DO_NOT_ASK_DEFAULT_LABEL`）。
- **判据**：`tests/message-dialog.test.mjs`（桶 7 名下）已覆盖模型侧；宿主落地后请补一条
  "生产消费点存在"的门禁（写法参照 `tests/platform-dialog-geometry-wiring.test.mjs`）。
  我名下那份 `tests/notice-actions.test.mjs` 钉的是通知链，不是这个弹窗。

## W2 · `src/settingsTreeMeta.ts`（保留）+ `src/components/SettingsDialog.vue`（桶 7/8 名下）—— 通知设置页

- **本轮实测复核**：`src/components/NotificationsSettingsPage.vue` **仍然不存在**
  （`ls src/components | grep -c -i notificationssettings` = 0）⇒ 上一批请求 2 仍然成立。
- **数据侧全部已在磁盘**（本轮逐个点名，不新造）：`src/notificationGroups.ts`（`NOTIFICATION_GROUPS`：
  组 id / `displayType` / `showsBalloon` / `balloonFadeoutMs`）、`src/notificationBeeper.ts`
  （`groupPlaysSound` / `setGroupPlaysSound` / `groupSoundToggleLabel`，现消费者 = `EventLogPanel.vue` 的 ⋮ 菜单）、
  `src/notificationDoNotAsk.ts`（应用级 + 项目级两张表、`doNotAskInfos` / `clearDoNotAskInfo` / `scheduleRemindLater`）。
- **连带效果（这一条本轮又核了一遍）**：页面不存在 ⇒ `src/notificationEventLog.ts:104-116`
  的 ⋮ 菜单**不能**给「设置…」（上游那条是第一项、条件是 `isRegistered`，
  `platform/platform-impl/src/com/intellij/notification/impl/ui/NotificationsPanel.kt:1109`），
  「不再询问」清单也只能寄居在通知工具窗口里（`src/components/EventLogPanel.vue:166-188`）。
- **上游依据**：`platform/platform-impl/resources/intellij.platform.ide.impl.xml:966`
  （`NotificationsConfigurableProvider` 的 `applicationConfigurable`）+
  面板本体 `platform/platform-impl/src/com/intellij/notification/impl/NotificationsConfigurable.java`；
  每组"播放声音"复选框 `…/notification/impl/ui/NotificationSettingsUi.kt:56-65`（坐标沿用上一批，本轮未重开该文件）。
- **判据**：页面落地后新增 `tests/notification-settings-page.test.mjs`（我名下前缀）。本轮**不加**，
  因为页面还不存在 —— 给不存在的宿主写判据就是给它发通行证。

## W3 · `src/gradleHost.ts`（桶 15 名下）—— 队列任务体缺**挂起检查点**

- **现状（本轮实测）**：`src/gradleHost.ts:203-207` 入队的那条任务是
  `run: async () => { await sync() }` —— 形参里没有 `indicator`，也就没有 `checkCanceled()` /
  `awaitResumed()` 的节拍。后果：省电模式调 `backgroundTaskQueue.setSuspended(那句正文)`
  （`src/notifications.ts:298`）时，**正在跑的这条同步不会让路**，只有"还没轮到的不开"生效。
  这不是队列的缺陷（队列两条都实现了），是任务体没参加协作。
- **要接什么**（最小替换，可直接粘；`sync()` 自己有多个 await 点，第一条就够把"让路"落地）：

  ```ts
  // src/gradleHost.ts（现在是 :203-207）
  void backgroundTaskQueue.run({
    title: '同步 Gradle 项目更改',
    onCancel: () => { void cancel() },
    // 挂起检查点：省电模式让后台任务让路（上游 `ProgressSuspender.freezeIfNeeded`，
    // `platform/platform-impl/src/com/intellij/openapi/progress/impl/ProgressSuspender.java:154-181`；
    // 暂停原因那句是给进度条看的，`platform/progress/shared/src/suspender/TaskSuspension.kt:24-28`）。
    run: async indicator => {
      await indicator.awaitResumed()
      indicator.checkCanceled()
      await sync()
    },
  })
  ```
  要做得更细，就在 `sync()` 的每一条命令之间再插一次 `await indicator.awaitResumed()`
  （签名 `run: (indicator: ProgressIndicatorModel) => …`，类型出口在 `src/backgroundTasks.ts:33-54`）。
- **本轮我为什么没自己做**：`src/gradleHost.ts` 不在派单给的可改面里。队列侧的判据我已配好
  （`tests/progress-queue-suspend.test.mjs` 钉了"挂起期间 `awaitResumed()` 不放行、恢复后放行"），
  并把 `queueRow` 那句措辞改成不谎报的写法（「正在跑的那条**会在下一个检查点让路**」，
  原写「停在检查点上」= 把没做的事说成做了）。宿主补上检查点后这句仍然成立，不用回改。
- **判据**：`tests/progress-queue-suspend.test.mjs`（我名下）+ 建议 gradle 域补一条
  "同步任务体真的等检查点"的行为用例。

## W4 · `src/components/ProblemsPanel.vue`（桶 2 名下）—— 导出文本的「Details」勾选（模块侧已做完，缺宿主）

- **本轮实测（这是 ③"先核"查出来的形状）**：`src/errorTree.ts:80-88` 的
  `errorTreeText(rows, { details })` **两个分支都实现且被我名下测试钉住**
  （`details === false` ⇒ 只输出组头、跳过每条消息），但唯一的调用点是
  `src/components/ProblemsPanel.vue:521`：`errorTreeText(props.problems)` —— 第二个参数**没人给**，
  于是 `details=false` 那一档对用户不可达。
- **上游依据**：`platform/platform-impl/src/com/intellij/ide/errorTreeView/impl/ErrorViewTextExporter.java`
  —— `:21/:27-28` 那个 `JCheckBox myCbShowDetails`（默认 `setSelected(true)`）、`:38-40` 把它作为
  导出对话框的设置项、`:77-79` 在 `withUsages=false` 时跳过 `NavigatableMessageElement`；
  文案键 `checkbox.errortree.export.details`（英文 "Details"，
  `platform/platform-api/resources/messages/IdeBundle.properties:143`）。
  上游的默认档 = **勾上**（= 本仓现在的行为），所以缺的只是那个复选框本身。
- **要接什么**（可直接粘的形态；`exportText` 在那个组件里，`props.problems` 已是入参）：

  ```ts
  // src/components/ProblemsPanel.vue 脚本段（现有 exportText 在 :513-524 附近）
  const exportDetails = ref(true) // 上游 `myCbShowDetails.setSelected(true)` —— 默认勾上
  // …内容那一行改成：
  //   content: errorTreeText(props.problems, { details: exportDetails.value })
  ```
  模板里在导出对话框/那一行旁补一个复选框（文案就用 `Details`；中文包若有取值再订正），
  `aria-label` 用「导出时包含每条消息」。**不要**给状态栏/别处再加第二个导出入口。
- **判据**：`tests/error-tree.test.mjs`（我名下）已经钉了两档的输出形状；宿主落地后请由 problems 域
  补一条接线用例（`assert.match(panel, /details: exportDetails\.value/)` 那种 grep 级）。

## W5 · `src/App.vue`（保留）—— 内部错误芯片若要进状态栏勾选清单

- 沿用上一批的判定，本轮**复核仍然成立**：上游 `FatalErrorWidgetFactory`
  （`platform/platform-impl/src/com/intellij/openapi/wm/impl/status/FatalErrorWidgetFactory.java:33`
  的 `isConfigurable()` = false、EP 注册在 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1633`）
  ⇒ 上游也不把它列进状态栏右键勾选清单，本仓的等价物是那颗芯片本身
  （`src/components/InternalErrorsChip.vue`，`src/App.vue:14` import、状态栏模板里直接渲染）。
- 若要让它进注册表（用户可显隐），必须**同时**在 `src/App.vue` 用 `showWidget('fatalError')` 包住它，
  否则门禁 `tests/statusbar-popup-motion-parity.test.mjs` 第一条（注册表每个 id 都要被模板消费）会红 ——
  本轮刚把那条门禁的 `KNOWN_GAPS` 清空（见批次报告 ①），**不会**再为新增死条目放行。

---

## status3 复核（2026-10-06 桶 status3；报告见 `docs/batch-2026-10-06-status3.md`）

| 项 | 判定 | 本轮实测 |
| --- | --- | --- |
| W1 `Messages` 宿主 | **仍缺** | `src/App.vue` grep `messageDialog\|showMessage\|MessageHost` ⇒ 0；`src/components/MessageDialog.vue` 不存在；`src/messageDialog.ts` 仍只有 `src/components/TrustedProjectDialog.vue` 一个消费者。**锚点已漂**：`TrustedProjectDialog` 挂载现在是 `src/App.vue:2646`（原写 2622）、`createProgressPanel` import 在 `:124`、调用在 `:636`（原写 623）；`:41` 的 import 锚仍对。可照抄段仍在 `docs/wiring-requests-2026-10-06-statusbar.md` |
| W2 通知设置页 | **仍缺** | `src/settingsTreeMeta.ts` grep `notification` ⇒ 0；页面文件不存在；`src/notificationEventLog.ts:111-112` 仍如实不渲染「设置…」（连带效果不变） |
| W3 Gradle 任务体缺挂起检查点 | **仍缺**，逐字 old/new 见下 | `src/gradleHost.ts:207` 仍是 `run: async () => { await sync() },`（整块 `:204-208`，本轮实测缩进 8 空格） |
| **W4 导出文本的「详情」勾选** | **已闭环（本批做完，不需要接线）** | `src/components/ProblemsPanel.vue:516-519` 加 `const exportDetails = ref(true)`（缺省勾上 = 上游 `ErrorViewTextExporter.java:28`）、`:546` 改传 `{ details: exportDetails.value }`、模板 `:603` 工具栏那颗复选框（复用既有 `.problems-profile-toggle`，`src/style.css` 未动）。判据 `tests/problems-export-text-details.test.mjs`（6 条），反向验证见批次报告 §4。**原请求写的 `:521`/`:513-524` 已漂，实测是 `:546`/`:533-547`** |
| W5 内部错误芯片 | **仍缺（且可以不动）** | `src/App.vue:2297` 仍直接渲染 `<InternalErrorsChip …>`，没有 `showWidget('fatalError')`；上游 `FatalErrorWidgetFactory.java:33` 的 `isConfigurable()=false` 本轮复核仍在 ⇒ 维持现状也讲得通。要动就两处同批：`tests/statusbar-popup-motion-parity.test.mjs:40` 现在是 `const KNOWN_GAPS = new Map()`（空），不会再放行死条目 |

### W3 · 逐字可粘（本轮按磁盘现状重取）

old（`src/gradleHost.ts:207`，行首 8 个空格）：

```ts
        run: async () => { await sync() },
```

new（同一段缩进；`run` 的形参类型见 `src/backgroundTasks.ts:33-54`）：

```ts
        run: async indicator => {
          await indicator.awaitResumed()
          indicator.checkCanceled()
          await sync()
        },
```

上游依据本轮复核：`platform/platform-impl/src/com/intellij/openapi/progress/impl/ProgressSuspender.java:154`（`freezeIfNeeded`）、
`platform/progress/shared/src/suspender/TaskSuspension.kt:24-28`。
`src/backgroundTasks.ts:218` 那句 `while (queueSuspendReason.value !== null) await …` 是队列侧的等待环，
任务体一旦带检查点，省电模式就能真的让路（现在只有"不再开新的"生效）。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W1（messageDialog 宿主）** —— 同 statusbar 请求 1，登记。
- **W2（通知设置页）** —— `src/settingsTreeMeta.ts`（非本 lane）。
- **W3（gradleHost 挂起检查点）** —— `src/gradleHost.ts`（本 lane 可改面），登记。
- **W4（ProblemsPanel 导出 Details 勾选）** —— `ProblemsPanel.vue`（本 lane 可改面，属桶 2 半区），登记为「需 ProblemsPanel owner」。

结论：零接线（W1/W4 登记，W2/W3 转 owner/登记）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（W1/W4 登记，W2/W3 转 owner/登记）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
