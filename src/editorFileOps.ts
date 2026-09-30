// 编辑器的**文件级操作** —— 从 App.vue 搬出的一域（172 行，15 个依赖）。
//
// 判据：这一组动作都作用于「整个文件」而不是光标处的符号，而且都要**重读或重写磁盘**：
//   · 保存冲突（IDEA 的 `SaveDocument` 冲突对话框：预览差异 / 重新载入 / 保留内存版本）；
//   · 快速文档（Ctrl+Q，`HoverInfoComponent`）与复制引用（Ctrl+Alt+Shift+C，`CopyReferenceAction`）；
//   · 文件属性（IDEA 的 `FilePropertiesGroup` popup：只读那一项由文件树右键驱动）；
//   · 缩进转换（`ConvertIndentsGroup`）、行尾转换（`ConvertToWindows/UnixLineSeparatorsAction`）、
//     编码重读/改写保存（IDEA 的 `ReloadWithEncoding` / `ChangeFileEncoding`）。
// 共同点：改完都要把结果推回编辑器缓冲（`editorFor(...).setDraft`）并通知语言服务（`lsp.change`），
// 所以它们共享 `editorFor` / `request` 这两条链路，合成一域。
import { nextTick, ref } from 'vue'
import { encodingLabels, request, type DiffRow, type DocumentData, type EncodingKey, type LspHoverResult,
         type LspSymbolsResult } from './bridge'
import { buildDiffRows, generateUnifiedDiff } from './diffText'
import { copyToClipboard } from './clipboard'
import { errorMessage } from './errors'
import type { EditorHandle, Tab } from './editorTab'

export interface EditorFileOpsDeps {
  notify: (message: string, error?: boolean) => void
  isDesktop: boolean
  active: { readonly value: Tab | undefined }
  findTab: (path: string) => Tab | undefined
  editorFor: (path: string) => EditorHandle | undefined
  request: typeof request
  menu: any
  editorSettings: any
  bufferEpoch: any
  lspReady: { readonly value: boolean }
  /** 文件树右键的「切换只读」（`toggleReadOnly`）。 */
  toggleReadOnly: (path: string) => unknown
  /** 行尾转换后要整表重挂编辑器缓冲（宿主是 `ref`）。 */
  buffer: () => any
  /** 文件树右键菜单坐标（由文件树模块自持），只读它的 entry。 */
  treeMenu: { value: any }
}

