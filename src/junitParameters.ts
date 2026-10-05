// exec/junit：**参数化 / 动态用例的收集**（上游 `plugins/junit` 的 `JUnitParameterCollector`）。
//
// 上游依据（`plugins/junit/src/com/intellij/execution/junit/JUnitParameterCollector.java`）：
//   · `:264-276` `parseNode` —— 收集 fork 报回来的是 **service message**：只有
//     `TestStarted` / `TestSuiteStarted` 两种，各带 `nodeId` / `parentNodeId` / `name` /
//     `locationHint`（本仓的结构化通道 `##taocode[...]` 字段与它一一对应，见
//     `src/testEventChannel.ts`）；三个属性缺一个就丢掉这条节点；
//   · `:226-245` `parse` —— 收集到的节点里筛出「属于这个测试的」那些，按**展示名**分组
//     （同一个参数在每个外层调用下各报一次，所以要按呈现的名字合并 id）；
//     「某个节点自己有子节点 ⇒ 它是容器不是一次调用」要跳过（:238）；
//     分组后**少于两组**就当没有可选项返回空表（:243）—— 剪过枝的树会把测试自己
//     和一次调用报成同一个样子，两种情况都归到这里；
//   · `:247-256` `isOfTheTest` —— 节点要么自己指着这个测试的 locationHint，要么自己没有
//     locationHint 而父节点指着它（`@TestFactory` 的动态测试就是这样）；树被剪过枝时
//     测试自己的节点可能根本没报，父节点也可能缺。
//
// 本仓的等价物：`ParameterCollector` 逐行吃结构化事件、给出 `Parameter[]`（`ids` + `displayName`），
// 消费点：`src/components/TestRunnerPanel.vue` 把它们挂在对应测试节点下（上游的 invocation 节点），
// 判据 `tests/junit-parameters.test.mjs`。
import { parseTestEvent } from './testEventChannel.ts'

/** 上游 `JUnitParameterCollector.Parameter`（:80-81）的两个字段。 */
export interface Parameter { ids: string[]; displayName: string }

interface Node { id: string; parentId: string; name: string; locationHint: string | null }

/**
 * 只收两种节点（上游 `:268-276`）：`testStarted` / `suiteStarted`，
 * `id` / `parent` / `name` 三者缺一不可；`locationHint` 可以没有（动态测试就没有）。
 */
function parseNode(line: string): Node | null {
  const event = parseTestEvent(line)
  if (!event || (event.kind !== 'testStarted' && event.kind !== 'suiteStarted')) return null
  if (!event.id || !event.parent || !event.name) return null
  return { id: event.id, parentId: event.parent, name: event.name, locationHint: event.locationHint ?? null }
}

export class ParameterCollector {
  private readonly nodes: Node[] = []
  private readonly byId = new Map<string, Node>()

  /** 逐行喂结构化事件行（认不出的行直接丢，与上游 `ServiceMessageUtil.parse` 后判类型的口径一致）。 */
  feed(line: string): void {
    const node = parseNode(line)
    if (!node || this.byId.has(node.id)) return      // 同一个 id 只收第一份（重复喂入不重复计）
    this.nodes.push(node)
    this.byId.set(node.id, node)
  }

  // 数组没有 `clear()`（那是 Map/Set 的方法）：清数组要写 `length = 0`。
  reset(): void { this.nodes.length = 0; this.byId.clear() }

  /**
   * 某个测试（按它的 locationHint）的参数表；没有可选项时返回空数组（上游 `:243` 的口径）。
   */
  parametersFor(locationHint: string | null): Parameter[] {
    if (!locationHint) return []
    const ofTheTest = this.nodes.filter(node => this.isOfTheTest(node, locationHint))
    const containers = new Set(ofTheTest.map(node => node.parentId))
    const idsByName = new Map<string, string[]>()
    for (const node of ofTheTest) {
      if (containers.has(node.id)) continue          // 它是容器（测试本身），不是一次调用
      const ids = idsByName.get(node.name) ?? []
      ids.push(node.id)
      idsByName.set(node.name, ids)
    }
    if (idsByName.size < 2) return []
    return [...idsByName].map(([displayName, ids]) => ({ displayName, ids }))
  }

  /** 上游 `isOfTheTest`（:252-256）。 */
  private isOfTheTest(node: Node, locationHint: string): boolean {
    if (node.locationHint !== null) return node.locationHint === locationHint
    const parent = this.byId.get(node.parentId)
    return parent !== undefined && parent.locationHint === locationHint
  }
}

/** 参数表 → JUnit Platform 的显示名模式（`"adds(int, int)[1] 1, 2"` 里的那一段）。 */
export function parameterDisplayName(parameters: readonly Parameter[]): string[] {
  return parameters.map(parameter => parameter.displayName)
}
