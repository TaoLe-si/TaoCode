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
         type LspSymbolsResult } from './bridge.ts'
import { buildDiffRows, generateUnifiedDiff } from './diffText.ts'
import { copyToClipboard } from './clipboard.ts'
import { createHoverCache } from './hoverDocumentation.ts'
import { createQuickDocHost } from './quickDocHost.ts'
import { errorMessage } from './errors.ts'
import { makeEditorConfigReader } from './codeStyleSettings.ts'
import { applySaveTextTransforms, offsetInText, saveTrimOptionsFor } from './editorSaveTransforms.ts'
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
  /** 快速文档弹层的内部链接导航（与 `App.vue` 的 `openDocumentLink` 同一条链）。 */
  revealLocation?: (target: { path: string; line: number }) => unknown
  /** 工作区根（内部链接的绝对路径要落回相对路径；落在外面就如实说明）。 */
  workspaceRoot?: () => string | undefined
}

export function createEditorFileOps(deps: EditorFileOpsDeps) {
  const { notify, isDesktop, active, findTab, editorFor, request, menu, editorSettings, bufferEpoch, lspReady,
          toggleReadOnly, treeMenu, revealLocation, workspaceRoot } = deps
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
//
// 取文档与弹层状态整块交给 `src/quickDocHost.ts`（签名/描述整形 → 区块/分节/链接/图片 →
// 前进后退历史 → 外部文档动作），这里只建宿主并把它的出口原样转发出去 —— 键位表
// （`src/keymap.ts:365` 的 `docs.quickDoc`）与代码菜单（`src/menus/codeMenu.ts:103`）
// 依赖的就是这组名字。渲染在 `src/components/QuickDocPopup.vue`。
//
// hover 结果的每文件缓存（HoverResultCache 的等价物，见 src/hoverDocumentation.ts）：
// 同一位置重复 Ctrl+Q 不再往返；文档版本变化或转脏时整文件失效（标记里带「版本:脏」）。
// 这张缓存建在这里再注入宿主（不建两张）—— tests/hover-documentation.test.mjs 钉着这一行。
const hoverCache = createHoverCache()
const quickDocHost = createQuickDocHost({
  notify, isDesktop, active, lspReady, menu,
  editorFor, request: request as EditorFileOpsDeps['request'],
  // 宿主没接这两条时如实降级：工作区根取不到 = 绝对路径按原样试（不硬转），
  // 导航回调缺失 = 弹层里的内部链接给一句「本宿主不支持跳转」而不是静默无反应。
  // 正常装配时 `App.vue` 会传真实实现（见报告里的接线请求）。
  revealLocation: revealLocation ?? (() => notify('本宿主没有接上内部链接跳转。', true)),
  workspaceRoot: workspaceRoot ?? (() => undefined),
  hoverCache,
})
const quickDoc = quickDocHost.quickDoc
const showQuickDoc = quickDocHost.showQuickDoc
const closeQuickDoc = quickDocHost.closeQuickDoc
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
// ---------------------------------------------------------------- 保存前的两条纯文本 pass
//
// IDEA 在 `beforeDocumentSaving` 里、**Actions on Save 之后**跑这一段
// （`FileDocumentManagerImpl.java:1214-1245` 的 multiCast 顺序：消息总线 → Actions on Save →
// `TrailingSpacesStripper`），执行体逐条在 `src/editorSaveTransforms.ts`。这里只做三件事：
// 凑齐 `.editorconfig` 的 reader（`file.read`）、把光标的行列换算成正文偏移、把标签页的只读档
// 交给上游那四道门。**没有落盘的键时全部落到上游默认档**（清「改动过的行」的行尾空白、
// 不补末行换行），所以这一条链路现在就是真的在执行，不是等键。
async function transformOnSave(tab: Tab, content: string) {
  const { options, enforcedRemoval } = await saveTrimOptionsFor({
    path: tab.path,
    root: workspaceRoot?.() ?? undefined,
    // 落盘的两条 pass 读的是设置那三格（IDEA `EditorSettingsExternalizable.java:73/74/142`，
    // 默认 `Changed` / false / true）；旧存档缺键时 `editor_defaults_impl()` 已经按同一套默认补齐，
    // 所以这里不需要再造一层回落。
    settings: {
      stripTrailingSpaces: editorSettings.value.stripTrailingSpaces,
      ensureNewLineAtEof: editorSettings.value.ensureNewLineAtEof,
      keepTrailingSpacesOnCaretLine: editorSettings.value.keepTrailingSpacesOnCaretLine,
    },
    read: isDesktop ? makeEditorConfigReader(path => request<DocumentData>('file.read', { path })) : undefined,
  })
  const cursor = editorFor(tab.path)?.getCursor()
  return applySaveTextTransforms({
    path: tab.path,
    text: content,
    savedText: tab.content,
    options,
    enforcedRemoval,
    caretOffsets: cursor ? [offsetInText(content, cursor.line, cursor.ch)] : undefined,
    // 上游 getOptions 的门（`TrailingSpacesStripper.java:295-322`）在本仓的对应物。
    writable: !tab.readOnly,
    backedByFile: isDesktop,
  })
}
  return {
    conflictPrompt, conflictDiff, showConflictDiff, resolveConflictReload, resolveConflictKeep,
    quickDoc, showQuickDoc, closeQuickDoc, copyReference, showFileProperties,
    convertIndents, convertLineSeparators, encodingPrompt, encodingSelect, openEncoding,
    reloadWithEncoding, applyEncodingChoice,
    // 保存前 pass（`App.vue` 的 `save()` 在 `runActionsOnSave` 之后调，整段可照抄：接线请求里给）。
    transformOnSave,
    // 快速文档弹层的新出口（前进/后退、外部文档动作、内部链接、图片解析）。
    // 转发宿主而不是让 App.vue 直接建宿主，是为了 `showQuickDoc` 仍只有一处装配。
    quickDocGoBackward: quickDocHost.goBackward,
    quickDocGoForward: quickDocHost.goForward,
    quickDocCanBackward: quickDocHost.canGoBackward,
    quickDocCanForward: quickDocHost.canGoForward,
    quickDocOpenExternal: quickDocHost.openExternalDoc,
    quickDocCanOpenExternal: quickDocHost.canOpenExternalDoc,
    quickDocFollowLink: quickDocHost.followInternalDocLink,
    quickDocResolveImage: quickDocHost.resolveImage,
  }
}
