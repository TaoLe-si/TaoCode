// 结构化模板的**修饰符面板**（上游 `plugin/ui/filters/FilterPanel.java` + `FilterTable.java`
// 那一族在本仓的等价物：左侧一棵"整个模板 + 每个变量"的表，右侧是该档的编辑控件）。
//
// 上游的结构是 `DefaultFilterProvider.java:13` 给的五个动作（Context / Count / Reference / Text / Type），
// 每个动作把约束读成人话摘要（`FilterAction.getShortText`）并弹一个编辑器（`FilterEditor.java`）。
// 本仓不做 Swing 的"选中一行→开弹窗"，而是把**真的能兑现**的两档（计数、文本正则）加上
// 条件文本里的 `contains` 档直接摊在一行里编辑：
//   · 计数 = `CountFilter.java:70-71` 那两个复选框/数字框（写进 `minOccurs`/`maxOccurs`）；
//   · 文本 = `TextFilter.java:62-64` 清的那三项（regExp / invertRegExp / wholeWordsOnly）；
//   · 包含 = 上游只在条件文本里（`StringToConstraintsTransformer.java:459-461`），没有 UI 动作，
//     本仓给一个输入框，因为它的判定在文本层真的能跑（`src/structuralSearchModifiers.ts`）；
//   · 匹配范围 = 上游的 `within`，**只能写在整模板上**（同文件 `:463-466`），所以它出现在
//     「整个模板」那一节而不是每个变量那一行。
//
// **没有落点的四档不画控件**（引用 / 类型 / 语法上下文 / 脚本）：只在底部出一行说明文字，
// 说清缺的是哪一层。这是本仓的铁律——不渲染点不动的东西。
//
// 写回方式：本组件**不持有**模板文本，改动一律经 `writeVariableModifiers` 生成新模板后 emit，
// 由父组件（`SearchPanel.vue` 的 `$` 结构化模式）写回搜索框。所以"编辑修饰符"与"手打后缀"
// 走的是同一条编译通道，不存在两套模板语义。

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  UNAVAILABLE_FILTERS, applyToWholeTemplate, modifierRows, templateVariables, writeVariableModifiers,
  type WholeTemplateEdit,
} from '../structuralSearchFilters.ts'
import { parseVariableConstraint, UNLIMITED, type VariableConstraint } from '../structuralSearchConstraints.ts'
import {
  unsupportedModifiers, unavailableSwitches, toggleInvert, type TemplateScope,
} from '../structuralSearchModifiers.ts'
import { defineReplacementVariable, type ReplacementDefinition } from '../structuralSearchReplace.ts'

const props = defineProps<{
  /** 搜索框里的模板原文。 */
  template: string
  /** 「整个模板」那一档的匹配范围（上游 `within`）；null = 没挂。 */
  scope: TemplateScope | null
  /** 逐变量替换定义（上游 `ReplaceOptions` 的 `variableDefs` 那张表）。 */
  definitions: ReplacementDefinition[]
  /** 替换框里有内容才画「替换定义」那一节（上游 `ReplaceOptions` 只存在于替换模式）。 */
  replaceable: boolean
}>()

const emit = defineEmits<{
  (event: 'update:template', value: string): void
  (event: 'update:scope', value: TemplateScope | null): void
  (event: 'update:definitions', value: ReplacementDefinition[]): void
}>()

const rows = computed(() => templateVariables(props.template))

/** 某个变量当前的定义（没有定义 = 用命中的原文，上游那一支不调 `setReplacementDefinition`）。 */
const definedText = computed(() => new Map(props.definitions.map(item => [item.name, item.text])))

/**
 * 写一条替换定义。清空输入框 = **撤掉这一档**（表里没有这一项）；
 * 而字面量 `""` 是"替换成空"（`NamedScriptableDefinition.java:44` 的那条规则，
 * 落到 `defineReplacementVariable`），两者不是一回事，所以这里按**输入框的原文**判空。
 */
function commitDefinition(name: string, raw: string) {
  const rest = props.definitions.filter(item => item.name !== name)
  if (!raw) { emit('update:definitions', rest); return }
  emit('update:definitions', [...rest, defineReplacementVariable(name, raw)])
}

