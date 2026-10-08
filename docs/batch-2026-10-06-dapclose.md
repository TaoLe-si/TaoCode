# 批次报告 · 调试（DAP）族收尾与订正 · 代号 dapclose · 2026-10-06

上游基准树：**只有** `D:/Backup/Downloads/intellij-community-master/intellij-community-master`
（`third_party/intellij-community` 坏树，本轮一次没打开）。无中文语言包 ⇒ 中文措辞一律标「无法核实」。
本文每一条上游 `相对路径:行号` 都是本轮自己 `awk NR==n` / `find` 数出来的；派单、dap/dap2/dap3/dapfix 报告、
以及给我的坐标一律先重核再用。**本轮定位＝修复/收尾轮，不重做功能、不加新功能。**

---

## 0. 接手实况（派单前提 vs 磁盘实测）

派单说「`docs/batch-2026-10-06-dap.md` 与它的接线请求从未落盘」——**读盘发现该前提已过期**：

| 派单前提 | 磁盘实测（本轮亲开/亲 `ls`） | 判定 |
|---|---|---|
| `docs/batch-2026-10-06-dap.md` 从未落盘 | **已在盘**（104 行，由 `dap2` 代写、`dap3` 复核，§1 判词表完整） | 前提过期 |
| 「它的接线请求从未落盘」 | `docs/wiring-requests-2026-10-06-dap.md` **已在盘**（D1 = `src/App.vue` 装订线裸发 `dapSetBreakpoints`，dap2 新建、dap3 标注 D1 已闭环） | 前提过期 |
| dap4 承认的**假路径没订正** | **已由 `dapfix` 轮订正并留痕**（见 §3），本轮逐条重开参考树**复核其订正成立** | 已交，本轮只做复核 |
| X4 记账核对没做 | **本轮做**（见 §2） | 本轮完成 |
| 调试域代码「大多在盘上」 | 属实：本域源文件与判据齐全，综合域测试 **244/244** 绿（§4） | 成立 |

一句话：**上一轮撞上限的 dap4 欠的两件交付物（dap.md / 接线请求）已由 dap2/dap3 补落、假路径已由 dapfix 订正；
本轮（dapclose）＝独立复核假路径订正是否真成立 + 做 X4 账本核对 + 判据可失败性抽查 + 补这份收尾报告。**
本轮**对任何源文件零净改动**（只做了 §4 的临时注入，用完即还原，sha1 与基线逐字节一致）。

---

## 1. 落盘盘点（文件 + 状态 + 净行数）

`git status --porcelain` + `wc -l` 实测（「状态」列：`??`=新文件未跟踪 / `M`=工作区已改 / 空=与 HEAD 一致）。
这些净增删量**汇总了 dap/dap2/dap3/dap4/dapfix 五轮的未提交改动**（工作区共享、主代理间歇提交），非本轮 dapclose 所为。

