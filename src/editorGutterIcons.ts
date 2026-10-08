// gutter 图标层的 DOM 渲染 —— 把 src/gutterIcons.ts 的"每行有哪些图标"画进 CodeMirror 的 gutter。
//
// 对应 IDEA 的 `EditorGutterComponentImpl` 画 `GutterIconRenderer` 那一段：本模块只负责
// 「拿到 renderer 列表 → 画出来 → 把点击交回动作」。图标的种类/外形/聚合规则在 src/gutterIcons.ts（纯逻辑、有单测）。
//
// 本模块只被 `CodeEditor.vue` 使用，**不被测试直接 import**（要 DOM），所以这里可以自由 import 同仓模块。
import { EditorView, GutterMarker, ViewPlugin, gutter } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { RangeSet, StateEffect, StateField } from '@codemirror/state'
import { gutterIconAppearance, type GutterIcon } from './gutterIcons.ts'
import { ideaStatusIconSvg } from './components/icons/ideaIconData.ts'

export type { GutterIcon } from './gutterIcons'

/** IDEA 装订线图标的显示边长（上游 `AllIcons.General.Error` 等是 16x16 SVG）。 */
const GUTTER_ICON_SIZE = 16

/**
 * `GutterIconRenderer.getIcon()` 的等价物：一档一个内联 SVG。
 *
 * 真机走 IDEA 的**原样图标**（`IDEA_ICON_STATUS`，出处 `AllIcons.java:570/679/589`）；
 * 只有拿不到那份数据时才退回下面的几何记号 —— 那是给"无 DOM 的测试环境"和
 * "图标名拼错"留的降级路径，不是设计形状。
 */
function iconSvg(kind: GutterIcon['kind']): string {
  const { shape, color, ideaIcon } = gutterIconAppearance(kind)
  const idea = ideaStatusIconSvg(ideaIcon, color, GUTTER_ICON_SIZE)
  if (idea) return idea
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
  /** 中键动作（`getMiddleButtonClickAction()`）：书签是 EditBookmark。 */
  onMiddleClick?: (icon: GutterIcon) => void
}

/** gutter 扩展：按 `line` 分组渲染，点击用 dataset 里的行号/种类找回图标。 */
/**
 * 装订线上的右键 → 「装订线菜单」（IDEA 的 `EditorGutterPopupMenu`）。
 *
 * **挂在哪很关键**：`EditorView.domEventHandlers` 只注册在**内容**元素（`.cm-content`）上，
 * 而装订线是它的兄弟节点 —— 挂在那里一条都收不到（真机实测：右键装订线没反应）。
 * 所以这里用一个 `ViewPlugin` 把监听器挂在 `view.dom` 里的 `.cm-gutters` 上（捕获阶段），
 * 装订线的每一列（行号、图标、追溯注解）都覆盖到。
 *
 * 收到事件后：把光标移到那一行（上游在装订线上右键会把光标带过去，后续动作如助记键以这行为准）、
 * 交回宿主、并**吞掉这次事件** —— 不吞会继续冒泡到编辑器容器的右键处理，弹出的是编辑器菜单
 * （上游也是两个菜单）。
 */
export function gutterContextMenu(onMenu: (line0: number, x: number, y: number) => void): Extension {
  return ViewPlugin.fromClass(class {
    // 注意：这里**不能**写 `constructor(private readonly view: EditorView)` —— 参数属性是 TS 的
    // 类型扩展语法，Node 22 直跑 .ts 时用的是 strip-only 模式，遇到它会直接
    // `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`（测试就是被这一行挡住的）。显式字段即可。
    private readonly view: EditorView
    private readonly element: HTMLElement | null
    private readonly handler = (event: MouseEvent) => {
      const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos === null) return
      const line = this.view.state.doc.lineAt(pos)
      this.view.dispatch({ selection: { anchor: line.from }, scrollIntoView: false })
      onMenu(line.number - 1, event.clientX, event.clientY)
      event.preventDefault()
      event.stopPropagation()
    }
    constructor(view: EditorView) {
      this.view = view
      this.element = view.dom.querySelector<HTMLElement>('.cm-gutters')
      this.element?.addEventListener('contextmenu', this.handler, true)
    }
    destroy() { this.element?.removeEventListener('contextmenu', this.handler, true) }
  })
}

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
        // 中键 = `getMiddleButtonClickAction()`（书签是 EditBookmark）；左键走 onClick。
        const middle = (event as MouseEvent).button === 1
        if (middle && !icon.middleClickable) return false
        if (middle && !options.onMiddleClick) return false
        event.preventDefault()
        if (middle) options.onMiddleClick?.(icon)
        else options.onClick(icon)
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
