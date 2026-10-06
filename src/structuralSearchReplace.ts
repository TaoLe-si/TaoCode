// 结构化**替换**的文本层模型（判词 `ss/replace` 的「逐变量替换定义」与「独立预览」两条待办）。
//
// 上游那一侧的骨架是四件：
//   · `plugin/replace/ReplaceOptions.java:25-30` —— 替换串 + 四个开关
//     （`toShortenFQN` `:27`、`myToReformatAccordingToStyle` `:28`、`myToUseStaticImport` `:29`）
//     加一张 `ReplacementVariableDefinition` 表（`:25`）；
//   · `ReplacementVariableDefinition.java:9-24` —— 它其实只是 `NamedScriptableDefinition`
//     （名字 + 一段脚本，字段在 `NamedScriptableDefinition.java:16-17`），
//     setter 里有一条很容易漏的规则：**字面量 `""` 当成空串**（`:44`）；
//   · `plugin/replace/impl/ReplacementBuilder.java:132-163` 的 `process` —— 把每个参数位换成
//     实际文本：脚本算不出来就退回"用命中的原文"（`:147-149`），算得出来就把结果插进去（`:151`），
//     而且**从后往前插**（`:141` 按 `getStartIndex` 逆序排），不然前面的替换会把后面的下标挪掉；
//   · `plugin/replace/impl/Replacer.java:70-76` 的 `insertSubstitution` —— 空文本**什么都不插**
//     （`:71` 的 `if (!image.isEmpty())`），这就是"替换成空 = 删掉这一段"；
//     同文件 `:78-92` 的 `testReplace(in, what, by, options, project)` 是上游的**不改文档的替换预览**，
//     本仓的 `previewStructuralReplacement` 就是它（不是 `ReplacementPreviewDialog` 那个窗口，
//     那个窗口的落点在结果树的内联预览里，见 `src/components/SearchPanel.vue`）。
//
// **本仓用什么承接了什么**：
//   · 「逐变量替换定义」—— 上游的定义值是 Groovy 脚本的结果，本仓没有脚本宿主，
//     于是定义值取**用户直接写的文本**（常量的那一种脚本结果），其余规则逐条照抄：
//     `""` 当空串、空文本不插（=删除）、未知名字保留字面、多定义按**逆序**展开。
//   · 展开器**复用** `src/regexReplacement.ts` 的 `createReplacement`（上游
//     `platform/lang-impl/src/com/intellij/find/impl/RegExReplacementBuilder.java` 的那份实现），
//     不另起一套 `$N`/`\L…\E` 语义：定义文本与捕获值一起排进组表，`$Var$` 翻成指向组表的槽位。
//   · 「替换预览」= 对**一行文本**跑同一份编译产物（`compileStructuralPattern` 的正则），
//     取回每个变量的捕获值，再按定义表展开 —— 与原生 `search.preview` 那条通道同一条口径，
//     区别只是这条能表达"变量换成固定文本"，那条只能表达 `$N` 回填。
//   · 「整份文件一次替换」= `structuralReplacementPlan` + `applyStructuralReplacements`
//     （桶 9 派单点名的 matcher 纯函数半区：模板解析 → 匹配 → 替换文本生成）。
//     上游那三步是 `Replacer.java:125-131`（`CollectingMatchResultSink` 收全部命中，逐条建
//     `ReplacementInfo`）、`ReplacementBuilder.java:132-163`（`process` 逐处展开，参数位按
//     `getStartIndex` **逆序**插，`:140-141`）、`Replacer.java:180-211`（`doReplaceAll` 逐处写回，
//     写回前查 PSI 元素还有效吗，`:219-221`）。命中互不重叠这一条来自
//     `impl/matcher/handlers/TopLevelMatchingHandler.java:22-34`：匹配成功且没开递归档时**不**往
//     子节点里钻 ⇒ 一次命中吃掉整个节点。本仓的推进规则与逆序写回都按这几条搬，差异写在
//     `applyStructuralReplacements` 的函数头上（上游正序+重解析，本仓逆序+一次算完）。
//
// **不做**（三条，逐条对应上游能力，本仓没有落点，面板上不画开关）：
//   · `ReplaceOptions` 的「Reformat」「Use static imports」「Shorten FQN」三位
//     （`ReplaceOptions.java:27-29`，读取点 `:72`/`:80`/`:92`）—— 重排要 `CodeStyleManager`、
//     静态导入与缩短全限定名要导入表与 PSI 元素（`ReplacementBuilder` 的 ShortenFQN 分支），
//     文本层没有语法树可以改写；
//   · `impl/ParameterInfo.java` 的参数上下文（argument / statement 上下文与逗号分隔符位置）——
//     判的是"这个变量在语法树的哪个位置"，文本层只有列号；
//   · 脚本定义（`NamedScriptableDefinition.java:17` 的 `scriptCodeConstraint`）——
//     本仓不执行模板里的脚本，定义值只接字面文本。

