<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { GitGraph, RefreshCw, Search, Copy, GitPullRequestArrow } from 'lucide-vue-next'
import { isDesktop, request, type GitFullCommit, type GitFullLog, type GitRef } from '../bridge'

const props = defineProps<{ root: string; active: boolean }>()

const commits = ref<GitFullCommit[]>([])
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
const filter = ref('')
const selected = ref('')
const busy = ref(false)

const palette = ['#4FC1E9', '#A0D468', '#FFCE54', '#FC6E51', '#ED5565', '#AC92EC', '#48CFAD', '#EC87C0', '#5D9CEC', '#E8636F']
const listRef = ref<HTMLElement>()
const refColor = (ref: GitRef) => ref.type === 'tag' ? 'var(--warning)' : ref.type === 'remote' ? 'var(--secondary)' : 'var(--accent)'

function colorFor(hash: string): string {
  let h = 0
  for (let i = 0; i < hash.length; i++) h = ((h << 5) - h + hash.charCodeAt(i)) | 0
  return palette[Math.abs(h) % palette.length]
}

interface GraphRow {
  commit: GitFullCommit
  lane: number
  color: string
  // Parent links leaving this row downwards: a node-to-bottom-edge S-curve.
  down: Array<{ from: number; to: number; color: string }>
  // Stubs entering this row from above, from the top edge down to the node.
  up: Array<{ lane: number; color: string }>
  // Verticals that only pass through this row on their way to a later commit.
  pass: Array<{ lane: number; color: string }>
}

// One row of the canvas is exactly ROW_H CSS pixels tall and the viewBox uses the
// same units, so a user unit is a device-independent pixel and the drawing is not
// rescaled (the previous canvas had a broken viewBox, which clipped every lane).
const LANE_W = 14
const ROW_H = 26
const laneX = (lane: number) => lane * LANE_W + LANE_W / 2
// Both control points sit directly below/above the endpoints, so the curve leaves
// the node downwards and arrives at the next lane vertically: consecutive rows
// continue each other's line without a kink.
const LANE_PATH = (from: number, to: number) =>
  `M ${laneX(from)} ${ROW_H / 2} C ${laneX(from)} ${ROW_H * 0.75} ${laneX(to)} ${ROW_H * 0.75} ${laneX(to)} ${ROW_H}`

const graph = computed(() => {
  const list = filtered.value
  if (!list.length) return { rows: [] as GraphRow[], width: 0 }
  // Commits are listed child-before-parent, so a hash first shows up as a parent:
  // a lane is claimed then and released again once its own row is drawn, which
  // keeps the canvas as narrow as the number of concurrently open branches.
  const rowOf = new Map<string, number>()
  list.forEach((commit, index) => { if (!rowOf.has(commit.hash)) rowOf.set(commit.hash, index) })
  const laneOf = new Map<string, number>()
  const lanes: Array<string | null> = []
  const claimLane = (hash: string) => {
    const existing = laneOf.get(hash)
    if (existing !== undefined) return existing
    const free = lanes.indexOf(null)
    const lane = free >= 0 ? free : lanes.push(null) - 1
    laneOf.set(hash, lane)
    return lane
  }
  const rows: GraphRow[] = []
  const edges: Array<{ from: number; to: number; fromRow: number; targetRow: number; color: string }> = []
  list.forEach((commit, index) => {
    const lane = claimLane(commit.hash)
    lanes[lane] = null  // the commit itself occupies the lane for this row
    for (const parent of commit.parents) {
      const targetRow = rowOf.get(parent)
      // A parent missing from the list (shallow clone, grafted root) draws nothing.
      if (targetRow === undefined || targetRow <= index) continue
      const parentLane = claimLane(parent)
      lanes[parentLane] = parent
      edges.push({ from: lane, to: parentLane, fromRow: index, targetRow, color: colorFor(parent) })
    }
    rows.push({ commit, lane, color: colorFor(commit.hash), down: [], up: [], pass: [] })
  })
  for (const edge of edges) {
    rows[edge.fromRow]?.down.push({ from: edge.from, to: edge.to, color: edge.color })
    const target = rows[edge.targetRow]
    if (!target) continue
    // Whatever distance the edge spans, the last stretch falls into the target row
    // from above, and the rows in between carry it straight through.
    target.up.push({ lane: edge.to, color: edge.color })
    for (let row = edge.fromRow + 1; row < edge.targetRow; row++) rows[row]?.pass.push({ lane: edge.to, color: edge.color })
  }
  let laneCount = 1
  for (const row of rows) laneCount = Math.max(laneCount, row.lane + 1)
  for (const edge of edges) laneCount = Math.max(laneCount, edge.to + 1)
  return { rows, width: laneCount * LANE_W }
})

