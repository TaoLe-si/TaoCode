// 字面量预览的 CodeMirror 落点（上游 `ImageOrColorPreviewService` 的鼠标侧行为，见 src/literalPreview.ts 头部）。
//
// 从 `CodeEditor.vue` 搬出来做成自包含控制器（那个文件贴着机检上限）：扩展自己的 DOM 弹层
// 挂在 `view.dom` 里（`.cm-editor` 是定位上下文），不占 Vue 模板一行。
//
// 三条上游语义照搬：
//   · **Shift + 悬停**才显示（`ImageOrColorPreviewService.kt:152-154` 的 `event.mouseEvent.isShiftDown`）；
//   · 显示在光标/鼠标处（`:192` 的 `editor.offsetToXY(offset)`）；
//   · 鼠标移开、文本变化或松开 Shift 就收（`:206-218` 的 `HidePreviewRequest`）。
// 图片字节走宿主 `file.readBinary`（工作区相对、有大小上限），转 data URL 后贴 <img>；
// 颜色直接画色块。两者都失败时静默收起 —— 预览是辅助，不该弹出错误打断编辑。

import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { imageMimeFor, literalAt, resolveImagePath, type LiteralPreview } from './literalPreview.ts'

export interface LiteralPreviewDeps {
  /** 大文件降级时关掉（与语言服务同一档：预览也要读盘）。 */
  enabled: () => boolean
  /** 当前文档的工作区相对路径：图片字面量按它的目录解析。 */
  documentPath: () => string
  /** 读图片字节；失败返回 null（浏览器预览态没有磁盘）。 */
  loadImage: (path: string) => Promise<{ base64: string; kind: string } | null>
}

export interface LiteralPreviewController {
  extension: Extension
  hide(): void
}

/** 预览贴图的字节上限（与 MarkdownPreview 的图片上限同档）：超过就当作读不到。 */
export const IMAGE_PREVIEW_LIMIT = 4 * 1024 * 1024

export function createLiteralPreview(deps: LiteralPreviewDeps): LiteralPreviewController {  let popup: HTMLDivElement | undefined
  let generation = 0
  let lastKey = ''

  function hide() {
    generation++
    lastKey = ''
    if (popup) { popup.remove(); popup = undefined }
  }

  function place(view: EditorView, literal: LiteralPreview, content: HTMLElement): HTMLDivElement {
    if (!popup) {
      popup = document.createElement('div')
      popup.className = 'literal-preview'
      view.dom.appendChild(popup)
    }
    popup.replaceChildren(content)
    const coordinates = view.coordsAtPos(literal.from)
    const rect = view.dom.getBoundingClientRect()
    if (coordinates) {
      popup.style.left = `${Math.max(4, Math.round(coordinates.left - rect.left))}px`
      popup.style.top = `${Math.round(coordinates.bottom - rect.top + 4)}px`
    }
    popup.style.display = 'block'
    return popup
  }

  function swatch(literal: Extract<LiteralPreview, { kind: 'color' }>): HTMLElement {
    const host = document.createElement('div')
    host.className = 'literal-preview-color'
    const chip = document.createElement('span')
    chip.className = 'literal-preview-chip'
    chip.style.background = literal.css
    const label = document.createElement('span')
    label.className = 'literal-preview-label'
    label.textContent = literal.label
    host.append(chip, label)
    return host
  }

  async function showImage(view: EditorView, literal: Extract<LiteralPreview, { kind: 'image' }>) {
    const path = resolveImagePath(literal, deps.documentPath())
    const mime = path ? imageMimeFor(path) : undefined
    const key = `${literal.path}@${mime ?? ''}`
    if (!path || !mime) { hide(); return }
    if (key !== lastKey) {
      generation++
      lastKey = key
      const current = generation
      const pending = document.createElement('div')
      pending.className = 'literal-preview-label'
      pending.textContent = '读取图片…'
      place(view, literal, pending)
      void deps.loadImage(path).then(loaded => {
        if (current !== generation || !loaded) return
        const image = document.createElement('img')
        image.className = 'literal-preview-image'
        image.alt = literal.label
        image.src = `data:${mime};base64,${loaded.base64}`
        place(view, literal, image)
      })
    }
  }

  function onMove(event: MouseEvent, view: EditorView) {
    // 预览只在桌面端可用：loadImage 在浏览器预览态直接给 null（宿主调用会抛）。这里仍显示色块。
    if (!deps.enabled() || !event.shiftKey) { hide(); return }
    const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (position === null) { hide(); return }
    const line = view.state.doc.lineAt(position)
    const literal = literalAt(line.text, position - line.from)
    if (!literal) { hide(); return }
    if (literal.kind === 'color') {
      if (lastKey === `color:${literal.css}`) return
      generation++
      lastKey = `color:${literal.css}`
      place(view, literal, swatch(literal))
      return
    }
    void showImage(view, literal)
  }

  const extension = [
    EditorView.domEventHandlers({
      mousemove: onMove,
      mouseleave: () => hide(),
      keyup: (event: KeyboardEvent) => { if (event.key === 'Shift') hide() },
      blur: () => hide(),
    }),
    EditorView.updateListener.of(update => { if (update.docChanged) hide() }),
  ]

  return { extension, hide }
}
