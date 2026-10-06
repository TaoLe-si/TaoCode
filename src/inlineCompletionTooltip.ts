// 行内补全的**悬浮操作条**（上游 `platform/platform-impl/codeinsight-inline/src/com/intellij/codeInsight/inline/completion/tooltip/`）。
//
// 上游这一族的真实形状（本文件逐条对过，2026-10-06 实测行号）：
//   · **触发**：`InlineCompletionTooltipProvokerMouseListener.kt:11-25` —— **右键**（`:40` 只认
//     `MouseEvent.BUTTON3`）点在**正在显示的幽灵文本范围内**（`:44-49`：会话存在、正在显示、
//     `session.context.state.containsPoint(point)`）；已显示就收起、没显示就弹出（`:19-24` 的 toggle），
//     并且消费掉这次点击（`:17` 的 `event.consume()` ⇒ 不再弹编辑器自己的右键菜单）。
//   · **内容**：`InlineCompletionTooltipComponent.kt:15-27` 只有**一行**：
//     `shortcutActions(...)`（一个快捷键下拉）+ 一句说明文案 + `session.provider.providerPresentation.getTooltip(project)`
//     （**provider 自己**那一份，`InlineCompletionTooltipFactory.kt:16-40`：图标 + 注释 + 更多动作）。
//   · 说明文案 = `IdeBundle.properties:3234` 的 `inline.completion.tooltip.shortcuts.accept.description`
//     = **`to complete`**（本仓界面是中文 ⇒ 直译「以补全」，原文写在常量注释里）。
//   · 下拉里那几条（`InlineCompletionTooltipActions.kt:34-47`）是 Tab / → / Enter / Shift → 四个
//     **插入快捷键候选**，点一条就**改写 keymap**（`:127-156` 的 `InplaceChangeInlineCompletionShortcutAction`
//     走 `KeymapManager` 派生副本再 `addShortcut`）。本仓没有用户可改的键位面（`src/keymap*.ts` 是静态表、
//     且不在本轮可改面里）⇒ **这一半不做**：浮层只列出本仓真实存在的接受键，不放假的下拉项。
//   · provider 那一份需要 provider 的名字与图标：本仓唯一的供给是语言服务的
//     `textDocument/inlineCompletion`，正形状里没有可核实的服务名（`InlineCompletionItem` 只有
//     `insertText`/`filterText`/`range`）⇒ **没有就不渲染**，不编一个来源名。
//
// 于是本轮真正落的是：**右键命中幽灵文本 ⇄ 一行「Tab 以补全」的浮层**，
// 位置在锚点上方、留 8px（`InlineCompletionTooltip.kt:68-73`：`HintManager.ABOVE` 且
// `y -= panel.preferredHeight + JBUIScale.scale(8)`），收起时机对齐上游那份
// `HIDE_BY_CARET_MOVE or HIDE_BY_TEXT_CHANGE or HIDE_BY_SCROLLING`（`InlineCompletionTooltip.kt:76-78`）：
// 按键（打字/接受/收起都会动光标或改文本）、鼠标按下（点别处）、滚动、窗口失焦。
//
// 键位与显示文本从 `src/inlineCompletionExtension.ts` 的**真实绑定表**里取（`role` 标在绑定上），
// 所以浮层里出现的组合键一定是按得动的，不是抄来的。

/** 绑定表上的角色标记（`src/inlineCompletionExtension.ts` 的 `inlineCompletionBindings` 用它声明自己干什么）。 */
export type InlineBindingRole = 'accept' | 'accept-word' | 'accept-line' | 'dismiss'

/** 本模块只认绑定表的这三个字段（不依赖 CodeMirror 的类型，便于用例直接喂表）。 */
export interface InlineBindingShape {
  key: string
  role?: InlineBindingRole
}

/** 浮层里的一行：组合键文本 + 它的意思。 */
export interface InlineTooltipRow {
  keys: string
  text: string
}

/** `IdeBundle.properties:3234` `inline.completion.tooltip.shortcuts.accept.description=to complete` 的直译。 */
export const INLINE_TOOLTIP_ACCEPT_DESCRIPTION = '以补全'

/** `InlineCompletionTooltip.kt:73` 的 `JBUIScale.scale(8)`：浮层与锚点之间的间距。 */
export const INLINE_TOOLTIP_GAP_PX = 8

/**
 * 上游 provoker 的三点判据（`InlineCompletionTooltipProvokerMouseListener.kt:35-50`）：
 * 只有**右键**、事件**没被消费过**、并且**当前有正在显示的建议**。
 * 「点must在幽灵文本范围内」这一条由挂点承担（监听器就绑在幽灵文本那个元素上）。
 */
export function isInlineTooltipProvoker(button: number, hasSuggestion: boolean, isConsumed = false): boolean {
  if (isConsumed || !hasSuggestion) return false
  return button === 2                                       // `:40` 的 `MouseEvent.BUTTON3`
}

/**
 * 浮层行 = 绑定表里**真能把建议插进文档**的那几条（上游只列插入快捷键，`InlineCompletionTooltipActions.kt:34-47`）。
 * 收起（`dismiss`）与部分接受（`accept-word`/`accept-line`）不进这张表：上游这个浮层里没有它们。
 */
export function inlineTooltipEntries(bindings: readonly InlineBindingShape[]): InlineTooltipRow[] {
  return bindings
    .filter(binding => binding.role === 'accept')
    .map(binding => ({ keys: binding.key, text: INLINE_TOOLTIP_ACCEPT_DESCRIPTION }))
}

