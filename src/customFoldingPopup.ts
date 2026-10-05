// 自定义折叠区域的列表弹层（上游 `platform/lang-impl/src/com/intellij/lang/customFolding/`
// 的 `CustomFoldingRegionsPopup`；键位 `$default.xml:535-537` `GotoCustomRegion` = Ctrl+Alt+.)。
//
// 上游坐标：
//   · `CustomFoldingRegionsPopup.java:23-41` —— `createPopupChooserBuilder(model)` + 标题
//     （`goto.custom.region.command`）+ 选中回调；`GotoCustomRegionAction.java:60-66`
//     一个区域都没有时给一条提示而不是弹空窗。
//   · `:62-78` `orderByPosition` 的顺序与嵌套层数（在 `src/customFoldingRegions.ts` 里）；
//     `:57-59` 每层三个空格的缩进；占位文字来自 provider 的 `getPlaceholderText`。
//   · `:80-88` `navigateTo` —— 光标移到开始标记的偏移、居中滚动、清掉次要光标与选区。
//
// 外观复用 `style.css` 里已经有的选择器弹层族（`.select-in` / `.select-in-row` /
// `.is-selected`）：同一套 `--popup-*` 令牌、同一行高与内缩，所以**不新增样式表规则**
// （`.select-in` 是 `position: fixed`，位置用视口坐标给，挂哪儿都不影响定位）。
// 本仓没有 `JBPopupFactory` 的模态/钉住/阴影那套，标题行用 `.choose-target-title` 那一档样式。
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { nextCustomRegion, regionEntries, regionIndent, type CustomRegion } from './customFoldingRegions.ts'

// 两条文案都取随 IDE 发货的中文包（`plugins/localization-zh/lib/localization-zh.jar` 的
// `messages/IdeBundle.properties`），键是上游的 bundle key：
//   · `:1104` `goto.custom.region.command=转到自定义折叠` —— 弹层标题（`CustomFoldingRegionsPopup.java:29`
//     的 `setTitle(IdeBundle.message("goto.custom.region.command"))`）；
//   · `:1107` `goto.custom.region.message.unavailable=当前文件中没有自定义的折叠` ——
//     一条区域都没有时的那条提示（`GotoCustomRegionAction.java:65`）。
// 上游英文原文见 `platform/platform-api/resources/messages/IdeBundle.properties:1063/1066`。
export const GOTO_CUSTOM_REGION_TITLE = '转到自定义折叠'
export const NO_CUSTOM_REGIONS_IN_FILE = '当前文件中没有自定义的折叠'

export interface CustomRegionsPopupController {
  extension: Extension
  /** 有区域就弹窗并返回 true；一个区域都没有时返回 false（调用方给提示）。 */
  show(): boolean
  close(): void
}

export function createCustomRegionsPopup(getView: () => EditorView | undefined): CustomRegionsPopupController {
  let popup: HTMLDivElement | undefined
  let rows: HTMLButtonElement[] = []
  let index = 0

  function close() {
    popup?.remove()
    popup = undefined
    rows = []
  }

  /** 跳到第 `n` 个区域（`navigateTo`：单光标、落在开始标记、清选区、居中）。 */
  function navigate(region: CustomRegion) {
    const view = getView()
    close()
    if (!view) return
    view.dispatch({ selection: EditorSelection.cursor(region.from), scrollIntoView: true })
    view.focus()
  }

  function place(view: EditorView, at: number) {
    const rect = view.dom.getBoundingClientRect()
    const coordinates = view.coordsAtPos(at)
    if (!popup) return
    const top = coordinates ? coordinates.bottom + 4 : rect.bottom
    popup.style.top = `${Math.max(4, Math.min(top, window.innerHeight - 40))}px`
    popup.style.left = `${Math.max(4, Math.min(coordinates?.left ?? rect.left, window.innerWidth - 240))}px`
  }

  function show() {
    const view = getView()
    if (!view) return false
    const regions = regionEntries(view.state.doc.toString())
    if (!regions.length) return false
    close()
    popup = document.createElement('div')
    popup.className = 'select-in'
    popup.setAttribute('role', 'listbox')
    popup.setAttribute('aria-label', GOTO_CUSTOM_REGION_TITLE)
    const title = document.createElement('h3')
    title.className = 'choose-target-title'
    title.textContent = GOTO_CUSTOM_REGION_TITLE
    popup.append(title)
    const list = document.createElement('div')
    list.className = 'find-history'
    for (const region of regions) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'select-in-row'
      row.textContent = regionIndent(region.label, region.depth)
      row.title = `第 ${region.startLine + 1}–${region.endLine + 1} 行`
      row.addEventListener('click', () => navigate(region))
      list.append(row)
    }
    popup.append(list)
    view.dom.append(popup)
    rows = [...list.children] as HTMLButtonElement[]
    // 光标当前所在区域排在最前（上游没有这个行为，但列表一打开就该指向脚下）。
    const current = nextCustomRegion(regions, view.state.doc.lineAt(view.state.selection.main.head).number - 1, true)
    index = Math.max(0, regions.findIndex(region => region.from === current?.from))
    place(view, view.state.selection.main.head)
    highlight()
    popup.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { move(1); event.preventDefault() }
      else if (event.key === 'ArrowUp') { move(-1); event.preventDefault() }
      else if (event.key === 'Enter') { event.preventDefault(); const region = regions[index]; if (region) navigate(region) }
      else if (event.key === 'Escape') { event.preventDefault(); close(); view.focus() }
    })
    popup.tabIndex = 0
    popup.focus()
    return true
  }

  function highlight() {
    for (const [at, row] of rows.entries()) row.classList.toggle('is-selected', at === index)
    rows[index]?.scrollIntoView({ block: 'nearest' })
  }

  function move(step: number) {
    if (!rows.length) return
    index = (index + step + rows.length) % rows.length
    highlight()
  }

  const extension = [
    EditorView.updateListener.of(update => {
      // 文档一变区域表就过期了 —— 与 `ImageOrColorPreviewService` 的「文本变化即收起」同一口径。
      if (update.docChanged) close()
    }),
    EditorView.domEventHandlers({
      // 焦点离开编辑器时收起（`AbstractPopup` 的「点外面就关」在 DOM 编辑器里对应 blur）。
      blur: () => close(),
    }),
  ]

  return { extension, show, close }
}
