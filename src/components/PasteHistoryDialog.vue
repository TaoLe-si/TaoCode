<script setup lang="ts">
// 从剪贴板历史粘贴（IDEA `PasteFromHistoryAction` + `ContentChooser`）。
//
// 源码：platform/platform-impl/src/com/intellij/openapi/editor/actions/PasteFromHistoryAction.java:97-107
// （`ClipboardContentChooser`：标题 = UIBundle `choose.content.to.paste.dialog.title`，多选、列表带筛选、
//   OK 按钮文案取 `EditorPaste`，另有"简单粘贴"按钮与取消）与
// platform/platform-impl/src/com/intellij/openapi/editor/actions/ContentChooser.java
//   · `:144-149` 双击 = 确定
//   · `:160-181` Delete = 删除选中项；Enter = 确定；数字键 1..9（0 = 第 10 项）选中该项并确定
//   · `:201-204` 列表工具条的删除动作
//   · `:392-400` 行首是右对齐的序号 + 两个空格
//   · `:419-441` 行文本 = 前 80 个字符，换行折成 `⏎`，截断加省略号
// 这些渲染/按键规则本身是纯函数，放在 src/clipboard.ts 里并有单测；组件只负责 DOM 与派发。
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowRight, ClipboardPaste, Trash2, X } from 'lucide-vue-next'
import { clipboardDigitIndex, clipboardPreview, clipboardRowPrefix, type ClipboardEntry } from '../clipboard'
import { iconSize } from '../uiIcons'

const props = defineProps<{ entries: ClipboardEntry[] }>()
const emit = defineEmits<{
  (event: 'pick', payload: { index: number }): void
  (event: 'remove', payload: { index: number }): void
  (event: 'close'): void
}>()

const query = ref('')
const cursor = ref(0)
const filter = ref<HTMLInputElement>()

// `ListWithFilter.wrap(myList, scroll, o -> o.getShortText(80), true)`（`ContentChooser.java:205-207`）：
// 过滤的是**显示文本**（已折叠换行的前 80 字），不是原始内容。
const rows = computed(() => props.entries
  .map((entry, index) => ({ entry, index, label: clipboardPreview(entry.text) }))
  .filter(row => !query.value || row.label.toLowerCase().includes(query.value.trim().toLowerCase())))

watch(rows, () => { cursor.value = 0 })
void nextTick(() => filter.value?.focus())

function pick(index: number) { emit('pick', { index }) }
function remove(index: number) {
  emit('remove', { index })
}

function onKeydown(event: KeyboardEvent) {
  const list = rows.value
  if (event.key === 'Escape') { event.preventDefault(); emit('close'); return }
  if (event.key === 'ArrowDown') { event.preventDefault(); if (list.length) cursor.value = (cursor.value + 1) % list.length; return }
  if (event.key === 'ArrowUp') { event.preventDefault(); if (list.length) cursor.value = (cursor.value - 1 + list.length) % list.length; return }
  if (event.key === 'Enter') {
    event.preventDefault()
    const row = list[cursor.value]
    if (row) pick(row.index)
    return
  }
  // `ContentChooser.java:160-166`：Delete 删的是**列表选中项**；这里没有多选，所以是本行
  if (event.key === 'Delete' && !query.value) {
    const row = list[cursor.value]
    if (row) { event.preventDefault(); remove(row.index) }
    return
  }
  // `:171-181`：数字键直达。源码用**未过滤**的总数做边界检查，然后选中**视图**里的那一行。
  const digitIndex = clipboardDigitIndex(event.key)
  if (digitIndex !== null && digitIndex < props.entries.length && rows.value[digitIndex]) {
    event.preventDefault()
    pick(rows.value[digitIndex]!.index)
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="command-palette" role="dialog" aria-modal="true" aria-label="从历史粘贴">
      <div class="palette-input">
        <ClipboardPaste :size="iconSize.action" />
        <input ref="filter" v-model="query" placeholder="筛选剪贴板历史…（回车粘贴，Delete 删除）" aria-label="筛选剪贴板历史" @keydown="onKeydown" />
        <button class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="iconSize.action" /></button>
      </div>
      <div class="palette-results">
        <button
          v-for="(row, position) in rows" :key="`${row.index}:${row.label}`"
          :class="{ highlighted: position === cursor }" role="option" :aria-selected="position === cursor"
          @click="pick(row.index)" @dblclick="pick(row.index)" @pointerenter="cursor = position"
        >
          <span class="paste-index">{{ clipboardRowPrefix(position, rows.length) }}</span>
          <span class="paste-text">{{ row.label }}</span>
          <span class="paste-remove" role="button" :aria-label="`删除第 ${position + 1} 项`" title="删除这一项" @click.stop="remove(row.index)"><Trash2 :size="iconSize.menu" /></span>
          <ArrowRight v-if="position === cursor" :size="iconSize.control" />
        </button>
        <p v-if="!rows.length" class="palette-empty">剪贴板历史为空。</p>
      </div>
      <div class="paste-actions">
        <span class="small-muted">{{ entries.length }} 项（上限 100 项 / 约 1000 万字符）</span>
        <button class="subtle-button" @click="emit('close')">取消</button>
        <button class="primary-button" :disabled="!rows.length" @click="rows[cursor] && pick(rows[cursor]!.index)">粘贴</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.paste-index { color: var(--text-dim); font-variant-numeric: tabular-nums; white-space: pre; flex-shrink: 0; }
.paste-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); }
.paste-remove { display: inline-flex; align-items: center; color: var(--text-dim); padding: 0 4px; transition: color var(--dur-1) var(--ease); }
.paste-remove:hover { color: var(--error); }
.paste-actions { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-top: 1px solid var(--line-strong); }
.paste-actions .small-muted { flex: 1; }
.paste-actions .primary-button { margin-top: 0; }
</style>
