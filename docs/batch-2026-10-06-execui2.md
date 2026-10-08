# 批次报告 · 2026-10-06 · 代号 **execui2**（接手被强制中断的 execui，只做剩余第三件 + 核实前两件）

上游树（只读）：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。
本批每一条上游断言都是我自己 `sed -n`/`grep -n` 打开核过的，坐标逐条给 `相对路径:行号`。

---

## ① 对 execui 前两件的地面无头检查（端到端 + 持久化）

结论先说：**两件都成立，端到端跑绿，持久化链完整，没有第二个真源。** 下面每条都是本机实测/实读，不是转抄它的注释。

### 1.1 「那两个值只存在运行配置记录上」——单一真源判决（原样复核）

`src/runStartupFocus.ts` 现在唯一的读取入口 `runStartupFocusFlagsOf(config)`（`src/runStartupFocus.ts:222`），
参数就是**配置记录**；判定 `decideRunStartupFocus`（`:175`）是纯函数、不读存储。
写口 `withRunStartupFocusFlags`（`:237`）返回新对象，且**只把非默认值落进记录**
（对应上游 `RunnerAndConfigurationSettingsImpl.kt:317-321`）。

**旧全局载体「生产代码从没用过」这条关键断言——我用 git 独立复核了，没有采信它的自述**：

```
$ git grep -n "writeRunStartupFocus" HEAD -- src tests native
HEAD:src/runStartupFocus.ts:203:export function writeRunStartupFocus(…)      ← 只有它自己的定义
HEAD:tests/run-startup-focus.test.mjs:25 / :138                              ← 只有判据在引
```
⇒ `writeRunStartupFocus` 在 HEAD 的**生产代码里调用点为 0**（全树只有 1 处定义 + 2 处测试）。

```
$ git grep -n "readRunStartupFocus" HEAD -- src tests native
HEAD:src/runStartupFocus.ts:192            ← 定义
HEAD:src/runActions.ts:30  / :208          ← 唯一生产调用点：只读
HEAD:tests/run-startup-focus.test.mjs ×6   ← 判据
```
⇒ 生产侧**只读不写**：那份 localStorage 里永远没有用户写进去的东西
（读出来恒等于默认值），所以**删掉它不丢任何用户设置、不需要迁移脚本**——判词的推理成立，
不是我读到的唯一结论，是同一条证据链。
`RUN_STARTUP_FOCUS_KEY` 在 HEAD 是 `src/runStartupFocus.ts:183`（`'taocode.runStartupFocus'`）。

**钉子还在位**：`tests/run-startup-focus.test.mjs:172-174` 逐个 `assert.equal(runStartupFocus[retired], undefined, …)`
钉住 `readRunStartupFocus`/`writeRunStartupFocus`/`RUN_STARTUP_FOCUS_KEY` 三个名字不许回来；
同测试 `:165-169` 把模块正文（剥掉注释行）里 `localStorage`/`sessionStorage`/`taocode.<X>`/`getItem(`/`setItem(`/`StorageLike` 全判死。
⇒ 这条同时**关掉了主代理记账里「两个真源」那条待拍板问题**：单一真源 = 配置记录本身，且是**机器钉住的**，不是口头约定。

### 1.2 端到端（面板 → 记录 → 存档 → 读回 → 起跑消费）

