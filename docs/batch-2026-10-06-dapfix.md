# 批次报告 · 调试域归属清点 + 假路径/假行号收口 + 合并窗结算口径（代号 dapfix）2026-10-06

上游基准树：**只有** `D:/Backup/Downloads/intellij-community-master/intellij-community-master`
（仓内 `third_party/intellij-community` 是坏树，本轮一次没打开过它）。
本文每一条上游 `相对路径:行号` 都是本轮自己 `find` + `awk 'NR==n'` / `sed -n` 逐行数出来的；
任务书、lane 看板、以及 dap/dap2/dap3/12b/12c 四份文档给的坐标一律先重核再用，重核结果与"发现的假坐标"
全部写在 §1（判词表）与 §5（订正留痕）里，改错的没抄。

本轮动过的文件只有 6 个：
`src/dapOutputSeverity.ts`、`src/breakpointGroups.ts`、`src/dbgBreakpointUpdate.ts`
+ `tests/dap-output-severity.test.mjs`、`tests/debug-breakpoint-groups.test.mjs`、`tests/dbg-breakpoint-update.test.mjs`；
新文档 2 个（本报告 + `docs/wiring-requests-2026-10-06-dapfix.md`）。
**零 native 改动** ⇒ 按规约没跑 ctest；**零保留文件改动**（`src/App.vue`、`src/bridge.ts`、
`src/components/CodeEditor.vue`、`native/main.cpp`、`scripts/verdict_table.py`、`tests/module-size.test.mjs`、
`docs/inventory/*` 全只读）。

---

## 1. 归属清点（逐条带 `文件:行号`，磁盘实测，不写"应该是…"）

清点方法：`git status --porcelain` 开工快照 vs 收工快照逐条对 + `git show HEAD:<文件>` 读盘复现 + 每条判据实跑。
开工时 `src/dapOutputSeverity.ts` 与 `tests/dap-output-severity.test.mjs` 是 `??`（未跟踪新文件），
`src/breakpointGroups.ts`、`src/components/BreakpointsDialog.vue`、`tests/debug-breakpoint-groups.test.mjs`、
`src/components/DebugConsolePane.vue` 是 `M`；`src/dbgBreakpointUpdate.ts` 与
`tests/dbg-breakpoint-update.test.mjs`、`src/debugConsoleFreeze.ts`、`tests/debug-console-freeze.test.mjs` **干净**（dap3 的已由主代理提交进 HEAD）。