import { compileStructuralPattern, compileStructuralReplacement, replacementVariables } from './structuralSearch.ts'
import type { StructuralPattern } from './structuralSearch.ts'
import { createReplacement } from './regexReplacement.ts'
import { execWithSpans } from './structuralSearchModifiers.ts'
import type { MatchSpans } from './structuralSearchModifiers.ts'

/** 一个替换变量的定义（上游 `ReplacementVariableDefinition` + 其基类的 name/脚本位）。 */
export interface ReplacementDefinition {
  name: string
  /** 定义文本：本仓用它替代上游那段脚本的求值结果。 */
  text: string
}

/**
 * 建一条定义。上游 `NamedScriptableDefinition.java:43-45` 把字面量 `""` 收成正则意义上的空串
 * （`"\"\"".equals(scriptCodeConstraint) ? "" : …`），本仓照做：用户在定义框里写 `""`
 * 的意思是"这个变量替换成空"，而不是"替换成两个引号"。
 */
export function defineReplacementVariable(name: string, raw: string): ReplacementDefinition {
  return { name, text: raw === '""' ? '' : raw }
}

/** 定义表 → 查表用的 Map（同名后写的覆盖先写的，与 `ReplaceOptions.java:187` 的按名取同形）。 */
export function definitionMap(definitions: readonly ReplacementDefinition[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const item of definitions) out.set(item.name, item.text)
  return out
}

/** 替换串里引用了、但模板里没有的名字（对话框用来提示"这个不会被替换掉"）。 */
export function unknownReplacementNames(replacement: string, variables: readonly string[]): string[] {
  return replacementVariables(replacement).filter(name => !variables.includes(name))
}

/**
 * 把替换串里的 `$Var$` 翻成指向 `groups` 的槽位：
 *   · 有定义的变量 → 定义文本单独占一个槽位（**空文本 ⇒ 槽位是空串**，等于上游"什么都不插"）；
 *   · 没定义的变量 → 指向捕获组（下标 = 变量首次出现顺序 + 1，与原生 `$N` 同一套编号）；
 *   · 模板里没有的名字 → 占一个**文本槽位**原样插回（展开器不认 `$字母`，见函数体里的注释）。
 */
export function buildReplacementTemplate(
  replacement: string,
  variables: readonly string[],
  definitions: ReadonlyMap<string, string>,
): { template: string; groups: string[] } {
  // 槽位 1..n 先按**变量顺序**占好（与 `$N` 的编号一致），定义文本往后追加 ——
  // 两边共用同一个数组，谁也不许挤掉谁的槽位。
  const groups: string[] = ['', ...variables.map(() => '')]
  let template = ''
  let cursor = 0
  const pattern = /\$([A-Za-z_][A-Za-z0-9_]*)\$/g
  pattern.lastIndex = 0
  let found: RegExpExecArray | null
  while ((found = pattern.exec(replacement)) !== null) {
    template += replacement.slice(cursor, found.index)
    const name = found[1]!
    const index = variables.indexOf(name)
    if (definitions.has(name)) {
      // 定义文本走**槽位**而不是直接拼进模板：直接拼会让用户写的 `$1`、`$&` 被当成组引用展开，
      // 而上游 `Replacer.insertSubstitution`（`:70-76`）插的是纯文本，不二次解释。
      groups.push(definitions.get(name) ?? '')
      template += `$${groups.length - 1}`
    } else if (index >= 0) {
      // 捕获槽位号 = 变量首次出现顺序 + 1（与原生 `$N`、`src/structuralSearchResults.ts` 同一套编号）。
      // 这里**不**给捕获预留槽位：多塞空槽会把 `createReplacement` 的"最长合法组号"判宽，
      // 组数必须由调用方（`expandStructuralReplacement`）按真实捕获数填。
      template += `$${index + 1}`
    } else {
      // 模板里没有的名字：也**占一个槽位**放它的原文。
      // 不能直接把 `$z$` 留在模板里交给展开器 —— `createReplacement` 走的是 Java
      // `Matcher.appendReplacement` 的语义，`$` 后面跟字母要抛 `Illegal group reference`
      // （`src/regexReplacement.ts:130`），而原生 `std::regex_replace` 那一侧是把 `$z` 当字面量。
      // 两边行为不同，所以这条通道上"保留字面"必须改成"作为一个文本槽位插回去"才等价。
      groups.push(found[0])
      template += `$${groups.length - 1}`
    }
    cursor = found.index + found[0].length
  }
  template += replacement.slice(cursor)
  return { template, groups }
}

