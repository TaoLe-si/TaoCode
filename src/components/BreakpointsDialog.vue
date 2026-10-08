<script setup lang="ts">
// 「查看断点…」对话框（Ctrl+Shift+F8）—— 上游 `ViewBreakpointsAction` →
// `BreakpointsDialog`，而 `BreakpointsDialog` 正是 `com.intellij.ui.popup.util` 那一族
// （`MasterController` / `DetailController` / `DetailView` / `ItemWrapperListRenderer`）在
// **整棵树里唯一的真实消费者**。
//
// 形态逐条照上游：左列表 + 右详情。列表项是「文件:行」，详情面板顶部是路径标签
//（过长时**从左侧省略**，`DetailController.getTitle2Text`），正文是该行源码。
// 没有可显示内容时用 `DetailViewImpl` 的空态文案（`IdeCoreBundle.properties:143`，中文包 :91
// =「没有要显示的内容」）。
//
// 与上游的如实差异：
//   ① 上游详情面板嵌的是真编辑器（`EditorFactory.createViewer`），本仓用只读代码块 ——
//      这是同一个"看源码那一行"的两种画法；
//   ② 上游的列表按"文件 / 行 / 条件"分列，本仓列表是单列（路径:行），条件放详情里。
//
// 分组（2026-10-04 补）：上游对话框里断点按 `XBreakpointGroupingRule` 成组画（行断点按类型、
// 文件或自定义组）。本仓的列表项全部是行断点，所以落 `XBreakpointFileGroupingRule` 的按文件分组；
// 异常断点（`XBreakpointGroupingByTypeRule` 的 EXCEPTION 类型）来自 `src/exceptionBreakpoints.ts`
// 的共享状态，作为独立分组画在同一个列表里 —— 两处勾选是同一份状态。
//
// 用户组（2026-10-05 补，`XBreakpointCustomGroup` + `MoveToGroupAction`）：上游那棵树是
// **复选框树** —— 每个节点都带勾选框，勾组 = 勾组里所有断点（`BreakpointItemsTreeController.java:79-82`），
// 而"组"本身是逐断点存的属性（`BreakpointState.java:28-29`），组名清单是从现有断点上取的
// （`BreakpointsDialog.java:326-335`）。规则优先级决定层级：用户组 1200 > 类型 1000 > 文件 600，
// 而树按"规则下标 = 层级"从外向内建（`BreakpointItemsTreeController.java:117-132`），
// 所以本对话框把**用户组画在最外层，组里再按文件**，未分组的断点直接按文件挂在下面。
// 规则与状态全在 `src/breakpointGroups.ts`（纯函数 + 模块单例 + 按项目根持久化）。
import { computed, nextTick, ref } from 'vue'
import { Folder, X } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { dapBreakpoints } from '../bridge'
import {
  assignBreakpointsToGroup, breakpointGroupNodes, breakpointGroupState, groupBreakpointsByFile,
  groupNameOf, groupMoveTargets, isBreakpointEnabled, loadGroupState, moveGroupContents, pathsOf, resolveNewGroupName, saveGroupState, setBreakpointsEnabled, setDefaultBreakpointGroup,
  type BreakpointGroupNode,
} from '../breakpointGroups'
// 断点的唯一下发口（属性并入 + 勾选位过滤 + 同文件合并 + 册子维护），见 `src/dbgBreakpointUpdate.ts` 文件头。
import { breakpointUpdater, type BreakpointPoint } from '../dbgBreakpointUpdate'
import { exceptionBreakpointGroup, toggleExceptionBreakpoint } from '../exceptionBreakpoints'
import { NOTHING_TO_SHOW, detailPaneState, elidePath, type DetailItem } from '../popupDetail'

const props = defineProps<{
  items: DetailItem[]
  /** 路径标签的可用宽度（px）。上游量的是 `JLabel.getWidth()`。 */
  labelWidth?: number
  /** 项目根：断点的组/启用状态按项目存（上游存项目状态文件，见 src/breakpointGroups.ts 文件头）。 */
  root?: string
}>()
const emit = defineEmits<{ (event: 'close'): void; (event: 'open', item: DetailItem): void }>()

