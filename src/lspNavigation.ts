// LSP 生命周期 + 文件内导航 + 符号搜索 —— 从 App.vue 搬出的一域（236 行，36 个依赖）。
//
// **范围说明（如实）**：这块比"LSP 生命周期"要宽 —— 因为启动/停止语言服务之后紧接着就是
// 「怎么跳到符号/位置」，两者共享同一批状态（`outline` / `symbolResults` / 位置环 `places` /
// 语言服务是否在跑）。它们是一个交互闭环，所以放在同一个模块里；`onSemantic`（语义动作）
// 另行处理，因为它依赖编辑器与重构链路。
import { computed, nextTick, ref, watch, type Ref } from 'vue'
import { notifyEditorContentChanged } from './bookmarkActions.ts'
import { clearLspDiagnostics, lspDiagnostics, request, setLspDiagnostics, type DocumentData, type EditorSettings, type LspDiagnostic, type LspDocumentSymbol,
         type LspSymbolsResult, type Workspace } from './bridge.ts'
import type { Tab } from './editorTab'
import { BreakpointLocationCache } from './breakpointLocations.ts'
import { errorMessage } from './errors.ts'
// 最近位置的两档（导航档 / 更改档）与它们的上限、合并规则都在 src/appPlacesRing.ts；
// 这里只把弹层要看的那一条列表按上游 `createPlaceLinePairs` 的口径取出来。
import { recentPlacesList } from './appPlacesRing.ts'
// 跳转落在哪个分栏（上游 `PlaceInfo.window` + `gotoPlaceInfo` 的 window 实参）。
import { jumpTargetPane, type PaneGroup } from './editorGroups.ts'
import { describeNavigationBoundary, navigateFrom, navigationPoints } from './navigateInFile.ts'
import { locationSnippet, previousChangePlace } from './recentLocations.ts'
// LSP 符号导航包装层（workspaceSymbol/documentSymbol 一族，见该模块头）：
// 文件内/工作区符号的过滤（含 SpeedSearch 匹配器）、去重、排序与导航目标都走同一份规则。
import { CLASS_LIKE_SYMBOL_KINDS, documentSymbolEntries, mergeWorkspaceSymbols, symbolNavigationTarget } from './lspSymbolBridge.ts'
// 「转到符号 / 转到类」的两条上游链路（本模块是它们的**生产消费方**）：
//   · workspaceSymbol 的客户端缓存 —— `platform/lsp-impl/src/impl/LspRequestExecutor.kt:156-163`
//     的 `getWorkspaceSymbolsCaching` + `impl/cache/LspSingleSlotCache.kt:20-52`，本仓那份在
//     `src/navWorkspaceSymbolCache.ts`。缓存吃**服务器原始应答**，合并/过滤都在缓存之后
//     （与 `LspWorkspaceSymbolContributor.kt:69` 先取缓存、后 `shouldAcceptSymbolKind` 的顺序一致）。
//   · 「按类型过滤」条 —— `lp/navigation` 判词里的 `ChooseByNameFilter`/`FilteringGotoByModel`
//     （`platform/lang-impl/src/com/intellij/ide/util/gotoByName/ChooseByNameFilter.java:74-117`、
//     `FilteringGotoByModel.java:44-52`），本仓那份在 `src/navChooseByNameFilter.ts`；
//     开关 UI 在 `src/menus/navigateMenu.ts` 的「按类型过滤」子菜单，排除态由那份模块持久化。
import { NavWorkspaceSymbolCache } from './navWorkspaceSymbolCache.ts'
import { filterSymbols, hiddenSymbolGroups } from './navChooseByNameFilter.ts'
// Ctrl+U（`GotoSuperAction`）与 Ctrl+Shift+T（`GotoTestOrCodeAction`）的规则层，
// 宿主装配就住在下面 `gotoSuper` / `gotoTest` 两处（本模块已经握着它们要的 request/outline/reveal）。
import { runGotoSuper } from './navGotoSuper.ts'
import { gotoTestActionLabel, gotoTestChooserTitle, gotoTestNotFoundMessage, gotoTestTargets, targetLineOfSymbol } from './navGotoTest.ts'
// Ctrl+Alt+Home「相关符号」的 provider 表（`GotoRelatedSymbolAction.kt:43-83` 的三档结果 +
// `GotoRelatedItem.java:23-43` 的分组条目），本仓的两个 provider 在 `src/navGotoRelated.ts`。
import { CHOOSE_TARGET_TITLE, NO_RELATED_SYMBOLS_MESSAGE, collectRelatedItems, groupRelatedItems, relatedOutcome } from './navGotoRelated.ts'
import { clearLocalInspections, refreshLocalInspections } from './junitInspections.ts'
import { startCompletionSession } from './lspCompletionStartup.ts'; import { LspWarmup } from './lspWarmup.ts'
import { LspPerFileCache } from './lspPerFileCache.ts'
// LSP 高亮区间缓存（上游 `LspHighlightingCache`/`applyPendingEdits` 一族，见该文件头）：
// 编辑后把诊断区间平移/裁剪，等服务端下一次推送覆盖 —— IDEA 的 daemon 缓存口径。
import {
  DIAGNOSTICS_QUIESCENCE_MS, HighlightingSnapshotCache, contentStamp, offsetOfPosition, positionOfOffset, textEditBetween,
  type LspCachedHighlighting,
} from './lspHighlightingCache.ts'

/** 工作区符号索引里的一条（LSP `workspace/symbol` 的扁平化结果）。 */
export interface SymbolEntry { name: string; kind: number; path: string; line: number; character: number; endLine?: number; endCharacter?: number }
/** Native preserves selectionRange.end separately from the enclosing outline range. */
type NavigationDocumentSymbol = LspDocumentSymbol & { selectionEndLine?: number; selectionEndCharacter?: number }

