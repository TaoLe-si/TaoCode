// 本地历史时间线的**时段分组**（`pv/history` 判词里缺的那条可见形状）。
//
// 上游依据：`RevisionsList.java:63` `RECENT_PERIOD = 12`（小时）+ `:133-146`
// `updateData()` 的分组循环 + `:222-224` 的 `Period` 三档文案，文案在
// `LocalHistoryBundle.properties`：`revisions.table.period.recent=Last {0} Hours`、
// `revisions.table.period.older=Older`、`revisions.table.period.old=Old Changes`。
//
// 上游的循环只做三件事，逐条照搬：
//   1. 列表按新→旧排；
//   2. **第一条**且在 12 小时内的条目挂「最近 12 小时」标题（`i == 0` 那个条件 ——
//      之后的近期条目不再挂，标题只出现一次）；
//   3. 遇到第一条超出 12 小时的：已经有「最近」分组就挂「更早」，一条「最近」都没有就挂
//      「旧的更改」，然后 **break**（后面的行不再挂任何标题）。
import type { HistoryEntry } from './bridge.ts'

/** `RevisionsList.java:63` 的 `RECENT_PERIOD`，单位小时。 */
export const RECENT_PERIOD_HOURS = 12

/** 上游把毫秒换算写成 `1000 * 60 * 60 * RECENT_PERIOD`（`RevisionsList.java:136`）。 */
const RECENT_WINDOW_MILLIS = RECENT_PERIOD_HOURS * 60 * 60 * 1000

export type HistoryPeriod = 'recent' | 'older' | 'old'

/** 三档标题（对应上面那三条 bundle 键）。 */
export const HISTORY_PERIOD_LABELS: Record<HistoryPeriod, string> = {
  recent: `最近 ${RECENT_PERIOD_HOURS} 小时`,
  older: '更早',
  old: '旧的更改',
}

export interface TimelineRow {
  entry: HistoryEntry
  /** 这一行**前面**要插的时段标题；null = 不插。 */
  period: HistoryPeriod | null
}

/** 该快照算不算「最近」（`RevisionsList.java:136` 的那个减法）。 */
export function isRecentSnapshot(timeMillis: number, nowMillis: number): boolean {
  return nowMillis - timeMillis < RECENT_WINDOW_MILLIS
}

/**
 * 给一列（新→旧的）快照打时段标题。入参顺序就是显示顺序 —— 宿主的 `history.list`
 * 已经按新→旧给（`native/history.hpp` 的 `list()` 注释），这里不再重排，
 * 否则上游那套「第一条 / 第一条超期」的判定会错位。
 */
export function timelineRows(entries: readonly HistoryEntry[], nowMillis: number): TimelineRow[] {
  const rows: TimelineRow[] = []
  let sawRecent = false
  // 上游在那个 break 上结束循环：分界行拿到「更早 / 旧的更改」标题，**后面的行不再挂标题**。
  let boundaryReached = false
  entries.forEach((entry, index) => {
    if (boundaryReached) { rows.push({ entry, period: null }); return }
    if (isRecentSnapshot(entry.timeMillis, nowMillis)) {
      rows.push({ entry, period: index === 0 ? 'recent' : null })
      sawRecent = true
      return
    }
    boundaryReached = true
    rows.push({ entry, period: sawRecent ? 'older' : 'old' })
  })
  return rows
}
