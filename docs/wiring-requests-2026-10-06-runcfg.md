# 接线请求 · 2026-10-06 桶 11c（运行配置 / JUnit 树）

代 **`runcfg`**（JUnit/测试框架/运行配置/构建）。格式照 `.tools/agent-rules.md` §2：目标文件 + 目标行号 + 可照抄整段 + 上游依据。
本轮（2026-10-06 06:xx 工作区）所有行号都是我自己开文件数出来的；App.vue / native 那两个保留文件被别的代理并行改着，**动手前请先重读一次**。

---

## W-Runcfg-1 —— 原 W-B11c-1（测试树跳转最后一段）：**已经接上了，无需再动**

- 复核对象：`src/App.vue:2212`（渲染 `<TestRunnerPanel … />` 那一行）
- 现状（逐字）：那一行已经带着请求里给的属性 ——
  `@jump="target => revealLocation({ path: target.path, line: Math.max(0, target.line - 1) })"`
- **留痕**：原请求写「目标文件 `src/App.vue` 第 2254 行」。实际现在在 **:2212**（App.vue 在桶 11c 之后被 `appvue` 继续改过，行号漂了 42 行）。原请求的 :2254 是当时对的，别拿它当今天的坐标。
- 模块侧复核（本轮没改，只是确认端到端成立）：
  - `src/components/TestRunnerPanel.vue:36` —— `defineEmits<{ jump: [target: { path: string; line: number }] }>()`
  - `:293` —— 双击树节点 / 点结果行 → `jump(node)` → `emit('jump', target)`
  - `:427` —— 运行中跟随（「Navigate with Single Click」开着时）→ 同一个 `emit`
  - 行号口径确认：`firstTestLocation` 返回 **1 基**（`src/testLocator.ts:85-86`（`TestIndexEntry.line` 的「1 基行号」注释；同文件 `:36` 也记着这条口径）），`revealLocation` 收 **0 基**（App.vue 自己那几处 `Math.max(0, action.line - 1)` 同一口径，例如 :1006）⇒ 宿主那句 `-1` 是对的。
- 结论：**这条从「待接」变成「已接」**，本轮没有为它产生任何模块侧改动。
  主代理若要验收，跑 `node --experimental-strip-types --test tests/test-locator.test.mjs tests/test-tree-view.test.mjs`（12 + 17 条，本批之后是 17 条）。

## W-Runcfg-2 —— 原 W-B11c-3（JAR 运行配置类型）：**要同改的不是三处，是五处**

> 原请求（`docs/wiring-requests-2026-10-06-bucket11c.md` §W-B11c-3）写的是「`settingsModel.ts` + `runConfigEditors.ts` + `runConfigTree.ts` 三张表同一次改」。
> 本轮复核：**实际有五处**，少了后两处会出现「前端建得出、宿主存不下去」或「左树有类型、schema 拒收」。
> 原请求点名的原因仍然成立：`RUN_CONFIG_EDITORS` 是 `Record<NonNullable<RunConfig['type']>, …>`，只改联合会 TS2741。
> **本轮我一处都没改**（只把我名下那两处准备成了可照抄的形状，见下面 2/3/4 段），因为五处里有一处是保留文件、一处是 `native/`。
> 落地之后请跑 `node --test tests/run-config-types.test.mjs` —— 它的第 1 条判据（本轮新增）就是把这四份清单做 deepEqual，**少改一处就红**，不需要人肉核对。

### ① `src/settingsModel.ts` —— 联合类型（当前第 26 行，注释块 19-25）

把第 19-26 行（整段注释 + 那一行 `type?:`）换成：

