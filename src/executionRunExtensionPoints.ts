// **运行/控制台/测试那一批执行域 EP 的宿主接线** —— 把「运行配置模板提供者 / 测试位置提供者 /
// 进程 pid 提供者 / 控制台暂停状态提供者 / 运行配置生产者抑制器」这五条上游本来就是 EP 的接口，
// 按 `src/extensionPoints.ts` 的 `EXTENSIONS` 宿主登记出来，并给出与上游**同名的方法面**。
//
// 上游依据（qualifiedName 逐字取自 `<extensionPoint>` 声明或 `ExtensionPointName.create(...)`）：
//   · `com.intellij.runConfigurationTemplateProvider` —— `platform/execution-impl/resources/intellij.platform.execution.impl.xml:165`
//     （`interface="com.intellij.execution.impl.RunConfigurationTemplateProvider" area="IDEA_PROJECT" dynamic="true"`）；
//     接口 `platform/execution-impl/src/com/intellij/execution/impl/RunManagerImpl.kt:130-134`
//     （`getRunConfigurationTemplate(factory, runManager): RunnerAndConfigurationSettingsImpl?`），
//     EP 常量在 `:132`。上游平台内无内建贡献（唯一贡献是 configuration-script 插件的
//     `MyRunConfigurationTemplateProvider`，见 `plugins/configuration-script/resources/META-INF/plugin.xml:46`）。
//   · `com.intellij.testSrcLocator` —— 同文件 `:168`（`interface="com.intellij.testIntegration.TestLocationProvider" dynamic="true"`）；
//     接口 `platform/execution-impl/src/com/intellij/testIntegration/TestLocationProvider.java:13-19`
//     （`getLocation(protocolId, locationData, project): List<Location>`，`EP_NAME` 在 `:14`；
//     上游自己标了 `@Deprecated(forRemoval)`，注释写明「改用 `SMTRunnerConsoleProperties.getTestLocator()`」）。
//   · `com.intellij.execution.processHandlerPidProvider` —— 同文件 `:182-184`
//     （`interface="com.intellij.execution.impl.ProcessHandlerPidProvider" dynamic="true"`）；
//     接口 `platform/execution-impl/src/com/intellij/execution/impl/ProcessHandlerPidProvider.kt:10-18`
//     （`getPid(processHandler): Deferred<Long?>?`，`null` = 这个实现不支持该 handler；`EP_NAME` 在 `:13-14`）。
//     上游全仓（platform + plugins + java）无内建贡献 —— 这条 EP 是给语言后端自报 pid 用的。
//   · `com.intellij.execution.consolePauseStateProvider` —— 同文件 `:178-180`
//     （`interface="com.intellij.execution.ui.ExecutionConsolePauseStateProvider" dynamic="true"`）；
//     接口 `platform/execution-impl/src/com/intellij/execution/ui/ExecutionConsolePauseStateProvider.kt:9-17`
//     （`isPaused(project, console): Boolean`，`EP_NAME` 在 `:14-15`）。上游内建贡献一条：
//     `platform/xdebugger-impl/resources/intellij.platform.debugger.impl.content.xml:82`
//     （`XDebuggerConsolePauseStateProvider`，调试会话暂停 ⇔ 控制台算暂停，
//     见 `platform/xdebugger-impl/src/com/intellij/xdebugger/impl/XDebuggerConsolePauseStateProvider.kt:11-15`）；
//     消费点 `platform/testRunner/src/com/intellij/execution/testframework/TestConsoleProperties.java:141-152`
//     —— **逐个问，任一个为真即为暂停**（`for … if (provider.isPaused(...)) return true`）。
//
// `com.intellij.runConfigurationProducerSuppressor` 也在本轮同批落地，但它的注册表与消费点
// （`src/runTargets.ts` 的 `discoverRunTargets` / `src/executionExtensionPoints.ts` 的
// `produceRunConfigurationFromContext`）都在 EP 宿主那一侧，**放在 `src/executionExtensionPoints.ts`**
// ——若收进本文件会与那个文件形成 ESM 初始化环（本文件在模块求值时就要用它的 `EPExtensionRegistry`）。
//
// **本仓的落地口径（如实差异）**：
//   ① 上游这些接口都吃 PSI/Project/ExecutionConsole 对象；本仓没有这些对象，收它们的可读子集
//      （`TemplateFactoryRef` / `TestLocationProject` / `ExecutionProcessHandler` / `ConsoleRef` /
//      `ProducerRef`），消费点各自见下。`Location` 在上游是带 PSI 的目标，本仓是
//      `{ path, line, paramName }`（`src/testLocator.ts` 的 `TestLocation`，同一形状）。
//   ② `Deferred<Long?>`（Kotlin 协程）在本仓收成同步的 `number | null`（本仓的 pid 本来就是
//      宿主快照回的同步值，没有异步探测通道）。
//   ③ 每条 EP 的**内建那一半留在原处**（不搬进本文件，避免与既有实现分家）：
//      模板的 localStorage 表仍在 `src/runConfigTemplates.ts`、pid 的宿主快照仍在
//      `native/run_host.cpp` 回填、运行控制台的暂停位仍是 `src/runInstances.ts` 的
//      `runOutputPaused`（它同时作为 bundled 贡献登记在 `com.intellij.execution.consolePauseStateProvider`
//      上 —— 对应上游 `XDebuggerConsolePauseStateProvider` 那一格）。没有第三方贡献时，
//      每条消费路径的取值与接线前逐字一致。
//
// 纯数据层：只 import `src/extensionPoints.ts` 与 `src/executionExtensionPoints.ts`（EP 宿主），
// 不 import vue/DOM/bridge ⇒ `node --test` 直测。
//
// 判据：`tests/execution-run-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'
import { EPExtensionRegistry } from './executionExtensionPoints.ts'
import type { ExecutionProcessHandler } from './executionListeners.ts'

