// 「附加到进程」的标识解析与提示文案（上游 `XAttachDebuggerProvider` 一族：
// `XLocalAttachDebugger` 管本机 PID，`WslAttachHost` 管 WSL 主机 —— 本仓只有本机通道）。
//
// Debug 面板的附加框收一个标识，按形状分派：
//   · 纯数字 = 本机进程 PID → DAP `attach` 的 `processId`；
//   · 其它非空文本 = 适配器约定的连接标识（管道名、`主机:端口`…）→ `pipeName`。
// 这与 `DebugPanel.attach()` 原有的分派一致，抽出来是为了：① 可单测；② **说明远程附加怎么走**——
// 本仓不做 WSL/SSH 通道（`exec/wsl`、`pf/remote` 判 `[-]`），远程附加只能靠 `TaoCode.dap.json`
// 里配置的适配器自身连过去；面板在界面上如实写清这一点，不暗示本仓有远程后端。
//
// 逐适配器的提示只覆盖本仓示例配置里真实出现过的 kind（`TaoCode.dap.json.example`：
// cppvsdbg / lldb-dap / fake），其余走通用文案 —— 不发明适配器不提供的字段。
//
// 「可用附加目标」那一句来自 `com.intellij.xdebugger.attachHostProvider` EP（消费面
// `src/xdebuggerExtensionPoints.ts` 的 `attachHostSummary`）：内建登记本机一条，第三方插件
// 可挂自己的 host（远程通道）—— 于是提示里列的是**当前真的能用**的目标，不是写死的文案。
// 「可用调试器」那一句来自 `com.intellij.xdebugger.attachDebuggerProvider` EP（消费面
// `xattachDebuggerProvidersFor`，按上游 `isAttachHostApplicable(host)` 过滤）：第三方注册一条
// 适用于 `Local` 的提供者后，它的分组名会出现在这句提示里 —— 这是那条 EP 的**真实消费点**
// （上游 `XAttachDebuggerProvider` 的完整流程还要 `getAvailableDebuggers(project, process)`
// 去列进程上的调试器，本仓没有进程枚举通道，见 `dbg/attach` 族判词）。

import { attachHostSummary, xattachDebuggerProvidersFor, type AttachHost } from './xdebuggerExtensionPoints.ts'

export interface AttachSelector {
  kind: 'pid' | 'pipe'
  processId?: number
  pipeName?: string
}

/** 空串 = 还没填；非法（例如 `0`）返回 null。 */
export function parseAttachSelector(text: string): AttachSelector | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (/^\d+$/.test(trimmed)) {
    const processId = Number(trimmed)
    // PID 0 是系统空闲进程，不是「一个可附加的进程」——按非法处理，别让适配器去试。
    if (!Number.isSafeInteger(processId) || processId <= 0) return null
    return { kind: 'pid', processId }
  }
  return { kind: 'pipe', pipeName: trimmed }
}

/** 附加框下方的提示：这个标识会被怎么解释 + 远程附加的真实前提 + 当前可用目标/调试器。 */
export function attachGuidance(kind: string): string {
  const adapter = kind.trim() || 'cppvsdbg'
  const local = adapter === 'cppvsdbg'
    ? '数字 = 本机进程 PID（OpenDebugAD7 的 processId）。'
    : adapter === 'lldb-dap'
      ? '数字 = 本机进程 PID；其它文本按 lldb-dap 的连接标识（如 lldb-server 的 host:port）理解。'
      : adapter === 'java'
        ? '数字 = 本机 PID；JDWP 目标的连接标识填 host:port（目标需以 -agentlib:jdwp=transport=dt_socket,server=y,address=… 启动）。'
        : adapter === 'debugpy'
          ? '数字 = 本机 PID；debugpy 的监听地址填 host:port。'
          : '数字 = 本机进程 PID；其它文本作为适配器约定的连接标识（pipeName / host:port）原样转交。'
  // 可用目标：`com.intellij.xdebugger.attachHostProvider` EP 的消费面。一个贡献都没登记时为空串
  // （与之前逐字相同）；第三方挂远程 host 时这里如实列出。
  const targets = attachHostSummary()
  const targetsText = targets === '（无）' ? '' : ` 可用目标：${targets}。`
  // 可用调试器：`com.intellij.xdebugger.attachDebuggerProvider` EP 的消费面（按 host 过滤）。
  // 一个提供者都没登记（或都不认本机通道）时为空串，与之前逐字相同。
  const debuggers = availableLocalAttachDebuggers()
  const debuggersText = debuggers.length ? ` 可用调试器：${debuggers.join('、')}。` : ''
  return `${local} 远程附加：先在目标机启动调试适配器的服务端，把它的连接标识填进来 —— 通道由 TaoCode.dap.json 里配置的适配器提供；本仓没有 WSL/SSH 远程后端。${targetsText}${debuggersText}`
}

