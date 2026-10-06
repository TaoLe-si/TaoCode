# 批 2026-10-06 · 第二批 · 代 `runcfg2`（JUnit 树时长呈现 / 运行配置类型五处门 / 六族判词复核）

派单三件事：① `docs/batch-2026-10-06-runcfg.md` 的 W-Runcfg-1～4 里属我面的做完（JAR ⇒ 五处一起交请求，不单改）；
② `TestRunnerPanel.vue(238,59)` 的 TS7053 复核并**收工 0 错**；③ `exec/junit`、`exec/testframework`、`exec/run-configs`、
`exec/configurations-types`、`exec/actions`、`lp/build` 六族判词先核后做。
交付：本文件 + `docs/wiring-requests-2026-10-06-runcfg2.md`。

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（未上网检索、未做像素比对；
**下面每条上游行号都是本轮自己开文件数出来的**，本仓行号是收工时自己文件的实测值）。

---

## 0. 三件事的结论（先说结果）

| 事 | 结论 |
|---|---|
| ① W-Runcfg-1～4 | **W-Runcfg-1（测试树跳转最后一段）**：复核为已接（`src/App.vue:2212` 的 `@jump` 仍在，行号本轮重数过），本轮无改动。 ⇒ **W-Runcfg-2（JAR）**：属我面的三处（`runConfigurationSchema.ts`/`runConfigTree.ts`/`runConfigEditors.ts`）**没有单改**，按派单口径把五处整段可照抄的替换代码重发在请求 R1，并**新补一条事实**：第五处（宿主白名单）从本轮起也有机器门。 ⇒ **W-Runcfg-3（判词回写）**：主代理的活，本轮把六族逐条复核结果写成可粘贴的表（请求 R4）。 ⇒ **W-Runcfg-4（Rebuild 键位偏差）**：两处都是保留文件（`src/keymap.ts:267-268`）与我面（`src/menus/buildMenu.ts:47`），按上游改必须同时动 ⇒ 保持现状 + 重发在请求 R3，并复核了「上游 `CompileProject` 无默认键」这条 |
| ② 现网红 | `npx vue-tsc -b --force` 起手实测 **0 错** ⇒ `TestRunnerPanel.vue(238,59)` 的 TS7053 **已不在**（上一批用 `SORT_FLAG_OF` 把 `keyof` 索引钉住，那段现在在 `:247-251`，行号漂了 9 行）。本轮我自己的改动新出过 1 条（`TestRunnerPanel.vue(546,87)` TS2322，`title` 收 `null` 不收 `null`）⇒ 已修。**收工实测 0 错**（中途曾见 9 条，全在他人名下文件，见 §3） |
| ③ 六族判词 | 核完：**六族里有 8 条「缺项」其实早就做了**（判词过期），另有 **5 条本轮真的补上了**（时间戳 / suite wall time / 运行中实时时长 / Overall+Sum tooltip / 耗时排序改比 customized duration）。逐条「原写 X、实际 Y」见 §1 与请求 R4 |

## 1. 判词表

档位：`[x]` 已做 · `[~]` 部分（写「本仓已有」+「还差」）· `[ ]` 未做 · `[-]` 不适用（附具体理由）

### A. `exec/testframework` —— 时长呈现（本轮新增的五块，都在我面）

