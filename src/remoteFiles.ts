// **远程（http/https）只读文件** —— 上游 `HttpFileSystemBase` / `HttpVirtualFileImpl` /
// `RemoteFileManagerImpl` 一族在本仓的可移植子集。
//
// 上游是什么（`platform/platform-impl/src/com/intellij/openapi/vfs/http/`）：
//   · `HttpFileSystemBase` 把 `http://` 当**文件系统**注册进 VFS，`HttpVirtualFileImpl` 是那个
//     虚拟文件（只读、可刷新、内容可缓存）；
//   · `RemoteFileManagerImpl`（`platform/platform-impl/remote/`）管远程文件的打开与"下载到本地"
//     的那条路（`RemoteFileManager`）。
// 判词 `pf/vfs` / `ic/vfs` / `pf/file-editor` 里反复出现「http/wsl 没有通道」这一条，本批补上
// **取数那一半**：宿主新开了最小 HTTP GET 通道（`native/http_client.cpp`，WinHTTP），
// 本模块是它的前端：URL 判定、只读文档身份、缓存与刷新规则。
//
// **为什么必须走宿主**（不是前端 fetch）：`index.html` 的 CSP 是
// `connect-src 'self' ws://127.0.0.1:5173`，WebView2 里跨源 `fetch` 被直接拦掉（见
// `src/pluginMarket.ts:21-24` 记的同一条边界）。宿主（Win32 进程）没有这个限制。
//
// **与上游的差异（如实）**：
//   · 上游 `HttpVirtualFile` 是 VFS 里的一个真节点（能进项目树、能被 PSI 看见、能写回）；
//     本仓的远程文件是一个**只读文档身份**（不进文件树、不参与搜索索引、不可写）——
//     `RemoteFileManager` 的"下载到本地"那一半也没有落点。
//   · 缓存只有**会话内**一层（按 URL 存正文 + ETag/Last-Modified），没有上游的
//     `VirtualFileSystem` 级持久缓存与后台刷新调度。
//
// 纯数据层：不 import vue/DOM/bridge 的运行时值（只借用 `request` 的**形状**由调用方注入），
// 便于单测。判据：`tests/remote-files.test.mjs`。

/** 一个远程文件的身份（上游 `HttpVirtualFile` 的 `getUrl()` —— 本仓的键就是 URL）。 */
export interface RemoteFileId {
  /** 归一化之后的完整 URL（去首尾空白；大小写保留 —— 路径大小写敏感）。 */
  url: string
  /** 从 URL 末段推出来的显示名（认不出就用主机名）。 */
  name: string
  /** 是不是 https（上游 `HttpVirtualFileImpl.isUseCache()` 之外的另一格，界面上要能看出来）。 */
  secure: boolean
}

/** 一次取数的结果（宿主 `http.get` 的答复形状，见 `native/http_client.hpp`）。 */
export interface RemoteFetchResult {
  available: boolean
  url: string
  finalUrl?: string
  status?: number
  contentType?: string
  bytes?: number
  truncated?: boolean
  content?: string
  reason?: string
}

/** 缓存的远程文档（正文 + 取数时间 + 服务端给的校验信息）。 */
export interface RemoteDocument {
  id: RemoteFileId
  content: string
  /** 实际取到正文的地址（重定向之后的）；没有重定向时与 `id.url` 同。 */
  finalUrl: string
  contentType: string
  status: number
  bytes: number
  truncated: boolean
  /** 取数时刻（毫秒）；`isStale` 用它判"该不该重新取"。 */
  fetchedAt: number
  /** `ETag` / `Last-Modified`：本仓目前只在展示层用它说"服务端给了什么校验头"。 */
  etag?: string
  lastModified?: string
}

/** URL 白名单（与宿主 `http_url_supported` 逐字同口径：只认 http/https 且有主机名）。 */
export function isRemoteUrl(url: string): boolean {
  const text = String(url ?? '').trim()
  const schemeEnd = text.indexOf(':')
  if (schemeEnd <= 0) return false
  const scheme = text.slice(0, schemeEnd).toLowerCase()
  if (scheme !== 'http' && scheme !== 'https') return false
  const rest = text.slice(schemeEnd + 1)
  if (!rest.startsWith('//')) return false
  return rest.length > 2
}

/**
 * 归一化 URL（上游 `VfsUtilCore` 不做这件事，但本仓的键是字符串，必须有一处统一口径）：
 * 去首尾空白；**不改大小写**（路径大小写敏感，主机名大小写不敏感但那由宿主处理）。
 * 不受支持的 URL 返回 null（不编一个能用的假地址）。
 */
