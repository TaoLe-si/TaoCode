// 结构化搜索的**修饰符（modifier）支持模型** —— 判词 `ss/matcher` 里「变量约束的
// regExp/script/within/contains/reference/invertible」与「匹配范围」两条待办的落点。
//
// **先订正一处坐标**：任务书/旧笔记点名的 `MatcherModifiers`、`ModifierSupport`、
// `InvertModifier`、`SubtreeModifier` 在基准树里**按文件名、按包路径、按语义三条路都搜不到**
// （`find -iname '*modifier*'` 的命中全在 `java/…` 的 `PsiModifierList` 那一族与调试器参数里，
// `platform/structuralsearch/` 下零命中；`grep -rin "subtree" platform/structuralsearch/source/` 零命中）。
// 上游真正的修饰符面是**三样东西**，本模块逐样承接：
//   ① **选项名表**：`platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/
//      compiler/StringToConstraintsTransformer.java:20-31`（九个：ref/regex/regexw/exprtype/
//      formal/script/contains/within/context），条件文本由同文件的 `parseCondition`（`:331-410`）切开，
//      `!` 前缀在 `:397` 翻转 `invert` 标志。
//   ② **写入与取反规则**：同文件 `handleOption`（`:412-479`）—— 每个选项把值写进
//      `MatchVariableConstraint` 的哪个字段、能不能取反（`script` 在 `:456`、`context` 在 `:471`
//      以及未知项在 `:478` 直接抛 `error.cannot.invert`，`SSRBundle.properties:271`），
//      外加编译期把取反包成 `NotPredicate`（`impl/matcher/compiler/PatternCompiler.java:488-490`、
//      `:496-498`、`:507-509`、`:537-539`）。这就是"反向修饰"在上游的全部含义。
//   ③ **档位**：变量档 vs 整模板档。`within` 与 `context` **只允许写在整模板上**
//      （`StringToConstraintsTransformer.java:463-466`、`:470-474` 比对 `Configuration.CONTEXT_VAR_NAME`
//      = `"__context__"`，`plugin/ui/Configuration.java:29`，不等就抛
//      `error.only.applicable.to.complete.match`，`SSRBundle.properties:272`）；
//      变量后缀上写 `within` 在上游连编译都过不去（`PatternCompiler.java:513-515` 直接 `assert false`）。
//      本模块的 `TemplateScope` 就是「整个模板」那一档的模型（面板上的「匹配范围」输入）。
//
// **文本层怎么承接**（本仓没有 PSI，所以按"对用户可见的那一面"逐条换通道，不是逐行复刻）：
//   · `regex` / `regexw` / `!regex` / 量词 min-maxCount / 非贪婪 —— 编进**正则捕获组**，
//     在 `src/structuralSearchConstraints.ts`；
//   · `contains` / `within` —— 判的是"**捕获段（或整段命中）里面还有没有另一个子模板**"，
//     正则表达不了"整段之内"，所以走**命中后的跨度复核**：本文件的 `execWithSpans` 用 JS 正则的
//     `d` 标志（match indices）拿到整段与每个变量的字符区间，`containsHolds` / `withinHolds` 按区间
//     判包含。上游 `WithinPredicate.java:27-35` 用的也是"区间包含"，只是它的区间是语法树节点：
//     `PsiTreeUtil.isAncestor(result.getMatch(), matchedNode, false)`（`WithinPredicate.java:30`）
//     的第三参 `strict=false` 在 `platform/core-api/src/com/intellij/psi/util/PsiTreeUtil.java:89`
//     展开成 `strict ? element.getParent() : element` —— **非严格，自己也算**，所以本仓的
//     范围判定取"两端相等的也算在内"，不额外要求真包含。
//   · `ref` / `exprtype` / `formal` / `script` / `context` —— 没有落点，只登记原因，
//     **不画控件**（`src/structuralSearchFilters.ts` 的 `UNAVAILABLE_FILTERS` 那行说明文字）。
//   · `contains` 顺带留一条**取证结果**：上游这一档其实是死代码 ——
//     `impl/matcher/predicates/ContainsPredicate.java:12-18` 的构造器把参数直接丢掉、`match` 恒 `false`，
//     于是 `contains(...)` 在上游=永不命中、`!contains(...)`=永不生效。本仓按**面板承诺的语义**
//     （"这段里要含那个结构"）实现，比上游那一支可用；差异如实记在这里与报告里。

import { compileStructuralPattern, type StructuralPattern } from './structuralSearch.ts'
import type { VariableConstraint } from './structuralSearchConstraints.ts'

/** 档位：变量档（写在 `$x$[...]` 后缀上）/ 整模板档（写在「整个模板」那一行）。 */
export type ModifierLevel = 'variable' | 'template'

