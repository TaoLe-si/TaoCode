# 桶 12b（接手）· 调试器悬停快速求值 + 名下两条整文件红 —— 2026-10-06

接手状态：上一个「调试器」代理撞到 150 次调用上限，断在「写主交付物 —— 带真实工具栏的悬停快速求值装配」那一刻。
本轮：先修我名下两条整文件加载失败，再把悬停求值那条链**真的接通**（装配层代码上一轮已写完，但整条编辑器模块图在运行时炸 + 两处真实缺陷 + 门禁钉的是过时形状）。

上游源码根：`D:/Backup/Downloads/intellij-community-master/intellij-community-master`。

---

## 0. 先修红：两条整文件加载失败的**根因**

`node --test tests/debug-inline-values.test.mjs tests/debug-inline-watch-wiring.test.mjs`
→ 两个文件各 ~250 ms 整文件红，报的是同一句：

```
file:///D:/TaoCode/src/editorDebugLine.ts:259
ReferenceError: runToCursorGutterExtension is not defined
```

**四条系统性禁令都不是原因**（`find-param-props` / `find-ts-in-mjs` / `find-missing-ext` 三条检测器改前改后都跑过，全 0 命中；测试文件是纯 JS；块注释里没有裸 `/*`）。
真因是上一轮那个代理**改到一半就断了**，留下三处「用了但没引 / 声明顺序不对」，全在 `src/editorDebugLine.ts`：

| # | 位置（改前） | 问题 | 后果 |
|---|---|---|---|
| 1 | `src/editorDebugLine.ts:258-266` | `debugLineExtension` 里调 `runToCursorGutterExtension(...)`，但**文件头没有这条 import**；`src/dbgRunToCursorGutter.ts` 写完了却全仓零引用（孤儿模块） | 模块求值即 `ReferenceError` ⇒ 凡是 import 本文件的测试**整文件红** |
| 2 | 同数组里 `currentPath: () => dapState.currentLocation?.path ?? ''` | `dapState` 同样没 import；而且让这一层直接依赖 `bridge.ts`（文件头明写「只 import 编辑器/规则模块」） | 第 1 条挡住后才轮到它 |
| 3 | `scrollToCenterExtension` 声明在 `debugLineExtension` **之后**（改前 `:274` vs `:258`） | `debugLineExtension` 是模块求值时构造的数组字面量，引用后声明的 `const` ⇒ TDZ | 只补 import 会在这一步再红一次 |

**before → after**

| 命令 | before | after |
|---|---|---|
| `node --test tests/debug-inline-values.test.mjs tests/debug-inline-watch-wiring.test.mjs` | **0 / 2 文件**（14 条用例没跑） | **14 / 14** |
| `node --test tests/debug-*.test.mjs tests/dbg-*.test.mjs`（调试族全量） | 3 个文件红（上面两个 + `debug-quick-evaluate` 消费链 1 条断言红） | **152 / 152** |
| `node .tools/find-orphan-modules.mjs --gate` | `src/dbgRunToCursorGutter.ts` 零消费方（被我修的那条 import 接上了） | 我名下孤儿 0 新增（`src/debugWindowPolicy.ts` 登记进基线并写明原因） |

修法（不动保留文件）：
- `src/editorDebugLine.ts`：补 `import { runToCursorGutterExtension } from './dbgRunToCursorGutter.ts'`、`import { debuggerExtras } from './debugSettingsStore.ts'`；`scrollToCenterExtension` 整块**提到** `debugLineExtension` 之前（`:261` vs `:283`，并在注释里写清「顺序不能挪回去：TDZ」）；数组里去掉 `currentPath` 实参。
- `src/dbgRunToCursorGutter.ts:113-131`：`RunToCursorGutterOptions.currentPath` 改成**可选**，新增导出 `runToCursorCurrentPath()` 作默认（`dapState.currentLocation?.path ?? ''`）—— 路径口径落在本来就 `import { dapState } from './bridge.ts'` 的那一层，`editorDebugLine.ts` 保持不直接碰 bridge。

