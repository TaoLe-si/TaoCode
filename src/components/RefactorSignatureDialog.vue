<script setup lang="ts">
// 更改签名对话框（Ctrl+F6）—— 上游
// `platform/lang-impl/src/com/intellij/refactoring/changeSignature/ChangeSignatureDialogBase.java`
// 在本仓的等价物。形态逐条照上游（坐标在注释里）：
//   · 标题「更改签名」= `changeSignature.refactoring.name`（`ChangeSignatureDialogBase.java:151`；
//     zh 值取 `localization-zh.jar` 的 `messages/RefactoringBundle.properties:67`）；
//   · 上栏两个输入框：「名称:」(`:236` 的 `changeSignature.name.prompt`) 与
//     「返回值类型:」(`:261` 的 `changeSignature.return.type.prompt`)，上游两个框都是
//     `setPreferredWidth(200)`（`:242` / `:269`）—— 本仓按同一比例给宽度；
//   · 中间是**形参表**，标题「形参」（`:340` 的 `parameters.border.title`），
//     三列 = 类型 / 名称 / 默认值（`java/java-impl/src/com/intellij/refactoring/changeSignature/JavaParameterTableModel.java:54-56`
//     的 `JavaTypeColumn` / `JavaNameColumn` / `DefaultValueColumn`）；
//   · 表格右侧的增删与上下移 = 上游 `ToolbarDecorator.createDecorator(...)`（`:480-487`）给的那四条；
//   · 底部「签名预览」分隔线（`:556` 的 `signature.preview.border.title`）下面那块，
//     上游尺寸 `new Dimension(-1, 130)`（`:558-559`）—— 本仓给同高的只读区；
//   · 初始焦点在表格上（`getPreferredFocusedComponent()`，`:193-207`：先表、再名字框）。
//
// **本仓没有移植的上游控件**（不是假控件，是真的没有落点，逐条写在报告里）：
//   · `myVisibilityPanel`（可见性下拉，`:249` / `createVisibilityControl()`）：
//     Java 的 public/protected/private 改由 PSI 写回，本仓的语言服务不给这个能力；
//   · 「传播形参…」按钮（`:394-421`，alt G，`:476`）：`createCallerChooser` 要 PSI 调用者层级；
//   · `myDelegationPanel`（生成委托，`:322-330`）：同上。
import { computed, onMounted, ref } from 'vue'
import { ArrowDown, ArrowUp, Plus, X, Trash2 } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { PARAMETER_COLUMNS, type SignatureParam } from '../refactorSignature.ts'

/** 与 `src/refactorSignatureFlow.ts` 的 `ChangeSignatureState` 同形（组件无状态，只发意图）。 */
export interface ChangeSignatureModel {
  name: string
  returnType: string
  hasReturnType: boolean
  params: SignatureParam[]
  selected: number
  error: string
  preview: string
  busy: boolean
  scanNote: string
}

const props = defineProps<{ model: ChangeSignatureModel }>()
const emit = defineEmits<{
  (event: 'rename', value: string): void
  (event: 'returnType', value: string): void
  (event: 'param', index: number, patch: Partial<SignatureParam>): void
  (event: 'select', index: number): void
  (event: 'add'): void
  (event: 'remove'): void
  (event: 'move', delta: number): void
  (event: 'apply'): void
  (event: 'cancel'): void
}>()

const table = ref<HTMLTableElement | null>(null)
const nameField = ref<HTMLInputElement | null>(null)
/** 上游 `getPreferredFocusedComponent()`：有行先聚焦表格，没有行才聚焦名字框。 */
onMounted(() => {
  if (props.model.params.length && table.value) table.value.querySelector('tbody tr')?.querySelector('input')?.focus()
  else nameField.value?.focus()
})

