// 循环词补全 —— 上游 `platform/lang-impl/src/com/intellij/codeInsight/completion/actions/`：
// `HippieCompletionAction.java:15-35`（`getHandler()` 返回 `new HippieWordCompletionHandler(true)`）、
// `HippieBackwardCompletionAction`（同一 handler 的 `false` 档）、行为本体
// `HippieWordCompletionHandler.java`。
//
// 手势（`platform/platform-resources/src/keymaps/$default.xml:735-739`，`HippieCompletion`/
// `HippieBackwardCompletion`）：Alt+/ 向前、Alt+Shift+/ 向后。
//
// 本文件按上游逐条落的东西（每条后面注了类与行号）：
//   · 前缀与起点：`computeData:388-413` —— 取包含光标的那个词，前缀 = `[词首, 光标)`；
//     光标不在任何词里时前缀是**空串**、起点 = 光标（`:408-411`）。
//   · 词形：`processWords:361-382` + `containsLettersOrDigits:253-260` + `isWordPart:384-386`
//     —— 取「字母/数字/_/$」的**极大连续段**（不是「首字符必须是字母」），段里至少要有一个字母或数字。
//     上游那条 `-`/`*` 也算词字符只在**同一个 lexer token 内**相连（它按 highlighter 的 token 走），
//     本仓没有 lexer：按字符类相连会把 Java 的 `a - b` 之外那种 `a-b` 一律并成一个词，
//     而 `a-b` 在上游究竟是「两个词」还是「一个词」取决于语言的 lexer ⇒ 这里不猜，
//     只按标识符段切（Java/C 系与上游一致；kebab 形态的语言近似不了，如实记）。
//   · 候选：`addWordsForEditor:312-350` —— 跳过**包含任一光标**的词（`:331-332`）、
//     长度必须**严格大于**前缀（`:334`）、`CamelHumpMatcher.isStartMatch`（`:146`、`:336`；
//     空前缀恒真 ⇒ 空前缀也有候选，见 `MinusculeMatcher.kt:63-66`、`:72-76`「无片段即 start match」）。
//   · 顺序：`computeVariants:283-306` —— 光标**之前**完整的词进 `words`、其余进 `afterWords`（`:338-343`）；
//     `words` 反序去重再反序 ⇒ 每个词只留**末次出现**、按末次出现位置升序；`afterWords` 正序去重 ⇒
//     每个词留**首次出现**、按首次出现升序；两档**拼接**。
//   · 第一步给哪个：`:165-190` —— 向前取「起点之前最后一项」（即离光标最近的前一个词），
//     前面一项都没有就取整表第一项；向后取「起点之后第一项」，没有就取整表第一项。
//   · 之后每步：`:196-223` —— 向前往**表的前一位**走、向后往**后一位**走；走到表头/表尾就
//     **换档**（`:148`、`:201`、`:218` 的 `computeNextVariant(..., !includeWordsFromOtherFiles, true)`）。
//   · 换到「其他打开文档」档：`:270-278` 遍历 `FileEditorManager.getAllEditors()` 里**别的**文本编辑器
//     （`takeCaretsIntoAccount=false` ⇒ 不做光标跳过，且 `primaryCaretOffset=0` ⇒ 全部落 `afterWords`
//     档 = 首次出现、文档顺序，按编辑器枚举顺序拼接）；第一步向前给**最后一项**、向后给**第一项**
//     （`:166-168`、`:180-182`）。
//   · 两轮都空 ⇒ 恢复用户原来打的前缀并清状态（`:85-89` 的 `insertStringForEachCaret(editor, oldPrefix, …)`）。
//   · 状态失效：`:72-74` —— 光标集合变了**或**文档改动号变了就当作新一轮（换档信息一起丢）。
//   · 多光标：`:115-122` 对**每个**光标替换「它前面 `前缀长度` 个字符」，同一批编辑一次 dispatch
//     （上游是每个 caret 依次 `replaceString`，后面的光标会被前面的插入推后；本仓按原始坐标一次性算，
//     结果相同、且不留中间态）。区间重叠时丢弃重叠项（CodeMirror 的 `changes` 不接受重叠区间）。
//
// 与上游**有意**的两处差（都写在能核对的地方，不冒充一致）：
//   · 上游每次都从活文档重算候选表并用「文本 + 在光标哪一侧」把上一次的候选**intern**回新表
//     （`:151-159`）；本仓把这一档的候选表连同下标一起存进状态 —— 两次按键之间文档只被我们自己
//     在同一个区间改了一次，重建出来的表与存的表**同序同集**（上面那条走查已核对），
//     于是按下标走与按对象身份走等价，且少一份「表在按键之间悄悄变了」的隐式依赖。
//   · 首轮没有候选时上游仍会「把原前缀重写一遍」（一个空操作的文档改动，会进 undo 栈）；
//     本仓返回 null ⇒ 不产生无意义的 undo 步。用户可见结果（文本不变）一致。

