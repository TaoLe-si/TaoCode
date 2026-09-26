<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Columns2, Pencil, Plus, RotateCw, Search, SquareTerminal, X } from 'lucide-vue-next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { BridgeError, isDesktop, subscribeTerm, subscribeTermExit, term } from '../bridge'

const props = defineProps<{ active: boolean; cwd?: string }>()
const emit = defineEmits<{ focusTerminal: [] }>()

interface Pane {
  id: number
  label: string
  view: HTMLDivElement
  instance: Terminal
  fit: FitAddon
  search: SearchAddon
  off: () => void
  offExit: () => void
  group: number
  exited: boolean
  exitCode: number | null
}

const stage = ref<HTMLDivElement>()
const panes = shallowRef<Pane[]>([])
const selected = shallowRef<Pane | null>(null)
const busy = ref(false)
const note = ref('')
const renaming = shallowRef<Pane | null>(null)
const renameText = ref('')
const renameInput = ref<HTMLInputElement>()
const searchOpen = ref(false)
const searchText = ref('')
const searchInput = ref<HTMLInputElement>()
const searchMiss = ref(false)
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

async function spawn(group?: number, cwdOverride?: string) {
  if (!isDesktop) { note.value = '浏览器预览不能开本地终端，请运行桌面端。'; return }
  if (busy.value) return
  busy.value = true
  note.value = ''
  // IDE-03's "Open Terminal Here": cwd falls back to the prop, then the bridge
  // default (workspace root). Pass nothing when neither applies so the native
  // session spawns at its own default.
  const requested = cwdOverride ?? props.cwd
  let id = 0
  let pane: Pane | undefined
  try {
    id = (await term.create(80, 24, requested)).id
    if (disposed) { await term.kill(id); return }
    counter = Math.max(counter, id)
    pane = attachPane(id, `终端 ${++counter}`)
  } catch (error) {
    if (pane) { pane.off(); pane.offExit(); pane.view.remove(); pane.instance.dispose(); panes.value = panes.value.filter(other => other !== pane) }
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

// Exposed so the menu's "Open Terminal Here" can spawn a panel in a chosen
// directory. The caller (App.vue) handles switching to the terminal tab first;
// the function spawns the panel and the panel stays subscribed to its output.
async function openIn(dir: string) {
  emit('focusTerminal')
  await spawn(undefined, dir)
}
// A terminal created by someone else (the debug adapter's runInTerminal) must become
// visible in this panel: adopt() attaches a pane to an id that already exists, so the
// session the debugger opened is the same one the user sees.
function attachPane(id: number, label: string): Pane {
  const view = document.createElement('div')
  view.className = 'terminal-view'
  view.hidden = true
  stage.value!.appendChild(view)
  const instance = new Terminal({ cursorBlink: true, fontFamily: "'Cascadia Code', Consolas, monospace", fontSize: 13, scrollback: 5000 })
  const fit = new FitAddon()
  const search = new SearchAddon()
  instance.loadAddon(fit)
  instance.loadAddon(search)
  instance.open(view)
  const created: Pane = { id, label, view, instance, fit, search,
    off: () => undefined, offExit: () => undefined, group: ++groups, exited: false, exitCode: null }
  view.addEventListener('focusin', () => { selected.value = created })
  instance.onData(data => { if (!created.exited) term.write(id, data) })
  instance.onResize(({ cols, rows }) => void term.resize(id, cols, rows).catch(() => undefined))
  created.off = subscribeTerm(id, bytes => created.instance.write(bytes))
  // A shell that exits on its own used to hold its slot forever; the panel now marks
  // the pane, keeps it for restart, and says why it stopped.
  created.offExit = subscribeTermExit(id, code => {
    created.exited = true
    created.exitCode = code
    panes.value = [...panes.value]
    created.instance.writeln(`\r\n[进程已退出，代码 ${code}。按 ↻ 重启该终端。]`)
  })
  panes.value = [...panes.value, created]
  select(created)
  layout()
  return created
}
// `term.opened` carries the id the host already spawned.
function adopt(id: number, label?: string) {
  if (!isDesktop || !stage.value) return
  if (panes.value.some(pane => pane.id === id)) { select(panes.value.find(pane => pane.id === id)!); return }
  counter = Math.max(counter, id)
  attachPane(id, label?.trim() || `终端 ${id}`)
  emit('focusTerminal')
}
defineExpose({ openIn, adopt })

async function close(pane: Pane) {
  const rest = panes.value.filter(other => other !== pane)
  panes.value = rest
  pane.off()
  pane.offExit()
  pane.instance.dispose()
  pane.view.remove()
  if (renaming.value === pane) renaming.value = null
  if (selected.value === pane) selected.value = rest.find(other => other.group === pane.group) ?? rest[0] ?? null
  if (selected.value) select(selected.value); else layout()
  await term.kill(pane.id).catch(() => undefined)
}

// Restart keeps the label, group and scroll position in place; only the shell is new.
async function restart(pane: Pane) {
  if (busy.value || !isDesktop) return
  const { group, label } = pane
  const wasSelected = selected.value === pane
  await close(pane)
  const before = panes.value.length
  await spawn(group)
  const created = panes.value[panes.value.length - 1]
  if (created && panes.value.length !== before) { created.label = label; panes.value = [...panes.value] }
  if (wasSelected && created) select(created)
}

// Reap: drop the local panes whose native session is gone. `term.list` is the
// host's own truth, so this also clears panes that died while the panel was hidden.
async function reapExited() {
  if (!isDesktop) return
  try {
    const { terminals } = await term.list()
    const running = new Set(terminals.filter(item => item.running).map(item => item.id))
    const dead = panes.value.filter(pane => !running.has(pane.id))
    for (const pane of dead) await close(pane)
    note.value = dead.length ? `已回收 ${dead.length} 个已退出的终端。` : '没有需要回收的终端。'
  } catch (error) { note.value = error instanceof BridgeError ? `${error.code}: ${error.message}` : '无法读取终端列表。' }
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

function toggleSearch() {
  searchOpen.value = !searchOpen.value
  if (!searchOpen.value) { searchMiss.value = false; selected.value?.instance.focus(); return }
  void nextTick(() => searchInput.value?.focus())
}
function runSearch(forward: boolean) {
  const pane = selected.value
  const query = searchText.value
  if (!pane || !query) return
  const found = forward ? pane.search.findNext(query) : pane.search.findPrevious(query)
  searchMiss.value = !found
}
function clearSearch() {
  searchText.value = ''
  searchMiss.value = false
  selected.value?.instance.clearSelection()
  selected.value?.instance.focus()
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
  for (const pane of panes.value) { pane.off(); pane.offExit(); pane.instance.dispose(); void term.kill(pane.id).catch(() => undefined) }
  panes.value = []
  selected.value = null
})
</script>

<template>
  <div class="terminal-host">
    <div class="terminal-bar">
      <div class="terminal-tabs">
        <div v-for="pane in panes" :key="pane.id" class="terminal-tab" :class="{ selected: selected === pane, exited: pane.exited }">
          <button class="terminal-select" :title="`${pane.label}（双击重命名）`" @click="select(pane)" @dblclick.stop="beginRename(pane)">
            <SquareTerminal :size="12" /><span>{{ pane.label }}</span><Columns2 v-if="isSplit(pane)" :size="12" /><span v-if="pane.exited" class="terminal-exit">exit {{ pane.exitCode }}</span>
          </button>
          <button v-if="pane.exited" class="icon-button" title="重启该终端" :aria-label="`重启 ${pane.label}`" @click="restart(pane)"><RotateCw :size="12" /></button>
          <button class="icon-button" :aria-label="`关闭 ${pane.label}`" @click="close(pane)"><X :size="12" /></button>
        </div>
      </div>
      <input v-if="renaming" ref="renameInput" v-model="renameText" class="terminal-rename" aria-label="终端名称" maxlength="40" @keydown.enter.prevent="commitRename" @keydown.esc.stop.prevent="renaming = null" @blur="commitRename" />
      <button class="icon-button" title="重命名当前终端" aria-label="重命名当前终端" :disabled="!selected" @click="selected && beginRename(selected)"><Pencil :size="13" /></button>
      <button class="icon-button" :class="{ active: searchOpen }" title="在终端中查找" aria-label="在终端中查找" :disabled="!selected" @click="toggleSearch"><Search :size="14" /></button>
      <button class="icon-button" title="回收已退出的终端" aria-label="回收已退出的终端" :disabled="!isDesktop || !panes.length" @click="reapExited"><RotateCw :size="13" /></button>
      <button class="icon-button" title="分屏：在右侧再开一个终端" aria-label="分屏终端" :disabled="!isDesktop || busy || !selected" @click="split"><Columns2 :size="14" /></button>
      <button class="icon-button" title="新建终端" aria-label="新建终端" :disabled="!isDesktop || busy" @click="spawn()"><Plus :size="14" /></button>
    </div>
    <div v-if="searchOpen" class="terminal-search">
      <input ref="searchInput" v-model="searchText" class="terminal-search-input" aria-label="终端查找内容" placeholder="在终端缓冲区中查找" @keydown.enter.prevent="runSearch(true)" @keydown.esc.stop.prevent="toggleSearch" />
      <button class="subtle-button" :disabled="!searchText" @click="runSearch(false)">上一个</button>
      <button class="subtle-button" :disabled="!searchText" @click="runSearch(true)">下一个</button>
      <button class="subtle-button" @click="clearSearch">清除</button>
      <span v-if="searchMiss" class="terminal-search-miss">没有更多匹配。</span>
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
.terminal-tab.exited { opacity: 0.75; }
.terminal-exit { color: var(--muted); font-size: 10px; }
.terminal-select { display: flex; align-items: center; gap: var(--space-1); padding: 0; border: 0; background: transparent; color: inherit; font: inherit; }
.terminal-tab > .icon-button { width: 18px; height: 18px; }
.terminal-tab > .icon-button:hover { color: var(--error); }
.terminal-rename { width: 9em; min-height: 18px; padding: 0 var(--space-1); color: var(--text); background: var(--editor); border: 1px solid var(--accent); border-radius: var(--radius-xs); font: 12px var(--font-mono); }
.terminal-search { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--line); background: var(--rail); }
.terminal-search-input { flex: 1; min-width: 0; min-height: var(--ctrl-height-sm); padding: 2px var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 12px var(--font-mono); }
.terminal-search-input:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.terminal-search-miss { color: var(--muted); font-size: 11px; }
.terminal-bar > .icon-button.active { color: var(--accent); }
.terminal-stage { flex: 1; min-width: 0; min-height: 0; position: relative; }
.terminal-stage :deep(.terminal-view) { position: absolute; inset: 0; padding: 6px 10px; }
.terminal-stage :deep(.terminal-view.terminal-split) { right: 50%; border-right: 1px solid var(--line); }
.terminal-stage :deep(.terminal-view.terminal-split-right) { left: 50%; right: 0; border-right: 0; }
.terminal-note { margin: 0; padding: var(--space-2) var(--space-4); color: var(--muted); font-size: 12px; }
</style>
