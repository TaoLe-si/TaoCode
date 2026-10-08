// **execution 域的扩展点宿主接线** —— 把「运行配置类型 / 运行配置生产者 / 启动前任务提供者 /
// 控制台折叠 / 控制台动作后处理 / 执行器 / 启动前代理」这几族上游本来就是 EP 的接口，
// 按 `src/extensionPoints.ts` 的 `EXTENSIONS` 宿主登记出来，并给出与上游**同名的方法面**。
//
// 上游依据（qualifiedName 逐字取自各 plugin.xml 的 `<extensionPoint>` 声明或 `EP_NAME` 常量）：
//   · `com.intellij.configurationType` —— `platform/execution/src/com/intellij/execution/configurations/ConfigurationType.java:20`
//     （`ConfigurationType.CONFIGURATION_TYPE_EP`）；接口 `ConfigurationType` 的方法面
//     `getId()` / `getDisplayName()` / `getConfigurationTypeDescription()` / `getIcon()`（`:30-53`）。
//     上游每个运行配置类型（Application/Shell Script/Maven/Gradle…）都是它的一条贡献。
//   · `com.intellij.runConfigurationProducer` —— `platform/lang-api/src/com/intellij/execution/actions/RunConfigurationProducer.java:35`
//     （`RunConfigurationProducer.EP_NAME`）；方法面 `getConfigurationType()`（`:87`）、
//     `createConfigurationFromContext(context)`（`:98`）、`isConfigurationFromContext(config, context)`（`:145`）、
//     `setupConfigurationFromContext(config, context)`（`:134`）。
//   · `com.intellij.programRunner` —— `platform/execution/resources/intellij.platform.execution.xml:31`
//     （`interface="com.intellij.execution.runners.ProgramRunner" dynamic="true"`）。**本仓的锚在
//     `src/programRunners.ts`**（`PROGRAM_RUNNER_EP`），本文件只把它作为同族 EP 汇总说明，不重复声明。
//   · `com.intellij.stepsBeforeRunProvider` —— `platform/execution/src/com/intellij/execution/BeforeRunTaskProvider.java:27`
//     （`BeforeRunTaskProvider.EP_NAME`，ProjectExtensionPointName）；方法面 `getId()` / `getName()` /
//     `createTask(RunConfiguration)`（`:52`）/ `canExecuteTask(config, task)`（`:71`）/ `executeTask(...)`（`:75`）。
//   · `com.intellij.console.folding` —— `platform/execution-impl/src/com/intellij/execution/ConsoleFolding.java:18`
//     （`ConsoleFolding.EP_NAME`）；方法面 `shouldFoldLine(project, line)` / `shouldBeAttachedToThePreviousLine()` /
//     `getPlaceholderText(project, lines)` / `isEnabledForConsole(consoleView)`（`:26-66`）。
//   · `com.intellij.consoleActionsPostProcessor` —— `platform/lang-api/src/com/intellij/execution/actions/ConsoleActionsPostProcessor.java:28`
//     （`ConsoleActionsPostProcessor.EP_NAME`）；方法面 `postProcess(console, actions)` / `postProcessPopupActions(...)`（`:39-49`）。
//   · `com.intellij.executor` —— `platform/execution/src/com/intellij/execution/Executor.java:31`
//     （`Executor.EXECUTOR_EXTENSION_NAME`）；方法面 `getId()` / `getActionName()` / `getStartActionText()` /
//     `getDescription()` / `isApplicable(project)`（`:58-100`）。内建两条 = `DefaultRunExecutor.EXECUTOR_ID = "Run"`、
//     `DefaultDebugExecutor.EXECUTOR_ID = "Debug"`。
//   · `com.intellij.runConfigurationBeforeRunProviderDelegate` —— `platform/execution-impl/resources/intellij.platform.execution.impl.xml:166`
//     （`interface="com.intellij.execution.impl.RunConfigurationBeforeRunProviderDelegate" dynamic="true"`）；
//     方法面 `beforeRun(ExecutionEnvironment)`（`RunConfigurationBeforeRunProviderDelegate.java:25`）。
//
// **如实差异（任务书的 EP 名与上游的对照，逐条核过）**：
//   · 任务书写的 `com.intellij.execution.runConfigurationType` 上游不存在；真实的 ConfigurationType EP
//     是 `com.intellij.configurationType`（上面出处）。本文件用**上游逐字**的 id。
//   · 任务书写的 `com.intellij.execution.runConfigurationProducer` 上游不存在；真实 id 是
//     `com.intellij.runConfigurationProducer`（上面出处）。
//   · 任务书写的 `com.intellij.execution.beforeRunTaskProvider` 上游不存在；真实 id 是
//     `com.intellij.stepsBeforeRunProvider`。
//   · 任务书写的 `com.intellij.execution.consoleFolding` 上游不存在；真实 id 是 `com.intellij.console.folding`。
//   · 任务书写的 `com.intellij.execution.executionListener` 不是 EP：上游 `ExecutionListener` 是 project
//     messageBus 的 **topic**（topic 名 `com.intellij.execution.ExecutionListener`），本仓等价物在
//     `src/executionListeners.ts`（已接线），不在此重复。
//   · 任务书写的 `com.intellij.execution.runConfigurationsPreRun` 上游不存在；「启动前」那一档的真实 EP
//     是 `com.intellij.stepsBeforeRunProvider`（BeforeRunTaskProvider）与
//     `com.intellij.runConfigurationBeforeRunProviderDelegate`（本文件两条都落）。
//
// **本仓此前**：这些族各有内建实现（`src/runConfigTree.ts` 的类型表、`src/runTargets.ts` 的上下文发现、
// `src/runActions.ts` 的启动前链、`src/consoleFold.ts` 的折叠、`src/runInstances.ts` 的控制台），
// 但**没有一条能被第三方按 id 挂进去**。本文件补上那一层：声明 EP + 与上游同名的方法面 + consume 函数；
// 内建的几支在各自消费侧作为 bundled 贡献登记（见各消费点与 `registerBundled*`）。
//
// 与上游的两处如实差异：
//   ① 上游没有 PSI/Project 对象可传，`ConfigurationType.getIcon()` 只给图标名（本仓图标表）；`shouldFoldLine`
//      的 `project` 参数收成 `root`（工作区根字符串，可空）。
//   ② 注册表是**一个通用宿主**（`EPExtensionRegistry`），每个 EP 一个实例；这与上游每种 EP 各一个
//      `ExtensionPointName` 的静态字段是同一件事的不同写法。
//
// 纯数据层：只 import `src/extensionPoints.ts`（不 import vue/DOM/bridge），便于 `node --test` 直测。
//
// 判据：`tests/execution-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'
// 执行器 EP 的**规范锚在 `src/executors.ts`**（那一族的方法面与注册表类都在那边）；
// 这里 import 后原样转发，避免同一个 id 出现第二份字面量。
import { EXECUTOR_EP } from './executors.ts'

