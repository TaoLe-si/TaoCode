<script setup lang="ts">
// 插件对话框：对照 IDEA 的 PluginsConfigurable（InstalledPluginsTab）——
// 顶部搜索 + 过滤，中间**按分组**列出插件（组标题带"已启用 n/m"、组级「全部启用/全部禁用」），
// 右侧详情面板（名称/版本/id/路径/描述/命令/模板/启用状态）。
//
// 分组、类目、搜索语法这些**规则**都在 `src/pluginGroups.ts`（纯函数 + 单测），
// 这里只负责把它们画出来。
import { computed, nextTick, ref, watch } from 'vue'
import { Blocks, FileArchive, FolderPlus, Loader2, RefreshCw, Search, Trash2, X } from 'lucide-vue-next'
import PluginMarketPanel from './PluginMarketPanel.vue'
import type { PluginInfo } from '../bridge'
import {
  INSTALLED_OPTION_LABEL,
  SUPPORTED_SEARCH_OPTIONS,
  UNSUPPORTED_ATTRIBUTE_WORDS,
  buildInstalledGroups,
  installedQueryOptions,
  matchesInstalledQuery,
  offersMarketplaceSearch,
  parseInstalledQuery,
  pluginDependencySummary,
  pluginIsBroken,
  pluginIsEnabled,
  pluginUninstallPrompt,
  toggleInstalledSearchOption,
  vendorQueryWord,
  type SupportedSearchOption,
} from '../pluginGroups'
// 启用裁决与加载原因（`UltimateDependencyChecker.canBeEnabled` /
// `PluginManagerStateService.preparePluginErrors` 的等价物）：复选框为什么点不动、
// 详情面板为什么标无效，都从这里取一句话原因；`featureProviders` / `duplicateFeatures`
// 是「某个入口点由哪些插件提供」的反向索引与它的冲突面（`PluginFeatureService.kt:69-71` +
// `data.kt:50-59`、`CoreBundle.properties:42`）。
import { PLUGIN_FEATURE_LABELS, canBeEnabled, duplicateFeatures, featureProviders, pluginLoadingError, pluginLoadingErrors } from '../pluginInfo'
// 搜索框的属性词建议浮层（上游 `newui/SearchPopupController.java` 一族的规则与词表/取值表）。
import {
  INSTALLED_SUGGEST_WORDS,
  NO_SUGGESTION,
  SEARCH_WORD_VENDOR,
  applySuggestion,
  installedVendorValues,
  suggestionKeyAction,
  suggestionState,
  wrapAttributeValue,
} from '../pluginSearchSuggest'
import { marketplaceEntryStatus, type MarketplacePlugin } from '../pluginMarket'
// 插件声明的文件类型（上游 `com.intellij.fileType` EP / `FileTypeBean`）：启用集合一变就重算注册表，
// 用户在下一次打开「设置 › 编辑器 › 文件类型」或打开一个文件时就能看到差别。
import { applyPluginFileTypes, type PluginFileTypeReport } from '../fileTypePluginBeans'
import type { PluginFileType } from '../pluginGroups'

import { iconSize } from '../uiIcons'
const props = defineProps<{
  plugins: PluginInfo[]
  /** 正在安装的条目（安装源的名字）；解压完才解析出清单，所以这期间只有名字。 */
  installing?: string[]
  busy?: boolean
  /** 插件目录说明用（用户配置目录下的 plugins）。 */
  isDesktop?: boolean
  /**
   * 「打开插件页并定位到这个插件」的入口（上游 `PluginManagerConfigurableService.java:14-15` 的
   * `showPluginConfigurableAndEnable(project, ...)`，落到 `PluginManagerConfigurable.kt:397-401`
   * → `PluginManagerConfigurablePanel.kt:490-514` 的 `selectAndEnable` / `select`）。
   * 空串 = 没有外部定位要求。调用点在宿主侧（`src/projectExtras.ts` 的 openPlugins 一族），
   * 见 `docs/wiring-requests-2026-10-06-plugins.md` P-1。
   */
  focusPlugin?: string
}>()

const emit = defineEmits<{
  (event: 'toggle', id: string, enabled: boolean): void
  /** 组级动作（IDEA `ComparablePluginsGroup.setEnabledState`）：把一组插件一次启停。 */
  (event: 'setEnabled', ids: string[], enabled: boolean): void
  /** IDEA PluginsConfigurable › Install Plugin from Disk（选插件包 .zip/.jar，native 解压后校验 plugin.json）。 */
  (event: 'install'): void
  /** 直接装一个含 plugin.json 的目录（本仓扩展点的原生形态，IDEA 那边只有插件包）。 */
  (event: 'installDirectory'): void
  /** IDEA 的 Uninstall：删除插件目录（组件内先做二次确认）。 */
  (event: 'uninstall', id: string): void
  (event: 'refresh'): void
  (event: 'close'): void
  /**
   * 有可用更新 —— 市场页的更新检查（`src/pluginUpdateCheck.ts`）算出来一条通知，原样上报给宿主。
   * 上游是 `StandalonePluginUpdateChecker.notifyPluginUpdateAvailable`（`:174-196`）自己弹通知；
   * 本仓通知的宿主在 App.vue，插件页只做转发。
   */
  (event: 'updateAvailable', notice: { message: string; actionLabel: string; pluginId: string }): void
}>()

