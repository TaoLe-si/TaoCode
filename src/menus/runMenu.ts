// 一组一文件（桃 2026-09-26：模块化）；依赖经 ctx 注入，成员先用 any。
import type { MenuRow } from './types'

export interface RunMenuContext {
  active: any
  dapState: any
  explorer: any
  leftView: any
  runState: any
  workspace: any
  isDesktop: boolean
  lastRunParams: any
  notify: (message: string, error?: boolean) => void
  runSelectedConfig: (debug: any) => any
  runContextConfiguration: (debug: any) => any
  /** IDEA 的 Run to Cursor（Alt+F9）。 */
  runToCursor: () => void
  openConfigChooser: (debug: any) => any
  rerunLast: () => any
  stopRun: () => any
  showOutput: (id: any) => any
  /** 打开「运行/调试配置」对话框（IDEA RunConfigurationsDialog）。 */
  openRunConfigurations: () => void
  toolWindow: (view: any, title: any, keywords: any, needsDesktop?: any) => MenuRow
  editable: (name: any, title: any, keys?: any, keywords?: any) => MenuRow
}

// 运行菜单（IDEA RunMenu 的 TaoCode 对应物）。
export function createRunMenuRows(ctx: RunMenuContext): MenuRow[] {
  return [
    { id: 'run.start', title: '运行', keys: 'Shift F10', keywords: 'run build execute task 运行', enabled: () => ctx.isDesktop && Boolean(ctx.workspace.value) && !ctx.runState.running, run: () => void ctx.runSelectedConfig(false) },
    { id: 'run.debug', title: '调试', keys: 'Shift F9', keywords: 'debug start breakpoint dap 调试', enabled: () => ctx.isDesktop && Boolean(ctx.workspace.value) && !ctx.dapState.running, run: () => void ctx.runSelectedConfig(true) },
    { id: 'run.debugContext', title: '调试当前上下文配置', keywords: 'debug contextual configuration 调试上下文', enabled: () => ctx.isDesktop && Boolean(ctx.active.value) && !ctx.dapState.running, run: () => void ctx.runContextConfiguration(true) },
    // IDEA Run 菜单里的 RunToCursor / ForceRunToCursor（`$default.xml:990-995`：Alt+F9 / Ctrl+Alt+F9）。
    // DAP 没有"强制"语义，两条走同一条 gotoTargets+goto，标题如实区分。
    { id: 'run.toCursor', title: '运行到光标处', keys: 'Alt F9', keywords: 'run to cursor gotoTargets 运行到光标处', enabled: () => ctx.isDesktop && Boolean(ctx.workspace.value) && ctx.dapState.running && ctx.dapState.paused, run: () => void ctx.runToCursor() },
    { id: 'run.forceToCursor', title: '强制运行到光标处', keys: 'Ctrl Alt F9', keywords: 'force run to cursor ignore breakpoints 强制运行到光标处', enabled: () => ctx.isDesktop && Boolean(ctx.workspace.value) && ctx.dapState.running && ctx.dapState.paused, run: () => void ctx.runToCursor() },
    { id: 'run.pickConfig', title: '选择运行/调试配置', keys: 'Alt Shift F10', keywords: 'select run configuration choose active edit 选择配置', enabled: () => Boolean(ctx.workspace.value), run: () => ctx.openConfigChooser(false) },
    { id: 'run.rerun', title: '重新运行', keys: 'Ctrl F5', keywords: 'rerun relaunch last 重新运行', enabled: () => Boolean(ctx.lastRunParams) && !ctx.runState.running, run: () => void ctx.rerunLast() },
    { id: 'run.stop', title: '停止', keys: 'Ctrl F2', keywords: 'stop terminate kill 停止', enabled: () => ctx.runState.running, run: () => void ctx.stopRun() },
    // RunClass in the default keymap: run whatever is under the caret.
    { id: 'run.context', title: '运行当前上下文配置', keys: 'Ctrl Shift F10', keywords: 'run contextual configuration run class 运行上下文', enabled: () => ctx.isDesktop && Boolean(ctx.active.value) && !ctx.runState.running, run: () => void ctx.runContextConfiguration(false) },
    { id: 'run.rule1', rule: true },
    // IDEA Run menu (real 2026.2 UI): 附加到进程 Ctrl+Alt+F5, 查看断点 Ctrl+Shift+F8,
    // 编辑配置 — the rows route to the debug/run panels that own those editors.
    { id: 'run.attach', title: '附加到进程…', keys: 'Ctrl Alt F5', keywords: 'attach to process debug 附加进程', enabled: () => ctx.isDesktop && Boolean(ctx.workspace.value) && !ctx.dapState.running, run: () => { ctx.explorer.value = true; ctx.leftView.value = 'debug'; ctx.notify('在调试面板填写进程 PID 或管道名后点“附加”。') } },
    { id: 'run.viewBreakpoints', title: '查看断点…', keys: 'Ctrl Shift F8', keywords: 'view breakpoints 断点 查看', enabled: () => ctx.isDesktop && Boolean(ctx.workspace.value), run: () => { ctx.explorer.value = true; ctx.leftView.value = 'debug' } },
    { id: 'run.editConfigs', title: '编辑配置…', keywords: 'edit configurations run debug 配置 编辑', enabled: () => Boolean(ctx.workspace.value), run: () => { ctx.openRunConfigurations() } },
    { id: 'run.output', title: '显示运行输出', keywords: 'run console output 运行输出', enabled: () => Boolean(ctx.workspace.value), run: () => ctx.showOutput('run') },
    { id: 'run.log', title: '显示操作输出', keywords: 'trace bridge log 操作输出', enabled: () => Boolean(ctx.workspace.value), run: () => ctx.showOutput('output') },
    ctx.toolWindow('debug', '显示调试面板', 'debug debugger tool window 调试面板', true),
    ctx.editable('evaluate', '求值表达式', 'Alt F8', 'evaluate expression watch 求值'),
  ]
}