/**
 * 按一次命中的捕获值与定义表算出替换后的文本。
 *
 * `groups[0]` 是整段命中（上游 `$0`），`groups[n]` 是第 n 个捕获组 —— 与 `src/regexReplacement.ts`
 * 的入参口径一致，所以 `\L…\E`、`\u`、`${name}` 这些展开语义只有一份实现。
 */
export function expandStructuralReplacement(
  replacement: string,
  variables: readonly string[],
  values: readonly string[],
  definitions: ReadonlyMap<string, string> = new Map(),
  whole = '',
): string {
  const built = buildReplacementTemplate(replacement, variables, definitions)
  // 槽位 0 = 整段命中（上游的 `$0`），1..n = 各变量的捕获值，n 之后 = 定义文本（已在建表时追加）。
  const groups = [...built.groups]
  groups[0] = whole
  variables.forEach((name, index) => { groups[index + 1] = values[index] ?? '' })
  // `ReplacementBuilder.java:141` 的逆序展开等价于"先算下标再一次性写"，这里因为每组各占一个槽位、
  // 由 `createReplacement` 单趟扫描展开，天然不受"前面的替换挪动后面的下标"影响 —— 结果同一条：
  // 同一变量在替换串里出现多次，每一次都拿到同一个值。
  return createReplacement(built.template, groups)
}

/**
 * 一次扫描：`text` 里**全部**互不重叠的命中（按文档顺序）。
 *
 * 上游一次搜索收集的是「全部命中」而不是「第一处」：`Replacer.java:125-131` 用
 * `CollectingMatchResultSink` 把 `matcher.testFindMatches(sink)` 跑出来的每个 `MatchResult`
 * 各建一条 `ReplacementInfo`。命中与命中**不许重叠**：`TopLevelMatchingHandler.java:22-34`
 * 只在「没匹配上」或用户开了递归档（`matchContext.getOptions().isRecursiveSearch()`）时才往
 * 子节点里钻 ⇒ 一次命中吃掉整个节点，下一处从它后面开始。
 *
 * 本仓的等价推进：下一处从上一处的 `whole.end` 起找。零宽命中（模板里全是 `{0,}` 那类可选变量时
 * 编得出来）往前挪一格再找 —— 上游的匹配对象是一个完整 PSI 节点，永远吃不掉「零个字符」，
 * 这一档是本仓自己给自己加的保险，不是照抄上游。
 *
 * 引擎配不出区间时（宿主 `std::regex` 是 ECMAScript 文法、`native/search.cpp:256`，与 JS 有差）
 * 一律**停在已经拿到的那些**，不猜下一处在哪：宁可少算，也不多改。
 */
function hitsWithin(pattern: StructuralPattern, text: string, flags = '', from = 0): MatchSpans[] {
  const out: MatchSpans[] = []
  let cursor = Math.max(0, Math.min(from, text.length))
  for (;;) {
    const spans = execWithSpans(pattern.regex, pattern.variables, text, flags, cursor)
    if (!spans) return out
    out.push(spans)
    const width = spans.whole.end - spans.whole.start
    cursor = width > 0 ? spans.whole.end : spans.whole.start + 1
    // 零宽命中落在文末时 `+1` 会越界，而 `execWithSpans` 把起点 clamp 回长度 ⇒ 同一位置会被反复
    // 取到、这里就死循环。越界一律收工（上游不会遇到这一档：一次匹配吃掉的是一个完整节点）。
    if (cursor > text.length) return out
  }
}

