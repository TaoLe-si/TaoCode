<script setup lang="ts">
// 「系统设置」页的三块：注册表键升格的两项开关、**已改动设置的浏览/重置面板**、**注册表键表**。
//
// 上游坐标：
//   · `SettingsInspector`（`platform/platform-impl/src/com/intellij/ide/settings/json/SettingsInspector.kt`）
//     与设置页每个改动控件旁的 **Restore Defaults**（`IdeBundle.properties:123` `button.restore.defaults`）
//     ⇒ 本文件的 `changedRows` / `restoreOne` / `restoreAll`；
//   · `RegistryUi`（`platform/lang-impl/src/com/intellij/openapi/util/registry/RegistryUi.java`）：
//     Key / Value / Source 三列与列宽（`:125-138`）、表格下方跟着选中行的说明区且"需重启"时补一句
//     （`:140-176`，文案 `IdeBundle.properties:2605`）、速度搜索是**过滤档**（`:188-189`
//     `TableSpeedSearch.setFilteringMode(true)`）、列头点击排序（`:193` 的 `TableRowSorter`）、
//     「恢复默认」按钮在没有任何改动时禁用（`:485` `setEnabled(!Registry.getInstance().isInDefaultState())`）、
//     对话框上方的加粗警告（`:371-381` + `IdeBundle.properties:2603-2604`）、对话框尺寸记忆键 "Registry"
//     （`:400-402` `getDimensionServiceKey()`）。
//   · 本仓没有「显示注册表」这个 Find Action 入口（对话框宿主在冻结的 `App.vue`），
//     按 playbook §2 用本仓架构承接：把这张表挂在设置页的「系统设置」上（`SettingsDialog.vue` 已挂载本组件）。
//
// 属性是对象，子组件直接改它的字段（与父组件里 `v-model="general.xxx"` 同一口径）：
// 设置草稿靠 `props.general` 的引用收集脏标记，改字段就能被 `createSettingsDraftActions` 看到。
import { computed, ref } from 'vue'
import { defaultGeneralSettings } from '../bridge'
import type { GeneralSettingsState } from '../settingsModel'
import { inspectableSettings, restoreSettingsToDefault } from '../settingsInspector.ts'
import {
  REGISTRY_RESTART_NOTE, experimentalRegistryEnabled, registryKeySpec, registryRowRevertible,
  restoreRegistryDefault, visibleRegistryRows, type RegistryRow,
} from '../registryKeys'
import { iconSize } from '../uiIcons'
import { Search } from 'lucide-vue-next'

const props = defineProps<{ general: GeneralSettingsState }>()

// —— 注册表键升格的两项开关：说明与「已改动」标注取自 src/registryKeys.ts 的键表 ——
function hint(key: string): string {
  return registryKeySpec(key)?.description ?? ''
}
function changed(key: string): boolean {
  const spec = registryKeySpec(key)
  return spec ? experimentalRegistryEnabled(spec, props.general) !== (spec.defaultValue === 'true') : false
}

// —— 已改动的通用设置（SettingsInspector 的浏览 + 逐项 Restore Defaults）——
const changedRows = computed(() => inspectableSettings(defaultGeneralSettings, props.general))
function restoreOne(path: string): void {
  restoreSettingsToDefault(defaultGeneralSettings, props.general, [path])
}
function restoreAll(): void {
  restoreSettingsToDefault(defaultGeneralSettings, props.general)
}

// —— 注册表键表（RegistryUi 的等价物）——
type SortColumn = 'key' | 'value' | 'source'
const registryQuery = ref('')
const sortColumn = ref<SortColumn>('key')
const sortDescending = ref(false)
const selectedKey = ref('')
const registryRows = computed<RegistryRow[]>(() => {
  const rows = visibleRegistryRows(props.general, registryQuery.value, sortColumn.value)
  return sortDescending.value ? [...rows].reverse() : rows
})
const selectedRow = computed(() => registryRows.value.find(row => row.key === selectedKey.value) ?? null)
/** 选中行被过滤掉时说明区要跟着没（上游：选中行随表格内容走）。 */
const selectedDescription = computed(() => {
  const row = selectedRow.value
  if (!row) return ''
  const spec = registryKeySpec(row.key)
  return spec && spec.restartRequired ? `${row.description}${REGISTRY_RESTART_NOTE}` : (row?.description ?? '')
})
function pick(row: RegistryRow): void {
  selectedKey.value = row.key
}
function sortBy(column: SortColumn): void {
  if (sortColumn.value === column) { sortDescending.value = !sortDescending.value; return }
  sortColumn.value = column
  sortDescending.value = false
}
/** 上游 `:485`：没有任何改动时「恢复默认」是灰的。本仓只有设置页绑定的键有回退通道。 */
const anyRevertibleChange = computed(() => registryRows.value.some(row => {
  const spec = registryKeySpec(row.key)
  return spec !== undefined && registryRowRevertible(spec) && row.changed
}))
function restoreRegistryDefaults(): void {
  for (const row of registryRows.value) {
    const spec = registryKeySpec(row.key)
    if (spec) restoreRegistryDefault(spec, props.general)
  }
}
</script>

