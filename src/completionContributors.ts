// 补全的**本地贡献者**（上游 `platform/lang-impl/src/com/intellij/codeInsight/completion/`：
// `CompletionContributor` 挂在 EP 上，按位置/模式登记条目；`CompletionService` 汇总语言服务侧与
// 本地贡献者的结果再去重）。本仓的补全条目全部来自 LSP（`src/lspCompletion.ts`）——
// 语言服务没就绪、或服务端不认的位置（注释/字符串里想补个词），弹层就是空的。
//
// 这里补上**本地贡献者通道** + 第一个真能跑的内置贡献者：**文档词补全**（上游
// `WordCompletionContributor` 一族，Alt+/ 的手势；本仓把结果并进普通补全，前缀够长才触发）。
// 之所以选它：它不依赖 PSI/语言服务，纯文本就能算对 —— 而且这正是「服务端没回条目时
// 用户仍能补全」的那条路。
//
// 与语言服务的合流口径：同名候选（大小写不敏感）以**服务端**为准（它的 kind/detail 更准），
// 本地词只补服务端没有的；本地条的 `sortText` 加 `~` 前缀排在服务端候选之后。

import { camelHumpMatch, localSortKey } from './completionSort.ts'

/** 一条本地补全候选（`CompletionResultSet.addElement` 的最小字段集）。 */
export interface ContributorItem {
  label: string
  /** 插入文本。命令条目没有 —— 它接受时是「删掉命令文本 + 执行动作」。 */
  insertText?: string
  /** 排序键：本地条目一律带 `!` 前缀（`completionSort.ts` 的 `LOCAL_SORT_PREFIX`），排在服务端之后。 */
  sortText: string
  /** 展示给用户的说明（词条放出现次数；命令条目放快捷键文本）。 */
  detail: string
  kind: 'word' | 'command'
  /** `kind === 'command'` 时有：执行哪个动作、从哪删（`CommandInsertHandler.kt:96-103`）。 */
  action?: { id: string; from: number }
}

export interface WordCompletionOptions {
  /** 前缀最短长度（默认 2：一个字符的前缀会从整份文档里捞出噪声）。 */
  minPrefix?: number
  /** 最多返回多少条（默认 50，与补全弹层的常见上限一致）。 */
  limit?: number
  /** 忽略大小写匹配（默认 true，与 IDEA 的 `CompletionUtil` 默认一致）。 */
  ignoreCase?: boolean
}

/** 词补全的贡献者 id（服务端候选重叠时按这个 id 记来源）。 */
export const WORD_CONTRIBUTOR_ID = 'word-completion'

const WORD = /[$\p{L}_][$\p{L}\p{N}_]*/gu

/** 光标处的标识符前缀：返回 `{ prefix, from }`（`from` 是前缀起点，全文档偏移）。 */
export function identifierPrefixAt(text: string, offset: number): { prefix: string; from: number } {
  const end = Math.max(0, Math.min(text.length, offset))
  let from = end
  while (from > 0) {
    const char = text[from - 1]
    if (char === undefined) break
    if (/[$\p{L}\p{N}_]/u.test(char)) --from
    else break
  }
  return { prefix: text.slice(from, end), from }
}

/**
 * 文档词补全：扫全文标识符、按前缀过滤、按「出现次数降序 → 离光标近优先 → 字母序」排序。
 *
 * 细节都按上游的词补全口径：
 *   · 光标所在的那个词自己不出现（补全自己没有任何信息量）；
 *   · 纯数字词不补（`123` 不是标识符）；
 *   · 全大写的词（常量）与驼峰词都保留 —— 它们正是词补全最常用的场景；
 *   · 前缀不区分大小写，但**大小写一致的出现优先**（`Foo` 精确匹配 `Fo` 排在 `foo` 前面）；
 *   · 前缀还能按**驼峰**命中（`CamelHumpMatcher` 的保守子集，见 `src/completionSort.ts` 的
 *     `camelHumpMatch`）：`gN` 命中 `getName`，与 IDEA 默认开着的驼峰匹配同一档。
 */
export function collectWordCompletions(text: string, offset: number, options: WordCompletionOptions = {}): ContributorItem[] {
  const minPrefix = Number.isInteger(options.minPrefix) ? Math.max(0, options.minPrefix as number) : 2
  const limit = Number.isInteger(options.limit) ? Math.max(1, options.limit as number) : 50
  const ignoreCase = options.ignoreCase !== false
  const { prefix, from } = identifierPrefixAt(text, offset)
  if (prefix.length < minPrefix) return []
  // 光标处的整个词（不只是前缀）—— 它已经在编辑器里，不该再作为候选。
  const tail = /^[$\p{L}\p{N}_]*/u.exec(text.slice(offset))?.[0] ?? ''
  const current = prefix + tail
  const counts = new Map<string, { count: number; last: number }>()
  // 驼峰匹配只在前缀本身是个标识符开头时启用：`12` 这种数字片段是「正在打数字」，
  // 按驼峰硬命中 `foo12` 是造噪声（上游 `CamelHumpMatcher` 的 pattern 也是标识符形态）。
  const camelEligible = /^[$\p{L}_]/u.test(prefix)
  WORD.lastIndex = 0
  for (let match = WORD.exec(text); match; match = WORD.exec(text)) {
    const word = match[0]
    if (word.length < prefix.length) continue
    const head = word.slice(0, prefix.length)
    const plain = ignoreCase ? head.toLowerCase() === prefix.toLowerCase() : head === prefix
    if (!plain && !(camelEligible && camelHumpMatch(word, prefix))) continue
    if (word === current) continue
    const entry = counts.get(word) ?? { count: 0, last: -1 }
    entry.count += 1
    if (entry.last < 0 || Math.abs(match.index - from) < Math.abs(entry.last - from)) entry.last = match.index
    counts.set(word, entry)
  }
  const exact = (word: string) => word.slice(0, prefix.length) === prefix ? 0 : 1
  return [...counts.entries()]
    .sort((left, right) => exact(left[0]) - exact(right[0]) || right[1].count - left[1].count
      || Math.abs(left[1].last - from) - Math.abs(right[1].last - from) || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([word, entry]) => ({
      label: word,
      insertText: word,
      sortText: localSortKey(0, `${String(entry.count).padStart(4, '0')}${word}`),
      detail: `${entry.count} 次出现`,
      kind: 'word',
    }))}