const filtered = computed(() => {
  const text = filter.value.trim().toLowerCase()
  if (!text) return commits.value
  return commits.value.filter(c =>
    c.subject.toLowerCase().includes(text) ||
    c.author.toLowerCase().includes(text) ||
    c.shortHash.toLowerCase().includes(text) ||
    c.refs.some(r => r.name.toLowerCase().includes(text)))
})

const selectedCommit = computed(() => commits.value.find(c => c.hash === selected.value) ?? null)

let loadToken = 0
async function load() {
  if (!isDesktop || !props.root || loading.value) return
  const token = ++loadToken
  loading.value = true
  error.value = ''
  try {
    const data = await request<GitFullLog>('git.logFull', { limit: 300 })
    // A commit list belongs to the root that was current when the request started;
    // another root took over in the meantime, so the answer is stale.
    if (token !== loadToken) return
    commits.value = data.commits
    loaded.value = true
    if (!selected.value && data.commits.length) selected.value = data.commits[0]!.hash
  } catch (caught) {
    if (token !== loadToken) return
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    if (token === loadToken) loading.value = false
  }
}

function select(hash: string) { selected.value = hash }

// Rows are options in a listbox: Enter/Space selects, arrows walk the history.
function rowKeys(index: number, event: KeyboardEvent) {
  const list = listRef.value
  if (!list) return
  const move = (next: number) => {
    event.preventDefault()
    const target = list.querySelectorAll<HTMLElement>('.vcslog-row')[next]
    if (!target) return
    select(graph.value.rows[next]!.commit.hash)
    target.focus()
    target.scrollIntoView({ block: 'nearest' })
  }
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(graph.value.rows[index]!.commit.hash); return }
  if (event.key === 'ArrowDown' && index + 1 < graph.value.rows.length) move(index + 1)
  else if (event.key === 'ArrowUp' && index > 0) move(index - 1)
  else if (event.key === 'Home' && index > 0) move(0)
  else if (event.key === 'End' && index + 1 < graph.value.rows.length) move(graph.value.rows.length - 1)
}

function copyFallback(text: string): boolean {
  // WebView2 gives the async clipboard only for focused documents; the selection
  // route still works when it refuses (no clipboard permission on file:// origins).
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  try { return document.execCommand('copy') } finally { area.remove() }
}

async function copyHash() {
  if (!selectedCommit.value) return
  const hash = selectedCommit.value.hash
  try { await navigator.clipboard.writeText(hash) }
  catch { if (!copyFallback(hash)) error.value = '无法写入剪贴板，请手动选中详情里的完整哈希复制。' }
}

// IDEA's VCS log popup: Cherry-Pick applies the selected commit onto the current
// branch (git cherry-pick); failures surface verbatim (conflicts, dirty tree).
async function cherryPick() {
  if (!selectedCommit.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await request('git.cherryPick', { commit: selectedCommit.value.hash })
    await load()
  } catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught) }
  finally { busy.value = false }
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

watch(() => props.active, active => { if (active && !loaded.value) void load() })
watch(() => props.root, () => {
  // Switching projects invalidates anything in flight: bump the token so a reply
  // for the previous repository cannot land on the new one.
  loadToken++
  loading.value = false
  loaded.value = false
  commits.value = []
  selected.value = ''
  if (isDesktop && props.active) void load()
})
onMounted(() => { if (props.active) void load() })
</script>

