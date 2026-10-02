<script setup lang="ts">
// 插件对话框：对照 IDEA 的 PluginsConfigurable（InstalledPluginsTab）——
// 顶部搜索 + 过滤，中间**按分组**列出插件（组标题带"已启用 n/m"、组级「全部启用/全部禁用」），
// 右侧详情面板（名称/版本/id/路径/描述/命令/模板/启用状态）。
//
// 分组、类目、搜索语法这些**规则**都在 `src/pluginGroups.ts`（纯函数 + 单测），
// 这里只负责把它们画出来。
import { computed, nextTick, ref, watch } from 'vue'
import { FileArchive, FolderPlus, Loader2, RefreshCw, Search, Trash2, X } from 'lucide-vue-next'
import type { PluginInfo } from '../bridge'
import {
  INSTALLED_OPTION_LABEL,
  SUPPORTED_SEARCH_OPTIONS,
  buildInstalledGroups,
  installedQueryOptions,
  matchesInstalledQuery,
  parseInstalledQuery,
  toggleInstalledSearchOption,
  type SupportedSearchOption,
} from '../pluginGroups'

import { iconSize } from '../uiIcons'
const props = defineProps<{
  plugins: PluginInfo[]
  /** 正在安装的条目（安装源的名字）；解压完才解析出清单，所以这期间只有名字。 */
  installing?: string[]
  busy?: boolean
  /** 插件目录说明用（用户配置目录下的 plugins）。 */
  isDesktop?: boolean
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
}>()

const query = ref('')
const sortByName = ref(true)
const selectedId = ref<string>('')
// 卸载是不可逆的目录删除：先点「卸载…」再确认（IDEA 也有确认步骤）。
const confirmId = ref<string>('')
const searchRef = ref<HTMLInputElement>()

const installing = computed(() => props.installing ?? [])

const counts = computed(() => ({
  userInstalled: props.plugins.length,
  enabled: props.plugins.filter(plugin => plugin.enabled && !plugin.error).length,
  disabled: props.plugins.filter(plugin => !plugin.enabled && !plugin.error).length,
  invalid: props.plugins.filter(plugin => Boolean(plugin.error)).length,
}))

const parsed = computed(() => parseInstalledQuery(query.value))
const activeOptions = computed(() => installedQueryOptions(query.value))
const visible = computed(() => props.plugins.filter(plugin => matchesInstalledQuery(plugin, parsed.value)))
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

watch(visible, rows => {
  if (!rows.some(plugin => plugin.id === selectedId.value)) selectedId.value = rows[0]?.id ?? ''
}, { immediate: true })

// 过滤按钮点击 = 往搜索框里加/减一个 `/xxx`（IDEA `handleSearchOptionSelection`），
// 所以手动打 `/enabled` 和点按钮是同一条路径。
function toggleFilter(option: SupportedSearchOption) {
  query.value = toggleInstalledSearchOption(query.value, option)
  void nextTick(() => searchRef.value?.focus())
}

// 与 IDEA RecentProjectIconHelper 同一套观感：首字母 + 稳定色调的圆形图标。
function initial(plugin: PluginInfo) {
  return (plugin.name || plugin.id).trim().slice(0, 1).toUpperCase() || '?'
}
function tone(plugin: PluginInfo) {
  const source = plugin.id || plugin.name || '?'
  let hash = 0
  for (const ch of source) hash = (hash * 31 + ch.charCodeAt(0)) % 360
  return hash
}