---

## 1. 主交付物：编辑器悬停快速求值 —— 到底断在哪一环

**先读现状的结论**（不是猜，逐条核对过）：规则层 `src/debugQuickEvaluate.ts` 齐；装配层 `src/quickEvaluateHint.ts` 的**工具栏渲染、会话探针、节流都已经在代码里**了；宿主 `src/components/CodeEditor.vue` 甚至已经 import（`:57`）＋建实例（`:63`）＋挂进**常驻**扩展数组（`:951`）。所以「差真实工具栏渲染 / 差会话可用性探针 / 差节流」这三样**一样都不缺**。

真正断的是四处：

1. **整条编辑器模块图在运行时炸**（就是第 0 节那个红）。`CodeEditor.vue` 同时 import `editorDebugLine` 和 `quickEvaluateHint`，前者在模块求值期抛 `ReferenceError` ⇒ 打包后浏览器里整个编辑器起不来 ⇒ 悬停求值「写完了但一次都没机会跑」。这是最主要的断点。
2. **门禁钉的是过时形状**：`tests/debug-quick-evaluate.test.mjs:96,101` 断言 `dapEvaluate(word, 'hover'` / `shouldRepaintValue(lastValue, value)`，实现里变量早已改名 ⇒ 消费链那条红。按 playbook 第 7 条「修对了却变红 ⇒ 改测试，断言体守意图」订正，并把该条从「钉住工具条**没被**消费」（上一轮的状态，与本轮交付物直接冲突）**翻成**「工具条四条必须经规则层过滤后才渲染、动作必须真发 DAP 请求」（+19 条静态判据，含反向验证）。
3. **「同值不重画」比错了边界**（真实缺陷）：`lastValue` 是模块级一份、且从不作废 ⇒ 上游 `preventDoubleExecution` 的语义（`XDebuggerTextPopup.java:127-140`，`lastFullValueHashCode` 随每次 `show()` 新建）被做成了「全局只画一次」：连着悬停两个值都是 `0` 的变量时，**第二个永远不弹**；鼠标移开再悬停同一个变量也不弹。
   改后：`src/quickEvaluateHint.ts:122`（`QuickEvaluateDisplay` 形状）、`:138` `lastShownText(last, expression)` 纯函数（同一次展示 + 同一个表达式才复用文本）、`:232` 调用、`:389` 写回后作废、`:467` 弹层 `destroy` 作废。
4. **弹层工具条的三条快捷键点不动**（真实缺陷，也是「带真实工具栏的装配」那句里真正没做完的部分）：`buildPanel` 把 `keydown` 挂在**弹层自己的 DOM** 上，而 hover tooltip 在值形态下没有焦点宿主（`XDebuggerTextPopup.java:169-172` 的上游前提是 popup `setRequestFocus(true)`）⇒ F2 永远进不了改值；改值态的 Ctrl+Enter 还会被 CodeMirror 自己的 `keymap`（Ctrl-Enter 默认插换行）抢掉。
   改后：`:409-432` —— `quickEvaluateKeyAction`（`:151`，形态互斥的纯函数，等价上游 `shouldBeVisible` `:286-290`）+ 挂在 `view.dom` 的**捕获阶段**（冒泡阶段的 `stopPropagation` 拦不住同一节点上的另一个监听器）+ 弹层自身（`src/completionUi.ts:239` 的 `tooltips({ parent: document.body })` 那条链在 `lspExtensions()` 里，开着时弹层不在编辑器子树内、键事件不路过 `view.dom`）+ `:462-468` 收起时两处都摘。