export { EXECUTOR_EP }

/** 七条 EP 的 id（逐字取自上游，见文件头）。 */
export const CONFIGURATION_TYPE_EP = 'com.intellij.configurationType'
export const RUN_CONFIGURATION_PRODUCER_EP = 'com.intellij.runConfigurationProducer'
/** `com.intellij.programRunner` 的规范锚在 `src/programRunners.ts`（同一 id），这里只做同族汇总。 */
export const PROGRAM_RUNNER_EP = 'com.intellij.programRunner'
export const BEFORE_RUN_TASK_PROVIDER_EP = 'com.intellij.stepsBeforeRunProvider'
export const CONSOLE_FOLDING_EP = 'com.intellij.console.folding'
export const CONSOLE_ACTIONS_POST_PROCESSOR_EP = 'com.intellij.consoleActionsPostProcessor'
export const RUN_CONFIGURATION_BEFORE_RUN_PROVIDER_DELEGATE_EP = 'com.intellij.runConfigurationBeforeRunProviderDelegate'
/** `com.intellij.runConfigurationProducerSuppressor` —— 上游
 *  `platform/lang-api/src/com/intellij/execution/RunConfigurationProducerService.kt:15-20`
 *  （`interface RunConfigurationProducerSuppressor`，`EP_NAME` 在 `:17`）；
 *  消费点同文件 `:54-60`（`RunConfigurationProducerService.isIgnored(producer)` 逐个问抑制器）。
 *  上游无内建贡献 ⇒ 无插件时为空表、被抑制的生产者一个也没有。 */
export const RUN_CONFIGURATION_PRODUCER_SUPPRESSOR_EP = 'com.intellij.runConfigurationProducerSuppressor'

