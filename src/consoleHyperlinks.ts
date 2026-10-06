// 运行/构建**控制台**一行里的超链接：把「已有的文件位置链接」和「上游同一套 URL 判定」合成一张切片表。
//
// 为什么控制台需要单独这一层：上游的 URL 过滤器**不只挂在终端**，它同时是控制台的默认过滤器之一 ——
//   · `platform/execution-impl/resources/intellij.platform.execution.impl.xml:63`
//     `<consoleFilterProvider implementation="com.intellij.execution.filters.UrlFilter$UrlFilterProvider"/>`；
//     provider 本体 `platform/execution-impl/src/com/intellij/execution/filters/UrlFilter.java:152-161`
//     （`getDefaultFilters` 就返回一个 `UrlFilter(project)`）。
//   · 构建控制台还显式再挂一次：`java/compiler/impl/src/com/intellij/compiler/progress/BuildOutputService.java:131`
//     的 `.withExecutionFilter(new UrlFilter(myProject))`。
// ⇒ 控制台里打印出的 `https://…` 在上游是**可点的**，本仓以前只有 `file:line` 那一族可点
//   （`src/runHyperlinks.ts`），URL 命中是纯文本 —— 这一层补的就是这一段。
//
// 判定规则**不在这里重算**：一条行文本里的 URL / `file:` 命中与落点全部走
// `src/terminalHyperlinks.ts`（它的规则来自 `UrlFilter.java:54-79`、`:89-92`、`:94-123`，
// 上游那两个分支的取舍、百分号解码与 `/C:/x` 去前导斜杠都已经在那儿实现并判据化）。
// 文件位置那一族沿用 `src/runHyperlinks.ts` 的 `findRunHyperlinks` 结果（本文件不改它的口径，只把
// `splitRunLine` 切出的**纯文本段**再按 URL 命中切一次），所以 `file:line` 的行为一字不变。
//
// 点击语义（控制台与编辑器不同，逐条对照过）：
//   · 控制台里的链接是**左键单击**就跳，不需要 Ctrl：
//     `platform/platform-impl/src/com/intellij/execution/impl/EditorHyperlinkSupport.java:113-130`
//     的 `mouseReleased` 只问 `getButton() == BUTTON1`、非 popupTrigger、按下与抬起在同一点，
//     然后 `getLinkNavigationRunnable`（`:254-279`）取该位置的链接区间直接 navigate。
//     （终端那侧要 Ctrl/⌘+单击，是 xterm 的行为，见 `src/terminalHyperlinks.ts` 的 `terminalLinkTooltip`。）
//   · 上游**不在建表时合并重叠区间**，是点击时在 markup 的迭代顺序里取第一条
//     （`EditorHyperlinkSupport.java:305-312`），同层比较器写着「prefer more specific region」
//     （`platform/platform-impl/src/com/intellij/openapi/editor/impl/view/IterationState.java:894-897`，即更短的区间优先）。
//     本仓控制台是**切片渲染**，一格只能挂一个动作 ⇒ 这里写成一条确定性政策：
//     与文件位置区间重叠的 URL 命中丢掉。两族模式实际不相交（`src/runHyperlinks.ts` 的路径字符类不含
//     `:` 与引号括号，且命中前一个字符是 `/`、字母或数字时整条被拒），所以这条政策不改可见行为，
//     只做「结果确定」的保证 —— 不声称复刻上游的点击时择一。
//   · `file:` 命中在上游会先建成文件链接、点开后再报「找不到文件」
//     （`UrlFilter.java:186-195` 的 `Messages.showErrorDialog`），所以这里也**不预先过滤磁盘存在性**。
//
// 与架构不等价、因此**不做**的两件事（避免放假控件）：
//   · 逐浏览器那几行（「在 Chrome 中打开」…）：上游把它们列在链接的右键菜单里
//     （`platform/execution-impl/src/com/intellij/ide/browsers/OpenUrlHyperlinkInfo.java:44-67`，
//     文案 `platform/platform-api/resources/messages/IdeBundle.properties:1048` 的 `open.in.0=Open in {0}`）。
//     本仓宿主只有一条系统默认出口（`src/browsers.ts:336-348` 写明 `shell.openUrlWithBrowser` 那条通道
//     还没进 `src/bridge.ts`，请求已经在 `docs/wiring-requests-2026-10-06-welcome.md` 里挂着）
//     ⇒ 这一列渲染不出来，只保留「打开」与「复制 URL」两格能真的做事的。通道一通，这里就该跟着补行。
//   · 控制台**不解析 OSC 8**：这不是「上游有、我们没搬」，而是上游那条通道只长在终端里
//     （本参考树里带 OSC 8 字样的实现文件全在 `plugins/terminal/**` 与
//     `platform/execution-impl/src/com/intellij/terminal/Osc8UrlHyperlinkFilter.kt`，
//     `platform/lang-impl/src/com/intellij/execution/console/` 下没有任何 hyperlink 类）。
//     派单里给的 `platform/ide-impl/src/com/intellij/execution/console/ConsoleViewHyperlinkImpl`
//     在参考树里**不存在**（该目录下没有名字含 Hyperlink 的文件），已按「假路径」处理。
//
// 这一层**做**的那件右键菜单：上游只有两个类带 popup（全树 grep `HyperlinkWithPopupMenuInfo`
// 只命中 `UrlFilter.java` 与 `OpenUrlHyperlinkInfo.java`；接口
// `platform/execution-impl/src/com/intellij/execution/filters/HyperlinkWithPopupMenuInfo.java:24-27`），
// 而 `UrlFilter.java:197-200` 的 `FileUrlHyperlinkInfo.getPopupMenuGroup` 直接委派给
// `new OpenUrlHyperlinkInfo(url)` ⇒ 两类落点共用同一张表。既有那一族 `file:line`
// （`src/runHyperlinks.ts`，上游 `MultipleFilesHyperlinkInfo`）不在这一族里，所以面板只给
// URL 命中挂菜单，不动既有那一条的交互。
// 复制那一条的文案是 `IdeBundle.properties:1263` 的 `Copy URL`（说明 `:1264` = Copy URL to clipboard）；
// 原样直译成「复制 URL」「将 URL 复制到剪贴板」。
//
// 判据：`tests/console-hyperlinks.test.mjs`。

