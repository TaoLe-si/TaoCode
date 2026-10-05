# 接线请求 · 桶 12c（调试器收尾半区）2026-10-06

给主代理。**本轮一行保留文件都没改**（`src/App.vue`、`src/components/CodeEditor.vue`、`src/bridge*.ts`、`src/style.css`、`src/tokens.css`、`src/uiIcons.ts`、`src/settingsModel.ts`、`src/settingsTreeMeta.ts`、`src/keymap*.ts`、`src/actionRegistry.ts`、`src/menus/types.ts`、`tests/module-size.test.mjs`、`tests/source-citations.test.mjs`、`CMakeLists.txt`、`package.json`、`tsconfig.json` 全部只读）。
**本轮零 native 改动** ⇒ 没有需要登记的新 `native/*.cpp`，也不需要跑 ctest（`native/dap*.hpp|cpp` 只是被读，没有被写）。

`src/App.vue` 现状：**2708 行**（上限 2737，还能加 29 行）。下面三条各自 ≤3 行，合计 7 行，不会顶破。

---

## X1 · `src/App.vue` 第 1301 行之后 —— 注册「查看断点…」的 opener（一行）

- **目标文件/位置**：`src/App.vue`，`createRunConfigurations({...})` 那次解构的**收尾行 `:1301`**（`const { … breakpointsOpen, openBreakpoints, … } = createRunConfigurations(`，`breakpointsOpen/openBreakpoints` 在 `:1297` 被解构出来，定义本体在 `src/runConfigurations.ts:194`）。就在 `:1301` 下面插。
- **要加什么（可照抄整段）**：

  ```ts
  // 「查看断点…」的打开动作登记给断点区（宿主只这一行；没注册时编辑框里那条 More 链接自己就不渲染）。
  // 上游：`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/ui/BreakpointEditor.java:65-77`
  // —— 断点编辑框里的 `myShowMoreOptionsLink`，文案 = `xbreakpoints.popup.more.label` + `ViewBreakpoints` 的快捷键。
  setBreakpointsDialogOpener(openBreakpoints)
  ```

  import（加在 `src/App.vue` 现有那批 `./dbg*` / `./debug*` import 附近）：

  ```ts
  import { setBreakpointsDialogOpener } from './dbgBreakpointsDialogHost'
  ```

- **为什么需要**：`src/dbgBreakpointsDialogHost.ts` 的三个导出（`setBreakpointsDialogOpener` / `breakpointsDialogAvailable` / `requestBreakpointsDialog`）里，**注册那一半没有任何生产调用方**（逐符号自查：只有 `tests/dbg-*` 在用）。消费侧全都写好了：
  - 断点区「更多选项」按钮 → `src/components/DebugBreakpointsPane.vue:228`（`openBreakpointsDialog()`：没宿主时把话写进行内错误位，不静默失败）；
  - 编辑框里那条链接 → `src/components/DebugBreakpointEditDialog.vue:156`，`v-if="breakpointsDialogAvailable"` ⇒ **现在恒为 false，这一行 UI 根本不出现**（不放假控件，但用户因此永远点不到「查看断点…」的入口）。
  - 对话框本体早就挂在 `src/App.vue:2565`（`<BreakpointsDialog v-if="breakpointsOpen" …>`），只差这一行登记。
- **接线后请顺手解锁**：无设置格需要解锁；`Ctrl+Shift+F8`（`src/debugBreakpointEditor.ts:132 VIEW_BREAKPOINTS_SHORTCUT`，上游就是 `XDebuggerActions.VIEW_BREAKPOINTS`）那条文案已经写进链接的 title，不用改。

## X2 · `src/App.vue` —— 工具窗口显示/隐藏策略的宿主（承接 12b 的 W1，行号已按当前文件重核）

12b 的 `docs/wiring-requests-2026-10-06-bucket12b.md` W1 仍然成立，但它给的锚点是当时的行号；本轮逐条重核后当前行号是：

