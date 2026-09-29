// DAP `completions` —— 调试表达式输入框的补全（Evaluate / Watches 的输入框）。
//
// **IDEA 侧没有平台级对应类**（核实过，不要照抄一个看起来像的名字）：
// `XDebuggerEvaluator`（`platform/xdebugger-api/src/com/intellij/xdebugger/evaluation/XDebuggerEvaluator.java:25`）
// 只有 `evaluate`，没有补全方法；debugger 域也没有注册 `CompletionContributor`。
// 真实链路是「**调试上下文的可见符号** + 语言的通用补全」：Java/JDI 侧由
// `StackFrameProxyImpl.visibleVariables()` 提供可见变量（被
// `java/debugger/impl/src/com/intellij/debugger/engine/ContextUtil.java:91` 使用），补全本身走语言插件。
// 对 DAP 来说这件事被收进协议 —— 适配器自己知道当前帧可见哪些符号。
//
// 这个模块只负责"把适配器给的项落成 UI 能用的形状"，不做请求。

export interface DapCompletionItem {
  /** 显示名。**没有 label 的项在 UI 里既显示不了也选不中**，一律丢掉。 */
  label: string
  /** 实际插入的文本；缺省时用 label。 */
  text?: string
  /** 适配器自定义的类型名（`variable` / `field` / `method` …）。 */
  type?: string
  /** 在**请求文本里**的替换区间（规范可选）。两者必须同时存在才可用。 */
  start?: number
  length?: number
}

export interface DapCompletionsResult {
  available: boolean
  items?: DapCompletionItem[]
}

/**
 * 落成可显示的候选列表：丢掉没有 label 的、按 label 去重（同一名字出现两次在原生 `<datalist>`
 * 里会显示两遍），并保持适配器给的顺序（顺序通常带语义，比如"最可能在前"）。
 */
export function completionSuggestions(items: readonly DapCompletionItem[] | undefined): DapCompletionItem[] {
  if (!Array.isArray(items)) return []
  const seen = new Set<string>()
  const out: DapCompletionItem[] = []
  for (const item of items) {
    if (!item || typeof item.label !== 'string' || item.label === '') continue
    if (seen.has(item.label)) continue
    seen.add(item.label)
    out.push(item)
  }
  return out
}

/** 选中一项后应该得到什么文本。`start`/`length` 只有**同时**给出且合法时才用来替换一段。 */
export function applyCompletionItem(text: string, item: DapCompletionItem | undefined): string {
  if (!item) return text
  const insert = item.text ?? item.label
  const start = item.start
  const length = item.length
  // 只给一个（畸形）或区间越界时按"整段替换"降级：按一个误导性的 start 去切字符串
  // 会把用户已经输入的内容切坏，比不做局部替换糟得多。
  if (typeof start === 'number' && typeof length === 'number' && Number.isInteger(start) && Number.isInteger(length) &&
      start >= 0 && length > 0 && start + length <= text.length) {
    return text.slice(0, start) + insert + text.slice(start + length)
  }
  return insert
}

/** 规范里 `type` 的常见取值 → 可读标签（给候选列表右侧的类型提示用）。表外的值原样显示。 */
export const COMPLETION_TYPE_LABELS: Record<string, string> = {
  method: '方法',
  function: '函数',
  constructor: '构造函数',
  field: '字段',
  variable: '变量',
  class: '类',
  interface: '接口',
  module: '模块',
  property: '属性',
  unit: '单元',
  value: '值',
  enum: '枚举',
  keyword: '关键字',
  snippet: '片段',
  text: '文本',
  color: '颜色',
  file: '文件',
  reference: '引用',
}

export function completionTypeLabel(type: string | undefined): string {
  if (!type) return ''
  return COMPLETION_TYPE_LABELS[type] ?? type
}
