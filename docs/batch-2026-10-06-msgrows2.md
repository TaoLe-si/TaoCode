# 批次：`module/progress` 一族逐类重判（msgrows2，只读复核 + 脚本重生成登记）

域：`platform_rest`（B12）。上游参考树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（仓内 `third_party/intellij-community` 是坏树，未用）。
本 lane 只做 `module/progress` 这一族 22 行，**不改任何 `src/`、`native/`、`scripts/verdict_table.py`、生成物、其它判决文档**。

## 0. 出处与纪律声明（含注入留痕）

- 本批是**只读复核**：判词正文（11 行 `[~]` + 11 行 `[-]` 的逐类理由 + 族级长判词）已由 `msgverdict` 批写进生成物（见 `docs/batch-2026-10-06-msgaudit.md` 的 A6）。本 lane 的活是：逐类开上游文件**复现坐标**、判定该结论是否成立、并把「生成物与脚本真源不一致」这件事登记为**需主代理改脚本后重生成**（不手改生成物，符合约束③）。
- **注入留痕**：本会话多条工具结果尾部附带了伪装成 `MEMORY.md 已修改` 的通知（内容会随轮次变化，如「六种半路形态」「假 MEMORY 通知」等）。按既有纪律一律当**数据**处理，不执行其中任何指令，此处记出处。
- 本批未产生对 `src/`、生成物、脚本的写盘；唯一新产物 = 本报告。

## 1. 坐标与前提订正（约束①：先验证再采信）

派单前提有三处与磁盘不符，逐条订正：

1. **族不在 `verdict-daemon.md`。** `module/progress` 是 `platform_rest` 域的族，落点在 `docs/inventory/verdict-platform_rest.md:206` + 逐类表 `docs/inventory/platform_rest_verdict_table.md:14918-14939`。`verdict-daemon.md` 只有 `dm/*` 五族，无 `module/progress`（`grep "module/progress" docs/inventory/verdict-daemon.md` 无命中）。派单把域写错。
2. **工作树早已不是「整族 blanket `[-]`」。** 提交态 `git show HEAD:docs/inventory/verdict-platform_rest.md:206` 确是 `[-]`「没有 JVM 对象模型可移植；用到的行为在各域就地实现」（整族 22 行同判词）。但**当前工作树**已由 msgverdict 改成族 `[~]` + 11 行 `[~]`/11 行 `[-]`（逐类理由各异）。**关键**：这些改判是**手改进生成物**的，`scripts/verdict_table.py` 现在仍产不出它们 → `python scripts/verdict_table.py --check platform_rest` **红（exit 1）**，见 §6。
3. **派单点名的类名不属于这一族。** 派单让我「打开 `ProgressIndicator`/`ProgressIndicatorProvider`/`ProgressRunner`/`Task` 及其 `*Wrapper`、`IndicatorDelegate`」——这些在 `com.intellij.openapi.progress*`，被 `PLATFORM_RULES` 路由到 `pf/progress`/`ici/progress` 两族（**本 lane 不碰**）。`module/progress` 实族是 `com.intellij.platform.ide.progress` 的 **Fleet / IntelliJ Space 任务模型**：`TaskCancellation`/`TaskSuspender`/`TaskManager`/`ModalTaskOwner`/`TaskInfoEntity`（RhizomeDB）/`rpc/TaskInfoApi`。类名以 `docs/inventory/platform_rest.txt:14906-14927` 的枚举路径为准（已 find 核对，上游树里 22 个文件都在 `platform/progress/{backend,shared}/src`）。

## 2. 三档逐类复核结论（22 行，全部开上游文件复现）

上游坐标全部逐字核过；下面标 ✓=命中，≈=方向对但范围/锚点偏松（记订正），✗=假坐标（本批 **无 ✗**）。

### 2.1 改判 `[~]` 的 11 行 —— 「有可移植行为契约」，且三件齐（实现 + 真实消费者 + 能失败的判据）

