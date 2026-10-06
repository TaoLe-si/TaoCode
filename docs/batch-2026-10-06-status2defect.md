# 桶 status2defect —— 2026-10-06 交付：后台任务队列「挂起原因」响应式 + 死出口（派单说这两条是待修真缺陷）

派单代号：`status2defect`。可改面按派单：`src/backgroundTasks.ts` + 这条缺陷的判据测试 + 本报告。
规则来源：`D:\TaoCode\.tools\agent-rules.md`（仓库根没有 `AGENTS.md`，开工按派单只读到 agent-rules 这一份，
派单让读的 `AGENTS.md` **不存在** ⇒ 留痕，见 §6 第 1 条）。

---

## 0. 结论先说（重要留痕：派单的前提与实测不一致）

派单写「这是已确认的真缺陷，不是待查项」。我按 §1（判词可能是编的，动手前自己打开文件核实）第一次读
`src/backgroundTasks.ts` 的结果是：**两条都已经在这个共享工作区里落进代码了**，落在上一批 status2 的未提交改动里：

| 派单说的缺陷 | 实际代码（本轮打开核对的行） | 结论 |
| --- | --- | --- |
| ①「挂起原因是一个普通 `let`」 | `src/backgroundTasks.ts:184` 现在是 `const queueSuspendReason = ref<string | null>(null)`，文件里 `:180-183` 还写着"必须是 ref"的理由 | 已修；本批**没有再改实现**，改的是**判据**（下面第 2 行）与一条谎报的注释（第 4 行） |
| ②「死出口 `runningSuspendedText`」 | `src/backgroundTasks.ts:196-201`、`:266-273`：声明/写入/出口三处都没了，只剩留痕注释；对外键清单有 `deepEqual` 门禁 | 已删；本批用**注入**证明那道门禁真的拦得住（§4 步骤 2） |

所以我没有"再修一遍一个已经修好的东西"（那只会造出第二个没人读的改动），而是做四件**能证伪**的事：

1. 自己重跑上游对照，四条引用逐行数过（§2）；
2. 把缺陷 ① **注回代码**（一行：`ref(...)` → 等价于当年 `let` 的普通对象）⇒ 新判据与既有挂起判据一起红，撤后复绿（§4 步骤 1）；
3. 把死出口 **注回返回对象** ⇒ 清单门禁红，撤后复绿（§4 步骤 2）；
4. 补派单点名的那条**纯"只改挂起原因"判据**：旧用例把 `setSuspended()` 与 `proceed()`（放行任务体）写在同一步里，
   钉不住"除原因外什么都没变"这件事；新用例前后各取一份可见状态快照，除原因一个都不许变，整句钉死那一行的文案（`tests/progress-queue-suspend.test.mjs:84-146`）。

另外发现**判词已过期**（在保留文件里，本批只写请求不动手）与**同族三条零消费符号**（在别人名下文件里，同样只登记）：见 §5、`docs/wiring-requests-2026-10-06-status2defect.md`。

---

## 1. 判词表

