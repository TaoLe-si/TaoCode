<script setup lang="ts">
// 面包屑整行（IDEA 的 Navigation Bar）—— 规则层在别处，这里只做装配与 DOM。
//
// 上游依据（逐条）：
//   · `platform/navbar/frontend/src/ui/NavBarItemComponent.kt:127-144` `ItemMouseListener.click`：
//     **单击 = `focusItem()` + `vm.select()` + `vm.showPopup()`**（`:134-139`，弹下拉，不是跳转），
//     **双击 = `vm.activate()`**（`:140-143`，左键）；右键弹触发在 `:131-133` 走浏览器的 contextmenu。
//   · `platform/navbar/backend/src/NavBarItem.kt:50-54` 的 `navigateOnClick()`：**默认 false**
//     （「弹下一层 children」）；`platform/navbar/backend/src/impl/DefaultNavBarItem.kt:188-198`
//     给了三步判定：旧扩展有意见取反（`:191-193`）→ 目录不导航（`:197`）→ 其它导航。
//   · `platform/navbar/shared/src/NavBarItemExpandResult.kt:10-15`：弹层里「有兄弟就把兄弟一起列出来」；
//     选中后 `navigateOnClick` 为真就导航，否则用 children 开下一层；**没有 children 时一律导航**（`:15`）。
//     `:25-26` 补了叶子项会退化成「只有一项的弹层」。
//   · `platform/navbar/frontend/resources/intellij.platform.navbar.frontend.xml:32-38`：键位全是
//     `use-shortcut-of` 借编辑器键 —— Home/End/↑/↓/←/→/Enter（动作定义在 `actions/NavBarActions.java:49-131`，
//     Up 与 Down 同指 `moveUpDown()`）。
//   · `platform/platform-impl/.../breadcrumbs/BreadcrumbsComponent.java:622-631`：四档背景键
//     （hovered > selected > light && !navigation > default），逐档取值在 `src/navToolbarCrumbs.ts`。
//
// 已知与上游的差异（都记在这，不假装一致）：
//   1. **叶子项的单击**：上游会弹一个「只有自己」的弹层（`NavBarItemExpandResult.kt:25-26`），
//      这里直接导航（同一结果，少一次点击）。非叶子照旧弹下拉。
//   2. **符号层的开关**：`showMembers`（= 上游 `UISettings.showMembersInNavigationBar`，
//      `platform/navbar/frontend/src/actions/ViewNavigationBarMembersAction.java:25`/`:31` 读写的就是这一档）
//      已经**消费**了：关掉时符号链只到类型层、兄弟下拉也只列类（规则与上游坐标见
//      `src/breadcrumbs.ts` 的 `typeLevelSymbolsOnly`）。开关动作本身不在这里加：
//      上游那条 `ViewMembersInNavigationBar`（`platform/navbar/frontend/resources/intellij.platform.navbar.frontend.xml:58`）
//      在新 UI 下是 `setEnabledAndVisible(!ExperimentalUI.isNewUI())`（同一个类 `:20`）——
//      也就是**不进菜单**，只在设置页改，本仓同理（设置项由 `src/settingsModel.ts` 承接）。
//   3. 剩下的唯一缺口是宿主把 `editorSettings.showMembersInNavigationBar` 绑到这一行的
//      `show-members` 上（`src/App.vue` 是冻结文件）⇒ 请求见 `docs/wiring-requests-2026-10-06-bucket4b.md`。
import { computed, ref } from 'vue'
import { ChevronRight, FileCode2 } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import type { Entry, LspDocumentSymbol } from '../bridge'
import { moveSegment, popupSelectionAction, segmentTarget, siblingCandidates, symbolBreadcrumbs,
  type BreadcrumbSegment } from '../breadcrumbs'
import { CRUMB_TOKEN_CLASS, crumbColorKeys, crumbStates } from '../navToolbarCrumbs'
import { navBarNavigatesOnClick } from '../navToolbarPresentation'
import type { NavBarElement } from '../navBarModel'