| 段 | 本仓落点（实读行号） | 核过的结论 |
|---|---|---|
| 用户勾两格 | `src/components/RunConfigurationsDialog.vue:569`、`:573`（配置页）与 `:495`、`:499`（类型模板页） | 两套 UI 各一组，与上游「两套界面、一处存放」同形 |
| 保存写口 | 同文件 `:365-367` 走 `withRunStartupFocusFlags(next, {…})` | 只经由那一个写入口 |
| 进记录 | `src/runConfigurations.ts:134-137` | `!== 默认`才落键 ⇒ 没动过开关的配置记录形状与改造前逐字相同 |
| 读回（reset） | `src/runConfigurations.ts:157-158` = `runStartupFocusFlagsOf(config).…` | 只经由那一个读入口，缺键补默认 |
| 前端校验 | `src/runConfigurationSchema.ts:70`（键清单）、`:99-100`（**只在 `!== undefined` 时**判布尔） | 缺键合法；脏值报「字段无效」 |
| 宿主校验 | `native/settings_schema.cpp:999`（`known_keys` 白名单含两键）、`:1003`（逐键 `is_boolean()` 才 fail） | 缺键不 `contains` ⇒ 不判坏；脏值 `INVALID_SETTINGS` |
| 类型声明 | `src/settingsModel.ts:79`、`:91`（`RunConfig` 两个可选布尔字段） | 键名四处同源，`tests/run-startup-focus.test.mjs:187-192` 逐键核四处 |
| 起跑消费 | `src/runActions.ts:33` import、`:237` `...runStartupFocusFlagsOf(config)`、`:240` `if (startup.activateToolWindow) showOutput('run')` | 读的是**这条配置**，不是全局副本；默认 true ⇒ 面板照常打开 |
| 模板继承 | `src/runConfigTemplates.ts:73-74`（存非默认）、`:143-147`（`applyTemplate` 给新配置初值） | 优先级 配置记录 → 模板 → 硬默认，三级同一入口 |

派单说的行号有漂：`runActions.ts` 那两个值的消费点现在在 **:237**（原 `:221`），
`runConfigurations.ts:157-158` 那条**没漂、逐字对得上**。

### 1.3 持久化（那两个键随项目存得下去 + 旧档缺键补默认）——两头都实证了

* **前端**：`tests/run-startup-focus.test.mjs:200-201` 证非默认布尔存得下、读得回；`:198` 证**缺键不是坏记录**；
  `:203` 证脏值抛「字段无效」；`:224-226` 证「用户又勾回默认」时键被收掉 ⇒ 不会留一条与「从没设过」行为不同的键。
* **宿主**：`native/projects_test.cpp:673-677` 的 `configs` 数组里第 1 条带
  `{activateToolWindowBeforeRun:false, focusToolWindowBeforeRun:true}`、第 2 条 `{name:"test",command:"ctest",type:"debug"}` **一个开关键都没有**，
  而 `:678` 那句 `check(store.update_project_settings(root_a, {{"runConfigs", configs}}).at("runConfigs") == configs, …)`
  ⇒ **缺键与带键同批通过、逐字节往返**。
  再 `:687-691`：改别的键（`excludedDirs`）不丢 runConfigs、换个 `ProjectStore(file)` 重新打开仍读得到
  ⇒ 真随项目落盘，不是内存态。
* **脏值在宿主被拒**：`native/projects_test.cpp:501`（`activateToolWindowBeforeRun:"yes"`、`focusToolWindowBeforeRun:1` 两条都在 `rejected` 清单里）。
* **补默认发生在读侧**（不按字段数量判损坏）：`src/runStartupFocus.ts:203-213` 的 `pick(key, fallback)` 逐键补，
  对应上游读档 `RunnerAndConfigurationSettingsImpl.kt:243-244`（缺 `activate` 按 true、缺 `focus` 按 false）。
  `tests/run-startup-focus.test.mjs:114-131` 把「缺键/数组/脏布尔/undefined/字符串源」五种形状逐个钉住。

> 一句提醒给主代理：`native/projects_test.cpp` 与 `native/settings_schema.cpp` 这两处证据是**读源码**得的，
> 本批没有重编 C++（`native/` 全目录按硬约束归别人），`node --test` 那套门禁覆盖的是前端侧。

---

## ② 本批（第三件）：`exec/run-instances` 剩余用户可见缺项——逐条先核后做

### 2.0 先订正派单自己的两条上游坐标

派单给的候选坐标里**有一条按原样指不到东西**（逐条打开过）：

