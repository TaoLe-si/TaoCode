// 工具窗口列表的**速度搜索**（IDEA `SpeedSearch`）。纯逻辑，无 DOM。
//
// 上游三块，缺一不可：
//   1) 动作 `SpeedSearchAction`（`platform/platform-impl/src/com/intellij/ide/actions/speedSearch/SpeedSearchAction.kt`）：
//      `update` 里 **`isVisible = 有 handler`**、`isEnabled = 有 handler && 可用 && 未激活`（`:29-37`），
//      所以列表不在场时这一行根本不该出现（本仓据此决定 Ctrl+F 走谁）。
//   2) 键位：`use-shortcut-of="Find"`（`platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:157-160`）
//      ⇒ 与 Find in Path **同一个 Ctrl+F**。两者同时可触发时靠 `SpeedSearchActionPromoter`
//      （`.../speedSearch/SpeedSearchActionPromoter.kt:9-11`，`sortedBy { it is SpeedSearchAction }`）
//      把速度搜索排在前面 —— 也就是**焦点在列表上时 Ctrl+F 归速度搜索**，在编辑器里才归 Find in Path。
//   3) 匹配与键盘：`SpeedSearchBase.java` —— 用 `MinusculeMatcher`（驼峰子串，见下）判定命中；
//      键盘归属 `:958-1002`：Enter/PageUp/PageDown/左右键**交给列表**（非 sticky 时先收起搜索框）、
//      Esc 隐藏搜索框、Backspace 在空串时**吞掉**（不把焦点弹出去）、上下键永远归列表。
//
// 命中后是**选中那一行**（`SpeedSearchBase.java:679` `selectElement(findElement(query)…)`），
// 不是把不匹配的行藏起来 —— 树侧装的是 `TreeSpeedSearch`
// （`platform/platform-impl/src/com/intellij/ui/TreeSpeedSearch.java:204`，项目视图在
// `platform/lang-impl/src/com/intellij/ide/projectView/impl/AbstractProjectViewPaneWithAsyncSupport.java:177` 装它），
// `selectElement` 还会把折叠的祖先**展开**再选中。本仓树是扁平化的可见行列表，所以"展开"落在 `reveal` 回调上。

/**
 * `MinusculeMatcher` 的判定（`platform/util/text-matching/src/com/intellij/psi/codeStyle/MinusculeMatcherImpl.kt`）：
 * 大小写不敏感的子序列，但**大写字母要落在词首**（`seemsLikeFragmentStart:301-314` 引的
 * `isWordStart` 在 `platform/util/base/src/com/intellij/util/text/NameUtilCore.kt:95-117`），
 * 换句话说 `abc` 命中 `aBc`/`Abc`/`abc`，`aB` 命中 `aB`/`aBC` 却**不**命中 `abC`。
 * `*` 与**空格**都是通配（`:458`）：`SpeedSearchComparator` 默认 `shouldMatchFromTheBeginning = false`
 * （`platform/platform-impl/src/com/intellij/ui/SpeedSearchComparator.java:30-32`），
 * 也就是 pattern 前面自动补一个 `*`（`:59-61`）—— 于是"从中间开始匹配"是默认行为。
 *
 * 本函数只是那四条里的**第③条**（词首）。②"文本这一格自己是大写"与④"pattern 不混大小写"
 * 两条豁免在 `matchesFrom` 里按原文一起判，别只看这里（2026-10-06 ssmatch 补）。
 * 上游另有两个分支本仓**取不到**：数字恒算词首（`:106`）、表意文字每字一词（`:112-114`）——
 * 调用点只在"pattern 那格是大写 ASCII"时才查这里，数字与汉字都不可能是那个字符。
 */
export function isWordStartAt(text: string, index: number): boolean {
  if (index <= 0) return true
  const previous = text[index - 1]!
  const current = text[index]!
  if (!/[A-Za-z0-9]/.test(previous)) return true
  return /[A-Z]/.test(current) && /[a-z0-9]/.test(previous)
}

