// 粘贴动作 —— IDEA `$Paste` / `EditorPasteSimple` / `PasteMultiple` 三条入口的宿主侧实现。
//
// 对照源码（`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · `$Paste` = `platform/platform-impl/src/com/intellij/ide/actions/PasteAction.java`（交给编辑器的粘贴提供者）
//   · `EditorPasteSimple` = `platform/platform-impl/src/com/intellij/openapi/editor/actions/SimplePasteAction.java`
//     → `BasePasteHandler`（**不做**粘贴后处理，也不记 `LAST_PASTED_REGION`）
//   · `PasteMultiple` = `platform/platform-impl/src/com/intellij/openapi/editor/actions/PasteFromHistoryAction.java`
//     - `:97-107` `ClipboardContentChooser`：标题 `choose.content.to.paste.dialog.title`、多选、可删除
//     - `:109-130` 选定项：**唯一一项**升到栈顶（`moveContentToStackTop`），多项则把拼接文本写回剪贴板
//     - `:132-135` 空列表时直接取消，不弹窗
//   · 粘贴后处理 `platform/lang-impl/.../PasteHandler.java:247-303`：按 `REFORMAT_ON_PASTE` 决定
//     交给谁重新缩进/格式化（规则见 src/pasteOptions.ts）
// 历史环本身在 src/clipboard.ts（`CopyPasteManagerWithHistory` 的对应物）。
import { ref } from 'vue'
import { clipboardRing, promoteClipboardEntry, readClipboardHistory, removeClipboardEntry, type ClipboardEntry } from './clipboard'
import { PASTE_REFORMAT_NONE, indentPlainTextBlock, isPasteReformatMode, pasteReformatAction } from './pasteOptions'
import type { PasteInsertion } from './editorPaste'
import type { LspRange } from './bridge'
import type { Tab } from './editorTab'

export interface PasteActionsDeps {
  notify: (message: string, error?: boolean) => void
  active: { readonly value: Tab | undefined }
  editorFor: (path: string) => any
  /** 语言服务是否可用（决定"有/没有格式化器"这一档）。 */
  lspOn: (tab: Tab) => boolean
  editorSettings: { readonly value: { reformatOnPaste?: string } }
  /** 把一段范围交给语言服务格式化（`lsp.request` 的 `rangeFormatting`，见 semanticActions.runFormatting）。 */
  runFormatting: (path: string, range?: LspRange) => Promise<void>
}

export function createPasteActions(deps: PasteActionsDeps) {
  const { notify, active, editorFor, lspOn, editorSettings, runFormatting } = deps
  const pasteHistoryOpen = ref(false)
  const pasteHistoryEntries = ref<ClipboardEntry[]>([])

  /** 当前生效档位：设置里是字符串，读回来先过校验（不认识的退回默认）。 */
  function currentMode(reformat: boolean) {
    if (!reformat) return PASTE_REFORMAT_NONE
    const raw = editorSettings.value.reformatOnPaste
    return isPasteReformatMode(raw) ? raw : PASTE_REFORMAT_NONE
  }

  /**
   * 粘贴后处理（`PasteHandler.java:288-303` + `DefaultTypingActionsExtension.java:118-124`）：
   * 有语言服务 → 把刚插入的那一段交给 `rangeFormatting`；没有 → 只有"整块缩进"这一档能走纯文本路径。
   */
  async function applyPostProcessing(tab: Tab, editor: any, insertion: PasteInsertion, pasted: string, reformat: boolean) {
    const action = pasteReformatAction(currentMode(reformat), lspOn(tab))
    if (action === 'none') return
    if (action === 'plainIndent') {
      const indented = indentPlainTextBlock(pasted, insertion.anchorColumn, insertion.caretLineIsLast)
      if (indented !== pasted) editor?.replaceRange(insertion.from, insertion.to, indented)
      return
    }
    await runFormatting(tab.path, insertion.range)
  }

  /** 把文本插到活动编辑器光标处，然后按设置做粘贴后处理。 */
  async function pasteText(text: string, reformat: boolean) {
    const tab = active.value
    const editor = tab ? editorFor(tab.path) : undefined
    if (!tab || !editor) { notify('请先打开一个文件再粘贴。', true); return }
    const insertion = editor.insertText(text)
    if (!insertion) return
    await applyPostProcessing(tab, editor, insertion, text, reformat)
  }

  /** 「粘贴」（`$Paste`）：系统剪贴板 → 光标处，走粘贴后处理。 */
  async function pasteFromSystemClipboard() {
    const text = await readText()
    if (!text) { notify('剪贴板里没有文本。', true); return }
    await pasteText(text, true)
  }

  /**
   * 「粘贴为纯文本」（`EditorPasteSimple` → `BasePasteHandler`）：
   * 同一次插入，但**不做**粘贴后处理 —— 这就是源码里这两条动作的全部差别。
   */
  async function pasteAsPlainText() {
    const text = await readText()
    if (!text) { notify('剪贴板里没有文本。', true); return }
    await pasteText(text, false)
  }

  /**
   * 「从历史粘贴…」（`PasteMultiple`）：
   * `getAllContents()` 先把系统剪贴板同步进环，空列表直接返回（源码 `:132-135` 也不弹窗）。
   */
  async function openPasteHistory() {
    const entries = await readClipboardHistory()
    if (!entries.length) { notify('剪贴板历史为空。', true); return }
    pasteHistoryEntries.value = entries
    pasteHistoryOpen.value = true
  }

  /** 选中一项：升到栈顶（`moveContentToStackTop`）→ 写回系统剪贴板 → 粘贴。 */
  async function pickPasteHistoryEntry(index: number) {
    const entry = pasteHistoryEntries.value[index]
    pasteHistoryOpen.value = false
    if (!entry) return
    await promoteClipboardEntry(index)
    await pasteText(entry.text, true)
  }

  /** 删除一项（`removeContent`）；删空后关闭选择器。 */
  async function removePasteHistoryEntry(index: number) {
    await removeClipboardEntry(index)
    pasteHistoryEntries.value = [...clipboardRing.value]
    if (!pasteHistoryEntries.value.length) pasteHistoryOpen.value = false
  }

  /** 编辑器自己吃掉的 Ctrl+V / 右键粘贴：文本已插入，这里只补粘贴后处理。 */
  async function onEditorPaste(payload: { info: PasteInsertion; text: string }) {
    const tab = active.value
    if (!tab) return
    await applyPostProcessing(tab, editorFor(tab.path), payload.info, payload.text, true)
  }

  async function readText(): Promise<string> {
    try { return (await navigator.clipboard?.readText()) ?? '' } catch { return '' }
  }

  return {
    pasteHistoryOpen, pasteHistoryEntries,
    pasteFromSystemClipboard, pasteAsPlainText, openPasteHistory, pickPasteHistoryEntry, removePasteHistoryEntry,
    onEditorPaste,
  }
}
