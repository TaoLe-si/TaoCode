<script setup lang="ts">
// 搁架（储藏栈）一节的视图（上游「搁架」工具窗口的 `ShelfToolWindowPanel`，见 `src/shelfTree.ts`
// 文件头）。它是 `SourceControl.vue` 里独立的一块：吃一份储藏条目、自己发动作事件，
// 面板只负责请求与刷新 —— 与 `DebugSourceLists.vue` / `ChangedHunks.vue` 同一拆分口径
// （面板贴着 900 行机检上限）。
//
// 取回只对栈顶可用（`git stash pop` 的 LIFO 语义，native 那一档没有 ref 形参）：
// 非栈顶行的按钮**灰掉并给出原因**（title），不摆一个点了没反应的假控件。
//
// 「查看差异」对**任何一条**可用：`stash@{n}` 是合法 revision，走现有 `git.showCommit`
// 通道（零 native 改动，见 `src/shelfHost.ts` 的 `show`）。差异用并排行（`sides`）渲染，
// 与 `git.diffSides` 同一形状 —— 面板这一层不再解析补丁文本。
import { Archive, ArchiveRestore, FileDiff, RefreshCw, X } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { restoreBlockedReason, SHELF_EMPTY_TEXT, SHELF_DIFF_TITLE, SHELF_TITLE, type ShelfRow } from '../shelfTree'
import type { DiffRow } from '../bridge'

const props = defineProps<{
  rows: ShelfRow[]
  busy?: boolean
  loading?: boolean
  /** 当前选中要预览的那一条（`''` = 没选）。 */
  selected?: string
  /** 当前预览的差异（null = 没开）。 */
  preview?: { ref: string; patch: string; sides: DiffRow[] } | null
  /**
   * 「查看差异」这一档**接线了没有**。宿主（`src/components/SourceControl.vue`，**别的 lane 独占**）
   * 还没把 `shelfHost.show` / `preview` 接到本组件上，所以默认 **false ⇒ 按钮整个不渲染** ——
   * 本仓的铁律是不摆点了没反应的假控件（先例：`src/toolWindowViewMode.ts` 的
   * `isViewModeRenderable`，浮层容器不在 DOM 里那一行就不出现）。宿主补一行 `:diff-enabled`
   * 之后按钮自动出现，本文件不用再改。接线请求见报告。
   */
  diffEnabled?: boolean
}>()
const emit = defineEmits<{ restore: [ref: string]; save: []; refresh: []; pop: [ref: string]; show: [ref: string]; closePreview: [] }>()

/** 一行差异的文本（左右各一格；缺的那一侧留空 —— 与 `git.diffSides` 的口径一致）。 */
function sideText(row: DiffRow): { left: string; right: string } {
  return { left: row.left?.text ?? '', right: row.right?.text ?? '' }
}
</script>

<template>
  <section class="shelf" aria-label="搁架">
    <div class="shelf-head">
      <span class="shelf-title">{{ SHELF_TITLE }}<span v-if="rows.length" class="shelf-count">{{ rows.length }}</span></span>
      <button class="icon-button" type="button" title="刷新储藏列表" aria-label="刷新储藏列表" :disabled="busy || loading" @click="emit('refresh')"><RefreshCw :size="iconSize.dense" /></button>
      <button class="icon-button" type="button" title="储藏当前更改（git stash push）" aria-label="储藏当前更改" :disabled="busy" @click="emit('save')"><Archive :size="iconSize.dense" /></button>
    </div>
    <div v-if="!rows.length" class="shelf-empty">{{ SHELF_EMPTY_TEXT }}</div>
    <div v-else class="shelf-rows" role="list">
      <div v-for="row in rows" :key="row.ref" class="shelf-row" role="listitem" :class="{ 'shelf-row-auto': row.auto, 'shelf-row-selected': row.ref === selected }">
        <span class="shelf-ref">{{ row.ref }}</span>
        <span class="shelf-branch" :title="row.branch">{{ row.branch }}</span>
        <span class="shelf-message" :title="row.message">{{ row.message }}</span>
        <button v-if="diffEnabled" class="icon-button" type="button" :title="SHELF_DIFF_TITLE"
                :aria-label="`查看 ${row.ref} 的差异`" :disabled="busy"
                @click="emit('show', row.ref)"><FileDiff :size="iconSize.dense" /></button>
        <button class="icon-button" type="button"
                :title="restoreBlockedReason(row) ?? `取回 ${row.ref}（git stash pop）`"
                :aria-label="`取回 ${row.ref}`" :disabled="busy || !row.restorable"
                @click="emit('pop', row.ref)"><ArchiveRestore :size="iconSize.dense" /></button>
      </div>
    </div>
    <!-- 差异预览：`git.showCommit` 对 `stash@{n}` 的补丁并排渲染（上游搁架树的预览面）。 -->
    <div v-if="preview" class="shelf-preview" role="region" aria-label="储藏差异">
      <div class="shelf-preview-head">
        <span class="shelf-preview-title">{{ preview.ref }}</span>
        <button class="icon-button" type="button" title="关闭差异预览" aria-label="关闭差异预览" @click="emit('closePreview')"><X :size="iconSize.dense" /></button>
      </div>
      <p v-if="!preview.sides.length" class="shelf-preview-empty">这条储藏没有可显示的差异（`git stash show` 只给已跟踪文件）。</p>
      <div v-else class="shelf-preview-rows" role="table">
        <div v-for="(row, index) in preview.sides" :key="index" class="shelf-preview-row" :class="`shelf-preview-${row.kind}`" role="row">
          <span class="shelf-preview-left" role="cell">{{ sideText(row).left }}</span>
          <span class="shelf-preview-right" role="cell">{{ sideText(row).right }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.shelf { border-top: 1px solid var(--line); }
.shelf-head { display: flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-3); }
.shelf-title { flex: 1; min-width: 0; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-size: 10px; }
.shelf-count { margin-left: var(--space-1); }
.shelf-empty { padding: var(--space-1) var(--space-3); color: var(--muted); font-size: 11px; }
.shelf-rows { border-top: 1px solid var(--line); }
.shelf-row { display: flex; align-items: center; gap: var(--space-2); padding: 2px var(--space-3); font: 11px/1.6 var(--font-mono); transition: background var(--dur-1) var(--ease); }
.shelf-row:hover { background: var(--hover); }
.shelf-row-selected { background: var(--hover); }
.shelf-ref { flex-shrink: 0; color: var(--syntax-keyword); }
.shelf-branch { flex-shrink: 0; max-width: 30%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
.shelf-message { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 自动储藏（`WIP on …`）：没有用户给的信息，整行淡一档以示区分。 */
.shelf-row-auto .shelf-message { color: var(--muted); font-style: italic; }
.shelf-preview { border-top: 1px solid var(--line); }
.shelf-preview-head { display: flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-3); }
.shelf-preview-title { flex: 1; min-width: 0; color: var(--muted); font: 11px/1.6 var(--font-mono); }
.shelf-preview-empty { padding: var(--space-1) var(--space-3); color: var(--muted); font-size: 11px; }
.shelf-preview-rows { max-height: 220px; overflow: auto; font: 11px/1.5 var(--font-mono); }
.shelf-preview-row { display: flex; gap: var(--space-2); padding: 0 var(--space-3); }
.shelf-preview-left, .shelf-preview-right { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: pre; }
.shelf-preview-insert .shelf-preview-right { color: var(--syntax-string); }
.shelf-preview-delete .shelf-preview-left { color: var(--syntax-keyword); }
</style>