/**
 * `MinusculeMatcher.match(name)`（`:112-125`）：命中返回 true。空 pattern 命中一切（`SpeedSearchBase` 的空串语义）。
 *
 * `hardSeparators` 是上游那条**分隔符感知**（`MinusculeMatcherImpl.kt:286-299` 的 `checkForSpecialChars`，
 * 由 `SpeedSearch.java:161-165` / `SpeedSearchComparator.java:67-68` 的 `.withSeparators(...)` 传进来）：
 * pattern 自己不带分隔符、又不是大小写混杂时，两个 hump **之间**不许跨过 `hardSeparators` 里的字符。
 * 默认空串 = 这一档不生效，正是树/表侧那一份比较器的默认值
 * （`SpeedSearchBase.java:126` `new SpeedSearchComparator(false)` → `SpeedSearchComparator.java:34-36` 的
 * 三参重载把 `hardSeparators` 落成 `""`）。
 *
 * 同一个函数里还有**第二条**、与本参数无关的档（点号，`:293-297`）：pattern 里出现过 `.` 之后，
 * 两个 hump 之间不许再跨过一个 `.`（除非 pattern 自己连着点了两个点）。这一档在
 * `hardSeparators = ''` 的树/表/符号站点**同样生效**，所以不传分隔符集时的判定并不等于"什么都不拦"。
 */
export function speedSearchMatches(pattern: string, text: string, hardSeparators = ''): boolean {
  const query = pattern.trim()
  if (!query) return true
  if (query === '*') return true
  const profile = patternSeparatorProfile(query)
  const gate = hardSeparators.length > 0 && !profile.appliesExemption
  // 上游 `checkForSpecialChars`（`MinusculeMatcherImpl.kt:286-299`）在一个位置里查**两条**，
  // 两条彼此独立：硬分隔符集那一条要 `!hasSeparators && !mixedCase`，点号那一条只看 pattern 里有没有 `.`
  // （`myHasDots`，`:51-52`/`:62-64`/`:84`）—— 所以树/表那种"分隔符集为空"的站点**也**受点号这一档管。
  return matchesFrom(query, 0, text, 0, {
    hardSeparators: gate ? hardSeparators : null,
    hasDots: query.includes('.'),
    mixedCase: profile.mixedCase,
  })
}

/** `checkForSpecialChars` 那一档要用的两条独立判据（见 `speedSearchMatches` 的注释）。 */
type SeparatorGate = { hardSeparators: string | null; hasDots: boolean; mixedCase: boolean }

/**
 * 子序列匹配 + 那两处上游约束，**带回溯**：`matchSkippingWords:239-271` 把当前 pattern 字符的
 * **每一个**候选位点逐个试（`:247` 的 `while (nameIndex >= 0)` + `:267` 取下一个候选），
 * 剩下的那段递归下去（`:262-265`）。只取第一个候选的贪心写法会在 `a b ab` 这类文本上
 * 漏掉第二个合法的 `a` —— 上游那边是 `matchWildcards` 一路枚举，不会漏。
 */
