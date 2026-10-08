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
import { configurationTypeById, registerBundledConfigurationType } from './executionExtensionPoints.ts'

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

// bundled 登记：把本仓**在跑的**这几个配置类型挂进 `com.intellij.configurationType` EP
// （逐字 id + 树里的显示名 / 描述）。上游每条 `ConfigurationType` 都是该 EP 的一条贡献
// （`intellij.platform.execution.xml:29`），本仓同样让内建类型出现在 EP 里 ⇒ ① 第三方按同一 id
// 挂自己的类型会被 `runConfigTypeLabel`/`configurationTypeById` 取到；② 内建那几条不是"只存在于
// 私有表里"。id 逐字是上游 `ConfigurationType.getId()`（shell 是本仓内建、上游对应
// `GeneralCommandLine` 那类外部命令配置，见文件头差异）。重复调用只覆盖同 id，幂等。
for (const entry of RUN_CONFIG_TYPES) {
  registerBundledConfigurationType({
    id: entry.id,
    getDisplayName: () => entry.label,
    getConfigurationTypeDescription: () => entry.label,
  })
}

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
  // 内建类型取本仓标签；不认识的类型先问 `com.intellij.configurationType` EP（第三方按 id 挂的
  // 运行配置类型的显示名），仍没有才回落到原始 id —— 旧行为（未知类型保留原串）逐字不变。
  return RUN_CONFIG_TYPES.find(entry => entry.id === type)?.label
    ?? configurationTypeById(type)?.getDisplayName()
    ?? type
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

// ── 「Sort Configurations」（上游 `RunConfigurable.kt:1289-1341`，文案 ExecutionBundle.properties:79） ──
//
// 上游那条动作的三个面，这里落成三个纯函数（对话框/宿主只负责选节点与回写整份清单）：
//   · 可用档 `:1331-1341`：选中的节点里有 **CONFIGURATION_TYPE 或 FOLDER** 才启用；选中配置本身 ⇒ 不可点；
//   · 作用范围 `:1309-1330`：对**每个**选中的类型/文件夹节点，把它的直接子节点按比较器重排；
//   · 比较器 `:1292-1307`（逐条对应见下）。
// 本仓的树是「类型 → 文件夹 → 配置」三层（`buildRunConfigTree`），一个节点的直接子节点里
// 既有文件夹（FOLDER）也有配置，所以比较器吃的是**兄弟节点描述**，调用方把子节点列出来交给它。

/** 排序比较器看到的一个兄弟节点（类型节点不在兄弟里；`folder` = 上游 FOLDER）。 */
export interface RunConfigSortSibling {
  /** 是文件夹节点（上游 `RunConfigurableNodeKind.FOLDER`）。 */
  folder: boolean
  /** 是临时配置（上游 `TEMPORARY_CONFIGURATION`）。 */
  temporary: boolean
  /** 展示名（配置名 / 文件夹名）。 */
  name: string
}

/**
 * 上游 `RunConfigurable.kt:1292-1307` 那条比较器的等价物：
 *   ① 文件夹永远在前（`:1293-1296`）；两个文件夹之间**保持原有相对次序** —— 上游用
 *      `node1.parent.getIndex(node1) - node2.parent.getIndex(node2)`，本仓交给 JS `Array.sort`
 *      的**稳定性**（ES2019 起规范要求稳定），所以这里返回 0；
 *   ② 普通配置按名（`:1298-1299`，`Collator`/`String.compareTo` ⇒ 本仓 `localeCompare`）；
 *   ③ `TEMPORARY_CONFIGURATION` 在后（`:1300-1306`）；同为临时时再按名。
 */
export function compareRunConfigSiblings(left: RunConfigSortSibling, right: RunConfigSortSibling): number {
  if (left.folder !== right.folder) return left.folder ? -1 : 1
  if (left.folder) return 0                        // 两个文件夹之间保序（靠稳定排序）
  if (left.temporary !== right.temporary) return left.temporary ? 1 : -1
  return left.name.localeCompare(right.name)
}

/** 把一串兄弟节点按上游比较器重排（稳定）；返回新数组，不改入参。 */
export function sortRunConfigSiblings<T extends RunConfigSortSibling>(siblings: readonly T[]): T[] {
  return [...siblings].sort(compareRunConfigSiblings)
}

/** 一条配置在比较器眼里的形状（`folder` 恒 false；文件夹由调用方另给）。 */
export function runConfigSortSiblingOf(config: RunConfig): RunConfigSortSibling {
  return { folder: false, temporary: config.temporary === true, name: config.name }
}

/**
 * 「Sort Configurations」可用档（上游 `:1331-1341`）：选中的节点里有类型或文件夹才启用。
 * `kinds` 传选中节点的种类（`nodeKey` 的第一个字段）；空选、只选中配置 ⇒ false。
 */
