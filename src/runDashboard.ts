// 运行仪表盘的数据面（上游 `execution/dashboard` 的 `RunDashboardManager` /
// `RunDashboardService` / `RunDashboardGroup` 的可移植子集）。
//
// 上游把运行配置按分组（默认「Services」树）列成仪表盘：每个配置一行，带状态、运行时长与
// 动作（停止/重跑），还有 `RunDashboardCustomizer` 决定颜色/图标。本仓没有 Services 工具窗口
// （App.vue 冻结，没地方挂新面板），所以落成**运行工具栏里的实例仪表盘**：
// 列出所有实例（每行 = 一个 RunContentDescriptor），状态/时长/操作可见，点击切到那个实例。
//
// 分组（2026-10-05 补，上一轮判"不做"的那半）：上游 `RunDashboardGroup` 只有
// `getName()`/`getIcon()`（`platform/lang-api/src/com/intellij/execution/dashboard/RunDashboardGroup.java:23-27`），
// 分组键来自 `RunDashboardDefaultTypesProvider.getDefaultTypeIds(project)`（同目录 `:12-15`，
// 返回的是**配置类型 id**），显示哪些类型由 `RunDashboardManager.getTypes()/setTypes()`
// （`platform/execution/src/com/intellij/execution/dashboard/RunDashboardManager.java:40-44`）管。
// 本仓对应物：分组键 = `RunConfig['type']`（本仓的配置类型注册表在 `src/runConfigTree.ts:16-21`
// 的 `RUN_CONFIG_TYPES`，标签复用 `runConfigTypeLabel`），显示哪些类型 = 弹层顶上那排类型开关
// （`readRunDashboardTypes`/`writeRunDashboardTypes`，存 localStorage）。
//   · `getIcon()` 没有对应物：如实登记 —— 上游的组图标来自 `ConfigurationType.getIcon()`，
//     本仓的类型没有图标注册表（`RunConfigurationsDialog.vue` 的类型节点也没有图标），
//     凭空配一套就是"挑个差不多的"，所以不渲染图标。
//   · `RunDashboardCustomizer`（EP）与每组批量动作仍不做：前者没有插件 EP 宿主，后者需要
//     "一组一个控制器"，本仓只有全局的停止全部。
//
// 纯函数 + 组件接线，判据 tests/run-dashboard.test.mjs。
import { RUN_CONFIG_TYPES, runConfigTypeLabel } from './runConfigTree.ts'

/** 配置表里认不出 / 实例没有对应配置时落进的组（上游没有这一档，本仓必须给个去处）。 */
export const RUN_DASHBOARD_OTHER_TYPE = 'other'
export const RUN_DASHBOARD_OTHER_LABEL = '其它'

/** 组名：复用配置树的类型标签（`runConfigTree.ts:71-73`），「其它」自成一档。 */
export function runDashboardTypeLabel(type: string): string {
  if (!type || type === RUN_DASHBOARD_OTHER_TYPE) return RUN_DASHBOARD_OTHER_LABEL
  return runConfigTypeLabel(type)
}

export interface RunDashboardInput {
  id: number
  label: string
  running: boolean
  exit: number | null
  startedAt: number
  pid?: number
  /** 运行配置类型（`RunConfig['type']`）—— 分组键；空 = 归到「其它」。 */
  type?: string
}

export interface RunDashboardRow {
  id: number
  title: string
  /** running = 在跑；ok = 正常退出（code 0）；failed = 非零退出；stopped = 被停止（-1）。 */
  state: 'running' | 'ok' | 'failed' | 'stopped'
  statusText: string
  elapsedText: string
  pid: number
  /** 分组键：`RunConfig['type']`，认不出就是 `RUN_DASHBOARD_OTHER_TYPE`。 */
  type: string
}

/** 时长文案：`12s` / `1m 05s` / `2h 03m`（与状态栏的粗粒度一致，不显示毫秒）。 */
export function formatRunDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
}

function stateOf(instance: RunDashboardInput): RunDashboardRow['state'] {
  if (instance.running) return 'running'
  if (instance.exit === null) return 'running'
  if (instance.exit === 0) return 'ok'
  if (instance.exit === -1) return 'stopped'
  return 'failed'
}

function statusTextOf(state: RunDashboardRow['state'], exit: number | null): string {
  switch (state) {
    case 'running': return '正在运行'
    case 'ok': return '已完成'
    case 'stopped': return '已停止'
    default: return `退出码 ${exit ?? '?'}`
  }
}

/** 仪表盘行：按 id 升序（起跑顺序），`now` 用于算在跑实例的时长。 */
export function runDashboardRows(instances: readonly RunDashboardInput[], now: number): RunDashboardRow[] {
  return [...instances]
    .sort((left, right) => left.id - right.id)
    .map(instance => {
      const state = stateOf(instance)
      return {
        id: instance.id,
        title: instance.label || `运行 ${instance.id}`,
        state,
        statusText: statusTextOf(state, instance.exit),
        elapsedText: formatRunDuration(now - instance.startedAt),
        pid: instance.pid ?? 0,
        type: instance.type || RUN_DASHBOARD_OTHER_TYPE,
      }
    })
}

