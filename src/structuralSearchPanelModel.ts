// 结构化搜索**面板侧的装配模型**（上游 `plugin/ui/StructuralSearchDialog.java` 里"编译模板 →
// 校验 → 发查询 → 收敛结果"那一条主线在文本层的等价物；组件只做接线，规则都在本文件）。
//
// 上游那一条线是：`StructuralSearchDialog` 把用户输入交给 `SearchCommand`
// （`plugin/ui/SearchCommand.java`）→ `PatternCompiler`（`impl/matcher/compiler/PatternCompiler.java`）
// 编成 `CompiledPattern` → `Replacer`/`Matcher` 跑 → `MatchResultSink` 收
// （`plugin/util/DuplicateFilteringResultSink.java`）。本仓对应：
//   · 编译 = `compileStructuralPattern`（src/structuralSearch.ts）
//   · 校验 = 模板语法错 + 跨度修饰符的子模板体检（`checkTemplateModifiers`，src/structuralSearchModifiers.ts）
//     + 替换定义指向真实变量（`checkDefinitions`，src/structuralSearchReplace.ts）
//   · 跑 = 原生 `search.run`/`search.preview`（native/search.cpp），本文件只负责它**回来之后**的那一段
//   · 收 = `dedupeMatches`（src/structuralSearchResults.ts，`DuplicateFilteringResultSink` 的等价物）
//     + `filterHitsByModifiers`（跨度修饰符、匹配范围与列表变量「整段」的命中后复核）
//
// 为什么需要"命中后再复核"这一层：宿主只会按 `std::regex` 报"这一行有匹配"，
// 而 `contains` / `within` 判的是**这一段之内**还有没有另一个结构，正则文法表达不了
// （`native/search.cpp:256` 用的是 ECMAScript 文法）；列表变量的「这一段是不是同一个列表的全部」
// 判的是**这一段之外**同层还有一个逗号没有，那要算括号深度，而且宿主那一侧连后顾断言都编不出来
// （实测 `(?<=…)`/`(?<!…)` 抛 `regex_error`，见 `src/structuralCodeBlock.ts` 头部）。
// 所以本仓的等价物是：宿主给候选行 → 本文件在同一批行文本上用**同一份编译产物**复核。
// 复核不上的那些（JS 与 std::regex 判定不一致）单独计数并明说，不混进"修饰符否决"。

import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { compileStructuralPattern, compileStructuralReplacement, type StructuralPattern } from './structuralSearch.ts'
// 替换串的先验校验 = 上游 `RegExReplacementBuilder.validate`（`platform/lang-impl/src/com/intellij/find/impl/RegExReplacementBuilder.java:76-78`），
// 按下替换按钮时跑（`platform/lang-impl/src/com/intellij/find/impl/FindPopupPanel.java:1548`）。
import { captureGroupCount, validateReplacement } from './regexReplacement.ts'
// 模板合法性（词法级）—— 上游 `PatternCompiler.compile` 在**语法树那一侧**抛 `MalformedPatternException`
// （`platform/structuralsearch/source/.../impl/matcher/compiler/PatternCompiler.java:75-81,137`）；
// 本仓没有 PSI，只能代理成词法层（括号配对/引号/块注释），对应上游同样会报错的那一档。
// 接线顺序：先合语法/词法（这一条）→ 语义修饰符 → 替换串，与上游"先 parse 再 bind"一致。
import { checkTemplateValidity } from './structuralSearchValidity.ts'
import {
  checkTemplateModifiers, compileSwitches, filterHitsByModifiers, matcherFlags, needsSpanCheck,
  scopeSummary, type TemplateScope,
} from './structuralSearchModifiers.ts'
import { dedupeMatches, variableValues } from './structuralSearchResults.ts'
import {
  checkDefinitions, compileStructuralReplacementWithDefinitions, previewMany, replacementSummary,
  type ReplacementDefinition,
} from './structuralSearchReplace.ts'