function matchesFrom(query: string, queryIndex: number, text: string, from: number, gate: SeparatorGate): boolean {
  let cursor = from
  // 有没有"上一个已命中的 hump"看的是**进这一层时**的位置：`from > 0` 就是上一层已经吃掉至少一格。
  const hasPrevious = from > 0
  for (let index = queryIndex; index < query.length; index++) {
    const character = query[index]!
    // 上游的通配是**空格与 `*` 两个**（`MinusculeMatcherImpl.kt:458` `isWildcard(pc) = pc == ' ' || pc == '*'`，
    // `:178-180` 的文档注释写得更直白："After a wildcard (* **or space**)"）。
    // 所以 pattern 里打一个空格 = 打了一个 `*`，不是"要求文本里真有一个空格"；
    // Jewel 那一份移植同一条（`PatternSpeedSearchMatcher.kt:360-364`）。
    // 串尾那一个空格的特殊档（`isTrailingSpacePattern`，`:202-215`）本仓够不到：
    // 入口先 `trim()`，见 §「退格的两档」下方的注。
    if (character === '*' || character === ' ') continue
    // 上游这两条检查**只走 `findLongestMatchingPrefix:384-387` 那一支**（`checkForSpecialChars` 之后
    // 才 `matchSkippingWords(…, allowSpecialChars = false)`）；两个 hump 之间只要隔着一个 pattern 通配
    // （`*` 或空格），走的是 `matchWildcards:216-224` 那一支 —— `allowSpecialChars = true`，
    // **两条检查整段跳过**。所以 `a*b` 能跨过硬分隔符，`ab` 不能（`*` 在 `PUNCTUATION_MARKS` 里，是打得进的）。
    const checksApply = hasPrevious && index > 0 && query[index - 1] !== '*' && query[index - 1] !== ' '
    for (let at = cursor; at < text.length; at++) {
      if (text[at]!.toLowerCase() !== character.toLowerCase()) continue
      // 大写字母的落点按上游 `seemsLikeFragmentStart:301-314` 的**四条**判，任一成立即放行：
      // ① pattern 那格不是大写（本 if 直接不进）；② **文本这一格自己是大写**（`"CU"` 撞 `"CurrentUser"` 的 'U'）；
      // ③ 词首（`NameUtilCore.kt:95-117` 的 isWordStart，本仓的 `isWordStartAt`）；
      // ④ pattern **不混大小写**且忽略大小写（`myMatchingMode != MATCH_CASE` —— 速度搜索两处站点都是
      //    `MatchingMode.IGNORE_CASE`：`SpeedSearch.java:160`、`SpeedSearchComparator.java:67-68` 走 buildMatcher 的默认）：
      //    原文注释 `:308` 是 "accept uppercase matching lowercase if the whole prefix is uppercase"。
      // 四条**全假**才换下一个候选。（`text[at] === character` 就是②：上面那一行已经保证两者只差大小写，
      //  所以"文本这一格自己是大写"与"文本这一格等于 pattern 的那个大写"在这里同值。）
      if (/[A-Z]/.test(character) && text[at] !== character && !isWordStartAt(text, at) && gate.mixedCase) continue
      // 上一格与这一格**之间**夹着硬分隔符 ⇒ 换下一个候选（`:286-292` + `:386-387`：查的是
      // `[上一个命中 + 1, 候选)`；且**只在第一个 hump 之后**才查 —— 前导那个 `*` 走
      // `matchWildcards:220-225` 的 `allowSpecialChars = true`，头一个字符之前有多少分隔符都不管）。
      if (gate.hardSeparators !== null && checksApply && indexOfAnySeparator(text, gate.hardSeparators, cursor, at) >= 0) continue
      // 点号那一条（`:293-297`，与硬分隔符集无关）："if the user has typed a dot, don't skip other dots
      // between humps, but one pattern dot may match several name dots" —— pattern 里有过 `.` 之后，
      // 两个命中**之间**再多出一个 `.` 就否掉这一个候选，**除非** pattern 的上一个字符自己就是 `.`
      // （那一个 pattern 点正在吃连续的 name 点）。
      if (gate.hasDots && checksApply && query[index - 1] !== '.' && indexOfAnySeparator(text, '.', cursor, at) >= 0) continue
      if (matchesFrom(query, index + 1, text, at + 1, gate)) return true
      // 这个候选后面那段没接上：下一个候选只能从它**之后**起。
      cursor = at + 1
    }
    // 所有候选都没接上剩下那段 ⇒ 整串不命中（`matchSkippingWords:270` 那一头的 `return null`）。
    return false
  }
  return true
}

/**
 * pattern 自己的两档属性（`MinusculeMatcherImpl.kt:46-89`）：
 * - `hasSeparators`（`:52`/`:73-75`/`:86`）：第一个有效字符**之后**还出现过 `isWordSeparator(c)`
 *   （`:505-507` = 空白 或 `_ - : + .`）—— 用户自己打了分隔符，就允许跨分隔符；
 * - `mixedCase`（`:85` = `seenLowerCase && seenUpperCaseNotImmediatelyAfterWildcard`）：
 *   既有小写又有"不是紧跟在通配后面的大写"（`:50`/`:65-67`）—— 驼峰明确的 pattern 也不受这一档管。
 * 通配 = 空格与 `*`（`:458`）。两条都不成立时 `checkForSpecialChars` 那一档才生效。
 *
 * 两个细节按上游（2026-10-06 ssmatch 补）：
 * 1) **头一个大写字母不计入 mixedCase**。上游是靠那颗前导 `*` 做到的
 *    （`SpeedSearch.java:159` 拼、`SpeedSearchComparator.java:59-61` 补；`:65-67` 的
 *    `if (seenNonWildcard && isUpperCase)` 于是被那颗 `*` 挡住第一格）；
 *    本仓把同一个语义落成**语句顺序**："先按上一格的 `seenNonWildcard` 判大写，再为这一格置位"。
 *    两条路逐字等价（§4 的 I2 反向验过：再补一颗 `*` 不改变任何判定，所以不留那一份多余代码）。
 *    效果：`Ab` → mixedCase=false（'A' 是第一格，不算"通配之后的大写"）；`aB` → mixedCase=true（'B' 前面已经有 'a'）。
 * 2) `isWordSeparator` 的集合里**没有** `/` 与 `$`（`:505-507` 只有空白 `_ - : + .`）：
 *    这两个字符打进 pattern 里既不算"用户自己跨了分隔符"（不豁免），也不是词首边界；
 *    它们在匹配时按"非标点字母"处理 —— `indexOfWordStart:464-477` 的 `isSpecialSymbol` 分支
 *    允许它们落在**任意**位置（不要求词首），所以 `com/Foo` 里那个 `/` 就是照抄文本。
 */
