// 内联提示的**布局与去重**（上游 `platform/lang-impl/src/com/intellij/codeInsight/hints/`：
// `InlayHintsProvider` 出的条目在 `InlayHintsSink` 里按 offset 归位，同一位置重复注册时
// 由 `InlayHintsSettings`/`InlayHintsCollector` 的去重与优先级决定留哪一条；一行太挤时
// 编辑器会先放弃可读性最弱的那几条，而不是把整行染成一团灰）。
//
// 本仓现状：`src/inlayHints.ts` 有「按类型开关 + 显示文本 + 点击命令」的纯规则，但**渲染前的
// 归位与去重**没有：LSP 服务器可能在同一位置同时发参数名与类型提示，两个 `InlayWidget`
// 会叠在一起。这个模块补渲染前的最后一道纯规则（开关过滤 → 排序 → 去重 → 同位置优先级 → 行内上限），
// 并返回被隐藏条目的计数 —— 用户看不到假象，测试也能钉住"谁被藏了、为什么"。

import { shouldShowInlayHint, type InlayHintLike, type InlayHintToggles, DEFAULT_INLAY_HINT_TOGGLES } from './inlayHints.ts'

/** 同位置冲突时的优先级：参数名（可操作）> 类型 > 其它。数字越小越优先。 */
export function inlayHintPriority(hint: InlayHintLike): number {
  if (hint.kind === 2) return 0
  if (hint.kind === 1) return 1
  return 2
}

export interface InlayLayoutOptions {
  /** 一行最多画几条（默认 6；超出按字符位置从后往前丢，保住靠近行首的）。 */
  maxPerLine?: number
}

/**
 * 「一行不设上限」的值。
 *
 * 上游**没有**逐行条数上限：它的上限是**单条提示自己的 presentation 树节点预算**
 * （`PresentationTreeBuilderImpl.kt:138-153` 的 `MAX_NODE_COUNT` / `InlayTreeBuildingContext.addNode`，
 * 超出就把那条提示自己的尾巴换成 `…`），管的是"一条提示里能画多少个节点"，不是"一行能放几条"。
 * 所以渲染层接这个模块时要显式传本值，别让上面那个 6 悄悄变成产品行为。
 */
export const NO_INLAY_HINT_LINE_LIMIT = Number.MAX_SAFE_INTEGER

export interface InlayLayoutResult {
  hints: InlayHintLike[]
  hidden: {
    /** 被按类型开关关掉的条数。 */
    toggle: number
    /** 与更靠前条目完全重复（同位置同文本）的条数。 */
    duplicate: number
    /** 同位置不同文本、优先级更低被压掉的条数。 */
    conflict: number
    /** 超出行内上限被丢掉的条数。 */
    overflow: number
  }
}

/** 位置同键（行 + 列），用于去重与同位置优先级。 */
function positionKey(hint: InlayHintLike): string {
  return `${hint.line}:${hint.character}`
}

/**
 * 渲染前的归位：非法条目先丢；再按开关过滤；稳定排序（行 → 列 → 输入顺序）；
 * 同位置完全重复只留一条；同位置不同文本按优先级留一条；最后每行截到上限。
 */
export function layoutInlayHints(
  hints: readonly InlayHintLike[] | undefined,
  toggles: InlayHintToggles = DEFAULT_INLAY_HINT_TOGGLES,
  options: InlayLayoutOptions = {},
): InlayLayoutResult {
  const hidden = { toggle: 0, duplicate: 0, conflict: 0, overflow: 0 }
  const maxPerLine = Number.isInteger(options.maxPerLine) ? Math.max(1, options.maxPerLine as number) : 6
  const valid: Array<{ hint: InlayHintLike; index: number }> = []
  const list = Array.isArray(hints) ? hints : []
  for (let index = 0; index < list.length; ++index) {
    const hint = list[index]
    if (!hint || !Number.isInteger(hint.line) || hint.line < 0 || !Number.isInteger(hint.character) || hint.character < 0) continue
    if (typeof hint.label !== 'string' || hint.label === '') continue
    if (!shouldShowInlayHint(hint, toggles)) { ++hidden.toggle; continue }
    valid.push({ hint, index })
  }
  valid.sort((left, right) =>
    left.hint.line - right.hint.line || left.hint.character - right.hint.character
    || inlayHintPriority(left.hint) - inlayHintPriority(right.hint) || left.index - right.index)

  const kept: InlayHintLike[] = []
  const seenText = new Map<string, string>()
  const perLine = new Map<number, number>()
  for (const { hint } of valid) {
    const key = positionKey(hint)
    const text = `${hint.paddingLeft ? ' ' : ''}${hint.label}${hint.paddingRight ? ' ' : ''}`
    const prior = seenText.get(key)
    if (prior !== undefined) {
      if (prior === text) ++hidden.duplicate
      else ++hidden.conflict
      continue
    }
    seenText.set(key, text)
    const count = perLine.get(hint.line) ?? 0
    if (count >= maxPerLine) { ++hidden.overflow; continue }
    perLine.set(hint.line, count + 1)
    kept.push(hint)
  }
  return { hints: kept, hidden }
}

/** 被隐藏条数合计（状态栏/调试用；全 0 时不显示任何提示）。 */
export function hiddenInlayCount(result: InlayLayoutResult): number {
  return result.hidden.toggle + result.hidden.duplicate + result.hidden.conflict + result.hidden.overflow
}

/** 一行有几条可见提示（渲染层按行分组时用）。 */
export function inlayHintsByLine(hints: readonly InlayHintLike[]): Map<number, InlayHintLike[]> {
  const byLine = new Map<number, InlayHintLike[]>()
  for (const hint of hints) {
    const list = byLine.get(hint.line) ?? []
    list.push(hint)
    byLine.set(hint.line, list)
  }
  return byLine
}
