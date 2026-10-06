import type { RunConfig } from './settingsModel'

/**
 * 本仓运行配置类型的**唯一运行时段清单**（上游是 `ConfigurationType` 的注册表，
 * `platform/execution-impl/src/com/intellij/execution/impl/RunManagerImpl.kt` 按 id 收类型）。
 *
 * 为什么放在 schema：这一份既是「落盘能不能过」的门，也是左树 `RUN_CONFIG_TYPES`
 * （`src/runConfigTree.ts`）与逐类型编辑器表 `RUN_CONFIG_EDITORS`（`src/runConfigEditors.ts`）的 id 来源 ——
 * 之前 schema 里硬编码着第二份同样的清单，往 `settingsModel.ts` 的联合里加一个类型
 * （例：JAR 配置 `'jar'`）就会**建得出配置、存不下去**（schema 把它当非法类型拒掉）。
 * 现在加类型要动的是：本清单 + `settingsModel.ts` 的联合 + 两张 `Record<NonNullable<RunConfig['type']>, …>`
 * （后两张少一个键直接编译不过，本清单与树/编辑器表的一致性由 `tests/run-config-types.test.mjs` 钉住）。
 */
export const RUN_CONFIG_TYPE_IDS: readonly NonNullable<RunConfig['type']>[] = ['shell', 'application', 'debug', 'compound']

export function normalizeRunConfigurations(raw: unknown): RunConfig[] {
  const encoder = new TextEncoder()
  const text = (value: unknown, max: number, nonempty = false): value is string =>
    typeof value === 'string' && (!nonempty || value.length > 0) && encoder.encode(value).length <= max
  const list = (value: unknown, max: number, itemMax: number) =>
    Array.isArray(value) && value.length <= max && value.every(entry => text(entry, itemMax))
  const keys = new Set(['name', 'type', 'command', 'program', 'args', 'cwd', 'env', 'beforeLaunch', 'adapter', 'folder', 'allowRunningInParallel', 'configurations'])
  if (!Array.isArray(raw) || raw.length > 40) throw new Error('运行配置必须是数组，最多 40 个。')
  const configs = raw as RunConfig[]
  if (configs.some(config => !config || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).some(key => !keys.has(key)) || !text(config.name, 80, true)
    || !text(config.command, 4096, config.type !== 'compound' && !config.program)
    || (config.type !== undefined && !RUN_CONFIG_TYPE_IDS.includes(config.type))
    || (config.program !== undefined && !text(config.program, 1024))
    || (config.cwd !== undefined && !text(config.cwd, 1024))
    || (config.args !== undefined && !list(config.args, 256, 1024))
    || (config.env !== undefined && !list(config.env, 256, 1024))
    || (config.adapter !== undefined && !text(config.adapter, 64))
    || (config.folder !== undefined && (!text(config.folder, 80) || /[\r\n\t]/.test(config.folder)))
    || (config.allowRunningInParallel !== undefined && typeof config.allowRunningInParallel !== 'boolean')
    || (config.beforeLaunch !== undefined && (!Array.isArray(config.beforeLaunch) || config.beforeLaunch.length > 16
      || config.beforeLaunch.some(step => !step || typeof step !== 'object' || Array.isArray(step)
        || Object.keys(step).some(key => key !== 'name' && key !== 'command') || !text(step.name, 80, true) || !text(step.command, 4096, true)))))) {
    throw new Error('运行配置字段无效；名称必须非空、唯一，普通配置的命令与程序不能同时为空。')
  }
  const byName = new Map(configs.map(config => [config.name, config]))
  if (byName.size !== configs.length) throw new Error('运行配置名不能重复。')
  const visiting = new Set<string>(), done = new Set<string>()
  function visit(name: string): void {
    if (done.has(name)) return
    if (visiting.has(name)) throw new Error('复合配置不能循环引用。')
    const config = byName.get(name)
    if (!config) throw new Error(`复合配置引用了不存在的成员：${name}`)
    visiting.add(name)
    if (config.type === 'compound') {
      const members = config.configurations
      if (!list(members, 40, 80) || !members?.length || members.some(member => !member || member === name) || new Set(members).size !== members.length)
        throw new Error('复合配置必须选择非空、不重复且不含自身的成员。')
      members.forEach(visit)
    } else if (config.configurations !== undefined) throw new Error('只有复合配置可包含成员配置。')
    visiting.delete(name)
    done.add(name)
  }
  configs.forEach(config => visit(config.name))
  return configs.map(config => ({ ...config,
    ...(config.args ? { args: [...config.args] } : {}),
    ...(config.env ? { env: [...config.env] } : {}),
    ...(config.beforeLaunch ? { beforeLaunch: config.beforeLaunch.map(step => ({ ...step })) } : {}),
    ...(config.configurations ? { configurations: [...config.configurations] } : {}),
  }))
}
