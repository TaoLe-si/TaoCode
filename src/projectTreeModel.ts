import { computed, nextTick, reactive, ref } from 'vue'
import { request, type Entry } from './bridge'
import { sortProjectEntries, type ProjectTreeSortSettings } from './projectTreeSort'

export interface SyntheticNode { path: string; label: string; icon: 'libraries' | 'scratches'; entries: Entry[] }
export interface ProjectTreeRow { entry: Entry; level: number; parent?: string; synthetic?: SyntheticNode }

// One model per mounted project view, never per directory or process-wide.
export function createProjectTreeModel(options: {
  entries: () => Entry[]
  synthetic: () => SyntheticNode[]
  depth: () => number
  projectName?: () => string | undefined
  sortSettings?: () => ProjectTreeSortSettings | undefined
  error: (message: string) => void
}) {
  const hasProjectRoot = () => options.depth() === 0 && options.projectName?.() !== undefined
  const expanded = reactive(new Set<string>(hasProjectRoot() ? [''] : []))
  const selected = ref('')
  const selection = reactive(new Set<string>())
  let anchor: string | undefined
  const loading = reactive(new Set<string>())
  const children = reactive(new Map<string, Entry[]>())
  const elements = new Map<string, HTMLElement>()
  const pending = new Map<string, Promise<Entry[] | undefined>>()
  let epoch = 0
  let selectionRevision = 0
  let disposed = false
  const valid = (token: number) => !disposed && token === epoch
  const syntheticEntry = (node: SyntheticNode): Entry => ({ path: node.path, name: node.label, kind: 'directory' })
  const project = (entries: Entry[]) => {
    const settings = options.sortSettings?.()
    return settings ? sortProjectEntries(entries, settings) : entries
  }
  const roots = (): Entry[] => [
    ...(hasProjectRoot() ? [{ path: '', name: options.projectName!()!, kind: 'directory' as const }] : project(options.entries())),
    ...options.synthetic().map(syntheticEntry),
  ]
  const synthetic = (path: string) => options.synthetic().find(node => node.path === path)
  const descendants = (path: string) => project(path === '' && hasProjectRoot() ? options.entries() : synthetic(path)?.entries ?? children.get(path) ?? [])
  const rows = computed(() => {
    const result: ProjectTreeRow[] = []
    const seen = new Set<string>()
    function visit(entries: Entry[], level: number, parent?: string) {
      for (const entry of entries) {
        if (seen.has(entry.path)) continue
        seen.add(entry.path)
        result.push({ entry, level, parent, synthetic: synthetic(entry.path) })
        if (expanded.has(entry.path)) visit(descendants(entry.path), level + 1, entry.path)
      }
    }
    visit(roots(), options.depth())
    return result
  })
  const tabStop = computed(() => rows.value.some(row => row.entry.path === selected.value)
    ? selected.value : rows.value[0]?.entry.path)

  function select(path: string, modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}, focusOnly = false) {
    selectionRevision++
    const additive = modifiers.ctrlKey || modifiers.metaKey
    if (modifiers.shiftKey) {
      const start = rows.value.findIndex(row => row.entry.path === (anchor ?? selected.value))
      const end = rows.value.findIndex(row => row.entry.path === path)
      if (!additive) selection.clear()
      if (start >= 0 && end >= 0) {
        for (const row of rows.value.slice(Math.min(start, end), Math.max(start, end) + 1)) selection.add(row.entry.path)
      } else selection.add(path)
    } else if (!focusOnly) {
      if (additive) {
        if (selection.has(path)) selection.delete(path)
        else selection.add(path)
      } else { selection.clear(); selection.add(path) }
      anchor = path
    }
    selected.value = path
  }
  function onFocus(path: string) {
    // DOM focus must not turn Ctrl/Shift selection into a single selection.
    if (selected.value !== path) select(path, {}, true)
  }
  function getSelectedEntries(): Entry[] {
    return rows.value.filter(row => selection.has(row.entry.path)).map(row => row.entry)
  }
  function canExpandRecursively() {
    return getSelectedEntries().some(entry => entry.kind === 'directory')
  }
  async function focus(path: string, token = epoch, revision = selectionRevision) {
    await nextTick()
    if (!valid(token) || revision !== selectionRevision) return
    const element = elements.get(path)
    element?.focus({ preventScroll: true })
    element?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  function report(error: unknown, token: number) {
    if (valid(token)) options.error(error instanceof Error ? error.message : String(error))
  }
  async function load(entry: Entry, token: number): Promise<Entry[] | undefined> {
    if (!valid(token) || entry.kind !== 'directory') return
    if (entry.path === '' && hasProjectRoot()) return options.entries()
    const node = synthetic(entry.path)
    if (node) return node.entries
    // Pseudo library entries have no filesystem capability.
    if (entry.path.startsWith('\u0000')) return []
    if (children.has(entry.path)) return children.get(entry.path)
    const existing = pending.get(entry.path)
    if (existing) return existing
    loading.add(entry.path)
    const job = request<Entry[]>('workspace.list', { path: entry.path }).then(entries => {
      if (!valid(token)) return undefined
      children.set(entry.path, entries)
      return entries
    }).catch(error => { report(error, token); return undefined }).finally(() => {
      if (valid(token)) {
        pending.delete(entry.path)
        loading.delete(entry.path)
      }
    })
    pending.set(entry.path, job)
    return job
  }
  async function expand(entry: Entry, token = epoch) {
    const entries = await load(entry, token)
    if (entries && valid(token)) expanded.add(entry.path)
    return entries
  }
  function cancelPending() {
    epoch++
    pending.clear()
    loading.clear()
  }
  function collapse(path: string) {
    // Invalidates pending recursive/reveal operations too: a late response must
    // not reopen a node the user has just collapsed.
    cancelPending()
    const index = rows.value.findIndex(row => row.entry.path === path)
    const row = rows.value[index]
    const hidden = new Set<string>()
    if (row) {
      for (let i = index + 1; i < rows.value.length && rows.value[i]!.level > row.level; i++) hidden.add(rows.value[i]!.entry.path)
    }
    const moveFocus = hidden.has(selected.value)
    let removedSelection = false
    for (const child of hidden) if (selection.delete(child)) removedSelection = true
    if (removedSelection) selection.add(path)
    if (moveFocus) { select(path, {}, true); void focus(path) }
    expanded.delete(path)
  }
  function toggle(entry: Entry) {
    if (expanded.has(entry.path)) collapse(entry.path)
    else void expand(entry)
  }
  function collapseAll() {
    const selectedIndex = rows.value.findIndex(row => row.entry.path === selected.value)
    let ancestor = selectedIndex
    while (ancestor > 0 && rows.value[ancestor]!.level > options.depth()) ancestor--
    const path = rows.value[ancestor]?.entry.path
    cancelPending()
    expanded.clear()
    if (path !== undefined) { select(path); void focus(path) }
  }
  async function visit(entry: Entry, token: number, seen: Set<string>) {
    if (!valid(token) || entry.kind !== 'directory' || seen.has(entry.path)) return
    seen.add(entry.path)
    const entries = await expand(entry, token)
    if (!entries || !valid(token)) return
    for (const child of entries) await visit(child, token, seen)
  }
  async function expandAll() {
    const token = epoch
    const seen = new Set<string>()
    for (const entry of roots()) {
      // External Libraries is deliberately excluded from the bulk action.
      if (synthetic(entry.path)?.icon !== 'libraries') await visit(entry, token, seen)
    }
  }
  async function expandRecursively(path?: string) {
    const entries = path !== undefined ? rows.value.filter(row => row.entry.path === path).map(row => row.entry) : getSelectedEntries()
    const token = epoch
    const seen = new Set<string>()
    for (const entry of entries) if (entry.kind === 'directory') await visit(entry, token, seen)
  }
  function isAncestor(entry: Entry, path: string): boolean {
    if (entry.path === '' && hasProjectRoot()) return !path.startsWith('\u0000') && options.entries().some(child => child.path === path || isAncestor(child, path))
    return entry.kind === 'directory' && !entry.path.startsWith('\u0000') && path.startsWith(`${entry.path.replace(/\/$/, '')}/`)
  }
  async function locate(path: string, token: number, revision: number) {
    let entries = roots()
    const seen = new Set<string>()
    while (valid(token) && revision === selectionRevision) {
      const exact = entries.find(entry => entry.path === path)
      if (exact) { select(path); await focus(path, token); return }
      const parent = entries.filter(entry => isAncestor(entry, path) || synthetic(entry.path)?.entries.some(child => child.path === path || isAncestor(child, path)))
        .sort((a, b) => a.path === '' ? -1 : b.path === '' ? 1 : b.path.length - a.path.length)[0]
      if (!parent || seen.has(parent.path)) return
      seen.add(parent.path)
      const loaded = await expand(parent, token)
      if (!loaded) return
      entries = loaded
    }
  }
  // Preserve the existing synchronous readiness result; loading/focus completes
  // asynchronously when false. Readiness never substitutes for actual selection.
  function reveal(path: string): boolean {
    const ready = rows.value.some(row => row.entry.path === path)
    const revision = ++selectionRevision
    if (ready) { select(path); void focus(path) }
    else void locate(path, epoch, revision)
    return ready
  }
  async function navigate(event: KeyboardEvent, entry: Entry, open: (path: string) => void) {
    if (event.altKey) return
    const additive = event.ctrlKey || event.metaKey
    if (additive && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      selectionRevision++
      for (const row of rows.value) selection.add(row.entry.path)
      return
    }
    const index = rows.value.findIndex(row => row.entry.path === entry.path)
    let destination: string | undefined
    switch (event.key) {
      case 'ArrowDown': destination = rows.value[Math.min(index + 1, rows.value.length - 1)]?.entry.path; break
      case 'ArrowUp': destination = rows.value[Math.max(index - 1, 0)]?.entry.path; break
      case 'Home': destination = rows.value[0]?.entry.path; break
      case 'End': destination = rows.value[rows.value.length - 1]?.entry.path; break
      case 'ArrowRight':
        event.preventDefault()
        if (entry.kind === 'directory') {
          if (!expanded.has(entry.path)) await expand(entry)
          else destination = rows.value[index + 1]?.parent === entry.path ? rows.value[index + 1]?.entry.path : undefined
        }
        break
      case 'ArrowLeft':
        if (expanded.has(entry.path)) collapse(entry.path)
        else destination = rows.value[index]?.parent
        break
      case 'Enter':
        if (entry.kind === 'directory') toggle(entry)
        else if (!entry.path.startsWith('\u0000')) open(entry.path)
        break
      case ' ': select(entry.path, event); break
      default: return
    }
    event.preventDefault()
    if (destination !== undefined) { select(destination, event, additive && !event.shiftKey); await focus(destination) }
  }
  async function refresh() {
    const wantedExpanded = new Set(expanded)
    const wantedSelection = new Set(selection)
    const wantedFocus = selected.value
    const wantedAnchor = anchor
    const hadFocus = elements.get(wantedFocus) === document.activeElement
    cancelPending()
    const token = epoch
    const revision = selectionRevision
    children.clear()
    // Keep expansion flags while listings are replaced, then revalidate against
    // fresh entries. Never reuse stale cached directory contents after refresh.
    const seen = new Set<string>()
    async function restore(entries: Entry[]) {
      for (const entry of entries) {
        if (!valid(token) || seen.has(entry.path)) continue
        seen.add(entry.path)
        if (entry.kind === 'directory' && wantedExpanded.has(entry.path)) {
          const loaded = await load(entry, token)
          if (loaded && valid(token)) await restore(loaded)
        }
      }
    }
    await restore(roots())
    if (!valid(token)) return
    for (const path of expanded) if (!seen.has(path)) expanded.delete(path)
    const visible = new Set(rows.value.map(row => row.entry.path))
    if (revision === selectionRevision) {
      selection.clear()
      for (const path of wantedSelection) if (visible.has(path)) selection.add(path)
      selected.value = visible.has(wantedFocus) ? wantedFocus : selection.values().next().value ?? ''
      anchor = wantedAnchor !== undefined && visible.has(wantedAnchor) ? wantedAnchor : selected.value
      if (hadFocus && visible.has(selected.value)) await focus(selected.value, token, revision)
    } else {
      for (const path of selection) if (!visible.has(path)) selection.delete(path)
    }
  }
  function reset() {
    cancelPending()
    selectionRevision++
    expanded.clear()
    if (hasProjectRoot()) expanded.add('')
    children.clear()
    selected.value = ''
    selection.clear()
    anchor = undefined
    elements.clear()
  }
  function dispose() { reset(); disposed = true }
  return { rows, expanded, selected, selection, loading, children, elements, tabStop, select, onFocus, focus, toggle, collapseAll, expandAll, expandRecursively, getSelectedEntries, canExpandRecursively, reveal, navigate, refresh, reset, dispose }
}