| 项 | 判定 | 上游 `路径:行号` | 本仓落点 `文件:行号` | 一句话 |
|---|---|---|---|---|
| 节点的开始/结束**时间戳** | `[x]` | `platform/smRunner/src/com/intellij/execution/testframework/sm/runner/SMTestProxy.java:450-458`（`setStarted` 里 `if (myStartTime == null) myStartTime = System.currentTimeMillis()`）、`:474-477`（`setSuiteStarted` 同口径）、`:629-630`、`:645-646`（结束侧同样只盖第一次） | `src/testTree.ts:47-59`（节点两个字段）、`:88-95`（两张戳表）、`:107`（可注入时钟）、`:129-168`（`apply` 盖戳）、`:174-176`（`openNode` 不覆盖）、`:203`、`:230`（建节点时带出去） | **订正上一批的判词**：原写「本仓协议只发 `durationMs` ⇒ 拿不到 start/end，做不到」。实际上游也不是协议字段，而是**事件到达时客户端盖的时钟** ⇒ 不需要改 `src/testEventChannel.ts`、不需要动宿主/适配器 |
| suite 的 **wall time** | `[x]` | `java/execution/impl/src/com/intellij/execution/testframework/JavaSMTRunnerTestTreeView.java:75-84`（suite + 已结束 + `USE_WALL_TIME` ⇒ `endTime - startTime`）；`JavaAwareTestConsoleProperties.java:55`（`new BooleanProperty("useWallTime", true)` **默认开**）、`:177-178` 注释、`:184-197`（`getCustomizedDuration`） | `src/testTree.ts:622-624` | 已结束的 suite 右侧画「整层跑了多久」而不是「孩子之和」；`USE_WALL_TIME` 关着那一支（`:60-61` + `:88-110` 的「取第一个孩子的开始」）**不落**，理由见 §6.2 |
| 运行中节点的**实时时长** | `[x]` | `JavaSMTRunnerTestTreeView.java:58-74`（在跑 ⇒ `System.currentTimeMillis() - startTimeMillis`、**向下取整到整秒**、`durationSeconds == 0` 直接不画） | `src/testTree.ts:610-621` | 与上游同一前提：没有开始戳不画（`:66-68`）、跑不满 1 秒不画（`:70-71`，免得数字闪烁） |
| 非叶子行右侧的 **Overall/Sum 两行 tooltip** | `[x]` | `JavaSMTRunnerTestTreeView.java:117-150`：`:133-137` 的门（叶子不画、两个戳缺一个或 `end <= start` 不画）、`:139` 的 `getWidth()/2 < Math.abs(p.x)`（**只有行右半侧**有 tooltip）、`:140-147` 的两行；文案 `java/openapi/resources/messages/JavaBundle.properties:2038`（`Overall time: {0}`）与 `:2039`（`Sum time: {0}`） | `src/testTree.ts:599-600`（两条文案常量，英文原文）、`:637-647`（`testNodeDurationTooltip`）、面板 `:547`（挂在行右侧那一格的 `title` 上） | 上游那条「行右半侧」的几何门在本仓的天然等价物就是右侧那一格 —— tooltip 只挂在那里，没有多造控件 |
| **耗时排序改比 customized duration** | `[x]` | `platform/testRunner/src/com/intellij/execution/testframework/TestFrameworkRunningModel.java:52`（比的是 `t2.getCustomizedDuration(properties)`，不是 `getDuration()`）；`SMTestProxy.java:516-524`（转给 provider）；`JavaAwareTestConsoleProperties.java:184-197`（suite ⇒ wall time；**两个戳缺一个返回 null，不退回孩子之和**，`:193-195`）；`platform/util-rt/src/com/intellij/openapi/util/Comparing.java:155-160`（null 算最小 ⇒ 降序排最后） | `src/testTree.ts:464-478`（`testNodeDurationMs`）、`:479-486`（null 安全的升序比较）、`:502-511`（比较器改用）；判据 `tests/test-tree-view.test.mjs:333-347` | 上一批的排序比的是 `durationMs`（= 孩子之和），与上游差一层：开着 wall time（默认）时 suite 之间应该按整层耗时排。**显示档不变**（`:85` 那一步回落到 `getDurationString()`/`getDuration()` = 孩子之和，`SMTestProxy.java:489-511`、`:546-549`）⇒ 排序与显示在这里刻意分岔，判据把两边都钉住 |
| 时长**格式**（最多两个单位 + 单位名） | `[x]`（既有，本轮复用） | `platform/ide-core-impl/src/com/intellij/ide/nls/NlsMessages.java:111-115`（`formatDurationApproximateNarrow`）、`:32-33`（`UNIT_KEYS`/`TIME_MULTIPLIERS`）、`:155-196`（narrow 走 `.short` 档并把空格换成 thin space）；`platform/ide-core/resources/messages/IdeCoreBundle.properties:170-172`（`ms/sec/min` 的 `.short` 文案） | `src/testTree.ts:545-570`（`testDurationText`，未改） | 复核结论：`123456 → "2 min 3 sec"` 这条既有断言**与上游一致**（`.short` 档带单位名，narrow 只把词内空格换成 U+2009）；本仓用普通空格，属**已登记的无害字形差**，见 §6.4 |
| 三个排序键 + 置顶 + 行内统计开关 | `[x]`（上一批已落，本轮复核没退） | `TestConsoleProperties.java:45-48`、`:57`；`platform/testRunner/src/com/intellij/execution/testframework/ToolbarPanel.java:82-114`、`:165-167` | `src/testTree.ts:408-420`、`:438-445`、`:497-526`、`:532-542`；面板 `:235-236`、`:247-251`、模板 `:471-487` | 只复核，没有重做；默认值/互斥/文案三条判据都还在（`tests/test-tree-view.test.mjs:165-231`） |
| 这些开关**随运行配置存盘** | `[-]` | `TestConsoleProperties.java:42`（`StoringPropertyContainer`）、`JavaAwareTestConsoleProperties.java:55` | 面板 `:235-236` 是运行时 `ref` | 具体理由：落盘要新设置键 ⇒ `src/settingsModel.ts` + `native/settings_schema.cpp` 两个保留文件，且规约 §3 要求「旧存档缺键补默认」⇒ 交请求 R2，不在本轮单开那条线 |

