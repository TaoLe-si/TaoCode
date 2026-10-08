// **运行目标那一族的扩展点宿主接线** —— 把「目标环境类型 / 语言运行时类型 / 目标提供者 /
// 目标环境请求调节器工厂」这四条上游本来就是 EP 的接口，按 `src/extensionPoints.ts` 的
// `EXTENSIONS` 宿主登记出来，并给出与上游**同名的方法面**。
//
// 上游依据（qualifiedName 逐字取自各 plugin.xml 的 `<extensionPoint>` 声明；接口面逐条开文件核过）：
//   · `com.intellij.executionTargetType` —— `platform/execution/resources/intellij.platform.execution.xml:36-37`
//     （`interface="com.intellij.execution.target.TargetEnvironmentType" dynamic="true"`）；
//     接口 `platform/execution/src/com/intellij/execution/target/TargetEnvironmentType.kt:22`
//     （`abstract class TargetEnvironmentType<C>(id)`，`ContributedTypeBase` 给出 `getId()`/`getDisplayName()`），
//     `EXTENSION_NAME` 在 `:71`（`ExtensionPointName.create("com.intellij.executionTargetType")`）。
//     方法面：`isLocalTarget()`（`:27`）、`isSystemCompatible()`（`:32`）、`providesNewWizard(project, runtimeType)`（`:37`）、
//     `createEnvironmentRequest(project, config)`（`:52`）、`createConfigurable(...)`（`:54-57`）。
//     上游内建贡献：`platform/execution-impl/resources/intellij.platform.execution.impl.xml:137`
//     （`EelTargetType`，远程服务器目标）与 `platform/wsl-impl/resources/intellij.platform.wsl.impl.xml:30`
//     （`WslTargetType`，仅 Windows）。
//   · `com.intellij.executionTargetLanguageRuntimeType` —— 同文件 `:38-39`
//     （`interface="com.intellij.execution.target.LanguageRuntimeType"`）；接口
//     `platform/execution/src/com/intellij/execution/target/LanguageRuntimeType.kt:32`，
//     `EXTENSION_NAME` 在 `:77`。方法面：`isApplicableTo(runConfig)`（`:34`）、
//     `configurableDescription`（`:39`）、`launchDescription`（`:44`）、`createIntrospector(config)`（`:50`）、
//     `findLanguageRuntime(target)`（`:76`）。上游内建贡献：
//     `platform/execution-impl/backend/resources/intellij.platform.execution.impl.backend.xml:19`
//     （`JavaLanguageRuntimeType`，`TYPE_ID = "JavaLanguageRuntime"`，见
//     `platform/execution/src/com/intellij/execution/target/java/JavaLanguageRuntimeType.kt:122-123`）与
//     Gradle/Maven/Python 插件各一条。
//   · `com.intellij.executionTargetProvider` —— `platform/lang-api/resources/intellij.platform.lang.xml:141`
//     （`interface="com.intellij.execution.ExecutionTargetProvider" dynamic="true"`）；接口
//     `platform/lang-api/src/com/intellij/execution/ExecutionTargetProvider.java:14-19`
//     （`getTargets(project, configuration)`，`EXTENSION_NAME` 在 `:15-16`）。上游内建贡献：
//     `platform/execution-impl/resources/intellij.platform.execution.impl.xml:111`
//     （`DefaultExecutionTargetProvider`，返回单一本机目标 `DefaultExecutionTarget.INSTANCE`，
//     见 `platform/execution-impl/src/com/intellij/execution/DefaultExecutionTargetProvider.java:13-18`）。
//   · `com.intellij.runConfigurationTargetEnvironmentAdjusterFactory` —— `platform/execution/resources/intellij.platform.execution.xml:35`
//     （`interface="com.intellij.execution.target.RunConfigurationTargetEnvironmentAdjuster$Factory"`）；
//     接口 `platform/execution/src/com/intellij/execution/target/RunConfigurationTargetEnvironmentAdjuster.kt:35-45`
//     （内部 `interface Factory { isEnabledFor(sdk): Boolean; createAdjuster(sdk): RunConfigurationTargetEnvironmentAdjuster }`），
//     调节器本体 `:21-33`（`adjust(targetEnvironmentRequest, runConfiguration)` /
//     `providesAdditionalRunConfigurationUI()` / `createAdditionalRunConfigurationUI(...)`）。
//     上游平台内没有内建工厂（各语言插件按 SDK 类型贡献）。
//
// **本仓的落地口径（如实差异）**：
//   ① 上游这些接口都站在「远程目标环境」上：`createEnvironmentRequest` 产出要在目标机上建环境的请求、
//      `createConfigurable` 是 Swing 设置页、`createIntrospector` 要在目标机上执行脚本探测运行时。
//      本仓宿主只做本机 CreateProcess（见 `exec/wsl` 判 `[-]`），所以可移植的是**类型注册与选择语义**：
//      id / 显示名 / 是不是本机目标 / 系统兼容性 / 能否为该类型列出目标 / 语言运行时的可执行文件解析归属。
//      `createConfigurable`（Swing）与远程探测**不假装有**，判词里如实写。
//   ② 上游 `getTargets(project, runConfiguration)` 收 PSI 对象；本仓收 `ExecutionTargetProject`
//      （工作区根/名字）与 `ExecutionTargetProfile`（配置名/类型/程序），消费点 `src/executionTargets.ts`。
//   ③ 内建贡献照上游位置登记：本机目标类型（上游平台侧对应 `EelTargetType` 那一格 —— 本仓的平台目标是
//      本机 `LocalTarget`，id 取 `src/targetEnvironments.ts:28` 的 `LOCAL_TARGET_TYPE_ID`）、
//      Java 语言运行时类型（id 逐字 `JavaLanguageRuntime`）、默认目标提供者（上游 `DefaultExecutionTargetProvider`）。
//      **内建贡献不改变无插件时的目标列表**：本机类型 `isLocalTarget()` 为真 ⇒ 不新增目标；默认提供者给的
//      本机目标与内建那条同 id ⇒ 目标表按 id 去重后消失；Java 运行时类型的可执行文件解析与
//      `runtimeExecutable` 逐字同结果。
//
// 纯数据层：只 import `src/extensionPoints.ts`、`src/executionExtensionPoints.ts`（EP 宿主）与几个类型，
// 不 import vue/DOM/bridge ⇒ `node --test` 直测。
//
// 判据：`tests/execution-target-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'
import { EPExtensionRegistry } from './executionExtensionPoints.ts'
import { JAVA_RUNTIME_ID, runtimeExecutable, type LanguageRuntimeEntry } from './languageRuntimes.ts'
import { LOCAL_TARGET_TYPE_ID, LOCAL_TARGET_TYPE_NAME } from './targetEnvironments.ts'
import { currentTargetPlatform } from './targetPlatform.ts'
import type { TargetEnvironment } from './targetEnvironments.ts'
import type { TargetPlatform } from './targetPlatform.ts'
import type { ExecutionTarget } from './executionTargets.ts'

