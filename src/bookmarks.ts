// IDEA keeps one project-wide bookmark list, and a mnemonic (0-9) can be held by only
// one entry, so Ctrl+<digit> always means "that bookmark". Pure list algebra: no Vue,
// so the toggle and walk rules are checkable without a DOM.
export interface Bookmark {
  path: string
  line: number
  mnemonic?: number
}

const compare = (a: Bookmark, b: Bookmark) => a.path.localeCompare(b.path) || a.line - b.line

export function sortedBookmarks(list: readonly Bookmark[]): Bookmark[] {
  return [...list].sort(compare)
}

const withMnemonic = (entry: Bookmark, mnemonic?: number): Bookmark =>
  mnemonic === undefined ? { path: entry.path, line: entry.line } : { path: entry.path, line: entry.line, mnemonic }

/**
 * Add, rename or clear the bookmark on `path:line`.
 * `mnemonic === undefined` is a plain F11 toggle; a digit behaves like Ctrl+F11 /
 * Ctrl+Shift+digit, i.e. it moves the digit to this line (freeing its old owner) and
 * removes the bookmark when the digit already sits here.
 */
export function placeBookmark(list: readonly Bookmark[], path: string, line: number, mnemonic?: number): Bookmark[] {
  const here = (entry: Bookmark) => entry.path === path && entry.line === line
  const existing = list.find(here)
  if (existing && (mnemonic === undefined || existing.mnemonic === mnemonic)) return list.filter(entry => !here(entry))
  const freed = mnemonic === undefined
    ? [...list]
    : list.map(entry => (entry.mnemonic === mnemonic ? withMnemonic(entry) : entry))
  return existing
    ? freed.map(entry => (here(entry) ? withMnemonic(entry, mnemonic) : entry))
    : [...freed, withMnemonic({ path, line }, mnemonic)]
}

export function bookmarkOwner(list: readonly Bookmark[], mnemonic: number): Bookmark | undefined {
  return list.find(entry => entry.mnemonic === mnemonic)
}

/** The next/previous bookmark in document order, wrapping around the project. */
export function nextBookmark(list: readonly Bookmark[], path: string, line: number, reverse: boolean): Bookmark | undefined {
  const all = sortedBookmarks(list)
  if (!all.length) return undefined
  const cursor = { path, line }
  const later = all.filter(entry => compare(entry, cursor) > 0)
  const earlier = all.filter(entry => compare(entry, cursor) < 0)
  return reverse ? (earlier[earlier.length - 1] ?? all[all.length - 1]) : (later[0] ?? all[0])
}

export function removeBookmark(list: readonly Bookmark[], entry: Bookmark): Bookmark[] {
  return list.filter(item => !(item.path === entry.path && item.line === entry.line))
}