export function patternSeparatorProfile(pattern: string): { hasSeparators: boolean; mixedCase: boolean; appliesExemption: boolean } {
  let seenNonWildcard = false
  let seenLowerCase = false
  let seenUpperCaseNotImmediatelyAfterWildcard = false
  let hasSeparators = false
  for (const character of pattern) {
    const wildcard = character === ' ' || character === '*'
    // 判大写用的是**进这一格之前**的 seenNonWildcard（`:65-67`），置位排在它后面（`:68-72`）。
    if (seenNonWildcard && /[A-Z]/.test(character)) seenUpperCaseNotImmediatelyAfterWildcard = true
    if (!wildcard) seenNonWildcard = true
    if (seenNonWildcard && /[\s_\-:+.]/.test(character)) hasSeparators = true
    if (/[a-z]/.test(character)) seenLowerCase = true
  }
  return { hasSeparators, mixedCase: seenLowerCase && seenUpperCaseNotImmediatelyAfterWildcard, appliesExemption: hasSeparators || (seenLowerCase && seenUpperCaseNotImmediatelyAfterWildcard) }
}

/** `[start, end)` 里第一个出现在 `separators` 中的字符下标；没有则 -1（上游的 `indexOfAny(name, seps, start, end)`）。 */
function indexOfAnySeparator(text: string, separators: string, start: number, end: number): number {
  for (let index = start; index < end; index++) if (separators.includes(text[index]!)) return index
  return -1
}

/**
 * 上游各站点的**硬分隔符集**（每条都开过原文核过）：
 * - popup 侧（`SpeedSearch.java:161-165`）传 `SpeedSearchUtil.getDefaultHardSeparators()`，
 *   定义在 `platform/platform-api/src/com/intellij/ui/speedSearch/SpeedSearchUtil.java:31-33`，
 *   值是一个 U+001F（unit separator）。**订正 2026-10-06（ssmatch）**：这里旧判词写的是"全树没有
 *   任何标签用它拼接"，与磁盘不符 —— `platform/lang-impl/src/com/intellij/ide/scratch/LRUPopupBuilder.java:233-237`
 *   的 `getIndexedString` 正是 `super.getIndexedString(value) + getDefaultHardSeparators() + extra`，
 *   即"标签 + U+001F + 附加段"。这一档拦的是**别让 pattern 从前一段文本跨到后一段**，
 *   与本仓的标签拼接方式（各面板把容器名并进 label 时用的是 `' '`/`': '`）不同一码位，
 *   所以仍然只在结构弹层那一站（真的有 `' ()'`）落 `SPEED_SEARCH_STRUCTURE_SEPARATORS`，不把 U+001F 造出来。
 * - 树/表侧默认空集：`SpeedSearchBase.java:126` 的 `new SpeedSearchComparator(false)` 走
 *   `SpeedSearchComparator.java:34-36` 的三参重载，第三参落成 `""`。
 * - 结构弹层那一站显式传空格与两种括号：
 *   `platform/structure-view-impl/src/com/intellij/ide/util/FileStructurePopup.java:318`
 *   `new SpeedSearchComparator(false, true, " ()")`（另有 Kotlin  twin `platform/structure-view-impl/frontend/src/FileStructurePopup.kt:227`）。
 *   符号名与容器名里真的有空格和括号，所以**硬分隔符集这一档**吃得出效果的消费方只有 `src/symbolSearch.ts`。
 *   但同一个 `checkForSpecialChars` 里的**点号那一档与分隔符集无关**（`:293-297`），
 *   所以它在全仓每一个速度搜索站点都生效（文件树、书签、日志、Select In、Registry 表……）。
 */
export const SPEED_SEARCH_STRUCTURE_SEPARATORS = ' ()'

/**
 * 一圈遍历的唯一真源：从 `from` 起按 `delta` 走满 `count` 格（回绕），返回第一个 `matches` 为真的下标。
 * `skipFirst` = "先迈一步再判"（`findNextElement:476-499` 那一档：光标已经停在命中行上时，
 * 再按 ↓ 要去**下一条**而不是原地不动）。`from < 0`（还没有当前项）时按方向从端点起步。
 *
 * 上游这一圈不是各列表各写一遍：`SpeedSearchBase.java:476-516`（findNext/findPrevious）与
 * `:519-537`（findElement）、`:539-553`（findFirst/findLast）用的是同一张迭代器
 * （`getElementIterator(startingViewIndex)`，`MyListIterator` 走完就 `hasNext()` 为假，
 * 只有 `UISettings.getCycleScrolling()` 为真时才再绕一圈 —— `:488-496`/`:508-513`）。
 */
