// Color Scheme 的**存取通道**：localStorage 方案表 + 把方案覆盖写成一条注入式 CSS 规则。
//
// 为什么走这两条通道（都是本仓已在用的真通道，不是新造的假接口）：
//   · localStorage 持久化用户级设置是本仓既有模式（例：`src/codeStyleSettings.ts` 的开关节、
//     `src/components/ColorChooserDialog.vue` 的最近色）。上游对应物是
//     `EditorColorsManager` 的方案注册中心（`platform/editor-ui-api/src/com/intellij/openapi/editor/colors/
//     EditorColorsManager.java:32,44,50`）与磁盘 `.icls`（同文件 `:28` 的扩展名常量）——
//     本仓没有 IDE 配置目录这一层，用户级方案表落在 localStorage。
//   · 覆盖生效走 **CSS 自定义属性**：编辑器各档全是 `var(--…)` 消费（逐项见 `src/colorScheme.ts` 的
//     `consumer` 字段），运行时往 document 注入一条 `:root[data-theme='…']` 规则即可全编辑器生效
//     （同款机制的先例：`src/appearanceActions.ts:157-159` 用 `setProperty` 改 `--font-ui`）。
//     选择器带上 data-theme 是因为上游「一份方案 = 一套主题」：浅色基座的方案不该染深色面。
//
// 旧存档缺键一律补默认（规约 §3：不许按字段数量判损坏）。
import {
  COLOR_ATTRIBUTE_BY_KEY,
  type ColorScheme,
  resolveOverrides,
  schemeThemeOf,
} from './colorScheme.ts'

export const COLOR_SCHEME_STORAGE_KEY = 'taocode.editor.colorScheme'
/** 注入样式元素的 id（同一文档只有一份，反复应用是替换文本而不是叠层）。 */
export const COLOR_SCHEME_STYLE_ELEMENT_ID = 'taocode-color-scheme'

/** 两份只读基座。名字是本仓自定（上游基座名跟随 IDE 主题名，如 `GlobalEditorScheme.kt` 的语义）。 */
export const BASE_COLOR_SCHEMES: readonly ColorScheme[] = Object.freeze([
  Object.freeze({ name: 'TaoCode Light', inheritFrom: null, theme: 'light', readOnly: true, overrides: {} }),
  Object.freeze({ name: 'TaoCode Dark', inheritFrom: null, theme: 'dark', readOnly: true, overrides: {} }),
])

export interface ColorSchemeState {
  /** 存储形状版本；**只用于向前兼容判断，不参与损坏判定**。 */
  version: 1
  /** 当前方案名（上游 `setGlobalScheme`，`EditorColorsManager.java:44`）。'' = 跟随基座、无覆盖。 */
  active: string
  schemes: ColorScheme[]
}

export function defaultColorSchemeState(): ColorSchemeState {
  return { version: 1, active: '', schemes: [...BASE_COLOR_SCHEMES] }
}

function isColorScheme(value: unknown): value is ColorScheme {
  if (!value || typeof value !== 'object') return false
  const scheme = value as Record<string, unknown>
  const theme = scheme.theme === 'light' || scheme.theme === 'dark'
  const parentOk = scheme.inheritFrom === null || typeof scheme.inheritFrom === 'string'
  const overridesOk = !scheme.overrides || (typeof scheme.overrides === 'object' && !Array.isArray(scheme.overrides))
  return typeof scheme.name === 'string' && !!scheme.name && theme && parentOk && overridesOk
}

function sanitizeOverrides(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    // 取色器给出的是 `#rrggbb`；半写入的坏值直接丢键而不是判整份存档损坏（规约 §3 的事故教训）。
    if (typeof raw === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw)) out[key] = raw.toLowerCase()
  }
  return out
}

/**
 * 读状态。任何缺键/坏键都**补默认**：无存档 → 默认；JSON 坏 → 默认；
 * schemes 数组里坏的条目丢掉、基座缺了补回；active 指向已不存在的方案 → 退回 ''。
 */
