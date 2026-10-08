// 运行配置**模板**（上游 `RunManagerImpl.getConfigurationTemplate` / `TemplateConfigurable`，
// platform/execution-impl/.../configuration/）。
//
// 上游语义：每种配置类型有一份模板配置；新建配置时从模板取初值（名字换成唯一的），
// 选中树里的**类型节点**时右栏是模板编辑器（`ConfigurationSettingsEditorWrapper` 的
// RunOnTarget / 存储 / 编辑器标签都挂在模板上）。本仓原先没有模板：新建配置从空表单开始，
// 「允许并行」也只能逐个配置勾。这里补上半套可移植语义：
//   · `applyTemplate` —— 新建配置从模板取 command/program/args/cwd/env/beforeLaunch/
//     allowRunningInParallel（名字唯一化、类型由 UI 决定）；
//   · 模板存 localStorage、按项目根分键（上游模板是项目级设置；本仓的共享配置落盘
//     由设计禁止，模板同样不进用户项目目录，见 docs 里的登记）；
//   · 消费点 `src/components/RunConfigurationsDialog.vue`：点类型节点 → 模板编辑器。
// 不做的那半：`.idea/runConfigurations` 落盘、per-type 设置编辑器本体（上游每种类型一套），
// 判词里如实登记。
//
// 纯函数（存储读写用可注入的 StorageLike），判据 tests/run-config-templates.test.mjs。

import type { RunConfig } from './bridge.ts'
// 模板 EP（`com.intellij.runConfigurationTemplateProvider`，上游 `RunManagerImpl.kt:130-134`）：
// 本模块的 `templateFor` 是它的**真实消费点**（第三方给的模板优先于本地存的那份）。
import { templateFromProviders } from './executionRunExtensionPoints.ts'
// 那两个「启动时打开/聚焦运行面板」开关的**唯一**解析入口与上游默认值（判据 tests/run-startup-focus.test.mjs）。
// 模板只是初值来源（上游 `RunnerAndConfigurationSettingsImpl.kt:455-461`），不另开一份存放。
import { ACTIVATE_TOOL_WINDOW_DEFAULT, FOCUS_TOOL_WINDOW_DEFAULT, resolveRunStartupFocusFlags } from './runStartupFocus.ts'

export interface RunConfigTemplate {
  command?: string
  program?: string
  args?: string[]
  cwd?: string
  env?: string[]
  beforeLaunch?: Array<{ name: string; command: string }>
  allowRunningInParallel?: boolean
  /**
   * 「启动时打开运行面板」/「启动时把焦点移到运行面板」的**模板初值**。
   * 上游同一件事在 `RunnerAndConfigurationSettingsImpl.kt:455-461`
   * （`importRunnerAndConfigurationSettings(template)` 把模板记录上的
   * `isActivateToolWindowBeforeRun` / `isFocusToolWindowBeforeRun` 拷进新配置）⇒
   * 模板只是「新建配置时的初值来源」，**不是第二处存放**：新配置一旦落成记录，之后只读那条记录。
   * 默认方向与配置档相反，所以 `sanitize` 里两个都是「只在非默认时留键」
   * （上游写档语义 `:317-321`：activate 默认 true ⇒ 只在 false 时落，focus 默认 false ⇒ 只在 true 时落）。
   */
  activateToolWindowBeforeRun?: boolean
  focusToolWindowBeforeRun?: boolean
  /** 运行目标 id（见 src/executionTargets.ts）；空/缺省 = 本机。 */
  target?: string
}

export type RunConfigTemplates = Record<string, RunConfigTemplate>

export const RUN_CONFIG_TEMPLATES_KEY = 'taocode.runConfigTemplates'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 每项目一把键（root 为空时退回应用级，用于浏览器预览/未打开项目）。 */
export function templatesStoreKey(root: string): string {
  return root ? `${RUN_CONFIG_TEMPLATES_KEY}.${root}` : RUN_CONFIG_TEMPLATES_KEY
}

function sanitize(template: RunConfigTemplate): RunConfigTemplate {
  const out: RunConfigTemplate = {}
  if (typeof template.command === 'string' && template.command) out.command = template.command
  if (typeof template.program === 'string' && template.program) out.program = template.program
  if (template.args?.length) out.args = [...template.args]
  if (typeof template.cwd === 'string' && template.cwd) out.cwd = template.cwd
  if (template.env?.length) out.env = [...template.env]
  if (template.beforeLaunch?.length) out.beforeLaunch = template.beforeLaunch.map(step => ({ name: step.name, command: step.command }))
  if (template.allowRunningInParallel === true) out.allowRunningInParallel = true
  // 只在**非默认**时留键（上游 `RunnerAndConfigurationSettingsImpl.kt:317-321`）：
  // activate 的默认是 true ⇒ 只有 false 需要落盘；focus 的默认是 false ⇒ 只有 true 需要落盘。
  // 读回时缺键由 `src/runStartupFocus.ts` 的 `resolveRunStartupFocusFlags` 补上游默认，
  // 所以「没留键」与「留了默认值的键」在行为上是同一件事，模板记录不会越写越大。
  if (template.activateToolWindowBeforeRun === false) out.activateToolWindowBeforeRun = false
  if (template.focusToolWindowBeforeRun === true) out.focusToolWindowBeforeRun = true
  if (typeof template.target === 'string' && template.target) out.target = template.target
  return out
}

