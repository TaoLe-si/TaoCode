// 书签（IDEA 的 Toggle Bookmark / 助记符 / 循环跳转）—— 从 App.vue 搬出的一域（73 行，9 个依赖）。
//
// 判据：书签表 + 助记符提示 + 四处跳转/增删自成一体；它**不**负责渲染（那是模板与 gutter 的事），
// 也不负责持久化格式（那是 `src/bookmarksView.ts` 与设置）。
// `bookmarks` 的 ref 由本模块创建，宿主通过返回值拿它（模板与状态栏都要读）。
import { computed, ref, watch, type Ref } from 'vue'
import { request } from './bridge'
import { errorMessage } from './errors'
import { bookmarkAnchor, bookmarkOwner, nextBookmark as nextInList, placeBookmark, reconcileBookmarks, removeBookmark, sortedBookmarks } from './bookmarks'
import { type Bookmark, type ProjectSettings, type Workspace } from './bridge'

export interface BookmarkActionsDeps {
  notify: (message: string, error?: boolean) => void
  /** 桌面端才有原生剪贴板/对话框。 */
  isDesktop: boolean
  menu: Ref<string | null>
  projectSettings: Ref<ProjectSettings>
  workspace: Ref<Workspace | null>
  /** 当前标签（只读）。 */
  active: { readonly value: { path: string; line: number } | undefined }
  /** 语言名（模板里显示用）。 */
  language: Ref<string>
  baseName: (path: string) => string
  /** 记入"最近位置"环（IDEA 的 InFileRecentPlaces）。 */
  rememberPlace: (entry: any) => void
  /** 某个文件**当前**的编辑器内容（编辑器里改了还没保存时 `tab.content` 是旧的）。 */
  editorContent?: (path: string) => string | undefined
  /** 编辑器里当前选中的文本（上游 F11 用它当自定义描述，见 Bookmark.description）。 */
  selection?: (path: string) => string | undefined
  revealLocation: (target: { path: string; line: number }) => unknown
}

/**
 * 编辑后对账的入口：编辑器内容一变就调它（`src/lspNavigation.ts` 的 `onEditorChange`）。
 * 为什么是模块级的：对账要的是"当前内容"，而宿主那边的变更回调在自己的一域里 ——
 * 为这一行去改 App.vue（贴着机检上限）不划算。`createBookmarkActions` 建实例时把实现挂上。
 */
let contentChanged: ((path: string, content: string) => void) | undefined
export function notifyEditorContentChanged(path: string, content: string): void {
  contentChanged?.(path, content)
}

