// 「转到哈希/分支/标记」—— 日志工具条右角那个查找框（上游 `Vcs.Log.GoToRef`）。
//
// 上游是 `GoToHashOrRefAction`（`ui/actions/GoToHashOrRefAction.java:24-49`），
// 注册在 `intellij.platform.vcs.log.impl.xml:179-180`，挂在 `Vcs.Log.Toolbar.RightCorner`
// （`:285-291`）。动作打开 `GoToHashOrRefPopup`：一个标题为
// `vcs.log.go.to.hash.popup.label`（= 输入哈希或分支/标记名称:）的输入框 + 补全，
// 回车后先当**引用**试（`jumpToRefOrHash`：取名字前缀匹配到的第一个引用，
// `VcsLogNavigationUtil.kt:124-149`），再当**哈希**试（`jumpToHash`，`:166-172`）。
// 形状不像是哈希时报 `vcs.log.string.is.not.a.hash`（= '{0}' does not look like a commit hash），
// 找不到时报 `vcs.log.commit.not.found`（= {0} not found）。
//
// 本仓的等价物：同一个输入框 + 同一份前缀补全 + 同一个「引用先、哈希后」的顺序，
// 落地走 `useVcsLogData.navigate()`（`src/vcsLogData.ts`）—— 它已经会按需用
// `git.logFull { refs:[hash] }` 打开那次提交的历史。
// 补全候选 = **当前已加载这一页上出现过的引用**（`dataPack.refs` 的等价物：本仓没有
// 独立的引用索引，日志行上的 ref chip 就是它）；上游那份还跨了索引与分页，本仓不假装有。

import type { GitFullCommit } from './bridge'

/** `action.Vcs.Log.GoToRef.text` = 转到哈希/分支/标记。 */
export const GO_TO_REF_TITLE = '转到哈希/分支/标记'
/** `action.Vcs.Log.GoToRef.description` = 指定分支或标记的哈希或名称，以导航到其指向的提交。 */
export const GO_TO_REF_DESCRIPTION = '指定分支或标记的哈希或名称，以导航到其指向的提交'
/** `vcs.log.go.to.hash.popup.label` = 输入哈希或分支/标记名称: */
export const GO_TO_REF_PROMPT = '输入哈希或分支/标记名称:'
/** `vcs.log.commit.not.found` = {0} not found。 */
export const GO_TO_REF_NOT_FOUND = '{0} not found'

/**
 * `VcsLogUtil.GIT_HASH_PREFIX_REGEX` 那一档的判据：全十六进制、长度 4..40。
 * git 的缩写短哈希最少 4 位（`core.abbrev` 下限），sha-1 是 40 位，sha-256 是 64 位 ——
 * 后者按前缀匹配一样能落到 `rev-parse`，所以上限放到 64。
 */
export const MIN_HASH_LENGTH = 4
export const MAX_HASH_LENGTH = 64
export function looksLikeHash(value: string): boolean {
  return /^[0-9a-fA-F]{4,64}$/.test(value.trim())
}

/** `vcs.log.string.is.not.a.hash`：`'{0}' does not look like a commit hash`。 */
export function notAHashMessage(value: string): string {
  return `'${value}' 不像是一个提交哈希`
}

/** 当前已加载提交上出现过的引用，去重后按名字排 —— 补全候选。 */
export function goToRefCandidates(commits: readonly GitFullCommit[]): string[] {
  const names = new Set<string>()
  // 名字为空白的那一条不收：`VcsRef.getName()` 在上游不可能是空的（`vcs-log/api/.../VcsRef.java`
  // 的引用一律带名字），而本仓的 refs 是从 `git log --format=%D` 拆出来的，拆分边角可能给出空串 ——
  // 那样会在补全里画出一行空白候选，点了什么也不跳（等于假控件）。
  for (const commit of commits) for (const ref of commit.refs ?? []) if (ref.name?.trim()) names.add(ref.name)
  return [...names].sort((left, right) => left.localeCompare(right))
}

/** `GoToHashOrRefPopup` 的补全是**前缀**匹配（`VcsLogNavigationUtil.kt:134-137` 的 startsWith）。 */
export function goToRefMatches(candidates: readonly string[], prefix: string, limit = 12): string[] {
  const needle = prefix.trim()
  if (!needle) return []
  return candidates.filter(name => name.startsWith(needle)).slice(0, limit)
}