**端到端结论**：`CodeEditor.vue` 常驻扩展 → `createQuickEvaluateHint`（`src/quickEvaluateHint.ts:204`）→ `hoverHintKind`（只有无修饰 / Alt 两档出提示）→ `expressionAtPosition`（Alt + 手动选区求选区）→ `isSideEffectFree`（普通悬停不求值有副作用的表达式）→ `quickEvaluateDecision`（`showTooltip` / 会话探针 / `supportsEvaluateForHovers` / 词非空，四道门各带回绝原因）→ `lookupDelayFor`（上游 700 ms `XDebuggerSettingsManager.java:21`，已有提示在显示时 `max(100, delay)`）→ `viewportUnchanged`（到点比可视区域）→ `nonce` 过期丢弃 → `dapStackTrace` 栈顶帧 + `dapEvaluate(expression,'hover',frameId)` → `lastShownText`+`shouldRepaintValue` → `buildPanel`：值文本 + `visibleToolbarModes` 过滤后的**真工具条**（显示为对象 / 进入改值 F2 / 设置文本值 Ctrl+Enter / 取消改值 Esc）+ `dapVariables` 懒加载树 + `dapSetExpression` 写回。
**链路本身静态与单元级全绿；浏览器里的手感（真鼠标悬停、弹层遮挡、输入器焦点）无法核**（见「做不到」）。
顺带订正一条：`QuickEvaluateHintPorts.path` 是上一轮留的**死字段**（DAP `evaluate` 只要 `expression + frameId`），改成可选并在注释里写清「留着只因为 `CodeEditor.vue:63` 已经传了」。

---

## 2. 族判词表（上游 = 相对路径:行号；本仓 = 文件:行号）

