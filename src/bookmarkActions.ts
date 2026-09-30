// 书签（IDEA 的 Toggle Bookmark / 助记符 / 循环跳转）—— 从 App.vue 搬出的一域（73 行，9 个依赖）。
//
// 判据：书签表 + 助记符提示 + 四处跳转/增删自成一体；它**不**负责渲染（那是模板与 gutter 的事），
// 也不负责持久化格式（那是 `src/bookmarksView.ts` 与设置）。
// `bookmarks` 的 ref 由本模块创建，宿主通过返回值拿它（模板与状态栏都要读）。
import { computed, ref, watch, type Ref } from 'vue'
import { request } from './bridge'
import { errorMessage } from './errors'
import { bookmarkAnchor, bookmarkDescription, bookmarkOwner, normalizeMnemonic, nextBookmark as nextInList, placeBookmark, reconcileBookmarks, removeBookmark, sortedBookmarks, withoutMnemonic } from './bookmarks'
import { DEFAULT_BOOKMARKS_VIEW, type BookmarksViewSettings } from './bookmarksView'
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
  /** 写回书签视图设置（「不再询问」把 `rewriteBookmarkType` 打开，见 canRewriteType:276-280）。 */
  updateBookmarkViewSettings: (patch: Partial<BookmarksViewSettings>) => void
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
  const viewSettings = (): BookmarksViewSettings => ({ ...DEFAULT_BOOKMARKS_VIEW, ...(projectSettings.value.bookmarksView ?? {}) })
  const bookmarks = ref<Bookmark[]>([])
  const sortedAll = computed(() => sortedBookmarks(bookmarks.value))
  const bookmarkLines = computed(() => {
    const map: Record<string, number[]> = {}
    for (const entry of bookmarks.value) (map[entry.path] ??= []).push(entry.line)
    return map
  })
  /**
   * 助记键选择器（上游 `BookmarkTypeChooser`，`actions/BookmarkTypeChooser.kt`）。
   * 状态比原来多两样：这条书签**当前**的助记键（网格要标出"当前"）与描述（映射到那个描述输入框）。
   */
  const mnemonicPrompt = ref<{ path: string; line: number; current?: string; description?: string } | null>(null)
  /**
   * "这个助记键已被占用，是否重写" 的确认态（上游 `BookmarksManagerImpl.canRewriteType:262-283`：
   * `rewriteBookmarkType` 关着时弹一个带「重写」按钮的警告，还有"不再询问"把开关写回去）。
   */
  const rewriteAsk = ref<{ path: string; line: number; mnemonic: string; description?: string; owner: Bookmark } | null>(null)
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
  function placeAt(path: string, line: number, mnemonic?: string, content?: string, description?: string, rewrite = true) {
    const lineText = content === undefined ? undefined : bookmarkAnchor(content.split(String.fromCharCode(10))[line - 1] ?? '')
    bookmarks.value = placeBookmark(bookmarks.value, path, line, mnemonic, lineText, description, rewrite)
    const keptEntry = bookmarks.value.find(entry => entry.path === path && entry.line === line)
    if (keptEntry) rememberPlace({ kind: '书签', path, line: line - 1, label: keptEntry.mnemonic === undefined ? baseName(path) + ':' + line : `${keptEntry.mnemonic} · ${baseName(path)}:${line}` })
    const kept = bookmarks.value.find(entry => entry.path === path && entry.line === line)
    // 跳法只有数字键有默认键位（`$default.xml` 173-197 只给了 Ctrl+0..9）；字母在 IDEA 里
    // 也没有全局键（书签窗口内的裸键 + `Bookmarks.Goto` 菜单），所以提示要分开说。
    const how = kept?.mnemonic === undefined ? ''
      : kept.mnemonic >= '0' && kept.mnemonic <= '9' ? `（Ctrl+${kept.mnemonic} 跳转）` : `（导航菜单：转到书签 ${kept.mnemonic}）`
    deps.notify(kept ? (kept.mnemonic === undefined ? `书签 ${path}:${line}` : `书签 ${path}:${line} 助记键 ${kept.mnemonic}${how}`) : `已取消书签 ${path}:${line}`)
    persistBookmarks()
  }
  function toggleBookmark(mnemonic?: string) {
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
    rewriteAsk.value = null
    const here = bookmarks.value.find(entry => entry.path === tab.path && entry.line === tab.line)
    mnemonicPrompt.value = { path: tab.path, line: tab.line, current: here?.mnemonic, description: here === undefined ? undefined : bookmarkDescription(here) }
  }
  /**
   * 选了一个助记键（网格点击 / 直接敲键）。助记键被别的书签占着时要先确认 ——
   * 上游 `canRewriteType`：`rewriteBookmarkType` 打开就直接改，否则弹确认，确认后老的那条被删掉
   * （`rewriteType:285-295`）。
   */
  function pickMnemonic(value: string, description?: string) {
    const at = mnemonicPrompt.value
    if (!at) return
    const mnemonic = normalizeMnemonic(value)
    if (mnemonic === undefined) return
    const squatted = bookmarkOwner(bookmarks.value, mnemonic)
    const wanted = description ?? at.description
    const other = squatted !== undefined && !(squatted.path === at.path && squatted.line === at.line)
    if (other && !viewSettings().rewriteBookmarkType) {
      rewriteAsk.value = { path: at.path, line: at.line, mnemonic, description: wanted, owner: squatted }
      return
    }
    mnemonicPrompt.value = null
    rewriteAsk.value = null
    placeAt(at.path, at.line, mnemonic, deps.editorContent?.(at.path), wanted, true)
  }
  /** 确认重写：同一次选择继续走（老主人被删）。 */
  function confirmRewrite() {
    const ask = rewriteAsk.value
    rewriteAsk.value = null
    if (!ask) return
    mnemonicPrompt.value = null
    placeAt(ask.path, ask.line, ask.mnemonic, deps.editorContent?.(ask.path), ask.description, true)
  }
  /** 「不再询问」：写回 `rewriteBookmarkType`（上游那个 DoNotAskOption 的回写，`:276-280`）。 */
  function dontAskRewrite() {
    deps.updateBookmarkViewSettings({ rewriteBookmarkType: true })
    confirmRewrite()
  }
  /** 菜单里那一行的标题随状态变（上游 `ChooseBookmarkTypeAction.update:33-41` 的三段文案）。 */
  function bookmarkMnemonicLabel(): string {
    const tab = active.value
    const here = tab === undefined ? undefined : bookmarks.value.find(entry => entry.path === tab.path && entry.line === tab.line)
    if (here === undefined) return '添加助记书签…'
    return here.mnemonic === undefined ? '指定助记符…' : '更改助记符…'
  }
  /** 「移除助记键」= 上游 `DeleteBookmarkTypeAction`（可见文案取自 `BookmarksView.DeleteType.text`）：
   *  把这条书签的助记键摘掉（`setType(bookmark, DEFAULT)`），书签本身留着。 */
  function removeMnemonic() {
    const at = mnemonicPrompt.value
    if (!at) return
    mnemonicPrompt.value = null
    rewriteAsk.value = null
    bookmarks.value = bookmarks.value.map(entry =>
      entry.path === at.path && entry.line === at.line ? withoutMnemonic(entry) : entry)
    persistBookmarks()
  }
  /** 转到某个助记键的书签（上游 `GotoBookmarkTypeAction`，菜单文案「转到书签 {0}」）。 */
  function jumpMnemonic(mnemonic: string) {
    const found = bookmarkOwner(bookmarks.value, normalizeMnemonic(mnemonic) ?? mnemonic)
    if (!found) { deps.notify(`没有助记键 ${mnemonic} 的书签（Ctrl+F11 可以贴一个）。`, true); return }
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
  function mnemonicOwner(mnemonic: string) {
    const found = bookmarkOwner(bookmarks.value, mnemonic)
    return found ? `${found.path.split('/').pop()}:${found.line}` : '—'
  }

  return {
    bookmarks, sortedAll, bookmarkLines, mnemonicPrompt, rewriteAsk, placeAt, toggleBookmark, openMnemonicPrompt, pickMnemonic,
    confirmRewrite, dontAskRewrite, removeMnemonic, bookmarkMnemonicLabel,
    // 下面三个是宿主别处也要用的（项目设置装配、助记符数字表、书签的持久化包装）。
    useProjectSettings, digits, bookmarkSave,
    jumpMnemonic, cycleBookmark, dropBookmark, mnemonicOwner, persistBookmarks,
  }
}
