// **外部系统一族的扩展点宿主**（上游 `com.intellij.openapi.externalSystem.*` 的第三方注册面在本仓的等价物）。
//
// 上游是什么：外部系统工程模型与自动导入是一整套「插件按 id 挂贡献」的结构，声明集中在
// `platform/external-system-impl/resources/META-INF/ExternalSystemExtensionPoints.xml`。本文件把
// 其中**本仓有对等物**的五条逐字登记，并给出 bundled 贡献与真实消费点：
//   · `com.intellij.externalSystemManager`（xml:3，`interface=ExternalSystemManager`，dynamic）——
//     每套构建系统一条管理器，`GradleManager` 是 bundled 例子（`plugins/gradle/plugin-resources/
//     intellij.gradle.xml`）。方法面见 `ExternalSystemManager.java:37-130`（`getSystemId`/
//     `getSettingsProvider`/`getLocalSettingsProvider`/`getExecutionSettingsProvider`/
//     `getProjectResolverClass`/`getTaskManagerClass`/`getExternalProjectDescriptor`/
//     `getSearchScope`/`getExtensionPointsForResolver`）。
//   · `com.intellij.externalSystemTaskNotificationListener`（xml:49，`interface=
//     ...model.task.ExternalSystemTaskNotificationListener`，dynamic）—— 任务生命周期监听
//     （`ExternalSystemTaskNotificationListener.java:14-156`：`onStart`/`onSuccess`/`onFailure`/
//     `onCancel`/`onEnd`/`onEnvironmentPrepared`/`onStatusChange`/`onTaskOutput`/`beforeCancel`）。
//     上游 bundled 贡献在 Kotlin/Gradle 插件里（`intellij.kotlin.projectConfiguration.xml` 等）。
//   · `com.intellij.externalSystemUnlinkedProjectAware`（xml:75，`interface=
//     ...autolink.ExternalSystemUnlinkedProjectAware`，dynamic）—— 未链接工程提示的按系统实现
//     （`ExternalSystemUnlinkedProjectAware.kt:14-46`：`systemId`/`buildFileExtensions`/
//     `isBuildFile`/`isLinkedProject`/`linkAndLoadProject`/`unlinkProject`/`subscribe`）。
//     上游 bundled：Gradle（`GradleUnlinkedProjectAware`）、Maven（`MavenUnlinkedProjectAware`）、
//     Ant（`AntUnlinkedProjectAware`）。
//   · `com.intellij.externalSystemCrcCalculator`（xml:82，`interface=...util.ExternalSystemCrcCalculator`，
//     dynamic）—— 按构建系统自定义设置文件 CRC 的注册面（`ExternalSystemCrcCalculator.kt:15-40`：
//     `isApplicable(systemId, file)` / `calculateCrc(project, file, fileText)`）。
//   · `com.intellij.openapi.externalSystem.autoimport.autoReloadTypeProviderExtension`
//     （xml:96，`interface=...autoimport.DefaultAutoReloadTypeProvider`，dynamic）—— 自动重载默认档的
//     提供方（`DefaultAutoReloadTypeProvider.kt:14-15` 的 `getAutoReloadType()`）。
//
// 本仓此前：这一族的行为都落在盘上（`src/externalSystemModel.ts` 的 `ProjectSystemId`/`ProjectKeys`、
// `src/externalSystemAutoImport.ts` 的 tracker 与未链接工程登记、`src/externalSystemSettingsCrc.ts` 的
// 内容 CRC、`src/gradle.ts` 的 `AutoReloadType` 三档），**但第三方没有注册面** —— 插件按上游 id 挂一条
// manager / listener / aware / calculator / provider 时无处可挂，那些能力只被本仓自己与判据引用。
// 本文件把五条 EP 声明出来，并给出**真实消费点**：
//   · `externalSystemManagers()` / `externalSystemManagerFor(systemId)` —— 第三张表（诊断目录）；
//   · `taskNotificationListeners()` —— `src/externalSystemAutoImport.ts` 的 tracker 在重载
//     开始/成功/失败/取消时逐个广播（`onStart`/`onSuccess`/`onFailure`/`onCancel`）；
//   · `unlinkedProjectAwares()` —— `createUnlinkedProjectRegistry(...)` 的初始登记表（
//     `ExternalSystemUnlinkedProjectAware.getInstance(systemId)` 的等价查找面）；
//   · `settingsFileCrcCalculators()` / `settingsFileCrcCalculatorFor(systemId, path)` ——
//     `src/externalSystemSettingsCrc.ts` 的 `calculateSettingsFilesCrc` 命中时改用它算 CRC；
//   · `defaultAutoReloadTypeFor(systemId)` —— `src/gradleHost.ts` 在**没有落盘设置**时用它取默认档
//     （`defaultBuildToolsFor(systemId)` 把它拼进 `BuildToolsSettings`），与上游
//     「无 provider ⇒ SELECTIVE」同口径（`AutoImportProjectTrackerSettings.kt:16-26`）。
//
// 与上游的如实差异：① 本仓单进程，`Project`/`VirtualFile`/`Class` 这类参数换成可移植形状
// （路径字符串、`ProjectSystemId`、内容文本）；② `isApplicable(systemId, file)` 的 `file` 用路径；
// ③ `linkAndLoadProjectAsync` 的协程语义在本仓是同步调用（宿主自己决定去抖）。
//
// 纯数据层：不 import vue/DOM/bridge，便于单测。
//
// 判据：`tests/external-system-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'
import { GRADLE_SYSTEM, MAVEN_SYSTEM, projectSystemId, type ProjectSystemId } from './externalSystemModel.ts'
import { AUTO_RELOAD_DEFAULT, DEFAULT_BUILD_TOOLS, type AutoReloadType, type BuildToolsSettings } from './gradle.ts'

