// LSP `documentLink` 那半条「绝对路径要落回工作区相对路径」的规则 —— App.vue 的
// `openDocumentLink` 中段（原 1052-1059 行）。
// 2026-10-06 逐字搬入本文件：反斜杠归一、工作区根的尾部斜杠归一、
// 「盘符开头或以 `/` 开头才算绝对路径」的判据、大小写不敏感的前缀比较、
// `path.slice(root.length + 1)` 的截取长度（用的是**归一前**的 root 长度，与原来一致），
// 以及「落在工作区外就如实说明、不拿猜出来的路径去打开」那一档。
//
// 上游坐标随注释搬家（原话，未改一字）：
//   「绝对路径要落回工作区相对路径才能被 openFile 找到；落在工作区外的如实说明，
//     而不是拿一个猜出来的路径去打开（那会开出完全不相关的文件）。」
//
// 为什么能搬：这是 `(工作区根, 链接里的路径) => 该开哪个路径 / 该说什么` 的纯函数，
// 提示文案与「不开」这一档由调用方（装配根）决定，所以通知语句仍留在宿主那一行。
export type LinkPathResult =
  /** 链接里本来就是相对路径：原样交给 openFile 的口径。 */
  | { kind: 'relative'; path: string }
  /** 绝对路径且在工作区内：已剥掉根前缀。 */
  | { kind: 'inside'; path: string }
  /** 绝对路径但落在工作区外：`shown` 是给用户看的那份原文（未剥前缀）。 */
  | { kind: 'outside'; shown: string }

export function linkPathWithinWorkspace(root: string | null | undefined, rawPath: string): LinkPathResult {
  const workspaceRoot = root?.replace(/\\/g, '/').replace(/\/+$/, '')
  const path = rawPath.replace(/\\/g, '/')
  if (workspaceRoot && (/^[A-Za-z]:/.test(path) || path.startsWith('/'))) {
    if (path.toLowerCase().startsWith(`${workspaceRoot.toLowerCase()}/`)) return { kind: 'inside', path: path.slice(workspaceRoot.length + 1) }
    return { kind: 'outside', shown: rawPath }
  }
  return { kind: 'relative', path }
}
