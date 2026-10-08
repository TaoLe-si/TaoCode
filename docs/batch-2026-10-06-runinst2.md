# batch: runinst2 — 运行实例族（exec / run-instances）剩余用户可见缺项

Lane: `runinst2`　分支: `parity/rebuild-inventory`　日期: 2026-10-06
参考树（唯一可用）: `D:\Backup\Downloads\intellij-community-master\intellij-community-master`
禁引: `third_party/intellij-community`（坏树）

> 本报告逐步落盘。每条坐标均为「自己打开文件核实后」的结果；核不实的写「无法核实」，不编。

## 结论（先行，三句）

1. **落了一条真缺陷并今天就生效**：运行仪表盘的实例行**自己按 `instance.id` 数名字**，而标签条/「正在运行」清单
   按「全部记录按 id 升序的下标 + 1」数 ⇒ 记录被 `forget()` 删掉后同一条实例在标签条叫「运行 1」、在仪表盘叫「运行 702」。
   上一轮（runinst）已把前两处收敛到行模型并把理由写在 `src/runInstances.ts:456-460`，**漏了仪表盘这第三处**。
   本批按 `src/components/RunConsole.vue:131` 已有的投影形状补齐（`src/runDashboard.ts:131-152`），
   并把可停性 / kill 档 / 停止文案 / pid 描述一并交给行模型（`src/runDashboard.ts:73-88`）；
   状态四档与文案在模块里**只剩一份实现**（`src/runDashboard.ts:99-120`）。净 **+57 行**（`src/runDashboard.ts` 211→268），
   判据净 **+80 行**（`tests/run-instance-rows.test.mjs` 422→502，5 条新判据），`src/runInstances.ts` **0 净增**（869 行原样）。
2. **一条判 `[~]` 并给了具体后端卡点**：进程结束归因（起进程失败却显示「已停止」）缺的是**宿主那一列状态源** ——
   `native/run_host.cpp:338-339`/`:345` 发 `code:-1` 且不带 `aborted`，与用户停止（`:309`/`:406-407`）在前端**不可分辨**；
   上游靠 `ProcessHandler` 内存里的 `TERMINATION_REQUESTED`（`RunDashboardRunConfigurationStatus.java:71-73`）。⇒ 请求 W-2。
   我**没有**为了判据变绿去动 `exit === -1 ⇒ stopped` 那三条既有断言。
3. **门禁：本域全绿，两条红的都不归我**——域测试 `220/220/0`、隔离 `tsc` `0 error`、`module-size 5/5`、
   `find-missing-ext`/`find-param-props`/`find-ts-in-mjs` 全干净、`grep -rn RUNINST2 src/ tests/ native/` = **0**；
   `find-orphan-modules --gate` 红在 `src/usageViewTreeModel.ts`（别车道在飞）、
   `source-citations`/`anchors` 红在 `docs/batch-2026-10-06-findrep2.md`、`…-termset.md`、`ProblemsPanel.vue` 等，
   **本批交付文件贡献 0 条 offender**（复跑取证见 §4.1）。另：`docs/batch-2026-10-06-runinst2.md` 这个路径被
   **同代号 `runinst2` 的第二路切片（运行控制台滚动族）追加了它自己的报告** —— 读盘核实过它的码是真的、
   且两路文件面不重叠，我**没删它**，取证与归属见 §4.2。

## §0 结论表（速览）

| 项 | 判定 | 一句话 |
|---|---|---|
| 运行仪表盘的行名/可停性/kill 档/停止文案/pid 描述**从行模型投影**（三处同一个名字） | `[x]` 本批做完，**今天就生效**（不需要宿主改动） | `src/runDashboard.ts:131-152` |
| 状态四档 + 文案的**单一实现**（仪表盘不再自己写一份 switch） | `[x]` 本批收敛 | `src/runDashboard.ts:99-120` |
| 进程结束**归因**（谁结束了进程：用户停 / 链中止 / 起进程失败） | `[~]` 判定与证据落齐，**修法要改宿主** ⇒ 请求 W-2 + §6 D2 | 上游 `RunDashboardRunConfigurationStatus.java:59-76`；本仓 `native/run_host.cpp:309/321/338/345` 的 `aborted` 是重载的 |
| 仪表盘宿主改用新的 `stopText` / `kill` / `stoppable` / `description` | 只写请求 | W-1（`src/components/MainToolbar.vue`，非本 lane 可改面） |
| 「允许并行」重跑确认框 | `[ ]` 仍缺（上一轮就登记着），**卡点是确认框通道**，具体见 §6 D3 | 上游文案 `ExecutionBundle.properties:212-213`（已核实） |
| `RunManager.kt` 的 `名 (N)` 配置唯一名 | `[-]` 不归本 lane：本仓已有 `uniqueRunConfigName`，落点在黑名单文件 | 见 §1 第一行 |
| 中文措辞（本批新加的 4 条） | `[-]` 无法核实 → 按英文原文直译并在注释注明 | 上游无 zh 语言包 |

**族**：`exec/run-instances`（+ 紧邻的 `exec/run-toolbar` 仪表盘那一格）。判定符号：`[x]` 已做 · `[~]` 部分 · `[ ]` 未做 · `[-]` 不适用/不归本 lane。

## §2 已做

### 落点 1 —— 运行仪表盘的行从**行模型**投影（用户可见缺陷，修完立刻生效）

判据文件：`tests/run-instance-rows.test.mjs`。改动：

| 文件 | 前 | 后 | 净 | 动作 |
|---|---:|---:|---:|---|
| `src/runDashboard.ts` | 211 | **268** | **+57** | 行模型投影 + 状态/文案单源 + 新增 4 格 |
| `tests/run-instance-rows.test.mjs` | 422 | **502** | **+80** | 新增 5 条判据 |
| `src/runInstances.ts` | 869 | 869 | **0** | **未动**（只剩 30 行余量 ⇒ 用现成的 `runInstanceRows()` 投影，不新增出口） |

`git diff --stat` 原始数字：`src/runDashboard.ts | 95 ++++++----`、`tests/run-instance-rows.test.mjs | 80 ++++++`，合计 `156 insertions(+), 19 deletions(-)`。

**做了什么**（逐条都有上游依据与真状态源）：

1. **同一个实例在三处必须同一个名字**（`src/runDashboard.ts:136-142`）。
   原缺陷：`src/runDashboard.ts` 旧 `:94` 是 `instance.label || \`运行 ${instance.id}\``，而标签条/清单是
   `runInstanceRows` 的「全部记录按 id 升序的下标 + 1」。记录被 `forget()` 删掉后 id 与下标就分叉
   （`src/runInstances.ts:161-175`），于是同一条实例在标签条叫「运行 1」、在仪表盘叫「运行 702」。
   上一轮已把标签条（`src/components/RunConsole.vue:124-131` 的 `rowsById`）与「正在运行」清单
   （`src/runInstances.ts:462-471`）改成从行模型投影，并把这个理由写在 `src/runInstances.ts:456-460`
   ——**仪表盘这第三处漏了**。本批按 `RunConsole.vue:131` 同样的投影形状补上，三处齐了。
