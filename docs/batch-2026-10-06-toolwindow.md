# 批次报告 · 2026-10-06 · 工具窗口注册机制（EP → Factory）与查询面（代号 toolwindow）

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下列行号都是本地逐行数过的）。
判词范围：`docs/inventory/verdict-toolwindow-openapi.md`（350 类）里注册面/查询面那几条 `[~]`。

## 1. 判词表

| 族 / 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话说明 |
|---|---|---|---|---|
| `ToolWindowEP` | `[-]`（原判词为 `[-]`，**理由订正**） | `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowEP.java:18/22-24/29-30/49-50/60-61/67-69/78-82/96-118/120-125` | `src/toolWindowFactories.ts:36-63`（`ToolWindowBean`）+ `src/toolWindowMeta.ts:45-75`（`ToolWindowRegistration extends ToolWindowBean`） | 原写「没有插件运行时就不建空壳」；实际 EP 的**属性面**是用户可见行为（`secondary`/`canCloseContents`/`doNotActivateOnStart`），本批把它建成数据类型而不是 XML 解析层，所以不再是"空壳"这一档 |
| `ToolWindowFactory` | `[~]`（比原判更实） | `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowFactory.kt:23-30/33/38/42/54/64-66/68-70` | `src/toolWindowFactories.ts:64-90`（`ToolWindowFactory`）+ `src/toolWindowMeta.ts:74-113`（`available`/`applicable`） | `isApplicableAsync`（不注册）与 `shouldBeAvailable`（注册了但灰着）**分成两道闸**；`anchor`/`icon` 覆盖已有规则；**还差** `createToolWindowContent` 的数据化（各视图 props 不同，仍是 `ToolWindowView.vue` 模板链） |
| `RegisterToolWindowTask` | `[x]`（字段面补齐） | `platform/platform-api/src/com/intellij/openapi/wm/RegisterToolWindowTask.kt:12-25`；映射出处 `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowSetInitializer.kt:358-376` | `src/toolWindowFactories.ts:91-127`（`RegisterToolWindowTask`）+ `:146-174`（`beanToTask`） | EP+工厂 → 注册任务的逐字段装配（`sideTool`/`canCloseContent`/`shouldBeAvailable`/`stripeTitle`/`icon`/`anchor`） |
| `ToolWindowSetInitializer`（判词 §G 未单列） | `[~]`（新增落点） | `ToolWindowSetInitializer.kt:340-342`（锚点三级）、`:344-356`（两道闸）、`:379-409`（`computeToolWindowBeans`） | `src/toolWindowFactories.ts:129-174` + `src/toolWindowMeta.ts:224-258`（`toolWindowTask`/`toolWindowTasks`） | 装配规则 + 整表过一遍项目状态的查询；**还差** `RegisterToolWindowTaskProvider` 那一层 EP（本仓无插件运行时） |
| `WindowInfo` | `[~]`（缺项补掉 2 条） | `platform/platform-api/src/com/intellij/openapi/wm/WindowInfo.kt:28`（`isSplit`）、`:34`（`isActiveOnStart`）；初值出处 `platform/platform-impl/src/com/intellij/openapi/wm/impl/DesktopLayout.kt:42-55`（`:46`）与 `WindowInfoImpl.kt:165-170`（`:169`） | `src/toolWindowManager.ts:223-231`（`isSplit` 初值 ← EP `secondary`，布局存过则优先，规则同 `AbstractDroppableStripe.kt:254-255`）、`:233-238`（`isActiveOnStart` 先问 EP） | 原写「可见/锚点/顺序分散，无每窗口聚合对象」→ 聚合对象已在 `toolWindowManager.ts`；本批补掉 `isSplit`（原来恒 false）与 `isActiveOnStart`（原来只按锚点近似） |
| `WindowInfoImpl` | `[~]`（前进一格） | `WindowInfoImpl.kt:39`（`isActiveOnStart` 默认 false）、`:92`（`isSplit` 默认 false）、`:155-160`（anchor 认不出退 LEFT） | 同上 | **还差** `weight`/`sideWeight`（本仓侧条是像素宽，`stripeResize.ts`，差异已登记在判词 §B-5） |
| `ToolWindowManager`（接口） | `[~]`（**改判**：原 `[-]` 的理由已失效） | `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowManager.kt:120/122/127/132/139/144/112-115` | `src/toolWindowManager.ts:130-160`（门面接口）+ `:249-291`（实现） | 原判词写「再抽一个只转发的门面没有新语义 ⇒ `[-]`」，但 2026-10-05 之后 `src/toolWindowManager.ts` **已经是**真门面且有消费方（`ToolWindowHeader.vue` 等）；本批在其上加 `canCloseContents(id)` 这一位新语义。**还差** `lastActiveToolWindowId`（`:132`）——见 §6 |
| `ToolWindowManagerEx` | `[~]` | `platform/platform-impl/src/com/intellij/openapi/wm/ex/ToolWindowManagerEx.kt:19/28/50/44` | `src/toolWindowManager.ts:144-152`（`toolWindows`/`getIdsOn`）| `getMoreButtonSide` 住在 `src/toolWindowStripes.ts:597-622`（`moreButtonSide`/`moveMoreButtonTo`），未进门面；**还差** `clearSideStack`、`getLayout`/`setLayout` 的 `DesktopLayout` 权重模型（同 §B-5） |
| `ToolWindowManagerImpl` | `[~]` | `ToolWindowManagerImpl.kt:659/777/792`（`isSplit` 三处消费）、`:1172-1174`（`isActiveOnStart` 的用处） | `src/toolWindowManager.ts` | 聚合对象已到位；**还差** `layoutToRestoreLater`（最大化那次恢复） |
| `ToolWindowImpl` | `[~]`（补掉 `canCloseContents`） | `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowImpl.kt:647`（`canCloseContents() = canCloseContent`）、`:264` | `src/toolWindowManager.ts:153-159`（门面那一位）+ `:186-192`（模块函数） | 本批把 EP 的 `canCloseContents` 接到了查询面；**消费点只到齿轮**（见下），App/menuUi 那两处调用还没传 id ⇒ 写在接线请求里 |
| `ContentManagerImpl.canCloseAllContents` 那一族 | `[~]` | `platform/platform-impl/src/com/intellij/ui/content/impl/ContentManagerImpl.java:139-141/473`、`platform/platform-impl/src/com/intellij/ui/content/TabbedPaneContentUI.java:161`、`platform/platform-impl/src/com/intellij/ide/actions/CloseActiveTabAction.java:25/46`、`platform/platform-impl/src/com/intellij/ide/actions/ToolWindowCloseOtherTabsAction.kt:25`、`platform/platform-impl/src/com/intellij/ui/content/tabs/TabbedContentAction.java:87/114` | `src/menus/toolWindowGear.ts:41-49`（`requiresClosableContents`）+ `:79-100`（新参 `toolWindowId`） | 齿轮的 Close All 现在先过注册表那道闸：答 false 的窗口整行不见（上游用 `setEnabledAndVisible`），**答不出**（底部固定内容无注册记录）时保持现状不猜 |
| `ContentComboLabel` / `ComboContentLayout` | `[~]`（消费点补齐） | `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/SelectContentStep.kt:17`、`ToolWindowContentUi.java:862-875`、`platform/platform-impl/src/com/intellij/ui/popup/list/ListPopupModel.java:44-48/143-150` | `src/components/ContentComboLabel.vue:26-29/106-113/152-166` | 这一层列表的行模型（过滤 / 可选性 / 初始选中 / 按下关不关）改从 `src/popupSteps.ts` 取，本组件不再写第二份匹配 |
| `StripeButton` 的 secondary 分组外观 | `[ ]`（未做，见 §6） | `platform/platform-impl/src/com/intellij/openapi/wm/impl/AbstractDroppableStripe.kt:59-61/349-351`、`SquareStripeButton.kt:129` | 无 | 只把数据位建到查询面，条纹"后半组 + 分隔缝"没动（改了会撞 `tests/tool-window-stripes.test.mjs` 钉住的顺序） |