/** 八条 EP 的声明（幂等：重复调用只覆盖同名声明）。`com.intellij.programRunner` 由 `src/programRunners.ts` 声明。 */
export function declareExecutionExtensionPoints(): void {
  for (const [id, name] of [
    [CONFIGURATION_TYPE_EP, '运行配置类型'],
    [RUN_CONFIGURATION_PRODUCER_EP, '运行配置生产者'],
    [BEFORE_RUN_TASK_PROVIDER_EP, '启动前任务提供者'],
    [CONSOLE_FOLDING_EP, '控制台折叠'],
    [CONSOLE_ACTIONS_POST_PROCESSOR_EP, '控制台动作后处理'],
    [EXECUTOR_EP, '执行器'],
    [RUN_CONFIGURATION_BEFORE_RUN_PROVIDER_DELEGATE_EP, '启动前代理'],
    [RUN_CONFIGURATION_PRODUCER_SUPPRESSOR_EP, '运行配置生产者抑制器'],
  ] as const) {
    EXTENSIONS.declareExtensionPoint({ id, name, scope: APPLICATION_SCOPE, dynamic: true })
  }
}

declareExecutionExtensionPoints()

/** 按 id 注册一条贡献到指定 EP（等价于 plugin.xml 的一条 `<extensionPoint>` 贡献）。 */
export function registerExecutionExtension<T>(
  extensionPoint: string, id: string, value: T, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(extensionPoint, id, value, options)
}

/** 注销某 EP 上的一条贡献（返回是否真的删掉了，与宿主同口径）。 */
export function unregisterExecutionExtension(extensionPoint: string, id: string): boolean {
  return EXTENSIONS.unregisterExtension(extensionPoint, id)
}

/**
 * 通用扩展点注册表（上游每种 EP 的 `getExtensions()` / `findExtension()` / `ExtensionPointListener` 的可移植子集）。
 * 内建项与第三方贡献都落在**同一个 EP 表**里：`register()` 写 EP（`source` 区分 bundled/user），
 * `find()` / `all()` 一并看得见 —— 于是「第三方按 id 挂进来」与「内建的那几条」走同一条消费路径。
 * `adoptFromExtensions()` 把 EP 里不是由本注册表登记的项（例如插件直接 `EXTENSIONS.registerExtension`
 * 挂的）也收进内部表，返回收编条数（上游启动时收编 plugin.xml 的等价物）。
 */
export class EPExtensionRegistry<T extends { id: string }> {
  private readonly extensionPoint: string
  private readonly items = new Map<string, T>()

  constructor(extensionPoint: string) {
    this.extensionPoint = extensionPoint
  }

  /** 按 id 注册（同 id 覆盖，与 `ExtensionPointHost.registerExtension` 同口径）。
   *  返回的句柄同时清 EP 条目与内部表 —— `dispose()` 与 `unregister()` 语义一致
   *  （否则注销后 `find()` 仍会从内部表把它翻出来）。 */
  register(item: T, options: RegisterExtensionOptions = {}): ExtensionHandle {
    if (!item || !item.id) throw new Error(`扩展点 ${this.extensionPoint} 的贡献必须有 id。`)
    this.items.set(item.id, item)
    const handle = EXTENSIONS.registerExtension<T>(this.extensionPoint, item.id, item, options)
    return {
      id: handle.id,
      extensionPoint: this.extensionPoint,
      dispose: () => {
        const removedInternal = this.items.delete(item.id)
        const removedExtension = handle.dispose()
        return removedInternal || removedExtension
      },
    }
  }

  /** 注销（内部表与 EP 表一起删）。返回是否真的删掉了。 */
  unregister(id: string): boolean {
    const removedInternal = this.items.delete(id)
    const removedExtension = EXTENSIONS.unregisterExtension(this.extensionPoint, id)
    return removedInternal || removedExtension
  }

  /** 收编 EP 里未登记进本表的贡献（插件直接挂 EP 的那些）。返回新增条数。 */
  adoptFromExtensions(): number {
    let adopted = 0
    for (const item of EXTENSIONS.extensionsOf<T>(this.extensionPoint)) {
      if (!item || typeof item.id !== 'string' || !item.id) continue
      if (!this.items.has(item.id)) { this.items.set(item.id, item); adopted += 1 }
    }
    return adopted
  }

