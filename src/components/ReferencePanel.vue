<script setup lang="ts">
// 引用（IDEA 的 Find 窗口里那条用法视图 Content）的**内容组件**。
//
// 为什么现在才有这一份：行模型（`src/usageViewGrouping.ts` 的 `UsageTreeRow`）与它的宿主状态
// （`src/referenceContents.ts` 的 `referenceRows` / `toggleUsageGroup` / 展开折叠 / 速度搜索串）
// 上一轮就做完了，但工具窗口宿主 `ToolWindowView.vue` 的视图链里**没有 `references` 这一支**，
// 于是那一棵分组树没有渲染点，界面上仍是 `src/App.vue` 里那张平表。
// 本组件补的就是那个渲染点：它**不持有任何状态**（行、折叠态、过滤串都从 props 进来，动作往上抛），
// 与 `OutlinePanel.vue` / `ProblemsPanel.vue` 同一分工。
//
// 上游对照（本机参考树，逐行开过）：
//   · 一条 Content = 一个用法视图组件：`platform/usageView-impl/src/com/intellij/usages/impl/UsageViewImpl.java:1651-1654`
//     （`getComponent()` 交出去的就是那个根面板），挂进 Content 由
//     `platform/usageView-impl/src/com/intellij/usages/impl/UsageViewManagerImpl.java:145-163` 做
//     （`addContent(...)` → `((UsageViewImpl)usageView).setContent(content)`，同一文件 `:1667-1670`）。
//   · 工具条上那两条展开/折叠：`UsageViewImpl.java:1081-1082`
//     （`createExpandAllAction` / `createCollapseAllAction`，工具条本体从 `:988` 的 `createActionsToolbar()` 起）。
//   · 速度搜索取的是节点的 **plain text**：`UsageViewImpl.java:977-985`
//     （`installTreeSpeedSearch(…, getPlainTextForNode)`）。本仓这一档是**过滤**而不是跳转，
//     差异与理由写在 `src/usageViewGrouping.ts` 的 `filterUsageTree` 头上，这里只接它筛出来的行。
//   · 组行的计数 = `usage.view.counter`（`platform/usageView/resources/messages/UsageViewBundle.properties:131`），
//     叶子的位置文本 = 1 基 `行:列`（本仓 `usagePositionText`）。
//   · 空结果的文案 = `usages.n` 的 `0#no usages` 那一档（同文件 `:8`），走 `usagesFoundText(0)`。
//   · 「正在查找…」这一行：标签条上早就这么写了（`src/App.vue` 的引用标签 `tab.searching ? '正在查找…'`），
//     上游那条 Content 在搜索期间确实在（`platform/lang-impl/src/com/intellij/usageView/impl/UsageViewContentManagerImpl.java:152`
//     把组件交进去挂着，靠 `UsageView.isSearchInProgress()`（同文件 `:170-172`）免于被下一次搜索顶替），
//     所以这不是本仓自造的形态。
//
// 样式：`.ref-list / .ref-item / .ref-path / .ref-pos / .ref-empty` 用 `src/style.css:1155-1160` 那五条
// 既有全局规则（与平表时代**同一个外观**，也不留孤儿 CSS）；只给新出现的行结构（缩进、折叠箭头、工具条）
// 写 scoped 样式。原接线请求（`docs/wiring-requests-2026-10-06-hier3.md` §3）让复用 `.outline-filter`，
// 实际那一类是 `OutlinePanel.vue` 的 **scoped** 类、跨组件不生效 ⇒ 这里自带 `.ref-search`。
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, FileCode2 } from 'lucide-vue-next'
import { usagesFoundText, type UsageTreeRow } from '../usageViewGrouping.ts'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  /** 当前选中那条内容的行（`src/referenceContents.ts` 的 `referenceRows`：已摊平、已按折叠态与过滤串筛过）。 */
  rows: UsageTreeRow[]
  /** 那条内容的引用总条数（Content 的 payload 长度）—— 用来区分「真的没有用法」与「过滤串一条都不剩」。 */
  count: number
  /** 面板的过滤串（`referencesSpeedSearch`）。 */
  query: string
  /** `UsageView.isSearchInProgress()`：还在搜的时候行是空的，那时要说的是「正在查找」。 */
  searching: boolean
}>()