const query = ref('')
const sortByName = ref(true)
const selectedId = ref<string>('')
// 两个标签页对应 IDEA `PluginManagerConfigurable` 里的 `InstalledPluginsTab` / `MarketplacePluginsTab`。
const tab = ref<'installed' | 'market'>('installed')
// 卸载是不可逆的目录删除：先点「卸载…」再确认（IDEA 也有确认步骤）。
const confirmId = ref<string>('')
const searchRef = ref<HTMLInputElement>()

const installing = computed(() => props.installing ?? [])

// 市场页读出的仓库条目（`PluginMarketPanel` 的 `catalog` 事件上报）：
// 已安装页的 `/outdated` 过滤与详情里的「可更新到 vX」都从这里取真实数据
// （`marketplaceEntryStatus()` 比对清单版本与已装版本）。
const marketEntries = ref<MarketplacePlugin[]>([])
function marketEntryOf(id: string): MarketplacePlugin | undefined {
  return marketEntries.value.find(entry => entry.id === id)
}
function updateTargetOf(plugin: PluginInfo): string {
  const entry = marketEntryOf(plugin.id)
  if (!entry) return ''
  const status = marketplaceEntryStatus(entry, props.plugins)
  return status.state === 'update' ? status.target ?? '' : ''
}

const counts = computed(() => ({
  userInstalled: props.plugins.length,
  // 依赖不满足的插件不会被加载，不算「已启用」（`pluginIsEnabled` 的口径）。
  enabled: props.plugins.filter(pluginIsEnabled).length,
  disabled: props.plugins.filter(plugin => !plugin.enabled && !plugin.error).length,
  invalid: props.plugins.filter(plugin => Boolean(plugin.error) || pluginIsBroken(plugin)).length,
  // 有更新的（市场清单比已装版本新）；仓库没读出来时是 0（"还不知道"，见 `matchesInstalledQuery`）。
  needUpdate: props.plugins.filter(plugin => updateTargetOf(plugin)).length,
}))

const parsed = computed(() => parseInstalledQuery(query.value))
const activeOptions = computed(() => installedQueryOptions(query.value))

// ── 搜索框的属性词建议浮层 ──────────────────────────────────────────────────────
// 规则（弹不弹、按前缀筛、选中后接取值表、上下键/Enter/Esc）全在 `src/pluginSearchSuggest.ts`，
// 那张文件头逐行指着上游 `newui/SearchPopupController.java:40-284`。这里只补两件事：
// 词表（`InstalledPluginsTab.kt:404-419` 按本仓有数据的几条裁过）与取值表
// （`InstalledPluginsTab.kt:421-435`：`/vendor:` 的取值就是已装插件的厂商集合）。
/** 取值表（`InstalledPluginsTab.kt:421-435`）：这一页只有 `/vendor:` 给得出取值，其余词返回空集合 = 不弹。 */
function installedSuggestValues(attribute: string): string[] {
  return attribute === SEARCH_WORD_VENDOR ? installedVendorValues(props.plugins) : []
}
const caret = ref(0)
/** Ctrl+Space 在空文本时给整张词表（`PluginsTab.kt:118-121`）；打字时空文本是「收起」。 */
const blankCompletes = ref(false)
const suggestDismissed = ref(false)
const suggestIndex = ref(-1)
const suggest = computed(() => suggestionState(query.value, caret.value, INSTALLED_SUGGEST_WORDS, installedSuggestValues, blankCompletes.value))
const suggestVisible = computed(() => !suggestDismissed.value && suggest.value.words.length > 0)

/** 光标位置只能从真实输入框取：点选、方向键、退格都会移动它（上游是 `CaretListener`）。 */
function syncCaretOnly() {
  caret.value = searchRef.value?.selectionStart ?? query.value.length
}

/** 换了一次输入 = 重算一次浮层：上游换候选表时 `model.replaceAll(...)`（`SearchPopupController.java:158`），
 *  旧选中项随之清空，下一次 Down 才重新选中第 0 项（`:275-277`）。 */
function syncSuggestCaret() {
  syncCaretOnly()
  blankCompletes.value = false
  suggestDismissed.value = false
  suggestIndex.value = -1
}

/** 光标自己移动的那几个键（不是打字）也要重算 —— 上游浮层就是跟着 caret 事件走的。 */
function onSearchKeyup(event: KeyboardEvent) {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) syncSuggestCaret()
}

/** 浮层被 Esc 收起时按键分派看到的应该是「没有浮层」，所以按键走的是 activeSuggest。 */
const activeSuggest = computed(() => (suggestVisible.value ? suggest.value : NO_SUGGESTION))

/** 文本与光标一起改：DOM 那侧要等 v-model 落完才能设 selection。 */
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

/** 鼠标点一条候选（`SearchPopupController.java:117-119` / `:143-145` 的 consume）。 */
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

/**
 * 复选框能不能点 —— 委托给 `canBeEnabled`（`UltimateDependencyChecker.canBeEnabled` 的等价物）：
 * 清单读不出来 / 必需依赖成环 / 必需依赖缺装，三种都点不动。点不动的原因直接当 title 显示。
 */
