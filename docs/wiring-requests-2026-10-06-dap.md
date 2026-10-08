# 接线请求 · 桶 12（调试器 / 断点下发）2026-10-06 · 代号 dap

给主代理。**本轮一行保留文件都没改**：`src/App.vue`、`src/bridge*.ts`、`src/keymap*.ts`、`src/settingsModel.ts`、
`src/problemsView.ts`、`src/terminal*`、`src/vcs*`、`native/git*.cpp`、`native/settings_schema.*`、
`tests/module-size.test.mjs`、`tests/source-citations.test.mjs`、`CMakeLists.txt`、`package.json`、`tsconfig.json`
全部只读。本轮零 native 改动 ⇒ 不需要跑 ctest、没有要登记的新 `native/*.cpp`。

`src/App.vue` 现状：**2649 行**。下面 D1 净 **+5 行**（删 1 行、加 6 行注释与代码），不会顶破上限。

---

## D1 · `src/App.vue:1022-1036` —— 装订线切断点改走唯一下发口（并顺手去掉裸 `dapSetBreakpoints`）

- **为什么需要**：`src/dbgBreakpointUpdate.ts` 的注释与判据都写着「装订线切换 = `{ now: true }` 那一档」
  （`src/components/DebugBreakpointsPane.vue:117` 那句「后者见接线请求 docs/wiring-requests-2026-10-06-dap.md 的 D1」
  就是指向本文），但装订线到现在还是自己裸发：`src/App.vue:1034` 直接 `dapSetBreakpoints(path, next)`。
  后果不是「不生效」，是**两套口径**：

  1. 面板/对话框那一侧会扣掉「被依赖挡住的」「用户在断点树上取消勾选的」那几条
     （`breakpointFileSend` → `breakpointRefSendable`，`src/dbgBreakpointUpdate.ts:108-128`）；
     装订线那条路什么都不扣 ⇒ 在装订线上点一下**别处**的断点，就会把「刚被依赖挡住/刚被取消勾选」的那条
     重新发给适配器（册子里记的也一起被 `dapSetBreakpoints` 覆盖成"全发"）。
  2. 装订线这一发不进合并队列 ⇒ `DebugPanel.vue:210/248/258` 与 `src/dbgRunToCursorGutter.ts:105` 的
     「恢复执行前先 `flush()`」对它没有意义（它本来就没排队），而它自己也没有「冲掉别人窗里那份」这一手 ——
     上游按装订线 = `updateBreakpointNow` = queue + `sendFlush()`，是**会**把别人窗里那份一起带出去的
     （`platform/xdebugger-impl/frontend/src/com/intellij/platform/debugger/impl/frontend/FrontendXLineBreakpointVisualizationManager.kt:291-294`）。

- **上游依据**：同上面 `:291-294`（`updateBreakpointNow`，`:290` 的注释原文点名 "good for sync updates like
  enable/disable or create new breakpoint"）与 `:281-288`（`breakpointChanged` 的分岔）。
  DAP 侧没有「一条断点一个 handler」，`setBreakpoints` 是按文件整份重建 ⇒ 走的必须是同一个口。

- **要加什么（可照抄的整段替换）**：目标 `src/App.vue:1034`（`toggleBreakpointAt` 里那一行 `try { await dapSetBreakpoints(path, next) }`
  连同它的 `catch`，即 `:1034-1035`），替换成：

  ```ts
  // 装订线那一下 = 上游 `updateBreakpointNow`（FrontendXLineBreakpointVisualizationManager.kt:291-294）：
  // 不等合并窗，且把别的文件窗里正在合并的那份一起冲出去（`sendFlush()` = `restart(0)`）。
  // 前端状态（属性表 / 依赖表 / 已启用依赖 / 静音）由断点区登记给下发口（`provideBreakpointSendRules`），
  // 这里不自己传第二套 —— 传了就会与面板口径分叉。`:1033` 那两行 eager 写册子请留着：装订线的圆点要当场变。
  const round = await breakpointUpdater.queueFile(path, next, { now: true })
  if (round.error) notify(`切换断点失败：${round.error}`, true)
  ```

  import（加在 `src/App.vue:99` 那批 `./dbg*` 旁边）：

  ```ts
  import { breakpointUpdater } from './dbgBreakpointUpdate'
  ```

  并把 `src/App.vue:43` 那长串 import 里的 `dapSetBreakpoints` 去掉（全 `App.vue` 只有 `:1034` 这一处用它，
  换掉之后就是未引用符号）。

- **接线后请顺手跑的判据**：`node --test tests/dbg-breakpoint-update.test.mjs`（本请求落成后，
  我会把「装订线不再裸发」写成一条 `readFileSync('src/App.vue')` 的 `assert.doesNotMatch(/dapSetBreakpoints\(/`，
  现在没写是因为**不许留只过自己测试的死断言**）。
- **不需要新设置格、不需要 native 改动。**

---

## dap3 核对结论（2026-10-06 收尾轮，逐条打开文件核过）

- **D1 = `[x]` 已闭环**（主代理落的）：本仓 `src/App.vue:1051` 现在是
  `const round = await breakpointUpdater.queueFile(path, next, { now: true })`，`:99` 那批 import 里已带 `./dbgBreakpointUpdate`，
  **全文件 `dapSetBreakpoints` 零命中**（`:43` 那长串里的那个也已经去掉）。判据两条都写上了并跑绿：
  `tests/dbg-breakpoint-update.test.mjs` 的 `assert.doesNotMatch(app, /dapSetBreakpoints\(/)` 与
  `assert.match(app, /breakpointUpdater\.queueFile\(path, next, \{ now: true \}\)/)` —— 该文件 28/28。
- **本篇给的锚点已漂**：写的 `src/App.vue:1034` / `:99` / `:43` 是当时的行号，现在是 `:1051`（`toggleBreakpointAt` 末尾）。
  留痕在此，不改上文（改了就没法证明「原写 X、实际 Y」）。上游那条引用
  （`platform/xdebugger-impl/frontend/src/com/intellij/platform/debugger/impl/frontend/FrontendXLineBreakpointVisualizationManager.kt:291-294`）
  dap3 逐行重数过：`:291` 是 `fun updateBreakpointNow(...)`、`:292` queue、`:293` `breakpointUpdateQueue.sendFlush()` ⇒ 成立。
- 本篇「净 +5 行」实际净 +6 行；`src/App.vue` 现 2675 行（上限 2737，仍安全）。
- 剩下的线只有 **T1**（`src/bridge.ts` 的 `logMessage?`）与 **T2**（`round.error` 要不要按 `applied` 分档），
  都在 `docs/wiring-requests-2026-10-06-dap3.md`。

## 处理结果（wiring-backlog lane，2026-10-06）

- **D1 已接线**：`src/App.vue:1110` 已是 `const round = await breakpointUpdater.queueFile(path, next, { now: true })`，import 在 `:107`；全文件 `grep dapSetBreakpoints` 0 命中（裸发已清）。

结论：**零待接**，未改任何文件。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「**零待接**，未改任何文件。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
`src/components/DebugPanel.vue` 的挂载点（`:210/:248/:258`）属**大组件 lane** 独占（本 lane 禁改），需大组件 lane 处理；该文件当前超过 900 行（`tests/module-size.test.mjs` 报「未登记的巨型源文件」），也归大组件 lane 拆分。
