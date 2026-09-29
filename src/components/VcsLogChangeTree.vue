<script setup lang="ts">
import { File, Folder } from 'lucide-vue-next'
import type { VcsLogChangeNode } from '../vcsLogChanges'
defineProps<{ nodes: VcsLogChangeNode[]; selected?: string }>()
const emit = defineEmits<{ select: [path: string] }>()
</script>
<template>
  <ul class="nodes">
    <li v-for="node in nodes" :key="node.path">
      <details v-if="!node.change" open>
        <summary><Folder :size="13" />{{ node.name }}</summary>
        <VcsLogChangeTree :nodes="node.children" :selected="selected" @select="emit('select', $event)" />
      </details>
      <button v-else class="file" :class="{ selected: selected === node.path }" :aria-pressed="selected === node.path" :title="node.change.previousPath ? `${node.change.previousPath} → ${node.path}` : node.path" @click="emit('select', node.path)">
        <File :size="13" /><span class="name">{{ node.name }}</span><span class="status">{{ node.change.status }}</span>
      </button>
    </li>
  </ul>
</template>
<style scoped>
.nodes { list-style: none; margin: 0; padding: 0 0 0 14px; font-size: 11px; }
summary { cursor: default; line-height: 24px; white-space: nowrap; }
summary svg { vertical-align: middle; margin-right: 5px; color: var(--muted); }
.file { display: flex; width: 100%; background: transparent; color: var(--text); border: 0; padding: 0; font: inherit; text-align: left; gap: 5px; align-items: center; min-height: 24px; white-space: nowrap; }
.file.selected { background: var(--selection); }
.name { overflow: hidden; text-overflow: ellipsis; }
.status { color: var(--muted); margin-left: auto; padding-right: 8px; }
</style>