/** 支持程度：正则=编进捕获组；跨度=命中后按字符区间复核；无=本仓没有落点。 */
export type ModifierSupport = 'regex' | 'span' | 'none'

export interface ModifierDescriptor {
  /** 上游条件文本里的选项名（`StringToConstraintsTransformer.java:20-28`）。 */
  id: string
  /** 面板上的中文档名（没有 UI 动作的档按 `名字` 原样给）。 */
  label: string
  /** 要不要带参数（上游 `:372` 的 `error.argument.expected` 只对带括号的选项触发）。 */
  takesArgument: boolean
  /** 能不能取反（`!` 前缀）。`false` 的三档上游会抛 `error.cannot.invert`。 */
  invertible: boolean
  level: ModifierLevel
  support: ModifierSupport
  /** 上游写入点的「相对路径:行号」。 */
  upstream: string
  /** support 为 none 时的具体卡点（缺哪一层）。 */
  reason?: string
}

/**
 * 九个选项的支持矩阵。顺序与 `StringToConstraintsTransformer.java:20-28` 的常量声明一致，
 * 面板按这张表决定"哪些档画控件、哪些档只写说明"，所以新增一档不会凭空长出按钮。
 */
export const MODIFIER_DESCRIPTORS: readonly ModifierDescriptor[] = [
  {
    id: 'ref', label: '引用', takesArgument: true, invertible: true, level: 'variable', support: 'none',
    upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:415-417',
    reason: '要解析变量引用到的元素（`ReferencePredicate`），本仓结构化搜索只走宿主文本扫描，没有符号表。',
  },
  {
    id: 'regex', label: '文本', takesArgument: true, invertible: true, level: 'variable', support: 'regex',
    upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:419-426',
  },
  {
    id: 'regexw', label: '文本（全词）', takesArgument: true, invertible: true, level: 'variable', support: 'regex',
    upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:419-429',
  },
  {
    id: 'exprtype', label: '表达式类型', takesArgument: true, invertible: true, level: 'variable', support: 'none',
    upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:431-444',
    reason: '要表达式类型推导（`PatternCompiler.addExtensionPredicates` 走类型服务），文本通道拿不到类型。',
  },
  {
    id: 'formal', label: '形参类型', takesArgument: true, invertible: true, level: 'variable', support: 'none',
    upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:446-453',
    reason: '同上：形参类型来自声明处的语法树，本仓没有语法树。',
  },
  {
    id: 'script', label: '脚本', takesArgument: true, invertible: false, level: 'variable', support: 'none',
    upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:455-457',
    reason: 'Groovy 脚本宿主（`StructuralSearchScriptEngine`）；本仓不执行模板里的脚本，也不会为了这一档引入 eval。',
  },
  {
    id: 'contains', label: '包含', takesArgument: true, invertible: true, level: 'variable', support: 'span',
    upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:459-461',
  },
  {
    id: 'within', label: '匹配范围', takesArgument: true, invertible: true, level: 'template', support: 'span',
    upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:463-468',
  },
  {
    id: 'context', label: '语法上下文', takesArgument: true, invertible: false, level: 'template', support: 'none',
    upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/StringToConstraintsTransformer.java:470-475',
    reason: '`PatternContext`/`PatternTreeContext` 决定模板按哪种语法上下文解析成树（`PatternCompiler.java:555-560`），本仓不做语法树解析。',
  },
]

/** 按 id 取一档（读不到的返回 null，面板据此不画控件）。 */
export function modifierDescriptor(id: string): ModifierDescriptor | null {
  return MODIFIER_DESCRIPTORS.find(item => item.id === id) ?? null
}

/** 变量档里本仓真的兑现了的选项（面板只画这些）。 */
export function variableModifiers(): ModifierDescriptor[] {
  return MODIFIER_DESCRIPTORS.filter(item => item.level === 'variable' && item.support !== 'none')
}

/** 没有落点的档（只出说明文字，不出控件）。 */
export function unsupportedModifiers(): ModifierDescriptor[] {
  return MODIFIER_DESCRIPTORS.filter(item => item.support === 'none')
}

/** `error.cannot.invert=Cannot invert ''{0}'' constraint`（`SSRBundle.properties:271`）。 */
export function cannotInvertMessage(id: string): string {
  return `不能取反「${modifierDescriptor(id)?.label ?? id}」修饰符`
}

/** 一条修饰符（选项名 + 参数 + 取反位），与上游 `parseCondition` 切出来的三元组同形。 */
export interface Modifier {
  id: string
  argument: string
  invert: boolean
}

