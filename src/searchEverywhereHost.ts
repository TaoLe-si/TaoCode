// Search Everywhere 的宿主装配：把五个供给者（文件 / 符号 / 动作 / 运行配置 / 文本命中）接成对话框要的 `items`。
//
// 为什么要单独成模块：App.vue 是组装层，已登记的行数上限只降不升（tests/module-size.test.mjs），
// 新逻辑一律拆到 src/xxx.ts、App 里只留一行调用。
//
// **已接的供给者**（每个都接已有的真实通道，不是造出来的）：
//   · 文件   —— `workspace.files`（宿主，和自动发现运行目标用的是同一条）
//   · 符号   —— LSP `workspace/symbol`（与「转到符号」同一个请求，同一个防抖阈值：≥2 字）；
//               Classes 档在这批符号上按 kind 取类型，`Foo#bar` 再取 `documentSymbol` 定位直接成员
//   · 动作   —— 菜单模块已经装配好的 `actionList`（Find Action 面板同一个源）
//   · 运行配置 —— `allRunConfigNames`（用户配置 + 打开项目时自动发现的候选）
//   · 文本命中 —— 宿主 `search.run`（`native/search.cpp` 的整工作区扫描），只在 All / Text 两档、
//                查询词 ≥3 字时发；三个开关与存档在 `src/searchEverywhereText.ts`
//
// **已开的弹层会跟着数据变化刷新**（IDEA `com.intellij.ui.tabs` 之外的
// `com.intellij.ui.popup.PopupUpdateProcessor`）：宿主每次文件变化推 `fsChanges`，
// 弹层开着就重取文件清单、并按同一个查询词重发符号请求 —— 关掉重开才能看到新数据是错的。
//
// **还没接的 tab**：IDE、Autocompletion（`IdeBundle.properties` 里确有这两个 tab）。
// Autocompletion 要按当前文档取词（IDEA 的 `WordCompletionContributor`），IDE 要另一套范围 ——
// 等有真实供给者再渲染，不塞一个永远空着的 tab。
import { computed, ref, watch, type Ref } from 'vue'
import { fsChanges, request, type LspDocumentSymbol, type SearchResult, type Workspace } from './bridge.ts'
import type { ActionEntry } from './menuUi'
import type { SymbolEntry } from './lspNavigation'
import type { SearchEverywhereItem, SearchEverywhereTab } from './searchEverywhere'
import { classMemberTarget, classSearchPattern, isSearchEverywhereClass } from './searchEverywhereClasses.ts'
// Text 档（上游 `SeTextTab.kt` + `platform/lang-impl/src/com/intellij/find/impl/TextSearchContributor.kt`）：
// 三个开关的模型/存档 + 宿主入参 + 命中→候选的映射，全在 src/searchEverywhereText.ts（纯函数）。
import {
  SE_TEXT_TAB_ID,
  loadTextOptions,
  saveTextOptions,
  textHitViews,
  textQueryAllowed,
  textSearchParams,
  type TextSearchOptions,
} from './searchEverywhereText.ts'
// 工程排除目录：与「在文件中查找」同一份口径（`SearchPanel.vue` 也是并进去的），
// SE 的 Text 档扫的是同一个工作区，不能把被排除的目录又扫一遍。
import { excludedDirsOf, mergeSearchExclude, projectExclusionPatterns } from './searchExclusions.ts'
import type { ProjectSettings } from './settingsModel.ts'

/** 与 `lspNavigation.globalSymbolEntries` 同一道门槛：语言服务少于两个字不给结果。 */
export const SEARCH_EVERYWHERE_SYMBOL_MIN = 2
/** 防抖窗口（ms）。和语言服务那条链路一样，避免每敲一个字就发一次请求。 */
const SYMBOL_DEBOUNCE_MS = 120
/** 文件变化后重取清单的抖窗。一次保存会推多条 `fsChanges`，抖一下再打宿主。 */
const REFRESH_DEBOUNCE_MS = 200
/**
 * Text 档的防抖窗口：比符号那一档长。
 * 上游 Text 档走 `FindModel` 的后台搜索（`TextSearchContributor`），本身就有"等一会再扫"的语义；
 * 本仓的宿主扫描是整工作区逐文件读，一个字一个字地重扫会把 CPU 吃掉。
 */
const TEXT_DEBOUNCE_MS = 400