/** 一次命中 → 变量捕获值数组（下标 = 变量首次出现顺序，与 `pattern.variables` 同序）。 */
function valuesOfSpans(pattern: StructuralPattern, spans: MatchSpans): string[] {
  return pattern.variables.map(name => spans.variables[name]?.text ?? '')
}

export interface ReplacementPreview {
  /** 命中的那一段原文（上游 `MatchResult.getMatchImage()`，`MatchResult.java:15`）。 */
  before: string
  /** 按定义表与捕获值算出来的替换结果。 */
  after: string
  /** 每个变量在这一次命中里取到的值。 */
  values: Record<string, string>
  /** `before === after`（空替换就是删除，删除后可能整行变空 —— 面板据此提示"整行删除"）。 */
  removes: boolean
}

/**
 * 一行文本上的替换预览（上游 `Replacer.testReplace`（`Replacer.java:78-92`）的文本层等价物：
 * 给定原文、搜索模板、替换模板，算出替换后的文本，**不碰文档**）。
 *
 * `at` = 这一处命中在行内的起始列（宿主给的列号，0 基，与 `src/structuralSearchModifiers.ts`
 * 的 `verdictForHit` 同一个起点口径，见那个函数 `:416-417` 的注释）。
 * **为什么要有这个参数**：复核那一步早就按列号取命中（`verdictForHit` → `execWithSpans(…, from)`），
 * 而预览原先固定从 0 起 —— 一行里有两处命中时，第二条结果行的预览显示的是**第一条**的前后文本，
 * 于是「N 处将替换」与内联预览说的不是同一段字。取不到正好压在 `at` 上的命中时退回行内第一处
 * （老调用方传 0 的结果与改之前逐字一致）。
 *
 * 复核不上（JS 正则在那一行配不出区间）时返回 null —— 不编一个 after 出来。
 */
export function previewStructuralReplacement(
  pattern: StructuralPattern,
  text: string,
  replacement: string,
  definitions: ReadonlyMap<string, string> = new Map(),
  flags = '',
  at = 0,
): ReplacementPreview | null {
  const hits = hitsWithin(pattern, text, flags)
  const spans = hits.find(hit => hit.whole.start === at) ?? hits[0]
  if (!spans) return null
  const values: Record<string, string> = {}
  const list = valuesOfSpans(pattern, spans)
  pattern.variables.forEach((name, index) => { values[name] = list[index] ?? '' })
  const after = expandStructuralReplacement(replacement, pattern.variables, list, definitions, spans.whole.text)
  return { before: spans.whole.text, after, values, removes: after === '' }
}

/** 一次搜索的全部行里有多少处**真的会改**（定义表把某些变量固定成原文时，那一处替换前后一样）。 */
export function previewMany(
  pattern: StructuralPattern,
  rows: readonly { path: string; line: number; column: number; text: string }[],
  replacement: string,
  definitions: ReadonlyMap<string, string> = new Map(),
  flags = '',
): { previews: Map<string, ReplacementPreview>; unchanged: number; unverifiable: number } {
  const previews = new Map<string, ReplacementPreview>()
  let unchanged = 0
  let unverifiable = 0
  for (const row of rows) {
    // 列号一路传下去：这一行的这一处，不是这一行的第一处（与 `verdictForHit` 的起点同一档）。
    const preview = previewStructuralReplacement(pattern, row.text, replacement, definitions, flags, row.column)
    if (!preview) { unverifiable++; continue }
    if (preview.before === preview.after) unchanged++
    previews.set(`${row.path}:${row.line}:${row.column}`, preview)
  }
  return { previews, unchanged, unverifiable }
}

/**
 * 一处命中的替换编辑（上游 `ReplacementInfo`（`plugin/replace/ReplacementInfo.java`）在文本层的等价物：
 * 一个区间 + 要写进去的新文本）。`values` 带着，是为了面板展开那一行时能报「这一段是 $x$ 的哪段文本」。
 */
export interface StructuralReplacementEdit {
  from: number
  to: number
  /** 展开后的新文本；空串 = 删掉这一段（`Replacer.java:71` 的「空文本什么都不插」）。 */
  text: string
  /** 命中的那一段原文。 */
  before: string
  values: Record<string, string>
}

