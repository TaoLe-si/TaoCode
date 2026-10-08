<script setup lang="ts">
// Agent 设置各分节的**共用外壳** —— 标题下的说明、真实控件的落点，以及分节共用的**设置控件口径**。
//
// 为什么抽出来：ZCode 的设置面板有十几节，本仓逐节复刻时每一节都要交代同一件事 ——
// 「这一节是什么」。那句话在十几个 `.vue` 里各写一遍会漂，所以收在这里，各节只交自己的
// `description`，差别留在节里，共识留在这里。
//
// 为什么共用口径也在这里：`SettingsDialog.vue` 给 `.section-description` / `.settings-fields` /
// `.input-row` / `.field-hint` / `.checkbox-row` 写的那套样式在 `<style scoped>` 里，只落在
// `SettingsDialog` 自己的元素上 —— 子组件（各节）的元素拿不到它的 scope id（多根子树尤其如此），
// 所以那些类名在分节里其实是**没有样式**的。分节要统一到同一套类名又真的生效，就得有一处
// 单一定义：就是这里。槽内容不是本组件的模板节点，拿不到本组件的 scope id，因此一律经
// `:deep()` 下达（编译成 `.agent-section-shell[data-v-…] .settings-fields`，槽内容是它的后代，能命中）。
//
// 命名与几何逐条对齐 `SettingsDialog.vue` 的同名规则（`.settings-fields` 的 gap、`.input-row`
// 的 label 与控件宽度、`.field-hint` 的 11px、`.checkbox-row` 的勾选框 14px）；控件高度一律走
// `--ctrl-height`（上游 `expUI_light.theme.json:668-672` 的 `TextField.minimumSize = 49,28`）。
</script>

<template>
  <div class="agent-section-shell">
    <slot />
  </div>
</template>

<style scoped>
.agent-section-shell { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
.agent-section-shell :deep(.settings-fields) { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; margin: 0; padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--panel); }
.agent-section-shell :deep(.settings-fields :is(input, select, textarea)) { box-sizing: border-box; min-height: var(--ctrl-height); padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font-family: inherit; font-size: 12px; }
.agent-section-shell :deep(.input-row) { display: grid; grid-template-columns: minmax(0, 1fr) minmax(150px, 220px); align-items: center; gap: var(--space-2) var(--space-4); min-width: 0; }
.agent-section-shell :deep(.input-row > label) { min-width: 0; color: var(--text); font-size: 12px; font-weight: 500; }
.agent-section-shell :deep(.input-row :is(input, select, textarea)) { width: 100%; max-width: 100%; min-width: 0; }
.agent-section-shell :deep(.field-hint) { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; font-weight: 400; }
.agent-section-shell :deep(.checkbox-row) { display: flex; align-items: flex-start; gap: var(--space-2); color: var(--text); font-size: 12px; line-height: 1.5; cursor: pointer; }
.agent-section-shell :deep(.checkbox-row > input) { flex: 0 0 auto; width: var(--icon-size-checkbox); height: var(--icon-size-checkbox); margin: 2px 0 0; accent-color: var(--accent); }
.agent-section-shell :deep(.checkbox-row > span) { min-width: 0; overflow-wrap: anywhere; }
.agent-section-shell :deep(.settings-status) { order: -1; margin: 0 auto 0 0; color: var(--success); font-size: 12px; }
.agent-section-shell :deep(.settings-problems) { margin: 0; padding: var(--space-2) var(--space-3); border: 1px solid var(--error); border-radius: var(--radius-xs); background: var(--error-bg); color: var(--error); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.agent-section-shell :deep(.settings-actions) { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-1); padding-top: var(--space-2); border-top: 1px solid var(--line); }
.agent-section-shell :deep(.settings-button) { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-1); min-height: var(--ctrl-height-sm); padding: 0 var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--elevated); color: var(--text); font: inherit; font-size: 12px; cursor: pointer; transition: background-color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease); }
.agent-section-shell :deep(.settings-button:hover:not(:disabled)) { background: var(--hover); }
.agent-section-shell :deep(.settings-button:disabled) { opacity: .5; cursor: default; }
.agent-section-shell :deep(.settings-button-primary) { border-color: var(--accent); background: var(--accent); color: var(--on-accent); font-weight: 600; }
.agent-section-shell :deep(.settings-button-primary:hover:not(:disabled)) { background: var(--accent-hover); }
.agent-section-shell :deep(.settings-icon-button) { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: var(--ctrl-height-sm); height: var(--ctrl-height-sm); padding: 0; border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--elevated); color: var(--secondary); cursor: pointer; }
.agent-section-shell :deep(.settings-icon-button:hover:not(:disabled)) { background: var(--hover); color: var(--text); }
.agent-section-shell :deep(.settings-icon-button-danger) { border-color: transparent; background: transparent; color: var(--error); }
.agent-section-shell :deep(.settings-box) { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--panel); }
.agent-section-shell :deep(.settings-box-title) { margin: 0; padding-bottom: var(--space-1); border-bottom: 1px solid var(--line); color: var(--bright); font-size: 12px; font-weight: 600; }
.agent-section-shell :deep(.input-row :is(input, select, textarea):focus-visible),
.agent-section-shell :deep(.settings-button:focus-visible),
.agent-section-shell :deep(.settings-icon-button:focus-visible) { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
@media (max-width: 560px) {
  .agent-section-shell :deep(.settings-fields) { padding: var(--space-2); }
  .agent-section-shell :deep(.input-row) { grid-template-columns: minmax(0, 1fr); gap: var(--space-1); }
  .agent-section-shell :deep(.settings-actions) { justify-content: flex-start; }
}
</style>