export function createEditorFileOps(deps: EditorFileOpsDeps) {
  const { notify, isDesktop, active, findTab, editorFor, request, menu, editorSettings, bufferEpoch, lspReady,
          toggleReadOnly, treeMenu } = deps
const conflictPrompt = ref<{ path: string } | null>(null)
// IDEA's conflict dialog shows what actually differs before you choose; this
// preview is the disk version (left) against the live buffer (right).
const conflictDiff = ref<{ rows: DiffRow[]; unified: string } | null>(null)
async function showConflictDiff() {
  const target = conflictPrompt.value
  if (!target) return
  const tab = findTab(target.path)
  if (!tab) return
  try {
    const doc = await request<DocumentData>('file.read', { path: target.path, encoding: tab.encoding })
    const diskLines = doc.content.split('\n')
    const bufferLines = (editorFor(target.path)?.text() ?? tab.content).split('\n')
    conflictDiff.value = { rows: buildDiffRows(diskLines, bufferLines), unified: generateUnifiedDiff(diskLines, bufferLines) }
  } catch (error) { notify(errorMessage(error), true) }
}
async function resolveConflictReload() {
  const target = conflictPrompt.value
  conflictPrompt.value = null
  conflictDiff.value = null
  if (!target) return
  const tab = findTab(target.path)
  if (!tab || !isDesktop) return
  try {
    const doc = await request<DocumentData>('file.read', { path: tab.path, encoding: tab.encoding })
    Object.assign(tab, { content: doc.content, version: doc.version, encoding: doc.encoding, bom: doc.bom, dirty: false })
    editorFor(tab.path)?.setDraft(doc.content)
    if (tab.lspRunning) void request('lsp.change', { path: tab.path, text: doc.content }).catch(() => undefined)
    notify(`已重新载入磁盘上的 ${tab.path}`)
  } catch (error) { notify(errorMessage(error), true) }
}
function resolveConflictKeep() {
  const target = conflictPrompt.value
  conflictPrompt.value = null
  conflictDiff.value = null
  if (target) notify(`已保留 ${target.path} 的当前修改；外部改动不会被覆盖，下次保存前请先自行核对。`)
}
// IDEA's Quick Documentation (Ctrl+Q): fetches hover at the caret and shows it in a
// persistent popup instead of the transient tooltip. The popup closes on Escape or
// any click outside, matching IDEA's own dismiss behavior.
const quickDoc = ref<{ contents: string; x: number; y: number } | null>(null)
async function showQuickDoc() {
  const tab = active.value
  if (!tab || !lspReady.value) { notify('请先打开一个有语言服务的文件。', true); return }
  menu.value = null
  const editor = editorFor(tab.path)
  if (!editor) return
  const pos = editor.getCursor()
  try {
    const result = await request<LspHoverResult>('lsp.request', { kind: 'hover', path: tab.path, line: pos.line, character: pos.ch })
    if (!result.available || !result.contents) { notify('此处没有文档。', true); return }
    const rect = editorFor(tab.path)?.getCursorCoords()
    quickDoc.value = { contents: result.contents, x: rect?.left ?? 200, y: rect?.bottom ?? 200 }
  } catch (error) { notify(errorMessage(error), true) }
}
function closeQuickDoc() { quickDoc.value = null }
// IDEA's Copy Reference (Ctrl+Alt+Shift+C): copies the qualified name of the symbol
// at the caret when LSP provides it, otherwise copies the file path.
async function copyReference() {
  const tab = active.value
  if (!tab) return
  menu.value = null
  try {
    if (lspReady.value) {
      const editor = editorFor(tab.path)
      if (editor) {
        const pos = editor.getCursor()
        const symbols = await request<LspSymbolsResult>('lsp.request', { kind: 'documentSymbol', path: tab.path })
        if (symbols.available && symbols.symbols) {
          const match = symbols.symbols.find(s => 'startLine' in s && s.startLine === pos.line)
          if (match) { void copyToClipboard(match.name); notify(`已复制：${match.name}`); return }
        }
      }
    }
    void copyToClipboard(tab.path)
    notify(`已复制路径：${tab.path}`)
  } catch { notify('无法复制到剪贴板。', true) }
}
// IDEA has no "File Properties" dialog — the file's attributes live in the
// FilePropertiesGroup popup (encoding, file type, read-only, line separators), so
// the tree row toggles the one attribute with a backend here.
async function showFileProperties() {
  const entry = treeMenu.value?.entry
  if (!entry) return
  if (entry.kind !== 'file') { treeMenu.value = null; notify('目录没有只读属性操作。'); return }
  await toggleReadOnly(entry.path)
}
// ConvertToWindows/UnixLineSeparatorsAction: rewrite the file on disk with every line
// ending normalized, then reload the buffer (IDEA refreshes the document too). The
// native side refuses a locked or externally modified file before touching anything.
// EditMenu › ConvertIndentsGroup（`<group id="ConvertIndentsGroup" popup="true">`，
// PlatformActions.xml:500-505）：IDEA 的 Convert Indents to Spaces / to Tabs，作用于**全文件**。
// 纯文本变换：前导空白按当前 tabSize 在空格与制表符之间折算（已有 tab 先按宽度展开再重算列数），
// 不需要语言服务与原生参与；与格式化相同只改缓冲并标脏，由用户 Ctrl+S 保存。
function convertIndents(mode: 'spaces' | 'tabs') {
  const tab = active.value
  const editor = tab ? editorFor(tab.path) : undefined
  if (!tab || !editor) { notify('请先打开一个文件。', true); return }
  const width = Math.max(1, editorSettings.value.tabSize)
  const text = editor.text()
  const converted = text.split('\n').map(line => {
    const indent = /^[ \t]*/.exec(line)?.[0] ?? ''
    if (!indent) return line
    const columns = indent.replace(/\t/g, ' '.repeat(width)).length
    if (mode === 'tabs') return '\t'.repeat(Math.floor(columns / width)) + ' '.repeat(columns % width) + line.slice(indent.length)
    return ' '.repeat(columns) + line.slice(indent.length)
  }).join('\n')
  if (converted === text) { notify(mode === 'tabs' ? '缩进已经是制表符，无需转换。' : '缩进已经是空格，无需转换。'); return }
  editor.setDraft(converted)
  tab.dirty = true
  if (tab.lspRunning) void request('lsp.change', { path: tab.path, text: converted }).catch(() => undefined)
  notify(mode === 'tabs' ? '已将缩进转换为制表符（未保存），检查后按 Ctrl+S 保存。' : '已将缩进转换为空格（未保存），检查后按 Ctrl+S 保存。')
}
async function convertLineSeparators(separator: 'crlf' | 'lf', target?: Tab) {
  const tab = target ?? active.value
  if (!tab) { notify('请先打开一个文件。', true); return }
  menu.value = null
  treeMenu.value = null
  if (!isDesktop) { notify('行分隔符转换需要桌面端。', true); return }
  if (tab.dirty) { notify('请先保存修改，再转换行分隔符。', true); return }
  try {
    const result = await request<{ path: string; version: string; changed: boolean }>('file.lineSeparators',
      { path: tab.path, separator, content: editorFor(tab.path)?.text() ?? tab.content, expectedVersion: tab.version })
    if (!result.changed) { notify(`${tab.path} 已经全部是${separator === 'crlf' ? ' Windows (CRLF)' : ' Unix (LF)'}行尾，无需转换。`); return }
    // Reload from disk so the buffer carries the file's own separators — CodeMirror
    // splits with EditorState.lineSeparator and would otherwise re-save LF.
    const doc = await request<DocumentData>('file.read', { path: tab.path, encoding: tab.encoding })
    Object.assign(tab, { content: doc.content, version: doc.version, readOnly: doc.readOnly })
    // CodeMirror splits the document with EditorState.lineSeparator only at state
    // creation, so a separator-only change needs one remount to show CRLF again.
    bufferEpoch.value++
    if (tab.lspRunning) void request('lsp.change', { path: tab.path, text: doc.content }).catch(() => undefined)
    notify(`已将 ${tab.path} 转换为${separator === 'crlf' ? ' Windows (CRLF)' : ' Unix and macOS (LF)'}行尾`)
  } catch (error) { notify(errorMessage(error), true) }
}
// IDEA's two encoding actions: re-read the same bytes under another code page (writes
// nothing), or keep the buffer text and rewrite the file in another encoding.
const encodingPrompt = ref<{ encoding: EncodingKey; bom: boolean } | null>(null)
const encodingSelect = ref<HTMLSelectElement>()
function openEncoding() {
  const tab = active.value
  if (!tab) { notify('请先打开一个文件。', true); return }
  menu.value = null
  encodingPrompt.value = { encoding: tab.encoding, bom: tab.bom }
  void nextTick(() => encodingSelect.value?.focus())
}
async function reloadWithEncoding() {
  const tab = active.value, choice = encodingPrompt.value
  if (!tab || !choice || tab.dirty) return
  try {
    const doc = await request<DocumentData>('file.read', { path: tab.path, encoding: choice.encoding })
    // A re-read can land on a file that was locked meanwhile; refresh the flag too.
    Object.assign(tab, { content: doc.content, version: doc.version, encoding: doc.encoding, bom: doc.bom, readOnly: doc.readOnly, dirty: false })
    editorFor(tab.path)?.setReadOnly(Boolean(doc.readOnly))
    editorFor(tab.path)?.setDraft(doc.content)
    if (isDesktop) void request('lsp.change', { path: tab.path, text: doc.content }).catch(() => undefined)
    encodingPrompt.value = null
    notify(`已按 ${encodingLabels[doc.encoding]} 重新读取 ${tab.path}`)
  } catch (error) { notify(errorMessage(error), true) }
}
function applyEncodingChoice() {
  const tab = active.value, choice = encodingPrompt.value
  if (!tab || !choice) return
  tab.encoding = choice.encoding
  tab.bom = choice.bom
  // The text is unchanged; marking the buffer dirty is what makes the next save write
  // the same characters back as new bytes.
  tab.dirty = true
  encodingPrompt.value = null
  notify(`已切换为 ${encodingLabels[choice.encoding]}${choice.bom ? '（带 BOM）' : ''}，保存时按该编码写入 ${tab.path}`)
}
  return {
    conflictPrompt, conflictDiff, showConflictDiff, resolveConflictReload, resolveConflictKeep,
    quickDoc, showQuickDoc, closeQuickDoc, copyReference, showFileProperties,
    convertIndents, convertLineSeparators, encodingPrompt, encodingSelect, openEncoding,
    reloadWithEncoding, applyEncodingChoice,
  }
}
