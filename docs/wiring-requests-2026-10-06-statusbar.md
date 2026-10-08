# 接线请求 · 2026-10-06 · 桶 statusbar（状态栏 / 进度 / 通知 / 诊断转储）

派单要求：**目标在保留文件或别人名下的**才写进这份。本轮我自己名下改完的东西在
`docs/batch-2026-10-06-statusbar.md`。

保留文件（`src/App.vue` / `src/style.css` / `src/tokens.css` / `src/settingsTreeMeta.ts` …）**本轮一个字没动**。

---

## 请求 1 · `src/App.vue` —— `Messages`/`MessagesService` 的统一宿主（= 桶 7b 的 A3）

- **目标文件**：`src/App.vue`（保留；当前属主是 `appvue`）。
- **磁盘现状（本轮实测）**：`src/messageDialog.ts` 全仓只有一个消费者 ——
  `src/components/TrustedProjectDialog.vue:19`（引 `MESSAGE_TYPE_ICON` / `messageButtons` /
  `messageDialogModel` / `shouldRememberChoice`，模型在 `:53` 组、按钮文案在 `:22-46`）。
  `src/App.vue` 里 grep `showOkCancelDialog|showYesNoDialog|messageDialog|MessageHost` **零命中**
  ⇒ 桶 7b A3 那条"缺宿主"到今天仍然成立，我没有重复登记，只是**复核并确认**。
- **上游依据**（本轮亲自打开核过，路径以本地树为准；桶 7b 原写法没有给行号）：
  - `platform/platform-api/src/com/intellij/openapi/ui/Messages.java` —— 静态门面，`showYesNoDialog(...)`
    一族重载在 `:456/:471/:488/:505/:514/:527/:540/:549/:565/:581/:595`（父窗口三种给法：
    `Project` / `Component` / 无父），每个都**返回 int**（选中的是哪个按钮）。
  - `platform/platform-impl/src/com/intellij/ui/messages/MessagesServiceImpl.java` —— 同一个面体的服务实现
    （`Messages` 在它之上退化成门面）。
  - `platform/ide-core/src/com/intellij/openapi/ui/MessageDialogBuilder.kt:19`、`MessageType.java`（同目录；citefix 订正：原写 `platform/platform-api/...`，参考树里没有那条路径）
    —— 本仓的等价物已经是 `src/messageDialog.ts`（`MessageDialogType` 四种图标语义、`ExitActionType`、
    `DO_NOT_ASK_DEFAULT_LABEL`）。
- **要接什么**（可直接粘的形态；`messageDialog.ts` 的出口名按磁盘上的真实签名，见 `:53-85`）：

  ```ts
  // src/App.vue（脚本段，靠近其它 createXxx 挂载处）
  import { computed, ref } from 'vue'
  import {
    messageButtons, messageDialogModel, shouldRememberChoice,
    type ExitActionType, type MessageDialogType,
  } from './messageDialog'

  // 上游 `Messages` 是一个**全局门面**：调用点不持有弹窗状态，只 await 结果。
  // 本仓把它落成一个宿主 ref + 一个 Promise（父窗口/居中在 DOM 里由对话框壳子承担）。
  const messageRequest = ref<{
    title: string; message: string; type: MessageDialogType; exits: readonly ExitActionType[]
    doNotAsk?: string | null; saveDoNotAskOnCancel?: boolean
    resolve: (exit: ExitActionType) => void
  } | null>(null)

  /** `Messages.showYesNoDialog` / `showOkCancelDialog` 的等价物：带回传结果。 */
  function showMessage(options: {
    title: string; message: string; type?: MessageDialogType; exits?: readonly ExitActionType[]
    doNotAsk?: string | null; saveDoNotAskOnCancel?: boolean
  }): Promise<ExitActionType> {
    const exits = options.exits ?? ['yes', 'no']
    return new Promise<ExitActionType>(resolve => {
      messageRequest.value = {
        title: options.title, message: options.message, type: options.type ?? 'question',
        exits, doNotAsk: options.doNotAsk ?? null, saveDoNotAskOnCancel: options.saveDoNotAskOnCancel === true,
        resolve,
      }
    })
  }
  /** 模型直接复用桶 7 的纯函数，不再各处自己拼一遍。 */
  const messageModel = computed(() => {
    const request = messageRequest.value
    if (!request) return null
    return messageDialogModel({
      title: request.title, message: request.message, type: request.type,
      buttons: messageButtons(request.exits),
      doNotAsk: request.doNotAsk, saveDoNotAskOnCancel: request.saveDoNotAskOnCancel,
    })
  })
  function resolveMessage(exit: ExitActionType, remember: boolean) {
    const request = messageRequest.value
    if (!request) return
    const model = messageModel.value
    // `DialogWrapper.close` 的口径：没勾 / 取消关掉时不记（除非 saveDoNotAskOnCancel）。
    if (model && shouldRememberChoice(model, remember, exit) && model.doNotAsk) {
      // 落哪张表由调用方决定：通知族是 `src/notificationDoNotAsk.ts:markDoNotAsk(id, message, forProject, root)`。
    }
    messageRequest.value = null
    request.resolve(exit)
  }
  ```
  模板里挂一个宿主即可（`<MessageDialog v-if="messageModel" :model="messageModel" @choose="resolveMessage" />`）。
  **对话框组件文件不在本桶名下**：要么复用 `TrustedProjectDialog.vue` 那套壳子（它已经是
  `messageDialogModel` 的渲染面），要么新建 `src/components/MessageDialog.vue` —— 新建 .vue 需要主代理点名归属。