| 族 | 项 | 判定 | 上游相对路径:行号（本轮逐行打开核过） | 本仓落点 文件:行号 | 一句话说明 |
| --- | --- | --- | --- | --- | --- |
| pf/progress | 缺陷 ①：挂起原因必须响应式，否则 `queueRow`（computed）里「已挂起」那一行永远出不来 | `[x]` 已做（status2 落的实现）· **本批复核 + 反向验证** | `platform/platform-impl/src/com/intellij/openapi/progress/impl/ProgressSuspender.java:121`（`suspendProcess(reason)` 的 javadoc：那句 reason "is displayed in the UI … until the progress is resumed"）<br>`platform/progress/shared/src/suspender/TaskSuspension.kt:24-25`（suspendText = "…explaining the reason …, which is displayed in the progress bar"）<br>`platform/platform-impl/src/com/intellij/openapi/progress/impl/TaskInfoEntityCollector.kt:174`（`pauseTask(task, suspender.suspendedText, Source.USER)`） | `src/backgroundTasks.ts:184`（`ref<string \| null>`）、`:364-367`（`queueRow` 的挂起分支把原因原样拼进 detail） | 反向验证：改成非响应式（普通对象 `.value`，语义 = 当年的 `let`）⇒ `11 tests / 9 pass / 2 fail`，红的正是挂起那一行的两条用例（§4 步骤 1 原始输出） |
| pf/progress | 缺陷 ① 的判据形态（派单要"只改挂起原因、断言行文案真的更新"那一条） | `[~]` 原有覆盖不完整 → `[x]` **本批补齐** | 同上三条，加 `platform/platform-impl/src/com/intellij/openapi/progress/impl/TaskInfoEntityCollector.kt:177`（`resumeTask` 是对称面 ⇒ 恢复后那一行必须收掉） | `tests/progress-queue-suspend.test.mjs:84-146`（新用例「只改挂起原因这一件事」）| 原写「判据 `tests/progress-queue-suspend.test.mjs` 已覆盖」= 覆盖到了结论但**步骤不纯**：旧用例第 58-59 行在改原因的同一步还 `proceed()` 放行任务体。新用例把任务体钉在 gate 上整条不动，用 `visible()` 快照证明除挂起原因外**没有第二个变量**，并用 `assert.equal(row.detail, 整句)` 钉文案 |
| pf/progress | 缺陷 ②：死出口 `runningSuspendedText`（零消费方） | `[x]` 已删（status2）· **本批复核 grep + 注入验证门禁** | 上游没有"另开一条挂起状态"的显示面：原因挂在任务那一行上（`platform/platform-impl/src/com/intellij/openapi/progress/impl/TaskInfoEntityCollector.kt:174`），`getSuspendedText()`（`…/ProgressSuspender.java:106-110`）只服务那一行 | `src/backgroundTasks.ts:196-201`（删除留痕）、`:266-273`（`currentSuspender` 同批删除留痕）；门禁 `tests/progress-queue-suspend.test.mjs:28-36` | 全仓（`src` + `tests` + `native` + `docs`）grep `runningSuspendedText\|currentSuspender`：命中只有注释、历史报告、以及门禁里那句 `doesNotMatch`（防它回来）⇒ 真实消费方 **0**。注入返回对象 `runningSuspendedText: ref('')` ⇒ `4 tests / 3 pass / 1 fail`，红在清单门禁那条 `deepEqual`（§4 步骤 2） |
| pf/progress | `queueRow` 挂起分支的**兜底文案注释与代码不一致**（注释把没发生的事说成发生过） | `[x]` **本批订正**（只改注释，不改行为） | `platform/platform-impl/src/com/intellij/openapi/progress/impl/ProgressSuspender.java:106-110`（优先级：临时 reason > 构造给的 `mySuspendedText`） | `src/backgroundTasks.ts:231-236` | 原写「没有具体 reason 时用它兜底，面板拼成「已挂起：<这句>」」；实际：队列这一路 `applySuspend`（`:208`）只在 reason 非 null 时才往下传，面板读的是 `queueSuspendReason.value` ⇒ 那句兜底（`'等待前台操作'`）**当前显示不到**。要真接上上游口径的线写成了请求 W2 |
| pf/progress | 判词同步：`docs/inventory/verdict-platform_rest.md:171` 仍写「挂起-恢复（…；**本仓任务不能暂停**）」 | `[ ]` 未做 —— **保留文件**（`docs/inventory/*.md` 禁止修改），只读 | —（本仓文档行，不是上游引用） | 见 `docs/wiring-requests-2026-10-06-status2defect.md` **W1** | 那句话现在为假（`src/progressSuspender.ts` + 队列 `setSuspended/isSuspended` + `queueRow` + 三条判据都在）。唯一真源是 `scripts/verdict_table.py:348` 那一条字符串（同时生成 verdict 文档与 `platform_rest_verdict_table.json` 里 34 处 reason），`scripts/verdict_table.py` 也保留 ⇒ 整串替换请求已给全 |
| pf/progress | 协作式让路的**任务体那一侧**（`awaitResumed()` 真被打进消费者） | `[-]` 不在本派单，且卡在别人名下文件（具体理由） | `platform/platform-impl/src/com/intellij/openapi/progress/impl/ProgressSuspender.java:154`（`freezeIfNeeded`：调用线程停在检查点上） | `src/gradleHost.ts:204-208` 的 `run: async () => { await sync() }` 不带 `indicator` | 本批自己数过那 5 行（不是照抄 status2 的话）：唯一入队消费者的任务体没有形参 ⇒ 它拿不到检查点，挂起对它的实际效果只有"不再开新任务"。status2 已写请求 W3（`docs/wiring-requests-2026-10-06-status2.md`），仍然成立 ⇒ 不重复劳动、不重复登记 |
| pf/progress | `ProgressSuspenderTracker.suspendAll/resumeAll/suspended()` 与 `ProgressSuspender.text()` 是零消费符号 | `[-]` 不在本派单（`src/progressSuspender.ts` 派单没写 = 只读） | `…/ProgressSuspender.java:106-110`（`getSuspendedText()` 在上游是被 `TaskInfoEntityCollector.kt:174` 读的，本仓那条通道换成队列级 ref） | `src/progressSuspender.ts:49`、`:53`、`:86`、`:150-152`、`:154-156`、`:158-160` | 登记 + 删除请求 **W2 / W3**（§5 逐条给 grep 结论） |

