import type { RunConfig } from './settingsModel'
import { JAR_RUN_CONFIG_TYPE_ID, jarRunConfigProblem } from './jarRun.ts'

/**
 * 本仓运行配置类型的**唯一运行时段清单**（上游是 `ConfigurationType` 的注册表，
 * `platform/execution-impl/src/com/intellij/execution/impl/RunManagerImpl.kt` 按 id 收类型）。
 *
 * 为什么放在 schema：这一份既是「落盘能不能过」的门，也是左树 `RUN_CONFIG_TYPES`
 * （`src/runConfigTree.ts`）与逐类型编辑器表 `RUN_CONFIG_EDITORS`（`src/runConfigEditors.ts`）的 id 来源 ——
 * 之前 schema 里硬编码着第二份同样的清单，往 `settingsModel.ts` 的联合里加一个类型
 * （例：JAR 配置 `'jar'`）就会**建得出配置、存不下去**（schema 把它当非法类型拒掉）。
 *
 * 2026-10-06 第三批把清单拆成三层，加类型只动**家族**那一层 + 两张 `Record<RunConfigTypeId, …>`
 * （两张都是穷尽的 ⇒ 少一个键直接编译不过）：
 *   · `RUN_CONFIG_TYPE_FAMILY_IDS` —— 上游有、本仓**模块侧已经做完**的全部类型（含 JAR）；
 *   · `RUN_CONFIG_TYPE_IDS_HOST_PENDING` —— 家族里宿主那两处还没接的（`src/settingsModel.ts` 的
 *     `RunConfig['type']` 联合 + `native/settings_schema.cpp` 的 type 白名单，两个都是保留文件）。
 *     从这一条里摘掉一项 = 新建配置表单 / schema 校验 / 持久化 / 执行参数 / 树里显示 **五处一起开**；
 *   · `RUN_CONFIG_TYPE_IDS` —— 由上面两条推出来的「今天真能存下去」的清单，UI 与校验只认它。
 * 为什么要 gate：宿主白名单不接 `'jar'` 时 `project.settings.update` 整份 `INVALID_SETTINGS` 拒掉
 * （`native/settings_schema.cpp:1010-1012`），前端单独放开就是「建得出、存不下去」那个老形状，
 * 还会连带把项目里别的设置一起存不下去 —— 规约 §3「不放假控件」同一条理由。
 * 判据 `tests/run-config-types.test.mjs`：前四份清单同步在「四份类型清单必须同步」那条，
 * 第五处（宿主白名单）在「第五处：宿主 settings_schema.cpp…同源」那条，
 * gate 与宿主必须一起动在「宿主两处都接了的类型不许留在 pending 里」那条。
 */
export type RunConfigTypeId = NonNullable<RunConfig['type']> | typeof JAR_RUN_CONFIG_TYPE_ID

/** 家族清单：上游注册的类型里本仓模块侧已经做完的那些（顺序 = 左树里的固定顺序，也是宿主文案念出来的顺序）。 */
export const RUN_CONFIG_TYPE_FAMILY_IDS: readonly RunConfigTypeId[] = ['shell', 'application', 'debug', 'compound', JAR_RUN_CONFIG_TYPE_ID]

/** 家族里等宿主两处接线的那几个；宿主接完就把这一项删掉（`docs/wiring-requests-2026-10-06-runcfg3.md` 的 J1）。
 *  2026-10-06 收口：JAR 的宿主两处（`settingsModel.ts` 的联合 + `native/settings_schema.cpp` 的白名单）已同批落地 ⇒ 本表清空。
 *  这一条**留着**：它是「前端先接、宿主没接」那个老形状的唯一拦截点（下一批加类型时往里填一项即可）。 */
export const RUN_CONFIG_TYPE_IDS_HOST_PENDING: readonly RunConfigTypeId[] = []

/** 今天真能落盘的清单 = 家族 − 宿主未接。表单、左树、schema、执行参数都以它为准。
 *  元素类型取 `settingsModel.ts` 的联合（那条 `id is …` 判据就是「不在 pending 里 ⇒ 宿主接得了」）：
 *  pending 里剩什么就投影掉什么 ⇒ 摘掉一项之前 jar 不会漏进 UI。 */
export const RUN_CONFIG_TYPE_IDS: readonly NonNullable<RunConfig['type']>[] =
  RUN_CONFIG_TYPE_FAMILY_IDS.filter((id): id is NonNullable<RunConfig['type']> =>
    !RUN_CONFIG_TYPE_IDS_HOST_PENDING.some(pending => pending === id))

/** 配置记录里的 type 归一成 `RunConfigTypeId`（缺省按 shell，与左树分组同一口径）。 */
export function runConfigTypeIdOf(type: RunConfig['type'] | undefined): RunConfigTypeId {
  return type ?? 'shell'
}

/**
 * 这条记录的 type 是不是「模块侧已登记、宿主还没接」的类型。
 * 只看 `unknown`（不假定它已经过联合检查），所以 `runConfigTypeIdOf` 那种「联合里应该有」的
 * 编译期口径在这里用不上 —— 落盘的门必须按运行时的串判。
 */
function isHostPendingType(type: unknown): boolean {
  if (typeof type !== 'string') return false
  return RUN_CONFIG_TYPE_IDS_HOST_PENDING.some(id => id === type) && !RUN_CONFIG_TYPE_IDS.some(id => id === type)
}

