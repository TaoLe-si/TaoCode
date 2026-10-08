# 接线请求 · 2026-10-06 · 桶 8 第二轮（代号 toolwindow2 · 工具窗口 / 侧条 / 门面）

规则照 `docs/agent-playbook-parity.md`：**只有消费点在保留文件里**（`src/App.vue` / `src/menuUi.ts` / `src/gearHostRows.ts`）的才写在这里，
本桶名下能改的都已经改完了（见 `docs/batch-2026-10-06-toolwindow2.md`）。
每条给：目标文件 + 目标行号 + import 语句 + 可照抄的整段替换代码 + 上游依据。

> 与上一轮的关系：`docs/wiring-requests-2026-10-06-toolwindow.md` 的 **W-TW-1**（齿轮把当前窗口 id 传下去）
> 在本轮重新核过，仍然只能由宿主接（那条链路的两端都在保留文件里）⇒ 收进本文 **W-TW2-3**，
> 原请求作废。**W-TW-2**（A1 剩下两个弹层宿主 `EditorPopupMenu.vue` / `SearchEverywhereDialog.vue`）
> 不在本轮派单的文件面里 ⇒ 原样留在上一份文档，未重复登记。
> `docs/wiring-requests-2026-10-06-bucket8c.md` 的 **B1/B2**（树右键菜单、底部标签溢出菜单压进弹层栈）
> **主代理已接**（本批核对：`src/App.vue` 里 `moreMenuBox`/`treeMenu` 那两处 `ref` 已在，2148 行那条溢出菜单
> 已带 `ref="moreMenuBox"`）⇒ 本批一条没重做，只把 **B3**（`TabContextMenu`）确认成"上一轮已完成"。

---

## W-TW2-1（优先级最高）—— 把常驻激活栈交给门面：`lastActiveToolWindowId`

- **模块侧已经做完**：`src/toolWindowManager.ts` 的 `ToolWindowManagerSource.activationStack`
  + 门面那一位 `lastActiveToolWindowId()`（判据 `tests/tool-window-manager.test.mjs` 三条，
  其中「宿主没给 ⇒ 答 null」这一条钉的就是"门面不许自己记第二份账"）。
  `src/toolWindowStripes.ts` 也已经把依赖转发写好了（`ToolWindowStripesDeps.activeStack`，
  装配点 `activationStack: deps.activeStack ? () => deps.activeStack?.value ?? [] : undefined`）。
  **只差宿主把那个已有的栈递进来。**
- **目标文件**：`src/App.vue` 第 **275-283** 行那一句 `createToolWindowStripes({ … })` 的参数表
  （紧挨第 282 行的 `compactMode` / `showNames` 那一行即可）。
- **要接什么**（一行；`activeToolWindows` 已经住在 `src/App.vue:347`，声明比这里晚 ⇒ **必须用惰性 getter**，
  与同一参数表里的 `workspace` / `lspReady` 一个写法）：

  ```ts
    // `ToolWindowManager.lastActiveToolWindowId`（`ToolWindowManager.kt:132`）：
    // 门面只读这份持久栈（唯一的 push 点是上面 `recordActiveToolWindow`），不自己记账。
    activeStack: { get value() { return activeToolWindows.value } },
  ```

- **上游依据**：`platform/platform-api/src/com/intellij/openapi/wm/ToolWindowManager.kt:132`
  （`lastActiveToolWindowId`）；实现 `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowManagerImpl.kt:746-753`
  （`peekPersistent(i)` 自栈顶往下 + `filter { it.isAvailable }`）；
  隐藏不出栈：同文件 `:712-718`（`setHiddenState` 走 `activeStack.remove(entry, false)`）；
  只有注销才真删：`:1217`；栈的两份之分 `platform/platform-impl/src/com/intellij/openapi/wm/impl/ActiveStack.java:15-26`；
  消费者 `platform/platform-impl/src/com/intellij/ide/actions/JumpToLastWindowAction.java:25`（actionPerformed）
  与 `:42-43`（update 的可用性）。
- **接上之后本仓多出来的东西**：门面对 F12 那条链（宿主 `src/App.vue:365` 的 `jumpToLastToolWindow`）
  之外也答得出"上一个激活的窗口"，`ToolWindowHeader.vue` / 状态栏 / 任何只认门面的组件都能查这一位，
  不必再回头 import 宿主的 `activeToolWindows`。

## W-TW2-2 —— 侧条拖放的"落到分隔件之后 = 变成 side tool"

