<script setup lang="ts">
import { reactive } from 'vue'
import { ChevronRight, Folder, FileCode2, FileText, Package, NotebookPen } from 'lucide-vue-next'
import { request, type Entry } from '../bridge'

// Synthetic nodes (ProjectFileNodeImpl: "External Libraries", "Scratches and
// Consoles") carry a fixed pseudo-path so they expand like real directories.
export interface SyntheticNode { path: string; label: string; icon: 'libraries' | 'scratches'; entries: Entry[] }
const props = defineProps<{ entries: Entry[]; active?: string; depth?: number; synthetic?: SyntheticNode[] }>()
const emit = defineEmits<{ open: [path: string]; error: [message: string]; context: [payload: { entry: Entry; x: number; y: number }] }>()
const expanded = reactive(new Set<string>())
const loading = reactive(new Set<string>())
const children = reactive(new Map<string, Entry[]>())
async function activate(entry: Entry) {
  if (entry.kind === 'file') { emit('open', entry.path); return }
  if (loading.has(entry.path)) return
  if (expanded.has(entry.path)) { expanded.delete(entry.path); return }
  try {
    loading.add(entry.path)
    children.set(entry.path, await request<Entry[]>('workspace.list', { path: entry.path }))
    expanded.add(entry.path)
  } catch (error) { emit('error', error instanceof Error ? error.message : String(error)) }
  finally { loading.delete(entry.path) }
}
function toggleSynthetic(node: SyntheticNode) {
  if (expanded.has(node.path)) expanded.delete(node.path)
  else expanded.add(node.path)
}
function showMenu(entry: Entry, event: MouseEvent) {
  event.preventDefault()
  emit('context', { entry, x: event.clientX, y: event.clientY })
}
function collapseAll() {
  expanded.clear()
}
async function expandAll() {
  const dirs: string[] = []
  function collect(entries: Entry[]) {
    for (const e of entries) {
      if (e.kind === 'directory') { dirs.push(e.path); collect(children.get(e.path) ?? []) }
    }
  }
  collect(props.entries)
  for (const dir of dirs) {
    if (expanded.has(dir) || loading.has(dir)) continue
    try {
      loading.add(dir)
      children.set(dir, await request<Entry[]>('workspace.list', { path: dir }))
      expanded.add(dir)
    } catch { /* skip unreadable dirs */ }
    finally { loading.delete(dir) }
  }
  for (const node of props.synthetic ?? []) expanded.add(node.path)
}
function reveal(path: string): boolean {
  const parts = path.split('/')
  for (let i = 1; i < parts.length; i++) {
    const dir = parts.slice(0, i).join('/')
    if (dir && !expanded.has(dir)) {
      expanded.add(dir)
      if (!children.has(dir)) {
        request<Entry[]>('workspace.list', { path: dir }).then(
          entries => { children.set(dir, entries) },
          () => { expanded.delete(dir) },
        )
      }
    }
  }
  return true
}
defineExpose({ collapseAll, expandAll, reveal })
</script>

<template>
  <!-- The root frame renders the module node plus the synthetic nodes below it; nested
       instances are plain recursive directory lists. -->
  <div v-if="!depth" class="project-view">
    <ul class="tree-list">
      <li v-for="entry in entries" :key="entry.path">
        <button class="tree-entry" :class="{ selected: active === entry.path }" :style="{ paddingLeft: `${12}px` }" :title="entry.path" :aria-expanded="entry.kind === 'directory' ? expanded.has(entry.path) : undefined" :aria-current="active === entry.path ? 'page' : undefined" :disabled="loading.has(entry.path)" @click="activate(entry)" @contextmenu="showMenu(entry, $event)">
          <ChevronRight v-if="entry.kind === 'directory'" :size="12" class="tree-chevron" :class="{ expanded: expanded.has(entry.path) }" />
          <span v-else class="tree-spacer" />
          <Folder v-if="entry.kind === 'directory'" :size="15" class="folder-icon" />
          <FileCode2 v-else-if="/\.(java|kt|cpp|hpp|c|h|ts|js|vue)$/.test(entry.name)" :size="15" class="code-icon" />
          <FileText v-else :size="15" class="muted" />
          <span class="tree-name">{{ entry.name }}</span><span v-if="loading.has(entry.path)">…</span>
        </button>
        <FileTree v-if="expanded.has(entry.path)" :entries="children.get(entry.path) ?? []" :active="active" :depth="(depth ?? 0) + 1" @open="emit('open', $event)" @error="emit('error', $event)" @context="emit('context', $event)" />
        <div v-if="expanded.has(entry.path) && children.get(entry.path)?.length === 0" class="empty-folder" :style="{ paddingLeft: `40px` }">空目录</div>
      </li>
      <li v-for="node in synthetic" :key="node.path">
        <button class="tree-entry tree-synthetic" :style="{ paddingLeft: `12px` }" :aria-expanded="expanded.has(node.path)" :title="node.label" @click="toggleSynthetic(node)">
          <ChevronRight :size="12" class="tree-chevron" :class="{ expanded: expanded.has(node.path) }" />
          <Package v-if="node.icon === 'libraries'" :size="15" class="synthetic-icon" />
          <NotebookPen v-else :size="15" class="synthetic-icon" />
          <span class="tree-name">{{ node.label }}</span>
        </button>
        <FileTree v-if="expanded.has(node.path)" :entries="node.entries" :active="active" :depth="1" @open="emit('open', $event)" @error="emit('error', $event)" @context="emit('context', $event)" />
        <div v-if="expanded.has(node.path) && !node.entries.length" class="empty-folder" :style="{ paddingLeft: `40px` }">（空）</div>
      </li>
    </ul>
  </div>
  <ul v-else class="tree-list">
    <li v-for="entry in entries" :key="entry.path">
      <button class="tree-entry" :class="{ selected: active === entry.path }" :style="{ paddingLeft: `${12 + (depth ?? 0) * 15}px` }" :title="entry.path" :aria-expanded="entry.kind === 'directory' ? expanded.has(entry.path) : undefined" :aria-current="active === entry.path ? 'page' : undefined" :disabled="loading.has(entry.path)" @click="activate(entry)" @contextmenu="showMenu(entry, $event)">
        <ChevronRight v-if="entry.kind === 'directory'" :size="12" class="tree-chevron" :class="{ expanded: expanded.has(entry.path) }" />
        <span v-else class="tree-spacer" />
        <Folder v-if="entry.kind === 'directory'" :size="15" class="folder-icon" />
        <FileCode2 v-else-if="/\.(java|kt|cpp|hpp|c|h|ts|js|vue)$/.test(entry.name)" :size="15" class="code-icon" />
        <FileText v-else :size="15" class="muted" />
        <span class="tree-name">{{ entry.name }}</span><span v-if="loading.has(entry.path)">…</span>
      </button>
      <FileTree v-if="expanded.has(entry.path)" :entries="children.get(entry.path) ?? []" :active="active" :depth="(depth ?? 0) + 1" @open="emit('open', $event)" @error="emit('error', $event)" @context="emit('context', $event)" />
      <div v-if="expanded.has(entry.path) && children.get(entry.path)?.length === 0" class="empty-folder" :style="{ paddingLeft: `${40 + (depth ?? 0) * 15}px` }">空目录</div>
    </li>
  </ul>
</template>

<style scoped>
.tree-synthetic { color: var(--secondary); font-style: italic; }
.synthetic-icon { color: var(--syntax-meta); flex-shrink: 0; }
</style>
