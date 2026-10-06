# 接线请求 · 2026-10-06 第三批 · 代 `runcfg3`（JAR 的宿主挂载 / 执行参数 / 测试树持久化 / 判词回写）

代 **`runcfg3`**（桶 11 运行配置域收尾）。格式照 `.tools/agent-rules.md` §2：目标文件 + 目标行号 + import 语句 + 可照抄的整段替换 + 上游依据。
本轮工作区 2026-10-06 11:4x–12:2x；**下面每个行号都是我自己开文件数出来的**（保留文件被并行代理改着，动手前请先重读一次）。
配套实现报告：`docs/batch-2026-10-06-runcfg3.md`。
前两批的请求：`docs/wiring-requests-2026-10-06-runcfg.md`、`docs/wiring-requests-2026-10-06-runcfg2.md`（R1 由本文件的 J1 取代，其余仍有效）。

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（未上网检索）。
JAR 一族的上游真路径是 `java/execution/impl/src/com/intellij/execution/jar/`（不是 `plugins/java/...` 那种写法，也没有 `jarApplication` 这个目录名）。

---

## J1 —— JAR 运行配置类型：宿主两处 + 摘 gate，三步一次做完（**最重要**）

**本仓现状（本轮已做完的部分）**：JAR 在**模块侧**是完整的，五处都从同一份清单投影 ——
`src/runConfigurationSchema.ts:30` 家族清单里有 `'jar'`，`:33` 的 `RUN_CONFIG_TYPE_IDS_HOST_PENDING` 里也还有 `'jar'`，
所以 `:38-40` 的已接清单**不含** jar ⇒ 表单/左树/落盘/执行参数四处现在都不认 jar（不是没做，是**故意挡住不放假控件**）。
宿主那两处是保留文件，只能交请求：

### 第 1 步 `src/settingsModel.ts`（保留文件）——当前第 19-26 行

现状（逐字，本轮复核过）：19-25 行是「⚠️ 这里**故意不加** `'jar'`」那段注释，第 26 行是
`  type?: 'shell' | 'application' | 'debug' | 'compound'`。
**把第 19-26 行整段换成**（那段注释里说的「三张表」已经过时：现在是一张家族清单 + 一份 pending + 两处穷尽 Record）：

```ts
  // JAR 配置类型（上游 `java/execution/impl/src/com/intellij/execution/jar/JarApplicationConfigurationType.java:19-23`
  // 的 `super("JarApplication", ExecutionBundle.message("jar.application.configuration.name"), …)`；
  // 文案 `platform/execution/resources/messages/ExecutionBundle.properties:55` = "JAR Application"；
  // 表单四格 `java/execution/impl/src/com/intellij/execution/jar/JarApplicationConfigurable.java:47-49/73/81`）。
  // 本仓的规范名/标签/字段/入口判据/执行参数都在 `src/jarRun.ts`（`:50-63`、`:103-111`、`:291-343`）。
  // ⚠️ 加类型只动**一份**清单：`src/runConfigurationSchema.ts:30` 的 `RUN_CONFIG_TYPE_FAMILY_IDS`（家族），
  //   并给两张按家族穷尽的表补键 —— `src/runConfigTree.ts:22` 的 `RUN_CONFIG_TYPE_FAMILY_LABELS`、
  //   `src/runConfigEditors.ts:112` 的 `RUN_CONFIG_TYPE_FAMILY_EDITORS`（少键直接 TS2741）。
  //   UI 与落盘读的是**投影后的** `RUN_CONFIG_TYPE_IDS`（= 家族 − `RUN_CONFIG_TYPE_IDS_HOST_PENDING`），
  //   所以联合、宿主白名单（`native/settings_schema.cpp:1011-1012`）与该 pending 必须**同一次**动，
  //   否则就是「建得出、存不下去」那个老形状。判据 `tests/run-config-types.test.mjs`
  //   （四份清单同步 / 第五处同源 / 家族=已接+pending / gate 与宿主两处同步）。
  type?: 'shell' | 'application' | 'debug' | 'compound' | 'jar'
```

