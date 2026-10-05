// 本地历史的**对话框**入口（IDEA ShowHistoryAction / LocalHistoryDialog 一族）。
// 从 App.vue 拆出（行数上限：组装层不再涨）。
//
// IDEA 侧：`platform/vcs-impl/src/com/intellij/localhistory/ShowHistoryAction.java` 的
// `actionPerformed` 按**当前文件**打开对话框；磁贴上没有 Local History —— 所以这里给的是
// 一个普通菜单行（id `vcs.localHistory.show`），不是工具窗口行。
//
// 本批起这一行也由动作注册表驱动（`src/actionRegistry.ts`）：文件菜单与 Git 菜单都通过
// `localHistoryMenuRow()` 取行，而行的可用性/处理器只在注册表里写一次。
import type { MenuRow } from './types'
import { ACTIONS, actionRow } from '../actionRegistry.ts'

export interface LocalHistoryDialogState {
  /** 对话框开关（App.vue 的模板用它挂 HistoryPanel）。 */
  dialog: { value: boolean }
  /** 是否具备打开条件（桌面端 + 已打开项目 + 有当前文件）。 */
  canShow: () => boolean
}

export function openHistoryDialog(state: LocalHistoryDialogState) {
  if (!state.canShow()) return
  state.dialog.value = true
}

export const LOCAL_HISTORY_ACTION_ID = 'vcs.localHistory.show'

export function localHistoryMenuRow(state: LocalHistoryDialogState): MenuRow {
  ACTIONS.register({
    id: LOCAL_HISTORY_ACTION_ID,
    title: '显示本地历史',
    keywords: 'show local history snapshot rollback 本地历史',
    source: 'menu',
    enabled: () => state.canShow(),
    run: () => openHistoryDialog(state),
  })
  return actionRow(LOCAL_HISTORY_ACTION_ID)
}
