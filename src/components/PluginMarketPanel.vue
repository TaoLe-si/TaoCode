<script setup lang="ts">
// 插件市场页 —— 对照 IDEA 的 `MarketplacePluginsTab`（已安装页是 `InstalledPluginsTab`，
// 两个标签页在 `PluginManagerConfigurable` 里并排）。规则全在 `src/pluginMarket.ts`（纯函数 + 单测），
// 这里只做：读仓库（工作区本地目录）、画列表、把「安装/更新」落到既有 `plugin.*` 通道。
//
// 数据来源如实写在界面上：本地清单 `repository.json` 走 `file.read`（工作区相对），包走
// `plugin.install`（工作区根拼绝对路径）；**远程仓库的清单**与**在线搜索**走宿主 `http.get`
// （`src/pluginMarketRemote.ts` / `src/pluginMarketSearch.ts` → `native/http_client.cpp` 的 WinHTTP，
// `index.html` 的 CSP 也为市场主机放开了 `connect-src`），取到的是只读条目 —— **远程安装仍没有落点**
// （要先把包下载进工作区，且缺 `PluginSignatureVerifier.kt` 那套验签），所以远程条目的安装按钮
// 一律禁用并写明原因，而不是画一个点不动的假按钮。两档来源的合并与可安装判定见
// `src/pluginMarketSources.ts`。
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Blocks, Download, Globe, Loader2, PackageSearch, RefreshCw, Search, Star, X } from 'lucide-vue-next'
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
// 更新检查的**策略层**（`StandalonePluginUpdateChecker.kt` 的可移植一半）：门控（开关 + 一天缓存）、
// 指数退避、三态结果与文案在 `src/pluginUpdateCheck.ts`（纯函数 + 单测）。这里的取数器就是
// 本地仓库清单那一份 —— 有更新时把一条**通知**递到宿主（`emit('updateAvailable')`）。
import {
  pluginUpdateMessage,
  runPluginUpdateCheck,
  type PluginUpdateStatus,
} from '../pluginUpdateCheck'
// 签名判定与 bundled 登记（`PluginSignatureVerifier.kt` / `PluginUiModel.isBundled` 的可移植一半）：
// 本仓没有验签通道 ⇒ 判定如实返回「未校验」，界面照实显示而不是画一个点不动的按钮。
import { EMPTY_BUNDLED_REGISTRY, SIGNATURE_RESULT_LABELS, declaredSignatureOf, isBundledPlugin, verifyPluginSignature } from '../pluginSignature'
// 两个市场来源的合并（工作区仓库 + 远程仓库）与「能不能装」判定：纯函数，`src/pluginMarketSources.ts`。
import {
  MARKETPLACE_ORIGIN_LABELS,
  REMOTE_INSTALL_BLOCKED,
  combineMarketplaceEntries,
  marketplaceOriginIndex,
  marketplaceOriginSummary,
  type MarketplaceOrigin,
} from '../pluginMarketSources'
// 远程仓库的**清单取数**（`MarketplaceRequests.searchPlugins` 的可移植一半，见文件头）：
// 走宿主 `http.get`（浏览器预览档会被 bridge 如实拒绝）。
import { loadRemoteMarketplace, type RemoteMarketplaceResult } from '../pluginMarketRemote'

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
  /**
   * 有可用更新（`StandalonePluginUpdateChecker.notifyPluginUpdateAvailable:174-196`）：
   * 策略层算出来的那一条通知递给宿主，由宿主决定挂到通知中心。`latest` / 失败不发。
   */
  (event: 'updateAvailable', notice: { message: string; actionLabel: string; pluginId: string }): void
}>()

const root = ref(DEFAULT_REPOSITORY_ROOT)
const query = ref('')
const scope = ref<MarketplaceQuery['scope']>('all')
const category = ref('')
const sort = ref<MarketplaceSort>('relevance')
const loading = ref(false)
const installing = ref('')
const loadResult = ref<MarketplaceLoadResult | null>(null)
// 远程仓库那一档：地址存 localStorage（与更新检查的时间戳同前缀），清单取数走宿主 `http.get`。
const REMOTE_REPO_KEY = 'taocode.pluginMarketRemoteRepository'
function storedRemoteRepo(): string {
  try { return localStorage.getItem(REMOTE_REPO_KEY) ?? '' } catch { return '' }
}
const remoteRepo = ref(storedRemoteRepo())
/** 取到的远程清单（null = 没填地址 / 取失败 —— 失败原因在 `failure`）。 */
const remoteResult = ref<RemoteMarketplaceResult | null>(null)
const remoteBusy = ref(false)
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

