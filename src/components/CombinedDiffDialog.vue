<script setup lang="ts">
// 多文件合成差异（上游 `CombinedDiffViewer`）：把一批文件的差异块交给同一张 `DiffView`
// （`files` prop），工具带上多出一组「上一个/下一个文件 + 位置」。
// 取数与组装在 `src/compareDiffHost.ts`，纯导航规则在 `src/diffCombined.ts`；
// 本组件只负责"加载态 / 空态 / 关掉"，面板（`SourceControl.vue`）负责"从哪来、什么时候开"。
import { computed, ref, watch } from 'vue'
import { request, type DiffSides } from '../bridge'
import { combinedStats, type CombinedDiffFile } from '../diffCombined'
import { loadCombinedFiles, targetSubtitle, type CombinedDiffTarget } from '../compareDiffHost'
import DiffView from './DiffView.vue'
import { X } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  targets: CombinedDiffTarget[]
  /** diff 设置里的上下文行数（0 = git 默认）。 */
  context?: number
  /** 标题前缀（`与 main 的比较` / `本地更改`…）。 */
  title?: string
}>()
const emit = defineEmits<{ close: [] }>()
const files = ref<CombinedDiffFile[]>([])
const loading = ref(false)
const error = ref('')
let token = 0

watch(() => props.targets, async targets => {
  const current = ++token
  files.value = []
  error.value = ''
  if (!targets.length) return
  loading.value = true
  try {
    const loaded = await loadCombinedFiles(targets, props.context ?? 0)
    if (current === token) files.value = loaded
  } catch (caught) {
    if (current === token) error.value = caught instanceof Error ? caught.message : String(caught)
  } finally { if (current === token) loading.value = false }
}, { immediate: true })

const stats = computed(() => combinedStats(files.value))
const heading = computed(() => props.title ?? '全部差异')
/** 取不到任何一份（都读失败/都空）时给一句说明，不摆一张空查看器。 */
const empty = computed(() => !loading.value && !error.value && files.value.length === 0)
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="combined-diff-dialog" role="dialog" aria-modal="true" aria-label="全部差异">
      <header class="combined-head">
        <span class="combined-title">{{ heading }}<small v-if="files.length"> · {{ files.length }} 个文件 · <b class="add">+{{ stats.added }}</b> <b class="del">−{{ stats.removed }}</b></small></span>
        <button class="icon-button" type="button" title="关闭" aria-label="关闭全部差异" @click="emit('close')"><X :size="iconSize.action" /></button>
      </header>
      <p v-if="loading" class="combined-note" role="status">正在读取差异…</p>
      <p v-else-if="error" class="combined-note combined-error" role="alert">{{ error }}</p>
      <p v-else-if="empty" class="combined-note">这批文件没有可显示的文本差异。</p>
      <!-- 合成档：`files` 非空时 DiffView 走"当前文件 + 块间导航"那条路。 -->
      <DiffView v-else :path="files[0]?.path ?? ''" :rows="[]" unified="" :files="files" />
    </section>
  </div>
</template>

<style scoped>
.combined-diff-dialog { display: flex; flex-direction: column; width: min(1100px, 92vw); height: min(760px, 88vh); border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); color: var(--popup-foreground); box-shadow: var(--popup-shadow); overflow: hidden; }
.combined-head { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line); }
.combined-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.combined-title .add { color: var(--success); font-weight: 500; }
.combined-title .del { color: var(--error); font-weight: 500; }
.combined-note { margin: 0; padding: var(--space-3); color: var(--muted); font-size: 11px; }
.combined-error { color: var(--error); }
</style>
