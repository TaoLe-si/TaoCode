// 运行/调试配置的左树模型（IDEA `RunConfigurable` 的树）。
//
// 对照源码：
//   RunConfigurable.kt:170-183   节点种类 `RunConfigurableNodeKind`：CONFIGURATION /
//                                TEMPORARY_CONFIGURATION / CONFIGURATION_TYPE / FOLDER（userObject 是名字串）/ UNKNOWN
//   RunConfigurable.kt:674-680   apply 时收集 FOLDER 节点，**空名的文件夹被跳过**
//   RunConfigurable.kt:934       `createUniqueName`：新建/复制配置时取唯一名
//   RunConfigurable.kt:1229      MyCreateFolderAction（Create New Folder）
//
// 抽成纯函数的原因：树的分组规则（类型 → 文件夹 → 配置）、唯一名、文件夹名校验都是可测逻辑，
// 组件只负责渲染与交互。
import { stableRunConfig, type RuntimeRunConfig as RunConfig } from './runTargets.ts'
import { normalizeRunConfigurations, RUN_CONFIG_TYPE_IDS, type RunConfigTypeId } from './runConfigurationSchema.ts'
import { JAR_APPLICATION_TYPE_LABEL, JAR_RUN_CONFIG_TYPE_ID } from './jarRun.ts'

/** 每个类型的中文名，**按家族穷尽**（`Record<RunConfigTypeId, string>`）：
 *  `src/runConfigurationSchema.ts` 的 `RUN_CONFIG_TYPE_FAMILY_IDS` 加一项而这里没补标签 ⇒ 编译不过，
 *  这就是「树里显示」那一处的机器门。JAR 那一条的标签直接取上游 bundle 的原文
 *  （`jar.application.configuration.name`，`java/execution/impl/src/com/intellij/execution/jar/JarApplicationConfigurationType.java:20`
 *  + `platform/execution/resources/messages/ExecutionBundle.properties:55` = `JAR Application`）；
 *  本地化包不在本地树 ⇒ 不编中文，与 `src/jarRun.ts:52` 同一份常量。 */
export const RUN_CONFIG_TYPE_FAMILY_LABELS: Record<RunConfigTypeId, string> = {
  shell: 'Shell 命令',
  application: '应用程序',
  debug: '调试',
  compound: '复合配置',
  [JAR_RUN_CONFIG_TYPE_ID]: JAR_APPLICATION_TYPE_LABEL,
}

/** 树/编辑器能用到的类型 = **宿主已接**的那几个（gate 在 `src/runConfigurationSchema.ts`）。
 *  pending 里的 jar 在这里不出现 ⇒ 左树不出类型节点、下拉里点不到，也就不会建出一份存不下去的配置。 */
export const RUN_CONFIG_TYPES: Array<{ id: NonNullable<RunConfig['type']>; label: string }> =
  RUN_CONFIG_TYPE_IDS.map(id => ({ id, label: RUN_CONFIG_TYPE_FAMILY_LABELS[id] }))

/** 家族标签（含 pending 的 jar）：`tests/run-config-types.test.mjs` 用它核「五处一致」的「树里显示」那一处，
 *  宿主接完后它投影出来的就是上面那份 `RUN_CONFIG_TYPES`（同一个 id、同一个标签）。 */

/** 参数字段必须可逆（IDEA ParametersListUtil.join/parse），不能用空格 split 破坏 classpath。
 * TaoCode 运行在 Windows：这里与 run_host 的 CRT 双引号/反斜杠规则对应，不执行 shell 展开。
 */
