// 任务执行设置的**编辑面与存储**（上游 `ExternalSystemEditTaskDialog`，判词 es/execution：
// 「任务编辑对话框（ExternalSystemEditTaskDialog 的任务名/VM 参数/脚本参数/env 编辑面 —— 本仓
// Gradle 任务仍折成一条普通命令，这些字段没有输入口」）。
//
// 上游坐标（逐条实读 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · 对话框本体 `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/execution/ExternalSystemEditTaskDialog.java`：
//     `:25-37` 构造（标题 = `tasks.edit.task.title`，`ExternalSystemBundle.properties:134` = `Edit {0} Task`），
//     `:60-64` doOKAction → `myControl.apply(myTaskExecutionSettings)`（不 apply 不落盘）。
//   · 字段面 `service/execution/ExternalSystemTaskSettingsControl.java:66-103`：
//     `{0} project:`（properties:110）/ `Tasks:`（:111）/ `VM options:`（:112）/ `Arguments:`（:113）
//     / `EnvironmentVariablesComponent`（:98）；项目选择标题 properties:37 `{0} Project:`。
//     reset `:105-127`：任务名用空格连接回填；apply `:145-155`：任务文本 → `ParametersList.parse`（:149）、
//     VM 原文（:151）、脚本参数原文（:152）、passParentEnvs（:153）、env 表（:154）。
//     （**订正留痕**：这一段原写「apply `:143-152`」「parse 在 :147」「VM :148 / 参数 :149 / env :150-151」，
//     本轮重数 `ExternalSystemTaskSettingsControl.java`（共 177 行）后按实际行号改指：`:143` 是上一个
//     方法 `isModified` 的收尾花括号，`apply` 的签名在 `:146`，各字段的写入行整体下移 3 行。）
//   · 入口 `service/execution/ExternalSystemBeforeRunTaskProvider.java:59-60`：
//     `configureTask` 直接开 `ExternalSystemEditTaskDialog(project, task.getTaskExecutionSettings(), systemId)`。
//   · 字段本体 `platform/external-system-api/src/com/intellij/openapi/externalSystem/model/execution/ExternalSystemTaskExecutionSettings.java`
//     `:33` taskNames、`:39` vmOptions、`:40` scriptParameters、`:43` passParentEnvs（默认 true）。
//   · 执行侧消费 `service/internal/ExternalSystemExecuteTaskTask.java:41-44,80-82`：
//     vmOptions → `specBuilder.withVmOptions`、scriptParameters → 命令行参数、env → `withEnvironmentVariables`。
//   · 复用口径 `service/task/ui/ExternalSystemTasksTree.java:183-190`：同一 (系统 id, 工程路径) 上一次
//     跑任务用的 vmOptions/scriptParameters 会被带到下一次执行 —— 所以这些设置要**按工程存住**，不是每次现填。
//
// 本仓落点：
//   · 存储 = localStorage，按工作区根分键（与 `src/externalProjectModel.ts` 的激活表同一先例；
//     宿主设置 schema 里没有这块位，`native/settings_schema.*` 是保留文件）。
//   · 执行消费在 `src/gradleHost.ts` 的 `runTask` / `saveTaskAsRunConfig`：
//     任务名与脚本参数折进命令行；VM 选项与 env 只有**原生 Gradle 通道**能带
//     （`native/gradle.cpp` 的 `env` 叠在继承来的环境之上），运行控制台那条通道只有一条命令字符串。
//   · VM 选项的落地机制 = `GRADLE_OPTS`：Gradle 包装脚本自己的说明就写明它是给启动 JVM 的
//     （`platform/execution-process-mediator/common/gradlew:168` `:202`、`gradlew.bat:36`）。
//   · `passParentEnvs`（上游 EnvironmentVariablesComponent 的「继承父环境」勾选）**不渲染**：
//     本仓通道只会「在继承来的环境之上叠」，做不到「不继承」，画出来就是假控件（铁律 §3）。
//   · 运行配置的形状只有 {name, command}（`src/bridge.ts` 的 addRunConfiguration，宿主在 App.vue、冻结），
//     所以「存成运行配置」只带任务名与脚本参数；VM 选项/env 在直接运行时生效。

import type { ExternalProjectStore } from './externalProjectModel.ts'
import { splitScriptParameters } from './externalSystemTask.ts'

/** `ExternalSystemTaskExecutionSettings` 的可落盘字段面（bean `:33/:39/:40`，env 见 control apply `:150-151`）。 */
export interface TaskExecutionSettings {
  /** `getTaskNames()`：一次执行的任务名列表（可多于一项，上游允许 `clean build` 连跑）。 */
  taskNames: string[]
  /** `getVmOptions()`：给启动 JVM 的 VM 参数原文。 */
  vmOptions: string
  /** `getScriptParameters()`：原样追加到任务之后的脚本参数原文。 */
  scriptParameters: string
  /** `getEnv()`：`KEY=VALUE` 环境变量表。 */
  env: Record<string, string>
}