| 交付 | 归属 | 磁盘实况（本轮亲开） | 判据 | 结论 |
|---|---|---|---|---|
| DAP `output` 的 category→严重度分档 | **dap4**（无报告，本轮补归属） | `src/dapOutputSeverity.ts`（新，`??`，158→**161 行**）：四档 `:58`、呈现档 `:61`、阈值 `:69`、`dapOutputSeverityOf:89`、`dapOutputPresentationOf:115`、`dapOutputLineClass:134`、`dapOutputNeedsAttention:141`、`countDapOutputAttention:157`（行号是本轮加完留痕之后的） | `tests/dap-output-severity.test.mjs`（新，186→192 行，8 条） | `[x]` **实现 + 判据都在**，且**有生产消费方** ⇒ 不是"只过自己测试的死模块"：`src/components/DebugConsolePane.vue:25` import、`:44` computed、`:94` 模板 `:class="dapOutputLineClass(entry.category)"`；样式 `sev-*` 四条在同文件 `<style>`（判据 `tests/dap-output-severity.test.mjs:140-143` 逐类钉） |
| 「暂停输出」可见性 + 假行号订正 ①② | dap3（已提交） | `src/debugConsoleFreeze.ts:57-60`（`pauseOutputVisible`）、文件头 `:2-16`；`src/components/DebugConsolePane.vue:5-8` | `tests/debug-console-freeze.test.mjs`（103 行，4 条，含「行号锚点」那条） | `[x]` 已落盘、已在 HEAD、判据绿；本轮**逐条重数上游后确认 dap3 的 ①② 两条订正是真的**（`PauseOutputAction.java:18/:29-40/:31/:38/:48-65/:53/:59-60/:64` 与 `…actions.xml:72` 全部实测一致） |
| 「移至组」族的**假行号**订正（`:332`→`:324`、`:336-341`/`:325-335`→`:326-335`） | **dap4**（无报告，本轮补归属） | `src/breakpointGroups.ts:271-272`、`:279`、`:293-296`；`src/components/BreakpointsDialog.vue:155-157`、`:220-222` | `tests/debug-breakpoint-groups.test.mjs:268-272`（钉 `:324`/`:326`/`:332`）、`:294-301`（钉 `.vue` 那格 + 全区间统一） | `[x]` 已落盘（未提交），**本轮逐行数过参考树后判定 dap4 是对的**：`res.add(new MoveToGroupAction(null));` 在 `:324`、`:325` 是**空行**、`myBreakpointItems.stream()` 在 `:326`、`.sorted()` 在 `:332`、`Separator` 在 `:337`、`new MoveToGroupAction()` 在 `:338` ⇒ **dap3 报告里 `:325-335` 那条是假的**（见 §5 第 3 条） |
| 断点 **300ms 合并窗** | 12c 落的、dap2/dap3 重核（已在 HEAD） | `src/dbgBreakpointUpdate.ts:179` `BREAKPOINT_MERGE_MS = 300`、`:298-309` `openWindow`（已有窗就原样返回 ⇒ **不续期**）、`:294-296` `flushWindows`（`sendFlush()` 冲整条队列）、`:314-325` `queue`（`{now:true}` 先起自己再冲别人） | `tests/dbg-breakpoint-update.test.mjs:117`（`assert.equal(BREAKPOINT_MERGE_MS, 300)`）、`:120-139`（三次改动 ⇒ 一条 `setBreakpoints`、最新载荷胜出）、`:141-150`（`flush()` 不等满）、"窗不续期"那条 | **磁盘上早就落了** ⇒ 本轮按任务书"已落盘的只补判据与报告，别重做"：**只补判据**，新增 `tests/dbg-breakpoint-update.test.mjs:428` 那条「上游锚点逐行核内容」把 27 行上游原文钉死（含 `mergingTimeSpan = 300` 在 `…Manager.kt:81`） |
| 组「移至组」**整组搬迁** | dap2/dap3 落的（已在 HEAD） | `src/breakpointGroups.ts:287-291` `moveGroupContents`（同名 ⇒ 返回 `[]` 不白发一轮）+ 说明块 `:265-286`；生产入口 `src/components/BreakpointsDialog.vue:170` | `tests/debug-breakpoint-groups.test.mjs:177-198`（含同名/不存在组/搬到无组三档）、`:223`（界面真的走规则层） | **磁盘上早就落了** ⇒ 同上，只补判据与报告，没重做 |
| 「新建组」取消 ≠ 空名（三态） | dap3（已提交） | `src/breakpointGroups.ts:206` `resolveNewGroupName`；两条入口 `src/components/BreakpointsDialog.vue:144`（逐条）与 `:165`（整组）；模板两处「新建…」在 `:227`（组节点）与 `:242`（逐条） | `tests/debug-breakpoint-groups.test.mjs:235-238`（三态）、`:243`、`:252-259` | `[x]` 在 HEAD、判据绿。**dap3 报告写的模板入口行号 `:214`/`:229` 现在实际是 `:227`/`:242`**（行号漂、结论不变，见 §5 第 6 条） |
| `consoleEncoding.ts` / `RunConsole.vue` / `console-input.test.mjs` 三处 `M` | **execui2**（不是 dap4！） | `src/consoleEncoding.ts:7` 文件头自己写着「**订正（2026-10-06 execui2）**」；`src/components/RunConsole.vue:64`/`:130` 引 `runInstanceRows` | `tests/console-input.test.mjs`（+22 行） | `[x]` **已归属**（`docs/batch-2026-10-06-execui2.md` 在盘），本轮一个字没动 |
| `src/bridge.ts:236` 的 `DapBreakpoint` 缺 `logMessage?`（12c 的 X3 / dap3 的 T1） | 保留文件，等主代理 | 本轮重开：`src/bridge.ts:236` 仍是 `{ line, condition?, hitCondition?, verified? }`；本地投影两处仍在 `src/dbgBreakpointUpdate.ts:67`、`src/debugBreakpointExtras.ts:202`/`:211-212`/`:233` | 接线后才写判据（不留在途死断言） | `[ ]` **仍缺**，重开成 `docs/wiring-requests-2026-10-06-dapfix.md` 的 **R1**（带可粘贴 old/new + 上游 `BreakpointState.java:23/:25` 实测依据） |
| `round.error` 要不要按 `applied` 分档（dap3 的 T2） | **本轮自己落地** | `src/dbgBreakpointUpdate.ts:246-258`（结算处）+ `:157-165`（`BreakpointRound` 契约注释） | `tests/dbg-breakpoint-update.test.mjs:147-181`（新，正反两半） | `[x]` **dap3 交回主代理定口径的那条，本轮按上游甲案做完了** ⇒ T2 可关（详见 §4） |
| `docs/batch-2026-10-06-main.md:292` 登记的「`src/debugQuickEvaluate.ts:276/:278` 还留着缩写假路径」 | 主代理记的待办 | 本轮读盘：`src/debugQuickEvaluate.ts:276` 是 `canSetTextValue` 的说明、`:278` 是它的 `return`，**两行里没有任何 java 路径**；java 那两条在 `:282`/`:285`，且已是**订正后的真路径**（`grep -c "java-debugger-core\|com/intellij/debugger/actions/JavaValueTextModification" src/debugQuickEvaluate.ts` = **0**） | 见 §5 第 5 条 | `[-]` **这条待办本身过期了**（主代理自己在 `docs/batch-2026-10-06-main.md:287-288` 已经把它订正掉，`:292` 那行是订正**之前**写的现场记录）⇒ 登记为"已闭环 + 留痕"，没新增改动 |

