// 调用/类型层级视图（IDEA 的 Ctrl+Alt+H / Ctrl+H）—— 从 App.vue 搬出的一域。
//
// 判据：19 个定义（方向、根符号、节点树、加载/展开、错误）自成一体，只被模板与菜单读；
// 外部依赖实测只有 3 个（`bottom` / `loading` / `notify`），所以 ctx 很小。
// 请求本身（`callHierarchyIncoming` 等）走 `lsp.request`，在 `src/bridge.ts` 的 kind 联合里。
import { computed, ref } from 'vue'
import { request, type LspHierarchyItem, type LspHierarchyResult } from './bridge.ts'
import { errorMessage } from './errors.ts'
import { HIERARCHY_CACHE_LIMIT, createHierarchyCache, hierarchyCacheKey, hierarchyShape } from './hierarchyCache.ts'
// 范围收窄（`HierarchyBrowserScopes` / `HierarchyTreeStructure.isInScope` 的本仓等价物）
// + 范围的**适用面**（`hierarchyScopeSupport`：哪一个视图/方向真有这只下拉，上游按视图逐个注册动作）。
import { DEFAULT_HIERARCHY_SCOPE, HIERARCHY_SCOPES, hierarchyScopeSupport, isHierarchyScopeSelectable, nodeInScope, scopeNotice, type HierarchyScopeId, type HierarchyViewDirection, type HierarchyViewKind } from './hierarchyScopes.ts'
// 行模型：稳定的行 id、可见节点计数、跨重建的展开态沿用（`HierarchyBrowserBaseEx.java:596-647` 那一对的本仓形态）。
import { captureHierarchyExpansion, hierarchyItemKey, hierarchyRowIds, hierarchyVisibleNodeCount, planHierarchyExpansion, type HierarchyRowNode } from './hierarchyRows.ts'
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

/**
 * 面板里的一棵树节点。`extends HierarchyRowNode` 是把话说死：
 * 行模型（`src/hierarchyRows.ts`）认的那三格（内容键要用的 `item`、路径用的 `ancestors`、
 * 懒加载的 `children` + `expanded`）必须一直在，缺一样 `planHierarchyExpansion` 就贴不回去。
 */