export function canSortRunConfigNodes(kinds: readonly string[]): boolean {
  return kinds.some(kind => kind === 'type' || kind === 'folder')
}

/**
 * 上游 `RunManager.suggestUniqueName`（`platform/execution/src/com/intellij/execution/RunManager.kt:51-65`）
 * 配套的那条正则：`UNIQUE_NAME_PATTERN = "(.*?)\\s*\\(\\d+\\)"`（同文件 `:67`），
 * `extractBaseName`（`:69-71`）在名字被占用时先把**尾部那段 ` (N)` 剥掉**再往上数 ——
 * 所以连着复制同一份配置得到的是 `X (1)`、`X (2)`，而不是 `X (1) (1)`。
 * Java 的 `Matcher.matches()` 是整串匹配，故这里两边都加锚点。
 */
const UNIQUE_NAME_PATTERN = /^(.*?)\s*\(\d+\)$/

/** `RunManager.extractBaseName`（同文件 `:69-71`）的等价物。 */
export function extractRunConfigBaseName(name: string): string {
  const match = UNIQUE_NAME_PATTERN.exec(name)
  return match ? match[1] : name
}

/**
 * `RunManager.suggestUniqueName`（`platform/execution/src/com/intellij/execution/RunManager.kt:51-65`）：
 * 没被占用就原样返回；被占用则剥掉尾部 ` (N)` 取基名，再按 `%s (%d)` **从 1 起**往上找第一个空位。
 *
 * 订正留痕：这里原先写的是「`RunConfigurable.createUniqueName`（:934）：基名被占用时追加 2、3…，
 * IDEA 从 1 起，本仓沿用「名字 2」风格」——上游两件事都不是这样：
 * 编号从 **1** 起、分隔符是**括号** ` (1)`，而且会先 `extractBaseName` 剥掉已有的 ` (N)`。
 * 现在按上游实现，形状与 `RunManager.kt:56-64` 逐字对应。
 *
 * 作用域差异（如实登记）：上游按**类型子树**数名字（`RunConfigurable.kt:1548-1575` 只在 `typeNode` 里
 * 收集 CONFIGURATION / TEMPORARY_CONFIGURATION / FOLDER 节点；`RunManager.kt:203-206` 按 type 取清单），
 * 本仓的配置名是**全局唯一**的（`src/runConfigurationSchema.ts` 那条「运行配置名不能重复」）
 * ⇒ 调用方传进来的清单就是全局那一份，比上游更严，不会出现两个类型各有一个同名配置。
 */
export function uniqueRunConfigName(configs: readonly RunConfig[], base: string): string {
  const used = new Set(configs.map(config => config.name))
  if (!used.has(base)) return base
  const originalName = extractRunConfigBaseName(base)
  for (let index = 1; ; index++) {
    const candidate = `${originalName} (${index})`
    if (!used.has(candidate)) return candidate
  }
}

/**
 * 新建配置的回落名：上游 `RunConfigurable.kt:934` 取 `suggestName(configuration)`
 * （`:942-949`，只有 `LocatableConfiguration.suggestedName()` 有值时才用），取不到就落到
 * `createUniqueName` 里那句 `run.configuration.unnamed.name.prefix`
 * （`platform/execution/resources/messages/ExecutionBundle.properties:266` = `Unnamed`，见同文件 `:1559`）。
 * 本地树里**没有中文本地化包**（`find -name "*_zh*.properties"` 0 命中）⇒ 这一句是英文原文直译，
 * 不是上游的中文原文；原先写死的「新配置」没有任何上游出处，已订正。
 */
export const RUN_CONFIG_UNNAMED_NAME = '未命名'

/**
 * 保存/改名时要不要拦下来：上游这条判据在 **apply**（不在 `checkConfiguration()`）——
 * `RunConfigurable.kt:659-666` 逐节点收集名字，`names.add(nameText)` 失败就选中那一节并抛
 * `dialog.message.run.configuration.already.exists`
 * （`ExecutionBundle.properties:66` = `{0} with name ''{1}'' already exists`，`{0}` 是**类型显示名**）。
 * 文案按英文原文直译（无中文包，同上）。
 *
 * 差异登记：上游的 apply 是**按类型分组**跑的（`applyByType`），所以撞上的那条必然与正在保存的那条同类型；
 * 本仓名字全局唯一 ⇒ 撞上的可能是别的类型，这里报的是**被撞上那一条自己的类型**，
 * 这样用户顺着提示去树里能找到它。
 *
 * `currentName` = 这条记录改名前的名字（上游那条判据天然不含自己：同一个节点的名字只进 `names` 一次）。
 */