### B. `exec/run-configs` + `exec/configurations-types`

| 项 | 判定 | 上游 `路径:行号` | 本仓落点 `文件:行号` | 一句话 |
|---|---|---|---|---|
| 类型清单**第五处**也有门 | `[x]`（本轮新增） | `platform/execution-impl/src/com/intellij/execution/impl/RunManagerImpl.kt:178`（类型按 id 集中在一个注册表，不是各处抄一份）—— 本仓形状：把「必须同改」变成可跑的红测试 | `tests/run-config-types.test.mjs:132-151`（按文本读 `native/settings_schema.cpp:1011` 的白名单，与 `src/runConfigurationSchema.ts:14` 做**同序** deepEqual + 报错文案逐个点出类型名） | 上一批只登记了「原生白名单是第五处」这件事，靠人肉核；现在少改一处就红。反向验证见 §4 |
| 四份 TS 清单同步（既有） | `[x]`（复核没退） | 同上 | `tests/run-config-types.test.mjs:38-48` | 模型联合 / schema / 左树 / 编辑器表四方 deepEqual 仍在 |
| JAR 运行配置类型 `'jar'` | `[ ]` → **交请求** | `java/execution/impl/src/com/intellij/execution/jar/JarApplicationConfigurationType.java:20`（`super("JarApplication", ExecutionBundle.message("jar.application.configuration.name"), …)`，文件共 34 行）、`java/execution/impl/src/com/intellij/execution/jar/JarApplicationConfiguration.java`（279 行）、`platform/execution/resources/messages/ExecutionBundle.properties:55`（`JAR Application`） | 表已在：`src/jarRun.ts:50`（id）、`:52`（标签）、`:103`（表单字段）、`:180-191`（argv） | **本轮仍不落**：五处里 2 处是保留文件，单改我面三处 ⇒ 两张 `Record<NonNullable<RunConfig['type']>, …>` 少键（编译不过）或宿主拒存档。整段替换代码 + 本轮新增的第五处门 ⇒ 请求 R1 |
| 逐类型编辑器表（per-type `SettingsEditor`） | `[~]`（既有，判词过期） | `platform/execution-impl/src/com/intellij/execution/impl/ConfigurationSettingsEditor.java:79-87` | `src/runConfigEditors.ts:90-108` + `src/components/RunConfigurationsDialog.vue` | 族判词写「本仓一张通用表单、类型只是字段」⇒ **实际已有**每类型一张字段表 + 复合配置不给「启动前」；还差的只是每类型独立页签（存储/JRE/覆盖率页） |
| 配置继承 / 模板 / 运行目标 | `[~]`（既有，判词过期） | `RunManagerImpl.kt` 的 `getConfigurationTemplate` 一族 | `src/runConfigTemplates.ts`、`src/executionTargets.ts`、对话框的类型节点模板编辑器 | 复核：三条都有落点；上游 `RunConfigurationStorageUi` 的「存成项目文件」由设计禁止（不写用户项目目录）⇒ 永久 `[-]` |
| `ProgramRunner` 匹配链 / `ExecutionEnvironment` 富模型 / `ProcessProxy` / `RunTab` EP | `[-]` | `exec/configurations-types` 族判词点名的四类 | `src/runActions.ts`、`native/run_host.*`（都不是我名下） | 具体理由：本仓 run/debug 两条硬编码路径 + 宿主扁平 `RunStartParams`；要动的是运行实例族与宿主，不是运行配置面 ⇒ 本轮零改动，判词成立 |