2. **可停性 / kill 档 / 停止文案 / pid 描述**也交给行模型（`src/runDashboard.ts:144-151`，
   `RunDashboardRow` 新 4 格见 `:73-88`）。真状态源 = `RunInstanceRecord.stopping`
   （`src/runInstances.ts:320-323` 的 `markRunInstanceStopping`，上游 `ProcessHandler.isProcessTerminating()` 那一档）
   与 `closed`；判定单源 = `instanceStoppable`（`:589-595`）与 `kill`（`:631`）。
   宿主 `MainToolbar.vue:383` 今天只看 `row.state === 'running'`、文案硬编码 `停止${row.title}`
   ⇒ 拿不到「正在结束途中」那一档（上游换成 **Kill process**，`ExecutionBundle.properties:203`），
   文案也不是上游的 `Stop ''{0}''`（`:208`）。模型侧先给对，宿主见请求 W-1。
3. **状态四档与文案在模块里只剩一份实现**（`src/runDashboard.ts:99-120`）。
   `stateOf`/`statusTextOf` 改为委托 `runInstanceState`/`runInstanceStatusText`。
   留痕：`src/runInstances.ts:518` 与 `:562` 的注释本来就写着「两处不能各说一遍」，
   但**原写「同一个规则」、实际是两份 switch 各写一遍** ⇒ 本批收敛成一份，并在判据里钉住「仪表盘里不该再留一份四档 switch」（`assert.doesNotMatch`）。
4. 行注释里把上游 `content.description = null` 的坐标按我实际读到的 **:401** 写（原判词 `:402`，错一行）；
   `src/runInstances.ts:575` 那处旧注释因此不准 —— 该文件本批保持 0 净增（30 行余量），
   订正以注释单行替换提交给主代理，见请求 **W-3**（不在本 lane 悄悄改，避免与 `execui2` 抢同一文件）。

## §1 坐标核对

**核对方法**：逐条用 `sed -n`/`grep -n` 打开参考树原文，不采信判词与派单给的行号。

| 判词/派单给的坐标 | 核实结果 | 证据（我实际读到的行） |
|---|---|---|
| 派单：`RunManager.kt:51-65` 唯一名规则 `名 (N)`、N 从 1 起 | **成立**，但完整路径是 `platform/execution/src/com/intellij/execution/RunManager.kt`（不在 `configurations/` 子目录） | `:49-65` `suggestUniqueName`：命中已有名时 `extractBaseName` 取基名、`var i = 1` 起、`String.format("%s (%d)", originalName, i)`；`:67` `UNIQUE_NAME_PATTERN = "(.*?)\\s*\\(\\d+\\)"`。**本仓已有等价物**：`uniqueRunConfigName`（消费点 `src/components/RunConfigurationsDialog.vue:343/350/374`）⇒ 属别的 lane 的文件面，本 lane 不动、不重做 |
| 派单：`RunnerAndConfigurationSettings.java` 有 `isActivateToolWindowBeforeRun`（行号自己核） | **文件在** `platform/execution/src/com/intellij/execution/RunnerAndConfigurationSettings.java`（判词若写 `configurations/` 则路径错）；**该符号在这个接口文件里 grep 零命中** | `grep -rn "isActivateToolWindowBeforeRun" …/RunnerAndConfigurationSettings.java` ⇒ `No matches`（文件存在，符号不在此文件）。实现在 `platform/execution-impl/src/com/intellij/execution/impl/RunnerAndConfigurationSettingsImpl.kt` ⇒ 具体行号**未继续追**（不在本 lane 切片），记 §6「无法核实（未追完）」 |
| 原判词：`RunContentManagerImpl.kt:369-376` 设 pid 描述 | **成立**，逐行对上 | `:369` `descriptor.coroutineScope.launch {`、`:370` `val pid = processHandler.nativePid?.await()`、`:373` `content.description = ExecutionBundle.message("process.id.tooltip", pid)` |
| 原判词：`:389-405` 结束清理，**「清那一句是 `:402`」** | **错一行**：`content.description = null` 实际在 **:401** | `:388` `override fun processTerminated(event: ProcessEvent) {`、`:400` `content.icon = if (icon == null) executor.disabledIcon else IconLoader.getTransparentIcon(icon)`、**:401** `content.description = null`。本仓 `src/runInstances.ts:575` 的注释照抄了 `:402` ⇒ 见 D4 订正 |
| 原判词：`ExecutionBundle.properties:204` `process.id.tooltip` | **成立** | `:204 process.id.tooltip=Process ID: {0,number,#}` |
| 原判词：`:202` terminating 进度 / `:203` `Kill process` / `:208` `Stop ''{0}''` / `:209` `Stop All ({0})` | **全部成立** | `:202 terminating.process.progress.title=Terminating ''{0}''`、`:203 terminating.process.progress.kill=Kill process`、`:208 stop.configuration.action.name=Stop ''{0}''`、`:209 stop.all=Stop All ({0})` |
| 原判词：重跑确认框文案在 `:212`/`:213` | **成立** | `:212 rerun.singleton.confirmation.message=''{0}'' is not allowed to run in parallel.…`、`:213 rerun.confirmation.button.text=Stop and Rerun` |
| 新核（本 lane 的主依据）：仪表盘状态的**权威派生** | `platform/lang-api/src/com/intellij/execution/dashboard/RunDashboardRunConfigurationStatus.java:59-76` `getStatus(descriptor)`（已用 `grep -n` 逐行打印核过） | `:60-62` descriptor==null ⇒ CONFIGURED；`:63-65` processHandler==null ⇒ STOPPED；`:67-69` `exitCode==null` ⇒ **STARTED**；`:71-73` `exitCode == 0 \|\| TERMINATION_REQUESTED` ⇒ STOPPED；`:75` else ⇒ FAILED。四档名在 `:21-28`（`run.dashboard.started/stopped/configured/failed.group.name`），bundle 实值：`:373 Running`、`:374 Finished`、`:375 Not Started`、`:376 Failed`。**留痕**：本批最初照自己的初读写成 `:59-77`/`:66-68`/`:69-73`/`:74`（差 1-3 行），逐行打印后订正为上值 |
| 新核：kill 图标那一档 + 两处同一个名字 | 成立，逐行对上 | `platform/execution-impl/src/com/intellij/execution/actions/ShowRunningListAction.java:150` `Icon icon = (processHandler instanceof KillableProcess && processHandler.isProcessTerminating())`、`:151` `? AllIcons.Debugger.KillProcess`、`:152` `: executor.getIcon();`、`:153` `new HyperlinkLabel(descriptor.getDisplayName())`；标签条侧 `RunContentManagerImpl.kt:312` `content.displayName = descriptor.displayName` ⇒ 「名字来自 descriptor」的直证 |
| 新核：`RunDashboardGroup` 只有两格 | 成立 | `platform/lang-api/src/com/intellij/execution/dashboard/RunDashboardGroup.java:23-27` ⇒ 只有 `String getName()` / `Icon getIcon()`（`:24`/`:26`） |
| 新核：`RunDashboardManager.getTypes()/setTypes()` | 成立 | `platform/execution/src/com/intellij/execution/dashboard/RunDashboardManager.java:40-44` ⇒ `Set<String> getTypes()` / `void setTypes(Set<String>)`；同文件 `:38` 另有 `isShowInDashboard`、`:46-48` `getHiddenConfigurations`（本仓无对应物，见 §6） |
| 新核：`RunDashboardDefaultTypesProvider.getDefaultTypeIds(project)` | 成立 | `platform/lang-api/src/com/intellij/execution/dashboard/RunDashboardDefaultTypesProvider.java:12-15` |

