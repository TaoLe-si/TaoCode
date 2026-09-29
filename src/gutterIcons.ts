// 行内 gutter 图标层 —— IDEA `GutterIconRenderer` / `LineMarkerProvider` 那套宿主能力的对应物。
//
// 逐条对照的源码（`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · 渲染器接口 `platform/editor-ui-api/src/com/intellij/openapi/editor/markup/GutterIconRenderer.java`
//       `:42` 抽象类；`:59` `getTooltipText()`；`:68` `getClickAction()`（返回 `AnAction`，可空 ⇒ 图标可不可点）；
//       `:96` `isNavigateAction()`（点击算不算"导航"，影响返回栈）；
//       `:105` `getAlignment()`（`Alignment.LEFT/CENTER/RIGHT`，`:158-168`）；
//       `:121` `getAccessibleName()`；`:210` 强制实现 `equals`/`hashCode`（同一行多个 renderer 靠它去重）。
//   · 开关 `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:87`
//       `public boolean ARE_GUTTER_ICONS_SHOWN = true;` —— **默认开**；`:374-381` getter/setter。
//   · 动作 `platform/platform-impl/src/com/intellij/openapi/editor/actions/ToggleShowGutterIconsAction.java`
//       （`EditorToggleDecorationAction` 子类：`isSelected` = `editor.getSettings().areGutterIconsShown()`，
//        `setSelected` 写设置后 `repaint()`；`update` 里没有编辑器就置灰）
//       —— 注册见 `intellij.platform.ide.impl.actions.xml:415`，菜单行在 `PlatformActions.xml:577`
//       （`EditorToggleActions` 组，顺序：UseSoftWraps · **ShowGutterIcons** 在 ShowLineNumbers 之后 · ShowIndentLines）。
//   · 设置页 `platform/lang-impl/src/com/intellij/application/options/editor/GutterIconsConfigurable.java`
//       `id="editor.preferences.gutterIcons"`（`intellij.platform.lang.impl.xml:1187`，挂在 编辑器 › 常规 下），
//       `:221` Apply 写 `setGutterIconsShown`；页里还有一张"按插件分组的行标记列表"
//       （`LineMarkerProvider` 分组 + 每项勾选）—— 那部分依赖 LineMarkerProvider 体系，TaoCode 暂无，登记待办。
//
// 本模块是**纯逻辑**（零 import ⇒ 可被测试直接 import）：把各数据源折成"每行有哪些图标"，
// DOM 渲染在 src/editorGutterIcons.ts。

/** 图标的种类。IDEA 侧对应不同的内建标记 / `LineMarkerProvider`。 */
export type GutterIconKind = 'error' | 'warning' | 'hint' | 'breakpoint' | 'bookmark'

/** 渲染器对齐方式（`GutterIconRenderer.Alignment`，`:158-168`）。 */
export type GutterAlignment = 'left' | 'center' | 'right'

export interface GutterIcon {
  /** 1 基行号（IDEA 的 `LineMarkerInfo` 同样是 1 基）。 */
  line: number
  kind: GutterIconKind
  /** `GutterIconRenderer.getTooltipText()`。 */
  tooltip: string
  /** `GutterIconRenderer.getAccessibleName()`。 */
  accessibleName: string
  /** `getClickAction() != null`。 */
  clickable: boolean
  alignment: GutterAlignment
  /** 去重键（对应源码要求的 `equals`/`hashCode`）。 */
  key: string
}

/** 同一行上多个图标的并排顺序（IDEA 按插件顺序排；这里按"越严重越靠左"）。 */
export const GUTTER_ICON_ORDER: readonly GutterIconKind[] =
  ['error', 'warning', 'hint', 'breakpoint', 'bookmark']

/** 一档的外形与配色（配色全部走主题变量，见 src/tokens.css）。 */
export interface GutterIconAppearance {
  shape: 'circle' | 'triangle' | 'square' | 'diamond'
  color: string
}

