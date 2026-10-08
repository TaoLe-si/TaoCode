# 接线请求 · 桶 12 调试域（dap3 收尾）2026-10-06

给主代理。**本轮一行保留文件都没改**：`src/App.vue`、`src/bridge.ts`、`src/style.css`、`src/tokens.css`、
`src/settingsModel.ts`、`CMakeLists.txt`、`scripts/verdict_table.py`、`docs/inventory/*` 全部只读；
`tests/module-size.test.mjs`、`tests/source-citations.test.mjs` 没读错也没写。零 native 改动 ⇒ 不需要 ctest。

本轮在自己名下降落的三件（判据 + 反向验证数字见 `docs/batch-2026-10-06-dap3.md`）：
断点「新建组」的**取消 ≠ 空名**三态判据、调试控制台「暂停输出」的**可见性**判据、以及两处**假行号订正 + 裸行号门控**。

下面两条是**必须你接**的：T1 在保留文件里；T2 要定口径（改的是四个界面共用的错误上报形状）。

---

## T1 · `src/bridge.ts:236` —— 给 `DapBreakpoint` 补 `logMessage?`（原 12c 的 X3，仍未落）

- **现状（我本轮打开核过）**：`src/bridge.ts:236` 仍是
  `export interface DapBreakpoint { line: number; condition?: string; hitCondition?: string; verified?: boolean }`。
  `logMessage` 是 DAP `setBreakpoints` 请求 `breakpoints[]` 里 `SourceBreakpoint` 的标准字段
  （`{ line, condition?, hitCondition?, logMessage? }`），native 早就整份透传
  （`native/dap.hpp:185` 的 `requested` 注释里就带 `logMessage?`，`dap.setBreakpoints` 直转适配器），**只有前端接口没有**。
- **可粘贴的 new**（就一行，替换 `:236`）：

  ```ts
  export interface DapBreakpoint { line: number; condition?: string; hitCondition?: string; logMessage?: string; verified?: boolean }
  ```

- **补上之后可以删的三处本地投影**（都在本桶名下，你接线后我来删并复跑判据）：
  - `src/dbgBreakpointUpdate.ts:67`：`export type BreakpointPoint = DapBreakpoint & { logMessage?: string }` → 直接 `= DapBreakpoint`；
  - `src/debugBreakpointExtras.ts:202`：`sendableBreakpoints<T extends DapBreakpoint & { logMessage?: string }>` → `T extends DapBreakpoint`；
  - `src/debugBreakpointExtras.ts:211-212` 与 `:233` 那三处 `as { logMessage?: string }` 强制转换一并消失。
- **上游依据**：IDEA 侧日志断点是断点属性（`platform/xdebugger-api/src/com/intellij/xdebugger/breakpoints/XBreakpoint.java`
  这一个 66 行的接口里 `isLogMessage`/`setLogExpression` 那一对），落到 DAP 就是这个字段 ⇒ 属协议侧补齐，不新增行为。
- **风险**：字段是可选的，`dapSetBreakpoints`（`src/bridge.ts:739`）与 `dapLoadBreakpoints`（`:842-843`）的
  `DapBreakpoint[]` 都是原样透传 ⇒ 加可选属性不改任何运行形状。

## T2 · `src/dbgBreakpointUpdate.ts:244-249` —— 被合并掉的那一轮到底报不报错（要定口径）

- **实况**：`pump` 把同一文件的旧等待者一起结算时给的是**同一份 round**，只有 `applied` 不同：

  ```ts
  if (waiter.version <= held.version) waiter.done({ ...round, applied: waiter.version === held.version })
  ```

  `result` 那一半已经安全：唯一采信它的
  `src/components/DebugBreakpointsPane.vue:135-138` 先看 `round.error` 再 `if (!round.applied) return`。
  **`error` 那一半没有分档** ⇒ 四处「拿 `round.error` 报用户」的写点可能把**别人那份载荷**的失败当成自己这轮的失败说一句：
  `src/App.vue:1052`、`src/components/DebugBreakpointsPane.vue:135`、`:276-277`、`:287-288`、
  `src/components/BreakpointsDialog.vue:130`，外加同文件 `src/dbgBreakpointUpdate.ts:358`（`resendAllFromRoot` 的失败清单）。