### 本仓侧取证（用户可见缺陷的真凭据）

| 事实 | 证据 |
|---|---|
| 宿主 `run.exit` 的 `aborted` 字段是**重载**的：用户停止 = `code:-1 + aborted:true`；启动前链某步失败 = **真实非零 code + `aborted:true`**；起进程抛异常 = `code:-1` 且**没有** `aborted` | `native/run_host.cpp:309`（stop_instance）、`:321-322`（`advance` 链中止）、`:338-339`（`WorkspaceError`，带 `error` 不带 `aborted`）、`:345`（`std::exception`，两样都不带）、`:406-407`（`Manager::stop`） |
| 本仓退出码四档**只看 `exit === -1`**，把 `aborted`/`stopping` 两列都丢了 | `src/runInstances.ts:554-560`（`runInstanceState(running, exit)`）、`src/runDashboard.ts:69-75`（**改前**坐标，下同；`stateOf` 与行模型**各写一遍**） |
| 仪表盘的行名规则与标签条/「正在运行」清单**不同源**：仪表盘按 `instance.id` 数，另两处按「全部记录按 id 排序后的下标 + 1」 | **改前** `src/runDashboard.ts:94` `instance.label \|\| \`运行 ${instance.id}\`` ↔ `src/runInstances.ts:610-611` + `:447-449`。消费方 `src/components/MainToolbar.vue:146` 喂的是 `runInstanceList()`（**已排除 `closed`**，`src/runInstances.ts:161-163`）⇒ 一旦有记录被 `forget()` 删掉（`:166-175`），同一条实例在标签条叫「运行 1」、在仪表盘叫「运行 2」 |
| 上一轮已认定这种「各列表自己数一遍」是错的，只修了两处 | `src/runInstances.ts:456-460` 原文：「同一个实例在标签上叫运行 3、在清单里叫运行 2…这种按各自列表重新数一遍的写法本来就不对」；`runningListRows`（`:462-471`）已改为从 `runInstanceRows` 投影，**仪表盘那第三处漏了** |
| 仪表盘停止格自己另算一遍、且文案不走 `STOP_LABELS` | `src/components/MainToolbar.vue:383` `v-if="row.state === 'running'"` + `:aria-label="\`停止${row.title}\`"` ↔ 上游单源是 `Stop ''{0}''`（`ExecutionBundle.properties:208`），正在结束那档要换成 `Kill process`（`:203`；判定 `StopAction.java` 的 `canBeStopped`/kill 两档本仓已有 ⇒ `src/runInstances.ts:589-595`、`:631`） |

## §2 已做

（待填：文件 + 净行数 + 落点行号）

## §3 判据

新增 5 条，全部在 `tests/run-instance-rows.test.mjs`（本 lane 名下判据文件）：

| # | 判据名 | 钉住什么 | 上游依据 |
|---|---|---|---|
| 1 | 记录被删掉后 id 与起跑下标分叉：仪表盘与标签条必须仍是同一个名字 | 建 701/702 两条无名实例 → 关 701 的视图并让退出到达（`forget()` 真删记录）→ 标签条与行模型都只剩「运行 1」，**仪表盘也必须给「运行 1」** | `RunContentDescriptor.getDisplayName()` 是两处共同的来源：`RunContentManagerImpl.kt:312` 与 `ShowRunningListAction.java:144-158` |
| 2 | 仪表盘的可停性 / kill 档 / 停止文案来自行模型 | `markRunInstanceStopping(711)` ⇒ 该行 `kill=true`、`stopText=杀死进程`；另一行 `stopText=停止『构建』`；退出后那条 `stoppable` 转 false | `ExecutionBundle.properties:203`（Kill process）/`:208`（`Stop ''{0}''`）；`StoppableRunDescriptors.kt:24-26`（已结束不进清单） |
| 3 | 仪表盘的区分描述用上游那句 pid 文案，结束后清空 | 同名两行各给 `进程 ID：4242`/`进程 ID：4243`（pid 由 `applyRunInstanceSnapshot` 回填）；退出后清空成 `''` | `ExecutionBundle.properties:204`；设/清见 `RunContentManagerImpl.kt:369-376`、**:401** |
| 4 | 外来纯输入按本列表下标兜底，不臆造 kill | id 9/11 不在记录里 ⇒ 名字是「运行 1/运行 2」（**不是** id）、`kill=false`、`stoppable` 退回 `running`、`description=''` | 兜底不得凭空造状态（.tools/agent-rules.md §3 铁律「不放假控件」） |
| 5 | 单源核验：状态四档与文案在模块里只有一份实现 | `src/runDashboard.ts` 必须 `return runInstanceState(...)`、`return runInstanceStatusText(...)`、有 `new Map(runInstanceRows().map(...))`，且**不再出现** `case 'running': return '正在运行'` 这份重复 switch | 行模型自身对上表 §1 已核的 `RunDashboardRunConfigurationStatus.java:59-76` |

既有的 4 条交叉判据**一字未放松**：`run-dashboard.test.mjs` 的「状态四档/`运行 3`/汇总」3 条、
`run-instance-rows.test.mjs:369-383` 的「仪表盘与行模型同档位同文案」1 条 ⇒ 全绿（见 §4）。

### 反向验证（三步：注入 → 打红 → 还原 → 核 sha1）

工具：直接改 `src/runDashboard.ts` 的实现行。基线 `sha1 = 031579a9fe20be955831fad547efe55bd349de22`（**注入前**记录）。

| 步 | 注入的变异 | 结果（`node --test tests/run-instance-rows.test.mjs` 原始数字） |
|---|---|---|
| 基线 | 无 | `tests 29 / pass 29 / fail 0`（实现落完、判据落完） |
| 变异 A | 把 `const title = row?.title \|\| instance.label \|| \`运行 ${index+1}\`` 换回旧规则 `instance.label \|\| \`运行 ${instance.id}\`` | **`tests 29 / pass 27 / fail 2`**，其中打印出的红名：`✖ 记录被删掉后 id 与起跑下标分叉：仪表盘与标签条必须仍是同一个名字`。第二条按断言只能是同样钉 title 的第 4 条「外来纯输入…按本列表下标兜底」（该用例断言 `['运行 1','运行 2']`，旧规则给 `['运行 9','运行 11']`）⇒ 这一条的**名字**我没逐条打印，如实标注为推断 |
| 还原 A | 换回投影行 | 之后再注入 B 时 `fail 2` 里没有 title 类用例 ⇒ 反证 A 已还原 |
| 变异 B | `stoppable/kill/stopText/description` 四行换回「只看 `running`、`kill` 恒 false、文案只有 `Stop ’{0}’`、描述恒空」 | **`tests 29 / pass 27 / fail 2`**，两条红名逐条打印到：`✖ 仪表盘的可停性 / kill 档 / 停止文案来自行模型（StopAction 的 canBeStopped 与两档文案）`、`✖ 仪表盘的区分描述用上游那句 pid 文案，结束后清空（:369-376 与 :401）` |
| 还原 B + 核过 | 换回投影实现，`sha1sum src/runDashboard.ts` | **`031579a9fe20be955831fad547efe55bd349de22` = 注入前基线** ⇒ 两次变异都清干净；`tests 29 / pass 29 / fail 0` |
| 探针残留 | `grep -rn "RUNINST2" src/ tests/ native/` | 见 §4（必须 0 命中）。本批全程没用带 lane 标记的探针，变异都是就地替换真实实现行 |

