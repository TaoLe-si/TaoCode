// **远程插件市场**（上游 `MarketplaceRequests.searchPlugins` / `PluginSearchResult`，
// `platform/platform-impl/src/com/intellij/ide/plugins/marketplace/`）—— 从**远程仓库**取清单。
//
// 本仓已有的市场是**工作区本地仓库**（`src/pluginMarket.ts`：读 `.taocode/plugins/repository.json`
// 或扫目录里的 zip/jar，装包走 `plugin.install`）。本文件补上"远程"那一半里的**清单取数**：
// 从一个 http(s) 仓库 URL 取 `repository.json`，用同一份解析器 `parseMarketplaceCatalog`
// 整形出与本地完全一样的条目（`MarketplacePlugin`），于是搜索 / 类目 / 排序 / 已装判定
// （`matchesMarketplaceQuery` / `marketplaceCategories` / `sortMarketplaceEntries` /
// `marketplaceEntryStatus`）**一处也不分叉**。
//
// 取数走哪里：桌面端走**宿主** `http.get`（`src/remoteFileHost.ts` 的 `fetchRemoteRaw` →
// `native/http_client.cpp` 的 WinHTTP）。理由与远程只读文档同一条（见 `src/remoteFileHost.ts`
// 文件头）：WebView2 里前端 `fetch("https://…")` 会被本仓的 CSP 拦掉，而宿主 Win32 进程
// 没有这个限制。`index.html` 的 CSP 本轮也被放宽到**市场那一个主机**
// （`connect-src 'self' … https://plugins.jetbrains.com`），所以浏览器预览档**可以**注入一个
// 直连取数器（同一个 `deps.fetch` 注入点）—— 但缺省实现是 `fetchRemoteRaw`（宿主通道），
// 预览档下 bridge 会如实拒绝 `http.get`，面板显示那句原因（不偷偷假装取到了）。
//
// 与上游的如实差异（写在这里而不是假装做到）：
//   · 上游 `MarketplaceRequests.searchPlugins` 打的是 JetBrains 的**搜索 API**（多参数、分页、
//     返回 `PluginUiModel` 数组）；本仓的远程源是**仓库清单 JSON**（与本地同一格式），
//     因为它才是本仓 `plugin.install` 能理解的形状。搜索 API 的形状转换没有落点。
//   · **远程安装**没有落点：`plugin.install` 收的是工作区相对路径（native 从工作区根拼绝对路径），
//     远程包要先下载到工作区再装 —— 下载通道 + `PluginSignatureVerifier` 的密码学验签
//     （本仓只有判定层 `src/pluginSignature.ts`）都缺，所以本文件只做**清单取数 + 展示**，
//     安装一律走本地仓库那一档。接线在 `src/components/PluginMarketPanel.vue`（远程仓库输入行 +
//     只读条目徽章）：可安装判定在 `src/pluginMarketSources.ts` 的 `installable`，
//     远程条目的安装按钮**禁用并写明原因**（`REMOTE_INSTALL_BLOCKED`），不是点不动的假按钮。
//
// 判据：`tests/plugin-market-remote.test.mjs`（注入假 fetch，不发网络请求）。

import { parseMarketplaceCatalog, type MarketplacePlugin, type MarketplaceParseResult } from './pluginMarket.ts'
import { fetchRemoteRaw, type RemoteFetchOptions } from './remoteFileHost.ts'
import { isRemoteUrl, normalizeRemoteUrl, remoteFailureReason, type RemoteFetchResult } from './remoteFiles.ts'

/** 本轮放开 `connect-src` 的那个主机（JetBrains 官方市场；见 `index.html` 的 CSP 注释）。 */
export const JETBRAINS_MARKETPLACE_HOST = 'plugins.jetbrains.com'

/** 远程仓库清单的默认文件名（与本地同一份 `repository.json`，见 `src/pluginMarket.ts`）。 */
export const REMOTE_MANIFEST_NAME = 'repository.json'

/** 远程安装（下载 + 验签）本仓还没有落点 —— 如实登记，UI 据此不画安装按钮。 */
export const REMOTE_INSTALL_AVAILABLE = false

/**
 * 一次远程取数怎么了（宿主 `http.get` 的两种答复都要认）：
 *   · `available:false` → 传输/协议失败，宿主自己的 reason 优先（`remoteFailureReason`）；
 *   · `available:true` + `status >= 400` → 那是**服务器**的答复，正文多半不是清单
 *     （实测 `/api/search/plugins` 不给 `build` 时返回 400 + `{"statusCode":400,"message":"No build specified"}`），
 *     直接送去解析只会得到"清单解析失败"这种答错问题的提示 —— 这里按状态码说人话。
 * 401/403 那一格如实写清楚缺的是什么：本仓没有凭据存储（`docs/settings-parity.md:61` 的
 * passwordSafe 判定不做），宿主的 `http.get` 也不转发请求头（`native/main.cpp` 的 http.get
 * 只收 url/limit/timeoutMs；`http.post` 才有 headers），所以私库/要登录的市场接口取不到 ——
 * 界面显示这句原因，而不是画一个填了也没用的凭据输入框。
 */
