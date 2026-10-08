// 内置的环境键提供方 —— 上游 `EnvironmentKeyProvider` 的两个实现，逐条照抄。
//
// 上游坐标：
//   · `platform/platform-impl/src/com/intellij/ide/plugins/PluginEnvironmentKeyProvider.kt` ——
//     `knownKeys` 只有一条 `enable.disabled.dependent.plugins`（`:16-22`），描述取
//     `IdeBundle` 的 `environment.key.description.enable.disabled.dependent.plugins`；
//     `getRequiredKeys` 返回 `emptyList()`（`:23`）—— 它不是必需键。
//   · `java/execution/openapi/src/com/intellij/execution/environment/JvmEnvironmentKeyProvider.kt` ——
//     `knownKeys` 两条：`project.jdk`（`:16`，描述 `environment.key.description.project.jdk`）与
//     `project.jdk.name`（`:17`）；`getRequiredKeys` 返回 `listOf()`（`:22`）。
//   · 键 id 的语法约束在 `EnvironmentKey.kt:31-33`：`^[a-z0-9]+(\.[a-z0-9]+)*$`；
//     描述查不到就报错（`:42-44` 的 `description` 扩展属性 `error(...)`）。
//   · 注册面：`EnvironmentKeyProvider.EP_NAME = ExtensionPointName("com.intellij.environmentKeyProvider")`
//     （`EnvironmentKeyProvider.kt:24`；上游 EP 声明在 `platform/platform-api/resources/intellij.platform.ide.xml:153`
//     的 `<extensionPoint qualifiedName="com.intellij.environmentKeyProvider"
//      interface="com.intellij.ide.environment.EnvironmentKeyProvider" dynamic="true"/>`）。
//     **2026-10-06 本 lane 补**：EP 宿主已落 —— 两个内置提供方按 **bundled 贡献**登记在 EP 上，
//     第三方按同一个 EP id 挂自己的提供方即被 `environmentKeyProvidersFromExtensions()` 收编，
//     消费点 `src/workspaceLifecycle.ts` 从 EP 取全部提供方注册进 `EnvironmentKeyRegistry`。
//
// **必需键为空**（两个上游 provider 都返回空）⇒ 接上它们**不改变** headless 必需键检查的行为，
// 只让这两个键「登记在册」：`generateEnvironmentKeyStub` 会列出它们、`isRegistered` 为真。
//
// 消费链路：`src/workspaceLifecycle.ts` 的 `environmentKeys.register(...)`（启动阶段 configuration）。
// 判据 `tests/environment-key-providers.test.mjs`、`tests/environment-key-provider-ep.test.mjs`。
import { environmentKey, type EnvironmentKey, type EnvironmentKeyProvider } from './environmentKeys.ts'
import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/** 键 id 的语法（`EnvironmentKey.kt:31-33` 的正则）。 */
export const ENVIRONMENT_KEY_ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9]+)*$/

/** `PluginEnvironmentKeyProvider.Keys.ENABLE_DISABLED_DEPENDENT_PLUGINS`（`.kt:16`）。 */
export const ENABLE_DISABLED_DEPENDENT_PLUGINS = environmentKey(
  'enable.disabled.dependent.plugins',
  'If set to true, plugins disabled by an unmet dependency are enabled anyway.',
)

/** `JvmEnvironmentKeyProvider.Keys.JDK_KEY` / `JDK_NAME`（`.kt:16-17`）。 */
export const PROJECT_JDK_KEY = environmentKey('project.jdk', 'Path to the JDK used by the project.')
export const PROJECT_JDK_NAME = environmentKey('project.jdk.name', 'Name of the JDK used by the project.')

/** `PluginEnvironmentKeyProvider` 的等价物（一条已知键、无必需键）。 */
export const pluginEnvironmentKeyProvider: EnvironmentKeyProvider = {
  knownKeys: [ENABLE_DISABLED_DEPENDENT_PLUGINS],
  requiredKeys: () => [],
}

/** `JvmEnvironmentKeyProvider` 的等价物（两条已知键、无必需键）。 */
export const jvmEnvironmentKeyProvider: EnvironmentKeyProvider = {
  knownKeys: [PROJECT_JDK_KEY, PROJECT_JDK_NAME],
  requiredKeys: () => [],
}

