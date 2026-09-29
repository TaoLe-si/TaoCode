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
    <p v-if="loading" role="status">正在读取预览…</p>
    <p v-else-if="error" role="status">无法预览：{{ error }}</p>
    <template v-else-if="preview">
      <header :title="preview.path">{{ preview.path }} · {{ preview.origin === 'buffer' ? '编辑器缓冲区' : '磁盘' }}只读预览</header>
      <SearchEverywherePreviewEditor :document="preview" />
      <footer>全文可滚动 · 在搜索框按回车打开选中结果</footer>
    </template>
    <p v-else>此结果没有可用预览。</p>
  </aside>
</template>

<style scoped>
.se-preview { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
header, footer, p { padding: 8px 12px; margin: 0; font-size: 12px; }
header { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
footer { opacity: .65; }
</style>
