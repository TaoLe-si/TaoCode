# 接线请求 · 调试域收尾（代号 dapfix）2026-10-06

给主代理。本轮**一行保留文件都没改**：`src/App.vue`、`src/bridge.ts`、`src/components/CodeEditor.vue`、
`native/main.cpp`、`scripts/verdict_table.py`、`src/style.css`、`src/tokens.css`、`src/settingsModel.ts`、
`CMakeLists.txt`、`docs/inventory/*`、`tests/module-size.test.mjs` 全部只读。
**零 native 改动**（`git status --porcelain -- native` 里没有本域名下的文件）⇒ 按规约没跑 ctest。
本轮动过的文件只有 6 个：`src/dapOutputSeverity.ts`、`src/breakpointGroups.ts`、`src/dbgBreakpointUpdate.ts`
+ `tests/dap-output-severity.test.mjs`、`tests/debug-breakpoint-groups.test.mjs`、`tests/dbg-breakpoint-update.test.mjs`。

下面三件是**必须你接**的：R1 在保留文件里；R2/R3 是别的 lane 名下文件在收口期间造成的加载断链，
本轮刻意没动（改它会与那位抢同一份写盘，dap3 遇到同一形状也是这么处理的：`docs/batch-2026-10-06-dap3.md:49`）。

---

## R1 · `src/bridge.ts:236` —— 给 `DapBreakpoint` 补 `logMessage?`（原 12c 的 X3，dap3 转成 T1，仍未落）

- **本轮重新打开核过（不是沿用 dap3 的坐标）**：`src/bridge.ts:236` 现在仍是
  `export interface DapBreakpoint { line: number; condition?: string; hitCondition?: string; verified?: boolean }`。
  缺 `logMessage`，而 native 是整份透传的：`native/dap_shaping.cpp:58-62` 只处理 `output` 事件的
  category/text，断点那一路 `dap.setBreakpoints` 直转适配器；`native/dap.hpp:185` 的 `requested` 注释里带 `logMessage?`。
- **可粘贴的 new**（就替换 `src/bridge.ts:236` 这一行）：

  ```ts
  export interface DapBreakpoint { line: number; condition?: string; hitCondition?: string; logMessage?: string; verified?: boolean }
  ```

- **补上之后可以删的本地投影**（都在调试域名下，你接线后我来删并复跑判据）：
  - `src/dbgBreakpointUpdate.ts:67`：`export type BreakpointPoint = DapBreakpoint & { logMessage?: string }` → 直接 `= DapBreakpoint`；
  - `src/debugBreakpointExtras.ts:202`：`sendableBreakpoints<T extends DapBreakpoint & { logMessage?: string }>` → `T extends DapBreakpoint`；
  - `src/debugBreakpointExtras.ts:211-212` 与 `:233` 那几处 `as { logMessage?: string }` 强制转换一并消失。
- **上游依据（本轮逐行开过参考树）**：日志断点是断点自己的属性 ——
  `platform/xdebugger-impl/src/com/intellij/xdebugger/impl/breakpoints/BreakpointState.java:23` 是
  `private boolean myLogMessage;`、`:25` 是 `private LogExpression myLogExpression;`；
  `platform/xdebugger-api/src/com/intellij/xdebugger/breakpoints/XBreakpoint.java` 只有 66 行（`:21` 接口声明、`:66` 收尾）。
  ⇒ 属协议侧补齐一个字段，不新增行为。
- **判据（接线后我补，不留只过自己测试的死断言）**：`tests/dbg-breakpoint-update.test.mjs` 里加一条
  `assert.doesNotMatch(src/dbgBreakpointUpdate.ts, /& \{ logMessage\?: string \}/)`，
  并让 `tests/debug-breakpoint-extras.test.mjs` 那条 `as { logMessage` 的形状断言反向消失。
- **风险**：字段可选 ⇒ `dapSetBreakpoints` 与 `dapLoadBreakpoints` 的 `DapBreakpoint[]` 原样透传，运行形状不变。

## R2 · `src/commitChecks.ts:471-472` 与 `src/changesMenuActions.ts:4` —— 缺 `.ts` 扩展名 ⇒ 四个提交检查测试文件加载失败

- **现象（本轮实测，收口时又复跑了一遍）**：
  `node --test tests/commit-checks.test.mjs tests/commit-checks-result.test.mjs tests/commit-checks-progress.test.mjs tests/commit-checks-tooltip.test.mjs`
  ⇒ **4 tests / 0 pass / 4 fail**，每条都是文件级 `ERR_MODULE_NOT_FOUND`：
  `Cannot find module 'D:\TaoCode\src\commitScope' imported from D:\TaoCode\src\commitChecks.ts`。
