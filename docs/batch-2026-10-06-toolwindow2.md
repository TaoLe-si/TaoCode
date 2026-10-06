# 批次报告 · 2026-10-06 · 工具窗口第二轮（代号 toolwindow2 · 后半组 / 激活栈 / 判词留痕）

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下列每一条行号都是本批
逐行数过的，不是转述）。派单：收 `docs/batch-2026-10-06-toolwindow.md` §6「做不到」里能做的、
`docs/inventory/verdict-toolwindow-openapi.md` 剩余 `[~]`、`docs/inventory/verdict-ui-tabs-popup.md` 的 GAP 行；
`docs/wiring-requests-2026-10-06-bucket8c.md` 的 B1/B2 主代理已接 ⇒ 本批一条没重做（核对见 §6 第 5 条）。

## 1. 判词表

| 族 / 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话说明 |
|---|---|---|---|---|
| §6-1 `ToolWindowManager.lastActiveToolWindowId` | `[~]`（模块侧做完 + 宿主一行交请求） | `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowManager.kt:132`；实现 `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowManagerImpl.kt:746-753`（自栈顶往下 + `filter { it.isAvailable }`）；隐藏不出栈同文件 `:712-718`、只有注销才真删 `:1217`；两份栈之分 `platform/platform-impl/src/com/intellij/openapi/wm/impl/ActiveStack.java:15-26`；消费者 `platform/platform-impl/src/com/intellij/ide/actions/JumpToLastWindowAction.java:25` 与 `:42-43` | `src/toolWindowManager.ts:130`（`ToolWindowManagerSource.activationStack`）、`:152`（接口那一位）、`:299-307`（实现，复用 `src/activeToolWindow.ts:43-49` 那条纯函数）；`src/toolWindowStripes.ts:94`（依赖 `activeStack`）、`:794`（转发装配点）；判据 `tests/tool-window-manager.test.mjs` 三条 + 一条生产方门禁 | 原写「硬加一位就得让门面自己记账 ⇒ 两份真相」——**这条理由成立**，所以本批仍不让门面记账：只加一个**只读**通道，宿主给了才答，没给答 `null`；宿主那一行见 `docs/wiring-requests-2026-10-06-toolwindow2.md` W-TW2-1 |
| §6-2 条纹的 `secondary` 分组（「后半组 + 分隔缝」） | `[x]`（比较器 + 存档 + 分隔件 + 落点写回） | `platform/platform-impl/src/com/intellij/openapi/wm/impl/AbstractDroppableStripe.kt:57-72`（比较器第一判据 = `isSplit`，「side buttons in the end」`:59-62`；同组才比 `order` `:68-70`；`order=-1` 当 `Int.MAX_VALUE` `:74-77`）、`:592-597`（分隔件插在第一个 split 之前）、`:602-609`（插在第 0 位就不画）、`:250-256` + `:463-469`（落点算成 `isSplit` 交给 `setSideToolAndAnchor`）；`platform/platform-impl/src/com/intellij/openapi/wm/impl/StripeButtonSeparator.kt:15-39`（盒 32×11、居中 24×1 线、颜色 `ToolWindow.Stripe.separatorColor` `:36`，键定义 `platform/util/ui/src/com/intellij/util/ui/JBUI.java:1151-1155`）；`WindowInfo.isSplit` 存档位 `platform/platform-impl/src/com/intellij/openapi/wm/impl/WindowInfoImpl.kt:91-92`（`@Attribute("side_tool")`，默认 false）、初值 `platform/platform-impl/src/com/intellij/openapi/wm/impl/DesktopLayout.kt:46`、来源 `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowSetInitializer.kt:368`（`sideTool = bean.secondary \|\| bean.side`） | 新模块 `src/toolStripeSplit.ts`（76 行：比较器 / 分隔件位置 / 落点判定 / 尺寸常量）；`src/toolWindowStripes.ts:563-590`（`windowSplit` + `isSplitOf`/`setSideTool`/`splitPatch` + `stripeOrder` 过比较器）、`:348-350`（读档）、`:555` 附近注释（写档在 `splitPatch`）；`src/toolLayoutProfiles.ts:75`（`WindowInfo.split`）+ 同文件 `:38-45` 的文件头；`src/toolStripeDrag.ts:19-23` + `:46-59` + `:81`（落点写回，可选 ctx）；`src/components/ToolStripe.vue:91-92`、`:189`（画那条线，读门面的 `windowInfo(id).isSplit`）；判据 `tests/tool-stripe-split.test.mjs` 14 条 | 原写「会撞 `tests/tool-window-stripes.test.mjs` 钉住的顺序」——**实际只钉了一条**（`['notifications','files']`），且那个值与上游比较器矛盾，已按规矩改判并留痕（见 §3 那条说明 + §6-6） |
| §6-3 `WindowInfo.weight` / `sideWeight` | `[-]`（不适用，维持原判） | `platform/platform-api/src/com/intellij/openapi/wm/WindowInfo.kt:14-15`；默认值 `WindowInfoImpl.kt:89`（`sideWeight` = 0.5） | 无（本仓侧条是像素宽 `src/stripeResize.ts`，判词 §B-5 已登记） | 本批**没有**重算那条量；但同处 `WindowInfoImpl.kt:91-92` 那一格（`isSplit`）本批已落 ⇒ `verdict-toolwindow-openapi.md:349` 那条「还差」从三条减到两条（见 §6-7 留痕） |
| §6-4 `canCloseContents` 到 Ctrl+F4 / Close Other / 标签关闭按钮那三处消费点 | `[~]`（原样卡住，重新核过理由） | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowImpl.kt:647`；`ContentManagerImpl.java:139-141` 与 `:472-481`（`canCloseAllContents()` 第一句 `if (!canCloseContents()) return false`，`:473`）；`platform/platform-impl/src/com/intellij/ui/content/tabs/TabbedContentAction.java:87`/`:114`（`setEnabledAndVisible(canCloseContents() && …)` ⇒ 整行不见）；`RegisterToolWindowTask` 那一位 `ToolWindowSetInitializer.kt:369` | `src/menus/toolWindowGear.ts:91-113`（上一轮落的第 5 参 + 那道闸）、`src/toolWindowManager.ts:233`（`canCloseContents(id)`）、`src/toolWindowActions.ts:218-266` + `src/toolTabs.ts:48`（`CAN_CLOSE_CONTENTS = true` 那三个谓词仍走既有判据） | 两个调用点（`src/menuUi.ts:333`/`:336` 与 `src/App.vue:1629`）都在保留文件里 ⇒ 整段可照抄的替换写在 W-TW2-3。**没做**的部分也写清了：底部那几格固定内容在本仓没有 `<toolWindow>` 注册记录（本批又逐条 find 过参考树，仍指不到 `references`/`hierarchy` 那几条注册属性），门面答 `null`、不替它们编默认值 |
| §6-5 `doNotActivateOnStart` | `[-]`（无实例，维持原判） | `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowEP.java`（属性面）→ `WindowInfoImpl.kt:165-170` 的 `canActivateOnStart` | `src/toolWindowManager.ts:238`（`toolWindowActiveOnStart`） | 本仓没有任何窗口该置 true（上一轮核过：本地树里唯一例子是 UI Inspector，本仓没有那一格），本批无动作 |
| §6-6 A1 剩下的两个弹层宿主（`EditorPopupMenu.vue` / `SearchEverywhereDialog.vue`） | `[-]`（不在本批文件面） | — | — | 派单给的组件面只有 `ToolStripe`/`ToolWindow*`/`TabContextMenu`/`TabEntryPoint`/`ContentComboLabel`/`SpeedSearchBar`/`AnchoredMenu` 七个；这两条仍挂在 `docs/wiring-requests-2026-10-06-toolwindow.md` W-TW-2，本批不重复登记 |
| `PopupDispatcher` / `StackingPopupDispatcherImpl` 的「全局弹层栈」（`verdict-ui-tabs-popup.md:71-72` 的缺项） | `[~]` → 已落，**判词已过期** | `platform/platform-impl/src/com/intellij/ui/popup/PopupDispatcher.java:36-37`（`addAWTEventListener` + `addKeyEventDispatcher` 挂在 AWT 事件队列上）；`platform/platform-impl/src/com/intellij/ui/popup/StackingPopupDispatcherImpl.java:116-164`（自顶向下、落点在某层内就停）与 `:181-193`（同一条键盘链：`dispatchKeyEvent` 找到栈顶那层再委托） | `src/popupStack.ts`（`usePopupLayer` + 栈 + `consume()`）、`src/components/TabContextMenu.vue:17`+`:32-36`、`src/components/AnchoredMenu.vue:23`（`defineExpose({ box })`）、宿主侧 `src/App.vue:1223`（B2）与 `:1224-1226`（B1） | 原写 X（「缺 `Stack` 全局栈」）、实际 Y：栈与逐层收都在，且桶 8c 的 B1/B2/B3 三个挂点都已落 ⇒ 本批**没有**重做（任务 ③ 的要求）。路径本批自己 find 过（真实目录是 `platform/platform-impl/src/com/intellij/ui/popup/`；`docs/wiring-requests-2026-10-06-bucket8c.md` 与判词那两行只写了文件名/接口名，未写实现包路径 ⇒ 无冲突，只有同文件 `:8` 引的 `StackingPopupDispatcher` 接口写了包路径且核对为真） |
| `PopupUpdateProcessor`（同文档 `:212`「本族唯一有用户可感差异的缺口」） | `[~]`，**理由订正** | `platform/lang-impl/src/com/intellij/ui/popup/PopupUpdateProcessor.java`（本批未重数行号，逐条依据已在模块头引过） | `src/popupLiveUpdate.ts:51-97`（通道：`open()` 才挂监听、不可见即退订、`item == null` 不刷新）+ `tests/popup-live-update.test.mjs` | 原写「本仓的弹层都是一次性快照」——**已不成立**：通道早落盘。真正还缺的是**一个非响应式的宿主数据源**（Vue 的 computed 把本仓那几个弹层的"就地刷新"替做了），登记为 W-TW2-4；不硬接成一个只过自己测试的抽象 |
| `TabInfo.kt` 的 `alert` / `blink`（`verdict-ui-tabs-popup.md:30` 的缺项之一） | `[x]`，**判词过期** | `platform/platform-api/src/com/intellij/ui/tabs/TabInfo.kt:30,301,306`（30 = `class TabInfo(var component: JComponent) : Queryable, PlaceProvider`、301 = `fun fireAlert()`、306 = `fun stopAlerting()`；**citefix 订正**：原写 `platform/platform-impl/...` 参考树里没有该路径，`TabInfo.kt` 全树唯一真身就在 `platform/platform-api/src/com/intellij/ui/tabs/`，424 行）与 `TabLabel.kt:640-690` 的两段预算 | `src/tabAlerts.ts`（状态机 + `MAX_INITIAL_BLINK_COUNT`/`MAX_RE_FIRE_BLINK_COUNT`/`BLINK_*`）+ 宿主消费点 `src/App.vue:262-271`（进程结束/调试器停下才提醒、选中即停）+ 渲染 `src/App.vue:2146`/`:2148`（`tab-alert` + `blinking`）+ 判据 `tests/tab-alerts.test.mjs` | 原写「缺 `alert`/`blink`（背景任务在标签上的进度指示）」、实际已落 ⇒ 本批只留痕，不重复实现。`TabInfo` 剩下的 `enabled` / `tooltip` 覆盖 / `actionGroup` 三条本批核过：`actionGroup` 由 `src/tabEntryPoint.ts` + `src/tabEntryPointMenu.ts`（= 上游 `ActionPanel`/`EditorTabsEntryPoint`）承担，`enabled`/`tooltip` 覆盖未落 |

## 2. 改动文件清单（`wc -l` 前 → 后）

| 文件 | 前 | 后 | 性质 |
|---|---|---|---|
| `src/toolStripeSplit.ts` | 0（新） | 76 | 后半组纯规则：比较器 `splitStripeButtonsLast`、`stripeSeparatorIndex`（含上游两种"不画"）、`splitForDrop`（含"缝不存在就不猜"）、`StripeButtonSeparator` 的三个尺寸常量 |
| `src/toolWindowStripes.ts` | 772 | 835 | `windowSplit` 表 + `isSplitOf`/`setSideTool`/`splitPatch`（存档只写"与初值不同"）；`stripeOrder` 过比较器（底部那一支如实不套）；读档 `:348-350`；新依赖 `activeStack` 与门面的 `isSplit`/`activationStack` 转发；return 多出口 `isSplitOf`/`setSideTool` |
| `src/toolWindowManager.ts` | 302 | 335 | `ToolWindowManagerSource.activationStack`（只读通道）+ 门面 `lastActiveToolWindowId()`（复用 `lastActiveId`）+ 文件头/字段注释坐标 |
| `src/toolLayoutProfiles.ts` | 281 | 293 | `WindowInfo.split?` 一位 + 文件头「没兑现的」从 `weight/sideWeight/isSplit` 改成 `weight/sideWeight`（附 `side_tool` 坐标） |
| `src/toolStripeDrag.ts` | 64 | 95 | ctx 三个**可选**成员（`stripeIds`/`isSplit`/`setSideTool`）+ `applyDropGroup()`：落点在分隔件槽位或其之后 ⇒ 进后半组，之前 ⇒ 回前一组；没给 ⇒ 行为与旧文件逐字一致 |
| `src/components/ToolStripe.vue` | 218 | 239 | 画那条分隔件（读门面 `windowInfo(id).isSplit`，尺寸与颜色走上游那两个数 + `var(--line)` 令牌，`aria-hidden`）；`v-for` 改成带下标的形式以便插位 |
| `tests/tool-stripe-split.test.mjs` | 0（新） | 221 | 14 条判据：比较器三种输入、分隔件三种"不画"、落点四档、尺寸对上上游、EP 初值逐条（`outline`/`bookmarks`/`notifications` = true，`files`/`gradle` = false）、覆盖 + 换项目还在、只写"与初值不同"、旧存档缺 `split` 不判损坏、底部不套、门面 `isSplit` 跟覆盖走、拖放写回三档（含"宿主没给这一对时照旧只排序"）、消费链路门禁 |
| `tests/tool-window-manager.test.mjs` | 200 | 250 | 追加 3 条 `lastActiveToolWindowId` 判据 + 1 条生产方门禁；**改一处既有源码锚点**（`:177` 那句 import 全文比对，跟着真实 import 行走，判据意图"门面必须有生产方且扩展名写全"不动） |
| `tests/tool-window-stripes.test.mjs` | 161 | 169 | 改判 1 条断言的**期望值**（`['notifications','files']` → `['files','notifications']`），理由与"判据没丢"的论证写在该条注释里；其余一字未动 |
| `docs/batch-2026-10-06-toolwindow2.md` | 0（新） | 143 | 交付报告（本文件） |
| `docs/wiring-requests-2026-10-06-toolwindow2.md` | 0（新） | 142 | W-TW2-1..4（宿主一行 / 拖放三参 / 齿轮两个 id / `popupLiveUpdate` 等非响应式数据源） |

## 3. §5 自查（前 → 后）

| 门禁 | 前（本批开工时实测） | 后（收工） |
|---|---|---|
| `npx vue-tsc -b --force` | **0 错** | **0 错**（收工复跑一次仍是 0）。中途出现过三条他人 in-flight 的错并已由各自属主清掉：`src/statusBarText.ts`（`timeText` 未定义）、`src/lspServerStatus.ts`（`entries` possibly undefined）、`src/consoleAnsi.ts`（`TS1002`/`TS1131`/`TS1005`）⇒ 都不是本批文件、也不是本批改动引起 |
| `node --test tests/tool-* tab-* popup-* dnd-* scratch-* speed-* stripe-* panel-*` | **517 tests / 517 pass / 0 fail** | **534 / 534 / 0**（+17 = `tests/tool-stripe-split.test.mjs` 14 条 + `tests/tool-window-manager.test.mjs` 3 条） |
| `node --test tests/tool-*.test.mjs tests/stripe-*.test.mjs tests/remove-stripe-button.test.mjs tests/workbench-dock-render.test.mjs tests/view-toggle-actions.test.mjs` | 未单列 | **249 / 249 / 0**（含被改判的那条断言复绿） |
| `node --test tests/module-size.test.mjs` | 5 / 5 / 0 | **5 / 5 / 0**（上限未动：`src/toolWindowStripes.ts` 835 < 900、`src/toolWindowManager.ts` 335、新模块 76） |
| `node .tools/find-param-props.mjs` | 0 | **0** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净** |
| `node .tools/find-missing-ext.mjs` | 干净（1253 文件） | **干净**（1286 文件，含本批两份新 .ts） |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记孤儿 9 / 基线 9 / 新增 0 → 绿 | 已登记孤儿 9 / 基线 9 / **新增 0** → 绿（中途一度被 `src/consoleAnsi.ts` 顶成新增 1，属主随后修好该文件时一并接上）；**本域新增 0**：`src/toolStripeSplit.ts` 有三个生产消费方 `src/toolWindowStripes.ts:27`、`src/toolStripeDrag.ts:7`、`src/components/ToolStripe.vue:24` |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | **11 / 11 / 0** | 11 条里 **9 绿 2 红**：两条红的都指**他人文档**（`batch-2026-10-06-problems2.md`/`status2.md`/`welcome2.md`/`projecttree.md`/`wiring-requests-2026-10-06-lsp.md`/`vcs2.md` 里那几条参考树不存在的真路径，如 `platform/analysis-api/src/com/intellij/codeInsight/SuppressIntentionAction.java`、`platform/structure-view-impl/…/StructureViewFactoryImpl.java`、`platform/lang-api/…/psi/util/PsiUtil.java`）⇒ 各自属主订正。**本批两份新文档 0 红**：中途自己写错过两条（把 `PopupDispatcher.java`/`StackingPopupDispatcherImpl.java` 写成 `platform-api` 那个包、把 `TabbedContentAction.java` 漏了 `tabs/` 一级），逐条 find 后订正 ⇒ 复绿 |
| ctest | 未涉及（本批没动 `native/`） | 同左 |

## 4. 反向验证（四条新门禁，各走三步）

1. **`stripeOrder` 必须过比较器**（`tests/tool-stripe-split.test.mjs` 的「消费链路门禁」+ 分组行为那几条）
   - 注入：`src/toolWindowStripes.ts` 的 `return side === 'bottom' ? ids : splitStripeButtonsLast(ids, isSplitOf)` → `return ids`。
   - 红：`node --test tests/tool-stripe-split.test.mjs tests/tool-window-stripes.test.mjs` ⇒ **22 tests / 17 pass / 5 fail**
     （红的是：消费链路门禁、改判过的那条 `stripeOrder` 值、「拖出来的那一位覆盖初值」、「旧存档缺 split」、 「宿主没给这一对」）。
   - 撤：还原该句 ⇒ **22 / 22 / 0**。
2. **拖放落点写回**（同文件「把按钮落到分隔件之后 = 变成 side tool」）
   - 注入：删掉 `src/toolStripeDrag.ts:81` 那句 `applyDropGroup(side, id, before)`。
   - 红：**14 / 13 / 1**，红的正是那一条。
   - 撤：还原 ⇒ 14 / 14 / 0。
3. **分隔件真的画在模板里**（同文件消费链路门禁）
   - 注入：`src/components/ToolStripe.vue` 的 `v-if="separatorAt === index"` → `v-if="false"`。
   - 红：`node --test tests/tool-stripe-split.test.mjs tests/stripe-resize-more.test.mjs` ⇒ **34 / 33 / 1**。
   - 撤：还原 ⇒ 34 / 34 / 0。
4. **门面的 `lastActiveToolWindowId` 不许恒 null**（`tests/tool-window-manager.test.mjs` 前两条）
   - 注入：把实现体首行改成 `return null; /* injected */`。
   - 红：**14 / 12 / 2**（「栈顶往下第一个还可用」「激活栈与可见集是两条不同的查询」）。
   - 撤：还原 ⇒ 14 / 14 / 0。

## 5. 零消费方自查结论

- `src/toolStripeSplit.ts`：`src/toolWindowStripes.ts:27`（值 import `splitStripeButtonsLast`）、
  `src/toolStripeDrag.ts:7`（值 import `splitForDrop`/`stripeSeparatorIndex`）、
  `src/components/ToolStripe.vue:24`（值 import `stripeSeparatorIndex` + 三个尺寸常量）⇒ **三份都在生产链路里**，
  不是只过自己测试的模块（orphan 门禁的本域新增为 0）。
- `src/toolWindowStripes.ts` 新增出口 `isSplitOf` / `setSideTool`：
  `isSplitOf` 有两个生产消费方（`stripeOrder` 的比较器入参、门面的 `isSplit`）；
  `setSideTool` **目前只有判据在用**，因为它的宿主调用点在 `src/App.vue:421-426` 那张 ctx 表里
  （`createToolStripeDrag` 的三个新可选参数要宿主给）⇒ 已如实写在 W-TW2-2，没有把它当"已接"报。
- `ToolWindowManagerSource.activationStack`：装配点已写（`src/toolWindowStripes.ts:794`），
  但**宿主还没给 `activeStack` 那一位** ⇒ 门面现在恒答 `null`（这是设计意图：不猜），
  接上后 `lastActiveToolWindowId()` 才有值。同理登记在 W-TW2-1。
- `src/popupLiveUpdate.ts`（上一轮的孤儿，本轮复核）：仍只有 `tests/popup-live-update.test.mjs` 一个引用，
  已在 orphan 基线里登记 9 条之内；本批**没有**给它硬造消费者（理由见 §1 该行 + W-TW2-4）。

## 6. 做不到 / 无法核实（含"原判词写错了"的留痕）

1. **`lastActiveToolWindowId` 的最后一行只能宿主接**：栈的唯一写入点是 `src/App.vue` 的
   `recordActiveToolWindow`（`src/appToolWindowActivation.ts:57-66` 只是注入回调的执行者），
   `src/App.vue` 是保留文件 ⇒ 交 W-TW2-1（一行惰性 getter；`activeToolWindows` 在 `src/App.vue:347` 声明，
   比 `createToolWindowStripes({...})` 那一处（`:275`）晚 ⇒ **必须**用 `{ get value() {...} }`，
   与同一张依赖表里的 `workspace`/`lspReady` 同写法）。
2. **`weight`/`sideWeight` 仍然不适用**：本仓侧条是像素宽（`src/stripeResize.ts`），
   判词 §B-5 已登记，本批没有造一个量不出来的权重。
3. **`canCloseContents` 那三处消费点仍接不上**，两个独立原因：
   ①调用点在保留文件（`src/menuUi.ts:333`/`:336`、`src/App.vue:1629`）⇒ W-TW2-3；
   ②底部那几格固定内容（`references`/`hierarchy`/`output`/`run`/`problems`/`terminal`）在本仓**没有** `<toolWindow>` 注册记录，
   本批又在参考树里按 `id`、按 `factoryClass`、按语义各 find 了一遍，仍然**指不到**它们对应那条注册的
   `canCloseContents` 属性值 ⇒ 按"不猜"原则门面对它们答 `null`，
   所以 `src/toolTabs.ts:48` 那个 `CAN_CLOSE_CONTENTS = true`（本仓唯一那条合并标签条的构建期常量）**没**改成窗口位。
   改判据前先有 id，否则就是把现在能用的行为关掉（假闸）。
4. **拖到"缝本体"那一档的像素判据接不住**：上游 `AbstractDroppableStripe.kt:613-617` 在拖拽中会把分隔件
   **临时挂出来当落点**（即使这一侧还没有任何 side tool），靠 `tryDroppingOnGap` / `drawRectangle.y > separator.y`
   这种像素比较成立。本仓的落点是离散行标记（`ToolStripe.vue` 的 `stripe-drop-marker`，
   由 `src/toolStripeDrag.ts` 记「插在哪个按钮之前」），给不出"压在缝上"这一档
   ⇒ `splitForDrop(null, …)` 返回 `null` = 不改这一位，并已在 `src/toolStripeSplit.ts:57-60` 写明。
5. **桶 8c 的 B1/B2/B3 一条没重做**（任务 ③）：核对结果（逐条 grep 过磁盘）：B1 = `src/App.vue:1224-1226`（`treeMenuBox` + `usePopupLayer(..., () => { treeMenu.value = null; … })`）、
   B2 = `src/App.vue:1223`（`usePopupLayer(moreMenuBox, hiddenTabsOpen, …)`，模板侧 `:2148` 已带 `ref="moreMenuBox"`）、
   B3 = `src/components/TabContextMenu.vue:17`+`:32-36` 与 `src/components/AnchoredMenu.vue:23`（`defineExpose({ box })`）。
   ⇒ 三条都已在栈上，本批一条没重做、也没往外壳里塞注册（只在 `ToolStripe.vue` 加了分隔件，与弹层那几行无关）。
6. **留痕（原判词/上一轮的断言与磁盘不符）**：
   - `docs/batch-2026-10-06-toolwindow.md` §6-2 说改这道排序会撞 `tests/tool-window-stripes.test.mjs` 与
     `tests/tool-layout-state.test.mjs` 钉住的顺序 —— **实际**：全跑一遍只红 1 条
     （`tests/tool-window-stripes.test.mjs:84`，`tool-layout-state` 那条没红）。该期望值
     `['notifications','files']` 与上游比较器的**第一判据**（`AbstractDroppableStripe.kt:59-62` side buttons in the end）
     直接矛盾 ⇒ 按规矩改判（`['files','notifications']`），原判据"同组内 order 0 在 1 之前"由紧邻那条
     底部断言（`todo` 0 / `gradle` 1，两边都不是 side tool）继续钉住，**断言体一字未放松**。
   - `verdict-ui-tabs-popup.md:30`（`TabInfo.kt`「缺 `alert`/`blink`」）、`:71-72`（「缺全局弹层栈」）、
     `:211`（`PopupUpdateProcessor`「本仓的弹层都是一次性快照」）三行**均已过期**，实际落点见 §1 那三行。
   - `verdict-toolwindow-openapi.md:349`（`WindowInfoImpl` 的「还差 `weight`/`sideWeight`/`isSplit`」）
     ⇒ `isSplit` 本批已落，剩两条；同一条差异在 `src/toolLayoutProfiles.ts` 文件头也已改成两条。
   - `tests/tool-window-manager.test.mjs:177` 那条**源码锚点**（逐字比对 stripes 的 import 语句）
     因为我给同一句加了 `toolWindowSplitDefault` 而变红 ⇒ 按真实文件更新该字符串，判据意图不变
     （仍是"门面必须有生产方且值 import 写全 `.ts` 扩展名"）。
7. **无法核实**：`ToolWindowStripeExtension.exists` 到底是不是 true —— 上游左/右竖直条纹的"分组外观"有两条分支：
   没有扩展时插 `StripeButtonSeparator` 那条**线**（`:103-104`），
   有 `plugins/extended-toolwindows-ui`（`plugins/extended-toolwindows-ui/resources/META-INF/plugin.xml`，
   `require-restart="true"`）时改用 Classic 那道**空缝**（`:110-111`）。
   本地树里能核到该插件存在、也能核到两种分支都把 split 组排在末尾，但**核不到它在发货装机里默认是否启用**
   （不在本地任何 `product.json`/打包清单里能指到的行）⇒ 本批按"插一条线"那支做（`useStripeButtonSeparator`，
   新 UI 的左/右竖直条纹），差异与两处坐标一并写在 `src/toolStripeSplit.ts` 文件头；
   排序与"排在末尾"这一条在两支里是共同的，所以判据不依赖这一位。

## 7. 需要主代理接的线

见 `docs/wiring-requests-2026-10-06-toolwindow2.md`：
W-TW2-1（宿主一行：把 `activeToolWindows` 交给门面）、
W-TW2-2（拖放三参：接上"拖过分隔件 = 变 side tool"）、
W-TW2-3（齿轮两处 id：把 `canCloseContents` 那道闸接到 Close All / 标签形态）、
W-TW2-4（`popupLiveUpdate` 等非响应式数据源，低优先）。