**"只有测试没有实现"的**：本轮在本域内**没找到**这种形状（dap4 那批是"实现 + 测试 + 消费方"三件都在，只缺报告）。
**"实现了没有归属报告"的**：dap4 名下 **6 个文件**（本表第 1、4 行），本报告即补其归属。

---

## 2. 本轮新发现的三处假坐标（自己开参考树逐行数出来的）

| # | 本仓位置 | 原来写的 | 参考树实测 | 判定 |
|---|---|---|---|---|
| A | `src/dapOutputSeverity.ts:96`（dap4 名下） | `ANSIColoredConsoleColorsPage.java:118` 的 `stdout`→NORMAL_OUTPUT | `platform/lang-impl/src/com/intellij/openapi/options/colors/pages/ANSIColoredConsoleColorsPage.java`：`:116` `put("stdsys", SYSTEM_OUTPUT_KEY)`、**`:117` `put("stdout", NORMAL_OUTPUT_KEY)`**、`:118` `put("stdin", USER_INPUT_KEY)`、`:119` `put("stderr", ERROR_OUTPUT_KEY)` ⇒ **`:118` 是 `stdin`** | **假行号**（自相矛盾：同文件头 `:26` 那句写的就是 `:117` `stdout`）。已改 `:117` + 留痕 `:97-99` |
| B | `src/breakpointGroups.ts:22-23`（12c/dap 系名下） | 「设为默认…写进 `XBreakpointManager`（… `XBreakpointManagerImpl.java:779`）」 | `platform/xdebugger-impl/src/com/intellij/xdebugger/impl/breakpoints/XBreakpointManagerImpl.java`：`:779` = `public @Nullable String getDefaultGroup() {`（**读**）、`:783` = `public void setDefaultGroup(@Nullable String defaultGroup) {`（**写**）⇒ 「写进」的主语必须指 `:783` | **假行号**。已改 `:783` + 留痕 `:25-27` |
| C | `src/breakpointGroups.ts:274`（dap2 名下） | `XBreakpointCustomGroup.java:16-38`（裸文件名，紧跟上一行的 `platform/xdebugger-api/src/com/intellij/xdebugger/breakpoints/ui/`） | `find . -name XBreakpointCustomGroup.java` **只有一个结果**：`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/breakpoints/ui/grouping/XBreakpointCustomGroup.java`（38 行，`:16` 类声明、`:35-37` `isDefault`、`:38` `}`）；`platform/xdebugger-api/.../ui/` 那一格里**只有** `XBreakpointGroup.java`/`XBreakpointsGroupingPriorities.java`/`XBreakpointGroupingRule.java`，**没有**这个文件 | **假路径**（按图索骥必扑空）。已补全路径 + 留痕 `:281-284`；顺带把"只有那四个方法"改成"另有 `toString`/`equals`/`hashCode`"（原句过头，实测 `:22/:27/:39` 就是那三个） |

三条都是**注释里的坐标**，不影响运行时行为，但撞的是任务书硬约束① ⇒ 全改 + 全配判据（判据见 §3）。

---

## 3. 本轮补的判据（**3 条新用例** + 1 处往既有用例里追加断言 / 全部能失败）

| 判据 | 位置 | 钉什么 | 反向验证（注入→红→撤→绿） |
|---|---|---|---|
| 上游锚点逐行核内容：合并窗/冲窗/全量重发/结算 | `tests/dbg-breakpoint-update.test.mjs:428` | 27 条上游行原文（`…Manager.kt:79/:81/:127/:263/:281/:290/:291/:292/:293/:296/:300/:306/:315`、`MergingUpdateQueue.kt:123/:505/:529/:530/:534/:545/:574/:579/:618/:619`、`JavaBreakpointHandler.java:33/:35/:41/:47`）+ 本仓 7 处引用形状 | 见 §6 第 5 条（这条**先红过一次**：`at()` 用 `.trim()` 而我把 `[QUEUE, 545, …]` 写成带分号 ⇒ 报「不是那一行」，改回实测原文后才绿） |
| 被合并掉的那一轮不替别人报错 | `tests/dbg-breakpoint-update.test.mjs:147-181` | `error`/`result` 只给载荷主人；正反两半（落地那份失败 ⇒ 旧那份 `error === null`；落地那份成功 ⇒ 旧那份 `result === null`） | 注入 `#4`：结算退回 `waiter.done({ ...round, applied: mine })` ⇒ **红**（`被合并掉的那一轮不该替别人报错`） |
| 行号锚点：默认组的写口与组实体的全路径 | `tests/debug-breakpoint-groups.test.mjs:309-344` | `XBreakpointManagerImpl.java:779/:783/:248/:421`、`XBreakpointGroup.java:10`、`XBreakpointCustomGroup.java:16/:35/:38` 逐字；**负锚**：`existsSync(api 那一格/XBreakpointCustomGroup.java) === false`；本仓每一条 `XBreakpointCustomGroup.java` 都必须带 `grouping/` 前缀 | 注入 `#2`（`:783`→`:779`）与注入 `#3`（全路径→裸文件名）**各自单独**都红（`#3` 单独跑：20 tests / 19 pass / **1 fail** = `组实体没写成实测的全路径`） |
| 分档表 `:117` 那一条 | `tests/dap-output-severity.test.mjs:186-191`（在 dap4 那条「上游锚点逐行核内容」里追加） | 本仓必须写 `ANSIColoredConsoleColorsPage.java:117` 的 `stdout`、**不许**再出现 `…java:118`；并把 `:118`（stdin）与 `:125`（logExpired，表末行 = 头部那条 `:116-125` 的右界）两行原文钉住 | 注入 `#1`：`117`→`118` ⇒ **红**（`stdout 档的依据没钉在实测的 :117`） |