/**
 * 翻转取反位 —— 上游 `InvertModifier` 那一面（`StringToConstraintsTransformer.java:397` 的
 * `invert = !invert`，写进约束时 `:456`/`:471`/`:478` 对不可取反的档抛错）。
 * 不可取反时**不返回改过的对象**，而是回一句错误文案，面板据此把这次点击当成没发生。
 */
export function toggleInvert(modifier: Modifier): { modifier: Modifier } | { error: string } {
  const descriptor = modifierDescriptor(modifier.id)
  if (!descriptor) return { error: `不认识的选项 \`${modifier.id}\`。` }
  if (!descriptor.invertible) return { error: cannotInvertMessage(modifier.id) }
  return { modifier: { ...modifier, invert: !modifier.invert } }
}

// ── 命中后的跨度复核（contains / within）────────────────────────────────────────────

/** 一段字符区间（上游是 PSI 节点的 range，本仓是行内字符下标）。 */
export interface Span {
  start: number
  end: number
  text: string
}

export interface MatchSpans {
  /** 整段命中（上游 `MatchResult.getMatchImage()`，`MatchResult.java:15`）。 */
  whole: Span
  /** 变量名 → 它这一段捕获的区间；没参与匹配的组是 null。 */
  variables: Record<string, Span | null>
}

/**
 * 用 `d` 标志（ES2022 match indices）重跑一次编译产物，拿整段与每个捕获组的字符区间。
 *
 * 与 `src/structuralSearchResults.ts` 的 `variableValues` 同一条口径：**同一个编译产物、
 * 同一段文本、同一个起点**，所以这里的区间和宿主真正替换掉的那一段是对得上的；
 * JS 引擎配不上（超长行被宿主截断、环视文法差异）时返回 null，由调用方**如实剔除并计数**，
 * 绝不猜一个区间出来。
 */
export function execWithSpans(
  pattern: string,
  variables: readonly string[],
  text: string,
  flags = '',
  from = 0,
): MatchSpans | null {
  let regex: RegExp
  try {
    regex = new RegExp(pattern, `${flags.replace(/[gd]/g, '')}gd`)
  } catch {
    return null
  }
  regex.lastIndex = Math.max(0, Math.min(from, text.length))
  const found = regex.exec(text)
  const indices = found?.indices
  if (!found || !indices) return null
  // 不写 `RegExpIndicesGroup` 这种类型名（TS 各版本叫法不同：`RegExpIndicesArray` / 具名元组），
  // 直接按"取到一个 `[start, end]` 或没有"来读，行为一样且不吃 lib 版本差异。
  const wholePair = indices[0]
  if (!wholePair) return null
  const whole: Span = { start: wholePair[0], end: wholePair[1], text: text.slice(wholePair[0], wholePair[1]) }
  const out: Record<string, Span | null> = {}
  variables.forEach((name, index) => {
    const pair = indices[index + 1]
    out[name] = pair ? { start: pair[0], end: pair[1], text: text.slice(pair[0], pair[1]) } : null
  })
  return { whole, variables: out }
}

/**
 * 一个区间是否**盖住**另一个（**含两端相等**）。
 *
 * 上游 `WithinPredicate.java:30` 调的是 `PsiTreeUtil.isAncestor(result.getMatch(), matchedNode, false)`，
 * 第三参 `strict=false` 的含义在 `platform/core-api/src/com/intellij/psi/util/PsiTreeUtil.java:89`
 * 看得最清楚：`PsiElement parent = strict ? element.getParent() : element;` —— 非严格时**自己也算**自己的
 * 祖先，所以范围命中与本次命中同一段时是**成立**的。本仓据此取"闭区间包含"，不减去相等那一种。
 */
function covers(outer: Span, inner: Span): boolean {
  return outer.start <= inner.start && inner.end <= outer.end
}

/** 一个子模板在某段文本里的全部命中（每个命中带整段区间与逐变量区间）。 */
interface SubMatches {
  regex: RegExp
  variables: readonly string[]
}

/** 在 `text` 上找 `sub` 的所有匹配，返回每次的整段与变量区间。 */
function matchesWithSpans(sub: SubMatches, text: string): { whole: Span; variables: Record<string, Span | null> }[] {
  const out: { whole: Span; variables: Record<string, Span | null> }[] = []
  sub.regex.lastIndex = 0
  let found: RegExpExecArray | null
  while ((found = sub.regex.exec(text)) !== null) {
    const indices = found.indices
    if (!indices || found[0].length === 0) {
      if (found[0].length === 0) sub.regex.lastIndex++
      continue
    }
    const pair = indices[0]
    if (!pair) continue
    const map: Record<string, Span | null> = {}
    sub.variables.forEach((name, index) => {
      const one = indices[index + 1]
      map[name] = one ? { start: one[0], end: one[1], text: text.slice(one[0], one[1]) } : null
    })
    out.push({ whole: { start: pair[0], end: pair[1], text: found[0] }, variables: map })
  }
  return out
}

