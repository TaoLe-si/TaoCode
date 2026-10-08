// 求值历史的「树」—— 上游 `DebuggerTreeWithHistoryPanel` / `DebuggerTreeWithHistoryContainer`
// 里**树那一半**的等价物（`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/evaluate/
// quick/common/DebuggerTreeWithHistoryPanel.java:25-30/36-40`：一个树 + 一条工具条，
// 容器把「当前项」交给 `DebuggerTreeCreator.createTree(item)` 现造一棵树、标题用 `getTitle(item)`）。
//
// 本仓的分工（不重复任何一份已有规则）：
//   · 历史的**容器语义**（初始 index=-1、设为根 splice 插入、HISTORY_SIZE=11、back/forward
//     的可用性与 Alt+←/Alt+→）已经在 `src/debugValueHistory.ts` —— 本模块**不重复它**，
//     组件（`src/components/debug/DebugHistoryTree.vue`）直接 import 那一份；
//   · 一行值**长什么样**（分隔符 + `{类型}` + 值、不可见字符转义、`MAX_VALUE_LENGTH`）、
//     动作清单与可用性判据已经在 `src/debugTypeGrouping.ts`（`valueLineText` / `xValueNodeActions`）；
//   · 省略号节点（`{n} more items`）也在 `src/debugTypeGrouping.ts`（`pagedEllipsisNode`）；
//     分页计数在 `src/debugPaging.ts`（适配器的 `namedVariables`/`indexedVariables` 是唯一来源）。
// 这里补的只有两件事：
//   ① 历史条目怎么从 `evaluate` 回参造出来（历史里存的是表达式文本，要变成可展开的根就得
//      留下句柄 —— `reference` 与它的分页规模）；
//   ② 一次求值的根行 + 已取回的孩子行 + 省略号行怎么排（上游那棵树的可观察形状）。
//
// 判据 `tests/debug-history-tree.test.mjs`。本模块零 Vue、零 bridge 值依赖（只 type-import），
// 能被 `node --test` 直接加载。

import { evaluateResultPageInfo, evaluateResultReference, type EvaluateResultShape, type VariablePageInfo } from './debugPaging.ts'
import {
  actionVisibleInPopup, emptyCapabilities, pagedEllipsisNode, valueLineText, xValueNodeActions,
  type XValueNodeActionId, type XValueNodeActionItem, type XValueNodeCapabilities,
} from './debugTypeGrouping.ts'

/** 一条历史条目：表达式 + 它的求值结果（可展开时带句柄）。 */
export interface EvaluateHistoryEntry {
  /** 表达式文本（历史条目的身份，也是树根行的名字 —— 上游 `createDescriptorByNode` 的输入）。 */
  expression: string
  /** 根行的值文本（`XValueNodeImpl.buildText` 的输入，渲染时经 `valueLineText`）。 */
  value: string
  /** 值的类型（DAP `evaluate.type` 可选；空则行文本不画 `{类型}` 那一段）。 */
  type?: string
  /** 展开句柄（DAP `variablesReference`；<= 0 = 这个结果不可展开）。 */
  reference: number
  /** 这个容器上报的子项规模（适配器没报时 `paged` 为假，就不画省略号行）。 */
  page: VariablePageInfo
}

/** 一个孩子的形状 —— DAP `variables` 回的那几个字段（够画行、判断能不能展开、报不报总量）。 */
export interface HistoryTreeChild {
  name: string
  value: string
  type?: string
  reference: number
  /** 适配器为这个容器报的子项规模（`native/dap_shaping.cpp` 的 `shape_one_variable` 按需带出）。 */
  namedVariables?: number
  indexedVariables?: number
}

/** 一行（根 / 孩子 / 省略号）。`text` 是行上要画的那段文本，`name` 是行名（省略号行没有名字）。 */
export interface HistoryTreeRow {
  /** 稳定键（展开态按它存）：根行是 `root`，孩子行是 `child:<reference>`，省略号行是 `more`。 */
  key: string
  kind: 'root' | 'child' | 'ellipsis'
  name?: string
  /** 值的**原文**（未加分隔符/类型前缀）——「设为根」把它变成新根的 `value`，行文本由它再算一次。 */
  value: string
  /** 值的类型（原文）。 */
  type?: string
  text: string
  /** 这一行指向的容器 reference（省略号行是 0 —— 它不指向任何容器）。 */
  reference: number
  hasChildren: boolean
  /** 行动作（已按上游口径过滤掉不该画的；见 `historyRowActions`）。 */
  actions: XValueNodeActionItem[]
}

/** 根行的稳定键（一棵树里只有一个根行）。 */
export const HISTORY_ROOT_KEY = 'root'
/** 省略号行的稳定键。 */
export const HISTORY_MORE_KEY = 'more'

/**
 * 把一次 `evaluate` 的回参变成历史条目。
 * 句柄取 `reference` 优先、缺了退回 `variablesReference`（`src/debugPaging.ts` 的同一条规则，
 * `native/dap_values.cpp` 的 `shape_evaluate` 两个键都发）。
 */
export function evaluateHistoryEntry(
  expression: string, result: EvaluateResultShape | null | undefined,
): EvaluateHistoryEntry {
  return {
    expression,
    value: typeof result?.result === 'string' ? result.result : '',
    ...(result?.type ? { type: result.type } : {}),
    reference: evaluateResultReference(result),
    page: evaluateResultPageInfo(result ?? undefined),
  }
}