| 文件 | 状态 | 现行数 | 说明 |
|---|---|---:|---|
| `src/dapOutputSeverity.ts` | `??` | **161** | DAP `output` category→严重度四档 + 呈现档；dap4 落、dapfix 订 `:117` 留痕 |
| `src/breakpointGroups.ts` | `M`（+14/−4） | 316 | 断点按文件分组 + 用户组全套（组名/成员/移至组/整组搬迁/默认组/启用位/三态新建） |
| `src/dbgBreakpointUpdate.ts` | `M`（+17/−7） | 369 | 300ms 合并窗（不续期）+ `{now}` 冲整条队列 + 结算只给载荷主人（dapfix T2 甲案）；`BreakpointPoint = DapBreakpoint`（R1 投影已简化） |
| `src/dbgRunToCursorGutter.ts` | 干净 | 178 | 运行到光标处 = DAP `goto`（dap2 落，已在 HEAD） |
| `src/dbgBreakpointsDialogHost.ts` | 干净 | 40 | 「查看断点…」对话框宿主 |
| `src/debugConsoleFreeze.ts` | 干净（HEAD） | 87 | 暂停输出可见性 `pauseOutputVisible:57`（dap3 落，已在 HEAD） |
| `src/debugQuickEvaluate.ts` | 干净（HEAD） | 341 | 快速求值（dap 落的假路径订正已在盘） |
| `src/debugBreakpointExtras.ts` | `M`（+3/−5） | 233 | 纯规则：条件/命中/日志/临时/依赖/静音；`sendableBreakpoints<T extends DapBreakpoint>`（R1 投影已简化） |
| `src/debugBreakpointEditor.ts` | `M`（+1/−1） | 145 | 断点属性编辑器 |
| `src/components/DebugConsolePane.vue` | `M`（+28/−4） | 117 | **dapOutputSeverity 的真实消费方**：`:25` import、`:40` 暂停格、`:94` `:class` |
| `src/components/BreakpointsDialog.vue` | `M`（+3/−1） | 287 | 组的**写入口**（`moveGroupContents:170`、`assignBreakpointsToGroup:148/149`、`resolveNewGroupName:144/165`、`setBreakpointsEnabled`） |
| `tests/dap-output-severity.test.mjs` | `??` | 192 | 8 条，含「上游锚点逐行核内容」（钉 `:117`、负锚 `:118`） |
| `tests/dbg-breakpoint-update.test.mjs` | `M`（+117/−1） | 501 | 含「合并窗/冲窗/全量重发/结算」27 行上游原文逐行核 |
| `tests/debug-breakpoint-groups.test.mjs` | `M`（+56/−0） | 344 | 含「写口 `:783` + 组实体全路径」锚点（负锚 `:779`、负锚 `existsSync(api/ui)=false`） |
| `tests/debug-console-freeze.test.mjs` | 干净（HEAD） | 103 | 4 条，含行号锚点那条（dap3 落） |

**零 native 改动**（本轮 `native/dap*.cpp|.hpp` 只读没写）⇒ 按规约没跑 ctest、没登记新 `native/*.cpp`。

---

## 2. 判词核对表（X4 记账核对：只核对、只出表，不改 `docs/inventory/**`）

核对对象：`docs/inventory/verdict-xdebugger.md` + `xdebugger_verdict_table.json`。
方法：`verdict-generated.test.mjs`（账本自校验门禁）实跑 **5/5 绿** ⇒ 账本里所有「本仓落点」路径**均真实存在**（无幻影文件）；
再对每条 `[x]/[~]/缺` 逐个开文件核。

**A. `[x]` 条目核对（派单点名方向：判 [x] 但代码不存在）**

`verdict-xdebugger.md:20` 档位统计 + `xdebugger_verdict_table.json` `counts.x` **均为 0**（xdebugger 635 类里没有任何 `[x]` 族/类档位）。
⇒ **「判 [x] 其实不存在」这一类假闭环在本账本里无从发生**，核对成立、无需订正。

**B. 「高估的反面」＝账本判「缺」但代码已在盘（过期缺项，需账本订正请求）**

