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
// 上游这份缓存做的事（2026-10-06 codevision2 **逐条重新打开过参考树核对行号**——
// 原写的那一批（`:30-45`/`:72-79`/`:98-107`/`:108-111`/`:151-161`/`:195-206`/`:212-217`/`:226-235`/
// `:244-253`/`:258`/`:264-269`）**整体偏小 20–65 行**，且 `:257-262` 那个"诊断 250ms"的出处根本不存在；
// 参考树里 `LspHighlightingCache.kt` 只有一份、共 338 行 ⇒ 不是两个版本的问题，是没打开过。
// 下面每一条都是按 `awk NR` 数出来的实际行号）：
//   · `:28-36` 的类注释是整份设计的说明：**"Helps to keep reasonable highlighting ranges for edited
//     files until updated info arrives from the server"**；陈旧是按**文档**算的，快照记的是"发这条请求时的
//     `Document.modificationStamp`"，只有当前 stamp 与它不同才重取，回包也只有 stamp 还对得上才收。
//     别的文件被改**不**动这个文件的缓存（服务器自己从 `didChange` 知道那次改动）。
//   · `:62-83` `getHighlightings`：stamp 变了就先排一次重取（`:68-71`），**同时照样返回旧的那一份**
//     （`:73-78` 把待处理编辑作用上去再返回）；快照为空才返回空（`:73-75`）。
//   · `:93-103` 去重闸：同一个 stamp 已经发过一次就不再发
//     （`:95` `if (fileToStampWhenRequestSent.put(file, docModStamp) == docModStamp) return@launch`，
//     注释 `:96-101` 还点名"服务器主动要求重取**不**走这条路：`invalidate` 会把 stamp 抹掉并取消在飞的那条"）。
//   · `:104-105` 在飞的那条请求是为**另一个** stamp 发的 ⇒ 取消它，别让旧答案排在新答案前面。
//   · `:50-51` + `:140-149` + `:161-163` 首拍（这个文件什么都没缓存、也没有在飞）**不走去抖**，
//     原文 `so the file-open latency is unaffected`；判据 `isFirstPullFor` 读的是**两个 map 都为空**，
//     不是"内容为空"—— 一份 `Full` 回答哪怕一条都没有也会建快照（`:170-186` `responseReceived`
//     经 `:184` `applyServerHighlightings` 落快照，`:234` 那一格就是建快照那一句）。
//     **本仓原来把这条实现成"内容为空就算首拍"，这一版按上游改回来**（见下面 `answered` 那格）。
//   · `:170-177` `responseReceived`：文档在飞期间又变了 ⇒ **不收**这份答案，并立刻再排一次
//     （`:173-176`：`if (document.modificationStamp != docModStamp) { scheduleHighlightingsUpdate(file); return null }`）。
//   · `:192-210` `markSnapshotFresh`：服务器答"没变"时只把快照的 stamp 换掉，内容保留（`:206` 没有快照时
//     直接 `return`，把"unchanged"当失败处理）。
//   · `:249-253` `fileEdited`：编辑记进 `fileToPendingEdits`（前提是这一份快照还有内容在显示，`:250`）。
//   · `:263-270` `clearCache`：四张 map 全清并取消在飞的（`:292-303` `invalidate` 与之的差别就写在
//     `:289-290`：`invalidate` 保留内容 ⇒ 界面不闪）。
//   · `:292-303` `invalidate`：服务器**主动**要求重算（`workspace/…/refresh` 那类）时，取消在飞、
//     抹掉去重闸，再把 stamp 换成 `:313` 的 `STALE_DOC_MOD_STAMP = -1L`（`:301`），内容**保留**。
//   · `:52` + `:321` + `:328` 去抖档位：这一族（语义着色、文档链接、折叠、code lens、内联提示、颜色）默认
//     `LOW_PRIORITY_QUIESCENCE_DELAY = 300.milliseconds`（`:328`，注释 `:322-327` 写明"用户打字时这些都是装饰"），
//     诊断那一类才是 `DIAGNOSTICS_QUIESCENCE_DELAY = 250.milliseconds`（`:321`）。
//   · `LspCachedHighlighting.kt:33-53`（`applyPendingEdits`）与 `:55-87`（`applyPendingEdit`）：把待处理的编辑
//     逐条作用到范围上 —— 编辑在范围**之后** ⇒ 不动（`:65-67`）；在范围**之前** ⇒ 整条平移；
//     完全落在范围**之内** ⇒ 按差值伸缩；**部分交叠** ⇒ 这条直接删掉（`:84` 的注释原文
//     `changed range intersects with the highlighting.textRange ⇒ delete highlighting`）。
//   · `LspCodeLensCache.kt:15-20` `isSupportedForFile`：要这台服务器支持 codeLens 且 customizer 允许问；
//     `:23-37` 服务端声明 `codeLensProvider.resolveProvider == true` 时，**没有 `command` 的 lens 要发
//     `codeLens/resolve` 补全**再画（`:28-33`）；`:44-46` 收到回包之后广播一次"刷新所有 lens"
//     （`LspFeaturesRefreshing.refreshCodeLenses`，`LspFeaturesRefreshing.kt:31-38`）。
//
// 本仓的承接方式（架构不等价，行为等价）：
//   · 上游的 `Document.modificationStamp`（`platform/core-api/src/com/intellij/openapi/editor/Document.java:25`
//     "stamp is incremented whenever the content changes"、`:185` "not related to the file modification time"、
//     `:192` 声明）在本仓的号源是 **`semanticRevisionOf(view.state.doc)`**（`src/semanticHighlighting.ts:339-354`：
//     CodeMirror 的 `Text` 不可变 ⇒ **对象身份就是修订**，只把它压成稳定整数）。
//     **订正留痕（2026-10-06 codelensfix）**：这一条原来写「等价物是 `state.seq`（每提交一次事务 +1，同文档单调）」——
//     那句话**不成立**：`@codemirror/state` 6.7.6 的 `EditorState` 上没有 `seq`（`dist/index.d.ts` 全文零命中，
//     prototype 只有 `field/update/applyTransaction/replaceSelection/changeByRange/changes/toText/sliceDoc/facet/
//     toJSON/tabSize/lineBreak/readOnly/phrase/languageDataAt/charCategorizer/wordAt`，实跑 `state.seq === undefined`），
//     `vue-tsc` 直接报 TS2339。仓内另外两处早就把这条写死过：`src/completionUi.ts:106-108`「`EditorState` 上
//     没有公开的 changeCount/seq 可用」与 `src/docHoverContent.ts:123-130`（同一 WeakMap 做法，并点名
//     "按 `state.epoch` 会把改选区也算成变更"是错的）。号由 `src/codeLensExtension.ts` 传进来；
//     与 `src/editorInlayHints.ts:230`/`:259`（同一条上游基类 `LspHighlightingCache` 的另一条具名缓存）用**同一份号源**，
//     不再另造第三张 WeakMap。
//     为什么不是 `src/lspHighlightingCache.ts:154` 的 `contentStamp`（内容哈希）：`src/documentRevisions.ts:22-28`
//     已明文定过口径 ——「号也不是内容哈希：改回去也算改过……哈希会在"改了又改回来"时不作废，那不是上游的判据」，
//     而取哈希要 `sliceDoc()` 整篇 O(n)；`Text` 对象身份两头都对（改一次换一次号、派发装饰/改选区不换号）。
//     同一理由也不取"每事务计数"：那会把派发 lens、改选区都算成"文档变了"，与上游 `:68-71` 的判据不符。
//   · "编辑作用到范围"这一步**不用自己写**：`DecorationSet.map(changes)` 走的就是 CodeMirror 的
//     同一套平移/伸缩规则。差别只有一条，如实记在这儿：上游"部分交叠 ⇒ 删掉这一条"
//     （`LspCachedHighlighting.kt:84-85`），CodeMirror 是把它夹成零宽继续留着。对 lens 这种
//     "挂在某一行行首的行上组件"，两者对用户都是"这一行还有那条提示"，所以本仓沿用 CodeMirror 的
//     行为，不另写一份删除规则去制造闪动。
//   · `codeLens/resolve` 那半**做不到**：`src/bridge.ts` 的 `LspRequestKind`（保留文件）里没有这个
//     kind，宿主 `native/lsp_session_kinds.cpp` 也没有对应分支 ⇒ 见接线请求。本仓因此把
//     "没有 command 的 lens"直接丢在宿主那一头（`native/lsp_session_kinds.cpp:335-337`），
//     并且客户端能力表里 `codeLens` 那一条**不声明** `resolveProvider`
//     （`native/lsp_host_bootstrap.cpp:218-220`，注释原文「声明了就会收到不带 command 的 CodeLens，
//     那就必须再实现一条 codeLens/resolve 链路」）⇒ 声明与实发一致，服务器不该发来待补全的 lens。
//   · `workspace/codeLens/refresh`（服务器主动要求重算 ⇒ `invalidate` 那条路）**通知链已经通**：
//     `native/lsp.cpp:755` 认这一族并 `tag_server_message`（`:182-190`/`:195-198`）转出来 →
//     `src/lspServerMessages.ts` 按 `refresh` 档分派 → 渲染通道经 `addLspRefreshListener` 补刷。
//     订正留痕（2026-10-06 codevision2）：这一条原来写「宿主只把 publishDiagnostics / $/progress /
//     window/showMessage 三条转出来，刷新类通知没出口 ⇒ 见接线请求 N2」—— 那是 N2 落地**之前**的状态，
//     与磁盘不符（`tests/lsp-server-messages.test.mjs:407-417` 早就在端到端跑 `workspace/inlayHint/refresh`）。
//     缺的从来不是"转出来"，是"转出来之后**当场重新问一次**"那一步 ⇒ 本批补上（消费点在
//     `src/codeLensExtension.ts` 与 `src/editorInlayHints.ts`），`invalidate()` 也由此有了生产调用方。
//   · 显示连续性（上游 `getHighlightings` 直接回旧的那一份）这一半**没有接**：那要按**文件**分槽，
//     而 `CodeLensDeps` 手里没有当前路径（`native`/`bridge` 都不用改，缺的是宿主传一行
//     `path: () => props.path`）⇒ 没有路径就认不出"这是另一个文件"，把上一个文件的 lens 画到新文件上
//     比"闪一下"严重得多。`path` 是**可选**注入：给了就按文件分槽（首拍 0ms、同 seq 去重都逐文件生效），
//     没给就退化成"一个控制器一个槽"。见 `docs/wiring-requests-2026-10-06-codevision2.md` 的 C-1。