/** 四条 EP 的 id（逐字取自上游，见文件头）。 */
export const RUN_CONFIGURATION_TEMPLATE_PROVIDER_EP = 'com.intellij.runConfigurationTemplateProvider'
export const TEST_SRC_LOCATOR_EP = 'com.intellij.testSrcLocator'
export const PROCESS_HANDLER_PID_PROVIDER_EP = 'com.intellij.execution.processHandlerPidProvider'
export const CONSOLE_PAUSE_STATE_PROVIDER_EP = 'com.intellij.execution.consolePauseStateProvider'

/** 声明四条 EP（幂等：重复调用只覆盖同名声明）。 */
export function declareExecutionRunExtensionPoints(): void {
  for (const [id, name] of [
    [RUN_CONFIGURATION_TEMPLATE_PROVIDER_EP, '运行配置模板提供者'],
    [TEST_SRC_LOCATOR_EP, '测试位置提供者'],
    [PROCESS_HANDLER_PID_PROVIDER_EP, '进程 pid 提供者'],
    [CONSOLE_PAUSE_STATE_PROVIDER_EP, '控制台暂停状态提供者'],
  ] as const) {
    EXTENSIONS.declareExtensionPoint({ id, name, scope: APPLICATION_SCOPE, dynamic: true })
  }
}

declareExecutionRunExtensionPoints()

/** 一个配置类型工厂的可移植面（上游 `ConfigurationFactory` 在本仓对应「配置类型 id + 名字」）。 */
export interface TemplateFactoryRef {
  /** 配置类型 id（本仓 `RunConfig['type']` 的那一档）。 */
  typeId: string
  /** 类型的显示名（上游 `ConfigurationFactory.getName()`）。 */
  displayName?: string
}

/** 模板提供者交回来的模板（形状 = `src/runConfigTemplates.ts` 的 `RunConfigTemplate`，声明成结构类型免循环 import）。 */
export interface ContributedRunConfigTemplate {
  command?: string
  program?: string
  args?: string[]
  cwd?: string
  env?: string[]
  beforeLaunch?: Array<{ name: string; command: string }>
  allowRunningInParallel?: boolean
  activateToolWindowBeforeRun?: boolean
  focusToolWindowBeforeRun?: boolean
  target?: string
}

// ── ① 运行配置模板提供者（`com.intellij.runConfigurationTemplateProvider`） ─────────────────────