<template>
  <div class="vcslog-panel">
    <div class="panel-heading">
      <span><GitGraph :size="14" />VCS 日志</span>
      <div class="heading-actions">
        <span class="heading-count">{{ graph.rows.length }}</span>
        <button class="icon-button" title="刷新" aria-label="刷新提交历史" :disabled="!root || loading" @click="load"><RefreshCw :size="14" /></button>
      </div>
    </div>
    <label class="vcslog-filter">
      <Search :size="12" />
      <input v-model="filter" class="vcslog-input" aria-label="过滤提交" spellcheck="false" placeholder="按信息、作者、哈希或分支名过滤" />
    </label>
    <p v-if="!isDesktop" class="vcslog-note">浏览器预览没有 VCS 日志，请在桌面端使用。</p>
    <p v-else-if="error" class="vcslog-error">{{ error }}</p>
    <div class="vcslog-body">
      <div ref="listRef" class="vcslog-list" role="listbox" aria-label="提交列表">
        <div v-if="loading" class="vcslog-empty">加载中…</div>
        <template v-else-if="graph.rows.length">
          <div
            v-for="(row, index) in graph.rows" :key="row.commit.hash" class="vcslog-row" role="option"
            :class="{ selected: selected === row.commit.hash }" :aria-selected="selected === row.commit.hash"
            :tabindex="selected === row.commit.hash || (!selected && index === 0) ? 0 : -1"
            @click="select(row.commit.hash)" @keydown="rowKeys(index, $event)"
          >
            <!-- One canvas per row: width/height and viewBox use the same units, so
                 nothing is scaled and every lane has room. -->
            <svg
              class="vcslog-graph" :width="graph.width" :height="ROW_H" :viewBox="`0 0 ${graph.width} ${ROW_H}`"
              shape-rendering="geometricPrecision" aria-hidden="true" focusable="false"
            >
              <line
                v-for="(line, position) in row.pass" :key="`p${position}-${line.lane}`"
                :x1="laneX(line.lane)" y1="0" :x2="laneX(line.lane)" :y2="ROW_H" :stroke="line.color" stroke-width="1.5"
              />
              <line
                v-for="(stub, position) in row.up" :key="`u${position}-${stub.lane}`"
                :x1="laneX(stub.lane)" y1="0" :x2="laneX(stub.lane)" :y2="ROW_H / 2" :stroke="stub.color" stroke-width="1.5"
              />
              <path
                v-for="(edge, position) in row.down" :key="`d${position}-${edge.from}-${edge.to}`"
                :d="LANE_PATH(edge.from, edge.to)" fill="none" :stroke="edge.color" stroke-width="1.5"
              />
              <circle :cx="laneX(row.lane)" :cy="ROW_H / 2" r="3.5" :fill="row.color" />
            </svg>
            <span class="vcslog-refs">
              <span v-for="r in row.commit.refs" :key="r.name" class="vcslog-ref" :class="r.type" :style="{ borderColor: refColor(r) }">{{ r.name }}</span>
            </span>
            <span class="vcslog-subject">{{ row.commit.subject }}</span>
            <span class="vcslog-hash">{{ row.commit.shortHash }}</span>
            <span class="vcslog-meta">{{ row.commit.author }} · {{ shortDate(row.commit.date) }}</span>
          </div>
        </template>
        <div v-else-if="loaded" class="vcslog-empty">{{ commits.length ? '过滤后没有匹配。' : '仓库尚无提交。' }}</div>
        <div v-else class="vcslog-empty">打开 Git 仓库后显示提交图。</div>
      </div>
      <div v-if="selectedCommit" class="vcslog-detail">
        <div class="vcslog-detail-header">
          <span class="vcslog-detail-hash">{{ selectedCommit.shortHash }}</span>
          <button class="icon-button" title="复制完整哈希" @click="copyHash"><Copy :size="13" /></button>
          <button class="icon-button" :disabled="busy" title="摘取该提交到当前分支（cherry-pick）" aria-label="摘取提交" @click="cherryPick"><GitPullRequestArrow :size="13" /></button>
        </div>
        <h3 class="vcslog-detail-subject">{{ selectedCommit.subject }}</h3>
        <dl class="vcslog-detail-meta">
          <dt>作者</dt><dd>{{ selectedCommit.author }}</dd>
          <dt>日期</dt><dd>{{ shortDate(selectedCommit.date) }}</dd>
          <dt>提交</dt><dd class="vcslog-mono">{{ selectedCommit.hash }}</dd>
          <dt>父提交</dt><dd class="vcslog-mono">{{ selectedCommit.parents.length ? selectedCommit.parents.map(p => p.slice(0, 8)).join(', ') : '（根提交）' }}</dd>
          <dt v-if="selectedCommit.refs.length">引用</dt>
          <dd v-if="selectedCommit.refs.length">
            <span v-for="r in selectedCommit.refs" :key="r.name" class="vcslog-ref" :class="r.type" :style="{ borderColor: refColor(r) }">{{ r.name }}</span>
          </dd>
        </dl>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vcslog-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.vcslog-filter { display: flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--line); color: var(--muted); font-size: 11px; }
