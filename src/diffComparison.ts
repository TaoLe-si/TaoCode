// 比较策略（上游 `ComparisonPolicy`）与 diff 视图的两个档位。
//
// 上游 `ComparisonPolicy`（`platform/util/diff/src/com/intellij/diff/comparison/ComparisonPolicy.kt`）
// 只有三档：`DEFAULT` / `TRIM_WHITESPACES` / `IGNORE_WHITESPACES`。用户在界面上看到的是
// `IgnorePolicy`（`platform/diff-impl/.../tools/util/base/IgnorePolicy.java`），它有六项，
// 但 `getComparisonPolicy()` 把它们折成上面三档：
//   DEFAULT / FORMATTING / IGNORE_LANGUAGE_SPECIFIC_CHANGES → DEFAULT
//   TRIM_WHITESPACES                                        → TRIM_WHITESPACES
//   IGNORE_WHITESPACES / IGNORE_WHITESPACES_CHUNKS          → IGNORE_WHITESPACES
// 本仓**第一百零四批**把 `IGNORE_WHITESPACES_CHUNKS` 也做了（"忽略空格和空行"）：
// 它没有自己的 `ComparisonPolicy`（折成 `IGNORE_WHITESPACES`），多出来的是 `isShouldTrimChunks()`
// 那一步 —— 把**只差空白**的改动从改动块的首尾剪掉（`IgnorePolicy.java:41-43`、
// `ComparisonManagerImpl.processAdjoining` 的 `trim && policy == IGNORE_WHITESPACES` 分支）。
// 剩下的 `FORMATTING` 要语言格式化器、`LANGUAGE_SPECIFIC` 要语言侧的忽略规则，都不在本架构里 ——
// 选择器不列点了没反应的项。
//
// **默认档是 DEFAULT**（`TextDiffSettingsHolder.kt` 的 `IGNORE_POLICY = IgnorePolicy.DEFAULT`），
// 界面上那一项的名字是 `option.ignore.policy.none` = "None"，即尾随空格不同**算不同**。
// 本仓原先的逐行相等与它一致；这一批把另外两档补上。

/**
 * 上游 `ComparisonPolicy.kt` 的三档 + 本仓额外做的第四档。
 *
 * 第四档 `ignoreWhitespacesChunks` 在上游**不是** `ComparisonPolicy` 的值，而是 `IgnorePolicy`
 * 的 `IGNORE_WHITESPACES_CHUNKS`：比较仍按 `IGNORE_WHITESPACES`，另外把"只差空白"的改动从
 * 改动块的首尾剪掉（见文件头）。本仓把它作为第四个可选档，因为它对用户是独立的一项
 * （"忽略空格和空行"）。
 */
export type ComparisonPolicy = 'default' | 'trimWhitespaces' | 'ignoreWhitespaces' | 'ignoreWhitespacesChunks'

/** `TextDiffSettingsHolder.kt` 的 `IGNORE_POLICY = IgnorePolicy.DEFAULT`。 */
export const DEFAULT_COMPARISON_POLICY: ComparisonPolicy = 'default'

/**
 * 三项选择器的展示名。文案取本机随 IDE 发货的中文语言包
 * （`localization-zh.jar` 的 `messages/DiffBundle.properties`，key 即上游 `IgnorePolicy` 的
 * `option.ignore.policy.*`）；取不到时退回上游英文原文。
 */
export const COMPARISON_POLICY_LABELS: Record<ComparisonPolicy, string> = {
  default: '无',
  trimWhitespaces: '修整空白',
  ignoreWhitespaces: '忽略空格',
  ignoreWhitespacesChunks: '忽略空格和空行',
}

/** 选择器那一组的分组名（`DiffBundle.properties:232` 的 `option.ignore.policy.group.name`）。 */
export const COMPARISON_POLICY_GROUP = '忽略差异'