/* ── EP id（逐字取自上游 ExternalSystemExtensionPoints.xml） ─────────────────────────────── */

export const EXTERNAL_SYSTEM_MANAGER_EP = 'com.intellij.externalSystemManager'
export const EXTERNAL_SYSTEM_TASK_NOTIFICATION_LISTENER_EP = 'com.intellij.externalSystemTaskNotificationListener'
export const EXTERNAL_SYSTEM_UNLINKED_PROJECT_AWARE_EP = 'com.intellij.externalSystemUnlinkedProjectAware'
export const EXTERNAL_SYSTEM_CRC_CALCULATOR_EP = 'com.intellij.externalSystemCrcCalculator'
export const AUTO_RELOAD_TYPE_PROVIDER_EP = 'com.intellij.openapi.externalSystem.autoimport.autoReloadTypeProviderExtension'

/** 上游声明这五条 EP 的文件（相对参考树），供判据逐字比对。 */
export const EXTERNAL_SYSTEM_EP_SOURCE = 'platform/external-system-impl/resources/META-INF/ExternalSystemExtensionPoints.xml'

/* ── 贡献形状（上游接口的可移植子集） ────────────────────────────────────────────────────── */

/** `ExternalSystemManager` 的可移植子集（`ExternalSystemManager.java:37-130`）。 */
export interface ExternalSystemManager {
  /** 贡献 id（DSL 里那条 `<externalSystemManager>` 的实现类名在本仓换成 id）。 */
  id: string
  systemId: ProjectSystemId
  /** `getProjectResolverClass()`（`:84`）—— 本仓是宿主分派名，不是 Java 类。 */
  getProjectResolverClass?: () => string
  /** `getTaskManagerClass()`（`:89`，缺省 `NoOp`）。 */
  getTaskManagerClass?: () => string
  /** `getExternalProjectDescriptor()`（`:98`）—— 本仓是文件选择器的扩展名/描述子。 */
  getExternalProjectDescriptor?: () => readonly string[]
  /** `getExtensionPointsForResolver()`（`:124`）—— 反序列化外部工程数据时要查的 EP id。 */
  getExtensionPointsForResolver?: () => readonly string[]
  /** `getSettingsProvider()`（`:60`）—— 这套系统的工程设置（本仓按可寻址键给）。 */
  getSettingsProvider?: () => readonly string[]
  /** `getLocalSettingsProvider()`（`:67`）。 */
  getLocalSettingsProvider?: () => readonly string[]
  /** `getExecutionSettingsProvider()`（`:72`）—— 按链接路径给执行设置键。 */
  getExecutionSettingsProvider?: (externalProjectPath: string) => readonly string[]
}

