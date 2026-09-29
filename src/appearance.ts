export type Theme = 'light' | 'dark'
export const themeStorageKey = 'taocode.theme'

export function resolveTheme(saved: unknown, systemDark: boolean): Theme {
  return saved === 'light' || saved === 'dark' ? saved : systemDark ? 'dark' : 'light'
}

export function initialTheme(): Theme {
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  try { return resolveTheme(localStorage.getItem(themeStorageKey), systemDark) }
  catch { return resolveTheme(null, systemDark) }
}

// Source: AppearanceConfigurable.kt cdDifferentiateProjects —— 主工具栏/标题栏戴"项目色"。
// TaoCode 用与 `RecentProjectIconHelper.kt:289-326` 同样的 9 组渐变，按 `abs(path.hashCode()) % 9` 取，
// 这样同一个项目在欢迎页的图标与这里的主色是同一档（纯函数，可单测）。
export const PROJECT_TINTS: ReadonlyArray<readonly [string, string]> = [
  ['#DB3D3C', '#FF8E42'], ['#F57236', '#FCBA3F'], ['#2BC8BB', '#36EBAE'],
  ['#359AF2', '#57DBFF'], ['#8379FB', '#85A8FF'], ['#7E54B5', '#9486FF'],
  ['#D63CC8', '#F582B9'], ['#954294', '#C87DFF'], ['#E75371', '#FF78B5'],
]

/** 项目根路径 → 一条 90° 渐变（带 alpha 后缀 `26`/`1A`，直接用在同一处分层背景上）。 */
export function projectTint(root: string): string {
  let hash = 0
  for (let i = 0; i < root.length; i += 1) hash = (hash * 31 + root.charCodeAt(i)) | 0
  const [from, to] = PROJECT_TINTS[Math.abs(hash) % PROJECT_TINTS.length]!
  return `linear-gradient(90deg, ${from}26, ${to}1A)`
}

export function clampPanelSize(value: number, min: number, max: number) {
  return Math.min(Math.max(min, max), Math.max(min, Math.round(value)))
}
