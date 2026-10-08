<script setup lang="ts">
// 「IDE 内部错误」对话框 —— 上游 `IdeErrorsDialog`（`platform/platform-impl/src/com/intellij/diagnostic/`）
// 的对应物：状态栏那个「内部错误」芯片（`InternalErrorsChip`）点开后弹出它。
//
// 一屏一个错误簇（上游的 `myMessageClusters[myIndex]` 语义）：左边是簇清单，右边是当前簇的
// 消息清单 + 概况。簇与文案在 `src/errorReport.ts`（那里逐条标了上游行号）。
//
// 没有做的事（如实，见 src/errorReport.ts 的头注）：没有异常栈、没有插件归因、
// 没有「提交报告」—— 本仓没有上报渠道（`ErrorReportSubmitter` 无对应物），
// 因此底部只有「复制」与「显示日志」（`ShowLogAction.showLog`），外加「关闭」。
import { computed, ref, watch } from 'vue'
import { Copy, FileText, X } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { copyToClipboard } from '../clipboard'
import {
  clusterIndexLabel, clusterInfoLabel, clusterInternalErrors, errorClustersText,
  ERRORS_DIALOG_CLOSE, ERRORS_DIALOG_TITLE,
} from '../errorReport'
import type { InternalErrors } from '../internalErrors'

const props = defineProps<{
  errors: InternalErrors
  /** 「显示日志」（`ShowLogAction.showLog()`）—— 由宿主注入，本组件不碰宿主通道那一层。 */
  showLog: () => unknown
}>()
const emit = defineEmits<{ close: [] }>()

// 上游的 `selectMessage`：优先选第一条未读的；本仓没有 read/submitted 标记，退回选第一个。
const clusters = computed(() => clusterInternalErrors(props.errors.latest))
const index = ref(0)
watch(clusters, () => { if (index.value >= clusters.value.length) index.value = 0 })
const current = computed(() => clusters.value[index.value] ?? null)
const note = ref('')

async function copyAll() {
  const text = errorClustersText(clusters.value)
  if (!text) return
  try {
    await copyToClipboard(text)
    note.value = `已复制 ${clusters.value.length} 个错误簇的完整清单。`
  } catch (error) {
    note.value = `复制失败：${error instanceof Error ? error.message : String(error)}`
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="command-palette errors-dialog" role="dialog" aria-modal="true" :aria-label="ERRORS_DIALOG_TITLE">
      <div class="palette-input">
        <span class="errors-heading">{{ ERRORS_DIALOG_TITLE }}（{{ errors.count }}）</span>
        <button class="icon-button" :aria-label="ERRORS_DIALOG_CLOSE" :title="ERRORS_DIALOG_CLOSE" @click="emit('close')"><X :size="iconSize.action" /></button>
      </div>
      <div class="errors-body">
        <!-- 簇清单：一条 = 一个去重键（上游左侧那一列 cluster 列表）。 -->
        <ul class="errors-clusters" role="listbox" aria-label="错误簇">
          <li v-for="(cluster, i) in clusters" :key="cluster.key" role="presentation">
            <button class="errors-cluster" type="button" role="option" :aria-selected="i === index" :class="{ active: i === index }" @click="index = i">
              <span class="errors-cluster-msg">{{ cluster.message }}</span>
              <span class="errors-cluster-count">{{ cluster.messages.length }}</span>
            </button>
          </li>
        </ul>
        <!-- 当前簇的详情：序号 + 概况（上游 `myCountLabel` / `myDetailsLabel`）。 -->
        <div class="errors-detail">
          <p v-if="!current" class="palette-empty">没有可显示的内部错误。</p>
          <template v-else>
            <p class="errors-detail-head">
              <span class="errors-detail-index">{{ clusterIndexLabel(index, clusters.length) }}</span>
              <span class="errors-detail-info">{{ clusterInfoLabel(current) }}</span>
            </p>
            <ul class="errors-messages">
              <li v-for="(row, i) in current.messages" :key="i"><span class="errors-time">{{ row.time }}</span><span>{{ row.message }}</span></li>
            </ul>
          </template>
        </div>
      </div>
      <div class="palette-footer errors-actions">
        <span class="errors-note" role="status">{{ note }}</span>
        <button class="subtle-button" :disabled="!clusters.length" :title="'把全部错误簇复制到剪贴板'" @click="copyAll"><Copy :size="iconSize.chip" aria-hidden="true" />复制</button>
        <button class="subtle-button" :title="'在文件管理器里打开宿主日志'" @click="emit('close'); void showLog()"><FileText :size="iconSize.chip" aria-hidden="true" />显示日志</button>
        <button class="subtle-button" @click="emit('close')">{{ ERRORS_DIALOG_CLOSE }}</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.errors-dialog { width: 720px; }
.errors-heading { flex: 1; color: var(--bright); font-weight: 500; }
.errors-body { display: flex; gap: var(--space-3); min-height: 240px; padding: var(--space-2) var(--space-3); }
.errors-clusters { display: flex; flex-direction: column; gap: 2px; width: 260px; margin: 0; padding: 0; overflow: auto; list-style: none; flex-shrink: 0; }
.errors-cluster { display: flex; align-items: baseline; gap: var(--space-1); width: 100%; padding: var(--space-1) var(--space-2); color: var(--text); background: transparent; border: 1px solid transparent; border-radius: var(--radius-xs); font: inherit; font-size: 11px; text-align: left; }
.errors-cluster:hover { background: var(--elevated); border-color: var(--line-strong); }
.errors-cluster.active { background: var(--hover); border-color: var(--line-strong); color: var(--bright); }
.errors-cluster-msg { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.errors-cluster-count { flex-shrink: 0; color: var(--muted); font-variant-numeric: tabular-nums; }
.errors-detail { display: flex; flex-direction: column; gap: var(--space-1); flex: 1; min-width: 0; }
.errors-detail-head { display: flex; align-items: baseline; gap: var(--space-2); margin: 0; color: var(--muted); font-size: 11px; }
.errors-detail-index { color: var(--bright); font-variant-numeric: tabular-nums; }
.errors-messages { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; overflow: auto; list-style: none; }
.errors-messages li { display: flex; gap: var(--space-2); color: var(--text); font: 11px/1.6 var(--font-mono); overflow-wrap: anywhere; }
.errors-time { flex-shrink: 0; color: var(--muted); }
/* 底栏缺 `display: flex`：`align-items`/`gap` 与 `.errors-note` 的 `flex: 1`（把动作推到右侧）
   在这条声明缺失时**整条失效**（`<div>` 的 UA 默认是 block）。2026-10-08 lane visual-leftovers 补。 */
.errors-actions { display: flex; align-items: center; gap: var(--space-1); }
.errors-note { flex: 1; min-width: 0; color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
.errors-actions .subtle-button { display: inline-flex; align-items: center; gap: 2px; }
.errors-actions .subtle-button > svg { flex-shrink: 0; }
</style>
