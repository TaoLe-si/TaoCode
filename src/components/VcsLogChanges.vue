<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GitCommitChanges, GitCommitChange } from '../bridge'
import { changeTree } from '../vcsLogChanges'
import VcsLogChangeTree from './VcsLogChangeTree.vue'
const props = defineProps<{ changes: GitCommitChanges | null; selected: boolean; loading?: boolean; error?: string;
  /**
   * `Vcs.Log.ShowChangesFromParents`（`MainVcsLogUiProperties.java:20`，缺省关 `VcsLogApplicationSettings.kt:116-117`）。
   * 文案 `action.Vcs.Log.ShowChangesFromParents.description` = 分别显示对每个合并提交所做的更改，
   * 消费点在 `VcsLogAsyncChangesTreeModel.kt:244`（`showChangesFromParents && !changesToParents.isEmpty()`）：
   * 关 = 只看**第一个父提交**那一侧的变更，开 = 每个父提交各一份（本仓用那一条「比较父提交」下拉）。
   */
  fromParents?: boolean }>()
const emit = defineEmits<{ select: [change: GitCommitChange | null] }>()
const selectedPath = ref('')
const comparisonIndex = ref(0)
watch([() => props.changes, comparisonIndex], () => { selectedPath.value = ''; emit('select', null) }, { flush: 'sync' })
function select(path: string) {
  selectedPath.value = path
  emit('select', files.value.find(file => file.path === path) ?? null)
}
watch(() => props.changes?.revision, () => { comparisonIndex.value = 0 })
// 关档时把除第一个父以外的比较**藏起来**（不是禁掉下拉），与上游"只显示相对第一个父的变更"一致。
const comparisons = computed(() => (props.changes?.comparisons ?? []).slice(0, props.fromParents ? undefined : 1))
const comparison = computed(() => comparisons.value[Math.min(comparisonIndex.value, comparisons.value.length - 1)])
const files = computed(() => comparison.value?.files ?? [])
const tree = computed(() => changeTree(files.value.map(file => ({ path: file.path, status: file.status,
  previousPath: file.beforePath && file.beforePath !== file.afterPath ? file.beforePath : undefined }))))
</script>
<template>
  <section class="changes" aria-label="提交变更文件">
    <div class="heading">变更<span v-if="changes !== null">{{ files.length }} 个文件</span></div>
    <label v-if="changes && comparisons.length > 1" class="comparison">比较父提交
      <select v-model="comparisonIndex" aria-label="比较父提交"><option v-for="(item, index) in comparisons" :key="item.parent" :value="index">{{ item.parent.slice(0, 8) }}</option></select>
    </label>
    <p v-if="!selected" class="vcslog-changes-message">选择提交以查看变更。</p>
    <p v-else-if="loading" class="vcslog-changes-message">正在加载变更…</p>
    <p v-else-if="error" class="vcslog-changes-message" role="alert">{{ error }}</p>
    <p v-else-if="changes === null" class="vcslog-changes-message">尚未加载变更。</p>
    <p v-else-if="!files.length" class="vcslog-changes-message">此比较没有文件变更。</p>
    <div v-else class="tree"><VcsLogChangeTree :nodes="tree" :selected="selectedPath" @select="select" /></div>
  </section>
</template>
<style scoped>
.changes { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.heading { display: flex; align-items: center; justify-content: space-between; min-height: 30px; padding: 0 var(--space-2); border-bottom: 1px solid var(--line); font-size: 11px; }
.heading span, .vcslog-changes-message { color: var(--muted); font-size: 11px; }
.vcslog-changes-message { margin: var(--space-3); overflow-wrap: anywhere; }
.comparison { display: flex; gap: var(--space-2); padding: var(--space-1) var(--space-2); font-size: 11px; }
.comparison select { color: var(--text); background: var(--editor); border: 1px solid var(--line); }
.tree { overflow: auto; flex: 1; padding: var(--space-1) 0; }
</style>