import { camelHumpMatcher } from './completionCamelHump.ts'

/** 一条「其他打开文档」（上游 `getAllEditors()` 里别的 `TextEditor`，`:271-277`）。 */
export interface HippieDocument { path: string; text: string }

/** 候选来自哪一档：当前文档 / 其他打开文档（上游 `completionState.fromOtherFiles`，`:109`）。 */
export type HippieStage = 'document' | 'other'

/** 一次循环的游标状态（上游 `CompletionState:429-436` 的本仓形状）。 */
export interface HippieState {
  /** 用户原来打的前缀（上游 `oldPrefix`，恢复时就写回它）。 */
  prefix: string
  /** 替换区间起点 = 上游的 `lastStartOffset`（`:81`、`:106`）。 */
  from: number
  /** 上一次插入的词。 */
  word: string
  /** 上一次处于哪一档。 */
  stage: HippieStage
  /** 该档的候选表（`computeVariants` 的顺序），`index` 是上次给出项的下标。 */
  variants: string[]
  index: number
  /** 这一轮已经给出过的词，按给出顺序（上游按对象身份定位，本仓按这个表记同一条信息）。 */
  tried: string[]
  /** 记录时的光标集合与文档改动号（上游 `caretOffsets` / `lastModCount`，`:73-74`、`:107-108`）。 */
  carets: number[]
  /** 文档改动号：本仓传 `EditorState.doc` 的对象身份（见 `completionUi.ts`）。 */
  revision?: unknown
}

/** 一步循环的结果：把每个 `spans` 区间替换成 `word`（`from`/`to` 是主光标那一条，向后兼容）。 */
export interface HippieStep {
  from: number
  to: number
  word: string
  spans: Array<{ from: number; to: number }>
  state: HippieState | null
  /** 两轮候选都空 ⇒ 写回原前缀并结束（上游 `:85-89`）。 */
  exhausted: boolean
  /** 这一条候选出自其他打开文档（上游 `fromOtherFiles`，`:109`；该档不做命中高亮，`:110`）。 */
  fromOtherFiles: boolean
}

export interface HippieStepOptions {
  /** 全部光标的头（上游 `getCaretOffsets`，`:352-359`、`:425-427`）；缺省 = 只用 `offset` 一个。 */
  carets?: readonly number[]
  /** 文档改动号（上游 `getModificationStamp()`，`:74`、`:107`）：任何能表示「文档换过一版」的令牌都行，
   * 本仓传 `EditorState.doc`（不可变 `Text`，改一次就换一个新对象）。给了就按它判状态是否延续。 */
  revision?: unknown
  /** 其他打开的文档（上游 `getAllEditors()`）；不给就没有换档，一轮走完即恢复前缀。 */
  otherDocuments?: readonly HippieDocument[]
}

/** 词字符 = `Character.isJavaIdentifierPart` 里能被本仓文本层判出的那几个（`isWordPart:384-386`）。 */
const WORD_CHAR = /[$\p{L}\p{N}_]/u