// 两个来源合成一份清单：本地在前、远程独有的条目接在后面（同 id 本地优先，见 `pluginMarketSources.ts`）。
const sourcedCatalog = computed(() => combineMarketplaceEntries(loadResult.value?.entries ?? [], remoteResult.value?.plugins ?? []))
/** 画出来的清单（含只读的远程条目）。 */
const catalog = computed(() => sourcedCatalog.value.map(item => item.entry))
/** 条目 id → 来源那一格（徽章与安装按钮按它查）。 */
const originIndex = computed(() => marketplaceOriginIndex(sourcedCatalog.value))
/**
 * 能真的装 / 更新的那一份（= 工作区仓库的条目）：上报给已安装页的 `/outdated` 与更新检查的只有它 ——
 * 远程条目装不了（`REMOTE_INSTALL_BLOCKED`），喂进去只会让「可更新到 vX」指到一个动不了的版本。
 */
const installableCatalog = computed(() => sourcedCatalog.value.filter(item => item.installable).map(item => item.entry))
const installableIds = computed(() => new Set(installableCatalog.value.map(entry => entry.id)))
/** 条目的来源（`sourcedCatalog` 里没有的 id —— 理论上不会有 —— 按本地算，宁可不误标）。 */
function originOf(entry: MarketplacePlugin): MarketplaceOrigin {
  return originIndex.value.get(entry.id)?.origin ?? 'local'
}
function isRemoteEntry(entry: MarketplacePlugin): boolean {
  return originOf(entry) === 'remote'
}
/** 来源行：`工作区仓库 3 条 · 远程仓库 2 条`。 */
const originSummary = computed(() => marketplaceOriginSummary(sourcedCatalog.value))
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
const updateCount = computed(() => installableCatalog.value.filter(entry => marketplaceEntryStatus(entry, props.plugins).state === 'update').length)
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
  return `${words.join('、')} 取的是远程 marketplace 的分组字段，两个来源的仓库清单里都没有这一层。`
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
  // `installableIds`：远程条目一律装不了（`plugin.install` 只收工作区里的包，见 `pluginMarketSources.ts`）。
  return isDesktop && Boolean(workspaceRoot.value) && !installing.value && !props.busy
    && installableIds.value.has(entry.id)
    && statusOf(entry).state !== 'incompatible' && statusOf(entry).state !== 'installed'
}

/** 按钮上的字：远程条目如实写「不可安装」（不画成可点的「安装」）。 */
function installLabel(entry: MarketplacePlugin): string {
  if (isRemoteEntry(entry)) return '不可安装'
  const state = statusOf(entry).state
  if (state === 'update') return '更新'
  if (state === 'installed') return '已安装'
  if (state === 'incompatible') return '不可安装'
  return '安装'
}

/** 按钮为什么不可点：远程条目给的是下载 + 验签那一格的原因，不是"尚未完成"。 */
function installTitle(entry: MarketplacePlugin): string {
  if (isRemoteEntry(entry)) return REMOTE_INSTALL_BLOCKED
  const state = statusOf(entry).state
  if (state === 'installed') return '已经安装'
  if (state === 'incompatible') return '已安装但清单读不出来 / 依赖不满足，先在已安装页处理'
  return `从 ${entry.file} 安装`
}

