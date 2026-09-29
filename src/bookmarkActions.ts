// 书签（IDEA 的 Toggle Bookmark / 助记符 / 循环跳转）—— 从 App.vue 搬出的一域（73 行，9 个依赖）。
//
// 判据：书签表 + 助记符提示 + 四处跳转/增删自成一体；它**不**负责渲染（那是模板与 gutter 的事），
// 也不负责持久化格式（那是 `src/bookmarksView.ts` 与设置）。
// `bookmarks` 的 ref 由本模块创建，宿主通过返回值拿它（模板与状态栏都要读）。
import { computed, ref, watch, type Ref } from 'vue'
import { request } from './bridge'
import { errorMessage } from './errors'
import { bookmarkOwner, nextBookmark as nextInList, placeBookmark, removeBookmark, sortedBookmarks } from './bookmarks'
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
  revealLocation: (target: { path: string; line: number }) => unknown
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
  function placeAt(path: string, line: number, mnemonic?: number) {
    bookmarks.value = placeBookmark(bookmarks.value, path, line, mnemonic)
    const keptEntry = bookmarks.value.find(entry => entry.path === path && entry.line === line)
    if (keptEntry) rememberPlace({ kind: '书签', path, line: line - 1, label: keptEntry.mnemonic === undefined ? baseName(path) + ':' + line : `${keptEntry.mnemonic} · ${baseName(path)}:${line}` })
    const kept = bookmarks.value.find(entry => entry.path === path && entry.line === line)
    deps.notify(kept ? (kept.mnemonic === undefined ? `书签 ${path}:${line}` : `书签 ${path}:${line} 编号 ${kept.mnemonic}（Ctrl+${kept.mnemonic} 跳转）`) : `已取消书签 ${path}:${line}`)
    persistBookmarks()
  }
  function toggleBookmark(mnemonic?: number) {
    const tab = active.value
    if (!tab) return
    placeAt(tab.path, tab.line, mnemonic)
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