/** 上游 `containsLettersOrDigits:253-260` —— 纯符号段（`---`、`***`）不是词。 */
function hasLetterOrDigit(text: string): boolean {
  for (const char of text) if (/[\p{L}\p{N}]/u.test(char)) return true
  return false
}

/**
 * 上游 `processWords:361-382`：整段文本里所有「标识符类极大连续段」，且段里含字母或数字。
 * 返回 `[start, end)` 与文本，供候选表按位置分档。
 */
export function hippieWords(text: string): Array<{ from: number; to: number; word: string }> {
  const runs: Array<{ from: number; to: number; word: string }> = []
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === undefined || !WORD_CHAR.test(char)) { index += 1; continue }
    let end = index
    while (end < text.length) {
      const next = text[end]
      if (next === undefined || !WORD_CHAR.test(next)) break
      end += 1
    }
    const word = text.slice(index, end)
    if (hasLetterOrDigit(word)) runs.push({ from: index, to: end, word })
    index = end
  }
  return runs
}

/**
 * 光标处的词前缀（上游 `computeData:388-413`）。上游从 `offset - 1` 起让 highlighter 走
 * （`:393`），第一个「装得下 offset」的词段就是它 ⇒ 等价于「**光标前一个字符**所在的那个词段」：
 * 前缀 = `[词段首, 光标)`，起点 = 词段首。光标前一个字符不是词字符（或光标在文本开头）时
 * 前缀是**空串**、起点 = 光标（`:408-411`）；`isStartMatch` 对空前缀恒真
 * （`MinusculeMatcher.kt:63-66`、`:72-76`），所以空前缀照样有候选。
 */
export function hippiePrefixAt(text: string, offset: number): { prefix: string; from: number } {
  const caret = Math.max(0, Math.min(text.length, offset))
  if (caret === 0) return { prefix: '', from: 0 }
  const before = text[caret - 1]
  if (before === undefined || !WORD_CHAR.test(before)) return { prefix: '', from: caret }
  let from = caret - 1
  while (from > 0) {
    const char = text[from - 1]
    if (char === undefined || !WORD_CHAR.test(char)) break
    from -= 1
  }
  return hasLetterOrDigit(text.slice(from, caret)) ? { prefix: text.slice(from, caret), from } : { prefix: '', from: caret }
}

export interface HippieVariantOptions {
  /** 主光标（`primaryCaretOffset:320`）；缺省 = 文本末尾，便于单测按「文档顺序」读。 */
  caret?: number
  /** 全部光标（`:331-332` 的跳过判据用整个集合）。 */
  carets?: readonly number[]
}

interface Variant { word: string; from: number }

/** 当前文档的候选表（上游 `computeVariants:283-306` 的 `includeWordsFromOtherFiles=false` 那一支）。 */
function documentVariants(text: string, prefix: string, options: HippieVariantOptions): Variant[] {
  const matcher = camelHumpMatcher(prefix)
  const caret = options.caret ?? text.length
  const carets = options.carets && options.carets.length ? [...options.carets] : [caret]
  const before: Variant[] = []
  const after: Variant[] = []
  for (const run of hippieWords(text)) {
    // `:331-332`：包含任一光标的段就是「正在打的那个词」，跳过。
    if (carets.some(offset => run.from <= offset && run.to >= offset)) continue
    // `:334`：必须严格长过前缀（等于前缀就是补全自己）。
    if (run.to - run.from <= prefix.length) continue
    if (!matcher.isStartMatch(run.word)) continue
    // `:338-343`：跨过/在光标之后的进 afterWords，完整在光标之前的进 words。
    if (run.to > caret) after.push(run)
    else before.push(run)
  }
  // `:286-295`：反序去重再反序 ⇒ 留每个词的**末次**出现、按末次出现升序。
  const seenBefore = new Set<string>()
  const beforeUnique: Variant[] = []
  for (let index = before.length - 1; index >= 0; index -= 1) {
    const variant = before[index]!
    if (seenBefore.has(variant.word)) continue
    seenBefore.add(variant.word)
    beforeUnique.unshift(variant)
  }
  // `:297-303`：afterWords 正序去重 ⇒ 留每个词的**首次**出现。
  const afterUnique: Variant[] = []
  for (const variant of after) {
    if (seenBefore.has(variant.word)) continue
    seenBefore.add(variant.word)
    afterUnique.push(variant)
  }
  return [...beforeUnique, ...afterUnique]
}

