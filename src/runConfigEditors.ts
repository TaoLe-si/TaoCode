// 每种运行配置类型一套设置编辑器 + 逐类型校验
// （上游 `getConfigurationEditor()` / `SettingsEditor` / `checkConfiguration()` 的等价物）。
//
// 上游出处：
//   platform/execution-impl/.../ConfigurationSettingsEditor.java:59-88
//       标签宿主：per-type 编辑器决定标签页集合 —— 编辑器本身是 `SettingsEditorGroup` 就一个
//       编辑器一页签(:79-84)，否则只有一个内建页签，标题取
//       `run.configuration.configuration.tab.title`（:86-87，zh 文案「配置」）。
//       ⇒ **页签集合由配置类型决定**，不是一张通用表单。
//   platform/execution/src/com/intellij/execution/configurations/RunConfiguration.java:156-167
//       `checkConfiguration()` 的三档严重级别：RuntimeConfigurationWarning（提醒）/
//       RuntimeConfigurationException（非致命错误，仍允许执行）/ RuntimeConfigurationError
//       （致命，无法执行）。注释 :158 还写明「每敲一个字都可能被调用」⇒ 校验必须能实时算。
//   platform/execution-impl/.../compound/CompoundRunConfiguration.kt:113-123
//       每类型一套编辑器的落点 `getConfigurationEditor()`；`checkConfiguration()` 两条：
//       成员为空 ⇒ 「There is nothing to run」；没有可用目标 ⇒ 「No suitable targets to run on…」
//       （两条的中文文案见 ExecutionBundle.properties:19/:20 的 zh 包）。
//   platform/execution-impl/.../compound/CompoundRunConfigurationSettingsEditor.java:57-76/92-96
//       成员表的环检测（含嵌套复合与「运行前任务里引用别的配置」），违例文案
//       `{0} ''{1}'' causes dependency cycle and cannot be added`（zh：会导致依赖关系循环，无法添加）。
//   platform/execution-impl/.../ConfigurationSettingsEditorWrapper.java:71-74
//       复合配置（`WithoutOwnBeforeRunSteps`）不显示「启动前」行；「允许并行」复选框只挂在模板上。
//
// 与上游的差异（如实登记，不假装一致）：
//   * 上游每种类型一个 Swing `SettingsEditor` 类；本仓一张 Vue 表单，**字段集合由类型决定**
//     （`RUN_CONFIG_EDITORS`），这是同一种行为在本仓架构下的形状。
//   * 上游的复合配置空成员是非致命异常（RunConfiguration.java:161-162，允许保存）；本仓沿用
//     既有行为「保存时就拦」（RunConfigurationsDialog.vue 的既有 guard）+ 启动前再拦一次
//     （src/runConfigTree.ts:131）。
//   * 上游的配置类型远多于本仓的四种（Application/Shell Script/Maven/Gradle/Python/…），
//     本仓只有 RUN_CONFIG_TYPES 里的 shell/application/debug/compound 四种，故表也只有四行。
//
// 纯函数，判据 tests/run-config-types.test.mjs。

import { runConfigClosure, validateFolderName } from './runConfigTree.ts'
import type { RuntimeRunConfig as RunConfig } from './runTargets.ts'
import { validateTargetEnvironment, type TargetEnvironment } from './targetEnvironments.ts'
import { languageRuntimeType } from './languageRuntimes.ts'

export type RunConfigFieldId = 'command' | 'program' | 'args' | 'cwd' | 'adapter' | 'env' | 'beforeLaunch' | 'members'

export interface RunConfigFieldDef {
  id: RunConfigFieldId
  label: string
  placeholder?: string
  /** 块级（占满一行）的多行输入。 */
  block?: boolean
  rows?: number
  /** 字段下方的说明（上游编辑器里的 hint/comment）。 */
  hint?: string
}

export interface RunConfigEditorDef {
  typeId: NonNullable<RunConfig['type']>
  /** 上游内建页签标题（zh 文案「配置」，ConfigurationSettingsEditor.java:86）。 */
  tabTitle: string
  /** 该类型的字段，顺序即表单顺序。 */
  fields: readonly RunConfigFieldDef[]
  /** 「这个配置靠哪个字段跑起来」——空行提示与校验都以它为准。 */
  primary: 'command' | 'program' | 'members'
  /** 复合配置不显示「启动前」行（`WithoutOwnBeforeRunSteps`，ConfigurationSettingsEditorWrapper.java:71）。 */
  withoutOwnBeforeRunSteps?: boolean
}