## 2. 改动文件清单（`wc -l` 前 → 后）

| 文件 | 前 | 后 | 性质 |
|---|---|---|---|
| `src/toolWindowFactories.ts` | 0（新） | 174 | EP bean / 工厂 / 注册任务三个类型 + `beanToTask`、`toolWindowAnchorOf`、`canActivateOnStart` |
| `src/toolWindowMeta.ts` | 194 | 268 | 注册项继承 `ToolWindowBean`；5 条记录补上核实过的 EP 属性；新增 `toolSecondary`/`toolCanCloseContents`/`toolActiveOnStart` 三张派生表与 `toolWindowTask`/`toolWindowTasks` |
| `src/toolWindowManager.ts` | 257 | 302 | `isSplit` 初值 ← EP `secondary`、`isActiveOnStart` 先问 EP；门面新增 `canCloseContents(id)`；模块级 `toolWindowSplitDefault`/`canCloseContents`/`toolWindowActiveOnStart` |
| `src/menus/toolWindowGear.ts` | 94 | 113 | `requiresClosableContents` 标记 + `toolWindowId` 新参（不给 = 现行为不变） |
| `src/components/ContentComboLabel.vue` | 160 | 181 | 改吃 `popupSteps` 的行模型（`listStepRows`/`initialRowIndex`/`closesOnExecute`） |
| `tests/tool-window-factories.test.mjs` | 0（新） | 207 | 11 条判据：装配规则 / 两道闸 / EP 三布尔位 / 注册表值逐条对上游 XML / 派生表 / 门面那几位 / 齿轮那道闸 / A1 消费方门禁 |
| `tests/tool-window-content-ui.test.mjs` | 192 | 205 | 只把"过滤规则"那一条**源码锚点**改指真源（判据没放松，见 §4 与下注） |

