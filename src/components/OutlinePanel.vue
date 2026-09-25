<script setup lang="ts">
import { computed, ref } from 'vue'
import { FolderTree, ArrowDownAZ, Rows3, ListTree } from 'lucide-vue-next'
import type { LspDocumentSymbol } from '../bridge'
import { arrange, treeOf } from '../outlineView'

const props = defineProps<{ path: string; symbols: LspDocumentSymbol[]; available: boolean }>()
const emit = defineEmits<{ jump: [position: { line: number; character: number }] }>()

// IDEA's structure popup toggles: alphabetical order, a flattened list, and a speed
// filter. None of them changes what the language server sent, only how it is read.
const sortByName = ref(false)
const flatView = ref(false)
const filter = ref('')

const tree = computed(() => treeOf(props.symbols))
const rows = computed(() => arrange(tree.value, { sort: sortByName.value, flat: flatView.value, filter: filter.value }))

const KIND: Record<number, string> = {
  1: '文件', 2: '模块', 3: '命名空间', 4: '类', 5: '方法', 6: '属性', 7: '字段', 8: '构造器',
  9: '枚举', 10: '接口', 11: '函数', 12: '函数', 13: '变量', 14: '常量', 15: '结构体',
  16: '数值', 17: '枚举成员', 18: '字符串', 19: '布尔', 20: '数组', 21: '对象', 22: '键',
  23: '字段', 24: '常量', 25: '类型', 26: '类',
}
const label = (symbol: LspDocumentSymbol) => `${KIND[symbol.kind] ?? '符号'} · ${symbol.name}`
</script>

<template>
  <div class="outline-panel">
    <div class="panel-heading"><span><FolderTree :size="14" />结构大纲</span><span class="heading-count">{{ symbols.length }}</span></div>
    <div v-if="path && available" class="outline-tools">
      <button class="outline-tool" :class="{ on: sortByName }" :title="sortByName ? '按名称排序' : '按文档顺序'" aria-label="按名称排序" @click="sortByName = !sortByName"><ArrowDownAZ :size="13" /></button>
      <button class="outline-tool" :class="{ on: flatView }" :title="flatView ? '平铺显示' : '层级显示'" aria-label="平铺显示" @click="flatView = !flatView"><component :is="flatView ? Rows3 : ListTree" :size="13" /></button>
      <input v-model="filter" class="outline-filter" aria-label="按名称过滤符号" placeholder="过滤符号…" spellcheck="false" />
    </div>
    <div v-if="!path" class="outline-empty"><FolderTree :size="24" /><p>打开一个文件查看符号大纲</p></div>
    <div v-else-if="!available" class="outline-empty"><FolderTree :size="24" /><p>该语言服务未提供符号信息</p><span class="outline-file">{{ path }}</span></div>
    <div v-else-if="!symbols.length" class="outline-empty"><p>此文件没有符号</p></div>
    <div v-else class="outline-scroll">
      <button v-for="(entry, index) in rows" :key="`${entry.symbol.name}:${entry.symbol.startLine}:${entry.symbol.startChar}:${index}`"
              class="outline-row" :style="{ paddingLeft: `${entry.depth * 13 + 12}px` }"
              :title="entry.trail ? `${entry.trail}.${entry.symbol.name}` : label(entry.symbol)"
              @click="emit('jump', { line: entry.symbol.startLine, character: entry.symbol.startChar })">
        <span class="outline-kind">{{ label(entry.symbol) }}</span>
        <span v-if="entry.trail" class="outline-trail">{{ entry.trail }}</span>
        <span class="outline-pos">{{ entry.symbol.startLine + 1 }}:{{ entry.symbol.startChar + 1 }}</span>
      </button>
      <p v-if="!rows.length" class="outline-empty">没有匹配的符号。</p>
    </div>
  </div>
</template>

<style scoped>
.outline-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.outline-tools { display: flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--line); }
.outline-tool { display: inline-flex; align-items: center; justify-content: center; width: var(--ctrl-height-sm); height: 22px; flex-shrink: 0; color: var(--muted); background: transparent; border: 1px solid var(--line); border-radius: var(--radius-sm); cursor: pointer; }
.outline-tool:hover { background: var(--hover); color: var(--text); }
.outline-tool.on { color: var(--accent); background: var(--selected); border-color: var(--line-strong); }
.outline-filter { flex: 1; min-width: 0; min-height: 22px; padding: 2px var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: 11px; }
.outline-filter:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.outline-trail { min-width: 0; flex-shrink: 1; overflow: hidden; color: var(--muted); font: 10px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.heading-count { margin-left: auto; color: var(--muted); font-size: 10px; }
.outline-scroll { flex: 1; min-height: 0; overflow: auto; padding-bottom: var(--space-2); }
.outline-row { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); width: 100%; padding: 2px var(--space-2) 2px var(--space-3); border: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; font-size: 12px; }
.outline-row:hover { background: var(--hover); }
.outline-kind { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.outline-pos { flex-shrink: 0; color: var(--muted); font: 10px/1.6 var(--font-mono); }
.outline-empty { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); padding: var(--space-5) var(--space-3); color: var(--muted); text-align: center; font-size: 11px; line-height: 1.7; }
.outline-empty p { margin: 0; }
.outline-file { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--secondary); font: 10px var(--font-mono); }
</style>