/**
 * 把一个**值节点**（不是表达式）变成历史条目 —— 「设为根」把选中的孩子提成新根时用它。
 * 规模只认适配器在这一行上报的两个字段（没报就是 `paged:false`，不假装知道还有多少）。
 */
export function historyValueEntry(
  name: string, value: string, type: string | undefined, reference: number,
  container?: { namedVariables?: number; indexedVariables?: number },
): EvaluateHistoryEntry {
  return {
    expression: name,
    value,
    ...(type ? { type } : {}),
    reference,
    page: evaluateResultPageInfo(container),
  }
}

/**
 * 树行的能力缺省 —— **没有通道的动作就报 false**（上游把这类动作按「隐藏」处理，
 * 不是画一个点不动的按钮）。这里的缺省刻意保守：
 *   · `hasName`/`computed` 真（历史条目就是一次已算出的求值的名字与值）；
 *   · `referrersProvider`/`canNavigateToTypeSource` 假 —— DAP 没有引用查询与类型源码位置
 *     （`src/bridge.ts` 的 `Method` union 里没有对应请求），所以 `ShowReferringObjectsAction`
 *     / `XJumpToTypeSourceAction` 两条在行菜单里**证明性地不出现**；
 *   · `modifier` 假 —— `setVariable` 要的是**父容器** reference，根行没有父容器；
 *   · `watchesView`/`consoleExecutable`/`evaluator` 假 —— 这三条要有宿主处理函数才画得出来
 *     （`src/components/debug/DebugHistoryTree.vue` 的 `delegate` 白名单：给了才画）。
 */
export function historyRootCapabilities(over: Partial<XValueNodeCapabilities> = {}): XValueNodeCapabilities {
  return { ...emptyCapabilities(), hasName: true, computed: true, ...over }
}

/** 一行可用的动作（上游 `XDebugger.ValueGroup` 的顺序，`hideDisabledInPopup = true` 与右键菜单同口径）。 */
export function historyRowActions(over: Partial<XValueNodeCapabilities> = {}): XValueNodeActionItem[] {
  return xValueNodeActions(historyRootCapabilities(over)).filter(entry => actionVisibleInPopup(entry, true))
}

/** 根行：名字是表达式，文本是值的行文本（`valueLineText`），能不能展开看句柄。 */
export function historyRootRow(entry: EvaluateHistoryEntry, over?: Partial<XValueNodeCapabilities>): HistoryTreeRow {
  return {
    key: HISTORY_ROOT_KEY,
    kind: 'root',
    name: entry.expression,
    value: entry.value,
    ...(entry.type ? { type: entry.type } : {}),
    text: valueLineText(entry.value, entry.type),
    reference: entry.reference,
    hasChildren: entry.reference > 0,
    actions: historyRowActions(over),
  }
}

/** 一个孩子上报的规模（适配器没报时 `paged:false`）。 */
export function historyChildPage(child: HistoryTreeChild): VariablePageInfo {
  return evaluateResultPageInfo(child)
}

/**
 * 孩子行 —— 每个孩子一行（名字 + 值的行文本），句柄 > 0 的可以继续展开；
 * 适配器报过总量且还没取完时，末尾补一个省略号行（`XCompositeNode.tooManyChildren` /
 * `MessageTreeNode.createEllipsisNode`，文案与「还有多少」都由 `pagedEllipsisNode` 给）。
 * 取完了就**没有**省略号行 —— 不画一个点不动的假节点。
 */
export function historyChildRows(
  children: readonly HistoryTreeChild[], loaded: number, info: VariablePageInfo,
): HistoryTreeRow[] {
  const rows: HistoryTreeRow[] = children.map((child, index) => ({
    key: `child:${child.reference || index}`,
    kind: 'child',
    name: child.name,
    value: child.value,
    ...(child.type ? { type: child.type } : {}),
    text: valueLineText(child.value, child.type),
    reference: child.reference,
    hasChildren: child.reference > 0,
    actions: historyRowActions({ computed: true }),
  }))
  const ellipsis = pagedEllipsisNode(loaded, info)
  if (ellipsis) {
    rows.push({
      key: HISTORY_MORE_KEY, kind: 'ellipsis', value: '', text: ellipsis.text, reference: 0,
      hasChildren: false, actions: [],
    })
  }
  return rows
}

/** 一棵历史树：根行 + 已取回的孩子行（顺序即渲染顺序）。 */
export function historyTreeRows(
  entry: EvaluateHistoryEntry, children: readonly HistoryTreeChild[] = [],
): HistoryTreeRow[] {
  return [historyRootRow(entry), ...historyChildRows(children, children.length, entry.page)]
}

/** 行菜单条目（`mode` 就是动作 id，宿主按它分派）。 */
export interface HistoryRowMenuItem {
  mode: XValueNodeActionId
  label: string
  disabled: boolean
  hint?: string
}

/**
 * 把一行的动作过滤成**画得出来**的菜单条目。
 * `supported` 是宿主真能处理的模式（含组件自己就做完的 `copy-value`/`copy-name`）——
 * 这一步保证菜单里不会出现一条没人接的动作（上游 hide-disabled 的口径在
 * `actionVisibleInPopup` 已经过滤过一次不可用的，这里再按宿主能力收一次）。
 */
export function historyRowMenuItems(
  row: HistoryTreeRow, supported: readonly XValueNodeActionId[],
): HistoryRowMenuItem[] {
  return row.actions
    .filter(entry => supported.includes(entry.id))
    .map(entry => ({
      mode: entry.id,
      label: entry.label,
      disabled: !entry.enabled,
      ...(entry.hint ? { hint: entry.hint } : {}),
    }))
}
