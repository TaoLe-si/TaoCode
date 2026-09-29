// 状态栏的 Git 部件 —— IDEA `GitWidget` / `VcsStatusWidget` 那一族（分支 + 领先/落后 + 变更文件表）。
//
// 判据（为什么单独成模块）：这三份数据只有**一个**来源（`git.status` + `git.aheadBehind`），
// 且只有**一个**刷新节奏（工作区打开期间每 30 秒，且只在窗口可见 + 非省电模式时跑）。
// 它被三处消费：状态栏（分支名与计数）、文件标签部件的颜色（`gitChanges`）、分支弹窗（`gitBranches`）。
// 放在模块里之后，App.vue 只留一行装配 + 一行 `refreshGitWidget` 引用。
//
// 本模块只依赖 npm 包与 @vue，**不被测试直接 import**（要定时器与 DOM）。
import { ref, watch, type Ref } from 'vue'
import { request, type GitAheadBehind, type GitChange, type GitStatus, type Workspace } from './bridge'

export interface GitWidgetDeps {
  isDesktop: boolean
  workspace: Ref<Workspace | null>
  gitAvailable: Ref<boolean>
  editorSettings: { readonly value: { powerSaveMode: boolean } }
}

export function createGitWidget(deps: GitWidgetDeps) {
  const { isDesktop, workspace, gitAvailable, editorSettings } = deps
  const gitHead = ref('')
  const gitAheadBehind = ref<GitAheadBehind>({ available: false, ahead: 0, behind: 0 })
  // The per-file change list behind `git.status`. IDEA colours the toolbar filename widget with
  // FileStatusManager's FileStatus for the selected file (FilenameToolbarWidgetAction.kt:63-73);
  // the change list gives the same information without a second round trip.
  const gitChanges = ref<GitChange[]>([])
  // `git.status` 顺带返回本地分支表（GitStatus.branches），分支弹窗与「Git › 分支…」都用它。
  const gitBranches = ref<string[]>([])
  let timer: number | undefined

  function clear() {
    gitHead.value = ''
    gitBranches.value = []
    gitChanges.value = []
  }

  async function refreshGitWidget() {
    if (!isDesktop || !workspace.value || !gitAvailable.value) { clear(); return }
    try {
      const status = await request<GitStatus>('git.status')
      gitHead.value = status.head ?? ''
      gitBranches.value = status.branches ?? []
      gitChanges.value = status.changes ?? []
      gitAheadBehind.value = await request<GitAheadBehind>('git.aheadBehind')
    } catch { clear() }
  }

  /** 组件卸载时停表（对应原来的 `onBeforeUnmount` 里那段 clearInterval）。 */
  function stopGitWidgetPolling() {
    if (timer !== undefined) { window.clearInterval(timer); timer = undefined }
  }

  watch(workspace, value => {
    stopGitWidgetPolling()
    if (!value) { clear(); return }
    void refreshGitWidget()
    timer = window.setInterval(() => {
      if (!document.hidden && !editorSettings.value.powerSaveMode) void refreshGitWidget()
    }, 30000)
  })

  return { gitHead, gitAheadBehind, gitChanges, gitBranches, refreshGitWidget, stopGitWidgetPolling }
}