---

## 2. 上游核对记录（本轮逐行打开，不是转述）

参考树根：`D:/Backup/Downloads/intellij-community-master/intellij-community-master`。禁止搜网，全部本地 `Read`。

| 上游 `相对路径:行号` | 读到的原文（截短） | 对本批的意义 |
| --- | --- | --- |
| `platform/progress/shared/src/suspender/TaskSuspension.kt:24-25` | `@property suspendText A text message explaining the reason for the suspension,`<br>`which is displayed in the progress bar.` | 挂起原因**就是进度那一行上的文案** ⇒ 「另开一条状态出口」在上游没有对应面（缺陷 ② 的判定依据）。同文件共 29 行，`:28` 是 `data class Suspendable(@NlsContexts.ProgressText val suspendText: String)` ⇒ 旧引用写 `:24-28`（注释+声明整段）不算错，本批新用例只引 `:24-25`（就是那句话） |
| `platform/platform-impl/src/com/intellij/openapi/progress/impl/ProgressSuspender.java:121` | `* @param reason if provided, is displayed in the UI instead of suspended text passed into constructor until the progress is resumed` | "改 reason ⇒ 改 UI 显示"这条判据的上游锚（派单要的那条判据指的就是这件事） |
| 同上 `:106-110` | `return myTempReason != null ? myTempReason : mySuspendedText;` | 兜底优先级；本仓 `queueRow` 只读队列级 ref ⇒ 那句兜底当前接不到（§1 第 4 行） |
| 同上 `:125` | `if (mySuspended || myClosed) return;` | **已挂起时再 `suspendProcess(reason2)` 是空操作** ⇒ 上游"第一个 reason 赢，直到 resume"。本仓 `queueSuspendReason` 却允许 A→B 直接换文案（`src/backgroundTasks.ts:275`）。今天没有生产触发点走到 A→B（唯一触发点 `src/notifications.ts:298` 只做 `reason ↔ null`），所以**本批故意没有断言 A→B**（钉一个与上游相反的值 = 下次必被"订正"回去）；偏差登记在 §6 第 4 条 |
| 同上 `:79-81` | `markSuspendable(indicator, suspendedText)`（`:48` 那条 `assert progress.isRunning()`） | 队列在任务起跑那一刻才建挂起器（`src/backgroundTasks.ts:226-237`），本批没动 |
| `platform/platform-impl/src/com/intellij/openapi/progress/impl/TaskInfoEntityCollector.kt:174` | `TaskManager.pauseTask(task, suspender.suspendedText, TaskStatus.Source.USER)` | 原因跟着**那一行**走；本仓那一行 = `queueRow` |
| 同上 `:177` | `TaskManager.resumeTask(task, TaskStatus.Source.USER)` | 对称面 ⇒ 恢复后那一行必须收掉（新用例第 ③ 步钉的就是它） |
| 同上 `:188` | `is TaskStatus.Paused -> suspender.suspendProcess(status.reason)` | 上游的"双向同步"那一侧（本仓只有省电模式单向驱动 ⇒ 判词里 `[~]` 的残留部分，不是本批范围） |

三个文件都真实存在（`existsSync` 逐个确认），引用门禁实跑见 §3 最后一条：**本批新增的每一条带路径引用都过门**（现存 2 条红全部来自本批没碰过的别人文档，逐条列在 §3）。

---

## 3. §5 每条自查命令：前后数字 + 原始输出

`before` = 本批开工时的共享工作区（status2 的未提交改动已在位），`after` = 本批收工。

