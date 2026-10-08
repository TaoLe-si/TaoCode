# wiring-requests 2026-10-06 · gradlehostfix

只有一条，**可选、不阻塞**：本 lane 交付的"未链接 Gradle 工程通知"已经能弹（判据在
`tests/notice-actions.test.mjs` 的「未链接 Gradle 工程」那两条），差的只是通知中心里那一行的**组名**
—— 那条通知现在落进"未分组"。目标文件 `src/notificationGroups.ts` 不在本 lane 可改面（派单只给了
`src/gradleHost.ts` 的那两处 + `src/externalSystemAutoImport.ts` 的定义 + `tests/notice-actions.test.mjs`）。

## R1（可选）· 把上游那条 Auto-Link 通知组登记进 `src/notificationGroups.ts`

**上游依据（本 lane 自己开文件核过的坐标）**

- `platform/external-system-impl/resources/META-INF/ExternalSystemExtensions.xml:51-53`：
  `<notificationGroup id="External System Auto-Link Notification Group" displayType="STICKY_BALLOON"
  bundle="messages.ExternalSystemBundle" key="notification.group.external.system.autolink"
  notificationIds="external.system.autolink.unlinked.project.notification"/>`
  ⇒ 组 id、displayType、以及**这条通知的 displayId 就登记在该组的 `notificationIds=` 白名单里**（上游的 id 白名单
  就是这个 XML 属性；本仓 `native/` 里没有任何通知 id 表可对照 —— `grep -rn "displayId|Gradle Notification Group|Power Save Mode" native` ⇒ 0 命中）。
- `platform/external-system-impl/src/com/intellij/openapi/externalSystem/autolink/UnlinkedProjectNotificationAware.kt:142`
  （组 id 常量）、`:143`（displayId 常量，与 XML 白名单逐字相同）、`:54`（`getNotificationGroup(NOTIFICATION_GROUP_ID)`）、
  `:61`（`.setDisplayId(UNLINKED_NOTIFICATION_ID)`）。
- 组标题键：`platform/external-system-api/resources/messages/ExternalSystemBundle.properties:241`
  = `External system build scripts found`。**中文取值无法核实**（本地基准树里没有中文语言包）⇒
  下面那段代码的 `title` 先按英文原值直译登记，主代理手上有 `localization-zh.jar` 时请把 `title` 换成中文包取值并补行号。

**目标文件 + 插入位置**：`src/notificationGroups.ts`，`NOTIFICATION_GROUPS` 数组里 `'Power Save Mode'` 那一项的**后面**
（磁盘现状：那一项到 `:129` 的 `},` 结束，数组的 `]` 在 `:130`）⇒ 插在 `:129` 与 `:130` 之间，**+10 行**。

**可照抄的整段**（缩进与该数组现有项一致 = 两空格）：

```ts
  {
    id: 'External System Auto-Link Notification Group',
    displayType: 'STICKY_BALLOON',
    isLogByDefault: true,
    // 标题：`notification.group.external.system.autolink` 的**英文原值**（中文包不在本地树 ⇒ 未核实）
    title: 'External system build scripts found',
    // intellij… 见 platform/external-system-impl/resources/META-INF/ExternalSystemExtensions.xml:51-53
    // （displayType="STICKY_BALLOON"，notificationIds=external.system.autolink.unlinked.project.notification）；
    // 上游取组的那一行是 UnlinkedProjectNotificationAware.kt:54，displayId 在同文件 :61/:143。
    // 本仓由 src/externalSystemAutoImport.ts 的 UNLINKED_PROJECT_DISPLAY_ID 报出
    //（消费点 src/gradleHost.ts:880，判据 tests/notice-actions.test.mjs 的「未链接 Gradle 工程」那两条）。
  },
```

**以及同文件那张 displayId 前缀表**（`GROUP_BY_DISPLAY_PREFIX`，磁盘现状 `:164-173`）加一行 ——
必须排在**表头之后任意位置**都行（这条前缀与已有的 `lsp:` / `gradle:` / `vcs.commit` / `power.save.mode` 都不冲突）：

```ts
  ['external.system.autolink.', 'External System Auto-Link Notification Group'],
```

**为什么这条是"可选"**：`src/notifications.ts:74-80` 的弹法是 `!group || showsBalloon(group.displayType)`，
未分组与 `STICKY_BALLOON` 都是"弹气球 + 进通知中心" ⇒ 登记前后**用户可见行为不变**，只是通知中心/事件面板里
那行的组名从"未分组"变成上游那一句（`notificationGroupTitle` 的取值）。

**动了要同批改的判据**（`tests/notification-groups.test.mjs` 钉的是"每个登记项的 id 都能查回来""id 不重复"
这类**全表**不变式，加一项不会红；但里面若有按**条数**钉的断言，必须同批改数、不许调低）：
`node --test tests/notification-groups.test.mjs tests/notice-actions.test.mjs tests/notices.test.mjs`。

## 本 lane 不需要主代理接的线（列清楚，免得按"没写=有坑"理解）

- 保留文件一个没碰，也不需要动：`src/App.vue`（通知的 `notify`/`runNoticeAction` 通道早就接好，
  本 lane 只是把第 5 参从"不存在的标识符"换成真字符串）、`src/bridge.ts`、`src/components/CodeEditor.vue`、
  `native/main.cpp`、`scripts/verdict_table.py`、`docs/inventory/*`。
  「未链接工程通知」这一支用的 `deps.notify(...)` 形状（第 5 参 displayId、第 6 参 actions）
  与省电模式那条同形 ⇒ 不需要 App.vue 侧任何新接线。
- 持久化键：本次**没有新增键**。用到的两个既有键
  （`taocode.externalSystem.autoLink.<根>`、`taocode.externalSystem.unlinkedNoticeSkipped.<根>`）
  都已经是"缺键补默认、不按字段数判损坏"的写法（`src/externalSystemAutoLink.ts:23-33`、`:61-71`）。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R1** —— 目标 `src/notificationGroups.ts`（本 lane 可改面，但请求原文点名「不在本 lane 可改面」）。为不与通知域 owner 撞车，登记为待办（插入位置：`NOTIFICATION_GROUPS` 里 `'Power Save Mode'` 之后）。
- 其余为说明项。

结论：零接线（R1 登记）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（R1 登记）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
