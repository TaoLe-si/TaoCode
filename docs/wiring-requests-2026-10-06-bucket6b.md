# 接线请求 · 2026-10-06 · 桶 6b（状态栏 / 进度 / 通知 / 诊断转储）

本轮（桶 6b）**没有改动任何保留文件**。下面三条都卡在保留文件上，按 `docs/batches-2026-10-06-buckets.md` §4 的格式提交。
每条给的代码都是**可以直接粘**的（依赖名与字段名都按磁盘上的真实出口核过）。

---

## 请求 1 · `src/App.vue` 第 841 行 —— 省电模式那一拍 + 项目级「不再为此项目显示」

- **目标文件**：`src/App.vue` 第 841 行
  现状：`} = createNotifications({ notice, noticeError, noticeAction })`
- **要接什么**：给 `createNotifications` 的两个新依赖（都已在 `src/notifications.ts` 里实现好、等输入）：

  ```ts
  } = createNotifications({
    notice, noticeError, noticeAction,
    // 项目级「不再为此项目显示」的判定要读工作区根（不传就等于没有项目，只查应用级表）
    projectRoot: () => workspace.value?.root ?? '',
    // 省电模式：开档发通知 + 挂起后台任务队列，关档收通知 + 恢复（App.vue 里的 togglePowerSave 就是关闭通道）
    powerSave: {
      enabled: () => editorSettings.value.powerSaveMode,
      turnOff: () => { if (editorSettings.value.powerSaveMode) void togglePowerSave() },
    },
  })
  ```

  同时**删掉第 633 行那句自制文案**（`notify(editorSettings.value.powerSaveMode ? '已开启省电模式：语言服务与后台轮询暂停。' : '已关闭省电模式。')`）：
  那句话与通知链给的那条是同一天空下的两件事，留着就是两条重复通知，而且文案不是上游的（上游正文是
  「省电模式已开启 / 代码洞察和后台任务已禁用。」+ 两个动作）。第 632 行的 `saveSettingsPatch` 要留着。
- **为什么需要**：`src/notificationPowerSave.ts` 与 `src/progressSuspender.ts` 的规则/模型上一轮已经写完，
  但**生产链断在这里**：省电模式打开时不发通知、后台任务队列也不会挂起（`backgroundTaskQueue.setSuspended`
  全仓零调用点）。本轮把挂载做进了 `src/notifications.ts:228-246`（属我名下），只差 `editorSettings` 这一路输入。
- **上游依据**：
  - `platform/lang-impl/src/com/intellij/ide/actions/PowerSaveModeNotifier.kt:17-22`（ProjectActivity：开档启动补发一条）
  - `platform/lang-impl/src/com/intellij/ide/actions/TogglePowerSaveAction.java:20-25`（`setEnabled(state)`；`if (state)` 才发）
  - `PowerSaveModeNotifier.kt:26,30-32`（`ignore.power.save.mode` 命中就整条不发）、`:34`（组 "Power Save Mode"）、
    `:35-37`（标题/正文/WARNING）、`:39-44`（第一个动作「不再显示」+ expire）、`:45-50`（第二个动作「禁用省电模式」+ expire）、
    `:52-56`（订阅 `PowerSaveMode.TOPIC` ⇒ 模式再变就 `notification.expire()`）
  - `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1802`（`displayType="BALLOON"`）
  - 中文取值：`D:\IntelliJ IDEA 2026.2\plugins\localization-zh\lib\localization-zh.jar` 的
    `messages/IdeBundle.properties:63`（`action.Anonymous.text.do.not.show.again=不再显示`）、`:1661`、`:2027`、`:2028`、`:2029`
  - `platform/ide-core/src/com/intellij/notification/DoNotAskManager.kt:29-34`（项目级那张表；本轮未重读，沿用上一轮登记）
- **判据**：`tests/notification-power-save.test.mjs`（本轮新增，7 条用例；其中 3 条是**行为**用例，
  直接驱动 `createNotifications({ powerSave })`）。请求 1 落地后不需要改测试。

---

## 请求 2 · `src/App.vue` 第 1467 行 —— 排障信息里的 Project 那一段

- **目标文件**：`src/App.vue` 第 1467 行
  现状：`} = createHelpActions({ notify, isDesktop, helpPanel: help, openActionSearch: () => openActionSearch() })`
