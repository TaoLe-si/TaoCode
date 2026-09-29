# 一次性脚本：把 App.vue 的「工作区/项目生命周期」域搬到 src/workspaceLifecycle.ts
# 装配点放在 onMounted 之前（那里所有依赖都已声明），只在 3 处顶层对象字面量上做惰性包装。
import io

APP = r'D:\TaoCode\src\App.vue'
MOD = r'D:\TaoCode\src\workspaceLifecycle.ts'

text = io.open(APP, encoding='utf-8').read()
lines = text.split('\n')

START = 'async function refreshAppState() {'
END = 'async function cancelProject() {'
MOUNT = 'onMounted(() => {'

for a in (START, END, MOUNT):
    assert text.count(a) == 1, (a, text.count(a))

start = next(i for i, l in enumerate(lines) if l.startswith(START))
end_anchor = next(i for i, l in enumerate(lines) if l.startswith(END))
end = next(i for i in range(end_anchor, len(lines)) if lines[i] == '}')
mount = next(i for i, l in enumerate(lines) if l.startswith(MOUNT))
assert (start, end_anchor, end, mount) == (1693, 1883, 1889, 3328), (start + 1, end_anchor + 1, end + 1, mount + 1)

block = lines[start:end + 1]
assert len(block) == 197, len(block)
assert block[-1] == '}' and block[0].startswith('async function refreshAppState')
for must in ('refreshAppState', 'bootstrap', 'activateWorkspace', 'openWorkspace', 'submitProject'):
    assert must in '\n'.join(block), must

ASSEMBLY = '''// 工作区/项目的生命周期是一个域（IDEA 的 ProjectManager + RecentProjectsManager）。
const {
  refreshAppState, refreshRecent, bootstrap, confirmLeave, answerLeave, activateWorkspace,
  syntheticNodes, refreshSyntheticNodes, openWorkspace, closeWorkspace, forgetProject, forgetProjects,
  defaultProjectParent, beginProject, browseParent, submitProject, cancelProject,
} = createWorkspaceLifecycle({
  notify, isDesktop, recentProjects, editorSettings, generalSettings, gitAvailable, defaultParent, appError,
  loading, pluginList, busy, working, leavePrompt, allTabs, save, resetLsp, resetHierarchy, workspace,
  closeAllPanes, navBack, navForward, treeVersion, places, projectSettings, bookmarks, runConfigName,
  selectRunConfig, useProjectSettings, offerSessionRestore, menu, palette, notice, binaryView,
  projectError, projectForm, projectMode, projectBusy, cancelling,
  // 宿主是 `let`（别处也自增它），用 getter/setter 共享同一份。
  workspaceEpoch: { get value() { return workspaceEpoch }, set value(v) { workspaceEpoch = v } },
})'''

HEADER = '''// 工作区 / 项目的生命周期 —— 从 App.vue 搬出的一域（197 行，41 个依赖）。
//
// 判据：IDEA 把「打开/关闭一个 Project」和「最近项目列表」放在 `ProjectManager` +
// `RecentProjectsManagerBase` 里，TaoCode 的对应物就是这一条链路：
//   读应用状态（`refreshAppState`）→ 打开工作区（`openWorkspace`）→ 装配新工作区
//   （`activateWorkspace`：换根目录、清面板、重读项目设置、重建合成节点）
//   → 关闭（`closeWorkspace`）→ 最近项目增删（`forgetProjects`）→ 新建/克隆项目
//   （`beginProject` / `submitProject` / `cancelProject`）。
// 它们共享 `confirmLeave`（离开前的未保存确认）与同一批 `appError` / `busy` 状态，是一个闭环。
// 注意：`openFile`（编辑器骨架）、会话恢复（src/sessionSnapshot.ts）各自属于别的域。
import { ref } from 'vue'
import { cloneProgress, defaultGeneralSettings, defaultProjectSettings, isDesktop, normalizeEditorSettings, request,
         type AppState, type Entry, type PluginList, type ProjectForm, type ProjectSettings, type Workspace } from './bridge'
import type { SyntheticNode } from './components/FileTree.vue'
import { errorMessage } from './errors'
import type { Tab } from './editorTab'

/** 未保存修改的离开选择（IDEA `SaveDocumentsChoice`）。宿主也用它标注提示框，所以导出。 */
export type LeaveChoice = 'save' | 'discard' | 'cancel'

/** 工作区代次：宿主是 `let`（别的域也自增它），通过 getter/setter 共享同一份。 */
export interface EpochHolder { value: number }

export interface WorkspaceLifecycleDeps {
  notify: (message: string, error?: boolean) => void
  isDesktop: boolean
  recentProjects: any
  editorSettings: any
  generalSettings: any
  gitAvailable: any
  defaultParent: any
  appError: any
  loading: any
  pluginList: any
  busy: any
  working: { readonly value: boolean }
  leavePrompt: any
  allTabs: { readonly value: Tab[] }
  save: (tab?: Tab) => Promise<boolean>
  resetLsp: () => void
  resetHierarchy: () => void
  workspace: any
  workspaceEpoch: EpochHolder
  closeAllPanes: () => void
  navBack: any
  navForward: any
  treeVersion: any
  places: any
  projectSettings: any
  bookmarks: any
  runConfigName: any
  selectRunConfig: (name?: string) => void
  /** 书签模块提供的项目设置写入（`useProjectSettings`）。 */
  useProjectSettings: (settings: ProjectSettings) => void
  offerSessionRestore: () => unknown
  menu: any
  palette: any
  notice: any
  binaryView: any
  projectError: any
  projectForm: any
  projectMode: any
  projectBusy: any
  cancelling: any
}

export function createWorkspaceLifecycle(deps: WorkspaceLifecycleDeps) {
  const { notify, isDesktop, recentProjects, editorSettings, generalSettings, gitAvailable, defaultParent, appError,
          loading, pluginList, busy, working, leavePrompt, allTabs, save, resetLsp, resetHierarchy, workspace,
          workspaceEpoch, closeAllPanes, navBack, navForward, treeVersion, places, projectSettings, bookmarks,
          runConfigName, selectRunConfig, useProjectSettings, offerSessionRestore, menu, palette, notice, binaryView,
          projectError, projectForm, projectMode, projectBusy, cancelling } = deps
'''

FOOTER = '''
  return {
    refreshAppState, refreshRecent, bootstrap, confirmLeave, answerLeave, activateWorkspace,
    syntheticNodes, refreshSyntheticNodes, openWorkspace, closeWorkspace, forgetProject, forgetProjects,
    defaultProjectParent, beginProject, browseParent, submitProject, cancelProject,
  }
}
'''

# 块内 workspaceEpoch++ / workspaceEpoch 的用法改成 holder
body = '\n'.join(block)
assert 'workspaceEpoch++' in body
body = body.replace('workspaceEpoch++', 'workspaceEpoch.value++')

io.open(MOD, 'w', encoding='utf-8', newline='\n').write(HEADER + body + FOOTER)

new_lines = (lines[:start] + lines[end + 1:mount] + ASSEMBLY.split('\n') + lines[mount:])
io.open(APP, 'w', encoding='utf-8', newline='\n').write('\n'.join(new_lines))
print('block:', len(block))
print('App.vue:', len(lines), '->', len(new_lines))
