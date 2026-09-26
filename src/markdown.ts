// Markdown preview renderer for TaoCode, modeled on the CommonMark subset IDEA's
// Markdown plugin renders by default: headings, lists, fenced code, blockquotes,
// tables, rules and inline emphasis/links/code. Pure string functions so the
// output is unit-testable; the component only injects the result as trusted,
// pre-escaped HTML.

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// The escaping above is the reason raw HTML in a Markdown document can only ever be
// shown as text: every source character that could open a tag is turned into its
// entity before any inline pass runs. There is no "allowHtml" switch precisely
// because a Markdown preview would need a full HTML sanitiser to be safe, and this
// renderer has none — so nothing is ever injected as markup.
export interface MarkdownOptions {
  // Directory of the rendered file ('/'-joined, workspace-relative), used to turn
  // relative links and images into workspace paths. Files here are addressed by
  // workspace path, never by URL: the desktop host serves its UI from a virtual
  // host (https://taocode.local) that has no route to project files at all.
  basePath?: string
}

const REMOTE_LINK = /^(?:https?:\/\/|mailto:)/i
const IMAGE_SOURCE = /^(?:https?:\/\/|data:image\/)/i
// Two letters minimum so a Windows drive letter ("C:\...") still counts as a path.
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]{1,}:/
// Any other scheme — notably `javascript:` and every `data:` that is not an image —
// never reaches an href or src: a preview that wrote it out would execute script the
// moment the link is clicked.

// Resolve a Markdown target ('./a', '../b', '/c') to a workspace path, or null when
// it escapes the workspace root.
function workspacePath(basePath: string | undefined, target: string): string | null {
  const segments = (target.startsWith('/') ? [] : (basePath ?? '').split('/').filter(Boolean)).concat(target.split('/'))
  const resolved: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') { if (!resolved.length) return null; resolved.pop(); continue }
    resolved.push(segment)
  }
  return resolved.length ? resolved.join('/') : null
}
const unescape = (text: string) => text.replace(/&amp;/g, '&').replace(/&quot;/g, '"')

function renderLink(target: string, label: string, basePath?: string): string {
  const decoded = unescape(target)
  if (decoded.startsWith('#')) return `<a href="${target}">${label}</a>`
  if (REMOTE_LINK.test(decoded)) return `<a href="${target}">${label}</a>`
  // An unrecognised scheme is dropped rather than relativised: `javascript:alert(1`
  // must not even become a same-document fragment.
  if (URL_SCHEME.test(decoded)) return label
  const path = workspacePath(basePath, decoded)
  if (!path) return label
  // `#path` is a same-document href, so even a click nobody intercepts cannot
  // navigate the WebView away from the app; the component opens the target instead.
  return `<a href="#${path}" data-md-open="${path}">${label}</a>`
}
function renderImage(target: string, alt: string, basePath?: string): string {
  const decoded = unescape(target)
  if (IMAGE_SOURCE.test(decoded)) return `<img src="${target}" alt="${alt}" />`
  // Same rule as links: no other scheme, script included, is ever resolved.
  if (URL_SCHEME.test(decoded)) return `<span class="md-image-broken">不支持的图片来源：${target}</span>`
  const path = workspacePath(basePath, decoded)
  if (!path) return `<span class="md-image-broken">图片地址无效：${target}</span>`
  // Kept as a data-carrying span: the preview reads the bytes over the bridge and
  // swaps in an <img> with a data: URL, which is all the CSP permits here.
  return `<span class="md-image md-image-pending" role="img" data-md-src="${path}" data-md-alt="${alt}">图片加载中…</span>`
}

// Inline rendering runs after block escaping; `code` spans were re-escaped inside,
// so emphasis markers are matched on the escaped text like cmark's inline pass.
function renderInline(text: string, basePath?: string): string {
  let result = ''
  let index = 0
  const source = text
  while (index < source.length) {
    const start = source.indexOf('`', index)
    if (start < 0) { result += emphasize(source.slice(index), basePath); break }
    const end = source.indexOf('`', start + 1)
    if (end < 0) { result += emphasize(source.slice(index), basePath); break }
    result += emphasize(source.slice(index, start), basePath)
    result += `<code>${source.slice(start + 1, end)}</code>`
    index = end + 1
  }
  return result
}

function emphasize(text: string, basePath?: string): string {
  return text
    .replace(/!\[([^\]]*)\]\(((?:[^()\s]|\([^()]*\))+)\)/g, (_match, alt, target) => renderImage(target as string, alt as string, basePath))
    .replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()]*\))+)\)/g, (_match, label, target) => renderLink(target as string, label as string, basePath))
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

export function renderMarkdown(source: string, options: MarkdownOptions = {}): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let index = 0
  let paragraph: string[] = []
  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${renderInline(escapeHtml(paragraph.join('\n')), options.basePath)}</p>`)
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
      out.push(`<h${level}>${renderInline(escapeHtml(heading[2]!.trim()), options.basePath)}</h${level}>`)
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
        if (item) { entries.push(renderInline(escapeHtml(item[1]!.trim()), options.basePath)); ++index; continue }
        const continuation = /^\s{2,}\S/.test(lines[index]!) && entries.length && !/^\s*$/.test(lines[index]!)
        if (continuation) { entries[entries.length - 1] += ' ' + renderInline(escapeHtml(lines[index]!.trim()), options.basePath); ++index; continue }
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
      out.push(`<blockquote>${renderMarkdown(body.join('\n'), options)}</blockquote>`)
      continue
    }
    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1]!)) {
      flushParagraph()
      const header = splitRow(line)
      index += 2
      const rows: string[] = []
      while (index < lines.length && lines[index]!.includes('|') && !/^\s*$/.test(lines[index]!)) {
        rows.push(splitRow(lines[index]!).map(cell => `<td>${renderInline(escapeHtml(cell), options.basePath)}</td>`).join(''))
        ++index
      }
      out.push(`<table><thead><tr>${header.map(cell => `<th>${renderInline(escapeHtml(cell), options.basePath)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row}</tr>`).join('')}</tbody></table>`)
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
