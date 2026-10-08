# 接线请求 · 2026-10-06 · 代号 tw3（齿轮的窗口身份 · 收编 W-TW2-3 / W-TW2-4）

规则照 `.tools/agent-rules.md`：只有**消费点在保留文件里**的才写在这里。
本文覆盖 `docs/wiring-requests-2026-10-06-toolwindow2.md` 的 **W-TW2-3** 与 **W-TW2-4**：
组件侧那半（本批能改的面）已经改完并配了判据，剩下的是宿主的一行属性 + 同一条链的第二步。

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（每条坐标本批都亲自打开过）。

> **订正一条坐标**：派单与上一轮文档写的 `platform/platform-impl/src/com/intellij/openapi/wm/impl/newUI/ToolWindowHeader.kt`
> **在参考树里不存在**（`find` 全树只有 `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowHeader.kt`
> 与 devkit 里那个同名类）。原写 newUI、实际 `com/intellij/toolWindow/`——本仓 `src/components/ToolWindowHeader.vue:13`
> 早就引的是对的那条。下面一律用真坐标。

---

## R-1（优先）—— 底部 dock 的齿轮把「当前选中的那一格」交给组件

- **组件侧已经做完**（本批落的，判据 `tests/tool-window-gear-identity.test.mjs` 七条）：
  - `src/menus/toolWindowGear.ts:86` `GEAR_CLOSE_CONTENTS_ROWS`（从 `TOOL_WINDOW_GEAR_SPEC` 派生，不是第二份手抄清单）、
    `:93` `blockedByRegistry()`、`:111` `gearRowsForWindow(rows, toolWindowId)`；
    同一条判据也被造行那一侧复用（`src/menus/toolWindowGear.ts:136`，`toolWindowGearRows` 的第 5 参行为一字未变）；
  - `src/components/ToolWindowGearRows.vue:27` 多了可选位 `toolWindowId`，渲染 `shownRows`（`:30` / `:38`）；
  - `src/components/ToolWindowGear.vue:30` 多了可选位 `toolWindowId`，按钮画不画改用滤后的 `shownRows`（`:37` / `:41` / `:60`），
    并把身份继续递给渲染器（`:67`）；
  - `src/components/ToolWindowHeader.vue:205` **已经把本窗口自己的 `id` 递下去**（侧栏那两格当场生效，不需要宿主加行）。
- **只差宿主把底部那一格选中的 id 递给齿轮**：这一位在 `src/App.vue` 的 `bottomTab` 里，而 `src/App.vue` 是保留文件。
- **目标文件 / 位置**：`src/App.vue` 第 **2172** 行那一长行里的这个标签（行号会随别的代理改动漂，
  **以字符串为准**）：

  ```html
  <!-- 现状 -->
  <ToolWindowGear :rows="bottomGearRows" label="输出窗口选项" @pick="pickEditorPopup($event)" />
  <!-- 改成（只多一个属性，放在 :rows 之前，与标题栏那一处的写法一致） -->
  <ToolWindowGear :tool-window-id="bottomTab" :rows="bottomGearRows" label="输出窗口选项" @pick="pickEditorPopup($event)" />
  ```

  `bottomTab` 的类型是 `BottomTabId | ToolWindowId`（`src/App.vue:258` 那个 `ref`），两边都是字符串联合 ⇒ 直接绑，不用 `String()`。
- **同一批要跟着改的断言**（都钉的是这一行的形状，属性加上后逐字匹配自然失配；严格度不降）：
  - `tests/tool-window-gear.test.mjs:107` 那条 `assert.match(app, /<ToolWindowGear :rows="bottomGearRows" …/)`
    ⇒ 改成把 `:tool-window-id="bottomTab"` 写进去的**同一个整段正则**；
  - 若宿主顺手也改侧栏那两处（**不需要**：标题栏自己已经递了 `id`），才会牵动 `:103` 那条计数断言。
