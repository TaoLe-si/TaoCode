# 批次交付 · 2026-10-06 第三批 · 桶 11（运行配置域）收尾 · 代 `runcfg3`

派单：① 把 `docs/wiring-requests-2026-10-06-runcfg2.md` 的 R1…R4 逐条对当前代码核对；
② JAR 那一族在**模块侧**做完（新建配置表单 / schema 校验 / 持久化 / 执行参数 / 树里显示 五处一致），宿主挂载写请求；
③ 判据要能钉住五处一致（含「schema 拒收未知字段」「JAR 缺入口明确报错而不是静默」），至少一条会失败的边界用例 + 反向验证；
④ 收工实跑记数字。

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（本轮**未上网检索**）。
本轮每条上游坐标都自己开过文件；行号是 `cat -n` 数出来的。

**留痕（先记账）**
1. 派单里写的上游形状「`plugins/java/.../execution/jarApplication/`」**不是真路径**：真路径是
   `java/execution/impl/src/com/intellij/execution/jar/`（顶层没有 `plugins/` 前缀，目录名是 `jar` 不是 `jarApplication`）。
   文件名三条路都搜过：按目录 `find -ipath "*jarApplication*"`、按语义 `JarApplicationConfigurationType`、按 XML 里的 id `JarApplication` 都指得到同一批文件。
2. runcfg2 的 R1 说「五处」= 模型联合 / schema / 左树标签 / 编辑器表 / 宿主白名单。
   本轮派单说的五处 = 表单 / schema 校验 / 持久化 / 执行参数 / 树里显示。**两套都在本文 §2 对齐**：
   前五处里的「模型联合 + 宿主白名单」= 本仓说的「持久化」（落盘能不能过），实际是同一件事的两个面；
   本轮**新多出来**的一处是「执行参数」（`src/jarRun.ts` 的 `jarRunConfigParams`），runcfg2 的 R1 没有点到它
   （它只说了「本仓用现成的 program + args 表达，所以不用改」—— 那句话在**落盘**层面成立，但
   `src/runActions.ts:99` 的 `params.shell = config.type !== 'application'` 会把 jar 配置丢进 shell 通道，见请求 J2）。
3. 工作区是共享的：主代理在 12:09 提交过一次（`1e2f7f7`），把本轮在途的 `src/jarRun.ts` 一起带进了历史，
   所以 `git show HEAD~1:<文件> | wc -l` 对本域**不可靠** ⇒ §3 的「前」用本轮开始时我亲自读到的行数。

---

## 1 R1…R4 逐条复核（已闭环 / 仍缺 / 前提变了）