function formatDate(value: number | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 条目的签名档（`PluginSignatureVerifier.verifyIfRequired` 的判定结果；本仓无验签通道 ⇒ 未校验）。 */
function signatureLabel(entry: MarketplacePlugin): string {
  const verdict = verifyPluginSignature({ isMarketplace: true, declaredSignature: declaredSignatureOf(entry) })
  return SIGNATURE_RESULT_LABELS[verdict.result]
}
/** 内置插件那一层（本仓恒空集 ⇒ 不渲染标记，见 `src/pluginSignature.ts` 的说明）。 */
function bundledLabel(entry: MarketplacePlugin): string {
  return isBundledPlugin(entry.id, EMPTY_BUNDLED_REGISTRY) ? '内置' : ''
}

/**
 * 更新检查的宿主侧接线（`StandalonePluginUpdateChecker.pluginUsed()` + `updateCheck()`）。
 * 门控（开关 + 一天缓存）与退避策略全在 `src/pluginUpdateCheck.ts`，这里只做三件事：
 *   ① 刷新成功后跑一轮检查（取数器 = 本地仓库清单里该插件的版本）；
 *   ② 有更新的条目发一条通知（`emit('updateAvailable')`）；
 *   ③ 失败的那几条记进 `failure`（上游 `:78-81` 记日志，本仓面板上如实说一句）。
 * 时间戳存 localStorage（`PropertiesComponent` 的等价物，键与已安装页的存储同前缀）。
 */
const UPDATE_CHECK_KEY = 'taocode.pluginUpdateCheck'
function lastCheckMs(): number {
  const raw = Number(localStorage.getItem(UPDATE_CHECK_KEY) ?? '0')
  return Number.isFinite(raw) && raw > 0 ? raw : 0
}
async function runUpdateCheck() {
  const statuses: PluginUpdateStatus[] = []
  const result = await runPluginUpdateCheck(props.plugins, {
    // 取数器 = 能真的装得了的那一份清单（本地仓库）；远程条目只读，不该用它发"有更新"的通知。
    available: async id => installableCatalog.value.find(entry => entry.id === id)?.version,
    lastCheckMs: lastCheckMs(),
    nowMs: Date.now(),
    // 上游 `UpdateSettings.isPluginsCheckNeeded` 在本仓没有独立开关；本地仓库读取不花网络，
    // 所以门控只由「一天缓存」那一档决定（`shouldCheckForUpdates` 的第三参保持默认 true）。
    failMessage: plugin => plugin.name || plugin.id,
  })
  if (!result.ran) return
  if (result.lastCheckMs) localStorage.setItem(UPDATE_CHECK_KEY, String(result.lastCheckMs))
  for (const status of result.statuses) {
    statuses.push(status)
    if (status.kind === 'update')
      emit('updateAvailable', { message: pluginUpdateMessage(status), actionLabel: '更新', pluginId: status.pluginId })
    else if (status.kind === 'failed')
      failure.value = `${pluginUpdateMessage(status)}${status.detail ? `（${status.detail}）` : ''}`
  }
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
    // 上报的只有**装得了**的条目（本地仓库那一份）：远程条目只读，不进 `/outdated` 与更新检查。
    emit('catalog', installableCatalog.value)
    if (!workspaceRoot.value) failure.value = '市场清单来自工作区里的仓库目录：先打开一个包含该目录的工作区。'
    else if (loadResult.value.source === 'none') failure.value = `在 ${root.value} 下没有找到 ${MARKETPLACE_MANIFEST} 或插件包。`
    // 仓库读出来了才跑更新检查（上游 `pluginUsed()` 是插件页被使用时触发；取数器就是这份清单）。
    else await runUpdateCheck()
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
    loadResult.value = null
    emit('catalog', [])
  } finally {
    loading.value = false
  }
}

/**
 * 取远程仓库的清单（上游 `MarketplaceRequests.searchPlugins` 的**取数**那一半；搜索 API 的形状
 * 转换与本仓的仓库清单不同形，见 `src/pluginMarketRemote.ts` 文件头）。
 * 只读：条目的 `file` 是绝对 URL（链接可点开对照），安装仍走工作区仓库那一档。
 * 取不到**不抛**：`loadRemoteMarketplace` 回 `available:false` + 原因，这里照样显示一句人话。
 */
async function loadRemote() {
  const repository = remoteRepo.value.trim()
  try { localStorage.setItem(REMOTE_REPO_KEY, repository) } catch { /* 存储不可用就只留会话内 */ }
  if (!repository) { remoteResult.value = null; return }
  remoteBusy.value = true
  note.value = ''
  failure.value = ''
  try {
    const result = await loadRemoteMarketplace(repository)
    remoteResult.value = result.available ? result : null
    if (!result.available) {
      failure.value = `远程仓库取不到：${result.reason}`
    } else {
      const bad = result.errors.length ? `（${result.errors.length} 条读不出来）` : ''
      note.value = `远程仓库读出 ${result.plugins.length} 个条目${bad}；远程条目只读，装包仍走工作区仓库。`
    }
  } catch (error) {
    remoteResult.value = null
    failure.value = error instanceof Error ? error.message : String(error)
  } finally {
    remoteBusy.value = false
  }
}

