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

/**
 * 装订线上的书签（行书签才有图标；文件书签没有行号，不进装订线）。
 * `tooltip` 由调用方按上游 `GutterLineBookmarkRenderer.getTooltipText:56-72` 拼好
 * （`src/bookmarks.ts` 的 `bookmarkGutterTooltip`）—— 本模块保持零 import，方便单测直接 import。
 */
export interface GutterBookmark {
  /** 1 基行号。 */
  line: number
  /** 悬停文本（「书签[ 助记键][: 描述][ (键)]」）。 */
  tooltip: string
}

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
  /** 中键动作（`GutterIconRenderer.getMiddleButtonClickAction()`，书签是 `EditBookmark`）。 */
  middleClickable?: boolean
  alignment: GutterAlignment
  /** 去重键（对应源码要求的 `equals`/`hashCode`）。 */
  key: string
}

/** 同一行上多个图标的并排顺序（IDEA 按插件顺序排；这里按"越严重越靠左"）。 */
export const GUTTER_ICON_ORDER: readonly GutterIconKind[] =
  ['error', 'warning', 'hint', 'breakpoint', 'bookmark']

/**
 * 一档的外形与配色（配色全部走主题变量，见 src/tokens.css）。
 *
 * `shape` 是**降级外形**：真机渲染走 `ideaIcon`（IDEA 的原样图标，见
 * `src/components/icons/ideaIconData.ts` 的 `IDEA_ICON_STATUS`），只有在拿不到那份数据时
 * 才退回这个几何记号（无 DOM 的测试环境、或图标名拼错）。保留它同时是为了让
 * 「一档一个外形 + 一档一个主题色」这条契约本身可判（`tests/gutter-icons.test.mjs`）。
 */
export interface GutterIconAppearance {
  shape: 'circle' | 'triangle' | 'square' | 'diamond'
  color: string
  /** IDEA 原样图标名（`IDEA_ICON_STATUS` 的键）。上游出处逐条写在下面。 */
  ideaIcon: 'error' | 'warning' | 'info' | 'breakpoint' | 'bookmark'
}

/**
 * 一档的外形、主题色与 IDEA 原样图标。
 *
 * 上游依据（`platform/util/ui/src/com/intellij/icons/AllIcons.java`）：
 *   · `:570` `General.Error`   = `expui/status/error.svg`（红色实心圆 + 白色感叹号）
 *   · `:679` `General.Warning` = `expui/status/warning.svg`（黄色实心三角 + 白色感叹号）
 *   · `:589` `General.Information` = `expui/status/info.svg`（蓝色实心圆 + 白色 i）
 *   · 书签 = `expui/gutter/bookmark.svg`（黄色实心书签），断点 = `expui/breakpoints/breakpoint.svg`（红色实心圆）
 * 这三张 status 图**自己就带语义色**（不是 `#6C707E` 那套单色前景），所以本仓照抄形状、
 * 只把主色换成 `currentColor` 让主题变量接管（明暗主题各有取值）。
 */
export function gutterIconAppearance(kind: GutterIconKind): GutterIconAppearance {
  switch (kind) {
    case 'error': return { shape: 'circle', color: 'var(--error)', ideaIcon: 'error' }
    case 'warning': return { shape: 'triangle', color: 'var(--warning)', ideaIcon: 'warning' }
    case 'hint': return { shape: 'circle', color: 'var(--accent)', ideaIcon: 'info' }
    case 'breakpoint': return { shape: 'square', color: 'var(--error)', ideaIcon: 'breakpoint' }
    case 'bookmark': return { shape: 'diamond', color: 'var(--accent)', ideaIcon: 'bookmark' }
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
  /** 书签（行书签；1 基行号 + 助记键 + 描述）。 */
  bookmarks?: readonly GutterBookmark[] | undefined
}

function icon(line: number, kind: GutterIconKind, tooltip: string, clickable: boolean,
              alignment: GutterAlignment = 'center', middleClickable = false): GutterIcon {
  return { line, kind, tooltip, accessibleName: tooltip, clickable, middleClickable, alignment, key: `${line}:${kind}:${tooltip}` }
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
  for (const entry of sources.bookmarks ?? []) {
    // 上游 `GutterLineBookmarkRenderer`：tooltip = 「书签[ <助记键>][: 描述][ (<键>)]」
    // （`:56-72`），`getClickAction()` = ToggleBookmark，`getMiddleButtonClickAction()` = EditBookmark
    // （`:48-50`），对齐方式 `Alignment.RIGHT`（`:46`）。
    push(byLine, icon(entry.line, 'bookmark', entry.tooltip, true, 'right', true))
  }

  return [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([, icons]) => icons.sort((a, b) => GUTTER_ICON_ORDER.indexOf(a.kind) - GUTTER_ICON_ORDER.indexOf(b.kind)))
}