export function normalizeRemoteUrl(url: string): string | null {
  const text = String(url ?? '').trim()
  return isRemoteUrl(text) ? text : null
}

/** 远程文件的显示名（URL 末段；末段为空/只是主机时退回主机名）。 */
export function remoteFileName(url: string): string {
  const text = String(url ?? '').trim()
  const withoutQuery = text.split('#')[0].split('?')[0]
  const schemeEnd = withoutQuery.indexOf('://')
  const afterScheme = schemeEnd >= 0 ? withoutQuery.slice(schemeEnd + 3) : withoutQuery
  const slash = afterScheme.indexOf('/')
  if (slash < 0) return afterScheme
  const host = afterScheme.slice(0, slash)
  const last = afterScheme.slice(slash + 1).split('/').filter(Boolean).pop()
  return last && last.length ? last : host
}

/** URL → 文档身份（不受支持时 null）。 */
export function remoteFileId(url: string): RemoteFileId | null {
  const normalized = normalizeRemoteUrl(url)
  if (!normalized) return null
  return { url: normalized, name: remoteFileName(normalized), secure: normalized.slice(0, 6).toLowerCase() === 'https:' }
}

/** 缓存期（毫秒）：同一次会话里同一 URL 多久之内不重新取。上游 `HttpVirtualFileImpl` 的
 *  `isUseCache()` 是「用不用 HTTP 缓存」的开关；本仓没有 VFS 级缓存，所以这一档是**会话内**的。 */
export const REMOTE_CACHE_TTL_MS = 5 * 60 * 1000

/** 缓存是不是过期了（`fetchedAt` 缺失或超期）。 */
export function isStale(document: RemoteDocument | null | undefined, now: number, ttl = REMOTE_CACHE_TTL_MS): boolean {
  if (!document) return true
  if (!Number.isFinite(document.fetchedAt)) return true
  return now - document.fetchedAt >= ttl
}

/** 取数结果的形状校验：`available` 为真时正文必须是字符串（防一个"成功但没正文"的答复）。 */
export function remoteDocumentFrom(id: RemoteFileId, result: RemoteFetchResult, now: number): RemoteDocument | null {
  if (!result?.available) return null
  if (typeof result.content !== 'string') return null
  return {
    id,
    content: result.content,
    finalUrl: result.finalUrl && result.finalUrl.length ? result.finalUrl : id.url,
    contentType: result.contentType ?? '',
    status: Number.isFinite(result.status) ? (result.status as number) : 0,
    bytes: Number.isFinite(result.bytes) ? (result.bytes as number) : result.content.length,
    truncated: result.truncated === true,
    fetchedAt: now,
  }
}

/** 一次取数失败时的可读说明（宿主给了 `reason` 就用它；没给也要说一句人话）。 */
export function remoteFailureReason(result: RemoteFetchResult | null | undefined, url: string): string {
  const reason = result?.reason
  if (typeof reason === 'string' && reason.length) return reason
  if (result && Number.isFinite(result.status) && (result.status as number) >= 400)
    return `服务器返回 ${result.status}。`
  return `取不到 ${url}（宿主没有给出原因）。`
}

/** 远程文档的**只读**性质（上游 `HttpVirtualFileImpl` 的 `isWritable() = false`）。 */
export const REMOTE_FILE_READ_ONLY = true

/** 文档语言推断用的扩展名表（远程文件没有本地路径，只能按 URL 末段判）。 */
export function remoteLanguageOf(url: string): string {
  const name = remoteFileName(url).toLowerCase()
  const dot = name.lastIndexOf('.')
  if (dot < 0) return ''
  return name.slice(dot + 1)
}

/**
 * 编辑器里那条只读提示的文案（上游 `FileEditor` 的只读角标；本仓状态栏也用它）。
 * `truncated` 为真时**必须**说出来 —— 用户看到的是被截断的正文，不说等于骗。
 */
export function remoteStatusText(document: RemoteDocument): string {
  const source = document.finalUrl === document.id.url ? document.id.url : `${document.id.url}（重定向到 ${document.finalUrl}）`
  const size = `${document.bytes} 字节`
  const head = `只读远程文件：${source}（HTTP ${document.status}，${size}）`
  return document.truncated ? `${head} —— 正文超过大小上限，已截断显示。` : head
}