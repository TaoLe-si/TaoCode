/**
 * The history of a search field, ported from IDEA's `SearchTextField`
 * (`platform/platform-api/src/com/intellij/ui/SearchTextField.java`).
 *
 * `SettingsSearch` builds the settings filter with `super("SettingsSearchHistory")`
 * (`options/newEditor/SettingsSearch.java:25`), i.e. this exact behaviour applies to the
 * settings search box.
 *
 * The rules, all from `SearchTextField.MyModel.addElement` (:356-384):
 *
 *   - the query is trimmed and an empty one is never stored (:357-360);
 *   - duplicates are found case-insensitively (:365 `StringUtil.equalsIgnoreCase`);
 *   - an entry that is already at the top changes nothing at all — `addElement` returns false and
 *     the caller skips the write to the properties store (:370-373, :285-287);
 *   - an entry found further down is moved to the top (:374-377);
 *   - a new entry pushes the oldest one out once the list is full (:378-381, size default 5 :69);
 *   - new entries go to the front, so the list is most-recent-first (:382).
 *
 * IDEA persists the list as a newline-joined string in `PropertiesComponent`
 * (:286 `StringUtil.join(getHistory(), "\n")`, read back at :322-330 with empty items dropped);
 * TaoCode keeps the identical format in localStorage.
 *
 * Not ported: the in-place history completion of the New UI
 * (`JTextField.Search.InplaceHistory`, set at :314) — that is implemented by the LaF's
 * `TextFieldWithPopupHandlerUI` (ghost text inside the field plus Tab/right-arrow acceptance).
 * Inventing a completion key binding for it would be a guess, and the history popup below covers
 * the same need.
 */

/** `SearchTextField.java:69` — the default `myHistorySize`. */
export const SEARCH_HISTORY_SIZE = 5
/** `SettingsSearch.java:25` — the property name the settings filter stores its history under. */
export const SETTINGS_SEARCH_HISTORY_KEY = 'taocode.settingsSearchHistory'
/** `UIBundle.properties:382` `search.text.field.history.popup.accessible.name`. */
export const SEARCH_HISTORY_LABEL = '搜索历史'

/**
 * `reset()` (:318-336): split the stored string on `\n` and drop the empty items.
 *
 * The list is also capped at `SEARCH_HISTORY_SIZE` here. IDEA does not trim on load, but the only
 * writer of the key is this field itself (which caps at 5), so a longer stored list is
 * unreachable — capping keeps the popup and the Alt+Up/Alt+Down cycling consistent with each
 * other instead of reproducing an unreachable inconsistency between `getSize()` and
 * `getElementAt`.
 */
export function parseHistory(raw: unknown): string[] {
  const items = Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === 'string')
    : typeof raw === 'string'
      ? raw.split('\n')
      : []
  return items.filter(item => item.length > 0).slice(0, SEARCH_HISTORY_SIZE)
}

/** `addCurrentTextToHistory` (:286) — `StringUtil.join(getHistory(), "\n")`. */
export function formatHistory(entries: readonly string[]): string {
  return entries.join('\n')
}

/** `MyModel.addElement` (:356-384). `changed` is the method's boolean return value. */
export function addHistoryEntry(
  entries: readonly string[],
  query: string,
): { entries: string[]; changed: boolean } {
  const item = query.trim()
  if (!item) return { entries: [...entries], changed: false }

  const index = entries.findIndex(entry => entry.toLowerCase() === item.toLowerCase())
  if (index === 0) return { entries: [...entries], changed: false }

  const next = [...entries]
  if (index > 0) next.splice(index, 1)
  else if (next.length >= SEARCH_HISTORY_SIZE) next.pop()
  next.unshift(item)
  return { entries: next, changed: true }
}

/**
 * What the popup lists: IDEA's model exposes `min(myHistorySize, myFullList.size)` items
 * (:351-354) while the underlying list may hold more.
 */
export function popupHistory(entries: readonly string[]): string[] {
  return entries.slice(0, SEARCH_HISTORY_SIZE)
}

export type HistoryDirection = 'next' | 'prev'

export interface HistoryState {
  entries: string[]
  index: number
  text: string
  /** Whether recording the current text changed the list — `MyModel.addElement`'s return value. */
  changed: boolean
}

/**
 * The `showPrevHistoryItem` / `showNextHistoryItem` actions (:173-195).
 *
 * Both first make sure the text currently in the field is in the history; the check is
 * case-sensitive (`myFullList.contains(getText())`, :176/:187) unlike `addElement`'s own
 * case-insensitive duplicate search, so an entry differing only in case is added once more and
 * then replaces the older spelling — IDEA's behaviour, kept as is.
 *
 * The index is initialised to 0 and is *never* reset (neither action nor `reset()` touches it), so
 * the first Alt+Down lands on the second entry (:189-191) while the first Alt+Up lands on the last
 * one (:178-181). Kept faithful, and a list shorter than two entries does nothing at all
 * (:177/:188 — the text that was just recorded stays in the field).
 */
export function stepHistory(
  entries: readonly string[],
  current: string,
  index: number,
  direction: HistoryDirection,
): HistoryState {
  const recorded = entries.includes(current)
    ? { entries: [...entries], changed: false }
    : addHistoryEntry(entries, current)
  if (recorded.entries.length < 2) {
    return { entries: recorded.entries, index, text: current, changed: recorded.changed }
  }

  const size = recorded.entries.length
  const next = direction === 'prev'
    ? (index - 1 < 0 ? size - 1 : index - 1)
    : (index + 1 > size - 1 ? 0 : index + 1)
  return { entries: recorded.entries, index: next, text: recorded.entries[next]!, changed: recorded.changed }
}
