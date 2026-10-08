export interface DateTimeFormatSettings {
  overrideSystemDateFormat: boolean
  dateFormatPattern: string
  use24HourTime: boolean
  prettyFormattingAllowed: boolean
}

export interface SystemDateTimeFormats {
  datePattern: string
  shortTimePattern: string
  mediumTimePattern: string
  locale: string
}

export const DEFAULT_DATE_TIME_FORMAT_SETTINGS: DateTimeFormatSettings = {
  overrideSystemDateFormat: false,
  dateFormatPattern: 'dd MMM yyyy',
  use24HourTime: true,
  prettyFormattingAllowed: true,
}

const SIMPLE_DATE_FORMAT_LETTERS = new Set('GyYwWDdFEMuaHkKhmSsZzX'.split(''))
const TIME_PATTERN_LETTERS = /[aHhKkmSs]/
let systemFormats: SystemDateTimeFormats | null = null

export function setSystemDateTimeFormats(value: unknown): void {
  if (!value || typeof value !== 'object') { systemFormats = null; return }
  const formats = value as Partial<SystemDateTimeFormats>
  systemFormats = typeof formats.datePattern === 'string'
      && typeof formats.shortTimePattern === 'string'
      && typeof formats.mediumTimePattern === 'string'
      && typeof formats.locale === 'string'
    ? formats as SystemDateTimeFormats
    : null
}

export function datePatternError(pattern: string): string | null {
  let quoted = false
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]!
    if (character === "'") {
      if (pattern[index + 1] === "'") { index++; continue }
      quoted = !quoted
      continue
    }
    if (!quoted && /[A-Za-z]/.test(character) && !SIMPLE_DATE_FORMAT_LETTERS.has(character)) {
      return `Invalid pattern: Illegal pattern character '${character}'`
    }
  }
  if (TIME_PATTERN_LETTERS.test(pattern)) {
    return 'Date format should not contain time patterns (hours, minutes, seconds)'
  }
  return null
}

function localeName(): string | undefined {
  return systemFormats?.locale || Intl.DateTimeFormat().resolvedOptions().locale || undefined
}

function formatPart(date: Date, options: Intl.DateTimeFormatOptions, part: string): string {
  return new Intl.DateTimeFormat(localeName(), options).formatToParts(date).find(value => value.type === part)?.value ?? ''
}

function formatNumber(value: number, width: number): string {
  return new Intl.NumberFormat(localeName(), { minimumIntegerDigits: width, useGrouping: false }).format(value)
}

function dayOfYear(date: Date): number {
  return Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    - Date.UTC(date.getFullYear(), 0, 1)) / 86_400_000) + 1
}

interface WeekInfo { firstDay: number; minimalDays: number }

function weekInfo(): WeekInfo {
  const region = localeName()?.split('-').at(-1)?.toUpperCase()
  const locale = new Intl.Locale(localeName() ?? 'en-US') as Intl.Locale & { getWeekInfo?: () => WeekInfo }
  if (locale.getWeekInfo) return locale.getWeekInfo()
  return ['US', 'CA', 'JP', 'MX', 'PH', 'TH'].includes(region ?? '')
    ? { firstDay: 7, minimalDays: 1 }
    : { firstDay: 1, minimalDays: ['GB', 'AU', 'NZ'].includes(region ?? '') ? 1 : 4 }
}

function dayNumber(date: Date): number {
  return ((date.getDay() + 6) % 7) + 1
}

function localDateOrdinal(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000
}

function weekStart(year: number, month: number, info: WeekInfo): number {
  const first = new Date(year, month, 1)
  const offset = (dayNumber(first) - info.firstDay + 7) % 7
  const start = localDateOrdinal(first) - offset
  return 7 - offset >= info.minimalDays ? start : start + 7
}

function localizedWeek(date: Date, month: number | null, info: WeekInfo): { year: number; week: number } {
  const ordinal = localDateOrdinal(date)
  if (month !== null) {
    return { year: date.getFullYear(), week: Math.floor((ordinal - weekStart(date.getFullYear(), month, info)) / 7) + 1 }
  }
  let year = date.getFullYear()
  if (ordinal < weekStart(year, 0, info)) year--
  else if (ordinal >= weekStart(year + 1, 0, info)) year++
  return { year, week: Math.floor((ordinal - weekStart(year, 0, info)) / 7) + 1 }
}

