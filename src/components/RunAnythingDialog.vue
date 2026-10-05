<script setup lang="ts">
// Run Anything 弹层 —— 上游 `RunAnythingAction`/`RunAnythingPopupUI`（`ide/actions/runAnything`）的
// 对应物。候选装配/分组/历史在 src/runAnything.ts；这里只做输入、键盘导航与派发：
//   · 选运行配置 → App 走 `selectRunConfig` + `runSelectedConfig`（与 Run 菜单同一条链）；
//   · 命令行行 → App 走 `runExternalTool`（run.start 通道）。
// 输入框是多行编辑器（上游 `RunAnythingPopupUI` 的 `Shift+Enter` 插换行）：多行命令照原样
// 传给 shell（cmd 换行即命令分隔，见 native/run_host.cpp 的 cmd /c 通道），列表里按
// 上游 `RunAnythingCommandFolding` 的占位写法只显示第一行 + 行数。
import { computed, nextTick, onMounted, ref } from 'vue'
import { Terminal, X } from 'lucide-vue-next'
import { buildRunAnythingRows, commandDisplayName, loadRunAnythingHistory, pushRunAnythingHistory, RUN_ANYTHING_GROUP_TITLES, type RunAnythingGroupId, type RunAnythingRow } from '../runAnything'
import { iconSize } from '../uiIcons'

const props = defineProps<{ configs: Array<{ name: string; type?: string }> }>()
const emit = defineEmits<{
  (event: 'runConfig', payload: { name: string }): void
  (event: 'runCommand', payload: { command: string }): void
  (event: 'close'): void
}>()

const query = ref('')
const history = ref(loadRunAnythingHistory())
const selected = ref(0)
const input = ref<HTMLTextAreaElement>()
const expanded = ref<RunAnythingGroupId[]>([])
const rows = computed(() => buildRunAnythingRows(props.configs, query.value, history.value, { expanded: expanded.value }))

function move(delta: number) {
  const list = rows.value
  if (!list.length) return
  selected.value = (selected.value + delta + list.length) % list.length
}
function pick(row: RunAnythingRow | undefined) {
  if (!row) return
  if (row.kind === 'more') {
    if (!expanded.value.includes(row.group)) expanded.value = [...expanded.value, row.group]
    return
  }
  // 历史行保留原始类别：命令历史用命令行通道重跑，不按同名配置找。
  const kind = row.sourceKind ?? row.kind
  if (kind === 'command') {
    history.value = pushRunAnythingHistory({ kind: 'command', name: row.name, detail: row.detail })
    emit('runCommand', { command: row.name })
    return
  }
  history.value = pushRunAnythingHistory({ kind: 'config', name: row.name, detail: row.detail })
  emit('runConfig', { name: row.name })
}
function onQuery() { selected.value = 0 }
// 组标题：只在组的第一行上方显示（上游 RunAnythingGroup.getTitle 的插入行）。
function groupTitleAt(index: number): string {
  const row = rows.value[index]
  const previous = rows.value[index - 1]
  return row && (!previous || previous.group !== row.group) ? RUN_ANYTHING_GROUP_TITLES[row.group] : ''
}
onMounted(() => { void nextTick(() => input.value?.focus()) })
</script>

<template>
  <div class="modal-backdrop run-anything-backdrop" @click.self="emit('close')">
    <section class="command-palette run-anything" role="dialog" aria-modal="true" aria-label="Run Anything" @keydown.esc.prevent="emit('close')">
      <div class="palette-input">
        <Terminal :size="iconSize.action" />
        <textarea
          ref="input" v-model="query" rows="1" class="run-anything-input" placeholder="输入运行配置名，或直接输入命令（> 前缀强制按命令运行；Shift+Enter 换行）" aria-label="Run Anything"
          spellcheck="false" @input="onQuery"
          @keydown.enter.exact.prevent="pick(rows[selected])"
          @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)"
        ></textarea>
        <button class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="iconSize.action" /></button>
      </div>
      <div class="palette-results" role="listbox" aria-label="Run Anything 候选">
        <template v-for="(row, index) in rows" :key="`${row.kind}:${row.name}:${index}`">
          <p v-if="groupTitleAt(index)" class="run-anything-group">{{ groupTitleAt(index) }}</p>
          <button
            class="location-row run-anything-row" :class="{ highlighted: index === selected, 'run-anything-more': row.kind === 'more' }" role="option" :aria-selected="index === selected"
            @click="pick(row)" @pointerenter="selected = index"
          >
            <Terminal :size="iconSize.toolbar" aria-hidden="true" />
            <span class="location-main"><strong>{{ row.kind === 'command' || row.sourceKind === 'command' ? commandDisplayName(row.name) : row.name }}</strong><span class="run-anything-detail">{{ row.detail }}</span></span>
            <span class="run-anything-kind">{{ row.kind === 'more' ? '更多' : row.kind === 'command' || row.sourceKind === 'command' ? '命令' : row.kind === 'history' ? '最近' : '配置' }}</span>
          </button>
        </template>
        <p v-if="!rows.length" class="palette-empty">没有匹配的运行配置；输入命令会以命令行方式运行。</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.run-anything-backdrop { align-items: flex-start; }
.run-anything { margin-top: 12vh; width: 640px; max-width: 92vw; }
.run-anything-detail { margin-left: var(--space-2); color: var(--muted); font-size: 11px; }
.run-anything-kind { flex-shrink: 0; margin-left: auto; color: var(--muted); font-size: 11px; }
.run-anything-row { align-items: baseline; }
.run-anything-row strong { color: var(--bright); font-family: var(--font-mono); }
.run-anything-more strong { color: var(--accent); }
.run-anything-group { margin: 0; padding: var(--space-1) var(--space-3) 0; color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
.run-anything-input { flex: 1; min-width: 0; box-sizing: border-box; min-height: var(--ctrl-height-sm, 22px); max-height: 88px; resize: vertical; padding: 2px var(--space-2); color: var(--text); background: transparent; border: 0; outline: none; font: inherit; font-family: var(--font-mono); }
</style>
