<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { FolderTree, ArrowDownAZ, Rows3, ListTree, Group, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Lock, LocateFixed, ArrowDownToLine, CornerUpRight } from 'lucide-vue-next'
import type { LspDocumentSymbol } from '../bridge'
import { arrange, caretSymbolInTree, symbolPresentableName, symbolRowIcon, treeOf, type OutlineEntry } from '../outlineView'
import { outlineRowsFromProviders, outlineRowsWithExtensions } from '../outlineExtensions.ts'
import { caretCharacterInSymbolBasis, rememberCollapsed, restoredCollapsed, shouldRevealInEditor } from '../structureFollow'
import { CLASS_LIKE_SYMBOL_KINDS } from '../lspSymbolBridge.ts'
// 「继承成员」那一档：合并/去重/灰显在 outlineInheritedMembers（纯逻辑），三跳取数在 outlineSupertypes。
import { inheritedMembersDefaultOn, memberIdentity, memberTextSegments, mergeInheritedMembers, type InheritedMember, type MemberTextSegment, type MergedMember, type SuperTypeMembers } from '../outlineInheritedMembers.ts'
import { toInheritedMembers } from '../outlineSupertypes.ts'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  path: string
  symbols: LspDocumentSymbol[]
  available: boolean
  /** 编辑器光标位置（`ctx.todoSource` 那一份）：只有开了「跟随编辑器」才用。
   *  行/列都是**编辑器口径（1 基）**，与 `TodoPanel` 吃的是同一份；符号区间是 LSP 的 0 基，
   *  用的那一侧负责换算（见下面的 watch）。 */
  source?: { path: string; line: number; character?: number } | null
  /** 「继承成员」的父类型取数（`src/outlineSupertypes.ts` 的三跳）。缺省 = 面板不渲染那个开关
   *  （宿主没给通道时不放假控件）。 */
  supertypes?: (path: string, symbol: LspDocumentSymbol) => Promise<SuperTypeMembers[]>
}>()
const emit = defineEmits<{ jump: [position: { line: number; character: number; path?: string }] }>()

// IDEA's structure popup toggles: alphabetical order, a flattened list, grouping by
// symbol kind (KindSorter) and a speed filter. None of them changes what the language
// server sent, only how it is read.
const sortByName = ref(false)
const flatView = ref(false)
const groupByKind = ref(false)
// 按可见性排序（上游 `VisibilitySorter`，`VisibilitySorter.java:34` 的 ID +
// `:37-39` 交给 `VisibilityComparator.INSTANCE`）。
const sortByVisibility = ref(false)
const filter = ref('')
// 两个跟随开关就是上游那两个（`StructureViewFactoryImpl.java:49-50`）：
// AUTOSCROLL_MODE 选中树节点→跳源码，默认开；AUTOSCROLL_FROM_SOURCE 光标→选中节点，默认关。
const autoscrollToSource = ref(true)
const autoscrollFromSource = ref(false)
const selectedKey = ref('')
const listEl = ref<HTMLElement | null>(null)

// 折叠状态（上游 `StructureViewComponent` 的树展开态）：键是符号的身份（名字 + 位置），
// 所以**必须按文件分桶** —— 位置相同的不同文件里会撞键，共用一张表会让新文件莫名收着。
// 换文件时不整张清空，而是「存进离开的那个文件、再从进来的那个文件取回」
// （上游 `storeState()`/`restoreState()`，实测在
// `platform/structure-view-impl/src/com/intellij/ide/structureView/newStructureView/StructureViewComponent.java`
// 的 `:398-407` 与 `:415-428`；调用点是 `StructureViewWrapperImpl.kt:478` 与 `:552`）。
// 取回是一次性的（`:426` 的 `editor.putUserData(STRUCTURE_VIEW_STATE_KEY, null)`）：取到就用、
// 同时把那份删掉，下一次换走时再存新的；取不到就是空表 = 全展开
// （上游那一支是 `:418-421` 的按默认深度展开）。
// 挂载/卸载也要走同一对：窗格用的是 `v-else-if="view === 'outline'"`
// （`src/components/ToolWindowView.vue:196`），切去别的工具窗口会**卸掉这个组件**，
// 上游那一份状态是挂在编辑器上的（`StructureViewComponent.java:257-260` 在 dispose 里
// 调 `storeState()`、`:332` 建树时调 `restoreState()`），所以这里卸载时存、装载时取。
const collapsed = ref(new Set(restoredCollapsed(props.path)))
onBeforeUnmount(() => { if (props.path) rememberCollapsed(props.path, collapsed.value) })
watch(() => props.path, (next, previous) => {
  if (previous) rememberCollapsed(previous, collapsed.value)
  collapsed.value = next ? new Set(restoredCollapsed(next)) : new Set<string>()
  selectedKey.value = ''
})
function toggleCollapse(key: string) {
  const next = new Set(collapsed.value)
  if (next.has(key)) next.delete(key); else next.add(key)
  collapsed.value = next
}
function collapseAll() {
  // 先按当前视图完整展开算一遍，把所有有子节点的行收起来（IDEA 的 Collapse All 同样收到顶层）。
  const all = arrange(tree.value, { sort: sortByName.value, flat: false, group: groupByKind.value, visibility: sortByVisibility.value, filter: filter.value })
  collapsed.value = new Set(all.filter(entry => entry.hasChildren).map(entry => entry.key))
}
function expandAll() { collapsed.value = new Set() }