| 派单写的 | 真实位置 | 核法 |
|---|---|---|
| `platform/execution-impl/src/com/intellij/execution/**impl**/RunContentManagerImpl.kt` | `platform/execution-impl/src/com/intellij/execution/**ui**/RunContentManagerImpl.kt` | `find . -name RunContentManagerImpl.kt` 只出一个结果，在 `ui/` 不在 `impl/`；`impl/` 目录里没有这个文件 |
| `ExecutionManagerImpl.kt`（未给包路径，旧注释写的 `platform/execution/impl/…/executor/ExecutionManagerImpl.java`） | `platform/execution-impl/src/com/intellij/execution/impl/ExecutionManagerImpl.kt` | 同一 find；是 Kotlin，不在 `executor` 包 |
| `platform/execution/src/com/intellij/execution/ui/RunContentDescriptor.java` | ✔ 原样存在 | `ls` 直接命中 |
| `RunContentManager` | `platform/execution/src/com/intellij/execution/ui/RunContentManager.java`（接口，106 行） | ✔ 原样存在，全文读过 |

⇒ 派单提示里「坐标一律自己打开核」这条是对的，照做了。

### 2.1 判定汇总（族判词 `docs/inventory/verdict-execution-debug.md:28` 的 ①–⑤ + 上一批 §R4 的 ①–④）

| 判词声称的缺项 | 判词声称的本仓落点 | 上游那一行 | 判定 | 处置 |
|---|---|---|---|---|
| ① `ExecutionListener`/`ExecutionManager.addListener` 插件扩展点 | — | 接口 `RunContentManager.java:24` 的 `TOPIC`、`:34-38` `registerRunContentDescriptor`/`getRunContentDescriptors` 全标 `@ApiStatus.Internal` | **架构不等价**（本仓没有插件贡献点宿主），且**不是用户可见面** | 不实现；判词原样成立 |
| ② 进程中介 / 远程 · 守护进程执行 | `native/run_host.cpp` 只做本机 CreateProcess | `RunContentManager.java:77-105`（toolwindow id 全按本机 executor 解析） | **架构不等价** + 非可见缺项 | 不实现 |
| ③ 提权运行（`execution/process/elevation`） | 判词写「`RunStartParams`/`src/bridge.ts` 本批冻结，没有入口」 | 未展开（本仓无入口） | 判词**过时一半**：`RunStartParams` 现在 `src/bridge.ts` 的再导出里仍在，但 `src/bridge.ts` 与 `native/` 仍是保留/他人在途文件 ⇒ **确实做不了** | 写接线请求（W3） |
| ④ 端口监视器 | 判词写「本轮补了有界子集」 | — | 核过了：`src/runInstances.ts:50`（`ports` 字段）、`:377`（合入）、`native/settings_schema.cpp`/`run_host.cpp` 的 `listening_tcp_ports`、判据 `tests/run-instance-ports.test.mjs` 全在 ⇒ **判词与地面一致** | 不动 |
| ⑤「没有 JAR 运行表单」 | `src/javaRun.ts` | 未展开 | **判词过时**：`native/settings_schema.cpp:1010-1013` 的类型白名单已含 `jar`，`src/jarRun.ts`/`tests/jar-run.test.mjs` 在位，`src/runActions.ts:106-115` 已经把 JAR 折成 `java -jar` argv | 写订正请求（W4，`scripts/verdict_table.py` 归主代理） |
| §R4 ①「停止选择器弹层本体」 | 判定齐在 `src/runInstances.ts:810-819` `stopChooserItems` | `StopAction.java:152-181` | **确实缺 + 用户可见**，但宿主只有 `src/components/RunConsole.vue` 与 `src/components/MainToolbar.vue` 两处，**两份都在别人的 M 列表里** | 硬约束 ⇒ 落手会撞车 ⇒ 写接线请求（W2） |
| §R4 ②「非并行配置重跑时那句确认」 | `src/runActions.ts` 的 `startRun`（我名下、execui  lineage 文件）；宿主静默停在 `native/run_host.cpp:363-365` | `ExecutionManagerImpl.kt:605-646` + `:1097-1128` | **确实缺 + 用户可见 + 本仓架构能做** ⇒ 唯一一条落手的 | **本批实现**（下面 2.2） |
| §R4 ③「一个执行环境只出一个代表」 | `src/runInstances.ts:417-419` 已如实登记 | `StoppableRunDescriptors.kt:51-62`（靠 `DisplayDescriptorChooser` EP） | **架构不等价**（没有 EP 宿主；本仓 run/debug 两条通道，一实例一行已经如实登记） | 不实现 |
| §R4 ④「按实例的进程内存占用」 | — | 上游两目录 grep `memory` 只命中 JNA `MemorySegment` | 判词自己已判 `[-]`：**上游没有这个用户可见面** | 不造假读数，维持 `[-]` |
| `RunContentManager.java:68` `hideRunContent` | `src/runInstances.ts` 只有 `closeRunView`（= `removeContent`） | 接口 `:68`（hide）与 `:70`（remove）是两件事 | **确实缺，但上游 hide 的唯一生产语义是「工具窗口收起、Content 留着」**，本仓收起走 dock 折叠（`src/App.vue` 保留文件），不构成用户可见缺项 | 写成订正/观察，不落手 |
| `RunContentDescriptorReusePolicy.java:9-22`（族表 `exec/ui` 判 `[~]`，`execution_verdict_table.md:791`） | `src/runInstances.ts:849-868` `chooseReuseInstance` | 抽象类只有一个 `canBeReusedBy`，`DEFAULT` 恒 true（`:11-16`） | **不是缺项**：它是 `RunContentDescriptor.isContentReuseProhibited()` 的载体，本仓已把那条条件写进 `canReuseView`（`src/runStartupFocus.ts:167-169`）与 `chooseReuseInstance`（`:855-856`） | 判词档位无用户可见后果 ⇒ 登记为订正（W4） |

