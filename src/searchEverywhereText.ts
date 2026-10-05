// Search Everywhere 的 **Text 档**（上游 `platform/searchEverywhere/frontend/src/tabs/text/`）。
//
// 上游这一档不是"又一个小搜索框"，它就是**工程内文本搜索**换了一层皮：
//   · tab 定义：`SeTextTab.kt:52` `ID = "TextSearchContributor"`、`:54` 名字取
//     `FindBundle.message("search.everywhere.group.name")`、`:56` `PRIORITY = 250`（六档里最低，
//     所以排最右）；`canBeShownInFindResults() = true`（`:35`）。
//   · 它的筛选器带的是 **FindModel 的三个开关**：`SeTextTab.kt:38-42`
//     `SeTextSearchOptions(findModel.isCaseSensitive, findModel.isWholeWordsOnly, findModel.isRegularExpressions)`，
//     数据结构就是那三个布尔（`shared/src/SeTextSearchOptions.kt:9`）。
//     也就是说：在 SE 里勾"区分大小写"和打开「在文件中查找」勾的是**同一份模型**，
//     两边会互相带走 —— 本仓同样共享一份（`src/editorSearch.ts` 的查找选项是另一个模型，
//     这里只与「全局搜索」面板共用本模块的存档，不冒充跨面板同步）。
//   · `canBeShownInFindResults() = true`（`:35`）意味着这一档的结果可以并进
//     「在文件中查找」的用法视图；本仓没有用法视图，落点是**点结果 → 打开编辑器到那一行**，
//     与全局搜索面板的行为一致。
//
// 本仓的承接：宿主 `native/search.cpp` 的 `search.run`（正则/字面两档、include/exclude、
// 截断与取消都在宿主侧），这里只负责
//   ① 三个开关的模型与存档，
//   ② 把宿主回的一条命中变成 SE 的一条候选（标题/副标题/打开动作的字段映射），
//   ③ 一条门槛：查询词不到长度不发请求（上游 Text 档在空查询时列"最近文件"，
//      本仓没有"最近命中的文本"这种表，所以空查询直接不给候选 —— 不拿全库扫一遍凑数）。

import type { SearchMatch, SearchOptions } from './bridge.ts'

/** Text 档的 tab id（`SeTextTab.kt:52`）。 */
export const SE_TEXT_TAB_ID = 'text'
/** Text 档的 tab 名（英文键 `FindBundle."search.everywhere.group.name"`；本仓面板上这一档叫「在文件中查找」，与全局搜索面板同一说法）。 */
export const SE_TEXT_TAB_NAME = 'Text'
/** `SeTextTab.kt:56`。 */
export const SE_TEXT_TAB_PRIORITY = 250
/** 最少几个字符才发一次全库扫描（宿主扫的是整个工作区，一个字扫全库既慢又全是噪音）。 */
export const SE_TEXT_MIN_QUERY = 3
/** 一次最多列几条文本命中（SE 列表是键盘导航的，铺几百条没有意义）。 */
export const SE_TEXT_LIMIT = 50

/** `SeTextSearchOptions(isCaseSensitive, isWholeWordsOnly, isRegex)`（`SeTextSearchOptions.kt:9`）。 */
export interface TextSearchOptions {
  caseSensitive: boolean
  wholeWords: boolean
  regex: boolean
}

export const DEFAULT_TEXT_OPTIONS: TextSearchOptions = { caseSensitive: false, wholeWords: false, regex: false }

const OPTIONS_KEY = 'taocode.searchEverywhere.text.options'

/** 读回三个开关（缺键/坏值都回落默认档，不因为存过别的形状就当损坏）。 */
export function loadTextOptions(): TextSearchOptions {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(OPTIONS_KEY)
    if (!raw) return { ...DEFAULT_TEXT_OPTIONS }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_TEXT_OPTIONS }
    const entry = parsed as Record<string, unknown>
    return {
      caseSensitive: entry.caseSensitive === true,
      wholeWords: entry.wholeWords === true,
      regex: entry.regex === true,
    }
  } catch {
    return { ...DEFAULT_TEXT_OPTIONS }
  }
}

export function saveTextOptions(options: TextSearchOptions): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(OPTIONS_KEY, JSON.stringify(options))
  } catch { /* 存不下只是下次打开回到默认档。 */ }
}

/** 查询词够不够长发一次扫描。 */
export function textQueryAllowed(query: string, min = SE_TEXT_MIN_QUERY): boolean {
  return query.trim().length >= min
}

