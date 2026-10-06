# 批次报告 · 2026-10-06 · 运行实例族（代号 runinst）

派单：`exec/run-instances`（判词在 `docs/inventory/verdict-execution.md`）里**用户还看得见**的剩余缺项，**模块侧**：
行模型、多实例并存时的选择与命名、控制台内容按实例归属；判定一律纯函数/纯模型 + 判据，宿主挂载写请求。

开工前置：`.tools/agent-rules.md` 已全读；**AGENTS.md 在本仓不存在**（`ls D:/TaoCode/AGENTS.md` 报 No such file，
`find -maxdepth 2 -iname "agents*.md"` 只在参考树里命中）⇒ 规则以 agent-rules.md 为准，这一条如实登记。

上游唯一真源：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（未上网）。
**本批所有引用都做过机器核对**：脚本逐条打开参考树，25 条去重后的上游引用全部命中、区间都不为空（见 §3 最后一条）。

---

## 1 · 判词表（族 / 项 / 判定 / 上游坐标 / 本仓落点 / 说明）

族：`exec/run-instances`。判定符号沿用 inventory 的口径：`[x]` 已做 · `[~]` 部分 · `[ ]` 未做 · `[-]` 不适用。

| 项 | 判定 | 上游相对路径:行号（本批亲自打开过） | 本仓落点 | 一句话说明 |
|---|---|---|---|---|
| 实例列表的**行模型**：选中 / 退出码 / 存活（live 角标 vs 置灰）/ 标签描述 / 每格可停性 / 控制台缓冲 | `[~]` 本批做完判定，挂载待 R2 | `platform/execution/src/com/intellij/execution/ui/RunContentDescriptor.java:116-123`、`:218-220`；`platform/execution-impl/src/com/intellij/execution/ui/RunContentManagerImpl.kt:312`、`:361-366`、`:369-376`、`:389-405`（清描述是 `:402`）、`:432-435`；`platform/execution/resources/messages/ExecutionBundle.properties:204`；`platform/execution-impl/src/com/intellij/execution/impl/ConsoleBuffer.java:8-22`；`platform/lang-impl/src/com/intellij/execution/impl/ConsoleViewImpl.kt:186-187` | `src/runInstances.ts:521-640`（`RunInstanceRow`、`runInstanceRows`、`runInstanceState`、`runInstanceStatusText`、`runInstanceExitText`、`instanceStoppable`、`consoleBufferChars`）；投影消费点 `src/runInstances.ts:455-472`（`runningListRows` 改为从行模型投影 ⇒ **今天就在跑**）；判据 `tests/run-instance-rows.test.mjs` 第 1-6、14-15 条 | 「正在运行」清单、标签条、停止装配三处以前各算各的（含同一实例两处不同名），现在只有一个行模型；退出码四档与 `src/runDashboard.ts:69-84` 逐行核对一致（测试里做了交叉断言） |
| 多实例并存时的**命名与区分** | `[~]` 判定做完，标签挂载待 R2b | 标题 `RunContentDescriptor.java:116-123`、`:218-220`；同名不消歧的反证：全树只有 `platform/execution-impl/src/com/intellij/execution/actions/EditRunConfigAndRunCurrentFileExecutorAction.java:46-47` 一处 `UniqueNameGenerator`，那是给**配置名**去重不是给标签；区分手段 `RunContentManagerImpl.kt:369-376` + `ExecutionBundle.properties:204`；无名兜底 `ExecutionBundle.properties:201`（`run.configuration.no.name=<No Name>`，用在 `ExecutionManagerImpl.kt:1155-1162`） | `src/runInstances.ts:578-606`：`runInstanceTabDescription`（`进程 ID：N`，直译自 `Process ID: {0,number,#}`）、`RunInstanceRow.duplicateTitle` | 上游**不给同名标签加 `#2`**，靠 pid 那句描述区分 ⇒ 本仓补的就是那句描述，而不是再造后缀；没有 pid 时如实返回空串（宿主不渲染，不假造区分信息） |
| 多实例并存时**「停止」到底停谁**（一条直接停 / 多条「停止…」+ 计数 / 弹层条目 / 停止全部 / 预选中 / 标题两档 / 再点一次=停全部） | `[~]` 判定做完，弹层本体缺宿主（R2c） | `platform/execution-impl/src/com/intellij/execution/actions/StopAction.java:59-65`、`:73-128`、`:141-143`、`:152-181`（`stopAll` 条目 `:158-168`、`:177-179`）、`:199`、`:213-215`、`:279-290`、`:293-308`、`:310-315`；`platform/execution-impl/src/com/intellij/execution/StoppableRunDescriptors.kt:17-63`（`:19` 顺序、`:24-26` 过滤、`:51-62` 一个环境一个代表）、`:87-107`；`platform/execution-impl/src/com/intellij/execution/ui/RunToolbarPopup.kt:752-758`；`ExecutionBundle.properties:208`、`:209`、`:491`、`:492`、`:203`、`:529`；`platform/platform-resources-en/src/messages/ActionsBundle.properties:941-942` | `src/runInstances.ts:660-845`：`STOP_LABELS`、`StopRowInput`、`stoppableCandidates`、`stopCounterText`、`stopActionState`、`stopChooserItems`、`resolveStopActionTargets`；键位文本按参数传入（`src/keymap.ts` 是保留文件 ⇒ 不写死） | 「停止」那一格以前只看 `runState.running`（bool），用户看不出停的是谁、共几个；现在 enabled/visible/文案/角标/kill 语义/条目/预选全按 `StopAction` 的分支算出来 |
| 控制台内容**按实例归属**：分块解码残段串台 | `[~]` 模块侧做完；桥接传 id 那一步必须接 R1（不接则退回今天行为） | 一条 descriptor 一个控制台：`RunContentManagerImpl.kt:308-312`；字符集是**应用级默认**：`platform/lang-impl/src/com/intellij/execution/console/ConsoleEncodingComboBox.kt:20-57`、同目录 `ConsoleConfigurable.java:116-125`、`:157-159`、`:183-190` | `src/runInstances.ts:76-131`（`instanceDecoders` 那张 Map + `decoderFor` + 换编码时**逐实例**冲残段）、`:143-149`（记录重建时丢旧解码器，`:148`）与 `:164-170`（`forget` 里同步丢，`:168`）、`:328-355`（`decodeRunChunk(b64, instance?)`、`flushRunDecoder(instance?)`）、`:248`（`handleRunExit` 只冲自己那个实例的残段）；判据 `tests/run-instance-rows.test.mjs` 第 17-21 条 | 原缺陷是真的：全仓共用一个 `TextDecoder`，两个实例并发输出时甲的半个字符会拼到乙的下一块前面 ⇒ 内容跑到别的标签 + 乱码；现在残段只等自己那个实例，不带 id 的分块（桥接今天的形状）保持原行为不退化 |
| 同名**已结束那格**的复用（重跑同一配置不堆标签） | `[~]` 判定做完，未自动接（理由写在代码里） | `RunContentManagerImpl.kt:788-826`、`:828-856`、`:854-856`、`:296-308`、`:862-868` | `src/runInstances.ts:849-869`（`chooseReuseInstance`）；判据第 16 条（6 个分支） | 不自动接的原因如实写进注释：上游是**原地换内容**（保留 content、component 换成新 descriptor），本仓标签条扁平、按起跑顺序排 ⇒ 摘旧格排到新尾不是同一件事；且复用条件依赖 `Content.isPinned`，本仓运行视图那条差异已在 `src/runToolWindowLayout.ts:29-32` 登记 |
| 非并行配置重跑时的**确认框**（「不允许并行，要不要停掉 N 个在跑的实例」） | `[ ]` 未做（本批只做核实的现状登记） | `platform/execution-impl/src/com/intellij/execution/impl/ExecutionManagerImpl.kt:605-641`（`:617-619` 触发条件、`:627` 停哪些、`:630-637` 问不问）、`:1097-1128`（`:1099-1101` 免问、`:1104-1118` 「不再显示」格）、`:1130-1152`；文案 `ExecutionBundle.properties:212`、`:213`、`:94`、`:214-215`；`platform/platform-api/resources/messages/UIBundle.properties:1` | 现状：`native/run_host.cpp:363-365`（宿主在 `allowParallel=false` 时**静默**停同名实例）、`src/runActions.ts:102`（`params.allowParallel` 的来源） | 用户可见差异：**上游问、本仓不问**。要做需要一个确认框通道（App.vue 冻结）⇒ 已把线与文案键写进请求 R3 末段，没有放假控件 |
| 一个执行环境只出**一个代表**（同配置多 descriptor 归并） | `[-]` 没有 EP 宿主 | `StoppableRunDescriptors.kt:51-62`、`:65-74`、`:87-107`（`DisplayDescriptorChooser` EP 定义） | 无 | 归并靠插件扩展点选代表，本仓没有插件 EP 宿主 ⇒ 如实一个实例一行，已写进行模型注释与请求 R4，不假造归并 |
| **按实例的进程内存占用（工作集）** | `[-]` 上游没有这个用户可见面 | 反证：`platform/execution-impl/src/com/intellij/execution/` 与 `platform/execution/src/com/intellij/execution/` 两目录 grep `-i memory` 只命中 `portsWatcher/impl/TcpTableApi.java:33`、`:43-44`、`:78`、`:97` 的 JNA `MemorySegment` 与 `BaseExecuteBeforeRunDialog.java:173` 等 `createSmallMemoryFootprintSet`；`platform/execution.dashboard/src` grep `memory|rss|workingSet` 零命中 | `src/runInstances.ts` 的 `bufferChars`/`bufferLimitChars`/`truncated`（上游真有的那一档：控制台缓冲，`ConsoleBuffer.java:8-22` + `ConsoleViewImpl.kt:186-187`） | 派单里「行模型带内存」这一格，上游可对上的只有控制台缓冲的有界内存；进程工作集没有任何上游展示面 ⇒ 按铁律 §3 不编读数、不放假控件，行模型只带上游有的那三个字段 |