function clearQuery() {
  query.value = ''
  void nextTick(() => searchRef.value?.focus())
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="help-dialog plugin-dialog" role="dialog" aria-modal="true" aria-labelledby="plugin-title" @keydown.esc.stop="emit('close')">
      <header class="plugin-head">
        <h2 id="plugin-title">插件</h2>
        <button type="button" class="subtle-button plugin-install" title="安装一个插件包（.zip / .jar，内含 plugin.json）" :disabled="busy" @click="emit('install')">
          <FileArchive :size="iconSize.control" aria-hidden="true" />从磁盘安装…
        </button>
        <button type="button" class="icon-button" title="从一个含 plugin.json 的目录安装" aria-label="从目录安装插件" :disabled="busy" @click="emit('installDirectory')">
          <FolderPlus :size="iconSize.toolbar" aria-hidden="true" />
        </button>
        <button type="button" class="icon-button" title="重新读取插件目录" aria-label="刷新插件列表" :disabled="busy" @click="emit('refresh')">
          <RefreshCw :size="iconSize.toolbar" aria-hidden="true" />
        </button>
        <button type="button" class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="iconSize.action" aria-hidden="true" /></button>
      </header>
      <p class="plugin-hint">
        插件目录：用户配置目录下的 <code>plugins</code>。一个插件是一个含 <code>plugin.json</code> 的子目录（也可以直接装 <code>.zip</code> 插件包）；
        <span class="plugin-hint-actions">启用后它贡献的命令与实时模板会立即出现在菜单与模板列表里。</span>
      </p>

      <div class="plugin-toolbar">
        <label class="plugin-search">
          <Search :size="iconSize.control" aria-hidden="true" />
          <input ref="searchRef" v-model="query" type="search" placeholder="搜索插件，或输入 /enabled、/disabled、/invalid 过滤" aria-label="搜索插件" />
          <button v-if="query" type="button" class="icon-button" title="清空搜索" aria-label="清空搜索" @click="clearQuery"><X :size="iconSize.menu" aria-hidden="true" /></button>
        </label>
        <button type="button" class="subtle-button plugin-sort" :class="{ on: !sortByName }" :aria-pressed="!sortByName" @click="sortByName = !sortByName">
          {{ sortByName ? '按名称排序' : '按目录顺序' }}
        </button>
      </div>

      <div class="plugin-filters" role="toolbar" aria-label="插件过滤">
        <button v-for="option in SUPPORTED_SEARCH_OPTIONS" :key="option" type="button" class="plugin-filter"
                :class="{ on: activeOptions.has(option) }" :aria-pressed="activeOptions.has(option)"
                :title="`在搜索框里加减 /${option}`" @click="toggleFilter(option)">
          {{ INSTALLED_OPTION_LABEL[option] }} <span class="plugin-filter-count">{{ counts[option] }}</span>
        </button>
        <span v-if="parsed.unsupported.length" class="plugin-filter-note">
          {{ parsed.unsupported.map(item => INSTALLED_OPTION_LABEL[item]).join('、') }} 需要插件仓库或自带插件，本仓还没有。
        </span>
      </div>

      <div class="plugin-body">
        <div class="plugin-column">
          <p v-if="!plugins.length && !installing.length" class="plugin-empty">还没有安装插件。把插件目录放进上面那个 <code>plugins</code> 文件夹后点刷新。</p>
          <p v-else-if="!groups.length" class="plugin-empty">没有匹配的插件。试试其他名称，或取消过滤。</p>
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
                    <span class="plugin-avatar" :style="{ background: `linear-gradient(135deg, hsl(${tone(plugin)} 62% 52%), hsl(${(tone(plugin) + 40) % 360} 62% 44%))` }" aria-hidden="true">{{ initial(plugin) }}</span>
                    <span class="plugin-main">
                      <span class="plugin-name">{{ plugin.name || plugin.id }}<span class="plugin-version">v{{ plugin.version || '0' }}</span></span>
                      <span class="plugin-desc">{{ plugin.error ? `清单无法读取：${plugin.error}` : (plugin.description || '没有描述。') }}</span>
                      <span v-if="!plugin.error" class="plugin-meta">{{ plugin.commands.length }} 个命令 · {{ plugin.templates.length }} 个模板</span>
                    </span>
                    <label class="plugin-toggle" @click.stop>
                      <input type="checkbox" :checked="plugin.enabled" :disabled="busy || Boolean(plugin.error)" :aria-label="`启用插件 ${plugin.name || plugin.id}`" @change="emit('toggle', plugin.id, !plugin.enabled)" />
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
            <div><dt>版本</dt><dd>{{ selected.version || '未声明' }}</dd></div>
            <div><dt>标识</dt><dd><code>{{ selected.id }}</code></dd></div>
            <div v-if="selected.category"><dt>类目</dt><dd>{{ selected.category }}</dd></div>
            <div><dt>状态</dt><dd>{{ selected.error ? '无效（清单无法读取）' : (selected.enabled ? '已启用' : '已禁用') }}</dd></div>
            <div><dt>路径</dt><dd><code>{{ selected.path }}</code></dd></div>
          </dl>
          <p class="plugin-detail-desc">{{ selected.description || '没有描述。' }}</p>
          <p v-if="selected.error" class="plugin-detail-error">清单无法读取：{{ selected.error }}</p>
          <section v-if="selected.commands.length" class="plugin-detail-section">
            <h4>命令</h4>
            <ul>
              <li v-for="command in selected.commands" :key="command.id"><code>{{ command.id }}</code> — {{ command.title }}<span class="plugin-detail-muted">（{{ command.group || '未分组' }} → {{ command.action }}）</span></li>
            </ul>
          </section>
          <section v-if="selected.templates.length" class="plugin-detail-section">
            <h4>实时模板</h4>
            <ul>
              <li v-for="template in selected.templates" :key="template.key"><code>{{ template.key }}</code> — {{ template.description || '未描述' }}<span class="plugin-detail-muted">（{{ template.languages.join('、') || '全部语言' }}）</span></li>
            </ul>
          </section>
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

      <div class="dialog-actions"><button class="subtle-button" @click="emit('close')">关闭</button></div>
    </section>
  </div>
</template>

<style scoped>
.plugin-dialog { width: min(880px, 94vw); }
.plugin-head { display: flex; align-items: center; gap: var(--space-2); }
.plugin-head h2 { flex: 1; margin: 0; }
.plugin-hint { margin: var(--space-1) 0 var(--space-3); color: var(--muted); font-size: 12px; line-height: 1.6; }
.plugin-hint-actions { color: var(--secondary); }
.plugin-toolbar { display: flex; align-items: center; gap: var(--space-2); }
.plugin-search { display: flex; align-items: center; gap: var(--space-1); flex: 1; min-width: 0; padding: 0 var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--editor); color: var(--muted); }
.plugin-search input { flex: 1; min-width: 0; padding: 6px 0; border: 0; outline: none; background: transparent; color: var(--bright); font-size: 12px; }
.plugin-sort { flex-shrink: 0; }
.plugin-sort.on { color: var(--bright); background: var(--hover); }
.plugin-filters { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1); margin: var(--space-2) 0; }
.plugin-filter { display: inline-flex; align-items: center; gap: 4px; padding: 3px var(--space-2); border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--secondary); font-size: 11px; }
.plugin-filter.on { border-color: var(--line-strong); background: var(--selected); color: var(--bright); }
.plugin-filter-count { color: var(--muted); font-variant-numeric: tabular-nums; }
.plugin-filter-note { color: var(--muted); font-size: 11px; }
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
.plugin-avatar { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; flex-shrink: 0; border-radius: 50%; color: var(--on-accent); font: 600 13px var(--font-brand); text-shadow: 0 1px 1px rgb(0 0 0 / 35%); }
.plugin-avatar-pending { background: var(--hover); color: var(--muted); text-shadow: none; }
.plugin-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.plugin-name { display: flex; align-items: baseline; gap: var(--space-2); color: var(--bright); font-size: 13px; font-weight: 600; }
.plugin-version { color: var(--muted); font-size: 11px; font-weight: 400; }
.plugin-desc { color: var(--secondary); font-size: 11px; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plugin-meta { color: var(--muted); font-size: 10px; }
.plugin-toggle { flex-shrink: 0; }
.plugin-empty { padding: var(--space-5) var(--space-3); color: var(--muted); font-size: 12px; text-align: center; }
.plugin-detail { min-height: 0; overflow: auto; padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--editor); }
.plugin-detail h3 { margin: 0 0 var(--space-2); color: var(--bright); font-size: 13px; }
.plugin-detail dl { display: flex; flex-direction: column; gap: 4px; margin: 0 0 var(--space-2); }
.plugin-detail dl > div { display: flex; gap: var(--space-2); font-size: 11px; }
.plugin-detail dt { flex-shrink: 0; width: 44px; color: var(--muted); }
.plugin-detail dd { flex: 1; min-width: 0; margin: 0; color: var(--secondary); overflow-wrap: anywhere; }
.plugin-detail-desc { margin: 0 0 var(--space-2); color: var(--secondary); font-size: 11px; line-height: 1.6; }
.plugin-detail-error { margin: 0 0 var(--space-2); color: var(--warning); font-size: 11px; }
.plugin-detail-section { margin-top: var(--space-2); }
.plugin-detail-section h4 { margin: 0 0 4px; color: var(--bright); font-size: 11px; }
.plugin-detail-section ul { display: flex; flex-direction: column; gap: 3px; margin: 0; padding-left: var(--space-3); color: var(--secondary); font-size: 11px; line-height: 1.5; }
.plugin-detail-muted { color: var(--muted); }
.plugin-install { flex-shrink: 0; }
.plugin-detail-actions { display: flex; gap: var(--space-2); margin-top: var(--space-3); }
.plugin-danger { color: var(--warning); }
.spin { animation: plugin-spin var(--dur-spin) linear infinite; }
@keyframes plugin-spin { to { transform: rotate(360deg); } }
@media (max-width: 760px) {
  .plugin-body { grid-template-columns: minmax(0, 1fr); max-height: none; }
}
</style>