| # | 账本条目 | 现判（verdict-xdebugger.md） | 磁盘实况（本轮亲核） | 账本订正请求 |
|---|---|---|---|---|
| 1 | `dbg/breakpoints` 族 缺①「用户可建的逻辑断点组（`XBreakpointGroup`/`XBreakpointCustomGroupingRule`：跨文件具名组、按组启用/禁用）…本轮冻结，没有可落的面板」 | `[~]` | **已在盘**：`breakpointGroups.ts` 有 `groupNames:225`/`groupMembers:247`/`breakpointGroupNodes:251`/`assignBreakpointsToGroup:181`/`resolveNewGroupName:206`/`setDefaultBreakpointGroup:211`/`setBreakpointsEnabled:158`/`moveGroupContents:287`；**写入口 `BreakpointsDialog.vue:170/144/148`**（非「只有 close/open 两个 emit」）；判据 `tests/debug-breakpoint-groups.test.mjs` | **删**缺①；族仍 `[~]`（②Java 方法/字段断点、③会话级不随项目存、④富编辑 仍差） |
| 2 | `dbg/actions` 族 缺④「`PauseOutputAction`」 | `[~]` | **已在盘**：`debugConsoleFreeze.ts:57` `pauseOutputVisible` + `shouldFollowOutput:28`/`markForPause:66`；**消费 `DebugConsolePane.vue:28/40`**（暂停格按 `pauseOutputVisible` 出不出）；判据 `tests/debug-console-freeze.test.mjs`（dap3，已在 HEAD） | **删**缺④；族仍 `[~]`（①强制单步/SmartStepInto、②线程冻结、③MarkObject 仍差） |
| 3 | dapfix §1/§7.6 与 `wiring-requests-…-dapfix.md` R1「`src/bridge.ts:236` 仍缺 `logMessage?`、投影未简化」 | （报告/请求，非 inventory） | **已过期**：`src/bridge.ts:236` 现为 `{ line; condition?; hitCondition?; logMessage?; verified? }`（**已有** logMessage?）；模块侧投影已简化——`dbgBreakpointUpdate.ts:67` `= DapBreakpoint`、`debugBreakpointExtras.ts:202` `<T extends DapBreakpoint>`，无残留 `& { logMessage? }`/`as { logMessage }` | **R1 可关**（本报告登记，不改 dapfix 上文） |

**C. 账本 `[~]/[-]` 里「本仓落点」文件存在性**

`verdict-generated.test.mjs` 5/5 绿 ⇒ `dbg/frames-vars`、`dbg/attach`、`dbg/evaluate`、`dbg/settings`、`dbg/inline` 等族判词引用的
`debugDataView.ts`/`debugValueCopy.ts`/`debugWatches.ts`/`debugAttach.ts`/`debugCompletions.ts`/`debugInlineValues.ts`/`debugInlineWatch*.ts` 等
**全部在盘**（本轮 `ls src/` 亦见）。⇒ 无「判词说落在 X 但 X 不存在」的反例。

> 注：`docs/inventory/**` 是 `scripts/verdict_table.py` 生成物，本轮一字未动；上表 B 的 3 条作为**账本订正请求**交主代理重生成。

---

## 3. 假路径订正留痕（本域 = `src/dbg*`/`src/dap*`/`src/debug*`/`src/components/Debug*`/`native/dap*`）

先跑门禁拿实况红名单：`node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs`
⇒ 11 tests / **8 pass / 3 fail**，三条红**没有一条属于调试域**（红点是 `findrep2` 报告的 `ConsoleViewImpl.kt` 越界行号 +
`commitChecks.ts`/`ProblemsPanel.vue`×2/`runStartupFocus.ts` 的锚点 moved，全在别人名下）。
⇒ **本域当前无假上游路径/越界行号需要新订正**（dap4 欠的那几条已由 dapfix 订正）。

为防「门禁绿=假绿」，本轮**逐条开参考树复核** dap4/dapfix 订正的三条坐标（dap4 原写＝假、现盘＝订正后）：