// 上游两处菜单文案的中文包（XDebuggerBundle.properties:226-234 的 zh 条目）：
// `breakpoints.dialog.no.group=<无组>`、`breakpoints.dialog.create.new.group=新建…`。
// 选项值用 \u0000 前缀，避开用户自己起的组名。
const NO_GROUP = '\u0000none'
const NEW_GROUP = '\u0000new'

// 组节点那一格的占位项：上游组节点的右键里第一项就是「移至组」子菜单本体
// （`XDebuggerBundle.properties:226 move.to.group=Move to Group`），它不是动作，只是入口的名字。
const MOVE_GROUP = '\u0000move'
const selectedId = ref<string | null>(props.items[0]?.id ?? null)
// 上游 `DetailController` 用 `FontMetrics.stringWidth` 量宽；本仓用等宽字体的近似值 ——
// 只影响"省到第几段"，不影响算法本身（`elidePath` 把量宽作为参数收，就是为了这一层解耦）。
const widthOf = (text: string) => text.length * 6.6
const pane = computed(() => detailPaneState(props.items, selectedId.value ? [selectedId.value] : [], props.labelWidth ?? 320, widthOf))
const selected = computed(() => pane.value.item)
// 行断点按文件分组（上游 `XBreakpointFileGroupingRule`）；异常断点是共享状态里的独立分组。
const fileGroups = computed(() => groupBreakpointsByFile(props.items))
const exceptionGroup = computed(() => exceptionBreakpointGroup())

// —— 用户组 ——
const storage = typeof localStorage === 'undefined' ? null : localStorage
loadGroupState(storage, props.root ?? '')
const sendError = ref('')
const itemById = computed(() => new Map(props.items.map(item => [item.id, item])))
/** 列表里全部断点的 ref（组节点、逐条「所在组」、整组「移至组」读的都是这一份）。 */
const allRefs = computed(() => props.items.map(item => item.id))
const groupNodes = computed<BreakpointGroupNode[]>(() => breakpointGroupNodes(allRefs.value))
const groupOptions = computed(() => groupNodes.value.map(node => node.name))
/** 整组搬迁的目标清单 = 上游那份 distinct+sorted 的组名**去掉它自己**（搬到同名 = 上游的白跑一趟）。 */
const groupMoveTargetsOf = (name: string) => groupMoveTargets(allRefs.value, name)
/** 未分组的行断点按文件成组（已进组的断点由它的组节点画，这里不重复画）。 */
const ungroupedGroups = computed(() => fileGroups.value
  .map(group => ({ ...group, items: group.items.filter(item => !groupNameOf(item.id)) }))
  .filter(group => group.items.length))

/** 一层扁平行：组头 / 文件头 / 断点。两种形态（组内 / 未分组）共用同一段标记。 */
type TreeRow =
  | { kind: 'group'; node: BreakpointGroupNode }
  | { kind: 'file'; group: ReturnType<typeof groupBreakpointsByFile>[number]; inGroup: boolean }
  | { kind: 'item'; item: DetailItem; inGroup: boolean }
const treeRows = computed<TreeRow[]>(() => {
  const rows: TreeRow[] = []
  for (const node of groupNodes.value) {
    rows.push({ kind: 'group', node })
    const items = node.refs.map(ref => itemById.value.get(ref)).filter((item): item is DetailItem => Boolean(item))
    for (const group of groupBreakpointsByFile(items)) {
      rows.push({ kind: 'file', group, inGroup: true })
      for (const item of group.items) rows.push({ kind: 'item', item, inGroup: true })
    }
  }
  for (const group of ungroupedGroups.value) {
    rows.push({ kind: 'file', group, inGroup: false })
    for (const item of group.items) rows.push({ kind: 'item', item, inGroup: false })
  }
  return rows
})
const rowKey = (row: TreeRow) => row.kind === 'item' ? `item:${row.item.id}` : row.kind === 'group' ? `group:${row.node.name}` : `file:${row.inGroup ? 'g' : 'u'}:${row.group.path}`
const isDefaultGroup = (name: string) => name === breakpointGroupState.defaultGroup

