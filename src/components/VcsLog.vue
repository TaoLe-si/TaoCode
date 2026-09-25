<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { GitGraph, RefreshCw, Search, Copy, ExternalLink } from 'lucide-vue-next'
import { isDesktop, request, type GitFullCommit, type GitFullLog, type GitRef } from '../bridge'

const props = defineProps<{ root: string; active: boolean }>()
const emit = defineEmits<{ openDiff: [payload: { hash: string }] }>()

const commits = ref<GitFullCommit[]>([])
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
const filter = ref('')
const selected = ref('')

const palette = ['#4FC1E9', '#A0D468', '#FFCE54', '#FC6E51', '#ED5565', '#AC92EC', '#48CFAD', '#EC87C0', '#5D9CEC', '#E8636F']
const refColor = (ref: GitRef) => ref.type === 'tag' ? 'var(--warning)' : ref.type === 'remote' ? 'var(--secondary)' : 'var(--accent)'

function colorFor(hash: string): string {
  let h = 0
  for (let i = 0; i < hash.length; i++) h = ((h << 5) - h + hash.charCodeAt(i)) | 0
  return palette[Math.abs(h) % palette.length]
}

interface GraphRow { commit: GitFullCommit; lane: number; edges: GraphEdge[] }
interface GraphEdge { fromRow: number; fromLane: number; toRow: number; toLane: number; color: string }

const graph = computed(() => {
  const list = filtered.value
  if (!list.length) return { rows: [] as GraphRow[], edges: [] as GraphEdge[], width: 0 }
  const laneOf = new Map<string, number>()
  let nextLane = 0
  const rows: GraphRow[] = []
  const edges: GraphEdge[] = []
  const activeLanes = new Set<number>()

  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    let lane = laneOf.get(c.hash)
    if (lane === undefined) {
      lane = nextLane++
      laneOf.set(c.hash, lane)
    }
    activeLanes.add(lane)
    const rowEdges: GraphEdge[] = []
    for (let p = 0; p < c.parents.length; p++) {
      const parentHash = c.parents[p]
      let parentLane = laneOf.get(parentHash)
      if (parentLane === undefined) {
        parentLane = p === 0 ? lane : nextLane++
        laneOf.set(parentHash, parentLane)
      }
      const edge: GraphEdge = { fromRow: i, fromLane: lane, toRow: i + 1, toLane: parentLane, color: colorFor(parentHash) }
      edges.push(edge)
      rowEdges.push(edge)
    }
    rows.push({ commit: c, lane, edges: rowEdges })
  }
  return { rows, edges, width: nextLane }
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

async function load() {
  if (!isDesktop || !props.root || loading.value) return
  loading.value = true
  error.value = ''
  try {
    const data = await request<GitFullLog>('git.logFull', { limit: 300 })
    commits.value = data.commits
    loaded.value = true
    if (!selected.value && data.commits.length) selected.value = data.commits[0].hash
  } catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught) }
  finally { loading.value = false }
}

function select(hash: string) { selected.value = hash }

async function copyHash() {
  if (!selectedCommit.value) return
  try { await navigator.clipboard.writeText(selectedCommit.value.hash) } catch { /* fallback: no-op */ }
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const LANE_W = 14
const ROW_H = 26

watch(() => props.active, active => { if (active && !loaded.value) void load() })
watch(() => props.root, () => { loaded.value = false; commits.value = []; selected.value = '' })
onMounted(() => { if (props.active) void load() })
</script>

<template>
  <div class="vcslog-panel">
    <div class="panel-heading">
      <span><GitGraph :size="14" />VCS 日志</span>
      <div class="heading-actions">
        <span class="heading-count">{{ commits.length }}</span>
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
      <div class="vcslog-list">
        <div v-if="loading" class="vcslog-empty">加载中…</div>
        <template v-else-if="graph.rows.length">
          <div v-for="(row, idx) in graph.rows" :key="row.commit.hash" class="vcslog-row" :class="{ selected: selected === row.commit.hash }" @click="select(row.commit.hash)">
            <svg class="vcslog-graph" :width="Math.max(graph.width * LANE_W, LANE_W)" :height="ROW_H" viewBox="0 0 {{ Math.max(graph.width * LANE_W, LANE_W) }} {{ ROW_H }}">
              <template v-for="edge in row.edges" :key="`${edge.fromLane}-${edge.toLane}`">
                <line :x1="edge.fromLane * LANE_W + LANE_W / 2" :y1="0" :x2="edge.toLane * LANE_W + LANE_W / 2" :y2="ROW_H" :stroke="edge.color" stroke-width="1.5" stroke-opacity="0.7" />
              </template>
              <circle :cx="row.lane * LANE_W + LANE_W / 2" :cy="ROW_H / 2" r="3.5" :fill="colorFor(row.commit.hash)" />
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
        </div>
        <h3 class="vcslog-detail-subject">{{ selectedCommit.subject }}</h3>
        <dl class="vcslog-detail-meta">
          <dt>作者</dt><dd>{{ selectedCommit.author }}</dd>
          <dt>日期</dt><dd>{{ shortDate(selectedCommit.date) }}</dd>
          <dt>提交</dt><dd class="vcslog-mono">{{ selectedCommit.hash }}</dd>
          <dt>父提交</dt><dd class="vcslog-mono">{{ selectedCommit.parents.length ? selectedCommit.parents.map(p => p.slice(0, 8)).join(', ') : '（根提交）' }}</dd>
          <dt v-if="selectedCommit.refs.length">标签</dt>
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