// 与上游同一件事但**本仓这一版故意不登记**：上游 `LspCodeLensCache` 是**每台语言服务一份**
// （`LspHighlightingCache.kt:37` 那个类就是 `LspCache`，注册进 `LspClientImpl.kt:106` 的
// `highlightingCacheRegistry`，`LspHighlightingCacheRegistry.kt:46-48` 一次清整族）。本仓现在这份是
// **每个编辑器一份**（`CodeLensDeps` 手里没有当前路径，见下面「本仓的承接方式」最后一条），
// 而编辑器随标签页开关反复创建 ⇒ 自登记 = 每关掉一个文件就永久留一份缓存（`registerLspCache` 只有
// 登记、没有注销）。所以"参与批量作废"这一半与**按文件分槽**同一批做，接线请求 C-1
// （`docs/wiring-requests-2026-10-06-codevision2.md`）：宿主给一行 `path: () => props.path` 之后，
// 这份缓存提成模块级单例、按 path 分槽、构造即 `registerLspCache`。
// 在那之前，整族作废这一半由宿主的既有调用点承担：`CodeEditor.vue:1066` 关语言服务时调
// `codeLens.reset()`，那一步现在会走 `cache.clear()`（等价于上游客户端换掉时 `clearCache()` 那一条）。

/** 快照的"永不等于真实版本"哨兵（上游 `STALE_DOC_MOD_STAMP = -1L`，`LspHighlightingCache.kt:313`）。 */
export const STALE_DOC_SEQ = -1