| 命令 | before | after | 说明 |
| --- | --- | --- | --- |
| `node --test tests/background-tasks.test.mjs` | `7 / 7 / 0` | `7 / 7 / 0` | 派单点名的文件；文件名以 `ls tests/` 为准（`tests/background-tasks.test.mjs` 存在，本仓没有 `tests/background-tasks.test.mts` 之类） |
| `node --test tests/progress-queue-suspend.test.mjs` | `3 / 3 / 0` | **`4 / 4 / 0`** | +1 = 本批新增的"只改挂起原因"判据 |
| `node --test tests/background-tasks.test.mjs tests/progress-queue-suspend.test.mjs`（合跑） | `10 / 10 / 0` | **`11 / 11 / 0`** | 收工实跑 |
| 整族合跑（`background-tasks` + `notification-power-save` + `progress-cancel-wait` + `progress-notices` + `progress-queue-suspend` + `progress-tasks`） | `35 / 35 / 0` | `35 / 35 / 0` | 只跑自己域，不跑全量 `npm test`（12 路并行） |
| `npx vue-tsc -b --force` | —— | **退出码 0、`error TS` 计数 0**（stdout 0 行） | 本批改动落地那一次采的；**收工最后一次复跑采到 5 条**，逐条都在别人名下文件 ⇒ 见 §3b |
| `node --test tests/module-size.test.mjs` | `5 / 5 / 0` | `5 / 5 / 0` | 上限一个没动；`src/backgroundTasks.ts` 386 行 < 900 |
| `node .tools/find-param-props.mjs` | —— | `共 0 处参数属性` | |
| `node .tools/find-ts-in-mjs.mjs` | —— | `干净：tests/*.mjs 全部是纯 JavaScript。` | 新用例里没有任何 TS 语法 |
| `node .tools/find-missing-ext.mjs` | `扫描 1279 个文件` | **`扫描 1291 个文件`、`干净`** | 新用例的值 import 写了全 `.ts` 扩展名（`../src/notificationPowerSave.ts`）。中间一次采到 1287 —— 这个数随并行桶落文件在动（开工 1279 → 收工 1291），本批自己只加了 1 个 import；两次都是 `干净` |
| `node .tools/find-orphan-modules.mjs --gate` | 孤儿 9 / 基线 9 | **`已登记孤儿 9 / 基线 9 · 新增 0 · 本轮清掉 0` ⇒ 绿** | 本批没新建 `src/*.ts` 模块；**收工最后一次复跑采到「新增 2」**（`src/enterHandlerOrder.ts`、`src/runStartupFocus.ts`，都不是本批建的）⇒ §3b |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | `11 / 9 / 2` | `11 / 9 / 2`（**同一对红，不是本批造成的**） | 锚点门控自己的 4 条全绿（快照 1627 条 / 活引用 2533 / 未入快照 906）；本批两份新文档带的引用计入"未入快照"——门控第 ③ 条对新增引用**只报数不拦**（`tests/source-citation-anchors.test.mjs:10-11`），拦的是快照里既有锚点漂移。红的是「仓里每一条带路径的上游引用都指得到」，在两个文件里各跑一次 ⇒ 计 2；逐条归属见下面原始输出：全部在**本批没碰过**的 4 份别人文档里，本批两份新文档命中 0 条（收工实跑 `grep` 过） |

收工原始输出（照抄，不加工）：

```
### 1) 派单点名的两个测试文件（单独）
ℹ tests 7
ℹ pass 7
ℹ fail 0
### 2) progress-queue-suspend
ℹ tests 4
ℹ pass 4
ℹ fail 0
### 3) 两文件合跑
ℹ tests 11
ℹ pass 11
ℹ fail 0
### 4) 整族（progress* + power-save + background-tasks）
ℹ tests 35
ℹ pass 35
ℹ fail 0
```

```
$ npx vue-tsc -b --force
（stdout 空：0 行）  errorTS=0
```

```
$ node .tools/find-param-props.mjs
共 0 处参数属性（每个都会让引用它的 node --test 用例加载失败）
$ node .tools/find-ts-in-mjs.mjs
干净：tests/*.mjs 全部是纯 JavaScript。
$ node .tools/find-missing-ext.mjs
扫描 1287 个文件（src + tests）里的 from / 副作用 / 动态 三种 import 形态
干净：没有漏扩展名、且静态也解析不到的相对 import。
$ node .tools/find-orphan-modules.mjs --gate
词法自检：0 异常（每个 specifier 都在原文里逐字存在）
门禁：已登记孤儿 9 / 基线 9 · 新增 0 · 本轮清掉 0
门禁绿：没有基线之外的新增零消费方模块。
```