/** 编译缓存：同一份子模板在一条结果列表上要复核几百次，每次重编正则是白给的开销。 */
const subCache = new Map<string, { sub: SubMatches; variables: readonly string[] } | { error: string }>()
const SUB_CACHE_LIMIT = 32

/** 编译一个子模板（`contains` / `within` 的参数）成正则 + 组表；失败回错误文案。 */
export function compileSubTemplate(
  template: string,
  flags = '',
): { sub: SubMatches; variables: readonly string[] } | { error: string } {
  // 大小写位会改变编出来的正则，所以缓存键必须带上 flags。
  const key = flags + ' ' + template
  const cached = subCache.get(key)
  if (cached) return cached
  const built = buildSubTemplate(template, flags)
  if (subCache.size >= SUB_CACHE_LIMIT) subCache.clear()
  subCache.set(key, built)
  return built
}

function buildSubTemplate(
  template: string,
  flags: string,
): { sub: SubMatches; variables: readonly string[] } | { error: string } {
  const compiled = compileStructuralPattern(template)
  if ('error' in compiled) return { error: `子模板编译失败：${compiled.error}` }
  try {
    // `g` 是为了枚举所有命中，`d` 是为了拿到每次命中的字符区间（与 `execWithSpans` 同一套标志）。
    return {
      sub: { regex: new RegExp(compiled.regex, `${flags.replace(/[gd]/g, '')}gd`), variables: compiled.variables },
      variables: compiled.variables,
    }
  } catch (error) {
    return { error: `子模板编译失败：${(error as Error).message}` }
  }
}

/**
 * 变量捕获段里是否含另一个子模板的命中（`contains`，`MatchVariableConstraint.java:52-53` 的等价物）。
 *
 * 子模板里的 `$v$` 若与外层同名，要求它在这一段里匹配到的文本**等于**外层这一命中里的值 ——
 * 与模板内部同名变量"必须匹配同一段文本"是同一条规则（`src/structuralSearch.ts` 里编译期用反向引用实现，
 * 跨两个正则没有反向引用可用，于是比捕获值）。外层没有这个名字时不作要求。
 */
export function containsHolds(
  subTemplate: string,
  segment: Span,
  outerValues: Readonly<Record<string, string | null>>,
  flags = '',
): { ok: boolean; error?: string } {
  const compiled = compileSubTemplate(subTemplate, flags)
  if ('error' in compiled) return { ok: false, error: compiled.error }
  for (const hit of matchesWithSpans(compiled.sub, segment.text)) {
    const consistent = compiled.sub.variables.every(name => {
      if (!(name in outerValues)) return true
      const inner = hit.variables[name]
      const outer = outerValues[name] ?? null
      return inner !== null && inner.text === outer
    })
    if (consistent) return { ok: true }
  }
  return { ok: false }
}

/** 「整个模板」那一档的匹配范围修饰符（上游 `within`，只允许写在 `__context__` 上）。 */
export interface TemplateScope {
  /** 范围子模板：整段命中必须落在它的某一次命中**之内**（闭区间包含，两端相等也算，见上面的 isAncestor 取证）。 */
  within: string
  /** `!within(...)`：落在范围子模板之外才算。上游 `PatternCompiler.java:537-539` 的 NotPredicate。 */
  invert: boolean
}

/**
 * 整段命中是否落在范围子模板的某一次命中之内（`within`，上游的"匹配范围"那一档）。
 *
 * 逐条照 `impl/matcher/predicates/WithinPredicate.java:27-35`：先对范围模式**另建一个 matcher**
 * （`:23` 的 `Matcher.buildMatcher(project, fileType, within)`），再要求它的某一次命中
 * 是本次命中节点的祖先 —— `:30` 传的是 `strict=false`，`PsiTreeUtil.java:89` 里非严格时自己也算，
 * 所以"范围命中与本次命中恰好同一段"在上游是**成立**的。本仓的范围与命中都在同一行文本上，
 * 于是"祖先后代"换成"字符区间闭包含"（相等也算）。
 */
export function withinHolds(
  scope: TemplateScope,
  text: string,
  whole: Span,
  flags = '',
): { ok: boolean; error?: string } {
  const compiled = compileSubTemplate(scope.within, flags)
  if ('error' in compiled) return { ok: false, error: compiled.error }
  const covered = matchesWithSpans(compiled.sub, text).some(hit => covers(hit.whole, whole))
  // 取反那一支（`PatternCompiler.java:537-539` 的 NotPredicate）= 没有任何一次范围命中盖住它。
  return { ok: scope.invert ? !covered : covered }
}

