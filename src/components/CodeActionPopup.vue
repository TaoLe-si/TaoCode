<script setup lang="ts">
// Alt+Enter 的**意图 / 快速修复弹层**（上游 `ShowIntentionActionsHandler` 打开、由 `IntentionListStep`
// 填内容的那张 list popup）。
//
// 为什么要有这个组件：`src/App.vue` 是登记过的组装层（2706 行 / 上限 2737，只剩 31 行余量），
// 装配逻辑进不了它；而弹层真正的规则（档位顺序 / 分隔线 / 不可选）早就在 `src/intentionList.ts`
// 里有一份纯函数实现，缺的是把 `LspCodeAction[]` 喂进去的宿主形状与键盘落点 —— 前者在
// `src/codeActionPopupModel.ts`，后者在这个文件里。
//
// 分工：本组件**不请求、不写盘、不解释动作**。载荷原样抛回宿主的 `applyCodeAction`
// （`src/semanticActions.ts:522`），列表由 `openCodeActions`（同文件 `:432-489`）算好后传进来。
// 行菜单那一路（`src/components/IntentionListMenu.vue`）用的是同一份规则、另一个载荷形状。
//
// 上游坐标与「为什么这里没有更多/固定/设置那三行、没有子菜单、没有速度搜索、没有
// Alt+Enter 再按循环下一条」——全部登记在 docs/batch-2026-10-06-codeactionpopup.md §2。
// 简短版：`IntentionActionList` 一族与 `HighSeverityQuickFix` / `ActionIntentionAction`
// 在这份基准树里 0 命中；子菜单要"动作带子动作"的输入而 `LspCodeAction` 没有；
// Esc 已由宿主的全局捕获期监听接走（`src/App.vue:1954` → `src/keymap.ts:223`）。
import { computed, nextTick, ref, watch } from 'vue'
import { Sparkles } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import type { LspCodeAction } from '../bridge.ts'
import { separatorAbove } from '../intentionList.ts'
import { codeActionPopupRows, firstSelectableRow, moveRowSelection } from '../codeActionPopupModel.ts'

const props = defineProps<{ actions: readonly LspCodeAction[]; path: string }>()
const emit = defineEmits<{ apply: [action: LspCodeAction] }>()

/** 那张扁平行表：先所有修复、后所有意图，空档不占位，不可选的那几条带着理由在场。 */
const rows = computed(() => codeActionPopupRows(props.actions))

const box = ref<HTMLElement>()
/**
 * 当前选中的行。初始值是**第一条可选的行**，不是第 0 行
 * （上游 `ListPopupImpl.java:267-274` 的 `selectFirstSelectableItem()`）；
 * 全表都不可选时是 `-1` —— 那时候一行都不该带选中底，否则读起来像"回车会应用它"。
 */
const selected = ref(firstSelectableRow(rows.value))
void nextTick(() => box.value?.focus())

/**
 * 弹层开着的时候列表会被换掉（连着按两次 Alt+Enter 走的就是这条路：`v-if="actionPrompt"` 不变、
 * 只有 `codeActions` 换 ⇒ 组件不重建，`selected` 会指向一条已经不存在的行）。
 * 这一句把选中压回**仍然有效**的位置；无效才动，有效就不抢用户的选中。
 * 同一件事的本仓既有写法：`SelectInPopup.vue:25-28`；上游对应的是模型 sync 之后重判选中
 * （`ListPopupImpl.java:700-704`）。
 */
watch(rows, list => {
  const current = list[selected.value]
  if (!current || !current.selectable) selected.value = firstSelectableRow(list)
})

function pick(row: { selectable: boolean; payload: LspCodeAction } | undefined) {
  // 不可选的行：Enter 与鼠标都走不到这里（`<button disabled>` 不派发 click），
  // 这一句是给"以后有人加了别的调用点"兜底的，不是装饰。
  if (!row || !row.selectable) return
  emit('apply', row.payload)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') { event.preventDefault(); selected.value = moveRowSelection(rows.value, selected.value, 1); return }
  if (event.key === 'ArrowUp') { event.preventDefault(); selected.value = moveRowSelection(rows.value, selected.value, -1); return }
  if (event.key === 'Enter') { event.preventDefault(); pick(rows.value[selected.value]); return }
  // Esc 与 Tab 都**不**在这里处理：
  //   · Esc 归宿主的全局捕获期监听（`src/App.vue:1954` → `src/keymap.ts:223`），这里再拦一次
  //     就是两条路关同一个弹层，还得多要一个 emit；
  //   · Tab 要让给 backdrop 上的 `trapFocus`（所以本处理器不能 `.stop` 冒泡）。
}
</script>

<template>
  <section ref="box" class="command-palette" role="dialog" aria-modal="true" aria-label="代码操作" tabindex="-1"
           @keydown="onKeydown">
    <div class="palette-scope">代码操作 / 快速修复 · {{ path }}</div>
    <div class="palette-results" role="listbox" aria-label="代码操作">
      <template v-for="(row, index) in rows" :key="row.key">
        <!-- 组变了才有一条线（上游 `IntentionListStep.java:295-309` 的 `getSeparatorAbove()`），
             同组内不画。行菜单那一路还带段标题，上游只有线没有标题，弹层这一路按上游只画线。 -->
        <div v-if="separatorAbove(rows, index)" class="code-action-sep" role="separator" />
        <button class="code-action-row" :class="{ highlighted: index === selected }" role="option"
                :aria-selected="index === selected" :disabled="!row.selectable"
                :title="row.selectable ? undefined : row.reason" @click="pick(row)">
          <Sparkles aria-hidden="true" :size="iconSize.toolbar" />
          <span>{{ row.payload.title }}</span>
          <span v-if="row.payload.kind" class="small-muted">{{ row.payload.kind }}</span>
          <span v-if="row.payload.command" class="small-muted">由语言服务执行</span>
          <span v-else-if="!row.payload.edits.length" class="small-muted">需解析</span>
        </button>
      </template>
    </div>
  </section>
</template>

<style scoped>
/* 换档那一条线：与行菜单/日志菜单同一口径（`.intention-menu-sep` / `.log-menu-separator`），
   颜色取令牌，不写死 hex，也不加全局选择器。 */
.code-action-sep { height: 1px; margin: var(--space-1) 0; background: var(--line-strong); }
/* 不可选那一档：全局 `button:disabled`（style.css:55）已经把它淡化，但
   `.palette-results > button:hover`（style.css:1020）会照样高亮，读起来像"能点"。
   这里按本仓既有约定压回去（与 `IntentionListMenu.vue` 的 `.intention-menu-item:disabled` 同一口径）。 */
.code-action-row:disabled, .code-action-row:disabled:hover { color: var(--popup-disabled); background: transparent; }
</style>
