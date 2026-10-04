// 随处搜索的**空态文案**（上游 `SearchEverywhereEmptyTextProvider` +
// `SearchEverywhereUI.updateEmptyText`，`SearchEverywhereUI.java:1926-2011`）。
//
// 上游的逻辑分两支（`updateEmptyText`）：
//   ① 有供给者实现了 `SearchEverywhereEmptyTextProvider`（本树里只有
//      `TextSearchContributor.kt:281-300` 一个）⇒ 用它的文案；
//   ② 否则走通用分支：按"能不能重置作用域 / 能不能清过滤 / 能不能在文件里查找"
//      拼一句带链接的提示。
//
// `TextSearchContributor.updateEmptyStatus` 的原话（`:282-300`）：
//   1. `searcheverywhere.nothing.found.for.all.anywhere`（中文包 `IdeBundle.properties:2330`
//      = 「找不到任何内容」）+ 「.」+ 空行；
//   2. **只有用过搜索选项时才**再加一句 `message.nothingFound.used.options`
//      （`FindBundle.properties:67`）—— 即"你刚才开了区分大小写/全词/正则/文件掩码"，空行；
//   3. 然后逐条列出用过的选项标签（`find.popup.case.sensitive.label` / `find.whole.words.label` …）。
//
// 本仓的四处差异（如实）：
//   · 本仓的 SE 没有作用域选择器（`ScopeChooserAction` 判 `[ ]`），所以通用分支里
//     "将作用域设置为…" 那一句**不渲染** —— 它上游存在的意义是提供一个可点的重置链接；
//   · 本仓**没有**文件掩码（`fileFilter`），所以第 2 步的触发条件只剩三档开关；
//   · 「在文件中查找」那一句对应本仓的工程内搜索面板（Ctrl+Shift+F 已绑），保留；
//   · 上游是 Swing `StatusText` 的多段 append，本仓是一段结构化文本（`lines` + `links`），
//     由 `SearchEverywhereDialog.vue` 渲染成同形的几行。
import type { SearchEverywhereTab } from './searchEverywhere'

/** 文案逐条取本机随 IDE 发货的中文语言包（key 即上游 bundle key）。 */
export const SE_EMPTY_TEXT = {
  /** `IdeBundle.properties:2330` searcheverywhere.nothing.found.for.all.anywhere */
  nothingFound: '找不到任何内容',
  /** `FindBundle.properties:67` message.nothingFound.used.options */
  usedOptions: '使用的搜索选项：',
  /** 三档选项标签（`find.popup.case.sensitive.label` / `find.whole.words.label` / `find.regex.label`）。 */
  caseSensitive: '区分大小写',
  wholeWords: '单词',
  regex: '正则表达式',
  /** `IdeBundle.properties:2348-2349/1136` —— 「使用 / 或使用 … 在文件中查找」。 */
  useMain: '使用',
  findInFiles: '在文件中查找',
  /** 本仓的工程内搜索面板键位（`$default.xml:538-540` 的 FindInPath）。 */
  findInFilesShortcut: 'Ctrl Shift F',
} as const

/** 空态里用过的搜索选项（上游的 `model.isCaseSensitive/isWholeWordsOnly/isRegularExpressions`）。 */
export interface EmptySearchOptions {
  caseSensitive?: boolean
  wholeWords?: boolean
  regex?: boolean
}

/**
 * 该 tab 有没有"文本搜索"那一类供给者。上游按 `SearchEverywhereEmptyTextProvider` 的
 * **实现者**判（`SearchEverywhereUI.java:1932-1935`）—— 本树里只有 `TextSearchContributor`
 * 实现了它，而那个贡献者正是 All/Project 两档的内容来源（文字搜索 + 文件名）。
 * Commands / Run Configurations 两档没有实现者 ⇒ 走通用分支。
 */
export function tabHasTextSearch(tab: SearchEverywhereTab): boolean {
  return tab === 'all' || tab === 'project'
}

export interface EmptyText {
  /** 主行（上游的第 1 句或通用分支的第 1 句）。 */
  primary: string
  /** 「使用的搜索选项：」那一行；没开任何选项时为 null（上游就是这样：不显示）。 */
  usedOptions: string | null
  /** 可点的动作（本仓只保留真的有落点的那一条）。 */
  action: { label: string; shortcut?: string } | null
}

/**
 * 拼空态。`query` 为空时上游**不显示任何空态**（`SearchEverywhereUI.java:1929`
 * 的 `if (pattern.isEmpty()) return`）—— 所以这里返回 null，渲染层据此不画。
 */
export function searchEverywhereEmptyText(tab: SearchEverywhereTab, query: string, options: EmptySearchOptions = {}): EmptyText | null {
  if (!query.trim()) return null
  if (tabHasTextSearch(tab)) {
    // `TextSearchContributor.updateEmptyStatus`：先一句"找不到任何内容"，用过选项再补一句。
    const candidates: (string | false | undefined)[] = [options.caseSensitive && SE_EMPTY_TEXT.caseSensitive, options.wholeWords && SE_EMPTY_TEXT.wholeWords, options.regex && SE_EMPTY_TEXT.regex]
    const used = candidates.filter(Boolean) as string[]
    return {
      primary: `${SE_EMPTY_TEXT.nothingFound}。`,
      usedOptions: used.length ? `${SE_EMPTY_TEXT.usedOptions}\n${used.join(' ')}` : null,
      // 文本搜索档给一条去工程内查找的出路（上游 `showFindInFilesAction` 那一支）。
      action: { label: `${SE_EMPTY_TEXT.useMain} ${SE_EMPTY_TEXT.findInFiles}`, shortcut: SE_EMPTY_TEXT.findInFilesShortcut },
    }
  }
  // 通用分支：本仓没有作用域与过滤器，剩下的出路就是在文件里查找。
  return { primary: '', usedOptions: null, action: { label: `${SE_EMPTY_TEXT.useMain} ${SE_EMPTY_TEXT.findInFiles}`, shortcut: SE_EMPTY_TEXT.findInFilesShortcut } }
}