/** 命中行（宿主给的 path/line/column + 行文本）。 */
export interface HitRow {
  path: string
  line: number
  column: number
  text: string
}

export interface ModifierVerdict {
  keep: boolean
  /** 剔除它时说的是哪一档（面板据此解释"为什么这条没列出来"）。 */
  reason?: string
  /** JS 复核不上（宿主与 JS 判定不一致）：不算修饰符否决，单独计数。 */
  unverified?: boolean
}

/** 这一档命中要不要做跨度复核（没有任何跨度修饰符时不必，省一次正则）。 */
export function needsSpanCheck(pattern: StructuralPattern, scope: TemplateScope | null): boolean {
  if (scope) return true
  for (const constraint of pattern.constraints.values()) if (constraint.contains) return true
  return false
}

/**
 * 逐条命中复核：先按每个变量的 `contains`（变量档），再按整模板的 `within`（匹配范围档）。
 *
 * 求值用的正则与宿主那次扫描**同一份编译产物**（`pattern.regex`），起点用宿主给的列号
 * （`column` 是 0 基；不是 0 基时由调用方换算），所以判定与替换看到的是同一段文本。
 */
export function verdictForHit(
  pattern: StructuralPattern,
  scope: TemplateScope | null,
  hit: HitRow,
  flags = '',
  from = 0,
): ModifierVerdict {
  const spans = execWithSpans(pattern.regex, pattern.variables, hit.text, flags, from)
  if (!spans) return { keep: false, unverified: true, reason: '本仓的 JS 复核在那一行配不上这段命中（宿主与 JS 的正则文法差异），已剔除而不是当作通过。' }
  const values: Record<string, string | null> = {}
  for (const [name, span] of Object.entries(spans.variables)) values[name] = span?.text ?? null
  for (const name of pattern.variables) {
    const constraint = pattern.constraints.get(name)
    if (!constraint || !constraint.contains) continue
    const segment = spans.variables[name]
    if (!segment) continue
    const held = containsHolds(constraint.contains, segment, values, flags)
    if (held.error) return { keep: false, reason: held.error }
    const pass = constraint.invertContains ? !held.ok : held.ok
    if (!pass) {
      return { keep: false, reason: `$${name}$ 的「包含」修饰符不成立（捕获段是 \`${segment.text}\`）。` }
    }
  }
  if (scope) {
    const held = withinHolds(scope, hit.text, spans.whole, flags)
    if (held.error) return { keep: false, reason: held.error }
    if (!held.ok) {
      return { keep: false, reason: scope.invert
        ? `整段命中落在「匹配范围」之内，而这一档写的是取反范围。`
        : `整段命中不在「匹配范围」子模板 \`${scope.within}\` 的里面。` }
    }
  }
  return { keep: true }
}

/**
 * 跨度修饰符的**编译期体检**：把每个变量的 `contains` 子模板与整模板的 `within` 子模板各编一遍，
 * 编不动就报错。上游没有这一步（`contains` 那一支是死代码，`within` 在建 matcher 时才试错，
 * `WithinPredicate.java:23`），但本仓要真的拿它们筛结果，所以坏子模板必须在**发请求之前**挡住 ——
 * 否则每条命中都会被"复核不上"剔掉，用户看到的是"0 命中"，而真实原因是子模板写坏了。
 */
export function checkTemplateModifiers(
  pattern: StructuralPattern,
  scope: TemplateScope | null,
  flags = '',
): string[] {
  const errors: string[] = []
  for (const name of pattern.variables) {
    const constraint = pattern.constraints.get(name)
    if (!constraint || !constraint.contains) continue
    const compiled = compileSubTemplate(constraint.contains, flags)
    if ('error' in compiled) errors.push(`\`$${name}$\` 的包含条件：${compiled.error}`)
  }
  if (scope && scope.within.trim()) {
    const compiled = compileSubTemplate(scope.within, flags)
    if ('error' in compiled) errors.push(`匹配范围：${compiled.error}`)
  }
  return errors
}

export interface ModifierFilterResult<T> {
  kept: T[]
  /** 被修饰符否决的那些（面板不显示，但报告/测试要能数得出来）。 */
  rejected: { hit: T; reason: string }[]
  /** 复核不上的那些：与"否决"分开计，免得把文法差异说成"修饰符没通过"。 */
  unverified: T[]
}

