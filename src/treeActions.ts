// 文件树的操作 —— 从 App.vue 搬出的一域（74 行，25 个依赖）。
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
import { copyToClipboard } from './clipboard'
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
// Synthetic tree nodes (External Libraries / Scratches headers, glob leaves) carry a
// \0 prefix; file operations must not be offered or attempted on them.
function isSyntheticPath(path: string) { return path.startsWith('\u0000') }
async function toggleReadOnly(path: string) {
  treeMenu.value = null
  tabMenu.value = null
  if (!isDesktop) { notify('只读属性需要桌面端。', true); return }
  const tab = findTab(path)
  try {
    const result = await request<{ path: string; readOnly: boolean }>('file.readOnly', { path, readOnly: !(tab?.readOnly ?? false) })
    if (tab) {
      tab.readOnly = result.readOnly
      editorFor(path)?.setReadOnly(result.readOnly)
    }
    notify(result.readOnly ? `已将 ${baseName(path)} 标记为只读` : `${baseName(path)} 现在可写`)
  } catch (error) { notify(errorMessage(error), true) }
}
// AssociateWithFileTypeAction: map this file's extension to one of the languages
// TaoCode can highlight. The association is stored with the project and applies to
// every file sharing the extension, so remount the affected buffers after saving.
const languageChoices: [string, string][] = [['java', 'Java'], ['cpp', 'C++'], ['typescript', 'TypeScript'], ['other', '纯文本']]
async function associateFileType(path: string, choice: string) {
  tabMenu.value = null
  treeMenu.value = null
  const dot = path.lastIndexOf('.')
  const ext = dot < 0 ? '' : path.slice(dot + 1).toLowerCase()
  if (!ext) { notify('该文件没有扩展名，无法关联文件类型。', true); return }
  const next = { ...projectSettings.value.fileAssociations }
  if (choice === 'auto') delete next[ext]
  else next[ext] = choice
  try {
    const result = await request<{ settings: ProjectSettings }>('project.settings.update', { fileAssociations: next })
    projectSettings.value = result.settings
    // Syntax comes from the remount; the language server still keys documents by
    // extension, so re-open every buffer this association touches.
    for (const tab of allTabs.value) if (tab.path.toLowerCase().endsWith(`.${ext}`)) void startLsp(tab)
    bufferEpoch.value++
    notify(choice === 'auto' ? `已恢复按扩展名识别 .${ext}` : `*.${ext} 已关联到 ${languageLabels[choice] ?? choice}`)
  } catch (error) { notify(errorMessage(error), true) }
}
function onTreeContext(payload: { entry: Entry; x: number; y: number }) { if (isSyntheticPath(payload.entry.path)) return; treeMenu.value = payload; treeSubmenu.value = null; menu.value = null }
// FindUsages from the tree: open the file first (usages ride on the LSP document),
// then ask at its first symbol line.
async function findUsagesOf(path: string) {
  treeMenu.value = null
  treeSubmenu.value = null
  await openFile(path)
  if (!findTab(path)) return
  await refreshOutline(path)
  // IDEA's FindUsages on a file targets the class the file declares: pick the
  // class-like symbol named after the file stem, else the first symbol.
  const stem = (path.split('/').pop() ?? '').replace(/\.[^.]+$/, '')
  const classKinds = new Set([5, 11, 23, 26])  // class, interface, struct, enum per LSP
  const target = outline.value.find(symbol => symbol.name === stem && classKinds.has(symbol.kind))
    ?? outline.value.find(symbol => classKinds.has(symbol.kind))
    ?? outline.value[0]
  void onSemantic({ kind: 'references', path, line: target?.startLine ?? 0, character: target?.startChar ?? 0 })
}
function beginCreate(mode: 'createFile' | 'createDir') { const entry = treeMenu.value?.entry; if (!entry) return; const dir = entry.kind === 'directory' ? entry.path : parentOf(entry.path); treeMenu.value = null; nameDialog.value = { mode, dir, value: '', template: '' }; void nextTick(() => nameInput.value?.focus()) }
function beginRename() { const entry = treeMenu.value?.entry; if (!entry || !entry.path || isSyntheticPath(entry.path)) return; treeMenu.value = null; nameDialog.value = { mode: 'rename', dir: parentOf(entry.path), entry, value: baseName(entry.path) }; void nextTick(() => { nameInput.value?.focus(); nameInput.value?.select() }) }
function beginDelete() { const entry = treeMenu.value?.entry; if (!entry || !entry.path || isSyntheticPath(entry.path)) return; treeMenu.value = null; deleteTarget.value = entry }
function copyPath() { const entry = treeMenu.value?.entry; if (!entry) return; treeMenu.value = null; void copyToClipboard(workspace.value ? `${workspace.value.root}/${entry.path}` : entry.path); notify(`路径：${entry.path}`) }
function openInTerminal() {
  const entry = treeMenu.value?.entry
  if (!entry || !isDesktop || !workspace.value) return
  treeMenu.value = null
  const dir = entry.kind === 'directory' ? entry.path : parentOf(entry.path)
  // Bring the terminal tab up first so the panel is mounted; then ask the panel
  // (via defineExpose) to spawn the shell in the chosen directory. Sending the
  // cwd to the bridge directly would create an orphan terminal with no xterm
  // subscribed to its output stream.
  showOutput('terminal')
  void terminalPanelRef.value?.openIn(dir)
}
  return {
    isSyntheticPath, toggleReadOnly, languageChoices, associateFileType, onTreeContext, findUsagesOf,
    beginCreate, beginRename, beginDelete, copyPath, openInTerminal,
  }
}
