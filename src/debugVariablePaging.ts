// DAP **变量分页的视图侧状态**：每个容器 reference 已经取回多少子项、适配器为这个
// 容器声明的规模（`namedVariables`/`indexedVariables`）。
//
// 为什么单独成模块：分页的**规则**（一页怎么切、还有多少、下一页从哪开始）已经在
// `src/debugPaging.ts`（纯函数）；这里只保留"每个 reference 当前取到哪"这一份**跨渲染
// 存活的状态**。面板（`DebugPanel.vue`）贴着机检上限，把它挪出来既让"展开过的容器下次
// 还能续页"这件事可单测，也让面板的 `loadScope`/`loadMore` 各自只剩一条 DAP 调用。
//
// 规模的**唯一来源是适配器**：`DapVariable`/`DapScope` 在 native 整形里都带
// `namedVariables`/`indexedVariables`（`native/dap_shaping.cpp:208-235`），适配器没报时
// `variablePageInfo` 给 `paged:false` ⇒ 不假装知道总量，也就没有"加载更多"。
//
// 判据 tests/debug-variable-paging.test.mjs。
import { reactive } from 'vue'
import {
  DEFAULT_VARIABLE_PAGE, nextVariablePage, remainingVariableChildren, variablePageInfo,
  type VariablePage, type VariablePageInfo,
} from './debugPaging.ts'

/** 一个容器（作用域 / 变量 / 求值结果）上适配器声明子项规模的那两个字段。 */
export interface ValueContainer {
  namedVariables?: number
  indexedVariables?: number
}

interface ValueSize {
  /** 已经取回的子项条数（0 基下一页的起点）。 */
  loaded: number
  /** 适配器声明的规模（没报时 `paged:false`）。 */
  info: VariablePageInfo
}

/** reference → 已取回/规模。`reactive` 是为了"加载更多"按钮的出现能跟着变。 */
export const valueSizes = reactive<Record<number, ValueSize>>({})

/** 一次停机/切帧/换会话的清空（每个 reference 只在**同一次停机**里有效）。 */
export function forgetValuePages(): void {
  for (const key of Object.keys(valueSizes)) delete valueSizes[Number(key)]
}

/**
 * 记下"这个引用现在取回了多少"。**容器的规模只在第一次记时保存**：续页时调用方拿不到
 * 容器对象（`loadMore` 只吃 reference），而传入的 `container` 为 `undefined` 时就保留上次那份
 * 规模（重记成"没报规模"会把已知的总量冲没，导致"加载更多"按钮消失）。
 * `reference <= 0` 是"不可展开"（标量），不占一格。
 */
export function rememberValuePage(reference: number, container: ValueContainer | undefined, loaded: number): void {
  if (!Number.isFinite(reference) || reference <= 0) return
  const count = Number.isFinite(loaded) && loaded > 0 ? Math.trunc(loaded) : 0
  const previous = valueSizes[reference]
  valueSizes[reference] = { loaded: count, info: container ? variablePageInfo(container) : (previous?.info ?? variablePageInfo(undefined)) }
}

/** 这个容器还有多少子项没取回（适配器没报规模时是 0）。 */
export function valueRemaining(reference: number): number {
  const size = valueSizes[reference]
  return size ? remainingVariableChildren(size.loaded, size.info) : 0
}

/** 下一页参数；取完 / 没报规模时是 `null`（与 `nextVariablePage` 同义）。 */
export function nextValuePage(reference: number): VariablePage | null {
  const size = valueSizes[reference]
  return size ? nextVariablePage(size.loaded, size.info, DEFAULT_VARIABLE_PAGE) : null
}

export { DEFAULT_VARIABLE_PAGE }
