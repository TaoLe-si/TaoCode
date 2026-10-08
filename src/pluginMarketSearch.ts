// **在线搜索**（上游 `MarketplaceRequests.executePluginSearch` + `MarketplaceUrls.getSearchPluginsUrl`
// + `newui/SearchQueryParser.Marketplace` + `PluginRepositoryObjects.kt` 的 `MarketplaceSearchPluginData`）
// —— 把市场搜索 API 的一次查询落成市场页的条目（与仓库清单同形的 `MarketplacePlugin`）。
//
// 取数走宿主 `http.get`（`src/pluginMarketRemote.ts` 的 `fetchRemoteRaw` → `native/http_client.cpp`
// 的 WinHTTP；`index.html` 的 CSP 为市场主机放开了 `connect-src`）—— 与远程仓库清单同一条通道。
//
// 上游的三段对应关系：
//   · query 段：`SearchQueryParser.Marketplace.getSearchUrl()`（`:70-121`）—— 每个标签一个
//     `tags=`、每个厂商一个 `organization=`、关键字一个 `search=`（三个都 URL 编码）；
//   · URL 段：`MarketplaceUrls.getSearchPluginsUrl`（`:60-73`）—— `${host}/api/search/plugins?<query>`
//     再补 `build`（兼容档，必带）/`max`（条数）/`all`（是否含不兼容）三个参数；
//   · 映射段：`MarketplaceSearchPluginData.toPluginUiModel`（`PluginRepositoryObjects.kt:181-201`）
//     —— name / rating / downloads / organization（上游落到 `vendorDetails`）/ externalPluginId /
//     externalUpdateId / cdate（→ date）/ paid（→ `Paid` 标签）；**命中里没有 version**
//     （版本要 `MarketplaceUrls.getPluginMetaUrl:36` 那一档详情取数，本仓没有落点，见下）。
//
// 与上游的如实差异（写在这里，不假装做到）：
//   · 上游 `build` 取 `ApplicationInfoImpl.pluginCompatibleBuild`、`os`/`arch` 取本机；本仓没有
//     IDE build 与兼容矩阵这一档（插件只贡献声明式数据、不加载第三方代码），所以 `build` 钉一个
//     官方 IDEA 版本号当兼容轴（`deps.build` 可覆盖），`os`/`arch` 不发（实测省略这两个参数
//     API 照常返回，见报告里的 curl 读数）。
//   · 上游在 `externalUpdateId == null` 时还看 `nearestUpdate` 的兼容性并按 productCode 换名
//     （`MarketplaceRequests.kt:783-800`）；本仓没有产品档那一层 —— 只保留有 `updateId` 的条目
//     （那才在搜索索引里），其余逐条报错，不换名。
//   · 命中**没有包地址与版本**（下载要 `getPluginMetaUrl` + 下载通道，两样本仓都没有 ⇒
//     `src/pluginMarketRemote.ts` 的 `REMOTE_INSTALL_AVAILABLE = false`）：命中的 `file`/`version`
//     是空串，界面按只读条目画（`src/pluginMarketSources.ts` 的 `installable = false`），
//     安装仍走工作区仓库那一档。
//
// 判据：`tests/plugin-market-search.test.mjs`（注入假 fetch，不发网络请求；映射的样本是 2026-10-08
// 实测的市场响应，行号与读数记在报告里）。

import type { MarketplacePlugin } from './pluginMarket.ts'
import { JETBRAINS_MARKETPLACE_HOST, fetchRemoteRaw, marketplaceFetchFailure, type RemoteFetchOptions } from './pluginMarketRemote.ts'
import type { RemoteFetchResult } from './remoteFiles.ts'

/** 搜索 API 的地址（上游 `MarketplaceUrls.getPluginManagerUrl()/api/search/plugins`，`:60-73`）。 */
export const MARKETPLACE_SEARCH_PATH = '/api/search/plugins'

/**
 * 兼容档 `build`（API 必带；不带会 400「No build specified」）。
 * 上游取 `ApplicationInfoImpl.pluginCompatibleBuild`；本仓没有 IDE build 这一档，
 * 钉一个官方 IDEA 版本号当兼容轴，调用方可用 `deps.build` 覆盖。
 */
