<script setup lang="ts">
// 文件嵌套规则的编辑对话框（`pv/project-view-nodes` 族）—— 上游
// `FileNestingInProjectViewDialog`（`platform/lang-impl/.../projectView/impl/FileNestingInProjectViewDialog.java`）
// 与它的入口 `ConfigureFilesNestingAction`（`platform/projectView/shared/src/actions/ConfigureFilesNestingAction.kt`）。
//
// 布局照 `createCenterPanel`（`:92-98`）：上面一个「以嵌套形式显示具有相同名称的文件(&S)」
// 开关（`IdeBundle.file.nesting.feature.enabled.checkbox`，中文包同键），下面一块
// 「嵌套规则:」（`file.nesting.table.title`）的表格面板（`:100-119`）。开关关掉时
// 规则面板整体禁用（`UIUtil.setEnabled(myRulesPanel, …)`，`:76`）。
// 表格两列是「父文件后缀 / 子文件后缀」（`LangBundle.parent.file.suffix.column.name` /
// `child.file.suffix.column.name`），子后缀在一格里用 `;` 分隔（`CombinedNestingRule`，`:248-256`）。
// 左侧一个「重置为默认(&R)」（`file.nesting.reset.to.default.button`，`:170-177`）。
// 上/下移两格在上游被关掉了（`:114`），这里也没有。
//
// 表外的加减法与校验都在 `src/projectTreeNestingDialog.ts`，这里只做 DOM 与焦点。
// 落盘走 `projectTreeState` 的 `updateNesting`（开关 + 规则表一起交，见那边注释）。
import { computed, ref, watch } from 'vue'
import { Plus, Trash2 } from 'lucide-vue-next'
import { nestingRowsOf, nestingRulesOf, newNestingRow, validateNestingRows, type NestingRuleRow } from '../projectTreeNestingDialog'
import { DEFAULT_NESTING_RULES, type NestingRule } from '../projectTreeNesting'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  enabled: boolean
  rules: readonly NestingRule[]
  persistenceError?: string
}>()
const emit = defineEmits<{ apply: [patch: { enabled: boolean; rules?: readonly NestingRule[] }]; close: [] }>()

const rows = ref<NestingRuleRow[]>([])
watch(() => [props.enabled, props.rules], () => { rows.value = nestingRowsOf(props.rules) }, { immediate: true, deep: true })
// 开关是**对话框里的本地状态**：上游 `ConfigureFilesNestingAction.actionPerformed` 先 `dialog.reset(view.useFileNestingRules)`
// （`.kt:54`），只有 `showAndGet()` 为真才 `dialog.apply { view.setUseFileNestingRules(it) }`（`:55-57`）——
// 勾选框自己不动设置，「取消」就得回到原样。动的那个只是规则面板的禁用态
// （`FileNestingInProjectViewDialog.java:76` 的 `UIUtil.setEnabled(myRulesPanel, …)`）。
const enabledNow = ref(props.enabled)
watch(() => props.enabled, value => { enabledNow.value = value })
const error = ref('')
// 父后缀在**编辑时**就 trim（`ColumnInfo.setValue`，`:143`）；子后缀不 trim（`:159`）。
function setParent(index: number, value: string) { rows.value[index] = { ...rows.value[index]!, parentSuffix: value.trim() } }
function setChildren(index: number, value: string) { rows.value[index] = { ...rows.value[index]!, childSuffixes: value } }
function addRow() { rows.value = [...rows.value, newNestingRow()] }
/** 表格只有「新增」与「删除」两格（`ToolbarDecorator` 的 createElement + `Minus`）。 */
function removeRow(index: number) { rows.value = rows.value.filter((_, at) => at !== index) }
/** 「重置为默认」：出厂规则表重新铺成行（`resetTable(myModel.getDefaultRules())`，`:174`）。 */
function resetToDefault() { rows.value = nestingRowsOf(DEFAULT_NESTING_RULES) }
const canRemove = computed(() => rows.value.length > 0)