export function runConfigNameProblem(
  configs: readonly RunConfig[], name: string, currentName = '',
): string | null {
  const wanted = name.trim()
  if (!wanted || wanted === currentName) return null
  const clash = configs.find(config => config.name === wanted)
  if (!clash) return null
  // 缺 `type` 按 shell 归组，与左树 `buildRunConfigTree` 里 `config.type ?? 'shell'` 同一口径。
  return `类型为「${runConfigTypeLabel(clash.type ?? 'shell')}」的运行配置已存在：名字「${wanted}」。`
}

/**
 * 保存动作的「前身」信息（对话框 → 域模块）。上游不需要这个东西：`SingleConfigurationConfigurable`
 * 手里那条 `RunnerAndConfigurationSettings` 就是身份本身（`RunManagerImpl.kt:500 settings.uniqueID`），
 * 改名字段是**就地**改同一条（`RunConfigurable.kt:659-666` 只拦重名）。
 * 本仓的草稿是扁平记录、名字就是键 ⇒ 改名字段必须把「它原来叫什麼」带过去，否则旧的那条会留在盘上。
 * 见 `src/runConfigurations.ts` 的 `saveRunConfigFromDialog`。
 */
export interface RunConfigSaveOrigin {
  /** 表单当前载入自的那条记录的名字；空/省略 = 新建，没有前身。 */
  readonly from?: string
  /** 这条是**副本**：插在源名之后（`RunConfigurable.kt:902` 的 `getIndex(selectedNode) + 1`），源自己留着。 */
  readonly copyOf?: string
}

/**
 * 「保存这条草稿」落到清单上的形状（`src/runConfigurations.ts` 的 `saveRunConfigFromDialog` 用它）。
 * 上游不需要这种函数：身份是 settings 的 `uniqueID`（`RunManagerImpl.kt:500`），
 * 改名字段动的就是同一条、位置不动，副本才插到源后面（`RunConfigurable.kt:900-911`）。
 * 本仓的清单是扁平数组、名字就是键 ⇒ 「就地替换 / 插到源后面 / 引用回写」这三件事得自己算，
 * 原状（只按新名去重再追加）会把改名做成「旧的那条还留在盘上」。
 *
 * 三条规则：
 *  1. `from` 有值、且与 `stable.name` 不同、且不是副本 ⇒ **就地改名**：摘掉旧名那条、
 *     把它原来那一格让给新名字（`RunConfigurable.kt:659-666` 的重名由 `runConfigNameProblem` 在写盘前拦）。
 *  2. 复合成员的引用一起换成新名。这一条是**本仓差异**（如实登记）：
 *     上游成员按 `(type, name)` 存（`CompoundRunConfiguration.kt:160`），解析不到就跳过那一条
 *     （同文件 `:93-98` 的 `continue`），不回写；本仓的 schema 把「成员不存在」判成**整份坏档**
 *     （`normalizeRunConfigurations` 那条 `复合配置引用了不存在的成员`，写入在
 *     `src/bridgePreview.ts:215` 被 `INVALID_SETTINGS` 打回）⇒ 不回写就是「改一次名字之后什么都存不下去」。
 *  3. 副本插在源之后（`RunConfigurable.kt:902`），其余情况都回到自己原来那一格，新建才追加到末尾。
 */
export function applyRunConfigSave(
  list: readonly RunConfig[], stable: RunConfig, origin?: RunConfigSaveOrigin,
): { configs: RunConfig[]; renamed: boolean; previous: string } {
  const previous = (origin?.from ?? '').trim()
  const copyOf = (origin?.copyOf ?? '').trim()
  const renamed = Boolean(previous) && previous !== stable.name && !copyOf
  let working = list.map(entry => ({ ...entry }))
  if (renamed) {
    working = working.filter(entry => entry.name !== previous)
    for (const entry of working) {
      if (entry.type === 'compound' && entry.configurations?.includes(previous))
        entry.configurations = entry.configurations.map(name => (name === previous ? stable.name : name))
    }
  }
  const configs = working.filter(entry => entry.name !== stable.name)
  // 插入点：副本 = 源之后（`RunConfigurable.kt:902`）；就地改名 = 旧名那一格；编辑 = 自己那一格；新建 = 末尾。
  // 三种情况都换算成「在原表里排在这次插入点之前、且这次会被保留下来的条数」。
  const anchorName = copyOf || (renamed ? previous : stable.name)
  const anchor = list.findIndex(entry => entry.name === anchorName)
  let index = configs.length
  if (anchor >= 0) {
    const through = copyOf ? anchor + 1 : anchor
    index = list.slice(0, through).filter(entry => entry.name !== previous && entry.name !== stable.name).length
  }
  configs.splice(index, 0, stable)
  return { configs, renamed, previous }
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