| 族 | 项 | 判定 | 上游依据 | 本仓落点 | 说明 |
|---|---|---|---|---|---|
| dbg/evaluate | 悬停值提示（QuickEvaluateHandler 四口） | **本轮接通** | `platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/evaluate/quick/common/QuickEvaluateHandler.java:17-31`；`platform/xdebugger-impl/frontend/src/com/intellij/platform/debugger/impl/frontend/evaluate/quick/XQuickEvaluateHandler.kt:41-44`（`isEnabled` = 有求值器） | `src/debugQuickEvaluate.ts:59`（`quickEvaluateDecision`）；`src/quickEvaluateHint.ts:52`（会话探针 = `dapState.paused`）、`:204-217` | 上游有 PSI，本仓没有 ⇒ 入参是光标处的词；差异写在 `src/debugQuickEvaluate.ts:22-25` |
| dbg/evaluate | 悬停类型 / 副作用门 | 已做（上一轮） | `.../quick/common/AbstractValueHint.java:460-469`；`XQuickEvaluateHandler.kt:74-84`、`:70-73` | `src/debugQuickEvaluate.ts:177`（`hoverHintKind`）、`:184`（`allowsSideEffects`）、`:194`（`isSideEffectFree`）；`src/quickEvaluateHint.ts:88`（`wordAtPosition`）、`:104`（`expressionAtPosition`） | 无 PSI 版按词形判调用 ⇒ 普通悬停不求 `foo()` |
| dbg/evaluate | 查值延迟 / 已有提示时 `max(100, delay)` | 已做（上一轮） | `platform/xdebugger-impl/ui/src/com/intellij/platform/debugger/impl/ui/evaluate/quick/common/ValueLookupManager.java:143-149`；`platform/xdebugger-api/src/com/intellij/xdebugger/settings/XDebuggerSettingsManager.java:21`（700） | `src/debugQuickEvaluate.ts:205`（`lookupDelayFor`）、`:28`（`DEFAULT_VALUE_LOOKUP_DELAY`）；`src/quickEvaluateHint.ts:220` | 同文件 `:127-141` 的可视区域判据 → `:214` `viewportUnchanged` |
| dbg/evaluate | 弹层尺寸上下限 | 已做（上一轮） | `XDebuggerTextPopup.java:62-66`（650/400/170/100/余量 30）、`:292-306`（夹在屏幕 1/2 与 1/5、1/7 之间） | `src/debugQuickEvaluate.ts:31-35`、`:86`（`quickEvaluatePopupSize`）；`src/quickEvaluateHint.ts:452` | 屏幕极小 ⇒ `clamp` 以 low 为准（`:106-111`） |
| dbg/evaluate | **带真实工具栏的弹层**（本轮主交付物） | **本轮接通** | `XDebuggerTextPopup.java:249-256`（四条顺序）、`:286-290`（`shouldBeVisible` 互斥）、`:308-321`+`:354-357`/`:398-401`（`canSetTextValue` ⇒ `setEnabledAndVisible`） | `src/debugQuickEvaluate.ts:134`（`QUICK_EVALUATE_TOOLBAR`）、`:245`（`visibleToolbarModes`）、`:253`（`toolbarItem`）、`:269`（`canSetTextValue`）；`src/quickEvaluateHint.ts:289-320`（`buildPanel`/`renderToolbar`） | 只画点得动的：「显示为对象」要 `variablesReference > 0`，改值两格要 `supportsSetExpression` + 字符串形态 |
| dbg/evaluate | 快捷键 F2 / Ctrl+Enter / Esc | **本轮修好** | `XDebuggerTextPopup.java:394`（F2）、`:349`（Ctrl+Enter）、`:418`（Esc）、`:169-172`（popup 自己抢焦点） | `src/quickEvaluateHint.ts:151`（`quickEvaluateKeyAction`）、`:409-432`（`view.dom` 捕获 + 弹层自身）、`:462-468`（收起即摘） | 差异：本仓 tooltip 没有焦点宿主 ⇒ 不抢编辑器焦点；焦点在调试面板等处时这三条不生效 |
| dbg/evaluate | 「显示为对象」= 树形态 | 已做（上一轮） | `XDebuggerTextPopup.java:329-344` + `:266-268`（`showTreePopup`） | `src/quickEvaluateHint.ts:324-334`、`:345-361`（`dapVariables` 逐层懒加载 + 展开按钮） | 本仓就地换内容，不新开 popup |
| dbg/evaluate | 改值写回 | 已做（上一轮） | `XDebuggerTextPopup.java:365-381`；`java/debugger/shared/src/com/intellij/java/debugger/impl/shared/engine/JavaValueTextModificationPreparator.kt:14-16`；`java/debugger/shared/src/com/intellij/java/debugger/impl/shared/SharedDebuggerUtils.java:29-34`（主代理订正：原写 `java-debugger-core/src/com/intellij/debugger/actions/` 与 `shared/src/com/intellij/debugger/` 这两个目录在参考树里不存在，按名搜到真实位置后替换；行区间本来就对——`:14-16` 是 `convertToJavaStringLiteral`，`:29-34` 是 `translateStringValue`） | `src/debugQuickEvaluate.ts:282`（`convertToStringLiteral`）、`:307`（`editableTextOf`）、`:326`（`toolbarTransition`）；`src/quickEvaluateHint.ts:379-395`（`dapSetExpression`） | 写回失败：上游收弹层 + 错误对话框，本仓写在弹层同一行（差异记在 `src/quickEvaluateHint.ts:22-24`） |
| dbg/evaluate | 快速求值仍缺的 | **不渲染**（不放假控件） | `XDebuggerTextPopup.java:175-180`（非改值态 Esc = 收起 popup） | `src/quickEvaluateHint.ts:151-158`（`quickEvaluateKeyAction` 对非改值态 Esc 返回 `null`） | CodeMirror 的 hover tooltip 没有程序化关闭通道；已记为差异 |
| dbg/settings | `valueLookupDelay` / `valueTooltipAutoShow` 有消费者 + 有格子 | **本轮** | `platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/settings/DataViewsConfigurableUi.kt:47-56`（checkbox + 延迟输入框，`.enabledIf(showTooltip.selected)`）；`.../settings/XDebuggerDataViewSettings.java:26`；`platform/util/resources/misc/registry.properties:609` | `src/debugSettingsStore.ts:41-43`（两格）、`:174`（`valueTooltipOptions`）；`src/quickEvaluateHint.ts:206`（每次悬停现读一次）；`src/components/DebuggerSettingsPage.vue:63-67`（关闭提示时延迟格 `:disabled`） | 上游那条的「`.enabledIf`」也照搬了 |
| dbg/settings | `scrollToCenter` | **本轮**（上一轮只有消费者） | `XDebuggerGeneralSettings.java:16`（默认 false）；`ExecutionPointHighlighter.java:88-90` | `src/editorDebugLine.ts:261-281`（消费者，`{y:'center'|'nearest'}`）、`:23`（import）；设置格 `src/components/DebuggerSettingsPage.vue:69` | 上一轮这条消费者已经写好，但整模块加载不了 ⇒ 从不执行；本轮随修红生效 |
| dbg/settings | `runToCursorGestureEnabled` | **本轮**（上一轮只有消费者） | `XDebuggerGeneralSettings.java:18`（默认 **true**）；`platform/xdebugger-impl/src/com/intellij/xdebugger/impl/XDebuggerManagerImpl.java:439-517`（`:450` `LINE_NUMBERS_AREA`、`:453` 设置门、`:516` `runToPosition`） | `src/dbgRunToCursorGutter.ts:132-173`（扩展）、`:96-111`（`gotoTargets`+`goto`）；挂点 `src/editorDebugLine.ts:283-291`；设置格 `src/components/DebuggerSettingsPage.vue:71` | 上一轮这个模块**全仓零引用** ⇒ 手势根本不存在；本轮接进 `debugLineExtension` |
| dbg/settings | 这几格改完要留得住 | **本轮** | `XDebuggerSettingManagerImpl.java:28`（`debugger.xml` 是应用级存储） | `src/debugSettingsStore.ts:135-171`（`browserExtrasStore` + `attachDebuggerExtrasPersistence`：加载即读盘、改一格即落盘） | 不用改 `App.vue`；`new` 的存储不可用时静默降级（判据在 `tests/dbg-hover-value-edit.test.mjs` 最后两条） |
| dbg/settings | 仍缺的两格 | **不渲染** | `XDebuggerGeneralSettings.java:14-15`（`hideDebuggerOnProcessTermination` / `myShowDebuggerOnBreakpoint`）；`XDebugSessionTab.java:650-663`、`:318-326` | 规则与本仓策略在 `src/debugWindowPolicy.ts`（孤儿，已登记基线）；宿主在保留文件 `src/App.vue` | ⇒ 接线请求 W1；挂上前不提供开关（勾了没反应就是假控件） |
| dbg/inline | 行内监视就地编辑（`dbg/inline` 缺③） | 已做（上一轮，判词是旧的） | `platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/inline/XDebuggerTreeInlayPopup.java:53-61`（InlineWatchNode ⇒ 挂 Edit）、`:107-118`（`showInplaceEditor`）；`InlineWatchInplaceEditor.java:49-56` | `src/editorDebugLine.ts:116-138`（提交通道 / 判据）、`:153-193`（逐条可点 + 输入框，Enter 提交、Esc 还原） | 没注册通道时 `canEditInlineWatch()` 为假 ⇒ 不给点击态，不做点不动的行内项 |
| dbg/frames-vars | 缺①引用查询 / 缺②跳类型源码 | **不做**（架构性） | `ShowReferringObjectsAction`（`XReferrersProvider`）、`XJumpToTypeSourceAction` | —— | DAP 没有这两个请求；`src/bridge.ts` 的 Method union 本轮冻结 |
| dbg/frames-vars | 缺③独立值检查窗口 | **上一轮已做**（判词过时） | `XInspectAction` | `src/components/DebugInspectWindow.vue`；判据 `tests/debug-inspect-window.test.mjs` | 判词那句「独立对话框未做」已经不准 |
| dbg/frames-vars | 缺④剪贴板对比 / 监视分组 | 部分已做 | `XCompareWithClipboardAction`；`XWatchesTree` 的组节点 | 对比：`src/debugCompareClipboard.ts` + `src/components/DebugClipboardCompare.vue`（判据 `tests/debug-compare-clipboard.test.mjs`）；**监视分组仍缺** | 监视列表的分组节点没有可落的面板（`DebugPanel.vue` 的监视区与 `src/debugWatches.ts` 只存表达式文本） |
| dbg/attach | 缺①进程列表与筛选 | **不做**（宿主没通道） | `AttachToProcessDialog`（PID/用户/可执行/命令行四列 + Show only my processes） | —— | `native/main.cpp` 分派表里没有系统进程枚举方法（`run.instances` 只列本仓启动的实例，`native/run_host.cpp` 的 descendant_processes 只走自己那棵树），且 `native/main.cpp`/`src/bridge.ts` 冻结 |
| dbg/attach | 缺②多 host / 缺③多会话 | **不做**（本仓架构） | `XAttachHostProvider`（Local/WSL/Remote）、`AttachDialogDebuggersFilter`、`XDebugSession` | 本仓一次一个调试会话（`src/bridge.ts:497` 的 `dapState` 是单例） | 不是「没画」，是宿主只有一个会话槽 |
| dbg/actions | 缺①强制单步 / Smart Step Into | **不做**（协议面冻结） | `ForceStepOverAction`/`ForceStepIntoAction`/`SmartStepIntoAction`（`stepInTargets`） | 既有：`src/keymap.ts` F9/F8/F7/Shift+F8/Alt+F9、`src/dbgRunToCursorGutter.ts` 的 `gotoTargets`+`goto` | 需要新 DAP 请求 + `src/bridge.ts` Method union + `native/main.cpp` 分派表，两处本轮都冻结 |
| dbg/actions | 缺②线程冻结 ③MarkObject ④PauseOutput | **不做**（JDI 专属） | `FreezeActiveThreadAction`/`ThawAllThreadsAction`、`MarkObjectAction`、`PauseOutputAction` | —— | DAP 没有挂起单个线程 / 对象着色 / 输出暂停的请求；没有请求支撑的按钮一律不渲染 |
| dbg/breakpoints | 缺①逻辑断点组 | 仍缺（宿主） | `XBreakpointGroup`/`XBreakpointCustomGroupingRule` | `src/breakpointGroups.ts`（按文件分组已有）；写入口在 `src/App.vue` | ⇒ 接线请求 W2（与 `hideDebuggerOnProcessTermination` 同一批） |
| dbg/breakpoints | 缺③临时/依赖不随项目保存 | **已做**（判词过时） | `XBreakpointProperties` 随断点持久化 | `src/debugBreakpointExtras.ts:88-176`（按项目根的 extras 存盘）+ `src/components/DebugBreakpointsPane.vue`（`saveBreakpointExtras` 的 `watch`） | 判词那句已经不准 |

