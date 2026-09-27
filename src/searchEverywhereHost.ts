// Search Everywhere 的宿主装配：把三个供给者（文件 / 动作 / 运行配置）接成对话框要的 `items`。
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
// **还没接的 tab**：IDE、Autocompletion（`IdeBundle.properties` 里确有这两个 tab）。
// Autocompletion 要按当前文档取词（IDEA 的 `WordCompletionContributor`），IDE 要另一套范围 ——
// 等有真实供给者再渲染，不塞一个永远空着的 tab。
import { computed, ref, watch, type Ref } from 'vue'
import { request, type Workspace } from './bridge'
import type { ActionEntry } from './menuUi'
import type { SymbolEntry } from './lspNavigation'
import type { SearchEverywhereItem } from './searchEverywhere'

/** 与 `lspNavigation.globalSymbolEntries` 同一道门槛：语言服务少于两个字不给结果。 */
export const SEARCH_EVERYWHERE_SYMBOL_MIN = 2
/** 防抖窗口（ms）。和语言服务那条链路一样，避免每敲一个字就发一次请求。 */
const SYMBOL_DEBOUNCE_MS = 120

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
}

export function createSearchEverywhereHost(deps: SearchEverywhereHostDeps) {
  const { isDesktop, menu, workspace, activePath, lspReady, openFile, jumpSymbol, actionList, runAction,
         allRunConfigNames, selectRunConfig, runSelectedConfig, baseName } = deps

  const searchEverywhereOpen = ref(false)
  const searchEverywhereFiles = ref<string[]>([])
  const searchEverywhereSymbols = ref<SymbolEntry[]>([])
  let symbolTimer: ReturnType<typeof setTimeout> | undefined
  /** 只认最后发出的那次查询：迟到的响应不能盖掉新结果。 */
  let symbolQueryIssued = ''

  function onSearchEverywhereQuery(raw: string) {
    const query = raw.trim()
    if (symbolTimer !== undefined) clearTimeout(symbolTimer)
    if (query.length < SEARCH_EVERYWHERE_SYMBOL_MIN || !isDesktop || !workspace.value || !lspReady.value) {
      symbolQueryIssued = query
      searchEverywhereSymbols.value = []
      return
    }
    symbolQueryIssued = query
    symbolTimer = setTimeout(() => {
      void (async () => {
        try {
          const result = await request<{ available: boolean; symbols?: SymbolEntry[] }>(
            'lsp.request', { kind: 'workspaceSymbol', path: activePath.value, query: symbolQueryIssued })
          // 对话框已经关了、或者用户又改了查询：这份结果直接丢。
          if (!searchEverywhereOpen.value || symbolQueryIssued !== query) return
          searchEverywhereSymbols.value = (result.symbols ?? []).slice(0, 100)
        } catch { searchEverywhereSymbols.value = [] }
      })()
    }, SYMBOL_DEBOUNCE_MS)
  }

  async function openSearchEverywhere() {
    menu.value = null
    searchEverywhereOpen.value = true
    // 先用手上已有的供给者打开（文件 / 动作 / 运行配置立刻可用），再异步补文件清单。
    if (!isDesktop || searchEverywhereFiles.value.length) return
    try {
      const files = (await request<{ files: string[] }>('workspace.files')).files
      // 关闭了或已经换工作区，就别把迟到的结果塞回去。
      if (searchEverywhereOpen.value) searchEverywhereFiles.value = files
    } catch { /* 读不到文件清单就只剩动作与运行配置，不假装有 */ }
  }

  const searchEverywhereItems = computed<SearchEverywhereItem[]>(() => [
    ...searchEverywhereFiles.value.map(path => ({
      id: `file:${path}`,
      title: baseName(path),
      subtitle: path,
      // 路径本身当关键词：搜 "demo/Main" 要能命中 "src/demo/Main.java"。
      keywords: path,
      source: 'project' as const,
      open: () => { void openFile(path) },
    })),
    ...searchEverywhereSymbols.value.map(entry => ({
      id: `sym:${entry.path}:${entry.line}:${entry.character}:${entry.name}`,
      title: entry.name,
      subtitle: `${baseName(entry.path)}:${entry.line + 1}`,
      keywords: entry.path,
      source: 'symbols' as const,
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

  // 工作区换了要丢掉旧文件清单与符号结果，否则会列出上一个项目的路径。
  watch(() => workspace.value?.root ?? '', () => {
    searchEverywhereFiles.value = []
    searchEverywhereSymbols.value = []
  })

  return { searchEverywhereOpen, searchEverywhereItems, openSearchEverywhere, onSearchEverywhereQuery }
}
