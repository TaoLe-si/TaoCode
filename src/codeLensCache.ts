// CodeLens / Code Vision 的**按文件缓存与刷新调度** ——
// 上游 `platform/lsp-impl/src/impl/features/codeLens/LspCodeLensCache.kt`（14-47 行）
// ＋ 它继承的 `.../highlightingCommon/LspHighlightingCache.kt` 在本仓的等价物。
//
// 判决 `docs/inventory/verdict-platform_rest.md`：
//   · `ls/code-lens`：「缺按文件缓存与分组设置（`LspCodeLensCache` 的重取时机……）」；
//   · `ls/features`：「缺按特性的缓存与刷新调度（…… `LspFeaturesRefreshing`/`LspPendingClient`
//     的等待-重取）」。
// 分组设置那半在 `src/codeLensSettings.ts`，这里只处理缓存那一半。
//
// 上游这份缓存做的事（逐条，都带坐标）：
//   · `LspHighlightingCache.kt:30-45` 的类注释是整份设计的说明：**"在服务器的新数据到达之前，
//     把编辑过的文件的范围继续留着"**；陈旧是按**文档**算的，快照记的是"发这条请求时的
//     `Document.modificationStamp`"，只有当前 stamp 与它不同才重取，回包也只有 stamp 还对得上才收。
//     别的文件被改**不**动这个文件的缓存（服务器自己从 `didChange` 知道那次改动）。
//   · `:72-79` `getHighlightings`：stamp 变了就先排一次重取，**同时照样返回旧的那一份**（先挪位、再给）；
//     快照为空才返回空。
//   · `:98-107` 去重闸：同一个 stamp 已经发过一次就不再发（`fileToStampWhenRequestSent.put(...) == stamp`）。
//   · `:108-111` 在飞的那条请求是为**另一个** stamp 发的 ⇒ 取消它，别让旧答案排在新答案前面。
//   · `:151-161` 首拍（这个文件什么都没缓存、也没有在飞）**不走去抖**，"文件打开的延迟不该被拖长"。
//   · `:195-206` `markSnapshotFresh`：服务器答"没变"时只把快照的 stamp 换掉，内容保留。
//   · `:212-217` `fileEdited`：编辑记进 `fileToPendingEdits`（前提是这一份快照还有内容在显示）。
//   · `:255-262` + `LspCachedHighlighting.kt:33-87`：把待处理的编辑逐条作用到范围上 ——
//     编辑在范围**之后** ⇒ 不动；在范围**之前** ⇒ 整条平移 `newLength - oldLength`；
//     完全落在范围**之内** ⇒ 范围按差值伸缩；**部分交叠** ⇒ 这条直接删掉。
//   · `:226-235` `clearCache`：全清（换语言服务/关文件那类）。
//   · `:244-253` `invalidate`：服务器**主动**要求重算（`workspace/codeLens/refresh` 那类）时，
//     把 stamp 换成一个永不等于真实 stamp 的哨兵（`:258` `STALE_DOC_MOD_STAMP = -1L`）但**保留内容**，
//     所以界面不闪 —— 新答案沿 `onResponseReceived` 那条正常路进来。
//   · `:264-269` 这一族（语义着色、文档链接、折叠、code lens、内联提示、颜色）的去抖是
//     `LOW_PRIORITY_QUIESCENCE_DELAY = 300.milliseconds`，注释写明"用户打字时这些都是装饰"；
//     诊断那一类才是 250ms（`:257-262`）。
//   · `LspCodeLensCache.kt:15-20` `isSupportedForFile`：要这台服务器支持 codeLens 且 customizer 允许问；
//     `:23-34` 服务端声明 `codeLensProvider.resolveProvider == true` 时，**没有 `command` 的 lens 要发
//     `codeLens/resolve` 补全**再画；`:44-46` 收到回包之后广播一次"刷新所有 lens"
//     （`LspFeaturesRefreshing.refreshCodeLenses`，`LspFeaturesRefreshing.kt:31-38`）。
//
// 本仓的承接方式（架构不等价，行为等价）：
//   · 上游的 `Document.modificationStamp` 在 CodeMirror 这一侧的等价物是 **`state.seq`**
//     （每提交一次事务 +1，同文档单调）；`codeLensExtension.ts` 把它当 stamp 传进来。
//   · "编辑作用到范围"这一步**不用自己写**：`DecorationSet.map(changes)` 走的就是 CodeMirror 的
//     同一套平移/伸缩规则。差别只有一条，如实记在这儿：上游"部分交叠 ⇒ 删掉这一条"
//     （`LspCachedHighlighting.kt:84-85`），CodeMirror 是把它夹成零宽继续留着。对 lens 这种
//     "挂在某一行行首的行上组件"，两者对用户都是"这一行还有那条提示"，所以本仓沿用 CodeMirror 的
//     行为，不另写一份删除规则去制造闪动。
//   · `codeLens/resolve` 那半**做不到**：`src/bridge.ts` 的 `LspRequestKind`（保留文件）里没有这个
//     kind，宿主 `native/lsp_session_kinds.cpp` 也没有对应分支 ⇒ 见接线请求 N1。
//   · `workspace/codeLens/refresh`（服务器主动要求重算 ⇒ `invalidate` 那条路）同理：宿主目前只把
//     `publishDiagnostics` / `$/progress` / `window/showMessage` 三条通知转出来
//     （`native/lsp.cpp:474-490`），刷新类通知没出口 ⇒ 见接线请求 N2。
//     `invalidate()` 在这里**照样实现并导出**，因为 `reset()`（换文件/换语言服务）走的就是它，
//     不是留着等人接的死代码。