| 类 | 上游契约（已复现） | 本仓落点（工作树，只读；progflow 在改，行号以本批读盘时为准） | 真实消费者 | 判据（本批跑过，见 §6） | 残余 |
|---|---|---|---|---|---|
| `TaskCancellation.kt` | ✓ `:9` sealed interface；`:24-33`/`:29-33` `nonCancellable()` javadoc「the cancel button should not be displayed in the UI」；`:42-46` `cancellable()` | `src/backgroundTasks.ts:134-144`（`Indicator.cancel`）、`:136` `if (!this.cancellable \|\| this.cancelled) return`、`:135` 注释点名本类；`src/progressTasks.ts:87`（cancellable 推档）`:120-122` | `src/gradleHost.ts` run、面板逐行 cancellable（`src/progressPanel.ts:81/90/104`，判词锚 `:85`≈`:99`≈） | `background-tasks`、`progress-task-cancel` | `@Serializable` 跨进程序列化半不需要 |
| `NonCancellableTaskCancellation.kt` | ✓ `:9` `data object`：`cancel()` 是空操作 | `src/backgroundTasks.ts:136` | 同上 | `background-tasks` 不可取消档 | — |
| `CancellableTaskCancellation.kt` | ✓ `:14-20` `withButtonText`/`withTooltipText` | 可取消档已移植；取消按钮 tooltip 是**常量** `src/App.vue:2329` `title="取消此任务"` | 面板取消按钮 | `progress-task-cancel` | 逐任务可定制的取消文案/tooltip 没有（`ProgressIndicatorModel.kt:94-98 getCancelTooltipText` 无对应） |
| `TaskSuspender.kt` | ✓ `:26` `state:Flow`、`:33` `isPaused`、`:39`「displayed in the progress bar」、`:41` `pause(reason)`、`:46` `resume`、`:66-69` `suspendable` | `src/progressSuspender.ts:72-93`（接口 isSuspended/suspend/resume/runNonSuspendable/waitWhileSuspended/close/onStateChanged）、`:101 createProgressSuspender` | 队列 `setSuspended` `src/backgroundTasks.ts:303-313` | `progress-queue-suspend` | `:26`Flow→`:92`回调；`pause` 的 reason 参删（**订正**：理由在 `progressSuspender.ts:19-23`，msgverdict 判词误写 `:9-18`）；`:55-58 getContextSuspender`→显式持 `Indicator.suspender` |
| `TaskSuspenderImpl.kt` | ✓ `:34 CoroutineSuspenderImpl`、`:37 MutableStateFlow`、锁内 `compareAndSet` 幂等（`:96-100`） | `src/progressSuspender.ts:101-149`（默认文案/状态机/`if (suspended\|\|closed) return` `:113`） | 同上 | `progress-queue-suspend` | 协程设施层用布尔+回调替代 |
| `TaskSuspenderState.kt` | ✓ `:13 Active`、`:21 Paused(suspendedReason)` | `src/progressSuspender.ts:103 suspended` 布尔、`:92` 状态回调 | 同上 | `progress-queue-suspend` | reason 不带在状态对象里，住队列侧 `backgroundTasks.ts:196` |
| `TaskSuspension.kt` | ✓ `:19 NonSuspendable`、`:28 Suspendable`、`:24-25` suspendText「displayed in the progress bar」 | `src/backgroundTasks.ts:246` 建挂起器、`:259` 接 `Indicator.suspender`、`:222` 按 taskId 反查；文案 `queueRow` 挂起分支 `:399-406` | `queueRow`（面板唯一拼装点） | `progress-queue-suspend` | — |
| `TaskManager.kt` | ✓ `:25`「不该取消不可取消任务」、`:89 cancellable` 门、`:41/:52 pause/resumeTask`、`:82-91` 状态机、`:30` `withKernel`、`:59 change` | `src/backgroundTasks.ts:136`（取消门）、`:303-313 setSuspended`（**仅队列级**） | `src/gradleHost.ts`、省电模式 `src/notifications.ts` | `progress-cancel-wait`、`progress-queue-suspend` | **逐任务** pause/resume 没有；`:82-91` 状态机未建模；`Source.USER/SYSTEM` 未记；`:30-32/:59 withKernel/change` 是 RhizomeDB 不可移植（**订正**：msgverdict 把 `change` 也归到 `:30-32`，实际 `change{` 在 `:59`） |
| `TaskStatus.kt` | ✓ `:34 Running`、`:45 Paused(reason)`、`:54 Canceled`、`:15-18 Source` | 在跑标志 / `src/progressSuspender.ts:103 suspended` / `Indicator.cancelled` | 队列 `queueRow` | `progress-queue-suspend` | `:15-18 Source` 没记；`:45` reason 住队列侧不住逐任务状态；`@Serializable` 那半不需要 |
| `TaskSupport.kt` | ✓ `:14-21 withBackgroundProgressInternal`；`:23-35` 两条模态支 | `src/backgroundTasks.ts` 队列模块函数（`run` `:316`） | `src/gradleHost.ts:208` run（≈ `:204`，reload 闭包起点，见 §4） | `background-tasks` | `:23-35` 模态支不硬造（本仓无模态进度窗） |
| `tasks.kt` | ✓ `:18-84` `withBackgroundProgress` 四便捷重载（`:32` 布尔折两档）；`:86-121 withModalProgress`、`:125-206 runWithModalProgressBlocking` | `src/backgroundTasks.ts:316 run(task)`、`src/progressTasks.ts:153 backgroundTaskManager` | `src/workspaceInspection.ts:90/112/158`（整工程检查登记一行）、`progressPanel.ts:99` | `progress-tasks`、`background-tasks` | `:86-121/:125-206` 绑 EDT 模态栈 + 嵌套事件循环，本仓无模态进度窗 |