- **上游依据（为什么这一位必须按窗口问）**：
  - 齿轮组是**按标题栏自己那一份 `ToolWindow`** 现取的，不是宿主统一算一份发两侧：
    `platform/platform-impl/src/com/intellij/toolWindow/InternalDecoratorImpl.kt:290`
    （`header = object : ToolWindowHeader(toolWindow, contentUi, gearProducer = { toolWindow.createPopupGroup(true) }) { … }`），
    头部持有的就是它那一个窗口（`platform/platform-impl/src/com/intellij/toolWindow/ToolWindowHeader.kt:68`，
    齿轮按钮在 `:119` 的 `commonActionsGroup` 里，弹层在 `:345-368`）；
  - 组里那条 Close All 的可见性：`platform/platform-impl/src/com/intellij/ui/content/tabs/TabbedContentAction.java:145-149`
    （`setEnabledAndVisible(notForTheOnlyContent && myManager.canCloseAllContents())`），
    而 `canCloseAllContents()` 第一句就是 `if (!canCloseContents()) return false`
    （`platform/platform-impl/src/com/intellij/ui/content/impl/ContentManagerImpl.java:472-481`；
    那一位本身 `:139-142` 只是回注册期的布尔，注册期出处
    `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowImpl.kt:647`、`:264`）；
  - 同一条闸也管标签上的关闭按钮与 Close All But This：`TabbedContentAction.java:87`、`:114`。
- **接上之后用户可见**（判据表就是注册表 `src/toolWindowMeta.ts:98/103` 那两位）：
  - 选 `todo` / `vcslog`（注册写了 `canCloseContents="true"`）⇒ 「关闭所有标签页」继续在；
  - 选 `search` / `debug`（注册了但没写这一位 ⇒ `false`）⇒ **整行不见**（上游用的是 `setEnabledAndVisible`，
    不是留一行灰着的），连「唯一一行被摘掉 ⇒ 齿轮按钮整个不画」也在判据里；
  - 选 `output` / `run` / `problems` / `references` / `hierarchy` / `terminal`（本仓没有 `<toolWindow>` 注册记录
    ⇒ 门面答 `null`，`src/toolWindowManager.ts:233`）⇒ **保持现状**，不替它们猜 `false` 把好用的行关掉。
- **另一条等值的路（不必再走）**：W-TW2-3 原请求是给 `src/menuUi.ts:333` / `:336` 补第 5 参
  （`currentToolWindowId` / `currentBottomContentId` 两个谓词 + `src/App.vue` 依赖对象里给两位）。
  现在两条路用的是**同一条判据**（`blockedByRegistry`），组件侧这一条只多一个属性、且不动
  `tests/tool-window-gear.test.mjs:86`、`:109` 与 `tests/speed-search-wiring.test.mjs:70` 钉住的那两张
  `menuUi` 行表，所以**建议走 R-1**；若宿主偏好行表那侧，`toolWindowGearRows` 的第 5 参早就在那儿，
  照上一轮请求原文照抄即可（两者都做也无害，滤两次同值，已进判据）。

## R-2 —— 同一条链的第二步：三个「按窗口收内容」的动作也要两因子

- **现状**：`src/toolTabs.ts:48` 是个常量 `CAN_CLOSE_CONTENTS = true`，
  `canCloseAllContents(presence)`（`:61-63`）与 `canCloseOtherContents(active, presence)`（`:71-73`）都只乘了这一位；
  调用点在 `src/toolWindowActions.ts:240`（`canCloseOtherContents(ctx.bottomTab.value, toolTabPresence())`）
  与 `:265`（`canCloseAllContents(toolTabPresence())`）。
  `src/toolTabs.ts` 与 `src/toolWindowActions.ts` **都在本批的保留面里**（后者是派单点名的保留文件），所以只能交请求。
- **上游依据（两因子就是源码写的形状）**：
  - `platform/platform-impl/src/com/intellij/ide/actions/ToolWindowCloseOtherTabsAction.kt:21-27`
    （`content != null && contentManager != null && contentManager.canCloseContents() && contents.any { it !== content && it.isCloseable() }`）；
  - `platform/platform-impl/src/com/intellij/ide/actions/ToolWindowCloseAllTabsAction.kt:20-23`
    （`contentManager != null && contentManager.canCloseAllContents()`，而后者 = 注册位 × 「有没有可关的内容」）；
  - `platform/platform-impl/src/com/intellij/ide/actions/CloseActiveTabAction.java:25`（actionPerformed 的第一道闸）
    与 `:46`（`presentation.setEnabled(contentManager != null && contentManager.canCloseContents())`）。
