<script setup lang="ts">
// 模块 / 已加载源文件两个清单（从 `DebugPanel.vue` 拆出，那个文件贴着机检上限）。
// 事件（module / loadedSource）只推增量，`supportsModulesRequest` / `supportsLoadedSourcesRequest`
// 声明的适配器可以在标题栏按需重取整份清单 —— 接线与整形在 src/debugSources.ts。
import { computed, ref } from 'vue'
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-vue-next'
import {
  dapCapability, dapLoadedSources, dapLoadedSourcesRequest, dapModules, dapModulesRequest,
} from '../bridge'
import { applyLoadedSourceSnapshot, applyModuleSnapshot } from '../debugSources'
import { iconSize } from '../uiIcons'

const modulesOpen = ref(false)
const sourcesOpen = ref(false)
const error = ref('')

const canModules = computed(() => dapCapability('supportsModulesRequest'))
const canSources = computed(() => dapCapability('supportsLoadedSourcesRequest'))

// 清单重取：整份快照合进事件喂起来的列表（删除仍只由 removed 事件表达）。
async function refreshLists(which: 'sources' | 'modules') {
  error.value = ''
  try {
    if (which === 'sources') applyLoadedSourceSnapshot(dapLoadedSources, (await dapLoadedSourcesRequest()).sources)
    else applyModuleSnapshot(dapModules, (await dapModulesRequest()).modules)
  } catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught) }
}
</script>

<template>
  <p v-if="error" class="debug-error">{{ error }}</p>
  <template v-if="dapModules.length || canModules">
    <div class="debug-section-title">
      <button class="debug-collapse" :aria-expanded="modulesOpen" @click="modulesOpen = !modulesOpen">
        <span class="debug-expander"><ChevronDown v-if="modulesOpen" :size="iconSize.dense" aria-hidden="true" /><ChevronRight v-else :size="iconSize.dense" aria-hidden="true" /></span>模块 · {{ dapModules.length }}
      </button>
      <button v-if="canModules" class="chip-x" title="按需重取模块清单（DAP modules）" aria-label="重取模块清单" @click="refreshLists('modules')"><RefreshCw :size="iconSize.chip" /></button>
    </div>
    <div v-if="modulesOpen" class="debug-list" role="list" aria-label="已加载模块" tabindex="0">
      <div v-for="item in dapModules" :key="item.id" class="debug-list-row" role="listitem">
        <span class="debug-name">{{ item.name || `#${item.id}` }}</span>
        <span v-if="item.type" class="debug-type">{{ item.type }}</span>
        <span class="debug-list-path">{{ item.path ?? (item.sourceReference ? `sourceReference ${item.sourceReference}` : '') }}</span>
      </div>
      <div v-if="!dapModules.length" class="debug-empty">适配器支持模块清单；点 ↻ 重取。</div>
    </div>
  </template>

  <template v-if="dapLoadedSources.length || canSources">
    <div class="debug-section-title">
      <button class="debug-collapse" :aria-expanded="sourcesOpen" @click="sourcesOpen = !sourcesOpen">
        <span class="debug-expander"><ChevronDown v-if="sourcesOpen" :size="iconSize.dense" aria-hidden="true" /><ChevronRight v-else :size="iconSize.dense" aria-hidden="true" /></span>已加载源文件 · {{ dapLoadedSources.length }}
      </button>
      <button v-if="canSources" class="chip-x" title="按需重取已加载源文件（DAP loadedSources）" aria-label="重取已加载源文件" @click="refreshLists('sources')"><RefreshCw :size="iconSize.chip" /></button>
    </div>
    <div v-if="sourcesOpen" class="debug-list" role="list" aria-label="已加载源文件" tabindex="0">
      <div v-for="item in dapLoadedSources" :key="item.key" class="debug-list-row" role="listitem">
        <span class="debug-name">{{ item.name || '（无名）' }}</span>
        <span class="debug-list-path">{{ item.path ?? (item.sourceReference ? `sourceReference ${item.sourceReference}` : '') }}</span>
      </div>
      <div v-if="!dapLoadedSources.length" class="debug-empty">适配器支持源文件清单；点 ↻ 重取。</div>
    </div>
  </template>
</template>

<style scoped>
.debug-error { margin: 0; padding: var(--space-1) var(--space-3); color: var(--error); font-size: 11px; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
.debug-section-title { margin: var(--space-3) var(--space-3) var(--space-1); color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-size: 10px; }
.debug-collapse { display: flex; align-items: center; gap: 2px; padding: 0; border: 0; background: transparent; color: var(--muted); font: inherit; text-transform: inherit; letter-spacing: inherit; }
.debug-collapse:hover { color: var(--bright); }
.debug-collapse .debug-expander { width: 10px; }
.debug-expander { display: inline-flex; align-items: center; justify-content: center; width: 14px; flex-shrink: 0; color: var(--muted); }
.chip-x { display: inline-flex; border: 0; background: transparent; color: var(--muted); padding: 1px; border-radius: var(--radius-xs); }
.chip-x:hover { color: var(--bright); }
.debug-list { max-height: 160px; overflow: auto; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.debug-list-row { display: flex; align-items: baseline; gap: var(--space-2); padding: 1px var(--space-3); font: 11px/1.6 var(--font-mono); transition: background-color var(--dur-1) var(--ease); }
.debug-list-row:hover { background: var(--hover); }
.debug-name { color: var(--syntax-keyword); flex-shrink: 0; }
.debug-type { margin-left: auto; color: var(--muted); flex-shrink: 0; }
.debug-list-path { margin-left: auto; color: var(--muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.debug-empty { padding: var(--space-1) var(--space-3); color: var(--muted); font-size: 11px; }
</style>
