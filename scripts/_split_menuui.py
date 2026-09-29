# 一次性脚本：把 App.vue 的「主菜单栏 UI + Find Action + 项目头部部件」搬到 src/menuUi.ts
# 安全规程见 skill: scripted-refactor-safety —— 锚点必须唯一，数量断言失败即中止。
import io

APP = r'D:\TaoCode\src\App.vue'
MOD = r'D:\TaoCode\src\menuUi.ts'

text = io.open(APP, encoding='utf-8').read()
lines = text.split('\n')

START_ANCHOR = 'const allMenuGroups = computed(() => {'
END_ANCHOR = 'watch(actionQuery, () => { actionIndex.value = 0 })'

assert text.count(START_ANCHOR) == 1, ('start anchor not unique', text.count(START_ANCHOR))
assert text.count(END_ANCHOR) == 1, ('end anchor not unique', text.count(END_ANCHOR))

start = next(i for i, l in enumerate(lines) if l.startswith(START_ANCHOR))
end = next(i for i, l in enumerate(lines) if l.startswith(END_ANCHOR))
assert end > start
assert start == 3176, ('unexpected start line', start + 1)
block = lines[start:end + 1]
joined = '\n'.join(block)
for must in ('allMenuGroups', 'pickMenuRow', 'openActionSearch', 'projectWidgetGroups', 'openRecentProject'):
    assert must in joined, ('block is missing ' + must)

ASSEMBLY = '''// 主菜单栏的模型与交互是一个域：菜单组的组装与排序（`allMenuGroups`）、子菜单浮层、
// 行点击分发（`pickMenuRow`）、主菜单里的「查找操作」（Find Action）、以及标题栏的项目部件。
// 它们共享同一份菜单开关状态 `menu` 与同一批行构造函数，审阅入口：src/menuUi.ts。
const {
  allMenuGroups, rowTitle, rowEnabled, hasSubmenu, submenuRow, submenuPlacement, submenuStyle,
  openSubmenu, closeSubmenu, scheduleSubmenuClose, cancelSubmenuClose, pickMenuRow,
  projectWidgetOpen, projectWidgetQuery, projectWidgetGroups, toggleProjectWidget, pickProjectFromWidget,
  branchOfProject, openRecentProject,
  actionSearch, actionQuery, actionIndex, actionInput, actionList, actionResults,
  openActionSearch, moveAction, runAction, runActionResult, flattenMenuRows,
} = createMenuUi({
  notify, isDesktop, editorSettings, menu, workspace, menus, windowMenuRows, layoutMenuRows, toolsMenuRows,
  digits, bookmarks, jumpMnemonic, focusStatusBar, recentProjects, working, openWorkspace,
})'''

HEADER = '''// 主菜单栏的模型与交互 —— 从 App.vue 搬出的一域（137 行，18 个依赖）。
//
// **范围说明（如实）**：这一块把三件事放在一起，因为它们是同一条交互链上的三段 ——
//   1) 菜单组的组装与排序（`allMenuGroups`，把 Tools 组与动态 Layouts 组插到 Git 之前/之后）；
//   2) 菜单行的渲染与点击（`rowTitle` / `rowEnabled` / `pickMenuRow` / 子菜单浮层状态）；
//   3) 不占菜单位置但必须可搜索的两个动作入口：「查找操作」（IDEA `FindActionAction`）与
//      标题栏的项目部件（`ProjectToolbarWidgetAction`）。
// 三者都读同一份 `menu` 开关、同一批 `MenuRow`，拆开会让每一份都要重新注入对方的状态。
// 菜单行本身的数据在 src/menus/*（一组一文件），这里只做「装配 + 交互」。
import { computed, nextTick, ref, watch, type Ref } from 'vue'
import type { MenuRow } from './menus/types'
import { useSubmenuState } from './menus/submenuState'
import { rankCommands } from './commandSearch'
import { bookmarkOwner } from './bookmarks'
import { filterProjects, groupProjects } from './projectWidget'
import type { EditorSettings, RecentProject, Workspace } from './bridge'

/** 命令面板/查找操作里的一条（IDEA 的 AnAction 在搜索列表中的投影）。 */
export interface ActionEntry { id: string; title: string; keywords?: string; keys?: string; group: string; enabled?: () => boolean; run: () => void }

export interface MenuUiDeps {
  notify: (message: string, error?: boolean) => void
  isDesktop: boolean
  editorSettings: Ref<EditorSettings>
  /** 主菜单开关（宿主更早的阶段就要读写它，所以留在宿主）。 */
  menu: Ref<any>
  workspace: Ref<Workspace | null>
  /** 静态菜单组（File/Edit/View/…）与两个动态组的数据源。 */
  menus: { menu: any; label: string; rows: MenuRow[] }[]
  windowMenuRows: MenuRow[]
  layoutMenuRows: Ref<MenuRow[]>
  toolsMenuRows: MenuRow[]
  /** 书签助记符（IDEA 把十个跳转也列成动作，但菜单栏里放不下）。 */
  digits: readonly string[]
  bookmarks: Ref<any[]>
  jumpMnemonic: (digit: string) => void
  focusStatusBar: () => void
  recentProjects: Ref<RecentProject[]>
  /** 有未完成的写入/加载时，切换项目要拦住。 */
  working: { readonly value: boolean }
  openWorkspace: (path: string) => unknown
}

export function createMenuUi(deps: MenuUiDeps) {
  const { notify, isDesktop, editorSettings, menu, workspace, menus, windowMenuRows, layoutMenuRows, toolsMenuRows,
          digits, bookmarks, jumpMnemonic, focusStatusBar, recentProjects, working, openWorkspace } = deps
'''

FOOTER = '''
  return {
    allMenuGroups, rowTitle, rowEnabled, hasSubmenu, submenuRow, submenuPlacement, submenuStyle,
    openSubmenu, closeSubmenu, scheduleSubmenuClose, cancelSubmenuClose, pickMenuRow, flattenMenuRows,
    projectWidgetOpen, projectWidgetQuery, projectWidgetGroups, toggleProjectWidget, pickProjectFromWidget,
    branchOfProject, openRecentProject,
    actionSearch, actionQuery, actionIndex, actionInput, actionList, actionResults,
    openActionSearch, moveAction, runAction, runActionResult,
  }
}
'''

io.open(MOD, 'w', encoding='utf-8', newline='\n').write(HEADER + '\n'.join(block) + FOOTER)

new_lines = lines[:start] + ASSEMBLY.split('\n') + lines[end + 1:]
io.open(APP, 'w', encoding='utf-8', newline='\n').write('\n'.join(new_lines))
print('block lines:', len(block))
print('App.vue:', len(lines), '->', len(new_lines))
