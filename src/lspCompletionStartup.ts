import type { LspOpenResult } from './bridge'

// Extra native status fields are kept local until bridge.ts's shared contract is
// updated; the transport is still the existing lsp.request route.
export type CompletionSessionStatus = LspOpenResult & { ready?: boolean; error?: { code?: string | number; message?: string } }
interface TabState { path: string; content: string; lspRunning?: boolean; lspConfigured?: boolean }
interface StartupDeps {
  request: <T>(method: 'lsp.open' | 'lsp.request', params: Record<string, unknown>) => Promise<T>
  notify: (message: string, error?: boolean) => void
  current: () => boolean
  pause?: () => Promise<void>
}

export async function startCompletionSession(tab: TabState, deps: StartupDeps) {
  tab.lspRunning = false
  try {
    let status = await deps.request<CompletionSessionStatus>('lsp.open', { path: tab.path, text: tab.content })
    const deadline = Date.now() + 65_000 // native initialize has a 60s request deadline
    while (deps.current() && status.running && status.ready === false && !status.error) {
      tab.lspConfigured = status.configured === true
      if (Date.now() >= deadline) throw new Error('语言服务器初始化超时，请检查服务器日志及其运行 JDK')
      await (deps.pause?.() ?? new Promise(resolve => setTimeout(resolve, 250)))
      if (!deps.current()) return
      try {
        status = await deps.request<CompletionSessionStatus>('lsp.request', { kind: 'status', path: tab.path })
      } catch (error) {
        // A host without the status route cannot certify readiness either.
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`无法查询语言服务器状态：${message}`)
      }
    }
    if (!deps.current()) return
    tab.lspConfigured = status.configured === true
    // A legacy native build without `ready` cannot certify initialization.
    tab.lspRunning = status.running && status.ready === true && !status.error
    if (tab.lspRunning) return
    if (status.error?.message) {
      // LSP 错误的 data.message 常带**定位到 JSON path** 的细节（例如 JDT LS 解析
      // initialize 能力失败时的 "Expected a boolean but was BEGIN_ARRAY … path
      // $.params.capabilities.…")——顶层 message 只有一句笼统的话，把它拼上才可排查。
      const detail = typeof (status.error as { data?: { message?: unknown } }).data?.message === 'string'
        ? `（${(status.error as { data: { message: string } }).data.message}）`
        : ''
      throw new Error(status.error.message + detail)
    }
    if (status.language === 'java' && !status.configured)
      // 宿主现在会**自动发现** PATH 上的 jdtls（native/lsp_discovery.cpp），所以
      // 「没配置」通常意味着机器上根本没有这台服务器 —— 说清楚是哪一种，用户才知道
      // 该装还是该配。只设置项目 JDK 不会带来代码提示（JDK 不含语言服务器）。
      throw new Error('Java 语义补全不可用：没有找到 Java 语言服务器。装好 JDT LS 并让它在 PATH 上（jdtls 可执行文件），或用 TaoCode.lsp.json 显式配置启动命令；只设置项目 JDK 不会提供代码提示。')
    if (status.configured) throw new Error('语言服务器未就绪，请检查启动配置、服务器运行 JDK；旧版宿主请更新后重试')
  } catch (error) {
    if (!deps.current()) return
    tab.lspRunning = false
    deps.notify(`${tab.path}：${error instanceof Error ? error.message : String(error)}`, true)
  }
}