function offsetText(date: Date, count: number, pattern: 'Z' | 'X'): string {
  const minutes = -date.getTimezoneOffset()
  if (pattern === 'X' && minutes === 0) return 'Z'
  const sign = minutes < 0 ? '-' : '+'
  const absolute = Math.abs(minutes)
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0')
  const mins = String(absolute % 60).padStart(2, '0')
  if (pattern === 'Z' && count >= 4) return `GMT${sign}${hours}:${mins}`
  if (pattern === 'X' && count === 1) return `${sign}${hours}${absolute % 60 ? mins : ''}`
  if (pattern === 'X' && count === 3) return `${sign}${hours}:${mins}`
  if (pattern === 'X' && count >= 5) return `${sign}${hours}:${mins}`
  return `${sign}${hours}${mins}`
}

function formatPattern(pattern: string, date: Date, mode: 'javaTime' | 'simple' = 'javaTime'): string {
  const localeWeek = weekInfo()
  let output = ''
  for (let index = 0; index < pattern.length;) {
    const character = pattern[index]!
    if (character === "'") {
      if (pattern[index + 1] === "'") { output += "'"; index += 2; continue }
      const close = pattern.indexOf("'", index + 1)
      if (close < 0) { index++; continue }
      output += pattern.slice(index + 1, close)
      index = close + 1
      continue
    }
    let run = 1
    while (pattern[index + run] === character) run++
    const width = run === 2 ? '2-digit' : 'numeric'
    switch (character) {
      case 'G': output += formatPart(date, { era: run === 5 ? 'narrow' : run >= 4 ? 'long' : 'short' }, 'era'); break
      case 'y': output += run === 2
        ? formatPart(date, { year: '2-digit' }, 'year')
        : formatNumber(date.getFullYear(), run)
        break
      case 'u': output += mode === 'simple'
        ? formatNumber(date.getDay() || 7, run)
        : formatPart(date, { year: run === 2 ? '2-digit' : 'numeric' }, 'year')
        break
      case 'Y': {
        const value = localizedWeek(date, null, localeWeek).year
        output += formatNumber(run === 2 ? value % 100 : value, run === 2 ? 2 : run)
        break
      }
      case 'M': case 'L': output += formatPart(date, { month: run === 1 ? 'numeric' : run === 2 ? '2-digit' : run === 3 ? 'short' : run === 4 ? 'long' : 'narrow' }, 'month'); break
      case 'd': output += formatPart(date, { day: width }, 'day'); break
      case 'D': output += formatNumber(dayOfYear(date), run); break
      case 'H': output += formatNumber(date.getHours(), run); break
      case 'k': output += formatNumber(date.getHours() || 24, run); break
      case 'K': output += formatNumber(date.getHours() % 12, run); break
      case 'h': output += formatNumber(date.getHours() % 12 || 12, run); break
      case 'm': output += formatNumber(date.getMinutes(), run); break
      case 's': output += formatNumber(date.getSeconds(), run); break
      case 'a': output += formatPart(date, { hour: 'numeric', hour12: true }, 'dayPeriod'); break
      case 'E': case 'e': case 'c':
        output += run <= 2 && character !== 'E'
          ? formatNumber(mode === 'simple' ? date.getDay() || 7 : dayNumber(date), run)
          : formatPart(date, { weekday: run === 5 ? 'narrow' : run >= 4 ? 'long' : 'short' }, 'weekday')
        break
      case 'w': output += formatNumber(localizedWeek(date, null, localeWeek).week, run); break
      case 'W': output += formatNumber(localizedWeek(date, date.getMonth(), localeWeek).week, run); break
      case 'F': output += formatNumber(mode === 'simple' ? Math.ceil(date.getDate() / 7) : (date.getDate() - 1) % 7 + 1, run); break
      case 'z': output += formatPart(date, { timeZoneName: run >= 4 ? 'long' : 'short' }, 'timeZoneName'); break
      case 'Z': case 'X':
        output += offsetText(date, run, character)
        break
      case 'p': output += ' '.repeat(run); break
      default: output += character.repeat(run); break
    }
    index += run
  }
  return output
}

function timePattern(use24HourTime: boolean, seconds: boolean): string {
  if (use24HourTime) return seconds ? 'HH:mm:ss' : 'HH:mm'
  return seconds ? 'h:mm:ss a' : 'h:mm a'
}

function formatSystemDate(date: Date): string {
  if (systemFormats) return formatPattern(fixWindowsPattern(systemFormats.datePattern), date)
  return new Intl.DateTimeFormat(localeName(), { dateStyle: 'short' }).format(date)
}

function formatSystemTime(date: Date): string {
  if (systemFormats) return formatPattern(fixWindowsPattern(systemFormats.mediumTimePattern), date)
  return new Intl.DateTimeFormat(localeName(), { timeStyle: 'medium' }).format(date)
}