/**
 * 两批候选 —— 上游 `VcsRefCompletionProvider.java:26-38`：
 *   · `collectSync`  = **分支**（本地 stored refs，`getBranches(myRefs).stream()`）⇒ 立刻进结果集；
 *   · `collectAsync` = **非分支**的那一半（`allRefsStream(myRefs).filter(ref -> !ref.getType().isBranch())`，
 *     标签等），在池线程上取，`TwoStepCompletionProvider.java:43-58` 每 `TIMEOUT = 100`（`:32`）取一轮，
 *     回来一批 `addValues` 追加一批；`ProgressManager.checkCanceled()`（`:44`）/ 异常（`:52-58`）就停。
 *
 * 候选的**范围**也照这一份：上游给弹层的是 `dataPack.getRefs()`（`GoToHashOrRefAction.java:44`），
 * 而它的类型是 `VcsLogAggregatedStoredRefs`（`VcsLogDataPack.java:29`）= "**all** VCS roots 的全部 stored refs"
 * （`VcsLogAggregatedStoredRefs.kt:24`）—— 不是"已加载那一页上的引用"。本仓原来只有后者，
 * 所以第一页没出现的分支/标记在补全里根本不存在（用户输 `v1.` 一个候选都看不到）。
 *
 * 本仓的两批映射（都在宿主已有的两个方法上，不需要新通道）：
 *   · 第一批 = 已在内存里的那些名字（已加载页的引用）+ `git.status` 的 `branches`（`native/main.cpp:1135`
 *     那一句 `taocode::git::branches`）—— 对应 `collectSync`；
 *   · 第二批 = `git.tags` 的标签（`native/git.hpp:102`）—— 对应 `collectAsync` 那一半非分支引用。
 * 上游的 100ms 是**池线程轮询预算**（`future.get(TIMEOUT)`），不是界面节奏；本仓的来源本身就是一次
 * `await`，所以这里没有定时器要钉 —— 要钉的是那三条行为：先到先出、后到追加、过到的那一批作废。
 */
export interface RefCompletionInput {
  /** 输入框里的当前前缀（上游 `result.getPrefixMatcher()`）。 */
  prefix: string
  /** 第一批里已经在内存的那一份（已加载页的引用）：不等待就画出去。 */
  sync: readonly string[]
  /** 分支（`collectSync` 那一批）；宿主没给来源时不并这一份。 */
  loadBranches?: () => Promise<readonly string[]>
  /** 标签（`collectAsync` 那一半）；回来后**追加**在分支之后。 */
  loadTags?: () => Promise<readonly string[]>
  /**
   * 这一轮还是不是当前那一轮（上游 `ProgressManager.checkCanceled()` + `future.cancel(true)`，`:44`/`:60-62`）：
   * 用户又改了一个字或关了弹层 ⇒ 已经回来的那一批**丢掉**，不许盖到新的一轮上。
   */
  isStale?: () => boolean
  /** 每一批到齐就画一次（上游 `addValues` → `result.addElement`）：`matches` 是截过上限的那一份，
   * `known` 是这一轮累积的**全部**候选（提交那一半要知道"这个名字认不认"，不看截断）。 */
  emit: (matches: string[], known: readonly string[]) => void
  /** 候选条数上限，沿用 `goToRefMatches` 的那一档。 */
  limit?: number
}

export type RefCompletionOutcome = 'done' | 'stale'

/**
 * 跑一次两批补全：先画内存里那一份，再按「分支 → 标签」的顺序各追加一次。
 * 返回 `'stale'` 表示这一轮在某个 `await` 之后已经不是当前轮了（后面的批次不再画）。
 */
export async function runRefCompletion(input: RefCompletionInput): Promise<RefCompletionOutcome> {
  const known = new Set(input.sync)
  const draw = () => { const list = [...known]; input.emit(goToRefMatches(list, input.prefix, input.limit), list) }
  const stale = () => input.isStale?.() === true
  if (stale()) return 'stale'
  draw()
  for (const load of [input.loadBranches, input.loadTags]) {
    if (!load) continue
    let batch: readonly string[] | null = null
    try {
      batch = await load()
    } catch {
      // 上游那一半：`ExecutionException` ⇒ 记一条日志然后 `break`（`:52-55`），
      // 已经画出去的批次留着，后面的批次不再补 ⇒ 这里也照这个顺序：取不到就到此为止。
      return 'done'
    }
    if (stale()) return 'stale'
    for (const name of batch) if (name) known.add(name)
    draw()
  }
  return 'done'
}

/**
 * 提交判据用的"这个名字认不认"：上游 `jumpToRefOrHash`（`VcsLogNavigationUtil.kt:124-149`）先拿输入当**引用**
 * 试（在所有 stored refs 里找前缀命中的第一个），再当**哈希**试。所以候选集必须是**两批合起来**的那一份，
 * 不是只有已加载页的引用 —— 否则一个不在本页的分支会被判成"不像哈希"。
 */
export function goToRefAccepts(known: readonly string[], target: string): boolean {
  const needle = target.trim()
  if (!needle) return false
  return known.some(name => name.startsWith(needle))
}
