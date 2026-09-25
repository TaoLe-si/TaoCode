// Markdown preview renderer for TaoCode, modeled on the CommonMark subset IDEA's
// Markdown plugin renders by default: headings, lists, fenced code, blockquotes,
// tables, rules and inline emphasis/links/code. Pure string functions so the
// output is unit-testable; the component only injects the result as trusted,
// pre-escaped HTML.

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Inline rendering runs after block escaping; `code` spans were re-escaped inside,
// so emphasis markers are matched on the escaped text like cmark's inline pass.
function renderInline(text: string): string {
  let result = ''
  let index = 0
  const source = text
  while (index < source.length) {
    const start = source.indexOf('`', index)
    if (start < 0) { result += emphasize(source.slice(index)); break }
    const end = source.indexOf('`', start + 1)
    if (end < 0) { result += emphasize(source.slice(index)); break }
    result += emphasize(source.slice(index, start))
    result += `<code>${source.slice(start + 1, end)}</code>`
    index = end + 1
  }
  return result
}

function emphasize(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" />')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
}

export interface MarkdownTable { header: string[]; rows: string[][] }

function splitRow(line: string): string[] {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes('-') && line.includes('|')
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let index = 0
  let paragraph: string[] = []
  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${renderInline(escapeHtml(paragraph.join('\n')))}</p>`)
      paragraph = []
    }
  }
  while (index < lines.length) {
    const line = lines[index]!
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    const fence = /^\s*(```|~~~)\s*(\S*)\s*$/.exec(line)
    if (heading) {
      flushParagraph()
      const level = heading[1]!.length
      out.push(`<h${level}>${renderInline(escapeHtml(heading[2]!.trim()))}</h${level}>`)
      ++index
      continue
    }
    if (fence) {
      flushParagraph()
      const marker = fence[1]!
      const language = fence[2] ?? ''
      const body: string[] = []
      ++index
      while (index < lines.length && !lines[index]!.startsWith(marker)) { body.push(lines[index]!); ++index }
      if (index < lines.length) ++index  // closing fence; EOF still closes the block
      out.push(`<pre data-lang="${escapeHtml(language)}"><code>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flushParagraph()
      out.push('<hr />')
      ++index
      continue
    }
    // Lists: consecutive bullet (-, *, +) or ordered (1. 1)) entries, one nesting level.
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || ordered) {
      flushParagraph()
      const orderedList = Boolean(ordered)
      const entries: string[] = []
      while (index < lines.length) {
        const item = orderedList ? /^\s*\d+[.)]\s+(.*)$/.exec(lines[index]!) : /^\s*[-*+]\s+(.*)$/.exec(lines[index]!)
        if (item) { entries.push(renderInline(escapeHtml(item[1]!.trim()))); ++index; continue }
        const continuation = /^\s{2,}\S/.test(lines[index]!) && entries.length && !/^\s*$/.test(lines[index]!)
        if (continuation) { entries[entries.length - 1] += ' ' + renderInline(escapeHtml(lines[index]!.trim())); ++index; continue }
        break
      }
      out.push(`<${orderedList ? 'ol' : 'ul'}>${entries.map(entry => `<li>${entry}</li>`).join('')}</${orderedList ? 'ol' : 'ul'}>`)
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      flushParagraph()
      const body: string[] = []
      while (index < lines.length && /^\s*>\s?/.test(lines[index]!)) {
        body.push(lines[index]!.replace(/^\s*>\s?/, ''))
        ++index
      }
      out.push(`<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`)
      continue
    }
    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1]!)) {
      flushParagraph()
      const header = splitRow(line)
      index += 2
      const rows: string[] = []
      while (index < lines.length && lines[index]!.includes('|') && !/^\s*$/.test(lines[index]!)) {
        rows.push(splitRow(lines[index]!).map(cell => `<td>${renderInline(escapeHtml(cell))}</td>`).join(''))
        ++index
      }
      out.push(`<table><thead><tr>${header.map(cell => `<th>${renderInline(escapeHtml(cell))}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row}</tr>`).join('')}</tbody></table>`)
      continue
    }
    if (/^\s*$/.test(line)) {
      flushParagraph()
      ++index
      continue
    }
    paragraph.push(line.trim())
    ++index
  }
  flushParagraph()
  return out.join('\n')
}