/** `ExternalSystemTaskNotificationListener` 的可移植子集（`:14-156`）。 */
export interface ExternalSystemTaskNotificationListener {
  id: string
  onStart?: (task: ExternalSystemTaskRef, workingDir: string) => void
  onEnvironmentPrepared?: (task: ExternalSystemTaskRef) => void
  onStatusChange?: (task: ExternalSystemTaskRef, status: string) => void
  onTaskOutput?: (task: ExternalSystemTaskRef, text: string, stdOut: boolean) => void
  onSuccess?: (task: ExternalSystemTaskRef) => void
  onFailure?: (task: ExternalSystemTaskRef, message: string) => void
  beforeCancel?: (task: ExternalSystemTaskRef) => void
  onCancel?: (task: ExternalSystemTaskRef) => void
  onEnd?: (task: ExternalSystemTaskRef) => void
}

/** 一条外部系统任务的可移植引用（上游 `ExternalSystemTaskId` 的等价物）。 */
export interface ExternalSystemTaskRef {
  systemId: string
  /** 链接工程路径（归一化前）。 */
  externalProjectPath: string
  /** 任务显示名（`ExternalSystemTaskId.getUserData` 的一档）。 */
  description?: string
}

/** `ExternalSystemUnlinkedProjectAware` 的可移植子集（`ExternalSystemUnlinkedProjectAware.kt:14-46`）。 */
export interface ExternalSystemUnlinkedProjectAware {
  id: string
  /** `systemId`（`:21`）。 */
  systemId: string
  buildFileExtensions?: () => readonly string[]
  isBuildFile?: (buildFile: string) => boolean
  isLinkedProject?: (externalProjectPath: string) => boolean
  linkAndLoadProject?: (externalProjectPath: string) => void
  unlinkProject?: (externalProjectPath: string) => void
  subscribe?: (listener: unknown) => void
}

/** `ExternalSystemCrcCalculator` 的可移植子集（`ExternalSystemCrcCalculator.kt:15-40`）。 */
export interface ExternalSystemCrcCalculator {
  id: string
  /** `isApplicable(systemId, file)`（`:22`）—— 本仓 `file` 是路径。 */
  isApplicable: (systemId: string, file: string) => boolean
  /** `calculateCrc(project, file, fileText)`（`:30`）—— 返回 null 表示交给默认 CRC。 */
  calculateCrc: (input: { systemId: string; file: string; text: string }) => number | null
}

/** `DefaultAutoReloadTypeProvider` 的可移植子集（`DefaultAutoReloadTypeProvider.kt:14-15`）。 */
export interface DefaultAutoReloadTypeProvider {
  id: string
  /** 只管这一套系统（空 = 任意系统；上游按 `AutoImportProjectTrackerSettings` 的工程判）。 */
  systemId?: string
  getAutoReloadType: () => AutoReloadType
}

/* ── 声明 ──────────────────────────────────────────────────────────────────────────────── */

/** 声明五条上游同名 EP（幂等）。 */
export function declareExternalSystemExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({ id: EXTERNAL_SYSTEM_MANAGER_EP, name: '外部系统管理器', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: EXTERNAL_SYSTEM_TASK_NOTIFICATION_LISTENER_EP, name: '外部系统任务通知监听', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: EXTERNAL_SYSTEM_UNLINKED_PROJECT_AWARE_EP, name: '未链接工程感知', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: EXTERNAL_SYSTEM_CRC_CALCULATOR_EP, name: '设置文件 CRC 计算器', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: AUTO_RELOAD_TYPE_PROVIDER_EP, name: '自动重载默认档提供方', scope: APPLICATION_SCOPE, dynamic: true })
}

/* ── 注册 / 取表 ───────────────────────────────────────────────────────────────────────── */

export function registerExternalSystemManager(value: ExternalSystemManager, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return EXTENSIONS.registerExtension(EXTERNAL_SYSTEM_MANAGER_EP, value.id, value, options)
}

export function registerTaskNotificationListener(value: ExternalSystemTaskNotificationListener, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return EXTENSIONS.registerExtension(EXTERNAL_SYSTEM_TASK_NOTIFICATION_LISTENER_EP, value.id, value, options)
}

export function registerUnlinkedProjectAware(value: ExternalSystemUnlinkedProjectAware, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return EXTENSIONS.registerExtension(EXTERNAL_SYSTEM_UNLINKED_PROJECT_AWARE_EP, value.id, value, options)
}

export function registerSettingsFileCrcCalculator(value: ExternalSystemCrcCalculator, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return EXTENSIONS.registerExtension(EXTERNAL_SYSTEM_CRC_CALCULATOR_EP, value.id, value, options)
}

export function registerDefaultAutoReloadTypeProvider(value: DefaultAutoReloadTypeProvider, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return EXTENSIONS.registerExtension(AUTO_RELOAD_TYPE_PROVIDER_EP, value.id, value, options)
}

