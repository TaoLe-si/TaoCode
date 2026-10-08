// 补全的**排序器扩展点**（上游 `CompletionSorter` / `LookupElementWeigher` / `CompletionSorterImpl`
// 一族）—— 纯函数，零 Vue、零 DOM。
//
// `src/completionSort.ts` 把默认那条**档位链**写死成一个 `compareCompletions`；上游不是写死的：
//   · `CompletionLookupArranger.arrange`（`platform/analysis-impl/src/com/intellij/codeInsight/
//     completion/CompletionLookupArranger.java:16,25`）收一个 `CompletionSorter`；
//   · `CompletionSorter`（`platform/analysis-api/src/com/intellij/codeInsight/completion/
//     CompletionSorter.java:22-40`）是三件套 —— `weighBefore(beforeId, ...weighers)`、
//     `weighAfter(afterId, ...weighers)`、`weigh(weigher)`，都是**往链里插一档**并返回新排序器；
//   · `CompletionSorterImpl`（`platform/analysis-impl/.../impl/CompletionSorterImpl.java:18`）把
//     每个 weigher 折成 `weighingFactory`（`:39-53`）的 `ClassifierFactory`，`withClassifier`
//     （`:68-75`）按 `idIndex(anchorId)`（`:105-107`）算出插入位次，`weigh`（`:64`）追加到末尾；
//   · `LookupElementWeigher`（`platform/analysis-api/src/com/intellij/codeInsight/lookup/
//     LookupElementWeigher.java:10-48`）三个字段：`id`（`toString()` 就是链上的锚点）、
//     `negated`（升序取反）、`prefixDependent`（依赖已输入前缀）；`weigh()` 返回 `Comparable`
//     或 **null**（"这一档不参与"）；
//   · 谁插进来：`BaseCompletionService.defaultSorter`（`platform/analysis-impl/.../
//     BaseCompletionService.java:204-240`）先 `addWeighersBefore`（`:193-195`，扩展点）、再
//     `PreferStartMatching`（`:210`），然后**遍历 `WeighingService.getWeighers(RELEVANCE_KEY)`**
//     （`:213`）—— 其中 `"prefix"` 换成 `RealPrefixMatchingWeigher`（`:215-217`），其余逐个
//     `sorter.weigh(...)`（`:222-229`）；最后 `liftShorter` 插在 `"priority"` 之前（`:232-239`）。
//     本仓的 `completionSort.ts` 那条链（预选 → LSP 相关性 → 匹配形状 → 大小写 → 长度 → 字母序）
//     正是这条默认链在本仓的等价物，逐档 id 见下面的 `DEFAULT_WEIGHER_IDS`。
//
// 本文件补的是**扩展面**：默认链拆成命名档位，调用方（或插件）能照上游那三个方法往链里插自己的
// 档位；`WeighingService.getWeighers(key)` 的等价物是 `registerCompletionWeigher(key, weigher)`
// + `completionSorterFor(key)`。默认注册表为空时，`completionSorterFor('completion').sort(...)`
// 与 `completionSort.ts` 的 `sortCompletions(...)` **逐条同序**（判据
// `tests/completion-sorter.test.mjs` 钉住这条等价）。
//
// **一处做不到**：上游 `negated` 那一位在本仓只用于 `completion`（LSP `sortText` 的
// `ReverseComparableString` 取反，见 `completionSort.ts:123-129`）；其余档位上游也都传
// `negated=true`（`BaseCompletionService.java:222`），但它们的 `weigh()` 已经把方向算进返回值里
// （如 `PreferStartMatching.weigh` 返回 `!isStartMatch`），本仓照这条口径：档位自己给方向，
// `negated` 只在需要**原样反转**外部给的键时才用。

import {
  completionMatchRank,
  type SortableCompletion,
} from './completionSort.ts'
import { EXTENSIONS } from './extensionPoints.ts'
// 扩展点 `com.intellij.weigher`（上游 `WeighingService.getWeighers(key)`）：注册面同时写 EP、
// 取用面 `completionSorterFor` 从 EP 收编第三方直接挂进来的权重（dedup by id）。
import { WEIGHER_EP, weighersFor, type WeigherContribution } from './completionExtensionPoints.ts'