- **要接什么**：

  ```ts
  } = createHelpActions({
    notify, isDesktop, helpPanel: help, openActionSearch: () => openActionSearch(),
    // 上游每个 GeneralTroubleInfoCollector 都收一个 `project`；本仓由调用方注入（收集器在 src/troubleshootingCollectors.ts）
    projectContext: () => workspace.value
      ? {
          name: workspace.value.name,
          root: workspace.value.root,
          trusted: isProjectTrusted(workspace.value.root, generalSettings.value.trustedPaths),
        }
      : null,
  })
  ```

  （`isProjectTrusted` 从 `./trustedProjects.ts` 引：真实出口 `src/trustedProjects.ts:73`。
  `src/helpActions.ts:38` 已经有 `projectContext?: () => ProjectTroubleContext | null` 这一项依赖，只是没人传。）
- **为什么需要**：`src/troubleshootingCollectors.ts:130-137` 的第五条收集器（标题 `Project`、
  内容 `Project trusted: …`）已经写好且有判据（`tests/troubleshooting-collectors.test.mjs`），
  但生产链断在 App.vue 没传 → 「复制排障信息」里**永远没有 Project 那一段**。
- **上游依据**：`platform/platform-impl/src/com/intellij/ide/troubleshooting/ProjectTroubleInfoCollector.java:11-13`（`getTitle() = "Project"`）、
  `:16-18`（`collectInfo(project)` 返回 `"Project trusted: " + TrustedProjects.isProjectTrusted(project)`）
- **判据**：`tests/troubleshooting-collectors.test.mjs`（既有）。落地后建议补一条"App.vue 真的传了 projectContext"的接线断言。

---

## 请求 3 · `src/style.css` 第 254 行 / `:320` 同族写法 —— 无需改动，仅登记一条**他人域**的门禁红

不是改动请求，是**收口提示**（避免主代理以为还挂在我名下）：

- `tests/ui-motion.test.mjs` 的「interactive 的 `:hover` 改了可见属性就必须有 transition」这条**本轮已从我名下清干净**，
  剩下的两条不是我的人：
  - `src/components/DebugInspectWindow.vue:172` `.debug-inspect-row:hover` ⇒ 桶 12
  - `src/components/RefactorPreviewDialog.vue:156` `.refactor-preview-row:hover` ⇒ 桶 1
  修法与我的两处一样（给**底规则**加 `transition: background-color var(--dur-1) var(--ease);`，照 `src/style.css:254` `.icon-button` 的写法）。
- `tests/module-size.test.mjs` 本轮红的是 `src/components/SearchPanel.vue(903 行)` ⇒ 桶 9，不在我名下，我没动。

---

## 本轮**已经全接线、不需要请求**的一条（免得重复排查）

`pv/notification` 的**气球存在时长**：`src/notifications.ts:86` 的 `notify()` 现在直接调
`armBalloonFadeout(entry.id, group?.displayType ?? 'BALLOON')`（实现 `:120-172`），
档位取 `src/notificationGroups.ts:148` 的 `balloonFadeoutMs`（BALLOON 10 秒 / STICKY_BALLOON 300 秒，
上游 `NotificationsManagerImpl.java:446-449`），并承接了 `startSmartFadeoutTimer` 的"smart"
（`:hover` 时不 fade）与 `frameActivateBalloonListener`（界面在后台不起表，`:461-463`）。
气球状态由 `createNotifications` 自己持有的那三个 ref 驱动 ⇒ **不碰 `App.vue` 就生效**。
判据：`tests/notification-balloon-fadeout.test.mjs`（5 条，含反向验证记录在批次报告 §3）。

---

## 本轮**没有**提交请求的一条（订正判词，避免重复劳动）

`docs/inventory/verdict-platform_rest.md:268`（`pf/audio-cues`）那句「逐 cue 复选框未接界面
（`audioCuesDisabled` 是可选设置字段，**未登记进设置模型**）」已经过时：磁盘上的真实出口是

- `src/settingsModel.ts:141`（字段声明）与 `:201`（默认值 `[]`）
- `native/settings_schema.cpp:167`（默认档）与 `:217`（校验分支）
- `src/bridgePreview.ts:270`、`:301-306`（预览侧白名单与校验）
- `src/components/AudioCuesSettingsPage.vue:44`、`:54`（逐 cue 复选框写入）
- `src/audioCueHost.ts:90`（`fire` 处按 `disabledCueIds` 门控）
- 该页已挂进设置对话框：`src/components/SettingsDialog.vue:36`、`:1015`

⇒ 这条**不需要动保留文件**，也不需要请求；判词的「缺」应当从 audio-cues 那一行里去掉（改判词要动
`scripts/verdict_table.py`，按 §9 我没有动 `docs/inventory/verdict-*.md` 的生成物）。