- **为什么需要**：`ic/dialogs` 族判词的缺 ① 就是这一条；模型侧齐了，缺宿主。
- **判据**：`tests/message-dialog.test.mjs`（桶 7 名下）覆盖模型；宿主落地后请补一条
  "生产消费点存在"的门禁（`grep` 级，参照 `tests/platform-dialog-geometry-wiring.test.mjs` 的写法）。

---

## 请求 2 · `src/settingsTreeMeta.ts` + `src/components/SettingsDialog.vue` —— 通知设置页

- **目标文件**：`src/settingsTreeMeta.ts`（保留：设置树的表）、`src/components/SettingsDialog.vue`（桶 7/8 名下）。
- **要接什么**：一节 `reference.settingsdialog.notifications` 的设置页（组列表 + 每组「弹出气球 / 静默」+
  「播放声音」+ 那张「不再询问」清单的**官方宿主**），数据侧**全都已经在磁盘上**，本页只是缺一个宿主：
  - `src/notificationGroups.ts`：`NOTIFICATION_GROUPS`（组 id、`displayType`、`showsBalloon`、
    `balloonFadeoutMs`、displayId→组 的映射）；
  - `src/notificationBeeper.ts`：`groupPlaysSound` / `setGroupPlaysSound` / `groupSoundToggleLabel`
    （现在只被 `EventLogPanel.vue` 的 ⋮ 菜单用着）；
  - `src/notificationDoNotAsk.ts`：应用级 + 项目级两张表、`doNotAskInfos` / `clearDoNotAskInfo`。
- **上游依据**：
  - `platform/platform-impl/resources/intellij.platform.ide.impl.xml:966`
    （`provider="com.intellij.notification.impl.NotificationsConfigurableProvider"` 的
    `applicationConfigurable` 注册），面板本体
    `platform/platform-impl/src/com/intellij/notification/impl/NotificationsConfigurable.java`
    （本轮按文件名+包路径两条路都找到了它；**逐行控件表本轮没数** ⇒ 页面结构请按那条类补做，我不编）。
  - 每组的"声音"复选框：`platform/platform-impl/src/com/intellij/notification/impl/ui/NotificationSettingsUi.kt:56-65`
    （这条坐标沿用了上一轮登记，本轮未重开该文件）。
- **为什么需要 / 现在的落点差异**：上游 Event Log 每行 ⋮ 菜单的**第一条是「设置…」**
  （`platform/platform-impl/src/com/intellij/notification/impl/ui/NotificationsPanel.kt:1109`，条件是这一条
  在设置里注册过 `isRegistered`），本仓没有那一页 ⇒ `src/notificationEventLog.ts:88-91` 明确不渲染该条目
  （渲染了就是点不动的假控件）。「不再询问」清单也因此寄居在通知工具窗口里
  （`src/components/EventLogPanel.vue:162-176`，上游是 `DoNotAskConfigurableUi`）。
  这一页落地后：⋮ 里能补回「设置…」、清单可以搬回设置对话框。
