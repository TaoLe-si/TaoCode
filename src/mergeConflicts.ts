// 合并冲突的**逐条解决**（上游 `MergeThreesideViewer` 的两个按钮在标记文本这条路上的落点）。
//
// 上游那张三栏工具（base / 左 / 右 + 结果栏）读的是 **VCS 给的三份内容**，不是文件里的标记文本；
// 按钮文案见 `MergeThreesideViewer.java:333-336`（`handleAcceptSide`，`button.merge.resolve.accept.left`
// / `.right`，中文包里就是「接受左侧」/「接受右侧」）。整棵上游树上唯一认这几个标记的地方是
// `plugins/git4idea/backend/src/merge/GitMergeUtil.java:63-67` 的 `MERGE_MARKERS` —— 用它判断
// "这个文件还处在冲突态"。
//
// TaoCode 没有读索引三阶段内容这条路，但用户**天天遇到**的是 git 留下的冲突文件：
//
//     <<<<<<< HEAD
//     我们的内容
//     =======  （diff3 风格还多一段 `||||||| 基线`）
//     他们的内容
//     >>>>>>> feature/x
//
// 于是本模块把**功能**还原到标记文本上：解析标记 → 逐条接受左侧/右侧 → 未决计数与导航。
// 这是同一个场景（`git merge` 之后的文件）的另一种入口，不是上游那张三栏窗口的复制品。
//
// **不做的**（上游那个工具里也没有「接受两者」按钮，做了就是发明）：想两边都要就在缓冲区里手编
// —— 结果缓冲区就是编辑器本身，与上游的结果栏同理。

/** `<<<<<<<` 那一行的前缀（git 与 IDEA 都认这 7 个字符）。 */
export const CONFLICT_START = '<<<<<<<'
export const CONFLICT_BASE = '|||||||'
export const CONFLICT_MIDDLE = '======='
export const CONFLICT_END = '>>>>>>>'

/** 一个冲突在**行**坐标里的四段（都是 0 基行号，闭区间）。 */
export interface Conflict {
  /** `<<<<<<<` 那一行。 */
  startLine: number
  /** `=======` 那一行（没有 `|||||||` 时就是左右的分界）。 */
  middleLine: number
  /** `|||||||` 那一行（diff3 风格才有）。 */
  baseLine: number | null
  /** `>>>>>>>` 那一行。 */
  endLine: number
  /** 左侧（ours）的行区间（半开）。 */
  ours: { from: number; to: number }
  /** 右侧（theirs）的行区间（半开）。 */
  theirs: { from: number; to: number }
}

/**
 * 解析一份带冲突标记的文本。**只认成对的标记**：见到 `<<<<<<<` 之后必须依次看到
 * `=======` 与 `>>>>>>>`，否则这一处不算冲突（半个标记多半是用户正在编辑的中间态，
 * 拿它当冲突会让人没法编辑）。
 *
 * `startLine` 从 0 起，与 CodeMirror 的行号一致（`src/` 里凡是行号都用 0 基，显示时再 +1）。
 */
export function parseConflicts(content: string): Conflict[] {
  const lines = content.split('\n')
  const conflicts: Conflict[] = []
  let i = 0
  while (i < lines.length) {
    if (!lines[i]!.startsWith(CONFLICT_START)) { i++; continue }
    const startLine = i
    let middleLine = -1
    let baseLine: number | null = null
    let endLine = -1
    let j = i + 1
    for (; j < lines.length; j++) {
      const line = lines[j]!
      if (baseLine === null && line.startsWith(CONFLICT_BASE) && middleLine < 0) { baseLine = j; continue }
      if (middleLine < 0 && line.startsWith(CONFLICT_MIDDLE)) { middleLine = j; continue }
      if (line.startsWith(CONFLICT_END)) { endLine = j; break }
      // 又遇到一个 `<<<<<<<` 说明前一个没闭合 —— 整份不算（宁可不动，也不猜）。
      if (line.startsWith(CONFLICT_START)) { middleLine = -1; break }
    }
    if (middleLine < 0 || endLine < 0) { i++; continue }
    const oursFrom = startLine + 1
    const oursTo = baseLine !== null ? baseLine : middleLine
    const theirsFrom = middleLine + 1
    conflicts.push({
      startLine, middleLine, baseLine, endLine,
      ours: { from: oursFrom, to: oursTo },
      theirs: { from: theirsFrom, to: endLine },
    })
    i = endLine + 1
  }
  return conflicts
}