/**
 * 其他打开文档的候选表（`:270-278` + `addWordsForEditor(..., takeCaretsIntoAccount=false)`）：
 * 不做光标跳过，`primaryCaretOffset = 0` ⇒ 所有段都落 `afterWords` 档 ⇒
 * 每个文档「首次出现、文档顺序」，文档之间按注册顺序拼接。
 */
function otherDocumentVariants(documents: readonly HippieDocument[], prefix: string): Variant[] {
  const matcher = camelHumpMatcher(prefix)
  const seen = new Set<string>()
  const result: Variant[] = []
  for (const document of documents) {
    for (const run of hippieWords(document.text)) {
      if (run.to - run.from <= prefix.length) continue
      if (!matcher.isStartMatch(run.word)) continue
      if (seen.has(run.word)) continue
      seen.add(run.word)
      result.push(run)
    }
  }
  return result
}

/**
 * 候选 = 同前缀（驼峰 `isStartMatch`）的词，按上游 `computeVariants` 的顺序：
 * 光标之前的词按**末次出现**升序，其余按**首次出现**升序，两档拼接。
 * 空前缀在上游是**有**候选的（`MinusculeMatcher.kt:72-76`），这里保持一致。
 */
export function hippieVariants(text: string, prefix: string, options: HippieVariantOptions = {}): string[] {
  return documentVariants(text, prefix, options).map(variant => variant.word)
}

/** 第一步给哪一项（`:165-190`）。返回下标，表为空时 -1。 */
function firstPickIndex(variants: readonly Variant[], startOffset: number, direction: 1 | -1, stage: HippieStage): number {
  if (!variants.length) return -1
  if (stage === 'other') return direction > 0 ? variants.length - 1 : 0
  if (direction > 0) {
    // `:169-177`：`result` 一路记「起点之前的最后一项」，遇到第一项在起点之后就定型。
    let result = -1
    for (let index = 0; index < variants.length; index += 1) {
      if (variants[index]!.from < startOffset) { result = index; continue }
      if (result < 0) return index
      break
    }
    return result
  }
  // `:183-189`：起点之后的第一项，没有就整表第一项。
  for (let index = 0; index < variants.length; index += 1) if (variants[index]!.from > startOffset) return index
  return 0
}