`docs/inventory/verdict-xdebugger.md` 是 `scripts/verdict_table.py` 的生成物（文件头写着不要手改），本轮**没有**改它；上面标了「判词过时」的行是给桶 8 / 主代理改 `FAMILIES` 表用的输入（playbook 第 9 条：要改判词去改脚本表再重新生成）。

---

## 3. 改动文件

| 文件 | 类型 | 要点 |
|---|---|---|
| `src/editorDebugLine.ts` | 修改 | 修红三处（补 import、`scrollToCenterExtension` 前置、去掉数组里的 `dapState`）；文件头的分层声明订正 |
| `src/dbgRunToCursorGutter.ts` | 修改 | `currentPath` 改可选 + 新增 `runToCursorCurrentPath()`（把 bridge 依赖收在本层） |
| `src/quickEvaluateHint.ts` | 修改 | 同值不重画的边界订正（`QuickEvaluateDisplay`/`lastShownText`/`destroy` 作废）、快捷键（`quickEvaluateKeyAction` + `view.dom` 捕获 + 弹层自身 + 收起双摘）、`ports.path` 改可选、模块头补两条如实差异 |
| `src/debugSettingsStore.ts` | 修改 | `browserExtrasStore()` + `attachDebuggerExtrasPersistence()`（读盘 + `watch` 落盘，模块加载即接）、`patchDebuggerExtras` 缺省存储 |
| `src/components/DebuggerSettingsPage.vue` | 修改 | 新增第二个 fieldset：悬停值提示 + 查值延迟（关闭时禁用延迟格，照 `DataViewsConfigurableUi.kt:56`）、滚动居中、装订线手势；文件头逐条写上游坐标 + **故意不渲染的两格**及理由 |
| `tests/debug-quick-evaluate.test.mjs` | 修改 | 订正两条过时正则；消费链从「钉住工具条没被消费」翻成「钉住工具条/树/改值/节流/快捷键真被消费」（+19 条） |
| `tests/dbg-hover-value-edit.test.mjs` | 新增 | 12 条：`lastShownText`（含本轮修的缺陷）、`quickEvaluateKeyAction` 全矩阵 + 与 `visibleToolbarModes` 的互检（不出现「有键没按钮」）、词/选区切词、`convertToStringLiteral`⇄`editableTextOf` 往返、`canSetTextValue` 两道门、形态转移表、延迟兜底、设置格持久化、localStorage 自我接线 |
| `.tools/orphan-baseline.txt` | 修改 | 登记 `src/debugWindowPolicy.ts` 一行 + 理由（缺 `App.vue` 宿主，指向 W1）；**只加我自己那一个** |
| `docs/batch-2026-10-06-bucket12b.md` / `docs/wiring-requests-2026-10-06-bucket12b.md` | 新增 | 本报告 + 接线请求 |