import { terminalHyperlinkRanges, terminalLinkActivatable, terminalLinkTarget, type TerminalLinkTarget } from './terminalHyperlinks.ts'
import type { RunHyperlink, RunLineSegment } from './runHyperlinks.ts'
import type { RunIssue } from './buildOutput.ts'

/** 控制台里一条 URL 命中的落点信息（切片渲染用）。 */
export interface ConsoleUrlLink {
  /** 原文里的半开区间 [start, end)，与 `src/runHyperlinks.ts` 同口径。 */
  start: number
  end: number
  /** 命中的原文（上游 `matcher.group()`，`UrlFilter.java:49`）。 */
  text: string
  /** 交给宿主 `shell.openUrl` 的地址；`issue` 非 null 时这个字段仍留着，供「复制」与 tooltip 用。 */
  href: string
  /** `file:` 命中的跳转载荷（1 基行列）；浏览器命中是 null。 */
  issue: RunIssue | null
  /** 悬停提示（控制台是单击，不写 Ctrl）。 */
  tooltip: string
}

/** 一行控制台的渲染片段：纯文本、文件位置链接、或 URL 链接三选一。 */
export interface ConsoleSegment {
  text: string
  /** 既有那一族：`src/runHyperlinks.ts` 扫出的 `path:line[:col]`。 */
  link?: RunHyperlink
  /** 本轮补的：URL / `file:` 命中。 */
  url?: ConsoleUrlLink
}

/** `terminalLinkTarget` 的 `line`/`column` 是 0 基（上游 `UrlFilter.java:106` 的 `lastValue - 1`），本仓的跳转载荷是 1 基。 */
function jumpPayload(target: Extract<TerminalLinkTarget, { kind: 'file' }>): RunIssue {
  return { path: target.path, line: (target.line ?? 0) + 1, column: (target.column ?? 0) + 1 }
}

/** 提示文案：浏览器命中说「打开」，`file:` 命中说「跳转」；两者都是单击。 */
function urlTooltip(issue: RunIssue | null, href: string): string {
  return issue ? `跳转到 ${issue.path}:${issue.line}` : `在浏览器中打开 ${href}`
}

/**
 * 一行里**控制台真能点开**的 URL 命中，按起点升序、互不重叠。
 *
 * `fileLinks` 是 `src/runHyperlinks.ts` 已经算好的文件位置链接：与它们重叠的命中丢掉（见文件头的政策）。
 * `desktop` = 宿主通道在不在（浏览器预览没有 `shell.openUrl`）：不是浏览器命中就不给。
 */
