<script setup lang="ts">
// 安全删除的三选一对话框 —— 上游
// `platform/lang-impl/src/com/intellij/refactoring/safeDelete/UnsafeUsagesDialog.java`
// （`:35` 标题「检测到用法」、`:36` 抬头「发现以下问题：」、`:41-47` 的三个按钮、
//  `:58` 的问题清单、`:98` 的 `DEFAULT_ACTION`）在本仓的等价物。
//
// 模型全部来自 `src/safeDelete.ts:141` 的 `safeDeletePrompt()`：标题/抬头/清单/收尾说明/
// 三个选择（含哪个是默认项）都在那份模型里，组件**不另写一句文案**，也不重排次序。
// 回车落在默认项（`viewUsages`，`UnsafeUsagesDialog.java:41-47` 把它排第一并标 DEFAULT_ACTION）。
//
// **本仓没有渲染的上游控件**：`SafeDeleteDialog.java:149/:155` 那两个搜索复选框。
// 「搜索注释/字符串」这一半本仓是真的在扫（`src/nonCodeUsages.ts`），但它不是一个可当场改的入参：
// 勾选状态由 `defaultSafeDeleteOptions()`（`src/safeDelete.ts:101`）给定，「搜索文本匹配项」默认**关**
// —— 理由见 `docs/wiring-requests-2026-10-06-bucket1b.md`「不做」第 1 条（LSP 的 rename/references
// 不接受这个入参）。不渲染一个当场改了没用的框，就按铁律连灰框都不给。
import { X } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import type { SafeDeleteChoice, SafeDeletePrompt } from '../safeDelete.ts'

const props = defineProps<{ prompt: SafeDeletePrompt }>()
const emit = defineEmits<{
  (event: 'choose', choice: SafeDeleteChoice): void
  (event: 'cancel'): void
}>()

/** 键盘走默认项：上游那个对话框的回车落在 `DEFAULT_ACTION` 上。 */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') { event.preventDefault(); emit('choose', props.prompt.choices.find(choice => choice.primary)?.id ?? 'viewUsages') }
  else if (event.key === 'Escape') { event.preventDefault(); emit('cancel') }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('cancel')">
    <section class="command-palette safe-delete" role="alertdialog" aria-modal="true" :aria-label="prompt.title" @keydown="onKeydown">
      <div class="palette-input">
        <span class="safe-delete-title">{{ prompt.title }}</span>
        <button class="icon-button" title="关闭" aria-label="关闭" @click="emit('cancel')"><X :size="iconSize.action" /></button>
      </div>
      <div class="safe-delete-body">
        <p class="safe-delete-lead">{{ prompt.lead }}</p>
        <ul class="safe-delete-list">
          <li v-for="(detail, index) in prompt.details" :key="index">{{ detail }}</li>
        </ul>
        <p class="safe-delete-foot">{{ prompt.footer }}</p>
      </div>
      <footer class="safe-delete-actions">
        <button v-for="choice in prompt.choices" :key="choice.id" :class="choice.primary ? 'primary-button' : 'subtle-button'"
          @click="emit('choose', choice.id)">{{ choice.label }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.safe-delete { width: min(560px, calc(100vw - 32px)); }
.safe-delete-title { color: var(--bright); font-size: 14px; }
.safe-delete-body { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2) var(--space-3); min-height: 0; overflow: auto; }
.safe-delete-lead { margin: 0; font-size: 12px; color: var(--text); }
.safe-delete-list { margin: 0; padding-left: var(--space-4); display: flex; flex-direction: column; gap: var(--space-1); font-size: 12px; color: var(--text); }
.safe-delete-foot { margin: 0; font-size: 11px; color: var(--muted); }
.safe-delete-actions { display: flex; justify-content: flex-end; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-top: 1px solid var(--line); }
</style>
