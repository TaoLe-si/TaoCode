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
  for (const commit of commits) for (const ref of commit.refs ?? []) if (ref.name) names.add(ref.name)
  return [...names].sort((left, right) => left.localeCompare(right))
}

/** `GoToHashOrRefPopup` 的补全是**前缀**匹配（`VcsLogNavigationUtil.kt:134-137` 的 startsWith）。 */
export function goToRefMatches(candidates: readonly string[], prefix: string, limit = 12): string[] {
  const needle = prefix.trim()
  if (!needle) return []
  return candidates.filter(name => name.startsWith(needle)).slice(0, limit)
}