export const EMPTY_TASK_SETTINGS: TaskExecutionSettings = { taskNames: [], vmOptions: '', scriptParameters: '', env: {} }

/** 对话框文本 → 设置（control apply `:143-152`）：任务文本按 `ParametersList.parse` 口径切（尊重引号，等价子集在 `externalSystemTask.ts:splitScriptParameters`）。 */
export function taskSettingsFromDialog(input: {
  tasksText: string
  vmOptions?: string
  scriptParameters?: string
  envText?: string
}): TaskExecutionSettings {
  const parsed = parseEnvironmentLines(input.envText ?? '')
  return {
    taskNames: splitScriptParameters(input.tasksText),
    vmOptions: (input.vmOptions ?? '').trim(),
    scriptParameters: (input.scriptParameters ?? '').trim(),
    env: parsed.values,
  }
}

/** `EnvironmentVariablesComponent` 的表 ↔ 文本行（每行一个 `KEY=VALUE`；不带 `=` 的行是无效行，回读时点名）。 */
export function parseEnvironmentLines(text: string): { values: Record<string, string>; invalid: string[] } {
  const values: Record<string, string> = {}
  const invalid: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const index = line.indexOf('=')
    if (index <= 0) { invalid.push(line.trim()); continue }
    values[line.slice(0, index).trim()] = line.slice(index + 1)
  }
  return { values, invalid }
}

export function formatEnvironmentLines(values: Record<string, string>): string {
  return Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')
}

/** 打开对话框时的回填（control reset `:105-127`）：任务文本 = 存过的任务名空格连接，没存过就是点到的那个任务。 */
export function taskDialogDefaults(settings: TaskExecutionSettings | null, clickedTask: string): {
  tasksText: string; vmOptions: string; scriptParameters: string; envText: string
} {
  const own = settings ?? EMPTY_TASK_SETTINGS
  return {
    tasksText: own.taskNames.length ? own.taskNames.join(' ') : clickedTask,
    vmOptions: own.vmOptions,
    scriptParameters: own.scriptParameters,
    envText: formatEnvironmentLines(own.env),
  }
}

/** 与「点了任务、别的都没填」等价 ⇒ 存回默认 = 删掉这条（别在表里堆空壳）。 */
export function taskSettingsIsDefault(settings: TaskExecutionSettings, clickedTask: string): boolean {
  return !settings.vmOptions && !settings.scriptParameters && !Object.keys(settings.env).length
    && (settings.taskNames.length === 0 || (settings.taskNames.length === 1 && settings.taskNames[0] === clickedTask))
}

/**
 * 把一次执行的任务名与脚本参数折进命令串。
 * `base` 是已经拼好的单任务命令（`gradle --console=plain [-p dir] :app:build …`）；
 * 追加顺序 = 上游 bean 的组装顺序（任务名在前、脚本参数在后，`ExternalSystemExecuteTaskTask.java:42,80`），
 * 点击的那个任务保持在它原来的位置，其余任务名与参数原文跟在末尾
 * （参数原文直接跟在后面 —— 命令行由 cmd.exe 执行，用户写的引号由 shell 自己解释，不再二次转义）。
 */
export function composeTaskRunCommand(base: string, settings: TaskExecutionSettings | null, clickedTask?: string): string {
  if (!settings || taskSettingsIsDefault(settings, clickedTask ?? '')) return base
  const extras = settings.taskNames.filter(name => name !== (clickedTask ?? '')).join(' ')
  const tail = [extras, settings.scriptParameters].filter(Boolean).join(' ')
  return tail ? `${base} ${tail}` : base
}

/** 需要「能带环境变量」的原生通道跑的判据（控制台通道只有一条命令字符串）。 */
export function taskNeedsEnvironment(settings: TaskExecutionSettings | null): boolean {
  return Boolean(settings && (settings.vmOptions || Object.keys(settings.env).length))
}

/**
 * 执行环境变量（`ExternalSystemExecuteTaskTask.java:80-82` 的 withVmOptions + withEnvironmentVariables 的
 * CLI 等价物）：先保留调用方已有的 `JAVA_HOME` 之类（Gradle JVM），再叠 `GRADLE_OPTS`（VM 选项），
 * 最后叠用户的环境变量 —— 后写的赢，用户明确写了 `GRADLE_OPTS` 就用他的。
 */