function formatSystemTimeShort(date: Date): string {
  if (systemFormats) return formatPattern(fixWindowsPattern(systemFormats.shortTimePattern), date)
  return new Intl.DateTimeFormat(localeName(), { timeStyle: 'short' }).format(date)
}

function fixWindowsPattern(pattern: string): string {
  return pattern.replaceAll('g', 'G').replaceAll('dddd', 'EEEE').replaceAll('ddd', 'E').replaceAll('tt', 'a').replaceAll('t', 'a')
}

export function formatDateTime(date: Date, settings: Partial<DateTimeFormatSettings> = {}): string {
  const resolved = { ...DEFAULT_DATE_TIME_FORMAT_SETTINGS, ...settings }
  if (!resolved.overrideSystemDateFormat) return `${formatSystemDate(date)} ${formatSystemTimeShort(date)}`
  return `${formatPattern(resolved.dateFormatPattern, date)} ${formatPattern(timePattern(resolved.use24HourTime, false), date)}`
}

export function formatDateTimeShort(date: Date, settings: Partial<DateTimeFormatSettings> = {}): string {
  const resolved = { ...DEFAULT_DATE_TIME_FORMAT_SETTINGS, ...settings }
  if (!resolved.overrideSystemDateFormat) return `${formatSystemDate(date)} ${formatSystemTimeShort(date)}`
  return `${formatPattern(resolved.dateFormatPattern, date)} ${formatPattern(timePattern(resolved.use24HourTime, false), date)}`
}

export function formatTimeWithSeconds(date: Date, settings: Partial<DateTimeFormatSettings> = {}): string {
  const resolved = { ...DEFAULT_DATE_TIME_FORMAT_SETTINGS, ...settings }
  return resolved.overrideSystemDateFormat
    ? formatPattern(timePattern(resolved.use24HourTime, true), date)
    : formatSystemTime(date)
}

export function formatDateTimePreview(settings: Partial<DateTimeFormatSettings> = {}): string {
  const resolved = { ...DEFAULT_DATE_TIME_FORMAT_SETTINGS, ...settings }
  if (datePatternError(resolved.dateFormatPattern)) return ''
  const sample = new Date(2100, 11, 31, 23, 59, 0)
  return `${formatPattern(resolved.dateFormatPattern, sample, 'simple')} ${formatPattern(timePattern(resolved.use24HourTime, false), sample, 'simple')}`
}

function relativeText(kind: 'moments' | 'minute' | 'minutes' | 'hour' | 'today' | 'yesterday', count = 0): string {
  const locale = localeName() ?? ''
  if (locale.toLowerCase().startsWith('zh')) {
    if (kind === 'moments') return '刚刚'
    if (kind === 'minute') return '1 分钟前'
    if (kind === 'minutes') return `${count} 分钟前`
    if (kind === 'hour') return '1 小时前'
    return kind === 'today' ? '今天' : '昨天'
  }
  if (kind === 'moments') return 'Moments ago'
  if (kind === 'minute') return 'A minute ago'
  if (kind === 'minutes') return `${count} minutes ago`
  if (kind === 'hour') return '1 hour ago'
  return kind === 'today' ? 'Today' : 'Yesterday'
}

function rint(value: number): number {
  const floor = Math.floor(value)
  const fraction = value - floor
  if (fraction > 0.5) return floor + 1
  if (fraction < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()
}

function formatTime(date: Date, settings: DateTimeFormatSettings): string {
  return settings.overrideSystemDateFormat
    ? formatPattern(timePattern(settings.use24HourTime, false), date)
    : formatSystemTimeShort(date)
}

export function formatPrettyDateTime(value: string, now = Date.now(), settings: Partial<DateTimeFormatSettings> = {}): string {
  const resolved = { ...DEFAULT_DATE_TIME_FORMAT_SETTINGS, ...settings }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  if (!resolved.prettyFormattingAllowed) return formatDateTime(date, resolved)
  const delta = now - date.getTime()
  if (delta >= 0 && delta <= 3_660_000) {
    const minutes = rint(delta / 60_000)
    if (minutes < 1) return relativeText('moments')
    if (minutes < 2) return relativeText('minute')
    if (minutes < 60) return relativeText('minutes', minutes)
    return relativeText('hour')
  }
  const today = new Date(now)
  if (sameDay(date, today)) return `${relativeText('today')} ${formatTime(date, resolved)}`
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (sameDay(date, yesterday)) return `${relativeText('yesterday')} ${formatTime(date, resolved)}`
  return formatDateTime(date, resolved)
}
