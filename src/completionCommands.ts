// **命令补全**（上游 `platform/lang-impl/src/com/intellij/codeInsight/completion/command/**` 一族）：
// 在 `foo.` 后面打动作名（`foo..` 只看动作），接受某条时**先把点和命令文本删掉**再执行那个动作。
//
// 上游坐标（读源码的结论，全部来自 `platform/lang-impl/src/com/intellij/codeInsight/completion/command/`）：
//   · `CommandCompletionSuffixProvider.kt:23,28,30-36`：`suffix()='.'`、`filterSuffix()='.'`，
//     `supportFiltersWithDoublePrefix()=true` —— 单点是「混入成员补全」，双点 `..` 是**只**留命令。
//   · `CommandCompletionProvider.kt:651-699` `findActualIndex`：命令调用从哪个字符起算
//     （先按后缀逐级回退，再往回扫最多 30 个字母/数字/空格，最后是「行首只有空白」那条路）。
//   · `CommandCompletionProvider.kt:701-742` `findCommandCompletionType`：三种形态 ——
//     `PartialSuffix`（`foo.re`）、`FullSuffix`（`foo..`，再有一个点就返回 null）、`FullLine`（行首）。
//   · `CommandCompletionProvider.kt:237`：命令名用 `CamelHumpMatcher(prefix, false, true)`
//     过滤（大小写不敏感 + 驼峰）。
//   · `CommandCompletionProvider.kt:311-313,317,319-326`：动作类的 `presentableName` 去掉 `...`、
//     去掉 `_`；尾文本是 ` (additionalInfo)`；名字超过 50 个字符截断加 `…`。
//   · `commands/AbstractActionCompletionCommand.kt:224-229,234-241`：
//     `presentableName` = 动作文案去掉第一个 `_`、全小写、首字母大写；
//     `additionalInfo` = 该动作的**快捷键文本**（有才显示）；`isApplicable`(:103-117) 要求动作
//     存在且 `update` 后 enabled+visible；`execute`(:249-265) 就是执行动作。
//   · `CommandInsertHandler.kt:77-109` `removeCommandText`：接受后
//     `document.deleteString(commandStart, tailOffset)` 并把光标移到 `commandStart`。
//   · `CommandCompletionProvider.kt:78-80,354-355,371-372`：默认优先级 -150（低于常规候选），
//     有 priority 的按 `priority - 100.0` 参与排序。
//   · `CommandCompletionContributor.kt:41-43` 的组名 = `command.completion.title` = **Commands**
//     （`platform/lang-api/resources/messages/CodeInsightBundle.properties:585`）。
//
// 本仓的等价物：**本地动作注册表** `ACTIONS`（`src/actionRegistry.ts` 就是 `ActionManager` 的
// 对应物）—— `present()` 给 enabled/文案、`run()` 执行，正好对上 `isApplicable` 与 `execute`；
// 键位表 `keymapKeys()` 给出 `additionalInfo`（快捷键文本）。
// **一处做不到**：上游有 `CommandProvider` 扩展点让语言插件按 PSI 位置产命令
// （`CommandCompletionFactory.kt:29-35`），本仓没有 PSI，所以命令集合 = 本仓已注册的本地动作；
// 另一处不做：上游弹层里的 **Commands 分组标题**（`getGroupDisplayName`）在本仓的自绘弹层里
// 没有分组行的位置（`src/completionUi.ts` 是平铺列表），常量在下面但不渲染。

import { camelHumpMatch, localSortKey } from './completionSort.ts'
import type { ContributorItem, LocalCompletionContributor } from './completionContributors.ts'

/** `CommandCompletionSuffixProvider.kt:23`：`suffix()` 默认是 `.`。 */
export const COMMAND_SUFFIX = '.'
/** `CommandCompletionSuffixProvider.kt:28`：`filterSuffix()` 默认也是 `.`（于是完整后缀是 `..`）。 */
export const COMMAND_FILTER_SUFFIX = '.'
/** `CodeInsightBundle.properties:585`：`command.completion.title=Commands`。 */
export const COMMAND_COMPLETION_GROUP = 'Commands'
/** `CommandCompletionProvider.kt:80`：`DEFAULT_PRIORITY = -150.0`。 */
export const COMMAND_DEFAULT_PRIORITY = -150
/** `CommandCompletionProvider.kt:319-326`：名字超过 50 个字符就截断加 `…`。 */
export const COMMAND_LOOKUP_STRING_LIMIT = 50

/** `CommandCompletionProvider.kt:624-631` `InvocationCommandType` 的三种形态。 */
export type CommandInvocationKind = 'partial-suffix' | 'full-suffix' | 'full-line'