.vcslog-input { flex: 1; min-width: 0; min-height: var(--ctrl-height-sm); padding: 2px var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line); border-radius: var(--radius-xs); font: 11px/1.5 var(--font-mono); }
.vcslog-input:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.vcslog-note, .vcslog-error { margin: 0; padding: var(--space-2) var(--space-3); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.vcslog-note { color: var(--secondary); background: var(--rail); }
.vcslog-error { color: var(--error); background: var(--panel); border-bottom: 1px solid var(--line); }
.vcslog-body { flex: 1; display: flex; min-height: 0; overflow: hidden; }
.vcslog-list { flex: 1; min-width: 0; overflow: auto; }
.vcslog-row { display: flex; align-items: center; gap: var(--space-1); padding: 0 var(--space-2); height: 26px; border-bottom: 1px solid var(--line); cursor: pointer; font-size: 11px; white-space: nowrap; }
.vcslog-row:hover { background: var(--hover); }
.vcslog-row.selected { background: var(--selection); }
.vcslog-graph { flex-shrink: 0; }
.vcslog-refs { display: inline-flex; gap: var(--space-1); flex-shrink: 0; }
.vcslog-ref { display: inline-block; padding: 0 var(--space-1); border: 1px solid; border-radius: var(--radius-pill); font-size: 10px; line-height: 16px; }
.vcslog-ref.local { color: var(--accent); }
.vcslog-ref.remote { color: var(--secondary); }
.vcslog-ref.tag { color: var(--warning); }
.vcslog-subject { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
.vcslog-hash { flex-shrink: 0; color: var(--accent); font: 10px var(--font-mono); }
.vcslog-meta { flex-shrink: 0; color: var(--muted); font-size: 10px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
.vcslog-detail { width: 260px; flex-shrink: 0; border-left: 1px solid var(--line); overflow: auto; padding: var(--space-2) var(--space-3); }
.vcslog-detail-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-1); }
.vcslog-detail-hash { font: 12px var(--font-mono); color: var(--accent); }
.vcslog-detail-subject { font-size: 13px; font-weight: 600; color: var(--text); margin: 0 0 var(--space-2); line-height: 1.5; word-break: break-word; }
.vcslog-detail-meta { margin: 0; font-size: 11px; display: grid; grid-template-columns: 50px 1fr; gap: var(--space-1) var(--space-2); }
.vcslog-detail-meta dt { color: var(--muted); font-weight: 500; }
.vcslog-detail-meta dd { margin: 0; color: var(--text); word-break: break-all; }
.vcslog-mono { font-family: var(--font-mono); font-size: 10px; }
.vcslog-empty { padding: var(--space-4) var(--space-3); color: var(--muted); font-size: 11px; line-height: 1.7; }
</style>
