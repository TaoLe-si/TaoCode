<script setup lang="ts">
import type { ProjectTreeSortSettings } from '../projectTreeSort'
defineProps<{ settings: Readonly<ProjectTreeSortSettings>; persistenceError?: string }>()
const emit = defineEmits<{ update: [patch: Partial<ProjectTreeSortSettings>] }>()
</script>

<template>
  <!-- ProjectView.ToolWindow.Sort.Actions: name, type, [unsupported time],
       separator, folders always on top. No placeholder unsupported actions. -->
  <div role="group" aria-label="排序">
    <div class="menu-section-label" role="presentation">排序</div>
    <button class="menu-item" role="menuitemradio" :aria-checked="settings.sortKey === 'BY_NAME'" @click="emit('update', { sortKey: 'BY_NAME' })"><span class="menu-item-icon">{{ settings.sortKey === 'BY_NAME' ? '✓' : '' }}</span><span class="menu-item-title">按名称</span></button>
    <button class="menu-item" role="menuitemradio" :aria-checked="settings.sortKey === 'BY_TYPE'" @click="emit('update', { sortKey: 'BY_TYPE' })"><span class="menu-item-icon">{{ settings.sortKey === 'BY_TYPE' ? '✓' : '' }}</span><span class="menu-item-title">按类型</span></button>
    <div class="menu-rule" role="separator" />
    <button class="menu-item" role="menuitemcheckbox" :aria-checked="settings.foldersAlwaysOnTop" @click="emit('update', { foldersAlwaysOnTop: !settings.foldersAlwaysOnTop })"><span class="menu-item-icon">{{ settings.foldersAlwaysOnTop ? '✓' : '' }}</span><span class="menu-item-title">目录始终在前</span></button>
  </div>
  <p v-if="persistenceError" class="persistence-warning" role="status">{{ persistenceError }}</p>
</template>

<style scoped>
.persistence-warning { max-width: 250px; padding: 4px 12px; color: var(--muted); font-size: 11px; }
</style>