export interface StructuralSearchModelInput {
  /** 面板的「结构化模板」开关（`$` 按钮）。 */
  enabled: Ref<boolean>
  /** 搜索框里的模板原文。 */
  template: Ref<string>
  /** 替换框里的原文。 */
  replacement: Ref<string>
  /** 面板的「区分大小写」——复核时必须跟宿主用同一套标志，否则会假剔除。 */
  caseSensitive: Ref<boolean>
  /**
   * 面板的「全词」。结构化模式下它**不是**被忽略的那一个：它作为整模板档的修饰符
   * 写进每个变量的 `wholeWordsOnly`（上游"Modifiers for the whole template"那一行的作用方式，
   * `plugin/ui/filters/FilterPanel.java:291,339` + `FilterTable.java:22-25`），
   * 生效点在 `compileStructuralPattern` 的第二参数。宿主那一侧的 `wholeWord` 保持关，
   * 免得把同一件事做两遍（`\b` 套两次会把 `get$x$` 这类模板误杀）。
   */
  wholeWord?: Ref<boolean>
  /** 逐变量替换定义（上游 `ReplaceOptions` 的那张表，本仓的定义值是文本）。 */
  definitions?: Ref<ReplacementDefinition[]>
  /**
   * 面板的「正则表达式」档 = 上游 `FindModel.isRegularExpressions()`。它只决定一件事：
   * **替换串要不要按 `$n` 模板校验**。上游那一整块校验（空匹配检查 + `RegExReplacementBuilder.validate`）
   * 整块挂在 `getValidationInfo` 的这个分支里
   * （`platform/lang-impl/src/com/intellij/find/impl/FindPopupPanel.java:1520`，校验点 `:1547-1552`），
   * 非正则档里替换串的 `$1` 是**字面文本**（`FindManagerBase.getStringToReplace:284-298` 只在正则档展开），
   * 拿模板规则去校验它反而会把能用的替换串挡掉。宿主那一侧同一口径
   * （`native/search.cpp` 的 `make_template_context`：非正则档直接返回不展开的上下文）。
   *
   * 结构化模式不靠这个入参：模板编译产物本来就是正则，面板那条通道以 `regex:true` 发出去
   * （见 `SearchPanel.params()`），所以模型自己按「编译成功」判定同一档。
   */
  regexMode?: Ref<boolean>
}

export interface StructuralSearchModel {
  /** 编译产物；模式关着或编译失败时为 null。 */
  compiled: ComputedRef<StructuralPattern | null>
  /** 一行都读不出去的错（模板语法 / 子模板 / 定义表），面板据此**拒绝发请求**。 */
  error: ComputedRef<string>
  /** 发给宿主的 query（模板模式 = 编译出来的正则）。 */
  activeQuery: ComputedRef<string>
  /** 发给宿主的 replacement（模板模式 = `$N` 回填，定义文本已折进去）。 */
  activeReplacement: ComputedRef<string>
  /**
   * 按下替换时的那道「替换串本身畸形」门（'' = 放行），上游把它做成挂在**替换字段**上的
   * `ValidationInfo`：`FindPopupPanel.java:1547-1552` 跑 `RegExReplacementBuilder.validate(pattern,
   * getStringToReplace())`，抛 ⇒ `find.replace.invalid.replacement.string`
   * （`platform/analysis-impl/resources/messages/FindBundle.properties:96`「Malformed replacement
   * string: {0}」，宿主 `native/search.cpp` 的 `validate_replacement` 用的是同一句文案）。
   * 两道前置门也照上游：`isRegularExpressions()`（`:1520`）与 `isReplaceState()`（`:1533`，
   * 替换框为空时整块不走 ⇒ 空替换串一律放行，它是「删掉命中」而不是模板）。
   * 查的是**真正发出去**的那串（结构化模式下已折成 `$N`），因为被宿主展开的就是它。
   */
  replaceGuard: ComputedRef<string>
  /** 「整个模板」那一档的匹配范围（上游 `within`，只允许写在整模板上）。 */
  scope: Ref<TemplateScope | null>
  /**
   * 逐变量替换定义（上游 `ReplaceOptions.variableDefs`，`plugin/replace/ReplaceOptions.java:25`）。
   * 表由模型持有：面板只负责读写它，`reset()` 时清空，不会出现"换了模板但定义表还留着"。
   */
  definitions: Ref<ReplacementDefinition[]>
  /** 复核之后的口径说明（被否决/复核不上各多少条 + 替换预览的计数），面板写在状态行。 */
  note: ComputedRef<string>
  /** 替换预览的计数（`refine()` 之后才有值；替换框为空时是 null）。 */
  pending: ComputedRef<{ hits: number; files: number; willChange: number; unchanged: number; unverifiable: number } | null>
  /** 结果收敛：去重 + 跨度修饰符/匹配范围复核。返回的是调用方原来那批对象（字段不丢）。 */
  refine: <T extends StructuralKey>(rows: readonly T[], read?: (row: T) => StructuralRow) => T[]
  /** 某一行里每个变量各自匹配到了什么（上游 `MatchResult` 的变量值面）。 */
  valuesOf: (text: string) => Record<string, string | null> | null
}