const tree = computed(() => treeOf(props.symbols))
/**
 * 面板要画的行。三层（**次序就是上游那条消费链**）：
 *   1. `com.intellij.lang.psiStructureViewFactory` / `com.intellij.structureViewBuilder` ——
 *      第三方按语言挂了构建器就先用它折出来的行（`outlineRowsFromProviders`）；
 *   2. 没有第三方认领（默认，本仓没 bundled 构建器）⇒ 回落内建 `arrange`（`src/outlineView.ts`）；
 *   3. 再给每个父符号跑一趟 `com.intellij.lang.structureViewExtension`，把扩展补的子行插进去
 *      （Java 的 "Properties" 那一档在 IDEA 里就是这么来的）。没有扩展时第 3 步原样返回。
 */
const rows = computed(() => {
  const view = {
    sort: sortByName.value, flat: flatView.value, group: groupByKind.value,
    visibility: sortByVisibility.value, filter: filter.value, collapsed: collapsed.value,
  }
  const base = outlineRowsFromProviders(props.path, props.symbols, view)
    ?? arrange(tree.value, view)
  return outlineRowsWithExtensions(props.path, base, view)
})

// 每行行首的**种类图标**（上游 `LspStructureViewSupport.kt:21` 的 `getIcon(symbol)`，
// 与层级侧 `LspHierarchyNodeDescriptor.kt:48` 是同一条 `symbolKindCustomizer.getIcon(kind)`）。
// 图标只在行首占一格，**不改任何次序**：`rows` 还是 `arrange` 那份，计数也照它算，
// 这里只是把 `kind → 图标` 贴上去（表在 `outlineView.symbolRowIcon`，面板里没有第二张表）。
// 认不到的 kind 给 `null` ⇒ 模板 `v-if` 掉、不占图标位（不画假图标）。
//
// 「继承成员」（`InheritedMembersNodeProvider.java:19` 的 SHOW_INHERITED，默认关，
// 两条依据见 `src/outlineInheritedMembers.ts:130-140`）：开着时在**每个类节点子树之后**
// 插入父类型来的成员行 —— 行序 = 自己的在前、继承的在后（`NodeProvider.java:14-22`），
// 文本 = 名字 + `→来源类`（`memberTextSegments`，muted 段映射 `--muted` 令牌）。
// 取数是**懒的**：开着才走三跳（`src/outlineSupertypes.ts`），换文件整表重取。
type OutlineDisplayRow = OutlineEntry & {
  icon: ReturnType<typeof symbolRowIcon>
  /** 继承成员行的文本段（存在即继承行；`muted` = 上游 NOT_USED 灰）。 */
  inherited?: MemberTextSegment[]
  /** 继承成员本体（点击跳它**自己的**文件位置）。 */
  member?: InheritedMember
}
const showInherited = ref(inheritedMembersDefaultOn())
// 键用**字符串身份**而不是符号对象：大纲符号表会被反复刷新（每次 documentSymbol 回包都是新对象），
// 对象键一刷新就全部失效 ⇒ 取回的继承行永远匹配不上（2026-10-07 真机取证）。
const inheritedRows = ref(new Map<string, MergedMember[]>())
const inheritedFetching = new Set<string>() // 请求去重（非响应式）
function classKey(path: string, symbol: LspDocumentSymbol): string {
  return `${path}\u0000${symbol.name}\u0000${symbol.startLine}\u0000${symbol.startChar}\u0000${symbol.endLine}\u0000${symbol.endChar}`
}
function flattenOutline(nodes: readonly { symbol: LspDocumentSymbol; children: unknown[] }[]): { symbol: LspDocumentSymbol; children: { symbol: LspDocumentSymbol }[] }[] {
  const out: { symbol: LspDocumentSymbol; children: { symbol: LspDocumentSymbol }[] }[] = []
  const walk = (list: readonly { symbol: LspDocumentSymbol; children: unknown[] }[]) => {
    for (const node of list) { out.push(node as { symbol: LspDocumentSymbol; children: { symbol: LspDocumentSymbol }[] }); walk(node.children as readonly { symbol: LspDocumentSymbol; children: unknown[] }[]) }
  }
  walk(nodes)
  return out
}
async function refreshInherited() {
  if (!showInherited.value || !props.path || !props.supertypes) { inheritedRows.value = new Map(); return }
  const requestSuperTypes = props.supertypes
  const epochPath = props.path // 换文件后在途回包一律丢弃（watch-async-cleanup 口径）
  const next = new Map(inheritedRows.value)
  let changed = false
  for (const node of flattenOutline(tree.value)) {
    if (!CLASS_LIKE_SYMBOL_KINDS.has(node.symbol.kind)) continue
    const key = classKey(props.path, node.symbol)
    if (next.has(key)) continue
    if (inheritedFetching.has(key)) continue
    inheritedFetching.add(key)
    try {
      const superTypes = await requestSuperTypes(props.path, node.symbol)
      if (props.path !== epochPath) continue
      const own = toInheritedMembers(node.children.map(child => child.symbol), props.path)
      next.set(key, mergeInheritedMembers({ own, superTypes }).inherited)
    } catch {
      if (props.path !== epochPath) continue
      next.set(key, []) // 通道这一档没有数据：该类就没有继承行（不编），换文档时会重取
    } finally { inheritedFetching.delete(key) }
    changed = true
  }
  if (changed && props.path === epochPath) inheritedRows.value = next
}
watch(() => props.path, () => { inheritedRows.value = new Map(); void refreshInherited() })
watch([showInherited, () => props.symbols], () => { void refreshInherited() })

