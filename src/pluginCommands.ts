// 插件贡献的**命令入口** —— 对照 IDEA 的插件 `<actions>` 注册。
//
// 插件只**贡献入口**：命令体（`plugin.json` 里的 `action`）必须是 TaoCode 已经有的动作 id
// （`native/plugins.hpp` 写明了理由：让第三方脚本进宿主等于沙箱逃逸）。所以"启用插件"
// 这件事的真实含义就是把这些菜单行接上既有动作的执行链 —— 这个模块负责"挑哪些行、
// 怎么分组、怎么命名"，怎么执行由宿主注入（`run` / `hasAction`）。
//
// 纯逻辑，可单独测（`tests/plugin-commands.test.mjs`）。
import type { MenuRow } from './menus/types'
import type { PluginCommand, PluginInfo } from './pluginGroups'
import { compareText, pluginIsLoadable } from './pluginGroups.ts'

/** 命令没有写 `group` 时的默认分组（`native/plugins.cpp` 里 `Command::group` 的初值）。 */
export const DEFAULT_PLUGIN_COMMAND_GROUP = '插件'

/** 顶层菜单名。只有至少一条可用命令时这个菜单才出现（空组不渲染）。 */
export const PLUGIN_MENU_LABEL = '插件'

/**
 * 能贡献命令的插件：**启用的**、清单读得出来的，且依赖齐的。
 * 对照 `MyPluginModel`：只有加载成功的插件才会注册它的扩展点 —— 依赖不满足的插件
 * 在原生侧带 `broken`，IDEA 同样不加载它，它贡献的命令也不该出现在菜单里。
 */
export function enabledPlugins(plugins: readonly PluginInfo[]): PluginInfo[] {
  return plugins.filter(pluginIsLoadable)
}

export interface PluginCommandEntry {
  /** 菜单行 id（全局唯一，与 IDEA 的 action id 同性质）：`plugin.<插件 id>.<命令 id>`。 */
  id: string
  pluginId: string
  pluginName: string
  command: PluginCommand
}

/** 把启用插件贡献的命令摊平（一个插件多条命令时逐条列出）。 */
export function pluginCommandEntries(plugins: readonly PluginInfo[]): PluginCommandEntry[] {
  const entries: PluginCommandEntry[] = []
  // 菜单行 id 就是 `plugin.<插件 id>.<命令 id>`，同一 id 出现两行在 Vue 的 key 与
  // 「查找操作」里都是同一个 bug。原生解析已经对同一插件内的重复命令 id 取了第一条
  // （`native/plugins.cpp` 的 read_commands），这里再兜一层：手改过的清单、或将来换了
  // 数据来源，也不会把重复行漏到菜单里。
  const seen = new Set<string>()
  for (const plugin of enabledPlugins(plugins)) {
    for (const command of plugin.commands) {
      const id = `plugin.${plugin.id}.${command.id}`
      if (seen.has(id)) continue
      seen.add(id)
      entries.push({ id, pluginId: plugin.id, pluginName: plugin.name || plugin.id, command })
    }
  }
  return entries
}

/** 按 `group` 归拢（组名空串归到默认组），组内与组间都按码元顺序。 */
export function pluginCommandGroups(entries: readonly PluginCommandEntry[]): { group: string; entries: PluginCommandEntry[] }[] {
  const buckets = new Map<string, PluginCommandEntry[]>()
  for (const entry of entries) {
    const group = (entry.command.group ?? '').trim() || DEFAULT_PLUGIN_COMMAND_GROUP
    const bucket = buckets.get(group)
    if (bucket) bucket.push(entry)
    else buckets.set(group, [entry])
  }
  return [...buckets.entries()]
    .map(([group, members]) => ({
      group,
      entries: [...members].sort((left, right) => compareText(left.command.title, right.command.title)),
    }))
    .sort((left, right) => compareText(left.group, right.group))
}

export interface PluginCommandHooks {
  /** 执行某个 action id（宿主在动作表里找它并运行）。 */
  run: (action: string) => void
  /** 该 action id 现在存在吗 —— 不存在就整行禁用（IDEA 里没注册的 action 根本不会出现，
   *  本仓让行留在原位并置灰，用户至少能看出"自己的插件指向了一个不存在的动作"）。 */
  hasAction?: (action: string) => boolean
}

/**
 * 插件菜单的行。只有一组命令时直接列出命令（与 IDEA 展开单层 group 的行为一致），
 * 有多组时每组一个子菜单（`children`，对应 `<group popup="true">`）。
 */
export function pluginMenuRows(plugins: readonly PluginInfo[], hooks: PluginCommandHooks): MenuRow[] {
  const entries = pluginCommandEntries(plugins)
  if (!entries.length) return []
  const groups = pluginCommandGroups(entries)
  const rowsOf = (members: readonly PluginCommandEntry[]): MenuRow[] =>
    members.map(entry => ({
      id: entry.id,
      title: entry.command.title,
      // 关键字带上插件名与命令 id/action，好让「查找操作」能按插件搜到。
      keywords: `plugin ${entry.pluginId} ${entry.pluginName} ${entry.command.id} ${entry.command.action} 插件`,
      ...(hooks.hasAction ? { enabled: () => hooks.hasAction!(entry.command.action) } : {}),
      run: () => hooks.run(entry.command.action),
    }))
  if (groups.length === 1) return rowsOf(groups[0]!.entries)
  return groups.map(group => ({
    id: `plugin.group.${group.group}`,
    title: group.group,
    keywords: `plugin 插件 ${group.group}`,
    children: rowsOf(group.entries),
  }))
}