/** 一条 lens 的范围（与 `src/codeLens.ts` 的 `CodeLensItem['range']` 同形，本模块不 import 渲染层）。 */
export interface LensRange {
  startLine: number
  startChar: number
  endLine: number
  endChar: number
}

/** 缓存里的一条 lens：渲染通道送进来的那个对象（`AnchoredLens` 与本地条目同形）。 */
export interface CachedLens {
  line: number
  item: { title: string; command: string; arguments?: unknown[];
    /**
     * 锚点区间**可选**：服务端 lens 带（`src/codeLens.ts:20` 的 `CodeLensItem['range']` 就是可选），
     * 本地 Code Vision 条目（`src/codeVisionProviders.ts` 的 `CodeVisionEntry` → `AnchoredCodeVisionEntry`）
     * **不带** —— 它按行锚定，没有区间。原来这一格写的是必填，于是渲染通道那份 `AnchoredLens[]`
     * 在 `codeLensExtension.ts` 的调用点上根本过不了类型（TS2345）。
     */
    range?: LensRange }
}

/** 一个文件的那份快照。 */
interface LensSnapshot {
  /** 发这条请求时的文档修订号（`semanticRevisionOf(state.doc)`）。哨兵值表示"内容还在，但必须重取"。 */
  seq: number
  lenses: CachedLens[]
  /** 已经为哪个修订号发过请求了（`:98-107` 的去重闸）。 */
  sentForSeq: number | null
  /** 在飞的那条请求是为哪个修订号发的（`:108-111` 的取消判据）。 */
  inFlightSeq: number | null
  /**
   * 这个文件**答过一次没有**（不管答的是几条还是一条都没有）。
   * 订正留痕（2026-10-06 codevision2）：这一格原来没有，`peek` 拿
   * `current.lenses.length === 0 && current.inFlightSeq === null` 当"首拍"，于是**一个从来不下发
   * lens 的文件每次触发都算首拍** ⇒ 每次都跳过 400ms 去抖、每个字都立刻整文档问一次服务器。
   * 上游的判据不是"内容为空"，是"这个文件还没有过快照、也没有在飞的那条"
   * （`LspHighlightingCache.kt:161-163` 的
   * `isFirstPullFor(file) = fileToCachedHighlightingsSnapshot[file] == null && fileToInFlightRequest[file] == null`，
   * 用在 `:143-149` 的 `if (quiescence > Duration.ZERO && !isFirstPullFor(file))` 那一跳），
   * 而一份 `LspPullResult.Full` 哪怕内容为空也会建快照（`:165-180` 的 `responseReceived`）⇒
   * 答过一次就不再是首拍。这里用同一个口径显式记一格布尔，`invalidate` 不改它（服务器主动重取
   * 不是"第一次"）。
   */
  answered: boolean
}