  /** 按 id 取（先看 EP 表 —— 插件贡献的覆盖内建同 id；再看内部表）。 */
  find(id: string): T | undefined {
    const fromExtensions = EXTENSIONS.extensionsOf<T>(this.extensionPoint)
    for (const item of fromExtensions) if (item && item.id === id) return item
    return this.items.get(id)
  }

  /** 全部贡献：EP 表按 `LoadingOrder` 排好序，内部表里 EP 那批没有的接在后面（去重按 id）。 */
  all(): T[] {
    const fromExtensions = EXTENSIONS.extensionsOf<T>(this.extensionPoint)
    const seen = new Set<string>()
    const out: T[] = []
    for (const item of fromExtensions) {
      if (!item || typeof item.id !== 'string' || seen.has(item.id)) continue
      seen.add(item.id)
      out.push(item)
    }
    for (const item of this.items.values()) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      out.push(item)
    }
    return out
  }

  /** 内部表里的项（不含只在 EP 表里的第三方贡献，排查/断言用）。 */
  registered(): T[] {
    return [...this.items.values()]
  }
}

// ── ① 运行配置类型（`com.intellij.configurationType`） ───────────────────────────────────────

/**
 * 一条运行配置类型（上游 `ConfigurationType` 的方法面，名字与上游逐字相同）。
 * 本仓的类型 id 是**封闭联合**（`RunConfig['type']`），所以这条 EP 的第三方贡献能被按 id 查到，
 * 但**不能**让 UI 新建出宿主联合之外的类型 —— 那个差异写在 `exec/run-configs` 的判词里。
 */
export interface ConfigurationTypeContribution {
  /** `ConfigurationType.getId()`。 */
  id: string
  /** `ConfigurationType.getDisplayName()`。 */
  getDisplayName: () => string
  /** `ConfigurationType.getConfigurationTypeDescription()`。 */
  getConfigurationTypeDescription: () => string
}

export const configurationTypeRegistry = new EPExtensionRegistry<ConfigurationTypeContribution>(CONFIGURATION_TYPE_EP)

/** 全部运行配置类型（内建 + 第三方）。 */
export function configurationTypes(): ConfigurationTypeContribution[] {
  return configurationTypeRegistry.all()
}

/** 按 id 找类型（上游 `ConfigurationType.findById` 的等价物）。 */
export function configurationTypeById(id: string): ConfigurationTypeContribution | undefined {
  return configurationTypeRegistry.find(id)
}

/** 注册一条运行配置类型（内建用 `{ source: 'bundled' }`，插件默认 user）。 */
export function registerConfigurationType(
  type: ConfigurationTypeContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return configurationTypeRegistry.register(type, options)
}

// ── ② 运行配置生产者（`com.intellij.runConfigurationProducer`） ──────────────────────────────

/**
 * 生产者的上下文（上游 `ConfigurationContext` 的可移植子集）：当前文件 + 内容 + 工作区根。
 * 上游还有 PSI/Module/DataContext，本仓没有。
 */
export interface RunConfigurationContext {
  /** 当前活动文件的相对路径（可空 = 没有打开文件）。 */
  path?: string | null
  /** 当前文件内容（宿主按需给；空串表示没读）。 */
  text?: string
  /** 工作区根（可空）。 */
  root?: string | null
}

/** 生产者产出的一条配置（上游 `ConfigurationFromContext` 的可移植子集，字段面照本仓 `RunConfig`）。 */
export interface ProducedRunConfiguration {
  name: string
  type: string
  command: string
  program?: string
  args?: readonly string[]
  cwd?: string
  /** 临时配置（上游 `ConfigurationFromContext.isTemporary`；本仓不落盘，只挂选择器）。 */
  temporary?: boolean
}

/**
 * 一条生产者（上游 `RunConfigurationProducer` 的方法面）。
 * `getConfigurationType()` 返回类型 id（上游返回 `ConfigurationType` 对象，本仓给 id 串）；
 * `isConfigurationFromContext(config, context)` 判断这条配置是不是由该上下文生成的；
 * `setupConfigurationFromContext(context)` 是上游 `createConfigurationFromContext` 的落点（本仓直接给配置）。
 */
export interface RunConfigurationProducerContribution {
  id: string
  getConfigurationType: () => string
  isConfigurationFromContext: (config: ProducedRunConfiguration, context: RunConfigurationContext) => boolean
  setupConfigurationFromContext: (context: RunConfigurationContext) => ProducedRunConfiguration | null
}

