# 批 2026-10-06 · 桶 11c（JUnit 树与统计 / 运行配置 schema·校验 / 构建动作）

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（未上网检索，行号都是本轮自己开文件数出来的）。

> **派单坐标订正（留痕）**：派单写「`docs/inventory/verdict-settings-run.md` 的 `exec/junit`、`exec/testframework`、
> `exec/run-configs`、`exec/configurations-types`、`exec/actions`、`lp/build` 各族」。实际：
> **`verdict-settings-run.md` 里没有这些族名**（它是 B11 的 3247 类逐条表，按「类」不按「族」）。
> 这六个族的**族级判词**在
> `docs/inventory/verdict-execution.md:38/40/42/55/41`（`exec/testframework`、`exec/junit`、`exec/configurations-types`、
> `exec/run-configs`、`exec/actions`，机检数据在 `docs/inventory/execution_verdict_table.json` 的 `families`）与
> `docs/inventory/platform_rest_verdict_table.json:255`（`lp/build`，人类面在 `docs/inventory/verdict-platform_rest.md`）。
> 本轮按这两处的族判词逐条重读上下游后落实现，未照抄判词文本。

## 1. 判词表

档位：`[x]` 已做 · `[~]` 部分（写「本仓已有」+「还差」）· `[ ]` 未做 · `[-]` 不适用（附具体理由）

### A. `exec/testframework` —— JUnit/测试树与统计（本轮新增的两块）

