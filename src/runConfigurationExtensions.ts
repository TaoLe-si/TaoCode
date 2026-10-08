// **运行配置扩展**（上游 `com.intellij.runConfigurationExtension` EP + `RunConfigurationExtension`
// 一族）在本仓的落地：一条按 id 的 EP 宿主 + 与上游**同名的方法面** + 一个真实消费点
// （起跑前给命令行打补丁）。
//
// 上游依据（逐条开文件核过）：
//   · EP 声明 —— `java/execution/impl/resources/intellij.java.execution.impl.xml:62`
//     `<extensionPoint qualifiedName="com.intellij.runConfigurationExtension"
//       interface="com.intellij.execution.RunConfigurationExtension" dynamic="true"/>`。
//     注意这一条**不在** `platform/execution` 里，而在 Java 执行模块（它服务的是 Java 运行配置）；
//     任务书里点名的 `com.intellij.runConfigurationExtension` 上游确实存在，id 就是这一个。
//   · 接口 —— `java/execution/impl/src/com/intellij/execution/RunConfigurationExtension.java`
//     （`EP_NAME = new ExtensionPointName<>("com.intellij.runConfigurationExtension")`）继承
//     `platform/execution/src/com/intellij/execution/configuration/RunConfigurationExtensionBase.java`，
//     方法面 `isApplicableFor(config)`（`:82`）、`isEnabledFor(config, runnerSettings)`（`:91`）、
//     `patchCommandLine(config, runnerSettings, cmdLine, runnerId)`（`:101-108`，抽象，
//     「抛 `ExecutionException` = 取消这次执行」）、带 executor 的重载（`:113-119`）、
//     `updateJavaParameters(config, params, runnerSettings)`（Java 侧，`RunConfigurationExtension.java:27`）、
//     `cleanUserData(config)`（`:41`）。
//   · 上游的真实用途（决定本仓的消费点长什么样）：`CoverageJavaRunConfigurationExtension`
//     （`plugins/coverage/.../CoverageJavaRunConfigurationExtension.java`）在命令行里插 coverage agent、
//     `DevKitApplicationPatcher` / `DevkitDcevmCommandLinePatcher` 加 VM 参数、
//     `GradleRunConfigurationExtension` 改 classpath。**都是「起跑前改命令行」**。
//
// 本仓的可移植子集（如实差异）：
//   ① 上游 `cmdLine` 是 `GeneralCommandLine`（含 exePath/参数表/环境/工作目录/charset/PTY 选项）；
//      本仓的启动参数是 `src/bridge.ts` 的 `RunStartParams`（command/program/args/cwd/env/shell），
//      所以可改的就是那几格 —— `RunCommandLine` 就是它的可写视图。
//   ② 上游 `runnerSettings` 是 per-runner 的持久化设置（每条配置 × 每个执行器一份）；本仓只有
//      「执行器 id」这一档（没有 per-runner 设置的存储），所以 `runnerSettings` 收成
//      `{ executorId }`（可空）。
//   ③ `updateJavaParameters` / `decorate(console)` / `createEditor` 三格依赖 JavaParameters、
//      Swing 编辑器与 ConsoleView：本仓没有那三样，**不假装有**，只登记「上游还有这三格」。
//
// 纯数据层：只 import `src/extensionPoints.ts`（不 import vue/DOM/bridge）⇒ `node --test` 直测。
//
// 判据：`tests/run-configuration-extensions.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/** EP id（逐字取自上游 `RunConfigurationExtension.EP_NAME` 的构造参数）。 */
export const RUN_CONFIGURATION_EXTENSION_EP = 'com.intellij.runConfigurationExtension'

/** 声明 EP（幂等）。 */
export function declareRunConfigurationExtensionPoint(): void {
  EXTENSIONS.declareExtensionPoint({
    id: RUN_CONFIGURATION_EXTENSION_EP, name: '运行配置扩展', scope: APPLICATION_SCOPE, dynamic: true,
  })
}

declareRunConfigurationExtensionPoint()

/**
 * 扩展看到的运行配置面（上游 `RunConfigurationBase` 的可移植子集：名字/类型/命令行/程序/参数/
 * 工作目录/环境）。传的是**快照**（消费点复制一份），扩展改它不影响配置本体。
 */
export interface RunConfigurationExtensionConfig {
  name: string
  type?: string
  command: string
  program?: string
  args?: readonly string[]
  cwd?: string
  env?: readonly string[]
}

/**
 * 起跑前的命令行（上游 `GeneralCommandLine` 的可移植视图，见文件头差异 ①）。
 * **可变**：扩展就是要改它（插 agent / 加 VM 参数 / 改 classpath / 补环境变量）。
 */
export interface RunCommandLine {
  command: string
  program?: string
  args: string[]
  cwd?: string
  env: string[]
  /** 是否经过 shell（`src/runActions.ts` 的 `params.shell`；扩展一般不动它）。 */
  shell?: boolean
}

/** per-runner 设置（上游 `RunnerSettings`；本仓只有执行器 id 这一档，见文件头差异 ②）。 */
export interface RunnerSettings {
  executorId?: string
}

