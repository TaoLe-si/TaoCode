// 变量/监视树行的**动作清单** —— 从 `src/components/DebugPanel.vue` 里那段内联
// `rowActions()` 搬出来的纯函数（面是 `DebugRowMenu.vue`，它是本轮的组件落点）。
//
// 上游这一组动作住在 `platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/ui/tree/actions/`，
// 逐条对应：
//   · 复制值 / 复制名称 —— `XCopyValueAction` / `XCopyNameAction`；
//   · 添加到监视 —— `XAddToWatchesTreeAction`；
//   · 在控制台中求值 —— `EvaluateInConsoleFromTreeAction`；
//   · 按数组显示 —— 任务书的 ViewAsArray 语义（上游 tree/actions 里没有同名类）；
//   · 检查 —— `XInspectAction.java:22-30`（开 `XInspectDialog`）；
//   · 与剪贴板比较 —— `XCompareWithClipboardAction.java:31-36`（值文本 vs 剪贴板 diff）。
//
// **两件上游有、这里故意不渲染的事**（不是忘了做，是按上游口径就不该出现）：
//   · 「显示引用对象」`ShowReferringObjectsAction.java:39-41`：`isEnabled` 等价于
//     `node.getValueContainer().getReferrersProvider() != null`，而它的 `update` 又把
//     动作设成「不可用就**隐藏**」（`:32-36`）。DAP 的 `variables` 回答里没有任何
//     「这个值能查引用」的字段，所以在本仓它永远是「不可用」⇒ 按上游就该隐藏，
//     画一个点不动的条目就是假控件。
//   · 「跳到类型源码」`XJumpToTypeSourceAction.kt:14-16`：`isEnabled` 要求
//     `node.valueContainer.canNavigateToTypeSource()`，跳转走
//     `XDebuggerNavigationApi.navigateToXValueType`（`:11-12`）。DAP `variables` 不带
//     值的源码位置 ⇒ 同样只能隐藏。真正要补得先有「类型名 → 源码位置」的查找通道。
import type { DapVariable } from './bridge'
import { canViewAsArray, type VarRow } from './debugDataView.ts'

export type DebugRowActionMode =
  | 'copy-value' | 'copy-name' | 'watch' | 'console' | 'array-on' | 'array-off'
  | 'inspect' | 'compare-clipboard'

export interface DebugRowActionTarget {
  /** 适配器给的 `evaluateName`（加监视/进控制台用它求值）；没有就退回变量名。 */
  expression: string
  /** 该行自己的 reference（`arrayViews` 的键、检查窗口的根）。 */
  reference: number
  /** 行是不是真变量（组行不是 —— 它没有值可看）。 */
  isValue: boolean
  /** 行上显示的值文本（空 = 没有可比的文本）。 */
  value: string
  /** 该行现在处于「按数组显示」。 */
  arrayView: boolean
  /** 孩子已经加载且全是索引形态 ⇒ 「按数组显示」可用。 */
  canArray: boolean
}

export interface DebugRowActionItem {
  mode: DebugRowActionMode
  label: string
  disabled?: boolean
  /** 不可点的原因（进 `title`，让禁用项把话说明白）。 */
  hint?: string
}

const NO_VALUE = '这一行没有值'

/**
 * 变量行 → 清单的入参。放在这里而不是 `DebugPanel.vue` 里：判据只依赖**行本身**
 * （`VarRow` 的 `evaluateName` / `apiName` / `group` / `value`）、**孩子有没有加载**
 * 与**当前处于「按数组显示」的容器集合**，三样都是这一行的上下文，不该由面板现场拼。
 * `expression` 口径同面板：`evaluateName` 优先，没有就退回 `apiName`；组行没有可求值的
 * 表达式（`group` 行的 `apiName` 是合成出来的名字，求值它没有意义）。
 */
export function debugRowTarget(
  row: VarRow, children: readonly DapVariable[], arrayViews: readonly number[],
): DebugRowActionTarget {
  return {
    expression: row.evaluateName ?? (row.group ? '' : row.apiName),
    reference: row.reference,
    isValue: !row.group,
    value: row.value,
    arrayView: arrayViews.includes(row.reference),
    canArray: row.expandable && canViewAsArray(children),
  }
}

/** 该行现在处于「按数组显示」时，条目是「取消」；否则是「按数组显示」。 */
export function debugRowActions(
  target: DebugRowActionTarget, context: { paused: boolean },
): DebugRowActionItem[] {
  const hasExpression = Boolean(target.expression)
  const hasValue = target.isValue && target.value.trim() !== ''
  return [
    { mode: 'copy-value', label: '复制值', disabled: !target.isValue, hint: target.isValue ? undefined : '这一行不是变量' },
    { mode: 'copy-name', label: '复制名称' },
    {
      mode: 'watch', label: '添加到监视',
      disabled: !hasExpression, hint: hasExpression ? undefined : '适配器没给可求值的表达式',
    },
    {
      mode: 'console', label: '在控制台中求值',
      disabled: !hasExpression || !context.paused,
      hint: !hasExpression ? '适配器没给可求值的表达式' : context.paused ? undefined : '要先停在断点上',
    },
    {
      mode: target.arrayView ? 'array-off' : 'array-on',
      label: target.arrayView ? '取消按数组显示' : '按数组显示',
      disabled: !target.arrayView && !target.canArray,
      hint: target.arrayView || target.canArray ? undefined : '孩子还没加载，或不是索引形态',
    },
    {
      mode: 'inspect', label: '检查',
      disabled: !target.isValue, hint: target.isValue ? undefined : '这一行不是变量',
    },
    {
      mode: 'compare-clipboard', label: '与剪贴板比较',
      disabled: !hasValue, hint: hasValue ? undefined : NO_VALUE,
    },
  ]
}
