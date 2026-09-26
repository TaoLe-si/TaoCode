<script setup lang="ts">
import { reactive, watch } from 'vue'
import { ChevronRight, Folder, FileCode2, FileText, Package, NotebookPen } from 'lucide-vue-next'
import { request, type Entry } from '../bridge'

// Synthetic nodes (ProjectFileNodeImpl: "External Libraries", "Scratches and
// Consoles") carry a fixed pseudo-path so they expand like real directories.
export interface SyntheticNode { path: string; label: string; icon: 'libraries' | 'scratches'; entries: Entry[] }
const props = defineProps<{ entries: Entry[]; active?: string; depth?: number; synthetic?: SyntheticNode[]; indentGuides?: boolean; compactIndents?: boolean }>()
// IDEA's "Use smaller indents" (compactTreeIndents) shrinks the per-level step;
// the base keeps room for the chevron either way.
const step = () => (props.compactIndents ? 11 : 15)
const base = () => (props.compactIndents ? 10 : 12)
const indentStyle = (level: number) => ({ paddingLeft: `${base() + level * step()}px` })
const guideStyle = () => ({
  backgroundImage: `repeating-linear-gradient(90deg, var(--line) 0 1px, transparent 1px ${step()}px)`,
  backgroundPositionX: `${base() + step()}px`,
})
const emit = defineEmits<{ open: [path: string]; error: [message: string]; context: [payload: { entry: Entry; x: number; y: number }] }>()
const expanded = reactive(new Set<string>())
const loading = reactive(new Set<string>())
const children = reactive(new Map<string, Entry[]>())
// `entries` is replaced whenever another project becomes active or the tree is
// refreshed; every request started before that belongs to the previous listing and
// must not write its answer into the cache of the new one.
let epoch = 0
watch(() => props.entries, () => { epoch++ })
const stale = (token: number) => token !== epoch
async function loadChildren(path: string, token: number): Promise<Entry[]> {
  const entries = await request<Entry[]>('workspace.list', { path })
  // A result whose listing is gone (project switched mid-request) is dropped.
  if (stale(token)) return []
  children.set(path, entries)
  return entries
}
async function activate(entry: Entry) {
  // Synthetic library leaves (path starts with "\u0000lib:") never exist on disk;
  // the row is a glob string and clicking it must not try to open a workspace
  // file. The owning App layer renders the actual glob path in the row tooltip.
  if (entry.path.startsWith('\u0000')) return
  if (entry.kind === 'file') { emit('open', entry.path); return }
  if (loading.has(entry.path)) return
  if (expanded.has(entry.path)) { expanded.delete(entry.path); return }
  try {
    loading.add(entry.path)
    await loadChildren(entry.path, epoch)
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
  const token = epoch
  const unreadable: string[] = []
  for (const dir of dirs) {
    if (expanded.has(dir) || loading.has(dir)) continue
    try {
      loading.add(dir)
      await loadChildren(dir, token)
      expanded.add(dir)
    } catch (error) {
      // Report what could not be read instead of leaving the rows silently missing.
      unreadable.push(dir.split('/').pop() || dir)
    } finally { loading.delete(dir) }
  }
  if (stale(token)) return
  if (unreadable.length) emit('error', `${unreadable.length} 个目录无法读取：${unreadable.slice(0, 5).join('、')}${unreadable.length > 5 ? ' …' : ''}`)
  for (const node of props.synthetic ?? []) expanded.add(node.path)
}
// Expands the parent directories of `path` and returns whether every one of them is
// already known, so the caller knows the row can be selected right away.
function reveal(path: string): boolean {
  const parts = path.split('/')
  let ready = true
  for (let i = 1; i < parts.length; i++) {
    const dir = parts.slice(0, i).join('/')
    if (dir && !expanded.has(dir)) {
      expanded.add(dir)
      if (!children.has(dir)) {
        ready = false
        const token = epoch
        request<Entry[]>('workspace.list', { path: dir }).then(
          entries => { if (!stale(token)) children.set(dir, entries) },
          () => { expanded.delete(dir) },
        )
      }
    }
  }
  return ready
}
defineExpose({ collapseAll, expandAll, reveal })
</script>

<template>
  <!-- The root frame renders the module node plus the synthetic nodes below it; nested
       instances are plain recursive directory lists. -->
  <div v-if="!depth" class="project-view">
    <p v-if="!entries.length && !synthetic?.length" class="tree-empty">此项目没有可见文件；排除的目录在“设置 → 项目结构”里调整。</p>
    <ul class="tree-list" role="tree" aria-label="项目文件">
      <li v-for="entry in entries" :key="entry.path" role="none">
        <button
          class="tree-entry" role="treeitem" aria-level="1" :class="{ selected: active === entry.path, 'indent-guides': indentGuides }" :style="[indentStyle(0), indentGuides ? guideStyle() : undefined]" :title="entry.path" :aria-expanded="entry.kind === 'directory' ? expanded.has(entry.path) : undefined" :aria-current="active === entry.path ? 'page' : undefined" :disabled="loading.has(entry.path)" @click="activate(entry)" @contextmenu="showMenu(entry, $event)"
        >
          <ChevronRight v-if="entry.kind === 'directory'" :size="12" class="tree-chevron" :class="{ expanded: expanded.has(entry.path) }" />
          <span v-else class="tree-spacer" />
          <Folder v-if="entry.kind === 'directory'" :size="15" class="folder-icon" />
          <FileCode2 v-else-if="/\.(java|kt|cpp|hpp|c|h|ts|js|vue)$/.test(entry.name)" :size="15" class="code-icon" />
          <FileText v-else :size="15" class="muted" />
          <span class="tree-name">{{ entry.name }}</span><span v-if="loading.has(entry.path)">…</span>
        </button>
        <FileTree v-if="expanded.has(entry.path)" :entries="children.get(entry.path) ?? []" :active="active" :depth="(depth ?? 0) + 1" :indent-guides="indentGuides" :compact-indents="compactIndents" @open="emit('open', $event)" @error="emit('error', $event)" @context="emit('context', $event)" />
        <div v-if="expanded.has(entry.path) && children.get(entry.path)?.length === 0" class="empty-folder" :style="indentStyle(2)">空目录</div>
      </li>
      <li v-for="node in synthetic" :key="node.path" role="none">
        <button class="tree-entry tree-synthetic" role="treeitem" aria-level="1" :style="indentStyle(0)" :aria-expanded="expanded.has(node.path)" :title="node.label" @click="toggleSynthetic(node)">
          <ChevronRight :size="12" class="tree-chevron" :class="{ expanded: expanded.has(node.path) }" />
          <Package v-if="node.icon === 'libraries'" :size="15" class="synthetic-icon" />
          <NotebookPen v-else :size="15" class="synthetic-icon" />
          <span class="tree-name">{{ node.label }}</span>
        </button>
        <FileTree v-if="expanded.has(node.path)" :entries="node.entries" :active="active" :depth="1" :indent-guides="indentGuides" :compact-indents="compactIndents" @open="emit('open', $event)" @error="emit('error', $event)" @context="emit('context', $event)" />
        <div v-if="expanded.has(node.path) && !node.entries.length" class="empty-folder" :style="indentStyle(2)">（空）</div>
      </li>
    </ul>
  </div>
  <ul v-else class="tree-list" role="group">
    <li v-for="entry in entries" :key="entry.path" role="none">
      <button
        class="tree-entry" role="treeitem" :aria-level="(depth ?? 0) + 1" :class="{ selected: active === entry.path, 'indent-guides': indentGuides }" :style="[indentStyle(depth ?? 0), indentGuides ? guideStyle() : undefined]" :title="entry.path" :aria-expanded="entry.kind === 'directory' ? expanded.has(entry.path) : undefined" :aria-current="active === entry.path ? 'page' : undefined" :disabled="loading.has(entry.path)" @click="activate(entry)" @contextmenu="showMenu(entry, $event)"
      >
        <ChevronRight v-if="entry.kind === 'directory'" :size="12" class="tree-chevron" :class="{ expanded: expanded.has(entry.path) }" />
        <span v-else class="tree-spacer" />
        <Folder v-if="entry.kind === 'directory'" :size="15" class="folder-icon" />
        <FileCode2 v-else-if="/\.(java|kt|cpp|hpp|c|h|ts|js|vue)$/.test(entry.name)" :size="15" class="code-icon" />
        <FileText v-else :size="15" class="muted" />
        <span class="tree-name">{{ entry.name }}</span><span v-if="loading.has(entry.path)">…</span>
      </button>
      <FileTree v-if="expanded.has(entry.path)" :entries="children.get(entry.path) ?? []" :active="active" :depth="(depth ?? 0) + 1" :indent-guides="indentGuides" :compact-indents="compactIndents" @open="emit('open', $event)" @error="emit('error', $event)" @context="emit('context', $event)" />
      <div v-if="expanded.has(entry.path) && children.get(entry.path)?.length === 0" class="empty-folder" :style="indentStyle((depth ?? 0) + 2)">空目录</div>
    </li>
  </ul>
</template>

<style scoped>
.tree-synthetic { color: var(--secondary); font-style: italic; }
.synthetic-icon { color: var(--syntax-meta); flex-shrink: 0; }
.tree-empty { margin: 0; padding: var(--space-3); color: var(--muted); font-size: 11px; line-height: 1.7; }
</style>
