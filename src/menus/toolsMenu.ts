// 工具菜单（IDEA Tools 菜单的 TaoCode 对应物）：终端、待办事项。
// IDEA 的 CreateLauncherScriptAction 在 Windows 只显示说明（bin/ 里已有 idea.bat），
// TaoCode 无 CLI launcher，该行缺席而非造假。
// 一组一文件（桃 2026-09-26：模块化，模仿 IDEA 拆分引用）。
import type { MenuRow } from './types'

export interface ToolsMenuContext {
  isDesktop: boolean
  hasWorkspace: () => boolean
  /** IDEA `preferences.externalTools`：应用级的外部命令收藏。 */
  externalTools: () => Array<{ name: string; command: string }>
  /** 运行一条外部命令（TaoCode 走与构建相同的一条 run.start 通道）。 */
  runExternalTool: (command: string, name: string) => void
  // 签名窄化到本菜单实际用到的字面量：App 的宽函数可赋给窄参数函数（参数逆变）。
  showOutput: (id: 'terminal') => void
  showView: (id: 'todo') => void
}

export function createToolsMenuRows(ctx: ToolsMenuContext): MenuRow[] {
  return [
    { id: 'tools.terminal', title: '打开终端', keys: 'Alt F12', keywords: 'terminal open shell tool window 终端', enabled: () => ctx.isDesktop && ctx.hasWorkspace(), run: () => ctx.showOutput('terminal') },
    { id: 'tools.taskList', title: '待办事项工具窗口', keywords: 'tasks todo context 任务', enabled: () => ctx.hasWorkspace(), run: () => ctx.showView('todo') },
    { id: 'tools.rule1', rule: true },
    // IDEA 的"外部工具"组（ToolConfigurable）：应用级的命令收藏，直接从这里运行。
    { id: 'tools.externalTools', title: '外部工具', keywords: 'external tools 外部工具 命令', enabled: () => ctx.externalTools().length > 0, children:
      ctx.externalTools().map((tool, index) => ({ id: `tools.external.${index}`, title: tool.name, keywords: tool.command, enabled: () => ctx.isDesktop && ctx.hasWorkspace(), run: () => ctx.runExternalTool(tool.command, tool.name) })), },
  ]
}