export interface SearchEverywhereHostDeps {
  isDesktop: boolean
  menu: Ref<any>
  workspace: Ref<Workspace | null>
  activePath: Ref<string>
  lspReady: Ref<boolean>
  /** 打开一个文件（复用编辑器那一条，不另造一套）。 */
  openFile: (path: string) => unknown
  /** 跳到某个符号（LSP 导航模块已经有的那条）。 */
  jumpSymbol: (entry: SymbolEntry) => unknown
  /** 菜单模块装配好的动作表。 */
  actionList: Ref<ActionEntry[]>
  runAction: (entry: ActionEntry) => unknown
  /** 用户配置 + 自动发现的运行配置名。 */
  allRunConfigNames: Ref<string[]>
  selectRunConfig: (name?: string) => unknown
  runSelectedConfig: (debug: boolean) => unknown
  baseName: (path: string) => string
  /** 只读当前工作区已打开缓冲区；undefined 表示未打开，不能调用 openFile。 */
  readPreviewBuffer?: (path: string) => string | undefined
  /**
   * 重算动作索引里来自注册表的那一段（`menuUi` 的 `refreshActionRegistryIndex`）。
   * 键位动作是**每次按键**才注册进注册表的，而注册表不是响应式的 ⇒ Actions 档若不在这
   * 一刻重算，那 21 个只有键位、没有菜单行的动作（转到行 / 快速文档 / 提取方法…）就搜不到。
   */
  refreshActionRegistryIndex?: () => void
}

