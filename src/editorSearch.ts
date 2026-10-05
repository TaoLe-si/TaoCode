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

/** 查找匹配语义的四档（保留大小写属替换侧，算法在 `src/preserveCase.ts`，不进这里）。首次使用全关。 */
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
 * `Character.isJavaIdentifierPart` 的 JS 近似：字母 / 数字 / 下划线 / `$` / 货币符号 /
 * 连接标点 / 组合记号 / 格式字符。全词判定用的是它，**不是** JS `\b`（`\b` 只认 ASCII 的 `\w`，
// 于是 `\b中文\b` 永远匹配不上）。上游换出去的那一个字符类别（Java 的 ignorable control）
// 也照列，否则 `\u0000-\u0008` 这类控制字符两侧会被误判成词边界。
 */
const IDENTIFIER_PART = /[\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}\p{Sc}\p{Cf}\u0000-\u0008\u000E-\u001B\u007F-\u009F]/u

function isIdentifierPart(ch: string | undefined): boolean {
  return ch !== undefined && ch.length > 0 && IDENTIFIER_PART.test(ch)
}

/**
 * 上游 `FindManagerBase.isWholeWord`（`FindManagerBase.java:247-276`）的逐行移植。
 *
 * 与正则 `\b` 的三处不同（都是真机看得出差别的）：
 *   · 词字符是 Java 标识符字符（含 Unicode 字母与 `$`），不是 ASCII `\w`；
 *   · 命中首字符**本身不是**标识符字符时（如找 `(`），要求"前一个字符与命中首字符不同"；
 *   · 命中末字符类似。`\\x` 形式的转义前缀会让前一个标识符字符失效（`:251-252`）。
 */
export function isWholeWordMatch(text: string, start: number, end: number): boolean {
  let isWordStart: boolean
  if (start !== 0) {
    const previous = text.charAt(start - 1)
    const previousIsIdentifier = isIdentifierPart(previous) && (start <= 1 || text.charAt(start - 2) !== '\\')
    const previousSameAsNext = previous === text.charAt(start)
    const firstIsIdentifier = isIdentifierPart(text.charAt(start))
    isWordStart = firstIsIdentifier ? !previousIsIdentifier : !previousSameAsNext
  } else {
    isWordStart = true
  }
  let isWordEnd: boolean
  if (end !== text.length) {
    const next = text.charAt(end)
    const nextIsIdentifier = isIdentifierPart(next)
    const nextSameAsPrevious = end > 0 && next === text.charAt(end - 1)
    const lastIsIdentifier = end > 0 && isIdentifierPart(text.charAt(end - 1))
    isWordEnd = lastIsIdentifier ? !nextIsIdentifier : !nextSameAsPrevious
  } else {
    isWordEnd = true
  }
  return isWordStart && isWordEnd
}

/**
 * 把「查找文本 + 选项」折成一个正则，找不到就返回 null。
 *
 * · 正则档：`FindModel.compileRegExp()` 的等价物；**非法表达式返回 null 而不是抛**，
 *   这样调用方可以把「正则坏了」画成输入框上的红边（上游 `PatternUtil` 报错的等价物）。
 * · 字面量档：把整个查询当字面量（转义元字符）。上游字面量路径在
 *   `FindPopupPanel.java:1520-1533` 组装，转义规则与这里一致。
 *
 * **全词不在这里加 `\b`**：上游对两条路径统一在 `FindManagerBase.findStringLoop`
 * （`:110-112`）里用 `isWholeWord` 逐条过滤 —— 正则档也过滤。`\b` 只认 ASCII 词字符，
 * 加在这里会让「中文」这类查询在全词档下永远找不到（见 `isWholeWordMatch`）。
 */
