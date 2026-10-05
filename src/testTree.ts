// exec/testframework：**测试树视图**（上游 `platform/testRunner` 的 `TestTreeView` /
// `TestTreeExpander` / `ToggleModelAction` / `TestFrameworkRunningModel` 这一族）。
//
// 上游依据：
//   · `platform/testRunner/src/com/intellij/execution/testframework/TestTreeView.java:48`
//     —— 树本体（`Tree` + `MODEL_DATA_KEY` + `attachToModel`，:72-88），用户可见的一面是
//     **按 suite 层级折叠/展开的测试节点**，行内图标由 `states/` 决定；
//   · `.../actions/TestTreeExpander.java:40-61` —— `expandAll()` / `collapseAll(树, 1)`
//     （只留根下一层）/ `canExpand() && canCollapse() = myModel.hasTestSuites()`；
//   · `.../ToggleModelAction.java:16-31` —— 「展开/折叠」是一个 boolean property 动作，
//     `isVisible()` 恒真；本仓做成工具条上的两个图标按钮（`ChevronsUpDown` / `ChevronsDownUp`）；
//   · `.../TestFrameworkRunningModel.hasTestSuites()` —— 树里有没有 suite 层（有才谈得上折叠）。
//
// 本仓的等价物：`TestTreeBuilder` 逐块吃运行输出（与 `TestResultFeed` 同一份 `runOutput`，
// 但**自己持有一个 `TestEventChannel`** 借它的 id 解析与 `fullName`），把结果按
// `Suite.Class.method` 的层级拼成树；`TestTreeExpander` 持有展开集合。消费点是
// `src/components/TestRunnerPanel.vue`（渲染这棵树 + 展开/折叠全部按钮），
// 判据 `tests/test-tree-view.test.mjs`。
//
// 层级从哪来：`TestEventChannel.fullName` 给出节点的全路径（suite 链的 `join('.')`），
// 内部路径段就是 suite 层 —— 所以树不依赖适配器是否发 `suiteStarted`；适配器**发了**
// `suiteStarted` 时我们另外登记这些 suite 路径，好让「还没出结果的 suite」也出现在树里
// （上游跑完的 suite 节点同样留在树上）。纯函数 + 一个可测的状态机，判据同上。
import { TestEventChannel, parseTestEvent, type TestEvent } from './testEventChannel.ts'
import type { TestOutcome, TestResult } from './testRunner.ts'

export interface TestTreeCounts { passed: number; failed: number; skipped: number; total: number }

export interface TestTreeNode {
  /** 结果 id（`sm:` / `npm:` / `ctest:` / `junit:` 前缀），suite 节点用 `suite:` 前缀。 */
  id: string
  name: string
  kind: 'suite' | 'test'
  /** 0 基深度（顶层 suite = 0）。 */
  depth: number
  /** 展示全路径（`Suite.Class.method`）。 */
  path: string
  parent: string | null
  children: TestTreeNode[]
  /** suite 是聚合（failed > skipped > passed，见下 `worseOf`）；test 是自己的结果。 */
  outcome: TestOutcome | null
  counts: TestTreeCounts
  durationMs: number
  /** 源码位置提示（`locationHint` 或发现到的 `path:line`），null = 跳不了。 */
  location: string | null
  /** 还在跑的节点（`testStarted` 之后没结束）—— 对应上游 `ScrollToRunningTestAction` 的可见前提。 */
  running: boolean
}

/** 聚合口径：先 failed，再 skipped，最后 passed（`Filter.DEFECTIVE_LEAF` 的同一优先级）。 */
function worseOf(a: TestOutcome | null, b: TestOutcome): TestOutcome {
  if (a === 'failed' || b === 'failed') return 'failed'
  if (a === 'skipped' || b === 'skipped') return 'skipped'
  return 'passed'
}

/** 一个运行里最多记多少个节点（防无界增长；与 `CHANNEL_OUTPUT_LIMIT` 同一量级）。 */
export const TREE_NODE_LIMIT = 500