/** `weigh()` 的返回：可比较的键，或 `null` = 这一档不参与（上游 `ComparingClassifier` 的 nulls 桶）。 */
export type WeigherKey = number | string | null | undefined

/** 一个档位的上下文（`WeighingContext` 的最小字段集：本仓排序只用到已输入前缀）。 */
export interface WeighingContext {
  /** 光标前已经打出来的那段；同一次结果里每条都一样。 */
  typedPrefix?: string
}

/**
 * 一个排序档位（`LookupElementWeigher` 的等价物）。
 *   · `id`：链上的锚点，`weighBefore`/`weighAfter` 按它定位（上游 `toString()`）；
 *   · `negated`：`true` 时这一档的比较结果取反（上游 `myNegated`）；
 *   · `prefixDependent`：这一档依赖已输入前缀（上游 `myPrefixDependent`，仅作元数据）；
 *   · `weigh`：给出这一档的键；`null`/`undefined` = 不参与。
 */
export interface LookupElementWeigher {
  id: string
  negated?: boolean
  prefixDependent?: boolean
  weigh: (element: SortableCompletion, context: WeighingContext) => WeigherKey
  /**
   * 这一档怎么比较两个非 null 键（返回 <0/0/>0）。缺省 = 数字相减、字符串按码元序。
   * 默认链里 `casefold`/`alpha` 两档显式给 `localeCompare`，因为 `completionSort.ts` 的
   * 默认链就是用它 —— 少了这一格，默认链会在非 ASCII 标签上与原链分叉。
   */
  compare?: (left: WeigherKey, right: WeigherKey) => number
}

/** 默认链的档位 id（顺序即比较顺序）—— `completionSort.ts` 的六档逐条对位。 */
export const DEFAULT_WEIGHER_IDS = ['preselected', 'completion', 'prefix', 'casefold', 'liftShorter', 'alpha'] as const

/** `WeighingService.getWeighers(key)` 的注册键。LSP 相关性那一档在上游的注册键就是 `completion`
 *  （`platform/lsp-impl/resources/intellij.platform.lsp.impl.xml:86-89` 的 `<weigher key="completion"
 *  order="after priority, before prefix">`）。 */
export const RELEVANCE_KEY = 'completion'

/** 默认链：`completionSort.ts` 那六档拆成命名档位（每档返回一个键，逐档比较、先分出胜负的说了算）。 */
export function defaultWeighers(): LookupElementWeigher[] {
  return [
    // ① LSP `preselect`：协议里的「默认选中那条」排最前。
    { id: 'preselected', prefixDependent: true, weigh: element => (element.preselected ? 0 : 1) },
    // ② LSP 相关性：`LspCompletionWeigher` 装的是 `ReverseComparableString`（降序），
    //    没有 `sortText` 的返回 null（落进 nulls 桶，排在有 sortText 的之后）。
    {
      id: 'completion', negated: true, prefixDependent: true,
      weigh: element => (typeof element.sortText === 'string' ? element.sortText : null),
    },
    // ③ 匹配形状（`RealPrefixMatchingWeigher` 的 `-matchingDegree` 在本仓的等价物）：
    //    只在两边同一次输入（同一个 typedPrefix）时才可比，否则整档不参与。
    {
      id: 'prefix', prefixDependent: true,
      weigh: (element, context) => (context.typedPrefix ? completionMatchRank(element.label, context.typedPrefix) : null),
    },
    // ④ 大小写不敏感字典序（让 foo 与 Foo 相邻）。
    {
      id: 'casefold', weigh: element => element.label.toLowerCase(),
      compare: (left, right) => String(left).localeCompare(String(right)),
    },
    // ⑤ 长度（`liftShorter`，上游 `LiftShorterItemsClassifier`）：短者先。
    { id: 'liftShorter', weigh: element => element.label.length },
    // ⑥ 区分大小写的字母序（最终稳定档）。
    {
      id: 'alpha', weigh: element => element.label,
      compare: (left, right) => String(left).localeCompare(String(right)),
    },
  ]
}

