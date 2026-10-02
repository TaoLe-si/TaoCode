<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { request, type GitCommitChange, type GitCommitFileDiff } from '../bridge'
import DiffView from './DiffView.vue'
import { X } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
const props = defineProps<{ root: string; change: GitCommitChange | null }>()
const emit = defineEmits<{ close: [] }>()
const result = ref<GitCommitFileDiff | null>(null)
const loading = ref(false)
const error = ref('')
let token = 0
watch([() => props.root, () => props.change], async () => {
  const current = ++token
  result.value = null; error.value = ''; loading.value = false
  const change = props.change
  if (!change) return
  loading.value = true
  try {
    const data = await request<GitCommitFileDiff>('git.commitFileDiff', {
      beforeRevision: change.beforeRevision, beforePath: change.beforePath,
      afterRevision: change.afterRevision, afterPath: change.afterPath,
    })
    if (current === token) result.value = data
  } catch (caught) { if (current === token) error.value = caught instanceof Error ? caught.message : String(caught) }
  finally { if (current === token) loading.value = false }
}, { immediate: true, flush: 'sync' })
onBeforeUnmount(() => { token++ })
</script>
<template>
  <section class="preview" aria-label="提交文件差异">
    <DiffView v-if="result?.status === 'text' && result.sides" :path="change?.path ?? ''"
      :subtitle="`${result.beforeRevision.slice(0, 8) || '空'} → ${result.afterRevision.slice(0, 8) || '空'}`"
      :rows="result.sides.rows" :unified="result.patch" :truncated="result.sides.truncated" closable @close="emit('close')" />
    <template v-else>
      <header><span>{{ change?.path }}</span><button class="icon-button" title="关闭" aria-label="关闭差异" @click="emit('close')"><X :size="iconSize.action" aria-hidden="true" /></button></header>
      <p v-if="loading" role="status">正在加载提交文件差异…</p>
      <p v-else-if="error" role="alert">{{ error }}</p>
      <p v-else-if="result?.status === 'binary'">二进制文件，无法显示文本差异。</p>
      <p v-else-if="result?.status === 'tooLarge'">文件超过文本差异大小或行数上限（字节上限 {{ result.maxBytes }}；原文件 {{ result.beforeSize }}，新文件 {{ result.afterSize }} 字节）。</p>
      <p v-else-if="result?.status === 'unsupported'">不支持此文件类型的文本差异（{{ result.beforeMode || '空' }} → {{ result.afterMode || '空' }}）。</p>
      <p v-else-if="result">后端没有提供文本差异行。</p>
    </template>
  </section>
</template>
<style scoped>
.preview { display: flex; flex: 1; min-height: 0; flex-direction: column; overflow: hidden; }
header { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; border-bottom: 1px solid var(--line); font-size: 11px; }
p { padding: 8px; font-size: 11px; color: var(--muted); }
</style>
