// 「管理最近项目」弹层的状态与规则 —— 上游 `ManageRecentProjectsAction`。
//
// 上游坐标：
//   · `platform/platform-impl/src/com/intellij/ide/recentProjects/actions/ManageRecentProjectsAction.java`
//     —— 动作本体；它用 `JBPopupFactory.createComponentPopupBuilder` 弹一个**居中模态**，
//     里面装最近项目树 + 搜索框 + 多选移除。本仓复用欢迎页那份列表，套一个居中对话框
//     （见 `src/components/ManageRecentsDialog.vue` 的挂点）。
//   · 过滤规则来自 `RecentProjectFilteringTree` + `SearchTextField`：与欢迎页**同一套**
//     （大小写不敏感的名字/路径匹配，空查询保留全部）。`ManageRecentProjectsAction` 用同一份数据建树，
//     所以用户在弹层里看到的列表与欢迎屏一致。
//   · 展示名 `RecentProjectTreeItem.displayName()` → `projectNameToDisplay`，由 `ReopenProjectAction.kt:140-148`
//     用 displayName 加一个可选的分支名模板（`action.reopen.project.display.name.with.branch`）拼出来。
//   · 多选：修饰键点击切换；**无修饰键点击清空选择**（与文件树的选择语义一致）。
//
// 为什么单独成模块：它是 App.vue 组装层里一块自洽的弹层状态（查询词 / 选择集 / 过滤结果 /
// 打开与移除两个动作），只依赖 `recentProjects` 一张表和两个宿主动作。
// 依赖全部按 **thunk** 传入（`() => recentProjects.value`）—— App.vue 里 `recentProjects`
// 与 `openWorkspace` 的声明都在本块之后，用值传参会撞上 const 的暂时性死区。
import { computed, nextTick, ref, watch, type Ref } from 'vue'
import type { RecentProject } from './settingsModel.ts'

export interface ManageRecentsPorts {
  /** 最近项目表（App.vue 的 `recentProjects`）。 */
  recentProjects: () => readonly RecentProject[]
  /** 有没有任务在跑（跑着不让开项目）。 */
  working: () => boolean
  /** 打开工作区。 */
  openWorkspace: (path: string) => Promise<unknown>
  /** 从最近列表里移除（不动磁盘）。 */
  forgetProjects: (paths: string[]) => Promise<unknown>
  /** 关掉主菜单（上游点这个动作先把菜单收起来）。 */
  closeMenu: () => void
}

export function createManageRecentsHost(ports: ManageRecentsPorts) {
  // ManageRecentProjectsAction mirrors JBPopupFactory.createComponentPopupBuilder:
  // a focused modal that hosts the recent-project tree, search field, and the same
  // multi-select remove behaviour. The popup is centred in the current window when
  // it is created; TaoCode reuses the welcome-screen list inside a centered dialog.
  const manageRecentsOpen: Ref<boolean> = ref(false)
  function openManageRecents() {
    ports.closeMenu()
    manageRecentsOpen.value = true
  }
  function closeManageRecents() { manageRecentsOpen.value = false }
  // RecentProjectFilteringTree + SearchTextField: same filter rules as the welcome
  // screen (case-insensitive name/path match, empty query keeps everything). The
  // ManageRecentProjectsAction source builds the tree with the same data, so the
  // user sees an identical list inside the popup.
  const manageRecentsQuery = ref('')
  const manageRecentsSelection = ref<Set<string>>(new Set())
  const manageRecentsInput = ref<HTMLInputElement>()
  const manageRecentsFiltered = computed(() => {
    // Source: RecentProjectFilteringTree uses the parent FilteringTree's predicate
    // (FilteringTree.kt), which accepts a node when the search text matches any of
    // the strings its renderer prints. RecentProjectTreeItem.displayName() returns
    // `projectNameToDisplay`, which ReopenProjectAction.kt:140-148 builds from
    // displayName plus an optional branchName template
    // ("action.reopen.project.display.name.with.branch"). Mirror that here.
    const projects = ports.recentProjects()
    const q = manageRecentsQuery.value.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(project => {
      const haystacks = [project.name, project.path, project.displayName ?? '']
      if (project.branchName) haystacks.push(project.branchName)
      return haystacks.some(text => text.toLowerCase().includes(q))
    })
  })
  const manageRecentsSelectedProjects = computed(() =>
    ports.recentProjects().filter(project => manageRecentsSelection.value.has(project.path)))
  function toggleManageRecentsSelection(project: RecentProject, event: MouseEvent) {
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
      if (manageRecentsSelection.value.size > 0) manageRecentsSelection.value = new Set()
      return
    }
    const next = new Set(manageRecentsSelection.value)
    if (next.has(project.path)) next.delete(project.path)
    else next.add(project.path)
    manageRecentsSelection.value = next
  }
  function openManageRecentsProject(project: RecentProject) {
    if (ports.working() || !project.available) return
    closeManageRecents()
    void ports.openWorkspace(project.path)
  }
  function confirmForgetManage(projects: RecentProject[]) {
    if (projects.length === 0) return
    const ok = window.confirm(projects.length === 1
      ? `从最近项目列表移除「${projects[0]!.name}」？\n磁盘上的文件不会被删除。`
      : `从最近项目列表移除 ${projects.length} 项？\n磁盘上的文件不会被删除。`)
    if (!ok) return
    void ports.forgetProjects(projects.map(project => project.path))
      .then(() => { manageRecentsSelection.value = new Set() })
  }
  // 每次打开都重置查询词与选择集，并把焦点送进搜索框（上游是 focused modal，搜索框先拿到焦点）。
  watch(manageRecentsOpen, open => {
    if (open) {
      manageRecentsQuery.value = ''
      manageRecentsSelection.value = new Set()
      nextTick(() => manageRecentsInput.value?.focus())
    }
  })
  return {
    manageRecentsOpen, openManageRecents, closeManageRecents,
    manageRecentsQuery, manageRecentsSelection, manageRecentsInput,
    manageRecentsFiltered, manageRecentsSelectedProjects,
    toggleManageRecentsSelection, openManageRecentsProject, confirmForgetManage,
  }
}
