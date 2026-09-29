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
  viewport: number, rootWidth: number, saved: Partial<LogWidths>, hidden: readonly LogColumn[] = []): LogWidths {
  const widths: LogWidths = { commit: 50, author: 50, date: 50, hash: 50 }
  for (const column of ['author', 'date', 'hash'] as const) {
    // 勾掉的列不占宽度：不量、也不参与"提交列吃掉余量"的减法。
    if (hidden.includes(column)) { widths[column] = 0; continue }
    let measured = 50
    for (const row of rows.slice(0, 1000)) measured = Math.max(measured, measure(column === 'hash' ? row.shortHash : row[column], column) + 8)
    const stored = saved[column]
    widths[column] = typeof stored === 'number' && Number.isFinite(stored) && stored >= 50 && stored <= viewport ? stored : Math.min(300, measured)
  }
  const used = widths.author + widths.date + widths.hash
  widths.commit = hidden.includes('commit') ? 0 : Math.max(50, viewport - rootWidth - 40 - used)
  return widths
}

/**
 * `Vcs.Log.ToggleColumns`（`group.Vcs.Log.ToggleColumns.text` = 列，描述 = 选择要在表中查看的列，
 * `intellij.platform.vcs.log.impl.xml`）—— 勾掉一列就不画它：表头与行单元格都不画，宽度也不参与分配。
 * 存档里**只留隐藏的那些**（缺项/坏值一律丢掉 ⇒ 默认四列全显示，与上游 `Table.*` 的默认一致）。
 */
export function hiddenColumns(raw: unknown): LogColumn[] {
  const valid = Array.isArray(raw) ? raw.filter((key): key is LogColumn => LOG_COLUMNS.includes(key)) : []
  return [...new Set(valid)]
}
/** 勾选一下。 */
export function toggleColumn(hidden: readonly LogColumn[], column: LogColumn): LogColumn[] {
  return hidden.includes(column) ? hidden.filter(key => key !== column) : [...hidden, column]
}
/** 要画的列，保持用户排出来的顺序。 */
export function visibleColumns(order: readonly LogColumn[], hidden: readonly LogColumn[]): LogColumn[] {
  return order.filter(column => !hidden.includes(column))
}