- **上游对照**：`platform/ide-core/src/com/intellij/util/ui/update/MergingUpdateQueue.kt:545`
  是 `updatesToReject.forEachGuaranteed(Update::setRejected)`、`:574-582` 的 `put` 里 `:579` 给旧那条 `setProcessed()`
  ⇒ 被合并掉的 Update **根本不 run**，所以它既不会给出结果、也不会给出错。
  按这一条，本仓旧等待者拿到的 `error` 也该是 `null`（错由**载荷主人**报一次）。
- **要你定的口径**（两种都说得通，我不在收尾轮擅自改共享形状）：
  - **甲（贴上游）**：结算时把 `error` 也折掉 —— 可粘贴的 new（替换 `src/dbgBreakpointUpdate.ts:246` 那一行）：

    ```ts
    if (waiter.version <= held.version) {
      const mine = waiter.version === held.version
      waiter.done({ error: mine ? round.error : null, result: mine ? round.result : null, applied: mine })
    }
    ```

    代价：同一文件被连排两次时，只有最后一次会报失败；界面那四处不用改就自然收敛。
  - **乙（保持现状）**：认为「这个文件这一轮确实失败了，多报一次不伤人」，那就在
    `src/dbgBreakpointUpdate.ts:160-163` 的 `applied` 注释里补一句「`error` 不分档，属本仓有意的重复上报」，
    并给 `tests/dbg-breakpoint-update.test.mjs` 补一条钉住这个形状的判据（我可以下轮做）。
- **配套判据我这边已经备好形状**（甲案落地时加进 `tests/dbg-breakpoint-update.test.mjs`，不动任何既有断言）：
  连排同一文件两轮、第二轮让 `wire` 抛，然后 `assert.equal(第一轮的 round.error, null, '被合并掉的那一轮不该替别人报错')`。
- **不需要**新设置格、不需要 native 改动。

---

## 顺手要你知道的三件事（不是请求，别写代码）

1. `docs/wiring-requests-2026-10-06-dap.md` 的 **D1 我已在那篇末尾标注「已闭环」**，并留痕：请求给的锚点
   `src/App.vue:1034` 现在实际在 `:1051`（行号漂、结论不变）。
2. `docs/wiring-requests-2026-10-06-bucket12c.md` 的 **X4 第 2 条记错了**：它写「仍缺的是组的改名/删除」，
   而参考树里**没有**这两个动作（`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/breakpoints/ui/BreakpointsDialog.java:320-348`
   那段右键只有「移至组」子菜单、`SetAsDefaultGroupAction` 与 `EditDescriptionAction`；
   `grep -rn "RenameGroup\|RemoveGroupAction\|DeleteGroup" platform/xdebugger-impl` 全树零命中）。
   X4 核对时挖出的**真**缺口是「新建组把取消当成空名」，本轮已实现并配判据（`src/breakpointGroups.ts:203-205`）。
3. 本轮**没有重算**锚点快照：`docs/inventory/citation-anchors.json` 一字未动，
   `src/components/DebugConsolePane.vue:5` 那条 `PauseOutputAction.java:18` 保持原样（新写的
   `tests/debug-console-freeze.test.mjs` 会拦任何把它改回去的动作）。

## 处理结果（wiring-backlog lane，2026-10-06）

- **T1 已接线**：`src/bridge.ts:236` 的 `DapBreakpoint` 已含 `logMessage?: string`（见 dapfix R1 / 12c X3）。
- **T2** —— 口径定夺项，非挂载。

结论：T1 已接线，未改任何文件。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「T1 已接线，未改任何文件。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
