// 行内补全的**多建议导航与部分接受**（上游 `platform/inline-completion/shared/src/InlineCompletionHandlerImpl.kt`：
// 多个建议时 Alt+] / Alt+[ 循环切换；Tab 全接受，Ctrl+Right 只接受下一个词 —— 所谓「部分接受」）。
//
// 本仓现状：`src/inlineCompletion.ts` 只管「显示什么灰字、接受时替换哪一段、Esc 该不该收」，
// 多建议的循环与部分接受还没有规则；`src/inlineCompletionExtension.ts` 只取第一条建议。
// 这个模块补纯规则，扩展侧接线时只做「读下标 → 调 span → dispatch」。

import { INLINE_TRIGGER_KINDS, type InlineCompletionItem } from './inlineCompletion.ts'

/** 循环取第 `delta` 条建议（+1 下一条 / -1 上一条；两端环绕 —— IDEA 的 alt+] 从最后一条回到第一条）。 */
export function cycleSuggestionIndex(index: number, delta: number, count: number): number {
  if (!Number.isInteger(count) || count <= 0) return -1
  const step = Number.isInteger(delta) ? delta : 0
  return ((index + step) % count + count) % count
}

/** 循环后的建议（越界/空列表给 undefined，调用方据此不渲染）。 */
export function cycleSuggestion(items: readonly InlineCompletionItem[] | undefined, index: number, delta: number): InlineCompletionItem | undefined {
  if (!Array.isArray(items) || !items.length) return undefined
  const next = cycleSuggestionIndex(index, delta, items.length)
  return next >= 0 ? items[next] : undefined
}

/**
 * 部分接受：灰色文本里**下一个词**的结束偏移（相对插入内容）。
 * 词 = 连续的标识符字符 / 一串空白 + 其后的标识符（IDEA 的「接受下一个词」把前导空白一起吃掉，
 * 不然 Tab 之后光标会停在空格前，看着没动）。
 * 没有可接受的词时返回整串长度（等同于全接受）。
 */
export function nextWordEnd(text: string): number {
  if (!text) return 0
  const match = /^(?:\s+)?[$\p{L}\p{N}_]+/u.exec(text)
  return match ? match[0].length : text.length
}

/**
 * 部分接受的替换区间：在当前建议的接受区间上只吃到下一个词。
 * `acceptSpan` 是 `inlineAcceptSpan` 算出的整段；光标在 `anchor`（建议起点，通常是光标位置）。
 * 返回 `{ from, to, insert }`（全文档偏移由扩展层换算；这里只给相对量）。
 */
export interface PartialAccept {
  /** 相对接受区间起点的字符数：替换这一段的已有文本。 */
  replaceLength: number
  /** 实际插入的文本（整段的前 N 个字符）。 */
  insert: string
  /** 还没接受的部分（继续按 Ctrl+Right 时从这里再吃）。 */
  rest: string
}

export function partialAccept(item: InlineCompletionItem | undefined | null, alreadyAccepted = 0): PartialAccept | null {
  if (!item || typeof item.insertText !== 'string' || item.insertText === '') return null
  const offset = Math.max(0, Math.min(item.insertText.length, Math.floor(alreadyAccepted)))
  const remaining = item.insertText.slice(offset)
  const take = nextWordEnd(remaining)
  return {
    replaceLength: 0,
    insert: item.insertText.slice(0, offset + take),
    rest: item.insertText.slice(offset + take),
  }
}

/**
 * 拒绝建议后重问的触发类型：LSP `InlineCompletionTriggerKind`。
 * 用户按 Esc 拒了、又继续打字 → 自动触发（1）；用户按 Alt+] 之后没有再问（本地循环）。
 * 这个函数只回答「显式重试」这一档：上一次建议被拒后 3 秒内**同一个前缀位**的重问用 Retrigger(3)，
 * 让服务器知道「这是被拒过的位置」（IDEA 也是用它区分重试与自动）。
 */
export function inlineTriggerKindFor(reason: 'automatic' | 'explicit' | 'retrigger'): number {
  if (reason === 'explicit') return INLINE_TRIGGER_KINDS.explicit
  if (reason === 'retrigger') return INLINE_TRIGGER_KINDS.retrigger
  return INLINE_TRIGGER_KINDS.automatic
}

/** 建议的身份键（去重与「同一个建议不重复弹」用；range 起点 + 插入文本）。 */
export function suggestionKey(item: InlineCompletionItem | undefined | null): string {
  if (!item) return ''
  const range = item.range
  const start = range ? `${range.startLine}:${range.startChar}` : 'cursor'
  return `${start}:${item.insertText}`
}

/** 去重：同一身份键只留第一条（服务器重发时列表会带重复项）。 */
export function dedupeSuggestions(items: readonly InlineCompletionItem[] | undefined): InlineCompletionItem[] {
  if (!Array.isArray(items)) return []
  const seen = new Set<string>()
  const out: InlineCompletionItem[] = []
  for (const item of items) {
    if (!item || typeof item.insertText !== 'string' || item.insertText === '') continue
    const key = suggestionKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}
