// 插件页搜索框的「属性词建议浮层」—— 上游打 `/`（或 Ctrl+Space）弹出的那张词表/取值表。
//
// 规则全部照 `platform/platform-impl/src/com/intellij/ide/plugins/newui/SearchPopupController.java`
// 搬（行号本轮实数）：
//  · `:40-64` `handleShowPopup` —— 光标处不是词尾时不弹属性表（:45-49），光标在末尾且前一个是空格
//    也不弹（:51-54），其余情况按光标前那段决定弹「词」还是弹「取值」（:56-63）
//  · `:70-100` `parseAttributeInQuery` —— 从光标往左找 `:`：找到 = 正在输入取值（取值前缀 = 冒号后到光标，
//    :76-87），没找到 = 正在输入词名（:89-92 遇空格停，:95-97 起点是空格后一位）
//  · `:102-122` `showAttributesPopup` —— 词表 = `getAttributes()`；选中一个词后接着开它的取值表（:117-119）
//  · `:124-148` `handleShowAttributeValuesPopup` —— 取值表 = `getValues(name)`，**空集合就不弹**、
//    退回搜索面板（:125-129）；选中一个取值后走 `SearchQueryParser.wrapAttribute`（:144）
//  · `:184-210` `noPrefixSearchValues` —— 前缀为空不过滤（:185-187）；前缀与某个词**完全相等**时收起浮层
//    （:191-194）；否则按「忽略大小写的前缀」逐个留删（:196-201）；一个都不剩时退回搜索面板（:204-207）
//  · `:234-259` `appendSearchText` —— 选中项替换掉光标前那段前缀，光标后的残留原样接回去（:243-246），
//    前缀只有在「候选确实以它开头（含带引号的那种）」时才删（:251-253），最后光标落回插入段之后（:258）
//  · `:261-268` `handleEnter` / `:273-284` `handleUpDown` —— 浮层里有选中项时 Enter 交出去，
//    否则 Enter 走搜索；第一次 Down 在没有选中项时选中第 0 项
//  · 触发时机 `newui/PluginsTab.kt:118-125`（空文本 Ctrl+Space = 整张词表）、`:217-236`（打字后按文本重算）、
//    `:144-153`（Enter）、`:162-184`（Esc：先收浮层，浮层没开才清文本）
//  · 两张词表 `InstalledPluginsTab.kt:404-419` 与 `MarketplacePluginsTab.kt:378-392`；
//    取值表 `InstalledPluginsTab.kt:421-435` 与 `MarketplacePluginsTab.kt:394-408`
//  · `newui/SearchQueryParser.kt:259-262` `wrapAttribute` —— 含空格、逗号、冒号的取值要包双引号
//
// **词表按本仓有数据的那几条裁剪**，这不是自作主张：上游自己也是按数据条件往表里加的 ——
// `InstalledPluginsTab.kt:415-417` 只有 `isPluginUpdateSourceVisibleInUI()` 才放 `/updatesFrom:`，
// `MarketplacePluginsTab.kt:383-385` 只有存在自定义仓库才放 `/repository:`，`:388-390` 只有
// 有 view customizer 才放 `/internal`。本仓没有的两层：
//  · `/bundled`、`/updatedBundled` —— 宿主只有一个插件目录（`native/main.cpp:1416-1417` 的
//    `profile / L"plugins"`），`newui/PluginUiModel.kt:34` 的 `isBundled` 恒假（同一原因见
//    `src/pluginGroups.ts` 的 `SUPPORTED_SEARCH_OPTIONS` 与请求 `docs/wiring-requests-2026-10-06-plugins.md` P-3）
//  · 已安装页的 `/tag:`、`/updatesFrom:` —— 标签与更新源在 `MyPluginModel.kt:851-860` 要从
//    描述符的市场信息里算，本仓的已装插件没有这一层（同 `UNSUPPORTED_ATTRIBUTE_WORDS`）
// 上游搜索是防抖的（`InstalledPluginsTab.kt:73` 100ms、`MarketplacePluginsTab.kt:81` 250ms），
// 本仓的词表与取值都在内存里，直接算，不需要防抖。

