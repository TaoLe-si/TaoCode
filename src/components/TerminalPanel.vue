<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Columns2, Pencil, Plus, SquareTerminal, X } from 'lucide-vue-next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { BridgeError, isDesktop, subscribeTerm, term } from '../bridge'

const props = defineProps<{ active: boolean }>()

interface Pane { id: number; label: string; view: HTMLDivElement; instance: Terminal; fit: FitAddon; off: () => void; group: number }

const stage = ref<HTMLDivElement>()
const panes = shallowRef<Pane[]>([])
const selected = shallowRef<Pane | null>(null)
const busy = ref(false)
const note = ref('')
const renaming = shallowRef<Pane | null>(null)
const renameText = ref('')
const renameInput = ref<HTMLInputElement>()
let observer: ResizeObserver | undefined
let counter = 0
let groups = 0
let disposed = false

function visible(pane: Pane) {
  const current = selected.value
  return Boolean(current) && pane.group === current!.group
}

function refit() {
  for (const pane of panes.value) {
    if (!visible(pane) || !pane.view.offsetParent) continue
    pane.fit.fit()
    void term.resize(pane.id, pane.instance.cols, pane.instance.rows).catch(() => undefined)
  }
}

function layout() {
  const shown = panes.value.filter(visible)
  for (const pane of panes.value) {
    pane.view.hidden = !shown.includes(pane)
    pane.view.classList.toggle('terminal-split', shown.length > 1)
    pane.view.classList.toggle('terminal-split-right', shown.length > 1 && shown.indexOf(pane) === 1)
  }
  refit()
}

async function spawn(group?: number) {
  if (!isDesktop) { note.value = '浏览器预览不能开本地终端，请运行桌面端。'; return }
  if (busy.value) return
  busy.value = true
  note.value = ''
  let id = 0
  let pane: Pane | undefined
  let view: HTMLDivElement | undefined
  let instance: Terminal | undefined
  try {
    id = (await term.create(80, 24)).id
    if (disposed) { await term.kill(id); return }
    view = document.createElement('div')
    view.className = 'terminal-view'
    view.hidden = true
    stage.value!.appendChild(view)
    instance = new Terminal({ cursorBlink: true, fontFamily: "'Cascadia Code', Consolas, monospace", fontSize: 13, scrollback: 5000 })
    const fit = new FitAddon()
    instance.loadAddon(fit)
    instance.open(view)
    const created: Pane = { id, label: `终端 ${++counter}`, view, instance, fit, off: () => undefined, group: group ?? ++groups }
    pane = created
    view.addEventListener('focusin', () => { selected.value = created })
    instance.onData(data => term.write(id, data))
    instance.onResize(({ cols, rows }) => void term.resize(id, cols, rows).catch(() => undefined))
    created.off = subscribeTerm(id, bytes => created.instance.write(bytes))
    panes.value = [...panes.value, created]
    select(created)
  } catch (error) {
    if (pane) { pane.off(); panes.value = panes.value.filter(other => other !== pane) }
    instance?.dispose()
    view?.remove()
    if (selected.value === pane) selected.value = panes.value[0] ?? null
    if (id) void term.kill(id).catch(() => undefined)
    note.value = error instanceof BridgeError ? `${error.code}: ${error.message}` : '终端启动失败。'
  } finally {
    busy.value = false
  }
}

// Split: a second shell next to the selected one. A group holds at most two panes,
// which keeps the layout a plain two-column flex row.
async function split() {
  const current = selected.value
  if (!current) { await spawn(); return }
  if (panes.value.filter(pane => pane.group === current.group).length >= 2) { note.value = '每个标签最多并排两个终端。'; return }
  await spawn(current.group)
}

function select(pane: Pane) {
  selected.value = pane
  layout()
  pane.instance.focus()
}

async function close(pane: Pane) {
  const rest = panes.value.filter(other => other !== pane)
  panes.value = rest
  pane.off()
  pane.instance.dispose()
  pane.view.remove()
  if (renaming.value === pane) renaming.value = null
  if (selected.value === pane) selected.value = rest.find(other => other.group === pane.group) ?? rest[0] ?? null
  if (selected.value) select(selected.value); else layout()
  await term.kill(pane.id).catch(() => undefined)
}

