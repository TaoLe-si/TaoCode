// 参数提示的**排除列表**（"这一条提示我不要看"）—— 纯规则，无 UI、无 IO。
//
// 上游坐标（2026-10-06 亲自开 `D:\Backup\Downloads\intellij-community-master\intellij-community-master` 逐行核过；
// `third_party/intellij-community` 是坏树，未用）：
//   · 入口 `platform/lang-impl/src/com/intellij/codeInsight/hints/parameters/ParameterHintExcludeListService.kt:93-105`
//     （`isExcluded(fullyQualifiedName, parameterNames, language)` = 任一 matcher 命中；
//     清单 → matcher 的编译是 `getMatchers` 的 `excludeList.mapNotNull { MatcherConstructor.createMatcher(it) }`，
//     编译不了的条目**静默作废**、不抛，并且结果按语言缓存）；
//   · 模式文法 `platform/platform-impl/src/com/intellij/codeInsight/hints/filtering/MethodMatcher.kt:53-106`
//     （`MatcherConstructor`：以**最后一个 `(`** 分成「方法名 glob」+「参数名 glob 列表」；
//     开头就是括号 ⇒ 方法名部分是空串（空串 = 恒真，见 `StringMatcherBuilder.kt:29`）；
//     参数列表按逗号拆、逐位匹配，**条数必须相等**（`StringParamMatcher:33-43`））；
//   · glob 本体 `…/filtering/StringMatcherBuilder.kt:28-61`（`*` 只允许出现在首/尾、总数 ≤2；
//     `*x` = 后缀、`x*` = 前缀、`*x*` = 包含、`*` = 任意、无星号 = 精确相等，其它写法整条作废）；
//   · 「默认清单 + 用户差量」`platform/lang-api/src/com/intellij/codeInsight/hints/settings/ParameterNameHintsSettings.kt:26-45`
//     的 `Diff(added, removed)` / `applyOn` / `Builder.build(base, updated)`，
//     折算点 `platform/lang-impl/src/com/intellij/codeInsight/hints/HintUtils.kt:87-90`
//     （`settings.getExcludeListDiff(language).applyOn(config.defaultExcludeList)`）；
//   · 逐行文本与校验 `platform/lang-impl/src/com/intellij/codeInsight/hints/ExcludeListPanel.kt:117-123`（按行拆、丢空行）
//     与 `HintUtils.kt:44-53 getExcludeListInvalidLineNumbers`（坏模式的行号，UI 用它禁掉「确定」）。
//
// **本仓与上游的三处口径差**（不是猜的，是 LSP 与 PSI 的差别；详见 docs/batch-2026-10-06-inlayparams.md §1/§5）：
//   1. 上游匹配的主题是「被调方法的全限定名 + 该次调用的参数名列表」（`InlayParameterHintsProvider.kt:71-76` 的
//      `MethodInfo(fullyQualifiedName, paramNames)`，Java 侧算法 `JavaInlayParameterHintsProvider.kt:57-63`）。
//      本仓的提示来自 LSP `textDocument/inlayHint`，服务端**不给**被调方法名，只给每条提示自己的 `label`；
//      `platform/lsp-impl` 自己也**没有**排除清单的消费方（全目录 grep `isExcluded` 只命中 `LspDocumentSyncManager.kt:188`
//      那个文件索引的同名函数）⇒ 本仓把同一条 glob 同时套在「方法名位」与「参数名位」上（`compileExcludePatterns`），
//      这样 `key` 与 `(key)` 两种写法都有意义，而 `*.get(*)` 那类方法名形态不会因为换个写法就悄悄失效。
//   2. 上游的参数名列表有 arity（`(begin*, end*)` 要求正好两个参数）。LSP 每条提示是独立的一条，
//      凑不出可靠的 arity ⇒ 多参数形态在本仓恒不匹配（登记，不假装支持）。
//   3. 上游的出厂默认清单是 per-language provider 数据（`JavaInlayParameterHintsProvider.kt:67-…`、
//      `KtParameterHintsProvider.kt:449-…`），条目全是**方法 FQN 形态**；本仓主题里没有 FQN ⇒ 逐条映射就是自造语义，
//      所以出厂默认清单取空（`DEFAULT_PARAMETER_HINT_EXCLUDE_LIST`），只让用户自己写。