### 本族既有项的现状核对（派单第 1 步：逐条对着本仓真实文件名核）

`src/` 里本族真实存在的文件（`ls src/ | grep -iE 'run|exec|process'` 核对过）：
`runInstances.ts` `runDashboard.ts` `runActions.ts` `runToolbar.ts` `runToolbarSlots.ts` `runToolWindowLayout.ts`
`runConfigurations.ts` `runConfigTree.ts` `runConfigEditors.ts` `runConfigTemplates.ts` `runConfigurationSchema.ts`
`runCompound.ts` `runAnything.ts` `runAnythingContext.ts` `runHyperlinks.ts` `runIssues.ts` `runTargets.ts`
`executionTargets.ts` `processTree.ts` `processTerminated.ts` `processClose.ts` `processPopup.ts` `jarRun.ts`
`javaRun.ts` `languageRuntimes.ts` `testRunner.ts` `consoleAnsi.ts` `consoleEncoding.ts` `consoleFold.ts`
`consoleHyperlinks.ts` `consoleInputHistory.ts`（+ 宿主 `native/run_host.cpp`、`native/run_host.hpp`）。

判词里已升过档、本批复核**仍然成立**的（不重复实现）：④ 端口监视器（`run.instances` 的 `ports`、
`src/runInstances.ts:363-381` 的 `applyRunInstanceSnapshot`）、`ShowRunningListAction` 的「正在运行」清单
（`src/runInstances.ts:414-476`，已接暂停/清空/关视图）、`PauseOutputAction`、控制台输入历史与编码选择。

