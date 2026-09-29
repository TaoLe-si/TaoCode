// 生成 / 重构 / 文件移动 —— 从 App.vue 搬出的一域（97 行，15 个依赖）。
//
// 判据：IDEA 的 Generate（Alt+Insert）和 Refactor（Ctrl+Alt+Shift+T / F5 / F6）在 TaoCode 里
// 走的是**同一条** Alt+Enter 代码动作通道，只是过滤条件不同：
//   · 生成：`action.kind` 以 `source` 开头，或标题命中 GENERATE_WORDS（构造器/getter/toString…）；
//   · 提取/内联：`action.kind` 以 `refactor` 开头，再按 `refactorTitles` 命中目标动作；
//   · 文件级：复制路径 / 移动文件（F6）/ 复制文件（F5）—— 移动要顺带改引用（`willRenameFiles`）。
// 它们共享 `codeActions` + `actionPrompt` 两个弹窗状态与 `applyCodeAction` 这一条套用链路，
// 拆开会让每一半都要重新注入对方的弹窗状态。`parentOf` / `baseName` 是全局工具函数，留在宿主。
import { request, lspDiagnostics, type LspCodeAction, type LspCodeActionResults } from './bridge'
import { copyToClipboard } from './clipboard'
import { errorMessage } from './errors'
import type { Tab } from './editorTab'

export interface GenerateRefactorDeps {
  notify: (message: string, error?: boolean) => void
  isDesktop: boolean
  workspace: any
  active: { readonly value: Tab | undefined }
  editorFor: (path: string) => any
  lspReady: { readonly value: boolean }
  request: typeof request
  parentOf: (path: string) => string
  baseName: (path: string) => string
  refreshTree: () => unknown
  /** 移动文件时要顺带更新引用（语义动作模块提供）。 */
  renameEntryWithReferences: (from: string, to: string) => unknown
  /** 「X copy.ext」去重命名（文件树模块提供）。 */
  copyCollisionName: (existing: (name: string) => boolean, name: string) => string
  codeActions: { value: LspCodeAction[] }
  actionPrompt: { value: { path: string } | null }
  /** Alt+Enter 里套用一条代码动作（语义动作模块提供）。 */
  applyCodeAction: (action: LspCodeAction) => Promise<void>
}