/**
 * 从一整份文本里取冲突清单 —— 先做一次廉价的 `includes` 预检再解析。
 *
 * 编辑器的每次改字都会调它（见 `CodeEditor.vue` 的 updateListener），而绝大多数文件里
 * 一个标记都没有：不做预检就要把整份文档 split 成行数组，纯浪费。
 */
export function conflictsIn(text: string): Conflict[] {
  return text.includes(CONFLICT_START) ? parseConflicts(text) : []
}

export type ConflictSide = 'left' | 'right'
/**
 * 接受某一侧：把整个冲突块（含四个标记）换成那一侧的内容。
 *
 * 返回新的全文与**这一处之后的**行数变化（调用方据此修正后续冲突的行号，或干脆重解析）。
 * 用整段替换而不是逐行删除，是因为"接受"在语义上就是"这一块现在等于那一侧"。
 */
export function acceptSide(content: string, conflict: Conflict, side: ConflictSide): string {
  const lines = content.split('\n')
  const keep = side === 'left' ? lines.slice(conflict.ours.from, conflict.ours.to) : lines.slice(conflict.theirs.from, conflict.theirs.to)
  return [...lines.slice(0, conflict.startLine), ...keep, ...lines.slice(conflict.endLine + 1)].join('\n')
}

/** 接受某一侧之后，光标该落在哪一行（新内容里这一块的第一行）。 */
export function caretAfterAccept(conflict: Conflict): number {
  return conflict.startLine
}

/** 未决冲突数 = 解析出来的条数（接受一条就少一条，因为标记没了）。 */
export function unresolvedCount(content: string): number {
  return parseConflicts(content).length
}

/**
 * 上一个/下一个冲突。**走完一圈回绕**（同一个文件里来回跳是常态，到底了回到第一个）。
 * `from` 是当前行（0 基）；找不到比它大的就回到第一条。
 */
export function nextConflict(conflicts: readonly Conflict[], from: number, backwards = false): Conflict | null {
  if (!conflicts.length) return null
  if (backwards) {
    for (let i = conflicts.length - 1; i >= 0; i--) if (conflicts[i]!.startLine < from) return conflicts[i]!
    return conflicts[conflicts.length - 1]!
  }
  for (const conflict of conflicts) if (conflict.startLine > from) return conflict
  return conflicts[0]!
}

/** 当前行落在哪个冲突里（光标在里面时导航条要指出"第几条"）。 */
export function conflictAt(conflicts: readonly Conflict[], line: number): Conflict | null {
  return conflicts.find(conflict => line >= conflict.startLine && line <= conflict.endLine) ?? null
}

/** 「第 n 条，共 m 条」——导航条上的计数。没有冲突时返回空串。 */
export function conflictStatus(conflicts: readonly Conflict[], line: number): string {
  if (!conflicts.length) return ''
  const current = conflictAt(conflicts, line)
  const index = current ? conflicts.indexOf(current) : 0
  return `${index + 1}/${conflicts.length}`
}

// —— 文案（一律取随 IDE 发货的中文包）——

/** `button.merge.resolve.accept.left` = 接受左侧。 */
export const ACCEPT_LEFT_TEXT = '接受左侧'
/** `button.merge.resolve.accept.right` = 接受右侧。 */
export const ACCEPT_RIGHT_TEXT = '接受右侧'
/** 导航条上那一句（本仓自己的措辞：上游没有"未解决冲突"这条横幅，它直接开三方工具）。 */
export const CONFLICTS_BANNER = '合并冲突'