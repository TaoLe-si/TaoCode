import { reactive, readonly } from 'vue'
import type { ProjectTreeSortSettings } from './projectTreeSort.ts'
import { DEFAULT_NESTING_RULES, type NestingRule } from './projectTreeNesting.ts'

// ProjectViewSettings.getSortKey(): BY_NAME; ViewSettings.Immutable(null):
// foldersAlwaysOnTop=true. This is local browser persistence, not workspace.xml.
export const DEFAULT_PROJECT_TREE_SETTINGS: Readonly<ProjectTreeSortSettings> = Object.freeze({
  sortKey: 'BY_NAME', foldersAlwaysOnTop: true,
  // IDEA `ProjectViewSharedSettings.kt:32-34` 三条默认值都是 false。
  autoscrollToSource: false, autoscrollFromSource: false, openInPreviewTab: false,
  // IDEA `ProjectView.CompactDirectories` 默认关（`NodeOptions.java:41-43`）。
  compactDirectories: false,
  // IDEA `ProjectView.ShowScratchesAndConsoles` 默认**开**（`ViewSettings.java:54-56`、
  // `ProjectViewSharedSettings.kt:28`）⇒ 缺键的旧存档仍然显示那条合成根。
  showScratchesAndConsoles: true,
})
const BOOLEAN_KEYS = ['foldersAlwaysOnTop', 'autoscrollToSource', 'autoscrollFromSource', 'openInPreviewTab',
  'compactDirectories', 'showScratchesAndConsoles'] as const
const hosts = new Map<string, ReturnType<typeof createHost>>()
const prefix = 'taocode.projectView.v1:'
/** 排序设置对象 → 宿主（`projectTreeHostFor` 用的那张反查表）。 */
const bySettings = new WeakMap<object, ProjectTreeHost>()
/**
 * 文件嵌套那一格（`ProjectViewState.kt:49` `useFileNestingRules` +
 * `ProjectViewFileNestingService` 的规则表，见 `src/projectTreeNestingDialog.ts` 的模块头）。
 * 默认开关 **true** —— `ProjectViewSettings.isUseFileNestingRules()` 直接 `return true`
 * （`ProjectViewSettings.java:29-31`，`ProjectViewSettingsTest.kt:54` 断言的也是 true），
 * 规则表用 `ProjectViewFileNestingService.MyState` 的出厂表（`:105-107`）。
 *
 * 存储位置与上游不同，如实记在这里：上游 `ProjectViewFileNestingService` 是
 * `@State(name="ProjectViewFileNesting", storages=@Storage("ui.lnf.xml"))`（应用级），
 * 本仓没有 settings schema 的扩展位，规则表与开关就跟着**同一份项目视图设置**存在
 * localStorage，并按工作区根分桶 —— 换项目看到的是另一份规则表。
 */
export interface ProjectTreeNestingSettings {
  enabled: boolean
  rules: readonly NestingRule[]
}
const DEFAULT_NESTING: ProjectTreeNestingSettings = Object.freeze({
  enabled: true, rules: DEFAULT_NESTING_RULES,
})
/** 一个工作区根对应的项目视图宿主：排序/行为 + 嵌套规则 + 落盘状态（`update` / `updateNesting` 是仅有的两个写入口）。 */
export interface ProjectTreeHost {
  readonly state: ProjectTreeSortSettings
  readonly nesting: ProjectTreeNestingSettings
  readonly status: { persistenceError: string }
  update: (patch: Partial<ProjectTreeSortSettings>) => void
  updateNesting: (patch: { enabled?: boolean; rules?: readonly NestingRule[] }) => void
}
/**
 * 落盘形态按上游那张表整形（本轮 ptree3 核出来的形状差）：
 *   · 上游一条 `NestingRule` = **一对**父子后缀，`equals`/`hashCode` 比的也是这一对
 *     （`ProjectViewFileNestingService.java:110-159`，`equals` 在 `:149-153`）⇒ 同一对出现两次
 *     只算一条（`FileNestingBuilder.java:49` 收进的是 `OrderedSet`）；
 *   · 存储那张表是 `SortedList<>(Comparator.comparing(o -> o.getParentFileSuffix()))`
 *     （`ProjectViewFileNestingService.java:102-103`）⇒ **父后缀升序**；
 *     同一父内部的子次序按对话框那把 `parent + " " + child` 的比较器
 *     （`FileNestingInProjectViewDialog.java:45-46`，本仓同一个次序在 `src/projectTreeNestingDialog.ts`）。
 *   · 空后缀与父子相等的对不收（`FileNestingBuilder.java:58-59` 与对话框的 `doValidate`，
 *     后者在 `src/projectTreeNestingDialog.ts` 里已经守着）。
 * 注意这里**不做**传递规则展开：上游补规则发生在应用时（`FileNestingBuilder.getNestingRules()`），
 * 存的那份仍是用户写的基础表。
 */
function normalizeNestingRules(rules: readonly NestingRule[]): NestingRule[] {
  const pairs: Array<{ parent: string; child: string }> = []
  const seen = new Set<string>()
  for (const rule of rules) {
    if (!rule || !rule.parent) continue
    for (const child of rule.children ?? []) {
      if (!child || child === rule.parent) continue
      const key = `${rule.parent}\u0000${child}`
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push({ parent: rule.parent, child })
    }
  }
  pairs.sort((a, b) => {
    if (a.parent !== b.parent) return a.parent < b.parent ? -1 : 1
    const left = `${a.parent} ${a.child}`
    const right = `${b.parent} ${b.child}`
    return left < right ? -1 : left > right ? 1 : 0
  })
  const grouped = new Map<string, string[]>()
  for (const { parent, child } of pairs) {
    const list = grouped.get(parent)
    if (list) list.push(child)
    else grouped.set(parent, [child])
  }
  return [...grouped.entries()].map(([parent, children]) => ({ parent, children }))
}