/** 四条 EP 的 id（逐字取自上游，见文件头）。 */
export const EXECUTION_TARGET_TYPE_EP = 'com.intellij.executionTargetType'
export const EXECUTION_TARGET_LANGUAGE_RUNTIME_TYPE_EP = 'com.intellij.executionTargetLanguageRuntimeType'
export const EXECUTION_TARGET_PROVIDER_EP = 'com.intellij.executionTargetProvider'
export const RUN_CONFIGURATION_TARGET_ENVIRONMENT_ADJUSTER_FACTORY_EP = 'com.intellij.runConfigurationTargetEnvironmentAdjusterFactory'

/** 声明四条 EP（幂等：重复调用只覆盖同名声明）。 */
export function declareExecutionTargetExtensionPoints(): void {
  for (const [id, name] of [
    [EXECUTION_TARGET_TYPE_EP, '目标环境类型'],
    [EXECUTION_TARGET_LANGUAGE_RUNTIME_TYPE_EP, '语言运行时类型'],
    [EXECUTION_TARGET_PROVIDER_EP, '执行目标提供者'],
    [RUN_CONFIGURATION_TARGET_ENVIRONMENT_ADJUSTER_FACTORY_EP, '目标环境请求调节器工厂'],
  ] as const) {
    EXTENSIONS.declareExtensionPoint({ id, name, scope: APPLICATION_SCOPE, dynamic: true })
  }
}

declareExecutionTargetExtensionPoints()

/** 目标提供者/类型看到的工作区面（上游 `Project` 的可移植子集：消费点只读这两格）。 */
export interface ExecutionTargetProject {
  root?: string | null
  name?: string | null
}