---

## 4. 验证

```
node --test tests/debug-inline-values.test.mjs tests/debug-inline-watch-wiring.test.mjs   → 14 / 14（改前 0 / 2 文件）
node --test tests/debug-*.test.mjs tests/dbg-*.test.mjs                                   → 152 / 152
node --test tests/module-size.test.mjs                                                     → 5 / 5
node --test tests/source-citations.test.mjs                                                → 3 / 3（本报告新增的上游坐标都核得过）
npx vue-tsc -b --force                                                                     → exit 0
node .tools/find-param-props.mjs   → 0 处   /  node .tools/find-ts-in-mjs.mjs → 干净   /  node .tools/find-missing-ext.mjs → 干净
node --input-type=module -e "await import('./src/<file>.ts')"  → editorDebugLine / dbgRunToCursorGutter / debugSettingsStore /
    quickEvaluateHint / debugQuickEvaluate 全部加载成功（这条才是「值 import 必须带 .ts」的真判据）
node .tools/find-orphan-modules.mjs --gate → 我名下 0 新增孤儿；门禁整体仍红 3 个（editorCodeBlock / editorJoinComments /
    externalSystemDataStorage，都不在我名下，没动）
```

**新门禁的反向验证**（三处，逐条故意造违规、确认变红、再撤掉）：
1. `lastShownText` 去掉「同一个表达式」判据 ⇒ `tests/dbg-hover-value-edit.test.mjs` 的「同值不重画只在…」变红。
2. 快捷键从 `view.dom` 捕获退回只挂弹层 ⇒ `tests/debug-quick-evaluate.test.mjs` 消费链变红（`快捷键没挂到编辑器根节点`）。
3. 删掉弹层自己那条监听 ⇒ 红（`改值输入器里的快捷键没挂`）。

