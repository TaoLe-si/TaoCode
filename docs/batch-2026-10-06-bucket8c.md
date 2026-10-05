# 2026-10-06 · 桶 8c · 工具窗口域最后两个孤儿 + 弹层栈背后那一条行为

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`
（下列「上游」路径都相对它；本仓路径相对仓库根）。

## 0. 起手时的事实核正（重要）

派单书写的是「`node .tools/find-orphan-modules.mjs --gate` 正报着这两个」。实际起手第一跑：
`popupStack.ts` 与 `toolWindowManager.ts` **都不在孤儿名单里** —— 上一任（桶 8b）已经把两者的
第一处消费方接上了（`popupStack.ts:26-34` 的文件头就是它写的），但它撞到调用上限，
**报告与接线请求都没落盘**：它引用的 `docs/wiring-requests-2026-10-06-bucket8b.md` 不存在，
`docs/batch-2026-10-06-bucket8*.md` 一份也没有。所以本批的活不是"从零接线"，而是：
①自证它留下的接线是真的（不是注释里自称）；②补完它没做完的那一条行为；
③把它没写的报告与请求补上。判据文件 `tests/popup-layer-wiring.test.mjs` 是它写的，本批扩了 5 条。

## 1. `src/popupStack.ts` —— 接上了谁，为什么算真消费

### 1.1 已有的两处（8b 留的，本批逐条实测自证）

| 消费方 | 用的是什么 | 为什么算真消费（不是摆着） |
|---|---|---|
| `src/components/ToolWindowAnchorMenu.vue:10,32` | `usePopupLayer(box, shown, () => emit('close'))` | 它原先自挂 `window` 的 pointerdown/keydown；`tests/popup-layer-wiring.test.mjs:127-132` 钉死了「不再有 `window.addEventListener`」。真实挂载用例（同文件 `:49-59`、`:61-74`）用 `renderToString` 把组件跑起来，**从栈里读出那一层**并验证 Esc 只关最上面那层 —— 不是 grep，是真求值。 |
| `src/toolWindowStripes.ts:17` → `popupHasFocusWithin` | 读栈回答「焦点进了弹层没有」 | 上游 `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowManagerLifecycle.kt:131` 的 `JBPopupFactory.getParentBalloonFor(focusOwner)`，是 auto-hide（View Mode 的 Dock Unpinned / Undock）不收面板的唯一依据。没注册的层 = 栈恒空 = 这条恒答"没进弹层" = 开着菜单时窗口当场收掉。`tests/tool-window-auto-hide.test.mjs:15` 直接 import 栈来验这条。 |
| `src/components/ContentComboLabel.vue:22` | `usePopupLayer(menu, open, …)` | COMBO 形态的内容下拉（`ToolWindowContentUi.java:862-875`）。 |

### 1.2 本批补完的那一条行为：**Esc 两段式 + 弹层吃掉按键**

8b 只做到「Esc 关最上面那层」，**它自己在 `popupStack.ts` 旧注释里声称的"dispatch 返回 true 就吞掉
这次按键"并没有实现** —— 旧的键盘回调只拿到 `{ key }`，根本没有可消费的句柄。后果是可用户感到的错：
栈把最上面那层关掉之后，同一次 Esc 继续派发给页面，页面自己的那条 Esc 链（backdrop、速度搜索、
标题栏菜单）再关一层 ⇒ **两段式塌成一段，一次 Esc 关掉两层**。

上游那一条（逐行核对）：

* `platform/platform-api/src/com/intellij/ui/speedSearch/SpeedSearch.java:77-81` —— Esc 且
  `isHoldingFilter()` ⇒ `updatePattern("")` + `e.consume()`，**弹层不关**；
  `:58` 另有 `if (e.isConsumed() || !myEnabled) return`：已被消费的按键不再处理；
  `:120` 是 `isHoldingFilter()` 的定义；
* `platform/platform-impl/src/com/intellij/ui/popup/AbstractPopup.java:2998-3013` —— 取消那一支
  （`:3003`）带着 `!mySpeedSearch.isHoldingFilter()` 这道闸，`:3008` 才 `cancel(e)`，两支都 `return true`；
* `platform/platform-impl/src/com/intellij/ui/popup/PopupDispatcher.java:126-131` 经 `:169-172`
  把 `dispatchKeyEvent` 的返回值交给 AWT 的 `KeyEventDispatcher`：true ⇒ 这条链之外再也看不到这次按键；
* `platform/platform-impl/src/com/intellij/ui/popup/StackingPopupDispatcherImpl.java:181-193`
  （关闭请求给 `findPopup()` 的栈顶）、`:245-258`（批量收起）、`:273-283`（只关一层）；
* 速度搜索装在弹层里是**默认档不是可选项**：
  `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/SelectContentStep.kt:17`
  `override fun isSpeedSearchEnabled(): Boolean = true`，
  `platform/platform-impl/src/com/intellij/ui/popup/list/ListPopupImpl.java:1129` 按这一位装它，
  `:938` 是浮在列表上的那根 `SpeedSearchPatternField`。

本仓落法（架构不等价：没有 AWT/`KeyEvent` 消费位，用 DOM 捕获阶段等价）：

* `src/popupStack.ts` 新增纯函数 `popupEscapeAction(target)` → `'clear-filter' | 'cancel' | 'none'`；
  `PopupLayerState.holdingFilter`（快照位）+ `PopupLayerRegistration.holdingFilterNow`（**现问**谓词，
  与既有 `canClose`/`canCloseNow` 同一手法，对应上游在按键分发里现场问）+ `resetFilter`（清串那一步）；
* 新增 `PopupKeyEvent { key, alreadyConsumed, consume }`；`createPopupDispatcher` 的键盘回调改成
  `if (api.closeRequest()) event.consume()`，浏览器侧 `consume()` = `preventDefault()` + `stopPropagation()`
  （监听本来就在 `window` 的捕获阶段，`popupStack.ts` 里 `addKeyListener` 那段）；
* `closeRequest()` 走两段式：压着串 ⇒ 只调 `resetFilter()` 并返回 true；没在过滤 ⇒ `cancel()`；
  这一层不许关且没在过滤 ⇒ 返回 false ⇒ **不**吃按键，放行给页面。

### 1.3 本批新接上的三处消费者（让那条行为真的可被用户感到）

| 消费方 | 接法 | 症状消失 |
|---|---|---|
| `src/components/ContentComboLabel.vue` | 列表加速度搜索输入框（`<SpeedSearchBar :open="true" :query="filter">`），`rows` 是 `props.options` 的过滤投影（`speedSearchMatches`，复用 `src/speedSearch.ts`，不另起匹配），并把 `holdingFilter: () => filter.value !== ''` + `resetFilter` 交给栈 | 打了字之后第一次 Esc 只清字、列表不关；第二次才收 —— 上游同一档。同时它给栈交了 DOM 根节点，auto-hide 那条 `popupHasFocusWithin` 判据多一层可问 |
| `src/components/ToolWindowGear.vue` | **删掉自挂的 `window` 捕获 `pointerdown` + `keydown`（旧 `:32-44`）**，改 `usePopupLayer(menu, open, …)`，模板根节点补 `ref="menu"` | 齿轮与锚点菜单/内容下拉原先是"同一次点击的两个全局裁决者"（各按各的选择器判外面），一次点外面把两层一起收掉；现在只有一个所有者 |
| `src/components/ToolWindowHeader.vue` | `usePopupLayer(menu, menuShown, closeMenu)`，`menuShown = computed(() => props.menuOpen)`（开合状态在宿主，所以喂只读投影） | 标题栏菜单原先只有 DOM 局部的 `@keydown.esc.stop`，栈看不见它 ⇒ 它开着时 `popupHasFocusWithin` 答"没进弹层"，auto-hide 面板当场收掉；齿轮菜单与锚点菜单也不再互抢 |

`src/speedSearch.ts` 与 `src/toolWindowActions.ts` **没有改**：前者的匹配/按键归谁现成可用
（`speedSearchMatches`、`speedSearchStepForKey`），后者的 `hideActiveToolWindow` 走的是自己那条
`ctx.lastActiveId(...)`，与门面的 `activeToolWindowId()` 不是同一个问题（见 §2.3），不需要为接线而改。

### 1.4 仍然没有消费者的部分（如实登记，**不删**、也不造假入口）

* `closeAll()`（批量收起，上游 `StackingPopupDispatcherImpl.java:245-258`）：**上游 `close()` 在整个
  参考树里零调用点** —— 已按包路径（`platform/platform-api/src/com/intellij/openapi/ui/popup/StackingPopupDispatcher.java:38`
  是抽象声明）、按语义（`grep "PopupDispatcher.*close"`）、按文件名三条路各搜过，只找到声明与实现，
  没有触发行。所以"谁触发批量收起"在本树**无法核实**。既然指不到上游的触发方，本仓就不给 App.vue 派活
  （派了就是自加行为），只在 §1.5 记为待查。
* `persistent` / `persistentLayerIds()`（`:55-57`、`:77-92`）：上游唯一的触发方是模态对话框落地时
  （`platform/platform-impl/src/com/intellij/openapi/ui/impl/DialogWrapperPeerImpl.java:618-619`
  `hidePersistentPopups()` / dispose 时 `restorePersistentPopups()`）。本仓当前**没有注册为持久的层**，
  所以这条链没有生产者；对话框那一侧的装配（`SettingsDialog` 等）不属本桶。同样不造假入口。

## 2. `src/toolWindowManager.ts` —— 保留（不是重复门面），并补完它的两条查询

### 2.1 判据：它不是"再摆一个 facade"

`ToolWindowHeader.vue:7,96-110` 是真实消费方，而且**只有它能给**的那一条是判词 §B-1 要的
「每窗口聚合对象」：`windowInfo(id)` 一次给全 `WindowInfo.kt:9-50` 的字段，
`manager.setViewMode(id, mode)` 是唯一写入口（上游 `ToolWindowViewModeAction.java:127-135`）。
安装点 `src/toolWindowStripes.ts:711-730`（`installToolWindowManager`），
判据 `tests/tool-window-manager.test.mjs:150` 钉的是「标题栏读的是门面，不再连读三份 store 指针」。
删除它会把 8b 已经收拢的那三处散读重新摊回组件里，且 `WindowInfo` 那条缺口重新打开 ⇒ **不删**。

### 2.2 补完之一：运行期注册表有了生产方（原来是个零调用点的死导出）

`registerToolWindowId()` 在上一任手里是**导出但没人调**的（grep 全仓：只有定义）。
它对应的上游接口是 `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowManager.kt:39`
（`registerToolWindow(id, …)`）与 `:107-108`（`unregisterToolWindow(id)`）。
它不生效的实际后果：`getToolWindow('output')`（`ToolWindowManager.kt:139`）在 output 没收起来时靠
`knownIds()` 的可见集兜底能答，**收起来就错答 null** —— 而 `toolWindowIds()`（`:120`）答的是
"注册过的"，不是"正开着的"。

* `src/toolWindowStripes.ts:20-25` 引入 `registerToolWindowId` / `resetRegisteredToolWindowIds`；
* `src/toolWindowStripes.ts`（`refreshContentUiTypes`）：循环里那些「不在出厂锚点表」的内容 id
  （底部 output/run/problems/references/hierarchy/terminal —— 该文件 `:172-177` 的注释早就写明了
  「它们在上游各自就是工具窗口、一样有 `WindowInfo`，只是不在注册表里」）现在**逐条登记进门面**；
* 同文件装载布局处（`:324` 附近，紧挨既有那条 `hiddenStripeButtons.clear()`）先
  `resetRegisteredToolWindowIds()` 再重建 ⇒ 换项目不会把上一个项目的内容 id 留在答案里
  （这条就是 `unregisterToolWindow`，`:107-108`）。
* 判据：`tests/tool-window-manager.test.mjs` 新增 2 条（行为一条、生产方一条）。

### 2.3 补完之二：`isEditorComponentActive()` 换成上游的真判据（问焦点，不问"有没有窗口开着"）

上游 kdoc 与实现（逐字核对）：

* `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowManager.kt:112-115`
  「`true` if and only if an editor component is active」；
* 实现 `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowManagerState.kt:52-55`：
  `ComponentUtil.getParentOfType(EditorsSplitters::class, IdeFocusManager.focusOwner) != null`
  —— **与窗口开着没有完全无关**（面板全开着、光标在编辑器里 ⇒ 上游答 true）；
* 消费方一族：`platform/platform-impl/src/com/intellij/ide/actions/TabNavigationActionBase.java:59`、`:83`，
  `ActivateToolWindowAction.kt:156`。

门面原先的 `visibleIds().length === 0` 是另一条判据（且它的旧注释写的却是"焦点不在任何 dock 里"，
说法与代码不符）。本批：`ToolWindowManagerSource` 加 `editorComponentActive?: () => boolean | undefined`，
`src/toolWindowStripes.ts:724-730` 用现成的那张 dock 表实现
（`src/toolWindowDocks.ts:24` 的 `dockOf(document.activeElement) === 'editor'`；没有 DOM 时返回 `undefined`），
门面优先用它、拿不到才退回那条保守近似并**在代码里写明那是近似**。
判据：`tests/tool-window-manager.test.mjs` 新增一条（夹具给 true/false/不给，三档各钉一次）。

### 2.4 顺手修掉的两处类型破损（在我名下文件，是 8b 留下的）

`src/toolWindowStripes.ts:712/715` 两处 TS2322/TS2345：门面按 `string` 收 id，而 `anchorOf` /
`hiddenStripeButtons` 是窄联合 `ToolWindowId`。改成在调用点收口（`id => anchorOf(id as ToolWindowId)`、
`id => hiddenStripeButtons.has(id as ToolWindowId)`），门面签名不动。`npx vue-tsc -b` 后本域 0 错。

## 3. 改动文件（本批 7 个，全在桶 8 名下；保留文件一个没碰）

| 文件 | 改了什么 |
|---|---|
| `src/popupStack.ts` | 两段式 Esc（`popupEscapeAction`）、`holdingFilter`/`holdingFilterNow`/`resetFilter`、`PopupKeyEvent` + `consume()`、文件头消费方与上游坐标重写、删掉那条指向不存在文件的引用 |
| `src/components/ContentComboLabel.vue` | 速度搜索输入框 + `rows` 过滤投影 + `holdingFilter`/`resetFilter` 交给栈；上下键改走 `speedSearchStepForKey` 的**过滤后**行 |
| `src/components/ToolWindowGear.vue` | 删自挂的两条 `window` 监听与 `onUnmounted` 退订，改 `usePopupLayer` |
| `src/components/ToolWindowHeader.vue` | 菜单压栈（宿主 prop 的只读投影） |
| `src/toolWindowManager.ts` | `registerToolWindowId` 文档与 `resetRegisteredToolWindowIds`、`editorComponentActive` 通道 |
| `src/toolWindowStripes.ts` | 注册表生产方 + 换项目清登记 + 焦点判据安装 + 2 处类型收口 |
| `tests/popup-stack.test.mjs` | +5 条（纯函数真值表 + 两段式 + 无搜索的层 + 不许关的层 + 已消费按键） |
| `tests/popup-layer-wiring.test.mjs` | +5 条（三处新消费方 + 两个栈侧 consume 形状 + 一次过滤串的栈行为 + 三个组件真实 loadSfc） |
| `tests/tool-window-manager.test.mjs` | +3 条（注册表行为、生产方、焦点判据三档） |
| `tests/tool-window-content-ui.test.mjs` | 一条**钉形状**的断言改成钉意图（见 §4） |

## 4. 动过的既有断言（只有 1 处，理由与"仍然精确"的写法）

`tests/tool-window-content-ui.test.mjs:72` 原为
`assert.ok(combo.includes('v-for="(option, index) in options"'))`。
它钉的形状是 `in options`，意图是"combo 列的是内容列表本身、不是别的数据源"。
加了速度搜索之后渲染源改成 `options` 的过滤投影 `rows`（过滤串为空 = 全量，
同 `SpeedSearch.java:53-56` 的 `shouldBeShowing`）。按意图改钉两条、没有放松成 `includes`：

```js
assert.match(combo, /v-for="\(option, index\) in rows"/, 'combo 画的那一排不是内容列表')
assert.match(combo, /const rows = computed\(\(\) => \(filter\.value\.trim\(\)[\s\S]{0,160}props\.options/, ...)
```

其余断言体一字未动；没有改任何桩表键（本批没有动 CJS 桩那类测试，`.ts` 扩展名全部写全）。

## 5. 验证数字（只跑自己域）

```
node --test tests/popup-*.test.mjs                → 115 / 115 pass（起手段 105，本批 +10）
node --test tests/tool-*.test.mjs tests/tab-*.test.mjs → 297 / 297 pass
node --test tests/popup-*.test.mjs tests/tool-*.test.mjs tests/tab-*.test.mjs → 410 / 410 pass
```

起手基线：`tool-*`/`tab-*` 是 **290/291**，唯一红的是 `tests/tool-view-activation.test.mjs`
（判词写"整文件 20 s 超时，先判断是死等还是真慢"）。实测既不是死等也不是真慢：
1.3 s 抛 `SyntaxError: Invalid or unexpected token (while loading src/components/SearchPanel.vue)`
—— `ToolWindowView.vue:6` import 了桶 9 在途改坏的 `src/components/SearchPanel.vue`（901 行，
`git status` 显示 M，非我名下）。**本批没碰它**；到收工时桶 9 自己修好了，该文件转绿
（`tool-*` 184/184）。这条在此登记，避免下一任再查一遍。

`npx vue-tsc -b`：本批文件 0 错；仓内其余 18 处都在别桶在途文件
（`ProblemsPanel.vue`、`ProjectStructurePane.vue`、`libraryRootDetection.ts`、`navGotoTest.ts` 等）。
派单点的 `src/customFoldingProviders.ts` 那处已不在报错列表里（别桶修了）。

三个词法检测器 + 孤儿门禁：

```
node .tools/find-param-props.mjs      → 共 0 处参数属性
node .tools/find-ts-in-mjs.mjs        → 干净：tests/*.mjs 全部是纯 JavaScript
node .tools/find-missing-ext.mjs      → 扫描 1173 个文件；干净（没有漏扩展名、且静态也解析不到的相对 import）
node .tools/find-orphan-modules.mjs --gate
  → 零生产消费方 10 个（合法例外 1）；门禁绿：没有基线之外的新增零消费方模块
     （起手是 18 个、门禁红 5 个新增；本域的两个都不在名单里）
node .tools/find-orphan-modules.mjs --dead-imports
  → 「冗余 import」11 处全是别桶的（App.vue / SearchPanel.vue / ToolWindowView.vue）；
     本批四个消费方一个都没进那张表（不是"import 了但没渲染"）
```

行数上限（ts 900）：`popupStack.ts` 494、`toolWindowManager.ts` 256、`toolWindowStripes.ts` 770、
`ContentComboLabel.vue` 143 —— 没有新文件，也没有拆文件（因此没有 `read('src/旧文件')` 锚点要改指）。

## 6. 反向验证（新判据必须能让它红）

逐条把源码改坏 → 跑对应测试 → 记录 → 还原（还原后复跑 12/12 绿，已核对源码 grep 计数）：

| 改坏的那一处 | 期望 | 实测 |
|---|---|---|
| 删掉 `if (api.closeRequest()) event.consume()` | 红 | 红：`Esc 由弹层收走时把按键吃掉…`、`两段式 Esc：第一次只清空过滤串…`、`没有速度搜索的层…` |
| `popupEscapeAction` 里去掉 `holdingFilter` 那一支（塌成一段） | 红 | 红：`栈真的两段式…`、`popupEscapeAction：压着过滤串 ⇒ clear-filter…` |
| `ContentComboLabel` 去掉 `holdingFilter: () => …` | 红 | 红：`内容下拉把过滤串交给栈…` |
| `toolWindowStripes` 去掉 `registerToolWindowId(id)` | 红 | 红：`生产方确实存在：stripes 装载项目布局时登记…` |
| 门面退回"只看可见集"（忽略 `editorComponentActive`） | 红 | 红：`宿主给了焦点判据就用它…` |
| `ToolWindowGear` 重新自挂一条全局监听 | 红 | 红（`齿轮弹层交出它自挂的两条全局监听…`） |
| `ToolWindowHeader` 删掉 `usePopupLayer(...)` 那一行 | 红 | 红：`标题栏菜单也压进同一条栈…` |

注：第 7 条第一版变异写的是 `if (false) usePopupLayer(...)`，判据仍绿（正则只查调用文本，
没查它是否可达）⇒ 换成**整行删除**后才如期红。这条记在这里：形状类 grep 判据对"死代码化"的变异不敏感，
能整行删就整行删。

## 7. 做不到 / 未做（具体卡点）

1. `closeAll()`（批量收起）**没有消费者**：上游 `StackingPopupDispatcher.close()`
   （`platform/platform-api/src/com/intellij/openapi/ui/popup/StackingPopupDispatcher.java:38`）
   在整个参考树**零调用点**，"谁触发它"无法核实。不派 App.vue 接线请求 = 不给本仓自加一条上游没有的动作。
2. `persistent` 同理：上游触发方是 `DialogWrapperPeerImpl.java:618-619`（模态对话框落地时整体隐藏/恢复），
   本仓对话框装配不在桶 8 名下，且当前没有任何层声明为持久（没有生产者）。
3. `WindowInfo.isSplit`（`WindowInfo.kt:28`）仍是 `source.isSplit?.(id) === true` ⇒ 恒 false：
   本仓"工具窗口内部再分栏"没有实现，`ToolWindowManagerSource.isSplit` 没有安装方（诚实的"没有那一态"）。
4. 页面里剩下三处 DOM 弹层没接进栈，因为它们的 markup 在 `src/App.vue`（保留文件，本桶只读）：
   项目树右键的 `.tree-menu-backdrop`（`App.vue:2451`）、底部标签溢出的 `.output-tabs-more-menu`
   （`App.vue:2190`，状态 `hiddenTabsOpen` 在 `App.vue:394`）、`<TabContextMenu>` 的挂载点
   （`App.vue:2501`）。前两条已写接线请求（`docs/wiring-requests-2026-10-06-bucket8c.md`）。
   `TabContextMenu.vue` 本身在我名下、`close()` 现成，只差模板根节点一个 `ref`；本批把调用上限留给
   报告与验证，**没做**，记在这里而不是默默留着。

---

# §8 桶 8 收口（同日最后一轮 · 交付报告）

派单给这一轮的三件事：① 判红 `tests/tool-view-activation.test.mjs` 的整文件失败（死等 / 真慢，不许加
timeout）；② 补 `ContentComboLabel` 的两条红；③ 出这份覆盖本批桶 8 实际落地面的报告。三件都做完，
另外把 §7.4 里那条"记着没做"的 B3（标签右键菜单压栈）就地做掉了。

## 8.1 必修项①：`tests/tool-view-activation.test.mjs` 的整文件红 —— 判决：**不是死等，也不是本域缺陷，是加载期抛错**

**实测**（同一台机器、同一份工作区，本轮连续跑）：

| 跑法 | 结果 |
|---|---|
| `node --test tests/tool-view-activation.test.mjs` ×3 | 4/4 全绿，每次 3.0–3.2 s |
| 桶 8 全域（`tool-*`+`tab-*`+`popup-*`+`dnd-*`+`scratch-*`+`stripe-*`+`panel-*`+`speed-*`）×4 | 500/500、503/503、504/504 全绿 |
| 派单给的实况（497 用例 / 496 通过 / 1 失败） | 与本仓今天的 500/500 **数字自洽**：该文件 4 条用例，整文件失败时只按 1 条记 ⇒ 500−4+1=497 |

**没有给它加过任何 timeout**（该文件里也没有 `timeout` 这个字）。

**根因（三条独立证据）**：

1. **红的是"文件"不是"用例"**：仓里现存的两份全量快照（`full-test-snapshot.txt` 00:53、
   `full-test-snapshot2.txt` 01:06）里，这个文件的四条用例都是 `✔`；同一两份快照里另有两次**同样的整文件红**
   （`tests\sfc-single-root.test.mjs (1665ms)`、`tests\ui-icons.test.mjs (1939ms)`），红法一模一样：
   `node:internal/modules/run_main:107 triggerUncaughtException` + 末尾 `Node.js v24.18.0`，
   抛点在**模块求值期**（`tests/ui-icons.test.mjs:25`、`tests/sfc-single-root.test.mjs:44` 的顶层断言），
   报错正文是 `D:\TaoCode\src\components\TodoPanel.vue 解析失败：Element is missing end tag.`
   ⇒ 这类红的时长（1.4–2.3 s）就是"编译完 SFC 链再抛"的时间，与派单说的"约 2.3 s 后红"吻合。
2. **该文件的唯一模块期副作用是一张大图**：`tests/tool-view-activation.test.mjs:16` 在顶层调
   `loadSfc('src/components/ToolWindowView.vue')`，夹具（`tests/vue-sfc-loader.mjs:36-42`）会把图里
   每个相对 `.ts` 依赖**转译并真求值**，求值期抛错就原样重抛（`error.message += ' (while loading ' + filename + ')'`）。
   按 `from '…'` 实测遍历该图：**237 个文件**（其中 193 个 `src/*.ts`）。这张图里任何一个是半成品，
   整个测试文件在跑第一条用例之前就崩 —— 这就是"整文件红"的形状。
3. **什么形态的坏文件会崩、什么不会**（本轮用现成夹具做过对照，探针已删）：
   - `<template>` 缺尾标签（就是 `TodoPanel.vue` 现在的样子）→ `loadSfc` **不抛**（`parseSfc` 容忍），所以它红不了这个文件；
   - `<script setup>` 被截断（写到一半的样子）→ **抛** `[vue/compiler-sfc] Unexpected token (3:0)` ⇒ 整文件红。
   时间线也对得上：图里的 `src/components/ToolWindowView.vue:10` 所 import 的
   `src/components/DebugPanel.vue` 写在 **01:04:34**、`src/dbgBreakpointsDialogHost.ts` 写在 **01:05:11**，
   正是派单测量桶 8 的那个窗口（别的桶在途）；本域文件从 01:06 之后一个都没变过
   （`find src tests -newermt "2026-10-06 01:06"` 只列出 `src/editorTyping.ts` 等**别桶**文件，且都不在这张图里）。

**结论与处置**：该红是**外部瞬时**的加载期崩溃（共享依赖被别的批写到一半），不是本域行为缺陷、
也不是测试会死等 ⇒ 不改测试语义、不加 timeout。留一条**本域真实风险**给下一任：
`src/components/TodoPanel.vue`（`ToolWindowView.vue:7` import 它）**此刻仍是坏的** ——
`@vue/compiler-sfc` 报 `Element is missing end tag.`（位置 349:38，文件 mtime 00:52:32，`git status` 显示 M、
非我名下，本轮没碰）。它今天正让 `tests/sfc-single-root.test.mjs`、`tests/ui-icons.test.mjs` 两个文件
整文件红；属主（桶 14 / TODO 面板那一族）补上闭合标签即消。

## 8.2 必修项②：`ContentComboLabel` 的两条红

起手复跑：`node --test tests/content-combo-label.test.mjs` = **4/6**（仍红那两条，与派单一致）。
两条红的**根因是同一条**：上一轮（§4）为了让速度搜索能过滤，把渲染源从 `options` 换成了它的
过滤投影 `rows`，并把 `tests/tool-window-content-ui.test.mjs:77` 的判据**按实现**改钉成 `in rows`。
于是这两条判据变成互相排斥的字面量（一条要 `in options`、一条要 `in rows`），
另一条「缺向上」是因为 ↑ 被收进 `speedSearchStepForKey` 之后源码里不再出现 `ArrowUp`。

按上游核对后**改实现**（不是放松判据）：

* `platform/platform-impl/src/com/intellij/ui/popup/list/ListPopupModel.java:44-48`
  （`getOriginalIndex(filteredIndex)`：过滤表**留着**原表与一张索引映射）、`:143-150`（`refilter()`）、
  `:152-154`（`isVisible(object)` —— 没命中的元素是"不可见"，不是"不存在"）；
* 列表数据源 = `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/ToolWindowContentUi.java:863`
  传进去的 `contentManager.getContents()` **全量**，默认高亮 = `:865-867` 的 `setDefaultOptionIndex`；
* 这一层默认开速度搜索：`platform/platform-impl/src/com/intellij/openapi/wm/impl/content/SelectContentStep.kt:17`；键盘四键归
  `platform/platform-impl/src/com/intellij/ui/SpeedSearchBase.java:1030-1032`（`isUpDownHomeEnd` 就是点名
  ↑↓Home/End 四个键）、闸门在 `:684-691`、目标在 `:695-706`、consume 在 `:982-984`。

落法（`src/components/ContentComboLabel.vue`）：

| 改了什么 | 行 |
|---|---|
| 渲染源回到 `options`（逐条列每一条 content），`v-show="rows.includes(index)"` 收起没命中的行 | `:151` |
| `rows` 从"过滤后的选项数组"改成"**可见行的原索引表**"（`ListPopupModel` 那张映射的等价物） | `:58-65` |
| 高亮 `active` 改成原索引；打字后若当前行被过滤掉就落到第一条可见行 | `:78`、`:100-103` |
| ↑↓Home/End：闸门点名四键，目标仍交给唯一真源 | `:121-125` |
| 一条都没命中时 Enter 不选（`ListPopupImpl.java:505` 的 `getSize()==0` 那一支） | `:127-131` |

新增的唯一真源（本域 `src/speedSearch.ts`，被 11 个消费方共用）：
`stepVisibleIndex(visible, from, kind)` = `src/speedSearch.ts:133-141` —— 可见表内走一步 / 回绕 /
端点 / 空表不动，边界口径与同文件 `nextSpeedSearchHit`（`:79-89`，`from < 0` 那一支）一致。
组件里**不再有第二套取模算术**（这条由新门禁反向验证钉住，见 §8.6）。

**订正留痕（两处，都要查得到）**：

1. 派单写的判据出处 `platform/ide-impl/src/com/intellij/openapi/fileEditor/impl/EditorGroupWrapper.java`
   的 `toggleContentPopup` —— 该文件在参考树里**不存在**（`find . -name "EditorGroupWrapper*"` 空；
   按包路径、按语义 `grep -rn toggleContentPopup`、按文件名三条路各搜过）。真身：
   `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/ToolWindowContentUi.java:862-875`
   （调用方 `platform/platform-impl/src/com/intellij/ide/actions/ShowContentAction.java:62` 与
   `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowImpl.kt:798`）。本报告与代码注释一律改用后者。
2. §4 那条"按意图改钉"的判据本身是**错位**的：它把实现形状当意图钉，结果与另一条判据互斥。
   已按 `ListPopupModel.java:44-48` 改正（实现与两条判据同源），`tests/tool-window-content-ui.test.mjs:70-79`
   的注释里写明了原判、为什么错、按哪一行改。

## 8.3 必修项③（§7.4 那条未完的 B3）：标签右键菜单压进弹层栈

* `src/components/AnchoredMenu.vue:23` `defineExpose({ box })` —— 外壳把自己的浮层根节点露给宿主
  （栈要量矩形 `StackingPopupDispatcherImpl.java:116-164`、判焦点 `ToolWindowManagerLifecycle.kt:129-131`）。
* `src/components/TabContextMenu.vue:32-36` —— `ref="menu"` 接住根节点、`usePopupLayer(box, shown, close, { cancelOnClickOutside: true })`；
  宿主用 `v-if` 控制挂载，所以 `shown = ref(true)` 与 `ToolWindowAnchorMenu.vue:31` 同档。
  用户可见的变化：**Esc 现在收这一层**（原先只有 backdrop，栈看不见它 ⇒ Esc 对它无效），
  且 auto-hide 的窗口开着这个菜单时不再当场收掉。
* 判据：`tests/popup-layer-wiring.test.mjs` 新增一条**真挂载**用例（`renderToString` 后按栈的差集取那一层，
  调它的 `cancel()` 验回给宿主的是 `close` 事件），不是源码 grep。
* 顺手删掉一处死 import：`ContentComboLabel.vue` 原先 import 了 `speedSearchKeyAction` 但**全文只用了一次都没有**。
  它对应的是 `'accept' ⇒ 收起搜索框`（`SpeedSearchBase.java:964-975`），而这一层的搜索框是**常驻**的
  （`tests/popup-layer-wiring.test.mjs:152` 那条门禁，理由：`ListPopupImpl.java:938` 的那根
  `SpeedSearchPatternField` 在这一层就是给得见的），没有对象可收 ⇒ 不硬造行为，删 import 并在
  `src/components/ContentComboLabel.vue:50-51` 写明为什么这里不适用。

## 8.4 本批桶 8 落地面（实况来自 `node .tools/bucket-landing.mjs 8`：归属条目 16 个 / 工作区命中 39 个改动，本轮 +1 = 40）

档位：**`[x]` 已做**（有实现 + 有消费链路 + 有判据）· **`[~]` 部分**（写清"本仓已有 / 还差"）·
**`[ ]` 未做** · **`[-]` 不适用**。上游路径均相对 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`。

| 族 | 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话说明 |
|---|---|---|---|---|---|
| 弹层 | 全局弹层链（鼠标+键盘一个所有者） | `[x]` | platform/platform-impl/src/com/intellij/ui/popup/PopupDispatcher.java:36-37 | src/popupStack.ts:393（`usePopupLayer`） | 一层的开合压栈/出栈都走这条链，组件不再自挂 `window` 监听 |
| 弹层 | 点外面自顶向下裁决 | `[x]` | platform/platform-impl/src/com/intellij/ui/popup/StackingPopupDispatcherImpl.java:116-164 | src/popupStack.ts:119（`popupsToCancelOnOutsidePress`） | 落点在别的层里也关得上，两层弹层不再互抢同一次点击 |
| 弹层 | Esc 只给栈顶 | `[x]` | 同上 :181-193 | src/popupStack.ts:170（`popupEscapeAction`） | `findPopup()` 的"丢掉已释放栈顶后的最上那层" |
| 弹层 | Esc 两段式（先清过滤串） | `[x]` | platform/platform-api/src/com/intellij/ui/speedSearch/SpeedSearch.java:77-81 · platform/platform-impl/src/com/intellij/ui/popup/AbstractPopup.java:3003-3010 | src/popupStack.ts:170 + src/components/ContentComboLabel.vue:66-70 | 压着串时第一次 Esc 只清串并吃掉按键，第二次才收这一层 |
| 弹层 | 弹层几何：贴着锚点/放不下翻边 | `[x]` | platform/platform-impl/src/com/intellij/ui/popup/AbstractPopup.java:732-737（`showUnderneathOf`） | src/popupAnchor.ts:39 · src/popupPlacement.ts:29 · src/popupPosition.ts:32-35 | 按实测尺寸落位，四张弹层都无坐标魔数（`tests/popup-anchor.test.mjs:57`） |
| 弹层 | 一层弹层 = 一个 step（列表/子层/分隔线） | `[x]` | platform/ide-core/src/com/intellij/openapi/ui/popup/ListPopupStep.java:21 · ListSeparator.java:22-46 · platform/platform-impl/src/com/intellij/ui/popup/WizardPopup.java | src/popupSteps.ts:43 | `ListSeparator` 与自动延时的档位都照声明抄 |
| 弹层 | 弹层开着时数据变了就地刷新 | `[~]` | platform/lang-impl/src/com/intellij/ui/popup/PopupUpdateProcessor.java | src/popupLiveUpdate.ts:51 | 已有：三条规则 + 判据；还差：生产消费方（零消费方，已在孤儿门禁登记理由） |
| 弹层 | 六处真实消费方 | `[x]` | StackingPopupDispatcherImpl.java:116-164 | ToolWindowAnchorMenu.vue:32 · ToolWindowGear.vue · ToolWindowHeader.vue · ContentComboLabel.vue:66 · **TabContextMenu.vue:36（本轮）** · popup-layer-wiring 真挂载判据 | 本轮补上最后一处 DOM 局部收层 |
| 工具窗口 | COMBO 内容下拉（逐条 content + 当前项 + 速度搜索 + ↑↓Enter/Esc） | `[x]` | platform/platform-impl/src/com/intellij/openapi/wm/impl/content/ContentComboLabel.java:69-80, :192 · platform/platform-impl/src/com/intellij/openapi/wm/impl/content/ToolWindowContentUi.java:862-875 · platform/platform-impl/src/com/intellij/openapi/wm/impl/content/SelectContentStep.kt:17 · platform/platform-impl/src/com/intellij/ui/popup/list/ListPopupModel.java:44-48, :143-154 | src/components/ContentComboLabel.vue:58-65, :100-131, :151 | 本轮改动的主件：渲染源回 `options`，`rows` 退回可见原索引表 |
| 工具窗口 | 速度搜索键位归属与步进 | `[x]` | platform/platform-impl/src/com/intellij/ui/SpeedSearchBase.java:476-516, :683-706, :964-975, :1030-1032 | src/speedSearch.ts:100-107, :112-118, **新 :133-141** | ↑↓Home/End 走命中行；空表不动（`ListPopupImpl.java:505`） |
| 工具窗口 | 门面与查询面（`WindowInfo` 聚合、`getToolWindow`、注册表） | `[x]` | platform/platform-api/src/com/intellij/openapi/wm/ToolWindowManager.kt:120 · platform/platform-impl/src/com/intellij/openapi/wm/ex/ToolWindowManagerEx.kt:19 · platform/platform-api/src/com/intellij/openapi/wm/WindowInfo.kt:9-50 | src/toolWindowManager.ts（安装方 src/toolWindowStripes.ts:87） | 标题栏读门面，不再连读三份 store 指针 |
| 工具窗口 | 视图模式（View Mode 三档 + 每窗口记忆） | `[x]` | platform/platform-impl/src/com/intellij/ide/actions/ToolWindowViewModeAction.java:31-37 · platform/ide-core/src/com/intellij/openapi/wm/ToolWindowType.java:4-6 | src/toolWindowViewMode.ts:89, :100 | 档位判定是纯函数，锚点菜单/齿轮都读它 |
| 工具窗口 | dock 归属（焦点落在哪个 dock / 不跨 dock 导航） | `[x]` | platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowManagerLifecycle.kt:129-131 | src/toolWindowDocks.ts:24 | auto-hide 的"焦点进弹层没有"问的就是它 |
| 工具窗口 | 侧条（拖放排序 + 宽度） | `[x]` | platform/platform-impl/src/com/intellij/toolWindow/ResizeStripeManager.kt:49-61 | src/components/ToolStripe.vue · src/toolStripeDrag.ts:15 · src/stripeResize.ts（本批未改） | 侧条宽度与拖放态各一处真源 |
| 工具窗口 | 标题栏与齿轮菜单 | `[x]` | platform/platform-impl/src/com/intellij/toolWindow/ToolWindowHeader.kt:119, :212-256 · platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowImpl.kt:869 | src/components/ToolWindowHeader.vue · src/components/ToolWindowGear.vue · src/menus/toolWindowGear.ts:48 | 齿轮组顺序照 `ToolWindowImpl.kt:859-872` |
| 工具窗口 | 内容形态（tabbed / combo 每内容一份） | `[x]` | platform/platform-impl/src/com/intellij/openapi/wm/impl/content/TabContentLayout.java:58-59 · platform/platform-impl/src/com/intellij/ui/content/tabs/TabbedContentAction.java:144-150 | src/toolWindowStripes.ts:87 · src/toolContentTabs.ts:19-23 | `WindowInfo.contentUiType` 那条缺口已在 8b/8c 收口 |
| 工具窗口 | 布局快照与档名（命名布局） | `[x]` | platform/platform-impl/src/com/intellij/toolWindow/ToolWindowDefaultLayoutManager.kt:70-77 · ToolWindowLayoutProfileProvider.kt:36-46 | src/toolLayout.ts:27-31 · src/toolLayouts.ts:46 · src/toolLayoutProfiles.ts:44 | 出厂布局名 / 上限 / 档模式照上游 |
| 工具窗口 | 面板尺寸拖拽（编辑区 vs 工具窗口） | `[x]` | platform/platform-impl/src/com/intellij/ide/actions/WindowAction.java:113（`getPreferredDelta`） | src/panelResize.ts:42 | 尺寸唯一出处；"每个窗口记住自己的尺寸"同处 |
| 工具窗口 | 视图宿主的面注入 | `[x]` | 见 `src/toolViewContext.ts` 头（`default.xml:996-998` 一族注册项） | src/toolViewContext.ts:86 | 所有面板的输入面合成一处，`tests/tool-view-activation.test.mjs` 钉的正是它的 `active` 契约 |
| 工具窗口 | 隐藏/关闭动作族 | `[x]` | platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowImpl.kt:521 · HideToolWindowAction.kt:21-29 · HideSideWindowsAction.kt:18-25 | src/toolWindowActions.ts:61, :79 | 焦点 dock 的读法也在这里 |
| 标签条 | 单行可滚动布局 | `[x]` | platform/platform-api/src/com/intellij/ui/tabs/impl/JBTabsImpl.kt:766-772 | src/tabStripView.ts:41 | 溢出可滚，不再有"…"猜测 |
| 标签条 | 多行 / 溢出度量 | `[x]` | platform/platform-api/src/com/intellij/ui/tabs/impl/singleRow/SingleRowLayoutStrategy.java:132-150 · JBTabsImpl.kt:570-577 | src/tabStripLayout.ts:35-43 | 宽度、死区、行高三个常数都指得到上游 |
| 标签条 | 标签标题合成（同名带目录 / provider 覆盖） | `[x]` | platform/ide-core-impl/src/com/intellij/openapi/fileEditor/impl/EditorTabPresentationUtil.kt:18-22 · UniqueNameEditorTabTitleProvider.kt:34-56 | src/tabTitle.ts:32-42 | provider 链与去重后缀的顺序照上游 |
| 标签条 | 标签闪烁告警（次数上限 / 再触发） | `[x]` | platform/platform-api/src/com/intellij/ui/tabs/impl/JBTabsImpl.kt:399-409 | src/tabAlerts.ts:24-27 | 5/7 两个上限与 500ms 周期都来自上游 |
| 标签条 | 标签拖放（同一次拖拽两条下落路径） | `[x]` | platform/platform-api/src/com/intellij/ui/tabs/TabsUtil.java:54-111 | src/tabDragDrop.ts:26 | 与 `dndModel` 共享"正在拖什么"，不分两套状态 |
| 标签条 | 标签右键菜单 | `[x]` | StackingPopupDispatcherImpl.java:181-193（Esc 归栈顶）· PlatformActions.xml:907-915（行序） | src/components/TabContextMenu.vue:32-36 | 本轮压栈；行序与子菜单是 8a/8b 落的 |
| 拖放 | 拖放动作模型（move/copy/link 与修饰键） | `[x]` | platform/platform-impl/src/com/intellij/ide/dnd/DnDManagerImpl.java:183-220, :656-663 | src/dndModel.ts:29-39 | 动作 id 与位掩码照上游常量 |
| 拖放 | 落点装饰与外部文件落点 | `[~]` | platform/platform-impl/src/com/intellij/ide/dnd/Highlighters.java:31-39 · DroppedFileCopy.kt:58-98 | src/dragAndDropTargets.ts:54-65 | 已有：目标矩形/边框常数 + 判据；还差：生产消费方（写盘/确认框在别桶的注入面，孤儿门禁已登记） |
| Scratch | 临时文件创建序列 | `[x]` | platform/analysis-api/src/com/intellij/ide/scratch/ScratchFileService.java | src/scratchFiles.ts:11 | 带重试的 IO 挪出组装层，落点按本仓工作区 `scratch/` |
| Scratch | 历史与语言推断 | `[~]` | 同上 + `platform/lang-impl/src/com/intellij/ide/scratch/` | src/scratchHistory.ts:23-26 | 已有：LRU/上限与语言推断纯函数 + 判据；还差：入口在别桶的 New Scratch 面板 |
| 文件色 | 三个开关做成可搜索勾选行 | `[x]` | platform/lang-impl/src/com/intellij/ui/tabs/FileColorsOptionsTopHitProvider.java | src/fileColorsOptions.ts:19-21 | 主开关关掉时两个子开关禁用（上游那支根本不返回它们） |
| 速度搜索 | 齿轮第一条 SpeedSearch 行 | `[x]` | platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowImpl.kt:869 · platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:157-160 | src/menus/toolWindowGear.ts:48 · src/speedSearch.ts:29-107 | 11 个消费方共用同一套匹配/按键规则 |
| 菜单 | View 菜单（编辑器开关 / 布局） | `[x]` | PlatformActions.xml:519-636 · ToolWindowsGroup.java:78-87 | src/menus/viewMenu.ts:63 | 组顺序与 weight 照 XML |
| 工具窗口 | 面板激活值契约（底部 dock 不被左栏状态带偏） | `[x]` | 契约本体：src/components/ToolWindowView.vue 的 `active` prop（宿主接线在 `App.vue`，本轮未动） | tests/tool-view-activation.test.mjs:55-63 | 本轮判掉的整文件红正是这条契约的**加载期**问题，行为本身没变 |
| 弹层 | `closeAll()`（批量收起整条栈） | `[-]` | 无法核实：`StackingPopupDispatcher.close()` 在参考树里零调用点（详见 §1.4、§7.1） | src/popupStack.ts（`closeAll` 实现留着） | 上游触发方指不到 ⇒ 不派 App.vue 接线、不给本仓自加一条上游没有的动作 |
| 弹层 | `persistent`（模态框落地时整体隐藏/恢复） | `[-]` | platform/platform-impl/src/com/intellij/openapi/ui/impl/DialogWrapperPeerImpl.java:618-619 | src/popupStack.ts（`persistentLayerIds`） | 没有生产者（本仓没有注册为持久的层），对话框装配不属本桶 |

**本域内没做的 `[ ]`**：没有（能做的都做掉了；剩下两条 `[~]` 的缺口都卡在**别桶的注入面**，见 §8.8）。

## 8.5 验证数字（只跑自己域，没收工跑全量）

```
node --test tests/popup-*.test.mjs                                   → 116 / 116 pass（派单给的起手 115；本轮 +1 条标签菜单真挂载）
node --test tests/tool-*.test.mjs tests/tab-*.test.mjs               → 297 / 297 pass
node --test tests/dnd-* scratch-* stripe-* panel-* speed-*           → 91 / 91 pass（起手 89；本轮 +2 条 stepVisibleIndex 行为）
桶 8 全域（上面三行合起来跑）                                        → 504 / 504 pass（起手实测 497/496/1）
node --test tests/content-combo-label.test.mjs                       → 6 / 6 pass（起手 4/6，两条红已消）
node --test tests/tool-view-activation.test.mjs                      → 4 / 4 pass ×3 次连跑（没动过这个文件）
npx vue-tsc -b --force                                               → 本域 0 错；全仓只剩 1 条：src/keymapBindings.ts:111（保留文件、别桶在途，与 .tmp-tsc.txt 里的基线同一条）
```

**本域之外、本轮观测到但没碰的红**（都不在桶 8 归属清单里，登记免得下一任重查）：
`tests/module-size.test.mjs`「没有未登记的巨型源文件」红在 `src/components/WelcomePage.vue`（920 行 > 900 上限），
01:06 那份全量快照（`full-test-snapshot2.txt`）里同一条已经红；`tests/sfc-single-root.test.mjs` 与
`tests/ui-icons.test.mjs` 整文件红在 `src/components/TodoPanel.vue` 的解析错误（见 §8.1 末与 §8.8 第 5 条）。
本域用到的公共夹具 `tests/vue-sfc-loader.mjs` 工作区里是 M（别的批在改），本轮一行没动它。

## 8.6 反向验证（三条新门禁，逐条注入违规 ⇒ 必须红 ⇒ 还原）

| 注入的违规 | 该红的那条 | 实测 |
|---|---|---|
| 把 `active.value = stepVisibleIndex(…)` 换回组件里就地取模（`order[(p+1)%order.length]`） | `tests/speed-search-wiring.test.mjs`「上下/Home/End 的可见行步进只有一处真源」 | **红**：`高亮没走 stepVisibleIndex 这张可见表 ⇒ 组件里又抄了一份回绕数学` |
| 删掉行上的 `v-show="rows.includes(index)"`（过滤串不再收起没命中的行） | `tests/tool-window-content-ui.test.mjs`「the content UI toggle is wired to a real combo rendering and is remembered」 | **红**（同一次跑：24 pass / 1 fail） |
| 删掉 `TabContextMenu.vue` 里那句 `usePopupLayer(box, shown, close, …)` | `tests/popup-layer-wiring.test.mjs`「标签右键菜单也压进同一条栈」 | **红**：`标签菜单一次挂载该压一层，实际 0 层` |

三条都在**同一轮**还原后复跑：桶 8 全域 504/504 绿、`content-combo-label` 6/6 绿。
第一轮注入时我还犯过一次"假反向验证"：第一版变异写成 `% visible.length`（局部变量），
而门禁正则盯的是 `%\s*\w+\.length` 的**任意**变量名 —— 那时测试仍然绿，说明门禁太窄；
把门禁换成 `/%\s*\w+\.length/` 并把 call-site 从 `includes('stepVisibleIndex')`（注释里也有这个词，
删掉调用仍会命中）换成整条赋值语句的正则之后才如期红。这条教训记在这里。

## 8.7 零消费方自查（不许留只过自己测试的死模块）

```
node .tools/find-param-props.mjs    → 共 0 处参数属性
node .tools/find-ts-in-mjs.mjs      → 干净：tests/*.mjs 全部是纯 JavaScript
node .tools/find-missing-ext.mjs    → 扫描 1191 个文件；干净（没有漏扩展名、且静态也解析不到的相对 import）
node .tools/find-orphan-modules.mjs --gate → 门禁只红 1 个**新增**孤儿：src/rootsJarEntries.ts（桶 15 项目模型族，不属本桶，本桶没碰）
                                            本域：0 新增；本轮新加的 `stepVisibleIndex` 有真实消费方（ContentComboLabel.vue:23 import、:124 调用）
```

本域**登记在册**的零生产消费方三个（都有文件头理由、都被孤儿门禁认作合法例外，本轮复核仍在册）：
`src/dragAndDropTargets.ts`（写盘/确认框/进度在别桶的注入面）、`src/popupLiveUpdate.ts`
（三条触发源的对应物见 `docs/inventory/verdict-ui-tabs-popup.md` 族三）、`src/scratchHistory.ts`
（入口是别桶的 New Scratch 面板）。三者都**只有测试消费**，没有造假入口。
`node .tools/bucket-landing.mjs 8` 的消费方计数（同一判据）：`toolWindowStripes.ts` 15、`speedSearch.ts` 11、
`popupAnchor.ts` 7、`popupStack.ts` 5、`ContentComboLabel.vue` 3 —— 本域主干没有孤儿。

## 8.8 做不到 / 无法核实（具体到哪一环）

1. **项目树右键菜单与底部标签溢出菜单还没在栈上**（§7.4 / 接线请求 B1、B2）：缺的是
   `src/App.vue`（保留文件，本桶只读）里那两句 —— backdrop 的 `@pointerdown` 换成 `usePopupLayer` 的
   `cancel`、并给那一层一个 `ref`。本轮**故意没有**把注册塞进 `AnchoredMenu.vue` 内部：
   `usePopupLayer` 的 `cancel` 必须能真的收层（`StackingPopupDispatcherImpl.java:181-193` 交给栈顶后就 `consume`），
   而树菜单的开合状态 `treeMenu` 住在 `App.vue:394` 一段 —— 外壳自己注册却没有 cancel 句柄的话，
   Esc 会变成"栈吃键但菜单不收"，比现在（Esc 无效）更坏。所以注册点留在能拿到状态的地方，即那两条接线请求。
2. **`ContentComboLabel` 的 `'accept'`（Enter/PgUp/PgDn/←/→ 收起搜索框）没实现**：
   `SpeedSearchBase.java:964-975`。缺的那一环是"这一层的搜索框能被收"这个状态本身 ——
   上游的 `SpeedSearchPatternField` 是浮在列表上、按需出现的（`ListPopupImpl.java:938`），
   本仓这一层把它做成常驻输入框并由 `tests/popup-layer-wiring.test.mjs:152` 钉住；
   要补这条得同时改那条门禁的设计决定，不在本轮范围内（已在 `ContentComboLabel.vue:50-51` 写明）。
3. **`TabbedContent` 的子层（`hasSubstep` → 二级列表）没做**：`platform/platform-impl/src/com/intellij/openapi/wm/impl/content/SelectContentStep.kt:27, :35-37`。
   缺的是本仓的"多标签 content"数据源 —— 现在 `options` 只有 `id/label` 两字段，没有第二层可列。
   不做空壳子菜单。
4. **`tests/tool-view-activation.test.mjs` 那次红无法稳定复现**（§8.1）：能核实的是"红法=加载期抛错、
   本域文件在 01:06 后未变、连跑三次全绿"；无法核实的是**具体哪一个共享依赖当时是半成品**
   （01:04-01:05 写过的 `src/components/DebugPanel.vue` / `src/dbgBreakpointsDialogHost.ts` 都在那张 237 文件的图里，
   但写盘过程没留日志，只能给出时间吻合的嫌疑，不能给定论）。
5. **`src/components/TodoPanel.vue` 现在解析不过（`Element is missing end tag.` @349:38）**，
   正让 `tests/sfc-single-root.test.mjs`、`tests/ui-icons.test.mjs` 整文件红：不在本桶归属清单
   （本桶只有 `ToolWindow*.vue`/`ToolStripe.vue`/`TabContextMenu.vue` 等），也不去碰别人的在途文件。
   缺的是属主补那一个闭合标签。
6. **`src/keymapBindings.ts:111` 的 TS2322**（`'"alt"' is not assignable to '"ctrl" | "mod"'`）
   仍在：保留文件、别桶在途，基线 `.tmp-tsc.txt` 里同一条，本桶无权改。