/** 比较两个键（同型才可比；`null`/`undefined` 由调用方先行处理）。 */
function compareKeys(weigher: LookupElementWeigher, left: WeigherKey, right: WeigherKey): number {
  if (weigher.compare) return weigher.compare(left, right)
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'string' && typeof right === 'string') return left < right ? -1 : left > right ? 1 : 0
  // 型不同（数字对字符串）不是同一档的键：退化成「都当不参与」，交给下一档。
  return 0
}

/** 排序器（`CompletionSorter` 的等价物）：一条有序档位链 + 按它排序的能力。 */
export interface CompletionSorter {
  /** 当前档位链（只读快照）。 */
  weighers: () => readonly LookupElementWeigher[]
  /** 追加一档到链尾（上游 `weigh`）。 */
  weigh: (weigher: LookupElementWeigher) => CompletionSorter
  /** 插在 `beforeId` 那一档**之前**（上游 `weighBefore`；锚点找不到时按上游 `Math.max(0, i)` 落在链首）。 */
  weighBefore: (beforeId: string, ...weighers: LookupElementWeigher[]) => CompletionSorter
  /** 插在 `afterId` 那一档**之后**（上游 `weighAfter`；锚点找不到时按上游 `i + 1` 落在链尾）。 */
  weighAfter: (afterId: string, ...weighers: LookupElementWeigher[]) => CompletionSorter
  /** 按谓词删档（上游 `withoutClassifiers`）。 */
  withoutClassifiers: (remove: (weigher: LookupElementWeigher) => boolean) => CompletionSorter
  /** 两两比较（不改原对象）。 */
  compare: (left: SortableCompletion, right: SortableCompletion) => number
  /** 排序（不改原数组）。 */
  sort: <T extends SortableCompletion>(list: readonly T[]) => T[]
}

/** 从一条档位链造排序器。`weighers` 的顺序即比较顺序。 */
export function createCompletionSorter(weighers: readonly LookupElementWeigher[] = defaultWeighers()): CompletionSorter {
  const chain = [...weighers]

  function indexOfAnchor(id: string): number {
    return chain.findIndex(weigher => weigher.id === id)
  }

  function insertAt(index: number, added: readonly LookupElementWeigher[]): LookupElementWeigher[] {
    const copy = [...chain]
    copy.splice(Math.max(0, Math.min(copy.length, index)), 0, ...added)
    return copy
  }

  function compare(left: SortableCompletion, right: SortableCompletion): number {
    const context: WeighingContext = { typedPrefix: left.typedPrefix === right.typedPrefix ? left.typedPrefix : undefined }
    for (const weigher of chain) {
      const leftKey = weigher.weigh(left, context)
      const rightKey = weigher.weigh(right, context)
      const leftNull = leftKey === null || leftKey === undefined
      const rightNull = rightKey === null || rightKey === undefined
      if (leftNull && rightNull) continue
      // 不参与的那一边排后面（上游 `ComparingClassifier` 的 nulls 桶恒在末尾）。
      if (leftNull) return 1
      if (rightNull) return -1
      const order = compareKeys(weigher, leftKey, rightKey)
      if (order === 0) continue
      return weigher.negated ? -order : order
    }
    return 0
  }

  return {
    weighers: () => chain,
    weigh: weigher => createCompletionSorter([...chain, weigher]),
    weighBefore: (beforeId, ...added) => {
      const index = indexOfAnchor(beforeId)
      return createCompletionSorter(insertAt(index < 0 ? 0 : index, added))
    },
    weighAfter: (afterId, ...added) => {
      const index = indexOfAnchor(afterId)
      return createCompletionSorter(insertAt(index < 0 ? chain.length : index + 1, added))
    },
    withoutClassifiers: remove => createCompletionSorter(chain.filter(weigher => !remove(weigher))),
    compare,
    sort: <T extends SortableCompletion>(list: readonly T[]): T[] => [...list].sort(compare),
  } as CompletionSorter
}