import type { PluginInfo } from './pluginGroups.ts'
import type { MarketplacePlugin } from './pluginMarket.ts'

/** 属性词面 —— `newui/SearchWords.kt:9-16` 的枚举值，逐字照抄（大小写也是界面的一部分）。 */
export const SEARCH_WORD_VENDOR = '/vendor:'
export const SEARCH_WORD_TAG = '/tag:'
export const SEARCH_WORD_SORT_BY = '/sortBy:'

/**
 * 已安装页的词表（`InstalledPluginsTab.kt:404-419` 的顺序，去掉上面说明的两条无数据项）。
 * `/outdated` 是 `needUpdate` 的词面（`SearchQueryParser.kt:672-675` 那条特例，本仓口径在
 * `src/pluginGroups.ts` 的 `installedSearchQuery`）。
 */
export const INSTALLED_SUGGEST_WORDS = ['/userInstalled', '/outdated', '/enabled', '/disabled', '/invalid', SEARCH_WORD_VENDOR] as const

/** 市场页的词表（`MarketplacePluginsTab.kt:378-392` 的顺序，去掉无数据的 `/repository:` `/staffPicks` `/suggested` `/internal`）。 */
export const MARKETPLACE_SUGGEST_WORDS = [SEARCH_WORD_TAG, SEARCH_WORD_SORT_BY, SEARCH_WORD_VENDOR] as const

/**
 * `/sortBy:` 的取值（`MarketplacePluginsTab.kt:398-403` 列出的四条的 `query` 字段，顺序照抄）。
 * 注意上游这里**没有** `relevance` —— `MarketplaceTabSearchSortByOptions.kt:11-15` 有五个枚举项，
 * 而取值表只给四个（`InstalledPluginsTab` 那页也没有这一档）。
 */
export const MARKETPLACE_SORT_BY_VALUES = ['downloads', 'name', 'rating', 'updated'] as const

/** 光标前那一段的解析结果（`parseAttributeInQuery` 的 `Pair` + `startPosition`）。 */
export interface QueryToken {
  /** 光标前这个词的文本：到冒号为止（含冒号）或到光标为止。 */
  name: string
  /** 冒号后到光标那一段；没有冒号时是 null（= 正在输入词名，不是取值）。 */
  value: string | null
  /** 可替换段的起点（上游的 `startPosition`：有冒号是冒号后一位，没冒号是词起点）。 */
  start: number
}

/**
 * `parseAttributeInQuery`（`:70-100`）的等价实现：从 `caret - 1` 往左扫，先遇 `:` 还是先遇空格。
 * 扫描不看光标**当前**那位，所以光标停在词中间时 `name` 只是它左边那段。
 */
export function attributeTokenAtCaret(query: string, caret: number): QueryToken {
  const end = Math.max(0, Math.min(caret, query.length))
  let index = end - 1
  let value: string | null = null
  let stop = end
  let start = end
  while (index >= 0) {
    const ch = query[index]
    if (ch === ':') {
      value = query.slice(index + 1, end)
      start = index + 1
      stop = index + 1
      index--
      while (index >= 0) {
        if (query[index] === ' ') break
        index--
      }
      break
    }
    if (ch === ' ') break
    index--
  }
  if (value === null) start = index + 1
  return { name: query.slice(index + 1, stop), value, start }
}

/**
 * 这一次光标位置该不该弹属性浮层（`:45-54` 的两个早退）。
 * false = 走「搜索面板」那一支（上游 `handleShowPopupForQuery`）。上游只在文本非空时调它
 * （`PluginsTab.kt:229-233`），所以空文本由调用方另处理（见 `suggestionState`）。
 */
export function showsAttributesAtCaret(query: string, caret: number): boolean {
  const length = query.length
  if (caret < length) return query[caret] === ' '
  return caret > 0 && query[caret - 1] !== ' '
}