| 项 | 判定 | 上游 `路径:行号` | 本仓落点 `文件:行号` | 一句话 |
|---|---|---|---|---|
| 树排序开关的**默认值** | `[x]` | `platform/testRunner/src/com/intellij/execution/testframework/TestConsoleProperties.java:45-48`、`:57` | `src/testTree.ts:356-361`（`DEFAULT_TEST_TREE_SORT`） | 三个排序默认 false、`suitesAlwaysOnTop` 默认 true、`showInlineStatistics` 默认 true，逐个照抄 |
| **按字母排序** | `[x]` | `platform/editor-ui-api/src/com/intellij/ide/util/treeView/AlphaComparator.java:22-33`（同权重走 `FileNameComparator`，`:33`） | `src/testTree.ts:406-410`（`compareTestNodesAlphabetically`）+ `src/components/TestRunnerPanel.vue:462-464` | 先忽略大小写、再按原名；判据 `tests/test-tree-view.test.mjs:207-212` |
| **按耗时排序** | `[x]` | `TestFrameworkRunningModel.java:44`（`SORT_BY_DURATION && !isRunning()`）、`:52`（`Comparing.compare(t2,t1)` = 降序）；`platform/smRunner/src/com/intellij/execution/testframework/sm/runner/ui/SMTestRunnerResultsForm.java:310-312`（跑完那一刻才挂比较器） | `src/testTree.ts:415-427`、`448-460` + 面板 `:236`（把 `running` 传进去） | 还在跑时**不排**，与上游同一前提；判据 `:191-196` |
| **按声明顺序排序** | `[~]` | `TestFrameworkRunningModel.java:58-71`（取 PSI `textOffset`，`:69-70` 是「拿不到位置排最后」） | `src/testTree.ts:429-439` + 面板 `:465-467` | 本仓没有 PSI/索引 ⇒ 用 `TestTreeNode.location` 的 `path:line` 当等价判据（同文件按行号、跨文件先按路径）；「拿不到位置排最后」这条与上游一致 |
| **Suites Always on Top** | `[x]` | `TestConsoleProperties.java:48`；门在 `TestFrameworkRunningModel.java:51`/`:65`；文案 `platform/execution/resources/messages/ExecutionBundle.properties:151-152` | `src/testTree.ts:400-404` + 面板 `:468-470` | 上游靠「混排不比较 + 建模顺序 suite 天然在前」；本仓 children 是按事件到达追加的 ⇒ 把同一可见结果写成显式判据（差异已在 `src/testTree.ts:338-341` 留痕） |
| 三个排序键**互斥** | `[x]` | `platform/testRunner/src/com/intellij/execution/testframework/ToolbarPanel.java:84-95`、`:98-110`、`:112-114` + 内部类 `SortByDurationAction`（同类 `:306-334`，`setSelected` 里把另两个 `primSet(false)`） | `src/testTree.ts:379-389`（`withTestTreeSort`）+ 面板 `:243-245`（`chooseSort`） | 打开一个就关另外两个；再点同一个 = 三个全关回到建模顺序 |
| **行内统计（节点右侧耗时）** | `[~]` | `TestConsoleProperties.java:57` + `ToolbarPanel.java:165-167`（gear 组「Test Runner Settings」，`ExecutionBundle.properties:168`）+ `platform/smRunner/src/com/intellij/execution/testframework/sm/runner/ui/TestTreeRenderer.java:79-87` + `SMTestProxy.java:527-553` + `platform/ide-core-impl/src/com/intellij/ide/nls/NlsMessages.java:111`（`formatDurationApproximateNarrow`，**最多两个单位**）、`:32`（`UNIT_KEYS = {ns,mcs,ms,sec,min,hr,day,week}`） | `src/testTree.ts:461-486`（`testDurationText`）+ 面板 `:479-481`（开关）、`:533-535`（每行右侧耗时） | 时长格式与单位名照上游 narrow 档（`123456 → "2 min 3 sec"`）；**还差**：① suite 的 wall time（`java/execution/impl/src/com/intellij/execution/testframework/JavaSMTRunnerTestTreeView.java:75-84` 要 `startTimeMillis/endTimeMillis`，本仓 sm 等价通道只发 `durationMs`）② root 节点 tooltip 的 overall/sum 两行（同文件 `:118-147`）③ 运行中节点的补零时长（`SMTestProxy.java:531-533` 的 `getDurationPaddedString`，要 start 时间戳） |
| 排序/统计开关**随运行配置存盘** | `[-]` | `TestConsoleProperties` 是 `StoringPropertyContainer`（`TestConsoleProperties.java:42` 类声明），上游把开关存进配置属性 | 面板 `:234-235` 是 `ref`，不落盘 | 具体理由：本仓同一面板里既有的 `trackRunning`/`scrollToSource`（`TestConsoleProperties.java:50/53` 那两个开关）也一直是运行时状态、没有落盘；要落就得新建持久化键并过 `native/settings_schema.cpp`（保留文件），本轮不为两个开关去开那条线 |
| 失败导航走**看得见**的树 | `[x]` | `ToolbarPanel.java:114-116`（`FailedTestsNavigator` 挂在同一个展示模型上）+ `:121-131`（expand/collapse/prev/next 都在 `moreGroup` 里） | `src/components/TestRunnerPanel.vue:272-290`（`stepFailure`/`ancestorsOf` 从 `tree.value` 改走 `shownTree.value`） | 排过序、滤过的模型才是用户看到的那棵树，「第 N 个失败」的序号与滚动定位跟着它数 |

### B. `exec/run-configs` + `exec/configurations-types` —— schema / 继承 / 校验

