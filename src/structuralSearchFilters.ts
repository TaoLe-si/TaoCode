// 结构化搜索的**变量修饰符**编辑模型（上游 `platform/structuralsearch/source/com/intellij/
// structuralsearch/plugin/ui/filters/` 一族）。
//
// 上游那是一整棵 Swing 面板：`FilterPanel.java` + `FilterTable.java` 列出「整个模板」与
// 模板里的每个变量，右侧是「添加修饰符」的动作列表，动作由
// `DefaultFilterProvider.java:13` 给出 —— 五个：`Context`、`Count`、`Reference`、`Text`、
// `Type`（`ScriptFilter` 类存在（`SSRBundle.properties:62` `script.filter.name=Script`）但
// **不在默认提供器里**）。每个动作把约束读成人话摘要（`getShortText`）并弹一个编辑器
// （`FilterEditor.java`）。
//
// 本模块只做**文本层真的能兑现**的两档，并且只做模型（渲染在
// `src/components/StructuralSearchFilters.vue`）：
//   · **计数**（`CountFilter.java:23-176`）—— 编辑 `minOccurs`/`maxOccurs`
//     （`:70-71` 从两个复选框/数字框写进约束，`:176-177`），摘要形状照
//     `CountFilter.java:92`（`count.label=Count={0}`，`{0}` 是 `[min,max]`，
//     无界写作 `∞`，见 `:42`）与 `:94` 的那句「默认值」（`default.label`）。
//   · **文本**（`TextFilter.java:26-130`）—— 编辑 regExp / invertRegExp / wholeWordsOnly
//     （`:62-64` clearFilter 恰好清这三项），摘要照 `:82-85`：
//     `Text=` + （取反时前缀 `!`）+ 正则，再按 `wholeWordsOnly` 追加 `, whole words`。
//     `within hierarchy` 那一档要 PSI 类型层次，本档不做（见下 UNAVAILABLE_FILTERS）。
//
// **不渲染**的四档（宁可不画也不放假控件）：
//   · `Reference`（`ReferenceFilter.java`）与 `Type`（`TypeFilter.java`）—— 比的是**引用到的
//     元素**与**表达式的类型**，两者都要语法树 + 解析器；
//   · `Context`（`ContextFilter.java`）—— 上游用它限定「变量只能出现在某种语法上下文里」，
//     同样是 PSI 判定；
//   · `Script`（`ScriptFilter.java` + `StructuralSearchScriptEngine`）—— Groovy 脚本宿主，
//     本仓没有脚本引擎，也不会为了这一档去 eval 用户模板。
// 这四档只在面板底部以一行说明文字出现（说明"为什么这里没有它们"），不是可以点的控件。
//
// 文案取官方中文包（`localization-zh` 的 `messages/SSRBundle.properties`）：
// 计数 `:18-19`、`default.label` `:21`、文本 `:276`、`，全字` 见 `text.tooltip.message` `:278`、
// 「没有为 $x$ 添加修饰符」`:90`、引用 `:221`、类型 `:283`、上下文 `:17`、脚本 `:244`。
// `whole.words.label` 在中文包里**没有**（该键只有英文 `SSRBundle.properties:84`），
// 所以中文文案沿用同一份 zh 里已经用了的「全字」。

import { parseVariableConstraint, UNLIMITED, type VariableConstraint } from './structuralSearchConstraints.ts'

/** 上游 `FilterPanel` 左侧那棵树里的一行：整个模板或某个变量。 */
export interface TemplateVariable {
  name: string
  /** `$x$` 在模板里的起点（含 `$`）。 */
  start: number
  /** `$x$` 的终点（不含 `$` 之后）。 */
  end: number
  /** 已写约束后缀的终点；`end` 与它之间就是 `+`/`{2,3}[regex(...)]` 那一段。 */
  suffixEnd: number
  /** 解析出来的约束（首次引用那份）。解析失败时给默认值并把 `broken` 置真。 */
  constraint: VariableConstraint
  /** 现有后缀读不动（编译错误来自这里）：此时**不许**再往同一段上叠写。 */
  broken: boolean
  /** 同一个变量在模板里出现了几次（修饰符只许写在第一处，见上游同一条规则）。 */
  occurrences: number
}

