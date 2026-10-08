// 搁架（shelf）在 git 后端上的等价物：**储藏栈**的列表模型。
//
// 上游那块 UI 是「搁架」工具窗口（`ShelvedChangesViewManager` 的 `ShelfToolWindowPanel`，
// `platform/vcs-impl/frontend/.../shelf/ShelfToolWindowPanel.kt:47-60`：一个 `ShelfTree` + 工具栏
// `SHELVED_CHANGES_TOOLBAR_ID` + 预览开关）。IDEA 的 shelf 是它自己的目录格式（`ShelfProvider`），
// 本仓的储藏＝`git stash`（`native/git.cpp` 的 `stash_list` / `stash_save` / `stash_pop`），
// 所以本模块把 `git stash list` 的条目整形为可直接渲染的行，并给出**每行能不能取回**的判据。
//
// git 的条目文本形如：
//   `stash@{0}: WIP on master: 1234abc 提交主题`（自动储藏，没有用户信息）
//   `stash@{0}: On master: 我的储藏信息`（`git stash push -m`）
// 这里把它拆成「分支 / 信息 / 是否自动」三段，供行上分列显示（上游树节点也是"名字 + 描述"两段）。
//
// 为什么每条都能取回：`git stash pop` 取的是**栈顶**（LIFO），但按序号取回要
// `git stash pop stash@{n}` —— 本仓 native 通道已收 `ref` 形参（`stash_pop(repo, ref)`，
// `native/git.cpp` 里 `checked_ref` 先 rev-parse --verify 它确实存在、且不以 '-' 开头），
// 所以搁架里**任意一条**都能取回（上游 `ShelfToolWindowPanel` 的「取出」对任意一行都可用），
// 取非栈顶那条不会动它上面的储藏。认不出 ref（不是 `stash@{n}`）的行才灰掉并写明原因。
import type { GitStashEntry } from './vcsLogTypes.ts'

export interface ShelfRow {
  /** `stash@{n}` 的序号（0 = 栈顶）。 */
  index: number
  /** 完整 ref（`stash@{n}`），取回时按它认行。 */
  ref: string
  /** 分支名（解析不出来时为空串）。 */
  branch: string
  /** 用户信息或自动储藏的默认信息（已去掉 `WIP on`/`On` 前缀）。 */
  message: string
  /** 是不是自动储藏（`WIP on`，没有用户给的信息）。 */
  auto: boolean
  /** 能不能取回：ref 是认得出的 `stash@{n}` 即可（非栈顶也行，见文件头）。 */
  restorable: boolean
}

/** `stash@{n}` 里的 n；解析不出来给 -1（调用侧按"不是栈顶"处理）。 */
export function stashIndex(ref: string): number {
  const match = /^stash@\{(\d+)\}$/.exec(ref.trim())
  return match ? Number(match[1]) : -1
}

/**
 * 一条储藏条目的两段文本（上游树节点是"名字 + 描述"，见 `ShelfTree` 的渲染器）。
 * `WIP on <branch>: <rest>` 是自动储藏；`On <branch>: <message>` 是带信息的储藏。
 * 都不匹配时整条文本当信息、分支留空（git 换过版本的输出格式也不至于让整行消失）。
 */
export function parseStashMessage(text: string): { branch: string; message: string; auto: boolean } {
  const value = String(text ?? '')
  const wip = /^WIP on ([^:]*):\s*(.*)$/.exec(value)
  if (wip) return { branch: wip[1] ?? '', message: wip[2] ?? '', auto: true }
  const named = /^On ([^:]*):\s*(.*)$/.exec(value)
  if (named) return { branch: named[1] ?? '', message: named[2] ?? '', auto: false }
  return { branch: '', message: value, auto: false }
}

/** 储藏条目 → 行（顺序就是 `git stash list` 的顺序：栈顶在前）。 */
export function shelfRows(entries: readonly GitStashEntry[] | null | undefined): ShelfRow[] {
  return (entries ?? []).map((entry, position) => {
    const parsed = parseStashMessage(entry.message)
    // 序号以 ref 里的 `stash@{n}` 为准；ref 解析不出来时退回列表位置（第一条即栈顶）。
    const index = stashIndex(entry.ref)
    const effective = index >= 0 ? index : position
    return {
      index: effective,
      ref: entry.ref,
      branch: parsed.branch,
      message: parsed.message,
      auto: parsed.auto,
      // 只有认得出 `stash@{n}` 的 ref 才能交给 `git stash pop <ref>`（宿主会 rev-parse 校验）。
      restorable: index >= 0,
    }
  })
}

/** 行上取回按钮的禁用原因（可点时为 null）。 */
export function restoreBlockedReason(row: ShelfRow): string | null {
  if (row.restorable) return null
  return `认不出这条储藏的 ref「${row.ref}」，没法按序号取回；可在终端用 git stash pop ${row.ref} 试试。`
}

/** 空列表的说明（面板里那一行）。 */
export const SHELF_EMPTY_TEXT = '没有储藏。用「储藏当前更改」把工作区收进一条储藏。'
/** 面板标题（上游工具窗口名 `ShelvedChangesViewManager` 的 `VcsBundle` 短名对应物）。 */
export const SHELF_TITLE = '搁架'
/**
 * 「查看差异」按钮的提示（上游搁架树的预览面：`ShelvedChangesViewManager` 的预览开关 /
 * `ShelvedWrapperDiffRequestProducer` 那条「选中一条就看它的改动」）。
 * 本仓走 `git.showCommit` 对 `stash@{n}`（零 native 改动，见 `src/shelfHost.ts` 的 `show`）。
 */
export const SHELF_DIFF_TITLE = '查看这条储藏的差异（git show stash@{n}）'
