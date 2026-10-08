# 接线请求 · 2026-10-06 第二批 · 代 `runcfg2`（JUnit 树时长 / 运行配置类型 / 构建动作）

代 **`runcfg2`**。格式照 `.tools/agent-rules.md` §2：目标文件 + 目标行号 + import 语句 + 可照抄的整段替换 + 上游依据。
本轮工作区 2026-10-06 09:0x–10:0x；**下面每个行号都是我自己开文件数出来的**（保留文件被并行代理改着，动手前请先重读一次）。
上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（未上网检索）。

配套实现报告：`docs/batch-2026-10-06-runcfg2.md`。
第一批的请求（仍然有效，本文件把它的坐标复核了一遍）：`docs/wiring-requests-2026-10-06-runcfg.md`。

---

## R1 —— JAR 运行配置类型：五处必须同一次改（原 W-Runcfg-2，坐标全部复核）

**判定：本轮一处都没改**，因为五处里 `src/settingsModel.ts` 与 `native/settings_schema.cpp` 是保留文件、其余三处在我名下但**单独改会当场编译不过**：
`RUN_CONFIG_TYPE_LABELS`（`src/runConfigTree.ts:19`）与 `RUN_CONFIG_EDITORS`（`src/runConfigEditors.ts:90`）都是
`Record<NonNullable<RunConfig['type']>, …>`，联合里没有 `'jar'` 时给它们加键 ⇒ TS2352/TS2561 直接红；
宿主那处不改则前端建得出、存档被 `INVALID_SETTINGS` 整份拒掉。

### 本轮新增的事实（请主代理一并处理）

**第五处现在也有机器门了**：`tests/run-config-types.test.mjs:136-151`（本轮新增的「第五处：宿主 settings_schema.cpp 的 type 白名单与 schema 清单同源」）
按文本读 C++ 白名单，与 `RUN_CONFIG_TYPE_IDS` 做**同序** deepEqual，并逐个核对报错文案里点出的类型名。
⇒ 落地时**新增的 id 要加在 C++ 那一串的最后面**（与 TS 清单同序），否则这条判据红。
反向验证过：只给 `src/runConfigurationSchema.ts:14` 加一个假 id ⇒ 「四份清单同步」+「编辑器表覆盖每个类型」+ 新的「第五处」三条同时红。

### ① `src/settingsModel.ts`（保留文件）——当前第 19-26 行

现状（逐字，本轮复核过）：第 19-25 行是「这里**故意不加** `'jar'`」那段注释，第 26 行是
`  type?: 'shell' | 'application' | 'debug' | 'compound'`。
把第 19-26 行整段换成：

```ts
  // JAR 配置类型（上游 `java/execution/impl/src/com/intellij/execution/jar/JarApplicationConfigurationType.java:20`
  // 的 `super("JarApplication", ExecutionBundle.message("jar.application.configuration.name"), …)`；
  // 文案 `platform/execution/resources/messages/ExecutionBundle.properties:55` = "JAR Application"。
  // 本仓的规范 id 在 `src/jarRun.ts:50`（`JAR_APPLICATION_TYPE_ID`）、标签在 `src/jarRun.ts:52`
  // （`JAR_APPLICATION_TYPE_LABEL`，本地化包不在本地树 ⇒ 用英文原文，没有自造中文）。
  // ⚠️ 加类型必须**同一次**改五处（2026-10-06 复核，桶 11c 原请求写三处是漏的）：
  //   · 本联合；
  //   · `src/runConfigurationSchema.ts:14` 的 `RUN_CONFIG_TYPE_IDS`（漏了 ⇒ 左树建得出、`normalizeRunConfigurations` 当场拒收）；
  //   · `src/runConfigTree.ts:19` 的 `RUN_CONFIG_TYPE_LABELS`（`Record<…,string>` 穷尽，漏了编译不过）；
  //   · `src/runConfigEditors.ts:90` 的 `RUN_CONFIG_EDITORS`（同上，TS2741/TS2352）；
  //   · `native/settings_schema.cpp:1011-1012` 的 type 白名单（漏了 ⇒ 宿主 `INVALID_SETTINGS`，项目设置整个存不下去）。
  // 一致性由 `tests/run-config-types.test.mjs` 钉：前四处在「四份类型清单必须同步」那条，第五处在「第五处：宿主…同源」那条。
  type?: 'shell' | 'application' | 'debug' | 'compound' | 'jar'
```