| 条 | 判定 | 本轮复核到的**当前**代码事实（自己开文件核过） | 结论 |
|---|---|---|---|
| **R1** JAR 类型五处同一次改 | `[~]` **模块侧闭环，宿主两处仍缺** | ① `src/settingsModel.ts:26` 的 `type?: 'shell' \| 'application' \| 'debug' \| 'compound'` **仍没有** `'jar'`（19-25 行那段「故意不加」的注释还在）；② `native/settings_schema.cpp:1011-1012` 的白名单**仍只有四个** id，报错文案也仍是那句四类；③④⑤ 本仓模块侧三处（schema / 左树 / 编辑器表）本轮**已经做完**，但改法不是 R1 建议的「直接加进联合」—— 见 §2 | 仍缺的就是那两处保留文件；**可照抄的替换体在 `docs/wiring-requests-2026-10-06-runcfg3.md` 的 J1**（含摘 gate 那一步与一条必须同步改的既有断言） |
| **R2** 测试树排序/统计/wall time 的持久化 | `[~]` **计算已闭环，持久化仍缺**（前提没变） | `src/components/TestRunnerPanel.vue:235-236` 仍是 `sortOptions = ref({...DEFAULT_TEST_TREE_SORT})` 与 `showInlineStatistics = ref(true)`（运行时状态，刷新回默认）；排序/时长判定已在 `src/testTree.ts:415-420`（默认值）、`:472-477`（`testNodeDurationMs`：suite 取 `end-start`，缺一个时间戳返回 null）、`:572-647`（wall time / 运行中实时时长 / tooltip）。`grep -in "wall" src/components/TestRunnerPanel.vue` **0 命中** ⇒ wall time 现在**连开关都没有**，不是「有开关没存盘」 | **仍缺**，卡点没变：新建持久化键要同时动 `src/settingsModel.ts`（保留）与 `native/settings_schema.cpp` 的 `known_keys`（保留），且规约 §3 要求「旧存档缺键补默认」。请求 J4 里把六个 boolean + 上游默认值坐标给全了 |
| **R3** 「重新构建项目」键位偏差 | `[-]` **不动（判断维持）**，复核过 | `src/menus/buildMenu.ts:47` 仍是 `actionRow('build.rebuild', { keys: 'Ctrl Shift F9' })`；`src/keymap.ts:267-268` 仍是 `Ctrl+F9 → startBuild(false)` / `Ctrl+Shift+F9 → startBuild(true)` ⇒ 菜单 keys 与真实绑定**一致**，不是假文案。上游 `$default.xml` 本轮没重查（runcfg2 已核：`CompileProject` 无默认键） | 前提没变，维持 runcfg2 的结论：本仓没有单文件/模块增量编译通道，`Compile` 那格落不了地，把 `Ctrl+Shift+F9` 空出来只会让「重新构建」失去唯一入口 ⇒ **保持现状** |
| **R4** 六族判词回写 | `[ ]` **仍缺，且前提变了** | `scripts/verdict_table.py`（保留文件）本轮打开核到：`:36` 的 `exec/run-configs` **仍写着**「④ per-type 设置编辑器（`SettingsEditor` 每种类型一套；本仓一张通用表单，类型只是字段）」；`:52` 的 `exec/testframework` **仍写着**「仍缺：失败导航、自动测试、测试结果 XML 导出与历史测试」。R4 点名的那些落点本轮复核**都还在**：`src/testNavigation.ts`、`src/autoTest.ts`、`src/testResultsXml.ts`、`src/testImport.ts`、`src/junitPatterns.ts`、`src/junitParameters.ts`、`src/testLocator.ts`、`src/navGotoTest.ts`（前四个由 `src/components/TestRunnerPanel.vue` 消费，grep 核到）。另：`git status` 显示 `M scripts/verdict_table.py`、`M docs/inventory/*.md`、`M tests/b7-verdict.test.mjs` ⇒ **另一个代理此刻正在改这份表** | **不在我名下**（`scripts/verdict_table.py` 与 `docs/inventory/*.md` 都是保留文件），且**撞车中** ⇒ 本轮不动它。要回写的两条（run-configs ④ 与 testframework 的四条）已写进请求 J5，并补了 R4 没写的一条：`exec/run-configs` ⑤ 里的「JAR 配置类型」本轮已从「完全没有」变成「模块侧完成、宿主两处待接」 |

---

## 2 JAR 那一族：模块侧怎么做完的（不是「五处各改一次」，是「一处事实、五处投影」）

### 2.1 为什么不照 R1 那样「直接加进联合」

R1 的做法要把 `src/settingsModel.ts` 与 `native/settings_schema.cpp` 一起改，两个都是**保留文件** ⇒
本轮落不了；而只改模块侧那三处（schema / 树 / 表单）会当场造出一个**假控件**：表单建得出 JAR 配置、
点保存被宿主整份 `INVALID_SETTINGS` 拒掉（`native/settings_schema.cpp:1011-1012`），连带项目里**别的**设置也存不下去
（规约 §3「没有消费链路的 UI 一律不渲染，宁可那一行不出现」）。

所以本轮的形状是：**家族清单（模块侧全量）− 宿主未接清单（gate）= 已接清单（UI 与校验只认它）**。