export function speedSearchWalk(count: number, from: number, delta: 1 | -1, matches: (index: number) => boolean, skipFirst = false): number {
  if (count <= 0) return -1
  const start = from < 0 ? (delta > 0 ? 0 : count - 1) : (((from + (skipFirst ? delta : 0)) % count) + count) % count
  for (let step = 0; step < count; step++) {
    const index = (((start + delta * step) % count) + count) % count
    if (matches(index)) return index
  }
  return -1
}

/** 把"按 pattern 命不命中这一行"包成 `speedSearchWalk` 要的谓词（标签表版，分隔符透传给 `speedSearchMatches`）。 */
function labelMatcher(labels: readonly string[], pattern: string, hardSeparators: string): (index: number) => boolean {
  const query = pattern.trim()
  return index => speedSearchMatches(query, labels[index]!, hardSeparators)
}

/** 在一列文本里找**第一条**命中的下标；没有则 -1（`SpeedSearchBase.findElement`，`:519`）。 */
export function firstSpeedSearchHit(labels: readonly string[], pattern: string, hardSeparators = ''): number {
  if (!pattern.trim()) return -1
  return speedSearchWalk(labels.length, -1, 1, labelMatcher(labels, pattern, hardSeparators))
}

/** `SpeedSearchBase.findFirstElement`（`:696-706` 的 Home/End 分支）：从头/从尾起找第一条命中。 */
export function lastSpeedSearchHit(labels: readonly string[], pattern: string, hardSeparators = ''): number {
  if (!pattern.trim()) return -1
  return speedSearchWalk(labels.length, -1, -1, labelMatcher(labels, pattern, hardSeparators))
}

/**
 * 从当前行继续找下一条命中，**先迈一步再找、走完一圈回绕**（`SpeedSearchBase.findNextElement`，
 * `:476-516`）。`from < 0`（还没有当前项）时从列表头/尾起步。
 * 只有当前这一条命中时，绕完一圈仍会回到它 —— 这与上游"找不着就停在原地"的表现一致。
 */
export function nextSpeedSearchHit(labels: readonly string[], pattern: string, from: number, delta: 1 | -1, hardSeparators = ''): number {
  if (!pattern.trim()) return -1
  return speedSearchWalk(labels.length, from, delta, labelMatcher(labels, pattern, hardSeparators), true)
}

/**
 * `SpeedSearchBase.findElement:519-537` —— **打字**（不是方向键）之后定位命中的那一行。
 * 与 `nextSpeedSearchHit` 的差别只有一个：它**把当前选中行也算进候选**（`:524-527` 的
 * `getElementIterator(selectedIndex)` + 第一次 `it.next()` 给的就是选中行本身），
 * 所以在一行能匹配、下一行不能匹配的列表里打字不会把高亮甩走；
 * 走完一圈再从 0 回到 selectedIndex（`:528-532`，`selectedIndex > 0` 时才补这一段）。
 * 没有当前项（`from < 0`）时上游把 selectedIndex 当 0（`:520-523`）。
 */
export function speedSearchElement(labels: readonly string[], pattern: string, from: number, hardSeparators = ''): number {
  if (!pattern.trim()) return -1
  return speedSearchWalk(labels.length, from, 1, labelMatcher(labels, pattern, hardSeparators))
}

/**
 * `SpeedSearchBase.java:958-1002` + `:683-706` —— 按键归谁。
 * - 上下键/Home/End：**搜索框自己处理**（`:684-691`），在命中项之间移动（Home/End = 第一条/最后一条）。
 * - Enter / PageUp / PageDown / 左右键：把搜索框收起来、焦点交回列表（`:964-975`）。
 * - Esc：只隐藏搜索框（`:976-980`）。
 * - 空串上的退格：吞掉，不让焦点从搜索框弹回列表（`:960-963`）。
 */
export type SpeedSearchKeyAction = 'navigate' | 'hide' | 'accept' | 'ignore'

export function speedSearchKeyAction(key: string, query: string): SpeedSearchKeyAction {
  if (key === 'Escape') return 'hide'
  if (key === 'Enter' || key === 'PageUp' || key === 'PageDown' || key === 'ArrowLeft' || key === 'ArrowRight') return 'accept'
  if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'Home' || key === 'End') return 'navigate'
  // 空串上的退格要吞掉：不然焦点会从搜索框弹回列表（`:960-963`）。
  if (key === 'Backspace' && !query) return 'ignore'
  return 'ignore'
}