const VAR = /\$([A-Za-z_][A-Za-z0-9_]*)\$/g

/** 默认约束（与 `structuralSearchConstraints.ts` 里 `constraint(name)` 同一个形状）。 */
function plain(name: string): VariableConstraint {
  return {
    name, minOccurs: 1, maxOccurs: 1, greedy: true, regexp: null, invertRegExp: false, wholeWordsOnly: false,
    contains: null, invertContains: false,
  }
}

/**
 * 列出模板里的变量与它们**已写的**修饰符后缀。
 *
 * 只解析首次引用上的后缀：上游对第二处带条件的引用直接报
 * `error.condition.only.on.first.variable.reference`
 * （`StringToConstraintsTransformer.java:179-181`），本仓编译期也报同一句
 * （见 `compileStructuralPattern`），这里则按同一条口径忽略后续出现的后缀。
 */
export function templateVariables(template: string): TemplateVariable[] {
  const out: TemplateVariable[] = []
  const seen = new Map<string, TemplateVariable>()
  VAR.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = VAR.exec(template)) !== null) {
    const name = match[1]!
    const start = match.index
    const end = match.index + match[0].length
    const existing = seen.get(name)
    if (existing) { existing.occurrences++; continue }
    const parsed = parseVariableConstraint(name, template, end)
    const row: TemplateVariable = parsed.ok
      ? { name, start, end, suffixEnd: parsed.index, constraint: parsed.constraint, broken: false, occurrences: 1 }
      : { name, start, end, suffixEnd: end, constraint: plain(name), broken: true, occurrences: 1 }
    seen.set(name, row)
    out.push(row)
    if (parsed.ok) VAR.lastIndex = parsed.index
  }
  return out
}

/** 计数后缀（`modifierSuffix` 的第一半）。与 `readQuantifier` 严格互逆。 */
function quantifierSuffix(c: VariableConstraint): string {
  const unbounded = c.maxOccurs === UNLIMITED
  // 一项不多不少时"贪婪与否"没有意义（`readQuantifier` 里 `greedy` 只在读到量词之后才会被
  // 那个后置 `?` 改掉），所以这里不产出任何后缀；`$x$?` 会被读成 `minOccurs=0`，不是"非贪婪"。
  if (c.minOccurs === 1 && c.maxOccurs === 1) return ''
  if (unbounded && c.minOccurs === 1) return '+'
  if (!unbounded && c.maxOccurs === 1 && c.minOccurs === 0) return '?'
  if (unbounded && c.minOccurs === 0) return '*'
  if (unbounded) return `{${c.minOccurs},}`
  if (c.minOccurs === 0) return `{,${c.maxOccurs}}`
  if (c.minOccurs === c.maxOccurs) return `{${c.minOccurs}}`
  return `{${c.minOccurs},${c.maxOccurs}}`
}

/** 条件后缀（`modifierSuffix` 的第二半）：`[regex(...)]` / `[regexw(...)]` / `[!regex(...)]` / `[contains(...)]`。 */
function conditionSuffix(c: VariableConstraint): string {
  const parts: string[] = []
  // 两处都用**真值判断**而不是 `!== null`：调用方（面板与测试）可能传来一份没带新字段的旧形状约束，
  // `undefined` 在这里的意思就是"这一档没写"，写成 `!== null` 会凭空产出 `[contains(undefined)]` 那种后缀。
  if (c.regexp) {
    parts.push(`${c.invertRegExp ? '!' : ''}${c.wholeWordsOnly ? 'regexw' : 'regex'}(${c.regexp})`)
  }
  // `contains` 是**条件文本**里的选项（`StringToConstraintsTransformer.java:459-461`），
  // 不在 `DefaultFilterProvider.java:13` 那五个 UI 动作里，所以本仓它只出现在后缀与摘要行上，
  // 面板不为其画复选框以外的控件（求值见 src/structuralSearchModifiers.ts）。
  if (c.contains) parts.push(`${c.invertContains ? '!' : ''}contains(${c.contains})`)
  // 多个选项之间用 `&&`（`parseCondition` 的分隔符，`StringToConstraintsTransformer.java:378-393`）。
  return parts.length ? `[${parts.join(' && ')}]` : ''
}

