<script setup lang="ts">
// 书签工具窗口（IDEA `BookmarksView` + `Bookmarks.ToolWindow.GearActions`）。
//
// 对照源码：
//   platform/bookmarks/resources/intellij.platform.bookmarks.xml:191-206
//     齿轮组 `Bookmarks.ToolWindow.GearActions`：GroupLineBookmarks / RewriteBookmarkType /
//     AskBeforeDeletingLists / ⟨分隔⟩ / OpenInPreviewTab / AutoscrollToSource / AutoscrollFromSource
//   platform/bookmarks/src/com/intellij/ide/bookmark/ui/BookmarksViewState.kt:18-31
//     这些开关的状态与默认值（groupLineBookmarks=true、autoscroll*=false …）
//   BookmarksViewFactory.kt:24-28  toolWindow.setTitleActions(...) + setAdditionalGearActions(齿轮组)
//
// TaoCode 只渲染**有真实落点**的三个开关（其余三个在源码里依赖命名书签列表 / 预览标签页 /
// 书签类型，本仓没有这些概念，登记在 docs/class-parity-todo.md，不造假开关）。
import { computed, nextTick, ref, watch } from 'vue'
import { Bookmark, Check, ListTree, Settings2, X } from 'lucide-vue-next'
import type { Bookmark as BookmarkEntry } from '../bridge'
import { bookmarkKey, groupBookmarks, scrollTargetFor, stepSelection, type BookmarksViewSettings } from '../bookmarksView'

const props = defineProps<{ entries: BookmarkEntry[]; activePath: string; settings: BookmarksViewSettings }>()
const emit = defineEmits<{
  jump: [entry: BookmarkEntry]
  remove: [entry: BookmarkEntry]
  assign: []
  updateSettings: [patch: Partial<BookmarksViewSettings>]
}>()

const gearOpen = ref(false)
const cursor = ref('')
const scrollBox = ref<HTMLDivElement>()

const folderOf = (path: string) => path.slice(0, path.length - path.split('/').pop()!.length).replace(/\/$/, '')
const groups = computed(() => groupBookmarks(props.entries, props.settings.groupLineBookmarks))
/** 可见顺序（键盘上下移动按它走，与屏幕上看到的一致）。 */
const visible = computed(() => groups.value.flatMap(group => group.entries))

// autoscrollFromSource：编辑器切到某个文件时，滚到该文件的第一条书签。
watch(() => props.activePath, async path => {
  if (!props.settings.autoscrollFromSource) return
  const target = scrollTargetFor(props.entries, path)
  if (!target) return
  cursor.value = bookmarkKey(target)
  await nextTick()
  scrollBox.value?.querySelector<HTMLElement>(`[data-key="${CSS.escape(bookmarkKey(target))}"]`)?.scrollIntoView({ block: 'nearest' })
})

function toggle(patch: Partial<BookmarksViewSettings>) { emit('updateSettings', patch) }
async function scrollIntoViewFor(entry: BookmarkEntry) {
  await nextTick()
  scrollBox.value?.querySelector<HTMLElement>(`[data-key="${CSS.escape(bookmarkKey(entry))}"]`)?.scrollIntoView({ block: 'nearest' })
}
function activate(entry: BookmarkEntry) { cursor.value = bookmarkKey(entry); emit('jump', entry) }
// 键盘导航：上/下移动选中；`autoscrollToSource` 打开时移动即跳转（IDEA 的 AutoscrollToSource 语义）。
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const next = stepSelection(visible.value, cursor.value, event.key === 'ArrowDown' ? 1 : -1)
  if (!next) return
  cursor.value = next
  const target = visible.value.find(entry => bookmarkKey(entry) === next)
  if (!target) return
  void scrollIntoViewFor(target)
  if (props.settings.autoscrollToSource) emit('jump', target)
}
</script>