export interface LensCacheDecision {
  /** 这一拍该显示的内容（旧快照也算 —— 上游"先留着，等新数据"）。 */
  lenses: CachedLens[]
  /**
   * 该不该向服务器重取一次 —— 上游 `:68-71` 那一档：`highlightingsSnapshot?.docModStamp != docModStamp`
   * 才 `scheduleHighlightingsUpdate(file)`。消费点在 `src/codeLensExtension.ts` 的 `schedule`
   * （`change` 档：这一版已经答过就不再问第二次）。
   */
  shouldRequest: boolean
  /** 这个文件**第一次**要 lens（首拍不走去抖，`:50-51` + `:146` + `:161-163`）。 */
  firstPull: boolean
}

export interface LensCache {
  /** `getHighlightings`（`:66-83`）：给当前修订号，拿回"显示什么 + 要不要重取"。 */
  peek(path: string, seq: number): LensCacheDecision
  /** 真的发请求之前问一句：同一个修订号已经发过就别再发（`:98-107`）。 */
  beginRequest(path: string, seq: number): boolean
  /** 请求结束（成功或失败都要调）：把在飞标记清掉。 */
  endRequest(path: string, seq: number): void
  /**
   * 收答案 —— 两个判据，都在这一个方法里（`:170-180`；服务器答"没变"那一支同一口径，`:192-200`）：
   *   ① `seq`（**发请求时**的修订号）与 `currentSeq`（**回包这一拍**现读的修订号）不同 ⇒ 这份答案的
   *      行列是对旧文档算的，整份不收，调用方按上游 `:175` 立刻再排一次（`scheduleHighlightingsUpdate(file)`）；
   *      与本仓同一条闸门的另一处消费逐字同形：`src/editorInlayHints.ts:259`
   *      的 `acceptFull(path, revision, semanticRevisionOf(target.state.doc), items)`。
   *   ② 这一条请求已经不是本槽的那一条（`invalidate` 抹过两格、或被新请求取代）⇒ 同样不收
   *      （`:294-298`：强制刷新要作废在飞的那条）。
   * 返回 false 表示"这份答案不能落盘"。
   */
  accept(path: string, seq: number, currentSeq: number, lenses: readonly CachedLens[]): boolean
  /** 服务器主动要求重算 / 宿主换了文档：保留内容、把版本打成哨兵（`:292-303`）。 */
  invalidate(path: string): void
  /** 关文件、换语言服务：这一份整个丢掉（`:263-270` 的 `clearCache` 是它的整表版）。 */
  forget(path: string): void
  /** 全清。 */
  clear(): void
  /** 缓存里有多少个文件（测试与诊断用）。 */
  size(): number
}

/**
 * 建一份按文件分槽的 lens 快照缓存，并**自登记**进批量作废那一张表（`registerLspCache`：
 * 上游 `LspCodeLensCache` 本身就是 `LspCache`，注册进 `LspClientImpl.kt:106` 的那份
 * `highlightingCacheRegistry`，`LspHighlightingCacheRegistry.kt:46-48` 一次清整族。本仓的两个触发点
 * 是语言服务重启/换工程（`src/lsSessionHost.ts`）与服务器一句 `workspace/…/refresh`
 * （`src/lspServerMessages.ts` 的 `handleRefresh`））。
 */
