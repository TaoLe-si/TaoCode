// 一组一文件（桃 2026-09-26：模块化）；依赖经 ctx 注入，成员先用 any。
import type { MenuRow } from './types'

export interface BuildMenuContext {
  isDesktop: boolean
  workspace: any
  runState: any
  startBuild: (rebuild?: any) => any
  stopRun: () => any
  showOutput: (id: any) => any
}

// 构建菜单（IDEA BuildMenu）。
export function createBuildMenuRows(ctx: BuildMenuContext): MenuRow[] {
  return [
    { id: 'build.project', title: '构建项目', keys: 'Ctrl F9', keywords: 'build project make compile 构建', enabled: () => ctx.isDesktop && Boolean(ctx.workspace.value) && !ctx.runState.running, run: () => void ctx.startBuild(false) },
    { id: 'build.rebuild', title: '重新构建项目', keys: 'Ctrl Shift F9', keywords: 'rebuild project clean 重新构建', enabled: () => ctx.isDesktop && Boolean(ctx.workspace.value) && !ctx.runState.running, run: () => void ctx.startBuild(true) },
    { id: 'build.stop', title: '停止构建', keywords: 'stop build cancel 停止构建', enabled: () => ctx.runState.running, run: () => void ctx.stopRun() },
    { id: 'build.rule1', rule: true },
    { id: 'build.output', title: '构建结果窗口', keywords: 'build tab view tool window 构建输出', enabled: () => Boolean(ctx.workspace.value), run: () => ctx.showOutput('run') },
  ]
}