export const runConfigurationProducerRegistry =
  new EPExtensionRegistry<RunConfigurationProducerContribution>(RUN_CONFIGURATION_PRODUCER_EP)

/** 全部生产者（内建 + 第三方）。 */
export function runConfigurationProducers(): RunConfigurationProducerContribution[] {
  return runConfigurationProducerRegistry.all()
}

// ── ②b 生产者抑制器（`com.intellij.runConfigurationProducerSuppressor`） ─────────────────────

/** 被问的生产者（上游 `RunConfigurationProducer<*>` 的可移植面：id + 类型 id）。 */
export interface SuppressedProducerRef {
  id: string
  typeId?: string
}

/** 一条抑制器（上游 `RunConfigurationProducerSuppressor.shouldSuppress(producer, project)`）。 */
export interface RunConfigurationProducerSuppressorContribution {
  id: string
  shouldSuppress: (producer: SuppressedProducerRef, project: { root?: string | null; name?: string | null }) => boolean
}

export const runConfigurationProducerSuppressorRegistry =
  new EPExtensionRegistry<RunConfigurationProducerSuppressorContribution>(RUN_CONFIGURATION_PRODUCER_SUPPRESSOR_EP)

/** 全部抑制器（上游无内建贡献 ⇒ 无插件时为空表）。 */
export function runConfigurationProducerSuppressors(): RunConfigurationProducerSuppressorContribution[] {
  return runConfigurationProducerSuppressorRegistry.all()
}

/** 注册一条生产者抑制器。 */
export function registerRunConfigurationProducerSuppressor(
  suppressor: RunConfigurationProducerSuppressorContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return runConfigurationProducerSuppressorRegistry.register(suppressor, options)
}

/**
 * 这条生产者要不要被忽略（上游 `RunConfigurationProducerService.isIgnored` 的等价物：任一为真即忽略）。
 * 两个**真实消费点**：本文件的 `produceRunConfigurationFromContext`（被抑制的生产者根本不问）
 * 与 `src/runTargets.ts` 的 `discoverRunTargets`（本仓从上下文发现目标的那一层，抑制即不产出候选）。
 */
export function producerSuppressed(
  producer: SuppressedProducerRef, project: { root?: string | null; name?: string | null } = {},
): boolean {
  for (const suppressor of runConfigurationProducerSuppressorRegistry.all()) {
    try {
      if (suppressor.shouldSuppress(producer, project)) return true
    } catch {
      // 容错：与 `isIgnored` 逐条问抑制器时的隔离口径同档。
    }
  }
  return false
}

/**
 * 从上下文生成一条临时配置（上游 `RunConfigurationProducer.createConfigurationFromContext` 的等价物）：
 * 按注册顺序问第一个 `setupConfigurationFromContext` 非空的。
 * 被 `com.intellij.runConfigurationProducerSuppressor` 抑制的生产者**根本不问**
 * （上游 `RunConfigurationProducerService.isIgnored` 在 `getProducers` 那一层过滤）。
 */
export function produceRunConfigurationFromContext(
  context: RunConfigurationContext,
  project: { root?: string | null; name?: string | null } = {},
): ProducedRunConfiguration | null {
  for (const producer of runConfigurationProducerRegistry.all()) {
    if (producerSuppressed({ id: producer.id, typeId: producer.getConfigurationType() }, project)) continue
    try {
      const produced = producer.setupConfigurationFromContext(context)
      if (produced) return produced
    } catch {
      // 一个坏生产者不该吃掉别人的机会（等价于上游 `getProducers` 的容错口径）。
    }
  }
  return null
}

/** 注册一条运行配置生产者。 */
export function registerRunConfigurationProducer(
  producer: RunConfigurationProducerContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return runConfigurationProducerRegistry.register(producer, options)
}

// ── ③ 启动前任务提供者（`com.intellij.stepsBeforeRunProvider`） ──────────────────────────────

/** 一条启动前任务（上游 `BeforeRunTask` 的可移植子集；形状与本仓 `RunConfig.beforeLaunch` 的步骤一致）。 */
export interface BeforeRunTask {
  /** 任务名（上游 `BeforeRunTaskProvider.getDescription(task)` 的等价物）。 */
  name: string
  /** 要跑的命令（本仓 beforeLaunch 链的形状）。 */
  command: string
  /** 该任务的提供者 id（诊断用）。 */
  providerId?: string
}

