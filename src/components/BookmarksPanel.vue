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
import { BookMarked, Bookmark, Check, ListTree, Pencil, Plus, Settings2, X } from 'lucide-vue-next'
import type { Bookmark as BookmarkEntry } from '../bridge'
import { bookmarkDescription, isFileBookmark } from '../bookmarks'
import { bookmarkKey, groupBookmarks, scrollTargetFor, stepSelection, type BookmarksViewSettings } from '../bookmarksView'
// 「按类型和名称对书签进行排序」（上游 `SortGroupBookmarksAction`）：文案取中文包。
import { SORT_GROUP_LABEL } from '../bookmarks'
import { ArrowDownUp } from 'lucide-vue-next'
import { addBookmarkToNamedList, confirmDeleteList, listDialog, namedListNames, openCreateListDialog, panelLists, runWithChosenList } from '../bookmarkListActions.ts'
import { iconSize } from '../uiIcons'

export interface PanelList { name: string; isDefault: boolean; entries: BookmarkEntry[] }
const props = defineProps<{ entries: BookmarkEntry[]; activePath: string; settings: BookmarksViewSettings; lists?: PanelList[] }>()
const emit = defineEmits<{
  jump: [entry: BookmarkEntry]
  remove: [entry: BookmarkEntry]
  assign: []
  updateSettings: [patch: Partial<BookmarksViewSettings>]
  /** 「书签打开的标签页…」（上游 `BookmarkOpenTabs`）：宿主把所有打开的标签页加成文件书签。 */
  bookmarkTabs: []
  /** 右键菜单里的「编辑描述」：走宿主的那个对话框（`EditBookmarkAction`）。 */
  edit: [entry: BookmarkEntry]
 sortGroup: [path: string]}>()

const gearOpen = ref(false)
const cursor = ref('')
const scrollBox = ref<HTMLDivElement>()

const folderOf = (path: string) => path.slice(0, path.length - path.split('/').pop()!.length).replace(/\/$/, '')
const groups = computed(() => groupBookmarks(props.entries, props.settings.groupLineBookmarks))
/**
 * 列表分区（上游 `ManagerState.groups` 的树节点）：`lists` 给了就按它分段，每段下面再按
 * 分组设置切文件；没给就还是老样子（一段 = 全部）。默认列表带「默认」标记
 * （`default.group.marker` = 「默认」）。
 */
const sections = computed(() => {
  const live = panelLists.value
  if (live.length > 1) return live
  return props.lists?.length ? props.lists : [{ name: '', isDefault: false, entries: props.entries }]
})
/**
 * 文件书签（没有行号）与行书签分开：前者渲染成"文件那一行"（上游的 `FileNode`，
 * `providers/FileBookmarkImpl.kt:26-29` 按 isDirectory 建 FolderNode/FileNode），
 * 后者渲染成 `LineNode`。分组开着时文件书签就落在它那个组的文件行上 —— 这与 IDEA
 * "FileNode 底下挂 LineNode"是同一个形状，也避免同名两行。
 */
const fileBookmarks = computed(() => new Map(props.entries.filter(entry => entry.line === undefined).map(entry => [entry.path, entry])))
const lineEntriesOf = (group: { path: string; entries: BookmarkEntry[] }) => group.entries.filter(entry => entry.line !== undefined || !group.path)
/** 可见顺序（键盘上下移动按它走，与屏幕上看到的一致）。 */
const visible = computed(() => groups.value.flatMap(group => lineEntriesOf(group as never)))

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
/**
 * 行右键菜单 —— 上游书签节点右键那个 `popup@BookmarkContextMenu` 里本仓能真做的三条：
 * 「添加另一书签…」（`AddAnotherBookmarkAction`：加到另一张列表）、「编辑描述」（`EditBookmarkAction`，
 * 走宿主的对话框）、「移除书签」（`NodeDeleteAction`）。其余行（切换助记键/取消默认列表/移到…）
 * 需要各自的契约，登记在判决表里。
 */
const rowMenu = ref<{ x: number; y: number; entry: BookmarkEntry } | null>(null)
function openRowMenu(event: MouseEvent, entry: BookmarkEntry) {
  rowMenu.value = { x: event.clientX, y: event.clientY, entry }
}
/** 「添加另一书签…」：按上游的捷径挑列表（没有先建 / 一张直接用 / 多张弹选择）。 */
function addToAnotherList() {
  const entry = rowMenu.value?.entry
  rowMenu.value = null
  if (entry) runWithChosenList(name => addBookmarkToNamedList(name, entry))
}
/**
 * 删除列表：`askBeforeDeletingLists`（上游 `BookmarksViewState:24`，默认 **true**）开着就先弹确认
 * （文案「确定要删除 ''{0}'' 书签列表吗? 此操作无法撤消。」），关着直接删。
 */
