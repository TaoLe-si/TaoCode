# 接线请求 · 2026-10-06 · roots（根与 SDK / 外部系统续批）

主代理名下的**一处**落点（R1 的 App.vue 那一行）。行号是现树实测（工作区并发变动中，落地前请重读目标区域）。
roots2 轮（本文件续批）把 R1 的**模块侧全部落完**、R2 的两条核到**已由别人落地**，下面逐条写了证据与还差什么。

## R1 · 运行配置携带 env/VM 选项：**只剩 App.vue 那一行回调**

- **roots2 已做（模块侧，本面）**：
  · `src/gradleHost.ts:72` 的 `GradleHostDeps.addRunConfiguration` 已扩成
    `(name: string, command: string, env?: string[]) => unknown`；
  · `src/gradleHost.ts:666-678`（`saveTaskAsRunConfig`）已把 `taskRunEnvironment(settings, [])` 当第三参喂出去
    —— 给的是**增量**（`GRADLE_OPTS=<VM 选项>` + 用户 env），不带自己解析出的 `JAVA_HOME`：
    上游持久进运行配置的就是 vmOptions/scriptParameters/env 那几条（`ExternalSystemBeforeRunTask.java:38-45`），
    JDK 是执行时再解析的；判据 `tests/gradle-host.test.mjs`「存过的 VM 选项/env 随『创建运行配置』交出」。
- **下游已就绪（本轮核实，不用再改）**：`src/runConfigurationSchema.ts:22` 的键白名单含 `env`
  （`:32`、`:62` 按 `string[]` 收），`src/runActions.ts:96` 的 `if (config.env?.length) params.env = config.env`
  已经在把它交给宿主，`native/run_host.cpp:207` 的 `step.environment` 收下、
  `native/runner.hpp:30-32` 写明「applied on top of the inherited」= 叠加不是替换。
  ⇒ **整条链只差 App.vue 收下第三参。**
- **还差什么**（App.vue 那一处可直接照抄）：
  ```ts
  // src/App.vue:1817 整行替换（第三参 = 上面那两条 KEY=VALUE 增量）
  addRunConfiguration: (name, command, env?: string[]) => {
    const config: Record<string, unknown> = { name, command }
    if (env?.length) config.env = env
    void persistRunConfigs([...runConfigs.value, config], `已把 Gradle 任务保存为运行配置「${name}」`)
  },
  ```
  （原文给的那版把 env 折成 `Object.fromEntries(...)` 对象再落盘；本轮实读 `runConfigurationSchema.ts:32,62`
  与 `native/run_host.cpp:207`，两侧收的都是 `string[]`，所以照抄版改成直接存数组——**留痕：原写折对象、实际按数组**。）
- **上游依据**：`platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/execution/ExternalSystemBeforeRunTask.java:42`
  （把 `vmOptions` 写进运行配置 XML 的属性）；bean `platform/external-system-api/src/com/intellij/openapi/externalSystem/model/execution/ExternalSystemTaskExecutionSettings.java:39-43`
  （vmOptions/scriptParameters/passParentEnvs 随配置持久）；env 消费 `service/internal/ExternalSystemExecuteTaskTask.java:41-44,80-82`。

## R2 · bucket15 的 W2/W3：**两条都已落地，本条作废（roots2 核到）**

- **W2（外部工具字段落进宿主设置）已落**：`native/settings_schema.cpp:248-258` 已按上游 `Tool` 的 bean
  收 externalTools 数组（缺键不判坏），判据在 `native/settings_transfer_test.cpp:183`
  「externalTools 的白名单按上游 Tool 的 bean 放开：缺键补默认、不按字段数判坏」。
- **W3（启动时灌忽略清单）已落**：`src/main.ts:6` import `loadIgnoredPatterns`，注释写明
  「`loadIgnoredPatterns()` 自己已经 `applyToManager`」⇒ 只调一次、不多写 localStorage。
- 结论：**这条不需要主代理再裁决**；本仓现在只剩 R1 的 App.vue 那一行。
  （留痕：本文件原写「两条请求的前端侧已就绪、等的是这两处保留文件的口子」—— 实际两处口子都已开，
  本行按现状改成作废。核对方式：直接 grep 那两个文件的现树内容。）