/** `findTargetElement`（`:695-706`）—— 上下/Home/End 各自要去的位置。 */
export type SpeedSearchStep = { kind: 'next' } | { kind: 'previous' } | { kind: 'first' } | { kind: 'last' }

export function speedSearchStepForKey(key: string): SpeedSearchStep | null {
  if (key === 'ArrowDown') return { kind: 'next' }
  if (key === 'ArrowUp') return { kind: 'previous' }
  if (key === 'Home') return { kind: 'first' }
  if (key === 'End') return { kind: 'last' }
  return null
}

/**
 * 「输入串 → 命中哪一行」的**唯一**入口：四个方向各走上游哪一条都在这里。
 * - `first` = `findFirstElement:539-546`（从 0 往后扫）
 * - `last` = `findLastElement:548-555`（从尾往前扫）
 * - `next` / `previous` = `findNextElement` / `findPreviousElement:476-516`（先迈一步、绕圈回绕）
 *
 * 各面板原先各自拼这段三元（`FileTree.vue`、`BookmarksPanel.vue`、`VcsLogTable.vue` 三份），
 * 拼出来的口径还两样（书签的 `last` 用 `nextSpeedSearchHit(..., 0, -1)`、文件树用
 * `lastSpeedSearchHit` —— 结果相同，写法不同）。这里收成一个函数，行标签表由调用方给。
 */
export function speedSearchHitForStep(labels: readonly string[], pattern: string, from: number, kind: SpeedSearchStep['kind'], hardSeparators = ''): number {
  if (!pattern.trim()) return -1
  const matches = labelMatcher(labels, pattern, hardSeparators)
  const count = labels.length
  if (kind === 'first') return speedSearchWalk(count, -1, 1, matches)
  if (kind === 'last') return speedSearchWalk(count, -1, -1, matches)
  return speedSearchWalk(count, from, kind === 'next' ? 1 : -1, matches, true)
}

/**
 * 上游那份**能打进速度搜索的字符表**（`SpeedSearch.java:25`，逐字抄的，含 `>` 与 `,` 之间那一个空格）：
 * `PUNCTUATION_MARKS = "*_-+"'/ .#$>: ,;?!@%^&"` —— 顺序与个数都按原文：
 * `* _ - + " ' / . # $ > :   , ; ? ! @ % ^ &`（21 个）。
 */
export const SPEED_SEARCH_PUNCTUATION_MARKS = '*_-+"\'/.#$>: ,;?!@%^&'

/** `Character.isLetterOrDigit`（Java 档 = Unicode 字母 + Nd 数字）。 */
function isLetterOrDigit(character: string): boolean {
  return /^[\p{L}\p{Nd}]$/u.test(character)
}

/**
 * **分隔符感知的"这个字符能不能打进速度搜索"**。上游有两处，档位不同，都得照下来：
 * - `SpeedSearch.java:96`（弹层/列表过滤那一支）：字母数字放行；标点要
 *   `!startedWithWhitespace(ch)` 才放行，而 `startedWithWhitespace`（`:109-111`）=
 *   **还没压着过滤串**且字符是空白 —— 也就是"空串上打空格不开搜"，但已经在搜了空格能接着打
 *   （`PUNCTUATION_MARKS` 里就带着一个空格）。
 * - `SpeedSearchBase.java:587-589`（树/表那一支）：`!Character.isWhitespace(c) && PUNCTUATION_MARKS.indexOf(c) != -1`
 *   —— 空白**一律**不放行，没有"已经在搜"这个例外。
 * `holdingFilter` 传 `null` 表示走树/表那一支（无例外）。
 */
export function isSpeedSearchTypeable(character: string, holdingFilter: boolean | null): boolean {
  if (isLetterOrDigit(character)) return true
  if (!SPEED_SEARCH_PUNCTUATION_MARKS.includes(character)) return false
  if (holdingFilter === null) return !/\s/.test(character)
  return holdingFilter || !/\s/.test(character)
}

/**
 * 「退格退到词首」：`SpeedSearch.java:63-70` —— 动作 `EditorDeleteToWordStart`
 * （快捷键在 `SpeedSearchBase.java:259` 注册：非 mac 是 `control BACK_SPACE`）压着过滤串时，
 * **一直退到最后一个空白分隔符为止**（`while (!myString.isEmpty() && !Character.isWhitespace(last)) backspace()`），
 * 然后吃掉这次按键。退到的是**空白**，不是 `PUNCTUATION_MARKS` 里的任意标点 —— 原文就是 `isWhitespace`。
 * 没压着过滤串时上游不做任何事（`:64` 的 `if (isHoldingFilter())`）。
 */