/** 快照的"永不等于真实版本"哨兵（上游 `STALE_DOC_MOD_STAMP = -1L`，`LspHighlightingCache.kt:258`）。 */
export const STALE_DOC_SEQ = -1

/** 一条 lens 的范围（与 `src/codeLens.ts` 的 `CodeLensItem['range']` 同形，本模块不 import 渲染层）。 */
export interface LensRange {
  startLine: number
  startChar: number
  endLine: number
  endChar: number
}

/** 缓存里的一条 lens：渲染通道要的 (锚点行, 条目) 形状。 */
export interface CachedLens {
  line: number
  item: { title: string; command: string; arguments?: unknown[]; range: LensRange }
}

/** 一个文件的那份快照。 */
interface LensSnapshot {
  /** 发这条请求时的文档版本（`state.seq`）。哨兵值表示"内容还在，但必须重取"。 */
  seq: number
  lenses: CachedLens[]
  /** 已经为哪个 seq 发过请求了（`:98-107` 的去重闸）。 */
  sentForSeq: number | null
  /** 在飞的那条请求是为哪个 seq 发的（`:108-111` 的取消判据）。 */
  inFlightSeq: number | null
}

export interface LensCacheDecision {
  /** 这一拍该显示的内容（旧快照也算 —— 上游"先留着，等新数据"）。 */
  lenses: CachedLens[]
  /** 该不该向服务器重取一次。 */
  shouldRequest: boolean
  /** 这个文件**第一次**要 lens（首拍不走去抖，`:151-161`）。 */
  firstPull: boolean
}

export interface LensCache {
  /** `getHighlightings`（`:66-83`）：给当前 seq，拿回"显示什么 + 要不要重取"。 */
  peek(path: string, seq: number): LensCacheDecision
  /** 真的发请求之前问一句：同一个 seq 已经发过就别再发（`:98-107`）。 */
  beginRequest(path: string, seq: number): boolean
  /** 请求结束（成功或失败都要调）：把在飞标记清掉。 */
  endRequest(path: string, seq: number): void
  /**
   * 收答案 —— 只有文档版本还对得上才收（`:195-206` / `:158-169`）。
   * 返回 false 表示"这份答案已经过期"，调用方要按上游那样再排一次（`scheduleHighlightingsUpdate`）。
   */
  accept(path: string, seq: number, lenses: readonly CachedLens[]): boolean
  /** 服务器主动要求重算 / 宿主换了文档：保留内容、把版本打成哨兵（`:244-253`）。 */
  invalidate(path: string): void
  /** 关文件、换语言服务：这一份整个丢掉（`:226-235`）。 */
  forget(path: string): void
  /** 全清。 */
  clear(): void
  /** 缓存里有多少个文件（测试与诊断用）。 */
  size(): number
}

export function createCodeLensCache(): LensCache {
  const snapshots = new Map<string, LensSnapshot>()
  function snapshot(path: string): LensSnapshot {
    let existing = snapshots.get(path)
    if (!existing) { existing = { seq: STALE_DOC_SEQ, lenses: [], sentForSeq: null, inFlightSeq: null }; snapshots.set(path, existing) }
    return existing
  }
  return {
    peek(path, seq) {
      const current = snapshots.get(path)
      // 没有快照 = 首拍（既没内容也没在飞的那条），上游这时**不排队**（`:143-149`）。
      const firstPull = !current || (current.lenses.length === 0 && current.inFlightSeq === null)
      if (!current || current.seq !== seq) {
        return { lenses: current?.lenses ?? [], shouldRequest: true, firstPull }
      }
      return { lenses: current.lenses, shouldRequest: false, firstPull }
    },
    beginRequest(path, seq) {
      const current = snapshot(path)
      // 同一个 seq 已经发过一次 ⇒ 不再发（`:99-106`）；在飞的那条是别的 seq ⇒ 视作被取代（`:108-111`）。
      if (current.sentForSeq === seq) return false
      current.sentForSeq = seq
      current.inFlightSeq = seq
      return true
    },
    endRequest(path, seq) {
      const current = snapshots.get(path)
      if (!current) return
      // 只有"这条还归我"时才释放槽位（`:116-124` 的 `fileToInFlightRequest[file] === job` 那条判断）。
      if (current.inFlightSeq === seq) { current.inFlightSeq = null; if (current.sentForSeq === seq) current.sentForSeq = null }
    },
    accept(path, seq, lenses) {
      const current = snapshot(path)
      // 在飞期间文档又变了 ⇒ 这份答案的范围已经过时，不收（`:158-163`），让调用方重排一次。
      if (current.sentForSeq !== seq && current.inFlightSeq !== seq) return false
      current.seq = seq
      current.lenses = [...lenses]
      if (current.sentForSeq === seq) current.sentForSeq = null
      if (current.inFlightSeq === seq) current.inFlightSeq = null
      return true
    },
    invalidate(path) {
      const current = snapshots.get(path)
      if (!current) return
      // 哨兵：`STALE_DOC_SEQ` 永远不等于任何真实的 `state.seq`，所以下一次 `peek` 一定要重取；
      // 内容**保留** ⇒ 界面不闪（`:244-253` 那条注释说的就是这件事）。
      current.seq = STALE_DOC_SEQ
      current.sentForSeq = null
      current.inFlightSeq = null
    },
    forget(path) { snapshots.delete(path) },
    clear() { snapshots.clear() },
    size: () => snapshots.size,
  }
}
