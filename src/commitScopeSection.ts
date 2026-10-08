// 「提交文件…」的范围状态（上游 `CheckinFiles` 的 `setCommitState(initialChangeList, included, …)`
// 那一档在面板侧的落点）。从 `SourceControl.vue` 拆出来（那个文件贴着 900 行机检上限）。
//
// 两个来源走**同一条**归一化：
//   · 面板右键菜单点的「提交文件…」（`setScope` 收成一条变更）；
//   · 宿主从项目视图/变更视图多选传进来的 `commitPaths` prop（接线请求见
//     `docs/wiring-requests-2026-10-06-partialcommit.md` W1）。
// `null` = 没有范围 ⇒ `commitRequestParams` 连 `paths` 这个键都不发，请求体与历史逐字一致。
//
// 纯规则（重命名对补齐、已暂存还剩几个、算几个变更）在 `src/commitScope.ts`；本模块只持有
// "这一次的范围"这一个 ref，并把三处派生（selection / pathspec / 那一行文案）收在一起。
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { GitChange } from './vcsLogTypes.ts'
import { committedChangeCount, leftBehindStagedCount, renamePartnerCount } from './commitScope.ts'

export interface CommitScopeDeps {
  /** 当前所有变更（重命名对与"还剩多少已暂存"都要读它）。 */
  changes: () => readonly GitChange[]
  /** 宿主传进来的范围（`props.commitPaths`）。 */
  externalPaths: () => readonly string[] | undefined
  /** 归一化后的 pathspec（面板用 `expandCommitSelection` 补齐重命名对后交进来，那一行文案要读它）。 */
  pathspec: () => readonly string[]
}

export interface CommitScopeState {
  /** 这次要提交的路径（补全前的选择）；`null` = 整份暂存区。 */
  selection: ComputedRef<string[] | null>
  /** 范围那一行（空范围 = 空串 ⇒ 整行不出现）。 */
  notice: ComputedRef<string>
  /** 「提交文件…」：把范围收到这一条变更上（点了不提交）。 */
  setScope: (path: string) => void
  /** 提交完收回范围（上游 `CommitStateCleaner.resetState()` 重建 handler 即回默认）。 */
  clear: () => void
  /** 面板自己点出来的那一档（宿主 prop 之外）。 */
  scoped: Ref<string[] | null>
}
export function createCommitScope(deps: CommitScopeDeps): CommitScopeState {
  const scoped = ref<string[] | null>(null)
  const selection = computed<string[] | null>(() => {
    const external = deps.externalPaths()
    return scoped.value ?? (external?.length ? [...external] : null)
  })
  const notice = computed(() => {
    const paths = deps.pathspec()
    if (!paths.length) return ''
    const pairs = renamePartnerCount(paths, deps.changes())
    const left = leftBehindStagedCount(paths, deps.changes())
    return `本次只提交 ${committedChangeCount(paths, deps.changes())} 个变更`
      + (pairs ? `（含 ${pairs} 对重命名）` : '')
      + (left ? ` · 另有 ${left} 个已暂存的不进来` : '')
  })
  return {
    scoped, selection, notice,
    setScope: (path: string) => { scoped.value = [path] },
    clear: () => { scoped.value = null },
  }
}