其余字段**一个都不用加**：JAR 配置运行期就是一串 `java -jar …`，本仓用现成的 `program`（java 可执行文件）+
`args`（`-jar path` 与程序参数）+ `cwd`/`env`/`beforeLaunch` 表达，与 `src/jarRun.ts:180-191`（`jarRunArgs`：VM 参数 → `-jar` 路径 → 程序参数）
产出的 argv 完全同形 ⇒ `native/settings_schema.cpp:999-1001` 的 `known_keys` 白名单**不需要**扩键。

### ② `src/runConfigurationSchema.ts:14`（我名下，等这五处一起落）

```ts
export const RUN_CONFIG_TYPE_IDS: readonly NonNullable<RunConfig['type']>[] = ['shell', 'application', 'debug', 'compound', 'jar']
```
（第 28 行的校验用的就是这个常量，不用改。）

### ③ `src/runConfigTree.ts:19-24`（我名下）

```ts
const RUN_CONFIG_TYPE_LABELS: Record<NonNullable<RunConfig['type']>, string> = {
  shell: 'Shell 命令',
  application: '应用程序',
  debug: '调试',
  compound: '复合配置',
  // 上游 `jar.application.configuration.name`（ExecutionBundle.properties:55）；本地化包不在本地树 ⇒ 英文原文。
  jar: 'JAR Application',
}
```

### ④ `src/runConfigEditors.ts`（我名下）——在第 78 行 `const MEMBERS: …` 之后插入两个字段定义，并在 `RUN_CONFIG_EDITORS`（第 90 行起）的 `compound` 条目之前加 `jar` 条目

```ts
const JAR_PROGRAM: RunConfigFieldDef = {
  id: 'program', label: 'Java 可执行文件', placeholder: 'build/…/bin/java.exe',
  hint: '上游 JAR 表单的 JRE 那格（`JarApplicationConfiguration.java:49` 一带的 alternative JRE path）：本仓直接把可执行文件写在这格，换 JDK 就改这里。',
}
const JAR_ARGS: RunConfigFieldDef = {
  id: 'args', label: 'JAR 与程序参数', placeholder: '-jar build/app.jar [程序参数]',
  hint: 'VM 参数也写在这一串里（`-Xmx512m -jar app.jar`）—— 与 `src/jarRun.ts:180-191` 的 argv 顺序一致：VM 参数 → `-jar` 路径 → 程序参数。',
}
```

```ts
  jar: {
    typeId: 'jar', tabTitle: '配置', primary: 'program',
    fields: [JAR_PROGRAM, JAR_ARGS, CWD, ENV, BEFORE],
  },
```

为什么这样就够：
- `checkRunConfiguration`（同文件 `:167-204`）走非复合分支 ⇒「命令与程序都空」这条致命校验对 jar 天然成立；
- `runConfigClosure`（`src/runConfigTree.ts:157`）对非 `shell` 类型只要求 `command` 或 `program` 之一有值 ⇒ jar 填 `program` 就能过；
- 上游 JAR 表单的「Path to JAR / VM options」两格在本仓并进 `args`（同一串 argv）；「模块 classpath」那格**不画**
  （`src/jarRun.ts:103-111` 已把那条字段标 `available: false`，理由：本仓运行配置没有模块概念）⇒ 没有假控件。

### ⑤ `native/settings_schema.cpp:1011-1012`（保留文件）