export function consoleUrlLinks(line: string, fileLinks: readonly RunHyperlink[], desktop: boolean): ConsoleUrlLink[] {
  const rows: ConsoleUrlLink[] = []
  for (const range of terminalHyperlinkRanges(line)) {
    if (fileLinks.some(link => range.start < link.end && link.start < range.end)) continue
    const target = terminalLinkTarget(range.text)
    // 浏览器命中要过终端那一层的同一扇门（协议前缀 + 宿主通道）；`file:` 命中不用 —— 控制台有 jump 通道，
    // 这正是终端面板做不到的那一条（`src/terminalHyperlinks.ts` 文件头第 4 条）。
    const issue = target.kind === 'file' ? jumpPayload(target) : null
    if (!issue && !terminalLinkActivatable(target, desktop).ok) continue
    rows.push({ start: range.start, end: range.end, text: range.text, href: target.url, issue, tooltip: urlTooltip(issue, target.url) })
  }
  return rows
}

/**
 * 整行的渲染片段：入参 `base` 是面板已经用 `splitRunLine(line, links)` 切好的**文件位置**那一族
 * （既有行为，这里不重切也不改口径），本函数只把其中的**纯文本段**再按 URL 命中切第二次。
 *
 * 没有任何 URL 命中时返回的片段与 `base` 逐字段相同（面板因此不会看到第二种排法）。
 * 两类链接的**视觉样式是同一个**：上游给控制台里所有 hyperlink 挂的都是
 * `CodeInsightColors.HYPERLINK_ATTRIBUTES`（`EditorHyperlinkSupport.java:425`），不按落点分色。
 */
export function consoleSegments(line: string, base: readonly RunLineSegment[], desktop: boolean): ConsoleSegment[] {
  const links = base.flatMap(segment => (segment.link ? [segment.link] : []))
  const urls = consoleUrlLinks(line, links, desktop)
  if (!urls.length) return base.map(segment => (segment.link ? { text: segment.text, link: segment.link } : { text: segment.text }))
  const rows: ConsoleSegment[] = []
  let cursor = 0
  for (const segment of base) {
    const from = cursor
    const to = cursor + segment.text.length
    cursor = to
    if (segment.link) { rows.push({ text: segment.text, link: segment.link }); continue }
    let local = from
    for (const url of urls) {
      if (url.end <= local || url.start >= to) continue
      const start = Math.max(url.start, local)
      const end = Math.min(url.end, to)
      if (start > local) rows.push({ text: line.slice(local, start) })
      rows.push({ text: line.slice(start, end), url: { ...url, start, end } })
      local = end
    }
    if (local < to) rows.push({ text: line.slice(local, to) })
  }
  return rows
}

/**
 * 面板的落点动作（只有两条真实出口，与 `ConsoleSegment` 的两种链接一一对应）。
 * 没有第三种：点不开的命中根本不该被渲染成链接（`consoleUrlLinks` 已经滤掉），
 * 所以这里也不给「什么都没有」这种结果放假分支。
 */
export type ConsoleLinkAction =
  | { channel: 'jump'; payload: RunIssue }
  | { channel: 'open'; payload: string }

export function consoleLinkAction(link: ConsoleUrlLink): ConsoleLinkAction {
  if (link.issue) return { channel: 'jump', payload: link.issue }
  return { channel: 'open', payload: link.href }
}

/** 右键菜单的一行（上游 `HyperlinkWithPopupMenuInfo.java:24-27` 那张 ActionGroup 的可见等价物）。 */
export interface ConsoleLinkMenuItem {
  id: 'activate' | 'copy'
  label: string
  /** 说明文字（上游每条 AnAction 都带 description，`OpenUrlHyperlinkInfo.java:49`）。 */
  description: string
}

/**
 * 一条链接的右键菜单。两格都有真实落点，没有 disabled 的假行：
 *   · `activate` 只在**浏览器**落点时出现 —— `file:` 命中点正文就已经跳了，
 *     而「用系统默认程序打开一个 file URL」不是上游那几行「在 X 中打开」的语义；
 *   · `copy` 永远出现（上游那份菜单里唯一与落点无关的就是它，`OpenUrlHyperlinkInfo.java:58-65`）。
 */
export function consoleLinkMenuItems(link: ConsoleUrlLink): ConsoleLinkMenuItem[] {
  const rows: ConsoleLinkMenuItem[] = []
  if (!link.issue) rows.push({ id: 'activate', label: '在浏览器中打开', description: link.href })
  rows.push({ id: 'copy', label: '复制 URL', description: '将 URL 复制到剪贴板' })
  return rows
}
