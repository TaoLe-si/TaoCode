<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { FolderTree, ArrowDownAZ, Rows3, ListTree, Group, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Lock, LocateFixed, ArrowDownToLine } from 'lucide-vue-next'
import type { LspDocumentSymbol } from '../bridge'
import { arrange, caretSymbolInTree, treeOf } from '../outlineView'
import { caretCharacterInSymbolBasis, shouldRevealInEditor } from '../structureFollow'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  path: string
  symbols: LspDocumentSymbol[]
  available: boolean
  /** 编辑器光标位置（`ctx.todoSource` 那一份）：只有开了「跟随编辑器」才用。
   *  行/列都是**编辑器口径（1 基）**，与 `TodoPanel` 吃的是同一份；符号区间是 LSP 的 0 基，
   *  用的那一侧负责换算（见下面的 watch）。 */
  source?: { path: string; line: number; character?: number } | null
}>()
const emit = defineEmits<{ jump: [position: { line: number; character: number }] }>()

// IDEA's structure popup toggles: alphabetical order, a flattened list, grouping by
// symbol kind (KindSorter) and a speed filter. None of them changes what the language
// server sent, only how it is read.
const sortByName = ref(false)
const flatView = ref(false)
const groupByKind = ref(false)
// 按可见性排序（上游 `VisibilitySorter`，`VisibilitySorter.java:31`）。
const sortByVisibility = ref(false)
const filter = ref('')
// 两个跟随开关就是上游那两个（`StructureViewFactoryImpl.java:49-50`）：
// AUTOSCROLL_MODE 选中树节点→跳源码，默认开；AUTOSCROLL_FROM_SOURCE 光标→选中节点，默认关。
const autoscrollToSource = ref(true)
const autoscrollFromSource = ref(false)
const selectedKey = ref('')
const listEl = ref<HTMLElement | null>(null)

// 折叠状态（上游 `StructureViewComponent` 的树展开态）：键是符号的身份（名字 + 位置），
// 换文件时清空 —— 位置相同的不同文件里会撞键，留着折叠态会让新文件莫名收着。
const collapsed = ref(new Set<string>())
watch(() => props.path, () => { collapsed.value = new Set(); selectedKey.value = '' })
function toggleCollapse(key: string) {
  const next = new Set(collapsed.value)
  if (next.has(key)) next.delete(key); else next.add(key)
  collapsed.value = next
}
function collapseAll() {
  // 先按当前视图完整展开算一遍，把所有有子节点的行收起来（IDEA 的 Collapse All 同样收到顶层）。
  const all = arrange(tree.value, { sort: sortByName.value, flat: false, group: groupByKind.value, visibility: sortByVisibility.value, filter: filter.value })
  collapsed.value = new Set(all.filter(entry => entry.hasChildren).map(entry => entry.key))
}
function expandAll() { collapsed.value = new Set() }

const tree = computed(() => treeOf(props.symbols))
const rows = computed(() => arrange(tree.value, {
  sort: sortByName.value, flat: flatView.value, group: groupByKind.value,
  visibility: sortByVisibility.value, filter: filter.value, collapsed: collapsed.value,
}))

// 选中一行：开着「跟随到源码」时选中就跳（上游 `scrollToSource` → `OpenSourceUtil.openSourcesFrom`，
// `StructureViewComponent.java:794-802`）；关着时只更新选择，跳源码留给双击/回车。
function selectRow(entry: { key: string; symbol: LspDocumentSymbol }, force = false) {
  const previous = selectedKey.value
  selectedKey.value = entry.key
  if (!force && !shouldRevealInEditor(autoscrollToSource.value, entry.key, previous)) return
  void revealSource(entry.symbol)
}
function revealSource(symbol: LspDocumentSymbol) {
  emit('jump', { line: symbol.startLine, character: symbol.startChar })
}

