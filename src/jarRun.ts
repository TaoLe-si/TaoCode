// JAR 运行配置（`exec/run-instances` 判词缺口⑤「Java 应用/JAR 配置形态」的 JAR 那一半）——
// 上游 `java/execution/impl/src/com/intellij/execution/jar/`。
//
// 上游依据（逐条）：
//   · `JarApplicationConfigurationType.java:19-23` —— 类型 id `"JarApplication"`、
//     名称 `jar.application.configuration.name`、描述 `jar.application.configuration.description`、
//     图标 `AllIcons.FileTypes.Archive`；
//   · `platform/execution/resources/messages/ExecutionBundle.properties:55` name=`JAR Application`、
//     `:54` description=Configuration to run a JAR file using the 'java-jar' command、
//     `:564` label=`Path to &JAR`、`:464` `choose.jar.file`=Choose JAR File、
//     `:565` `label.search.sources.using.module.classpath`、`:191`
//     `run.configuration.working.directory.empty.error`、`:249`
//     `jre.path.is.not.valid.jre.home.error.message`；
//   · `JarApplicationConfigurationType.java:26-28` —— `createTemplateConfiguration` 返回
//     一个 **jarPath 为空串**的 `JarApplicationConfiguration`；
//   · `JarApplicationConfiguration.java:270-278` —— bean 的七个字段与两个默认值
//     （`PASS_PARENT_ENVS = true`，其余空/0）；
//   · `JarApplicationConfiguration.java:70-72` —— `isBuildBeforeLaunchAddedByDefault()` 返回
//     **false**（JAR 配置默认不挂 "Build" 前置步骤）；
//   · `JarApplicationConfiguration.java:241-248` —— `onNewConfigurationCreated`：工作目录空则
//     取项目 base path（`FileUtil.toSystemIndependentName`）；
//   · `JarApplicationConfiguration.java:251-253` —— `canRunOn(target)`：目标里没有 Java 语言
//     运行时就不能跑（目标面在本仓是 `src/executionTargets.ts` 的 JDK 目标）；
//   · `JarApplicationConfiguration.java:256-258` —— 默认语言运行时类型 = `JavaLanguageRuntimeType`；
//   · `JarApplicationConfiguration.java:125-133` —— `checkConfiguration` 的**顺序**：
//     ① `JavaParametersUtil.checkAlternativeJRE` ② 工作目录存在性 ③ jar 文件存在性（**warning**，
//     文案 `dialog.message.jar.file.doesn.t_exist`，见 `java/compiler/openapi/resources/messages/
//     JavaCompilerBundle.properties:282` = `JAR file ''{0}'' doesn''t exist`）；
//   · `JavaParametersUtil.java:214-220` —— 备选 JRE 判据：空或既不是已登记 JDK 又不是 JRE home ⇒
//     警告，文案 `''{0}'' is not a valid JRE home`；
//   · `JarApplicationConfigurable.java` 的 GridConstraints 行序 —— 表单字段顺序：
//     0 `label.path.to.jar` → 1 `CommonJavaParametersPanel` → 2 JRE → 3 模块 classpath 下拉；
//   · `JarApplicationConfigurable.java` —— 浏览按钮只收 `.jar`（`createSingleFileDescriptor("jar")`）、
//     标题 `Choose JAR File`；模块下拉允许空选 = "whole project"；
//   · `JarApplicationCommandLineState.java:24-32` —— 命令行形状：`JavaParametersUtil.configureConfiguration`
//     （VM 参数/工作目录/环境变量）→ `setupJavaParameters` → `params.setJarPath(...)`。
//
// 与上游的如实差异：
//   · **模块 classpath 那一格**（`label.search.sources.using.module.classpath`）本仓不画 ——
//     上游那格要 IDEA 的 Module/依赖图（`ModulesComboBox` 填的是模块），本仓的运行配置没有模块
//     概念（`src/settingsModel.ts` 的 `RunConfig` 只有 `command`/`program`/`args`/`cwd`/`env`）。
//     所以表单字段表里它是 `available: false`，并写明缺什么，不画一个点了没反应的控件。
//   · `RunConfigurationOptions.isAllowRunningInParallel` 那格在 `CommonJavaParametersPanel` 之外的
//     配置级对话框里，本仓统一在 `src/components/RunConfigurationsDialog.vue` 里，不在本模块重复。
//
// 判据 `tests/jar-run.test.mjs`。
import { javaExecutable } from './javaRun.ts'

