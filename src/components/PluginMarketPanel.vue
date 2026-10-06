<script setup lang="ts">
// 插件市场页 —— 对照 IDEA 的 `MarketplacePluginsTab`（已安装页是 `InstalledPluginsTab`，
// 两个标签页在 `PluginManagerConfigurable` 里并排）。规则全在 `src/pluginMarket.ts`（纯函数 + 单测），
// 这里只做：读仓库（工作区本地目录）、画列表、把「安装/更新」落到既有 `plugin.*` 通道。
//
// 数据来源如实写在界面上：清单 `repository.json` 走 `file.read`（工作区相对），包走
// `plugin.install`（工作区根拼绝对路径）；**远程仓库**没有通道（CSP `connect-src 'self'` +
// 宿主 Method 清单无网络），所以这里没有"在线搜索"这种点不动的假入口。
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Download, Loader2, PackageSearch, RefreshCw, Search, Star, X } from 'lucide-vue-next'
import { isDesktop, request, type PluginList } from '../bridge'
import type { AppState } from '../settingsModel'
import type { PluginInfo } from '../pluginGroups'
import { vendorQueryWord } from '../pluginGroups'
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
  marketplaceEffectiveSort,
  marketplaceEntryCategory,
  marketplaceEntryStatus,
  matchesMarketplaceQuery,
  parseMarketplaceQuery,
  sortMarketplaceEntries,
  tagQueryWord,
  type MarketplaceLoadResult,
  type MarketplacePlugin,
  type MarketplaceQuery,
  type MarketplaceSort,
} from '../pluginMarket'
// 搜索框的属性词建议浮层（与已安装页同一套规则，词表/取值表是市场页那一套）。
import {
  MARKETPLACE_SORT_BY_VALUES,
  MARKETPLACE_SUGGEST_WORDS,
  NO_SUGGESTION,
  SEARCH_WORD_SORT_BY,
  SEARCH_WORD_TAG,
  SEARCH_WORD_VENDOR,
  applySuggestion,
  marketplaceTagValues,
  marketplaceVendorValues,
  suggestionKeyAction,
  suggestionState,
  wrapAttributeValue,
} from '../pluginSearchSuggest'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  /** 已安装插件（父组件持有；安装/更新后由父组件刷新）。 */
  plugins: PluginInfo[]
  busy?: boolean
  /**
   * 已安装页的「在市场页搜这个」递过来的整条查询（上游把 `query` 原样交给市场页：
   * `InstalledPluginsTabSearchResultPanel.kt:68` 的 `accept(query)`）。`stamp` 让「连着点两次
   * 同一条查询」也能被识别成一次新的递交。
   */
  seed?: { text: string; stamp: number } | null
}>()