export function normalizeRunConfigurations(raw: unknown): RunConfig[] {
  const encoder = new TextEncoder()
  const text = (value: unknown, max: number, nonempty = false): value is string =>
    typeof value === 'string' && (!nonempty || value.length > 0) && encoder.encode(value).length <= max
  const list = (value: unknown, max: number, itemMax: number) =>
    Array.isArray(value) && value.length <= max && value.every(entry => text(entry, itemMax))
  const keys = new Set(['name', 'type', 'command', 'program', 'args', 'cwd', 'env', 'beforeLaunch', 'adapter', 'folder',
    // 「启动时打开运行面板」/「启动时把焦点移到运行面板」——上游挂在**每条配置**上
    // （`RunnerAndConfigurationSettings.java:235/:242/:249/:256`，存
    // `RunnerAndConfigurationSettingsImpl.kt:108-109`、属性名同文件 `:61-62`）⇒ 本仓的存放处就是这条记录，
    // 读写与判定都收在 `src/runStartupFocus.ts`（唯一真源，见该文件头部的判决段）。
    'activateToolWindowBeforeRun', 'focusToolWindowBeforeRun', 'allowRunningInParallel', 'configurations'])
  if (!Array.isArray(raw) || raw.length > 40) throw new Error('运行配置必须是数组，最多 40 个。')
  const configs = raw as RunConfig[]
  // JAR 那一族的**入口判据排在最前**（`src/jarRun.ts` 的 `jarRunConfigProblem`）：
  // 「参数里没写 -jar <路径>」这种人写的错要报成人看得懂的那一句，不能被下面的「字段无效」糊过去。
  // 上游同族判据：`JarApplicationConfiguration.java:128-131` 只对**文件不存在**给 warning（jarPath 已填的情况），
  // 而 jarPath 空时 `JarApplicationCommandLineState.java:24` 拼出来的是一条没有 jar 的命令行
  // ⇒ 本仓按 `RunConfiguration.java:156-167` 的致命档（RuntimeConfigurationError）报，不静默。
  for (const config of configs) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) continue
    const problem = jarRunConfigProblem(config)
    if (problem) throw new Error(problem)
  }
  if (configs.some(config => !config || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).some(key => !keys.has(key)) || !text(config.name, 80, true)
    || !text(config.command, 4096, config.type !== 'compound' && !config.program)
    // 「模块侧已登记、宿主还没接」的类型在这里**先放过**，由下面那条指名道姓的错接手；
    // 清单外的 id（打错的、别处来的）仍然落进「字段无效」这一句。
    || (config.type !== undefined && !RUN_CONFIG_TYPE_IDS.includes(config.type) && !isHostPendingType(config.type))
    || (config.program !== undefined && !text(config.program, 1024))
    || (config.cwd !== undefined && !text(config.cwd, 1024))
    || (config.args !== undefined && !list(config.args, 256, 1024))
    || (config.env !== undefined && !list(config.env, 256, 1024))
    || (config.adapter !== undefined && !text(config.adapter, 64))
    || (config.folder !== undefined && (!text(config.folder, 80) || /[\r\n\t]/.test(config.folder)))
    || (config.allowRunningInParallel !== undefined && typeof config.allowRunningInParallel !== 'boolean')
    // 那两个启动时聚焦开关与宿主同一条口径（`native/settings_schema.cpp` 的 known_keys + 布尔校验）：
    // 只认布尔，脏值在这层就报人看得懂的错，不落进「字段无效」那一句里；**缺键是合法的**（按上游默认补，
    // 见 `src/runStartupFocus.ts` 的 `resolveRunStartupFocusFlags`），不许因为少键就把整份存档判坏。
    || (config.activateToolWindowBeforeRun !== undefined && typeof config.activateToolWindowBeforeRun !== 'boolean')
    || (config.focusToolWindowBeforeRun !== undefined && typeof config.focusToolWindowBeforeRun !== 'boolean')
    || (config.beforeLaunch !== undefined && (!Array.isArray(config.beforeLaunch) || config.beforeLaunch.length > 16
      || config.beforeLaunch.some(step => !step || typeof step !== 'object' || Array.isArray(step)
        || Object.keys(step).some(key => key !== 'name' && key !== 'command') || !text(step.name, 80, true) || !text(step.command, 4096, true)))))) {
    throw new Error('运行配置字段无效；名称必须非空、唯一，普通配置的命令与程序不能同时为空。')
  }
  // 形状都对、但宿主那两处还没接的类型：报**指名道姓**的那一句（不是「字段无效」，也不是默默收下再让宿主整份拒掉）。
  // 这一条挡的就是「前端建得出、存档被 INVALID_SETTINGS 拒掉」那个老形状 —— 摘掉
  // `RUN_CONFIG_TYPE_IDS_HOST_PENDING` 里那一项之前，先把 `src/settingsModel.ts` 的联合与
  // `native/settings_schema.cpp` 的白名单接上（`tests/run-config-types.test.mjs` 的 gate 同步那条钉着三处必须一起动）。
  for (const config of configs) {
    if (isHostPendingType(config.type))
      throw new Error(`运行配置类型 '${config.type}' 模块侧已登记、宿主还没接（type 联合与原生白名单两处），这类配置现在存不下去。`)
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