/** 复核要看的四个字段（与 `filterHitsByModifiers` 的 `HitRow` 同形）。 */
export interface StructuralRow {
  path: string
  line: number
  column: number
  text: string
}

/** 去重要看的三个字段；面板的 `SearchMatch`（`src/bridge.ts:184`，行文本在 `preview`）天然满足。 */
export interface StructuralKey {
  path: string
  line: number
  column: number
}

/**
 * 建一个面板装配模型。所有派生量都是 computed：模板改一个字符，
 * 编译、校验、替换串、状态行会一起更新，不会出现"改了模板但替换串还是上一次的"。
 */
export function createStructuralSearchModel(input: StructuralSearchModelInput): StructuralSearchModel {
  const scope = ref<TemplateScope | null>(null)
  /** 没传进来时由模型自己持有这张表（面板用 `structuralModel.definitions` 直接读写）。 */
  const definitions = input.definitions ?? ref<ReplacementDefinition[]>([])
  /** 最近一次 refine 的两种剔除计数（上游把这两者混在 progress 里，本仓分开说）。 */
  const dropped = ref(0)
  const unverified = ref(0)
  /** 替换预览的五个计数（null = 替换框为空或定义表折不动，此时状态行不出这一句）。 */
  const pendingCounts = ref<{
    hits: number; files: number; willChange: number; unchanged: number; unverifiable: number
  } | null>(null)
  /** 两个真的有生效点的面板开关（`MATCHER_SWITCHES` 里 `support:'effective'` 的那几档）。 */
  const switches = computed(() => ({
    caseSensitive: input.caseSensitive.value,
    wholeWords: input.wholeWord?.value === true,
  }))
  const flags = computed(() => matcherFlags(switches.value))
  /** 唯一的编译入口：模板 + 开关 ⇒ 产物。两处（compiled 与 error）必须走同一个口径。 */
  function compileTemplate(): StructuralPattern | { error: string } {
    const validity = checkTemplateValidity(input.template.value)
    if (!validity.ok) return { error: validity.error }
    return compileStructuralPattern(input.template.value, compileSwitches(switches.value))
  }

  const compiled = computed<StructuralPattern | null>(() => {
    if (!input.enabled.value) return null
    const result = compileTemplate()
    return 'error' in result ? null : result
  })

  const error = computed<string>(() => {
    if (!input.enabled.value) return ''
    const direct = compileTemplate()
    if ('error' in direct) return direct.error
    const modifierErrors = checkTemplateModifiers(direct, scope.value, flags.value)
    if (modifierErrors.length) return modifierErrors[0]
    if (!definitions.value.length) return ''
    const folded = compileStructuralReplacementWithDefinitions(input.replacement.value, direct.variables, definitions.value)
    if ('error' in folded) return folded.error
    return checkDefinitions(direct, definitions.value)[0] ?? ''
  })

  const activeQuery = computed(() => (compiled.value ? compiled.value.regex : input.template.value))

  const activeReplacement = computed(() => {
    const pattern = compiled.value
    if (!pattern) return input.replacement.value
    // 没有定义表时走的还是原来那条 `$Var$ → $N` 的路（**一字不变**，免得接线把既有替换改坏）。
    if (!definitions.value.length) return compileStructuralReplacement(input.replacement.value, pattern.variables)
    const folded = compileStructuralReplacementWithDefinitions(input.replacement.value, pattern.variables, definitions.value)
    return 'error' in folded ? input.replacement.value : folded.replacement
  })

  /**
   * 发出去的 query 到底按不按正则解释 —— 上游 `model.isRegularExpressions()`（`FindPopupPanel.java:1520`）
   * 在本仓的等价条件：面板的「正则」档开着，**或**结构化模板编译成功
   * （编译产物就是正则，面板以 `regex:true` 发给宿主）。编不动时不算：那条路径上拒绝的是
   * `error`（模板本身），再冒出一句"替换串畸形"会把用户引到错的那一半。
   */
  const isRegexChannel = computed(() => input.regexMode?.value === true || compiled.value !== null)

  /**
   * 当前 query 的捕获组数 = 上游 `pattern.matcher("").groupCount()`（`RegExReplacementBuilder.java:63-66`）。
   * query 自己都编不出来时给 null：那是宿主在搜索阶段报的错（`find.invalid.regular.expression.error`，
   * `FindPopupPanel.java:1529-1531`），这里不拿"组数 0"去误判替换串。
   */
  const patternGroups = computed<number | null>(() => {
    const source = activeQuery.value
    if (!source) return null
    try { new RegExp(source) } catch { return null }
    return captureGroupCount(source)
  })

  const replaceGuard = computed<string>(() => {
    // 上游 `:1533` 的 `isReplaceState()`：替换框为空时那一整块校验都不走 —— 空替换串是「删掉命中」，不是模板。
    const outgoing = activeReplacement.value
    const groups = patternGroups.value
    if (!outgoing || groups === null || !isRegexChannel.value) return ''
    const bad = validateReplacement(outgoing, groups)
    // 文案与宿主同一句（`native/search.cpp` 的 `validate_replacement` ⇒ `INVALID_REQUEST`），
    // 面板只是**提前**在同一批规则上拒绝，不让半批文件先被改写。
    return bad ? `替换字符串格式非法：${bad}` : ''
  })

  const note = computed(() => {
    const parts: string[] = []
    // 先说挂着哪个**修饰符**（上游 `FilterPanel` 树顶那行的等价物：整模板档只列修饰符，
    // 大小写/全词那两个按钮的状态由按钮自己亮着，不在这里重复一遍），
    // 再说"因此剔掉了多少"——顺序反了用户会以为计数是模板本身的问题。
    if (input.enabled.value) {
      const scopeText = scopeSummary(scope.value)
      if (scopeText) parts.push(scopeText)
    }
    if (dropped.value) parts.push(`${dropped.value} 处不满足修饰符/匹配范围/列表整段，已剔除`)
    if (unverified.value) parts.push(`${unverified.value} 处本仓复核不上（宿主与 JS 的正则文法差异），一并剔除`)
    const counts = pendingCounts.value
    if (counts) {
      parts.push(replacementSummary(counts.hits, counts.files, counts.willChange))
      if (counts.unchanged) parts.push(`${counts.unchanged} 处替换前后一样（定义写回了原文），不会真改`)
      if (counts.unverifiable) parts.push(`${counts.unverifiable} 处本仓算不出替换后的样子`)
    }
    return parts.join(' · ')
  })

  function refine<T extends StructuralKey>(rows: readonly T[], read?: (row: T) => StructuralRow): T[] {
    const pattern = compiled.value
    const unique = dedupeMatches(rows)
    // 行文本从调用方给的地方取（面板是 `preview` 字段）；不给就按"行本身已经带 `text`"处理。
    const textOf = read ?? ((row: T) => row as unknown as StructuralRow)
    if (!pattern || !needsSpanCheck(pattern, scope.value)) {
      dropped.value = 0
      unverified.value = 0
      countPending(unique.map(textOf))
      return unique
    }
    const checked = filterHitsByModifiers(pattern, scope.value, unique, flags.value, textOf)
    dropped.value = checked.rejected.length
    unverified.value = checked.unverified.length
    countPending(checked.kept.map(textOf))
    return checked.kept
  }

  /**
   * 替换预览的计数（上游 `found.progress.message=Found {0} matches`，`SSRBundle.properties:48` 那一行
   * 在本仓的形状 = `replacementSummary`）：**只有替换框里有内容时才统计**，否则状态行会凭空多一句。
   *
   * `unchanged` = 定义把变量换回了它自己的原文，那一处前后一样（上游 `Replacer.insertSubstitution`
   * 的"空文本不插"那一支的同族判定，`Replacer.java:70-76`）；`unverifiable` = 本仓的 JS 复核在那一行
   * 配不出区间（宿主与 std::regex 的文法差异）。两者都要跟"真的会改的处数"分开说，
   * 否则用户看到 N 处会把"其实一处都不改"当成替换失败。
   */
  function countPending(rows: readonly StructuralRow[]): void {
    const pattern = compiled.value
    const text = input.replacement.value
    if (!pattern || !text) {
      pendingCounts.value = null
      return
    }
    const folded = compileStructuralReplacementWithDefinitions(text, pattern.variables, definitions.value)
    if ('error' in folded) {
      pendingCounts.value = null
      return
    }
    const checked = previewMany(pattern, rows, folded.replacement, new Map(), flags.value)
    pendingCounts.value = {
      hits: rows.length,
      files: new Set(rows.map(row => row.path)).size,
      willChange: rows.length - checked.unchanged - checked.unverifiable,
      unchanged: checked.unchanged,
      unverifiable: checked.unverifiable,
    }
  }

  function valuesOf(text: string): Record<string, string | null> | null {
    const pattern = compiled.value
    if (!pattern) return null
    return variableValues(pattern.regex, pattern.variables, text, flags.value)
  }

  return {
    compiled, error, activeQuery, activeReplacement, replaceGuard, scope, definitions, note,
    pending: computed(() => pendingCounts.value),
    refine, valuesOf,
  }
}