function pluginCanToggle(plugin: PluginInfo): boolean {
  return canBeEnabled(plugin).enabled
}
/** 点不动时的那一句话（能点时返回 null，`:title` 绑定空值就是不加 title）。 */
function pluginToggleBlockedReason(plugin: PluginInfo): string | undefined {
  const verdict = canBeEnabled(plugin)
  return verdict.enabled ? undefined : verdict.reason
}
const visible = computed(() => props.plugins.filter(plugin =>
  matchesInstalledQuery(plugin, parsed.value, marketEntries.value.filter(entry => marketplaceEntryStatus(entry, props.plugins).state === 'update').map(entry => entry.id))))
// 按启用状态筛选时"正在安装"那一组不参与（它还没有启用状态可言）。
const visibleInstalling = computed(() => {
  const current = parsed.value
  if (current.options.length) return []
  if (!current.keyword) return installing.value
  const needle = current.keyword
  return installing.value.filter(label => label.toLowerCase().includes(needle.toLowerCase()))
})
const groups = computed(() => buildInstalledGroups(visible.value, visibleInstalling.value, sortByName.value))

const selected = computed(() => visible.value.find(plugin => plugin.id === selectedId.value) ?? visible.value[0] ?? null)

/**
 * 整页的**加载错误**清单 —— 上游 `PluginManagerStateService.kt:115-139` 的 `preparePluginErrors`
 * 把「全局原因」（成环，一条环只报一次）与「逐插件原因」分两截列出来，本仓的第一截就是
 * `pluginLoadingErrors()`；第二截在本页由详情面板的 `pluginLoadingError()` 逐插件说。
 * 再加一条 `CoreBundle.properties:42`（`Module {0} is declared by multiple plugins`）的等价物：
 * 同一个入口点被多个插件声明（本仓是动作 id / 模板 key 被抢）。
 * 空清单整节不渲染（没有内容就不铺一行）。
 */
const loadErrors = computed(() => [
  ...pluginLoadingErrors(props.plugins),
  ...duplicateFeatures(props.plugins).map(item =>
    `${PLUGIN_FEATURE_LABELS[item.type]}「${item.name}」被多个插件声明：${item.plugins.join('、')}`),
])

/**
 * 这条命令 / 模板**还有**哪些插件在贡献 —— 上游 `PluginFeatureService.kt:69-71` 的
 * `getPluginForFeature(featureType, implementationName)`（反向索引本体 `data.kt:50-59`）。
 * 只数会真正被加载的插件（上游那张表是在扩展点处理过程中登记的，未加载的插件不登记），
 * 并排除正在显示的那个插件。
 */
function otherProviders(kind: 'action' | 'template', name: string): PluginInfo[] {
  if (!name) return []
  return featureProviders(props.plugins, kind, name).filter(plugin => plugin.id !== selected.value?.id)
}

/**
 * 卸载确认正文 —— 上游 `newui/UninstallAction.kt:91-103`：有插件依赖它时走
 * `getUninstallDependentsMessage`（`:137-155`），把依赖者逐个列进正文再问一次；
 * 没有依赖者时走 `prompt.uninstall.plugin`（`IdeBundle.properties:457`）。
 * 本仓的卸载是删目录（`native/plugins.cpp` 的 `uninstall`），被牵连的依赖者会留在
 * 「必需依赖缺失」的无效态（`list()` 的 `broken`），所以这一段是**真后果**而不是提示噪音。
 */
const uninstallPrompt = computed(() => (selected.value ? pluginUninstallPrompt(selected.value, props.plugins) : null))

/**
 * 「解析出来但本仓没有数据源」的两类查询词的一句话说明：
 * `/bundled`、`/updatedBundled` 要 IDE 自带插件那一层，`/tag:`、`/updatesFrom:` 要远端清单
 * （上游取值点在 `InstalledPluginsTabSearchResultPanel.kt:95-116`，数据来自 marketplace）。
 */
const filterNote = computed(() => {
  const parts: string[] = []
  if (parsed.value.unsupported.length) parts.push(parsed.value.unsupported.map(item => INSTALLED_OPTION_LABEL[item]).join('、'))
  if (parsed.value.deferred.length) parts.push(UNSUPPORTED_ATTRIBUTE_WORDS.join('、'))
  if (!parts.length) return ''
  return `${parts.join('、')} 需要插件仓库或自带插件，本仓还没有。`
})

/**
 * 递给市场页的整条查询 —— 已安装页什么都没搜到时，空态后面挂一条「在市场页搜这个」链接
 * （上游 `InstalledPluginsTabSearchResultPanel.kt:64-69`：把 `query` **原样**交给
 * `mySearchInMarketplaceTabHandler`，链接文字是 `IdeBundle.properties:1620`
 * "Search in Marketplace"，按英文原文直译；`:56-63` 那八个属性词有一个出现就不挂）。
 * `stamp` 是自增号：连着点两次同一条查询也要让子组件收到"换了一次"。
 */
const marketSeed = ref<{ text: string; stamp: number } | null>(null)
let marketSeedStamp = 0
function searchInMarketplace() {
  marketSeedStamp += 1
  marketSeed.value = { text: query.value, stamp: marketSeedStamp }
  tab.value = 'market'
}

