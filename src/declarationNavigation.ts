// 「转到声明」的解析链（Ctrl+B）：EP 处理器 + 宿主 LSP 通道的目标合并后，
// 有位置就直接跳、多个开「选择声明」弹层、一个都没有就安静。
//
// 上游：`GotoDeclarationOnlyHandler2.kt:60-76` 的两条分支（SingleTarget 直接跳 / MultipleTargets 开弹层），
// 弹层见 `src/chooseTarget.ts` 与 `src/chooseTargetHost.ts`。目标从哪来另有一条 EP ——
// `com.intellij.gotoDeclarationHandler`（`GotoDeclarationHandler.java:21`）：语言插件各挂自己的处理器，
// 平台汇起全部结果再走上面两条分支。本仓的宿主那一份（LSP `textDocument/definition`）作为
// 「排在最后的一条内置贡献」由 `collectDeclarationTargets` 的 `builtin` 参传进去，
// 插件/测试可按 EP id 挂自己的处理器（`src/gotoDeclarationExtensionPoints.ts`）。
//
// 单独一个文件的原因与其它宿主一致：`CodeEditor.vue` 贴着机检上限（只降不升），
// 编辑器里只留"建一次 + 两个调用点（命令与 Ctrl+B）"。
import type { TargetLocation } from './chooseTarget.ts'
import { collectDeclarationTargets } from './gotoDeclarationExtensionPoints.ts'

export interface DeclarationNavigationDeps {
  /** 语言服务是否可用（关了就什么都不做）。 */
  enabled: () => boolean
  path: () => string
  request: <T>(method: 'lsp.request', params: Record<string, unknown>) => Promise<T>
  /** 打开「选择声明」弹层（坐标由调用方给，只有编辑器知道光标在哪）。 */
  openChooser: (targets: readonly TargetLocation[], at: { x?: number; y?: number }) => Promise<unknown> | unknown
  /** 跳到一个位置（宿主那条导航通道；`column` 是 1 基）。 */
  reveal: (target: { path: string; line: number; column: number }) => void
}

export function createDeclarationNavigation(deps: DeclarationNavigationDeps) {
  /** 宿主自己的那一份目标（LSP `textDocument/definition`；服务端没回可用应答就是空表）。 */
  async function lspDeclarationTargets(line: number, character: number): Promise<TargetLocation[]> {
    const result = await deps.request<{ available: boolean; locations?: TargetLocation[] }>(
      'lsp.request', { kind: 'definition', path: deps.path(), line, character })
    return result.available ? result.locations ?? [] : []
  }

  /** `line`/`character` 是 LSP 的 0 基坐标；`at` 是弹层锚点。 */
  async function revealDefinition(line: number, character: number, at?: { x?: number; y?: number }) {
    if (!deps.enabled()) return
    try {
      const targets = await collectDeclarationTargets(
        { path: deps.path(), line, character }, lspDeclarationTargets(line, character))
      if (!targets.length) return
      if (targets.length > 1) { await deps.openChooser(targets, at ?? {}); return }
      const target = targets[0]!
      deps.reveal({ path: target.path, line: target.line, column: target.character + 1 })
    } catch { /* 语言服务未就绪时不提示 */ }
  }
  return { revealDefinition }
}
