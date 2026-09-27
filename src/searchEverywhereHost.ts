// Search Everywhere 的宿主装配：把三个供给者（文件 / 动作 / 运行配置）接成对话框要的 `items`。
//
// 为什么要单独成模块：App.vue 是组装层，已登记的行数上限只降不升（tests/module-size.test.mjs），
// 新逻辑一律拆到 src/xxx.ts、App 里只留一行调用。
//
// 三个供给者各自的数据来源都是**已有的真实通道**，不是造出来的：
//   · 文件   —— `workspace.files`（宿主，和自动发现运行目标用的是同一条）
//   · 动作   —— 菜单模块已经装配好的 `actionList`（Find Action 面板同一个源）
//   · 运行配置 —— `allRunConfigNames`（用户配置 + 打开项目时自动发现的候选）
//
// **还没接的**：LSP 符号（类 / 全局符号）。它需要按查询词异步问语言服务，等于多一条带防抖的
// 供给者链路，属于下一批 —— 这里不塞一个永远返回空数组的假贡献者。
import { computed, ref, watch, type Ref } from 'vue'
import { request, type Workspace } from './bridge'
import type { ActionEntry } from './menuUi'
import type { SearchEverywhereItem } from './searchEverywhere'

export interface SearchEverywhereHostDeps {
  isDesktop: boolean
  menu: Ref<any>
  workspace: Ref<Workspace | null>
  /** 打开一个文件（复用编辑器那一条，不另造一套）。 */
  openFile: (path: string) => unknown
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
  const { isDesktop, menu, workspace, openFile, actionList, runAction, allRunConfigNames, selectRunConfig, runSelectedConfig, baseName } = deps

  const searchEverywhereOpen = ref(false)
  const searchEverywhereFiles = ref<string[]>([])

  async function openSearchEverywhere() {
    menu.value = null
    searchEverywhereOpen.value = true
    // 先用手上已有的供给者打开（动作 / 运行配置立刻可用），再异步补文件清单。
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

  // 工作区换了要丢掉旧文件清单，否则会列出上一个项目的路径。
  watch(() => workspace.value?.root ?? '', () => { searchEverywhereFiles.value = [] })

  return { searchEverywhereOpen, searchEverywhereItems, openSearchEverywhere }
}
