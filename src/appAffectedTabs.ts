// 「这条路径上还有哪些没保存的缓冲区」—— App.vue 的重命名与删除前那道闸门用的同一张筛选
//（原 1758-1760 与 1797-1799 两段，两处本来就是**同一条规则**抄了两遍）。
// 2026-10-06 逐字搬入本文件：目录档「等于该路径 **或** 落在该路径之下」的两种判法、
// 文件档「只等于该路径」的判法、以及 `dirty` 前置条件，全部与搬走之前一致。
//
// 上游坐标（随注释一起搬，未改一字）：
//   · 重命名那处原话：「The file moves on disk while the tab still holds unsaved text: without this
//     gate the rename silently dropped the buffer's edits. Save/discard/cancel first.」
//   · 删除那处原话：「Same rule as rename: deleting a file with an unsaved buffer must not throw the
//     user's edits away without asking.」
//     两处共用一条规则，正是那句「Same rule as rename」的字面实现。
import type { Tab } from './editorTab.ts'

/** 目录传 `true`（要连子树里打开的文件一起算），文件传 `false`。 */
export function affectedDirtyTabs(tabs: readonly Tab[], path: string, isDirectory: boolean): Tab[] {
  return isDirectory
    ? tabs.filter(tab => tab.dirty && (tab.path === path || tab.path.startsWith(`${path}/`)))
    : tabs.filter(tab => tab.dirty && tab.path === path)
}