/** 浮层的三种归宿：词表 / 取值表 / 退回搜索面板（不弹）。 */
export type SuggestKind = 'attributes' | 'values' | 'query' | 'none'

export interface SuggestionState {
  kind: SuggestKind
  /** 已经按前缀筛过的候选（`none` 与 `query` 时为空）。 */
  words: string[]
  /** 选中后要替换掉的那段前缀（`SearchPopupCallback.prefix`）；null = 直接插在光标处。 */
  prefix: string | null
  /** `values` 时是哪个词的取值表。 */
  attribute: string
  /** 可替换段起点（诊断/测试用）。 */
  start: number
}

/**
 * `noPrefixSearchValues`（`:184-210`）：
 * 前缀空白 → 原表；命中一个**完全相等**的词 → `hide: true`（上游收起浮层并返回）；
 * 其余按忽略大小写前缀留删；筛空了 → `empty: true`（上游退回搜索面板）。
 */
export function filterWordsByPrefix(words: readonly string[], prefix: string | null): { words: string[]; hide: boolean; empty: boolean } {
  if (prefix === null || prefix.trim().length === 0) return { words: [...words], hide: false, empty: words.length === 0 }
  const needle = prefix.toLowerCase()
  const kept: string[] = []
  for (const word of words) {
    if (word === prefix) return { words: [], hide: true, empty: false }
    if (word.toLowerCase().startsWith(needle)) kept.push(word)
  }
  return { words: kept, hide: false, empty: kept.length === 0 }
}

/** 上游的 `getValues(attribute)`：给不出取值（null / 空集合）就不弹取值表（`:125-129`）。 */
export type SuggestValues = (attribute: string) => readonly string[]

/** 「没有浮层」的那个状态：组件在浮层被 Esc 收起、或本次光标位置不弹时按这个走。 */
export const NO_SUGGESTION: SuggestionState = { kind: 'none', words: [], prefix: null, attribute: '', start: 0 }

/**
 * 一次完整的建议计算 —— `handleShowPopup`（`:40-64`）加两个弹出口。
 * `blankOpensAttributes` 对应 `PluginsTab.kt:118-121`：**空文本时 Ctrl+Space** 给整张词表；
 * 正常打字时（`searchOnTheFly`，`:227-235`）空文本是「收起」而不是弹词表，所以缺省 false。
 */
export function suggestionState(query: string, caret: number, attributes: readonly string[], values: SuggestValues, blankOpensAttributes = false): SuggestionState {
  const blank = query.trim().length === 0
  if (blank) {
    if (!blankOpensAttributes) return { kind: 'none', words: [], prefix: null, attribute: '', start: 0 }
    return { kind: 'attributes', words: [...attributes], prefix: null, attribute: '', start: Math.max(0, Math.min(caret, query.length)) }
  }
  if (!showsAttributesAtCaret(query, caret)) return { kind: 'query', words: [], prefix: null, attribute: '', start: caret }
  const token = attributeTokenAtCaret(query, caret)
  if (token.value === null) {
    const filtered = filterWordsByPrefix(attributes, token.name)
    if (filtered.hide || filtered.empty) return { kind: filtered.hide ? 'none' : 'query', words: [], prefix: token.name, attribute: '', start: token.start }
    return { kind: 'attributes', words: filtered.words, prefix: token.name, attribute: '', start: token.start }
  }
  const candidates = values(token.name)
  if (candidates.length === 0) return { kind: 'query', words: [], prefix: token.value, attribute: token.name, start: token.start }
  const filtered = filterWordsByPrefix(candidates, token.value)
  if (filtered.hide || filtered.empty) return { kind: filtered.hide ? 'none' : 'query', words: [], prefix: token.value, attribute: token.name, start: token.start }
  return { kind: 'values', words: filtered.words, prefix: token.value, attribute: token.name, start: token.start }
}

/** `SearchQueryParser.wrapAttribute`（`:259-262`）：含空格、逗号、冒号的取值包双引号。 */
export function wrapAttributeValue(value: string): string {
  return /[ ,:]/.test(value) ? `"${value}"` : value
}