// ── `WeighingService.getWeighers(key)` 的等价物：按注册键收档位 ──────────────────────────
// 注册进来的档位插在 `prefix` 之后、`casefold` 之前 —— 也就是上游 `defaultSorter` 里
// 「遍历 getWeighers(RELEVANCE_KEY)」那一段的位次（`:213-229`）：它们在相关性区里参与，
// 但排在大小写/长度/字母序这些**确定性兜底**档之前。
const REGISTERED = new Map<string, LookupElementWeigher[]>()

/** 注册一个档位（上游 `WeighingService` 的注册面）。同 id 覆盖：后注册的赢。
 * **2026-10-06 本 lane 补**：同时登记进扩展点 `com.intellij.weigher`（`key` = 上游的注册键），
 * 于是第三方插件按同一个 EP id / key 挂的权重与这里的注册面共处一条链。 */
export function registerCompletionWeigher(key: string, weigher: LookupElementWeigher): void {
  const list = REGISTERED.get(key) ?? []
  REGISTERED.set(key, [...list.filter(entry => entry.id !== weigher.id), weigher])
  if (EXTENSIONS.hasExtensionPoint(WEIGHER_EP)) {
    const contribution: WeigherContribution = {
      id: weigher.id, key, negated: weigher.negated, prefixDependent: weigher.prefixDependent,
      weigh: (element, location) => weigher.weigh(element as SortableCompletion, location),
      ...(weigher.compare ? { compare: weigher.compare } : {}),
    }
    EXTENSIONS.registerExtension(WEIGHER_EP, weigher.id, contribution, { source: 'user' })
  }
}

/** 注销一个档位（按 id）。返回是否真的删掉了。 */
export function unregisterCompletionWeigher(key: string, id: string): boolean {
  const list = REGISTERED.get(key)
  if (!list) return false
  const next = list.filter(entry => entry.id !== id)
  if (next.length === list.length) return false
  REGISTERED.set(key, next)
  if (EXTENSIONS.hasExtensionPoint(WEIGHER_EP)) EXTENSIONS.unregisterExtension(WEIGHER_EP, id)
  return true
}

/**
 * 清空注册表（测试与关项目用）。**只清 source === 'user' 的 EP 贡献**，bundled 的
 * `completion` 档留着（它在默认链里按 id 去重，不改变链）。
 */
export function clearCompletionWeighers(): void {
  REGISTERED.clear()
  for (const entry of EXTENSIONS.allEntries<WeigherContribution>(WEIGHER_EP)) {
    if (entry.source === 'user') EXTENSIONS.unregisterExtension(WEIGHER_EP, entry.id)
  }
}

/** 当前注册的档位（按注册顺序）—— 只读快照。 */
export function registeredWeighers(key: string): readonly LookupElementWeigher[] {
  return REGISTERED.get(key) ?? []
}

/**
 * 取某个键的排序器：默认链 + 该键注册的档位（插在 `prefix` 之后、`casefold` 之前）。
 * 没有注册档位时，返回的就是纯默认链 ⇒ 与 `completionSort.ts` 的 `sortCompletions` 同序。
 *
 * **2026-10-06 本 lane 补**：候选来自两处 —— 私有注册表 `registerCompletionWeigher` 与扩展点
 * `com.intellij.weigher`（`key` 匹配）。按 id 去重（同 id 只留一份），且**已在默认链里的 id**
 * （如 bundled 的 `completion` 档）不重复插档 ⇒ 没有第三方注册时链仍是默认链。
 */
export function completionSorterFor(key: string = RELEVANCE_KEY): CompletionSorter {
  const base = createCompletionSorter()
  const fromMap = registeredWeighers(key)
  const seen = new Set(fromMap.map(weigher => weigher.id))
  const extra: LookupElementWeigher[] = [...fromMap]
  for (const contribution of weighersFor(key)) {
    if (seen.has(contribution.id)) continue
    if ((DEFAULT_WEIGHER_IDS as readonly string[]).includes(contribution.id)) continue
    seen.add(contribution.id)
    extra.push(contribution as unknown as LookupElementWeigher)
  }
  return extra.length ? base.weighAfter('prefix', ...extra) : base
}
