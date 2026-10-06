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
//   ⑥ 恢复：把存档按偏移+签名放回去（区间被编辑推走的按签名认回，`computeExpandRanges:146-164`）；
//   ⑦ 导航那一段：跳到某处时把与**那一行**相交的折痕打开（上游 `OpenFileDescriptor.java:205-221`
//      的 `getRangeToUnfoldOnNavigation` + `UpdateFoldRegionsOperation.shouldExpandNewRegion:243-249`
//      的 `ApplyDefaultStateMode.EXCEPT_CARET_REGION` 那一档，由 `FoldingUpdate.java:155` 在
//      「这次重算来自一次导航」时选出）。宿主调 `navigateToRange(offset)` 走这一步。
//
// 两个坑都是真机上踩出来的：
//   · ⑤ 之前必须 ①，否则"用户展开过的块"会被 ④ 按默认又折上；
//   · 整段管道**必须串行**：两轮并存时，后一轮会在前一轮"折好默认、还没恢复覆盖"的中间态上存档，
//     把"用户展开过"记成"折着"（真机上就是这么丢的）。
import type { EditorView } from '@codemirror/view'
import { applyFoldPlan, candidatesOf, foldDefaultCollapsed, foldKinds, foldedAreasOf, localRegionFolds, mergeFoldRanges, navigationRange, setFoldingRanges, unfoldIntersecting } from './editorFolding.ts'
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
  // 「这个编辑器实例的这份文件已经建过折叠区间」—— 上游那份存在编辑器 userdata 里的
  // `FOLDINGS_INITIALIZED`（`CodeFoldingManagerImpl.java:276-281` 的 `isFoldingsInitializedInEditor` /
  // `setFoldingsInitializedInEditor`）。按「编辑器 + 文件路径」记：同一个视图换文件时算第一次
  // （上游换文件是新编辑器，标记自然也是新的）。
  const builtFor = new WeakMap<object, string>()
  // 管道里跑的那一次才算"重算"；宿主直接调 `applyDefaults()`（设置改了）不算 —— 见 ④ 那段。
  let inPipeline = false

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
   *
   * **什么时候才"按默认折"照上游那两档**（`FoldingUpdate.java:83-101` + `:154-156`）：
   *   · 给这个编辑器的这份文件**第一次**建区间 = 上游的 `firstTime` ⇒ `ApplyDefaultStateMode.EXCEPT_CARET_REGION`
   *     —— 按默认折（`shouldExpandNewRegion:245-250`）；
   *   · 之后的每一轮重算 ⇒ `ApplyDefaultStateMode.NO`（`:253-254`：只看 `rangeToExpandStatusMap` 里的老状态，
   *     `oldStatus == null` 的**新**块返回「展开」）⇒ 编辑之后新长出来的 import / region 块不会再被自动折上。
   * 宿主那条「设置一改就重算」（`CodeEditor.vue` 的 watch → `folding.applyDefaults()`）**不在管道里**：
   * 它对应上游 `CodeFoldingConfigurable.Util.applyCodeFoldingSettingsChanges` —— 刚勾上开关就得当场生效，
   * 所以那一路无条件施加（`inPipeline` 为假）。
   * 与上游的一处差别（如实记）：上游在 `CodeFoldingManagerImpl.java:276-281` 是无条件打"这个编辑器建过折叠"
   * 的标记，本仓的区间是**异步回包**，第一轮很可能是语言服务还没起来的空表 ⇒ 只有真拿到区间才打标记，
   * 否则"打开文件时默认折 import"这一条会永远错过。
   */
  function applyDefaults() {
    const view = deps.view()
    if (!view) return
    if (!inPipeline || builtFor.get(view) !== deps.path()) { applyFoldingDefaults(view); return }
    // 重算轮次：关掉的那一族照样要展开回去（那是设置的结果，不是"默认折叠"这一档），
    // 但不再按默认折，也不再理 `defaultstate="collapsed"`。
    for (const entry of deps.foldingKinds()) if (!entry.collapse) foldKinds(view, [entry.kind], false)
  }

  /** 无条件施加默认折叠（第一次建区间、以及宿主那条"设置改了"的路）。 */
  function applyFoldingDefaults(view: EditorView) {
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

  /**
   * 这一次重算是**导航**引来的那一段（上游 `UpdateFoldRegionsOperation.java:143` 的
   * `OpenFileDescriptor.getRangeToUnfoldOnNavigation(myEditor)`）：宿主跳到某个位置时先问一句
   * 「这块是折着的吗」，折着就打开。上游把这件事做成 `ApplyDefaultStateMode` 三档里的
   * `EXCEPT_CARET_REGION`（`FoldingUpdate.java:155`：这次重算带导航 → 这一档；
   * `shouldExpandNewRegion:243-249`：与导航段相交的区间一律「展开」，哪怕它本该按默认折着）。
   * 记一份就够（一次导航 = 一次展开），下一次重算消费掉它 ⇒ 用户自己按收起的那块不会被顶回来。
   */
  let pendingNavigation: { from: number; to: number } | null = null

  /** 把导航段里折着的区间展开（没记就是空操作）。 */
  function applyNavigation(view: EditorView): boolean {
    if (!pendingNavigation) return false
    const opened = unfoldIntersecting(view, pendingNavigation.from, pendingNavigation.to)
    pendingNavigation = null
    return opened
  }

  /**
   * 宿主的「跳转到这一处」入口（转到行 / 转到用法 / 栈帧 / 粘性行点击都算）：
   * 立即打开落点所在那一行上的折痕（上游 `OpenFileDescriptor.java:205-221`：导航段就是
   * **光标那一整行**，与它相交（`TextRange.intersects` 含端点，`TextRange.java:237-238`）且折着的区间一律
   * `setExpanded(true)`），
   * 并把这一段留给**下一次重算** —— 重算会按默认折一遍，不留就又被折回去了。
   * `to` 给成一段时按那一段算（同一个方法里的第二段参数，语义与上游的 navigationRange 一致）。
   */
  function navigateToRange(offset: number, to?: number): boolean {
    const view = deps.view()
    if (!view) return false
    pendingNavigation = navigationRange(view.state, offset, to)
    return unfoldIntersecting(view, pendingNavigation.from, pendingNavigation.to)
  }

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
      // 「重算」这一段只在管道里成立：置位贴着 applyDefaults，免得 await 期间宿主那条"设置改了"被误判。
      inPipeline = true
      applyDefaults()
      inPipeline = false
      // 真拿到区间才算"这个编辑器的这份文件建过折叠"（上游 `setFoldingsInitializedInEditor`，
      // `CodeFoldingManagerImpl.java:281`）；空表不算，否则语言服务还没起来时就把默认折叠那一档错过了。
      if (merged.length) builtFor.set(target, deps.path())
      dropStale()
      restore()
      // ⑦ 导航那一段（有就展开、消费掉）：这一步必须在 restore 之后。
      // 上游这两条规矩是**互斥的两档**（`shouldExpandNewRegion:243-249`：`ApplyDefaultStateMode != NO`
      // 时只看「与导航段相交」+ `collapsedByDefault`；只有 `NO` 那一档才去看 `oldStatus` 那份存档），
      // 而本仓的管道每次都把「按默认折」和「按存档恢复」两步都跑 ⇒ 导航那一步排最后才顶得住：
      // ④ 会把它按默认折回来、⑥ 会按签名把折着的存档放回去。
      applyNavigation(target)
    } catch (error) {
      deps.onError?.(error)
    } finally {
      inPipeline = false
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

  return { schedule, run, capture, restore, applyDefaults, navigateToRange, dispose }
}