export interface StructuralReplacementPlan {
  /** **真的会改**的那些命中：文档顺序、互不重叠。 */
  edits: StructuralReplacementEdit[]
  /** 替换前后一样的命中数（定义把变量写回原文）——上游照样会走一遍替换，本仓不把它算进 edits。 */
  unchanged: number
  /** 被复核判掉的命中数（`accept` 返回 false）。 */
  skipped: number
}

/**
 * 整份文本（一个文件）的结构化替换计划：模板编译产物 → 全部命中 → 逐处生成替换文本。
 * 上游那条链是 `Replacer.java:125-131`（收集命中）+ `ReplacementBuilder.java:132-163`（逐处展开）
 * + `Replacer.java:180-211`（逐处写回）；本仓把三步合成一个纯函数，输入输出都能单测。
 *
 * `accept` = 逐处复核（`src/structuralSearchModifiers.ts` 的 `verdictForHit` 那一层：`contains` /
 * `within` / 列表整段）。**不传 = 不复核**，与接线前的原生 `search.replace` 通道同一档行为 ——
 * 那条通道是宿主拿 `std::regex` 全文件替换的，本仓的复核只发生在结果列表那一侧
 * （`filterHitsByModifiers`），所以「替换全部」与「列出来的命中」本来就不是同一批；
 * 把 `accept` 传进来才是把这两批对齐的那一步，挂载点见 `docs/wiring-requests-2026-10-06-search3.md` R-2。
 */
export function structuralReplacementPlan(
  pattern: StructuralPattern,
  text: string,
  replacement: string,
  definitions: ReadonlyMap<string, string> = new Map(),
  flags = '',
  accept?: (spans: MatchSpans) => boolean,
): StructuralReplacementPlan {
  const edits: StructuralReplacementEdit[] = []
  let unchanged = 0
  let skipped = 0
  for (const spans of hitsWithin(pattern, text, flags)) {
    if (accept && !accept(spans)) { skipped++; continue }
    const list = valuesOfSpans(pattern, spans)
    const generated = expandStructuralReplacement(replacement, pattern.variables, list, definitions, spans.whole.text)
    if (generated === spans.whole.text) { unchanged++; continue }
    const values: Record<string, string> = {}
    pattern.variables.forEach((name, index) => { values[name] = list[index] ?? '' })
    edits.push({ from: spans.whole.start, to: spans.whole.end, text: generated, before: spans.whole.text, values })
  }
  return { edits, unchanged, skipped }
}

/**
 * 按计划写回：从**后往前**拼（上游 `ReplacementBuilder.java:140-141` 把每个参数位按 `getStartIndex`
 * 逆序排好再插，理由一样——前面的替换会把后面的下标挪掉）。
 *
 * 与上游的落差如实登记：上游是**正序**逐处写回（`Replacer.java:185-207`），因为它每写一处都会重新
 * 解析 PSI，失效的命中当场跳过（`Replacer.java:219-221` 的 `element == null || !isValid()`）；
 * 本仓没有语法树可以重解析，所以「一次算全部 + 逆序拼接」是唯一能让下标保持成立的写法，
 * 代价是**同一次替换里后面那些命中之前的文本若被外部改掉，这里不会察觉**（调用方要在文档事务里用）。
 */
export function applyStructuralReplacements(text: string, edits: readonly StructuralReplacementEdit[]): string {
  let out = text
  const sorted = [...edits].sort((a, b) => b.from - a.from)
  for (const edit of sorted) out = out.slice(0, edit.from) + edit.text + out.slice(edit.to)
  return out
}

/**
 * 命中计数的一句话（上游 `found.progress.message=Found {0} matches`，
 * `platform/structuralsearch/resources/messages/SSRBundle.properties:48`）。
 * 本仓结果面板上那行「N 处命中 · M 个文件 · K 处将替换」的 `K` 由这里给口径。
 */
export function replacementSummary(hits: number, files: number, pending: number): string {
  const parts = [`${hits} 处命中`]
  if (files) parts.push(`${files} 个文件`)
  parts.push(`${pending} 处将替换`)
  return parts.join(' · ')
}