export interface DiscoveredTestLocation { path: string; line: number }

/**
 * 逐块喂运行输出 → 结果树。**与 `TestResultFeed` 平行**：同一个块两边各喂一次，
 * 这里只管层级与顺序（`TestEventChannel` 管结果状态机），所以不会出现两个状态机互相覆盖。
 */
export class TestTreeBuilder {
  private readonly channel = new TestEventChannel()
  /** 已登记的 suite 路径（`suiteStarted` 报过的），用来给「没有结果的 suite」留位。 */
  private readonly suitePaths = new Set<string>()
  /** 事件 id → 路径（suite 与 test 都记；参数化用例的 parent 可能是另一个测试的 id）。 */
  private readonly paths = new Map<string, string>()
  /** 当前打开的 suite 路径链（`TestSuiteStack` 的等价物）。 */
  private readonly open: string[] = []
  /** 结构化事件的 locationHint：结果 id → 源码位置提示。 */
  private readonly hints = new Map<string, string>()
  /** 已开始的测试（`testStarted`）—— 结束前算「运行中」。 */
  private readonly started = new Set<string>()
  private readonly finished = new Set<string>()
  private pending = ''

  /** 按输出块喂入（与 `TestResultFeed.feedChunk` 同一份块，块内残段同样留给下一块）。 */
  feed(chunk: string): void {
    this.pending += chunk
    let index: number
    while ((index = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, index)
      this.pending = this.pending.slice(index + 1)
      this.apply(line)
    }
    // 收尾块：结果行大多不带尾换行 —— 但**残段不能当完整行吃掉**（上游
    // `OutputEventSplitter` 把跨块半行留到下一块）。所以只有这段已经是**可解析的完整
    // 事件**时才消费，否则原样留给下一块（判据：tests/test-tree-view.test.mjs 那条
    // 「块边界截断的事件行照样进树」）。
    if (this.pending && parseTestEvent(this.pending)) {
      const rest = this.pending
      this.pending = ''
      this.apply(rest)
    }
  }

  apply(line: string): void {
    const event = parseTestEvent(line)
    // 通道看到每一行（它的节点表是无 id 协议下 `fullName` 的唯一来源）。
    this.channel.apply(line)
    if (!event) return
    if (event.id && event.locationHint) this.hints.set(this.resultId(event.id), event.locationHint)
    if (event.kind === 'suiteStarted') {
      const path = this.pathOf(event)
      if (path) {
        this.suitePaths.add(path)
        this.open.push(path)
        if (event.id) this.paths.set(event.id, path)
      }
      return
    }
    if (event.kind === 'suiteFinished') {
      const path = event.id ? this.paths.get(event.id) : undefined
      const at = path === undefined ? this.open.lastIndexOf(event.name ?? '') : this.open.lastIndexOf(path)
      if (at >= 0) this.open.splice(at, 1)
      return
    }
    // 测试节点自己也进 `paths`（参数化用例的 parent 就是它）。
    if (event.id && event.name) { const path = this.pathOf(event); if (path) this.paths.set(event.id, path) }
    if (event.kind === 'testStarted') { if (event.id) this.started.add(this.resultId(event.id)); return }
    if (event.id) { this.started.delete(this.resultId(event.id)); this.finished.add(this.resultId(event.id)) }
  }