/** 上游 `JarApplicationConfigurationType` 的构造参数 `"JarApplication"`（`:20`）。 */
export const JAR_APPLICATION_TYPE_ID = 'JarApplication'
/** `jar.application.configuration.name`（`ExecutionBundle.properties:55`）。 */
export const JAR_APPLICATION_TYPE_LABEL = 'JAR Application'
/** `jar.application.configuration.description`（`ExecutionBundle.properties:54`）。 */
export const JAR_APPLICATION_TYPE_DESCRIPTION = "Configuration to run a JAR file using the 'java-jar' command"
/** 上游帮助页（`JarApplicationConfigurationType.getHelpTopic`，`:31-33`）。 */
export const JAR_APPLICATION_HELP_TOPIC = 'reference.dialogs.rundebug.JarApplication'
/**
 * **本仓前端**的 JAR 类型 id（`RunConfig['type']` 那一族里的小写短 id，与 shell/application/debug/compound 同一风格）。
 * 上游注册的 id 是上面那个 `'JarApplication'`（`JarApplicationConfigurationType.java:20` 的
 * `super("JarApplication", ExecutionBundle.message("jar.application.configuration.name"), …)`）——
 * 两个不是同一个东西：上游那个是 `ConfigurationType`/factory 的 id，本仓这个是「配置记录里写的类型值」。
 */
export const JAR_RUN_CONFIG_TYPE_ID = 'jar'

/** bean 的七个字段（`JarApplicationConfiguration.java:270-278`）。 */
export interface JarApplicationConfiguration {
  /** `JAR_PATH`（`:271`），空串 = 还没选。 */
  jarPath: string
  /** `VM_PARAMETERS`（`:272`），如 `-Xmx512m`。 */
  vmParameters: string
  /** `PROGRAM_PARAMETERS`（`:273`），`java -jar` 之后那一串。 */
  programParameters: string
  /** `WORKING_DIRECTORY`（`:274`）。 */
  workingDirectory: string
  /** `ALTERNATIVE_JRE_PATH_ENABLED`（`:275`）。 */
  alternativeJrePathEnabled: boolean
  /** `ALTERNATIVE_JRE_PATH`（`:276`）。 */
  alternativeJrePath: string
  /** `PASS_PARENT_ENVS`（`:277`），**默认 true**。 */
  passParentEnvs: boolean
}

/**
 * 模板配置（上游 `createTemplateConfiguration`，`JarApplicationConfigurationType.java:26-28`）：
 * jarPath 空串 + bean 默认值 + `onNewConfigurationCreated` 把工作目录填成项目 base path
 * （`JarApplicationConfiguration.java:241-248`）。`PASS_PARENT_ENVS` 保持上游的 **true**。
 */
export function jarTemplateConfiguration(basePath = ''): JarApplicationConfiguration {
  return {
    jarPath: '',
    vmParameters: '',
    programParameters: '',
    workingDirectory: basePath.replace(/\\/g, '/'),
    alternativeJrePathEnabled: false,
    alternativeJrePath: '',
    passParentEnvs: true,
  }
}

/** 表单字段（`JarApplicationConfigurable` 的 GridConstraints 行序：jar 路径 → 通用参数 → JRE → 模块）。 */
export interface JarFormField {
  id: 'jarPath' | 'programParameters' | 'vmParameters' | 'workingDirectory' | 'alternativeJrePath' | 'moduleClasspath'
  label: string
  /** 本仓能不能画（false 的那一格在模块注释里写明缺什么，不画假控件）。 */
  available: boolean
  /** 浏览按钮的文件过滤（上游只收 `.jar`，`JarApplicationConfigurable` 的 `createSingleFileDescriptor("jar")`）。 */
  browse?: { title: string; extensions: readonly string[] }
}

export const JAR_FORM_FIELDS: readonly JarFormField[] = [
  { id: 'jarPath', label: 'Path to JAR', available: true, browse: { title: 'Choose JAR File', extensions: ['jar'] } },
  { id: 'programParameters', label: 'Program arguments', available: true },
  { id: 'vmParameters', label: 'VM options', available: true },
  { id: 'workingDirectory', label: 'Working directory', available: true },
  { id: 'alternativeJrePath', label: 'JRE', available: true },
  // 模块 classpath：上游 `label.search.sources.using.module.classpath`，本仓没有 Module/依赖图 ⇒ 不画。
  { id: 'moduleClasspath', label: "Search sources using module's classpath", available: false },
]

export interface JarValidationProblem {
  /** `error` 挡住启动；`warning` 只提示（上游 `RuntimeConfigurationWarning`）。 */
  severity: 'error' | 'warning'
  field: JarFormField['id'] | 'none'
  message: string
}

