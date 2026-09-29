// gutter 图标层的宿主装配 —— 把各数据源交给 `collectGutterIcons`，并把图标点击派回对应动作。
//
// 数据源全部是 TaoCode 已有的真实数据（LSP 诊断 / DAP 断点 / 书签），不新造来源。
// 与 IDEA 的对应：`GutterIconRenderer.getClickAction()`（点击执行动作）、
// `isNavigateAction()`（诊断是"导航到该行"，断点是"切换"，书签不可点）。
//
// 为什么单独成模块：App.vue 已到机检上限，而这一域（图标合成 + 点击分派）自洽，
// 宿主只留一行装配。
import { computed } from 'vue'
import { collectGutterIcons, type GutterIcon } from './gutterIcons'
import type { LspDiagnostic } from './bridge'
import type { Tab } from './editorTab'

export interface GutterIconHostDeps {
  /** 当前活动标签（拿文件路径）。 */
  active: { readonly value: Tab | undefined }
  /** 编辑器设置（读 `showGutterIcons` —— 对应 IDEA `areGutterIconsShown()`）。 */
  editorSettings: { readonly value: { showGutterIcons?: boolean } }
  /** LSP 诊断表（`lspDiagnostics`，行号 0 基）。 */
  diagnostics: Map<string, LspDiagnostic[]>
  /** 跳到某一行（诊断图标点击 = 导航，对应 `isNavigateAction()`）。 */
  revealLocation: (target: { path: string; line: number }) => unknown
  /** 切换断点（断点图标点击）。 */
  toggleBreakpointAt: (path: string, line: number) => unknown
  /** 提示诊断消息（点击后立即看到内容，不必悬停）。 */
  notify: (message: string, error?: boolean) => void
  /** 当前文件的书签行（1 基）。 */
  bookmarks: (path: string) => readonly number[]
  /** 当前文件的断点行（1 基）。 */
  breakpointLines: (path: string) => readonly number[]
}

export function createGutterIconHost(deps: GutterIconHostDeps) {
  /** 当前文件在这一刻该画哪些图标；关掉设置时 `collectGutterIcons` 返回空表。 */
  const gutterIcons = computed<GutterIcon[]>(() => {
    const path = deps.active.value?.path
    if (!path) return []
    return collectGutterIcons({
      diagnostics: deps.diagnostics.get(path) ?? [],
      breakpoints: deps.breakpointLines(path),
      bookmarks: deps.bookmarks(path),
    }, deps.editorSettings.value.showGutterIcons !== false)
  })

  /** `GutterIconRenderer.getClickAction()` 的落点。 */
  function onGutterIcon(icon: GutterIcon) {
    const path = deps.active.value?.path
    if (!path || !icon.clickable) return
    if (icon.kind === 'breakpoint') { deps.toggleBreakpointAt(path, icon.line); return }
    // 诊断：跳到该行并把这行的消息直接说出来（悬停才看得到的话等于没看到）
    deps.revealLocation({ path, line: icon.line - 1 })
    if (icon.kind !== 'bookmark') deps.notify(icon.tooltip)
  }

  return { gutterIcons, onGutterIcon }
}