| 项 | 判定 | 上游 `路径:行号` | 本仓落点 `文件:行号` | 一句话 |
|---|---|---|---|---|
| 类型清单**四处副本收敛** | `[x]` | `platform/execution-impl/src/com/intellij/execution/impl/RunManagerImpl.kt:178`（`idToType` —— 类型按 id 集中在一个注册表里，不是各处抄一份） | `src/runConfigurationSchema.ts:14`（`RUN_CONFIG_TYPE_IDS`）← `:28` 用它校验；`src/runConfigTree.ts:19-27`（`RUN_CONFIG_TYPE_LABELS` + 由 id 清单长出 `RUN_CONFIG_TYPES`） | 之前 schema 里硬编码着**第二份** `'shell'\|'application'\|'debug'\|'compound'` ⇒ 往模型联合加类型会「建得出、存不下去」；现在左树的 id 只有一个来源，且 `Record<NonNullable<RunConfig['type']>, string>` 穷尽 ⇒ 加类型必须同时补中文名 |
| 四份清单**漂移门** | `[x]` | 同上（本仓形状：把「必须同改」变成可跑的红测试） | `tests/run-config-types.test.mjs:38-48`（模型联合 ↔ schema 清单 ↔ 左树 ↔ `RUN_CONFIG_EDITORS` 四方 deepEqual） | W-B11c-3 落地时少改任何一处，这条判据先红（本轮反向验证过：注入假 id `zzz` → 2 条红） |
| `normalizeRunConfigurations` 逐字段校验 | `[x]`（既有，本轮只换 id 来源） | `platform/execution/src/com/intellij/execution/configurations/RunConfiguration.java:156-167`（校验要能实时算） | `src/runConfigurationSchema.ts:20-40` | 键白名单/长度上限/复合配置环检测都是既有的，本轮没动判据 |
| `checkRunConfiguration` 的**判据** | `[x]` | 同上 `:156-167`；`platform/execution-impl/src/com/intellij/execution/compound/CompoundRunConfiguration.kt:113-123`；`ConfigurationSettingsEditorWrapper.java:71-74` | 新增 `tests/run-config-types.test.mjs:90-126`（校验 10 条断言：空名、文件夹非法、命令/程序都空、复合无成员、成员不存在、环、env、beforeLaunch、正常为 null；目标只有 warning 2 条；类型标签退回 3 条） | **假引用订正**：`src/runConfigEditors.ts:33` 一直写着「判据 tests/run-config-types.test.mjs」，而该文件此前**不存在**（本轮之前 `ls tests/run-config*` 只有 templates/tree/schema 三份）。本轮按模块头声明的形状把它补成真文件，断言体全部由上游坐标反推，没有放松任何既有断言 |
| 逐类型编辑器（per-type `SettingsEditor`） | `[~]` | `platform/execution-impl/src/com/intellij/execution/impl/ConfigurationSettingsEditor.java:79-87`（页签集合由类型决定） | `src/runConfigEditors.ts:90-108` + `src/components/RunConfigurationsDialog.vue:268-269` | 本仓已有：每类型一张字段表 + 「有值但不属于本类型的字段仍露出来」；**还差**：每种类型一个真编辑器类带来的独立页签（存储/JRE/覆盖率页）与 per-type 校验器 |
| 配置**继承**（模板→新配置） | `[~]`（既有） | `RunManagerImpl.kt` 的 `getConfigurationTemplate` 一族 | `src/runConfigTemplates.ts:108-122`（`applyTemplate`）+ 对话框的类型节点模板编辑器 | 本轮复核：模板字段整体覆盖 + 唯一名 + `allowRunningInParallel`/`target` 都已有落点；**还差**上游 `RunConfigurationStorageUi` 的「存成项目文件」（本仓由设计禁止写用户项目目录） |
| JAR 运行配置类型（`'jar'`） | `[ ]` → **交请求** | `java/execution/impl/src/com/intellij/execution/jar/JarApplicationConfigurationType.java:19-28`、`JarApplicationConfiguration.java:49` | 表已在：`src/jarRun.ts:50/52/103`（类型 id / 标签 / `JAR_FORM_FIELDS`）、`jarRunArgs` `:180-191` | **本轮仍不落**，因为要**五处同改**（其中 2 处是保留文件），只改我名下的会当场编译不过/存不下去 ⇒ 整段可照抄的替换代码在 `docs/wiring-requests-2026-10-06-runcfg.md` W-Runcfg-2 |
| 原生 `runConfigs` 的 type 白名单 | `[ ]`（同上请求） | —— | `native/settings_schema.cpp:1011-1012`（`type != "shell" && … && type != "compound"` ⇒ `fail`） | 原请求（W-B11c-3）只点了三张表，**实际还有这一处**：前端四表全改了、宿主仍会 `INVALID_SETTINGS` 拒存档。本轮把它补进请求（保留文件，只登记不擅改） |