/** 一批命中的跨度复核（`filterHitsByModifiers(rows, …)` 给结果面板用）。 */
export function filterHitsByModifiers<T>(
  pattern: StructuralPattern,
  scope: TemplateScope | null,
  rows: readonly T[],
  flags = '',
  // 面板上的行形状是 `SearchMatch`（行文本在 `preview` 字段，`src/bridge.ts:184`），不是这里的 `HitRow`。
  // 给一个取值器把两者接起来，**返回的仍是调用方原来那些对象**（不丢 before/after/length 那几个字段）。
  // 不传取值器时按"行本身就是 HitRow"处理（单测与内部调用走这一条）。
  read: (row: T) => HitRow = row => row as unknown as HitRow,
): ModifierFilterResult<T> {
  const kept: T[] = []
  const rejected: { hit: T; reason: string }[] = []
  const unverified: T[] = []
  for (const row of rows) {
    const hit = read(row)
    // 起点固定 0：宿主给的是「行 + 行内首处命中的列」，而本仓的复核口径与
    // `src/structuralSearchResults.ts` 的 `variableValues` 一致（在同一行文本上重跑同一条正则取第一处），
    // 两处用同一个起点才不会出现"预览里有值、筛选时被剔掉"的分裂。
    const verdict = verdictForHit(pattern, scope, hit, flags)
    if (verdict.keep) kept.push(row)
    else if (verdict.unverified) unverified.push(row)
    else rejected.push({ hit: row, reason: verdict.reason ?? '' })
  }
  return { kept, rejected, unverified }
}

/**
 * 「整个模板」那一档的摘要行（照上游 `FilterPanel` 左侧树顶那行 + `text.0.label=Text={0}`
 * 的形状，`SSRBundle.properties:78`）。取反前缀 `!` 与 `PatternCompiler.java:537-539` 同一口径。
 */
export function scopeSummary(scope: TemplateScope | null): string {
  if (!scope || !scope.within.trim()) return ''
  return `Within=${scope.invert ? '!' : ''}${scope.within}`
}

/** 变量档的跨度摘要（`Contains=` 那一行；上游没有这一档的 UI 动作，见 filters.ts 的同名注释）。 */
export function containsSummaryOf(c: VariableConstraint): string {
  if (c.contains === null) return ''
  return `Contains=${c.invertContains ? '!' : ''}${c.contains}`
}

/**
 * 上游 `MatchOptions` 的范围档（`MatchOptions.java:34-36` 的 `scope`/`scopeType`/`scopeDescriptor`，
 * 类型枚举 `Scopes.java:112-116`）在本仓的登记表：本仓的搜索范围下拉走
 * `src/findScopeSelection.ts` + `src/structuralSearchFilters.ts` 那条既有通道，
 * 这里只把"上游有哪四档、默认是哪一档"写死成数据，供面板文案与判据用。
 */
