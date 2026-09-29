// 本地历史的**对话框**入口（IDEA ShowHistoryAction / LocalHistoryDialog 一族）。
// 从 App.vue 拆出（行数上限：组装层不再涨）。
//
// IDEA 侧：`platform/vcs-impl/src/com/intellij/localhistory/ShowHistoryAction.java` 的
// `actionPerformed` 按**当前文件**打开对话框；磁贴上没有 Local History —— 所以这里给的是
// 一个普通菜单行（id `vcs.localHistory.show`），不是工具窗口行。
import type { MenuRow } from './types'

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

export function localHistoryMenuRow(state: LocalHistoryDialogState): MenuRow {
  return {
    id: 'vcs.localHistory.show',
    title: '显示本地历史',
    keywords: 'show local history snapshot rollback 本地历史',
    enabled: () => state.canShow(),
    run: () => openHistoryDialog(state),
  }
}