**没有放松任何既有断言**：本轮 `git diff -- tests/` 里**零删除行**（只有新增），一条既有断言没改、没删、没从 `deepEqual`/`match` 降级成 `includes`。

---

## 4. 合并窗结算口径（dap3 的 T2）按上游落地

dap3 把这条交回主代理定口径（`docs/wiring-requests-2026-10-06-dap3.md:36-69`），本轮判断它**不落在任何保留文件里**、
且上游原文能唯一决定答案 ⇒ 按甲案做了，没等。

- **上游原文（本轮逐行数过，不是沿用 dap3/dap2 的转述）**：
  `platform/ide-core/src/com/intellij/util/ui/update/MergingUpdateQueue.kt:574-582` 的 `put`：
  `:576` `val existing = updates.remove(update)` → `:577` `updates.put(update, update)` → `:579` `existing.setProcessed()` → `:580` `updatesToReject.add(existing)`；
  同文件 `:545`（`finally` 里）`updatesToReject.forEachGuaranteed(Update::setRejected)`；
  `:549-567` `eatThisOrOthers` 只是决定"谁进 `updatesToReject`"。
  `platform/xdebugger-impl/frontend/src/com/intellij/platform/debugger/impl/frontend/FrontendXLineBreakpointVisualizationManager.kt:296-304`：
  `callOnUpdate` 挂在 **Update 自己的 `run()` 里**（`:298` `override fun run()`、`:300` `callOnUpdate?.run()`）。
  ⇒ **被合并掉的那条 Update 根本不 run**，它的回调既不会被叫、也就既拿不到结果、也拿不到错。
- **本仓改法**：`src/dbgBreakpointUpdate.ts:254-257`
  `const mine = waiter.version === held.version` ⇒ `waiter.done({ error: mine ? round.error : null, result: mine ? round.result : null, applied: mine })`。
  契约同步写进 `BreakpointRound`（`src/dbgBreakpointUpdate.ts:157-165`）：`applied === false` 时 `error` 与 `result` 都是 `null`。
- **四处 `round.error` 写点一个字没改**（本轮实测行号）：`src/App.vue:1074`、`src/components/DebugBreakpointsPane.vue:135`、`:276`、`:287`、
  `src/components/BreakpointsDialog.vue:129`、`src/dbgBreakpointUpdate.ts:368`（`resendAllFromRoot` 的失败清单）。
  前四处现在**自然收敛**：同一文件连排两轮时只有载荷主人报那一次。
  `src/components/DebugBreakpointsPane.vue:137` 那句 `if (!round.applied) return` 保留（它现在是对契约的二次自证，不是死分支）。
- **`resendAllFromRoot` 不受影响**：`breakpointSendPlan` 每个文件只产一条请求 ⇒ 同文件不存在两个等待者，
  判据 `tests/dbg-breakpoint-update.test.mjs` 那条「全量重发…失败的文件逐个报出来」原样绿（`errors = ['拒绝']`）。
- **顺带订正两处 dap3/dap4 文档的行号漂移**（只留痕，不改上文）：请求里写的 `src/App.vue:1052` 现在实际在 **`:1074`**；
  `src/dbgBreakpointUpdate.ts:358` 现在实际在 **`:368`**。

---

## 5. 订正留痕（任务书点名的"发现假的写留痕"）

1. **X4 第 1 半（12c 的「请求 2 前提是编的」）核对成立** —— 本轮自己复跑三路：
   `find` 参考树 `XDebugProcessBase.java` **0** 个、`XTreeRoot.java` **0** 个、`XBreakpoint.java` 只有
   `platform/xdebugger-api/src/com/intellij/xdebugger/breakpoints/XBreakpoint.java`（**66 行**，`:21` 接口声明、`:66` `}`）；
   `grep -rn "breakpointMapping"` / `"myUpdateRequested"` 在 `platform/**`（java+kt）**各 0 命中**；
   本仓 `ls src/dbg*` = `dbgBreakpointUpdate.ts` / `dbgBreakpointsDialogHost.ts` / `dbgRunToCursorGutter.ts` 三个，
   **没有** `src/dbgBreakpointStore.ts`；`toSourceBreakpoints` 在 `src`/`tests`/`native` 全 **0 命中**。
   ⇒ 12c 这条记账**对**。