/**
 * 一条启动前任务提供者（上游 `BeforeRunTaskProvider` 的方法面）。
 * `createTask(config)` 给这条配置造一个任务（返回 null = 这条配置不需要它）；
 * `canExecuteTask(config, task)` 决定这个任务此刻能不能跑（上游 `:71`）。
 * `getId()` 是稳定 id（上游返回 `Key<T>`，本仓给串）。
 */
export interface BeforeRunTaskProviderContribution {
  id: string
  /** `BeforeRunTaskProvider.getId()`（上游 `Key<T>`，本仓串）。 */
  getId: () => string
  /** `BeforeRunTaskProvider.getName()`（设置页/启动前列表里的名字）。 */
  getName: () => string
  createTask: (config: BeforeRunTaskConfig) => BeforeRunTask | null
  canExecuteTask?: (config: BeforeRunTaskConfig, task: BeforeRunTask) => boolean
}

/** 提供给启动前任务提供者的配置面（本仓 `RunConfig` 的可移植子集，宽接口便于单测构造）。 */
export interface BeforeRunTaskConfig {
  name: string
  type?: string
  command: string
  program?: string
  cwd?: string
}

export const beforeRunTaskProviderRegistry =
  new EPExtensionRegistry<BeforeRunTaskProviderContribution>(BEFORE_RUN_TASK_PROVIDER_EP)

/** 全部启动前任务提供者（内建 + 第三方）。 */
export function beforeRunTaskProviders(): BeforeRunTaskProviderContribution[] {
  return beforeRunTaskProviderRegistry.all()
}

/**
 * 这条配置的全部启动前任务（上游 `RunConfigurationBeforeRunProvider` 收集各 provider 的
 * `createTask` 再按 `canExecuteTask` 过滤）。**这是 `src/runActions.ts` 启动链的真实消费点**：
 * 内建「启动前」步骤（如 Gradle 激活任务）与插件任务走同一条路合并进 `beforeLaunch`。
 */
export function beforeRunTasksFor(config: BeforeRunTaskConfig): BeforeRunTask[] {
  const out: BeforeRunTask[] = []
  for (const provider of beforeRunTaskProviderRegistry.all()) {
    try {
      const task = provider.createTask(config)
      if (!task) continue
      if (provider.canExecuteTask && !provider.canExecuteTask(config, task)) continue
      out.push({ ...task, providerId: task.providerId ?? provider.id })
    } catch {
      // 一个坏 provider 不该吃掉别人的任务。
    }
  }
  return out
}

/** 注册一条启动前任务提供者。 */
export function registerBeforeRunTaskProvider(
  provider: BeforeRunTaskProviderContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return beforeRunTaskProviderRegistry.register(provider, options)
}

// ── ④ 控制台折叠（`com.intellij.console.folding`） ────────────────────────────────────────────

/**
 * 一条控制台折叠（上游 `ConsoleFolding` 的方法面）。
 * `shouldFoldLine(root, line)` = 这一行要不要折；`shouldBeAttachedToThePreviousLine()` 决定折痕是否
 * 附在上行行尾（上游 `:36`）；`getPlaceholderText(root, lines)` 给占位符（null = 不折）。
 */
export interface ConsoleFoldingContribution {
  id: string
  shouldFoldLine: (root: string | null, line: string) => boolean
  shouldBeAttachedToThePreviousLine?: () => boolean
  getPlaceholderText?: (root: string | null, lines: readonly string[]) => string | null
}

export const consoleFoldingRegistry = new EPExtensionRegistry<ConsoleFoldingContribution>(CONSOLE_FOLDING_EP)

/** 全部控制台折叠（上游 `ConsoleFolding.EP_NAME.getExtensions()`）。内建为空（平台默认也没有内建贡献，
 *  内建的「按设置里的两个列表折叠」是 `src/consoleFold.ts` 本体，不是 provider 贡献）。 */
export function consoleFoldings(): ConsoleFoldingContribution[] {
  return consoleFoldingRegistry.all()
}