- **模块侧已经做完**：`src/toolStripeDrag.ts` 的 `ToolStripeDragContext` 加了三个**可选**成员
  （`stripeIds` / `isSplit` / `setSideTool`）与 `applyDropGroup()`；不给就只是排序（既有行为一字不变，
  三条判据见 `tests/tool-stripe-split.test.mjs`，其中一条专门钉"宿主没给这一对时照旧只排序"）。
  写入点 `src/toolWindowStripes.ts` 的 `setSideTool(id, split)` 也已经导出（值变了才写盘）。
  **分隔件本身已经在画了**（`src/components/ToolStripe.vue` 直接读门面 `windowInfo(id).isSplit`），
  所以这条只是把"拖过分隔件"那一下接上。
- **目标文件**：`src/App.vue` 第 **421-426** 行 `createToolStripeDrag({ … })` 的参数表；
  另外在第 **275** 行那句 `createToolWindowStripes({…})` 的解构里补上两个新出口
  `isSplitOf, setSideTool`（它们已经在 `src/toolWindowStripes.ts` 的 return 里）。
- **要接什么**：

  ```ts
  const { /* …原有那些…, isSplitOf, setSideTool } = createToolWindowStripes({ … })

  const { draggingTool, dropTarget, onToolDragStart, onToolDragOver, onToolDrop, onToolDragEnd, isDropBefore } = createToolStripeDrag({
    toolAnchors: () => toolAnchors,
    toolOrder: () => toolOrder,
    setToolAnchor: (id, side) => setToolAnchor(id as ToolWindowId, side),
    saveToolOrder: () => saveToolOrder(),
    // 后半组（side tool）：落点比的是**渲染中那条侧条**的下标与分隔件所在槽位。
    // `stripeIds` 必须给 `stripeOrder`（已经滤掉"从侧栏移除"的按钮并分好组），不能给 `toolOrder`。
    stripeIds: side => stripeOrder.value(side as ToolWindowId),
    isSplit: id => isSplitOf(id as ToolWindowId),
    setSideTool: (id, split) => setSideTool(id as ToolWindowId, split),
  })
  ```

- **上游依据**：`platform/platform-impl/src/com/intellij/openapi/wm/impl/AbstractDroppableStripe.kt:250-256`
  （`finishDrop` → `manager.setSideToolAndAnchor(it.id, paneId, anchor, order, isSplit)`）与
  `:463-469`（`data.isSplit = drawRectangle.y > separator.y` —— 落点在分隔线之下就进后半组）；
  分组规则本体 `:57-72`；分隔件 `platform/platform-impl/src/com/intellij/openapi/wm/impl/StripeButtonSeparator.kt:15-39`；
  `isSplit` 的存档位 `platform/platform-impl/src/com/intellij/openapi/wm/impl/WindowInfoImpl.kt:91-92`
  （`@Attribute("side_tool")`，默认 false），初值 `platform/platform-impl/src/com/intellij/openapi/wm/impl/DesktopLayout.kt:46`。
- **接上之后用户可见**：把「项目」拖到分隔件之下 ⇒ 它变成 side tool、留在后半组里（跨项目还在，
  存进 `taocode.toolLayout:<root>` 那条 `<window_info>`）；把「书签」拖到分隔件之上 ⇒ 回到前面那组。
  没接之前只能排序、不能换组（比较器仍会把 EP `secondary` 的那三个排到末尾，所以现状不坏）。

## W-TW2-3 —— 齿轮/底部标签条把"当前是哪个工具窗口"传下去（`canCloseContents` 那道闸的最后一环）

- **模块侧已经做完**：`src/menus/toolWindowGear.ts:91-113` 已经有第 5 参 `toolWindowId`
  与 `requiresClosableContents` 那道闸（上一轮落的），门面的 `canCloseContents(id)` 也在
  `src/toolWindowManager.ts:233`。**只差两个调用点把 id 递进去**，而这两个调用点都在保留文件里
  （本仓的齿轮行表是在 `menuUi` 里算好再发给组件的，`ToolWindowHeader.vue` 只渲染 `extraRows`）。
- **目标文件 / 行号**：
  - `src/menuUi.ts` 第 **67** 行那张依赖表加两位、第 **119** 行的解构里取出、
    第 **333** 行与第 **336** 行把 id 传给行表；
  - `src/App.vue` 第 **1629** 行那个依赖对象里给这两个谓词。
- **可照抄的替换**：

  ```ts
  // src/menuUi.ts:67 那组可选依赖旁边加：
    /** 齿轮当前挂在哪个工具窗口上（`ToolWindowImpl.canCloseContents()` 的按 id 查询用）。 */
    currentToolWindowId?: () => string | undefined
    currentBottomContentId?: () => string | undefined
  // src/menuUi.ts:119 的解构里加：currentToolWindowId = () => undefined, currentBottomContentId = () => undefined,
  // src/menuUi.ts:333：
  const toolWindowGearRows = computed(() => toolWindowGearLayout(findMenuRow, undefined, false, gearHostRows(), currentToolWindowId()))
  // src/menuUi.ts:336：
  const bottomGearRows = computed(() => toolWindowGearLayout(findMenuRow, undefined, true, bottomGearHostRows(), currentBottomContentId()))

  // src/App.vue:1629 那个依赖对象里，紧挨 gearHostRows 那一句加：
  currentToolWindowId: () => leftView.value,
  currentBottomContentId: () => bottomTab.value,
  ```