// IDEA's "Go to Class" (Ctrl+N) and "Go to Symbol" (Ctrl+Shift+Alt+N) are different
// filters over the same workspace-symbol index; the class filter is `LspGoToClassContributor`
// 的四类（Class/Enum/Interface/Struct = 5/10/11/23，见 src/lspSymbolBridge.ts）。
// App.vue 仍从这个模块导入它，保留同名导出以免动冻结文件。
export const CLASS_KINDS = CLASS_LIKE_SYMBOL_KINDS

/**
 * 最近位置的一格。`pane` = 这一格当时所在的**分栏对象**（上游 `PlaceInfo` 的 `window` 字段，
 * `platform/platform-impl/src/com/intellij/openapi/fileEditor/impl/IdeDocumentHistoryImpl.kt:689`
 * 存、`:694` 用弱引用存、`:712` 取；跳回去时作为 `openFile(window = …)` 的实参，见 `:572-579`）。
 * 没有它 = 记录时拿不到分栏（书签一类的调用方），跳转回落到「已开着的那一栏 / 当前栏」。
 */
export interface Place { kind: '文件' | '符号' | '书签'; path: string; line: number; label: string; edited?: boolean; pane?: PaneGroup<Tab> | null }

/** 导航栈（Back / Forward）里的一格：位置 + 当时所在的分栏。 */
export interface NavSpot { path: string; line: number; pane: PaneGroup<Tab> | null }

export interface LspNavigationDeps {
  notify: (message: string, error?: boolean) => void
  /** 桌面端才有原生文件对话框（符号搜索要用）。 */
  isDesktop: boolean
  /** 会话快照的延迟保存（打开/切换文件后要记一笔）。 */
  scheduleSessionSave: () => void
  /** 语言服务是否开着——这一个开关决定本模块所有动作能不能跑。 */
  editorSettings: Ref<EditorSettings>
  generalSettings: Ref<any>
  workspace: Ref<Workspace | null>
  /** 工作区代次（宿主是 `let` 计数器）。 */
  workspaceEpoch: () => number
  active: { readonly value: any }
  activePath: Ref<any>
  groups: any
  findTab: (path: string) => any
  hasTabPath: (path: string) => boolean
  editorFor: (path: string) => any
  refreshTree: () => unknown
  refreshMarkdownSoon: () => void
  /** Markdown 预览开关（宿主更早的阶段就要读它，所以留在宿主）。 */
  markdownPreviewOn: Ref<boolean>
  menu: Ref<any>
  palette: Ref<any>
  outline: Ref<any>
  dirty: Ref<boolean>
  /** 最近位置环（宿主是 `Place[]` 的 ref）。 */
  places: Ref<Place[]>
  /** 「转到行」与「最近文件」两个对话框的状态（由 explorerActions 模块提供，宿主解构后传进来）。 */
  goLinePrompt: Ref<any>
  goLineValue: Ref<any>
  goLineInput: Ref<any>
  recentPrompt: Ref<any>
  recentQuery: Ref<any>
  recentInput: Ref<any>
  /** 最近更改的位置（宿主是 `Place[]` 的 ref）。 */
  changePlaces: Ref<Place[]>
  rememberPlace: (entry: any) => void
  navBack: Ref<any>
  navForward: Ref<any>
  openFile: (...args: any[]) => any
  save: (...args: any[]) => any
  saveAll: () => any
  reveal: Ref<any>
  splitModel: any
  symbolPrompt: Ref<any>
  symbolQuery: Ref<string>
  symbolInput: any
  symbolResults: Ref<any>
  symbolIndex: Ref<number>
  /** 符号搜索的防抖计时器由本模块自持（`let`，值语义不能靠外部传参）。 */
  breakpointLocationCache: BreakpointLocationCache
  /**
   * 多目标选择弹层（`src/chooseTarget.ts` 那一份的宿主通道）。**可选**：宿主（`src/App.vue`，冻结文件）
   * 还没把它传进来时，Ctrl+U / Ctrl+Shift+T 在多条结果时退化为「跳第 1 条 + 报数量」，
   * 单条结果不受影响 —— 差异与请求见 `docs/wiring-requests-2026-10-06-bucket4b.md`。
   */
  chooseTargets?: (targets: readonly { path: string; line: number; character: number }[], title: string) => unknown
}