export function marketplaceFetchFailure(result: RemoteFetchResult | null | undefined, url: string, what = '仓库'): string {
  if (!result || !result.available) return remoteFailureReason(result, url)
  const status = Number(result.status)
  if (Number.isFinite(status) && status >= 400) {
    if (status === 401 || status === 403)
      return `${what}返回 ${status}：这里要凭据/授权，而本仓没有凭据存储、http.get 也不转发请求头 ⇒ 取不到。`
    return `${what}返回 ${status}。`
  }
  if (typeof result.content !== 'string') return `${what}没给正文。`
  return ''
}

/**
 * 从一个仓库地址（http/https）拼出清单 URL。
 * 已经是 `…/repository.json` 就原样；否则在末段补上清单名（去掉结尾斜杠）。
 */
export function remoteManifestUrl(repository: string): string | null {
  const normalized = normalizeRemoteUrl(repository)
  if (!normalized) return null
  if (normalized.toLowerCase().endsWith(`/${REMOTE_MANIFEST_NAME}`)) return normalized
  const trimmed = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
  return `${trimmed}/${REMOTE_MANIFEST_NAME}`
}

/** 把清单里条目的 `file`（仓库相对）解析成**绝对 URL**（远程装不了，但链接要能点开看）。 */
export function resolveRemotePackageUrl(manifestUrl: string, file: string): string | null {
  const raw = String(file ?? '').trim()
  if (!raw) return null
  if (isRemoteUrl(raw)) return normalizeRemoteUrl(raw)
  try {
    return new URL(raw, manifestUrl).toString()
  } catch {
    return null
  }
}

export interface RemoteMarketplaceResult {
  /** 取数成功（清单解析出来了，哪怕是空表）。 */
  available: boolean
  /** 实际取数的清单 URL。 */
  url: string
  /** 解析出来的条目（`file` 已解析成绝对 URL）。 */
  plugins: MarketplacePlugin[]
  /** 逐条坏条目的错误（与本地 `parseMarketplaceCatalog` 同一口径：坏条目不空整页）。 */
  errors: MarketplaceParseResult['errors']
  /** 失败原因（取不到 / 不是 JSON / 解析失败）；成功时为空串。 */
  reason: string
}

export interface RemoteMarketplaceDeps {
  /** 取数器（缺省 = 宿主 `http.get`；测试注入假的）。 */
  fetch?: (url: string, options?: RemoteFetchOptions) => Promise<RemoteFetchResult>
  /** 传给取数器的档（大小上限 / 超时）。 */
  options?: RemoteFetchOptions
}

/**
 * 取远程仓库清单并整形。
 *
 * 与 `pluginMarket.ts` 的 `loadMarketplace` 同一口径：失败**不抛**，返回 `available:false` +
 * 人话原因（市场页据此显示"远程仓库取不到：…"，不把整页打空）。
 */
export async function loadRemoteMarketplace(repository: string, deps: RemoteMarketplaceDeps = {}): Promise<RemoteMarketplaceResult> {
  const url = remoteManifestUrl(repository)
  if (!url) {
    return { available: false, url: '', plugins: [], errors: [], reason: `不是 http(s) 仓库地址：${repository}` }
  }
  const fetch = deps.fetch ?? fetchRemoteRaw
  let result: RemoteFetchResult
  try {
    result = await fetch(url, deps.options)
  } catch (caught) {
    return { available: false, url, plugins: [], errors: [], reason: caught instanceof Error ? caught.message : String(caught) }
  }
  const failure = marketplaceFetchFailure(result, url)
  if (failure) return { available: false, url, plugins: [], errors: [], reason: failure }
  const parsed = parseMarketplaceCatalog(result.content, JETBRAINS_MARKETPLACE_HOST)
  if (!parsed.catalog) {
    return { available: false, url, plugins: [], errors: parsed.errors, reason: parsed.errors[0] ?? '清单解析失败。' }
  }
  const plugins = parsed.catalog.plugins.map(entry => ({
    ...entry,
    // 远程条目的 `file` 换成绝对 URL：对上游 `PluginChunkDataSource` 的下载面是"包在哪"，
    // 对本仓是"链接可点开看"（安装仍走本地那一档，见文件头）。
    file: resolveRemotePackageUrl(url, entry.file) ?? entry.file,
  }))
  return { available: true, url, plugins, errors: parsed.errors, reason: '' }
}
