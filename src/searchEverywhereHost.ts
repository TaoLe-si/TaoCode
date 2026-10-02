// Search Everywhere 的宿主装配：把四个供给者（文件 / 符号 / 动作 / 运行配置）接成对话框要的 `items`。
//
// 为什么要单独成模块：App.vue 是组装层，已登记的行数上限只降不升（tests/module-size.test.mjs），
// 新逻辑一律拆到 src/xxx.ts、App 里只留一行调用。
//
// **已接的供给者**（每个都接已有的真实通道，不是造出来的）：
//   · 文件   —— `workspace.files`（宿主，和自动发现运行目标用的是同一条）
//   · 符号   —— LSP `workspace/symbol`（与「转到符号」同一个请求，同一个防抖阈值：≥2 字）
//   · 动作   —— 菜单模块已经装配好的 `actionList`（Find Action 面板同一个源）
//   · 运行配置 —— `allRunConfigNames`（用户配置 + 打开项目时自动发现的候选）
//
// **已开的弹层会跟着数据变化刷新**（IDEA `com.intellij.ui.tabs` 之外的
// `com.intellij.ui.popup.PopupUpdateProcessor`）：宿主每次文件变化推 `fsChanges`，
// 弹层开着就重取文件清单、并按同一个查询词重发符号请求 —— 关掉重开才能看到新数据是错的。
//
// **还没接的 tab**：IDE、Autocompletion（`IdeBundle.properties` 里确有这两个 tab）。
// Autocompletion 要按当前文档取词（IDEA 的 `WordCompletionContributor`），IDE 要另一套范围 ——
// 等有真实供给者再渲染，不塞一个永远空着的 tab。
import { computed, ref, watch, type Ref } from 'vue'
import { fsChanges, request, type Workspace } from './bridge'
import type { ActionEntry } from './menuUi'
import type { SymbolEntry } from './lspNavigation'
import type { SearchEverywhereItem } from './searchEverywhere'

/** 与 `lspNavigation.globalSymbolEntries` 同一道门槛：语言服务少于两个字不给结果。 */
export const SEARCH_EVERYWHERE_SYMBOL_MIN = 2
/** 防抖窗口（ms）。和语言服务那条链路一样，避免每敲一个字就发一次请求。 */
const SYMBOL_DEBOUNCE_MS = 120
/** 文件变化后重取清单的抖窗。一次保存会推多条 `fsChanges`，抖一下再打宿主。 */
const REFRESH_DEBOUNCE_MS = 200

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
}

export function createSearchEverywhereHost(deps: SearchEverywhereHostDeps) {
  const { isDesktop, menu, workspace, activePath, lspReady, openFile, jumpSymbol, actionList, runAction,
         allRunConfigNames, selectRunConfig, runSelectedConfig, baseName } = deps

  const searchEverywhereOpen = ref(false)
  const searchEverywhereFiles = ref<string[]>([])
  const searchEverywhereSymbols = ref<SymbolEntry[]>([])
  let symbolTimer: ReturnType<typeof setTimeout> | undefined
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
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
    if (!isCurrent(epoch) || query.length < SEARCH_EVERYWHERE_SYMBOL_MIN || !isDesktop || !workspace.value || !lspReady.value) return
    symbolTimer = setTimeout(() => {
      symbolTimer = undefined
      void refreshSymbols(query, epoch, id)
    }, SYMBOL_DEBOUNCE_MS)
  }

  function openSearchEverywhere() {
    menu.value = null
    // 打开后由生命周期 watch 异步刷新文件，动作与运行配置仍立即可用。
    searchEverywhereOpen.value = true
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
      preview: previewFile(entry.path, entry.line, entry.character, entry.endLine, entry.endCharacter),
      open: () => jumpSymbol(entry),
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
  ])

  // 同步隔离每次关闭/重开和工作区替换（包括同 root 的新工作区对象）。
  // watch 随调用方的 Vue effectScope 停止时也会执行清理，无须另建卸载通道。
  watch([searchEverywhereOpen, workspace, () => workspace.value?.root], ([open], _previous, onCleanup) => {
    sessionActive = open
    searchEverywhereFiles.value = []
    searchEverywhereSymbols.value = []
    if (!open) lastQuery = ''
    onCleanup(() => {
      sessionActive = false
      generation++
      fileRequestId++
      symbolRequestId++
      if (symbolTimer !== undefined) clearTimeout(symbolTimer)
      if (refreshTimer !== undefined) clearTimeout(refreshTimer)
      symbolTimer = undefined
      refreshTimer = undefined
    })
    if (open) {
      void refreshFiles()
      onSearchEverywhereQuery(lastQuery)
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
    const epoch = generation
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined
      if (isCurrent(epoch)) void refreshFiles()
    }, REFRESH_DEBOUNCE_MS)
  }, { flush: 'sync' })

  return { searchEverywhereOpen, searchEverywhereItems, openSearchEverywhere, onSearchEverywhereQuery }
}
