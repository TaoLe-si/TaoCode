<script setup lang="ts">
// 插件市场页 —— 对照 IDEA 的 `MarketplacePluginsTab`（已安装页是 `InstalledPluginsTab`，
// 两个标签页在 `PluginManagerConfigurable` 里并排）。规则全在 `src/pluginMarket.ts`（纯函数 + 单测），
// 这里只做：读仓库（工作区本地目录）、画列表、把「安装/更新」落到既有 `plugin.*` 通道。
//
// 数据来源如实写在界面上：清单 `repository.json` 走 `file.read`（工作区相对），包走
// `plugin.install`（工作区根拼绝对路径）；**远程仓库**没有通道（CSP `connect-src 'self'` +
// 宿主 Method 清单无网络），所以这里没有"在线搜索"这种点不动的假入口。
import { computed, onMounted, ref } from 'vue'
import { Download, Loader2, PackageSearch, RefreshCw, Search, Star, X } from 'lucide-vue-next'
import { isDesktop, request, type PluginList } from '../bridge'
import type { AppState } from '../settingsModel'
import type { PluginInfo } from '../pluginGroups'
import {
  DEFAULT_REPOSITORY_ROOT,
  MARKETPLACE_MANIFEST,
  MARKETPLACE_SCOPE_LABELS,
  MARKETPLACE_SORTS,
  MARKETPLACE_SORT_LABELS,
  formatDownloads,
  installMarketplaceEntry,
  loadMarketplace,
  marketplaceCategories,
  marketplaceEntryCategory,
  marketplaceEntryStatus,
  matchesMarketplaceQuery,
  sortMarketplaceEntries,
  type MarketplaceLoadResult,
  type MarketplacePlugin,
  type MarketplaceQuery,
  type MarketplaceSort,
} from '../pluginMarket'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  /** 已安装插件（父组件持有；安装/更新后由父组件刷新）。 */
  plugins: PluginInfo[]
  busy?: boolean
}>()

const emit = defineEmits<{
  /** 装完/更新完：父组件刷新已安装列表（与「从磁盘安装」同一条刷新路径）。 */
  (event: 'changed'): void
  /** 仓库读出来（或清空）时上报条目：已安装页的 `/outdated` 过滤与「可更新到 vX」用它。 */
  (event: 'catalog', entries: MarketplacePlugin[]): void
}>()

const root = ref(DEFAULT_REPOSITORY_ROOT)
const query = ref('')
const scope = ref<MarketplaceQuery['scope']>('all')
const category = ref('')
const sort = ref<MarketplaceSort>('relevance')
const loading = ref(false)
const installing = ref('')
const loadResult = ref<MarketplaceLoadResult | null>(null)
const note = ref('')
const failure = ref('')
// 工作区根（`app.state.lastProject` 就是当前打开的工程根；`workspace.close` 会清空）。
// 装包要给 native 绝对路径，而 `file.read` 只收工作区相对路径 —— 两边都靠这个根对齐。
const workspaceRoot = ref('')

const catalog = computed(() => loadResult.value?.entries ?? [])
const categories = computed(() => marketplaceCategories(catalog.value))
/** 范围按钮的顺序（全部 / 可更新 / 已安装）。 */
const scopes = Object.keys(MARKETPLACE_SCOPE_LABELS) as Array<MarketplaceQuery['scope']>
const visible = computed(() => {
  const current: MarketplaceQuery = { keyword: query.value.trim(), category: category.value, scope: scope.value }
  const filtered = catalog.value.filter(entry => matchesMarketplaceQuery(entry, current, props.plugins))
  // 相关度 = 清单顺序；其余按选项排。
  return sortMarketplaceEntries(filtered, sort.value)
})
const updateCount = computed(() => catalog.value.filter(entry => marketplaceEntryStatus(entry, props.plugins).state === 'update').length)
const sourceLabel = computed(() => {
  const result = loadResult.value
  if (!result) return ''
  if (result.source === 'manifest') return `清单：${result.root}/repository.json`
  if (result.source === 'directory') return `目录里的插件包：${result.root}`
  return ''
})

function statusOf(entry: MarketplacePlugin) {
  return marketplaceEntryStatus(entry, props.plugins)
}

function statusLabel(entry: MarketplacePlugin): string {
  const status = statusOf(entry)
  if (status.state === 'update') return `可更新到 v${status.target}`
  if (status.state === 'installed') return '已安装'
  if (status.state === 'incompatible') return '已安装（无效）'
  return '可安装'
}

function canInstall(entry: MarketplacePlugin): boolean {
  return isDesktop && Boolean(workspaceRoot.value) && !installing.value && !props.busy
    && statusOf(entry).state !== 'incompatible' && statusOf(entry).state !== 'installed'
}

function initial(entry: MarketplacePlugin) {
  return (entry.name || entry.id).trim().slice(0, 1).toUpperCase() || '?'
}