export function speedSearchDeleteToWordStart(pattern: string): string {
  if (!pattern) return pattern
  let end = pattern.length
  while (end > 0 && !/\s/.test(pattern[end - 1]!)) end--
  return pattern.slice(0, end)
}

/** `speedSearchNextInput` 的事件：打字 / 退格 / 退到词首 / Esc / 收起（回车与翻页与左右键）。 */
export type SpeedSearchInputEvent =
  | { kind: 'type'; character: string }
  | { kind: 'backspace' }
  | { kind: 'deleteWord' }
  | { kind: 'escape' }
  | { kind: 'hide' }

/** 速度搜索框的状态：串 + 框在不在场（上游 `mySearchPopup != null`，`SpeedSearchBase.java:1070`）。 */
export type SpeedSearchInputState = { pattern: string; shown: boolean }

/**
 * 「下一次输入是**替换**而不是追加」这一档，上游靠的是搜索框的生命周期，**不是计时器**：
 * - 框不在场时打一个字 ⇒ `showPopup(String.valueOf(c))`（`SpeedSearchBase.java:587-589`），
 *   新建的框只装这一个字符（`:758` `mySearchField.setText(initialString)`）⇒ **替换**。
 * - 框在场时打的字走文档的 `insertString`（`:730-744`）与 `SpeedSearch.type`（`:43-45`
 *   `updatePattern(myString + letter)`）⇒ **追加**。
 * - 回车/翻页/左右键 ⇒ `manageSearchPopup(null)`（`:965-975`）；**非 sticky** 时旧串不留存
 *   （`:1059-1061` 只有 `isStickySearch()` 才把它写进 client property），sticky（表侧过滤档
 *   `TableSpeedSearchBase.java:83-85`）才在重新拿到焦点时把旧串接回来（`:194-204`）。
 * - Esc：`SpeedSearchBase.java:976-980` → `hidePopup()`（`:570-573`）**先清空再收起**；
 *   弹层那一侧才是"只清串不关窗"（`SpeedSearch.java:77-81`），本仓那条两段式在 `src/popupStack.ts`。
 * - 退格：串空时也要吞掉（`:960-962`），非空时删一个字符（`SpeedSearch.java:47-51`）。
 *
 * 「**超时**后再输入算替换」这一档：**上游没有这一档**（2026-10-06 ssmatch 复核，见下）。
 * 把上游速度搜索这一族全数搜过（`SpeedSearchBase.java` / `SpeedSearch.java` /
 * `speedSearch/ListWithFilter.java` / `speedSearch/SpeedSearchSupply.java` /
 * `FilteringSpeedSearch.java` / `TreeSpeedSearch.java` / `ListSpeedSearch.java` / `TableSpeedSearchBase.java` /
 * `SwitcherSpeedSearch.kt`（两份）/ `CombinedSpeedSearch.kt` / `XDebuggerTreeSpeedSearch.java` /
 * jewel 那三份 `SpeedSearchable*.kt` + `SpeedSearchArea.kt`），
 * 逐档 grep（`grep -rn -i -E "timer|delayed|delay|sleep|timeout|expire" --include="*SpeedSearch*"
 * --include="ListWithFilter*" --include="*SpeedSearchable*" platform/ java/`，55 个文件全在里面）
 * 的**唯一**命中就是 `SpeedSearchBase.java:933` 那句 "causes Timer leaks"
 * （讲的是光标可见性，`getCaret().setVisible(false)`，与串无关）。
 * jewel 那一份的收起条件是 `dismissOnLoseFocus`（`SpeedSearchArea.kt:190`
 * `LaunchedEffect(isFocused, dismissOnLoseFocus) { if (!isFocused && dismissOnLoseFocus) state.hideSearch() }`）
 * 与 `dismissOnClickOutside`（`:431`），**同样不是计时器**。
 * 所以这里只做"收起即替换"，不编一个上游没有的超时。
 *
 * 「**退格退到空串后要不要取消过滤 / 收起搜索框**」——这一档上游**真有**，但它是**同步 + 注册表开关**，不是延时：
 * - 过滤本身在串变空的那一刻就停：`SpeedSearch.java:53-56` `shouldBeShowing` 对
 *   `myString.isEmpty()` 一律给 true；`:120-122` `isHoldingFilter() = myEnabled && !myString.isEmpty()`。
 *   所以"退格后多久取消过滤" = **0 毫秒**，没有缓冲档。
 * - 搜索框**要不要跟着收起**是另一条：`SpeedSearchBase.java:890-894`
 *   `onSearchFieldUpdated(pattern)` 在 `Strings.isEmpty(pattern) && Registry.is("ide.speed.search.close.when.empty")`
 *   时 `hidePopup()`；开关在 `platform/util/resources/misc/registry.properties:106-107`，**默认 false**
 *   （描述原文："Allows closing the speed search popup if the search pattern is empty"）。
 *   触发点也是同步的：文档变更 → `updateLastPattern()`（`SpeedSearchBase.java:772-778`）→ 回调，
 *   中间没有任何定时器。`FilteringTree.java:101-111` 与 `TableSpeedSearchBase.java:58-59` 覆写它做的是
 *   重新过滤（refilter），不改收起语义。
 * - 因此本仓的默认档（退到空串 ⇒ 串清空、框还在、过滤已停）**正是上游默认档**；
 *   `closeWhenEmpty = true` 时才是"退空即收起"。收起后 `shown: false` ⇒ 下一次输入走上面的**替换**那一档。
 */