```cpp
                if (type != "shell" && type != "application" && type != "debug" && type != "compound" && type != "jar")
                    fail("INVALID_SETTINGS", "运行配置类型只能是 shell、application、debug、compound 或 jar。");
```

（`grep -rn "运行配置类型只能是" tests/ native/ src/` 本轮只有这一处命中 ⇒ 改文案不撞既有断言；
但 `tests/run-config-types.test.mjs:146-151` 会核「文案逐个点出类型名」，所以这句必须一起改。
这里只改现有文件的两个字节串，不涉及源文件清单 ⇒ 没有动 `CMakeLists.txt`。）

### 落地后的验证（按规约跑，别只看退出码）

1. `npx vue-tsc -b --force` ⇒ 0 错（两张 `Record<…>` 少键会当场红）。
2. `node --test tests/run-config-types.test.mjs tests/run-configuration-schema.test.mjs tests/run-config-tree.test.mjs` ⇒ 全绿；
   「四份清单同步」+「第五处同源」就是这次改动的自动核对。
3. `node --test tests/module-size.test.mjs`、`node .tools/find-orphan-modules.mjs --gate` ⇒ 绿。
4. 动了 `native/`：`call "C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvars64.bat"` 后
   `npm run test:native`，看日志里的 `tests passed` 那行（别信 npm 退出码）。
5. 落完之后 `src/jarRun.ts` 从此有真消费方（左树的 jar 类型节点 + 编辑器表），
   可以从 `find-orphan-modules` 的**已登记孤儿 9 个**里清掉它一个。

## R2 —— 测试树的排序/统计开关与 wall time 持久化（要新设置键 ⇒ 只能交请求）

上游这四个排序开关 + `showInlineStatistics` + `useWallTime` 都存在 `TestConsoleProperties`
（`platform/testRunner/src/com/intellij/execution/testframework/TestConsoleProperties.java:45-48`、`:57`；
wall time 在 `java/execution/impl/src/com/intellij/execution/testframework/JavaAwareTestConsoleProperties.java:55`
的 `new BooleanProperty("useWallTime", true)`），也就是**随运行配置存盘**；
本仓 `src/components/TestRunnerPanel.vue:235-236`（`sortOptions` / `showInlineStatistics`）与本轮加的 wall time
（默认 true，落在 `src/testTree.ts:610-647`）都是运行时 `ref`，刷新就回到默认。

**为什么本轮不落**：落盘要新建持久化键 ⇒ 目标文件是 `src/settingsModel.ts`（保留）+ `native/settings_schema.cpp` 的
`known_keys`/校验（保留），且规约 §3 最后一条要求「旧存档缺键要补默认，不许按字段数量判损坏」。
本仓同面板既有的 `trackRunning`/`scrollToSource` 也一直是运行时状态，没有为它们开过那条线。
主代理若要落，建议一次给六个 boolean（三排序键 + 置顶 + 行内统计 + wall time），照 `runConfigs` 那一族的
「缺键补默认 + 不按字段数量判损坏」形状走，并把默认值抄 `DEFAULT_TEST_TREE_SORT`（`src/testTree.ts:415-420`）
与 `TestConsoleProperties.java:57`（inline statistics 默认 true）、`JavaAwareTestConsoleProperties.java:55`（wall time 默认 true）。

## R3 —— 「重新构建项目」的键位偏差（原 W-Runcfg-4，两处都是保留文件 ⇒ 本轮不动）

- 现状：`src/menus/buildMenu.ts:47`（`actionRow('build.rebuild', { keys: 'Ctrl Shift F9' })`，我名下）与
  `src/keymap.ts:268`（`if (event.key === 'F9' && event.ctrlKey && event.shiftKey && workspace.value) … startBuild(true)`，保留文件）——
  菜单显示的 keys 与真实绑定**一致**，不是假文案。