export interface CommandInvocation {
  kind: CommandInvocationKind
  /** 已打出来的命令前缀（上游 `InvocationCommandType.pattern`），过滤命令名用。 */
  pattern: string
  /** 触发用的点（`.` 或 `..`；`FullLine` 没有点）。 */
  suffix: string
  /** 命令文本起点（**含点**）—— 接受时从这里删到光标。 */
  start: number
}

/**
 * `findActualIndex` 的移植（`CommandCompletionProvider.kt:651-699`）：返回命令调用后缀
 * 离光标有多远（0 = 没找到）。两段回退：逐级匹配后缀 → 往回扫最多 30 个
 * 字母/数字/后缀字符/空格；再退到「本行到光标只有字母、空格、制表符、单引号」那条路。
 */
export function findActualIndex(suffix: string, text: string, offset: number): number {
  let indexOf = suffix.length
  if (offset > text.length || offset === 0) return 0
  while (indexOf > 0 && offset - indexOf >= 0 && text.slice(offset - indexOf, offset) !== suffix.slice(0, indexOf)) --indexOf
  if (indexOf !== 0) return indexOf
  const maxPathFind = 30
  for (let shift = 2; shift <= maxPathFind; ++shift) {
    if (offset - shift < 0) break
    const ch = text[offset - shift]!
    if (!isLetterOrDigit(ch) && !suffix.includes(ch) && ch !== ' ') break
    const filtered = text.slice(offset - shift, offset - shift + suffix.length)
    if (filtered === suffix || ch === suffix[0]) {
      // 双点后缀（`..`）要指到**整对**前面，落在中间那个点上就往前挪一位（:667-676）。
      if (suffix.length === 2 && suffix[0] === suffix[1] && offset - shift - 1 >= 0
        && text.slice(offset - shift - 1, offset - shift + suffix.length - 1) === suffix) return shift + 1
      return shift
    }
    if (suffix.includes(ch)) return 0
  }
  // 空行回退：光标之前只有字母/空格/制表符/单引号，且再往前是换行（:683-697）。
  let current = 1
  while (current <= offset) {
    const ch = text[offset - current]!
    if (!(isLetter(ch) || ch === ' ' || ch === '\t' || ch === "'")) break
    ++current
  }
  if (current <= 1 || text[offset - current] !== '\n') return 0
  while (current >= 0 && /\s/u.test(text[offset - current] ?? '')) --current
  return current > 0 ? current : 0
}

function isLetterOrDigit(char: string): boolean {
  return /[\p{L}\p{N}]/u.test(char)
}
function isLetter(char: string): boolean {
  return /\p{L}/u.test(char)
}

/**
 * `findCommandCompletionType` 的移植（`CommandCompletionProvider.kt:701-742`）。
 * 返回 null = 这里不是命令补全的调用点（普通成员补全照旧）。
 */
export function findCommandInvocation(
  text: string,
  offset: number,
  suffix: string = COMMAND_SUFFIX,
  filterSuffix: string | null = COMMAND_FILTER_SUFFIX,
): CommandInvocation | null {
  const fullSuffix = suffix + (filterSuffix ?? '')
  const indexOf = findActualIndex(fullSuffix, text, offset)
  if (offset - indexOf < 0) return null
  const invoke = (kind: CommandInvocationKind, pattern: string, invoked: string): CommandInvocation =>
    ({ kind, pattern, suffix: invoked, start: offset - indexOf })
  // 单点：`foo.` 刚敲完、命令名还没打（:715-719）。
  if (indexOf === 1 && text[offset - indexOf] === suffix)
    return invoke('partial-suffix', text.slice(offset - indexOf + 1, offset), text.slice(offset - indexOf, offset - indexOf + 1))
  // 双点：`foo..` 只留命令；再有一个点就不是这里（:721-730）。
  if (offset - indexOf + 2 <= text.length && offset >= offset - indexOf + 2
    && text.slice(offset - indexOf, offset - indexOf + 2) === fullSuffix) {
    if ((offset - indexOf - 1 >= 0 && text[offset - indexOf - 1] === suffix)
      || (offset - indexOf - 2 >= 0 && text.slice(offset - indexOf - 2, offset - indexOf) === fullSuffix)) return null
    return invoke('full-suffix', text.slice(offset - indexOf + 2, offset), text.slice(offset - indexOf, offset - indexOf + 2))
  }
  // `foo.re`：后缀在标识符里面（:731-736）。
  if (indexOf > 0 && text.startsWith(suffix, offset - indexOf))
    return invoke('partial-suffix', text.slice(offset - indexOf + 1, offset), text.slice(offset - indexOf, offset - indexOf + 1))
  // 行首整行（:737-740）。
  if (indexOf > 0) return invoke('full-line', text.slice(offset - indexOf, offset), '')
  return null
}

