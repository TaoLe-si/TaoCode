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
  /**
   * 事件**到达**那一刻盖的开始时间戳（上游 `SMTestProxy.setStarted():456-457` 与
   * `setSuiteStarted():474-477` 的 `myStartTime = System.currentTimeMillis()`）。
   * null = 这一层没报过开始事件（隐式层级），于是也就没有 wall time（`JavaSMTRunnerTestTreeView.java:79-83`
   * 要 `startTime != null && endTime != null && startTime < endTime` 才画）。
   */
  startTimeMillis: number | null
  /** 结束那一刻的时间戳（`SMTestProxy.java:629-630`/`:645-646` 的 `myEndTime`），同上可为 null。 */
  endTimeMillis: number | null
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
  /**
   * 节点 id（`suite:<路径>` / `sm:<事件 id>`）→ 开始/结束**到达**时间戳。
   * 上游也是这么来的：`SMTestProxy.setStarted()`（`:450-458`）与 `setSuiteStarted()`（`:474-477`）
   * 在事件到达时 `System.currentTimeMillis()` 盖一次（已有值不覆盖，正是上面两处的 `if (myStartTime == null)`），
   * 结束侧在 `:629-630`/`:645-646` 同样只盖第一次。
   */
  private readonly starts = new Map<string, number>()
  private readonly ends = new Map<string, number>()
  private pending = ''
  /** 事件到达时的「现在」，默认 `Date.now`（见下面的构造函数）。 */
  private readonly now: () => number

  /**
   * `now` 是可注入的时钟（默认 `Date.now`）。上游直接用 `System.currentTimeMillis()`
   * （`SMTestProxy.java:457`），本仓把这一处做成参数**只是为了让「运行中的实时时长」有判据**
   * （不然测试要等真时间走）；生产消费方（`src/components/TestRunnerPanel.vue`）不传，就是 `Date.now`。
   * 注意这里**不能**写成参数属性（构造参数上带 `private readonly`）—— Node 的 type-stripping
   * 不支持参数属性，会让整个模块加载失败（`.tools/find-param-props.mjs` 就是拦这一条的）。
   */
  constructor(now: () => number = () => Date.now()) { this.now = now }

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
        this.openNode(suiteNodeId(path))
      }
      return
    }
    if (event.kind === 'suiteFinished') {
      const path = event.id ? this.paths.get(event.id) : undefined
      const at = path === undefined ? this.open.lastIndexOf(event.name ?? '') : this.open.lastIndexOf(path)
      const closed = path ?? (at >= 0 ? this.open[at] : undefined)
      if (at >= 0) this.open.splice(at, 1)
      if (closed) {
        const id = suiteNodeId(closed)
        if (!this.ends.has(id)) this.ends.set(id, this.now())
        // 上游 `SMTestProxy.setDuration():603-604` 还有一支「suite 有时长但没时间戳 ⇒ start = endTime - duration」，
        // 它要求 finish 事件到达时那一层已经存在但**没报过 suiteStarted** —— 本仓的 suite 节点在只有
        // `suiteFinished`、没有 `suiteStarted` 时根本定位不到路径（下面的 `closed` 取不到），所以那一支在本仓
        // **没有可达入口**（不是省略功能，是协议的现实：本仓适配器成对报 suite 事件）。登记在批报告 §6。
      }
      return
    }
    // 测试节点自己也进 `paths`（参数化用例的 parent 就是它）。
    if (event.id && event.name) { const path = this.pathOf(event); if (path) this.paths.set(event.id, path) }
    if (event.kind === 'testStarted') {
      if (event.id) { const id = this.resultId(event.id); this.started.add(id); this.openNode(id) }
      return
    }
    if (event.id && event.kind !== 'testOutput') {
      const id = this.resultId(event.id)
      this.started.delete(id); this.finished.add(id)
      if (!this.ends.has(id)) this.ends.set(id, this.now())
    }
  }

  /** 开始戳只盖第一次（上游 `SMTestProxy.java:456-457`/`:475-477` 的 `if (myStartTime == null)`）。 */
  private openNode(id: string): void {
    if (!this.starts.has(id)) this.starts.set(id, this.now())
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
                   location: null, running: false,
                   startTimeMillis: this.starts.get(id) ?? null, endTimeMillis: this.ends.get(id) ?? null }
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
        startTimeMillis: this.starts.get(id) ?? null, endTimeMillis: this.ends.get(id) ?? null,
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

  /**
   * 报过 `testStarted`、却还没有任何结束事件的测试 —— 「重跑失败项」默认档里「非通过」那一档的
   * **取数处**：上游 `AbstractRerunFailedTestsAction.java:111` 是在 `model.getRoot().getAllTests()`
   * 上判 `Filter.NOT_PASSED` 的，那些节点在树上（有代理）；本仓的结果只在
   * `testFinished`/`testFailed`/`testIgnored` 时才产生（`src/testEventChannel.ts:141-144` 明确不产出），
   * 所以这一批还进不了 `build()` 的树，只能从这里取。名字取路径尾段（与 `build()` 给测试节点
   * 取名同一裁法）。判据 `tests/junit-rerun-failed-scope.test.mjs`。
   */
  notFinished(): { id: string; name: string }[] {
    const out: { id: string; name: string }[] = []
    for (const id of this.started) {
      const path = resultPath(this, id) ?? id.slice(3)
      const dot = path.lastIndexOf('.')
      out.push({ id, name: dot < 0 ? path : path.slice(dot + 1) })
    }
    return out
  }

  /**
   * 报过 `suiteStarted`、**既没长出任何子节点也还没闭合**的 suite —— 上游默认档里 "Non-Started"
   * 那一支（压根没跑起来的类）在本仓的取数处。判据 `tests/junit-rerun-failed-scope.test.mjs`，
   * 上游三条对照（本仓逐条开参考树核实，见 `docs/batch-2026-10-06-rerunscope2.md` §1③）：
   *   · 「没有孩子」= `platform/smRunner/src/com/intellij/execution/testframework/sm/runner/SMTestProxy.java:238-240`
   *     的 `isLeaf()`（孩子数是 `myChildren == null || isEmpty()`）—— 有孩子的 suite 被
   *     `java/execution/impl/src/com/intellij/execution/actions/JavaRerunFailedTestsAction.java:22-30`
   *     那条 `and(LEAF)` 挡在重跑集外，所以这里只交真正空的那几层；
   *   · 「还没闭合」= 闭合的空 suite 在上游是
   *     `platform/smRunner/src/com/intellij/execution/testframework/sm/runner/states/SuiteFinishedState.java:94`
   *     的 EMPTY_SUITE（实现 `:140-143` 给 COMPLETE_INDEX），`isPassed()` 为真 ⇒ 连 `NOT_PASSED` 都过不了。
   *     本仓的「闭合」证据只有 `suiteFinished` 盖进 `ends` 的那一次（见上面 `apply()` 的 suiteFinished 分支），
   *     所以必须排掉它 —— 否则「跑完了但本来就没有测试」的类会被当失败重跑（过度重跑，比原缺口更糟）；
   *   · 「报过 suiteStarted」= 上游的代理只在 `SMTestProxy.setSuiteStarted():474-482` 那一刻拿到
   *     RUNNING 状态；本仓从结果路径长出来的**隐式**层级没有代理，所以不在 `suitePaths` 里、也就不会
   *     凭空多出一条候选。
   * 名字取路径尾段（类名），与 `notFinished()` 同一裁法：JUnit 的 `-Dtest=` 收到类名正好重跑那个类。
   */
  notStartedSuites(): { id: string; name: string; path: string }[] {
    // 孩子的来源既包括测试也包括下层 suite：上游判的是摊平整棵树（`getAllTests()`），
    // 父层只要有一个子代理就不是叶子。
    const withChildren = new Set<string>()
    const markAncestors = (path: string): void => {
      for (let dot = path.lastIndexOf('.'); dot > 0; dot = path.lastIndexOf('.', dot - 1)) {
        withChildren.add(path.slice(0, dot))
      }
    }
    for (const path of this.paths.values()) markAncestors(path)
    for (const path of this.suitePaths) markAncestors(path)
    const out: { id: string; name: string; path: string }[] = []
    for (const path of this.suitePaths) {
      if (out.length >= TREE_NODE_LIMIT) break
      if (withChildren.has(path)) continue
      if (this.ends.has(suiteNodeId(path))) continue
      const dot = path.lastIndexOf('.')
      out.push({ id: suiteNodeId(path), name: dot < 0 ? path : path.slice(dot + 1), path })
    }
    return out
  }

  reset(): void {
    this.channel.reset()
    this.suitePaths.clear()
    this.paths.clear()
    this.open.length = 0
    this.hints.clear()
    this.started.clear()
    this.finished.clear()
    this.starts.clear()
    this.ends.clear()
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

// --- 排序与行内统计（上游 `TestConsoleProperties` 的四个开关 + `createComparator`）----
//
// 上游依据（逐条自己开过文件，行号是声明行）：
//   · `platform/testRunner/src/com/intellij/execution/testframework/TestConsoleProperties.java:45-48`
//     —— 四个 `BooleanProperty` 与**默认值**：`sortTestsAlphabetically`=false、`sortTestsByDuration`=false、
//     `sortTestsByDeclarationOrder`=false、`suitesAlwaysOnTop`=**true**；`:57` 的
//     `showInlineStatistics`=**true**（行内耗时默认就显示）；
//   · `platform/testRunner/src/com/intellij/execution/testframework/TestFrameworkRunningModel.java:41-78`
//     —— `createComparator()`：先 `SORT_BY_DURATION && !isRunning()`（`:44`），
//     再 `SORT_BY_DECLARATION_ORDER`（`:58`），否则 `SORT_ALPHABETICALLY ? AlphaComparator : null`（`:78`）；
//     两个带 suite 判定的分支里都有 `!SUITES_ALWAYS_ON_TOP || t1.isLeaf() == t2.isLeaf()` 的门（`:51`、`:65`），
//     即「suite 与 test 混排时不比较」；声明顺序取 PSI `textOffset`，**取不到的排到最后**（`:68-70`）；
//   · `platform/smRunner/src/com/intellij/execution/testframework/sm/runner/ui/SMTestRunnerResultsForm.java:310-312`
//     —— 耗时排序在**这次跑完**（`myTestsRunning = false`）时才挂到树上，与上面的 `!isRunning()` 同一口径；
//   · `platform/testRunner/src/com/intellij/execution/testframework/ToolbarPanel.java:82-114`
//     —— 三个排序开关在 `sortGroup` 里，且 `setSelected` 打开一个就把另外两个 `primSet(false)`
//     （`:84-95` 字母、`:98-110` 声明顺序、`:112-114` + 内部类 `SortByDurationAction` `:306-334` 耗时）；
//     `:161-167` 的 `secondaryGroup`（gear，「Test Runner Settings」）里挂 `SHOW_INLINE_STATISTICS`；
//   · `platform/editor-ui-api/src/com/intellij/ide/util/treeView/AlphaComparator.java:22-36`
//     —— 字母序先按 `NodeDescriptor.getWeight()`，同权重再走 `FileNameComparator`（先忽略大小写、再按原名）；
//   · `platform/smRunner/src/com/intellij/execution/testframework/sm/runner/ui/TestTreeRenderer.java:79-87`
//     与 `SMTestProxy.java:527-553` —— 开着行内统计时把 `getDurationString()` 画在节点名右侧（灰色小字），
//     文案是 `NlsMessages.formatDurationApproximateNarrow`（`platform/ide-core-impl/src/com/intellij/ide/nls/NlsMessages.java:110-115`：
//     **最多两个时间单位**，单位名取自同文件 `:32` 的 `UNIT_KEYS = {ns, mcs, ms, sec, min, hr, day, week}`）。
//
// 与本仓的差异（如实登记）：
//   · 上游的「声明顺序」用 PSI `textOffset`（要类解析），本仓只有 `location` 字符串 ⇒ 用
//     **同一文件内按行号**、跨文件按路径再按行号，等价于「源码里的先后」；拿不到位置的排最后（照 `:68-70`）。
//   · 上游字母序的第一判据是 descriptor `weight`，同一父节点下的兄弟权重相同 ⇒ 本仓只比较名字，
//     结果与上游在同层内一致。
//   · 上游 `suitesAlwaysOnTop` 是靠「混排不比较 + 建模顺序 suite 天然在前」实现；本仓的 `children`
//     是按事件到达顺序追加的（suite 可能排在先出结果的 test 之后），所以把同一可见结果写成显式判据：
//     开着置顶时 suite 在前。
//   · **留痕（2026-10-06 第二批）**：本文件上一批在这里写过「没有做成 wall time（要 startTime/endTime）、
//     也没做 root 节点的 overall/sum 提示」。实际：**这两条本轮都落了** —— 时间戳不需要改通道协议，
//     上游 `SMTestProxy` 也是在**事件到达时**用 `System.currentTimeMillis()` 盖的（`:456-457`/`:475-477`/
//     `:629-630`/`:645-646`），所以 `TestTreeBuilder` 自己盖即可（见下面「节点时长的呈现」一节与
//     `testNodeDurationText`/`testNodeDurationTooltip`）。原写法之所以成立，是因为它把「协议里没有
//     start/end 字段」当成了「拿不到 start/end」。
//   · 排序开关是运行时状态，上游存 `TestConsoleProperties`（随运行配置存盘）；本仓与面板里既有的
//     `trackRunning`/`scrollToSource` 同一档处理（不落盘），照本仓既有形状，不新建持久化键。
//   · 上游 `AbstractTestProxy.getDuration()`（`:62-64`）可以没有时长（null ⇒ 不画）；本仓
//     `TestTreeNode.durationMs` 是 number、没测到就记 0，所以**面板对 0 不显示**，
//     免得把「没测到时长」报成「0 ms」（`testDurationText(0)` 本身仍返回 `0 ms`，与上游格式化一致）。

/** 三个排序键（互斥）+ 置顶，默认值照 `TestConsoleProperties.java:45-48`。 */
export interface TestTreeSortOptions {
  sortAlphabetically: boolean
  sortByDuration: boolean
  sortByDeclarationOrder: boolean
  suitesAlwaysOnTop: boolean
}

export const DEFAULT_TEST_TREE_SORT: TestTreeSortOptions = {
  sortAlphabetically: false,
  sortByDuration: false,
  sortByDeclarationOrder: false,
  suitesAlwaysOnTop: true,
}

export type TestTreeSortKey = 'alphabetically' | 'duration' | 'declaration'

/** 开关文案（`ExecutionBundle.properties:144-152` 与 `TestRunnerBundle.properties:46-47`，本地化包不在本地树 ⇒ 英文原文直译）。 */
export const SORTING_OPTIONS_GROUP_NAME = 'Sorting Options'
export const SORT_ALPHABETICALLY_NAME = 'Sort Alphabetically'
export const SORT_ALPHABETICALLY_DESCRIPTION = 'Sort tests or suites alphabetically'
export const SORT_BY_DECLARATION_ORDER_NAME = 'Sort By Declaration Order'
export const SORT_BY_DECLARATION_ORDER_DESCRIPTION = 'Sort tests or suites by declaration order'
export const SORT_BY_DURATION_NAME = 'Sort By Duration'
export const SORT_BY_DURATION_DESCRIPTION = 'Sort tests or suites by duration'
export const SUITES_ALWAYS_ON_TOP_NAME = 'Suites Always on Top'
export const SUITES_ALWAYS_ON_TOP_DESCRIPTION = 'Sort suites on top'
export const SHOW_INLINE_STATISTICS_NAME = 'Show Inline Statistics'
export const SHOW_INLINE_STATISTICS_DESCRIPTION = 'Show/hide the test duration in the tree'

/** 打开一个排序键就把另外两个关掉（`ToolbarPanel.java:84-95/98-110/306-334` 的互斥）。 */
export function withTestTreeSort(options: TestTreeSortOptions, key: TestTreeSortKey | null): TestTreeSortOptions {
  return {
    ...options,
    sortAlphabetically: key === 'alphabetically',
    sortByDuration: key === 'duration',
    sortByDeclarationOrder: key === 'declaration',
  }
}

/** `location`（`path:line`）→ 源码位置；解不出来就是 null（上游 `getTextOffset` 拿不到 PSI 的那一档）。 */
function sourcePosition(node: TestTreeNode): { path: string; line: number } | null {
  const location = node.location
  if (!location) return null
  const cut = location.lastIndexOf(':')
  if (cut <= 0) return null
  const line = Number(location.slice(cut + 1))
  if (!Number.isFinite(line) || line <= 0) return null
  return { path: location.slice(0, cut), line }
}

/** 同层混排时的置顶判据（`TestFrameworkRunningModel.java:51/65` 的 `SUITES_ALWAYS_ON_TOP` 门）。 */
function suitesFirst(a: TestTreeNode, b: TestTreeNode, options: TestTreeSortOptions): number | null {
  if (!options.suitesAlwaysOnTop || a.kind === b.kind) return null
  return a.kind === 'suite' ? -1 : 1
}

/**
 * 排序用的那一份时长（上游 `TestFrameworkRunningModel.java:52` 比的是
 * `t2.getCustomizedDuration(properties)` —— `SMTestProxy.java:516-524` 转给
 * `JavaAwareTestConsoleProperties.getCustomizedDuration():184-197`）：
 * 叶子 ⇒ 自己的时长；suite 且开了 wall time（默认开，`JavaAwareTestConsoleProperties.java:55`）⇒ `end - start`；
 * **两个时间戳缺一个就返回 null（=「没有时长」），不退回孩子之和**（同文件 `:193-195`）。
 * null 在比较里是最小（`platform/util-rt/src/com/intellij/openapi/util/Comparing.java:155-160`）⇒ 降序时排最后。
 */
export function testNodeDurationMs(node: TestTreeNode): number | null {
  if (node.kind !== 'suite') return node.durationMs
  if (node.startTimeMillis !== null && node.endTimeMillis !== null && node.startTimeMillis < node.endTimeMillis)
    return node.endTimeMillis - node.startTimeMillis
  return null
}

/** `Comparing.compare(o1, o2)` 的等价物（null 最小；`:155-160`）。 */
function compareNullableAsc(first: number | null, second: number | null): number {
  if (first === second) return 0
  if (first === null) return -1
  if (second === null) return 1
  return first < second ? -1 : first > second ? 1 : 0
}

/** 字母序：先忽略大小写，再按原名（`AlphaComparator.java:33` 的 `FileNameComparator` 两级判据）。 */
export function compareTestNodesAlphabetically(a: TestTreeNode, b: TestTreeNode): number {
  const lower = a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
  return lower !== 0 ? lower : a.name.localeCompare(b.name, 'en')
}

/**
 * 当前开关下的兄弟比较器；三个排序都关着 ⇒ null（不排序 = 建模顺序）。
 * 判定次序照 `TestFrameworkRunningModel.createComparator`（`:41-78`）：耗时 → 声明顺序 → 字母。
 */
export function testTreeComparator(
  options: TestTreeSortOptions, isRunning: boolean,
): ((a: TestTreeNode, b: TestTreeNode) => number) | null {
  // 耗时只在**没在跑**时排（`:44` 的 `&& !isRunning()`；跑完那一刻才挂比较器，
  // `SMTestRunnerResultsForm.java:310-312`），开着耗时但还在跑 ⇒ 落到下面的分支，与上游一致。
  if (options.sortByDuration && !isRunning) {
    return (a, b) => {
      const onTop = suitesFirst(a, b, options)
      if (onTop !== null) return onTop
      // 上游是 `Comparing.compare(t2.getCustomizedDuration(p), t1.getCustomizedDuration(p))`（`:52`）
      // ——**降序**、慢的在前，「没有时长」的那一档排最后（`Comparing.java:155-160` 把 null 当最小）。
      // 比的是 customized duration（suite = wall time，见 `testNodeDurationMs`），不是孩子之和。
      return compareNullableAsc(testNodeDurationMs(b), testNodeDurationMs(a))
    }
  }
  if (options.sortByDeclarationOrder) {
    return (a, b) => {
      const onTop = suitesFirst(a, b, options)
      if (onTop !== null) return onTop
      const first = sourcePosition(a), second = sourcePosition(b)
      if (!first && !second) return 0
      if (!first) return 1   // 拿不到位置的排最后（`TestFrameworkRunningModel.java:69`）。
      if (!second) return -1 // :70
      if (first.path !== second.path) return first.path.localeCompare(second.path)
      return first.line - second.line
    }
  }
  if (options.sortAlphabetically) return compareTestNodesAlphabetically
  return null
}

/**
 * 按开关排好的一棵树（**递归到每一层的兄弟之间**，对应上游把比较器交给 tree builder、
 * 每个父节点下都按它排）。没有比较器时原样返回，不动节点身份。
 */
export function sortTestTree(
  nodes: readonly TestTreeNode[], options: TestTreeSortOptions, isRunning = false,
): TestTreeNode[] {
  const comparator = testTreeComparator(options, isRunning)
  if (!comparator) return nodes as TestTreeNode[]
  return nodes.map(node => {
    const children = node.children.length ? sortTestTree(node.children, options, isRunning) : node.children
    if (!children.length) return { ...node, children }
    return { ...node, children: [...children].sort(comparator) }
  })
}

/** 单位名取自 `NlsMessages.java:32` 的 `UNIT_KEYS`（narrow 档）。 */
const DURATION_UNITS: Array<{ ms: number; label: string }> = [
  { ms: 3_600_000, label: 'hr' },
  { ms: 60_000, label: 'min' },
  { ms: 1_000, label: 'sec' },
  { ms: 1, label: 'ms' },
]

/**
 * 行内统计的耗时文本（`TestTreeRenderer.java:79-87` + `SMTestProxy.java:546-549` 的
 * `formatDurationApproximateNarrow`：**最多两个单位**）。没有时长（null/负数）就不显示，
 * 0 也显示成 `0 ms`（上游 0 走同一格式化）。
 */
export function testDurationText(durationMs: number | null | undefined): string | null {
  if (durationMs === null || durationMs === undefined || !(durationMs >= 0)) return null
  const total = Math.floor(durationMs)
  const parts: string[] = []
  let rest = total
  for (const unit of DURATION_UNITS) {
    if (parts.length === 2) break
    const value = Math.floor(rest / unit.ms)
    if (value <= 0) continue
    parts.push(`${value} ${unit.label}`)
    rest -= value * unit.ms
  }
  return parts.length ? parts.join(' ') : '0 ms'
}

// --- 节点时长的**呈现**：wall time、运行中的实时时长、右侧 tooltip --------------------
//
// 上游依据（逐条自己开过文件，行号是声明行/命中行）：
//   · `java/execution/impl/src/com/intellij/execution/testframework/JavaSMTRunnerTestTreeView.java:56-86`
//     —— `TestTreeRenderer.getDurationText` 的 Java 覆盖：
//     `:58-74` 在跑 ⇒ 从 `startTimeMillis`（suite 且没开 wall time 时取**第一个孩子**的开始，`:60-61`+`:88-110`）
//     算已经跑了多久，**向下取整到整秒**、不足 1 秒不画（`:69-72`）；
//     `:75-84` suite + 已结束 + 开了 wall time ⇒ 画 `endTime - startTime`；
//     `:85` 其余（叶子、没时间戳的 suite）⇒ `SMTestProxy.getDurationString()`（同文件 `:546-549`，
//     suite 那一档是**孩子时长之和** `getDuration()`/`calcSuiteDuration()`，`:489-511`）。
//   · `java/execution/impl/src/com/intellij/execution/testframework/JavaAwareTestConsoleProperties.java:55`
//     —— `USE_WALL_TIME = new BooleanProperty("useWallTime", true)`：**默认开**（同文件 `:177-178` 的注释
//     「A suite reports the wall time (endTime - startTime) when USE_WALL_TIME is on」）。
//     它的开关动作在 `:199-208` 的 `appendAdditionalActions` 里，且整组被 `Registry.is("java.test.enable.tree.live.time")`
//     （`:202`）挡着 ⇒ **上游默认不给用户这一格**，本仓也就**不画**这个开关（铁律「不放假控件」），
//     只把默认档 `true` 的行为落进 `testNodeDurationText`。
//   · `java/execution/impl/src/com/intellij/execution/testframework/JavaSMTRunnerTestTreeView.java:117-150`
//     —— 非叶子节点的 tooltip：`:133-137` 的门（叶子不画、`TestDurationStrategy != AUTOMATIC` 不画、
//     两个时间戳缺一个或 `end <= start` 不画），`:139` 的 `getWidth()/2 < Math.abs(p.x)`
//     （**只有行右半侧**才有 tooltip —— 本仓等价物就是行右侧那一格耗时 `<span>` 的 `title`），
//     `:140-147` 两行正文取自 `java/openapi/resources/messages/JavaBundle.properties:2038`
//     （`java.test.overall.time=Overall time: {0}`）与 `:2039`（`java.test.sum.time=Sum time: {0}`）。
//   · `platform/ide-core-impl/src/com/intellij/ide/nls/NlsMessages.java:111-115` +
//     `platform/ide-core/resources/messages/IdeCoreBundle.properties:170-172` —— 两处时长都走
//     `formatDurationApproximateNarrow`（最多两个单位，`.short` 档单位名 `ms/sec/min/hr`）。

/** tooltip 的两行正文（`JavaBundle.properties:2038`/`:2039` 的英文原文；本地化包不在本地树 ⇒ 不自造中文）。 */
export const OVERALL_TIME_MESSAGE = 'Overall time: {0}'
export const SUM_TIME_MESSAGE = 'Sum time: {0}'

/** `{0}` 位的填充（上游 `JavaBundle.message(key, arg)` 的最小等价物，只这一处用）。 */
function message(template: string, value: string): string { return template.replace('{0}', value) }

/**
 * 一行右侧的时长文本（`JavaSMTRunnerTestTreeView.java:56-86`）。`now` 是「现在」（上游 `:69` 的
 * `System.currentTimeMillis()`；本仓由面板在新输出到达时重算，与上游「来事件才重画」同一口径）。
 * 返回 null = 这一格不画（上游同样有四个不画的分支：`:66-68`、`:71`、`:75-81` 的条件、`:85`→`SMTestProxy.java:547-548` 的 null）。
 */
export function testNodeDurationText(node: TestTreeNode, now: number = Date.now()): string | null {
  if (node.running) {
    // 上游 `:58` 还有 `!isSubjectToHide(consoleProperties)` 这一门（`SMTestProxy.java:541-543`：
    // 隐藏已通过测试时不画）。本仓被显示过滤器挡掉的节点**根本不进渲染**
    // （`src/testResultFilter.ts` 的 `filterTestTree`），所以这一门天然成立。
    if (node.startTimeMillis === null || node.startTimeMillis === 0) return null   // `:66-68`
    const elapsed = Math.max(0, now - node.startTimeMillis)
    const seconds = Math.floor(elapsed / 1000)
    if (seconds === 0) return null                                                 // `:70-71`
    return testDurationText(seconds * 1000)                                        // `:72-73`
  }
  // 已结束的 suite ⇒ wall time（`:75-84`；`USE_WALL_TIME` 默认 true，见 `JavaAwareTestConsoleProperties.java:55`）。
  if (node.kind === 'suite' && node.startTimeMillis !== null && node.endTimeMillis !== null
      && node.startTimeMillis < node.endTimeMillis)
    return testDurationText(node.endTimeMillis - node.startTimeMillis)
  // 叶子与没有时间戳的 suite ⇒ 自己的时长 / 孩子之和（`:85` + `SMTestProxy.java:489-511`、`:546-549`）。
  // 本仓 `durationMs` 是 number，0 = 「没测到时长」⇒ 不画（与本文件 `:344-346` 既有的登记同一口径）。
  return node.durationMs > 0 ? testDurationText(node.durationMs) : null
}

/**
 * 行右侧那一格的 tooltip（`JavaSMTRunnerTestTreeView.java:117-150`）：非叶子 + 两个时间戳齐全且
 * `end > start` 才给两行「Overall time / Sum time」，其余 null。
 * 上游的 `TestDurationStrategy != AUTOMATIC` 那一门（`:133`）在本仓恒不成立 —— 本仓没有给运行配置
 * 指定 MANUAL 时长档的通道（那是 `SMTRunnerConsoleProperties` 的 per-framework 配置面），所以全部按
 * AUTOMATIC 处理，等价于上游默认形状。
 */
export function testNodeDurationTooltip(node: TestTreeNode): string | null {
  if (node.kind !== 'suite' || !node.children.length) return null                 // `:133` 的 `test.isLeaf()`
  if (node.startTimeMillis === null || node.endTimeMillis === null
      || node.endTimeMillis <= node.startTimeMillis) return null                  // `:134-136`
  const overall = testDurationText(node.endTimeMillis - node.startTimeMillis)
  if (overall === null) return null
  // `:141-147`：`getDuration()`（suite = 孩子时长之和）为 null 时只给一行。本仓 0 = 没测到 ⇒ 同样只给一行。
  const sum = node.durationMs > 0 ? testDurationText(node.durationMs) : null
  return sum === null ? message(OVERALL_TIME_MESSAGE, overall)
                      : `${message(OVERALL_TIME_MESSAGE, overall)}\n${message(SUM_TIME_MESSAGE, sum)}`
}