/** 一条约束的完整后缀文本（写回模板时接在 `$x$` 后面）。 */
export function modifierSuffix(c: VariableConstraint): string {
  const quantifier = quantifierSuffix(c)
  const condition = conditionSuffix(c)
  if (!quantifier && !condition) return ''
  // 非贪婪的那个 `?` 必须紧跟量词、且在条件块之前（`StringToConstraintsTransformer.java:160-166`
  // 是在量词之后立刻读它，`:183-197` 才读条件块）。
  const lazy = !c.greedy && quantifier ? '?' : ''
  return `${quantifier}${lazy}${condition}`
}

/**
 * 把某个变量的修饰符写回模板：替换**首次引用**后面那段后缀。
 *
 * 现有后缀读不动时原样返回（`broken`）—— 往一段语法错的文本上再叠一层只会把错误
 * 越搅越深，而面板上的编译错误已经把问题摆在用户眼前了。
 */
export function writeVariableModifiers(template: string, name: string, next: VariableConstraint): string {
  const target = templateVariables(template).find(row => row.name === name)
  if (!target || target.broken) return template
  const suffix = modifierSuffix(next)
  return `${template.slice(0, target.end)}${suffix}${template.slice(target.suffixEnd)}`
}

/** 一次写多个变量的修饰符（面板上「应用」按钮的口径）。 */
export function writeAllModifiers(template: string, edits: ReadonlyMap<string, VariableConstraint>): string {
  let out = template
  // 从**后往前**替换，前面的替换不会挪动后面那些行的下标。
  for (const row of [...templateVariables(out)].reverse()) {
    const next = edits.get(row.name)
    if (next) out = writeVariableModifiers(out, row.name, next)
  }
  return out
}

// ── 摘要（上游 `FilterAction.getShortText`）────────────────────────────────────────

export interface ModifierRow {
  /** 面板上那一列的动作名（`count.filter.name` / `text.filter.name`）。 */
  filter: string
  /** 摘要文本（`count.label` / `text.0.label` 那一档的成品串）。 */
  label: string
  /** 上游 `CountFilter.java:94` 那句「默认值」的灰色后缀。 */
  isDefault: boolean
}

/** `count.label=Count={0}` + `{0}` = `[min,max]`（`CountFilter.java:42,92`）。 */
export function countSummary(c: VariableConstraint): string {
  const max = c.maxOccurs === UNLIMITED ? '∞' : String(c.maxOccurs)
  return `计数=[${c.minOccurs},${max}]`
}

/** `TextFilter.java:82-85`：`Text=` + 取反前缀 `!` + 正则，再按位追加「全字」。 */
export function textSummary(c: VariableConstraint): string {
  if (!c.regexp) return ''
  return `Text=${c.invertRegExp ? '!' : ''}${c.regexp}${c.wholeWordsOnly ? '，全字' : ''}`
}

/**
 * 子树包含档的摘要。上游**没有**这一档的 UI 动作（`DefaultFilterProvider.java:13` 只有
 * Context/Count/Reference/Text/Type 五个），它只存在于条件文本里
 * （`StringToConstraintsTransformer.java:459-461` 的 `contains`），所以摘要沿用同一个
 * `名字=值` 形状（`text.0.label=Text={0}`，`SSRBundle.properties:78`），取反前缀 `!`
 * 与 `PatternCompiler.java:507-509` 的 `NotPredicate` 包裹同一口径。
 */
