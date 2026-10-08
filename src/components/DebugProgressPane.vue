<script setup lang="ts">
// DAP 进度（`progress` 事件）那一块，从 `DebugPanel.vue` 拆出 —— 面板贴着机检上限，
// 与断点区/源文件清单/控制台同一拆法：整块只读 `dapProgress`（桥接的事件表），
// 与「怎么发 DAP 请求 / 怎么维护调用栈」不共一个职责域。
//
// 上游对应：`ProgressManager`（后台任务的进度条，`platform/core-impl` 的
// `ProgressIndicator` 一族）——适配器用 `progress` 事件把「start/report/end」推进来，
// 本仓落成一个只读清单：每格标题 + 百分比（`percentage` 缺失 = 不确定态，滑条动画）。
import { dapProgress } from '../bridge'

/**
 * 适配器报的百分比可能越界；条子夹到 0..100，绝不让填充溢出轨道。
 * `null` = 不确定（规范里 `percentage` 可选），这时**不画任何填充**（走 indeterminate 动画）。
 */
function progressWidth(percentage: number | null): string | undefined {
  return percentage === null ? undefined : `${Math.min(100, Math.max(0, percentage))}%`
}
</script>

<template>
  <template v-if="dapProgress.length">
    <div class="debug-section-title">进度 <span>· {{ dapProgress.length }}</span></div>
    <div class="debug-progress" role="group" aria-label="适配器进度">
      <div v-for="entry in dapProgress" :key="entry.id" class="debug-progress-row">
        <div class="debug-progress-head">
          <!-- A start can carry a title, a message or neither; the row must never
               be empty, so the fallback says what it is. -->
          <span class="debug-progress-title">{{ entry.title || entry.message || '正在处理' }}</span>
          <span class="debug-progress-pct">{{ entry.percentage === null ? '进行中' : `${Math.round(entry.percentage)}%` }}</span>
        </div>
        <div
          class="debug-progress-track" :class="{ indeterminate: entry.percentage === null }" role="progressbar"
          :aria-label="entry.title || entry.message || '适配器进度'" :aria-valuemin="0" :aria-valuemax="100"
          :aria-valuenow="entry.percentage === null ? undefined : Math.round(entry.percentage)"
        >
          <div v-if="entry.percentage !== null" class="debug-progress-fill" :style="{ width: progressWidth(entry.percentage) }"></div>
        </div>
        <span v-if="entry.title && entry.message" class="debug-progress-msg">{{ entry.message }}</span>
      </div>
    </div>
  </template>
</template>

<style scoped>
.debug-section-title { margin: var(--space-3) var(--space-3) var(--space-1); color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-size: 10px; }
.debug-progress { border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: var(--space-1) var(--space-3); display: flex; flex-direction: column; gap: var(--space-1); }
.debug-progress-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); font-size: 11px; }
.debug-progress-title { color: var(--text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.debug-progress-pct { color: var(--muted); flex-shrink: 0; font: 11px var(--font-mono); }
.debug-progress-msg { color: var(--muted); font-size: 10px; overflow-wrap: anywhere; }
.debug-progress-track { position: relative; height: 4px; border-radius: var(--radius-pill); background: var(--rail); overflow: hidden; }
.debug-progress-fill { height: 100%; background: var(--accent); border-radius: var(--radius-pill); }
/* Indeterminate: the adapter has not said how far along it is, so the bar slides instead of showing a fabricated 0% or 100%. */
.debug-progress-track.indeterminate::after { content: ''; position: absolute; inset: 0 auto 0 0; width: 40%; border-radius: var(--radius-pill); background: var(--accent); animation: debug-progress-slide var(--dur-spin) var(--ease) infinite; }
@keyframes debug-progress-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
@media (prefers-reduced-motion: reduce) { .debug-progress-track.indeterminate::after { animation: none; width: 100%; opacity: .5; } }
</style>