/**
 * 一条运行配置扩展（上游 `RunConfigurationExtension` 的方法面，名字逐字相同）。
 *
 * 三个方法各有明确职责（照上游的语义，不是本仓自创）：
 *   · `isApplicableFor(config)` —— 这条扩展**在不在**这条配置上生效（上游拿它决定要不要挂设置页）；
 *   · `isEnabledFor(config, runnerSettings)` —— 在适用之上，用户**开没开**（上游拿它决定要不要打补丁）；
 *   · `patchCommandLine(config, runnerSettings, cmdLine, runnerId, executorId)` —— 真正改命令行。
 *     抛异常 = 取消这次执行（上游「throws ExecutionException if the execution should be canceled」）。
 */
export interface RunConfigurationExtension {
  /** 稳定 id（上游用 `getClass().getCanonicalName()` 当序列化 id，本仓用显式 id）。 */
  id: string
  isApplicableFor: (config: RunConfigurationExtensionConfig) => boolean
  isEnabledFor?: (config: RunConfigurationExtensionConfig, runnerSettings: RunnerSettings) => boolean
  patchCommandLine?: (
    config: RunConfigurationExtensionConfig, runnerSettings: RunnerSettings,
    cmdLine: RunCommandLine, runnerId: string, executorId: string,
  ) => void
}

/** 全部扩展（EP 表里按 LoadingOrder 排好序的）。 */
export function runConfigurationExtensions(): RunConfigurationExtension[] {
  return EXTENSIONS.extensionsOf<RunConfigurationExtension>(RUN_CONFIGURATION_EXTENSION_EP)
}

/** 注册一条扩展（插件默认 user）。 */
export function registerRunConfigurationExtension(
  extension: RunConfigurationExtension, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  if (!extension?.id) throw new Error(`扩展点 ${RUN_CONFIGURATION_EXTENSION_EP} 的贡献必须有 id。`)
  return EXTENSIONS.registerExtension<RunConfigurationExtension>(
    RUN_CONFIGURATION_EXTENSION_EP, extension.id, extension, options,
  )
}

/** 注销一条扩展。 */
export function unregisterRunConfigurationExtension(id: string): boolean {
  return EXTENSIONS.unregisterExtension(RUN_CONFIGURATION_EXTENSION_EP, id)
}

/** 补丁执行的结果：改过的命令行，或一句「为什么这次执行被取消」。 */
export type RunCommandLinePatch =
  | { cmdLine: RunCommandLine; error: null; applied: string[] }
  | { cmdLine: RunCommandLine; error: string; applied: string[] }

/**
 * 把命令行交给全部扩展（上游 `RunConfigurationExtensionManager.patchCommandLine` 的等价物）：
 * 按注册顺序问每一条 `isApplicableFor` → `isEnabledFor` → `patchCommandLine`，
 * 传的是**同一个可变对象**（上游也是逐条改同一个 `GeneralCommandLine`）。
 *
 * 一个扩展抛错时**立刻中止**并返回 `error`（上游：抛 `ExecutionException` 就取消这次执行，
 * 不是「跳过这条继续跑」）—— 调用点拿 `error` 去 `notify` 并中止启动。
 * `applied` 是真正改过命令行的那几条的 id（诊断与控制台提示用）。
 */
export function patchRunCommandLine(
  config: RunConfigurationExtensionConfig,
  cmdLine: RunCommandLine,
  context: { runnerId: string; executorId: string; runnerSettings?: RunnerSettings },
): RunCommandLinePatch {
  const applied: string[] = []
  const runnerSettings: RunnerSettings = { executorId: context.executorId, ...(context.runnerSettings ?? {}) }
  for (const extension of runConfigurationExtensions()) {
    let applicable = true
    try { applicable = extension.isApplicableFor(config) !== false } catch { applicable = false }
    if (!applicable) continue
    try {
      if (extension.isEnabledFor && extension.isEnabledFor(config, runnerSettings) === false) continue
    } catch { continue }
    if (!extension.patchCommandLine) continue
    try {
      extension.patchCommandLine(config, runnerSettings, cmdLine, context.runnerId, context.executorId)
      applied.push(extension.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { cmdLine, error: `运行配置扩展「${extension.id}」失败：${message}`, applied }
    }
  }
  return { cmdLine, error: null, applied }
}

/** 把 `RunStartParams` 形状的启动参数折成扩展看得见的命令行（缺的字段按空处理）。 */
export function commandLineOf(params: {
  command?: string; program?: string; args?: readonly string[]; cwd?: string; env?: readonly string[]; shell?: boolean
}): RunCommandLine {
  return {
    command: params.command ?? '',
    program: params.program,
    args: [...(params.args ?? [])],
    cwd: params.cwd,
    env: [...(params.env ?? [])],
    shell: params.shell,
  }
}

/**
 * 把改过的命令行写回启动参数（**只写扩展真改过的格子**：`program`/`args`/`env`/`cwd`/`command`
 * 与 `shell`）。上游 `GeneralCommandLine` 是唯一的真源，本仓的 `RunStartParams` 是同一件事的
 * 扁平形状 ⇒ 这里一次写回，调用点不必逐格比对。
 */
export function applyCommandLineToParams(
  cmdLine: RunCommandLine,
  params: { command?: string; program?: string; args?: readonly string[]; cwd?: string; env?: readonly string[]; shell?: boolean },
): void {
  params.command = cmdLine.command
  if (cmdLine.program) params.program = cmdLine.program
  // 空数组也要写回（扩展把参数清空是合法操作；不写回会留下旧参数）。
  params.args = [...cmdLine.args]
  if (cmdLine.cwd) params.cwd = cmdLine.cwd
  params.env = [...cmdLine.env]
  if (typeof cmdLine.shell === 'boolean') params.shell = cmdLine.shell
}
