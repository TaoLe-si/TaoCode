<script setup lang="ts">
// 「浏览特殊目录」对话框 —— IDEA `BrowseSpecialPathsAction` + `BrowseSpecialPathsDialog` 的对应物：
// 列出日志 / 配置 / 插件 / 历史 / 程序目录 / 桌面等，选中一项即在文件管理器中打开。
// 清单由宿主给出（native/diagnostics.cpp 的 `special_paths`），不存在的目录标注出来（不隐藏，IDEA 同样列出）。
import { ChevronRight, FolderOpen, X } from 'lucide-vue-next'
import type { SpecialPath } from '../helpActions'

defineProps<{ paths: readonly SpecialPath[] }>()
const emit = defineEmits<{
  (event: 'pick', payload: { path: string }): void
  (event: 'close'): void
}>()
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="command-palette special-paths-dialog" role="dialog" aria-modal="true" aria-label="浏览特殊目录">
      <div class="palette-input">
        <span class="special-heading">浏览特殊目录</span>
        <button class="icon-button" aria-label="关闭" @click="emit('close')"><X :size="16" /></button>
      </div>
      <div class="palette-results">
        <button v-for="entry in paths" :key="entry.id" @click="emit('pick', { path: entry.path })">
          <FolderOpen :size="15" :class="{ missing: !entry.exists }" />
          <span class="special-main"><strong>{{ entry.label }}</strong><span class="special-path">{{ entry.path }}</span></span>
          <span v-if="!entry.exists" class="special-flag">不存在</span>
          <ChevronRight :size="14" />
        </button>
        <p v-if="!paths.length" class="palette-empty">没有可显示的目录。</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.special-paths-dialog { width: 620px; }
.special-heading { flex: 1; color: var(--bright); font-weight: 500; }
.special-main { display: flex; flex-direction: column; align-items: flex-start; flex: 1; min-width: 0; }
.special-path { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.special-flag { color: var(--warning); font-size: 12px; }
.missing { color: var(--muted); }
</style>