- **判据**：新增 `tests/notification-settings-page.test.mjs`（我名下前缀）；本轮**没有**预先加，
  因为页面还不存在 —— 加了就是给假控件写判据。

---

## 请求 3 · `tests/statusbar-popup-motion-parity.test.mjs` —— `bridge` 那条假控件的收口（归属不清）

- **现状（本轮实测）**：`src/statusWidgets.ts:108` 的 `{ id: 'bridge', displayName: '桥接状态', factory: false }`
  在勾选清单里，但 `src/App.vue` 的状态栏模板**没有** `showWidget('bridge')`（模板里实际消费的 16 个 id：
  branch / column / encoding / file / indent / lineSeparator / lspServices / memory / notices / position /
  powerSave / problems / progress / readonly / smartMode / vfsRefresh）⇒ 勾它不改变任何东西 = §3 禁止的假控件，
  而且上游没有对应物（`intellij.platform.ide.impl.xml:1618-1644` 那一整批工厂里没有"桥接状态"）。
- **门禁**：`tests/statusbar-popup-motion-parity.test.mjs:34-38` 的 `KNOWN_GAPS` 正钉着它，`:40-55` 那条用例
  同时要求"KNOWN_GAPS 不能过期"。
- **要主代理做的（两处必须同一批）**：
  1. `src/statusWidgets.ts` 删掉 `{ id: 'bridge', … }` 那一行，并把文件头注里"`bridge` 没有消费者"
     那段改成"已删除"；
  2. `tests/statusbar-popup-motion-parity.test.mjs:34-38` 把 `KNOWN_GAPS` 清空（`:51-54` 那个反查循环会
     因为条目消失而红，必须同步改）。
  我不能自己做完：那个门禁文件不在我的可改面（派单只给了 `tests/status-*` / `tests/notice-*` /
  `tests/notification-*` / `tests/progress-*` / `tests/about-*` / `tests/error-tree-*`；
  `statusbar-*` 不匹配 `status-*`），而在只删注册表不动门禁的情况下跑门禁必红 ⇒ **本轮如实保留原状**，
  登记在这里。
- **判据**：`tests/status-bar-widgets.test.mjs:95` 与 `tests/status-widgets-registry.test.mjs:60` 那两处
  `['file','progress','bridge','problems']` 的清单也在我的可改面内，会随条目一起改（断言体是
  "这四条不是工厂"，删掉 `bridge` 后仍然精确）。

---

## 请求 4 · 治理类（= 桶 7b 的 A5，三条逐条复核，含两处订正）

1. **`docs/inventory/verdict-find-diff.md` 不要按快照重写** —— 现状：`tests/b7-verdict.test.mjs`
   **10/10 绿**（本轮实测），四档计数没有被冲掉。
   仍然成立的半条：`build/b7-sweep/*` 与 `build/b7rows.json` **被 `.gitignore:3` 的 `build/` 整目录排除**
   （实测 `git check-ignore -v build/b7-sweep/sweep.mjs` → `.gitignore:3:build/`），
   所以那两个清扫/还原脚本现在还是没有 diff 可审。⇒ 请主代理加 `.gitignore` 白名单，或把它们搬到 `scripts/`。
2. **`scripts/verdict_table.py` 与 `docs/inventory/*` 的跟踪状态** —— **订正桶 7b 的说法**：
   本轮 `git ls-files` 实测 `scripts/verdict_table.py` **已被跟踪**（状态是 ` M`，有 diff 可审），
   `docs/inventory/` 整目录也在跟踪里（`git ls-files docs/inventory/` 有命中）。
   ⇒ A5-2 这条已经不需要做了。
3. **`npx vue-tsc -b --force` 的那条 `customFoldingProviders.ts(48,103) TS1002`** —— **已清**：
   本轮实测**退出码 0、零输出**（0 错），与派单写的基线一致 ⇒ A5-3 关闭，不用再派给折叠属主。

---

## 附：本轮**验证过、决定不照抄**的一条上游闸（不是请求，写在这是为了防止下一轮重复排查）