/** 文件系统问询由调用方注入（前端模块不该自己摸盘）。 */
export interface JarValidationEnv {
  fileExists(path: string): boolean
  isDirectory(path: string): boolean
}

/**
 * `checkConfiguration`（`JarApplicationConfiguration.java:125-133`）的等价物，**保持上游的顺序**：
 * ① 备选 JRE → ② 工作目录 → ③ jar 文件。① ② 抛的是 warning（上游三个都是
 * `RuntimeConfigurationWarning`），所以这里都记 `warning`，不擅自升级成 error。
 *
 * 工作目录「不存在」那一条的**上游文案是有出处的**（早先这里写着「无法核实」，是假的 ——
 * 按 `java/execution/...` 猜路径搜不到，不等于上游没有）：
 * 抛点在 `platform/execution-impl/src/com/intellij/execution/util/ProgramParametersConfigurator.java:260-261`
 * `throw new RuntimeConfigurationWarning(ExecutionBundle.message("dialog.message.working.directory.doesn.t.exist", workingDir))`，
 * 键值在 `platform/execution/resources/messages/ExecutionBundle.properties:532`
 * `Working directory ''{0}'' doesn''t exist`（渲染后 = `Working directory '<路径>' doesn't exist`）。
 * 空目录那条则是 `run.configuration.working.directory.empty.error`（同文件 `:191`）。
 */
export function jarValidation(config: JarApplicationConfiguration, env: JarValidationEnv): JarValidationProblem[] {
  const problems: JarValidationProblem[] = []
  if (config.alternativeJrePathEnabled) {
    const jre = config.alternativeJrePath.trim()
    if (!jre) problems.push({ severity: 'warning', field: 'alternativeJrePath', message: "'' is not a valid JRE home" })
  }
  const cwd = config.workingDirectory.trim()
  if (!cwd) {
    problems.push({ severity: 'warning', field: 'workingDirectory', message: 'Working directory is not specified' })
  } else if (!env.isDirectory(cwd)) {
    problems.push({ severity: 'warning', field: 'workingDirectory', message: `Working directory '${cwd}' doesn't exist` })
  }
  const jar = config.jarPath.trim()
  if (!jar || !env.fileExists(jar)) {
    // 上游 `dialog.message.jar.file.doesn.t.exist`（`JavaCompilerBundle.properties:282`）：
    // `JAR file ''{0}'' doesn''t exist`，占位符传的是**绝对路径**（`:130` 的 jarFile.getAbsolutePath()）。
    problems.push({ severity: 'warning', field: 'jarPath', message: `JAR file '${jar}' doesn't exist` })
  }
  return problems
}

/**
 * `canRunOn`（`JarApplicationConfiguration.java:251-253`）：目标里没有 Java 语言运行时就跑不了。
 * 本仓的目标面是 `src/executionTargets.ts` 的本机 + JDK 目标，判定「这个目标是不是 Java 运行时」
 * 由调用方给（本模块不反向依赖目标表）。
 */
export function jarCanRunOn(target: { hasJavaRuntime: boolean } | null): boolean {
  return target === null || target.hasJavaRuntime
}

export interface JarCommandInput {
  config: JarApplicationConfiguration
  /** 目标 JDK 的 home；没给就退回 `JAVA_HOME`（上游 `JavaParametersUtil.createProjectJdk` 的退化路径）。 */
  jdkHome?: string
}

/**
 * `java -jar <path> <programParameters>`（`JarApplicationCommandLineState.java:24-32` 的形状：
 * 备选 JRE → `configureConfiguration`（VM 参数/工作目录/环境）→ `setJarPath`）。
 * 返回 argv（不给引号 —— 引号是 shell 层的事，与 `src/javaRun.ts` 的 `javaRunCommand` 分工一致）。
 */
export function jarRunArgs(input: JarCommandInput): string[] {
  const { config } = input
  const jdkHome = (config.alternativeJrePathEnabled ? config.alternativeJrePath.trim() : input.jdkHome ?? '').trim()
  if (!jdkHome) return []
  const executable = javaExecutable(jdkHome)
  const vm = config.vmParameters.trim()
  // 参数串按 `ParametersListUtil.parse` 的口径切成 argv（引号成对、忽略空段）。
  const args = [...(vm ? splitParameters(vm) : []), '-jar', config.jarPath.trim(), ...splitParameters(config.programParameters)]
  return [executable, ...args]
}