/**
 * 本地贡献者什么时候参与。上游把这件事交给 EP 与贡献者自己的触发判定：
 * `WordCompletionContributor` 是 `order="last, before TextMateCompletionContributor"` 的普通贡献者，
 * 但只要**有 LSP 客户端接管了这个文件**就被禁掉 —— `LspCompletionContributor.kt:45`
 * `putUserData(BaseCompletionService.FORBID_WORD_COMPLETION, true)`，
 * 而且是「服务器声明了 `completionProvider` 就禁」（`:40`），不看这一次有没有回条目。
 * 命令补全没有这条禁令：它是**另一个**贡献者（`completion.contributor id=CommandCompletionContributor`），
 * 与语义候选并排出现在同一个 `CompletionResultSet` 里（`CommandCompletionProvider.kt:123-139`
 * 先 `runRemainingContributors` 把别人的结果放行，再加命令条目）。
 */
export type ContributorMode =
  /** 总是参与（与 LSP 条目并排）。 */
  | 'always'
  /** 只在语言服务一条都没回时参与（文档词补全）。 */
  | 'fallback'

/** 一个本地贡献者：语言过滤 + 触发判定 + 产条目。 */
export interface LocalCompletionContributor {
  id: string
  /** 适用语言（空 = 全部）。 */
  languages?: readonly string[]
  /** 参与时机（默认 `always`）。 */
  mode?: ContributorMode
  /** 这个位置要不要触发（默认：任何位置）。 */
  accept?: (context: ContributorContext) => boolean
  contribute: (context: ContributorContext) => ContributorItem[]
}

export interface ContributorContext {
  text: string
  offset: number
  language: string
  /** 光标是不是在注释/字符串里（本地贡献者据此放宽/收紧触发）。 */
  inCommentOrString?: boolean
}

/** 内置的文档词贡献者：前缀 ≥ 2 就在任何位置触发（注释里也算 —— 那正是它最有用的地方）。 */
export function wordCompletionContributor(options: WordCompletionOptions = {}): LocalCompletionContributor {
  return {
    id: WORD_CONTRIBUTOR_ID,
    mode: 'fallback',
    contribute: context => collectWordCompletions(context.text, context.offset, options),
  }
}

/** 贡献者注册表：按 id 覆盖注册；`contributeAll` 展平所有适用贡献者的条目。 */
export interface ContributorRegistry {
  register: (contributor: LocalCompletionContributor) => void
  contributors: () => readonly LocalCompletionContributor[]
  contributeAll: (context: ContributorContext, mode?: ContributorMode) => ContributorItem[]
}

export function createContributorRegistry(initial: readonly LocalCompletionContributor[] = [wordCompletionContributor()]): ContributorRegistry {
  const table = new Map<string, LocalCompletionContributor>()
  for (const contributor of initial) table.set(contributor.id, contributor)
  return {
    register: contributor => { table.set(contributor.id, contributor) },
    contributors: () => [...table.values()],
    contributeAll: (context, mode = 'always') => {
      const items: ContributorItem[] = []
      for (const contributor of table.values()) {
        if ((contributor.mode ?? 'always') !== mode) continue
        if (contributor.languages && contributor.languages.length && !contributor.languages.includes(context.language)) continue
        if (contributor.accept && !contributor.accept(context)) continue
        for (const item of contributor.contribute(context))
          if (typeof item.label === 'string' && item.label !== '') items.push(item)
      }
      return items
    },
  }
}

/**
 * 与服务端候合并：同 `label`（大小写不敏感）以服务端为准，本地条目只补空缺。
 * 输入是两侧的最小形状（`label` / `insertText` / `sortText`），不依赖 `lspCompletion.ts`。
 */
export function mergeWithServerItems<T extends { label: string; insertText?: string; sortText?: string }>(
  server: readonly T[], local: readonly ContributorItem[],
): Array<T | ContributorItem> {
  const taken = new Set(server.map(item => item.label.toLowerCase()))
  const fillers = local.filter(item => !taken.has(item.label.toLowerCase()))
  return [...server, ...fillers]
}