const props = defineProps<{
  /** 当前文件（工作区相对路径）。 */
  path: string
  /** 整个工作区树（`workspace.entries`，含目录行）—— 目录段的子项从这儿列。 */
  entries?: readonly Entry[]
  /** `textDocument/documentSymbol` 的结果，符号层从这儿折算。 */
  outline?: readonly LspDocumentSymbol[]
  /** 光标行（**1 基**，与 `createStickyLines` 的 `currentLine` 同一口径）。 */
  line?: number
  /** 当前语言（选符号 provider 表）。 */
  language?: string
  /**
   * `UISettings.showMembersInNavigationBar` 的档位（上游默认值 true ——
   * `platform/editor-ui-api/src/com/intellij/ide/ui/UISettingsState.kt:121`；
   * 本仓那份在 `src/settingsModel.ts` 的 `defaultEditorSettings`，主代理已落四处）。
   * **关掉时符号层只到类型层**：`JavaNavBarExtension.java:103`（成员折到所在的 `PsiClass`）与
   * `JavaBreadcrumbsInfoProvider.java:125`（`isShownByDefault() = !getShowMembersInNavigationBar()`），
   * 规则在 `src/breadcrumbs.ts` 的 `typeLevelSymbolsOnly`。
   * 宿主没传 = true（与改前行为一致）；`src/App.vue` 是冻结文件 ⇒ 绑定见接线请求。
   */
  showMembers?: boolean
  /** 项目根的显示名（`Project.getName()`）。 */
  rootName?: string
  /** 这个编辑器是不是活动编辑器（面包屑的活动态只给活动那一条）。 */
  active?: boolean
}>()
const emit = defineEmits<{
  /** 在项目视图里定位到某个路径（目录段 / 根按钮）。 */
  (event: 'reveal', path: string): void
  /** 跳到文件里的某一行（符号段）。 */
  (event: 'navigate', target: { path: string; line: number }): void
}>()

// 链 = 根 + 目录逐级 + 文件名 + 光标处的符号链（外层在前）。
// 根也进链（上游 NavBarModel 的地址栏就是含根的），这样四档状态的下标与整行对齐。
const crumbs = computed<BreadcrumbSegment[]>(() => [
  { kind: 'path', name: props.rootName || '/', path: '' },
  ...symbolBreadcrumbs(props.path, props.outline ?? [], Math.max(0, (props.line ?? 1) - 1), props.language, props.showMembers ?? true),
])
const selectedIndex = ref(-1)
const hoveredIndex = ref(-1)
// 四档背景键（`BreadcrumbsComponent.java:622-631` 的判定顺序）。符号段不是 NavigationCrumb，
// 所以 navigation 恒 false（`DefaultCrumbsPresentation.java:23` 的默认呈现也这么干）。
const colorKeys = computed(() => crumbColorKeys(crumbStates(crumbs.value.length, selectedIndex.value, hoveredIndex.value)))
const crumbClass = (index: number) => ({
  [CRUMB_TOKEN_CLASS[colorKeys.value[index] ?? 'BREADCRUMBS_DEFAULT']]: true,
  'is-selected': index === selectedIndex.value,
})
const crumbTitle = (index: number) => `转到 ${crumbs.value[index]?.name ?? ''}`

const elementOf = (segment: BreadcrumbSegment): NavBarElement =>
  ({ kind: segment.kind === 'file' ? 'file' : 'dir', path: segment.path ?? '', name: segment.name })
/** `navigateOnClick`：目录不导航（弹子项），文件/符号导航（`DefaultNavBarItem.kt:197`）。 */
const navigatesOf = (index: number): boolean =>
  navBarNavigatesOnClick([], elementOf(crumbs.value[index] ?? { kind: 'path', name: '' }))

/** 目录段的直接子项（`workspace.entries` 是整棵树，按父路径筛）。 */
function childCrumbs(path: string): BreadcrumbSegment[] {
  return (props.entries ?? [])
    .filter(entry => (path === '' ? !entry.path.includes('/') : entry.path.startsWith(`${path}/`)))
    .filter(entry => (path === '' ? !entry.path.includes('/') : entry.path.slice(path.length + 1).indexOf('/') < 0))
    .map(entry => ({ kind: entry.kind === 'directory' ? 'path' as const : 'file' as const, name: entry.name, path: entry.path }))
    .sort((left, right) => left.name.localeCompare(right.name))
}
/** 符号段的兄弟（`siblingCandidates` 把当前自己也带回来，弹层里要打勾）。 */
function symbolSiblings(index: number): BreadcrumbSegment[] {
  const segment = crumbs.value[index]
  if (!segment) return []
  const parent = index > 0 ? crumbs.value[index - 1] ?? null : null
  return siblingCandidates(props.outline ?? [], segment, parent && parent.kind === 'symbol' ? parent : null, props.language, true,
                           props.showMembers ?? true)
    .map(symbol => ({ kind: 'symbol' as const, name: symbol.name, startLine: symbol.startLine, endLine: symbol.endLine }))
}

