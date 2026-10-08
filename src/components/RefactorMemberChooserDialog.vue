<script setup lang="ts">
// 重构勾选表对话框 —— 上游 `MemberSelectionPanel` 那张表在本仓的等价物，坐标（按路径核过）：
//   · `java/java-impl-refactorings/src/com/intellij/refactoring/memberPushDown/PushDownDialog.java:31-34`
//     —— `new MemberSelectionPanel(members.to.be.pushed.down.panel.title, getMemberInfos(), keep.abstract.column.header)`：
//     面板标题 + 成员表 + 「保持抽象」那一列，就是这里 `table` 面板的形态；
//   · `java/java-impl-refactorings/src/com/intellij/refactoring/memberPullUp/PullUpDialog.java:111-114`
//     —— 上移复用同一张 `myMemberSelectionPanel`（所以本仓上移/下推共用一个组件，不是两个）；
//   · `platform/lang-impl/src/com/intellij/refactoring/introduceParameterObject/AbstractIntroduceParameterObjectDialog.java:66-105`
//     —— `myParameterClassPanel` 到 `myParamsPanel` 那三块面板，次序由 `PARAMETER_OBJECT_PANELS` 给。
//
// 面板次序与标题**不在组件里写死**，由 `src/refactorHostAssembly.ts` 从模型取：
//   · 成员上移/下移 = `memberMovePanelTitle(direction, className)` + 「成员」表
//     （第三列 = `KEEP_ABSTRACT_COLUMN`，`RefactoringBundle.properties:262` 的 zh 值）；
//   · 引入形参对象 = `PARAMETER_OBJECT_PANELS`（要提取形参的方法 → 形参类 → 要提取的形参），
//     复选框只有 `supportsDelegate(language)` 为真时才给（其余语言档连这一格都不渲染）。
//
// 组件**不碰文件、不算编辑**：只发意图，编辑与预览在宿主（`openEditsPreview` →
// `RefactorPreviewDialog` → `applyEditsToFiles`）。
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import type { RefactorChooserModel } from '../refactorHostAssembly.ts'

const props = defineProps<{ model: RefactorChooserModel }>()
const emit = defineEmits<{
  (event: 'field', panel: number, value: string): void
  (event: 'row', panel: number, row: number): void
  (event: 'extra', panel: number, row: number): void
  (event: 'check', index: number): void
  (event: 'ok'): void
  (event: 'cancel'): void
}>()

const canOk = computed(() => !props.model.error && !props.model.busy)
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('cancel')">
    <section class="command-palette member-chooser" role="dialog" :aria-label="model.title">
      <div class="palette-input">
        <span class="member-chooser-title">{{ model.title }}</span>
        <button class="icon-button" title="关闭" aria-label="关闭" @click="emit('cancel')"><X :size="iconSize.action" /></button>
      </div>

      <div class="member-chooser-body">
        <section v-for="(panel, panelIndex) in model.panels" :key="panel.title" class="member-chooser-panel">
          <p class="member-chooser-section">{{ panel.title }}</p>
          <pre v-if="panel.kind === 'text'" class="member-chooser-text">{{ panel.text }}</pre>
          <label v-else-if="panel.kind === 'field'" class="member-chooser-field">
            <span>{{ panel.label }}:</span>
            <input :value="panel.value" spellcheck="false" :list="panel.options?.length ? `chooser-options-${panelIndex}` : undefined"
              @input="emit('field', panelIndex, ($event.target as HTMLInputElement).value)" />
          </label>
          <datalist v-if="panel.options?.length" :id="`chooser-options-${panelIndex}`">
            <option v-for="option in panel.options" :key="option" :value="option" />
          </datalist>
          <table v-else class="member-chooser-table">
            <thead>
              <tr>
                <th class="member-chooser-check" aria-label="选择"></th>
                <th v-for="column in panel.columns" :key="column.label">{{ column.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIndex) in panel.rows" :key="row.id" :class="{ selected: row.checked }" @click="emit('row', panelIndex, rowIndex)">
                <td class="member-chooser-check"><input type="checkbox" :checked="row.checked" :aria-label="`选择 ${row.cells[0]}`" @click.stop="emit('row', panelIndex, rowIndex)" /></td>
                <td v-for="(column, columnIndex) in panel.columns" :key="column.label">
                  <input v-if="column.boolean" type="checkbox" :checked="row.extra" :disabled="row.extraEnabled === false"
                    :aria-label="`${column.label} · ${row.cells[0]}`" @click.stop="emit('extra', panelIndex, rowIndex)" />
                  <template v-else>{{ row.cells[columnIndex] }}</template>
                </td>
              </tr>
              <tr v-if="!panel.rows?.length"><td :colspan="(panel.columns?.length ?? 0) + 1" class="member-chooser-empty">无</td></tr>
            </tbody>
          </table>
        </section>

        <label v-for="(check, index) in model.checks" :key="check.label" class="member-chooser-check-line">
          <input type="checkbox" :checked="check.checked" @change="emit('check', index)" /><span>{{ check.label }}</span>
        </label>
      </div>

      <footer class="member-chooser-foot">
        <p v-if="model.error" class="member-chooser-error" role="alert">{{ model.error }}</p>
        <p v-if="model.note" class="member-chooser-note">{{ model.note }}</p>
        <div class="dialog-actions">
          <button class="primary-button" :disabled="!canOk" @click="emit('ok')">确定</button>
          <button class="subtle-button" @click="emit('cancel')">取消</button>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.member-chooser { width: min(620px, calc(100vw - 32px)); }
.member-chooser-title { color: var(--bright); font-size: 14px; }
.member-chooser-body { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2) var(--space-3); min-height: 0; overflow: auto; }
.member-chooser-panel { display: flex; flex-direction: column; gap: var(--space-1); }
.member-chooser-section { margin: 0; font-size: 11px; color: var(--muted); }
.member-chooser-text { margin: 0; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); font: 12px var(--font-mono); color: var(--text); background: var(--editor); white-space: pre-wrap; }
.member-chooser-field { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--muted); }
.member-chooser-field input { width: 260px; max-width: 60vw; }
.member-chooser-table { width: 100%; border-collapse: collapse; font-size: 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.member-chooser-table th { text-align: left; font-weight: 500; color: var(--muted); padding: var(--space-1); border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--elevated); }
.member-chooser-table td { padding: var(--space-1); border-bottom: 1px solid var(--line); }
.member-chooser-table tr.selected td { background: var(--selected); }
.member-chooser-check { width: 28px; text-align: center; }
.member-chooser-table input[type='checkbox'] { margin: 0; }
.member-chooser-empty { color: var(--muted); text-align: center; }
.member-chooser-check-line { display: flex; gap: var(--space-2); align-items: center; font-size: 12px; color: var(--text); }
.member-chooser-foot { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2) var(--space-3); border-top: 1px solid var(--line); }
.member-chooser-error { margin: 0; font-size: 11px; color: var(--error); }
.member-chooser-note { margin: 0; font-size: 11px; color: var(--muted); }
</style>