### C. `exec/actions` + `lp/build`（Build 菜单面）

| 项 | 判定 | 上游 `路径:行号` | 本仓落点 `文件:行号` | 一句话 |
|---|---|---|---|---|
| Build Project / Rebuild / 停止构建 / 构建结果窗口 | `[x]`（既有） | `java/java-backend/resources/META-INF/JavaActions.xml:71-73`、`:78`；`platform/platform-resources-en/src/messages/ActionsBundle.properties:925-926`、`:923-924`；`platform/platform-resources/src/keymaps/$default.xml:303-305` | `src/menus/buildMenu.ts:21-40`（四条动作描述符）、`:43-52`（菜单行） | 复核：四条都有真处理器，标题/可用性走 `actionRegistry`，与「构建即跑一条命令行」的形状一致 |
| Rebuild 的键位偏差 | `[-]`（本轮不动，交请求） | `$default.xml:303-305`（`CompileDirty`）、`:428-430`（`Compile` = `ActionsBundle.properties:931-933` 的强制重编），`CompileProject` 在 `$default.xml` 里 0 命中 | `src/menus/buildMenu.ts:47`（我面）+ `src/keymap.ts:267-268`（保留） | 复核了上一批那条「0 命中」的 grep 结论（本轮重跑 `action id="CompileProject"` 仍 0 命中）；菜单 keys 与真实绑定一致 ⇒ 已留痕偏差，请求 R3 |
| Build Module / Compile / CompileFile / Build Artifacts… | `[ ]` | `JavaActions.xml:74-76`、`:80` | —— | 复核维持原判：本仓没有模块概念、没有单文件增量编译通道（构建=按项目类型折算命令行）、没有 artifact 模型 ⇒ 画了就是假控件 |
| 编译器输出解析族 | `[x]`（既有，判词点位比上一批更准） | `platform/lang-impl/src/com/intellij/build/output/JavacOutputParser.java`、`KotlincOutputParser.kt:22-23`/`:88-110`、`GroovycOutputParser.java:24-25`；dispatcher `platform/lang-api/src/com/intellij/build/output/BuildOutputParserDispatcher.kt` | `src/buildOutput.ts:32-36`（kotlinc 两种位置写法 + groovyc 模式）、`:55-60`（MSVC/GCC/Clang）、`:94-98`（CMake）、`:100-105`（`parseAnyIssue` 串链） | **订正上一批报告**：它写「`src/buildOutput.ts:31-36` 三个模式」；实际现在 kotlinc/groovyc 已在（`:38-53`），文件 105 行。dispatcher 那个 EP 由串链代替 ⇒ `[~]` 成立 |
| 构建事件模型 / 嵌套进度树 / 多构建视图 / `BuildTreeConsoleView` / `OpenFileQuickFix` | `[ ]` | `lp/build` 族（`docs/inventory/platform_rest_verdict_table.json` 的 `lp/build` 行逐类点名） | —— | 复核维持 `[ ]` 并把卡点写实：消费面（构建控制台、工具窗布局）在 `src/App.vue` 与 `src/components/RunConsole.vue`，**都不是我名下** ⇒ 只造模型就是零消费方死模块，规约 §3 禁止；`OpenFileQuickFix` 要写回文件 + 触发重编，链路在他人文件 |

### D. `exec/junit`（复核族，本轮没有新增落点）