/** 目标提供者看到的配置面（上游 `RunConfiguration` 的可移植子集）。 */
export interface ExecutionTargetProfile {
  name: string
  type?: string
  program?: string
  command?: string
}

/** 一个目标环境请求（上游 `TargetEnvironmentRequest` 的可移植子集：本仓的「一个可运行目标」描述）。 */
export interface TargetEnvironmentRequestLike {
  id: string
  /** 列表里的显示名。 */
  displayName: string
  /** 副标题/描述（上游 `TargetEnvironmentConfiguration.getProjectRootOnTarget()` 那一格在本仓的等价物）。 */
  description?: string
  /** 该目标挂的语言运行时类型 id（`LanguageRuntimeType` 的 id）。 */
  runtimeTypeId?: string
  /** 运行时主路径（`LanguageRuntimeConfiguration.homePath` 的可移植面）。 */
  homePath?: string
  platform?: TargetPlatform
}

// ── ① 目标环境类型（`com.intellij.executionTargetType`） ──────────────────────────────────────

/**
 * 一条目标环境类型（上游 `TargetEnvironmentType` 的方法面，名字与上游逐字相同）。
 * `isLocalTarget()` 为真的类型**不新增目标**（上游语义：该类型的配置直接在本机跑，
 * `TargetEnvironmentAwareRunProfile.java:100` 就是拿它判「无目标」）。
 */
export interface TargetEnvironmentTypeContribution {
  /** `ContributedTypeBase.getId()`。 */
  id: string
  /** `ContributedTypeBase.getDisplayName()`。 */
  getDisplayName: () => string
  /** `TargetEnvironmentType.isLocalTarget()`（`:27`，默认 false）。 */
  isLocalTarget?: () => boolean
  /** `TargetEnvironmentType.isSystemCompatible()`（`:32`，默认 true）。 */
  isSystemCompatible?: () => boolean
  /** `@HideFromRunOn` 的等价物：隐藏「运行目标」列表里的这一档（`HideFromRunOn.kt:9-13`）。 */
  hideFromRunOn?: boolean
  /** `TargetEnvironmentType.createEnvironmentRequest(project, config)`（`:52`）本仓取 `project` 一格。 */
  createEnvironmentRequest?: (project: ExecutionTargetProject) => TargetEnvironmentRequestLike | null
}

export const targetEnvironmentTypeRegistry =
  new EPExtensionRegistry<TargetEnvironmentTypeContribution>(EXECUTION_TARGET_TYPE_EP)

/** 全部目标环境类型（内建 + 第三方）。 */
export function targetEnvironmentTypes(): TargetEnvironmentTypeContribution[] {
  return targetEnvironmentTypeRegistry.all()
}

/** 按 id 找目标环境类型（上游 `getTargetTypesForRunConfigurations` 的定向查找面）。 */
export function targetEnvironmentTypeById(id: string): TargetEnvironmentTypeContribution | undefined {
  return targetEnvironmentTypeRegistry.find(id)
}

/** 注册一条目标环境类型（内建用 `{ source: 'bundled' }`，插件默认 user）。 */
export function registerTargetEnvironmentType(
  type: TargetEnvironmentTypeContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return targetEnvironmentTypeRegistry.register(type, options)
}

/** 注册一条 bundled 目标环境类型。 */
export function registerBundledTargetEnvironmentType(type: TargetEnvironmentTypeContribution): ExtensionHandle {
  return registerTargetEnvironmentType(type, { source: 'bundled' })
}

/** 这个类型 id 在注册表里吗（`src/executionTargets.ts` 的自定义目标过滤器用它 —— 消费点）。 */
export function isKnownTargetTypeId(id: string): boolean {
  return !!id && (id === LOCAL_TARGET_TYPE_ID || !!targetEnvironmentTypeById(id))
}

/** 这个类型在「运行目标」列表里的显示名（认不出给 id 本身，不编名字）。 */
export function targetTypeDisplayName(id: string): string {
  if (id === LOCAL_TARGET_TYPE_ID) return LOCAL_TARGET_TYPE_NAME
  return targetEnvironmentTypeById(id)?.getDisplayName() ?? id
}