- **上游依据**：`platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowImpl.kt:647`
  （`canCloseContents() = canCloseContent`，值来自 `ToolWindowSetInitializer.kt:369` 的 `canCloseContent = bean.canCloseContents`）；
  消费点 `platform/platform-impl/src/com/intellij/ui/content/impl/ContentManagerImpl.java:139-141`
  与 `:473`（`canCloseAllContents()` 的第一句就是 `if (!canCloseContents()) return false`）、
  `platform/platform-impl/src/com/intellij/ui/content/tabs/TabbedContentAction.java:87`/`:114`
  （`setEnabledAndVisible(...)` ⇒ 不适用时**整行不见**）。
- **答不出时不猜**：底部那几格固定内容（`references`/`hierarchy`/`output`/`run`/`problems`/`terminal`）
  在本仓没有 `<toolWindow>` 注册记录 ⇒ 门面答 `null` ⇒ 行表**保持现状**（既有那条"有几条可关内容"的判据继续生效）。
  本批核过参考树、确实指不到它们那几条注册属性（上一轮同样卡在这里，见
  `docs/batch-2026-10-06-toolwindow.md` §6-4），所以**没有**替它们写默认值。
  一旦接上：侧栏那个齿轮（`files`/`git`/`outline`/`bookmarks` 都没有 `canCloseContents`）
  与底部选中 `search`/`debug` 时，Close All 那一行会按注册表消失；选中 `todo`/`vcslog`（注册记录写了
  `canCloseContents="true"`，出处见 `src/toolWindowMeta.ts:96-103` 的注释）时继续可见。
- **顺带（同一条链的第二步）**：真正按窗口收内容的三个动作（`Ctrl+F4` / Close Other / Close All）
  住在 `src/toolWindowActions.ts:218-266`，它们现在读的是 `src/toolTabs.ts:48` 那个常量
  `CAN_CLOSE_CONTENTS = true`。等 W-TW2-3 的"当前窗口 id"能传到调用点之后，本桶名下可以再把那三个谓词
  改成 `(presence, windowClosable)` 两因子形状（照 `ContentManagerImpl.java:472-481`）。
  **本轮没改**：在没有 id 的现在，改了只会把既有能用的行为关掉（假闸），与"不猜"冲突。

## W-TW2-4（低优先 · 只是留痕）—— `popupLiveUpdate.ts` 还等一个真消费者

`src/popupLiveUpdate.ts`（`PopupUpdateProcessor.java` 那条"弹层开着时数据变了就地刷新"的通道）
在磁盘上已存在、有判据（`tests/popup-live-update.test.mjs`），但**生产侧零消费方**，
已经登记在 orphan 门禁的基线里（本轮实测：已登记孤儿 9 / 基线 9）。
本桶名下能改的弹层宿主（`ContentComboLabel.vue` / `AnchoredMenu.vue` / `SpeedSearchBar.vue`）
的数据都来自 props/computed，Vue 的响应式已经把"就地刷新"那一半替做了，硬接就是给一个不需要的抽象 ⇒
没有接。要接需要宿主给一个**非响应式**的数据源（例如 `src/App.vue` 里那份一次性快照的搜索结果）。
判词见 `docs/inventory/verdict-ui-tabs-popup.md` 族三（`PopupUpdateProcessor` 那一行仍写"真实缺口"，
**订正**：通道已在，缺的是宿主侧的非响应式数据源，见本报告 §5）。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W-TW2-1（`lastActiveToolWindowId` 惰性 getter）** —— 目标 `src/App.vue:290` 的 `createToolWindowStripes({...})`。复核 `:298` 注释已提到 `lastActiveToolWindowId`，但未确认是否已传实参。登记为待复核/待办。
- **W-TW2-2（侧条拖放落到分隔件之后）** —— `src/components/ToolStripe.vue`（本 lane 可改面），登记。

结论：零接线（W-TW2-1 待复核，W-TW2-2 登记）。

补充复核：**W-TW2-1 已接线** —— `src/App.vue:299-300` 的 `createToolWindowStripes({...})` 已带 `activeStack: { get value() { return activeToolWindows.value } }`（惰性 getter）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（W-TW2-1 待复核，W-TW2-2 登记）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