上游 `platform/platform-impl/src/com/intellij/notification/impl/widget/NotificationWidgetFactory.java:13-15`
的 `isAvailable()` 是 `UISettings.hideToolStripes || UISettings.presentationMode` —— 正常档（工具窗口条可见）时
**状态栏那个通知组件不建**，通知住在工具窗口条上的通知区（同类 `IdeNotificationArea.java:46/105-107`）。
本仓没有那条通知区：Event Log 面板是工具窗口的一个内容
（`src/components/ToolWindowView.vue:191`），而气球/弹层那一份唯一可见面就是状态栏这条 chip（`App.vue` 的
`NoticeList`），并且本仓的 `presentationMode` 会把整个 footer 隐藏（`App.vue` 状态栏那一条 `v-if`），
照抄那条闸 = 默认配置下用户失去唯一的收通知入口。⇒ **登记差异、不照抄**，理由写进
`src/statusWidgets.ts` 表头（同一处还登记了勾选清单里五个名字按上游 bundle 订正的逐条出处）。

---

## status3 复核（2026-10-06 桶 status3；报告见 `docs/batch-2026-10-06-status3.md`）

| 项 | 判定 | 本轮实测 |
| --- | --- | --- |
| 请求 1（`Messages`/`messageDialog` 宿主） | **仍缺 ⇒ 本批复述并订正锚点** | `src/App.vue` grep `messageDialog\|showMessage\|MessageHost` ⇒ **0 命中**；`src/components/MessageDialog.vue` **不存在**；`src/messageDialog.ts` 的唯一消费者仍是 `src/components/TrustedProjectDialog.vue`。上面 `:29-86` 那段可照抄实现**本轮逐字复核过出口名仍然对得上磁盘**（`messageButtons` / `messageDialogModel` / `shouldRememberChoice` / `ExitActionType` / `MessageDialogType`）。**锚点订正**：挂载邻居现在是 `src/App.vue:2646`（原写 2622）、`createProgressPanel` 的 import 在 `:124`、调用在 `:636`（原写 623）；`:41` 的 `TrustedProjectDialog` import 仍对 |
| 请求 2（通知设置页） | **仍缺** | `src/settingsTreeMeta.ts` grep `notification` ⇒ **0 命中**；`src/components/NotificationsSettingsPage.vue` 不存在；连带效果仍成立 —— `src/notificationEventLog.ts:111-112` 明确不渲染「设置…」（本轮实测那两行还在）。「不再询问」清单仍寄居在 `src/components/EventLogPanel.vue`。**上游 `NotificationsConfigurable.java` 的逐控件表本批也没数** ⇒ 页面结构仍不许照编 |
| 请求 3（`bridge` 假控件） | **已闭环 ⇒ 可关闭** | `src/statusWidgets.ts` 注册表里已无 `bridge`（只剩 `:25-36` 的留痕注释）；`tests/statusbar-popup-motion-parity.test.mjs:40` ⇒ `const KNOWN_GAPS = new Map()`（空）；`tests/status-widgets-registry.test.mjs` 那条「`bridge` 已删，存档里残留的键也不复活它」本轮实跑绿 |
| 请求 4（治理 3 条） | `[-]` 不在本域 | 4.1 的 `build/` 白名单、4.2/4.3 都归主代理与折叠属主；本批未重复核，**不要按本批的报告认为它们已处理** |
| 附（通知区那条闸） | 维持"登记不照抄" | 本轮复核：状态栏那颗通知芯片仍在 `src/App.vue:2297` 行内（`showWidget('notices')` 那一条），`presentationMode` 仍把整个 `<footer>` 隐藏 ⇒ 结论不变 |

## 处理结果（wiring-backlog lane，2026-10-06）

- **请求 1（`Messages`/`messageDialog` 统一宿主）** —— 目标 `src/App.vue`（本 lane）。复核 `src/components/MessageDialog.vue` **不存在**，`messageDialog.ts` 仅被 `TrustedProjectDialog.vue` 消费。登记为待办（需先定门面形状，与 bucket7b A3 同一条）。
- **请求 2（通知设置页）** —— `src/settingsTreeMeta.ts`（非本 lane）+ `SettingsDialog.vue`。需 settings-tree owner。
- **请求 3 / 4** —— 判据/治理项。

结论：零接线（请求 1 登记，请求 2 转 owner）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（请求 1 登记，请求 2 转 owner）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