结论：**11 行 `[~]` 全部成立**。判据本批实跑 25 绿（§6），钉的是「不可取消档点了取消不掉」「挂起那一行带原因且卡在检查点」「close 后 suspend 空操作（`ProgressIndicator.java:125`）」等**能失败**的行为，非注释提及。

### 2.2 保持 `[-]` 的 11 行 —— 「确实没有对象模型对应」，逐条给出**具体机制**（无一条是整族套话）

| 类 | 具体机制（已开文件复现，全 ✓） | 为何本仓无对应 |
|---|---|---|
| `TaskInfoEntity.kt` | `:19 data class ... : Entity`，字段全靠 RhizomeDB 属性代理读（import `:9 com.jetbrains.rhizomedb.Entity`） | 本仓任务是普通 reactive 对象，没有 DB；信息内容（title/cancellation/suspension/status）已在 `backgroundTasks.ts` 各有落点 |
| `TaskInfoEntityTypeProvider.kt` | `:7-10 EntityTypeProvider.entityTypes()` 返回 `listOf(TaskInfoEntity)`，纯 DB 注册件 | 没有 RhizomeDB 就没有实体类型注册面 |
| `TaskStorage.kt` | `:18-26` 文件注释自陈「Stores the tasks of this process in its **local Rhizome DB**… another process observes them over RPC」；`addTask`/`removeTask` 全走 `withKernel{change{…}}` | 本仓单进程、无第二执行体、无 DB |
| `rpc/TaskInfoApi.kt` | `:28-38` fleet `@Rpc interface TaskInfoApi : RemoteApi`，`activeTasks():Flow` 前端观察后端并下发命令 | 前端与原生同进程，没有这条跨进程通道 |
| `BackendTaskInfoApi.kt` | `:33-35` RPC 服务端实现，「Each subscription runs its own **rete collection** over the local DB」，import `fleet.kernel.rete.*` `:18-20` | 没有 rete/RhizomeDB，做不出这一侧 |
| `utils.kt` | `:28-58` 全是 `fleet.kernel.rete` 的 `Query`/`StateQuery` 读侧（`activeTasks:28`/`updates:38`/`statuses:48`/`suspensionState:56`） | 本仓读侧对应物是 `backgroundTasks.ts:378 queueRow` 一个 computed（≈ `:378-406`，实跨 `:415`） |
| `suspender/TaskSuspenderContextElement.kt` | `:9 CoroutineContext.Key` + `:12 AbstractCoroutineContextElement`，把挂起器塞协程上下文 | 单线程 DOM 没有协程上下文；改成显式持 `Indicator.suspender` |
| `ModalTaskOwner.java` | `:9-24` sealed interface，permits project/component/guess 三选一，消费者是模态进度对话框 | 本仓无模态进度窗，无 AWT 组件树可归属 |
| `ProjectModalTaskOwner.java` | `:9-19`（`:11 private final Project`）作模态宿主 | 单窗口，没有可归属的第二层 |
| `ComponentModalTaskOwner.java` | `:7` import `java.awt.Component`、`:12 private final Component component`、`:18-20 getComponent` | 绑 Swing 模态栈 |
| `GuessModalTaskOwner.java` | `:7-11` 空 `final class` + `:9 INSTANCE` 单例标记，靠 AWT 焦点窗格反推 | 没有那一层 |