- 上游：`Ctrl+F9` = `CompileDirty`（`platform/platform-resources/src/keymaps/$default.xml:303-305`）；
  `Ctrl+Shift+F9` = `Compile`（同文件 `:428-430`，文案 `ActionsBundle.properties:931-933`「Force recompilation for the selected module, file, or package」）；
  真正的「Rebuild Project」= `CompileProject`，在 `$default.xml` 里**没有**默认快捷键（本轮复核：`grep 'action id="CompileProject"'` 在 keymaps 目录 0 命中）。
- 判断：本仓没有单文件/模块增量编译通道（构建=按项目类型折算一条命令行，`src/projectBuild.ts` + `native/gradle.cpp`），
  `Compile` 那格落不了地；把 `Ctrl+Shift+F9` 空出来只会让「重新构建」失去唯一入口 ⇒ **保持现状**。
  若主代理要照上游收干净，需要同时改 `src/keymap.ts:267-268` 与 `src/menus/buildMenu.ts:47`（我可以配合改后者），
  并决定是否给「重新构建项目」另配一键。

## R4 —— 六族判词回写（`scripts/verdict_table.py` 的 `FAMILIES` / `PLATFORM_FAMILIES` 表，主代理的活）

本轮**自己开上下游逐条核过**的失效句子（「原写 X、实际 Y」都留了痕）：

| 族 | 判词原写 | 实际（本轮复核） |
|---|---|---|
| `exec/testframework` | 「仍缺：失败导航、自动测试、测试结果 XML 导出与历史测试」 | 四条**都已有落点**：失败导航 `src/testNavigation.ts` + 面板 `:282-298`（走展示后的树）、自动测试 `src/autoTest.ts` + 面板 `:382-402`、XML 导出 `src/testResultsXml.ts` + 面板 `:315`（`exportXml`）、导入历史 `src/testImport.ts` + 面板 `:328-372`。本轮**新补**：事件到达时间戳、suite 的 wall time、运行中实时时长、Overall/Sum 两行 tooltip、排序按 customized duration（`src/testTree.ts:88-107`、`:129-176`、`:203`、`:230`、`:464-512`、`:596-647`；面板 `:235-244`、`:547`） |
| `exec/junit` | 「缺：按包/目录/模式运行」「缺：JUnit 5 动态/参数化用例与 tags 的展示」「缺：测试发现索引」「缺：`testDiscovery/actions`（到测试/创建测试）」 | 前四条**都已有落点**：范围/模式 `src/junitPatterns.ts` + 面板 `:106-141`；参数化/动态用例展示 `src/junitParameters.ts` + 面板 `:270`、模板 `:551-553`；发现索引 `src/testLocator.ts`（`testIndexOf`/`firstTestLocation`）；「转到测试」由 `src/navGotoTest.ts` + `src/lspNavigation.ts:518-560` + `src/keymapBindings.ts:123-124`（Ctrl+Shift+T）承接（不是我的文件，本轮只是核实）。**仍缺**：创建测试动作（无消费入口，见下）、TestNG 配置类型与运行器协议、变更列表受影响测试、注解引用导航（要 PSI） |
| `exec/junit-inspection`（顺带核到，不在派单六族里） | 「`junitQuickFix` 的动作入口仍未接，卡点在 `src/semanticActions.ts` 只读 `lspDiagnostics`」 | **已接**：`src/semanticActions.ts:28` import `junitQuickFixActions`、`:423` 把它并进 Alt+Enter 的条目表 |
| `exec/run-configs` | 「缺 ④ per-type 设置编辑器（本仓一张通用表单）」 | **已有**逐类型表：`src/runConfigEditors.ts:90-108`（每类型一张字段表 + 复合配置无「启动前」）+ `src/components/RunConfigurationsDialog.vue` 用它渲染；缺的只是每类型独立页签（存储/JRE/覆盖率页）与 `'jar'` 类型（见 R1） |
| `exec/configurations-types` | 同上（`ProgramRunner` 匹配链、`ExecutionEnvironment` 富模型…） | 判词成立，本轮**没有**新增落点（都在 `src/runActions.ts`/`native/run_host.*`，非我名下） |
| `exec/actions` | 判词点名的 `PauseOutputAction`/清空等 | 已由运行实例族落地（`src/runInstances.ts`、`src/components/RunConsole.vue`，非我名下）；我面里的 Build 菜单四条动作在 `src/menus/buildMenu.ts:20-41`，与 `JavaActions.xml:71-80` 逐条对照见批报告 §C |
| `lp/build` | 「缺：构建事件模型与进度树、多构建视图与构建树、构建视图设置、`OpenFileQuickFix`、JPS 增量」 | **仍成立**，且新增一条更具体的卡点：构建输出面板与工具窗布局在 `src/App.vue`/`src/components/RunConsole.vue`（都不是我名下）⇒ 只造事件模型就是零消费方死模块，规约 §3 禁止。编译器输出解析族本轮复核为**已覆盖**（`src/buildOutput.ts:32-53` kotlinc/groovyc、`:55-60` MSVC/GCC、`:94-98` CMake；dispatcher 由 `parseAnyIssue` 串链代替） |

