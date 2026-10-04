// 搜索结果预览面板的计算与文案（上游 `FindPopupPanel` 里的 `UsagePreviewPanel`）。
//
// 上游形态（逐条核过）：
//   · `FindPopupPanel.java:895` `myPreviewSplitter = new OnePixelSplitter(true, .33f)` —— 结果表与预览
//     分居两侧，比例 .33，且 `:896` 用 `setSplitterProportionKey` 记住用户拖过的位置；
//   · `:868-872` 选中变化 **50ms 去抖**后再刷新预览（`myPreviewUpdater.addRequest(updatePreviewRunnable, 50)`）；
//   · `:871` 预览体的最小高度是 15 行（`getLineHeight() * 15`）；
//   · `:369-377` 标题栏写「文件名 + 位置路径」；
//   · `UsagePreviewPanel.kt:376` 加载中显示 `showLoading()`；`:652-668` 三句状态文案：
//     `usage.preview.isnt.available`（所选条目没有预览）、`select.the.usage.to.preview`（选择要预览的项）、
//     `several.occurrences.selected`（选择了多个文件…）。
//   文案取随 IDE 发货的中文包 `UsageViewBundle.properties`（`:86` / `:106` / `:110`）。
//
// 本仓的两处如实差异（都不是"少做"，是这个形态下的等价物）：
//   1. 上游预览体是一整个**编辑器**（有语法着色、可滚动全文）。本仓的预览体是一段只读文本，
//      文件长时只渲染命中行上下的窗口（`PREVIEW_CONTEXT_LINES`），窗口外由标题栏的「行 N / 共 M」交代 ——
//      `ponytail:` 不为预览再起一个编辑器实例；文件真大时升级路径是给窗口外面补虚拟化滚动。
//   2. `several.occurrences.selected` 在本仓用不上：结果列表是**单选**（光标），不存在"跨文件多选"这个状态。
//      真出现"没有可预览的行"时用 `usage.preview.isnt.available` 那一句。

/** 命中行上下各留多少行（上游预览体高度是 15 行；本仓取 40 行一屏半，够看清上下文）。 */
export const PREVIEW_CONTEXT_LINES = 40

/** 选中变化到刷新预览的去抖毫秒（上游 `FindPopupPanel.java:871`）。 */
export const PREVIEW_DEBOUNCE_MS = 50

/** `UsageViewBundle.properties:106` 的 `tab.title.preview`。 */
export const PREVIEW_TITLE = '预览'
/** `UsageViewBundle.properties:86` 的 `select.the.usage.to.preview`。 */
export const PREVIEW_SELECT_HINT = '选择要预览的项'
/** `UsageViewBundle.properties:110` 的 `usage.preview.isnt.available`。 */
export const PREVIEW_UNAVAILABLE = '所选条目没有预览'

/** 一扇预览窗（行号 1 基、闭区间）。 */
export interface PreviewWindow {
  /** 第一行（1 基）。 */
  from: number
  /** 最后一行（1 基，含）。 */
  to: number
  /** 命中行在这扇窗里的下标（0 基）—— 渲染时给它加高亮。 */
  matchIndex: number
  /** 窗口之外还有内容吗（标题栏据此提示"还有更多"）。 */
  truncated: boolean
}

/**
 * 取命中行周围那一扇窗。文件不长（≤ 2×context+1 行）时就是全文。
 * `line` 会被夹到 `[1, totalLines]`：搜索期间文件可能被改短，越界时不该炸。
 */
export function previewWindow(totalLines: number, line: number, context: number = PREVIEW_CONTEXT_LINES): PreviewWindow {
  const total = Math.max(0, Math.trunc(totalLines))
  if (total === 0) return { from: 1, to: 0, matchIndex: 0, truncated: false }
  const hit = Math.min(Math.max(1, Math.trunc(line) || 1), total)
  const span = Math.max(0, Math.trunc(context))
  const from = Math.max(1, hit - span)
  const to = Math.min(total, hit + span)
  return { from, to, matchIndex: hit - from, truncated: from > 1 || to < total }
}

/** 预览窗里要渲染的那几行（`content` 按 `\n` 切，行尾 `\r` 去掉 —— 与搜索给的行号同一套口径）。 */
export function previewLines(content: string, window: PreviewWindow): string[] {
  if (window.to < window.from) return []
  return content.split('\n').slice(window.from - 1, window.to).map(text => (text.endsWith('\r') ? text.slice(0, -1) : text))
}

/**
 * 标题栏两段：文件名 + 「行 N / 共 M」（上游标题是"文件名 + 位置路径"，`:369-377`；
 * 本仓的路径已经在结果分组里写着，这里换成行号位置，信息不重复）。
 */
export function previewHeader(path: string, line: number, totalLines: number): { name: string; detail: string } {
  const name = path.split('/').pop() ?? path
  return { name, detail: `行 ${line} / 共 ${totalLines}` }
}
