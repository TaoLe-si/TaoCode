// 控制台一行里的**多个** `file:line` 链接（上游 `MultipleFilesHyperlinkInfo` /
// `FileHyperlinkRawDataFinder` / `PatternBasedFileHyperlinkFilter` 的可移植子集）。
//
// 上游的 finder 扫一行里的全部 `path:line` 形态区间，由 filter 建成多个 hyperlink；
// 本仓原先每行只取第一个（`parseAnyIssue`），一行里出现多个源文件位置时只有一个能点。
// 这里给出 `findRunHyperlinks`（全量扫描 + 路径归一化 + 保序去重叠）与 `splitRunLine`
// （把一行切成「纯文本 / 可点链接」片段），消费点：`src/runIssues.ts` 与
// `src/components/RunConsole.vue`（每个片段各自可点，整行 hover 时给出全部位置清单）。
//
// 纯函数，只依赖 `parseAnyIssue` 同一套路径归一化，判据 tests/run-filters.test.mjs。

import { normalizeRunPath } from './buildOutput.ts'

export interface RunHyperlink {
  /** 工作区相对（或绝对）路径，已按项目根归一化 —— 与 `parseAnyIssue` 同一口径。 */
  path: string
  line: number
  column: number
  /** 在原文里的半开区间 [start, end)，供切片渲染。 */
  start: number
  end: number
}

/** 一行最多认多少个链接（防止异常 message 里塞满数字时爆掉）。 */
export const MAX_LINE_HYPERLINKS = 20

/**
 * `path:line[:col]`。路径允许盘符前缀（`D:/a/B.java`）与反斜杠，但排除了引号/括号/逗号等
 * 会把句子断开、或者本身属于 URL 的字符；`:` 不进字符类，所以 `file:///…` 会从盘符之后开始匹配。
 */
const LINK_PATTERN = /((?:[A-Za-z]:[\\/])?[^\s:*?<>|"'()（）\[\],;]+\.[A-Za-z0-9_]+):(\d+)(?::(\d+))?/g

/**
 * 扫出一行里全部文件位置。返回按出现顺序排列、互不重叠的链接。
 *
 * 上游 finder 也受同样的启发式限制（它同样不做文件系统校验）；这里额外排除
 * 「前一个字符是 `/` 或字母数字」的命中：前者会把 `http://host/a.js:1` 认成相对路径，
 * 后者会把更长的 token（如 `abcMain.java:1`）从中间切开。
 */
export function findRunHyperlinks(text: string, root: string, limit = MAX_LINE_HYPERLINKS): RunHyperlink[] {
  const links: RunHyperlink[] = []
  // 每次调用重置 lastIndex：正则是模块级的，带 g 标志有状态。
  LINK_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LINK_PATTERN.exec(text)) !== null) {
    if (links.length >= limit) break
    const rawPath = match[1]!
    const start = match.index
    const before = start > 0 ? text[start - 1]! : ''
    if (/[A-Za-z0-9/\\]/.test(before)) continue
    const previous = links[links.length - 1]
    if (previous && start < previous.end) continue
    links.push({
      path: normalizeRunPath(rawPath, root),
      line: Math.max(1, Number(match[2])),
      column: match[3] ? Math.max(1, Number(match[3])) : 1,
      start,
      end: LINK_PATTERN.lastIndex,
    })
  }
  return links
}

export interface RunLineSegment {
  text: string
  link?: RunHyperlink
}

/** 把一行切成渲染片段：链接段带 link，其余是纯文本（保序、覆盖整行）。 */
export function splitRunLine(text: string, links: readonly RunHyperlink[]): RunLineSegment[] {
  if (!links.length) return [{ text }]
  const segments: RunLineSegment[] = []
  let cursor = 0
  for (const link of links) {
    if (link.start < cursor || link.end > text.length) continue
    if (link.start > cursor) segments.push({ text: text.slice(cursor, link.start) })
    segments.push({ text: text.slice(link.start, link.end), link })
    cursor = link.end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments.length ? segments : [{ text }]
}