```
$ node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs
锚点核对：快照 1627 条 / 仓里活引用 2533 条 / 未入快照 906 条 / 区间为空 3 条
ℹ tests 11
ℹ pass 9
ℹ fail 2
✖ 仓里每一条带路径的上游引用都指得到（参考树在时）   ← 两个文件各跑同一条
```

那 2 条红的**逐条归属**（`grep -oE` 从门禁报错里取出的全量清单，去掉重复；
**每条假坐标在 `.java`/`.kt` 与行号之间多了一个空格** —— 引用门会把文档里**转述**的「路径:行号」当成一条真引用收集（规约 §5），
带行号原样抄一遍 = 自己再造 7 条红；去掉这个空格就是门禁的原文，其余一字未动）：

```
docs\batch-2026-10-06-projecttree.md        :: platform/lang-api/src/com/intellij/psi/util/PsiUtil.java :223-226                    —— 参考树里没有这个文件
docs\batch-2026-10-06-status2.md            :: platform/analysis-api/src/com/intellij/codeInsight/SuppressIntentionAction.java :19  —— 参考树里没有这个文件
docs\batch-2026-10-06-status2.md            :: platform/structure-view-impl/src/com/intellij/ide/structureView/StructureViewFactoryImpl.java :49-50 —— 参考树里没有这个文件
docs\batch-2026-10-06-welcome2.md           :: platform/analysis-api/src/com/intellij/codeInsight/SuppressIntentionAction.java :19  —— 参考树里没有这个文件
docs\wiring-requests-2026-10-06-vcs2.md     :: platform/editor-ui-api/src/com/intellij/openapi/editor/settings/EditorSettingsExternalizable.java :76 —— 参考树里没有这个文件
docs\wiring-requests-2026-10-06-vcs2.md     :: platform/analysis-api/src/com/intellij/codeInsight/SuppressIntentionAction.java :19  —— 参考树里没有这个文件
docs\wiring-requests-2026-10-06-vcs2.md     :: platform/structure-view-impl/src/com/intellij/ide/structureView/StructureViewFactoryImpl.java :49-50 —— 参考树里没有这个文件
```

**2026-10-06 citefix 已按真源码订正（留痕见 `docs/batch-2026-10-06-citefix.md`）**：上面 7 行涉及的 4 条假路径，真坐标分别是
`java/java-psi-api/src/com/intellij/psi/util/PsiUtil.java:223-226`（`ACCESS_LEVEL_PUBLIC = 4` / `PROTECTED = 3` / `PACKAGE_LOCAL = 2` / `PRIVATE = 1`）、
`platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java:19`、
`platform/structure-view-impl/src/com/intellij/ide/structureView/impl/StructureViewFactoryImpl.java:49-50`（`AUTOSCROLL_MODE = true` / `AUTOSCROLL_FROM_SOURCE = false`）、
`platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:76`（`public boolean SHOW_QUICK_DOC_ON_MOUSE_OVER_ELEMENT = true;`）
—— 四条都只是**包路径写错/少一层**，行号与内容原本都对得上。

⇒ **没有一条指向我这两次改动的文件**（`src/backgroundTasks.ts`、`tests/progress-queue-suspend.test.mjs`；顺带说明：`tests/` 本来就不在这两个门的扫描面里 —— `source-citations.test.mjs:88-89` 写明「不扫 tests/：用例里必须放假引用才能自证门控会响」，扫描面是 `src`/`native`/`docs`）。这四份文档的属主不在我 ⇒ 按 §2 不动别人的文档，交主代理分派（`status2.md` 的 §3 那一条自己已经登记过同样两行，与本批观察一致）。

### 3b. 收工最后复跑：并行 lane 在途带来的两条红（**逐条归属，没有一条是我的**）

上表那批数字是本批自己改动落地时采的。收工前我又把全部门禁复跑了一遍（共享工作区，12 路并行），
采到**两条新红**，都指在别人名下文件上 —— 按 `status2.md` §3 的先例如实留痕，不动别人的现场、也不冒充绿灯：

```
$ node .tools/find-orphan-modules.mjs --gate
门禁：已登记孤儿 9 / 基线 9 · 新增 2 · 本轮清掉 0
   ✘ 新增零生产消费方模块：src/enterHandlerOrder.ts
   ✘ 新增零生产消费方模块：src/runStartupFocus.ts
门禁红：2 个**新增**零生产消费方模块。
```