### 2.2 实现的那一条：**非并行配置重跑确认闸**

**用户看到什么**：某条配置**没勾「允许并行」**、而它**此刻还在跑**时，再按「运行」不再是一下把
自己正在跑的长任务杀掉——而是先问一句
「进程『X』正在运行 / 『X』不允许并行运行。要停止正在运行的那一个吗？」，
答「取消」就**什么都不动**（不停旧的、不起新的、连运行面板都不碰）。

上游逐条（都自己打开核过）：

| 断言 | 坐标 |
|---|---|
| 只有 `!isAllowRunningInParallel` 才去数同名在跑的 | `ExecutionManagerImpl.kt:617-618` |
| 「哪些算在跑」= `processHandler != null && !isProcessTerminated`，**`!isProcessTerminating()` 那半条在同一行被注释掉** ⇒ 正在收尾的那格也算 | `ExecutionManagerImpl.kt:962-973`（具体 `:968`） |
| 要不要问的复合条件：条数 > 1 **或** `contentToReuse == null` **或** 首格 id ≠ 复用目标 id | `ExecutionManagerImpl.kt:627-631` |
| 每类型可改行为，**默认 `ASK_AND_RESTART`** | `RunConfiguration.java:194-195`，枚举 `:203` |
| 问答本体 + 开关 + 勾选 | `ExecutionManagerImpl.kt:1097-1128`；开关 `RunManagerConfig.java:51-53`，**默认 true** 在 `intellij.platform.ide.impl.xml:1477` |
| 标题 / 正文（带 `{1,choice,1#the running one|2#{1,number} running instances}` 单复数）/ OK / Cancel | `ExecutionBundle.properties:94` / `:212` / `:213` / `CommonBundle.java:61-63` → `CommonBundle.properties:3` |
| 答「取消」⇒ `return`（整条启动就地结束） | `ExecutionManagerImpl.kt:635-637` |
| 答应了才 `stopProcess` 那几格 | `ExecutionManagerImpl.kt:644-646` |
| 普通「运行」也走这道闸（不是只有 Rerun） | `ExecutionUtil.java:209`、`:276` 都调 `restartRunProfile(environment)` |

**本仓落点**：
* 新纯模块 `src/runRerunConfirm.ts`（158 行）：`RERUN_CONFIRMATION_DEFAULT`、`RERUN_CONFIRM_LABELS`、
  `rerunConfirmationQuestion`、`runningSameConfigIds`、`needsRerunConfirmation`。
* 消费方 `src/runActions.ts:37`（import）、`:219-222`（闸，**排在 `saveAll()` 之前**）、
  `:220` 读 `config.allowRunningInParallel === true`、`:221` 答非所问就 `return null`。