  /**
   * 结果表 → 树。`discovered` 是发现到的测试位置（`path:line`）—— 上游的 locationHint
   * 由运行器报，本仓的发现器在运行前就有，合成一处。
   */
  build(results: ReadonlyMap<string, TestResult>, discovered: ReadonlyMap<string, DiscoveredTestLocation> = new Map()): TestTreeNode[] {
    const nodes = new Map<string, TestTreeNode>()
    const order: TestTreeNode[] = []
    const suiteNode = (path: string): TestTreeNode | null => {
      if (path.length >= TREE_NODE_LIMIT) return null
      const existing = nodes.get(suiteNodeId(path))
      if (existing) return existing
      // 逐级建父节点：路径里没报过 suiteStarted 的中间层照样是 suite（上游的隐式层级）。
      const parts = path.split('.')
      let prefix = ''
      let parent: TestTreeNode | null = null
      for (const part of parts) {
        prefix = prefix ? `${prefix}.${part}` : part
        const id = suiteNodeId(prefix)
        let node = nodes.get(id)
        if (!node) {
          if (nodes.size >= TREE_NODE_LIMIT) return parent
          node = { id, name: part, kind: 'suite', depth: prefix.split('.').length - 1, path: prefix,
                   parent: parent ? parent.id : null, children: [], outcome: null,
                   counts: { passed: 0, failed: 0, skipped: 0, total: 0 }, durationMs: 0,
                   location: null, running: false }
          nodes.set(id, node)
          if (parent) parent.children.push(node)
          order.push(node)
        }
        parent = node
      }
      return parent
    }

    for (const [id, result] of results) {
      if (nodes.size >= TREE_NODE_LIMIT) break
      const full = resultPath(this, id)
      const dot = full === null ? -1 : full.lastIndexOf('.')
      const parentPath = dot < 0 ? null : full!.slice(0, dot)
      // 父 suite 必须显式建出来：适配器没报过 `suiteStarted` 的那一层（隐式层级）只存在于
      // 结果的全路径里，不建这个节点测试就成了孤儿（上游树的中间层同样是无事件建出来的）。
      if (parentPath !== null) suiteNode(parentPath)
      const node: TestTreeNode = {
        id, name: dot < 0 ? (full ?? result.name) : full!.slice(dot + 1), kind: 'test',
        depth: parentPath === null ? 0 : parentPath.split('.').length,
        path: full ?? result.name, parent: parentPath === null ? null : suiteNodeId(parentPath),
        children: [], outcome: result.outcome,
        counts: { passed: 0, failed: 0, skipped: 0, total: 0 },
        durationMs: result.durationMs ?? 0,
        location: this.hints.get(id) ?? discoveredLocation(discovered.get(id)),
        running: this.started.has(id) && !this.finished.has(id),
      }
      nodes.set(id, node)
      order.push(node)
    }
    // 适配器报过、但还没有任何结果的 suite 也上树（上游跑空的 suite 节点同样留在树上）。
    for (const path of this.suitePaths) if (!nodes.has(suiteNodeId(path))) suiteNode(path)

    for (const node of order) {
      if (node.kind === 'test') {
        node.counts[node.outcome!] += 1
        node.counts.total = 1
        const parent = node.parent ? nodes.get(node.parent) : undefined
        if (parent) parent.children.push(node)
      }
    }
    // 自底向上聚合（子节点先算完，父节点拿到全部子树的计数与时长）。
    // **必须逆序**：`order` 是插入序，而深层 suite 一定晚于它的父层被建出来（`suiteNode`
    // 逐级向上建父），逆序即保证「所有子节点都先聚合完」，也就是真正的后序。
    for (let index = order.length - 1; index >= 0; --index) {
      const node = order[index]!
      if (node.kind !== 'suite') continue
      for (const child of node.children) {
        node.counts.passed += child.counts.passed
        node.counts.failed += child.counts.failed
        node.counts.skipped += child.counts.skipped
        node.counts.total += child.counts.total
        node.durationMs += child.durationMs
        node.outcome = worseOf(node.outcome, child.outcome ?? 'passed')
        node.running ||= child.running
      }
      if (!node.counts.total) node.outcome = null
    }
    const roots = order.filter(node => node.parent === null)
    return roots
  }

  /** 树里有没有 suite 层（上游 `TestTreeExpander.canExpand` 的 `hasTestSuites`）。 */
  static hasTestSuites(nodes: readonly TestTreeNode[]): boolean {
    return nodes.some(node => node.kind === 'suite' && node.children.length > 0)
  }