export function createBookmarkActions(deps: BookmarkActionsDeps) {
  const isDesktop = deps.isDesktop
  const { menu, projectSettings, workspace, active, language, baseName, rememberPlace, revealLocation } = deps
  const bookmarks = ref<Bookmark[]>([])
  const sortedAll = computed(() => sortedBookmarks(bookmarks.value))
  const bookmarkLines = computed(() => {
    const map: Record<string, number[]> = {}
    for (const entry of bookmarks.value) (map[entry.path] ??= []).push(entry.line)
    return map
  })
  const mnemonicPrompt = ref<{ path: string; line: number } | null>(null)
  // 行号越界被删掉的书签（会话内）。上游的 `myDeletedDocumentBookmarks` 也不进持久化状态
  // （`getState()` 只给书签表），撤销时按"同一行号 + 同一行原文"放回去。
  let dropped: Bookmark[] = []
  function reconcile(path: string, content: string) {
    const next = reconcileBookmarks(bookmarks.value, path, content, dropped)
    dropped = next.dropped
    const changed = next.list.length !== bookmarks.value.length
      || next.list.some((entry, index) => entry.path !== bookmarks.value[index]?.path || entry.line !== bookmarks.value[index]?.line
        || entry.mnemonic !== bookmarks.value[index]?.mnemonic || entry.text !== bookmarks.value[index]?.text)
    if (!changed) return
    bookmarks.value = next.list
    persistBookmarks()
  }
  contentChanged = reconcile
  const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
  let bookmarkSave: number | undefined
  function useProjectSettings(settings: ProjectSettings) {
    if (bookmarkSave) { window.clearTimeout(bookmarkSave); bookmarkSave = undefined }
    projectSettings.value = settings
    bookmarks.value = settings.bookmarks
  }
  function persistBookmarks() {
    if (!isDesktop || !workspace.value) return
    if (bookmarkSave) window.clearTimeout(bookmarkSave)
    bookmarkSave = window.setTimeout(() => {
      bookmarkSave = undefined
      if (!workspace.value) return
      void request<{ settings: ProjectSettings }>('project.settings.update', { bookmarks: bookmarks.value })
        .then(result => { projectSettings.value = result.settings })
        .catch(error => deps.notify(`书签未能保存：${errorMessage(error)}`, true))
    }, 600)
  }
  function placeAt(path: string, line: number, mnemonic?: number, content?: string, description?: string) {
    const lineText = content === undefined ? undefined : bookmarkAnchor(content.split(String.fromCharCode(10))[line - 1] ?? '')
    bookmarks.value = placeBookmark(bookmarks.value, path, line, mnemonic, lineText, description)
    const keptEntry = bookmarks.value.find(entry => entry.path === path && entry.line === line)
    if (keptEntry) rememberPlace({ kind: '书签', path, line: line - 1, label: keptEntry.mnemonic === undefined ? baseName(path) + ':' + line : `${keptEntry.mnemonic} · ${baseName(path)}:${line}` })
    const kept = bookmarks.value.find(entry => entry.path === path && entry.line === line)
    deps.notify(kept ? (kept.mnemonic === undefined ? `书签 ${path}:${line}` : `书签 ${path}:${line} 编号 ${kept.mnemonic}（Ctrl+${kept.mnemonic} 跳转）`) : `已取消书签 ${path}:${line}`)
    persistBookmarks()
  }
  function toggleBookmark(mnemonic?: number) {
    const tab = active.value
    if (!tab) return
    // 放书签时把那一行原文一起记下（上游的 `myBeforeChangeData` 记的是同一个东西，只是记在变更前）。
    // 选中了一段非空白文字时，那段的文本成为这条书签的**自定义描述**
    // （`ToggleBookmarkAction.addSingleBookmark:88-93`：`selectedText` 非空白 → `group.setDescription`）。
    const selected = deps.selection?.(tab.path)
    placeAt(tab.path, tab.line, mnemonic, deps.editorContent?.(tab.path), selected && selected.trim() ? selected : undefined)
  }
  function openMnemonicPrompt() {
    const tab = active.value
    if (!tab) return
    menu.value = null
    mnemonicPrompt.value = { path: tab.path, line: tab.line }
  }
  function pickMnemonic(digit: number) {
    const at = mnemonicPrompt.value
    if (!at) return
    mnemonicPrompt.value = null
    placeAt(at.path, at.line, digit)
  }
  function jumpMnemonic(digit: number) {
    const found = bookmarkOwner(bookmarks.value, digit)
    if (!found) { deps.notify(`没有编号 ${digit} 的书签（Ctrl+F11 可以贴编号）。`, true); return }
    void revealLocation({ path: found.path, line: found.line - 1 })
  }
  // IDEA walks the whole project, not just the open file, and wraps around.
  function cycleBookmark(reverse: boolean) {
    const tab = active.value
    const target = nextInList(bookmarks.value, tab?.path ?? '', tab?.line ?? 0, reverse)
    if (!target) { deps.notify(bookmarks.value.length ? '只有这一个书签。' : '还没有书签：F11 标记当前行，Ctrl+F11 编号。', true); return }
    void revealLocation({ path: target.path, line: target.line - 1 })
  }
  function dropBookmark(entry: Bookmark) {
    bookmarks.value = removeBookmark(bookmarks.value, entry)
    persistBookmarks()
  }
  function mnemonicOwner(digit: number) {
    const found = bookmarkOwner(bookmarks.value, digit)
    return found ? `${found.path.split('/').pop()}:${found.line}` : '—'
  }

  return {
    bookmarks, sortedAll, bookmarkLines, mnemonicPrompt, placeAt, toggleBookmark, openMnemonicPrompt, pickMnemonic,
    // 下面三个是宿主别处也要用的（项目设置装配、助记符数字表、书签的持久化包装）。
    useProjectSettings, digits, bookmarkSave,
    jumpMnemonic, cycleBookmark, dropBookmark, mnemonicOwner, persistBookmarks,
  }
}