`src/runConfigurationSchema.ts` 现在有三份清单，都在同一处：

```
RUN_CONFIG_TYPE_FAMILY_IDS        = ['shell','application','debug','compound','jar']   // 模块侧做完的家族
RUN_CONFIG_TYPE_IDS_HOST_PENDING  = [ 'jar' ]                                          // 等宿主两处接线
RUN_CONFIG_TYPE_IDS               = 家族 − pending                                     // 今天真能存下去
```

**摘掉 pending 里那一项 = 五处一起开**（表单、schema、持久化、执行参数、树里显示），
不需要再碰我域里任何其它文件；宿主两处（J1）接完但忘了摘 gate，会被
`tests/run-config-types.test.mjs` 的「gate 与宿主两处必须同步」那条判据红给你看（§5 反向验证第 1 注）。

### 2.2 五处各自的落点与「钉住它」的机制

| 处 | 本仓落点（文件:行） | 单一事实来源 | 少改一处的后果 |
|---|---|---|---|
| ① 新建配置表单 | `src/runConfigEditors.ts:112-134`（`RUN_CONFIG_TYPE_FAMILY_EDITORS`，含 `jar` 那一条 `:130-133`）；`:87-94` 是 JAR 的两格字段定义，`:143-146` 是投影给 UI 的 `RUN_CONFIG_EDITORS` | 表的键类型是 `Record<RunConfigTypeId, RunConfigEditorDef>` ⇒ **按家族穷尽** | 家族加 id 而这里少一行 ⇒ `vue-tsc` TS2741，直接编译不过 |
| ② schema 校验 | `src/runConfigurationSchema.ts:66-75`（JAR 入口判据排在最前）、`:79-81`（白名单对 pending 放过）、`:94-101`（宿主未接的指名报错） | `src/jarRun.ts:291-305` 的 `jarRunConfigProblem` | 缺 `-jar <路径>` 时报的是「JAR 配置「名字」没有 JAR 路径…」，不是万金油「字段无效」；也不是静默收下 |
| ③ 持久化 | `src/runConfigurationSchema.ts:35-40`（已接清单）+ `src/runConfigurations.ts:161-176`（`persistRunConfigs`，本就与类型无关） | 同上清单；`known_keys` **没有扩**：JAR 折算进现成的 `program`/`args` | 清单里没有的 id 落不了盘；宿主白名单是第五处副本，由既有判据「第五处：宿主 settings_schema.cpp 的 type 白名单与 schema 清单同源」钉 |
| ④ 执行参数 | `src/jarRun.ts:329-343` 的 `jarRunConfigParams`（`program` + `args` + `shell:false`），`:318-320` 的 `isJavaLauncher` 剥启动器；启动前的整组校验走 `src/runConfigTree.ts:156`（`runConfigClosure` → 同一份 `normalizeRunConfigurations`） | 与 bean 版 `jarRun.ts:187-196`（`jarRunArgs`）同一条 argv 顺序：VM 参数 → `-jar` 路径 → 程序参数 | 缺入口/没有 JDK ⇒ **抛错**，不像 `jarRunArgs` 那样返回 `[]` 静默（那条的既有行为由 `tests/jar-run.test.mjs:95` 钉着，本轮没动） |
| ⑤ 树里显示 | `src/runConfigTree.ts:22-33`：`RUN_CONFIG_TYPE_FAMILY_LABELS: Record<RunConfigTypeId, string>`（`:27` 是 jar 那行）→ `RUN_CONFIG_TYPES`（`:32-33`，按已接清单投影）→ `buildRunConfigTree`/`runConfigTypeLabel` 不变 | 标签取 `src/jarRun.ts:52` 的 `JAR_APPLICATION_TYPE_LABEL`（= 上游 bundle 原文） | 家族加 id 而这里少标签 ⇒ TS 编译不过；gate 关着 ⇒ 左树**不列** jar 配置、对话框「添加」菜单里点不到（判据「宿主没接 JAR 时左树不列 jar 配置」） |