const emit = defineEmits<{
  /** 装完/更新完：父组件刷新已安装列表（与「从磁盘安装」同一条刷新路径）。 */
  (event: 'changed'): void
  /** 仓库读出来（或清空）时上报条目：已安装页的 `/outdated` 过滤与「可更新到 vX」用它。 */
  (event: 'catalog', entries: MarketplacePlugin[]): void
  /**
   * 已安装/无效 的条目点状态徽章 → 到已安装页选中它（必要时连带启用）。
   * 上游就是这一对动作：`PluginManagerConfigurablePanel.kt:490-493` 的 `selectAndEnable`
   * （先 `model.enable(descriptors)` 再 `select(...)`），`select` 本体 `:495-514` 会切到
   * 已安装页并把该插件设为选中项；入口是 `PluginManagerConfigurable.kt:397-401`。
   */
  (event: 'focusPlugin', id: string): void
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
const searchRef = ref<HTMLInputElement>()

// 搜索框里的 `/xxx` 语法（`SearchQueryParser.Marketplace`），与上游一样由**查询**决定生效排序。
const search = computed(() => parseMarketplaceQuery(query.value))
const effectiveSort = computed(() => marketplaceEffectiveSort(sort.value, search.value))
/** 排序下拉框：读的时候显出真正生效的那一项，写的时候改的是下拉框自己的状态。 */
const effectiveSortModel = computed<MarketplaceSort>({
  get: () => effectiveSort.value,
  set: (value: MarketplaceSort) => { sort.value = value },
})

const catalog = computed(() => loadResult.value?.entries ?? [])
const categories = computed(() => marketplaceCategories(catalog.value))
/** 范围按钮的顺序（全部 / 可更新 / 已安装）。 */
const scopes = Object.keys(MARKETPLACE_SCOPE_LABELS) as Array<MarketplaceQuery['scope']>
const visible = computed(() => {
  const current: MarketplaceQuery = {
    keyword: search.value.keyword,
    category: category.value,
    scope: scope.value,
    vendors: search.value.vendors,
    tags: search.value.tags,
  }
  const filtered = catalog.value.filter(entry => matchesMarketplaceQuery(entry, current, props.plugins))
  // 相关度 = 清单顺序；其余按选项排（`/sortBy:` 已在 effectiveSort 里覆盖下拉框）。
  return sortMarketplaceEntries(filtered, effectiveSort.value)
})
const updateCount = computed(() => catalog.value.filter(entry => marketplaceEntryStatus(entry, props.plugins).state === 'update').length)
const sourceLabel = computed(() => {
  const result = loadResult.value
  if (!result) return ''
  if (result.source === 'manifest') return `清单：${result.root}/repository.json`
  if (result.source === 'directory') return `目录里的插件包：${result.root}`
  return ''
})
/**
 * 认识但本仓没有数据源的词（`/repository:`、`/staffPicks`、`/suggested`、`/internal`）。
 * 与已安装页的 `filterNote` 同一处置：吃掉词、不参与过滤、界面上如实说明。
 */
const deferredNote = computed(() => {
  const words = search.value.deferred
  if (!words.length) return ''
  return `${words.join('、')} 取的是远程仓库的分组字段，本地仓库没有这一层。`
})

// ── 搜索框的属性词建议浮层 ──────────────────────────────────────────────────────
// 同一套规则（见 `src/pluginSearchSuggest.ts` 文件头逐行的上游行号），这一页的词表与取值表是
// `MarketplacePluginsTab.kt:378-392`（`/tag:` `/sortBy:` `/vendor:`，按数据条件去掉另外三条）与
// `:394-408`（取值：标签集合、四个排序项、厂商集合）。
function marketplaceSuggestValues(attribute: string): readonly string[] {
  if (attribute === SEARCH_WORD_TAG) return marketplaceTagValues(catalog.value)
  if (attribute === SEARCH_WORD_SORT_BY) return MARKETPLACE_SORT_BY_VALUES
  if (attribute === SEARCH_WORD_VENDOR) return marketplaceVendorValues(catalog.value)
  return []
}
const caret = ref(0)
const blankCompletes = ref(false)
const suggestDismissed = ref(false)
const suggestIndex = ref(-1)
const suggest = computed(() => suggestionState(query.value, caret.value, MARKETPLACE_SUGGEST_WORDS, marketplaceSuggestValues, blankCompletes.value))
const suggestVisible = computed(() => !suggestDismissed.value && suggest.value.words.length > 0)
const activeSuggest = computed(() => (suggestVisible.value ? suggest.value : NO_SUGGESTION))

/** 光标要从真实输入框取（上游是 `SearchPopup` 自己挂的 `CaretListener`，`SearchPopup.java:37`）。 */
function syncCaretOnly() {
  caret.value = searchRef.value?.selectionStart ?? query.value.length
}
/** 重算一次浮层：上游换候选表时 `model.replaceAll(...)`，旧选中项随之清空。 */
function syncSuggestCaret() {
  syncCaretOnly()
  blankCompletes.value = false
  suggestDismissed.value = false
  suggestIndex.value = -1
}
function onSearchKeyup(event: KeyboardEvent) {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) syncSuggestCaret()
}
function writeQuery(text: string, position: number) {
  query.value = text
  caret.value = position
  blankCompletes.value = false
  void nextTick(() => {
    const input = searchRef.value
    if (!input) return
    input.value = text
    input.setSelectionRange(position, position)
    input.focus()
  })
}
function acceptSuggestion(word: string) {
  const current = suggest.value
  const inserted = current.kind === 'values' ? wrapAttributeValue(word) : word
  const next = applySuggestion(query.value, caret.value, inserted, current.prefix)
  suggestIndex.value = -1
  suggestDismissed.value = false
  writeQuery(next.text, next.caret)
}
function onSearchKeydown(event: KeyboardEvent) {
  syncCaretOnly()
  const action = suggestionKeyAction({ key: event.key, ctrlKey: event.ctrlKey, query: query.value, caret: caret.value, state: activeSuggest.value, index: suggestIndex.value })
  if (action.completesBlank) blankCompletes.value = true
  if (action.text !== undefined) writeQuery(action.text, action.caret)
  suggestIndex.value = action.index
  if (action.dismiss) suggestDismissed.value = true
  if (action.clear) clearQuery()
  if (action.consumed) event.preventDefault()
}

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

