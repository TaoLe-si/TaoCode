// 弹层里的**主从详情面板**（上游 `com.intellij.ui.popup.util` 的
// `MasterController` + `DetailController` + `DetailView` + `ItemWrapperListRenderer`）。
//
// 上游那一族在整棵树里**只有一个真实消费者**：`BreakpointsDialog`（断点对话框）——
// `BreakpointsDialog.java` 与 `BreakpointChooser.java` 两处，其余引用都在这个包内部。
// 所以本仓不建一个没人用的通用框架，而是把它的**行为**落到同一个消费点上：
// `查看断点…`（Ctrl+Shift+F8，`ViewBreakpointsAction`）在 IDEA 里打开的就是这个对话框。
//
// 三个真实行为（都是纯函数，可单测）：
//   · `elidePath`（`DetailController.getTitle2Text`，`DetailController.java:38-49`）：
//     路径太长时**从左侧省略**（保留尾部），每次跳过一个分隔符，前缀 `...`；
//     找不到分隔符就原样返回（不再无谓地循环）。上游用 `FontMetrics` 量宽，本仓把"量宽"作为
//     参数传进来 —— 算法本身一模一样，且不依赖浏览器字体度量（那在纯逻辑里拿不到）。
//   · `detailFor`（`DetailController.doUpdateDetailViewWithItem`，`:28-36`）：**单选**才出详情，
//     多选或空选就把详情清空并把路径标签置成空（上游 `:64-72`）。
//   · `previewStateOf`（`DetailView.PreviewEditorState`，`DetailView.java:36-58`）：
//     文件 + 行（行 < 0 时没有导航位置）。
import type { DapBreakpoint } from './bridge'

/** 上游 `DetailViewImpl` 的空态文案（`IdeCoreBundle.properties:143`，中文包 :91）。 */
export const NOTHING_TO_SHOW = '没有要显示的内容'

/** 上游 `DetailController.getTitle2Text` 的 `"..." + substring(sep)` 前缀。 */
export const ELISION_PREFIX = '...'

/**
 * `DetailController.getTitle2Text`（`DetailController.java:38-49`）：
 *
 * ```
 * while (宽度 > labelWidth) {
 *   sep = fullText.indexOf(File.separatorChar, 4)   // 从第 4 个字符之后找分隔符
 *   if (sep < 0) return fullText                     // 找不到就不再省
 *   fullText = "..." + fullText.substring(sep)
 * }
 * ```
 *
 * `widthOf` 是"这段文字在标签里有多宽"（上游是 `label.getFontMetrics(label.getFont()).stringWidth`）。
 * `separator` 是路径分隔符（上游 `File.separatorChar`；本仓的路径一律 `/`）。
 * 空串返回单个空格 —— 上游那里是为了让 `JLabel` 仍然占位（`:41`）。
 */
export function elidePath(fullText: string | null | undefined, labelWidth: number, widthOf: (text: string) => number, separator = '/'): string {
  if (fullText === null || fullText === undefined || fullText === '') return ' '
  let text = fullText
  // 上限只是防死循环：每次循环要么返回、要么把文本变短（`indexOf(sep, 4)` 的起点是 4，
  // 而前缀 `...` 正好 3 个字符，所以下一次的 `indexOf(..., 4)` 不会原地不动）。
  for (let guard = 0; guard < 1000; guard++) {
    if (widthOf(text) <= labelWidth) return text
    const sep = text.indexOf(separator, 4)
    if (sep < 0) return text
    text = ELISION_PREFIX + text.slice(sep)
  }
  return text
}

/** 上游 `ItemWrapper.footerText()` 的等价物：详情面板顶部那行路径标签。 */
export interface DetailItem {
  /** 唯一键（本仓用它做列表的 key 与选中项身份）。 */
  id: string
  /** 列表主文本（上游 `ItemWrapper` 的 `setupRenderer` 写的名字）。 */
  title: string
  /** 详情面板顶部的路径（上游 `footerText()`）。 */
  path: string
  /** 详情面板正文（上游 `updateDetailView` 往 `DetailView` 里塞的东西）。 */
  body: string
  /** 有没有可预览的源码（上游 `hasEditorOnly()`）。 */
  hasSource: boolean
}

/** 上游 `DetailView.PreviewEditorState`（`DetailView.java:36-58`）。 */
export interface PreviewState {
  file: string
  /** 行号（1 基）；`null` = 只显示文件不定位（上游 `line < 0` 时 `navigate` 为 null）。 */
  line: number | null
}