行数（上限 900，没调过任何上限）：`src/quickEvaluateHint.ts` 470、`src/editorDebugLine.ts` 314、`src/dbgRunToCursorGutter.ts` 174、`src/debugSettingsStore.ts` 176、`src/components/DebuggerSettingsPage.vue` 74、`tests/dbg-hover-value-edit.test.mjs` 186。
**本轮零 native 改动**（`native/dap*.cpp` 一行没动）⇒ 无新增 ctest 需求。

---

## 5. 做不到 / 无法核实

1. **浏览器里的真实悬停手感无法核**：没有获准启动 GUI，也没有 DOM 测试框架（`tests/` 全是 node 直跑）。已核到：source 全部分支的单测、扩展数组里的挂载位置（逐行读过 `CodeEditor.vue:57/63/951`）、以及 `@codemirror/view` 的实现细节（`hoverTooltip` 的 `showTooltip` facet `enables: [tooltipPlugin, baseTheme]` ⇒ **不依赖** `completionUi` 那条 `tooltips()` 也一定有容器；`tooltipConfig.combine` 取第一个带 `parent` 的配置 ⇒ 两处 `tooltips()` 不冲突）。**没核**：弹层实际位置/遮挡、输入器焦点切换、`document.body` 宿主下快捷键的两条监听是否真的不重复触发（按 DOM 捕获阶段规范推的，没有跑过浏览器）。
2. **非改值态的 Esc 收起弹层**：上游 `XDebuggerTextPopup.java:169-183` 靠 popup 自己的 close request。CodeMirror 的 hover tooltip 只有 `hideOnChange`/`hideOn`/`closeHoverTooltip`（后者要求从键位/action 里拿到 `hoverTooltip` 返回对象的 `active`），而本仓弹层的键位宿主就是编辑器 ⇒ 要做得改 `CodeEditor.vue` 的键位表（保留文件）。现在按「不拦」处理并记在 `src/quickEvaluateHint.ts:127-134` 与 `quickEvaluateKeyAction` 里。
3. **`autoExpressions`（`XDebuggerDataViewSettings.java:25`）不渲染**：上游那份 UI（`DataViewsConfigurableUi.kt:38`）只负责存它，真正的行为消费在语言插件的 Variables 视图（编辑器选中表达式自动进监视）。本仓监视项是面板显式加的 ⇒ 勾了什么都不发生的复选框就是假控件。要真做需要接 `src/components/DebugPanel.vue` 的选区通道 + `src/debugWatches.ts`（两个文件都在我名下，不是卡点）；**这是明确的不做**（本轮把剩余调用花在悬停族上），不是无法核实。
4. **`hideDebuggerOnProcessTermination` / `showDebuggerOnBreakpoint` 两格**：判据与策略都在 `src/debugWindowPolicy.ts`，但工具窗口 `toFront` / 收起只有 `src/App.vue`（保留文件，余量 35 行）能做 ⇒ 接线请求 W1；W1 之前那两格故意不进设置页。
5. **附加进程列表**（`dbg/attach` 缺①）：`native/main.cpp` 分派表没有系统进程枚举方法，而 `native/main.cpp` 与 `src/bridge.ts` 本轮冻结 ⇒ 属于「宿主没有数据」，不是「没画 UI」。
6. **Smart Step Into / 强制单步**（`dbg/actions` 缺①）：需要 DAP `stepInTargets` + `stepIn(targetId)` 与新的 Method 名，两处协议面都冻结 ⇒ 面板里没有这两格按钮。
7. **逻辑断点组 / 监视分组 / 引用查询 / 跳类型源码**：分别卡在断点写入口过 `App.vue`（W2）、面板监视区只有表达式文本一列、DAP 没有对应请求 ⇒ 全部保持不渲染。
8. **`verdict-xdebugger.md` 的判词没有更新**：它是生成物（`python scripts/verdict_table.py xdebugger`），改它要动 `scripts/verdict_table.py` 的 `FAMILIES` 表并重生成 `.json`（`tests/verdict-generated.test.mjs` 会核）。本轮只在 §2 里给出「判词过时 / 本轮已补」的逐行输入，没自己去动那张共享表。
