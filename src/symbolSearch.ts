// 符号列表的过滤匹配 —— 结构弹层（`FileStructurePopup`，Ctrl+F12）与「转到当前文件符号」共用的那一条。
//
// 上游：`FileStructurePopup.java:316-318` 给它的树挂
// `MyTreeSpeedSearch` + `new SpeedSearchComparator(false, true, " ()")`：
//   · 第一参 `shouldMatchFromTheBeginning=false` → 命中不要求从词首开始（内部加 `*` 前缀）；
//   · 第二参 `shouldMatchCamelCase=true` → 模式先按 `NameUtilCore.nameToWordList` 拆词再用 `*` 连接，
//     于是 `GSF` 能命中 `GotoSymbolFromFile`（驼峰缩写）；
//   · 匹配器是 `NameUtil.buildMatcher(...).build()` 的 `MinusculeMatcher`：大小写不敏感的子序列，
//     并对驼峰/词首/分隔符后的命中加权。
//
// 本仓没有 `MinusculeMatcher`，等价物就是已有的 Smith-Waterman 打分（`src/fuzzyMatch.ts`，
// Search Everywhere 的文件供给者也在用同一套）：子序列命中 + 驼峰/连续/分隔符花红。
// 这里只取"命中与否"，返回布尔 —— 上游是树内过滤，行的顺序仍按结构视图顺序，**不重排**。
import { fuzzyMatch } from './fuzzyMatch.ts'

/** 空查询放行全部；否则按大小写不敏感的子序列（含驼峰缩写）判定。 */
export function symbolMatchesQuery(name: string, query: string): boolean {
  const needle = query.trim()
  if (!needle) return true
  if (!name) return false
  const match = fuzzyMatch(needle, name)
  // Smith-Waterman 是**局部**对齐：只命中一部分字符（如 'Fzz' 对 'FooBar' 只中了 F）分也为正。
  // 过滤要的是"整个模式都命中"，所以还要求命中下标数 == 模式长度（上游 MinusculeMatcher 同款约束）。
  return match.score > 0 && match.indices.length === needle.length
}
