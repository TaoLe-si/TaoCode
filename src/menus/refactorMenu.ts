// 一组一文件（桃 2026-09-26：模块化）；依赖经 ctx 注入，成员先用 any。
import type { MenuRow } from './types'

export interface RefactorMenuContext {
  active: any
  lspReady: any
  isDesktop: boolean
  caretPayload: (arg?: any) => any
  openCodeActions: (arg?: any, flag?: any) => any
  extractVariable: () => any
  extractConstant: () => any
  extractMethod: () => any
  inlineVariable: () => any
  moveActiveFile: () => any
  copyActiveFile: () => any
  semantic: (kind: any, title: any, keys: any, keywords: any) => MenuRow
}

// 重构菜单（IDEA RefactorMenu 的 TaoCode 对应物）。
export function createRefactorMenuRows(ctx: RefactorMenuContext): MenuRow[] {
  return [
    // IDEA RefactorMenu: 重构... (Refactor This, Ctrl+Alt+Shift+T) first.
    { id: 'refactor.this', title: '重构…', keys: 'Ctrl Alt Shift T', keywords: 'refactor this 重构', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: () => void ctx.openCodeActions(ctx.caretPayload()) },
    { id: 'refactor.extractVariable', title: '提取变量', keys: 'Ctrl Alt V', keywords: 'extract variable local 提取变量', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: ctx.extractVariable },
    { id: 'refactor.ExtractConstant', title: '提取常量', keys: 'Ctrl Alt C', keywords: 'extract constant field 提取常量', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: ctx.extractConstant },
    { id: 'refactor.ExtractMethod', title: '提取方法', keys: 'Ctrl Alt M', keywords: 'extract method function 提取方法', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: ctx.extractMethod },
    { id: 'refactor.rule1', rule: true },
    ctx.semantic('rename', '重命名', 'Shift F6', 'rename refactor symbol 重命名'),
    // IDEA RefactorMenu file rows: 移动文件 F6 / 复制文件 F5 (real 2026.2 UI).
    { id: 'refactor.moveFile', title: '移动文件…', keys: 'F6', keywords: 'move file refactor 移动文件', enabled: () => Boolean(ctx.active.value) && ctx.isDesktop, run: () => void ctx.moveActiveFile() },
    { id: 'refactor.copyFile', title: '复制文件…', keys: 'F5', keywords: 'copy file refactor 复制文件', enabled: () => Boolean(ctx.active.value) && ctx.isDesktop, run: () => void ctx.copyActiveFile() },
    { id: 'refactor.inline', title: '内联', keys: 'Ctrl Alt N', keywords: 'inline variable method constant 内联', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: ctx.inlineVariable },
    { id: 'refactor.rule2', rule: true },
    ctx.semantic('format', '重新格式化代码', 'Ctrl Alt L', 'format code reformat 格式化'),
  ]
}
