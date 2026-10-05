// Search Everywhere 的**跨供给者配额**（上游
// `platform/searchEverywhere/shared/src/utils/SeResultsCountBalancer.kt`）。
//
// 这个类存在的理由写在它自己的注释里（`:20-30`）：一个弹层同时问多个供给者要结果，
// 谁先返回、谁返回得多，列表就会被那一档占满。上游把供给者分三层：
//   · **nonBlocked**：不限流，随便出（`:23`）；
//   · **highPriority**：上限 = nonBlocked 那一层里出得最多的那个的数量，**并且**
//     这一层内部任意两家的条数差不超过 `DIFFERENCE_LIMIT`（`:25-26`）；
//   · **lowPriority**：上限 = nonBlocked 的最大值 **与** highPriority 的最小值，
//     但层内彼此不互相牵制（`:28-30`）。
// `DIFFERENCE_LIMIT = 15`（`:129`）。三条要从代码里抄走的细节：
//   · **命令条目不参与配平**：`add()` 开头 `if (newItem.isCommand) return newItem`
//     （`:63-69`），连日志都写明"without balancing"；
//   · 三层的初始额度都是 15：`nonBlockedCounts` 是 `AtomicInt(DIFFERENCE_LIMIT)`（`:42-44`）、
//     两层 semaphore 是 `Semaphore(DIFFERENCE_LIMIT)`（`:47-49`、`:52-54`）；
//   · **补额度的时机**是"卡住了才补"：`balancePermits()` 里
//     `if (highPriorityToAvailablePermits.values.all { it == 0 } && nonBlockedCountMaximum <= 0)`
//     才给三层各加 15（`:99-111`）；`nonBlockedRunning` 与 `highPriorityRunning` **都空了**
//     时，low 层直接 `makeItFreeToGo()`（不限流）并返回（`:89-93`）。
//
// 上游那套是协程里的挂起语义（拿不到许可就等）。本仓的 SE 列表是**一次算完**的纯函数，
// 所以等价物是：按到达顺序处理条目，拿不到许可的条目留在该供给者的队列里，等下一次补额度；
// 最后仍然没轮到的，就是被配额挡在外面的那些（上游里它们会继续等，直到该供给者结束
// `end()`）。层归属与上游同一口径：本仓把「文件」当 nonBlocked（IDEA 里文件档是
// 索引侧直出、不被别人限流），符号/动作/运行配置当 high，其余当 low —— 层归属由调用方传，
// 不在这里替上游做主张。

/** 三层的名字与上游 `SeResultsCountBalancer` 构造参数的三个集合同名。 */
export type BalanceTier = 'nonBlocked' | 'high' | 'low'

/** `DIFFERENCE_LIMIT`（`SeResultsCountBalancer.kt:129`）。 */
export const RESULTS_DIFFERENCE_LIMIT = 15

export interface BalanceItem {
  /** 供给者标识（本仓 = tab 的 source）。 */
  provider: string
  /** 上游 `SeItemData.isCommand`：命令条目直接放行（`:63-69`）。 */
  command?: boolean
}

export interface BalanceResult<T> {
  /** 拿到许可、可以进列表的那批，顺序 = 到达顺序。 */
  taken: T[]
  /** 被配额挡住的条数（上游是继续挂起等待，本仓一次算完所以只能记账）。 */
  blocked: number
  /** 每个供给者实际出了几条（面板/调试要看的"这档出了多少"）。 */
  counts: Record<string, number>
}

/**
 * 一次配平。`tiers` 里没出现的供给者按 `high` 处理（上游构造时三个集合必须覆盖全部
 * provider id，`allProvidersCounts` 就是三者之和，`:39`）。
 */
export function balanceResults<T extends BalanceItem>(
  items: readonly T[],
  tiers: Readonly<Record<string, BalanceTier>>,
  differenceLimit = RESULTS_DIFFERENCE_LIMIT,
): BalanceResult<T> {
  const queue = new Map<string, T[]>()
  for (const item of items) {
    if (!queue.has(item.provider)) queue.set(item.provider, [])
    queue.get(item.provider)!.push(item)
  }
  const providers = [...queue.keys()]
  const tierOf = (provider: string): BalanceTier => tiers[provider] ?? 'high'
  const running = new Set(providers)
  /** nonBlocked 那一层用的是计数（上游 `AtomicInt`），两层用"剩余许可"。 */
  const nonBlockedCounts = new Map<string, number>()
  const permits = new Map<string, number>()
  for (const provider of providers) {
    nonBlockedCounts.set(provider, tierOf(provider) === 'nonBlocked' ? differenceLimit : 0)
    permits.set(provider, differenceLimit)
  }
  const counts: Record<string, number> = {}
  const taken: T[] = []
  let blocked = 0

  const anyRunning = (tier: BalanceTier) => providers.some(p => running.has(p) && tierOf(p) === tier)
  /** `balancePermits()`（`:80-114`）的同步版：只在"全部卡住"时补一轮额度。 */
  const balance = () => {
    if (!anyRunning('nonBlocked') && !anyRunning('high')) {
      // low 层解除限流（`:89-93` 的 makeItFreeToGo）：给一个足够大的数。
      for (const provider of providers) if (tierOf(provider) === 'low' && running.has(provider)) permits.set(provider, Number.MAX_SAFE_INTEGER)
      return
    }
    const highRunning = providers.filter(p => running.has(p) && tierOf(p) === 'high')
    const allExhausted = highRunning.length > 0 && highRunning.every(p => (permits.get(p) ?? 0) === 0)
    const nonBlockedMaximum = Math.max(-1, ...providers
      .filter(p => running.has(p) && tierOf(p) === 'nonBlocked')
      .map(p => nonBlockedCounts.get(p) ?? 0))
    if (!(allExhausted && nonBlockedMaximum <= 0) && !(highRunning.length === 0 && nonBlockedMaximum <= 0 && anyRunning('nonBlocked'))) return
    for (const provider of providers) {
      if (!running.has(provider)) continue
      if (tierOf(provider) === 'nonBlocked') nonBlockedCounts.set(provider, (nonBlockedCounts.get(provider) ?? 0) + differenceLimit)
      else permits.set(provider, (permits.get(provider) ?? 0) + differenceLimit)
    }
  }

  // 按"到达顺序"轮转：每一圈从每个供给者取队首，保证先来先得不被某一档整段插队。
  let progressed = true
  while (progressed) {
    progressed = false
    for (const provider of providers) {
      const head = queue.get(provider)?.[0]
      if (!head) continue
      if (head.command) {
        taken.push(queue.get(provider)!.shift()!)
        counts[provider] = (counts[provider] ?? 0) + 1
        progressed = true
        continue
      }
      const tier = tierOf(provider)
      const available = tier === 'nonBlocked' ? (nonBlockedCounts.get(provider) ?? 0) : (permits.get(provider) ?? 0)
      if (available <= 0) continue
      if (tier === 'nonBlocked') nonBlockedCounts.set(provider, available - 1)
      else permits.set(provider, available - 1)
      taken.push(queue.get(provider)!.shift()!)
      counts[provider] = (counts[provider] ?? 0) + 1
      progressed = true
      balance()
    }
  }
  for (const provider of providers) blocked += queue.get(provider)?.length ?? 0
  return { taken, blocked, counts }
}