type NewGroupTarget = { kind: 'item'; ref: string } | { kind: 'group'; node: BreakpointGroupNode }
const newGroupTarget = ref<NewGroupTarget | null>(null)
const newGroupName = ref('')
const newGroupInput = ref<HTMLInputElement | null>(null)
const newGroupDialog = ref<HTMLElement | null>(null)
let newGroupReturnFocus: HTMLElement | null = null
function openNewGroup(target: NewGroupTarget) {
  newGroupReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  newGroupTarget.value = target
  newGroupName.value = ''
  void nextTick(() => newGroupInput.value?.focus())
}
function closeNewGroup() {
  newGroupTarget.value = null
  const target = newGroupReturnFocus
  newGroupReturnFocus = null
  void nextTick(() => target?.focus())
}
function onNewGroupKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeNewGroup()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = [...(newGroupDialog.value?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? [])]
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first || !last) { event.preventDefault(); newGroupDialog.value?.focus(); return }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
function submitNewGroup() {
  const target = newGroupTarget.value
  if (!target) return
  const name = resolveNewGroupName(newGroupName.value)
  closeNewGroup()
  if (name === null) return
  if (target.kind === 'item') assignBreakpointsToGroup([target.ref], name)
  else {
    const moved = moveGroupContents(allRefs.value, target.node.name, name || null)
    if (moved.length) saveGroupState(storage, props.root ?? '')
    return
  }
  saveGroupState(storage, props.root ?? '')
}
// 取消勾选 = 该断点不再发给适配器（上游 `XBreakpoint.java:23-25` `isEnabled`/`setEnabled` 的等价物），
// 所以要重发它所在文件；「移至组」只改本地的组织方式，不动适配器那份清单 —— 上游也是这么分的（组不进 DAP）。
//
// 12c：这里原来是**绕过下发口**手发一份 `enabledBreakpoints(points, path)` —— 那份清单只有行号，
// 随项目存下来的条件/命中次数/日志（`src/debugBreakpointExtras.ts` 的属性表）一条都没并上去，
// 而 native 记的正是「上一次收到的那份」（`native/dap.hpp:185`）⇒ 在对话框里取消勾选一次，
// 重启会话后这些断点就退回成裸行断点。改走 `breakpointUpdater` 后：属性并入、勾选位扣掉、
// 册子按全量记、同一文件的多次改动合并成一轮（`FrontendXLineBreakpointVisualizationManager.kt:296-304`）。
// 属性/依赖/静音那份状态由断点区登记给下发口（`provideBreakpointSendRules`）⇒ 这里只说「这个文件现在有哪些断点」。
async function resend(refs: readonly string[]) {
  if (!refs.length) return
  sendError.value = ''
  const rounds = await Promise.all(pathsOf(refs).map(path => {
    const points: readonly BreakpointPoint[] = dapBreakpoints.get(path) ?? []
    // 空文件不产生请求（断点已经在移除时发过空数组了）。
    if (!points.length) return Promise.resolve(null)
    // 勾选/取消勾选 = 上游点名「不能等 300ms」的那一档（同文件 `:290-294` 的 `updateBreakpointNow`）。
    return breakpointUpdater.queueFile(path, points, { now: true })
  }))
  const failed = rounds.map(round => round?.error).filter(Boolean)
  if (failed.length) sendError.value = failed[0] ?? ''
}
function toggleBreakpoint(ref: string) {
  const changed = setBreakpointsEnabled([ref], !isBreakpointEnabled(ref))
  saveGroupState(storage, props.root ?? '')
  void resend(changed)
}
function toggleGroup(node: BreakpointGroupNode) {
  const changed = setBreakpointsEnabled(node.refs, !node.enabled)
  saveGroupState(storage, props.root ?? '')
  void resend(changed)
}
function moveToGroup(ref: string, value: string) {
  if (value === NEW_GROUP) {
    openNewGroup({ kind: 'item', ref })
    return
  } else assignBreakpointsToGroup([ref], value === NO_GROUP ? null : value)
  saveGroupState(storage, props.root ?? '')
}
/** 组节点上的「移至组」= 整组搬迁：上游 `MoveToGroupAction` 循环的是
 *  `getSelectedBreakpoints(true)`，而 `traverse = true` 那一支会对选中节点**先深遍历子树**
 *  （`BreakpointItemsTreeController.java:187-194`）⇒ 选中组节点改组 = 组里每条断点一起 `setGroup`，
 *  逐条那一格不动。子菜单第一项 `<无组>`（`BreakpointsDialog.java:324`；**留痕**：这里原写 `:332`，
 *  dap3 逐行数过参考树后 `:332` 是那条 stream 的 `.sorted()`，`res.add(new MoveToGroupAction(null))` 在 `:324`
 *  —— 与 `src/breakpointGroups.ts` 里同一处订正对齐）与「新建…」(`:338`) 对组同样成立。
 *  上游**没有**「组的改名/删除」两个动作（组只是断点上的字符串 ⇒ 见 src/breakpointGroups.ts 的 `moveGroupContents`；
 *  全树 `grep -rn "RenameGroup\|RemoveGroupAction\|DeleteGroup" platform/xdebugger-impl` 零命中），
 *  所以这里也只有搬迁，不另造假控件。 */
