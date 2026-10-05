// 多行求值对话框的**口径**与行计划 —— 上游 `XExpressionDialog` / `CodeFragmentInputComponent`
// （`platform/xdebugger-impl/.../evaluate/`）与 `XDebuggerMultilineEditor`
// （`platform/lang-impl/.../debugger/editor/`；`EvaluationMode.CODE_FRAGMENT` 时输入框是多行代码片段编辑器）。
//
// 口径（为什么是「逐行求值」而不是「拼成一条」）：
//   DAP 的 `evaluate` 请求收的是**一个表达式**，规范里没有「语句块/代码片段」的形态
//   （`DebugProtocol.EvaluateRequest`：expression 是 "expression to evaluate"）。把多行文本
//   原样拼给它，只有少数适配器（它们自己解释 expression）能跑，多数会直接报语法错；
//   于是本仓的口径是 —— **逐行求值**：每个非空行作为一条独立表达式，在**同一个栈帧**上下文
//   里按顺序求值；某行失败不阻断后续行（REPL 语义，失败行就地标红），结果按行回填。
//   这与上游「JVM 编译整个片段」不同：`int b = a + 1;` 这种赋值语句在 DAP 下会失败，
//   对话框会在提示里写清「每行必须是一条可求值的表达式」。
//
//   两种模式（上游 `EvaluationMode`）：
//     · `expression` —— 单行表达式（`DebugEvaluateDialog.vue` 只渲染一个 input）；
//     · `codeFragment` —— 多行（textarea + 逐行求值）。默认模式来自设置
//       `debuggerEvaluationMode`（XDebuggerGeneralSettings.getEvaluationDialogMode）。
//
// 本模块只做「文本 → 行计划」的纯规则，可单测。

/** 单次提交最多求值多少行（防止把适配器当成脚本引擎压垮）。 */
export const MULTILINE_MAX_LINES = 32

export interface MultilinePlan {
  /** 要逐行求值的表达式（已 trim、去空行；注释行原样保留由适配器裁决）。 */
  lines: string[]
  /** 因空行跳过的行数（给用户看的说明）。 */
  skipped: number
  /** 因超过上限被截断的行数（>0 时对话框要提示）。 */
  truncated: number
}

/** 把 textarea 文本拆成行计划：去空行、trim、上限截断。 */
export function planMultilineEvaluate(text: string, max = MULTILINE_MAX_LINES): MultilinePlan {
  const raw = text.split(/\r?\n/).map(line => line.trim())
  const nonEmpty = raw.filter(Boolean)
  return {
    lines: nonEmpty.slice(0, Math.max(1, max)),
    skipped: raw.length - nonEmpty.length,
    truncated: Math.max(0, nonEmpty.length - Math.max(1, max)),
  }
}

/**
 * 结果行的归属（对话框渲染用）：`lines[i]` 的第 i 条结果。失败行带 `error`，
 * 后面的行仍会执行 —— 这是与「片段编译」最关键的行为差异，写在这里而不是 UI 里。
 */
export interface MultilineResultLine {
  expression: string
  /** `expression = value` 或错误文案（错误时 `error` 为 true）。 */
  text: string
  error: boolean
}

/** 单条结果的显示文本（与单行求值框的格式一致：`expr = value : type`）。 */
export function multilineResultText(expression: string, value: string, type?: string): string {
  return `${expression} = ${value}${type ? ` : ${type}` : ''}`
}
