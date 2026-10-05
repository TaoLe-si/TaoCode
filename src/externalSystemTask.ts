// 外部系统任务执行的**模型与纯规则**（上游 `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/execution/`：
// `ExternalSystemTaskExecutionSettings`（任务名/脚本参数/VM 参数/env）、
// `AbstractExternalSystemTaskConfigurationType.generateName`（运行配置命名）、
// `ExternalSystemTaskId`/`ExternalSystemTaskLocation`（任务标识）、
// `ExternalSystemBeforeRunTask`（「Run Gradle task」前置任务）、
// `ExternalSystemJdkUtil`（`#USE_PROJECT_JDK`/`#JAVA_HOME`/`#JAVA_INTERNAL`/显式路径四档 JDK 解析）。
//
// 本仓现状（接进 gradleHost 前的缺口）：Gradle 任务在 `src/gradleHost.ts` 的 `runTask`/`saveTaskAsRunConfig`
// 里跑，控制台标签与运行配置名是手拼的 `Gradle · dir · task` —— 没有任务名列表、脚本参数、前置任务与
// JDK 档位的模型。这个模块把这些规则落成纯函数，`src/gradleHost.ts` 用它的命名与 JDK 折算
// （消费链：任务树右键 → 控制台标签/运行配置名/子进程 JAVA_HOME）。
//
// 上游 `ExternalSystemRunConfiguration` 与 `ExternalSystemEditTaskDialog`（任务编辑对话框）是 Swing
// 组件本体，本仓 UI 是 Vue（对话框宿主在 App.vue，本批冻结）—— 那部分见判词，不在本模块。

/** `ProjectSystemId` 在本仓只有 Gradle（Maven 没有执行通道，见 es/execution 判词）。 */
export const EXTERNAL_SYSTEM_GRADLE = 'GRADLE'

/** `ExternalSystemTaskActivator.RUN_CONFIGURATION_TASK_PREFIX`（`ExternalSystemTaskActivator.java:59`）。 */
export const RUN_CONFIGURATION_TASK_PREFIX = 'run: '

/** `ExternalSystemJdkUtil.java:52-54` 的三个哨兵值。 */
export const EXTERNAL_SYSTEM_USE_PROJECT_JDK = '#USE_PROJECT_JDK'
export const EXTERNAL_SYSTEM_USE_JAVA_HOME = '#JAVA_HOME'
export const EXTERNAL_SYSTEM_USE_INTERNAL_JAVA = '#JAVA_INTERNAL'

/** `ExternalSystemTaskExecutionSettings` 的字段面（本仓用得到的那些）。 */
export interface ExternalSystemTaskSettings {
  /** `getExternalSystemIdString()`。 */
  systemId: string
  /** `getExternalProjectPath()`：外部工程的绝对路径（本仓 = 工作区根 + 链接目录）。 */
  externalProjectPath?: string
  /** `getTaskNames()`：一次执行的任务名列表（IDEA 允许一次跑多个任务，按空格分隔）。 */
  taskNames: string[]
  /** `getVmOptions()`：给 Gradle 守护进程/启动 JVM 的 VM 参数原文。 */
  vmOptions?: string
  /** `getScriptParameters()`：原样追加到命令行末尾的脚本参数。 */
  scriptParameters?: string
  /** `getExecutionName()`：显式执行名（非空时覆盖自动命名）。 */
  executionName?: string
}

/** 任务标识（`ExternalSystemTaskId` + `ExternalSystemTaskLocation` 的最小字段面）。 */
export interface ExternalSystemTaskLocation {
  systemId: string
  externalProjectPath: string
  taskName: string
}

export function externalSystemTaskLocation(systemId: string, externalProjectPath: string, taskName: string): ExternalSystemTaskLocation {
  return { systemId, externalProjectPath, taskName }
}

/**
 * 任务标识的字符串形状（`ExternalSystemTaskId.toString` 不在公开 API 里；本仓用它做
 * 控制台标签/去重键，格式固定成 `systemId:projectPath:taskName`）。
 */