| 本仓位置 | dap4 原写（假） | 参考树实测（本轮 `awk`/`find`） | 现盘写法 | 留痕位置 |
|---|---|---|---|---|
| `src/dapOutputSeverity.ts:96` | `ANSIColoredConsoleColorsPage.java:118` 的 stdout | `:117`=`put("stdout", NORMAL_OUTPUT_KEY)`、`:118`=`put("stdin", USER_INPUT_KEY)` ⇒ stdout 在 `:117` | `…java:117` 的 `stdout` | `:97-99`（dapfix 留痕「原先写 `:118`」）+ 判据 `tests/dap-output-severity.test.mjs:187-188` |
| `src/breakpointGroups.ts:24` | 「写进管理器」指 `XBreakpointManagerImpl.java:779` | `:779`=`getDefaultGroup()`（读）、`:783`=`setDefaultGroup(...)`（写）⇒ 主语须指 setter | `…java:783` 的 `setDefaultGroup` | `:25-27`（dapfix 留痕）+ 判据 `tests/debug-breakpoint-groups.test.mjs:336-337` |
| `src/breakpointGroups.ts:278` | `XBreakpointCustomGroup.java` **裸名**紧跟上一行 api/ui 目录 ⇒ 读起来在 xdebugger-api 那一格 | `find` 全树**只有一处**：在 `…/impl/breakpoints/ui/grouping/`；`…/api/.../breakpoints/ui/` 里只有 `XBreakpointGroup`/`XBreakpointGroupingRule`/`XBreakpointsGroupingPriorities`，**无** CustomGroup | 补全 `grouping/` 全路径 | `:281-284`（dapfix 留痕）+ 负锚判据 `…groups.test.mjs:332-342` |

另两条 **dap4 自己的行号订正**（`MoveToGroupAction(null)` `:332`→`:324`、清单 `:325-335`→`:326-335`，dap3 报告曾写歪）：
盘上 `breakpointGroups.ts:271-272`/`:293-296` 已带 dap4/dapfix 留痕，区间经 `tests/debug-breakpoint-groups.test.mjs:268-272` 钉内容、
且全路径引用被 `source-citations` 门接受（未进扑空清单）⇒ **复核成立**。

**本轮未新增、未删除任何源文件引用**（注入见 §4，用完即还原）。

---

## 4. 门禁原始数字（本轮实跑）

| 命令 | 数字 |
|---|---|
| `node --test tests/dbg*.test.mjs tests/dap*.test.mjs tests/breakpoint*.test.mjs tests/module-size.test.mjs`（任务书原样；glob 已 `ls` 核实命中 dbg×3/dap×4/breakpoint×1） | 基线 **88 tests / 88 pass / 0 fail**（`module-size` 绿：dapfix 记的 `gradle`/`gradleHost` 超 900 已被属主削回，本域三文件 `161/316/369 < 900`、**未动上限、未登记豁免**） |
| `node --test tests/dbg*.test.mjs tests/dap*.test.mjs tests/debug*.test.mjs tests/breakpoint*.test.mjs tests/module-size.test.mjs`（综合调试域） | **244 / 244 / 0 fail** |
| **反向验证 ①**（注入 `dapOutputSeverity.ts:96` `:117`→`:118`＋收尾前缀标记） | 该批 `dap-output-severity+debug-breakpoint-groups` = 28 tests / 26 pass / **2 fail**；红消息 `stdout 档的依据没钉在实测的 :117`（`tests/dap-output-severity.test.mjs:187-188`） |
| **反向验证 ②**（注入 `breakpointGroups.ts:24` `:783`→`:779`＋收尾前缀标记） | 同批第二条红，消息 = `行号锚点：默认组的写口与组实体的全路径都指对`（`tests/debug-breakpoint-groups.test.mjs:336-337`） |
| **还原**（两处 Edit 逐字改回） | 该批复跑 **28 / 28 / 0**；`sha1sum` 与基线**逐字节一致**（`dapOutputSeverity.ts` `fb5d55815fbac7337bc88ce1f426cd402b969cca`、`breakpointGroups.ts` `1e53d50d7e871c86fadf1a06b522b3460b0bad53`）；注入标记（DAP-CLOSE 前缀，本段用连字符书写以免文档自身令全树逐字扫描失配；实际注入为无分隔连写）扫描 `src/ tests/ native/` = **0**（sha1 逐字节还原即最强证据），残留临时标记 0 |
| `node .tools/find-orphan-modules.mjs --gate` | **门禁绿**：已登记孤儿 6 / 基线 8 · 新增 0 · 清掉 2（`jarRun.ts`/`runAnythingContext.ts`，别人的）。**本域零新增孤儿**：`dapOutputSeverity.ts` 消费方 = `DebugConsolePane.vue:25/40/94` |
| `npx vue-tsc -b --force` | **0 错**（全仓；本域命中 0） |
| `node --test tests/verdict-generated.test.mjs`（账本自校验） | **5 / 5 / 0**（账本引用的本仓落点路径全存在） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 tests / 8 pass / **3 fail**——3 条红**全非本域**（见 §3）；收工复跑（本文落盘后）确认**未新增本域红点** |
| `npm run test:native`（ctest） | **未跑**：本轮零 native 改动 |
| 全量 `npm test` | **未跑**（12 路并行按规约只跑本域） |

