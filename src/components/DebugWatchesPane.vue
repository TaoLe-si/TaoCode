<script setup lang="ts">
// 监视（Watches）列表 —— 从 `DebugPanel.vue` 抽出来的**视图 + 行级动作**，
// 上游 `XWatchesView` / `XWatchesViewImpl` 的列表那一半。
//
// 为什么单独成组件：`DebugPanel.vue` 贴着机检上限（900 行），而本批要补四个动作
// （上移/下移/全清/暂停求值，规则在 `src/debugWatchActions.ts`），塞进去就是堆砌。
// 本组件只做"给定列表与状态，渲染 + 派发"，判定全在纯函数模块里。
//
// 上游对照（`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/frame/actions/`）：
//   · `XMoveWatchUp` / `XMoveWatchDown`：选中一条时的上/下移；
//   · `XRemoveAllWatchesAction`：全清；
//   · `XPauseWatchAction`：暂停/恢复单条监视的求值（暂停保留已算出的值）。
//   · 单条移除/编辑/复制/行内监视/新增 —— 既有行为（`XRemoveWatchAction` 等）。
import { ArrowDown, ArrowUp, Eye, ListX, Pause, PenLine, Play, Copy, X } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { canMoveWatchDown, canMoveWatchUp, canPauseWatch, canRemoveAllWatches, pauseWatchActionLabel,
         type WatchEntry } from '../debugWatchActions'

const props = defineProps<{
  watches: WatchEntry[]
  limit: number
  busy: boolean
  /** 会话是否停住（行内监视/设置值需要）。 */
  paused: boolean
  /** 当前帧行号（行内监视的锚点）。 */
  frameLine: number | null
  /** 某条监视是不是已经画进编辑器（`src/debugInlineWatchSync.ts` 的状态）。 */
  inlineShown: (text: string) => boolean
  /** 正在编辑的那条（`{ key, draft }`），null = 没在编辑。 */
  editing: { key: string; draft: string } | null
  /** 新监视输入框的值。 */
  newWatch: string
}>()
const emit = defineEmits<{
  remove: [text: string]
  move: [payload: { text: string; direction: 'up' | 'down' }]
  removeAll: []
  togglePause: [text: string]
  toggleInline: [text: string]
  beginEdit: [payload: { text: string; value: string }]
  editDraft: [draft: string]
  commitEdit: [text: string]
  cancelEdit: []
  add: [text: string]
  'update:newWatch': [text: string]
  copy: [payload: { text: string; value: string; event: MouseEvent }]
}>()

function onEditInput(event: Event) { emit('editDraft', (event.target as HTMLInputElement).value) }
function onNewInput(event: Event) { emit('update:newWatch', (event.target as HTMLInputElement).value) }
</script>