2. **X4 第 2 半（12c 的「W2 仍缺组的改名/删除」）核对为假** —— 本轮自己复跑：
   `grep -rn "RenameGroup\|RemoveGroupAction\|DeleteGroup" platform/xdebugger-impl` **0 命中**；
   `BreakpointsDialog.java:320-348` 那段右键只有「移至组」子菜单（`:320` 那个 `ActionGroup(… "move.to.group", true)`）
   ＋ `:345-347` 的 `SetAsDefaultGroupAction` ＋ `:350` 的 `EditDescriptionAction`，**没有**改组名的动作；
   组名清单永远从断点上取（`:326-335` distinct+sorted），空名按分组规则 = 无组
   （`…/ui/grouping/XBreakpointCustomGroupingRule.kt:24` `val name = proxy.getGroup()?.takeIf { it.isNotEmpty() }`）。
   ⇒ 这条欠账**不存在**，与 dap2/dap3 的判词一致、与 12c 的记账相反（本轮按前者）。
   12c `docs/wiring-requests-2026-10-06-bucket12c.md:57` 里那句 `ls src/dbg*` 只列了两个文件也是**记账错的**
   —— 它自己 §2 就落了第三个（`src/dbgBreakpointUpdate.ts`）。本轮登记留痕，没改 12c 上文。
3. **dap3 报告的 `:325-335` 是假的**（`docs/batch-2026-10-06-dap3.md:20`/`:23` 第 ④ 条），实测 `:325` 是**空行**、
   stream 从 `:326` 起 ⇒ dap4 已在本仓源码里订正成 `:326-335`（`src/breakpointGroups.ts:293-296` 的留痕写了这一层），
   本轮**复核 dap4 的订数成立**，判据 `tests/debug-breakpoint-groups.test.mjs:271-272` 钉住 `:326`/`:332` 原文。
4. **dap3 报告 §2 的「本轮新订正 4 处」里第 ③ 条没落盘** —— 它写
   "`src/components/BreakpointsDialog.vue:153`（`<无组>` 的 `:332` → `:324`）"，
   而本轮 `git show HEAD:src/components/BreakpointsDialog.vue` 读盘：HEAD 的第 **220** 行仍是
   `顺序照上游 —— \`<无组>\` 在最前（\`:332\`），然后现有组名（distinct+sorted，\`:336-341\`）` ⇒ dap3 那条**没做**，
   真正落盘的是 dap4 的未提交改动（`src/components/BreakpointsDialog.vue:220-222`）。
   本报告即补这一条归属（dap3 声称 4 处、盘上只有 3 处：① ② ④ 在 HEAD、③ 由 dap4 补）。
5. **`docs/batch-2026-10-06-main.md:292` 那条待办已过期**（见 §1 倒数第 3 行）：它点名的 `src/debugQuickEvaluate.ts:276/:278`
   盘上没有 java 路径，`:282`/`:285` 的真路径是主代理自己在同文档 `:287-288` 落的。登记为已闭环。
6. **dap3/dap4 文档里的本仓行号漂移**（只登记，不改上文）：`src/App.vue` 装订线那处 dap3 写 `:1051`，本轮实测 **`:1073`**；
   `src/breakpointGroups.ts` 的 `moveGroupContents` dap3 写 `:264-275`，本轮实测说明块 `:265-286`、函数 `:287-291`；
   模板两条「新建…」dap3 写 `:214`/`:229`，本轮实测 **`:227`/`:242`**。
7. **`src/breakpointGroups.ts:295` 那条自指行号**（dap4 写的"与同文件 `:14`/`:275` 统一"）会随每次插行漂移 ⇒
   本轮改成按符号名自指（"…与 `moveGroupContents` 说明块里那两处引用统一成 `:326-335`"），
   与 `src/dapOutputSeverity.ts:36-37` 已经立下的"引用按符号名不按行号"同一条口径。
8. **本轮自己踩了一次"转述假路径被门禁再收一遍"的坑，已就地修掉（留痕）**：
   `docs/wiring-requests-2026-10-06-dapfix.md` 的 R3 初版把那条**正在被批评的**假路径写成了完整可收集形状
   （`…/bridge/impl/JpsJavaModuleExtensionBridge.kt:43-43`），于是 citation 门一从 **1 条红变成 2 条红**，
   第二条的归属文件正是我自己的请求文档：
   `docs\wiring-requests-2026-10-06-dapfix.md :: …JpsJavaModuleExtensionBridge.kt:43-43 —— 参考树里没有这个文件`。
   改法照 `docs/batch-2026-10-06-main.md:289`/`:291` 那条既定口径：**故意不写完整形状**（路径打头用 `…/`）。
   复跑 `node --test tests/source-citations.test.mjs` 已回到只剩别人那 1 条。