**其余字段一个都不用加**：JAR 落成本仓现成的 `program`（Java 可执行文件 = 上游 JRE 那一格）+
`args`（VM 参数 → `-jar` 路径 → 程序参数，与 `src/jarRun.ts:187-196` 的 argv 同形）+ `cwd`/`env`/`beforeLaunch`
⇒ `native/settings_schema.cpp:999-1001` 的 `known_keys` 白名单**不需要**扩键（本轮核过两侧：
`src/runConfigurationSchema.ts:63` 的 `keys` 与原生 `known_keys` 逐字同一批）。

### 第 2 步 `native/settings_schema.cpp`（保留文件）——当前第 1011-1012 行

现状（逐字）：

```cpp
                if (type != "shell" && type != "application" && type != "debug" && type != "compound")
                    fail("INVALID_SETTINGS", "运行配置类型只能是 shell、application、debug 或 compound。");
```

**整段换成**（新增的 id 必须加在**最后**：`tests/run-config-types.test.mjs:153-158` 那条要求两侧**同序**）：

```cpp
                if (type != "shell" && type != "application" && type != "debug" && type != "compound" && type != "jar")
                    fail("INVALID_SETTINGS", "运行配置类型只能是 shell、application、debug、compound 或 jar。");
```

（`grep -rn "运行配置类型只能是" src native tests` 本轮只有这两处命中 ⇒ 改文案不撞别的断言；
但同一条判据会核「文案逐个点出类型名」，所以两句必须一起改。这里只改现有文件的两个字节串 ⇒ 不涉及源文件清单，没动 `CMakeLists.txt`。）

### 第 3 步 摘 gate：`src/runConfigurationSchema.ts:33`（我的文件，改一行就开）

```ts
export const RUN_CONFIG_TYPE_IDS_HOST_PENDING: readonly RunConfigTypeId[] = []
```

（把 `JAR_RUN_CONFIG_TYPE_ID` 从数组里删掉。这一行一摘：
`RUN_CONFIG_TYPE_IDS` 自动多出 jar ⇒ 左树类型节点、对话框「添加」菜单与「类型」下拉、逐类型字段表、
`runConfigClosure` 的整组校验、仪表盘的类型开关**一起**出现 JAR，不需要改任何组件文件。）

### 第 4 步 有一条既有断言必须跟着改（**这是本轮唯一需要动断言体的地方**）

`tests/run-config-types.test.mjs:134` 现在是：

```js
  assert.equal(runConfigTypeLabel('jar'), 'jar', '本仓还没接 JAR 类型 ⇒ 不显示假标签')
```

它钉的是「未知类型退回原 id，不编标签」这个通用行为 + jar 当时**确实没接**这个事实。
摘 gate 后 jar 已接 ⇒ 该行必须改成断言真标签（**不是放松断言，是它钉的那个值变了**）：

```js
  assert.equal(runConfigTypeLabel('jar'), 'JAR Application', 'JAR 已接 ⇒ 取上游 bundle 原文（ExecutionBundle.properties:55）')
```

同文件里还有两条会跟着变（**都不用改，只是会一起变绿/变红，用来核第 1-3 步齐不齐**）：
`:60-69`「每一种已声明的类型都能存得下去」会自动多跑一个 jar 用例；
`:249-254`「宿主没接 JAR 时左树不列 jar 配置」里那句 `assert.deepEqual(..., [])` 要改成 `['jar']`。

### 落完之后的验证（按规约跑，别只看退出码）

1. `npx vue-tsc -b --force` ⇒ 0 错（两张 `Record<RunConfigTypeId, …>` 少键会当场红）。
2. `node --test tests/run-config-types.test.mjs tests/run-configuration-schema.test.mjs tests/run-config-tree.test.mjs tests/jar-run.test.mjs` ⇒ 全绿。
3. `node --test tests/module-size.test.mjs`、`node .tools/find-orphan-modules.mjs --gate` ⇒ 绿。
4. 动了 `native/`：`call "C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvars64.bat"` 后
   `npm run test:native`，**看日志里 `tests passed` 那行**（别信 npm 退出码）。
5. 忘做第 3 步（宿主接了、gate 还留着）⇒ `JAR 的 gate 与宿主两处必须同步` 红；
   只做第 3 步（前端接了、宿主没接）⇒ 同一条 + 「第五处同源」+「四份清单同步」一起红（本轮实测 9 红，见批报告 §5 注 1）。