export const SCOPE_TYPES = [
  { id: 'PROJECT', label: '项目', upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/Scopes.java:113' },
  { id: 'MODULE', label: '模块', upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/Scopes.java:114' },
  { id: 'DIRECTORY', label: '目录', upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/Scopes.java:115' },
  { id: 'NAMED', label: '命名作用域', upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/Scopes.java:116' },
] as const

/** 默认档：上游 `Scopes.Type.PROJECT`（`Scopes.java:113`，`MatchOptions.scopeType` 无显式初值 = null，
 *  由 `initScope` 落到项目作用域，`MatchOptions.java:86-90`）。 */
export const DEFAULT_SCOPE_TYPE = 'PROJECT'

// ── 面板级的**开关档**（上游 `MatchOptions` 那几个 boolean 位 + 变量档的两个位）────────────
//
// 这一节承接的是任务里点名的 `wholeWords`/`caseSensitive`/`regex`/`invertCondition`/`substitueInComments`
// 一族"还没落的开关"。**先给取证结论**（三条路都走过：按文件名、按包路径、按语义）：
//   · `MatcherModifiers`、`ModifierSupport`（作为类型）、`InvertModifier`、`SubtreeModifier`
//     与目录 `plugins/ssad/` 在基准树里**都不存在**（`find -iname '*modifier*'` 在
//     `platform/structuralsearch/` 下零命中；`grep -rn "MatcherModifiers|InvertModifier|SubtreeModifier"`
//     全树零命中；`find plugins/ssad` 报 No such file）。⇒ 这几个名字**无法核实**。
//   · 基准树里真实存在的"开关枚举"就是下面这张表逐条抄的那几处：`MatchOptions` 的四个 boolean 位
//     （`platform/structuralsearch/source/com/intellij/structuralsearch/MatchOptions.java:28-37`）
//     加变量档的 `wholeWordsOnly`（`MatchVariableConstraint.java:33`）与 `invertRegExp`
//     （`:202-208`，条件文本里的 `!` 前缀 `StringToConstraintsTransformer.java:397`→`:426`）。
//   · `substitueInComments` 这个名字同样**无法核实**；树里最接近的是**索引优化**用的
//     `addWordToSearchInComments`/`addWordToSearchInLiterals`
//     （`impl/matcher/compiler/OptimizingSearchHelper.java:20,22`、写入点
//     `impl/matcher/compiler/GlobalCompilingVisitor.java:234,237`）—— 那是"这个单词要不要进
//     注释/字面量的倒排索引"，不是用户能勾的档，档位本身在
//     `OptimizingSearchHelperBase.java:42-51`。注释/字面量的判定由**各语言 profile**给出
//     （Java 那一侧是 `java/structuralsearch-java/src/com/intellij/structuralsearch/impl/matcher/filters/CommentFilter.java`），
//     所以这一档在本仓没有落点，登记在下表 `support:'none'` 那一支，不画控件。
//
// **本仓用什么承接了什么**：
//   · `caseSensitive` → 一条口径：`matcherFlags()` 决定复核与预览用的正则标志位，
//     与上游 `RegExpPredicate.java:58` 的 `caseSensitive ? 0 : Pattern.CASE_INSENSITIVE` 同一个方向；
//   · `wholeWords` → **整模板档的全词**，落到每个变量的 `wholeWordsOnly`
//     （上游"整模板"那一行本来就是把修饰符写给全部变量，`FilterPanel.java:291,339` 的
//     `filters.for.whole.template.title` 那一行 + `FilterTable.java:22-25` 的 `getMatchVariable()`），
//     生效点在 `compileStructuralPattern(template, switches)`，形状照
//     `RegExpPredicate.java:54-56` 的 `.*?\b(?:R)\b.*?`（两端词边界）；
//   · `regex`（"这段文本按正则解释"）→ 上游**没有这一位**（`MatchOptions.java:28-40` 的全部字段里没有），
//     模板是编译成 matcher 的（`impl/matcher/compiler/PatternCompiler.java`）；本仓必须显式告诉宿主
//     `regex:true`（`src/components/SearchPanel.vue` 的 `params()`），所以这一档登记成 `implicit`：
//     有生效点、没有用户开关，**不给它画复选框**；
//   · `invertCondition` → 上游的写法是在条件文本前面打 `!`（`TextFilter.java:134,142-144` 读写
//     `invertRegExp`；`FilterPanel` 侧的 `invert.filter=Invert modifier` 文案在
//     `resources/messages/SSRBundle.properties:102`），求值时包成 `NotPredicate`
//     （`PatternCompiler.java:488-490`）。本仓的等价物是 `toggleInvert()` + 条件后缀里的 `!`
//     （`src/structuralSearchFilters.ts` 的 `conditionSuffix`）。

/** 开关档的支持程度：复选框有真实生效点 / 只有编译期隐含口径 / 没有落点。 */
export type SwitchSupport = 'effective' | 'implicit' | 'none'

export interface MatcherSwitch {
  /** 面板与配置里用的键名（`src/structuralSearchConfigs.ts` 的 `StructuralSearchConfig` 同名字段）。 */
  id: string
  label: string
  level: ModifierLevel
  /** 上游的默认值（不是"我们想要"的值）：逐条看构造器 `MatchOptions.java:58-63` 里谁被赋值。 */
  defaultValue: boolean
  support: SwitchSupport
  /** 上游「相对路径:行号」。 */
  upstream: string
  /** support 为 effective/implicit 时写清本仓的生效点在哪个函数。 */
  landing?: string
  /** support 为 none 时的具体卡点。 */
  reason?: string
}

export const MATCHER_SWITCHES: readonly MatcherSwitch[] = [
  {
    id: 'caseSensitive', label: '区分大小写', level: 'template', defaultValue: false, support: 'effective',
    upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/MatchOptions.java:30,121-127',
    landing: 'matcherFlags() —— 面板的复核、匹配范围与替换预览都从这一处取标志位',
  },
  {
    id: 'wholeWords', label: '全词', level: 'template', defaultValue: false, support: 'effective',
    upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/MatchVariableConstraint.java:33,312-318',
    landing: 'compileStructuralPattern(template, switches) —— 写进每个变量的 wholeWordsOnly',
  },
  {
    id: 'regex', label: '正则解释', level: 'template', defaultValue: false, support: 'implicit',
    upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/MatchOptions.java:28-40',
    landing: 'src/components/SearchPanel.vue 的 params()：结构化模式发给宿主的 query 必然是正则',
  },
  {
    id: 'looseMatching', label: '忽略空白', level: 'template', defaultValue: true, support: 'implicit',
    upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/MatchOptions.java:28,60,147-153',
    landing: 'compileStructuralPattern 的空白规则（emitLiteralSegment）：模板里的空白不参与比对',
  },
  {
    id: 'invertCondition', label: '取反修饰符', level: 'variable', defaultValue: false, support: 'effective',
    upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/predicates/RegExpPredicate.java:54-56',
    landing: 'toggleInvert() + src/structuralSearchFilters.ts 的 conditionSuffix（条件文本前的 `!`）',
  },
  {
    id: 'recursiveSearch', label: '递归匹配', level: 'template', defaultValue: false, support: 'none',
    upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/handlers/TopLevelMatchingHandler.java:26',
    reason: '判的是"这一层没匹配上要不要往子节点里再钻一层"，作用在语法树的遍历上；本仓的候选行由宿主按整行正则给出，没有节点层级可钻。',
  },
  {
    id: 'searchInjectedCode', label: '搜索注入片段', level: 'template', defaultValue: true, support: 'none',
    upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/CompileContext.java:34',
    reason: '要语言注入（host file 里的 SQL/JS 片段）模型：上游在这里换成只搜注入片段的 scope，本仓的搜索面只有宿主给的整行文本。',
  },
  {
    id: 'withinHierarchy', label: '类型层次内', level: 'variable', defaultValue: false, support: 'none',
    upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/PatternCompiler.java:472,476',
    reason: '`*` 前缀（`StringToConstraintsTransformer.java:256-257`、`:420-423`）把条件改成"沿父类层次找"，要类型系统；文本层没有类型层次可走。',
  },
  {
    id: 'substituteInComments', label: '注释内的替换', level: 'template', defaultValue: false, support: 'none',
    upstream: 'platform/structuralsearch/source/com/intellij/structuralsearch/impl/matcher/compiler/GlobalCompilingVisitor.java:234,237',
    reason: '上游那两个调用（`OptimizingSearchHelper.java:20,22`）喂的是**倒排索引**的单词表，注释/字面量的词法边界由各语言 profile 给（Java 是 `java/structuralsearch-java/src/com/intellij/structuralsearch/impl/matcher/filters/CommentFilter.java`）；本仓的结构化搜索不分语言、没有注释词法，所以既不能"只在注释里搜"也不能"替换时避开注释"。名字本身（`substitueInComments`）在基准树里按文件名/包路径/语义三条路都搜不到 ⇒ 无法核实。',
  },
]

/**
 * 「真的有生效点的档」不单独出列表：那些档的控件就是面板上现有的按钮与复选框本身，
 * 再列一遍就是重复控件（判据测试直接核 `MATCHER_SWITCHES` 的 `support` 字段）。
 * 这里只留面板底部那行要用的「没有落点的档」。
 */

/**
 * 没有落点的档（`support:'none'`）：面板只在底部那行说明里点名，不画控件。
 * 与 `src/structuralSearchFilters.ts` 的 `UNAVAILABLE_FILTERS` 同一口径，
 * 由 `src/components/StructuralSearchFilters.vue` 一并列出。
 */
export function unavailableSwitches(): MatcherSwitch[] {
  return MATCHER_SWITCHES.filter(item => item.support === 'none')
}

/** 上游的默认档（`MatchOptions.java:58-63` 的构造器只给 looseMatching/searchInjectedCode/pattern 赋过值，
 *  其余 boolean 就是 Java 的 `false`）。面板的初始值从这里取，免得两边的默认走偏。 */
export function defaultMatcherSwitches(): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const item of MATCHER_SWITCHES) out[item.id] = item.defaultValue
  return out
}

/** 面板传下来的两个真的有生效点的开关。 */
export interface MatcherSwitchState {
  caseSensitive: boolean
  wholeWords: boolean
}

/**
 * 复核/预览用的正则标志位（上游同一条方向：`RegExpPredicate.java:58` 的
 * `caseSensitive ? 0 : Pattern.CASE_INSENSITIVE`，默认档 `caseSensitiveMatch = false` ⇒ 不分大小写）。
 *
 * 这里只给 `i`，不给 `g`/`d`：调用方按各自用途自己加（`execWithSpans` 会补 `gd`）。
 */
export function matcherFlags(state: MatcherSwitchState): string {
  return state.caseSensitive ? '' : 'i'
}

/** 编译期的开关快照（`src/structuralSearch.ts` 的 `compileStructuralPattern` 收这一个对象）。 */
export function compileSwitches(state: MatcherSwitchState): { wholeWords: boolean } {
  return { wholeWords: state.wholeWords }
}