export const MARKETPLACE_COMPAT_BUILD = 'IC-243.21565.193'

/** 一次搜索最多取几条（上游由调用方给 `count`；这里给一个与市场页列表同量级的缺省值）。 */
export const MARKETPLACE_SEARCH_COUNT = 50

export interface MarketplaceSearchParams {
  /** 关键字（`search=`；`SearchQueryParser` 里除属性词之外的文本）。 */
  keyword?: string
  /** 厂商（每个一条 `organization=`；`/vendor:` 解析出来的取值）。 */
  vendors?: readonly string[]
  /** 标签（每个一条 `tags=`；`/tag:` 解析出来的取值）。 */
  tags?: readonly string[]
  /** 条数上限（`max=`）。 */
  count?: number
  /** 兼容 build（`build=`）。 */
  build?: string
  /** 是否含与兼容档不适配的插件（`all=`；上游缺省 false）。 */
  includeIncompatible?: boolean
}

/**
 * query 段（上游 `SearchQueryParser.Marketplace.getSearchUrl()`，`:102-121`）：
 * `tags=` 每条一个、`organization=` 每个厂商一个、`search=` 关键字 —— 全部 URL 编码，
 * 顺序与上游一致（tags → organization → search）。
 */
export function marketplaceSearchQuery(params: MarketplaceSearchParams): string {
  const parts: string[] = []
  for (const tag of params.tags ?? []) {
    const text = tag.trim()
    if (text) parts.push(`tags=${encodeURIComponent(text)}`)
  }
  for (const vendor of params.vendors ?? []) {
    const text = vendor.trim()
    if (text) parts.push(`organization=${encodeURIComponent(text)}`)
  }
  const keyword = (params.keyword ?? '').trim()
  if (keyword) parts.push(`search=${encodeURIComponent(keyword)}`)
  return parts.join('&')
}

/**
 * 搜索 URL（上游 `MarketplaceUrls.getSearchPluginsUrl`，`:60-73`）：
 * `${host}/api/search/plugins?<query>&build=<build>&max=<count>&all=<bool>`。
 * 主机不是 http(s) 或不认识时返回 null（调用方如实报"地址不合法"，不替它猜）。
 */
export function marketplaceSearchUrl(base: string, params: MarketplaceSearchParams = {}): string | null {
  const normalized = base.trim().replace(/\/+$/, '')
  if (!/^https?:\/\/[^/\s]+/i.test(normalized)) return null
  const query = marketplaceSearchQuery(params)
  const build = (params.build ?? MARKETPLACE_COMPAT_BUILD).trim()
  const count = params.count ?? MARKETPLACE_SEARCH_COUNT
  const all = params.includeIncompatible === true
  const tail = [`build=${encodeURIComponent(build)}`, `max=${count}`, `all=${all}`].join('&')
  return `${normalized}${MARKETPLACE_SEARCH_PATH}?${query ? `${query}&` : ''}${tail}`
}

export interface MarketplaceSearchResult {
  /** 取数 + 解析成功（哪怕是空结果）。 */
  available: boolean
  /** 实际请求的 URL。 */
  url: string
  /** 命中的条目（只读：`file`/`version` 是空串，见文件头）。 */
  plugins: MarketplacePlugin[]
  /** 逐条读不出来的原因（坏条目不打空整页）。 */
  errors: string[]
  /** 失败原因（取不到 / 不是 JSON / 不是数组）；成功时为空串。 */
  reason: string
}

export interface MarketplaceSearchDeps {
  /** 取数器（缺省 = 宿主 `http.get`；测试注入假的）。 */
  fetch?: (url: string, options?: RemoteFetchOptions) => Promise<RemoteFetchResult>
  /** 传给取数器的档（大小上限 / 超时）。 */
  options?: RemoteFetchOptions
  /** 覆盖兼容 build（缺省 `MARKETPLACE_COMPAT_BUILD`）。 */
  build?: string
}