/**
 * `appendSearchText`（`:234-259`）：把 `value` 接到光标处，`prefix` 只有在候选确实以它开头
 * （或以 `"` + 它开头）时才先删掉；光标后的残留原样接回，插入完光标停在插入段之后。
 */
export function applySuggestion(query: string, caret: number, value: string, prefix: string | null): { text: string; caret: number } {
  const position = Math.max(0, Math.min(caret, query.length))
  const suffix = position < query.length ? query.slice(position) : ''
  const head = position < query.length ? query.slice(0, position) : query
  let text: string
  if (prefix === null) {
    text = head + value + suffix
  } else if (startsWithIgnoreCase(value, prefix) || startsWithIgnoreCase(value, `"${prefix}`)) {
    text = head.slice(0, head.length - prefix.length) + value + suffix
  } else {
    text = head + value + suffix
  }
  return { text, caret: text.length - suffix.length }
}

function startsWithIgnoreCase(text: string, prefix: string): boolean {
  return text.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase()
}

/**
 * 上下键：第一次 Down 在没有选中项时选中第 0 项（`:275-277`）；其余情况在表内移动。
 * 上游把之后的移动丢给 `JList.dispatchEvent`（`:280`），DOM 里没有那个焦点转移语义，
 * 所以本仓**钳位不回绕**（到顶停住），这是本仓选择而非上游证明。
 */
export function moveSuggestion(index: number, total: number, direction: 'up' | 'down'): number {
  if (total <= 0) return -1
  if (direction === 'down') return index < 0 ? 0 : Math.min(index + 1, total - 1)
  return index < 0 ? -1 : Math.max(index - 1, 0)
}

/** `suggestionKeyAction` 的输入：一次键击 + 当前浮层状态。 */
export interface SuggestKeyInput {
  key: string
  ctrlKey: boolean
  query: string
  caret: number
  state: SuggestionState
  index: number
}

/** `suggestionKeyAction` 的结果：组件照单执行就行（文本、光标、选中项、收起、清空）。 */
export interface SuggestKeyResult {
  text?: string
  caret: number
  index: number
  dismiss: boolean
  clear: boolean
  /** Ctrl+Space 且浮层没开：空文本也给整张词表（`PluginsTab.kt:119-121` + `:190-193`）。 */
  completesBlank: boolean
  consumed: boolean
}

/**
 * 把上游那四处按键分派合成一个可测的函数：
 *  · Ctrl+Space —— `PluginsTab.kt:118-125`，浮层已开时不再开（`:190-193` 的 `isPopupShow` 早退）
 *  · Up / Down —— `SearchUpDownPopupController.java:27-39` + `SearchPopupController.java:273-284`，
 *    浮层没开时**不拦**（那一路是把事件交给插件列表）
 *  · Enter —— `:261-268`：有选中项交给它，否则 `PluginsTab.kt:145-150` 收浮层并按当前文本搜
 *  · Esc —— `PluginsTab.kt:162-184`：先收浮层，浮层没开才清文本（文本也空时上游那个动作是 disabled 的）
 * 选中一个**取值**后上游接着走 `handleShowPopupForQuery()`（`:145`）= 收起浮层，所以 `values` 那一支 `dismiss` 为真。
 */