顺带被 gate 一起管住的消费方（**本轮没有改它们**，只是确认它们读的就是那份投影）：
`src/components/RunConfigurationsDialog.vue:57/268-269/404/469`（「添加」菜单与「类型」下拉都遍历 `RUN_CONFIG_TYPES`，
字段遍历 `runConfigFieldsFor` ⇒ JAR 接上后**不用改这个组件**）、`src/runDashboard.ts:24/133/161/183/196`（类型开关同源）。

### 2.3 上游坐标（本轮逐条开过，全在 `java/execution/impl/src/com/intellij/execution/jar/`）

| 上游 | 内容 | 本仓落点 |
|---|---|---|
| `JarApplicationConfigurationType.java:19-23` | `super("JarApplication", jar.application.configuration.name, jar.application.configuration.description, AllIcons.FileTypes.Archive)` | `src/jarRun.ts:50-56`（三个常量）+ `:57-63`（本仓前端 id `'jar'` 与上游 id `'JarApplication'` 的关系写清） |
| 同文件 `:26-28` | `createTemplateConfiguration` 返回 **jarPath 空串**的配置 | `src/jarRun.ts:81-91`（既有，本轮没动） |
| 同文件 `:31-33` | `getHelpTopic` = `reference.dialogs.rundebug.JarApplication` | `src/jarRun.ts:56` |
| `JarApplicationConfigurable.java:47-49` | 浏览按钮只收 `.jar`，标题 `choose.jar.file` | `src/jarRun.ts:104`（`JAR_FORM_FIELDS` 的 `browse`） |
| 同文件 `:73` / `:81` | 表单第 0 行 `label.path.to.jar`、第 3 行 `label.search.sources.using.module.classpath` | `src/jarRun.ts:103-111`（模块 classpath 那格仍 `available: false`：本仓运行配置没有模块概念 ⇒ 不画假控件）；报错文案引用「Path to JAR」那一格名 |
| `JarApplicationConfiguration.java:124-133` | `checkConfiguration`：① `checkAlternativeJRE` ② 工作目录 ③ jar 文件（**warning**） | `src/jarRun.ts:139-158`（既有 `jarValidation`，顺序保持）+ `:291-305`（本轮新增的**入口**判据取致命档，理由写在注释里） |
| 同文件 `:69-72` | `isBuildBeforeLaunchAddedByDefault()` = false（JAR 默认不挂 Build） | 本仓「启动前」是**用户自己填**的字段，没有默认步骤 ⇒ `RUN_CONFIG_TYPE_FAMILY_EDITORS.jar` 带 `beforeLaunch` 但不预置步骤（差异如实登记在 `src/runConfigEditors.ts:113-142` 的注释里） |
| 同文件 `:240-248`、`:250-253`、`:270-278` | 新配置把工作目录填成项目 base path；`canRunOn` 要目标带 Java 运行时；bean 七字段（`PASS_PARENT_ENVS` 默认 true） | `src/jarRun.ts:81-91`、`:165-167`、`:59-74`（既有） |
| `JarApplicationCommandLineState.java:18-25` | argv 形状：`createProjectJdk(project, jreHome)` → `configureConfiguration` → `setJarPath` | `src/jarRun.ts:187-196`（bean 版）与 `:329-343`（本仓形状版，`jdkHome` 退化同一条口径） |
| `JarApplicationConfigurationProducer.java:22-41` | 选中 `.jar` 文件 ⇒ 从上下文生成临时配置（名字 = 文件名、jarPath = 文件路径） | **没做** ⇒ 见请求 J3（卡点：`src/runTargets.ts` 的 `RunTargetKind` 与我域外；而且临时配置也要过 `runConfigClosure` 那份 schema，J1 没落地前做了就是「点一下就抛错」） |
| `platform/execution/resources/messages/ExecutionBundle.properties:54-55`、`:58`、`:464`、`:564-565` | description / name=`JAR Application` / 内建页签 `Configuration` / `Choose JAR File` / `Path to &JAR` / 模块 classpath 那格 | `src/jarRun.ts:52-56`、`src/runConfigEditors.ts:130-133`（`tabTitle: '配置'` 沿用既有中文页签） |
| `platform/execution/src/com/intellij/execution/configurations/RunConfiguration.java:156-167` | 三档严重级别（warning / 非致命 error / 致命 error） | `src/runConfigEditors.ts:225-231` 的选择理由注释 |

