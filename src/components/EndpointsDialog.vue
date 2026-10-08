<script setup lang="ts">
// 「端点」对话框 —— 上游 `microservices` 的 `EndpointsView`（工具窗口，树按
// 模块/框架/HTTP 方法分组）在无插件宿主下的对应物：扫描工作区的路由声明，
// 按方法/路径列出，点一行跳到声明处。解析规则与索引在 src/endpointIndex.ts，
// 类级前缀合并与客户端调用在 src/endpointRoutes.ts（上游 `EndpointsModel` 把类级
// `@RequestMapping` 与方法路径拼成完整 URL，视图里控制器端点与客户端调用并排显示）。
// 后缀合并/客户端扫描要全文：读 `search.run` 命中所在的文件（上限 + 失败不报错，读不到就跳过）。
import { computed, onMounted, ref } from 'vue'
import { RefreshCw, X } from 'lucide-vue-next'
import { isDesktop, request, type DocumentData, type SearchMatch, type SearchResult } from '../bridge'
import { buildEndpointIndex, ENDPOINT_SCAN_QUERY, endpointSummary, type EndpointEntry } from '../endpointIndex'
import { buildEndpointReport, reportClientSummary } from '../endpointRoutes'
import { iconSize } from '../uiIcons'

const props = defineProps<{ root: string }>()
const emit = defineEmits<{ (event: 'open', payload: { path: string; line: number }): void; (event: 'close'): void }>()

/** 全文读取的文件上限（与打开的文件数同阶；再多就不值得为前缀合并读盘了）。 */
const FILE_READ_LIMIT = 80
/** 并发读盘的分批大小（IPC 一批太多会卡住桥）。 */
const READ_BATCH = 8

const rawEntries = ref<EndpointEntry[]>([])
const fileTexts = ref<Record<string, string>>({})
const skippedFiles = ref(0)
const includeClients = ref(true)
const running = ref(false)
const scanned = ref(false)
const truncated = ref(false)
const error = ref('')
const query = ref('')

const entries = computed(() => buildEndpointReport(rawEntries.value, fileTexts.value, includeClients.value))

const rows = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return entries.value
  return entries.value.filter(entry =>
    entry.route.toLowerCase().includes(needle) || entry.method.toLowerCase().includes(needle) ||
    entry.framework.toLowerCase().includes(needle) || entry.path.toLowerCase().includes(needle))
})
const summary = computed(() => {
  if (!entries.value.length) return '没有扫描到端点'
  const clients = reportClientSummary(entries.value)
  return clients ? `${endpointSummary(entries.value)}；${clients}` : endpointSummary(entries.value)
})

/** 读命中文件全文；读不到的跳过（前缀合并在缺全文的文件上原样保留条目）。 */
async function readFileTexts(paths: string[]) {
  const texts: Record<string, string> = {}
  let skipped = 0
  for (let start = 0; start < paths.length; start += READ_BATCH) {
    const batch = paths.slice(start, start + READ_BATCH)
    const docs = await Promise.all(batch.map(async path => {
      try {
        return await request<DocumentData>('file.read', { path })
      } catch {
        return null
      }
    }))
    for (const doc of docs) {
      if (doc && typeof doc.content === 'string') texts[doc.path.replace(/\\/g, '/')] = doc.content
      else ++skipped
    }
  }
  return { texts, skipped }
}

async function scan() {
  if (!isDesktop || !props.root || running.value) return
  running.value = true
  error.value = ''
  try {
    const result = await request<SearchResult>('search.run', { query: ENDPOINT_SCAN_QUERY, regex: true, caseSensitive: true, wholeWord: false, include: '', exclude: '' })
    const found = buildEndpointIndex((result.matches ?? []) as SearchMatch[])
    rawEntries.value = found
    truncated.value = result.truncated === true
    const paths = [...new Set(found.map(entry => entry.path))].slice(0, FILE_READ_LIMIT)
    skippedFiles.value = Math.max(0, new Set(found.map(entry => entry.path)).size - paths.length)
    const { texts, skipped } = await readFileTexts(paths)
    fileTexts.value = texts
    skippedFiles.value += skipped
    scanned.value = true
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    running.value = false
  }
}