<template>
  <div class="grt-block">
    <!-- 注册表键的说明/改动标注取自 src/registryKeys.ts；勾选值仍直接绑设置字段。 -->
    <label class="checkbox-row"><input v-model="general.autoShowProcessPopup" type="checkbox" aria-describedby="general-autoshow-hint" /><span>有进程开始时自动弹出进度面板</span><span v-if="changed('ide.windowSystem.autoShowProcessPopup')" class="field-hint" role="status">已改动</span></label>
    <p id="general-autoshow-hint" class="field-hint restore-hint">{{ hint('ide.windowSystem.autoShowProcessPopup') }}对应 IDEA 的 ide.windowSystem.autoShowProcessPopup：Git、克隆或构建/运行开始时自动打开后台任务列表。</p>
    <!-- 注册表键 search.everywhere.fuzzy.files.enabled（SeFuzzyFileSearchProviderFactory.kt:28-31，默认
         false）同样没有设置页入口；默认不勾选时「随处搜索」的文件排序与移植前完全一致。 -->
    <label class="checkbox-row"><input v-model="general.fuzzyFileSearch" type="checkbox" aria-describedby="general-fuzzy-hint" /><span>随处搜索用模糊匹配排序文件</span><span v-if="changed('search.everywhere.fuzzy.files.enabled')" class="field-hint" role="status">已改动</span></label>
    <p id="general-fuzzy-hint" class="field-hint restore-hint">{{ hint('search.everywhere.fuzzy.files.enabled') }}对应 IDEA 的 search.everywhere.fuzzy.files.enabled。</p>
  </div>

  <section class="grt-block" aria-labelledby="grt-inspector-title">
    <h3 id="grt-inspector-title" class="grt-title">已改动的通用设置</h3>
    <p v-if="!changedRows.length" class="field-hint">全部与出厂默认一致。</p>
    <template v-else>
      <ul class="grt-rows">
        <li v-for="row in changedRows" :key="row.path" class="grt-row">
          <code class="grt-path">{{ row.path }}</code>
          <span class="grt-value">{{ row.value }}</span>
          <button type="button" class="subtle-button" :title="`把 ${row.path} 恢复为出厂默认（${row.defaultValue}）`" @click="restoreOne(row.path)">恢复默认</button>
        </li>
      </ul>
      <button type="button" class="subtle-button" title="把系统设置页的全部选项恢复为出厂默认（需再点“应用”生效）" @click="restoreAll()">全部恢复默认</button>
    </template>
  </section>

  <section class="grt-block" aria-labelledby="grt-registry-title">
    <h3 id="grt-registry-title" class="grt-title">注册表键</h3>
    <p class="grt-warning">修改这些值可能造成 TaoCode 行为异常。除非有人明确要求，否则不要修改。</p>
    <label class="grt-filter"><Search :size="iconSize.control" aria-hidden="true" />按键名过滤
      <input v-model="registryQuery" type="search" aria-label="按键名过滤注册表键" placeholder="驼峰或子序列，如 vs" spellcheck="false" />
    </label>
    <div class="grt-table" role="table" aria-label="注册表键" aria-rowcount="3">
      <div class="grt-head" role="row">
        <button v-for="column in (['key', 'value', 'source'] as const)" :key="column" type="button" role="columnheader" class="grt-sort"
                :aria-sort="sortColumn === column ? (sortDescending ? 'descending' : 'ascending') : 'none'"
                @click="sortBy(column)">
          {{ column === 'key' ? '键' : column === 'value' ? '值' : '来源' }}
        </button>
      </div>
      <div v-for="row in registryRows" :key="row.key" class="grt-row-grid" role="row" :aria-selected="row.key === selectedKey" tabindex="0" @click="pick(row)" @keydown.enter.prevent="pick(row)">
        <code class="grt-path">{{ row.key }}</code>
        <span class="grt-value">{{ row.value }}</span>
        <span class="grt-value">{{ row.source }}<span v-if="row.restartRequired" class="grt-restart">需重启</span></span>
      </div>
      <p v-if="!registryRows.length" class="field-hint">没有匹配「{{ registryQuery }}」的键。</p>
    </div>
    <p class="field-hint">只有「来源 = 设置页」的两项在本仓真能改回去；其余键的读取点仍是各自模块里的常量，
      所以这里不给编辑框（没有后端的控件不放）。</p>
    <p v-if="selectedDescription" class="grt-description" role="status">{{ selectedDescription }}</p>
    <button type="button" class="subtle-button" :disabled="!anyRevertibleChange" title="把所有可回退的注册表键恢复为上游默认值" @click="restoreRegistryDefaults">恢复默认</button>
  </section>
</template>

<style scoped>
.grt-block { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--line); }
.grt-title { margin: 0; color: var(--bright); font-size: 13px; font-weight: 600; }
.grt-rows { display: flex; flex-direction: column; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
.grt-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.grt-path { color: var(--text); font: 12px/1.7 var(--font-mono); overflow-wrap: anywhere; }
.grt-value { color: var(--secondary); font-size: 12px; overflow-wrap: anywhere; }
.grt-warning { margin: 0; color: var(--warning); font-weight: 600; font-size: 12px; }
.grt-filter { display: flex; align-items: center; gap: var(--space-1); color: var(--secondary); font-size: 12px; }
.grt-filter input { flex: 1 1 160px; min-width: 0; min-height: 26px; padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: inherit; }
.grt-table { display: flex; flex-direction: column; gap: 2px; }
.grt-head, .grt-row-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr); align-items: center; gap: var(--space-2); padding: 2px var(--space-1); }
.grt-sort { display: inline-flex; align-items: center; gap: var(--space-1); padding: 0; color: var(--secondary); background: none; border: 0; font: 600 12px/1.6 var(--font-ui); text-align: left; cursor: pointer; }
.grt-row-grid { border: 1px solid transparent; border-radius: var(--radius-xs); background: var(--panel); cursor: pointer; }
.grt-row-grid[aria-selected='true'] { border-color: var(--accent); }
.grt-restart { margin-left: var(--space-1); color: var(--warning); font-size: 11px; }
.grt-description { margin: 0; padding: var(--space-2); color: var(--text); background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius-xs); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
</style>