function beginRename(pane: Pane) {
  renaming.value = pane
  renameText.value = pane.label
  void nextTick(() => { renameInput.value?.focus(); renameInput.value?.select() })
}
function commitRename() {
  const pane = renaming.value
  const label = renameText.value.trim()
  if (pane && label) { pane.label = label.slice(0, 40); panes.value = [...panes.value] }
  renaming.value = null
}

const isSplit = (pane: Pane) => panes.value.filter(other => other.group === pane.group).length > 1

onMounted(async () => {
  await spawn()
  if (disposed) return
  observer = new ResizeObserver(() => refit())
  if (stage.value) observer.observe(stage.value)
})
watch(() => props.active, value => { if (value) refit() })
onBeforeUnmount(() => {
  disposed = true
  observer?.disconnect()
  for (const pane of panes.value) { pane.off(); pane.instance.dispose(); void term.kill(pane.id).catch(() => undefined) }
  panes.value = []
  selected.value = null
})
</script>

<template>
  <div class="terminal-host">
    <div class="terminal-bar">
      <div class="terminal-tabs">
        <div v-for="pane in panes" :key="pane.id" class="terminal-tab" :class="{ selected: selected === pane }">
          <button class="terminal-select" :title="`${pane.label}（双击重命名）`" @click="select(pane)" @dblclick.stop="beginRename(pane)">
            <SquareTerminal :size="12" /><span>{{ pane.label }}</span><Columns2 v-if="isSplit(pane)" :size="12" />
          </button>
          <button class="icon-button" :aria-label="`关闭 ${pane.label}`" @click="close(pane)"><X :size="12" /></button>
        </div>
      </div>
      <input v-if="renaming" ref="renameInput" v-model="renameText" class="terminal-rename" aria-label="终端名称" maxlength="40" @keydown.enter.prevent="commitRename" @keydown.esc.stop.prevent="renaming = null" @blur="commitRename" />
      <button class="icon-button" title="重命名当前终端" aria-label="重命名当前终端" :disabled="!selected" @click="selected && beginRename(selected)"><Pencil :size="13" /></button>
      <button class="icon-button" title="分屏：在右侧再开一个终端" aria-label="分屏终端" :disabled="!isDesktop || busy || !selected" @click="split"><Columns2 :size="14" /></button>
      <button class="icon-button" title="新建终端" aria-label="新建终端" :disabled="!isDesktop || busy" @click="spawn()"><Plus :size="14" /></button>
    </div>
    <div ref="stage" class="terminal-stage" />
    <p v-if="note" class="terminal-note">{{ note }}</p>
  </div>
</template>

<style scoped>
.terminal-host { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--editor); }
.terminal-bar { display: flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--line); }
.terminal-tabs { flex: 1; min-width: 0; display: flex; gap: var(--space-1); overflow-x: auto; }
.terminal-tab { display: flex; align-items: center; gap: var(--space-1); flex-shrink: 0; padding: 3px var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--elevated); color: var(--secondary); font: 12px var(--font-mono); }
.terminal-tab:hover { background: var(--hover); }
.terminal-tab.selected { background: var(--selected); color: var(--text); border-color: var(--line-strong); }
.terminal-select { display: flex; align-items: center; gap: var(--space-1); padding: 0; border: 0; background: transparent; color: inherit; font: inherit; }
.terminal-tab > .icon-button { width: 18px; height: 18px; }
.terminal-tab > .icon-button:hover { color: var(--error); }
.terminal-rename { width: 9em; min-height: 18px; padding: 0 var(--space-1); color: var(--text); background: var(--editor); border: 1px solid var(--accent); border-radius: var(--radius-xs); font: 12px var(--font-mono); }
.terminal-stage { flex: 1; min-width: 0; min-height: 0; position: relative; }
.terminal-stage :deep(.terminal-view) { position: absolute; inset: 0; padding: 6px 10px; }
.terminal-stage :deep(.terminal-view.terminal-split) { right: 50%; border-right: 1px solid var(--line); }
.terminal-stage :deep(.terminal-view.terminal-split-right) { left: 50%; right: 0; border-right: 0; }
.terminal-note { margin: 0; padding: var(--space-2) var(--space-4); color: var(--muted); font-size: 12px; }
</style>
