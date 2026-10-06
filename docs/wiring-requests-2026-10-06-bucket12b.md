# 接线请求 · 桶 12b（调试器）2026-10-06

给主代理 / 桶 8。本轮**一行保留文件都没改**（`src/App.vue`、`src/components/CodeEditor.vue`、`src/style.css`、`src/tokens.css`、`src/uiIcons.ts`、`src/settingsModel.ts`、`src/settingsTreeMeta.ts`、`src/bridge*.ts`、`src/keymap*.ts`、`src/actionRegistry.ts`、`src/menus/types.ts`、`native/settings_schema.hpp`、`native/main.cpp`、三个 `*.test.mjs` 门禁与 `CMakeLists.txt` 全部只读）。

**悬停快速求值不需要任何保留文件改动**：宿主早就挂好了，本轮一行没动它 —— `src/components/CodeEditor.vue:57` import、`:63` 建实例、`:951` 进**常驻**扩展数组（不在 `lspExtensions()` 那扇门里，逐行核对过）。
下面 W1/W2 才是需要桶 8 统一做的；W3/W4 是给主代理的记账项，不是保留文件改动。

---

## W1 · `src/App.vue` 第 240 行附近 —— 接调试器工具窗口的显示/隐藏策略（两格设置的宿主）

- **目标文件**：`src/App.vue`，第 240 行那条 `watch(() => dapState.paused, (now, before) => { … tabAlerts.alert(tabAlertKey('debug')) })` 的同一块附近。
  现成 helper：`showOutput(tab)` 在 `:1382`（`bottom.value = true; bottomTab.value = tab; recordActiveToolWindow(tab)`）、`showView` 在 `:1359`、收起底部 dock 就是 `bottom.value = false`（同 `:290`/`:778` 的写法）。
- **要接什么**：`src/debugWindowPolicy.ts` 导出的 `applyDebuggerPause(host, info)` 与 `applyDebuggerTermination(host, hideOnTermination)` 接到两个跳变上：
  ① `dapState.paused` 由 false→true（`info = { reason: dapState.reason, hasTopFrameSource: !!dapState.currentLocation?.path }`）；
  ② `dapState.running` 由 true→false（被调试进程结束）。
  `host` 的三个回调就是现成动作，一行一个：

  ```ts
  import { applyDebuggerPause, applyDebuggerTermination, currentDebuggerWindowPolicy } from './debugWindowPolicy'
  const debuggerWindowHost = {
    bringDebuggerToFront: () => showOutput('debug'),                                   // 上游 toFront(true, null)
    showFramesView: () => showOutput('debug'),                                         // 上游 showView(framesContentId)：本仓的调用堆栈就在 debug 这一页里
    hideDebuggerPage: () => { if (bottomTab.value === 'debug') bottom.value = false },  // 上游 RunContentManager.hideRunContent
  }
  // 现有那行 tabAlerts.alert(...) 请留着（它是「吸引用户」的另一半），策略调用并排加在下面
  watch(() => dapState.paused, (now, before) => { if (now && !before) applyDebuggerPause(debuggerWindowHost, { reason: dapState.reason, hasTopFrameSource: !!dapState.currentLocation?.path }) })
  watch(() => dapState.running, (now, before) => { if (before && !now) applyDebuggerTermination(debuggerWindowHost, currentDebuggerWindowPolicy().hideDebuggerOnProcessTermination) })
  ```
  `applyDebuggerPause` 内部已经按 `pausedByUser` 在本仓的等价判据门控过（`dapState.reason` 里报 `step` ⇒ 用户在单步 ⇒ 不吸引，见 `USER_STEP_REASON`），外面**不要再加** if；两格设置也从 `debuggerExtras` 里读（`currentDebuggerWindowPolicy()`），不要在 App.vue 里写默认值。
- **为什么需要**：`XDebuggerGeneralSettings` 的这两格判据与策略都已写完但**零生产消费方**（`node .tools/find-orphan-modules.mjs --gate` 报的 `src/debugWindowPolicy.ts` 就是它，我已登记进 `.tools/orphan-baseline.txt` 并写明原因）；工具窗口的 `toFront` / 收起只有宿主能做。
  **W1 接上之后请顺手解锁设置页那两格**：`src/components/DebuggerSettingsPage.vue` 文件头已经写好两条 checkbox 的文案与上游坐标，本轮故意没渲染（勾了不生效 = 假控件）。
- **上游依据**：`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/ui/XDebugSessionTab.java:650-663`（`onPause`：`:651-653` 注释「只在事件自己发生时吸引用户，用户在单步时不要」+ `if (!pausedByUser) return;`、`:654-656` `isShowDebuggerOnBreakpoint()` ⇒ `toFront(true, null)`、`:658-662` 拿不到顶帧源码位置 ⇒ `showView(framesContentId)`）；同文件 `:318-326`（进程结束且 `isHideDebuggerOnProcessTermination()` ⇒ `RunContentManager.hideRunContent(debugExecutor, descriptor)`）；两格定义与默认值 `platform/xdebugger-impl/src/com/intellij/xdebugger/impl/settings/XDebuggerGeneralSettings.java:14`（隐藏，默认 false）、`:15`（停在断点时显示，默认 **true**）。

## W2 · `src/App.vue` + `src/components/BreakpointsDialog.vue` —— 逻辑断点组（`XBreakpointGroup`）的写入口

