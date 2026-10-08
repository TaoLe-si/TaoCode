// 符号列表的过滤匹配 —— 结构弹层（`FileStructurePopup`，Ctrl+F12）与「转到当前文件符号」共用的那一条。
//
// 上游：`FileStructurePopup.java:316-318` 给它的树挂
// `MyTreeSpeedSearch` + `new SpeedSearchComparator(false, true, " ()")`：
//   · 第一参 `shouldMatchFromTheBeginning=false` → 命中不要求从词首开始（内部加 `*` 前缀）；
//   · 第二参 `shouldMatchCamelCase=true` → 模式先按 `NameUtilCore.nameToWordList` 拆词再用 `*` 连接，
//     于是 `GSF` 能命中 `GotoSymbolFromFile`（驼峰缩写）；
//   · 匹配器是 `NameUtil.buildMatcher(...).build()` 的 `MinusculeMatcher`：大小写不敏感的子序列，
//     并对驼峰/词首/分隔符后的命中加权；第三个参数 `" ()"` 是这一站**自己**的硬分隔符集。
//
// 本仓没有 `MinusculeMatcher`，等价物就是 `src/speedSearch.ts` 那一份**共用**匹配器
// （大小写不敏感的子序列 + 大写字母落点的四条放行 + `checkForSpecialChars` 的两条分隔符档），返回布尔 ——
// 上游是树内过滤，行的顺序仍按结构视图顺序，**不重排**。
//
// 2026-10-06（ss3）：这里原本自己写了第二份"输入串 → 命中"的判据（`src/fuzzyMatch.ts` 的
// Smith-Waterman 打分 + "命中下标数 == 模式长度"那道约束），与 `speedSearchMatches` 是两套代码。
// 现在收成一个真源，顺带把这一站**独有**的那一条补上：`SpeedSearchComparator(false, true, " ()")`
// 的第三个参数 —— 硬分隔符集 `' ()'`（`MinusculeMatcherImpl.kt:286-292` 的那一档只有传了分隔符集
// 才会生效），pattern 自己不带分隔符、又不混大小写时，两个 hump 之间不许跨过空格或括号。
//
// 2026-10-06（ssmatch）订正一句：同一个 `checkForSpecialChars` 里的**第二条**（点号，`:293-297`）
// 与分隔符集无关 —— pattern 里出现过 `.` 就不许再跨过一个 `.`，这一档在**每一个**速度搜索站点都生效，
// 不是这一站独有。所以"只有结构弹层吃得到分隔符感知"那句旧话只对第一条成立。
import { SPEED_SEARCH_STRUCTURE_SEPARATORS, speedSearchMatches } from './speedSearch.ts'
// 再导出而不是让包装层自己去引 `speedSearch`：整条链上「硬分隔符集」只有一个出处，
// 包装层（`src/lspSymbolBridge.ts`）与这里比的是同一份 `' ()'`，不会两处各写一个字面量再漂。
export { SPEED_SEARCH_STRUCTURE_SEPARATORS }

/**
 * 空查询放行全部；否则按大小写不敏感的子序列（含驼峰缩写）判定。
 *
 * `hardSeparators` 是**调用方那一站**自己的硬分隔符集，默认空 = 与树/表侧那一份比较器一致
 * （`SpeedSearchBase.java:126` → `SpeedSearchComparator.java:34-36` 的第三参 `""`）。
 * 只有结构弹层（Ctrl+F12）那一站上游传了 `" ()"`（`FileStructurePopup.java:318`），
 * 由 `documentSymbolEntries` 显式带 `SPEED_SEARCH_STRUCTURE_SEPARATORS` 进来；
 * Select In（`SpeedSearch.java:158-166` → `SpeedSearchUtil.java:31-33` 的 U+001F）与
 * Registry 表（`TableSpeedSearch` 走比较器默认）两站**不跨空格/括号拦**，所以留默认。
 */
export function symbolMatchesQuery(name: string, query: string, hardSeparators = ''): boolean {
  const needle = query.trim()
  if (!needle) return true
  if (!name) return false
  return speedSearchMatches(needle, name, hardSeparators)
}