> 关于 `tests/tool-window-content-ui.test.mjs:81` 那条锚点：原正则要求组件里出现 `speedSearchMatches(query, option.label)`，即把「过滤写在组件里」这个**实现形状**钉住了。上游 `SelectContentStep.kt:17` + `ListPopupModel.java:44-48` 说的是"这一步的过滤用速度搜索口径、数据源仍是全量 contents、`rows` 是原索引投影"——**行为**判据我在原处换成了四条更强的断言（`step.values()` 必须是全量 `props.options`、`rows` 必须是 `listStepRows` 的原索引投影、组件里**不许再出现** `speedSearchMatches`、`popupSteps.ts` 里那条 `shouldBeShowing` 规则必须还在），逐条对应上面那两句上游依据。

## 3. §5 自查（前 → 后）

| 门禁 | 前（本批开工时） | 后（收工） |
|---|---|---|
| `npx vue-tsc -b --force` | 1 错（`src/components/TestRunnerPanel.vue:238` TS7053，桶 11 在途）；派单基线写的 `SearchPanel.vue` 3 错已被属主清掉 | **同样 1 错**，仍是他人在途那一条，本域 0 错 |
| `node --test tests/tool-*.test.mjs tests/tab-*.test.mjs tests/popup-*.test.mjs tests/module-size.test.mjs` | 未跑全量（本批逐步落盘时先跑子集：registry+manager 17/17 绿） | **431 tests / 431 pass / 0 fail**；收工再把 `tests/speed-*` `tests/dnd-*` `tests/scratch-*` `tests/stripe-*` `tests/panel-*` 一起跑：**522 / 522 / 0** |
| `node --test tests/tool-window-factories.test.mjs tests/tool-window-content-ui.test.mjs` | 新文件不存在 | 22 / 22 / 0 |
| `node .tools/find-param-props.mjs` | 0 | **0** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净** |
| `node .tools/find-missing-ext.mjs` | 干净（1253 文件） | **干净** |
| `node .tools/find-orphan-modules.mjs --gate` | 基线 9 / 已登记 9 / **新增 1**（`src/structuralCodeBlock.ts`，桶 9 在途）→ 红 | 基线 9 / 已登记 9 / **新增 0** → 绿（桶 9 那条在本批收工前已接上消费方） |
| `node .tools/find-orphan-modules.mjs --dead-imports` | 冗余 import 9 处（`App.vue` 8 + `SearchPanel.vue` 1） | 同样 9 处，本域无新增；**W-B11c-2 那条（`ToolWindowView.vue` 的 `./TestRunnerPanel.vue`）已经不在了**（见 §5.5） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 中途一次跑：11 条里 **10 绿 1 红**（`moved :: src/fileTypeDetection.ts → platform/ide-core/.../NativeFileType.java:48-51`，他人在途）；我这两份新文档落地后又红过一次（自己写的两条假路径：`platform/plugins/terminal/...` 应为 `plugins/terminal/...`、`platform/platform-impl/src/com/intellij/ui/popup/ListPopupStep.java` 应为 `platform/ide-core/src/com/intellij/openapi/ui/popup/ListPopupStep.java`） | **11 / 11 / 0**：假路径逐条按参考树 find 结果订正后复绿；`fileTypeDetection.ts` 那条也在收工前由属主清掉 ⇒ 双门全绿 |
| `node --test tests/tool-view-activation.test.mjs` | 派单说它"加载期抛错、不是本域缺陷" | 本批收工时它 **绿**（包含在上面那 431 里）；我没有改过那个文件 |