- **目标文件**：`src/App.vue` 的断点弹层挂载与写回那块（现成锚点：`BreakpointsDialog` 的 import 在 `:13`、`breakpointItems` 在 `:1076`、`openBreakpointDetail` 在 `:1077`、`breakpointLocationCache`/`breakpointPlacement` 在 `:219`/`:1062`）。
- **要接什么**：`src/components/BreakpointsDialog.vue`（我名下）目前只有 `close` / `open` 两个 emit，**具名逻辑断点组**（跨文件分组、按组启用/禁用、组的增删改名）需要一个写回通道。两种给法任选：
  ① 在 `App.vue:1076` 那侧加一个 `@update:groups` 处理，把 `src/breakpointGroups.ts` 的组模型接上；或
  ② 授权我在自己名下新建 `src/dbgBreakpointGroups.vue`（`Debug*.vue` 前缀在我名下）+ 一个 emit 面，宿主只挂一行。
- **为什么需要**：判词里 `dbg/breakpoints` 缺① 的唯一卡点就是**写入口在保留文件**；分组规则、按组启停的判据都能完全落在我名下文件里（按文件分组 + 异常断点分组已经做完了）。
- **上游依据**：`platform/xdebugger-api/src/com/intellij/xdebugger/breakpoints/ui/XBreakpointGroup.java:10`（10 = `public abstract class XBreakpointGroup implements Comparable<XBreakpointGroup>`，42 行；**citefix 订正**：原写 `…/breakpoints/XBreakpointGroup.java`，参考树里该类在 `breakpoints/ui/` 包）、`platform/xdebugger-impl/src/com/intellij/xdebugger/impl/breakpoints/XBreakpointManagerImpl.java`（组的存取与按组启停）；~~`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/ui/breakpoints/XBreakpointsPanel.kt`~~ —— 原写的这一条**参考树里没有**（全树 `find -name "XBreakpointsPanel.kt"` = 0 命中，也没有 `xdebugger-impl/ui/` 那层模块），故「组节点在断点树里的渲染」**无法核实**，需要该结论时请另行取证（不在本请求的落点范围内，本仓 `src/breakpoint*.ts` 的分组渲染另有判据）。

## W3 · `scripts/verdict_table.py` 的 `FAMILIES` 表 —— 六条判词需要订正（生成物不能手改）

`docs/inventory/verdict-xdebugger.md` 是 `python scripts/verdict_table.py xdebugger` 的产物（文件头明写不要手改），本轮**没有**碰它。下面这些「缺：」在我接手时就已经不准（逐条都带本仓行号，可直接核），请改表后重新生成 `.json`（`tests/verdict-generated.test.mjs` 读同名文件）：

| 族 | 判词里那条「缺」 | 现在的实情 | 证据 |
|---|---|---|---|
| `dbg/evaluate` | 「缺① 快速求值（悬停出值提示）—— 要编辑器悬停通道 + 后台求值节流，未做」 | **已做**：通道、节流、真工具条、树形态、改值、快捷键全接上 | `src/quickEvaluateHint.ts:151,204-260,289-395,409-432,462-468`；`tests/debug-quick-evaluate.test.mjs`（消费链）、`tests/dbg-hover-value-edit.test.mjs` |
| `dbg/settings` | 「缺② `scrollToCenter` ③ `runToCursorGestureEnabled` ④ `valueLookupDelay`/`autoExpressions`」 | ②③④ 的**延迟格**已做（消费者 + 设置页 + 落盘）；`autoExpressions` 维持不做（无行为消费点，报告第六节第 3 条） | `src/editorDebugLine.ts:261-281`；`src/dbgRunToCursorGutter.ts:132-173`；`src/components/DebuggerSettingsPage.vue:63-71`；`src/debugSettingsStore.ts:135-176` |
| `dbg/inline` | 「缺② … 文档改动后不重锚」「缺③ 行内的就地编辑未做」 | 两条**都已做**（`tr.changes.mapPos` 版 RangeMarker + 点击就地改表达式） | `src/editorDebugLine.ts:196-229`、`:116-193`；`tests/debug-inline-watch-wiring.test.mjs` |
| `dbg/frames-vars` | 「缺③ `XInspectAction` 独立值检查窗口」「缺④ 的 `XCompareWithClipboardAction` 半边」 | 两条**都已做**（监视**分组**那半边仍缺，保留） | `src/components/DebugInspectWindow.vue`、`src/components/DebugClipboardCompare.vue`、`tests/debug-inspect-window.test.mjs`、`tests/debug-compare-clipboard.test.mjs` |
| `dbg/breakpoints` | 「缺③ 临时/依赖是会话级内存态，不随项目保存」 | **已做**：随项目根落 localStorage | `src/components/DebugBreakpointsPane.vue:45-57`；`src/debugBreakpointExtras.ts:88-176` |
| `dbg/attach` `dbg/actions` | 进程列表 / Smart Step Into / 线程冻结等 | **维持不做**：`src/bridge.ts` 的 Method union 与 `native/main.cpp` 分派表本轮冻结；线程冻结是 JDI 挂起模型、DAP 无对应请求 | 判词原文 + 本报告第六节 5-7 条 |

## W4 · 解冻 `src/bridge.ts` / `native/main.cpp` 之后才能做的两条（先记账，本轮不改）

1. **系统进程枚举**（`dbg/attach` 缺①）：上游 `AttachToProcessDialog` 的 PID/用户/可执行/命令行四列 + Show only my processes 需要一个新的 native 查询方法。现状：`run.instances` 只列本仓自己启动的实例、`native/run_host.cpp` 的 descendant_processes 只走自己那棵进程树 ⇒ 面板只能收手输 PID/pipeName（`src/debugAttach.ts` + 最近附加目标已做，判据 `tests/debug-attach-history.test.mjs`）。
2. **`stepInTargets` + `stepIn(targetId)`**（`dbg/actions` 缺①：Smart Step Into / 强制单步）：需要 DAP 的新 Method 名进 `src/bridge.ts` 的请求面（`:756-784` 那一组）与 `native/main.cpp` 分派表。两处都冻结 ⇒ 面板里没有这两格按钮（不放假控件）。
