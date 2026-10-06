import { computed, nextTick, reactive, ref } from 'vue'
import { request, type Entry } from './bridge.ts'
import { sortProjectEntries, type ProjectTreeSortSettings } from './projectTreeSort.ts'
import { DEFAULT_NESTING_RULES, nestSiblings, type NestingRule } from './projectTreeNesting.ts'
import { MAX_COMPACT_CHAIN, compactName, singleDirectoryChild } from './projectTreeCompactDirs.ts'

export interface SyntheticNode { path: string; label: string; icon: 'libraries' | 'scratches'; entries: Entry[] }
export interface ProjectTreeRow { entry: Entry; level: number; parent?: string; synthetic?: SyntheticNode; nested?: boolean }

// One model per mounted project view, never per directory or process-wide.
export function createProjectTreeModel(options: {
  entries: () => Entry[]
  synthetic: () => SyntheticNode[]
  depth: () => number
  projectName?: () => string | undefined
  sortSettings?: () => ProjectTreeSortSettings | undefined
  /** 文件嵌套规则（`pv/project-view-nodes` 的 File Nesting）；缺省用本仓默认表。 */
  nestingRules?: () => readonly NestingRule[]
  /** 「压缩目录」（`ProjectView.CompactDirectories`，上游默认关）；缺省关。 */
  compactDirs?: () => boolean
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
  const nestingRules = () => options.nestingRules?.() ?? DEFAULT_NESTING_RULES
  const nest = (entries: Entry[]) => nestSiblings(entries, nestingRules())
  /**
   * 「压缩目录」（`ProjectView.CompactDirectories`）：只有一个子目录的目录与那个子目录并成一行 ——
   * 上游那条 while 在 `ScopeViewTreeModel.java:595-608`，`getSingleDirectory` 在 `:657-661`，
   * 显示名的拼接在 `:789-792`。规则本体在 `src/projectTreeCompactDirs.ts`，这里只做它做不了的那一半：
   * 本仓的目录内容是**点开才向宿主取**的，所以要先把链上每一格的列表取到缓存里，行才能一出现就是并好的样子
   * （上游的 VFS/PSI 缓存是现成的，取子列表不要钱；这里要，所以链只往上取一层，不再往下递归）。
   */
  const compactOn = () => options.compactDirs?.() ?? false
  const compacted = reactive(new Map<string, Entry>())
  async function resolveChain(head: Entry, token: number): Promise<void> {
    if (head.kind !== 'directory' || head.path === '' || head.path.startsWith('\u0000') || synthetic(head.path)) return
    const names = [head.name]
    let current = head
    while (names.length < MAX_COMPACT_CHAIN) {
      const listing = await fetch(current, token)
      if (!listing || !valid(token)) break
      const only = singleDirectoryChild(listing)
      if (!only) break
      names.push(only.name)
      current = only
    }
    // depth>1 才真的并起来了；否则把这一格清掉，行就用它自己的名字（上游不加 mapper 的那条分支）。
    if (names.length > 1) compacted.set(head.path, { ...current, name: compactName(names) })
    else compacted.delete(head.path)
  }
  async function resolveChainsFor(listing: readonly Entry[], token: number): Promise<void> {
    if (!compactOn()) { compacted.clear(); return }
    for (const entry of listing) {
      await resolveChain(entry, token)
      if (!valid(token)) return
    }
  }
  const compactOf = (entry: Entry): Entry =>
    compactOn() && entry.kind === 'directory' ? compacted.get(entry.path) ?? entry : entry
  // 一个路径所在的同级列表（文件嵌套只认同一目录内的兄弟）。
  // 顶层那一格有两种：有项目根行时兄弟是**根行下面的**列表（`descendants('')`），
  // 嵌入树（depth>0、没有根行）时兄弟就是 `roots()` 本身。此前一律取 `roots()`，
  // 于是项目根行下面那层的文件永远找不到父、点不开嵌套（`hasNested` 恒 false）。
  const listingFor = (path: string): Entry[] => {
    const slash = path.lastIndexOf('/')
    if (slash >= 0) return descendants(path.slice(0, slash))
    return hasProjectRoot() ? descendants('') : roots()
  }
  const nestedChildren = (path: string): Entry[] => nest(listingFor(path)).nested.get(path) ?? []
  const hasNested = (path: string): boolean => nestedChildren(path).length > 0
  function nestingParentPath(path: string, list: Entry[]): string | undefined {
    const { nested } = nest(list)
    for (const [parentPath, items] of nested) if (items.some(item => item.path === path)) return parentPath
    return undefined
  }
  const rows = computed(() => {
    const result: ProjectTreeRow[] = []
    const seen = new Set<string>()
    function visit(entries: Entry[], level: number, parent?: string, nested = false) {
      const { visible, nested: nestedMap } = nest(entries)
      for (const raw of visible) {
        // 压缩目录只是**换了这一行代表哪个目录**（上游 `children.add(mapper.apply(parent, child, icon))`
        // 加的就是走到底的那个 child）：行指向最深的那一格，名字是整条链。
        const entry = compactOf(raw)
        if (seen.has(entry.path)) continue
        seen.add(entry.path)
        const children = nestedMap.get(raw.path)
        result.push({ entry, level, parent, synthetic: synthetic(entry.path), nested })
        if (expanded.has(entry.path)) visit(children ?? descendants(entry.path), level + 1, entry.path, children !== undefined)
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
    // 上游 `DefaultTreeExpander.kt:42` 的 `canExpandSelected` 只看「有没有选中」。本仓多守一条
    // 「这一行开得出东西」，但不再把它限制成目录 —— 「文件嵌套」的父行是文件，照样开得出子行。
    return getSelectedEntries().some(entry => entry.kind === 'directory' || hasNested(entry.path))
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
  async function fetch(entry: Entry, token: number): Promise<Entry[] | undefined> {
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
  /**
   * 取一层列表 + 把这一层里每个目录的压缩链算好。**顺序不能反**：`expanded` 是在 `expand` 里
   * 等这个函数回来才加上的，所以一行第一次出现就已经是并好的名字，不会先显示 `src` 再跳成
   * `src/components/ui`（上游没有这个问题，因为它的子列表是同步的）。
   */
  async function load(entry: Entry, token: number): Promise<Entry[] | undefined> {
    const listing = await fetch(entry, token)
    if (listing && valid(token)) await resolveChainsFor(listing, token)
    return listing
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
    if (entry.kind === 'directory') {
      if (expanded.has(entry.path)) collapse(entry.path)
      else void expand(entry)
      return
    }
    // 文件行只有「文件嵌套」这一种可展开性：父文件展开后露出它名下的子文件。
    if (!hasNested(entry.path)) return
    if (expanded.has(entry.path)) collapse(entry.path)
    else expanded.add(entry.path)
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
  /**
   * 批量展开（`expandAll` / `expandRecursively`）共用的一趟递归。开的是**任何有子行的行**，
   * 不是只开目录：上游那两个动作都只经 `TreeExpander`
   * （`platform/lang-impl/src/com/intellij/ide/projectView/actions/ExpandRecursivelyAction.kt:29-31`
   * 与 `.../ProjectViewExpandAllAction.kt:17-22`）→ `DefaultTreeExpander.kt:21-36`
   * → `TreeUtil.java:1084`，条件只有「节点自己豁免不」（`AbstractTreeNode.java:138-140` 默认 true，
   * 项目视图里让开的是外部库那一条 `ExternalLibrariesNode.java:61-64`，见下面 `expandAll` 的注释）。
   * 目录之外还有「文件嵌套」的父行：它是文件，名下却挂着子行
   * （`platform/lang-impl/src/com/intellij/ide/projectView/impl/nodes/NestingTreeNode.java:43-51`，
   * `getChildrenImpl()` = 嵌套子文件 + 自己的），所以这一支也得开。
   */
  async function visit(entry: Entry, token: number, seen: Set<string>) {
    if (!valid(token) || seen.has(entry.path)) return
    if (entry.kind !== 'directory') {
      if (!hasNested(entry.path)) return
      seen.add(entry.path)
      // 与 `toggle()` 那条一样：文件行的子项来自同一份同级列表，不需要向宿主取。
      expanded.add(entry.path)
      for (const child of nestedChildren(entry.path)) await visit(child, token, seen)
      return
    }
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
    for (const entry of entries) await visit(entry, token, seen)
  }
  function isAncestor(entry: Entry, path: string): boolean {
    if (entry.path === '' && hasProjectRoot()) return !path.startsWith('\u0000') && options.entries().some(child => child.path === path || isAncestor(child, path))
    return entry.kind === 'directory' && !entry.path.startsWith('\u0000') && path.startsWith(`${entry.path.replace(/\/$/, '')}/`)
  }
  async function locate(path: string, token: number, revision: number) {
    let entries = roots()
    const seen = new Set<string>()
    while (valid(token) && revision === selectionRevision) {
      // 目标被文件嵌套收在某个父行下时，先展开那一行（上游 TreeSpeedSearch 也会展开祖先）。
      const nestingParent = nestingParentPath(path, entries)
      if (nestingParent) expanded.add(nestingParent)
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
      for (const raw of entries) {
        const entry = compactOf(raw)
        if (!valid(token) || seen.has(entry.path)) continue
        // 原始路径与「并好之后这一行真正代表的路径」都记下：`expanded` 存的是后者，
        // 下面那条 revalidate 不能把它当成已经消失的节点删掉。
        seen.add(raw.path)
        seen.add(entry.path)
        if (entry.kind === 'directory' && wantedExpanded.has(entry.path)) {
          const loaded = await load(entry, token)
          if (loaded && valid(token)) await restore(loaded)
        }
      }
    }
    await restore(roots())
    // 没有项目根行时，`roots()` 这一层就是顶层列表，它自己的链没有别的入口去算（有项目根行时
    // 由上面那次 `load('')` 顺带算好）。
    if (valid(token) && !hasProjectRoot()) await resolveChainsFor(roots(), token)
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
    compacted.clear()
    selected.value = ''
    selection.clear()
    anchor = undefined
    elements.clear()
  }
  function dispose() { reset(); disposed = true }
  return { rows, expanded, selected, selection, loading, children, elements, tabStop, select, onFocus, focus, toggle, collapseAll, expandAll, expandRecursively, getSelectedEntries, canExpandRecursively, reveal, navigate, refresh, reset, dispose, hasNested }
}