export function previewStateOf(file: string, line: number): PreviewState {
  return { file, line: line < 0 ? null : line }
}

/** 上游 `PreviewEditorState.EMPTY`。 */
export const EMPTY_PREVIEW: PreviewState = { file: '', line: null }

export interface DetailPaneState {
  /** 详情面板要显示的那一项；null = 空态。 */
  item: DetailItem | null
  /** 路径标签的文字（已经过 `elidePath`）；多选/空选时是单个空格。 */
  pathLabel: string
  /** 空态文案（只有 `item === null` 时用得上）。 */
  emptyLabel: string
}

/**
 * `DetailController.doUpdateDetailView`（`:60-80`）的判据：
 * **恰好选中一项**才把它的详情放进去；否则清空编辑器与属性面板、路径标签置成空格。
 */
export function detailPaneState(items: readonly DetailItem[], selectedIds: readonly string[], labelWidth: number, widthOf: (text: string) => number): DetailPaneState {
  const selected = selectedIds.length === 1 ? items.find(item => item.id === selectedIds[0]) ?? null : null
  return {
    item: selected,
    pathLabel: selected ? elidePath(selected.path, labelWidth, widthOf) : ' ',
    emptyLabel: NOTHING_TO_SHOW,
  }
}

/**
 * 断点 → 详情项。上游 `BreakpointsDialog` 的列表项就是"文件:行"，
 * 详情里给源码那一行（`BreakpointsDialog` 用 `DetailViewImpl` 的编辑器预览）。
 * `sourceLine` 是宿主从磁盘读到的该行原文；读不到时**如实说读不到**，不编造内容。
 */
export function breakpointDetail(path: string, breakpoint: DapBreakpoint, sourceLine: string | null): DetailItem {
  const line = breakpoint.line
  const condition = breakpoint.condition?.trim()
  return {
    id: `${path}:${line}`,
    title: `${path.split('/').pop()}:${line}`,
    path: `${path}:${line}`,
    body: sourceLine === null
      ? `（读不到第 ${line} 行的内容）`
      : sourceLine,
    hasSource: sourceLine !== null,
    ...(condition ? { condition } : {}),
  } as DetailItem & { condition?: string }
}

/**
 * 全部断点折成详情项（上游 `BreakpointsDialog` 的列表 = 所有断点）。
 *
 * 排序照上游：**先按文件路径的码元序，再按行号数值**（`StringUtil.compare(..., ignoreCase=false)`
 * 那一档 + 行号是数字）。注意行号必须按**数值**比 —— 详情项的 `id`/`path` 尾部带着行号，
 * 直接拿整串做字典序会把第 10 行排到第 9 行前面（写测试时抓到的）。
 */
export function breakpointDetails(breakpoints: ReadonlyMap<string, readonly DapBreakpoint[]>, sourceOf: (path: string, line: number) => string | null): DetailItem[] {
  const rows: { item: DetailItem; file: string; line: number }[] = []
  for (const [path, list] of breakpoints) {
    for (const breakpoint of list) rows.push({ item: breakpointDetail(path, breakpoint, sourceOf(path, breakpoint.line)), file: path, line: breakpoint.line })
  }
  rows.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line))
  return rows.map(row => row.item)
}

/**
 * 供宿主直接调用的装配：断点表 + "按路径取当前缓冲区文本"取源码行。
 *
 * 放在这里而不是宿主里，有两个理由：① 那一层贴着机检上限；② "从缓冲区取第 n 行"这件事
 * 与 `DetailController` 的其余行为同属一族（都是"把选中项变成详情面板内容"）。
 *
 * `bufferOf` 返回 null 表示这个文件此刻没有打开的缓冲区 —— 那时详情如实写"读不到"，
 * **不为填详情去读盘**（打开对话框时触发一串 IO 不值当，用户要看的往往只是"我在哪几行下了断点"）。
 */
export function breakpointDetailsFromBuffers(
  breakpoints: ReadonlyMap<string, readonly DapBreakpoint[]>,
  bufferOf: (path: string) => string | null,
): DetailItem[] {
  return breakpointDetails(breakpoints, (path, line) => {
    const text = bufferOf(path)
    if (text === null) return null
    const rows = text.split(String.fromCharCode(10))
    return rows[line - 1] ?? null
  })
}