**做不到 / 无法核实（请一并写进判词）**：
1. **创建测试动作**（上游 `testDiscovery/actions` 的 `CreateTestAction`）：本仓没有「Generate」弹窗入口在我名下
   （`src/menus/codeMenu.ts`、`src/menus/editorPopupMenu.ts` 都不是我的文件），也没有 Java 测试骨架模板的落点；
   只在测试面板里放一个「创建测试」按钮就是编造位置 ⇒ 判 `[ ]` 并点名卡点文件。
2. **上游 `CompileProject` 的默认键位**：`$default.xml` 里 0 命中 ⇒ 判为「没有默认快捷键」，但**没有**逐条排查其它 keymap 表；
   要照上游改键位请先复核。
3. `SMTestProxy.getDurationPaddedString`（`platform/smRunner/src/com/intellij/execution/testframework/sm/runner/SMTestProxy.java:531-533`、
   `:552-555` 的补零档 `NlsMessages.formatDurationPadded`，`platform/ide-core-impl/src/com/intellij/ide/nls/NlsMessages.java:215-237`、`:246-248`）：
   **没有落**——它是**通用** `TestTreeRenderer` 那一档（`platform/smRunner/src/com/intellij/execution/testframework/sm/runner/ui/TestTreeRenderer.java:102-104`
   → `SMTestProxy.getDurationString`）在「正在跑」时的画法；本面板对齐的是 **Java** 测试树视图
   （`java/execution/impl/src/com/intellij/execution/testframework/JavaSMTRunnerTestTreeView.java:52-86` 覆盖同一个 `getDurationText`，
   `:69-73` 走「向下取整到整秒 + `formatDurationApproximateNarrow`」）。两种画法在上游就是分岔的，本仓取 Java 那一种（本仓的测试面是 JUnit/JVM 优先），
   所以 `formatDurationPadded` 没有真消费方 ⇒ 不搬（搬了就是只有测试在读的死代码）。若主代理认为该按通用档画，请指一个消费者。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R1（JAR 五处同改）已接线**：`RunConfig['type']` 含 `'jar'`、`RUN_CONFIG_EDITORS` 有 jar、`RUN_CONFIG_TYPES` 家族表含 jar（见 runcfg 处理结果）。
- **R2（测试树排序/统计开关持久化）** —— 目标 `src/settingsModel.ts`（保留）+ `native/settings_schema.cpp`。需 settings/native owner。
- **R3（重新构建键位）** —— 保留文件。**R4** —— 判词。

结论：R1 已接线；R2/R3/R4 非本 lane。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「R1 已接线；R2/R3/R4 非本 lane。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
