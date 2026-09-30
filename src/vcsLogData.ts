import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { isDesktop, request, type GitFullCommit, type GitFullLog, type GitLogQuery, type GitCommitDetails, type GitCommitChanges } from './bridge'

export function useVcsLogData(root: Ref<string>, active: Ref<boolean>) {
  const commits = ref<GitFullCommit[]>([])
  const selected = ref('')
  const query = ref<GitLogQuery>({})
  const loading = ref(false)
  const loaded = ref(false)
  const hasMore = ref(false)
  const error = ref('')
  const details = ref<GitCommitDetails | null>(null)
  const changes = ref<GitCommitChanges | null>(null)
  const detailsLoading = ref(false)
  const changesLoading = ref(false)
  const detailsError = ref('')
  const changesError = ref('')
  const busy = ref(false)
  const navigating = ref(false)
  const selectedCommit = computed(() => commits.value.find(c => c.hash === selected.value) ?? null)
  let generation = 0
  let logToken = 0
  let selectionToken = 0
  let navigationToken = 0
  let offset = 0
  interface Location { query: GitLogQuery; selected: string; commits: GitFullCommit[]; offset: number; hasMore: boolean; loaded: boolean }
  const back = ref<Location[]>([]), forward = ref<Location[]>([])
  function snapshot(): Location { return { query: { ...query.value, refs: query.value.refs?.slice() }, selected: selected.value, commits: commits.value.slice(), offset, hasMore: hasMore.value, loaded: loaded.value } }
  function remember() { back.value = [...back.value.slice(-29), snapshot()]; forward.value = [] }
  async function travel(direction: 'back' | 'forward') {
    const source = direction === 'back' ? back : forward
    const target = direction === 'back' ? forward : back
    const location = source.value.pop()
    if (!location) return
    target.value.push(snapshot())
    logToken++; navigationToken++; navigating.value = false; loading.value = false; error.value = ''
    query.value = location.query; commits.value = location.commits; offset = location.offset
    hasMore.value = location.hasMore; loaded.value = location.loaded
    if (selected.value === location.selected) void loadSelection()
    else selected.value = location.selected
    // A location captured while its initial query was in flight has no completed
    // page to restore. Reissue it rather than stranding forward navigation empty.
    const current = scope()
    const token = navigationToken
    if (!location.loaded && !await load()) return
    if (current() && token === navigationToken) return selected.value
  }
  const canBack = computed(() => back.value.length > 0), canForward = computed(() => forward.value.length > 0)
  function select(hash: string) { if (selected.value !== hash) { remember(); selected.value = hash } }
  const message = (caught: unknown) => caught instanceof Error ? caught.message : String(caught)
  function scope() { const current = generation; return () => current === generation }
  async function load(more = false): Promise<boolean> {
    if (!isDesktop || !root.value || (more && (loading.value || !hasMore.value))) return false
    const token = ++logToken
    const current = scope()
    loading.value = true
    error.value = ''
    if (!more) { offset = 0; hasMore.value = false }
    try {
      const data = await request<GitFullLog>('git.logFull', { ...query.value, limit: 200, offset: more ? offset : 0 })
      if (!current() || token !== logToken) return false
      const known = new Set(more ? commits.value.map(c => c.hash) : [])
      commits.value = [...(more ? commits.value : []), ...data.commits.filter(c => !known.has(c.hash))]
      offset = data.offset + data.commits.length
      hasMore.value = data.hasMore && data.commits.length > 0
      loaded.value = true
      if (!commits.value.some(c => c.hash === selected.value)) selected.value = commits.value[0]?.hash ?? ''
      return true
    } catch (caught) {
      if (current() && token === logToken) error.value = message(caught)
      return false
    } finally { if (current() && token === logToken) loading.value = false }
  }
  async function loadSelection() {
    const token = ++selectionToken
    const current = scope()
    const revision = selected.value
    details.value = null; changes.value = null
    detailsError.value = ''; changesError.value = ''
    detailsLoading.value = false; changesLoading.value = false
    if (!revision || !isDesktop) return
    detailsLoading.value = true; changesLoading.value = true
    const valid = () => current() && token === selectionToken
    await Promise.all([
      request<GitCommitDetails>('git.commitDetails', { revision }).then(data => { if (valid()) details.value = data })
        .catch(caught => { if (valid()) detailsError.value = message(caught) })
        .finally(() => { if (valid()) detailsLoading.value = false }),
      request<GitCommitChanges>('git.commitChanges', { revision }).then(data => { if (valid()) changes.value = data })
        .catch(caught => { if (valid()) changesError.value = message(caught) })
        .finally(() => { if (valid()) changesLoading.value = false }),
    ])
  }
  watch(selected, () => { void loadSelection() }, { flush: 'sync' })
  function applyQuery(value: GitLogQuery) {
    remember()
    navigationToken++; navigating.value = false
    query.value = value
    commits.value = []; selected.value = ''; loaded.value = false
    void load()
  }
  async function navigate(hash: string): Promise<boolean> {
    if (hash !== selected.value) remember()
    const token = ++navigationToken
    const current = scope()
    const valid = () => current() && token === navigationToken
    navigating.value = true
    try {
      if (!commits.value.some(c => c.hash === hash)) {
        // Start from the requested commit's reachable history, not an invented row.
        query.value = { refs: [hash] }
        commits.value = []; selected.value = ''; loaded.value = false
        if (!await load() || !valid()) return false
      }
      if (!valid()) return false
      if (!commits.value.some(c => c.hash === hash)) { error.value = `无法在历史中定位 ${hash}`; return false }
      selected.value = hash
      return true
    } finally { if (valid()) navigating.value = false }
  }
  async function cherryPick() {
    if (!isDesktop || !selected.value || busy.value) return
    const current = scope()
    const commit = selected.value
    busy.value = true; error.value = ''
    try {
      await request('git.cherryPick', { commit })
      if (current()) { await load(); if (current()) await loadSelection() }
    } catch (caught) { if (current()) error.value = message(caught) }
    finally { if (current()) busy.value = false }
  }
  // 日志窗口提交行右键菜单里那三条（`Vcs.Log.ContextMenu` 一族，模型与文案见 `src/vcsLogMenu.ts`）。
  async function resetTo(hash: string, mode: string) {
    if (!isDesktop || !hash || busy.value) return
    const current = scope()
    busy.value = true; error.value = ''
    try {
      await request('git.reset', { target: hash, mode })
      if (current()) { await load(); if (current()) await loadSelection() }
    } catch (caught) { if (current()) error.value = message(caught) }
    finally { if (current()) busy.value = false }
  }
  async function uncommit() {
    if (!isDesktop || busy.value) return
    const current = scope()
    busy.value = true; error.value = ''
    try {
      // `GitUncommitAction`：只对最后一个提交可用，落到原生是 `reset --soft HEAD~1`
      // （改动回暂存区，等于"撤消这次提交但留着内容"）。
      await request('git.reset', { target: 'HEAD~1', mode: 'soft' })
      if (current()) { await load(); if (current()) await loadSelection() }
    } catch (caught) { if (current()) error.value = message(caught) }
    finally { if (current()) busy.value = false }
  }
  async function createTagOn(hash: string, name: string) {
    if (!isDesktop || !hash || busy.value) return
    const current = scope()
    busy.value = true; error.value = ''
    try {
      await request('git.tag.create', { name, target: hash })
      if (current()) { await load(); if (current()) await loadSelection() }
    } catch (caught) { if (current()) error.value = message(caught) }
    finally { if (current()) busy.value = false }
  }
  watch(root, () => {
    generation++; logToken++; selectionToken++; navigationToken++
    back.value = []; forward.value = []
    loading.value = false; busy.value = false; navigating.value = false
    loaded.value = false; hasMore.value = false; offset = 0
    commits.value = []; selected.value = ''; query.value = {}; error.value = ''
    details.value = null; changes.value = null; detailsError.value = ''; changesError.value = ''
    detailsLoading.value = false; changesLoading.value = false
    if (active.value) void load()
  }, { flush: 'sync' })
  watch(active, value => { if (value && !loaded.value) void load() }, { immediate: true })
  onBeforeUnmount(() => { generation++; logToken++; selectionToken++; navigationToken++ })
  return { commits, selected, query, loading, loaded, hasMore, error, details, changes, detailsLoading, changesLoading,
    canBack, canForward, travel, select, detailsError, changesError, busy, navigating, selectedCommit, load, applyQuery, navigate, cherryPick, loadSelection, scope,
    resetTo, uncommit, createTagOn }
}