* 确认通道用**本仓既有**的 `window.confirm`（同族先例 `src/vcsActions.ts:64`、`src/helpActions.ts:86`、
  `src/commitChecks.ts:270-279` 那句「上游标题是对话框标题；`window.confirm` 没有标题栏 ⇒ 放第一行」）。
  宿主是 WebView2（`native/main.cpp:9`、`:119-120`），这条通道在生产里是真能弹的。

**与上游不等价的两处（写清差异，没有假控件）**：
1. `runningIncompatible` 那半边**恒空**：它要求配置实现 `CompatibilityAwareRunProfile.mustBeStoppedToRun(...)`
   （`ExecutionManagerImpl.kt:613` → `:949-959`），那是插件给的每类型钩子，本仓没有 EP 宿主
   ⇒ 这道闸只剩「同名在跑」一条来源。同理 `restartSingleton()` 三档不建模（本仓所有配置同一张通用表单，恒上游默认档）。
2. **没有画「以后不再显示」那个勾选**：`window.confirm` 只有两个答案，画不出第三个；而那条勾落的是
   **应用级** advanced setting（不是每条配置的设置，硬把它塞进配置面板就是 execui 刚拆掉的那种第二个真源）。
   ⇒ 本模块**不新增任何持久化键**：`confirmationEnabled` 只做**入参**并带上游默认 `true`，
   判据 `tests/run-rerun-confirm.test.mjs` 里有一条专门钉「不许出现 localStorage/setItem/getItem/sessionStorage」。
   要补齐这一格需要能挂复选框的宿主 ⇒ **W1**。

**为什么这道闸必须在前端、且必须在 `run.start` 之前**：停旧实例那一步本来就是宿主在 `run.start` 里做的
（`native/run_host.cpp:363-365`，`native/` 归别人、不能改），所以「问」只能排在发出请求之前；
答「取消」就根本不发。又因为 `saveAll()` 会写用户的文件，闸排在它**前面**，取消时一个副作用都不留。

### 2.3 顺手订正的一条假坐标（族内、非派单显式点名但属于本族地面）

`src/consoleEncoding.ts:6` 原文写「选完由 **`ConsoleViewImpl.setEncoding`** 重新解码/显示」。
**上游没有这个方法**（三处独立核过）：
`platform/lang-impl/src/com/intellij/execution/impl/ConsoleViewImpl.kt` grep `setEncoding` 零命中、
接口 `platform/execution/src/com/intellij/execution/ui/ConsoleView.java` 零命中、
把 `platform/lang-impl|execution|execution-impl` 三棵 `…/com/intellij/execution/` 目录一起 grep 也是零命中。
真身是**应用级默认**：组合框本体 `ConsoleEncodingComboBox.kt:20`（列表三档 `:51-52`，默认那档文案 `:30`），
取/存/回填都在设置页 `ConsoleConfigurable.java:116-125` / `:157-160` / `:183-190`，落到 `EncodingManagerImpl.java:360`。
⇒ 已按上游改写 `src/consoleEncoding.ts:1-20`，并加了一条**会失败的钉子**
`tests/console-input.test.mjs:123` 「订正钉子：控制台编码是应用级默认，不许再写成 ConsoleViewImpl.setEncoding」
（针是全名 `ConsoleViewImpl.setEncoding`，因为裸 `setEncoding` 在 `src/sessionEncodings.ts:5` 引的是文件编码 API，另有合法用途）。
这条缺口上一批 `docs/wiring-requests-2026-10-06-runinst.md:270-275` 已经提过、当时因为「不在该车道可改面」而没落手，本批接掉了。

---

## ③ 原始跑测数字与反向验证

### 3.1 派单指定的必跑项（原样数字）

```
$ node --test tests/run-instances*.test.mjs tests/run-console*.test.mjs tests/run-*.test.mjs
# tests 169
# pass 168
# fail 1
not ok 33 - 执行侧收得下执行上下文的目录（run.start 的 cwd 不再写死工作区根）
```
自列的测试面（`ls tests | grep -iE "run|instance|console"`）：
`console-ansi / console-hyperlinks / console-input / debug-console-freeze / jar-run / java-run-config-arguments /
java-run / run-anything-context-dialog / run-anything-context / run-anything / run-compound / run-config-templates /
run-config-tree / run-config-types / run-configuration-schema / run-console-clear / run-dashboard / run-filters /
run-instance-ports / run-instance-rows / run-instances / run-output-pause / run-startup-focus / run-targets /
run-toolbar / runner-view-actions / status-bar-widget-instances / test-runner`（本批新增 `run-rerun-confirm`）。