const COMMAND: RunConfigFieldDef = { id: 'command', label: '命令', placeholder: 'cmake --build build' }
const PROGRAM: RunConfigFieldDef = { id: 'program', label: '程序', placeholder: 'build/app.exe' }
const ARGS: RunConfigFieldDef = { id: 'args', label: '参数', placeholder: '--flag value' }
const CWD: RunConfigFieldDef = { id: 'cwd', label: '工作目录', placeholder: '项目根' }
const ADAPTER: RunConfigFieldDef = { id: 'adapter', label: '适配器', placeholder: '来自 TaoCode.dap.json 的 kind' }
const ENV: RunConfigFieldDef = {
  id: 'env', label: '环境变量', block: true, rows: 3, placeholder: 'KEY=value（每行一个）',
  hint: '一行一个 KEY=VALUE；某一步起不来的话可以在这里补 PATH 之类的环境。',
}
const BEFORE: RunConfigFieldDef = {
  id: 'beforeLaunch', label: '启动前', block: true, rows: 3, placeholder: '构建|cmake --build build（每行 name|command）',
  hint: '对应 IDEA 的「Before launch」：步骤按顺序执行，某一步非零退出会中止整个配置。',
}
const MEMBERS: RunConfigFieldDef = { id: 'members', label: '成员配置', block: true }

/**
 * 逐类型的编辑器定义。
 *  · shell       —— 上游 Shell Script 类型：脚本/命令是主体（`ShellRunConfiguration` 的
 *                  scriptText + interpreter），参数、工作目录、环境变量挂在同一层。
 *  · application —— 上游 Application 类型：主类 + 模块 + classpath + JRE + VM 选项 + 程序参数
 *                  + 工作目录 + 环境变量；本仓把它落在「程序 + 参数 + 工作目录 + 环境变量」。
 *  · debug       —— 同 application，另加一行调试适配器（**本仓自己的字段**：上游没有，
 *                  调试器由 ProgramRunner/XDebugger 决定，见 exec/xdebugger 族）。
 *  · compound    —— 上游只有一张成员表（`CompositeSettingsEditor`，CompoundRunConfiguration.kt:113）。
 */
export const RUN_CONFIG_EDITORS: Record<NonNullable<RunConfig['type']>, RunConfigEditorDef> = {
  shell: {
    typeId: 'shell', tabTitle: '配置', primary: 'command',
    fields: [COMMAND, ARGS, CWD, ENV, BEFORE],
  },
  application: {
    typeId: 'application', tabTitle: '配置', primary: 'program',
    fields: [PROGRAM, ARGS, CWD, ENV, BEFORE],
  },
  debug: {
    typeId: 'debug', tabTitle: '配置', primary: 'program',
    fields: [PROGRAM, ADAPTER, ARGS, CWD, ENV, BEFORE],
  },
  compound: {
    typeId: 'compound', tabTitle: '配置', primary: 'members', withoutOwnBeforeRunSteps: true,
    fields: [MEMBERS],
    // 成员表的说明与提示由对话框提供（要列出可选项），这里只给静态部分。
  },
}

export function runConfigEditorFor(type: RunConfig['type'] | undefined): RunConfigEditorDef {
  return RUN_CONFIG_EDITORS[type ?? 'shell']
}

/** 字段在这个配置里是否有值（决定「有值的字段即使不属于该类型也要留着」）。 */
function fieldHasValue(field: RunConfigFieldId, config: RunConfig): boolean {
  switch (field) {
    case 'command': return !!config.command?.trim()
    case 'program': return !!config.program?.trim()
    case 'args': return !!config.args?.length
    case 'cwd': return !!config.cwd?.trim()
    case 'adapter': return !!config.adapter?.trim()
    case 'env': return !!config.env?.length
    case 'beforeLaunch': return !!config.beforeLaunch?.length
    case 'members': return !!config.configurations?.length
  }
}

const FIELD_DEFS: Record<RunConfigFieldId, RunConfigFieldDef> = {
  command: COMMAND, program: PROGRAM, args: ARGS, cwd: CWD, adapter: ADAPTER, env: ENV, beforeLaunch: BEFORE, members: MEMBERS,
}

/**
 * 该类型实际要渲染的字段：类型声明的字段，**外加当前配置里已经有值的字段**。
 * 为什么要并集：上游换配置类型时编辑器是重建的，字段换了就换掉了；本仓的配置可以随时改类型
 * （对话框里那个「类型」下拉），如果只渲染类型声明的字段，一个已经填了 `program` 的配置被改成
 * `shell` 之后那一格会消失、值被静默吞掉。留出来让用户看见，才对得上「值还在盘上」。
 */
