// IDEA's main-toolbar **filename widget**, ported from
// platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/FilenameToolbarWidgetAction.kt:49-181.
//
// The widget is the CENTER region of the New UI main toolbar
// (PlatformActions.xml:846-848 `MainToolbarCenter` -> `main.toolbar.Filename`): it shows the
// selected editor's name (icon + name, coloured by the file's VCS status), clicking it lists the
// other recent files, and a middle-click (or Shift+left-click) closes the file:
//
//   update()                      :53-60   visible only when the tab strip is gone OR the window
//                                          header carries the full path
//   updatePresentationFromFile()  :62-89   icon / colour / name / tooltip
//   createPopup()                 :94-102  the recent files, minus the current one
//   RecentFilesListPopupStep      :159-176 the popup rows (icon, name, status colour)
//   FilenameToolbarWidget         :110-157 the combo button: label, tooltip, close gesture
//
// The name comes from VfsPresentationUtil.getUniquePresentableNameForUI
// (`EditorTabPresentationUtil.kt:72-75`: the file name, or the shortest unique path when several
// files share that name), the tooltip from FrameTitleBuilder.getFileTitle
// (`PlatformFrameTitleBuilder.kt:55-96`), and the label is shortened by
// StringUtil.shortenTextWithEllipsis(text, 60, 30).

/** StringUtil.java `shortenTextWithEllipsis(text, maxLength, suffixLength, useEllipsisSymbol)`. */
export const FILE_NAME_MAX_LENGTH = 60
export const FILE_NAME_SUFFIX_LENGTH = 30
export const ELLIPSIS = '...'
/** UIBundle.properties:405 `filename.widget.accessible.name.prefix=File`. */
export const ACCESSIBLE_NAME_PREFIX = '文件'

/** Which FileStatus colour the widget paints the name with (:63-73). */
export type FilenameStatusKind = 'added' | 'modified' | 'deleted' | 'none'

/** The git change row the widget colours from (`GitChange` in bridge.ts). */
export interface FilenameStatusSource {
  indexStatus?: string
  workStatus?: string
  untracked?: boolean
}

/**
 * `StringUtil.shortenTextWithEllipsis` (:86): only a too-long text is cut, keeping the head and the
 * tail around the symbol — `prefixLength = maxLength - suffixLength - symbol.length`.
 */
export function shortenTextWithEllipsis(text: string, maxLength: number, suffixLength: number, symbol = ELLIPSIS): string {
  if (text.length <= maxLength) return text
  const prefixLength = maxLength - suffixLength - symbol.length
  if (prefixLength <= 0) return text.slice(text.length - maxLength)
  return text.slice(0, prefixLength) + symbol + text.slice(text.length - suffixLength)
}

/**
 * `FilenameToolbarWidgetAction.update` (:53-60): the widget is hidden unless the editor tab strip
 * is gone (`UISettings.TABS_NONE`) or `fullPathsInWindowHeader` is on — with tabs on screen the
 * file name is already visible there.
 *
 * TaoCode has no tab-placement setting: its editor tabs are always placed on top, so `tabsHidden`
 * is false and the widget appears exactly when the full path is shown in the window header.
 */
export function filenameWidgetVisible(fullPathsInWindowHeader: boolean, tabsHidden = false): boolean {
  return tabsHidden || fullPathsInWindowHeader
}

/** The last path component, tolerating both separators. */
export function baseName(path: string): string {
  return normalise(path).split('/').pop() ?? path
}

