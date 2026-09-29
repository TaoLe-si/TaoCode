import type { Entry } from './bridge'

// Only keys supported by the actual Entry payload. No synthetic timestamps or
// exclusion flags: those require a native listing contract change first.
export type ProjectTreeSortKey = 'BY_NAME' | 'BY_TYPE'
export interface ProjectTreeSortSettings {
  sortKey: ProjectTreeSortKey
  foldersAlwaysOnTop: boolean
  // 项目视图自己那三条行为（IDEA `ProjectViewSharedSettings.kt:32-34`，三条默认都是 false）：
  //   autoscrollToSource          「单击打开文件」—— 选中文件即打开（`ActionsBundle.properties:1455`）
  //   autoscrollFromSource        「始终选择打开的文件」—— 编辑器切标签时在树里选中它（`:1453`）
  //   openInPreviewTab            「用预览标签打开」—— 打开的文件进预览标签（`UISettingsState.kt:75`
  //                               `openInPreviewTabIfPossible`，默认 false，键 `OPEN_IN_PREVIEW_TAB_IF_POSSIBLE`）
  autoscrollToSource: boolean
  autoscrollFromSource: boolean
  openInPreviewTab: boolean
}

// Adapted from JetBrains NaturalComparator / FileNameComparator (Apache-2.0),
// platform/util/base/.../NaturalComparator.java:39-130. In particular do not use
// localeCompare: numeric runs, leading zeroes and '-' ordering are significant.
export function compareProjectFileNames(a: string, b: string, ignoreCase = true): number {
  const digit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'
  const skip = (s: string, i: number, c: string) => { while (s[i] === c) i++; return i }
  const range = (i: number, j: number, end: number) => {
    for (; i < end; i++, j++) { const diff = a.charCodeAt(i) - b.charCodeAt(j); if (diff) return diff }
    return 0
  }
  function chars(x: string, y: string) {
    if (x === ' ' && y > ' ' && y < '0') return 1
    if (y === ' ' && x > ' ' && x < '0') return -1
    if (x === y) return 0
    if (ignoreCase) {
      // Java Character case mappings are single UTF-16 units, not expanding
      // whole-string case conversions (e.g. sharp s must not turn into "SS").
      const upper = (c: string) => c.toUpperCase().length === 1 ? c.toUpperCase() : c
      const lower = (c: string) => c.toLowerCase().length === 1 ? c.toLowerCase() : c
      x = upper(x); y = upper(y)
      if (x === y) return 0
      x = lower(x); y = lower(y)
    }
    return x.charCodeAt(0) - y.charCodeAt(0)
  }
  let i = 0; let j = 0
  for (; i < a.length && j < b.length; i++, j++) {
    const x = a[i]!; const y = b[j]!
    if ((digit(x) || x === ' ') && (digit(y) || y === ' ')) {
      const startA = skip(a, skip(a, i, ' '), '0')
      const startB = skip(b, skip(b, j, ' '), '0')
      let endA = startA; let endB = startB
      while (digit(a[endA])) endA++
      while (digit(b[endB])) endB++
      const diff = (endA - startA) - (endB - startB) || range(startA, startB, endA)
        || (endA - i) - (endB - j) || range(i, j, startA)
      if (diff) return diff
      i = endA - 1; j = endB - 1
    } else if (x !== y) {
      const diff = x === '-' && y !== '_' ? chars('_', y) : y === '-' && x !== '_' ? chars(x, '_') : chars(x, y)
      if (diff) return diff
    }
  }
  if (i < a.length) return 1
  if (j < b.length) return -1
  if (a.length !== b.length) return a.length - b.length
  return ignoreCase ? compareProjectFileNames(a, b, false) : 0
}

export function sortProjectEntries(entries: readonly Entry[], settings: ProjectTreeSortSettings): Entry[] {
  const extension = (name: string): string | null => {
    const dot = name.lastIndexOf('.')
    return dot < 0 ? null : name.slice(dot + 1)
  }
  return [...entries].sort((a, b) => {
    if (settings.foldersAlwaysOnTop && a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    if (settings.sortKey === 'BY_TYPE') {
      // PsiFileNode.ExtensionSortKey uses case-sensitive String.compareTo;
      // PsiDirectoryNode uses the same key even for directory names with dots.
      // GroupByTypeComparator.compare puts a null extension after real keys.
      const x = extension(a.name); const y = extension(b.name)
      if (x !== y) {
        if (x === null) return 1
        if (y === null) return -1
        return x < y ? -1 : 1
      }
    }
    return compareProjectFileNames(a.name, b.name)
  })
}