const canApply = computed(() => !props.model.error && !props.model.busy)
const hasSelection = computed(() => props.model.selected >= 0)
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('cancel')">
    <section class="command-palette change-signature" role="dialog" aria-modal="true" aria-label="更改签名">
      <div class="palette-input">
        <span class="change-signature-title">更改签名</span>
        <button class="icon-button" title="关闭" aria-label="关闭" @click="emit('cancel')"><X :size="iconSize.action" /></button>
      </div>

      <!-- 上栏：名称 + 返回值类型（`:236` / `:261`） -->
      <div class="change-signature-north">
        <label class="change-signature-field">
          <span>名称:</span>
          <input :value="model.name" spellcheck="false" @input="emit('rename', ($event.target as HTMLInputElement).value)" />
        </label>
        <label v-if="model.hasReturnType" class="change-signature-field">
          <span>返回值类型:</span>
          <input :value="model.returnType" spellcheck="false" @input="emit('returnType', ($event.target as HTMLInputElement).value)" />
        </label>
      </div>

      <!-- 形参表 + 右侧四钮（`:340` 的「形参」栏 + `:480` 的 ToolbarDecorator） -->
      <div class="change-signature-params">
        <p class="change-signature-section">形参</p>
        <div class="change-signature-table">
          <table ref="table">
            <thead>
              <tr><th v-for="column in PARAMETER_COLUMNS" :key="column.key">{{ column.label }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="(param, index) in model.params" :key="`${param.originalIndex}:${index}`"
                :class="{ selected: index === model.selected }" @click="emit('select', index)">
                <td v-for="column in PARAMETER_COLUMNS" :key="column.key">
                  <input :value="param[column.key]" spellcheck="false" :aria-label="`${column.label} · 第 ${index + 1} 行`"
                    @input="emit('param', index, { [column.key]: ($event.target as HTMLInputElement).value })" />
                </td>
              </tr>
              <tr v-if="!model.params.length"><td :colspan="PARAMETER_COLUMNS.length" class="change-signature-empty">无</td></tr>
            </tbody>
          </table>
        </div>
        <div class="change-signature-tools">
          <button class="icon-button" title="添加形参" aria-label="添加形参" @click="emit('add')"><Plus :size="iconSize.action" /></button>
          <button class="icon-button" title="删除形参" aria-label="删除形参" :disabled="!hasSelection" @click="emit('remove')"><Trash2 :size="iconSize.action" /></button>
          <button class="icon-button" title="上移形参" aria-label="上移形参" :disabled="!hasSelection" @click="emit('move', -1)"><ArrowUp :size="iconSize.action" /></button>
          <button class="icon-button" title="下移形参" aria-label="下移形参" :disabled="!hasSelection" @click="emit('move', 1)"><ArrowDown :size="iconSize.action" /></button>
        </div>
      </div>

      <!-- 签名预览（`:556` 分隔线 + `:558` 的高度） -->
      <div class="change-signature-preview">
        <p class="change-signature-section">签名预览</p>
        <pre aria-live="polite">{{ model.preview }}</pre>
      </div>

      <footer class="change-signature-foot">
        <p v-if="model.error" class="change-signature-error" role="alert">{{ model.error }}</p>
        <p v-if="model.scanNote" class="change-signature-note">{{ model.scanNote }}</p>
        <div class="dialog-actions">
          <button class="subtle-button" @click="emit('cancel')">取消</button>
          <button class="primary-button" :disabled="!canApply" @click="emit('apply')">重构</button>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.change-signature { width: min(680px, calc(100vw - 32px)); }
.change-signature-title { color: var(--bright); font-size: 14px; }
.change-signature-north { display: flex; gap: var(--space-3); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line); }
/* 上游两个框都 setPreferredWidth(200)（ChangeSignatureDialogBase.java:242/:269） */
.change-signature-field { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--muted); }
.change-signature-field input { width: 200px; max-width: 46vw; }
.change-signature-section { margin: 0 0 var(--space-1); font-size: 11px; color: var(--muted); }
.change-signature-params { display: flex; gap: var(--space-2); padding: var(--space-2) var(--space-3); min-height: 0; }
.change-signature-table { flex: 1; min-width: 0; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.change-signature-table table { width: 100%; border-collapse: collapse; font-size: 12px; }
.change-signature-table th { text-align: left; font-weight: 500; color: var(--muted); padding: var(--space-1); border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--elevated); }
.change-signature-table td { padding: 0; border-bottom: 1px solid var(--line); }
.change-signature-table td input { width: 100%; border: 0; background: transparent; padding: var(--space-1); font: 12px var(--font-mono); }
.change-signature-table tr.selected td { background: var(--selected); }
.change-signature-empty { color: var(--muted); padding: var(--space-2); text-align: center; }
.change-signature-tools { display: flex; flex-direction: column; gap: var(--space-1); }
.change-signature-preview { padding: 0 var(--space-3) var(--space-2); }
.change-signature-preview pre { margin: 0; height: 130px; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius-sm);
  padding: var(--space-2); font: 12px var(--font-mono); color: var(--text); background: var(--surface); white-space: pre-wrap; }
.change-signature-foot { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2) var(--space-3); border-top: 1px solid var(--line); }
.change-signature-error { margin: 0; font-size: 11px; color: var(--error); }
.change-signature-note { margin: 0; font-size: 11px; color: var(--muted); }
</style>