  /** 事件 key → 点分全路径：有 id 的按 `paths` 查，无 id 的退回通道的 `fullName`。 */
  nodePath(key: string): string | null {
    const known = this.paths.get(key)
    if (known !== undefined) return known
    const full = this.channel.fullName(this.resultId(key))
    return full === this.resultId(key) ? null : full
  }

  reset(): void {
    this.channel.reset()
    this.suitePaths.clear()
    this.paths.clear()
    this.open.length = 0
    this.hints.clear()
    this.started.clear()
    this.finished.clear()
    this.pending = ''
  }

  private resultId(key: string): string { return `sm:${key}` }
  /** 事件 → 点分全路径（父 id 查 `suitePathOf`；没给 parent 就落在当前打开的 suite 上）。 */
  private pathOf(event: TestEvent): string | null {
    const name = event.name
    if (!name) return null
    const parentPath = event.parent ? this.suitePathOf(event.parent) : this.open.at(-1)
    return parentPath ? `${parentPath}.${name}` : name
  }

  /**
   * 父 id → 那一层 suite 的路径。`paths` 里没有就按**隐式层级**处理：上游树的中间层
   * 不需要适配器报 `suiteStarted` 也在（`TestTreeView` 从结果全路径长出层级），所以父 id
   * 自己就是那一层的路径 —— 这也是「适配器没报 suiteStarted 的运行照样有 suite 层可折叠」
   * 的实现处。`A/B` 形态的父 id（无 id 协议里上游给的 suite 链）按最后一段作层名，
   * 前缀继续往上解，于是 `A/B` 与逐级 `suiteStarted` 落到的层级一样。
   */
  private suitePathOf(key: string): string | null {
    const known = this.paths.get(key)
    if (known !== undefined) return known
    const cut = key.lastIndexOf('/')
    if (cut <= 0) return key
    const head = this.suitePathOf(key.slice(0, cut))
    return head ? `${head}.${key.slice(cut + 1)}` : key.slice(cut + 1)
  }
}

function suiteNodeId(path: string): string { return `suite:${path}` }

function resultPath(builder: TestTreeBuilder, resultId: string): string | null {
  if (!resultId.startsWith('sm:')) return null
  const key = resultId.slice(3)
  return builder.nodePath(key)
}

function discoveredLocation(found: DiscoveredTestLocation | undefined): string | null {
  return found ? `${found.path}:${found.line}` : null
}

/**
 * 展开/折叠状态（`TestTreeExpander` 的等价物）。
 * 口径照上游：`collapseAll` 只留**根下一层**（`TreeUtil.collapseAll(view, 1)`），
 * `canExpand`/`canCollapse` 都以「树里有 suite 层」为前提（`hasTestSuites`）。
 */
export class TestTreeExpander {
  private readonly expanded = new Set<string>()

  isExpanded(id: string): boolean { return this.expanded.has(id) }
  toggle(id: string): void { if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id) }

  /** 全部展开（上游 `TestTreeExpander.expandAll`）—— 递归到底，不只根下一层。 */
  expandAll(nodes: readonly TestTreeNode[]): void {
    for (const node of nodes) {
      if (!node.children.length) continue
      this.expanded.add(node.id)
      this.expandAll(node.children)
    }
  }

  /** 只留根下一层展开（上游的 `collapseAll(view, 1)`）。 */
  collapseAll(nodes: readonly TestTreeNode[]): void {
    this.expanded.clear()
    for (const node of nodes) if (node.depth === 0 && node.children.length) this.expanded.add(node.id)
  }

  canExpand(nodes: readonly TestTreeNode[]): boolean { return TestTreeBuilder.hasTestSuites(nodes) }
  canCollapse(nodes: readonly TestTreeNode[]): boolean { return TestTreeBuilder.hasTestSuites(nodes) }
  clear(): void { this.expanded.clear() }
}