function apply() {
  // `doValidate`（`:185-208`）：开关关着时不校验，`apply` 也就不写规则表（`:235-245`）。
  const problem = validateNestingRows(rows.value, enabledNow.value)
  error.value = problem
  if (problem) return
  emit('apply', enabledNow.value ? { enabled: true, rules: nestingRulesOf(rows.value) } : { enabled: false })
  emit('close')
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="help-dialog nesting-dialog" role="dialog" aria-modal="true" aria-label="文件嵌套" @keydown.esc="emit('close')">
      <h2>文件嵌套</h2>
      <label class="nesting-enabled">
        <input type="checkbox" :checked="enabledNow" @change="enabledNow = !enabledNow" />
        <span>以嵌套形式显示具有相同名称的文件(S)</span>
      </label>
      <fieldset class="nesting-rules" :disabled="!enabledNow">
        <legend>嵌套规则:</legend>
        <table class="nesting-table">
          <thead>
            <tr><th scope="col">父文件后缀</th><th scope="col">子文件后缀</th><th scope="col"><span class="visually-hidden">行操作</span></th></tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in rows" :key="index">
              <td><input class="rename-input" :value="row.parentSuffix" aria-label="父文件后缀" spellcheck="false" @input="setParent(index, ($event.target as HTMLInputElement).value)" /></td>
              <td><input class="rename-input" :value="row.childSuffixes" aria-label="子文件后缀" spellcheck="false" @input="setChildren(index, ($event.target as HTMLInputElement).value)" /></td>
              <td class="nesting-row-actions">
                <button class="icon-button" type="button" title="删除这条规则" aria-label="删除这条规则" :disabled="!canRemove" @click="removeRow(index)"><Trash2 :size="iconSize.control" /></button>
              </td>
            </tr>
            <tr v-if="!rows.length"><td colspan="3" class="nesting-empty">没有规则 —— 不会嵌套任何文件。</td></tr>
          </tbody>
        </table>
        <div class="nesting-table-actions">
          <button class="subtle-button" type="button" @click="addRow"><Plus aria-hidden="true" :size="iconSize.control" />新增规则</button>
          <button class="subtle-button" type="button" @click="resetToDefault">重置为默认(R)</button>
        </div>
      </fieldset>
      <p v-if="error" class="nesting-error" role="alert">{{ error }}</p>
      <p v-if="persistenceError" class="nesting-error" role="status">{{ persistenceError }}</p>
      <div class="dialog-actions">
        <!-- 顺序 = `DialogWrapper.createActions()` 的 [OK, Cancel]（`DialogWrapper.java:1234-1238`）。
             上游 `DialogWrapper.OkAction`（`:2100-2105`）只设 `DEFAULT_ACTION` 与 `MAC_ACTION_ORDER`，
             **没有**图标；`createJButtonForAction`（`:951-975`）也不给它加 —— 原先这里画了一个勾，
             是"确定 = 勾"的发明形状，本批删掉。 -->
        <button class="primary-button" @click="apply">确定</button>
        <button class="subtle-button" @click="emit('close')">取消</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.nesting-enabled { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-3) 0; color: var(--text); font-size: 12px; }
.nesting-rules { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3) var(--space-3); }
.nesting-rules[disabled] { opacity: 0.55; }
.nesting-rules legend { padding: 0 var(--space-1); color: var(--secondary); font-size: 11px; }
.nesting-table { width: 100%; border-collapse: collapse; }
.nesting-table th { padding: var(--space-1); color: var(--muted); font-size: 11px; font-weight: 500; text-align: left; }
.nesting-table td { padding: 2px var(--space-1); }
.nesting-row-actions { width: 32px; text-align: right; }
.nesting-row-actions .icon-button { padding: 0; }
.nesting-row-actions svg { flex-shrink: 0; }
.nesting-empty { padding: var(--space-2); color: var(--muted); font-size: 11px; }
.nesting-table-actions { display: flex; gap: var(--space-2); margin-top: var(--space-2); }
.nesting-table-actions .subtle-button { display: inline-flex; align-items: center; gap: var(--space-1); }
.nesting-table-actions svg { flex-shrink: 0; }
.nesting-error { color: var(--error); font-size: 11px; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
