import type { LspOpenResult } from './bridge'
import { noteDocumentOpened, recordSessionStatus, resetLspSession } from './lsSessionHost.ts'

// Extra native status fields are kept local until bridge.ts's shared contract is
// updated; the transport is still the existing lsp.request route.
export type CompletionSessionStatus = LspOpenResult & { ready?: boolean; error?: { code?: string | number; message?: string } }
interface TabState { path: string; content: string; lspRunning?: boolean; lspConfigured?: boolean }
interface StartupDeps {
  request: <T>(method: 'lsp.open' | 'lsp.request' | 'lsp.stop', params: Record<string, unknown>) => Promise<T>
  notify: (message: string, error?: boolean) => void
  current: () => boolean
  pause?: () => Promise<void>
}

// 一次状态查询最多等多久。原生那条语言服务线程**可能卡在一次任务里**（真机上见过：
// 大工程握手之后整条线程不再接活，请求永远不回）—— 没有这个上限，上面那个 `await` 会
// 一直挂着：既不给用户任何提示，也不会走到超时分支。
export const LSP_STATUS_TIMEOUT_MS = 10_000
const NO_RESPONSE = 'LSP_NO_RESPONSE'

async function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
    })])
  } finally { if (timer !== undefined) clearTimeout(timer) }
}

export async function startCompletionSession(tab: TabState, deps: StartupDeps, attempt = 0) {
  tab.lspRunning = false
  try {
    let status = await deps.request<CompletionSessionStatus>('lsp.open', { path: tab.path, text: tab.content })
    // **回包即状态**（`LspServerState.kt:10-12`：`Initializing` 只有收到 initialize 回包才变 `Running`）。
    // 这两行是本仓 `lspSessionStates` 与前端文档账**唯一的生产写入方** —— 宿主不推状态变化事件
    // （`src/bridge.ts` 的 lsp 事件只有 diagnostics/progress/message/edited），所以这张表只能由
    // 读回包的地方记。记完之后 `src/lsFeaturesWidget.ts`（状态面）、`src/quickDocHost.ts`
    // （「服务器正在启动」提示）与状态栏才查得到真状态，而不是各自抄一份。
    // 文档账那条对应宿主的 `Session::open`（`native/lsp_session.cpp:84-92`：建文档、`version = 1`，
    // 握手 ready 之后才 `opened = true`）—— 这里记的是**前端这一份可对账的镜像**。
    noteDocumentOpened(tab.path, status.running === true && status.ready === true, status.language)
    recordSessionStatus(status, tab.path)
    const deadline = Date.now() + 65_000 // native initialize has a 60s request deadline
    while (deps.current() && status.running && status.ready === false && !status.error) {
      tab.lspConfigured = status.configured === true
      if (Date.now() >= deadline) throw new Error('语言服务器初始化超时，请检查服务器日志及其运行 JDK')
      await (deps.pause?.() ?? new Promise(resolve => setTimeout(resolve, 250)))
      if (!deps.current()) return
      try {
        status = await withTimeout(
          deps.request<CompletionSessionStatus>('lsp.request', { kind: 'status', path: tab.path }),
          LSP_STATUS_TIMEOUT_MS, NO_RESPONSE)
        recordSessionStatus(status, tab.path)
      } catch (error) {
        // 语言服务线程没响应（而不是"答了一个错"）：`lsp.stop` 现在**不排那条队列**，
        // 它在原生里会把卡住的线程收掉、换一条新的、并重配服务器（见 main.cpp 的 recover_lsp_now）。
        // 恢复之后整体重来一次；第二次再没响应就按普通错误报出去。
        const message = error instanceof Error ? error.message : String(error)
        if (attempt === 0 && deps.current()) {
          deps.notify(`${tab.path}：语言服务没有响应，正在重启语言服务…`)
          // 换进程 = **新的客户端对象**（`LspClientImpl.kt:83-84`：停机态是终态，终态之后不会自己活）。
          // 不清这张表的话，新会话的第一份回包会被状态闸拒掉，状态面永远停在「已终止」。
          resetLspSession(typeof status.language === 'string' ? status.language : undefined)
          try { await withTimeout(deps.request('lsp.stop', {}), 15_000, NO_RESPONSE) } catch { /* 收不掉也照旧往下报 */ }
          // 递归这一下要 `await` 并**接住它自己的报错**（它有自己那份 catch 会 notify）：
          // 直接 `return` 这个 promise 的话，第二次的错误会绕开两边的 catch 变成未处理的 rejection。
          if (deps.current()) { await startCompletionSession(tab, deps, attempt + 1); return }
          return
        }
        // A host without the status route cannot certify readiness either.
        throw new Error(message === NO_RESPONSE
          ? '语言服务器没有响应（已尝试重启语言服务）。'
          : `无法查询语言服务器状态：${message}`)
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