/**
 * 市场页点「已安装 / 已安装（无效）」的状态徽章 → 切回已安装页并选中它，必要时连带启用。
 * 上游这条动作是 `PluginManagerConfigurable.kt:397-401` 的 `showPluginConfigurableAndEnable`
 * → `PluginManagerConfigurablePanel.kt:490-493` 的 `selectAndEnable`（先 `model.enable(descriptors)`
 * 再 `select(...)`；`select` 本体 `:495-514` 第一件事就是 `updateSelectionTab(INSTALLED_TAB)`）。
 * 本仓的列表是过滤后的视图，所以选中前先清掉查询：清过滤就是上游「回到默认面板再选」的等价动作
 * （上游是在默认面板里找那个组件，搜索面板里没有它时根本选不中）。
 */
function focusInstalledPlugin(id: string) {
  query.value = ''
  tab.value = 'installed'
  const plugin = props.plugins.find(item => item.id === id)
  if (!plugin) return
  selectedId.value = id
  // enable 的那一半：只有「现在点得动」且确实处于停用状态才连带启用（`canBeEnabled` 的口径，
  // 依赖不满足的插件上游也启用来不了，这里就不假装能）。
  if (!plugin.enabled && pluginCanToggle(plugin)) emit('setEnabled', [id], true)
}

// 外部（宿主/通知里的动作）要求的定位：打开时带 id 就选过去。
watch(() => props.focusPlugin, id => {
  if (id) focusInstalledPlugin(id)
}, { immediate: true })

watch(visible, rows => {
  if (!rows.some(plugin => plugin.id === selectedId.value)) selectedId.value = rows[0]?.id ?? ''
}, { immediate: true })

// 过滤按钮点击 = 往搜索框里加/减一个 `/xxx`（IDEA `handleSearchOptionSelection`），
// 所以手动打 `/enabled` 和点按钮是同一条路径。
function toggleFilter(option: SupportedSearchOption) {
  query.value = toggleInstalledSearchOption(query.value, option)
  void nextTick(() => { searchRef.value?.focus(); syncSuggestCaret() })
}

function clearQuery() {
  query.value = ''
  void nextTick(() => { searchRef.value?.focus(); syncSuggestCaret() })
}

// ── 插件贡献的文件类型（`FileTypeBean` 的装载面）───────────────────────────────────
//
// 上游插件一装载，它 `<fileType>` 标签里的类型与关联就进 `FileTypeManager`；停用/卸载后
// EP 不再贡献，关联也随之消失。本仓的等价时机就是这张列表变化时（启用/禁用/安装/卸载/刷新），
// 所以在这里 `watch` 一次整张表 —— 回收与认领都要看全表才判得准。
const fileTypeReport = ref<PluginFileTypeReport | null>(null)
watch(() => props.plugins, plugins => { fileTypeReport.value = applyPluginFileTypes(plugins) }, { immediate: true })

/** 被拒的声明与改判结论合成一句人话（没有就空串，页脚不渲染）。 */
const fileTypeNote = computed(() => {
  const report = fileTypeReport.value
  if (!report) return ''
  const parts: string[] = []
  for (const rejected of report.rejected) parts.push(`「${rejected.typeName}」没有注册：${rejected.reason}`)
  for (const conflict of report.conflicts) if (conflict.message) parts.push(conflict.message)
  return parts.join('；')
})

/** 一条声明实际认领了什么（把分号串翻成人话，规则与 `parseFileTypeBean` 同源）。 */
function fileTypeAssociationsText(bean: PluginFileType): string {
  const parts: string[] = []
  if (bean.extensions) parts.push(`扩展名 ${bean.extensions.split(';').filter(Boolean).join('、')}`)
  if (bean.fileNames) parts.push(`文件名 ${bean.fileNames.split(';').filter(Boolean).join('、')}`)
  if (bean.patterns) parts.push(`模式 ${bean.patterns.split(';').filter(Boolean).join('、')}`)
  if (bean.fileNamesCaseInsensitive) parts.push(`文件名（忽略大小写） ${bean.fileNamesCaseInsensitive.split(';').filter(Boolean).join('、')}`)
  if (bean.hashBangs) parts.push(`hashbang ${bean.hashBangs.split(';').filter(Boolean).join('、')}`)
  return parts.join(' · ')
}

