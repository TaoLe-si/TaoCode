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
// 文件头）：WebView2 里前端 `fetch("https://…")` 会被本仓自己的 CSP 拦掉，而宿主 Win32 进程
// 没有这个限制。本轮同时把 `index.html` 的 `connect-src` 放宽到**市场那一个主机**
// （`https://plugins.jetbrains.com`，见该文件的注释），所以**浏览器预览**档也能直连取数 ——
// 两档共用同一个 `fetch` 注入点。
//
// 与上游的如实差异（写在这里而不是假装做到）：
//   · 上游 `MarketplaceRequests.searchPlugins` 打的是 JetBrains 的**搜索 API**（多参数、分页、
//     返回 `PluginUiModel` 数组）；本仓的远程源是**仓库清单 JSON**（与本地同一格式），
//     因为它才是本仓 `plugin.install` 能理解的形状。搜索 API 的形状转换没有落点。
//   · **远程安装**没有落点：`plugin.install` 收的是工作区相对路径（native 从工作区根拼绝对路径），
//     远程包要先下载到工作区再装 —— 下载通道 + `PluginSignatureVerifier` 的密码学验签
//     （本仓只有判定层 `src/pluginSignature.ts`）都缺，所以本文件只做**清单取数 + 展示**，
//     安装一律走本地仓库那一档，不画点不动的「安装」按钮（由 UI lane 按 `installable:false` 决定）。
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
  if (!result || !result.available || typeof result.content !== 'string') {
    return { available: false, url, plugins: [], errors: [], reason: remoteFailureReason(result, url) }
  }
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