判词里写「缺」但本批核实**确实还缺**的（不谎报）：① `ExecutionListener` 型扩展点（无 EP 宿主）；
② process mediator / remote（`src/` 全库 grep `RemoteRunProfile` 零命中）；③ 提权运行
（`native/` grep `elevat|runas` 只命中 `native/workspace.cpp:1157`、`:1184`、`:1227`、`:1232` 的
`ShellExecuteW(L"open", …)`，那是浏览器/资源管理器打开，不是 UAC 提权启动）。

**已做但未升档、本批只写请求没动判词文件的**（`docs/inventory/*.md` 是保留文件、判词正文在保留的
`scripts/verdict_table.py` 里）：本批 6 条新增判定 ⇒ 建议并入的整段文字已写成 paste-ready，
见 `docs/wiring-requests-2026-10-06-runinst.md` §R4。

**坐标错误（原写 X、实际 Y，留痕）**：派单给的
`platform/execution/impl/src/com/intellij/execution/executor/ExecutionManagerImpl.java` 在这份树里不存在；
实际 `platform/execution-impl/src/com/intellij/execution/impl/ExecutionManagerImpl.kt`（Kotlin）。
`RunContentDescriptor` 实际在 `platform/execution/src/com/intellij/execution/ui/RunContentDescriptor.java`；
`RunContentManagerImpl` 实际在 `platform/execution-impl/src/com/intellij/execution/ui/RunContentManagerImpl.kt`
（不在 `platform/lang-impl`）。另外本仓旧注释里的 `ConsoleViewImpl.setEncoding` **不是上游方法**
（该文件 grep `setEncoding` 零命中）⇒ `src/runInstances.ts` 那处已按上游改成「设置页的应用级默认编码」，
`src/consoleEncoding.ts:5-7` 同一处错误不在本族可改面 ⇒ 已写进请求 R4 末尾交给该文件所有者。

