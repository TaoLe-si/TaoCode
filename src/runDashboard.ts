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
//
// 2026-10-06（runinst2）：行不再自己算一遍，**从 `src/runInstances.ts` 的行模型投影**。
// 上一轮（runinst）已经把「正在运行」清单改成从 `runInstanceRows()` 投影，理由写在
// `src/runInstances.ts:456-460`：上游标签条与清单读的是**同一个字符串**
// （`platform/execution/src/com/intellij/execution/ui/RunContentDescriptor.java` 的
// `getDisplayName()`），所以「同一个实例在标签上叫运行 1、在别的列表里叫运行 2」本来就是错的。
// 当时漏了仪表盘这第三处 —— 它按 `instance.id` 数名字，而记录被 `forget()` 删掉之后
// id 与「按 id 升序的下标」就会分叉（`src/runInstances.ts:161-175`：清单排除 `closed`、
// 记录删除后 id 不连续）。现在三处同一个来源。
// 顺带把「这一格能不能停 / 是不是 Kill process / 停止文案」也交给行模型：
// `StopAction` 的 `canBeStopped` 与 kill 两档（`src/runInstances.ts:589-595`、`:631`）读的是
// 实例的 `stopping`/`closed`，仪表盘自己只看 `running` 是算不出「正在结束途中」那一档的。
import { RUN_CONFIG_TYPES, runConfigTypeLabel } from './runConfigTree.ts'
import {
  STOP_LABELS, runInstanceRows, runInstanceState, runInstanceStatusText,
  type RunInstanceRow, type RunInstanceRowState,
} from './runInstances.ts'

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
  /** running = 在跑；ok = 正常退出（code 0）；failed = 非零退出；stopped = 被停止。 */
  state: RunInstanceRowState
  statusText: string
  elapsedText: string
  pid: number
  /** 分组键：`RunConfig['type']`，认不出就是 `RUN_DASHBOARD_OTHER_TYPE`。 */
  type: string
  /**
   * 这一格的「停止」可不可点（上游 `StopAction.canBeStopped`，本仓单源在
   * `src/runInstances.ts:589-595`）。与 `state === 'running'` 不同源 ⇒ 以前仪表盘自己按
   * `running` 数，现在取行模型 ⇒ 同一实例在两处不会出现「一处能停一处不能停」。
   */
  stoppable: boolean
  /** 进程已在结束途中 ⇒ 这一格的动作是 Kill process（`ExecutionBundle.properties:203`）。 */
  kill: boolean
  /** 停止那一格的文案单源：`Stop ''{0}''`（`:208`）/ 正在结束那档换 `Kill process`（`:203`）。 */
  stopText: string
  /**
   * 同名行之间的区分描述（上游 `process.id.tooltip`，`ExecutionBundle.properties:204`，
   * 只在进程活着时设、结束时清掉 —— `RunContentManagerImpl.kt:369-376` 与 **:401**）。
   * 空串 = 没有 ⇒ 宿主那一行不渲染（不假造区分信息）。
   */
  description: string
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

/**
 * 状态档位的**唯一来源**是行模型（`src/runInstances.ts` 的 `runInstanceState`）。
 * 这条规则原先在本文件与 `runInstances.ts:554-560` 各写了一遍（那边 `:518` 的注释自己就写着
 * 「两处不能各说一遍」⇒ 原写「各写一份」、实际本批收敛成一份，留痕见报告）。
 *
 * 上游派生（`RunDashboardRunConfigurationStatus.getStatus`，
 * `platform/lang-api/src/com/intellij/execution/dashboard/RunDashboardRunConfigurationStatus.java:59-76`）：
 * `exitCode == null` ⇒ STARTED（在跑，`:67-69`）、`exitCode == 0 || TERMINATION_REQUESTED` ⇒ STOPPED
 * （`:71-73`）、否则 FAILED（`:75`）；四档名与图标在同文件 `:21-28`，文案键
 * `run.dashboard.*.group.name` 在 `ExecutionBundle.properties:373-376`。
 * 本仓把上游的 STOPPED 一档又拆成「已完成 / 已停止」两档（上游只有 `Finished` 一档），
 * 「是谁结束了进程」这一列的归因缺口如实记在报告 §6 D2（宿主 `aborted` 字段是重载的）。
 */
function stateOf(instance: RunDashboardInput): RunInstanceRowState {
  return runInstanceState(instance.running, instance.exit)
}

/** 文案同样单源（`runInstances.ts` 的 `runInstanceStatusText`，四档措辞两处必须一致）。 */
function statusTextOf(state: RunInstanceRowState, exit: number | null): string {
  return runInstanceStatusText(state, exit)
}

/**
 * 仪表盘行：按 id 升序（起跑顺序），`now` 用于算在跑实例的时长。
 *
 * `model` 是行模型（id → `RunInstanceRow`）；省略时就地从 `runInstanceRows()` 取 ——
 * 显示名、可停性、kill 档、停止文案、pid 描述**全部**从它投影，仪表盘不再自己另算一遍。
 * 传进来的 id 不在记录里（纯函数用法、单元测试）才按本列表的下标兜底，规则与
 * `runInstanceDisplayName` 一致（`运行 N`，N 从 1 起）。
 */
export function runDashboardRows(
  instances: readonly RunDashboardInput[],
  now: number,
  model?: ReadonlyMap<number, RunInstanceRow>,
): RunDashboardRow[] {
  const projected = model ?? new Map(runInstanceRows().map(row => [row.id, row]))
  return [...instances]
    .sort((left, right) => left.id - right.id)
    .map((instance, index) => {
      const state = stateOf(instance)
      const row = projected.get(instance.id)
      const title = row?.title || instance.label || `运行 ${index + 1}`
      const kill = row?.kill ?? false
      return {
        id: instance.id,
        title,
        state,
        statusText: statusTextOf(state, instance.exit),
        elapsedText: formatRunDuration(now - instance.startedAt),
        pid: instance.pid ?? 0,
        type: instance.type || RUN_DASHBOARD_OTHER_TYPE,
        // 记录不在模型里（外来的纯输入）时退回「在跑就可停」，与拆之前一致，不臆造 kill。
        stoppable: row?.stoppable ?? instance.running,
        kill,
        stopText: kill ? STOP_LABELS.kill : STOP_LABELS.one(title),
        description: row?.tabDescription ?? '',
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
