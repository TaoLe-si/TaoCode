# 一次性脚本：把 App.vue 的「文件树操作」域搬到 src/treeActions.ts
import io

APP = r'D:\TaoCode\src\App.vue'
MOD = r'D:\TaoCode\src\treeActions.ts'

text = io.open(APP, encoding='utf-8').read()
lines = text.split('\n')

a = next(i for i, l in enumerate(lines) if l.startswith('// Synthetic tree nodes (External Libraries / Scratches headers, glob leaves) carry a'))
b = next(i for i, l in enumerate(lines) if l.startswith('// The menus drive the very functions the keymap binds')) - 1
assert (a + 1, b + 1) == (1808, 1881), (a + 1, b + 1)
block = lines[a:b + 1]
assert len(block) == 74, len(block)
assert block[-1] == '}' and 'openInTerminal' in '\n'.join(block[-14:])

ASSEMBLY = '''// 文件树的操作是一个域（IDEA 的 ProjectView 右键菜单动作）。
const {
  isSyntheticPath, toggleReadOnly, languageChoices, associateFileType, onTreeContext, findUsagesOf,
  beginCreate, beginRename, beginDelete, copyPath, openInTerminal,
} = createTreeActions({
  notify, isDesktop, menu, treeMenu, treeSubmenu, tabMenu, findTab, editorFor, request, projectSettings, allTabs,
  startLsp, bufferEpoch, languageLabels, openFile, refreshOutline, outline, onSemantic, nameDialog, nameInput,
  deleteTarget, workspace, terminalPanelRef, showOutput, parentOf, baseName,
})'''

HEADER = '''// 文件树的操作 —— 从 App.vue 搬出的一域（74 行，25 个依赖）。
//
// 判据：IDEA 的 ProjectView 右键菜单（`ProjectViewPopupMenu`）在 TaoCode 里就是这一组动作：
//   · 文件属性：只读切换（`FilePropertiesGroup` 的 "Toggle Read Only"）、扩展名关联文件类型
//     （`AssociateWithFileTypeAction`，要顺带重挂受影响缓冲并重开 LSP 文档）；
//   · 结构动作：新建 / 重命名 / 删除（走同一个 `nameDialog`，所以三个 `beginXxx` 必须同处）；
//   · 内容动作：复制路径、在终端里打开、在文件上「查找用法」（`FindUsagesAction`，先开文件
//     再取它声明的类符号）。
// 它们共享树/标签右键菜单的坐标状态（`treeMenu` / `treeSubmenu` / `tabMenu`）与同一个命名对话框。
// `parentOf` / `baseName` 是全局工具函数，留在宿主。
import { nextTick } from 'vue'
import { request, type Entry, type ProjectSettings } from './bridge'
import { errorMessage } from './errors'
import type { Tab } from './editorTab'

export interface TreeActionsDeps {
  notify: (message: string, error?: boolean) => void
  isDesktop: boolean
  /** 主菜单开关。 */
  menu: any
  /** 树/标签右键菜单坐标（文件树模块自持）。 */
  treeMenu: any
  treeSubmenu: any
  tabMenu: any
  findTab: (path: string) => Tab | undefined
  editorFor: (path: string) => any
  request: typeof request
  projectSettings: { value: ProjectSettings }
  allTabs: { readonly value: Tab[] }
  /** 扩展名关联变更后要重开受影响缓冲的语言服务。 */
  startLsp: (tab: Tab) => unknown
  /** 语法来自重挂，所以关联变更要自增代次。 */
  bufferEpoch: { value: number }
  languageLabels: Record<string, string>
  /** 查找用法前先打开文件（编辑器骨架提供）。 */
  openFile: (path: string) => unknown
  refreshOutline: (path: string) => unknown
  outline: { readonly value: any[] }
  /** `references` 语义请求的入口（语义动作模块提供）。 */
  onSemantic: (payload: any) => unknown
  nameDialog: any
  nameInput: any
  deleteTarget: any
  workspace: any
  terminalPanelRef: any
  showOutput: (id: any) => void
  parentOf: (path: string) => string
  baseName: (path: string) => string
}

export function createTreeActions(deps: TreeActionsDeps) {
  const { notify, isDesktop, menu, treeMenu, treeSubmenu, tabMenu, findTab, editorFor, request, projectSettings,
          allTabs, startLsp, bufferEpoch, languageLabels, openFile, refreshOutline, outline, onSemantic, nameDialog,
          nameInput, deleteTarget, workspace, terminalPanelRef, showOutput, parentOf, baseName } = deps
'''

FOOTER = '''
  return {
    isSyntheticPath, toggleReadOnly, languageChoices, associateFileType, onTreeContext, findUsagesOf,
    beginCreate, beginRename, beginDelete, copyPath, openInTerminal,
  }
}
'''

io.open(MOD, 'w', encoding='utf-8', newline='\n').write(HEADER + '\n'.join(block) + FOOTER)

new_lines = lines[:a] + ASSEMBLY.split('\n') + lines[b + 1:]
io.open(APP, 'w', encoding='utf-8', newline='\n').write('\n'.join(new_lines))
print('block:', len(block))
print('App.vue:', len(lines), '->', len(new_lines))
