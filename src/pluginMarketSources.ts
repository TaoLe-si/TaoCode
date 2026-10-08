// 市场**两个来源**的合并与「能不能装」判定 —— 工作区本地仓库（`src/pluginMarket.ts`）与
// 远程 http(s) 仓库（`src/pluginMarketRemote.ts`）。
//
// 上游只有远程 marketplace 一档（`MarketplaceRequests.searchPlugins`，
// `platform/platform-impl/src/com/intellij/ide/plugins/marketplace/`）；本仓的本地仓库是既有能力，
// 远程那一档本轮补上的是**取数**（清单走宿主 `http.get`，见 `src/pluginMarketRemote.ts` 文件头与
// `native/http_client.cpp`），**远程安装仍然没有落点**：`plugin.install` 的 `source` 是工作区相对
// 路径（`native/main.cpp:1345` 把源路径交给 `taocode::plugins::install`，绝对路径从工作区根拼），
// 远程包要先下载进工作区 —— 下载通道与 `PluginSignatureVerifier.kt` 的密码学验签本仓都还没有
// （`src/pluginSignature.ts` 只落了判定层）。
// 所以这一层要回答的唯一问题是：**条目来自哪儿、能不能装**，界面据此决定安装按钮可不可用 ——
// 而不是画一个点不动的「安装」。
//
// 纯函数：不碰 RPC、不持状态，所以可以单独测（`tests/plugin-market-sources.test.mjs`）。

import type { MarketplacePlugin } from './pluginMarket.ts'

/** 条目的来源：工作区里的仓库目录 / 远程 http(s) 仓库。 */
export type MarketplaceOrigin = 'local' | 'remote'

export interface SourcedMarketplaceEntry {
  entry: MarketplacePlugin
  origin: MarketplaceOrigin
  /** 能不能走 `plugin.install`（只有工作区里的包能 —— 见文件头）。 */
  installable: boolean
}

export const MARKETPLACE_ORIGIN_LABELS: Record<MarketplaceOrigin, string> = {
  local: '工作区仓库',
  remote: '远程仓库',
}

/** 远程条目装不了的原因（界面如实显示这一句，不画假按钮也不写"尚未完成"）。 */
export const REMOTE_INSTALL_BLOCKED = '远程安装没有落点：包要先下载进工作区再交给 plugin.install，而下载通道与验签（PluginSignatureVerifier）本仓都还没有。'

/**
 * 合并两个来源：**本地优先** —— 同 id 的条目以工作区那一份为准。
 * 理由是动作面：只有工作区里的包能装 / 能更新（`installable`），远程那一份同名条目给不出任何
 * 本地没有的动作，留着它只会把「可更新到 vX」指到一个这里装不了的版本上。
 * 远程独有的条目按清单顺序接在后面（相关度排序 = 这个顺序，见 `sortMarketplaceEntries`）。
 */
export function combineMarketplaceEntries(
  local: readonly MarketplacePlugin[],
  remote: readonly MarketplacePlugin[],
): SourcedMarketplaceEntry[] {
  const entries: SourcedMarketplaceEntry[] = local.map(entry => ({ entry, origin: 'local', installable: true }))
  const seen = new Set(entries.map(item => item.entry.id))
  for (const entry of remote) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    entries.push({ entry, origin: 'remote', installable: false })
  }
  return entries
}

/** 条目 id → 来源那一格（合并后同 id 只留一条，所以是单值；面板按它查徽章与按钮）。 */
export function marketplaceOriginIndex(entries: readonly SourcedMarketplaceEntry[]): Map<string, SourcedMarketplaceEntry> {
  return new Map(entries.map(item => [item.entry.id, item]))
}

/** 两个来源各有多少条。 */
export function marketplaceOriginCounts(entries: readonly SourcedMarketplaceEntry[]): Record<MarketplaceOrigin, number> {
  const counts: Record<MarketplaceOrigin, number> = { local: 0, remote: 0 }
  for (const item of entries) counts[item.origin] += 1
  return counts
}

/** 来源行：`工作区仓库 3 条 · 远程仓库 2 条`（某一档为 0 时不写它；两档都空 = 空串）。 */
export function marketplaceOriginSummary(entries: readonly SourcedMarketplaceEntry[]): string {
  const counts = marketplaceOriginCounts(entries)
  const parts: string[] = []
  if (counts.local) parts.push(`${MARKETPLACE_ORIGIN_LABELS.local} ${counts.local} 条`)
  if (counts.remote) parts.push(`${MARKETPLACE_ORIGIN_LABELS.remote} ${counts.remote} 条`)
  return parts.join(' · ')
}
