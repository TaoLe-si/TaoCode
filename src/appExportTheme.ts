// 「导出到 HTML」用的那份主题快照 —— App.vue 的 `createHtmlExport({ theme: () => {…} })`
// 里那一小段（原 1481-1486 行）。
// 2026-10-06 逐字搬入本文件：读的是 `document.documentElement` 的计算样式、三个 CSS 自定义属性的
// 名字（`--panel` / `--text` / `--font-mono`）、`trim()` 后为空就回落到兜底值的规则，
// 以及字号取 `editorSettings.fontSize` 这一点，全部与搬走之前一致。
//
// 为什么能搬：`(计算样式, 字号) => 导出用的四个值` 是纯函数；兜底色沿用原来那两个取值
// （它们只在「令牌没定义」时用得到，不是界面上画的色，所以没改成 `var(--…)`）。
// 字号由调用方传进来，这里不读响应式状态。
export type ExportThemeTokens = {
  background: string
  foreground: string
  fontFamily: string
  fontSize: number
}

export function readExportThemeTokens(style: CSSStyleDeclaration, fontSize: number): ExportThemeTokens {
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    background: read('--panel', '#ffffff'),
    foreground: read('--text', '#000000'),
    fontFamily: read('--font-mono', 'monospace'),
    fontSize,
  }
}