const emit = defineEmits<{
  /** 单击一条引用 = 跳到那个位置（口径与平表时代一字不差：行 0 基、列给编辑器要的 1 基）。 */
  open: [target: { path: string; line: number; column: number }]
  /** 组行的折叠开关（折叠集按内容 id 分档，住在 `src/referenceContents.ts`）。 */
  'toggle-group': [key: string]
  'collapse-all': []
  'expand-all': []
  'speed-search': [value: string]
}>()

// 组行整行的动作就是那个箭头按钮的动作（上游树节点靠点击展开/折叠，本仓这张行列表没有选择态，
// 单击即切换 —— 画一行点了不动的组行才是假控件）。叶子仍是单击导航。
function activate(row: UsageTreeRow) {
  if (row.kind === 'usage') {
    emit('open', { path: row.path, line: row.line, column: row.character + 1 })
    return
  }
  emit('toggle-group', row.key)
}

// 空态的三档：还在搜 / 一条引用都没有 / 有引用但过滤串一条不剩。
// 第三档的文案是本仓自造的（上游的速度搜索是**跳转**不是过滤，压根没有"过滤后为空"这个形态），
// 前两档都有出处（见文件头）。
function emptyText(): string {
  if (props.searching) return '正在查找…'
  return props.count ? '没有匹配的引用。' : usagesFoundText(0)
}
</script>

<template>
  <div class="reference-panel">
    <div class="ref-toolbar">
      <button class="icon-button" title="全部展开" aria-label="全部展开" :disabled="!rows.length" @click="emit('expand-all')"><ChevronsUpDown :size="iconSize.dense" /></button>
      <button class="icon-button" title="全部折叠" aria-label="全部折叠" :disabled="!rows.length" @click="emit('collapse-all')"><ChevronsDownUp :size="iconSize.dense" /></button>
      <input class="ref-search" :value="query" placeholder="过滤引用…" aria-label="过滤引用" spellcheck="false"
             @input="emit('speed-search', ($event.target as HTMLInputElement).value)" />
    </div>
    <div class="ref-list" role="list" aria-label="符号引用">
      <p v-if="!rows.length" class="ref-empty">{{ emptyText() }}</p>
      <div v-for="(row, index) in rows" v-else :key="`${row.key}:${index}`" class="ref-row" role="listitem"
           :style="{ paddingLeft: `${row.depth * 12 + 6}px` }">
        <button v-if="row.collapsible" class="ref-caret" :aria-expanded="!row.collapsed" :title="row.toggleLabel" :aria-label="row.toggleLabel" @click.stop="emit('toggle-group', row.key)">
          <ChevronRight v-if="row.collapsed" :size="iconSize.dense" /><ChevronDown v-else :size="iconSize.dense" />
        </button>
        <span v-else class="ref-caret ref-caret-empty" aria-hidden="true" />
        <button class="ref-item" :title="row.kind === 'usage' ? `${row.path}:${row.line + 1}:${row.character + 1}` : row.toggleLabel" @click="activate(row)">
          <FileCode2 v-if="row.kind === 'usage'" :size="iconSize.menu" />
          <span class="ref-path" :title="row.path">{{ row.label }}</span>
          <span v-if="row.detail" class="ref-pos">{{ row.detail }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reference-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
.ref-toolbar { display: flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--line); }
.ref-search { flex: 1; min-width: 0; min-height: 22px; padding: 2px var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: 11px; }
.ref-search:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.ref-row { display: flex; align-items: center; gap: 2px; min-width: 0; }
.ref-row .ref-item { padding-left: 0; }
.ref-caret { display: inline-flex; align-items: center; justify-content: center; width: 14px; flex-shrink: 0; border: 0; padding: 0; background: transparent; color: var(--muted); cursor: pointer; }
.ref-caret:hover { color: var(--bright); }
.ref-caret-empty { cursor: default; }
</style>