/** 全部外部系统管理器（上游 `ExternalSystemManager.EP_NAME.getExtensionList()`）。 */
export function externalSystemManagers(scope: string = APPLICATION_SCOPE): ExternalSystemManager[] {
  return EXTENSIONS.extensionsOf<ExternalSystemManager>(EXTERNAL_SYSTEM_MANAGER_EP, scope)
}

/** `ExternalSystemManager.EP_NAME.findFirstSafe { it.systemId == systemId }` 的等价物。 */
export function externalSystemManagerFor(systemId: string, scope: string = APPLICATION_SCOPE): ExternalSystemManager | null {
  return externalSystemManagers(scope).find(manager => manager.systemId.id === systemId) ?? null
}

/** 全部任务通知监听（上游 `ExternalSystemTaskNotificationListener.EP_NAME`）。 */
export function taskNotificationListeners(scope: string = APPLICATION_SCOPE): ExternalSystemTaskNotificationListener[] {
  return EXTENSIONS.extensionsOf<ExternalSystemTaskNotificationListener>(EXTERNAL_SYSTEM_TASK_NOTIFICATION_LISTENER_EP, scope)
}

/** 全部未链接工程感知（上游 `ExternalSystemUnlinkedProjectAware.EP_NAME`）。 */
export function unlinkedProjectAwares(scope: string = APPLICATION_SCOPE): ExternalSystemUnlinkedProjectAware[] {
  return EXTENSIONS.extensionsOf<ExternalSystemUnlinkedProjectAware>(EXTERNAL_SYSTEM_UNLINKED_PROJECT_AWARE_EP, scope)
}

/** 全部 CRC 计算器（上游 `ExternalSystemCrcCalculator.EP_NAME`）。 */
export function settingsFileCrcCalculators(scope: string = APPLICATION_SCOPE): ExternalSystemCrcCalculator[] {
  return EXTENSIONS.extensionsOf<ExternalSystemCrcCalculator>(EXTERNAL_SYSTEM_CRC_CALCULATOR_EP, scope)
}

/** `ExternalSystemCrcCalculator.getInstance(systemId, file)`：第一条 `isApplicable` 命中的。 */
export function settingsFileCrcCalculatorFor(systemId: string, file: string, scope: string = APPLICATION_SCOPE): ExternalSystemCrcCalculator | null {
  for (const calculator of settingsFileCrcCalculators(scope)) {
    try { if (calculator.isApplicable(systemId, file)) return calculator } catch { /* 单条扩展的异常不该拖垮整表 */ }
  }
  return null
}

/** 全部自动重载默认档提供方。 */
export function defaultAutoReloadTypeProviders(scope: string = APPLICATION_SCOPE): DefaultAutoReloadTypeProvider[] {
  return EXTENSIONS.extensionsOf<DefaultAutoReloadTypeProvider>(AUTO_RELOAD_TYPE_PROVIDER_EP, scope)
}

/**
 * 这套系统的默认自动重载档：第一条匹配 systemId 的 provider（或未限定 systemId 的）给的值；
 * 一条都没有时回落到 `AUTO_RELOAD_DEFAULT`（上游「无 provider ⇒ SELECTIVE」同口径）。
 */
export function defaultAutoReloadTypeFor(systemId: string, scope: string = APPLICATION_SCOPE): AutoReloadType {
  for (const provider of defaultAutoReloadTypeProviders(scope)) {
    if (provider.systemId !== undefined && provider.systemId !== systemId) continue
    try { return provider.getAutoReloadType() } catch { /* 单条 provider 的异常按"没有"处理 */ }
  }
  return AUTO_RELOAD_DEFAULT
}

/**
 * 「没有落盘设置」时的构建工具设置 —— `autoReloadType` 走 EP 默认档。
 * `src/gradleHost.ts` 的 `buildTools` 用它替原先的直接 `DEFAULT_BUILD_TOOLS`，于是第三方
 * provider 真的改变了项目首次打开时的自动重载行为。
 */
export function defaultBuildToolsFor(systemId: string, scope: string = APPLICATION_SCOPE): BuildToolsSettings {
  return { ...DEFAULT_BUILD_TOOLS, autoReloadType: defaultAutoReloadTypeFor(systemId, scope) }
}

/* ── bundled：随本仓发货的贡献（Gradle / Maven） ─────────────────────────────────────────── */