/** 一条模板提供者（上游 `RunConfigurationTemplateProvider.getRunConfigurationTemplate(factory, runManager)`）。 */
export interface RunConfigurationTemplateProviderContribution {
  id: string
  /** 为这个类型给一份模板；`null` = 这条提供者不管这个类型（上游返回 `null` 同义）。 */
  getRunConfigurationTemplate: (factory: TemplateFactoryRef) => ContributedRunConfigTemplate | null
}

export const runConfigurationTemplateProviderRegistry =
  new EPExtensionRegistry<RunConfigurationTemplateProviderContribution>(RUN_CONFIGURATION_TEMPLATE_PROVIDER_EP)

/** 全部模板提供者（上游平台内没有内建贡献 ⇒ 无插件时为空表）。 */
export function runConfigurationTemplateProviders(): RunConfigurationTemplateProviderContribution[] {
  return runConfigurationTemplateProviderRegistry.all()
}

/** 注册一条模板提供者。 */
export function registerRunConfigurationTemplateProvider(
  provider: RunConfigurationTemplateProviderContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return runConfigurationTemplateProviderRegistry.register(provider, options)
}

/**
 * 问所有模板提供者要这个类型的模板（上游 `RunManagerImpl` 在建模板时遍历 EP 的等价物）。
 * 按注册顺序取**第一个**非空结果；一个提供者抛错不吃掉后面的机会。
 * 真实消费点：`src/runConfigTemplates.ts` 的 `templateFor`（新建配置取初值那条路）。
 */
export function templateFromProviders(typeId: string, displayName?: string): ContributedRunConfigTemplate | null {
  for (const provider of runConfigurationTemplateProviderRegistry.all()) {
    try {
      const template = provider.getRunConfigurationTemplate({ typeId, displayName })
      if (template) return template
    } catch {
      // 容错：与上游遍历 EP 时的逐条隔离同档。
    }
  }
  return null
}

// ── ② 测试位置提供者（`com.intellij.testSrcLocator`） ─────────────────────────────────────────

/** 位置提供者看到的工作区面（上游 `Project` 的可移植子集）。 */
export interface TestLocationProject {
  root?: string | null
  name?: string | null
}

/** 一条可跳转位置（形状 = `src/testLocator.ts` 的 `TestLocation`）。 */
export interface ContributedTestLocation {
  path: string
  line: number
  paramName?: string | null
}

/** 一条测试位置提供者（上游 `TestLocationProvider.getLocation(protocolId, locationData, project)`）。 */
export interface TestLocationProviderContribution {
  id: string
  getLocation: (
    protocolId: string, locationData: string, project: TestLocationProject,
  ) => readonly ContributedTestLocation[]
}

export const testLocationProviderRegistry = new EPExtensionRegistry<TestLocationProviderContribution>(TEST_SRC_LOCATOR_EP)

/** 全部测试位置提供者（上游平台内无内建贡献 ⇒ 无插件时为空表）。 */
export function testLocationProviders(): TestLocationProviderContribution[] {
  return testLocationProviderRegistry.all()
}

/** 注册一条测试位置提供者（内建用 `{ source: 'bundled' }`，插件默认 user）。 */
export function registerTestLocationProvider(
  provider: TestLocationProviderContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return testLocationProviderRegistry.register(provider, options)
}

/**
 * 问所有位置提供者要这串 location 的落点（上游 `SMTestLocator` 链上「前一个给不出就问下一个」
 * 的等价物，`GradleTestLocator.kt:48-56`）。按注册顺序取第一个非空结果。
 * 真实消费点：`src/testLocator.ts` 的 `resolveTestLocation`（本仓自己的协议解析不出来之后的兜底）。
 */
export function locationFromTestProviders(
  protocolId: string, locationData: string, project: TestLocationProject = {},
): ContributedTestLocation[] {
  const out: ContributedTestLocation[] = []
  for (const provider of testLocationProviderRegistry.all()) {
    try {
      for (const hit of provider.getLocation(protocolId, locationData, project)) {
        if (hit?.path) out.push({ path: hit.path, line: Math.max(1, Math.trunc(hit.line || 1)), paramName: hit.paramName ?? null })
      }
    } catch {
      // 容错：一个坏提供者不该吃掉别人的落点。
    }
    if (out.length) return out
  }
  return out
}

// ── ③ 进程 pid 提供者（`com.intellij.execution.processHandlerPidProvider`） ─────────────────────

