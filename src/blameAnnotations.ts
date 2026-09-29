// GitFileAnnotation.getAspects: Revision (hidden by default), Date, Author.

export interface BlameAnnotation {
  /** 1 基行号（与编辑器的行号一致）。 */
  line: number
  /** 装订线上显示的文本。 */
  text: string
  /** 悬停提示（作者邮箱 + 提交摘要 + 完整哈希 —— IDEA 的 tooltip 也是这些）。 */
  tooltip: string
  date?: string
  author?: string
}

/** `git.blame` 一行（字段与 native 的 `git.blame` 返回一致；缺失的都是空串）。 */
export interface BlameLineInput {
  line: number
  author: string
  hash: string
  date: string
  email?: string
  summary?: string
}

/** 短哈希：IDEA 的注解列默认显示 7 位（`VcsLogUtil.SHORT_HASH_LENGTH`）。 */
export const SHORT_HASH_LENGTH = 7

export function shortHash(hash: string): string {
  return hash.slice(0, SHORT_HASH_LENGTH)
}

// ShowShortenNames.getType defaults to LASTNAME; ShortNameType.shorten does not
// cap character count. Names recovered from an email are capitalized.
export function blameAuthorName(input: string): string {
  const raw = input.trim().replace(/\s+/g, ' ')
  let name = raw
  let fromEmail = false
  const start = name.indexOf('<'), end = name.indexOf('>'), at = name.indexOf('@')
  if (start >= 0 && start < at && at < end) {
    const prefix = name.slice(0, start).trim(), suffix = name.slice(end + 1).trim()
    name = [prefix, suffix].filter(Boolean).join(' ')
    if (!name) { name = raw.slice(start + 1, end).trim(); fromEmail = true }
  }
  const atIndex = name.indexOf('@')
  if (atIndex > 0 && !name.includes(' ')) {
    name = name.slice(0, atIndex).replace(/[.,<>()":_-]/g, ' ')
    fromEmail = true
  }
  const parts = name.split(' ').filter(Boolean)
  const last = parts[parts.length - 1]
  if (!last) return raw
  return fromEmail ? last[0]!.toLocaleUpperCase() + last.slice(1) : last
}

export function blameAnnotationText(line: BlameLineInput): string {
  return [(line.date ?? '').trim(), blameAuthorName(line.author ?? '')].filter(Boolean).join('  ')
}

/** 悬停提示：完整哈希 + 摘要 + 邮箱（有哪样写哪样）。 */
export function blameAnnotationTooltip(line: BlameLineInput): string {
  const head = [
    (line.author ?? '').trim(),
    (line.email ?? '').trim() ? `<${(line.email ?? '').trim()}>` : '',
  ].filter(Boolean).join(' ')
  const rows = [
    head,
    (line.hash ?? '').trim(),
    (line.date ?? '').trim(),
    (line.summary ?? '').trim(),
  ].filter(Boolean)
  return rows.join('\n')
}

/**
 * 把 blame 的原始行转成注解。**行号非法或文本为空的行会被丢掉** ——
 * 与其在装订线上留一条空注解，不如不画（IDEA 在 provider 返回 null 时同样不画）。
 */
export function blameAnnotations(lines: readonly BlameLineInput[]): BlameAnnotation[] {
  const out: BlameAnnotation[] = []
  for (const line of lines) {
    if (!Number.isInteger(line.line) || line.line < 1) continue
    const text = blameAnnotationText(line)
    if (!text) continue
    out.push({ line: line.line, text, tooltip: blameAnnotationTooltip(line),
      date: (line.date ?? '').trim(), author: blameAuthorName(line.author ?? '') })
  }
  return out
}

/** 注解列是否该显示（IDEA 的 Annotate 是一个 Toggle：开着才有这一列）。 */
export function blameAnnotationsVisible(enabled: boolean, annotations: readonly BlameAnnotation[]): boolean {
  return enabled && annotations.length > 0
}