/** 文本字段一律取 trim 后的字符串（数字字段返回字符串形式，交给 `asFiniteNumber`）。 */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = textOf(value)
  if (!text) return undefined
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * 一条搜索命中 → 市场条目（上游 `MarketplaceSearchPluginData.toPluginUiModel`，
 * `PluginRepositoryObjects.kt:181-201` 的逐字段对应）。
 * 返回 null = 这条读不出来（缺 id / 不在搜索索引里）——原因由调用方收进 `errors`。
 */
export function marketplaceSearchHit(value: unknown): { entry: MarketplacePlugin } | { problem: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { problem: '搜索命中的条目不是对象。' }
  const raw = value as Record<string, unknown>
  // 上游 `:148-150`：`id` 属性绑定的是 JSON 的 `xmlId`（`id` 那格是 externalPluginId）。
  const id = textOf(raw.xmlId) || textOf(raw.id)
  if (!id) return { problem: '搜索命中的条目没有 xmlId。' }
  // 上游 `executePluginSearch`（`MarketplaceRequests.kt:783-800`）只留下搜索索引里有的条目。
  const updateId = textOf(raw.updateId) || textOf(raw.externalUpdateId) || textOf(raw.nearestUpdate)
  if (!updateId) return { problem: `${id} 不在搜索索引里（没有 updateId）。` }
  const paid = raw.isPaid === true || raw.paid === true
  const entry: MarketplacePlugin = {
    id,
    name: textOf(raw.name) || id,
    // 命中没有版本与包地址（要详情取数与下载通道，见文件头）。
    version: '',
    file: '',
    vendor: textOf(raw.organization) || textOf(raw.vendor),
    tags: paid ? ['Paid'] : [],
    downloads: numberOrUndefined(raw.downloads),
    rating: numberOrUndefined(raw.rating),
    releaseDate: numberOrUndefined(raw.cdate),
  }
  return { entry }
}

/** 一次响应的正文 → 条目表（数组形状；坏条目逐条报错，与清单解析同口径）。 */
export function parseMarketplaceSearchResults(payload: string): { plugins: MarketplacePlugin[]; errors: string[] } {
  let data: unknown
  try {
    data = JSON.parse(payload)
  } catch {
    return { plugins: [], errors: ['搜索响应不是 JSON。'] }
  }
  if (!Array.isArray(data)) return { plugins: [], errors: ['搜索响应不是数组（上游 `MarketplaceSearchPluginData` 的表）。'] }
  const plugins: MarketplacePlugin[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  for (const item of data) {
    const hit = marketplaceSearchHit(item)
    if ('problem' in hit) { errors.push(hit.problem); continue }
    if (seen.has(hit.entry.id)) continue
    seen.add(hit.entry.id)
    plugins.push(hit.entry)
  }
  return { plugins, errors }
}

/**
 * 搜一次市场。
 *
 * 失败**不抛**：返回 `available:false` + 人话原因（HTTP 状态、超时、坏 JSON 都如实说），
 * 与 `loadRemoteMarketplace` 同一口径。
 */
export async function searchMarketplace(
  base: string,
  params: MarketplaceSearchParams = {},
  deps: MarketplaceSearchDeps = {},
): Promise<MarketplaceSearchResult> {
  const url = marketplaceSearchUrl(base, { ...params, build: params.build ?? deps.build })
  if (!url) return { available: false, url: '', plugins: [], errors: [], reason: `不是 http(s) 市场地址：${base}` }
  const fetch = deps.fetch ?? fetchRemoteRaw
  let result: RemoteFetchResult
  try {
    result = await fetch(url, deps.options)
  } catch (caught) {
    return { available: false, url, plugins: [], errors: [], reason: caught instanceof Error ? caught.message : String(caught) }
  }
  const failure = marketplaceFetchFailure(result, url, '市场搜索')
  if (failure) return { available: false, url, plugins: [], errors: [], reason: failure }
  const parsed = parseMarketplaceSearchResults(result.content ?? '')
  return { available: true, url, plugins: parsed.plugins, errors: parsed.errors, reason: '' }
}

/** 市场主机的地址（`index.html` 的 CSP 为它放开了 `connect-src`；见 `pluginMarketRemote.ts`）。 */
export const MARKETPLACE_SEARCH_BASE = `https://${JETBRAINS_MARKETPLACE_HOST}`
