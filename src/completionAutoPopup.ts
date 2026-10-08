// **自动弹出补全的触发条件**（`lp/editor-actions` 的 `CompletionAutoPopupHandler` /
// `TypedAutoPopupImpl` 一族，外加 `CompletionPhase.EmptyAutoPopup` 那条「连续打字时不要把同一个
// 空结果反复重查」的闸）。本仓此前只有「CodeMirror 的 `activateOnTyping` 敲什么都会来问一次源」
// 这一条 —— 上游的触发面比它窄，且空结果档有明确的跳过规则。这里是那三档的纯规则，
// 消费点是 `src/lspCompletion.ts` 的自动档（`!context.explicit`）。
//
// 逐条对照的源码（目录 `platform/lang-impl/src/com/intellij/codeInsight/`）：
//   · `editorActions/CompletionAutoPopupHandler.java`
//       - `:36-41`：**已经开着 lookup** ⇒ `STOP`（不排新的自动弹出，那个键交给开着的弹层）。
//         本仓的等价物不在这里：开着的弹层由 CodeMirror 自己消化输入（`input.type` 那一拍
//         重新问源、或 `src/completionUi.ts` 的字符过滤器决定收不收），所以这一档在
//         `lspCompletion.ts` 的入口上不需要再判一次。
//       - `:43-49`：`Character.isLetterOrDigit(charTyped) || charTyped == '_'` ⇒ 排一次自动弹出
//         （`scheduleAutoPopup` 之后返回 `STOP`）；其余字符落到 `:52` 的 `CONTINUE`。
//       - `:44-46`：`phase instanceof EmptyAutoPopup && allowsSkippingNewAutoPopup(editor, charTyped)`
//         ⇒ `CONTINUE`（**不排**）。
//   · `editorActions/TypedAutoPopupImpl.java`
//       - `:30-37` `autoPopupCompletion`：`charTyped == '.'` ⇒ 排（成员补全）；`'/'` 且
//         `AutoPopupController.ALLOW_AUTO_POPUP_FOR_SLASHES_IN_PATHS`（`analysis-impl/src/com/intellij/
//         codeInsight/AutoPopupController.java:43`）为真 ⇒ 排 —— 那个 user data 只有 Swing 的
//         `TextFieldWithAutoCompletionWithCache.java:84` 会置，**代码编辑器不置**，所以本仓
//         整条不接 `/` 这一档；其余字符问各贡献者的 `invokeAutoPopup`（本仓没有这一问，
//         `lp/completion` 那一族也没有对应落点）⇒ 本仓的 `.` 之外一律不排。
//       - `:39-48` `autoPopupParameterInfo`：`(` / `,` 且不在字符串字面量里 ⇒ 参数提示自动弹。
//         **本仓没有这条通道**（参数提示只有 Ctrl+P 显式那一条），所以整档不落 —— 如实登记，
//         不假装（把 `(` 也算成补全触发字符会是假行为）。
//   · `completion/CompletionPhase.kt:588-614` `EmptyAutoPopup.allowsSkippingNewAutoPopup(editor, toType)`：
//       `myEditor === editor && !myTracker.hasAnythingHappened() &&
//        !CompletionProgressIndicator.shouldRestartCompletion(editor, restartingPrefixConditions, toType)`
//       三条都成立 ⇒ 跳过这次自动弹出。`restartingPrefixConditions` 是这一轮补全自己登记的
//       （`CompletionResultSet.restartCompletionOnPrefixChange`，见下面是命令补全那两条）。
//   · `completion/ActionTracker.kt:80-87` `hasAnythingHappened()`：有动作发生过 / 文档戳变了 /
//       光标位置变了 ⇒ 算「有事情发生」。本仓没有动作总线，等价物取**文档 + 光标**两档：
//       CodeMirror 的 `Text` 是**不可变对象**（任何编辑都换引用），所以「除这一次敲入之外正文
//       没变过、光标也只在敲入处前进」可以逐字判出来（见 `emptyAutoPopupAllowsSkipping`）。
//   · `completion/CompletionProgressIndicator.java`
//       - `:899-918` `shouldRestartCompletion`：对每条 `(startOffset, ElementPattern)`，
//         取 `doc[startOffset..caret) + toAppend` 去 match；命中 ⇒ **必须重弹**。
//       - `:762-776`：自动档算完发现 `count == 0` ⇒ `lookup.hideLookup(false)` 并进入
//         `EmptyAutoPopup`；显式档才走 `:961-977` 的 `handleEmptyLookup`（`showErrorHint`
//         弹「无建议」）。**本仓此前自动档也会弹一行占位**（`LookupImpl.addEmptyItem` 的形状），
//         这一条按上游收紧：占位只在显式档出。
//       - `:786-807` `hideAutopopupIfMeaningless` + `isAlreadyInTheEditor`：自动档下如果**每条**
//         候选项都已经在编辑器里、且没有一条值得显示（`LookupElement.isWorthShowingInAutoPopup()`，
//         `analysis-api/src/com/intellij/codeInsight/lookup/LookupElement.java:174-177`：默认实现
//         = 呈现里有**尾部灰字**，也就是本仓 `Completion.detail`），就把整层藏掉并进 EmptyAutoPopup。
//
// 纯数据层：只 import `@codemirror/state` 的 `Text` 类型，便于 `node --test` 直测。
// 判据：`tests/completion-auto-popup.test.mjs`。

