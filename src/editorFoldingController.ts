// 折叠的**调度管道** —— 自包含控制器（与 `src/documentLinksExtension.ts` / `codeLensExtension.ts` 同一个套路：
// 宿主只注入依赖，逻辑留在模块里）。
//
// 一段管道的**顺序本身就是语义**（对应上游 `CodeFoldingManagerImpl.updateFoldRegionsAsync:257-288` 与
// `UpdateFoldRegionsOperation`）：
//   ① 存：把"这一轮重算之前"的状态记下来（`DocumentFoldingInfo.loadFromEditor`）——
//      折着的都记；"本该默认折着却展开着"的按签名记成覆盖状态（用户展开过）；
//   ② 装区间：服务端给的 `foldingRange` 进 field；
//   ③ 记候选：把这一轮的候选（带当时的签名）记下来 —— 文档一变区间就被清空，
//      下一轮判"本该默认折着"要靠它；
//   ④ 按设置折默认那一族（`LspFoldingBuilder.kt:41-46` 的 `collapsedByDefault`）；
//   ⑤ 清失效：新候选里没有的旧折叠先存后删（`removeInvalidRegions`）；
//   ⑥ 恢复：把存档按偏移+签名放回去（区间被编辑推走的按签名认回，`computeExpandRanges:146-164`）。
//
// 两个坑都是真机上踩出来的：
//   · ⑤ 之前必须 ①，否则"用户展开过的块"会被 ④ 按默认又折上；
//   · 整段管道**必须串行**：两轮并存时，后一轮会在前一轮"折好默认、还没恢复覆盖"的中间态上存档，
//     把"用户展开过"记成"折着"（真机上就是这么丢的）。
import type { EditorView } from '@codemirror/view'
import { applyFoldPlan, candidatesOf, foldDefaultCollapsed, foldKinds, foldedAreasOf, localRegionFolds, mergeFoldRanges, setFoldingRanges } from './editorFolding.ts'
import { captureFoldState, dropStaleFolds, flushFoldState, rememberCandidates, restorePlan, savedFoldState, signatureAt } from './editorFoldingState.ts'
import type { LspFold } from './editorFolding'

export interface FoldingControllerDeps {
  /** 当前文件（存档按路径存）。 */
  path: () => string
  /** 当前编辑器（可能在卸载后为 undefined）。 */
  view: () => EditorView | undefined
  /** 「代码折叠」设置的两族开关：`kind` + 该不该默认折。 */
  foldingKinds: () => readonly { kind: string; collapse: boolean }[]
  /** 服务端给的折叠区间（`lsp.request` 的 `foldingRange`），不可用时给空数组。 */
  fetchRanges: () => Promise<readonly LspFold[]>
  onError?: (error: unknown) => void
  debounceMs?: number
}

export function createFoldingController(deps: FoldingControllerDeps) {
  const debounceMs = deps.debounceMs ?? 400
  let timer: number | undefined
  let busy = false
  let again = false

  /** ① 存档（标签页关掉/换文件之前、以及每一轮重算之前都要调）。 */
  function capture() {
    const view = deps.view()
    if (!view) return
    captureFoldState(deps.path(), view.state.doc, foldedAreasOf(view.state), enabledKinds())
    // 存完顺带安排一次**落盘**（去抖）：上游是文件编辑器 dispose 时把状态交给
    // `CodeFoldingManager.saveFoldingState`（写进 workspace 文件），本仓攒一小会儿写进项目设置。
    flushFoldState()
  }

  /**
   * ④ 按设置把"默认该折着"的那几族折起来，关掉的那几族展开（设置一改就重算）；
   * 再补一条**逐区域**的默认：开始标记自带 `defaultstate="collapsed"` 的区域，
   * 全局 `collapseCustomRegions` 关着也折（`NetBeansCustomFoldingProvider.java:46-48`，
   * 上游是 `CustomFoldingBuilder.java:131-142` 对每条区间单独问一次 provider）。
   */
  function applyDefaults() {
    const view = deps.view()
    if (!view) return
    for (const entry of deps.foldingKinds()) foldKinds(view, [entry.kind], entry.collapse)
    foldDefaultCollapsed(view)
  }

  /** ⑥ 恢复存档（偏移+签名对得上就放回；区间被编辑推走的按签名认回）。 */
  function restore() {
    const view = deps.view()
    if (!view) return
    const plan = restorePlan(view.state.doc, savedFoldState(deps.path()), candidatesOf(view.state))
    applyFoldPlan(view, plan.fold, plan.unfold)
  }

  /** ⑤ 清失效：新候选里没有的旧折叠先存后删。 */
  function dropStale() {
    const view = deps.view()
    if (!view) return
    const stale = dropStaleFolds(deps.path(), view.state.doc, candidatesOf(view.state), foldedAreasOf(view.state))
    if (stale.length) applyFoldPlan(view, [], stale)
  }

  const enabledKinds = () => deps.foldingKinds().filter(entry => entry.collapse).map(entry => entry.kind)

  async function run() {
    const view = deps.view()
    if (!view) return
    if (busy) { again = true; return }
    busy = true
    try {
      const ranges = await deps.fetchRanges()
      const target = deps.view()
      if (!target) return
      // 本地 `//<region>` / `//region` 标记并进服务端区间（服务端同起止的优先，见 editorFolding.ts
      // 的 `mergeFoldRanges`）：服务端不发 region kind 或没接语言服务时，标记照样能折。
      const merged = mergeFoldRanges(ranges, localRegionFolds(target.state.doc.toString()))
      capture()
      target.dispatch({ effects: setFoldingRanges.of(merged) })
      rememberCandidates(deps.path(), candidatesOf(target.state).map(candidate => ({ ...candidate, signature: signatureAt(target.state.doc, candidate) })))
      applyDefaults()
      dropStale()
      restore()
    } catch (error) {
      deps.onError?.(error)
    } finally {
      busy = false
      if (again) { again = false; schedule() }
    }
  }

  function schedule() {
    if (timer !== undefined) clearTimeout(timer)
    timer = window.setTimeout(() => { timer = undefined; void run() }, debounceMs)
  }

  function dispose() {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  return { schedule, run, capture, restore, applyDefaults, dispose }
}