- `:241` 现有的 `watch(() => dapState.paused, (now, before) => { if (now && !before && bottomTab.value !== 'debug') tabAlerts.alert(tabAlertKey('debug')) })` —— 策略调用并排加在这一行旁边（**alert 那行请留着**，它是「吸引用户」的另一半）。
- `:232` `const bottom = ref(false)`、`:234` `const bottomTab = ref<BottomTabId | ToolWindowId>('output')`、`:1398` `function showOutput(tab) { bottom.value = true; bottomTab.value = tab; … }`（12b 写的 `:1382` 已经漂了）。
- 照抄代码沿用 12b 那段，只有 `debugWindowPolicy` 的三个入口不变：`applyDebuggerPause(host, { reason: dapState.reason, hasTopFrameSource: !!dapState.currentLocation?.path })`、`applyDebuggerTermination(host, currentDebuggerWindowPolicy().hideDebuggerOnProcessTermination)`、`debuggerWindowHost` 的三个回调。
- **判据/上游**：`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/ui/XDebugSessionTab.java:650-663`、同文件 `:318-326`；两格定义 `platform/xdebugger-impl/src/com/intellij/xdebugger/impl/settings/XDebuggerGeneralSettings.java:14-15`（默认 false / **true**）。这三条本轮都**逐行读过参考树**，坐标有效。
- **为什么还需要宿主**：`src/debugWindowPolicy.ts` 的 `applyDebuggerPause`/`applyDebuggerTermination` 至今只有测试消费（本轮零消费方自查表里有这两行）；`src/components/DebuggerSettingsPage.vue` 文件头写明「故意不渲染那两格」，接上才能解锁。

## X3 · `src/bridge.ts` —— 解冻后请给 `DapBreakpoint` 补 `logMessage?`

- **目标**：`src/bridge.ts:236`
  `export interface DapBreakpoint { line: number; condition?: string; hitCondition?: string; verified?: boolean }`
  → 加一个 `logMessage?: string`。
- **为什么**：`logMessage` 是 DAP `setBreakpoints.breakpoints[]` 的标准字段，native 早已透传（`native/dap.hpp:185` 的 `requested` 注释里就带 `logMessage?`；`native/dap_routes.cpp` 的 `dap.setBreakpoints` 直接转给适配器），只有前端接口没有。于是本轮与 12b 都只能在本地做类型投影：
  - `src/dbgBreakpointUpdate.ts:45`（`export type BreakpointPoint = DapBreakpoint & { logMessage?: string }`）
  - `src/debugBreakpointExtras.ts:202`（`sendableBreakpoints<T extends DapBreakpoint & { logMessage?: string }>`）
  补上字段后这两处投影可以删掉，`src/debugBreakpointExtras.ts` 里那几个 `as { logMessage?: string }` 的强制转换也一并消失。
- **上游**：DAP 规范 `SetBreakpointsRequest.arguments.breakpoints SourceBreakpoint { line, condition?, hitCondition?, logMessage? }` —— **IDEA 侧没有对应类**（本仓走的是 DAP 协议，不是 JDI 的 `Breakpoint`），日志断点在上游是断点属性（`XBreakpoint.java:43-56` `isLogMessage`/`setLogExpression`），落到 DAP 就是这个字段。属协议侧补齐。

## X4 · 记账：12b 的「请求 2」与「W2」按实况订正（不需要你写代码）

1. **请求 2 的前提是编的**：本仓没有 `src/dbgBreakpointStore.ts`，`toSourceBreakpoints` 这个符号全仓零命中（`ls src/dbg*` 只有 `dbgBreakpointsDialogHost.ts` / `dbgRunToCursorGutter.ts`）。它引用的三条上游坐标也都不存在（`XDebugProcessBase.java`、`impl/frame/XBreakpoint.java`、`impl/projectView/XTreeRoot.java`、`breakpointMapping`、`myUpdateRequested` —— Glob 按文件名 + 包路径 + 全树 grep 三条路都走过）。
   **实质欠账我按真实存在的上游做完了**：断点下发收成一个口 `src/dbgBreakpointUpdate.ts`（合并 + 全量重发 + 册子维护），面板与「查看断点…」都只走它；`isEnabledByDependency` / `allBreakpointFiles` / `breakpointMarkersOf` / `propertiesForRef` 四个「只有测试消费」的规则函数全部拿到生产消费方；重复实现 `mutePlan`、`enabledBreakpoints` 删掉。详见 `docs/batch-2026-10-06-bucket12c.md` 第 2 节。
2. **W2（逻辑断点组的写入口）也已经不成立**：写入口不在保留文件里，就在本桶名下的 `src/components/BreakpointsDialog.vue`（组节点 + 按组启用/`:128 toggleGroup`、逐条「所在组」下拉 + 新建：`:133 moveToGroup`、默认组走 `@set-default-group` 事件回到面板）与 `src/components/DebugBreakpointsPane.vue`（富编辑里那一格）。**仍缺的是组的改名/删除**——上游 `XBreakpointGroup` 的树节点支持，本仓没做；这条不需要保留文件，是我名下下一轮的活（不卡你）。
