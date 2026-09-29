// 剪贴板环的**宿主壳**：模块自持的单例 + 系统剪贴板读写 + 编辑器复制事件捕获。
// 纯逻辑（环的增删改、上限与清理、选择器的行渲染规则）都在 src/clipboardHistory.ts，那边没有 Vue 依赖、可直接单测。
import { computed, ref } from 'vue'
import { CLIPBOARD_MAX_ITEMS, CLIPBOARD_MAX_MEMORY, pushClipboardContent, removeClipboardContent,
         moveClipboardContentToTop, syncSystemClipboard, type ClipboardEntry } from './clipboardHistory'

export * from './clipboardHistory'

// ---------------------------------------------------------------------------
// 宿主通道：模块自持的环 + 系统剪贴板读写
// ---------------------------------------------------------------------------

/**
 * 进程内唯一的剪贴板环（对应 IDEA 的 `CopyPasteManager` 单例）。
 * 模块自持，App 只 import —— 所以**所有**复制路径都能喂到它，不需要把环通过 ctx 传一圈。
 */
export const clipboardRing = ref<ClipboardEntry[]>([])

/** 供 UI 直接渲染的行（文本 + 是否已被清除）。 */
export const clipboardEntries = computed(() => clipboardRing.value)

async function writeSystemClipboard(text: string): Promise<void> {
  try { await navigator.clipboard?.writeText(text) } catch { /* WebView2 里剪贴板可能不可用 */ }
}

async function readSystemClipboard(): Promise<string | null> {
  try { return await navigator.clipboard?.readText() ?? null } catch { return null }
}

/**
 * `CopyPasteManager.setContents`：写系统剪贴板 **并且** 压进环。
 * 仓库里原来散落的 `navigator.clipboard.writeText(...)` 都应走这里 —— 否则"复制路径/复制引用"
 * 这类 IDE 内部的复制不会进历史（源码里它们同样经过 `CopyPasteManager`）。
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (!text) return
  clipboardRing.value = pushClipboardContent(clipboardRing.value, text)
  await writeSystemClipboard(text)
}

/**
 * `getAllContents`：先同步系统剪贴板，再返回整环快照。
 * `PasteFromHistoryAction` 就是在弹出选择器**之前**调它，所以剪贴板里刚复制的东西也在列表里。
 */
export async function readClipboardHistory(): Promise<ClipboardEntry[]> {
  const current = await readSystemClipboard()
  clipboardRing.value = syncSystemClipboard(clipboardRing.value, current)
  return clipboardRing.value
}

/** `removeContent`：删掉某项；删的是表头时把系统剪贴板回落到新表头（与源码一致）。 */
export async function removeClipboardEntry(index: number): Promise<void> {
  const wasTop = index === 0
  const next = removeClipboardContent(clipboardRing.value, index)
  clipboardRing.value = next
  if (wasTop) await writeSystemClipboard(next[0]?.text ?? '')
}

/** `moveContentToStackTop`：被选中的项升到表头并成为系统剪贴板内容。 */
export async function promoteClipboardEntry(index: number): Promise<void> {
  const picked = clipboardRing.value[index]
  if (!picked) return
  clipboardRing.value = moveClipboardContentToTop(clipboardRing.value, index)
  await writeSystemClipboard(picked.text)
}

// 编辑器内的 Ctrl+C / Ctrl+X 由 src/editorClipboard.ts 的 DOM 通道接管（那里能实现
// IDEA 的"无选区复制整行"），本模块只保留非编辑器路径的 `copyToClipboard`。
