// 书签（IDEA 的 Toggle Bookmark / 助记符 / 循环跳转）—— 从 App.vue 搬出的一域（73 行，9 个依赖）。
//
// 判据：书签表 + 助记符提示 + 四处跳转/增删自成一体；它**不**负责渲染（那是模板与 gutter 的事），
// 也不负责持久化格式（那是 `src/bookmarksView.ts` 与设置）。
// `bookmarks` 的 ref 由本模块创建，宿主通过返回值拿它（模板与状态栏都要读）。
import { computed, ref, watch, type Ref } from 'vue'
import { request } from './bridge'
import { errorMessage } from './errors'
import { bookmarkAnchor, bookmarkDescription, bookmarkGutterTooltip, bookmarkOwner, normalizeMnemonic, nextBookmark as nextInList, placeBookmark, reconcileBookmarks, removeBookmark, sortedBookmarks, toggleFileBookmark, withoutMnemonic } from './bookmarks'
import { DEFAULT_BOOKMARKS_VIEW, type BookmarksViewSettings } from './bookmarksView'
import { configureBookmarkLists, syncBookmarkLists } from './bookmarkListActions.ts'
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
  /** 打开一个文件（文件书签的跳转就是"打开它"，没有行号可去）。 */
  openPath?: (path: string) => void
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

/**
 * 「编辑描述」的模块级入口（同一条先例）：书签面板的行右键菜单要用它，而面板拿不到本模块的实例
 * —— `createBookmarkActions` 建实例时把实现挂上。
 */
let editRequested: ((path: string, line?: number) => void) | undefined
export function requestBookmarkEdit(path: string, line?: number): void {
  editRequested?.(path, line)
}