- **根因**：`src/commitChecks.ts:471` `export type { CommitScopeRow } from './commitScope'` 与
  `:472` `import { type CommitScopeRow, expandCommitSelection, normalizeCommitSelection } from './commitScope'`
  少写扩展名；目标 `src/commitScope.ts` **存在**，是 Node 的 ESM 解析器不做扩展名猜测。
  同一形状的第二处：`src/changesMenuActions.ts:4` `from './commitScope'`。
  机器可查：`node .tools/find-missing-ext.mjs` 现在报「**2 处 / 2 个文件**」，两条都是这一族。
- **判定：既不是过时断言、也不是真回归，是别人在途写盘的加载断链。**
  本轮开始时同一条命令是 **68/68 全绿**（`commit-checks*4 + module-size`，见批次报告 §3）；
  `src/commitChecks.ts` 与 `src/commitScope.ts` 在开工时的 `git status` 里都**没出现**，是收口期间那位新写的
  （`git status --porcelain` 现在给 `M src/commitChecks.ts` / `M src/changesMenuActions.ts`，`src/commitScope.ts` 是 `??`）。
- **改成什么**：两处 `'./commitScope'` → `'./commitScope.ts'`（与本仓既有写法一致，dap3 报告 §3 也用同一条工具门）。
- **为什么我没动**：这两份文件正被 preflight 那位改（几分钟内 mtime 变了两次），我改是读-改-写，会与她形成丢更新。
- **判据**：补完之后 `node .tools/find-missing-ext.mjs` 报 **0 处**，
  且 `node --test tests/commit-checks*.test.mjs` 回到 **68/68**（本轮开工基线）。

## R3 · `src/buildContentRoots.ts:25` 的一条假上游路径（非本域，顺路核到）

- **现象**：`node --test tests/source-citations.test.mjs` 那条红报的是这一格：
  `src\buildContentRoots.ts` 里 `jps/bridge/impl/` 那一格下的 `JpsJavaModuleExtensionBridge.kt:43` —— **参考树里没有这个文件**。
  （**故意不带 `platform/…` 全前缀**写这条假路径：本仓的引用门控也收 `docs/**`，
  把我正在批评的假引用写成完整形状，等于替别人再制造一条红 —— 这条口径出自
  `docs/batch-2026-10-06-main.md:289`/`:291`。）
- **本轮自己 `find` 核过真身**：那个类在参考树里只有一处，目录比原文多一段 **`/java`**：
  `…/jps/bridge/impl/java/JpsJavaModuleExtensionBridge.kt`。带全路径的那一行是 `src/buildContentRoots.ts:25`
  （`:118` 那处是裸文件名，门控收不到）。
- **判定**：`src/buildContentRoots.ts` 是 `??`（本会话期间新出现，pvtree5 / roots 那一族的现场），不属调试域 ⇒ 交给属主或你。
- **判据**：那条引用门控自己就拦（补上 `/java` 后 `source-citations.test.mjs` 回到 3/3）。

---

## 本轮已自行落地、**不需要**你接的（只为对账，别重复做）

- **dap3 的 T2（`BreakpointRound.error` 要不要按 `applied` 分档）我按上游甲案做完了**：
  `src/dbgBreakpointUpdate.ts:246-258` 结算处改成 `error`/`result` 都只给载荷主人，
  依据是本轮逐行开过的 `platform/ide-core/src/com/intellij/util/ui/update/MergingUpdateQueue.kt:545`
  （`updatesToReject.forEachGuaranteed(Update::setRejected)`）与 `:574-582` 的 `put`（`:576` remove → `:577` put → `:579` `existing.setProcessed()`）
  ＋ `.../FrontendXLineBreakpointVisualizationManager.kt:296-304`（`callOnUpdate` 挂在 Update 自己身上、在 `run()` 里被叫）。
   ⇒ **`docs/wiring-requests-2026-10-06-dap3.md` 的 T2 可以关掉**（那四处 `round.error` 写点一个字没改，
  行号是 `src/App.vue:1074`、`src/components/DebugBreakpointsPane.vue:135`、`:276`、`:287`、
  `src/components/BreakpointsDialog.vue:129`、`src/dbgBreakpointUpdate.ts:368`）。
- **本轮不需要**新设置格、不需要 native 改动。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R1 已接线**：`src/bridge.ts:236` 已含 `logMessage?: string`。
- **R2（缺 `.ts` 扩展名）** —— 目标 `src/commitChecks.ts:471-472` / `src/changesMenuActions.ts:4`（本 lane 可改面，但属 VCS/commit 域）。登记为待办。
- **R3** —— 非本域。
- 本轮已自行落地项 —— 登记。

结论：R1 已接线；R2 登记。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「R1 已接线；R2 登记。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