### C. `exec/actions` + `lp/build` —— 构建动作

| 项 | 判定 | 上游 `路径:行号` | 本仓落点 `文件:行号` | 一句话 |
|---|---|---|---|---|
| Build Project（`CompileDirty`） | `[x]` | `java/java-backend/resources/META-INF/JavaActions.xml:71-73`；文案/描述 `platform/platform-resources-en/src/messages/ActionsBundle.properties:925-926`；键位 `platform/platform-resources/src/keymaps/$default.xml:303-305`（Ctrl+F9） | `src/menus/buildMenu.ts:21-25` + `:46` | 已有，标题/可用性（桌面 + 有工作区 + 没在跑）与「构建即跑一条命令行」的形状一致 |
| Rebuild Project（`CompileProject`） | `[~]` | `JavaActions.xml:78`；文案 `ActionsBundle.properties:923-924`；**上游 `$default.xml` 里 `CompileProject` 没有默认快捷键**（grep `action id="CompileProject"` 在 keymaps 目录 0 命中） | `src/menus/buildMenu.ts:26-30` + `:47`；实际键在 `src/keymap.ts:267-268`（只读） | 本仓把「重新构建项目」绑在 Ctrl+Shift+F9 上 —— 上游那一格是 `Compile`（`$default.xml:428-430`，「Force recompilation for the selected module, file, or package」`ActionsBundle.properties:931-933`）。**菜单里显示的 keys 与真实绑定一致，不是假文案**；要照上游改绑就得同时改 `src/keymap.ts`（保留文件）并给「重新构建」另找位置，且本仓没有单文件增量编译可填 `Compile` 那格 ⇒ 登记为**已留痕偏差**，本轮不改 |
| Build Module（`MakeModule`） | `[ ]` | `JavaActions.xml:74` + `ActionsBundle.properties:929-930` | —— | 本仓运行配置没有模块概念（`src/jarRun.ts:40-42` 为同一原因不画「模块 classpath」那格）⇒ 画了就是假控件 |
| Compile / CompileFile（所选文件强制重编） | `[ ]` | `JavaActions.xml:75-76` | —— | 本仓构建是「按项目类型折算一条命令行」（`src/projectBuild.ts`）+ `native/gradle.cpp`，没有增量/单文件编译通道可接 |
| Build Artifacts… | `[ ]` | `JavaActions.xml:80` + `ActionsBundle.properties:927-928` | —— | 没有 artifact 模型（`.idea/artifacts` 不在本仓范围内） |
| 空组不渲染（`NonEmptyActionGroup`） | `[-]` | `platform/execution-impl/resources/intellij.platform.execution.impl.actions.xml:76` | `src/menus/buildMenu.ts:43-52` 恒有 4 行 | 具体理由：上游那条 override 是给「插件缺失时 Build 菜单变空」用的；本仓 Build 菜单四行都有真处理器，永远不会空 ⇒ 没有可观测行为差 |
| 停止构建 / 构建结果窗口 | `[x]`（既有） | 停止 = `StopBackgroundProcesses`（`platform/platform-impl/resources/idea/ExecutionActions.xml:101`） | `src/menus/buildMenu.ts:31-40` | 已有，不在本轮改动内 |
| 构建事件模型与嵌套进度树（`BuildEventDispatcher`/`BuildProgress`/`BuildRootProgressImpl`/`MultipleBuildsView`/`BuildTreeConsoleView`） | `[ ]` | `lp/build` 族（`docs/inventory/platform_rest_verdict_table.json:255` 逐名列）；类清单见 `platform_rest_verdict_table.md:7525-7534` | —— | 具体卡点：本仓构建输出是**一条命令行输出流**（`run.start` → `runOutput` 数组），要造事件对象就得同时给它一个展示消费者（构建控制台/多视图在 `src/App.vue` 与 `src/components/RunConsole.vue`，都**不是**我名下文件）⇒ 只加模块就是零生产消费方死模块，本轮按规约不做 |
| 编译器输出解析族 | `[x]`（既有） | `platform/lang-impl/src/com/intellij/build/output/JavacOutputParser.java`、`KotlincOutputParser.kt:22-23/52-63/88-110`、`GroovycOutputParser.java:24-25` | `src/buildOutput.ts:1-12`（对照注释）、`:31-36`（三个模式）、`:62-100` | MSVC/GCC/Clang/javac/CMake + kotlinc/groovyc 都有；`BuildOutputParserDispatcher`（`platform/lang-api/src/com/intellij/build/output/BuildOutputParserDispatcher.kt`，EP 注册表）本仓由 `parseAnyIssue` 串链代替 ⇒ 该 EP 形状判 `[~]` |
| `OpenFileQuickFix`（issue 上的快速修复） | `[ ]` | `lp/build` 族（`docs/inventory/platform_rest_verdict_table.json:255` 判词点名） | `src/gotoNextError.ts`/`src/runIssues.ts` 只跳行 | 修复动作要写回文件/触发重编，链路在他人名下文件 ⇒ 本轮不动 |

