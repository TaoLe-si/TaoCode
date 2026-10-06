# 接线请求 · 2026-10-06 · roots2

只有一条，且**只剩保留文件的一行**。行号是本轮（2026-10-06）现树实测，落地前请重读目标区域。
上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。

## N1 · `src/App.vue:1817` 收下 `addRunConfiguration` 的第三参（运行配置带 VM 选项/env 的最后一寸）

- **目标文件 / 行号**：`src/App.vue:1817`（保留文件，派单禁改）。
- **现状（本轮实测的整条链，除这一行外全通）**：
  · 生产者：`src/gradleHost.ts:72` 已把 `GradleHostDeps.addRunConfiguration` 扩成
    `(name: string, command: string, env?: string[]) => unknown`，`:666-677` 在任务被「编辑任务…」存过
    VM 选项或 env 时交出 `taskRunEnvironment(settings, [])` = `['GRADLE_OPTS=<VM 选项>', '<用户 env 行>'…]`；
  · 存储：`src/runConfigurationSchema.ts:22` 的键白名单含 `env`，`:32` 校验它是列表、`:62` 原样保留；
  · 执行：`src/runActions.ts:96` 的 `if (config.env?.length) params.env = config.env` 已经在把它交给宿主；
  · 宿主：`native/run_host.cpp:207`（`step.environment = string_list(value.at("env"))`）、`:265`，
    `native/runner.hpp:30-32` 写明这些 `KEY=VALUE` 是「applied on top of the inherited」= **叠加**，不是替换掉 PATH。
  ⇒ 今天断的只有 `src/App.vue:1817` 的回调只声明两个参数，第三参在 JS 层被丢掉。
- **可照抄的整段替换**（把现有的 `addRunConfiguration: (name, command) => …` 那一行整行换掉）：
  ```ts
  addRunConfiguration: (name, command, env?: string[]) => {
    const config: Record<string, unknown> = { name, command }
    if (env?.length) config.env = env
    void persistRunConfigs([...runConfigs.value, config], `已把 Gradle 任务保存为运行配置「${name}」`)
  },
  ```
  **形状提醒（本轮实测，别照旧写法改）**：`env` 存 **`string[]`（`KEY=VALUE` 行）**，不要折成对象——
  `src/runConfigurationSchema.ts:32,62` 与 `native/run_host.cpp:207` 两侧收的都是列表；
  折成对象会被 `:32` 的列表校验判坏。（`src/runActions.ts:272` 的 `envArrayToObject` 只在 DAP 那条通道用，
  运行实例这条通道直接传数组。）
- **旧存档兼容**：`env` 是**可选键**，缺键时 `normalizeRunConfigurations` 不补、也不判损坏
  （既有判据形状见 `tests/run-configurations.test.mjs` 一族；如要补判据请按「缺键补默认、不按字段数判坏」的口径）。
- **上游依据**：`platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/execution/ExternalSystemBeforeRunTask.java:38-45`
  —— 把 `tasks` / `externalProjectPath` / **`vmOptions`** / `scriptParameters` 全写进运行配置 XML 的属性；
  bean `platform/external-system-api/src/com/intellij/openapi/externalSystem/model/execution/ExternalSystemTaskExecutionSettings.java:33,39,40,43,94-104`；
  执行侧消费 `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/internal/ExternalSystemExecuteTaskTask.java:41-44,80-82`
  （`withVmOptions` / `withArguments` / `withEnvironmentVariables` / `passParentEnvs`）。
  ⇒ 上游这些字段**随运行配置持久**，不是只在「直接运行那一刻」生效；本仓现在只有「直接运行」那条（走带 env 的
  原生 Gradle 通道）生效，「保存为运行配置」这一半差 App.vue 这一行。
- **落完后请一并跑**：`node --test tests/ext-task-settings.test.mjs tests/gradle-host.test.mjs tests/run-configurations.test.mjs`
  —— 我这侧的判据已经钉住生产者（`tests/ext-task-settings.test.mjs`「接线③」、
  `tests/gradle-host.test.mjs`「存过的 VM 选项/env 随『创建运行配置』交出」），落完建议再加一条**端到端**：
  面板「创建运行配置」→ `runConfigs` 里那条带 `env` 数组。

## 顺带（不需要接线，只登记状态）

- 原 `docs/wiring-requests-2026-10-06-roots.md` 的 **R2 已作废**：bucket15 的 W2（外部工具字段落进宿主设置）
  与 W3（启动时灌忽略清单）本轮 grep 现树核到**都已落地**
  （`native/settings_schema.cpp:248-258` + 判据 `native/settings_transfer_test.cpp:183`；`src/main.ts:6` import
  `loadIgnoredPatterns` 且由其自身 apply）。
- **F1-F5（`docs/wiring-requests-2026-10-06-filetypes.md`）本轮一条都落不了**：目标全在保留文件或非我面
  （`src/bridge.ts`、`src/bridgePreview.ts`、`src/searchExclusions.ts`、`src/components/SearchPanel.vue`、
  `src/components/EditorPopupMenu.vue`、`src/App.vue`、`native/main.cpp`、`native/settings_schema.cpp`），
  逐条实测与「为什么我面没有替代挂点」写在 `docs/batch-2026-10-06-roots2.md` §1/§7。
  其中 **F4 需要主代理先给 Method 名**（`file.info`？入参 `{path}`、回 `{bytes, modifiedAt, readOnly, encodingHint}`）
  才能动 `src/bridge.ts` 的 `Method` 联合与 `native/main.cpp` 的 switch；名与挂点定了，
  `native/workspace.cpp`（我面）那一半 20 行以内就能补上。
