// 工具菜单（IDEA Tools 菜单的 TaoCode 对应物）：终端、待办事项。
// IDEA 的 CreateLauncherScriptAction 在 Windows 只显示说明（bin/ 里已有 idea.bat），
// TaoCode 无 CLI launcher，该行缺席而非造假。
// 一组一文件（桃 2026-09-26：模块化，模仿 IDEA 拆分引用）。
import type { MenuRow } from './types'
import { DEFAULT_TOOL_GROUP, enabledToolRecords, groupToolRecords, toolRecords } from '../externalToolsRecords.ts'

export interface ToolsMenuContext {
  isDesktop: boolean
  hasWorkspace: () => boolean
  /** IDEA `preferences.externalTools`：应用级的外部命令收藏。 */
  externalTools: () => Array<{ name: string; command: string }>
  /** 运行一条外部命令（TaoCode 走与构建相同的一条 run.start 通道）。 */
  runExternalTool: (command: string, name: string) => void
  /** 打开「端点」对话框（上游 `EndpointsView` 工具窗的等价物，见 src/endpointIndex.ts）。 */
  openEndpoints: () => void
  // 签名窄化到本菜单实际用到的字面量：App 的宽函数可赋给窄参数函数（参数逆变）。
  showOutput: (id: 'terminal') => void
  showView: (id: 'todo') => void
}

export function createToolsMenuRows(ctx: ToolsMenuContext): MenuRow[] {
  return [
    { id: 'tools.terminal', title: '打开终端', keys: 'Alt F12', keywords: 'terminal open shell tool window 终端', enabled: () => ctx.isDesktop && ctx.hasWorkspace(), run: () => ctx.showOutput('terminal') },
    { id: 'tools.taskList', title: '待办事项工具窗口', keywords: 'tasks todo context 任务', enabled: () => ctx.hasWorkspace(), run: () => ctx.showView('todo') },
    // 端点（上游 `EndpointsView` 是工具窗口；本仓是自绘弹层，所以挂在工具菜单而不是 View 的
    // 工具窗清单里 —— 不放假工具窗按钮）。扫描规则见 src/endpointIndex.ts。
    { id: 'tools.endpoints', title: '端点…', keywords: 'endpoints http routes microservices 端点 路由', enabled: () => ctx.isDesktop && ctx.hasWorkspace(), run: () => ctx.openEndpoints() },
    { id: 'tools.rule1', rule: true },
    // IDEA 的"外部工具"组（ToolConfigurable）：应用级的命令收藏，直接从这里运行。
    // 停用的工具不出现（`BaseToolManager.java:164` 的 `!o.isEnabled()`），
    // 「所属分组」不是缺省分组的那批各建一层子菜单（`:89-113` 每个 ToolsGroup 一个 delegate group）。
    { id: 'tools.externalTools', title: '外部工具', keywords: 'external tools 外部工具 命令', enabled: () => visibleToolCount(ctx) > 0, childrenOf: () => externalToolRows(ctx) },
  ]
}

/** 宿主那条 `command` 才是运行的内容（详情表只补分组/启用这些档，命令仍以 `{name, command}` 为准）。 */
function hostCommandByName(ctx: ToolsMenuContext): Map<string, string> {
  const commands = new Map<string, string>()
  for (const tool of ctx.externalTools()) commands.set(tool.name, tool.command)
  return commands
}

function visibleToolCount(ctx: ToolsMenuContext): number {
  return enabledToolRecords(toolRecords(ctx.externalTools())).length
}

/** 「工具 › 外部工具」的子行。 */
function externalToolRows(ctx: ToolsMenuContext): MenuRow[] {
  const commands = hostCommandByName(ctx)
  const rows: MenuRow[] = []
  for (const group of groupToolRecords(enabledToolRecords(toolRecords(ctx.externalTools())))) {
    const children = group.tools.map(tool => {
      const command = commands.get(tool.name) ?? [tool.program, tool.parameters].filter(Boolean).join(' ')
      return {
        id: `tools.external.${tool.name}`,
        title: tool.name,
        // 说明（`Tool.java:57` → 上游 `ToolAction.java:57` 的 description 槽位）拼进 keywords，
        // 让「查找操作」也搜得到；MenuRow 没有 description 字段（`src/menus/types.ts` 冻结）。
        keywords: `${command}${tool.description ? ` ${tool.description}` : ''}`,
        enabled: () => ctx.isDesktop && ctx.hasWorkspace() && Boolean(command.trim()),
        run: () => ctx.runExternalTool(command, tool.name),
      }
    })
    if (group.group === DEFAULT_TOOL_GROUP) { rows.push(...children); continue }
    rows.push({ id: `tools.external.group.${group.group}`, title: group.group, keywords: 'external tools group 外部工具 分组', children })
  }
  return rows
}