/**
 * 注册表里那些**非本机**类型列出的目标（上游 `RunOnTargetPanel` 的那一列由各类型自报）。
 * 三条过滤照上游：`hideFromRunOn`（`HideFromRunOn.kt`）、`isSystemCompatible()` 为假、
 * `isLocalTarget()` 为真（后两类不列，见接口注释）。返回顺序 = LoadingOrder。
 */
export function executionTargetsFromRegisteredTypes(project: ExecutionTargetProject): ExecutionTarget[] {
  const out: ExecutionTarget[] = []
  for (const type of targetEnvironmentTypeRegistry.all()) {
    if (type.hideFromRunOn) continue
    try {
      if (type.isLocalTarget?.()) continue
      if (type.isSystemCompatible && type.isSystemCompatible() === false) continue
      const request = type.createEnvironmentRequest?.(project)
      if (!request?.id) continue
      out.push({
        id: request.id, name: request.displayName, kind: 'custom',
        description: request.description ?? type.getDisplayName(),
        javaExecutable: request.runtimeTypeId === JAVA_RUNTIME_ID && request.homePath
          ? runtimeExecutable({ typeId: JAVA_RUNTIME_ID, homePath: request.homePath }, request.platform ?? currentTargetPlatform())
          : undefined,
        runtime: request.runtimeTypeId && request.homePath
          ? { typeId: request.runtimeTypeId, homePath: request.homePath }
          : undefined,
        platform: request.platform,
      })
    } catch {
      // 一个坏类型不该吃掉整张目标列表（等价于上游 `getTargetTypesForRunConfigurations` 的容错口径）。
    }
  }
  return out
}

// ── ② 语言运行时类型（`com.intellij.executionTargetLanguageRuntimeType`） ─────────────────────

/**
 * 一条语言运行时类型（上游 `LanguageRuntimeType` 的方法面）。
 * 上游 `createIntrospector` 要在目标机上跑脚本探测；本仓没有目标机，可移植的是
 * 「哪一类运行时由这个类型负责、它的可执行文件怎么解析、启动文案是什么」。
 */
export interface LanguageRuntimeTypeContribution {
  /** `ContributedTypeBase.getId()`（本仓的运行时 id：`src/languageRuntimes.ts` 的 `JAVA_RUNTIME_ID` 一族）。 */
  id: string
  /** `LanguageRuntimeType.isApplicableTo(runConfig)`（`:34`）。 */
  isApplicableTo: (profile: ExecutionTargetProfile) => boolean
  /** `LanguageRuntimeType.configurableDescription`（`:39`）。 */
  getConfigurableDescription: () => string
  /** `LanguageRuntimeType.launchDescription`（`:44`）。 */
  getLaunchDescription: () => string
  /** `LanguageRuntimeType.findLanguageRuntime(target)`（`:76`）：从目标环境里取本语言的运行时数据。 */
  findLanguageRuntime?: (environment: TargetEnvironment) => LanguageRuntimeEntry | null
  /**
   * `createIntrospector` 那一格在本仓的等价物：**本机**解析该运行时的可执行文件
   * （上游把这件事交给目标端执行脚本，本仓按 `src/targetPlatform.ts` 的分隔符拼）。
   * 返回空串 = 这个类型认不出该运行时（调用方回落到 `runtimeExecutable`）。
   */
  getExecutable?: (entry: LanguageRuntimeEntry, platform: TargetPlatform) => string
}

export const languageRuntimeTypeRegistry =
  new EPExtensionRegistry<LanguageRuntimeTypeContribution>(EXECUTION_TARGET_LANGUAGE_RUNTIME_TYPE_EP)

/** 全部语言运行时类型（内建 + 第三方）。 */
export function executionLanguageRuntimeTypes(): LanguageRuntimeTypeContribution[] {
  return languageRuntimeTypeRegistry.all()
}

/** 按 id 找语言运行时类型。 */
export function languageRuntimeTypeById(id: string): LanguageRuntimeTypeContribution | undefined {
  return languageRuntimeTypeRegistry.find(id)
}

/** 注册一条语言运行时类型。 */
export function registerLanguageRuntimeType(
  type: LanguageRuntimeTypeContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return languageRuntimeTypeRegistry.register(type, options)
}

/** 注册一条 bundled 语言运行时类型。 */
export function registerBundledLanguageRuntimeType(type: LanguageRuntimeTypeContribution): ExtensionHandle {
  return registerLanguageRuntimeType(type, { source: 'bundled' })
}

