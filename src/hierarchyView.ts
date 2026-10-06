// 调用/类型层级视图（IDEA 的 Ctrl+Alt+H / Ctrl+H）—— 从 App.vue 搬出的一域。
//
// 判据：19 个定义（方向、根符号、节点树、加载/展开、错误）自成一体，只被模板与菜单读；
// 外部依赖实测只有 3 个（`bottom` / `loading` / `notify`），所以 ctx 很小。
// 请求本身（`callHierarchyIncoming` 等）走 `lsp.request`，在 `src/bridge.ts` 的 kind 联合里。
import { computed, ref } from 'vue'
import { request, type LspHierarchyItem, type LspHierarchyResult } from './bridge.ts'
import { errorMessage } from './errors.ts'
import { HIERARCHY_CACHE_LIMIT, createHierarchyCache, hierarchyCacheKey, hierarchyShape } from './hierarchyCache.ts'
// 范围收窄（`HierarchyBrowserScopes` / `HierarchyTreeStructure.isInScope` 的本仓等价物）。
import { DEFAULT_HIERARCHY_SCOPE, HIERARCHY_SCOPES, nodeInScope, scopeNotice, type HierarchyScopeId } from './hierarchyScopes.ts'
// 行的分段呈现 + 按 kind 的图标（`HierarchyNodeRenderer` / `LspHierarchyNodeDescriptor` 的本仓等价物）。
import { hierarchyRowModel } from './hierarchyRenderer.ts'
// 导出与固定标签页（`ExporterToTextFileHierarchy` 一族）：本模块是它的**生产消费方**，
// App.vue 只挂两个按钮。
import { closePinnedHierarchy, exportHierarchyText, hierarchyClipboardText, hierarchySummary, pinHierarchy, type PinnedHierarchy } from './hierarchyExport.ts'

export interface HierarchyViewDeps {
  notify: (message: string, error?: boolean) => void
  /** 当前底部面板（层级视图要把它切过去）。 */
  bottom: () => boolean
  /** 切到底部面板（层级视图要把它打开）。 */
  setBottom: (open: boolean) => void
  /** 切到层级视图所在的那个输出面板（本域只会用这一个，所以类型就收窄到它）。 */
  showOutput: (id: 'hierarchy') => void
  /** 语言服务是否就绪。 */
  loading: () => boolean
}

export interface HierarchyNode {
  item: LspHierarchyItem
  parentPath: string
  ancestors: string[]
  children: HierarchyNode[] | null
  expanded: boolean
  loading: boolean
  recursive: boolean
  error: string
}