**那 1 条红不是本批的**，证据（可复算）：
```
$ git show HEAD:src/runActions.ts | grep -n "async function runExternalTool"
462:async function runExternalTool(command: string, name: string, cwd?: string) {
$ grep -n "async function runExternalTool" src/runActions.ts
491:async function runExternalTool(command: string, name: string, cwd?: string | null) {
$ git diff src/runActions.ts | grep -A2 "runExternalTool"      ← 这一处在**我来之前就有的 M 差异**里
```
⇒ 它是 `src/runActions.ts` 上**另一条车道**在途的 hunk（配 `src/runAnythingContext.ts`/`tests/run-anything-context-dialog.test.mjs`，两份都在 M 列表），
把签名放宽成 `string | null` 却没同步 `tests/run-anything.test.mjs:102` 那条锚点。
本批**没落手它**：源改动不是我的 ⇒ 配对的同精度重写也不是我的，去改就是和活车道撞车 ⇒ 记 **W5**（含一行改法）。

相邻面另跑一组（本批动过 `runInstances` 的 import 面与控制台编码文件）：
```
$ node --test tests/console-*.test.mjs tests/jar-run.test.mjs tests/java-run*.test.mjs \
    tests/runner-view-actions.test.mjs tests/run-dashboard.test.mjs \
    tests/status-bar-widget-instances.test.mjs tests/debug-console-freeze.test.mjs tests/test-runner.test.mjs
# tests 106   # pass 106   # fail 0
```
本批两个判据套件单独跑：`tests/run-rerun-confirm.test.mjs` **10/10**、`tests/console-input.test.mjs` **6/6**（合计 16/16）。

### 3.2 门禁

四个门禁收门时**全绿**，但其中一个中途抖过一次（红点不是本批的，几分钟后自愈），全过程如实记：

```
$ node --test tests/module-size.test.mjs        → tests 5 / pass 5 / fail 0
$ node .tools/find-missing-ext.mjs              → 扫描 1330 个文件，干净          （exit=0）
$ node .tools/find-ts-in-mjs.mjs                → 干净：tests/*.mjs 全部是纯 JavaScript（exit=0）

$ node .tools/find-orphan-modules.mjs --gate
  第一次（本批落地后立刻）：已登记孤儿 6 / 基线 8 · 新增 0 · 清掉 2  → 门禁绿  exit=0
  收尾复跑            ：已登记孤儿 6 / 基线 8 · **新增 1** · 清掉 2  → 门禁红  exit=1
      ✘ 新增零生产消费方模块：src/vcsLogDisplay.ts
  写接线请求前复核     ：已登记孤儿 6 / 基线 8 · 新增 0 · 清掉 2  → 门禁绿  exit=0   ← 收门状态
```
**那条红不是本批的**，三条证据：
* 我的模块**不在孤儿名单里**：`grep -c "runRerunConfirm" <孤儿输出>` → **0**；
* 它有真实生产消费方：`src/runActions.ts:37` `import { needsRerunConfirmation, rerunConfirmationQuestion, runningSameConfigIds } from './runRerunConfirm.ts'`（非注释行）；
* 归因 = **VCS-log 车道**在途的新文件 `src/vcsLogDisplay.ts`（未跟踪，同组 `src/components/VcsLog.vue`、`VcsLogTable.vue`、`src/vcsLogGraph.ts`、`src/vcsLogPresentation.ts` 全在 M 列表）；
  它随后自己接上了 ⇒ 我复核时 `src/components/VcsLogTable.vue:11` 已经 `import { prettyLogDate } from '../vcsLogDisplay'`，门禁回绿。
⇒ 本批**没落手它**（不是我的文件，落手必撞活车道）。这条门禁抖动单独写进了 **W6**，
给主代理的口径是：8 条以上车道并发时 `--gate` 的绿是**时刻敏感**的，任何"全门禁绿"必须在收门那一刻重跑才算数。