/** 一条星号 glob 编译成的判定函数（上游 `StringMatcher`）。 */
export type ExcludeGlob = (text: string) => boolean

/**
 * 上游 `StringMatcherBuilder.create`（`StringMatcherBuilder.kt:28-61`）逐字对应：
 * 空串恒真；`*` 恒真；无星号精确相等；`*x` 后缀；`x*` 前缀；`*x*` 包含；星号多于 2 个或位置不合法 ⇒ `null`（整条作废）。
 */
export function createExcludeGlob(pattern: string): ExcludeGlob | null {
  if (pattern === '') return () => true
  const stars = [...pattern].filter(char => char === '*').length
  if (stars > 2) return null
  if (stars === 0) return text => text === pattern
  if (pattern === '*') return () => true
  if (pattern.startsWith('*') && stars === 1) {
    const target = pattern.slice(1)
    return text => text.endsWith(target)
  }
  if (pattern.endsWith('*') && stars === 1) {
    const target = pattern.slice(0, -1)
    return text => text.startsWith(target)
  }
  if (pattern.startsWith('*') && pattern.endsWith('*')) {
    const target = pattern.slice(1, -1)
    return text => text.includes(target)
  }
  return null
}

/** 一条排除模式的判定（上游 `MethodMatcher`：方法名 glob 且 参数名 glob 列表）。 */
export interface ExcludePatternMatcher {
  isMatching(methodName: string, paramNames: readonly string[]): boolean
}

/** 上游 `MatcherConstructor.getParamsMatcher`（`MethodMatcher.kt:74-83`）：取最后一个 `(` 到最后一个 `)`，取不到 ⇒ null。 */
function paramsSlice(pattern: string): string | null {
  const open = pattern.lastIndexOf('(')
  const close = pattern.lastIndexOf(')')
  if (open >= 0 && close > 0) return pattern.slice(open, close + 1).trim()
  return null
}

/** 上游 `MatcherConstructor.createParametersMatcher`（`:85-94`）：`(a, b)` → 逐位 glob，条数不等就不匹配。 */
function createParamsMatcher(paramsPattern: string): ((paramNames: readonly string[]) => boolean) | null {
  if (paramsPattern.length <= 2) return null
  const parts = paramsPattern.slice(1, paramsPattern.length - 1).split(',').map(part => part.trim())
  if (parts.some(part => part === '')) return null
  const globs = parts.map(part => createExcludeGlob(part))
  if (globs.some(glob => glob === null)) return null
  return paramNames => paramNames.length === globs.length
    && globs.every((glob, index) => (glob as ExcludeGlob)(paramNames[index] ?? ''))
}

/**
 * 上游 `MatcherConstructor.createMatcher`（`MethodMatcher.kt:96-103`）逐字对应：
 * 以最后一个 `(` 切两半；无括号 ⇒ 参数侧恒真（`AnyParamMatcher`）；`(…)` 开头 ⇒ 方法侧空串（恒真）；
 * 任何一半编译不了就整条返回 `null`（上游用 `mapNotNull` 丢弃 ⇒ 坏模式不报错也不生效）。
 */
export function createExcludePatternMatcher(pattern: string): ExcludePatternMatcher | null {
  const trimmed = pattern.trim()
  if (trimmed === '') return null
  const open = trimmed.lastIndexOf('(')
  let methodName = trimmed
  let paramsPattern = ''
  if (open >= 0) {
    const slice = paramsSlice(trimmed)
    if (slice === null) return null
    paramsPattern = slice.trim()
    methodName = open === 0 ? '' : trimmed.slice(0, open).trim()
  }
  const nameGlob = createExcludeGlob(methodName)
  if (nameGlob === null) return null
  let params: (paramNames: readonly string[]) => boolean
  if (paramsPattern === '') params = () => true          // 上游 AnyParamMatcher（`MethodMatcher.kt:29-31`）
  else {
    const created = createParamsMatcher(paramsPattern)
    if (created === null) return null
    params = created
  }
  return { isMatching: (name, paramNames) => nameGlob(name) && params(paramNames) }
}

