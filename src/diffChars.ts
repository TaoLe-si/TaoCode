// `ByCharRt.kt:16-89,136-214,219-290` + `ChangeCorrector.kt:62-90`.
// Diff code points, but expose UTF-16 offsets to the existing DiffRow renderer.
import { alignLines } from './diffAlign.ts'
import { changedSpans, pairsToSpans, type MatchSpan, type ShiftToken } from './diffChunks.ts'
import { isDiffWhitespace, type ComparisonPolicy } from './diffComparison.ts'
import type { Mark } from './diffWords.ts'

export function codePointTokens(text: string, nonSpace = false): ShiftToken[] {
  const tokens: ShiftToken[] = []
  let start = 0
  for (const ch of text) {
    if (!nonSpace || !isDiffWhitespace(ch)) tokens.push({ start, text: ch })
    start += ch.length
  }
  return tokens
}

export function isDiffPunctuation(ch: string): boolean {
  const c = ch.codePointAt(0)!
  return c !== 95 && (c >= 33 && c <= 47 || c >= 58 && c <= 64 || c >= 91 && c <= 96 || c >= 123 && c <= 126)
}

export function comparePunctuationSpans(left: string, right: string): MatchSpan[] {
  const a = codePointTokens(left).filter(t => isDiffPunctuation(t.text))
  const b = codePointTokens(right).filter(t => isDiffPunctuation(t.text))
  return offsetSpans(a, b, alignLines(a.map(t => t.text), b.map(t => t.text)))
}

function offsetSpans(a: readonly ShiftToken[], b: readonly ShiftToken[], matches: ReturnType<typeof alignLines>): MatchSpan[] {
  const spans: MatchSpan[] = []
  for (const pair of matches) {
    const first = a[pair.from]!, second = b[pair.to]!
    appendSpan(spans, {
      a: { start: first.start, end: first.start + first.text.length },
      b: { start: second.start, end: second.start + second.text.length },
    })
  }
  return spans
}

/** Ordinary `ByCharRt.compare`: used only inside gaps by DefaultCharChangeCorrector. */
export function compareCharSpans(left: string, right: string): MatchSpan[] {
  const a = codePointTokens(left), b = codePointTokens(right)
  return offsetSpans(a, b, alignLines(a.map(t => t.text), b.map(t => t.text)))
}

function appendSpan(spans: MatchSpan[], span: MatchSpan): void {
  const last = spans[spans.length - 1]
  if (last && last.a.end === span.a.start && last.b.end === span.b.start) {
    last.a.end = span.a.end
    last.b.end = span.b.end
  } else spans.push(span)
}

/** `DefaultCharChangeCorrector.matchGap` compares ALL code points, not only whitespace. */
export function compareCharsTwoStep(left: string, right: string): MatchSpan[] {
  const a = codePointTokens(left, true), b = codePointTokens(right, true)
  const coarse = alignLines(a.map(t => t.text), b.map(t => t.text))
  const spans: MatchSpan[] = []
  let last1 = 0, last2 = 0
  const gap = (end1: number, end2: number): void => {
    for (const span of compareCharSpans(left.slice(last1, end1), right.slice(last2, end2))) {
      appendSpan(spans, {
        a: { start: last1 + span.a.start, end: last1 + span.a.end },
        b: { start: last2 + span.b.start, end: last2 + span.b.end },
      })
    }
  }
  for (const pair of coarse) {
    const first = a[pair.from]!, second = b[pair.to]!
    gap(first.start, second.start)
    last1 = first.start + first.text.length
    last2 = second.start + second.text.length
    appendSpan(spans, { a: { start: first.start, end: last1 }, b: { start: second.start, end: last2 } })
  }
  gap(left.length, right.length)
  return spans
}

function compareCharsIgnoringSpaces(left: string, right: string): MatchSpan[] {
  const a = codePointTokens(left, true), b = codePointTokens(right, true)
  const matches = pairsToSpans(alignLines(a.map(t => t.text), b.map(t => t.text)))
  return changedSpans(matches, a.length, b.length).map(span => {
    const previous1 = span.a.start === 0 ? 0 : a[span.a.start - 1]!.start + a[span.a.start - 1]!.text.length
    const previous2 = span.b.start === 0 ? 0 : b[span.b.start - 1]!.start + b[span.b.start - 1]!.text.length
    let shift = 0
    while (previous1 + shift < left.length && previous2 + shift < right.length &&
      left[previous1 + shift] === right[previous2 + shift] && isDiffWhitespace(left[previous1 + shift]!)) shift++
    const side = (tokens: readonly ShiftToken[], start: number, end: number, emptyOffset: number) => start === end
      ? { start: emptyOffset, end: emptyOffset }
      : { start: tokens[start]!.start, end: tokens[end - 1]!.start + tokens[end - 1]!.text.length }
    return {
      a: side(a, span.a.start, span.a.end, previous1 + shift),
      b: side(b, span.b.start, span.b.end, previous2 + shift),
    }
  })
}

/** `ByWordRt.TrimSpacesCorrector` (`ByWordRt.kt:590-623,989-1028`). */
export function trimSpaceChanges(changes: readonly MatchSpan[], left: string, right: string): MatchSpan[] {
  const atLineEdge = (text: string, offset: number): boolean => {
    if (offset < 0 || offset >= text.length || !isDiffWhitespace(text[offset]!)) return false
    let i = offset - 1
    while (i >= 0 && text[i] !== '\n' && isDiffWhitespace(text[i]!)) i--
    if (i < 0 || text[i] === '\n') return true
    i = offset
    while (i < text.length && text[i] !== '\n' && isDiffWhitespace(text[i]!)) i++
    return i === text.length || text[i] === '\n'
  }
  const trim = (text: string, range: MatchSpan['a']) => {
    let { start, end } = range
    if (atLineEdge(text, start)) while (start < end && isDiffWhitespace(text[start]!)) start++
    if (atLineEdge(text, end - 1)) while (start < end && isDiffWhitespace(text[end - 1]!)) end--
    return { start, end }
  }
  return changes.flatMap(span => {
    const a = trim(left, span.a), b = trim(right, span.b)
    return left.slice(a.start, a.end) === right.slice(b.start, b.end) ? [] : [{ a, b }]
  })
}

export function compareCharChanges(left: string, right: string, policy: ComparisonPolicy = 'default'): MatchSpan[] {
  if (policy === 'ignoreWhitespaces' || policy === 'ignoreWhitespacesChunks') return compareCharsIgnoringSpaces(left, right)
  const changes = changedSpans(compareCharsTwoStep(left, right), left.length, right.length)
  return policy === 'trimWhitespaces' ? trimSpaceChanges(changes, left, right) : changes
}

export function charMarks(left: string, right: string, policy: ComparisonPolicy = 'default'): { left: Mark[]; right: Mark[] } {
  const changes = compareCharChanges(left, right, policy)
  const marks = (side: 'a' | 'b'): Mark[] => changes.flatMap(span => {
    const range = span[side]
    return range.end > range.start ? [[range.start, range.end - range.start] as Mark] : []
  })
  return { left: marks('a'), right: marks('b') }
}