export function buildSearchRegex(query: string, options: SearchOptions): RegExp | null {
  if (!query) return null
  try {
    if (options.regex) return new RegExp(query, regexFlags(options.caseSensitive) + 'g')
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(escaped, regexFlags(options.caseSensitive) + 'g')
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
 *
 * 全词过滤在**收集时**做（上游 `FindManagerBase.findStringLoop` 是同一条路）：被全词拒掉的
 * 命中不占额度、也不会进 `n/m` 计数。
 */
export function collectSearchMatches(text: string, query: string, options: SearchOptions, limit = Infinity): SearchMatch[] {
  const re = buildSearchRegex(query, options)
  if (!re) return []
  const out: SearchMatch[] = []
  let guard = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const found = { from: m.index, to: m.index + m[0].length }
    if (!options.wholeWords || isWholeWordMatch(text, found.from, found.to)) {
      out.push(found)
      if (out.length >= limit) break
    }
    if (!m[0].length) re.lastIndex += 1
    // 病态输入（超长文档 + 回溯爆炸）不会挂死：上限由 guard 兜底。
    if (++guard > 1_000_000) break
  }
  return out
}

/**
 * 找出**正好从 `from` 开始**的那一个正则匹配（含捕获组），供替换侧展开 `$1`。
 *
 * 为什么不用 `collectSearchMatches` 的结果重跑：替换时命中的区间是先有的（来自
 * `matchesIn`），这里只需要那一条的组值。扫描到 `from` 之前的位置就停下，正则档
 * 大文件里也不会为了展开一次替换而把全文扫完。
 */
export function regexMatchAt(text: string, query: string, options: SearchOptions, from: number): RegExpExecArray | null {
  const re = buildSearchRegex(query, options)
  if (!re) return null
  re.lastIndex = Math.max(0, from)
  const m = re.exec(text)
  if (!m || m.index !== from) return null
  if (options.wholeWords && !isWholeWordMatch(text, m.index, m.index + m[0].length)) return null
  return m
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

// —— 状态文案（上游 `SearchReplaceComponent.getStatusText()`，取值在 `EditorSearchSession.java:404-428`）——
//
// 四条：坏正则 / 无选区 / N 个结果 / 第 n 条共 m 条。文案取随 IDE 发货的中文语言包：
//   · `FindBundle.properties:35` 的 `find.incorrect.regexp`「错误模式」；
//   · `ApplicationBundle.properties:511-515` 的 `editorsearch.matches`（`{0} 个结果`）、
//     `editorsearch.current.cursor.position`（`{0}/{1}`）、`editorsearch.noselection`（「无选区」）。
/** `find.incorrect.regexp`。 */
export const INCORRECT_REGEXP_TEXT = '错误模式'
/** `editorsearch.noselection`。 */
export const NO_SELECTION_TEXT = '无选区'

/** `editorsearch.matches` 的中文形态（单复数由 choice 处理，中文里 1 与 0 同形）。 */
export function matchesStatusText(total: number): string {
  return `${Math.max(0, Math.trunc(total))} 个结果`
}

/**
 * 栏上那段状态文案。
 *
 * 上游顺序（`EditorSearchSession.searchResultsUpdated`，`:404-428`）：先判「选了"仅在选区内"却
 * 没有选区」→ `noselection`；否则有条目时按 `cursorIndex != -1 ? 位置 : 个数`；坏正则走
 * `updateResults` 的更早一条路（`:660`）。本仓查询词为空时不摆文案（栏还没在用）。
 */
export function findStatusText(input: {
  query: string
  total: number
  /** 当前命中的下标，`-1` = 还没定位（上游 `getCursorVisualIndex()` 的等价物）。 */
  current: number
  inSelection: boolean
  hasSelection: boolean
  invalid: boolean
}): string {
  if (!input.query) return ''
  if (input.invalid) return INCORRECT_REGEXP_TEXT
  if (input.inSelection && !input.hasSelection) return NO_SELECTION_TEXT
  if (input.total <= 0) return matchesStatusText(0)
  if (input.current < 0 || input.current >= input.total) return matchesStatusText(input.total)
  return matchStatus(input.current, input.total)
}