/** 上游有、本仓没有落点的三个替换开关（**不画控件**，只在说明里出现）。 */
export const UNAVAILABLE_REPLACE_OPTIONS: readonly { name: string; reason: string }[] = [
  { name: '替换后重排（Reformat）', reason: '要 `CodeStyleManager` 按语言代码风格重排（ReplaceOptions.java:28、`Replacer.reformatAndPostProcess`），本仓替换走文本通道的 `$N` 回填。' },
  { name: '使用静态导入（Use static imports）', reason: '要改写导入表（ReplaceOptions.java:29），本仓没有导入模型。' },
  { name: '缩短全限定名（Shorten FQN）', reason: '要 PSI 元素与限定名解析（ReplaceOptions.java:27、ReplacementBuilder 的 ShortenFQN 分支），文本层没有语法树。' },
]

/** 一次替换定义折叠的结果：发给宿主的替换串，或者是挡住它的错误。 */
export type FoldedReplacement = { replacement: string } | { error: string }

/**
 * 把定义表折进**发给宿主的替换串**（宿主那条通道只认 `$N`，见 `native/search.cpp` 的 `apply_replacement`）。
 *
 * 没有定义表时，产物与 `compileStructuralReplacement` **逐字相同**（判据测试守着这一条）——
 * 接线的原则是"新东西不许改坏既有行为"。有定义时把定义文本直接写在替换串的位置上，
 * 因为定义值在本仓就是文本（上游是脚本求值结果，`ReplacementBuilder.java:146-151`）。
 *
 * 唯一被挡的写法：定义文本里含 `$`。`std::regex` 的 ECMAScript 格式化器
 * （`native/search.cpp:250`）把 `$` 当替换标记的起始字符，**没有**"字面 `$`"的转义写法，
 * 所以这种定义发下去会静默变形成别的内容 —— 宁可在编译期报错，也不发一条会变形下去的请求。
 */
export function compileStructuralReplacementWithDefinitions(
  replacement: string,
  variables: readonly string[],
  definitions: readonly ReplacementDefinition[],
): FoldedReplacement {
  const map = definitionMap(definitions)
  if (!map.size) return { replacement: compileStructuralReplacement(replacement, [...variables]) }
  let out = ''
  let cursor = 0
  const pattern = /\$([A-Za-z_][A-Za-z0-9_]*)\$/g
  pattern.lastIndex = 0
  let found: RegExpExecArray | null
  while ((found = pattern.exec(replacement)) !== null) {
    out += replacement.slice(cursor, found.index)
    const name = found[1]!
    if (map.has(name)) {
      const text = map.get(name) ?? ''
      if (text.includes('$')) {
        return { error: `替换定义 \`$${name}$\` 的文本里有 \`$\`：原生替换通道没有"字面 $\$"的写法，会被当成捕获标记。` }
      }
      out += text
    } else {
      const index = variables.indexOf(name)
      out += index >= 0 ? `$${index + 1}` : found[0]
    }
    cursor = found.index + found[0].length
  }
  out += replacement.slice(cursor)
  return { replacement: out }
}

/** 定义表里引用了但模板里没有的变量名（面板提示用，与 `unknownReplacementNames` 同一口径）。 */
export function danglingDefinitions(
  pattern: StructuralPattern,
  definitions: readonly ReplacementDefinition[],
): string[] {
  return definitions.filter(item => !pattern.variables.includes(item.name)).map(item => item.name)
}

/** 校验一条定义：名字必须是模板里的变量；文本为空是合法的（=删掉那一段）。 */
export function checkDefinitions(
  pattern: StructuralPattern,
  definitions: readonly ReplacementDefinition[],
): string[] {
  const dangling = danglingDefinitions(pattern, definitions)
  return dangling.map(name => `替换定义 \`$${name}$\` 在模板里不存在（模板的变量是 ${pattern.variables.map(v => `$${v}$`).join(' ')}）。`)
}

/** 供面板用的入口：模板文本 + 定义表 → 校验信息（模板编不动时也一并报出来）。 */
export function validateReplacement(template: string, replacement: string, definitions: readonly ReplacementDefinition[]): string[] {
  const compiled = compileStructuralPattern(template)
  if ('error' in compiled) return [compiled.error]
  return checkDefinitions(compiled, definitions)
}