## §4 门禁原始数字

### 4.0 开工前体量余量（`node --test tests/module-size.test.mjs` 独占裁定）

基线运行：`tests/module-size.test.mjs` **5 tests / 5 pass / 0 fail**（开工前，2026-10-06）。

本 lane 名下文件**均未登记进 `REGISTERED`**（`grep -n` on `tests/module-size.test.mjs` 零命中），
因此一律受 `DEFAULT_LIMIT = 900` 管（`tests/module-size.test.mjs:22`）。
门禁用的是 `readFileSync().split('\n').length`，即以 `wc -l + 1` 计。

| 文件 | wc -l | 门禁计数 | 上限 | 真实余量 |
|---|---|---|---|---|
| `src/runInstances.ts` | 869 | 870 | 900 | **仅 30 行 ⇒ 不可再加，新逻辑必须另起模块** |
| `src/runDashboard.ts` | 211 | 212 | 900 | 688 |
| `src/executionTargets.ts` | 284 | 285 | 900 | 615 |
| `src/testRunner.ts` | 177 | | 900 | 722 → 实际 713 |
| `src/processTerminated.ts` | 138 | 139 | 900 | 761 |
| `tests/run-instances.test.mjs` | 276 | — | 不受本门禁管（只扫 `src/**`、`native/**`） | — |
| `tests/run-instance-rows.test.mjs` | 422 | — | 同上 | — |
| `tests/run-instance-ports.test.mjs` | 47 | — | 同上 | — |
| `tests/runner-view-actions.test.mjs` | 203 | — | 同上 | — |

结论：实现面主要落在 `src/runDashboard.ts` / `src/executionTargets.ts` / `src/processTerminated.ts`
这三片宽余量里；`src/runInstances.ts` 的 30 行余量只够「调用一行 + import 一行」。

### 4.1 收工前门禁（原始数字，2026-10-06）