function moveWholeGroup(node: BreakpointGroupNode, value: string) {
  if (value === MOVE_GROUP) return
  let target: string
  if (value === NEW_GROUP) {
    openNewGroup({ kind: 'group', node })
    return
  } else target = value === NO_GROUP ? '' : value
  const moved = moveGroupContents(allRefs.value, node.name, target || null)
  if (moved.length) saveGroupState(storage, props.root ?? '')
}
function setDefaultGroup(name: string) {
  setDefaultBreakpointGroup(isDefaultGroup(name) ? null : name)
  saveGroupState(storage, props.root ?? '')
}

function move(delta: number) {
  const at = props.items.findIndex(item => item.id === selectedId.value)
  if (at < 0) return
  const next = (at + delta + props.items.length) % props.items.length
  selectedId.value = props.items[next]!.id
}
/** 上游列表的双击/回车 = 打开那一项（`BreakpointsDialog` 是跳到源码）。 */
function open() { if (selected.value) emit('open', selected.value) }
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="command-palette breakpoints-dialog" role="dialog" aria-modal="true" aria-label="查看断点">
      <div class="palette-input">
        <span class="breakpoints-heading">断点（{{ items.length }}）</span>
        <button class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="iconSize.action" /></button>
      </div>
      <div class="breakpoints-body">
        <ul class="breakpoints-list" role="listbox" aria-label="断点列表" tabindex="0" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.enter.prevent="open">
          <!-- 异常断点分组：与 Debug 面板同一份勾选状态（src/exceptionBreakpoints.ts）。
               上游对话框里它就是断点类型分组之一（`XBreakpointGroupingByTypeRule`）。 -->
          <li v-if="exceptionGroup" class="breakpoints-group">
            <div class="breakpoints-group-head" role="presentation">{{ exceptionGroup.label }}（启用 {{ exceptionGroup.enabled }}/{{ exceptionGroup.total }}）</div>
            <label v-for="row in exceptionGroup.rows" :key="row.filter" class="breakpoints-exception" :title="row.description || row.label">
              <input type="checkbox" :checked="row.checked" @change="toggleExceptionBreakpoint(row.filter)" />
              <span>{{ row.label }}</span>
            </label>
          </li>
          <!-- 行断点：先用户组（最外层）后按文件；每行带勾选框（上游 BreakpointsCheckboxTree），
               断点行还有一个「移至组」下拉（上游 MoveToGroupAction 的等价入口）。 -->
          <template v-for="row in treeRows" :key="rowKey(row)">
            <li v-if="row.kind === 'group'" class="breakpoints-group">
              <div class="breakpoints-group-head breakpoints-group-line" role="presentation">
                <label class="breakpoints-check" :title="row.node.enabled ? '取消勾选组内全部断点（断点仍在，只是不再停）' : '勾选组内全部断点'">
                  <input type="checkbox" :checked="row.node.enabled" :indeterminate.prop="row.node.partial" :aria-label="`启用组 ${row.node.name}`" @change="toggleGroup(row.node)" />
                </label>
                <Folder :size="iconSize.dense" aria-hidden="true" />
                <span class="breakpoints-group-name">{{ row.node.name }}</span>
                <span class="breakpoints-group-count">{{ row.node.enabledCount }}/{{ row.node.refs.length }}</span>
                <!-- 上游 SetAsDefaultGroupAction：默认组只影响**新**断点，不搬动已有的（BreakpointsDialog.java:561-576）。 -->
                <button class="chip-x" :title="isDefaultGroup(row.node.name) ? '取消设置为默认' : '设为默认组'" :aria-label="isDefaultGroup(row.node.name) ? '取消设置为默认组' : '设为默认组'" @click="setDefaultGroup(row.node.name)">默认</button>
                <!-- 整组「移至组」（上游组节点右键里的同一个子菜单，差别只在它遍历的是整个子树）：
                     顺序照上游 —— `<无组>` 在最前（`:324`；**留痕**：这里原写 `:332`、现有组名那段原写 `:336-341`，
                     dap4 逐行数过参考树：`:332` 是那条 stream 的 `.sorted()`、子菜单现有组名是 `:326-335`，
                     与 `:155` 那段和 `src/breakpointGroups.ts` 的同一处订正对齐），最后「新建…」（`:338`）。 -->
                <select class="breakpoints-group-select" :value="MOVE_GROUP" :aria-label="`把组 ${row.node.name} 整体移至`" @change="moveWholeGroup(row.node, ($event.target as HTMLSelectElement).value)">
                  <option :value="MOVE_GROUP">移至组…</option>
                  <option :value="NO_GROUP">&lt;无组&gt;</option>
                  <option v-for="name in groupMoveTargetsOf(row.node.name)" :key="name" :value="name">{{ name }}</option>
                  <option :value="NEW_GROUP">新建…</option>
                </select>
              </div>
            </li>
            <li v-else-if="row.kind === 'file'" class="breakpoints-group" :class="{ indented: row.inGroup }">
              <div class="breakpoints-group-head" role="presentation" :title="row.group.path">{{ row.group.label }}</div>
            </li>
            <li v-else class="breakpoints-item" :class="{ indented: row.inGroup }">
              <label class="breakpoints-check" :title="isBreakpointEnabled(row.item.id) ? '取消勾选后不再发给调试器（断点仍在）' : '已取消勾选：调试器不会停在这里'">
                <input type="checkbox" :checked="isBreakpointEnabled(row.item.id)" :aria-label="`启用断点 ${row.item.id}`" @change="toggleBreakpoint(row.item.id)" />
              </label>
              <button class="menu-button breakpoints-row" role="option" :aria-selected="row.item.id === selectedId" :class="{ selected: row.item.id === selectedId, off: !isBreakpointEnabled(row.item.id) }" @click="selectedId = row.item.id" @dblclick="emit('open', row.item)">{{ row.item.title }}</button>
              <select class="breakpoints-group-select" :value="groupNameOf(row.item.id) ?? NO_GROUP" :aria-label="`断点 ${row.item.id} 所在组`" @change="moveToGroup(row.item.id, ($event.target as HTMLSelectElement).value)">
                <option :value="NO_GROUP">&lt;无组&gt;</option>
                <option v-for="name in groupOptions" :key="name" :value="name">{{ name }}</option>
                <option :value="NEW_GROUP">新建…</option>
              </select>
            </li>
          </template>
        </ul>
        <!-- 详情面板：顶部是**省略过的**路径标签（上游 `getTitle2Text`），正文是那一行源码。 -->
        <div class="breakpoints-detail">
          <div class="breakpoints-path" :title="selected?.path">{{ pane.pathLabel }}</div>
          <pre v-if="selected" class="breakpoints-source">{{ selected.body }}</pre>
          <p v-else class="breakpoints-empty">{{ pane.emptyLabel }}</p>
        </div>
      </div>
      <p v-if="sendError" class="breakpoints-error">{{ sendError }}</p>
    </section>
    <div v-if="newGroupTarget" class="modal-backdrop breakpoints-group-backdrop" @click.self="closeNewGroup">
      <section ref="newGroupDialog" class="help-dialog rename-dialog breakpoints-group-dialog" role="dialog" aria-modal="true" aria-labelledby="breakpoints-group-title" tabindex="-1" @keydown="onNewGroupKeydown">
        <h2 id="breakpoints-group-title">新建组名称</h2>
        <input ref="newGroupInput" v-model="newGroupName" class="rename-input" aria-label="组名称" spellcheck="false" @keydown.enter.prevent="submitNewGroup" />
        <div class="dialog-actions">
          <button class="primary-button" @click="submitNewGroup">确定</button>
          <button class="subtle-button" @click="closeNewGroup">取消</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.breakpoints-dialog { width: min(860px, calc(100vw - 32px)); }