---

## 2 · 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 动作 |
|---|---:|---:|---|
| `src/runInstances.ts` | 415 | 869 | 改：按实例解码器（+ 换编码逐实例冲残段 + 记录重建丢解码器 + `handleRunExit` 只冲自己实例）；新增行模型、命名/描述、可停性、缓冲、停止装配、复用判定；`runningListRows` 改为从行模型投影（同一实例两处同名）；修掉 `ConsoleViewImpl.setEncoding` 那处假坐标 |
| `tests/run-instance-rows.test.mjs` | — | 421 | 新建：24 条判据（本族新域的判据文件） |
| `docs/wiring-requests-2026-10-06-runinst.md` | — | 275 | 新建：R1（bridge 传 instance）、R2a/R2b/R2c（MainToolbar 停止格 / RunConsole 标签条 / 弹层挂载）、R3（复用挂载 + 重跑确认线）、R4（判词升档整段 + 坐标更正） |
| `docs/batch-2026-10-06-runinst.md` | — | 本文件 | 新建：交付报告 |

保留文件（`src/App.vue`、`src/bridge.ts`、`src/style.css`、`src/tokens.css`、`CMakeLists.txt`、
`scripts/verdict_table.py`、`docs/inventory/*.md`）**一字未动**；`native/` 未动 ⇒ 不跑 ctest。
`git diff` 自查：本批只有上面 4 个文件的新增/修改（`git status --porcelain src/runInstances.ts src/bridge.ts src/App.vue native/` 见 §3）。

---

## 3 · §5 每条自查命令的前后数字

| 门禁 | 批次开始（基线） | 收工 | 归属 |
|---|---|---|---|
| `npx vue-tsc -b --force` | 23 错（全部在别人在途文件：`src/lspProgress.ts` 19、`src/components/PluginDialog.vue` 3、`src/semanticHighlighting.ts` 1）；我改完第一段后我文件 1 错（`tabDescription` 漏字段） | **2 错**：`src/lspServerMessages.ts` 1、`src/refactorPreview.ts` 1；**`src/runInstances.ts` 与 `tests/run-instance-rows.test.mjs` 0 错** | 收工的 2 条不是我写的（本域 0 错） |
| `node --test tests/module-size.test.mjs` | 中途 1 次红：`src/components/ProblemsPanel.vue(903 行)`（别人的文件） | **5 pass / 0 fail（绿）**；`src/runInstances.ts` 869 < 900，上限未动、未登记豁免 | 中途那次红的 offender 不是我的文件，随后由该所有者自己修回 |
| 本域测试（15 个文件：`run-instances`、`run-instance-rows`、`run-instance-ports`、`console-input`、`java-launch-regression`、`run-output-pause`、`run-console-clear`、`runner-view-actions`、`run-dashboard`、`process-close`、`process-popup`、`process-tree`、`status-bar-widget-instances`、`run-toolbar`、`run-targets`） | 改动前 29/29（先跑 run-instances+console-input+java-launch-regression） | **119 tests / 119 pass / 0 fail**（含新判据 24 条） | 未跑全量 `npm test`（12 路并行，按规矩只跑本域） |
| `node .tools/find-param-props.mjs` | 基线 1 处（`src/semanticHighlighting.ts:209`，别人的） | **共 0 处参数属性** | 我新增的两行注释/代码不含 TS 语法 |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | 干净：`tests/*.mjs` 全部是纯 JavaScript | 新测试文件写的是纯 JS |
| `node .tools/find-missing-ext.mjs` | 干净 | 干净（扫 1298 个文件） | 值 import 全带 `.ts` 扩展名 |
| `node .tools/find-orphan-modules.mjs --gate` | 基线 9 | **门禁绿：已登记孤儿 9 / 基线 9 · 新增 0** | 见 §5 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 收工时 **8 pass / 3 fail** | 同样 3 条红，**一条都不是本批文件**：①「仓里每一条带路径的上游引用都指得到」15 条越界引用，全在 `docs/batch-2026-10-06-{projecttree,status2,status2defect,welcome2}.md` 与 `docs/wiring-requests-2026-10-06-{plugins,vcs2}.md`（4 个不存在的上游路径：`PsiUtil.java`、`SuppressIntentionAction.java`、`StructureViewFactoryImpl.java`、`EditorSettingsExternalizable.java`、`PluginAdvertiserEditorNotificationProvider.kt`）；② 锚点门「moved」1 条：`src/trustedProjects.ts` 的一条引用被改指到别处。门控统计：快照 1627 条 / 仓里活引用 2725 条 / 未入快照 1100 条（不拦） | 本批文件的核对见下一条 |
| 本批引用自证（临时脚本，跑在 `build/`，收工已删） | — | 扫 `src/runInstances.ts` + `docs/wiring-requests-2026-10-06-runinst.md` 共 **25 条去重上游引用**：**NO FILE 0、OUT OF RANGE 0、BLANK RANGE 0** | 每条都真的按行号打开过 |