/** 存档里的规则行要真的是 `{parent, children}` 才收下，坏行当没写（不判损坏）。 */
function readNestingRules(raw: unknown): readonly NestingRule[] {
  if (!Array.isArray(raw)) return DEFAULT_NESTING_RULES
  const rules: NestingRule[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return DEFAULT_NESTING_RULES
    const { parent, children } = item as { parent?: unknown; children?: unknown }
    if (typeof parent !== 'string' || !parent || !Array.isArray(children)) return DEFAULT_NESTING_RULES
    const list = children.filter((child): child is string => typeof child === 'string' && child !== '')
    if (!list.length) continue
    rules.push({ parent, children: list })
  }
  return normalizeNestingRules(rules)
}
function createHost(root: string): ProjectTreeHost {
  const state = reactive<ProjectTreeSortSettings>({ ...DEFAULT_PROJECT_TREE_SETTINGS })
  const nesting = reactive<ProjectTreeNestingSettings>({ ...DEFAULT_NESTING, rules: [...DEFAULT_NESTING_RULES] })
  const status = reactive({ persistenceError: '' })
  const key = prefix + encodeURIComponent(root)
  const settingsView = readonly(state)
  const nestingView = readonly(nesting)
  const statusView = readonly(status)
  function save() {
    if (!root) return
    try {
      localStorage.setItem(key, JSON.stringify({ ...state, useFileNestingRules: nesting.enabled, nestingRules: nesting.rules }))
      status.persistenceError = ''
    } catch { status.persistenceError = '项目视图设置无法保存；本次会话仍有效。' }
  }
  try {
    const raw: unknown = root ? JSON.parse(localStorage.getItem(key) ?? 'null') : null
    if (raw && typeof raw === 'object') {
      const value = raw as Record<string, unknown>
      if (value.sortKey === 'BY_NAME' || value.sortKey === 'BY_TYPE') state.sortKey = value.sortKey
      // 缺键就取默认：旧存档里没有这三条不该被判成损坏（与项目其它设置同一条纪律）。
      for (const key of BOOLEAN_KEYS) if (typeof value[key] === 'boolean') state[key] = value[key]
      if (typeof value.useFileNestingRules === 'boolean') nesting.enabled = value.useFileNestingRules
      if (value.nestingRules !== undefined) nesting.rules = readNestingRules(value.nestingRules)
    }
  } catch { status.persistenceError = '项目视图设置无法读取，当前使用默认值。' }
  function update(patch: Partial<ProjectTreeSortSettings>) {
    if (patch.sortKey === 'BY_NAME' || patch.sortKey === 'BY_TYPE') state.sortKey = patch.sortKey
    for (const key of BOOLEAN_KEYS) if (typeof patch[key] === 'boolean') state[key] = patch[key]
    save()
  }
  /**
   * 文件嵌套规则编辑器的落点（`ConfigureFilesNestingAction.actionPerformed`：
   * `view.setUseFileNestingRules(it)` 之后
   * `updateFromRoot(true, ProjectViewUpdateCause.SETTINGS)`，`.kt:56-58`）。
   * 开关与规则表一起交 —— 对话框的 `apply` 只在开关打开时才 `setRules`（`:235-245`），
   * 关着的时候表里的编辑不写回去，所以这里由调用方决定传不传 `rules`。
   */
  function updateNesting(patch: { enabled?: boolean; rules?: readonly NestingRule[] }) {
    if (typeof patch.enabled === 'boolean') nesting.enabled = patch.enabled
    if (patch.rules) nesting.rules = normalizeNestingRules(patch.rules)
    save()
  }
  const host = { state: settingsView, nesting: nestingView, status: statusView, update, updateNesting }
  // 「只有 settings 这一份 prop 的组件」找回自己的宿主（见 `projectTreeHostFor`）。
  // 键是 `readonly(state)` 那一个代理对象（Vue 对同一 target 恒返回同一个代理，身份稳定）。
  bySettings.set(settingsView, host)
  return host
}

/**
 * 齿轮「外观」那一组里的项（`ProjectView.FileNesting` 等）只拿到排序设置那一份对象，
 * 拿不到工作区根。上游用的是「当前窗格」这个隐式上下文
 * （`ConfigureFilesNestingAction.isFileNestingAllowed`，`platform/projectView/shared/src/actions/ConfigureFilesNestingAction.kt:38-47`
 * —— 取不到就 `isEnabledAndVisible = false`）；本仓的等价物就是这一张反查表：
 * **找不回宿主 ⇒ 组件按上游那样不渲染那一格**，而不是画一个点了没反应的菜单项。
 */
export function projectTreeHostFor(settings: unknown): ProjectTreeHost | null {
  if (!settings || typeof settings !== 'object') return null
  return bySettings.get(settings as object) ?? null
}

/** Both project trees must use this registry, never construct private hosts.
 * The exact native workspace root is the identity; no guessed path case folding.
 * No event listeners/watchers are installed, and inactive hosts issue no work.
 */
export function getProjectTreeState(root: string) {
  let host = hosts.get(root)
  if (!host) { host = createHost(root); hosts.set(root, host) }
  return host
}
