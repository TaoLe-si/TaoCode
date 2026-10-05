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

export interface RunConfigTemplate {
  command?: string
  program?: string
  args?: string[]
  cwd?: string
  env?: string[]
  beforeLaunch?: Array<{ name: string; command: string }>
  allowRunningInParallel?: boolean
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

export function templateFor(templates: RunConfigTemplates, type: string): RunConfigTemplate | undefined {
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
  if (draft.folder) next.folder = draft.folder
  return next
}