export function taskRunEnvironment(settings: TaskExecutionSettings, baseEnvironment: readonly string[]): string[] {
  const env = [...baseEnvironment]
  if (settings.vmOptions) env.push(`GRADLE_OPTS=${settings.vmOptions}`)
  for (const key of Object.keys(settings.env).sort()) env.push(`${key}=${settings.env[key]}`)
  return env
}

// ── 存储（按工作区根分键；形状与 `externalProjectModel.ts` 的激活表同一族）──────────────

const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')

export function taskSettingsKey(workspaceRoot: string): string {
  return `taocode.externalSystem.taskSettings.${normalize(workspaceRoot)}`
}

/** `{ [构建目录]: { [任务名]: 设置 } }`（`ExternalSystemTasksTree.java:183` 的复用键：按工程 + 任务）。 */
export type TaskSettingsMap = Record<string, Record<string, TaskExecutionSettings>>

function parseSettings(raw: unknown): TaskExecutionSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const taskNames = Array.isArray(value.taskNames)
    ? value.taskNames.filter((name): name is string => typeof name === 'string' && name.trim() !== '').map(name => name.trim())
    : []
  const env: Record<string, string> = {}
  if (value.env && typeof value.env === 'object') {
    for (const [key, item] of Object.entries(value.env as Record<string, unknown>))
      if (typeof item === 'string' && key.trim()) env[key.trim()] = item
  }
  return {
    taskNames,
    vmOptions: typeof value.vmOptions === 'string' ? value.vmOptions : '',
    scriptParameters: typeof value.scriptParameters === 'string' ? value.scriptParameters : '',
    env,
  }
}

export function parseTaskSettingsMap(raw: string | null): TaskSettingsMap {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as { settings?: unknown }
    const source = parsed && typeof parsed === 'object' && parsed.settings && typeof parsed.settings === 'object'
      ? parsed.settings as Record<string, unknown> : {}
    const map: TaskSettingsMap = {}
    for (const [directory, entry] of Object.entries(source)) {
      if (!entry || typeof entry !== 'object') continue
      const bucket: Record<string, TaskExecutionSettings> = {}
      for (const [task, value] of Object.entries(entry as Record<string, unknown>)) {
        const settings = parseSettings(value)
        if (settings) bucket[task] = settings
      }
      if (Object.keys(bucket).length) map[normalize(directory)] = bucket
    }
    return map
  } catch {
    return {}
  }
}

export function loadTaskSettingsMap(store: ExternalProjectStore | null, workspaceRoot: string): TaskSettingsMap {
  if (!store || !workspaceRoot) return {}
  try { return parseTaskSettingsMap(store.getItem(taskSettingsKey(workspaceRoot))) } catch { return {} }
}

export function saveTaskSettingsMap(store: ExternalProjectStore | null, workspaceRoot: string, map: TaskSettingsMap): boolean {
  if (!store || !workspaceRoot) return false
  const settings: TaskSettingsMap = {}
  for (const [directory, bucket] of Object.entries(map)) if (bucket && Object.keys(bucket).length) settings[normalize(directory)] = bucket
  try {
    if (!Object.keys(settings).length && store.removeItem) { store.removeItem(taskSettingsKey(workspaceRoot)); return true }
    store.setItem(taskSettingsKey(workspaceRoot), JSON.stringify({ settings }))
    return true
  } catch {
    return false
  }
}

export function taskSettingsForBuild(map: TaskSettingsMap, directory: string, task: string): TaskExecutionSettings | null {
  return map[normalize(directory)]?.[task] ?? null
}

/** 写一条；传 null 或「等于没编辑」的形状就删（空壳不落盘）。 */
export function withTaskSettings(map: TaskSettingsMap, directory: string, task: string, settings: TaskExecutionSettings | null): TaskSettingsMap {
  const key = normalize(directory)
  const bucket = { ...(map[key] ?? {}) }
  const keep = settings && !taskSettingsIsDefault(settings, task) ? settings : null
  if (keep) bucket[task] = keep; else delete bucket[task]
  const next: TaskSettingsMap = { ...map }
  if (Object.keys(bucket).length) next[key] = bucket; else delete next[key]
  return next
}

/** 取消链接一个 build 后丢掉它的任务设置（与激活表的 `tasksActivationForLinkedBuilds` 同一口径）。 */
export function taskSettingsForLinkedBuilds(map: TaskSettingsMap, linkedPaths: readonly string[]): TaskSettingsMap {
  const linked = new Set(linkedPaths.map(normalize))
  const next: TaskSettingsMap = {}
  for (const [path, bucket] of Object.entries(map)) if (linked.has(normalize(path))) next[path] = bucket
  return next
}