/**
 * 把一行按策略折成用于**比较**的键。注意：折出来的键只用来判等，**渲染仍然用原文**
 * （上游同理 —— `ComparisonManagerImpl` 比的是折过的行，画的是原始行）。
 *
 * · `trimWhitespaces` = 掐掉首尾空白（上游 `TrimUtil.trim`：`isSpaceEnterOrTab`，
 *   `platform/util/diff/.../comparison/TrimUtil.kt:53-55`）；
 * · `ignoreWhitespaces` = 再把中间所有空白整个删掉（上游 `ComparisonUtil.isEqualTexts`
 *   在 `IGNORE_WHITESPACES` 档下用 `TrimUtil` 的忽略型比较，等价于"去掉全部空白再比"）。
 *
 * 上游只忽略空格、制表符、LF（`TrimUtil.kt:29-31,583`「from Strings.isWhiteSpace」；
 * `platform/util/base/src/com/intellij/openapi/util/text/Strings.java:729-730`——同名文件在
 * `plugins/maven/` 下还有一份，引用指前者）。
 * CR、NBSP、全角空格不是可忽略字符。
 */
export function comparisonKey(line: string, policy: ComparisonPolicy): string {
  if (policy === 'default') return line
  if (policy === 'trimWhitespaces') return line.replace(/^[ \t\n]+|[ \t\n]+$/g, '')
  return line.replace(/[ \t\n]+/g, '')
}

export function isDiffWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n'
}

/**
 * 这一档要不要"剪边界"（上游 `IgnorePolicy.isShouldTrimChunks()`，`IgnorePolicy.java:41-43`）。
 */
export function shouldTrimChunks(policy: ComparisonPolicy): boolean {
  return policy === 'ignoreWhitespacesChunks'
}

/**
 * 上游 `IgnorePolicy` 的三条派生语义（`IgnorePolicy.java:29-43`）合成一张表。
 *
 * 界面上是一个六项枚举，但下游只用三条派生属性：
 *   · `comparison` = `getComparisonPolicy()`（`IgnorePolicy.java:29-35`）：三种比较策略的折叠，
 *     `IGNORE_WHITESPACES_CHUNKS` 与 `IGNORE_WHITESPACES` 同档；
 *   · `squash` = `isShouldSquash()`（`IgnorePolicy.java:37-39`）：六项里只有
 *     `IGNORE_LANGUAGE_SPECIFIC_CHANGES` 为 false，本仓选择器里的四项全 true；
 *   · `trimChunks` = `isShouldTrimChunks()`（`IgnorePolicy.java:41-43`）：只有 `IGNORE_WHITESPACES_CHUNKS` 为 true。
 *
 * `squash` 的消费者是 `diffWords.shouldSquashFragments`（与 `HighlightPolicy.isShouldSquash()`
 * 相与，`TwosideTextDiffProviderBase.java:75`）。本仓是"逐行一张标记表"，相邻行本来就各渲染
 * 各的行内标记，没有上游那种跨 LineFragment 拼接内部片段的动作 —— 所以这一条在当前渲染模型里
 * 是**结构等价**的：判定表齐全（哪一档允许合并），只是没有一条会产生不同像素的路径。
 */
export function ignorePolicyDerivatives(policy: ComparisonPolicy): {
  comparison: ComparisonPolicy
  squash: boolean
  trimChunks: boolean
} {
  return { comparison: policy, squash: true, trimChunks: policy === 'ignoreWhitespacesChunks' }
}

/**
 * 上游 `IgnorePolicy.isShouldSquash()`（`IgnorePolicy.java:37-39`）：本仓选择器里的四项全为 true
 * （唯一为 false 的 `IGNORE_LANGUAGE_SPECIFIC_CHANGES` 不列，因为它没有语言侧规则可跑）。
 */
export function ignorePolicyShouldSquash(_policy: ComparisonPolicy): boolean {
  return true
}

/** 按策略折整个数组，用于行级对齐。 */
export function comparisonKeys(lines: readonly string[], policy: ComparisonPolicy): string[] {
  if (policy === 'default') return [...lines]
  return lines.map(line => comparisonKey(line, policy))
}

/**
 * 一行在"忽略空格"的意义下等于另一行（缺一侧时按空串算 —— 空白行的新增/删除也算"只差空白"）。
 * 上游那一步比的是片段两侧的**整段文本**（`ComparisonManagerImpl.processAdjoining` 里的
 * `ComparisonUtil.isEquals(sequence1, sequence2, IGNORE_WHITESPACES)`）。
 */
export function whitespaceOnlyDifference(left: string | undefined, right: string | undefined): boolean {
  return comparisonKey(left ?? '', 'ignoreWhitespaces') === comparisonKey(right ?? '', 'ignoreWhitespaces')
}