export interface HierarchyNode extends HierarchyRowNode {
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
  // 默认档 = `All`（上游 `HierarchyBrowserBaseEx.java:165` 的 `state.SCOPE == null ? SCOPE_ALL : state.SCOPE`）。
  //
  // 留痕（原写 X、实际 Y）：这一片原先写的是"范围是 `HierarchyTreeStructure.setScopeType` 之后的过滤条件、
  // 切换只影响呈现" —— 参考树里**没有** `setScopeType` 这个方法（`HierarchyTreeStructure.java` 全文只把
  // `scopeType` 当参数收：`:132 getSearchScope(String scopeType,…)`、`:161 isInScope(…, String scopeType)`）。
  // 真实的形态是（`HierarchyBrowserBaseEx.java:820-826`）：
  //   · 当前档**按视图类型（sheet）各存一份** —— `myType2Sheet.get(getCurrentViewType()).myScope = scopeType`；
  //   · 同时把这一档写进应用级设置 `HierarchyBrowserManager.getSettings(project).SCOPE`，
  //     下一个新开的浏览器按 `:165` 拿它当初始档；
  //   · 然后 `doRefresh(true)` **只重建当前视图类型**那一棵（原注释：`scope is kept per type so other
  //     builders don't need to be refreshed`）。
  // 本仓的过滤条件是纯路径形态（没有 PSI 查询可重跑），所以"重建树"在这里只是把已经在飞的 children
  // 请求再走一遍，收益为负 ⇒ 呈现层重算、请求不重发，这条差异如实登记在报告 §6。
  // 但**按视图各存一份**与**全局初始档**这两条是真行为，本批补上（原来四个方向共用一格，
  // 换回去就把用户选的档丢了）。
  const hierScopeLast = ref<HierarchyScopeId>(DEFAULT_HIERARCHY_SCOPE)
  /** sheet 键 = `视图/方向`（上游的 `myType2Sheet` 就是按视图类型分的，`:649-651 getCurrentScopeType`）。 */
  const hierScopeSheets = ref<Partial<Record<`${HierarchyViewKind}/${HierarchyViewDirection}`, HierarchyScopeId>>>({})
  const hierSheetKey = computed<`${HierarchyViewKind}/${HierarchyViewDirection}`>(
    () => `${hierKind.value}/${hierDirection.value}`)
  /** 当前视图/方向的范围**适用面**（类型层次·父类型 = 不支持，上游把动作 `isEnabled()=false`）。 */
  const hierScopeSupport = computed(() => hierarchyScopeSupport(hierKind.value, hierDirection.value))
  /**
   * 当前真正生效的那一档。不支持的那一向**恒等于默认档**（= 不收窄）——
   * 上游的 `SupertypesHierarchyTreeStructure.java` 全文零 scope 引用，
   * 屏上按钮只是灰着（`ChangeScopeAction.update` 的 `presentation.setEnabled(isEnabled())`，
   * `HierarchyBrowserBaseEx.java:788-792`），树里并没有真的按范围滤过。
   * 本仓不给它留"看着能按、按了也滤"的状态：`setHierarchyScope` 按适用面校验，这一向根本写不进 sheet，
   * 于是屏上既不滤也不显示可选 —— 与上游"按钮灰掉、树里根本没按范围滤"同一条效果。
   */
  const hierScope = computed<HierarchyScopeId>(() => {
    if (!hierScopeSupport.value.supported) return DEFAULT_HIERARCHY_SCOPE
    return hierScopeSheets.value[hierSheetKey.value] ?? hierScopeLast.value
  })
  // 行 = 深度优先摊平 + 范围过滤 + 分段呈现模型（`HierarchyNodeRenderer.java:32-43`）
  // + 每行的**稳定 id**（`src/hierarchyRows.ts` 的 `hierarchyRowIds`，宿主可以直接拿它当 `:key`；
  // 原来钉的是 `:key="index"`，任何一次展开/过滤都让整列重挂 DOM）。
  const hierRows = computed(() => {
    const rows: { node: HierarchyNode; depth: number; key: string; row: ReturnType<typeof hierarchyRowModel> }[] = []
    const base = hierRoot.value
    const stack = hierItems.value.map(node => ({ node, depth: 0 })).reverse()
    while (stack.length) {
      const entry = stack.pop()!
      // 不在范围内的节点连同它的子树一起不画 —— 上游 `HierarchyTreeStructure.isInScope` 是在
      // **生成 children 时**过滤的（父节点被滤掉就不会有 children），这里按同一效果处理：
      // 滤掉父节点就不再往下钻，避免出现"悬在空父节点下的深缩进"。
      if (!nodeInScope(entry.node.item, hierScope.value, base)) continue
      rows.push({ node: entry.node, depth: entry.depth, key: hierarchyKey(entry.node.item), row: hierarchyRowModel(entry.node) })
      if (entry.node.expanded && entry.node.children) {
        for (let index = entry.node.children.length - 1; index >= 0; index--) stack.push({ node: entry.node.children[index]!, depth: entry.depth + 1 })
      }
    }
    const ids = hierarchyRowIds(rows.map(entry => entry.key))
    return rows.map((entry, index) => ({ ...entry, id: ids[index]! }))
  })
  /** 范围切换后的计数提示（面板标题尾巴；当前档的呈现名 = `HierarchyBrowserBaseEx.java:237-241` 那份表，按钮上就写它）。 */
  const hierScopeNotice = computed(() => scopeNotice(hierScope.value, hierRows.value.length, hierarchyVisibleNodeCount(hierItems.value)))
  function pickHierarchyScope(scope: HierarchyScopeId) {
    if (!HIERARCHY_SCOPES.some(entry => entry.id === scope)) return
    // 这一向没有这只下拉就不许写状态（上游 `TypeHierarchyBrowser.java:49-52` 的 isEnabled=false）。
    if (!isHierarchyScopeSelectable(scope, hierKind.value, hierDirection.value)) return
    hierScopeSheets.value = { ...hierScopeSheets.value, [hierSheetKey.value]: scope }
    // 同时记一份"最后一次选的档"（上游 `selectScope` 里的 `HierarchyBrowserManager.getSettings(…).SCOPE`，
    // `HierarchyBrowserBaseEx.java:822`），新 sheet 第一次进来按它起（`:165` 那一句的同一形状）。
    hierScopeLast.value = scope
  }
  /**
   * 下拉的选项（面板只要 `v-for="entry in hierScopeOptions"`，不必再去 import `hierarchyScopes`）。
   * **按视图/方向给**：上游的范围动作是一个一个视图注册的（文件头那一段），
   * 类型层次的「父类型」那一向拿到的是**空表**（= 界面上不该有这只下拉，或该灰掉），
   * 其余三向拿到的仍是 `HIERARCHY_SCOPES` **那一份数组本身**（不是复制、不是重排）：
   * 顺序 = `HierarchyBrowserBaseEx.java:770-776` 的 `getValidScopes()`、`:811-812` 一条一条
   * `group.add(new MenuAction(namedScope))`；五档 id = `HierarchyBrowserScopes.java:8-12`。
   */
  const hierScopeOptions = computed(() => hierScopeSupport.value.tiers)
  /** 这只下拉在当前视图/方向上到底该不该出现（宿主的 `v-if`/`:disabled` 读它，判定不在模板里）。 */
  const hierScopeSupported = computed(() => hierScopeSupport.value.supported)
  /**
   * `<select @change>` 的那一层：DOM 事件给的是**字符串**，这里做白名单校验后再落到类型化的
   * `pickHierarchyScope` —— 宿主模板里就不用在事件表达式上写 `as`（原请求 W-2 只能那么写）。
   * 校验不过整档不动（与 `pickHierarchyScope`、`src/hierarchyScopes.ts` 里 `nodeInScope` 的
   * default 分支同一条口径）。
   */
  function setHierarchyScope(value: string) {
    const matched = HIERARCHY_SCOPES.find(entry => entry.id === value)
    if (!matched) return
    pickHierarchyScope(matched.id)
  }
  /**
   * 节点的内容键 = `src/hierarchyRows.ts` 的那一份（五个字段、顺序、`JSON.stringify` 一字未改）。
   * 三处共用同一配方：children 缓存键、递归标记、行 id —— 原来这三处只有第一、二处用同一个闭包函数，
   * 行 id 无处可用，本批把配方搬进模块。
   */
  const hierarchyKey = hierarchyItemKey
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
  /**
   * 展开一个节点 = 把它的下级取回来（单击的 `toggleHierarchy` 与"重建后复原展开态"共用这一份）。
   * 取不到就收起并留错误文本 —— 一行"显示已展开、里面什么都没有"就是写了却按不动的假状态。
   */
  async function expandHierarchyNode(node: HierarchyNode) {
    if (node.children !== null) return
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
  /**
   * 把上一屏抓下来的展开态贴回这一屏（上游 `HierarchyBrowserBaseEx.java:607-615` 的 `restoreTreeState`，
   * 它按 `:596-605` 存下的那批路径逐条 `expandLater`，`:456-457` = `TreeUtil.promiseExpand`，
   * 也就是说**上游为了复原深层展开会沿途把下级再取一遍**）。
   * 本仓按同一形状做"逐轮"：这一轮认回来的先展开，没取过下级的补一次查询，补完下一轮接着往下认；
   * 同一个节点最多补查一次（`attempted`），失败/换根/换方向都由 generation 守卫当场作废。
   */
  async function applyHierarchyExpansion(saved: readonly (readonly string[])[], generation: number) {
    if (!saved.length) return
    const attempted = new Set<HierarchyNode>()
    for (;;) {
      if (generation !== hierGeneration) return
      const plan = planHierarchyExpansion(hierItems.value, saved)
      for (const node of plan.expand) node.expanded = true
      const pending = plan.load.filter(node => !attempted.has(node))
      if (!pending.length) return
      pending.forEach(node => attempted.add(node))
      await Promise.all(pending.map(node => expandHierarchyNode(node)))
    }
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
    // 上游在丢 sheet **之前**存路径、重建之后贴回去（`:626-628` 与 `:643-645`）——
    // 原来本仓一重建就把用户展开的整棵树丢了。
    const savedExpansion = captureHierarchyExpansion(hierItems.value)
    hierItems.value = []
    hierBusy.value = true
    hierError.value = ''
    try {
      const items = await hierarchyChildren(root)
      if (generation === hierGeneration) hierItems.value = hierarchyNodes(items, root, [hierarchyKey(root)])
      if (generation === hierGeneration) await applyHierarchyExpansion(savedExpansion, generation)
    } catch (error) { if (generation === hierGeneration) hierError.value = errorMessage(error) }
    finally { if (generation === hierGeneration) hierBusy.value = false }
  }
  async function toggleHierarchy(node: HierarchyNode) {
    if (node.recursive || node.loading) return
    node.expanded = !node.expanded
    if (!node.expanded) return
    await expandHierarchyNode(node)
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
    hierScope, hierScopeNotice, hierScopeOptions, hierScopeSupported, hierPinned, hierDirectionLabel,
    hierarchyKey, hierarchyNodes, hierarchyChildren, resetHierarchy, prepareHierarchy, loadHierarchy, toggleHierarchy, pickHierarchyDirection, callSiteTarget,
    pickHierarchyScope, setHierarchyScope, exportCurrentHierarchy, hierarchyClipboardPayload, hierarchyExportSummary, pinCurrentHierarchy, closePinnedHierarchyTab,
  }
}