### D. 桶 11c 既有欠账（复核）

| 项 | 判定 | 说明 |
|---|---|---|
| **W-B11c-1**（测试树跳转最后一段） | `[x]` **已接上** | `src/App.vue:2212` 的 `<TestRunnerPanel …>` 现在带着 `@jump="target => revealLocation({ path: target.path, line: Math.max(0, target.line - 1) })"`（原请求写的是「第 2254 行」，实际现在在 :2212 —— App.vue 被 appvue 代理改过多次，行号漂了；文本与请求逐字一致）。模块侧发射点两处也复核过：`src/components/TestRunnerPanel.vue:36`（emit 声明）、`:293`（双击树节点/结果行）、`:427`（运行中跟随）。 ⇒ 本轮**没有**再改模块侧，只在 `docs/wiring-requests-2026-10-06-runcfg.md` W-Runcfg-1 记复核结论 |
| **W-B11c-2**（`ToolWindowView.vue` 陈旧 import） | `[x]` **已清** | `grep -n TestRunnerPanel src/components/ToolWindowView.vue` 现在 0 命中，`node .tools/find-orphan-modules.mjs --dead-imports` 也不再报这条 ⇒ 已有人处理，本轮不再登记 |

## 2. 改动文件清单（`wc -l` 前 → 后）

| 文件 | 前 | 后 | 内容 |
|---|---:|---:|---|
| `src/testTree.ts` | 306 | 486 | +排序/统计一整节（`:308-347` 对照注释、`:349-389` 开关与互斥、`:391-460` 比较器与 `sortTestTree`、`:461-486` `testDurationText`） |
| `src/components/TestRunnerPanel.vue` | 558 | 596 | `:3-4/9-14` 图标与符号 import、`:31-32` 面板头说明、`:231-245` 排序状态 + `sortedTree` + `chooseSort`、`:272-290` 失败导航改走 `shownTree`、`:462-481` 五个新开关、`:533-535` 行内耗时 |
| `src/runConfigurationSchema.ts` | 53 | 66 | `:1-14` 新增 `RUN_CONFIG_TYPE_IDS`（含为什么放这里的说明）、`:28` 用它替换硬编码清单 |
| `src/runConfigTree.ts` | 178 | 184 | `:12-27` `RUN_CONFIG_TYPE_LABELS`（穷尽 Record）+ `RUN_CONFIG_TYPES` 改由 id 清单 map 出来 |
| `tests/test-tree-view.test.mjs` | 137 | 250 | +9 条判据（默认值、互斥、三种排序各一条、递归、时长格式、接线、套件置顶） |
| `tests/run-config-types.test.mjs` | 不存在 | 126 | 新建：漂移门 + 逐类型校验 8 条 + 编辑器表 4 条 + 字段并集 2 条 |