export function externalSystemTaskIdString(location: ExternalSystemTaskLocation): string {
  return `${location.systemId}:${location.externalProjectPath}:${location.taskName}`
}

/** `ExternalSystemTaskExecutionSettings.setTaskNames(StringUtil.split(text, " "))` 那一行的解析。 */
export function externalSystemTaskNames(text: string): string[] {
  return text.split(/[\s,]+/).map(name => name.trim()).filter(Boolean)
}

/**
 * 按空格切 `scriptParameters`，但尊重引号（上游 `ParametersList` 的等价子集）：
 * `--tests "com.acme.Foo Bar"` 是两个参数，不是一个；单双引号都认，`\\` 在引号内外都转义下一个字符
 * （`ParametersList.parse` 的同一口径）。
 */
export function splitScriptParameters(text: string): string[] {
  const out: string[] = []
  let current = ''
  let quote = ''
  let started = false
  for (let index = 0; index < text.length; ++index) {
    const char = text[index]
    if (char === '\\' && index + 1 < text.length) { current += text[index + 1]; started = true; ++index; continue }
    if (quote) {
      if (char === quote) { quote = ''; continue }
      current += char
      continue
    }
    if (char === '"' || char === "'") { quote = char; started = true; continue }
    if (/\s/.test(char)) { if (started) { out.push(current); current = ''; started = false } continue }
    current += char
    started = true
  }
  if (started) out.push(current)
  return out
}

/** 一次任务执行的命令行参数（任务名 + 脚本参数），调用方把它们接在 Gradle 可执行文件之后。 */
export function externalSystemTaskArguments(settings: ExternalSystemTaskSettings): string[] {
  const tasks = settings.taskNames.map(name => name.trim()).filter(Boolean)
  return [...tasks, ...splitScriptParameters(settings.scriptParameters ?? '')]
}

/**
 * `AbstractExternalSystemTaskConfigurationType.generateName`（`:123-160`）的等价物：
 * `executionName` 优先；否则 `工程名 [任务1 任务2]`；工程段取 `projectName`（上游是
 * `ExternalSystemUiAware.getProjectRepresentationName`），没有就退回 `externalProjectPath`；
 * 两者都空且任务也空时给「未命名」（上游 `run.configuration.unnamed.name.prefix`）。
 */
export function generateExternalSystemTaskName(input: {
  projectName?: string
  externalProjectPath?: string
  taskNames?: readonly string[]
  executionName?: string
}): string {
  if (input.executionName?.trim()) return input.executionName.trim()
  const tasks = (input.taskNames ?? []).map(name => name.trim()).filter(Boolean)
  const project = (input.projectName ?? '').trim() || (input.externalProjectPath ?? '').trim()
  let name = project
  if (tasks.length) name += ` [${tasks.join(' ')}]`
  return name || '未命名'
}

/**
 * `ExternalSystemBeforeRunTaskProvider`（`:56-58`）给前置任务的名字：
 * `ExternalSystemBundle.message("tasks.before.run.empty", readableName)`。
 * 上游模板见 `ExternalSystemBundle.properties`：`tasks.before.run.empty=Run {0} task`。
 */
export function externalSystemBeforeRunTaskName(systemName = 'Gradle'): string {
  return `运行 ${systemName} 任务`
}

/** 一条可挂进运行配置 `beforeLaunch` 的前置任务（`ExternalSystemBeforeRunTask` 的可落盘形状）。 */
export interface ExternalSystemBeforeRunTaskStep {
  name: string
  command: string
}

/** `ExternalSystemBeforeRunTask` 克隆/比较用的规范化（字段顺序与去重后的任务名）。 */
export function normalizeExternalSystemTaskSettings(settings: ExternalSystemTaskSettings): ExternalSystemTaskSettings {
  return {
    systemId: settings.systemId,
    externalProjectPath: (settings.externalProjectPath ?? '').replace(/\\/g, '/'),
    taskNames: settings.taskNames.map(name => name.trim()).filter(Boolean),
    ...(settings.vmOptions?.trim() ? { vmOptions: settings.vmOptions.trim() } : {}),
    ...(settings.scriptParameters?.trim() ? { scriptParameters: settings.scriptParameters.trim() } : {}),
    ...(settings.executionName?.trim() ? { executionName: settings.executionName.trim() } : {}),
  }
}