/** 这一行有没有被任何折叠贡献认下（`src/consoleFold.ts` 折叠判定的真实消费点）。 */
export function foldableByConsoleFolding(line: string, root: string | null = null): boolean {
  for (const folding of consoleFoldingRegistry.all()) {
    try { if (folding.shouldFoldLine(root, line)) return true } catch { /* 容错 */ }
  }
  return false
}

/**
 * 把插件 `ConsoleFolding` 认下的行折进**上一行**（上游 `ConsoleFolding.shouldBeAttachedToThePreviousLine`
 * + `getPlaceholderText` 的等价物）：这一行不再单独成行，命中次数记进上一条的 `count`。
 * **真实消费点 `src/runIssues.ts`**（运行控制台的行模型）—— 内建没有 bundled 折叠贡献，所以没有插件时
 * 返回与入参逐字相同的内容（行为零变化）；第三方按 `com.intellij.console.folding` 挂进来即被折。
 */
export function applyConsoleFoldings<T extends { text: string; count?: number }>(
  lines: readonly T[], root: string | null = null,
): T[] {
  if (!consoleFoldings().length) return [...lines]
  const out: T[] = []
  for (const line of lines) {
    if (out.length && foldableByConsoleFolding(line.text, root)) {
      const last = out[out.length - 1]
      last.count = (last.count ?? 1) + 1
      continue
    }
    out.push({ ...line })
  }
  return out
}

/** 注册一条控制台折叠。 */
export function registerConsoleFolding(
  folding: ConsoleFoldingContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return consoleFoldingRegistry.register(folding, options)
}

// ── ⑤ 控制台动作后处理（`com.intellij.consoleActionsPostProcessor`） ──────────────────────────

/** 控制台动作（上游 `AnAction` 的可移植子集：动作 id + 标题 + 执行回调）。
 *  `perform` 对应上游 `AnAction.actionPerformed`：控制台工具条点了这条动作时由平台调它
 *  （消费点 `src/components/RunConsole.vue`）。**默认动作**（本仓内建那几个按钮）不需要它。 */
export interface ConsoleActionLike {
  id: string
  title: string
  /** 上游 `AnAction.actionPerformed(AnActionEvent)`（本仓没有事件对象，无参回调）。 */
  perform?: () => void
}

/** 一条控制台动作后处理（上游 `ConsoleActionsPostProcessor.postProcess` / `postProcessPopupActions`）。 */
export interface ConsoleActionsPostProcessorContribution {
  id: string
  postProcess?: (actions: readonly ConsoleActionLike[]) => readonly ConsoleActionLike[]
  postProcessPopupActions?: (actions: readonly ConsoleActionLike[]) => readonly ConsoleActionLike[]
}

export const consoleActionsPostProcessorRegistry =
  new EPExtensionRegistry<ConsoleActionsPostProcessorContribution>(CONSOLE_ACTIONS_POST_PROCESSOR_EP)

/** 全部后处理器。 */
export function consoleActionsPostProcessors(): ConsoleActionsPostProcessorContribution[] {
  return consoleActionsPostProcessorRegistry.all()
}

/**
 * 把默认控制台动作交给全部后处理器（上游 `AnAction[] postProcess(console, actions)` 的等价物，按注册顺序链式）。
 * 这是「插件往运行控制台加动作」的真实消费点。
 */
export function postProcessConsoleActions(actions: readonly ConsoleActionLike[]): ConsoleActionLike[] {
  let result = [...actions]
  for (const processor of consoleActionsPostProcessorRegistry.all()) {
    if (typeof processor.postProcess !== 'function') continue
    try { result = [...processor.postProcess(result)] } catch { /* 容错 */ }
  }
  return result
}

/** 注册一条控制台动作后处理。 */
export function registerConsoleActionsPostProcessor(
  processor: ConsoleActionsPostProcessorContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return consoleActionsPostProcessorRegistry.register(processor, options)
}

// ── ⑥ 执行器（`com.intellij.executor`） ────────────────────────────────────────────────────
//
// **本族的真身在 `src/executors.ts`**（2026-10-07 executors lane）：那里是完整的
// `Executor` 方法面（`getId`/`getActionName`/`getStartActionText(configurationName)`/`getDescription`/
// `getToolWindowId`/`getContextActionId`/`getHelpId`/`isApplicable`/`isSupportedOnTarget`）+ 注册表类
// `ExecutorRegistry`（`register`/`unregister`/`adoptFromExtensions`/`find`=`getExecutorById`/`all`/`resolve`）
// + 两条内建（上游 `DefaultRunExecutor`/`DefaultDebugExecutor` 以 bundled 贡献登记在同一个 EP 上）。
// 这里只做**再导出** —— 上一批的判据 `tests/execution-extension-points.test.mjs` 从本文件取
// `EXECUTOR_EP`/`executorById`/`executors`/`registerExecutor`，出口名不变，避免多份真源。

