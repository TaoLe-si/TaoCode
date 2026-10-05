// 装订线（gutter）上的**右键菜单** —— IDEA 的 `EditorGutterPopupMenu`。
//
// 上游组的内容（`platform/platform-impl/resources/idea/PlatformActions.xml:1047-1054` 逐字核过）：
//   1) `EditorToggleUseSoftWraps`（使用软换行）
//   2) `ConfigureSoftWraps`（配置软换行…）
//   3) 分隔
//   4) `ToggleFocusMode`（进入/退出专注模式）
//   5) 分隔
//   6) `EditorGutterPopupMenu.Appearance` ▸（`:1041-1046`）= 显示行号 / 显示缩进参考线 / 显示粘性行
// 另有两处 add-to-group：
//   · `ShowGutterIconsSettings`（`platform/platform-impl/resources/idea/LangActions.xml:163-165`，`anchor="last"`
//     → 打开「装订线图标」设置页）；
//   · 书签那一组 `popup@BookmarkContextMenu`（`platform/bookmarks/resources/intellij.platform.bookmarks.xml:211-219`，
//     `anchor="before" relative-to-action="EditorToggleUseSoftWraps"` ⇒ **在软换行之前**）：
//     AddAnotherBookmark / EditBookmark / ToggleBookmark / DeleteMnemonicFromBookmark / ToggleBookmarkWithMnemonic。
//     其中 `AddAnotherBookmark` 对**行**书签是隐藏的（`AddAnotherBookmarkAction.update:16-19`），装订线上点的
//     就是行书签 ⇒ 本菜单里不出现它；`DeleteMnemonicFromBookmark` 只在有助记键时才有意义。
//
// 这一模块是纯逻辑 + 状态：给"在某一行上点了右键"算出菜单行，动作由宿主注入。
import { computed, ref } from 'vue'
import type { MenuRow } from './menus/types.ts'
import type { Bookmark, EditorSettings, ProjectSettings } from './bridge'

export interface GutterMenuTarget { path: string; line: number; x: number; y: number }

export interface GutterMenuDeps {
  editorSettings: { readonly value: EditorSettings }
  bookmarks: { readonly value: Bookmark[] }
  /** 该行的书签（没有 = undefined）。 */
  bookmarkAt: (path: string, line: number) => Bookmark | undefined
  toggleBookmark: (path: string, line: number) => void
  editDescription: (path: string, line: number) => void
  /** 「切换助记键…」：`ChooseBookmarkTypeAction`（本仓复用助记键选择器）。 */
  chooseMnemonic: (path: string, line: number) => void
  /** 「删除助记键」：`DeleteBookmarkTypeAction`。 */
  clearMnemonic: (path: string, line: number) => void
  patchSettings: (patch: Partial<EditorSettings>) => void
  openSettings: (page: string) => void
  toggleFocusMode: () => void
  focusModeOn: () => boolean
}

export function createGutterMenu(deps: GutterMenuDeps) {
  const target = ref<GutterMenuTarget | null>(null)
  function open(next: GutterMenuTarget) { target.value = next }
  function close() { target.value = null }

  const rows = computed<MenuRow[]>(() => {
    const at = target.value
    if (!at) return []
    const settings = deps.editorSettings.value
    const bookmark = deps.bookmarkAt(at.path, at.line)
    const rows: MenuRow[] = [
      {
        id: 'gutter.toggleBookmark',
        title: bookmark ? '删除书签' : '添加书签',
        keywords: 'toggle bookmark 添加书签 删除书签',
        run: () => { deps.toggleBookmark(at.path, at.line); close() },
      },
      ...(bookmark ? [{
        id: 'gutter.editBookmark',
        title: '编辑描述',
        keywords: 'edit bookmark description 编辑描述',
        run: () => { deps.editDescription(at.path, at.line); close() },
      }] : []),
      ...(bookmark ? [{
        id: 'gutter.bookmarkMnemonic',
        title: '切换助记键…',
        keywords: 'bookmark mnemonic type 助记键',
        run: () => { deps.chooseMnemonic(at.path, at.line); close() },
      }] : []),
      ...(bookmark?.mnemonic !== undefined ? [{
        id: 'gutter.clearMnemonic',
        title: '删除助记键',
        keywords: 'delete bookmark mnemonic 删除助记键',
        run: () => { deps.clearMnemonic(at.path, at.line); close() },
      }] : []),
      { id: 'gutter.rule1', rule: true },
      {
        id: 'gutter.softWraps',
        title: '使用软换行',
        keywords: 'soft wrap 软换行',
        keys: 'Ctrl Shift A',
        checked: () => deps.editorSettings.value.wordWrap,
        run: () => { deps.patchSettings({ wordWrap: !settings.wordWrap }); close() },
      },
      {
        id: 'gutter.configureSoftWraps',
        title: '配置软换行…',
        keywords: 'configure soft wraps 配置软换行',
        run: () => { deps.openSettings('editor'); close() },
      },
      { id: 'gutter.rule2', rule: true },
      {
        id: 'gutter.focusMode',
        title: () => (deps.focusModeOn() ? '退出专注模式' : '进入专注模式'),
        keywords: 'distraction free focus mode 专注模式',
        checked: () => deps.focusModeOn(),
        run: () => { deps.toggleFocusMode(); close() },
      },
      { id: 'gutter.rule3', rule: true },
      {
        id: 'gutter.appearance',
        title: '外观',
        keywords: 'appearance line numbers indent guides sticky lines 外观 行号 缩进参考线 粘性行',
        // `EditorGutterPopupMenu.Appearance`（PlatformActions.xml:1041-1046）：三项**全局**开关。
        children: [
          { id: 'gutter.lineNumbers', title: '显示行号', checked: () => deps.editorSettings.value.lineNumbers,
            run: () => { deps.patchSettings({ lineNumbers: !settings.lineNumbers }); close() } },
          { id: 'gutter.indentGuides', title: '显示缩进参考线', checked: () => deps.editorSettings.value.showIndentGuides,
            run: () => { deps.patchSettings({ showIndentGuides: !settings.showIndentGuides }); close() } },
          { id: 'gutter.stickyLines', title: '显示粘性行', checked: () => deps.editorSettings.value.showStickyLines,
            run: () => { deps.patchSettings({ showStickyLines: !settings.showStickyLines }); close() } },
        ],
      },
      { id: 'gutter.rule4', rule: true },
      {
        id: 'gutter.iconsSettings',
        title: '装订线图标设置…',
        keywords: 'gutter icons settings 装订线图标',
        run: () => { deps.openSettings('editor.preferences.gutterIcons'); close() },
      },
    ]
    return rows
  })

  return { gutterMenu: target, gutterMenuRows: rows, openGutterMenu: open, closeGutterMenu: close }
}

/** 行书签的标题（`bookmark.add.action.text` / `bookmark.delete.action.text`）—— 供测试与宿主复用。 */
export function gutterBookmarkLabel(bookmark: Bookmark | undefined): string {
  return bookmark ? '删除书签' : '添加书签'
}