export function speedSearchNextInput(state: SpeedSearchInputState, event: SpeedSearchInputEvent, sticky = false, closeWhenEmpty = false): SpeedSearchInputState {
  switch (event.kind) {
    case 'type':
      // 框不在场 ⇒ 这一个字符就是新串（替换）；在场 ⇒ 追加。
      return { pattern: state.shown ? state.pattern + event.character : event.character, shown: true }
    case 'backspace':
      // 空串也照样吞掉这一键，但不改串（`:960-962`）；非空退一格（`SpeedSearch.java:47-51`）。
      return closedWhenEmpty(state, state.pattern.slice(0, Math.max(0, state.pattern.length - 1)), closeWhenEmpty)
    case 'deleteWord':
      return closedWhenEmpty(state, speedSearchDeleteToWordStart(state.pattern), closeWhenEmpty)
    case 'escape':
      return { pattern: '', shown: false }
    case 'hide':
      return { pattern: sticky ? state.pattern : '', shown: false }
  }
}

/** `onSearchFieldUpdated:890-894` 那一档：退到空串 ⇒ （仅当开关为真）连搜索框一起收起。 */
function closedWhenEmpty(state: SpeedSearchInputState, pattern: string, closeWhenEmpty: boolean): SpeedSearchInputState {
  // `Strings.isEmpty(pattern)` 查的是**结果串**，不是"这一键删掉了什么"；框本来就不在场时也没什么可收的。
  if (closeWhenEmpty && state.shown && pattern.length === 0) return { pattern, shown: false }
  return { pattern, shown: state.shown }
}

/**
 * 在**可见行的原索引表**里走一步（`SpeedSearchBase.java:683-693` 的 adjustSelection → `:695-706`
 * 的 findTargetElement：↑↓Home/End 都只在"命中的那几条"之间移动，走完一圈回绕）。
 *
 * `visible` 是上游 `ListPopupModel` 那张表（`:44-48` `getOriginalIndex(filteredIndex)`，
 * `:143-150` `refilter()` 重建它）：元素是原列表里的下标，过滤串为空时它就是全量。
 * `from` 当前高亮的**原索引**。三种边界按上游：
 * - 表空（一条都没命中）：不动 —— `ListPopupImpl.java:505` 在"压着过滤串且模型 size 为 0"时
 *   直接 `return false`，既不选也不挪高亮。
 * - `from` 不在表里（刚被打字过滤掉了）：向下从第一条可见行起、向上从最后一条可见行起
 *   （`SpeedSearchBase.java:476-516` 的"先迈一步再找"在当前项不可选时等价于从端点起步）。
 * - 正常：`(位置 ± 1 + 长度) % 长度` 回绕。
 */
export function stepVisibleIndex(visible: readonly number[], from: number, kind: SpeedSearchStep['kind']): number {
  if (!visible.length) return from
  if (kind === 'first') return visible[0]!
  if (kind === 'last') return visible[visible.length - 1]!
  const position = visible.indexOf(from)
  const delta = kind === 'next' ? 1 : -1
  if (position < 0) return delta > 0 ? visible[0]! : visible[visible.length - 1]!
  return visible[(position + delta + visible.length) % visible.length]!
}

/** 搜索框里的空提示 = `editorsearch.search.hint`（`ApplicationBundle.properties:661` = `Search`）。 */
export const SPEED_SEARCH_HINT = '搜索'