/** `ExternalSystemJdkUtil.resolveJdkName` 的四档解析结果（错误分支对应上游的三个异常）。 */
export type ExternalSystemJdkResolution =
  | { ok: true; home: string }
  | { ok: false; code: 'PROJECT_JDK_NOT_FOUND' | 'UNDEFINED_JAVA_HOME' | 'INVALID_JAVA_HOME' | 'UNKNOWN_JDK'; message: string }

/**
 * `ExternalSystemJdkUtil.matchJdkName`（`:76-89`）的等价物：
 *  · `#USE_PROJECT_JDK` → 项目 JDK；没有就 `ProjectJdkNotFoundException`；
 *  · `#JAVA_HOME` → 环境变量 `JAVA_HOME`；空就 `UndefinedJavaHomeException`；
 *  · `#JAVA_INTERNAL` → 随产品分发的那一个（本仓没有内置 JRE，登记为未知）；
 *  · 其余按显式路径（上游按 SDK 名查表；本仓只要目录存在就当时路径）。
 * `exists` 由调用方注入（宿主/测试都能给），本模块不碰磁盘。
 */
export function resolveExternalSystemJdk(
  jdk: string,
  context: { projectJdkHome?: string; javaHome?: string; internalJdkHome?: string; exists?: (path: string) => boolean },
): ExternalSystemJdkResolution {
  const value = (jdk ?? '').trim()
  if (value === EXTERNAL_SYSTEM_USE_PROJECT_JDK) {
    const home = (context.projectJdkHome ?? '').trim()
    if (!home) return { ok: false, code: 'PROJECT_JDK_NOT_FOUND', message: '项目没有配置 JDK；在「项目结构 › SDK」里选一个，或把 Gradle JVM 改成 JAVA_HOME。' }
    return { ok: true, home }
  }
  if (value === EXTERNAL_SYSTEM_USE_JAVA_HOME) {
    const home = (context.javaHome ?? '').trim()
    if (!home) return { ok: false, code: 'UNDEFINED_JAVA_HOME', message: '环境变量 JAVA_HOME 没有设置。' }
    if (context.exists && !context.exists(home)) return { ok: false, code: 'INVALID_JAVA_HOME', message: `JAVA_HOME 指向的目录不存在：${home}` }
    return { ok: true, home }
  }
  if (value === EXTERNAL_SYSTEM_USE_INTERNAL_JAVA) {
    const home = (context.internalJdkHome ?? '').trim()
    if (!home) return { ok: false, code: 'PROJECT_JDK_NOT_FOUND', message: '本仓没有随产品分发的内置 JDK（上游 `#JAVA_INTERNAL` 的等价物不存在）。' }
    return { ok: true, home }
  }
  if (!value) {
    // 上游 GradleProjectSettings 的默认值就是 `#USE_PROJECT_JDK`，空值按同一档处理。
    return resolveExternalSystemJdk(EXTERNAL_SYSTEM_USE_PROJECT_JDK, context)
  }
  if (context.exists && !context.exists(value)) return { ok: false, code: 'UNKNOWN_JDK', message: `指定的 JDK 目录不存在：${value}` }
  return { ok: true, home: value }
}

/** `ExternalSystemTaskActivator.getRunConfigurationActivationTaskName`（`:61-63`）。 */
export function runConfigurationActivationTaskName(configurationName: string): string {
  return `${RUN_CONFIGURATION_TASK_PREFIX}${configurationName}`
}

/** 是不是「运行配置」型激活项（上游 `TaskNode` 与 `RunConfigurationNode` 走同一个激活表）。 */
export function isRunConfigurationTaskName(taskName: string): boolean {
  return taskName.startsWith(RUN_CONFIGURATION_TASK_PREFIX)
}