/** 无障碍读出来的整句（本仓没有图标，只有这两段文本）。 */
export function inlineCompletionTooltipText(rows: readonly InlineTooltipRow[]): string {
  return rows.map(row => `${row.keys} ${row.text}`).join('，')
}

/** 浮层的定位锚（幽灵文本元素的视口矩形；`getBoundingClientRect()` 的那几个字段）。 */
export interface InlineTooltipAnchor {
  top: number
  bottom: number
  left: number
}

/**
 * 一行浮层：键名 + 说明。颜色全部走 tokens.css 的浮层令牌（不写死十六进制），
 * 定位用 `position: fixed`（与 `src/completionUi.ts` 的 `tooltips({ parent: document.body })` 同一层，
 * 不受编辑器 overflow 裁切）。
 */
export function buildInlineTooltipElement(doc: Document, rows: readonly InlineTooltipRow[]): HTMLElement {
  const panel = doc.createElement('div')
  panel.className = 'tc-inline-tooltip'
  panel.setAttribute('role', 'tooltip')
  const label = inlineCompletionTooltipText(rows)
  if (label) panel.setAttribute('aria-label', label)
  panel.style.cssText = [
    'position:fixed', 'z-index:1000', 'display:flex', 'align-items:center', 'gap:6px', 'padding:2px 8px',
    'white-space:nowrap', 'border-radius:var(--popup-radius)', 'border:var(--popup-border)',
    'box-shadow:var(--popup-shadow)', 'background-color:var(--completion-background)',
    'color:var(--completion-foreground)', 'font-family:var(--font-mono)',
  ].join(';')
  for (const row of rows) {
    const keys = panel.appendChild(doc.createElement('span'))
    keys.className = 'tc-inline-tooltip-keys'
    keys.style.cssText = 'font-weight:600;color:var(--completion-match)'
    keys.textContent = row.keys
    const text = panel.appendChild(doc.createElement('span'))
    text.className = 'tc-inline-tooltip-text'
    text.textContent = row.text
  }
  return panel
}

/**
 * 浮层的竖直落点：默认在锚点**上方**（上游 `HintManager.ABOVE` 再减一个自身高度，
 * `InlineCompletionTooltip.kt:68-73`）；上方放不下就落回锚点下面（本仓自己的兜底，上游由
 * `HintManagerImpl.getHintPosition` 决定，同一档语义）。
 */
export function inlineTooltipTop(anchor: InlineTooltipAnchor, height: number, viewportTop = 0, viewportBottom = Number.POSITIVE_INFINITY): number {
  const above = anchor.top - INLINE_TOOLTIP_GAP_PX - height
  if (above >= viewportTop) return above
  return Math.max(viewportTop, Math.min(anchor.bottom + INLINE_TOOLTIP_GAP_PX, viewportBottom - height))
}

interface InlineTooltipHandle {
  element: HTMLElement
  detach: () => void
}

/** 每台编辑器当前显示的那一个浮层（上游那份挂在 session 的 `dataHolder` 上，`InlineCompletionTooltip.kt:28`）。 */
const shownTooltips = new WeakMap<object, InlineTooltipHandle>()

export function isInlineTooltipShown(target: object): boolean {
  return shownTooltips.has(target)
}

/** 收起（上游 `InlineCompletionTooltip.hide`，`:93-97`）。 */
export function hideInlineCompletionTooltip(target: object): void {
  const handle = shownTooltips.get(target)
  if (!handle) return
  handle.detach()
  shownTooltips.delete(target)
  handle.element.remove()
}

/**
 * 右键 ⇄ 开关浮层（`InlineCompletionTooltipProvokerMouseListener.kt:19-24` 的 toggle）。
 * 返回 true = 这次点击归我（调用方据此 `preventDefault`，对应上游 `:17` 的 `event.consume()`）。
 */
export function toggleInlineCompletionTooltip(
  target: object, anchor: InlineTooltipAnchor, rows: readonly InlineTooltipRow[],
  doc: Document = document,
): boolean {
  if (isInlineTooltipShown(target)) {
    hideInlineCompletionTooltip(target)
    return true
  }
  if (!rows.length) return false                             // 没有可显示的键位 ⇒ 不弹空浮层
  const element = buildInlineTooltipElement(doc, rows)
  element.style.left = `${Math.max(0, Math.round(anchor.left))}px`
  element.style.top = '0'
  doc.body.appendChild(element)
  const height = element.offsetHeight
  element.style.top = `${Math.round(inlineTooltipTop(anchor, height, 0, window.innerHeight))}px`
  // 收起时机 = 上游那份 HIDE_BY_CARET_MOVE / HIDE_BY_TEXT_CHANGE / HIDE_BY_SCROLLING（`:76-78`）：
  // 打字与切光标都会走 keydown/mousedown，滚轮与换窗口同理；点浮层自己不收（浮层里没有可点的东西）。
  const detach = () => {
    doc.removeEventListener('keydown', onDismiss, true)
    doc.removeEventListener('mousedown', onDismiss, true)
    window.removeEventListener('scroll', onDismiss, true)
    window.removeEventListener('blur', onDismiss)
  }
  const onDismiss = (event?: Event) => {
    if (event && element.contains(event.target as Node)) return
    hideInlineCompletionTooltip(target)
  }
  doc.addEventListener('keydown', onDismiss, true)
  doc.addEventListener('mousedown', onDismiss, true)
  window.addEventListener('scroll', onDismiss, true)
  window.addEventListener('blur', onDismiss)
  shownTooltips.set(target, { element, detach })
  return true
}