// 反方向：编辑器光标动 → 树里选中包住光标的符号，并把它的折叠祖先展开、滚进视野
// （`StructureViewComponent.java:819-835` 的光标监听 + `:655` 的 scrollToSelectedElement）。
// 入参口径：`ctx.todoSource` 给的是**编辑器**那一套（行/列都 1 基，`CodeEditor.vue:1022`），
// 符号区间是 LSP 的 0 基 ⇒ 这里换算，不换算的话整条跟随差一行。
watch(() => autoscrollFromSource.value && props.source && props.source.path === props.path
  ? `${props.source.line}:${props.source.character ?? 0}` : '', key => {
  if (!key || !props.source) return
  const match = caretSymbolInTree(tree.value, props.source.line - 1, caretCharacterInSymbolBasis(props.source.character))
  if (!match) return
  selectedKey.value = match.key
  if (collapsed.value.size) {
    const next = new Set(collapsed.value)
    for (const ancestor of match.ancestors) next.delete(ancestor)
    collapsed.value = next
  }
  void scrollRowIntoView(match.key)
})

async function scrollRowIntoView(key: string) {
  await nextTick()
  const row = listEl.value?.querySelector(`[data-key="${cssKey(key)}"]`)
  row?.scrollIntoView({ block: 'nearest' })
}
// data-key 的值里带冒号（键 = 名字:行:列:行:列），属性选择器用引号包住；
// 引号和反斜杠是唯一会破坏 `[data-key="…"]` 的字符，这里转义这两个。
function cssKey(key: string) { return key.replace(/\\/g, '\\\\').replace(/"/g, '\\"') }

// LSP SymbolKind enum（spec 编号，1 基；native 原样透传，假服务器夹具与
// navigate-in-file 也用这一套。早前那张表整体错位了一位，Class 被标成"方法"）。
const KIND: Record<number, string> = {
  1: '文件', 2: '模块', 3: '命名空间', 4: '包', 5: '类', 6: '方法', 7: '属性', 8: '字段',
  9: '构造器', 10: '枚举', 11: '接口', 12: '函数', 13: '变量', 14: '常量', 15: '字符串',
  16: '数值', 17: '布尔', 18: '数组', 19: '对象', 20: '键', 21: '空', 22: '枚举成员',
  23: '结构体', 24: '事件', 25: '运算符', 26: '类型参数',
}
const label = (symbol: LspDocumentSymbol) => `${KIND[symbol.kind] ?? '符号'} · ${symbol.name}`
</script>

<template>
  <div class="outline-panel">
    <div class="panel-heading"><span><FolderTree :size="iconSize.control" />结构大纲</span><span class="heading-count">{{ filter.trim() ? `${rows.length}/${symbols.length}` : symbols.length }}</span></div>
    <div v-if="path && available" class="outline-tools">
      <button class="outline-tool" :class="{ on: sortByName }" :title="sortByName ? '按名称排序' : '按文档顺序'" aria-label="按名称排序" @click="sortByName = !sortByName"><ArrowDownAZ :size="iconSize.menu" /></button>
      <button class="outline-tool" :class="{ on: flatView }" :title="flatView ? '平铺显示' : '层级显示'" aria-label="平铺显示" @click="flatView = !flatView"><component :is="flatView ? Rows3 : ListTree" :size="iconSize.menu" /></button>
      <button class="outline-tool" :class="{ on: groupByKind }" :title="groupByKind ? '按种类分组' : '按文档顺序（不分组）'" aria-label="按种类分组" :aria-pressed="groupByKind" @click="groupByKind = !groupByKind"><Group :size="iconSize.menu" /></button>
      <button class="outline-tool" :class="{ on: sortByVisibility }" :title="sortByVisibility ? '按可见性排序（公开在前）' : '不按可见性排序'" aria-label="按可见性排序" :aria-pressed="sortByVisibility" @click="sortByVisibility = !sortByVisibility"><Lock :size="iconSize.menu" /></button>
      <button class="outline-tool" :class="{ on: autoscrollToSource }" :title="autoscrollToSource ? '选中符号后跳到源码（开）' : '选中符号后不跳源码（关，双击才跳）'" aria-label="选中符号后跳到源码" :aria-pressed="autoscrollToSource" @click="autoscrollToSource = !autoscrollToSource"><ArrowDownToLine :size="iconSize.menu" /></button>
      <!-- 反向跟随要有编辑器光标才能成立。挂载点（`src/components/ToolWindowView.vue:170`）传的是
           `:source="ctx.todoSource"`（接线请求 W1，2026-10-06 已落），而 `ctx.todoSource` 在
           **没有打开的文件**时是 null（`src/App.vue:215`）⇒ 那时整格仍不渲染。
           「不放假控件」：不做画出来点了没反应的开关。 -->
      <button v-if="source" class="outline-tool" :class="{ on: autoscrollFromSource }" :title="autoscrollFromSource ? '跟随编辑器光标（开）' : '跟随编辑器光标（关）'" aria-label="跟随编辑器光标" :aria-pressed="autoscrollFromSource" @click="autoscrollFromSource = !autoscrollFromSource"><LocateFixed :size="iconSize.menu" /></button>
      <button class="outline-tool" title="全部展开" aria-label="全部展开" @click="expandAll"><ChevronsUpDown :size="iconSize.menu" /></button>
      <button class="outline-tool" title="全部折叠" aria-label="全部折叠" @click="collapseAll"><ChevronsDownUp :size="iconSize.menu" /></button>
      <input v-model="filter" class="outline-filter" aria-label="按名称过滤符号" placeholder="过滤符号…" spellcheck="false" />
    </div>
    <div v-if="!path" class="outline-empty"><FolderTree :size="iconSize.artwork" /><p>打开一个文件查看符号大纲</p></div>
    <div v-else-if="!available" class="outline-empty"><FolderTree :size="iconSize.artwork" /><p>该语言服务未提供符号信息</p><span class="outline-file">{{ path }}</span></div>
    <div v-else-if="!symbols.length" class="outline-empty"><p>此文件没有符号</p></div>
    <div v-else ref="listEl" class="outline-scroll" role="group" aria-label="符号列表">
      <div v-for="(entry, index) in rows" :key="`${entry.key}:${index}`" class="outline-row" :data-key="entry.key"
           :class="{ selected: entry.key === selectedKey }"
           :style="{ paddingLeft: `${entry.depth * 13 + 12}px` }">
        <button v-if="entry.hasChildren" class="outline-caret" :aria-expanded="!entry.collapsed"
                :title="entry.collapsed ? '展开' : '折叠'"
                :aria-label="entry.collapsed ? `展开 ${entry.symbol.name}` : `折叠 ${entry.symbol.name}`"
                @click="toggleCollapse(entry.key)">
          <ChevronRight v-if="entry.collapsed" :size="iconSize.dense" /><ChevronDown v-else :size="iconSize.dense" />
        </button>
        <span v-else class="outline-caret outline-caret-empty" aria-hidden="true" />
        <button class="outline-jump" :title="entry.trail ? `${entry.trail}.${entry.symbol.name}` : label(entry.symbol)"
                @click="selectRow(entry)" @dblclick="selectRow(entry, true)" @keydown.enter.prevent="selectRow(entry, true)">
          <span class="outline-kind">{{ label(entry.symbol) }}</span>
          <span v-if="entry.trail" class="outline-trail">{{ entry.trail }}</span>
          <span class="outline-pos">{{ entry.symbol.startLine + 1 }}:{{ entry.symbol.startChar + 1 }}</span>
        </button>
      </div>
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
.outline-row { display: flex; align-items: baseline; gap: 2px; width: 100%; padding: 2px var(--space-2) 2px var(--space-3); transition: background-color var(--dur-1) var(--ease); }
.outline-row:hover { background: var(--hover); }
/* 当前选中的符号行（跟随编辑器/点击选中），与本地历史、任务面板同一套选择色。 */
.outline-row.selected { background: var(--selected); }
/* 折叠箭头（有子节点的行）与占位（没有子节点时保持左侧对齐）。 */
.outline-caret { display: inline-flex; align-items: center; justify-content: center; width: 14px; flex-shrink: 0; border: 0; padding: 0; background: transparent; color: var(--muted); cursor: pointer; }
.outline-caret:hover { color: var(--bright); }
.outline-jump { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); flex: 1; min-width: 0; border: 0; padding: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; font-size: 12px; }
.outline-kind { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.outline-pos { flex-shrink: 0; color: var(--muted); font: 10px/1.6 var(--font-mono); }
.outline-empty { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); padding: var(--space-5) var(--space-3); color: var(--muted); text-align: center; font-size: 11px; line-height: 1.7; }
.outline-empty p { margin: 0; }
.outline-file { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--secondary); font: 10px var(--font-mono); }
</style>