/**
 * 这个运行时的可执行文件由哪个类型负责解析（`src/executionTargets.ts` 的真实消费点）。
 * 认领的类型给出非空结果就用它；否则 `undefined` ⇒ 调用方走 `runtimeExecutable` 的本机口径。
 */
export function executableViaLanguageRuntimeType(
  entry: LanguageRuntimeEntry, platform: TargetPlatform,
): string | undefined {
  const owner = languageRuntimeTypeById(entry.typeId)
  if (!owner?.getExecutable) return undefined
  try {
    const executable = owner.getExecutable(entry, platform)
    return executable?.trim() ? executable : undefined
  } catch {
    return undefined
  }
}

// ── ③ 执行目标提供者（`com.intellij.executionTargetProvider`） ─────────────────────────────────

/** 一条目标提供者（上游 `ExecutionTargetProvider.getTargets(project, configuration)`）。 */
export interface ExecutionTargetProviderContribution {
  id: string
  getTargets: (project: ExecutionTargetProject, profile: ExecutionTargetProfile) => readonly ExecutionTarget[]
}

export const executionTargetProviderRegistry =
  new EPExtensionRegistry<ExecutionTargetProviderContribution>(EXECUTION_TARGET_PROVIDER_EP)

/** 全部目标提供者（内建默认提供者 + 第三方）。 */
export function executionTargetProviders(): ExecutionTargetProviderContribution[] {
  return executionTargetProviderRegistry.all()
}

/** 注册一条目标提供者。 */
export function registerExecutionTargetProvider(
  provider: ExecutionTargetProviderContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return executionTargetProviderRegistry.register(provider, options)
}

/** 注册一条 bundled 目标提供者（上游 `DefaultExecutionTargetProvider` 的自登记口径）。 */
export function registerBundledExecutionTargetProvider(provider: ExecutionTargetProviderContribution): ExtensionHandle {
  return registerExecutionTargetProvider(provider, { source: 'bundled' })
}

/** 问所有提供者要目标（上游 `ExecutionTargetManager.getTargets` 的收集步；一个坏提供者不打断全表）。 */
export function executionTargetsFromProviders(
  project: ExecutionTargetProject, profile: ExecutionTargetProfile,
): ExecutionTarget[] {
  const out: ExecutionTarget[] = []
  for (const provider of executionTargetProviderRegistry.all()) {
    try {
      for (const target of provider.getTargets(project, profile)) if (target?.id) out.push(target)
    } catch {
      // 容错：与 `ExecutionTargetManager` 的 `runInReadActionWithWriteActionPriority` 外层的兜底同档。
    }
  }
  return out
}

// ── ④ 目标环境请求调节器工厂（`com.intellij.runConfigurationTargetEnvironmentAdjusterFactory`） ──

/**
 * 一条调节器工厂（上游 `RunConfigurationTargetEnvironmentAdjuster.Factory`）。
 * 上游按 SDK 认领；本仓没有 SDK 对象，按**运行时类型 id + 主路径**认领（`RuntimeRef`）。
 */
export interface TargetEnvironmentAdjusterFactoryContribution {
  id: string
  /** `Factory.isEnabledFor(sdk)`（`:39`）。 */
  isEnabledFor: (runtime: { typeId: string; homePath: string }) => boolean
  /** `Factory.createAdjuster(sdk)`（`:41`）。 */
  createAdjuster: (runtime: { typeId: string; homePath: string }) => TargetEnvironmentAdjusterContribution
}

/** 调节器本体（上游 `RunConfigurationTargetEnvironmentAdjuster.adjust(request, runConfiguration)`）。 */
export interface TargetEnvironmentAdjusterContribution {
  adjust: (
    template: { program?: string; command?: string },
    target: { id: string; name: string; runtimeTypeId?: string; homePath?: string },
  ) => { program?: string; command?: string } | null
}

export const targetEnvironmentAdjusterFactoryRegistry =
  new EPExtensionRegistry<TargetEnvironmentAdjusterFactoryContribution>(RUN_CONFIGURATION_TARGET_ENVIRONMENT_ADJUSTER_FACTORY_EP)