export function formatRunArguments(args: readonly string[]): string {
  return args.map(argument => {
    if (argument && !/[\s"]/.test(argument)) return argument
    const escaped = argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')
    return `"${escaped}"`
  }).join(' ')
}

export function parseRunArguments(text: string): string[] {
  const args: string[] = []
  let token = ''
  let quoted = false
  let present = false
  for (let index = 0; index < text.length; ++index) {
    const character = text[index]!
    if (character === '\\') {
      let end = index
      while (text[end] === '\\') ++end
      const count = end - index
      if (text[end] === '"') {
        token += '\\'.repeat(Math.floor(count / 2))
        if (count % 2) token += '"'
        else quoted = !quoted
        index = end
      } else {
        token += '\\'.repeat(count)
        index = end - 1
      }
      present = true
    } else if (character === '"') {
      quoted = !quoted
      present = true
    } else if (/\s/.test(character) && !quoted) {
      if (present) args.push(token)
      token = ''
      present = false
    } else {
      token += character
      present = true
    }
  }
  if (present) args.push(token)
  return args
}

export function runConfigTypeLabel(type: string): string {
  return RUN_CONFIG_TYPES.find(entry => entry.id === type)?.label ?? type
}

export interface RunConfigFolderGroup { name: string; configs: RunConfig[] }
export interface RunConfigTypeGroup { id: string; label: string; folders: RunConfigFolderGroup[]; configs: RunConfig[] }

/**
 * 类型 → 文件夹 → 配置 三层。类型顺序按 `RUN_CONFIG_TYPES`（先 shell 后 application 再 debug），
 * 每种类型下先列有文件夹的分组，再列不归属任何文件夹的配置 —— 与 IDEA 树里类型节点下的顺序一致。
 */
export function buildRunConfigTree(configs: readonly RunConfig[]): RunConfigTypeGroup[] {
  const byType = new Map<string, RunConfigTypeGroup>()
  const ensure = (id: string) => {
    let node = byType.get(id)
    if (!node) { node = { id, label: runConfigTypeLabel(id), folders: [], configs: [] }; byType.set(id, node) }
    return node
  }
  for (const config of configs) {
    const node = ensure(config.type ?? 'shell')
    const folder = (config.folder ?? '').trim()
    if (!folder) { node.configs.push(config); continue }
    let group = node.folders.find(entry => entry.name === folder)
    if (!group) { group = { name: folder, configs: [] }; byType.get(node.id)!.folders.push(group) }
    group.configs.push(config)
  }
  // 类型节点按固定顺序排（没配置的类型不出现），文件夹按名字，配置保持原有顺序。
  return RUN_CONFIG_TYPES.map(entry => byType.get(entry.id)).filter((node): node is RunConfigTypeGroup => Boolean(node))
    .map(node => ({ ...node,
      configs: [...node.configs].sort((a, b) => Number(Boolean(a.temporary)) - Number(Boolean(b.temporary))),
      folders: [...node.folders].sort((a, b) => a.name.localeCompare(b.name)).map(folder => ({ ...folder,
        configs: [...folder.configs].sort((a, b) => Number(Boolean(a.temporary)) - Number(Boolean(b.temporary))),
      })),
    }))
}

/** `RunConfigurable.createUniqueName`（:934）：基名被占用时追加 2、3…（IDEA 从 1 起，这里沿用「名字 2」风格）。 */
export function uniqueRunConfigName(configs: readonly RunConfig[], base: string): string {
  const used = new Set(configs.map(config => config.name))
  if (!used.has(base)) return base
  for (let index = 2; ; index++) {
    const candidate = `${base} ${index}`
    if (!used.has(candidate)) return candidate
  }
}

/** CompoundRunConfiguration.kt:91-102/130-140; editor :57-100 rejects recursive membership.
 * Validate the entire reachable graph before any launch or promotion. Names are unique in TaoCode.
 */
export function runConfigClosure(config: RunConfig, configs: readonly RunConfig[]): RunConfig[] {
  const byName = new Map(configs.map(entry => [entry.name, entry]))
  if (byName.size !== configs.length) throw new Error('运行配置名不能重复。')
  byName.set(config.name, config)
  const closure: RunConfig[] = []
  const seen = new Set<string>()
  const visit = (entry: RunConfig) => {
    if (seen.has(entry.name)) return
    seen.add(entry.name)
    closure.push(entry)
    if (entry.type === 'compound') {
      if (!Array.isArray(entry.configurations)) throw new Error(`复合配置「${entry.name}」没有有效成员。`)
      for (const name of entry.configurations) {
        const found = byName.get(name)
        if (!found) throw new Error(`复合配置「${entry.name}」的成员「${name}」不存在。`)
        visit(found)
      }
    }
  }
  visit(config)
  // The same schema protects persistence and runtime, including every nested child's argv/steps.
  normalizeRunConfigurations(closure.map(stableRunConfig))
  for (const entry of closure) {
    if (entry.env?.some(value => value.indexOf('=') <= 0 || /[\r\n\u0000]/.test(value)))
      throw new Error(`配置「${entry.name}」的环境变量要写成 KEY=VALUE。`)
    if (entry.beforeLaunch?.some(step => !step.name.trim() || !step.command.trim()))
      throw new Error(`配置「${entry.name}」的启动前步骤不能为空。`)
    if (entry.type === 'compound') {
      // Upstream implements WithoutOwnBeforeRunSteps; silently dropping compound launch fields is unsafe.
      if (entry.command.trim() || entry.program?.trim() || entry.args?.length || entry.cwd?.trim() || entry.env?.length || entry.beforeLaunch?.length)
        throw new Error(`复合配置「${entry.name}」只选择成员；请在成员中设置命令、参数、工作目录、环境变量及启动前步骤。`)
    } else if ((!entry.command.trim() && !entry.program?.trim()) || ((entry.type ?? 'shell') === 'shell' && !entry.command.trim())) {
      throw new Error(`配置「${entry.name}」没有可执行命令或程序。`)
    }
  }
  return closure
}

/** Nested/shared compounds dispatch each leaf once, preserving the member's own launch fields. */
export function compoundRunMembers(config: RunConfig, configs: readonly RunConfig[]): RunConfig[] {
  return runConfigClosure(config, configs).filter(entry => entry.type !== 'compound')
}

export function runConfigReferrers(name: string, configs: readonly RunConfig[]): RunConfig[] {
  return configs.filter(config => config.type === 'compound' && config.configurations?.includes(name))
}

/** 文件夹名校验：与原生 `runConfigs[].folder` 同规则（≤80 字节、单行）。 */
export function validateFolderName(name: string): string | null {
  if (!name) return null
  if (name.length > 80) return '文件夹名不能超过 80 个字符。'
  if (/[\r\n\t]/.test(name)) return '文件夹名不能包含换行或制表符。'
  return null
}

/** 树里一个节点（类型/文件夹/配置）的定位键，用于选中态与展开态。 */
export function nodeKey(kind: 'type' | 'folder' | 'config', ...parts: string[]): string {
  return `${kind}:${parts.join('\u0000')}`
}