```ts
  // JAR 配置类型（上游 `JarApplicationConfigurationType.java:19-22` 的 `super("JarApplication", …)`）：
  // 本仓的规范 id 在 `src/jarRun.ts:50`（`JAR_APPLICATION_TYPE_ID = 'JarApplication'`），
  // 类型标签在 `src/jarRun.ts:52`（`jar.application.configuration.name`，
  // `platform/execution/resources/messages/ExecutionBundle.properties:55` = "JAR Application"，
  // 本地化包不在本地树 ⇒ 用英文原文，没有自造中文）。
  // ⚠️ 加类型必须**同一次**改五处（2026-10-06 复核，桶 11c 原请求写三处是漏的）：
  //   · 本联合；
  //   · `src/runConfigurationSchema.ts:14` 的 `RUN_CONFIG_TYPE_IDS`（漏了 ⇒ 左树建得出、`normalizeRunConfigurations` 当场拒收）；
  //   · `src/runConfigTree.ts:19` 的 `RUN_CONFIG_TYPE_LABELS`（`Record<…,string>` 穷尽，漏了编译不过）；
  //   · `src/runConfigEditors.ts:90` 的 `RUN_CONFIG_EDITORS`（同上，TS2741）；
  //   · `native/settings_schema.cpp:1011-1012` 的 type 白名单（漏了 ⇒ 宿主 `INVALID_SETTINGS`，项目设置整个存不下去）。
  // 一致性由 `tests/run-config-types.test.mjs` 的「四份类型清单必须同步」钉住（第五处是 C++，靠下面的原生自测）。
  type?: 'shell' | 'application' | 'debug' | 'compound' | 'jar'
```

其余字段**一个都不用加**：JAR 配置在运行期就是一串 `java -jar …`，本仓用现成的 `program`（java 可执行文件）+ `args`（`-jar path` 与程序参数）+ `cwd`/`env`/`beforeLaunch` 表达，
与 `src/jarRun.ts:180-191`（`jarRunArgs`：VM 参数 → `-jar` 路径 → 程序参数）产出的 argv 完全同形 ⇒ `native/settings_schema.cpp:999-1000` 的 `known_keys` 白名单**不需要**扩键。

### ② `src/runConfigurationSchema.ts:14`

```ts
export const RUN_CONFIG_TYPE_IDS: readonly NonNullable<RunConfig['type']>[] = ['shell', 'application', 'debug', 'compound', 'jar']
```

（第 28 行的校验用的是这个常量，不用改。）

### ③ `src/runConfigTree.ts:19-24`

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

### ④ `src/runConfigEditors.ts`

第 78 行（`const MEMBERS: …`）之后插入两个 jar 专用字段定义，并在 `RUN_CONFIG_EDITORS`（第 90-108 行）的 `compound` 条目**之前**加 `jar` 条目：

```ts
const JAR_PROGRAM: RunConfigFieldDef = {
  id: 'program', label: 'Java 可执行文件', placeholder: 'build/…/bin/java.exe',
  hint: '上游 JAR 表单的 JRE 那格（`JarApplicationConfigurable` 的 alternative JRE path）：本仓直接把可执行文件写在这格，换 JDK 就改这里。',
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
- `checkRunConfiguration`（同文件 :167-204）走非复合分支 ⇒ 「命令与程序都空」这条致命校验对 jar 天然成立；
- `runConfigClosure`（`src/runConfigTree.ts:157`）对非 `shell` 类型只要求 `command` 或 `program` 之一有值 ⇒ jar 填 `program` 就能过；
- 上游 `JAR_FORM_FIELDS` 里的「Path to JAR / VM options」两格在本仓并进 `args`（同一串 argv），
  「模块 classpath」那格**不画**（`src/jarRun.ts:103-111` 已标 `available: false`，理由：本仓运行配置没有模块概念）⇒ 没有假控件。

### ⑤ `native/settings_schema.cpp:1011-1012`

```cpp
                if (type != "shell" && type != "application" && type != "debug" && type != "compound" && type != "jar")
                    fail("INVALID_SETTINGS", "运行配置类型只能是 shell、application、debug、compound 或 jar。");