import type { Text } from '@codemirror/state'

/** 敲入的字符属于哪一档（`CompletionAutoPopupHandler.java:43-49` 与 `TypedAutoPopupImpl.java:30-37`）。 */
export type AutoPopupKind = 'word' | 'member' | 'none'

/**
 * `word` = 字母/数字/下划线（`CompletionAutoPopupHandler.java:43` 的
 * `Character.isLetterOrDigit(charTyped) || charTyped == '_'`；`\p{L}`/`\p{N}` 是本仓既有的
 * Unicode 口径，与 `src/completionCamelHump.ts` 同一套）；
 * `member` = `.`（`TypedAutoPopupImpl.java:31`），`'/'` 只在 `allowSlash` 时算
 *（`:32`，代码编辑器不置那个 user data，见文件头）；其余一律 `none`。
 */
export function autoPopupKind(charTyped: string, options: { allowSlash?: boolean } = {}): AutoPopupKind {
  if (charTyped === '.') return 'member'
  if (charTyped === '/' && options.allowSlash === true) return 'member'
  if (charTyped.length > 0 && /[\p{L}\p{N}_]/u.test(charTyped)) return 'word'
  return 'none'
}

/**
 * `LookupElement.isWorthShowingInAutoPopup()`（`LookupElement.java:174-177`）的等价物：
 * 默认实现 = 呈现里有尾部灰字才值得在自动弹出里显示（本仓 `Completion.detail` 就是那段灰字）。
 * 有 detail 的候选项不该被「只剩你已经打出来的那个词」这条规则吞掉。
 */
export function worthShowingInAutoPopup(detail: string | undefined): boolean {
  return typeof detail === 'string' && detail.trim() !== ''
}

/**
 * `CompletionProgressIndicator.isAlreadyInTheEditor`（`:798-805`）：从 `caret - prefixLength`
 * 到文档末尾的那一段是不是**以候选项的 lookup string 开头**（也就是这个词已经在编辑器里了）。
 * 上游 `lookup.itemPattern(item).length()` 就是候选项匹配用的那个前缀长度 —— 本仓传的是
 * 过滤用的 pattern 长度（`src/lspCompletion.ts` 里 camel-hump 匹配的那个 pattern）。
 */
