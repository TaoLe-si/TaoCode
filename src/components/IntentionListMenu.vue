<script setup lang="ts">
// 问题面板行菜单里的那一份**意图列表**（上游同一个弹层：修复与抑制两种行进同一张表）。
//
// 为什么要有这个组件：这三条规则（档位顺序 / 组变了画一条分隔线 / 不可选的条目照样列出来但不能点）
// 是 `src/intentionList.ts` 的纯函数，之前没有生产消费方 —— 面板把两半画成了两段、
// 顺序还与上游相反（抑制在前、修复在后），越界那条抑制也照旧画成可点的按钮。
// 上游坐标逐条开在 `src/intentionList.ts` 的文件头（`CachedIntentions.java:353-368` 的
// `getAllActions()`、`IntentionListStep.java:296-309` 的 `getSeparatorAbove()`、
// `IntentionListStep.java:102-104` → `IntentionActionWithTextCaching.java:156-162` 的 `isSelectable()`）；
// 「面板的两种对象怎么喂进来」那一段在 `src/intentionMenuModel.ts`。
//
// 本组件不请求、不写盘：载荷（`MenuIntentionFix` / `MenuIntentionOption`）由宿主算好后传进来，
// 点击原样抛回给宿主，落点还是宿主那两条既有的写入链（`applyMenuFix` / `applySuppression`）。
// 根节点是 fragment（`<template v-for>`），所以那些 `<button>` 仍是外壳 `.tree-menu` 的**直接子元素**，
// 全局的 `.tree-menu > button` 那套菜单行样式照旧命中。
import { computed } from 'vue'
import { intentionMenuItems, separatorAbove } from '../intentionList.ts'
import {
  INTENTION_MENU_GROUP_TITLES, menuIntentionFixInput, menuIntentionOptionInput,
  type MenuIntentionFix, type MenuIntentionOption,
} from '../intentionMenuModel.ts'

const props = defineProps<{ fixes: readonly MenuIntentionFix[]; options: readonly MenuIntentionOption[] }>()
const emit = defineEmits<{ applyFix: [fix: MenuIntentionFix]; applySuppression: [entry: MenuIntentionOption] }>()

/** 一行的载荷：`group` 已经判过档位，这里只用它决定点击抛给谁。 */
type MenuPayload = { kind: 'fix'; fix: MenuIntentionFix } | { kind: 'option'; option: MenuIntentionOption }

/**
 * 那张扁平行表：先所有修复、后所有意图（`intentionMenuItems` 里就是 `INTENTION_GROUP_ORDER` 的先后），
 * 空档不占位，不可选的那几条带着理由在场。
 */
const menuRows = computed(() => intentionMenuItems<MenuPayload>(
  props.fixes.map(fix => ({ ...menuIntentionFixInput(fix), payload: { kind: 'fix', fix } as MenuPayload })),
  props.options.map(entry => ({ ...menuIntentionOptionInput(entry), payload: { kind: 'option', option: entry } as MenuPayload })),
))
</script>

<template>
  <template v-for="(row, index) in menuRows" :key="row.key">
    <!-- 组变了就一条分隔线 + 本仓那一段标题（上游只有线没有标题，标题是本仓既有的排版）。 -->
    <template v-if="separatorAbove(menuRows, index)">
      <div class="intention-menu-sep" role="separator" />
      <p class="intention-menu-title">{{ INTENTION_MENU_GROUP_TITLES[row.group] }}</p>
    </template>
    <button v-if="row.payload.kind === 'fix'" class="intention-menu-item" :disabled="!row.selectable"
            :title="row.selectable ? undefined : row.reason" @click="emit('applyFix', row.payload.fix)">
      <span>{{ row.payload.fix.action.title }}</span>
      <span v-if="row.payload.fix.preview" class="small-muted">{{ row.payload.fix.preview.summary }}</span>
      <span v-else class="small-muted">{{ row.payload.fix.action.command ? '由语言服务执行' : '无编辑载荷' }}</span>
      <span v-for="(change, ci) in row.payload.fix.preview?.files[0]?.changes.slice(0, 3) ?? []" :key="ci"
            class="intention-menu-change">第 {{ change.line }} 行：{{ change.before.join(' / ') || '（空）' }} → {{ change.after.join(' / ') || '（空）' }}</span>
      <span v-if="row.payload.fix.preview && row.payload.fix.preview.changedLines > 3" class="small-muted">…共 {{ row.payload.fix.preview.changedLines }} 处</span>
    </button>
    <button v-else class="intention-menu-item" :disabled="!row.selectable"
            :title="row.selectable ? `${row.payload.option.option.title}；将插入：${row.payload.option.preview}` : row.reason"
            @click="emit('applySuppression', row.payload.option)">
      <span>{{ row.payload.option.option.title }}</span>
      <span class="small-muted">{{ row.selectable ? `将插入 ${row.payload.option.preview}` : row.reason }}</span>
    </button>
  </template>
</template>

<style scoped>
/* 与宿主行菜单同一套紧凑排布（`.tree-menu` 的壳样式在全局那一份里，这里只补本组件用到的三行）。 */
.intention-menu-title { margin: var(--space-2) 0 0; padding: 0 var(--space-3) 2px; color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }
.intention-menu-sep { height: 1px; margin: var(--space-1) 0; background: var(--line-strong); }
.intention-menu-item { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; }
/* 不可选那一档：全局 `button:disabled` 已经把它淡化，但 `.tree-menu > button:hover` 会照样高亮，
   读起来像"能点"。这里按本仓既有约定压回去（与 style.css:126 的 `.menu-item:disabled` 同一口径）。 */
.intention-menu-item:disabled, .intention-menu-item:disabled:hover { color: var(--popup-disabled); background: transparent; }
.intention-menu-change { color: var(--secondary); font: 10px/1.5 var(--font-mono); overflow-wrap: anywhere; }
</style>