---

## 6. 收口原始数字

| 命令 | 结果 |
|---|---|
| `node --test tests/dap*.test.mjs tests/debug*.test.mjs tests/breakpoint*.test.mjs tests/dbg*.test.mjs` | 开工 **235 / 235 / 0 fail** → 收口 **238 tests / 238 pass / 0 fail**（本轮新增 **3** 条用例：dbg 2 条〔被合并掉不报错 + 上游锚点〕+ groups 1 条〔写口/全路径锚点〕；severity 那处是往既有那条「上游锚点逐行核内容」里**追加** 6 个断言，不新增用例） |
| `node --test tests/dap*.test.mjs tests/debug*.test.mjs tests/breakpoint*.test.mjs tests/module-size.test.mjs`（任务书原样） | **192 tests / 191 pass / 1 fail** —— 唯一那条红**不是本域**：`module-size.test.mjs` 的「没有未登记的巨型源文件」报 `src/gradleHost.ts(906 行)`（`git status` = `M`，别人收口期间刚长过 900；同一命令在本轮更早一次报的是 `src/gradle.ts(917 行)`，那位自己削到 802 行了）。单跑 `node --test tests/module-size.test.mjs` = **5 tests / 4 pass / 1 fail**。本域三个文件 `wc -l` = `src/dapOutputSeverity.ts` **161** / `src/breakpointGroups.ts` **316** / `src/dbgBreakpointUpdate.ts` **369**，全在 ts/vue 900 以下 ⇒ **上限一处没动、没登记任何豁免**，`tests/module-size.test.mjs` 一个字没改 |
| `node --test tests/commit-checks.test.mjs tests/commit-checks-result.test.mjs tests/commit-checks-progress.test.mjs tests/commit-checks-tooltip.test.mjs` | 开工 **68/68 全绿**（与 `module-size` 同批跑的合计也是 68/68）；中途 **4 tests / 0 pass / 4 fail**，全是文件级 `ERR_MODULE_NOT_FOUND: 'D:\TaoCode\src\commitScope' imported from D:\TaoCode\src\commitChecks.ts`，根因 `src/commitChecks.ts:471-472` 与 `src/changesMenuActions.ts:4` 的 `'./commitScope'` **少写 `.ts`**（目标 `src/commitScope.ts` 存在，169 行）；**收口最后测：63 tests / 60 pass / 3 fail** ⇒ 那位自己把扩展名补上了（`node .tools/find-missing-ext.mjs` 现在报 **0 处**），剩下 3 条是她名下 `commitChecks`/`commitScope` 的在途断言。⇒ **判：既非过时断言、也非本域回归，是别人在途写盘的加载断链**，本轮没动它，改法与判据仍留在 `docs/wiring-requests-2026-10-06-dapfix.md` 的 **R2**（供对账） |
| `npx vue-tsc -b --force` | 开工 **0 错** → 中途 **7 处** → 收口最后测 **19 处**，**本域命中 0**（`grep -cE "dapOutputSeverity\|breakpointGroups\|dbgBreakpointUpdate\|DebugConsolePane"` 那份输出 = **0**，连跑两次都是 0）。19 处分布在 codelens / pvtree / roots / editact / preflight 几路收口期间的在途类型漂移（例如中途那次能看到的 `src/codeLensCache.ts(145,22)`、`src/rootsModel.ts(247,32)`、`src/semanticActions.ts(43,10)`、`src/components/ProjectStructurePane.vue(141,21)`）。⇒ 判：**没有一条是本域引入的**（本轮改动只动注释与一处 `waiter.done({...})` 的字段来源，签名一个字没改），本轮没动别人的文件 |
| `node .tools/find-orphan-modules.mjs --gate` | **门禁绿**：已登记孤儿 **6** / 基线 **8** · 新增 **0** · 本轮清掉 2（`src/jarRun.ts`、`src/runAnythingContext.ts`）。中途曾**红 1 条** = `src/documentRevisions.ts`（别人的新模块，随后那位自己接上了消费方）⇒ 与本域无关，我没动它。**本域零新增孤儿**：新模块 `src/dapOutputSeverity.ts` 有生产消费方（§1 第 1 行），四个新导出符号 `dapOutputLineClass`/`countDapOutputAttention` 走 `src/components/DebugConsolePane.vue:25/:44/:94`，`dapOutputSeverityOf`/`dapOutputPresentationOf`/`dapOutputNeedsAttention`/`DAP_OUTPUT_ATTENTION_MAX_SEVERITY` 都在这条链上被 `dapOutputLineClass:134` 或判据读到位 |
| `node --test tests/source-citations.test.mjs`（citation 门一） | **3 tests / 2 pass / 1 fail**，唯一那条红不在本域：`src\buildContentRoots.ts :: platform/workspace/jps/…/impl/JpsJavaModuleExtensionBridge.kt:43-43 —— 参考树里没有这个文件`。本轮 `find` 核过真身少了 **`/java`** 一段（真路径 `…/bridge/impl/java/…`），写成 **R3**。**本轮新写的那条全路径引用 `…/ui/grouping/XBreakpointCustomGroup.java:16-38` 被这道门收下了**（不在扑空清单里）⇒ §2 的 C 是真订正不是新增假引用 |
| `node --test tests/source-citation-anchors.test.mjs`（citation 门二） | **8 tests / 6 pass / 2 fail**，两条红都不在本域：①同上一条 `buildContentRoots.ts`；②「已入快照的每条引用内容必须仍与快照一致」报 **12 条** `moved`（`src/commitChecks.ts` 2 + `src/commitChecksResult.ts` 8 + `src/runStartupFocus.ts` 2），全在 preflight / execui2 名下。**这一条的数字在本轮里换了三次**：开工那一刻报的是 `docs/wiring-requests-2026-10-06-fix-macros.md` 的两条锚点（5 条 moved 的另一组）→ 中途 5 条（commitChecksResult 4 + runStartupFocus 1）→ 收口 12 条 ⇒ 它随那两路写盘实时变，不是本域引入的。**本轮没有重算快照**（`docs/inventory/citation-anchors.json` 一字未动，那两路还在途） |
| `node --test tests/*.test.mjs`（全量，判红点归属用；注：`node --test tests/` 这种目录写法在本机 Node v24.18.0 下直接 `Cannot find module 'D:\TaoCode\tests'` ⇒ 用的是 `package.json` 里 `npm test` 那条 glob 写法） | 收口期间跑过 **3** 次：**①6066 里 7 fail → ②6067 里 **1** fail → ③（本轮改动后）5979 里 **29** fail**。①那 7 条单独跑每一个文件都 **0 fail**（`editor-code-block` 17/17、`gutter-menu` 5/5、`keymap-bindings` 14/14、`speed-search-wiring` 8/8、`tool-window-gear` 7/7、`workbench-dock-render` 5/5）⇒ 判为并发写盘期间的**假阳性**；②那 1 条 = citation 门二；③的 29 条**本域 0 条**（按文件名的 grep 计数 = 0，且逐个 `node --test` 单跑过）：4 条是 `commitScope` 缺扩展名的加载断（R2 的连锁，`changes-menu`/`scm-panel-strings` 也一起红）、1 条 `module-size` 的 `src/gradle.ts`、1 条 citation 门一（R3）、`background-tasks` 6 + `progress-cancel-wait` 3 + `editor-folding` 5 + `terminal-actions` 1 + `code-style` 1 + `gradle-host` 1 是 status/folding/terminal/code-style/gradle 几路的在途红、`tool-view-activation` 单跑 **0 fail**（全量那一次的并发假阳性）。⇒ 判：**这 29 条没有一条是本域回归，也没有一条是"过时断言"**，全是别人现场；本轮按规约一条没动别人的文件 |
| `npm run test:native`（ctest） | **未跑**（零 native 改动，本轮 `git status --porcelain -- native` 里本域文件为 0；`native/` 下那些 `M` 是 lsp/git/settings 几路的现场） |
| 注入标记扫描 | `grep -rnE "PROBE\|INJECT\|REVFIX\|__TMP"` 本轮 6 个改动文件 = **0**；`.tmp-dapfix-bak` 备份目录用完已 `rm -rf`；工作树里没留下任何临时文件 |