/** 本仓内置的全部提供方（注册顺序不影响 `knownKeys()`，那里按 id 排序）。 */
export const BUILTIN_ENVIRONMENT_KEY_PROVIDERS: readonly EnvironmentKeyProvider[] = [
  pluginEnvironmentKeyProvider,
  jvmEnvironmentKeyProvider,
]

// ── EP 宿主（上游 `com.intellij.environmentKeyProvider`，id 逐字取上游） ──────────────

/**
 * EP id（逐字取自上游 `intellij.platform.ide.xml:153` 的 `qualifiedName`；也等于
 * `EnvironmentKeyProvider.kt:24` 的 `ExtensionPointName`）。上游 EP 没有 id 属性（是提供方列表），
 * 本仓给每条贡献一个注册 id（bundled 两条分别是 `plugin`/`jvm`）。
 */
export const ENVIRONMENT_KEY_PROVIDER_EP = 'com.intellij.environmentKeyProvider'

/** 一条环境键提供方贡献（上游 EP 的一个 `<extensionPoint>` 实例，带本仓的注册 id）。 */
export interface EnvironmentKeyProviderContribution {
  /** 注册 id（上游 EP 无 id，这里是本仓宿主要求的键）。 */
  id: string
  /** 该贡献提供的提供方对象（上游 `EnvironmentKeyProvider`）。 */
  provider: EnvironmentKeyProvider
}

/** 声明 EP（幂等）。 */
export function declareEnvironmentKeyProviderExtensionPoint(): void {
  EXTENSIONS.declareExtensionPoint({
    id: ENVIRONMENT_KEY_PROVIDER_EP, name: '环境键提供方', scope: APPLICATION_SCOPE, dynamic: true,
  })
}

/** 插件贡献一个环境键提供方（等价于上游 plugin.xml 的 `<com.intellij.environmentKeyProvider .../>`）。 */
export function registerEnvironmentKeyProvider(
  id: string, provider: EnvironmentKeyProvider, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(ENVIRONMENT_KEY_PROVIDER_EP, id, { id, provider }, options)
}

/** 注销一条环境键提供方贡献。 */
export function unregisterEnvironmentKeyProvider(id: string): boolean {
  return EXTENSIONS.unregisterExtension(ENVIRONMENT_KEY_PROVIDER_EP, id)
}

/**
 * 当前 EP 上的全部提供方（bundled 在内置表之前按注册顺序、第三方按 id 覆盖）。
 * 消费点 `src/workspaceLifecycle.ts` 用它灌 `EnvironmentKeyRegistry`，第三方按 EP id
 * 挂的提供方由此被真实消费（`isRegistered`/存根生成器都看得见）。
 */
export function environmentKeyProvidersFromExtensions(scope: string = APPLICATION_SCOPE): EnvironmentKeyProvider[] {
  return EXTENSIONS.extensionsOf<EnvironmentKeyProviderContribution>(ENVIRONMENT_KEY_PROVIDER_EP, scope)
    .map(contribution => contribution.provider)
}

// bundled：两个内置提供方按上游 `intellij.platform.ide.xml` 的插件贡献形态登记在 EP 上。
declareEnvironmentKeyProviderExtensionPoint()
EXTENSIONS.registerExtension(ENVIRONMENT_KEY_PROVIDER_EP, 'plugin',
  { id: 'plugin', provider: pluginEnvironmentKeyProvider }, { source: 'bundled' })
EXTENSIONS.registerExtension(ENVIRONMENT_KEY_PROVIDER_EP, 'jvm',
  { id: 'jvm', provider: jvmEnvironmentKeyProvider }, { source: 'bundled' })

/** 一个键 id 是否合语法（上游 `EnvironmentKey.create` 的 `require(regex.matches(id))`）。 */
export function isValidEnvironmentKeyId(id: string): boolean {
  return ENVIRONMENT_KEY_ID_PATTERN.test(id)
}

/** 本仓内置提供方声明的全部键（按 id 排序，供存根生成器与判据用）。 */
export function builtinEnvironmentKeys(): EnvironmentKey[] {
  return BUILTIN_ENVIRONMENT_KEY_PROVIDERS
    .flatMap(provider => [...provider.knownKeys])
    .sort((a, b) => a.id.localeCompare(b.id))
}