export function isAlreadyInTheEditor(docText: string, caret: number, prefixLength: number, lookupString: string): boolean {
  const start = caret - prefixLength
  if (start < 0 || !lookupString) return false
  return docText.startsWith(lookupString, start)
}

/** 自动弹层要判的一条候选：`lookupString` = 接受后写进文档的文本，`detail` = 右侧灰字。 */
export interface AutoPopupCandidate {
  lookupString: string
  detail?: string
}

/**
 * `hideAutopopupIfMeaningless`（`:786-799`）：**每一条**候选都已经在编辑器里、且没有一条值得
 * 在自动弹出里显示 ⇒ 这一层没有信息，藏掉（上游随后进 `EmptyAutoPopup`）。
 * 空表不算「无意义」（那是另一档：`count == 0`），返回 false。
 */
export function autoPopupMeaningless(
  items: readonly AutoPopupCandidate[], docText: string, caret: number, prefixLength: number,
): boolean {
  if (!items.length) return false
  return items.every(item =>
    isAlreadyInTheEditor(docText, caret, prefixLength, item.lookupString) && !worthShowingInAutoPopup(item.detail))
}

/**
 * 一条前缀重启条件（`CompletionResultSet.restartCompletionOnPrefixChange` 登记的东西，
 * 上游形状是 `Pair<startOffset, ElementPattern<String>>`）。
 * `start` 是**绝对偏移**（本仓没有分段文档窗口，直接是文档偏移）。
 */
export interface RestartPrefixCondition {
  start: number
  /** 新前缀等于这个串 ⇒ 重启（`StandardPatterns.string().equalTo(...)`）。 */
  equals?: string
  /** 新前缀以这个串结尾 ⇒ 重启（`StandardPatterns.string().endsWith(...)`）。 */
  endsWith?: string
}

/**
 * `CompletionProgressIndicator.shouldRestartCompletion`（`:899-918`）：
 * `doc[start..caret) + toAppend` 命中任一条件 ⇒ true（这一拍必须重新弹）。
 * `start` 越界或为负的那条按不命中处理（上游 `:910` 的 `caretOffset >= start && start >= 0`）。
 */
export function shouldRestartCompletion(
  docText: string, caret: number, toAppend: string, conditions: readonly RestartPrefixCondition[] | undefined,
): boolean {
  for (const condition of conditions ?? []) {
    if (!condition || caret < condition.start || condition.start < 0) continue
    const prefix = docText.slice(condition.start, caret) + toAppend
    if (condition.equals !== undefined && prefix === condition.equals) return true
    if (condition.endsWith !== undefined && prefix.endsWith(condition.endsWith)) return true
  }
  return false
}

/** 一次命令补全调用点里与重启条件有关的两格（`src/completionCommands.ts` 的 `CommandInvocation` 子集）。 */
export interface CommandInvocationLike {
  /** `invocation.suffix` = 实际打到的那串后缀（`.` / `..` / `''`，`InvocationCommandType.suffix`）。 */
  suffix: string
  /** 命令文本起点（含点），`CommandCompletionProvider.kt` 里就是补全的前缀起点。 */
  start: number
}

/**
 * 命令补全登记的两条重启条件（`CommandCompletionProvider.kt:263-280` 的 `registerRestartPatterns`）：
 *   ① `endsWith(fullSuffix)`（`:271-273`，`fullSuffix = factory.suffix() + filterSuffix`）；
 *   ② 当 `patternToCheck`（只读档是 `filterSuffix`，否则 `fullSuffix`）以调用类型自己的后缀开头时，
 *      再登记一条 `equalTo(patternToRestart)`（`:275-279`）。
 * 本仓 `factory.suffix()` = `COMMAND_SUFFIX`（`.`）、`filterSuffix()` = `COMMAND_FILTER_SUFFIX`（`.`），
 * 于是默认那两条是 `endsWith('..')` 与 `equalTo('.')`。
 */