function askDeleteList(name: string) {
  if (!props.settings.askBeforeDeletingLists) { listDialog.value = { mode: 'delete', name }; confirmDeleteList(); return }
  listDialog.value = { mode: 'delete', name }
}
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
      <span><Bookmark :size="iconSize.control" />书签</span>
      <span class="heading-count">{{ entries.length }}</span>
      <!-- 齿轮：IDEA 把它放在工具窗口标题栏（ToolWindowHeader 的 ShowOptionsAction → 该窗口自己的
           gearProducer）。TaoCode 的面板标题行就是该窗口的标题区，所以齿轮放这里。 -->
      <button class="icon-button" title="创建书签列表…" aria-label="创建书签列表" @click.stop="openCreateListDialog()"><Plus :size="iconSize.control" /></button>
      <button class="icon-button" title="书签打开的标签页…" aria-label="书签打开的标签页" @click.stop="emit('bookmarkTabs')"><BookMarked :size="iconSize.control" /></button>
      <button class="icon-button" :aria-expanded="gearOpen" aria-haspopup="menu" title="视图选项" aria-label="书签视图选项" @click.stop="gearOpen = !gearOpen"><Settings2 :size="iconSize.control" /></button>
      <div v-if="gearOpen" class="bookmark-gear" role="menu" aria-label="书签视图选项">
        <button type="button" role="menuitemcheckbox" :aria-checked="settings.groupLineBookmarks" @click="toggle({ groupLineBookmarks: !settings.groupLineBookmarks })">
          <span class="gear-check"><ListTree :size="iconSize.menu" /></span><span>按文件分组行书签</span><span v-if="settings.groupLineBookmarks" class="gear-on"><Check :size="iconSize.dense" /></span>
        </button>
        <button type="button" role="menuitemcheckbox" :aria-checked="!settings.rewriteBookmarkType" @click="toggle({ rewriteBookmarkType: !settings.rewriteBookmarkType })">
          <span class="gear-check"><ListTree :size="iconSize.menu" /></span><span>重写助记键之前询问</span><span v-if="!settings.rewriteBookmarkType" class="gear-on"><Check :size="iconSize.dense" /></span>
        </button>
        <button type="button" role="menuitemcheckbox" :aria-checked="settings.askBeforeDeletingLists" @click="toggle({ askBeforeDeletingLists: !settings.askBeforeDeletingLists })">
          <span class="gear-check"><ListTree :size="iconSize.menu" /></span><span>删除多个书签前询问</span><span v-if="settings.askBeforeDeletingLists" class="gear-on"><Check :size="iconSize.dense" /></span>
        </button>
        <div class="gear-rule" role="separator" />
        <button type="button" role="menuitemcheckbox" :aria-checked="settings.autoscrollToSource" @click="toggle({ autoscrollToSource: !settings.autoscrollToSource })">
          <span class="gear-check" /><span>自动滚动到源代码</span><span v-if="settings.autoscrollToSource" class="gear-on"><Check :size="iconSize.dense" /></span>
        </button>
        <button type="button" role="menuitemcheckbox" :aria-checked="settings.autoscrollFromSource" @click="toggle({ autoscrollFromSource: !settings.autoscrollFromSource })">
          <span class="gear-check" /><span>从源代码自动滚动</span><span v-if="settings.autoscrollFromSource" class="gear-on"><Check :size="iconSize.dense" /></span>
        </button>
      </div>
    </div>
    <div v-if="!entries.length" class="bookmark-empty">
      <Bookmark :size="iconSize.artwork" />
      <p>还没有书签</p>
      <span>F11 标记当前行；Ctrl+F11 贴 0-9 编号，之后在任意位置按 Ctrl+编号 跳回。</span>
      <button class="subtle-button" @click="emit('assign')">为当前行编号</button>
    </div>
    <div v-else ref="scrollBox" class="bookmark-scroll" role="list" aria-label="项目书签" tabindex="0" @keydown="onKeydown" @focus="cursor = cursor || (visible.length ? bookmarkKey(visible[0]) : '')">
      <template v-for="section in sections" :key="section.name || 'all'">
      <div v-if="section.name" class="bookmark-list-head" role="presentation">
        <span class="bookmark-list-name">{{ section.name }}</span>
        <span v-if="section.isDefault" class="bookmark-list-default" title="新书签会自动添加到这个列表">默认</span>
        <button v-if="section.name && !section.isDefault" class="icon-button" title="重命名书签列表…" :aria-label="`重命名书签列表 ${section.name}`" @click="listDialog = { mode: 'rename', name: section.name }"><Pencil :size="iconSize.dense" /></button>
        <button v-if="section.name && !section.isDefault" class="icon-button" title="删除书签列表" :aria-label="`删除书签列表 ${section.name}`" @click="askDeleteList(section.name)"><X :size="iconSize.menu" /></button>
        <span v-else class="bookmark-list-count">{{ section.entries.length }}</span>
      </div>
      <template v-for="group in groupBookmarks(section.entries, props.settings.groupLineBookmarks)" :key="(section.name || 'all') + ':' + (group.path || 'flat')">
        <!-- 分组模式下的文件标题行（IDEA 的 GroupLineBookmarks = 按文件分组） -->
        <div v-if="group.path" class="bookmark-group-head" :role="fileBookmarks.get(group.path) ? 'listitem' : 'presentation'" :title="group.path">
          <button v-if="fileBookmarks.get(group.path)" class="bookmark-group-name bookmark-file-open" :title="`打开 ${group.path}${bookmarkDescription(fileBookmarks.get(group.path)!) ? '：' + bookmarkDescription(fileBookmarks.get(group.path)!) : ''}`" @click="activate(fileBookmarks.get(group.path)!)">{{ group.path.split('/').pop() }}</button>
          <span v-else class="bookmark-group-name">{{ group.path.split('/').pop() }}</span>
          <span class="bookmark-group-folder">{{ folderOf(group.path) }}</span>
          <span v-if="fileBookmarks.get(group.path)?.mnemonic !== undefined" class="bookmark-digit" :title="`Ctrl+${fileBookmarks.get(group.path)?.mnemonic} 跳转`">{{ fileBookmarks.get(group.path)?.mnemonic }}</span>
          <button v-if="fileBookmarks.get(group.path)" class="icon-button" title="移除书签" :aria-label="`移除书签 ${group.path}`" @click="emit('remove', fileBookmarks.get(group.path)!)"><X :size="iconSize.menu" /></button>
          <span v-else class="bookmark-group-count">{{ group.entries.length }}</span>
          <!-- 「按类型和名称对书签进行排序」（上游 `SortGroupBookmarksAction`，组节点的右键动作）：
               文案取随 IDE 发货的中文包 `ActionsBundle.properties:76`。只在这一组 ≥ 2 条时才有意义。 -->
          <button v-if="group.entries.length > 1" class="icon-button" :title="SORT_GROUP_LABEL" :aria-label="`${SORT_GROUP_LABEL} ${group.path}`" @click="emit('sortGroup', group.path)"><ArrowDownUp :size="iconSize.dense" /></button>
        </div>
        <div v-for="entry in lineEntriesOf(group)" :key="bookmarkKey(entry)" class="bookmark-row" role="listitem" :data-key="bookmarkKey(entry)" :class="{ 'bookmark-selected': cursor === bookmarkKey(entry) }" @contextmenu.prevent.stop="openRowMenu($event, entry)">
          <button class="bookmark-jump" :class="{ 'bookmark-current': entry.path === activePath }"
                  :title="`${entry.path}:${entry.line}`" :aria-label="`跳转到 ${entry.path} 第 ${entry.line} 行${bookmarkDescription(entry) ? `：${bookmarkDescription(entry)}` : ''}`" @click="activate(entry)">

            <!-- 分组在文件下：`"行号: "` 灰 + 描述（那一行原文）常规体 —— 逐条照 `ui/tree/LineNode.kt:20-31`。
                 行号直接用 `entry.line`：上游那份要多一次 `+1`（`LineNode.kt:21`）是因为 IDEA 存 0 基，
                 本仓存的就是 1 基（见 `src/bookmarks.ts` 的注释）。 -->
            <template v-if="group.path">
              <span class="bookmark-line">{{ entry.line }}:</span>
              <span v-if="bookmarkDescription(entry)" class="bookmark-detail">{{ bookmarkDescription(entry) }}</span>
            </template>
            <!-- 不分组：有描述就先描述、文件名退成灰体再加 ` :行号`（`BookmarkNode.kt:78-83`）；
                 没有描述则文件名 + ` :行号` + 位置（`:72-77`）。 -->
            <template v-else>
              <span v-if="bookmarkDescription(entry)" class="bookmark-detail">{{ bookmarkDescription(entry) }}</span>
              <span class="bookmark-name" :class="{ 'bookmark-name-muted': bookmarkDescription(entry) !== undefined }">{{ entry.path.split('/').pop() }}</span>
              <span class="bookmark-folder">{{ folderOf(entry.path) }}</span>
              <span v-if="entry.line !== undefined" class="bookmark-line">:{{ entry.line }}</span>
            </template>
            <!-- 助记键在**右侧附件位**（上游 `BookmarkItem.updateAccessoryView:92-99` 把编号写进
                 那个 JLabel = 树的 accessory），所以它在行尾而不是行首。 -->
            <span v-if="entry.mnemonic !== undefined" class="bookmark-digit" :title="`Ctrl+${entry.mnemonic} 跳转`">{{ entry.mnemonic }}</span>
          </button>
          <button class="icon-button" title="移除书签" :aria-label="`移除书签 ${entry.path} 第 ${entry.line} 行`" @click="emit('remove', entry)"><X :size="iconSize.menu" /></button>
        </div>
      </template>
      </template>
    </div>
    <div v-if="rowMenu" class="bookmark-row-menu-backdrop" @pointerdown="rowMenu = null" @contextmenu.prevent="rowMenu = null">
      <div class="bookmark-row-menu" role="menu" :style="{ left: `${rowMenu.x}px`, top: `${rowMenu.y}px` }" @pointerdown.stop>
        <!-- 「添加另一书签…」上游对**行**书签是隐藏的（`AddAnotherBookmarkAction.update:16-19`
             的 `if (bookmark is LineBookmark) return false`）：行书签只有一个家，能进多张列表的是
             **文件**书签。本仓的运行时也会把行书签"搬"过去（`addBookmarkToNamedList` 先摘默认列表），
             但那是上游另一个动作的语义，所以这里按上游把这一行只留给文件书签。 -->
        <button v-if="isFileBookmark(rowMenu.entry)" role="menuitem" @click="addToAnotherList()">添加另一书签…</button>
        <button role="menuitem" @click="emit('edit', rowMenu.entry); rowMenu = null">编辑描述</button>
        <div class="menu-rule" role="separator" />
        <button role="menuitem" @click="activate(rowMenu.entry); rowMenu = null">转到书签</button>
        <button role="menuitem" @click="emit('remove', rowMenu.entry); rowMenu = null">移除书签</button>
      </div>
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
.bookmark-row-menu-backdrop { position: fixed; inset: 0; z-index: 60; }
.bookmark-row-menu { position: absolute; display: flex; flex-direction: column; min-width: 160px; padding: 2px; border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); box-shadow: var(--popup-shadow); }
.bookmark-row-menu button { padding: 4px var(--space-2); border: 0; border-radius: var(--radius-xs); background: transparent; color: var(--text); font: inherit; font-size: 12px; text-align: left; }
.bookmark-row-menu button:hover { background: var(--hover); }
.bookmark-list-head { display: flex; align-items: baseline; gap: var(--space-2); padding: 5px var(--space-2) 3px; border-top: 1px solid var(--line); color: var(--bright); font-size: 11px; font-weight: 600; }
.bookmark-list-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bookmark-list-default { padding: 0 4px; border: 1px solid var(--line-strong); border-radius: var(--radius-xs); color: var(--muted); font-size: 9px; font-weight: 400; }
.bookmark-list-count { margin-left: auto; color: var(--muted); font-size: 10px; font-weight: 400; }
.bookmark-group-head { display: flex; align-items: baseline; gap: var(--space-2); padding: 4px var(--space-2) 2px; color: var(--secondary); font-size: 11px; }
.bookmark-group-name { color: var(--bright); }
.bookmark-group-folder { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 10px; }
.bookmark-group-count { color: var(--muted); font-size: 10px; }
.bookmark-row { display: flex; align-items: center; gap: 2px; padding: 0 var(--space-1) 0 0; transition: background-color var(--dur-1) var(--ease); }
.bookmark-row:hover { background: var(--hover); }
.bookmark-selected { background: var(--selected); }
.bookmark-jump { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: var(--space-2); width: 100%; padding: 3px 0 3px var(--space-3); border: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; font-size: 12px; }
/* 右侧附件位（`updateAccessoryView` 把编号放在那）：`margin-left: auto` 顶到行尾，宽度按内容。 */
.bookmark-digit { flex-shrink: 0; min-width: 11px; margin-left: auto; color: var(--accent); font: 10px var(--font-mono); text-align: right; }
.bookmark-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 描述（那一行原文）：常规体、可省略号截断；`BookmarkNode.kt:80` 里它是唯一用 REGULAR_ATTRIBUTES 的段。 */
.bookmark-detail { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 有描述时文件名退成灰体（`BookmarkNode.kt:81` 的 GRAYED_ATTRIBUTES）。 */
.bookmark-name-muted { color: var(--muted); }
.bookmark-folder { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 10px; }
.bookmark-line { flex-shrink: 0; color: var(--muted); font: 10px var(--font-mono); font-variant-numeric: tabular-nums; }
.bookmark-current .bookmark-name { color: var(--bright); }
.bookmark-empty { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); padding: var(--space-5) var(--space-3); color: var(--muted); font-size: 11px; line-height: 1.7; }
.bookmark-empty p { margin: 0; color: var(--secondary); font-size: 12px; }
.bookmark-empty span { max-width: 26em; }
</style>
