<script setup lang="ts">
// 环境变量的**行编辑器**（上游运行配置里那张用户变量表在本仓的 DOM 形式：一行一个
// 名字/值 + 「添加」/逐行删除）。规则与文案全部来自 `src/runEnvironmentVariables.ts`（单一真源），
// 本组件只负责输入与显示，不自己写校验规则。
//
// 上游出处：`EnvironmentVariablesDialog` 的用户变量表（逐行 `name`/`value`、空行在 apply 时跳过）
// 与它那两条 ValidationInfo（见 `src/runEnvironmentVariables.ts` 头部逐条列出的 file:line）。
// 不渲染的项：上游「包含系统环境变量」勾选与环境变量文件入口 —— 本仓运行通道永远在继承来的
// 环境之上叠（`native/runner.hpp:30`），取消继承这一档没有承载，画了就是假控件（同
// `src/externalTaskSettings.ts:34` 的判决）。
import { ref, watch } from 'vue'
import { Minus, Plus } from 'lucide-vue-next'
import { envLinesFromRows, envRowProblem, envRowsFromLines, type EnvVarRow } from '../runEnvironmentVariables.ts'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  /** 配置记录里的 `env`（`KEY=VALUE` 行数组；形状由 schema/宿主钉住，本组件不改它）。 */
  modelValue: readonly string[]
  /** 每格输入框的 aria-label 前缀（配置表与模板表共用一个组件）。
   *  名字不叫 `ariaLabel`：那个名字与本组件模板上要落的原生 `aria-label` 属性撞车，
   *  vue-tsc 会把它当原生属性、判定 prop 缺失（2026-10-08 实测 TS2345）。 */
  labelPrefix: string
  busy?: boolean
}>()
const emit = defineEmits<{ (event: 'update:modelValue', value: string[]): void }>()

/** 本地行状态：允许存在「刚点添加、两格都还空着」的行 —— 这种行按上游的跳过规则不落盘。 */
const rows = ref<EnvVarRow[]>(envRowsFromLines(props.modelValue))
/** 上一次**本组件**发出的形状：外部改（切配置/取模板）才重建行，回显自己的写入不重建。 */
let selfEmitted = JSON.stringify(props.modelValue)
watch(() => props.modelValue, value => {
  if (JSON.stringify(value) === selfEmitted) return
  rows.value = envRowsFromLines(value)
})
function write(next: EnvVarRow[]) {
  rows.value = next
  const lines = envLinesFromRows(next)
  selfEmitted = JSON.stringify(lines)
  emit('update:modelValue', lines)
}
function setCell(index: number, key: 'name' | 'value', value: string) {
  write(rows.value.map((row, at) => (at === index ? { ...row, [key]: value } : row)))
}
function addRow() { write([...rows.value, { name: '', value: '' }]) }
function removeRow(index: number) { write(rows.value.filter((_, at) => at !== index)) }
/** 第一条问题（顺序即书写顺序）；逐行问题在行尾的标题里也带上，键盘/读屏都能听到。 */
const firstProblem = () => rows.value.map(envRowProblem).find(problem => problem) ?? ''
</script>

<template>
  <div class="env-editor">
    <div v-for="(row, index) in rows" :key="index" class="env-row">
      <input
        class="env-cell"
        :value="row.name"
        :aria-label="`${labelPrefix}名称 ${index + 1}`"
        :aria-invalid="Boolean(envRowProblem(row))"
        :title="envRowProblem(row) || undefined"
        placeholder="KEY"
        @input="setCell(index, 'name', ($event.target as HTMLInputElement).value)"
      />
      <span class="env-equals" aria-hidden="true">=</span>
      <input
        class="env-cell"
        :value="row.value"
        :aria-label="`${labelPrefix}值 ${index + 1}`"
        :aria-invalid="Boolean(envRowProblem(row))"
        placeholder="value"
        @input="setCell(index, 'value', ($event.target as HTMLInputElement).value)"
      />
      <button type="button" class="env-remove" :disabled="busy" :aria-label="`删除环境变量 ${index + 1}`" :title="`删除环境变量 ${index + 1}`" @click="removeRow(index)">
        <Minus :size="iconSize.dense" aria-hidden="true" />
      </button>
    </div>
    <p v-if="!rows.length" class="env-empty">还没有环境变量。</p>
    <div class="env-actions">
      <button type="button" class="subtle-button env-add" :disabled="busy" @click="addRow">
        <Plus :size="iconSize.dense" aria-hidden="true" /><span>添加变量</span>
      </button>
    </div>
    <p v-if="firstProblem()" class="env-problem" role="status">{{ firstProblem() }}</p>
  </div>
</template>

<style scoped>
.env-editor { display: flex; flex-direction: column; gap: var(--space-1); flex: 1; min-width: 0; }
.env-row { display: flex; align-items: center; gap: var(--space-1); min-width: 0; }
.env-cell { flex: 1; min-width: 0; padding: var(--space-1) var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); color: var(--text); font: inherit; font-size: 12px; }
.env-cell[aria-invalid='true'] { border-color: var(--error); }
.env-equals { flex-shrink: 0; color: var(--muted); }
.env-remove { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: var(--ctrl-height-sm); height: var(--ctrl-height-sm); border: 0; border-radius: var(--radius-xs); background: transparent; color: var(--secondary); }
.env-remove:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.env-remove:disabled { opacity: .5; }
.env-empty, .env-problem { margin: 0; font-size: 11px; }
.env-empty { color: var(--muted); }
.env-problem { color: var(--error); }
.env-actions { display: flex; }
.env-add { display: inline-flex; align-items: center; gap: var(--space-1); }
</style>