**与上游的如实差异（不假装一致）**：上游 JAR 有独立的 `jarPath` / `vmParameters` / `programParameters` 三个字段；
本仓把它们折算成 `program`（Java 可执行文件）+ `args`（VM 参数 → `-jar` 路径 → 程序参数）两格，
所以 `RunConfig` 与宿主 `known_keys` 都不新增键。代价是「Path to JAR」在界面上不是独立的一格
（表单字段表用 `JAR 与程序参数` 这个标签 + hint 写明顺序），换来的是不用动保留文件。

---

## 3 改动文件清单（`wc -l` 前后）

「前」= 本轮开始时我亲自读到的行数（工作区被主代理 12:09 提交过一次，git 口径对本域不可靠，见开头留痕 3）。

| 文件 | 前 | 后 | 这次动了什么 |
|---|---|---|---|
| `src/jarRun.ts` | 236 | **349** | 新增本仓形状那一套：`JAR_RUN_CONFIG_TYPE_ID`、`JarRunConfigLike`、`isJarRunConfig`（`:273-276`）、`jarRunConfigPath`（`:284-289`）、`jarRunConfigProblem`、`jarRunConfigParams`、`jarRunConfigWorkingDirectory` + 分区注释（`:244-349`） |
| `src/runConfigurationSchema.ts` | 66 | **127** | 三层清单（家族 / pending / 已接）+ `RunConfigTypeId` + `runConfigTypeIdOf` + `isHostPendingType`；`normalizeRunConfigurations` 里插入 JAR 入口判据（排最前）与宿主未接的指名报错；白名单那一条对 pending 类型放过 |
| `src/runConfigTree.ts` | 184 | **193** | 标签表改按家族穷尽 `RUN_CONFIG_TYPE_FAMILY_LABELS: Record<RunConfigTypeId, string>`（新增导出，jar 那行取 `src/jarRun.ts` 的常量）；`RUN_CONFIG_TYPES` 仍是「按已接清单投影」 |
| `src/runConfigEditors.ts` | 210 | **256** | 字段定义 `JAR_PROGRAM` / `JAR_ARGS`；`RUN_CONFIG_TYPE_FAMILY_EDITORS`（家族穷尽，含 jar 一条）；`RUN_CONFIG_EDITORS` 改成「家族表按已接清单投影」；`RunConfigEditorDef.typeId` 放宽到 `RunConfigTypeId`；`checkRunConfiguration` 加 JAR 入口判据；头注释「只有四种」那段改了（留痕） |
| `src/runInstances.ts` | 869 | **869（未动）** | 按要求先读了现状：全文 `grep "config.type\|'application'\|'shell'"` **0 命中** ⇒ 这一族是实例/行模型，**没有按配置类型分叉的逻辑**，执行参数不在这一层（在 `src/runActions.ts:93-105`，非我名下 ⇒ 请求 J2）。没有另起行模型 |
| `src/runConfigurations.ts` | 223 | **223（未动）** | 草稿态 `runConfigType`（`:91`）与 `persistRunConfigs`（`:161-176`）本来就与类型无关；J1 落地后 `ref<NonNullable<RunConfig['type']>>` 自动容纳 `'jar'`，不需要改 |
| `tests/run-config-types.test.mjs` | 151 | **264** | 新增 4 条判据（家族=已接+pending 不重不漏 / JAR 五处一致 / 缺入口时表单与启动链路都报错 / gate 与宿主两处必须同步）+ 1 条（宿主没接时左树不列 jar）；既有 9 条断言体**一字未动** |
| `tests/jar-run.test.mjs` | 116 | **188** | 新增 6 条（类型判定 / 取 JAR 路径 / 缺入口报错 / 执行参数同形 / 不许静默 / 工作目录）；既有 10 条未动 |
| `tests/run-configuration-schema.test.mjs` | 57 | **81** | 新增 2 条（jar 记录落盘的两条报错路径 / 未知键与复合成员同样拦住） |