/** 上游 `HintUtils.kt:44-53`：返回编译不了的行号（从 0 起，与上游一致），空行跳过。设置页/对话框用它标红。 */
export function invalidExcludePatternLines(text: string): number[] {
  const invalid: number[] = []
  text.split('\n').forEach((line, index) => {
    if (line !== '' && createExcludePatternMatcher(line) === null) invalid.push(index)
  })
  return invalid
}

/** 上游 `ParameterNameHintsSettings.kt:26` 的 `Diff`：只存与默认清单的差量，不存全量。 */
export interface ExcludeListDiff {
  added: readonly string[]
  removed: readonly string[]
}

/** 上游 `Diff.Builder.build`（`:34-43`）：added = updated − base，removed = base − updated。 */
export function buildExcludeListDiff(base: readonly string[], updated: readonly string[]): ExcludeListDiff {
  const baseSet = new Set(base)
  const updatedSet = new Set(updated)
  return {
    added: [...updatedSet].filter(item => !baseSet.has(item)),
    removed: [...baseSet].filter(item => !updatedSet.has(item)),
  }
}

/** 上游 `Diff.applyOn`（`:27-32`）：默认清单先加后删。 */
export function applyExcludeListDiff(base: readonly string[], diff: ExcludeListDiff): string[] {
  const list = new Set(base)
  for (const item of diff.added) list.add(item)
  for (const item of diff.removed) list.delete(item)
  return [...list]
}

/** 上游 `ExcludeListPanel.kt:118`：一行一条，丢空白行；`ExcludeListPanel.kt:95`/`:130` 的反向就是 `join('\n')`。 */
export function parseExcludeListText(text: string): string[] {
  return text.split('\n').map(line => line.trim()).filter(line => line !== '')
}

/** 清单 → 编辑框里的那段文本（上游 `StringUtil.join(excludeList, "\n")`）。 */
export function renderExcludeListText(patterns: readonly string[]): string {
  return patterns.join('\n')
}

/**
 * 出厂默认清单：**空**。
 * 理由见文件头第 3 条口径差 —— 上游那份默认清单（Java/Kotlin）全是方法 FQN 形态，
 * 本仓的主题（提示文本本身）里没有 FQN，逐条搬过来只会变成"看起来有默认值、实际恒不匹配"的假数据。
 */
export const DEFAULT_PARAMETER_HINT_EXCLUDE_LIST: readonly string[] = []

/**
 * LSP 参数提示的 label 通常带分隔符（`name:` / `name=`），上游的 `paramNames` 来自 PSI、不带。
 * 匹配前把首尾空白与**单个**尾部分隔符去掉，让用户写 `key` 就能命中 `key:`；
 * label 本身原样参与比较（大小写敏感，与上游 `StringMatcherBuilder.kt:38` 的精确相等一致）。
 */
export function normalizeParameterHintLabel(label: string): string {
  return label.trim().replace(/[:=]$/, '')
}

/** 排除判定：一条提示要不要被藏掉（参数提示专用；类型提示走别的档，见文件头口径差 1）。 */
export type ParameterHintExcluder = (label: string | undefined | null) => boolean

/**
 * 把清单编译成判定函数（对应上游 `getMatchers` 的"编译一次、按语言缓存"，`:96-105`）。
 * 非字符串条目、空串、编译不了的条目一律丢掉 —— 与上游 `mapNotNull` 同一个行为。
 * 判定对同一条 glob 套两次（方法名位 + 参数名位），是口径差 1 的落点。
 */
export function compileExcludePatterns(patterns: readonly string[] | undefined): ParameterHintExcluder {
  const matchers: ExcludePatternMatcher[] = []
  for (const pattern of patterns ?? []) {
    if (typeof pattern !== 'string') continue
    const matcher = createExcludePatternMatcher(pattern)
    if (matcher !== null) matchers.push(matcher)
  }
  if (matchers.length === 0) return () => false
  return label => {
    if (typeof label !== 'string' || label === '') return false
    const subject = normalizeParameterHintLabel(label)
    if (subject === '') return false
    return matchers.some(matcher => matcher.isMatching(subject, [subject]))
  }
}
