// 从**已渲染的编辑器 DOM**里读出"每行有哪些带颜色的文本段" —— 导出到 HTML 的高亮来源。
//
// 为什么从 DOM 读，而不是从语法树重新算一遍颜色：CodeMirror 的高亮样式是 `HighlightStyle`
// 生成的类名（`ͼ1a` 这种），类名到颜色的映射只存在于**注入的 CSS** 里；想拿到"用户实际看到的颜色"，
// 要么去解析样式表，要么直接问浏览器（`getComputedStyle`）。后者同时覆盖了主题切换、语义高亮
// （LSP `semanticTokens`）与语言注入 —— 树上拿不到的那些，DOM 上都有。
//
// 代价（**如实登记在 `docs/class-parity-todo.md` 与对话框提示里**）：只有**打开着**的文件才有渲染结果。
// 目录范围里没打开的文件导出为纯文本 + 行号；IDEA 用 PSI + 编辑器高亮器对任何文件都能染色。
import type { EditorView } from '@codemirror/view'

import type { StyledLine, StyledRun } from './htmlExport.ts'

/** 相邻同样式的文本段合并成一段（不然每个字符一个 span，导出物会大得离谱）。 */
export function mergeRuns(runs: readonly StyledRun[]): StyledLine {
  const out: StyledRun[] = []
  for (const run of runs) {
    if (!run.text) continue
    const last = out[out.length - 1]
    if (last && last.color === run.color && last.fontStyle === run.fontStyle && last.fontWeight === run.fontWeight)
      last.text += run.text
    else out.push({ ...run })
  }
  return out
}

function styleOf(element: Element | null): Omit<StyledRun, 'text'> {
  if (!element) return { color: '', fontStyle: '', fontWeight: '' }
  const style = window.getComputedStyle(element)
  return { color: style.color, fontStyle: style.fontStyle, fontWeight: style.fontWeight }
}

/**
 * 读出编辑器当前渲染出来的每一行。
 *
 * `contentDOM` 里每个 `.cm-line` 是一行（CodeMirror 的虚拟渲染只渲染可视区域 + 余量 ——
 * 所以**只导出已经渲染的那部分**是必然的，这与 IDEA 一次渲染整个文件不同；`view.state.doc.lines`
 * 与实际读到的行数不一致时，调用方据此把"未渲染"如实反映出来）。
 */
export function readStyledLines(view: EditorView): StyledLine[] {
  const lines: StyledLine[] = []
  // 同一个元素上会问到很多次（每个文本节点一次），缓存一下 —— 否则 1 万行会很慢。
  const cache = new Map<Element, Omit<StyledRun, 'text'>>()
  const styleCached = (element: Element | null) => {
    if (!element) return { color: '', fontStyle: '', fontWeight: '' }
    const found = cache.get(element)
    if (found) return found
    const computed = styleOf(element)
    cache.set(element, computed)
    return computed
  }
  const walk = (node: Node, runs: StyledRun[]) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? ''
      if (text) runs.push({ text, ...styleCached(node.parentElement) })
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as Element
    if (element.tagName === 'BR') { runs.push({ text: '\n', color: '', fontStyle: '', fontWeight: '' }); return }
    if (element.classList.contains('cm-widgetBuffer') || element.classList.contains('cm-selectionBackground')) return
    for (const child of element.childNodes) walk(child, runs)
  }
  for (const element of view.contentDOM.querySelectorAll('.cm-line')) {
    const runs: StyledRun[] = []
    for (const child of element.childNodes) walk(child, runs)
    lines.push(mergeRuns(runs))
  }
  return lines
}