export function createBookmarkActions(deps: BookmarkActionsDeps) {
  const isDesktop = deps.isDesktop
  const { menu, projectSettings, workspace, active, language, baseName, rememberPlace, revealLocation } = deps
  const viewSettings = (): BookmarksViewSettings => ({ ...DEFAULT_BOOKMARKS_VIEW, ...(projectSettings.value.bookmarksView ?? {}) })
  const bookmarks = ref<Bookmark[]>([])
  const sortedAll = computed(() => sortedBookmarks(bookmarks.value))
  const bookmarkLines = computed(() => {
    const map: Record<string, number[]> = {}
    // 文件书签没有行号 ⇒ 没有装订线图标（上游也只有行书签走 gutter 高亮器）。
    for (const entry of bookmarks.value) if (entry.line !== undefined) (map[entry.path] ??= []).push(entry.line)
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
  editRequested = (path, line) => editBookmarkAt(path, line ?? undefined)
  const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
  let bookmarkSave: number | undefined
  function useProjectSettings(settings: ProjectSettings) {
    if (bookmarkSave) { window.clearTimeout(bookmarkSave); bookmarkSave = undefined }
    projectSettings.value = settings
    bookmarks.value = settings.bookmarks
    // 命名书签列表（`bookmarkLists`）与默认列表（历史字段 `bookmarks`）是两份状态，
    // 但读写口都在这一处 —— 列表运行时直接从这里拿默认列表的内容与"摘掉一条"的口。
    configureBookmarkLists({
      isDesktop, settings: projectSettings, workspace, notify: deps.notify,
      defaultEntries: () => sortedAll.value,
      // 行书签换家时要**落盘**：只改内存会让默认列表在重启后把它捡回来（真机探针抓到过）。
      removeFromDefault: entry => { bookmarks.value = removeBookmark(bookmarks.value, entry); persistBookmarks() },
    })
    syncBookmarkLists(settings)
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
  /**
   * 装订线要的行书签（1 基行号 + 上游那条悬停文本）。文件书签不进装订线（没有行号可挂）。
   */
  function gutterBookmarks(path: string) {
    return bookmarks.value
      .filter(entry => entry.path === path && entry.line !== undefined)
      .map(entry => ({ line: entry.line as number, tooltip: bookmarkGutterTooltip(entry) }))
  }
  /** 装订线图标点一下 = `ToggleBookmark`（在那一行上加/删书签，不动助记键）。 */
  function toggleBookmarkAt(path: string, line: number) {
    placeAt(path, line, undefined, deps.editorContent?.(path))
  }
  /**
   * `EditBookmark`：改这条书签的描述。上游 `EditBookmarkAction` 的入口是书签图标的**中键**
   * （`GutterLineBookmarkRenderer.getMiddleButtonClickAction:50`）与右键菜单里的「编辑描述」，
   * 弹一个预填当前描述的输入框（`Messages.showInputDialog`，标题/提示取中文包）。
   */
  const descriptionPrompt = ref<{ path: string; line?: number; current: string } | null>(null)
  function editBookmarkAt(path: string, line?: number) {
    const entry = bookmarks.value.find(item => item.path === path && item.line === line)
    if (entry === undefined) return
    descriptionPrompt.value = { path, line, current: bookmarkDescription(entry) ?? '' }
  }
  /** 保存描述（空串 = 清掉自定义描述，回到"用行原文"。上游 `setDescription` 写的是自定义描述）。 */
  function saveBookmarkDescription(value: string) {
    const at = descriptionPrompt.value
    descriptionPrompt.value = null
    if (!at) return
    const trimmed = value.trim()
    bookmarks.value = bookmarks.value.map(entry =>
      entry.path === at.path && entry.line === at.line
        ? (trimmed ? { ...entry, description: value } : (() => { const next = { ...entry }; delete next.description; return next })())
        : entry)
    persistBookmarks()
  }
  /** 跳到一条书签：行书签去行号，文件书签只把文件打开。 */
  function goTo(entry: Bookmark) {
    if (entry.line === undefined) deps.openPath?.(entry.path)
    else void revealLocation({ path: entry.path, line: entry.line - 1 })
  }
  /**
   * 文件书签的开关（右键项目树/编辑器标签那一下）。上游 `BookmarksManagerImpl.createBookmark(file)`
   * 从 `VirtualFile` 建一条没有行号的书签，`toggle(bookmark, DEFAULT)` 就是加/删。
   */
  function bookmarkFile(path: string) {
    const existing = bookmarks.value.find(entry => entry.path === path && entry.line === undefined)
    bookmarks.value = toggleFileBookmark(bookmarks.value, path)
    deps.notify(existing !== undefined ? `已取消书签 ${path}` : `书签 ${path}`)
    persistBookmarks()
  }
  /** 右键那一行的标题（上游 `bookmark.add.action.text` / `bookmark.delete.action.text`）。 */
  function fileBookmarkLabel(path: string): string {
    return bookmarks.value.some(entry => entry.path === path && entry.line === undefined) ? '删除书签' : '添加书签'
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
    goTo(found)
  }
  // IDEA walks the whole project, not just the open file, and wraps around.
  function cycleBookmark(reverse: boolean) {
    const tab = active.value
    const target = nextInList(bookmarks.value, tab?.path ?? '', tab?.line ?? 0, reverse)
    if (!target) { deps.notify(bookmarks.value.length ? '只有这一个书签。' : '还没有书签：F11 标记当前行，Ctrl+F11 编号。', true); return }
    goTo(target)
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
    confirmRewrite, dontAskRewrite, removeMnemonic, bookmarkMnemonicLabel, bookmarkFile, fileBookmarkLabel, goTo,
    gutterBookmarks, toggleBookmarkAt, descriptionPrompt, editBookmarkAt, saveBookmarkDescription,
    // 下面三个是宿主别处也要用的（项目设置装配、助记符数字表、书签的持久化包装）。
    useProjectSettings, digits, bookmarkSave,
    jumpMnemonic, cycleBookmark, dropBookmark, mnemonicOwner, persistBookmarks,
  }
}
