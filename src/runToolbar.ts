// 运行 widget 的「最近配置」与「更多」动作（IDEA 运行工具条的 `RedesignedRunConfigurationSelector`
// 与 `MoreRunToolbarActions`）。
//
// 上游：`RunManagerImpl` 维护一个 MRU（`:589-628` 的 recent configurations，上限 5），
// 运行 widget 的选择器把最近用过的配置排在前面；`RunToolbarMainActionGroup` 的末尾是
// `MoreRunToolbarActions`（ExecutionActions.xml:121-128），展开的是运行侧那几个二级动作。
// 本仓的对应物：选择器弹层（App.vue 的 `.config-chooser`）用 `orderRunConfigNames` 排序，
// 工具条末尾的「更多」弹层用 `RUN_TOOLBAR_MORE_ACTIONS` 装配。两者都做成纯数据/纯函数，
// 便于 tests/run-toolbar.test.mjs 对着上游口径复核。
// 本模块是纯数据/纯函数：宿主（src/runConfigurations.ts）用 computed 去包它。

/** MRU 上限：RunManagerImpl 的最近配置列表长度。 */
export const RECENT_RUN_CONFIG_LIMIT = 5

/** 记住一次选择：置顶 + 去重 + 截断（不改原数组）。 */
export function rememberRecentConfiguration(
  recent: readonly string[], name: string, limit = RECENT_RUN_CONFIG_LIMIT,
): string[] {
  const trimmed = name.trim()
  if (!trimmed) return [...recent]
  return [trimmed, ...recent.filter(entry => entry !== trimmed)].slice(0, limit)
}

/** 选择器顺序：最近的在前（仍存在），其余按原有顺序跟在后面。 */
export function orderRunConfigNames(names: readonly string[], recent: readonly string[]): string[] {
  const known = new Set(names)
  const head = recent.filter(name => known.has(name))
  if (!head.length) return [...names]
  return [...head, ...names.filter(name => !head.includes(name))]
}

export interface RunToolbarMoreAction {
  id: string
  title: string
  /** 键位提示（与 Run 菜单同一套；`undefined` = 没有默认键）。 */
  keys?: string
}

/**
 * 「更多」弹层的动作（`MoreRunToolbarActions`）。子项取本仓真实存在的运行侧动作：
 *   · `run.rerun` —— `Rerun`（Ctrl+F5，runMenu.ts 的同一实现）；
 *   · `run.stopAll` —— `RunToolbarMainMultipleStopAction` 的「停止全部」；
 *   · `run.editConfigurations` —— `RunToolbarMainRunConfigurationsAction`（编辑配置对话框）。
 */
export const RUN_TOOLBAR_MORE_ACTIONS: readonly RunToolbarMoreAction[] = [
  { id: 'run.rerun', title: '重新运行', keys: 'Ctrl+F5' },
  { id: 'run.stopAll', title: '停止全部' },
  { id: 'run.editConfigurations', title: '编辑运行配置…' },
]

/** 选择器索引落在 MRU 排序后的列表上（打开弹层/上下键都用它）。 */
export function configIndexIn(names: readonly string[], current: string): number {
  return Math.max(0, names.indexOf(current))
}
