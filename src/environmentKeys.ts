// 启动环境键与服务 —— 上游 `com.intellij.ide.environment` 一族在本仓的对应物：
//   · `EnvironmentKey`/`EnvironmentKeyProvider`（platform-api/src/com/intellij/ide/environment）；
//   · `DefaultEnvironmentService`（有界面：键值交给用户，服务只回 null 并告警，:23-40）；
//   · `HeadlessEnvironmentService`（无界面：先系统属性、再 JSON 配置文件的键值，缺键抛
//     `MissingEnvironmentKeyException`，:30-92）；
//   · `EnvironmentKeyStubGenerator`（把全部已注册键写成 JSON 存根：`key`/`description`/`value`，
//     按 id 排序，未注册的键值附在末尾，:37-78）；
//   · `EnvironmentUtil.buildEnvironmentConfiguration` 的键值表构造（重复赋值报错）。
//
// 本仓的用法：无宿主（浏览器预览）走 headless 服务，配置文件内容由调用方注入（本仓没有
// `-Dkey=value` 的 JVM 系统属性，读取口径是 `systemProperties` 显式注入 + JSON 文本）；
// 有宿主时走 default 服务（键值应由用户/宿主提供，本仓目前没有消费方，所以服务只会告警）。
// 键注册表与存根生成器是纯函数，判据在 `tests/environment-keys.test.mjs`。

export interface EnvironmentKey {
  id: string
  description: string
}

export function environmentKey(id: string, description: string): EnvironmentKey {
  return { id, description }
}

export interface EnvironmentKeyProvider {
  knownKeys: readonly EnvironmentKey[]
  /** 某作用域下的必需键（`EnvironmentKeyProvider.getRequiredKeys(project)` 的等价物）。 */
  requiredKeys?: () => readonly EnvironmentKey[]
}

export class EnvironmentKeyRegistry {
  private readonly providers: EnvironmentKeyProvider[] = []

  register(provider: EnvironmentKeyProvider): void {
    this.providers.push(provider)
  }

  knownKeys(): EnvironmentKey[] {
    return this.providers.flatMap(provider => [...provider.knownKeys])
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  requiredKeys(): EnvironmentKey[] {
    return this.providers.flatMap(provider => [...(provider.requiredKeys?.() ?? [])])
  }

  /** `BaseEnvironmentService.checkKeyRegistered`：没在任何 registry 里登记过的键要能查出来。 */
  isRegistered(key: EnvironmentKey): boolean {
    return this.providers.some(provider => provider.knownKeys.some(known => known.id === key.id))
  }
}

/** 键值表（`EnvironmentConfiguration`）；`assignEnvironmentValue` 对重复键报错（上游 `check`）。 */
export class EnvironmentConfiguration {
  private readonly values = new Map<string, string>()

  static readonly EMPTY = new EnvironmentConfiguration()

  assign(key: EnvironmentKey, value: string): void {
    if (this.values.has(key.id)) throw new Error(`重复的环境键赋值：${key.id}`)
    this.values.set(key.id, value)
  }

  get(key: EnvironmentKey): string | null {
    return this.values.get(key.id) ?? null
  }

  entries(): [string, string][] {
    return [...this.values.entries()]
  }
}

/** `HeadlessEnvironmentService.MissingEnvironmentKeyException` 的文案（支持侧要英文）。 */
export function missingEnvironmentKeyMessage(key: EnvironmentKey): string {
  return `Missing value for the environment key '${key.id}'\n` +
    `The value can be set as a system property (\`-D${key.id}=<value>\` in the VM options),\n` +
    'or as an entry in the JSON configuration file (the command-line starter `generateEnvironmentKeysFile`).\n\n' +
    `Description of ${key.id}:\n${key.description}\n`
}

export interface EnvironmentService {
  getEnvironmentValue(key: EnvironmentKey): string | null
  getEnvironmentValueOrDefault(key: EnvironmentKey, defaultValue: string): string
}

export interface HeadlessEnvironmentOptions {
  /** 启动器注入的「系统属性」（本仓没有 JVM，等价物是这个显式表）。 */
  systemProperties?: Record<string, string>
  /** 已解析的配置文件键值（`HeadlessEnvironmentService` 的 JSON 配置）。 */
  values?: Record<string, string>
  /** 键没登记时的告警出口（上游 `BaseEnvironmentService.checkKeyRegistered` 的 LOG.warn）。 */
  warn?: (message: string) => void
  registry?: EnvironmentKeyRegistry
}

/** 解析 `environmentKeys.json`（`HeadlessEnvironmentService.getModelFromFile`：坏条目跳过并告警）。 */
export function parseEnvironmentKeyConfiguration(jsonText: string, warn?: (message: string) => void): Record<string, string> {
  const values: Record<string, string> = {}
  let list: unknown
  try {
    list = JSON.parse(jsonText)
  } catch (error) {
    warn?.(`Malformed environment key configuration: ${error instanceof Error ? error.message : String(error)}`)
    return values
  }
  if (!Array.isArray(list)) {
    warn?.('Malformed environment key configuration: expected a JSON array')
    return values
  }
  for (const entry of list) {
    const key = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).key : undefined
    const value = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).value : undefined
    if (typeof key !== 'string' || typeof value !== 'string') { warn?.(`Malformed JSON entry: ${JSON.stringify(entry)}`); continue }
    if (!value) continue   // 空值不覆盖别的来源（上游 continue）
    values[key] = value
  }
  return values
}