/** 命令行文本（跑在 shell 里时用）。路径/jar 名含空格要引号，与 `javaRunCommand` 同一规则。 */
export function jarRunCommand(input: JarCommandInput): string {
  const args = jarRunArgs(input)
  if (!args.length) return ''
  return args.map(arg => (arg && !/[\s"]/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`)).join(' ')
}

/** 工作目录（空串 ⇒ 用进程默认目录；上游 `WORKING_DIRECTORY` 空就是空）。 */
export function jarWorkingDirectory(config: JarApplicationConfiguration): string {
  return config.workingDirectory.trim()
}

/**
 * 环境变量：上游 `EnvironmentVariablesComponent` + `PASS_PARENT_ENVS`（`:230-238`）。
 * `passParentEnvs=false` 时只留配置里显式给的（这是上游把父进程环境从 `JavaParameters` 里剔掉的语义）。
 */
export function jarEnvironment(config: JarApplicationConfiguration, configured: readonly string[] = [], parent: readonly string[] = []): string[] {
  const lines = [...(config.passParentEnvs ? parent : []), ...configured]
  return [...new Set(lines.map(line => line.trim()).filter(Boolean))]
}

/**
 * 拆参数串：`ParametersListUtil.parse` 的可移植子集 —— 成对引号内的空白算一段，
 * 反斜杠转义引号（与 `src/runConfigTree.ts` 的 `parseRunArguments` 同一族口径）。
 */
export function splitParameters(text: string): string[] {
  const out: string[] = []
  let token = ''
  let quoted = false
  let escaped = false
  let started = false
  for (const ch of text) {
    if (escaped) { token += ch; escaped = false; started = true; continue }
    if (ch === '\\') { escaped = true; started = true; continue }
    if (ch === '"') { quoted = !quoted; started = true; continue }
    if (!quoted && /\s/.test(ch)) {
      if (started) { out.push(token); token = ''; started = false }
      continue
    }
    token += ch
    started = true
  }
  if (started) out.push(token)
  return out
}

// ── 本仓 `RunConfig` 形状的那一套（配置记录 ⇄ 表单 ⇄ 落盘 ⇄ 执行参数） ─────────────────────
//
// 上面那半守的是**上游的 bean**（`JarApplicationConfiguration` 的七个字段）；这一半守的是**本仓的记录形状**：
// JAR 配置在 `src/settingsModel.ts` 的 `RunConfig` 里不新增字段（`native/settings_schema.cpp` 的 `known_keys`
// 因此不用扩），入口写在现成的两格里 ——
//   · `program` = Java 可执行文件（上游表单的 JRE 那一格，`JarApplicationConfigurable.java:67-71` 的 `JrePathEditor`）；
//   · `args`    = VM 参数 → `-jar` → JAR 路径 → 程序参数（与 `jarRunArgs():187` 产出的 argv **完全同形**）。
// 落点（五处，全部由本模块给单一事实来源）：新建配置表单 = `src/runConfigEditors.ts` 的
// `RUN_CONFIG_TYPE_FAMILY_EDITORS.jar`、schema 校验 = `src/runConfigurationSchema.ts` 的
// `normalizeRunConfigurations`（调 `jarRunConfigProblem`）、持久化 = 同一份清单 `RUN_CONFIG_TYPE_IDS`、
// 执行参数 = 本文件的 `jarRunConfigParams`、树里显示 = `src/runConfigTree.ts` 的 `RUN_CONFIG_TYPE_FAMILY_LABELS`。
// 判据 tests/jar-run.test.mjs + tests/run-config-types.test.mjs。

/**
 * JAR 配置读得懂的最小形状。**故意把 `type` 放宽成 `string`**：
 * `settingsModel.ts` 的 `RunConfig['type']` 联合里现在还没有 `'jar'`（保留文件，接线请求见
 * `docs/wiring-requests-2026-10-06-runcfg3.md`），直接写 `config.type === 'jar'` 会撞 TS2367
 * 「两种类型没有重叠」；结构上 `RunConfig` 满足这个接口 ⇒ 联合加宽之后调用方一个字都不用改。
 */
export interface JarRunConfigLike {
  name: string
  type?: string
  command: string
  program?: string
  args?: string[]
  cwd?: string
  env?: string[]
}

/** 这条配置是不是 JAR 配置（字符串比较，绕开上面那个 TS2367）。 */
export function isJarRunConfig(config: { type?: string }): boolean {
  return config.type === JAR_RUN_CONFIG_TYPE_ID
}

/**
 * 取 JAR 路径：`args` 里 `-jar` 后面那一段；只有 `command` 时按 `splitParameters` 切成 argv 再找
 * （表单允许把整串写在命令格里 `java -jar build/app.jar`，与 `jarRunCommand():192-196` 同形）。
 * 找不到返回**空串** —— 空串不是「静默跳过」的意思，调用方必须报错（`jarRunConfigProblem` / `jarRunConfigParams`）。
 * `-jar` 出现在最后一位（后面没有值）也算没填。
 */
export function jarRunConfigPath(config: JarRunConfigLike): string {
  const argv = config.args?.length ? config.args : splitParameters(config.command)
  for (let index = 0; index + 1 < argv.length; ++index)
    if (argv[index] === '-jar') return (argv[index + 1] ?? '').trim()
  return ''
}

/**
 * JAR 配置的**入口判据**：没有 JAR 路径 ⇒ 明确报错，不静默。
 * 严重级别取上游的致命档（`RunConfiguration.java:156-167` 的 `RuntimeConfigurationError`，注释写明「致命，无法执行」）：
 * 上游 `JarApplicationConfiguration.java:128-131` 只对**文件不存在**给 warning（那是 jarPath 已经填了的情况），
 * 而 jarPath 空串时 `JarApplicationCommandLineState.java:24` 的 `params.setJarPath(...)` 拼出来的是
 * 一条没有 jar 的 `java` 命令行 —— 本仓提前在编辑器/落盘/启动三处都报同一句，不把它留到进程里炸。
 * 文案点名上游表单那一格（`label.path.to.jar` = `Path to &JAR`，`ExecutionBundle.properties:564`）。
 */
export function jarRunConfigProblem(config: JarRunConfigLike): string | null {
  if (!isJarRunConfig(config)) return null
  if (!jarRunConfigPath(config))
    return `JAR 配置「${config.name}」没有 JAR 路径：参数里要写 -jar <路径>（上游表单的 Path to JAR 那一格）。`
  return null
}

export interface JarRunConfigParamsOptions {
  /** 项目 JDK（`projectSettings.java.jdkHome`）：配置的「Java 可执行文件」那格空着时的退化，
   *  与上游 `JarApplicationCommandLineState.java:20-21` 的 `createProjectJdk(project, jreHome)` 同一口径。 */
  jdkHome?: string
}

/** argv 的第一段是不是 java 启动器（`command` 那一格常写整串，`program` 要单独给时得把它剥掉）。 */
function isJavaLauncher(token: string): boolean {
  const name = (token.split(/[\\/]/).pop() ?? '').toLowerCase()
  return /^(java|javaw)(\.exe)?$/.test(name)
}

/**
 * JAR 配置的**执行参数**（本仓启动链路要的那三个字段：`program` + `args` + 不走 shell）。
 * 与上面 bean 版 `jarRunArgs()` 的分工：那条在 JDK 空时返回 `[]`（静默，判据 `tests/jar-run.test.mjs:89` 钉着），
 * 这一条给的是「为什么跑不了」—— 缺 JAR 路径或缺 Java 可执行文件都**抛错**。
 * 顺序照 `jarRunArgs():187`：VM 参数 → `-jar` 路径 → 程序参数。
 */
export function jarRunConfigParams(config: JarRunConfigLike, options: JarRunConfigParamsOptions = {}): { program: string; args: string[]; shell: false } {
  const problem = jarRunConfigProblem(config)
  if (problem) throw new Error(problem)
  const jdkHome = (options.jdkHome ?? '').trim()
  const program = (config.program ?? '').trim() || (jdkHome ? javaExecutable(jdkHome) : '')
  if (!program)
    // 上游这里退到项目 JDK；本仓没有 JDK 就没有 `java`，不能给一条跑不了还装作跑得了的参数。
    // 文案里的坐标：JRE 那一格 = `JarApplicationConfigurable.java:67-71` 的 `JrePathEditor`，
    // 判据 = `JavaParametersUtil.java:214-220`（'' is not a valid JRE home）。
    throw new Error(`JAR 配置「${config.name}」没有 Java 可执行文件：填「Java 可执行文件」那一格，或在项目设置里选 JDK（上游 JRE 那一格）。`)
  const argv = (config.args?.length ? [...config.args] : splitParameters(config.command))
  if (argv.length && isJavaLauncher(argv[0]!) && program.toLowerCase().includes(argv[0]!.toLowerCase())) argv.shift()
  return { program, args: argv, shell: false }
}

/** 工作目录（本仓形状：`cwd`；上游 `WORKING_DIRECTORY` 空就是空，见 `jarWorkingDirectory()`）。 */
export function jarRunConfigWorkingDirectory(config: JarRunConfigLike): string {
  return (config.cwd ?? '').trim()
}
