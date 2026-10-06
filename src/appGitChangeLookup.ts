// 「这一条路径在 git 变更表里对应哪一项」—— App.vue 的 `gitChangeFor`（原 543-549 行）。
// 2026-10-06 逐字搬入本文件：两侧都先归成绝对路径再比的写法（`absolutePath(root, …)`）、
// `find` 而不是 `filter`、找不到回 `undefined` 都保持原样。
//
// 上游坐标随注释搬家（原话，未改一字）：
//   「git reports repo-relative paths while an editor path may be absolute (an LSP location), so both
//     sides are reduced to the absolute form before they are compared.」
//
// 为什么能搬：输入只有「工作区根 + 一条路径 + 那份变更表」，不读 ref、不发请求；
// 表本身（`gitChanges`）与根（`workspace`）留在宿主，调用点仍是一行取值器。
import { absolutePath, isSameFile } from './filenameWidget.ts'
import type { GitChange } from './bridge.ts'

export function findGitChange(root: string, path: string, changes: readonly GitChange[]): GitChange | undefined {
  const absolute = absolutePath(root, path)
  return changes.find(change => isSameFile(absolutePath(root, change.path), absolute))
}