`.ts` 注释纪律：本批新增注释全部是 `//` 行注释与不含裸 `*/` 的 Javadoc 风格块注释（`/** … */` 收尾，正文里不出现
`*/`）；改完 `vue-tsc` 0 错、`find-ts-in-mjs` 干净即为证据。

---

## 4 · 反向验证记录（注入违规 → 红 → 撤销 → 绿，三步数字）

**没留只过自己测试的死模块**、也**没放假控件**：本批 6 条判定里唯一今天就在跑的是「行模型 → `runningListRows` 投影」与
「按实例解码」；其余 4 条是纯模型（派单要求如此），挂载点全写成请求。

注入两条违规（直接改 `src/runInstances.ts`，备份在 `build/`）：

1. **A**：`decodeRunChunk` 丢掉实例分派，退回「永远用全局解码器」（即拆之前的行为）。
2. **B**：`instanceStoppable` 写成 `return !instance.stopping`（丢掉 `|| canKill` 那一半，
   等于上游 `StopAction.java:313-314` 的右半边判定被删）。

结果：`node --test tests/run-instance-rows.test.mjs` ⇒ **24 条中 6 条红 / 18 绿**，红的正是这 6 条：
「两个实例的分块交错时，半个字符只等它自己那个实例」、「带实例 id 的退出只冲它自己的残段，别人的残段不动」、
「切换控制台编码时，每个实例的残段写回它自己的控制台，不是写进当前实例」、
「实例记录被忘掉后它的解码器一起丢；id 被复用时不从上一轮残段接着拼」（A 命中 4 条）+
「stoppable：在跑可停；正在结束途中仍可停并换成 Kill process（:106-110)」、
「本地位置（工具窗口里那一格）读选中的那条，正在结束时刻出现 Kill process（:99-111）」（B 命中 2 条）。

撤销（`cp` 回备份，删备份文件）后：`grep -c` 确认两处注入文本各恢复 1 处；
`tests/run-instance-rows.test.mjs` ⇒ **24 pass / 0 fail**；与既有 `run-instances`、`console-input` 一起跑
⇒ **47 pass / 0 fail**（既有断言一条没改、没删、没放松）。

另有一处「既有断言会不会被我改坏」的反查：`tests/console-input.test.mjs:101-103` 钉的是
`let decoder = createConsoleDecoder(currentConsoleEncoding)` 与 `decoder = createConsoleDecoder(id)` 两行源码形状——
重构时刻意**保留**这两行（全局解码器那条链仍在，服务不带 id 的分块），该文件 24 条继续绿；
`tests/run-instances.test.mjs:208-213` 钉的 `运行 1` 那格在新命名口径下算出来仍是 `运行 1`（未动断言）。

---

## 5 · 零消费方自查结论

- `node .tools/find-orphan-modules.mjs --gate`：**门禁绿**，已登记孤儿 9 = 基线 9，新增 0、清掉 0。
  本批**没有新建 `src/*.ts` 模块**（全部落在已有的 `src/runInstances.ts`，它被 `src/bridge.ts:13`、
  `src/runActions.ts:28`、`src/components/RunConsole.vue:61-65`、`src/components/MainToolbar.vue:36` 引着），
  所以不可能引入新孤儿；新建的只有 `tests/*.mjs` 与 `docs/*.md`（不在孤儿扫描面）。
