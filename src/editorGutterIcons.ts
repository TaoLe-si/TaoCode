// gutter 图标层的 DOM 渲染 —— 把 src/gutterIcons.ts 的"每行有哪些图标"画进 CodeMirror 的 gutter。
//
// 对应 IDEA 的 `EditorGutterComponentImpl` 画 `GutterIconRenderer` 那一段：本模块只负责
// 「拿到 renderer 列表 → 画出来 → 把点击交回动作」。图标的种类/外形/聚合规则在 src/gutterIcons.ts（纯逻辑、有单测）。
//
// 本模块只被 `CodeEditor.vue` 使用，**不被测试直接 import**（要 DOM），所以这里可以自由 import 同仓模块。
import { GutterMarker, gutter } from '@codemirror/view'
import type { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { RangeSet, StateEffect, StateField } from '@codemirror/state'
import { gutterIconAppearance, type GutterIcon } from './gutterIcons'

export type { GutterIcon } from './gutterIcons'

/** `GutterIconRenderer.getIcon()` 的等价物：一档一个内联 SVG。 */
function iconSvg(kind: GutterIcon['kind']): string {
  const { shape, color } = gutterIconAppearance(kind)
  if (shape === 'triangle') return `<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M6 1.6 11 10.4H1z" fill="${color}"/></svg>`
  if (shape === 'square') return `<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><rect x="1.8" y="1.8" width="8.4" height="8.4" rx="1.4" fill="${color}"/></svg>`
  if (shape === 'diamond') return `<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M6 1.4 10.6 6 6 10.6 1.4 6z" fill="${color}"/></svg>`
  return `<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><circle cx="6" cy="6" r="4.2" fill="${color}"/></svg>`
}

/** 一行可以并排多个图标（IDEA 同一行的多个 renderer 就是并排的），所以 cell 里放一个容器。 */
class GutterIconMarker extends GutterMarker {
  private readonly icons: readonly GutterIcon[]
  constructor(icons: readonly GutterIcon[]) {
    super()
    this.icons = icons
  }
  eq(other: GutterMarker) {
    if (!(other instanceof GutterIconMarker)) return false
    return other.icons.length === this.icons.length
      && other.icons.every((icon, index) => icon.key === this.icons[index]!.key)
  }
  toDOM() {
    const host = document.createElement('span')
    host.className = 'cm-gutter-icon-cell'
    for (const icon of this.icons) {
      const node = document.createElement('span')
      node.className = `cm-gutter-icon cm-gutter-icon-${icon.kind}${icon.clickable ? ' clickable' : ''}`
      node.title = icon.tooltip
      node.setAttribute('aria-label', icon.accessibleName)
      node.dataset.line = String(icon.line)
      node.dataset.kind = icon.kind
      node.innerHTML = iconSvg(icon.kind)
      host.appendChild(node)
    }
    return host
  }
}

/** 空白占位（宽度与最宽的图标一致），让 gutter 的宽度不随图标增减跳动。 */
const SPACER = new GutterIconMarker([{ line: 0, kind: 'error', tooltip: '', accessibleName: '', clickable: false, alignment: 'center', key: 'spacer' }])

/** 把宿主算好的图标灌进编辑器状态。 */
export const setGutterIcons = StateEffect.define<readonly GutterIcon[]>()

const gutterIconsField = StateField.define<readonly GutterIcon[]>({
  create: () => [],
  update(value, transaction) {
    let next = value
    for (const effect of transaction.effects) if (effect.is(setGutterIcons)) next = effect.value
    return next
  },
})

export interface GutterIconsOptions {
  /** 点击一个**可点击**图标时的回调（IDEA 的 `getClickAction().actionPerformed`）。 */
  onClick: (icon: GutterIcon) => void
}

/** gutter 扩展：按 `line` 分组渲染，点击用 dataset 里的行号/种类找回图标。 */
export function gutterIconsExtension(options: GutterIconsOptions): Extension {
  const widget = gutter({
    class: 'cm-gutter-icons',
    initialSpacer: () => SPACER,
    markers: view => {
      const icons = view.state.field(gutterIconsField)
      if (!icons.length) return RangeSet.empty
      const byLine = new Map<number, GutterIcon[]>()
      for (const icon of icons) {
        if (icon.line < 1 || icon.line > view.state.doc.lines) continue
        const list = byLine.get(icon.line)
        if (list) list.push(icon)
        else byLine.set(icon.line, [icon])
      }
      const ranges = [...byLine.entries()].map(([line, list]) =>
        new GutterIconMarker(list).range(view.state.doc.line(line).from))
      return ranges.length ? RangeSet.of(ranges, true) : RangeSet.empty
    },
    // gutter 的 domEventHandlers 签名是 (view, line, event)（与 EditorView.domEventHandlers 相反）。
    domEventHandlers: {
      mousedown(view: EditorView, line: { from: number }, event: Event) {
        const target = (event.target as HTMLElement | null)?.closest('.cm-gutter-icon') as HTMLElement | null
        if (!target || !target.classList.contains('clickable')) return false
        const number = view.state.doc.lineAt(line.from).number
        const icon = view.state.field(gutterIconsField)
          .find((item: GutterIcon) => item.line === number && item.kind === target.dataset.kind)
        if (!icon || !icon.clickable) return false
        event.preventDefault()
        options.onClick(icon)
        return true
      },
    },
  })
  return [gutterIconsField, widget]
}

/** 宿主侧同步入口（编辑器每次挂载或数据变化时调）。 */
export function syncGutterIcons(view: EditorView | undefined, icons: readonly GutterIcon[]): void {
  view?.dispatch({ effects: setGutterIcons.of(icons) })
}