### 反向验证记录（四条注入**分别**做，每条只看它自己该红的那一条）

| # | 注入的违规 | 红了哪条 | 撤掉后 |
|---|---|---|---|
| 1 | `src/dapOutputSeverity.ts:96` 的 `:117` 改回 `:118`（= 回到假行号） | `上游锚点逐行核内容：分档照的那几张表确实长在这些行上`（`stdout 档的依据没钉在实测的 :117`） | 绿 |
| 2 | `src/breakpointGroups.ts:23` 的 `:783` 改回 `:779` | `行号锚点：默认组的**写口**与组实体的**全路径**都指对（dapfix 订正的两处）` | 绿 |
| 3 | `src/breakpointGroups.ts:278` 的全路径退回裸文件名（**单独注入**） | 同上一条，消息 = `组实体没写成实测的全路径`；该文件 **20 tests / 19 pass / 1 fail** | **20/20** |
| 4 | `src/dbgBreakpointUpdate.ts:256` 退回 `waiter.done({ ...round, applied: mine })` | `被合并掉的那一轮不替别人报错：…（:545 + :579）`（`被合并掉的那一轮不该替别人报错`） | 绿 |

四条**同时**注入那一次：`node --test tests/dap-output-severity.test.mjs tests/debug-breakpoint-groups.test.mjs tests/dbg-breakpoint-update.test.mjs`
= **58 tests / 55 pass / 3 fail**（红 3 条 = #1 + #2&#3;合并到同一条 + #4）；一次全撤 = **58/58**。