export function createGenerateRefactor(deps: GenerateRefactorDeps) {
  const { notify, isDesktop, workspace, active, editorFor, lspReady, request, parentOf, baseName, refreshTree,
          renameEntryWithReferences, copyCollisionName, codeActions, actionPrompt, applyCodeAction } = deps
function copyFilePath() {
  const tab = active.value
  if (!tab) return
  const fullPath = workspace.value ? `${workspace.value.root}/${tab.path}` : tab.path
  void copyToClipboard(fullPath)
  notify(`已复制路径：${fullPath}`)
}
// IDEA RefactorMenu: 移动文件 (Move File, F6) relocates the active file into
// another directory — file.rename moves across directories, open tabs are
// retitled, and the LSP document is re-opened by retitleTab.
async function moveActiveFile() {
  const tab = active.value
  if (!tab || !workspace.value) { notify('请先打开一个文件。', true); return }
  const target = window.prompt(`移动 ${tab.path} 到目录（工作区相对路径，如 src/main）：`, parentOf(tab.path))
  if (target === null) return
  const dir = target.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!dir || dir === parentOf(tab.path)) return
  if (dir.startsWith('/') || dir.includes('..')) { notify('目录必须是工作区内相对路径。', true); return }
  try {
    await request('file.create', { path: dir, directory: true })
  } catch { /* the directory may already exist */ }
  const destination = `${dir}/${baseName(tab.path)}`
  try {
    await renameEntryWithReferences(tab.path, destination)
    await refreshTree()
    notify(`已移动到 ${destination}`)
  } catch (error) { notify(errorMessage(error), true) }
}
// IDEA RefactorMenu: 复制文件 (Copy File, F5) — the copy lands next to the
// original under an IDEA-style "X copy.ext" name unless the user types one.
async function copyActiveFile() {
  const tab = active.value
  if (!tab || !workspace.value || !isDesktop) { notify('复制文件需要桌面端。', true); return }
  const suggested = copyCollisionName(name => workspace.value!.entries.some((entry: any) => entry.path === `${parentOf(tab.path)}/${name}`), baseName(tab.path))
  const input = window.prompt(`复制为（${parentOf(tab.path) || '项目根'} 下）：`, suggested)
  if (input === null) return
  const name = input.trim()
  if (!name || name === baseName(tab.path)) return
  const destination = parentOf(tab.path) ? `${parentOf(tab.path)}/${name}` : name
  try {
    await request('file.copy', { from: tab.path, to: destination })
    await refreshTree()
    notify(`已复制为 ${destination}`)
  } catch (error) { notify(errorMessage(error), true) }
}
// IDEA's Generate popup (Alt+Insert) filters the code actions down to source
// generations — constructors, getters/setters, toString, overrides, …; JDT LS
// publishes exactly those under kind `source.*`.
const GENERATE_WORDS = ['generate', 'override', 'implement', 'constructor', 'getter', 'setter', 'tostring', 'equals', 'hashcode', 'delegate', 'insert', '生成', '重写', '实现', '构造']
async function openGeneratePopup() {
  const tab = active.value
  if (!tab || !lspReady.value) { notify('生成功能需要语言服务器支持。', true); return }
  const cursor = editorFor(tab.path)?.getCursor() ?? { line: tab.line - 1, ch: 0 }
  try {
    const result = await request<LspCodeActionResults>('lsp.request', { kind: 'codeAction', path: tab.path, line: cursor.line, character: cursor.ch, diagnostics: [] })
    const actions = (result.actions ?? []).filter(action =>
      action.kind?.startsWith('source') || GENERATE_WORDS.some(word => action.title.toLowerCase().includes(word)))
    if (!actions.length) { notify('当前语言服务没有在该处提供生成选项。', true); return }
    codeActions.value = actions
    actionPrompt.value = { path: tab.path }
  } catch (error) { notify(errorMessage(error), true) }
}
// IDEA's refactor actions are code-action flows with a title filter (ExtractMethodAction
// offers "Extract Method"); JDT LS publishes them as refactor.* CodeActions, so the
// same Alt+Enter pipeline runs here with the titles narrowed to the requested kind.
const refactorTitles: Record<string, string[]> = {
  extractVariable: ['extract variable', '提取变量'],
  extractConstant: ['extract constant', 'extract field', '提取常量'],
  extractMethod: ['extract method', '提取方法'],
  inlineVariable: ['inline', '内联'],
}
async function runRefactorFlow(kind: keyof typeof refactorTitles, needSelection: boolean, label: string) {
  const tab = active.value
  if (!tab || !lspReady.value) { notify(`${label}需要语言服务器支持。`, true); return }
  const cursor = editorFor(tab.path)?.getCursor() ?? { line: tab.line - 1, ch: 0 }
  if (needSelection && !(editorFor(tab.path)?.hasSelection() ?? false)) {
    notify(`请先选中${label.replace('提取', '要提取的')}代码，再执行该重构。`, true)
    return
  }
  const diagnostics = (lspDiagnostics.get(tab.path) ?? []).filter(item => item.line === cursor.line).map(item => ({
    range: { start: { line: item.line, character: item.character }, end: { line: item.endLine ?? item.line, character: item.endCharacter ?? item.character } },
    severity: item.severity, message: item.message, ...(item.source ? { source: item.source } : {}) }))
  try {
    const result = await request<LspCodeActionResults>('lsp.request', { kind: 'codeAction', path: tab.path, line: cursor.line, character: cursor.ch, diagnostics })
    const wanted = refactorTitles[kind]
    const actions = (result.actions ?? []).filter(action =>
      action.kind?.startsWith('refactor') && wanted.some(word => action.title.toLowerCase().includes(word)))
    if (!actions.length) { notify(`语言服务在当前光标处没有提供「${label}」。`, true); return }
    if (actions.length === 1) { await applyCodeAction(actions[0]!); return }
    codeActions.value = actions
    actionPrompt.value = { path: tab.path }
  } catch (error) { notify(errorMessage(error), true) }
}
function extractVariable() { void runRefactorFlow('extractVariable', true, '提取变量') }
function extractConstant() { void runRefactorFlow('extractConstant', true, '提取常量') }
function extractMethod() { void runRefactorFlow('extractMethod', true, '提取方法') }
function inlineVariable() { void runRefactorFlow('inlineVariable', false, '内联') }
  return {
    copyFilePath, moveActiveFile, copyActiveFile, openGeneratePopup,
    refactorTitles, runRefactorFlow, extractVariable, extractConstant, extractMethod, inlineVariable,
  }
}