## J2 —— JAR 的**执行参数**挂载（`src/runActions.ts:99`，非我名下）

现状（逐字，`src/runActions.ts:93-105`）：

```ts
function runStartParams(label?: string, config: RunConfig = currentRunConfig()): RunStartParams {
  const params: RunStartParams = { command: config.command }
  if (config.program) params.program = config.program
  if (config.args?.length) params.args = config.args
  if (config.cwd) params.cwd = config.cwd
  if (config.env?.length) params.env = config.env
  params.shell = config.type !== 'application'
```

问题：`params.shell = config.type !== 'application'` 会把 jar 配置丢进 shell 通道（`cmd /c`），
而 JAR 的 argv 里那条路径含空格是要按 argv 起的（与 `application` 同一档）。
**把那一行换成**（`src/jarRun.ts:329-343` 的 `jarRunConfigParams` 返回的就是 `shell: false`）：

```ts
  // JAR 与 application 同一档：program + argv 直接起进程，不再过一次 shell（路径里的空格会被切坏）。
  // 上游命令行形状 `java/execution/impl/src/com/intellij/execution/jar/JarApplicationCommandLineState.java:18-25`。
  params.shell = config.type !== 'application' && config.type !== 'jar'
```

可选的第二半（不做也能跑：配置里 `program` 空时退到项目 JDK，与上游 `createProjectJdk(project, jreHome)` 同口径）：
在 `runStartParams` 里 `if (config.program) params.program = config.program` 之前插一段。
需要的 import：`import { isJarRunConfig, jarRunConfigParams } from './jarRun.ts'`（值 import，带 `.ts`）。

```ts
  if (isJarRunConfig(config)) {
    // 缺 JAR 路径 / 既没填 Java 可执行文件也没有项目 JDK ⇒ 抛错（文案已经点明是哪一格），不静默起一个空命令行。
    const launch = jarRunConfigParams(config, { jdkHome: projectSettings.value.java.jdkHome ?? '' })
    params.program = launch.program
    params.args = launch.args
    params.shell = false
  }
```

判据：`tests/jar-run.test.mjs:156-170`（argv 顺序、剥启动器）与 `:172-182`（两种抛错 + JDK 退化）。
注意 `'jar'` 在 `RunConfig['type']` 联合里落地之前，`config.type !== 'jar'` 会撞 TS2367 ⇒ **J2 必须排在 J1 第 1 步之后**。

## J3 —— JAR 的上下文生成（Producer）：判 `[ ]`，卡在两处非我名下

上游 `java/execution/impl/src/com/intellij/execution/jar/JarApplicationConfigurationProducer.java:22-41`：
选中工作区里的 `.jar` ⇒ `setupConfigurationFromContext` 把配置名取成文件名、`jarPath` 取成文件路径
（`FileUtilRt.extensionEquals(file.getName(), "jar")` 是唯一入口判据）。
本仓等价落点是 `src/runTargets.ts`（`RunTargetKind` 那条联合 `:52` + `discoverRunTargets` `:145-210`，非我名下）
与 `src/runConfigurations.ts:38-67` 的发现流程（我名下，但没有 jar 这个 kind 就接不上）。
**为什么本轮不做**：临时配置也要过 `runConfigClosure` → `normalizeRunConfigurations` 那份 schema
（`src/runConfigTree.ts:156`），J1 之前给一条 jar 目标就是「点一下抛错」= 假控件（规约 §3）。
J1 落地后我可以补：`RunTargetKind` 加 `'jar'`、`discoverRunTargets` 里按 `\.jar$/i` 出目标
（`args: ['-jar', path]`、`program: javaExecutable(jdkHome)`），再加一条判据。要的话 reopen 我。

## J4 —— 测试树的排序/统计/wall time 持久化（R2 原样仍缺，键在这里开）