`git diff --stat` 自查：本轮只动了上面 9 个文件（`src/jarRun.ts`、`src/runConfigurationSchema.ts`、
`src/runConfigTree.ts`、`src/runConfigEditors.ts` + 3 份测试 + 2 份 docs），没有顺手重排别人的代码。

---

## 4 §5 每条自查命令的前后数字（本轮实跑）

| 命令 | 前（本轮开工时） | 后（收工） |
|---|---|---|
| `node --test tests/run-config-types.test.mjs` | 10 pass / 0 fail | **14 pass / 0 fail** |
| `node --test tests/jar-run.test.mjs` | 10 pass / 0 fail | **16 pass / 0 fail** |
| `node --test tests/run-configuration-schema.test.mjs` | 5 pass / 0 fail | **7 pass / 0 fail** |
| 运行配置域（22 个文件：`tests/run-*.test.mjs` + `tests/jar-run.test.mjs` + `tests/java-run*.test.mjs` + `tests/test-runner.test.mjs`） | 176 pass / 0 fail（同一条命令本轮先跑过） | **194 pass / 0 fail** |
| `npx vue-tsc -b --force` | 0 错 | 本轮改动落地后立刻跑 = **0 错**；收工复跑 = **4 条语法错，全在 `src/lspNavigation.ts:320-321`+`:666`**（`pane: groups[splitModel.focused] as PaneGroup<Tab> | null` —— 别的代理在途，正是规约 §4 说的「一个文件的语法错遮住全仓语义检查」）。`grep` 那份输出里我域文件（`jarRun`/`runConfig*`/`runInstances`）**0 条** |
| `node --test tests/module-size.test.mjs` | 5 pass / 0 fail | 中途 **4 pass / 1 fail** ⇒ 收工复跑 **5 pass / 0 fail（绿）**。中途那条红**不是我域的**：`src/components/CodeEditor.vue 1151 行 > 上限 1147`（`M src/components/CodeEditor.vue`，别的代理在途，随后自己降回去了）。我域内最大 349 行（`src/jarRun.ts`），上限 900 ⇒ 没有新增巨型文件、没有登记豁免、上限一个没动 |
| `node .tools/find-param-props.mjs` | 0 处 | **0 处** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | 中途 **干净**（含我这三份测试）；收工复跑报 1 处：`tests/run-anything-context-dialog.test.mjs:43`（别的代理新建的文件），**我域内 0 处** |
| `node .tools/find-missing-ext.mjs` | 干净 | **干净**（新增的 `.ts` 值 import 都带扩展名：`src/runConfigurationSchema.ts:2`、`src/runConfigTree.ts:13-14`、`src/runConfigEditors.ts:41-42`） |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记孤儿 8 / 基线 8 · 新增 0 · 清掉 0（绿） | 中途 **已登记孤儿 7 / 基线 8 · 新增 0 · 清掉 1（绿）**（清掉的就是 `src/jarRun.ts`，工具自己点名「已接上（可以更新基线）」）；收工复跑 **门禁红：新增 2** = `src/editorColumnMode.ts`、`src/editorSplitLine.ts`（别的代理刚建的文件，非我域）⇒ 基线可由主代理按工具提示更新，我域内**零新增孤儿** |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 pass / 0 fail | **11 pass / 0 fail**（两份交付文档写完后**又跑了一遍** ⇒ 文档里每条上游坐标都指得到真实文件与真实行号） |