interface PopupRow { label: string; navigates: boolean; hasChildren: boolean; segment: BreadcrumbSegment }
const popup = ref<{ index: number; rows: PopupRow[] } | null>(null)
const popupRows = computed(() => popup.value?.rows ?? [])
function rowsForSegment(segment: BreadcrumbSegment): PopupRow[] {
  const children = segment.kind === 'symbol' ? [] : childCrumbs(segment.path ?? '')
  if (!children.length) {
    return [{ label: segment.name, navigates: navBarNavigatesOnClick([], elementOf(segment)), hasChildren: false, segment }]
  }
  return children.map(one => {
    const grandchildren = one.kind === 'path' ? childCrumbs(one.path ?? '') : []
    return {
      label: one.name,
      navigates: navBarNavigatesOnClick([], elementOf(one)),
      hasChildren: grandchildren.length > 0,
      segment: one,
    }
  })
}
function rowsFor(index: number): PopupRow[] {
  const segment = crumbs.value[index]
  if (!segment) return []
  if (segment.kind === 'symbol') {
    const rows = symbolSiblings(index)
    return rows.length ? rows.map(one => ({ label: one.name, navigates: true, hasChildren: false, segment: one })) : []
  }
  return rowsForSegment(segment)
}

function activate(segment: BreadcrumbSegment) {
  const target = segmentTarget(segment)
  if (!target) return
  if (target.path !== undefined && target.line === undefined) emit('reveal', target.path)
  else if (target.path !== undefined && target.line !== undefined) emit('navigate', { path: target.path, line: target.line })
  else if (target.line !== undefined) emit('navigate', { path: props.path, line: target.line })
}
function pick(row: PopupRow) {
  // `NavBarItemExpandResult.kt:12-15`：能导航就导航，否则开下一层；没有子项时一律导航。
  if (popupSelectionAction(row.navigates, row.hasChildren) === 'nextPopup') {
    const current = popup.value
    if (current) popup.value = { index: current.index, rows: rowsForSegment(row.segment) }
    return
  }
  popup.value = null
  activate(row.segment)
}
/** 单击：叶子直接导航，其余弹下拉（`NavBarItemComponent.kt:134-139` + `NavBarItemExpandResult.kt:15`）。 */
function openPopup(index: number) {
  selectedIndex.value = index
  const rows = rowsFor(index)
  if (rows.length <= 1 && (rows[0] ? navigatesOf(index) : true)) { popup.value = null; activate(crumbs.value[index]!); return }
  popup.value = { index, rows }
}
/** 双击：直接激活（`NavBarItemComponent.kt:140-143`）。 */
function activateAt(index: number) {
  selectedIndex.value = index
  popup.value = null
  activate(crumbs.value[index]!)
}

// 键盘：←/→ 在段间走，Home/End 到头，↑/↓ 弹下拉（`NavBarActions.java:73-103` Up 与 Down 同指
// `moveUpDown()`），Enter 激活，Esc 收下拉。上下移动的落点先取当前段，没有就取最内层。
function onKeydown(event: KeyboardEvent) {
  const count = crumbs.value.length
  if (!count) return
  const at = selectedIndex.value < 0 ? activeCrumb() : selectedIndex.value
  if (event.key === 'ArrowLeft') { event.preventDefault(); selectedIndex.value = moveSegment(at, -1, count); return }
  if (event.key === 'ArrowRight') { event.preventDefault(); selectedIndex.value = moveSegment(at, 1, count); return }
  if (event.key === 'Home') { event.preventDefault(); selectedIndex.value = 0; return }
  if (event.key === 'End') { event.preventDefault(); selectedIndex.value = count - 1; return }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openPopup(at); return }
  if (event.key === 'Enter') { event.preventDefault(); activateAt(at); return }
  if (event.key === 'Escape' && popup.value) { event.preventDefault(); popup.value = null }
}
const activeCrumb = () => crumbs.value.findIndex(segment => segment.kind === 'symbol')
</script>

<template>
  <div class="breadcrumb-chain" role="navigation" :aria-label="'面包屑'" :data-navbar="active ? 'active' : undefined"
       tabindex="-1" @keydown="onKeydown">
    <span v-for="(crumb, index) in crumbs" :key="`${crumb.kind}:${crumb.name}:${index}`" class="breadcrumb-slot"
          style="position: relative" @mouseenter="hoveredIndex = index" @mouseleave="hoveredIndex = -1">
      <ChevronRight v-if="index > 0" :size="iconSize.dense" />
      <FileCode2 v-if="crumb.kind === 'file'" :size="iconSize.dense" />
      <button v-if="crumb.kind !== 'file'" class="breadcrumb-seg" :class="crumbClass(index)" :title="crumbTitle(index)"
              :data-color-key="colorKeys[index]" :aria-current="index === selectedIndex ? 'true' : undefined"
              @click="openPopup(index)" @dblclick="activateAt(index)">{{ crumb.name }}</button>
      <span v-else class="breadcrumb-file">{{ crumb.name }}</span>
      <span v-if="popup && popup.index === index" class="dropdown crumb-popup">
        <button v-for="(row, rowIndex) in popupRows" :key="`${row.segment.kind}:${row.label}:${rowIndex}`" class="menu-item"
                @click="pick(row)">{{ row.label }}</button>
      </span>
    </span>
  </div>
</template>