| 项 | 判定 | 上游 / 本仓证据 | 一句话 |
|---|---|---|---|
| 「缺：按包/目录/模式运行」 | **判词过期** | 上游 `AbstractAllInPackageConfigurationProducer.java`/`AbstractAllInDirectoryConfigurationProducer.java`/`TestsPattern`；本仓 `src/junitPatterns.ts`（`parseTestPattern`/`packagePattern`/`tagFilter`）+ 面板 `:106-141`（模式 + 包/目录范围两个输入框 + 范围选择器回显） | 三条早做了，判词还在当缺口 |
| 「缺：JUnit 5 动态/参数化用例与 tags 的展示」 | **判词过期** | 本仓 `src/junitParameters.ts`（`ParameterCollector`）+ 面板 `:270`、模板 `:551-553`；tag 表达式 `src/junitPatterns.ts` 的 `parseTagExpression` + 面板 `:129`、`:509-511` | 展示面已在；**没落**的是把 tag 变成 runner 参数（见 §6.5） |
| 「缺：测试发现索引」 | **判词过期** | 本仓 `src/testLocator.ts`（`testIndexOf`/`firstTestLocation`，1 基行号口径在同文件注释里钉着）+ 面板 `:274` | 等价物已在 |
| 「缺：到测试动作」 | **判词过期**（不是我的文件） | `src/navGotoTest.ts` + `src/lspNavigation.ts:518-560` + `src/keymapBindings.ts:123-124`（Ctrl+Shift+T，`$default.xml:254-256`） | 「转到测试」已由导航族落地；本轮只核实 |
| 「缺：创建测试动作」 | `[ ]` | 上游 `plugins/junit` 的 `testDiscovery/actions`（`CreateTestAction` 一族） | 具体卡点：入口在 `src/menus/codeMenu.ts`（Generate 弹窗）/`src/menus/editorPopupMenu.ts`，都不是我名下；在测试面板里放一格就是编造位置 ⇒ 见请求 R4「做不到」第 1 条 |
| 「缺：TestNG 专用集成」 | `[ ]` | 参考树里 `plugins/testng` 确实在；本仓 `src/assertionView.ts` 只覆盖了 TestNG 的**断言文本形状** | 仍缺配置类型 + 运行器协议；与 JAR 同属「新增运行配置类型」那条链（请求 R1 之后才有落点） |
| 「缺：变更列表受影响测试 / 注解引用导航」 | `[ ]` | 上游 `TestsByChanges`/`AffectedTestsInChangeListPainter`、`BaseJunitAnnotationReference` 一族 | 前者要 VCS 变更列表数据 + 生产侧消费者（不在我面），后者要 PSI/索引 ⇒ 都超出本轮文件面 |

## 2. 改动文件清单（`wc -l` 前 → 后）

| 文件 | 前 | 后 | 内容 |
|---|---:|---:|---|
| `src/testTree.ts` | 486 | 647 | 节点两个时间戳字段（`:47-59`）、`TestTreeBuilder` 的戳表 + 可注入时钟 + 盖戳（`:75-107`、`:129-176`、`:203`、`:230`、`:288-289`（reset 清戳））、`testNodeDurationMs`（`:464-478`）、null 安全比较（`:479-486`）、比较器改比 customized duration（`:502-511`）、呈现层文案常量与两个函数（`:599-647`）、对照注释与差异登记（`:362-401`、`:572-595`） |
| `src/components/TestRunnerPanel.vue` | 596 | 608 | import 两个新函数（`:9-13`）、`renderNow` + `durationOf` + `durationHint`（`:237-244`）、行右侧那一格改用它并挂 tooltip（`:547`）、待跑行补两个新字段（`:557`）、说明注释（`:237-239`、`:542-546`） |
| `tests/test-tree-view.test.mjs` | 250 | 347 | +5 条判据（盖戳与不覆盖、隐式层级无戳、运行中整秒、Overall/Sum 四道门、排序比 wall time）；`suite`/`leaf` 两个构造补两个字段；面板接线那条**换锚点**（见下） |
| `tests/run-config-types.test.mjs` | 126 | 151 | +1 条「第五处：宿主 `settings_schema.cpp` 白名单与 schema 清单同源」+ 头注释改成「五份副本」 |
| `docs/batch-2026-10-06-runcfg2.md` | 不存在 | 170 | 交付报告（本文件） |
| `docs/wiring-requests-2026-10-06-runcfg2.md` | 不存在 | 175 | R1 JAR 五处 / R2 开关持久化 / R3 键位偏差 / R4 六族判词回写 |

