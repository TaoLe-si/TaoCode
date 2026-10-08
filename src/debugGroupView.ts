// 变量树「按类型分组」的**面板侧状态**（分组开关 + 组展开态的跨会话存档 + 全部展开/收起）。
//
// 纯规则在 `src/debugFrameTree.ts`（上游 `XValueGroup`/`XValueGroupNodeImpl`）；本模块只持有
// 那个开关 ref、把存档灌进 `open`、并在组键变化时写回。从 `DebugPanel.vue` 拆出（那个文件
// 贴着 900 行机检上限，见 `tests/module-size.test.mjs`），与 `src/debugWatchesStore.ts` /
// `src/debugWatchActions.ts` 同一做法：状态自持、面板只调。
import { computed, watch, type ComputedRef, type Ref } from 'vue'
import { allGroupsExpanded, collapseGroups, expandGroups, readGroupExpansion, writeGroupExpansion } from './debugFrameTree.ts'

/** 组节点行（够判定"哪些键是组"与"是不是全展开"）。 */
interface GroupRow { key: string; group?: boolean }

export interface DebugGroupViewDeps {
  /** 存档通道（`localStorage`；无宿主时为 null）。 */
  storage: Pick<Storage, 'getItem' | 'setItem'> | null
  /** 工作区根（存档按它分键）。 */
  root: () => string
  /** 当前渲染行（`collectVarRows` 的结果）。 */
  rows: () => readonly GroupRow[]
  /** 展开态表（面板那一份 `open`，按引用传入 —— 存档读回要灌进同一份）。 */
  open: Record<string, boolean>
  /**
   * 「按类型分组」开关。由**面板**持有并提前声明 —— `dataView` 那个 computed 在 setup 早期
   * 就要读它（`watch` 会立刻跑一次 getter），模块自己造 ref 会踩 TDZ。
   */
  groupByType: Ref<boolean>
}

export interface DebugGroupView {
  /** 组键是不是全展开（展开/收起按钮的选中态）。 */
  allExpanded: ComputedRef<boolean>
  /** 全部展开 / 全部收起（作用在组键上，普通行的展开态不动）。 */
  toggleAll: () => void
}

export function createDebugGroupView(deps: DebugGroupViewDeps): DebugGroupView {
  const groupByType = deps.groupByType
  // 打开面板就把上次存的组键灌进同一份 `open`（上游 `XValueGroupNodeImpl.isExpand` 读
  // `PropertiesComponent`，`:43-50`）。普通行/作用域的展开态是会话内的，不落盘。
  Object.assign(deps.open, readGroupExpansion(deps.storage, deps.root()))
  const allExpanded = computed(() => allGroupsExpanded(deps.open, deps.rows()))
  // 组键的展开态一变就写回存档（上游 `onExpansion` 的落点，`:52-60`）。
  watch(deps.rows, () => { if (groupByType.value) writeGroupExpansion(deps.storage, deps.root(), deps.open) })
  function toggleAll() {
    const next = allExpanded.value ? collapseGroups(deps.open, deps.rows()) : expandGroups(deps.open, deps.rows())
    for (const key of Object.keys(deps.open)) delete deps.open[key]
    Object.assign(deps.open, next)
  }
  return { allExpanded, toggleAll }
}