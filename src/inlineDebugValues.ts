// 行内调试值（xdebugger `dbg/inline`：上游 `XDebuggerInlineValuesProvider` /
// `InlineDebugRenderer` 的等价物）的**纯规则**。
//
// 用户可见行为：调试暂停时，编辑器在**用到变量名的那些行**的行尾补一段灰色的
// 「名字 = 值」，鼠标不用离开代码就能看到当前帧里每个变量的值。上游在 IDEA 里由
// `EditorInlineValues` 的 per-line 提供者给出值、`InlineDebugRenderer` 画在行尾；
// 本仓的数据源是 DAP（`native/dap.cpp` 的 `variables` 请求），所以这里只做
// 「(文档行, 变量列表) → 每行该显示什么」这一步，纯函数、可单测。
//
// 值的取法（与 `EditorInlineValues` 的 `getInlineValuesForLine` 一致的保守子集）：
//   · 只认**整词**出现（大小写敏感），避免把 `x` 塞进 `xylophone` 的行尾；
//   · 名字与值相同的跳过（`i = i` 没有信息量）；
//   · 单行最多 `INLINE_VALUE_MAX_PER_LINE` 条、单值截到 `INLINE_VALUE_MAX_TEXT`
//     （上游 `InlineDebugRenderer` 的值段也有长度上限，防止一行被值淹没）。
import type { DapVariable } from './bridge'

export interface InlineValueVariable { name: string; value: string; type?: string }

/** 一行最多显示几条值。 */
export const INLINE_VALUE_MAX_PER_LINE = 3
/** 单个值的最大显示长度（超出截断加省略号）。 */
export const INLINE_VALUE_MAX_TEXT = 80

export function inlineVariableOf(variable: DapVariable): InlineValueVariable | null {
  const name = variable.name?.trim()
  const value = variable.value?.trim()
  if (!name || !value) return null
  // `{...}` / `[...]` 是容器摘要，没有信息量；空串已经在上一步排除。
  if (name === value) return null
  return { name, value, type: variable.type }
}

function truncate(text: string): string {
  return text.length > INLINE_VALUE_MAX_TEXT ? `${text.slice(0, INLINE_VALUE_MAX_TEXT - 1)}…` : text
}

/**
 * 每行该附加的行内值文本（1 基行号；`text` 是拼接好几个「名字 = 值」的一整段）。
 * 行里没用到任何变量就不产出条目 —— 这是与「每行都贴一遍作用域」的关键区别，
 * 也是上游 `EditorInlineValues` 的 per-line 语义。
 */
export function collectInlineValues(lines: readonly string[], variables: readonly InlineValueVariable[]): { line: number; text: string }[] {
  const byName = new Map<string, InlineValueVariable>()
  for (const variable of variables) if (!byName.has(variable.name)) byName.set(variable.name, variable)
  if (!byName.size) return []
  const entries: { line: number; text: string }[] = []
  lines.forEach((lineText, index) => {
    if (!lineText) return
    const parts: string[] = []
    const seen = new Set<string>()
    for (const match of lineText.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const name = match[0]
      if (seen.has(name)) continue
      const variable = byName.get(name)
      if (!variable) continue
      seen.add(name)
      parts.push(`${name} = ${truncate(variable.value)}`)
      if (parts.length >= INLINE_VALUE_MAX_PER_LINE) break
    }
    if (parts.length) entries.push({ line: index + 1, text: parts.join('   ') })
  })
  return entries
}
