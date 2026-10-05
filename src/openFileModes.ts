// 逐文件的**首选打开模式**记忆（上游 `platform/platform-impl/src/com/intellij/openapi/fileEditor/impl/`）。
//
// 上游两件东西合起来才有这个行为：
//   · `FileEditorManagerImpl.OpenMode`（`FileEditorManagerImpl.kt:217-219`）= `NEW_WINDOW | RIGHT_SPLIT |
//     DEFAULT`：**同一个文件上次是在哪儿打开的**（新窗口 / 右侧分屏 / 默认位置）；
//   · `FileEditorStateWithPreferredOpenMode`（`FileEditorStateWithPreferredOpenMode.kt:8-10`）把这个
//     openMode 挂在文件状态上，随 `FileEditorManagerImpl` 存进项目的 `workspace.xml`
//     （`FileEditorManagerImpl.kt:208-209` 的 `@State(name = "FileEditorManager", storages = [PRODUCT_WORKSPACE_FILE])`，
//     即**漫游**、按项目分文件），恢复时由 `IdeDocumentHistoryImpl.getOpenMode()`（`IdeDocumentHistoryImpl.kt:716-719`）
//     从条目上取回来。
//
// 本仓的等价物：编辑器只有一个窗口、也没有"右侧分屏打开"这个动作，唯一存在的"同一文件的另一种
// 打开方式"是 **Markdown 预览**（`FileEditorProvider` 那条轴：文本编辑器 ↔ 预览）。
// 之前它是**一个会话级布尔**（`App.vue` 的 `markdownPreviewOn`），从 A.md 切到 B.md 时跟着切、
// 关掉再打开也不记得。这里把「用户为某个文件选过的模式」按 (项目根, 路径) 记住：
// 没选过 = 文件类型的默认（源文件），选过 = 那个选择。存储用 `localStorage`，与
// `src/largeFileNotice.ts` 的持久化同一套口径（隐私模式写不进去时只在本次会话内有效）。
import { ref } from 'vue'

/** 一个文件能被记住的打开方式（上游 `OpenMode` 的三档在单窗口仓里只剩这一根轴）。 */
export type FileOpenMode = 'editor' | 'preview'

/** 持久化键（上游那份 workspace.xml 的前端等价物）。 */
export const OPEN_MODES_KEY = 'taocode.fileOpenModes.v1'

export interface OpenModeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 浏览器/测试环境共用的取用方式（没有 localStorage 时退化成"永不记住"）。 */
export function openModeStorage(): OpenModeStorage | null {
  try {
    const storage = (globalThis as { localStorage?: OpenModeStorage }).localStorage
    return storage ?? null
  } catch { return null }
}

/**
 * 上游的表是**按项目**存的（workspace.xml 在项目目录下），所以键里带项目根 ——
 * 否则两个项目里同名的 `README.md` 会互相污染。
 */
export function openModeKey(root: string, path: string): string {
  return `${root.replace(/\\/g, '/').replace(/\/+$/, '')}\n${path.replace(/\\/g, '/')}`
}

function isFileOpenMode(value: unknown): value is FileOpenMode {
  return value === 'editor' || value === 'preview'
}

/**
 * 读回那张表。坏 JSON、坏形状、坏键值一律**当空表**（`largeFileNotice` 的口径：
 * 记住的东西是加速项，读不出来不该把界面卡住）；条目上限与 key 长度也在这里拦。
 */
export function readOpenModes(storage: OpenModeStorage | null = openModeStorage()): Record<string, FileOpenMode> {
  if (!storage) return {}
  let raw: string | null = null
  try { raw = storage.getItem(OPEN_MODES_KEY) } catch { return {} }
  if (!raw) return {}
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return {} }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: Record<string, FileOpenMode> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!key || key.length > 1024 || !isFileOpenMode(value)) continue
    out[key] = value
  }
  return out
}

/** 整表落盘（一次写入，别每改一条写一次）。 */
export function writeOpenModes(modes: Record<string, FileOpenMode>, storage: OpenModeStorage | null = openModeStorage()): void {
  if (!storage) return
  try { storage.setItem(OPEN_MODES_KEY, JSON.stringify(modes)) } catch { /* 隐私模式/超配额：退化成会话内记忆 */ }
}

/** 记一个文件上次用的模式（`EditorFileStateWithPreferredOpenMode` 的「用户选过的那次」）。 */
export function rememberOpenMode(root: string, path: string, mode: FileOpenMode, storage: OpenModeStorage | null = openModeStorage()): Record<string, FileOpenMode> {
  const next = { ...readOpenModes(storage), [openModeKey(root, path)]: mode }
  writeOpenModes(next, storage)
  return next
}

/** 忘掉一个文件的选择（回到文件类型的默认：源文件）。 */
export function forgetOpenMode(root: string, path: string, storage: OpenModeStorage | null = openModeStorage()): Record<string, FileOpenMode> {
  const table = readOpenModes(storage)
  delete table[openModeKey(root, path)]
  writeOpenModes(table, storage)
  return table
}

/** 纯读：没有为这个文件选过就返回 null（调用方按文件类型默认渲染）。 */
export function preferredOpenMode(root: string, path: string, storage: OpenModeStorage | null = openModeStorage()): FileOpenMode | null {
  return readOpenModes(storage)[openModeKey(root, path)] ?? null
}

// —— 响应式门面（宿主与编辑器侧视图都经它读写，与 sessionSnapshot/largeFileNotice 的模块级状态同一路子）——
const modes = ref<Record<string, FileOpenMode>>({})
let loaded = false

/** 首次读盘时惰性装载（模块 import 不碰存储，测试里直接换 storage 更容易）。 */
export function loadOpenModes(storage: OpenModeStorage | null = openModeStorage()): void {
  modes.value = readOpenModes(storage)
  loaded = true
}

/** 这个文件记住了吗（没记住 = 默认模式）。 */
export function openModeOf(root: string | undefined, path: string | undefined): FileOpenMode | null {
  if (!path) return null
  if (!loaded) loadOpenModes()
  return modes.value[openModeKey(root ?? '', path)] ?? null
}

/** 记一次选择；`null` = 忘掉（回到默认）。根/路径为空时不记（没有文件可记）。 */
export function setOpenMode(root: string | undefined, path: string | undefined, mode: FileOpenMode | null): void {
  if (!path) return
  if (!loaded) loadOpenModes()
  const key = openModeKey(root ?? '', path)
  if ((modes.value[key] ?? null) === mode) return   // 没有变化就不落盘（切到非 md 文件时的空写在这里被挡掉）
  const next = { ...modes.value }
  if (mode === null) delete next[key]
  else next[key] = mode
  modes.value = next
  writeOpenModes(next)
}

/** 换项目/清状态时复位（下一步读盘会重新装载）。 */
export function resetOpenModes(): void {
  modes.value = {}
  loaded = false
}