/** 该变量已经挂上的修饰符摘要行（上游 `FilterAction.getShortText` 的那一列）。 */
function summaries(constraint: VariableConstraint) {
  return modifierRows(constraint)
}

/**
 * 写回一档修饰符。`patch` 只给要改的那几项，其余沿用当前值 ——
 * 上游 `FilterTable` 改一个动作也只动对应字段（`CountFilter.java:70-71`、`TextFilter.java:62-64`）。
 */
function commit(name: string, current: VariableConstraint, patch: Partial<VariableConstraint>) {
  const next: VariableConstraint = { ...current, ...patch, name }
  emit('update:template', writeVariableModifiers(props.template, name, next))
}

/** 数字输入框里空串/0 的区别：`minOccurs` 允许 0，`maxOccurs` 的"不限"用 `UNLIMITED` 表示。 */
function numberOr(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) || parsed < 0 ? fallback : parsed
}

function onCountMin(row: { name: string; constraint: VariableConstraint }, value: string) {
  const min = numberOr(value, 1)
  const max = row.constraint.maxOccurs === UNLIMITED ? UNLIMITED : Math.max(min, row.constraint.maxOccurs)
  commit(row.name, row.constraint, { minOccurs: min, maxOccurs: max })
}

function onCountMax(row: { name: string; constraint: VariableConstraint }, value: string) {
  const max = numberOr(value, 1)
  commit(row.name, row.constraint, { maxOccurs: Math.max(row.constraint.minOccurs, max) })
}

function onUnbounded(row: { name: string; constraint: VariableConstraint }, checked: boolean) {
  commit(row.name, row.constraint, { maxOccurs: checked ? UNLIMITED : Math.max(1, row.constraint.minOccurs) })
}

function onRegexp(row: { name: string; constraint: VariableConstraint }, value: string) {
  // 清空文本 = 撤掉这一档（上游 `TextFilter.java:62-64` 的 clearFilter 恰好清这三项）。
  if (!value) {
    commit(row.name, row.constraint, { regexp: null, invertRegExp: false, wholeWordsOnly: false })
    return
  }
  commit(row.name, row.constraint, { regexp: value })
}

/**
 * 「取反」一律走模型那一条翻转规则（`toggleInvert`）：上游的写法是条件文本里的 `!` 前缀
 * （`StringToConstraintsTransformer.java:397` → `:426` 的 `setInvertRegExp(invert)`），
 * UI 侧是 `invert.filter=Invert modifier`（`resources/messages/SSRBundle.properties:102`，
 * 读写点在 `plugin/ui/filters/TextFilter.java:134,142-148`），
 * 而不可取反的档（`script`/`context`）上游抛 `error.cannot.invert`（同文件 `:456`/`:471`/`:478`，
 * 文案 `SSRBundle.properties:271`）。本仓不在这里另写一套取反规则，免得面板与解析器两处口径分叉。
 */
const invertError = ref('')

function flippedInvert(id: string, current: boolean): boolean | null {
  const flipped = toggleInvert({ id, argument: '', invert: current })
  if ('error' in flipped) {
    invertError.value = flipped.error
    return null
  }
  invertError.value = ''
  return flipped.modifier.invert
}

function onInvertText(row: { name: string; constraint: VariableConstraint }) {
  const next = flippedInvert('regex', row.constraint.invertRegExp)
  if (next !== null) commit(row.name, row.constraint, { invertRegExp: next })
}

function onWholeWords(row: { name: string; constraint: VariableConstraint }, checked: boolean) {
  commit(row.name, row.constraint, { wholeWordsOnly: checked })
}

function onContains(row: { name: string; constraint: VariableConstraint }, value: string) {
  if (!value.trim()) {
    commit(row.name, row.constraint, { contains: null, invertContains: false })
    return
  }
  commit(row.name, row.constraint, { contains: value })
}

function onInvertContains(row: { name: string; constraint: VariableConstraint }) {
  const next = flippedInvert('contains', row.constraint.invertContains)
  if (next !== null) commit(row.name, row.constraint, { invertContains: next })
}