<template>
  <div class="bookmark-panel">
    <div class="panel-heading">
      <span><Bookmark :size="14" />书签</span>
      <span class="heading-count">{{ entries.length }}</span>
      <!-- 齿轮：IDEA 把它放在工具窗口标题栏（ToolWindowHeader 的 ShowOptionsAction → 该窗口自己的
           gearProducer）。TaoCode 的面板标题行就是该窗口的标题区，所以齿轮放这里。 -->
      <button class="icon-button" :aria-expanded="gearOpen" aria-haspopup="menu" title="视图选项" aria-label="书签视图选项" @click.stop="gearOpen = !gearOpen"><Settings2 :size="14" /></button>
      <div v-if="gearOpen" class="bookmark-gear" role="menu" aria-label="书签视图选项">
        <button type="button" role="menuitemcheckbox" :aria-checked="settings.groupLineBookmarks" @click="toggle({ groupLineBookmarks: !settings.groupLineBookmarks })">
          <span class="gear-check"><ListTree :size="13" /></span><span>按文件分组行书签</span><span v-if="settings.groupLineBookmarks" class="gear-on"><Check :size="12" /></span>
        </button>
        <div class="gear-rule" role="separator" />
        <button type="button" role="menuitemcheckbox" :aria-checked="settings.autoscrollToSource" @click="toggle({ autoscrollToSource: !settings.autoscrollToSource })">
          <span class="gear-check" /><span>自动滚动到源代码</span><span v-if="settings.autoscrollToSource" class="gear-on"><Check :size="12" /></span>
        </button>
        <button type="button" role="menuitemcheckbox" :aria-checked="settings.autoscrollFromSource" @click="toggle({ autoscrollFromSource: !settings.autoscrollFromSource })">
          <span class="gear-check" /><span>从源代码自动滚动</span><span v-if="settings.autoscrollFromSource" class="gear-on"><Check :size="12" /></span>
        </button>
      </div>
    </div>
    <div v-if="!entries.length" class="bookmark-empty">
      <Bookmark :size="24" />
      <p>还没有书签</p>
      <span>F11 标记当前行；Ctrl+F11 贴 0-9 编号，之后在任意位置按 Ctrl+编号 跳回。</span>
      <button class="subtle-button" @click="emit('assign')">为当前行编号</button>
    </div>
    <div v-else ref="scrollBox" class="bookmark-scroll" role="list" aria-label="项目书签" tabindex="0" @keydown="onKeydown" @focus="cursor = cursor || (visible.length ? bookmarkKey(visible[0]) : '')">
      <template v-for="group in groups" :key="group.path || 'flat'">
        <!-- 分组模式下的文件标题行（IDEA 的 GroupLineBookmarks = 按文件分组） -->
        <div v-if="group.path" class="bookmark-group-head" role="presentation" :title="group.path">
          <span class="bookmark-group-name">{{ group.path.split('/').pop() }}</span>
          <span class="bookmark-group-folder">{{ folderOf(group.path) }}</span>
          <span class="bookmark-group-count">{{ group.entries.length }}</span>
        </div>
        <div v-for="entry in group.entries" :key="bookmarkKey(entry)" class="bookmark-row" role="listitem" :data-key="bookmarkKey(entry)" :class="{ 'bookmark-selected': cursor === bookmarkKey(entry) }">
          <button class="bookmark-jump" :class="{ 'bookmark-current': entry.path === activePath }"
                  :title="`${entry.path}:${entry.line}`" :aria-label="`跳转到 ${entry.path} 第 ${entry.line} 行`" @click="activate(entry)">
            <span class="bookmark-digit" :title="entry.mnemonic === undefined ? '无编号' : `Ctrl+${entry.mnemonic} 跳转`">{{ entry.mnemonic ?? '' }}</span>
            <span class="bookmark-name">{{ entry.path.split('/').pop() }}</span>
            <span v-if="!group.path" class="bookmark-folder">{{ folderOf(entry.path) }}</span>
            <span class="bookmark-line">{{ entry.line }}</span>
          </button>
          <button class="icon-button" title="移除书签" :aria-label="`移除书签 ${entry.path} 第 ${entry.line} 行`" @click="emit('remove', entry)"><X :size="13" /></button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.bookmark-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.bookmark-panel .panel-heading { position: relative; }
.heading-count { margin-left: auto; color: var(--muted); font-size: 10px; }
.bookmark-gear { position: absolute; top: 100%; right: 0; z-index: 30; display: flex; flex-direction: column; min-width: 200px; padding: 2px; border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); box-shadow: var(--popup-shadow); }
.bookmark-gear button { display: flex; align-items: center; gap: var(--space-1); padding: 3px var(--space-2); border: 0; border-radius: var(--radius-xs); background: transparent; color: var(--text); font: inherit; font-size: 12px; text-align: left; }
.bookmark-gear button:hover { background: var(--hover); }
.gear-check { width: 14px; display: inline-flex; justify-content: center; color: var(--secondary); }
.gear-on { margin-left: auto; color: var(--accent); }
.gear-rule { height: 1px; margin: 2px 0; background: var(--line); }
.bookmark-scroll { flex: 1; min-height: 0; overflow: auto; padding-bottom: var(--space-2); outline: none; }
.bookmark-scroll:focus-visible { box-shadow: inset 0 0 0 1px var(--accent); }
.bookmark-group-head { display: flex; align-items: baseline; gap: var(--space-2); padding: 4px var(--space-2) 2px; color: var(--secondary); font-size: 11px; }
.bookmark-group-name { color: var(--bright); }
.bookmark-group-folder { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 10px; }
.bookmark-group-count { color: var(--muted); font-size: 10px; }
.bookmark-row { display: flex; align-items: center; gap: 2px; padding: 0 var(--space-1) 0 0; }
.bookmark-row:hover { background: var(--hover); }
.bookmark-selected { background: var(--selected); }
.bookmark-jump { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: var(--space-2); width: 100%; padding: 3px 0 3px var(--space-3); border: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; font-size: 12px; }
.bookmark-digit { flex-shrink: 0; width: 11px; color: var(--accent); font: 10px var(--font-mono); }
.bookmark-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bookmark-folder { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 10px; }
.bookmark-line { flex-shrink: 0; color: var(--muted); font: 10px var(--font-mono); font-variant-numeric: tabular-nums; }
.bookmark-current .bookmark-name { color: var(--bright); }
.bookmark-empty { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); padding: var(--space-5) var(--space-3); color: var(--muted); font-size: 11px; line-height: 1.7; }
.bookmark-empty p { margin: 0; color: var(--secondary); font-size: 12px; }
.bookmark-empty span { max-width: 26em; }
</style>