function clearQuery() {
  query.value = ''
  void nextTick(() => { searchRef.value?.focus(); syncSuggestCaret() })
}

/**
 * 点徽章 = 把那个词**整框替换**进搜索框（上游 `newui/PluginsTab.kt:271` 的
 * `searchTextField.setTextIgnoreEvents(query)`，随后把焦点要回搜索框 `:272-274`）。
 */
function applyQueryWord(word: string) {
  query.value = word
  void nextTick(() => { searchRef.value?.focus(); syncSuggestCaret() })
}

// 已安装页的「在市场页搜这个」把整条查询递过来（`props.seed`）。
watch(() => props.seed, value => {
  if (!value) return
  query.value = value.text
  void nextTick(() => syncSuggestCaret())
}, { immediate: true })

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
        <input ref="searchRef" v-model="query" type="search"
               placeholder="搜索插件（名称 / id / 描述 / 厂商 / 标签），或输入 /vendor:厂商、/tag:标签、/sortBy:downloads"
               aria-label="搜索市场"
               @input="syncSuggestCaret" @click="syncSuggestCaret" @keyup="onSearchKeyup" @keydown="onSearchKeydown" />
        <button v-if="query" type="button" class="icon-button" title="清空搜索" aria-label="清空搜索" @click="clearQuery"><X :size="iconSize.menu" aria-hidden="true" /></button>
      </label>
      <!-- 属性词/取值建议（`MarketplacePluginsTab.kt:378-408` 的两张表 +
           `SearchPopupController.java` 的那套弹出/筛选/接收规则）。没有候选时整块不渲染。 -->
      <ul v-if="suggestVisible" class="market-suggest" role="listbox" :aria-label="suggest.attribute || '市场搜索属性词'">
        <li v-for="(word, index) in suggest.words" :key="word">
          <button type="button" class="market-suggest-item" :class="{ on: index === suggestIndex }" role="option"
                  :aria-selected="index === suggestIndex" @mousedown.prevent="acceptSuggestion(word)">{{ word }}</button>
        </li>
      </ul>
      <div class="market-scopes" role="toolbar" aria-label="市场范围">
        <button v-for="item in scopes" :key="item"
                type="button" class="market-scope" :class="{ on: scope === item }" :aria-pressed="scope === item"
                @click="scope = item">{{ MARKETPLACE_SCOPE_LABELS[item] }}<span v-if="item === 'outdated' && updateCount" class="market-count">{{ updateCount }}</span></button>
      </div>
      <select v-if="categories.length" v-model="category" class="market-select" aria-label="按类目过滤">
        <option value="">全部类目</option>
        <option v-for="item in categories" :key="item" :value="item">{{ item }}</option>
      </select>
      <!-- 排序：查询里有 `/sortBy:` 时以它为准（上游 `MarketplaceSortByAction.setState:748-755`
           就是把控件状态交给解析结果），下拉框此时只显出那个值。 -->
      <select v-model="effectiveSortModel" class="market-select" aria-label="排序方式"
              :disabled="Boolean(search.sortBy)"
              :title="search.sortBy ? '排序由查询里的 /sortBy: 决定，去掉它再改这里' : undefined">
        <option v-for="item in MARKETPLACE_SORTS" :key="item" :value="item">按{{ MARKETPLACE_SORT_LABELS[item].label }}</option>
      </select>
    </div>

    <p v-if="deferredNote" class="market-failure" role="status">{{ deferredNote }}</p>
    <p v-if="note" class="market-note">{{ note }}</p>
    <p v-if="failure" class="market-failure">{{ failure }}</p>
    <ul v-if="visible.length" class="market-list" role="listbox" aria-label="市场插件">
      <li v-for="entry in visible" :key="entry.id">
        <article class="market-row" :class="{ 'is-installed': statusOf(entry).state === 'installed' }">
          <span class="market-avatar" :style="{ background: `linear-gradient(135deg, hsl(${tone(entry)} 62% 52%), hsl(${(tone(entry) + 40) % 360} 62% 44%))` }" aria-hidden="true">{{ initial(entry) }}</span>
          <div class="market-main">
            <p class="market-name">{{ entry.name }}<span class="market-version">v{{ entry.version || '未知' }}</span>
              <!-- 已安装/无效 的状态徽章可点：到已安装页选中它（`selectAndEnable`，
                   `PluginManagerConfigurablePanel.kt:490-514`）。可安装/可更新 的态没有"已安装的那一个"可选，
                   所以下面那个安装按钮才是它们的动作。 -->
              <button v-if="statusOf(entry).state === 'installed' || statusOf(entry).state === 'incompatible'"
                      type="button" class="market-badge is-market-focus" :class="`is-${statusOf(entry).state}`"
                      :title="statusOf(entry).state === 'incompatible' ? '已安装但装不起来：到已安装页看它为什么无效' : '到已安装页选中它'"
                      @click="emit('focusPlugin', entry.id)">{{ statusLabel(entry) }}</button>
              <span v-else class="market-badge" :class="`is-${statusOf(entry).state}`">{{ statusLabel(entry) }}</span></p>
            <p class="market-desc">{{ entry.description || '没有描述。' }}</p>
            <p class="market-meta">
              <span>{{ marketplaceEntryCategory(entry) }}</span>
              <!-- 厂商点进去 = `/vendor:` 过滤（上游详情面板的厂商链接：
                   `newui/PluginDetailsPageComponent.kt:1336`，含空格时按上游加引号）。 -->
              <button v-if="entry.vendor" type="button" class="market-link" :title="`只看厂商 ${entry.vendor} 的插件`"
                      @click="applyQueryWord(vendorQueryWord(entry.vendor))">· {{ entry.vendor }}</button>
              <span v-if="entry.rating">· <Star :size="iconSize.menu" aria-hidden="true" /> {{ entry.rating }}</span>
              <span v-if="entry.downloads">· {{ formatDownloads(entry.downloads) }} 次下载</span>
              <span v-if="entry.releaseDate">· {{ formatDate(entry.releaseDate) }}</span>
              <!-- 标签徽章：点一下把 `/tag:` 词写进搜索框（上游 `newui/PluginTagBadge.kt:29` +
                   `SearchQueryParser.getTagQuery`，`:254-257`）。 -->
              <button v-for="tag in entry.tags" :key="tag" type="button" class="market-tag"
                      :title="`只看带标签 ${tag} 的插件`" @click="applyQueryWord(tagQueryWord(tag))">· {{ tag }}</button>
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
/* 建议浮层：搜索框下面那一列词/取值（上游 JBList 弹层，`newui/SearchPopup.java:73`）。 */
.market-suggest { display: flex; flex-direction: column; flex-basis: 100%; gap: 1px; margin: 0; padding: var(--space-1); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--editor); list-style: none; max-height: 132px; overflow: auto; }
.market-suggest-item { width: 100%; padding: 3px var(--space-2); border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--secondary); font-size: 11px; text-align: left; }
.market-suggest-item.on, .market-suggest-item:hover { background: var(--hover); color: var(--bright); }
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
/* 可点的状态徽章（installed / incompatible）：外观不变，只是能按下去已安装页。 */
.market-badge.is-market-focus { padding: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }
/* 厂商与标签都是「点一下写进搜索框」的链接（上游是 LinkComponent/LinkLabel）。 */
.market-link, .market-tag { padding: 0; border: 0; background: transparent; color: var(--secondary); font: inherit; cursor: pointer; text-decoration: underline dotted; text-underline-offset: 2px; }
.market-link:hover, .market-tag:hover { color: var(--bright); }
.market-desc { margin: 0; color: var(--secondary); font-size: 11px; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.market-meta { display: flex; align-items: center; gap: 4px; margin: 0; color: var(--muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.market-install { flex-shrink: 0; }
.spin { animation: tc-spin var(--dur-spin) var(--ease-linear) infinite; }
</style>