**既有断言的处置（规约 §3 要求留痕的那一类）**：
- `tests/test-tree-view.test.mjs` 里「面板真的挂了这五个动作」那条原来含 `assert.match(panel, /testDurationText\(/)`。
  **原写 `testDurationText`、实际面板现在调 `testNodeDurationText`**（格式化函数下沉到模块里被它调用，
  面板不再直接用）⇒ 锚点换成 `/testNodeDurationText\(/`，并**另加** `/testNodeDurationTooltip\(/` 与
  `:title="durationHint(node)"` 两条（`:237-244` 处），断言只增不减；
  模块侧 `testDurationText` 的**值判据**（`123456 → "2 min 3 sec"` 那 7 条）一字未动。
- 没有放松任何 `deepEqual`/`match`/数字下限；`DEFAULT_TEST_TREE_SORT`、互斥、三种排序、置顶、时长格式、开关文案
  六组既有判据全部原样复跑通过。

## 3. §5 每条自查命令的前后数字

| 命令 | 前（本轮开工时实测） | 后（收工实测） |
|---|---|---|
| `npx vue-tsc -b --force` | **0 错**（派单说的 `TestRunnerPanel.vue(238,59)` TS7053 起手就不在） | **0 错**（中途一次实跑 9 条，全在他人名下：`src/App.vue` 2、`src/bookmarkActions.ts` 1、`src/editorFoldingController.ts` 3、`src/toolWindowManager.ts` 1、`src/toolWindowStripes.ts` 2 —— 12 路并行的在途红，收工时那些代理已各自清掉；本轮我名下唯一一条 TS2322 已修） |
| `node --test tests/junit-*.test.mjs tests/run-config*.test.mjs tests/build-*.test.mjs tests/test-*.test.mjs` | 145 项 / 145 通过 / 0 红 | **151 项 / 151 通过 / 0 红**（+6：5 条树时长 + 1 条第五处门） |
| `node --test tests/module-size.test.mjs` | 5 项 / 5 通过 | **5 项 / 5 通过**（上限未动；`src/testTree.ts` 647、面板 608，都在 ts/vue 900 之下） |
| `node .tools/find-param-props.mjs` | 0 处 | **0 处**（中途踩到一次：我先把时钟写成构造参数属性，`node --test` 直接 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` 整文件加载失败 ⇒ 改成显式字段 + 赋值，复绿。这正是那条门拦的东西） |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净** |
| `node .tools/find-missing-ext.mjs` | 扫描 1275 文件 / 干净 | **扫描 1275 文件 / 干净** |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记 9 / 基线 9 / 新增 0 | **已登记 9 / 基线 9 / 新增 0 · 本轮清掉 0 ⇒ 门禁绿**（本轮没有新建 `src/` 模块） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 项 / 11 通过 / 0 红 | **11 项 / 9 通过 / 2 红 ⇒ 两条红都不是本批**：失败清单（复跑两次，条目随并行代理在途增减）里的引用全部来自他人名下文档（先后出现过 `batch-2026-10-06-problems2.md`、`-projecttree.md`、`-status2.md`、`-welcome2.md`、`wiring-requests-2026-10-06-toolwindow2.md`、`-vcs2.md`，都是「参考树里没有这个文件」），**没有一条来自 `runcfg2`**；本批两份文档 + 四处代码的每一条带路径引用都用脚本按门控同一口径复算过（路径在参考树存在 + `to ≤ split('\n').length`），零命中。上一批报告 §3 记的同类他人在途红（terminal/ListPopupStep）本轮已不在清单里 |
| `npm run test:native` / ctest | 未跑 | **不适用（具体理由）**：本轮没有改 `native/` 任何文件，只**读**了 `native/settings_schema.cpp:1011-1012` 并把它作为第五处副本纳入 TS 侧文本判据 |

## 4. 反向验证记录（新门必须红一次）

| # | 注入的违规 | 结果 | 撤掉后 |
|---|---|---|---|
| 1 | `src/runConfigurationSchema.ts:14` 的 `RUN_CONFIG_TYPE_IDS` 加一个假 id `'jar'`（模拟「五处只改一处」） | `tests/run-config-types.test.mjs` **3 条红**：「四份类型清单必须同步」、「编辑器表：每种类型一套字段」、**本轮新增的「第五处：宿主 settings_schema.cpp 同源」** ⇒ 同一组两文件合计 27/30 通过、3 红 | 从备份还原后 **30/30 绿** |
| 2 | `src/testTree.ts` 的 `openNode` 去掉 `if (!this.starts.has(id))`（模拟「开始戳每次被后来的事件挪走」） | `tests/test-tree-view.test.mjs` **1 条红**（「事件到达即盖开始/结束时间戳，且已有的不覆盖」）；21 项 / 20 通过 | 还原后 **21/21 绿** |
| 3 | 同时注三处：wall time 分支短路（`if (false && …)`）、tooltip 不再要求非叶子、运行中不足 1 秒也画 | **2 条红**（盖戳那条 + 运行中整秒那条）；21 项 / 19 通过 | 还原后 **21/21 绿** |
| 4 | 单独把 tooltip 的 `!node.children.length` 门去掉（模拟「叶子也给 Overall/Sum」） | **1 条红**（「Overall/Sum 两行只在非叶子…」—— 该用例把「有戳但没有孩子」的节点摆出来，只有这一道门能拦）；21 项 / 20 通过 | 还原后 **21/21 绿** |
| 5 | 把 `testNodeDurationMs` 退回「suite 也用 `durationMs`」（模拟上一批的排序形状） | **1 条红**（「耗时排序比的是 customized duration」，`actual: ['Sum','Wall']` vs `expected: ['Wall','Sum']`）；21 项 / 20 通过 | 还原后 **21/21 绿**；全量域测试 **151/151 绿** |

四次注入合计 5 组、拦下 8 条红；全部撤掉后复跑同一组：**全绿**。没有一次靠放宽断言过关。
（过程中发现自己写的第 3 组里「非叶子」那道门其实**拦不住**——原用例的节点没有时间戳，先补强用例再重跑才拿到红，这条也如实登记。）

## 5. 零消费方自查

本轮新增的每个导出都有**生产**消费方（不是只被测试读）：

| 新导出 | 生产消费方 |
|---|---|
| `TestTreeNode.startTimeMillis` / `endTimeMillis` | `src/testTree.ts:502-511`（排序）、`:610-635`（呈现）、`:637-647`（tooltip）+ 面板 `:547` |
| `testNodeDurationText` | `src/components/TestRunnerPanel.vue:242`（`durationOf`）→ 模板 `:547` 每行渲染 |
| `testNodeDurationTooltip` | 同上 `:244`（`durationHint`）→ 模板 `:547` 的 `:title` |
| `testNodeDurationMs` | 同模块的比较器 `:509`（生产路径：面板每次重算 `sortedTree` 都会走） |
| `OVERALL_TIME_MESSAGE` / `SUM_TIME_MESSAGE` | `src/testTree.ts:644-646` 拼 tooltip 正文；文案本身由 `tests/test-tree-view.test.mjs:317` 的 deepEqual 钉住 |

`node .tools/find-orphan-modules.mjs --gate`：**已登记 9 / 基线 9 / 新增 0 · 本轮清掉 0**（没有新建 `src/` 模块；
`src/jarRun.ts` 仍在已登记孤儿里，等请求 R1 落地才能清，本轮不动它）。
本轮**没有**新增只过自己测试的死逻辑：`SMTestProxy.java:603-604` 那条「用时长反推 suite 开始时间」的分支我实现到一半
发现本仓**没有可达入口**（只有 `suiteFinished`、没有 `suiteStarted` 时那一层根本定位不到路径），于是**删掉实现、
在 `src/testTree.ts:153-156` 写清为什么接不上**，并登记在 §6.3。

## 6. 做不到 / 无法核实

1. **`USE_WALL_TIME` 关掉那一档没落**（`JavaSMTRunnerTestTreeView.java:60-61` + `:88-110` 的「取第一个孩子的开始」、
   `JavaAwareTestConsoleProperties.java:185` 的回落）：上游那个开关动作整组被 `Registry.is("java.test.enable.tree.live.time")`
   挡着（`JavaAwareTestConsoleProperties.java:199-208`，实测 `:202`）⇒ **默认不给用户这一格**，而属性默认是 `true`（`:55`）。
   本仓按默认档实现，不画一个上游默认隐藏的开关（铁律「不放假控件」）。若主代理认为该开这一格，需要给一个真消费者。
2. **运行中时长的「补零」档没落**（`SMTestProxy.java:531-533` 的 `getDurationPaddedString` → `:552-555`，
   格式化在 `platform/ide-core-impl/src/com/intellij/ide/nls/NlsMessages.java:215-237`、`:246-248`，
   单位名 `platform/ide-core/resources/messages/IdeCoreBundle.properties:175-183` 的 `.narrow` 档）：
   那是**通用**渲染器（`platform/smRunner/src/com/intellij/execution/testframework/sm/runner/ui/TestTreeRenderer.java:102-104`）的画法，
   本面板对齐的是 **Java** 渲染器（`JavaSMTRunnerTestTreeView.java:52-86` 覆盖同一个 `getDurationText`，`:69-73` 走整秒 + narrow）。
   两种画法在上游就是分岔的，本仓取 Java 那一种 ⇒ `formatDurationPadded` 在本仓没有真消费者，不搬。
3. **`SMTestProxy.java:603-604` 的「suite 有时长没时间戳 ⇒ 用时长反推开始」不可达**（原因见 §5），已在
   `src/testTree.ts:153-156` 留痕；上游这一支要的是「finish 事件到达时那一层已存在但没报过 start」，本仓的 suite 节点
   在只有 `suiteFinished` 时定位不到路径（`apply` 里的 `closed` 取不到）⇒ 不是省略功能，是协议现实。
4. **narrow 档的空格字形**：上游 `NlsMessages.java:193` 把单位内空格换成 U+2009（thin space），本仓用普通空格。
   **没有**改既有断言（`123456 → "2 min 3 sec"`）—— 值与单位名与上游一致，差的是字形；换过去会牵动别的代理在读的判据，收益为零。
5. **tag 过滤只停在提示行**（沿用上一批的结论，本轮复核仍然成立）：面板 `:142` 的 `tagHint` 没变成 runner 参数。
   **无法核实**：本地参考树里 junit 插件不给 Maven surefire / Gradle 的 `-Dgroups=` 参数写法（上游 JUnit 的 tag 过滤走自己的
   运行器参数，不折算成命令行）⇒ 宁可不写（规约 §0「指不到就写无法核实」）。
6. **排序/统计/wall time 开关的持久化**：见请求 R2（要新设置键 + 两个保留文件 + 旧存档补默认）。
7. **JAR / TestNG 运行配置类型**：见请求 R1（五处同改）；TestNG 还要新增运行器输出协议。
8. **创建测试动作 / Build Module / Compile / Build Artifacts / 构建事件模型与多构建视图 / `OpenFileQuickFix`**：
   卡点都是「入口或消费面不在我名下」（`src/menus/codeMenu.ts`、`src/menus/editorPopupMenu.ts`、`src/App.vue`、
   `src/components/RunConsole.vue`），逐条写在 §1.C/§1.D 与请求 R4。
9. **`docs/inventory/verdict-*.md` 没有回写**：族判词由 `scripts/verdict_table.py` 生成、文件头明确写「不要手改」
   ⇒ 本轮的落地点与「判词过期」清单都在请求 R4，请主代理下次生成判词表时并入。

## 7. 需要主代理接的线

全部在 `docs/wiring-requests-2026-10-06-runcfg2.md`：
R1（JAR 五处一起落，含本轮新增的第五处门与「新 id 要加在 C++ 白名单最后」的顺序要求）、
R2（排序/统计/wall time 开关持久化，六个 boolean + 旧存档补默认）、
R3（Rebuild 键位偏差，两处一起动才有意义；本轮保持现状）、
R4（六族判词回写：5 条本轮新补、8 条「其实早就做了」的过期句子、3 条新增的「做不到」卡点）。