function tone(entry: MarketplacePlugin) {
  const source = entry.id || entry.name || '?'
  let hash = 0
  for (const ch of source) hash = (hash * 31 + ch.charCodeAt(0)) % 360
  return hash
}

function formatDate(value: number | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

async function refresh() {
  note.value = ''
  failure.value = ''
  if (!isDesktop) { failure.value = '浏览器预览不能读本机工作区，请在桌面端使用。'; return }
  loading.value = true
  try {
    const state = await request<AppState>('app.state')
    workspaceRoot.value = state.lastProject ?? ''
    loadResult.value = await loadMarketplace({
      readText: relative => request<{ content: string }>('file.read', { path: relative }).then(doc => doc.content),
      listFiles: () => request<{ files: string[] }>('workspace.files').then(result => result.files),
    }, root.value)
    emit('catalog', loadResult.value.entries)
    if (!workspaceRoot.value) failure.value = '市场清单来自工作区里的仓库目录：先打开一个包含该目录的工作区。'
    else if (loadResult.value.source === 'none') failure.value = `在 ${root.value} 下没有找到 ${MARKETPLACE_MANIFEST} 或插件包。`
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
    loadResult.value = null
    emit('catalog', [])
  } finally {
    loading.value = false
  }
}

async function install(entry: MarketplacePlugin) {
  installing.value = entry.id
  note.value = ''
  failure.value = ''
  try {
    const outcome = await installMarketplaceEntry({
      install: source => request<PluginList>('plugin.install', { source }),
      uninstall: id => request<PluginList>('plugin.uninstall', { id }),
    }, entry, workspaceRoot.value, props.plugins)
    note.value = outcome === 'updated'
      ? `已更新「${entry.name}」到 v${entry.version}。`
      : `已安装「${entry.name}」。启用后它贡献的命令与模板会立即生效。`
    emit('changed')
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
  } finally {
    installing.value = ''
  }
}

function clearQuery() { query.value = '' }

onMounted(() => { void refresh() })
</script>

<template>
  <section class="market-body" aria-label="插件市场">
    <div class="market-bar">
      <label class="market-root">
        <PackageSearch :size="iconSize.control" aria-hidden="true" />
        <input v-model="root" type="text" spellcheck="false" placeholder="工作区里的仓库目录（工作区相对路径）"
               aria-label="仓库目录" @keydown.enter="refresh" />
      </label>
      <button type="button" class="subtle-button" :disabled="loading" @click="refresh">
        <RefreshCw :size="iconSize.menu" aria-hidden="true" />{{ loading ? '读取中…' : '刷新' }}
      </button>
    </div>
    <p class="market-source">
      <template v-if="sourceLabel">{{ sourceLabel }} · {{ catalog.length }} 个条目<span v-if="updateCount"> · {{ updateCount }} 个可更新</span></template>
      <template v-else-if="!loading">远程插件仓库需要网络通道（宿主没有，WebView 的 CSP 也拦了跨源请求），这里读的是工作区内的本地仓库。</template>
    </p>

    <div class="market-toolbar">
      <label class="market-search">
        <Search :size="iconSize.control" aria-hidden="true" />
        <input v-model="query" type="search" placeholder="搜索插件（名称 / id / 描述 / 厂商 / 标签）" aria-label="搜索市场" />
        <button v-if="query" type="button" class="icon-button" title="清空搜索" aria-label="清空搜索" @click="clearQuery"><X :size="iconSize.menu" aria-hidden="true" /></button>
      </label>
      <div class="market-scopes" role="toolbar" aria-label="市场范围">
        <button v-for="item in scopes" :key="item"
                type="button" class="market-scope" :class="{ on: scope === item }" :aria-pressed="scope === item"
                @click="scope = item">{{ MARKETPLACE_SCOPE_LABELS[item] }}<span v-if="item === 'outdated' && updateCount" class="market-count">{{ updateCount }}</span></button>
      </div>
      <select v-if="categories.length" v-model="category" class="market-select" aria-label="按类目过滤">
        <option value="">全部类目</option>
        <option v-for="item in categories" :key="item" :value="item">{{ item }}</option>
      </select>
      <select v-model="sort" class="market-select" aria-label="排序方式">
        <option v-for="item in MARKETPLACE_SORTS" :key="item" :value="item">按{{ MARKETPLACE_SORT_LABELS[item].label }}</option>
      </select>
    </div>

    <p v-if="note" class="market-note">{{ note }}</p>
    <p v-if="failure" class="market-failure">{{ failure }}</p>
    <ul v-if="visible.length" class="market-list" role="listbox" aria-label="市场插件">
      <li v-for="entry in visible" :key="entry.id">
        <article class="market-row" :class="{ 'is-installed': statusOf(entry).state === 'installed' }">
          <span class="market-avatar" :style="{ background: `linear-gradient(135deg, hsl(${tone(entry)} 62% 52%), hsl(${(tone(entry) + 40) % 360} 62% 44%))` }" aria-hidden="true">{{ initial(entry) }}</span>
          <div class="market-main">
            <p class="market-name">{{ entry.name }}<span class="market-version">v{{ entry.version || '未知' }}</span>
              <span class="market-badge" :class="`is-${statusOf(entry).state}`">{{ statusLabel(entry) }}</span></p>
            <p class="market-desc">{{ entry.description || '没有描述。' }}</p>
            <p class="market-meta">
              <span>{{ marketplaceEntryCategory(entry) }}</span>
              <span v-if="entry.vendor">· {{ entry.vendor }}</span>
              <span v-if="entry.rating">· <Star :size="iconSize.menu" aria-hidden="true" /> {{ entry.rating }}</span>
              <span v-if="entry.downloads">· {{ formatDownloads(entry.downloads) }} 次下载</span>
              <span v-if="entry.releaseDate">· {{ formatDate(entry.releaseDate) }}</span>
              <span v-if="entry.tags?.length">· {{ entry.tags.join('、') }}</span>
            </p>
          </div>
          <button type="button" class="subtle-button market-install" :disabled="!canInstall(entry)"
                  :title="statusOf(entry).state === 'installed' ? '已经安装' : (statusOf(entry).state === 'incompatible' ? '已安装但清单读不出来 / 依赖不满足，先在已安装页处理' : `从 ${entry.file} 安装`)"
                  @click="install(entry)">
            <Loader2 v-if="installing === entry.id" :size="iconSize.menu" class="spin" aria-hidden="true" />
            <Download v-else :size="iconSize.menu" aria-hidden="true" />
            {{ statusOf(entry).state === 'update' ? '更新' : statusOf(entry).state === 'installed' ? '已安装' : statusOf(entry).state === 'incompatible' ? '不可安装' : '安装' }}
          </button>
        </article>
      </li>
    </ul>
    <p v-else-if="!loading && loadResult && !failure" class="plugin-empty">没有匹配的条目。换个关键字，或点刷新重读仓库。</p>
    <p v-else-if="loading" class="plugin-empty">正在读取仓库…</p>
  </section>
</template>

<style scoped>
.market-body { display: flex; flex-direction: column; gap: var(--space-2); min-height: 0; }
.market-bar { display: flex; align-items: center; gap: var(--space-2); }
.market-root { display: flex; align-items: center; gap: var(--space-1); flex: 1; min-width: 0; padding: 0 var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--editor); color: var(--muted); }
.market-root input { flex: 1; min-width: 0; padding: 6px 0; border: 0; outline: none; background: transparent; color: var(--bright); font-size: 12px; font-family: var(--font-mono, monospace); }
.market-source { margin: 0; color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
.market-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1); }
.market-search { display: flex; align-items: center; gap: var(--space-1); flex: 1; min-width: 160px; padding: 0 var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--editor); color: var(--muted); }
.market-search input { flex: 1; min-width: 0; padding: 6px 0; border: 0; outline: none; background: transparent; color: var(--bright); font-size: 12px; }
.market-scopes { display: flex; align-items: center; gap: 2px; }
.market-scope { display: inline-flex; align-items: center; gap: 4px; padding: 3px var(--space-2); border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--secondary); font-size: 11px; }
.market-scope.on { border-color: var(--line-strong); background: var(--selected); color: var(--bright); }
.market-count { color: var(--muted); font-variant-numeric: tabular-nums; }
.market-select { padding: 4px var(--space-1); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--editor); color: var(--secondary); font-size: 11px; }
.market-note { margin: 0; color: var(--secondary); font-size: 11px; }
.market-failure { margin: 0; color: var(--warning); font-size: 11px; }
.market-list { display: flex; flex-direction: column; gap: var(--space-1); margin: 0; padding: 0; list-style: none; max-height: 46vh; overflow: auto; }
.market-row { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--editor); }
.market-row.is-installed { opacity: .92; }
.market-avatar { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; flex-shrink: 0; border-radius: 50%; color: var(--on-accent); font: 600 13px var(--font-brand); text-shadow: 0 1px 1px rgb(0 0 0 / 35%); }
.market-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.market-name { display: flex; align-items: baseline; gap: var(--space-2); margin: 0; color: var(--bright); font-size: 13px; font-weight: 600; }
.market-version { color: var(--muted); font-size: 11px; font-weight: 400; }
.market-badge { padding: 1px 6px; border-radius: 999px; background: var(--hover); color: var(--secondary); font-size: 10px; font-weight: 400; }
.market-badge.is-update { background: var(--selected); color: var(--accent); }
.market-badge.is-available { background: var(--selected); color: var(--accent); }
.market-badge.is-incompatible { color: var(--warning); }
.market-desc { margin: 0; color: var(--secondary); font-size: 11px; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.market-meta { display: flex; align-items: center; gap: 4px; margin: 0; color: var(--muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.market-install { flex-shrink: 0; }
.spin { animation: tc-spin var(--dur-spin) var(--ease-linear) infinite; }
</style>
