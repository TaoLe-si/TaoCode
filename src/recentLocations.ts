// IDEA's Recent Locations snippet window (RecentLocationsDataModel.kt): for a caret
// line, take up to `radius` lines before and after, then shift the window toward the
// caret when one side runs out of document, so every location shows the same number
// of context lines. Pure so the arithmetic is unit-testable (tests/recent-locations.test.mjs).

export function locationWindow(line: number, lineCount: number, radius = 2): { start: number; end: number } | null {
  if (lineCount <= 0) return null
  const before = Math.min(radius, line)
  const after = Math.min(radius, lineCount - line)
  const startLine = Math.max(line - (before + radius - after), 0)
  const endLine = Math.min(line + (after + radius - before), lineCount - 1)
  return startLine <= endLine ? { start: startLine, end: endLine } : { start: line, end: line }
}

const MAX_LINE_CHARS = 1000 // getTrimmedRange caps each rendered line at 1000 chars

// trims leading blank lines, trailing blank lines, and clamps each line's length.
export function locationSnippet(lines: string[], line: number, lineShift = 0, radius = 2): { text: string; firstLine: number } {
  const window = locationWindow(line, lines.length, radius)
  if (!window) return { text: '', firstLine: 0 }
  const body = lines.slice(window.start, window.end + 1).map(row => row.slice(0, MAX_LINE_CHARS))
  let leading = 0
  while (leading < body.length && !body[leading]!.trim()) leading++
  let trailing = 0
  while (trailing < body.length - leading && !body[body.length - 1 - trailing]!.trim()) trailing++
  const trimmed = body.slice(leading, body.length - trailing)
  return { text: trimmed.join('\n'), firstLine: window.start + leading + lineShift }
}

// —— 「回到上次编辑位置」（Ctrl+Shift+Backspace）的游标 ——
//
// 上游 `platform/platform-impl/src/com/intellij/openapi/fileEditor/impl/IdeDocumentHistoryImpl.kt:481-497`
// 的 `navigatePreviousChange`：更改档是一条「最旧在前」的队列，`currentIndex` 记着用户现在坐在哪一格；
// 每按一次就从 `currentIndex - 1` 往 0 走（= 往**更旧**的方向），跳过与当前位置是同一个位置的那些
// （`:491` 的 `isSame`，判据本体见 `:738-745`），落在第一个不同的格上并把游标挪过去（`:493`）。
// 游标已经在最旧那一格就什么都不做（`:483-485`），菜单项的可用判据是同一条（`:538-540`）；
// 记一笔新的改动会把游标推回队列尾（`:340` 的 `currentIndex = changePlaces.size`）
// ⇒ **连续按是往更旧走，不会在同两格之间来回弹**。
//
// 本仓的更改档是「最新在前」（见 `src/appPlacesRing.ts` 的头注释），所以游标与方向都是镜像：
// `cursor` = 本仓数组的下标，`-1` = 还没按过（坐在最新那一条之后，对应上游的 `currentIndex = size`）。
export function previousChangePlace<T extends { path: string; line: number }>(
  ring: readonly T[], cursor: number, here: { path: string; line: number } | null,
): { index: number; place: T } | null {
  // 游标落在最后一条（= 最旧）之后就没有更旧的候选了（上游 `:483-485`）。
  if (cursor >= ring.length - 1) return null
  for (let index = Math.max(cursor, -1) + 1; index < ring.length; index++) {
    const place = ring[index]!
    // 「同一个位置」= 同文件 + 同一导航态（本仓的导航态只有行号），与弹层读出的去重同一条规则。
    if (here && place.path === here.path && place.line === here.line) continue
    return { index, place }
  }
  return null
}