export function createLspNavigation(deps: LspNavigationDeps) {
  const { isDesktop, editorSettings, generalSettings, workspace, active, activePath, groups, findTab, hasTabPath,
          editorFor, refreshTree, refreshMarkdownSoon, markdownPreviewOn, menu, palette, outline, dirty, places, changePlaces,
          rememberPlace, navBack, navForward, openFile, save, saveAll, reveal, splitModel, symbolPrompt, symbolQuery,
          symbolInput, symbolResults, symbolIndex, breakpointLocationCache, scheduleSessionSave,
          goLineValue, goLinePrompt, goLineInput, recentPrompt, recentQuery, recentInput } = deps
  // 符号搜索输入防抖：`let` 是本模块的私有状态，不进 ctx（值语义传出去就写不回来）。
  let symbolTimer: number | undefined
  // —— workspaceSymbol 的**客户端缓存**（`src/navWorkspaceSymbolCache.ts`，上游 `LspSingleSlotCache`）——
  // 计数源 = 本仓的「文档改过 / 文件关过 / 磁盘被替换写过」代次，对应上游
  // `PsiManager.getModificationTracker().modificationCount`（`LspSingleSlotCache.kt:35` 每次命中都重读一遍，
  // 变了就必然不命中）。语言服务重启与换工程走 `clearCache()`（`LspSingleSlotCache.kt:48-52` 三格全清）。
  let symbolRevision = 0
  const workspaceSymbolsCache = new NavWorkspaceSymbolCache<SymbolEntry[]>(() => symbolRevision)
  const starts = new Map<string, symbol>()
  async function startLsp(tab: Tab) {
    // **必须往响应式代理上写**：`startCompletionSession` 会设置 `lspRunning`/`lspConfigured`，
    // 而 tab 对象常常是"push 进 `groups[pane].tabs` 之前的原始对象"（`openFile` 就是这么传的），
    // 往原始对象上写**不触发依赖** —— 读它的人（`lspReady` computed）值虽然对，却不会失效。
    // 真机实测（第七十八批）：打开文件后 `lspReady` 一直停在 false —— 导航菜单里的符号/声明项全灰、
    // Search Everywhere 的符号供给者一个请求都不发，切一次标签页才恢复。所以在入口处换回代理。
    const live = ([...groups[0].tabs, ...groups[1].tabs] as Tab[]).find(item => item.path === tab.path) ?? tab
    const epoch = deps.workspaceEpoch()
    const token = Symbol(live.path)
    starts.set(live.path, token)
    setLspDiagnostics(live.path, [])
    // 本地检查（JUnit 规则，见 src/junitInspections.ts）：打开文件就算一次；此后每次编辑由
    // `onEditorChange` 重算 —— 与 IDEA daemon 对打开文件做 on-the-fly 分析同一口径。
    refreshLocalInspections(live.path, live.content)
    // 高亮区间缓存的文本基线：第一次编辑才有「上一版」可对齐。
    lastEditedText.set(live.path, live.content)
    const current = () => deps.workspaceEpoch() === epoch && starts.get(live.path) === token && hasTabPath(live.path)
    // Not awaited: a Java file must open (and be editable) while JDT LS is still
    // importing the project. The tab flips `lspRunning` once initialization lands,
    // which re-enables code insight through the editor's own `lsp-enabled` prop.
    void startCompletionSession(live, { request, notify: deps.notify, current })
      .then(() => { if (current() && live.path === activePath.value) void refreshOutline(live.path) })
  }
  function lspOn(tab: Tab) {
    // IDEA PowerSaveMode: code insight is switched off entirely while it is on.
    if (editorSettings.value.powerSaveMode) return false
    return isDesktop && tab.lspRunning === true && tab.content.length <= 5 * 1024 * 1024
  }
  // IDEA's "save files if the application is idle": GeneralSettings.isAutoSaveIfInactive
  // (GeneralSettings.kt:81-91 -> state.autoSaveIfInactive), with the delay from
  // SAVE_FILES_AFTER_IDLE_SEC (:163 = 15, range 1..300, read as `inactiveTimeout.seconds` at
  // :193-202). SaveAndSyncHandlerImpl.kt:332-350 pushes idle events through
  // `debounce(inactiveTimeout.seconds)` and then saves every document; the timer below is
  // restarted by every edit (onEditorChange), which is the same "idle" signal.
  // Only buffers that actually changed are written, and a failed save still surfaces through
  // save()'s own error.
  //
  // The editor page used to carry its own `autoSave` switch with a hard-coded 5s: a second name
  // for this one option, so it is gone and this key now has its consumer.
  const autoSaveDelay = computed(() => Math.min(300, Math.max(1, generalSettings.value.inactiveTimeout)) * 1000)
  let autoSaveTimer: number | undefined
  function clearAutoSave() { if (autoSaveTimer) { window.clearTimeout(autoSaveTimer); autoSaveTimer = undefined } }
  function scheduleAutoSave() {
    clearAutoSave()
    if (!generalSettings.value.autoSaveIfInactive || !isDesktop || !dirty.value) return
    autoSaveTimer = window.setTimeout(() => {
      autoSaveTimer = undefined
      if (generalSettings.value.autoSaveIfInactive && dirty.value) void saveAll()
    }, autoSaveDelay.value)
  }
  // SaveAndSyncHandlerImpl.kt:300-319 — on frame deactivation IDEA saves every document when
  // GeneralSettings.isSaveOnFrameDeactivation (:73-78 -> state.autoSaveFiles) is on. The
  // window's `blur` is the same signal as ApplicationActivationListener.applicationDeactivated.
  function onWindowBlur() {
    if (!isDesktop || !generalSettings.value.autoSaveFiles || !dirty.value) return
    void saveAll()
  }
  // —— LSP 高亮区间缓存（上游 `LspHighlightingCache` 一族，模块见 src/lspHighlightingCache.ts）——
  // 诊断表存的是行列；用户编辑后行号会漂。这里在每次编辑时把上一版区间按 pending edit
  // 平移/裁剪（部分相交的整条删除），再换算回行列写回 `lspDiagnostics`，等服务端下一次推送
  // 覆盖 —— 上游 `LspPublishDiagnosticsCache` + `applyPendingEdits` 的口径。与上游的差异：
  // 本仓 push 事件不带版本号，没有上游的版本闸门；调整是近似的，下一次推送即修正。
  const diagnosticRanges = new HighlightingSnapshotCache<LspDiagnostic>({ quiescenceDelayMs: DIAGNOSTICS_QUIESCENCE_MS })
  const lastEditedText = new Map<string, string>()
  const rangesOfDiagnostics = (items: readonly LspDiagnostic[], text: string): LspCachedHighlighting<LspDiagnostic>[] =>
    items.map(item => ({
      textRange: {
        start: offsetOfPosition(text, item.line, item.character),
        end: offsetOfPosition(text, item.endLine ?? item.line, item.endCharacter ?? item.character),
      },
      highlightingInfo: item,
    }))
  const diagnosticsOfRanges = (ranges: readonly LspCachedHighlighting<LspDiagnostic>[], text: string): LspDiagnostic[] =>
    ranges.map(({ textRange, highlightingInfo }) => {
      const start = positionOfOffset(text, textRange.start)
      const end = positionOfOffset(text, textRange.end)
      return { ...highlightingInfo, line: start.line, character: start.character, endLine: end.line, endCharacter: end.character }
    })
  function adjustDiagnosticsAfterEdit(path: string, text: string): void {
    const previous = lastEditedText.get(path)
    lastEditedText.set(path, text)
    if (previous === undefined || previous === text) return
    const items = lspDiagnostics.get(path)
    if (!items?.length) return
    const previousStamp = contentStamp(previous)
    // 上一版之后服务端可能已推送新位置；快照签名对不上就以表里的当前内容重新起一份。
    if (diagnosticRanges.snapshotStamp(path) !== previousStamp)
      diagnosticRanges.acceptFull(path, previousStamp, previousStamp, rangesOfDiagnostics(items, previous))
    diagnosticRanges.fileEdited(path, textEditBetween(previous, text))
    const adjusted = diagnosticRanges.highlightingsFor(path)
    // 调整后的快照重锚到新文本：下一次编辑的内联调整才对得上（上游靠文档 stamp 做这件事）。
    const nextStamp = contentStamp(text)
    diagnosticRanges.acceptFull(path, nextStamp, nextStamp, adjusted)
    setLspDiagnostics(path, diagnosticsOfRanges(adjusted, text))
  }
  function onEditorChange(tab: Tab) {
    tab.dirty = true
    tab.preview = false
    // 书签按"同一行号 + 同一行原文"对账（上游 BookmarkManager.documentChanged；丢/放回都在那一步）。
    notifyEditorContentChanged(tab.path, editorFor(tab.path)?.text() ?? tab.content)
    // 本地检查（JUnit 规则）随编辑实时重算：问题面板与 LSP 诊断读同一张汇总表。
    const edited = editorFor(tab.path)?.text() ?? tab.content
    refreshLocalInspections(tab.path, edited)
    adjustDiagnosticsAfterEdit(tab.path, edited)
    // 行号 → 可放置位置的映射依赖代码内容：改过就整体作废（见 breakpointLocations.ts 的类注释）。
    breakpointLocationCache.clear()
    // 同理 workspaceSymbol 的槽：内容一变，服务器那份符号表就可能过时（上游 PSI 计数在这一刻 +1）。
    symbolRevision += 1
    // IdeDocumentHistory.placeChanged(EditorEvent.DocumentChange): every user edit
    // pushes the caret line onto the "changed places" ring.
    // 上游这一条**只进更改档**（`onCommandFinished` 的 `currentCommandHasChanges` 分支，
    // `IdeDocumentHistoryImpl.kt:289-291`），本仓同口径（见 src/appPlacesRing.ts 的头注释）。
    const editPane = paneShowing(tab.path)
    rememberPlace({ kind: '文件', path: tab.path, line: Math.max(0, (editorFor(tab.path)?.getCursor().line ?? tab.line - 1)), label: tab.path, edited: true, pane: editPane })
    // 记一笔改动 = 上游 `setCurrentChangePlace` 的收尾 `currentIndex = changePlaces.size`
    // （`IdeDocumentHistoryImpl.kt:340`）⇒ 游标回到「最新那一条之后」，下一次 Ctrl+Shift+Backspace 从最新往旧走。
    changeCursor = -1
    if (markdownPreviewOn.value && tab.path === activePath.value) refreshMarkdownSoon()
    scheduleAutoSave()
    scheduleSessionSave()  // drafts change on every keystroke, not just on dirty-flip
  }
  // IDEA's "Last Edit Location" is project-wide (JumpToLastEditAction.java:15-19 读
  // `IdeDocumentHistory.navigatePreviousChange()`，菜单可用判据同文件 `:29`), so Ctrl+Shift+Backspace
  // follows edits across files; the per-editor handler only covers jumps inside one buffer.
  // 更改档的游标（上游 `currentIndex`）住在「最新在前」的镜像一侧：-1 = 还没按过。见 `previousChangePlace`。
  let changeCursor = -1
  function jumpLastEditLocation() {
    const current = active.value
    const here = current ? { path: current.path, line: Math.max(0, (editorFor(current.path)?.getCursor().line ?? current.line - 1)) } : null
    const target = previousChangePlace(changePlaces.value as any[], changeCursor, here)
    if (!target) { deps.notify('没有上次编辑位置。', true); return }
    // 游标挪过去（上游 `:493`）—— 这一句是本仓原来缺的那半件：没有它，连续按只会在最新的两格里来回弹。
    changeCursor = target.index
    void revealLocation(target.place)
  }
  function stopLspFile(path: string) {
    if (outlineWarmupPath === path) outlineWarmup.cancel()
    starts.delete(path)
    outlineCache.clearCache()   // 文件级生命周期操作：缓存跟着会话状态作废（上游 LspCache.clearCache）
    // 符号表也按「文件增删 = PSI 计数变」作废（`LspSingleSlotCache.kt:35` 的命中条件之一）。
    symbolRevision += 1
    lastEditedText.delete(path)
    clearLspDiagnostics(path)
    clearLocalInspections(path)
    if (isDesktop) void request('lsp.close', { path }).catch(() => undefined)
  }
  // UI-side reset only. The host already rebuilds the language session inside
  // workspace.open (open_project → reset_lsp) and stops it inside workspace.close;
  // sending lsp.stop here ran *after* workspace.open and destroyed the session the
  // host had just created, so every Java file reported "no language server".
  function resetLsp(stopHost = false) {
    outlineWarmup.cancel()
    outlineCache.clearCache()
    // 语言服务重启 = 上游 `LspSingleSlotCache.clearCache()`（`LspSingleSlotCache.kt:48-52` 三格全清）的触发点。
    workspaceSymbolsCache.clearCache()
    starts.clear()
    lastEditedText.clear()
    diagnosticRanges.clearCache()
    for (const path of [...lspDiagnostics.keys()]) clearLspDiagnostics(path)
    if (stopHost && isDesktop) void request('lsp.stop').catch(() => undefined)
  }
  /** 某个文件现在落在哪个分栏（没开着 = null）。上游没有这一层：VFS 一侧直接拿 FileEditor[]。 */
  function paneShowing(path: string): PaneGroup<Tab> | null {
    if (!path) return null
    const index = groups.findIndex((group: any) => group.tabs.some((tab: any) => tab.path === path))
    return index === 0 || index === 1 ? groups[index] as PaneGroup<Tab> : null
  }
  // 导航栈的上限 = 注册表 `editor.navigation.history.stack.size` 的默认值 150
  // （`platform/util/resources/misc/registry.properties:494`，读它的是
  // `IdeDocumentHistoryImpl.kt:76-77` 那两条常量）。
  // 正向栈上游没有上限（`back()` 只 `forwardPlaces.add(current)`，`IdeDocumentHistoryImpl.kt:427-430`），
  // 所以这里也只截 Back 栈。
  const NAV_BACK_LIMIT = 150
  /** 当前落点 = 当前分栏里当前编辑器的位置（上游 `getCurrentPlaceInfo()`）。 */
  function currentNavSpot(): NavSpot {
    return {
      path: activePath.value,
      line: Math.max(0, (active.value?.line ?? 1) - 1),
      pane: groups[splitModel.focused] as PaneGroup<Tab> | null,
    }
  }
  async function revealLocation(target: { path: string; line: number; column?: number; kind?: Place['kind']; label?: string; pane?: PaneGroup<Tab> | null }, record = true) {
    const epoch = deps.workspaceEpoch()
    if (record && activePath.value && (activePath.value !== target.path || (active.value?.line ?? 1) - 1 !== target.line)) {
      navBack.value.push(currentNavSpot())
      if (navBack.value.length > NAV_BACK_LIMIT) navBack.value.shift()
      navForward.value = []
    }
    if (!hasTabPath(target.path)) {
      await openFile(target.path)
      if (epoch !== deps.workspaceEpoch()) return
      if (!hasTabPath(target.path)) { deps.notify(`无法打开定义位置 ${target.path}`, true); return }
      // openFile records the fresh file at line 0; a jump owns the real destination.
      places.value = places.value.filter((item: any) => item.path !== target.path)
    }
    // IDEA jumps in whichever pane already shows the file；**没开着的那一栏 = 这一格记住的那一栏**
    // （上游 `gotoPlaceInfo` 把 `PlaceInfo.getWindow()` 直接交给 `openFile(window = …)`，
    // `IdeDocumentHistoryImpl.kt:572-579`；窗口没了就退回当前窗口）。规则本体在
    // `src/editorGroups.ts` 的 `jumpTargetPane`。
    const pane = jumpTargetPane(splitModel, (tab: Tab) => tab.path, target.path, target.pane ?? null)
    splitModel.focused = pane
    groups[pane].activePath = target.path
    await nextTick()
    if (epoch !== deps.workspaceEpoch()) return
    reveal.value = { path: target.path, line: target.line, ...(target.column ? { column: target.column } : {}) }
    rememberPlace({ kind: target.kind ?? '文件', path: target.path, line: target.line, label: target.label ?? target.path, pane: groups[pane] })
  }
  async function goBack() {
    const from = navBack.value.pop()
    if (!from) return
    navForward.value.push(currentNavSpot())
    await revealLocation(from, false)
  }
  async function goForward() {
    // `getTargetForwardInfo()`（`IdeDocumentHistoryImpl.kt:454-473`）：栈顶那一条**就是当前位置**时
    // 跳过它继续往下找（连续同位置不入导航档，见 `isSame` / `putLastOrMerge` `:655-674`），
    // 否则 Forward 看起来"没反应"—— 跳的是自己。栈空了就停，不 pop 到 undefined。
    const here = currentNavSpot()
    let to = navForward.value.pop()
    while (to && navForward.value.length && to.path === here.path && to.line === here.line) to = navForward.value.pop()
    if (!to) return
    navBack.value.push(here)
    if (navBack.value.length > NAV_BACK_LIMIT) navBack.value.shift()
    await revealLocation(to, false)
  }
  // Menu and keyboard reach the two prompts through the same opener, which owns the
  // focus/selection step the prompt needs.
  function openGoLine() { goLineValue.value = ''; goLinePrompt.value = true; void nextTick(() => goLineInput.value?.select()) }
  function openRecentFiles() { recentQuery.value = ''; recentPrompt.value = true; void nextTick(() => recentInput.value?.focus()) }
  const placesPrompt = ref(false)
  const placesQuery = ref('')
  const placesInput = ref<HTMLInputElement>()
  // RecentLocationsAction: the checkbox toggles navigation places vs change places, and
  // the popup title follows it ("Recent Locations" / "Recently Edited Locations").
  const placesEditedOnly = ref(false)
  // 取出的那一档 = 上游 `createPlaceLinePairs`（`RecentLocationsDataModel.kt:83-104`）：
  // 沿环走一遍、**全局**跳过与已列出条目同位置的那些、攒够 `recentLocationsLimit`（默认 25）就停。
  // 上限作用在过滤**之前**（上游 `ListWithFilter.wrap` 套在已经建好的模型外面，
  // `RecentLocationsAction.java:146`），所以查询词只能在那 25 条里挑。
  const placesList = computed(() => recentPlacesList(placesEditedOnly.value ? changePlaces.value : places.value))
  // RecentLocationsRenderer shows the caret line's snippet; buffers are live in memory.
  function placeSnippet(place: Place): { text: string; firstLine: number } {
    const tab = findTab(place.path)
    if (!tab) return { text: '', firstLine: 0 }
    const lines = (editorFor(place.path)?.text() ?? tab.content).split(/\r?\n/)
    return locationSnippet(lines, Math.min(place.line, Math.max(0, lines.length - 1)))
  }
  const placesFiltered = computed(() => {
    const query = placesQuery.value.trim().toLowerCase()
    return query ? placesList.value.filter(place => place.label.toLowerCase().includes(query) || place.path.toLowerCase().includes(query)) : placesList.value
  })
  // ScrollingUtil.installActions + ENTER: the list keeps a highlighted row, Enter jumps.
  const placesIndex = ref(0)
  function movePlace(step: number) {
    const size = Math.max(1, placesFiltered.value.length)
    placesIndex.value = (placesIndex.value + step + size) % size
  }
  watch(placesQuery, () => { placesIndex.value = 0 })
  watch(placesEditedOnly, () => { placesIndex.value = 0 })
  function openRecentPlaces() {
    placesQuery.value = ''
    menu.value = null
    palette.value = false; symbolPrompt.value = null; recentPrompt.value = false
    placesPrompt.value = true
    void nextTick(() => placesInput.value?.focus())
  }
  function openPlace(place: Place) { placesPrompt.value = false; void revealLocation(place) }
  // 「按类型过滤」条（`ChooseByNameFilter`/`FilteringGotoByModel.acceptItem:44-52`）：
  // 被排除的类别不进列表。规则、排除态与持久化在 `src/navChooseByNameFilter.ts`，
  // 开关在 `src/menus/navigateMenu.ts` 的「按类型过滤」子菜单（菜单与这里读同一份 `hiddenSymbolGroups`）。
  function fileSymbolEntries(query: string): SymbolEntry[] {
    const path = activePath.value
    if (!path) return []
    // 过滤用结构弹层的 SpeedSearch 档（驼峰缩写/子序列，见 src/symbolSearch.ts），
    // 但**不重排**：上游 SpeedSearch 只在树里过滤，行序仍是结构视图顺序。
    // 转换与跳转位置取法在 src/lspSymbolBridge.ts 的 documentSymbolEntries（selectionRange 优先）。
    return filterSymbols(documentSymbolEntries(outline.value as NavigationDocumentSymbol[], path, query), hiddenSymbolGroups.value)
  }
  // 缓存里存的是**服务器原始应答**，合并/去重/排序与类别过滤都在缓存之后 ——
  // 上游 `LspWorkspaceSymbolContributor.kt:69` 也正是先 `getWorkspaceSymbolsCaching(query)`
  // 再逐条 `shouldAcceptSymbolKind(symbolKind)`。
  function visibleSymbols(symbols: readonly SymbolEntry[], query: string): SymbolEntry[] {
    return mergeWorkspaceSymbols([filterSymbols(symbols, hiddenSymbolGroups.value)], {
      query, mode: symbolPrompt.value?.mode === 'class' ? 'class' : 'symbol',
    })
  }
  async function globalSymbolEntries(query: string) {
    const q = query.trim()
    if (!isDesktop || !workspace.value || q.length < 2) { symbolResults.value = []; return }
    const epoch = deps.workspaceEpoch()
    // 探测：`getOrCompute(q, () => null)` 命中槽就给值，未命中时 compute 返回 null ——
    // `LspSingleSlotCache.kt:41`「结果为 null 不入槽」保证这次探测**不会**把空结果写进槽里。
    const cached = workspaceSymbolsCache.getOrCompute(q, () => null)
    if (cached) { symbolResults.value = visibleSymbols(cached, q); return }
    try {
      const result = await request<{ available: boolean; symbols?: SymbolEntry[] }>('lsp.request', { kind: 'workspaceSymbol', path: activePath.value ?? '', query: q })
      // 回答期间用户又敲了字 / 换了工程：这一份已经过时，既不呈现也不入槽（下次按新查询重算）。
      if (epoch !== deps.workspaceEpoch() || symbolQuery.value.trim() !== q) return
      // `available: false` = 服务器**没答上来**（不支持这个请求），同上游的 null：不入槽，下次仍会重算。
      if (!result.available) { symbolResults.value = []; return }
      const symbols = result.symbols ?? []
      // 「答了空表」与「没答」是两回事（`:41` 的那条区分）：空表照样入槽，同一次查询不再重发。
      const stored = workspaceSymbolsCache.getOrCompute(q, () => symbols)
      symbolResults.value = visibleSymbols(stored ?? symbols, q)
    } catch { symbolResults.value = [] }
  }
  function openSymbol(mode: 'file' | 'global' | 'class') {
    menu.value = null
    if (!active.value) return
    symbolPrompt.value = { mode }
    symbolQuery.value = ''
    symbolResults.value = mode === 'file' ? fileSymbolEntries('') : []
    // 'class' needs two characters typed (the same threshold as the LSP query), so the
    // list starts empty and fills as the user types.
    symbolIndex.value = 0
    void nextTick(() => symbolInput.value?.focus())
  }
  function onSymbolQuery() {
    symbolIndex.value = 0
    if (symbolPrompt.value?.mode === 'file') { symbolResults.value = fileSymbolEntries(symbolQuery.value); return }
    if (symbolTimer !== undefined) clearTimeout(symbolTimer)
    symbolTimer = window.setTimeout(() => void globalSymbolEntries(symbolQuery.value), 250)
  }
  function moveSymbol(delta: number) {
    const count = symbolResults.value.length
    if (!count) return
    symbolIndex.value = (symbolIndex.value + delta + count) % count
  }
  async function jumpSymbol(entry: SymbolEntry) {
    symbolPrompt.value = null
    const target = symbolNavigationTarget(entry)
    if (!target) { deps.notify('这条符号没有可跳转的位置。', true); return }
    await revealLocation(target)
  }
  async function onSearchOpen(payload: { path: string; line: number }) {
    await revealLocation({ path: payload.path, line: Math.max(0, payload.line - 1) })
  }
  // A replace rewrites files behind the editors' backs: reload every open buffer whose
  // path was touched, then refresh the tree so the UI never shows stale content.
  async function onSearchReplaced(payload: { paths: string[] }) {
    for (const path of payload.paths) {
      const tab = findTab(path)
      if (!tab || tab.dirty) continue   // never clobber unsaved edits
      try {
        const doc = await request<DocumentData>('file.read', { path })
        tab.content = doc.content
        tab.version = doc.version
        tab.readOnly = doc.readOnly
        // The editor holds its own buffer, so the new text has to be pushed into it.
        editorFor(path)?.setDraft(doc.content)
      } catch { /* the file may have been moved mid-replace */ }
    }
    // 替换改写的是磁盘：符号索引里的行号全可能漂了（上游 PSI 计数在这一刻变），槽作废。
    symbolRevision += 1
    await refreshTree()
  }
  // GoToMenu › NavigateInFileGroup 的 MethodDown / MethodUp（`PlatformActions.xml:621-623`）。
  // MethodUpDownUtil.java:61-73 收集全部结构元素；上游没有默认快捷键。
  async function jumpMethod(direction: 1 | -1) {
    const tab = active.value
    if (!tab || !lspOn(tab)) { deps.notify('该文件未启用语言服务。', true); return }
    await refreshOutline(tab.path)
    // **不按 kind 过滤**：IDEA 的 `MethodUpDownUtil.addStructureViewElements`（:61-73）递归收集结构视图的
    // 全部元素（类、字段、嵌套结构都算），名字叫 Method 是历史叫法。规则见 src/navigateInFile.ts。
    const points = navigationPoints(outline.value)
    if (!points.length) { deps.notify('该文件没有可跳转的结构元素。'); return }
    const current = Math.max(0, editorFor(tab.path)?.getCursor().line ?? 0)
    // 与 IDEA 一致：跳到光标**之后/之前**的最近一个导航点，已经到头就提示而不是绕回
    // （IDEA 的 handler 直接 return null）。
    const target = navigateFrom(points, current, direction)
    if (!target) { deps.notify(describeNavigationBoundary(direction)); return }
    void revealLocation({ path: tab.path, line: target.line, column: 1 })
  }
  // 结构视图的刷新带**导入期重试**：真机取证（AE2）显示 JDT 在大工程上要 ~9.5 分钟才给符号，
  // 这期间 `documentSymbol` 一律 60 秒超时 —— 旧实现只问一次、失败就清空，于是导入完成后
  // 面板一直空着（要点一次活动条才会重来）。规则与退避档见 src/lspWarmup.ts。
  // 结构视图（`textDocument/documentSymbol`）的按文件缓存：内容没变就复用上一次的符号 ——
  // 上游 `LspPerFileCache`（platform/lsp-impl/src/impl/cache）的单槽语义，`invalidateOnlyOnDocumentChange`
  // 那一档正是为 documentSymbol 这类「只依赖本文件」的请求设的。切标签页/重开结构面板不再每次都问
  // 语言服务；内容一变（stamp 变）或语言服务重启（clearCache）就重查。
  const OUTLINE_REQUEST = 'documentSymbol'
  const outlineCache = new LspPerFileCache<string, LspDocumentSymbol[]>(path => outlineDocumentStamp(path))
  // 内容签名（长度 + FNV-1a）：字符串身份不变时直接复用上次的哈希，避免每次刷新都全量扫一遍。
  const outlineStampMemo: { path: string; content: string; stamp: string } = { path: '', content: '', stamp: '' }
  function hashOutlineContent(text: string): string {
    let hash = 2166136261
    for (let index = 0; index < text.length; ++index) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619) }
    return (hash >>> 0).toString(36)
  }
  function outlineDocumentStamp(path: string): string {
    const tab = findTab(path)
    if (!tab) return 'missing'
    if (outlineStampMemo.path === path && outlineStampMemo.content === tab.content) return outlineStampMemo.stamp
    outlineStampMemo.path = path
    outlineStampMemo.content = tab.content
    outlineStampMemo.stamp = `${tab.version ?? 0}:${tab.content.length}:${hashOutlineContent(tab.content)}`
    return outlineStampMemo.stamp
  }
  let outlineWarmupPath = ''
  const outlineWarmup = new LspWarmup({
    run: async () => {
      const path = outlineWarmupPath
      const tab = path ? findTab(path) : undefined
      if (!path || !tab || !lspOn(tab)) return true      // 文件关了/语言服务关了：当作"结束"，别再重试
      try {
        const result = await request<{ available: boolean; symbols?: LspDocumentSymbol[] }>('lsp.request', { kind: 'documentSymbol', path })
        if (!result.available) return true               // 服务器说"不支持"不是"还没准备好"，重试没意义
        const symbols = result.symbols ?? []
        outline.value = symbols
        // 空符号 = 导入还没完，不入缓存（下次重算）；有符号才落进单槽（上游 null 不入槽同口径）。
        if (symbols.length > 0) outlineCache.set(path, OUTLINE_REQUEST, symbols)
        return symbols.length > 0
      } catch {
        return false
      }
    },
  })
  async function refreshOutline(path: string) {
    const tab = findTab(path)
    if (!tab || !lspOn(tab)) { outline.value = []; return }
    // 内容签名未变：直接复用上一次的符号（切标签页/重开面板不重发 documentSymbol）。
    const cached = outlineCache.get(path, OUTLINE_REQUEST)
    if (cached) { outline.value = cached; return }
    outlineWarmupPath = path
    outlineWarmup.start()
  }
  // —— Ctrl+U / Ctrl+Shift+T 的宿主装配（规则层在 `src/navGotoSuper.ts` 与 `src/navGotoTest.ts`）——
  // 多目标的落点：宿主给了选择弹层就用它（上游 `PsiTargetNavigator`，
  // `java/java-impl/src/com/intellij/codeInsight/navigation/JavaGotoSuperHandler.java:41-53` 同一族）。
  // `src/App.vue` 是冻结文件、还没把 `src/chooseTarget.ts` 那个弹层传进来 ⇒ 这里退化成
  // 「跳第 1 条 + 把数量说清楚」，差异与请求见 `docs/wiring-requests-2026-10-06-bucket4b.md`。
  function openTargetChooser(targets: readonly { path: string; line: number; character: number }[], title: string) {
    if (deps.chooseTargets) { void deps.chooseTargets(targets, title); return }
    const first = targets[0]
    if (!first) return
    deps.notify(`${title}：找到 ${targets.length} 个，已跳到第 1 个。`)
    void revealLocation({ path: first.path, line: first.line, column: first.character + 1, kind: '符号', label: title })
  }
  // Ctrl+U：`GotoSuperAction`（键位 `$default.xml:251-253`，动作 id 是 `GotoSuperMethod`）。
  function gotoSuper() {
    const path = activePath.value ?? ''
    const cursor = path ? editorFor(path)?.getCursor() : undefined
    return runGotoSuper({
      request: <T>(method: 'lsp.request', params: Record<string, unknown>) => request<T>(method, params),
      path: () => path,
      line: () => Math.max(0, cursor?.line ?? (active.value?.line ?? 1) - 1),
      character: () => Math.max(0, (cursor?.character ?? (active.value?.column ?? 1)) - 1),
      outline: () => outline.value as LspDocumentSymbol[],
      reveal: target => void revealLocation({ path: target.path, line: target.line, column: target.column, kind: '符号' }),
      openChooser: openTargetChooser,
      notify: deps.notify,
    })
  }
  // 落点：能取到目标文件的 `documentSymbol` 就对准**最外层类声明行**（上游
  // `EditSourceUtil.navigateToPsiElement` 跳的是类本身），取不到就退回文件首行
  // （差异见 `src/navGotoTest.ts` 文件头）。
  async function revealFileAtTypeLine(path: string, label: string) {
    let line = 0
    try {
      const replied = await request<{ available: boolean; symbols?: LspDocumentSymbol[] }>('lsp.request', { kind: 'documentSymbol', path })
      line = targetLineOfSymbol(replied.available ? replied.symbols : null)
    } catch { /* 目标文件没有语言服务：落在文件首行 */ }
    await revealLocation({ path, line, kind: '符号', label })
  }
  // Ctrl+Shift+T：`GotoTestOrCodeAction`（键位 `$default.xml:254-256`）。候选名/权重/测试判定都在
  // `src/navGotoTest.ts`，这里比对的数据源是 `workspace.entries`（本仓没有 PSI 索引，见那个文件的头）。
  async function gotoTest() {
    const path = activePath.value ?? ''
    if (!path || !workspace.value) { deps.notify('没有打开的文件。', true); return 0 }
    const entries = (workspace.value.entries ?? []) as readonly { path: string; kind: 'file' | 'directory' }[]
    const { direction, targets } = gotoTestTargets(entries, path)
    if (!targets.length) { deps.notify(gotoTestNotFoundMessage(direction), true); return 0 }
    const leaf = path.split(/[\\/]/).pop() ?? path
    if (targets.length > 1) {
      openTargetChooser(targets.map(target => ({ path: target.path, line: 0, character: 0 })),
                        gotoTestChooserTitle(direction, leaf, targets.length))
      return targets.length
    }
    const only = targets[0]!
    await revealFileAtTypeLine(only.path, `${gotoTestActionLabel(direction)}：${only.name}`)
    return targets.length
  }
  // Ctrl+Alt+Home「相关符号」（`GotoRelatedSymbolAction.kt:43-83`）：三档结果 ——
  // 空 → 气泡（`:69` + `platform/lang-api/resources/messages/LangBundle.properties:138`）、
  // 恰好一条 → 直接导航、**不出现弹层**（`:77-79`）、多条 → 弹层，标题
  // `LangBundle.properties:350`（"Choose Target"）。provider 表与分组标题在 `src/navGotoRelated.ts`。
  async function gotoRelated() {
    const path = activePath.value ?? ''
    if (!path || !workspace.value) { deps.notify(NO_RELATED_SYMBOLS_MESSAGE, true); return 0 }
    const entries = (workspace.value.entries ?? []) as readonly { path: string; kind: 'file' | 'directory' }[]
    // 按 provider 的分组顺序摊平（上游 `GotoRelatedItem.getGroup()` 的弹层分段）；
    // 本仓的选择弹层（`src/chooseTarget.ts`）没有分段标题这一槽位 ⇒ 分组信息进每行的标签。
    const ordered = groupRelatedItems(collectRelatedItems(entries, path)).flatMap(group =>
      group.items.map(item => ({ ...item, label: item.group ? `${item.group} · ${item.name}` : item.name })))
    const outcome = relatedOutcome(ordered)
    if (outcome === 'none') { deps.notify(NO_RELATED_SYMBOLS_MESSAGE, true); return 0 }
    const only = ordered[0]!
    if (outcome === 'navigate') { await revealFileAtTypeLine(only.path, only.label); return 1 }
    openTargetChooser(ordered.map(item => ({ path: item.path, line: 0, character: 0 })), CHOOSE_TARGET_TITLE)
    return ordered.length
  }
  // 换文件只刷新结构视图。**不**清引用结果：IDEA 的 Find 窗口里那些内容是 `ContentManager`
  // 持有的条目，只有"再搜一次把它顶替掉"或"关掉那条"才会消失
  // （`platform/lang-impl/src/com/intellij/usageView/impl/UsageViewContentManagerImpl.java:149-192`），
  // 换编辑器标签页与它无关。
  watch(activePath, path => { void refreshOutline(path) })
  // 换工程：槽里装的是上一个工作区的符号表，整槽作废 + 计数进位
  // （上游 `LspSingleSlotCache.kt:48-52` 的 `clearCache()`，本仓的触发点是语言服务重启与换工程）。
  watch(() => deps.workspaceEpoch(), () => { workspaceSymbolsCache.clearCache(); symbolRevision += 1 })
  // 过滤条一改（菜单里勾掉/勾上某一类）立刻重算当前列表 —— 上游 `ChooseByNameFilter` 的
  // 复选清单变更就是当场重刷弹层（`ChooseByNameFilter.java:101-117` 的三个按钮走的同一条重建）。
  watch(hiddenSymbolGroups, () => {
    if (symbolPrompt.value?.mode === 'file') symbolResults.value = fileSymbolEntries(symbolQuery.value)
    else if (symbolPrompt.value) void globalSymbolEntries(symbolQuery.value)
  })
  return {
    startLsp, lspOn, autoSaveDelay, clearAutoSave, scheduleAutoSave, onWindowBlur, onEditorChange,
    jumpLastEditLocation, stopLspFile, resetLsp, revealLocation, goBack, goForward, openGoLine,
    openRecentFiles, placesPrompt, placesQuery, placesInput, placesEditedOnly, placesList, placeSnippet,
    placesFiltered, placesIndex, movePlace, openRecentPlaces, openPlace,
    fileSymbolEntries, globalSymbolEntries, openSymbol, onSymbolQuery, moveSymbol, jumpSymbol,
    onSearchOpen, onSearchReplaced, jumpMethod, refreshOutline, gotoSuper, gotoTest, gotoRelated,
    workspaceSymbolsCache,
  }
}