/** 全部调节器工厂（上游平台内没有内建工厂 ⇒ 无插件时为空表）。 */
export function targetEnvironmentAdjusterFactories(): TargetEnvironmentAdjusterFactoryContribution[] {
  return targetEnvironmentAdjusterFactoryRegistry.all()
}

/** 注册一条调节器工厂。 */
export function registerTargetEnvironmentAdjusterFactory(
  factory: TargetEnvironmentAdjusterFactoryContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return targetEnvironmentAdjusterFactoryRegistry.register(factory, options)
}

/**
 * 让调节器工厂先改这次「运行目标 → 配置初值」的折算（上游 `findTargetEnvironmentRequestAdjuster`
 * 之后调 `adjust`）。返回 `null` = 没有工厂认领（调用方走内建的运行时归属判定）。
 */
export function adjustViaTargetEnvironmentFactories(
  template: { program?: string; command?: string },
  target: { id: string; name: string; runtimeTypeId?: string; homePath?: string },
): { program?: string; command?: string } | null {
  const runtime = { typeId: target.runtimeTypeId ?? '', homePath: target.homePath ?? '' }
  if (!runtime.typeId) return null
  for (const factory of targetEnvironmentAdjusterFactoryRegistry.all()) {
    try {
      if (factory.isEnabledFor(runtime) !== true) continue
      const adjusted = factory.createAdjuster(runtime).adjust(template, target)
      if (adjusted) return adjusted
    } catch {
      // 容错：一个坏工厂不该让「运行目标」这一格折算不出来。
    }
  }
  return null
}

// ── bundled：本仓平台侧那几条（消费侧不改行为，见文件头差异 ③） ─────────────────────────────

/** 本机目标类型（上游平台侧对应 `EelTargetType` 那一格；本仓的平台目标是本机目标）。 */
export const BUILTIN_LOCAL_TARGET_TYPE: TargetEnvironmentTypeContribution = {
  id: LOCAL_TARGET_TYPE_ID,
  getDisplayName: () => LOCAL_TARGET_TYPE_NAME,
  // `TargetEnvironmentType.kt:27`：本机目标 ⇒ 不新增目标项（`TargetEnvironmentAwareRunProfile.java:100` 的判据）。
  isLocalTarget: () => true,
  isSystemCompatible: () => true,
}

/** Java 语言运行时类型（上游 `JavaLanguageRuntimeType`，`TYPE_ID = "JavaLanguageRuntime"`）。 */
export const BUILTIN_JAVA_LANGUAGE_RUNTIME_TYPE: LanguageRuntimeTypeContribution = {
  id: JAVA_RUNTIME_ID,
  // 上游 `JavaLanguageRuntimeType.kt:40` 恒真；本仓按「配置是不是 Java 形态」判（application/jar 两类）。
  isApplicableTo: profile => profile.type === 'application' || profile.type === 'jar',
  getConfigurableDescription: () => 'Java 配置',
  getLaunchDescription: () => '运行 Java 应用程序',
  // 上游 `JavaLanguageRuntimeType.kt:54-56` 从目标环境的运行时表里取本语言的数据。
  findLanguageRuntime: environment =>
    environment.runtimes.find(runtime => runtime.typeId === JAVA_RUNTIME_ID) ?? null,
  // 上游把可执行文件解析交给目标端脚本；本仓按平台拼（`src/languageRuntimes.ts` 的同一函数）。
  getExecutable: (entry, platform) => runtimeExecutable(entry, platform),
}

/** 默认目标提供者（上游 `DefaultExecutionTargetProvider`：单一本机目标）。 */
export const BUILTIN_DEFAULT_TARGET_PROVIDER: ExecutionTargetProviderContribution = {
  id: 'DefaultExecutionTargetProvider',
  getTargets: () => [{ id: 'local', name: '本地机器', kind: 'local', description: '在本机运行（默认目标）' }],
}

/** 把三条内建贡献挂上 EP（幂等：同 id 覆盖；`source` 标 bundled）。 */
export function registerBundledExecutionTargets(): void {
  registerBundledTargetEnvironmentType(BUILTIN_LOCAL_TARGET_TYPE)
  registerBundledLanguageRuntimeType(BUILTIN_JAVA_LANGUAGE_RUNTIME_TYPE)
  registerBundledExecutionTargetProvider(BUILTIN_DEFAULT_TARGET_PROVIDER)
}

registerBundledExecutionTargets()