本批**一个 `src/*.ts` 模块都没新建**（§5 那条自查在位时是 `新增 0`），这两个文件名的前缀（enter handler / run startup focus）归桶 3/9 与 execution 域。

```
$ npx vue-tsc -b --force          # 收工最后这一次
src/editorSemanticField.ts(148,49): error TS2345: Argument of type 'StateField<SemanticLayer>' is not assignable …
src/refactorPreview.ts(207,7): error TS2322: Type '"file" | "class" | "method" | "directory"' is not assignable to type '"file" | "directory"'.
src/runInstances.ts(611,3): error TS2322: Type '{ id: number; title: string; duplicateTitle: boolean; …
src/usageViewGrouping.ts(458,31): error TS2345: Argument of type '"file" | "class" | "method" | "directory"' is not assignable …
src/usageViewGrouping.ts(462,12): error TS2322: Type '"file" | "class" | "method" | "directory"' is not assignable to type '"file" | "directory" | "usage"'.
```

⇒ `error TS` 共 **5** 条（本批改动落地那一次是 **0** 条、退出码 0），`grep -cE "backgroundTasks|progress-queue-suspend"` 对全量输出 = **0**：
**没有一条指向本批名下文件**。这两条红都属主在别人手里，交主代理分派；本批没有为了让它们变绿去碰别人的文件（那是 §2 的越界）。

本批域内最后复跑（收工时刻）：

```
$ node --test tests/background-tasks.test.mjs          → tests 7  / pass 7  / fail 0
$ node --test tests/progress-queue-suspend.test.mjs    → tests 4  / pass 4  / fail 0
$ node --test tests/module-size.test.mjs               → tests 5  / pass 5  / fail 0
$ node .tools/find-missing-ext.mjs                     → 扫描 1291 个文件（src + tests）… 干净
$ node .tools/find-ts-in-mjs.mjs                       → 干净：tests/*.mjs 全部是纯 JavaScript。
```

---

## 4. 反向验证（注入违规 → 确认变红 → 撤掉 → 复绿）

### 步骤 1：把缺陷 ① 注回代码（"挂起原因不是响应式的"）

注入方式（一行，语义 = 当年那条普通 `let`：有 `.value` 读写口、但**不是**响应式来源）：

```ts
// src/backgroundTasks.ts:184
- const queueSuspendReason = ref<string | null>(null)
+ const queueSuspendReason = { value: null as string | null }
```

- **注入后**：`node --test tests/background-tasks.test.mjs tests/progress-queue-suspend.test.mjs`
  ⇒ `ℹ tests 11 / ℹ pass 9 / ℹ fail 2`，红的两条：

```
✖ 挂起时那一行带着原因（唯一通道 queueRow），任务卡在检查点上；恢复后放行并收行
  AssertionError [ERR_ASSERTION]: 挂起时队列必须补一行：正在跑的那条由各功能自己画，它不知道队列被挂起了
      at tests/progress-queue-suspend.test.mjs:66:10
✖ 只改挂起原因这一件事：那一行的文案必须真的更新（响应式判据）        ← 本批新增的那条
  AssertionError [ERR_ASSERTION]: 挂起时队列必须补一行（改原因必须让 computed 失效）
      at tests/progress-queue-suspend.test.mjs:133:10
```

  整族合跑（6 个文件）⇒ `ℹ tests 35 / ℹ pass 33 / ℹ fail 2` —— 只有这两条响，其余 33 条全绿。
  **附带取证（值得记）**：`tests/notification-power-save.test.mjs` 注入下**不红**（它的 `:124` 是在挂起之后第一次读
  `queueRow.value`，从没建立过缓存/依赖集 ⇒ 钉不住响应式；这就是"必须有'先断言不显示'那一步"的实证）。
- **撤掉注入**（改回 `ref<string | null>(null)`）：`11 / 11 / 0`，整族 `35 / 35 / 0`。

### 步骤 2：把死出口 ② 注回返回对象（清单门禁会不会响）

```ts
// src/backgroundTasks.ts（返回对象第一行之后）
+ runningSuspendedText: ref(''),
```

