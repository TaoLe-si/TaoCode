<script setup lang="ts">
// Split SE SePopupContentPane:570-601: selection → cancellable preview, never navigation.
import { ref, watch } from 'vue'
import SearchEverywherePreviewEditor from './SearchEverywherePreviewEditor.vue'
import type { SearchEverywhereItem } from '../searchEverywhere'

const props = defineProps<{ item: SearchEverywhereItem }>()
const preview = ref<Awaited<ReturnType<NonNullable<SearchEverywhereItem['preview']>>>>(null)
const loading = ref(false)
const error = ref('')
watch(() => props.item, (item, _old, onCleanup) => {
  let current = true
  onCleanup(() => { current = false })
  preview.value = null
  error.value = ''
  loading.value = Boolean(item.preview)
  if (!item.preview) return
  void item.preview().then(result => {
    if (!current) return
    preview.value = result
    loading.value = false
  }).catch((reason: unknown) => {
    if (!current) return
    loading.value = false
    error.value = reason instanceof Error ? reason.message : String(reason)
  })
}, { immediate: true, flush: 'sync' })
</script>

<template>
  <aside class="se-preview" aria-label="文件只读预览" :aria-busy="loading">
    <p v-if="loading" class="se-preview-message" role="status">正在读取预览…</p>
    <p v-else-if="error" class="se-preview-message" role="status">无法预览：{{ error }}</p>
    <template v-else-if="preview">
      <header class="se-preview-meta" :title="preview.path">{{ preview.path }} · {{ preview.origin === 'buffer' ? '编辑器缓冲区' : '磁盘' }}只读预览</header>
      <SearchEverywherePreviewEditor :document="preview" />
      <footer class="se-preview-note">全文可滚动 · 在搜索框按回车打开选中结果</footer>
    </template>
    <p v-else class="se-preview-message">此结果没有可用预览。</p>
  </aside>
</template>

<style scoped>
.se-preview { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
.se-preview-meta, .se-preview-note, .se-preview-message { padding: var(--space-2) var(--space-3); margin: 0; font-size: 12px; }
.se-preview-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.se-preview-note { opacity: .65; }
</style>