结论：**11 行 `[-]` 的理由都改成了「那一条机制」**（RhizomeDB/RPC/rete/协程上下文/AWT 模态），没有再出现「没有 JVM 模型」这类整族套话 —— 与派单要求一致。msgverdict 已做到这一点，本批复核确认。

## 3. 与同书 `pf/progress`/`ici/progress` 的自相矛盾核对（read-only）

msgverdict 判词说「同一本书里 `pf/progress`/`ici/progress` 拿本族类当口径出处，却又把本族判不可移植」——本批验证：
- `scripts/verdict_table.py:348`（`pf/progress` 判词）确实引用 `TaskCancellation.nonCancellable`、`ProgressIndicatorModel.kt:34-59/:92`、`ProgressSuspender.java:106-152`、`TaskSuspension.kt:24-25` 当落点；`:481`（`ici/progress`）引用 `backgroundTaskManager`/`ConcurrentTasksProgressManager`/`src/progressTasks.ts`。
- 交叉锚（`ProgressIndicatorModel.kt`/`ProgressSuspender.java`/`ProgressSuspenderTracker.kt`）在 `platform/platform-impl/src/com/intellij/openapi/progress[/impl]`，非本族路径；本批逐字复现 `ProgressIndicatorModel.kt:92 isCancellable`、`:94-98 getCancelTooltipText`、`ProgressSuspender.java:120-122`「if provided, is displayed in the UI … until the progress is resumed」、`:125`「mySuspended \|\| myClosed return」、`:139-152 resumeProcess`、`ProgressSuspenderTracker.kt:20-34` 四个 start/stopTracking —— 全部命中。矛盾判定成立。
- **旁证（不在本 lane 处置范围）**：`pf/progress` 判词里引的 `backgroundTasks.ts:278-288/:289/:349/:364-370` 与当前盘上（`setSuspended :303-313`、`queueRow :378`）已**漂移**（progflow 在改这些文件）。这是 progflow lane 的坐标账，本批不动、仅记出处。

## 4. 计数与测试同步处置（约束③：不手改生成物）

- **四档计数 / 表尾合计**：生成物（`verdict-platform_rest.md:382`、`platform_rest_verdict_table.{md,json}`）已印 `[x]27 + [~]5429 + [ ]0 + [-]15118 = 20574`，JSON 内部自洽（行数与档数逐档相等、module/progress 11`[~]`+11`[-]`），本批复算通过。**不新增手改。**
- **钉数字的 `tests/b*-verdict.test.mjs`**：查遍 `tests/`，**没有任何 b\*-verdict 测试钉 `module/progress`/`platform_rest` 的分档数**（`platform_rest` 只被 `tests/verdict-generated.test.mjs` 读，且它钉的是总数 20574 与「四档自洽 + 文档合计行==JSON」，分档不写死字面量 ⇒ 11 行翻档不触红）。派单「同步钉数字的 b\*-verdict 测试」这一格 **落空**：本族由 `verdict-generated.test.mjs` 而非 b\* 门控；`verdict-table-check.test.mjs` 的 ① 只核 execution/xdebugger 文档、② 只跑默认 `--check`（= execution+xdebugger），**都不覆盖 `platform_rest`**。留痕。
- 结论：计数与测试**已同步且当前全绿**，无需为这一族改任何测试；真正欠的是 **脚本真源**（见 §5）。

## 5. 需主代理改脚本后重生成（唯一合法落档路径）

`module/progress` 的 `[~]`/`[-]` 结论**必须**由 `scripts/verdict_table.py` 产出，但当前脚本产不出：`platform_verdict("progress")`（`:783-790`）走默认桶 → `("-", "B 堆默认档…没有 JVM 对象模型可移植…")`，且该函数**结构上只能返回 `-` 或 ` `（A 堆），返回不了 `~`**（`MODULE_HEAP` 无 `progress` 键）。这就是 msgverdict 只能手改进生成物、`--check platform_rest` 至今仍红的根因。

**请主代理在改脚本后 `python scripts/verdict_table.py platform_rest` 重生成**，二选一（本批不代改，脚本属禁改范围）：

