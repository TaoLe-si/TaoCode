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

export function clampPanelSize(value: number, min: number, max: number) {
  return Math.min(Math.max(min, max), Math.max(min, Math.round(value)))
}
