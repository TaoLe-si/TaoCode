export const LOG_COLUMNS = ['commit', 'author', 'date', 'hash'] as const
export type LogColumn = typeof LOG_COLUMNS[number]
export type LogWidths = Record<LogColumn, number>
export function columnOrder(raw: unknown): LogColumn[] {
  const valid = Array.isArray(raw) ? raw.filter((key): key is LogColumn => LOG_COLUMNS.includes(key)) : []
  return [...new Set([...valid, ...LOG_COLUMNS])]
}
export function moveColumn(order: LogColumn[], column: LogColumn, target: LogColumn): LogColumn[] {
  const next = [...order]
  const from = next.indexOf(column), to = next.indexOf(target)
  if (from < 0 || to < 0 || from === to) return next
  next.splice(from, 1); next.splice(to, 0, column)
  return next
}
// VcsLogGraphTable:484-550: measure up to 1000 rows, cap dynamic defaults at
// 300px, use a valid saved dynamic width, give the commit column remaining space.
export function fitColumns(rows: Array<{ author: string; date: string; shortHash: string }>, measure: (text: string, column: LogColumn) => number,
  viewport: number, rootWidth: number, saved: Partial<LogWidths>): LogWidths {
  const widths: LogWidths = { commit: 50, author: 50, date: 50, hash: 50 }
  for (const column of ['author', 'date', 'hash'] as const) {
    let measured = 50
    for (const row of rows.slice(0, 1000)) measured = Math.max(measured, measure(column === 'hash' ? row.shortHash : row[column], column) + 8)
    const stored = saved[column]
    widths[column] = typeof stored === 'number' && Number.isFinite(stored) && stored >= 50 && stored <= viewport ? stored : Math.min(300, measured)
  }
  widths.commit = Math.max(50, viewport - rootWidth - 40 - widths.author - widths.date - widths.hash)
  return widths
}