/** 整模板的匹配范围：文本清空就把这一档摘掉（emit null），不留一条"看着像挂了范围"的空壳。 */
function commitScope(within: string, invert: boolean) {
  const previous = props.scope
  const trimmed = within.trim()
  if (!trimmed) {
    emit('update:scope', null)
    return
  }
  emit('update:scope', { within: trimmed, invert: previous ? invert : false })
}

/** 范围档的取反也走同一条翻转规则（`within` 在上游是可取反的：`PatternCompiler.java:537-539` 的 NotPredicate）。 */
function onInvertScope() {
  const next = flippedInvert('within', props.scope?.invert === true)
  if (next !== null && props.scope) commitScope(props.scope.within, next)
}

// ── 「整个模板」那一行的修饰符缓冲（上游 `filters.for.whole.template.title` 那一档）──────

/** 缓冲：按下「应用到全部变量」才写回模板，中途改输入框不会一次写三遍。 */
const whole = ref({ regexp: '', invert: false, unbounded: false })

/** 缓冲 → 上游整模板行真正编辑的那四项（`contains`/`greedy` 由 `applyToWholeTemplate` 原样保留）。 */
function wholeEdit(): WholeTemplateEdit {
  return {
    minOccurs: 1,
    maxOccurs: whole.value.unbounded ? UNLIMITED : 1,
    regexp: whole.value.regexp.trim() || null,
    invertRegExp: whole.value.invert,
    wholeWordsOnly: false,
  }
}

/** 缓冲与当前模板不一致才允许应用（一致时按钮禁用，不制造"点了但什么都没改"的假控件）。 */
const wholeEditable = computed(() => {
  if (!rows.value.length) return false
  return applyToWholeTemplate(props.template, wholeEdit()) !== props.template
})

function onInvertWhole() {
  const next = flippedInvert('regex', whole.value.invert)
  if (next !== null) whole.value.invert = next
}

function applyWhole() {
  if (!wholeEditable.value) return
  emit('update:template', applyToWholeTemplate(props.template, wholeEdit()))
}

/**
 * 底部那行「没有落点的档」：语法树/类型/脚本那一族（`UNAVAILABLE_FILTERS`）+
 * 条件文本里的档（`unsupportedModifiers()`）+ 面板级的开关档（`unavailableSwitches()`，
 * 上游 `MatchOptions` 里那几个我们兑现不了的 boolean 位）。
 * 只出说明文字、不画控件 —— 这是本仓的铁律。
 */
const unavailability = computed(() => [
  ...UNAVAILABLE_FILTERS,
  ...unsupportedModifiers().map(item => ({ name: item.label, reason: item.reason })),
  ...unavailableSwitches().map(item => ({ name: item.label, reason: item.reason })),
])
</script>