/** 走一步循环。返回 null = 这个位置没什么可补的；`exhausted` = 两轮都空，应恢复原前缀。 */
export function hippieStep(
  text: string, offset: number, state: HippieState | null, direction: 1 | -1, options: HippieStepOptions = {},
): HippieStep | null {
  const caret = Math.max(0, Math.min(text.length, offset))
  const carets = (options.carets && options.carets.length ? [...options.carets] : [caret]).map(at => Math.max(0, Math.min(text.length, at)))
  const data = hippiePrefixAt(text, caret)
  const sameCarets = state ? state.carets.length === carets.length && state.carets.every((at, index) => at === carets[index]) : false
  // 上游 `:72-74`：光标集合或文档改动号变了就重新来。给了 revision 就只认它（更强，与上游同判据）；
  // 没给时退回「插入的那段文本还在原位」这一必要条（纯函数测试里没有改动号）。
  const changed = state === undefined || state === null ? true
    : options.revision !== undefined ? state.revision !== options.revision
      : !(caret === state.from + state.word.length && text.slice(state.from, caret) === state.word)
  const continuing = state !== null && sameCarets && !changed

  const prefix = continuing ? state.prefix : data.prefix
  const startOffset = continuing ? state.from : data.from
  let stage: HippieStage = continuing ? state.stage : 'document'
  const otherDocuments = options.otherDocuments ?? []

  /** 某一档的候选表：延续时用状态里存的表（见文件头那条 intern 等价说明）。 */
  const tableOf = (which: HippieStage): Variant[] => continuing && which === state.stage
    ? state.variants.map((word, index) => ({ word, from: index }))
    : which === 'document' ? documentVariants(text, prefix, { caret, carets })
      : otherDocumentVariants(otherDocuments, prefix)

  let variants = tableOf(stage)
  if (!variants.length && stage === 'document' && otherDocuments.length) {
    stage = 'other'
    variants = tableOf(stage)
  }
  if (!variants.length) {
    if (!continuing) return null // 首轮就没候选：不做「把原前缀重写一遍」那个空操作（见文件头）
    return restoreStep(text, state, caret)
  }

  let index: number
  if (!continuing || state.variants.length !== variants.length) {
    index = firstPickIndex(variants, startOffset, direction, stage)
  } else if (direction > 0) {
    // `:196-208`：向前 = 表里的**前一位**；到表头就换档（换不到就结束）。
    index = state.index - 1
    if (index < 0) {
      const other: HippieStage = stage === 'document' ? 'other' : 'document'
      const next = other === 'other' && otherDocuments.length ? tableOf(other) : other === 'document' ? tableOf(other) : []
      if (!next.length) return restoreStep(text, state, caret)
      stage = other
      variants = next
      index = firstPickIndex(variants, startOffset, direction, stage)
    }
  } else {
    // `:211-221`：向后 = 表里的**后一位**；到表尾就换档。
    index = state.index + 1
    if (index >= variants.length) {
      const other: HippieStage = stage === 'document' ? 'other' : 'document'
      const next = other === 'document' || otherDocuments.length ? tableOf(other) : []
      if (!next.length) return restoreStep(text, state, caret)
      stage = other
      variants = next
      index = firstPickIndex(variants, startOffset, direction, stage)
    }
  }
  const picked = variants[index]
  if (!picked) return continuing ? restoreStep(text, state, caret) : null

  // `:115-122`：每个光标各自替换「它前面 `prefix.length` 个字符」。
  const spans: Array<{ from: number; to: number }> = []
  for (const at of carets) {
    const from = Math.max(0, at - prefix.length)
    const previous = spans[spans.length - 1]
    // CodeMirror 不接受重叠区间；重叠的那条丢掉（多光标挨着打前缀的极少见形态）。
    if (previous && from < previous.to) continue
    spans.push({ from, to: at })
  }
  // 上游的 `data.startOffset` 是**主光标**那一条插入的起点（`:91` 的 marker 建在 `data.startOffset`），
  // 所以状态里记的 `from` 与恢复区间都跟着主光标走，不是「最小的那个光标」。
  const primary = spans.find(span => span.to === caret) ?? spans[0] ?? { from: startOffset, to: caret }
  const tried = continuing ? [...state.tried, picked.word] : [picked.word]
  // 上游在**插入之后**才记 `caretOffsets` / `lastModCount`（`:107-108`），所以下一次按键比的
  // 是「插入后的光标」；这里同理存插入后的位置，否则每次延续判定都会失效。
  // `revision` 也一样：调用方要在 dispatch **之后**把改动号盖进状态（见 `completionUi.ts`）。
  return {
    from: primary.from, to: primary.to, word: picked.word, spans,
    fromOtherFiles: stage === 'other' && otherDocuments.length > 0,
    exhausted: false,
    state: {
      prefix, from: primary.from, word: picked.word, stage,
      variants: variants.map(variant => variant.word), index, tried,
      carets: spans.map(span => span.from + picked.word.length),
      ...(options.revision === undefined ? {} : { revision: options.revision }),
    },
  }
}

/** 恢复那一步：把插入的词写回用户原来打的前缀（上游 `:85-89`）。 */
function restoreStep(text: string, state: HippieState, caret: number): HippieStep {
  const to = state.from + state.word.length
  return { from: state.from, to, word: state.prefix, spans: [{ from: state.from, to }], state: null, exhausted: true, fromOtherFiles: false }
}