/** 这条声明是「新类型」还是「给已有类型补关联」（上游 `FileTypeBean.java:29-41` 的两种用法）。 */
const fileTypeKindLabel = (bean: PluginFileType) => (bean.implementationClass ? '新类型' : '给已有类型补关联')
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="help-dialog plugin-dialog" role="dialog" aria-modal="true" aria-labelledby="plugin-title" @keydown.esc.stop="emit('close')">
      <header class="plugin-head">
        <h2 id="plugin-title">插件</h2>
        <button v-if="tab === 'installed'" type="button" class="subtle-button plugin-install" title="安装一个插件包（.zip / .jar，内含 plugin.json）" :disabled="busy" @click="emit('install')">
          <FileArchive :size="iconSize.control" aria-hidden="true" />从磁盘安装…
        </button>
        <button v-if="tab === 'installed'" type="button" class="icon-button" title="从一个含 plugin.json 的目录安装" aria-label="从目录安装插件" :disabled="busy" @click="emit('installDirectory')">
          <FolderPlus :size="iconSize.toolbar" aria-hidden="true" />
        </button>
        <button v-if="tab === 'installed'" type="button" class="icon-button" title="重新读取插件目录" aria-label="刷新插件列表" :disabled="busy" @click="emit('refresh')">
          <RefreshCw :size="iconSize.toolbar" aria-hidden="true" />
        </button>
        <button type="button" class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="iconSize.action" aria-hidden="true" /></button>
      </header>
      <!-- 两个标签页：已安装（InstalledPluginsTab）与市场（MarketplacePluginsTab）。 -->
      <div class="plugin-tabs" role="tablist" aria-label="插件页">
        <button type="button" role="tab" class="plugin-tab" :class="{ on: tab === 'installed' }" :aria-selected="tab === 'installed'" @click="tab = 'installed'">已安装</button>
        <button type="button" role="tab" class="plugin-tab" :class="{ on: tab === 'market' }" :aria-selected="tab === 'market'" @click="tab = 'market'">市场</button>
      </div>
      <template v-if="tab === 'installed'">
      <p class="plugin-hint">
        插件目录：用户配置目录下的 <code>plugins</code>。一个插件是一个含 <code>plugin.json</code> 的子目录（也可以直接装 <code>.zip</code> 插件包）；
        <span class="plugin-hint-actions">启用后它贡献的命令、实时模板与文件类型会立即出现在菜单、模板列表与文件类型注册表里。</span>
      </p>

      <div class="plugin-toolbar">
        <label class="plugin-search">
          <Search :size="iconSize.control" aria-hidden="true" />
          <input ref="searchRef" v-model="query" type="search" placeholder="搜索插件，或输入 /enabled、/disabled、/invalid、/vendor:厂商 过滤" aria-label="搜索插件"
                 @input="syncSuggestCaret" @click="syncSuggestCaret" @keyup="onSearchKeyup" @keydown="onSearchKeydown" />
          <button v-if="query" type="button" class="icon-button" title="清空搜索" aria-label="清空搜索" @click="clearQuery"><X :size="iconSize.menu" aria-hidden="true" /></button>
        </label>
        <button type="button" class="subtle-button plugin-sort" :class="{ on: !sortByName }" :aria-pressed="!sortByName" @click="sortByName = !sortByName">
          {{ sortByName ? '按名称排序' : '按目录顺序' }}
        </button>
      </div>

      <!-- 属性词/取值建议（`SearchPopupController.java:102-148`）：词表点一下接上它，
           带冒号的词点一下出取值表，取值走 `wrapAttribute`。没有候选时这一行整个不出现。 -->
      <ul v-if="suggestVisible" class="plugin-suggest" role="listbox" :aria-label="suggest.attribute || '插件搜索属性词'">
        <li v-for="(word, index) in suggest.words" :key="word">
          <button type="button" class="plugin-suggest-item" :class="{ on: index === suggestIndex }" role="option"
                  :aria-selected="index === suggestIndex" @mousedown.prevent="acceptSuggestion(word)">{{ word }}</button>
        </li>
      </ul>

      <div class="plugin-filters" role="toolbar" aria-label="插件过滤">
        <button v-for="option in SUPPORTED_SEARCH_OPTIONS" :key="option" type="button" class="plugin-filter"
                :class="{ on: activeOptions.has(option) }" :aria-pressed="activeOptions.has(option)"
                :title="`在搜索框里加减 /${option}`" @click="toggleFilter(option)">
          {{ INSTALLED_OPTION_LABEL[option] }} <span class="plugin-filter-count">{{ counts[option] }}</span>
        </button>
        <span v-if="filterNote" class="plugin-filter-note">{{ filterNote }}</span>
      </div>

      <!-- 加载错误清单（`PluginManagerStateService.preparePluginErrors` 的全局那一截 +
           `CoreBundle.properties:42` 的重复声明）：只有真有内容才出现这一节。 -->
      <ul v-if="loadErrors.length" class="plugin-load-errors" role="status" aria-label="插件加载错误">
        <li v-for="line in loadErrors" :key="line">{{ line }}</li>
      </ul>

      <div class="plugin-body">
        <div class="plugin-column">
          <p v-if="!plugins.length && !installing.length" class="plugin-empty">还没有安装插件。把插件目录放进上面那个 <code>plugins</code> 文件夹后点刷新。</p>
          <p v-else-if="!groups.length" class="plugin-empty">没有匹配的插件。试试其他名称，或取消过滤。<button v-if="offersMarketplaceSearch(query)" type="button" class="plugin-inline-link" :title="`把「${query}」原样交给市场页搜索`" @click="searchInMarketplace">在市场页搜这个</button></p>
          <div v-else class="plugin-groups">
            <section v-for="group in groups" :key="group.prefix" class="plugin-group">
              <header class="plugin-group-head">
                <h3 class="plugin-group-title">{{ group.title }}</h3>
                <button v-if="group.action" type="button" class="plugin-group-action" :disabled="busy"
                        @click="emit('setEnabled', group.action.ids, group.action.kind === 'enableAll')">
                  {{ group.action.label }}
                </button>
              </header>
              <ul class="plugin-list" role="listbox" :aria-label="group.title">
                <li v-for="plugin in group.plugins" :key="plugin.id">
                  <button type="button" class="plugin-row" role="option" :aria-selected="selected?.id === plugin.id" :class="{ 'is-selected': selected?.id === plugin.id }" @click="selectedId = plugin.id">
                    <span class="plugin-avatar" aria-hidden="true"><Blocks :size="iconSize.control" /></span>
                    <span class="plugin-main">
                      <span class="plugin-name">{{ plugin.name || plugin.id }}<span class="plugin-version">v{{ plugin.version || '0' }}</span></span>
                      <span class="plugin-desc">{{ plugin.error ? `清单无法读取：${plugin.error}` : (plugin.broken ? `依赖不满足：${plugin.broken}` : (plugin.description || '没有描述。')) }}</span>
                      <span v-if="!plugin.error" class="plugin-meta">{{ plugin.commands.length }} 个命令 · {{ plugin.templates.length }} 个模板<span v-if="(plugin.fileTypes ?? []).length"> · {{ (plugin.fileTypes ?? []).length }} 个文件类型</span></span>
                    </span>
                    <label class="plugin-toggle" @click.stop>
                      <input type="checkbox" :checked="plugin.enabled" :disabled="busy || !pluginCanToggle(plugin)" :title="pluginToggleBlockedReason(plugin)" :aria-label="`启用插件 ${plugin.name || plugin.id}`" @change="emit('toggle', plugin.id, !plugin.enabled)" />
                    </label>
                  </button>
                </li>
                <li v-for="label in group.pending" :key="`pending-${label}`">
                  <div class="plugin-row is-pending" aria-busy="true">
                    <span class="plugin-avatar plugin-avatar-pending" aria-hidden="true"><Loader2 :size="iconSize.control" class="spin" /></span>
                    <span class="plugin-main">
                      <span class="plugin-name">{{ label }}</span>
                      <span class="plugin-desc">正在安装…</span>
                    </span>
                  </div>
                </li>
              </ul>
            </section>
          </div>
        </div>

        <aside v-if="selected" class="plugin-detail" aria-label="插件详情">
          <h3>{{ selected.name || selected.id }}</h3>
          <dl>
            <div><dt>版本</dt><dd>{{ selected.version || '未声明' }}<span v-if="updateTargetOf(selected)" class="plugin-update"> · 市场有 v{{ updateTargetOf(selected) }}</span></dd></div>
            <div><dt>标识</dt><dd><code>{{ selected.id }}</code></dd></div>
            <div v-if="selected.category"><dt>类目</dt><dd>{{ selected.category }}</dd></div>
            <!-- 厂商（上游清单的 `<vendor>`：`PluginXmlConst.kt:36` / `IdeaPluginDescriptorImpl.kt:224`，
                 界面字段 `PluginUiModel.kt:52`）。清单没写就不出现这一行 —— 上游那边显示
                 `(not specified)`（`IdeBundle.properties:455`），本仓的详情面板不铺没内容的行。
                 点它是把 `/vendor:` 词整框写进搜索框（上游详情面板的厂商链接：
                 `newui/PluginDetailsPageComponent.kt:1336`，替换动作在 `newui/PluginsTab.kt:271`）。 -->
            <div v-if="selected.vendor"><dt>厂商</dt><dd>
              <button type="button" class="plugin-inline-link" :title="`只看厂商「${selected.vendor}」的插件`"
                      @click="query = vendorQueryWord(selected.vendor ?? '')">{{ selected.vendor }}</button>
            </dd></div>
            <div><dt>状态</dt><dd>{{ selected.error ? '无效（清单无法读取）' : (pluginIsBroken(selected) ? '无效（依赖不满足）' : (selected.enabled ? '已启用' : '已禁用')) }}</dd></div>
            <div v-if="pluginDependencySummary(selected)"><dt>依赖</dt><dd>{{ pluginDependencySummary(selected) }}</dd></div>
            <div><dt>路径</dt><dd><code>{{ selected.path }}</code></dd></div>
          </dl>
          <p class="plugin-detail-desc">{{ selected.description || '没有描述。' }}</p>
          <!-- 变更说明（上游清单的 `<change-notes>`：元素名 `PluginXmlConst.kt:42`、读取面
               `XmlReader.kt:193`、getter `IdeaPluginDescriptorImpl.kt:195`）。展示点在
               `PluginDetailsPageComponent.kt:1394` 的 `changeNotesPanel!!.show(getChangeNotes())`，
               那块面板在 `:847-862` 建、内容是 null 就整块不可见 —— 本仓同口径：清单没写就不渲染这一段。 -->
          <p v-if="selected.changeNotes" class="plugin-detail-desc">变更说明：{{ selected.changeNotes }}</p>
          <p v-if="selected.error" class="plugin-detail-error">清单无法读取：{{ selected.error }}</p>
          <p v-else-if="pluginIsBroken(selected)" class="plugin-detail-error">{{ pluginLoadingError(selected) || selected.broken }}<template v-if="!pluginCanToggle(selected)"> —— 复选框点不动就是它的原因；这期间它的命令、模板与文件类型都不会出现。</template></p>
          <section v-if="selected.commands.length" class="plugin-detail-section">
            <h4>命令</h4>
            <ul>
              <li v-for="command in selected.commands" :key="command.id"><code>{{ command.id }}</code> — {{ command.title }}<span class="plugin-detail-muted">（{{ command.group || '未分组' }} → {{ command.action }}）</span><span v-if="otherProviders('action', command.action).length" class="plugin-detail-muted"> · 另由 {{ otherProviders('action', command.action).map(item => item.name || item.id).join('、') }} 贡献同一动作</span></li>
            </ul>
          </section>
          <section v-if="selected.templates.length" class="plugin-detail-section">
            <h4>实时模板</h4>
            <ul>
              <li v-for="template in selected.templates" :key="template.key"><code>{{ template.key }}</code> — {{ template.description || '未描述' }}<span class="plugin-detail-muted">（{{ template.languages.join('、') || '全部语言' }}）</span><span v-if="otherProviders('template', template.key).length" class="plugin-detail-muted"> · 另由 {{ otherProviders('template', template.key).map(item => item.name || item.id).join('、') }} 贡献同一模板</span></li>
            </ul>
          </section>
          <!-- 文件类型贡献（上游 `<fileType>` = `FileTypeBean`）：这一节存在就说明它真的进了注册表。 -->
          <section v-if="(selected.fileTypes ?? []).length" class="plugin-detail-section">
            <h4>文件类型</h4>
            <ul>
              <li v-for="bean in selected.fileTypes" :key="bean.name">
                <code>{{ bean.name }}</code> — {{ fileTypeAssociationsText(bean) || '没有认领任何模式' }}
                <span class="plugin-detail-muted">（{{ fileTypeKindLabel(bean) }}{{ bean.language ? ` · 语言 ${bean.language}` : '' }}）</span>
              </li>
            </ul>
          </section>
          <p v-if="fileTypeNote" class="plugin-detail-error" role="status">{{ fileTypeNote }}</p>
          <!-- 有插件依赖它时先逐个点名再问第二次（`UninstallAction.kt:91-103` +
               `IdeBundle.properties:2359` 的 `dialog.message.following.plugin.depend.on`：
               上游把依赖者的名字逐个拼进同一条正文，这里照同一形状，换行由 pre-line 生效）。
               本仓卸载 = 删目录（`native/plugins.cpp` 的 `uninstall`），不会连带删依赖者，
               所以列出来的依赖者卸载后确实会变成 `broken`（`list()` 的缺依赖判定）。 -->
          <p v-if="confirmId === selected.id && uninstallPrompt && uninstallPrompt.dependents.length" class="plugin-detail-warning" role="status">
            {{ uninstallPrompt.message }}
          </p>
          <div class="plugin-detail-actions">
            <button v-if="confirmId !== selected.id" type="button" class="subtle-button plugin-danger" :disabled="busy" @click="confirmId = selected.id">
              <Trash2 :size="iconSize.menu" aria-hidden="true" />卸载…
            </button>
            <template v-else>
              <button type="button" class="primary-button menu-danger-solid" :disabled="busy" @click="confirmId = ''; emit('uninstall', selected.id)">
                确认卸载「{{ selected.name || selected.id }}」
              </button>
              <button type="button" class="subtle-button" @click="confirmId = ''">取消</button>
            </template>
          </div>
        </aside>
      </div>
      </template>
      <PluginMarketPanel v-show="tab === 'market'" :plugins="plugins" :busy="busy" :seed="marketSeed"
                         @changed="emit('refresh')" @catalog="entries => marketEntries = entries" @focus-plugin="focusInstalledPlugin"
                         @update-available="notice => emit('updateAvailable', notice)" />

      <div class="dialog-actions"><button class="subtle-button" @click="emit('close')">关闭</button></div>
    </section>
  </div>