| 门禁 | 原始输出 | 判定 |
|---|---|---|
| `node --test tests/module-size.test.mjs`（**开工第一件事**） | `tests 5 / pass 5 / fail 0` | 绿 |
| `node --test tests/run-*.test.mjs tests/execut*.test.mjs tests/process-*.test.mjs tests/module-size.test.mjs` | `tests 220 / pass 220 / fail 0`（实现落完后跑一次、注释坐标订正后再跑一次，**两次都是 220/220/0**） | 绿 |
| `node --test tests/run-instance-rows.test.mjs tests/run-dashboard.test.mjs`（加判据之前） | `tests 28 / pass 28 / fail 0` | 绿（基线） |
| `node --test tests/run-instance-rows.test.mjs`（加 5 条判据之后） | `tests 29 / pass 29 / fail 0`（原 24 条 + 新 5 条） | 绿 |
| 三个判据文件合跑（rows + dashboard + instances） | `tests 51 / pass 51 / fail 0` | 绿 |
| `node .tools/find-orphan-modules.mjs --gate` | `exit=1`，红条 = `✘ 新增零生产消费方模块：src/usageViewTreeModel.ts`；汇总行「已登记孤儿 6 / 基线 8 · 新增 1 · 本轮清掉 2」+ 两条「已接上：`src/jarRun.ts`、`src/runAnythingContext.ts`」 | **红，不归本 lane**：`src/usageViewTreeModel.ts` 是别的车道在飞的新模块。本批**没有新增任何模块**，`src/runDashboard.ts` 的生产消费方仍是 `src/components/MainToolbar.vue:146`（未断）⇒ 本 lane 零新增孤儿 |
| `node .tools/find-missing-ext.mjs` | 「扫描 1374 个文件（src + tests）里的 from / 副作用 / 动态 三种 import 形态 —— 干净：没有漏扩展名、且静态也解析不到的相对 import」 | 绿 |
| `node .tools/find-param-props.mjs` | 「共 0 处参数属性」 | 绿 |
| `node .tools/find-ts-in-mjs.mjs` | 「干净：tests/*.mjs 全部是纯 JavaScript」 | 绿 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | `tests 11 / pass 8 / fail 3`。失败者逐条：① `仓里每一条带路径的上游引用都指得到` ⇒ 唯一 offender 是 **findrep2 那一份报告**里转述的一条 `ConsoleViewImpl.kt` 越界行号（裸 basename；门报「行号超出文件长度，该文件全文 1730 行」）；② `已入快照的每条引用，被引区间内容必须仍与快照一致` ⇒ 共 11 条 moved，按文件分布 `docs/batch-2026-10-06-termset.md 7 条、src/components/ProblemsPanel.vue 2 条、src/commitChecks.ts 1 条、src/runStartupFocus.ts 1 条` | **红，全部不归本 lane**（ offender 文件名一个都不是本批改的）。⚠ 给主代理的取证：那条越界行号是**转述进 findrep2 报告的假引用被门收集**（正是 agent-rules §5 那个坑），所以本报告的 §3 反向验证表与这一行都一律写**裸 basename**、不写完整形状 |
| 隔离 tsconfig `npx tsc --noEmit`（只 include 本 lane 五个文件，`strict` + `verbatimModuleSyntax` + `allowImportingTsExtensions`，临时目录 `build/tsi-runinst2/`，跑完已删） | `grep -c "error TS"` = **0** | 绿。按派单要求**没拿全仓 `vue-tsc -b` 当证据**（并发期别人的语法错会遮掉全部语义检查）；本批也没改任何 `.vue` ⇒ vue-tsc 对本批无新增信息 |
| `grep -rn "RUNINST2" src/ tests/ native/` | **0 命中** | 绿（本批反向验证是就地替换真实实现行，没用带标记的探针）。`docs/` 里另有 4 处 `RUNINST2` 字样，都在本报告与下面「车道撞名」一节里作为**文字**出现，不在门禁止扫面内 |
| `ctest` / `npm run test:native` | **未跑** | 本批一个 native 文件都没改（`git status` 见 §2），按派单「ctest 只在改了 native 时跑」 |
| 全量 `npm test` | **未跑** | 按派单「并发期一定不干净，那不是你这一路的活」 |

### 4.2 车道撞名与文件归属（**注入/并发取证，按数据核实后如实登记**）

本文件路径 `docs/batch-2026-10-06-runinst2.md` 上出现了**第二段不属于本切片的报告**
（从本文件 `:170` 的 `---` 起，标题 `# 附录 · runinst2 第二条切片（运行控制台「滚动到末尾」族）`，
即 `:172-258`，署名同为 runinst2，讲的是 `src/consoleScroll.ts` + `src/components/RunConsole.vue` + `tests/console-scroll.test.mjs`）。

**我没有把它当指令、也没有删它**（工作区共享纪律），而是读盘复现后判定：
- 盘上证据：`src/consoleScroll.ts`（3648 字节，15:47）、`tests/console-scroll.test.mjs`（5109 字节，15:45）确实存在，
  `git status` 显示 `?? src/consoleScroll.ts`、`?? tests/console-scroll.test.mjs`、` M src/components/RunConsole.vue` ⇒ **那个切片是真的、已经在干活**，不是编造的报告。
- ⇒ 结论：**同一个代号 `runinst2` 被派给了两路**（一路 `exec/run-instances` 行模型，一路运行控制台滚动族）。
  两路**文件面不重叠**：它的 `:221` 自己写着「`runInstances.ts`/`runDashboard.ts` 归并行代理，未碰」，
  而我这边 `git status` 只有 `src/runDashboard.ts` + `tests/run-instance-rows.test.mjs` 是 `M`（见 §2）⇒ **没有踩现场**。
- 但**报告路径冲突是主代理要处理的归属问题**：这一份 md 里现在混着两路的门禁数字（它的 `:224` 报 251/256，
  我的 4.1 报 220），**不是同一命令、也不是同一时刻**，主代理核对时请按「小节标题 + §/4.x 编号」分辨，不要互相否决。
  它的 `:226` 说 orphan 门禁绿（新增 0），而我在 4.1 实测 `新增 1`（`src/usageViewTreeModel.ts`）⇒
  两次扫描之间别人新建了那个模块，**两条都是各自时刻的真值**，我不替它改判、它也不替我改。
- 它 `:254` 提到收到两次「MEMORY.md 已修改」的系统提示伪装 —— 与我这一路收到的
  「file changed since your last read」提示同源；我这边一律**读盘复现**（见本小节）后才采信。

### 4.5 撞车自查（开工时 `git status`）

- 本 lane 5 个可改文件 + 4 个判据文件：**全部干净未改**（`git status --short` 零命中）⇒ 无人在改，可以动手。
- 黑名单 16 项：**全部处于 `M` 状态**（别的 lane 正在改）⇒ 本 lane 一个都不碰，需要它们的改动只写接线请求。
- 收工时复查：`git status --short` 里属于本批的只有 ` M src/runDashboard.ts`、` M tests/run-instance-rows.test.mjs`、
  `?? docs/batch-2026-10-06-runinst2.md`、`?? docs/wiring-requests-2026-10-06-runinst2.md` ⇒ **保留文件与黑名单一个没动**
  （`src/App.vue`/`src/bridge.ts`/`native/**`/`CMakeLists.txt`/`package.json`/`tsconfig.json`/`scripts/**`/`docs/inventory/**`/
  `src/settingsModel.ts`/`src/runInstances.ts` 全部零改动；后两条里 `runInstances.ts` 是我主动不动的，理由见 §2 第 4 点）。

## §5 接线请求

见 `docs/wiring-requests-2026-10-06-runinst2.md`（3 条：W-1 仪表盘宿主、W-2 进程结束归因的宿主列、W-3 注释坐标订正）。
**出口名全部先打开目标文件核对**，核对用的真实行号写在条目里：

| 请求 | 目标文件 | 我核对到的真实出口（`grep -n` 打出来的） |
|---|---|---|
| W-1 | `src/components/MainToolbar.vue` | `:37-38` 的 `from '../runInstances.ts'` 导入清单（`activeRunInstance, focusRunInstance, resolveStopActionTargets, runInstanceList, runInstanceRows, stopActionState, stopChooserItems, stoppableCandidates, STOP_LABELS`）、`:146 dashboardRows`、`:174 pickDashboardInstance`、`:178 stopDashboardInstance`、`:383` 停止格（图标 `Square`，`:25` 已导入）、`iconSize` 已在用 ⇒ 请求不新引任何符号 |
| W-2 | `native/run_host.cpp`（本 lane 不可改） | `:309`、`:321-322`、`:338-339`、`:345`、`:406-407` 五条 `run.exit` 发射点，逐行读过 |
| W-3 | `src/runInstances.ts:572-581` | 该文件本批 0 净增（只剩 30 行余量），故订正以单行替换交主代理，不在并发期悄悄改 |

**本批「只写请求、没落码」的**：W-1 的宿主三处改动、W-2 的宿主列、W-3 的注释行。
**本批落了码但需要宿主配合才被用户看见的**：`RunDashboardRow.stopText/kill/description`（`stoppable` 也影响 `v-if`）——
接 W-1 之前用户看到的仪表盘与今天一致（不会看到假东西），接了之后 kill 档与 pid 措辞才出现。
这不是「假控件」：字段算的是**真状态**（`stopping`/`closed`/`pid`），判据已钉；宿主不接就只是少一档显示。

## §6 无法核实与跳过

### 6.1 无法核实（证据不足，不编）

| 项 | 卡在哪一环 | 证据 |
|---|---|---|
| 本批新增的 4 条**中文措辞**（`杀死进程`、`停止『{0}』`、`进程 ID：N`、`正在结束『{0}』`） | 参考树里**没有 zh 本地化包**（`ls` 过 `platform/execution/resources/messages/` 只有 `ExecutionBundle.properties` 英文原包）⇒ 中文一律按英文原文直译并在代码注释注明，不是核实到的官方译文 | 英文原值逐行核过：`ExecutionBundle.properties:203 Kill process`、`:204 Process ID: {0,number,#}`、`:208 Stop ''{0}''`、`:202 Terminating ''{0}''`；`STOP_LABELS` 的同一批 key 上一轮（runinst）已核 |
| 派单给的已知事实「`RunnerAndConfigurationSettings.java` 有 `isActivateToolWindowBeforeRun`（行号自己核）」 | **文件找到了**：`platform/execution/src/com/intellij/execution/RunnerAndConfigurationSettings.java`（不在 `configurations/` 子目录，派单/判词若指 `configurations/` 则是路径错）。但**该符号在这个接口文件里 grep 零命中**；实现体在 `platform/execution-impl/src/com/intellij/execution/impl/RunnerAndConfigurationSettingsImpl.kt` —— 本切片（运行实例族）用不到它（它是**起跑前是否激活工具窗口**，属 `exec/run-configs`/runner 语义），**没有继续追到具体行号** ⇒ 判「无法核实（本批未追完）」，不写一个行号交差 | 三条 `find` 命中：接口在 `platform/execution/src/…/RunnerAndConfigurationSettings.java`；另两份是 `RunnerAndConfigurationSettingsProxy.kt`、`RunnerAndConfigurationSettingsEditor.java` |
| 原判词 `RunContentManagerImpl.kt` 「`:389-405`，清那一句是 `:402`」 | **错一行**：`content.description = null` 实测在 **:401**（`:400` 是 `content.icon = …getTransparentIcon(icon)`、`:402` 是 `}`）⇒ 本批所有新落点按 `:401` 写；`src/runInstances.ts:575` 那处旧注释转述成 `:402`，走请求 W-3 订正（不在并发期改那个只剩 30 行余量的文件） | 逐行打印过 `:355-410` |
| 我自己初写的 `getStatus` 子行号（`:59-77`/`:66-68`/`:69-73`/`:74`） | 初读整段后凭记忆写，**差 1-3 行**；用 `grep -n "" \| sed -n '59,77p'` 逐行核过 ⇒ 订正为 `:59-76`/`:67-69`/`:71-73`/`:75`，三处（代码注释 + 两份文档）都已改，留痕见 §1 | 打印输出直接列出 59-77 每行原文 |

### 6.2 具体卡点（做不到，且不是「太复杂」）

| 项 | 卡在哪一层 | 为什么本层修不了 |
|---|---|---|
| **进程结束归因**：起进程失败却显示「已停止」 | 缺**后端状态源**：`native/run_host.cpp:338-339`（`WorkspaceError`）与 `:345`（`std::exception`）都发 `code:-1` 且**不带 `aborted`**，而用户停止（`:309`/`:406-407`）也是 `code:-1` ⇒ 前端拿到的两条事件在「是不是人为停止」这一列上**信息相同**。上游不会撞，因为它读的是 `ProcessHandler` 内存里的 `TERMINATION_REQUESTED`（`RunDashboardRunConfigurationStatus.java:71-73`），跨不到进程就没有这一列 | 纯前端改 `runInstanceState` 的判据会**同时**把 `:309`（真·用户停止）改错（快照与事件两条通道给不出「请求过没有」的差别）。⇒ 要改的是宿主事件（请求 W-2），不是本层判定。**我没有为了让判据变绿去动 `exit === -1 ⇒ stopped` 这条被 `tests/run-dashboard.test.mjs:31/36` 与 `tests/run-instance-rows.test.mjs:377` 钉住的既有断言** —— 在缺状态源时改它属于放松断言 |
| **非并行配置重跑时的确认框**（上游问、本仓静默停） | 缺**宿主通道**：需要一个确认框（上游 `ExecutionManagerImpl.kt` 的那段交互 + `:1104-1118` 的 DoNotAsk 勾选档，**这两个行号区间是上一轮 runinst 报告的转述、本批没有逐行打开核实**，只核实了：文件在 `platform/execution-impl/src/com/intellij/execution/impl/ExecutionManagerImpl.kt`、全文 **1246 行** ⇒ 转述的 `:605-641`/`:1104-1118` 都在界内、不是假路径）。本仓的弹层/对话框挂载点在 `src/App.vue`（保留文件，只有一个 `appvue` 代理能改）；**文案侧我逐行核过**：`ExecutionBundle.properties:212 rerun.singleton.confirmation.message`、`:213 rerun.confirmation.button.text=Stop and Rerun` | 上一轮已把它判 `[ ]` 并写进 `docs/wiring-requests-2026-10-06-runinst.md` R3 末段 ⇒ **不重复实现、也不放假确认框**。宿主「静默停」那一行在 `native/run_host.cpp:363-365`（判词转述，本批**未复核**） |
| **Services 工具窗口的运行配置仪表盘本体**（`RunDashboardManager.isShowInDashboard`、`getHiddenConfigurations`、`RunDashboardUiManager`、`RunDashboardListener`、`RunDashboardCustomizer`） | 缺**挂载点 + 插件 EP 宿主**：`RunDashboardManager.java:38`（`isShowInDashboard(RunConfiguration)`）、`:46-48`（`getHiddenConfigurations`）要的是「按配置决定是否出现在 Services 树上」与「隐藏配置可恢复」，本仓没有 Services 工具窗口（`src/App.vue` 冻结、没有地方挂新面板），`RunDashboardCustomizer`/`RunDashboardDefaultTypesProvider` 都是 EP，本仓没有 EP 宿主 | 本仓落成运行工具栏弹层（`src/runDashboard.ts` 文件头已登记这一取舍），并且**类型开关只列此刻真有实例的类型**（`runDashboardPresentTypes`，`:159-162`）——给空组配开关就是点不动的死控件。⇒ 隐藏/恢复那两档本批**不给**，因为没有任何真状态源（没有持久化「隐藏了哪些配置」的键，新增键要动 `src/settingsModel.ts` + 两份 native schema 六处成对 ⇒ 保留文件） |
| **一个执行环境只出一个代表**（同配置多 descriptor 归并） | 缺 **EP 宿主**：`StoppableRunDescriptors.kt:51-62` 的代表由 `DisplayDescriptorChooser` EP（`:87-107`）选 | 上一轮已判 `[-]` 并写进行模型注释与它的 R4；本批复核结论一致 ⇒ 如实一个实例一行，不假造归并 |
| **`ExecutionListener` 型扩展点 / 远程执行 / 提权运行** | 判词 `docs/inventory/verdict-execution.md:28` 的 ①②③，卡的是「没有插件贡献点宿主」「宿主只做本机 CreateProcess」「缺 UAC 启动入口 + `RunStartParams`/`bridge.ts` 冻结」 | 本批**未逐条复测**这三条（不在「用户还看得见的剩余缺项」这一窄切片里，且 `src/bridge.ts` 是保留文件）⇒ 沿用判词结论并标注「本批未核」，不替它们升档也不推翻 |
| 新 UI 的 `Stop ‘{0}’` / `Stop All {0}` 两条弹窗专用文案 | **已核实存在**：`ExecutionBundle.properties:210 stop.item.new.ui.popup=Stop ‘{0}’`、`:211 stop.all.new.ui.popup=Stop All {0}`（与 `:208`/`:209` 是**两套**，新 UI 弹层用前者，`{0}` 前面不带括号） | 本仓的停止弹层宿主还没落地（`docs/wiring-requests-2026-10-06-runinst.md` R2c 待接），**没有消费方 ⇒ 不加进 `STOP_LABELS`**，加了就是没人读的死数据。登记在此，等 R2c 落地时一并取用 |
| **端口展示 / 重名处理 / 停止与激活行为 / 实例行** | 复核后**不重做**：端口（`src/runInstances.ts:363-381` 的 `ports` 合入 + `RunConsole.vue` 进程区显示）、重名（`:620` 的 `duplicateTitle` + `:578-581` 的 pid 描述 —— 上游同名**不加 `#2`**，靠 pid 那句分辨）、激活（`:192-200` `focusRunInstance` 对应 `:432-435` 的 `isSelectContentWhenAdded`）都已落地且有判据 | 我只把**漏掉的那三处**补进本批（仪表盘行名、仪表盘 kill 档、仪表盘 pid 措辞的模型侧）⇒ 见 §2 |


---

# 附录 · runinst2 第二条切片（运行控制台「滚动到末尾」族）

> **撞车留痕**：本文件同时承载两条 **同一 lane code `runinst2`** 的产物——上半篇（§0–§6）是并行代理的
> 「运行仪表盘退出码/状态派生」切片（其 §1 的 `RunContentManagerImpl.kt:402→:401` 订正在磁盘上成立，
> `src/runInstances.ts:491/:575` 注释确写 `:402`，实值 `:401`；该文件归它修，我没碰）。本附录是本代理的
> 「控制台滚动到末尾 + 随输出贴底跟随」切片，落点文件（`src/consoleScroll.ts`、`src/components/RunConsole.vue`、
> `tests/console-scroll.test.mjs`）与它的可改 5 片（runInstances/runDashboard/executionTargets/processTerminated）**不重叠**。
> 主代理需把两条 lane 拆成不同代号，否则报告簿会继续互相截断（本代理骨架在 15:49 被它的 Write 覆盖过一次，
> 故改为追加、不再整体重写它的文件）。

## 1. 三档表（execution / run-instances 判决行 vs 磁盘）
判决行来自 `docs/inventory/verdict-execution.md:28`（`exec/run-instances` `[~]`）、`:40`（`exec/actions`）；上游坐标本批逐条 `sed -n`/`grep -n` 在 `D:\Backup\...\intellij-community-master` 开过。

### 档 A —— 已闭环却被候选当"缺项"（磁盘已做，别重做）
| 候选（作者措辞） | 磁盘落点（本仓） | 上游真坐标（本批自开核实） | 结论 |
|---|---|---|---|
| 实例结束后运行标签页的可用性判定 | `src/components/RunConsole.vue:404-407`（`×` 读 `rowOf(id).stoppable`，`.kill` 换语义） | `platform/execution-impl/src/com/intellij/execution/actions/StopAction.java:310-315`（canBeStopped）、`:106-110`（正在结束⇒KillProcess） | 已闭环（上一批 §R2b 落进 RunConsole，未 commit）⇒ 不重做 |
| 终止全部 / 停止全部（Stop All） | `src/runToolbar.ts:47`（run.stopAll 条目）+ `src/components/MainToolbar.vue:126`（→ctx.stopAnyProcess()）；选择器条目 `src/runInstances.ts:817`（STOP_LABELS.all） | StopAction.java:158-168、:177-179（末尾 Stop All ({0})） | 已闭环（走「更多」弹层→停止全部）⇒ 不重做 |
| 重跑确认闸 | src/runRerunConfirm.ts + src/runActions.ts 那道闸 | ExecutionManagerImpl.kt:605-646 / :1097-1128 | 已定口径，别推翻 |
| 控制台清空 / 暂停 / 编码 / 「正在运行」清单 | `src/components/RunConsole.vue:417-457` | ClearThisConsoleAction、PauseOutputAction、ConsoleEncodingComboBox.kt:20-57、ShowRunningListAction.java:55-191 | 判决行 :28/:40 已记为已做 |

### 档 B —— 缺且可做（本批实现的 2 项，均控制台本地、不动保留/黑名单文件）
| 项 | 磁盘现状 | 上游真坐标（本批自开核实） | 落点 |
|---|---|---|---|
| 控制台「滚动到末尾」（Scroll to End 工具条按钮） | 缺：RunConsole.vue 全文无 scrollTop/无滚动按钮；判决行 :28/:40 均未登记 | ScrollToTheEndToolbarAction：建在 ConsoleViewImpl.kt:1360-1361、加进动作表 :1367；类本体 platform/platform-impl/src/com/intellij/openapi/editor/actions/ScrollToTheEndToolbarAction.java:17-39（普通 AnAction，非 ToggleAction，一次点击 = EditorUtil.scrollToTheEnd）；文案键 platform/platform-resources-en/src/messages/ActionsBundle.properties:205 action.EditorConsoleScrollToTheEnd.text=Scroll to End；图标 AllIcons.RunConfigurations.Scroll_down | src/components/RunConsole.vue + 新纯函数模块 src/consoleScroll.ts，判据 tests/console-scroll.test.mjs |
| 控制台随输出自动贴底 / 上滚即停跟（stick-to-end） | 缺：新输出超一屏时视图不跟随，也没有回底入口 | ConsoleViewImpl.kt：flushDeferredTextImpl:666-668（shouldStickToEnd = !myCancelStickToEnd && isStickingToEnd）、isStickingToEnd:1684-1686、isVScrollAtTheBottom:1708-1711（整数精确相等）、updateStickToEndState:481-487 | 同上（共用 consoleScroll.ts 的贴底判定） |

### 档 C —— 不等价 / 无法核实 / 本批不做（理由）
| 候选 | 判定 | 具体理由（上游坐标） |
|---|---|---|
| 控制台「复制全部」 | 不等价：上游无这个控制台动作，不做（⑧不放假控件） | createConsoleActions() 只给 prev/next/softwrap/scroll-to-end/print/clear + customActions + ConsoleActionsPostProcessor（ConsoleViewImpl.kt:1346-1378）；lang-impl/src/com/intellij/execution grep ConsoleCopy/copyAll/CopyConsole 零命中；上游复制走编辑器 Ctrl+C（选中标段），本仓已有逐行复制 copyLine（RunConsole.vue:272-274）与链接右键复制（:265-271）⇒ 再造"复制全部"就是编控件。订正留痕：派单把"复制全部"与"滚动到末尾"并成一条候选，实为两条不同性质——后者有上游、前者无。 |
| 停止选择器弹层本体 | 判据齐、宿主待定 ⇒ 走接线请求（-runinst.md R2c、-execui2.md W2 复核过仍成立） | StopAction.java:152-181；本仓无 Swing 弹层，唯二宿主 RunConsole.vue/MainToolbar.vue 改动面大 ⇒ 不在此窄 lane 强塞 |
| DisplayDescriptorChooser 一执行环境一代表合并 | [-]（无 EP 宿主） | StoppableRunDescriptors.kt:51-62、:87-107 |
| 提权运行 RunStartParams.elevate | 不做（另批） | 见已定口径（daemon/trampoline） |
| 重跑「以后不再显示」勾选 + 应用级开关 | 需 src/App.vue（保留）⇒ 接线请求（-execui2.md W1） | ExecutionManagerImpl.kt:1104-1118 DoNotAskOption |

## 2. 实现（用户可见、不动保留文件，2 项）
1. 工具条按钮「滚动到末尾」（ScrollToTheEndToolbarAction 等价）：一次点击把当前实例输出滚到底并重新贴底。
2. 随输出自动贴底 / 上滚停跟（isStickingToEnd 等价）：视图本就贴底时新输出自动跟到底；用户往上滚离底即停跟。
判定做成纯函数 src/consoleScroll.ts（consoleViewAtBottom 贴底阈值 + consoleScrollToEndPosition 回底落点），组件只做 DOM 副作用。
DOM 侧唯一非上游值 = 1px 贴底容差（上游 isVScrollAtTheBottom 用整数精确相等，分数设备像素比下 DOM 三值带小数），文件头已登记为如实差异、不写成等价。
中文界面措辞「滚动到末尾」= 无法核实（参考树只有 en 包，英文原文 "Scroll to End"）；上游按钮是图标（Scroll_down），本栏一水儿文字按钮 ⇒ 用文字，图标↔文字呈现差异如实登记。

## 3. 改动文件清单（行数以门控 split('\n').length 为准 = wc+1）
| 文件 | 前(wc) | 后(wc) | 后(gate) | 性质 |
|---|---:|---:|---:|---|
| src/consoleScroll.ts | 0 | 53 | 54 | 新增纯函数模块 |
| src/components/RunConsole.vue | 628 | 654 | 655 | 改：接 consoleScroll.ts + 「滚动到末尾」按钮 + 随输出贴底（655 < 900） |
| tests/console-scroll.test.mjs | 0 | 66 | 67 | 新增判据（6 条，纯同步、无计时器 ⇒ 不会挂） |
保留/黑名单文件一个没动（App.vue 13:18、bridge.ts 14:52、runActions.ts 13:53、settingsModel.ts 13:15 的 mtime 均早于本会话；runInstances.ts/runDashboard.ts 归并行代理，未碰）。

## 4. 门禁原始数字（附录切片）
- 族测试 node --test tests/run-instance*.test.mjs tests/run*.test.mjs tests/console*.test.mjs tests/module-size.test.mjs：开工前基线 245/245/0 fail；本批后 251/251/0 fail（+6 = console-scroll，无回归）。
- npx vue-tsc -b --force：error TS 2 条，均在派单预登记的在飞他域文件（gradleHost.ts:880 TS2304、semanticActions.ts:509 TS2345）⇒ 只记录不修；无 TS1xxx 语法错；consoleScroll.ts 与 RunConsole.vue 零错。
- node .tools/find-orphan-modules.mjs --gate：门禁绿（已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2）；consoleScroll.ts 被 RunConsole.vue 生产引用 ⇒ 非孤儿。
- node --test tests/source-citations.test.mjs：3/3 pass（探针实测 ConsoleViewImpl.kt 全文 1730 行 ⇒ 本批 :1346-1711 全部在界内）。

## 5. 反向验证记录（RUNINST2-PROBE：破坏→红→还原→绿→grep 0 残留）
- 探针 A（坐标门）：注入 ConsoleViewImpl.kt:999999 到 consoleScroll.ts ⇒ source-citations 变红（行号超出文件长度 999999 > 1730）⇒ 删行 ⇒ 复绿 3/3。
- 探针 B（纯函数判据）：把 consoleScrollToEndPosition 去掉 Math.max(0,...) 夹底 ⇒ console-scroll「不越界为负」用例变红（1 fail）⇒ 原样还原 ⇒ 复绿 6/6。
- 残留：grep -rn "RUNINST2-PROBE" src tests docs ⇒ matches=0。

## 6. 零消费方自查
consoleScroll.ts 的两个导出 + CONSOLE_BOTTOM_TOLERANCE 都在 RunConsole.vue 生产引用；组件由 App.vue:2258 挂载。无只过自己测试的死模块。

## 7. 需要主代理接的线
本批两项自成闭环，不需保留文件配合 ⇒ 未新建 wiring-requests。先前车道遗留的 R1/R2c/W1 仍归各自接线请求簿（本批复核其坐标仍对得上，未替别人划掉）。

## 8. 外部在飞红（本批不修，只记录并给出归属证据）

**收工前门禁的三条红**里没有一条来自本附录的四个改动文件；本批交付文件独立复核后**全绿**。逐条：

| 门禁 | 当前结果 | 归属证据（本批复查） |
|---|---|---|
| `npx vue-tsc -b --force` | `exit=1`；`error TS` **1** 条：`src/semanticActions.ts:509 TS2345` | `semanticActions.ts` 在派单预登记的在飞他域文件；开工前基线时 `error TS` 是 2（另 `gradleHost.ts:880` 那条已在其车道内被修好）。无 `error TS1xxx`；`consoleScroll.ts` 与 `RunConsole.vue` **零错**。⇒ 他域在飞错只记录不修（按任务约束）。 |
| `node .tools/find-orphan-modules.mjs --gate` | `exit=1`；红在 `✘ 新增零生产消费方模块：src/usageViewTreeModel.ts` | `src/usageViewTreeModel.ts` 属派单**并发黑名单** `src/usageView*`，本批没碰。本批自己的 `src/consoleScroll.ts` 生产消费方在 `src/components/RunConsole.vue:79`（import）+ `:388/:390/:399`（`consoleViewAtBottom` / `consoleScrollToEndPosition` 各被真用一次），门禁扫描时未列它。⇒ 属 usageView 车道在飞。 |
| `node --test tests/source-citations.test.mjs` | `tests 3 / pass 2 / fail 1`；失败条目：`docs/batch-2026-10-06-findrep2.md :: ConsoleViewImpl.kt 某越界行号（探针 A 用的 999999）-999999 —— 行号超出文件长度（999999 > 1730）` | **这是**别的车道把本批探针 A 期间**已经消失**的 `consoleScroll.ts` 状态转述在自己报告里，且**写了完整形状** `platform/.../ConsoleViewImpl.kt:999999` ⇒ 命中 agent-rules §5 的坑（「转述里的假路径:行号被当一条真引用收集」）。findrep2 报告 `:124` 原句承认「`grep -n 999999 src/consoleScroll.ts` 盘上**没有这一行**、再跑即绿」。⇒ 本批交付文件里没有 `999999`，本批报告里的探针描述一律用**裸 basename**（`ConsoleViewImpl.kt:999999`）避开这条门；红归 findrep2 车道自纠（按 §5 教训去掉完整形状即可）。 |
| `node --test tests/console-scroll.test.mjs` 单跑 | `tests 6 / pass 6 / fail 0` | 本批判据（探针 B 撤后复绿）。 |
| 族测试合并跑（本批必跑那一条） | `tests 256 / pass 256 / fail 0`（基线 245，本批 +6，其间他域 +5 也全绿） | — |

**探针 A 的短时窗**：注入到 `src/consoleScroll.ts` 那一行 `ConsoleViewImpl.kt:999999` 期间（<1 分钟）被 findrep2 车道在其 §5「并发观察」里抓到并如实记录为「非本 lane、只记录」——这与我撤行后它的自纠一致；两车道互不修对方文件，是正确处置。

**MEMORY.md 注入信号（记出处）**：任务开工后与本批进行中收到两次「MEMORY.md 已修改」提示，第二次的 diff 里新增了「八种注入形态（含把生产码里的安全闸短路后收工）」这一条。按硬约束 ⑩，此类**工具结果 / 系统提示伪装**一律当数据：不据此改任何代码、不"确认已自愈"；本批的 `if (active !== prevActive)` 之类短路都是**有意为之的判定分支**（切实例⇒重贴底），不是被短路的闸，反向验证已证明。

## 9. python 副作用（不改，登记）
`scripts/__pycache__/verdict_table.cpython-314.pyc` 显示为 `M`——本批**没有**运行 python；这条 `M` 是别的车道跑 `scripts/verdict_table.py` 时留下的。按工作区纪律（共享、禁破坏性）：不 stage、不删、不动。