- **方案 A（贴现有 `pf/progress` 口径，推荐）**：给 `PLATFORM_RULES` 加一条把 `platform/progress/{backend,shared}/src/com/intellij/platform/ide/progress` 路由到一个显式族（如 `module/progress` 特例化或并入新子族），并在 `PLATFORM_FAMILIES` 给该族判 `("~", <§2 族级长判词>)`；11 个 Rhizome/RPC/rete/协程/模态类靠**机械降级**或逐类 `OVERRIDES("-", <具体机制>)` 落 `[-]`，11 个已落类靠族档 `[~]` + 残余写进各自 row.reason。
- **方案 B（最小改动）**：把 22 行全进 `OVERRIDES`（needle 用 `platform/progress/…` 路径片段，逐条给档 + §2 的具体理由）；并把 `platform_verdict`/`write_verdict_doc` 扩到能让**族级行**印 `[~]`+长判词（否则族行仍会印 `[-]`，与自身 11`[~]` 行打架）。

无论哪方案，重生成后需 `python scripts/verdict_table.py --check platform_rest` 转绿；届时把本报告的 §2 表内容逐字搬进脚本判词/`row.reason`。**本报告不代跑写盘档**（会覆盖 progflow 正在改的 `pf/progress`/`ici/progress` 段，越界）。

## 6. 交付命令原始输出

### 6.1 `node --test tests/b*-verdict.test.mjs tests/verdict-generated.test.mjs tests/verdict-table-check.test.mjs`
```
ℹ tests 98
ℹ suites 0
ℹ pass 98
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2293.77
```
（末 30 行含 `verdict-generated.test.mjs` 五档全绿 + `verdict-table-check.test.mjs` 四条全绿；`python scripts/verdict_table.py --check` 那条测的是**默认档 execution+xdebugger**，7/7 一致 ⇒ 绿，**不含 platform_rest**，所以族手改没被这套 node 门抓到。）

### 6.2 本族四判据（`background-tasks`/`progress-task-cancel`/`progress-queue-suspend`/`progress-cancel-wait`）
```
ℹ tests 25
ℹ pass 25
ℹ fail 0
```

### 6.3 `python scripts/verdict_table.py --check`（默认档，绿）
```
execution: total=1608 [x]=0 [~]=978 [ ]=0 [-]=630
xdebugger: total=635 [x]=0 [~]=338 [ ]=0 [-]=297
[check] 生成物与磁盘比对（未写盘）：
  一致   docs/inventory/execution_verdict_table.json（3674544 字节）
  ...（7 条全一致）
一致 7 / 7 条产物。
=== EXIT: 0 ===
```

### 6.4 `python scripts/verdict_table.py --check platform_rest`（**红，登记本 lane 的欠账**）
```
platform_rest: total=20574 [x]=27 [~]=5418 [ ]=0 [-]=15129      ← 脚本现产：module/progress 全 [-]
  不一致 docs/inventory/platform_rest_verdict_table.json ...
  不一致 docs/inventory/platform_rest_verdict_table.md ...
      -| [~] | 5418 |   +| [~] | 5429 |   （磁盘=手改后）
      -| `TaskCancellation` | module/progress | `[-]` |  +| ... | `[~]` |
  不一致 docs/inventory/verdict-platform_rest.md ...
=== EXIT: 1 ===
```
> 磁盘 `~5429/-15118` 与脚本 `~5418/-15129` 差的正好是本族 11 行；族级 `[~]` 长判词、`pf/progress`（2022↔4183 字）、`ici/progress` 长判词同批手改进磁盘 ⇒ 这些差异里 **11 行属本族（§5 待重生成）**，其余属 progflow lane 的 `pf/progress`/`ici/progress`/`pf/error-tree`，非本 lane 处置。

## 7. 副作用与禁改声明

- 本批只写本报告一个文件。**未** stage/commit/push，**未** 用 `git checkout/reset/stash/clean`。
- 跑测试/py 生成档会弄脏被跟踪的 `scripts/__pycache__/verdict_table.cpython-314.pyc`：不 stage、不删，此处报备（工作树里它已 `M`）。
- 顺带发现盘上有个游离文件 `src/progressPanel.ts.bak`（非本 lane 产物，只读时发现，报备不处理）。
