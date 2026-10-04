// 编辑器内查找的**纯逻辑与状态**（IDEA `EditorSearchSession` + `SearchReplaceComponent` 那一层）。
//
// 上游两件事必须分开看（这是本模块存在的第一个理由）：
//   · `FindPopupPanel` = **工程内**查找对话框，不在这一层；
//   · 编辑器里那根栏 = `SearchReplaceComponent`（`platform/lang-impl/src/com/intellij/find/SearchReplaceComponent.java`），
//     由 `EditorSearchSession` 驱动（`EditorSearchSession.java:137-157` 的 builder），
//     挂在 `editor.setHeaderComponent(...)` 上。
// 本仓早先只把 F3/Shift+F3 接到 CodeMirror 的 `findNext/findPrevious`（那两个命令在**没开查找栏**时
// 是空操作），等于「编辑器内查找」整体缺席（判决 `docs/inventory/verdict-find-diff.md` §B3）。
//
// 选项语义（逐条核过 `FindModel.kt` 与 `editorHeaderActions/`）：
//   · 大小写 `FindModel.isCaseSensitive`（`FindModel.kt:212`，正则编译时 `:540` 带 `MULTILINE`，
//     不区分大小写再补 `CASE_INSENSITIVE|UNICODE_CASE`）；
//   · 全词 `FindModel.isWholeWordsOnly`（`:114`）；
//   · 正则 `FindModel.isRegularExpressions`（`:185`）；
//   · 在所选内容中 `FindModel.isGlobal`（`:170`，**默认 true** ⇒ 只搜选区这一档默认关；
//     `ToggleFindInSelectionAction.java:26,30` 是它的开关）。
// **首次使用的默认值五档全关**（`FindSettingsBase.java:53-64` 的字段默认 false，
// `:216-222` 拷进 model；`FindPopupPanel.resetAllFilters()` `:1456-1463` 也是全清）。
//
// 本仓把「查找」的**匹配语义**做成纯函数（`buildSearchRegex` / `collectSearchMatches`），
// 这样它既被编辑器里的高亮与 F3 用，也能被离线单测直接跑 —— 不依赖 EditorView。

/** 查找选项。字段名对齐 `FindModel` 的那几个属性。 */
export interface SearchOptions {
  /** `FindModel.isCaseSensitive`。 */
  caseSensitive: boolean
  /** `FindModel.isWholeWordsOnly`。 */
  wholeWords: boolean
  /** `FindModel.isRegularExpressions`。 */
  regex: boolean
  /** `FindModel.isGlobal` 取反：只在这一段选中的文本里查找。 */
  inSelection: boolean
}

/** 五档中的四档（保留大小写属替换侧，不在查找匹配语义里）。首次使用全关。 */
export const DEFAULT_SEARCH_OPTIONS: SearchOptions = Object.freeze({
  caseSensitive: false, wholeWords: false, regex: false, inSelection: false,
})

export interface SearchMatch { from: number; to: number }

// 上游 `FindModel.kt:531-567` 的正则档：默认 `MULTILINE`，不区分大小写时再补两个 flag。
// JS 侧的 `CASE_INSENSITIVE` 没有 `UNICODE_CASE` 的对应物（`u` 是另一回事，且会让非法转义抛错），
// 所以这里如实只映射前两者 —— 判决 §E 里记着这条差异。
function regexFlags(caseSensitive: boolean): string {
  return caseSensitive ? 'm' : 'mi'
}

/**
 * 把「查找文本 + 选项」折成一个正则，找不到就返回 null。
 *
 * · 正则档：`FindModel.compileRegExp()` 的等价物；**非法表达式返回 null 而不是抛**，
 *   这样调用方可以把「正则坏了」画成输入框上的红边（上游 `PatternUtil` 报错的等价物）。
 * · 字面量档：把整个查询当字面量（转义元字符），全词再两侧加 `\b`。
 *   上游字面量路径在 `FindPopupPanel.java:1520-1533` 组装，转义规则与这里一致。
 */
export function buildSearchRegex(query: string, options: SearchOptions): RegExp | null {
  if (!query) return null
  try {
    if (options.regex) return new RegExp(query, regexFlags(options.caseSensitive) + 'g')
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const body = options.wholeWords ? `\\b${escaped}\\b` : escaped
    return new RegExp(body, regexFlags(options.caseSensitive) + 'g')
  } catch {
    return null
  }
}

/**
 * 在 `text` 里收集所有命中。`limit` 是**高亮**的上限（CodeMirror 侧的 MAX_MATCHES 同量级，
 * 上游 `LivePreview` 也只在可见区加高亮器）；不传表示不限。
 *
 * 零宽匹配（`^` / `(?=x)`）必须**手动前进一步**，否则 `exec` 会在同一个位置无限循环 ——
 * JS 的 `lastIndex` 对零宽匹配不前进，这是最容易被忽略的一处死循环。
 */
export function collectSearchMatches(text: string, query: string, options: SearchOptions, limit = Infinity): SearchMatch[] {
  const re = buildSearchRegex(query, options)
  if (!re) return []
  const out: SearchMatch[] = []
  let guard = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ from: m.index, to: m.index + m[0].length })
    if (out.length >= limit) break
    if (!m[0].length) re.lastIndex += 1
    // 病态输入（超长文档 + 回溯爆炸）不会挂死：上限由 guard 兜底。
    if (++guard > 1_000_000) break
  }
  return out
}

/**
 * 从 `from` 起找下一个命中，**走完一圈回绕**（上游 `SearchReplaceComponent` 的
 * findNext 语义：到底了回到第一个）。`backwards` 对应 F3 / Shift+F3。
 */
export function nextMatch(matches: SearchMatch[], from: number, backwards: boolean): SearchMatch | null {
  if (!matches.length) return null
  if (backwards) {
    for (let i = matches.length - 1; i >= 0; i--) if (matches[i].from < from) return matches[i]
    return matches[matches.length - 1]
  }
  for (const m of matches) if (m.from > from) return m
  return matches[0]
}

/** 「第 n / 共 m 条」——「在所选内容中搜索」时上游显示的计数文案同形（`StatusTextAction`）。 */
export function matchStatus(index: number, total: number): string {
  if (!total) return ''
  return `${index + 1}/${total}`
}