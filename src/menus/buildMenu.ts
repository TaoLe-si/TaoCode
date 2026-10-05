// 一组一文件（桃 2026-09-26：模块化）；依赖经 ctx 注入，成员先用 any。
//
// 这一组从本批起由**动作注册表**驱动（`src/actionRegistry.ts`）：先注册四条动作描述符
// （id → 标题 / 可用性谓词 / 处理器），菜单行再由 `actionRow(id, …)` 取同一份数据 ——
// 菜单里不再各写一份 title/enabled/run。键位列照旧是本组自己的文案（Ctrl+F9 那两条走
// `src/keymap.ts` 的 if 链，不在 `KEY_BINDINGS` 尾部表里，所以 `keys` 在这里覆盖）。
import type { MenuRow } from './types'
import { ACTIONS, actionRow } from '../actionRegistry.ts'

export interface BuildMenuContext {
  isDesktop: boolean
  workspace: any
  runState: any
  startBuild: (rebuild?: any) => any
  stopRun: () => any
  showOutput: (id: any) => any
}

// 构建菜单（IDEA BuildMenu）的动作定义。
function registerBuildActions(ctx: BuildMenuContext): void {
  ACTIONS.register({
    id: 'build.project', title: '构建项目', keywords: 'build project make compile 构建', source: 'menu',
    enabled: () => ctx.isDesktop && Boolean(ctx.workspace.value) && !ctx.runState.running,
    run: () => void ctx.startBuild(false),
  })
  ACTIONS.register({
    id: 'build.rebuild', title: '重新构建项目', keywords: 'rebuild project clean 重新构建', source: 'menu',
    enabled: () => ctx.isDesktop && Boolean(ctx.workspace.value) && !ctx.runState.running,
    run: () => void ctx.startBuild(true),
  })
  ACTIONS.register({
    id: 'build.stop', title: '停止构建', keywords: 'stop build cancel 停止构建', source: 'menu',
    enabled: () => ctx.runState.running,
    run: () => void ctx.stopRun(),
  })
  ACTIONS.register({
    id: 'build.output', title: '构建结果窗口', keywords: 'build tab view tool window 构建输出', source: 'menu',
    enabled: () => Boolean(ctx.workspace.value),
    run: () => ctx.showOutput('run'),
  })
}

export function createBuildMenuRows(ctx: BuildMenuContext): MenuRow[] {
  registerBuildActions(ctx)
  return [
    actionRow('build.project', { keys: 'Ctrl F9' }),
    actionRow('build.rebuild', { keys: 'Ctrl Shift F9' }),
    actionRow('build.stop'),
    { id: 'build.rule1', rule: true },
    actionRow('build.output'),
  ]
}