export function commandRestartConditions(
  invocation: CommandInvocationLike,
  options: { suffix?: string; filterSuffix?: string | null; readOnly?: boolean } = {},
): RestartPrefixCondition[] {
  const suffix = options.suffix ?? '.'
  const filterSuffix = options.filterSuffix === undefined ? '.' : (options.filterSuffix ?? '')
  const fullSuffix = suffix + filterSuffix
  const conditions: RestartPrefixCondition[] = [{ start: invocation.start, endsWith: fullSuffix }]
  const patternToCheck = options.readOnly === true ? filterSuffix : fullSuffix
  if (patternToCheck.startsWith(invocation.suffix)) {
    conditions.push({ start: invocation.start, equals: patternToCheck.slice(invocation.suffix.length) })
  }
  return conditions
}

/**
 * 一次「自动弹出查到空」的记录（`CompletionPhase.EmptyAutoPopup` 的可移植形状）：
 * 它记住当时的**文档与光标**（= `ActionTracker` 的快照）与这一轮补全**自己登记的重启条件**
 * （`myRestartingPrefixConditions`，`:768`/`:804` 传给 EmptyAutoPopup）。
 * 宿主只记 `path` 是为了区分「换过文件」（本仓一个编辑器实例一份闭包，path 仍要判 ——
 * 同一个组件换标签页时正文会整体换掉，靠下面的长度/前缀比较本来就挡得住，path 只是更早的闸）。
 */
export interface EmptyAutoPopupRecord {
  path: string
  doc: Text
  caret: number
  restart: readonly RestartPrefixCondition[]
}

/** 这一拍要检查的一格输入。 */
export interface EmptyAutoPopupCheck {
  path: string
  /** 敲入**之后**的文档。 */
  doc: Text
  /** 敲入**之后**的光标偏移（上游 `editor.getCaretModel().getOffset()`）。 */
  caret: number
  /** 这一拍敲进去的那个字符（上游 `toType`）。 */
  toType: string
}

/**
 * `EmptyAutoPopup.allowsSkippingNewAutoPopup`（`CompletionPhase.kt:602-608`）的三条闸：
 *   ① 同一个编辑器（本仓比 `path`）；
 *   ② `!hasAnythingHappened()` —— 文档与光标除「这一次敲入」外没有变化
 *      （正文长度只差 `toType`，且敲入点前后逐字相等）；
 *   ③ `!shouldRestartCompletion(doc, caret, toType, 记下的条件)`。
 * 三条都成立 ⇒ true = **这一拍不弹**（上游 `:604` 还会把这一次的文档变化登记成「已忽略」，
 * 于是继续打字仍然跳过）。
 */
export function emptyAutoPopupAllowsSkipping(
  previous: EmptyAutoPopupRecord | null | undefined, current: EmptyAutoPopupCheck,
): boolean {
  if (!previous || previous.path !== current.path) return false
  // ② 只有这一个字符是新的：长度差 = 敲入长度，敲入点前后逐字相等（`Text` 不可变，任何别的编辑
  // 都会让这里不等）。上游同一格的另外两档（动作发生过 / dumb 模式变了）在本仓没有对应物。
  const inserted = current.toType.length
  if (inserted <= 0) return false
  if (current.caret !== previous.caret + inserted) return false
  if (current.doc.length !== previous.doc.length + inserted) return false
  if (current.doc.sliceString(0, previous.caret) !== previous.doc.sliceString(0, previous.caret)) return false
  if (current.doc.sliceString(current.caret) !== previous.doc.sliceString(previous.caret)) return false
  // ③ 前缀重启条件命中 ⇒ 这一拍必须重新弹（`shouldRestartCompletion` 取的是整份正文 + 绝对光标，
  // 与上游 `editor.getDocument().getCharsSequence()` + `getCaretModel().getOffset()` 同形）。
  return !shouldRestartCompletion(current.doc.toString(), current.caret, current.toType, previous.restart)
}