复核到的当前事实：`src/components/TestRunnerPanel.vue:235-236` 是运行时 `ref`（`sortOptions` / `showInlineStatistics`），
刷新回默认；wall time 的**计算**已经在 `src/testTree.ts:472-477`（`testNodeDurationMs`：suite 取 `end - start`，缺任一时间戳返回 null）
与 `:572-647`（呈现：运行中实时时长 / 已结束 suite 的 wall time / tooltip），但**面板上没有 wall time 开关**
（`grep -in "wall" src/components/TestRunnerPanel.vue` 0 命中）⇒ 现在不是「有开关没存盘」，是「算好了但既不能切也不能存」。

要落就得新建持久化键 ⇒ 目标文件是 `src/settingsModel.ts`（保留）+ `native/settings_schema.cpp` 的 `known_keys`/校验（保留），
所以我这边一行都没动。建议一次给六个 boolean（三排序键 + 置顶 + 行内统计 + wall time），
默认值照上游抄：
- `platform/testRunner/src/com/intellij/execution/testframework/TestConsoleProperties.java:45-48` 四个排序 `BooleanProperty`
  （`sortTestsAlphabetically`/`sortByDuration`/`sortByDeclarationOrder`/`suitesAlwaysOnTop`，前三个默认 false、最后一个默认 true ——
  与本仓 `src/testTree.ts:415-420` 的 `DEFAULT_TEST_TREE_SORT` 一致）；
- 同文件 `:57` `showInlineStatistics` 默认 **true**；
- `java/execution/impl/src/com/intellij/execution/testframework/JavaAwareTestConsoleProperties.java:55`
  `USE_WALL_TIME = new BooleanProperty("useWallTime", true)` 默认 **true**。

规约 §3 那条红线请一起守住：**旧存档缺键要补默认**（不许按字段数量判损坏 —— 本仓出过把用户锁在项目外的事故），
即 `ProjectSettings.testTree` 缺失/字段缺失都走默认值，不能报 `INVALID_SETTINGS`。
落完之后我可以接面板那两处（`sortOptions` / `showInlineStatistics` 改读写这个键 + 补 wall time 那一格开关）——
`src/components/TestRunnerPanel.vue` 不在我名下，需要主代理分派或授权。

## J5 —— 判词回写（`scripts/verdict_table.py`，保留文件；**另一个代理此刻在改**）

`git status` 本轮看到 `M scripts/verdict_table.py`、`M docs/inventory/verdict-platform_rest.md`、`M tests/b7-verdict.test.mjs`
⇒ 这份表正在被别人改，我不落笔，只把自己**亲自开过上下游**核到的失效句子交给主代理（合并时请以对方版本为准）：

| 族 | 表里当前写法（本轮打开核到的行号） | 实际（本轮复核） |
|---|---|---|
| `exec/run-configs` | `scripts/verdict_table.py:36` 仍写「④ per-type 设置编辑器（`SettingsEditor` 每种类型一套；本仓一张通用表单，类型只是字段）」 | 已有**逐类型表**：`src/runConfigEditors.ts:112-146`（每类型一张字段表 + 复合配置无「启动前」+ jar 一行）与 `src/runConfigTree.ts:22-33`（每类型一个标签），由 `RunConfigurationsDialog.vue:268-269` 消费；真正还缺的是每类型独立页签（存储/JRE/覆盖率）与「JAR 的宿主两处接线」（本文件 J1） |
| `exec/run-configs` | 同一条里若登记「JAR 配置类型完全没有」 | 本轮改成「模块侧完成、宿主两处待接」：家族清单已含 `'jar'`，`RUN_CONFIG_TYPE_IDS_HOST_PENDING` 挡着 UI/落盘；执行参数已有纯函数（`src/jarRun.ts:329-343`）等 J2 挂载 |
| `exec/testframework` | `scripts/verdict_table.py:52` 仍写「仍缺：失败导航、自动测试、测试结果 XML 导出与历史测试」 | 四条**都已有落点**（本轮逐个 `ls` 核到文件存在、且被 `src/components/TestRunnerPanel.vue` 消费）：`src/testNavigation.ts`、`src/autoTest.ts`、`src/testResultsXml.ts`、`src/testImport.ts`；仍缺的是 R2/J4 那套排序/统计/wall time 的**持久化与开关** |

其余四条（`exec/junit`、`exec/configurations-types`、`exec/actions`、`lp/build`）本轮没有新事实，维持 runcfg2 的 R4 结论。