export function createCodeLensCache(): LensCache {
  const snapshots = new Map<string, LensSnapshot>()
  function snapshot(path: string): LensSnapshot {
    let existing = snapshots.get(path)
    if (!existing) {
      existing = { seq: STALE_DOC_SEQ, lenses: [], sentForSeq: null, inFlightSeq: null, answered: false }
      snapshots.set(path, existing)
    }
    return existing
  }
  return {
    peek(path, seq) {
      const current = snapshots.get(path)
      // 首拍 = **这个文件从来没有过快照、也没有在飞的那条**（上游 `isFirstPullFor`，`:161-163`），
      // 这时不走去抖（`:146` 的 `if (quiescence > Duration.ZERO && !isFirstPullFor(file))`）。
      // 判据不是"内容为空"：一份空回答同样算答过（上游 `:234` 建快照不看条数），否则一个不下发
      // lens 的文件每次触发都会跳过 400ms 去抖、每个字都立刻整文档问一次服务器。
      // `invalidate` 只把 stamp 打成哨兵，不改 `answered` ⇒ 服务器主动重取那一拍仍然是去抖档。
      const firstPull = !current || (current.inFlightSeq === null && !current.answered)
      if (!current || current.seq !== seq) {
        return { lenses: current?.lenses ?? [], shouldRequest: true, firstPull }
      }
      return { lenses: current.lenses, shouldRequest: false, firstPull }
    },
    beginRequest(path, seq) {
      const current = snapshot(path)
      // 同一个 seq 已经发过一次 ⇒ 不再发（`:93-103`，注释 `:96-101` 点明这条去重闸存在的理由就是
      // "别的文件的变化会不停重启，而回包的收与不收由 stamp 决定"）；
      // 在飞的那条是别的 seq ⇒ 视作被取代（`:104-105` 的 `fileToInFlightRequest.put(...)?.cancel()`）。
      if (current.sentForSeq === seq) return false
      current.sentForSeq = seq
      current.inFlightSeq = seq
      return true
    },
    endRequest(path, seq) {
      const current = snapshots.get(path)
      if (!current) return
      // 只有"这条还归我"时才释放槽位（上游 `:236-238`：落快照时若 `fileToStampWhenRequestSent` 还是
      // 这一个 stamp 就摘掉，别的 stamp 留着不动）。
      if (current.inFlightSeq === seq) { current.inFlightSeq = null; if (current.sentForSeq === seq) current.sentForSeq = null }
    },
    accept(path, seq, currentSeq, lenses) {
      const current = snapshot(path)
      // ① 上游 `:173-176` 的接受闸门：回包这一拍文档已经不是发请求那一版 ⇒ 这份答案的**行列是对旧文档算的**，
      // 整份不收，调用方立刻再排一次。不收也要把这一条的两格放行（上游 `:123-131` 的 `finally`：
      // 「release the slot and the dedup guard, so the next `getHighlightings()` call can re-request」），
      // 否则下一拍按新号来问时会被这条已经死掉的请求占着。
      if (seq !== currentSeq) {
        if (current.inFlightSeq === seq) { current.inFlightSeq = null; if (current.sentForSeq === seq) current.sentForSeq = null }
        return false
      }
      // ② 这一条已经不是本槽的那一条（`invalidate` 抹过两格，或被更新的那条取代）⇒ 不收（`:294-298`）。
      if (current.sentForSeq !== seq && current.inFlightSeq !== seq) return false
      current.seq = seq
      current.lenses = [...lenses]
      // 答过一次 = 不再是首拍（不管答了几条）。
      current.answered = true
      if (current.sentForSeq === seq) current.sentForSeq = null
      if (current.inFlightSeq === seq) current.inFlightSeq = null
      return true
    },
    invalidate(path) {
      const current = snapshots.get(path)
      if (!current) return
      // 哨兵：`STALE_DOC_SEQ` 永远不等于任何真实的文档修订号（`semanticRevisionOf` 的发号从 1 起，
      // 只有传 `null` 才给 −1 —— 调用方交的一直是 `view.state.doc`，那个对象不可能不存在），
      // 所以下一次 `peek` 一定要重取；
      // 内容**保留** ⇒ 界面不闪（`:289-290` 原文 `Unlike clearCache, reactive consumers keep showing the
      // previous results (no flicker)`，落哨兵那一句在 `:301`；`sentForSeq` 一起抹掉就是 `:294-298` 的
      // 「取消在飞 + 抹掉去重闸，否则那条被强制的重取会被 dedup 掉」）。
      current.seq = STALE_DOC_SEQ
      current.sentForSeq = null
      current.inFlightSeq = null
    },
    forget(path) { snapshots.delete(path) },
    clear() { snapshots.clear() },
    size: () => snapshots.size,
  }
}