/** 一组（上游 `RunDashboardGroup`：`getName()` 落成 `name`；`getIcon()` 无对应物，见文件头）。 */
export interface RunDashboardGroup {
  type: string
  name: string
  rows: RunDashboardRow[]
  /** 组内在跑的实例数（组头那一行的徽标）。 */
  running: number
  total: number
}

/**
 * 按配置类型分组（上游 Services 树按配置类型分组的可移植子集）。
 *
 * 顺序 = `RUN_CONFIG_TYPES` 的固定顺序（`runConfigTree.ts:16-21`：Shell 命令 / 应用程序 /
 * 调试 / 复合配置），「其它」永远排最后 —— 与上游"按注册的类型 id 顺序、再兜底"一致。
 * `visibleTypes` 是 `RunDashboardManager.getTypes()` 那一档（哪些类型显示）；`undefined`
 * = 全显示（上游初始就是全显示）。被过滤掉的组不出现；一个组被过滤空了就整组不见。
 */
export function groupRunDashboardRows(
  rows: readonly RunDashboardRow[], visibleTypes?: readonly string[],
): RunDashboardGroup[] {
  const shown = visibleTypes ? new Set(visibleTypes) : undefined
  const buckets = new Map<string, RunDashboardRow[]>()
  for (const row of rows) {
    if (shown && !shown.has(row.type)) continue
    const bucket = buckets.get(row.type)
    if (bucket) bucket.push(row)
    else buckets.set(row.type, [row])
  }
  const order = [...RUN_CONFIG_TYPES.map(entry => entry.id), RUN_DASHBOARD_OTHER_TYPE]
  const groups: RunDashboardGroup[] = []
  for (const type of order) {
    const bucket = buckets.get(type)
    if (!bucket || !bucket.length) continue
    groups.push({
      type,
      name: runDashboardTypeLabel(type),
      rows: bucket,
      running: bucket.filter(row => row.state === 'running').length,
      total: bucket.length,
    })
  }
  return groups
}

/**
 * 类型开关只列**当前真有实例**的类型。
 *
 * 上游那一排是 `RunDashboardManager.setTypes()`（`platform/execution/src/com/intellij/
 * execution/dashboard/RunDashboardManager.java:40-44`）的 `getTypes()`：它返回的是**配置类型
 * id**（由 `RunDashboardDefaultTypesProvider.getDefaultTypeIds` 给全量，`:12-15`），
 * 而不是"哪一行"。本仓的开关是"哪些**组**显示"，所以这里给"此刻真有实例的类型" ——
 * 给一个空组配开关就是点不动的死控件（铁律 §3）。顺序仍按 `RUN_CONFIG_TYPES` 固定序，
 * 「其它」排最后，与 `groupRunDashboardRows` 的兜底档一致。
 */
export function runDashboardPresentTypes(rows: readonly RunDashboardRow[]): string[] {
  const present = new Set(rows.map(row => row.type))
  return [...RUN_CONFIG_TYPES.map(entry => entry.id), RUN_DASHBOARD_OTHER_TYPE].filter(type => present.has(type))
}

// —— 显示哪些类型（`RunDashboardManager.getTypes()/setTypes():40-44`）——

export const RUN_DASHBOARD_TYPES_KEY = 'taocode.runDashboardTypes'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * 读"当前显示哪些类型"。`null` = 用户没设过 = **全显示**（上游的初始状态就是全部类型都在树上）。
 * 记录坏了一律当没设过（全显示），不给"仪表盘空了"这种惊喜。
 */
export function readRunDashboardTypes(store: StorageLike | undefined): string[] | null {
  try {
    const raw = store?.getItem(RUN_DASHBOARD_TYPES_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    const known = new Set<string>([...RUN_CONFIG_TYPES.map(entry => entry.id), RUN_DASHBOARD_OTHER_TYPE])
    return parsed.filter((type): type is string => typeof type === 'string' && known.has(type))
  } catch {
    return null
  }
}

export function writeRunDashboardTypes(store: StorageLike | undefined, types: readonly string[]): void {
  try { store?.setItem(RUN_DASHBOARD_TYPES_KEY, JSON.stringify([...new Set(types)])) } catch { /* 存储不可用只影响持久化 */ }
}

/** 切换某一类型的显示（弹层顶上那排开关走它）。 */
export function toggleRunDashboardType(shown: readonly string[] | null, type: string): string[] {
  const all = [...RUN_CONFIG_TYPES.map(entry => entry.id), RUN_DASHBOARD_OTHER_TYPE]
  const current = shown ? all.filter(candidate => shown.includes(candidate)) : [...all]
  return current.includes(type) ? current.filter(candidate => candidate !== type) : [...current, type]
}

/** 汇总文案（仪表盘头部）：`2 个在跑 · 1 个已完成 · 1 个失败`。 */
export function runDashboardSummary(rows: readonly RunDashboardRow[]): string {
  if (!rows.length) return '还没有运行实例'
  const count = (state: RunDashboardRow['state']) => rows.filter(row => row.state === state).length
  const parts: string[] = []
  if (count('running')) parts.push(`${count('running')} 个在跑`)
  if (count('ok')) parts.push(`${count('ok')} 个已完成`)
  if (count('failed')) parts.push(`${count('failed')} 个失败`)
  if (count('stopped')) parts.push(`${count('stopped')} 个已停止`)
  return parts.join(' · ')
}