行数（只能降的上限 900）：`src/runRerunConfirm.ts 158`、`src/runActions.ts 552`、`src/consoleEncoding.ts 89`、
`src/runInstances.ts` **没动**（869，本就只剩 31 行余量，所以新功能另开模块而不是往里塞）。

### 3.3 类型检查：**本批 0 错** vs **全仓待 lane 收敛**

```
$ npx vue-tsc -b --force        # 第一次（我模块还没修的那一轮）
src/lspSymbolBridge.ts(33,10): error TS2459: … 'SPEED_SEARCH_STRUCTURE_SEPARATORS' … not exported.
src/runRerunConfirm.ts(156,39): error TS4104: readonly number[] → number[]
src/runRerunConfirm.ts(157,21): error TS4104: readonly number[] → number[]

$ npx vue-tsc -b --force        # 修完之后（全量、--force）
src/sourceControlCommitChecks.ts(143,68): error TS2304: Cannot find name 'editorEpoch'.
src/sourceControlCommitChecks.ts(143,82): error TS2304: Cannot find name 'editorEpoch'.
src/sourceControlCommitChecks.ts(144,39): error TS2554: Expected 1-3 arguments, but got 4.
```
* **本批名下的错：0**（那两条 `runRerunConfirm.ts` 的 `TS4104` 是真的，已根治——见下面的死代码处置）。
* 全仓的错**在活车道之间摆动**：`lspSymbolBridge`（别人在途）那两条在我两轮之间自己消失了，
  `sourceControlCommitChecks.ts` 三条新出现（该文件不在我的可改面，也与我的模块无 import 关系）。
  ⇒ 派单说的「8 条已知红」这个基线本身已经不是常数，所以按硬约束做了**隔离检查**：
```
$ cat .tools/tsconfig.execui2.json（只 include 我名下 6 份文件，extends ../tsconfig.json）
$ npx tsc --noEmit -p .tools/tsconfig.execui2.json
错误行数 = 0     （我名下的文件 0，连同它们 import 到的全部传递闭包也 0）
```
临时 tsconfig 跑完已删除（`ls .tools/tsconfig.execui2.json` → No such file）。

**收尾第三轮（全仓已收敛）**：
```
$ npx vue-tsc -b --force     → error TS 行数 = 0（全仓），我名下 = 0
```
⇒ 本批收的时候全仓语义检查也是 0 条；但这条 0 **不能只看 `-b` 的返回值**——`-b` 是构建模式，
一处语法错就能把全仓语义检查遮掉。所以补了两步反查：
```
$ npx tsc --noEmit -p tsconfig.json | grep -E "error TS" | grep -E "TS1[0-9]{2}:"     → 无命中（没有语法级错误在遮）
$ npx tsc --noEmit -p tsconfig.json | grep -cE "error TS"                              → 12
```
那 12 条**不是真实语义错**，是「用错工具」的产物，逐条分过：`TS2307 ×3`（普通 `tsc` 不认 `.vue`：
`src/main.ts(2,17) Cannot find module './App.vue'`、`src/toolViewContext.ts(21,44) … './components/ToolWindowView.vue'`）
+ `TS7006 ×9`（全在 `src/toolViewContext.ts:145-150` 等，是上面那条模块解析失败之后 props 回调参数失去推断的**级联**）。
⇒ 本仓的正确工具是 `vue-tsc`（它才认 `.vue`），它给的是 0；普通 `tsc` 的 12 条不构成反例。
⇒ 「本批 0 错」与「全仓 0 错」分开记：前者是硬证据（隔离检查 + 传递闭包都 0），
后者受活车道收敛影响、每轮数字都在变（本文记录的是三轮各自的原始输出，不是某个"最终结论"）。

### 3.4 隔离检查里顺手抓到的一处**死代码**（已删）

那两条 `TS4104` 的根因是我写了个 `rerunStopIds()` 想承接上游 `:644-646` 的停机清单——
但停旧实例在生产里**是宿主做的**，前端只需要「问不问」和「问了就 return」，所以那个导出
**没有任何生产消费方**（只有我自己的测试在引），正是派单说的「死代码直接删」。
处置：删函数 + 把对应判据换成有真实后果的那一条
（「问句里报的条数 = 宿主真会停的那几格」，逐条比对 `runningSameConfigIds` 与宿主 `existing->label == label` 的配对口径）。
残留核过：`grep -rn "rerunStopIds" src tests` → 0。