/** 一条 pid 提供者（上游 `ProcessHandlerPidProvider.getPid(processHandler): Deferred<Long?>?`）。 */
export interface ProcessHandlerPidProviderContribution {
  id: string
  /** `null` = 不支持这个 handler（上游同义）；否则给出 pid。 */
  getPid: (handler: ExecutionProcessHandler) => number | null
}

export const processHandlerPidProviderRegistry =
  new EPExtensionRegistry<ProcessHandlerPidProviderContribution>(PROCESS_HANDLER_PID_PROVIDER_EP)

/** 全部 pid 提供者（上游无内建贡献 ⇒ 无插件时为空表；本仓的宿主快照仍是兜底来源）。 */
export function processHandlerPidProviders(): ProcessHandlerPidProviderContribution[] {
  return processHandlerPidProviderRegistry.all()
}

/** 注册一条 pid 提供者。 */
export function registerProcessHandlerPidProvider(
  provider: ProcessHandlerPidProviderContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return processHandlerPidProviderRegistry.register(provider, options)
}

/**
 * 问所有 pid 提供者要这条 handler 的 pid（上游逐个问、第一个非 null 的赢）。
 * 真实消费点：`src/runInstances.ts` 的 `applyRunInstanceSnapshot` —— 插件报的 pid 优先，
 * 没有插件时用宿主快照里的 pid（行为与接线前逐字一致）。
 */
export function pidFromProcessHandlerProviders(handler: ExecutionProcessHandler): number | null {
  for (const provider of processHandlerPidProviderRegistry.all()) {
    try {
      const pid = provider.getPid(handler)
      if (typeof pid === 'number' && Number.isFinite(pid) && pid > 0) return Math.trunc(pid)
    } catch {
      // 容错：一个坏提供者不该挡住宿主快照那条兜底。
    }
  }
  return null
}

// ── ④ 控制台暂停状态提供者（`com.intellij.execution.consolePauseStateProvider`） ───────────────

/** 控制台引用（上游 `ExecutionConsole` 在本仓的可移植面：控制台 id + 工作区根）。 */
export interface ConsoleRef {
  /** 本仓的控制台 id：`run`（运行控制台）/ `debug`（调试控制台）。 */
  id: string
  projectRoot?: string | null
}

/** 一条暂停状态提供者（上游 `ExecutionConsolePauseStateProvider.isPaused(project, console)`）。 */
export interface ConsolePauseStateProviderContribution {
  id: string
  isPaused: (console: ConsoleRef) => boolean
}

export const consolePauseStateProviderRegistry =
  new EPExtensionRegistry<ConsolePauseStateProviderContribution>(CONSOLE_PAUSE_STATE_PROVIDER_EP)

/** 全部暂停状态提供者（内建一条：运行控制台自报，登记在 `src/runInstances.ts`）。 */
export function consolePauseStateProviders(): ConsolePauseStateProviderContribution[] {
  return consolePauseStateProviderRegistry.all()
}

/** 注册一条暂停状态提供者。 */
export function registerConsolePauseStateProvider(
  provider: ConsolePauseStateProviderContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return consolePauseStateProviderRegistry.register(provider, options)
}

/** 注册一条 bundled 暂停状态提供者（上游 `XDebuggerConsolePauseStateProvider` 那一格的自登记口径）。 */
export function registerBundledConsolePauseStateProvider(provider: ConsolePauseStateProviderContribution): ExtensionHandle {
  return registerConsolePauseStateProvider(provider, { source: 'bundled' })
}

/**
 * 这个控制台算不算暂停（上游 `TestConsoleProperties.isPaused` 的等价物：**逐个问、任一为真即为真**，
 * `TestConsoleProperties.java:145-151`）。真实消费点：`src/runInstances.ts` 的运行控制台暂停位
 * 与 `src/components/RunConsole.vue` 的暂停按钮/提示行。
 */
export function consolePausedByProviders(console: ConsoleRef): boolean {
  for (const provider of consolePauseStateProviderRegistry.all()) {
    try {
      if (provider.isPaused(console)) return true
    } catch {
      // 容错：一个坏提供者不该把暂停状态判错方向（按上游默认 false 继续问下一条）。
    }
  }
  return false
}
