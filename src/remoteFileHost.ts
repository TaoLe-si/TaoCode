// **远程（http/https）只读文档的取数宿主** —— 把 `src/remoteFiles.ts` 的纯规则接到
// 宿主 `http.get`（`native/http_client.cpp` 的 WinHTTP）上。
//
// 上游坐标（`platform/platform-impl/src/com/intellij/openapi/vfs/http/`）：
//   · `HttpFileSystemBase` 把 `http://` 注册成 VFS 的一个文件系统；`HttpVirtualFileImpl`
//     是那个只读、可刷新、内容可缓存的虚拟文件（`getUrl()` / `isWritable()=false` / `isUseCache()`）。
//   · 打开它时由 `RemoteFileManagerImpl` 决定「取哪一份内容、什么时候重取」。
// 本模块是这一族在本仓的**取数与缓存那一半**：URL → 文档身份（`remoteFiles.remoteFileId`），
// 取数走宿主 `http.get`，结果整形成 `RemoteDocument`，并给出会话内的"过期就重取"规则。
//
// **为什么取数必须走宿主**（不是前端 `fetch`）：`index.html` 的 CSP 是
// `connect-src 'self' ws://127.0.0.1:5173` —— WebView2 里 `fetch("https://…")` 会被 CSP
// 直接拦掉（见 `native/http_client.hpp` 的文件头与 `src/pluginMarket.ts` 记的同一条边界）。
// 宿主的 Win32 进程没有这个限制，所以 `fetchRemoteRaw` 就是那一格唯一的出口。
//
// **与上游的差异（如实）**：上游 `HttpVirtualFile` 是 VFS 里的真节点（能进项目树、能被 PSI
// 看见、可写回）；本仓的远程文件只是一个只读文档身份 + 会话内缓存，进不了文件树、不索引、不可写。
// **UI 挂载点**：把一个取到的 `RemoteDocument` 变成编辑器里的只读标签这一格在 `src/App.vue`
// 的 `openFile`（唯一开标签的地方），本模块只提供数据侧 —— 见报告里的接线请求。
//
// 判据：`tests/remote-file-host.test.mjs`（注入假 `fetch`，不发网络请求）。
import { ref, type Ref } from 'vue'
import { request } from './bridge.ts'
import type { RemoteDocument, RemoteFetchResult } from './remoteFiles.ts'
import { isRemoteUrl, isStale, normalizeRemoteUrl, remoteDocumentFrom, remoteFailureReason, remoteFileId } from './remoteFiles.ts'

/** 一次 `http.get` 的可选档（与 `native/http_client.hpp` 的 `HttpRequest` 字段同名）。 */
export interface RemoteFetchOptions {
  /** 正文大小上限（0 = 宿主默认 4 MiB）。 */
  limit?: number
  /** 整条请求的超时毫秒（0 = 宿主默认 15000）。 */
  timeoutMs?: number
}

/**
 * 走宿主 `http.get` 取一个 URL 的正文。**这就是 `http.get` 在真实链路里的调用点**
 * （桌面端只有这样能取数；浏览器预览会在 `bridgePreview.previewRequest` 里如实拒绝）。
 * 参数合法性（只认 http/https）由宿主 `http_get` 兜底抛 `INVALID_REQUEST`，这里不重复判。
 */
export async function fetchRemoteRaw(url: string, options: RemoteFetchOptions = {}): Promise<RemoteFetchResult> {
  return request<RemoteFetchResult>('http.get', { url, ...options })
}

export interface RemoteFileHostDeps {
  /** 取数实现（默认 `fetchRemoteRaw`；单测注入假实现即可离线跑）。 */
  fetch?: (url: string, options?: RemoteFetchOptions) => Promise<RemoteFetchResult>
  /** 取数时间里用「现在几毫秒」（默认 `Date.now`，测试可钉死）。 */
  now?: () => number
  /** 失败时的一句提示（宿主 reason 优先）。 */
  onError?: (message: string) => void
}

export interface RemoteFileHost {
  /** 当前打开的远程文档（null = 没打开 / 取数失败）。 */
  document: Ref<RemoteDocument | null>
  /** 正在取数（面板据此显示忙碌态）。 */
  loading: Ref<boolean>
  /** 上一次失败的说明（成功时清空）。 */
  error: Ref<string | null>
  /**
   * 打开一个 URL 的只读文档。
   * `refresh: true` 跳过后面的会话缓存（用户点「刷新」/ 强制重取）。
   * 返回取到的文档；URL 不合法或取数失败返回 null（原因在 `error`）。
   */
  open: (url: string, options?: { refresh?: boolean }) => Promise<RemoteDocument | null>
  /** 重取当前文档（没有当前文档时什么都不做）。 */
  refresh: () => Promise<RemoteDocument | null>
  /** 关掉当前文档（清空 document / error）。 */
  close: () => void
}

/**
 * 会话内缓存的取数宿主（上游 `HttpVirtualFileImpl` 的"可缓存"那一格的等价物）。
 *
 * 缓存键是归一化后的 URL（`normalizeRemoteUrl`），命中且未过期（`isStale`）就**不再发请求** ——
 * 与上游 `isUseCache()` 同一条语义：同一次会话里同一个地址反复打开不该反复取。
 * 缓存的生命周期 = 这个宿主实例（换工作区/关标签不影响，与上游的 VFS 级缓存差一档，如实）。
 */
export function createRemoteFileHost(deps: RemoteFileHostDeps = {}): RemoteFileHost {
  const fetchImpl = deps.fetch ?? fetchRemoteRaw
  const now = deps.now ?? (() => Date.now())
  const cache = new Map<string, RemoteDocument>()
  const document = ref<RemoteDocument | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function open(url: string, options: { refresh?: boolean } = {}): Promise<RemoteDocument | null> {
    const normalized = normalizeRemoteUrl(url)
    if (!normalized || !isRemoteUrl(normalized)) {
      error.value = `不是 http/https 地址：${String(url ?? '')}`
      deps.onError?.(error.value)
      return null
    }
    const id = remoteFileId(normalized)
    if (!id) {
      error.value = `不是 http/https 地址：${normalized}`
      deps.onError?.(error.value)
      return null
    }
    // 会话缓存命中且未过期：直接给，不发请求（除非显式 refresh）。
    const cached = cache.get(normalized)
    if (!options.refresh && cached && !isStale(cached, now())) {
      document.value = cached
      error.value = null
      return cached
    }
    loading.value = true
    try {
      const result = await fetchImpl(normalized)
      const shaped = remoteDocumentFrom(id, result, now())
      if (!shaped) {
        error.value = remoteFailureReason(result, normalized)
        deps.onError?.(error.value)
        return null
      }
      cache.set(normalized, shaped)
      document.value = shaped
      error.value = null
      return shaped
    } catch (caught) {
      // 宿主把网络失败放在 `available:false` 里回（不抛）；真抛出来的只有 bridge 层错误
      // （浏览器预览 / 桥断了），也按同一条"给一句人话"处理。
      error.value = caught instanceof Error ? caught.message : String(caught)
      deps.onError?.(error.value)
      return null
    } finally {
      loading.value = false
    }
  }

  async function refresh(): Promise<RemoteDocument | null> {
    const current = document.value
    if (!current) return null
    return open(current.id.url, { refresh: true })
  }

  function close(): void {
    document.value = null
    error.value = null
  }

  return { document, loading, error, open, refresh, close }
}