```

（`grep -rn "运行配置类型只能是" tests/ native/ src/` 现在只有这一处命中 ⇒ 改文案不会撞到既有断言。新建/改动 `native/*.cpp` 不许自己动 `CMakeLists.txt`，这里只改现有文件的两个字节串，不涉及源文件清单。）

### 落地后的验证（按规约跑，别只看退出码）

1. `npx vue-tsc -b --force` ⇒ 0 错（两张 `Record<…>` 若少键会当场 TS2741）。
2. `node --test tests/run-config-types.test.mjs tests/run-configuration-schema.test.mjs tests/run-config-tree.test.mjs` ⇒ 7 + 现有条数全绿；
   第 1 条「四份类型清单必须同步」就是这次改动的自动核对。
3. `node --test tests/module-size.test.mjs`、`node .tools/find-orphan-modules.mjs --gate` ⇒ 绿。
4. 因为动了 `native/`：`vcvars64` 后 `npm run test:native`，看日志里的 `tests passed` 行。
5. 顺手确认 `src/jarRun.ts` 从此有生产消费方（左树的 jar 类型节点 + 编辑器表），
   它此前在 `find-orphan-modules` 的**已登记孤儿**（9 个）里挂着 ⇒ 落完之后那 9 个可以清一个。

## W-Runcfg-3 —— 族判词回写（`scripts/verdict_table.py` 的 FAMILIES 表，主代理的活）

本轮落地的两件事需要并进族判词，否则下一轮又被当成缺口重做：

- `exec/testframework`（`docs/inventory/verdict-execution.md:38`）：
  「失败导航已按展示模型数序号」+「树排序三键互斥 + 套件置顶 + 行内耗时统计」→
  落点 `src/testTree.ts:308-486` 与 `src/components/TestRunnerPanel.vue:231-245/462-481/533-535`，判据 `tests/test-tree-view.test.mjs:142-250`。
  **仍缺**（判词要保留）：wall time / overall+sum tooltip / 运行中补零时长（见 batch 报告 §6.3）。
- `exec/run-configs` + `exec/configurations-types`（同文件 :40/:42）：
  类型清单已收敛成「schema 一份 + 标签/编辑器两张穷尽 Record + 原生白名单」，且有 `tests/run-config-types.test.mjs` 的同步门；
  `src/runConfigEditors.ts:33` 声明的判据文件此前**不存在**、本轮补真 ⇒ 「假引用」那条订正建议同时回写。
- `lp/build`（`docs/inventory/platform_rest_verdict_table.json:255`）：本轮**没有**新增落点，只复核了上游三个 `*OutputParser` 都已有对应（`src/buildOutput.ts:1-12/31-36/62-100`）⇒ 判词里的「缺事件模型/多构建视图」仍然成立。

## W-Runcfg-4 —— 「重新构建项目」的键位偏差（要不要改由主代理定，本轮不改）

- 现状：`src/menus/buildMenu.ts:26-30/47` 的「重新构建项目」显示并按 `Ctrl Shift F9` 走，真实绑定在 `src/keymap.ts:268`（保留文件）。
- 上游：`Ctrl+F9` = `CompileDirty`（`platform/platform-resources/src/keymaps/$default.xml:303-305`）；`Ctrl+Shift+F9` = `Compile`（同文件 `:428-430`），
  而 `Compile` 的文案是 **R_ebuild**、描述「Force recompilation for the selected module, file, or package」
  （`platform/platform-resources-en/src/messages/ActionsBundle.properties:931-933`）；
  真正的「Rebuild Project」= `CompileProject`（同文件 `:923-924`），在 `$default.xml` 里**没有默认快捷键**。
- 判断：本仓没有单文件/模块增量编译通道，`Compile` 那格落不了地；把 `Ctrl+Shift+F9` 空出来只会让「重新构建」失去唯一入口。
  菜单里显示的 keys 与实际绑定**一致**（不是假文案），所以本轮按「已留痕偏差」保留。
  若主代理要照上游收干净，需要同时改 `src/keymap.ts:267-268` 与 `src/menus/buildMenu.ts:47`（两个都是保留文件），
  并决定是否给「重新构建项目」配一个新键。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W-Runcfg-1 已接线**：`src/App.vue` 的 `<TestRunnerPanel>` 已带 `@jump`（见 bucket11c / bucketW）。
- **W-Runcfg-2 / runcfg2 R1 / runcfg3 J1（JAR 类型五处同改）** —— `src/settingsModel.ts`（保留）+ `src/runConfigEditors.ts` / `runConfigTree.ts`（本 lane）。复核 `RunConfig['type']` 已含 `'jar'`（`:31`）、`runConfigEditors.ts:135` 已有 jar 条目、`runConfigTree.ts` 走家族表 ⇒ 五处已同改。
- **W-Runcfg-3 / R4** —— 判词（`scripts/verdict_table.py`），非本 lane。
- **W-Runcfg-4 / R3（重新构建键位）** —— 保留文件，非本 lane。

结论：W-Runcfg-1 / W-Runcfg-2 已接线；其余非本 lane。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「W-Runcfg-1 / W-Runcfg-2 已接线；其余非本 lane。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