export function suggestionKeyAction(input: SuggestKeyInput): SuggestKeyResult {
  const total = input.state.words.length
  const base = { caret: input.caret, index: input.index, dismiss: false, clear: false, completesBlank: false, consumed: false }
  if (input.key === ' ' && input.ctrlKey) {
    return total > 0 ? base : { ...base, completesBlank: true, consumed: true }
  }
  if (input.key === 'ArrowDown' || input.key === 'ArrowUp') {
    if (!total) return base
    return { ...base, index: moveSuggestion(input.index, total, input.key === 'ArrowDown' ? 'down' : 'up'), consumed: true }
  }
  if (input.key === 'Enter') {
    if (!total || input.index < 0) return { ...base, dismiss: input.query.length > 0, consumed: true }
    const value = input.state.kind === 'values' ? wrapAttributeValue(input.state.words[input.index]) : input.state.words[input.index]
    const next = applySuggestion(input.query, input.caret, value, input.state.prefix)
    return { text: next.text, caret: next.caret, index: -1, dismiss: input.state.kind === 'values', clear: false, completesBlank: false, consumed: true }
  }
  if (input.key === 'Escape') {
    if (total) return { ...base, dismiss: true, consumed: true }
    return { ...base, clear: input.query.length > 0 }
  }
  return base
}

/**
 * 已安装页 `/vendor:` 的取值（`InstalledPluginsTab.kt:423-424` → `MyPluginModel.kt:838-849`）：
 * 厂商先 `trim`、空白丢掉、按插件数计数（`MyPluginModel.kt:1336-1345`），
 * 再进那个自定义比较器的 `TreeSet`：**插件数多的在前**，同数时按名字**忽略大小写倒序**（`:843-845`）。
 * 该比较器把「只差大小写的两个厂商」视为同一个（`:844` 用的是 `compareTo(..., ignoreCase = true)`），
 * 所以那张集合里同数同名的两种写法只留先进去的那个 —— 本仓照搬这个取舍。
 */
export function installedVendorValues(plugins: readonly PluginInfo[]): string[] {
  const counts = new Map<string, number>()
  for (const plugin of plugins) {
    const vendor = (plugin.vendor ?? '').trim()
    if (!vendor) continue
    counts.set(vendor, (counts.get(vendor) ?? 0) + 1)
  }
  const kept: string[] = []
  for (const vendor of counts.keys()) {
    // 只有「比较器返回 0」的那两种写法才会被 TreeSet 丢掉：同数 + 忽略大小写同名。
    const collapses = kept.some(item => item.toLowerCase() === vendor.toLowerCase()
      && (counts.get(item) ?? 0) === (counts.get(vendor) ?? 0))
    if (collapses) continue
    kept.push(vendor)
  }
  return kept.sort((a, b) => {
    const byCount = (counts.get(b) ?? 0) - (counts.get(a) ?? 0)
    if (byCount !== 0) return byCount
    return compareIgnoreCase(b, a)
  })
}

/**
 * 市场页 `/tag:` 的取值（`MarketplacePluginsTab.kt:397` + `:504-527`）：
 * 上游是 `HashSet` 去重（`:508`，**只去完全相同的**，`Acme` 与 `acme` 都留）后按
 * `String.CASE_INSENSITIVE_ORDER` 排（`:524`）。本仓的标签来自本地仓库清单，不是远端。
 */
export function marketplaceTagValues(entries: readonly MarketplacePlugin[]): string[] {
  const seen = new Set<string>()
  for (const entry of entries) {
    for (const tag of entry.tags ?? []) seen.add(tag)
  }
  return [...seen].sort(compareIgnoreCase)
}

/**
 * 市场页 `/vendor:` 的取值（`MarketplacePluginsTab.kt:404` + `:483-502`）：
 * `LinkedHashSet` —— 去重相同写法、**不排序**（`:487` 与 `:499`），顺序就是取数顺序。
 * 本仓的取数顺序是清单顺序（远端那一路 `getAllVendors()` 没有通道，见请求 P-4）。
 */
export function marketplaceVendorValues(entries: readonly MarketplacePlugin[]): string[] {
  const seen = new Set<string>()
  for (const entry of entries) {
    const vendor = (entry.vendor ?? '').trim()
    if (!vendor) continue
    seen.add(vendor)
  }
  return [...seen]
}

/** `String.CASE_INSENSITIVE_ORDER` 的等价比较（只差大小写时返回 0，排序稳定 ⇒ 先见的写法在前）。 */
function compareIgnoreCase(a: string, b: string): number {
  const left = a.toLowerCase()
  const right = b.toLowerCase()
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