export {
  DEBUG_EXECUTOR_ID, RUN_EXECUTOR_ID,
} from './executors.ts'
export type { ExecutorContribution } from './executors.ts'
import {
  executorById as executorByIdImpl, executors as executorsImpl, registerExecutor as registerExecutorImpl,
  registerBundledExecutor as registerBundledExecutorImpl, type ExecutorContribution as ExecutorContributionType,
  type ExecutorLike, type ExecutorProject, type ExecutorSelection,
} from './executors.ts'

/** 全部执行器（内建 Run/Debug + 第三方），见 `src/executors.ts`。 */
export function executors(): ExecutorContributionType[] {
  return executorsImpl()
}

/** 按 id 找执行器（上游 `ExecutorRegistry.getExecutorById`），见 `src/executors.ts`。 */
export function executorById(id: string): ExecutorContributionType | undefined {
  return executorByIdImpl(id)
}

/** 注册一条执行器（内建用 `registerBundledExecutor`，插件默认 user），见 `src/executors.ts`。 */
export function registerExecutor(executor: ExecutorLike, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return registerExecutorImpl(executor, options)
}

/** 注册一条 bundled 执行器（上游两条内建的自登记口径）。 */
export function registerBundledExecutor(executor: ExecutorLike): ExtensionHandle {
  return registerBundledExecutorImpl(executor)
}

export type { ExecutorLike, ExecutorProject, ExecutorSelection }

// ── ⑦ 启动前代理（`com.intellij.runConfigurationBeforeRunProviderDelegate`） ─────────────────

/**
 * 一条启动前代理（上游 `RunConfigurationBeforeRunProviderDelegate.beforeRun(ExecutionEnvironment)`）。
 * 上游在启动前任务**之前**把环境交给代理（`RunConfigurationBeforeRunProvider` 调它）。
 */
export interface RunConfigurationBeforeRunProviderDelegateContribution {
  id: string
  beforeRun: (environment: { configName: string; executorId: string }) => void
}

export const runConfigurationBeforeRunDelegateRegistry =
  new EPExtensionRegistry<RunConfigurationBeforeRunProviderDelegateContribution>(RUN_CONFIGURATION_BEFORE_RUN_PROVIDER_DELEGATE_EP)

/** 全部启动前代理。 */
export function runConfigurationBeforeRunDelegates(): RunConfigurationBeforeRunProviderDelegateContribution[] {
  return runConfigurationBeforeRunDelegateRegistry.all()
}

/** 把环境交给全部代理（上游 `RunConfigurationBeforeRunProvider` 的调用点；本仓在启动前链之前）。 */
export function notifyBeforeRunDelegates(environment: { configName: string; executorId: string }): void {
  for (const delegate of runConfigurationBeforeRunDelegateRegistry.all()) {
    try { delegate.beforeRun(environment) } catch { /* 容错 */ }
  }
}

/** 注册一条启动前代理。 */
export function registerRunConfigurationBeforeRunDelegate(
  delegate: RunConfigurationBeforeRunProviderDelegateContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return runConfigurationBeforeRunDelegateRegistry.register(delegate, options)
}

// ── bundled：把本仓在跑的类型/执行器登记进来（消费侧调用，重复调用只覆盖同 id） ──────────────

/** 注册一条类型为 bundled 的运行配置类型（内建的五种在各自消费侧登记，见 `exec/run-configs`）。 */
export function registerBundledConfigurationType(type: ConfigurationTypeContribution): ExtensionHandle {
  return registerConfigurationType(type, { source: 'bundled' })
}

/** 注册一条 bundled 启动前任务提供者（内建 Gradle 激活任务在 `src/runActions.ts` 登记）。 */
export function registerBundledBeforeRunTaskProvider(provider: BeforeRunTaskProviderContribution): ExtensionHandle {
  return registerBeforeRunTaskProvider(provider, { source: 'bundled' })
}