/**
 * 三个开关 → 宿主 `search.run` 的入参。
 *
 * `include`/`exclude` 沿用调用方给的文件掩码（SE 没有那两个输入框，给空串 = 全工作区）；
 * 宿主侧的 `parse_patterns` 自己会切（`native/search.cpp:370-382`）。
 */
export function textSearchParams(query: string, options: TextSearchOptions, masks: { include?: string; exclude?: string } = {}): SearchOptions {
  return {
    query: query.trim(),
    regex: options.regex,
    caseSensitive: options.caseSensitive,
    wholeWord: options.wholeWords,
    include: masks.include ?? '',
    exclude: masks.exclude ?? '',
  }
}

/** 一条宿主命中 → SE 候选要的几个字段（纯映射，不碰宿主）。 */
export interface TextHitView {
  id: string
  title: string
  subtitle: string
  path: string
  line: number
  column: number
  /** 命中前后各留多少字符：列表行只放得下一小截。 */
  preview: string
  /** 命中段在 `title` 里的区间（宿主给的 column+length 换算，画高亮用）。 */
  fragments: [number, number][]
}

/** 列表行的可视窗口：以命中为中心前后各 40 个码点（宿主给的是整行，可能很长）。 */
const HIT_WINDOW = 40

/**
 * 窗口的位置与文本（`clipHit` 与 `textHitFragments` 必须算出同一个窗口，否则高亮会串位）。
 *
 * 宿主给的是**码点**坐标（`native/search.cpp:408-410`：`column` = 行首到命中的码点数 + 1，
 * `length` = 命中段自身的码点数），本仓全部按 JS 字符串下标走 —— UTF-16 里非 BMP 字符会差一位，
 * 那是宿主与前端之间既有的口径差（`searchPreview` 那一条链同样如此），不在这里另起一套。
 */
function hitWindow(line: string, column: number): { text: string; from: number; leading: number; inner: number } {
  const from = Math.max(0, column - 1 - HIT_WINDOW)
  const raw = line.slice(from, from + HIT_WINDOW * 2)
  const trimmed = raw.trim()
  const leading = raw.length - raw.trimStart().length
  return { text: `${from > 0 ? '…' : ''}${trimmed}`, from, leading, inner: trimmed.length }
}

export function clipHit(line: string, column: number): string {
  return hitWindow(line, column).text
}

/**
 * 命中段在**列表行文本**里的 [start, end) 区间（上游文本搜索给命中高亮：
 * `model/search/impl/textSearch.kt` 一族把 `MyRange` 随命中一起交出去）。
 *
 * 判据是宿主真实给的 `column` + `length`（`native/search.cpp:531-532`），不是"整行都算命中"。
 * 换算要跟着 `clipHit` 的两处裁剪走：行首的空白被 `trim` 掉了（`leading`）、
 * 窗口左沿切掉了命中的一部分、右沿越出窗口时区间夹到窗口内 ——
 * 画出来永远是行内真实存在的那几个字符。
 */
export function textHitFragments(line: string, column: number, length: number): [number, number][] {
  if (length <= 0) return []
  const window = hitWindow(line, column)
  const start = window.text.length - window.inner  // 有省略号时是 1，没有就是 0
  const at = (absolute: number) => absolute - window.from - window.leading + start
  const first = Math.max(at(column - 1), start)
  const last = Math.min(at(column - 1 + length), start + window.inner)
  if (last <= first) return []
  return [[first, last]]
}

/**
 * 把宿主返回的命中映射成候选行。
 *
 * `baseName` 由调用方给（本仓文件名一律走宿主给的那条路径切分，不在这里再实现一套）。
 * 去重按「文件 + 行 + 列」——同一处被两个分块送到过一次时列表不能出现两行。
 */
export function textHitViews(
  matches: readonly SearchMatch[],
  baseName: (path: string) => string,
  limit = SE_TEXT_LIMIT,
): TextHitView[] {
  const seen = new Set<string>()
  const out: TextHitView[] = []
  for (const match of matches) {
    const id = `${match.path}:${match.line}:${match.column}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      title: clipHit(match.preview, match.column),
      subtitle: `${baseName(match.path)}:${match.line}:${match.column}`,
      path: match.path,
      line: match.line,
      column: match.column,
      preview: match.preview,
      fragments: textHitFragments(match.preview, match.column, match.length),
    })
    if (out.length >= limit) break
  }
  return out
}

/** 三个开关的中文标题（面板上那三个小按钮的 title 用这里，别在模板里散着写）。 */
export const TEXT_OPTION_LABELS: Record<keyof TextSearchOptions, string> = {
  caseSensitive: '区分大小写',
  wholeWords: '全词匹配',
  regex: '正则表达式',
}