.breakpoints-group-backdrop { z-index: 60; }
.breakpoints-group-dialog { width: 360px; }
.breakpoints-heading { color: var(--bright); }
/* 左列表 + 右详情（上游 `BreakpointsDialog` 的 master-detail 布局）。 */
.breakpoints-body { display: grid; grid-template-columns: minmax(180px, 38%) 1fr; min-height: 0; max-height: min(60vh, 520px); }
.breakpoints-list { margin: 0; padding: var(--space-1); list-style: none; overflow: auto; border-right: 1px solid var(--line); }
.breakpoints-row { width: 100%; text-align: left; font: 12px var(--font-mono); }
.breakpoints-row.selected { background: var(--selected); color: var(--bright); }
/* 取消勾选的断点：留在列表里（上游就是这样），只是不再注册给调试器。 */
.breakpoints-row.off { color: var(--muted); text-decoration: line-through; }
/* 分组（上游的 `BreakpointsGroupNode`）：组头是灰色的类型/文件行，子项缩进。 */
.breakpoints-group { list-style: none; }
.breakpoints-group-head { display: flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-2) 2px; color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .05em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.breakpoints-group-line { color: var(--text); text-transform: none; letter-spacing: 0; font-size: 11px; }
.breakpoints-group-name { overflow: hidden; text-overflow: ellipsis; }
.breakpoints-group-count { color: var(--muted); font-size: 10px; }
.breakpoints-group-items { margin: 0; padding: 0; list-style: none; }
.breakpoints-exception { display: flex; align-items: center; gap: var(--space-1); padding: 2px var(--space-2); font-size: 11px; color: var(--text); }
/* 断点行：勾选框 + 行本体（选中/打开）+ 所属组下拉。 */
.breakpoints-item { display: flex; align-items: center; gap: var(--space-1); padding: 0 var(--space-2); }
.breakpoints-item.indented, .breakpoints-group.indented { padding-left: var(--space-3); }
.breakpoints-check { display: inline-flex; align-items: center; flex-shrink: 0; }
.breakpoints-group-select { flex: 0 1 84px; min-width: 0; padding: 0 2px; color: var(--muted); background: var(--editor); border: 1px solid var(--line); border-radius: var(--radius-xs); font: 10px var(--font-mono); }
.breakpoints-detail { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
.breakpoints-path { flex: 0 0 auto; padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--line); color: var(--muted); font: 11px var(--font-mono); white-space: nowrap; overflow: hidden; }
.breakpoints-source { flex: 1 1 auto; margin: 0; padding: var(--space-2); overflow: auto; font: 12px/1.6 var(--font-mono); color: var(--text); white-space: pre-wrap; }
.breakpoints-empty { margin: auto; color: var(--muted); font-size: 12px; }
.breakpoints-error { margin: 0; padding: var(--space-1) var(--space-2); color: var(--error); font-size: 11px; }
</style>