- **注入后**：`node --test tests/progress-queue-suspend.test.mjs` ⇒ `ℹ tests 4 / ℹ pass 3 / ℹ fail 1`，
  红的那条 = 「队列的对外状态是一份精确清单：没有零消费方的死出口」，`AssertionError: Expected values to be strictly deep-equal`
  （`deepEqual` 直接报出多出来的那个键名 —— 不是 `includes`，加一条没登记的键就红）。
- **撤掉注入**：`4 / 4 / 0`（合跑 `11 / 11 / 0`）。

### 步骤 3：新判据自身"必须会响"的另一面（不是放松，是收紧）

新用例里三条是**整句 / deepEqual**，不是 `includes`：
`assert.deepEqual(visible(), before)`（除原因外六个可见状态逐个钉）、
`assert.equal(row.detail, '已挂起：<原因>（正在跑的那条会在下一个检查点让路）')`（整句）、
`assert.equal(queue.queueRow.value, null)`（挂起前与恢复后各一次）。
把 detail 里任何一个字改掉都会红；原因用的是真常量 `POWER_SAVE_SUSPEND_REASON`（`src/notificationPowerSave.ts:135`
= `src/notificationPowerSave.ts:48` 那句通知正文），**没有自造文案**。

---

## 5. 零消费方自查结论

- **本批新增的符号/出口：0 个。** 只新增一条测试用例（`tests/progress-queue-suspend.test.mjs:84-146`）+ 一处注释订正，
  没导出任何新东西；`node .tools/find-orphan-modules.mjs --gate` ⇒ 新增 0（§3）。
- **派单 ② 的复核**：`grep -rn "runningSuspendedText\|currentSuspender" src tests native docs` 共 10 处命中，逐条归类：
  `src/backgroundTasks.ts:199`、`:268`（删除留痕注释）；`tests/progress-queue-suspend.test.mjs:4`、`:26`、`:34`（历史说明 +
  `doesNotMatch` 门禁本体）；`docs/batch-2026-10-06-status2.md:28,29,53,99,123`、`docs/batch-2026-10-06-statusbar.md:38,134`（两份历史报告）。
  ⇒ **代码里的真实消费方 0**，两条死出口确实没了，且回不来（§4 步骤 2 实测红）。
- **发现但不在我可改面**（`src/progressSuspender.ts`，派单没写 ⇒ 只读；逐条 grep 全仓 `src` + `tests` + `native`）：
  | 符号 | 位置 | 消费方 |
  | --- | --- | --- |
  | `ProgressSuspender.text()`（上游 `getSuspendedText()` 的投影） | `src/progressSuspender.ts:53`（接口）、`:86`（实现） | **0**（面板读的是队列级 `queueSuspendReason`，不是它） |
  | `ProgressSuspender.suspendedText` 属性 | `src/progressSuspender.ts:49` | 只被上面那条 0 消费的 `text()` 读 ⇒ 传递性 0 |
  | `ProgressSuspenderTracker.suspended()` | `src/progressSuspender.ts:150-152` | **0**（`suspenders.suspended(` 全仓无命中） |
  | `ProgressSuspenderTracker.suspendAll()` / `resumeAll()` | `src/progressSuspender.ts:154-156` / `:158-160` | **0**（两个名字在全仓只命中定义那一行） |
  ⇒ 这四条是"只过自己测试的死面"这一族的**同一形态**，但清理要动别人的文件、且 `text()` 的处置与 §1 第 4 行那条兜底口径**是同一件事**（要么接进 `queueRow` 变成唯一显示源，要么删）⇒ 写成请求 **W2 / W3**，本批不自作主张删（那会让 status2 桶的在途现场漂）。
- `queueSuspendReason` 的消费方（防下一轮当死码清）：`src/backgroundTasks.ts:208`（`applySuspend`）、`:218`（`pump` 的挂起闸）、`:275`+`:285`（`setSuspended`/`isSuspended`）、`:364-367`（`queueRow`）—— 四处，其中 `:360` 就是本批判据钉住的那一处。
- 队列对外键清单仍然只有那 14 条（`tests/progress-queue-suspend.test.mjs:28-32` 的 `deepEqual`），本批一条没加。

---

## 6. 做不到 / 无法核实（逐条具体卡点）

1. **`AGENTS.md` 打不开**：派单让"开工先读 `D:\TaoCode\.tools\agent-rules.md` 和 `AGENTS.md`"，
   前者读了（全文 79 行）；后者 `Read` 返回 "File does not exist"，`ls` 根目录也确实只有 `HANDOFF.md`/`ROADMAP.md` 等 ⇒
   开工只拿到一份规则。如果 `AGENTS.md` 应该在位（或是别的文件名），请主代理补上，否则这条指令永远只能核一半。