/** bundled 贡献的 id 前缀（与第三方 `user` 来源区分，诊断页一眼看得出谁挂的）。 */
export const BUNDLED_EXTERNAL_SYSTEM_PREFIX = 'taocode.externalSystem.'

/** Gradle 管理器的 bundled 贡献（对齐 `plugins/gradle/plugin-resources/intellij.gradle.xml` 的 `GradleManager`）。 */
export function gradleManagerContribution(): ExternalSystemManager {
  return {
    id: BUNDLED_EXTERNAL_SYSTEM_PREFIX + 'gradle',
    systemId: GRADLE_SYSTEM,
    getProjectResolverClass: () => 'gradle.projectResolver',
    getTaskManagerClass: () => 'gradle.taskManager',
    getExternalProjectDescriptor: () => ['*.gradle', '*.gradle.kts', 'gradle.properties', 'settings.gradle', 'settings.gradle.kts'],
    getExtensionPointsForResolver: () => [EXTERNAL_SYSTEM_CRC_CALCULATOR_EP, EXTERNAL_SYSTEM_TASK_NOTIFICATION_LISTENER_EP],
    getSettingsProvider: () => ['buildTools.gradle', 'java.sourcePaths'],
    getLocalSettingsProvider: () => ['gradle.localSettings'],
    getExecutionSettingsProvider: path => [`gradle.execution:${path}`],
  }
}

/** Maven 管理器的 bundled 贡献（上游 Maven 插件自带 `MavenManager`）。 */
export function mavenManagerContribution(): ExternalSystemManager {
  return {
    id: BUNDLED_EXTERNAL_SYSTEM_PREFIX + 'maven',
    systemId: MAVEN_SYSTEM,
    getProjectResolverClass: () => 'maven.projectResolver',
    getTaskManagerClass: () => 'maven.taskManager',
    getExternalProjectDescriptor: () => ['pom.xml'],
    getExtensionPointsForResolver: () => [],
    getSettingsProvider: () => ['buildTools.maven'],
    getLocalSettingsProvider: () => [],
    getExecutionSettingsProvider: path => [`maven.execution:${path}`],
  }
}

/**
 * 未链接工程感知的 bundled 贡献（Gradle / Maven）—— 对齐上游
 * `GradleUnlinkedProjectAware`（`intellij.gradle.xml`）与 `MavenUnlinkedProjectAware`
 * （`intellij.maven.xml`）。`buildFileExtensions` 用本仓 `src/gradle.ts` 的构建文件后缀表。
 */
export function bundledUnlinkedProjectAwares(): ExternalSystemUnlinkedProjectAware[] {
  return [
    {
      id: BUNDLED_EXTERNAL_SYSTEM_PREFIX + 'gradle.autolink',
      systemId: GRADLE_SYSTEM.id,
      buildFileExtensions: () => ['gradle', 'kts'],
    },
    {
      id: BUNDLED_EXTERNAL_SYSTEM_PREFIX + 'maven.autolink',
      systemId: MAVEN_SYSTEM.id,
      buildFileExtensions: () => ['xml'],
    },
  ]
}

/** bundled 管理器 + 未链接感知的自动登记（模块加载时跑一次；幂等且不覆盖第三方同 id 贡献）。 */
export function registerBundledExternalSystemContributions(): ExtensionHandle[] {
  const handles: ExtensionHandle[] = []
  if (!externalSystemManagerFor(GRADLE_SYSTEM.id)) handles.push(registerExternalSystemManager(gradleManagerContribution(), { source: 'bundled' }))
  if (!externalSystemManagerFor(MAVEN_SYSTEM.id)) handles.push(registerExternalSystemManager(mavenManagerContribution(), { source: 'bundled' }))
  const awareIds = new Set(unlinkedProjectAwares().map(aware => aware.id))
  for (const aware of bundledUnlinkedProjectAwares()) {
    if (!awareIds.has(aware.id)) handles.push(registerUnlinkedProjectAware(aware, { source: 'bundled' }))
  }
  return handles
}

// 声明 + bundled 登记：与 `src/breadcrumbsExtensionPoints.ts` 同一做法（模块加载即生效）。
declareExternalSystemExtensionPoints()
registerBundledExternalSystemContributions()

/* ── 系统 id 的便捷再导出（消费方少 import 一次） ─────────────────────────────────────── */

export { GRADLE_SYSTEM, MAVEN_SYSTEM, projectSystemId }
