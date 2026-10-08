<script setup lang="ts">
// 「浏览特殊目录」对话框 —— IDEA `BrowseSpecialPathsAction` + `BrowseSpecialPathsDialog` 的对应物：
// 列出日志 / 配置 / 插件 / 历史 / 程序目录 / 桌面等，选中一项即在文件管理器中打开。
// 清单由宿主给出（native/diagnostics.cpp 的 `special_paths`），不存在的目录标注出来（不隐藏，IDEA 同样列出）。
//
// 尺寸：上游这是 `DialogWrapper` 系对话框 —— 可拖角改大小（`DialogWrapperPeerImpl.java:442-443`），
// 关掉时把尺寸写进 DimensionService、下次打开读回来（同一个 peer：`:946-958` 读、`:1161-1172` 存）。
// 本仓的等价物是 `src/dialogGeometry.ts`（键 + 视口夹取 + 坏数据不还原）
// 加 CSS `resize`；长路径（`\\server\share\…`）与条目多的时候，用户拖大就能看全。
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ChevronRight, FolderOpen, X } from 'lucide-vue-next'
import type { SpecialPath } from '../helpActions'
import { clampDialogSize, dialogGeometryKey, loadDialogSize, saveDialogSize, sizeFromRect } from '../dialogGeometry.ts'
import { iconSize } from '../uiIcons'

const GEOMETRY_KEY = dialogGeometryKey('special-paths-dialog')
const sizeStorage = () => (typeof localStorage === 'undefined' ? null : localStorage)

defineProps<{ paths: readonly SpecialPath[] }>()
const emit = defineEmits<{
  (event: 'pick', payload: { path: string }): void
  (event: 'close'): void
}>()
const panel = ref<HTMLElement>()
const dialogSize = ref<{ width: number; height: number } | null>(null)
onMounted(() => {
  const saved = loadDialogSize(sizeStorage(), GEOMETRY_KEY)
  if (saved) dialogSize.value = clampDialogSize(saved, { width: window.innerWidth, height: window.innerHeight })
})
onBeforeUnmount(() => {
  const rect = panel.value?.getBoundingClientRect()
  const size = rect ? sizeFromRect(rect) : null
  if (size) saveDialogSize(sizeStorage(), GEOMETRY_KEY, size)
})
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section ref="panel" class="command-palette special-paths-dialog" role="dialog" aria-modal="true" aria-label="浏览特殊目录"
             :style="dialogSize ? { width: `${dialogSize.width}px`, height: `${dialogSize.height}px` } : undefined">
      <div class="palette-input">
        <span class="special-heading">浏览特殊目录</span>
        <button class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="iconSize.action" /></button>
      </div>
      <div class="palette-results">
        <button v-for="entry in paths" :key="entry.id" @click="emit('pick', { path: entry.path })">
          <FolderOpen aria-hidden="true" :size="iconSize.toolbar" :class="{ missing: !entry.exists }" />
          <span class="special-main"><strong>{{ entry.label }}</strong><span class="special-path">{{ entry.path }}</span></span>
          <span v-if="!entry.exists" class="special-flag">不存在</span>
          <ChevronRight aria-hidden="true" :size="iconSize.control" />
        </button>
        <p v-if="!paths.length" class="palette-empty">没有可显示的目录。</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* `resize` 要有非 visible 的 overflow 才生效；这里与 .command-palette 的滚动方向不冲突。 */
.special-paths-dialog { width: 620px; min-width: 380px; min-height: 180px; overflow: hidden; resize: both; }
.special-heading { flex: 1; color: var(--bright); font-weight: 500; }
.special-main { display: flex; flex-direction: column; align-items: flex-start; flex: 1; min-width: 0; }
.special-path { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.special-flag { color: var(--warning); font-size: 12px; }
.missing { color: var(--muted); }
</style>