/**
 * 适用本机通道（`Local`）的附加调试器分组名（上游 `XAttachDebuggerProvider.getPresentationGroup()`
 * 的可移植面）。一个提供者都不认本机通道时是空表；坏提供者（`getGroupName` 抛错）不吞掉别的条目。
 */
export function availableLocalAttachDebuggers(host: AttachHost = 'Local'): string[] {
  const out: string[] = []
  for (const provider of xattachDebuggerProvidersFor(host)) {
    try {
      const name = provider.getGroupName?.() ?? provider.id
      if (name && !out.includes(name)) out.push(name)
    } catch { /* 容错：坏提供者不影响其余条目 */ }
  }
  return out
}

/** 未通过解析时的就地错误（和原实现的文案一致，补上 PID 0 的说明）。 */
export function attachSelectorError(text: string): string {
  if (!text.trim()) return '请填写要附加的进程 PID 或管道名。'
  if (parseAttachSelector(text) === null) return 'PID 必须是大于 0 的整数；其它标识按适配器约定填写（如 host:port）。'
  return ''
}

// ── 最近附加过的目标（本轮补）──────────────────────────────────────────────────────
// 上游 `AttachToProcessDialog` 里有「最近使用的进程」一栏（本机进程列表则是
// `XAttachDebuggerProvider` 给的，依赖宿主进程枚举通道 —— 本仓没有，见 dbg/attach 判词）。
// 进程列表做不了，但「最近填过的附加标识」是纯前端事实，存 localStorage 供下次一键选回。
// 机器级而不是项目级：PID / 管道名跟着目标机走，与当前打开哪个项目无关。

/** 最近附加目标的存储键与条数上限。 */
export const ATTACH_HISTORY_KEY = 'taocode.debugAttachTargets'
export const ATTACH_HISTORY_LIMIT = 8

/** localStorage 的最小面（单测传假对象即可，不依赖 window）。 */
export interface AttachHistoryStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 置顶 + 去重 + 截断（trim 后为空不记；不改原数组）。 */
export function pushAttachTarget(history: readonly string[], target: string, limit = ATTACH_HISTORY_LIMIT): string[] {
  const trimmed = target.trim()
  if (!trimmed) return [...history]
  return [trimmed, ...history.filter(entry => entry !== trimmed)].slice(0, limit)
}

/** 解析历史（坏数据 → 空表；只收非空字符串、去重保序）。 */
export function parseAttachHistory(raw: string | null | undefined): string[] {
  if (!raw) return []
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(parsed)) return []
  const out: string[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'string') continue
    const text = entry.trim()
    if (!text || out.includes(text)) continue
    out.push(text)
    if (out.length >= ATTACH_HISTORY_LIMIT) break
  }
  return out
}

export function loadAttachHistory(store: AttachHistoryStore | null | undefined): string[] {
  if (!store) return []
  try { return parseAttachHistory(store.getItem(ATTACH_HISTORY_KEY)) } catch { return [] }
}

export function saveAttachHistory(store: AttachHistoryStore | null | undefined, history: readonly string[]): void {
  if (!store) return
  try { store.setItem(ATTACH_HISTORY_KEY, JSON.stringify(parseAttachHistory(JSON.stringify(history)))) } catch { /* session-only */ }
}
