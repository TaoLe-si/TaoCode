// 应用启动命令（IDEA `ApplicationStarter`/`ApplicationStarterEP`）在本仓的对应物。
//
// 上游（platform/ide-core/src/com/intellij/openapi/application/ApplicationStarter.kt）：
//   · `findStarter(key)` 按 EP id 找启动器（找不到返回 null）；
//   · 启动器有 `requiredModality`、`isHeadless`、`isInternal`、`canProcessExternalCommandLine` 这些元数据，
//     `main(args)` 里自己做终止（:60-80）；
//   · `EnvironmentKeyStubGenerator` 就是一个 `ModernApplicationStarter`，命令名
//     `generateEnvironmentKeysFile`（platform-impl/.../EnvironmentKeyStubGenerator.kt:50）。
//
// 本仓的入口：宿主（`native/main.cpp`）持有真实 argv 但没有透出通道，浏览器预览用
// `?command=<名字>&args=...` 作 argv 的替身（`src/main.ts` 在挂载前先跑一次）。
// 注册表与命令行解析是纯函数，判据在 `tests/application-starters.test.mjs`。

import { EnvironmentConfiguration, generateEnvironmentKeyStub } from './environmentKeys.ts'
import type { EnvironmentKey } from './environmentKeys.ts'
import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/**
 * EP id（逐字取自上游 `platform/ide-core/resources/intellij.platform.ide.core.xml:51` 的
 * `qualifiedName="com.intellij.appStarter"`，`beanClass=ApplicationStarterEP` `dynamic="true"`）。
 * 插件的 `<com.intellij.appStarter command="…" implementation="…"/>` 与这里的
 * `registerApplicationStarter()` 同一层：命令名是注册 id。
 */
export const APPLICATION_STARTER_EP = 'com.intellij.appStarter'

/** 声明 EP（幂等）。 */
export function declareApplicationStarterExtensionPoint(): void {
  EXTENSIONS.declareExtensionPoint({ id: APPLICATION_STARTER_EP, name: '应用启动命令', scope: APPLICATION_SCOPE, dynamic: true })
}

/** 插件贡献一个启动命令（等价于上游 plugin.xml 的 `<com.intellij.appStarter command=…/>`）。 */
export function registerApplicationStarter(starter: ApplicationStarter, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return EXTENSIONS.registerExtension(APPLICATION_STARTER_EP, starter.command, starter, options)
}

/** 注销一个启动命令。 */
export function unregisterApplicationStarter(command: string): boolean {
  return EXTENSIONS.unregisterExtension(APPLICATION_STARTER_EP, command)
}

/** 当前 EP 上的全部启动命令（bundled + 第三方贡献）。 */
export function applicationStartersFromExtensions(scope: string = APPLICATION_SCOPE): ApplicationStarter[] {
  return EXTENSIONS.extensionsOf<ApplicationStarter>(APPLICATION_STARTER_EP, scope)
}

/** 按命令名从 EP 取启动器（`findStarter` 的 EP 一侧）。 */
function applicationStarterFromExtensions(command: string): ApplicationStarter | null {
  return applicationStartersFromExtensions().find(starter => starter.command === command) ?? null
}

export interface ApplicationStarter {
  /** 命令名（上游 EP id，如 `generateEnvironmentKeysFile`）。 */
  command: string
  /** `--list-commands` 里的一行说明（上游 EP 的 bundle/key）。 */
  description?: string
  /** 内部命令：默认不进 `--list-commands`（上游 `ApplicationStarterEP.isInternal`）。 */
  internal?: boolean
  /** 能不能在无界面下跑（上游 `isHeadless`，默认 true）。 */
  headless?: boolean
  /** 跑一次；返回值是给 stdout 的文本（本仓把 stdout 落到调用方）。 */
  main: (args: string[]) => string | void | Promise<string | void>
}

export class ApplicationStarterRegistry {
  private readonly starters = new Map<string, ApplicationStarter>()

  register(starter: ApplicationStarter): void {
    this.starters.set(starter.command, starter)
  }

  /**
   * `ApplicationStarter.findStarter`：按命令名找，找不到回 null。
   * 先查显式表，再落到 EP（第三方按 `com.intellij.appStarter` 挂的启动命令由此被真实消费）。
   */
  find(command: string): ApplicationStarter | null {
    return this.starters.get(command) ?? applicationStarterFromExtensions(command)
  }

