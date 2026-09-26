// IDEA's settings-search engine, reduced to the parts TaoCode can consume.
//
// Source: platform/platform-impl/src/com/intellij/openapi/options/newEditor/SettingsFilter.kt,
//         platform/platform-impl/src/com/intellij/ide/ui/search/SearchUtil.kt,
//         platform/platform-impl/src/com/intellij/ide/ui/search/SearchableOptionsRegistrarImpl.kt,
//         platform/platform-impl/src/com/intellij/openapi/options/newEditor/CopySettingsPathAction.kt.
//
// Pure logic (no Vue, no DOM) so it can be unit tested.

/** `SearchableOptionsRegistrar.SETTINGS_GROUP_SEPARATOR` — SearchableOptionsRegistrar.java:21. */
export const GROUP_SEPARATOR = ' | '

/** `action.settings.path=File | Settings` — CommonBundle.properties:37 (Windows form). */
export const SETTINGS_PATH_PREFIX = '文件 | 设置'

/**
 * `WORD_SEPARATOR_CHARS = Pattern.compile("[^-\\pL\\d#+]+")` — SearchableOptionsRegistrarImpl.kt:42.
 * Letters, digits, `#`, `+` and `-` stay inside a word; everything else separates. `\p{L}` covers
 * CJK, so a run like `缩进宽度` is one word.
 */
const WORD_SEPARATOR = /[^-\p{L}\d#+]+/u

/**
 * Prefixes stripped when a copied path is pasted back into the search box —
 * `parseSettingsPath` SearchableOptionsRegistrarImpl.kt:515-528. `File | Settings` is kept as
 * written there; the Chinese form is what TaoCode itself copies.
 */
const PATH_PREFIXES = [
  SETTINGS_PATH_PREFIX, // 文件 | 设置 — the form TaoCode itself copies (CommonBundle.properties:37)
  'File | Settings', // SearchableOptionsRegistrarImpl.kt:516, verbatim
  'taocode', // stands in for ApplicationNamesInfo.fullProductName (:517)
  '设置', // stands in for "Settings" (:519) and the two macOS forms (:523-525)
  '偏好设置',
]

/**
 * `collectProcessedWords` — SearchableOptionsRegistrarImpl.kt:563-569: lowercase, split on
 * WORD_SEPARATOR_CHARS, drop duplicates. **未做（有意）**: IDEA then applies
 * `PorterStemmerUtil.stem` and drops stop words (SearchableOptionsRegistrarImpl.kt:557,565-566).
 * A half-ported stemmer would silently mismatch, and the stop-word list is an English resource
 * with no effect on the Chinese labels; neither is faked here.
 */
export function searchWords(text: string): string[] {
  const words = new Set<string>()
  for (const word of text.toLocaleLowerCase().split(WORD_SEPARATOR)) {
    if (word) words.add(word)
  }
  return [...words]
}

/** `text.contains(option, ignoreCase = true)` — SearchUtil.kt:224,231. */
export function contains(text: string, needle: string): boolean {
  const trimmed = needle.trim().toLocaleLowerCase()
  return trimmed.length > 0 && text.toLocaleLowerCase().includes(trimmed)
}

/**
 * `isComponentHighlighted` — SearchUtil.kt:209-237.
 * `force = true` is the first pass: every query word must appear as a word of the text
 * (`options.removeAll(tokens); options.isEmpty()` :236-237). `force = false` is the fallback
 * pass: any single word is enough, and a plain substring hit counts too (:232-235).
 */
export function matchesOption(text: string, query: string, force: boolean): boolean {
  const words = searchWords(query)
  if (!words.length) return contains(text, query)
  const tokens = new Set(searchWords(text))
  if (!force) return words.some(word => tokens.has(word)) || contains(text, query)
  return words.every(word => tokens.has(word))
}

/**
 * `SearchUtil.lightOptions` — SearchUtil.kt:82-86: run the whole tree with `force = true`, and
 * only when nothing matched run it again with `force = false`.
 */
export function optionMatches(texts: readonly string[], query: string): boolean {
  if (!texts.length) return false
  if (texts.some(text => matchesOption(text, query, true))) return true
  return texts.some(text => matchesOption(text, query, false))
}

/**
 * Name hits — `SearchableOptionsRegistrarImpl.kt:217-231`: the whole (trimmed, lowercased) query
 * must be contained in the display name; when the query holds no words at all, every page counts
 * as a name hit (:221-225).
 */
export function isNameHit(label: string, query: string): boolean {
  return searchWords(query).length ? contains(label, query) : query.trim().length > 0
}

/**
 * `parseSettingsPath` — SearchableOptionsRegistrarImpl.kt:507-529: only a query that contains the
 * group separator is treated as a path; known prefixes are then stripped segment by segment
 * (`skipPrefixIfNeeded` :531-547, case-insensitive, from index 0).
 */
export function pathSegments(path: string): string[] | null {
  if (!path.includes(GROUP_SEPARATOR)) return null
  let split = path.split(GROUP_SEPARATOR).map(part => part.trim())
  for (const prefix of PATH_PREFIXES) {
    const prefixSplit = prefix.split(GROUP_SEPARATOR).map(part => part.trim())
    if (split.length < prefixSplit.length) continue
    if (!prefixSplit.every((part, index) => part.toLocaleLowerCase() === split[index]!.toLocaleLowerCase())) continue
    split = split.slice(prefixSplit.length)
  }
  return split
}

export interface SettingsPageRef {
  key: string
  label: string
  parent: string | null
}

export interface SettingsGroupRef {
  key: string
  label: string
}

/** Deepest page matched by a pasted path, plus the leftover text for the spotlight. */
export interface SettingsPathHit {
  parent: string | null
  key: string
  spotlight: string
}

/**
 * `findGroupsByPath` — SearchableOptionsRegistrarImpl.kt:457-505. Walks the path level by level,
 * matching display names case-insensitively (:479), stops at the deepest match, and turns the
 * remaining segments into the spotlight text (:495-500).
 *
 * IDEA's top level is a single root group holding the real groups; TaoCode's top level *is* the
 * group list (plus the pages that hang off no group), so level one matches a group or a top-level
 * page and level two matches a page inside that group.
 */
export function resolveSettingsPath(
  query: string,
  groups: readonly SettingsGroupRef[],
  nodes: readonly SettingsPageRef[],
): SettingsPathHit | null {
  const split = pathSegments(query)
  if (!split?.length) return null
  const first = split[0]!
  const equals = (label: string, value: string) => label.toLocaleLowerCase() === value.toLocaleLowerCase()

  const group = groups.find(item => equals(item.label, first))
  if (group) {
    const second = split[1]
    const child = second === undefined ? undefined : nodes.find(node => node.parent === group.key && equals(node.label, second))
    if (child) return { parent: child.parent, key: child.key, spotlight: split.slice(2).join(' ') }
    return { parent: group.key, key: group.key, spotlight: split.slice(1).join(' ') }
  }

  const page = nodes.find(node => !node.parent && equals(node.label, first))
  if (page) return { parent: null, key: page.key, spotlight: split.slice(1).join(' ') }
  return null
}

/**
 * `CopySettingsPathAction.createTransferable` — CopySettingsPathAction.kt:55-65: the path prefix
 * then every path name appended after the group separator. `null` means "nothing to copy", which
 * is how IDEA refuses the action (:56-58) and how the UI here disables the menu item.
 */
export function settingsPath(names: readonly string[]): string | null {
  if (!names.length) return null
  return [SETTINGS_PATH_PREFIX, ...names].join(GROUP_SEPARATOR)
}