</template>

<style scoped>
.plugin-dialog { width: min(880px, 94vw); }
.plugin-head { display: flex; align-items: center; gap: var(--space-2); }
.plugin-head h2 { flex: 1; margin: 0; }
.plugin-tabs { display: flex; align-items: center; gap: var(--space-1); border-bottom: 1px solid var(--line); }
.plugin-tab { padding: 5px var(--space-3); border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--secondary); font-size: 12px; }
.plugin-tab.on { border-bottom-color: var(--accent); color: var(--bright); }
.plugin-hint { margin: var(--space-1) 0 var(--space-3); color: var(--muted); font-size: 12px; line-height: 1.6; }
.plugin-hint-actions { color: var(--secondary); }
.plugin-toolbar { display: flex; align-items: center; gap: var(--space-2); }
.plugin-search { display: flex; align-items: center; gap: var(--space-1); flex: 1; min-width: 0; padding: 0 var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--editor); color: var(--muted); }
.plugin-search input { flex: 1; min-width: 0; padding: 6px 0; border: 0; outline: none; background: transparent; color: var(--bright); font-size: 12px; }
/* 建议浮层：贴在搜索框下方的一列词/取值（上游是 JBList 弹层，`newui/SearchPopup.java:73`）。 */
.plugin-suggest { display: flex; flex-direction: column; gap: 1px; margin: var(--space-1) 0 0; padding: var(--space-1); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--editor); list-style: none; }
.plugin-suggest-item { width: 100%; padding: 3px var(--space-2); border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--secondary); font-size: 11px; text-align: left; }
.plugin-suggest-item.on, .plugin-suggest-item:hover { background: var(--hover); color: var(--bright); }
.plugin-sort { flex-shrink: 0; }
.plugin-sort.on { color: var(--bright); background: var(--hover); }
.plugin-filters { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1); margin: var(--space-2) 0; }
.plugin-filter { display: inline-flex; align-items: center; gap: var(--space-1); padding: 3px var(--space-2); border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--secondary); font-size: 11px; }
.plugin-filter.on { border-color: var(--line-strong); background: var(--selected); color: var(--bright); }
.plugin-filter-count { color: var(--muted); font-variant-numeric: tabular-nums; }
.plugin-filter-note { color: var(--muted); font-size: 11px; }
/* 加载错误清单：一条一行，正文由 `loadErrors` 给出（只在全仓真有加载错误时才渲染）。 */
.plugin-load-errors { display: flex; flex-direction: column; gap: 2px; margin: 0 0 var(--space-2); padding-left: var(--space-3); color: var(--warning); font-size: 11px; line-height: 1.5; }
/* 空态里的「在市场页搜这个」与详情面板的厂商链接：上游两者都是 LinkLabel（`PluginsTab.kt:271`）。 */
.plugin-inline-link { padding: 0; border: 0; background: transparent; color: var(--secondary); font: inherit; cursor: pointer; text-decoration: underline dotted; text-underline-offset: 2px; }
.plugin-inline-link:hover { color: var(--bright); }
.plugin-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 320px); gap: var(--space-3); max-height: 52vh; }
.plugin-column { min-height: 0; overflow: auto; }
.plugin-groups { display: flex; flex-direction: column; gap: var(--space-3); }
.plugin-group-head { display: flex; align-items: baseline; gap: var(--space-2); margin-bottom: var(--space-1); }
.plugin-group-title { flex: 1; margin: 0; color: var(--secondary); font-size: 11px; font-weight: 600; letter-spacing: .02em; }
.plugin-group-action { padding: 2px 6px; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--secondary); font-size: 11px; }
.plugin-group-action:hover:not(:disabled) { border-color: var(--line-strong); color: var(--bright); background: var(--hover); }
.plugin-list { display: flex; flex-direction: column; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
.plugin-row { display: flex; align-items: center; gap: var(--space-2); width: 100%; padding: var(--space-2); border: 1px solid transparent; border-radius: var(--radius-sm); background: var(--editor); text-align: left; }
.plugin-row:hover { border-color: var(--line-strong); }
.plugin-row.is-selected { border-color: var(--accent); background: var(--selected); }
.plugin-row.is-pending { opacity: .75; border-style: dashed; border-color: var(--line-strong); }
.plugin-avatar { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; flex-shrink: 0; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel); color: var(--muted); }
.plugin-avatar-pending { background: var(--hover); }
.plugin-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.plugin-name { display: flex; align-items: baseline; gap: var(--space-2); color: var(--bright); font-size: 13px; font-weight: 600; }
.plugin-version { color: var(--muted); font-size: 11px; font-weight: 400; }
.plugin-desc { color: var(--secondary); font-size: 11px; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plugin-meta { color: var(--muted); font-size: 10px; }
.plugin-toggle { flex-shrink: 0; }
.plugin-empty { padding: var(--space-5) var(--space-3); color: var(--muted); font-size: 12px; text-align: center; }
.plugin-detail { min-height: 0; overflow: auto; padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--editor); }
.plugin-detail h3 { margin: 0 0 var(--space-2); color: var(--bright); font-size: 13px; }
.plugin-detail dl { display: flex; flex-direction: column; gap: var(--space-1); margin: 0 0 var(--space-2); }
.plugin-detail dl > div { display: flex; gap: var(--space-2); font-size: 11px; }
.plugin-detail dt { flex-shrink: 0; width: 44px; color: var(--muted); }
.plugin-detail dd { flex: 1; min-width: 0; margin: 0; color: var(--secondary); overflow-wrap: anywhere; }
.plugin-detail-desc { margin: 0 0 var(--space-2); color: var(--secondary); font-size: 11px; line-height: 1.6; }
.plugin-detail-error { margin: 0 0 var(--space-2); color: var(--warning); font-size: 11px; }
/* 卸载牵连提醒：正文里每个依赖者一行（`pluginUninstallPrompt` 用 \n 拼接，上游是同一条 HTML 正文）。 */
.plugin-detail-warning { margin: 0 0 var(--space-2); color: var(--warning); font-size: 11px; line-height: 1.6; white-space: pre-line; }
.plugin-detail-section { margin-top: var(--space-2); }
.plugin-detail-section h4 { margin: 0 0 var(--space-1); color: var(--bright); font-size: 11px; }
.plugin-detail-section ul { display: flex; flex-direction: column; gap: 3px; margin: 0; padding-left: var(--space-3); color: var(--secondary); font-size: 11px; line-height: 1.5; }
.plugin-detail-muted { color: var(--muted); }
.plugin-update { color: var(--accent); }
.plugin-install { flex-shrink: 0; }
.plugin-detail-actions { display: flex; gap: var(--space-2); margin-top: var(--space-3); }
.plugin-danger { color: var(--warning); }
/* keyframes 收在全局的 `tc-spin`（src/style.css，与状态栏/Gradle 共用一份，见那里的说明）。 */
.spin { animation: tc-spin var(--dur-spin) var(--ease-linear) infinite; }
@media (max-width: 760px) {
  .plugin-body { grid-template-columns: minmax(0, 1fr); max-height: none; }
}
</style>