const displayRows = computed<OutlineDisplayRow[]>(() => {
  const base: OutlineDisplayRow[] = rows.value.map(entry => ({ ...entry, icon: symbolRowIcon(entry.symbol.kind) }))
  const merged = inheritedRows.value
  if (!showInherited.value || !merged.size) return base
  const out: OutlineDisplayRow[] = []
  let index = 0
  while (index < base.length) {
    const entry = base[index]!
    out.push(entry)
    const members = merged.get(classKey(props.path, entry.symbol))
    if (!members?.length) { index++; continue }
    // 先把这个类节点的**子树**原样搬完（层级视图里子行紧跟父行；平铺/分组视图 depth 同一条扫描也成立）
    let end = index + 1
    while (end < base.length && base[end]!.depth > entry.depth) { out.push(base[end]!); end++ }
    for (const member of members) {
      out.push({
        ...entry,
        key: `inherited:${memberIdentity(member)}`,
        depth: entry.depth + 1,
        trail: '',
        hasChildren: false,
        collapsed: false,
        icon: symbolRowIcon(member.kind),
        inherited: memberTextSegments(member),
        member,
      })
    }
    index = end
  }
  return out
})

// 选中一行：开着「跟随到源码」时选中就跳（上游 `scrollToSource` → `OpenSourceUtil.openSourcesFrom`，
// `StructureViewComponent.java:794-802`）；关着时只更新选择，跳源码留给双击/回车。
function selectRow(entry: { key: string; symbol: LspDocumentSymbol }, force = false) {
  const previous = selectedKey.value
  selectedKey.value = entry.key
  if (!force && !shouldRevealInEditor(autoscrollToSource.value, entry.key, previous)) return
  void revealSource(entry.symbol)
}
function revealSource(symbol: LspDocumentSymbol) {
  emit('jump', { line: symbol.startLine, character: symbol.startChar })
}
/** 继承成员行：跳它**自己的**文件与位置（跨文件，payload 带 `path`，宿主拿它覆盖 activePath）。 */
function revealInherited(member: InheritedMember) {
  emit('jump', { line: member.startLine, character: member.startChar, path: member.path })
}
/** 一行的标题：继承行 = 名字 + `→来源类` 两段原文；普通行照旧（`trail.name`）。 */
function rowTitle(entry: OutlineDisplayRow) {
  if (entry.member && entry.inherited) return entry.inherited.map(segment => segment.text).join('')
  return entry.trail ? `${entry.trail}.${symbolPresentableName(entry.symbol)}` : label(entry.symbol)
}
/** 一行的点击：继承行跳成员位置，普通行走选中/跟随那条链。 */
function rowJump(entry: OutlineDisplayRow, force = false) {
  if (entry.member) revealInherited(entry.member)
  else selectRow(entry, force)
}

