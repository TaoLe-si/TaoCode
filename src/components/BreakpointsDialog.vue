<script setup lang="ts">
// 「查看断点…」对话框（Ctrl+Shift+F8）—— 上游 `ViewBreakpointsAction` →
// `BreakpointsDialog`，而 `BreakpointsDialog` 正是 `com.intellij.ui.popup.util` 那一族
// （`MasterController` / `DetailController` / `DetailView` / `ItemWrapperListRenderer`）在
// **整棵树里唯一的真实消费者**。
//
// 形态逐条照上游：左列表 + 右详情。列表项是「文件:行」，详情面板顶部是路径标签
// （过长时**从左侧省略**，`DetailController.getTitle2Text`），正文是该行源码。
// 没有可显示内容时用 `DetailViewImpl` 的空态文案（`IdeCoreBundle.properties:143`，中文包 :91
// =「没有要显示的内容」）。
//
// 与上游的两处如实差异：
//   ① 上游详情面板嵌的是真编辑器（`EditorFactory.createViewer`），本仓用只读代码块 ——
//      这是同一个"看源码那一行"的两种画法；
//   ② 上游的列表按"文件 / 行 / 条件"分列，本仓列表是单列（路径:行），条件放详情里。
import { computed, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { NOTHING_TO_SHOW, detailPaneState, elidePath, type DetailItem } from '../popupDetail'

const props = defineProps<{
  items: DetailItem[]
  /** 路径标签的可用宽度（px）。上游量的是 `JLabel.getWidth()`。 */
  labelWidth?: number
}>()
const emit = defineEmits<{ (event: 'close'): void; (event: 'open', item: DetailItem): void }>()

const selectedId = ref<string | null>(props.items[0]?.id ?? null)
// 上游 `DetailController` 用 `FontMetrics.stringWidth` 量宽；本仓用等宽字体的近似值 ——
// 只影响"省到第几段"，不影响算法本身（`elidePath` 把量宽作为参数收，就是为了这一层解耦）。
const widthOf = (text: string) => text.length * 6.6
const pane = computed(() => detailPaneState(props.items, selectedId.value ? [selectedId.value] : [], props.labelWidth ?? 320, widthOf))
const selected = computed(() => pane.value.item)

function move(delta: number) {
  const at = props.items.findIndex(item => item.id === selectedId.value)
  if (at < 0) return
  const next = (at + delta + props.items.length) % props.items.length
  selectedId.value = props.items[next]!.id
}
/** 上游列表的双击/回车 = 打开那一项（`BreakpointsDialog` 是跳到源码）。 */
function open() { if (selected.value) emit('open', selected.value) }
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="command-palette breakpoints-dialog" role="dialog" aria-modal="true" aria-label="查看断点">
      <div class="palette-input">
        <span class="breakpoints-heading">断点（{{ items.length }}）</span>
        <button class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="iconSize.action" /></button>
      </div>
      <div class="breakpoints-body">
        <ul class="breakpoints-list" role="listbox" aria-label="断点列表" tabindex="0" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.enter.prevent="open">
          <li v-for="item in items" :key="item.id">
            <button class="menu-button breakpoints-row" role="option" :aria-selected="item.id === selectedId" :class="{ selected: item.id === selectedId }" @click="selectedId = item.id" @dblclick="emit('open', item)">{{ item.title }}</button>
          </li>
        </ul>
        <!-- 详情面板：顶部是**省略过的**路径标签（上游 `getTitle2Text`），正文是那一行源码。 -->
        <div class="breakpoints-detail">
          <div class="breakpoints-path" :title="selected?.path">{{ pane.pathLabel }}</div>
          <pre v-if="selected" class="breakpoints-source">{{ selected.body }}</pre>
          <p v-else class="breakpoints-empty">{{ pane.emptyLabel }}</p>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.breakpoints-dialog { width: min(860px, calc(100vw - 32px)); }
.breakpoints-heading { color: var(--bright); }
/* 左列表 + 右详情（上游 `BreakpointsDialog` 的 master-detail 布局）。 */
.breakpoints-body { display: grid; grid-template-columns: minmax(180px, 38%) 1fr; min-height: 0; max-height: min(60vh, 520px); }
.breakpoints-list { margin: 0; padding: var(--space-1); list-style: none; overflow: auto; border-right: 1px solid var(--line); }
.breakpoints-row { width: 100%; text-align: left; font: 12px var(--font-mono); }
.breakpoints-row.selected { background: var(--selected); color: var(--bright); }
.breakpoints-detail { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
.breakpoints-path { flex: 0 0 auto; padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--line); color: var(--muted); font: 11px var(--font-mono); white-space: nowrap; overflow: hidden; }
.breakpoints-source { flex: 1 1 auto; margin: 0; padding: var(--space-2); overflow: auto; font: 12px/1.6 var(--font-mono); color: var(--text); white-space: pre-wrap; }
.breakpoints-empty { margin: auto; color: var(--muted); font-size: 12px; }
</style>