onMounted(() => { void scan() })
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="command-palette endpoints-dialog" role="dialog" aria-modal="true" aria-label="端点">
      <div class="palette-input">
        <span class="endpoints-heading">端点</span>
        <span class="endpoints-summary" aria-live="polite">{{ running ? '正在扫描…' : summary }}</span>
        <button class="icon-button" :disabled="running" title="重新扫描" aria-label="重新扫描" @click="void scan()"><RefreshCw :size="iconSize.menu" /></button>
        <button class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="iconSize.action" /></button>
      </div>
      <div class="endpoints-filter">
        <input v-model="query" placeholder="按路径 / 方法 / 框架过滤…" aria-label="过滤端点" spellcheck="false" />
        <button class="endpoints-clients" :class="{ on: includeClients }" title="同时列出客户端调用（fetch/axios/RestTemplate…）" aria-label="客户端调用" :aria-pressed="includeClients" @click="includeClients = !includeClients">客户端</button>
      </div>
      <p v-if="!isDesktop" class="endpoints-note">浏览器预览不能扫描工程。</p>
      <p v-else-if="error" class="endpoints-error">{{ error }}</p>
      <p v-else-if="truncated" class="endpoints-note">扫描结果被截断：下面只是已扫到的部分。</p>
      <p v-else-if="scanned && skippedFiles" class="endpoints-note">有 {{ skippedFiles }} 个文件的全文没有读到：这些文件里的类级前缀未合并、客户端调用未扫描。</p>
      <div class="endpoints-list" role="listbox" aria-label="端点列表">
        <button v-for="entry in rows" :key="`${entry.method}-${entry.route}-${entry.path}:${entry.line}`" class="endpoints-row" role="option" @click="emit('open', { path: entry.path, line: entry.line })">
          <span class="endpoints-method" :class="`m-${(entry.method || 'any').toLowerCase()}`">{{ entry.method || 'ANY' }}</span>
          <span class="endpoints-route" :title="entry.route">{{ entry.route }}</span>
          <span class="endpoints-source" :title="`${entry.path}:${entry.line + 1}`">{{ entry.path }}:{{ entry.line + 1 }}</span>
          <span class="endpoints-framework">{{ entry.framework }}</span>
        </button>
        <p v-if="scanned && !rows.length" class="endpoints-note">没有匹配的端点。</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.endpoints-dialog { width: 720px; max-width: 92vw; max-height: 80vh; }
.endpoints-heading { color: var(--bright); font-weight: 500; }
.endpoints-summary { flex: 1; min-width: 0; color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.endpoints-filter { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; padding: var(--space-1) var(--space-3); }
.endpoints-filter input { flex: 1; min-width: 0; box-sizing: border-box; min-height: var(--ctrl-height-sm); padding: 2px var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 11px/1.5 var(--font-mono); }
.endpoints-clients { flex-shrink: 0; min-height: var(--ctrl-height-sm); padding: 2px var(--space-2); color: var(--muted); background: transparent; border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font-size: 11px; }
.endpoints-clients.on { color: var(--accent); border-color: var(--accent); }
.endpoints-note { margin: 0; padding: var(--space-2) var(--space-3); color: var(--muted); font-size: 12px; }
.endpoints-error { margin: 0; padding: var(--space-2) var(--space-3); color: var(--error); font-size: 12px; }
.endpoints-list { flex: 1; min-height: 0; overflow: auto; padding: 0 var(--space-3) var(--space-3); }
.endpoints-row { display: flex; align-items: baseline; gap: var(--space-2); width: 100%; padding: 2px var(--space-1); border: 0; background: transparent; color: var(--text); text-align: left; font-size: 12px; }
.endpoints-row:hover { background: var(--hover); }
.endpoints-method { flex-shrink: 0; width: 44px; color: var(--accent); font: 10px/1.6 var(--font-mono); }
.endpoints-method.m-get { color: var(--success, var(--accent)); }
.endpoints-method.m-post { color: var(--warning, var(--accent)); }
.endpoints-method.m-delete { color: var(--error); }
.endpoints-route { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--bright); font-family: var(--font-mono); }
.endpoints-source { flex-shrink: 0; color: var(--muted); font-size: 10px; }
.endpoints-framework { flex-shrink: 0; width: 86px; color: var(--muted); font-size: 10px; text-align: right; }
</style>