export function createSearchEverywhereHost(deps: SearchEverywhereHostDeps) {
  const { isDesktop, menu, workspace, activePath, lspReady, openFile, jumpSymbol, actionList, runAction,
         allRunConfigNames, selectRunConfig, runSelectedConfig, baseName } = deps

  const searchEverywhereOpen = ref(false)
  const searchEverywhereFiles = ref<string[]>([])
  const searchEverywhereSymbols = ref<SymbolEntry[]>([])
  /** Text 档的命中（宿主 `search.run` 回来的那批，已映射成候选行）。 */
  const searchEverywhereTextHits = ref<ReturnType<typeof textHitViews>>([])
  /** 三个开关（`SeTextSearchOptions`）：存档在 `localStorage`，改动即写回。 */
  const textOptions = ref<TextSearchOptions>(loadTextOptions())
  /** 工程设置里排除的目录（真要扫时才取一次，与 SearchPanel 同一个来源）。 */
  const textExcludedDirs = ref<string[]>([])
  /** 上面那份缓存属于哪个工作区根 —— 换工作区就得重取（`loadExcludedDirs` 里比对）。 */
  let textExcludedOrigin: string | null = null
  /** 当前 tab：Text 档的扫描只在 All / Text 两档跑（其余档不给候选就不发请求）。 */
  const activeTab = ref<SearchEverywhereTab>('all')
  let symbolTimer: ReturnType<typeof setTimeout> | undefined
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  let textTimer: ReturnType<typeof setTimeout> | undefined
  let textRequestId = 0
  // 生命周期与请求序号分别隔离关闭/重开、工作区切换及同词请求的乱序返回。
  let generation = 0
  let fileRequestId = 0
  let symbolRequestId = 0
  let sessionActive = false
  /** 最近一次查询词 —— 数据源变化后要按同一个词重发符号请求（PopupUpdateProcessor 那一层）。 */
  let lastQuery = ''

  function isCurrent(epoch: number) {
    return sessionActive && searchEverywhereOpen.value && generation === epoch
  }

  async function refreshFiles() {
    if (!sessionActive || !isDesktop || !workspace.value) return
    const epoch = generation
    const id = ++fileRequestId
    try {
      const { files } = await request<{ files: string[] }>('workspace.files')
      if (isCurrent(epoch) && id === fileRequestId) searchEverywhereFiles.value = files
    } catch { /* 当前会话刷新失败保留清单；新会话从空清单开始。 */ }
  }

  async function refreshSymbols(query: string, epoch: number, id: number) {
    if (!isCurrent(epoch) || id !== symbolRequestId) return
    try {
      const result = await request<{ available: boolean; symbols?: SymbolEntry[] }>(
        'lsp.request', { kind: 'workspaceSymbol', path: activePath.value, query })
      if (!isCurrent(epoch) || id !== symbolRequestId) return
      searchEverywhereSymbols.value = (result.symbols ?? []).slice(0, 100)
    } catch {
      if (isCurrent(epoch) && id === symbolRequestId) searchEverywhereSymbols.value = []
    }
  }

  function onSearchEverywhereQuery(raw: string) {
    const query = raw.trim()
    lastQuery = query
    // 在防抖开始时就作废旧请求，不能等下一次请求真正发出。
    const id = ++symbolRequestId
    const epoch = generation
    if (symbolTimer !== undefined) clearTimeout(symbolTimer)
    symbolTimer = undefined
    searchEverywhereSymbols.value = []
    // Text 档与符号档共用这一次查询变化，但门槛不同（≥3 字 + 只在 All/Text 档）。
    scheduleText()
    if (!isCurrent(epoch) || query.length < SEARCH_EVERYWHERE_SYMBOL_MIN || !isDesktop || !workspace.value || !lspReady.value) return
    symbolTimer = setTimeout(() => {
      symbolTimer = undefined
      void refreshSymbols(query, epoch, id)
    }, SYMBOL_DEBOUNCE_MS)
  }

  /**
   * Text 档要不要发这一次扫描：上游把 Text 档的 `getItems` 挂在**这一档被选中**时
   * （`SeTextTab.kt:24-29` 的 filterEditor/items 都是 delegate 的），All 档则是
   * "除被关掉的供给者外全部供给者"（`SeAllTab.kt:51-53` → `delegate.getItems(params, disabledProviderIds)`）。
   * 本仓照这个口径：只有 All / Text 两档会触发整工作区扫描。
   */
  function textWanted(): boolean {
    return sessionActive && searchEverywhereOpen.value && isDesktop && Boolean(workspace.value)
      && (activeTab.value === SE_TEXT_TAB_ID || activeTab.value === 'all')
  }

  function scheduleText() {
    const query = lastQuery
    if (textTimer !== undefined) clearTimeout(textTimer)
    textTimer = undefined
    const id = ++textRequestId
    const epoch = generation
    // 门槛：不足 `SE_TEXT_MIN_QUERY` 个字符不发（`textQueryAllowed`），且没在需要它的档上。
    if (!textWanted() || !textQueryAllowed(query)) {
      if (searchEverywhereTextHits.value.length) searchEverywhereTextHits.value = []
      return
    }
    textTimer = setTimeout(() => {
      textTimer = undefined
      void refreshText(query, epoch, id)
    }, TEXT_DEBOUNCE_MS)
  }

  async function refreshText(query: string, epoch: number, id: number) {
    if (!isCurrent(epoch) || id !== textRequestId) return
    const origin = workspace.value?.root
    // 排除目录只在**真要扫**的时候取一次（切换工作区后重来）：不开 Text 档就不该多打一次宿主请求。
    if (textExcludedOrigin !== origin) await loadExcludedDirs(origin, epoch, id)
    if (!textAccepted(epoch, id, origin)) return
    const params = textSearchParams(query, textOptions.value)
    params.exclude = mergeSearchExclude(params.exclude, projectExclusionPatterns(textExcludedDirs.value))
    try {
      // 展开成字面量：`request` 的入参类型是 `Record<string, unknown>`，具名 interface 没有隐式索引签名。
      const result = await request<SearchResult>('search.run', { ...params })
      if (!textAccepted(epoch, id, origin)) return
      searchEverywhereTextHits.value = textHitViews(result.matches ?? [], baseName)
    } catch {
      if (!textAccepted(epoch, id, origin)) return
      searchEverywhereTextHits.value = []
    }
  }

  /** 这一次 Text 请求还算不算数：会话、序号、工作区三者都得对上。 */
  function textAccepted(epoch: number, id: number, origin: string | null | undefined) {
    return isCurrent(epoch) && id === textRequestId && workspace.value?.root === origin
  }

  /** 工程设置里排除的目录（与 `SearchPanel.vue:47` 同一个请求、同一份换算）。 */
  async function loadExcludedDirs(origin: string | undefined, epoch: number, id: number) {
    if (!origin) return
    textExcludedOrigin = origin
    try {
      const settings = await request<ProjectSettings>('project.settings.get')
      if (textAccepted(epoch, id, origin)) textExcludedDirs.value = excludedDirsOf(settings)
    } catch { /* 读不到就是不排除：宿主自己的默认排除表仍然生效（native/search.cpp:46-49）。 */ }
  }

  /** 切 tab：Text 档的按需扫描在这里触发（上游每档有自己的 provider 集合）。 */
  function setSearchEverywhereTab(tab: SearchEverywhereTab) {
    if (activeTab.value === tab) return
    activeTab.value = tab
    scheduleText()
  }

  /** 改一个开关：立刻写回存档并按新开关重扫（上游 Text 档的筛选器就是这三个布尔）。 */
  function setTextSearchOption(key: keyof TextSearchOptions, value: boolean) {
    textOptions.value = { ...textOptions.value, [key]: value }
    saveTextOptions(textOptions.value)
    scheduleText()
  }

  function openSearchEverywhere() {
    menu.value = null
    // Actions 档与 Find Action 同源，刷新点也同源（键位动作是按需注册的）。
    deps.refreshActionRegistryIndex?.()
    // 打开后由生命周期 watch 异步刷新文件，动作与运行配置仍立即可用。
    searchEverywhereOpen.value = true
  }

  /**
   * 打开一条符号。Classes 档里查 `Foo#bar` 时按 `ClassSearchEverywhereNavigationHandler`
   * （`platform/lang-impl/.../ClassSearchEverywhereNavigationHandler.kt:53-80`）走：
   * 取那个类的结构视图（本仓 = LSP `documentSymbol`），在**直接成员**里找最匹配的一个，
   * 找不到就退回类本身。member 的匹配度用 `scoreCommand`（子序列 + 词首加权）。
   */
  async function openSymbolEntry(entry: SymbolEntry, query?: string) {
    const raw = (query ?? '').trim()
    if (!isSearchEverywhereClass(entry.kind) || classSearchPattern(raw).member === null) { jumpSymbol(entry); return }
    try {
      const result = await request<{ available: boolean; symbols?: LspDocumentSymbol[] }>('lsp.request', { kind: 'documentSymbol', path: entry.path })
      const symbols = result.available ? result.symbols ?? [] : []
      jumpSymbol(classMemberTarget(entry, raw, symbols))
    } catch { jumpSymbol(entry) }   // 取结构失败时退回类本身（上游同样退回类）
  }

  // Split SE: SeItemsPreviewProvider → SePopupVm.fetchPreview，不走 ItemWrapper/DetailController。
  function previewFile(path: string, line?: number, character?: number, endLine?: number, endCharacter?: number): NonNullable<SearchEverywhereItem['preview']> {
    const epoch = generation
    const origin = workspace.value
    const root = origin?.root
    return async () => {
      const current = () => isCurrent(epoch) && workspace.value === origin && workspace.value?.root === root
      if (!origin || !current()) return null
      const buffer = deps.readPreviewBuffer?.(path)
      if (buffer !== undefined) return current() ? { path, content: buffer, origin: 'buffer', line, character, endLine, endCharacter } : null
      if (!isDesktop) return null
      // file.read 在原生端调用 workspace->read，保留路径、二进制和大小校验。
      try {
        const document = await request<{ content: string }>('file.read', { path })
        return current() ? { path, content: document.content, origin: 'disk', line, character, endLine, endCharacter } : null
      } catch (error) {
        if (!current()) return null
        throw error
      }
    }
  }

  const searchEverywhereItems = computed<SearchEverywhereItem[]>(() => [
    ...searchEverywhereFiles.value.map(path => ({
      id: `file:${path}`,
      title: baseName(path),
      subtitle: path,
      // 路径本身当关键词：搜 "demo/Main" 要能命中 "src/demo/Main.java"。
      keywords: path,
      // 模糊匹配那档比的是整条路径（上游 matchWithPath 拿 file.path）。
      fuzzyPath: path,
      source: 'project' as const,
      preview: previewFile(path),
      open: () => { void openFile(path) },
    })),
    ...searchEverywhereSymbols.value.map(entry => ({
      id: `sym:${entry.path}:${entry.line}:${entry.character}:${entry.name}`,
      title: entry.name,
      subtitle: `${baseName(entry.path)}:${entry.line + 1}`,
      keywords: entry.path,
      source: 'symbols' as const,
      // 作用域表达式按真实路径比；符号不能填 fuzzyPath（那会启用文件模糊打分）。
      path: entry.path,
      // Classes 档与 `Foo#bar` 的成员定位都靠语言服务给的 kind，不从名字猜。
      symbolKind: entry.kind,
      preview: previewFile(entry.path, entry.line, entry.character, entry.endLine, entry.endCharacter),
      open: (query?: string) => { void openSymbolEntry(entry, query) },
    })),
    ...actionList.value.map(entry => ({
      id: `cmd:${entry.id}`,
      title: entry.title,
      subtitle: entry.group,
      keywords: entry.keywords,
      source: 'commands' as const,
      open: () => runAction(entry),
    })),
    ...allRunConfigNames.value.map(name => ({
      id: `cfg:${name}`,
      title: name,
      source: 'runConfigs' as const,
      // 选中的运行配置直接跑起来（IDEA 的 Search Everywhere 里选中配置就是启动它）。
      open: () => { selectRunConfig(name); void runSelectedConfig(false) },
    })),
    // Text 档（上游 `TextSearchContributor`）：一条宿主命中 = 一行候选。
    // 标题是命中那一行的片段（`clipHit` 前后各 40 码点），副标题是 `文件:行:列`；
    // 打开 = 沿 jumpSymbol 那条真实通道 reveal 到**命中所在行**
    // （本仓的 jumpSymbol 只按行定位，不选列 —— 这是与上游的一处已知差异，写进报告）。
    ...searchEverywhereTextHits.value.map(hit => ({
      id: `text:${hit.id}`,
      title: hit.title,
      subtitle: hit.subtitle,
      keywords: hit.path,
      source: 'text' as const,
      path: hit.path,
      // 命中段的高亮区间（宿主给的 column+length 换算，见 `textHitFragments`）。
      hitRanges: hit.fragments,
      preview: previewFile(hit.path, hit.line - 1, hit.column - 1),
      open: () => { jumpSymbol({ name: hit.title, kind: 0, path: hit.path, line: hit.line - 1, character: hit.column - 1 }) },
    })),
  ])

  // 同步隔离每次关闭/重开和工作区替换（包括同 root 的新工作区对象）。
  // watch 随调用方的 Vue effectScope 停止时也会执行清理，无须另建卸载通道。
  watch([searchEverywhereOpen, workspace, () => workspace.value?.root], ([open], _previous, onCleanup) => {
    sessionActive = open
    searchEverywhereFiles.value = []
    searchEverywhereSymbols.value = []
    searchEverywhereTextHits.value = []
    activeTab.value = 'all'
    if (!open) lastQuery = ''
    onCleanup(() => {
      sessionActive = false
      generation++
      fileRequestId++
      symbolRequestId++
      textRequestId++
      if (symbolTimer !== undefined) clearTimeout(symbolTimer)
      if (refreshTimer !== undefined) clearTimeout(refreshTimer)
      if (textTimer !== undefined) clearTimeout(textTimer)
      symbolTimer = undefined
      refreshTimer = undefined
      textTimer = undefined
    })
    if (open) {
      void refreshFiles()
      onSearchEverywhereQuery(lastQuery)
      scheduleText()
    }
  }, { immediate: true, flush: 'sync' })

  // LSP 就绪状态或请求所依赖的文档变化也必须作废旧符号响应。
  watch([activePath, lspReady], () => {
    if (sessionActive) onSearchEverywhereQuery(lastQuery)
  }, { flush: 'sync' })

  // ---- 已打开的弹层要自己跟上数据变化（IDEA `PopupUpdateProcessor`）----
  watch(() => fsChanges.version, () => {
    if (!sessionActive || !searchEverywhereOpen.value || !isDesktop || !workspace.value) return
    if (refreshTimer !== undefined) clearTimeout(refreshTimer)
    // 数据变化立即作废在途文件请求；符号独立刷新，不再等待文件请求完成。
    fileRequestId++
    onSearchEverywhereQuery(lastQuery)
    // 文本命中跟着一起重排：`onSearchEverywhereQuery` 里已经调了 `scheduleText()`
    // （它会作废在途 Text 请求并按同一个查询词重排），排除目录的缓存在切换工作区时自然失效。
    const epoch = generation
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined
      if (isCurrent(epoch)) void refreshFiles()
    }, REFRESH_DEBOUNCE_MS)
  }, { flush: 'sync' })

  return {
    searchEverywhereOpen,
    searchEverywhereItems,
    openSearchEverywhere,
    onSearchEverywhereQuery,
    /** 当前 tab 交给宿主：Text 档的扫描只在 All / Text 两档发（`setSearchEverywhereTab`）。 */
    setSearchEverywhereTab,
    /** Text 档的三个开关（上游 `SeTextSearchOptions`）。 */
    searchEverywhereTextOptions: computed(() => textOptions.value),
    setTextSearchOption,
    /** Text 档在不在跑（面板提示用；不渲染进度条，只给状态文字）。 */
    textSearchPending: computed(() => textTimer !== undefined),
  }
}