- **可照抄的替换**（`src/toolTabs.ts`：加第二因子，**默认值保持既有行为**，旧调用点不改也照旧跑）：

  ```ts
  /** `ContentManagerImpl.canCloseAllContents()`（`:472-481`）的**两因子**形状：
   *  注册位（`windowClosable`）× 「此刻有没有可关的内容」。
   *  `null` = 这一格在本仓没有注册记录 ⇒ 不猜，退回既有的 `CAN_CLOSE_CONTENTS`（与 R-1 同一口径）。 */
  export function canCloseAllContents(presence: ToolTabPresence, windowClosable: boolean | null = CAN_CLOSE_CONTENTS): boolean {
    if (windowClosable === false) return false
    return CAN_CLOSE_CONTENTS && presentCloseableTabs(presence).length > 0
  }

  export function canCloseOtherContents(active: string, presence: ToolTabPresence,
                                        windowClosable: boolean | null = CAN_CLOSE_CONTENTS): boolean {
    if (windowClosable === false) return false
    return CAN_CLOSE_CONTENTS && presentCloseableTabs(presence).some(tab => tab !== active)
  }
  ```

  `src/toolWindowActions.ts` 的两处调用点各补一个实参（`ctx` 已经有 `bottomTab`）：

  ```ts
  // :240
  return canCloseOtherContents(ctx.bottomTab.value, toolTabPresence(), canCloseContents(String(ctx.bottomTab.value)))
    || referenceTabs.value.some(tab => !tab.selected)
  // :265
  return canCloseAllContents(toolTabPresence(), canCloseContents(String(ctx.bottomTab.value)))
  ```

  （`canCloseContents` 从 `./toolWindowManager.ts` 值 import，带 `.ts` 扩展名。）
- **判据要求**：`tests/tool-tabs.test.mjs` 现在钉的是单因子表；接上后要补一条
  「同一份 presence，`windowClosable` 给 `false` ⇒ `canCloseAllContents` 答 false、给 `null` ⇒ 保持原答」，
  并给 `tests/tool-window-actions*` 那一条「选 `search`（注册 false）时 Ctrl+F4 / Close Other / Close All 全灰」的
  会失败的用例。**本轮没做**：在没有窗口身份的现在改，只会把既有能用的行为关掉（假闸），与「不猜」冲突。

## R-3 —— 判词表那一行要订正（`docs/inventory/` 是保留面）

- **目标文件**：`docs/inventory/verdict-ui-tabs-popup.md` 第 **212** 行那一行（族三），以及 `:215` 那句
  「`PopupUpdateProcessor` 那条 `[~]` 是本族唯一有用户可感差异的缺口」。
- **要订正成什么**：那条"缺口"描述的**行为**在本仓已经有真实实现，只是不在上一轮登记的那个模块里：
  `src/searchEverywhereHost.ts:373-387` —— 弹层开着时监听 `fsChanges.version`，
  按同一个查询词重发符号请求、作废在途文件请求、 debounce 后重取文件清单，
  与 `platform/lang-impl/src/com/intellij/ui/popup/PopupUpdateProcessor.java:31-48`
  的三条规则逐条同形（显示那一刻才挂监听 `:32` / 不可见就退订 `:38`+`:46-48` / 没有新条目不刷新 `:40`）。
  上一轮登记的通道模块 `src/popupLiveUpdate.ts` 已被按死代码删除（证据见 `docs/batch-2026-10-06-tw3.md` §5）。
  ⇒ 建议这一行改成 `[x]`、落点写 `src/searchEverywhereHost.ts:373-387`，并把 `:215` 那句"唯一缺口"改掉。
  ⚠ 改档位会牵动 `tests/b1-verdict.test.mjs`（它按这份表数 `[x]`/`[~]` 的条数），改的时候要同时数一次。
- **为什么本批不自己改**：`docs/inventory/*.md` 是派单点名的保留文件。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R-1 已接线**：`src/App.vue:2253` 的底部齿轮已是 `<ToolWindowGear :tool-window-id="bottomTab" :rows="bottomGearRows" …>`；判据 `tests/tool-window-gear.test.mjs:109` 已按新形状钉住。
- **R-2 / R-3** —— 保留文件/判词，非本 lane。

结论：R-1 已接线。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「R-1 已接线。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
