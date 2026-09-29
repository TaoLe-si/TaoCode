// DAP `exceptionInfo` —— IDEA 的 `JavaStackFrame.createExceptionNodes`
// （`java/debugger/impl/src/com/intellij/debugger/engine/JavaStackFrame.java:319-331`）。
//
// 那个方法做了两件事，两条都搬到这里：
//   1. 异常停住时把**抛出的异常对象**当成变量树里的一个节点展示
//      （`JavaValue.create(myNodeManager.getThrownExceptionObjectDescriptor(...))`）；
//   2. **只在最顶层帧**展示 —— `if (myDescriptor.getUiIndex() != 0) return Collections.emptyList();`
//      （第 319-321 行）。也就是说用户切到第 2 帧去看局部变量时，异常节点就该消失。
//
// 类型与判定都在这个模块里（纯函数、零依赖），组件只负责渲染。

/** DAP `ExceptionDetails` 的整形结果。所有字段都是可选的 —— 适配器给什么就有什么。 */
export interface DapExceptionDetails {
  message?: string
  typeName?: string
  fullTypeName?: string
  /** 能把这个异常对象当表达式求值的名字（适配器决定，例如 `this.cause`）。 */
  evaluateName?: string
  stackTrace?: string
  /** cause 链，规范允许任意深度。 */
  innerException?: DapExceptionDetails[]
}

/** 原生层整形后的 `exceptionInfo` 响应（`native/dap.cpp` 的 `shape_exception_info`）。 */
export interface DapExceptionInfo {
  available: boolean
  exceptionId?: string
  description?: string
  /** `always` | `never` | `unhandled` | `userUnhandled`（规范枚举，服务器可能给别的值）。 */
  breakMode?: string
  details?: DapExceptionDetails
}

/**
 * IDEA `JavaStackFrame:319-321` 的规则：异常节点只挂在最顶层帧（`getUiIndex() == 0`）。
 * DAP 的 `stackTrace` 把最顶层的帧放在 `frames[0]`，面板的选中索引 0 就是它。
 */
export function showsExceptionNode(selectedFrameIndex: number): boolean {
  return selectedFrameIndex === 0
}

/** 规范里的 `breakMode` 枚举。服务器给了表外的值就原样显示（不要静默吞掉）。 */
export const EXCEPTION_BREAK_MODES: Record<string, string> = {
  always: '总是',
  never: '从不',
  unhandled: '未捕获',
  userUnhandled: '用户未处理',
}

export function exceptionBreakModeLabel(mode: string | undefined): string {
  if (!mode) return ''
  return EXCEPTION_BREAK_MODES[mode] ?? mode
}

/**
 * 卡片标题。IDEA 的异常节点标题形状是 `类型: 消息`，所以优先用
 * `details.typeName` + `details.message`；适配器没给 details 时退回 `description`。
 * 都没有就回空串 —— 组件据此不渲染卡片。
 */
export function exceptionHeadline(info: DapExceptionInfo | undefined | null): string {
  if (!info?.available) return ''
  const details = info.details
  const type = details?.typeName || info.exceptionId || ''
  const message = details?.message ?? ''
  if (type && message) return `${type}: ${message}`
  if (type) return type
  return info.description ?? ''
}

/** cause 链拍平后的一行。 */
export interface ExceptionCause {
  /** 0 = 抛出的那个异常，1 = 它的 cause，依次类推。 */
  depth: number
  type: string
  message: string
  fullTypeName: string
  evaluateName: string
  stackTrace: string
}

/**
 * 把 cause 链拍平成一个列表，便于直接 `v-for` 渲染。
 *
 * 用**迭代 + 逐层数组**而不是递归：适配器可以给出任意深度的 `innerException`，
 * 递归版本在恶意/有环的响应上会把渲染线程爆掉；这里还有 `limit` 兜底。
 * `limit` 的语义是「最多这么多行」，超出部分丢弃（宁可少显示，不可卡死）。
 */
export function flattenCauseChain(info: DapExceptionInfo | undefined | null, limit = 16): ExceptionCause[] {
  const root = info?.details
  if (!info?.available || !root || limit <= 0) return []
  const causes: ExceptionCause[] = []
  let level: DapExceptionDetails[] = [root]
  let depth = 0
  while (level.length && causes.length < limit) {
    const next: DapExceptionDetails[] = []
    for (const item of level) {
      if (causes.length >= limit) break
      causes.push({
        depth,
        type: item.typeName || '',
        message: item.message || '',
        fullTypeName: item.fullTypeName || '',
        evaluateName: item.evaluateName || '',
        stackTrace: item.stackTrace || '',
      })
      // 必须 `Array.isArray`：只判 `?.length` 的话，一个字符串（适配器写错成
      // `"innerException": "nope"`）会因为字符串也有 length 而进 spread，
      // 把它拆成一个个字符当成异常行渲染出来。
      if (Array.isArray(item.innerException)) next.push(...item.innerException)
    }
    level = next
    depth++
  }
  return causes
}

/** 适配器有没有给出可以展开的异常对象（IDEA 的 `JavaValue` 展开需要它）。 */
export function exceptionValueExpression(info: DapExceptionInfo | undefined | null): string {
  return info?.available ? info.details?.evaluateName ?? '' : ''
}