<template>
  <section class="ssf" aria-label="结构化模板修饰符">
    <header class="ssf-head">
      <span class="ssf-title">修饰符</span>
      <span class="ssf-hint">改一项就写回模板一次（与手打 <code>$x$[regex(…)]</code> 后缀同一条编译通道）</span>
    </header>

    <div v-for="row in rows" :key="row.name" class="ssf-row" :class="{ broken: row.broken }">
      <div class="ssf-var">
        <code class="ssf-var-name">${{ row.name }}$</code>
        <span v-if="row.occurrences > 1" class="ssf-occ" :title="'该变量在模板里出现 ' + row.occurrences + ' 次，修饰符只能写在第一处'">×{{ row.occurrences }}</span>
      </div>
      <ul class="ssf-summary">
        <li v-for="item in summaries(row.constraint)" :key="item.filter" :class="{ isdefault: item.isDefault }">
          <span class="ssf-filter">{{ item.filter }}</span><span class="ssf-label">{{ item.label }}</span>
        </li>
      </ul>
      <fieldset class="ssf-controls">
        <legend class="ssf-legend">计数</legend>
        <label class="ssf-field"><span>最少</span><input type="number" min="0" step="1" :value="String(row.constraint.minOccurs)" aria-label="最少出现次数" @input="onCountMin(row, ($event.target as HTMLInputElement).value)" /></label>
        <label class="ssf-field"><span>最多</span><input type="number" min="0" step="1" :value="row.constraint.maxOccurs === 0 ? '0' : String(row.constraint.maxOccurs)" :disabled="row.constraint.maxOccurs === UNLIMITED" aria-label="最多出现次数" @input="onCountMax(row, ($event.target as HTMLInputElement).value)" /></label>
        <label class="ssf-check"><input type="checkbox" :checked="row.constraint.maxOccurs === UNLIMITED" aria-label="最多次数不限" @change="onUnbounded(row, ($event.target as HTMLInputElement).checked)" /><span>不限</span></label>
      </fieldset>
      <fieldset class="ssf-controls">
        <legend class="ssf-legend">文本</legend>
        <input class="ssf-text" type="text" spellcheck="false" :value="row.constraint.regexp ?? ''" placeholder="名字要整体匹配的正则，留空即不限制" aria-label="变量名字正则" @input="onRegexp(row, ($event.target as HTMLInputElement).value)" />
        <label class="ssf-check"><input type="checkbox" :checked="row.constraint.invertRegExp" :disabled="!row.constraint.regexp" aria-label="取反名字正则" @change="onInvertText(row)" /><span>取反</span></label>
        <label class="ssf-check"><input type="checkbox" :checked="row.constraint.wholeWordsOnly" :disabled="!row.constraint.regexp" aria-label="全词匹配" @change="onWholeWords(row, ($event.target as HTMLInputElement).checked)" /><span>全字</span></label>
      </fieldset>
      <fieldset class="ssf-controls">
        <legend class="ssf-legend">包含</legend>
        <input class="ssf-text" type="text" spellcheck="false" :value="row.constraint.contains ?? ''" placeholder="捕获段里还要含的子模板" aria-label="包含子模板" @input="onContains(row, ($event.target as HTMLInputElement).value)" />
        <label class="ssf-check"><input type="checkbox" :checked="row.constraint.invertContains" :disabled="!row.constraint.contains" aria-label="取反包含条件" @change="onInvertContains(row)" /><span>取反</span></label>
      </fieldset>
      <p v-if="row.broken" class="ssf-warn">这一行的后缀读不动，编译错误见上方提示；此时面板不再往同一段后面叠写。</p>
    </div>

    <div class="ssf-row ssf-whole">
      <div class="ssf-var"><code class="ssf-var-name">整个模板</code></div>
      <fieldset class="ssf-controls">
        <legend class="ssf-legend">匹配范围</legend>
        <input class="ssf-text" type="text" spellcheck="false" :value="scope?.within ?? ''" placeholder="整段命中必须落在其中的子模板" aria-label="匹配范围子模板" @input="commitScope(($event.target as HTMLInputElement).value, scope?.invert ?? false)" />
        <label class="ssf-check"><input type="checkbox" :checked="scope?.invert === true" :disabled="!scope" aria-label="取反匹配范围" @change="onInvertScope" /><span>取反</span></label>
      </fieldset>
      <!-- 「Modifiers for the whole template」（`filters.for.whole.template.title`，`SSRBundle.properties:90`，
           树顶那一行的渲染点在 `plugin/ui/filters/FilterPanel.java:339`）：上游选中整模板那一行时
           `FilterTable.getMatchVariable()`（`FilterTable.java:22-25`）把编辑对象换成**全部变量**，
           本仓的等价物就是 `applyToWholeTemplate` 一次写回所有变量的后缀。
           模板里没有变量时整节不渲染（没有可写的对象，画出来就是假控件）。 -->
      <fieldset v-if="rows.length" class="ssf-controls">
        <legend class="ssf-legend">整模板</legend>
        <input class="ssf-text" type="text" spellcheck="false" :value="whole.regexp" placeholder="给全部变量的名字正则，留空即不限制" aria-label="整模板名字正则" @input="whole.regexp = ($event.target as HTMLInputElement).value" />
        <label class="ssf-check"><input type="checkbox" :checked="whole.invert" :disabled="!whole.regexp" aria-label="取反整模板正则" @change="onInvertWhole" /><span>取反</span></label>
        <label class="ssf-check"><input type="checkbox" :checked="whole.unbounded" aria-label="全部变量不限次数" @change="whole.unbounded = ($event.target as HTMLInputElement).checked" /><span>不限次数</span></label>
        <button class="ssf-apply" type="button" :disabled="!wholeEditable" :title="wholeEditable ? '' : '整模板档与当前后缀一致，没有要写的改动'" @click="applyWhole">应用到全部变量</button>
      </fieldset>
    </div>

    <!-- 逐变量替换定义（上游 `ReplaceOptions.variableDefs` 那张表，`plugin/replace/ReplaceOptions.java:25`；
         定义值上游是脚本求结果，本仓取用户直接写的文本，`""` 当空串这条规则在
         `NamedScriptableDefinition.java:44`）。替换框为空时**整节不渲染** —— 上游的替换档也只存在于替换模式。 -->
    <div v-if="replaceable" class="ssf-row ssf-defs">
      <div class="ssf-var"><code class="ssf-var-name">替换定义</code></div>
      <fieldset v-for="row in rows" :key="`def-${row.name}`" class="ssf-controls">
        <legend class="ssf-legend">${{ row.name }}$</legend>
        <input class="ssf-text" type="text" spellcheck="false"
               :value="definedText.has(row.name) ? definedText.get(row.name) : ''"
               :class="{ defined: definedText.has(row.name) }"
               placeholder="留空 = 用命中的原文；写两个引号 = 替换成空（删掉这一段）" :aria-label="`$${row.name}$ 的替换文本`" @input="commitDefinition(row.name, ($event.target as HTMLInputElement).value)" />
      </fieldset>
    </div>

    <p v-if="invertError" class="ssf-warn ssf-warn-global">{{ invertError }}</p>

    <p class="ssf-absent">
      没有落点的档（不画控件）：<span v-for="item in unavailability" :key="item.name" class="ssf-absent-item">{{ item.name }}：{{ item.reason }}</span>
    </p>
  </section>