export function loadColorSchemeState(read: () => string | null = () => {
  try { return typeof localStorage === 'undefined' ? null : localStorage.getItem(COLOR_SCHEME_STORAGE_KEY) } catch { return null }
}): ColorSchemeState {
  let raw: string | null = null
  try { raw = read() } catch { raw = null }
  if (!raw) return defaultColorSchemeState()
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return defaultColorSchemeState() }
  if (!parsed || typeof parsed !== 'object') return defaultColorSchemeState()
  const data = parsed as Record<string, unknown>
  const list = Array.isArray(data.schemes) ? data.schemes.filter(isColorScheme) : []
  const schemes: ColorScheme[] = list.map(s => ({
    name: s.name,
    inheritFrom: typeof s.inheritFrom === 'string' ? s.inheritFrom : null,
    theme: s.theme,
    readOnly: s.readOnly === true,
    overrides: sanitizeOverrides(s.overrides),
  }))
  const byName = new Map(schemes.map(s => [s.name, s]))
  // 基座缺键补默认（旧存档可能根本没有这两条）。
  for (const base of BASE_COLOR_SCHEMES) if (!byName.has(base.name)) schemes.push({ ...base })
  for (const base of BASE_COLOR_SCHEMES) {
    const existing = byName.get(base.name)
    if (existing) Object.assign(existing, { readOnly: true, theme: base.theme })
  }
  const active = typeof data.active === 'string' && byName.has(data.active) ? data.active : ''
  return { version: 1, active, schemes }
}

export function saveColorSchemeState(
  state: ColorSchemeState,
  write: (value: string) => void = value => {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, value) } catch { /* 存不下就只丢本次持久化 */ }
  },
): void {
  write(JSON.stringify(state))
}

/**
 * 方案 → CSS 文本：把合并后的覆盖表写成 `var` 赋值。
 * 无覆盖（或方案不存在/未知主题）时返回空串——**空串意味着注入端要删掉样式元素**，
 * 编辑器即回落到基座主题（tokens.css），这正是上游「恢复原样」的等价面。
 */
export function schemeCssText(state: ColorSchemeState, name: string = state.active): string {
  if (!name) return ''
  const theme = schemeThemeOf(state.schemes, name)
  if (!theme) return ''
  const merged = resolveOverrides(state.schemes, name)
  const declarations: string[] = []
  // 覆盖键必须是 COLOR_ATTRIBUTE_ITEMS 认识的外部键：未知键（旧版本残留）静默跳过，
  // 不让一个坏键毁掉整条规则。
  for (const key of Object.keys(merged).sort()) {
    const item = COLOR_ATTRIBUTE_BY_KEY[key]
    if (!item) continue
    declarations.push(`  ${item.cssVar}: ${merged[key]};`)
  }
  if (!declarations.length) return ''
  return `:root[data-theme='${theme}'] {\n${declarations.join('\n')}\n}`
}

/** 注入端的最小 DOM 形状（node 测试里可传假对象，浏览器里传 document 本身）。 */
export interface SchemeStyleDocument {
  getElementById(id: string): { textContent: string | null; remove?: () => void } | null
  createElement(tag: string): { id: string; textContent: string | null }
  head: { appendChild(node: unknown): void }
}

/**
 * 把方案应用到文档：写/换/删 id 为 `taocode-color-scheme` 的 style 元素。
 * `doc` 缺省时取全局 document；node（无 DOM）环境下是 no-op——规则本体已由 `schemeCssText` 单测覆盖。
 */
export function applyColorScheme(state: ColorSchemeState, doc?: SchemeStyleDocument | Document | null): void {
  const target = doc ?? (typeof document === 'undefined' ? null : document)
  if (!target) return
  const css = schemeCssText(state)
  const existing = target.getElementById(COLOR_SCHEME_STYLE_ELEMENT_ID) as { textContent: string | null; remove?: () => void } | null
  if (!css) {
    if (existing) { existing.textContent = ''; if (existing.remove) existing.remove() }
    return
  }
  if (existing) { existing.textContent = css; return }
  const element = target.createElement('style') as { id: string; textContent: string | null }
  element.id = COLOR_SCHEME_STYLE_ELEMENT_ID
  element.textContent = css
  // 注入端接受最小 DOM 形状（node 测试用假对象），所以这里对 `Document` 的真接口做一次窄化转译。
  ;(target.head as { appendChild(node: unknown): void }).appendChild(element)
}