export function runConfigFieldsFor(type: RunConfig['type'] | undefined, config: RunConfig): RunConfigFieldDef[] {
  const editor = runConfigEditorFor(type)
  const ids = new Set<RunConfigFieldId>(editor.fields.map(field => field.id))
  for (const id of Object.keys(FIELD_DEFS) as RunConfigFieldId[])
    if (!ids.has(id) && fieldHasValue(id, config)) ids.add(id)
  // 输出顺序 = 类型声明的顺序，多出来的按 FIELD_DEFS 的声明顺序接在后面。
  const extras = (Object.keys(FIELD_DEFS) as RunConfigFieldId[]).filter(id => !editor.fields.some(field => field.id === id))
  return [...editor.fields, ...extras.filter(id => ids.has(id)).map(id => FIELD_DEFS[id])]
}

export type RunConfigProblemSeverity = 'error' | 'warning'

export interface RunConfigProblem {
  /** 对应 `checkConfiguration()` 的严重级别（RunConfiguration.java:160-164）。 */
  severity: RunConfigProblemSeverity
  message: string
}

export interface RunConfigCheckContext {
  /** 模板上记的目标 id（`RunConfigTemplate.target`）与其在管理器里对应的目标。 */
  templateTargetId?: string
  templateTarget?: TargetEnvironment
}

/**
 * 逐类型校验（`checkConfiguration()` 的等价物）。
 * 纯函数、可实时调用（上游同样每敲一个字就跑一遍，RunConfiguration.java:158）。
 * 返回的第一条问题就是最该告诉用户的那条 —— 与上游「抛第一个异常」的行为一致。
 */
export function checkRunConfiguration(
  config: RunConfig, configs: readonly RunConfig[], context: RunConfigCheckContext = {},
): RunConfigProblem | null {
  const name = config.name.trim()
  if (!name) return { severity: 'error', message: '配置名不能为空。' }
  const folder = validateFolderName(config.folder?.trim() ?? '')
  if (folder) return { severity: 'error', message: folder }

  if (config.type === 'compound') {
    if (!config.configurations?.length)
      return { severity: 'error', message: '复合配置至少要选择一个成员（上游：没有可以运行的内容）。' }
    // 环 / 缺失成员：上游在成员表 apply 时报 `…causes dependency cycle and cannot be added`
    // （CompoundRunConfigurationSettingsEditor.java:92-96），本仓在整组校验里报（runConfigTree.ts:120-141）。
    try { runConfigClosure(config, configs) } catch (error) {
      return { severity: 'error', message: error instanceof Error ? error.message : String(error) }
    }
  } else if (!config.command.trim() && !config.program?.trim()) {
    return { severity: 'error', message: '请填写命令或可执行程序。' }
  }

  for (const entry of config.env ?? [])
    if (!entry.includes('=') || entry.startsWith('='))
      return { severity: 'error', message: `环境变量要写成 KEY=VALUE：「${entry}」不合法。` }
  for (const step of config.beforeLaunch ?? [])
    if (!step.name.trim() || !step.command.trim())
      return { severity: 'error', message: `启动前步骤要同时有名称与命令：「${step.name || step.command}」不合法。` }

  // 「Run on target」：目标在模板上（ConfigurationSettingsEditorWrapper.java:49-59），
  // 这里只报**提醒**，不挡执行 —— 上游 `TargetEnvironmentAwareRunProfile` 找不到目标时也是回落到
  // 默认目标继续跑（CompoundRunConfiguration.kt:150 的 else 分支）。
  if (context.templateTargetId && !context.templateTarget)
    return { severity: 'warning', message: `找不到运行目标 '${context.templateTargetId}'；将按本机目标运行（上游：没有可以运行的合适目标）。` }
  if (context.templateTarget) {
    const problem = validateTargetEnvironment(context.templateTarget)
    if (problem) return { severity: 'warning', message: `运行目标「${context.templateTarget.displayName}」${problem}，将按本机目标运行。` }
  }
  return null
}

/** 目标在「运行于」下拉里的选项文本（上游 `TargetEnvironmentNode` 右侧灰字是运行时清单，MasterDetails:330-334）。 */
export function targetOptionLabel(target: TargetEnvironment): string {
  const runtimes = target.runtimes.map(entry => languageRuntimeType(entry.typeId)?.displayName ?? entry.typeId)
  return runtimes.length ? `${target.displayName}（${[...new Set(runtimes)].sort().join('、')}）` : target.displayName
}