// 反方向：编辑器光标动 → 树里选中包住光标的符号，并把它的折叠祖先展开、滚进视野
// （`StructureViewComponent.java:819-835` 的光标监听 + `:655` 的 scrollToSelectedElement）。
// 入参口径：`ctx.todoSource` 给的是**编辑器**那一套（行/列都 1 基，`CodeEditor.vue:1022`），
// 符号区间是 LSP 的 0 基 ⇒ 这里换算，不换算的话整条跟随差一行。
watch(() => autoscrollFromSource.value && props.source && props.source.path === props.path
  ? `${props.source.line}:${props.source.character ?? 0}` : '', key => {
  if (!key || !props.source) return
  const match = caretSymbolInTree(tree.value, props.source.line - 1, caretCharacterInSymbolBasis(props.source.character))
  if (!match) return
  selectedKey.value = match.key
  if (collapsed.value.size) {
    const next = new Set(collapsed.value)
    for (const ancestor of match.ancestors) next.delete(ancestor)
    collapsed.value = next
  }
  void scrollRowIntoView(match.key)
})

async function scrollRowIntoView(key: string) {
  await nextTick()
  const row = listEl.value?.querySelector(`[data-key="${cssKey(key)}"]`)
  row?.scrollIntoView({ block: 'nearest' })
}
// data-key 的值里带冒号（键 = 名字:行:列:行:列），属性选择器用引号包住；
// 引号和反斜杠是唯一会破坏 `[data-key="…"]` 的字符，这里转义这两个。
function cssKey(key: string) { return key.replace(/\\/g, '\\\\').replace(/"/g, '\\"') }

// LSP SymbolKind enum（spec 编号，1 基；native 原样透传，假服务器夹具与
// navigate-in-file 也用这一套。早前那张表整体错位了一位，Class 被标成"方法"）。
const KIND: Record<number, string> = {
  1: '文件', 2: '模块', 3: '命名空间', 4: '包', 5: '类', 6: '方法', 7: '属性', 8: '字段',
  9: '构造器', 10: '枚举', 11: '接口', 12: '函数', 13: '变量', 14: '常量', 15: '字符串',
  16: '数值', 17: '布尔', 18: '数组', 19: '对象', 20: '键', 21: '空', 22: '枚举成员',
  23: '结构体', 24: '事件', 25: '运算符', 26: '类型参数',
}
const label = (symbol: LspDocumentSymbol) => `${KIND[symbol.kind] ?? '符号'} · ${symbolPresentableName(symbol)}`
</script>

<template>
  <div class="outline-panel">
    <div class="panel-heading"><span><FolderTree :size="iconSize.control" />结构大纲</span><span class="heading-count">{{ filter.trim() ? `${rows.length}/${symbols.length}` : symbols.length }}</span></div>
    <div v-if="path && available" class="outline-tools">
      <button class="outline-tool" :class="{ on: sortByName }" :aria-pressed="sortByName" :title="sortByName ? '按名称排序' : '按文档顺序'" aria-label="按名称排序" @click="sortByName = !sortByName"><ArrowDownAZ :size="iconSize.menu" /></button>
      <button class="outline-tool" :class="{ on: flatView }" :aria-pressed="flatView" :title="flatView ? '平铺显示' : '层级显示'" aria-label="平铺显示" @click="flatView = !flatView"><component :is="flatView ? Rows3 : ListTree" :size="iconSize.menu" /></button>
      <button class="outline-tool" :class="{ on: groupByKind }" :title="groupByKind ? '按种类分组' : '按文档顺序（不分组）'" aria-label="按种类分组" :aria-pressed="groupByKind" @click="groupByKind = !groupByKind"><Group :size="iconSize.menu" /></button>
      <button class="outline-tool" :class="{ on: sortByVisibility }" :title="sortByVisibility ? '按可见性排序（公开在前）' : '不按可见性排序'" aria-label="按可见性排序" :aria-pressed="sortByVisibility" @click="sortByVisibility = !sortByVisibility"><Lock :size="iconSize.menu" /></button>
      <button class="outline-tool" :class="{ on: autoscrollToSource }" :title="autoscrollToSource ? '选中符号后跳到源码（开）' : '选中符号后不跳源码（关，双击才跳）'" aria-label="选中符号后跳到源码" :aria-pressed="autoscrollToSource" @click="autoscrollToSource = !autoscrollToSource"><ArrowDownToLine :size="iconSize.menu" /></button>
      <!-- 反向跟随要有编辑器光标才能成立。挂载点（`src/components/ToolWindowView.vue:196`）传的是
           `:source="ctx.todoSource"`（接线请求 W1，2026-10-06 已落），而 `ctx.todoSource` 在
           **没有打开的文件**时是 null（`src/App.vue:216`）⇒ 那时整格仍不渲染。
           「不放假控件」：不做画出来点了没反应的开关。 -->
      <button v-if="source" class="outline-tool" :class="{ on: autoscrollFromSource }" :title="autoscrollFromSource ? '跟随编辑器光标（开）' : '跟随编辑器光标（关）'" aria-label="跟随编辑器光标" :aria-pressed="autoscrollFromSource" @click="autoscrollFromSource = !autoscrollFromSource"><LocateFixed :size="iconSize.menu" /></button>
      <!-- 「继承成员」（上游 `InheritedMembersNodeProvider.java:19` 的 SHOW_INHERITED，默认关）。
           宿主给了取数通道才画这个开关（没通道时点了没反应 = 放假控件，那不画）。 -->
      <button v-if="supertypes" class="outline-tool" :class="{ on: showInherited }" :title="showInherited ? '显示继承的成员（开）' : '显示继承的成员（来自父类型，灰显并标出来源）'" aria-label="显示继承的成员" :aria-pressed="showInherited" @click="showInherited = !showInherited"><CornerUpRight :size="iconSize.menu" /></button>
      <button class="outline-tool" title="全部展开" aria-label="全部展开" @click="expandAll"><ChevronsUpDown :size="iconSize.menu" /></button>
      <button class="outline-tool" title="全部折叠" aria-label="全部折叠" @click="collapseAll"><ChevronsDownUp :size="iconSize.menu" /></button>
      <input v-model="filter" class="outline-filter" aria-label="按名称过滤符号" placeholder="过滤符号…" spellcheck="false" />
    </div>
    <div v-if="!path" class="outline-empty"><FolderTree :size="iconSize.artwork" /><p>打开一个文件查看符号大纲</p></div>
    <div v-else-if="!available" class="outline-empty"><FolderTree :size="iconSize.artwork" /><p>该语言服务未提供符号信息</p><span class="outline-file">{{ path }}</span></div>
    <div v-else-if="!symbols.length" class="outline-empty"><p>此文件没有符号</p></div>
    <div v-else ref="listEl" class="outline-scroll" role="group" aria-label="符号列表">
      <div v-for="(entry, index) in displayRows" :key="`${entry.key}:${index}`" class="outline-row" :data-key="entry.key"
           :class="{ selected: entry.key === selectedKey }"
           :style="{ paddingLeft: `${entry.depth * 13 + 12}px` }">
        <button v-if="entry.hasChildren" class="outline-caret" :aria-expanded="!entry.collapsed"
                :title="entry.collapsed ? '展开' : '折叠'"
                :aria-label="entry.collapsed ? `展开 ${entry.symbol.name}` : `折叠 ${entry.symbol.name}`"
                @click="toggleCollapse(entry.key)">
          <ChevronRight v-if="entry.collapsed" :size="iconSize.dense" /><ChevronDown v-else :size="iconSize.dense" />
        </button>
        <span v-else class="outline-caret outline-caret-empty" aria-hidden="true" />
        <button class="outline-jump" :title="rowTitle(entry)"
                @click="rowJump(entry)" @dblclick="rowJump(entry, true)" @keydown.enter.prevent="rowJump(entry, true)">
          <!-- 行首的种类图标：图形本身不承载文字信息（种类已经在后面那句「方法 · …」里写着），
               所以 aria-hidden，读屏仍走文字那一份。 -->
          <component v-if="entry.icon" :is="entry.icon" :size="iconSize.toolbar" class="outline-icon" aria-hidden="true" />
          <!-- 继承成员行（`memberTextSegments` 两段：名字 + `→来源类`，muted 段映射 --muted 令牌）。 -->
          <template v-if="entry.member">
            <span v-for="(segment, segmentIndex) in entry.inherited" :key="segmentIndex" class="outline-kind" :class="{ muted: segment.tone === 'muted' }">{{ segment.text }}</span>
            <span class="outline-pos">{{ entry.member.startLine + 1 }}:{{ entry.member.startChar + 1 }}</span>
          </template>
          <template v-else>
            <span class="outline-kind">{{ label(entry.symbol) }}</span>
            <span v-if="entry.trail" class="outline-trail">{{ entry.trail }}</span>
            <span class="outline-pos">{{ entry.symbol.startLine + 1 }}:{{ entry.symbol.startChar + 1 }}</span>
          </template>
        </button>
      </div>
      <p v-if="!rows.length" class="outline-empty">没有匹配的符号。</p>
    </div>
  </div>
</template>

<style scoped>
.outline-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; background: var(--editor); color: var(--text); }
.outline-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line-strong); background: var(--rail); }
.outline-tool { display: inline-flex; align-items: center; justify-content: center; width: var(--ctrl-height-sm); height: var(--ctrl-height-sm); flex-shrink: 0; color: var(--secondary); background: transparent; border: 1px solid transparent; border-radius: var(--radius-xs); cursor: pointer; transition: background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.outline-tool:hover { background: var(--hover); color: var(--bright); }
.outline-tool:focus-visible, .outline-caret:focus-visible, .outline-jump:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.outline-tool.on { color: var(--accent); background: var(--accent-soft); border-color: var(--accent); }
.outline-filter { flex: 1 1 120px; min-width: 96px; height: var(--ctrl-height-sm); padding: 0 var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 12px var(--font-ui); }
.outline-filter::placeholder { color: var(--muted); }
.outline-trail { min-width: 0; flex-shrink: 1; overflow: hidden; color: var(--muted); font: 10px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.heading-count { margin-left: auto; color: var(--secondary); font: 11px var(--font-mono); font-variant-numeric: tabular-nums; }
.outline-scroll { flex: 1; min-height: 0; overflow: auto; padding: var(--space-1) 0 var(--space-2); }
.outline-row { display: flex; align-items: center; gap: var(--space-1); width: 100%; min-height: var(--tree-row-h); padding-top: 0; padding-right: var(--space-2); padding-bottom: 0; transition: background-color var(--dur-1) var(--ease); }
.outline-row:hover { background: var(--hover); }
/* 当前选中的符号行（跟随编辑器/点击选中），与本地历史、任务面板同一套选择色。 */
.outline-row.selected { background: var(--selected); box-shadow: inset 2px 0 0 var(--accent); }
.outline-row.selected .outline-jump { color: var(--bright); }
/* 折叠箭头（有子节点的行）与占位（没有子节点时保持左侧对齐）。 */
.outline-caret { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: var(--tree-row-h); flex-shrink: 0; border: 0; border-radius: var(--radius-xs); padding: 0; background: transparent; color: var(--muted); cursor: pointer; }
.outline-caret:hover { background: var(--hover); color: var(--bright); }
.outline-caret-empty { cursor: default; }
.outline-jump { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); flex: 1; min-width: 0; min-height: var(--tree-row-h); border: 0; padding: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; font: 12px/1.4 var(--font-ui); }
/* 行首种类图标（`outlineView.symbolRowIcon`）：与项目树行图标同一档尺寸（`iconSize.toolbar`），
   贴基线走，尺寸与颜色都用既有 token，不新增色值、不加动效。 */
.outline-icon { flex-shrink: 0; align-self: center; color: var(--muted); }
.outline-kind { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 继承成员那一档的灰显（上游 NOT_USED_ELEMENT_ATTRIBUTES / GRAY_ATTRIBUTES 的角色，
   色值走 --muted 令牌；`memberTextSegments` 的 tone='muted' 映射到这里）。 */
.outline-kind.muted { color: var(--muted); }
.outline-pos { flex-shrink: 0; color: var(--muted); font: 10px/1.4 var(--font-mono); font-variant-numeric: tabular-nums; }
.outline-empty { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); padding: var(--space-5) var(--space-3); color: var(--secondary); text-align: center; font-size: 12px; line-height: 1.6; }
.outline-empty p { margin: 0; }
.outline-scroll > .outline-empty { align-items: flex-start; padding: var(--space-3); border-left: 2px solid var(--line); text-align: left; }
.outline-file { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font: 11px var(--font-mono); }
</style>