/** 命令补全的条目要用的动作面（`src/actionRegistry.ts` 的 `ActionRegistry` 是它的实现）。 */
export interface CommandActionSource {
  ids: () => readonly string[]
  titleOf: (id: string) => string
  /** `ActionCommandProvider.isApplicable`（:103-117）：动作不存在或不可用就不出现。 */
  isAvailable: (id: string) => boolean
  /** `ActionCompletionCommand.additionalInfo`（:234-241）：动作的快捷键文本，没有就不显示。 */
  keysOf: (id: string) => string | undefined
}

export interface CommandItem {
  /** 弹层里显示的名字（上游的 `lookupString`）。 */
  label: string
  /** 动作 id：接受后执行它。 */
  actionId: string
  /** 排序键（本地条目恒排在服务端候选之后，见 `completionSort.ts` 的 `LOCAL_SORT_PREFIX`）。 */
  sortText: string
  /** 右侧灰字：快捷键文本（上游 `tailText`，`CommandCompletionProvider.kt:317`）。 */
  detail: string
  /** 命令文本起点（**含点**），接受时从这里删到光标。 */
  commandFrom: number
  /** 优先级（上游 `CompletionCommand.priority`，越大越靠前）。 */
  priority: number
}

/**
 * 上游的名字整形（`CommandCompletionProvider.kt:311-313,319-326` + `AbstractActionCompletionCommand.kt:224-229`）：
 * 去掉结尾的 `...`/`…`、去掉 `_`、超过 50 个字符截断。
 */
export function commandLabel(title: string): string {
  const trimmed = title.replace(/\.\.\.$/, '').replace(/…$/, '').replace(/_/g, '').trim()
  return trimmed.length > COMMAND_LOOKUP_STRING_LIMIT
    ? trimmed.slice(0, COMMAND_LOOKUP_STRING_LIMIT) + '…'
    : trimmed
}

/**
 * 列出这个位置可用的命令条目（上游 `CommandCompletionProvider.kt:237-259` 的过滤 + `createLookupElements`）。
 * 过滤用 `CamelHumpMatcher(prefix, false, true)` 的等价物 —— 本仓的 `camelHumpMatch` 本来就是
 * 大小写不敏感的（它把输入前缀小写化），所以 `ren` 命中 `Rename`、`rn` 也命中 `Rename`。
 */
export function collectCommands(
  invocation: CommandInvocation,
  source: CommandActionSource,
  priorities: Readonly<Record<string, number>> = {},
): CommandItem[] {
  // 没有前缀时不过滤（上游 `baseMatcher.prefixMatches` 对空前缀全过，`CommandCompletionProvider.kt:252`）。
  const matches = invocation.pattern
    ? (label: string) => label.toLowerCase().startsWith(invocation.pattern.toLowerCase())
      || camelHumpMatch(label, invocation.pattern)
    : () => true
  const items: CommandItem[] = []
  for (const id of source.ids()) {
    if (!source.isAvailable(id)) continue
    const label = commandLabel(source.titleOf(id))
    if (!label || !matches(label)) continue
    const priority = priorities[id] ?? COMMAND_DEFAULT_PRIORITY
    const keys = source.keysOf(id)
    items.push({
      label,
      actionId: id,
      // 优先级越大越靠前；组号 1 让命令条目排在文档词（组 0）之前，两者都在服务端候选之后。
      sortText: localSortKey(1, `${String(priority - COMMAND_DEFAULT_PRIORITY).padStart(4, '0')}${label}`),
      detail: keys ? `(${keys})` : '',
      commandFrom: invocation.start,
      priority,
    })
  }
  return items
}

/** 贡献者 id（上游 `completion.contributor id=CommandCompletionContributor`）。 */
export const COMMAND_CONTRIBUTOR_ID = 'command-completion'

/**
 * 命令补全贡献者：位置不是命令调用点就一条都不给（`CommandCompletionProvider.kt:186`
 * `findCommandCompletionType(...) ?: return`）。它 `mode: 'always'` —— 与语义条目并排，
 * 只有 `..` 那种形态才会把别的条目挤掉（上游 `supportFiltersWithDoublePrefix()` 的语义，
 * `CommandCompletionSuffixProvider.kt:30-36`；由调用方按形态决定，本贡献者自己不知道）。
 */
export function commandCompletionContributor(
  source: CommandActionSource,
  priorities: Readonly<Record<string, number>> = {},
): LocalCompletionContributor {
  return {
    id: COMMAND_CONTRIBUTOR_ID,
    contribute: context => {
      const invocation = findCommandInvocation(context.text, context.offset)
      if (!invocation) return []
      return collectCommands(invocation, source, priorities).map((item): ContributorItem => ({
        label: item.label,
        sortText: item.sortText,
        detail: item.detail,
        kind: 'command',
        action: { id: item.actionId, from: item.commandFrom },
      }))
    },
  }
}
