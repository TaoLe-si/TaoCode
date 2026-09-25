<script setup lang="ts">
import { Bookmark, X } from 'lucide-vue-next'
import type { Bookmark as BookmarkEntry } from '../bridge'

const props = defineProps<{ entries: BookmarkEntry[]; activePath: string }>()
const emit = defineEmits<{ jump: [entry: BookmarkEntry]; remove: [entry: BookmarkEntry]; assign: [] }>()

const folderOf = (path: string) => path.slice(0, path.length - (path.split('/').pop()?.length ?? 0))
</script>

<template>
  <div class="bookmark-panel">
    <div class="panel-heading">
      <span><Bookmark :size="14" />书签</span>
      <span class="heading-count">{{ entries.length }}</span>
    </div>
    <div v-if="!entries.length" class="bookmark-empty">
      <Bookmark :size="24" />
      <p>还没有书签</p>
      <span>F11 标记当前行；Ctrl+F11 贴 0-9 编号，之后在任意位置按 Ctrl+编号 跳回。</span>
      <button class="subtle-button" @click="emit('assign')">为当前行编号</button>
    </div>
    <div v-else class="bookmark-scroll" role="list" aria-label="项目书签">
      <div v-for="entry in entries" :key="`${entry.path}:${entry.line}`" class="bookmark-row" role="listitem">
        <button class="bookmark-jump" :class="{ 'bookmark-current': entry.path === activePath }"
                :title="`${entry.path}:${entry.line}`" @click="emit('jump', entry)">
          <span class="bookmark-digit" :title="entry.mnemonic === undefined ? '无编号' : `Ctrl+${entry.mnemonic} 跳转`">{{ entry.mnemonic ?? '' }}</span>
          <span class="bookmark-name">{{ entry.path.split('/').pop() }}</span>
          <span class="bookmark-folder">{{ folderOf(entry.path) }}</span>
          <span class="bookmark-line">{{ entry.line }}</span>
        </button>
        <button class="icon-button" title="移除书签" aria-label="移除书签" @click="emit('remove', entry)"><X :size="13" /></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bookmark-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.heading-count { margin-left: auto; color: var(--muted); font-size: 10px; }
.bookmark-scroll { flex: 1; min-height: 0; overflow: auto; padding-bottom: var(--space-2); }
.bookmark-row { display: flex; align-items: center; gap: 2px; padding: 0 var(--space-1) 0 0; }
.bookmark-row:hover { background: var(--hover); }
.bookmark-jump { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: var(--space-2); width: 100%; padding: 3px 0 3px var(--space-3); border: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; font-size: 12px; }
.bookmark-digit { flex-shrink: 0; width: 11px; color: var(--accent); font: 10px var(--font-mono); }
.bookmark-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bookmark-folder { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 10px; }
.bookmark-line { flex-shrink: 0; color: var(--muted); font: 10px var(--font-mono); font-variant-numeric: tabular-nums; }
.bookmark-current .bookmark-name { color: var(--bright); }
.bookmark-empty { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); padding: var(--space-5) var(--space-3); color: var(--muted); font-size: 11px; line-height: 1.7; }
.bookmark-empty p { margin: 0; color: var(--secondary); font-size: 12px; }
.bookmark-empty span { max-width: 26em; }
</style>