---

## 5. 无法核实 / 做不到

1. **DAP `category → 严重度` 的映射在上游无法核实**：`src/dapOutputSeverity.ts:12-18` 已如实写——参考树 `xdebugger-impl`
   `grep "OutputEvent"` 零命中，IDEA 的 DAP 本体是闭源模块 `intellij.cidr.debugger.dap`。四档里**只有 `MessageEvent.Kind` 的名字与顺序**
   （`MessageEvent.java:20-22`）与**呈现落点**（`ANSIColoredConsoleColorsPage.java:116-125`、`ConsoleViewContentType.java`）是照抄上游，
   `category→档` 那一半按公开协议语义做，未伪装成上游一致。本轮复核其依据链成立。
2. **断点组的「改名/删除」在商业版有没有**：本机只有 community 一棵树 ⇒ 只到「这棵参考树没有」（`RenameGroup`/`RemoveGroup`/`DeleteGroup` 三路 grep 零命中）。
3. **端到端界面证据没有**：禁 GUI、本仓无挂载器 ⇒ `sev-*` 类名、暂停格 `v-if`、模板入口只有源码形状断言，没有渲染后 DOM 断言。
4. **`dbg/frames-vars`/`dbg/attach` 的多条缺项**（进程枚举通道、`stepInTargets`、引用查询等）：根因在保留文件 `src/bridge.ts`/`native/main.cpp` 本轮冻结，非本轮可闭，本轮只做核对未改。

---

## 6. 接线请求

**本轮新增的模块侧接线：无。** 三条候选均已落盘或已闭环：
- R1（`src/bridge.ts` 的 `DapBreakpoint['logMessage?']`）：`src/bridge.ts:236` **已含** `logMessage?`，模块侧投影（`dbgBreakpointUpdate.ts:67`、
  `debugBreakpointExtras.ts:202`）**已简化**，无需再动 ⇒ 见 §2-B#3。
- 本域假路径：**0 条待订正**（§3），无需改 `src/dbg*`/`src/dap*`/`src/components/Debug*`/`native/dap*`。

**仍需主代理接的线（非本轮引入，登记以便对账）：**
- **D1**：`src/App.vue` 装订线仍裸发 `dapSetBreakpoints`（保留文件，`appvue` 名下）——`docs/wiring-requests-2026-10-06-dap.md` 的 **D1** 已含可照抄整段 +
  import + 行号；`src/components/DebugBreakpointsPane.vue:117` 那句注释引用的就是它（不再悬空）。

**账本订正请求（`docs/inventory/**` 归主代理重生成，本轮只出表、一字未改）：** 见 §2-B 表第 1/2 条
（`dbg/breakpoints` 缺①、`dbg/actions` 缺④ 均已过期，应删该「缺」子项）。

---

## 7. 工具结果注入登记（一律当数据、读盘复现）

本轮工具回传里出现的 `Note: … MEMORY.md was modified` 形态注入（含「工具结果七种注入形态」自述、催收工话术）
**一律未执行、未采信**；所有结论只取 `D:\TaoCode` 磁盘 + 参考树实测。§4 的两处 Edit 返回值均按规约 `awk NR==n` + `sha1sum` 读盘复核过。
