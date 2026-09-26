// IDEA's commit legend, ported from vcs/commit.
//
// The legend describes the *included* (staged) changes only — the ones that will go into
// the commit — and groups them by change type. ChangeInfoCalculator.kt:7-9,16-26 splits
// them into NEW / MODIFICATION|MOVED / DELETED; git exposes the same classification as the
// index status letter, so 'A' is a new file, 'D' a deleted one and everything else
// (M/R/C/T/U) a modification. CommitLegendPanel.kt:36-68 renders the groups, each coloured
// with its file status, as "<n> <label>" joined by three spaces — or, once the row runs out
// of room, as the one-character compact label (":38-39,58" format()). Labels come from
// VcsBundle.properties:304-306 (added/modified/deleted).

/** Git's index status letter for a staged change. */
export interface LegendChange {
  indexStatus: string
}

export interface LegendCounts {
  added: number
  modified: number
  deleted: number
}

export type LegendKind = 'added' | 'modified' | 'deleted'

export interface LegendGroup {
  count: number
  kind: LegendKind
  full: string
  compact: string
}

export function classifyLegend(changes: readonly LegendChange[]): LegendCounts {
  let added = 0
  let modified = 0
  let deleted = 0
  for (const change of changes) {
    const code = (change.indexStatus || 'M').toUpperCase()
    if (code === 'A' || code === '?') added += 1
    else if (code === 'D') deleted += 1
    else modified += 1
  }
  return { added, modified, deleted }
}

/** Only non-empty groups are drawn (CommitLegendPanel.kt:44 append() skips count 0). */
export function legendGroups(counts: LegendCounts): LegendGroup[] {
  return ([
    { count: counts.added, kind: 'added' as const, full: '新增', compact: '+' },
    { count: counts.modified, kind: 'modified' as const, full: '修改', compact: '*' },
    { count: counts.deleted, kind: 'deleted' as const, full: '删除', compact: '−' },
  ]).filter(group => group.count > 0)
}

/** The full legend string uses a three-space gap (:41 appendSpace()). */
export function legendText(groups: readonly LegendGroup[], compact: boolean, gap = '   '): string {
  return groups.map(group => compact ? `${group.compact}${group.count}` : `${group.count} 个${group.full}`).join(compact ? ' ' : gap)
}