- 导出符号的消费链（自查逐条数过）：
  * 今天就有链路：`decodeRunChunk`/`flushRunDecoder`（bridge，带 id 的那一半等 R1）、
    `runInstanceRows`（模块内被 `runningListRows` 投影，`RunConsole` 的「正在运行」清单今天就在渲染）、
    `instanceStoppable`/`runInstanceTabDescription`/`runInstanceExitText`/`consoleBufferChars`/`runInstanceState`/
    `runInstanceStatusText`（都在 `runInstanceRows` 体内被调用）；
  * 有判据、等挂载（请求里写明）：`stopActionState`/`stopChooserItems`/`resolveStopActionTargets`/`stoppableCandidates`/
    `stopCounterText`/`STOP_LABELS`（R2a、R2c）、`chooseReuseInstance`（R3，不自动接的三条理由写在函数注释里）、
    `RUN_CONSOLE_BUFFER_LIMIT_CHARS`/`HOST_CAN_KILL_PROCESS`（被行模型读）。
- 没有任何「渲染了但没人消费」的 UI：本批一行模板都没写（组件是别人的可改面），全部挂载都走请求。

---

## 6 · 做不到 / 无法核实

1. **R1 不接 ⇒ 「按实例归属」在线上只完成一半**：`src/bridge.ts:357`、`:367` 调用解码入口时拿不到
   `data.instance`（`src/bridge.ts` 是保留文件）。模块侧已支持第二参数且默认路径与今天完全一致（测试钉住），
   但生产环境两个实例交错时仍是同一台全局解码器。**具体卡在**：桥接层那两行实参不是我能改的文件。
2. **停止选择器的弹层本体**：判定（条目、顺序、预选、标题、停止全部）都算得出来，
   但本仓没有 Swing 的 `JBPopup`，`RunConsole.vue`/`MainToolbar.vue` 不在我的可改面 ⇒ 只写请求 R2a/R2c，
   没有自己造一个没人挂的面板。
3. **非并行配置重跑的确认框（上游 `ExecutionManagerImpl.kt:605-641` + `:1097-1128`）没有做**：
   需要确认框通道（App.vue 冻结、本批没有可用的模态入口），而宿主 `native/run_host.cpp:363-365`
   已经在起跑时静默停同名实例 ⇒ 没有后端就没有链路（铁律 §3），只做现状核实与线（R3 末段）。
4. **「内存」这一格按派单字面理解成进程工作集时：无法核实上游有这个用户可见面**（两目录 grep `memory`
   只有 JNA/小集合工具，`platform/execution.dashboard` 零命中）。我按上游能对上的那一档
   （控制台缓冲的有界内存 `ConsoleBuffer.java:8-22` + `ConsoleViewImpl.kt:186-187`）落字段，
   没有编一个进程内存读数。若主代理的「内存」指的是别的上游面，请给坐标。
5. **`Content.isPinned` 的复用差异**：上游复用条件依赖钉住态，本仓运行视图没有 pinned 字段
   （`src/runToolWindowLayout.ts:29-32` 已登记「运行视图在上游永远不是固定的」）。
   `chooseReuseInstance` 的 `pinned?` 参数留了形并测住（钉住的不参与），但**真值来源不存在** ⇒ 不自动接。
6. **AGENTS.md 缺失**：派单要求先读 `AGENTS.md`，该文件在工作区不存在（`find -maxdepth 2` 无命中）。
   只有参考树里有 `AGENTS.md`（上游仓库自己的），与本仓无关 ⇒ 按 `.tools/agent-rules.md` 执行。
7. `docs/inventory/verdict-execution.md` 与 `scripts/verdict_table.py` 是保留文件 ⇒ 判词升档**没动**，
   整段建议文字放在请求 R4，等主代理改脚本后重新生成。

---

## 7 · 需要主代理接的线

全部单放在 **`docs/wiring-requests-2026-10-06-runinst.md`**（R1 bridge 传 instance / R2a MainToolbar 停止格 /
R2b RunConsole 标签条 / R2c 停止选择器宿主 / R3 复用挂载 + 重跑确认 / R4 判词升档 + 两处坐标更正），
每条都带目标文件、目标行号、import 语句和可照抄的整段替换代码。本批**未 commit、未 push、未跑任何 git 写操作**。