/** 无界面服务：系统属性 → 配置键值 → 缺键（`getEnvironmentValue` 抛缺键错）。 */
export function createHeadlessEnvironmentService(options: HeadlessEnvironmentOptions = {}): EnvironmentService {
  const registry = options.registry
  const check = (key: EnvironmentKey) => {
    if (registry && !registry.isRegistered(key))
      options.warn?.(`The key '${key.id}' is not registered in any 'EnvironmentKeyRegistry'. ` +
        'It may lead to poor discoverability of this key and to worsened support from the IDE.')
  }
  const lookup = (key: EnvironmentKey): string | null => {
    check(key)
    const fromProperty = options.systemProperties?.[key.id]
    if (fromProperty !== undefined && fromProperty !== '') return fromProperty
    const fromConfig = options.values?.[key.id]
    if (fromConfig !== undefined && fromConfig !== '') return fromConfig
    return null
  }
  return {
    getEnvironmentValue(key) {
      const value = lookup(key)
      if (value === null) throw new Error(missingEnvironmentKeyMessage(key))
      return value
    },
    getEnvironmentValueOrDefault(key, defaultValue) {
      return lookup(key) ?? defaultValue
    },
  }
}

/** 有界面服务：键值必须由用户给，服务回 null 并告警（上游 `DefaultEnvironmentService`）。 */
export function createDefaultEnvironmentService(registry?: EnvironmentKeyRegistry,
                                                warn?: (message: string) => void): EnvironmentService {
  const lookup = (key: EnvironmentKey): string | null => {
    if (registry && !registry.isRegistered(key))
      warn?.(`The key '${key.id}' is not registered in any 'EnvironmentKeyRegistry'.`)
    return null
  }
  return {
    getEnvironmentValue: lookup,
    getEnvironmentValueOrDefault: (key, defaultValue) => lookup(key) ?? defaultValue,
  }
}

/**
 * `EnvironmentKeyStubGenerator.performGeneration`：把已注册键（按 id 排序）写成 JSON，
 * 键序 `description` → `key` → `value`（未注册但有值的键附在末尾，无 description）。
 * `descriptions = false` 时省掉 description（上游 `--no-descriptions`）。
 */
export function generateEnvironmentKeyStub(keys: readonly EnvironmentKey[],
                                           configuration: EnvironmentConfiguration = EnvironmentConfiguration.EMPTY,
                                           descriptions = true): string {
  const sorted = [...keys].sort((a, b) => a.id.localeCompare(b.id))
  const registered = new Set(sorted.map(key => key.id))
  const lines: string[] = ['[']
  const entries: string[] = []
  for (const key of sorted) {
    const fields: string[] = []
    if (descriptions) {
      const descriptionLines = key.description.split('\n').map(line => `      ${JSON.stringify(line)}`).join(',\n')
      fields.push(`    "description": [\n${descriptionLines}\n    ]`)
    }
    fields.push(`    "key": ${JSON.stringify(key.id)}`)
    fields.push(`    "value": ${JSON.stringify(configuration.get(key) ?? '')}`)
    entries.push(`  {\n${fields.join(',\n')}\n  }`)
  }
  for (const [id, value] of configuration.entries()) {
    if (registered.has(id)) continue
    entries.push(`  {\n    "key": ${JSON.stringify(id)},\n    "value": ${JSON.stringify(value)}\n  }`)
  }
  lines.push(entries.join(',\n'))
  lines.push(']')
  return lines.join('\n')
}