async function install(entry: MarketplacePlugin) {
  // 硬闸：远程条目的 `file` 是 URL，交给 `plugin.install` 只会让 native 去工作区里找一个不存在的
  // 路径。按钮本来就是禁用的，这里再挡一次（按钮状态是界面，闸门是代码）。
  if (!installableIds.value.has(entry.id)) {
    failure.value = isRemoteEntry(entry) ? REMOTE_INSTALL_BLOCKED : `这条不在工作区仓库里：${entry.id}`
    return
  }
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
      : `已安装「${entry.name}」。启用后它贡献的命令、模板与文件类型会立即生效。`
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
    <!-- 远程仓库那一档：清单走宿主 `http.get`（`src/pluginMarketRemote.ts`）。只读 —— 下载 + 验签
         没有落点，所以这里没有"在线安装"；条目的包地址是可点开的绝对 URL。 -->
    <div class="market-bar">
      <label class="market-root">
        <Globe :size="iconSize.control" aria-hidden="true" />
        <input v-model="remoteRepo" type="text" spellcheck="false" placeholder="远程仓库地址（http/https，清单默认取 repository.json）"
               aria-label="远程仓库地址" @keydown.enter="loadRemote" />
      </label>
      <button type="button" class="subtle-button" :disabled="remoteBusy || !remoteRepo.trim()" @click="loadRemote">
        <Loader2 v-if="remoteBusy" :size="iconSize.menu" class="spin" aria-hidden="true" />
        <RefreshCw v-else :size="iconSize.menu" aria-hidden="true" />{{ remoteBusy ? '取清单…' : '取远程清单' }}
      </button>
    </div>
    <p class="market-source">
      <template v-if="catalog.length">{{ originSummary }}{{ sourceLabel ? ` · ${sourceLabel}` : '' }}<span v-if="updateCount"> · {{ updateCount }} 个可更新</span></template>
      <template v-else-if="sourceLabel && !loading">{{ sourceLabel }}：没有条目。</template>
      <template v-else-if="!loading && !remoteBusy">本地来源是工作区里的仓库目录（`repository.json`，或目录里的 zip/jar）；远程来源是上面填的仓库地址的清单，只读。</template>
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
          <span class="market-avatar" aria-hidden="true"><Blocks :size="iconSize.control" /></span>
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
              <!-- 来源徽章：远程条目标"远程·只读"并带原因 title（装不了 = `REMOTE_INSTALL_BLOCKED`）。 -->
              <span v-if="isRemoteEntry(entry)" class="market-badge" :title="REMOTE_INSTALL_BLOCKED">{{ MARKETPLACE_ORIGIN_LABELS.remote }} · 只读</span>
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
              <!-- 签名档（`PluginSignatureVerifier.verifyIfRequired`）：本仓没有验签通道，
                   如实显示「未校验」，不画一个点不动的「验证签名」按钮。 -->
              <span class="market-signature" :title="`签名校验：${signatureLabel(entry)}（本仓没有 marketplace-zip-signer 通道）`">· 签名 {{ signatureLabel(entry) }}</span>
              <span v-if="bundledLabel(entry)" class="market-badge">{{ bundledLabel(entry) }}</span>
            </p>
          </div>
          <button type="button" class="subtle-button market-install" :disabled="!canInstall(entry)"
                  :title="installTitle(entry)"
                  @click="install(entry)">
            <Loader2 v-if="installing === entry.id" :size="iconSize.menu" class="spin" aria-hidden="true" />
            <Download v-else :size="iconSize.menu" aria-hidden="true" />
            {{ installLabel(entry) }}
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
.market-scope { display: inline-flex; align-items: center; gap: var(--space-1); padding: 3px var(--space-2); border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--secondary); font-size: 11px; }
.market-scope.on { border-color: var(--line-strong); background: var(--selected); color: var(--bright); }
.market-count { color: var(--muted); font-variant-numeric: tabular-nums; }
.market-select { padding: var(--space-1) var(--space-1); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--editor); color: var(--secondary); font-size: 11px; }
.market-note { margin: 0; color: var(--secondary); font-size: 11px; }
.market-failure { margin: 0; color: var(--warning); font-size: 11px; }
.market-list { display: flex; flex-direction: column; gap: var(--space-1); margin: 0; padding: 0; list-style: none; max-height: 46vh; overflow: auto; }
.market-row { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--editor); }
.market-row.is-installed { opacity: .92; }
.market-avatar { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; flex-shrink: 0; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel); color: var(--muted); }
.market-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.market-name { display: flex; align-items: baseline; gap: var(--space-2); margin: 0; color: var(--bright); font-size: 13px; font-weight: 600; }
.market-version { color: var(--muted); font-size: 11px; font-weight: 400; }
.market-badge { padding: 1px 6px; border-radius: var(--radius-pill); background: var(--hover); color: var(--secondary); font-size: 10px; font-weight: 400; }
.market-badge.is-update { background: var(--selected); color: var(--accent); }
.market-badge.is-available { background: var(--selected); color: var(--accent); }
.market-badge.is-incompatible { color: var(--warning); }
/* 可点的状态徽章（installed / incompatible）：外观不变，只是能按下去已安装页。 */
.market-badge.is-market-focus { padding: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }
/* 厂商与标签都是「点一下写进搜索框」的链接（上游是 LinkComponent/LinkLabel）。 */
.market-link, .market-tag { padding: 0; border: 0; background: transparent; color: var(--secondary); font: inherit; cursor: pointer; text-decoration: underline dotted; text-underline-offset: 2px; }
.market-link:hover, .market-tag:hover { color: var(--bright); }
.market-desc { margin: 0; color: var(--secondary); font-size: 11px; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.market-meta { display: flex; align-items: center; gap: var(--space-1); margin: 0; color: var(--muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.market-install { flex-shrink: 0; }
.spin { animation: tc-spin var(--dur-spin) var(--ease-linear) infinite; }
</style>
