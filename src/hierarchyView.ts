// 调用/类型层级视图（IDEA 的 Ctrl+Alt+H / Ctrl+H）—— 从 App.vue 搬出的一域。
//
// 判据：19 个定义（方向、根符号、节点树、加载/展开、错误）自成一体，只被模板与菜单读；
// 外部依赖实测只有 3 个（`bottom` / `loading` / `notify`），所以 ctx 很小。
// 请求本身（`callHierarchyIncoming` 等）走 `lsp.request`，在 `src/bridge.ts` 的 kind 联合里。
import { computed, ref } from 'vue'
import { request, type LspHierarchyItem, type LspHierarchyResult } from './bridge'
import { errorMessage } from './errors'

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
  const hierRows = computed(() => {
    const rows: { node: HierarchyNode; depth: number }[] = []
    const stack = hierItems.value.map(node => ({ node, depth: 0 })).reverse()
    while (stack.length) {
      const row = stack.pop()!
      rows.push(row)
      if (row.node.expanded && row.node.children) {
        for (let i = row.node.children.length - 1; i >= 0; i--) stack.push({ node: row.node.children[i]!, depth: row.depth + 1 })
      }
    }
    return rows
  })
  function hierarchyKey(item: LspHierarchyItem) {
    return JSON.stringify([item.path, item.name, item.kind, item.line, item.character])
  }
  function hierarchyNodes(items: LspHierarchyItem[], parent: LspHierarchyItem, ancestors: string[]): HierarchyNode[] {
    return items.map(item => ({ item, parentPath: parent.path, ancestors, children: null, expanded: false,
      loading: false, recursive: ancestors.includes(hierarchyKey(item)), error: '' }))
  }
  async function hierarchyChildren(item: LspHierarchyItem) {
    const kind = hierKind.value === 'call'
      ? (hierDirection.value === 'incoming' ? 'callHierarchyIncoming' : 'callHierarchyOutgoing')
      : (hierDirection.value === 'supertypes' ? 'typeHierarchySupertypes' : 'typeHierarchySubtypes')
    // Route through the originating document; the echoed item may belong to an unopened file.
    const result = await request<LspHierarchyResult>('lsp.request', { kind, path: hierOrigin.value, item })
    return result.calls ?? result.items ?? []
  }
  function resetHierarchy() {
    hierGeneration++
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
  async function loadHierarchy() {
    const root = hierRoot.value
    if (!root) return
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
    void loadHierarchy()
  }
  function callSiteTarget(node: HierarchyNode) {
    const path = hierDirection.value === 'outgoing' ? node.parentPath : node.item.path
    return { path, line: node.item.callLine ?? node.item.line ?? 0 }
  }
  return {
    hierKind, hierRoot, hierItems, hierOrigin, hierBusy, hierError, hierDirection, hierOptions, hierTitle, hierRows,
    hierarchyKey, hierarchyNodes, hierarchyChildren, resetHierarchy, prepareHierarchy, loadHierarchy, toggleHierarchy, pickHierarchyDirection, callSiteTarget,
  }
}