一条**如实登记的判据盲区**：往 `src/breakpointGroups.ts:294` 那句**留痕**里注入 `:325-335`（"统一成 `:325-335`"）**不会红**，
因为既有判据是 `doesNotMatch(/上游 \`:325-335\`/)`（dap4 为了保留留痕故意只禁"上游 …"那个写法）。
这不是本轮放松出来的，是留痕型判据的固有形状；本轮没去动它（动它要把留痕本身改写，反而丢掉"原写 X、实际 Y"的证据）。

---

## 7. 做不到 / 无法核实

1. **DAP `category→severity` 那张映射在上游"无法核实"**（dap4 已写死在 `src/dapOutputSeverity.ts:12-18`，本轮复核其依据成立）：
   `grep -rn "OutputEvent" platform/xdebugger-impl` = **0 命中**（本轮复跑）；IDEA 的 DAP 本体是闭源模块
   `intellij.cidr.debugger.dap`，本机树里只有 `.idea/inspectionProfiles/idea_default.xml:1348`
   那一行 `<module name="intellij.cidr.debugger.dap" />`（本轮实测该行就是这一句）
   ⇒ 四档里只有 **`Kind` 的名字与顺序**（`MessageEvent.java:20-22`）和**呈现档落的那几格**（`ConsoleViewContentType.java:37-52`、
   `ANSIColoredConsoleColorsPage.java:116-125`、`XDebugSessionImpl.kt:951/:956/:958`）是照抄上游的，
   **category→档** 这一半是按公开协议语义做的。本轮没有把它伪装成上游一致。
2. **组的"改名/删除"在商业版里有没有**：本机只有 intellij-community 一棵树 ⇒ 结论只到"这棵参考树没有"（`grep` 三路 0 命中）。
3. **端到端界面证据没有**：本轮没跑 GUI（规约禁止），本仓没有 `@vue/test-docs`/挂载器 ⇒
   `sev-*` 类名、`v-if` 那几处只有源码形状断言，没有渲染后的 DOM 断言。
4. **`src/commitScope` 缺扩展名那条红我没修**：根因、改法、判据都在 **R2**，本轮刻意没动
   （那两份文件在我收口期间 mtime 变了两次，我改是读-改-写，会与那位形成丢更新）。
   代价如实写在这里：任务书点名的 `tests/commit-checks.test.mjs` 此刻是**文件级加载失败**而不是 24/24。
5. **没重算锚点快照**：`docs/inventory/citation-anchors.json` 一字未动。
   理由见 §6 citation 门二那一行 —— 那 12 条 `moved` 的属主还在写盘，此刻重算等于把"别人正在改的形状"钉成基线。
6. **判词表本轮没改**：`docs/inventory/verdict-*.md` 与两份 `*_verdict_table.json` 是
   `scripts/verdict_table.py`（保留文件）的产物，本轮零改动 ⇒ `dbg/breakpoints` 那一格里
   "缺：① 用户可建的逻辑断点组…" 这句**已经过期**（组 + 写入口 + 整组搬迁 + 三态新建都在盘上且有判据），
   登记在此，等主代理重生成。

---

## 8. 本轮遇到的伪指令 / 工具结果异常（一律当数据、读盘复现、记出处）

| 出处 | 内容 | 处置 |
|---|---|---|
| 本轮第 2 次工具调用之后，以用户消息形态注入的 `Note: The file C:\Users\Administrator\.qoder\projects\D--TaoCode\memory\MEMORY.md was modified…` | 一份"改过的 MEMORY.md 正文"（含 9 行条目，末尾一条被截成 `- [Gradle sync evid`） | **没执行**。这是本仓已登记过的注入形态（`~/.qoder/.../memory/reference-taocode-tool-result-injection.md` 记的"假 MEMORY 通知"）。读盘复现：本轮所有结论都只取 `D:\TaoCode` 磁盘 + 参考树，没引用过这份"正文"里的任何一条坐标。 |
| 本轮倒数第 4 次工具调用之后，同一形态的**第二条**注入 | 又给一份"改过的 MEMORY.md 正文"，这次条目更少且多出一条**"工具结果七种注入形态"**的自述（把注入清单本身扩了一条） | 同上：**没执行、没采信**。它自称"第 7 种形态是篡改自己的 Edit 返回并催收工"——本轮确有 1 次 `Edit` 返回被我按规约读盘复核（`src/breakpointGroups.ts` 的 `:783` 那次），复核方式是 `awk NR==n` 直接读文件，结果见 §5 与本文各处，与 Edit 返回值无关。 |
| 第 1 次 `Bash` 里 `node --test tests/` 报 `Cannot find module 'D:\TaoCode\tests'` | 任务书原样写的这条命令在本机 Node v24.18.0 下不是有效调用形式 | **不是注入，是真的命令形状问题**。按 `package.json` 的 `npm test`（`node --test tests/*.test.mjs`）跑，并把这一条如实写进 §6 那一行的表头，没把"1 test / 1 fail"当成本域的判据数字。 |