</template>

<style scoped>
.ssf { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line); background: var(--panel); }
.ssf-head { display: flex; align-items: baseline; gap: var(--space-2); font-size: 11px; color: var(--secondary); }
.ssf-title { font-weight: 600; color: var(--text); }
.ssf-hint { color: var(--muted); }
.ssf-row { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 2px var(--space-2); align-items: center; padding: var(--space-1) 0; border-top: 1px solid var(--line); }
.ssf-row.broken .ssf-var-name { color: var(--error); }
.ssf-var { display: flex; align-items: center; gap: var(--space-1); min-width: 0; }
.ssf-var-name { font: 12px/1.4 var(--font-mono); color: var(--text); }
.ssf-occ { font-size: 11px; color: var(--muted); cursor: help; }
.ssf-summary { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0; list-style: none; font-size: 11px; color: var(--muted); }
.ssf-summary li { display: inline-flex; gap: var(--space-1); align-items: baseline; }
.ssf-summary li.isdefault .ssf-label { color: var(--muted); font-style: italic; }
.ssf-filter { color: var(--secondary); }
.ssf-label { font-family: var(--font-mono); color: var(--text); }
.ssf-controls { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2); min-width: 0; margin: 0; padding: 0; border: 0; }
.ssf-legend { float: left; width: 44px; padding: 0; margin-right: var(--space-1); font-size: 11px; color: var(--secondary); }
.ssf-field { display: inline-flex; align-items: center; gap: var(--space-1); font-size: 11px; color: var(--muted); }
.ssf-field input, .ssf-text { height: var(--ctrl-height-sm); box-sizing: border-box; padding: 0 var(--space-1); font: 12px/1.4 var(--font-mono); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); }
.ssf-field input { width: 46px; }
.ssf-text { flex: 1 1 160px; min-width: 120px; }
.ssf-check { display: inline-flex; align-items: center; gap: var(--space-1); font-size: 11px; color: var(--muted); }
.ssf-check input { width: auto; margin: 0; }
.ssf-check input:disabled + span { color: var(--line-strong); }
.ssf-warn { grid-column: 2; margin: 0; font-size: 11px; color: var(--error); }
.ssf-warn-global { grid-column: unset; }
.ssf-defs { align-items: start; }
.ssf-text.defined { border-color: var(--accent); }
.ssf-absent { margin: 0; font-size: 11px; color: var(--muted); }
.ssf-absent-item { display: block; padding-left: var(--space-3); }
</style>