<template>
  <div class="debug-section-title">
    监视（Watches）
    <span class="debug-watch-note">跨会话保存 · {{ watches.length }}/{{ limit }}</span>
    <span class="watch-actions">
      <button class="icon-button debug-set" :disabled="!canRemoveAllWatches(watches)" aria-label="移除所有监视" title="移除所有监视" @click="emit('removeAll')"><ListX :size="iconSize.dense" /></button>
    </span>
  </div>
  <div class="debug-watches">
    <div v-for="watch in watches" :key="watch.text" class="debug-row">
      <button class="chip-x" :aria-label="`移除监视 ${watch.text}`" :title="`移除监视 ${watch.text}`" @click="emit('remove', watch.text)"><X :size="iconSize.chip" /></button>
      <span class="debug-name">{{ watch.text }}</span>
      <!-- IDEA Watches 的「Set Value…」：DAP `setExpression`（表达式 + 新值）。 -->
      <template v-if="editing?.key === watch.text">
        <input :value="editing.draft" class="debug-input debug-edit-input" :aria-label="`设置 ${watch.text} 的值`" spellcheck="false" @input="onEditInput" @keydown.enter.prevent="emit('commitEdit', watch.text)" @keydown.esc.prevent="emit('cancelEdit')" />
        <button class="debug-mini" :disabled="busy" @click="emit('commitEdit', watch.text)">设置</button>
      </template>
      <template v-else>
        <span class="debug-value" :class="{ 'watch-paused': watch.paused }">{{ watch.value || '—' }}</span>
        <!-- 上移/下移（XMoveWatchUp/Down）：不是第一条/最后一条才可点。 -->
        <button class="icon-button debug-set" :disabled="!canMoveWatchUp(watches, watch.text)" :aria-label="`上移 ${watch.text}`" :title="`上移 ${watch.text}`" @click.stop="emit('move', { text: watch.text, direction: 'up' })"><ArrowUp :size="iconSize.dense" /></button>
        <button class="icon-button debug-set" :disabled="!canMoveWatchDown(watches, watch.text)" :aria-label="`下移 ${watch.text}`" :title="`下移 ${watch.text}`" @click.stop="emit('move', { text: watch.text, direction: 'down' })"><ArrowDown :size="iconSize.dense" /></button>
        <!-- 暂停/恢复求值（XPauseWatchAction）：暂停保留已算出的值，恢复触发重算。 -->
        <button class="icon-button debug-set" :disabled="!canPauseWatch(watch)" :class="{ 'inline-on': watch.paused }" :aria-pressed="watch.paused" :aria-label="`${pauseWatchActionLabel(watch)} ${watch.text}`" :title="`${pauseWatchActionLabel(watch)} ${watch.text}`" @click.stop="emit('togglePause', watch.text)"><Play v-if="watch.paused" :size="iconSize.dense" /><Pause v-else :size="iconSize.dense" /></button>
        <!-- 行内监视（上游 InlineWatch）：画进编辑器当前帧那一行的行尾；再点一次撤掉。 -->
        <button class="icon-button debug-set" :disabled="!paused || frameLine === null" :class="{ 'inline-on': inlineShown(watch.text) }" :aria-pressed="inlineShown(watch.text)" :title="inlineShown(watch.text) ? `从编辑器第 ${frameLine} 行撤下行内监视` : `在编辑器第 ${frameLine ?? 0} 行画行内监视`" :aria-label="`行内显示 ${watch.text}`" @click.stop="emit('toggleInline', watch.text)"><Eye :size="iconSize.dense" /></button>
        <button class="icon-button debug-set" :disabled="!paused" :aria-label="`设置 ${watch.text} 的值`" :title="`设置 ${watch.text} 的值`" @click="emit('beginEdit', { text: watch.text, value: watch.value })"><PenLine :size="iconSize.dense" /></button>
        <button class="icon-button debug-set" :aria-label="`复制 ${watch.text}`" :title="`复制 ${watch.text}`" @click.stop="emit('copy', { text: watch.text, value: watch.value, event: $event })"><Copy :size="iconSize.dense" /></button>
      </template>
    </div>
    <div class="debug-watch-add">
      <input :value="newWatch" list="debug-completions" class="debug-input" aria-label="新监视表达式" placeholder="监视表达式，回车添加" spellcheck="false" @input="onNewInput" @keydown.enter.prevent="emit('add', newWatch)" />
    </div>
  </div>
</template>

<style scoped>
.debug-section-title { display: flex; align-items: center; gap: var(--space-1); }
.watch-actions { margin-left: auto; display: inline-flex; }
.debug-watches { display: flex; flex-direction: column; }
.debug-row { display: flex; align-items: center; gap: var(--space-1); }
.debug-name { color: var(--text); font-family: var(--font-mono); font-size: 11px; }
.debug-value { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-family: var(--font-mono); font-size: 11px; }
.watch-paused { font-style: italic; }
.icon-button.debug-set { padding: 0 2px; background: none; border: 0; color: var(--muted); }
.icon-button.debug-set:disabled { opacity: 0.4; }
.icon-button.debug-set.inline-on { color: var(--accent); }
.debug-input { background: var(--hover); border: 1px solid var(--line); border-radius: var(--radius-xs); color: var(--text); font-size: 11px; padding: 2px var(--space-1); }
.debug-watch-add { padding: var(--space-1) 0; }
.debug-watch-add input { width: 100%; }
</style>