2. **派单 ① 的"把挂起原因改成响应式的"没做成"实现改动"**：不是没做，是**已经在位**（`src/backgroundTasks.ts:184`）。
   卡在开工的第一次读文件；我按 §1「判词可能是编的 ⇒ 动手前自己打开文件核实」停手，改为补判据 + 注入反向验证（§4 步骤 1 有数字）。
   若主代理认为"已经修好"这件事需要**另一个**证据形态，本报告给的证据是：注入非响应式版本 ⇒ 2 条用例红、33 条不红。
3. **派单 ① 的"再只改挂起原因，断言行文案真的更新"没有做成 A→B 那一步**：上游 `…/ProgressSuspender.java:125`
   在已挂起时是空操作（第一个 reason 赢，直到 `resumeProcess()`），`…/TaskInfoEntityCollector.kt:172-179` 又只在状态**变化**时推文案 ⇒
   上游根本没有"挂起中途换 reason ⇒ UI 换文案"这条行为。新用例因此钉的是 `null → reason`（真实触发点只做这一档，
   `src/notifications.ts:298`）+ 整句文案，**故意不钉 A→B**（钉了就是把一条与上游相反的猜测值焊进判据，下一批只能"放松断言"才能过，那是 §3 禁的）。
   本仓现状 A→B 会换文案（`src/backgroundTasks.ts:275` 无条件写 ref），与上面那句上游语义有偏差，今天不可观测（没有第二个触发者）⇒ 留给主代理定口径。
4. **任务体真的让路**：仍然卡在 `src/gradleHost.ts:204-208`（`run` 不带 `indicator`），文件不在我可改面 ⇒
   status2 的请求 W3（`docs/wiring-requests-2026-10-06-status2.md`，与本请求文件里的 W3 是两回事）仍然有效，本批复核后没有另开一条。
5. **判词同步**：卡在 `docs/inventory/verdict-platform_rest.md`（派单列为保留文件）与它的生成源 `scripts/verdict_table.py`（同样保留）⇒
   只能写请求（W1），不能自己动手；那 34 处 json reason 是脚本生成的，改文档不改脚本会漂。
6. **没跑 ctest**：本批一个字节都没动 `native/`（§5 那条只对改了 native 的路要求）。
7. **没跑全量 `npm test`**：按 §5「12 路并行，只跑自己域」，全量的在途红不该算到本批头上；本批跑过的最大集合是那 6 个进度族文件（`35 / 35 / 0`）。

---

## 7. 改动文件清单（`wc -l` 前后）

| 文件 | before | after | 这次动了什么 |
| --- | --- | --- | --- |
| `tests/progress-queue-suspend.test.mjs` | 81 | **146** | 新增 1 条判据（`:84-146`「只改挂起原因这一件事」，含 4 条上游依据注释）；模块头第 11-14 行那份"这里钉 N 件可数的事"清单补到第 4 件；新增一条值 import（`../src/notificationPowerSave.ts`，带全 `.ts` 扩展名） |
| `src/backgroundTasks.ts` | 382 | **386** | **只有注释**：`:231-236` 那段兜底文案说明按实情订正（+4 行），并留痕"原写 X、实际 Y"；实现一行没改（§0 表第 1 行说明为什么）；§4 的两次注入都已撤（`git diff` 自查过 hunk，见下） |
| `docs/batch-2026-10-06-status2defect.md` | —— | 新建（本文件） | 交付报告 |
| `docs/wiring-requests-2026-10-06-status2defect.md` | —— | 新建 69 行 | 需要主代理接的三条线（保留文件里的过期判词、挂起原因的显示源、别人名下那三条零消费 tracker 方法） |

改完自查（§6「改完 `git diff -- <文件>` 自查 hunk 全是你这次的」）：
`src/backgroundTasks.ts` 的 diff 里属于本批的只有那一段注释（`:231-236`）；其余 hunk 是 status2 桶的在途改动
（模块头 +6 行、`awaitResumed()` 的两条放行路径、`runningSuspendedText`/`currentSuspender` 的删除留痕、`queueSuspendReason` 的 `ref`），
本批一条没重排、没有顺手"整理"别人的代码。临时文件 `build/status2defect-tsc-final.txt` 收工删掉。
