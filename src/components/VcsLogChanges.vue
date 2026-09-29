<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GitCommitChanges, GitCommitChange } from '../bridge'
import { changeTree } from '../vcsLogChanges'
import VcsLogChangeTree from './VcsLogChangeTree.vue'
const props = defineProps<{ changes: GitCommitChanges | null; selected: boolean; loading?: boolean; error?: string }>()
const emit = defineEmits<{ select: [change: GitCommitChange | null] }>()
const selectedPath = ref('')
const comparisonIndex = ref(0)
watch([() => props.changes, comparisonIndex], () => { selectedPath.value = ''; emit('select', null) }, { flush: 'sync' })
function select(path: string) {
  selectedPath.value = path
  emit('select', files.value.find(file => file.path === path) ?? null)
}
watch(() => props.changes?.revision, () => { comparisonIndex.value = 0 })
const comparison = computed(() => props.changes?.comparisons[comparisonIndex.value])
const files = computed(() => comparison.value?.files ?? [])
const tree = computed(() => changeTree(files.value.map(file => ({ path: file.path, status: file.status,
  previousPath: file.beforePath && file.beforePath !== file.afterPath ? file.beforePath : undefined }))))
</script>
<template>
  <section class="changes" aria-label="提交变更文件">
    <div class="heading">变更<span v-if="changes !== null">{{ files.length }} 个文件</span></div>
    <label v-if="changes && changes.comparisons.length > 1" class="comparison">比较父提交
      <select v-model="comparisonIndex" aria-label="比较父提交"><option v-for="(item, index) in changes.comparisons" :key="item.parent" :value="index">{{ item.parent.slice(0, 8) }}</option></select>
    </label>
    <p v-if="!selected">选择提交以查看变更。</p>
    <p v-else-if="loading">正在加载变更…</p>
    <p v-else-if="error" role="alert">{{ error }}</p>
    <p v-else-if="changes === null">尚未加载变更。</p>
    <p v-else-if="!files.length">此比较没有文件变更。</p>
    <div v-else class="tree"><VcsLogChangeTree :nodes="tree" :selected="selectedPath" @select="select" /></div>
  </section>
</template>
<style scoped>
.changes { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.heading { display: flex; align-items: center; justify-content: space-between; min-height: 30px; padding: 0 8px; border-bottom: 1px solid var(--line); font-size: 11px; }
.heading span, p { color: var(--muted); font-size: 11px; }
p { margin: 12px; overflow-wrap: anywhere; }
.comparison { display: flex; gap: 8px; padding: 4px 8px; font-size: 11px; }
.comparison select { color: var(--text); background: var(--editor); border: 1px solid var(--line); }
.tree { overflow: auto; flex: 1; padding: 4px 0; }
</style>