export function containsSummary(c: VariableConstraint): string {
  if (!c.contains) return ''
  return `Contains=${c.invertContains ? '!' : ''}${c.contains}`
}

/** 面板上该变量已经挂了的修饰符（没有就返回空数组，配 `NO_MODIFIERS_LABEL`）。 */
export function modifierRows(c: VariableConstraint): ModifierRow[] {
  const rows: ModifierRow[] = []
  const isDefaultCount = c.minOccurs === 1 && c.maxOccurs === 1 && c.greedy
  rows.push({ filter: '计数', label: countSummary(c), isDefault: isDefaultCount })
  const text = textSummary(c)
  if (text) rows.push({ filter: '文本', label: text, isDefault: false })
  const contains = containsSummary(c)
  if (contains) rows.push({ filter: '包含', label: contains, isDefault: false })
  return rows
}

/** zh `no.filters.for.0.label=没有为 ${0}$ 添加修饰符`。 */
export function noModifiersLabel(name: string): string {
  return `没有为 $${name}$ 添加修饰符`
}

/** 上游默认提供器里、本仓**没有落点**的那四档（`DefaultFilterProvider.java:13`）。 */
export const UNAVAILABLE_FILTERS: readonly { name: string; reason: string }[] = [
  { name: '引用', reason: '要比对引用到的元素，需要语法树与解析器（`ReferenceFilter.java`）。' },
  { name: '类型', reason: '要比对表达式的类型，需要类型推导（`TypeFilter.java`）。' },
  { name: '上下文', reason: '要按语法上下文限定变量位置（`ContextFilter.java`）。' },
  { name: '脚本', reason: 'Groovy 脚本宿主（`ScriptFilter.java` + `StructuralSearchScriptEngine`），本仓不执行模板里的脚本。' },
]

// ── 「整个模板」那一档的修饰符（上游 `FilterPanel` 树顶的 Whole template 行）──────────
//
// 上游给整模板加的修饰符最终仍落到每个变量的约束上（`FilterTable` 的 `getMatchVariable()`
// 在选中整模板行时返回**所有**变量），文本层等价：一次把同一份约束套给全部变量。
// 「Within type hierarchy」那半（`TextFilter.java:93` 的复选框）没有落点，所以整模板档
// 只暴露计数与文本正则两项。

export interface WholeTemplateEdit {
  minOccurs: number
  maxOccurs: number
  regexp: string | null
  invertRegExp: boolean
  wholeWordsOnly: boolean
}

/**
 * 对模板里**所有**变量施加同一份修饰符（`writeAllModifiers` 的便捷入口）。
 *
 * 只覆盖这一档**真的编辑**的四项（minOccurs/maxOccurs/regexp+invertRegExp/wholeWordsOnly），
 * 其余字段沿用每个变量自己已有的那一份 —— 特别是 `contains`（子树档）与 `greedy`：
 * 上游的整模板行编辑的是 Count/Text 两个 filter（`FilterTable.java:22-25` 的 `getMatchVariable()`
 * 在选中整模板行时返回全部变量），从不替这一行清掉别档的约束。
 * 缓冲里 `regexp: null` 的意思与上游 `TextFilter.java:62-64` 的 `clearFilter` 同一条：撤掉文本档。
 */
export function applyToWholeTemplate(template: string, edit: WholeTemplateEdit): string {
  const edits = new Map<string, VariableConstraint>()
  for (const row of templateVariables(template)) {
    edits.set(row.name, {
      ...row.constraint,
      name: row.name,
      minOccurs: edit.minOccurs,
      maxOccurs: edit.maxOccurs,
      // 整模板这一档不编辑"贪婪/非贪婪"，也不替用户猜一个 `contains` 子模板：两者都保持原值。
      regexp: edit.regexp,
      invertRegExp: edit.invertRegExp,
      wholeWordsOnly: edit.wholeWordsOnly,
    })
  }
  return writeAllModifiers(template, edits)
}