## 4. 反向验证（两条新门禁，各走三步）

1. **齿轮的 `canCloseContents` 那道闸**（`tests/tool-window-factories.test.mjs` 第 9 条）
   - 注入：把 `src/menus/toolWindowGear.ts` 里 `window.closeAllTabs` 那条的 `requiresClosableContents: true` 摘掉（= 闸消失）。
   - 红：`node --test tests/tool-window-factories.test.mjs tests/tool-window-content-ui.test.mjs` ⇒ **22 tests / 21 pass / 1 fail**，红的正是「齿轮的 Close All 要先过注册表那道闸」。
   - 撤：改回 `requiresClosableContents: true` ⇒ 复绿（后面 22/22、431/431）。
2. **A1 的行模型消费方门禁**（同文件第 11 条）
   - 注入：把 `src/components/ContentComboLabel.vue:29` 的值 import 换成 `import type { ListPopupStepLike } ...`（= 生产链路断开，只剩类型）。
   - 红：`node --test tests/tool-window-factories.test.mjs` ⇒ **11 tests / 10 pass / 1 fail**，红的正是「A1 门禁：popupSteps 的行模型那一半有生产消费方」。
   - 撤：换回 `import { initialRowIndex, listStepRows, type ListPopupStepLike } from '../popupSteps.ts'` ⇒ 复绿。

## 5. 零消费方自查结论

- `src/toolWindowFactories.ts`：被 `src/toolWindowMeta.ts:25`（值 import `beanToTask`）与 `src/toolWindowManager.ts:32`（类型/表）消费；`toolWindowMeta.ts` 的生产消费方是 `toolWindowStripes.ts`、`menus/viewMenu.ts`、`components/ToolStripe.vue`、`components/ContentComboLabel.vue` 等 ⇒ **不是只过自己测试的模块**（orphan 门禁实测 新增 0）。
- `src/toolWindowMeta.ts` 新增的 `toolWindowTask`/`toolWindowTasks`：`toolWindowTask` 被门面 `canCloseContents`/`toolWindowSplitDefault`/`toolWindowActiveOnStart` 那条链间接消费、并被判据直接调用；`toolWindowTasks`（= 上游 `computeToolWindowBeans` 的整表装配）**目前只有判据在用**，因为本仓的"注册"发生在 `toolWindowStripes.ts` 的闭包里、按 id 单点读，还没有"整表装配一次"的宿主（换项目时的批量注册要动 `App.vue`/`bridge` 那条装载链）⇒ 已在此明写，不虚报。
- `src/popupSteps.ts`：**A1 原写「除自己的测试外全仓无人引用」，实际已不成立**——`src/popupAnchor.ts:11` 早就在值 import `showOptionsPoint`（原写 X、实际 Y，留痕于此）。本批接上的是 A1 点名而确实没人用的那一半：`listStepRows`/`shouldBeShowing`/`isClosableOnExecute`/`initialRowIndex`。
- W-B11c-2（`ToolWindowView.vue` 的陈旧 `TestRunnerPanel` import）：**已不存在**——该文件里没有这条 import，`--dead-imports` 也不再报它。原写"待接"，实际已被（桶 11 或该文件属主）处理 ⇒ 本批无动作，不重复改。