export function gutterIconAppearance(kind: GutterIconKind): GutterIconAppearance {
  switch (kind) {
    case 'error': return { shape: 'circle', color: 'var(--error)' }
    case 'warning': return { shape: 'triangle', color: 'var(--warning)' }
    case 'hint': return { shape: 'circle', color: 'var(--accent)' }
    case 'breakpoint': return { shape: 'square', color: 'var(--error)' }
    case 'bookmark': return { shape: 'diamond', color: 'var(--accent)' }
  }
}

function push(byLine: Map<number, GutterIcon[]>, entry: GutterIcon) {
  const list = byLine.get(entry.line)
  if (list) list.push(entry)
  else byLine.set(entry.line, [entry])
}

/** LSP 的 4 档严重度（1 Error / 2 Warning / 3 Information / 4 Hint）折到图标种类。 */
export function gutterKindForSeverity(severity: number): GutterIconKind {
  if (severity <= 1) return 'error'
  if (severity === 2) return 'warning'
  return 'hint'
}

/** 诊断项（`lspDiagnostics` 的形状，**行号 0 基** —— 与 LSP 一致；本模块内部转 1 基）。 */
export interface GutterDiagnostic { line: number; severity?: number; message: string }

/** 各数据源：都是 TaoCode 已有的真实数据，不新造来源。 */
export interface GutterIconSources {
  /** LSP 诊断（`lspDiagnostics`）。 */
  diagnostics?: readonly GutterDiagnostic[] | undefined
  /** DAP 断点（`dapBreakpoints`，1 基行号）。 */
  breakpoints?: readonly number[] | undefined
  /** 书签（`bookmarkLines`，1 基行号）。 */
  bookmarks?: readonly number[] | undefined
}

function icon(line: number, kind: GutterIconKind, tooltip: string, clickable: boolean,
              alignment: GutterAlignment = 'center'): GutterIcon {
  return { line, kind, tooltip, accessibleName: tooltip, clickable, alignment, key: `${line}:${kind}:${tooltip}` }
}

/**
 * 把各数据源折成"每行有哪些图标"。
 *
 * `enabled` 就是 `EditorSettingsExternalizable.areGutterIconsShown()`：关掉时**一个都不产出**
 * （IDEA 侧关掉后 gutter 不再画 renderer；标记本身仍在，只是不画）。
 */
export function collectGutterIcons(sources: GutterIconSources, enabled: boolean): GutterIcon[] {
  if (!enabled) return []
  const byLine = new Map<number, GutterIcon[]>()

  // 诊断：同一行的多条消息合成**一个**图标（tooltip 列出全部消息），严重度取最高的那条 ——
  // 与 IDEA 一致：一行的多个 `HighlightInfo` 合成一个 renderer，tooltip 是多行文本。
  const perLine = new Map<number, GutterDiagnostic[]>()
  for (const diagnostic of sources.diagnostics ?? []) {
    const line = diagnostic.line + 1
    if (line < 1) continue
    const list = perLine.get(line)
    if (list) list.push(diagnostic)
    else perLine.set(line, [diagnostic])
  }
  for (const [line, list] of perLine) {
    const worst = Math.min(...list.map(item => item.severity || 4))
    const tooltip = list.map(item => item.message).join('\n')
    push(byLine, icon(line, gutterKindForSeverity(worst), tooltip, true))
  }

  for (const line of sources.breakpoints ?? []) push(byLine, icon(line, 'breakpoint', '断点：点击切换', true))
  // 书签图标在 IDEA 里点开的是一个弹层（删除 / 助记符 / 上一个 / 下一个），TaoCode 还没有 gutter 右键弹层
  // 这套基建，所以按 `getClickAction() == null` 的形态渲染（接口允许不可点击），tooltip 里写明移除入口。
  for (const line of sources.bookmarks ?? []) {
    push(byLine, icon(line, 'bookmark', '书签（移除请用「切换书签」或书签面板）', false))
  }

  return [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([, icons]) => icons.sort((a, b) => GUTTER_ICON_ORDER.indexOf(a.kind) - GUTTER_ICON_ORDER.indexOf(b.kind)))
}