  /** 显式表 + EP 贡献合并（同命令名以显式注册的为准）。 */
  all(): ApplicationStarter[] {
    const merged = new Map<string, ApplicationStarter>()
    for (const starter of applicationStartersFromExtensions()) merged.set(starter.command, starter)
    for (const starter of this.starters.values()) merged.set(starter.command, starter)
    return [...merged.values()].sort((a, b) => a.command.localeCompare(b.command))
  }

  /** `--list-commands` 的输出（内部命令不列）。 */
  listCommands(): string[] {
    return this.all().filter(starter => !starter.internal)
      .map(starter => starter.description ? `${starter.command}\t${starter.description}` : starter.command)
  }
}

export const applicationStarters = new ApplicationStarterRegistry()

/**
 * 命令行解析（上游 `ArgsParser` 的最小子集）：`?command=name&args=a&args=b`
 * （重复的 `args` 键按出现顺序收集）。没有 command 时回 null。
 */
export function parseStarterCommandLine(search: string): { command: string; args: string[] } | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const command = params.get('command')
  if (!command) return null
  return { command, args: params.getAll('args') }
}

export interface StarterRunResult {
  handled: boolean
  exitCode: number
  output: string
  /** 失败原因（找得到命令但执行抛错/命令不存在时给）。 */
  error?: string
}

/** 跑一个启动命令：找不到命令 = 未处理；抛错 = exitCode 1 + error。 */
export async function runApplicationStarter(command: string, args: string[] = []): Promise<StarterRunResult> {
  const starter = applicationStarters.find(command)
  if (!starter) return { handled: false, exitCode: 1, output: '', error: `未知命令：${command}` }
  try {
    const output = await starter.main(args)
    return { handled: true, exitCode: 0, output: typeof output === 'string' ? output : '' }
  } catch (error) {
    return { handled: true, exitCode: 1, output: '', error: error instanceof Error ? error.message : String(error) }
  }
}

// —— 内置启动器 ——
applicationStarters.register({
  command: 'list-commands',
  description: 'List all available commands.',
  main: () => applicationStarters.listCommands().join('\n'),
})

/**
 * `EnvironmentKeyStubGenerator`（命令名 `generateEnvironmentKeysFile`）：
 * `--file=<path>` 落盘 / `--stdout` 打屏（二者只能选一个）、`--no-descriptions` 省说明。
 *
 * 本仓没有系统属性/配置文件来源，键表由注册表（目前为空）与调用方注入的
 * `knownKeys`/`configuration` 提供；浏览器预览下 `--file` 走 `download` 不可用，
 * 因此默认打屏（`--stdout` 语义），失败原因如实返回。
 */
export function createEnvironmentKeyStubStarter(deps: {
  knownKeys: () => readonly EnvironmentKey[]
  configuration: () => EnvironmentConfiguration
}): ApplicationStarter {
  return {
    command: 'generateEnvironmentKeysFile',
    description: 'Print environment keys stub as JSON.',
    main: args => {
      const toStdout = args.includes('--stdout')
      const noDescriptions = args.includes('--no-descriptions')
      const fileArg = args.find(arg => arg.startsWith('--file='))?.slice('--file='.length)
      if (fileArg && toStdout) throw new Error('Only one of --file and --stdout can be specified.')
      const text = generateEnvironmentKeyStub(deps.knownKeys(), deps.configuration(), !noDescriptions)
      // 本仓浏览器预览没有文件系统出口：给了 --file 也退回 stdout（真实宿主落地时应写文件）。
      return text
    },
  }
}

applicationStarters.register(createEnvironmentKeyStubStarter({
  knownKeys: () => [],                       // 本仓没有 EnvironmentKeyProvider 贡献者（见 src/environmentKeys.ts）
  configuration: () => EnvironmentConfiguration.EMPTY,
}))

// bundled：内置启动命令按上游 plugin.xml 的 `<com.intellij.appStarter …/>` 形态登记在 EP 上，
// 第三方按同一 EP id 挂的命令名即被 `applicationStarters.find()`/`listCommands()` 真实消费。
declareApplicationStarterExtensionPoint()
for (const starter of applicationStarters.all())
  EXTENSIONS.registerExtension(APPLICATION_STARTER_EP, starter.command, starter, { source: 'bundled' })
