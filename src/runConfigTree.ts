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
import type { RunConfig } from './bridge'

/** IDEA 的 ConfigurationType 在 TaoCode 的三个对应物（标签沿用面板里的中文名）。 */
export const RUN_CONFIG_TYPES: Array<{ id: NonNullable<RunConfig['type']>; label: string }> = [
  { id: 'shell', label: 'Shell 命令' },
  { id: 'application', label: '应用程序' },
  { id: 'debug', label: '调试' },
]

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
    .map(node => ({ ...node, folders: [...node.folders].sort((a, b) => a.name.localeCompare(b.name)) }))
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