未改动但我读过并据其下判的文件：`src/jarRun.ts`、`src/settingsModel.ts`、`src/menus/toolsMenu.ts`、`src/buildOutput.ts`、`src/autoTest.ts`、`src/testRunner.ts`、`src/testEventChannel.ts`、`src/testResultFilter.ts`、`src/runConfigTemplates.ts`、`src/runConfigEditors.ts`、`native/settings_schema.cpp`、`src/keymap.ts`、`src/App.vue`（全部只读）。

## 3. §5 自查命令的前后数字

| 命令 | 前（本轮开工时） | 后（收工） |
|---|---|---|
| `node --test tests/junit-*.test.mjs tests/run-config*.test.mjs tests/build-*.test.mjs tests/test-*.test.mjs tests/module-size.test.mjs` | 150 项 / 131 通过 / **2 红**（`module-size` 两条，都是他人在途：`SearchPanel.vue` 902 行未登记、`native/git.cpp` 954 > 938） | **150 项 / 150 通过 / 0 红**（本轮新增 17 条：9 条树排序/统计 + 8 条 run-config-types；两条他人在途红在此期间由本人清了） |
| `npx vue-tsc -b --force` | 3 条（`SearchPanel.vue` 235/369 两处 `regexMode`/`replaceGuard`，他人在途基线） | **0 错** |
| `node .tools/find-param-props.mjs` | 0 处 | **0 处** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净** |
| `node .tools/find-missing-ext.mjs` | 1242 文件干净 | **1256 文件干净**（+14 是并行代理新增的） |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记 9 / 基线 9 / **新增 1**（`src/structuralCodeBlock.ts`，搜索代理在途） | 已登记 9 / 基线 9 / **新增 0** ⇒ 门禁绿 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 项全绿 | 11 项 / 9 通过 / **2 红**：两条都是「`platform/plugins/terminal/…/terminal.xml` 与 `platform/platform-impl/src/com/intellij/ui/popup/ListPopupStep.java` 在参考树里没有这个文件」，最早由 `docs/wiring-requests-2026-10-06-toolwindow.md`（并行代理本轮期间新建，开工时 `ls docs/wiring-requests*` 里还没有它）引入，现已扩散到 `docs/batch-2026-10-06-roots.md` ⇒ **他人在途的假路径**。本批**没有新造任何上游路径**（每条都自己开过文件），且已在 §3 下方把这两个假写法**去行号、去目录**转述（引用门把「完整路径:行号」当成真引用收集，留着这行原文会让本文件自己也变红）。我自己新增的每一条带路径引用都用脚本核过（路径存在 + 行号不越界） |

## 4. 反向验证记录（新门必须红一次）

**注入 1 —— 漂移门**：把 `src/runConfigurationSchema.ts:14` 的 `RUN_CONFIG_TYPE_IDS` 临时加一个假 id `'zzz'`（模拟「清单加了、模型联合/编辑器表没跟上」）。
结果：`tests/run-config-types.test.mjs` 第 1 条（四份清单同步）与第 4 条（编辑器表覆盖每个类型）**2 条红**。
**注入 2 —— 互斥门**：把 `src/testTree.ts` 的 `withTestTreeSort` 里 `sortAlphabetically: key === 'alphabetically'` 改成 `options.sortAlphabetically`（模拟「开关不互斥」）。
结果：`tests/test-tree-view.test.mjs` 第 18 条（三个排序键互斥）**1 条红**。
两次注入合计：**25 项 / 22 通过 / 3 红**；撤掉注入（用备份还原两个文件）后复跑同一组：**25 项 / 25 通过 / 0 红**。三处判据都真的拦得住，且没有靠放宽断言过关。

## 5. 零消费方自查

本轮新增的导出逐个都有生产消费方（不只是测试）：