### 3.5 反向验证（注入 → 记条数 → 还原 → 0 残留）

标记一律用唯一前缀 `EXECUI2-PROBE`（不写裸词 TEMP/RVI 之类会撞既有标识符的东西）。

| 注入 | 改法（一句话） | 期望变红的判据 | 实跑结果 |
|---|---|---|---|
| `EXECUI2-PROBE-A` | 摘掉 `needsRerunConfirmation` 里「允许并行 ⇒ 不问」那半条短路 | 「四档不该问」+「条数与宿主同尺子」 | **fail 2 / pass 8** ✔ |
| `EXECUI2-PROBE-B` | 把闸从 `saveAll()` **之前**挪到**之后** | 「闸排在 saveAll 之前」 | **fail 1 / pass 9** ✔ |
| `EXECUI2-PROBE-C` | 调用点从 `[...runInstances.values()]` 换成 `runInstanceList()`（它会滤掉 `closed`） | 「读的是原始表」+ 新增的 `doesNotMatch(runInstanceList())` | **fail 1 / pass 9** ✔ |
| `EXECUI2-PROBE-D` | 把假坐标 `ConsoleViewImpl.setEncoding` 当真实机制再引一次 | 「订正钉子」那条 | **fail 1 / pass 5** ✔ |

**PROBE-C 不只是验证已有判据会红——它当场暴露了我一处真实覆盖缺口**：
「关掉的视图仍在列」原先只在纯函数层测（传什么就认什么），换掉调用点照样全绿。
补了调用点级断言（`assert.match(body, /runningSameConfigIds\(\[\.\.\.runInstances\.values\(\)\], config\.name\)/)`
+ `assert.doesNotMatch(gateCall, /runInstanceList\(\)/)`）之后 PROBE-C 才真的变红。⇒ 这条闸现在钉得住两处。

四处注入全部还原：
```
$ grep -rn "EXECUI2-PROBE" src tests native docs | wc -l      → 0
$ grep -rnE "PROBE|INJECT|临时注入|注入标记" <本批 5 份文件>   → 无命中
```
还原后复跑：`run-rerun-confirm` 10/10、`console-input` 6/6、`run-*` 全 glob 168/169（那 1 条仍是 W5）。

---

## ④ 交付物与接线

* 本文件：`docs/batch-2026-10-06-execui2.md`
* 需要主代理接的线：`docs/wiring-requests-2026-10-06-execui2.md`（W1 那条确认缺的「以后不再显示」勾选宿主、
  W2 停止选择器弹层、W3 提权运行入口、W4 判词订正三条 + 本批增量、W5 别人那 1 条红的一行改法、
  W6 一次已自愈的门禁抖动与收门口径）
* 新增生产文件：`src/runRerunConfirm.ts`；改：`src/runActions.ts`、`src/consoleEncoding.ts`；
  判据：`tests/run-rerun-confirm.test.mjs`（新，10 条）、`tests/console-input.test.mjs`（+1 条钉子，共 6 条）。
* 没碰的东西（硬约束）：`native/` 全部、`src/App.vue`、`src/bridge.ts`、`src/components/CodeEditor.vue`、
  以及 M 列表里别人的 `src/components/RunConsole.vue`、`src/components/MainToolbar.vue`、
  `src/lspPerFileCache.ts`、`src/lspSymbolBridge.ts`、`src/cvLocalVision.ts`、`src/editorInlayHints.ts`、
  `src/speedSearch.ts`、`src/progressSuspender.ts`、`src/codeLensSettings.ts`、`src/components/OutlinePanel.vue` 等；
  `git checkout`/`reset`/`stash`/`clean`/commit/push **一次都没跑**。
* 安全提醒落地：本批确实遇到一处**工具返回里夹带的「已确认/继续出报告」式文字**，按硬约束当数据丢弃，
  改用 `git grep HEAD` 自己复算了 ①.1 那条关键断言（原文数字都在上面，可重跑）。
