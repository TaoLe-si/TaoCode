import { formatPrettyDateTime, type DateTimeFormatSettings } from './dateTimeFormat.ts'
import { logDate } from './vcsLogGraph.ts'

const MINUTE = 60_000

/** `DateFormatUtil.java:130-168` 的 61 分钟窗口。 */
export const PRETTY_DATE_WINDOW_MS = 61 * MINUTE
/** `DateTimeFormatManager.java:25` 的默认值。 */
export const PRETTY_DATE_ALLOWED_DEFAULT = true

/** Java `Math.rint`：恰好 .5 时取偶数。 */
export function rint(value: number): number {
  const floor = Math.floor(value)
  const rest = value - floor
  if (rest > 0.5) return floor + 1
  if (rest < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

/** `UtilBundle.properties:2` 那一行 ChoiceFormat 的四档（[0,1)/[1,2)/[2,60)/[60,∞)）。 */
export function minutesAgoText(minutes: number): string {
  if (minutes < 1) return '刚刚'
  if (minutes < 2) return '1 分钟前'
  if (minutes < 60) return `${minutes} 分钟前`
  return '1 小时前'
}

function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()
}

/**
 * VCS log 的 Date 列值（`VcsLogDefaultColumn.kt:172-177`）：求值顺序照 `DateFormatUtil.java:137-177` ——
 * 分钟档（61 分钟窗口）→ 今天 → 昨天 → 绝对档。
 *
 * 「今天 / 昨天」后面的时刻与绝对档都走本仓日志既有的 `logDate()`（`yyyy-MM-dd HH:mm`，零填充）：
 * 日志列本来就是这一种呈现（`VcsLogTable.vue` 在这一批之前直接用 `logDate`，`src/vcsLogMenu.ts` 引的
 * "`logDate` 那一套"），行复制 / 速度搜索 / 行 tooltip 与判据里引用的也是同一串
 * （`tests/vcs-log-display.test.mjs` 的"更早 = 绝对档一字不变"）。交给 `Intl` 的短日期会随 locale 出
 * 「2026/9/29」这种另一套写法 ⇒ 同一格日期在菜单、搜索与判据里会对不上。
 *
 * 宿主**显式覆盖**了日期格式时（`overrideSystemDateFormat`，设置页那一颗勾选）整条链路交回
 * `formatPrettyDateTime()`：那一档用户要的就是自己写的 pattern，含今天 / 昨天的时刻。
 */
export function prettyLogDate(
  iso: string,
  now = Date.now(),
  settings: Partial<DateTimeFormatSettings> | boolean = {},
): string {
  const resolved = typeof settings === 'boolean' ? { prettyFormattingAllowed: settings } : settings
  if (resolved.overrideSystemDateFormat) return formatPrettyDateTime(iso, now, resolved)
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  if ((resolved.prettyFormattingAllowed ?? PRETTY_DATE_ALLOWED_DEFAULT) === false) return logDate(iso)
  const delta = now - date.getTime()
  if (delta >= 0 && delta <= PRETTY_DATE_WINDOW_MS) return minutesAgoText(rint(delta / MINUTE))
  const today = new Date(now)
  if (sameDay(date, today)) return `今天 ${logDate(iso).slice(11)}`
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (sameDay(date, yesterday)) return `昨天 ${logDate(iso).slice(11)}`
  return logDate(iso)
}