function normalise(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * `EditorTabPresentationUtil.getUniqueEditorTabTitle` (`EditorTabPresentationUtil.kt:72-75`), which
 * delegates to `UniqueVFilePathBuilder`: when another *open* file has the same name, the shortest
 * trailing path suffix that is unique among `peers` is used, otherwise just the name.
 *
 * IDEA computes uniqueness over the whole project index (`UniqueVFilePathBuilderImpl.kt:52-54`).
 * TaoCode has no index, so it uses the variant IDEA keeps for exactly this situation — uniqueness
 * among the files open in editors (`:56-64`); the widget's own name is the one being resolved.
 */
export function uniqueFileName(path: string, peers: readonly string[] = []): string {
  const target = normalise(path)
  const name = baseName(target)
  const sameName = new Set(peers.map(normalise).filter(peer => peer !== target && baseName(peer) === name))
  if (sameName.size === 0) return name
  const components = target.split('/')
  for (let depth = 1; depth <= components.length; depth += 1) {
    const suffix = components.slice(components.length - depth)
    const text = suffix.join('/')
    const collides = [...sameName].some(peer => {
      const peerComponents = peer.split('/')
      if (peerComponents.length < depth) return false
      return peerComponents.slice(peerComponents.length - depth).join('/') === text
    })
    if (!collides) return text
  }
  return target
}

/**
 * `FrameTitleBuilder.getFileTitle` for a file in the New UI (`PlatformFrameTitleBuilder.kt:69-96`):
 * the full path when `fullPathsInWindowHeader` is on, otherwise the tab title (= the file name) for
 * files inside the project content root and the full path for everything else.
 */
export function filenameWidgetTooltip(fullPath: string, name: string, fullPathsInWindowHeader: boolean, insideContentRoot = true): string {
  if (fullPathsInWindowHeader) return fullPath
  return insideContentRoot ? name : fullPath
}

/**
 * The combo button's label (:139): the shortened unique name, and — when the full path is shown in
 * the window header and differs from the name — the path appended in brackets.
 */
export function filenameWidgetLabel(name: string, fullPath: string, fullPathsInWindowHeader: boolean): string {
  const label = shortenTextWithEllipsis(name, FILE_NAME_MAX_LENGTH, FILE_NAME_SUFFIX_LENGTH)
  if (!fullPathsInWindowHeader || fullPath === name) return label
  return `${label} [${fullPath}]`
}

/** One row of the recent-files popup (:170 `getTextFor`, :160-168 icon and colour). */
export interface RecentFileRow {
  path: string
  name: string
}

/**
 * `createPopup` (:94-102): the popup exists only when the history holds more than the current file,
 * and it lists the history with the first entry dropped — the history is ordered most-recently-used
 * first (`EditorHistoryManager.kt:292-297` documents the reverse order IDEA has to flip), so the
 * dropped entry is the file the widget is already showing.
 */
export function recentFilesPopupRows(history: readonly string[]): RecentFileRow[] | null {
  if (history.length <= 1) return null
  return history.slice(1).map(path => ({ path, name: baseName(path) }))
}

/**
 * `UIUtil.isCloseClick(e, MouseEvent.MOUSE_RELEASED)` (`UIUtil.java:1843-1846`): the middle button,
 * or the left button with Shift held, closes the file the widget shows (:118-131).
 */
export function isFilenameWidgetCloseGesture(button: number, shiftKey: boolean): boolean {
  return button === 1 || (button === 0 && shiftKey)
}

/** Windows absolute-path test — the host is Windows-only (a drive letter, a UNC share or `/`). */
export function isAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\')
}

/**
 * TaoCode keeps editor paths relative to the project root (every other place builds the absolute
 * path the same way, e.g. App.vue's "copy path"), but a language-service location can hand over an
 * absolute one — then it is already the absolute path.
 */
export function absolutePath(root: string, path: string): string {
  if (isAbsolutePath(path)) return normalise(path)
  return `${normalise(root).replace(/\/+$/, '')}/${normalise(path)}`
}

/** IDEA's `fileIndex.isInContent(file)` (`PlatformFrameTitleBuilder.kt:83-87`) against the root. */
export function insideContentRoot(root: string, path: string): boolean {
  if (!isAbsolutePath(path)) return true
  const base = normalise(root).replace(/\/+$/, '').toLowerCase()
  const full = normalise(path).toLowerCase()
  return full === base || full.startsWith(`${base}/`)
}

/** Windows paths are case-insensitive; git reports repo-relative paths with `/` separators. */
export function isSameFile(a: string, b: string): boolean {
  return normalise(a).toLowerCase() === normalise(b).toLowerCase()
}

/**
 * The colour the widget paints the name with (:63-73). IDEA asks `FileStatusManager` for the
 * `FileStatus` of the file; the git change letters give the same three buckets the commit legend
 * uses (`src/commitLegend.ts:32-43`, `ChangeInfoCalculator.kt:16-26`). A file that is not in the
 * change list is `UNKNOWN`/`NOT_CHANGED` and keeps the default foreground (`:75-78`).
 */
export function fileStatusKind(change: FilenameStatusSource | undefined): FilenameStatusKind {
  if (!change) return 'none'
  const index = (change.indexStatus || '').trim().toUpperCase()
  const work = (change.workStatus || '').trim().toUpperCase()
  if (change.untracked || index === 'A' || index === '?' || work === 'A' || work === '?') return 'added'
  if (index === 'D' || work === 'D') return 'deleted'
  if (!index && !work) return 'none'
  return 'modified'
}