---

## 5 反向验证记录（注入违规 → 变红 → 撤掉 → 复绿）

规约 §3 要求新门禁三步都记数字。本轮新门是「gate 与宿主两处必须同步」与「家族清单 = 已接 + pending」。

**注 1 前端先接、宿主没接**（模拟主代理改了 `src/settingsModel.ts` 与 `native/settings_schema.cpp` 之外的一半，
或者有人手滑把 gate 摘早了）：把 `src/runConfigurationSchema.ts:33` 改成
`RUN_CONFIG_TYPE_IDS_HOST_PENDING = []`（jar 直接进已接清单）。
跑 `node --test tests/run-config-types.test.mjs tests/run-configuration-schema.test.mjs tests/run-config-tree.test.mjs`
⇒ **28 tests / 19 pass / 9 fail**，红的九条：`四份类型清单必须同步`、`每一种已声明的类型都能存得下去`、
`类型标签与编辑器一致，未知类型退回原 id`、`第五处：宿主 settings_schema.cpp 的 type 白名单与 schema 清单同源`、
`JAR 那一族五处一致`、`JAR 缺入口时表单实时校验与启动链路都报错`、`宿主没接 JAR 时左树不列 jar 配置`、
`JAR 的 gate 与宿主两处必须同步`、`JAR 记录在宿主接上之前存不下去…`。
**注意红的里面含 4 条既有判据**（不是我新写的）⇒ 既有门确实在守这件事，本轮没有靠放松它们换取绿灯。撤掉注入 ⇒ 复绿。

**注 2 家族清单被悄悄删掉 jar**（「JAR 那一族」整体蒸发）：把 `:30` 的家族改回四条 ⇒
**37 tests / 36 pass / 1 fail**，红的正是新门 `家族清单 = 已接 + 宿主未接，两处不重不漏`
里那句 `assert.ok(family.includes(JAR_RUN_CONFIG_TYPE_ID), 'JAR 必须在家族清单里…')`。
这条就是派单要的「会失败的边界用例」：**宿主那两处接上之后**，谁把 jar 从家族里删掉，这条就红
（旧的「四份清单同步」那时候还是绿的 ⇒ 没有这条就会静默退化）。撤掉注入 ⇒ 复绿。

**注 3 编译期那一半**（表单/树两处）：家族加 id 而 `RUN_CONFIG_TYPE_FAMILY_EDITORS` /
`RUN_CONFIG_TYPE_FAMILY_LABELS` 少一行时，`vue-tsc` 报 TS2741 少键（runcfg2 的 R1 记过实测：
`runConfigEditors.ts:90` TS2741）。本轮改的是 `RunConfigTypeId` 键类型 ⇒ 穷尽性从「联合」搬到了「家族」，
仍然只增不减。撤掉注入后 `npx vue-tsc -b --force` = **0 错**。

复绿终态：`node --test tests/run-config-types.test.mjs` = **14/14**，域内 22 文件 = **194/194**。

---

## 6 零消费方自查

- 本轮**没有新建源文件** ⇒ 没有新孤儿；`find-orphan-modules --gate` 报「新增 0 · 本轮清掉 1」。
- 清掉的那个是 `src/jarRun.ts`：现在被 `src/runConfigurationSchema.ts:2`（入口判据）、
  `src/runConfigTree.ts:14`（标签）、`src/runConfigEditors.ts:42`（逐类型校验）三处 import。
- 本轮新增导出里**唯一暂时没有 src 消费者**的是 `jarRunConfigParams` / `jarRunConfigWorkingDirectory`
  （`src/jarRun.ts:329-343`、`:347-349`）：启动链路的消费点在 `src/runActions.ts:93-105`（非我名下），
  已写成请求 J2 并在那里给了可照抄的两行。它们不是「只过自己测试的死模块」的原因：
  同一族的入口判据（`jarRunConfigProblem`）**今天**就被 schema/编辑器/闭包三处真消费，
  `jarRunConfigParams` 只是把同一条 argv 顺序留给宿主挂载用。