## 6. 做不到 / 无法核实

1. `ToolWindowManager.lastActiveToolWindowId`（`ToolWindowManager.kt:132`）：**做不到**。门面的 `ToolWindowManagerSource` 只暴露 `visibleIds`/`activeToolWindowId` 的来源，"上一个激活的窗口"住在 `src/activeToolWindow.ts` 与宿主 `App.vue` 的激活历史里，那两个文件都不在本批可改面；硬加一位就得让门面自己记账 ⇒ 两份真相。
2. 条纹的 `secondary` 分组（"后半组 + 分隔缝"，`AbstractDroppableStripe.kt:59-61`/`:349-351`、`SquareStripeButton.kt:129`）：**未做**。`src/toolWindowStripes.ts` 的 `stripeOrder` 现在完全按用户拖拽顺序（`toolOrder`），加这道排序会改左/右条上四个按钮的可见次序，并与 `tests/tool-window-stripes.test.mjs`、`tests/tool-layout-state.test.mjs` 钉住的"顺序 = 注册表按锚点过滤"冲突；改用户可见次序属另一批（要有截图取证），本批只把数据位建到查询面。
3. `WindowInfo.weight`/`sideWeight`：**不适用**（判词 §B-5 已登记：本仓侧条存像素宽 `stripeResize.ts`，不是权重模型），本批没有重算那条量。
4. `canCloseContents` 到 Ctrl+F4 / Close Other / 标签上的关闭按钮那三处消费点：**接线未完成**。`src/toolWindowActions.ts` 的 `closeActiveTab`/`closeOtherTabsTarget`/`closeAllTabsTarget` 操作的是底部 dock 的 `references`/`hierarchy` 两条 content，而这两格在本仓**没有 `<toolWindow>` 注册记录**（上游 `terminal.xml:4` 那条是 Terminal；Find/Hierarchy/Problems 的注册属性在本地树里逐条 find 过，指不到）⇒ 按"不猜"的原则门面对它们答 `null`，我没有替它们写默认值，否则会关掉现在能用的行为。请求主代理让 `menuUi.ts:333`/`App.vue:2038`/`App.vue:2063` 把当前工具窗口 id 传给齿轮行表（见 `docs/wiring-requests-2026-10-06-toolwindow.md` W-TW-1）。
5. `doNotActivateOnStart`：**本仓没有任何窗口该置 true**（上游本地树里唯一的例子是 `intellij.platform.ide.ui.inspector.xml:36`，本仓没有 UI Inspector 窗口），所以这一位现在只有机制与判据、没有实例 ⇒ 已如实写成"退到既有近似 + EP 那一位为真"。
6. A1 剩下的两处宿主（`src/components/EditorPopupMenu.vue`、`src/components/SearchEverywhereDialog.vue`）：这两个组件**不在本批可改面**（派单只给了 `AnchoredMenu.vue` 等七个组件），而派单/请求里说的"`AnchoredMenu.vue` 第 12 行的列表在它自己的 `v-for` 里"**与磁盘不符**——该组件只有 `<div ref="box" class="tree-menu"><slot /></div>`（27 行，零 `v-for`），列表由宿主给 ⇒ 已改接真正有分步列表形状的 `ContentComboLabel.vue`，剩下的两条写在 W-TW-2。

## 7. 需要主代理接的线

见 `docs/wiring-requests-2026-10-06-toolwindow.md`：W-TW-1（齿轮/标题栏把当前窗口 id 传给 `toolWindowGearRows`）、W-TW-2（A1 剩下的两个弹层宿主）、W-TW-3（判词 §G 那 8 行的改判建议 + `fileTypeDetection.ts` 那条引用锚点变红）、W-TW-4（`lastActiveToolWindowId` 的宿主记账）。