export function loadRunConfigTemplates(store: StorageLike | undefined, root: string): RunConfigTemplates {
  try {
    const raw = store?.getItem(templatesStoreKey(root))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: RunConfigTemplates = {}
    for (const [type, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      out[type] = sanitize(value as RunConfigTemplate)
    }
    return out
  } catch {
    return {}
  }
}

export function saveRunConfigTemplate(
  store: StorageLike | undefined, root: string, type: string, fields: RunConfigTemplate,
): RunConfigTemplates {
  const templates = loadRunConfigTemplates(store, root)
  const cleaned = sanitize(fields)
  if (Object.keys(cleaned).length === 0) delete templates[type]
  else templates[type] = cleaned
  try { store?.setItem(templatesStoreKey(root), JSON.stringify(templates)) } catch { /* 存储不可用只影响持久化 */ }
  return templates
}

export function removeRunConfigTemplate(store: StorageLike | undefined, root: string, type: string): RunConfigTemplates {
  const templates = loadRunConfigTemplates(store, root)
  delete templates[type]
  try { store?.setItem(templatesStoreKey(root), JSON.stringify(templates)) } catch { /* 同上 */ }
  return templates
}

/**
 * 这个类型的模板。
 * 先问 EP（`com.intellij.runConfigurationTemplateProvider` 的 `RunConfigurationTemplateProvider`，
 * 上游 `RunManagerImpl` 建模板时遍历 EP 的那条路）—— 第三方提供者给的模板经 `sanitize` 清一遍，
 * 与 localStorage 那份同一口径；没人给就用本仓存的那份。无插件时结果与接线前逐字一致。
 */
export function templateFor(templates: RunConfigTemplates, type: string): RunConfigTemplate | undefined {
  const contributed = templateFromProviders(type)
  if (contributed) return sanitize(contributed as RunConfigTemplate)
  return templates[type]
}

/** 模板里有没有实质内容（`{}` 不算"已设置模板"，UI 上不显示徽标）。 */
export function hasTemplateContent(template: RunConfigTemplate | undefined): boolean {
  return !!template && Object.keys(template).length > 0
}

/**
 * 用模板给新配置取初值（上游 `createConfiguration` 把模板字段拷进新配置）。
 * 当前草稿只有 `name`/`type`/`folder` 有意义：模板字段整体覆盖，草稿的空字段不被保留，
 * 避免"上一份草稿的残留"混进新配置。
 */
export function applyTemplate(draft: RunConfig, template: RunConfigTemplate | undefined, uniqueName: string): RunConfig {
  const next: RunConfig = {
    name: uniqueName,
    type: draft.type,
    command: template?.command ?? '',
    program: template?.program ?? '',
    args: template?.args ? [...template.args] : [],
    cwd: template?.cwd ?? '',
    env: template?.env ? [...template.env] : [],
    beforeLaunch: template?.beforeLaunch ? template.beforeLaunch.map(step => ({ ...step })) : [],
  }
  if (template?.allowRunningInParallel === true) next.allowRunningInParallel = true
  // 模板那两个开关 → 新配置的两个字段（上游 `RunnerAndConfigurationSettingsImpl.kt:460-461` 的两行拷贝）。
  // 走的是**同一个**解析入口：模板缺键 ⇒ 补上游默认（true / false，`:108-109`），
  // 补出来的值正好是默认 ⇒ 下面不落键（默认值不进记录，与写档 `:317-321` 一致）。
  const startup = resolveRunStartupFocusFlags(template)
  if (startup.activateToolWindowBeforeRun !== ACTIVATE_TOOL_WINDOW_DEFAULT)
    next.activateToolWindowBeforeRun = startup.activateToolWindowBeforeRun
  if (startup.focusToolWindowBeforeRun !== FOCUS_TOOL_WINDOW_DEFAULT)
    next.focusToolWindowBeforeRun = startup.focusToolWindowBeforeRun
  if (draft.folder) next.folder = draft.folder
  return next
}