| 新导出 | 生产消费方 |
|---|---|
| `sortTestTree`、`withTestTreeSort`、`DEFAULT_TEST_TREE_SORT`、`TestTreeSortOptions`、`TestTreeSortKey`、`testTreeComparator` | `src/components/TestRunnerPanel.vue:9-14` import，`:234-245` 用 |
| `testDurationText` | 同上，模板 `:533-535` 每行渲染 |
| `SORT_*_NAME`/`SUITES_ALWAYS_ON_TOP_NAME`/`SHOW_INLINE_STATISTICS_NAME` 及各自 `_DESCRIPTION` | 面板 `:462-481` 的 `title`/`aria-label`（tooltip 文案唯一来源） |
| `RUN_CONFIG_TYPE_IDS` | `src/runConfigurationSchema.ts:28`（自身校验）+ `src/runConfigTree.ts:12/27`（左树 id 来源）+ `tests/run-config-types.test.mjs` |

`node .tools/find-orphan-modules.mjs --gate`：**已登记 9 / 基线 9 / 新增 0**（没有只过自己测试的死模块；本轮也没有新建 `src/` 模块）。

## 6. 做不到 / 无法核实

1. **JAR 类型（`'jar'`）本轮仍不落**：要五处同改，其中 `src/settingsModel.ts` 与 `native/settings_schema.cpp` 是保留文件；只改我名下三处会让 `RUN_CONFIG_EDITORS`/`RUN_CONFIG_TYPE_LABELS` 这两张 `Record<NonNullable<RunConfig['type']>, …>` 少键（TS2741）或让宿主 `INVALID_SETTINGS` 拒存档。⇒ 整段替换代码在 W-Runcfg-2。
2. **上游 `CompileProject` 的默认键位**：`grep 'action id="CompileProject"' platform/platform-resources/src/keymaps/*.xml` 在 `$default.xml` 里 0 命中 ⇒ 判为「上游没给默认快捷键」，但**没有**逐条排查其它 keymap（Eclipse/NetBeans 等第三方键位表里有同名条目），若主代理要照上游改键位，建议再复核一次。
3. **suite 的 wall time / overall+sum 两行 tooltip / 运行中补零时长**：三条都要 `startTimeMillis`+`endTimeMillis`（`JavaSMTRunnerTestTreeView.java:75-84`、`:118-147`；`SMTestProxy.java:531-533`），本仓 `##taocode[…]` 事件协议（`src/testEventChannel.ts`）目前只发 `durationMs` ⇒ 要改协议与所有适配器（宿主/插件侧），不是本轮文件面。
4. **构建事件模型与多构建视图（`lp/build`）**：消费面（构建控制台、工具窗布局）在 `src/App.vue` / `src/components/RunConsole.vue`，都不在我名下；只造模型就是死模块 ⇒ 判 `[ ]` 并写明卡点（见 §C）。
5. **TestNG 集成**（`exec/junit` 判词点名）：参考树里 `plugins/testng` 确实在，但本仓既没有 TestNG 配置类型也没有它的运行器输出协议 ⇒ 需要与 JAR 同一条「新增运行配置类型」链路，未动。
6. **tag 过滤只停在提示行**：`src/components/TestRunnerPanel.vue:141`（`tagHint`）把 `parseTagExpression` 的结果只显示在「运行范围」那一行，没有落成 surefire/gradle 的 `-Dgroups=` 参数 —— 本轮没做（要先把 `-Dgroups` 的上游/官方形状核出来，本地树里 junit 插件不给 Maven 参数写法，**无法核实** ⇒ 宁可不写）。
7. **排序/统计开关的持久化**：见 §A 的 `[-]` 行；要落就得新增设置键并过 `native/settings_schema.cpp` 的 `known_keys`（保留文件），本轮按「不新开那条线」处理。
8. `docs/inventory/verdict-*.md` 本轮**没有**回写（族判词由 `scripts/verdict_table.py` 生成、文件头明确写「不要手改」）⇒ 上述落地点请主代理在下次生成判词表时并入。