export function createHierarchyView(deps: HierarchyViewDeps) {
  const hierKind = ref<'call' | 'type'>('call')
  const hierRoot = ref<LspHierarchyItem | null>(null)
  const hierItems = ref<HierarchyNode[]>([])
  const hierOrigin = ref('')
  const hierBusy = ref(false)
  const hierError = ref('')
  let hierGeneration = 0
  const hierDirection = ref<'incoming' | 'outgoing' | 'supertypes' | 'subtypes'>('incoming')
  const hierOptions = computed<readonly (readonly [typeof hierDirection.value, string])[]>(() =>
    hierKind.value === 'call'
      ? [['incoming', '调用方'], ['outgoing', '被调用']]
      : [['supertypes', '父类型'], ['subtypes', '子类型']])
  const hierTitle = computed(() => hierKind.value === 'call' ? '调用层次' : '类型层次')
  // —— 范围收窄（`lp/hierarchy` 判词里的 `HierarchyBrowserScopes`）——
  // 默认档 = `All`（上游 `HierarchyTreeStructure` 初始就是 allScope），切换只影响**呈现**，
  // 不重新发请求（上游同样：范围是 `HierarchyTreeStructure.setScopeType` 之后的过滤条件）。
  const hierScope = ref<HierarchyScopeId>(DEFAULT_HIERARCHY_SCOPE)
  // 行 = 深度优先摊平 + 范围过滤 + 分段呈现模型（`HierarchyNodeRenderer.java:32-43`）。
  const hierRows = computed(() => {
    const rows: { node: HierarchyNode; depth: number; row: ReturnType<typeof hierarchyRowModel> }[] = []
    const base = hierRoot.value
    const stack = hierItems.value.map(node => ({ node, depth: 0 })).reverse()
    while (stack.length) {
      const entry = stack.pop()!
      // 不在范围内的节点连同它的子树一起不画 —— 上游 `HierarchyTreeStructure.isInScope` 是在
      // **生成 children 时**过滤的（父节点被滤掉就不会有 children），这里按同一效果处理：
      // 滤掉父节点就不再往下钻，避免出现"悬在空父节点下的深缩进"。
      if (!nodeInScope(entry.node.item, hierScope.value, base)) continue
      rows.push({ node: entry.node, depth: entry.depth, row: hierarchyRowModel(entry.node) })
      if (entry.node.expanded && entry.node.children) {
        for (let index = entry.node.children.length - 1; index >= 0; index--) stack.push({ node: entry.node.children[index]!, depth: entry.depth + 1 })
      }
    }
    return rows
  })
  /** 范围切换后的计数提示（面板标题尾巴；上游那一档的呈现名在 `HierarchyBrowserBaseEx.java:235-243`）。 */
  const hierScopeNotice = computed(() => scopeNotice(hierScope.value, hierRows.value.length, hierItemsFlat.value.length))
  /** 摊平的全部节点（不做范围过滤），只为算"这一档藏掉了多少"。 */
  const hierItemsFlat = computed<HierarchyNode[]>(() => {
    const out: HierarchyNode[] = []
    const stack = [...hierItems.value].reverse()
    while (stack.length) {
      const node = stack.pop()!
      out.push(node)
      if (node.expanded && node.children) for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]!)
    }
    return out
  })
  function pickHierarchyScope(scope: HierarchyScopeId) {
    if (!HIERARCHY_SCOPES.some(entry => entry.id === scope)) return
    hierScope.value = scope
  }
  /**
   * 下拉的选项（面板只要 `v-for="entry in hierScopeOptions"`，不必再去 import `hierarchyScopes`）。
   * 顺序与呈现名 = `HierarchyBrowserBaseEx.java:235-243` 那张表，五档 id =
   * `HierarchyBrowserScopes.java:8-12`（都收在 `src/hierarchyScopes.ts:44-50`）。
   */
  const hierScopeOptions = computed(() => HIERARCHY_SCOPES)
  /**
   * `<select @change>` 的那一层：DOM 事件给的是**字符串**，这里做白名单校验后再落到类型化的
   * `pickHierarchyScope` —— 宿主模板里就不用在事件表达式上写 `as`（原请求 W-2 只能那么写）。
   * 校验不过整档不动（与 `pickHierarchyScope`、`src/hierarchyScopes.ts:91-94` 同一条口径）。
   */
  function setHierarchyScope(value: string) {
    const matched = HIERARCHY_SCOPES.find(entry => entry.id === value)
    if (!matched) return
    hierScope.value = matched.id
  }
  function hierarchyKey(item: LspHierarchyItem) {
    return JSON.stringify([item.path, item.name, item.kind, item.line, item.character])
  }
  // children 缓存：折叠再展开不重查（换根/刷新/换方向时作废，见 resetHierarchy 与 loadHierarchy）。
  const childrenCache = createHierarchyCache<LspHierarchyItem[]>(HIERARCHY_CACHE_LIMIT)
  function cacheKey(item: LspHierarchyItem) {
    return hierarchyCacheKey(hierarchyShape(hierKind.value, hierDirection.value), hierarchyKey(item))
  }
  function hierarchyNodes(items: LspHierarchyItem[], parent: LspHierarchyItem, ancestors: string[]): HierarchyNode[] {
    // 上游 `LspAbstractHierarchyTreeStructure.createNodeDescriptorForItem` 用 `mapNotNull`：
    // `getVirtualFileForItem(item)` 解析不出文件（uri 对应的文件不在工作区）就**丢掉该节点**
    // 而不是画一行点不动的假节点。这里按同一口径过滤空 path。
    return items.filter(item => !!item.path).map(item => ({ item, parentPath: parent.path, ancestors, children: null, expanded: false,
      loading: false, recursive: ancestors.includes(hierarchyKey(item)), error: '' }))
  }
  async function hierarchyChildren(item: LspHierarchyItem) {
    const cached = childrenCache.get(cacheKey(item))
    if (cached) return cached
    const kind = hierKind.value === 'call'
      ? (hierDirection.value === 'incoming' ? 'callHierarchyIncoming' : 'callHierarchyOutgoing')
      : (hierDirection.value === 'supertypes' ? 'typeHierarchySupertypes' : 'typeHierarchySubtypes')
    // Route through the originating document; the echoed item may belong to an unopened file.
    const result = await request<LspHierarchyResult>('lsp.request', { kind, path: hierOrigin.value, item })
    const items = result.calls ?? result.items ?? []
    childrenCache.set(cacheKey(item), items)
    return items
  }
  function resetHierarchy() {
    hierGeneration++
    childrenCache.clear()
    hierRoot.value = null
    hierItems.value = []
    hierOrigin.value = ''
    hierBusy.value = false
    hierError.value = ''
  }
  async function prepareHierarchy(kind: 'call' | 'type', payload: { path: string; line: number; character: number }) {
    resetHierarchy()
    const generation = hierGeneration
    deps.setBottom(true)
    deps.showOutput('hierarchy')
    hierKind.value = kind
    hierOrigin.value = payload.path
    hierBusy.value = true
    try {
      const prepared = await request<LspHierarchyResult>('lsp.request', {
        kind: kind === 'call' ? 'prepareCallHierarchy' : 'prepareTypeHierarchy',
        path: payload.path, line: payload.line, character: payload.character,
      })
      if (generation !== hierGeneration) return
      const items = prepared.items ?? []
      if (!items.length) { hierError.value = kind === 'call' ? '此处没有可追溯调用关系的符号。' : '此处没有可追溯继承关系的类型。'; return }
      if (items.length > 1) deps.notify(`此处有 ${items.length} 个符号，按「${items[0]!.name}」查询。`)
      hierRoot.value = items[0]!
      hierDirection.value = kind === 'call' ? 'incoming' : 'supertypes'
      await loadHierarchy()
    } catch (error) { if (generation === hierGeneration) hierError.value = errorMessage(error) }
    finally { if (generation === hierGeneration) hierBusy.value = false }
  }
  /** 刷新入口（App 的「重新查询」按钮与换根都走它）：丢全部 sheet 重建（上游 `doRefresh(false)`）。 */
  async function loadHierarchy() {
    return reloadHierarchy('all')
  }
  async function reloadHierarchy(scope: 'all' | 'shape') {
    const root = hierRoot.value
    if (!root) return
    // 刷新语义照上游 `HierarchyBrowserBaseEx.doRefresh`：RefreshAction 走 `doRefresh(false)` 把
    // **全部** sheet 丢掉重建（缓存整体作废），换视图类型走 `doRefresh(true)` 只丢当前类型的 sheet
    // （本仓按「形状 = 类型 × 方向」前缀作废）。之前刷新按钮只是重渲染，`hierarchyChildren`
    // 命中旧缓存，按了等于没按。
    if (scope === 'all') childrenCache.clear()
    else childrenCache.invalidate(hierarchyShape(hierKind.value, hierDirection.value) + '\u0000')
    const generation = ++hierGeneration
    deps.showOutput('hierarchy')
    hierItems.value = []
    hierBusy.value = true
    hierError.value = ''
    try {
      const items = await hierarchyChildren(root)
      if (generation === hierGeneration) hierItems.value = hierarchyNodes(items, root, [hierarchyKey(root)])
    } catch (error) { if (generation === hierGeneration) hierError.value = errorMessage(error) }
    finally { if (generation === hierGeneration) hierBusy.value = false }
  }
  async function toggleHierarchy(node: HierarchyNode) {
    if (node.recursive || node.loading) return
    node.expanded = !node.expanded
    if (!node.expanded || node.children !== null) return
    const generation = hierGeneration
    node.loading = true
    node.error = ''
    try {
      const items = await hierarchyChildren(node.item)
      if (generation === hierGeneration) node.children = hierarchyNodes(items, node.item, [...node.ancestors, hierarchyKey(node.item)])
    } catch (error) {
      if (generation === hierGeneration) { node.error = errorMessage(error); node.expanded = false }
    } finally { node.loading = false }
  }
  function pickHierarchyDirection(direction: typeof hierDirection.value) {
    if (hierDirection.value === direction) return
    hierDirection.value = direction
    void reloadHierarchy('shape')
  }
  function callSiteTarget(node: HierarchyNode) {
    const path = hierDirection.value === 'outgoing' ? node.parentPath : node.item.path
    return { path, line: node.item.callLine ?? node.item.line ?? 0 }
  }
  // —— 导出与固定标签页（`ExporterToTextFileHierarchy.java:22-48` + `HierarchyBrowser` 的钉住）——
  // 当前方向的呈现名（导出文本的标题行；「调用方」/「被调用」/「父类型」/「子类型」，
  // 与 `hierOptions` 那张表同源，避免两处各写一份）。
  const hierDirectionLabel = computed(() =>
    hierOptions.value.find(([direction]) => direction === hierDirection.value)?.[1] ?? '')
  /** 被钉住的层级标签页（同根同方向同位置不重复开，判定在 `src/hierarchyExport.ts:37-41`）。 */
  const hierPinned = ref<PinnedHierarchy[]>([])
  /** 导出文本（当前可见的那一批行 —— 范围过滤之后再导，用户看到什么就导什么）。 */
  function exportCurrentHierarchy(): string {
    return exportHierarchyText(hierRows.value.map(row => row.node), hierDirectionLabel.value)
  }
  /** 剪贴板形式（每行一个位置）。 */
  function hierarchyClipboardPayload(): string {
    return hierarchyClipboardText(hierRows.value.map(row => row.node))
  }
  /** 导出标题用的摘要（`N 个根 · M 个节点`）。 */
  function hierarchyExportSummary(): string {
    return hierarchySummary(hierRows.value.map(row => row.node))
  }
  /** 钉住当前层级：返回钉住后的列表；已经钉过就不重复开（同上游"同一棵不出现两个标签页"）。 */
  function pinCurrentHierarchy(): PinnedHierarchy[] {
    const root = hierRoot.value
    if (!root) return [...hierPinned.value]
    const origin = hierOrigin.value || root.path
    const line = root.line ?? 0
    hierPinned.value = pinHierarchy(hierPinned.value, {
      root: root.name, kind: hierKind.value, direction: hierDirection.value, path: origin, line,
    })
    return [...hierPinned.value]
  }
  function closePinnedHierarchyTab(id: string): PinnedHierarchy[] {
    hierPinned.value = closePinnedHierarchy(hierPinned.value, id)
    return [...hierPinned.value]
  }
  return {
    hierKind, hierRoot, hierItems, hierOrigin, hierBusy, hierError, hierDirection, hierOptions, hierTitle, hierRows,
    hierScope, hierScopeNotice, hierScopeOptions, hierPinned, hierDirectionLabel,
    hierarchyKey, hierarchyNodes, hierarchyChildren, resetHierarchy, prepareHierarchy, loadHierarchy, toggleHierarchy, pickHierarchyDirection, callSiteTarget,
    pickHierarchyScope, setHierarchyScope, exportCurrentHierarchy, hierarchyClipboardPayload, hierarchyExportSummary, pinCurrentHierarchy, closePinnedHierarchyTab,
  }
}