- `runConfigTypeLabel('jar')` 的行为：gate 关着时**仍返回 `'jar'`**（既有断言
  `tests/run-config-types.test.mjs:134` 钉着「不显示假标签」）⇒ 本轮**没有**改这条断言，
  而是新加一条「宿主没接 JAR 时左树不列 jar 配置」把「不放假控件」钉住。摘 gate 后这条既有断言会红，
  必须一起改成断言真标签 —— 已写进请求 J1 的第 3 步（这是**唯一**需要动断言体的地方，理由与坐标都在请求里）。

引用门：本文与请求文档里所有 `路径:行号` 都指得到真实文件（本轮亲自开过）；
对「假写法」的批评一律**不带行号**（规约 §5 的坑）。

---

## 7 做不到 / 无法核实

1. **JAR 类型对用户可见**这件事本轮做不到：`src/settingsModel.ts:26` 的联合与
   `native/settings_schema.cpp:1011-1012` 的白名单都是保留文件 ⇒ 只能交请求（J1）。
   现在 jar 只在**家族清单**里，UI 与落盘都不认它。
2. **执行参数的端到端**做不到：`src/runActions.ts:99` 的 `params.shell = config.type !== 'application'`
   不在我名下 ⇒ JAR 配置真正跑起来要那条改完（J2）。本轮只保证「缺入口时启动前就抛错」（`runConfigClosure` → schema）。
3. **JAR 的上下文生成（Producer）没做**：上游 `JarApplicationConfigurationProducer.java:22-41`
   要改 `src/runTargets.ts` 的 `RunTargetKind` 与 `discoverRunTargets`（非我名下），
   且临时配置也过同一份 schema ⇒ J1 之前做了就是「点一下就抛错」⇒ 判 `[ ]`，写成请求 J3。
4. **动了 `native/` 的 ctest 没跑**：本轮**没有**改任何 `native/*`（白名单那一处是请求），
   所以没有 ctest 数字可记。宿主白名单的一致性由 TS 侧按文本读（既有判据）核。
5. **`src/components/RunConfigurationsDialog.vue` / `TestRunnerPanel.vue` 未改**（非我名下）：
   本轮确认它们读的都是投影后的清单（`RUN_CONFIG_TYPES` / `runConfigFieldsFor`），
   J1 摘 gate 后**不需要**改对话框就能出 JAR 表单；这一点如果与实际不符，请以组件代理为准。
6. **上游 zh 本地化包不在本地树**：`JAR Application` / `Path to JAR` / `Choose JAR File` 用英文原文（与
   `src/jarRun.ts` 既有写法一致），没有自造中文。
7. **R4 的六族判词回写本轮无法核**：`scripts/verdict_table.py` 与 `docs/inventory/*.md` 是保留文件，
   且此刻被另一个代理改动中（`M scripts/verdict_table.py`）⇒ 我只核了「失效句子对应的事实」，
   没核那份表的最终形状。
8. **`module-size` 门禁本轮不绿**（`src/components/CodeEditor.vue` 1151 > 1147，别人在途）⇒
   不是本轮改动造成，我也不能替它降上限或登记豁免（规约 §5：上限只许拆文件来降）。

---

## 8 需要主代理接的线

全部写在 **`docs/wiring-requests-2026-10-06-runcfg3.md`**：
J1（JAR 宿主两处 + 摘 gate + 一条既有断言同步改，含可照抄替换体）、
J2（`src/runActions.ts:99` 的 shell 与 argv 挂载）、J3（JAR producer，非我名下）、
J4（R2 的六个持久化 boolean）、J5（R4 判词回写的两条 + 本轮新增的一条事实）。
